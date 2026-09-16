package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.entity.QualityInspection;
import in.zygertechnology.zygererp.entity.QualityNcr;
import in.zygertechnology.zygererp.service.DocumentFacade;
import in.zygertechnology.zygererp.service.QualityInspectionService;
import in.zygertechnology.zygererp.service.ExportService;
import in.zygertechnology.zygererp.service.StockService;
import in.zygertechnology.zygererp.repo.QualityInspectionStatusHistoryRepository;
import in.zygertechnology.zygererp.security.RequirePermission;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.time.Instant;
import java.math.BigDecimal;
import java.util.*;

/**
 * Quality Module API — common inspection engine.
 *
 * Mounted under /api/v1/quality (version-stripped to /api/quality at the gateway
 * where required; see SecurityConfig CORS). The module root follows the spec.
 */
@RestController
@RequestMapping("/api/v1/quality")
@RequirePermission(module = "QUALITY", screen = "*", action = "VIEW")
@RequiredArgsConstructor
public class QualityController {

    private final QualityInspectionService quality;
    private final DocumentFacade docs;
    private final ExportService export;
    private final QualityInspectionStatusHistoryRepository statusHistoryRepo;
    private final StockService stockService;

    @PersistenceContext
    private EntityManager em;

    private static String principalName(Principal p) { return p != null ? p.getName() : "system"; }

    // ---------- Inspection list / create / read / update ----------

    @GetMapping("/inspections")
    public Map<String, Object> listInspections(@RequestParam Map<String, String> q) {
        return quality.list(q);
    }

    @PostMapping("/inspections")
    public Map<String, Object> createInspection(@RequestBody Map<String, Object> body, Principal p) {
        QualityInspection e = quality.create(body, principalName(p));
        return docs.toRow(e);
    }

    // Inward → QC deferral: the Inspection Pending queue's Process action calls this to
    // create the Quality Inspection (and allocate its IQC/LO/JOMIN number) on demand from a
    // QC-required inward document that was posted to QC_HOLD but has no inspection yet.
    @PostMapping("/inspections/from-inward")
    @RequirePermission(module = "QUALITY", screen = "*", action = "EDIT")
    public Map<String, Object> createInspectionFromInward(@RequestBody Map<String, Object> body, Principal p) {
        String key = String.valueOf(body.get("sourceDocKey"));
        Object idObj = body.get("sourceDocId");
        if (key == null || key.isBlank() || idObj == null) {
            throw new IllegalArgumentException("sourceDocKey and sourceDocId are required");
        }
        Long id = ((Number) idObj).longValue();
        List<Long> ids = docs.createInspectionsFromInward(key, id, principalName(p));
        List<Map<String, Object>> inspections = ids.stream()
                .map(i -> docs.toRow(quality.get(i)))
                .toList();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("inspectionId", ids.isEmpty() ? null : ids.get(0));
        out.put("inspectionIds", ids);
        out.put("inspections", inspections);
        return out;
    }

    @GetMapping("/inspections/{id}")
    public Map<String, Object> getInspection(@PathVariable Long id) {
        return quality.getRow(id);
    }

    @PutMapping("/inspections/{id}")
    public Map<String, Object> updateInspection(@PathVariable Long id,
                                                @RequestBody Map<String, Object> body,
                                                Principal p) {
        QualityInspection old = quality.get(id);
        if (!List.of("DRAFT", "REJECTED").contains(old.getInspectionStatus())) {
            throw new IllegalStateException("Only DRAFT/REJECTED inspections can be edited");
        }
        // merge: re-create via the generic facade update (handles lines)
        Map<String, Object> merged = new HashMap<>(body);
        return docs.toRow(docs.update(QualityInspectionService.KEY, id, merged, principalName(p)));
    }

