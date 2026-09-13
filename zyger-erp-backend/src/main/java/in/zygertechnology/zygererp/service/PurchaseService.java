package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.PurchasePriceHistoryRepository;
import in.zygertechnology.zygererp.repo.JobWorkPriceHistoryRepository;
import in.zygertechnology.zygererp.repo.MasterAuditLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import in.zygertechnology.zygererp.repo.PartyRepository;
import in.zygertechnology.zygererp.repo.ItemRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.Map;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

@Service
@RequiredArgsConstructor
public class PurchaseService {

    static final Set<String> PURCHASE_KEYS = Set.of(
            "purchase-request", "supplier-enquiry", "supplier-quotation",
            "purchase-order", "job-order", "purchase-target",
            "purchase-price-list", "job-work-price-list",
            "purchase-return"
    );

    private static final Set<String> FINANCE_DOC_STATUSES = Set.of("APPROVED", "POSTED", "RELEASED", "SENT");
    // PO can realistically sit in any of these while still "open" for procurement purposes —
    // disableApprovalWorkflow means most real POs go DRAFT -> RELEASED (via email) and never touch
    // APPROVED/POSTED, so counting APPROVED alone undercounts almost everything in practice.
    private static final Set<String> OPEN_PO_STATUSES = Set.of(
            "APPROVED", "SUBMITTED", "RELEASED", "PARTIALLY_RECEIVED", "ON_HOLD", "POSTED"
    );
    private static final Set<String> ACTIVITY_ENTITY_TYPES = Set.of(
            "SupplierEnquiry", "SupplierQuotation", "PurchaseOrder", "PurchaseRequest",
            "JobOrder", "PurchaseTarget", "PurchasePriceList", "JobWorkPriceList",
            "SupplierEnquirySupplier", "PoInward"
    );

    private final DocumentFacade docs;
    private final PurchasePriceHistoryRepository priceHistory;
    private final JobWorkPriceHistoryRepository jobWorkPriceHistory;
    private final PartyRepository parties;
    private final ItemRepository items;
    private final EmailService emailService;
    private final PrintService printer;
    private final NotificationService notifications;
    private final MasterAuditLogRepository auditLogs;
    private final QualityInspectionService qualityInspectionService;

    @PersistenceContext
    private EntityManager em;

    public boolean isPurchase(String key) { return PURCHASE_KEYS.contains(key); }

    @Transactional
    public DocEntity create(String key, Map<String, Object> body, String user) {
        validateReferences(key, body);
        body.put("createdBy", user);
        preProcessBody(key, body);
        DocEntity e = docs.create(key, body, user);
        applyCreationDefaults(key, e);
        return e;
    }

    private void preProcessBody(String key, Map<String, Object> body) {
        if (body.containsKey("requiredDate") && !body.containsKey("docDate")) body.put("docDate", body.get("requiredDate"));
        if (body.containsKey("enquiryDate") && !body.containsKey("docDate")) body.put("docDate", body.get("enquiryDate"));
        if (body.containsKey("quotationDate") && !body.containsKey("docDate")) body.put("docDate", body.get("quotationDate"));
        if (body.containsKey("poDate") && !body.containsKey("docDate")) body.put("docDate", body.get("poDate"));
        if (body.containsKey("jobOrderDate") && !body.containsKey("docDate")) body.put("docDate", body.get("jobOrderDate"));

        if (body.containsKey("notes") && !body.containsKey("remarks")) body.put("remarks", body.get("notes"));
        if (body.containsKey("remarks") && !body.containsKey("notes")) body.put("notes", body.get("remarks"));

        if (body.containsKey("requestedBy")) {
            body.putIfAbsent("requestBy", body.get("requestedBy"));
        }
        if (body.containsKey("requestBy")) {
            body.putIfAbsent("requestedBy", body.get("requestBy"));
        }
        if (body.containsKey("validUntil")) {
            body.putIfAbsent("quotationValidityDate", body.get("validUntil"));
        }
        if (body.containsKey("subcontractor")) {
            body.putIfAbsent("supplierJobWorker", body.get("subcontractor"));
            body.putIfAbsent("supplier", body.get("subcontractor"));
        }
        if (body.containsKey("processName")) {
            body.putIfAbsent("process", body.get("processName"));
        }
    }

