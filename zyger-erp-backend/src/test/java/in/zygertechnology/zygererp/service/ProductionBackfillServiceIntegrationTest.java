package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
import in.zygertechnology.zygererp.dto.backfill.BackfillEntryDecision;
import in.zygertechnology.zygererp.dto.backfill.BackfillRunResult;
import in.zygertechnology.zygererp.dto.resolution.InputResolutionResult;
import in.zygertechnology.zygererp.entity.ProdBackfillProgress;
import in.zygertechnology.zygererp.entity.ProdExecutionSession;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;

import java.math.BigDecimal;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

/**
 * P3.3 — CONTROLLED BACKFILL ENGINE integration tests (feature flag ON, isolated DB).
 *
 * <p>Proves the 19 mandated requirements against a real PostgreSQL Testcontainer:
 * eligible projection, CATEGORY_B quarantine, stop-on-block, zero-eligible, idempotent
 * replay, ALREADY_PROJECTED, progress advancement, resume-from-last-successful, crash /
 * failure recovery, per-entry transactional rollback, output reconciliation, WIP
 * reconciliation via resolver EffectiveInputQuantity, no silent zero, no
 * produced-to-process conversion, inventory isolation, legacy-unchanged, authorized/manual
 * invocation, and rollback limited to backfill-created {@code prod_*} rows.
 */