    // Narrower than PUT /inspections/{id}: that one requires DRAFT/REJECTED and replaces the
    // whole lines/characteristics collection. This just saves Accepted/Rejected/Rework/Hold
    // qty and Store Location — what the Inspection Pending "Process" screen actually edits —
    // and stays usable through SUBMITTED/HOLD/PASS/FAIL, right up to the Approve click that
    // reads these values back out to decide what actually posts to stock.
    @PutMapping("/inspections/{id}/decision-quantities")
    @RequirePermission(module = "QUALITY", screen = "*", action = "EDIT")
    public Map<String, Object> updateDecisionQuantities(@PathVariable Long id,
                                                        @RequestBody Map<String, Object> body,
                                                        Principal p) {
        return docs.toRow(quality.updateDecisionFields(id, body, principalName(p)));
    }

    @DeleteMapping("/inspections/{id}")
    public void deleteInspection(@PathVariable Long id, Principal p) {
        // generic engine gates to DRAFT/REJECTED
        docs.remove(QualityInspectionService.KEY, id, principalName(p));
    }

    @GetMapping("/inspections/next-number")
    public Map<String, Object> nextNumber(@org.springframework.web.bind.annotation.RequestParam(required = false) String inspectionType) {
        if (inspectionType != null && !inspectionType.isBlank()) {
            try {
                in.zygertechnology.zygererp.entity.QualityInspectionType type =
                    in.zygertechnology.zygererp.entity.QualityInspectionType.valueOf(inspectionType.toUpperCase());
                String prefix = QualityInspectionService.prefixForType(type);
                return Map.of("nextNumber", docs.peekNumber(QualityInspectionService.KEY, prefix));
            } catch (Exception ignored) {}
        }
        return Map.of("nextNumber", docs.peekNumber(QualityInspectionService.KEY, QualityInspectionService.prefixForType(null)));
    }

    // ---------- Workflow actions (spec 6.4) ----------

    @PostMapping("/inspections/{id}/start")
    @RequirePermission(module = "QUALITY", screen = "*", action = "EDIT")
    public Map<String, Object> start(@PathVariable Long id, Principal p) {
        return docs.toRow(quality.start(id, principalName(p)));
    }

    @PostMapping("/inspections/{id}/save-measurements")
    @RequirePermission(module = "QUALITY", screen = "*", action = "EDIT")
    public Map<String, Object> saveMeasurements(@PathVariable Long id,
                                                @RequestBody List<Map<String, Object>> body,
                                                @RequestParam(required = false) String overrideReason,
                                                Principal p) {
        String user = principalName(p);
        return docs.toRow(quality.saveMeasurements(id, body, user,
                overrideReason != null ? overrideReason : null, overrideReason != null ? user : null));
    }

    @PostMapping("/inspections/{id}/submit")
    @RequirePermission(module = "QUALITY", screen = "*", action = "EDIT")
    public Map<String, Object> submit(@PathVariable Long id, Principal p) {
        return docs.toRow(quality.submit(id, principalName(p)));
    }

    @PostMapping("/inspections/{id}/decision")
    @RequirePermission(module = "QUALITY", screen = "*", action = "EDIT")
    public Map<String, Object> decision(@PathVariable Long id,
                                        @RequestBody Map<String, String> body, Principal p) {
        return docs.toRow(quality.decide(id,
                body.getOrDefault("decision", "PASS"),
                body.get("remarks"),
                body.get("severity"),
                principalName(p)));
    }

    @PostMapping("/inspections/{id}/approve")
    @RequirePermission(module = "QUALITY", screen = "*", action = "APPROVE")
    public Map<String, Object> approve(@PathVariable Long id,
                                       @RequestBody(required = false) Map<String, Object> body,
                                       Principal p) {
        String minorReason = body != null && body.get("minorAcceptanceReason") != null
                ? String.valueOf(body.get("minorAcceptanceReason")) : null;
        return docs.toRow(quality.approve(id, minorReason, principalName(p)));
    }

    @PostMapping("/inspections/{id}/update-inventory")
    @RequirePermission(module = "QUALITY", screen = "*", action = "APPROVE")
    public Map<String, Object> updateInventory(@PathVariable Long id, Principal p) {
        return docs.toRow(quality.updateInventory(id, principalName(p)));
    }

