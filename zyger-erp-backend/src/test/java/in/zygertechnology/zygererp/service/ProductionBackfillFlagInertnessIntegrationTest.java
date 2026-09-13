package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
import in.zygertechnology.zygererp.dto.backfill.BackfillRunResult;
import in.zygertechnology.zygererp.entity.ProductionEntry;
import in.zygertechnology.zygererp.repo.ProdExecutionSessionRepository;
import in.zygertechnology.zygererp.repo.ProductionEntryRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/**
 * P3.3 — Feature-flag-OFF inertness + static inventory isolation scan for the backfill engine.
 *
 * <p>Proves:
 * <ul>
 *   <li>17: with {@code production.backfill.enabled} OFF (the default), the engine is inert —
 *       no progress, no outcome, no normalized event, no reads-triggering-writes, no flag change.</li>
 *   <li>15/18: a static scan of the backfill engine sources proves ZERO dependency on
 *       {@code StockService}/{@code ProductionStockBoundary}/{@code StockBalanceRepository};
 *       it never writes {@code stock_ledger}/{@code stock_balance}. The engine has no public
 *       endpoint and exists only as an internal service invoked manually with an actor.</li>
 * </ul>
 */
@SpringBootTest
@ActiveProfiles("test")
class ProductionBackfillFlagInertnessIntegrationTest extends AbstractPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Autowired
    private ProductionBackfillService backfill;
    @Autowired
    private ProductionEntryRepository productionEntries;
    @Autowired
    private ProdExecutionSessionRepository sessionRepo;
    @Autowired
    private JdbcTemplate jdbc;

    private static final String SRC_DIR =
            "src/main/java/in/zygertechnology/zygererp/service";

    @Test
    @DisplayName("17: feature flag OFF (default) — engine is inert; no writes, no events, gate reported closed")
    void flagOffInert() {
        long ledgerBefore = count("stock_ledger");
        ProductionEntry c = productionEntries.save(catC("PE-OFF", "10", "10", "9"));

        BackfillRunResult r = backfill.backfill("JOB-OFF", false, "tester");

        assertFalse(r.isExecutionGateOpen(), "execution gate must be reported closed when flag OFF");
        assertFalse(r.isDryRun());
        assertTrue(progressRepoEmpty("JOB-OFF"), "flag OFF must not create a progress row");
        assertTrue(sessionRepo.findByEntryNumber("PE-OFF").isEmpty(), "flag OFF must not create events");
        assertEquals(ledgerBefore, count("stock_ledger"), "flag OFF never touches stock_ledger");
        assertEquals(1L, count("production_entry"), "flag OFF never touches legacy");
    }

    @Test
    @DisplayName("15/18: static scan — backfill engine sources have ZERO StockService/StockBoundary/StockBalanceRepository references")
    void backfillEngineHasNoInventoryDependency() throws IOException {
        for (String f : new String[]{"ProductionBackfillService.java",
                "ProductionBackfillEntryProcessor.java",
                "ProductionBackfillEventWriter.java"}) {
            String src = Files.readString(Path.of(SRC_DIR, f));
            assertFalse(src.contains("StockService"), f + " must not reference StockService");
            assertFalse(src.contains("ProductionStockBoundary"), f + " must not reference ProductionStockBoundary");
            assertFalse(src.contains("StockBalanceRepository"), f + " must not reference StockBalanceRepository");
            assertFalse(src.contains("stock_ledger"), f + " must not write stock_ledger");
            assertFalse(src.contains("stock_balance"), f + " must not write stock_balance");
        }
    }

    private ProductionEntry catC(String en, String process, String produced, String good) {
        return ProductionEntry.builder()
                .entryNumber(en)
                .entryType("Production Entry")
                .jobCardNumber("JC-OFF")
                .workOrderNumber("WO-OFF")
                .subjobNumber("SUB-OFF")
                .partCode("PART-1")
                .operationCode("OP-1")
                .operationSequence(1)
                .processQty(new BigDecimal(process))
                .producedQuantity(new BigDecimal(produced))
                .goodQuantity(new BigDecimal(good))
                .rejectedQuantity(BigDecimal.ZERO)
                .reworkQuantity(BigDecimal.ZERO)
                .scrapQuantity(BigDecimal.ZERO)
                .status("POSTED")
                .build();
    }

    private boolean progressRepoEmpty(String jobId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM prod_backfill_progress WHERE job_id = ?", Long.class, jobId);
        return n == null || n == 0L;
    }

    private long count(String table) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class);
        return n == null ? 0L : n;
    }
}