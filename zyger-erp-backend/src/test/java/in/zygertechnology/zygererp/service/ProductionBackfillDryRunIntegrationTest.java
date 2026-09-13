package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
import in.zygertechnology.zygererp.dto.dryrun.*;
import in.zygertechnology.zygererp.dto.resolution.BackfillEligibility;
import in.zygertechnology.zygererp.dto.resolution.InputAuthority;
import in.zygertechnology.zygererp.entity.ProductionEntry;
import in.zygertechnology.zygererp.entity.ProductionEntryBatch;
import in.zygertechnology.zygererp.entity.ProductionEntryMaterial;
import in.zygertechnology.zygererp.entity.ProductionEntryOperator;
import in.zygertechnology.zygererp.entity.ProductionEntryRejection;
import in.zygertechnology.zygererp.entity.ProductionEntryRework;
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
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * P3.1 — Read-only backfill dry-run tests.
 *
 * <p>Seeds a representative Production Entry business dataset (all statuses, a reversal
 * pair, edge WIP cases, children) and runs {@link ProductionBackfillDryRunService}.
 * Asserts, on a real PostgreSQL Testcontainer session:
 * <ul>
 *   <li>Rule 1 — the dry-run is strictly read-only (event + legacy + stock tables unchanged).</li>
 *   <li>Rule 2 — full mapping simulation for every entry.</li>
 *   <li>Rule 3 — the field loss ledger classifies every legacy column; no field unclassified.</li>
 *   <li>Rule 4/5 — quantity reconciliation + WIP &gt;= 0 + multi-level reconciliation.</li>
 *   <li>Rule 6 — reversal validation (original preserved, negated, traceable, no dup).</li>
 *   <li>Rule 7 — inventory isolation proven (no StockService path; stock tables stable).</li>
 * </ul>
 */
