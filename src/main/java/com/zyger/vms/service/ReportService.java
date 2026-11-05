package com.zyger.vms.service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;

import com.zyger.vms.dto.VehicleLogResponse;
import com.zyger.vms.dto.VisitorResponse;
import com.zyger.vms.repository.VehicleEntryRepository;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ReportService {

    private final VisitService visitService;
    private final VehicleEntryRepository vehicleEntries;
    private final Clock clock;

    public ReportService(VisitService visitService, VehicleEntryRepository vehicleEntries, Clock clock) {
        this.visitService = visitService;
        this.vehicleEntries = vehicleEntries;
        this.clock = clock;
    }

    // ---------- vehicle logs ----------

    /** Vehicle movements between two dates (inclusive), optionally filtered by text, gate and status. */
    @Transactional(readOnly = true)
    public List<VehicleLogResponse> vehicleLogs(LocalDate from, LocalDate to, String q, String gate, String status) {
        LocalDate today = LocalDate.now(clock);
        LocalDate start = from != null ? from : (to != null ? to : today);
        LocalDate end = to != null ? to : (from != null ? from : today);
        if (end.isBefore(start)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "'To' date cannot be before 'From' date");
        }
        String term = q == null ? "" : q.trim().toLowerCase(Locale.ROOT);
        String gateName = gate == null ? "" : gate.trim();
        String state = status == null ? "" : status.trim();

        return vehicleEntries.findByEntryAtGreaterThanEqualAndEntryAtLessThanOrderByEntryAtDesc(
                        start.atStartOfDay(), end.plusDays(1).atStartOfDay())
                .stream()
                .map(VehicleLogResponse::from)
                .filter(v -> gateName.isEmpty() || v.gate().equalsIgnoreCase(gateName))
                .filter(v -> state.isEmpty() || v.status().equalsIgnoreCase(state))
                .filter(v -> term.isEmpty()
                        || contains(v.vehicleNumber(), term)
                        || contains(v.driverName(), term)
                        || contains(v.vendor(), term)
                        || contains(v.material(), term)
                        || contains(v.id(), term))
                .toList();
    }

    public String vehiclesCsv(LocalDate from, LocalDate to, String q, String gate, String status) {
        StringBuilder sb = new StringBuilder();
        sb.append("Entry ID,Vehicle No,Driver,Vendor,Material,Load (kg),Purpose,Gate,Entry Date,Entry Time,Exit Date,Exit Time,Duration,Status\n");
        for (VehicleLogResponse v : vehicleLogs(from, to, q, gate, status)) {
            sb.append(cell(v.id())).append(',')
              .append(cell(v.vehicleNumber())).append(',')
              .append(cell(v.driverName())).append(',')
              .append(cell(v.vendor())).append(',')
              .append(cell(v.material())).append(',')
              .append(cell(v.loadWeight())).append(',')
              .append(cell(v.purpose())).append(',')
              .append(cell(v.gate())).append(',')
              .append(cell(v.entryDate())).append(',')
              .append(cell(v.entryTime())).append(',')
              .append(cell(v.exitDate())).append(',')
              .append(cell(v.exitTime())).append(',')
              .append(cell(v.duration())).append(',')
              .append(cell(v.status())).append('\n');
        }
        return sb.toString();
    }

    public String vehicleFileName(LocalDate from, LocalDate to) {
        return "vehicle-log-" + rangeLabel(from, to) + ".csv";
    }

    private static boolean contains(String value, String term) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(term);
    }

    // ---------- visitors ----------

    public String visitorsCsv(String name, String department, String status, LocalDate from, LocalDate to) {
        List<VisitorResponse> rows = visitService.list(name, department, status, from, to);
        StringBuilder sb = new StringBuilder();
        sb.append("Pass ID,Visitor,Company,Host,Department,Gate,Visit Date,Visit Time,Check-In,Check-Out,Status\n");
        for (VisitorResponse v : rows) {
            sb.append(cell(v.passId())).append(',')
              .append(cell(v.name())).append(',')
              .append(cell(v.company())).append(',')
              .append(cell(v.host())).append(',')
              .append(cell(v.department())).append(',')
              .append(cell(v.gate())).append(',')
              .append(cell(v.visitDate())).append(',')
              .append(cell(v.visitTime())).append(',')
              .append(cell(v.checkInTime())).append(',')
              .append(cell(v.checkOutTime())).append(',')
              .append(cell(v.status())).append('\n');
        }
        return sb.toString();
    }

    public String visitorsFileName(LocalDate from, LocalDate to) {
        return "visitor-report-" + rangeLabel(from, to) + ".csv";
    }

    /** "20261105" for one day, "20261029-20261105" for a range. */
    private String rangeLabel(LocalDate from, LocalDate to) {
        LocalDate start = from != null ? from : (to != null ? to : LocalDate.now(clock));
        LocalDate end = to != null ? to : (from != null ? from : LocalDate.now(clock));
        String a = start.format(DateTimeFormatter.BASIC_ISO_DATE);
        return start.equals(end) ? a : a + "-" + end.format(DateTimeFormatter.BASIC_ISO_DATE);
    }

    private static String cell(String value) {
        if (value == null) {
            return "";
        }
        String v = value;
        // neutralise spreadsheet formula injection
        if (!v.isEmpty() && "=+-@".indexOf(v.charAt(0)) >= 0) {
            v = "'" + v;
        }
        if (v.contains(",") || v.contains("\"") || v.contains("\n") || v.contains("\r")) {
            v = "\"" + v.replace("\"", "\"\"") + "\"";
        }
        return v;
    }
}
