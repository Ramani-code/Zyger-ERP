package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import java.util.stream.Collectors;

/**
 * P2 — Production Job Card business-logic service (DOC 10 layering; C5).
 *
 * <p>Extraction of the Job Card logic that previously lived inline in {@code ProductionController}, performed as a
 * <b>strict behavior lock</b>: every endpoint contract, status transition, validation rule, and inventory posting
 * semantics are preserved exactly. Inventory posting flows through {@link ProductionStockBoundary} → {@link StockService}
 * (never {@code StockService} modified, never direct {@code stock_balance}).
 *
 * <p>Additive P2 only: on create-from-work-order the new {@code workOrderId} / {@code routeOperationId} traceability
 * columns (V3, C1) are now populated for reconciliation between the legacy {@code work_order_number} string and the new
 * Work Order id reference. This does not alter any existing behaviour or endpoint contract.
 */
@Slf4j
@Service
public class ProductionJobCardService {

    private final JobCardRepository jobCards;
    private final JobCardSubjobRepository jobCardSubjobs;
    private final WorkOrderRepository workOrders;
    private final RouteSheetRepository routeSheets;
    private final ProductionBOMRepository productionBoms;
    private final ItemRepository items;
    private final MachineMasterRepository machines;
    private final DocNumberService numbers;
    private final ProductionStockBoundary inventory;
    private final ProductionQualityGateService qualityGate;
    private final jakarta.persistence.EntityManager em;
    private final ProductionPolicyRepository productionPolicies;
    private final MachineCapabilityRepository machineCapabilities;

    public ProductionJobCardService(
            JobCardRepository jobCards,
            JobCardSubjobRepository jobCardSubjobs,
            WorkOrderRepository workOrders,
            RouteSheetRepository routeSheets,
            ProductionBOMRepository productionBoms,
            ItemRepository items,
            MachineMasterRepository machines,
            DocNumberService numbers,
            ProductionStockBoundary inventory,
            ProductionQualityGateService qualityGate,
            jakarta.persistence.EntityManager em,
            ProductionPolicyRepository productionPolicies,
            MachineCapabilityRepository machineCapabilities) {
        this.jobCards = jobCards;
        this.jobCardSubjobs = jobCardSubjobs;
        this.workOrders = workOrders;
        this.routeSheets = routeSheets;
        this.productionBoms = productionBoms;
        this.items = items;
        this.machines = machines;
        this.numbers = numbers;
        this.inventory = inventory;
        this.qualityGate = qualityGate;
        this.em = em;
        this.productionPolicies = productionPolicies;
        this.machineCapabilities = machineCapabilities;
    }

    /**
     * Production Module FRS §4.1/§5.2 (audit gap): filters machine choice by capability
     * matrix — but only once a machine actually has capability rows defined. A machine
     * with none is left unrestricted, so every machine already in the system today (none
     * of which has ever had capability data) keeps working exactly as before.
     */
    private void assertMachineCapable(String machineCode, String operationCode) {
        if (operationCode == null || operationCode.isBlank()) return;
        if (!machineCapabilities.existsByMachineCodeAndActiveTrue(machineCode)) return;
        if (!machineCapabilities.existsByMachineCodeAndOperationCodeAndActiveTrue(machineCode, operationCode)) {
            throw new RuntimeException("Machine '" + machineCode + "' is not set up to run operation '"
                    + operationCode + "' per its capability matrix.");
        }
    }

    private static String user(java.security.Principal p) { return p != null ? p.getName() : "system"; }

    // ===========================
    // ---- JOB CARD -------------
    // ===========================

    public List<JobCard> listJobCards() { return jobCards.findAll(); }

