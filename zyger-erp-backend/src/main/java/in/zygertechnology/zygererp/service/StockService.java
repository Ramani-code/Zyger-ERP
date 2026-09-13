package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.DocEntity;
import in.zygertechnology.zygererp.entity.LineEntity;
import in.zygertechnology.zygererp.entity.StockBalance;
import in.zygertechnology.zygererp.entity.StockLedger;
import in.zygertechnology.zygererp.repo.LedgerRepository;
import in.zygertechnology.zygererp.repo.StockBalanceRepository;
import in.zygertechnology.zygererp.security.CurrentUserRoles;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

@Service
@Transactional
public class StockService {

    private static final Logger log = LoggerFactory.getLogger(StockService.class);
    private final LedgerRepository ledger;
    private final StockBalanceRepository balances;
    private final DocumentFacade docs;

    public StockService(LedgerRepository ledger, StockBalanceRepository balances, DocumentFacade docs) {
        this.ledger = ledger;
        this.balances = balances;
        this.docs = docs;
    }

    public record Balance(String item, String loc, String batch, String heat,
                          double onHand, double reserved, double qcHold) {
        public double available() { return onHand - reserved - qcHold; }
    }

    public static String key(String i, String l, String b, String h) {
        return String.join("|", str(i), str(l), str(b), str(h));
    }

    public static double bd(BigDecimal v) { return v == null ? 0 : v.doubleValue(); }

    public static String str(Object o) { return o == null ? "" : String.valueOf(o); }

    public Map<String, Balance> balances() {
        List<StockBalance> rows = balances.findAll();
        Map<String, double[]> free = new LinkedHashMap<>();
        Map<String, double[]> qcHold = new LinkedHashMap<>();
        Map<String, String[]> meta = new LinkedHashMap<>();

        for (StockBalance sb : rows) {
            String k = key(sb.getItemCode(), sb.getLocation(), sb.getBatchNo(), sb.getHeatNo());
            meta.put(k, new String[]{sb.getItemCode(), sb.getLocation(), sb.getBatchNo(), sb.getHeatNo()});

            if ("QC_HOLD".equals(sb.getStockStatus())) {
                qcHold.computeIfAbsent(k, x -> new double[1])[0] += bd(sb.getQty());
            } else if ("FREE".equals(sb.getStockStatus())) {
                free.computeIfAbsent(k, x -> new double[1])[0] += bd(sb.getQty());
            }
            // BLOCKED stock is not counted in onHand or available
        }

        Map<String, Balance> m = new LinkedHashMap<>();
        Set<String> allKeys = new LinkedHashSet<>();
        allKeys.addAll(free.keySet());
        allKeys.addAll(qcHold.keySet());

        for (String k : allKeys) {
            String[] s = meta.get(k);
            double freeQty = free.containsKey(k) ? free.get(k)[0] : 0;
            double holdQty = qcHold.containsKey(k) ? qcHold.get(k)[0] : 0;
            double totalPhysical = freeQty + holdQty;
            m.put(k, new Balance(s[0], s[1], s[2], s[3], totalPhysical, 0, holdQty));
        }

        reservations().forEach((k, q) -> {
            Balance b = m.get(k);
            if (b != null) {
                m.put(k, new Balance(b.item(), b.loc(), b.batch(), b.heat(), b.onHand(), q, b.qcHold()));
            } else {
                String[] s = k.split("\\|", -1);
                m.put(k, new Balance(s[0], s[1], s[2], s[3], 0, q, 0));
            }
        });
        return m;
    }