    @PostMapping("/inspections/{id}/hold")
    @RequirePermission(module = "QUALITY", screen = "*", action = "EDIT")
    public Map<String, Object> hold(@PathVariable Long id,
                                    @RequestBody(required = false) Map<String, String> body, Principal p) {
        return docs.toRow(quality.hold(id, body == null ? null : body.get("reason"), principalName(p)));
    }

    @PostMapping("/inspections/{id}/release-hold")
    @RequirePermission(module = "QUALITY", screen = "*", action = "EDIT")
    public Map<String, Object> releaseHold(@PathVariable Long id, Principal p) {
        return docs.toRow(quality.releaseHold(id, principalName(p)));
    }

    @PostMapping("/inspections/{id}/release-stock")
    @RequirePermission(module = "QUALITY", screen = "*", action = "APPROVE")
    public Map<String, Object> releaseStock(@PathVariable Long id,
                                            @RequestBody(required = false) Map<String, Object> body,
                                            Principal p) {
        QualityInspection ins = quality.get(id);
        BigDecimal accepted = ins.getAcceptedQuantity() != null ? ins.getAcceptedQuantity()
                : ins.getInspectionQuantity();
        if (accepted == null || accepted.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalStateException("No accepted quantity to release to store");
        }
        String batch = ins.getBatchNumber() != null ? ins.getBatchNumber() : "";
        String heat = ins.getHeatNumber() != null ? ins.getHeatNumber() : "";
        stockService.releaseQcHoldForItem(
                ins.getDocNo(), QualityInspectionService.KEY, "QC_RELEASE",
                ins.getItemCode(), batch, heat, accepted, java.time.LocalDate.now(), principalName(p));
        return Map.of("message", "QC-held stock released to store", "releasedQty", accepted);
    }

    @PostMapping("/inspections/{id}/dispose-stock")
    @RequirePermission(module = "QUALITY", screen = "*", action = "APPROVE")
    public Map<String, Object> disposeStock(@PathVariable Long id,
                                            @RequestBody(required = false) Map<String, String> body,
                                            Principal p) {
        QualityInspection ins = quality.get(id);
        String disposition = body != null && body.get("disposition") != null
                ? body.get("disposition").toUpperCase() : "REJECTED";
        if (!List.of("REJECTED", "SCRAP", "QUARANTINE", "BLOCKED").contains(disposition)) {
            throw new IllegalStateException("Invalid disposition: " + disposition);
        }
        BigDecimal qty = ins.getRejectedQuantity() != null ? ins.getRejectedQuantity()
                : (ins.getInspectionQuantity() != null ? ins.getInspectionQuantity() : BigDecimal.ZERO);
        if (qty.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalStateException("No rejected quantity to dispose");
        }
        String batch = ins.getBatchNumber() != null ? ins.getBatchNumber() : "";
        String heat = ins.getHeatNumber() != null ? ins.getHeatNumber() : "";
        stockService.disposeHeldForItem(
                ins.getDocNo(), QualityInspectionService.KEY, "QC_DISPOSE",
                ins.getItemCode(), batch, heat, qty, disposition,
                java.time.LocalDate.now(), principalName(p));
        return Map.of("message", "QC-held stock moved to " + disposition, "disposedQty", qty, "disposition", disposition);
    }

    @PostMapping("/inspections/{id}/disposition")
    @RequirePermission(module = "QUALITY", screen = "*", action = "APPROVE")
    public Map<String, Object> setDisposition(@PathVariable Long id,
                                              @RequestBody Map<String, String> body, Principal p) {
        String disposition = body != null ? body.get("disposition") : null;
        String reason = body != null ? body.get("reason") : null;
        var row = quality.setDisposition(id, disposition, reason, principalName(p));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("inspectionId", row.getInspectionId());
        out.put("ncrId", row.getNcrId());
        out.put("dispositionType", row.getDispositionType());
        out.put("quantity", row.getQuantity());
        out.put("reason", row.getReason());
        out.put("authorizedBy", row.getAuthorizedBy());
        out.put("authorizedAt", row.getAuthorizedAt());
        return out;
    }

