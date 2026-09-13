package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.*;
import in.zygertechnology.zygererp.service.DocNumberService;
import in.zygertechnology.zygererp.service.PrintService;
import in.zygertechnology.zygererp.service.StockService;
import in.zygertechnology.zygererp.service.ProductionNormalizedEventService;
import in.zygertechnology.zygererp.repo.ItemRepository;
import in.zygertechnology.zygererp.repo.MachineMasterRepository;
import in.zygertechnology.zygererp.security.RequirePermission;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import org.springframework.transaction.annotation.Transactional;
import jakarta.servlet.http.HttpServletRequest;

import java.security.Principal;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@RestController
@RequirePermission(module = "PRODUCTION", screen = "*", action = "VIEW")
@RequiredArgsConstructor
public class ProductionController {

    private final JobCardRepository jobCards;
    private final JobCardSubjobRepository jobCardSubjobs;
    private final ProductionEntryRepository productionEntries;
    private final ProductConversionRepository productConversions;
    private final ProductionReturnRepository productionReturns;
    private final ProductionLogSheetRepository productionLogSheets;
    private final ProductionLogActivityRepository productionLogActivities;
    private final IdleTimeEntryRepository idleTimeEntries;
    private final WorkOrderRepository workOrders;
    private final WorkOrderRepository woRepo;
    private final RouteSheetRepository routeSheets;
    private final ProductionBOMRepository productionBoms;
    private final ProductionReturnRepository productionReturnsRef;
    private final DocNumberService numbers;
    private final ItemRepository items;
    private final MachineMasterRepository machines;
    private final PrintService printer;
    @Lazy private final StockService stockService;
    private final in.zygertechnology.zygererp.service.ProductionJobCardService jobCardService;
    private final jakarta.persistence.EntityManager em;
    private final in.zygertechnology.zygererp.service.WorkflowStateMachine stateMachine;
    private final in.zygertechnology.zygererp.service.ProductionRollupService rollupService;
    private final in.zygertechnology.zygererp.service.ProductionEntryValidationService entryValidator;
    private final PostingIdempotencyKeyRepository idempotencyKeys;
    private final ProductionEntryAuditLogRepository auditLogs;
    private final in.zygertechnology.zygererp.service.ProductionNormalizedEventService normalizedEvents;
    private final in.zygertechnology.zygererp.service.ProductionQualityGateService qualityGate;
    private final in.zygertechnology.zygererp.service.ProductionReturnService productionReturnService;
    private final in.zygertechnology.zygererp.service.ProductConversionService productConversionService;
    private final ToolLifeEntryRepository toolLifeEntries;
    private final ToolMasterRepository toolMasters;
    private final ProductionPolicyRepository productionPolicies;

    private static String principalName(Principal p) { return p != null ? p.getName() : "system"; }

    /**
     * Production Module FRS §5.3 — Actual Run Time = End Time - Start Time - Idle Time
     * logged in between. This field existed on ProductionEntry but nothing ever computed
     * it (confirmed audit gap) — the frontend declared it but never set or displayed it.
     * No-ops (leaves processTime as whatever was already there) when either timestamp is
     * missing, since there's nothing to compute yet.
     */
    private void computeActualRunTime(ProductionEntry pe) {
        if (pe.getStartTime() == null || pe.getEndTime() == null) return;
        long elapsedSeconds = Duration.between(pe.getStartTime(), pe.getEndTime()).getSeconds();
        BigDecimal elapsedMin = new BigDecimal(elapsedSeconds).divide(new BigDecimal(60), 2, RoundingMode.HALF_UP);
        BigDecimal idleMin = pe.getIdleTime() != null ? pe.getIdleTime() : BigDecimal.ZERO;
        BigDecimal actual = elapsedMin.subtract(idleMin);
        pe.setProcessTime(actual.compareTo(BigDecimal.ZERO) < 0 ? BigDecimal.ZERO : actual);
        flagCycleTimeVariance(pe);
    }

    /** Production Module FRS §5.3 BR: flags (does not block) when Actual Run Time exceeds the
     * Route Sheet's standard time (setup + cycle x qty) by more than the plant-wide
     * cycleTimeTolerancePercent. No-ops when the entry's route/operation can't be resolved. */
    private void flagCycleTimeVariance(ProductionEntry pe) {
        pe.setCycleTimeVarianceFlagged(false);
        if (pe.getProcessTime() == null || pe.getRouteSheetNumber() == null || pe.getOperationCode() == null) return;
        RouteSheet route = routeSheets.findAll().stream()
                .filter(r -> pe.getRouteSheetNumber().equals(r.getRouteNumber()))
                .findFirst().orElse(null);
        if (route == null || route.getOperations() == null) return;
        RouteOperation op = route.getOperations().stream()
                .filter(o -> pe.getOperationCode().equalsIgnoreCase(o.getOperationCode()))
                .findFirst().orElse(null);
        if (op == null || op.getCycleTime() == null) return;

        BigDecimal qty = (pe.getGoodQuantity() != null ? pe.getGoodQuantity() : BigDecimal.ZERO)
                .add(pe.getReworkQuantity() != null ? pe.getReworkQuantity() : BigDecimal.ZERO);
        BigDecimal standardMin = (op.getSetupTime() != null ? op.getSetupTime() : BigDecimal.ZERO)
                .add(op.getCycleTime().multiply(qty));
        if (standardMin.compareTo(BigDecimal.ZERO) <= 0) return;

        ProductionPolicy policy = productionPolicies.findFirstByActiveTrue().orElseGet(ProductionPolicy::new);
        BigDecimal tolerancePct = policy.getCycleTimeTolerancePercent() != null
                ? policy.getCycleTimeTolerancePercent() : new BigDecimal("10.00");
        BigDecimal maxAllowed = standardMin.add(standardMin.multiply(tolerancePct).divide(new BigDecimal("100")));

        pe.setCycleTimeVarianceFlagged(pe.getProcessTime().compareTo(maxAllowed) > 0);
    }

    private static <T> List<T> copyFresh(List<T> list) {
        return list == null ? null : new ArrayList<>(list);
    }

    // ===========================
    // ---- JOB CARD -------------
    // ===========================

    @GetMapping("/api/v1/production/job-cards")
    public List<JobCard> listJobCards() { return jobCardService.listJobCards(); }

    @PostMapping("/api/v1/production/job-cards")
    public JobCard createJobCard(@RequestBody JobCard jc, Principal p) {
        return jobCardService.createJobCard(jc, p);
    }

    @PostMapping("/api/v1/production/job-cards/from-work-order")
    public JobCard createFromWorkOrder(@RequestBody Map<String, Object> body, Principal p) {
        return jobCardService.createFromWorkOrder(body, p);
    }

    @GetMapping("/api/v1/production/job-cards/{id}")
    public JobCard getJobCard(@PathVariable Long id) {
        return jobCardService.getJobCard(id);
    }

    @PutMapping("/api/v1/production/job-cards/{id}")
    public JobCard updateJobCard(@PathVariable Long id, @RequestBody JobCard jc, Principal p) {
        return jobCardService.updateJobCard(id, jc, p);
    }

    @DeleteMapping("/api/v1/production/job-cards/{id}")
    public void deleteJobCard(@PathVariable Long id) {
        jobCardService.deleteJobCard(id);
    }

    @PostMapping("/api/v1/production/job-cards/{id}/actions/{action}")
    public Map<String, Object> jobCardAction(@PathVariable Long id, @PathVariable String action,
                                              @RequestBody(required = false) Map<String, String> body,
                                              Principal p) {
        return jobCardService.jobCardAction(id, action, body, p);
    }

    // ---- Completion Check (dry run) ----

    @GetMapping("/api/v1/production/job-cards/{id}/completion-check")
    public Map<String, Object> completionCheck(@PathVariable Long id) {
        return jobCardService.completionCheck(id);
    }

    // ---- Subjobs ----

    @GetMapping("/api/v1/production/job-cards/{id}/subjobs")
    public List<JobCardSubjob> getSubjobs(@PathVariable Long id) {
        return jobCardService.getSubjobs(id);
    }

    @PostMapping("/api/v1/production/job-cards/{id}/subjobs")
    public JobCardSubjob addSubjob(@PathVariable Long id, @RequestBody JobCardSubjob sj, Principal p) {
        return jobCardService.addSubjob(id, sj, p);
    }

    @PutMapping("/api/v1/production/job-cards/subjobs/{lineId}")
    public JobCardSubjob updateSubjob(@PathVariable Long lineId, @RequestBody JobCardSubjob sj, Principal p) {
        return jobCardService.updateSubjob(lineId, sj, p);
    }

    @DeleteMapping("/api/v1/production/job-cards/subjobs/{lineId}")
    public void deleteSubjob(@PathVariable Long lineId) {
        jobCardService.deleteSubjob(lineId);
    }

    @PostMapping("/api/v1/production/job-cards/subjobs/{lineId}/actions/{action}")
    public JobCardSubjob subjobAction(@PathVariable Long lineId, @PathVariable String action, Principal p) {
        return jobCardService.subjobAction(lineId, action, p);
    }

    // ===========================
    // ---- PRODUCTION ENTRY -----
    // ===========================

