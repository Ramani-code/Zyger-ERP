package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
import in.zygertechnology.zygererp.entity.ProductionReturn;
import in.zygertechnology.zygererp.entity.StockBalance;
import in.zygertechnology.zygererp.entity.StockLedger;
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
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * P12 (F13) — Production Return stock integration against a real PostgreSQL Testcontainer.
 *
 * <p>Closes the DOCUMENT_64 F13 coverage gap for Production Return (unit-only so far) by
 * proving the RECEIVE posting through {@link InventoryIntegrationService} → {@link StockService}:
 * a GOOD return posts exactly one {@code production-return} / {@code RETURN_RECEIPT} IN-ledger
 * row and a countable FREE balance, while a REJECTED disposition is refused and posts NO stock
 * (D-C1: only FREE / QC_HOLD are countable stock statuses).</p>
 */
@SpringBootTest
@ActiveProfiles("test")
class ProductionReturnStockIntegrationTest extends AbstractPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Autowired private ProductionReturnService returns;
    @Autowired private StockService stockService;
    @Autowired private LedgerRepository ledger;
    @Autowired private StockBalanceRepository balances;
    @Autowired private JdbcTemplate jdbc;

    private static final String ITEM = "FG-R";
    private static final String LOC = "STORE";
    private static final String USER = "p12-integration-operator";

    @BeforeEach
    void clean() {
        for (String t : new String[]{"production_return", "stock_ledger", "stock_balance"}) {
            jdbc.execute("TRUNCATE TABLE " + t + " CASCADE");
        }
    }

    private ProductionReturn standalone(String condition, String qty) {
        return returns.create(ProductionReturn.builder()
                .itemCode(ITEM).quantity(new BigDecimal(qty)).condition(condition)
                .location(LOC).returnReason("F13 integration return").build(), USER);
    }

    @Test
    @DisplayName("GOOD return RECEIVE posts exactly one RETURN_RECEIPT IN-ledger row and a FREE balance")
    void goodReceivePostsStockInLedgerAndBalance() {
        ProductionReturn pr = standalone("GOOD", "25");
        returns.action(pr.getId(), "SUBMIT", USER);
        returns.action(pr.getId(), "VERIFY", USER);
        ProductionReturn received = returns.action(pr.getId(), "RECEIVE", USER);

        assertEquals("RECEIVED", received.getStatus());
        assertNotNull(received.getReturnNumber(), "return must carry a generated return number");

        List<StockLedger> ins = ledger.findAll().stream()
                .filter(l -> "production-return".equals(l.getDocType())
                        && ITEM.equals(l.getItemCode())
                        && l.getInQty() != null && l.getInQty().signum() > 0)
                .toList();
        assertEquals(1, ins.size(), "must post exactly ONE production-return IN row");
        assertEquals(received.getReturnNumber(), ins.get(0).getDocNo());
        assertEquals("RETURN_RECEIPT", ins.get(0).getTxType());
        assertEquals("FREE", ins.get(0).getStockStatus());
        assertEquals(0, new BigDecimal("25").compareTo(ins.get(0).getInQty()));

        assertEquals(25.0, stockService.onHand(ITEM, LOC, null), 0.001, "onHand must be 25 after receive");
        StockBalance balance = balances.findByItemCodeAndLocationAndBatchNoAndHeatNoAndStockStatus(
                ITEM, LOC, "", "", "FREE").orElseThrow();
        assertEquals(0, new BigDecimal("25").compareTo(balance.getQty()),
                "FREE balance row must reflect the 25 returned qty");
    }

    @Test
    @DisplayName("REJECTED disposition RECEIVE is refused (D-C1) and posts no stock")
    void rejectedDispositionDoesNotPostStock() {
        ProductionReturn pr = standalone("REJECTED", "10");
        returns.action(pr.getId(), "SUBMIT", USER);
        returns.action(pr.getId(), "VERIFY", USER);

        assertThrows(RuntimeException.class, () -> returns.action(pr.getId(), "RECEIVE", USER),
                "REJECTED is not a countable stock-in — RECEIVE must fail before any posting");

        assertEquals(0, ledger.findAll().stream()
                .filter(l -> "production-return".equals(l.getDocType())).count(),
                "no production-return ledger row must exist for the rejected disposition");
        assertEquals(0.0, stockService.onHand(ITEM, LOC, null), 0.001,
                "no stock may be posted for a rejected return");
    }
}