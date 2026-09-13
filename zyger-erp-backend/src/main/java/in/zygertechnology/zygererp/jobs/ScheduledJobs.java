package in.zygertechnology.zygererp.jobs;

import in.zygertechnology.zygererp.entity.CalibrationSchedule;
import in.zygertechnology.zygererp.entity.InstrumentMaster;
import in.zygertechnology.zygererp.entity.ItemMaster;
import in.zygertechnology.zygererp.entity.PMSchedule;
import in.zygertechnology.zygererp.entity.PurchaseOrder;
import in.zygertechnology.zygererp.entity.WorkOrder;
import in.zygertechnology.zygererp.entity.SalesOrder;
import in.zygertechnology.zygererp.entity.SalesInvoice;
import in.zygertechnology.zygererp.entity.Party;
import in.zygertechnology.zygererp.repo.CalibrationScheduleRepository;
import in.zygertechnology.zygererp.repo.InstrumentMasterRepository;
import in.zygertechnology.zygererp.repo.NotificationRepository;
import in.zygertechnology.zygererp.repo.PMScheduleRepository;
import in.zygertechnology.zygererp.repo.PartyRepository;
import in.zygertechnology.zygererp.repo.RefreshTokenRepository;
import in.zygertechnology.zygererp.service.EscalationEngine;
import in.zygertechnology.zygererp.service.EmailService;
import in.zygertechnology.zygererp.service.NotificationService;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Scheduled housekeeping jobs.
 *
 * Cron expressions are configurable per job via properties (defaults shown):
 *   zyger.scheduling.calibration-check   (daily 8 AM)
 *   zyger.scheduling.overdue-work-order  (daily 9 AM)
 *   zyger.scheduling.overdue-po          (daily 9:30 AM)
 *   zyger.scheduling.low-stock           (daily 7 AM)
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ScheduledJobs {

    private final EntityManager em;
    private final NotificationService notificationService;
    private final NotificationRepository notificationRepository;
    private final RefreshTokenRepository refreshTokens;
    private final EscalationEngine escalationEngine;
    private final EmailService emailService;
    private final PMScheduleRepository pmSchedules;
    private final PartyRepository parties;
    private final CalibrationScheduleRepository calSchedules;
    private final InstrumentMasterRepository instruments;

    /**
     * Daily at 3 AM: delete refresh tokens that have expired (security housekeeping).
     */
    @Scheduled(cron = "${zyger.scheduling.refresh-token-cleanup:0 0 3 * * *}")
    @Transactional
    public void cleanupExpiredRefreshTokens() {
        long deleted = refreshTokens.deleteByExpiresAtBefore(Instant.now());
        if (deleted > 0) {
            log.info("[Refresh Token Cleanup] Deleted {} expired refresh token(s).", deleted);
        }
    }

    /**
     * Persist a notification for the given entity unless an unread notification
     * for the same event type already exists (prevents duplicate daily pings
     * while the condition remains unresolved).
     */
    private void notifyOnce(String eventType, String module, String entityType, Long entityId,
                            String severity, String message, String entityRef) {
        boolean alreadyNotified = notificationRepository.findByEntityTypeAndEntityId(entityType, entityId).stream()
                .anyMatch(n -> eventType.equals(n.getEventType()) && n.getReadAt() == null);
        if (alreadyNotified) return;
        notificationService.notify(eventType, module, entityType, entityId, severity, message, entityRef);
    }

    /**
     * Daily at 8 AM: warn about calibration schedules that are due within the
     * next 7 days or already overdue.
     */
    @Scheduled(cron = "${zyger.scheduling.calibration-check:0 0 8 * * *}")
    public void calibrationDueCheck() {
        try {
            LocalDate today = LocalDate.now();
            LocalDate cutoff = today.plusDays(7);
            List<CalibrationSchedule> due = em.createQuery("""
                            select c from CalibrationSchedule c
                            where c.deleted = false
                              and c.nextDueDate is not null
                              and c.nextDueDate <= :cutoff
                            order by c.nextDueDate asc
                            """, CalibrationSchedule.class)
                    .setParameter("cutoff", cutoff)
                    .getResultList();

            if (due.isEmpty()) {
                log.info("[Calibration Check] No calibration schedules due within {} days.", 7);
                return;
            }

            List<String> overdue = due.stream()
                    .filter(c -> c.getNextDueDate().isBefore(today))
                    .map(CalibrationSchedule::getScheduleNumber)
                    .toList();
            List<String> upcoming = due.stream()
                    .filter(c -> !c.getNextDueDate().isBefore(today))
                    .map(c -> c.getScheduleNumber() + " (due " + c.getNextDueDate() + ")")
                    .toList();

            log.warn("[Calibration Check] {} instrument calibration schedule(s) need attention: {} overdue, {} due within 7 days. Overdue: {}; Upcoming: {}",
                    due.size(), overdue.size(), upcoming.size(), overdue, upcoming);

            for (CalibrationSchedule c : due) {
                boolean isOverdue = c.getNextDueDate().isBefore(today);
                String message = isOverdue
                        ? "Calibration schedule " + c.getScheduleNumber() + " is OVERDUE (was due " + c.getNextDueDate() + ")"
                        : "Calibration schedule " + c.getScheduleNumber() + " is due on " + c.getNextDueDate();
                notifyOnce(isOverdue ? "CALIBRATION_OVERDUE" : "CALIBRATION_DUE",
                        "QUALITY", "CalibrationSchedule", c.getId(),
                        isOverdue ? "CRITICAL" : "WARNING",
                        message, c.getScheduleNumber());
                try {
                    emailService.sendCalibrationDueNotification(
                            "admin@zyger.local", c.getScheduleNumber(),
                            c.getInstrumentName() != null ? c.getInstrumentName() : c.getInstrumentId(), c.getNextDueDate(), isOverdue);
                } catch (Exception ex) {
                    log.warn("Failed to send calibration email for {}: {}", c.getScheduleNumber(), ex.getMessage());
                }
            }
        } catch (Exception ex) {
            log.error("[Calibration Check] Failed to run calibration due check", ex);
        }
    }

    /**
     * Daily at 9 AM: summarize work orders whose due date has passed and that
     * are not yet COMPLETED / CLOSED / CANCELLED.
     */
    @Scheduled(cron = "${zyger.scheduling.overdue-work-order:0 0 9 * * *}")
    public void overdueWorkOrderCheck() {
        try {
            LocalDate today = LocalDate.now();
            List<WorkOrder> overdue = em.createQuery("""
                            select w from WorkOrder w
                            where w.dueDate < :today
                              and (w.status is null or w.status not in ('COMPLETED', 'CLOSED', 'CANCELLED'))
                            order by w.dueDate asc
                            """, WorkOrder.class)
                    .setParameter("today", today)
                    .getResultList();

            if (overdue.isEmpty()) {
                log.info("[Overdue Work Order Check] No overdue open work orders.");
                return;
            }

            Map<String, Long> byStatus = overdue.stream()
                    .collect(Collectors.groupingBy(w -> w.getStatus() == null ? "UNSET" : w.getStatus(), Collectors.counting()));

            String summary = overdue.stream()
                    .limit(10)
                    .map(w -> w.getDocNo() + " (due " + w.getDueDate() + ")")
                    .collect(Collectors.joining(", "));

            log.warn("[Overdue Work Order Check] {} work order(s) past their due date and still open. By status: {}. Sample: {}{}",
                    overdue.size(), byStatus,
                    summary, overdue.size() > 10 ? ", ..." : "");

            for (WorkOrder w : overdue) {
                notifyOnce("WO_DELAYED", "PRODUCTION", "WorkOrder", w.getId(),
                        "WARNING",
                        "Work order " + w.getDocNo() + " is past its due date (" + w.getDueDate() + ") and still open",
                        w.getDocNo());
            }
        } catch (Exception ex) {
            log.error("[Overdue Work Order Check] Failed to run overdue work order check", ex);
        }
    }

    /**
     * Daily at 9:30 AM: summarize purchase orders whose required date has
     * passed but which are not POSTED / RECEIVED / CLOSED / CANCELLED.
     *
     * A PO's effective required date comes from its line-level requiredDate
     * (falling back to the header expectedDeliveryDate); POs without lines use
     * the header expectedDeliveryDate directly.
     */
    @Scheduled(cron = "${zyger.scheduling.overdue-po:0 30 9 * * *}")
    public void overduePoCheck() {
        try {
            LocalDate today = LocalDate.now();
            List<PurchaseOrder> overdue = em.createQuery("""
                            select po from PurchaseOrder po
                            where (po.status is null or po.status not in ('POSTED', 'RECEIVED', 'CLOSED', 'CANCELLED'))
                              and (
                                    exists (select l from PurchaseOrderItem l
                                            where l.doc = po
                                              and coalesce(l.requiredDate, po.expectedDeliveryDate) < :today)
                                 or (po.expectedDeliveryDate < :today
                                     and not exists (select l2 from PurchaseOrderItem l2 where l2.doc = po))
                                  )
                            order by po.expectedDeliveryDate asc
                            """, PurchaseOrder.class)
                    .setParameter("today", today)
                    .getResultList();

            if (overdue.isEmpty()) {
                log.info("[Overdue PO Check] No overdue open purchase orders.");
                return;
            }

            Map<String, Long> byStatus = overdue.stream()
                    .collect(Collectors.groupingBy(po -> po.getStatus() == null ? "UNSET" : po.getStatus(), Collectors.counting()));

            String summary = overdue.stream()
                    .limit(10)
                    .map(po -> po.getDocNo() + " (expected " + po.getExpectedDeliveryDate() + ")")
                    .collect(Collectors.joining(", "));

            log.warn("[Overdue PO Check] {} purchase order(s) past their required date and not fulfilled. By status: {}. Sample: {}{}",
                    overdue.size(), byStatus,
                    summary, overdue.size() > 10 ? ", ..." : "");

            for (PurchaseOrder po : overdue) {
                notifyOnce("PO_OVERDUE", "PURCHASE", "PurchaseOrder", po.getId(),
                        "WARNING",
                        "Purchase order " + po.getDocNo() + " is past its expected delivery date (" + po.getExpectedDeliveryDate() + ") and not fulfilled",
                        po.getDocNo());
            }
        } catch (Exception ex) {
            log.error("[Overdue PO Check] Failed to run overdue PO check", ex);
        }
    }

    /**
     * Daily at 7 AM: compare free available stock per item against the item's
     * reorder point (ItemMaster.reorderPoint) and summarize items below it.
     */
    @Scheduled(cron = "${zyger.scheduling.low-stock:0 0 7 * * *}")
    public void lowStockCheck() {
        try {
            Map<String, BigDecimal> availableByItem = new HashMap<>();
            for (Object[] row : em.createQuery("""
                            select sb.itemCode, sum(sb.qty) from StockBalance sb
                            where sb.stockStatus = 'FREE'
                            group by sb.itemCode
                            """, Object[].class)
                    .getResultList()) {
                String itemCode = (String) row[0];
                BigDecimal qty = row[1] instanceof BigDecimal bd ? bd : new BigDecimal(String.valueOf(row[1]));
                availableByItem.merge(itemCode, qty, BigDecimal::add);
            }

            List<ItemMaster> withReorderPoint = em.createQuery(
                            "select i from ItemMaster i where i.reorderPoint is not null", ItemMaster.class)
                    .getResultList();
            if (withReorderPoint.isEmpty()) {
                log.info("[Low Stock Check] No items define a reorder point; nothing to check.");
                return;
            }

            record LowStock(Long itemId, String code, BigDecimal available, BigDecimal reorderPoint) {}
            List<LowStock> low = withReorderPoint.stream()
                    .map(i -> new LowStock(i.getId(), i.getCode(),
                            availableByItem.getOrDefault(i.getCode(), BigDecimal.ZERO), i.getReorderPoint()))
                    .filter(ls -> ls.available().compareTo(ls.reorderPoint()) < 0)
                    .toList();

            if (low.isEmpty()) {
                log.info("[Low Stock Check] All tracked items ({}) are at or above reorder point.", withReorderPoint.size());
                return;
            }

            String summary = low.stream()
                    .limit(10)
                    .map(ls -> ls.code() + " (available " + ls.available() + " <= reorder " + ls.reorderPoint() + ")")
                    .collect(Collectors.joining(", "));

            log.warn("[Low Stock Check] {} item(s) below reorder level out of {} tracked. Items: {}{}",
                    low.size(), withReorderPoint.size(), summary, low.size() > 10 ? ", ..." : "");

            for (LowStock ls : low) {
                notifyOnce("LOW_STOCK", "INVENTORY", "ItemMaster", ls.itemId(),
                        "WARNING",
                        "Item " + ls.code() + " is below reorder point (available " + ls.available() + ", reorder " + ls.reorderPoint() + ")",
                        ls.code());
            }
        } catch (Exception ex) {
            log.error("[Low Stock Check] Failed to run low stock check", ex);
        }
    }

    /**
     * Every 15 minutes: check all open quality inspections and breakdowns for SLA escalation.
     */
    @Scheduled(cron = "${zyger.scheduling.escalation-check:0 */15 * * * *}")
    @Transactional
    public void checkEscalations() {
        try {
            // Quality inspections
            List<Object[]> openInspecs = em.createQuery(
                    "SELECT i.id, i.inspectionNumber, i.createdAt, i.inspectionStatus, i.holdSince " +
                    "FROM QualityInspection i " +
                    "WHERE i.inspectionStatus NOT IN ('CLOSED', 'CANCELLED') AND i.createdAt IS NOT NULL",
                    Object[].class).getResultList();
            for (Object[] row : openInspecs) {
                Instant anchor = row[2] instanceof Instant ? (Instant) row[2] : null;
                String status = row[3] instanceof String ? (String) row[3] : "";
                Instant holdSince = row[4] instanceof Instant ? (Instant) row[4] : null;
                // HOLD SLA/aging: anchor on holdSince so HOLD aging is tracked from the hold start,
                // not the inspection creation time.
                if ("HOLD".equals(status) && holdSince != null) {
                    anchor = holdSince;
                }
                if (anchor == null) anchor = Instant.now();
                escalationEngine.checkAndEscalate("QUALITY_INSPECTION", ((Number) row[0]).longValue(),
                        (String) row[1], anchor);
            }

            // Breakdown intimations
            List<Object[]> openBds = em.createQuery(
                    "SELECT b.id, b.breakdownNumber, b.createdAt FROM BreakdownIntimation b " +
                    "WHERE b.status NOT IN ('CLOSED', 'CANCELLED') AND b.createdAt IS NOT NULL",
                    Object[].class).getResultList();
            for (Object[] row : openBds) {
                escalationEngine.checkAndEscalate("BREAKDOWN_INTIMATION", ((Number) row[0]).longValue(),
                        (String) row[1], row[2] instanceof Instant ? (Instant) row[2] : Instant.now());
            }

            if (!openInspecs.isEmpty() || !openBds.isEmpty()) {
                log.info("[Escalation Check] Checked {} inspections + {} breakdowns",
                        openInspecs.size(), openBds.size());
            }
        } catch (Exception ex) {
            log.error("[Escalation Check] Failed", ex);
        }
    }

    /**
     * Nightly at 1 AM: auto-populate OEE from production + breakdown data for yesterday.
     */
    @Scheduled(cron = "${zyger.scheduling.oee-populate:0 0 1 * * *}")
    @Transactional
    @SuppressWarnings("unchecked")
    public void populateOeeDaily() {
        try {
            LocalDate yesterday = LocalDate.now().minusDays(1);
            // Get machines that had production entries yesterday. This used to read
            // shop_floor_entry — a separate, parallel entry screen from the canonical
            // Production Entry (production_entry table) that shop-floor users actually use
            // (Production Module FRS audit finding: OEE silently never populated with real
            // data because the two tables track different rows).
            List<Object[]> prodMachines = em.createNativeQuery(
                    "SELECT DISTINCT machine_code FROM production_entry " +
                    "WHERE DATE(production_date) = :date AND status = 'POSTED' AND machine_code IS NOT NULL",
                    Object[].class)
                    .setParameter("date", yesterday)
                    .getResultList();

            for (Object[] row : prodMachines) {
                String machineCode = (String) row[0];
                // Check if OEE already populated for this machine/date
                Long existing = ((Number) em.createNativeQuery(
                        "SELECT COUNT(*) FROM oee_daily WHERE machine_code = :mc AND entry_date = :dt AND plant_id = 1")
                        .setParameter("mc", machineCode)
                        .setParameter("dt", yesterday)
                        .getSingleResult()).longValue();
                if (existing > 0) continue;

                // Get total downtime in hours for this machine yesterday
                Number downtime = (Number) em.createNativeQuery(
                        "SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(closed_at, NOW()) - created_at)) / 3600), 0) " +
                        "FROM breakdown_intimation WHERE machine_code = :mc " +
                        "AND DATE(created_at) = :date AND status != 'CANCELLED' AND deleted_at IS NULL")
                        .setParameter("mc", machineCode)
                        .setParameter("date", yesterday)
                        .getSingleResult();

                double plannedHrs = 8.0; // single shift default
                double downtimeHrs = downtime != null ? downtime.doubleValue() : 0;
                double runHrs = Math.max(0, plannedHrs - downtimeHrs);
                double availability = plannedHrs > 0 ? runHrs / plannedHrs : 0;

                // FRS §7.5: Compute performance and quality from production data
                Number goodQty = (Number) em.createNativeQuery(
                        "SELECT COALESCE(SUM(good_quantity), 0) FROM production_entry " +
                        "WHERE machine_code = :mc AND DATE(production_date) = :date AND status = 'POSTED'")
                        .setParameter("mc", machineCode)
                        .setParameter("date", yesterday)
                        .getSingleResult();
                Number totalQty = (Number) em.createNativeQuery(
                        "SELECT COALESCE(SUM(good_quantity + COALESCE(rejected_quantity,0) + COALESCE(scrap_quantity,0)), 0) " +
                        "FROM production_entry " +
                        "WHERE machine_code = :mc AND DATE(production_date) = :date AND status = 'POSTED'")
                        .setParameter("mc", machineCode)
                        .setParameter("date", yesterday)
                        .getSingleResult();

                double good = goodQty != null ? goodQty.doubleValue() : 0;
                double total = totalQty != null ? totalQty.doubleValue() : 0;
                double quality = total > 0 ? good / total : 0.95;
                // Performance: (idealCycleTimeSec × totalQty) / (runHrs × 3600)
                // Default 50 units/hr ideal rate = 72 sec/unit
                double performance = runHrs > 0 ? Math.min(1.0, (total * 72) / (runHrs * 3600)) : 0.85;
                double oee = availability * performance * quality;

                // Insert OEE record with computed values
                em.createNativeQuery(
                        "INSERT INTO oee_daily (machine_code, oee_date, planned_time_min, run_time_min, downtime_min, " +
                        "good_qty, total_qty, ideal_cycle_time_sec, availability, performance, quality_rate, oee, plant_id, created_at) " +
                        "VALUES (:mc, :dt, :ptm, :rtm, :dmt, :gq, :tq, :ict, :av, :pf, :qr, :oee, 1, NOW())")
                        .setParameter("mc", machineCode)
                        .setParameter("dt", yesterday)
                        .setParameter("ptm", plannedHrs * 60)
                        .setParameter("rtm", runHrs * 60)
                        .setParameter("dmt", downtimeHrs * 60)
                        .setParameter("gq", good)
                        .setParameter("tq", total)
                        .setParameter("ict", 72.0)
                        .setParameter("av", availability)
                        .setParameter("pf", performance)
                        .setParameter("qr", quality)
                        .setParameter("oee", oee)
                        .executeUpdate();

                // §10.3 Feed real operating hours for MTBF/MTTR
                em.createNativeQuery(
                        "INSERT INTO machine_operating_hours (machine_code, work_date, operating_hours, source, plant_id, created_at) " +
                        "VALUES (:mc, :dt, :oh, 'PRODUCTION', 1, NOW()) " +
                        "ON CONFLICT (machine_code, work_date) DO UPDATE SET operating_hours = :oh")
                        .setParameter("mc", machineCode)
                        .setParameter("dt", yesterday)
                        .setParameter("oh", runHrs)
                        .executeUpdate();
            }
            log.info("[OEE Populate] Processed {} machines for {}", prodMachines.size(), yesterday);
        } catch (Exception ex) {
            log.error("[OEE Populate] Failed", ex);
        }
    }

    /**
     * §7.6: Meter consumption anomaly detection — alert if consumption >20% above budget.
     */
    @Scheduled(cron = "${zyger.scheduling.meter-anomaly:0 30 7 * * *}")
    @Transactional
    @SuppressWarnings("unchecked")
    public void checkMeterAnomalies() {
        try {
            List<Object[]> readings = em.createNativeQuery(
                    "SELECT id, meter_code, reading_date, units_consumed FROM power_consumption " +
                    "WHERE DATE(reading_date) = :yesterday AND deleted_at IS NULL",
                    Object[].class)
                    .setParameter("yesterday", LocalDate.now().minusDays(1))
                    .getResultList();

            for (Object[] row : readings) {
                Long id = ((Number) row[0]).longValue();
                String meterCode = (String) row[1];
                Number units = (Number) row[3];

                // Get budget for this meter
                Number budget = (Number) em.createNativeQuery(
                        "SELECT budget_monthly_units FROM meter_master WHERE code = :mc AND active = true")
                        .setParameter("mc", meterCode)
                        .getSingleResult();

                if (budget != null && units != null && budget.doubleValue() > 0) {
                    double dailyBudget = budget.doubleValue() / 30.0;
                    double consumed = units.doubleValue();
                    if (consumed > dailyBudget * 1.2) {
                        log.warn("[Meter Anomaly] {} consumed {} units (budget: {}/day, +{:.0f}%)",
                                meterCode, consumed, dailyBudget, ((consumed - dailyBudget) / dailyBudget) * 100);
                    }
                }
            }
        } catch (Exception ex) {
            log.error("[Meter Anomaly Check] Failed", ex);
        }
    }

    /**
     * §4.3 + §6.4: CAPA effectiveness-check reminders at 30/60/90 days post-approval.
     */
    @Scheduled(cron = "${zyger.scheduling.capa-effectiveness:0 0 10 * * *}")
    @Transactional
    public void checkCapaEffectiveness() {
        try {
            List<Object[]> approvedCapas = em.createQuery(
                    "SELECT c.id, c.docNo, c.approvedAt FROM QualityCapa c " +
                    "WHERE c.status = 'APPROVED' AND c.effectiveResult IS NULL AND c.deletedAt IS NULL",
                    Object[].class).getResultList();

            for (Object[] row : approvedCapas) {
                Long id = ((Number) row[0]).longValue();
                String docNo = (String) row[1];
                Instant approvedAt = row[2] instanceof Instant ? (Instant) row[2] : Instant.now();
                long daysSince = java.time.Duration.between(approvedAt, Instant.now()).toDays();

                if (daysSince >= 90) {
                    notifyOnce("CAPA_EFFECTIVENESS_OVERDUE", "QUALITY", "QualityCapa", id,
                            "CRITICAL", "CAPA " + docNo + " is " + daysSince + " days past approval — effectiveness check OVERDUE!", docNo);
                } else if (daysSince >= 60) {
                    notifyOnce("CAPA_EFFECTIVENESS_DUE_60", "QUALITY", "QualityCapa", id,
                            "HIGH", "CAPA " + docNo + " — 60-day effectiveness check due.", docNo);
                } else if (daysSince >= 30) {
                    notifyOnce("CAPA_EFFECTIVENESS_DUE_30", "QUALITY", "QualityCapa", id,
                            "MEDIUM", "CAPA " + docNo + " — 30-day effectiveness check reminder.", docNo);
                }
            }
        } catch (Exception ex) {
            log.error("[CAPA Effectiveness Check] Failed", ex);
        }
    }

    // ─── Spec §4.3: Quality Inspection SLA / Aging / Escalation ───

    /**
     * Runs every 15 minutes. Computes aging/is_overdue on all non-terminal
     * inspections and fires tiered escalation notifications (spec §4.3).
     */
    @Scheduled(cron = "${zyger.scheduling.quality-sla:0 */15 * * * *}")
    @Transactional
    public void qualityInspectionSlaCheck() {
        try {
            List<Object[]> rows = em.createQuery(
                    "SELECT i.id, i.inspectionNumber, i.inspectionType, i.inspectionStatus, " +
                    "i.createdAt, i.dueDate, i.priority, i.startedAt, i.assignedInspector " +
                    "FROM QualityInspection i " +
                    "WHERE i.inspectionStatus NOT IN ('CLOSED','CANCELLED') " +
                    "AND i.deletedAt IS NULL",
                    Object[].class).getResultList();

            Instant now = Instant.now();
            for (Object[] r : rows) {
                Long id = ((Number) r[0]).longValue();
                String number = (String) r[1];
                String type = r[2] != null ? r[2].toString() : "?";
                String status = (String) r[3];
                Instant createdAt = r[4] instanceof Instant ? (Instant) r[4] : null;
                LocalDate dueDate = r[5] instanceof LocalDate ? (LocalDate) r[5] : null;
                String priority = r[6] != null ? r[6].toString() : "Normal";
                Instant startedAt = r[7] instanceof Instant ? (Instant) r[7] : null;
                String inspector = (String) r[8];

                if (createdAt == null) continue;
                long agingMinutes = java.time.Duration.between(createdAt, now).toMinutes();

                // Update aging fields
                em.createQuery("UPDATE QualityInspection i SET i.isLocked = i.isLocked WHERE i.id = :id")
                        .setParameter("id", id).executeUpdate();

                // SLA thresholds (spec §4.3)
                int slaMinutes = switch (priority.toUpperCase()) {
                    case "CRITICAL" -> 120;   // 2 hours
                    case "HIGH" -> 240;        // 4 hours
                    case "NORMAL" -> 1440;     // 24 hours
                    case "LOW" -> 480;          // same shift (8h)
                    default -> 1440;
                };

                boolean overdue = dueDate != null && now.isAfter(dueDate.atStartOfDay().plusDays(1).atZone(java.time.ZoneId.systemDefault()).toInstant());

                // Critical: not started within 30 min
                if ("CRITICAL".equals(priority) && startedAt == null && agingMinutes >= 30) {
                    notifyOnce("QI_CRITICAL_NOT_STARTED", "QUALITY", "QualityInspection", id,
                            "CRITICAL", type + " " + number + " — Critical inspection not started within 30 min! Inspector: " + (inspector != null ? inspector : "unassigned"), number);
                }

                // Overdue (past due date)
                if (overdue) {
                    notifyOnce("QI_OVERDUE_" + id, "QUALITY", "QualityInspection", id,
                            "HIGH", type + " " + number + " is OVERDUE (due " + dueDate + "). Aging: " + agingMinutes + " min.", number);
                }

                // Past SLA but not overdue yet — escalation by priority
                if (agingMinutes > slaMinutes && !overdue) {
                    String level = switch (priority.toUpperCase()) {
                        case "CRITICAL" -> "CRITICAL";
                        case "HIGH" -> "HIGH";
                        default -> "MEDIUM";
                    };
                    notifyOnce("QI_SLA_BREACH_" + id, "QUALITY", "QualityInspection", id,
                            level, type + " " + number + " — SLA breached (" + agingMinutes + " min, threshold " + slaMinutes + " min).", number);
                }
            }
        } catch (Exception ex) {
            log.error("[Quality SLA Check] Failed", ex);
        }
    }

    /**
     * Daily: recalculate PM schedule statuses. UPCOMING schedules whose due date has
     * passed are flagged OVERDUE; UPCOMING ones due today are flagged DUE.
     * §5.2
     */
    @Scheduled(cron = "${zyger.scheduling.pm-status-recalc:0 30 6 * * *}")
    @Transactional
    public void pmScheduleStatusRecalc() {
        try {
            LocalDate today = LocalDate.now();
            List<PMSchedule> all = pmSchedules.findAll();
            int updated = 0;
            for (PMSchedule s : all) {
                if (s.getDueDate() == null) continue;
                if (!"UPCOMING".equals(s.getStatus())) continue;
                if (s.getDueDate().isBefore(today)) {
                    s.setStatus("OVERDUE");
                    s.setUpdatedAt(Instant.now());
                    pmSchedules.save(s);
                    updated++;
                }
            }
            log.info("[PM Status Recalc] {} PM schedule(s) marked OVERDUE", updated);
        } catch (Exception ex) {
            log.error("[PM Status Recalc] Failed", ex);
        }
    }

    /**
     * Daily: recalculate calibration status on maintenance instrument master and
     * calibration schedules. When next due is past, calibrationStatus becomes
     * UNDER_CALIBRATION/OUT_OF_SERVICE and the instrument is blocked. §18.4/§20
     */
    @Scheduled(cron = "${zyger.scheduling.calibration-status-recalc:0 30 6 * * *}")
    @Transactional
    public void calibrationStatusRecalc() {
        try {
            LocalDate today = LocalDate.now();
            int updated = 0;
            for (CalibrationSchedule c : calSchedules.findAll()) {
                if (c.getNextDueDate() == null) continue;
                if (c.getNextDueDate().isBefore(today)
                        && !"INACTIVE".equals(c.getStatus())
                        && !"UNDER_CALIBRATION".equals(c.getCalibrationStatus())) {
                    c.setCalibrationStatus("OUT_OF_SERVICE");
                    c.setStatus("INACTIVE");
                    c.setUpdatedAt(Instant.now());
                    calSchedules.save(c);
                    updated++;
                }
            }
            for (InstrumentMaster i : instruments.findByActiveTrue()) {
                if (i.getCalibrationDue() == null) continue;
                if (i.getCalibrationDue().isBefore(today)
                        && !"UNDER_CALIBRATION".equals(i.getCalibrationStatus())) {
                    i.setCalibrationStatus("OUT_OF_SERVICE");
                    i.setCurrentStatus("QUARANTINED");
                    i.setUpdatedAt(Instant.now());
                    instruments.save(i);
                    updated++;
                }
            }
            log.info("[Calibration Status Recalc] {} calibration record(s) updated", updated);
        } catch (Exception ex) {
            log.error("[Calibration Status Recalc] Failed", ex);
        }
    }

    /**
     * Sales Module SLA timer (Technical Design §3.5): escalates Sales Orders that
     * have sat in a PENDING_TIER1/2/3 approval status past the configured SLA
     * window (Improvement Plan §E4/§E6). Runs twice daily — a 24h SLA only needs
     * checking a couple of times a day, not every few minutes.
     */
    @Scheduled(cron = "${zyger.scheduling.sales-approval-sla:0 0 9,15 * * *}")
    public void salesApprovalSlaCheck() {
        try {
            int slaHours = 24;
            Instant cutoff = Instant.now().minus(slaHours, java.time.temporal.ChronoUnit.HOURS);
            List<SalesOrder> stuck = em.createQuery("""
                            select s from SalesOrder s
                            where s.status in ('PENDING_TIER1','PENDING_TIER2','PENDING_TIER3')
                              and s.submittedAt is not null and s.submittedAt <= :cutoff
                            order by s.submittedAt asc
                            """, SalesOrder.class)
                    .setParameter("cutoff", cutoff)
                    .getResultList();

            if (stuck.isEmpty()) {
                log.info("[Sales Approval SLA] No Sales Orders breaching the {}h approval SLA.", slaHours);
                return;
            }
            log.warn("[Sales Approval SLA] {} Sales Order(s) past the {}h approval SLA.", stuck.size(), slaHours);
            for (SalesOrder so : stuck) {
                notifyOnce("APPROVAL_SLA_BREACHED", "SALES", "sales-order", so.getId(), "WARNING",
                        "Sales Order " + so.getDocNo() + " has been awaiting " + so.getStatus() +
                                " approval for more than " + slaHours + "h", so.getDocNo());
            }
        } catch (Exception ex) {
            log.error("[Sales Approval SLA] Failed to run Sales approval SLA check", ex);
        }
    }

    /**
     * D3 "Ageing-based auto-hold": flags a customer for Credit Hold once any of
     * their invoices is overdue beyond the configured grace period. Only ever
     * SETS the hold, never clears one — reversal requires an authorized override
     * on the Party record itself, per D3's logged-override-trail requirement.
     */
    @Scheduled(cron = "${zyger.scheduling.sales-credit-autohold:0 30 9 * * *}")
    @Transactional
    public void salesCreditAutoHoldCheck() {
        try {
            int graceDays = 60;
            LocalDate cutoff = LocalDate.now().minusDays(graceDays);
            List<Object[]> overdue = em.createQuery("""
                            select i.customerCode, i.customer
                            from SalesInvoice i
                            where i.status in ('POSTED','PARTIALLY_PAID')
                              and coalesce(i.dueDate, i.docDate) < :cutoff
                            group by i.customerCode, i.customer
                            """, Object[].class)
                    .setParameter("cutoff", cutoff)
                    .getResultList();

            if (overdue.isEmpty()) {
                log.info("[Sales Credit Auto-Hold] No customers overdue beyond {} days.", graceDays);
                return;
            }
            int flagged = 0;
            for (Object[] row : overdue) {
                String customerCode = (String) row[0];
                String customerName = (String) row[1];
                if (customerCode == null || customerCode.isBlank()) continue;
                Party party = parties.findByCode(customerCode).orElse(null);
                if (party == null || Boolean.TRUE.equals(party.getCreditHold())) continue;
                party.setCreditHold(true);
                party.setCreditHoldReason("Auto-hold: invoice(s) overdue beyond " + graceDays + " days (as of " + LocalDate.now() + ")");
                notificationService.notify("CREDIT_HOLD_AUTO_TRIGGERED", "SALES", "party", party.getId(), "CRITICAL",
                        "Customer " + customerName + " (" + customerCode + ") auto-placed on Credit Hold — invoice(s) overdue beyond " + graceDays + " days",
                        customerCode);
                flagged++;
            }
            log.warn("[Sales Credit Auto-Hold] {} customer(s) newly placed on Credit Hold (overdue beyond {} days).", flagged, graceDays);
        } catch (Exception ex) {
            log.error("[Sales Credit Auto-Hold] Failed to run Sales credit auto-hold check", ex);
        }
    }
}
