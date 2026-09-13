package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * P9 — First-class Rejection / Scrap / Rework disposition documents (ADR-PROD-003
 * CREATE NEW first-class docs; ADR-PROD-004 numbering via {@link DocNumberService};
 * CLAR-PROD-002 R1 rejected-split; CLAR-PROD-005 rework-route; CLAR-PROD-011 batch
 * identity; CLAR-PROD-003 + D-C1 strict disposition, never FREE).
 *
 * <p>RECORDING-ONLY: documents classify an already-reported entry bucket
 * (rejected / scrap / rework). They NEVER modify {@code production_entry}
 * quantities, WIP, produced/pending, subjob roll-ups, normalized events, or
 * Inventory balances; they never call {@code StockService}.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ProductionDispositionService {

    public static final String FAMILY_REJECTION = "REJECTION";
    public static final String FAMILY_SCRAP = "SCRAP";
    public static final String FAMILY_REWORK = "REWORK";

    public static final String DISPOSITION_REWORKABLE = "REWORKABLE";
    public static final String DISPOSITION_SCRAP = "SCRAP";
    public static final String DISPOSITION_HOLD_MRB = "HOLD_MRB";

    private static final Set<String> REJECTION_DISPOSITIONS = Set.of(
            DISPOSITION_REWORKABLE, DISPOSITION_SCRAP, DISPOSITION_HOLD_MRB);
    private static final Set<String> SCRAP_DISPOSITIONS = Set.of(
            DISPOSITION_SCRAP, DISPOSITION_HOLD_MRB);
    private static final Set<String> PRE_POST_STATUSES = Set.of("DRAFT", "SUBMITTED", "APPROVED");

    private final DocNumberService numbers;
    private final ProductionEntryRepository productionEntries;
    private final ProductionRejectionDocRepository rejectionDocs;
    private final ProductionScrapDocRepository scrapDocs;
    private final ProductionReworkDocRepository reworkDocs;
    private final ProductionDocPostingKeyRepository postingKeys;
    private final ProductionDispositionAuditLogRepository auditLogs;
    private final ItemRepository items;
    private final JobCardSubjobRepository subjobs;

    // ------------------------------------------------------------------
    // READ
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<ProductionRejectionDoc> listRejections() {
        List<ProductionRejectionDoc> docs = rejectionDocs.findAll();
        docs.forEach(d -> { if (d.getLines() != null) d.getLines().size(); });
        return docs;
    }

    @Transactional(readOnly = true)
    public List<ProductionScrapDoc> listScraps() {
        List<ProductionScrapDoc> docs = scrapDocs.findAll();
        docs.forEach(d -> { if (d.getLines() != null) d.getLines().size(); });
        return docs;
    }

    @Transactional(readOnly = true)
    public List<ProductionReworkDoc> listReworks() {
        List<ProductionReworkDoc> docs = reworkDocs.findAll();
        docs.forEach(d -> { if (d.getLines() != null) d.getLines().size(); });
        return docs;
    }

    @Transactional(readOnly = true)
    public ProductionRejectionDoc getRejection(Long id) {
        ProductionRejectionDoc doc = rejectionDocs.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Rejection document not found: " + id));
        doc.getLines().size();
        return doc;
    }

    @Transactional(readOnly = true)
    public ProductionScrapDoc getScrap(Long id) {
        ProductionScrapDoc doc = scrapDocs.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Scrap document not found: " + id));
        doc.getLines().size();
        return doc;
    }

    @Transactional(readOnly = true)
    public ProductionReworkDoc getRework(Long id) {
        ProductionReworkDoc doc = reworkDocs.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Rework document not found: " + id));
        doc.getLines().size();
        return doc;
    }

    // ------------------------------------------------------------------
    // CREATE / UPDATE
    // ------------------------------------------------------------------

    @Transactional
    public ProductionRejectionDoc createRejection(ProductionRejectionDoc doc, String user) {
        doc.setId(null);
        preCreateBase(doc, user);
        validateStructure(doc);
        doc.setLines(doc.getLines());
        doc.setDocNumber(numbers.next("rejection-document", "REJ"));
        ProductionRejectionDoc saved = rejectionDocs.save(doc);
        audit(FAMILY_REJECTION, saved, "CREATE", user, null);
        return saved;
    }

    @Transactional
    public ProductionScrapDoc createScrap(ProductionScrapDoc doc, String user) {
        doc.setId(null);
        preCreateBase(doc, user);
        validateStructure(doc);
        doc.setLines(doc.getLines());
        doc.setDocNumber(numbers.next("scrap-document", "SC"));
        ProductionScrapDoc saved = scrapDocs.save(doc);
        audit(FAMILY_SCRAP, saved, "CREATE", user, null);
        return saved;
    }

    @Transactional
    public ProductionReworkDoc createRework(ProductionReworkDoc doc, String user) {
        doc.setId(null);
        preCreateBase(doc, user);
        validateStructure(doc);
        doc.setLines(doc.getLines());
        doc.setDocNumber(numbers.next("rework-document", "PER"));
        ProductionReworkDoc saved = reworkDocs.save(doc);
        audit(FAMILY_REWORK, saved, "CREATE", user, null);
        return saved;
    }

    @Transactional
    public ProductionRejectionDoc updateRejection(Long id, ProductionRejectionDoc doc, String user) {
        ProductionRejectionDoc existing = getRejection(id);
        if (!"DRAFT".equals(existing.getStatus())) {
            throw new IllegalArgumentException("Only DRAFT rejection documents can be edited (V-22 style freeze).");
        }
        existing.setRemarks(doc.getRemarks());
        existing.setInspectionDate(doc.getInspectionDate());
        existing.setInspector(doc.getInspector());
        existing.setNcrNumber(doc.getNcrNumber());
        existing.setLines(doc.getLines());
        existing.setUpdatedBy(user);
        existing.setUpdatedAt(Instant.now());
        validateStructure(existing);
        audit(FAMILY_REJECTION, existing, "DRAFT_SAVE", user, null);
        return rejectionDocs.save(existing);
    }

    @Transactional
    public ProductionScrapDoc updateScrap(Long id, ProductionScrapDoc doc, String user) {
        ProductionScrapDoc existing = getScrap(id);
        if (!"DRAFT".equals(existing.getStatus())) {
            throw new IllegalArgumentException("Only DRAFT scrap documents can be edited (V-22 style freeze).");
        }
        existing.setRemarks(doc.getRemarks());
        existing.setScrapDate(doc.getScrapDate());
        existing.setLines(doc.getLines());
        existing.setUpdatedBy(user);
        existing.setUpdatedAt(Instant.now());
        validateStructure(existing);
        audit(FAMILY_SCRAP, existing, "DRAFT_SAVE", user, null);
        return scrapDocs.save(existing);
    }

    @Transactional
    public ProductionReworkDoc updateRework(Long id, ProductionReworkDoc doc, String user) {
        ProductionReworkDoc existing = getRework(id);
        if (!"DRAFT".equals(existing.getStatus())) {
            throw new IllegalArgumentException("Only DRAFT rework documents can be edited (V-22 style freeze).");
        }
        existing.setRemarks(doc.getRemarks());
        existing.setReworkDate(doc.getReworkDate());
        existing.setLines(doc.getLines());
        existing.setUpdatedBy(user);
        existing.setUpdatedAt(Instant.now());
        validateStructure(existing);
        audit(FAMILY_REWORK, existing, "DRAFT_SAVE", user, null);
        return reworkDocs.save(existing);
    }

    // ------------------------------------------------------------------
    // ACTIONS
    // ------------------------------------------------------------------

    @Transactional
    public ProductionRejectionDoc actionRejection(Long id, String action, String reason,
                                                 String idempotencyKey, String user) {
        ProductionRejectionDoc doc = getRejection(id);
        String act = action == null ? "" : action.toLowerCase();

        if ("post".equals(act) && isAlreadyProcessed(idempotencyKey)) {
            return doc;
        }
        guardTransition(doc.getStatus(), act, "rejection");
        if (act.startsWith("reverse")) return reverseRejection(doc, reason, user);

        switch (act) {
            case "submit" -> doc.setStatus("SUBMITTED");
            case "approve" -> doc.setStatus("APPROVED");
            case "post" -> {
                validateRejectionPost(doc);
                doc.setStatus("POSTED");
            }
            case "cancel" -> doc.setStatus("CANCELLED");
            case "close" -> doc.setStatus("CLOSED");
            default -> throw new IllegalArgumentException("Unsupported action: " + action);
        }
        doc.setUpdatedBy(user);
        doc.setUpdatedAt(Instant.now());
        ProductionRejectionDoc saved = rejectionDocs.save(doc);
        if ("post".equals(act) && idempotencyKey != null && !idempotencyKey.isBlank()) {
            saveIdempotencyKey(idempotencyKey, FAMILY_REJECTION, saved.getId());
        }
        audit(FAMILY_REJECTION, saved, act.toUpperCase(), user, null);
        return saved;
    }

    @Transactional
    public ProductionScrapDoc actionScrap(Long id, String action, String reason,
                                         String idempotencyKey, String user) {
        ProductionScrapDoc doc = getScrap(id);
        String act = action == null ? "" : action.toLowerCase();

        if ("post".equals(act) && isAlreadyProcessed(idempotencyKey)) {
            return doc;
        }
        guardTransition(doc.getStatus(), act, "scrap");
        if (act.startsWith("reverse")) return reverseScrap(doc, reason, user);

        switch (act) {
            case "submit" -> doc.setStatus("SUBMITTED");
            case "approve" -> doc.setStatus("APPROVED");
            case "post" -> {
                validateScrapPost(doc);
                doc.setStatus("POSTED");
            }
            case "cancel" -> doc.setStatus("CANCELLED");
            case "close" -> doc.setStatus("CLOSED");
            default -> throw new IllegalArgumentException("Unsupported action: " + action);
        }
        doc.setUpdatedBy(user);
        doc.setUpdatedAt(Instant.now());
        ProductionScrapDoc saved = scrapDocs.save(doc);
        if ("post".equals(act) && idempotencyKey != null && !idempotencyKey.isBlank()) {
            saveIdempotencyKey(idempotencyKey, FAMILY_SCRAP, saved.getId());
        }
        audit(FAMILY_SCRAP, saved, act.toUpperCase(), user, null);
        return saved;
    }

    @Transactional
    public ProductionReworkDoc actionRework(Long id, String action, String reason,
                                           String idempotencyKey, String user) {
        ProductionReworkDoc doc = getRework(id);
        String act = action == null ? "" : action.toLowerCase();

        if ("post".equals(act) && isAlreadyProcessed(idempotencyKey)) {
            return doc;
        }
        guardTransition(doc.getStatus(), act, "rework");
        if (act.startsWith("reverse")) return reverseRework(doc, reason, user);

        switch (act) {
            case "submit" -> doc.setStatus("SUBMITTED");
            case "approve" -> doc.setStatus("APPROVED");
            case "post" -> {
                validateReworkPost(doc);
                doc.setStatus("POSTED");
            }
            case "cancel" -> doc.setStatus("CANCELLED");
            case "close" -> doc.setStatus("CLOSED");
            default -> throw new IllegalArgumentException("Unsupported action: " + action);
        }
        doc.setUpdatedBy(user);
        doc.setUpdatedAt(Instant.now());
        ProductionReworkDoc saved = reworkDocs.save(doc);
        if ("post".equals(act) && idempotencyKey != null && !idempotencyKey.isBlank()) {
            saveIdempotencyKey(idempotencyKey, FAMILY_REWORK, saved.getId());
        }
        audit(FAMILY_REWORK, saved, act.toUpperCase(), user, null);
        return saved;
    }

    // ------------------------------------------------------------------
    // REVERSAL (compensating mirror with negated lines)
    // ------------------------------------------------------------------

    private ProductionRejectionDoc reverseRejection(ProductionRejectionDoc doc, String reason, String user) {
        ProductionRejectionDoc rev = new ProductionRejectionDoc();
        copyBaseForMirror(rev, doc);
        rev.setDocNumber(numbers.next("rejection-document", "REJ-RV"));
        rev.setReversedFromDocId(doc.getId());
        rev.setIsReversal(true);
        rev.setReversalReason(reason == null || reason.isBlank() ? "Correction transaction" : reason);
        rev.setInspectionDate(doc.getInspectionDate());
        rev.setInspector(doc.getInspector());
        rev.setNcrNumber(doc.getNcrNumber());
        if (doc.getLines() != null) {
            List<ProductionRejectionLine> negated = new ArrayList<>();
            for (ProductionRejectionLine l : doc.getLines()) {
                negated.add(ProductionRejectionLine.builder()
                        .itemCode(l.getItemCode()).itemName(l.getItemName())
                        .quantity(l.getQuantity() != null ? l.getQuantity().negate() : null)
                        .uom(l.getUom())
                        .reasonCode(l.getReasonCode()).reasonDescription(l.getReasonDescription())
                        .disposition(l.getDisposition()).batchNumber(l.getBatchNumber())
                        .location(l.getLocation() != null ? l.getLocation() : "STORE")
                        .remarks(l.getRemarks())
                        .build());
            }
            rev.setLines(negated);
        }
        doc.setStatus("REVERSED");
        doc.setReversalReason(rev.getReversalReason());
        rejectionDocs.save(doc);
        ProductionRejectionDoc saved = rejectionDocs.save(rev);
        audit(FAMILY_REJECTION, doc, "REVERSE", user, "{\"reversalDocId\":" + saved.getId() + "}");
        return saved;
    }

    private ProductionScrapDoc reverseScrap(ProductionScrapDoc doc, String reason, String user) {
        ProductionScrapDoc rev = new ProductionScrapDoc();
        copyBaseForMirror(rev, doc);
        rev.setDocNumber(numbers.next("scrap-document", "SC-RV"));
        rev.setReversedFromDocId(doc.getId());
        rev.setIsReversal(true);
        rev.setReversalReason(reason == null || reason.isBlank() ? "Correction transaction" : reason);
        rev.setScrapDate(doc.getScrapDate());
        if (doc.getLines() != null) {
            List<ProductionScrapLine> negated = new ArrayList<>();
            for (ProductionScrapLine l : doc.getLines()) {
                negated.add(ProductionScrapLine.builder()
                        .itemCode(l.getItemCode()).itemName(l.getItemName())
                        .quantity(l.getQuantity() != null ? l.getQuantity().negate() : null)
                        .uom(l.getUom())
                        .reasonCode(l.getReasonCode()).reasonDescription(l.getReasonDescription())
                        .disposition(l.getDisposition()).batchNumber(l.getBatchNumber())
                        .warehouse(l.getWarehouse() != null ? l.getWarehouse() : "STORE")
                        .location(l.getLocation() != null ? l.getLocation() : "STORE")
                        .remarks(l.getRemarks())
                        .build());
            }
            rev.setLines(negated);
        }
        doc.setStatus("REVERSED");
        doc.setReversalReason(rev.getReversalReason());
        scrapDocs.save(doc);
        ProductionScrapDoc saved = scrapDocs.save(rev);
        audit(FAMILY_SCRAP, doc, "REVERSE", user, "{\"reversalDocId\":" + saved.getId() + "}");
        return saved;
    }

    private ProductionReworkDoc reverseRework(ProductionReworkDoc doc, String reason, String user) {
        ProductionReworkDoc rev = new ProductionReworkDoc();
        copyBaseForMirror(rev, doc);
        rev.setDocNumber(numbers.next("rework-document", "PER-RV"));
        rev.setReversedFromDocId(doc.getId());
        rev.setIsReversal(true);
        rev.setReversalReason(reason == null || reason.isBlank() ? "Correction transaction" : reason);
        rev.setReworkDate(doc.getReworkDate());
        if (doc.getLines() != null) {
            List<ProductionReworkLine> negated = new ArrayList<>();
            for (ProductionReworkLine l : doc.getLines()) {
                negated.add(ProductionReworkLine.builder()
                        .itemCode(l.getItemCode()).itemName(l.getItemName())
                        .quantity(l.getQuantity() != null ? l.getQuantity().negate() : null)
                        .uom(l.getUom())
                        .reasonCode(l.getReasonCode()).reasonDescription(l.getReasonDescription())
                        .sourceOperationCode(l.getSourceOperationCode())
                        .targetOperationCode(l.getTargetOperationCode())
                        .ncrNumber(l.getNcrNumber()).authorizationNumber(l.getAuthorizationNumber())
                        .batchNumber(l.getBatchNumber()).remarks(l.getRemarks())
                        .build());
            }
            rev.setLines(negated);
        }
        doc.setStatus("REVERSED");
        doc.setReversalReason(rev.getReversalReason());
        reworkDocs.save(doc);
        ProductionReworkDoc saved = reworkDocs.save(rev);
        audit(FAMILY_REWORK, doc, "REVERSE", user, "{\"reversalDocId\":" + saved.getId() + "}");
        return saved;
    }

    private void copyBaseForMirror(ProductionDispositionDocBase mirror, ProductionDispositionDocBase src) {
        mirror.setEntryId(src.getEntryId());
        mirror.setEntryNumber(src.getEntryNumber());
        mirror.setJobCardNumber(src.getJobCardNumber());
        mirror.setSubjobNumber(src.getSubjobNumber());
        mirror.setOperationCode(src.getOperationCode());
        mirror.setPartCode(src.getPartCode());
        mirror.setPartDescription(src.getPartDescription());
        mirror.setStatus("POSTED");
        mirror.setRemarks(src.getRemarks());
        mirror.setCreatedBy(src.getCreatedBy());
        mirror.setCreatedAt(Instant.now());
    }

    // ------------------------------------------------------------------
    // VALIDATION
    // ------------------------------------------------------------------

    private void preCreateBase(ProductionDispositionDocBase doc, String user) {
        if (doc.getEntryId() == null) {
            throw new IllegalArgumentException("entryId is mandatory for disposition documents.");
        }
        ProductionEntry entry = productionEntries.findById(doc.getEntryId())
                .orElseThrow(() -> new IllegalArgumentException(
                        "Disposition document references a Production Entry that does not exist: " + doc.getEntryId()));
        if (!"POSTED".equalsIgnoreCase(entry.getStatus()) || Boolean.TRUE.equals(entry.getIsReversal())) {
            throw new IllegalArgumentException(
                    "Disposition documents can only be created against a POSTED (non-reversed) Production Entry.");
        }
        doc.setEntryNumber(entry.getEntryNumber());
        if (blank(doc.getJobCardNumber())) doc.setJobCardNumber(entry.getJobCardNumber());
        if (blank(doc.getSubjobNumber())) doc.setSubjobNumber(entry.getSubjobNumber());
        if (blank(doc.getOperationCode())) doc.setOperationCode(entry.getOperationCode());
        if (blank(doc.getPartCode())) doc.setPartCode(entry.getPartCode());
        if (blank(doc.getPartDescription())) doc.setPartDescription(entry.getPartDescription());
        doc.setStatus("DRAFT");
        doc.setCreatedBy(user);
        doc.setCreatedAt(Instant.now());
        verifySubjobMapping(doc);
    }

    private void validateStructure(ProductionDispositionDocBase doc) {
        validateCommonHeader(doc);
    }

    private void validateCommonHeader(ProductionDispositionDocBase doc) {
        if (!blank(doc.getJobCardNumber())) {
            verifySubjobMapping(doc);
        }
    }

    private void verifySubjobMapping(ProductionDispositionDocBase doc) {
        if (blank(doc.getJobCardNumber()) || blank(doc.getOperationCode())) {
            return;
        }
        List<JobCardSubjob> subs = subjobs.findByJobCardJobCardNumber(doc.getJobCardNumber());
        boolean found = subs.stream().anyMatch(s -> doc.getOperationCode().equalsIgnoreCase(s.getOperationCode()));
        if (!found) {
            throw new IllegalArgumentException(
                    "No subjob matches operation code '" + doc.getOperationCode()
                            + "' on job card '" + doc.getJobCardNumber() + "' (CLAR-PROD-005 1:1).");
        }
    }

    private void validateRejectionPost(ProductionRejectionDoc doc) {
        ProductionEntry entry = requirePostedEntry(doc.getEntryId());
        List<ProductionRejectionLine> lines = doc.getLines();
        if (lines == null || lines.isEmpty()) {
            throw new IllegalArgumentException("At least one rejection line is required.");
        }
        BigDecimal total = BigDecimal.ZERO;
        BigDecimal bucket = entry.getRejectedQuantity() != null ? entry.getRejectedQuantity() : BigDecimal.ZERO;
        for (ProductionRejectionLine l : lines) {
            validateLine(l.getQuantity(), l.getItemCode(), l.getReasonCode(), l.getDisposition(),
                    REJECTION_DISPOSITIONS, l.getBatchNumber());
            total = total.add(l.getQuantity());
        }
        if (total.compareTo(bucket) > 0) {
            throw new IllegalArgumentException(
                    "Rejection quantity " + total + " exceeds the available rejected quantity "
                            + bucket + " on the referenced entry (CLAR-PROD-002 R1).");
        }
    }

    private void validateScrapPost(ProductionScrapDoc doc) {
        ProductionEntry entry = requirePostedEntry(doc.getEntryId());
        List<ProductionScrapLine> lines = doc.getLines();
        if (lines == null || lines.isEmpty()) {
            throw new IllegalArgumentException("At least one scrap line is required.");
        }
        BigDecimal total = BigDecimal.ZERO;
        BigDecimal bucket = entry.getScrapQuantity() != null ? entry.getScrapQuantity() : BigDecimal.ZERO;
        for (ProductionScrapLine l : lines) {
            validateLine(l.getQuantity(), l.getItemCode(), l.getReasonCode(), l.getDisposition(),
                    SCRAP_DISPOSITIONS, l.getBatchNumber());
            total = total.add(l.getQuantity());
        }
        if (total.compareTo(bucket) > 0) {
            throw new IllegalArgumentException(
                    "Scrap quantity " + total + " exceeds the available scrap quantity "
                            + bucket + " on the referenced entry.");
        }
    }

    private void validateReworkPost(ProductionReworkDoc doc) {
        ProductionEntry entry = requirePostedEntry(doc.getEntryId());
        List<ProductionReworkLine> lines = doc.getLines();
        if (lines == null || lines.isEmpty()) {
            throw new IllegalArgumentException("At least one rework line is required.");
        }
        BigDecimal total = BigDecimal.ZERO;
        BigDecimal bucket = entry.getReworkQuantity() != null ? entry.getReworkQuantity() : BigDecimal.ZERO;
        for (ProductionReworkLine l : lines) {
            validateLine(l.getQuantity(), l.getItemCode(), l.getReasonCode(), null,
                    null, l.getBatchNumber());
            if (blank(l.getTargetOperationCode())) {
                throw new IllegalArgumentException(
                        "Rework line requires a target (rework-route) operation code (CLAR-PROD-005).");
            }
            total = total.add(l.getQuantity());
        }
        if (total.compareTo(bucket) > 0) {
            throw new IllegalArgumentException(
                    "Rework quantity " + total + " exceeds the available rework quantity "
                            + bucket + " on the referenced entry.");
        }
    }

    // validation seams used by tests (package-private, same package as the unit tests)
    void validateForPost(ProductionRejectionDoc doc) {
        validateRejectionPost(doc);
    }

    void validateForPost(ProductionScrapDoc doc) {
        validateScrapPost(doc);
    }

    private ProductionEntry requirePostedEntry(Long entryId) {
        if (entryId == null) {
            throw new IllegalArgumentException("entryId is mandatory.");
        }
        ProductionEntry entry = productionEntries.findById(entryId)
                .orElseThrow(() -> new IllegalArgumentException(
                        "Disposition document references a Production Entry that does not exist: " + entryId));
        if (!"POSTED".equalsIgnoreCase(entry.getStatus()) || Boolean.TRUE.equals(entry.getIsReversal())) {
            throw new IllegalArgumentException(
                    "Disposition documents require a POSTED (non-reversed) Production Entry.");
        }
        return entry;
    }

    private void validateLine(BigDecimal quantity, String itemCode, String reasonCode,
                              String disposition, Set<String> allowedDispositions, String batchNumber) {
        if (quantity == null || quantity.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("Line quantity must be greater than zero.");
        }
        if (blank(itemCode)) {
            throw new IllegalArgumentException("Line item code is mandatory.");
        }
        if (blank(reasonCode)) {
            throw new IllegalArgumentException("Line reason is mandatory.");
        }
        if (allowedDispositions != null) {
            if (blank(disposition)) {
                throw new IllegalArgumentException("Line disposition is mandatory.");
            }
            if (!allowedDispositions.contains(disposition)) {
                throw new IllegalArgumentException(
                        "Unsupported disposition '" + disposition + "'. Allowed: " + allowedDispositions
                                + " (unknown disposition must never become FREE — D-C1).");
            }
        }
        if (batchRequired(itemCode) && blank(batchNumber)) {
            throw new IllegalArgumentException(
                    "Batch identity is mandatory for batch/lot-controlled item '" + itemCode + "' (CLAR-PROD-011).");
        }
    }

    private boolean batchRequired(String itemCode) {
        Optional<ItemMaster> item = items.findByCode(itemCode);
        if (item.isEmpty()) {
            throw new IllegalArgumentException("Item '" + itemCode + "' does not exist in the item master.");
        }
        // `batchControl` and `requiresBatch` are independently meaningful (either one alone
        // marks the item batch-controlled) — confirmed by ProductionBatchCardServiceTest's
        // deliberate batchControl=true/requiresBatch=false case; not safe to collapse to one.
        return Boolean.TRUE.equals(item.get().getBatchControl())
                || Boolean.TRUE.equals(item.get().getRequiresBatch());
    }

    private void guardTransition(String status, String action, String family) {
        switch (action.toLowerCase()) {
            case "submit":
                if (!"DRAFT".equals(status)) throw new IllegalArgumentException(
                        "Only DRAFT " + family + " documents can be submitted.");
                break;
            case "approve":
                if (!"SUBMITTED".equals(status)) throw new IllegalArgumentException(
                        "Only SUBMITTED " + family + " documents can be approved.");
                break;
            case "post":
                if ("REVERSED".equals(status) || "CANCELLED".equals(status)) throw new IllegalArgumentException(
                        "A " + (status == null ? "" : status) + " " + family + " document cannot be posted.");
                if ("POSTED".equals(status)) return;
                break;
            case "reverse":
                if (!"POSTED".equals(status)) throw new IllegalArgumentException(
                        "Only POSTED " + family + " documents can be reversed.");
                break;
            case "cancel":
                if (!PRE_POST_STATUSES.contains(status)) throw new IllegalArgumentException(
                        "Only pre-post " + family + " documents can be cancelled.");
                break;
            case "close":
                if (!"POSTED".equals(status)) throw new IllegalArgumentException(
                        "Only POSTED " + family + " documents can be closed.");
                break;
            default:
                throw new IllegalArgumentException("Unsupported action: " + action);
        }
    }

    private boolean isAlreadyProcessed(String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            return false;
        }
        try {
            return postingKeys.findByIdempotencyKey(idempotencyKey)
                    .filter(k -> "SUCCESS".equals(k.getResultStatus()))
                    .isPresent();
        } catch (Exception ex) {
            return false;
        }
    }

    private void saveIdempotencyKey(String key, String family, Long docId) {
        try {
            postingKeys.save(ProductionDocPostingKey.builder()
                    .idempotencyKey(key)
                    .docFamily(family)
                    .docId(docId)
                    .resultStatus("SUCCESS")
                    .createdAt(Instant.now())
                    .build());
        } catch (Exception ex) {
            log.warn("Idempotency key persist failed for key {}", key, ex);
        }
    }

    private void audit(String family, ProductionDispositionDocBase doc, String event, String user, String meta) {
        try {
            auditLogs.save(ProductionDispositionAuditLog.builder()
                    .docFamily(family)
                    .docId(doc.getId())
                    .docNumber(doc.getDocNumber())
                    .eventType(event)
                    .userId(user)
                    .timestamp(Instant.now())
                    .metadataJson(meta)
                    .build());
        } catch (Exception ex) {
            log.warn("Disposition audit log ({}) failed for doc {}", event, doc.getDocNumber(), ex);
        }
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}