    @GetMapping("/api/v1/production/entries")
    public List<ProductionEntry> listProductionEntries() { return productionEntries.findAll(); }

    /**
     * Read-only preview of the next Production Entry number. Does NOT consume or
     * reserve the sequence, so it is safe to call on form load / page refresh.
     * Mirrors the format assigned on save ({@code next("production-entry", "PE")}),
     * in line with BR-NUM-001 (preview may repeat; reservation is permanent on save).
     */
    @GetMapping("/api/v1/production/entries/next-number")
    public Map<String, Object> nextEntryNumber() {
        return Map.of("nextNumber", numbers.peek("production-entry", "PE"));
    }

    @PostMapping("/api/v1/production/entries")
    @Transactional
    public ProductionEntry createProductionEntry(@RequestBody ProductionEntry pe, Principal p) {
        pe.setId(null);
        pe.setEntryNumber(numbers.next("production-entry", "PE"));

        BigDecimal processQty = pe.getProcessQty() != null ? pe.getProcessQty() : (pe.getProducedQuantity() != null ? pe.getProducedQuantity() : BigDecimal.ZERO);
        BigDecimal good = pe.getGoodQuantity() != null ? pe.getGoodQuantity() : BigDecimal.ZERO;
        BigDecimal rework = pe.getReworkQuantity() != null ? pe.getReworkQuantity() : BigDecimal.ZERO;
        BigDecimal reject = pe.getRejectedQuantity() != null ? pe.getRejectedQuantity() : BigDecimal.ZERO;
        BigDecimal scrap = pe.getScrapQuantity() != null ? pe.getScrapQuantity() : BigDecimal.ZERO;

        // Auto-derive good quantity if not manually specified
        if (good.compareTo(BigDecimal.ZERO) == 0 && processQty.compareTo(BigDecimal.ZERO) > 0 && rework.add(reject).compareTo(BigDecimal.ZERO) > 0) {
            good = processQty.subtract(rework).subtract(reject).subtract(scrap);
            good = good.compareTo(BigDecimal.ZERO) < 0 ? BigDecimal.ZERO : good;
            pe.setGoodQuantity(good);
        }

        pe.setProducedQuantity(processQty);
        pe.setProcessQty(processQty);
        computeActualRunTime(pe);

        if (pe.getStatus() == null) pe.setStatus("DRAFT");
        if (pe.getQualityStatus() == null) pe.setQualityStatus("PENDING");
        pe.setCreatedBy(principalName(p));
        pe.setCreatedAt(Instant.now());

        // Validate rules
        entryValidator.validate(pe);
        entryValidator.validateSequenceAndPending(pe);
        entryValidator.validateMachineNotAlreadyRunning(pe);

        // Ensure proper JPA bi-directional linkages
        // NOTE: the child setters clear() the existing field list to re-add rebound
        // children. Passing the field's own list directly would clear() the same
        // (aliased) list and silently drop the children. A fresh copy avoids the
        // aliasing so rejection/rework/operator/material/batch children are retained.
        pe.setOperators(copyFresh(pe.getOperators()));
        pe.setRejectionReasons(copyFresh(pe.getRejectionReasons()));
        pe.setReworkReasons(copyFresh(pe.getReworkReasons()));
        pe.setMaterials(copyFresh(pe.getMaterials()));
        pe.setBatchAllocations(copyFresh(pe.getBatchAllocations()));
        pe.setAdditionalOutputs(copyFresh(pe.getAdditionalOutputs()));

        ProductionEntry saved = productionEntries.save(pe);

        // Audit Log Event
        try {
            auditLogs.save(ProductionEntryAuditLog.builder()
                    .entryId(saved.getId())
                    .eventType("CREATE")
                    .userId(principalName(p))
                    .timestamp(Instant.now())
                    .metadataJson("{\"entryNumber\":\"" + saved.getEntryNumber() + "\"}")
                    .build());
        } catch (Exception ex) {
            log.warn("Audit log (CREATE) failed for entry {}", saved.getEntryNumber(), ex);
        }

        // P3: derive normalized projection in this same transaction (flag-gated).
        // Authoritative write stays production_entry; events are a projection only (P3-01).
        normalizedEvents.project(saved, ProductionNormalizedEventService.EventKind.CREATE, principalName(p));

        return saved;
    }

    @GetMapping("/api/v1/production/entries/{id}")
    public ProductionEntry getProductionEntry(@PathVariable Long id) {
        return productionEntries.findById(id).orElseThrow(() -> new RuntimeException("Production Entry not found"));
    }

    // ===========================
    // ---- P3 normalized-event (READ-ONLY projection, flag-gated) ----
    // ===========================

    @GetMapping("/api/v1/production/normalized/entries/{entryNumber}")
    public List<Object> getNormalizedSession(@PathVariable String entryNumber) {
        // Read-only derived projection; empty when the feature flag is OFF or not found.
        return normalizedEvents.findSessionByEntryNumber(entryNumber)
                .map(s -> List.of((Object) s))
                .orElseGet(List::of);
    }

    @GetMapping("/api/v1/production/normalized/job-cards/{jobCardNumber}")
    public List<ProdExecutionSession> getNormalizedSessionsByJobCard(@PathVariable String jobCardNumber) {
        // Read-only derived projection; empty when the feature flag is OFF.
        return normalizedEvents.findSessionsByJobCard(jobCardNumber);
    }

    @GetMapping("/api/v1/production/entries/eligible-operations")
    @Transactional(readOnly = true)
    public List<Map<String, Object>> getEligibleOperations(@RequestParam String jobCardNumber,
                                                           @RequestParam(defaultValue = "true") boolean pendingSequenceOnly) {
        List<Map<String, Object>> result = new ArrayList<>();
        List<JobCardSubjob> subjobs = jobCardSubjobs.findByJobCardJobCardNumber(jobCardNumber);
        subjobs.sort((a, b) -> Integer.compare(a.getSequenceNo() != null ? a.getSequenceNo() : 0, b.getSequenceNo() != null ? b.getSequenceNo() : 0));

        boolean priorCompleted = true;
        for (JobCardSubjob sj : subjobs) {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("subjobNumber", sj.getSubjobNumber());
            map.put("operationCode", sj.getOperationCode());
            map.put("operationDescription", sj.getOperationDescription());
            map.put("sequenceNo", sj.getSequenceNo());
            map.put("machineCode", sj.getMachineCode());
            map.put("workCenterCode", sj.getWorkCenterCode());
            map.put("plannedQuantity", sj.getPlannedQuantity());
            map.put("completedQuantity", sj.getCompletedQuantity());
            BigDecimal pendingQty = (sj.getPlannedQuantity() != null ? sj.getPlannedQuantity() : BigDecimal.ZERO)
                    .subtract(sj.getCompletedQuantity() != null ? sj.getCompletedQuantity() : BigDecimal.ZERO);
            map.put("pendingQuantity", pendingQty);
            map.put("status", sj.getStatus());
            map.put("eligible", !pendingSequenceOnly || priorCompleted);

            // P11 — Quality Gate advisory (blocking inspection w/o override); evaluation only, no consumption.
            Map<String, Object> gate = qualityGate.evaluateGate(jobCardNumber, sj.getOperationCode(), "system");
            map.put("qualityGate", gate.get("gate"));
            map.put("qualityBlocked", gate.get("blocked"));
            map.put("qualityBlockers", gate.get("blockers"));

            result.add(map);

            if (!"COMPLETED".equalsIgnoreCase(sj.getStatus()) && !"POSTED".equalsIgnoreCase(sj.getStatus())) {
                priorCompleted = false;
            }
        }
        return result;
    }

    @PutMapping("/api/v1/production/entries/{id}")
    @Transactional
    public ProductionEntry updateProductionEntry(@PathVariable Long id, @RequestBody ProductionEntry pe, Principal p) {
        ProductionEntry e = productionEntries.findById(id).orElseThrow(() -> new RuntimeException("Production Entry not found"));

        // V-22: Posted entries cannot be modified directly
        if ("POSTED".equalsIgnoreCase(e.getStatus()) || "COMPLETED".equalsIgnoreCase(e.getStatus())) {
            throw new IllegalArgumentException("Posted Production Entry cannot be edited directly (V-22). Create a reversal/correction transaction.");
        }

        pe.setId(id);
        pe.setEntryNumber(e.getEntryNumber());

        BigDecimal processQty = pe.getProcessQty() != null ? pe.getProcessQty() : (pe.getProducedQuantity() != null ? pe.getProducedQuantity() : BigDecimal.ZERO);
        pe.setProducedQuantity(processQty);
        pe.setProcessQty(processQty);
        computeActualRunTime(pe);

        pe.setCreatedAt(e.getCreatedAt());
        pe.setCreatedBy(e.getCreatedBy());
        pe.setUpdatedAt(Instant.now());
        pe.setUpdatedBy(principalName(p));

        entryValidator.validate(pe);
        entryValidator.validateSequenceAndPending(pe);
        entryValidator.validateMachineNotAlreadyRunning(pe);

        pe.setOperators(copyFresh(pe.getOperators()));
        pe.setRejectionReasons(copyFresh(pe.getRejectionReasons()));
        pe.setReworkReasons(copyFresh(pe.getReworkReasons()));
        pe.setMaterials(copyFresh(pe.getMaterials()));
        pe.setBatchAllocations(copyFresh(pe.getBatchAllocations()));
        pe.setAdditionalOutputs(copyFresh(pe.getAdditionalOutputs()));

        ProductionEntry saved = productionEntries.save(pe);

        // Audit Log Event
        try {
            auditLogs.save(ProductionEntryAuditLog.builder()
                    .entryId(saved.getId())
                    .eventType("DRAFT_SAVE")
                    .userId(principalName(p))
                    .timestamp(Instant.now())
                    .build());
        } catch (Exception ex) {
            log.warn("Audit log (DRAFT_SAVE) failed for entry {}", saved.getId(), ex);
        }

        return saved;
    }