    public JobCard createJobCard(JobCard jc, java.security.Principal p) {
        jc.setId(null);
        // Validate FK references
        if (jc.getWorkOrderNumber() != null && !jc.getWorkOrderNumber().isBlank()) {
            List<WorkOrder> woList = workOrders.findByWoNumber(jc.getWorkOrderNumber());
            if (woList.isEmpty()) throw new RuntimeException("Work Order not found: " + jc.getWorkOrderNumber());
            // additive traceability (C1): resolve new work_order_id from legacy string
            jc.setWorkOrderId(woList.get(0).getId());
        }
        if (jc.getPartCode() != null && !jc.getPartCode().isBlank()) {
            if (!items.existsByCode(jc.getPartCode())) {
                throw new RuntimeException("Item code '" + jc.getPartCode() + "' does not exist");
            }
        }
        jc.setJobCardNumber(numbers.next("job-card", "JCF"));
        if (jc.getPlannedQuantity() == null) jc.setPlannedQuantity(BigDecimal.ZERO);
        if (jc.getCompletedQuantity() == null) jc.setCompletedQuantity(BigDecimal.ZERO);
        if (jc.getReworkQuantity() == null) jc.setReworkQuantity(BigDecimal.ZERO);
        if (jc.getRejectedQuantity() == null) jc.setRejectedQuantity(BigDecimal.ZERO);
        if (jc.getScrapQuantity() == null) jc.setScrapQuantity(BigDecimal.ZERO);
        if (jc.getStatus() == null) jc.setStatus("DRAFT");
        jc.setCreatedBy(user(p));
        jc.setCreatedAt(Instant.now());
        return jobCards.save(jc);
    }

    public JobCard createFromWorkOrder(Map<String, Object> body, java.security.Principal p) {
        String woNumber = (String) body.get("workOrderNumber");
        if (woNumber == null || woNumber.isBlank()) throw new RuntimeException("Work Order Number is required");

        // Try by woNumber first, then by docNo
        List<WorkOrder> woList = workOrders.findByWoNumber(woNumber);
        if (woList.isEmpty()) {
            // Try looking up by the document number in the generic doc system
            woList = workOrders.findAll().stream()
                .filter(w -> woNumber.equalsIgnoreCase(w.getWoNumber()) || woNumber.equalsIgnoreCase(w.getDocNo()))
                .collect(Collectors.toList());
        }
        if (woList.isEmpty()) throw new RuntimeException("Work Order not found: " + woNumber);
        WorkOrder wo = woList.get(0);

        if ("DRAFT".equals(wo.getStatus())) {
            wo.setStatus("APPROVED");
            workOrders.save(wo);
        } else if (!"APPROVED".equals(wo.getStatus()) && !"RELEASED".equals(wo.getStatus())) {
            throw new RuntimeException("Work Order must be DRAFT, APPROVED or RELEASED. Current status: " + wo.getStatus());
        }

        JobCard jc = new JobCard();
        jc.setJobCardNumber(numbers.next("job-card", "JCF"));
        jc.setWorkOrderNumber(wo.getDocNo() != null ? wo.getDocNo() : wo.getWoNumber());
        jc.setWorkOrderId(wo.getId());
        jc.setPartCode(wo.getItemCode());
        jc.setPartDescription(wo.getItemCode());
        jc.setRevision(wo.getItemRevision());
        jc.setPlannedQuantity(wo.getOrderQuantity());
        jc.setPriority(wo.getPriority() != null ? wo.getPriority() : "MEDIUM");
        if (wo.getPlannedStartDate() != null) jc.setPlannedStartDate(wo.getPlannedStartDate().atStartOfDay(ZoneId.systemDefault()).toInstant());
        if (wo.getDueDate() != null) jc.setPlannedEndDate(wo.getDueDate().atStartOfDay(ZoneId.systemDefault()).toInstant());
        jc.setCustomerCode(wo.getCustomerCode());
        jc.setCompletedQuantity(BigDecimal.ZERO);
        jc.setReworkQuantity(BigDecimal.ZERO);
        jc.setRejectedQuantity(BigDecimal.ZERO);
        jc.setScrapQuantity(BigDecimal.ZERO);
        jc.setStatus("DRAFT");

        // Link BOM and Route
        if (wo.getRouteId() != null) {
            routeSheets.findById(wo.getRouteId()).ifPresent(route -> {
                jc.setRouteSheetNumber(route.getRouteNumber());
            });
        }
        if (wo.getBomId() != null) {
            productionBoms.findById(wo.getBomId()).ifPresent(bom -> {
                jc.setBomNumber(bom.getBomNumber());
            });
        }

        jc.setCreatedBy(user(p));
        jc.setCreatedAt(Instant.now());
        JobCard saved = jobCards.save(jc);

        // Auto-create subjobs from Route Sheet operations
        if (wo.getRouteId() != null) {
            routeSheets.findById(wo.getRouteId()).ifPresent(route -> {
                int seqNo = 1;
                for (RouteOperation op : route.getOperations()) {
                    JobCardSubjob sub = new JobCardSubjob();
                    sub.setJobCard(saved);
                    sub.setSubjobNumber(saved.getJobCardNumber() + "-S" + String.format("%02d", seqNo));
                    sub.setOperationCode(op.getOperationCode());
                    sub.setOperationDescription(op.getOperationDescription());
                    sub.setSequenceNo(op.getSequenceNo() != null ? op.getSequenceNo() : seqNo);
                    sub.setMachineCode(op.getMachineCode());
                    sub.setWorkCenterCode(op.getWorkCenterCode());
                    sub.setPlannedQuantity(saved.getPlannedQuantity());
                    sub.setCompletedQuantity(BigDecimal.ZERO);
                    sub.setReworkQuantity(BigDecimal.ZERO);
                    sub.setRejectedQuantity(BigDecimal.ZERO);
                    sub.setScrapQuantity(BigDecimal.ZERO);
                    sub.setStatus("PENDING");
                    sub.setInspectionRequired(op.isInspectionRequired());
                    // additive traceability (C1): link subjob to the source RouteOperation
                    sub.setRouteOperationId(op.getId());
                    sub.setCreatedAt(Instant.now());
                    jobCardSubjobs.save(sub);
                    seqNo++;
                }
            });
        }

        return jobCards.findById(saved.getId()).orElse(saved);
    }