    private Map<String, Double> reservations() {
        Map<String, Double> r = new LinkedHashMap<>();
        for (DocEntity a : docs.findAll("stock-allotment")) {
            if (!Set.of("APPROVED", "POSTED").contains(a.getStatus())) continue;
            for (LineEntity l : a.getLines()) {
                String loc = (l.getLocation() != null && !l.getLocation().isBlank()) ? l.getLocation() : "MAIN";
                r.merge(key(l.getItemCode(), loc, l.getBatchNo(), l.getHeatNo()),
                        bd(l.getQty()), Double::sum);
            }
        }
        for (DocEntity x : docs.findAll("stock-release")) {
            if (!"POSTED".equals(x.getStatus())) continue;
            // A release line often carries no location of its own (it releases
            // whatever the referenced Allotment reserved), so resolve the location
            // from that allotment instead of draining whichever same-item reservation
            // happens to be first in map order — otherwise a release at one store can
            // wrongly cancel out another store's reservation of the same item.
            Map<String, String> locByItem = new HashMap<>();
            if (x instanceof in.zygertechnology.zygererp.entity.StockRelease sr
                    && sr.getAllotmentNo() != null && !sr.getAllotmentNo().isBlank()) {
                try {
                    DocEntity allotmentDoc = docs.getByNumber("stock-allotment", sr.getAllotmentNo());
                    for (LineEntity aLine : allotmentDoc.getLines()) {
                        if (aLine.getLocation() != null && !aLine.getLocation().isBlank()) {
                            locByItem.putIfAbsent(str(aLine.getItemCode()), aLine.getLocation());
                        }
                    }
                } catch (Exception ignored) {}
            }
            for (LineEntity l : x.getLines()) {
                double left = bd(l.getQty());
                String item = str(l.getItemCode()), batch = str(l.getBatchNo());
                String resolvedLoc = (l.getLocation() != null && !l.getLocation().isBlank())
                        ? l.getLocation() : locByItem.get(item);
                for (Map.Entry<String, Double> e : r.entrySet()) {
                    if (left <= 0) break;
                    String[] p = e.getKey().split("\\|", -1);
                    if (p[0].equals(item) && (batch.isEmpty() || p[2].equals(batch))
                            && (resolvedLoc == null || p[1].equals(resolvedLoc))) {
                        double take = Math.min(e.getValue(), left);
                        e.setValue(e.getValue() - take);
                        left -= take;
                    }
                }
            }
        }
        r.values().removeIf(v -> v <= 0);
        return r;
    }

    public double available(String item, String loc) {
        return balances().values().stream()
                .filter(b -> b.item().equals(item)
                        && (loc == null || loc.isEmpty() || b.loc().equals(loc)))
                .mapToDouble(Balance::available).sum();
    }

    public double onHand(String item, String loc, String batch) {
        return balances().values().stream()
                .filter(b -> b.item().equals(item)
                        && (loc == null || loc.isEmpty() || b.loc().equals(loc))
                        && (batch == null || batch.isEmpty() || str(b.batch()).equals(batch)))
                .mapToDouble(Balance::onHand).sum();
    }

    public double qcHold(String item, String loc) {
        return balances().values().stream()
                .filter(b -> b.item().equals(item)
                        && (loc == null || loc.isEmpty() || b.loc().equals(loc)))
                .mapToDouble(Balance::qcHold).sum();
    }

    public void recordStockIn(String docNo, String docType, String txType, String itemCode,
                              String location, String batchNo, String heatNo,
                              BigDecimal inQty, LocalDate txDate, String user,
                              String stockStatus) {
        if (inQty == null || inQty.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("Stock receipt quantity must be greater than zero. Received: " + inQty);
        }
        if (stockStatus == null || stockStatus.isBlank()) stockStatus = "FREE";
        String loc = (location != null && !location.isBlank()) ? location : "MAIN";
        String batch = batchNo != null ? batchNo : "";
        String heat = heatNo != null ? heatNo : "";
        BigDecimal qty = inQty;

        if (ledger.existsByDocNoAndDocTypeAndTxType(docNo, docType, txType)) {
            log.warn("Duplicate stock-in blocked: docNo={}, docType={}, txType={}", docNo, docType, txType);
            return;
        }

        StockLedger entry = StockLedger.builder()
                .docNo(docNo).docType(docType).txType(txType)
                .itemCode(itemCode).location(loc).batchNo(batch).heatNo(heat)
                .stockStatus(stockStatus)
                .inQty(qty).outQty(BigDecimal.ZERO)
                .txDate(txDate != null ? txDate : LocalDate.now())
                .createdBy(user).createdAt(Instant.now())
                .build();
        ledger.save(entry);
        updateBalance(itemCode, loc, batch, heat, stockStatus, qty, BigDecimal.ZERO);
    }

    public void recordStockOut(String docNo, String docType, String txType, String itemCode,
                               String location, String batchNo, String heatNo,
                               BigDecimal outQty, LocalDate txDate, String user) {
        recordStockOut(docNo, docType, txType, itemCode, location, batchNo, heatNo,
                outQty, txDate, user, false);
    }