    @PostMapping("/inspections/{id}/close")
    @RequirePermission(module = "QUALITY", screen = "*", action = "APPROVE")
    public Map<String, Object> close(@PathVariable Long id, Principal p) {
        return docs.toRow(quality.close(id, principalName(p)));
    }

    @PostMapping("/inspections/{id}/cancel")
    @RequirePermission(module = "QUALITY", screen = "*", action = "CANCEL")
    public Map<String, Object> cancel(@PathVariable Long id,
                                      @RequestBody(required = false) Map<String, String> body, Principal p) {
        return docs.toRow(quality.cancel(id, body == null ? null : body.get("reason"), principalName(p)));
    }

    @PostMapping("/inspections/{id}/reopen")
    @RequirePermission(module = "QUALITY", screen = "*", action = "EDIT")
    public Map<String, Object> reopen(@PathVariable Long id,
                                      @RequestBody(required = false) Map<String, String> body, Principal p) {
        return docs.toRow(quality.reopen(id, body == null ? null : body.get("reason"), principalName(p)));
    }

    // ---------- Characteristics ----------

    @GetMapping("/inspections/{id}/characteristics")
    public Map<String, Object> characteristics(@PathVariable Long id) {
        QualityInspection ins = quality.get(id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("inspectionId", ins.getId());
        out.put("inspectionNumber", ins.getInspectionNumber());
        out.put("characteristics", docs.toRow(ins).get("lines"));
        return out;
    }

    @PutMapping("/inspections/{id}/characteristics")
    public Map<String, Object> replaceCharacteristics(@PathVariable Long id,
                                                      @RequestBody List<Map<String, Object>> body) {
        return saveMeasurementsPut(id, body);
    }

    @PostMapping("/inspections/{id}/characteristics/bulk-save")
    public Map<String, Object> bulkSave(@PathVariable Long id,
                                        @RequestBody List<Map<String, Object>> body,
                                        @RequestParam(required = false) String overrideReason,
                                        Principal p) {
        String user = principalName(p);
        return docs.toRow(quality.saveMeasurements(id, body, user,
                overrideReason != null ? overrideReason : null, overrideReason != null ? user : null));
    }

    /** §6.2: Bulk import measurements from CSV. Format: balloonNo|characteristicCode,actualValue,instrumentCode,remark */
    @PostMapping("/inspections/{id}/characteristics/bulk-import")
    public Map<String, Object> bulkImport(@PathVariable Long id,
                                          @RequestBody String csvContent, Principal p) {
        Map<String, Object> result = quality.bulkImportMeasurements(id, csvContent, principalName(p));
        result.put("inspection", docs.toRow(quality.get(id)));
        return result;
    }

    private Map<String, Object> saveMeasurementsPut(Long id, List<Map<String, Object>> body) {
        return docs.toRow(quality.saveMeasurements(id, body, "system"));
    }

    // ---------- Pending queue helpers (spec 6.2) ----------

    @GetMapping("/inspection-pending/count")
    public Map<String, Object> pendingCount(@RequestParam Map<String, String> q) {
        long count = countPending(q.get("inspectionType"), q.get("priority"), q.get("inspector"), q.get("itemCode"));
        count += waitingQcRows(q.get("inspectionType"), q.get("priority"), q.get("inspector"), q.get("itemCode")).size();
        return Map.of("count", count);
    }

    @GetMapping("/inspection-pending")
    public Map<String, Object> inspectionPendingQueue(
            @RequestParam(required = false) String inspectionType,
            @RequestParam(required = false) String priority,
            @RequestParam(required = false) String inspector,
            @RequestParam(required = false) String itemCode,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        StringBuilder jpql = new StringBuilder("SELECT q FROM QualityInspection q WHERE q.inspectionStatus IN ('DRAFT','PENDING','ASSIGNED') AND (q.isLocked = false OR q.isLocked IS NULL)");
        Map<String, Object> params = new LinkedHashMap<>();

        if (inspectionType != null && !inspectionType.isBlank()) {
            jpql.append(" AND q.inspectionType = :inspectionType");
            params.put("inspectionType", inspectionType);
        }
        if (priority != null && !priority.isBlank()) {
            jpql.append(" AND q.priority = :priority");
            params.put("priority", priority);
        }
        if (inspector != null && !inspector.isBlank()) {
            jpql.append(" AND (q.inspector = :inspector OR q.assignedInspector = :inspector)");
            params.put("inspector", inspector);
        }
        if (itemCode != null && !itemCode.isBlank()) {
            jpql.append(" AND q.itemCode = :itemCode");
            params.put("itemCode", itemCode);
        }

        jpql.append(" ORDER BY CASE q.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Normal' THEN 3 WHEN 'Low' THEN 4 ELSE 5 END, q.dueDate ASC NULLS LAST, q.createdAt ASC");

        var query = em.createQuery(jpql.toString(), QualityInspection.class);
        params.forEach(query::setParameter);
        query.setFirstResult(page * size);
        query.setMaxResults(size);
        List<QualityInspection> results = query.getResultList();

        // QC-required inwards posted to QC_HOLD that have no inspection created yet are
        // deferred-creation items; they show here until Process creates their inspection.
        List<Map<String, Object>> awaiting = waitingQcRows(inspectionType, priority, inspector, itemCode);

        long total = countPending(inspectionType, priority, inspector, itemCode) + awaiting.size();

        List<Map<String, Object>> content = new ArrayList<>(results.stream().map(docs::toRow).toList());
        content.addAll(awaiting);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("content", content);
        out.put("totalElements", total);
        out.put("page", page);
        out.put("size", size);
        out.put("totalPages", (total + size - 1) / size);
        return out;
    }

    private List<Map<String, Object>> waitingQcRows(String inspectionType, String priority,
                                                    String inspector, String itemCode) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (String k : List.of("po-inward", "lo-inward", "jo-inward", "general-inward", "grn")) {
            for (Map<String, Object> row : docs.awaitingQcDocRows(k)) {
                if (inspectionType != null && !inspectionType.isBlank()
                        && !inspectionType.equalsIgnoreCase(String.valueOf(row.get("inspectionType")))) continue;
                if (itemCode != null && !itemCode.isBlank()
                        && !itemCode.equalsIgnoreCase(String.valueOf(row.get("itemCode")))) continue;
                rows.add(row);
            }
        }
        return rows;
    }

