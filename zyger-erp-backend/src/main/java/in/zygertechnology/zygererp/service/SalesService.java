package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import in.zygertechnology.zygererp.repo.PartyRepository;
import in.zygertechnology.zygererp.repo.ItemRepository;
import in.zygertechnology.zygererp.repo.CompanyInfoRepository;
import in.zygertechnology.zygererp.repo.MachineMasterRepository;
import in.zygertechnology.zygererp.repo.CostingPolicyRepository;
import in.zygertechnology.zygererp.security.RbacServiceBridge;
import in.zygertechnology.zygererp.integration.EInvoiceProvider;
import in.zygertechnology.zygererp.integration.EInvoiceResult;
import in.zygertechnology.zygererp.integration.EWayBillProvider;
import in.zygertechnology.zygererp.integration.EWayBillResult;
import in.zygertechnology.zygererp.config.BusinessRuleException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.beans.factory.annotation.Value;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

@Service
@RequiredArgsConstructor
public class SalesService {

    static final Set<String> SALES_KEYS = Set.of(
            "sales-order", "proforma-invoice", "sales-dc",
            "sales-invoice", "dc-return", "invoice-return",
            "payment-receipt", "credit-debit-note",
            "enquiry", "quotation"
    );

    private final DocumentFacade docs;
    private final PartyRepository parties;
    private final ItemRepository items;
    private final StockService stockService;
    private final CompanyInfoRepository companyInfos;
    private final MachineMasterRepository machines;
    private final CostingPolicyRepository costingPolicies;
    private final RbacServiceBridge rbac;
    private final NotificationService notifications;
    private final EInvoiceProvider einvoiceProvider;
    private final EWayBillProvider ewayBillProvider;
    private final EmailService emailService;
    private final PrintService printer;
    @PersistenceContext
    private EntityManager em;

    @Value("${app.sales.einvoice-required:false}")
    private boolean einvoiceRequired;
    @Value("${app.sales.eway-bill-required:false}")
    private boolean ewayBillRequired;
    @Value("${app.sales.eway-bill-threshold:50000}")
    private BigDecimal ewayBillThreshold;

    public boolean isSales(String key) { return SALES_KEYS.contains(key); }

    @Transactional
    public DocEntity create(String key, Map<String, Object> body, String user) {
        validateReferences(key, body);
        body.put("createdBy", user);
        preProcessBody(key, body);
        DocEntity e = docs.create(key, body, user);
        applyCreationDefaults(key, e);
        return e;
    }

    /** Most Sales edit paths need nothing beyond the generic update — but Quotation's
     * cost-buildup must be "computed server-side on save/recompute, not purely
     * client-side" per the FRS, for every save, not only the first. This deliberately
     * does NOT reuse applyCreationDefaults() wholesale: several of its other cases
     * (Enquiry forcing status back to NEW, Payment Receipt resetting
     * unallocatedBalance to the full amount received) are only safe as one-time
     * creation defaults — replaying them on every edit would silently undo an
     * in-progress workflow. */
    @Transactional
    public DocEntity update(String key, Long id, Map<String, Object> body, String user) {
        preProcessBody(key, body);
        DocEntity e = docs.update(key, id, body, user);
        if ("quotation".equals(key) && e instanceof SalesQuotation q) {
            computeQuotationCosting(q);
        }
        return e;
    }

    private void validateReferences(String key, Map<String, Object> body) {
        String customerCode = (String) body.get("customerCode");
        if ((customerCode == null || customerCode.isBlank()) && body.get("customer") != null) {
            String custName = String.valueOf(body.get("customer"));
            parties.findByName(custName).ifPresent(p -> body.put("customerCode", p.getCode()));
            customerCode = (String) body.get("customerCode");
        }

        if (customerCode != null && !customerCode.isBlank()) {
            if (parties.existsByCode(customerCode)) {
                BigDecimal orderAmount = computeOrderAmount(key, body);
                validateCustomerCredit(customerCode, orderAmount);
            }
        }
    }

    private BigDecimal computeOrderAmount(String key, Map<String, Object> body) {
        if (!"sales-order".equals(key)) return null;
        Object linesObj = body.get("lines");
        if (!(linesObj instanceof List<?> lineList)) return null;
        BigDecimal total = BigDecimal.ZERO;
        for (Object obj : lineList) {
            if (!(obj instanceof Map<?, ?> m)) continue;
            BigDecimal qty = toBD(m.get("orderQty"));
            BigDecimal rate = toBD(m.get("unitPrice"));
            total = total.add(qty.multiply(rate));
        }
        return total;
    }

    private BigDecimal toBD(Object v) {
        if (v == null) return BigDecimal.ZERO;
        try { return new BigDecimal(String.valueOf(v)); } catch (Exception e) { return BigDecimal.ZERO; }
    }

    private void validateCustomerCredit(String customerCode, BigDecimal orderAmount) {
        if (customerCode == null || customerCode.isBlank()) return;
        try {
            parties.findByCode(customerCode).ifPresent(party -> {
                if (Boolean.TRUE.equals(party.getCreditHold())) {
                    throw new IllegalArgumentException("Customer '" + party.getName() + "' is currently on Credit Hold (" +
                            (party.getCreditHoldReason() != null ? party.getCreditHoldReason() : "Reason unspecified") + ")");
                }
                if (party.getCreditLimit() != null && party.getCreditLimit().compareTo(BigDecimal.ZERO) > 0 && orderAmount != null) {
                    BigDecimal totalBiz = party.getTotalBusiness() != null ? party.getTotalBusiness() : BigDecimal.ZERO;
                    BigDecimal proposed = totalBiz.add(orderAmount);
                    if (proposed.compareTo(party.getCreditLimit()) > 0) {
                        throw new IllegalArgumentException("Credit limit exceeded for Customer '" + party.getName() + "'. Limit: " +
                                party.getCreditLimit() + ", Current Total: " + proposed);
                    }
                }
            });
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception ignored) {
            // Guard against any null unboxing or missing optional relation errors
        }
    }

    /** FRS §7 (TBD-SALES-001): maps a workflow action to the specific permission
     * action-code it requires, beyond the blanket SALES:*:VIEW every Sales endpoint
     * already requires. Actions not listed here (submit, reopen, revise, the
     * convert-* actions, mark-lost, send-to-customer) stay gated by VIEW alone —
     * they're either low-risk data entry or already gated by their own status
     * preconditions in DocumentFacade. */
    private void enforceActionPermission(String key, Long id, String action, String user) {
        String permAction = switch (action) {
            case "post", "reverse", "allocate" -> "POST";
            case "cancel" -> "CANCEL";
            case "approve", "reject" -> tierAwareApprovalPermission(key, id);
            default -> null;
        };
        if (permAction == null) return;
        if (!rbac.hasPermission(user, "SALES", "*", permAction)) {
            throw new AccessDeniedException("User '" + user + "' lacks SALES:*:" + permAction +
                    " permission required for action '" + action + "'");
        }
    }

    /** Tier 0-3 approvals are distinct permissions (APPROVE_T1/T2/T3) per the tier
     * router (D3/§3.2) — a Tier 1 approver must not be able to wave through a Tier 3
     * (export / new-customer, dual-sign-off) document just because both actions are
     * literally named "approve". Falls back to the flat APPROVE code for doc types
     * that were never tiered (Payment Receipt, Credit Note, Quotation, returns, etc). */
    private String tierAwareApprovalPermission(String key, Long id) {
        try {
            DocEntity e = docs.get(key, id);
            String status = e.getStatus();
            if ("PENDING_TIER1".equals(status)) return "APPROVE_T1";
            if ("PENDING_TIER2".equals(status)) return "APPROVE_T2";
            if ("PENDING_TIER3".equals(status)) return "APPROVE_T3";
        } catch (Exception ignored) {
            // Doc not found — let the normal action flow surface that error instead.
        }
        return "APPROVE";
    }

    /** Technical Design §3.2 tier router, implemented literally as the spec's
     * if/elif chain (not reordered) — evaluated once, on submit:
     * <pre>
     * if orderValue &lt; T0 and margin ok and not on watchlist:       -&gt; APPROVED (auto)
     * elif orderValue &lt; T1 and discount &lt;= 10%:                    -&gt; PENDING_TIER1
     * elif orderValue &lt; T2 or discount &gt; 10% or margin &lt; floor:    -&gt; PENDING_TIER2
     * elif isExport or newCustomerNoHistory:                        -&gt; PENDING_TIER3
     * else:                                                         -&gt; PENDING_TIER2 (spec has no
     *                                                                   final default; a large order that
     *                                                                   matches none of the above still
     *                                                                   needs a human, so it lands at
     *                                                                   Tier 2 rather than auto-approving)
     * </pre>
     * "watchlist" maps to the existing Party.creditHold flag (no separate watchlist
     * concept exists in this codebase); margin is only known when this SO traces back
     * to a costed Quotation (quotationRef) — otherwise treated as "not below floor"
     * rather than penalizing an order this system has no cost data for. */
    private void applyTierRouting(SalesOrder so) {
        CostingPolicy policy = costingPolicies.findFirstByActiveTrue().orElseGet(CostingPolicy::new);

        BigDecimal orderValue = BigDecimal.ZERO;
        BigDecimal maxDiscountPct = BigDecimal.ZERO;
        if (so.getLines() != null) {
            for (SalesOrderItem item : (List<SalesOrderItem>) so.getLines()) {
                BigDecimal qty = item.getOrderQty() == null ? BigDecimal.ZERO : item.getOrderQty();
                BigDecimal rate = item.getUnitPrice() == null ? BigDecimal.ZERO : item.getUnitPrice();
                BigDecimal lineGross = qty.multiply(rate);
                orderValue = orderValue.add(lineGross);
                BigDecimal discount = item.getDiscount();
                if (lineGross.signum() > 0 && discount != null && discount.signum() > 0) {
                    BigDecimal discPct = discount.divide(lineGross, 6, RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(100));
                    if (discPct.compareTo(maxDiscountPct) > 0) maxDiscountPct = discPct;
                }
            }
        }

        boolean isExport = so.getCurrency() != null && !so.getCurrency().toUpperCase().startsWith("INR");
        boolean isNewCustomer = isNewCustomerNoHistory(so.getCustomerCode());
        boolean onWatchlist = isOnCreditHold(so.getCustomerCode());
        BigDecimal marginPct = quotationMarginFor(so.getQuotationRef());
        boolean marginOk = marginPct == null || marginPct.compareTo(policy.getMarginFloorPercent()) >= 0;
        boolean marginBelowFloor = marginPct != null && marginPct.compareTo(policy.getMarginFloorPercent()) < 0;

        String target;
        if (orderValue.compareTo(policy.getTier0CeilingAmount()) < 0 && marginOk && !onWatchlist) {
            target = "APPROVED";
        } else if (orderValue.compareTo(policy.getTier1CeilingAmount()) < 0
                && maxDiscountPct.compareTo(policy.getTier1DiscountCeilingPercent()) <= 0) {
            target = "PENDING_TIER1";
        } else if (orderValue.compareTo(policy.getTier2CeilingAmount()) < 0
                || maxDiscountPct.compareTo(policy.getTier1DiscountCeilingPercent()) > 0
                || marginBelowFloor) {
            target = "PENDING_TIER2";
        } else if (isExport || isNewCustomer) {
            target = "PENDING_TIER3";
        } else {
            target = "PENDING_TIER2";
        }

        so.setStatus(target);
        if ("APPROVED".equals(target)) {
            so.setApprovedAt(Instant.now());
        }

        // E5: "Document submitted for approval" -> the approver(s) for the tier it
        // landed on; Tier 0 auto-approves, so there's no one to notify.
        if (!"APPROVED".equals(target)) {
            String approverRole = switch (target) {
                case "PENDING_TIER1" -> "SALES_MANAGER";
                case "PENDING_TIER2" -> "DIRECTOR";
                case "PENDING_TIER3" -> "DIRECTOR,FINANCE";
                default -> "SALES_MANAGER";
            };
            notifications.notify("SUBMITTED_FOR_APPROVAL", "SALES", "sales-order", so.getId(), "INFO",
                    "Sales Order " + so.getDocNo() + " (" + formatMoney(orderValue) + ") is awaiting " +
                            approverRole + " approval", so.getDocNo());
        }
    }