    public void recordStockOut(String docNo, String docType, String txType, String itemCode,
                               String location, String batchNo, String heatNo,
                               BigDecimal outQty, LocalDate txDate, String user,
                               boolean allowNegativeOverride) {
        String loc = (location != null && !location.isBlank()) ? location : "MAIN";
        String batch = batchNo != null ? batchNo : "";
        String heat = heatNo != null ? heatNo : "";
        BigDecimal qty = outQty != null ? outQty : BigDecimal.ZERO;
        if (qty.compareTo(BigDecimal.ZERO) <= 0) return;

        if (ledger.existsByDocNoAndDocTypeAndTxType(docNo, docType, txType)) {
            log.warn("Duplicate stock-out blocked: docNo={}, docType={}, txType={}", docNo, docType, txType);
            return;
        }

        if ("stock-release".equals(docType)) {
            verifyPhysicalStockAvailability(itemCode, loc, qty, allowNegativeOverride);
        } else {
            verifyStockAvailability(itemCode, loc, qty, allowNegativeOverride);
        }

        StockLedger entry = StockLedger.builder()
                .docNo(docNo).docType(docType).txType(txType)
                .itemCode(itemCode).location(loc).batchNo(batch).heatNo(heat)
                .stockStatus("FREE")
                .inQty(BigDecimal.ZERO).outQty(qty)
                .txDate(txDate != null ? txDate : LocalDate.now())
                .createdBy(user).createdAt(Instant.now())
                .build();
        ledger.save(entry);
        updateBalance(itemCode, loc, batch, heat, "FREE", BigDecimal.ZERO, qty);
    }

    public void recordStockAdjustment(String docNo, String docType, String txType, String itemCode,
                                      String location, String batchNo, String heatNo,
                                      BigDecimal deltaQty, LocalDate txDate, String user) {
        recordStockAdjustment(docNo, docType, txType, itemCode, location, batchNo, heatNo,
                deltaQty, txDate, user, false);
    }

    public void recordStockAdjustment(String docNo, String docType, String txType, String itemCode,
                                      String location, String batchNo, String heatNo,
                                      BigDecimal deltaQty, LocalDate txDate, String user,
                                      boolean allowNegativeOverride) {
        String loc = (location != null && !location.isBlank()) ? location : "MAIN";
        String batch = batchNo != null ? batchNo : "";
        String heat = heatNo != null ? heatNo : "";
        if (deltaQty.compareTo(BigDecimal.ZERO) == 0) return;

        if (deltaQty.compareTo(BigDecimal.ZERO) < 0) {
            verifyStockAvailability(itemCode, loc, deltaQty.negate(), allowNegativeOverride);
        }

        StockLedger entry = StockLedger.builder()
                .docNo(docNo).docType(docType).txType(txType)
                .itemCode(itemCode).location(loc).batchNo(batch).heatNo(heat)
                .stockStatus("FREE")
                .inQty(deltaQty.compareTo(BigDecimal.ZERO) > 0 ? deltaQty : BigDecimal.ZERO)
                .outQty(deltaQty.compareTo(BigDecimal.ZERO) < 0 ? deltaQty.negate() : BigDecimal.ZERO)
                .txDate(txDate != null ? txDate : LocalDate.now())
                .createdBy(user).createdAt(Instant.now())
                .build();
        ledger.save(entry);
        if (deltaQty.compareTo(BigDecimal.ZERO) > 0) {
            updateBalance(itemCode, loc, batch, heat, "FREE", deltaQty, BigDecimal.ZERO);
        } else {
            updateBalance(itemCode, loc, batch, heat, "FREE", BigDecimal.ZERO, deltaQty.negate());
        }
    }

    @Transactional
    public void releaseQcHold(String docNo, String docType, String txType, String itemCode,
                              String location, String batchNo, String heatNo,
                              BigDecimal qty, LocalDate txDate, String user) {
        String loc = (location != null && !location.isBlank()) ? location : "MAIN";
        String batch = batchNo != null ? batchNo : "";
        String heat = heatNo != null ? heatNo : "";
        BigDecimal toRelease = qty != null ? qty : BigDecimal.ZERO;
        if (toRelease.compareTo(BigDecimal.ZERO) <= 0) return;
        Optional<StockBalance> held = balances
                .findByItemCodeAndLocationAndBatchNoAndHeatNoAndStockStatus(itemCode, loc, batch, heat, "QC_HOLD");
        if (held.isEmpty()) return;
        StockBalance sb = held.get();
        BigDecimal heldQty = sb.getQty();
        if (heldQty.compareTo(toRelease) < 0) toRelease = heldQty;
        // reduce QC_HOLD
        sb.setQty(heldQty.subtract(toRelease));
        if (sb.getQty().compareTo(BigDecimal.ZERO) <= 0) {
            balances.delete(sb);
        } else {
            balances.save(sb);
        }
        // add FREE
        updateBalance(itemCode, loc, batch, heat, "FREE", toRelease, BigDecimal.ZERO);
        ledger.save(StockLedger.builder()
                .docNo(docNo).docType(docType).txType(txType)
                .itemCode(itemCode).location(loc).batchNo(batch).heatNo(heat)
                .stockStatus("FREE")
                .inQty(toRelease).outQty(BigDecimal.ZERO)
                .txDate(txDate != null ? txDate : LocalDate.now())
                .createdBy(user).createdAt(Instant.now())
                .build());
    }