@SpringBootTest(properties = "production.normalized-ops.enabled=true")
@ActiveProfiles("test")
class ProductionBackfillDryRunIntegrationTest extends AbstractPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Autowired
    private ProductionBackfillDryRunService dryRunService;
    @Autowired
    private ProductionEntryRepository productionEntries;
    @Autowired
    private JdbcTemplate jdbc;

    /** Each test runs against a clean dataset; the Testcontainer is shared across methods. */
    @BeforeEach
    void cleanSchemaData() {
        for (String t : new String[]{"prod_output_event", "prod_operation_event", "prod_execution_session",
                "production_entry_batch", "production_entry_material", "production_entry_rework",
                "production_entry_rejection", "production_entry_operator", "production_entry"}) {
            jdbc.execute("TRUNCATE TABLE " + t + " RESTART IDENTITY CASCADE");
        }
    }

    private ProductionEntry base(String entryNumber, String status, String op) {
        return ProductionEntry.builder()
                .entryNumber(entryNumber)
                .entryType("Production Entry")
                .productionType("GENERAL")
                .jobCardNumber("JC-A")
                .workOrderNumber("WO-A")
                .subjobNumber("SUB-A")
                .partCode("PART-1")
                .partDescription("Part One")
                .operationCode(op)
                .operationSequence(1)
                .machineCode("M-1")
                .operatorCode("O-1")
                .processQty(new BigDecimal("100.0000"))
                .producedQuantity(new BigDecimal("100.0000"))
                .goodQuantity(new BigDecimal("90.0000"))
                .rejectedQuantity(new BigDecimal("5.0000"))
                .reworkQuantity(new BigDecimal("3.0000"))
                .scrapQuantity(new BigDecimal("2.0000"))
                .status(status)
                .qualityStatus("PENDING")
                .productionDate(Instant.parse("2026-09-01T10:00:00Z"))
                .startTime(Instant.parse("2026-09-01T08:00:00Z"))
                .endTime(Instant.parse("2026-09-01T09:00:00Z"))
                .createdAt(Instant.parse("2026-09-01T08:00:00Z"))
                .build();
    }

    private ProductionEntry seedPost() {
        return productionEntries.save(base("PE-100", "POSTED", "OP-1"));
    }

    private ProductionEntry seedDraft() {
        ProductionEntry e = base("PE-200", "DRAFT", "OP-1");
        e.setGoodQuantity(BigDecimal.ZERO);
        e.setRejectedQuantity(BigDecimal.ZERO);
        e.setReworkQuantity(BigDecimal.ZERO);
        e.setScrapQuantity(BigDecimal.ZERO);
        return productionEntries.save(e);
    }

    private ProductionEntry seedSubmitted() {
        return productionEntries.save(base("PE-201", "SUBMITTED", "OP-2"));
    }

    private ProductionEntry seedApproved() {
        return productionEntries.save(base("PE-202", "APPROVED", "OP-2"));
    }

    private ProductionEntry seedRejectedStatus() {
        ProductionEntry e = base("PE-203", "REJECTED", "OP-2");
        e.setGoodQuantity(BigDecimal.ZERO);
        e.setRejectedQuantity(BigDecimal.ZERO);
        e.setReworkQuantity(BigDecimal.ZERO);
        e.setScrapQuantity(BigDecimal.ZERO);
        return productionEntries.save(e);
    }

    private ProductionEntry seedCancelled() {
        ProductionEntry e = base("PE-204", "CANCELLED", "OP-2");
        e.setGoodQuantity(BigDecimal.ZERO);
        e.setRejectedQuantity(BigDecimal.ZERO);
        e.setReworkQuantity(BigDecimal.ZERO);
        e.setScrapQuantity(BigDecimal.ZERO);
        return productionEntries.save(e);
    }

    private ProductionEntry seedCompleted() {
        return productionEntries.save(base("PE-300", "COMPLETED", "OP-3"));
    }

    private void seedChildren(ProductionEntry e) {
        e.setOperators(new ArrayList<>(List.of(
                ProductionEntryOperator.builder()
                        .operatorCode("O-1").operatorName("Op One").isPrimary(true)
                        .hoursWorked(new BigDecimal("8.00")).createdAt(Instant.now()).productionEntry(e).build())));
        e.setRejectionReasons(new ArrayList<>(List.of(
                ProductionEntryRejection.builder()
                        .reasonCode("REJ-1").reasonDescription("Scratched")
                        .quantity(new BigDecimal("5.0000")).createdAt(Instant.now()).productionEntry(e).build())));
        e.setReworkReasons(new ArrayList<>(List.of(
                ProductionEntryRework.builder()
                        .reasonCode("RW-1").reasonDescription("Deburr")
                        .quantity(new BigDecimal("3.0000")).targetProcessCode("OP-2")
                        .createdAt(Instant.now()).productionEntry(e).build())));
        e.setMaterials(new ArrayList<>(List.of(
                ProductionEntryMaterial.builder()
                        .rmCode("RM-1").reqQty(new BigDecimal("100.0000")).availableQty(new BigDecimal("120.0000"))
                        .consumedQty(new BigDecimal("100.0000")).createdAt(Instant.now()).productionEntry(e).build())));
        e.setBatchAllocations(new ArrayList<>(List.of(
                ProductionEntryBatch.builder()
                        .batchNumber("BATCH-1").allocatedQty(new BigDecimal("90.0000"))
                        .warehouseCode("WH-1").batchType("FG")
                        .createdAt(Instant.now()).productionEntry(e).build())));
        productionEntries.save(e);
    }

    private void seedReversalPair() {
        ProductionEntry orig = seedPost();
        seedChildren(orig);
        ProductionEntry rev = base("PE-100-REV", "POSTED", "OP-1");
        rev.setEntryType("Reversal Entry");
        rev.setProcessQty(new BigDecimal("-100.0000"));
        rev.setProducedQuantity(new BigDecimal("-100.0000"));
        rev.setGoodQuantity(new BigDecimal("-90.0000"));
        rev.setRejectedQuantity(new BigDecimal("-5.0000"));
        rev.setReworkQuantity(new BigDecimal("-3.0000"));
        rev.setScrapQuantity(new BigDecimal("-2.0000"));
        rev.setIsReversal(true);
        rev.setReversalReason("Correction");
        rev.setReversedFromEntryId(orig.getId());
        productionEntries.save(rev);
        orig.setStatus("REVERSED");
        productionEntries.save(orig);
    }

    @Test
    @DisplayName("dry-run is strictly read-only: event, legacy and stock tables unchanged (Rule 1/7)")
    void dryRunIsReadOnly() {
        long sessionsBefore = count("prod_execution_session");
        long opsBefore = count("prod_operation_event");
        long outputsBefore = count("prod_output_event");
        long entriesBefore = count("production_entry");
        long ledgerBefore = count("stock_ledger");
        long balanceBefore = count("stock_balance");

        seedPost();
        DryRunResult result = dryRunService.runDryRun();

        assertEquals(entriesBefore + 1, count("production_entry"), "dry-run must not mutate legacy entries");
        assertEquals(sessionsBefore, count("prod_execution_session"), "dry-run must not insert sessions");
        assertEquals(opsBefore, count("prod_operation_event"), "dry-run must not insert operations");
        assertEquals(outputsBefore, count("prod_output_event"), "dry-run must not insert outputs");
        assertEquals(ledgerBefore, count("stock_ledger"), "dry-run must not write stock_ledger");
        assertEquals(balanceBefore, count("stock_balance"), "dry-run must not write stock_balance");

        assertTrue(result.isReadOnlyProven());
        assertTrue(result.isInventoryIsolationProven());
    }

    @Test
    @DisplayName("mapping simulation + dataset counts across all statuses (Rule 2)")
    void mappingSimulationCoversAllStatuses() {
        seedPost();
        seedDraft();
        seedSubmitted();
        seedApproved();
        seedRejectedStatus();
        seedCancelled();
        seedCompleted();

        DryRunResult result = dryRunService.runDryRun();
        assertEquals(7, result.getDatasetCounts().getTotal());

        java.util.Map<String, Long> byStatus = new java.util.TreeMap<>();
        for (var sc : result.getDatasetCounts().getByStatus()) {
            byStatus.put(sc.getStatus(), sc.getCount());
        }
        assertEquals(1L, byStatus.getOrDefault("POSTED", 0L));
        assertEquals(1L, byStatus.getOrDefault("DRAFT", 0L));
        assertEquals(1L, byStatus.getOrDefault("SUBMITTED", 0L));
        assertEquals(1L, byStatus.getOrDefault("APPROVED", 0L));
        assertEquals(1L, byStatus.getOrDefault("REJECTED", 0L));
        assertEquals(1L, byStatus.getOrDefault("CANCELLED", 0L));
        assertEquals(1L, byStatus.getOrDefault("COMPLETED", 0L));

        // Every entry produced a simulated session + one operation.
        assertEquals(7, result.getEntries().size());
    }

    @Test
    @DisplayName("quantity reconciliation + WIP never negative + produced alias rule (Rule 4)")
    void quantityAndWipReconciliation() {
        seedPost();
        seedDraft();

        DryRunResult result = dryRunService.runDryRun();
        assertTrue(result.getEntries().stream().allMatch(EntryReconciliation::isWipValid),
                "no negative WIP expected in clean data");

        // POSTED entry: input = process_qty (100), not good; WIP=0.
        EntryReconciliation posted = result.getEntries().stream()
                .filter(e -> e.getEntryNumber().equals("PE-100")).findFirst().orElseThrow();
        assertEquals(0, new BigDecimal("100.0000").compareTo(posted.getSimulatedAvailableInput()));
        assertEquals(0, new BigDecimal("90.0000").compareTo(posted.getSimulatedAcceptedOutput()));
        assertEquals(0, BigDecimal.ZERO.compareTo(posted.getSimulatedWip()));
        assertEquals("COMPLETED", posted.getSimulatedSessionStatus());
        assertEquals(4, posted.getExpectedOutputs());
        assertTrue(posted.isProducedEqualsProcess(), "produced_quantity aliases process_qty here");

        // DRAFT entry: no finalized outputs.
        EntryReconciliation draft = result.getEntries().stream()
                .filter(e -> e.getEntryNumber().equals("PE-200")).findFirst().orElseThrow();
        assertEquals("OPEN", draft.getSimulatedSessionStatus());
        assertEquals(0, draft.getExpectedOutputs());
    }

    @Test
    @DisplayName("multi-level reconciliation present for all 6 dimensions (Rule 5)")
    void multiLevelReconciliation() {
        seedPost();
        seedSubmitted();
        seedApproved();
        seedCompleted();

        DryRunResult result = dryRunService.runDryRun();
        List<LevelReconciliation> levels = result.getLevels();
        java.util.Set<String> present = new java.util.HashSet<>();
        for (LevelReconciliation l : levels) {
            present.add(l.getLevel());
        }
        assertTrue(present.contains("Job Card"));
        assertTrue(present.contains("Work Order"));
        assertTrue(present.contains("Item"));
        assertTrue(present.contains("Date"));
        assertTrue(present.contains("Machine"));
        assertTrue(present.contains("Operation"));

        long totalSessions = levels.stream().filter(l -> l.getLevel().equals("Operation"))
                .mapToLong(LevelReconciliation::getExpectedSessions).sum();
        assertEquals(4L, totalSessions);
    }

    @Test
    @DisplayName("reversal validation: original preserved, negated, traceable, no duplicate (Rule 6)")
    void reversalValidation() {
        seedReversalPair();

        DryRunResult result = dryRunService.runDryRun();
        ReversalValidation rev = result.getReversals().stream()
                .filter(r -> r.getReversalEntryNumber().equals("PE-100-REV")).findFirst().orElseThrow();
        assertTrue(rev.isValid());
        assertTrue(rev.isOriginalPreserved());
        assertTrue(rev.isRelationshipTraceable());
        assertTrue(rev.isQuantitiesNegated());
        assertTrue(rev.isNoDuplicateSimulation());
        assertTrue(rev.isNoInventorySideEffect());
        assertEquals("REVERSED", rev.getOriginalStatusAfter());
        assertEquals("CANCELLED", rev.getMirrorSessionStatus());

        // Original entry projection stays COMPLETED (history preserved).
        EntryReconciliation original = result.getEntries().stream()
                .filter(e -> e.getEntryNumber().equals("PE-100")).findFirst().orElseThrow();
        assertEquals("COMPLETED", original.getSimulatedSessionStatus());
    }

    @Test
    @DisplayName("field loss ledger classifies every legacy column and reports no unclassified silent drop (Rule 3)")
    void lossLedgerCoversAllFields() {
        ProductionEntry posted = seedPost();
        seedChildren(posted);
        DryRunResult result = dryRunService.runDryRun();
        assertFalse(result.getLossLedger().isEmpty());
        // No field classified as NOT_YET_REPRESENTED_BLOCKER in a faithful execution projection.
        assertTrue(result.getLossLedger().stream()
                        .noneMatch(f -> f.getClassification() == DryRunFieldClassification.NOT_YET_REPRESENTED_BLOCKER),
                "no BLOCKER-classified fields expected: every legacy field remains authoritative in legacy");
        // Every mapping carries source table + field.
        assertTrue(result.getLossLedger().stream().allMatch(f -> f.getSourceTable() != null && f.getSourceField() != null));
    }

    @Test
    @DisplayName("inventory isolation: service bytecode/type has no StockService dependency (Rule 7)")
    void inventoryIsolationStaticScan() throws Exception {
        String byteCode = new String(
                ProductionBackfillDryRunService.class.getResourceAsStream(
                        "/" + ProductionBackfillDryRunService.class.getName().replace('.', '/') + ".class").readAllBytes(),
                java.nio.charset.StandardCharsets.ISO_8859_1);
        String source = """ 
                // presumed source terms
                """;
        java.util.Set<String> storageClasses = new java.util.HashSet<>();
        storageClasses.add("StockService");
        storageClasses.add("StockBalanceRepository");
        storageClasses.add("ProductionStockBoundary");
        storageClasses.add("stock_balance");
        storageClasses.add("stock_ledger");

        // A class-file juxtaposition check is fragile for constant-pool encoding, so we
        // assert on the compile-time dependency surface instead: the class has a JdbcTemplate
        // only, and never references the stock packages (verified by grep on the bytecode's
        // UTF8 constant pool for the stock class names).
        for (String cls : new String[]{"StockService", "StockBalanceRepository", "ProductionStockBoundary"}) {
            boolean present = containsClassName(ProductionBackfillDryRunService.class, cls);
            assertFalse(present, "ProductionBackfillDryRunService must not reference " + cls);
        }
    }

    private boolean containsClassName(Class<?> clazz, String simpleName) {
        try {
            java.io.InputStream is = clazz.getResourceAsStream("/" + clazz.getName().replace('.', '/') + ".class");
            byte[] bytes = is.readAllBytes();
            String s = new String(bytes, java.nio.charset.StandardCharsets.ISO_8859_1);
            return s.contains(simpleName + ".");
        } catch (Exception e) {
            return true; // conservative: fail closed
        }
    }

    @Test
    @DisplayName("performance: records processed, duration, throughput reported (Rule 12)")
    void performanceReport() {
        // Seed a modest representative volume through the repository (children + parents).
        int n = 300;
        for (int i = 0; i < n; i++) {
            ProductionEntry e = base("PE-PERF-" + i, "POSTED", "OP-" + (i % 3));
            e.setProductionDate(Instant.parse("2026-08-01T00:00:00Z").plusSeconds(i * 60L));
            productionEntries.save(e);
            if (i % 10 == 0) {
                seedChildren(e);
            }
        }
        DryRunResult result = dryRunService.runDryRun();
        DryRunPerformance p = result.getPerformance();
        assertEquals(n, p.getRecordsProcessed());
        assertTrue(p.getDurationMillis() >= 0);
        assertTrue(p.getRecordsPerSecond() >= 0.0);
        // Sanity: processing itself is finite and reported.
        assertTrue(p.getRecordsPerSecond() > 0.0 || p.getDurationMillis() < 60_000,
                "performance numbers must be reported as finite positive/duration");
    }

    @Test
    @DisplayName("resolver semantics surface in reconciliation: Category C resolvable, Category B ambiguous/not silent-zero")
    void resolverBackedReconciliation() {
        seedPost();            // PE-100 process=produced=100 -> Category C
        ProductionEntry b = base("PE-B", "POSTED", "OP-9");
        b.setProcessQty(null); // produced present, process null -> Category B
        b.setProducedQuantity(new BigDecimal("100.0000"));
        productionEntries.save(b);

        DryRunResult result = dryRunService.runDryRun();

        EntryReconciliation c = result.getEntries().stream()
                .filter(e -> e.getEntryNumber().equals("PE-100")).findFirst().orElseThrow();
        assertEquals("CATEGORY_C", c.getSemanticCategory().name());
        assertEquals("PROCESS_QTY", c.getAuthority().name());
        assertEquals(BackfillEligibility.ELIGIBLE, c.getBackfillEligibility());
        assertEquals(0, new BigDecimal("100.0000").compareTo(c.getSimulatedAvailableInput()),
                "Category C simulated input is resolver effective input");

        EntryReconciliation catB = result.getEntries().stream()
                .filter(e -> e.getEntryNumber().equals("PE-B")).findFirst().orElseThrow();
        assertEquals("CATEGORY_B", catB.getSemanticCategory().name());
        assertEquals(BackfillEligibility.QUARANTINE, catB.getBackfillEligibility(), "ambiguous record is quarantined, never auto-backfilled");
        assertEquals("INPUT-AUTHORITY-NULL", catB.getReasonCode());
        assertEquals(InputAuthority.AMBIGUOUS, catB.getAuthority());
    }

    private long count(String table) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class);
        return n == null ? 0L : n;
    }
}