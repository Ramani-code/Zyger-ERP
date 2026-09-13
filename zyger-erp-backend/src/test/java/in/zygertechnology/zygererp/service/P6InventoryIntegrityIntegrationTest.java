package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
import in.zygertechnology.zygererp.entity.DocEntity;
import in.zygertechnology.zygererp.entity.JobCard;
import in.zygertechnology.zygererp.entity.ProdReqMaterial;
import in.zygertechnology.zygererp.entity.ProdReqMaterialLine;
import in.zygertechnology.zygererp.entity.ProductionConsumption;
import in.zygertechnology.zygererp.entity.ProductionConsumptionLine;
import in.zygertechnology.zygererp.entity.StockAllotment;
import in.zygertechnology.zygererp.entity.StockLedger;
import in.zygertechnology.zygererp.entity.StockBalance;
import in.zygertechnology.zygererp.repo.JobCardRepository;
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
 * P6.2 (ADR-001 Model B-a) — cross-document inventory integrity.
 *
 * <p>Proves, against a real PostgreSQL Testcontainer, that the Material Request ISSUE
 * creates only a reservation (no physical OUT) and the Consumption POST performs exactly
 * one physical OUT after atomically releasing the reservation:</p>
 *
 * <pre>
 *   Initial  onHand(RM-001)  = 100      FREE
 *   ISSUE    reserved         = 100      onHand unchanged = 100, available = 0 (Effect.NONE)
 *   POST     release + OUT    =   90     onHand = 10, available = 10, ONE ledger OUT row
 *   Final    onHand(RM-001)  = 10
 * </pre>
 *
 * <p>The ledger must contain exactly one RM-001 OUT (docType {@code production-consumption}),
 * and no {@code material-request} OUT row — i.e. no double deduction.</p>
 */