    private void validateReferences(String key, Map<String, Object> body) {
        String supplier = (String) body.get("supplier");
        String supplierCode = (String) body.get("supplierCode");
        if ((supplierCode == null || supplierCode.isBlank()) && supplier != null && !supplier.isBlank()) {
            parties.findByName(supplier).ifPresent(p -> body.put("supplierCode", p.getCode()));
        }
        if (supplierCode != null && !supplierCode.isBlank() && isPurchaseDoc(key)) {
            parties.findByCode(supplierCode).ifPresent(p -> {
                if ("BLOCKED".equalsIgnoreCase(p.getApprovalStatus()) || "BLOCKED".equalsIgnoreCase(p.getApprovedVendorStatus())) {
                    throw new IllegalStateException("Supplier " + p.getCode() + " is BLOCKED (Approved Vendor Status = BLOCKED) and cannot be used in purchase documents");
                }
            });
        }
    }

    private boolean isPurchaseDoc(String key) {
        return "purchase-order".equals(key) || "job-order".equals(key)
            || "purchase-request".equals(key) || "po-inward".equals(key);
    }

    private void applyCreationDefaults(String key, DocEntity e) {
        switch (key) {
            case "supplier-enquiry" -> {
                if (e instanceof SupplierEnquiry se) {
                    if (se.getSupplier() != null && !se.getSupplier().isBlank()) {
                        if (se.getContactPerson() == null || se.getContactPerson().isBlank() ||
                            se.getPhone() == null || se.getPhone().isBlank() ||
                            se.getEmail() == null || se.getEmail().isBlank()) {
                            parties.findByName(se.getSupplier()).ifPresent(p -> {
                                if (se.getSupplierCode() == null || se.getSupplierCode().isBlank()) se.setSupplierCode(p.getCode());
                                if (se.getContactPerson() == null || se.getContactPerson().isBlank()) se.setContactPerson(p.getContactPerson());
                                if (se.getPhone() == null || se.getPhone().isBlank()) se.setPhone(p.getPhone() != null ? p.getPhone() : p.getMobile());
                                if (se.getEmail() == null || se.getEmail().isBlank()) se.setEmail(p.getEmail());
                            });
                        }
                    }
                    if (se.getSuppliers() == null || se.getSuppliers().isEmpty()) {
                        if (se.getSupplier() != null && !se.getSupplier().isBlank()) {
                            SupplierEnquirySupplier ses = new SupplierEnquirySupplier();
                            ses.setDoc(se);
                            ses.setSupplierName(se.getSupplier());
                            ses.setSupplierCode(se.getSupplierCode());
                            ses.setContactPerson(se.getContactPerson());
                            ses.setPhone(se.getPhone());
                            ses.setEmail(se.getEmail());
                            ses.setStatus("PENDING");
                            ses.setEnquiryStatus("PENDING");
                            se.getSuppliers().add(ses);
                        }
                    } else {
                        for (SupplierEnquirySupplier s : se.getSuppliers()) {
                            if (s.getStatus() == null) s.setStatus("PENDING");
                            if (s.getEnquiryStatus() == null) s.setEnquiryStatus("PENDING");
                            if (s.getSupplierName() == null) s.setSupplierName(se.getSupplier());
                            if (s.getContactPerson() == null) s.setContactPerson(se.getContactPerson());
                            if (s.getPhone() == null) s.setPhone(se.getPhone());
                            if (s.getEmail() == null) s.setEmail(se.getEmail());
                        }
                    }
                }
            }
            case "purchase-order" -> {
                if (e instanceof PurchaseOrder po) {
                    if (po.getSupplier() != null && !po.getSupplier().isBlank()) {
                        if (po.getContactPerson() == null || po.getContactPerson().isBlank() ||
                            po.getPhone() == null || po.getPhone().isBlank() ||
                            po.getEmail() == null || po.getEmail().isBlank()) {
                            parties.findByName(po.getSupplier()).ifPresent(p -> {
                                if (po.getSupplierCode() == null || po.getSupplierCode().isBlank()) po.setSupplierCode(p.getCode());
                                if (po.getContactPerson() == null || po.getContactPerson().isBlank()) po.setContactPerson(p.getContactPerson());
                                if (po.getPhone() == null || po.getPhone().isBlank()) po.setPhone(p.getPhone() != null ? p.getPhone() : p.getMobile());
                                if (po.getEmail() == null || po.getEmail().isBlank()) po.setEmail(p.getEmail());
                            });
                        }
                    }
                    if (po.getLines() != null) {
                        for (PurchaseOrderItem item : (java.util.List<PurchaseOrderItem>) po.getLines()) {
                            if (item.getOrderQty() == null) item.setOrderQty(BigDecimal.ZERO);
                            if (item.getUnitPrice() == null) item.setUnitPrice(BigDecimal.ZERO);
                            if (item.getDiscount() == null) item.setDiscount(BigDecimal.ZERO);
                            if (item.getTax() == null) item.setTax(BigDecimal.ZERO);
                            BigDecimal net = item.getOrderQty()
                                    .multiply(item.getUnitPrice())
                                    .subtract(item.getDiscount());
                            item.setNetAmount(net);
                        }
                    }
                }
            }
            case "purchase-price-list" -> {
                if (e instanceof PurchasePriceList ppl) {
                    if (ppl.getRevisionNumber() == null) ppl.setRevisionNumber(1);
                    if (ppl.getApprovalStatus() == null) ppl.setApprovalStatus("DRAFT");
                }
            }
            case "job-work-price-list" -> {
                if (e instanceof JobWorkPriceList jwpl) {
                    if (jwpl.getRevisionNumber() == null) jwpl.setRevisionNumber(1);
                    if (jwpl.getApprovalStatus() == null) jwpl.setApprovalStatus("DRAFT");
                }
            }
            default -> {}
        }
    }