@SpringBootTest(properties = "production.backfill.enabled=true")
@ActiveProfiles("test")
class ProductionBackfillServiceIntegrationTest extends AbstractPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Autowired
    private ProductionBackfillService backfill;
    @Autowired
    private ProductionBackfillEntryProcessor processor;
    @Autowired
    private ProductionBackfillProgressService progress;
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

    @BeforeEach
    void clean() {
        for (String t : new String[]{"prod_backfill_entry_outcome", "prod_backfill_progress",
                "prod_output_event", "prod_operation_event", "prod_execution_session",
                "production_entry_batch", "production_entry_material", "production_entry_rework",
                "production_entry_rejection", "production_entry_operator", "production_entry"}) {
            jdbc.execute("TRUNCATE TABLE " + t + " RESTART IDENTITY CASCADE");
        }
    }

    // --------------------------------------------------------------- builders

    private ProductionEntry base(String entryNumber) {
        return ProductionEntry.builder()
                .entryNumber(entryNumber)
                .entryType("Production Entry")
                .productionType("GENERAL")
                .jobCardNumber("JC-A")
                .workOrderNumber("WO-A")
                .subjobNumber("SUB-A")
                .partCode("PART-1")
                .partDescription("Part One")
                .operationCode("OP-1")
                .operationSequence(1)
                .machineCode("M-1")
                .operatorCode("O-1")
                .status("POSTED")
                .goodQuantity(BigDecimal.ZERO)
                .rejectedQuantity(BigDecimal.ZERO)
                .reworkQuantity(BigDecimal.ZERO)
                .scrapQuantity(BigDecimal.ZERO)
                .productionDate(Instant.parse("2026-09-01T10:00:00Z"))
                .startTime(Instant.parse("2026-09-01T08:00:00Z"))
                .endTime(Instant.parse("2026-09-01T09:00:00Z"))
                .createdAt(Instant.parse("2026-09-01T08:00:00Z"))
                .build();
    }

    /** Category C — process == produced, ELIGIBLE + resolvable. */
    private ProductionEntry catC(String en, String process, String produced, String good, String rej, String rew, String scr) {
        ProductionEntry e = base(en);
        e.setProcessQty(dec(process));
        e.setProducedQuantity(dec(produced));
        e.setGoodQuantity(dec(good));
        e.setRejectedQuantity(dec(rej));
        e.setReworkQuantity(dec(rew));
        e.setScrapQuantity(dec(scr));
        return e;
    }

    /** Category A — produced null, ELIGIBLE + resolvable, WIP left when good < process. */
    private ProductionEntry catA(String en, String process, String good) {
        ProductionEntry e = base(en);
        e.setProcessQty(dec(process));
        e.setGoodQuantity(dec(good));
        return e;
    }

    /** Category B — process null, produced present -> QUARANTINE (the live PE/2026-27/00001 shape). */
    private ProductionEntry catB(String en, String produced, String good) {
        ProductionEntry e = base(en);
        e.setProducedQuantity(dec(produced));
        e.setGoodQuantity(dec(good));
        return e;
    }

    /** Category A over-allocation -> BLOCK (allocated good > process). */
    private ProductionEntry blockEntry(String en, String process, String good) {
        ProductionEntry e = base(en);
        e.setProcessQty(dec(process));
        e.setGoodQuantity(dec(good));
        return e;
    }

    private BigDecimal dec(String s) {
        return s == null ? null : new BigDecimal(s);
    }

    // --------------------------------------------------------------- tests

    @Test
    @DisplayName("1/11/12: eligible Category C record projects session+op+outputs with resolver input and correct WIP")
    void eligibleRecordProjectionWithReconciliation() {
        ProductionEntry e = productionEntries.save(catC("PE-C", "100", "100", "90", "5", "3", "2"));

        BackfillRunResult r = backfill.backfill("JOB-ELIG", false, "tester");

        assertTrue(r.isExecutionGateOpen());
        assertEquals(1L, r.projectedCount());
        assertEquals("PASS", r.getReconciliation());

        ProdExecutionSession s = sessionRepo.findByEntryNumber("PE-C").orElseThrow();
        assertEquals(0, new BigDecimal("100").compareTo(s.getAvailableInput()));
        assertEquals(0, new BigDecimal("90").compareTo(s.getAcceptedOutput()));
        assertEquals(0, new BigDecimal("5").compareTo(s.getRejected()));
        assertEquals(0, new BigDecimal("3").compareTo(s.getRework()));
        assertEquals(0, new BigDecimal("2").compareTo(s.getScrap()));
        // wip = 100 - (90+5+3+2) = 0; never negative
        assertEquals(0, BigDecimal.ZERO.compareTo(s.getWip()));

        // one operation + four outputs
        assertEquals(1L, countWhere("prod_operation_event", "session_id=" + s.getId()));
        assertEquals(4L, countWhere("prod_output_event", "session_id=" + s.getId()));
    }

    @Test
    @DisplayName("12: WIP uses resolver EffectiveInputQuantity (process), never produced or silent zero (Category A)")
    void wipUsesResolverEffectiveInput() {
        // process=100, produced=null, good=90 -> ELIGIBLE, input authority = process_qty = 100, wip = 10
        ProductionEntry e = productionEntries.save(catA("PE-A", "100", "90"));

        BackfillRunResult r = backfill.backfill("JOB-WIP", false, "tester");
        assertEquals(1L, r.projectedCount());

        ProdExecutionSession s = sessionRepo.findByEntryNumber("PE-A").orElseThrow();
        assertEquals(0, new BigDecimal("100").compareTo(s.getAvailableInput()), "input from resolver (process), not silent zero");
        assertEquals(0, new BigDecimal("10").compareTo(s.getWip()), "WIP = input - good = 10");
    }

    @Test
    @DisplayName("2/13/14: Category B is quarantined — no session, null effective input, never projected, never produced-to-process")
    void categoryBQuarantinedNeverProjected() {
        ProductionEntry e = productionEntries.save(catB("PE/2026-27/00001", "100", "90"));

        assertEquals("INPUT-AUTHORITY-NULL", resolver.resolve(e).getReasonCode());
        assertFalse(resolver.resolve(e).isResolvable());

        BackfillRunResult r = backfill.backfill("JOB-B", false, "tester");
        assertEquals(1L, r.quarantinedCount());
        assertEquals(0L, r.projectedCount());
        assertEquals("PASS", r.getReconciliation());

        assertTrue(sessionRepo.findByEntryNumber("PE/2026-27/00001").isEmpty(), "no normalized event for Category B");

        BackfillEntryDecision d = r.getEntries().get(0);
        assertNull(d.getEffectiveInput(), "Category B must never report a fabricated effective input");
        assertEquals("QUARANTINE", d.getEligibility());
        assertEquals("AMBIGUOUS", d.getAuthority());
        assertEquals("INPUT-AUTHORITY-NULL", d.getReasonCode());
    }

    @Test
    @DisplayName("3: BLOCK record halts the run (stop-on-block); never projected, never continued as valid")
    void blockStopsRun() {
        // Category A over-allocation (good 20 > process 10) -> BLOCK, saved first so it is scanned first by id.
        ProductionEntry blockEntry = productionEntries.save(blockEntry("PE-BLOCK", "10", "20"));
        // A genuinely eligible record AFTER the block must NOT be processed once the run halts.
        ProductionEntry after = productionEntries.save(catC("PE-AFTER", "50", "50", "45", "0", "0", "0"));

        BackfillRunResult r = backfill.backfill("JOB-BLOCK", false, "tester");

        assertEquals("BLOCKED", r.getEntries().get(0).getOutcome());
        assertTrue(r.isStoppedOnBlock(), "stop-on-block policy must halt the run");
        assertEquals(1L, r.blockedCount());
        assertEquals(0L, r.projectedCount());

        assertTrue(sessionRepo.findByEntryNumber(blockEntry.getEntryNumber()).isEmpty(),
                "blocked record must create no normalized event");
        assertTrue(sessionRepo.findByEntryNumber(after.getEntryNumber()).isEmpty(),
                "entries after a BLOCK must not be processed (run halted)");

        assertEquals("FAILED", progressState("JOB-BLOCK").getStatus(), "blocked job ends FAILED, never COMPLETED");
    }

    @Test
    @DisplayName("4: engine correctly processes zero eligible records today (only Category B present)")
    void zeroEligibleRecords() {
        ProductionEntry b = productionEntries.save(catB("PE/2026-27/00001", "100", "90"));

        BackfillRunResult r = backfill.backfill("JOB-ZERO", false, "tester");
        assertEquals(0L, r.projectedCount());
        assertEquals(1L, r.quarantinedCount());
        assertEquals("PASS", r.getReconciliation());
        assertTrue(sessionRepo.findByEntryNumber(b.getEntryNumber()).isEmpty());
    }

    @Test
    @DisplayName("5/6: idempotent replay across fresh jobs is ALREADY_PROJECTED; no duplicate session/op/output")
    void idempotentReplayAlreadyProjected() {
        ProductionEntry e = productionEntries.save(catC("PE-IDEM", "100", "100", "90", "0", "0", "0"));

        BackfillRunResult first = backfill.backfill("JOB-1", false, "tester");
        assertEquals(1L, first.projectedCount());
        Long sessionId = idOf(e.getEntryNumber());
        assertEquals(1L, countWhere("prod_operation_event", "session_id=" + sessionId));
        assertEquals(1L, countWhere("prod_output_event", "session_id=" + sessionId));

        // A distinct job over the same legacy scope must not re-emit events.
        BackfillRunResult second = backfill.backfill("JOB-2", false, "tester");
        assertEquals(1L, second.alreadyProjectedCount());
        assertEquals(1L, second.projectedCount() + second.alreadyProjectedCount());

        assertEquals(1L, countWhere("prod_execution_session", "entry_number='PE-IDEM'"), "no duplicate session");
        assertEquals(1L, countWhere("prod_operation_event", "session_id=" + sessionId), "no duplicate operation");
        assertEquals(1L, countWhere("prod_output_event", "session_id=" + sessionId), "no duplicate output");
    }

    @Test
    @DisplayName("5b: re-running the SAME job skips committed watermarked work (no duplicate, no reprocess)")
    void sameJobRerunNoDuplicates() {
        ProductionEntry a = productionEntries.save(catC("PE-R1", "10", "10", "9", "0", "0", "0"));
        ProductionEntry b = productionEntries.save(catC("PE-R2", "20", "20", "18", "0", "0", "0"));

        backfill.backfill("JOB-SAME", false, "tester");
        BackfillRunResult again = backfill.backfill("JOB-SAME", false, "tester");

        assertTrue(again.getEntries().isEmpty(), "committed watermark work must be skipped on same-job re-run");
        assertEquals(1L, countWhere("prod_execution_session", "entry_number='PE-R1'"));
        assertEquals(1L, countWhere("prod_execution_session", "entry_number='PE-R2'"));
        assertEquals(2L, count("prod_execution_session"));
    }

    @Test
    @DisplayName("7: progress advances — processed/success/quarantine counts, status COMPLETED, watermark set")
    void progressAdvancement() {
        ProductionEntry c = productionEntries.save(catC("PE-P1", "10", "10", "9", "0", "0", "0"));
        ProductionEntry b = productionEntries.save(catB("PE-P2", "5", "4"));

        backfill.backfill("JOB-PROG", false, "tester");

        ProdBackfillProgress p = progressState("JOB-PROG");
        assertEquals("COMPLETED", p.getStatus());
        assertEquals("PASS", p.getReconciliationStatus());
        assertEquals(2L, p.getProcessedCount());
        assertEquals(1L, p.getSuccessCount());
        assertEquals(1L, p.getQuarantineCount());
        assertEquals(0L, p.getFailureCount());
        assertEquals(c.getId(), p.getLastSuccessfulEntryId(), "watermark advances across committed entries");
    }

    @Test
    @DisplayName("8/9: crash recovery — resume from last_successful_entry_id reprocesses only the uncommitted tail without duplicates")
    void crashRecoveryResumeFromWatermark() {
        ProductionEntry a = productionEntries.save(catC("PE-A", "10", "10", "9", "0", "0", "0"));
        ProductionEntry b = productionEntries.save(catC("PE-B", "20", "20", "18", "0", "0", "0"));

        // Simulate a crash: the job is started/claimed and entry A was committed, then the
        // process died before reaching B. A's projection + outcome + watermark are persisted.
        progress.startJob("JOB-CRASH", null);
        progress.claim("JOB-CRASH");
        processor.projectEligible("JOB-CRASH", a, resolver.resolve(a), 1L);

        assertEquals(a.getId(), progress.resumeFrom("JOB-CRASH"), "resume watermark is A.id");

        // Re-invoking the engine resumes after A and only handles the uncommitted tail (B).
        BackfillRunResult r = backfill.backfill("JOB-CRASH", false, "tester");

        assertEquals(1L, countWhere("prod_execution_session", "entry_number='PE-A'"), "A committed exactly once");
        assertEquals(1L, countWhere("prod_execution_session", "entry_number='PE-B'"), "tail B processed exactly once");
        assertEquals(2L, count("prod_execution_session"), "no duplicate session (no re-emission of A)");
        assertTrue(r.getEntries().stream().anyMatch(d -> "PE-B".equals(d.getEntryNumber())),
                "resumed run processed only the uncommitted tail B");
        assertEquals("COMPLETED", progressState("JOB-CRASH").getStatus());
    }

    @Test
    @DisplayName("10: per-entry writes are atomic — a REQUIRES_NEW failure leaves NO partial projection")
    void perEntryTransactionRollback() {
        // The real REQUIRES_NEW rollback-atomicity proof (writes + outcome + progress all
        // succeed-or-fail together) lives in ProductionBackfillRollbackAtomicityTest where a
        // failure is injected inside the entry transaction. Here we guard the invariant that
        // the processor refuses non-resolvable input and persists nothing.
        ProductionEntry e = productionEntries.save(catB("PE-FAB", "100", "90"));
        InputResolutionResult res = resolver.resolve(e); // QUARANTINE, not resolvable
        assertThrows(IllegalStateException.class,
                () -> processor.projectEligible("JOB-FAB", e, res, 1L));
        assertFalse(sessionRepo.findByEntryNumber("PE-FAB").isPresent());
        assertTrue(outcomeRepo.findByJobIdAndEntryNumber("JOB-FAB", "PE-FAB").isEmpty());
    }

    @Test
    @DisplayName("15: inventory isolation — stock_ledger / stock_balance counts unchanged by the engine")
    void inventoryIsolation() {
        long ledgerBefore = count("stock_ledger");
        long balanceBefore = count("stock_balance");

        productionEntries.save(catC("PE-INV", "100", "100", "90", "0", "0", "0"));

        BackfillRunResult r = backfill.backfill("JOB-INV", false, "tester");
        assertTrue(r.isInventoryIsolationProven());

        assertEquals(ledgerBefore, count("stock_ledger"), "backfill must never write stock_ledger");
        assertEquals(balanceBefore, count("stock_balance"), "backfill must never write stock_balance");
    }

    @Test
    @DisplayName("16: legacy production_entry is never modified by the backfill engine")
    void legacyProductionEntryUnchanged() {
        ProductionEntry e = productionEntries.save(catB("PE/2026-27/00001", "100", "90"));
        Long id = e.getId();

        backfill.backfill("JOB-LEGACY", false, "tester");

        ProductionEntry reloaded = productionEntries.findById(id).orElseThrow();
        assertNull(reloaded.getProcessQty(), "legacy process_qty untouched");
        assertEquals(0, new BigDecimal("100").compareTo(reloaded.getProducedQuantity()), "legacy produced_quantity untouched");
        assertEquals(0, new BigDecimal("90").compareTo(reloaded.getGoodQuantity()), "legacy good_quantity untouched");
        assertEquals("POSTED", reloaded.getStatus(), "legacy status untouched");
        assertEquals(1L, count("production_entry"), "no legacy row added or removed");
    }

    @Test
    @DisplayName("18: manual/authorized invocation — dry-run writes nothing; real run is an explicit manual call")
    void manualInvocationAndDryRun() {
        ProductionEntry c = productionEntries.save(catC("PE-MAN", "10", "10", "9", "0", "0", "0"));

        // Dry-run is read-only: classifies but writes no progress, no outcome, no events.
        BackfillRunResult dry = backfill.backfill("JOB-DRY", true, "tester");
        assertTrue(dry.isDryRun());
        assertEquals(1L, dry.projectedCount());
        assertTrue(progressRepo.findByJobId("JOB-DRY").isEmpty(), "dry-run must not create a progress row");
        assertTrue(outcomeRepo.findByJobId("JOB-DRY").isEmpty(), "dry-run must not create outcomes");
        assertTrue(sessionRepo.findByEntryNumber("PE-MAN").isEmpty(), "dry-run must not create events");

        // Real run is an explicit manual call (dryRun=false) with an actor.
        BackfillRunResult real = backfill.backfill("JOB-MAN", false, "tester");
        assertFalse(real.isDryRun());
        assertEquals(1L, real.projectedCount());
        assertTrue(sessionRepo.findByEntryNumber("PE-MAN").isPresent());
    }

    @Test
    @DisplayName("19: rollback removes ONLY backfill-created prod_* rows; legacy and stock are untouched")
    void rollbackScopedToBackfillRows() {
        long stockLedgerBefore = count("stock_ledger");
        long stockBalanceBefore = count("stock_balance");

        ProductionEntry c = productionEntries.save(catC("PE-RB", "10", "10", "9", "0", "0", "0"));
        ProductionEntry b = productionEntries.save(catB("PE-RB-B", "5", "4"));

        BackfillRunResult r = backfill.backfill("JOB-RB", false, "tester");
        assertEquals(1L, r.projectedCount());
        Long sessionId = idOf("PE-RB");
        assertEquals(1L, countWhere("prod_operation_event", "session_id=" + sessionId));

        backfill.rollback("JOB-RB");

        assertEquals(0L, countWhere("prod_execution_session", "entry_number='PE-RB'"), "projected session removed");
        assertEquals(0L, countWhere("prod_operation_event", "session_id=" + sessionId), "cascading op removed");
        assertEquals(0L, countWhere("prod_output_event", "session_id=" + sessionId), "cascading outputs removed");
        // Category B created no events, so rollback removes nothing for it — but outcome retained as audit.
        assertEquals(1L, outcomeRepo.findByJobIdAndEntryNumber("JOB-RB", "PE-RB-B").map(o -> 1L).orElse(0L),
                "outcome audit retained");

        assertEquals(2L, count("production_entry"), "legacy rows untouched by rollback");
        assertEquals(stockLedgerBefore, count("stock_ledger"), "rollback never touches stock_ledger");
        assertEquals(stockBalanceBefore, count("stock_balance"), "rollback never touches stock_balance");
        assertEquals("ROLLED_BACK", progressState("JOB-RB").getStatus());
    }

    // --------------------------------------------------------------- helpers

    private long idOf(String entryNumber) {
        return sessionRepo.findByEntryNumber(entryNumber).orElseThrow().getId();
    }

    private ProdBackfillProgress progressState(String jobId) {
        return progressRepo.findByJobId(jobId).orElseThrow();
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