    @Transactional
    public void releaseQcHoldForItem(String docNo, String docType, String txType, String itemCode,
                                     String batchNo, String heatNo, BigDecimal qty,
                                     LocalDate txDate, String user) {
        BigDecimal remaining = qty != null ? qty : BigDecimal.ZERO;
        if (remaining.compareTo(BigDecimal.ZERO) <= 0) return;
        String batch = batchNo != null ? batchNo : "";
        String heat = heatNo != null ? heatNo : "";
        for (StockBalance sb : balances.findByStockStatus("QC_HOLD")) {
            if (remaining.compareTo(BigDecimal.ZERO) <= 0) break;
            if (!itemCode.equals(sb.getItemCode())) continue;
            if (!batch.isEmpty() && !batch.equals(sb.getBatchNo())) continue;
            if (!heat.isEmpty() && !heat.equals(sb.getHeatNo())) continue;
            BigDecimal take = remaining;
            if (sb.getQty().compareTo(take) < 0) take = sb.getQty();
            releaseQcHold(docNo, docType, txType, itemCode, sb.getLocation(), sb.getBatchNo(), sb.getHeatNo(),
                    take, txDate, user);
            remaining = remaining.subtract(take);
        }
    }

    @Transactional
    public void disposeHeldStock(String docNo, String docType, String txType, String itemCode,
                                 String location, String batchNo, String heatNo,
                                 BigDecimal qty, String disposition, LocalDate txDate, String user) {
        String status = disposition == null || disposition.isBlank() ? "REJECTED" : disposition.toUpperCase();
        String loc = (location != null && !location.isBlank()) ? location : "MAIN";
        String batch = batchNo != null ? batchNo : "";
        String heat = heatNo != null ? heatNo : "";
        BigDecimal toDispose = qty != null ? qty : BigDecimal.ZERO;
        if (toDispose.compareTo(BigDecimal.ZERO) <= 0) return;
        Optional<StockBalance> held = balances
                .findByItemCodeAndLocationAndBatchNoAndHeatNoAndStockStatus(itemCode, loc, batch, heat, "QC_HOLD");
        if (held.isEmpty()) return;
        StockBalance sb = held.get();
        BigDecimal heldQty = sb.getQty();
        if (heldQty.compareTo(toDispose) < 0) toDispose = heldQty;
        sb.setQty(heldQty.subtract(toDispose));
        if (sb.getQty().compareTo(BigDecimal.ZERO) <= 0) {
            balances.delete(sb);
        } else {
            balances.save(sb);
        }
        updateBalance(itemCode, loc, batch, heat, status, toDispose, BigDecimal.ZERO);
        ledger.save(StockLedger.builder()
                .docNo(docNo).docType(docType).txType(txType)
                .itemCode(itemCode).location(loc).batchNo(batch).heatNo(heat)
                .stockStatus(status)
                .inQty(BigDecimal.ZERO).outQty(toDispose)
                .txDate(txDate != null ? txDate : LocalDate.now())
                .createdBy(user).createdAt(Instant.now())
                .build());
    }

    @Transactional
    public void disposeHeldForItem(String docNo, String docType, String txType, String itemCode,
                                   String batchNo, String heatNo, BigDecimal qty,
                                   String disposition, LocalDate txDate, String user) {
        BigDecimal remaining = qty != null ? qty : BigDecimal.ZERO;
        if (remaining.compareTo(BigDecimal.ZERO) <= 0) return;
        String batch = batchNo != null ? batchNo : "";
        String heat = heatNo != null ? heatNo : "";
        for (StockBalance sb : balances.findByStockStatus("QC_HOLD")) {
            if (remaining.compareTo(BigDecimal.ZERO) <= 0) break;
            if (!itemCode.equals(sb.getItemCode())) continue;
            if (!batch.isEmpty() && !batch.equals(sb.getBatchNo())) continue;
            if (!heat.isEmpty() && !heat.equals(sb.getHeatNo())) continue;
            BigDecimal take = remaining;
            if (sb.getQty().compareTo(take) < 0) take = sb.getQty();
            disposeHeldStock(docNo, docType, txType, itemCode, sb.getLocation(), sb.getBatchNo(), sb.getHeatNo(),
                    take, disposition, txDate, user);
            remaining = remaining.subtract(take);
        }
    }