    @DeleteMapping("/api/v1/production/entries/{id}")
    @Transactional
    public void deleteProductionEntry(@PathVariable Long id, Principal p) {
        ProductionEntry e = productionEntries.findById(id).orElseThrow(() -> new RuntimeException("Production Entry not found"));
        if (!"DRAFT".equals(e.getStatus())) throw new RuntimeException("Only DRAFT entries can be deleted");

        try {
            auditLogs.save(ProductionEntryAuditLog.builder()
                    .entryId(e.getId())
                    .eventType("CANCEL")
                    .userId(principalName(p))
                    .timestamp(Instant.now())
                    .metadataJson("{\"entryNumber\":\"" + e.getEntryNumber() + "\"}")
                    .build());
        } catch (Exception ex) {
            log.warn("Audit log (CANCEL) failed for entry {}", e.getEntryNumber(), ex);
        }

        productionEntries.deleteById(id);
    }

    @PostMapping("/api/v1/production/entries/{id}/actions/{action}")
    @Transactional
    public ProductionEntry productionEntryAction(@PathVariable Long id, @PathVariable String action,
                                                  @RequestBody(required = false) Map<String, String> body,
                                                  HttpServletRequest request,
                                                  Principal p) {
        ProductionEntry pe = productionEntries.findById(id).orElseThrow(() -> new RuntimeException("Production Entry not found"));
        String act = action.toLowerCase();

        // Idempotency Key Guard for Post action (§4.3, §5.9, §9)
        String idempotencyKeyHeader = request != null ? request.getHeader("X-Idempotency-Key") : null;
        if (idempotencyKeyHeader == null && request != null) {
            idempotencyKeyHeader = request.getHeader("Idempotency-Key");
        }

        if ("post".equals(act) && idempotencyKeyHeader != null && !idempotencyKeyHeader.isBlank()) {
            Optional<PostingIdempotencyKey> existingKey = idempotencyKeys.findByIdempotencyKey(idempotencyKeyHeader);
            if (existingKey.isPresent() && "SUCCESS".equals(existingKey.get().getResultStatus())) {
                return pe; // Return already processed result idempotently (FR-45)
            }
        }

        switch (act) {
            case "submit": {
                if (pe.getProductionDate() != null && pe.getJobCardNumber() != null && !pe.getJobCardNumber().isBlank()) {
                    JobCard jc = jobCards.findByJobCardNumber(pe.getJobCardNumber()).stream().findFirst().orElse(null);
                    if (jc != null && jc.getActualStartDate() != null && pe.getProductionDate().isBefore(jc.getActualStartDate())) {
                        String reason = body != null ? body.get("backdatedReason") : null;
                        if (reason == null || reason.isBlank()) {
                            throw new IllegalArgumentException("Backdated entry requires a reason. Pass backdatedReason parameter.");
                        }
                    }
                }
                pe.setStatus("SUBMITTED");
                break;
            }
            case "approve": pe.setStatus("APPROVED"); break;
            case "post": {
                // Finality guard: a posted or reversed entry must never be re-posted
                // (re-posting would re-add good/rejected/rework/scrap to the subjob and
                // re-emit the projection — silent double-count, contrary to V-22 "posted
                // entries are final"). The X-Idempotency-Key header protects retries; this
                // guard protects the case where the header is absent.
                if ("POSTED".equalsIgnoreCase(pe.getStatus()) || "REVERSED".equalsIgnoreCase(pe.getStatus())) {
                    return pe;
                }
                // Atomic Final Posting (§4.3)
                entryValidator.validate(pe);
                entryValidator.validateSequenceAndPending(pe);
                entryValidator.validateMachineNotAlreadyRunning(pe);

                // P11 — Production Quality Gate (CLAR-PROD-012): refuse post while the operation's
                // inspection is PENDING/FAIL/HELD without an approved one-time override.
                qualityGate.assertEntryPostGate(pe, principalName(p));

                // Update subjob progress
                if (pe.getJobCardNumber() != null && pe.getOperationCode() != null) {
                    List<JobCardSubjob> subs = jobCardSubjobs.findByJobCardJobCardNumber(pe.getJobCardNumber());
                    for (JobCardSubjob sj : subs) {
                        if (pe.getOperationCode().equalsIgnoreCase(sj.getOperationCode())) {
                            BigDecimal currentCompleted = sj.getCompletedQuantity() != null ? sj.getCompletedQuantity() : BigDecimal.ZERO;
                            BigDecimal goodQty = pe.getGoodQuantity() != null ? pe.getGoodQuantity() : BigDecimal.ZERO;
                            sj.setCompletedQuantity(currentCompleted.add(goodQty));

                            BigDecimal currentReject = sj.getRejectedQuantity() != null ? sj.getRejectedQuantity() : BigDecimal.ZERO;
                            sj.setRejectedQuantity(currentReject.add(pe.getRejectedQuantity() != null ? pe.getRejectedQuantity() : BigDecimal.ZERO));

                            BigDecimal currentRework = sj.getReworkQuantity() != null ? sj.getReworkQuantity() : BigDecimal.ZERO;
                            sj.setReworkQuantity(currentRework.add(pe.getReworkQuantity() != null ? pe.getReworkQuantity() : BigDecimal.ZERO));

                            BigDecimal currentScrap = sj.getScrapQuantity() != null ? sj.getScrapQuantity() : BigDecimal.ZERO;
                            sj.setScrapQuantity(currentScrap.add(pe.getScrapQuantity() != null ? pe.getScrapQuantity() : BigDecimal.ZERO));

                            if (sj.getCompletedQuantity().compareTo(sj.getPlannedQuantity() != null ? sj.getPlannedQuantity() : BigDecimal.ZERO) >= 0) {
                                sj.setStatus("COMPLETED");
                                sj.setEndTime(Instant.now());
                            } else {
                                sj.setStatus("IN_PROGRESS");
                            }
                            jobCardSubjobs.save(sj);
                        }
                    }
                }

                pe.setStatus("POSTED");

                if (idempotencyKeyHeader != null && !idempotencyKeyHeader.isBlank()) {
                    try {
                        idempotencyKeys.save(PostingIdempotencyKey.builder()
                                .idempotencyKey(idempotencyKeyHeader)
                                .entryId(pe.getId())
                                .resultStatus("SUCCESS")
                                .createdAt(Instant.now())
                                .build());
                    } catch (Exception ex) {
                        log.warn("Idempotency key persist failed for key {}", idempotencyKeyHeader, ex);
                    }
                }

                // P3: finalize the derived projection with the addressed outputs
                // (flag-gated; idempotent by natural key; emits no stock postings).
                normalizedEvents.project(pe, ProductionNormalizedEventService.EventKind.POST, principalName(p));

                try {
                    auditLogs.save(ProductionEntryAuditLog.builder()
                            .entryId(pe.getId())
                            .eventType("POST")
                            .userId(principalName(p))
                            .timestamp(Instant.now())
                            .build());
                } catch (Exception ex) {
                    log.warn("Audit log (POST) failed for entry {}", pe.getEntryNumber(), ex);
                }

                break;
            }
            case "reverse": {
                if (!"POSTED".equalsIgnoreCase(pe.getStatus()) && !"COMPLETED".equalsIgnoreCase(pe.getStatus())) {
                    throw new IllegalArgumentException("Only POSTED entries can be reversed.");
                }
                String reason = body != null ? body.get("reversalReason") : "Correction transaction";

                // Create Reversal record
                ProductionEntry rev = new ProductionEntry();
                rev.setEntryNumber(numbers.next("production-entry", "PE-REV"));
                rev.setEntryType("Reversal Entry");
                rev.setProductionType(pe.getProductionType());
                rev.setSupervisorCode(pe.getSupervisorCode());
                rev.setSupervisorName(pe.getSupervisorName());
                rev.setWorkOrderNumber(pe.getWorkOrderNumber());
                rev.setJobCardNumber(pe.getJobCardNumber());
                rev.setSubjobNumber(pe.getSubjobNumber());
                rev.setRouteSheetNumber(pe.getRouteSheetNumber());
                rev.setPartCode(pe.getPartCode());
                rev.setPartDescription(pe.getPartDescription());
                rev.setOperationCode(pe.getOperationCode());
                rev.setMachineCode(pe.getMachineCode());
                rev.setOperatorCode(pe.getOperatorCode());
                rev.setShiftCode(pe.getShiftCode());
                rev.setProductionDate(Instant.now());

                BigDecimal negGood = pe.getGoodQuantity() != null ? pe.getGoodQuantity().negate() : BigDecimal.ZERO;
                BigDecimal negRework = pe.getReworkQuantity() != null ? pe.getReworkQuantity().negate() : BigDecimal.ZERO;
                BigDecimal negReject = pe.getRejectedQuantity() != null ? pe.getRejectedQuantity().negate() : BigDecimal.ZERO;
                BigDecimal negScrap = pe.getScrapQuantity() != null ? pe.getScrapQuantity().negate() : BigDecimal.ZERO;
                BigDecimal negProcess = pe.getProcessQty() != null ? pe.getProcessQty().negate() : BigDecimal.ZERO;

                rev.setGoodQuantity(negGood);
                rev.setReworkQuantity(negRework);
                rev.setRejectedQuantity(negReject);
                rev.setScrapQuantity(negScrap);
                rev.setProducedQuantity(negProcess);
                rev.setProcessQty(negProcess);

                rev.setReversedFromEntryId(pe.getId());
                rev.setIsReversal(true);
                rev.setReversalReason(reason);
                rev.setStatus("POSTED");
                rev.setQualityStatus("REVERSED");
                rev.setCreatedBy(principalName(p));
                rev.setCreatedAt(Instant.now());

                // P8 Capability A — mirror additional (co/by-product) outputs as
                // negated rows so the compensating projection fully offsets them.
                if (pe.getAdditionalOutputs() != null && !pe.getAdditionalOutputs().isEmpty()) {
                    List<ProductionEntryOutput> negated = new ArrayList<>();
                    for (ProductionEntryOutput o : pe.getAdditionalOutputs()) {
                        if (o == null) {
                            continue;
                        }
                        negated.add(ProductionEntryOutput.builder()
                                .outputType(o.getOutputType())
                                .itemCode(o.getItemCode())
                                .itemName(o.getItemName())
                                .uom(o.getUom())
                                .location(o.getLocation() != null ? o.getLocation() : "STORE")
                                .quantity(o.getQuantity() != null ? o.getQuantity().negate() : null)
                                .weight(o.getWeight())
                                .destinationStageCode(o.getDestinationStageCode())
                                .remarks(o.getRemarks())
                                .build());
                    }
                    rev.setAdditionalOutputs(negated);
                }

                // Reverse subjob numbers
                if (pe.getJobCardNumber() != null && pe.getOperationCode() != null) {
                    List<JobCardSubjob> subs = jobCardSubjobs.findByJobCardJobCardNumber(pe.getJobCardNumber());
                    for (JobCardSubjob sj : subs) {
                        if (pe.getOperationCode().equalsIgnoreCase(sj.getOperationCode())) {
                            BigDecimal current = sj.getCompletedQuantity() != null ? sj.getCompletedQuantity() : BigDecimal.ZERO;
                            BigDecimal adj = current.subtract(pe.getGoodQuantity() != null ? pe.getGoodQuantity() : BigDecimal.ZERO);
                            sj.setCompletedQuantity(adj.compareTo(BigDecimal.ZERO) < 0 ? BigDecimal.ZERO : adj);

                            // Mirror the reject/rework/scrap increments applied at post time so a
                            // reversal fully compensates the subjob (no inflated reject/rework/scrap).
                            BigDecimal currentReject = sj.getRejectedQuantity() != null ? sj.getRejectedQuantity() : BigDecimal.ZERO;
                            BigDecimal adjReject = currentReject.subtract(pe.getRejectedQuantity() != null ? pe.getRejectedQuantity() : BigDecimal.ZERO);
                            sj.setRejectedQuantity(adjReject.compareTo(BigDecimal.ZERO) < 0 ? BigDecimal.ZERO : adjReject);

                            BigDecimal currentRework = sj.getReworkQuantity() != null ? sj.getReworkQuantity() : BigDecimal.ZERO;
                            BigDecimal adjRework = currentRework.subtract(pe.getReworkQuantity() != null ? pe.getReworkQuantity() : BigDecimal.ZERO);
                            sj.setReworkQuantity(adjRework.compareTo(BigDecimal.ZERO) < 0 ? BigDecimal.ZERO : adjRework);

                            BigDecimal currentScrap = sj.getScrapQuantity() != null ? sj.getScrapQuantity() : BigDecimal.ZERO;
                            BigDecimal adjScrap = currentScrap.subtract(pe.getScrapQuantity() != null ? pe.getScrapQuantity() : BigDecimal.ZERO);
                            sj.setScrapQuantity(adjScrap.compareTo(BigDecimal.ZERO) < 0 ? BigDecimal.ZERO : adjScrap);

                            sj.setStatus("IN_PROGRESS");
                            jobCardSubjobs.save(sj);
                        }
                    }
                }

                pe.setStatus("REVERSED");
                pe.setReversalReason(reason);
                productionEntries.save(pe);

                ProductionEntry savedRev = productionEntries.save(rev);

                try {
                    auditLogs.save(ProductionEntryAuditLog.builder()
                            .entryId(pe.getId())
                            .eventType("REVERSE")
                            .userId(principalName(p))
                            .timestamp(Instant.now())
                            .metadataJson("{\"reversalEntryId\":" + savedRev.getId() + "}")
                            .build());
                } catch (Exception ex) {
                    log.warn("Audit log (REVERSE) failed for entry {}", pe.getEntryNumber(), ex);
                }

                // P3: derive the compensating reversal projection. The original
                // historical projection is preserved untouched (P3-06); the mirror
                // is keyed to the reversal's own entry_number.
                normalizedEvents.project(savedRev, ProductionNormalizedEventService.EventKind.REVERSE, principalName(p));

                return savedRev;
            }
            case "reject": pe.setStatus("REJECTED"); break;
            case "cancel": pe.setStatus("CANCELLED"); break;
            case "quality-pass": pe.setQualityStatus("PASS"); break;
            case "quality-fail": pe.setQualityStatus("FAIL"); break;
            case "quality-hold": pe.setQualityStatus("HOLD"); break;
            default: throw new RuntimeException("Unknown action: " + action);
        }
        pe.setUpdatedAt(Instant.now());
        pe.setUpdatedBy(principalName(p));
        return productionEntries.save(pe);
    }

