package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.security.Principal;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.*;
import java.util.stream.Collectors;

@Service
@Slf4j
@RequiredArgsConstructor
public class MaintenanceService {

    private final BreakdownIntimationRepository breakdowns;
    private final BreakdownRectificationRepository rectifications;
    private final PMPlanRepository pmPlans;
    private final PMScheduleRepository pmSchedules;
    private final PMCompletionRepository pmCompletions;
    private final ToolServiceIntimationRepository toolServices;
    private final ToolServiceRectificationRepository toolRectifications;
    private final CalibrationScheduleRepository calSchedules;
    private final CalibrationEntryRepository calEntries;
    private final PowerConsumptionRepository powerConsumptions;
    private final WaterConsumptionRepository waterConsumptions;
    private final RootCauseAnalysisRepository rootCauseAnalyses;

    private final DocNumberService numbers;
    private final MachineMasterRepository machines;
    private final DocumentWorkflowEngine workflowEngine;
    private final in.zygertechnology.zygererp.service.SparePartStockService sparePartStockService;

    private final DepartmentMasterRepository departments;
    private final TechnicianMasterRepository technicians;
    private final BreakdownCategoryMasterRepository breakdownCategories;
    private final FailureCodeMasterRepository failureCodes;
    private final RootCauseCodeMasterRepository rootCauseCodes;
    private final MaintenanceActivityMasterRepository activities;
    private final PmChecklistTemplateRepository pmChecklistTemplates;
    private final BreakdownAssignmentRepository breakdownAssignments;
    private final PmCompletionChecklistItemRepository pmChecklistItems;
    private final DowntimeTransactionRepository downtimeTransactions;
    private final MaintenanceAttachmentRepository maintenanceAttachments;
    private final NotificationLogRepository notificationLogs;
    private final NotificationService notificationService;
    private final InstrumentMasterRepository instruments;
    private final MaintenanceCostTransactionRepository maintenanceCosts;
    private final VendorMasterRepository vendors;
    private final MachineOperatingHoursRepository operatingHoursRepo;
    private final MaintenanceCostAdjustmentRepository costAdjustments;

    // ===========================
    // ---- HELPER METHODS -------
    // ===========================

    public String principalName(Principal p) { return p != null ? p.getName() : "system"; }

    public void audit(Object e, String user) {
        try {
            var m = e.getClass().getMethod("setUpdatedAt", Instant.class);
            m.invoke(e, Instant.now());
            if (user != null) {
                var mb = e.getClass().getMethod("setUpdatedBy", String.class);
                mb.invoke(e, user);
            }
        } catch (Exception ignored) {}
    }

    public void setCreated(Object e, String user) {
        try {
            e.getClass().getMethod("setCreatedAt", Instant.class).invoke(e, Instant.now());
            e.getClass().getMethod("setCreatedBy", String.class).invoke(e, user);
        } catch (Exception ignored) {}
    }

    public void updateMachineStatus(String machineCode, String newStatus) {
        if (machineCode == null || machineCode.isBlank()) return;
        machines.findByCode(machineCode).ifPresent(m -> {
            m.setStatus(newStatus);
            m.setUpdatedAt(Instant.now());
            machines.save(m);
        });
    }

    public static boolean isCriticalOrHigh(String priority) {
        return "CRITICAL".equalsIgnoreCase(priority) || "HIGH".equalsIgnoreCase(priority);
    }

    public void releaseMachineFromBreakdown(Long breakdownId, String machineCode) {
        if (machineCode == null || machineCode.isBlank()) return;
        boolean othersStillOpen = breakdowns.findByMachineCode(machineCode).stream()
                .anyMatch(b -> !Objects.equals(b.getId(), breakdownId)
                        && !"CLOSED".equals(b.getStatus()) && !"CANCELLED".equals(b.getStatus()));
        if (!othersStillOpen) updateMachineStatus(machineCode, "AVAILABLE");
    }

    public void createDowntimeTransaction(String machineCode, String sourceType, Long sourceId, Instant start, Instant end) {
        if (machineCode == null || start == null || end == null) return;
        var machine = machines.findByCode(machineCode).orElse(null);
        if (machine == null) return;
        BigDecimal rawDuration = BigDecimal.valueOf(ChronoUnit.MINUTES.between(start, end));
        boolean flagged = false;
        BigDecimal duration = rawDuration;
        BigDecimal ceiling = BigDecimal.valueOf(43200); // 30 days — BR-14 ceiling
        if (rawDuration.compareTo(ceiling) > 0) {
            duration = ceiling;
            flagged = true;
        }
        DowntimeTransaction dt = DowntimeTransaction.builder()
                .machineId(machine.getId()).machineCode(machineCode)
                .sourceType(sourceType).sourceId(sourceId)
                .startTime(start).endTime(end).durationMinutes(duration)
                .dataQualityFlag(flagged)
                .build();
        downtimeTransactions.save(dt);
    }

    public LocalDate calculateNextDate(LocalDate from, String frequency) {
        if (frequency == null) return from.plusMonths(1);
        return switch (frequency.toUpperCase()) {
            case "DAILY" -> from.plusDays(1);
            case "WEEKLY" -> from.plusWeeks(1);
            case "MONTHLY" -> from.plusMonths(1);
            case "QUARTERLY" -> from.plusMonths(3);
            case "HALF-YEARLY" -> from.plusMonths(6);
            case "YEARLY" -> from.plusYears(1);
            default -> from.plusMonths(1);
        };
    }

    /**
     * §10.4: When a maintenance document is CLOSED (breakdown/tool rectification) or
     * finalized (calibration entry COMPLETED), its cost transactions become immutable so
     * they can no longer be edited or reversed.
     */
    public void finalizeCostOnClose(String parentType, Long parentId) {
        try {
            maintenanceCosts.findByParentTypeAndParentId(parentType, parentId)
                    .forEach(c -> {
                        if (!Boolean.TRUE.equals(c.getImmutable())) {
                            c.setImmutable(true);
                            c.setUpdatedAt(Instant.now());
                            maintenanceCosts.save(c);
                        }
                    });
        } catch (Exception ex) {
            log.error("finalizeCostOnClose failed parentType={} parentId={}", parentType, parentId, ex);
        }
    }

    /** BR-12: corrections on a CLOSED/immutable cost row go through adjustment records, never an UPDATE/DELETE. */
    @Transactional
    public Map<String, Object> adjustCost(Long costId, BigDecimal deltaAmount, String reason, String user) {
        MaintenanceCostTransaction c = maintenanceCosts.findById(costId)
                .orElseThrow(() -> new IllegalArgumentException("Cost row not found: " + costId));
        if (deltaAmount == null || deltaAmount.signum() == 0) {
            throw new IllegalArgumentException("Adjustment amount must be non-zero");
        }
        if (Boolean.TRUE.equals(c.getImmutable())) {
            MaintenanceCostAdjustment a = MaintenanceCostAdjustment.builder()
                    .costTransactionId(c.getId())
                    .parentType(c.getParentType())
                    .parentId(c.getParentId())
                    .parentNumber(c.getParentNumber())
                    .machineCode(c.getMachineCode())
                    .adjustmentType("ADJUST")
                    .deltaAmount(deltaAmount)
                    .reason(reason)
                    .postedBy(user)
                    .postedAt(Instant.now())
                    .build();
            costAdjustments.save(a);
            return Map.of("id", a.getId(), "costTransactionId", c.getId(), "deltaAmount", deltaAmount,
                    "adjusted", true, "message", "Adjustment recorded against immutable cost row");
        }
        // Not yet immutable: apply the correction directly on the row itself.
        c.setAmount(c.getAmount() == null ? deltaAmount : c.getAmount().add(deltaAmount));
        c.setUpdatedAt(Instant.now());
        maintenanceCosts.save(c);
        return Map.of("costTransactionId", c.getId(), "amount", c.getAmount(), "adjusted", false);
    }