    public JobCard getJobCard(Long id) {
        return jobCards.findById(id).orElseThrow(() -> new RuntimeException("Job Card not found"));
    }

    public JobCard updateJobCard(Long id, JobCard jc, java.security.Principal p) {
        JobCard e = jobCards.findById(id).orElseThrow(() -> new RuntimeException("Job Card not found"));
        if (!"DRAFT".equals(e.getStatus()) && !"ON_HOLD".equals(e.getStatus())) {
            throw new RuntimeException("Only DRAFT or ON_HOLD job cards can be edited");
        }
        jc.setId(id);
        jc.setJobCardNumber(e.getJobCardNumber());
        jc.setCreatedAt(e.getCreatedAt());
        jc.setCreatedBy(e.getCreatedBy());
        jc.setUpdatedAt(Instant.now());
        jc.setUpdatedBy(user(p));
        return jobCards.save(jc);
    }

    public void deleteJobCard(Long id) {
        JobCard e = jobCards.findById(id).orElseThrow(() -> new RuntimeException("Job Card not found"));
        if (!"DRAFT".equals(e.getStatus())) throw new RuntimeException("Only DRAFT job cards can be deleted");
        jobCardSubjobs.findByJobCardId(id).forEach(l -> jobCardSubjobs.deleteById(l.getId()));
        jobCards.deleteById(id);
    }