    // ---- Summary & Reporting Endpoints (§4.9 - Sourced strictly from POSTED entries per BR-12) ----

    @GetMapping("/api/v1/production/reports/rejection-summary")
    public List<Map<String, Object>> getRejectionSummary() {
        List<Map<String, Object>> list = new ArrayList<>();
        List<ProductionEntry> entries = productionEntries.findByStatus("POSTED");
        Map<String, BigDecimal> reasonMap = new LinkedHashMap<>();

        for (ProductionEntry pe : entries) {
            if (pe.getRejectionReasons() != null) {
                for (ProductionEntryRejection r : pe.getRejectionReasons()) {
                    String key = (r.getReasonCode() != null ? r.getReasonCode() : "UNKNOWN") + " - " + (r.getReasonDescription() != null ? r.getReasonDescription() : "");
                    reasonMap.put(key, reasonMap.getOrDefault(key, BigDecimal.ZERO).add(r.getQuantity() != null ? r.getQuantity() : BigDecimal.ZERO));
                }
            }
        }
        reasonMap.forEach((reason, qty) -> list.add(Map.of("reason", reason, "quantity", qty)));
        return list;
    }

    @GetMapping("/api/v1/production/reports/rework-summary")
    public List<Map<String, Object>> getReworkSummary() {
        List<Map<String, Object>> list = new ArrayList<>();
        List<ProductionEntry> entries = productionEntries.findByStatus("POSTED");
        Map<String, Map<String, Object>> map = new LinkedHashMap<>();

        for (ProductionEntry pe : entries) {
            if (pe.getReworkReasons() != null) {
                for (ProductionEntryRework rw : pe.getReworkReasons()) {
                    String key = rw.getReasonCode() != null ? rw.getReasonCode() : "GENERAL";
                    Map<String, Object> data = map.getOrDefault(key, new LinkedHashMap<>());
                    data.put("reasonCode", key);
                    data.put("reasonDescription", rw.getReasonDescription() != null ? rw.getReasonDescription() : key);
                    data.put("targetProcess", rw.getTargetProcessCode() != null ? rw.getTargetProcessCode() : "N/A");
                    BigDecimal currentQty = (BigDecimal) data.getOrDefault("quantity", BigDecimal.ZERO);
                    data.put("quantity", currentQty.add(rw.getQuantity() != null ? rw.getQuantity() : BigDecimal.ZERO));
                    map.put(key, data);
                }
            }
        }
        list.addAll(map.values());
        return list;
    }