    @Transactional
    public DocEntity action(String key, Long id, String action, String note, String user) {
        DocEntity e = docs.action(key, id, action, note, user);
        postActionHook(key, e, action, user);
        return e;
    }

    private void postActionHook(String key, DocEntity e, String action, String user) {
        if (!"approve".equals(action)) return;
        switch (key) {
            case "supplier-quotation" -> {
                if (e instanceof SupplierQuotation sq) {
                    recordPurchasePriceHistory(sq);
                }
            }
            case "purchase-price-list" -> {
                if (e instanceof PurchasePriceList ppl) {
                    ppl.setApprovalStatus("APPROVED");
                    recordPriceListHistory(ppl, user);
                }
            }
            case "job-work-price-list" -> {
                if (e instanceof JobWorkPriceList jwpl) {
                    jwpl.setApprovalStatus("APPROVED");
                    recordJobWorkPriceHistory(jwpl, user);
                }
            }
            default -> {}
        }
    }

    // ---- Email dispatch ----

    @Transactional
    public Map<String, Object> sendEnquiryEmail(Long id, String user) {
        DocEntity e = docs.get("supplier-enquiry", id);
        if (!(e instanceof SupplierEnquiry se)) {
            throw new IllegalArgumentException("Document is not a Supplier Enquiry: " + id);
        }
        int sent = 0;
        int failed = 0;
        List<Map<String, Object>> targets = new ArrayList<>();

        Map<String, Object> headerResult = sendEnquiryTarget(se, null, user);
        if (headerResult != null) sent++;
        if (se.getSuppliers() != null) {
            for (SupplierEnquirySupplier s : se.getSuppliers()) {
                Map<String, Object> r = sendEnquiryTarget(se, s, user);
                if (r != null) {
                    sent++;
                    targets.add(r);
                } else {
                    failed++;
                }
            }
        }
        if (sent > 0) se.setStatus("SENT");
        notifications.notify("DOC_SENT", "PURCHASE", "supplier-enquiry", se.getId(), "INFO",
                "Supplier Enquiry " + se.getDocNo() + " sent via email to " + sent + " supplier(s)", se.getDocNo());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sent", sent);
        out.put("failed", failed);
        out.put("targets", targets);
        out.put("message", "Enquiry " + se.getDocNo() + " emailed to " + sent + " recipient(s), " + failed + " failed");
        return out;
    }