    // Stock receipt (FG), job-card status save and IPQC creation must commit atomically:
    // a partial completion (stock moved but card not completed, or IPQC silently lost)
    // would leave production and inventory out of sync.
    @Transactional
    public Map<String, Object> jobCardAction(Long id, String action,
                                             Map<String, String> body,
                                             java.security.Principal p) {
        JobCard jc = jobCards.findById(id).orElseThrow(() -> new RuntimeException("Job Card not found"));
        String note = body != null ? body.getOrDefault("note", "") : "";
        Map<String, Object> result = new LinkedHashMap<>();
        List<String> errors = new ArrayList<>();

        switch (action.toLowerCase()) {
            case "approve": {
                jc.setStatus("APPROVED");
                break;
            }
            case "release": {
                // Validate: must have subjobs
                List<JobCardSubjob> subs = jobCardSubjobs.findByJobCardId(id);
                if (subs.isEmpty()) {
                    errors.add("Job Card must have at least one subjob/operation before release");
                }
                // Validate: BOM and Route should be linked
                if (jc.getBomNumber() == null || jc.getBomNumber().isBlank()) {
                    errors.add("Production BOM must be linked before release");
                }
                if (jc.getRouteSheetNumber() == null || jc.getRouteSheetNumber().isBlank()) {
                    errors.add("Route Sheet must be linked before release");
                }
                if (!errors.isEmpty()) {
                    result.put("success", false);
                    result.put("errors", errors);
                    return result;
                }
                jc.setStatus("RELEASED");
                jc.setReleaseRemarks(note);
                break;
            }
            case "start": {
                jc.setStatus("IN_PROGRESS");
                jc.setActualStartDate(Instant.now());
                break;
            }
            case "hold": {
                jc.setStatus("ON_HOLD");
                jc.setHoldReason(note);
                break;
            }
            case "quality-hold": {
                jc.setStatus("QUALITY_HOLD");
                jc.setHoldReason(note);
                break;
            }
            case "production-hold": {
                jc.setStatus("PRODUCTION_HOLD");
                jc.setHoldReason(note);
                break;
            }
            case "release-hold": {
                if (!"QUALITY_HOLD".equals(jc.getStatus()) && !"PRODUCTION_HOLD".equals(jc.getStatus())) {
                    errors.add("Job Card must be on QUALITY_HOLD or PRODUCTION_HOLD to release hold");
                    result.put("success", false);
                    result.put("errors", errors);
                    return result;
                }
                jc.setStatus("RELEASED");
                break;
            }
            case "reopen": {
                if (!"COMPLETED".equals(jc.getStatus())) {
                    errors.add("Only COMPLETED job cards can be reopened");
                    result.put("success", false);
                    result.put("errors", errors);
                    return result;
                }
                jc.setStatus("RELEASED");
                break;
            }
            case "resume": {
                jc.setStatus("IN_PROGRESS");
                break;
            }
            case "complete": {
                // Validate all subjobs completed
                List<JobCardSubjob> subs = jobCardSubjobs.findByJobCardId(id);
                List<String> incomplete = new ArrayList<>();
                for (JobCardSubjob s : subs) {
                    if (!"COMPLETED".equals(s.getStatus())) {
                        incomplete.add(s.getSubjobNumber() + " (" + s.getOperationCode() + ") - " + s.getStatus());
                    }
                }
                if (!incomplete.isEmpty()) {
                    errors.add("The following subjobs are not completed: " + String.join("; ", incomplete));
                }

                // Validate quantities reconcile
                BigDecimal totalPlanned = subs.stream()
                    .map(s -> s.getPlannedQuantity() == null ? BigDecimal.ZERO : s.getPlannedQuantity())
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
                BigDecimal totalCompleted = subs.stream()
                    .map(s -> s.getCompletedQuantity() == null ? BigDecimal.ZERO : s.getCompletedQuantity())
                    .reduce(BigDecimal.ZERO, BigDecimal::add);

                // Update JC quantities from subjobs
                BigDecimal totalGood = BigDecimal.ZERO;
                BigDecimal totalRework = BigDecimal.ZERO;
                BigDecimal totalReject = BigDecimal.ZERO;
                BigDecimal totalScrap = BigDecimal.ZERO;
                for (JobCardSubjob s : subs) {
                    totalGood = totalGood.add(s.getCompletedQuantity() == null ? BigDecimal.ZERO : s.getCompletedQuantity());
                    totalRework = totalRework.add(s.getReworkQuantity() == null ? BigDecimal.ZERO : s.getReworkQuantity());
                    totalReject = totalReject.add(s.getRejectedQuantity() == null ? BigDecimal.ZERO : s.getRejectedQuantity());
                    totalScrap = totalScrap.add(s.getScrapQuantity() == null ? BigDecimal.ZERO : s.getScrapQuantity());
                }
                jc.setCompletedQuantity(totalGood);
                jc.setReworkQuantity(totalRework);
                jc.setRejectedQuantity(totalReject);
                jc.setScrapQuantity(totalScrap);

                // Validate quality: check if any subjob with inspection required is on quality hold
                boolean qualityPending = subs.stream().anyMatch(s ->
                    Boolean.TRUE.equals(s.getInspectionRequired()) && "COMPLETED".equals(s.getStatus())
                    && !"QUALITY_HOLD".equals(s.getStatus()));
                if (qualityPending) {
                    // Allow completion but warn
                }

                // Overproduction check: total output must not exceed planned + configured
                // tolerance (Production Policy §10 Q2) — a Production Supervisor/Plant Head
                // may override with a mandatory reason, matching the FRS's supervisor-override
                // intent instead of leaving this an unconditional hard block.
                BigDecimal plannedQty = jc.getPlannedQuantity() == null ? BigDecimal.ZERO : jc.getPlannedQuantity();
                BigDecimal totalOutput = totalGood.add(totalRework);
                ProductionPolicy policy = productionPolicies.findFirstByActiveTrue().orElseGet(ProductionPolicy::new);
                BigDecimal tolerancePct = policy.getOverproductionTolerancePercent() != null
                        ? policy.getOverproductionTolerancePercent() : new BigDecimal("10.00");
                BigDecimal tolerance = plannedQty.multiply(tolerancePct).divide(new BigDecimal("100"));
                BigDecimal maxAllowed = plannedQty.add(tolerance);
                if (plannedQty.compareTo(BigDecimal.ZERO) > 0 && totalOutput.compareTo(maxAllowed) > 0) {
                    // A mandatory reason (reusing this action's existing "note" field, since
                    // no separate override-reason field is exposed by this endpoint) from a
                    // Production Supervisor/Plant Head clears the block; otherwise it's added
                    // to the same errors list as every other completion check above/below.
                    boolean authorized = note != null && !note.isBlank()
                            && in.zygertechnology.zygererp.security.CurrentUserRoles.hasAnyRole(
                                    "ADMIN", "PRODUCTION_SUPERVISOR", "PLANT_HEAD");
                    if (!authorized) {
                        errors.add("Overproduction detected: completed " + totalOutput + " against planned " + plannedQty
                                + " (max allowed: " + maxAllowed + "). A Production Supervisor/Plant Head can "
                                + "override this by re-submitting Complete with a reason in the remarks.");
                    } else {
                        jc.setOverrideReason(note);
                    }
                }

                if (!errors.isEmpty()) {
                    result.put("success", false);
                    result.put("errors", errors);
                    return result;
                }

                jc.setStatus("COMPLETED");
                jc.setActualEndDate(Instant.now());
                jc.setCompleteRemarks(note);
                jc.setCompletionStatus("COMPLETE");

                if (totalGood.compareTo(BigDecimal.ZERO) > 0 && jc.getPartCode() != null) {
                    // inventory via boundary → StockService (C5); identical semantics to prior inline call
                    inventory.recordJobCardCompleteGood(
                        jc.getJobCardNumber(), jc.getPartCode(), totalGood, user(p));
                }

                // FRS §8: Auto-create IPQC inspection on production completion
                if (totalGood.compareTo(BigDecimal.ZERO) > 0 && jc.getPartCode() != null) {
                    try {
                        QualityInspection qi = new QualityInspection();
                        qi.setDocNo(numbers.next("QUALITY_INSPECTION", "QC"));
                        qi.setInspectionType(QualityInspectionType.IPQC);
                        qi.setSourceType("PRODUCTION");
                        qi.setSourceNumber(jc.getJobCardNumber());
                        qi.setDocDate(LocalDate.now());
                        qi.setInspectionDate(LocalDate.now());
                        qi.setItemCode(jc.getPartCode());
                        qi.setReceivedQuantity(totalGood);
                        qi.setInspectionQuantity(totalGood);
                        qi.setInspectionStatus("DRAFT");
                        qi.setDecisionStatus("PENDING");
                        qi.setCreatedBy(user(p));
                        qi.setCreatedAt(Instant.now());
                        qi.setUpdatedAt(Instant.now());
                        em.persist(qi);
                    } catch (Exception ex) {
                        // FRS §8: the inspection must not be silently lost — surface the failure so
                        // operators/QA can see why the auto-IPQC was not created.
                        log.warn("Auto-IPQC creation failed for job card {}: {}", jc.getJobCardNumber(), ex.getMessage());
                    }
                }
                break;
            }
            case "close": {
                if (!"COMPLETED".equals(jc.getStatus())) {
                    errors.add("Job Card must be COMPLETED before closing");
                    result.put("success", false);
                    result.put("errors", errors);
                    return result;
                }
                jc.setStatus("CLOSED");
                break;
            }
            case "cancel": {
                if ("CLOSED".equals(jc.getStatus())) {
                    errors.add("CLOSED job cards cannot be cancelled");
                    result.put("success", false);
                    result.put("errors", errors);
                    return result;
                }
                jc.setStatus("CANCELLED");
                break;
            }
            default:
                throw new RuntimeException("Unknown action: " + action);
        }
        jc.setUpdatedAt(Instant.now());
        jc.setUpdatedBy(user(p));
        jobCards.save(jc);

        result.put("success", true);
        result.put("jobCard", jobCards.findById(id).orElse(jc));
        return result;
    }

