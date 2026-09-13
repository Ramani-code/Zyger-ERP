package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.ProdExecutionSessionRepository;
import in.zygertechnology.zygererp.repo.ProdOperationEventRepository;
import in.zygertechnology.zygererp.repo.ProdOutputEventRepository;
import in.zygertechnology.zygererp.repo.ProductionEntryRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;

import java.math.BigDecimal;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

/**
 * P3 — DB-backed guarantees for the normalized-event projection, flag ON.
 *
 * <p>Validates against a real PostgreSQL Testcontainer (schema created by Hibernate
 * {@code ddl-auto} from the P3 entities):
 * <ul>
 *   <li>Projection persistence + quantity reconciliation (P3-04)</li>
 *   <li>Guaranteed zero inventory postings from the projection (P3-05)</li>
 *   <li>Authoritative transaction rollback also rolls back the derived events (P3-02)</li>
 *   <li>Event uniqueness by natural key under re-emission (P3-03)</li>
 * </ul>
 */
@SpringBootTest(properties = "production.normalized-ops.enabled=true")
@ActiveProfiles("test")
class ProductionNormalizedEventProjectionIntegrationTest extends AbstractPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Autowired
    private ProductionNormalizedEventService eventService;
    @Autowired
    private ProductionEntryRepository productionEntries;
    @Autowired
    private ProdExecutionSessionRepository sessionRepo;
    @Autowired
    private ProdOperationEventRepository operationRepo;
    @Autowired
    private ProdOutputEventRepository outputRepo;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private PlatformTransactionManager txManager;

    private ProductionEntry newEntry(String entryNumber) {
        return ProductionEntry.builder()
                .entryNumber(entryNumber)
                .jobCardNumber("JC-INT")
                .workOrderNumber("WO-INT")
                .subjobNumber("SUB-INT")
                .partCode("P-INT")
                .partDescription("Part Int")
                .operationCode("OP-1")
                .operationSequence(1)
                .machineCode("M-1")
                .operatorCode("O-1")
                .processQty(new BigDecimal("100.0000"))
                .goodQuantity(new BigDecimal("90.0000"))
                .rejectedQuantity(new BigDecimal("5.0000"))
                .reworkQuantity(new BigDecimal("3.0000"))
                .scrapQuantity(new BigDecimal("2.0000"))
                .status("DRAFT")
                .qualityStatus("PENDING")
                .startTime(Instant.parse("2026-09-01T08:00:00Z"))
                .createdAt(Instant.parse("2026-09-01T08:00:00Z"))
                .build();
    }

    @Test
    @DisplayName("projection persists session/operation/output with correct reconciliation (P3-04)")
    void projectionPersistsWithReconciliation() {
        ProductionEntry e = productionEntries.save(newEntry("PE-INT-1"));
        eventService.project(e, ProductionNormalizedEventService.EventKind.POST, "u1");

        ProdExecutionSession s = sessionRepo.findByEntryNumber("PE-INT-1").orElseThrow();
        assertEquals("COMPLETED", s.getSessionStatus());
        // input = process_qty (100), not good (90)
        assertEquals(0, new BigDecimal("100.0000").compareTo(s.getAvailableInput()));
        // accepted = good = 90
        assertEquals(0, new BigDecimal("90.0000").compareTo(s.getAcceptedOutput()));
        // wip = 100 - (90+5+3+2) = 0, never negative
        assertEquals(0, BigDecimal.ZERO.compareTo(s.getWip()));
        assertTrue(s.getWip().signum() >= 0);

        // one operation event (queried via repo to avoid lazy init outside tx)
        assertEquals(1, operationRepo.findBySessionId(s.getId()).size());
        assertEquals("OP-1", operationRepo.findBySessionId(s.getId()).get(0).getOperationCode());

        // 4 output rows (ACCEPTED/REJECTED/REWORK/SCRAP all nonzero)
        long outputs = operationRepo.findBySessionId(s.getId()).stream()
                .mapToLong(op -> outputRepo.findByOperationEventId(op.getId()).size()).sum();
        assertEquals(4L, outputs);
    }

    @Test
    @DisplayName("event projection produces ZERO inventory postings (P3-05)")
    void projectionProducesNoInventoryPostings() {
        long ledgerBefore = count("stock_ledger");
        long balanceBefore = count("stock_balance");

        ProductionEntry e = productionEntries.save(newEntry("PE-INT-STOCK"));
        eventService.project(e, ProductionNormalizedEventService.EventKind.POST, "u1");

        assertEquals(count("stock_ledger"), ledgerBefore, "event projection must not write stock_ledger");
        assertEquals(count("stock_balance"), balanceBefore, "event projection must not write stock_balance");
        assertEquals(1L, countWhere("prod_execution_session", "entry_number='PE-INT-STOCK'"));
        // and the event rows are present (proving the projection DID run flag ON)
        assertEquals(1L, countWhere("prod_operation_event",
                "session_id IN (SELECT id FROM prod_execution_session WHERE entry_number='PE-INT-STOCK')"));
    }

    @Test
    @DisplayName("legacy authoritative rollback rolls back derived events too (P3-02)")
    void authoritativeRollbackRollsBackEvents() {
        TransactionTemplate tpl = new TransactionTemplate(txManager);
        // Within one tx: persist authoritative entry + derive projection, then force rollback.
        // P3-02 requires that if the authoritative transaction fails, NO events remain.
        try {
            tpl.execute((TransactionCallback<Void>) status -> {
                ProductionEntry e = productionEntries.save(newEntry("PE-INT-RB"));
                eventService.project(e, ProductionNormalizedEventService.EventKind.POST, "u1");
                status.setRollbackOnly();
                return null;
            });
        } catch (RuntimeException ignored) {
            // expected rollback
        }
        // After the (rolled-back) tx: neither the entry nor its projection may exist.
        assertEquals(0L, countWhere("production_entry", "entry_number='PE-INT-RB'"),
                "authoritative entry must be rolled back");
        assertEquals(0L, countWhere("prod_execution_session", "entry_number='PE-INT-RB'"),
                "derived projection must be rolled back with the authoritative transaction");
    }

    @Test
    @DisplayName("re-emission is idempotent — single session row, no duplicate outputs (P3-03)")
    void reEmissionIsIdempotent() {
        ProductionEntry e = productionEntries.save(newEntry("PE-INT-IDEM"));
        eventService.project(e, ProductionNormalizedEventService.EventKind.POST, "u1");
        // retry with identical natural key
        eventService.project(e, ProductionNormalizedEventService.EventKind.POST, "u1");

        assertEquals(1L, countWhere("prod_execution_session", "entry_number='PE-INT-IDEM'"));
        Long sessionId = jdbc.queryForObject(
                "SELECT id FROM prod_execution_session WHERE entry_number='PE-INT-IDEM'", Long.class);
        assertEquals(1L, countWhere("prod_operation_event", "session_id=" + sessionId));
        assertEquals(4L, countWhere("prod_output_event", "session_id=" + sessionId));
    }

    @Test
    @DisplayName("concurrent emission never duplicates events — UNIQUE natural keys hold (P3-03 concurrency)")
    void concurrentEmissionIsSafe() throws Exception {
        ProductionEntry e = productionEntries.save(newEntry("PE-INT-CONC"));
        java.util.concurrent.ExecutorService pool =
                java.util.concurrent.Executors.newFixedThreadPool(8);
        try {
            java.util.Collection<java.util.concurrent.Callable<Void>> tasks = new java.util.ArrayList<>();
            for (int i = 0; i < 24; i++) {
                final int worker = i;
                tasks.add(() -> {
                    eventService.project(e, ProductionNormalizedEventService.EventKind.POST, "u" + worker);
                    return null;
                });
            }
            pool.invokeAll(tasks);
        } finally {
            pool.shutdown();
        }

        // Exactly one session, one operation event, four output rows for this entry.
        assertEquals(1L, countWhere("prod_execution_session", "entry_number='PE-INT-CONC'"));
        Long sessionId = jdbc.queryForObject(
                "SELECT id FROM prod_execution_session WHERE entry_number='PE-INT-CONC'", Long.class);
        assertEquals(1L, countWhere("prod_operation_event", "session_id=" + sessionId));
        assertEquals(4L, countWhere("prod_output_event", "session_id=" + sessionId));
    }

    @Test
    @DisplayName("reverse creates a CANCELLED/REVERSED mirror; original projection preserved (P3-06)")
    void reversePreservesOriginalAndMirrors() {
        // Forward posted entry projected first.
        ProductionEntry posted = productionEntries.save(newEntry("PE-INT-REV"));
        eventService.project(posted, ProductionNormalizedEventService.EventKind.POST, "u1");

        // Reversal entry (already-negated quantities, its own entry_number).
        ProductionEntry reversal = newEntry("PE-INT-REV-REV");
        reversal.setProcessQty(new BigDecimal("-100.0000"));
        reversal.setGoodQuantity(new BigDecimal("-90.0000"));
        reversal.setRejectedQuantity(new BigDecimal("-5.0000"));
        reversal.setReworkQuantity(new BigDecimal("-3.0000"));
        reversal.setScrapQuantity(new BigDecimal("-2.0000"));
        reversal.setIsReversal(true);
        reversal.setReversedFromEntryId(posted.getId());
        ProductionEntry reversalSaved = productionEntries.save(reversal);
        eventService.project(reversalSaved, ProductionNormalizedEventService.EventKind.REVERSE, "u1");

        // Original projection is preserved (still COMPLETED) — never deleted/edited away.
        ProdExecutionSession original = sessionRepo.findByEntryNumber("PE-INT-REV").orElseThrow();
        assertEquals("COMPLETED", original.getSessionStatus());
        assertEquals(0, new BigDecimal("90.0000").compareTo(original.getAcceptedOutput()));

        // A distinct compensating mirror exists, keyed to the reversal entry_number.
        ProdExecutionSession mirror = sessionRepo.findByEntryNumber("PE-INT-REV-REV").orElseThrow();
        assertEquals("CANCELLED", mirror.getSessionStatus());
        // The mirror carries the (already negated) reversal quantities.
        assertEquals(0, new BigDecimal("-90.0000").compareTo(mirror.getAcceptedOutput()));

        // Both sessions must coexist — original history is not deleted (P3-06).
        assertEquals(2L, countWhere("prod_execution_session",
                "entry_number IN ('PE-INT-REV','PE-INT-REV-REV')"));
    }

    private long count(String table) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class);
        return n == null ? 0L : n;
    }

    private long countWhere(String table, String where) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + where, Long.class);
        return n == null ? 0L : n;
    }
}