    @GetMapping("/api/v1/production/reports/idle-summary")
    public List<Map<String, Object>> getIdleSummary() {
        List<Map<String, Object>> list = new ArrayList<>();
        List<ProductionEntry> entries = productionEntries.findByStatus("POSTED");
        Map<String, BigDecimal> map = new LinkedHashMap<>();

        for (ProductionEntry pe : entries) {
            if (pe.getIdleTime() != null && pe.getIdleTime().compareTo(BigDecimal.ZERO) > 0) {
                String reason = pe.getIdleReason() != null ? pe.getIdleReason() : "UNSPECIFIED";
                map.put(reason, map.getOrDefault(reason, BigDecimal.ZERO).add(pe.getIdleTime()));
            }
        }
        map.forEach((reason, idleTimeMins) -> list.add(Map.of("reason", reason, "idleTimeMinutes", idleTimeMins)));
        return list;
    }

    @GetMapping("/api/v1/production/reports/machine-summary")
    public List<Map<String, Object>> getMachineSummary() {
        List<Map<String, Object>> list = new ArrayList<>();
        List<ProductionEntry> entries = productionEntries.findByStatus("POSTED");
        Map<String, Map<String, Object>> map = new LinkedHashMap<>();

        for (ProductionEntry pe : entries) {
            String mCode = pe.getMachineCode() != null ? pe.getMachineCode() : "UNASSIGNED";
            Map<String, Object> mData = map.getOrDefault(mCode, new LinkedHashMap<>());
            mData.put("machineCode", mCode);

            BigDecimal good = (BigDecimal) mData.getOrDefault("goodQty", BigDecimal.ZERO);
            BigDecimal rejected = (BigDecimal) mData.getOrDefault("rejectedQty", BigDecimal.ZERO);
            BigDecimal rework = (BigDecimal) mData.getOrDefault("reworkQty", BigDecimal.ZERO);

            mData.put("goodQty", good.add(pe.getGoodQuantity() != null ? pe.getGoodQuantity() : BigDecimal.ZERO));
            mData.put("rejectedQty", rejected.add(pe.getRejectedQuantity() != null ? pe.getRejectedQuantity() : BigDecimal.ZERO));
            mData.put("reworkQty", rework.add(pe.getReworkQuantity() != null ? pe.getReworkQuantity() : BigDecimal.ZERO));
            map.put(mCode, mData);
        }

        // Machine Utilization % (Production Module FRS §6 — audit gap: this report only had
        // raw quantity totals before, no utilization figure at all). Reuses oee_daily's
        // already-computed Availability, now that it's fed from the correct production_entry
        // table (see the earlier OEE fix) rather than recomputing hours from scratch here.
        List<Object[]> utilRows = em.createNativeQuery(
                "SELECT machine_code, AVG(availability) FROM oee_daily GROUP BY machine_code").getResultList();
        for (Object[] row : utilRows) {
            String mCode = (String) row[0];
            Map<String, Object> mData = map.get(mCode);
            if (mData == null) continue;
            BigDecimal avgAvailability = row[1] != null ? new BigDecimal(row[1].toString()) : null;
            mData.put("utilizationPercent", avgAvailability != null
                    ? avgAvailability.multiply(new BigDecimal("100")).setScale(1, RoundingMode.HALF_UP) : null);
        }

        list.addAll(map.values());
        return list;
    }

    @GetMapping("/api/v1/production/reports/operator-summary")
    public List<Map<String, Object>> getOperatorSummary() {
        List<Map<String, Object>> list = new ArrayList<>();
        List<ProductionEntry> entries = productionEntries.findByStatus("POSTED");
        Map<String, Map<String, Object>> map = new LinkedHashMap<>();

        // Route lookup for standard time — Operator Efficiency % (FRS §6 — audit gap: this
        // report only had raw good/rejected totals before, no efficiency figure). Standard
        // time per entry = setupTime + cycleTime x qty, from the RouteSheet operation the
        // entry was logged against; entries with no resolvable route/operation are simply
        // excluded from the efficiency ratio (their quantities still count above).
        Map<String, RouteSheet> routesByNumber = routeSheets.findAll().stream()
                .filter(r -> r.getRouteNumber() != null)
                .collect(Collectors.toMap(RouteSheet::getRouteNumber, r -> r, (a, b) -> a));

        Map<String, BigDecimal> standardMinutesByOperator = new LinkedHashMap<>();
        Map<String, BigDecimal> actualMinutesByOperator = new LinkedHashMap<>();

        for (ProductionEntry pe : entries) {
            String opCode = pe.getOperatorCode() != null ? pe.getOperatorCode() : "UNASSIGNED";
            Map<String, Object> opData = map.getOrDefault(opCode, new LinkedHashMap<>());
            opData.put("operatorCode", opCode);

            BigDecimal good = (BigDecimal) opData.getOrDefault("goodQty", BigDecimal.ZERO);
            BigDecimal rejected = (BigDecimal) opData.getOrDefault("rejectedQty", BigDecimal.ZERO);

            opData.put("goodQty", good.add(pe.getGoodQuantity() != null ? pe.getGoodQuantity() : BigDecimal.ZERO));
            opData.put("rejectedQty", rejected.add(pe.getRejectedQuantity() != null ? pe.getRejectedQuantity() : BigDecimal.ZERO));
            map.put(opCode, opData);

            if (pe.getRouteSheetNumber() == null || pe.getOperationCode() == null
                    || pe.getStartTime() == null || pe.getEndTime() == null) {
                continue;
            }
            RouteSheet route = routesByNumber.get(pe.getRouteSheetNumber());
            if (route == null || route.getOperations() == null) continue;
            RouteOperation op = route.getOperations().stream()
                    .filter(o -> pe.getOperationCode().equalsIgnoreCase(o.getOperationCode()))
                    .findFirst().orElse(null);
            if (op == null || op.getCycleTime() == null) continue;

            BigDecimal qty = (pe.getGoodQuantity() != null ? pe.getGoodQuantity() : BigDecimal.ZERO)
                    .add(pe.getReworkQuantity() != null ? pe.getReworkQuantity() : BigDecimal.ZERO);
            BigDecimal standardMin = (op.getSetupTime() != null ? op.getSetupTime() : BigDecimal.ZERO)
                    .add(op.getCycleTime().multiply(qty));

            long actualSeconds = java.time.Duration.between(pe.getStartTime(), pe.getEndTime()).getSeconds()
                    - (pe.getIdleTime() != null ? pe.getIdleTime().multiply(new BigDecimal(60)).longValue() : 0L);
            if (actualSeconds <= 0) continue;
            BigDecimal actualMin = new BigDecimal(actualSeconds).divide(new BigDecimal(60), 4, RoundingMode.HALF_UP);

            standardMinutesByOperator.merge(opCode, standardMin, BigDecimal::add);
            actualMinutesByOperator.merge(opCode, actualMin, BigDecimal::add);
        }

        for (Map.Entry<String, Map<String, Object>> e : map.entrySet()) {
            BigDecimal std = standardMinutesByOperator.get(e.getKey());
            BigDecimal act = actualMinutesByOperator.get(e.getKey());
            if (std != null && act != null && act.compareTo(BigDecimal.ZERO) > 0) {
                e.getValue().put("efficiencyPercent", std.multiply(new BigDecimal("100"))
                        .divide(act, 1, RoundingMode.HALF_UP));
            } else {
                e.getValue().put("efficiencyPercent", null);
            }
        }

        list.addAll(map.values());
        return list;
    }

    @GetMapping("/api/v1/production/reports/daily-production-summary")
    public List<Map<String, Object>> getDailyProductionReport() {
        List<ProductionEntry> entries = productionEntries.findByStatus("POSTED");
        Map<LocalDate, Map<String, Object>> byDate = new TreeMap<>(Comparator.reverseOrder());

        for (ProductionEntry pe : entries) {
            LocalDate d = pe.getProductionDate() != null
                    ? pe.getProductionDate().atZone(ZoneId.systemDefault()).toLocalDate() : LocalDate.now();
            Map<String, Object> row = byDate.getOrDefault(d, new LinkedHashMap<>());
            row.put("date", d.toString());
            row.put("goodQty", ((BigDecimal) row.getOrDefault("goodQty", BigDecimal.ZERO))
                    .add(pe.getGoodQuantity() != null ? pe.getGoodQuantity() : BigDecimal.ZERO));
            row.put("rejectedQty", ((BigDecimal) row.getOrDefault("rejectedQty", BigDecimal.ZERO))
                    .add(pe.getRejectedQuantity() != null ? pe.getRejectedQuantity() : BigDecimal.ZERO));
            row.put("reworkQty", ((BigDecimal) row.getOrDefault("reworkQty", BigDecimal.ZERO))
                    .add(pe.getReworkQuantity() != null ? pe.getReworkQuantity() : BigDecimal.ZERO));
            row.put("scrapQty", ((BigDecimal) row.getOrDefault("scrapQty", BigDecimal.ZERO))
                    .add(pe.getScrapQuantity() != null ? pe.getScrapQuantity() : BigDecimal.ZERO));
            row.put("entries", ((Integer) row.getOrDefault("entries", 0)) + 1);
            byDate.put(d, row);
        }
        return new ArrayList<>(byDate.values());
    }

