package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.doc.DocTypes;
import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.ItemRepository;
import in.zygertechnology.zygererp.repo.LedgerRepository;
import in.zygertechnology.zygererp.repo.StoreMasterRepository;
import in.zygertechnology.zygererp.service.DocumentFacade;
import in.zygertechnology.zygererp.service.ExportService;
import in.zygertechnology.zygererp.service.QualityInspectionService;
import in.zygertechnology.zygererp.service.StockService;
import in.zygertechnology.zygererp.security.RequirePermission;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@RestController @RequiredArgsConstructor
@RequirePermission(module = "REPORTS", screen = "*", action = "VIEW")
public class ReportController {

    private final DocumentFacade docs;
    private final StockService stock;
    private final ItemRepository items;
    private final LedgerRepository ledger;
    private final ExportService export;
    private final StoreMasterRepository stores;
    private final EntityManager em;

    private static final String[] INWARD_KEYS = {"po-inward", "lo-inward", "jo-inward", "general-inward"};
    private static final String[] INWARD_LABELS = {"PO_INWARD", "LO_INWARD", "JO_INWARD", "GENERAL_INWARD"};

    /** TxTypes that represent a REAL physical stock increase (used for the
     * movement summary). Internal status moves that do not change on-hand
     * stock (QC_RELEASE, TRANSFER_INTRANSIT_*, JO_DC_SEND, ...) and reversals
     * are excluded so "In − Out" reconciles against the stock balance. */
    private static final Set<String> STOCK_IN_TX_TYPES = Set.of(
            "PO_INWARD", "LO_INWARD", "JO_INWARD", "GENERAL_INWARD", "RETURN_INWARD", "GRN",
            "DC_RETURN", "INVOICE_RETURN", "STOCK_RETURN", "RECEIVED_AGAINST_ISSUE", "RECEIPT_RETURN",
            "RETURN_RECEIPT", "FG_RECEIPT", "TRANSFER_RECEIPT", "TRANSFER_IN",
            "CONVERSION_IN", "QC_INSPECTION_PASS");

    /** TxTypes that represent a REAL physical stock decrease. Note: maintenance
     * spare-part "ISSUE" is ledger-only (it doesn't decrement stock_balance)
     * but is still a physical issue, so it is counted as movement. */
    private static final Set<String> STOCK_OUT_TX_TYPES = Set.of(
            "RM_ISSUE", "GENERAL_ISSUE", "JO_DC_ISSUE", "ISSUE_INTERNAL_EXTERNAL",
            "ISSUE_AGAINST_RECEIPT", "SALES_DC", "JO_DC", "GENERAL_DC", "RETURN_DC",
            "TRANSFER_DC", "STOCK_RELEASE", "PURCHASE_RETURN", "PRODUCTION_CONSUMPTION",
            "QC_DISPOSE", "ISSUE");