    private String formatMoney(BigDecimal amount) {
        return "₹" + (amount == null ? "0" : amount.setScale(0, RoundingMode.HALF_UP).toPlainString());
    }

    private boolean isNewCustomerNoHistory(String customerCode) {
        try {
            return parties.findByCode(customerCode)
                    .map(p -> p.getTotalBusiness() == null || p.getTotalBusiness().signum() <= 0)
                    .orElse(true);
        } catch (Exception e) {
            return false;
        }
    }

    private boolean isOnCreditHold(String customerCode) {
        try {
            return parties.findByCode(customerCode).map(p -> Boolean.TRUE.equals(p.getCreditHold())).orElse(false);
        } catch (Exception e) {
            return false;
        }
    }

    /** Best-effort: the blended margin of the Quotation this SO was converted from,
     * averaged across its lines weighted by qty. Returns null (unknown) for an SO
     * created directly, not via Quotation — the tier router treats unknown margin as
     * "not below floor" rather than blocking every non-quotation order at Tier 2. */
    private BigDecimal quotationMarginFor(String quotationRef) {
        if (quotationRef == null || quotationRef.isBlank()) return null;
        try {
            DocEntity qd = docs.getByNumberOrNull("quotation", quotationRef);
            if (!(qd instanceof SalesQuotation q) || q.getLines() == null || q.getLines().isEmpty()) return null;
            BigDecimal weightedSum = BigDecimal.ZERO;
            BigDecimal totalQty = BigDecimal.ZERO;
            for (SalesQuotationLine l : (List<SalesQuotationLine>) q.getLines()) {
                if (l.getMarginPercent() == null || l.getQty() == null) continue;
                weightedSum = weightedSum.add(l.getMarginPercent().multiply(l.getQty()));
                totalQty = totalQty.add(l.getQty());
            }
            if (totalQty.signum() <= 0) return null;
            return weightedSum.divide(totalQty, 4, RoundingMode.HALF_UP);
        } catch (Exception e) {
            return null;
        }
    }

    /** Per-item quantity already dispatched against this Sales Order, summed across
     * every Sales DC that references it and has actually moved stock (POSTED or
     * later) — not tracked per-line on SalesOrderItem itself, so this is derived. */
    private Map<String, BigDecimal> dispatchedQtyByItem(String soDocNo) {
        Map<String, BigDecimal> result = new HashMap<>();
        List<Object[]> rows = em.createQuery(
                "select l.itemCode, coalesce(sum(coalesce(l.currentDispatchQty, l.qty)), 0) " +
                "from SalesDcLine l where (l.doc.salesOrderNo = :soNo or l.doc.salesOrderNumber = :soNo) " +
                "and l.doc.status in ('POSTED','DISPATCHED','PARTIALLY_DISPATCHED','CONFIRMED') " +
                "group by l.itemCode", Object[].class)
                .setParameter("soNo", soDocNo)
                .getResultList();
        for (Object[] r : rows) {
            if (r[0] == null) continue;
            result.merge((String) r[0], (BigDecimal) r[1], BigDecimal::add);
        }
        return result;
    }

    private Map<String, BigDecimal> invoicedQtyByItem(String soDocNo) {
        Map<String, BigDecimal> result = new HashMap<>();
        List<Object[]> rows = em.createQuery(
                "select l.itemCode, coalesce(sum(l.qty), 0) " +
                "from SalesInvoiceItem l where (l.doc.salesOrderNo = :soNo or l.doc.salesOrderNumber = :soNo) " +
                "and l.doc.status in ('POSTED','PARTIALLY_PAID','PAID') " +
                "group by l.itemCode", Object[].class)
                .setParameter("soNo", soDocNo)
                .getResultList();
        for (Object[] r : rows) {
            if (r[0] == null) continue;
            result.merge((String) r[0], (BigDecimal) r[1], BigDecimal::add);
        }
        return result;
    }

