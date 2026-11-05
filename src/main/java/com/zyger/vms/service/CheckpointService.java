package com.zyger.vms.service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import com.zyger.vms.domain.VehicleEntry;
import com.zyger.vms.domain.Visit;
import com.zyger.vms.dto.CheckpointLogEntry;
import com.zyger.vms.repository.VehicleEntryRepository;
import com.zyger.vms.repository.VisitRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Today's check-in and check-out history for visitors and vehicles, with times. */
@Service
public class CheckpointService {

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    private final VisitRepository visits;
    private final VehicleEntryRepository vehicles;
    private final Clock clock;

    public CheckpointService(VisitRepository visits, VehicleEntryRepository vehicles, Clock clock) {
        this.visits = visits;
        this.vehicles = vehicles;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<CheckpointLogEntry> log(LocalDate date) {
        LocalDate day = date == null ? LocalDate.now(clock) : date;
        LocalDateTime start = day.atStartOfDay();
        LocalDateTime end = day.plusDays(1).atStartOfDay();
        LocalDateTime now = LocalDateTime.now(clock);
        long overdueMinutes = AlertService.FIRST_ALERT_HOURS * 60;
        List<CheckpointLogEntry> rows = new ArrayList<>();

        for (Visit v : visits.findByCheckInAtGreaterThanEqualAndCheckInAtLessThanOrderByCheckInAtDesc(start, end)) {
            boolean out = v.getCheckOutAt() != null;
            long minutes = AlertService.minutesBetween(v.getCheckInAt(), out ? v.getCheckOutAt() : now);
            String company = v.getVisitor().getCompany() == null ? "" : v.getVisitor().getCompany();
            rows.add(new CheckpointLogEntry(
                    "VISITOR",
                    v.getPassId(),
                    v.getVisitor().getFullName(),
                    company,
                    v.getHostName() == null ? "" : v.getHostName(),
                    v.getCheckInAt().format(HH_MM),
                    out ? v.getCheckOutAt().format(HH_MM) : null,
                    out ? "Checked Out" : "Checked In",
                    minutes,
                    !out && minutes >= overdueMinutes));
        }

        for (VehicleEntry e : vehicles.findByEntryAtGreaterThanEqualAndEntryAtLessThanOrderByEntryAtDesc(start, end)) {
            boolean out = e.getExitAt() != null;
            long minutes = AlertService.minutesBetween(e.getEntryAt(), out ? e.getExitAt() : now);
            rows.add(new CheckpointLogEntry(
                    "VEHICLE",
                    e.getEntryCode(),
                    e.getVehicleNumber(),
                    e.getDriverName(),
                    e.getGate().getName(),
                    e.getEntryAt().format(HH_MM),
                    out ? e.getExitAt().format(HH_MM) : null,
                    out ? "Exited" : "Inside",
                    minutes,
                    !out && minutes >= overdueMinutes));
        }

        rows.sort(Comparator.comparing(CheckpointLogEntry::inTime).reversed());
        return rows;
    }
}