    private Map<String, Object> sendEnquiryTarget(SupplierEnquiry se, SupplierEnquirySupplier s, String user) {
        String to = s != null ? s.getEmail() : se.getEmail();
        if (to == null || to.isBlank()) return null;
        String targetName = s != null ? s.getSupplierName() : se.getSupplier();
        boolean ok;
        String failureReason = null;
        try {
            ok = emailService.sendSupplierEnquiryEmail(se, to, null, targetName);
            if (!ok) failureReason = "SMTP delivery failed";
        } catch (Exception ex) {
            ok = false;
            failureReason = ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName();
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("email", to);
        out.put("name", targetName);
        out.put("sent", ok);
        if (!ok) out.put("error", failureReason);
        if (s != null) {
            s.setEmailStatus(ok ? "SENT" : "FAILED");
            if (ok) s.setEmailSentAt(Instant.now());
            else s.setEmailError(failureReason);
        }
        return out;
    }

    @Transactional
    public Map<String, Object> sendPoEmail(Long id, String user) {
        DocEntity e = docs.get("purchase-order", id);
        if (!(e instanceof PurchaseOrder po)) {
            throw new IllegalArgumentException("Document is not a Purchase Order: " + id);
        }
        if (po.getEmail() == null || po.getEmail().isBlank()) {
            throw new IllegalStateException("Purchase Order " + po.getDocNo() + " has no supplier email address configured");
        }
        byte[] pdf;
        try {
            Map<String, Object> row = docs.getRow("purchase-order", id);
            pdf = printer.salesDoc(row, "purchase-order");
        } catch (Exception ex) {
            throw new IllegalStateException("Failed to generate PO PDF for email: " + ex.getMessage(), ex);
        }
        boolean ok;
        String failureReason = null;
        try {
            ok = emailService.sendPurchaseOrderEmail(po, po.getEmail(), null, pdf,
                    po.getDocNo().replaceAll("[^A-Za-z0-9_-]", "_") + ".pdf");
            if (!ok) failureReason = "SMTP delivery failed";
        } catch (Exception ex) {
            ok = false;
            failureReason = ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName();
        }
        po.setEmailStatus(ok ? "SENT" : "FAILED");
        if (ok) po.setEmailSentAt(Instant.now());
        else po.setEmailError(failureReason);
        if (ok) po.setStatus("SENT");
        em.merge(po);
        em.flush();
        notifications.notify(ok ? "DOC_SENT" : "DOC_SEND_FAILED", "PURCHASE", "purchase-order", po.getId(),
                ok ? "INFO" : "WARNING",
                (ok ? "Purchase Order " : "Failed to email Purchase Order ") + po.getDocNo() + " to " + po.getEmail(), po.getDocNo());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sent", ok);
        out.put("email", po.getEmail());
        out.put("message", ok
                ? "Purchase Order " + po.getDocNo() + " emailed to " + po.getEmail()
                : "Purchase Order " + po.getDocNo() + " email dispatch failed (check SMTP config / see logs)");
        return out;
    }

    @Transactional
    public Map<String, Object> sendJoEmail(Long id, String user) {
        DocEntity e = docs.get("job-order", id);
        if (!(e instanceof JobOrder jo)) {
            throw new IllegalArgumentException("Document is not a Job Order: " + id);
        }
        if (jo.getEmail() == null || jo.getEmail().isBlank()) {
            throw new IllegalStateException("Job Order " + jo.getDocNo() + " has no subcontractor email address configured");
        }
        byte[] pdf;
        try {
            Map<String, Object> row = docs.getRow("job-order", id);
            pdf = printer.salesDoc(row, "job-order");
        } catch (Exception ex) {
            throw new IllegalStateException("Failed to generate JO PDF for email: " + ex.getMessage(), ex);
        }
        boolean ok;
        String failureReason = null;
        try {
            ok = emailService.sendJobOrderEmail(jo, jo.getEmail(), null, pdf,
                    jo.getDocNo().replaceAll("[^A-Za-z0-9_-]", "_") + ".pdf");
            if (!ok) failureReason = "SMTP delivery failed";
        } catch (Exception ex) {
            ok = false;
            failureReason = ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName();
        }
        jo.setEmailStatus(ok ? "SENT" : "FAILED");
        if (ok) jo.setEmailSentAt(Instant.now());
        else jo.setEmailError(failureReason);
        notifications.notify(ok ? "DOC_SENT" : "DOC_SEND_FAILED", "PURCHASE", "job-order", jo.getId(),
                ok ? "INFO" : "WARNING",
                (ok ? "Job Order " : "Failed to email Job Order ") + jo.getDocNo() + " to " + jo.getEmail(), jo.getDocNo());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sent", ok);
        out.put("email", jo.getEmail());
        out.put("message", ok
                ? "Job Order " + jo.getDocNo() + " emailed to " + jo.getEmail()
                : "Job Order " + jo.getDocNo() + " email dispatch failed (check SMTP config / see logs)");
        return out;
    }

    private void recordPurchasePriceHistory(SupplierQuotation sq) {
        if (sq.getLines() == null) return;
        for (SupplierQuotationItem item : (java.util.List<SupplierQuotationItem>) sq.getLines()) {
            PurchasePriceHistory h = new PurchasePriceHistory();
            h.setSupplier(sq.getSupplier());
            h.setItemCode(item.getItemCode());
            BigDecimal prev = priceHistory.findTopBySupplierAndItemCodeOrderByEffectiveDateDescIdDesc(sq.getSupplier(), item.getItemCode())
                .map(PurchasePriceHistory::getNewPrice).orElse(null);
            h.setPreviousPrice(prev);
            h.setNewPrice(item.getUnitPrice());
            h.setEffectiveDate(sq.getDocDate());
            h.setChangedBy(sq.getCreatedBy());
            h.setApprovedBy(sq.getCreatedBy());
            h.setChangeReason("Approved quotation " + sq.getDocNo());
            priceHistory.save(h);
        }
    }

    private void recordPriceListHistory(PurchasePriceList ppl, String user) {
        PurchasePriceHistory h = new PurchasePriceHistory();
        h.setSupplier(ppl.getSupplier());
        h.setItemCode(ppl.getItemCode());
        BigDecimal prev = priceHistory.findTopBySupplierAndItemCodeOrderByEffectiveDateDescIdDesc(ppl.getSupplier(), ppl.getItemCode())
            .map(PurchasePriceHistory::getNewPrice).orElse(null);
        h.setPreviousPrice(prev);
        h.setNewPrice(ppl.getUnitPrice());
        h.setEffectiveDate(ppl.getEffectiveFrom());
        h.setChangedBy(user);
        h.setApprovedBy(user);
        h.setChangeReason("Approved price list " + ppl.getDocNo());
        priceHistory.save(h);
    }

    private void recordJobWorkPriceHistory(JobWorkPriceList jwpl, String user) {
        JobWorkPriceHistory h = new JobWorkPriceHistory();
        h.setSupplier(jwpl.getSupplier());
        h.setProcess(jwpl.getProcess());
        h.setPreviousRate(null);
        h.setNewRate(jwpl.getRate());
        h.setEffectiveDate(jwpl.getEffectiveFrom());
        h.setChangedBy(user);
        h.setApprovedBy(user);
        h.setChangeReason("Approved job work price list " + jwpl.getDocNo());
        jobWorkPriceHistory.save(h);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> dashboard() {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("openPR", countByStatus("purchase-request", "SUBMITTED"));
        d.put("openEnquiries", countByStatus("supplier-enquiry", "DRAFT"));
        d.put("pendingQuotations", countByStatus("supplier-quotation", "SUBMITTED"));
        d.put("openPO", countByStatuses("purchase-order", OPEN_PO_STATUSES));
        d.put("pendingPOApproval", countByStatus("purchase-order", "SUBMITTED"));
        d.put("partiallyReceived", computePartiallyReceivedPOs());
        d.put("delayedPO", computeDelayedPOs());
        d.put("openJobOrders", countByStatus("job-order", "SUBMITTED"));
        d.put("overdueJobOrders", countByStatus("job-order", "APPROVED"));
        d.put("totalPR", docs.count("purchase-request"));
        d.put("totalPO", docs.count("purchase-order"));
        d.put("totalJO", docs.count("job-order"));
        d.putAll(financeSummary());
        d.put("recentActivity", recentActivity());
        return d;
    }

    @Transactional(readOnly = true)
    private Map<String, Object> financeSummary() {
        Map<String, Object> f = new LinkedHashMap<>();

        BigDecimal committedSpend = BigDecimal.ZERO;
        BigDecimal openPOValue = BigDecimal.ZERO;
        Map<String, BigDecimal> spendBySupplier = new LinkedHashMap<>();
        Map<String, BigDecimal> spendByItem = new LinkedHashMap<>();
        Map<String, BigDecimal> monthlySpend = new LinkedHashMap<>();
        Map<String, BigDecimal> spendByDepartment = new LinkedHashMap<>();

        for (DocEntity d : docs.findAll("purchase-order")) {
            if (!(d instanceof PurchaseOrder po)) continue;
            String st = po.getStatus();
            boolean open = OPEN_PO_STATUSES.contains(st);
            if (po.getLines() == null) continue;
            for (PurchaseOrderItem li : (List<PurchaseOrderItem>) po.getLines()) {
                BigDecimal amt = li.getNetAmount() != null ? li.getNetAmount() : BigDecimal.ZERO;
                if (amt.compareTo(BigDecimal.ZERO) <= 0) continue;
                if (open) {
                    committedSpend = committedSpend.add(amt);
                    String supplier = po.getSupplier() != null ? po.getSupplier() : "Unassigned";
                    spendBySupplier.merge(supplier, amt, BigDecimal::add);
                    String item = li.getItemCode() != null ? li.getItemCode() : (li.getItemName() != null ? li.getItemName() : "Unknown");
                    spendByItem.merge(item, amt, BigDecimal::add);
                    String dept = po.getDepartment() != null ? po.getDepartment() : "General";
                    spendByDepartment.merge(dept, amt, BigDecimal::add);
                    String month = po.getDocDate() != null
                            ? po.getDocDate().getYear() + "-" + String.format("%02d", po.getDocDate().getMonthValue())
                            : "TBD";
                    monthlySpend.merge(month, amt, BigDecimal::add);
                }
            }
            if (OPEN_PO_STATUSES.contains(st)) {
                BigDecimal poTotal = po.getLines().stream()
                        .map(li -> li.getNetAmount() != null ? li.getNetAmount() : BigDecimal.ZERO)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
                openPOValue = openPOValue.add(poTotal);
            }
        }

        // Received value from posted PO Inwards
        BigDecimal receivedValue = BigDecimal.ZERO;
        for (DocEntity d : docs.findAll("po-inward")) {
            if (!"POSTED".equals(d.getStatus()) || d.getLines() == null) continue;
            for (LineEntity li : d.getLines()) {
                if (li instanceof PoInwardLine pil) {
                    BigDecimal rate = pil.getRate() != null ? pil.getRate() : BigDecimal.ZERO;
                    BigDecimal qty = pil.getReceivedQty() != null ? pil.getReceivedQty() : BigDecimal.ZERO;
                    receivedValue = receivedValue.add(rate.multiply(qty));
                }
            }
        }

        // Invoiced spend from Purchase Invoices
        BigDecimal invoiced = BigDecimal.ZERO;
        long invoiceCount = 0;
        try {
            List<PurchaseInvoice> invoices = em.createQuery(
                            "select i from PurchaseInvoice i where i.totalAmount is not null", PurchaseInvoice.class)
                    .getResultList();
            for (PurchaseInvoice inv : invoices) {
                if (!"POSTED".equals(inv.getStatus()) && !"APPROVED".equals(inv.getStatus())) continue;
                invoiced = invoiced.add(inv.getTotalAmount());
                invoiceCount++;
            }
        } catch (Exception ignored) {}

        f.put("committedSpend", committedSpend);
        f.put("openPOValue", openPOValue);
        f.put("receivedValue", receivedValue);
        f.put("invoicedSpend", invoiced);
        f.put("invoiceCount", invoiceCount);
        f.put("unInvoicedValue", committedSpend.subtract(invoiced).max(BigDecimal.ZERO));
        f.put("spendBySupplier", sortedDesc(spendBySupplier));
        f.put("spendByItem", sortedDesc(spendByItem));
        f.put("spendByDepartment", sortedDesc(spendByDepartment));
        f.put("monthlySpend", monthlySpend.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue, (a, b) -> a, LinkedHashMap::new)));
        return f;
    }