    @GetMapping("/api/v1/production/reports/shift-summary")
    public List<Map<String, Object>> getShiftSummary() {
        List<ProductionEntry> entries = productionEntries.findByStatus("POSTED");
        Map<String, Map<String, Object>> map = new LinkedHashMap<>();

        for (ProductionEntry pe : entries) {
            String shift = pe.getShiftCode() != null && !pe.getShiftCode().isBlank() ? pe.getShiftCode() : "UNSPECIFIED";
            Map<String, Object> row = map.getOrDefault(shift, new LinkedHashMap<>());
            row.put("shiftCode", shift);
            BigDecimal good = (BigDecimal) row.getOrDefault("goodQty", BigDecimal.ZERO);
            BigDecimal rejected = (BigDecimal) row.getOrDefault("rejectedQty", BigDecimal.ZERO);
            row.put("goodQty", good.add(pe.getGoodQuantity() != null ? pe.getGoodQuantity() : BigDecimal.ZERO));
            row.put("rejectedQty", rejected.add(pe.getRejectedQuantity() != null ? pe.getRejectedQuantity() : BigDecimal.ZERO));
            BigDecimal totalForPct = ((BigDecimal) row.get("goodQty")).add((BigDecimal) row.get("rejectedQty"));
            row.put("rejectionPercent", totalForPct.compareTo(BigDecimal.ZERO) > 0
                    ? ((BigDecimal) row.get("rejectedQty")).multiply(new BigDecimal("100"))
                            .divide(totalForPct, 1, RoundingMode.HALF_UP)
                    : BigDecimal.ZERO);
            Set<String> operators = (Set<String>) row.computeIfAbsent("_operators", k -> new LinkedHashSet<String>());
            if (pe.getOperatorCode() != null) operators.add(pe.getOperatorCode());
            row.put("operatorsDeployed", operators.size());
            map.put(shift, row);
        }
        map.values().forEach(row -> row.remove("_operators"));
        return new ArrayList<>(map.values());
    }

    @GetMapping("/api/v1/production/reports/wip-summary")
    public List<Map<String, Object>> getWipReport() {
        List<Map<String, Object>> list = new ArrayList<>();
        List<JobCard> openCards = jobCards.findAll().stream()
                .filter(jc -> !Set.of("COMPLETED", "CANCELLED", "CLOSED").contains(jc.getStatus()))
                .collect(Collectors.toList());

        for (JobCard jc : openCards) {
            List<JobCardSubjob> subs = jobCardSubjobs.findByJobCardId(jc.getId());
            for (JobCardSubjob sub : subs) {
                if ("CANCELLED".equalsIgnoreCase(sub.getStatus()) || "COMPLETED".equalsIgnoreCase(sub.getStatus())) continue;
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("jobCardNumber", jc.getJobCardNumber());
                row.put("workOrderNumber", jc.getWorkOrderNumber());
                row.put("partCode", jc.getPartCode());
                row.put("operationCode", sub.getOperationCode());
                row.put("sequenceNo", sub.getSequenceNo());
                row.put("plannedQty", sub.getPlannedQuantity());
                row.put("completedQty", sub.getCompletedQuantity());
                BigDecimal planned = sub.getPlannedQuantity() != null ? sub.getPlannedQuantity() : BigDecimal.ZERO;
                BigDecimal completed = sub.getCompletedQuantity() != null ? sub.getCompletedQuantity() : BigDecimal.ZERO;
                row.put("pendingQty", planned.subtract(completed).max(BigDecimal.ZERO));
                row.put("status", sub.getStatus());
                long ageingDays = jc.getCreatedAt() != null
                        ? ChronoUnit.DAYS.between(jc.getCreatedAt().atZone(ZoneId.systemDefault()).toLocalDate(), LocalDate.now())
                        : 0;
                row.put("ageingDays", ageingDays);
                list.add(row);
            }
        }
        list.sort((a, b) -> Long.compare((Long) b.get("ageingDays"), (Long) a.get("ageingDays")));
        return list;
    }

    @GetMapping("/api/v1/production/reports/tool-consumption-summary")
    public List<Map<String, Object>> getToolConsumptionReport() {
        List<Map<String, Object>> list = new ArrayList<>();
        for (ToolMaster tool : toolMasters.findAll()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("toolCode", tool.getCode());
            row.put("toolName", tool.getName());
            row.put("ratedLife", tool.getToolLifeCount());
            row.put("lifeUnit", tool.getToolLifeUnit());
            row.put("currentUsage", tool.getCurrentUsage());
            BigDecimal remainingPct = null;
            if (tool.getToolLifeCount() != null && tool.getToolLifeCount().compareTo(BigDecimal.ZERO) > 0) {
                BigDecimal usage = tool.getCurrentUsage() != null ? tool.getCurrentUsage() : BigDecimal.ZERO;
                remainingPct = tool.getToolLifeCount().subtract(usage).multiply(new BigDecimal("100"))
                        .divide(tool.getToolLifeCount(), 1, RoundingMode.HALF_UP);
                if (remainingPct.compareTo(BigDecimal.ZERO) < 0) remainingPct = BigDecimal.ZERO;
            }
            row.put("remainingLifePercent", remainingPct);
            row.put("changeCount", toolLifeEntries.findByToolCodeOrderByCreatedAtDesc(tool.getCode()).stream()
                    .filter(e -> e.getChangeReason() != null).count());
            list.add(row);
        }
        return list;
    }

    @GetMapping("/api/v1/production/reports/order-status-summary")
    public List<Map<String, Object>> getOrderStatusReport() {
        List<Map<String, Object>> list = new ArrayList<>();
        for (WorkOrder wo : workOrders.findAll()) {
            if (Set.of("DRAFT", "CANCELLED").contains(wo.getStatus())) continue;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("workOrderNumber", wo.getDocNo() != null ? wo.getDocNo() : wo.getWoNumber());
            row.put("customerCode", wo.getCustomerCode());
            row.put("itemCode", wo.getItemCode());
            row.put("orderQuantity", wo.getOrderQuantity());
            row.put("completedQty", wo.getCompletedQty());
            row.put("status", wo.getStatus());
            row.put("plannedCompletionDate", wo.getDueDate());
            row.put("actualCompletionDate", wo.getActualEndDate());
            // Delayed if it finished after its due date, or (still open) is already past due.
            LocalDate comparisonDate = wo.getActualEndDate() != null ? wo.getActualEndDate() : LocalDate.now();
            boolean delayed = wo.getDueDate() != null && comparisonDate.isAfter(wo.getDueDate());
            row.put("delayed", delayed);
            row.put("delayDays", wo.getDueDate() != null
                    ? ChronoUnit.DAYS.between(wo.getDueDate(), wo.getActualEndDate() != null ? wo.getActualEndDate() : LocalDate.now())
                    : null);
            list.add(row);
        }
        return list;
    }

    // ===========================
    // ---- PRODUCT CONVERSION ---
    // ===========================

    @GetMapping("/api/v1/production/conversions")
    public List<ProductConversion> listConversions() { return productConversions.findAll(); }

    @PostMapping("/api/v1/production/conversions")
    public ProductConversion createConversion(@RequestBody ProductConversion pc, Principal p) {
        return productConversionService.create(pc, principalName(p));
    }

    @GetMapping("/api/v1/production/conversions/{id}")
    public ProductConversion getConversion(@PathVariable Long id) {
        return productConversions.findById(id).orElseThrow(() -> new RuntimeException("Product Conversion not found"));
    }

    @PutMapping("/api/v1/production/conversions/{id}")
    public ProductConversion updateConversion(@PathVariable Long id, @RequestBody ProductConversion pc, Principal p) {
        return productConversionService.update(id, pc, principalName(p));
    }

    @DeleteMapping("/api/v1/production/conversions/{id}")
    public void deleteConversion(@PathVariable Long id) {
        productConversionService.delete(id);
    }

    @PostMapping("/api/v1/production/conversions/{id}/actions/{action}")
    @Transactional
    public ProductConversion conversionAction(@PathVariable Long id, @PathVariable String action, Principal p) {
        return productConversionService.action(id, action, principalName(p));
    }

    // ===========================
    // ---- PRODUCTION RETURN ----
    // ===========================

    @GetMapping("/api/v1/production/returns")
    public List<ProductionReturn> listReturns() { return productionReturns.findAll(); }

    @PostMapping("/api/v1/production/returns")
    public ProductionReturn createReturn(@RequestBody ProductionReturn pr, Principal p) {
        return productionReturnService.create(pr, principalName(p));
    }

    @GetMapping("/api/v1/production/returns/{id}")
    public ProductionReturn getReturn(@PathVariable Long id) {
        return productionReturns.findById(id).orElseThrow(() -> new RuntimeException("Production Return not found"));
    }

    @PutMapping("/api/v1/production/returns/{id}")
    public ProductionReturn updateReturn(@PathVariable Long id, @RequestBody ProductionReturn pr, Principal p) {
        return productionReturnService.update(id, pr, principalName(p));
    }

    @DeleteMapping("/api/v1/production/returns/{id}")
    public void deleteReturn(@PathVariable Long id) {
        productionReturnService.delete(id);
    }

    @PostMapping("/api/v1/production/returns/{id}/actions/{action}")
    @Transactional
    public ProductionReturn returnAction(@PathVariable Long id, @PathVariable String action, Principal p) {
        return productionReturnService.action(id, action, principalName(p));
    }

