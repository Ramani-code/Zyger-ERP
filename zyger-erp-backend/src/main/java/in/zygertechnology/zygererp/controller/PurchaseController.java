package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.dto.ActionRequest;
import in.zygertechnology.zygererp.service.DocumentFacade;
import in.zygertechnology.zygererp.service.ExportService;
import in.zygertechnology.zygererp.service.JobOrderReconciliationService;
import in.zygertechnology.zygererp.service.PrintService;
import in.zygertechnology.zygererp.service.PurchaseService;
import in.zygertechnology.zygererp.security.RequirePermission;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.*;

/**
 * Purchase Module REST API.
 *
 * Generic CRUD + workflow for all purchase document types:
 * purchase-request, supplier-enquiry, supplier-quotation, purchase-order,
 * job-order, purchase-target, purchase-price-list, job-work-price-list.
 *
 * Mounted at /api/v1/purchase/{type}.
 */
@RestController
@RequestMapping("/api/v1/purchase")
@RequirePermission(module = "PURCHASE", screen = "*", action = "VIEW")
@RequiredArgsConstructor
@Tag(name = "Purchase", description = "Purchase Requests, Enquiries, Quotations, POs, Job Orders")
public class PurchaseController {

    private static final Set<String> ALLOWED = Set.of(
            "purchase-request", "supplier-enquiry", "supplier-quotation",
            "purchase-order", "job-order", "purchase-target",
            "purchase-price-list", "job-work-price-list",
            "purchase-return"
    );

    private final DocumentFacade svc;
    private final PurchaseService purchase;
    private final ExportService export;
    private final PrintService printer;
    private final JobOrderReconciliationService joReconciliation;
    private final in.zygertechnology.zygererp.repo.PoAmendmentHistoryRepository poAmendments;
    private final in.zygertechnology.zygererp.repo.PurchaseOrderScheduleRepository poSchedules;
    private final in.zygertechnology.zygererp.repo.JobOrderScheduleRepository joSchedules;

    private static String key(String type) {
        if (!ALLOWED.contains(type)) {
            throw new IllegalArgumentException("Unknown purchase document type: " + type);
        }
        return type;
    }

    private static String principalName(Principal p) { return p != null ? p.getName() : "system"; }

    @Operation(summary = "List purchase documents with pagination and filters")
    @GetMapping("/{type}")
    Map<String, Object> list(
            @Parameter(description = "Document type") @PathVariable String type,
            @RequestParam Map<String, String> q) {
        return svc.list(key(type), q);
    }

    @Operation(summary = "Create a new purchase document")
    @PostMapping("/{type}")
    Map<String, Object> create(
            @Parameter(description = "Document type") @PathVariable String type,
            @RequestBody Map<String, Object> b,
            Principal p) {
        return svc.toRow(purchase.create(key(type), b, principalName(p)));
    }

    @Operation(summary = "Get a purchase document by ID")
    @GetMapping("/{type}/{id}")
    Map<String, Object> get(
            @Parameter(description = "Document type") @PathVariable String type,
            @Parameter(description = "Document ID") @PathVariable Long id) {
        return svc.getRow(key(type), id);
    }

    @Operation(summary = "Get job order reconciliation details")
    @GetMapping("/job-orders/{id}/reconciliation")
    Map<String, Object> jobOrderReconciliation(
            @Parameter(description = "Job Order ID") @PathVariable Long id) {
        return joReconciliation.reconciliation(id);
    }

    @Operation(summary = "Get a Purchase Order's amendment/revision history")
    @GetMapping("/purchase-order/{id}/amendments")
    List<in.zygertechnology.zygererp.entity.PoAmendmentHistory> poAmendmentHistory(@PathVariable Long id) {
        return poAmendments.findByPoIdOrderByRevisionNumberDesc(id);
    }

    // Purchase Module audit: PoSchedulePage/JoSchedulePage previously only held created
    // schedules in local React state — nothing was ever persisted, so they vanished on
    // refresh. These endpoints are the missing backend half.

    @Operation(summary = "List a Purchase Order's delivery schedule rows")
    @GetMapping("/purchase-order/{id}/schedules")
    List<in.zygertechnology.zygererp.entity.PurchaseOrderSchedule> listPoSchedules(@PathVariable Long id) {
        return poSchedules.findByDocId(id);
    }

    @Operation(summary = "Add a delivery schedule row to a Purchase Order")
    @PostMapping("/purchase-order/{id}/schedules")
    in.zygertechnology.zygererp.entity.PurchaseOrderSchedule createPoSchedule(
            @PathVariable Long id, @RequestBody in.zygertechnology.zygererp.entity.PurchaseOrderSchedule body) {
        var po = (in.zygertechnology.zygererp.entity.PurchaseOrder) svc.get("purchase-order", id);
        body.setId(null);
        body.setDoc(po);
        if (body.getSupplier() == null || body.getSupplier().isBlank()) body.setSupplier(po.getSupplier());
        if (body.getPendingQty() == null) body.setPendingQty(body.getScheduledQty());
        if (body.getReceivedQty() == null) body.setReceivedQty(java.math.BigDecimal.ZERO);
        if (body.getStatus() == null || body.getStatus().isBlank()) body.setStatus("PLANNED");
        return poSchedules.save(body);
    }

    @Operation(summary = "Update a Purchase Order delivery schedule row")
    @PutMapping("/purchase-order/{id}/schedules/{scheduleId}")
    in.zygertechnology.zygererp.entity.PurchaseOrderSchedule updatePoSchedule(
            @PathVariable Long id, @PathVariable Long scheduleId,
            @RequestBody in.zygertechnology.zygererp.entity.PurchaseOrderSchedule body) {
        var existing = poSchedules.findById(scheduleId)
                .orElseThrow(() -> new IllegalArgumentException("Schedule row not found: " + scheduleId));
        body.setId(scheduleId);
        body.setDoc(existing.getDoc());
        return poSchedules.save(body);
    }

