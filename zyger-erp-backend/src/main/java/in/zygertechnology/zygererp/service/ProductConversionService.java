package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.ItemMaster;
import in.zygertechnology.zygererp.entity.ProductConversion;
import in.zygertechnology.zygererp.repo.ItemRepository;
import in.zygertechnology.zygererp.repo.ProductConversionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

/**
 * P13 — Product Conversion (CLAR-PROD-008 + Conversion numbering CV).
 *
 * <p>CLAR-PROD-008 boundary: Production records quantity + loss only; <b>Costing computes
 * conversion value</b> (CFL-PROD-008). This service performs <b>no</b> value/costing logic.
 * It validates the approved quantity model ({@code output + processLoss + scrap <= input},
 * {@code input > 0}, {@code output > 0}, losses >= 0), enforces the approved lifecycle via
 * {@link WorkflowStateMachine}, and posts the physical stock movement exclusively through
 * {@link InventoryIntegrationService} (input OUT / output IN with distinct idempotency keys),
 * never by writing {@code stock_ledger}/{@code stock_balance} directly.</p>
 *
 * <p>Numbering: CV prefix per DOC_57 §4 #15 via {@link DocNumberService} (honours the seeded
 * {@code numbering_config}); new numbers only, historical {@code PC-*} documents untouched.</p>
 */
@Service
@RequiredArgsConstructor
public class ProductConversionService {

    private final ProductConversionRepository conversions;
    private final DocNumberService numbers;
    private final WorkflowStateMachine stateMachine;
    private final InventoryIntegrationService inventory;
    private final ItemRepository items;
    private final in.zygertechnology.zygererp.repo.ProductionPolicyRepository productionPolicies;

    // ─── Create / Update / Delete ─────────────────────────────────────────

    @Transactional
    public ProductConversion create(ProductConversion pc, String user) {
        if (user == null || user.isBlank()) user = "system";
        validateQuantityModel(pc);
        validateBatches(pc);
        pc.setId(null);
        if (pc.getConversionNumber() == null || pc.getConversionNumber().isBlank()) {
            // DOC_57 §4 #15: CV-{PLANT}-{FY}-{SEQ} via numbering_config (config-aware path).
            long plantId = pc.getPlantId() != null ? pc.getPlantId() : 1L;
            pc.setConversionNumber(numbers.nextNumberFromConfig("product-conversion", plantId));
        }
        if (pc.getDocNo() == null) pc.setDocNo(pc.getConversionNumber());
        if (pc.getConversionDate() == null) pc.setConversionDate(Instant.now());
        pc.setInputQuantity(nz(pc.getInputQuantity()));
        pc.setOutputQuantity(nz(pc.getOutputQuantity()));
        pc.setProcessLossQty(nz(pc.getProcessLossQty()));
        pc.setScrapQty(nz(pc.getScrapQty()));
        if (pc.getStatus() == null) pc.setStatus("DRAFT");
        pc.setVersion(null);
        pc.setCreatedBy(user);
        pc.setCreatedAt(Instant.now());
        pc.setUpdatedBy(user);
        pc.setUpdatedAt(Instant.now());
        return conversions.save(pc);
    }

    @Transactional
    public ProductConversion update(Long id, ProductConversion pc, String user) {
        if (user == null || user.isBlank()) user = "system";
        ProductConversion existing = conversions.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Product Conversion not found: " + id));
        if (!"DRAFT".equals(existing.getStatus())) {
            throw new IllegalStateException("Only DRAFT conversions can be edited (current: " + existing.getStatus() + ")");
        }
        validateQuantityModel(pc);
        validateBatches(pc);
        pc.setId(id);
        pc.setConversionNumber(existing.getConversionNumber());
        pc.setDocNo(existing.getDocNo());
        pc.setStatus("DRAFT");
        pc.setCreatedBy(existing.getCreatedBy());
        pc.setCreatedAt(existing.getCreatedAt());
        pc.setUpdatedBy(user);
        pc.setUpdatedAt(Instant.now());
        return conversions.save(pc);
    }