    // ===========================
    // ---- PRODUCTION LOG SHEET --
    // ===========================

    @GetMapping("/api/v1/production/log-sheets")
    public List<ProductionLogSheet> listLogSheets() { return productionLogSheets.findAll(); }

    @PostMapping("/api/v1/production/log-sheets")
    public ProductionLogSheet createLogSheet(@RequestBody ProductionLogSheet ls, Principal p) {
        ls.setId(null);
        ls.setLogNumber(numbers.next("production-log-sheet", "PLS"));
        if (ls.getLogDate() == null) ls.setLogDate(Instant.now());
        if (ls.getStatus() == null) ls.setStatus("DRAFT");
        ls.setCreatedBy(principalName(p));
        ls.setCreatedAt(Instant.now());
        return productionLogSheets.save(ls);
    }

    @GetMapping("/api/v1/production/log-sheets/{id}")
    public ProductionLogSheet getLogSheet(@PathVariable Long id) {
        return productionLogSheets.findById(id).orElseThrow(() -> new RuntimeException("Production Log Sheet not found"));
    }

    @PutMapping("/api/v1/production/log-sheets/{id}")
    public ProductionLogSheet updateLogSheet(@PathVariable Long id, @RequestBody ProductionLogSheet ls, Principal p) {
        ProductionLogSheet e = productionLogSheets.findById(id).orElseThrow(() -> new RuntimeException("Production Log Sheet not found"));
        ls.setId(id);
        ls.setLogNumber(e.getLogNumber());
        ls.setCreatedAt(e.getCreatedAt());
        ls.setCreatedBy(e.getCreatedBy());
        ls.setUpdatedAt(Instant.now());
        ls.setUpdatedBy(principalName(p));
        return productionLogSheets.save(ls);
    }

    @DeleteMapping("/api/v1/production/log-sheets/{id}")
    public void deleteLogSheet(@PathVariable Long id) {
        ProductionLogSheet e = productionLogSheets.findById(id).orElseThrow(() -> new RuntimeException("Production Log Sheet not found"));
        if (!"DRAFT".equals(e.getStatus())) throw new RuntimeException("Only DRAFT log sheets can be deleted");
        productionLogActivities.findByLogSheetId(id).forEach(l -> productionLogActivities.deleteById(l.getId()));
        productionLogSheets.deleteById(id);
    }

    @PostMapping("/api/v1/production/log-sheets/{id}/actions/{action}")
    public ProductionLogSheet logSheetAction(@PathVariable Long id, @PathVariable String action, Principal p) {
        ProductionLogSheet ls = productionLogSheets.findById(id).orElseThrow(() -> new RuntimeException("Production Log Sheet not found"));
        switch (action.toLowerCase()) {
            case "verify": ls.setStatus("VERIFIED"); break;
            case "close": ls.setStatus("CLOSED"); break;
            case "cancel": ls.setStatus("CANCELLED"); break;
            default: throw new RuntimeException("Unknown action: " + action);
        }
        ls.setUpdatedAt(Instant.now());
        ls.setUpdatedBy(principalName(p));
        return productionLogSheets.save(ls);
    }

    // ---- Activities ----

    @GetMapping("/api/v1/production/log-sheets/{id}/activities")
    public List<ProductionLogActivity> getActivities(@PathVariable Long id) {
        return productionLogActivities.findByLogSheetId(id);
    }

    @PostMapping("/api/v1/production/log-sheets/{id}/activities")
    public ProductionLogActivity addActivity(@PathVariable Long id, @RequestBody ProductionLogActivity act, Principal p) {
        ProductionLogSheet ls = productionLogSheets.findById(id).orElseThrow(() -> new RuntimeException("Production Log Sheet not found"));
        act.setId(null);
        act.setLogSheet(ls);
        if (act.getStartTime() != null && act.getEndTime() != null) {
            if (act.getEndTime().isBefore(act.getStartTime())) {
                throw new IllegalArgumentException("End time cannot be earlier than start time.");
            }
            long mins = ChronoUnit.MINUTES.between(act.getStartTime(), act.getEndTime());
            act.setDuration(BigDecimal.valueOf(mins));
        }
        act.setCreatedAt(Instant.now());
        return productionLogActivities.save(act);
    }

    @PutMapping("/api/v1/production/log-sheets/activities/{lineId}")
    public ProductionLogActivity updateActivity(@PathVariable Long lineId, @RequestBody ProductionLogActivity act, Principal p) {
        ProductionLogActivity e = productionLogActivities.findById(lineId).orElseThrow(() -> new RuntimeException("Activity not found"));
        act.setId(lineId);
        act.setLogSheet(e.getLogSheet());
        if (act.getStartTime() != null && act.getEndTime() != null) {
            if (act.getEndTime().isBefore(act.getStartTime())) {
                throw new IllegalArgumentException("End time cannot be earlier than start time.");
            }
            long mins = ChronoUnit.MINUTES.between(act.getStartTime(), act.getEndTime());
            act.setDuration(BigDecimal.valueOf(mins));
        }
        act.setCreatedAt(e.getCreatedAt());
        act.setUpdatedAt(Instant.now());
        return productionLogActivities.save(act);
    }

    @DeleteMapping("/api/v1/production/log-sheets/activities/{lineId}")
    public void deleteActivity(@PathVariable Long lineId) { productionLogActivities.deleteById(lineId); }

    // ===========================
    // ---- IDLE TIME ------------
    // ===========================

    @GetMapping("/api/v1/production/idle-time")
    public List<IdleTimeEntry> listIdleTime() { return idleTimeEntries.findAll(); }

    @PostMapping("/api/v1/production/idle-time")
    public IdleTimeEntry createIdleTime(@RequestBody IdleTimeEntry it, Principal p) {
        it.setId(null);
        it.setEntryNumber(numbers.next("idle-time-entry", "ITE"));
        if (it.getEntryDate() == null) it.setEntryDate(Instant.now());
        if (it.getDuration() == null) it.setDuration(BigDecimal.ZERO);
        if (it.getStatus() == null) it.setStatus("DRAFT");
        it.setCreatedBy(principalName(p));
        it.setCreatedAt(Instant.now());
        return idleTimeEntries.save(it);
    }

    @GetMapping("/api/v1/production/idle-time/{id}")
    public IdleTimeEntry getIdleTime(@PathVariable Long id) {
        return idleTimeEntries.findById(id).orElseThrow(() -> new RuntimeException("Idle Time Entry not found"));
    }

    @PutMapping("/api/v1/production/idle-time/{id}")
    public IdleTimeEntry updateIdleTime(@PathVariable Long id, @RequestBody IdleTimeEntry it, Principal p) {
        IdleTimeEntry e = idleTimeEntries.findById(id).orElseThrow(() -> new RuntimeException("Idle Time Entry not found"));
        it.setId(id);
        it.setEntryNumber(e.getEntryNumber());
        it.setCreatedAt(e.getCreatedAt());
        it.setCreatedBy(e.getCreatedBy());
        it.setUpdatedAt(Instant.now());
        it.setUpdatedBy(principalName(p));
        return idleTimeEntries.save(it);
    }

    @DeleteMapping("/api/v1/production/idle-time/{id}")
    public void deleteIdleTime(@PathVariable Long id) {
        IdleTimeEntry e = idleTimeEntries.findById(id).orElseThrow(() -> new RuntimeException("Idle Time Entry not found"));
        if (!"DRAFT".equals(e.getStatus())) throw new RuntimeException("Only DRAFT idle time entries can be deleted");
        idleTimeEntries.deleteById(id);
    }

    @PostMapping("/api/v1/production/idle-time/{id}/actions/{action}")
    public IdleTimeEntry idleTimeAction(@PathVariable Long id, @PathVariable String action, Principal p) {
        IdleTimeEntry it = idleTimeEntries.findById(id).orElseThrow(() -> new RuntimeException("Idle Time Entry not found"));
        switch (action.toLowerCase()) {
            case "verify": it.setStatus("VERIFIED"); break;
            case "cancel": it.setStatus("CANCELLED"); break;
            default: throw new RuntimeException("Unknown action: " + action);
        }
        it.setUpdatedAt(Instant.now());
        it.setUpdatedBy(principalName(p));
        return idleTimeEntries.save(it);
    }

    // ===========================
    // ---- PRODUCTION PENDING ---
    // ===========================