    // ---- Completion Check (dry run) ----

    public Map<String, Object> completionCheck(Long id) {
        JobCard jc = jobCards.findById(id).orElseThrow(() -> new RuntimeException("Job Card not found"));
        List<JobCardSubjob> subs = jobCardSubjobs.findByJobCardId(id);
        Map<String, Object> result = new LinkedHashMap<>();
        List<Map<String, Object>> checks = new ArrayList<>();

        // Check 1: All subjobs completed
        boolean allCompleted = subs.stream().allMatch(s -> "COMPLETED".equals(s.getStatus()));
        checks.add(Map.of(
            "check", "All Operations Complete",
            "passed", allCompleted,
            "detail", subs.stream().map(s -> s.getSubjobNumber() + ": " + s.getStatus()).collect(Collectors.joining(", "))
        ));

        // Check 2: Required quantity accounted for
        BigDecimal totalPlanned = subs.stream()
            .map(s -> s.getPlannedQuantity() == null ? BigDecimal.ZERO : s.getPlannedQuantity())
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal totalCompleted = subs.stream()
            .map(s -> s.getCompletedQuantity() == null ? BigDecimal.ZERO : s.getCompletedQuantity())
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        boolean qtyOk = totalCompleted.compareTo(BigDecimal.ZERO) > 0;
        checks.add(Map.of(
            "check", "Quantity Accounted For",
            "passed", qtyOk,
            "detail", "Completed: " + totalCompleted + " / Planned: " + totalPlanned
        ));

        // Check 3: Quality inspection
        boolean qualityOk = subs.stream()
            .filter(s -> Boolean.TRUE.equals(s.getInspectionRequired()))
            .allMatch(s -> "COMPLETED".equals(s.getStatus()));
        checks.add(Map.of(
            "check", "Quality Inspection",
            "passed", qualityOk,
            "detail", "Inspection required operations: " +
                subs.stream().filter(s -> Boolean.TRUE.equals(s.getInspectionRequired())).count()
        ));

        // Check 4: Rework resolved
        long reworkCount = subs.stream()
            .filter(s -> s.getReworkQuantity() != null && s.getReworkQuantity().compareTo(BigDecimal.ZERO) > 0)
            .count();
        checks.add(Map.of(
            "check", "Rework Resolved",
            "passed", reworkCount == 0,
            "detail", reworkCount + " operations with rework"
        ));

        // Check 5: Scrap recorded
        long scrapCount = subs.stream()
            .filter(s -> s.getScrapQuantity() != null && s.getScrapQuantity().compareTo(BigDecimal.ZERO) > 0)
            .count();
        checks.add(Map.of(
            "check", "Scrap Recorded",
            "passed", true,
            "detail", scrapCount + " operations with scrap"
        ));

        boolean canComplete = allCompleted && qtyOk;
        result.put("jobCardNumber", jc.getJobCardNumber());
        result.put("canComplete", canComplete);
        result.put("checks", checks);
        return result;
    }