    @Transactional
    public void delete(Long id) {
        ProductConversion e = conversions.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Product Conversion not found: " + id));
        if (!"DRAFT".equals(e.getStatus())) {
            throw new IllegalStateException("Only DRAFT conversions can be deleted (current: " + e.getStatus() + ")");
        }
        conversions.deleteById(id);
    }

    // ─── Workflow actions ─────────────────────────────────────────────────

    @Transactional
    public ProductConversion action(Long id, String action, String user) {
        if (user == null || user.isBlank()) user = "system";
        ProductConversion pc = conversions.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Product Conversion not found: " + id));

        String act = action == null ? "" : action.trim().toUpperCase();
        stateMachine.validateTransition("product-conversion", pc.getStatus(), act);

        switch (act) {
            case "SUBMIT":
                pc.setStatus("SUBMITTED");
                break;
            case "VERIFY":
                pc.setStatus("VERIFIED");
                break;
            case "REJECT":
                pc.setStatus("REJECTED");
                break;
            case "CANCEL":
                pc.setStatus("CANCELLED");
                break;
            case "POST":
                post(pc, user);
                break;
            default:
                throw new IllegalArgumentException("Unknown action: " + action);
        }
        pc.setUpdatedBy(user);
        pc.setUpdatedAt(Instant.now());
        return conversions.save(pc);
    }

    /**
     * POST — the only physical stock-movement point. Validates quantity + conservation + batch,
     * then posts input OUT and output IN atomically via {@link InventoryIntegrationService}
     * (distinct idempotency keys {@code {conversionNumber}-OUT} / {@code {conversionNumber}-IN}).
     */
    private void post(ProductConversion pc, String user) {
        validateQuantityModel(pc);
        validateBatches(pc);
        flagMaterialConsumptionVariance(pc);
        pc.setStatus("POSTED");

        String baseNo = pc.getConversionNumber();
        LocalDate tx = LocalDate.now();
        String src = pc.getSourceWarehouse() != null ? pc.getSourceWarehouse() : "MAIN";
        String dst = pc.getDestinationWarehouse() != null ? pc.getDestinationWarehouse() : "MAIN";

        if (nz(pc.getInputQuantity()).compareTo(BigDecimal.ZERO) > 0 && pc.getInputItemCode() != null) {
            inventory.consumeConversionInput(
                    baseNo + "-OUT", pc.getInputItemCode(), src, pc.getInputBatchNumber(),
                    pc.getInputQuantity(), tx, user);
        }
        if (nz(pc.getOutputQuantity()).compareTo(BigDecimal.ZERO) > 0 && pc.getOutputItemCode() != null) {
            inventory.receiveConversionOutput(
                    baseNo + "-IN", pc.getOutputItemCode(), dst, pc.getOutputBatchNumber(),
                    pc.getOutputQuantity(), tx, user);
        }
        // Production Module FRS §5.7 BR: chips/turnings by-product posts to a designated
        // scrap item as ordinary FREE stock (see the scrapItemCode field note) — skipped
        // entirely, as before, when no scrap item is configured on this conversion.
        if (nz(pc.getScrapQty()).compareTo(BigDecimal.ZERO) > 0 && pc.getScrapItemCode() != null && !pc.getScrapItemCode().isBlank()) {
            String scrapLoc = pc.getScrapLocation() != null && !pc.getScrapLocation().isBlank() ? pc.getScrapLocation() : dst;
            inventory.receiveConversionOutput(
                    baseNo + "-SCRAP", pc.getScrapItemCode(), scrapLoc, null,
                    pc.getScrapQty(), tx, user);
        }
    }

    // ─── Approved quantity contract (§11) ─────────────────────────────────