    private long countPending(String inspectionType, String priority, String inspector, String itemCode) {
        StringBuilder jpql = new StringBuilder("SELECT COUNT(q) FROM QualityInspection q WHERE q.inspectionStatus IN ('DRAFT','PENDING','ASSIGNED') AND (q.isLocked = false OR q.isLocked IS NULL)");
        Map<String, Object> params = new LinkedHashMap<>();
        if (inspectionType != null && !inspectionType.isBlank()) { jpql.append(" AND q.inspectionType = :inspectionType"); params.put("inspectionType", inspectionType); }
        if (priority != null && !priority.isBlank()) { jpql.append(" AND q.priority = :priority"); params.put("priority", priority); }
        if (inspector != null && !inspector.isBlank()) { jpql.append(" AND (q.inspector = :inspector OR q.assignedInspector = :inspector)"); params.put("inspector", inspector); }
        if (itemCode != null && !itemCode.isBlank()) { jpql.append(" AND q.itemCode = :itemCode"); params.put("itemCode", itemCode); }
        var query = em.createQuery(jpql.toString(), Long.class);
        params.forEach(query::setParameter);
        return query.getSingleResult();
    }

    // ---------- Re-inspection chain (spec 6.3) ----------

    @PostMapping("/inspections/{id}/re-inspection")
    public Map<String, Object> createReInspection(@PathVariable Long id,
                                                   @RequestBody Map<String, Object> body,
                                                   Principal p) {
        QualityInspection parent = quality.get(id);
        body.put("parentInspectionId", parent.getId());
        body.put("inspectionType", body.getOrDefault("inspectionType", parent.getInspectionType()));
        body.put("itemCode", body.getOrDefault("itemCode", parent.getItemCode()));
        body.put("sourceType", parent.getSourceType());
        body.put("sourceId", parent.getSourceId());
        body.put("sourceNumber", parent.getSourceNumber());
        body.put("purchaseOrderNumber", parent.getPurchaseOrderNumber());
        body.put("poInwardNumber", parent.getPoInwardNumber());
        body.put("priority", body.getOrDefault("priority", "High"));
        body.put("inspectionDate", java.time.LocalDate.now().toString());
        QualityInspection re = quality.create(body, principalName(p));
        return docs.toRow(re);
    }

