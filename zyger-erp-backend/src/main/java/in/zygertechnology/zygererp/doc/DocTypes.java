package in.zygertechnology.zygererp.doc;

import java.util.*;

/**
 * Central registry of every document type in the system.
 * Each document type maps to its own dedicated header/line tables and carries
 * the business rules used during posting (stock effect, numbering prefix,
 * ledger transaction type and the line quantity field).
 */
public final class DocTypes {

    public enum Effect { IN, OUT, ADJUST, NONE }

    public record DocDef(String key, String prefix, Effect effect, String tx,
                         String qtyField, boolean hasLines) {
    }

    private static final Map<String, DocDef> DEFS = new LinkedHashMap<>();

    private static void reg(String key, String prefix, Effect effect, String tx,
                            String qtyField, boolean hasLines) {
        DEFS.put(key, new DocDef(key, prefix, effect, tx, qtyField, hasLines));
    }

    static {
        reg("po-inward",              "POI", Effect.IN,     "PO_INWARD",              "receivedQty", true);
        reg("lo-inward",              "LOI", Effect.IN,     "LO_INWARD",              "receivedQty", true);
        reg("jo-inward",              "JOI", Effect.IN,     "JO_INWARD",              "producedQty", true);
        reg("general-inward",         "GI",  Effect.IN,     "GENERAL_INWARD",         "receivedQty", true);
        reg("return-inward",          "RI",  Effect.IN,     "RETURN_INWARD",          "returnedQty", true);
        reg("grn",                    "GRN", Effect.IN,     "GRN",                    "acceptedQty", true);
        reg("stock-issue-request",    "SIR", Effect.NONE,   "STOCK_ISSUE_REQUEST",    "requestedQty", true);
        reg("rm-issue",               "RMI", Effect.OUT,    "RM_ISSUE",               "issueQty", true);
        reg("general-issue",          "GEI", Effect.OUT,    "GENERAL_ISSUE",          "issueQty", true);
        reg("jo-dc-issue",            "JDI", Effect.OUT,    "JO_DC_ISSUE",            "issueQty", true);
        reg("issue-internal-external","IIE", Effect.OUT,    "ISSUE_INTERNAL_EXTERNAL","issueQty", true);
        reg("issue-against-receipt",  "IAR", Effect.OUT,    "ISSUE_AGAINST_RECEIPT",  "issueQty", true);
        reg("sales-dc",               "SDC", Effect.OUT,    "SALES_DC",               "qty", true);
        reg("jo-dc",                  "JODC",Effect.OUT,    "JO_DC",                  "qty", true);
        reg("general-dc",             "GDC", Effect.OUT,    "GENERAL_DC",             "qty", true);
        reg("return-dc",              "RDC", Effect.OUT,    "RETURN_DC",              "qty", true);
        reg("transfer-dc",            "TDC", Effect.OUT,    "TRANSFER_DC",            "qty", true);
        reg("purchase-invoice",       "PI",  Effect.NONE,   "PURCHASE_INVOICE",       null, false);
        reg("subcontract-invoice",    "SI",  Effect.NONE,   "SUBCONTRACT_INVOICE",    "processedQty", true);
        reg("inward-return",          "IRT", Effect.IN,     "INWARD_RETURN",          "returnedQty", true);
        // Return Management Module FRS v1.0 §8: numbering prefixes canonicalized to
        // DCRET / INVRET / STKRET (previously DRT / IVT / IRN).
        reg("dc-return",              "DCRET", Effect.IN,   "DC_RETURN",              "currentReturnQty", true);
        reg("invoice-return",         "INVRET", Effect.IN,  "INVOICE_RETURN",         "currentReturnQty", true);
        reg("stock-return",           "STKRET", Effect.IN,  "STOCK_RETURN",           "returnedQty", true);
        reg("received-against-issue", "RAI", Effect.IN,     "RECEIVED_AGAINST_ISSUE", "returnedQty", true);
        reg("receipt-return",         "RCT", Effect.IN,     "RECEIPT_RETURN",         "returnedQty", true);
        // Stock Allotment & Adjustment Modules FRS v1.0 §10: numbering prefixes
        // canonicalized to STKALT / STKREL / STKAMD / PHYAMD (previously SA / SR /
        // SAM / PSA).
        reg("stock-allotment",        "STKALT", Effect.NONE,   "STOCK_ALLOTMENT",        "allottedQty", true);
        reg("stock-release",          "STKREL", Effect.NONE,   "STOCK_RELEASE",          "releasedQty", true);
        reg("stock-amendment",        "STKAMD", Effect.ADJUST, "STOCK_AMENDMENT",        null, false);
        reg("physical-stock-amendment","PHYAMD",Effect.ADJUST, "PHYSICAL_STOCK_AMENDMENT","physicalQty", true);
        reg("quality-inspection",      "QI",  Effect.NONE,  "QUALITY_INSPECTION",     null, true);
        reg("quality-ncr",             "NCR", Effect.NONE,  "QUALITY_NCR",            null, true);
        reg("quality-concession",      "CON", Effect.NONE,  "QUALITY_CONCESSION",     null, false);
        reg("quality-test-certificate","TC",  Effect.NONE,  "QUALITY_TEST_CERTIFICATE", null, true);
        reg("quality-calibration-record","CAL",Effect.NONE, "QUALITY_CALIBRATION",    null, false);
        reg("quality-customer-complaint","CC",Effect.NONE,  "QUALITY_COMPLAINT",      null, false);
        reg("quality-capa",            "CAPA",Effect.NONE,  "QUALITY_CAPA",           null, false);
        reg("quality-8d",              "8D",  Effect.NONE,  "QUALITY_8D",             null, true);
        reg("quality-scar",            "SCAR",Effect.NONE,  "QUALITY_SCAR",           null, true);
        // Master data
        reg("customer",                "CUS", Effect.NONE,  "CUSTOMER",               null, false);
        reg("supplier",                "SUP", Effect.NONE,  "SUPPLIER",               null, false);
        reg("subcontractor",           "SUB", Effect.NONE,  "SUBCONTRACTOR",          null, false);
        reg("uom",                     "UOM", Effect.NONE,  "UOM",                    null, false);
        reg("item-group",              "IG",  Effect.NONE,  "ITEM_GROUP",             null, false);
reg("process",                 "PRC", Effect.NONE,  "PROCESS",                null, false);
        reg("store",                   "STR", Effect.NONE,  "STORE",                  null, false);
        reg("rack",                    "RCK", Effect.NONE,  "RACK",                   null, false);
        reg("bin",                     "BIN", Effect.NONE,  "BIN",                    null, false);
        reg("process-group",           "PG",  Effect.NONE,  "PROCESS_GROUP",          null, false);
        reg("resource",                "RES", Effect.NONE,  "RESOURCE",               null, false);
        reg("machine",                 "MAC", Effect.NONE,  "MACHINE",                null, false);
        reg("instrument",              "INS", Effect.NONE,  "INSTRUMENT",             null, false);
        reg("tool",                    "TOL", Effect.NONE,  "TOOL",                   null, false);
        reg("work-center",             "WC",  Effect.NONE,  "WORK_CENTER",            null, false);
        reg("operation",               "OP",  Effect.NONE,  "OPERATION",              null, false);
        reg("location",                "LOC", Effect.NONE,  "LOCATION",               null, false);
        reg("item-purchasable",        "PIT", Effect.NONE,  "ITEM_PURCHASABLE",       null, false);
        reg("item-customer",           "CSM", Effect.NONE,  "ITEM_CUSTOMER",          null, false);
        reg("item-manufacturing",      "MFG", Effect.NONE,  "ITEM_MANUFACTURING",     null, false);
        reg("csm",                     "CSM", Effect.NONE,  "CUSTOMER_SUPPLIED",      null, false);
        reg("mfg",                     "MFG", Effect.NONE,  "MANUFACTURING",          null, false);
        reg("itm",                     "ITM", Effect.NONE,  "PURCHASE_ITEM",          null, false);


        // Purchase module
        reg("purchase-request",         "PR",  Effect.NONE,  "PURCHASE_REQUEST",       null, true);
        reg("supplier-enquiry",         "SE",  Effect.NONE,  "SUPPLIER_ENQUIRY",       null, true);
        reg("supplier-quotation",       "SQ",  Effect.NONE,  "SUPPLIER_QUOTATION",     null, true);
        reg("purchase-order",           "PO",  Effect.NONE,  "PURCHASE_ORDER",         null, true);
        // FRS DOC-PUR-FRS-02 §9 (PUR-07): vendor return — stock OUT, unlike every other
        // "return" type in the system which is IN. See entity/PurchaseReturn.java.
        reg("purchase-return",          "PRN", Effect.OUT,   "PURCHASE_RETURN",        "returnQty", true);
        reg("job-order",                "JO",  Effect.NONE,  "JOB_ORDER",              null, true);
        reg("purchase-target",          "PT",  Effect.NONE,  "PURCHASE_TARGET",        null, false);
        reg("purchase-price-list",      "PPL", Effect.NONE,  "PURCHASE_PRICE_LIST",    null, false);
        reg("job-work-price-list",      "JWPL",Effect.NONE,  "JOB_WORK_PRICE_LIST",    null, false);
        // Sales module
        reg("sales-order",              "SO",   Effect.NONE,  "SALES_ORDER",            null, true);
        reg("proforma-invoice",         "PROF", Effect.NONE,  "PROFORMA_INVOICE",       null, true);
        reg("sales-invoice",            "SINV", Effect.NONE,  "SALES_INVOICE",          null, true);
        // Phase 2 (SCR-103/SCR-104): Payment Collection and Credit/Debit Note.
        // Credit/Debit Note's real prefix is CN or DN depending on noteType — resolved
        // per-request in DocumentFacade.nextNumberFor(), mirroring the existing
        // issue-internal-external body-driven-prefix pattern; "CN" here is just the
        // static fallback DocTypes requires one value for.
        reg("payment-receipt",    "RCPT", Effect.NONE,  "SALES_PAYMENT_RECEIPT",  "amountAllocated", true);
        reg("credit-debit-note",  "CN",   Effect.NONE,  "SALES_CREDIT_DEBIT_NOTE", null, false);
        // Phase 3 (SCR-101/SCR-102): Enquiry and Costed Quotation.
        reg("enquiry",            "ENQ",  Effect.NONE,  "SALES_ENQUIRY",          "qty", true);
        reg("quotation",          "QTN",  Effect.NONE,  "SALES_QUOTATION",        "qty", true);
        // Planning module
        reg("production-bom",            "BOM",  Effect.NONE,  "PRODUCTION_BOM",         null, true);
        reg("route-sheet",               "RT",   Effect.NONE,  "ROUTE_SHEET",            null, true);
        reg("work-order",                "WO",   Effect.NONE,  "WORK_ORDER",             null, true);
        reg("shop-floor-entry",          "SFE",  Effect.NONE,  "SHOP_FLOOR_ENTRY",       null, false);
        // Production Material Request + Consumption (P6, DOC 07 §21.2, DOC 13 API-MREQ)
        reg("material-request",          "PM",   Effect.NONE,  "MATERIAL_REQUEST",       null, true);
        reg("production-consumption",    "PC",   Effect.OUT,   "PRODUCTION_CONSUMPTION", "consumedQty", true);
        // Batch Card (P10, DOC 07 §21.2, ADR-PROD-004): recording-only, no stock effect
        reg("batch-card",                "BC",   Effect.NONE,  "BATCH_CARD",             null, true);
        // Production Return (P12, DOC 07 §21.2, CLAR-PROD-003, D-C1, D-C2): stock-in on RECEIVE
        // PREFIX aligned to the V2 numbering_config seed ('PR') so the config is the single
        // source of truth (F11; legacy DocTypes 'PRR' fallback removed). Effect/tx unchanged.
        reg("production-return",         "PR",   Effect.IN,    "RETURN_RECEIPT",         "quantity", false);
        // Product Conversion (P13, DOC_57 §4 #15): CV prefix (FRS canonical, supersedes legacy PC).
        // Header-only registration (Effect.NONE) — conversion posting is bidirectional and is
        // performed explicitly by ProductConversionService via the Inventory service boundary.
        reg("product-conversion",        "CV",   Effect.NONE,  "CONVERSION",             null, false);
    }

    private DocTypes() {}

    public static DocDef get(String key) {
        DocDef d = DEFS.get(key);
        if (d == null) throw new IllegalArgumentException("Unknown document type: " + key);
        return d;
    }

    public static boolean exists(String key) { return DEFS.containsKey(key); }

    public static Set<String> keys() { return Collections.unmodifiableSet(DEFS.keySet()); }

    public static Collection<DocDef> all() { return Collections.unmodifiableCollection(DEFS.values()); }
}
