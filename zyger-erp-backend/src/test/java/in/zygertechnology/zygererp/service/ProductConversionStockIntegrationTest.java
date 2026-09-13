package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
import in.zygertechnology.zygererp.entity.ItemMaster;
import in.zygertechnology.zygererp.entity.ProductConversion;
import in.zygertechnology.zygererp.entity.StockBalance;
import in.zygertechnology.zygererp.entity.StockLedger;
import in.zygertechnology.zygererp.repo.ItemRepository;
import in.zygertechnology.zygererp.repo.LedgerRepository;
import in.zygertechnology.zygererp.repo.StockBalanceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * P13 (F13) — Product Conversion stock integration against a real PostgreSQL Testcontainer.
 *
 * <p>Closes the DOCUMENT_64 F13 coverage gap for Product Conversion (unit-only so far) by
 * proving the POST posting through {@link InventoryIntegrationService} → {@link StockService}:
 * exactly one {@code CONVERSION_OUT} OUT-ledger row (key {@code {number}-OUT}) and one
 * {@code CONVERSION_IN} IN-ledger row (key {@code {number}-IN}) with conservation
 * ({@code onHand(input) = 0}, {@code onHand(output) = outputQty}). Re-POST is blocked by the
 * state machine and never duplicates stock (distinct idempotency keys).</p>
 */
@SpringBootTest
@ActiveProfiles("test")
class ProductConversionStockIntegrationTest extends AbstractPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Autowired private ProductConversionService conversions;
    @Autowired private StockService stockService;
    @Autowired private LedgerRepository ledger;
    @Autowired private StockBalanceRepository balances;
    @Autowired private ItemRepository items;
    @Autowired private JdbcTemplate jdbc;

    private static final String INPUT = "IN-1";
    private static final String OUTPUT = "OUT-1";
    private static final String LOC = "MAIN";
    private static final String USER = "p13-integration-operator";

    @BeforeEach
    void clean() {
        for (String t : new String[]{"product_conversion", "stock_ledger", "stock_balance"}) {
            jdbc.execute("TRUNCATE TABLE " + t + " CASCADE");
        }
        jdbc.execute("DELETE FROM item_master WHERE code IN ('" + INPUT + "','" + OUTPUT + "')");
        items.save(ItemMaster.builder().code(INPUT).name("Conversion Input").active(true).build());
        items.save(ItemMaster.builder().code(OUTPUT).name("Conversion Output").active(true).build());
        stockService.recordStockIn("SEED-CONV", "stock-in", "STOCK_IN",
                INPUT, LOC, null, null,
                BigDecimal.valueOf(100), LocalDate.now(), USER, "FREE");
    }

    private ProductConversion toVerified(String inQty, String outQty, String loss, String scrap) {
        ProductConversion pc = conversions.create(ProductConversion.builder()
                .conversionType("RM_TO_SFG")
                .inputItemCode(INPUT).inputQuantity(new BigDecimal(inQty)).inputUom("KG")
                .outputItemCode(OUTPUT).outputQuantity(new BigDecimal(outQty)).outputUom("KG")
                .processLossQty(new BigDecimal(loss)).scrapQty(new BigDecimal(scrap))
                .sourceWarehouse(LOC).destinationWarehouse(LOC)
                .build(), USER);
        conversions.action(pc.getId(), "SUBMIT", USER);
        conversions.action(pc.getId(), "VERIFY", USER);
        return pc;
    }

    @Test
    @DisplayName("POST posts distinct OUT/IN ledger rows preserving conservation")
    void postMovesInputOutAndOutputIn() {
        ProductConversion pc = toVerified("100", "90", "10", "0");
        ProductConversion posted = conversions.action(pc.getId(), "POST", USER);

        assertEquals("POSTED", posted.getStatus());
        assertNotNull(posted.getConversionNumber(), "conversion must carry a generated CV number");

        List<StockLedger> outs = ledger.findAll().stream()
                .filter(l -> "product-conversion".equals(l.getDocType())
                        && INPUT.equals(l.getItemCode())
                        && l.getOutQty() != null && l.getOutQty().signum() > 0)
                .toList();
        assertEquals(1, outs.size(), "must post exactly ONE conversion OUT row");
        assertEquals(posted.getConversionNumber() + "-OUT", outs.get(0).getDocNo(), "distinct OUT idempotency key");
        assertEquals("CONVERSION_OUT", outs.get(0).getTxType());
        assertEquals(0, new BigDecimal("100").compareTo(outs.get(0).getOutQty()));

        List<StockLedger> ins = ledger.findAll().stream()
                .filter(l -> "product-conversion".equals(l.getDocType())
                        && OUTPUT.equals(l.getItemCode())
                        && l.getInQty() != null && l.getInQty().signum() > 0)
                .toList();
        assertEquals(1, ins.size(), "must post exactly ONE conversion IN row");
        assertEquals(posted.getConversionNumber() + "-IN", ins.get(0).getDocNo(), "distinct IN idempotency key");
        assertEquals("CONVERSION_IN", ins.get(0).getTxType());
        assertEquals(0, new BigDecimal("90").compareTo(ins.get(0).getInQty()));

        assertEquals(0.0, stockService.onHand(INPUT, LOC, null), 0.001, "input fully consumed (100 - 100)");
        assertEquals(90.0, stockService.onHand(OUTPUT, LOC, null), 0.001, "output received (0 + 90)");
        StockBalance outputBalance = balances.findByItemCodeAndLocationAndBatchNoAndHeatNoAndStockStatus(
                OUTPUT, LOC, "", "", "FREE").orElseThrow();
        assertEquals(0, new BigDecimal("90").compareTo(outputBalance.getQty()),
                "output FREE balance must reflect the 90 received");
    }

    @Test
    @DisplayName("re-POST is blocked by the state machine and never duplicates OUT/IN ledger rows")
    void repostIsBlockedAndDoesNotDuplicateStock() {
        ProductConversion pc = toVerified("100", "90", "10", "0");
        conversions.action(pc.getId(), "POST", USER);

        assertThrows(RuntimeException.class, () -> conversions.action(pc.getId(), "POST", USER),
                "re-POST on an already POSTED conversion must be rejected");

        assertEquals(1, ledger.findAll().stream()
                .filter(l -> "product-conversion".equals(l.getDocType())
                        && l.getOutQty() != null && l.getOutQty().signum() > 0).count(),
                "re-POST must not add a second OUT row");
        assertEquals(1, ledger.findAll().stream()
                .filter(l -> "product-conversion".equals(l.getDocType())
                        && l.getInQty() != null && l.getInQty().signum() > 0).count(),
                "re-POST must not add a second IN row");
        assertEquals(90.0, stockService.onHand(OUTPUT, LOC, null), 0.001,
                "output onHand must remain 90 after blocked re-POST");
    }
}