    @Operation(summary = "Delete a Purchase Order delivery schedule row")
    @DeleteMapping("/purchase-order/{id}/schedules/{scheduleId}")
    void deletePoSchedule(@PathVariable Long id, @PathVariable Long scheduleId) {
        poSchedules.deleteById(scheduleId);
    }

    @Operation(summary = "List a Job Order's delivery schedule rows")
    @GetMapping("/job-order/{id}/schedules")
    List<in.zygertechnology.zygererp.entity.JobOrderSchedule> listJoSchedules(@PathVariable Long id) {
        return joSchedules.findByDocId(id);
    }

    @Operation(summary = "Add a delivery schedule row to a Job Order")
    @PostMapping("/job-order/{id}/schedules")
    in.zygertechnology.zygererp.entity.JobOrderSchedule createJoSchedule(
            @PathVariable Long id, @RequestBody in.zygertechnology.zygererp.entity.JobOrderSchedule body) {
        var jo = (in.zygertechnology.zygererp.entity.JobOrder) svc.get("job-order", id);
        body.setId(null);
        body.setDoc(jo);
        if (body.getPendingQty() == null) body.setPendingQty(body.getScheduledQty());
        if (body.getReceivedQty() == null) body.setReceivedQty(java.math.BigDecimal.ZERO);
        if (body.getStatus() == null || body.getStatus().isBlank()) body.setStatus("PLANNED");
        return joSchedules.save(body);
    }

    @Operation(summary = "Update a Job Order delivery schedule row")
    @PutMapping("/job-order/{id}/schedules/{scheduleId}")
    in.zygertechnology.zygererp.entity.JobOrderSchedule updateJoSchedule(
            @PathVariable Long id, @PathVariable Long scheduleId,
            @RequestBody in.zygertechnology.zygererp.entity.JobOrderSchedule body) {
        var existing = joSchedules.findById(scheduleId)
                .orElseThrow(() -> new IllegalArgumentException("Schedule row not found: " + scheduleId));
        body.setId(scheduleId);
        body.setDoc(existing.getDoc());
        return joSchedules.save(body);
    }

    @Operation(summary = "Delete a Job Order delivery schedule row")
    @DeleteMapping("/job-order/{id}/schedules/{scheduleId}")
    void deleteJoSchedule(@PathVariable Long id, @PathVariable Long scheduleId) {
        joSchedules.deleteById(scheduleId);
    }

    @Operation(summary = "Update a purchase document (DRAFT/REJECTED only)")
    @PutMapping("/{type}/{id}")
    Map<String, Object> update(
            @Parameter(description = "Document type") @PathVariable String type,
            @Parameter(description = "Document ID") @PathVariable Long id,
            @RequestBody Map<String, Object> b,
            Principal p) {
        return svc.toRow(svc.update(key(type), id, b, principalName(p)));
    }

    @Operation(summary = "Delete a purchase document (DRAFT/REJECTED only)")
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
        String note = body == null ? "" : (body.getNote() != null ? body.getNote() : "");
        return svc.toRow(purchase.action(key(type), id, action, note, principalName(p)));
    }

    @Operation(summary = "Export purchase documents to Excel or PDF")
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

    @Operation(summary = "Print a purchase document as PDF")
    @GetMapping("/{type}/{id}/print")
    ResponseEntity<byte[]> print(
            @Parameter(description = "Document type") @PathVariable String type,
            @Parameter(description = "Document ID") @PathVariable Long id,
            @RequestParam(defaultValue = "false") boolean download) {
        Map<String, Object> row = svc.getRow(key(type), id);
        String docNo = String.valueOf(row.getOrDefault("docNo", type)).replaceAll("[^A-Za-z0-9_-]", "_");
        String disposition = download ? "attachment" : "inline";
        String supplierName = String.valueOf(row.getOrDefault("supplier", "")).replaceAll("[^A-Za-z0-9_-]+", "_");
        String filename = "purchase-order".equals(key(type)) && !supplierName.isBlank()
                ? "PO_" + docNo + "_" + supplierName + ".pdf"
                : docNo + ".pdf";
        byte[] pdf = "purchase-order".equals(key(type)) ? printer.purchaseOrder(row) : printer.salesDoc(row, type);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        disposition + "; filename=\"" + filename + "\"")
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdf);
    }

    // ---- Dashboard ----

    @Operation(summary = "Get purchase dashboard statistics")
    @GetMapping("/dashboard")
    Map<String, Object> dashboard() {
        return purchase.dashboard();
    }

    // ---- Email dispatch ----

    @Operation(summary = "Send supplier enquiry email")
    @PostMapping("/supplier-enquiry/{id}/send-email")
    Map<String, Object> sendEnquiryEmail(
            @Parameter(description = "Enquiry ID") @PathVariable Long id, Principal p) {
        return purchase.sendEnquiryEmail(id, principalName(p));
    }

    @Operation(summary = "Send purchase order email")
    @PostMapping("/purchase-order/{id}/send-email")
    Map<String, Object> sendPoEmail(
            @Parameter(description = "PO ID") @PathVariable Long id, Principal p) {
        return purchase.sendPoEmail(id, principalName(p));
    }

    @Operation(summary = "Send job order email")
    @PostMapping("/job-order/{id}/send-email")
    Map<String, Object> sendJoEmail(
            @Parameter(description = "JO ID") @PathVariable Long id, Principal p) {
        return purchase.sendJoEmail(id, principalName(p));
    }
}