    private void updateBalance(String itemCode, String location, String batchNo, String heatNo,
                               String stockStatus, BigDecimal addQty, BigDecimal subtractQty) {
        Optional<StockBalance> existing = balances
                .findByItemCodeAndLocationAndBatchNoAndHeatNoAndStockStatus(
                        itemCode, location, batchNo, heatNo, stockStatus);

        if (existing.isPresent()) {
            StockBalance sb = existing.get();
            sb.setQty(sb.getQty().add(addQty).subtract(subtractQty));
            // A row that nets to zero (or, if some earlier bug ever let it happen,
            // negative) is dead weight regardless of status: a lingering QC_HOLD/
            // BLOCKED/etc. row at qty<=0 isn't just harmless clutter — a negative one
            // would silently corrupt the on_hand-reserved-qc_hold "available" formula
            // (BR-INV-ENGINE-2) for every other status bucket of this item/location.
            // This used to only clean up FREE rows.
            if (sb.getQty().compareTo(BigDecimal.ZERO) <= 0) {
                balances.delete(sb);
            } else {
                balances.save(sb);
            }
        } else if (addQty.compareTo(BigDecimal.ZERO) > 0) {
            balances.save(StockBalance.builder()
                    .itemCode(itemCode).location(location).batchNo(batchNo).heatNo(heatNo)
                    .stockStatus(stockStatus).qty(addQty)
                    .build());
        }
    }

    public void verifyStockAvailability(String itemCode, String location, BigDecimal requiredQty) {
        verifyStockAvailability(itemCode, location, requiredQty, false);
    }

    public void verifyStockAvailability(String itemCode, String location, BigDecimal requiredQty,
                                        boolean allowNegativeOverride) {
        if (requiredQty == null || requiredQty.compareTo(BigDecimal.ZERO) <= 0) return;
        String loc = location == null || location.isEmpty() ? "MAIN" : location;
        double avail = available(itemCode, loc);
        if (avail - requiredQty.doubleValue() < 0) {
            if (allowNegativeOverride
                    && CurrentUserRoles.hasAnyRole("ADMIN", "STORE_MANAGER", "STORES_MANAGER")) {
                log.warn("NEGATIVE STOCK OVERRIDE: item={}, location={}, requested={}, available={} — authorized by {}",
                        itemCode, loc, requiredQty, avail, CurrentUserRoles.username());
                return;
            }
            log.warn("NEGATIVE STOCK ATTEMPT BLOCKED: item={}, location={}, requested={}, available={}, deficit={}",
                    itemCode, loc, requiredQty, avail,
                    BigDecimal.valueOf(requiredQty.doubleValue() - avail));
            throw new IllegalArgumentException("Insufficient stock for " + itemCode +
                    " at " + loc + ": available " + avail + ", requested " + requiredQty);
        }
    }

    public void verifyPhysicalStockAvailability(String itemCode, String location, BigDecimal requiredQty,
                                                 boolean allowNegativeOverride) {
        if (requiredQty == null || requiredQty.compareTo(BigDecimal.ZERO) <= 0) return;
        String loc = location == null || location.isEmpty() ? "MAIN" : location;
        double usableOnHand = onHand(itemCode, loc, null) - qcHold(itemCode, loc);
        if (usableOnHand - requiredQty.doubleValue() < 0) {
            if (allowNegativeOverride
                    && CurrentUserRoles.hasAnyRole("ADMIN", "STORE_MANAGER", "STORES_MANAGER")) {
                log.warn("NEGATIVE STOCK OVERRIDE: item={}, location={}, requested={}, available={} — authorized by {}",
                        itemCode, loc, requiredQty, usableOnHand, CurrentUserRoles.username());
                return;
            }
            log.warn("NEGATIVE STOCK ATTEMPT BLOCKED: item={}, location={}, requested={}, available={}, deficit={}",
                    itemCode, loc, requiredQty, usableOnHand,
                    BigDecimal.valueOf(requiredQty.doubleValue() - usableOnHand));
            throw new IllegalArgumentException("Insufficient stock for " + itemCode +
                    " at " + loc + ": available " + usableOnHand + ", requested " + requiredQty);
        }
    }
}
