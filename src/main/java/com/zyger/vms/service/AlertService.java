package com.zyger.vms.service;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import com.zyger.vms.domain.VehicleEntry;
import com.zyger.vms.domain.Visit;
import com.zyger.vms.domain.VisitStatus;
import com.zyger.vms.dto.AlertItem;
import com.zyger.vms.repository.VehicleEntryRepository;
import com.zyger.vms.repository.VisitRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Visitors and vehicles still inside the premises.
 * A first alert is raised after 6 hours, and the alert is escalated to 24 hours
 * if the person or vehicle has still not checked out.
 */
@Service
public class AlertService {

    public static final long FIRST_ALERT_HOURS = 6;
    public static final long ESCALATION_HOURS = 24;

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    private final VisitRepository visits;
    private final VehicleEntryRepository vehicles;
    private final Clock clock;

    public AlertService(VisitRepository visits, VehicleEntryRepository vehicles, Clock clock) {
        this.visits = visits;
        this.vehicles = vehicles;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<AlertItem> active() {
        LocalDateTime now = LocalDateTime.now(clock);
        LocalDateTime cutoff = now.minusHours(FIRST_ALERT_HOURS);
        List<AlertItem> alerts = new ArrayList<>();

        for (Visit v : visits.findByStatusAndCheckInAtBefore(VisitStatus.CHECKED_IN, cutoff)) {
            long minutes = minutesBetween(v.getCheckInAt(), now);
            String level = levelFor(minutes);
            String name = v.getVisitor().getFullName();
            String company = v.getVisitor().getCompany() == null ? "" : v.getVisitor().getCompany();
            alerts.add(new AlertItem(
                    "VISITOR:" + v.getVisitCode() + ":" + level,
                    "VISITOR",
                    level,
                    v.getVisitCode(),
                    v.getPassId(),
                    name,
                    company,
                    v.getCheckInAt().format(HH_MM),
                    minutes,
                    message("Visitor " + name + " (" + v.getPassId() + ")", minutes, level)));
        }

        for (VehicleEntry e : vehicles.findByExitAtIsNullAndEntryAtBefore(cutoff)) {
            long minutes = minutesBetween(e.getEntryAt(), now);
            String level = levelFor(minutes);
            alerts.add(new AlertItem(
                    "VEHICLE:" + e.getEntryCode() + ":" + level,
                    "VEHICLE",
                    level,
                    e.getEntryCode(),
                    e.getVehicleNumber(),
                    e.getVehicleNumber(),
                    e.getDriverName(),
                    e.getEntryAt().format(HH_MM),
                    minutes,
                    message("Vehicle " + e.getVehicleNumber() + " (driver " + e.getDriverName() + ")", minutes, level)));
        }

        alerts.sort(Comparator.comparingLong(AlertItem::minutesInside).reversed());
        return alerts;
    }

    /** "24H" once the escalation limit is reached, otherwise "6H". */
    static String levelFor(long minutes) {
        return minutes >= ESCALATION_HOURS * 60 ? "24H" : "6H";
    }

    static long minutesBetween(LocalDateTime from, LocalDateTime to) {
        return Math.max(0, Duration.between(from, to).toMinutes());
    }

    static String elapsed(long minutes) {
        return (minutes / 60) + "h " + String.format("%02d", minutes % 60) + "m";
    }

    private static String message(String subject, long minutes, String level) {
        String prefix = "24H".equals(level) ? "24-HOUR ALERT: " : "6-HOUR ALERT: ";
        return prefix + subject + " has been inside for " + elapsed(minutes) + " with no check-out.";
    }
}