    private List<Map<String, Object>> sortedDesc(Map<String, BigDecimal> in) {
        return in.entrySet().stream()
                .sorted((a, b) -> b.getValue().compareTo(a.getValue()))
                .limit(10)
                .map(e -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("name", e.getKey());
                    m.put("value", e.getValue());
                    return m;
                })
                .toList();
    }

    @Transactional(readOnly = true)
    private List<Map<String, Object>> recentActivity() {
        List<Map<String, Object>> out = new ArrayList<>();
        try {
            List<MasterAuditLog> logs = auditLogs.findTop200ByOrderByChangedAtDesc();
            int kept = 0;
            for (MasterAuditLog log : logs) {
                if (!ACTIVITY_ENTITY_TYPES.contains(log.getEntityType())) continue;
                if (kept >= 20) break;
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", log.getId());
                m.put("entityType", log.getEntityType());
                m.put("entityId", log.getEntityId());
                m.put("action", log.getAction());
                m.put("field", log.getFieldName());
                m.put("changedBy", log.getChangedBy());
                m.put("changedAt", log.getChangedAt() != null ? log.getChangedAt().toString() : "");
                m.put("summary", summarize(log));
                out.add(m);
                kept++;
            }
        } catch (Exception ignored) {}
        return out;
    }

    private String summarize(MasterAuditLog l) {
        String type = l.getEntityType() != null ? l.getEntityType().replaceAll("([a-z])([A-Z])", "$1 $2") : "Record";
        String verb = l.getAction() != null ? l.getAction().toLowerCase() : "updated";
        StringBuilder sb = new StringBuilder(type).append(" ").append(verb);
        if (l.getFieldName() != null) sb.append(" (").append(l.getFieldName()).append(")");
        sb.append(" by ").append(l.getChangedBy() != null ? l.getChangedBy() : "system");
        return sb.toString();
    }

    private long countByStatus(String key, String status) {
        Map<String, Object> page = docs.list(key, Map.of("status", status, "size", "1", "page", "0"));
        Object total = page.get("totalElements");
        if (total instanceof Number n) return n.longValue();
        return 0;
    }

    private long countByStatuses(String key, Set<String> statuses) {
        return docs.findAll(key).stream().filter(d -> statuses.contains(d.getStatus())).count();
    }

    private long computePartiallyReceivedPOs() {
        List<DocEntity> postedPOs = docs.findAll("purchase-order").stream()
            .filter(d -> OPEN_PO_STATUSES.contains(d.getStatus()))
            .toList();
        long count = 0;
        for (DocEntity po : postedPOs) {
            List<? extends LineEntity> poLines = po.getLines();
            if (poLines == null || poLines.isEmpty()) continue;
            boolean hasPartial = false;
            for (LineEntity poLine : poLines) {
                double poQty = poLine.getQty() != null ? poLine.getQty().doubleValue() : 0;
                if (poQty <= 0) continue;
                double received = 0;
                try {
                    var result = docs.findAll("po-inward").stream()
                        .filter(d -> "POSTED".equals(d.getStatus()))
                        .filter(d -> po.getDocNo().equals(headerStr(d, "purchaseOrderNo")))
                        .flatMap(d -> d.getLines().stream())
                        .filter(l -> poLine.getItemCode().equals(l.getItemCode()))
                        .mapToDouble(l -> l.getQty() != null ? l.getQty().doubleValue() : 0)
                        .sum();
                    received = result;
                } catch (Exception ignored) {}
                if (received > 0 && received < poQty) {
                    hasPartial = true;
                    break;
                }
            }
            if (hasPartial) count++;
        }
        return count;
    }

    private long computeDelayedPOs() {
        LocalDate today = LocalDate.now();
        return docs.findAll("purchase-order").stream()
            .filter(d -> OPEN_PO_STATUSES.contains(d.getStatus()))
            .filter(d -> {
                if (d instanceof PurchaseOrder po) {
                    return po.getExpectedDeliveryDate() != null && po.getExpectedDeliveryDate().isBefore(today);
                }
                return false;
            })
            .count();
    }

    private String headerStr(DocEntity d, String field) {
        try {
            var f = d.getClass().getDeclaredField(field);
            f.setAccessible(true);
            Object v = f.get(d);
            return v != null ? String.valueOf(v) : null;
        } catch (Exception e) { return null; }
    }

    // Purchase Module audit: an "autoCreateIqcFromInward(PoInward, String)" fallback used to live
    // here, wired to a "po-inward" case in postActionHook's approve switch above. It was dead code
    // — "po-inward" was never added to PurchaseController.ALLOWED, so that switch case could never
    // actually run through the API. The real, active IQC-auto-creation mechanism is
    // DocumentFacade.createQualityInspectionIfRequired(), which fires at po-inward create time
    // (not approve) and is independent of this service. Removed rather than left as dead code.
}