    /** BR-NEW-009 / D8: preview screen before committing an amendment — shows what's
     * already shipped/invoiced per line so Sales can see the floor a quantity
     * reduction can't cross before they attempt it. */
    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public Map<String, Object> amendImpact(Long soId) {
        DocEntity ed = docs.get("sales-order", soId);
        if (!(ed instanceof SalesOrder so)) throw new IllegalArgumentException("Not a sales order: " + soId);

        Map<String, BigDecimal> dispatched = dispatchedQtyByItem(so.getDocNo());
        Map<String, BigDecimal> invoiced = invoicedQtyByItem(so.getDocNo());
        List<Map<String, Object>> linesAffected = new ArrayList<>();
        if (so.getLines() != null) {
            for (SalesOrderItem item : (List<SalesOrderItem>) so.getLines()) {
                BigDecimal d = dispatched.getOrDefault(item.getItemCode(), BigDecimal.ZERO);
                BigDecimal inv = invoiced.getOrDefault(item.getItemCode(), BigDecimal.ZERO);
                Map<String, Object> lm = new LinkedHashMap<>();
                lm.put("lineNo", item.getLineNo());
                lm.put("itemCode", item.getItemCode());
                lm.put("orderQty", item.getOrderQty());
                lm.put("dispatchedQty", d);
                lm.put("invoicedQty", inv);
                lm.put("minAllowedQty", d);
                lm.put("requiresReapproval", true);
                linesAffected.add(lm);
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("soDocNo", so.getDocNo());
        result.put("soStatus", so.getStatus());
        result.put("linesAffected", linesAffected);
        return result;
    }

    /** BR-NEW-009: commits an amendment — replaces the SO's lines with the proposed
     * set after hard-blocking any line whose new quantity would fall below what's
     * already been dispatched for that item, then re-evaluates the tier router (D8:
     * "required re-approval if the change breaches the original approval's tier" —
     * approximated here by simply re-running the same router a fresh submit would
     * use; if the amended order still qualifies for auto-approval it stays APPROVED
     * with no extra step, otherwise it lands back in the appropriate PENDING_TIERn). */
    @SuppressWarnings("unchecked")
    private DocEntity amendSalesOrder(Long soId, Map<String, Object> opts, String user) {
        DocEntity ed = docs.get("sales-order", soId);
        if (!(ed instanceof SalesOrder so)) throw new IllegalArgumentException("Not a sales order: " + soId);
        if (!Set.of("APPROVED", "PARTIALLY_DISPATCHED", "DISPATCHED").contains(so.getStatus())) {
            throw new IllegalStateException("Only an APPROVED (or already dispatching) Sales Order can be amended, not " + so.getStatus());
        }
        Object linesObj = opts.get("lines");
        if (!(linesObj instanceof List<?> lineList) || lineList.isEmpty()) {
            throw new IllegalArgumentException("Amendment requires a lines array");
        }

        Map<String, BigDecimal> dispatched = dispatchedQtyByItem(so.getDocNo());
        List<SalesOrderItem> newLines = new ArrayList<>();
        BigDecimal totalOrdered = BigDecimal.ZERO;
        int lineNo = 1;
        for (Object o : lineList) {
            if (!(o instanceof Map<?, ?> m)) continue;
            String itemCode = String.valueOf(m.get("itemCode"));
            BigDecimal newQty = toBD(m.get("orderQty") != null ? m.get("orderQty") : m.get("qty"));
            BigDecimal alreadyDispatched = dispatched.getOrDefault(itemCode, BigDecimal.ZERO);
            if (newQty.compareTo(alreadyDispatched) < 0) {
                throw new IllegalArgumentException("Cannot reduce " + itemCode + " to " + newQty +
                        " — " + alreadyDispatched + " already dispatched (BR-NEW-009)");
            }
            SalesOrderItem item = new SalesOrderItem();
            item.setLineNo(lineNo++);
            item.setItemCode(itemCode);
            item.setOrderQty(newQty);
            item.setUnitPrice(toBD(m.get("unitPrice")));
            item.setDiscount(toBD(m.get("discount")));
            item.setTax(toBD(m.get("tax")));
            item.setUom(m.get("uom") != null ? String.valueOf(m.get("uom")) : null);
            item.setDescription(m.get("description") != null ? String.valueOf(m.get("description")) : null);
            item.setNetAmount(newQty.multiply(item.getUnitPrice()).subtract(item.getDiscount()));
            item.setDoc(so);
            newLines.add(item);
            totalOrdered = totalOrdered.add(newQty);
        }

        so.getLines().clear();
        so.getLines().addAll(newLines);
        so.setOrderedQty(totalOrdered);
        BigDecimal dispatchedTotal = so.getDispatchedQty() == null ? BigDecimal.ZERO : so.getDispatchedQty();
        so.setPendingQty(totalOrdered.subtract(dispatchedTotal));
        // Collapses the spec's two-step APPROVED -> AMENDMENT_IN_PROGRESS -> [commit]
        // into one action; applyTierRouting immediately decides the landing status
        // (APPROVED if the amendment doesn't breach tier, PENDING_TIERn if it does).
        applyTierRouting(so);
        so.setUpdatedAt(Instant.now());
        so.setUpdatedBy(user);
        return so;
    }

    /** BR-NEW-001: re-runs {@link #validateCustomerCredit} at the DC-post and
     * Invoice-post gate points. A Sales DC carries no monetary total of its own
     * (it's a goods-movement document), so only the credit-hold check applies there;
     * a Sales Invoice's totalAmount is checked against the credit limit exactly as
     * at SO creation. */
    private void checkCreditForPost(String key, Long id) {
        DocEntity e = docs.get(key, id);
        String customerCode = e instanceof SalesDc sdc ? sdc.getCustomerCode()
                : e instanceof SalesInvoice inv ? inv.getCustomerCode() : null;
        BigDecimal amount = e instanceof SalesInvoice inv ? inv.getTotalAmount() : null;
        try {
            validateCustomerCredit(customerCode, amount);
        } catch (IllegalArgumentException ex) {
            // E5 "Credit hold auto-triggered" — the closest fit: Post was blocked here
            // by a credit gate the customer already tripped, which Sales Manager and
            // Finance need to know about to resolve before dispatch/billing can proceed.
            notifications.notify("CREDIT_BLOCK_AT_POST", "SALES", key, e.getId(), "WARNING",
                    e.getDocNo() + " blocked at Post: " + ex.getMessage(), e.getDocNo());
            throw ex;
        }
    }

    /** BR-NEW-006: an e-invoice-applicable invoice cannot reach POSTED without an
     * IRN already on file. No-op while app.sales.einvoice-required is false (the
     * default, since no provider is configured yet). */
    private void checkEInvoiceGate(Long id) {
        if (!einvoiceRequired) return;
        DocEntity e = docs.get("sales-invoice", id);
        if (e instanceof SalesInvoice inv && (inv.getIrnNumber() == null || inv.getIrnNumber().isBlank())) {
            throw new BusinessRuleException("EINVOICE_REQUIRED",
                    "This invoice requires an e-invoice IRN before it can be posted.");
        }
    }

    /** BR-NEW-007: a DC whose consignment value exceeds the configured E-Way Bill
     * threshold cannot dispatch without one on file. No-op while
     * app.sales.eway-bill-required is false (the default). */
    private void checkEWayBillGate(Long id) {
        if (!ewayBillRequired) return;
        DocEntity e = docs.get("sales-dc", id);
        if (!(e instanceof SalesDc dc)) return;
        BigDecimal consignmentValue = consignmentValueFor(dc);
        if (consignmentValue.compareTo(ewayBillThreshold) > 0 && (dc.getEwayBillNo() == null || dc.getEwayBillNo().isBlank())) {
            throw new BusinessRuleException("EWAY_BILL_REQUIRED",
                    "Consignment value exceeds statutory threshold; a valid E-Way Bill is required before dispatch.");
        }
    }

    /** A Sales DC carries no pricing of its own — valued the same way as
     * {@code dispatchedValueMtd}, against the unit price on the Sales Order it
     * references. */
    @SuppressWarnings("unchecked")
    private BigDecimal consignmentValueFor(SalesDc dc) {
        if (dc.getLines() == null || dc.getLines().isEmpty()) return BigDecimal.ZERO;
        String soNo = dc.getSalesOrderNo() != null ? dc.getSalesOrderNo() : dc.getSalesOrderNumber();
        Map<String, BigDecimal> rateByItem = new HashMap<>();
        if (soNo != null && !soNo.isBlank()) {
            List<Object[]> rows = em.createQuery(
                    "select i.itemCode, i.unitPrice from SalesOrderItem i where i.doc.docNo = :soNo", Object[].class)
                    .setParameter("soNo", soNo)
                    .getResultList();
            for (Object[] r : rows) {
                rateByItem.put((String) r[0], r[1] instanceof BigDecimal bd ? bd : BigDecimal.ZERO);
            }
        }
        BigDecimal total = BigDecimal.ZERO;
        for (SalesDcLine l : (List<SalesDcLine>) dc.getLines()) {
            BigDecimal qty = l.getQty() == null ? BigDecimal.ZERO : l.getQty();
            BigDecimal rate = rateByItem.getOrDefault(l.getItemCode(), BigDecimal.ZERO);
            total = total.add(qty.multiply(rate));
        }
        return total;
    }

    /** POST .../sales-invoice/{id}/e-invoice/generate (Technical Design §2.5). */
    @Transactional
    public DocEntity generateEInvoice(Long id, String user) {
        DocEntity ed = docs.get("sales-invoice", id);
        if (!(ed instanceof SalesInvoice inv)) throw new IllegalArgumentException("Not a sales invoice: " + id);
        EInvoiceResult result = einvoiceProvider.generateIrn(inv);
        inv.setIrnNumber(result.irnNumber());
        inv.setIrnAckNo(result.irnAckNo());
        inv.setIrnAckDate(result.irnAckDate());
        inv.setQrPayload(result.qrPayload());
        inv.setUpdatedAt(Instant.now());
        inv.setUpdatedBy(user);
        notifications.notify("EINVOICE_GENERATED", "SALES", "sales-invoice", inv.getId(), "INFO",
                "E-Invoice IRN generated for " + inv.getDocNo(), inv.getDocNo());
        return inv;
    }

    /** POST .../sales-dc/{id}/eway-bill/generate (Technical Design §2.4). */
    @Transactional
    public DocEntity generateEWayBill(Long id, String user) {
        DocEntity ed = docs.get("sales-dc", id);
        if (!(ed instanceof SalesDc dc)) throw new IllegalArgumentException("Not a sales dc: " + id);
        EWayBillResult result = ewayBillProvider.generate(dc);
        dc.setEwayBillNo(result.ewayBillNo());
        dc.setEwayBillValidUpto(result.validUpto());
        dc.setEwayBillPartBUpdated(false);
        dc.setUpdatedAt(Instant.now());
        dc.setUpdatedBy(user);
        notifications.notify("EWAY_BILL_GENERATED", "SALES", "sales-dc", dc.getId(), "INFO",
                "E-Way Bill generated for " + dc.getDocNo(), dc.getDocNo());
        return dc;
    }

    /** POST .../sales-dc/{id}/eway-bill/update-part-b — en-route vehicle change. */
    @Transactional
    public DocEntity updateEWayBillPartB(Long id, String newVehicleNo, String user) {
        DocEntity ed = docs.get("sales-dc", id);
        if (!(ed instanceof SalesDc dc)) throw new IllegalArgumentException("Not a sales dc: " + id);
        if (dc.getEwayBillNo() == null || dc.getEwayBillNo().isBlank()) {
            throw new IllegalStateException("No E-Way Bill exists yet for " + dc.getDocNo() + " to update");
        }
        ewayBillProvider.updatePartB(dc, newVehicleNo);
        dc.setVehicleNo(newVehicleNo);
        dc.setEwayBillPartBUpdated(true);
        dc.setUpdatedAt(Instant.now());
        dc.setUpdatedBy(user);
        return dc;
    }

    /** POST .../sales-invoice/{id}/actions/send-email — parity with the Purchase
     * module's PO email. */
    @Transactional
    public boolean sendInvoiceEmail(Long id, String toEmail, String ccEmail) {
        DocEntity ed = docs.get("sales-invoice", id);
        if (!(ed instanceof SalesInvoice inv)) throw new IllegalArgumentException("Not a sales invoice: " + id);
        Map<String, Object> row = docs.getRow("sales-invoice", id);
        byte[] pdf = printer.salesInvoice(row);
        boolean sent = emailService.sendSalesInvoiceEmail(inv, toEmail, ccEmail, pdf, inv.getDocNo() + ".pdf");
        notifications.notify(sent ? "INVOICE_EMAILED" : "INVOICE_EMAIL_FAILED", "SALES", "sales-invoice", inv.getId(),
                sent ? "INFO" : "WARNING",
                (sent ? "Invoice " : "Failed to email Invoice ") + inv.getDocNo() + " to " + toEmail, inv.getDocNo());
        return sent;
    }

    @SuppressWarnings("unchecked")
    private void preProcessBody(String key, Map<String, Object> body) {
        // Sync dates to base docDate
        if (body.containsKey("orderDate") && !body.containsKey("docDate")) body.put("docDate", body.get("orderDate"));
        if (body.containsKey("piDate") && !body.containsKey("docDate")) body.put("docDate", body.get("piDate"));
        if (body.containsKey("dcDate") && !body.containsKey("docDate")) body.put("docDate", body.get("dcDate"));
        if (body.containsKey("invoiceDate") && !body.containsKey("docDate")) body.put("docDate", body.get("invoiceDate"));
        if (body.containsKey("returnDate") && !body.containsKey("docDate")) body.put("docDate", body.get("returnDate"));

        // Sync notes to remarks
        if (body.containsKey("notes") && !body.containsKey("remarks")) body.put("remarks", body.get("notes"));
        if (body.containsKey("remarks") && !body.containsKey("notes")) body.put("notes", body.get("remarks"));

        // Sync order delivery dates & references
        if (body.containsKey("deliveryDate") && !body.containsKey("requestedDeliveryDate")) body.put("requestedDeliveryDate", body.get("deliveryDate"));
        if (body.containsKey("lrNo")) {
            body.putIfAbsent("lrNumber", body.get("lrNo"));
        }
        if (body.containsKey("lrNumber")) {
            body.putIfAbsent("lrNo", body.get("lrNumber"));
        }
        if (body.containsKey("salesOrderNo")) {
            body.putIfAbsent("salesOrderNumber", body.get("salesOrderNo"));
        }
        if (body.containsKey("salesOrderNumber")) {
            body.putIfAbsent("salesOrderNo", body.get("salesOrderNumber"));
        }
        if (body.containsKey("dcNo")) {
            body.putIfAbsent("originalDcNumber", body.get("dcNo"));
        }
        if (body.containsKey("originalDcNumber")) {
            body.putIfAbsent("dcNo", body.get("originalDcNumber"));
        }
        if (body.containsKey("invoiceNo")) {
            body.putIfAbsent("originalInvoiceNumber", body.get("invoiceNo"));
        }
        if (body.containsKey("originalInvoiceNumber")) {
            body.putIfAbsent("invoiceNo", body.get("originalInvoiceNumber"));
        }
        if (body.containsKey("reason")) {
            body.putIfAbsent("returnReason", body.get("reason"));
        }
        if (body.containsKey("returnReason")) {
            body.putIfAbsent("reason", body.get("returnReason"));
        }

        if (("dc-return".equals(key) || "invoice-return".equals(key)) && body.containsKey("lines")) {
            Object linesObj = body.get("lines");
            if (linesObj instanceof List<?> lineList) {
                for (Object lineObj : lineList) {
                    if (lineObj instanceof Map<?, ?> lineMap) {
                        Map<String, Object> line = (Map<String, Object>) lineMap;
                        if (line.get("returnedQty") == null) {
                            line.put("returnedQty", line.getOrDefault("currentReturnQty", BigDecimal.ZERO));
                        }
                    }
                }
            }
        }
    }

    /** BR-NEW-013: CGST+SGST when the customer's Place of Supply is the same state the
     * company is registered in, else IGST. Compared as free-text state names since no
     * GST state-code master exists yet in this codebase — this is a pragmatic first cut,
     * not a full 2-digit-state-code implementation. */
    private String deriveTaxType(String placeOfSupply) {
        if (placeOfSupply == null || placeOfSupply.isBlank()) return null;
        var ci = companyInfos.findById(1L).orElse(null);
        if (ci == null) return null;
        String companyState = ci.getGstState() != null && !ci.getGstState().isBlank() ? ci.getGstState() : ci.getState();
        if (companyState == null) return null;
        return companyState.trim().equalsIgnoreCase(placeOfSupply.trim()) ? "CGST_SGST" : "IGST";
    }

    private void applyCreationDefaults(String key, DocEntity e) {
        switch (key) {
            case "sales-order" -> {
                if (e instanceof SalesOrder so) {
                    if (so.getOrderedQty() == null) so.setOrderedQty(BigDecimal.ZERO);
                    if (so.getProducedQty() == null) so.setProducedQty(BigDecimal.ZERO);
                    if (so.getApprovedQty() == null) so.setApprovedQty(BigDecimal.ZERO);
                    if (so.getPackedQty() == null) so.setPackedQty(BigDecimal.ZERO);
                    if (so.getDispatchedQty() == null) so.setDispatchedQty(BigDecimal.ZERO);
                    if (so.getInvoicedQty() == null) so.setInvoicedQty(BigDecimal.ZERO);
                    if (so.getReturnedQty() == null) so.setReturnedQty(BigDecimal.ZERO);
                    if (so.getLines() != null) {
                        BigDecimal total = BigDecimal.ZERO;
                        for (SalesOrderItem item : (List<SalesOrderItem>) so.getLines()) {
                            if (item.getOrderQty() == null) item.setOrderQty(BigDecimal.ZERO);
                            if (item.getUnitPrice() == null) item.setUnitPrice(BigDecimal.ZERO);
                            if (item.getDiscount() == null) item.setDiscount(BigDecimal.ZERO);
                            if (item.getTax() == null) item.setTax(BigDecimal.ZERO);
                            BigDecimal qty = item.getOrderQty();
                            BigDecimal rate = item.getUnitPrice();
                            BigDecimal disc = item.getDiscount();
                            BigDecimal net = qty.multiply(rate).subtract(disc);
                            BigDecimal taxAmt = net.multiply(item.getTax()).divide(BigDecimal.valueOf(100), 4, RoundingMode.HALF_UP).setScale(2, RoundingMode.HALF_UP);
                            item.setNetAmount(net.add(taxAmt).setScale(2, RoundingMode.HALF_UP));
                            total = total.add(qty);
                            // Line-level pendingQty was declared on SalesOrderItem but never
                            // actually populated anywhere — every consumer (Sales DC's SO-select
                            // auto-fill in particular) silently fell back to the full orderQty
                            // instead of what's actually left to dispatch. A brand-new line has
                            // nothing dispatched yet, so pending = ordered.
                            item.setPendingQty(qty);
                            // Default the line-level progress columns so a freshly saved SO
                            // doesn't re-open with blank dispatch/invoice/status values.
                            if (item.getLineStatus() == null || item.getLineStatus().isBlank())
                                item.setLineStatus("Open");
                            if (item.getDispatchedQty() == null) item.setDispatchedQty(BigDecimal.ZERO);
                            if (item.getInvoicedQty() == null) item.setInvoicedQty(BigDecimal.ZERO);
                        }
                        so.setOrderedQty(total);
                        so.setPendingQty(total);
                    }
                }
            }
            case "proforma-invoice" -> {
                if (e instanceof ProformaInvoice pi) {
                    if (pi.getLines() != null) {
                        BigDecimal total = BigDecimal.ZERO;
                        for (ProformaInvoiceItem item : (List<ProformaInvoiceItem>) pi.getLines()) {
                            if (item.getUnitPrice() == null) item.setUnitPrice(BigDecimal.ZERO);
                            if (item.getDiscount() == null) item.setDiscount(BigDecimal.ZERO);
                            if (item.getTax() == null) item.setTax(BigDecimal.ZERO);
                            BigDecimal qty = item.getQty() == null ? BigDecimal.ZERO : item.getQty();
                            BigDecimal net = qty.multiply(item.getUnitPrice()).subtract(item.getDiscount());
                            BigDecimal taxAmt = net.multiply(item.getTax()).divide(BigDecimal.valueOf(100), 4, RoundingMode.HALF_UP).setScale(2, RoundingMode.HALF_UP);
                            item.setTaxAmount(taxAmt);
                            item.setNetAmount(net.add(taxAmt).setScale(2, RoundingMode.HALF_UP));
                            total = total.add(net.add(taxAmt));
                        }
                        pi.setTotalAmount(total.setScale(2, RoundingMode.HALF_UP));
                    }
                }
            }
            case "sales-dc" -> {
                if (e instanceof SalesDc sdc) {
                    if (sdc.getDispatchDate() == null) sdc.setDispatchDate(LocalDate.now());
                }
            }
            case "sales-invoice" -> {
                if (e instanceof SalesInvoice si) {
                    if (si.getLines() != null) {
                        BigDecimal total = BigDecimal.ZERO;
                        BigDecimal totalTax = BigDecimal.ZERO;
                        for (SalesInvoiceItem item : (List<SalesInvoiceItem>) si.getLines()) {
                            if (item.getUnitPrice() == null) item.setUnitPrice(BigDecimal.ZERO);
                            if (item.getDiscount() == null) item.setDiscount(BigDecimal.ZERO);
                            if (item.getTax() == null) item.setTax(BigDecimal.ZERO);
                            // BR-NEW-012: freeze the HSN as it stands in the Item Master right
                            // now — a later change to the item's HSN must never rewrite what was
                            // actually declared to GST for this transaction.
                            if (item.getHsnSnapshot() == null || item.getHsnSnapshot().isBlank()) {
                                items.findByCode(item.getItemCode())
                                        .map(ItemMaster::getHsnCode)
                                        .filter(h -> h != null && !h.isBlank())
                                        .ifPresent(item::setHsnSnapshot);
                            }
                            BigDecimal qty = item.getQty() == null ? BigDecimal.ZERO : item.getQty();
                            BigDecimal net = qty.multiply(item.getUnitPrice()).subtract(item.getDiscount());
                            BigDecimal taxAmt = net.multiply(item.getTax()).divide(BigDecimal.valueOf(100), 4, RoundingMode.HALF_UP).setScale(2, RoundingMode.HALF_UP);
                            item.setTaxAmount(taxAmt);
                            item.setNetAmount(net.add(taxAmt).setScale(2, RoundingMode.HALF_UP));
                            total = total.add(net.add(taxAmt));
                            totalTax = totalTax.add(taxAmt);
                        }
                        si.setTotalAmount(total.setScale(2, RoundingMode.HALF_UP));
                        si.setTaxAmount(totalTax.setScale(2, RoundingMode.HALF_UP));
                    }
                    if (si.getTaxType() == null || si.getTaxType().isBlank()) {
                        si.setTaxType(deriveTaxType(si.getPlaceOfSupply()));
                    }
                    // GST state code of the place of supply — auto-filled from the
                    // customer GSTIN's first two digits when not supplied (BR-NEW-013).
                    if ((si.getPlaceOfSupplyCode() == null || si.getPlaceOfSupplyCode().isBlank())
                            && si.getCustomerGstin() != null && si.getCustomerGstin().length() >= 2) {
                        si.setPlaceOfSupplyCode(si.getCustomerGstin().substring(0, 2));
                    }
                }
            }
            case "dc-return" -> {
                if (e instanceof DcReturn dr) {
                    if (dr.getLines() != null) {
                        for (DcReturnLine item : (List<DcReturnLine>) dr.getLines()) {
                            if (item.getCurrentReturnQty() == null) item.setCurrentReturnQty(BigDecimal.ZERO);
                            if (item.getPreviouslyReturnedQty() == null) item.setPreviouslyReturnedQty(BigDecimal.ZERO);
                            if (item.getOriginalDcQty() == null) item.setOriginalDcQty(BigDecimal.ZERO);
                            if (item.getReturnedQty() == null) item.setReturnedQty(item.getCurrentReturnQty());
                        }
                    }
                }
            }
            case "invoice-return" -> {
                if (e instanceof InvoiceReturn ir) {
                    if (ir.getLines() != null) {
                        for (InvoiceReturnLine item : (List<InvoiceReturnLine>) ir.getLines()) {
                            if (item.getCurrentReturnQty() == null) item.setCurrentReturnQty(BigDecimal.ZERO);
                            if (item.getPreviouslyReturnedQty() == null) item.setPreviouslyReturnedQty(BigDecimal.ZERO);
                            if (item.getOriginalInvoiceQty() == null) item.setOriginalInvoiceQty(BigDecimal.ZERO);
                            if (item.getReturnedQty() == null) item.setReturnedQty(item.getCurrentReturnQty());
                        }
                    }
                }
            }
            // SCR-103: PAY-05/PAY-06 mandatory-field checks + initial unallocated balance.
            case "payment-receipt" -> {
                if (e instanceof SalesPaymentReceipt r) {
                    if (r.getAmountReceived() == null || r.getAmountReceived().signum() <= 0) {
                        throw new IllegalArgumentException("Amount received must be greater than zero");
                    }
                    if (!"CASH".equalsIgnoreCase(r.getMode()) && (r.getReferenceNo() == null || r.getReferenceNo().isBlank())) {
                        throw new IllegalArgumentException("Reference number is mandatory unless payment mode is CASH");
                    }
                    r.setUnallocatedBalance(r.getAmountReceived());
                }
            }
            // SCR-104: CDN-03 (original invoice must exist and be POSTED-or-later) +
            // CDN-07 (originalInvoicePeriod derived from the original invoice's date).
            case "credit-debit-note" -> {
                if (e instanceof SalesCreditDebitNote n) {
                    if (n.getAmount() == null || n.getAmount().signum() <= 0) {
                        throw new IllegalArgumentException("Amount must be greater than zero");
                    }
                    DocEntity invDoc = docs.getByNumberOrNull("sales-invoice", n.getOriginalInvoiceRef());
                    if (!(invDoc instanceof SalesInvoice inv)
                            || !Set.of("POSTED", "PARTIALLY_PAID", "PAID").contains(inv.getStatus())) {
                        throw new IllegalArgumentException(
                                "Original invoice must exist and be POSTED or later: " + n.getOriginalInvoiceRef());
                    }
                    n.setOriginalInvoicePeriod(inv.getDocDate() != null
                            ? String.format("%04d-%02d", inv.getDocDate().getYear(), inv.getDocDate().getMonthValue())
                            : null);
                    if (n.getTaxImpact() == null) n.setTaxImpact(true);
                }
            }
            // SCR-101: docs.create() always stamps status DRAFT; Enquiry's own status
            // vocabulary starts at NEW instead.
            case "enquiry" -> {
                if (e instanceof SalesEnquiry enq) {
                    enq.setStatus("NEW");
                    if (enq.getSalesOwner() == null || enq.getSalesOwner().isBlank()) {
                        enq.setSalesOwner(enq.getCreatedBy());
                    }
                }
            }
            // SCR-102: QTN-06 default validity + D1 server-side cost-buildup computation.
            case "quotation" -> {
                if (e instanceof SalesQuotation q) {
                    if (q.getValidityDate() == null) {
                        q.setValidityDate((q.getDocDate() != null ? q.getDocDate() : LocalDate.now()).plusDays(30));
                    }
                    computeQuotationCosting(q);
                }
            }
            default -> {}
        }
    }

    /** BR-NEW-002 / D1: computes each line's cost-buildup and suggestedSellingPrice,
     * defaults unitPrice to the suggestion when not provided, and enforces that any
     * user override beyond the configured tolerance carries a logged reason. Called
     * on every create/recompute — never trusts a client-supplied suggestedSellingPrice. */
    private void computeQuotationCosting(SalesQuotation q) {
        CostingPolicy policy = costingPolicies.findFirstByActiveTrue().orElseGet(CostingPolicy::new);
        boolean anyBreachedTolerance = false;
        BigDecimal totalNet = BigDecimal.ZERO;

        if (q.getLines() != null) {
            for (SalesQuotationLine l : (List<SalesQuotationLine>) q.getLines()) {
                BigDecimal qty = l.getQty() == null || l.getQty().signum() <= 0 ? BigDecimal.ONE : l.getQty();
                BigDecimal materialCost = l.getMaterialCostPerUnit() == null ? BigDecimal.ZERO : l.getMaterialCostPerUnit();

                BigDecimal machineHourRate = BigDecimal.ZERO;
                if (l.getMachineCode() != null && !l.getMachineCode().isBlank()) {
                    machineHourRate = machines.findByCode(l.getMachineCode())
                            .map(MachineMaster::getHourlyRate)
                            .filter(Objects::nonNull)
                            .orElse(BigDecimal.ZERO);
                }
                BigDecimal cycleTime = l.getCycleTimeMinutes() == null ? BigDecimal.ZERO : l.getCycleTimeMinutes();
                BigDecimal setupTime = l.getSetupTimeMinutes() == null ? BigDecimal.ZERO : l.getSetupTimeMinutes();
                BigDecimal sixty = BigDecimal.valueOf(60);

                BigDecimal machiningCost = cycleTime.divide(sixty, 6, RoundingMode.HALF_UP).multiply(machineHourRate);
                BigDecimal setupCost = setupTime.divide(sixty, 6, RoundingMode.HALF_UP)
                        .multiply(machineHourRate).divide(qty, 6, RoundingMode.HALF_UP);
                BigDecimal toolingCost = Boolean.TRUE.equals(l.getToolingRequired())
                        ? (l.getToolingCostPerUnit() == null ? BigDecimal.ZERO : l.getToolingCostPerUnit())
                        : BigDecimal.ZERO;

                l.setMachiningCostPerUnit(machiningCost.setScale(4, RoundingMode.HALF_UP));
                l.setSetupCostPerUnit(setupCost.setScale(4, RoundingMode.HALF_UP));
                l.setToolingCostPerUnit(toolingCost.setScale(4, RoundingMode.HALF_UP));

                BigDecimal baseCost = materialCost.add(machiningCost).add(setupCost).add(toolingCost);
                BigDecimal overheadPct = l.getOverheadPercent() != null ? l.getOverheadPercent() : policy.getDefaultOverheadPercent();
                BigDecimal marginPct = l.getMarginPercent() != null ? l.getMarginPercent() : policy.getDefaultMarginPercent();
                l.setOverheadPercent(overheadPct);
                l.setMarginPercent(marginPct);

                BigDecimal loadedCost = baseCost.multiply(BigDecimal.ONE.add(overheadPct.divide(BigDecimal.valueOf(100), 6, RoundingMode.HALF_UP)));
                BigDecimal suggested = loadedCost.multiply(BigDecimal.ONE.add(marginPct.divide(BigDecimal.valueOf(100), 6, RoundingMode.HALF_UP)))
                        .setScale(4, RoundingMode.HALF_UP);
                l.setSuggestedSellingPrice(suggested);

                if (l.getUnitPrice() == null || l.getUnitPrice().signum() == 0) {
                    l.setUnitPrice(suggested);
                }
                if (suggested.signum() > 0) {
                    BigDecimal deviationPct = l.getUnitPrice().subtract(suggested).abs()
                            .divide(suggested, 6, RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(100));
                    if (deviationPct.compareTo(policy.getPriceDeviationTolerancePercent()) > 0) {
                        anyBreachedTolerance = true;
                    }
                }

                BigDecimal lineGross = l.getUnitPrice().multiply(qty);
                BigDecimal taxPct = taxPercentFromCode(l.getTaxCode());
                BigDecimal taxAmt = lineGross.multiply(taxPct).divide(BigDecimal.valueOf(100), 4, RoundingMode.HALF_UP);
                l.setTaxAmount(taxAmt);
                BigDecimal net = lineGross.add(taxAmt).setScale(4, RoundingMode.HALF_UP);
                l.setNetAmount(net);
                totalNet = totalNet.add(net);
            }
        }

        if (anyBreachedTolerance && (q.getPriceOverrideReason() == null || q.getPriceOverrideReason().isBlank())) {
            throw new IllegalArgumentException(
                    "One or more lines' Unit Price deviates from the Suggested Selling Price by more than " +
                    policy.getPriceDeviationTolerancePercent() + "% — a Price Override Reason is required");
        }
    }

    private BigDecimal taxPercentFromCode(String taxCode) {
        if (taxCode == null) return new BigDecimal("18");
        String tc = taxCode.toUpperCase();
        if (tc.contains("28")) return new BigDecimal("28");
        if (tc.contains("18")) return new BigDecimal("18");
        if (tc.contains("12")) return new BigDecimal("12");
        if (tc.contains("5")) return new BigDecimal("5");
        if (tc.contains("EXEMPT")) return BigDecimal.ZERO;
        return new BigDecimal("18");
    }

    @Transactional
    public DocEntity action(String key, Long id, String action, String note, String user) {
        return action(key, id, action, note, user, Map.of());
    }

    @Transactional
    public DocEntity action(String key, Long id, String action, String note, String user,
                            Map<String, Object> opts) {
        // FRS §7 / TBD-SALES-001 (Phase 4): the controller-level @RequirePermission on
        // SalesController only ever checked the blanket SALES:*:VIEW, for every action
        // including approve/post/cancel. Each workflow action now checks its own
        // specific permission here, at the service layer — a hidden button was never
        // enforcement, only a convenience.
        enforceActionPermission(key, id, action, user);
        if ("payment-receipt".equals(key) && "allocate".equals(action)) {
            // Allocation lines are business data, not a bare status flip — build and
            // validate them from the request body *before* docs.action() moves the
            // header to ALLOCATED, so a validation failure never leaves the receipt in
            // a half-transitioned state.
            applyAllocations(id, opts, user);
        }
        // These three create/replace a *different* document than the one the action
        // was called on, which docs.action() (mutate-and-return-the-same-row) can't
        // express — so they bypass it entirely rather than being shoehorned in.
        if ("enquiry".equals(key) && "convert-to-quotation".equals(action)) {
            return convertEnquiryToQuotation(id, user);
        }
        if ("quotation".equals(key) && "revise".equals(action)) {
            return reviseQuotation(id, user);
        }
        if ("quotation".equals(key) && "convert-to-so".equals(action)) {
            return convertQuotationToSo(id, user);
        }
        if ("sales-order".equals(key) && "amend".equals(action)) {
            return amendSalesOrder(id, opts, user);
        }
        if ("sales-invoice".equals(key) && "send-email".equals(action)) {
            DocEntity ed = docs.get(key, id);
            if (!(ed instanceof SalesInvoice inv)) throw new IllegalArgumentException("Not a sales invoice: " + id);
            String toEmail = opts.get("toEmail") != null ? String.valueOf(opts.get("toEmail"))
                    : parties.findByCode(inv.getCustomerCode()).map(Party::getEmail).orElse(null);
            String ccEmail = opts.get("ccEmail") != null ? String.valueOf(opts.get("ccEmail")) : null;
            sendInvoiceEmail(id, toEmail, ccEmail);
            return docs.get(key, id);
        }
        // BR-NEW-001 (Phase 4): the credit-hold/credit-limit check already run at SO
        // creation is re-run at these two additional gate points — a customer can go
        // on hold, or accumulate enough open business, between SO approval and actual
        // dispatch/billing. Must run *before* docs.action() performs the stock-out /
        // ledger posting, not after — there's no undo once that's happened.
        if (("sales-dc".equals(key) || "sales-invoice".equals(key)) && "post".equals(action)) {
            checkCreditForPost(key, id);
        }
        // Phase 5 gates (BR-NEW-006/007) — both OFF by default (app.sales.*-required)
        // until a real GSP/IRP or E-Way Bill provider is chosen; see NotConfigured*.
        if ("sales-invoice".equals(key) && "post".equals(action)) {
            checkEInvoiceGate(id);
        }
        if ("sales-dc".equals(key) && "post".equals(action)) {
            checkEWayBillGate(id);
        }
        DocEntity e = docs.action(key, id, action, note, user, opts);
        fireLifecycleNotification(key, e, action);
        postActionHook(key, e, action, note, user);
        return e;
    }

    /** E5 notification triggers for the events that are a plain status flip (approve/
     * reject/post) — the ones with real cross-document side effects (submit's tier
     * routing, credit-hold block) fire their own notification right where that logic
     * already lives, since they need context this generic dispatcher doesn't have. */
    private void fireLifecycleNotification(String key, DocEntity e, String action) {
        if (!Set.of("sales-order", "sales-dc", "sales-invoice").contains(key)) return;
        switch (action) {
            case "approve" -> notifications.notify("APPROVED", "SALES", key, e.getId(), "INFO",
                    e.getDocNo() + " was approved", e.getDocNo());
            case "reject" -> notifications.notify("REJECTED", "SALES", key, e.getId(), "WARNING",
                    e.getDocNo() + " was rejected", e.getDocNo());
            case "post" -> {
                if ("sales-dc".equals(key)) {
                    notifications.notify("DC_DISPATCHED", "SALES", key, e.getId(), "INFO",
                            "Delivery Challan " + e.getDocNo() + " has been dispatched", e.getDocNo());
                } else if ("sales-invoice".equals(key) && e instanceof SalesInvoice inv) {
                    notifications.notify("INVOICE_POSTED", "SALES", key, e.getId(), "INFO",
                            "Invoice " + inv.getDocNo() + " (" + formatMoney(inv.getTotalAmount()) + ") has been posted", inv.getDocNo());
                }
            }
            default -> {}
        }
    }

    private void postActionHook(String key, DocEntity e, String action, String note, String user) {
        if ("payment-receipt".equals(key)) {
            if ("post".equals(action) && e instanceof SalesPaymentReceipt receipt) {
                applyReceiptToInvoices(receipt, +1);
            } else if ("reverse".equals(action) && e instanceof SalesPaymentReceipt receipt) {
                applyReceiptToInvoices(receipt, -1);
            }
            return;
        }
        if ("credit-debit-note".equals(key)) {
            if ("post".equals(action) && e instanceof SalesCreditDebitNote n) {
                applyCreditDebitNoteToInvoice(n);
            }
            return;
        }
        if ("enquiry".equals(key) && "mark-lost".equals(action) && e instanceof SalesEnquiry enq) {
            enq.setLostReason(note);
            return;
        }
        if ("quotation".equals(key) && "mark-lost".equals(action) && e instanceof SalesQuotation q) {
            q.setLostReason(note);
            return;
        }
        // Phase 4 tier router (Technical Design §3.2): docs.action() already moved the
        // header to the generic SUBMITTED status by the time this runs — overwrite it
        // with the tier-routed target. Safe to do here: the entity is still managed
        // and unflushed, so this is the value Hibernate actually persists.
        if ("sales-order".equals(key) && "submit".equals(action) && e instanceof SalesOrder so) {
            applyTierRouting(so);
            return;
        }
        if (!"approve".equals(action) && !"post".equals(action) && !"dispatch".equals(action)) return;
        switch (key) {
            case "sales-order" -> {
                if (e instanceof SalesOrder so) {
                    if (so.getLines() != null) {
                        BigDecimal total = BigDecimal.ZERO;
                        for (SalesOrderItem item : (List<SalesOrderItem>) so.getLines()) {
                            total = total.add(item.getOrderQty() == null ? BigDecimal.ZERO : item.getOrderQty());
                        }
                        so.setOrderedQty(total);
                        BigDecimal dispatched = so.getDispatchedQty() == null ? BigDecimal.ZERO : so.getDispatchedQty();
                        so.setPendingQty(total.subtract(dispatched));
                    }
                    // FRS §4.9: Auto-generate schedule lines for Open SOs
                    if ("Open".equalsIgnoreCase(so.getSoType()) && so.getLines() != null && (so.getSchedules() == null || so.getSchedules().isEmpty())) {
                        List<SalesOrderSchedule> schedules = new ArrayList<>();
                        int schedNo = 1;
                        for (SalesOrderItem item : (List<SalesOrderItem>) so.getLines()) {
                            SalesOrderSchedule sched = new SalesOrderSchedule();
                            sched.setDoc(so);
                            sched.setScheduleNumber(String.format("SCH-%s-%03d", so.getDocNo() != null ? so.getDocNo() : so.getId(), schedNo++));
                            sched.setItemCode(item.getItemName() != null ? item.getItemName() : "");
                            sched.setScheduledQty(item.getOrderQty());
                            sched.setScheduledDate(item.getRequiredDeliveryDate() != null ? item.getRequiredDeliveryDate() : so.getDeliveryDate());
                            sched.setDispatchedQty(BigDecimal.ZERO);
                            sched.setPendingQty(item.getOrderQty());
                            sched.setStatus("PENDING");
                            schedules.add(sched);
                        }
                        if (so.getSchedules() != null) {
                            so.getSchedules().clear();
                            so.getSchedules().addAll(schedules);
                        }
                    }
                }
            }
            case "sales-dc" -> {
                if ("post".equals(action) && e instanceof SalesDc sdc) {
                    updateSoFromDispatch(sdc, user);
                }
            }
            case "sales-invoice" -> {
                if ("post".equals(action) && e instanceof SalesInvoice si) {
                    updateSoFromInvoice(si, user);
                }
            }
            case "dc-return" -> {
                if (e instanceof DcReturn dr) {
                    if (dr.getDisposition() == null) dr.setDisposition("PENDING_INSPECTION");
                    if ("post".equals(action)) {
                        updateSoFromReturn(dr, user);
                    }
                }
            }
            case "invoice-return" -> {
                if (e instanceof InvoiceReturn ir) {
                    if (ir.getDisposition() == null) ir.setDisposition("PENDING_INSPECTION");
                    if ("post".equals(action)) {
                        updateSoFromReturn2(ir, user);
                    }
                }
            }
            default -> {}
        }
    }

    private void updateSoFromDispatch(SalesDc sdc, String user) {
        String soNo = sdc.getSalesOrderNo();
        if (soNo == null || soNo.isBlank()) return;
        try {
            DocEntity doc = docs.getByNumberOrNull("sales-order", soNo);
            if (!(doc instanceof SalesOrder so)) return;
            if (so.getLines() == null) return;

            BigDecimal dcTotal = BigDecimal.ZERO;
            for (SalesDcLine dcLine : sdc.getLines()) {
                dcTotal = dcTotal.add(dcLine.getQty() == null ? BigDecimal.ZERO : dcLine.getQty());
            }

            BigDecimal currentDispatched = so.getDispatchedQty() == null ? BigDecimal.ZERO : so.getDispatchedQty();
            BigDecimal newDispatched = currentDispatched.add(dcTotal);
            BigDecimal ordered = so.getOrderedQty() == null ? BigDecimal.ZERO : so.getOrderedQty();

            if (newDispatched.compareTo(ordered) > 0) {
                throw new IllegalStateException("Dispatch qty " + dcTotal + " exceeds SO pending. " +
                    "Ordered: " + ordered + ", Already dispatched: " + currentDispatched);
            }

            so.setDispatchedQty(newDispatched);
            so.setPendingQty(ordered.subtract(newDispatched));

            // Keep each line's own pendingQty in step too — this is what the Sales DC
            // screen's "pick an SO" auto-fill actually reads to cap currentDispatchQty;
            // only refreshing the header total left every line silently stuck at its
            // original full orderQty forever.
            Map<String, BigDecimal> dispatchedByItem = dispatchedQtyByItem(so.getDocNo());
            for (SalesOrderItem item : (List<SalesOrderItem>) so.getLines()) {
                BigDecimal lineOrdered = item.getOrderQty() == null ? BigDecimal.ZERO : item.getOrderQty();
                BigDecimal lineDispatched = dispatchedByItem.getOrDefault(item.getItemCode(), BigDecimal.ZERO);
                item.setPendingQty(lineOrdered.subtract(lineDispatched));
                item.setDispatchedQty(lineDispatched);
            }

            if (newDispatched.compareTo(BigDecimal.ZERO) > 0 && newDispatched.compareTo(ordered) < 0) {
                so.setStatus("PARTIALLY_DISPATCHED");
            } else if (newDispatched.compareTo(ordered) >= 0) {
                so.setStatus("DISPATCHED");
            }
            so.setUpdatedAt(Instant.now());
            so.setUpdatedBy(user);
        } catch (IllegalStateException ex) {
            throw ex;
        } catch (Exception ignored) {}
    }

    private void updateSoFromInvoice(SalesInvoice si, String user) {
        String soNo = si.getSalesOrderNumber();
        if (soNo == null || soNo.isBlank()) return;
        try {
            DocEntity doc = docs.getByNumberOrNull("sales-order", soNo);
            if (!(doc instanceof SalesOrder so)) return;

            BigDecimal invTotal = BigDecimal.ZERO;
            for (SalesInvoiceItem invLine : si.getLines()) {
                invTotal = invTotal.add(invLine.getQty() == null ? BigDecimal.ZERO : invLine.getQty());
            }

            BigDecimal currentInvoiced = so.getInvoicedQty() == null ? BigDecimal.ZERO : so.getInvoicedQty();
            BigDecimal dispatched = so.getDispatchedQty() == null ? BigDecimal.ZERO : so.getDispatchedQty();
            BigDecimal eligibleQty = dispatched.subtract(currentInvoiced);
            if (eligibleQty.compareTo(BigDecimal.ZERO) > 0 && invTotal.compareTo(eligibleQty) > 0) {
                throw new IllegalStateException(
                    "Invoice qty " + invTotal + " exceeds eligible sales qty. Dispatched: " + dispatched +
                    ", already invoiced: " + currentInvoiced + ", eligible: " + eligibleQty);
            }

            so.setInvoicedQty(currentInvoiced.add(invTotal));

            // Keep each line's own invoicedQty in step too — the Sales DC / Invoice
            // screens auto-fill from the SO's stored line quantities, so stale line
            // values made a re-opened order show blank dispatch/invoice progress.
            Map<String, BigDecimal> invoicedByItem = invoicedQtyByItem(so.getDocNo());
            for (SalesOrderItem item : (List<SalesOrderItem>) so.getLines()) {
                item.setInvoicedQty(invoicedByItem.getOrDefault(item.getItemCode(), BigDecimal.ZERO));
            }

            so.setUpdatedAt(Instant.now());
            so.setUpdatedBy(user);
        } catch (IllegalStateException e) {
            throw e;
        }
    }

    private void updateSoFromReturn(DcReturn dr, String user) {
        String soNo = dr.getSalesOrderNumber();
        if (soNo == null || soNo.isBlank()) return;
        try {
            DocEntity doc = docs.getByNumberOrNull("sales-order", soNo);
            if (!(doc instanceof SalesOrder so)) return;

            BigDecimal returnTotal = BigDecimal.ZERO;
            for (DcReturnLine rl : dr.getLines()) {
                returnTotal = returnTotal.add(rl.getQty() == null ? BigDecimal.ZERO : rl.getQty());
            }

            BigDecimal currentReturned = so.getReturnedQty() == null ? BigDecimal.ZERO : so.getReturnedQty();
            so.setReturnedQty(currentReturned.add(returnTotal));
            so.setUpdatedAt(Instant.now());
            so.setUpdatedBy(user);
        } catch (IllegalStateException e) { throw e; }
    }

    private void updateSoFromReturn2(InvoiceReturn ir, String user) {
        String soNo = ir.getSalesOrderNumber();
        if (soNo == null || soNo.isBlank()) return;
        try {
            DocEntity doc = docs.getByNumberOrNull("sales-order", soNo);
            if (!(doc instanceof SalesOrder so)) return;

            BigDecimal returnTotal = BigDecimal.ZERO;
            for (InvoiceReturnLine rl : ir.getLines()) {
                returnTotal = returnTotal.add(rl.getQty() == null ? BigDecimal.ZERO : rl.getQty());
            }

            BigDecimal currentReturned = so.getReturnedQty() == null ? BigDecimal.ZERO : so.getReturnedQty();
            so.setReturnedQty(currentReturned.add(returnTotal));
            so.setUpdatedAt(Instant.now());
            so.setUpdatedBy(user);
        } catch (IllegalStateException e) { throw e; } catch (Exception ignored) {}
    }

    /** SCR-103 §2.6 allocate: builds this receipt's allocation lines from the request
     * body, validating sum(allocated) ≤ amountReceived and, per line, amountAllocated ≤
     * the target invoice's current outstanding balance, and that the target invoice is
     * POSTED/PARTIALLY_PAID (never DRAFT/PAID/etc). Runs before docs.action() flips the
     * receipt to ALLOCATED so a validation failure leaves nothing half-done. */
    @SuppressWarnings("unchecked")
    private void applyAllocations(Long receiptId, Map<String, Object> opts, String user) {
        DocEntity e = docs.get("payment-receipt", receiptId);
        if (!(e instanceof SalesPaymentReceipt receipt)) return;

        Object allocObj = opts.get("allocations");
        if (!(allocObj instanceof List<?> allocList) || allocList.isEmpty()) {
            throw new IllegalArgumentException("At least one allocation is required");
        }

        BigDecimal received = receipt.getAmountReceived() == null ? BigDecimal.ZERO : receipt.getAmountReceived();
        BigDecimal sumAllocated = BigDecimal.ZERO;
        List<SalesPaymentAllocation> newLines = new ArrayList<>();
        for (Object o : allocList) {
            if (!(o instanceof Map<?, ?> m)) continue;
            String invoiceNo = String.valueOf(m.get("invoiceNo"));
            BigDecimal amount = toBD(m.get("amountAllocated"));
            if (amount.signum() <= 0) {
                throw new IllegalArgumentException("Allocation amount for " + invoiceNo + " must be positive");
            }
            DocEntity invDoc = docs.getByNumberOrNull("sales-invoice", invoiceNo);
            if (!(invDoc instanceof SalesInvoice inv)) {
                throw new IllegalArgumentException("Invoice not found: " + invoiceNo);
            }
            if (!Set.of("POSTED", "PARTIALLY_PAID").contains(inv.getStatus())) {
                throw new IllegalArgumentException(
                        "Cannot allocate against invoice " + invoiceNo + " in status " + inv.getStatus());
            }
            BigDecimal balance = invoiceBalance(inv);
            if (amount.compareTo(balance) > 0) {
                throw new IllegalArgumentException(
                        "Allocation " + amount + " exceeds invoice " + invoiceNo + " balance " + balance);
            }
            sumAllocated = sumAllocated.add(amount);

            SalesPaymentAllocation line = new SalesPaymentAllocation();
            line.setInvoiceNo(invoiceNo);
            line.setInvoiceBalance(balance);
            line.setAmountAllocated(amount);
            newLines.add(line);
        }
        if (sumAllocated.compareTo(received) > 0) {
            throw new IllegalArgumentException(
                    "Total allocated " + sumAllocated + " exceeds amount received " + received);
        }

        receipt.getLines().clear();
        for (SalesPaymentAllocation line : newLines) {
            line.setDoc(receipt);
            receipt.getLines().add(line);
        }
        receipt.setUnallocatedBalance(received.subtract(sumAllocated));
        receipt.setUpdatedAt(Instant.now());
        receipt.setUpdatedBy(user);
    }

    private BigDecimal invoiceBalance(SalesInvoice inv) {
        BigDecimal total = inv.getTotalAmount() == null ? BigDecimal.ZERO : inv.getTotalAmount();
        BigDecimal paid = inv.getPaidAmount() == null ? BigDecimal.ZERO : inv.getPaidAmount();
        return total.subtract(paid);
    }

    /** SCR-103 post/reverse: applies (sign=+1) or undoes (sign=-1) this receipt's
     * allocations against each referenced invoice's paidAmount, then re-derives the
     * invoice's PARTIALLY_PAID/PAID/POSTED status from the resulting balance. */
    private void applyReceiptToInvoices(SalesPaymentReceipt receipt, int sign) {
        if (receipt.getLines() == null) return;
        for (SalesPaymentAllocation line : receipt.getLines()) {
            DocEntity invDoc = docs.getByNumberOrNull("sales-invoice", line.getInvoiceNo());
            if (!(invDoc instanceof SalesInvoice inv)) continue;
            BigDecimal paid = inv.getPaidAmount() == null ? BigDecimal.ZERO : inv.getPaidAmount();
            BigDecimal delta = line.getAmountAllocated() == null ? BigDecimal.ZERO : line.getAmountAllocated();
            BigDecimal newPaid = paid.add(delta.multiply(BigDecimal.valueOf(sign)));
            if (newPaid.signum() < 0) newPaid = BigDecimal.ZERO;
            inv.setPaidAmount(newPaid);
            updateInvoicePaymentStatus(inv);
            inv.setUpdatedAt(Instant.now());
        }
    }

    /** SCR-104 post: CREDIT note behaves like a payment (reduces the invoice's
     * outstanding balance via paidAmount); DEBIT note increases what's owed by raising
     * the invoice's totalAmount — there is no separate "amount owed" field, and total −
     * paid is this codebase's definition of outstanding balance throughout Phase 2. */
    private void applyCreditDebitNoteToInvoice(SalesCreditDebitNote note) {
        DocEntity invDoc = docs.getByNumberOrNull("sales-invoice", note.getOriginalInvoiceRef());
        if (!(invDoc instanceof SalesInvoice inv)) return;
        BigDecimal amount = note.getAmount() == null ? BigDecimal.ZERO : note.getAmount();
        if ("DEBIT".equalsIgnoreCase(note.getNoteType())) {
            BigDecimal total = inv.getTotalAmount() == null ? BigDecimal.ZERO : inv.getTotalAmount();
            inv.setTotalAmount(total.add(amount));
        } else {
            BigDecimal paid = inv.getPaidAmount() == null ? BigDecimal.ZERO : inv.getPaidAmount();
            inv.setPaidAmount(paid.add(amount));
        }
        updateInvoicePaymentStatus(inv);
        inv.setUpdatedAt(Instant.now());
    }

    private void updateInvoicePaymentStatus(SalesInvoice inv) {
        BigDecimal total = inv.getTotalAmount() == null ? BigDecimal.ZERO : inv.getTotalAmount();
        BigDecimal paid = inv.getPaidAmount() == null ? BigDecimal.ZERO : inv.getPaidAmount();
        if (paid.signum() <= 0) {
            if (Set.of("PARTIALLY_PAID", "PAID").contains(inv.getStatus())) inv.setStatus("POSTED");
        } else if (paid.compareTo(total) >= 0) {
            inv.setStatus("PAID");
        } else {
            inv.setStatus("PARTIALLY_PAID");
        }
    }

    /** SCR-101 "Convert to Quotation": carries the enquiry's customer and lines
     * forward into a new DRAFT Quotation (costed via the normal create() path), then
     * moves the enquiry to QUOTED and records the link back. */
    @SuppressWarnings("unchecked")
    private DocEntity convertEnquiryToQuotation(Long id, String user) {
        DocEntity ed = docs.get("enquiry", id);
        if (!(ed instanceof SalesEnquiry enq)) throw new IllegalArgumentException("Not an enquiry: " + id);
        if (enq.getLines() == null || enq.getLines().isEmpty()) {
            throw new IllegalArgumentException("Cannot convert an enquiry with no lines");
        }
        boolean hasValidLine = enq.getLines().stream()
                .anyMatch(l -> l.getItemCode() != null && !l.getItemCode().isBlank()
                        && l.getQty() != null && l.getQty().signum() > 0);
        if (!hasValidLine) {
            throw new IllegalArgumentException("At least one line must have both an item code and a quantity");
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("date", LocalDate.now().toString());
        body.put("enquiryRef", enq.getDocNo());
        body.put("customerCode", enq.getCustomerCode());
        body.put("customerName", enq.getCustomerName());
        body.put("currency", "INR");
        body.put("paymentTerms", "30 Days");
        List<Map<String, Object>> lines = new ArrayList<>();
        for (SalesEnquiryLine l : enq.getLines()) {
            Map<String, Object> lm = new LinkedHashMap<>();
            lm.put("itemCode", l.getItemCode());
            lm.put("description", l.getDescription());
            lm.put("qty", l.getQty());
            lm.put("uom", l.getUom());
            if (l.getTargetPrice() != null) lm.put("unitPrice", l.getTargetPrice());
            lines.add(lm);
        }
        body.put("lines", lines);

        DocEntity q = create("quotation", body, user);

        enq.setStatus("QUOTED");
        enq.setConvertedQuotationNo(q.getDocNo());
        enq.setUpdatedAt(Instant.now());
        enq.setUpdatedBy(user);
        return q;
    }

    /** SCR-102 "Revise" (D6): a post-SUBMITTED edit never mutates the existing row —
     * it creates a new row carrying the same docNo, revisionNo+1, and
     * parentQuotationId pointing back at this row, which itself moves to the
     * terminal SUPERSEDED status and becomes read-only (enforced by workflow rules
     * treating SUPERSEDED like any other terminal status — no direct-edit action
     * exists for it). */
    private DocEntity reviseQuotation(Long id, String user) {
        DocEntity ed = docs.get("quotation", id);
        if (!(ed instanceof SalesQuotation old)) throw new IllegalArgumentException("Not a quotation: " + id);
        if ("DRAFT".equals(old.getStatus())) {
            throw new IllegalArgumentException("A DRAFT quotation can be edited directly — revise is for a quotation that has already left DRAFT");
        }
        if (Set.of("SUPERSEDED", "WON", "LOST").contains(old.getStatus())) {
            throw new IllegalStateException("Cannot revise a quotation in status " + old.getStatus());
        }

        SalesQuotation rev = new SalesQuotation();
        rev.setDocNo(old.getDocNo());
        rev.setRevisionNo((old.getRevisionNo() == null ? 0 : old.getRevisionNo()) + 1);
        rev.setParentQuotationId(old.getId());
        rev.setEnquiryRef(old.getEnquiryRef());
        rev.setCustomerCode(old.getCustomerCode());
        rev.setCustomerName(old.getCustomerName());
        rev.setDocDate(LocalDate.now());
        rev.setValidityDate(old.getValidityDate());
        rev.setCurrency(old.getCurrency());
        rev.setExchangeRate(old.getExchangeRate());
        rev.setPaymentTerms(old.getPaymentTerms());
        rev.setDeliveryTerms(old.getDeliveryTerms());
        rev.setStatus("DRAFT");
        rev.setPlantId(old.getPlantId());
        rev.setCreatedBy(user);
        rev.setCreatedAt(Instant.now());
        rev.setUpdatedAt(Instant.now());

        List<SalesQuotationLine> newLines = new ArrayList<>();
        for (SalesQuotationLine l : (List<SalesQuotationLine>) old.getLines()) {
            SalesQuotationLine nl = new SalesQuotationLine();
            nl.setDoc(rev);
            nl.setLineNo(l.getLineNo());
            nl.setItemCode(l.getItemCode());
            nl.setMaterialGrade(l.getMaterialGrade());
            nl.setToleranceClass(l.getToleranceClass());
            nl.setSurfaceFinishRequirement(l.getSurfaceFinishRequirement());
            nl.setProcessRouteRef(l.getProcessRouteRef());
            nl.setCycleTimeMinutes(l.getCycleTimeMinutes());
            nl.setSetupTimeMinutes(l.getSetupTimeMinutes());
            nl.setToolingRequired(l.getToolingRequired());
            nl.setHeatTreatmentRequired(l.getHeatTreatmentRequired());
            nl.setHeatTreatmentSpec(l.getHeatTreatmentSpec());
            nl.setPlatingCoatingSpec(l.getPlatingCoatingSpec());
            nl.setInspectionMethod(l.getInspectionMethod());
            nl.setFaiPpapRequired(l.getFaiPpapRequired());
            nl.setMachineCode(l.getMachineCode());
            nl.setMaterialCostPerUnit(l.getMaterialCostPerUnit());
            nl.setToolingCostPerUnit(l.getToolingCostPerUnit());
            nl.setOverheadPercent(l.getOverheadPercent());
            nl.setMarginPercent(l.getMarginPercent());
            nl.setUnitPrice(l.getUnitPrice());
            nl.setQty(l.getQty());
            nl.setUom(l.getUom());
            nl.setTaxCode(l.getTaxCode());
            newLines.add(nl);
        }
        rev.setLines(newLines);
        computeQuotationCosting(rev);

        docs.persistNew(rev);

        old.setStatus("SUPERSEDED");
        old.setUpdatedAt(Instant.now());
        old.setUpdatedBy(user);
        return rev;
    }

    /** SCR-102 "Convert to Sales Order": carries the approved line pricing/spec
     * forward into a new Sales Order and marks the quotation WON. Only an APPROVED
     * or SENT_TO_CUSTOMER quotation may convert — nothing still under negotiation. */
    @SuppressWarnings("unchecked")
    private DocEntity convertQuotationToSo(Long id, String user) {
        DocEntity qd = docs.get("quotation", id);
        if (!(qd instanceof SalesQuotation q)) throw new IllegalArgumentException("Not a quotation: " + id);
        if (!Set.of("APPROVED", "SENT_TO_CUSTOMER").contains(q.getStatus())) {
            throw new IllegalStateException("Only an APPROVED or SENT_TO_CUSTOMER quotation can convert to a Sales Order");
        }
        if (q.getLines() == null || q.getLines().isEmpty()) {
            throw new IllegalArgumentException("Cannot convert a quotation with no lines");
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("date", LocalDate.now().toString());
        body.put("customerCode", q.getCustomerCode());
        body.put("customer", q.getCustomerName());
        body.put("currency", q.getCurrency());
        body.put("exchangeRate", q.getExchangeRate());
        body.put("paymentTerms", q.getPaymentTerms());
        body.put("deliveryTerms", q.getDeliveryTerms());
        body.put("quotationRef", q.getDocNo());
        // SalesOrderItem doesn't yet carry the full CNC engineering block (materialGrade,
        // toleranceClass, processRouteRef, cycleTimeMinutes, setupTimeMinutes,
        // faiPpapRequired — FRS SO-NEW-06) — that's Phase 4 scope (workflow engine /
        // SO enhancement), not Phase 3. Only the fields SalesOrderItem actually has
        // are carried across here; the rest of the quotation's engineering spec stays
        // visible via quotationRef on the header.
        List<Map<String, Object>> lines = new ArrayList<>();
        for (SalesQuotationLine l : (List<SalesQuotationLine>) q.getLines()) {
            Map<String, Object> lm = new LinkedHashMap<>();
            lm.put("itemCode", l.getItemCode());
            lm.put("orderQty", l.getQty());
            lm.put("unitPrice", l.getUnitPrice());
            lm.put("uom", l.getUom());
            lm.put("tax", taxPercentFromCode(l.getTaxCode()));
            lm.put("surfaceFinishRequirement", l.getSurfaceFinishRequirement());
            lm.put("heatTreatmentRequired", l.getHeatTreatmentRequired());
            lines.add(lm);
        }
        body.put("lines", lines);

        DocEntity so = create("sales-order", body, user);

        q.setStatus("WON");
        q.setConvertedSoNo(so.getDocNo());
        q.setUpdatedAt(Instant.now());
        q.setUpdatedBy(user);
        return so;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> dashboard() {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("newSalesOrders", countByStatus("sales-order", "DRAFT"));
        // Phase 4 tier router: a submitted SO lands on PENDING_TIER1/2/3, not the
        // generic SUBMITTED — count all four so this KPI doesn't silently undercount.
        d.put("pendingApproval", countByStatus("sales-order", "SUBMITTED")
                + countByStatus("sales-order", "PENDING_TIER1")
                + countByStatus("sales-order", "PENDING_TIER2")
                + countByStatus("sales-order", "PENDING_TIER3"));
        d.put("approvedOrders", countByStatus("sales-order", "APPROVED"));
        d.put("partiallyDispatched", countByStatus("sales-order", "PARTIALLY_DISPATCHED"));
        d.put("overdueOrders", computeOverdueSOs());
        d.put("pendingPi", countByStatus("proforma-invoice", "SUBMITTED"));
        d.put("pendingDispatch", countByStatus("sales-dc", "SUBMITTED"));
        d.put("dispatched", countByStatus("sales-dc", "DISPATCHED"));
        d.put("pendingInvoice", countByStatus("sales-invoice", "SUBMITTED"));
        d.put("postedInvoices", countByStatus("sales-invoice", "POSTED"));
        d.put("pendingReturns", countByStatus("dc-return", "SUBMITTED") + countByStatus("invoice-return", "SUBMITTED"));
        d.put("totalSO", docs.count("sales-order"));
        d.put("totalPI", docs.count("proforma-invoice"));
        d.put("totalDC", docs.count("sales-dc"));
        d.put("totalInvoice", docs.count("sales-invoice"));
        d.put("totalReturns", docs.count("dc-return") + docs.count("invoice-return"));

        // Phase 6 (Technical Design §2.9 / Improvement Plan §G): four new value-based KPIs.
        d.put("openOrderValue", openOrderValue());
        d.put("dispatchedMtd", dispatchedValueMtd());
        d.put("invoicedMtd", invoicedValueMtd());
        Map<String, Object> msme = overdueBeyondMsme45();
        d.put("overdueBeyondMsme45Count", msme.get("count"));
        d.put("overdueBeyondMsme45Value", msme.get("value"));
        d.put("invoiceAgeingBuckets", invoiceAgeingBuckets());
        return d;
    }

    private static final int MSME_45_DAYS = 45;

    /** ₹ value of Sales Orders still active in the pipeline (APPROVED or
     * PARTIALLY_DISPATCHED) — their full order value, not netted against what's
     * already dispatched/invoiced; "open" means the order itself is still open. */
    private BigDecimal openOrderValue() {
        Object result = em.createQuery(
                "select coalesce(sum(i.netAmount), 0) from SalesOrderItem i " +
                "where i.doc.status in ('APPROVED', 'PARTIALLY_DISPATCHED')")
                .getSingleResult();
        return result instanceof BigDecimal bd ? bd : BigDecimal.ZERO;
    }

    /** ₹ value dispatched this calendar month. Sales DC carries no pricing of its
     * own (it's a goods-movement document), so each dispatched line is valued at
     * the unit price on the Sales Order it references — a best-effort derivation,
     * not a substitute for a priced DC. */
    private BigDecimal dispatchedValueMtd() {
        LocalDate monthStart = LocalDate.now().withDayOfMonth(1);
        List<Object[]> dcLines = em.createQuery(
                "select l.itemCode, coalesce(l.currentDispatchQty, l.qty), coalesce(l.doc.salesOrderNo, l.doc.salesOrderNumber) " +
                "from SalesDcLine l where l.doc.status in ('POSTED','DISPATCHED','PARTIALLY_DISPATCHED','CONFIRMED') " +
                "and l.doc.docDate >= :monthStart", Object[].class)
                .setParameter("monthStart", monthStart)
                .getResultList();
        if (dcLines.isEmpty()) return BigDecimal.ZERO;

        Set<String> soNos = new HashSet<>();
        for (Object[] r : dcLines) if (r[2] != null) soNos.add((String) r[2]);
        Map<String, BigDecimal> rateByOrderAndItem = new HashMap<>();
        if (!soNos.isEmpty()) {
            List<Object[]> rates = em.createQuery(
                    "select i.doc.docNo, i.itemCode, i.unitPrice from SalesOrderItem i where i.doc.docNo in :soNos", Object[].class)
                    .setParameter("soNos", soNos)
                    .getResultList();
            for (Object[] r : rates) {
                rateByOrderAndItem.put(r[0] + "|" + r[1], r[2] instanceof BigDecimal bd ? bd : BigDecimal.ZERO);
            }
        }
        BigDecimal total = BigDecimal.ZERO;
        for (Object[] r : dcLines) {
            BigDecimal qty = r[1] instanceof BigDecimal bd ? bd : BigDecimal.ZERO;
            BigDecimal rate = rateByOrderAndItem.getOrDefault(r[2] + "|" + r[0], BigDecimal.ZERO);
            total = total.add(qty.multiply(rate));
        }
        return total;
    }

    /** ₹ value invoiced this calendar month — the real incl-tax invoice total
     * (SalesInvoice.totalAmount as persisted), not the generic list-view's
     * recomputed display figure. */
    private BigDecimal invoicedValueMtd() {
        LocalDate monthStart = LocalDate.now().withDayOfMonth(1);
        Object result = em.createQuery(
                "select coalesce(sum(i.totalAmount), 0) from SalesInvoice i " +
                "where i.status in ('POSTED','PARTIALLY_PAID','PAID') and i.docDate >= :monthStart")
                .setParameter("monthStart", monthStart)
                .getSingleResult();
        return result instanceof BigDecimal bd ? bd : BigDecimal.ZERO;
    }

    /** Invoices whose outstanding balance is still unpaid more than the MSME
     * Development Act's 45-day payment window past their due date (falling back to
     * doc date when no due date was captured). */
    private Map<String, Object> overdueBeyondMsme45() {
        LocalDate cutoff = LocalDate.now().minusDays(MSME_45_DAYS);
        List<Object[]> rows = em.createQuery(
                "select i.totalAmount, coalesce(i.paidAmount, 0), coalesce(i.dueDate, i.docDate) " +
                "from SalesInvoice i where i.status in ('POSTED','PARTIALLY_PAID') " +
                "and coalesce(i.dueDate, i.docDate) < :cutoff", Object[].class)
                .setParameter("cutoff", cutoff)
                .getResultList();
        long count = 0;
        BigDecimal value = BigDecimal.ZERO;
        for (Object[] r : rows) {
            BigDecimal total = r[0] instanceof BigDecimal bd ? bd : BigDecimal.ZERO;
            BigDecimal paid = r[1] instanceof BigDecimal bd ? bd : BigDecimal.ZERO;
            BigDecimal balance = total.subtract(paid);
            if (balance.signum() > 0) {
                count++;
                value = value.add(balance);
            }
        }
        return Map.of("count", count, "value", value);
    }

    /** Standard 0-30/31-45/46-60/60+ ageing buckets, by outstanding balance, keyed
     * off days-past-due-date (falling back to doc date). Unpaid/partially-paid
     * invoices only — a fully PAID invoice contributes nothing to ageing. */
    private Map<String, BigDecimal> invoiceAgeingBuckets() {
        Map<String, BigDecimal> buckets = new LinkedHashMap<>();
        buckets.put("0-30", BigDecimal.ZERO);
        buckets.put("31-45", BigDecimal.ZERO);
        buckets.put("46-60", BigDecimal.ZERO);
        buckets.put("60+", BigDecimal.ZERO);

        LocalDate today = LocalDate.now();
        List<Object[]> rows = em.createQuery(
                "select i.totalAmount, coalesce(i.paidAmount, 0), coalesce(i.dueDate, i.docDate) " +
                "from SalesInvoice i where i.status in ('POSTED','PARTIALLY_PAID')", Object[].class)
                .getResultList();
        for (Object[] r : rows) {
            BigDecimal total = r[0] instanceof BigDecimal bd ? bd : BigDecimal.ZERO;
            BigDecimal paid = r[1] instanceof BigDecimal bd ? bd : BigDecimal.ZERO;
            BigDecimal balance = total.subtract(paid);
            if (balance.signum() <= 0) continue;
            LocalDate dueDate = (LocalDate) r[2];
            long daysPastDue = dueDate == null ? 0 : java.time.temporal.ChronoUnit.DAYS.between(dueDate, today);
            String bucket = daysPastDue <= 30 ? "0-30" : daysPastDue <= 45 ? "31-45" : daysPastDue <= 60 ? "46-60" : "60+";
            buckets.merge(bucket, balance, BigDecimal::add);
        }
        return buckets;
    }

    // ── Phase 6 reports (Technical Design §2.9 / Improvement Plan §G) ──

    /** GET .../reports/ageing — invoice ageing, bucket totals plus per-invoice detail. */
    @Transactional(readOnly = true)
    public Map<String, Object> ageingReport() {
        LocalDate today = LocalDate.now();
        List<Object[]> rows = em.createQuery(
                "select i.docNo, i.customer, i.totalAmount, coalesce(i.paidAmount, 0), coalesce(i.dueDate, i.docDate) " +
                "from SalesInvoice i where i.status in ('POSTED','PARTIALLY_PAID') order by coalesce(i.dueDate, i.docDate) asc",
                Object[].class).getResultList();

        Map<String, BigDecimal> buckets = new LinkedHashMap<>();
        buckets.put("0-30", BigDecimal.ZERO);
        buckets.put("31-45", BigDecimal.ZERO);
        buckets.put("46-60", BigDecimal.ZERO);
        buckets.put("60+", BigDecimal.ZERO);
        List<Map<String, Object>> invoices = new ArrayList<>();

        for (Object[] r : rows) {
            BigDecimal total = r[2] instanceof BigDecimal bd ? bd : BigDecimal.ZERO;
            BigDecimal paid = r[3] instanceof BigDecimal bd ? bd : BigDecimal.ZERO;
            BigDecimal balance = total.subtract(paid);
            if (balance.signum() <= 0) continue;
            LocalDate dueDate = (LocalDate) r[4];
            long daysPastDue = dueDate == null ? 0 : java.time.temporal.ChronoUnit.DAYS.between(dueDate, today);
            String bucket = daysPastDue <= 30 ? "0-30" : daysPastDue <= 45 ? "31-45" : daysPastDue <= 60 ? "46-60" : "60+";
            buckets.merge(bucket, balance, BigDecimal::add);

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("docNo", r[0]);
            row.put("customer", r[1]);
            row.put("balance", balance);
            row.put("dueDate", dueDate);
            row.put("daysPastDue", daysPastDue);
            row.put("bucket", bucket);
            row.put("msmeBreach", daysPastDue > MSME_45_DAYS);
            invoices.add(row);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("buckets", buckets);
        result.put("invoices", invoices);
        return result;
    }

    /** GET .../reports/win-loss — Quotation win/loss counts, value, and average
     * quoted margin for WON quotations (line-qty-weighted). */
    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public Map<String, Object> winLossReport() {
        long won = 0, lost = 0;
        BigDecimal wonValue = BigDecimal.ZERO;
        BigDecimal marginSum = BigDecimal.ZERO;
        BigDecimal marginWeight = BigDecimal.ZERO;

        List<SalesQuotation> quotations = em.createQuery(
                "select q from SalesQuotation q where q.status in ('WON','LOST')", SalesQuotation.class)
                .getResultList();
        for (SalesQuotation q : quotations) {
            if ("WON".equals(q.getStatus())) {
                won++;
                if (q.getLines() != null) {
                    for (SalesQuotationLine l : (List<SalesQuotationLine>) q.getLines()) {
                        if (l.getNetAmount() != null) wonValue = wonValue.add(l.getNetAmount());
                        if (l.getMarginPercent() != null && l.getQty() != null) {
                            marginSum = marginSum.add(l.getMarginPercent().multiply(l.getQty()));
                            marginWeight = marginWeight.add(l.getQty());
                        }
                    }
                }
            } else {
                lost++;
            }
        }
        long total = won + lost;
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("wonCount", won);
        result.put("lostCount", lost);
        result.put("winRatePercent", total == 0 ? BigDecimal.ZERO : BigDecimal.valueOf(won * 100.0 / total).setScale(2, RoundingMode.HALF_UP));
        result.put("wonValue", wonValue);
        result.put("averageMarginWonPercent", marginWeight.signum() == 0 ? null : marginSum.divide(marginWeight, 2, RoundingMode.HALF_UP));
        return result;
    }

    /** GET .../reports/otd — on-time-delivery: committed Sales Order delivery date
     * vs. the actual dispatch date of the Sales DC(s) raised against it. An SO with
     * multiple partial dispatches is "on time" only if every dispatch cleared before
     * (or on) the committed date. */
    @Transactional(readOnly = true)
    public Map<String, Object> otdReport() {
        List<Object[]> rows = em.createQuery(
                "select s.docNo, s.deliveryDate, max(d.dispatchDate) " +
                "from SalesOrder s join SalesDc d on (d.salesOrderNo = s.docNo or d.salesOrderNumber = s.docNo) " +
                "where d.status in ('POSTED','DISPATCHED','PARTIALLY_DISPATCHED','CONFIRMED') and s.deliveryDate is not null " +
                "group by s.docNo, s.deliveryDate", Object[].class)
                .getResultList();

        long onTime = 0, late = 0;
        List<Map<String, Object>> detail = new ArrayList<>();
        for (Object[] r : rows) {
            LocalDate committed = (LocalDate) r[1];
            LocalDate lastDispatch = (LocalDate) r[2];
            boolean isOnTime = lastDispatch != null && !lastDispatch.isAfter(committed);
            if (isOnTime) onTime++; else late++;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("soDocNo", r[0]);
            row.put("committedDate", committed);
            row.put("lastDispatchDate", lastDispatch);
            row.put("onTime", isOnTime);
            detail.add(row);
        }
        long total = onTime + late;
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("onTimeCount", onTime);
        result.put("lateCount", late);
        result.put("otdPercent", total == 0 ? BigDecimal.ZERO : BigDecimal.valueOf(onTime * 100.0 / total).setScale(2, RoundingMode.HALF_UP));
        result.put("detail", detail);
        return result;
    }

    /** GET .../reports/gstr1-extract?period=YYYY-MM — invoice-wise + HSN-summary
     * outward-supply extract for POSTED-or-later invoices dated within the period. */
    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public Map<String, Object> gstr1Extract(String period) {
        LocalDate periodStart;
        LocalDate periodEnd;
        try {
            java.time.YearMonth ym = java.time.YearMonth.parse(period);
            periodStart = ym.atDay(1);
            periodEnd = ym.atEndOfMonth();
        } catch (Exception e) {
            throw new IllegalArgumentException("period must be in YYYY-MM format, got: " + period);
        }

        List<SalesInvoice> invoices = em.createQuery(
                "select i from SalesInvoice i where i.status in ('POSTED','PARTIALLY_PAID','PAID') " +
                "and i.docDate between :start and :end order by i.docDate asc", SalesInvoice.class)
                .setParameter("start", periodStart)
                .setParameter("end", periodEnd)
                .getResultList();

        List<Map<String, Object>> invoiceRows = new ArrayList<>();
        Map<String, BigDecimal[]> hsnSummary = new LinkedHashMap<>(); // hsn -> [taxableValue, taxAmount]
        for (SalesInvoice inv : invoices) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("docNo", inv.getDocNo());
            row.put("docDate", inv.getDocDate());
            row.put("customerGstin", inv.getCustomerGstin());
            row.put("placeOfSupply", inv.getPlaceOfSupply());
            row.put("taxType", inv.getTaxType());
            row.put("irnNumber", inv.getIrnNumber());
            row.put("totalAmount", inv.getTotalAmount());
            row.put("taxAmount", inv.getTaxAmount());
            invoiceRows.add(row);

            if (inv.getLines() != null) {
                for (SalesInvoiceItem l : (List<SalesInvoiceItem>) inv.getLines()) {
                    String hsn = l.getHsnSnapshot() == null || l.getHsnSnapshot().isBlank() ? "UNSPECIFIED" : l.getHsnSnapshot();
                    BigDecimal taxable = l.getNetAmount() != null && l.getTaxAmount() != null
                            ? l.getNetAmount().subtract(l.getTaxAmount()) : BigDecimal.ZERO;
                    BigDecimal tax = l.getTaxAmount() == null ? BigDecimal.ZERO : l.getTaxAmount();
                    BigDecimal[] agg = hsnSummary.computeIfAbsent(hsn, k -> new BigDecimal[]{BigDecimal.ZERO, BigDecimal.ZERO});
                    agg[0] = agg[0].add(taxable);
                    agg[1] = agg[1].add(tax);
                }
            }
        }
        List<Map<String, Object>> hsnRows = new ArrayList<>();
        for (var entry : hsnSummary.entrySet()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("hsn", entry.getKey());
            row.put("taxableValue", entry.getValue()[0]);
            row.put("taxAmount", entry.getValue()[1]);
            hsnRows.add(row);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("period", period);
        result.put("invoiceCount", invoices.size());
        result.put("invoices", invoiceRows);
        result.put("hsnSummary", hsnRows);
        return result;
    }

    private long computeOverdueSOs() {
        LocalDate today = LocalDate.now();
        long overdue = 0;
        for (String status : List.of("APPROVED", "PARTIALLY_DISPATCHED")) {
            Map<String, Object> page = docs.list("sales-order", Map.of("status", status, "size", "1000", "page", "0"));
            Object content = page.get("content");
            if (content instanceof List<?> list) {
                for (Object item : list) {
                    if (item instanceof DocEntity de && de.getDocNo() != null) {
                        DocEntity full = docs.getByNumberOrNull("sales-order", de.getDocNo());
                        if (full instanceof SalesOrder so && so.getDeliveryDate() != null && so.getDeliveryDate().isBefore(today)) {
                            overdue++;
                        }
                    }
                }
            }
        }
        return overdue;
    }

    private long countByStatus(String key, String status) {
        Map<String, Object> page = docs.list(key, Map.of("status", status, "size", "1", "page", "0"));
        Object total = page.get("totalElements");
        if (total instanceof Number n) return n.longValue();
        return 0;
    }
}