    @GetMapping("/api/inventory/dashboard/summary")
    Map<String, Object> dashboard() {
        Map<String, StockService.Balance> bal = stock.balances();
        double onHand = 0, reserved = 0, available = 0;
        for (StockService.Balance b : bal.values()) {
            onHand += b.onHand();
            reserved += b.reserved();
            available += b.available();
        }
        long pendingInward = 0, pendingApproval = 0;
        for (DocEntity d : docs.findAll("po-inward")) {
            if ("SUBMITTED".equals(d.getStatus())) pendingApproval++;
            if (List.of("SUBMITTED", "APPROVED").contains(d.getStatus())) pendingInward++;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("totalOnHand", round(onHand));
        m.put("reservedQty", round(reserved));
        m.put("availableQty", round(available));
        m.put("lowStockCount", lowStockItems().size());
        m.put("pendingInwardCount", pendingInward);
        m.put("pendingApprovalCount", pendingApproval);
        m.put("ledgerEntryCount", ledger.count());
        m.put("activeStoreCount", stores.findByActiveTrue().size());
        return m;
    }

    @GetMapping("/api/inventory-transactions")
    Map<String, Object> transactions(@RequestParam Map<String, String> q) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (StockLedger e : ledger.findTop8ByOrderByTxDateDesc()) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", e.getId());
            r.put("date", e.getTxDate() == null ? "" : e.getTxDate().toString());
            r.put("documentNo", e.getDocNo());
            r.put("transactionType", e.getTxType());
            r.put("itemCode", e.getItemCode());
            r.put("inQty", bd(e.getInQty()));
            r.put("outQty", bd(e.getOutQty()));
            rows.add(r);
        }
        return docs.paginate(rows, q);
    }

    @GetMapping("/api/inventory/low-stock")
    Map<String, Object> lowStock(@RequestParam Map<String, String> q) {
        return docs.paginate(lowStockItems().stream()
                .map(m -> { m.put("id", m.get("itemCode")); return m; })
                .collect(Collectors.toList()), q);
    }

    private List<Map<String, Object>> lowStockItems() {
        Map<String, Double> onHand = new LinkedHashMap<>();
        for (StockService.Balance b : stock.balances().values())
            onHand.merge(b.item(), b.onHand(), Double::sum);
        List<Map<String, Object>> out = new ArrayList<>();
        for (ItemMaster it : items.findAll()) {
            double qty = onHand.getOrDefault(it.getCode(), 0d);
            double threshold = reorderThreshold(it);
            if (threshold <= 0) continue;
            if (!isLowStock(reorderStatus(qty, it))) continue;
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("itemCode", it.getCode());
            r.put("itemName", it.getDescription());
            r.put("specification", str(it.getSpecification()));
            r.put("itemType", str(it.getItemType()));
            r.put("uom", str(it.getUom()));
            r.put("onHandQty", round(qty));
            r.put("safetyQty", round(it.getSafetyStock() == null ? 0 : it.getSafetyStock().doubleValue()));
            r.put("reorderPoint", round(threshold));
            r.put("maxStockLevel", round(it.getMaxStockLevel() == null ? 0 : it.getMaxStockLevel().doubleValue()));
            r.put("reorderQty", it.getReorderQty() == null ? null : round(it.getReorderQty().doubleValue()));
            r.put("shortage", round(Math.max(0, threshold - qty)));
            r.put("suggestedOrderQty", round(suggestedOrderQty(it)));
            r.put("status", reorderStatus(qty, it));
            out.add(r);
        }
        return out;
    }

    /** The yellow "Reorder Soon" band from the alert spec: items at or above
     * their reorder point but within a 20% buffer of it — a heads-up before
     * they actually go low, not just an alarm after. Only meaningful for items
     * with a real (non-zero) safety stock configured. */
    private List<Map<String, Object>> reorderSoonItems() {
        Map<String, Double> onHand = new LinkedHashMap<>();
        for (StockService.Balance b : stock.balances().values())
            onHand.merge(b.item(), b.onHand(), Double::sum);
        List<Map<String, Object>> out = new ArrayList<>();
        for (ItemMaster it : items.findAll()) {
            double threshold = reorderThreshold(it);
            if (threshold <= 0) continue;
            double qty = onHand.getOrDefault(it.getCode(), 0d);
            double bufferTop = threshold * 1.2;
            if (qty < threshold || qty >= bufferTop) continue;
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("itemCode", it.getCode());
            r.put("itemName", it.getDescription());
            r.put("specification", str(it.getSpecification()));
            r.put("itemType", str(it.getItemType()));
            r.put("uom", str(it.getUom()));
            r.put("onHandQty", round(qty));
            r.put("safetyQty", round(it.getSafetyStock() == null ? 0 : it.getSafetyStock().doubleValue()));
            r.put("reorderPoint", round(threshold));
            r.put("suggestedOrderQty", 0d);
            r.put("status", "REORDER_SOON");
            out.add(r);
        }
        return out;
    }

    @GetMapping("/api/inventory/inward/dashboard")
    Map<String, Object> inwardDashboard(@RequestParam(required = false) String fromDate,
                                        @RequestParam(required = false) String toDate) {
        Map<String, double[]> acc = new LinkedHashMap<>();
        acc.put("total", new double[3]);
        for (String key : INWARD_KEYS) acc.put(key, new double[3]);
        for (String key : INWARD_KEYS) {
            for (DocEntity d : docs.findAll(key)) {
                if (!"POSTED".equals(d.getStatus())) continue;
                if (outOfRange(d, fromDate, toDate)) continue;
                double qty = d.getLines().stream().mapToDouble(l -> l.getQty().doubleValue()).sum();
                double amt = d.getLines().stream()
                        .mapToDouble(l -> (l.getRate() == null ? 0 : l.getRate().doubleValue()) * l.getQty().doubleValue()).sum();
                acc.get("total")[0] += 1;
                acc.get("total")[1] += qty;
                acc.get("total")[2] += amt;
                double[] a = acc.get(key);
                a[0] += 1; a[1] += qty; a[2] += amt;
            }
        }
        Map<String, Object> byType = new LinkedHashMap<>();
        for (int i = 0; i < INWARD_KEYS.length; i++)
            byType.put(INWARD_LABELS[i], slice(acc.get(INWARD_KEYS[i])));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("total", slice(acc.get("total")));
        m.put("byType", byType);

        double[] pendingAcc = new double[3];
        for (String key : INWARD_KEYS) {
            for (DocEntity d : docs.findAll(key)) {
                if (!List.of("SUBMITTED", "APPROVED").contains(d.getStatus())) continue;
                double qty = d.getLines().stream().mapToDouble(l -> l.getQty().doubleValue()).sum();
                double amt = d.getLines().stream()
                        .mapToDouble(l -> (l.getRate() == null ? 0 : l.getRate().doubleValue()) * l.getQty().doubleValue()).sum();
                pendingAcc[0] += 1; pendingAcc[1] += qty; pendingAcc[2] += amt;
            }
        }
        m.put("pending", slice(pendingAcc));
        return m;
    }

    @GetMapping("/api/inventory/inward/log")
    List<Map<String, Object>> inwardLog() {
        return inwardRows(Set.of("DRAFT", "SUBMITTED", "APPROVED", "POSTED", "REJECTED", "CANCELLED"));
    }

    @GetMapping("/api/inventory/inward/pending")
    List<Map<String, Object>> inwardPending() {
        return inwardRows(Set.of("SUBMITTED", "APPROVED"));
    }

    private List<Map<String, Object>> inwardRows(Set<String> statuses) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = 0; i < INWARD_KEYS.length; i++) {
            for (DocEntity d : docs.findAll(INWARD_KEYS[i])) {
                if (statuses != null && !statuses.contains(d.getStatus())) continue;
                Map<String, Object> r = docs.toRow(d);
                r.put("type", INWARD_LABELS[i]);
                out.add(r);
            }
        }
        out.sort((a, b) -> {
            String da = String.valueOf(a.get("date"));
            String db = String.valueOf(b.get("date"));
            int c = db.compareTo(da);
            if (c != 0) return c;
            long ia = ((Number) a.get("id")).longValue();
            long ib = ((Number) b.get("id")).longValue();
            return Long.compare(ib, ia);
        });
        return out;
    }

    @GetMapping("/api/inventory/inward/chart")
    List<Map<String, Object>> inwardChart(@RequestParam(required = false) String fromDate,
                                          @RequestParam(required = false) String toDate,
                                          @RequestParam(defaultValue = "COUNT") String metric) {
        Map<String, double[]> acc = new TreeMap<>();
        for (String key : INWARD_KEYS) {
            for (DocEntity d : docs.findAll(key)) {
                if (!"POSTED".equals(d.getStatus())) continue;
                if (outOfRange(d, fromDate, toDate)) continue;
                double qty = d.getLines().stream().mapToDouble(l -> l.getQty().doubleValue()).sum();
                double amt = d.getLines().stream()
                        .mapToDouble(l -> (l.getRate() == null ? 0 : l.getRate().doubleValue()) * l.getQty().doubleValue()).sum();
                double v = switch (metric) {
                    case "QTY" -> qty;
                    case "AMOUNT" -> amt;
                    default -> 1;
                };
                double[] a = acc.computeIfAbsent(String.valueOf(d.getDocDate()), x -> new double[4]);
                a[Arrays.asList(INWARD_KEYS).indexOf(key)] += v;
            }
        }
        List<Map<String, Object>> out = new ArrayList<>();
        acc.forEach((date, a) -> {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("date", date);
            for (int i = 0; i < INWARD_KEYS.length; i++) r.put(INWARD_LABELS[i], round(a[i]));
            out.add(r);
        });
        return out;
    }

    @GetMapping("/api/inventory/reports/overview")
    Map<String, Object> overview(@RequestParam(required = false) String fromDate,
                                 @RequestParam(required = false) String toDate) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("kpis", kpis());
        out.put("monthlyStatus", monthlyStatus());
        out.put("categoryDistribution", categoryDistribution());
        out.put("locationDistribution", locationDistribution());
        out.put("inwardIssueTrend", trend());
        out.put("topItemsByValue", topItems());
        out.put("slowMovingItems", slowMovers());
        out.put("abcAnalysis", abcAnalysis());
        out.put("stockAging", stockAging());
        out.put("received", movementSummary(fromDate, toDate, true));
        out.put("issued", movementSummary(fromDate, toDate, false));
        String today = LocalDate.now().toString();
        out.put("receivedToday", movementSummary(today, today, true));
        out.put("issuedToday", movementSummary(today, today, false));
        return out;
    }

    @GetMapping("/api/inventory/reports/stock-ledger")
    Map<String, Object> stockLedger(@RequestParam Map<String, String> q) {
        return docs.paginate(ledgerRows(q), q);
    }

    @GetMapping("/api/inventory/reports/current-stock")
    Map<String, Object> currentStock(@RequestParam Map<String, String> q) {
        return docs.paginate(currentStockRows(q), q);
    }

    @GetMapping("/api/inventory/reports/drilldown/{type}")
    Map<String, Object> drilldown(@PathVariable String type, @RequestParam Map<String, String> q) {
        return docs.paginate(drilldownRows(type, q), q);
    }

    @GetMapping("/api/inventory/reports/drilldown/{type}/export")
    ResponseEntity<byte[]> drilldownExport(@PathVariable String type, @RequestParam Map<String, String> q) {
        return file(export.build(drilldownRows(type, q), q.getOrDefault("format", "xlsx"), type), q.getOrDefault("format", "xlsx"), type);
    }

    @GetMapping("/api/inventory/reports/stock-ledger/export")
    ResponseEntity<byte[]> ledgerExport(@RequestParam Map<String, String> q) {
        return file(export.build(ledgerRows(q), q.getOrDefault("format", "xlsx"), "stock-ledger"),
                q.getOrDefault("format", "xlsx"), "stock-ledger");
    }

    @GetMapping("/api/inventory/reports/current-stock/export")
    ResponseEntity<byte[]> currentExport(@RequestParam Map<String, String> q) {
        return file(export.build(currentStockRows(q), q.getOrDefault("format", "xlsx"), "current-stock"),
                q.getOrDefault("format", "xlsx"), "current-stock");
    }

    /** Item-wise stock: one row per item with totals across all stores plus a
     * per-store breakdown — the "how much of this item do I have anywhere"
     * report for the shop floor. */
    @GetMapping("/api/inventory/reports/item-stock")
    Map<String, Object> itemStock(@RequestParam Map<String, String> q) {
        return docs.paginate(itemStockRows(q), q);
    }

    @GetMapping("/api/inventory/reports/item-stock/export")
    ResponseEntity<byte[]> itemStockExport(@RequestParam Map<String, String> q) {
        return file(export.build(itemStockRows(q), q.getOrDefault("format", "xlsx"), "item-stock"),
                q.getOrDefault("format", "xlsx"), "item-stock");
    }

    /** Store-wise stock: per store, its item-by-item breakdown (summed across
     * batches/heats) — filter with location=<storeCode> for a single store. */
    @GetMapping("/api/inventory/reports/store-stock")
    Map<String, Object> storeStock(@RequestParam Map<String, String> q) {
        return docs.paginate(storeStockRows(q), q);
    }

    @GetMapping("/api/inventory/reports/store-stock/export")
    ResponseEntity<byte[]> storeStockExport(@RequestParam Map<String, String> q) {
        return file(export.build(storeStockRows(q), q.getOrDefault("format", "xlsx"), "store-stock"),
                q.getOrDefault("format", "xlsx"), "store-stock");
    }

    @GetMapping("/api/inventory/reports/stock-summary")
    Map<String, Object> stockSummary() {
        Map<String, StockService.Balance> bal = stock.balances();
        Map<String, Double> onHand = new LinkedHashMap<>();
        Map<String, Double> available = new LinkedHashMap<>();
        for (StockService.Balance b : bal.values()) {
            onHand.merge(b.item(), b.onHand(), Double::sum);
            available.merge(b.item(), b.available(), Double::sum);
        }
        Map<String, Double> inwardRates = latestInwardItemRates();
        Map<String, double[]> byGroup = new LinkedHashMap<>();
        for (ItemMaster it : items.findAll()) {
            String g = groupName(it);
            double oh = onHand.getOrDefault(it.getCode(), 0d);
            double avail = available.getOrDefault(it.getCode(), 0d);
            double rate = itemRate(it, inwardRates, it.getCode(), null);
            double[] a = byGroup.computeIfAbsent(g, x -> new double[6]);
            a[0] += 1;                             // itemCount
            a[1] += oh;                            // qtyOnHand
            a[2] += oh * rate;                     // value
            if (avail <= 0) a[3] += 1;             // notAvailableCount
            if (isLowStock(reorderStatus(oh, it))) a[4] += 1; // lowStockCount
            a[5] += avail;                         // qtyAvailable
        }
        List<Map<String, Object>> groups = new ArrayList<>();
        double[] totals = new double[6];
        for (Map.Entry<String, double[]> en : byGroup.entrySet()) {
            Map<String, Object> r = new LinkedHashMap<>();
            double[] a = en.getValue();
            r.put("group", en.getKey());
            r.put("itemCount", (long) a[0]);
            r.put("qtyOnHand", round(a[1]));
            r.put("qtyAvailable", round(a[5]));
            r.put("value", round(a[2]));
            r.put("notAvailableCount", (long) a[3]);
            r.put("lowStockCount", (long) a[4]);
            for (int i = 0; i < 6; i++) totals[i] += a[i];
            groups.add(r);
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("groups", groups);
        m.put("totals", Map.of(
                "itemCount", (long) totals[0],
                "qtyOnHand", round(totals[1]),
                "qtyAvailable", round(totals[5]),
                "value", round(totals[2]),
                "notAvailableCount", (long) totals[3],
                "lowStockCount", (long) totals[4]));
        m.put("notAvailableItems", notAvailableRows());
        return m;
    }

    private List<Map<String, Object>> notAvailableRows() {
        Map<String, StockService.Balance> bal = stock.balances();
        Map<String, Double> available = new LinkedHashMap<>();
        for (StockService.Balance b : bal.values())
            available.merge(b.item(), b.available(), Double::sum);
        List<Map<String, Object>> out = new ArrayList<>();
        for (ItemMaster it : items.findAll()) {
            double avail = available.getOrDefault(it.getCode(), 0d);
            if (avail > 0) continue;
            out.add(itemSummaryRow(it, 0));
        }
        return out;
    }

    private Map<String, Object> itemSummaryRow(ItemMaster it, double avail) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("itemCode", it.getCode());
        r.put("itemName", it.getDescription());
        r.put("specification", str(it.getSpecification()));
        r.put("category", str(it.getCategory()));
        r.put("itemType", str(it.getItemType()));
        r.put("itemGroup", str(groupName(it)));
        r.put("uom", str(it.getUom()));
        r.put("defaultWarehouse", str(it.getDefaultWarehouse()));
        r.put("available", round(avail));
        r.put("status", avail <= 0 ? "NOT_AVAILABLE" : "AVAILABLE");
        return r;
    }

    private String groupName(ItemMaster it) {
        if (it == null) return "Uncategorized";
        ItemGroup g = it.getItemGroup();
        if (g == null) return "Uncategorized";
        String nm = g.getName();
        if (nm == null || nm.isBlank()) nm = g.getCode();
        return nm == null || nm.isBlank() ? "Uncategorized" : nm;
    }

    @GetMapping("/api/inventory/reports/simple")
    Map<String, Object> simple() {
        Map<String, Object> summary = stockSummary();
        @SuppressWarnings("unchecked")
        Map<String, Object> totals = (Map<String, Object>) summary.get("totals");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> groups = (List<Map<String, Object>>) summary.get("groups");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("totals", totals);
        m.put("groups", groups);
        m.put("reorderList", lowStockItems());
        m.put("reorderSoonList", reorderSoonItems());
        return m;
    }

    @GetMapping("/api/inventory/reports/not-available")
    Map<String, Object> notAvailable(@RequestParam Map<String, String> q) {
        return docs.paginate(notAvailableRows(), q);
    }

    @GetMapping("/api/inventory/reports/simple/export")
    ResponseEntity<byte[]> simpleExport(@RequestParam(defaultValue = "pdf") String format) {
        List<Map<String, Object>> rows = simpleExportRows();
        return file(export.build(rows, format, "stock-snapshot"), format, "stock-snapshot");
    }

    private List<Map<String, Object>> simpleExportRows() {
        Map<String, Object> simple = simple();
        @SuppressWarnings("unchecked")
        Map<String, Object> t = (Map<String, Object>) simple.get("totals");
        List<Map<String, Object>> rows = new ArrayList<>();
        rows.add(Map.of("Section", "STOCK SNAPSHOT", "Item", "", "Qty", "", "Value", ""));
        rows.add(Map.of("Section", "Total items", "Item", t.get("itemCount"), "Qty", "", "Value", ""));
        rows.add(Map.of("Section", "Total quantity in store", "Item", "", "Qty", t.get("qtyOnHand"), "Value", ""));
        rows.add(Map.of("Section", "Total stock value", "Item", "", "Qty", "", "Value", t.get("value")));
        rows.add(Map.of("Section", "Items not available", "Item", t.get("notAvailableCount"), "Qty", "", "Value", ""));
        rows.add(Map.of("Section", "Low stock items", "Item", t.get("lowStockCount"), "Qty", "", "Value", ""));
        rows.add(Map.of("Section", "", "Item", "", "Qty", "", "Value", ""));
        rows.add(Map.of("Section", "GROUP WISE BREAKDOWN", "Item", "", "Qty", "", "Value", ""));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> groups = (List<Map<String, Object>>) simple.get("groups");
        for (Map<String, Object> g : groups) {
            rows.add(Map.of("Section", "  " + g.get("group"),
                    "Item", g.get("itemCount"),
                    "Qty", g.get("qtyOnHand"),
                    "Value", g.get("value")));
        }
        return rows;
    }

    private List<Map<String, Object>> drilldownRows(String type, Map<String, String> q) {
        return switch (type) {
            case "current-stock" -> currentStockRows(q);
            case "store-stock-summary" -> storeStockSummaryRows();
            case "low-stock" -> lowStockRows();
            case "not-available" -> notAvailableRows();
            case "reservations" -> reservationRows();
            case "pending-inward" -> pendingRows(false, q);
            case "pending-approvals" -> pendingRows(true, q);
            case "inventory-log" -> ledgerRows(q);
            default -> {
                if (!docs.isRegistered(type))
                    throw new IllegalArgumentException("Unknown report type: " + type);
                List<Map<String, Object>> rows = new ArrayList<>();
                for (DocEntity d : docs.findAll(type)) {
                    if (!inRange(d.getDocDate(), q.get("fromDate"), q.get("toDate"))) continue;
                    Map<String, Object> r = docs.toRow(d);
                    r.put("docType", label(type));
                    rows.add(r);
                }
                yield rows;
            }
        };
    }

    /** True when an item's current quantity is at/below its reorder point
     * (OUT_OF_STOCK or PURCHASE_NOW). Items with no configured threshold are
     * never "low" — avoids flagging every never-received master item. */
    private boolean isLowStock(String status) {
        return "OUT_OF_STOCK".equals(status) || "PURCHASE_NOW".equals(status);
    }

    private boolean isLowStock(double onHand, ItemMaster it) {
        if (it == null) return false;
        if (reorderThreshold(it) <= 0) return false;
        return isLowStock(reorderStatus(onHand, it));
    }

    /** Period movement summary from the stock ledger using the curated
     * physical in/out txType sets (so internal QC/status moves and reversals
     * don't inflate the numbers). */
    private Map<String, Object> movementSummary(String from, String to, boolean received) {
        Map<String, double[]> byType = new LinkedHashMap<>(); // count, qty
        long count = 0;
        double qty = 0;
        for (StockLedger e : ledger.findAllByOrderByTxDateAsc()) {
            if (!inRange(e.getTxDate(), from, to)) continue;
            String tx = e.getTxType() == null ? "" : e.getTxType().toUpperCase();
            if (!(received ? STOCK_IN_TX_TYPES : STOCK_OUT_TX_TYPES).contains(tx)) continue;
            double v = received ? bd(e.getInQty()) : bd(e.getOutQty());
            count++;
            qty += v;
            double[] a = byType.computeIfAbsent(tx, x -> new double[2]);
            a[0] += 1;
            a[1] += v;
        }
        Map<String, Object> byTypeOut = new LinkedHashMap<>();
        byType.forEach((k, a) -> byTypeOut.put(k, slice2(a)));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("count", count);
        m.put("qty", round(qty));
        m.put("byType", byTypeOut);
        return m;
    }

    /** Item-wise stock rows: one row per item (aggregated across stores),
     * enriched with item master details and a per-store quantity breakdown. */
    private List<Map<String, Object>> itemStockRows(Map<String, String> q) {
        Map<String, double[]> totals = new LinkedHashMap<>(); // [onHand, reserved, qcHold, available]
        Map<String, Map<String, double[]>> perStore = new LinkedHashMap<>(); // item -> storeCode -> [onHand, available]
        for (StockService.Balance b : stock.balances().values()) {
            if (!isEmpty(q.get("location")) && !q.get("location").equals(b.loc())) continue;
            double[] t = totals.computeIfAbsent(b.item(), x -> new double[4]);
            t[0] += b.onHand();
            t[1] += b.reserved();
            t[2] += b.qcHold();
            t[3] += b.available();
            double[] s = perStore.computeIfAbsent(b.item(), x -> new LinkedHashMap<>())
                    .computeIfAbsent(b.loc(), x -> new double[2]);
            s[0] += b.onHand();
            s[1] += b.available();
        }
        Map<String, StoreMaster> storeByName = new LinkedHashMap<>();
        for (StoreMaster s : stores.findAll()) storeByName.put(s.getCode(), s);
        Map<String, LocalDate> lastMove = lastItemMovement();
        Map<String, Double> inwardRates = latestInwardItemRates();
        List<Map<String, Object>> rows = new ArrayList<>();
        for (ItemMaster it : items.findAll()) {
            double[] t = totals.getOrDefault(it.getCode(), new double[4]);
            double onHand = t[0];
            boolean low = isLowStock(onHand, it);
            boolean hasStock = onHand > 0 || t[1] > 0 || t[2] > 0;
            if (!hasStock && !low && !"true".equals(q.get("includeZero"))) continue;
            if ("true".equals(q.get("lowStockOnly")) && !low) continue;
            String st = reorderStatus(onHand, it);
            if (!isEmpty(q.get("status")) && !q.get("status").equalsIgnoreCase(st)) continue;
            if (!isEmpty(q.get("itemType")) && !q.get("itemType").equalsIgnoreCase(str(it.getItemType())))
                continue;
            if (!isEmpty(q.get("category")) && !q.get("category").equalsIgnoreCase(str(it.getCategory())))
                continue;
            if (!isEmpty(q.get("search"))) {
                String s = q.get("search").toLowerCase();
                if (!it.getCode().toLowerCase().contains(s)
                        && !str(it.getDescription()).toLowerCase().contains(s)
                        && !str(it.getSpecification()).toLowerCase().contains(s)) continue;
            }
            double rate = itemRate(it, inwardRates, it.getCode(), null);
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", it.getCode());
            r.put("itemCode", it.getCode());
            r.put("itemName", it.getDescription());
            r.put("specification", str(it.getSpecification()));
            r.put("itemType", str(it.getItemType()));
            r.put("itemGroup", groupName(it));
            r.put("category", str(it.getCategory()));
            r.put("uom", str(it.getUom()));
            r.put("totalOnHand", round(onHand));
            r.put("totalReserved", round(t[1]));
            r.put("totalQcHold", round(t[2]));
            r.put("totalAvailable", round(t[3]));
            r.put("totalValue", round(onHand * rate));
            r.put("safetyStock", round(it.getSafetyStock() == null ? 0 : it.getSafetyStock().doubleValue()));
            r.put("reorderPoint", round(reorderThreshold(it)));
            r.put("maxStockLevel", round(it.getMaxStockLevel() == null ? 0 : it.getMaxStockLevel().doubleValue()));
            r.put("reorderQty", it.getReorderQty() == null ? null : round(it.getReorderQty().doubleValue()));
            r.put("suggestedOrderQty", round(suggestedOrderQty(it)));
            r.put("avgDailyConsumption", round(it.getAvgDailyConsumption() == null ? 0 : it.getAvgDailyConsumption().doubleValue()));
            r.put("reorderStatus", st);
            r.put("lowStock", low);
            r.put("multiStore", perStore.getOrDefault(it.getCode(), Map.of()).size() > 1);
            r.put("lastMovementDate", lastMove.get(it.getCode()));
            List<Map<String, Object>> storeList = new ArrayList<>();
            for (Map.Entry<String, double[]> e : perStore.getOrDefault(it.getCode(), Map.of()).entrySet()) {
                Map<String, Object> sm = new LinkedHashMap<>();
                sm.put("storeCode", e.getKey());
                StoreMaster m = storeByName.get(e.getKey());
                sm.put("storeName", m == null ? e.getKey() : m.getName());
                sm.put("onHand", round(e.getValue()[0]));
                sm.put("available", round(e.getValue()[1]));
                storeList.add(sm);
            }
            r.put("perStore", storeList);
            rows.add(r);
        }
        return rows;
    }

    /** Store-wise stock rows: one row per store × item (summed across batches
     * and heats). Pass location=<storeCode> for a single store's breakdown. */
    private List<Map<String, Object>> storeStockRows(Map<String, String> q) {
        Map<String, String[]> keys = new LinkedHashMap<>(); // "loc|item" -> {loc, item}
        Map<String, double[]> agg = new LinkedHashMap<>(); // "loc|item" -> [onHand, reserved, qcHold, available]
        for (StockService.Balance b : stock.balances().values()) {
            if (!isEmpty(q.get("location")) && !q.get("location").equals(b.loc())) continue;
            String key = b.loc() + "|" + b.item();
            keys.put(key, new String[]{b.loc(), b.item()});
            double[] a = agg.computeIfAbsent(key, x -> new double[4]);
            a[0] += b.onHand();
            a[1] += b.reserved();
            a[2] += b.qcHold();
            a[3] += b.available();
        }
        Map<String, StoreMaster> storeByName = new LinkedHashMap<>();
        for (StoreMaster s : stores.findAll()) storeByName.put(s.getCode(), s);
        Map<String, LocalDate> lastMove = lastItemMovement();
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map.Entry<String, String[]> en : keys.entrySet()) {
            String loc = en.getValue()[0];
            String itemCode = en.getValue()[1];
            ItemMaster it = items.findByCode(itemCode).orElse(null);
            if (it == null) continue;
            if (!isEmpty(q.get("itemType")) && !q.get("itemType").equalsIgnoreCase(str(it.getItemType())))
                continue;
            if (!isEmpty(q.get("category")) && !q.get("category").equalsIgnoreCase(str(it.getCategory())))
                continue;
            if (!isEmpty(q.get("search"))) {
                String s = q.get("search").toLowerCase();
                if (!itemCode.toLowerCase().contains(s)
                        && !str(it.getDescription()).toLowerCase().contains(s)
                        && !str(it.getSpecification()).toLowerCase().contains(s)) continue;
            }
            double[] a = agg.get(en.getKey());
            double rate = it.getDefaultRate() == null ? 0 : it.getDefaultRate().doubleValue();
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", loc + "|" + itemCode);
            r.put("storeCode", loc);
            StoreMaster m = storeByName.get(loc);
            r.put("storeName", m == null ? loc : m.getName());
            r.put("itemCode", itemCode);
            r.put("itemName", it.getDescription());
            r.put("specification", str(it.getSpecification()));
            r.put("itemType", str(it.getItemType()));
            r.put("itemGroup", groupName(it));
            r.put("category", str(it.getCategory()));
            r.put("uom", str(it.getUom()));
            r.put("onHand", round(a[0]));
            r.put("reserved", round(a[1]));
            r.put("qcHold", round(a[2]));
            r.put("available", round(a[3]));
            r.put("value", round(a[0] * rate));
            r.put("lastMovementDate", lastMove.get(itemCode));
            rows.add(r);
        }
        return rows;
    }

    private List<Map<String, Object>> ledgerRows(Map<String, String> q) {
        List<Map<String, Object>> rows = new ArrayList<>();
        double run = 0;
        for (StockLedger e : ledger.findAllByOrderByTxDateAsc()) {
            if (!inRange(e.getTxDate(), q.get("fromDate"), q.get("toDate"))) continue;
            if (!isEmpty(q.get("itemCode")) && !q.get("itemCode").equals(e.getItemCode())) continue;
            if (!isEmpty(q.get("location")) && !q.get("location").equals(e.getLocation())) continue;
            if (!isEmpty(q.get("txType")) && !q.get("txType").equalsIgnoreCase(e.getTxType())) continue;
            double in = bd(e.getInQty());
            double out = bd(e.getOutQty());
            run += in - out;
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", e.getId());
            r.put("date", e.getTxDate() == null ? "" : e.getTxDate().toString());
            r.put("docNo", e.getDocNo());
            r.put("txType", e.getTxType());
            r.put("itemCode", e.getItemCode());
            r.put("itemName", items.findByCode(e.getItemCode())
                    .map(ItemMaster::getDescription).orElse(""));
            r.put("location", e.getLocation());
            r.put("batchNo", e.getBatchNo());
            r.put("inQty", round(in));
            r.put("outQty", round(out));
            r.put("runningBalance", round(run));
            rows.add(r);
        }
        return rows;
    }

    private Map<String, Double> latestInwardItemRates() {
        Map<String, Double> rates = new HashMap<>();
        String[] inwardKeys = {"po-inward", "lo-inward", "jo-inward", "general-inward", "inward", "grn"};
        List<DocEntity> allInwards = new ArrayList<>();
        for (String key : inwardKeys) {
            if (docs.isRegistered(key)) {
                allInwards.addAll(docs.findAll(key));
            }
        }
        allInwards.sort((d1, d2) -> {
            LocalDate date1 = d1.getDocDate();
            LocalDate date2 = d2.getDocDate();
            if (date1 != null || date2 != null) {
                if (date1 == null) return 1;
                if (date2 == null) return -1;
                int cmp = date2.compareTo(date1);
                if (cmp != 0) return cmp;
            }
            Long id1 = d1.getId();
            Long id2 = d2.getId();
            if (id1 != null || id2 != null) {
                if (id1 == null) return 1;
                if (id2 == null) return -1;
                return id2.compareTo(id1);
            }
            return 0;
        });

        for (DocEntity d : allInwards) {
            if (d.getLines() == null) continue;
            for (LineEntity l : d.getLines()) {
                String itemCode = l.getItemCode();
                if (itemCode == null || itemCode.isBlank()) continue;
                double rate = 0;
                double qty = (l.getQty() != null && l.getQty().doubleValue() > 0) ? l.getQty().doubleValue() : 0;
                if (l.getNetAmount() != null && l.getNetAmount().doubleValue() > 0 && qty > 0) {
                    rate = l.getNetAmount().doubleValue() / qty;
                } else if (l.getRate() != null && l.getRate().doubleValue() > 0) {
                    rate = l.getRate().doubleValue();
                } else if (l.getAmount() != null && l.getAmount().doubleValue() > 0 && qty > 0) {
                    rate = l.getAmount().doubleValue() / qty;
                }
                if (rate > 0) {
                    rates.putIfAbsent(itemCode, rate);
                    if (l.getBatchNo() != null && !l.getBatchNo().isBlank()) {
                        rates.putIfAbsent(itemCode + ":" + l.getBatchNo(), rate);
                    }
                }
            }
        }
        return rates;
    }

    private double itemRate(ItemMaster it, Map<String, Double> inwardRates, String itemCode, String batchNo) {
        if (inwardRates != null) {
            if (batchNo != null && !batchNo.isBlank()) {
                Double r = inwardRates.get(itemCode + ":" + batchNo);
                if (r != null && r > 0) return r;
            }
            if (itemCode != null && !itemCode.isBlank()) {
                Double r = inwardRates.get(itemCode);
                if (r != null && r > 0) return r;
            }
        }
        return (it != null && it.getDefaultRate() != null) ? it.getDefaultRate().doubleValue() : 0.0;
    }

    private List<Map<String, Object>> currentStockRows(Map<String, String> q) {
        List<Map<String, Object>> rows = new ArrayList<>();
        boolean includeZero = "true".equals(q.get("includeZero"));
        Set<String> seenItems = new LinkedHashSet<>();
        Map<String, StockService.Balance> allBalances = stock.balances();
        Map<String, Double> inwardRates = latestInwardItemRates();
        Map<String, LocalDate> lastMove = lastItemMovement();

        // One row per item code regardless of how many stores or batches/heats hold it —
        // on-hand, reserved, QC-hold and value are summed across every store location AND
        // every batch/heat instead of splitting the same item into one row per lot. Batch/
        // heat-level detail is still available via the Traceability Viewer and stock ledger;
        // this report is a per-item summary, so receiving or issuing stock for an item must
        // update this single aggregated row, never add another row for the same item code.
        Map<String, double[]> totals = new LinkedHashMap<>(); // [onHand, reserved, qcHold, available]
        Map<String, Set<String>> batchesByItem = new LinkedHashMap<>();
        Map<String, Set<String>> heatsByItem = new LinkedHashMap<>();
        for (StockService.Balance b : allBalances.values()) {
            if (b.onHand() <= 0 && b.reserved() <= 0) continue;
            if (!isEmpty(q.get("location")) && !q.get("location").equals(b.loc())) continue;
            if (!isEmpty(q.get("itemCode")) && !q.get("itemCode").equals(b.item())) continue;
            double[] a = totals.computeIfAbsent(b.item(), x -> new double[4]);
            a[0] += b.onHand();
            a[1] += b.reserved();
            a[2] += b.qcHold();
            a[3] += b.available();
            if (!str(b.batch()).isBlank()) batchesByItem.computeIfAbsent(b.item(), x -> new LinkedHashSet<>()).add(b.batch());
            if (!str(b.heat()).isBlank()) heatsByItem.computeIfAbsent(b.item(), x -> new LinkedHashSet<>()).add(b.heat());
        }

        long n = 0;
        for (Map.Entry<String, double[]> en : totals.entrySet()) {
            String itemCode = en.getKey();
            double[] a = en.getValue();
            double onHand = a[0], reserved = a[1], qcHold = a[2], available = a[3];
            ItemMaster it = items.findByCode(itemCode).orElse(null);
            boolean low = it != null && onHand < (it.getSafetyStock() == null ? 0 : it.getSafetyStock().doubleValue());
            if ("true".equals(q.get("lowStockOnly")) && !low) continue;
            double rate = itemRate(it, inwardRates, itemCode, null);
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", "s" + (++n));
            r.put("itemCode", itemCode);
            r.put("itemName", it == null ? "" : it.getDescription());
            r.put("specification", it == null ? "" : str(it.getSpecification()));
            r.put("category", it == null ? "" : it.getCategory());
            r.put("itemType", it == null ? "" : str(it.getItemType()));
            r.put("itemGroup", it == null ? "" : groupName(it));
            r.put("uom", it == null ? "" : it.getUom());
            r.put("batchNo", String.join(", ", batchesByItem.getOrDefault(itemCode, Set.of())));
            r.put("heatNo", String.join(", ", heatsByItem.getOrDefault(itemCode, Set.of())));
            r.put("onHand", round(onHand));
            r.put("reserved", round(reserved));
            r.put("qcHold", round(qcHold));
            r.put("available", round(available));
            r.put("rate", rate);
            r.put("value", round(onHand * rate));
            r.put("safetyStock", it == null ? 0 : round(it.getSafetyStock() == null ? 0 : it.getSafetyStock().doubleValue()));
            r.put("reorderPoint", it == null ? 0 : (it.getReorderPoint() == null ? 0 : round(it.getReorderPoint().doubleValue())));
            r.put("maxStockLevel", it == null ? 0 : round(it.getMaxStockLevel() == null ? 0 : it.getMaxStockLevel().doubleValue()));
            r.put("avgDailyConsumption", it == null ? 0 : round(it.getAvgDailyConsumption() == null ? 0 : it.getAvgDailyConsumption().doubleValue()));
            r.put("reorderQty", it == null || it.getReorderQty() == null ? null : round(it.getReorderQty().doubleValue()));
            r.put("suggestedOrderQty", it == null ? 0d : round(suggestedOrderQty(it)));
            r.put("reorderStatus", reorderStatus(onHand, it));
            r.put("lastMovementDate", lastMove.get(itemCode));
            r.put("lowStock", low);
            r.put("status", availabilityStatus(onHand, available, low));
            r.put("sourceTrace", sourceTrace(itemCode, null, null));
            rows.add(r);
            seenItems.add(itemCode);
        }
        if (includeZero) {
            Map<String, StockService.Balance> bal = stock.balances();
            Map<String, Double> onByItem = new HashMap<>();
            Map<String, Double> availByItem = new HashMap<>();
            for (StockService.Balance b : bal.values()) {
                onByItem.merge(b.item(), b.onHand(), Double::sum);
                availByItem.merge(b.item(), b.available(), Double::sum);
            }
            Set<String> withStock = new LinkedHashSet<>(onByItem.keySet());
            for (ItemMaster it : items.findAll()) {
                if (hasStockOnHand(it.getCode(), onByItem)) continue;
                if (withStock.contains(it.getCode())) continue;
                if (seenItems.contains(it.getCode())) continue;
                if (!isEmpty(q.get("location"))) continue;
                if ("true".equals(q.get("lowStockOnly"))) continue;
                double rate = itemRate(it, inwardRates, it.getCode(), null);
                double safety = it.getSafetyStock() == null ? 0 : it.getSafetyStock().doubleValue();
                boolean low = 0 < safety;
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("id", "z" + (++n));
                r.put("itemCode", it.getCode());
                r.put("itemName", it.getDescription());
                r.put("specification", str(it.getSpecification()));
                r.put("category", str(it.getCategory()));
                r.put("itemType", str(it.getItemType()));
                r.put("itemGroup", groupName(it));
                r.put("uom", str(it.getUom()));
                r.put("batchNo", "");
                r.put("heatNo", "");
                r.put("onHand", 0d);
                r.put("reserved", 0d);
                r.put("qcHold", 0d);
                r.put("available", 0d);
                r.put("rate", rate);
                r.put("value", 0d);
                r.put("safetyStock", round(safety));
                r.put("reorderPoint", it.getReorderPoint() == null ? 0 : round(it.getReorderPoint().doubleValue()));
                r.put("maxStockLevel", round(it.getMaxStockLevel() == null ? 0 : it.getMaxStockLevel().doubleValue()));
                r.put("avgDailyConsumption", round(it.getAvgDailyConsumption() == null ? 0 : it.getAvgDailyConsumption().doubleValue()));
                r.put("reorderQty", it.getReorderQty() == null ? null : round(it.getReorderQty().doubleValue()));
                r.put("suggestedOrderQty", round(suggestedOrderQty(it)));
                r.put("reorderStatus", reorderStatus(0d, it));
                r.put("lastMovementDate", lastMove.get(it.getCode()));
                r.put("lowStock", low);
                r.put("status", "NOT_AVAILABLE");
                r.put("sourceTrace", "");
                rows.add(r);
            }
        }
        return rows;
    }

    /** DOCUMENT 02 v2.0 §02.2 — one row per active store, aggregated from stock.balances(). */
    private List<Map<String, Object>> storeStockSummaryRows() {
        Map<String, double[]> byLoc = new LinkedHashMap<>(); // [onHand, reserved, qcHold, value]
        Map<String, Set<String>> itemsByLoc = new LinkedHashMap<>();
        Map<String, Double> inwardRates = latestInwardItemRates();
        for (StockService.Balance b : stock.balances().values()) {
            double[] a = byLoc.computeIfAbsent(b.loc(), x -> new double[4]);
            a[0] += b.onHand();
            a[1] += b.reserved();
            a[2] += b.qcHold();
            ItemMaster it = items.findByCode(b.item()).orElse(null);
            double rate = itemRate(it, inwardRates, b.item(), b.batch());
            a[3] += b.onHand() * rate;
            if (b.onHand() > 0 || b.reserved() > 0 || b.qcHold() > 0) {
                itemsByLoc.computeIfAbsent(b.loc(), x -> new LinkedHashSet<>()).add(b.item());
            }
        }
        List<Map<String, Object>> rows = new ArrayList<>();
        for (StoreMaster s : stores.findByActiveTrue()) {
            double[] a = byLoc.getOrDefault(s.getCode(), new double[4]);
            double onHand = a[0], reserved = a[1], qcHold = a[2], value = a[3];
            double available = onHand - reserved - qcHold;
            LocalDate lastTx = ledger.maxTxDateByLocation(s.getCode());
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", s.getCode());
            r.put("storeCode", s.getCode());
            r.put("storeName", s.getName());
            r.put("storeType", s.getStoreType());
            r.put("itemCount", itemsByLoc.getOrDefault(s.getCode(), Set.of()).size());
            r.put("totalOnHand", round(onHand));
            r.put("totalReserved", round(reserved));
            r.put("totalQcHold", round(qcHold));
            r.put("totalAvailable", round(available));
            r.put("totalValue", round(value));
            r.put("lastTransactionDate", lastTx == null ? "" : lastTx.toString());
            r.put("emptyStore", onHand <= 0);
            r.put("dormant", lastTx == null || lastTx.isBefore(LocalDate.now().minusDays(90)));
            rows.add(r);
        }
        return rows;
    }

    private boolean hasStockOnHand(String item, Map<String, Double> onByItem) {
        Double v = onByItem.get(item);
        return v != null && v > 0;
    }

    private String availabilityStatus(double onHand, double available, boolean low) {
        if (available <= 0 && onHand <= 0) return "NOT_AVAILABLE";
        if (low) return "LOW";
        return "AVAILABLE";
    }

    /** Reorder threshold for an item: reorderPoint when configured, else the
     * safety stock. Consistent with the Low-Stock alert spec (reorderPoint ??
     * safetyStock ?? 0). */
    private double reorderThreshold(ItemMaster it) {
        if (it == null) return 0;
        if (it.getReorderPoint() != null) return it.getReorderPoint().doubleValue();
        return it.getSafetyStock() == null ? 0 : it.getSafetyStock().doubleValue();
    }

    /** Suggested replenishment qty: the configured reorderQty when present, else
     * the "fill to max" heuristic (maxStockLevel − reorder threshold). */
    private double suggestedOrderQty(ItemMaster it) {
        if (it == null) return 0;
        if (it.getReorderQty() != null) return it.getReorderQty().doubleValue();
        double max = it.getMaxStockLevel() == null ? 0 : it.getMaxStockLevel().doubleValue();
        return Math.max(0, max - reorderThreshold(it));
    }

    /** Traffic-light reorder band for a qty: 🔴 out of stock / below the reorder
     * point, 🟡 within a 20% buffer above it, 🟢 otherwise. */
    private String reorderStatus(double onHand, ItemMaster it) {
        if (it == null) return "OK";
        if (onHand <= 0) return "OUT_OF_STOCK";
        double t = reorderThreshold(it);
        if (onHand < t) return "PURCHASE_NOW";
        if (onHand <= t * 1.2) return "REORDER_SOON";
        return "OK";
    }

    /** Item → most recent stock-ledger movement date (for stock aging in the
     * current-stock detail rows). */
    private Map<String, LocalDate> lastItemMovement() {
        Map<String, LocalDate> m = new HashMap<>();
        for (StockLedger e : ledger.findAllByOrderByTxDateAsc()) {
            if (e.getTxDate() != null) m.put(e.getItemCode(), e.getTxDate());
        }
        return m;
    }

    private List<Map<String, Object>> lowStockRows() {
        Map<String, Double> onHand = new LinkedHashMap<>();
        for (StockService.Balance b : stock.balances().values())
            onHand.merge(b.item(), b.onHand(), Double::sum);
        List<Map<String, Object>> out = new ArrayList<>();
        for (ItemMaster it : items.findAll()) {
            double qty = onHand.getOrDefault(it.getCode(), 0d);
            double safety = it.getSafetyStock() == null ? 0 : it.getSafetyStock().doubleValue();
            if (qty >= safety) continue;
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", it.getCode());
            r.put("itemCode", it.getCode());
            r.put("itemName", it.getDescription());
            r.put("location", "");
            r.put("onHand", round(qty));
            r.put("safetyQty", safety);
            r.put("shortage", round(safety - qty));
            out.add(r);
        }
        return out;
    }

    private List<Map<String, Object>> reservationRows() {
        List<Map<String, Object>> out = new ArrayList<>();
        Map<String, Double> releasedByAllotment = new HashMap<>();
        for (DocEntity x : docs.findAll("stock-release")) {
            if (!"POSTED".equals(x.getStatus())) continue;
            String allotmentNo = x instanceof StockRelease sr ? sr.getAllotmentNo() : null;
            if (allotmentNo == null || allotmentNo.isBlank()) continue;
            double relQty = x.getLines() != null
                    ? x.getLines().stream().mapToDouble(l -> l.getQty() != null ? l.getQty().doubleValue() : 0).sum()
                    : 0;
            releasedByAllotment.merge(allotmentNo, relQty, Double::sum);
        }

        for (DocEntity a : docs.findAll("stock-allotment")) {
            if (!Set.of("APPROVED", "POSTED").contains(a.getStatus())) continue;
            Map<String, Object> r = docs.toRow(a);
            double totalAllotted = ((Number) r.getOrDefault("qty", 0)).doubleValue();
            double alreadyReleased = releasedByAllotment.getOrDefault(a.getDocNo(), 0.0);
            double netReserved = Math.max(0, totalAllotted - alreadyReleased);
            if (netReserved <= 0) continue;
            r.put("reservedQty", round(netReserved));
            r.put("docType", "STOCK_ALLOTMENT");
            out.add(r);
        }
        return out;
    }

    private List<Map<String, Object>> pendingRows(boolean approvalsOnly, Map<String, String> q) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (String key : docs.keys()) {
            DocTypes.Effect eff = DocTypes.get(key).effect();
            if (approvalsOnly) {
                if (eff == DocTypes.Effect.NONE) continue;
            } else {
                if (eff != DocTypes.Effect.IN) continue;
            }
            for (DocEntity d : docs.findAll(key)) {
                boolean ok = approvalsOnly ? "SUBMITTED".equals(d.getStatus())
                        : List.of("DRAFT", "SUBMITTED", "APPROVED").contains(d.getStatus());
                if (!ok) continue;
                if (!inRange(d.getDocDate(), q.get("fromDate"), q.get("toDate"))) continue;
                Map<String, Object> r = docs.toRow(d);
                r.put("docType", label(key));
                out.add(r);
            }
        }
        return out;
    }

    private String label(String key) {
        return key.replace('-', '_').toUpperCase();
    }

    private Map<String, Object> kpis() {
        Map<String, Object> k = new LinkedHashMap<>();
        Map<String, StockService.Balance> bal = stock.balances();
        double onHand = 0, reserved = 0, available = 0;
        Set<String> skuCodes = new LinkedHashSet<>();
        for (StockService.Balance b : bal.values()) {
            onHand += b.onHand();
            reserved += b.reserved();
            available += b.available();
            if (b.onHand() > 0) skuCodes.add(b.item());
        }
        // Subset of the existing low-stock list (items with a configured safety
        // stock that are now below it) that has actually hit zero — keeps this
        // consistent with what the Low Stock Alert panel shows, rather than a
        // separately-derived number that could disagree with it.
        long outOfStock = lowStockItems().stream()
                .filter(r -> ((Number) r.get("onHandQty")).doubleValue() <= 0)
                .count();
        k.put("totalOnHand", round(onHand));
        k.put("skuCount", skuCodes.size());
        k.put("stockValue", round(valueOf(bal)));
        k.put("reserved", round(reserved));
        k.put("available", round(available));
        k.put("lowStockCount", lowStockItems().size());
        k.put("outOfStockCount", outOfStock);
        k.put("pendingInward", docs.count("po-inward"));
        k.put("pendingApprovals", docs.countAll());
        k.put("ledgerEntries", ledger.count());
        // % of tracked SKUs that are NOT currently below their reorder point —
        // was hardcoded to 100 before; now a real "stock health" reading.
        int tracked = skuCodes.size();
        long belowReorder = lowStockItems().size();
        k.put("accuracyPct", tracked == 0 ? 100 : round(100.0 * (tracked - belowReorder) / tracked));
        k.put("activeStoreCount", stores.findByActiveTrue().size());
        return k;
    }

    private List<Map<String, Object>> monthlyStatus() {
        Map<String, double[]> acc = new TreeMap<>();
        double run = 0;
        for (StockLedger e : ledger.findAllByOrderByTxDateAsc()) {
            String m = String.valueOf(e.getTxDate()).substring(0, 7);
            double[] a = acc.computeIfAbsent(m, x -> new double[3]);
            a[0] += bd(e.getInQty());
            a[1] += bd(e.getOutQty());
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<String, double[]> en : acc.entrySet()) {
            run += en.getValue()[0] - en.getValue()[1];
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("month", en.getKey());
            r.put("received", round(en.getValue()[0]));
            r.put("issued", round(en.getValue()[1]));
            r.put("onHand", round(run));
            out.add(r);
        }
        return out;
    }

    private List<Map<String, Object>> categoryDistribution() {
        Map<String, Double> acc = new LinkedHashMap<>();
        Map<String, Double> inwardRates = latestInwardItemRates();
        for (StockService.Balance b : stock.balances().values()) {
            if (b.onHand() <= 0) continue;
            ItemMaster it = items.findByCode(b.item()).orElse(null);
            double rate = itemRate(it, inwardRates, b.item(), b.batch());
            String cat = it == null || it.getCategory() == null || it.getCategory().isEmpty()
                    ? "Uncategorized" : it.getCategory();
            acc.merge(cat, b.onHand() * rate, Double::sum);
        }
        List<Map<String, Object>> out = new ArrayList<>();
        acc.forEach((k, v) -> {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("category", k);
            r.put("value", round(v));
            out.add(r);
        });
        return out;
    }

    private List<Map<String, Object>> locationDistribution() {
        Map<String, Double> acc = new LinkedHashMap<>();
        for (StockService.Balance b : stock.balances().values())
            acc.merge(b.loc().isEmpty() ? "Unassigned" : b.loc(), b.onHand(), Double::sum);
        List<Map<String, Object>> out = new ArrayList<>();
        acc.forEach((k, v) -> {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("location", k);
            r.put("onHand", round(v));
            out.add(r);
        });
        return out;
    }

    private List<Map<String, Object>> trend() {
        Map<String, double[]> acc = new TreeMap<>();
        for (StockLedger e : ledger.findAllByOrderByTxDateAsc()) {
            String d = String.valueOf(e.getTxDate());
            double[] a = acc.computeIfAbsent(d, x -> new double[2]);
            a[0] += bd(e.getInQty());
            a[1] += bd(e.getOutQty());
        }
        List<Map<String, Object>> out = new ArrayList<>();
        acc.forEach((k, v) -> {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("date", k);
            r.put("inward", round(v[0]));
            r.put("issued", round(v[1]));
            out.add(r);
        });
        return out;
    }

    private List<Map<String, Object>> topItems() {
        Map<String, Double> inwardRates = latestInwardItemRates();
        Map<String, Double> itemValues = new LinkedHashMap<>();
        Map<String, String> itemNames = new HashMap<>();
        for (StockService.Balance b : stock.balances().values()) {
            if (b.onHand() <= 0) continue;
            ItemMaster it = items.findByCode(b.item()).orElse(null);
            double rate = itemRate(it, inwardRates, b.item(), b.batch());
            itemValues.merge(b.item(), b.onHand() * rate, Double::sum);
            if (it != null && !itemNames.containsKey(b.item())) {
                itemNames.put(b.item(), it.getDescription());
            }
        }
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map.Entry<String, Double> e : itemValues.entrySet()) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("itemCode", e.getKey());
            r.put("itemName", itemNames.getOrDefault(e.getKey(), ""));
            r.put("value", round(e.getValue()));
            rows.add(r);
        }
        rows.sort((a, b) -> Double.compare((double) b.get("value"), (double) a.get("value")));
        return rows.stream().limit(5).collect(Collectors.toList());
    }

    /** Bottom-ranked items by average daily consumption — the "dead stock" side
     * of Top 10 Fast/Slow Movers. Only among items that actually carry stock,
     * so an unused catalog entry doesn't drown out real slow movers. Value
     * shown is stock value (same field TopItemsBarChart already renders), so
     * the frontend can reuse that component unchanged. */
    private List<Map<String, Object>> slowMovers() {
        Map<String, Double> inwardRates = latestInwardItemRates();
        Map<String, Double> itemValues = new LinkedHashMap<>();
        for (StockService.Balance b : stock.balances().values()) {
            if (b.onHand() <= 0) continue;
            ItemMaster it = items.findByCode(b.item()).orElse(null);
            double rate = itemRate(it, inwardRates, b.item(), b.batch());
            itemValues.merge(b.item(), b.onHand() * rate, Double::sum);
        }
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map.Entry<String, Double> e : itemValues.entrySet()) {
            ItemMaster it = items.findByCode(e.getKey()).orElse(null);
            if (it == null) continue;
            double avgDaily = it.getAvgDailyConsumption() == null ? 0 : it.getAvgDailyConsumption().doubleValue();
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("itemCode", e.getKey());
            r.put("itemName", it.getDescription());
            r.put("avgDailyConsumption", round(avgDaily));
            r.put("value", round(e.getValue()));
            rows.add(r);
        }
        rows.sort(Comparator.comparingDouble(r -> ((Number) r.get("avgDailyConsumption")).doubleValue()));
        return rows.stream().limit(5).collect(Collectors.toList());
    }

    /** Classic ABC analysis (Pareto): items ranked by stock value descending,
     * bucketed by cumulative share of total value — A = items making up the
     * first 70% of value, B = next 20% (up to 90%), C = the remaining 10%.
     * Computed live off current stock value rather than a persisted nightly
     * job, so it's always in sync with what's actually on the shelves right
     * now (ItemMaster.abcClass stays available for a future persisted variant,
     * this doesn't write to it). */
    private List<Map<String, Object>> abcAnalysis() {
        Map<String, Double> inwardRates = latestInwardItemRates();
        Map<String, Double> itemValues = new LinkedHashMap<>();
        for (StockService.Balance b : stock.balances().values()) {
            if (b.onHand() <= 0) continue;
            ItemMaster it = items.findByCode(b.item()).orElse(null);
            double rate = itemRate(it, inwardRates, b.item(), b.batch());
            itemValues.merge(b.item(), b.onHand() * rate, Double::sum);
        }

        List<double[]> values = new ArrayList<>(); // [itemValue] per item, sorted desc later
        double totalValue = 0;
        for (Double v : itemValues.values()) {
            if (v <= 0) continue;
            values.add(new double[]{v});
            totalValue += v;
        }
        values.sort((a, b) -> Double.compare(b[0], a[0]));

        int[] tierCount = new int[3]; // A, B, C
        double[] tierValue = new double[3];
        double running = 0;
        for (double[] v : values) {
            running += v[0];
            double cumPct = totalValue == 0 ? 0 : running / totalValue;
            int tier = cumPct <= 0.70 ? 0 : cumPct <= 0.90 ? 1 : 2;
            tierCount[tier]++;
            tierValue[tier] += v[0];
        }

        String[] labels = {"A", "B", "C"};
        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("tier", labels[i]);
            r.put("itemCount", tierCount[i]);
            r.put("value", round(tierValue[i]));
            r.put("valuePct", totalValue == 0 ? 0 : round(100.0 * tierValue[i] / totalValue));
            out.add(r);
        }
        return out;
    }

    /** Stock aging: how long has current on-hand stock sat since its item's
     * last ledger movement — bucketed 0-30 / 31-60 / 60+ days. "Last movement"
     * is derived from the existing stock_ledger (no new column needed); an
     * item with no ledger history at all is treated as 60+ (oldest bucket) so
     * silently-imported opening stock doesn't hide as "fresh". */
    private List<Map<String, Object>> stockAging() {
        Map<String, LocalDate> lastMovement = new HashMap<>();
        for (StockLedger e : ledger.findAllByOrderByTxDateAsc()) {
            if (e.getTxDate() != null) lastMovement.put(e.getItemCode(), e.getTxDate());
        }

        Map<String, Double> inwardRates = latestInwardItemRates();
        LocalDate today = LocalDate.now();
        String[] buckets = {"0-30 days", "31-60 days", "60+ days"};
        long[] counts = new long[3];
        double[] qtys = new double[3];
        double[] valuesArr = new double[3];

        for (StockService.Balance b : stock.balances().values()) {
            if (b.onHand() <= 0) continue;
            LocalDate last = lastMovement.get(b.item());
            long days = last == null ? Long.MAX_VALUE : java.time.temporal.ChronoUnit.DAYS.between(last, today);
            int bucket = days <= 30 ? 0 : days <= 60 ? 1 : 2;
            ItemMaster it = items.findByCode(b.item()).orElse(null);
            double rate = itemRate(it, inwardRates, b.item(), b.batch());
            counts[bucket]++;
            qtys[bucket] += b.onHand();
            valuesArr[bucket] += b.onHand() * rate;
        }

        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("bucket", buckets[i]);
            r.put("itemCount", counts[i]);
            r.put("qty", round(qtys[i]));
            r.put("value", round(valuesArr[i]));
            out.add(r);
        }
        return out;
    }

    private double valueOf(Map<String, StockService.Balance> bal) {
        Map<String, Double> inwardRates = latestInwardItemRates();
        double v = 0;
        for (StockService.Balance b : bal.values()) {
            if (b.onHand() <= 0) continue;
            ItemMaster it = items.findByCode(b.item()).orElse(null);
            double rate = itemRate(it, inwardRates, b.item(), b.batch());
            v += b.onHand() * rate;
        }
        return v;
    }

    private double bd(BigDecimal v) { return v == null ? 0 : v.doubleValue(); }

    private Map<String, Object> slice(double[] a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("count", (long) a[0]);
        m.put("qty", round(a[1]));
        m.put("amount", round(a[2]));
        return m;
    }

    private Map<String, Object> slice2(double[] a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("count", (long) a[0]);
        m.put("qty", round(a[1]));
        return m;
    }

    private boolean outOfRange(DocEntity d, String from, String to) {
        LocalDate dd = d.getDocDate();
        if (dd == null) return true;
        if (!isEmpty(from) && dd.isBefore(LocalDate.parse(from))) return true;
        if (!isEmpty(to) && dd.isAfter(LocalDate.parse(to))) return true;
        return false;
    }

    private boolean inRange(LocalDate d, String from, String to) {
        if (d == null) return false;
        if (!isEmpty(from) && d.isBefore(LocalDate.parse(from))) return false;
        if (!isEmpty(to) && d.isAfter(LocalDate.parse(to))) return false;
        return true;
    }

    /**
     * FRS gap fix: reads Stock Qty -> QC Ref -> Inward Ref backward so a balance row can be
     * traced to its origin without a manual join. Walks the ledger for the earliest inbound
     * movement of this item+batch+heat; if that movement came from a QC release/pass, follows
     * the QualityInspection's own sourceNumber back to the originating Inward Entry.
     */
    private String sourceTrace(String itemCode, String batchNo, String heatNo) {
        StockLedger origin = null;
        for (StockLedger e : ledger.findAllByOrderByTxDateAsc()) {
            if (!itemCode.equals(e.getItemCode())) continue;
            if (batchNo != null && !str(batchNo).equals(str(e.getBatchNo()))) continue;
            if (heatNo != null && !str(heatNo).equals(str(e.getHeatNo()))) continue;
            if (e.getInQty() == null || e.getInQty().compareTo(BigDecimal.ZERO) <= 0) continue;
            boolean isInward = Arrays.asList(INWARD_KEYS).contains(e.getDocType());
            boolean isQcRelease = QualityInspectionService.KEY.equals(e.getDocType());
            if (isInward || isQcRelease) { origin = e; break; }
        }
        if (origin == null) return "";
        if (QualityInspectionService.KEY.equals(origin.getDocType())) {
            String inwardNo = em.createQuery(
                            "select q.sourceNumber from QualityInspection q where q.docNo = :docNo", String.class)
                    .setParameter("docNo", origin.getDocNo())
                    .getResultStream().findFirst().orElse(null);
            return (inwardNo != null && !inwardNo.isBlank())
                    ? inwardNo + " → QC " + origin.getDocNo()
                    : "QC " + origin.getDocNo();
        }
        return "Inward " + origin.getDocNo();
    }

    private boolean isEmpty(String s) { return s == null || s.isEmpty(); }

    private static String str(String s) { return s == null ? "" : s; }

    private double round(double v) { return Math.round(v * 100.0) / 100.0; }

    private ResponseEntity<byte[]> file(byte[] bytes, String format, String title) {
        MediaType media = "pdf".equalsIgnoreCase(format)
                ? MediaType.APPLICATION_PDF
                : MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        String ext = "pdf".equalsIgnoreCase(format) ? "pdf" : "xlsx";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + title.replace("/", "_") + "." + ext + "\"")
                .contentType(media)
                .body(bytes);
    }
}
