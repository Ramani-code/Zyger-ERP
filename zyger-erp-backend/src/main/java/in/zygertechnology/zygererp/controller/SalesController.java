package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.dto.ActionRequest;
import in.zygertechnology.zygererp.dto.PaginatedResponse;
import in.zygertechnology.zygererp.dto.sales.CreateSalesOrderRequest;
import in.zygertechnology.zygererp.service.DocumentFacade;
import in.zygertechnology.zygererp.service.ExportService;
import in.zygertechnology.zygererp.service.PrintService;
import in.zygertechnology.zygererp.service.SalesService;
import in.zygertechnology.zygererp.security.RequirePermission;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.*;

@RestController
@RequestMapping("/api/v1/sales")
@RequirePermission(module = "SALES", screen = "*", action = "VIEW")
@RequiredArgsConstructor
@Tag(name = "Sales", description = "Sales Order, Proforma Invoice, DC, Invoice, Returns")
public class SalesController {

    private static final Set<String> ALLOWED = Set.of(
            "sales-order", "proforma-invoice", "sales-dc",
            "sales-invoice", "dc-return", "invoice-return",
            "payment-receipt", "credit-debit-note",
            "enquiry", "quotation"
    );

    private final DocumentFacade svc;
    private final SalesService sales;
    private final ExportService export;
    private final PrintService printer;

    private static String key(String type) {
        if (!ALLOWED.contains(type)) {
            throw new IllegalArgumentException("Unknown sales document type: " + type);
        }
        return type;
    }

    private static String principalName(Principal p) { return p != null ? p.getName() : "system"; }

    @Operation(summary = "List sales documents with pagination and filters")
    @GetMapping("/{type}")
    Map<String, Object> list(
            @Parameter(description = "Document type") @PathVariable String type,
            @RequestParam Map<String, String> q) {
        return svc.list(key(type), q);
    }

    @Operation(summary = "Create a new sales document")
    @PostMapping("/{type}")
    Map<String, Object> create(
            @Parameter(description = "Document type") @PathVariable String type,
            @RequestBody Map<String, Object> b,
            Principal p) {
        return svc.toRow(sales.create(key(type), b, principalName(p)));
    }

    @Operation(summary = "Get a sales document by ID")
    @GetMapping("/{type}/{id}")
    Map<String, Object> get(
            @Parameter(description = "Document type") @PathVariable String type,
            @Parameter(description = "Document ID") @PathVariable Long id) {
        return svc.getRow(key(type), id);
    }

    @Operation(summary = "Update a sales document (DRAFT/REJECTED only)")
    @PutMapping("/{type}/{id}")
    Map<String, Object> update(
            @Parameter(description = "Document type") @PathVariable String type,
            @Parameter(description = "Document ID") @PathVariable Long id,
            @RequestBody Map<String, Object> b,
            Principal p) {
        return svc.toRow(sales.update(key(type), id, b, principalName(p)));
    }

    @Operation(summary = "Delete a sales document (DRAFT/REJECTED only)")
    @DeleteMapping("/{type}/{id}")
    void del(
            @Parameter(description = "Document type") @PathVariable String type,
            @Parameter(description = "Document ID") @PathVariable Long id,
            Principal p) {
        svc.remove(key(type), id, principalName(p));
    }

    @Operation(summary = "Get next document number preview")
    @GetMapping("/{type}/next-number")
    Map<String, Object> next(
            @Parameter(description = "Document type") @PathVariable String type) {
        return Map.of("nextNumber", svc.peekNumber(key(type)));
    }

    @Operation(summary = "Perform workflow action (submit, approve, reject, post, etc.)")
    @PostMapping("/{type}/{id}/actions/{action}")
    Map<String, Object> act(
            @Parameter(description = "Document type") @PathVariable String type,
            @Parameter(description = "Document ID") @PathVariable Long id,
            @Parameter(description = "Action name") @PathVariable String action,
            @RequestBody(required = false) ActionRequest body,
            Principal p) {
        Map<String, Object> opts = body == null ? Map.of() : new LinkedHashMap<>();
        if (body != null) {
            if (body.getNote() != null) opts.put("note", body.getNote());
            if (body.getOptions() != null) opts.putAll(body.getOptions());
        }
        String note = String.valueOf(opts.getOrDefault("note", ""));
        return svc.toRow(sales.action(key(type), id, action, note, principalName(p), opts));
    }