    @GetMapping("/inspections/{id}/re-inspections")
    public List<Map<String, Object>> listReInspections(@PathVariable Long id) {
        List<QualityInspection> all = em.createQuery(
            "SELECT q FROM QualityInspection q WHERE q.parentInspectionId = :parentId ORDER BY q.createdAt ASC",
            QualityInspection.class).setParameter("parentId", id).getResultList();
        return all.stream().map(docs::toRow).toList();
    }

    // ---------- Production gate (spec 6.4) ----------

    @GetMapping("/production-gate/check")
    public Map<String, Object> productionGateCheck(
            @RequestParam(required = false) String itemCode,
            @RequestParam(required = false) String machineCode) {

        StringBuilder jpql = new StringBuilder("SELECT COUNT(q) FROM QualityInspection q WHERE q.inspectionStatus IN ('DRAFT','PENDING','ASSIGNED','HOLD')");
        Map<String, Object> params = new LinkedHashMap<>();

        if (itemCode != null && !itemCode.isBlank()) {
            jpql.append(" AND q.itemCode = :itemCode");
            params.put("itemCode", itemCode);
        }
        if (machineCode != null && !machineCode.isBlank()) {
            jpql.append(" AND q.machine = :machineCode");
            params.put("machineCode", machineCode);
        }

        var query = em.createQuery(jpql.toString(), Long.class);
        params.forEach(query::setParameter);
        long pendingCount = query.getSingleResult();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("blocked", pendingCount > 0);
        result.put("pendingInspectionCount", pendingCount);
        result.put("message", pendingCount > 0
            ? "Production blocked: " + pendingCount + " inspection(s) pending/hold"
            : "Production allowed: no pending inspections");
        return result;
    }

    // ---------- Non-Conformance Reports ----------

    @GetMapping("/ncrs")
    public Map<String, Object> listNcrs(@RequestParam Map<String, String> q) {
        Map<String, String> copy = new HashMap<>(q);
        copy.put("status", copy.getOrDefault("status", "PENDING"));
        return docs.list("quality-ncr", copy);
    }

    @PostMapping("/ncrs")
    public Map<String, Object> createNcr(@RequestBody Map<String, Object> body, Principal p) {
        body.put("createdBy", principalName(p));
        return docs.toRow(docs.create("quality-ncr", body, principalName(p)));
    }

    @GetMapping("/ncrs/{id}")
    public Map<String, Object> getNcr(@PathVariable Long id) {
        return docs.getRow("quality-ncr", id);
    }

    @PutMapping("/ncrs/{id}")
    public Map<String, Object> updateNcr(@PathVariable Long id,
                                         @RequestBody Map<String, Object> body,
                                         Principal p) {
        return docs.toRow(docs.update("quality-ncr", id, body, principalName(p)));
    }

    @DeleteMapping("/ncrs/{id}")
    public void deleteNcr(@PathVariable Long id, Principal p) {
        docs.remove("quality-ncr", id, principalName(p));
    }

    // ---------- Supplier Corrective Action Reports (SCAR) ----------

    @GetMapping("/scars")
    public Map<String, Object> listScars(@RequestParam Map<String, String> q) {
        return docs.list("quality-scar", q);
    }