@SpringBootTest
@ActiveProfiles("test")
class P6InventoryIntegrityIntegrationTest extends AbstractPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Autowired private ProductionMaterialRequestService materialRequestService;
    @Autowired private ProductionConsumptionService consumptionService;
    @Autowired private StockService stockService;
    @Autowired private DocumentFacade documents;
    @Autowired private JobCardRepository jobCards;
    @Autowired private LedgerRepository ledger;
    @Autowired private StockBalanceRepository balances;
    @Autowired private JdbcTemplate jdbc;

    private static final String ITEM = "RM-001";
    private static final String LOC = "MAIN";
    private static final String BATCH = "B-01";
    private static final String USER = "integration-prod-operator";

    private JobCard jobCard;

    @BeforeEach
    void clean() {
        for (String t : new String[]{
                "prod_consumption_line", "prod_consumption",
                "prod_req_material_line", "prod_req_material",
                "stock_allotment_line", "stock_allotment",
                "stock_release_line", "stock_release",
                "stock_ledger", "stock_balance", "job_card"}) {
            jdbc.execute("TRUNCATE TABLE " + t + " CASCADE");
        }
        jobCard = jobCards.save(JobCard.builder()
                .jobCardNumber("JC-P6-INTEG")
                .workOrderNumber("WO-P6-INTEG")
                .status("RELEASED")
                .build());
        stockService.recordStockIn("SEED-INTEG-1", "stock-in", "STOCK_IN",
                ITEM, LOC, "B-01", null,
                BigDecimal.valueOf(100), LocalDate.now(), USER, "FREE");
    }

    @Test
    @DisplayName("ISSUE reserves without deducting; POST releases then performs exactly one physical OUT")
    void issueReserves_postReleasesAndSingleOut() {
        // ── Material Request: required 100, issued 100 ──────────────────────────────
        ProdReqMaterialLine line = ProdReqMaterialLine.builder()
                .itemCode(ITEM).requiredQty(new BigDecimal("100"))
                .issuedQty(new BigDecimal("100")).storeCode(LOC).batchNumber(BATCH).uom("KG").build();
        ProdReqMaterial req = materialRequestService.save(
                ProdReqMaterial.builder().jobCardId(jobCard.getId()).lines(List.of(line)).build(), USER);
        materialRequestService.action(req.getId(), "SUBMIT", USER);
        materialRequestService.action(req.getId(), "APPROVE", USER);
        ProdReqMaterial issued = materialRequestService.action(req.getId(), "ISSUE", USER);

        // ── After ISSUE: reservation only, physical stock UNTOUCHED ─────────────────
        assertEquals("ISSUED", issued.getStatus());
        List<DocEntity> allotments = documents.findAll("stock-allotment");
        assertEquals(1, allotments.size(), "ISSUE must create exactly one reservation allotment");
        assertTrue(allotments.get(0) instanceof StockAllotment, "allotment must be a StockAllotment");
        StockAllotment allotment = (StockAllotment) allotments.get(0);
        assertEquals("APPROVED", allotment.getStatus(), "reservation must be active (APPROVED)");
        assertEquals(issued.getReqNo(), allotment.getReferenceNo());

        // No physical deduction at ISSUE: no material-request OUT rows
        long materialRequestOuts = ledger.findAll().stream()
                .filter(l -> "material-request".equals(l.getDocType())).count();
        assertEquals(0, materialRequestOuts, "ISSUE must NOT create a physical OUT row (reservation only)");

        // Physical balance untouched; reservation reduces available to 0
        assertEquals(100.0, stockService.onHand(ITEM, LOC, null), 0.001, "onHand must stay 100 at ISSUE");
        assertEquals(0.0, stockService.available(ITEM, LOC), 0.001, "available must be 0 while reserved");

        // ── Consumption: issued 100, consumed 90 (posted against the request) ───────
        ProductionConsumptionLine cline = ProductionConsumptionLine.builder()
                .itemCode(ITEM).issuedQty(new BigDecimal("100"))
                .consumedQty(new BigDecimal("90")).location(LOC).batchNumber(BATCH).uom("KG").build();
        ProductionConsumption cons = consumptionService.save(
                ProductionConsumption.builder()
                        .jobCardId(jobCard.getId())
                        .materialRequestNo(issued.getReqNo())
                        .lines(List.of(cline)).build(), USER);
        consumptionService.action(cons.getId(), "SUBMIT", USER);
        ProductionConsumption posted = consumptionService.action(cons.getId(), "POST", USER);

        // ── After POST: single physical OUT ─────────────────────────────────────────
        assertEquals("POSTED", posted.getStatus());

        // Reservation released: allotment now POSTED
        List<DocEntity> afterRelease = documents.findAll("stock-allotment");
        assertEquals(1, afterRelease.size());
        assertEquals("POSTED", afterRelease.get(0).getStatus(), "allotment must be POSTED after consumption");

        // Exactly ONE physical OUT, under production-consumption, qty 90
        List<StockLedger> outs = ledger.findAll().stream()
                .filter(l -> "RM-001".equals(l.getItemCode()) && l.getOutQty() != null && l.getOutQty().signum() > 0)
                .toList();
        assertEquals(1, outs.size(), "must be exactly ONE physical OUT for RM-001");
        StockLedger out = outs.get(0);
        assertEquals("production-consumption", out.getDocType());
        assertEquals("PRODUCTION_CONSUMPTION", out.getTxType());
        assertEquals(0, new BigDecimal("90").compareTo(out.getOutQty()));

        // No material-request OUT row ever created (double deduction absent)
        assertEquals(0, ledger.findAll().stream()
                .filter(l -> "material-request".equals(l.getDocType())).count());

        // Final physical balance = 100 - 90 = 10, fully available
        assertEquals(10.0, stockService.onHand(ITEM, LOC, null), 0.001, "onHand must be 10 after posting 90");
        assertEquals(10.0, stockService.available(ITEM, LOC), 0.001, "available must be 10 after releasing reservation");
        StockBalance balance = balances.findByItemCodeAndLocationAndBatchNoAndHeatNoAndStockStatus(
                ITEM, LOC, "B-01", "", "FREE").orElseThrow();
        assertEquals(0, new BigDecimal("10").compareTo(balance.getQty()), "FREE balance row must reflect 10");
    }

    @Test
    @DisplayName("Consumption posting twice on the same document is blocked (state machine) and never double-deducts")
    void duplicatePostIsBlocked() {
        ProdReqMaterialLine line = ProdReqMaterialLine.builder()
                .itemCode(ITEM).requiredQty(new BigDecimal("100"))
                .issuedQty(new BigDecimal("100")).storeCode(LOC).batchNumber(BATCH).uom("KG").build();
        ProdReqMaterial req = materialRequestService.save(
                ProdReqMaterial.builder().jobCardId(jobCard.getId()).lines(List.of(line)).build(), USER);
        materialRequestService.action(req.getId(), "SUBMIT", USER);
        materialRequestService.action(req.getId(), "APPROVE", USER);
        materialRequestService.action(req.getId(), "ISSUE", USER);

        ProductionConsumptionLine cline = ProductionConsumptionLine.builder()
                .itemCode(ITEM).issuedQty(new BigDecimal("100"))
                .consumedQty(new BigDecimal("90")).location(LOC).batchNumber(BATCH).uom("KG").build();
        ProductionConsumption cons = consumptionService.save(
                ProductionConsumption.builder()
                        .jobCardId(jobCard.getId())
                        .materialRequestNo(req.getReqNo())
                        .lines(List.of(cline)).build(), USER);
        consumptionService.action(cons.getId(), "SUBMIT", USER);
        consumptionService.action(cons.getId(), "POST", USER);

        assertThrows(RuntimeException.class, () -> consumptionService.action(cons.getId(), "POST", USER),
                "re-POST on an already POSTED consumption must be rejected");

        assertEquals(1, ledger.findAll().stream()
                .filter(l -> "production-consumption".equals(l.getDocType())
                        && l.getOutQty() != null && l.getOutQty().signum() > 0).count(),
                "re-POST must not add a second physical OUT row");
        assertEquals(10.0, stockService.onHand(ITEM, LOC, null), 0.001, "onHand must stay 10");
    }

    @Test
    @DisplayName("A consumed request can never be re-issued (state machine blocks ISSUE from ISSUED)")
    void cannotReissueAfterIssue() {
        ProdReqMaterialLine line = ProdReqMaterialLine.builder()
                .itemCode(ITEM).requiredQty(new BigDecimal("100"))
                .issuedQty(new BigDecimal("100")).storeCode(LOC).batchNumber(BATCH).uom("KG").build();
        ProdReqMaterial req = materialRequestService.save(
                ProdReqMaterial.builder().jobCardId(jobCard.getId()).lines(List.of(line)).build(), USER);
        materialRequestService.action(req.getId(), "SUBMIT", USER);
        materialRequestService.action(req.getId(), "APPROVE", USER);
        materialRequestService.action(req.getId(), "ISSUE", USER);

        assertThrows(RuntimeException.class, () -> materialRequestService.action(req.getId(), "ISSUE", USER),
                "re-ISSUE from ISSUED must be rejected");

        assertEquals(1, documents.findAll("stock-allotment").size(),
                "must still be exactly one reservation allotment (no duplicate reservation)");
        assertEquals(0, stockService.available(ITEM, LOC), 0.001, "full 100 still reserved after rejected re-ISSUE");
    }

    @Test
    @DisplayName("D2: CANCEL after ISSUE releases the reservation — no physical OUT, reserved=0, onHand unchanged")
    void cancelAfterIssueReleasesReservation() {
        ProdReqMaterialLine line = ProdReqMaterialLine.builder()
                .itemCode(ITEM).requiredQty(new BigDecimal("100"))
                .issuedQty(new BigDecimal("100")).storeCode(LOC).batchNumber(BATCH).uom("KG").build();
        ProdReqMaterial req = materialRequestService.save(
                ProdReqMaterial.builder().jobCardId(jobCard.getId()).lines(List.of(line)).build(), USER);
        materialRequestService.action(req.getId(), "SUBMIT", USER);
        materialRequestService.action(req.getId(), "APPROVE", USER);
        materialRequestService.action(req.getId(), "ISSUE", USER);

        assertEquals(0.0, stockService.available(ITEM, LOC), 0.001, "full 100 reserved before cancel");
        assertEquals(100.0, stockService.onHand(ITEM, LOC, null), 0.001, "onHand untouched before cancel");

        ProdReqMaterial cancelled = materialRequestService.action(req.getId(), "CANCEL", USER);

        assertEquals("CANCELLED", cancelled.getStatus());
        assertEquals("POSTED", ((StockAllotment) documents.findAll("stock-allotment").get(0)).getStatus(),
                "reservation allotment must be POSTED (released) on cancel");

        assertEquals(100.0, stockService.onHand(ITEM, LOC, null), 0.001,
                "CANCEL must NOT physically deduct stock");
        assertEquals(100.0, stockService.available(ITEM, LOC), 0.001,
                "reserved must be 0 after cancel — available fully restored");

        long productionOuts = ledger.findAll().stream()
                .filter(l -> "production-consumption".equals(l.getDocType())
                        && l.getOutQty() != null && l.getOutQty().signum() > 0).count();
        assertEquals(0, productionOuts, "CANCEL must NOT create any physical OUT row (nothing consumed)");
        assertEquals(0, ledger.findAll().stream()
                .filter(l -> "material-request".equals(l.getDocType())).count(),
                "ISSUE/CANCEL never creates a material-request OUT row");

        StockBalance balance = balances.findByItemCodeAndLocationAndBatchNoAndHeatNoAndStockStatus(
                ITEM, LOC, "B-01", "", "FREE").orElseThrow();
        assertEquals(0, new BigDecimal("100").compareTo(balance.getQty()),
                "Initial onHand (100) = Final onHand (100) + consumed (0)");
    }

    @Test
    @DisplayName("D2: CLOSE after partial consumption does not double-release and preserves the consumed OUT")
    void closeWithRemainingAfterPartialConsumption() {
        ProdReqMaterialLine line = ProdReqMaterialLine.builder()
                .itemCode(ITEM).requiredQty(new BigDecimal("100"))
                .issuedQty(new BigDecimal("100")).storeCode(LOC).batchNumber(BATCH).uom("KG").build();
        ProdReqMaterial req = materialRequestService.save(
                ProdReqMaterial.builder().jobCardId(jobCard.getId()).lines(List.of(line)).build(), USER);
        materialRequestService.action(req.getId(), "SUBMIT", USER);
        materialRequestService.action(req.getId(), "APPROVE", USER);
        materialRequestService.action(req.getId(), "ISSUE", USER);

        // Consume 60 of 100: reservation is released atomically as part of the POST
        ProductionConsumptionLine cline = ProductionConsumptionLine.builder()
                .itemCode(ITEM).issuedQty(new BigDecimal("100"))
                .consumedQty(new BigDecimal("60")).location(LOC).batchNumber(BATCH).uom("KG").build();
        ProductionConsumption cons = consumptionService.save(
                ProductionConsumption.builder()
                        .jobCardId(jobCard.getId())
                        .materialRequestNo(req.getReqNo())
                        .lines(List.of(cline)).build(), USER);
        consumptionService.action(cons.getId(), "SUBMIT", USER);
        consumptionService.action(cons.getId(), "POST", USER);

        assertEquals(40.0, stockService.onHand(ITEM, LOC, null), 0.001, "onHand = 100 - 60 after consumption");
        assertEquals(40.0, stockService.available(ITEM, LOC), 0.001, "reserved = 0 after consumption released it");

        ProdReqMaterial closed = materialRequestService.action(req.getId(), "CLOSE", USER);

        assertEquals("CLOSED", closed.getStatus());
        assertEquals("POSTED", ((StockAllotment) documents.findAll("stock-allotment").get(0)).getStatus(),
                "allotment remains POSTED — CLOSE must not re-post (no duplicate release)");

        assertEquals(40.0, stockService.onHand(ITEM, LOC, null), 0.001,
                "CLOSE must NOT adjust physical stock beyond already-consumed 60");
        assertEquals(40.0, stockService.available(ITEM, LOC), 0.001,
                "reserved must stay 0 after close");

        List<StockLedger> outs = ledger.findAll().stream()
                .filter(l -> "RM-001".equals(l.getItemCode()) && l.getOutQty() != null && l.getOutQty().signum() > 0).toList();
        assertEquals(1, outs.size(), "exactly ONE physical OUT (the 60 consumption) — CLOSE added none");
        assertEquals(0, new BigDecimal("60").compareTo(outs.get(0).getOutQty()));

        StockBalance balance = balances.findByItemCodeAndLocationAndBatchNoAndHeatNoAndStockStatus(
                ITEM, LOC, "B-01", "", "FREE").orElseThrow();
        assertEquals(0, new BigDecimal("40").compareTo(balance.getQty()),
                "Initial onHand (100) = Final onHand (40) + consumed (60)");
    }
}