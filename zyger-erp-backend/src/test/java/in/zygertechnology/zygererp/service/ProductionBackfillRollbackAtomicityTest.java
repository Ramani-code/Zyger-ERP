package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
import in.zygertechnology.zygererp.dto.resolution.InputResolutionResult;
import in.zygertechnology.zygererp.entity.ProductionEntry;
import in.zygertechnology.zygererp.repo.ProdBackfillEntryOutcomeRepository;
import in.zygertechnology.zygererp.repo.ProdBackfillProgressRepository;
import in.zygertechnology.zygererp.repo.ProdExecutionSessionRepository;
import in.zygertechnology.zygererp.repo.ProductionEntryRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;

import java.math.BigDecimal;
import java.time.Instant;

import org.mockito.Mockito;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * P3.3 — Per-entry transaction atomicity rollback proof (DOCUMENT_34 §7, §10).
 *
 * <p>The processor projects ONE entry inside a single {@code REQUIRES_NEW} transaction with
 * its outcome and progress/cursor update. If anything in that transaction fails, ALL of it
 * must roll back — no orphan session/operation/output, no committed outcome, no advanced
 * cursor. No partial projection may remain committed.
 *
 * <p>Here a failure is injected at the cursor-advance step (AFTER the real writer has derived
 * the session/operation/outputs inside the transaction). Because the whole entry is one
 * {@code REQUIRES_NEW} transaction, the exception rolls back every per-entry row atomically.
 */
@SpringBootTest(properties = "production.backfill.enabled=true")
@ActiveProfiles("test")
class ProductionBackfillRollbackAtomicityTest extends AbstractPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Autowired
    private ProductionBackfillEntryProcessor processor;
    @Autowired
    private ProductionInputAuthorityResolver resolver;
    @Autowired
    private ProductionEntryRepository productionEntries;
    @Autowired
    private ProdExecutionSessionRepository sessionRepo;
    @Autowired
    private ProdBackfillProgressRepository progressRepo;
    @Autowired
    private ProdBackfillEntryOutcomeRepository outcomeRepo;
    @Autowired
    private JdbcTemplate jdbc;

    @MockitoSpyBean
    private ProductionBackfillProgressService progress;

    @BeforeEach
    void clean() {
        for (String t : new String[]{"prod_backfill_entry_outcome", "prod_backfill_progress",
                "prod_output_event", "prod_operation_event", "prod_execution_session", "production_entry"}) {
            jdbc.execute("TRUNCATE TABLE " + t + " RESTART IDENTITY CASCADE");
        }
        Mockito.reset(progress);
    }

    @Test
    @DisplayName("10: a failure inside the entry transaction rolls back ALL per-entry writes (no partial projection)")
    void failureRollsBackWholeEntryTransaction() {
        ProductionEntry e = productionEntries.save(catC("PE-ATOMIC", "10", "10", "9", "0", "0", "0"));
        InputResolutionResult res = resolver.resolve(e);
        String job = "JOB-ATOMIC";

        long sessionsBefore = count("prod_execution_session");
        long opsBefore = count("prod_operation_event");
        long outsBefore = count("prod_output_event");
        long outcomesBefore = count("prod_backfill_entry_outcome");
        long progressBefore = count("prod_backfill_progress");

        // Real session/operation/output writes succeed (inside the REQUIRES_NEW txn), then the
        // cursor-advance step fails — forcing the whole entry transaction to roll back.
        doThrow(new IllegalStateException("simulated post-write failure"))
                .when(progress).heartbeat(anyString(), anyLong(), anyLong(), anyLong());

        assertThrows(IllegalStateException.class,
                () -> processor.projectEligible(job, e, res, 1L),
                "the failure inside the entry transaction must propagate");

        // No partial projection & no committed outcome/progress:
        assertEquals(sessionsBefore, count("prod_execution_session"), "no orphan session");
        assertEquals(opsBefore, count("prod_operation_event"), "no orphan operation");
        assertEquals(outsBefore, count("prod_output_event"), "no orphan output");
        assertEquals(outcomesBefore, count("prod_backfill_entry_outcome"), "no committed outcome");
        assertEquals(progressBefore, count("prod_backfill_progress"), "no committed progress/cursor");
    }

    @Test
    @DisplayName("10b: processor refuses to fabricate an input for a non-resolvable record and persists nothing")
    void refusesToFabricateInput() {
        ProductionEntry e = productionEntries.save(catB("PE-FAB", "100", "90"));
        InputResolutionResult res = resolver.resolve(e); // QUARANTINE, not resolvable
        assertThrows(IllegalStateException.class,
                () -> processor.projectEligible("JOB-FAB", e, res, 1L));
        assertFalse(sessionRepo.findByEntryNumber("PE-FAB").isPresent());
        assertTrue(outcomeRepo.findByJobIdAndEntryNumber("JOB-FAB", "PE-FAB").isEmpty());
    }

    private ProductionEntry catC(String en, String process, String produced, String good, String rej, String rew, String scr) {
        ProductionEntry e = base(en);
        e.setProcessQty(new BigDecimal(process));
        e.setProducedQuantity(new BigDecimal(produced));
        e.setGoodQuantity(new BigDecimal(good));
        e.setRejectedQuantity(new BigDecimal(rej));
        e.setReworkQuantity(new BigDecimal(rew));
        e.setScrapQuantity(new BigDecimal(scr));
        e.setStatus("POSTED");
        return e;
    }

    private ProductionEntry catB(String en, String produced, String good) {
        ProductionEntry e = base(en);
        e.setProducedQuantity(new BigDecimal(produced));
        e.setGoodQuantity(new BigDecimal(good));
        e.setStatus("POSTED");
        return e;
    }

    private ProductionEntry base(String en) {
        return ProductionEntry.builder()
                .entryNumber(en)
                .entryType("Production Entry")
                .jobCardNumber("JC-A")
                .workOrderNumber("WO-A")
                .subjobNumber("SUB-A")
                .partCode("PART-1")
                .partDescription("Part One")
                .operationCode("OP-1")
                .operationSequence(1)
                .machineCode("M-1")
                .operatorCode("O-1")
                .goodQuantity(BigDecimal.ZERO)
                .rejectedQuantity(BigDecimal.ZERO)
                .reworkQuantity(BigDecimal.ZERO)
                .scrapQuantity(BigDecimal.ZERO)
                .startTime(Instant.parse("2026-09-01T08:00:00Z"))
                .createdAt(Instant.parse("2026-09-01T08:00:00Z"))
                .build();
    }

    private long count(String table) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class);
        return n == null ? 0L : n;
    }
}