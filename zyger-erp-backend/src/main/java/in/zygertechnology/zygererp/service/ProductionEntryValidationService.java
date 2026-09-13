package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class ProductionEntryValidationService {

    private final RouteSheetRepository routeSheetRepo;
    private final JobCardRepository jobCardRepo;
    private final JobCardSubjobRepository subjobRepo;
    private final MachineMasterRepository machineRepo;
    private final ProductionEntryRepository productionEntryRepo;
    private final ItemRepository itemRepo;

    public void validate(ProductionEntry entry) {
        List<String> errors = new ArrayList<>();

        // V-01: Mandatory Production Type
        if (entry.getProductionType() == null || entry.getProductionType().isBlank()) {
            errors.add("Production Type is mandatory.");
        }

        // V-02: Mandatory Supervisor
        if (entry.getSupervisorCode() == null || entry.getSupervisorCode().isBlank()) {
            errors.add("Supervisor is mandatory.");
        }

        // V-03: Mandatory Work Order / Job Card / Route Sheet operation context
        if ((entry.getJobCardNumber() == null || entry.getJobCardNumber().isBlank()) &&
            (entry.getWorkOrderNumber() == null || entry.getWorkOrderNumber().isBlank())) {
            errors.add("Route Sheet operation context is mandatory.");
        }

        // V-04: Mandatory Process / Operation
        if (entry.getOperationCode() == null || entry.getOperationCode().isBlank()) {
            errors.add("Process is mandatory.");
        }

        // V-05: Range - Process Qty > 0
        BigDecimal processQty = entry.getProcessQty() != null ? entry.getProcessQty()
                : (entry.getProducedQuantity() != null ? entry.getProducedQuantity() : BigDecimal.ZERO);
        if (processQty.compareTo(BigDecimal.ZERO) <= 0) {
            errors.add("Process quantity must be greater than zero.");
        }

        // V-07: Logic - Accepted + Rejected + Rework <= Process Qty
        BigDecimal good = entry.getGoodQuantity() != null ? entry.getGoodQuantity() : BigDecimal.ZERO;
        BigDecimal rework = entry.getReworkQuantity() != null ? entry.getReworkQuantity() : BigDecimal.ZERO;
        BigDecimal rejected = entry.getRejectedQuantity() != null ? entry.getRejectedQuantity() : BigDecimal.ZERO;
        BigDecimal scrap = entry.getScrapQuantity() != null ? entry.getScrapQuantity() : BigDecimal.ZERO;
        BigDecimal allocatedSum = good.add(rework).add(rejected).add(scrap);

        if (allocatedSum.compareTo(processQty) > 0) {
            errors.add("Accepted, rejected and rework quantities cannot exceed process quantity.");
        }

        // V-08 & V-10: Mandatory Rejection Reason & Quantity Balance
        if (rejected.compareTo(BigDecimal.ZERO) > 0) {
            if (entry.getRejectionReasons() == null || entry.getRejectionReasons().isEmpty()) {
                errors.add("Rejection reason is mandatory.");
            } else {
                BigDecimal reasonTotal = entry.getRejectionReasons().stream()
                        .map(r -> r.getQuantity() != null ? r.getQuantity() : BigDecimal.ZERO)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
                if (reasonTotal.compareTo(rejected) != 0) {
                    errors.add("Reason-wise rejection quantity must equal rejected quantity.");
                }
            }
        }

        // V-09: Mandatory Rework Reason
        if (rework.compareTo(BigDecimal.ZERO) > 0) {
            if (entry.getReworkReasons() == null || entry.getReworkReasons().isEmpty()) {
                errors.add("Rework reason is mandatory.");
            }
        }

        // V-11: End time cannot be earlier than Start time
        if (entry.getStartTime() != null && entry.getEndTime() != null) {
            if (entry.getEndTime().isBefore(entry.getStartTime())) {
                errors.add("End time cannot be earlier than start time.");
            } else {
                // Calculate elapsed minutes
                long elapsedMins = Duration.between(entry.getStartTime(), entry.getEndTime()).toMinutes();
                BigDecimal idleMins = entry.getIdleTime() != null ? entry.getIdleTime() : BigDecimal.ZERO;

                // V-12: Idle time cannot exceed elapsed time
                if (idleMins.compareTo(BigDecimal.valueOf(elapsedMins)) > 0) {
                    errors.add("Idle time cannot exceed operation elapsed time.");
                }

                // V-13: Mandatory Idle Reason when Idle Time > 0
                if (idleMins.compareTo(BigDecimal.ZERO) > 0 && (entry.getIdleReason() == null || entry.getIdleReason().isBlank())) {
                    errors.add("Idle reason is mandatory.");
                }
            }
        }

        // V-15 & V-16: Machine validation
        if (entry.getMachineCode() != null && !entry.getMachineCode().isBlank()) {
            if (!machineRepo.existsByCode(entry.getMachineCode())) {
                errors.add("Selected machine is inactive or does not exist.");
            }
        }

        // V-19: Inventory Consumption Check
        if (entry.getMaterials() != null) {
            for (ProductionEntryMaterial mat : entry.getMaterials()) {
                BigDecimal consumed = mat.getConsumedQty() != null ? mat.getConsumedQty() : BigDecimal.ZERO;
                BigDecimal available = mat.getAvailableQty() != null ? mat.getAvailableQty() : BigDecimal.ZERO;
                if (consumed.compareTo(available) > 0) {
                    errors.add("Consumed quantity for RM '" + mat.getRmCode() + "' exceeds available quantity.");
                }
            }
        }

        // V-20: Batch Allocation Check
        if (entry.getBatchAllocations() != null && !entry.getBatchAllocations().isEmpty()) {
            BigDecimal allocatedBatchTotal = entry.getBatchAllocations().stream()
                    .map(b -> b.getAllocatedQty() != null ? b.getAllocatedQty() : BigDecimal.ZERO)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            if (allocatedBatchTotal.compareTo(good) != 0 && allocatedBatchTotal.compareTo(processQty) != 0) {
                errors.add("Batch allocation is incomplete.");
            }
        }

        validateAdditionalOutputs(entry, errors);

        if (!errors.isEmpty()) {
            throw new IllegalArgumentException(String.join(" ", errors));
        }
    }

    /**
     * P8 Capability A — Additional (co/by-product) output validation
     * (FR-PROD-ENTRY-003, BK-013, DOCUMENT_58 §8). Additive rule set; a single-output
     * entry with no additional outputs is unaffected.
     *
     * <p>Co/by-product rows are RECORDING-ONLY facts: they enter NO principal contract
     * (WIP/pending/produced), so no upper bound is imposed against process_qty — the
     * committed V-07 reconciliation covers the PRIMARY stage quantities only, and no
     * approved decision binds co/by-product yield to the primary input. This boundary is
     * documented in DOCUMENT_58 as an open business question, not silently decided.</p>
     */
    private void validateAdditionalOutputs(ProductionEntry entry, List<String> errors) {
        List<ProductionEntryOutput> outputs = entry.getAdditionalOutputs();
        if (outputs == null || outputs.isEmpty()) {
            return;
        }
        Set<String> seen = new HashSet<>();
        for (ProductionEntryOutput o : outputs) {
            if (o == null) {
                errors.add("Additional output line cannot be empty.");
                continue;
            }
            String type = o.getOutputType();
            if (type == null || type.isBlank()) {
                errors.add("Additional output type is mandatory (CO_PRODUCT or BY_PRODUCT).");
            } else if (!"CO_PRODUCT".equals(type) && !"BY_PRODUCT".equals(type)) {
                errors.add("Additional output type must be CO_PRODUCT or BY_PRODUCT.");
            }

            String itemCode = o.getItemCode();
            if (itemCode == null || itemCode.isBlank()) {
                errors.add("Additional output item code is mandatory.");
            } else if (!itemRepo.existsByCode(itemCode)) {
                errors.add("Additional output item '" + itemCode + "' does not exist in the item master.");
            }

            String location = o.getLocation();
            if (location == null || location.isBlank()) {
                errors.add("Additional output location is mandatory.");
            }

            BigDecimal qty = o.getQuantity();
            if (qty == null) {
                errors.add("Additional output quantity is mandatory.");
            } else if (qty.signum() <= 0) {
                errors.add("Additional output quantity must be greater than zero.");
            }

            BigDecimal weight = o.getWeight();
            if (weight != null && weight.signum() < 0) {
                errors.add("Additional output weight cannot be negative.");
            }

            if (type != null && itemCode != null && location != null) {
                String key = type + "|" + itemCode + "|" + location;
                if (!seen.add(key)) {
                    errors.add("Duplicate additional output (" + type + ", " + itemCode + ", " + location + ") is not allowed.");
                }
            }
        }
    }

    /**
     * Production Module FRS §5.3 BR (audit gap): "Start of a new job on a machine
     * automatically closes/pauses any previously open job card entry on that machine,
     * preventing overlapping active entries" — nothing enforced this at all before. This
     * takes the simpler, safer half of that rule: block the second overlapping start rather
     * than silently auto-closing someone else's still-running entry out from under them.
     */
    public void validateMachineNotAlreadyRunning(ProductionEntry entry) {
        if (entry.getMachineCode() == null || entry.getMachineCode().isBlank()) return;
        if (entry.getStartTime() == null || entry.getEndTime() != null) return;

        Long excludeId = entry.getId() != null ? entry.getId() : -1L;
        List<ProductionEntry> open = productionEntryRepo.findOpenByMachineCode(entry.getMachineCode(), excludeId);
        if (!open.isEmpty()) {
            ProductionEntry other = open.get(0);
            throw new IllegalStateException("Machine " + entry.getMachineCode()
                    + " already has a running entry (" + (other.getEntryNumber() != null ? other.getEntryNumber() : other.getId())
                    + "). End or pause it before starting another.");
        }
    }

    public void validateSequenceAndPending(ProductionEntry entry) {
        if (entry.getJobCardNumber() == null || entry.getJobCardNumber().isBlank()) return;

        List<JobCardSubjob> subjobs = new ArrayList<>(subjobRepo.findByJobCardJobCardNumber(entry.getJobCardNumber()));
        if (subjobs.isEmpty()) return;

        // Sort subjobs by sequence_no
        subjobs.sort((a, b) -> Integer.compare(
            a.getSequenceNo() != null ? a.getSequenceNo() : 0,
            b.getSequenceNo() != null ? b.getSequenceNo() : 0
        ));

        // Find matching subjob for this operation
        JobCardSubjob currentSubjob = subjobs.stream()
            .filter(s -> entry.getOperationCode() != null && entry.getOperationCode().equalsIgnoreCase(s.getOperationCode()))
            .findFirst().orElse(null);

        if (currentSubjob == null) return;

        // V-17: Pending Sequence Only check
        if (Boolean.TRUE.equals(entry.getPendingSequenceOnly())) {
            for (JobCardSubjob s : subjobs) {
                if (s.getSequenceNo() < currentSubjob.getSequenceNo()) {
                    if (!"COMPLETED".equalsIgnoreCase(s.getStatus()) && !"POSTED".equalsIgnoreCase(s.getStatus())) {
                        throw new IllegalArgumentException("This process is not currently eligible according to the Route Sheet sequence. Prerequisite operation '" + s.getOperationCode() + "' is pending.");
                    }
                }
            }
        }

        // V-06 & V-18: Process Qty cannot exceed eligible pending quantity (considering draft soft-reservations §5.2)
        BigDecimal planned = currentSubjob.getPlannedQuantity() != null ? currentSubjob.getPlannedQuantity() : BigDecimal.ZERO;
        BigDecimal existingCompleted = currentSubjob.getCompletedQuantity() != null ? currentSubjob.getCompletedQuantity() : BigDecimal.ZERO;

        // Compute quantity staged in other open DRAFT entries
        BigDecimal otherDraftsQty = BigDecimal.ZERO;
        List<ProductionEntry> openDrafts = productionEntryRepo.findByJobCardNumberAndOperationCodeAndStatus(
                entry.getJobCardNumber(), entry.getOperationCode(), "DRAFT");
        if (openDrafts != null) {
            otherDraftsQty = openDrafts.stream()
                    .filter(d -> entry.getId() == null || !d.getId().equals(entry.getId()))
                    .map(d -> d.getProcessQty() != null ? d.getProcessQty() : (d.getProducedQuantity() != null ? d.getProducedQuantity() : BigDecimal.ZERO))
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
        }

        BigDecimal remainingPending = planned.subtract(existingCompleted).subtract(otherDraftsQty);
        if (remainingPending.compareTo(BigDecimal.ZERO) < 0) remainingPending = BigDecimal.ZERO;

        BigDecimal processQty = entry.getProcessQty() != null ? entry.getProcessQty()
                : (entry.getProducedQuantity() != null ? entry.getProducedQuantity() : BigDecimal.ZERO);

        if (processQty.compareTo(remainingPending) > 0) {
            // Production Module FRS §5.3 BR: cumulative Good+Rejected+Rework cannot exceed
            // Planned Qty without a supervisor override + mandatory reason — this used to be
            // an unconditional hard block with no such path at all.
            String overrideReason = entry.getOverrideReason();
            boolean authorized = overrideReason != null && !overrideReason.isBlank()
                    && in.zygertechnology.zygererp.security.CurrentUserRoles.hasAnyRole(
                            "ADMIN", "PRODUCTION_SUPERVISOR", "PLANT_HEAD");
            if (!authorized) {
                throw new in.zygertechnology.zygererp.config.BusinessRuleException("OVERPRODUCTION_LIMIT",
                        "Entered quantity (" + processQty + ") exceeds the available pending quantity ("
                                + remainingPending + "). A Production Supervisor/Plant Head can override this with a reason.",
                        java.util.Map.of("processQty", processQty, "remainingPending", remainingPending));
            }
        }
    }
}