    @Operation(summary = "Preview the impact of amending a Sales Order (BR-NEW-009) before committing it")
    @GetMapping("/sales-order/{id}/amend-impact")
    Map<String, Object> amendImpact(@Parameter(description = "Sales Order ID") @PathVariable Long id) {
        return sales.amendImpact(id);
    }

    @Operation(summary = "Generate an E-Invoice IRN for a Sales Invoice via the configured GSP/IRP provider")
    @PostMapping("/sales-invoice/{id}/e-invoice/generate")
    Map<String, Object> generateEInvoice(@Parameter(description = "Sales Invoice ID") @PathVariable Long id, Principal p) {
        return svc.toRow(sales.generateEInvoice(id, principalName(p)));
    }

    @Operation(summary = "Generate an E-Way Bill for a Sales DC via the configured E-Way Bill provider")
    @PostMapping("/sales-dc/{id}/eway-bill/generate")
    Map<String, Object> generateEWayBill(@Parameter(description = "Sales DC ID") @PathVariable Long id, Principal p) {
        return svc.toRow(sales.generateEWayBill(id, principalName(p)));
    }

    @Operation(summary = "Update the E-Way Bill Part-B (en-route vehicle change) for a Sales DC")
    @PostMapping("/sales-dc/{id}/eway-bill/update-part-b")
    Map<String, Object> updateEWayBillPartB(
            @Parameter(description = "Sales DC ID") @PathVariable Long id,
            @RequestBody Map<String, String> body,
            Principal p) {
        return svc.toRow(sales.updateEWayBillPartB(id, body.get("vehicleNo"), principalName(p)));
    }

    @Operation(summary = "Export sales documents to Excel or PDF")
    @GetMapping("/{type}/export")
    ResponseEntity<byte[]> export(
            @Parameter(description = "Document type") @PathVariable String type,
            @RequestParam Map<String, String> q) {
        Map<String, Object> page = svc.list(key(type), q);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) page.getOrDefault("content", List.of());
        String format = q.getOrDefault("format", "xlsx");
        byte[] bytes = export.build(rows, format, key(type));
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=" + key(type) + "." + format)
                .contentType(format.equals("pdf") ? MediaType.APPLICATION_PDF
                        : MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(bytes);
    }

    @Operation(summary = "Print a sales document as PDF")
    @GetMapping("/{type}/{id}/print")
    ResponseEntity<byte[]> print(
            @Parameter(description = "Document type") @PathVariable String type,
            @Parameter(description = "Document ID") @PathVariable Long id,
            @RequestParam(defaultValue = "false") boolean download) {
        Map<String, Object> row = svc.getRow(key(type), id);
        String docNo = String.valueOf(row.getOrDefault("docNo", type)).replaceAll("[^A-Za-z0-9_-]", "_");
        String disposition = download ? "attachment" : "inline";
        byte[] pdf = "sales-invoice".equals(type) ? printer.salesInvoice(row)
                : "proforma-invoice".equals(type) ? printer.proformaInvoice(row)
                : "sales-dc".equals(type) ? printer.deliveryChallan(row, type)
                : printer.salesDoc(row, type);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        disposition + "; filename=\"" + docNo + ".pdf\"")
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdf);
    }

    @Operation(summary = "Get sales dashboard statistics")
    @GetMapping("/dashboard")
    Map<String, Object> dashboard() {
        return sales.dashboard();
    }

    @Operation(summary = "Invoice ageing report (0-30/31-45/46-60/60+ buckets)")
    @GetMapping("/reports/ageing")
    Map<String, Object> ageingReport() {
        return sales.ageingReport();
    }

    @Operation(summary = "Quotation win/loss ratio and average margin won")
    @GetMapping("/reports/win-loss")
    Map<String, Object> winLossReport() {
        return sales.winLossReport();
    }

    @Operation(summary = "On-time-delivery performance report")
    @GetMapping("/reports/otd")
    Map<String, Object> otdReport() {
        return sales.otdReport();
    }

    @Operation(summary = "GSTR-1 outward-supply-ready extract for a period")
    @GetMapping("/reports/gstr1-extract")
    Map<String, Object> gstr1Extract(@RequestParam String period) {
        return sales.gstr1Extract(period);
    }
}