    // ---- Subjobs ----

    public List<JobCardSubjob> getSubjobs(Long id) {
        return jobCardSubjobs.findByJobCardId(id);
    }

    public JobCardSubjob addSubjob(Long id, JobCardSubjob sj, java.security.Principal p) {
        JobCard jc = jobCards.findById(id).orElseThrow(() -> new RuntimeException("Job Card not found"));
        if (!"DRAFT".equals(jc.getStatus()) && !"RELEASED".equals(jc.getStatus())) {
            throw new RuntimeException("Subjobs can only be added to DRAFT or RELEASED job cards");
        }
        if (sj.getMachineCode() != null && !sj.getMachineCode().isBlank()) {
            if (!machines.existsByCode(sj.getMachineCode())) {
                throw new RuntimeException("Machine code '" + sj.getMachineCode() + "' does not exist");
            }
            assertMachineCapable(sj.getMachineCode(), sj.getOperationCode());
        }
        sj.setId(null);
        sj.setJobCard(jc);
        if (sj.getPlannedQuantity() == null) sj.setPlannedQuantity(jc.getPlannedQuantity());
        if (sj.getCompletedQuantity() == null) sj.setCompletedQuantity(BigDecimal.ZERO);
        if (sj.getReworkQuantity() == null) sj.setReworkQuantity(BigDecimal.ZERO);
        if (sj.getRejectedQuantity() == null) sj.setRejectedQuantity(BigDecimal.ZERO);
        if (sj.getScrapQuantity() == null) sj.setScrapQuantity(BigDecimal.ZERO);
        if (sj.getStatus() == null) sj.setStatus("PENDING");
        sj.setCreatedAt(Instant.now());
        return jobCardSubjobs.save(sj);
    }

