package com.zyger.vms.web;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;

import com.zyger.vms.dto.VehicleLogResponse;
import com.zyger.vms.service.ReportService;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/reports")
public class ReportController {

    private final ReportService service;

    public ReportController(ReportService service) {
        this.service = service;
    }

    @GetMapping("/visitors.csv")
    public ResponseEntity<byte[]> visitorsCsv(
            @RequestParam(name = "name", required = false) String name,
            @RequestParam(name = "department", required = false) String department,
            @RequestParam(name = "status", required = false) String status,
            @RequestParam(name = "from", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(name = "to", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        byte[] body = service.visitorsCsv(name, department, status, from, to).getBytes(StandardCharsets.UTF_8);
        ContentDisposition disposition = ContentDisposition.attachment().filename(service.visitorsFileName(from, to)).build();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .contentType(MediaType.parseMediaType("text/csv"))
                .body(body);
    }

    @GetMapping("/vehicles")
    public List<VehicleLogResponse> vehicleLogs(
            @RequestParam(name = "from", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(name = "to", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(name = "q", required = false) String q,
            @RequestParam(name = "gate", required = false) String gate,
            @RequestParam(name = "status", required = false) String status) {
        return service.vehicleLogs(from, to, q, gate, status);
    }

    @GetMapping("/vehicles.csv")
    public ResponseEntity<byte[]> vehiclesCsv(
            @RequestParam(name = "from", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(name = "to", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(name = "q", required = false) String q,
            @RequestParam(name = "gate", required = false) String gate,
            @RequestParam(name = "status", required = false) String status) {
        byte[] body = service.vehiclesCsv(from, to, q, gate, status).getBytes(StandardCharsets.UTF_8);
        ContentDisposition disposition = ContentDisposition.attachment().filename(service.vehicleFileName(from, to)).build();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .contentType(MediaType.parseMediaType("text/csv"))
                .body(body);
    }
}