    @GetMapping("/api/v1/production/{type}/{id}/print")
    ResponseEntity<byte[]> print(@PathVariable String type, @PathVariable Long id,
                                  @RequestParam(defaultValue = "false") boolean download) {
        Map<String, Object> row = productionRow(type, id);
        String docNo = String.valueOf(row.getOrDefault("docNo", type)).replaceAll("[^A-Za-z0-9_-]", "_");
        String disposition = download ? "attachment" : "inline";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        disposition + "; filename=\"" + docNo + ".pdf\"")
                .contentType(MediaType.APPLICATION_PDF)
                .body(printer.salesDoc(row, type));
    }

    private Map<String, Object> productionRow(String type, Long id) {
        Map<String, Object> row = new LinkedHashMap<>();
        switch (type) {
            case "entries": {
                ProductionEntry e = productionEntries.findById(id)
                    .orElseThrow(() -> new RuntimeException("Production Entry not found"));
                row.put("docNo", e.getEntryNumber());
                row.put("entryNumber", e.getEntryNumber());
                row.put("workOrderNumber", e.getWorkOrderNumber());
                row.put("jobCardNumber", e.getJobCardNumber());
                row.put("subjobNumber", e.getSubjobNumber());
                row.put("partCode", e.getPartCode());
                row.put("partDescription", e.getPartDescription());
                row.put("operationCode", e.getOperationCode());
                row.put("machineCode", e.getMachineCode());
                row.put("operatorCode", e.getOperatorCode());
                row.put("shiftCode", e.getShiftCode());
                row.put("productionDate", e.getProductionDate());
                row.put("startTime", e.getStartTime());
                row.put("endTime", e.getEndTime());
                row.put("producedQuantity", e.getProducedQuantity());
                row.put("goodQuantity", e.getGoodQuantity());
                row.put("reworkQuantity", e.getReworkQuantity());
                row.put("rejectedQuantity", e.getRejectedQuantity());
                row.put("scrapQuantity", e.getScrapQuantity());
                row.put("status", e.getStatus());
                row.put("qualityStatus", e.getQualityStatus());
                row.put("remarks", e.getRemarks());
                break;
            }
            case "job-cards": {
                JobCard jc = jobCards.findById(id)
                    .orElseThrow(() -> new RuntimeException("Job Card not found"));
                row.put("docNo", jc.getJobCardNumber());
                row.put("jobCardNumber", jc.getJobCardNumber());
                row.put("workOrderNumber", jc.getWorkOrderNumber());
                row.put("partCode", jc.getPartCode());
                row.put("partDescription", jc.getPartDescription());
                row.put("revision", jc.getRevision());
                row.put("plannedQuantity", jc.getPlannedQuantity());
                row.put("completedQuantity", jc.getCompletedQuantity());
                row.put("reworkQuantity", jc.getReworkQuantity());
                row.put("rejectedQuantity", jc.getRejectedQuantity());
                row.put("scrapQuantity", jc.getScrapQuantity());
                row.put("priority", jc.getPriority());
                row.put("plannedStartDate", jc.getPlannedStartDate());
                row.put("plannedEndDate", jc.getPlannedEndDate());
                row.put("routeSheetNumber", jc.getRouteSheetNumber());
                row.put("bomNumber", jc.getBomNumber());
                row.put("customerCode", jc.getCustomerCode());
                row.put("status", jc.getStatus());
                row.put("remarks", jc.getRemarks());
                break;
            }
            case "returns": {
                ProductionReturn pr = productionReturns.findById(id)
                    .orElseThrow(() -> new RuntimeException("Production Return not found"));
                row.put("docNo", pr.getReturnNumber());
                row.put("returnNumber", pr.getReturnNumber());
                row.put("returnDate", pr.getReturnDate());
                row.put("workOrderNumber", pr.getWorkOrderNumber());
                row.put("jobCardNumber", pr.getJobCardNumber());
                row.put("itemCode", pr.getItemCode());
                row.put("itemDescription", pr.getItemDescription());
                row.put("batchNumber", pr.getBatchNumber());
                row.put("quantity", pr.getQuantity());
                row.put("uom", pr.getUom());
                row.put("returnReason", pr.getReturnReason());
                row.put("condition", pr.getCondition());
                row.put("warehouse", pr.getWarehouse());
                row.put("status", pr.getStatus());
                row.put("remarks", pr.getRemarks());
                break;
            }
            case "log-sheets": {
                ProductionLogSheet ls = productionLogSheets.findById(id)
                    .orElseThrow(() -> new RuntimeException("Production Log Sheet not found"));
                row.put("docNo", ls.getLogNumber());
                row.put("logNumber", ls.getLogNumber());
                row.put("logDate", ls.getLogDate());
                row.put("workOrderNumber", ls.getWorkOrderNumber());
                row.put("jobCardNumber", ls.getJobCardNumber());
                row.put("machineCode", ls.getMachineCode());
                row.put("operatorCode", ls.getOperatorCode());
                row.put("shiftCode", ls.getShiftCode());
                row.put("status", ls.getStatus());
                row.put("remarks", ls.getRemarks());
                break;
            }
            case "conversions": {
                ProductConversion pc = productConversions.findById(id)
                    .orElseThrow(() -> new RuntimeException("Product Conversion not found"));
                row.put("docNo", pc.getConversionNumber());
                row.put("conversionNumber", pc.getConversionNumber());
                row.put("conversionDate", pc.getConversionDate());
                row.put("conversionType", pc.getConversionType());
                row.put("sourceWarehouse", pc.getSourceWarehouse());
                row.put("destinationWarehouse", pc.getDestinationWarehouse());
                row.put("workOrderNumber", pc.getWorkOrderNumber());
                row.put("jobCardNumber", pc.getJobCardNumber());
                row.put("inputItemCode", pc.getInputItemCode());
                row.put("inputQuantity", pc.getInputQuantity());
                row.put("inputUom", pc.getInputUom());
                row.put("outputItemCode", pc.getOutputItemCode());
                row.put("outputQuantity", pc.getOutputQuantity());
                row.put("outputUom", pc.getOutputUom());
                row.put("processLossQty", pc.getProcessLossQty());
                row.put("scrapQty", pc.getScrapQty());
                row.put("status", pc.getStatus());
                row.put("remarks", pc.getRemarks());
                break;
            }
            default:
                throw new RuntimeException("Unknown production type: " + type);
        }
        return row;
    }

    @GetMapping("/api/v1/production/pending")
    public List<Map<String, Object>> getProductionPending() {
        List<Map<String, Object>> pending = new ArrayList<>();

        List<JobCard> activeJobCards = new ArrayList<>();
        activeJobCards.addAll(jobCards.findByStatus("RELEASED"));
        activeJobCards.addAll(jobCards.findByStatus("IN_PROGRESS"));
        activeJobCards.addAll(jobCards.findByStatus("ON_HOLD"));

        for (JobCard jc : activeJobCards) {
            BigDecimal planned = jc.getPlannedQuantity() == null ? BigDecimal.ZERO : jc.getPlannedQuantity();
            BigDecimal completed = jc.getCompletedQuantity() == null ? BigDecimal.ZERO : jc.getCompletedQuantity();
            BigDecimal pendingQty = planned.subtract(completed);

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("jobCardNumber", jc.getJobCardNumber());
            item.put("workOrderNumber", jc.getWorkOrderNumber());
            item.put("partCode", jc.getPartCode());
            item.put("partDescription", jc.getPartDescription());
            item.put("plannedQuantity", planned);
            item.put("completedQuantity", completed);
            item.put("pendingQuantity", pendingQty);
            item.put("status", jc.getStatus());
            item.put("priority", jc.getPriority());
            item.put("plannedStartDate", jc.getPlannedStartDate());
            item.put("plannedEndDate", jc.getPlannedEndDate());

            long daysPending = 0;
            if (jc.getPlannedStartDate() != null) {
                daysPending = ChronoUnit.DAYS.between(
                    jc.getPlannedStartDate().atZone(ZoneId.systemDefault()).toLocalDate(),
                    LocalDate.now()
                );
            }
            item.put("daysPending", daysPending);

            boolean overdue = jc.getPlannedEndDate() != null &&
                jc.getPlannedEndDate().atZone(ZoneId.systemDefault()).toLocalDate().isBefore(LocalDate.now());
            item.put("overdue", overdue);

            pending.add(item);
        }

        return pending;
    }

    // ===========================
    // ---- Production Dashboard --
    // ===========================

    @GetMapping("/api/v1/production/dashboard")
    public Map<String, Object> getProductionDashboard() {
        Map<String, Object> dash = new LinkedHashMap<>();

        dash.put("totalJobCards", jobCards.count());
        dash.put("draftJobCards", jobCards.countByStatus("DRAFT"));
        dash.put("releasedJobCards", jobCards.countByStatus("RELEASED"));
        dash.put("inProgressJobCards", jobCards.countByStatus("IN_PROGRESS"));
        dash.put("onHoldJobCards", jobCards.countByStatus("ON_HOLD"));
        dash.put("completedJobCards", jobCards.countByStatus("COMPLETED"));
        dash.put("closedJobCards", jobCards.countByStatus("CLOSED"));

        dash.put("totalProductionEntries", productionEntries.count());
        dash.put("approvedEntries", productionEntries.countByStatus("APPROVED"));
        dash.put("pendingEntries", productionEntries.countByStatus("SUBMITTED"));
        dash.put("qualityPending", productionEntries.findByStatus("APPROVED").stream()
            .filter(e -> "PENDING".equals(e.getQualityStatus()))
            .count());

        dash.put("totalProducedQuantity", jobCards.sumCompletedQuantity());

        dash.put("totalConversions", productConversions.count());
        dash.put("totalReturns", productionReturns.count());
        dash.put("totalLogSheets", productionLogSheets.count());
        dash.put("totalIdleTimeEntries", idleTimeEntries.count());

        return dash;
    }
}