    @PostMapping("/scars")
    public Map<String, Object> createScar(@RequestBody Map<String, Object> body, Principal p) {
        body.put("createdBy", principalName(p));
        return docs.toRow(docs.create("quality-scar", body, principalName(p)));
    }

    @GetMapping("/scars/{id}")
    public Map<String, Object> getScar(@PathVariable Long id) {
        return docs.getRow("quality-scar", id);
    }

    @PutMapping("/scars/{id}")
    public Map<String, Object> updateScar(@PathVariable Long id,
                                          @RequestBody Map<String, Object> body,
                                          Principal p) {
        return docs.toRow(docs.update("quality-scar", id, body, principalName(p)));
    }

    @DeleteMapping("/scars/{id}")
    public void deleteScar(@PathVariable Long id, Principal p) {
        docs.remove("quality-scar", id, principalName(p));
    }

    @GetMapping("/scars/next-number")
    public Map<String, Object> nextScarNumber() {
        return Map.of("nextNumber", docs.peekNumberFy("SCAR"));
    }

    // ---------- Spec §4.2: Status History ----------

    @GetMapping("/inspections/{id}/history")
    public List<Map<String, Object>> inspectionHistory(@PathVariable Long id) {
        return statusHistoryRepo.findByInspectionIdOrderByChangedAtAsc(id).stream()
                .map(h -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", h.getId());
                    m.put("previousStatus", h.getPreviousStatus());
                    m.put("newStatus", h.getNewStatus());
                    m.put("remarks", h.getRemarks());
                    m.put("changedBy", h.getChangedBy());
                    m.put("changedAt", h.getChangedAt());
                    m.put("inspectionType", h.getInspectionType());
                    return m;
                }).toList();
    }

    @GetMapping("/ncrs/next-number")
    public Map<String, Object> nextNcrNumber() {
        return Map.of("nextNumber", docs.peekNumberFy("NCR"));
    }

    // ---------- Spec §7: SPC Data ----------

    @GetMapping("/spc")
    public Map<String, Object> spcData(
            @RequestParam String itemCode,
            @RequestParam(required = false) String characteristicCode) {
        String where = "l.doc.itemCode = :itemCode AND l.actualValue IS NOT NULL";
        Map<String, Object> params = new HashMap<>();
        params.put("itemCode", itemCode);
        if (characteristicCode != null && !characteristicCode.isBlank()) {
            where += " AND l.characteristicCode = :charCode";
            params.put("charCode", characteristicCode);
        }

        var query = em.createQuery(
                "SELECT l.characteristicCode, l.characteristicName, l.nominalValue, l.lowerLimit, l.upperLimit, l.uom, l.actualValue, l.measuredAt, l.result, d.inspectionNumber " +
                "FROM QualityInspectionLine l JOIN l.doc d WHERE " + where + " ORDER BY l.measuredAt ASC",
                Object[].class);
        for (var e : params.entrySet()) query.setParameter(e.getKey(), e.getValue());
        List<Object[]> data = query.getResultList();

        Map<String, Map<String, Object>> byChar = new LinkedHashMap<>();
        for (Object[] r : data) {
            String code = (String) r[0];
            byChar.computeIfAbsent(code, k -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("characteristicCode", r[0]);
                m.put("characteristicName", r[1]);
                m.put("nominalValue", r[2]);
                m.put("lowerLimit", r[3]);
                m.put("upperLimit", r[4]);
                m.put("uom", r[5]);
                m.put("samples", new ArrayList<>());
                return m;
            });
            Map<String, Object> sample = new LinkedHashMap<>();
            sample.put("value", r[6]);
            sample.put("measuredAt", r[7]);
            sample.put("result", r[8]);
            sample.put("inspectionNumber", r[9]);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> samples = (List<Map<String, Object>>) byChar.get(code).get("samples");
            samples.add(sample);
        }

        return Map.of("itemCode", itemCode, "characteristics", new ArrayList<>(byChar.values()));
    }
}