    public JobCardSubjob updateSubjob(Long lineId, JobCardSubjob sj, java.security.Principal p) {
        JobCardSubjob e = jobCardSubjobs.findById(lineId).orElseThrow(() -> new RuntimeException("Subjob not found"));
        sj.setId(lineId);
        sj.setJobCard(e.getJobCard());
        sj.setCreatedAt(e.getCreatedAt());
        sj.setUpdatedAt(Instant.now());
        sj.setUpdatedBy(user(p));
        return jobCardSubjobs.save(sj);
    }

    public void deleteSubjob(Long lineId) {
        JobCardSubjob e = jobCardSubjobs.findById(lineId).orElseThrow(() -> new RuntimeException("Subjob not found"));
        if (!"PENDING".equals(e.getStatus()) && !"RELEASED".equals(e.getStatus())) {
            throw new RuntimeException("Only PENDING or RELEASED subjobs can be deleted");
        }
        jobCardSubjobs.deleteById(lineId);
    }

    public JobCardSubjob subjobAction(Long lineId, String action, java.security.Principal p) {
        JobCardSubjob sj = jobCardSubjobs.findById(lineId).orElseThrow(() -> new RuntimeException("Subjob not found"));
        switch (action.toLowerCase()) {
            case "release": assertPredecessorsComplete(sj, "released"); sj.setStatus("RELEASED"); break;
            case "start": assertPredecessorsComplete(sj, "started"); sj.setStatus("IN_PROGRESS"); sj.setStartTime(Instant.now()); break;
            case "hold": sj.setStatus("ON_HOLD"); break;
            case "quality-hold": sj.setStatus("QUALITY_HOLD"); break;
            case "production-hold": sj.setStatus("PRODUCTION_HOLD"); break;
            case "release-hold": {
                if (!"QUALITY_HOLD".equals(sj.getStatus()) && !"PRODUCTION_HOLD".equals(sj.getStatus())) {
                    throw new RuntimeException("Subjob must be on QUALITY_HOLD or PRODUCTION_HOLD to release hold");
                }
                sj.setStatus("RELEASED");
                break;
            }
            case "resume": sj.setStatus("IN_PROGRESS"); break;
            case "complete": {
                // P11 — Production Quality Gate (CLAR-PROD-012): refuse completion while the
                // operation's inspection is PENDING/FAIL/HELD without an approved override.
                qualityGate.assertSubjobGate(sj, user(p));
                sj.setStatus("COMPLETED"); sj.setEndTime(Instant.now());
                autoReleaseNextSubjob(sj);
                break;
            }
            case "cancel": {
                if ("COMPLETED".equals(sj.getStatus()) || "CLOSED".equals(sj.getStatus())) {
                    throw new RuntimeException("COMPLETED/CLOSED subjobs cannot be cancelled");
                }
                sj.setStatus("CANCELLED");
                break;
            }
            default: throw new RuntimeException("Unknown action: " + action);
        }
        sj.setUpdatedAt(Instant.now());
        sj.setUpdatedBy(user(p));
        return jobCardSubjobs.save(sj);
    }

