package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.doc.DocTypes;
import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

/**
 * P10 — First-class Batch Card document (NUM-PROD-BATCH, {@code BC-...}; DOC_57 §4 #12;
 * FR-PROD-BATCH-001). Execution + traceability record for batch/lot-controlled items
 * (CLAR-PROD-011): manual-select allocation of the production output quantity to physical
 * batch runs (batch/lot/heat identity; heat captured).
 *
 * <p>RECORDING-ONLY (ADR-PROD-005 boundary): the Batch Card NEVER modifies
 * {@code production_entry} quantities, WIP, subjob roll-ups, normalized events, or
 * stock_ledger / stock_balance; it never calls {@link StockService}.
 *
 * <p>Lifecycle (approved): OPEN → HELD ↔ OPEN; OPEN/HELD → CLOSED. No other states.
 * Reversal = a compensating mirror card (is_reversal=true, status CLOSED, allocations
 * negated, {@code BC-RV-...} number); the original card stays CLOSED.
 *
 * <p>Allocation rule (CLAR-PROD-011, MANUAL SELECT at design — within the approved
 * manual/FIFO/FEFO range): the user manually picks physical batches and quantities.
 * Partial allocation is allowed (remaining = card quantity − Σ allocated ≥ 0);
 * duplicate batch allocation on the same card is rejected.
 *
 * <p>Quantity integrity: Σ quantity of non-reversal cards for (entryId, itemCode)
 * ≤ the entry output bucket (goodQuantity for the primary item; the output quantity
 * for an additional output), so the card set never double-counts production.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ProductionBatchCardService {

    public static final String FAMILY = "BATCH_CARD";
    public static final String STATUS_OPEN = "OPEN";
    public static final String STATUS_HELD = "HELD";
    public static final String STATUS_CLOSED = "CLOSED";

    private final DocNumberService numbers;
    private final ProductionEntryRepository productionEntries;
    private final ProductionBatchCardRepository batchCards;
    private final ProductionDocPostingKeyRepository postingKeys;
    private final ProductionBatchCardAuditLogRepository auditLogs;
    private final ItemRepository items;
    private final JobCardSubjobRepository subjobs;
    private final WorkflowStateMachine stateMachine;

    // ------------------------------------------------------------------
    // READ
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<ProductionBatchCard> list() {
        List<ProductionBatchCard> docs = batchCards.findAll();
        docs.forEach(d -> { if (d.getAllocations() != null) d.getAllocations().size(); });
        return docs;
    }

    @Transactional(readOnly = true)
    public ProductionBatchCard get(Long id) {
        ProductionBatchCard card = batchCards.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Batch Card not found: " + id));
        if (card.getAllocations() != null) card.getAllocations().size();
        return card;
    }

    // ------------------------------------------------------------------
    // CREATE / UPDATE
    // ------------------------------------------------------------------

    @Transactional
    public ProductionBatchCard create(ProductionBatchCard doc, String user) {
        doc.setId(null);
        doc.setIsReversal(Boolean.FALSE);
        ProductionEntry entry = requirePostedEntry(doc.getEntryId());
        validateItem(entry, doc);
        if (blank(doc.getPhysicalBatchNumber())) {
            throw new IllegalArgumentException(
                    "Physical batch number is mandatory for batch/lot-controlled item '"
                            + doc.getItemCode() + "' (CLAR-PROD-011).");
        }
        // Idempotent create: same entry + physical batch (non-reversal) returns the existing card.
        batchCards.findByEntryIdAndPhysicalBatchNumberAndIsReversalFalse(
                        doc.getEntryId(), doc.getPhysicalBatchNumber())
                .ifPresent(existing -> {
                    throw new DuplicateBatchCardException(existing.getId());
                });

        doc.setEntryNumber(entry.getEntryNumber());
        if (blank(doc.getJobCardNumber())) doc.setJobCardNumber(entry.getJobCardNumber());
        if (blank(doc.getSubjobNumber())) doc.setSubjobNumber(entry.getSubjobNumber());
        if (blank(doc.getOperationCode())) doc.setOperationCode(entry.getOperationCode());
        fillFromItemAndEntry(doc, entry);
        doc.setStatus(STATUS_OPEN);
        doc.setCreatedBy(user);
        doc.setCreatedAt(Instant.now());
        verifySubjobMapping(doc);
        validateQuantities(doc, entry, null);
        validateAllocations(doc);
        doc.setAllocations(doc.getAllocations());
        doc.setDocNumber(numbers.next("batch-card", "BC"));
        ProductionBatchCard saved = safeSave(batchCards.save(doc));
        audit(saved, "CREATE", user, null);
        return saved;
    }

    @Transactional
    public ProductionBatchCard update(Long id, ProductionBatchCard doc, String user) {
        ProductionBatchCard existing = batchCards.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Batch Card not found: " + id));
        if (!STATUS_OPEN.equals(existing.getStatus())) {
            throw new IllegalArgumentException("Only OPEN Batch Cards can be edited.");
        }
        if (blank(doc.getPhysicalBatchNumber()) && !blank(existing.getPhysicalBatchNumber())) {
            doc.setPhysicalBatchNumber(existing.getPhysicalBatchNumber());
        }
        ProductionEntry entry = requirePostedEntry(doc.getEntryId() != null ? doc.getEntryId() : existing.getEntryId());
        if (doc.getEntryId() == null) {
            doc.setEntryId(existing.getEntryId());
            doc.setEntryNumber(existing.getEntryNumber());
        } else {
            doc.setEntryNumber(entry.getEntryNumber());
        }
        if (blank(doc.getJobCardNumber())) doc.setJobCardNumber(entry.getJobCardNumber());
        if (blank(doc.getSubjobNumber())) doc.setSubjobNumber(entry.getSubjobNumber());
        if (blank(doc.getOperationCode())) doc.setOperationCode(entry.getOperationCode());
        if (blank(doc.getItemCode())) {
            doc.setItemCode(existing.getItemCode());
            doc.setItemName(existing.getItemName());
            doc.setUom(existing.getUom());
        }
        validateItem(entry, doc);
        if (blank(doc.getPhysicalBatchNumber())) {
            throw new IllegalArgumentException(
                    "Physical batch number is mandatory for batch/lot-controlled item '"
                            + doc.getItemCode() + "' (CLAR-PROD-011).");
        }

        // Duplicate-creation guard must exclude this card itself (open updates).
        batchCards.findByEntryIdAndPhysicalBatchNumberAndIsReversalFalse(
                        doc.getEntryId(), doc.getPhysicalBatchNumber())
                .filter(other -> !other.getId().equals(id))
                .ifPresent(other -> {
                    throw new IllegalArgumentException("A Batch Card already exists for entry "
                            + doc.getEntryId() + " and physical batch '" + doc.getPhysicalBatchNumber()
                            + "'.");
                });

        fillFromItemAndEntry(doc, entry);
        verifySubjobMapping(doc);
        validateQuantities(doc, entry, id);
        validateAllocations(doc);

        existing.setPhysicalBatchNumber(doc.getPhysicalBatchNumber());
        existing.setLotNumber(doc.getLotNumber());
        existing.setHeatNumber(doc.getHeatNumber());
        existing.setItemCode(doc.getItemCode());
        existing.setItemName(doc.getItemName());
        existing.setUom(doc.getUom());
        existing.setQuantity(doc.getQuantity());
        existing.setEntryId(doc.getEntryId());
        existing.setEntryNumber(doc.getEntryNumber());
        existing.setJobCardNumber(doc.getJobCardNumber());
        existing.setSubjobNumber(doc.getSubjobNumber());
        existing.setOperationCode(doc.getOperationCode());
        existing.setRemarks(doc.getRemarks());
        existing.setUpdatedBy(user);
        existing.setUpdatedAt(Instant.now());
        existing.setAllocations(doc.getAllocations());
        ProductionBatchCard saved = safeSave(batchCards.save(existing));
        audit(saved, "UPDATE", user, null);
        return saved;
    }

    // ------------------------------------------------------------------
    // ACTIONS (workflow + reversal)
    // ------------------------------------------------------------------

    @Transactional
    public ProductionBatchCard action(Long id, String action, String reversalReason,
                                      String idempotencyKey, String user) {
        ProductionBatchCard card = batchCards.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Batch Card not found: " + id));

        String act = action == null ? "" : action.toLowerCase(Locale.ROOT);
        switch (act) {
            case "hold":
            case "reopen":
            case "close": {
                stateMachine.validateTransition("batch-card", card.getStatus(), act);
                card.setStatus(act.equals("hold") ? STATUS_HELD
                        : act.equals("reopen") ? STATUS_OPEN : STATUS_CLOSED);
                card.setUpdatedBy(user);
                card.setUpdatedAt(Instant.now());
                ProductionBatchCard saved = safeSave(batchCards.save(card));
                if (saved.getAllocations() != null) saved.getAllocations().size();
                audit(saved, act.toUpperCase(Locale.ROOT), user, null);
                return saved;
            }
            case "reverse": {
                return reverse(card, reversalReason, idempotencyKey, user);
            }
            case "create": // passthrough for idempotent-close parity with P9 post
                return card;
            default:
                throw new IllegalArgumentException("Unsupported action: " + action);
        }
    }

    private ProductionBatchCard reverse(ProductionBatchCard card, String reason,
                                        String idempotencyKey, String user) {
        if (!STATUS_CLOSED.equals(card.getStatus())) {
            throw new IllegalArgumentException("Only CLOSED Batch Cards can be reversed.");
        }
        // Same-key retry: idempotently return the already-created mirror if that key succeeded.
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            Optional<ProductionDocPostingKey> processed = postingKeys
                    .findByIdempotencyKey(idempotencyKey)
                    .filter(k -> "SUCCESS".equals(k.getResultStatus()));
            if (processed.isPresent()) {
                ProductionBatchCard mirror = batchCards.findById(processed.get().getDocId())
                        .orElseThrow(() -> new IllegalArgumentException(
                                "Reversal mirror no longer exists for key " + idempotencyKey + "."));
                if (mirror.getAllocations() != null) mirror.getAllocations().size();
                return mirror;
            }
        }
        // Repeated reversal guard: only allowed via the original idempotency key.
        List<ProductionBatchCard> mirrors = batchCards.findByReversedFromDocId(card.getId());
        if (!mirrors.isEmpty()) {
            throw new IllegalArgumentException("Batch Card " + card.getDocNumber()
                    + " has already been reversed by " + mirrors.get(0).getDocNumber() + ".");
        }

        ProductionBatchCard mirror = new ProductionBatchCard();
        mirror.setDocNumber(numbers.next("batch-card", "BC-RV"));
        mirror.setPhysicalBatchNumber(card.getPhysicalBatchNumber());
        mirror.setLotNumber(card.getLotNumber());
        mirror.setHeatNumber(card.getHeatNumber());
        mirror.setItemCode(card.getItemCode());
        mirror.setItemName(card.getItemName());
        mirror.setUom(card.getUom());
        mirror.setQuantity(card.getQuantity() != null ? card.getQuantity().negate() : null);
        mirror.setEntryId(card.getEntryId());
        mirror.setEntryNumber(card.getEntryNumber());
        mirror.setJobCardNumber(card.getJobCardNumber());
        mirror.setSubjobNumber(card.getSubjobNumber());
        mirror.setOperationCode(card.getOperationCode());
        mirror.setStatus(STATUS_CLOSED);
        mirror.setReversedFromDocId(card.getId());
        mirror.setIsReversal(true);
        mirror.setReversalReason(reason == null || reason.isBlank() ? "Correction transaction" : reason);
        mirror.setRemarks(card.getRemarks());
        mirror.setCreatedBy(user);
        mirror.setCreatedAt(Instant.now());

        if (card.getAllocations() != null) {
            List<ProductionBatchCardAllocation> negated = new ArrayList<>();
            for (ProductionBatchCardAllocation l : card.getAllocations()) {
                negated.add(ProductionBatchCardAllocation.builder()
                        .batchNumber(l.getBatchNumber())
                        .lotNumber(l.getLotNumber())
                        .heatNumber(l.getHeatNumber())
                        .quantity(l.getQuantity() != null ? l.getQuantity().negate() : null)
                        .location(l.getLocation() != null ? l.getLocation() : "STORE")
                        .remarks(l.getRemarks())
                        .build());
            }
            mirror.setAllocations(negated);
        }

        card.setReversalReason(mirror.getReversalReason());
        card.setUpdatedBy(user);
        card.setUpdatedAt(Instant.now());
        safeSave(batchCards.save(card));
        ProductionBatchCard saved = safeSave(batchCards.save(mirror));
        audit(card, "REVERSE", user, "{\"reversalDocId\":" + saved.getId() + "}");
        audit(saved, "CREATE", user, "{\"reversedFromDocId\":" + card.getId() + "}");
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            saveIdempotencyKey(idempotencyKey, saved.getId());
        }
        return saved;
    }

    // ------------------------------------------------------------------
    // VALIDATION
    // ------------------------------------------------------------------

    private ProductionEntry requirePostedEntry(Long entryId) {
        if (entryId == null) {
            throw new IllegalArgumentException("entryId is mandatory for a Batch Card.");
        }
        ProductionEntry entry = productionEntries.findById(entryId)
                .orElseThrow(() -> new IllegalArgumentException(
                        "Batch Card references a Production Entry that does not exist: " + entryId));
        if (!"POSTED".equalsIgnoreCase(entry.getStatus()) || Boolean.TRUE.equals(entry.getIsReversal())) {
            throw new IllegalArgumentException(
                    "Batch Cards can only be created against a POSTED (non-reversed) Production Entry.");
        }
        return entry;
    }

    private void validateItem(ProductionEntry entry, ProductionBatchCard card) {
        if (blank(card.getItemCode())) {
            throw new IllegalArgumentException("Item code is mandatory for a Batch Card.");
        }
        Optional<ItemMaster> item = items.findByCode(card.getItemCode());
        if (item.isEmpty()) {
            throw new IllegalArgumentException("Item '" + card.getItemCode()
                    + "' does not exist in the item master.");
        }
        // `batchControl` and `requiresBatch` are independently meaningful (either one alone
        // marks the item batch-controlled) — confirmed by this test class's deliberate
        // batchControl=true/requiresBatch=false case; not safe to collapse to one flag.
        boolean controlled = Boolean.TRUE.equals(item.get().getBatchControl())
                || Boolean.TRUE.equals(item.get().getRequiresBatch());
        if (!controlled) {
            throw new IllegalArgumentException("Batch Card applies to batch/lot-controlled items only (CLAR-PROD-011).");
        }
        if (outputBucket(entry, card.getItemCode()).signum() <= 0) {
            throw new IllegalArgumentException("Item '" + card.getItemCode()
                    + "' is not an output of the referenced Production Entry.");
        }
    }

    private void fillFromItemAndEntry(ProductionBatchCard card, ProductionEntry entry) {
        Optional<ItemMaster> item = items.findByCode(card.getItemCode());
        item.ifPresent(i -> {
            if (blank(card.getItemName())) card.setItemName(i.getName());
        });
        if (blank(card.getUom())) card.setUom(entry.getUom());
    }

    private void validateQuantities(ProductionBatchCard card, ProductionEntry entry, Long selfId) {
        if (card.getQuantity() == null || card.getQuantity().compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("Batch Card quantity must be greater than zero.");
        }
        BigDecimal bucket = outputBucket(entry, card.getItemCode());
        BigDecimal used = BigDecimal.ZERO;
        for (ProductionBatchCard other : batchCards.findByEntryIdAndItemCodeAndIsReversalFalseOrderByIdAsc(
                entry.getId(), card.getItemCode())) {
            if (selfId != null && other.getId().equals(selfId)) {
                continue;
            }
            if (other.getQuantity() != null) {
                used = used.add(other.getQuantity());
            }
        }
        BigDecimal total = used.add(card.getQuantity());
        if (total.compareTo(bucket) > 0) {
            throw new IllegalArgumentException(
                    "Batch Card quantity " + total + " exceeds the available output quantity "
                            + bucket + " for item '" + card.getItemCode()
                            + "' on the referenced entry (already carded " + used + ").");
        }
    }

    private BigDecimal outputBucket(ProductionEntry entry, String itemCode) {
        if (itemCode != null && entry.getPartCode() != null
                && itemCode.equalsIgnoreCase(entry.getPartCode())) {
            return entry.getGoodQuantity() != null ? entry.getGoodQuantity() : BigDecimal.ZERO;
        }
        BigDecimal sum = BigDecimal.ZERO;
        for (ProductionEntryOutput o : entry.getAdditionalOutputs()) {
            if (o.getItemCode() != null && o.getItemCode().equalsIgnoreCase(itemCode)
                    && o.getQuantity() != null) {
                sum = sum.add(o.getQuantity());
            }
        }
        return sum;
    }

    private void validateAllocations(ProductionBatchCard card) {
        List<ProductionBatchCardAllocation> list = card.getAllocations();
        if (list == null || list.isEmpty()) {
            return;
        }
        if (Boolean.TRUE.equals(card.getIsReversal())) {
            return; // reversal mirrors are service-generated; signed values validated at build
        }
        Set<String> batches = new HashSet<>();
        BigDecimal sum = BigDecimal.ZERO;
        for (ProductionBatchCardAllocation l : list) {
            if (l == null) {
                continue;
            }
            if (blank(l.getBatchNumber())) {
                throw new IllegalArgumentException("Allocation batch number is mandatory (CLAR-PROD-011).");
            }
            if (!batches.add(l.getBatchNumber().toUpperCase(Locale.ROOT))) {
                throw new IllegalArgumentException(
                        "Batch '" + l.getBatchNumber() + "' is already allocated on this card.");
            }
            if (l.getQuantity() == null || l.getQuantity().compareTo(BigDecimal.ZERO) <= 0) {
                throw new IllegalArgumentException("Allocation quantity must be greater than zero.");
            }
            sum = sum.add(l.getQuantity());
        }
        if (card.getQuantity() != null && sum.compareTo(card.getQuantity()) > 0) {
            throw new IllegalArgumentException(
                    "Allocated quantity " + sum + " exceeds the Batch Card quantity " + card.getQuantity()
                            + " (remaining allocation allowed, never over-allocation).");
        }
    }

    // validation seam for tests (package-private, same package as the unit tests)
    void validateForCreate(ProductionBatchCard doc) {
        ProductionEntry entry = requirePostedEntry(doc.getEntryId());
        validateItem(entry, doc);
        if (blank(doc.getPhysicalBatchNumber())) {
            throw new IllegalArgumentException("Physical batch number is mandatory for batch/lot-controlled items (CLAR-PROD-011).");
        }
        validateQuantities(doc, entry, null);
        validateAllocations(doc);
    }

    private void verifySubjobMapping(ProductionBatchCard card) {
        if (blank(card.getJobCardNumber()) || blank(card.getOperationCode())) {
            return;
        }
        List<JobCardSubjob> subs = subjobs.findByJobCardJobCardNumber(card.getJobCardNumber());
        boolean found = subs.stream().anyMatch(s -> card.getOperationCode().equalsIgnoreCase(s.getOperationCode()));
        if (!found) {
            throw new IllegalArgumentException(
                    "No subjob matches operation code '" + card.getOperationCode()
                            + "' on job card '" + card.getJobCardNumber() + "' (CLAR-PROD-005 1:1).");
        }
    }

    // ------------------------------------------------------------------
    // FAILURE-SAFE SAVE + IDEMPOTENCY + AUDIT
    // ------------------------------------------------------------------

    /**
     * The create-level idempotency is enforced by the UNIQUE(entry_id, physical_batch_number)
     * partial index; the duplicate-create pre-check throws {@link DuplicateBatchCardException}
     * (mapped to the original card by the controller) so a concurrent duplicate request
     * degrades to the same safe result instead of a constraint violation.
     */
    private ProductionBatchCard safeSave(ProductionBatchCard card) {
        try {
            return batchCards.save(card);
        } catch (DataIntegrityViolationException e) {
            log.warn("Batch Card save violated a uniqueness constraint (duplicate create collided): {}", e.getMessage());
            // Colliding duplicate create: return the already-existing card for the same identity.
            if (card.getEntryId() != null && !blank(card.getPhysicalBatchNumber())) {
                Optional<ProductionBatchCard> existing = batchCards
                        .findByEntryIdAndPhysicalBatchNumberAndIsReversalFalse(
                                card.getEntryId(), card.getPhysicalBatchNumber());
                if (existing.isPresent()) {
                    if (existing.get().getAllocations() != null) {
                        existing.get().getAllocations().size();
                    }
                    return existing.get();
                }
            }
            throw e;
        }
    }

    private void saveIdempotencyKey(String key, Long id) {
        try {
            postingKeys.save(ProductionDocPostingKey.builder()
                    .idempotencyKey(key)
                    .docFamily(FAMILY)
                    .docId(id)
                    .resultStatus("SUCCESS")
                    .createdAt(Instant.now())
                    .build());
        } catch (Exception e) {
            log.warn("Batch Card idempotency key ({}) could not be persisted: {}", key, e.getMessage());
        }
    }

    private void audit(ProductionBatchCard card, String event, String user, String metadataJson) {
        try {
            auditLogs.save(ProductionBatchCardAuditLog.builder()
                    .docId(card.getId())
                    .docNumber(card.getDocNumber())
                    .eventType(event)
                    .userId(user)
                    .timestamp(Instant.now())
                    .metadataJson(metadataJson)
                    .build());
        } catch (Exception e) {
            log.warn("Batch Card audit log ({}) failed for doc {}: {}", event, card.getDocNumber(), e.getMessage());
        }
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    /** Thrown by the create pre-check so the controller can return the original duplicate card. */
    public static class DuplicateBatchCardException extends RuntimeException {
        public DuplicateBatchCardException(Long id) {
            super("A Batch Card already exists for this entry and physical batch (existing id " + id + ").");
        }
    }
}