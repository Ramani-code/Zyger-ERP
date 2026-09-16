package in.zygertechnology.zygererp.service;

import tools.jackson.databind.ObjectMapper;
import in.zygertechnology.zygererp.doc.DocTypes;
import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.LedgerRepository;
import in.zygertechnology.zygererp.repo.PartyRepository;
import in.zygertechnology.zygererp.repo.SupplierInvoiceAttachmentRepository;
import jakarta.annotation.PostConstruct;
import jakarta.persistence.EntityManager;
import jakarta.persistence.metamodel.EntityType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import in.zygertechnology.zygererp.common.Idempotent;
import in.zygertechnology.zygererp.config.BusinessRuleException;
import in.zygertechnology.zygererp.security.CurrentUserRoles;

import java.lang.reflect.Field;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class DocumentFacade {

    private static final Logger log = LoggerFactory.getLogger(DocumentFacade.class);

    @Autowired EntityManager em;
    @Autowired ObjectMapper mapper;
    @Autowired LedgerRepository ledger;
    @Lazy @Autowired StockService stockService;
    @Autowired ItemCacheService itemCache;
    @Autowired DocNumberService numbers;
    @Autowired SupplierInvoiceAttachmentRepository attachments;
    @Autowired PartyRepository parties;
    @Autowired DocumentWorkflowEngine workflowEngine;
    @Autowired BackdatedEntryGuardService backdatedEntryGuard;
    @Lazy @Autowired AttachmentService attachmentService;
    @Autowired DocLinkService docLinks;
    @Autowired in.zygertechnology.zygererp.repo.StoreMasterRepository stores;
    @Autowired in.zygertechnology.zygererp.repo.LocationRepository locations;
    @Autowired VendorLedgerService vendorLedger;
    @Autowired in.zygertechnology.zygererp.repo.PoAmendmentHistoryRepository poAmendments;
    @Autowired in.zygertechnology.zygererp.repo.PurchaseOrderScheduleRepository poSchedules;

    private final Map<String, Class<? extends DocEntity>> reg = new HashMap<>();

    @PostConstruct @SuppressWarnings("unchecked")
    void init() {
        for (EntityType<?> et : em.getMetamodel().getEntities()) {
            Class<?> c = et.getJavaType();
            DocKey k = c.getAnnotation(DocKey.class);
            if (k != null) reg.put(k.value(), (Class<? extends DocEntity>) c);
        }
    }

    private Class<? extends DocEntity> cls(String key) {
        Class<? extends DocEntity> c = reg.get(key);
        if (c == null) throw new IllegalArgumentException("Unknown document type: " + key);
        return c;
    }

    public boolean isRegistered(String key) { return reg.containsKey(key); }

    public Set<String> keys() { return reg.keySet(); }

    public DocEntity get(String key, Long id) {
        DocEntity d = em.find(cls(key), id);
        if (d == null || Boolean.TRUE.equals(d.getDeleted())) throw new IllegalArgumentException("Document not found");
        return d;
    }

    /** Persists a fully-built entity as-is — for the rare cases (e.g. Quotation
     * "revise") where a service needs to create a new document row with fields the
     * generic Map-bodied {@link #create} can't express, such as reusing an existing
     * docNo across a revision chain instead of allocating a fresh one. */
    @Transactional
    public DocEntity persistNew(DocEntity e) {
        em.persist(e);
        em.flush();
        return e;
    }

    @Transactional(readOnly = true)
    public DocEntity getByNumber(String key, String docNo) {
        String en = cls(key).getSimpleName();
        List<?> found = em.createQuery("select d from " + en + " d where d.docNo = :docNo", cls(key))
                .setParameter("docNo", docNo)
                .setMaxResults(1)
                .getResultList();
        if (found.isEmpty()) throw new IllegalArgumentException("Document not found: " + docNo);
        return (DocEntity) found.get(0);
    }

    /** Null-safe sibling of {@link #getByNumber} for best-effort lookups that must not
     * fail the caller's request when the referenced document doesn't exist (e.g. a
     * dangling/typo'd cross-reference). getByNumber is deliberately not reused here:
     * it's @Transactional, and a "not found" IllegalArgumentException thrown from an
     * @Transactional method that's PARTICIPATING in the caller's own transaction marks
     * that whole transaction rollback-only via Spring's AOP advice at the moment the
     * exception propagates through the proxy boundary — catching it afterward in the
     * caller does not undo that marking, so the caller's later commit still fails with
     * UnexpectedRollbackException even though the exception was "handled". This method
     * runs the same query without ever throwing, so no proxy-boundary exception occurs. */
    public DocEntity getByNumberOrNull(String key, String docNo) {
        try {
            String en = cls(key).getSimpleName();
            List<?> found = em.createQuery("select d from " + en + " d where d.docNo = :docNo", cls(key))
                    .setParameter("docNo", docNo)
                    .setMaxResults(1)
                    .getResultList();
            return found.isEmpty() ? null : (DocEntity) found.get(0);
        } catch (Exception ex) {
            return null;
        }
    }

    @Transactional(readOnly = true)
    public List<DocEntity> findAll(String key) {
        String en = cls(key).getSimpleName();
        return em.createQuery("select d from " + en + " d where (d.deleted is null or d.deleted = false) order by d.docDate desc, d.id desc", DocEntity.class)
                .getResultList();
    }

    @Transactional(readOnly = true)
    public long count(String key) {
        String en = cls(key).getSimpleName();
        return em.createQuery("select count(d) from " + en + " d where (d.deleted is null or d.deleted = false)", Long.class).getSingleResult();
    }

    @Transactional(readOnly = true)
    public long countAll() {
        long total = 0;
        for (String k : reg.keySet()) total += count(k);
        return total;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> toRow(DocEntity e) {
        Map<String, Object> converted = mapper.convertValue(e, LinkedHashMap.class);
        final Map<String, Object> r = converted != null ? converted : new LinkedHashMap<>();
        String dStr = e.getDocDate() == null ? "" : e.getDocDate().toString();
        r.put("date", dStr);
        r.put("docDate", dStr);
        r.putIfAbsent("orderDate", dStr);
        r.putIfAbsent("piDate", dStr);
        r.putIfAbsent("dcDate", dStr);
        r.putIfAbsent("invoiceDate", dStr);
        r.putIfAbsent("returnDate", dStr);
        if (r.get("notes") != null && r.get("remarks") == null) r.put("remarks", r.get("notes"));
        if (r.get("remarks") != null && r.get("notes") == null) r.put("notes", r.get("remarks"));
        r.put("id", e.getId());
        List<? extends LineEntity> L = e.getLines();
        r.put("qty", L.stream().mapToDouble(l -> l.getQty().doubleValue()).sum());
        double totalAmt = L.stream()
                .mapToDouble(l -> (l.getRate() == null ? 0 : l.getRate().doubleValue()) * l.getQty().doubleValue()).sum();
        r.put("totalAmount", totalAmt);

        double calcTaxAmt = L.stream()
                .mapToDouble(l -> l.getTaxAmount() != null ? l.getTaxAmount().doubleValue() : 0.0).sum();
        double calcNetAmt = L.stream()
                .mapToDouble(l -> {
                    if (l.getNetAmount() != null) return l.getNetAmount().doubleValue();
                    double lineAmt = (l.getRate() == null ? 0.0 : l.getRate().doubleValue()) * l.getQty().doubleValue();
                    double taxAmt = l.getTaxAmount() != null ? l.getTaxAmount().doubleValue() : 0.0;
                    return lineAmt + taxAmt;
                }).sum();

        if (r.get("taxAmount") == null || ((Number) r.get("taxAmount")).doubleValue() == 0.0) {
            r.put("taxAmount", calcTaxAmt);
        }
        if (r.get("netAmount") == null || ((Number) r.get("netAmount")).doubleValue() == 0.0) {
            r.put("netAmount", calcNetAmt > 0 ? calcNetAmt : totalAmt);
        }

        List<Map<String, Object>> lineRows = new ArrayList<>();
        for (LineEntity l : L) {
            Map<String, Object> lm = mapper.convertValue(l, LinkedHashMap.class);
            if (lm == null) lm = new LinkedHashMap<>();
            lm.remove("doc");
            lm.put("itemDesc", itemCache.findByCode(l.getItemCode())
                    .map(ItemMaster::getDescription).orElse(""));
            lineRows.add(lm);
        }
        r.put("lines", lineRows);
        if (!L.isEmpty()) {
            LineEntity first = L.get(0);
            r.putIfAbsent("firstItemCode", first.getItemCode());
            itemCache.findByCode(first.getItemCode())
                    .ifPresent(i -> r.putIfAbsent("firstItemName", i.getDescription()));
        }
        r.putIfAbsent("itemCode", r.get("firstItemCode"));
        r.putIfAbsent("itemName", r.get("firstItemName"));
        r.putIfAbsent("reference", firstOf(r,
                "purchaseOrderNo", "jobOrderNo", "labourOrderNo", "issueRequestNo",
                "allotmentNo", "originalDocumentNo", "linkedDocumentNo", "challanNo",
                "supplierInvoiceNo", "referenceNo", "originalReceiptNo"));
        r.putIfAbsent("party", firstOf(r,
                "supplier", "vendor", "customer", "party", "toParty",
                "supplierName", "vendorName", "customerName", "partyName"));
        if (e instanceof SupplierEnquiry se) {
            String supp = se.getSupplier();
            String code = se.getSupplierCode();
            String cp = se.getContactPerson();
            String ph = se.getPhone();
            String emStr = se.getEmail();

            if (se.getSuppliers() != null && !se.getSuppliers().isEmpty()) {
                SupplierEnquirySupplier first = se.getSuppliers().get(0);
                if (supp == null || supp.isBlank()) supp = first.getSupplierName();
                if (code == null || code.isBlank()) code = first.getSupplierCode();
                if (cp == null || cp.isBlank()) cp = first.getContactPerson();
                if (ph == null || ph.isBlank()) ph = first.getPhone();
                if (emStr == null || emStr.isBlank()) emStr = first.getEmail();
            }

            if ((cp == null || cp.isBlank() || ph == null || ph.isBlank() || emStr == null || emStr.isBlank()) && supp != null && !supp.isBlank()) {
                Optional<Party> pOpt = parties.findByName(supp);
                if (pOpt.isPresent()) {
                    Party p = pOpt.get();
                    if (code == null || code.isBlank()) code = p.getCode();
                    if (cp == null || cp.isBlank()) cp = p.getContactPerson();
                    if (ph == null || ph.isBlank()) ph = p.getPhone() != null ? p.getPhone() : p.getMobile();
                    if (emStr == null || emStr.isBlank()) emStr = p.getEmail();
                }
            }

            if (supp != null) r.put("supplier", supp);
            if (code != null) r.put("supplierCode", code);
            if (cp != null) r.put("contactPerson", cp);
            if (ph != null) r.put("phone", ph);
            if (emStr != null) r.put("email", emStr);
        }
        if (e instanceof PurchaseOrder po) {
            String supp = po.getSupplier();
            String code = po.getSupplierCode();
            String cp = po.getContactPerson();
            String ph = po.getPhone();
            String emStr = po.getEmail();

            if ((cp == null || cp.isBlank() || ph == null || ph.isBlank() || emStr == null || emStr.isBlank()) && supp != null && !supp.isBlank()) {
                Optional<Party> pOpt = parties.findByName(supp);
                if (pOpt.isPresent()) {
                    Party p = pOpt.get();
                    if (code == null || code.isBlank()) code = p.getCode();
                    if (cp == null || cp.isBlank()) cp = p.getContactPerson();
                    if (ph == null || ph.isBlank()) ph = p.getPhone() != null ? p.getPhone() : p.getMobile();
                    if (emStr == null || emStr.isBlank()) emStr = p.getEmail();
                }
            }

            if (supp != null) r.put("supplier", supp);
            if (code != null) r.put("supplierCode", code);
            if (cp != null) r.put("contactPerson", cp);
            if (ph != null) r.put("phone", ph);
            if (emStr != null) r.put("email", emStr);
        }
        if (e instanceof SalesInvoice si) {
            // GST tax-invoice template shows the buyer's contact person / phone /
            // email on the Billed-To panel — pulled from the customer master.
            String cust = si.getCustomer();
            String code = si.getCustomerCode();
            Optional<Party> pOpt = code != null && !code.isBlank() ? parties.findByCode(code) : Optional.empty();
            if (pOpt.isEmpty() && cust != null && !cust.isBlank()) pOpt = parties.findByName(cust);
            if (pOpt.isPresent()) {
                Party p = pOpt.get();
                r.putIfAbsent("contactPerson", p.getContactPerson() == null ? "" : p.getContactPerson());
                r.putIfAbsent("phone", p.getPhone() != null ? p.getPhone() : p.getMobile());
                r.putIfAbsent("email", p.getEmail());
            } else {
                r.putIfAbsent("contactPerson", "");
                r.putIfAbsent("phone", "");
                r.putIfAbsent("email", "");
            }
        }
        denormalizeLines(r, findKeyForEntity(e));

        // Enrich with workflow allowed transitions
        if (e.getStatus() != null) {
            String docKey = findKeyForEntity(e);
            String upperDocKey = docKey.toUpperCase().replace("-", "_");
            workflowEngine.enrich(upperDocKey, e.getStatus(), r);
        }

        return r;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getRow(String key, Long id) {
        Map<String, Object> row = toRow(get(key, id));
        if ("purchase-invoice".equals(key) || "subcontract-invoice".equals(key)) {
            row.put("attachments", attachmentsMeta(key, id));
        }
        return row;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> list(String key, Map<String, String> q) {
        List<Map<String, Object>> rows = findAll(key).stream()
                .map(this::toRow).collect(Collectors.toList());
        return paginate(rows, q);
    }

    // ---------- Attachments (supplier invoices, max 3) ----------

    public static final int MAX_ATTACHMENTS = 3;

    public record AttachmentInfo(Long id, String name, byte[] data) {}

    private void supportsAttachments(String key) {
        if (!"purchase-invoice".equals(key) && !"subcontract-invoice".equals(key))
            throw new IllegalArgumentException("Attachments not supported for " + key);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> attachmentsMeta(String key, Long id) {
        supportsAttachments(key);
        return attachments.findByDocTypeAndDocIdOrderByIdAsc(key, id).stream()
                .map(a -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", a.getId());
                    m.put("fileName", a.getFileName());
                    return m;
                })
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public AttachmentInfo attachment(String key, Long docId, Long attachmentId) {
        supportsAttachments(key);
        SupplierInvoiceAttachment a = attachments
                .findByIdAndDocTypeAndDocId(attachmentId, key, docId)
                .orElseThrow(() -> new IllegalArgumentException("Attachment not found"));
        return new AttachmentInfo(a.getId(), a.getFileName(), a.getData());
    }

    @Transactional
    public void addAttachment(String key, Long docId, String name, byte[] data) {
        supportsAttachments(key);
        get(key, docId);
        long count = attachments.countByDocTypeAndDocId(key, docId);
        if (count >= MAX_ATTACHMENTS)
            throw new IllegalArgumentException("Maximum " + MAX_ATTACHMENTS + " attachments allowed");
        SupplierInvoiceAttachment a = new SupplierInvoiceAttachment();
        a.setDocType(key);
        a.setDocId(docId);
        a.setFileName(name);
        a.setData(data);
        a.setUploadedAt(Instant.now());
        attachments.save(a);
        get(key, docId).setUpdatedAt(Instant.now());
    }

    @Transactional
    public void removeAttachment(String key, Long docId, Long attachmentId) {
        supportsAttachments(key);
        SupplierInvoiceAttachment a = attachments
                .findByIdAndDocTypeAndDocId(attachmentId, key, docId)
                .orElseThrow(() -> new IllegalArgumentException("Attachment not found"));
        attachments.delete(a);
        get(key, docId).setUpdatedAt(Instant.now());
    }

    public Map<String, Object> paginate(List<Map<String, Object>> rows, Map<String, String> q) {
        String st = q.get("status");
        if (st != null && !st.isEmpty())
            rows = rows.stream().filter(r -> st.equals(r.get("status")) || st.equals(r.get("inspectionStatus")) || st.equals(r.get("capaStatus")) || st.equals(r.get("reportStatus")) || st.equals(r.get("complaintStatus"))).collect(Collectors.toList());
        String it = q.get("inspectionType");
        if (it == null || it.isEmpty()) it = q.get("type");
        if (it != null && !it.isEmpty()) {
            final String targetType = it;
            rows = rows.stream().filter(r -> targetType.equalsIgnoreCase(String.valueOf(r.get("inspectionType"))) || targetType.equalsIgnoreCase(String.valueOf(r.get("type"))) || targetType.equalsIgnoreCase(String.valueOf(r.get("certificateType")))).collect(Collectors.toList());
        }
        String item = q.get("itemCode");
        if (item != null && !item.isEmpty()) {
            final String targetItem = item;
            rows = rows.stream().filter(r -> targetItem.equalsIgnoreCase(String.valueOf(r.get("itemCode")))).collect(Collectors.toList());
        }
        String s = q.get("search");
        if (s != null && !s.isEmpty()) {
            String lo = s.toLowerCase();
            rows = rows.stream().filter(r -> String.valueOf(r).toLowerCase().contains(lo)).collect(Collectors.toList());
        }
        int size = q.get("size") == null ? 8 : Integer.parseInt(q.get("size"));
        int pg   = q.get("page") == null ? 0 : Integer.parseInt(q.get("page"));
        int total = rows.size();
        int pages = Math.max(1, (int) Math.ceil((double) total / size));
        int from = Math.min(pg * size, total), to = Math.min(from + size, total);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("content", rows.subList(from, to));
        out.put("totalElements", total);
        out.put("totalPages", pages);
        out.put("number", pg);
        out.put("size", size);
        return out;
    }

    public String nextNumber(String key) { return numbers.next(key); }

    public String nextNumber(String key, String prefix) { return numbers.next(key, prefix); }

    /** Read-only preview of the next number — does NOT consume the sequence. */
    public String peekNumber(String key) { return numbers.peek(key); }

    /** Read-only preview of the next number — does NOT consume the sequence. */
    public String peekNumber(String key, String prefix) { return numbers.peek(key, prefix); }

    /** Allocates the next number (advances the sequence) — use on Save/Draft. */
    public String allocateNumber(String key) { return numbers.allocate(key); }

    /** FY-format preview (PREFIX/FY/00001). Does NOT consume the sequence. */
    public String peekNumberFy(String prefix) { return numbers.peekFy(prefix); }

    /** FY-format allocation (PREFIX/FY/00001). Consumes the sequence. */
    public String nextNumberFy(String prefix) { return numbers.nextFy(prefix); }

    // --- Line field normalization: frontend key → backend entity field ---
    private static final Map<String, Map<String, String>> LINE_RENAME = Map.of(
        "sales-order", Map.of(
            "qty", "orderQty",
            "taxCode", "tax",
            "revisionLevel", "drawingRevision",
            "targetDeliveryDate", "requiredDeliveryDate"
        ),
        "proforma-invoice", Map.of(
            "taxCode", "tax",
            "lineRemark", "remarks"
        ),
        "sales-dc", Map.of(
            "dispatchQty", "currentDispatchQty",
            "heatNumber", "heatNo",
            "lineRemark", "remarks"
        ),
        "sales-invoice", Map.of(
            "billedQty", "qty",
            "taxCode", "tax"
        ),
        "po-inward", Map.of("qty", "receivedQty"),
        "lo-inward", Map.of("qty", "receivedQty"),
        "jo-inward", Map.of("qty", "producedQty"),
        "general-inward", Map.of("qty", "receivedQty"),
        "dc-return", Map.of(
            "batchNumber", "batchNo",
            "heatNumber", "heatNo",
            "lineRemark", "remarks",
            "disposition", "materialCondition",
            "returnedQty", "currentReturnQty"
        ),
        "invoice-return", Map.of(
            "batchNumber", "batchNo",
            "heatNumber", "heatNo",
            "lineRemark", "remarks",
            "disposition", "materialCondition",
            "returnedQty", "currentReturnQty"
        )
    );

    @SuppressWarnings("unchecked")
    private void normalizeLines(Map<String, Object> body, String key) {
        Object linesObj = body.get("lines");
        if (!(linesObj instanceof List)) return;
        List<Map<String, Object>> lines = (List<Map<String, Object>>) linesObj;
        Map<String, String> renames = LINE_RENAME.getOrDefault(key, Map.of());
        for (Map<String, Object> line : lines) {
            if ("sales-invoice".equals(key) && line.containsKey("batchHeatNumber")) {
                Object bhn = line.remove("batchHeatNumber");
                if (bhn != null && !String.valueOf(bhn).isEmpty()) {
                    String[] parts = String.valueOf(bhn).split("/", 2);
                    line.put("batchNo", parts[0].trim());
                    if (parts.length > 1 && !parts[1].trim().isEmpty())
                        line.put("heatNo", parts[1].trim());
                }
            }
            for (Map.Entry<String, String> e : renames.entrySet()) {
                if (line.containsKey(e.getKey())) {
                    Object val = line.remove(e.getKey());
                    if ("tax".equals(e.getValue()) && val instanceof String s) {
                        val = parseTaxRate(s);
                    }
                    line.put(e.getValue(), val);
                }
            }
        }
    }

    private BigDecimal parseTaxRate(String taxCode) {
        if (taxCode == null || taxCode.isEmpty() || "Exempt".equalsIgnoreCase(taxCode))
            return BigDecimal.ZERO;
        String num = taxCode.replaceAll("[^0-9.]", "");
        if (num.isEmpty()) return BigDecimal.ZERO;
        try { return new BigDecimal(num); } catch (Exception e) { return BigDecimal.ZERO; }
    }

    /**
     * Line-bearing transaction/order documents must carry at least one line with
     * a positive quantity. Empty or all-zero payloads are rejected up-front so the
     * database is never seeded with meaningless DRAFT documents. Scoped to the
     * stock-effect and order doc types where an empty payload is always a defect;
     * content-driven docs (quality records, master data) are left untouched.
     */
    // Inward Entry's "Update Inventory" button (InwardForm.tsx) posts a freshly-created DRAFT
    // document directly (skipping Submit/Approve) whenever QC isn't required, for all four
    // inward types alike. Only "po-inward" was ever exempted from the generic APPROVED-before-
    // post guard below, so LO/JO/General Inward's identical "Update Inventory" path always
    // threw "Action not allowed in status DRAFT" — fixed by exempting all four consistently.
    private static final Set<String> DIRECT_POST_INWARD_KEYS = Set.of(
            "po-inward", "lo-inward", "jo-inward", "general-inward", "inward");

    // DC Module FRS v1.0 §6/§7: a Delivery Challan is saved straight to Confirmed and posts its
    // stock movement on the same "Save & Post Stock" action, without a separate Submit/Approve
    // step. So the three DC types are exempt from the generic APPROVED-before-post guard.
    private static final Set<String> DIRECT_POST_DC_KEYS = Set.of(
            "jo-dc", "general-dc", "transfer-dc");

    private static final Set<String> REQUIRED_LINES_KEYS = Set.of(
            // Inventory (Effect IN/OUT/ADJUST)
            "po-inward", "lo-inward", "jo-inward", "general-inward", "return-inward", "grn",
            "rm-issue", "general-issue", "jo-dc-issue", "issue-internal-external",
            "issue-against-receipt", "sales-dc", "jo-dc", "general-dc", "return-dc",
            "transfer-dc", "dc-return", "invoice-return", "inward-return", "stock-return",
            "received-against-issue", "receipt-return", "stock-allotment", "stock-release",
            "stock-issue-request", "physical-stock-amendment", "subcontract-invoice",
            // Purchase
            "purchase-request", "supplier-enquiry", "supplier-quotation", "purchase-order", "job-order",
            // Purchase Module audit: purchase-return was the only Purchase doc type not covered
            // here, so a zero-line return could reach POSTED with the over-return guard (which
            // only iterates existing lines) never actually running.
            "purchase-return",
            // Sales
            "sales-order", "proforma-invoice", "sales-invoice"
    );

    /**
     * Purchase/sales transaction docs whose party or item references are resolvable
     * are blocked from APPROVAL when the document carries no party or references
     * non-existent items. A permissive DRAFT create is allowed (capture-in-progress),
     * but an approved document must be referentially sound before it can drive
     * downstream stock/ledger effects.
     */
    private static final Set<String> APPROVAL_REFERENCE_KEYS = Set.of(
            "purchase-order", "job-order", "sales-order", "sales-dc", "sales-invoice"
    );

    private String partyFieldOf(DocEntity e) {
        for (String f : List.of("supplier", "customer")) {
            try {
                Field field = e.getClass().getDeclaredField(f);
                field.setAccessible(true);
                Object v = field.get(e);
                if (v instanceof String s && !s.isBlank()) return s;
            } catch (Exception ignored) {}
        }
        return null;
    }

    private void validateApprovalReferences(String key, DocEntity e) {
        if (!APPROVAL_REFERENCE_KEYS.contains(key)) return;
        String party = partyFieldOf(e);
        if (party == null) {
            throw new BusinessRuleException("APPROVAL_BLOCKED_MISSING_PARTY",
                    "Cannot approve " + key + ": document has no supplier/customer reference.",
                    Map.of("docKey", key, "docId", e.getId()));
        }
        if (e.getLines() != null) {
            for (LineEntity le : e.getLines()) {
                String code = le instanceof BaseLine bl ? bl.getItemCode() : null;
                if (code == null || code.isBlank()
                        || itemCache.findByCode(code).isEmpty()) {
                    throw new BusinessRuleException("APPROVAL_BLOCKED_UNKNOWN_ITEM",
                            "Cannot approve " + key + ": line references unknown item '" + code + "'.",
                            Map.of("docKey", key, "docId", e.getId(), "itemCode", code == null ? "" : code));
                }
            }
        }
    }

    private void validateLineQtyAndPresence(String key, DocEntity e, Map<String, Object> body) {
        if (!REQUIRED_LINES_KEYS.contains(key)) return;
        List<?> lines = e.getLines();
        if (lines == null || lines.isEmpty()) {
            throw new IllegalArgumentException("Document type '" + key + "' requires at least one line");
        }
        DocTypes.DocDef def = DocTypes.get(key);
        String qtyField = def.qtyField();
        for (Object line : lines) {
            if (!(line instanceof LineEntity le)) continue;
            BigDecimal qty = qtyField != null && !qtyField.isBlank() ? lineQty(le, qtyField) : le.getQty();
            if (qty == null || qty.signum() <= 0) {
                throw new IllegalArgumentException("Document type '" + key + "' requires a positive line quantity");
            }
        }
    }

    /**
     * FRS requirement: only the Accepted Qty of an Inward line ever reaches stock — the
     * Received Qty is just what physically arrived. Accepted Qty is mandatory (no default,
     * the receiving clerk must state it explicitly) and can't exceed what was received;
     * whatever isn't accepted is recorded on the line's own Rejected Qty/Reason but never
     * posted to the ledger at all. See collectLines(), which reads acceptedQty instead of
     * the received/produced qty for these doc types when building the stock-in movement.
     */
    private void validateInwardAcceptedQty(String key, DocEntity e) {
        if (!DIRECT_POST_INWARD_KEYS.contains(key)) return;
        List<?> lines = e.getLines();
        if (lines == null) return;
        for (Object line : lines) {
            if (!(line instanceof LineEntity le)) continue;
            BigDecimal received = le.getQty();
            BigDecimal accepted = le.getAcceptedQty();
            if (accepted == null) {
                throw new IllegalArgumentException(
                        "Accepted Qty is mandatory for item " + le.getItemCode() + " on an Inward Entry line");
            }
            if (accepted.signum() < 0) {
                throw new IllegalArgumentException(
                        "Accepted Qty cannot be negative for item " + le.getItemCode());
            }
            if (received != null && accepted.compareTo(received) > 0) {
                throw new IllegalArgumentException(
                        "Accepted Qty (" + accepted + ") cannot exceed Received Qty (" + received
                                + ") for item " + le.getItemCode());
            }
        }
    }

    private BigDecimal lineQty(LineEntity l, String qtyField) {
        try {
            java.lang.reflect.Method m = l.getClass().getMethod("get" + Character.toUpperCase(qtyField.charAt(0)) + qtyField.substring(1));
            Object v = m.invoke(l);
            return v instanceof BigDecimal bd ? bd : v instanceof Number n ? BigDecimal.valueOf(n.doubleValue()) : null;
        } catch (Exception e) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private void denormalizeLines(Map<String, Object> row, String key) {
        Object linesObj = row.get("lines");
        if (!(linesObj instanceof List)) return;
        List<Map<String, Object>> lines = (List<Map<String, Object>>) linesObj;
        Map<String, String> renames = LINE_RENAME.getOrDefault(key, Map.of());
        for (Map.Entry<String, String> e : renames.entrySet()) {
            for (Map<String, Object> line : lines) {
                if (line.containsKey(e.getValue())) {
                    Object val = line.remove(e.getValue());
                    if ("tax".equals(e.getValue()) && val != null) {
                        try {
                            double rate = Double.parseDouble(String.valueOf(val));
                            val = rate == 0 ? "Exempt" : "GST " + (int) rate + "%";
                        } catch (Exception ignored) {}
                    }
                    line.put(e.getKey(), val);
                }
            }
        }
        if ("sales-invoice".equals(key)) {
            for (Map<String, Object> line : lines) {
                String batchNo = line.containsKey("batchNo") ? String.valueOf(line.get("batchNo")) : "";
                String heatNo = line.containsKey("heatNo") ? String.valueOf(line.get("heatNo")) : "";
                line.remove("batchNo");
                line.remove("heatNo");
                String combined = "";
                if (!batchNo.isEmpty() && !"null".equals(batchNo)) combined = batchNo;
                if (!heatNo.isEmpty() && !"null".equals(heatNo)) {
                    combined = combined.isEmpty() ? heatNo : combined + "/" + heatNo;
                }
                line.put("batchHeatNumber", combined);
            }
        }
    }

    @Transactional
    @Idempotent
    public DocEntity create(String key, Map<String, Object> body, String user) {
        normalizeLines(body, key);
        DocEntity e = mapper.convertValue(body, cls(key));
        if (e.getLines() != null) {
            for (LineEntity l : e.getLines()) {
                if (l instanceof BaseLine bl) bl.setId(null);
                if (l instanceof SalesDcLine sdl && sdl.getPackingDetails() != null) {
                    for (SalesDcPackingDetail pd : sdl.getPackingDetails()) pd.setId(null);
                }
            }
        }
        e.setStatus("DRAFT");
        e.setDocDate(parse(body.get("date")));
        e.setCreatedBy(user);
        e.setCreatedAt(Instant.now());
        e.setUpdatedAt(Instant.now());
        attach(e);

        validateLineQtyAndPresence(key, e, body);
        validateInwardAcceptedQty(key, e);
        validateDcStockAvailability(key, e);
        validateGeneralDcGstin(key, e);
        validateReturnEligibility(key, e);
        validateReceivedAgainstIssue(key, e);
        validateBatchHeat(key, e);
        validatePoInward(key, e);
        validateDuplicateInwardChallan(key, e);
        validateAmendmentReason(key, e);
        validateReleaseBalance(key, e);
        validateGeneralInwardReason(key, e);
        validateRmIssueSir(key, e);
        validateGrn(key, e);

        // §9.3: Backdated-entry authorization guard
        String docDateStr = body.get("date") != null ? String.valueOf(body.get("date")) : null;
        Object overrideReasonObj = body.get("backdatedOverrideReason");
        backdatedEntryGuard.enforce(docDateStr, user, overrideReasonObj != null ? String.valueOf(overrideReasonObj) : null);

        String docNo = nextUnusedNumber(key, body);
        e.setDocNo(docNo);
        em.persist(e);
        em.flush();
        recordDocLinks(key, e, user);
        return e;
    }

    private String nextUnusedNumber(String key, Map<String, Object> body) {
        String docNo = nextNumberFor(key, body);
        int maxAttempts = 100;
        while (existsByDocNo(key, docNo) && maxAttempts-- > 0) {
            docNo = nextNumberFor(key, body);
        }
        return docNo;
    }

    private boolean existsByDocNo(String key, String docNo) {
        if (docNo == null || docNo.isBlank()) return false;
        try {
            String en = cls(key).getSimpleName();
            Long count = em.createQuery("select count(d) from " + en + " d where d.docNo = :docNo", Long.class)
                    .setParameter("docNo", docNo)
                    .getSingleResult();
            return count > 0;
        } catch (Exception e) {
            return false;
        }
    }

    private static final Set<String> QC_INWARD_KEYS = Set.of(
            "po-inward", "lo-inward", "jo-inward", "general-inward", "grn");

    /**
     * Inward → QC deferral: inspections are no longer auto-created when the inward is
     * saved. A QC-required receipt just holds stock in QC_HOLD at post time; the Quality
     * Inspection (with its IQC/LO/JOMIN number) is created on demand when an operator
     * clicks Process in the Inspection Pending queue. See {@link #createInspectionsFromInward}.
     */
    private boolean qcRequired(DocEntity e) {
        try {
            Field f = e.getClass().getDeclaredField("qcRequired");
            f.setAccessible(true);
            Object v = f.get(e);
            return v != null && (
                "Yes".equalsIgnoreCase(String.valueOf(v)) ||
                "true".equalsIgnoreCase(String.valueOf(v)) ||
                "1".equals(String.valueOf(v)));
        } catch (Exception ignored) {
            return false;
        }
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> awaitingQcDocRows(String key) {
        List<Map<String, Object>> rows = new ArrayList<>();
        if (!QC_INWARD_KEYS.contains(key)) return rows;
        for (DocEntity d : findAll(key)) {
            if (d.getId() == null
                    || !qcRequired(d)
                    || !"POSTED".equals(d.getStatus())) {
                continue;
            }
            Long cnt = em.createQuery(
                    "SELECT count(q) FROM QualityInspection q WHERE q.sourceType = :st AND q.sourceId = :sid", Long.class)
                    .setParameter("st", key)
                    .setParameter("sid", d.getId().toString())
                    .getSingleResult();
            if (cnt > 0) continue;

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", null);
            row.put("inspectionId", null);
            row.put("inspectionNumber", d.getDocNo());
            row.put("docNo", d.getDocNo());
            row.put("inspectionType", resolveInspectionType(key).name());
            row.put("pendingFromInward", true);
            row.put("sourceDocKey", key);
            row.put("sourceDocId", d.getId());
            row.put("sourceType", key);
            row.put("sourceNumber", d.getDocNo());
            row.put("itemDescription", "");
            row.put("receivedQuantity", 0);
            List<? extends LineEntity> lines = d.getLines();
            if (lines != null && !lines.isEmpty()) {
                LineEntity l0 = lines.get(0);
                row.put("itemCode", l0.getItemCode());
                if (l0.getItemDesc() != null && !l0.getItemDesc().isBlank()) {
                    row.put("itemDescription", l0.getItemDesc());
                }
                row.put("receivedQuantity", inwardAcceptedQtySum(lines, key));
            }
            row.put("inspectionStatus", "AWAITING_QC");
            row.put("decisionStatus", "PENDING");
            row.put("priority", "Normal");
            row.put("isLocked", false);
            row.put("createdAt", d.getCreatedAt() != null ? d.getCreatedAt().toString() : null);
            rows.add(row);
        }
        return rows;
    }

    private BigDecimal inwardAcceptedQtySum(List<? extends LineEntity> lines, String key) {
        BigDecimal sum = BigDecimal.ZERO;
        for (LineEntity line : lines) {
            BigDecimal qty = DIRECT_POST_INWARD_KEYS.contains(key) && line.getAcceptedQty() != null
                    ? line.getAcceptedQty()
                    : (line.getQty() != null ? line.getQty() : BigDecimal.ONE);
            sum = sum.add(qty);
        }
        return sum;
    }

    /**
     * Creates the Quality Inspection(s) for a QC-required inward document on demand —
     * called by the Inspection Pending queue's Process action. One inspection per line
     * (item/batch/heat/qty), each with its number allocated here (e.g. IQC-2026-00XX).
     * Idempotent: if inspections already exist for the source document it returns those
     * instead of creating duplicates.
     */
    @Transactional
    public List<Long> createInspectionsFromInward(String key, Long id, String user) {
        if (!QC_INWARD_KEYS.contains(key)) {
            throw new IllegalArgumentException("Not an inward source: " + key);
        }
        DocEntity e = get(key, id);
        if (!qcRequired(e)) {
            throw new IllegalStateException("Document " + e.getDocNo() + " does not require Quality Inspection");
        }

        List<Long> existing = em.createQuery(
                "SELECT q.id FROM QualityInspection q WHERE q.sourceType = :st AND q.sourceId = :sid ORDER BY q.id", Long.class)
                .setParameter("st", key)
                .setParameter("sid", id.toString())
                .getResultList();
        if (!existing.isEmpty()) return existing;

        List<? extends LineEntity> lines = e.getLines();
        if (lines == null || lines.isEmpty()) {
            throw new IllegalStateException("Inward document " + e.getDocNo() + " has no lines");
        }

        List<Long> created = new ArrayList<>();
        for (LineEntity line : lines) {
            QualityInspection qi = buildInspectionForLine(e, key, line, user);
            em.persist(qi);
            em.flush();
            created.add(qi.getId());
        }
        return created;
    }

    private QualityInspection buildInspectionForLine(DocEntity e, String key, LineEntity line, String user) {
        QualityInspection qi = new QualityInspection();
        QualityInspectionType inspectionType = resolveInspectionType(key);
        String prefix = QualityInspectionService.prefixForType(inspectionType);
        String qiDocNo = numbers.next(QualityInspectionService.KEY, prefix);
        qi.setDocNo(qiDocNo);
        qi.setInspectionNumber(qiDocNo);
        qi.setInspectionType(inspectionType);
        // Inward Entry FRD v2.0 §3.2/§6.3 (G1): sourceType must be the specific inward doc
        // key, not a generic "INWARD" — releaseHeldStockToStore()/applyDispositionStock() on
        // accept/reject key their QC_HOLD lookup on this inspection's own item/batch/heat, and
        // several other lookups (resolveSupplier, close-cascade) switch on sourceType by key.
        qi.setSourceType(key);
        if (e.getId() != null) qi.setSourceId(e.getId().toString());
        qi.setSourceNumber(e.getDocNo());
        qi.setBatchNumber(line.getBatchNo());
        qi.setHeatNumber(line.getHeatNo());
        qi.setDocDate(e.getDocDate() != null ? e.getDocDate() : LocalDate.now());
        qi.setInspectionDate(e.getDocDate() != null ? e.getDocDate() : LocalDate.now());
        qi.setInspectionStatus("DRAFT");
        qi.setDecisionStatus("PENDING");
        qi.setCreatedBy(user);
        qi.setCreatedAt(Instant.now());
        qi.setUpdatedAt(Instant.now());

        // getItemCode()/getItemDesc()/getQty() are LineEntity interface methods, present on
        // every line type (PoInwardLine.getQty() aliases its own receivedQty column).
        String itemCode = line.getItemCode();
        String itemDesc = line.getItemDesc();
        if (itemDesc == null || itemDesc.isBlank()) {
            try {
                Field fName = line.getClass().getDeclaredField("itemName");
                fName.setAccessible(true);
                itemDesc = (String) fName.get(line);
            } catch (Exception ignored) {}
        }
        // Only the Accepted Qty ever lands in QC_HOLD (see collectLines()), so the
        // inspection's Received/Inspection Qty must match that, not the raw Received Qty.
        BigDecimal qty = DIRECT_POST_INWARD_KEYS.contains(key) && line.getAcceptedQty() != null
                ? line.getAcceptedQty()
                : (line.getQty() != null ? line.getQty() : BigDecimal.ONE);

        try {
            Field fPoNo = e.getClass().getDeclaredField("purchaseOrderNo");
            fPoNo.setAccessible(true);
            qi.setPurchaseOrderNumber((String) fPoNo.get(e));
        } catch (Exception ignored) {}

        String lineLoc = line.getLocation();
        if (lineLoc == null || lineLoc.isBlank()) {
            lineLoc = firstNonEmpty(headerStr(e, "sourceLocation"), headerStr(e, "storeLocation"));
        }
        if (lineLoc != null && !lineLoc.isBlank()) {
            qi.setLocation(lineLoc);
        }

        qi.setItemCode(itemCode != null && !itemCode.isBlank() ? itemCode : "ITEM-001");
        qi.setItemDescription(itemDesc != null ? itemDesc : "");
        qi.setReceivedQuantity(qty);
        qi.setInspectionQuantity(qty);
        return qi;
    }

    private QualityInspectionType resolveInspectionType(String sourceKey) {
        return switch (sourceKey) {
            case "po-inward", "grn" -> QualityInspectionType.IQC;
            case "lo-inward" -> QualityInspectionType.LO;
            case "jo-inward" -> QualityInspectionType.JOMIN;
            case "general-inward" -> QualityInspectionType.IQC;
            default -> QualityInspectionType.IQC;
        };
    }

    private static String rootMessage(Throwable t) {
        Throwable root = t;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        return root.getMessage() == null ? "" : root.getMessage();
    }

    private String nextNumberFor(String key, Map<String, Object> body) {
        if ("issue-internal-external".equals(key)) {
            String prefix = "INTERNAL".equalsIgnoreCase(strVal(body.get("issueType"))) ? "ISI" : "EXT";
            return numbers.next(key, prefix);
        }
        if ("credit-debit-note".equals(key)) {
            String prefix = "DEBIT".equalsIgnoreCase(strVal(body.get("noteType"))) ? "DN" : "CN";
            return numbers.next(key, prefix);
        }
        return numbers.next(key);
    }

    private String strVal(Object v) {
        return v == null ? "" : String.valueOf(v);
    }

    private boolean boolVal(Object v) {
        return v != null && ("true".equalsIgnoreCase(String.valueOf(v))
                || "1".equals(String.valueOf(v)) || "yes".equalsIgnoreCase(String.valueOf(v)));
    }

    @Transactional
    public DocEntity update(String key, Long id, Map<String, Object> body, String user) {
        DocEntity old = get(key, id);
        // Some doc types (e.g. quality-inspection) track their workflow via their own status
        // field (inspectionStatus) and never populate this generic one, leaving it permanently
        // null — List.of(...).contains(null) would NPE, so a null status is treated as editable
        // rather than blocked, since the generic engine never marked it as an immutable state.
        if (!Set.of("purchase-request", "supplier-enquiry", "supplier-quotation", "purchase-order").contains(key)
                && old.getStatus() != null && !List.of("DRAFT", "REJECTED").contains(old.getStatus()))
            throw new IllegalStateException("Only DRAFT/REJECTED documents can be edited");

        if (body.containsKey("version") && body.get("version") != null) {
            Long incomingVersion = Long.valueOf(body.get("version").toString());
            if (old.getVersion() != null && !Objects.equals(old.getVersion(), incomingVersion)) {
                throw new jakarta.persistence.OptimisticLockException(
                    "Document " + old.getDocNo() + " version mismatch (expected " + old.getVersion() + " but received " + incomingVersion + "). Concurrent modification detected."
                );
            }
        }

        DocTypes.DocDef def = DocTypes.get(key);

        normalizeLines(body, key);
        DocEntity incoming = mapper.convertValue(body, cls(key));
        Integer poNextRevision = null;
        if ("purchase-order".equals(key) && !List.of("DRAFT", "REJECTED").contains(old.getStatus())) {
            // Must snapshot + compute before copyFields overwrites `old`'s fields with `incoming`'s
            // (which, for a client PUT that never sent revisionNumber, would otherwise reset it).
            poNextRevision = recordPoAmendment((PurchaseOrder) old, (PurchaseOrder) incoming, user);
        }
        copyFields(old, incoming);
        if (poNextRevision != null) {
            ((PurchaseOrder) old).setRevisionNumber(poNextRevision);
            ((PurchaseOrder) old).setLastAmendedAt(Instant.now());
        }

        if (def.hasLines() && incoming.getLines() != null) {
            @SuppressWarnings("unchecked")
            List<LineEntity> managed = (List<LineEntity>) old.getLines();
            managed.clear();
            for (LineEntity l : incoming.getLines()) {
                if (l instanceof BaseLine bl) bl.setId(null);
                if (l instanceof SalesDcLine sdl && sdl.getPackingDetails() != null) {
                    for (SalesDcPackingDetail pd : sdl.getPackingDetails()) pd.setId(null);
                }
                managed.add(l);
            }
        }

        if (old instanceof WorkOrder woOld && incoming instanceof WorkOrder woInc) {
            if (woInc.getMaterialLines() != null) {
                if (woOld.getMaterialLines() == null) woOld.setMaterialLines(new ArrayList<>());
                else woOld.getMaterialLines().clear();
                for (WorkOrderMaterial m : woInc.getMaterialLines()) {
                    m.setId(null);
                    m.setDoc(woOld);
                    woOld.getMaterialLines().add(m);
                }
            }
        }

        if (old instanceof SupplierEnquiry se) {
            if (se.getSupplier() != null && !se.getSupplier().isBlank()) {
                if (se.getSuppliers() == null) se.setSuppliers(new ArrayList<>());
                if (se.getSuppliers().isEmpty()) {
                    SupplierEnquirySupplier ses = new SupplierEnquirySupplier();
                    ses.setDoc(se);
                    se.getSuppliers().add(ses);
                }
                SupplierEnquirySupplier ses = se.getSuppliers().get(0);
                ses.setSupplierName(se.getSupplier());
                ses.setSupplierCode(se.getSupplierCode());
                ses.setContactPerson(se.getContactPerson());
                ses.setPhone(se.getPhone());
                ses.setEmail(se.getEmail());
                ses.setStatus("PENDING");
                ses.setEnquiryStatus("PENDING");
            }
        }

        old.setDocDate(parse(body.get("date")));
        old.setUpdatedAt(Instant.now());
        old.setUpdatedBy(user);
        validateGeneralDcGstin(key, old);
        validateReleaseBalance(key, old);
        // BR-INV-GRN-1: create() enforces accepted+rejected <= inspected, but a DRAFT GRN
        // edited via update() skipped this check entirely — a user could raise accepted/
        // rejected qty past what was actually inspected and it would go straight through
        // to post() unvalidated.
        validateGrn(key, old);
        validateInwardAcceptedQty(key, old);
        attach(old);
        return old;
    }

    private void copyFields(DocEntity target, DocEntity source) {
        for (Class<?> c = target.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
            for (Field f : c.getDeclaredFields()) {
                try {
                    f.setAccessible(true);
                    if (List.of("id", "docNo", "status", "createdBy", "createdAt", "updatedBy",
                            "deleted", "deletedAt", "deletedBy", "lines", "version").contains(f.getName()))
                        continue;
                    if (java.util.Collection.class.isAssignableFrom(f.getType())) continue;
                    Object v = f.get(source);
                    if (v != null) f.set(target, v);
                } catch (Exception ignored) { }
            }
        }
    }

    @Transactional
    public void remove(String key, Long id, String user) {
        DocEntity e = get(key, id);
        if ("production-bom".equals(key)) {
            // For production-bom, deletion validation (e.g. Work Order check) is handled by validateBomCanBeDeleted(id)
        } else if (e.getStatus() != null && !List.of("DRAFT", "REJECTED").contains(e.getStatus().toUpperCase())) {
            throw new IllegalStateException("Only DRAFT/REJECTED documents can be deleted");
        }
        e.setDeleted(true);
        e.setDeletedAt(Instant.now());
        e.setDeletedBy(user);
        e.setUpdatedAt(Instant.now());
        e.setUpdatedBy(user);
    }

    @Transactional
    public DocEntity approveWithLines(String key, Long id, String note,
                                      List<Map<String, Object>> lines, String user) {
        DocEntity e = get(key, id);
        requireStatus(e, "SUBMITTED");

        if (lines != null && !lines.isEmpty()) {
            Map<String, Double> approvedByCode = new HashMap<>();
            for (Map<String, Object> l : lines) {
                Object qty = l.get("approvedQty");
                if (qty == null) continue;
                try {
                    approvedByCode.put(strVal(l.get("itemCode")),
                            Double.parseDouble(String.valueOf(qty)));
                } catch (NumberFormatException ignored) { }
            }
            if (e instanceof StockIssueRequest sir) {
                for (StockIssueRequestLine line : sir.getLines()) {
                    Double approved = approvedByCode.get(line.getItemCode());
                    if (approved != null) line.setApprovedQty(BigDecimal.valueOf(approved));
                }
            }
        }

        e.setStatus("APPROVED");
        e.setUpdatedAt(Instant.now());
        e.setUpdatedBy(user);
        return e;
    }

    @Idempotent
    @Transactional
    public DocEntity action(String key, Long id, String action, String note, String user) {
        return action(key, id, action, note, user, Map.of());
    }

    @Idempotent
    @Transactional
    public DocEntity action(String key, Long id, String action, String note, String user,
                            Map<String, Object> opts) {
        Map<String, Object> options = opts == null ? Map.of() : opts;
        DocEntity e = get(key, id);

        // Map generic action names to status targets for workflow engine
        String targetStatus = switch (action) {
            case "submit" -> "SUBMITTED";
            case "approve" -> "APPROVED";
            case "reject" -> "REJECTED";
            case "reopen" -> "DRAFT";
            case "cancel" -> "CANCELLED";
            case "post" -> "POSTED";
            case "close" -> "CLOSED";
            case "confirm-receipt" -> "RECEIVED";
            // SCR-103 Payment Collection (Phase 2): DRAFT -> ALLOCATED -> POSTED, or
            // POSTED -> REVERSED. These aren't generic-workflow words, so they're mapped
            // here rather than added to DocumentWorkflowEngine's shared vocabulary.
            case "allocate" -> "ALLOCATED";
            case "reverse" -> "REVERSED";
            // SCR-102 Quotation (Phase 3): APPROVED -> SENT_TO_CUSTOMER, or -> LOST from
            // either Quotation or Enquiry (both carry a LOST terminal status).
            case "send-to-customer" -> "SENT_TO_CUSTOMER";
            case "mark-lost" -> "LOST";
            default -> action;
        };

        // Validate against workflow state machine
        String docKey = findKeyForEntity(e);
        String upperDocKey = docKey.toUpperCase().replace("-", "_");
        if (!DIRECT_POST_INWARD_KEYS.contains(docKey)) {
            workflowEngine.validate(upperDocKey, e.getStatus(), targetStatus);
        }

        // Legacy fallback validation for doc types not yet in the workflow engine
        try {
            switch (action) {
                case "submit" -> {
                    requireStatus(e, "DRAFT", "REJECTED");
                    // Stock Allotment & Adjustment FRS v1.0 §5/§6: out-of-tolerance
                    // amendments must be submitted (they cannot bypass approval).
                    applyThresholdRouting(key, e);
                }
                case "approve" -> {
                    // Phase 4 tier router: a submitted Sales Order lands on
                    // PENDING_TIER1/2/3, not the generic SUBMITTED, so its approve
                    // must accept those too — every other doc type is unaffected.
                    if ("sales-order".equals(key)) {
                        requireStatus(e, "DRAFT", "SUBMITTED", "PENDING_TIER1", "PENDING_TIER2", "PENDING_TIER3");
                    } else {
                        requireStatus(e, "DRAFT", "SUBMITTED");
                    }
                    validateApprovalReferences(key, e);
                }
                case "reject" -> {
                    if ("sales-order".equals(key)) {
                        requireStatus(e, "DRAFT", "SUBMITTED", "PENDING_TIER1", "PENDING_TIER2", "PENDING_TIER3");
                    } else {
                        requireStatus(e, "SUBMITTED", "DRAFT");
                    }
                }
                case "reopen" -> requireStatus(e, "REJECTED");
                case "cancel" -> {
                    requireStatus(e, "DRAFT", "SUBMITTED", "APPROVED", "CONFIRMED", "POSTED", "RECEIVED");
                    if (Set.of("jo-dc", "general-dc", "transfer-dc").contains(key)) {
                        if (note == null || note.isBlank()) {
                            throw new IllegalArgumentException("Cancellation remark is mandatory");
                        }
                        if (Set.of("CONFIRMED", "POSTED", "RECEIVED").contains(e.getStatus())) {
                            reverseDcStock(key, e, user);
                        }
                    }
                    // Return Management FRS v1.0 §7 B#5: cancelling a posted return
                    // reverses the stock-in and restores the source doc status.
                    if (Set.of("dc-return", "invoice-return", "stock-return").contains(key)
                            && "POSTED".equals(e.getStatus())) {
                        if (note == null || note.isBlank()) {
                            throw new IllegalArgumentException("Cancellation remark is mandatory for a posted return");
                        }
                        reverseReturnStock(key, e, user);
                    }
                    // Inward Entry FRD v2.0 §6.4/§9.3: cancelling a POSTED inward reverses the
                    // stock it added — without this, cancellation was a silent no-op that left
                    // the receipt's stock in place while the document itself showed CANCELLED.
                    // Restricted to Store Manager/Admin with a mandatory reason; blocked outright
                    // if the receipt has already been consumed downstream (verifyStockAvailability,
                    // called inside reverseInwardStock's recordStockOut, throws in that case).
                    if (DIRECT_POST_INWARD_KEYS.contains(key) && "POSTED".equals(e.getStatus())) {
                        if (note == null || note.isBlank()) {
                            throw new IllegalArgumentException("Cancellation remark is mandatory for a posted inward document");
                        }
                        if (!CurrentUserRoles.hasAnyRole("ADMIN", "STORE_MANAGER", "STORES_MANAGER")) {
                            throw new IllegalArgumentException(
                                    "Cancelling a posted inward document requires a Store Manager or Admin role");
                        }
                        reverseInwardStock(key, e, user);
                    }
                }
                case "confirm-receipt", "confirm_receipt" -> {
                    if ("transfer-dc".equals(key) && e instanceof TransferDc t) {
                        if (Boolean.TRUE.equals(t.getReceiptConfirmed())) {
                            throw new IllegalStateException("Receipt already confirmed for Transfer DC " + t.getDocNo());
                        }
                        for (LineEntity line : t.getLines()) {
                            stockService.recordStockOut(t.getDocNo(), "transfer-dc", "TRANSFER_INTRANSIT_OUT",
                                    line.getItemCode(), "In-Transit", line.getBatchNo(), line.getHeatNo(),
                                    line.getQty(), LocalDate.now(), user, true);
                            stockService.recordStockIn(t.getDocNo(), "transfer-dc", "TRANSFER_RECEIPT",
                                    line.getItemCode(), t.getDestinationLocation(), line.getBatchNo(), line.getHeatNo(),
                                    line.getQty(), LocalDate.now(), user, "FREE");
                        }
                        t.setReceiptConfirmed(true);
                        t.setReceiptConfirmedBy(user);
                        t.setReceiptConfirmedAt(Instant.now());
                        t.setStatus("RECEIVED");
                    }
                }
                case "post" -> {
                    if ("payment-receipt".equals(key)) {
                        // SCR-103: no separate approval step — a receipt posts straight
                        // from ALLOCATED, not from APPROVED like the generic doc types.
                        requireStatus(e, "ALLOCATED");
                    } else if (!DIRECT_POST_INWARD_KEYS.contains(key) && !DIRECT_POST_DC_KEYS.contains(key)) {
                        requireStatus(e, "APPROVED");
                    }
                    if ("sales-dc".equals(key)) enforceFinalInspectionGate(e, options);
                    // BR-INV-GRN-1, defense-in-depth: re-check at the actual moment stock
                    // is about to move, not only at create/update — the two upstream checks
                    // guard normal edits, but this is the last line of defense against any
                    // path that reaches post() without having gone through them.
                    validateGrn(key, e);
                    // Stock Allotment & Adjustment FRS v1.0 §5/§6: amendments whose
                    // |difference| (qty or value) or physical variance exceeds the
                    // configured tolerance must be explicitly approved before posting.
                    requireThresholdApproved(key, e);
                    post(key, e, boolVal(options.get("authorizedOverride")));
                    e.setStatus("POSTED");
                    postToVendorLedger(key, e);
                    updatePoScheduleReceivedQty(key, e);
                }
                case "allocate" -> {
                    if ("payment-receipt".equals(key)) requireStatus(e, "DRAFT");
                }
                case "reverse" -> {
                    if ("payment-receipt".equals(key)) {
                        requireStatus(e, "POSTED");
                        if (note == null || note.isBlank()) {
                            throw new IllegalArgumentException("Reversal reason is mandatory");
                        }
                    }
                }
                case "send-to-customer" -> {
                    if ("quotation".equals(key)) requireStatus(e, "APPROVED");
                }
                case "mark-lost" -> {
                    if (Set.of("enquiry", "quotation").contains(key) && (note == null || note.isBlank())) {
                        throw new IllegalArgumentException("Lost reason is mandatory");
                    }
                }
                default -> { }
            }
        } catch (IllegalStateException ex) {
            // If the legacy validation throws but the workflow engine allowed it,
            // log it and rethrow the workflow error
            throw ex;
        }

        if (!"post".equals(action)) {
            e.setStatus(targetStatus);
        }
        e.setUpdatedAt(Instant.now());
        e.setUpdatedBy(user);

        // Populate lifecycle fields based on action
        switch (action) {
            case "submit" -> { e.setSubmittedBy(user); e.setSubmittedAt(Instant.now()); }
            case "approve" -> { e.setApprovedByUserId(resolveUserId(user)); e.setApprovedAt(Instant.now()); }
            case "close" -> { e.setClosedBy(user); e.setClosedAt(Instant.now()); }
            case "cancel" -> { e.setCancelledBy(user); e.setCancelledAt(Instant.now()); }
            case "reopen" -> { e.setReopenedBy(user); e.setReopenedAt(Instant.now()); }
            case "post" -> e.setPostedAt(Instant.now());
        }

        // FRS §6.3: Mandatory-attachment enforcement on close
        if ("close".equals(action)) {
            String attachmentOwnerType = docKey.replace("/", "-");
            if (!attachmentService.validateMandatoryAttachments(attachmentOwnerType, id)) {
                throw new BusinessRuleException("MANDATORY_ATTACHMENT_MISSING",
                        "Cannot close: required attachments are missing for " + docKey,
                        Map.of("docKey", docKey, "docId", id));
            }
        }

        // FRS §8: NCR REWORK disposition → auto-create rework work order stub
        if ("approve".equals(action) && "quality-ncr".equals(docKey) && e instanceof QualityNcr ncr) {
            String disp = ncr.getDisposition();
            if ("REWORK".equalsIgnoreCase(disp) || "REWORK".equalsIgnoreCase(ncr.getDispositionType())) {
                try {
                    WorkOrder reworkWO = new WorkOrder();
                    String woNo = numbers.next("WORK_ORDER", "WO");
                    reworkWO.setWoNumber(woNo);
                    reworkWO.setItemCode(ncr.getItemCode());
                    reworkWO.setOrderQuantity(ncr.getQuantityAffected());
                    reworkWO.setWoType("REWORK");
                    reworkWO.setSourceType("quality-ncr");
                    reworkWO.setSourceDocNo(ncr.getDocNo());
                    reworkWO.setStatus("DRAFT");
                    reworkWO.setCreatedBy(user);
                    reworkWO.setCreatedAt(Instant.now());
                    reworkWO.setUpdatedAt(Instant.now());
                    em.persist(reworkWO);
                } catch (Exception ex) {
                    log.error("Failed to create rework WO for NCR {}: {}", ncr.getDocNo(), ex.getMessage());
                }
            }
        }

        return e;
    }

    private Long resolveUserId(String username) {
        if (username == null || username.isBlank()) return null;
        try {
            Object result = em.createQuery("SELECT u.id FROM AppUser u WHERE u.username = :uname")
                    .setParameter("uname", username)
                    .setMaxResults(1)
                    .getSingleResult();
            return result instanceof Long l ? l : null;
        } catch (Exception e) {
            return null;
        }
    }

    private void requireStatus(DocEntity e, String... allowed) {
        for (String s : allowed) if (s.equals(e.getStatus())) return;
        throw new IllegalStateException("Action not allowed in status " + e.getStatus());
    }

    private String statusFor(String action, DocEntity e) {
        return switch (action) {
            case "submit" -> "SUBMITTED";
            case "approve" -> "APPROVED";
            case "reject" -> "REJECTED";
            case "reopen" -> "DRAFT";
            case "cancel" -> "CANCELLED";
            case "post" -> "POSTED";
            default -> e.getStatus();
        };
    }

    private void post(String key, DocEntity e, boolean allowNegativeOverride) {
        DocTypes.DocDef def = DocTypes.get(key);
        // DC Module FRS v1.0 §7: availability is re-validated at posting time, not only on entry,
        // so a draft posted later cannot exceed the stock on hand at the movement location.
        if (Set.of("jo-dc", "general-dc", "transfer-dc").contains(key)) {
            validateDcStockAvailability(key, e);
        }
        List<LedgerLine> lines = collectLines(def, e);
        String txType = def.tx().isEmpty() ? key.toUpperCase() : def.tx();
        String stockStatus = determineStockStatus(key, e);
        boolean skipStockEffect = "grn".equals(key) && sourceAlreadyPostedStock(e);

        boolean transferInTransit = "transfer-dc".equals(key)
                && Boolean.TRUE.equals(headerBool(e, "inTransitTracking"));
        boolean joDcReceiving = "jo-dc".equals(key)
                && "Receiving after Job Work".equalsIgnoreCase(headerStr(e, "challanPurpose"));

        for (LedgerLine l : lines) {
            // Effect.NONE doc types (sales-order, proforma-invoice, sales-invoice, ...)
            // never move stock, so a line with no real location — defaulted to "MAIN"
            // by collectLines() purely so the ledger record has *some* value — must not
            // be forced through the active-store check. That check exists for doc types
            // that actually post a stock movement to a real location; for a no-effect
            // doc type it just blocked Post outright with no user-facing way to fix it,
            // since these doc types have no location field to begin with.
            if (def.effect() != DocTypes.Effect.NONE) {
                requireActiveStore(l.loc());
            }
            if (skipStockEffect) continue;
            if ("transfer-dc".equals(key)) {
                String destLoc = headerStr(e, "destinationLocation");
                requireActiveStore(destLoc);
                stockService.recordStockOut(
                        e.getDocNo(), key, txType, l.item(), l.loc(), l.batch(), l.heat(),
                        BigDecimal.valueOf(l.qty()), e.getDocDate(), e.getCreatedBy(),
                        allowNegativeOverride);
                if (transferInTransit) {
                    // FRS §3.3 E: with In-Transit Tracking ON the goods rest in the In-Transit
                    // bucket and only reach the destination on "Confirm Receipt at Destination".
                    stockService.recordStockIn(
                            e.getDocNo(), key, "TRANSFER_INTRANSIT_IN", l.item(), "In-Transit", l.batch(), l.heat(),
                            BigDecimal.valueOf(l.qty()), e.getDocDate(), e.getCreatedBy(), "FREE");
                } else if (destLoc != null && !destLoc.isBlank()) {
                    stockService.recordStockIn(
                            e.getDocNo(), key, "TRANSFER_IN", l.item(), destLoc, l.batch(), l.heat(),
                            BigDecimal.valueOf(l.qty()), e.getDocDate(), e.getCreatedBy(), "FREE");
                }
            } else if ("jo-dc".equals(key)) {
                if (joDcReceiving) {
                    // FRS §3.1 E: receiving pulls from the "Goods with Job Worker" bucket back
                    // into the From Location instead of deducting the main store again.
                    stockService.recordStockOut(
                            e.getDocNo(), key, "JO_DC_RECEIPT", l.item(), "Goods with Job Worker", l.batch(), l.heat(),
                            BigDecimal.valueOf(l.qty()), e.getDocDate(), e.getCreatedBy(),
                            allowNegativeOverride);
                    stockService.recordStockIn(
                            e.getDocNo(), key, "JO_DC_RECEIPT_IN", l.item(), l.loc(), l.batch(), l.heat(),
                            BigDecimal.valueOf(l.qty()), e.getDocDate(), e.getCreatedBy(), "FREE");
                } else {
                    // FRS §3.1 E: sending deducts From Location and funds the "Goods with Job Worker"
                    // virtual bucket so a later receiving DC can validate against it.
                    stockService.recordStockOut(
                            e.getDocNo(), key, txType, l.item(), l.loc(), l.batch(), l.heat(),
                            BigDecimal.valueOf(l.qty()), e.getDocDate(), e.getCreatedBy(),
                            allowNegativeOverride);
                    stockService.recordStockIn(
                            e.getDocNo(), key, "JO_DC_SEND", l.item(), "Goods with Job Worker", l.batch(), l.heat(),
                            BigDecimal.valueOf(l.qty()), e.getDocDate(), e.getCreatedBy(), "FREE");
                }
            } else switch (def.effect()) {
                case IN -> stockService.recordStockIn(
                        e.getDocNo(), key, txType, l.item(), l.loc(), l.batch(), l.heat(),
                        BigDecimal.valueOf(l.qty()), e.getDocDate(), e.getCreatedBy(), stockStatus);
                case OUT -> stockService.recordStockOut(
                        e.getDocNo(), key, txType, l.item(), l.loc(), l.batch(), l.heat(),
                        BigDecimal.valueOf(l.qty()), e.getDocDate(), e.getCreatedBy(),
                        allowNegativeOverride);
                case ADJUST -> {
                    double cur = currentOnHand(l.item(), l.loc(), l.batch());
                    double diff = l.qty() - cur;
                    if (diff != 0) {
                        stockService.recordStockAdjustment(
                                e.getDocNo(), key, txType, l.item(), l.loc(), l.batch(), l.heat(),
                                BigDecimal.valueOf(diff), e.getDocDate(), e.getCreatedBy(),
                                allowNegativeOverride);
                    }
                }
                default -> { }
            }
        }
        if (joDcReceiving && e instanceof JoDc joDc) {
            updateJobOrderReceiptStatus(joDc, e.getCreatedBy());
        }

        // Return Management FRS v1.0 §6/§7/§8: after a return posts its stock-in,
        // propagate PARTIALLY/FULLY_RETURNED to the source doc and (for Stock Return)
        // reduce booked consumption.
        if (Set.of("dc-return", "invoice-return", "stock-return").contains(key)) {
            afterPostReturnHooks(key, e, e.getCreatedBy());
        }
    }

    /**
     * DC Module FRS v1.0 §3.1 E: when a Receiving-after-Job-Work JO DC is posted, the linked
     * Job Order status advances to RECEIVED (all quantities in) or PARTIALLY_RECEIVED (some
     * quantities still pending). This is a best-effort bookkeeping update keyed to the Job Order
     * number the DC carries; if the Job Order cannot be found or is already terminal, nothing
     * changes.
     */
    private void updateJobOrderReceiptStatus(JoDc joDc, String user) {
        String joNo = joDc.getJobOrderNo() != null && !joDc.getJobOrderNo().isBlank()
                ? joDc.getJobOrderNo() : joDc.getLinkedDocumentNo();
        if (joNo == null || joNo.isBlank()) return;

        JobOrder jo = em.createQuery("select j from JobOrder j where j.docNo = :no", JobOrder.class)
                .setParameter("no", joNo)
                .getResultStream().findFirst().orElse(null);
        if (jo == null || jo.getLines() == null || jo.getLines().isEmpty()) return;
        if ("CANCELLED".equalsIgnoreCase(jo.getStatus())) return;

        Map<String, BigDecimal> received = new HashMap<>();
        em.createQuery("select l.itemCode, coalesce(sum(l.producedQty), 0) from JoInwardLine l where l.doc.jobOrderNo = :no group by l.itemCode", Object[].class)
                .setParameter("no", joNo).getResultList()
                .forEach(r -> received.merge(keyOf(r[0]), (BigDecimal) r[1], BigDecimal::add));
        em.createQuery("select l.itemCode, coalesce(sum(l.receivedQty), 0) from LoInwardLine l where l.doc.jobOrderNo = :no group by l.itemCode", Object[].class)
                .setParameter("no", joNo).getResultList()
                .forEach(r -> received.merge(keyOf(r[0]), (BigDecimal) r[1], BigDecimal::add));
        for (LineEntity line : joDc.getLines()) {
            if (line.getItemCode() != null && line.getQty() != null) {
                received.merge(keyOf(line.getItemCode()), line.getQty(), BigDecimal::add);
            }
        }

        boolean allReceived = true;
        boolean anyReceived = false;
        for (JobOrderItem item : jo.getLines()) {
            BigDecimal ordered = item.getOrderQty() == null ? BigDecimal.ZERO : item.getOrderQty();
            BigDecimal got = received.getOrDefault(keyOf(item.getItemCode()), BigDecimal.ZERO);
            if (got.compareTo(BigDecimal.ZERO) > 0) anyReceived = true;
            if (ordered.compareTo(BigDecimal.ZERO) > 0 && got.compareTo(ordered) < 0) allReceived = false;
        }

        String target = allReceived ? "RECEIVED" : (anyReceived ? "PARTIALLY_RECEIVED" : null);
        if (target != null && !target.equalsIgnoreCase(jo.getStatus())) {
            jo.setStatus(target);
            jo.setUpdatedBy(user);
            jo.setUpdatedAt(Instant.now());
        }
    }

    private static String keyOf(Object v) {
        return v == null ? "" : String.valueOf(v);
    }

    private Boolean headerBool(DocEntity e, String field) {
        Object v = headerVal(e, field);
        if (v instanceof Boolean b) return b;
        if (v == null) return null;
        return "true".equalsIgnoreCase(String.valueOf(v));
    }

    /**
     * Every Inward type (PO/LO/JO/General/Return) already has Effect.IN and posts
     * stock directly to store on its own POST action. GRN's source-document picker
     * only ever offers an already-POSTED Inward, so posting the GRN would add a
     * second, separate stock entry for the same physical receipt. GRN still
     * completes its own lifecycle normally (accepted/rejected qty, inspection
     * reference, printable paperwork) — this just tells post() to skip the
     * stock-ledger effect for that case, rather than double-counting.
     */
    private boolean sourceAlreadyPostedStock(DocEntity e) {
        if (!(e instanceof Grn g)) return false;
        String sourceNo = g.getSourceDocumentNo();
        if (sourceNo == null || sourceNo.isBlank()) return false;
        String sourceKey = switch (String.valueOf(g.getSourceType())) {
            case "LO_INWARD" -> "lo-inward";
            case "JO_INWARD" -> "jo-inward";
            case "GENERAL_INWARD" -> "general-inward";
            case "RETURN_INWARD" -> "return-inward";
            default -> "po-inward";
        };
        try {
            DocEntity source = getByNumber(sourceKey, sourceNo);
            return DocTypes.get(sourceKey).effect() == DocTypes.Effect.IN && "POSTED".equals(source.getStatus());
        } catch (Exception ex) {
            return false;
        }
    }

    /**
     * FRS DOC-PUR-FRS-02 §11 (PUR-08/PUR-09) — writes the vendor-ledger effect of a document
     * reaching POSTED. Purchase Invoice increases the payable by its total; a Purchase Return
     * flagged debitNoteRequired decreases it by the debit note amount (falling back to the
     * sum of returned-line net amounts if no explicit debitNoteAmount was entered).
     * VendorLedgerService itself is idempotent per (refDocType, refDocNo), so re-posting the
     * same document (which shouldn't be reachable given the status guards) never double-counts.
     */
    private void postToVendorLedger(String key, DocEntity e) {
        try {
            if ("purchase-invoice".equals(key) && e instanceof PurchaseInvoice inv) {
                if (inv.getTotalAmount() == null || inv.getSupplier() == null || inv.getSupplier().isBlank()) return;
                String[] resolved = resolveParty(inv.getSupplier());
                vendorLedger.record(resolved[0], resolved[1], e.getDocDate(), "INVOICE",
                        "purchase-invoice", e.getDocNo(), inv.getTotalAmount(),
                        "Supplier invoice " + (inv.getSupplierInvoiceNo() != null ? inv.getSupplierInvoiceNo() : e.getDocNo()),
                        e.getUpdatedBy());
            } else if ("purchase-return".equals(key) && e instanceof PurchaseReturn ret) {
                if (!Boolean.TRUE.equals(ret.getDebitNoteRequired()) || ret.getSupplier() == null || ret.getSupplier().isBlank()) return;
                BigDecimal amount = ret.getDebitNoteAmount();
                if (amount == null || amount.signum() <= 0) {
                    amount = BigDecimal.ZERO;
                    for (LineEntity l : e.getLines()) {
                        if (l instanceof PurchaseReturnLine prl && prl.getNetAmount() != null) {
                            amount = amount.add(prl.getNetAmount());
                        }
                    }
                }
                if (amount.signum() <= 0) return;
                String[] resolved = resolveParty(ret.getSupplier());
                vendorLedger.record(resolved[0], resolved[1], e.getDocDate(), "RETURN",
                        "purchase-return", e.getDocNo(), amount.negate(),
                        "Debit note for return " + e.getDocNo() + (ret.getReasonCode() != null ? " (" + ret.getReasonCode() + ")" : ""),
                        e.getUpdatedBy());
            }
        } catch (Exception ex) {
            log.warn("postToVendorLedger skipped for {} {}: {}", key, e.getDocNo(), ex.getMessage());
        }
    }

    /**
     * Purchase Module audit: PurchaseOrderSchedule.receivedQty/pendingQty existed as columns
     * but nothing anywhere ever wrote them — confirmed by a full-backend grep for any setter
     * call against this class. Posting a PO Inward is the actual receipt event, so this is
     * where that gap closes: allocate the received qty (oldest scheduled date first) across
     * that PO's schedule rows for the same item, until it's exhausted.
     */
    private void updatePoScheduleReceivedQty(String key, DocEntity e) {
        if (!"po-inward".equals(key) || !(e instanceof PoInward pi)) return;
        try {
            String poNo = pi.getPurchaseOrderNo();
            if (poNo == null || poNo.isBlank() || pi.getLines() == null) return;
            for (PoInwardLine line : pi.getLines()) {
                if (line.getItemCode() == null || line.getReceivedQty() == null) continue;
                BigDecimal remaining = line.getReceivedQty();
                if (remaining.signum() <= 0) continue;
                List<PurchaseOrderSchedule> rows = poSchedules.findByDocDocNoAndItemCode(poNo, line.getItemCode());
                rows.sort(Comparator.comparing(PurchaseOrderSchedule::getScheduledDate,
                        Comparator.nullsLast(Comparator.naturalOrder())));
                for (PurchaseOrderSchedule row : rows) {
                    if (remaining.signum() <= 0) break;
                    BigDecimal pending = row.getPendingQty() != null ? row.getPendingQty()
                            : (row.getScheduledQty() != null ? row.getScheduledQty() : BigDecimal.ZERO);
                    if (pending.signum() <= 0) continue;
                    BigDecimal applied = remaining.min(pending);
                    row.setReceivedQty((row.getReceivedQty() != null ? row.getReceivedQty() : BigDecimal.ZERO).add(applied));
                    row.setPendingQty(pending.subtract(applied));
                    row.setStatus(row.getPendingQty().signum() <= 0 ? "RECEIVED" : "PARTIALLY_RECEIVED");
                    poSchedules.save(row);
                    remaining = remaining.subtract(applied);
                }
            }
        } catch (Exception ex) {
            log.warn("updatePoScheduleReceivedQty skipped for {} {}: {}", key, e.getDocNo(), ex.getMessage());
        }
    }

    /**
     * FRS DOC-PUR-FRS-02 §6 (PUR-04) — records a PO amendment: called right before the
     * incoming payload is merged into the managed PO entity, whenever that PO is being edited
     * outside DRAFT/REJECTED (i.e. it was already RELEASED/SUBMITTED/APPROVED — a real
     * amendment to a document the vendor may already hold, not just an in-progress draft edit).
     * Snapshots the pre-edit state, bumps revisionNumber, and flags whether supplier/qty/price
     * actually changed (vs. e.g. only remarks).
     *
     * [TBC] Re-approval-on-material-change is intentionally NOT enforced here — per the brief,
     * this is implemented as a basic, disabled-by-default rule (REQUIRE_REAPPROVAL_ON_AMENDMENT)
     * until the business confirms whether a material amendment should force the PO back to
     * SUBMITTED. Flip that constant to true to enable it.
     */
    private static final boolean REQUIRE_REAPPROVAL_ON_AMENDMENT = false;

    /** Returns the next revision number to apply to `old` after copyFields runs, or null on failure. */
    private Integer recordPoAmendment(PurchaseOrder old, PurchaseOrder incoming, String user) {
        try {
            boolean materialChange = !Objects.equals(old.getSupplier(), incoming.getSupplier());
            if (!materialChange && old.getLines() != null && incoming.getLines() != null) {
                Map<String, PurchaseOrderItem> oldByItem = new LinkedHashMap<>();
                for (PurchaseOrderItem l : old.getLines()) oldByItem.put(l.getItemCode(), l);
                if (old.getLines().size() != incoming.getLines().size()) {
                    materialChange = true;
                } else {
                    for (PurchaseOrderItem nl : incoming.getLines()) {
                        PurchaseOrderItem ol = oldByItem.get(nl.getItemCode());
                        if (ol == null
                                || !Objects.equals(ol.getOrderQty(), nl.getOrderQty())
                                || !Objects.equals(ol.getUnitPrice(), nl.getUnitPrice())) {
                            materialChange = true;
                            break;
                        }
                    }
                }
            }

            PoAmendmentHistory hist = new PoAmendmentHistory();
            hist.setPoId(old.getId());
            hist.setPoDocNo(old.getDocNo());
            int nextRevision = (old.getRevisionNumber() == null ? 1 : old.getRevisionNumber()) + 1;
            hist.setRevisionNumber(nextRevision);
            hist.setStatusAtAmendment(old.getStatus());
            hist.setMaterialChange(materialChange);
            hist.setSnapshotBefore(mapper.writeValueAsString(mapper.convertValue(old, LinkedHashMap.class)));
            hist.setAmendedBy(user);
            poAmendments.save(hist);

            // [TBC/disabled] Not applied to `old` here — copyFields() runs right after this
            // returns and would overwrite a status change made now. See REQUIRE_REAPPROVAL_ON_AMENDMENT.
            if (materialChange && REQUIRE_REAPPROVAL_ON_AMENDMENT) {
                log.info("PO {} materially amended — re-approval flag set but not enforced (disabled by default)", old.getDocNo());
            }
            return nextRevision;
        } catch (Exception ex) {
            log.warn("recordPoAmendment skipped for {}: {}", old.getDocNo(), ex.getMessage());
            return null;
        }
    }

    /** Returns {code, name}, resolving a header string (which may hold either) against Party master. */
    private String[] resolveParty(String supplierField) {
        return parties.findByCode(supplierField)
                .or(() -> parties.findByName(supplierField))
                .map(p -> new String[]{p.getCode(), p.getName()})
                .orElse(new String[]{supplierField, supplierField});
    }

    /**
     * DOCUMENT 02 v2.0 §02.1 (FR-INV-STORE-2): a non-blank location must resolve to a
     * recognized active location before it can be posted to. store_master is the
     * FRS's authoritative store list, but most existing document forms still pick
     * from the older, separate location_master table (e.g. "RM-A-12") — both are
     * accepted here so this check catches genuine typos/unknown locations without
     * breaking every screen that hasn't been migrated onto store_master yet. Blank
     * locations are left alone — StockService defaults those to "MAIN" today and
     * changing that default is out of scope here.
     */
    private void requireActiveStore(String location) {
        if (location == null || location.isBlank()) return;
        boolean isStore = stores.findByCode(location).map(s -> Boolean.TRUE.equals(s.getActive())).orElse(false);
        if (isStore) return;
        if (locations.existsByCodeAndActiveTrue(location)) return;
        throw new BusinessRuleException("LOCATION_NOT_A_STORE",
                "Location '" + location + "' is not a recognized active store or location",
                Map.of("location", location));
    }

    /** FRS §6.2: blocks dispatch of any batch/lot that has not cleared Final Inspection when the item requires QC. */
    private void enforceFinalInspectionGate(DocEntity e, Map<String, Object> opts) {
        if (e.getLines() == null || e.getLines().isEmpty()) return;
        boolean forced = boolVal(opts.get("forceDispatch"));
        if (forced && !CurrentUserRoles.hasAnyRole("ADMIN", "MANAGEMENT", "SALES_MANAGER")) {
            throw new IllegalArgumentException(
                    "forceDispatch requires a supervisor role (ADMIN / MANAGEMENT / SALES_MANAGER)");
        }
        for (LineEntity line : e.getLines()) {
            String itemCode = line.getItemCode();
            if (itemCode == null || itemCode.isBlank()) continue;
            var item = itemCache.findByCode(itemCode).orElse(null);
            if (item == null || !Boolean.TRUE.equals(item.getInspectionRequired())) continue;
            String batchNo = line.getBatchNo() == null ? "" : line.getBatchNo();
            String heatNo = line.getHeatNo() == null ? "" : line.getHeatNo();
            if (hasPassingFinalInspection(itemCode, batchNo, heatNo)) continue;
            if (forced) {
                log.warn("FORCED DISPATCH override: item {} batch {} has not cleared Final Inspection (doc {})",
                        itemCode, batchNo, e.getDocNo());
                continue;
            }
            throw new IllegalStateException("Dispatch blocked: item " + itemCode + " batch " +
                    (batchNo.isEmpty() ? "-" : batchNo) + " has not cleared Final Inspection");
        }
    }

    private boolean hasPassingFinalInspection(String itemCode, String batchNo, String heatNo) {
        Long count = em.createQuery(
                "select count(qi) from QualityInspection qi " +
                "where qi.itemCode = :itemCode " +
                "and qi.inspectionType = :type " +
                "and (:batchNo = '' or qi.batchNumber = :batchNo) " +
                "and (:heatNo = '' or qi.heatNumber = :heatNo) " +
                "and (qi.finalDecision = 'PASS' or qi.inspectionStatus in ('PASS', 'APPROVED'))", Long.class)
                .setParameter("itemCode", itemCode)
                .setParameter("type", QualityInspectionType.FINAL)
                .setParameter("batchNo", batchNo)
                .setParameter("heatNo", heatNo)
                .getSingleResult();
        return count != null && count > 0;
    }

    private String determineStockStatus(String key, DocEntity e) {
        if ("grn".equals(key)) {
            if (e.getLines() != null) {
                for (LineEntity line : e.getLines()) {
                    String itemCode = line.getItemCode();
                    if (itemCode == null || itemCode.isBlank()) continue;
                    var item = itemCache.findByCode(itemCode).orElse(null);
                    if (item != null && Boolean.TRUE.equals(item.getInspectionRequired())) {
                        return "QC_HOLD";
                    }
                }
            }
            return "FREE";
        }
        boolean isQcInward = Set.of("po-inward", "lo-inward", "jo-inward", "general-inward").contains(key);
        if (isQcInward) {
            Object qcReq = null;
            try {
                Field f = e.getClass().getDeclaredField("qcRequired");
                f.setAccessible(true);
                qcReq = f.get(e);
            } catch (Exception ignored) {}
            if (qcReq != null && ("true".equalsIgnoreCase(String.valueOf(qcReq)) || "Yes".equalsIgnoreCase(String.valueOf(qcReq)))) {
                return "QC_HOLD";
            }
            return "FREE";
        }
        boolean isReturn = Set.of("dc-return", "invoice-return", "stock-return").contains(key);
        if (isReturn) {
            if ("stock-return".equals(key)) {
                String condition = headerStr(e, "condition");
                String mapped = returnStockStatus(condition);
                if ("SCRAP".equals(mapped) || "DAMAGED".equals(mapped) || "REJECTED".equals(mapped)) {
                    return mapped;
                }
                return "FREE";
            }
            String disposition = headerStr(e, "disposition");
            if ("PENDING_INSPECTION".equalsIgnoreCase(disposition) || "REWORK".equalsIgnoreCase(disposition)) {
                return "QC_HOLD";
            }
            if ("SCRAP".equalsIgnoreCase(disposition)) {
                return "SCRAP";
            }
            if ("DAMAGED".equalsIgnoreCase(disposition) || "REJECTED".equalsIgnoreCase(disposition)) {
                return disposition.toUpperCase();
            }
            return "FREE";
        }
        return "FREE";
    }

    private record LedgerLine(String item, String loc, String batch, String heat, double qty) {}

    private double currentOnHand(String item, String loc, String batch) {
        return stockService.onHand(item, loc, batch);
    }

    private List<LedgerLine> collectLines(DocTypes.DocDef def, DocEntity e) {
        List<LedgerLine> out = new ArrayList<>();
        if (def.hasLines()) {
            // Stock Release carries no location of its own — it releases stock the
            // referenced Allotment reserved, so fall back to that allotment line's location
            // instead of defaulting to MAIN, which may hold none of the item's stock.
            DocEntity allotmentDoc = null;
            if ("stock-release".equals(def.key())) {
                String allotmentNo = headerStr(e, "allotmentNo");
                if (!allotmentNo.isBlank()) {
                    try { allotmentDoc = getByNumber("stock-allotment", allotmentNo); } catch (Exception ignored) {}
                }
            }
            for (LineEntity l : e.getLines()) {
                String loc = firstNonEmpty(l.getLocation(), headerStr(e, "sourceLocation"), headerStr(e, "storeLocation"));
                if (loc.isEmpty() && allotmentDoc != null) {
                    for (LineEntity aLine : allotmentDoc.getLines()) {
                        if (l.getItemCode() != null && l.getItemCode().equals(aLine.getItemCode())
                                && aLine.getLocation() != null && !aLine.getLocation().isBlank()) {
                            loc = aLine.getLocation();
                            break;
                        }
                    }
                }
                if (loc.isBlank()) loc = "MAIN";
                if (l instanceof BaseLine bl && (bl.getLocation() == null || bl.getLocation().isBlank())) {
                    bl.setLocation(loc);
                }
                if (DIRECT_POST_INWARD_KEYS.contains(def.key())) {
                    // Only the Accepted Qty ever reaches stock for an Inward line — the
                    // Received Qty is just what physically arrived. validateInwardAcceptedQty()
                    // already guarantees acceptedQty is present by the time post() runs; a line
                    // fully rejected at receipt (acceptedQty 0) posts no stock movement at all.
                    BigDecimal accepted = l.getAcceptedQty();
                    if (accepted == null || accepted.signum() <= 0) continue;
                    out.add(new LedgerLine(l.getItemCode(), loc, l.getBatchNo(), l.getHeatNo(), accepted.doubleValue()));
                } else {
                    out.add(new LedgerLine(l.getItemCode(), loc, l.getBatchNo(), l.getHeatNo(), l.getQty().doubleValue()));
                }
            }
            return out;
        }
        if (def.effect() == DocTypes.Effect.ADJUST) {
            out.add(new LedgerLine(headerStr(e, "itemCode"), headerStr(e, "location"),
                    headerStr(e, "batchNo"), "", numOrZero(headerVal(e, "correctedQty"))));
        }
        return out;
    }

    private String headerStr(DocEntity e, String field) {
        Object v = headerVal(e, field);
        return v == null ? "" : String.valueOf(v);
    }

    private double numOrZero(Object v) {
        if (v == null) return 0;
        if (v instanceof Number n) return n.doubleValue();
        try { return Double.parseDouble(String.valueOf(v)); } catch (Exception ex) { return 0; }
    }

    private Object headerVal(DocEntity e, String field) {
        try {
            Field f = e.getClass().getDeclaredField(field);
            f.setAccessible(true);
            return f.get(e);
        } catch (Exception ex) { return null; }
    }

    @SuppressWarnings("unchecked")
    private void attach(DocEntity e) {
        if (e instanceof WorkOrder wo && wo.getMaterialLines() != null) {
            for (WorkOrderMaterial m : wo.getMaterialLines()) {
                m.setDoc(wo);
            }
        }
        if (e.getLines() == null) return;
        for (LineEntity l : e.getLines()) {
            Class<?> clazz = l.getClass();
            while (clazz != null && clazz != Object.class) {
                try {
                    Field f = clazz.getDeclaredField("doc");
                    f.setAccessible(true);
                    f.set(l, e);
                    break;
                } catch (Exception ignored) {
                    clazz = clazz.getSuperclass();
                }
            }
            if (l instanceof SalesDcLine sdl && sdl.getPackingDetails() != null) {
                for (SalesDcPackingDetail pd : sdl.getPackingDetails()) {
                    pd.setDcLine(sdl);
                }
            }
        }
    }

    private String findKeyForEntity(DocEntity e) {
        for (var entry : reg.entrySet()) {
            if (entry.getValue() == e.getClass()) return entry.getKey();
        }
        return "";
    }

    private LocalDate parse(Object o) {
        if (o == null) return LocalDate.now();
        try { return LocalDate.parse(String.valueOf(o)); } catch (Exception ex) { return LocalDate.now(); }
    }

    private String firstNonEmpty(String... v) {
        for (String s : v) if (s != null && !s.isEmpty()) return s;
        return "";
    }

    private String firstOf(Map<String, Object> r, String... keys) {
        for (String k : keys) {
            Object v = r.get(k);
            if (v != null && !String.valueOf(v).isEmpty()) return String.valueOf(v);
        }
        return "";
    }

    private void validateReturnEligibility(String key, DocEntity e) {
        if (!Set.of("dc-return", "invoice-return", "inward-return", "stock-return", "receipt-return", "purchase-return").contains(key)) return;

        String originalDocNo = null;
        String origDocType = null;
        if ("purchase-return".equals(key) && e instanceof PurchaseReturn pr) {
            originalDocNo = pr.getOriginalDocumentNo();
            origDocType = "purchase-order".equals(pr.getOriginalDocumentType()) ? "purchase-order" : "po-inward";
        } else if ("dc-return".equals(key) && e instanceof DcReturn dr) {
            originalDocNo = dr.getOriginalDcNumber();
            origDocType = originalDocTypeForDcReturn(dr);
        } else if ("invoice-return".equals(key) && e instanceof InvoiceReturn ir) {
            originalDocNo = ir.getOriginalInvoiceNumber();
            origDocType = "sales-invoice";
        } else if ("inward-return".equals(key) && e instanceof InwardReturn ir) {
            originalDocNo = ir.getOriginalDocumentNo();
            origDocType = "po-inward";
        } else if ("stock-return".equals(key) && e instanceof StockReturn sr) {
            originalDocNo = sr.getOriginalDocumentNo();
            origDocType = originalWhat("stock-return", "rm-issue", e, sr.getOriginalIssueType());
        } else if ("receipt-return".equals(key) && e instanceof ReceiptReturn rr) {
            originalDocNo = headerStr(e, "originalDocumentNo");
            origDocType = "rm-issue";
        }

        if (originalDocNo != null && !originalDocNo.isBlank()) {
            try {
                DocEntity origDoc = getByNumber(origDocType, originalDocNo);
                // A referenced Purchase Order is almost never itself POSTED in this system —
                // per FRS DOC-PUR-FRS-02 §5D, disableApprovalWorkflow historically kept most
                // real POs in DRAFT/RELEASED. Accept any status beyond DRAFT for that case;
                // every other origDocType keeps the stricter POSTED requirement.
                boolean eligible = "purchase-order".equals(origDocType)
                        ? !"DRAFT".equals(origDoc.getStatus()) && !"CANCELLED".equals(origDoc.getStatus())
                        : "POSTED".equals(origDoc.getStatus());
                if (!eligible) {
                    throw new IllegalStateException("Original document " + originalDocNo + " is not eligible for a return (status " + origDoc.getStatus() + ")");
                }
            } catch (IllegalArgumentException ex) {
                throw new IllegalStateException("Original document " + originalDocNo + " not found");
            }
        }

        for (LineEntity line : e.getLines()) {
            String itemCode = line.getItemCode();
            if (itemCode == null || itemCode.isBlank()) continue;
            String batchNo = line.getBatchNo() != null ? line.getBatchNo() : "";

            BigDecimal currentReturnQty = line.getQty();
            if (currentReturnQty == null || currentReturnQty.compareTo(BigDecimal.ZERO) <= 0) continue;

            // NOTE: lineClass/qtyField must match the persistent attribute name on each
            // line entity — DcReturnLine/InvoiceReturnLine only expose a Java getQty()
            // override backed by currentReturnQty, StockReturnLine/InwardReturnLine/
            // ReceiptReturnLine are backed by returnedQty. HQL resolves against mapped
            // attributes, not interface method overrides, so "l.qty" always threw
            // UnknownPathException here, and inward-return fell through to the
            // unrelated InvoiceReturnLine class — this blocked every return with an
            // original-document reference from ever being created.
            String lineClass = switch (key) {
                case "dc-return" -> "DcReturnLine";
                case "stock-return" -> "StockReturnLine";
                case "receipt-return" -> "ReceiptReturnLine";
                case "inward-return" -> "InwardReturnLine";
                case "purchase-return" -> "PurchaseReturnLine";
                default -> "InvoiceReturnLine";
            };
            String qtyField = switch (key) {
                case "dc-return", "invoice-return" -> "currentReturnQty";
                case "purchase-return" -> "returnQty";
                default -> "returnedQty";
            };
            String origField = switch (key) {
                case "dc-return" -> "doc.originalDcNumber";
                case "invoice-return" -> "doc.originalInvoiceNumber";
                case "inward-return", "stock-return", "receipt-return", "purchase-return" -> "doc.originalDocumentNo";
                default -> null;
            };

            String hql = "SELECT COALESCE(SUM(l." + qtyField + "), 0) FROM " + lineClass + " l " +
                "WHERE l.doc.docNo != :docNo AND l.doc.status = 'POSTED' " +
                "AND l.itemCode = :itemCode " +
                "AND (:batchNo = '' OR l.batchNo = :batchNo)";

            if (originalDocNo != null && !originalDocNo.isBlank() && origField != null) {
                hql += " AND " + origField + " = :origDocNo";
            }

            var query = em.createQuery(hql)
                .setParameter("docNo", e.getDocNo() != null ? e.getDocNo() : "")
                .setParameter("itemCode", itemCode)
                .setParameter("batchNo", batchNo);
            if (originalDocNo != null && !originalDocNo.isBlank() && origField != null) {
                query = query.setParameter("origDocNo", originalDocNo);
            }

            BigDecimal previouslyReturned = (BigDecimal) query.getSingleResult();
            if (previouslyReturned == null) previouslyReturned = BigDecimal.ZERO;

            BigDecimal totalReturnQty = previouslyReturned.add(currentReturnQty);

            BigDecimal originalQty = BigDecimal.ZERO;
            if (originalDocNo != null && !originalDocNo.isBlank() && origDocType != null) {
                try {
                    DocEntity origDoc = getByNumber(origDocType, originalDocNo);
                    for (LineEntity origLine : origDoc.getLines()) {
                        if (itemCode.equals(origLine.getItemCode()) &&
                            (batchNo.isEmpty() || batchNo.equals(origLine.getBatchNo()))) {
                            originalQty = originalQty.add(origLine.getQty());
                        }
                    }
                } catch (Exception ignored) {}
            }

            if (originalQty.compareTo(BigDecimal.ZERO) > 0 && totalReturnQty.compareTo(originalQty) > 0) {
                throw new IllegalStateException(
                    "Return qty " + currentReturnQty + " exceeds eligible balance for item " + itemCode +
                    " (original: " + originalQty + ", already returned: " + previouslyReturned + ")");
            }
        }
    }

    private static final List<String> ISSUE_SOURCE_TYPES = List.of(
            "general-issue", "rm-issue", "jo-dc-issue", "issue-internal-external", "issue-against-receipt");

    /** FRS §7.2: a return against an issue cannot exceed originalIssueQty - previouslyReturnedQty. */
    private void validateReceivedAgainstIssue(String key, DocEntity e) {
        if (!"received-against-issue".equals(key)) return;
        String issueNo = headerStr(e, "originalDocumentNo");
        if (issueNo == null || issueNo.isBlank()) return;

        DocEntity issueDoc = null;
        for (String t : ISSUE_SOURCE_TYPES) {
            try {
                issueDoc = getByNumber(t, issueNo);
                break;
            } catch (IllegalArgumentException ignored) {}
        }

        for (LineEntity line : e.getLines()) {
            String itemCode = line.getItemCode();
            if (itemCode == null || itemCode.isBlank()) continue;
            BigDecimal returnQty = line.getQty();
            if (returnQty == null || returnQty.compareTo(BigDecimal.ZERO) <= 0) continue;

            String batchNo = line.getBatchNo() == null ? "" : line.getBatchNo();

            BigDecimal previouslyReturned = BigDecimal.ZERO;
            try {
                var result = em.createQuery(
                        "SELECT COALESCE(SUM(l.returnedQty), 0) FROM ReceivedAgainstIssueLine l " +
                        "WHERE l.doc.originalDocumentNo = :issueNo " +
                        "AND l.doc.status IN ('SUBMITTED', 'APPROVED', 'POSTED') " +
                        "AND l.doc.docNo != :docNo " +
                        "AND l.itemCode = :itemCode " +
                        "AND (:batchNo = '' OR l.batchNo = :batchNo)",
                        java.math.BigDecimal.class)
                        .setParameter("issueNo", issueNo)
                        .setParameter("docNo", e.getDocNo() != null ? e.getDocNo() : "")
                        .setParameter("itemCode", itemCode)
                        .setParameter("batchNo", batchNo)
                        .getSingleResult();
                if (result != null) previouslyReturned = result;
            } catch (Exception ignored) {}

            BigDecimal originalQty = BigDecimal.ZERO;
            if (issueDoc != null && issueDoc.getLines() != null) {
                for (LineEntity il : issueDoc.getLines()) {
                    if (!itemCode.equals(il.getItemCode())) continue;
                    if (!batchNo.isEmpty() && !batchNo.equals(il.getBatchNo())) continue;
                    originalQty = originalQty.add(il.getQty() == null ? BigDecimal.ZERO : il.getQty());
                }
            }

            if (originalQty.compareTo(BigDecimal.ZERO) <= 0) continue;

            BigDecimal returnableBalance = originalQty.subtract(previouslyReturned);
            if (returnQty.compareTo(returnableBalance) > 0) {
                throw new IllegalStateException("Return quantity (" + returnQty +
                        ") exceeds returnable balance (" + returnableBalance + ") for issue " + issueNo);
            }
        }
    }

    /** Re-enabled per the CNC-shop target-state FRS (2026-09-12), which calls for this to be a
     * hard rule rather than optional — it was previously disabled deliberately (see git history)
     * per an earlier, narrower decision that this FRS explicitly supersedes. Scoped to documents
     * that actually move stock (Inward/Issue, DocTypes.Effect IN/OUT) — the FRS itself says
     * "mandatory... at Inward and Issue", and a planning document like Purchase Request doesn't
     * know the batch/heat number yet (confirmed by the existing
     * DocumentFacadeTest.ValidateBatchHeat.purchaseRequestExemptFromBatchCheck expectation). */
    private void validateBatchHeat(String key, DocEntity e) {
        if (e.getLines() == null) return;
        // PO Inward has no Batch/Heat/Lot fields on its line items — nothing to require here.
        if ("po-inward".equals(key)) return;
        DocTypes.Effect effect;
        try { effect = DocTypes.get(key).effect(); } catch (Exception ex) { return; }
        if (effect != DocTypes.Effect.IN && effect != DocTypes.Effect.OUT) return;
        for (LineEntity line : e.getLines()) {
            String itemCode = line.getItemCode();
            if (itemCode == null || itemCode.isBlank()) continue;
            var item = itemCache.findByCode(itemCode).orElse(null);
            if (item == null) continue;
            if (Boolean.TRUE.equals(item.getRequiresBatch()) && (line.getBatchNo() == null || line.getBatchNo().isBlank())) {
                throw new BusinessRuleException("BATCH_NUMBER_REQUIRED",
                        "Item " + itemCode + " requires a batch number.", Map.of("itemCode", itemCode));
            }
            if (Boolean.TRUE.equals(item.getRequiresHeat()) && (line.getHeatNo() == null || line.getHeatNo().isBlank())) {
                throw new BusinessRuleException("HEAT_NUMBER_REQUIRED",
                        "Item " + itemCode + " requires a heat number.", Map.of("itemCode", itemCode));
            }
        }
    }

    private void validateAmendmentReason(String key, DocEntity e) {
        if (Set.of("stock-amendment", "physical-stock-amendment").contains(key)) {
            String reasonCode = headerStr(e, "reasonCode");
            if (reasonCode == null || reasonCode.isBlank()) {
                throw new IllegalStateException("Amendment reason code is required (INV-ADJ-01)");
            }
        }
        // Stock Allotment & Adjustment FRS v1.0 §6 D: a Physical Stock Amendment must
        // reference the Stock Verification / Count Sheet that produced the physical qty.
        if ("physical-stock-amendment".equals(key) && e instanceof PhysicalStockAmendment psa) {
            if (psa.getCountSheetNo() == null || psa.getCountSheetNo().isBlank()) {
                throw new IllegalStateException("Physical Stock Amendment requires a Count Sheet reference (INV-PHY-ADJ-04)");
            }
        }
    }

    private void validateReleaseBalance(String key, DocEntity e) {
        if (!"stock-release".equals(key)) return;
        String allotmentNo = headerStr(e, "allotmentNo");
        if (allotmentNo == null || allotmentNo.isBlank()) {
            throw new IllegalStateException("Stock Release must reference an Allotment number");
        }
        DocEntity allotmentDoc = getByNumber("stock-allotment", allotmentNo);
        for (LineEntity line : e.getLines()) {
            String itemCode = line.getItemCode();
            double releaseQty = line.getQty() != null ? line.getQty().doubleValue() : 0;
            double allotQty = 0;
            for (LineEntity aLine : allotmentDoc.getLines()) {
                if (itemCode.equals(aLine.getItemCode())) {
                    allotQty += aLine.getQty() != null ? aLine.getQty().doubleValue() : 0;
                }
            }
            double alreadyReleased = 0;
            try {
                var result = em.createQuery(
                    "SELECT COALESCE(SUM(l.releasedQty), 0) FROM StockReleaseLine l WHERE l.doc.allotmentNo = :allotmentNo AND l.doc.status = 'POSTED' AND l.itemCode = :itemCode AND l.doc.docNo != :docNo", java.math.BigDecimal.class)
                    .setParameter("allotmentNo", allotmentNo)
                    .setParameter("itemCode", itemCode)
                    .setParameter("docNo", e.getDocNo() != null ? e.getDocNo() : "")
                    .getSingleResult();
                alreadyReleased = result != null ? result.doubleValue() : 0;
            } catch (Exception ignored) {}
            if (allotQty > 0 && (alreadyReleased + releaseQty) > allotQty) {
                throw new IllegalStateException(
                    "Release qty " + releaseQty + " for item " + itemCode + " exceeds allotment balance. Allotted: " + allotQty + ", already released: " + alreadyReleased);
            }
        }
    }

    private void validateGeneralInwardReason(String key, DocEntity e) {
        if (!"general-inward".equals(key)) return;
        String reasonCode = headerStr(e, "reasonCode");
        if (reasonCode == null || reasonCode.isBlank()) {
            throw new IllegalStateException("General Inward reason code is required (INV-GNI-01)");
        }
    }

    private void validateRmIssueSir(String key, DocEntity e) {
        if (!"rm-issue".equals(key)) return;
        String issueRequestNo = headerStr(e, "issueRequestNo");
        if (issueRequestNo == null || issueRequestNo.isBlank()) return;
        DocEntity sirDoc = getByNumber("stock-issue-request", issueRequestNo);
        if (!"POSTED".equals(sirDoc.getStatus()) && !"APPROVED".equals(sirDoc.getStatus())) {
            throw new IllegalStateException("Referenced Stock Issue Request " + issueRequestNo + " must be APPROVED or POSTED");
        }
        for (LineEntity line : e.getLines()) {
            String itemCode = line.getItemCode();
            double issueQty = line.getQty() != null ? line.getQty().doubleValue() : 0;
            double sirQty = 0;
            for (LineEntity sirLine : sirDoc.getLines()) {
                if (itemCode.equals(sirLine.getItemCode())) {
                    sirQty += sirLine.getQty() != null ? sirLine.getQty().doubleValue() : 0;
                }
            }
            double alreadyIssued = 0;
            try {
                var result = em.createQuery(
                    "SELECT COALESCE(SUM(l.issueQty), 0) FROM RmIssueLine l WHERE l.doc.issueRequestNo = :sirNo AND l.doc.status = 'POSTED' AND l.itemCode = :itemCode AND l.doc.docNo != :docNo", java.math.BigDecimal.class)
                    .setParameter("sirNo", issueRequestNo)
                    .setParameter("itemCode", itemCode)
                    .setParameter("docNo", e.getDocNo() != null ? e.getDocNo() : "")
                    .getSingleResult();
                alreadyIssued = result != null ? result.doubleValue() : 0;
            } catch (Exception ignored) {}
            if (sirQty > 0 && (alreadyIssued + issueQty) > sirQty) {
                throw new IllegalStateException(
                    "Issue qty " + issueQty + " for item " + itemCode + " exceeds SIR balance. Requested: " + sirQty + ", already issued: " + alreadyIssued);
            }
        }
    }

    private static final Map<String, String> GRN_SOURCE_TYPE_TO_DOC_KEY = Map.of(
            "PO_INWARD", "po-inward",
            "LO_INWARD", "lo-inward",
            "JO_INWARD", "jo-inward",
            "GENERAL_INWARD", "general-inward",
            "RETURN_INWARD", "return-inward"
    );

    private void validateGrn(String key, DocEntity e) {
        if (!"grn".equals(key)) return;
        // BR-INV-TRACE-1: sourceDocumentNo is GRN's own cross-document reference and was
        // never actually checked — a GRN could carry a typo'd or nonexistent source doc
        // number all the way through to POSTED with nothing catching it.
        if (e instanceof Grn grn) {
            String sourceDocNo = grn.getSourceDocumentNo();
            if (sourceDocNo != null && !sourceDocNo.isBlank()) {
                String sourceKey = GRN_SOURCE_TYPE_TO_DOC_KEY.get(grn.getSourceType());
                if (sourceKey != null) {
                    DocEntity source = getByNumberOrNull(sourceKey, sourceDocNo);
                    if (source == null) {
                        throw new IllegalStateException(
                                "GRN sourceDocumentNo '" + sourceDocNo + "' does not resolve to an existing " + grn.getSourceType());
                    }
                }
            }
        }
        for (LineEntity line : e.getLines()) {
            if (line instanceof GrnLine gl) {
                BigDecimal accepted = gl.getAcceptedQty() != null ? gl.getAcceptedQty() : BigDecimal.ZERO;
                BigDecimal rejected = gl.getRejectedQty() != null ? gl.getRejectedQty() : BigDecimal.ZERO;
                BigDecimal inspected = gl.getInspectedQty() != null ? gl.getInspectedQty() : null;
                if (inspected != null && inspected.compareTo(BigDecimal.ZERO) > 0) {
                    BigDecimal total = accepted.add(rejected);
                    if (total.compareTo(inspected) > 0) {
                        throw new IllegalStateException(
                            "GRN line item " + gl.getItemCode() + ": accepted (" + accepted + ") + rejected (" + rejected +
                            ") = " + total + " exceeds inspected qty (" + inspected + ")");
                    }
                }
            }
        }
    }

    private void validatePoInward(String key, DocEntity e) {
        if (!"po-inward".equals(key)) return;
        // Direct inventory update enabled — business rule validation bypassed as requested.
    }

    /**
     * Inward Entry FRD v2.0 §8.2 (G5): the same supplier invoice/DC number booked twice against
     * the same supplier/vendor on a PO or LO Inward is almost always a double-entry of one
     * delivery, not two genuine receipts — hard-stop it rather than let it silently double stock
     * and vendor liability. Unlike the PO-quantity/batch-heat rules elsewhere in this file, this
     * check has no prior history in this codebase, so it isn't reverting anything intentional.
     */
    private void validateDuplicateInwardChallan(String key, DocEntity e) {
        if (!Set.of("po-inward", "lo-inward").contains(key)) return;
        String invoiceNo = headerStr(e, "supplierInvoiceNo");
        String dcNo = headerStr(e, "dcNumber");
        boolean hasInvoice = invoiceNo != null && !invoiceNo.isBlank();
        boolean hasDc = dcNo != null && !dcNo.isBlank();
        if (!hasInvoice && !hasDc) return;

        String partyField = "po-inward".equals(key) ? "supplier" : "vendor";
        String party = headerStr(e, partyField);
        if (party == null || party.isBlank()) return;

        try {
            String entityName = cls(key).getSimpleName();
            StringBuilder jpql = new StringBuilder("select d.docNo from ").append(entityName)
                    .append(" d where d.deleted = false and d.status <> 'CANCELLED' and d.docNo <> :docNo and d.")
                    .append(partyField).append(" = :party and (");
            List<String> clauses = new ArrayList<>();
            if (hasInvoice) clauses.add("d.supplierInvoiceNo = :invoiceNo");
            if (hasDc) clauses.add("d.dcNumber = :dcNo");
            jpql.append(String.join(" or ", clauses)).append(")");

            var query = em.createQuery(jpql.toString(), String.class)
                    .setParameter("docNo", e.getDocNo() != null ? e.getDocNo() : "")
                    .setParameter("party", party);
            if (hasInvoice) query.setParameter("invoiceNo", invoiceNo);
            if (hasDc) query.setParameter("dcNo", dcNo);

            List<String> matches = query.setMaxResults(1).getResultList();
            if (!matches.isEmpty()) {
                throw new BusinessRuleException("DUPLICATE_CHALLAN",
                        "This supplier invoice/DC number is already booked against " + party
                                + " on document " + matches.get(0) + ". If this is genuinely a separate delivery, "
                                + "use a different reference number.",
                        Map.of("existingDocNo", matches.get(0)));
            }
        } catch (BusinessRuleException ex) {
            throw ex;
        } catch (Exception ex) {
            log.warn("validateDuplicateInwardChallan skipped for {} {}: {}", key, e.getDocNo(), ex.getMessage());
        }
    }

    /**
     * DC Module FRS v1.0 §3.2 B#5: GSTIN is mandatory on a General DC whenever Tax Applicable
     * is checked. Enforced on create and update.
     */
    private void validateGeneralDcGstin(String key, DocEntity e) {
        if (!"general-dc".equals(key) || !(e instanceof GeneralDc g)) return;
        if (Boolean.TRUE.equals(g.getTaxApplicable())
                && (g.getGstin() == null || g.getGstin().isBlank())) {
            throw new IllegalArgumentException("GSTIN is mandatory when Tax Applicable is checked on a General DC");
        }
    }

    private void validateDcStockAvailability(String key, DocEntity e) {
        if (!Set.of("jo-dc", "general-dc", "transfer-dc").contains(key)) return;

        if (e.getDocDate() != null && e.getDocDate().isAfter(LocalDate.now())) {
            throw new IllegalArgumentException("DC Date cannot be a future date");
        }

        String sourceLoc = headerStr(e, "sourceLocation");
        if (sourceLoc == null || sourceLoc.isBlank()) {
            throw new IllegalArgumentException("From Location is required");
        }

        if (e.getLines() == null || e.getLines().isEmpty()) {
            throw new IllegalArgumentException("Delivery Challan requires at least one line item");
        }

        boolean isJoReceiving = "jo-dc".equals(key) && e instanceof JoDc joDc && "Receiving after Job Work".equalsIgnoreCase(joDc.getChallanPurpose());

        for (LineEntity line : e.getLines()) {
            String itemCode = line.getItemCode();
            if (itemCode == null || itemCode.isBlank()) continue;
            BigDecimal qty = line.getQty();
            if (qty == null || qty.compareTo(BigDecimal.ZERO) <= 0) {
                throw new IllegalArgumentException("Line quantity for item " + itemCode + " must be greater than zero");
            }

            String checkLoc = isJoReceiving ? "Goods with Job Worker" : sourceLoc;
            String batchNo = line.getBatchNo() != null ? line.getBatchNo() : "";

            double available = stockService.available(itemCode, checkLoc);
            if (available < qty.doubleValue()) {
                throw new IllegalStateException("Quantity " + qty + " for item " + itemCode +
                        " exceeds available stock (" + available + ") at " + checkLoc);
            }
        }
    }

    private void reverseDcStock(String key, DocEntity e, String user) {
        if (e.getLines() == null) return;
        LocalDate now = LocalDate.now();
        if ("jo-dc".equals(key) && e instanceof JoDc joDc) {
            boolean isReceiving = "Receiving after Job Work".equalsIgnoreCase(joDc.getChallanPurpose());
            String sourceLoc = joDc.getSourceLocation();
            for (LineEntity line : joDc.getLines()) {
                if (isReceiving) {
                    stockService.recordStockOut(e.getDocNo(), key, "JO_DC_CANCEL", line.getItemCode(), sourceLoc, line.getBatchNo(), line.getHeatNo(), line.getQty(), now, user, true);
                    stockService.recordStockIn(e.getDocNo(), key, "JO_DC_CANCEL", line.getItemCode(), "Goods with Job Worker", line.getBatchNo(), line.getHeatNo(), line.getQty(), now, user, "FREE");
                } else {
                    stockService.recordStockOut(e.getDocNo(), key, "JO_DC_CANCEL", line.getItemCode(), "Goods with Job Worker", line.getBatchNo(), line.getHeatNo(), line.getQty(), now, user, true);
                    stockService.recordStockIn(e.getDocNo(), key, "JO_DC_CANCEL", line.getItemCode(), sourceLoc, line.getBatchNo(), line.getHeatNo(), line.getQty(), now, user, "FREE");
                }
            }
        } else if ("general-dc".equals(key) && e instanceof GeneralDc gDc) {
            String sourceLoc = gDc.getSourceLocation();
            for (LineEntity line : gDc.getLines()) {
                stockService.recordStockIn(e.getDocNo(), key, "GENERAL_DC_CANCEL", line.getItemCode(), sourceLoc, line.getBatchNo(), line.getHeatNo(), line.getQty(), now, user, "FREE");
            }
        } else if ("transfer-dc".equals(key) && e instanceof TransferDc tDc) {
            String sourceLoc = tDc.getSourceLocation();
            String destLoc = tDc.getDestinationLocation();
            boolean receiptConfirmed = Boolean.TRUE.equals(tDc.getReceiptConfirmed());
            boolean inTransit = Boolean.TRUE.equals(tDc.getInTransitTracking());
            for (LineEntity line : tDc.getLines()) {
                if (receiptConfirmed) {
                    stockService.recordStockOut(e.getDocNo(), key, "TRANSFER_DC_CANCEL", line.getItemCode(), destLoc, line.getBatchNo(), line.getHeatNo(), line.getQty(), now, user, true);
                    stockService.recordStockIn(e.getDocNo(), key, "TRANSFER_DC_CANCEL", line.getItemCode(), sourceLoc, line.getBatchNo(), line.getHeatNo(), line.getQty(), now, user, "FREE");
                } else if (inTransit) {
                    stockService.recordStockOut(e.getDocNo(), key, "TRANSFER_DC_CANCEL", line.getItemCode(), "In-Transit", line.getBatchNo(), line.getHeatNo(), line.getQty(), now, user, true);
                    stockService.recordStockIn(e.getDocNo(), key, "TRANSFER_DC_CANCEL", line.getItemCode(), sourceLoc, line.getBatchNo(), line.getHeatNo(), line.getQty(), now, user, "FREE");
                } else {
                    stockService.recordStockOut(e.getDocNo(), key, "TRANSFER_DC_CANCEL", line.getItemCode(), destLoc, line.getBatchNo(), line.getHeatNo(), line.getQty(), now, user, true);
                    stockService.recordStockIn(e.getDocNo(), key, "TRANSFER_DC_CANCEL", line.getItemCode(), sourceLoc, line.getBatchNo(), line.getHeatNo(), line.getQty(), now, user, "FREE");
                }
            }
        }
    }

    /**
     * DOCUMENT 02 v2.0 §03.2/03.3 (BR-INV-TRACE-1/2): records a doc_links row by
     * internal ID for every cross-document reference this doc type carries, reusing
     * the same reference-field-to-target-type mapping the validators above already
     * resolve. Called once per created document, after it has been assigned an ID.
     * Each lookup is best-effort: an optional/blank reference is simply skipped.
     */
    private void recordDocLinks(String key, DocEntity e, String user) {
        try {
            String targetType = null;
            String refNo = null;
            switch (key) {
                case "dc-return" -> { if (e instanceof DcReturn d) { refNo = d.getOriginalDcNumber(); targetType = originalDocTypeForDcReturn(d); } }
                case "invoice-return" -> { if (e instanceof InvoiceReturn d) { refNo = d.getOriginalInvoiceNumber(); targetType = "sales-invoice"; } }
                case "inward-return" -> { if (e instanceof InwardReturn d) { refNo = d.getOriginalDocumentNo(); targetType = "po-inward"; } }
                case "stock-return" -> {
                    if (e instanceof StockReturn d) {
                        refNo = d.getOriginalDocumentNo();
                        targetType = originalWhat("stock-return", "rm-issue", d, d.getOriginalIssueType());
                    }
                }
                case "receipt-return" -> { refNo = headerStr(e, "originalDocumentNo"); targetType = "rm-issue"; }
                case "rm-issue" -> { if (e instanceof RmIssue d) { refNo = d.getIssueRequestNo(); targetType = "stock-issue-request"; } }
                case "stock-release" -> { if (e instanceof StockRelease d) { refNo = d.getAllotmentNo(); targetType = "stock-allotment"; } }
                case "received-against-issue" -> {
                    if (e instanceof ReceivedAgainstIssue d) {
                        refNo = d.getOriginalDocumentNo();
                        if (refNo != null && !refNo.isBlank()) {
                            for (String t : ISSUE_SOURCE_TYPES) {
                                try {
                                    DocEntity target = getByNumber(t, refNo);
                                    docLinks.record(key, e.getId(), t, target.getId(), user);
                                } catch (IllegalArgumentException ignored) { /* not this issue type */ }
                            }
                        }
                        return;
                    }
                }
                case "grn" -> {
                    if (e instanceof Grn g) {
                        refNo = g.getSourceDocumentNo();
                        targetType = switch (String.valueOf(g.getSourceType())) {
                            case "LO_INWARD" -> "lo-inward";
                            case "JO_INWARD" -> "jo-inward";
                            case "GENERAL_INWARD" -> "general-inward";
                            case "RETURN_INWARD" -> "return-inward";
                            default -> "po-inward";
                        };
                    }
                }
                default -> { return; }
            }
            if (refNo == null || refNo.isBlank() || targetType == null) return;
            DocEntity target = getByNumber(targetType, refNo);
            docLinks.record(key, e.getId(), targetType, target.getId(), user);
        } catch (Exception ex) {
            log.warn("recordDocLinks skipped for {} {}: {}", key, e.getDocNo(), ex.getMessage());
        }
    }

    @Autowired @Lazy StockReturnConsumptionService consumptionAdjustment;
    @Autowired in.zygertechnology.zygererp.config.ApplicationProperties appProps;

    /**
     * DC Module FRS v1.0 / Return Management FRS v1.0 §2 B#3:
     * a DC Return references a Delivery Challan.  FRS §2 allows JO DC / General DC /
     * Transfer DC; the existing sales-dc legacy path is also supported for backward
     * compatibility.  We try the FRS types first and fall back to sales-dc.
     */
    private String originalDocTypeForDcReturn(DcReturn dr) {
        if (dr == null) return "jo-dc";
        for (String t : List.of("jo-dc", "general-dc", "transfer-dc", "sales-dc")) {
            try {
                getByNumber(t, dr.getOriginalDcNumber());
                return t;
            } catch (IllegalArgumentException ignored) {}
        }
        return "jo-dc";
    }

    /**
     * Return Management FRS v1.0 §2 B#3: Stock Return references a Stock Issue document.
     * The original issue type is either provided by the frontend via
     * {@code StockReturn.originalIssueType} or resolved by probing the known issue
     * types for the given document number.  If {@code explicitHint} is provided and
     * valid it is tried first.
     */
    private String originalWhat(String returnKey, String defaultType, DocEntity e, String explicitHint) {
        String issueNo = switch (returnKey) {
            case "stock-return" -> e instanceof StockReturn sr ? sr.getOriginalDocumentNo() : "";
            case "dc-return" -> e instanceof DcReturn dr ? dr.getOriginalDcNumber() : "";
            default -> "";
        };
        if (issueNo == null || issueNo.isBlank()) return defaultType;

        if (explicitHint != null && !explicitHint.isBlank()) {
            try {
                getByNumber(explicitHint, issueNo);
                return explicitHint;
            } catch (IllegalArgumentException ignored) {}
        }

        for (String t : List.of("rm-issue", "general-issue", "issue-internal-external")) {
            try {
                getByNumber(t, issueNo);
                return t;
            } catch (IllegalArgumentException ignored) {}
        }
        return defaultType;
    }

    // ---------- Return Management FRS v1.0 §6 / §7 / §8 / §9 -------------------

    private void afterPostReturnHooks(String key, DocEntity e, String user) {
        updateSourceReturnStatus(key, e, user);
        if ("stock-return".equals(key) && e instanceof StockReturn sr) {
            reduceStockReturnConsumption(sr, user);
        }
    }

    private void updateSourceReturnStatus(String key, DocEntity e, String user) {
        String srcType = null;
        String srcNo = null;
        if ("dc-return".equals(key) && e instanceof DcReturn dr) {
            srcType = originalDocTypeForDcReturn(dr);
            srcNo  = dr.getOriginalDcNumber();
        } else if ("invoice-return".equals(key) && e instanceof InvoiceReturn ir) {
            srcType = "sales-invoice";
            srcNo  = ir.getOriginalInvoiceNumber();
        } else if ("stock-return".equals(key) && e instanceof StockReturn sr) {
            srcType = originalWhat("stock-return", "rm-issue", sr, sr.getOriginalIssueType());
            srcNo  = sr.getOriginalDocumentNo();
        }
        if (srcType == null || srcNo == null || srcNo.isBlank()) return;
        try {
            DocEntity src = getByNumber(srcType, srcNo);
            if ("CANCELLED".equals(src.getStatus())) return;
            if (!(src instanceof DocEntity de)) return;
            BigDecimal totalReturned = computeTotalReturned(srcType, srcNo, key, e.getDocNo());
            BigDecimal originalQty = computeOriginalIssueQty(srcType, srcNo);
            if (originalQty.compareTo(BigDecimal.ZERO) <= 0) return;
            String target = totalReturned.compareTo(originalQty) >= 0 ? "FULLY_RETURNED" : "PARTIALLY_RETURNED";
            if (!target.equals(src.getStatus())) {
                de.setStatus(target);
                de.setUpdatedBy(user);
                de.setUpdatedAt(Instant.now());
            }
        } catch (Exception ex) {
            log.warn("updateSourceReturnStatus skipped for {} {}: {}", key, e.getDocNo(), ex.getMessage());
        }
    }

    private BigDecimal computeTotalReturned(String srcType, String srcNo, String ignoreReturnKey, String ignoreReturnDocNo) {
        BigDecimal total = BigDecimal.ZERO;
        for (String rt : List.of("dc-return", "invoice-return", "stock-return")) {
            String lineClass = switch (rt) {
                case "dc-return" -> "DcReturnLine";
                case "stock-return" -> "StockReturnLine";
                default -> "InvoiceReturnLine";
            };
            String origField = switch (rt) {
                case "dc-return" -> "doc.originalDcNumber";
                case "invoice-return" -> "doc.originalInvoiceNumber";
                default -> "doc.originalDocumentNo";
            };
            try {
                String qtyField = switch (rt) {
                    case "dc-return", "invoice-return" -> "currentReturnQty";
                    default -> "returnedQty";
                };
                BigDecimal sum = (BigDecimal) em.createQuery(
                    "SELECT COALESCE(SUM(" + qtyField + "), 0) FROM " + lineClass + " l " +
                    "WHERE l.doc.status = 'POSTED' AND " + origField + " = :origNo AND l.doc.docNo != :ignoreDocNo")
                    .setParameter("origNo", srcNo)
                    .setParameter("ignoreDocNo", ignoreReturnDocNo)
                    .getSingleResult();
                total = total.add(sum != null ? sum : BigDecimal.ZERO);
            } catch (Exception ignored) {}
        }
        return total;
    }

    private BigDecimal computeOriginalIssueQty(String srcType, String srcNo) {
        try {
            DocEntity src = getByNumber(srcType, srcNo);
            BigDecimal qty = BigDecimal.ZERO;
            for (LineEntity l : src.getLines()) {
                qty = qty.add(l.getQty() != null ? l.getQty() : BigDecimal.ZERO);
            }
            return qty;
        } catch (Exception e) { return BigDecimal.ZERO; }
    }

    private void reduceStockReturnConsumption(StockReturn sr, String user) {
        try {
            String issueNo = sr.getOriginalDocumentNo();
            if (issueNo == null || issueNo.isBlank()) return;
            RmIssue rmIssue = (RmIssue) getByNumber("rm-issue", issueNo);
            String jobCardNo = rmIssue.getJobOrderNo();
            if (jobCardNo == null || jobCardNo.isBlank()) return;

            for (StockReturnLine line : sr.getLines()) {
                BigDecimal retQty = line.getReturnedQty();
                if (retQty == null || retQty.signum() <= 0) continue;
                String stockStatus = line.getStockStatus();
                if ("DAMAGED".equalsIgnoreCase(stockStatus) || "SCRAP".equalsIgnoreCase(stockStatus)) continue;
                consumptionAdjustment.reduceConsumedQty(jobCardNo, line.getItemCode(),
                        line.getBatchNo() != null ? line.getBatchNo() : "", retQty, user);
            }
        } catch (Exception ex) {
            log.warn("reduceStockReturnConsumption skipped for {}: {}", sr.getDocNo(), ex.getMessage());
        }
    }

    // ---------- Cancel-reverse for returns (FRS §7 B#5) --------------------------

    private void reverseReturnStock(String key, DocEntity e, String user) {
        if (e.getLines() == null) return;
        LocalDate now = LocalDate.now();
        String sourceLoc = headerStr(e, "sourceLocation");
        for (LineEntity line : e.getLines()) {
            String stockStatus = "FREE";
            try {
                if (e instanceof DcReturn dr && dr.getDisposition() != null) {
                    stockStatus = returnStockStatus(dr.getDisposition());
                } else if (e instanceof InvoiceReturn ir && ir.getDisposition() != null) {
                    stockStatus = returnStockStatus(ir.getDisposition());
                } else if (e instanceof StockReturn sr) {
                    stockStatus = returnStockStatus(headerStr(e, "condition"));
                }
            } catch (Exception ignored) {}

            String loc = stockStatus.equals("FREE") && !sourceLoc.isBlank() ? sourceLoc : findReturnReverseLocation(e, stockStatus);
            stockService.recordStockOut(e.getDocNo(), key, key.toUpperCase().replace("-", "_") + "_CANCEL",
                    line.getItemCode(), loc, line.getBatchNo(), line.getHeatNo(),
                    line.getQty(), now, user, true);
        }
    }

    private String findReturnReverseLocation(DocEntity e, String stockStatus) {
        if ("FREE".equals(stockStatus)) return headerStr(e, "sourceLocation");
        return headerStr(e, "sourceLocation");
    }

    private String returnStockStatus(String condition) {
        if (condition == null) return "FREE";
        return switch (condition.toUpperCase()) {
            case "DAMAGED" -> "DAMAGED";
            case "REJECTED" -> "REJECTED";
            case "SCRAP" -> "SCRAP";
            default -> "FREE";
        };
    }

    /**
     * Inward Entry FRD v2.0 §9.3: reverses the stock a POSTED inward document added, as an
     * equal-and-opposite stock-out per line. recordStockOut's own verifyStockAvailability
     * check is what blocks cancellation when the receipt (or part of it) has already been
     * consumed downstream — this deliberately reuses that guard rather than duplicating it,
     * surfacing a clearer message on the way out.
     */
    private void reverseInwardStock(String key, DocEntity e, String user) {
        if (e.getLines() == null) return;
        LocalDate now = LocalDate.now();
        String txType = key.toUpperCase().replace("-", "_") + "_CANCEL";
        for (LineEntity line : e.getLines()) {
            // Only the Accepted Qty was ever posted (see collectLines()) — reversing the raw
            // Received Qty here would overshoot whatever's actually in stock for this line.
            BigDecimal qty = DIRECT_POST_INWARD_KEYS.contains(key) ? line.getAcceptedQty() : line.getQty();
            if (qty == null || qty.compareTo(BigDecimal.ZERO) <= 0) continue;
            String loc = line.getLocation() != null && !line.getLocation().isBlank()
                    ? line.getLocation() : "MAIN";
            try {
                stockService.reverseInwardStock(e.getDocNo(), key, txType,
                        line.getItemCode(), loc, line.getBatchNo(), line.getHeatNo(),
                        qty, now, user);
            } catch (IllegalArgumentException ex) {
                throw new IllegalStateException("Cannot cancel " + e.getDocNo() + ": item " + line.getItemCode()
                        + " at " + loc + " has already been partly or fully consumed downstream. "
                        + "Use Stock Adjustment / Return instead. (" + ex.getMessage() + ")", ex);
            }
        }
    }

    // ---------- Threshold auto-approval routing (Allotment & Adjustment FRS §5/§6) -

    private boolean amendmentExceedsThreshold(String key, DocEntity e) {
        if ("stock-amendment".equals(key) && e instanceof StockAmendment sa) {
            BigDecimal diff = sa.getDifferenceQty();
            if (diff == null) diff = BigDecimal.ZERO;
            // Stock Allotment & Adjustment FRS v1.0 §5: threshold is on absolute
            // difference quantity (value threshold is reserved for when a rate is
            // carried; none of the amendment entities exposes one today).
            return diff.abs().doubleValue() >= appProps.getAdjustmentThresholdQty();
        }
        if ("physical-stock-amendment".equals(key) && e instanceof PhysicalStockAmendment psa) {
            for (PhysicalStockAmendmentLine pl : psa.getLines()) {
                BigDecimal system = pl.getSystemQty() == null ? BigDecimal.ZERO : pl.getSystemQty();
                BigDecimal physical = pl.getPhysicalQty() == null ? BigDecimal.ZERO : pl.getPhysicalQty();
                BigDecimal variancePct = (system.compareTo(BigDecimal.ZERO) == 0)
                        ? (physical.compareTo(BigDecimal.ZERO) == 0 ? BigDecimal.ZERO : BigDecimal.valueOf(100))
                        : physical.subtract(system).abs()
                            .divide(system, 6, java.math.RoundingMode.HALF_UP)
                            .multiply(BigDecimal.valueOf(100));
                if (variancePct.doubleValue() >= appProps.getPhysicalVarianceTolerancePct()) {
                    return true;
                }
            }
        }
        return false;
    }

    private void applyThresholdRouting(String key, DocEntity e) {
        if (!Set.of("stock-amendment", "physical-stock-amendment").contains(key)) return;
        if (amendmentExceedsThreshold(key, e)) {
            throw new BusinessRuleException("APPROVAL_REQUIRED_THRESHOLD",
                    "Adjustment exceeds configured tolerance — has been routed for approval",
                    Map.of("docKey", key, "docId", e.getId() != null ? e.getId() : 0));
        }
    }

    /** Blocks posting an out-of-tolerance amendment unless it has explicit approval. */
    private void requireThresholdApproved(String key, DocEntity e) {
        if (!Set.of("stock-amendment", "physical-stock-amendment").contains(key)) return;
        if (amendmentExceedsThreshold(key, e) && !"APPROVED".equals(e.getStatus())) {
            throw new IllegalStateException(
                    "Adjustment exceeds configured tolerance — requires explicit approval before posting");
        }
    }

    private String systemUser(DocEntity e) {
        String u = e.getUpdatedBy();
        return (u == null || u.isBlank()) ? "system" : u;
    }

    // ---------- Source-line lookup endpoint for return forms ----------------------

    public record SourceLineInfo(String itemCode, String itemDesc, BigDecimal originalQty, BigDecimal alreadyReturned, String condition) {}
    public record ReturnSourceLookup(List<SourceLineInfo> lines, BigDecimal totalOriginal, BigDecimal totalReturned) {}

    public ReturnSourceLookup getReturnSourceLines(String key, String docNo) {
        return getReturnSourceLines(key, docNo, null);
    }

    public ReturnSourceLookup getReturnSourceLines(String key, String docNo, String sourceTypeHint) {
        String origDocType = switch (key) {
            case "dc-return" -> "jo-dc";
            case "invoice-return" -> "sales-invoice";
            case "stock-return" -> "rm-issue";
            default -> "";
        };
        if (sourceTypeHint != null && !sourceTypeHint.isBlank()) {
            try { getByNumber(sourceTypeHint, docNo); origDocType = sourceTypeHint; } catch (IllegalArgumentException ignored) {}
        }
        if ("dc-return".equals(key)) {
            for (String t : List.of("jo-dc", "general-dc", "transfer-dc", "sales-dc")) {
                try { getByNumber(t, docNo); origDocType = t; break; } catch (IllegalArgumentException ignored) {}
            }
        }
        try {
            DocEntity origDoc = getByNumber(origDocType, docNo);
            Map<String, SourceLineInfo> byKey = new LinkedHashMap<>();
            for (LineEntity l : origDoc.getLines()) {
                String ik = l.getItemCode() + "|" + (l.getBatchNo() == null ? "" : l.getBatchNo());
                BigDecimal origQty = l.getQty() != null ? l.getQty() : BigDecimal.ZERO;
                String desc = itemCache.findByCode(l.getItemCode()).map(ItemMaster::getDescription).orElse("");
                byKey.computeIfAbsent(ik, k -> new SourceLineInfo(ik.split("\\|")[0], desc, BigDecimal.ZERO, BigDecimal.ZERO, null));
                SourceLineInfo cur = byKey.get(ik);
                byKey.put(ik, new SourceLineInfo(cur.itemCode(), desc, cur.originalQty().add(origQty), cur.alreadyReturned(), null));
            }
            BigDecimal totalOriginal = BigDecimal.ZERO;
            BigDecimal totalReturned = BigDecimal.ZERO;
            List<SourceLineInfo> out = new ArrayList<>();
            for (SourceLineInfo si : byKey.values()) {
                BigDecimal alreadyReturned = BigDecimal.ZERO;
                try {
                    String lineClass = switch (key) {
                        case "dc-return" -> "DcReturnLine";
                        case "stock-return" -> "StockReturnLine";
                        default -> "InvoiceReturnLine";
                    };
                    String origField = switch (key) {
                        case "dc-return" -> "doc.originalDcNumber";
                        case "invoice-return" -> "doc.originalInvoiceNumber";
                        default -> "doc.originalDocumentNo";
                    };
                    String qtyField = switch (key) {
                        case "dc-return", "invoice-return" -> "currentReturnQty";
                        default -> "returnedQty";
                    };
                    alreadyReturned = (BigDecimal) em.createQuery(
                        "SELECT COALESCE(SUM(l." + qtyField + "), 0) FROM " + lineClass + " l " +
                        "WHERE l.doc.status = 'POSTED' AND " + origField + " = :origNo AND l.itemCode = :itemCode")
                        .setParameter("origNo", docNo)
                        .setParameter("itemCode", si.itemCode())
                        .getSingleResult();
                    if (alreadyReturned == null) alreadyReturned = BigDecimal.ZERO;
                } catch (Exception ignored) {}
                totalOriginal = totalOriginal.add(si.originalQty());
                totalReturned = totalReturned.add(alreadyReturned);
                out.add(new SourceLineInfo(si.itemCode(), si.itemDesc(), si.originalQty(), alreadyReturned, null));
            }
            return new ReturnSourceLookup(out, totalOriginal, totalReturned);
        } catch (Exception e) {
            return new ReturnSourceLookup(List.of(), BigDecimal.ZERO, BigDecimal.ZERO);
        }
    }
}