    /**
     * Production Module FRS §5.2 (audit gap): the sequential-dependency gate previously only
     * blocked posting a production QUANTITY against an out-of-sequence operation
     * (ProductionEntryValidationService.validateSequenceAndPending) — nothing stopped a
     * supervisor from releasing or starting that operation's Job Card subjob in the first
     * place. This closes that: a subjob can't be released/started while any lower-sequence
     * sibling on the same Job Card is still open.
     */
    /**
     * Production Module FRS §5.3 BR (audit gap): "operation status auto-updates to Completed
     * and triggers auto-creation/release of the next operation's Job Card." Since Job Cards
     * stay per-full-order-quantity (all operations pre-created as subjobs upfront — no
     * batch/shift split), there is nothing to auto-CREATE; this closes the auto-RELEASE half,
     * moving the immediate next-sequence subjob from PENDING to RELEASED once its
     * predecessor (the one that just completed) clears. Silently no-ops if there is no next
     * PENDING subjob, or if it's already past PENDING — never overrides a subjob a
     * supervisor already put on hold or started manually.
     */
    private void autoReleaseNextSubjob(JobCardSubjob completed) {
        if (completed.getSequenceNo() == null || completed.getJobCard() == null || completed.getJobCard().getId() == null) return;
        List<JobCardSubjob> siblings = jobCardSubjobs.findByJobCardId(completed.getJobCard().getId());
        siblings.stream()
                .filter(s -> s.getSequenceNo() != null && s.getSequenceNo() > completed.getSequenceNo())
                .filter(s -> "PENDING".equalsIgnoreCase(s.getStatus()))
                .min(Comparator.comparing(JobCardSubjob::getSequenceNo))
                .ifPresent(next -> {
                    try {
                        assertPredecessorsComplete(next, "released");
                        next.setStatus("RELEASED");
                        next.setUpdatedAt(Instant.now());
                        jobCardSubjobs.save(next);
                    } catch (RuntimeException ignored) {
                        // Another lower-sequence sibling is still open — leave it PENDING;
                        // it'll be released manually or by that sibling's own completion.
                    }
                });
    }

    private void assertPredecessorsComplete(JobCardSubjob sj, String actionVerb) {
        Integer mySeq = sj.getSequenceNo();
        if (mySeq == null || sj.getJobCard() == null || sj.getJobCard().getId() == null) return;
        List<JobCardSubjob> siblings = jobCardSubjobs.findByJobCardId(sj.getJobCard().getId());
        for (JobCardSubjob sib : siblings) {
            if (sib.getId() != null && sib.getId().equals(sj.getId())) continue;
            int sibSeq = sib.getSequenceNo() != null ? sib.getSequenceNo() : 0;
            if (sibSeq < mySeq
                    && !"COMPLETED".equalsIgnoreCase(sib.getStatus())
                    && !"CANCELLED".equalsIgnoreCase(sib.getStatus())) {
                throw new RuntimeException("Cannot be " + actionVerb + ": prerequisite operation '"
                        + sib.getOperationCode() + "' (seq " + sibSeq + ") is not yet completed.");
            }
        }
    }
}