    public List<Map<String, Object>> listCostAdjustments(Long costId) {
        return costAdjustments.findByCostTransactionId(costId).stream().map(a -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", a.getId());
            m.put("costTransactionId", a.getCostTransactionId());
            m.put("adjustmentType", a.getAdjustmentType());
            m.put("deltaAmount", a.getDeltaAmount());
            m.put("reason", a.getReason());
            m.put("postedBy", a.getPostedBy());
            m.put("postedAt", a.getPostedAt());
            return m;
        }).toList();
    }

    // ===========================
    // ---- BREAKDOWN INTIMATION -
    // ===========================

    public List<Map<String, Object>> listBreakdowns() {
        return breakdowns.findAll().stream().map(this::enrichBreakdown).toList();
    }

    public Map<String, Object> enrichBreakdown(BreakdownIntimation bd) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", bd.getId());
        m.put("breakdownNumber", bd.getBreakdownNumber());
        m.put("breakdownDate", bd.getBreakdownDate());
        m.put("breakdownTime", bd.getBreakdownTime());
        m.put("machineCode", bd.getMachineCode());
        m.put("machineStatus", bd.getMachineStatus());
        m.put("reportedBy", bd.getReportedBy());
        m.put("operatorCode", bd.getOperatorCode());
        m.put("shiftCode", bd.getShiftCode());
        m.put("breakdownCategory", bd.getBreakdownCategory());
        m.put("cncAlarmCode", bd.getCncAlarmCode());
        m.put("problemDescription", bd.getProblemDescription());
        m.put("productionImpact", bd.getProductionImpact());
        m.put("priority", bd.getPriority());
        m.put("assignedTo", bd.getAssignedTo());
        m.put("diagnosis", bd.getDiagnosis());
        m.put("status", bd.getStatus());
        m.put("remarks", bd.getRemarks());
        m.put("createdAt", bd.getCreatedAt());
        if (bd.getStatus() != null) {
            workflowEngine.enrich("BREAKDOWN_INTIMATION", bd.getStatus(), m);
        }
        return m;
    }

    public BreakdownIntimation createBreakdown(BreakdownIntimation bd, Principal principal) {
        bd.setId(null);
        bd.setBreakdownNumber(numbers.next("breakdown-intimation", "BDI"));
        if (bd.getBreakdownDate() == null) bd.setBreakdownDate(LocalDate.now());
        if (bd.getBreakdownStartTime() == null) bd.setBreakdownStartTime(Instant.now());
        if (bd.getStatus() == null) bd.setStatus("OPEN");
        if (bd.getPriority() == null) bd.setPriority("MEDIUM");
        if (bd.getMachineCode() != null && !bd.getMachineCode().isBlank()) {
            if (!machines.existsByCode(bd.getMachineCode())) {
                throw new RuntimeException("Machine code '" + bd.getMachineCode() + "' does not exist");
            }
            if (!breakdowns.findActiveByMachineCode(bd.getMachineCode()).isEmpty()) {
                throw new IllegalStateException("Breakdown already open for machine '" + bd.getMachineCode() + "' (BR-12)");
            }
        }
        setCreated(bd, principalName(principal));
        breakdowns.save(bd);
        if (isCriticalOrHigh(bd.getPriority())) updateMachineStatus(bd.getMachineCode(), "BREAKDOWN");

        try {
            String mDisplay = bd.getMachineCode() != null ? bd.getMachineCode() : "N/A";
            if (bd.getMachineCode() != null && !bd.getMachineCode().isBlank()) {
                mDisplay = machines.findByCode(bd.getMachineCode())
                        .map(m -> m.getName() != null && !m.getName().isBlank() ? bd.getMachineCode() + " (" + m.getName() + ")" : bd.getMachineCode())
                        .orElse(bd.getMachineCode());
            }
            String alarmCode = (bd.getCncAlarmCode() != null && !bd.getCncAlarmCode().isBlank()) ? bd.getCncAlarmCode() : "N/A";
            String notifMsg = String.format("Breakdown Intimation Created - Breakdown No: %s | Machine: %s | Alarm Code: %s",
                    bd.getBreakdownNumber(), mDisplay, alarmCode);

            notificationService.notify(
                    "BREAKDOWN_CREATED",
                    "MAINTENANCE",
                    "BreakdownIntimation",
                    bd.getId(),
                    isCriticalOrHigh(bd.getPriority()) ? "CRITICAL" : "WARNING",
                    notifMsg,
                    bd.getBreakdownNumber()
            );

            NotificationLog nl = NotificationLog.builder()
                    .recipient("ALL")
                    .channel("IN_APP")
                    .subject("Breakdown Intimation Created: " + bd.getBreakdownNumber())
                    .body(notifMsg)
                    .sourceType("BREAKDOWN_INTIMATION")
                    .sourceId(bd.getId())
                    .status("SENT")
                    .sentAt(Instant.now())
                    .build();
            notificationLogs.save(nl);
        } catch (Exception ex) {
            log.error("Failed to generate breakdown creation notification for id={}", bd.getId(), ex);
        }

        return bd;
    }

    public BreakdownIntimation updateBreakdown(Long id, BreakdownIntimation bd, Principal principal) {
        BreakdownIntimation e = breakdowns.findById(id).orElseThrow(() -> new RuntimeException("Breakdown not found"));
        bd.setId(id);
        bd.setBreakdownNumber(e.getBreakdownNumber());
        bd.setCreatedAt(e.getCreatedAt());
        bd.setCreatedBy(e.getCreatedBy());
        audit(bd, principalName(principal));
        return breakdowns.save(bd);
    }

    public BreakdownIntimation getBreakdown(Long id) {
        return breakdowns.findById(id).orElseThrow(() -> new RuntimeException("Breakdown not found"));
    }

    public void deleteBreakdown(Long id) {
        BreakdownIntimation e = breakdowns.findById(id).orElseThrow(() -> new RuntimeException("Breakdown not found"));
        if ("CLOSED".equals(e.getStatus())) throw new RuntimeException("CLOSED breakdowns cannot be deleted");
        breakdowns.deleteById(id);
    }

    public Map<String, Object> breakdownAction(Long id, String action, Map<String, String> body, Principal principal) {
        BreakdownIntimation bd = breakdowns.findById(id).orElseThrow(() -> new RuntimeException("Breakdown not found"));
        String note = body != null ? body.getOrDefault("note", "") : "";
        Map<String, Object> result = new LinkedHashMap<>();

        switch (action.toLowerCase()) {
            case "assign":
                bd.setStatus("ASSIGNED");
                bd.setAssignedTo(note);
                break;
            case "diagnose":
                bd.setStatus("DIAGNOSED");
                bd.setDiagnosis(note);
                break;
            case "close":
                List<BreakdownRectification> rects = rectifications.findByBreakdownId(id);
                if (rects.isEmpty()) {
                    result.put("success", false);
                    result.put("errors", List.of("Cannot close without rectification details"));
                    return result;
                }
                boolean hasPassed = rects.stream().anyMatch(r -> "PASS".equals(r.getTestingResult()));
                if (!hasPassed) {
                    result.put("success", false);
                    result.put("errors", List.of("Cannot close: at least one rectification must have testingResult=PASS (BR-03)"));
                    return result;
                }
                bd.setStatus("CLOSED");
                releaseMachineFromBreakdown(id, bd.getMachineCode());
                break;
            case "cancel":
                bd.setStatus("CANCELLED");
                releaseMachineFromBreakdown(id, bd.getMachineCode());
                break;
            default:
                throw new RuntimeException("Unknown action: " + action);
        }
        audit(bd, principalName(principal));
        breakdowns.save(bd);
        result.put("success", true);
        result.put("data", breakdowns.findById(id).orElse(bd));
        return result;
    }

    // ===========================
    // ---- BREAKDOWN RECTIFICATION
    // ===========================

    public List<BreakdownRectification> listRectifications() { return rectifications.findAll(); }

    public BreakdownRectification createRectification(BreakdownRectification r, Principal principal) {
        r.setId(null);
        r.setRectificationNumber(numbers.next("breakdown-rectification", "BDR"));
        if (r.getBreakdownId() != null) {
            BreakdownIntimation bd = breakdowns.findById(r.getBreakdownId()).orElse(null);
            if (bd != null) {
                r.setBreakdownNumber(bd.getBreakdownNumber());
                r.setMachineCode(bd.getMachineCode());
            }
        }
        if (r.getServiceCost() == null) r.setServiceCost(BigDecimal.ZERO);
        if (r.getStatus() == null) r.setStatus("IN_PROGRESS");
        denormalizeRectificationVendor(r);
        setCreated(r, principalName(principal));
        BreakdownRectification saved = rectifications.save(r);

        // §7.3: Auto-post stock issues for linked spare parts
        try { sparePartStockService.postRectificationStockIssues(saved.getId(), saved.getRectificationNumber(), saved.getMachineCode()); }
        catch (Exception ex) { log.warn("Spare part stock issue posting failed for rectification {}: {}", saved.getId(), ex.getMessage()); }

        if (r.getStartTime() != null && r.getEndTime() != null) {
            long mins = ChronoUnit.MINUTES.between(r.getStartTime(), r.getEndTime());
            saved.setDowntimeMinutes(BigDecimal.valueOf(mins));
            rectifications.save(saved);
        }
        return saved;
    }

    public BreakdownRectification updateRectification(Long id, BreakdownRectification r, Principal principal) {
        BreakdownRectification e = rectifications.findById(id).orElseThrow(() -> new RuntimeException("Rectification not found"));
        r.setId(id);
        r.setRectificationNumber(e.getRectificationNumber());
        r.setCreatedAt(e.getCreatedAt());
        r.setCreatedBy(e.getCreatedBy());
        audit(r, principalName(principal));
        denormalizeRectificationVendor(r);
        if (r.getStartTime() != null && r.getEndTime() != null) {
            long mins = ChronoUnit.MINUTES.between(r.getStartTime(), r.getEndTime());
            r.setDowntimeMinutes(BigDecimal.valueOf(mins));
        }
        return rectifications.save(r);
    }

    public BreakdownRectification getRectification(Long id) {
        return rectifications.findById(id).orElseThrow(() -> new RuntimeException("Rectification not found"));
    }

    public void deleteRectification(Long id) {
        BreakdownRectification e = rectifications.findById(id).orElseThrow(() -> new RuntimeException("Rectification not found"));
        if ("CLOSED".equals(e.getStatus())) throw new RuntimeException("CLOSED rectifications cannot be deleted");
        rectifications.deleteById(id);
    }

    public BreakdownRectification rectificationAction(Long id, String action, Principal principal) {
        BreakdownRectification r = rectifications.findById(id).orElseThrow(() -> new RuntimeException("Rectification not found"));
        switch (action.toLowerCase()) {
            case "complete":
                r.setStatus("COMPLETED"); r.setEndTime(Instant.now());
                if (r.getStartTime() != null) {
                    long mins = ChronoUnit.MINUTES.between(r.getStartTime(), r.getEndTime());
                    r.setDowntimeMinutes(BigDecimal.valueOf(mins));
                }
                releaseMachineFromBreakdown(r.getBreakdownId(), r.getMachineCode());
                createDowntimeTransaction(r.getMachineCode(), "BREAKDOWN", r.getBreakdownId(), r.getStartTime(), r.getEndTime());
                break;
            case "pass":
                if (!"COMPLETED".equals(r.getStatus())) {
                    throw new IllegalStateException("Cannot PASS before rectification is COMPLETED (BR-01)");
                }
                r.setTestingResult("PASS");
                break;
            case "fail":
                r.setTestingResult("FAIL");
                if ("COMPLETED".equals(r.getStatus())) {
                    r.setStatus("IN_PROGRESS"); // rework — return to in-progress
                }
                break;
            case "close":
                if (!"COMPLETED".equals(r.getStatus()) || !"PASS".equals(r.getTestingResult())) {
                    throw new IllegalStateException(
                        "Cannot CLOSE: rectification must be COMPLETED with testingResult=PASS (BR-01)");
                }
                r.setStatus("CLOSED");
                releaseMachineFromBreakdown(r.getBreakdownId(), r.getMachineCode());
                finalizeCostOnClose("BREAKDOWN", r.getBreakdownId());
                if (r.getStartTime() != null && r.getEndTime() != null) {
                    createDowntimeTransaction(r.getMachineCode(), "BREAKDOWN", r.getBreakdownId(), r.getStartTime(), r.getEndTime());
                }
                break;
            default: throw new RuntimeException("Unknown action: " + action);
        }
        audit(r, principalName(principal));
        return rectifications.save(r);
    }

    // ===========================
    // ---- PM PLAN -------------
    // ===========================

    public List<PMPlan> listPMPlans() { return pmPlans.findAll(); }

    public PMPlan createPMPlan(PMPlan p, Principal principal) {
        p.setId(null);
        p.setPlanNumber(numbers.next("pm-plan", "PMP"));
        if (p.getStatus() == null) p.setStatus("ACTIVE");
        setCreated(p, principalName(principal));
        return pmPlans.save(p);
    }

    public PMPlan updatePMPlan(Long id, PMPlan p, Principal principal) {
        PMPlan e = pmPlans.findById(id).orElseThrow(() -> new RuntimeException("PM Plan not found"));
        p.setId(id);
        p.setPlanNumber(e.getPlanNumber());
        p.setCreatedAt(e.getCreatedAt());
        p.setCreatedBy(e.getCreatedBy());
        audit(p, principalName(principal));
        return pmPlans.save(p);
    }

    public PMPlan getPMPlan(Long id) {
        return pmPlans.findById(id).orElseThrow(() -> new RuntimeException("PM Plan not found"));
    }

    public void deletePMPlan(Long id) {
        PMPlan e = pmPlans.findById(id).orElseThrow(() -> new RuntimeException("PM Plan not found"));
        if ("INACTIVE".equals(e.getStatus())) throw new RuntimeException("Cannot delete inactive plans");
        pmPlans.deleteById(id);
    }

    public PMPlan pmPlanAction(Long id, String action, Principal principal) {
        PMPlan p = pmPlans.findById(id).orElseThrow(() -> new RuntimeException("PM Plan not found"));
        switch (action.toLowerCase()) {
            case "activate": p.setStatus("ACTIVE"); break;
            case "deactivate": p.setStatus("INACTIVE"); break;
            default: throw new RuntimeException("Unknown action: " + action);
        }
        audit(p, principalName(principal));
        return pmPlans.save(p);
    }

    public Map<String, Object> generatePMSchedule(Long id, Principal principal) {
        PMPlan plan = pmPlans.findById(id).orElseThrow(() -> new RuntimeException("PM Plan not found"));
        LocalDate baseDate = plan.getNextDueDate() != null ? plan.getNextDueDate() : LocalDate.now();
        LocalDate scheduleDate = baseDate;
        List<PMSchedule> generated = new ArrayList<>();

        for (int i = 0; i < 12; i++) {
            PMSchedule s = new PMSchedule();
            s.setScheduleNumber(numbers.next("pm-schedule", "PMS"));
            s.setPlanId(plan.getId());
            s.setPlanNumber(plan.getPlanNumber());
            s.setMachineCode(plan.getMachineCode());
            s.setScheduledDate(scheduleDate);
            s.setDueDate(scheduleDate);
            s.setStatus("UPCOMING");
            s.setPriority("MEDIUM");
            setCreated(s, principalName(principal));
            generated.add(pmSchedules.save(s));
            scheduleDate = calculateNextDate(scheduleDate, plan.getFrequency());
        }

        plan.setLastMaintenanceDate(baseDate);
        plan.setNextDueDate(scheduleDate);
        audit(plan, principalName(principal));
        pmPlans.save(plan);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("count", generated.size());
        result.put("nextDueDate", scheduleDate);
        return result;
    }

    // ===========================
    // ---- PM SCHEDULE ----------
    // ===========================

    public List<Map<String, Object>> listPMSchedules() {
        return pmSchedules.findAll().stream().map(s -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", s.getId());
            m.put("scheduleNumber", s.getScheduleNumber());
            m.put("planId", s.getPlanId());
            m.put("planNumber", s.getPlanNumber());
            m.put("machineCode", s.getMachineCode());
            m.put("scheduledDate", s.getScheduledDate());
            m.put("dueDate", s.getDueDate());
            m.put("completedDate", s.getCompletedDate());
            m.put("assignedTo", s.getAssignedTo());
            m.put("status", s.getStatus());
            m.put("priority", s.getPriority());
            m.put("remarks", s.getRemarks());
            m.put("createdAt", s.getCreatedAt());
            if (s.getStatus() != null) {
                workflowEngine.enrich("PM_SCHEDULE", s.getStatus(), m);
            }
            return m;
        }).toList();
    }

    public PMSchedule createPMSchedule(PMSchedule s, Principal principal) {
        s.setId(null);
        s.setScheduleNumber(numbers.next("pm-schedule", "PMS"));
        if (s.getStatus() == null) s.setStatus("UPCOMING");
        setCreated(s, principalName(principal));
        return pmSchedules.save(s);
    }

    public PMSchedule updatePMSchedule(Long id, PMSchedule s, Principal principal) {
        PMSchedule e = pmSchedules.findById(id).orElseThrow(() -> new RuntimeException("PM Schedule not found"));
        s.setId(id);
        s.setScheduleNumber(e.getScheduleNumber());
        s.setCreatedAt(e.getCreatedAt());
        s.setCreatedBy(e.getCreatedBy());
        audit(s, principalName(principal));
        return pmSchedules.save(s);
    }

    public PMSchedule getPMSchedule(Long id) {
        return pmSchedules.findById(id).orElseThrow(() -> new RuntimeException("PM Schedule not found"));
    }

    public void deletePMSchedule(Long id) {
        PMSchedule s = pmSchedules.findById(id).orElseThrow(() -> new RuntimeException("PM Schedule not found"));
        if ("COMPLETED".equals(s.getStatus())) throw new RuntimeException("Cannot delete completed schedules");
        pmSchedules.deleteById(id);
    }

    public PMSchedule pmScheduleAction(Long id, String action, Principal principal) {
        PMSchedule s = pmSchedules.findById(id).orElseThrow(() -> new RuntimeException("PM Schedule not found"));
        switch (action.toLowerCase()) {
            case "start": s.setStatus("IN_PROGRESS"); break;
            case "complete": s.setStatus("COMPLETED"); s.setCompletedDate(LocalDate.now()); break;
            case "skip": s.setStatus("SKIPPED"); break;
            case "overdue": s.setStatus("OVERDUE"); break;
            default: throw new RuntimeException("Unknown action: " + action);
        }
        audit(s, principalName(principal));
        return pmSchedules.save(s);
    }

    // ===========================
    // ---- PM COMPLETION -------
    // ===========================

    public List<PMCompletion> listPMCompletions() { return pmCompletions.findAll(); }

    public PMCompletion createPMCompletion(PMCompletion c, Principal principal) {
        c.setId(null);
        c.setCompletionNumber(numbers.next("pm-completion", "PMC"));
        if (c.getScheduleId() != null) {
            PMSchedule sched = pmSchedules.findById(c.getScheduleId()).orElse(null);
            if (sched != null) {
                c.setScheduleNumber(sched.getScheduleNumber());
                c.setMachineCode(sched.getMachineCode());
            }
        }
        if (c.getLabourHours() == null) c.setLabourHours(BigDecimal.ZERO);
        if (c.getDurationHours() == null) c.setDurationHours(BigDecimal.ZERO);
        if (c.getStatus() == null) c.setStatus("DRAFT");
        setCreated(c, principalName(principal));
        PMCompletion saved = pmCompletions.save(c);

        // BR-15: auto-generate checklist items from the linked PM plan's checklist template
        // so that Verify can pass once every item has a result.
        try { generateChecklistForCompletion(saved); }
        catch (Exception ex) { log.warn("Auto checklist generation failed for PM completion {}: {}", saved.getId(), ex.getMessage()); }

        // §7.3: Auto-post stock issues for linked spare parts
        try { sparePartStockService.postPmCompletionStockIssues(saved.getId(), saved.getCompletionNumber(), saved.getMachineCode()); }
        catch (Exception ex) { log.warn("Spare part stock issue posting failed for PM completion {}: {}", saved.getId(), ex.getMessage()); }

        return saved;
    }

    public PMCompletion updatePMCompletion(Long id, PMCompletion c, Principal principal) {
        PMCompletion e = pmCompletions.findById(id).orElseThrow(() -> new RuntimeException("PM Completion not found"));
        c.setId(id);
        c.setCompletionNumber(e.getCompletionNumber());
        c.setCreatedAt(e.getCreatedAt());
        c.setCreatedBy(e.getCreatedBy());
        audit(c, principalName(principal));
        return pmCompletions.save(c);
    }

    public PMCompletion getPMCompletion(Long id) {
        return pmCompletions.findById(id).orElseThrow(() -> new RuntimeException("PM Completion not found"));
    }

    public void deletePMCompletion(Long id) {
        PMCompletion c = pmCompletions.findById(id).orElseThrow(() -> new RuntimeException("PM Completion not found"));
        if ("COMPLETED".equals(c.getStatus()) || "VERIFIED".equals(c.getStatus()))
            throw new RuntimeException("Cannot delete completed/verified completions");
        pmCompletions.deleteById(id);
    }

    public Map<String, Object> pmCompletionAction(Long id, String action, Principal principal) {
        PMCompletion c = pmCompletions.findById(id).orElseThrow(() -> new RuntimeException("PM Completion not found"));
        Map<String, Object> result = new LinkedHashMap<>();

        switch (action.toLowerCase()) {
            case "submit":
                c.setStatus("SUBMITTED");
                break;
            case "complete":
                c.setStatus("COMPLETED");
                c.setEndTime(Instant.now());
                if (c.getStartTime() != null) {
                    createDowntimeTransaction(c.getMachineCode(), "PM", c.getId(), c.getStartTime(), c.getEndTime());
                }
                break;
            case "verify": {
                List<PmCompletionChecklistItem> checklist = pmChecklistItems.findByCompletionId(id);
                boolean allAnswered = !checklist.isEmpty() && checklist.stream().allMatch(i -> i.getResult() != null && !i.getResult().isBlank());
                if (!allAnswered) {
                    throw new IllegalStateException("Cannot VERIFY: all checklist items must have a result (BR-15)");
                }
                c.setVerified(true);
                c.setStatus("VERIFIED");
                break;
            }
            case "fail": {
                c.setResult("FAILED");
                c.setStatus("COMPLETED");
                autoRcaOnPmFail(c, principalName(principal));
                break;
            }
            default:
                throw new RuntimeException("Unknown action: " + action);
        }
        audit(c, principalName(principal));
        pmCompletions.save(c);

        if ("COMPLETED".equals(c.getStatus()) || "VERIFIED".equals(c.getStatus())) {
            if (c.getScheduleId() != null) {
                PMSchedule sched = pmSchedules.findById(c.getScheduleId()).orElse(null);
                if (sched != null) {
                    sched.setStatus("COMPLETED");
                    sched.setCompletedDate(LocalDate.now());
                    audit(sched, principalName(principal));
                    pmSchedules.save(sched);
                }
            }
        }

        result.put("success", true);
        result.put("data", pmCompletions.findById(id).orElse(c));
        return result;
    }

    // BR-15: when a PM completion is marked FAILED, auto-create an RCA and notify.
    private void autoRcaOnPmFail(PMCompletion c, String user) {
        try {
            RootCauseAnalysis rca = RootCauseAnalysis.builder()
                    .rcaNumber(numbers.next("root-cause-analysis", "RCA"))
                    .machineCode(c.getMachineCode())
                    .problemDescription("Auto-generated from failed PM completion #" + c.getId())
                    .status("OPEN")
                    .build();
            rootCauseAnalyses.save(rca);

            NotificationLog nl = new NotificationLog();
            nl.setRecipient("maintenance-supervisor");
            nl.setSourceType("PM");
            nl.setSourceId(c.getId());
            nl.setSubject("PM completion " + c.getId() + " failed");
            nl.setBody("PM completion " + c.getId() + " failed; RCA " + rca.getRcaNumber() + " auto-created (BR-15)");
            nl.setStatus("SENT");
            nl.setSentAt(Instant.now());
            notificationLogs.save(nl);

            notificationService.notify("PM_FAIL", "MAINTENANCE", "PM_COMPLETION", c.getId(),
                    "ERROR", "PM completion " + c.getId() + " failed; RCA " + rca.getRcaNumber() + " created (BR-15)",
                    c.getMachineCode());
        } catch (Exception ex) {
            log.error("autoRcaOnPmFail failed for PM completion id={}", c.getId(), ex);
        }
    }

    // ===========================
    // ---- TOOL SERVICE INTIMATION
    // ===========================

    public List<ToolServiceIntimation> listToolServices() { return toolServices.findAll(); }

    public ToolServiceIntimation createToolService(ToolServiceIntimation t, Principal principal) {
        t.setId(null);
        t.setServiceNumber(numbers.next("tool-service-intimation", "TSI"));
        if (t.getServiceDate() == null) t.setServiceDate(LocalDate.now());
        if (t.getStatus() == null) t.setStatus("OPEN");
        if (t.getPriority() == null) t.setPriority("MEDIUM");
        denormalizeToolServiceVendor(t);
        setCreated(t, principalName(principal));
        return toolServices.save(t);
    }

    public ToolServiceIntimation updateToolService(Long id, ToolServiceIntimation t, Principal principal) {
        ToolServiceIntimation e = toolServices.findById(id).orElseThrow(() -> new RuntimeException("Tool Service not found"));
        t.setId(id);
        t.setServiceNumber(e.getServiceNumber());
        t.setCreatedAt(e.getCreatedAt());
        t.setCreatedBy(e.getCreatedBy());
        audit(t, principalName(principal));
        denormalizeToolServiceVendor(t);
        return toolServices.save(t);
    }

    public ToolServiceIntimation getToolService(Long id) {
        return toolServices.findById(id).orElseThrow(() -> new RuntimeException("Tool Service not found"));
    }

    public void deleteToolService(Long id) {
        ToolServiceIntimation e = toolServices.findById(id).orElseThrow(() -> new RuntimeException("Tool Service not found"));
        if ("CLOSED".equals(e.getStatus())) throw new RuntimeException("CLOSED services cannot be deleted");
        toolServices.deleteById(id);
    }

    public ToolServiceIntimation toolServiceAction(Long id, String action,
                                                    Map<String, String> body, Principal principal) {
        ToolServiceIntimation t = toolServices.findById(id).orElseThrow(() -> new RuntimeException("Tool Service not found"));
        switch (action.toLowerCase()) {
            case "assign": t.setStatus("ASSIGNED"); break;
            case "in-progress": t.setStatus("IN_PROGRESS"); break;
            case "close":
                // Maintenance Module audit: this used to close with no gate at all, unlike
                // Breakdown's BR-03 ("at least one rectification must have testingResult=PASS").
                // Mirrors that same rule here for consistency between the two reactive-repair
                // flows.
                List<ToolServiceRectification> tRects = toolRectifications.findByServiceId(id);
                boolean toolHasPassed = tRects.stream().anyMatch(r -> "PASS".equals(r.getResult()));
                if (!toolHasPassed) {
                    throw new IllegalStateException(
                        "Cannot close: at least one rectification must have result=PASS (BR-TSI-01)");
                }
                t.setStatus("CLOSED");
                break;
            case "cancel": t.setStatus("CANCELLED"); break;
            default: throw new RuntimeException("Unknown action: " + action);
        }
        audit(t, principalName(principal));
        return toolServices.save(t);
    }

    // ===========================
    // ---- TOOL SERVICE RECTIFICATION
    // ===========================

    public List<ToolServiceRectification> listToolRectifications() { return toolRectifications.findAll(); }

    public ToolServiceRectification createToolRectification(ToolServiceRectification r, Principal principal) {
        r.setId(null);
        r.setRectificationNumber(numbers.next("tool-service-rectification", "TSR"));
        if (r.getServiceId() != null) {
            ToolServiceIntimation svc = toolServices.findById(r.getServiceId()).orElse(null);
            if (svc != null) {
                r.setServiceNumber(svc.getServiceNumber());
                r.setToolId(svc.getToolId());
            }
        }
        if (r.getServiceCost() == null) r.setServiceCost(BigDecimal.ZERO);
        if (r.getStatus() == null) r.setStatus("IN_PROGRESS");
        setCreated(r, principalName(principal));
        return toolRectifications.save(r);
    }

    public ToolServiceRectification updateToolRectification(Long id, ToolServiceRectification r, Principal principal) {
        ToolServiceRectification e = toolRectifications.findById(id).orElseThrow(() -> new RuntimeException("Tool Rectification not found"));
        r.setId(id);
        r.setRectificationNumber(e.getRectificationNumber());
        r.setCreatedAt(e.getCreatedAt());
        r.setCreatedBy(e.getCreatedBy());
        audit(r, principalName(principal));
        return toolRectifications.save(r);
    }

    public ToolServiceRectification getToolRectification(Long id) {
        return toolRectifications.findById(id).orElseThrow(() -> new RuntimeException("Tool Rectification not found"));
    }

    public void deleteToolRectification(Long id) {
        toolRectifications.findById(id).orElseThrow(() -> new RuntimeException("Tool Rectification not found"));
        toolRectifications.deleteById(id);
    }

    public ToolServiceRectification toolRectificationAction(Long id, String action, Principal principal) {
        ToolServiceRectification r = toolRectifications.findById(id).orElseThrow(() -> new RuntimeException("Tool Rectification not found"));
        switch (action.toLowerCase()) {
            case "complete": r.setStatus("COMPLETED"); r.setServiceEnd(Instant.now()); break;
            case "close":
                // Maintenance Module audit: mirrors BreakdownRectification's BR-01 gate — this
                // previously required nothing beyond the current status.
                if (!"COMPLETED".equals(r.getStatus()) || !"PASS".equals(r.getResult())) {
                    throw new IllegalStateException(
                        "Cannot close: rectification must be COMPLETED with result=PASS (BR-TSR-01)");
                }
                r.setStatus("CLOSED");
                finalizeCostOnClose("TOOLING", r.getId());
                break;
            case "pass":
                if (!"COMPLETED".equals(r.getStatus())) {
                    throw new IllegalStateException("Cannot mark PASS before rectification is COMPLETED (BR-TSR-01)");
                }
                r.setResult("PASS");
                break;
            case "fail":
                r.setResult("FAIL");
                if ("COMPLETED".equals(r.getStatus())) {
                    r.setStatus("IN_PROGRESS"); // rework — return to in-progress, matching Breakdown's pattern
                }
                break;
            default: throw new RuntimeException("Unknown action: " + action);
        }
        audit(r, principalName(principal));
        return toolRectifications.save(r);
    }

    // ===========================
    // ---- CALIBRATION SCHEDULE
    // ===========================

    public List<CalibrationSchedule> listCalSchedules() { return calSchedules.findAll(); }

    public CalibrationSchedule createCalSchedule(CalibrationSchedule cs, Principal principal) {
        cs.setId(null);
        cs.setScheduleNumber(numbers.next("calibration-schedule", "CLS"));
        if (cs.getCalibrationStatus() == null) cs.setCalibrationStatus("VALID");
        if (cs.getStatus() == null) cs.setStatus("ACTIVE");
        setCreated(cs, principalName(principal));
        return calSchedules.save(cs);
    }

    public CalibrationSchedule updateCalSchedule(Long id, CalibrationSchedule cs, Principal principal) {
        CalibrationSchedule e = calSchedules.findById(id).orElseThrow(() -> new RuntimeException("Calibration Schedule not found"));
        cs.setId(id);
        cs.setScheduleNumber(e.getScheduleNumber());
        cs.setCreatedAt(e.getCreatedAt());
        cs.setCreatedBy(e.getCreatedBy());
        audit(cs, principalName(principal));
        return calSchedules.save(cs);
    }

    public CalibrationSchedule getCalSchedule(Long id) {
        return calSchedules.findById(id).orElseThrow(() -> new RuntimeException("Calibration Schedule not found"));
    }

    public void deleteCalSchedule(Long id) {
        calSchedules.deleteById(id);
    }

    public CalibrationSchedule calScheduleAction(Long id, String action, Principal principal) {
        CalibrationSchedule cs = calSchedules.findById(id).orElseThrow(() -> new RuntimeException("Calibration Schedule not found"));
        String a = action == null ? "" : action.toLowerCase().replace("mark-", "");
        switch (a) {
            case "send", "send-for-calibration" -> { cs.setCalibrationStatus("UNDER_CALIBRATION"); cs.setStatus("IN_PROGRESS"); }
            case "valid", "mark-valid" -> { cs.setCalibrationStatus("VALID"); cs.setStatus("ACTIVE"); }
            case "fail", "mark-failed" -> { cs.setCalibrationStatus("FAILED"); cs.setStatus("INACTIVE"); }
            case "deactivate" -> { cs.setCalibrationStatus("OUT_OF_SERVICE"); cs.setStatus("INACTIVE"); }
            default -> throw new RuntimeException("Unknown action: " + action);
        }
        audit(cs, principalName(principal));
        return calSchedules.save(cs);
    }

    // ===========================
    // ---- CALIBRATION ENTRY ---
    // ===========================

    public List<CalibrationEntry> listCalEntries() { return calEntries.findAll(); }

    public CalibrationEntry createCalEntry(CalibrationEntry ce, Principal principal) {
        ce.setId(null);
        ce.setCalibrationNumber(numbers.next("calibration-entry", "CLE"));
        if (ce.getCalibrationDate() == null) ce.setCalibrationDate(LocalDate.now());
        if (ce.getCalibrationCost() == null) ce.setCalibrationCost(BigDecimal.ZERO);
        if (ce.getStatus() == null) ce.setStatus("DRAFT");
        setCreated(ce, principalName(principal));
        CalibrationEntry saved = calEntries.save(ce);

        if (ce.getScheduleId() != null && ce.getResult() != null) {
            CalibrationSchedule cs = calSchedules.findById(ce.getScheduleId()).orElse(null);
            if (cs != null) {
                if ("PASS".equals(ce.getResult())) {
                    cs.setCalibrationStatus("VALID");
                    cs.setLastCalibrationDate(ce.getCalibrationDate());
                    cs.setNextDueDate(ce.getNextDueDate());
                    cs.setStatus("ACTIVE");
                } else {
                    cs.setCalibrationStatus("FAILED");
                    cs.setStatus("INACTIVE");
                }
                audit(cs, principalName(principal));
                calSchedules.save(cs);
            }
        }
        return saved;
    }

    public CalibrationEntry updateCalEntry(Long id, CalibrationEntry ce, Principal principal) {
        CalibrationEntry e = calEntries.findById(id).orElseThrow(() -> new RuntimeException("Calibration Entry not found"));
        ce.setId(id);
        ce.setCalibrationNumber(e.getCalibrationNumber());
        ce.setCreatedAt(e.getCreatedAt());
        ce.setCreatedBy(e.getCreatedBy());
        audit(ce, principalName(principal));
        return calEntries.save(ce);
    }

    public CalibrationEntry getCalEntry(Long id) {
        return calEntries.findById(id).orElseThrow(() -> new RuntimeException("Calibration Entry not found"));
    }

    public void deleteCalEntry(Long id) {
        calEntries.deleteById(id);
    }

    public CalibrationEntry calEntryAction(Long id, String action, Principal principal) {
        CalibrationEntry ce = calEntries.findById(id).orElseThrow(() -> new RuntimeException("Calibration Entry not found"));
        String user = principalName(principal);
        switch (action.toLowerCase()) {
            case "pass": { ce.setResult("PASS"); ce.setStatus("COMPLETED"); finalizeCostOnClose("CALIBRATION", ce.getId()); applyCalPass(ce); break; }
            case "fail": { ce.setResult("FAIL"); ce.setStatus("COMPLETED"); finalizeCostOnClose("CALIBRATION", ce.getId()); applyCalFail(ce, user); break; }
            case "submit": ce.setStatus("SUBMITTED"); break;
            default: throw new RuntimeException("Unknown action: " + action);
        }
        audit(ce, user);
        return calEntries.save(ce);
    }

    // BR-16: on PASS, bump the schedule's next-due by its calibration frequency.
    private void applyCalPass(CalibrationEntry ce) {
        if (ce.getScheduleId() == null) return;
        CalibrationSchedule cs = calSchedules.findById(ce.getScheduleId()).orElse(null);
        if (cs == null) return;
        LocalDate base = ce.getCalibrationDate() != null ? ce.getCalibrationDate() : LocalDate.now();
        LocalDate next = calculateNextDate(base, cs.getCalibrationFrequency());
        cs.setCalibrationStatus("VALID");
        cs.setLastCalibrationDate(base);
        cs.setNextDueDate(next);
        cs.setStatus("ACTIVE");
        audit(cs, "system");
        calSchedules.save(cs);
    }

    // BR-17: on FAIL, mark the schedule failed/inactive AND quarantine the instrument (gauge).
    private void applyCalFail(CalibrationEntry ce, String user) {
        if (ce.getScheduleId() != null) {
            CalibrationSchedule cs = calSchedules.findById(ce.getScheduleId()).orElse(null);
            if (cs != null) {
                cs.setCalibrationStatus("FAILED");
                cs.setStatus("INACTIVE");
                audit(cs, user);
                calSchedules.save(cs);
            }
        }
        if (ce.getInstrumentId() != null) {
            instruments.findByCode(ce.getInstrumentId()).ifPresent(instr -> {
                instr.setCurrentStatus("QUARANTINED");
                instr.setCalibrationStatus("FAILED");
                instruments.save(instr);
            });
        }
    }

    // ===========================
    // ---- POWER CONSUMPTION ---
    // ===========================

    public List<PowerConsumption> listPowerConsumptions() { return powerConsumptions.findAll(); }

    public PowerConsumption createPowerConsumption(PowerConsumption pc, Principal principal) {
        pc.setId(null);
        pc.setEntryNumber(numbers.next("power-consumption", "PWC"));
        if (pc.getReadingDate() == null) pc.setReadingDate(LocalDate.now());
        if (pc.getUnit() == null) pc.setUnit("kWh");
        if (pc.getStatus() == null) pc.setStatus("DRAFT");
        if (pc.getOpeningReading() == null) pc.setOpeningReading(BigDecimal.ZERO);
        if (pc.getClosingReading() == null) pc.setClosingReading(BigDecimal.ZERO);
        pc.setConsumption(pc.getClosingReading().subtract(pc.getOpeningReading()));
        setCreated(pc, principalName(principal));
        return powerConsumptions.save(pc);
    }

    public PowerConsumption updatePowerConsumption(Long id, PowerConsumption pc, Principal principal) {
        PowerConsumption e = powerConsumptions.findById(id).orElseThrow(() -> new RuntimeException("Power Consumption not found"));
        pc.setId(id);
        pc.setEntryNumber(e.getEntryNumber());
        pc.setCreatedAt(e.getCreatedAt());
        pc.setCreatedBy(e.getCreatedBy());
        audit(pc, principalName(principal));
        if (pc.getOpeningReading() != null && pc.getClosingReading() != null) {
            pc.setConsumption(pc.getClosingReading().subtract(pc.getOpeningReading()));
        }
        return powerConsumptions.save(pc);
    }

    public PowerConsumption getPowerConsumption(Long id) {
        return powerConsumptions.findById(id).orElseThrow(() -> new RuntimeException("Power Consumption not found"));
    }

    public void deletePowerConsumption(Long id) {
        powerConsumptions.deleteById(id);
    }

    public PowerConsumption powerConsumptionAction(Long id, String action, Principal principal) {
        PowerConsumption pc = powerConsumptions.findById(id).orElseThrow(() -> new RuntimeException("Power Consumption not found"));
        switch (action.toLowerCase()) {
            case "verify": pc.setStatus("VERIFIED"); break;
            case "approve": pc.setStatus("APPROVED"); break;
            default: throw new RuntimeException("Unknown action: " + action);
        }
        audit(pc, principalName(principal));
        return powerConsumptions.save(pc);
    }

    // ===========================
    // ---- WATER CONSUMPTION ---
    // ===========================

    public List<WaterConsumption> listWaterConsumptions() { return waterConsumptions.findAll(); }

    public WaterConsumption createWaterConsumption(WaterConsumption wc, Principal principal) {
        wc.setId(null);
        wc.setEntryNumber(numbers.next("water-consumption", "WTC"));
        if (wc.getReadingDate() == null) wc.setReadingDate(LocalDate.now());
        if (wc.getUnit() == null) wc.setUnit("Liters");
        if (wc.getStatus() == null) wc.setStatus("DRAFT");
        if (wc.getOpeningReading() == null) wc.setOpeningReading(BigDecimal.ZERO);
        if (wc.getClosingReading() == null) wc.setClosingReading(BigDecimal.ZERO);
        wc.setConsumption(wc.getClosingReading().subtract(wc.getOpeningReading()));
        setCreated(wc, principalName(principal));
        return waterConsumptions.save(wc);
    }

    public WaterConsumption updateWaterConsumption(Long id, WaterConsumption wc, Principal principal) {
        WaterConsumption e = waterConsumptions.findById(id).orElseThrow(() -> new RuntimeException("Water Consumption not found"));
        wc.setId(id);
        wc.setEntryNumber(e.getEntryNumber());
        wc.setCreatedAt(e.getCreatedAt());
        wc.setCreatedBy(e.getCreatedBy());
        audit(wc, principalName(principal));
        if (wc.getOpeningReading() != null && wc.getClosingReading() != null) {
            wc.setConsumption(wc.getClosingReading().subtract(wc.getOpeningReading()));
        }
        return waterConsumptions.save(wc);
    }

    public WaterConsumption getWaterConsumption(Long id) {
        return waterConsumptions.findById(id).orElseThrow(() -> new RuntimeException("Water Consumption not found"));
    }

    public void deleteWaterConsumption(Long id) {
        waterConsumptions.deleteById(id);
    }

    public WaterConsumption waterConsumptionAction(Long id, String action, Principal principal) {
        WaterConsumption wc = waterConsumptions.findById(id).orElseThrow(() -> new RuntimeException("Water Consumption not found"));
        switch (action.toLowerCase()) {
            case "verify": wc.setStatus("VERIFIED"); break;
            case "approve": wc.setStatus("APPROVED"); break;
            default: throw new RuntimeException("Unknown action: " + action);
        }
        audit(wc, principalName(principal));
        return waterConsumptions.save(wc);
    }

    // ===========================
    // ---- ROOT CAUSE ANALYSIS --
    // ===========================

    public List<RootCauseAnalysis> listRCA() { return rootCauseAnalyses.findAll(); }

    public RootCauseAnalysis createRCA(RootCauseAnalysis rca, Principal principal) {
        rca.setId(null);
        rca.setRcaNumber(numbers.next("root-cause-analysis", "RCA"));
        if (rca.getBreakdownId() != null) {
            BreakdownIntimation bd = breakdowns.findById(rca.getBreakdownId()).orElse(null);
            if (bd != null) {
                rca.setBreakdownNumber(bd.getBreakdownNumber());
                rca.setMachineCode(bd.getMachineCode());
            }
        }
        if (rca.getStatus() == null) rca.setStatus("OPEN");
        setCreated(rca, principalName(principal));
        return rootCauseAnalyses.save(rca);
    }

    public RootCauseAnalysis updateRCA(Long id, RootCauseAnalysis rca, Principal principal) {
        RootCauseAnalysis e = rootCauseAnalyses.findById(id).orElseThrow(() -> new RuntimeException("RCA not found"));
        rca.setId(id);
        rca.setRcaNumber(e.getRcaNumber());
        rca.setCreatedAt(e.getCreatedAt());
        rca.setCreatedBy(e.getCreatedBy());
        audit(rca, principalName(principal));
        return rootCauseAnalyses.save(rca);
    }

    public RootCauseAnalysis getRCA(Long id) {
        return rootCauseAnalyses.findById(id).orElseThrow(() -> new RuntimeException("RCA not found"));
    }

    public void deleteRCA(Long id) {
        RootCauseAnalysis e = rootCauseAnalyses.findById(id).orElseThrow(() -> new RuntimeException("RCA not found"));
        if ("CLOSED".equals(e.getStatus())) throw new RuntimeException("CLOSED RCA cannot be deleted");
        rootCauseAnalyses.deleteById(id);
    }

    public RootCauseAnalysis rcaAction(Long id, String action,
                                        Map<String, String> body, Principal principal) {
        RootCauseAnalysis rca = rootCauseAnalyses.findById(id).orElseThrow(() -> new RuntimeException("RCA not found"));
        String note = body != null ? body.getOrDefault("note", "") : "";
        switch (action.toLowerCase()) {
            case "verify":
                rca.setStatus("VERIFIED");
                rca.setVerificationDate(LocalDate.now());
                rca.setVerifiedBy(note.isEmpty() ? "system" : note);
                break;
            case "close":
                rca.setStatus("CLOSED");
                break;
            case "reopen":
                rca.setStatus("OPEN");
                break;
            default: throw new RuntimeException("Unknown action: " + action);
        }
        audit(rca, principalName(principal));
        return rootCauseAnalyses.save(rca);
    }

    // ===========================
    // ---- DASHBOARD / ANALYSIS
    // ===========================

    public Map<String, Object> dashboard() {
        Map<String, Object> d = new LinkedHashMap<>();
        List<BreakdownIntimation> allBd = breakdowns.findAll();
        List<PMSchedule> allPmSched = pmSchedules.findAll();
        List<CalibrationSchedule> allCal = calSchedules.findAll();

        long openBreakdowns = allBd.stream().filter(b -> "OPEN".equals(b.getStatus()) || "ASSIGNED".equals(b.getStatus())).count();
        long criticalBreakdowns = allBd.stream().filter(b -> "CRITICAL".equals(b.getPriority()) && !"CLOSED".equals(b.getStatus())).count();
        long machinesDown = allBd.stream().filter(b -> "OPEN".equals(b.getStatus()) || "ASSIGNED".equals(b.getStatus())).map(BreakdownIntimation::getMachineCode).filter(Objects::nonNull).distinct().count();

        LocalDate today = LocalDate.now();
        long pmDueToday = allPmSched.stream().filter(s -> today.equals(s.getDueDate()) && "UPCOMING".equals(s.getStatus())).count();
        long pmOverdue = allPmSched.stream().filter(s -> s.getDueDate() != null && s.getDueDate().isBefore(today) && "UPCOMING".equals(s.getStatus())).count();
        long pmCompleted = allPmSched.stream().filter(s -> "COMPLETED".equals(s.getStatus())).count();

        long calDue = allCal.stream().filter(c -> c.getNextDueDate() != null && !c.getNextDueDate().isAfter(today) && "ACTIVE".equals(c.getStatus())).count();
        long calOverdue = allCal.stream().filter(c -> c.getNextDueDate() != null && c.getNextDueDate().isBefore(today.minusDays(1)) && "ACTIVE".equals(c.getStatus())).count();

        List<BreakdownRectification> allRects = rectifications.findAll();
        double avgDowntime = allRects.stream()
            .filter(r -> r.getDowntimeMinutes() != null)
            .mapToDouble(r -> r.getDowntimeMinutes().doubleValue())
            .average().orElse(0.0);

        long totalBreakdowns = allBd.stream().filter(b -> "CLOSED".equals(b.getStatus())).count();
        double mtbf = totalBreakdowns > 0 ? avgDowntime * (allBd.size() - totalBreakdowns) / totalBreakdowns : 0;
        double mttr = totalBreakdowns > 0 ? avgDowntime : 0;

        d.put("openBreakdowns", openBreakdowns);
        d.put("criticalBreakdowns", criticalBreakdowns);
        d.put("machinesDown", machinesDown);
        d.put("pmDueToday", pmDueToday);
        d.put("pmOverdue", pmOverdue);
        d.put("pmCompleted", pmCompleted);
        d.put("calibrationDue", calDue);
        d.put("calibrationOverdue", calOverdue);
        d.put("mtbf", Math.round(mtbf * 100.0) / 100.0);
        d.put("mttr", Math.round(mttr * 100.0) / 100.0);
        d.put("totalBreakdowns", allBd.size());
        d.put("totalPmSchedules", allPmSched.size());
        d.put("totalCalibrations", allCal.size());
        return d;
    }

    public Map<String, Object> mtbf(String machineCode) {
        List<BreakdownIntimation> bds = breakdowns.findByMachineCode(machineCode);
        List<BreakdownRectification> rects = rectifications.findAll().stream()
            .filter(r -> machineCode.equals(r.getMachineCode()))
            .collect(Collectors.toList());

        long failureCount = bds.stream().filter(b -> "CLOSED".equals(b.getStatus())).count();
        double totalDowntime = rects.stream()
            .filter(r -> r.getDowntimeMinutes() != null)
            .mapToDouble(r -> r.getDowntimeMinutes().doubleValue())
            .sum();

        // Maintenance Module audit: this used to compute mtbf with the exact same formula as
        // mttr (totalDowntime / failureCount for both), so the two values were always
        // identical — a real bug. MTBF is mean time BETWEEN failures, so it needs real
        // operating (uptime) hours, not repair time — matching how mtbfAnalysis() (the
        // all-machines endpoint the dashboard actually uses) already computes it correctly.
        double mttr = failureCount > 0 ? totalDowntime / failureCount : 0;
        double mtbf = failureCount > 0 ? operatingHoursFor(machineCode, totalDowntime) * 60.0 / failureCount : 0;

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("machineCode", machineCode);
        result.put("totalFailures", failureCount);
        result.put("totalDowntimeMinutes", totalDowntime);
        result.put("mtbfMinutes", Math.round(mtbf * 100.0) / 100.0);
        result.put("mttrMinutes", Math.round(mttr * 100.0) / 100.0);
        return result;
    }

    /** §10.3 Real operating hours from machine_operating_hours; falls back to an estimate when no production feed exists yet. */
    public double operatingHoursFor(String machineCode, double fallbackDowntimeMinutes) {
        BigDecimal recorded = operatingHoursRepo.sumOperatingHours(machineCode, LocalDate.MIN, LocalDate.now());
        if (recorded != null && recorded.doubleValue() > 0) return recorded.doubleValue();
        return fallbackDowntimeMinutes > 0 ? fallbackDowntimeMinutes * 5.0 / 60.0 : 60.0;
    }

    public List<Map<String, Object>> downtimeAnalysis() {
        List<BreakdownIntimation> allBd = breakdowns.findAll();
        List<BreakdownRectification> allRects = rectifications.findAll();
        Map<String, Double> machineDowntime = new LinkedHashMap<>();

        for (BreakdownRectification r : allRects) {
            if (r.getDowntimeMinutes() != null && r.getMachineCode() != null) {
                machineDowntime.merge(r.getMachineCode(), r.getDowntimeMinutes().doubleValue(), Double::sum);
            }
        }

        List<Map<String, Object>> result = new ArrayList<>();
        Map<String, Long> machineBreakdownCount = allBd.stream()
            .filter(b -> b.getMachineCode() != null && "CLOSED".equals(b.getStatus()))
            .collect(Collectors.groupingBy(BreakdownIntimation::getMachineCode, Collectors.counting()));

        for (Map.Entry<String, Double> entry : machineDowntime.entrySet()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("machineCode", entry.getKey());
            row.put("totalDowntimeMinutes", entry.getValue());
            row.put("totalDowntimeHours", Math.round(entry.getValue() / 60.0 * 100.0) / 100.0);
            row.put("breakdownCount", machineBreakdownCount.getOrDefault(entry.getKey(), 0L));
            row.put("avgDowntimePerBreakdown",
                machineBreakdownCount.getOrDefault(entry.getKey(), 0L) > 0
                    ? Math.round(entry.getValue() / machineBreakdownCount.get(entry.getKey()) * 100.0) / 100.0
                    : 0.0);
            result.add(row);
        }
        result.sort((a, b) -> Double.compare((double) b.get("totalDowntimeMinutes"), (double) a.get("totalDowntimeMinutes")));
        return result;
    }

    public Map<String, Long> downtimeByCategory() {
        return breakdowns.findAll().stream()
            .filter(b -> b.getBreakdownCategory() != null)
            .collect(Collectors.groupingBy(BreakdownIntimation::getBreakdownCategory, Collectors.counting()));
    }

    public Map<String, Long> downtimeByPriority() {
        return breakdowns.findAll().stream()
            .filter(b -> b.getPriority() != null)
            .collect(Collectors.groupingBy(BreakdownIntimation::getPriority, Collectors.counting()));
    }

    public List<Map<String, Object>> mtbfAnalysis() {
        List<BreakdownIntimation> allBd = breakdowns.findAll();
        List<BreakdownRectification> allRects = rectifications.findAll();

        Map<String, List<BreakdownIntimation>> machineBreakdowns = allBd.stream()
            .filter(b -> b.getMachineCode() != null && "CLOSED".equals(b.getStatus()))
            .collect(Collectors.groupingBy(BreakdownIntimation::getMachineCode));

        Map<String, Double> machineDowntime = new LinkedHashMap<>();
        for (BreakdownRectification r : allRects) {
            if (r.getDowntimeMinutes() != null && r.getMachineCode() != null) {
                machineDowntime.merge(r.getMachineCode(), r.getDowntimeMinutes().doubleValue(), Double::sum);
            }
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map.Entry<String, List<BreakdownIntimation>> entry : machineBreakdowns.entrySet()) {
            String machine = entry.getKey();
            long failures = entry.getValue().size();
            double totalDowntime = machineDowntime.getOrDefault(machine, 0.0);
            double mttr = failures > 0 ? totalDowntime / failures : 0;
            double operatingHours = operatingHoursFor(machine, totalDowntime);
            double mtbf = failures > 0 ? operatingHours * 60.0 / failures : operatingHours * 60.0;

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("machineCode", machine);
            row.put("totalFailures", failures);
            row.put("totalDowntimeMinutes", totalDowntime);
            row.put("mttrMinutes", Math.round(mttr * 100.0) / 100.0);
            row.put("mtbfMinutes", Math.round(mtbf * 100.0) / 100.0);
            row.put("mtbfHours", Math.round(mtbf / 60.0 * 100.0) / 100.0);
            result.add(row);
        }
        result.sort((a, b) -> Long.compare((long) b.get("totalFailures"), (long) a.get("totalFailures")));
        return result;
    }

    public List<Map<String, Object>> maintenanceCostAnalysis() {
        List<BreakdownRectification> allRects = rectifications.findAll();
        List<ToolServiceRectification> allToolRects = toolRectifications.findAll();
        List<PMCompletion> allPmComps = pmCompletions.findAll();

        Map<String, BigDecimal> machineBreakdownCost = new LinkedHashMap<>();
        for (BreakdownRectification r : allRects) {
            if (r.getMachineCode() != null && r.getServiceCost() != null) {
                machineBreakdownCost.merge(r.getMachineCode(), r.getServiceCost(), BigDecimal::add);
            }
        }

        Map<String, BigDecimal> machineToolCost = new LinkedHashMap<>();
        for (ToolServiceRectification r : allToolRects) {
            if (r.getToolId() != null && r.getServiceCost() != null) {
                machineToolCost.merge(r.getToolId(), r.getServiceCost(), BigDecimal::add);
            }
        }

        Set<String> allMachines = new LinkedHashSet<>();
        allMachines.addAll(machineBreakdownCost.keySet());
        allMachines.addAll(machineToolCost.keySet());

        List<Map<String, Object>> result = new ArrayList<>();
        for (String machine : allMachines) {
            BigDecimal breakdownCost = machineBreakdownCost.getOrDefault(machine, BigDecimal.ZERO);
            BigDecimal toolCost = machineToolCost.getOrDefault(machine, BigDecimal.ZERO);
            BigDecimal totalCost = breakdownCost.add(toolCost);

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("machineCode", machine);
            row.put("breakdownCost", breakdownCost);
            row.put("toolServiceCost", toolCost);
            row.put("totalCost", totalCost);
            result.add(row);
        }
        result.sort((a, b) -> ((BigDecimal) b.get("totalCost")).compareTo((BigDecimal) a.get("totalCost")));
        return result;
    }

    // ===========================
    // ---- REPORTS ENDPOINTS ---
    // ===========================

    public Map<String, Object> breakdownReport(String machineCode, String category, String status) {
        List<BreakdownIntimation> all = breakdowns.findAll().stream()
            .filter(b -> machineCode == null || machineCode.isEmpty() || machineCode.equals(b.getMachineCode()))
            .filter(b -> category == null || category.isEmpty() || category.equals(b.getBreakdownCategory()))
            .filter(b -> status == null || status.isEmpty() || status.equals(b.getStatus()))
            .collect(Collectors.toList());

        Map<String, Long> byCategory = all.stream()
            .filter(b -> b.getBreakdownCategory() != null)
            .collect(Collectors.groupingBy(BreakdownIntimation::getBreakdownCategory, Collectors.counting()));

        Map<String, Long> byStatus = all.stream()
            .filter(b -> b.getStatus() != null)
            .collect(Collectors.groupingBy(BreakdownIntimation::getStatus, Collectors.counting()));

        Map<String, Long> byPriority = all.stream()
            .filter(b -> b.getPriority() != null)
            .collect(Collectors.groupingBy(BreakdownIntimation::getPriority, Collectors.counting()));

        Map<String, Long> byMachine = all.stream()
            .filter(b -> b.getMachineCode() != null)
            .collect(Collectors.groupingBy(BreakdownIntimation::getMachineCode, Collectors.counting()));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalBreakdowns", all.size());
        result.put("byCategory", byCategory);
        result.put("byStatus", byStatus);
        result.put("byPriority", byPriority);
        result.put("byMachine", byMachine);
        result.put("records", all.stream().limit(200).collect(Collectors.toList()));
        return result;
    }

    public Map<String, Object> pmReport(String machineCode, String status) {
        List<PMSchedule> all = pmSchedules.findAll().stream()
            .filter(s -> machineCode == null || machineCode.isEmpty() || machineCode.equals(s.getMachineCode()))
            .filter(s -> status == null || status.isEmpty() || status.equals(s.getStatus()))
            .collect(Collectors.toList());

        Map<String, Long> byStatus = all.stream()
            .filter(s -> s.getStatus() != null)
            .collect(Collectors.groupingBy(PMSchedule::getStatus, Collectors.counting()));

        Map<String, Long> byMachine = all.stream()
            .filter(s -> s.getMachineCode() != null)
            .collect(Collectors.groupingBy(PMSchedule::getMachineCode, Collectors.counting()));

        LocalDate today = LocalDate.now();
        long overdue = all.stream().filter(s -> s.getDueDate() != null && s.getDueDate().isBefore(today) && "UPCOMING".equals(s.getStatus())).count();
        long completed = all.stream().filter(s -> "COMPLETED".equals(s.getStatus())).count();
        double compliance = all.size() > 0 ? Math.round(completed * 100.0 / all.size() * 100.0) / 100.0 : 100.0;

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalSchedules", all.size());
        result.put("byStatus", byStatus);
        result.put("byMachine", byMachine);
        result.put("overdue", overdue);
        result.put("compliance", compliance);
        result.put("records", all.stream().limit(200).collect(Collectors.toList()));
        return result;
    }

    public Map<String, Object> machineHistory(String machineCode) {
        Map<String, Object> h = new LinkedHashMap<>();
        h.put("machineCode", machineCode);

        List<BreakdownIntimation> bds = breakdowns.findByMachineCode(machineCode);
        h.put("totalBreakdowns", bds.size());
        h.put("openBreakdowns", bds.stream().filter(b -> !"CLOSED".equals(b.getStatus()) && !"CANCELLED".equals(b.getStatus())).count());

        List<BreakdownRectification> rects = rectifications.findAll().stream()
            .filter(r -> machineCode.equals(r.getMachineCode()))
            .collect(Collectors.toList());
        double totalDowntime = rects.stream().filter(r -> r.getDowntimeMinutes() != null).mapToDouble(r -> r.getDowntimeMinutes().doubleValue()).sum();
        double totalCost = rects.stream().filter(r -> r.getServiceCost() != null).mapToDouble(r -> r.getServiceCost().doubleValue()).sum();
        h.put("totalDowntimeMinutes", totalDowntime);
        h.put("totalDowntimeHours", Math.round(totalDowntime / 60.0 * 100.0) / 100.0);
        h.put("maintenanceCost", totalCost);

        long failures = bds.stream().filter(b -> "CLOSED".equals(b.getStatus())).count();
        double mttr = failures > 0 ? totalDowntime / failures : 0;
        h.put("totalFailures", failures);
        h.put("mttrMinutes", Math.round(mttr * 100.0) / 100.0);

        List<Map<String, Object>> bdHistory = bds.stream().limit(50).map(b -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("number", b.getBreakdownNumber());
            row.put("date", b.getBreakdownDate());
            row.put("category", b.getBreakdownCategory());
            row.put("priority", b.getPriority());
            row.put("status", b.getStatus());
            row.put("problem", b.getProblemDescription());
            return row;
        }).collect(Collectors.toList());
        h.put("breakdownHistory", bdHistory);

        List<PMCompletion> pmcs = pmCompletions.findByMachineCode(machineCode);
        h.put("totalPmCompletions", pmcs.size());
        List<Map<String, Object>> pmHistory = pmcs.stream().limit(50).map(c -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("number", c.getCompletionNumber());
            row.put("result", c.getResult());
            row.put("status", c.getStatus());
            row.put("technician", c.getTechnicianCode());
            return row;
        }).collect(Collectors.toList());
        h.put("pmHistory", pmHistory);

        List<RootCauseAnalysis> rcas = rootCauseAnalyses.findByMachineCode(machineCode);
        h.put("totalRcas", rcas.size());

        return h;
    }

    public Map<String, Object> sparePartsReport() {
        List<BreakdownRectification> rects = rectifications.findAll();
        List<PMCompletion> pmcs = pmCompletions.findAll();

        Map<String, Long> partsUsage = new LinkedHashMap<>();
        for (BreakdownRectification r : rects) {
            if (r.getSparePartsUsed() != null && !r.getSparePartsUsed().isBlank()) {
                for (String part : r.getSparePartsUsed().split("[,;\\n]")) {
                    String trimmed = part.trim();
                    if (!trimmed.isEmpty()) partsUsage.merge(trimmed, 1L, (a, b) -> a + b);
                }
            }
        }
        for (PMCompletion c : pmcs) {
            if (c.getSparePartsUsed() != null && !c.getSparePartsUsed().isBlank()) {
                for (String part : c.getSparePartsUsed().split("[,;\\n]")) {
                    String trimmed = part.trim();
                    if (!trimmed.isEmpty()) partsUsage.merge(trimmed, 1L, (a, b) -> a + b);
                }
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalTransactions", rects.size() + pmcs.size());
        result.put("partsUsage", partsUsage);
        result.put("uniqueParts", partsUsage.size());
        return result;
    }

    public Map<String, Object> costReport(String from, String to) {
        List<BreakdownRectification> rects = rectifications.findAll();
        List<ToolServiceRectification> toolRects = toolRectifications.findAll();
        List<PMCompletion> pmcs = pmCompletions.findAll();

        BigDecimal totalBreakdownCost = rects.stream()
            .map(r -> r.getServiceCost() != null ? r.getServiceCost() : BigDecimal.ZERO)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal totalToolCost = toolRects.stream()
            .map(r -> r.getServiceCost() != null ? r.getServiceCost() : BigDecimal.ZERO)
            .reduce(BigDecimal.ZERO, BigDecimal::add);

        Map<String, BigDecimal> costByMachine = new LinkedHashMap<>();
        for (BreakdownRectification r : rects) {
            if (r.getMachineCode() != null && r.getServiceCost() != null) {
                costByMachine.merge(r.getMachineCode(), r.getServiceCost(), BigDecimal::add);
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        BigDecimal totalAdjustment = costAdjustments.findAll().stream()
            .map(a -> a.getDeltaAmount() != null ? a.getDeltaAmount() : BigDecimal.ZERO)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        result.put("totalBreakdownCost", totalBreakdownCost);
        result.put("totalToolServiceCost", totalToolCost);
        result.put("totalAdjustment", totalAdjustment);
        result.put("grandTotal", totalBreakdownCost.add(totalToolCost).add(totalAdjustment));
        result.put("costByMachine", costByMachine);
        result.put("breakdownTransactions", rects.size());
        result.put("toolServiceTransactions", toolRects.size());
        result.put("pmCompletions", pmcs.size());
        return result;
    }

    public Map<String, Object> downtimeSummary() {
        List<DowntimeTransaction> all = downtimeTransactions.findAll();
        Map<String, BigDecimal> byMachine = new LinkedHashMap<>();
        Map<String, BigDecimal> bySource = new LinkedHashMap<>();
        BigDecimal total = BigDecimal.ZERO;
        for (DowntimeTransaction dt : all) {
            BigDecimal dur = dt.getDurationMinutes() != null ? dt.getDurationMinutes() : BigDecimal.ZERO;
            total = total.add(dur);
            byMachine.merge(dt.getMachineCode(), dur, BigDecimal::add);
            bySource.merge(dt.getSourceType(), dur, BigDecimal::add);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalDowntimeMinutes", total);
        result.put("totalDowntimeHours", total.divide(BigDecimal.valueOf(60), 2, RoundingMode.HALF_UP));
        result.put("byMachine", byMachine);
        result.put("bySource", bySource);
        result.put("transactionCount", all.size());
        return result;
    }

    public Map<String, Object> downtimeCostReport() {
        List<BreakdownRectification> rects = rectifications.findAll();
        List<PMCompletion> pmcs = pmCompletions.findAll();
        List<DowntimeTransaction> dts = downtimeTransactions.findAll();

        BigDecimal totalBreakdownDowntime = dts.stream()
                .filter(d -> "BREAKDOWN".equals(d.getSourceType()))
                .map(d -> d.getDurationMinutes() != null ? d.getDurationMinutes() : BigDecimal.ZERO)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal totalPmDowntime = dts.stream()
                .filter(d -> "PM".equals(d.getSourceType()))
                .map(d -> d.getDurationMinutes() != null ? d.getDurationMinutes() : BigDecimal.ZERO)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal totalBreakdownCost = rects.stream()
                .map(r -> r.getServiceCost() != null ? r.getServiceCost() : BigDecimal.ZERO)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal totalLabourHours = rects.stream()
                .map(r -> r.getLabourHours() != null ? r.getLabourHours() : BigDecimal.ZERO)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        Map<String, BigDecimal> costByMachine = new LinkedHashMap<>();
        for (BreakdownRectification r : rects) {
            if (r.getMachineCode() != null && r.getServiceCost() != null)
                costByMachine.merge(r.getMachineCode(), r.getServiceCost(), BigDecimal::add);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalBreakdownDowntimeMinutes", totalBreakdownDowntime);
        result.put("totalPmDowntimeMinutes", totalPmDowntime);
        result.put("totalDowntimeMinutes", totalBreakdownDowntime.add(totalPmDowntime));
        result.put("totalBreakdownCost", totalBreakdownCost);
        result.put("totalLabourHours", totalLabourHours);
        result.put("costByMachine", costByMachine);
        result.put("breakdownTransactions", rects.size());
        result.put("pmCompletions", pmcs.size());
        result.put("downtimeTransactions", dts.size());
        return result;
    }

    // ===========================
    // ---- MASTERS -------------
    // ===========================

    // Departments
    public List<DepartmentMaster> listDepartments() { return departments.findAll(); }
    public DepartmentMaster createDepartment(DepartmentMaster d, Principal principal) {
        d.setId(null); d.setActive(true); setCreated(d, principalName(principal));
        return departments.save(d);
    }
    public DepartmentMaster updateDepartment(Long id, DepartmentMaster d, Principal principal) {
        d.setId(id); audit(d, principalName(principal)); return departments.save(d);
    }

    // Service Vendors (spec 3: vendor_master replaces free-text vendor fields)
    public List<VendorMaster> listVendors() { return vendors.findAll(); }
    public VendorMaster createVendor(VendorMaster v, Principal principal) {
        v.setId(null); v.setActive(true); setCreated(v, principalName(principal));
        return vendors.save(v);
    }
    public VendorMaster updateVendor(Long id, VendorMaster v, Principal principal) {
        v.setId(id); audit(v, principalName(principal)); return vendors.save(v);
    }

    private void denormalizeRectificationVendor(BreakdownRectification r) {
        if (r.getVendorId() == null) return;
        vendors.findById(r.getVendorId()).ifPresent(v -> r.setExternalVendor(v.getName()));
    }

    private void denormalizeToolServiceVendor(ToolServiceIntimation t) {
        if (t.getVendorId() == null) return;
        vendors.findById(t.getVendorId()).ifPresent(v -> t.setVendor(v.getName()));
    }

    // Technicians
    public List<TechnicianMaster> listTechnicians() { return technicians.findAll(); }
    public TechnicianMaster createTechnician(TechnicianMaster t, Principal principal) {
        t.setId(null); t.setActive(true); setCreated(t, principalName(principal));
        return technicians.save(t);
    }
    public TechnicianMaster updateTechnician(Long id, TechnicianMaster t, Principal principal) {
        t.setId(id); audit(t, principalName(principal)); return technicians.save(t);
    }

    // Breakdown Categories
    public List<BreakdownCategoryMaster> listBreakdownCategories() { return breakdownCategories.findAll(); }
    public BreakdownCategoryMaster createBreakdownCategory(BreakdownCategoryMaster bc, Principal principal) {
        bc.setId(null); bc.setActive(true); setCreated(bc, principalName(principal));
        return breakdownCategories.save(bc);
    }

    // Failure Codes
    public List<FailureCodeMaster> listFailureCodes() { return failureCodes.findAll(); }
    public FailureCodeMaster createFailureCode(FailureCodeMaster fc, Principal principal) {
        fc.setId(null); fc.setActive(true); setCreated(fc, principalName(principal));
        return failureCodes.save(fc);
    }

    // Root Cause Codes
    public List<RootCauseCodeMaster> listRootCauseCodes() { return rootCauseCodes.findAll(); }
    public RootCauseCodeMaster createRootCauseCode(RootCauseCodeMaster rc, Principal principal) {
        rc.setId(null); rc.setActive(true); setCreated(rc, principalName(principal));
        return rootCauseCodes.save(rc);
    }

    // Activities
    public List<MaintenanceActivityMaster> listActivities() { return activities.findAll(); }
    public MaintenanceActivityMaster createActivity(MaintenanceActivityMaster a, Principal principal) {
        a.setId(null); a.setActive(true); setCreated(a, principalName(principal));
        return activities.save(a);
    }

    // PM Checklist Templates
    public List<PmChecklistTemplate> listPmChecklistTemplates() { return pmChecklistTemplates.findAll(); }
    public PmChecklistTemplate createPmChecklistTemplate(PmChecklistTemplate t, Principal principal) {
        t.setId(null); t.setActive(true); setCreated(t, principalName(principal));
        if (t.getItems() != null) {
            for (PmChecklistTemplateItem item : t.getItems()) { item.setTemplate(t); }
        }
        return pmChecklistTemplates.save(t);
    }

    // Breakdown Assignments
    public List<BreakdownAssignment> listBreakdownAssignments(Long breakdownId) {
        return breakdownAssignments.findByBreakdownId(breakdownId);
    }
    public BreakdownAssignment createBreakdownAssignment(Long breakdownId, BreakdownAssignment a, Principal principal) {
        a.setId(null); a.setBreakdownId(breakdownId); a.setAssignedBy(principalName(principal)); a.setAssignedAt(Instant.now());
        breakdowns.findById(breakdownId).orElseThrow(() -> new RuntimeException("Breakdown not found"));
        technicians.findById(a.getTechnicianId()).orElseThrow(() -> new RuntimeException("Technician not found"));
        boolean secondary = Boolean.TRUE.equals(a.getSecondaryAssignee());
        if (!secondary && breakdownAssignments.countActiveByTechnicianId(a.getTechnicianId(), breakdownId) > 0) {
            throw new IllegalStateException(
                "Technician '" + a.getTechnicianId() + "' already assigned to another active breakdown (BR-13); "
                + "mark as secondary assignee to override");
        }
        BreakdownAssignment saved = breakdownAssignments.save(a);
        BreakdownIntimation bd = breakdowns.findById(breakdownId).orElse(null);
        if (bd != null) { bd.setStatus("ASSIGNED"); audit(bd, principalName(principal)); breakdowns.save(bd); }
        return saved;
    }

    // PM Completion Checklist Items
    public List<PmCompletionChecklistItem> listPmChecklistItems(Long completionId) {
        return pmChecklistItems.findByCompletionId(completionId);
    }
    public List<PmCompletionChecklistItem> createPmChecklistBatch(Long completionId, List<PmCompletionChecklistItem> items) {
        for (PmCompletionChecklistItem item : items) {
            item.setId(null); item.setCompletionId(completionId);
        }
        return pmChecklistItems.saveAll(items);
    }

    /**
     * BR-15: resolve the PM completion's schedule -> plan -> checklist template and
     * materialise one checklist item per template item so the technician can record a
     * result for each before verifying.
     */
    public void generateChecklistForCompletion(PMCompletion completion) {
        if (completion == null || completion.getScheduleId() == null) return;
        PMSchedule sched = pmSchedules.findById(completion.getScheduleId()).orElse(null);
        if (sched == null || sched.getPlanId() == null) return;
        PMPlan plan = pmPlans.findById(sched.getPlanId()).orElse(null);
        if (plan == null || plan.getChecklistTemplateId() == null) return;

        PmChecklistTemplate template = pmChecklistTemplates.findById(plan.getChecklistTemplateId()).orElse(null);
        if (template == null || template.getItems() == null || template.getItems().isEmpty()) return;

        if (!pmChecklistItems.findByCompletionId(completion.getId()).isEmpty()) return;

        List<PmCompletionChecklistItem> items = new ArrayList<>();
        int order = 0;
        for (PmChecklistTemplateItem t : template.getItems()) {
            order++;
            items.add(PmCompletionChecklistItem.builder()
                    .completionId(completion.getId())
                    .activityId(t.getActivityId())
                    .activityName(t.getActivityName() != null ? t.getActivityName() : ("Checklist item " + order))
                    .isMandatory(t.getIsMandatory() != null ? t.getIsMandatory() : true)
                    .sortOrder(t.getSortOrder() != null ? t.getSortOrder() : order)
                    .build());
        }
        pmChecklistItems.saveAll(items);
    }

    // Attachments
    public List<MaintenanceAttachment> listAttachments(String sourceType, Long sourceId) {
        return maintenanceAttachments.findBySourceTypeAndSourceId(sourceType, sourceId);
    }
    public MaintenanceAttachment createAttachment(MaintenanceAttachment a, Principal principal) {
        a.setId(null); a.setUploadedBy(principalName(principal)); a.setUploadedAt(Instant.now());
        return maintenanceAttachments.save(a);
    }

    // Downtime Transactions
    public List<DowntimeTransaction> listDowntime(Long machineId) {
        if (machineId != null) return downtimeTransactions.findByMachineId(machineId);
        return downtimeTransactions.findAll();
    }

    // Notification Log
    public List<NotificationLog> listNotifications(String recipient, String sourceType, Long sourceId) {
        if (recipient != null) return notificationLogs.findTop50ByRecipientOrderBySentAtDesc(recipient);
        if (sourceType != null && sourceId != null) return notificationLogs.findBySourceTypeAndSourceId(sourceType, sourceId);
        return notificationLogs.findAll();
    }
    public NotificationLog createNotification(NotificationLog n) {
        n.setId(null); n.setSentAt(Instant.now()); n.setStatus("SENT");
        return notificationLogs.save(n);
    }
}