    /**
     * Approved quantity model: {@code input > 0}, {@code output > 0} (required output),
     * losses >= 0, and conservation {@code output + processLoss + scrap <= input}
     * (output+loss NEVER exceeds input).
     */
    void validateQuantityModel(ProductConversion pc) {
        BigDecimal input = nz(pc.getInputQuantity());
        BigDecimal output = nz(pc.getOutputQuantity());
        BigDecimal loss = nz(pc.getProcessLossQty());
        BigDecimal scrap = nz(pc.getScrapQty());

        if (input.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("Conversion input quantity must be > 0");
        }
        if (output.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("Conversion output quantity must be > 0");
        }
        if (loss.compareTo(BigDecimal.ZERO) < 0) {
            throw new IllegalArgumentException("Conversion process loss cannot be negative");
        }
        if (scrap.compareTo(BigDecimal.ZERO) < 0) {
            throw new IllegalArgumentException("Conversion scrap quantity cannot be negative");
        }
        BigDecimal produced = output.add(loss).add(scrap);
        if (produced.compareTo(input) > 0) {
            throw new IllegalArgumentException(
                    "Conversion output + loss + scrap (" + produced + ") cannot exceed input (" + input + ")");
        }
    }

    /**
     * CLAR-PROD-011 batch identity at conversion: batch/lot-controlled items must carry a batch.
     * Never silently generates a batch.
     */
    private void validateBatches(ProductConversion pc) {
        if (pc.getInputItemCode() != null && isControlled(pc.getInputItemCode())
                && blank(pc.getInputBatchNumber())) {
            throw new IllegalArgumentException(
                    "Input item " + pc.getInputItemCode() + " is batch/lot-controlled — input batch is mandatory at conversion (CLAR-PROD-011)");
        }
        if (pc.getOutputItemCode() != null && isControlled(pc.getOutputItemCode())
                && blank(pc.getOutputBatchNumber())) {
            throw new IllegalArgumentException(
                    "Output item " + pc.getOutputItemCode() + " is batch/lot-controlled — output batch is mandatory at conversion (CLAR-PROD-011)");
        }
    }

    /**
     * Production Module FRS §5.7 BR: flags (does not block) when actual raw-material
     * consumption (inputQuantity) exceeds the theoretical consumption — output qty x the
     * output item's Item Master standard weight — by more than the plant-wide
     * materialConsumptionTolerancePercent. Silently no-ops if the output item has no
     * recorded standard weight, since there is then nothing to compare against.
     */
    private void flagMaterialConsumptionVariance(ProductConversion pc) {
        pc.setTheoreticalConsumptionQty(null);
        pc.setMaterialVarianceFlagged(false);
        if (pc.getOutputItemCode() == null) return;
        ItemMaster outputItem = items.findByCode(pc.getOutputItemCode()).orElse(null);
        if (outputItem == null || outputItem.getWeight() == null) return;

        BigDecimal theoretical = nz(pc.getOutputQuantity()).multiply(outputItem.getWeight());
        pc.setTheoreticalConsumptionQty(theoretical);
        if (theoretical.compareTo(BigDecimal.ZERO) <= 0) return;

        in.zygertechnology.zygererp.entity.ProductionPolicy policy =
                productionPolicies.findFirstByActiveTrue().orElseGet(in.zygertechnology.zygererp.entity.ProductionPolicy::new);
        BigDecimal tolerancePct = policy.getMaterialConsumptionTolerancePercent() != null
                ? policy.getMaterialConsumptionTolerancePercent() : new BigDecimal("5.00");
        BigDecimal maxAllowed = theoretical.add(theoretical.multiply(tolerancePct).divide(new BigDecimal("100")));

        if (nz(pc.getInputQuantity()).compareTo(maxAllowed) > 0) {
            pc.setMaterialVarianceFlagged(true);
        }
    }

    private boolean isControlled(String itemCode) {
        ItemMaster item = items.findByCode(itemCode)
                .orElseThrow(() -> new IllegalArgumentException("Item '" + itemCode + "' does not exist in the item master"));
        // `batchControl` and `requiresBatch` are independently meaningful (either one alone
        // marks the item batch-controlled) — confirmed by ProductionBatchCardServiceTest's
        // deliberate batchControl=true/requiresBatch=false case; not safe to collapse to one.
        return Boolean.TRUE.equals(item.getBatchControl())
                || Boolean.TRUE.equals(item.getRequiresBatch());
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    private static BigDecimal nz(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}