package in.zygertechnology.zygererp.migration;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
import in.zygertechnology.zygererp.entity.DocEntity;
import in.zygertechnology.zygererp.entity.ItemMaster;
import in.zygertechnology.zygererp.entity.JobCard;
import in.zygertechnology.zygererp.entity.ProdReqMaterial;
import in.zygertechnology.zygererp.entity.ProdReqMaterialLine;
import in.zygertechnology.zygererp.entity.ProductionConsumption;
import in.zygertechnology.zygererp.entity.ProductionConsumptionLine;
import in.zygertechnology.zygererp.entity.StockAllotment;
import in.zygertechnology.zygererp.entity.StockBalance;
import in.zygertechnology.zygererp.entity.StockLedger;
import in.zygertechnology.zygererp.repo.ItemRepository;
import in.zygertechnology.zygererp.repo.JobCardRepository;
import in.zygertechnology.zygererp.repo.LedgerRepository;
import in.zygertechnology.zygererp.repo.StockBalanceRepository;
import in.zygertechnology.zygererp.service.DocumentFacade;
import in.zygertechnology.zygererp.service.ProductionConsumptionService;
import in.zygertechnology.zygererp.service.ProductionMaterialRequestService;
import in.zygertechnology.zygererp.service.StockService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * P14-R1 SAFE REMEDIATION — Flyway-enabled schema verification (F1, F2, F6).
 *
 * <p>Unlike the rest of the integration suite (which runs with Flyway disabled and a
 * Hibernate-derived schema), this class boots the FULL Flyway migration chain
 * (V1..V13) against a real PostgreSQL 16 Testcontainer, so the DB-level constraints
 * introduced/repaired by the P14-R1 migrations are exercised:</p>
 *
 * <ul>
 *   <li><b>F2 (V11):</b> the P6 sub-schema (prod_consumption, prod_consumption_line,
 *       prod_req_material, prod_req_material_line) exists in the migrated schema, and the
 *       full P6 invariant (ISSUE → reservation, Effect.NONE; POST → one physical OUT +
 *       release; onHand/reserved/available) holds against it (P6 regression).</li>
 *   <li><b>F1 (V12):</b> reversal persists NEGATED additional-output rows under the
 *       corrected CHECK (quantity &lt;&gt; 0); a zero-quantity row is still rejected by the DB;
 *       a repeated reversal is DB-safe (sign alternates); POST/P8 document-level behavior
 *       and WIP stay unchanged (P8 regression under the constrained schema).</li>
 *   <li><b>F6 (V13):</b> the stock_ledger (doc_no, doc_type) unique index exists and the DB
 *       rejects a duplicate document-identity pair (the race the old check-then-insert
 *       dedupe could not close).</li>
 * </ul>
 */
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "production.normalized-ops.enabled=true"
})
@ActiveProfiles("test")
class ProductionSchemaFlywayIntegrationTest extends AbstractPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private ItemRepository itemRepo;
    @Autowired private ProductionMaterialRequestService materialRequestService;
    @Autowired private ProductionConsumptionService consumptionService;
    @Autowired private StockService stockService;
    @Autowired private DocumentFacade documents;
    @Autowired private JobCardRepository jobCards;
    @Autowired private LedgerRepository ledger;
    @Autowired private StockBalanceRepository balances;

    private static final String ITEM = "RM-FW-1";
    private static final String LOC = "MAIN";
    private static final String BATCH = "B-01";
    private static final String USER = "integration-flyway-operator";
    private static final String ITEM_CO = "CO-FW";

    @BeforeEach
    void seedItems() {
        if (!itemRepo.existsByCode(ITEM_CO)) {
            itemRepo.save(ItemMaster.builder().code(ITEM_CO).name("Co-part Flyway").active(true).build());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // F2 — P6 consumption sub-schema present after Flyway + P6 invariant holds
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    @DisplayName("F2: V11 tables exist after Flyway; ISSUE reserves (no OUT), POST releases + exactly one OUT")
    void flywayAppliesP6SubSchema_andConservationHolds() {
        for (String t : new String[]{
                "prod_consumption", "prod_consumption_line",
                "prod_req_material", "prod_req_material_line"}) {
            assertEquals(1L, tableCount("information_schema.tables", "table_name='" + t + "'"),
                    t + " must exist in the Flyway-migrated schema (F2/V11)");
        }

        JobCard jobCard = jobCards.save(JobCard.builder()
                .jobCardNumber("JC-FW-INTEG").workOrderNumber("WO-FW-INTEG")
                .status("RELEASED").build());
        stockService.recordStockIn("SEED-FW-1", "stock-in", "STOCK_IN",
                ITEM, LOC, BATCH, null, BigDecimal.valueOf(100), LocalDate.now(), USER, "FREE");

        // ── Material Request ISSUE: reservation only (Effect.NONE) ────────────
        ProdReqMaterialLine line = ProdReqMaterialLine.builder()
                .itemCode(ITEM).requiredQty(new BigDecimal("100"))
                .issuedQty(new BigDecimal("100")).storeCode(LOC).batchNumber(BATCH).uom("KG").build();
        ProdReqMaterial req = materialRequestService.save(
                ProdReqMaterial.builder().jobCardId(jobCard.getId()).lines(List.of(line)).build(), USER);
        materialRequestService.action(req.getId(), "SUBMIT", USER);
        materialRequestService.action(req.getId(), "APPROVE", USER);
        ProdReqMaterial issued = materialRequestService.action(req.getId(), "ISSUE", USER);

        assertEquals("ISSUED", issued.getStatus());
        List<DocEntity> allotments = documents.findAll("stock-allotment");
        assertEquals(1, allotments.size(), "ISSUE must create exactly one reservation allotment");
        assertEquals("APPROVED", ((StockAllotment) allotments.get(0)).getStatus(), "reservation active (APPROVED)");
        assertEquals(0, ledger.findAll().stream()
                .filter(l -> "material-request".equals(l.getDocType())).count(),
                "ISSUE must NOT create a physical OUT row");
        assertEquals(100.0, stockService.onHand(ITEM, LOC, null), 0.001, "onHand unchanged at ISSUE");
        assertEquals(0.0, stockService.available(ITEM, LOC), 0.001, "available = 0 while reserved");

        // ── Consumption POST: single physical OUT + reservation release ───────
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

        assertEquals("POSTED", posted.getStatus());
        assertEquals("POSTED", ((StockAllotment) documents.findAll("stock-allotment").get(0)).getStatus(),
                "reservation released (allotment POSTED) after consumption");
        List<StockLedger> outs = ledger.findAll().stream()
                .filter(l -> ITEM.equals(l.getItemCode()) && l.getOutQty() != null && l.getOutQty().signum() > 0)
                .toList();
        assertEquals(1, outs.size(), "exactly ONE physical OUT for RM-FW-1");
        assertEquals("production-consumption", outs.get(0).getDocType());
        assertEquals(0, new BigDecimal("90").compareTo(outs.get(0).getOutQty()));
        assertEquals(10.0, stockService.onHand(ITEM, LOC, null), 0.001, "onHand = 100 - 90");
        assertEquals(10.0, stockService.available(ITEM, LOC), 0.001, "available restored after release");
        StockBalance balance = balances.findByItemCodeAndLocationAndBatchNoAndHeatNoAndStockStatus(
                ITEM, LOC, BATCH, "", "FREE").orElseThrow();
        assertEquals(0, new BigDecimal("10").compareTo(balance.getQty()), "FREE balance row reflects 10");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // F1 — reversal rows under the corrected non-zero CHECK (P8 regression)
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    @DisplayName("F1: reversal persists negated rows (CHECK <> 0); zero-qty rejected; repeat reversal safe; WIP unchanged")
    void reversalPersistsNegatedRowsUnderSchemaConstraint() throws Exception {
        String token = adminToken();
        String body = "{\"productionType\":\"GENERAL\","
                + "\"entryNumber\":\"FW-REV-1\","
                + "\"supervisorCode\":\"SUP-A\",\"supervisorName\":\"Supervisor A\","
                + "\"workOrderNumber\":\"WO-FW-REV-1\",\"operationCode\":\"OP-A\",\"operationSequence\":1,"
                + "\"processQty\":100.0000,\"goodQuantity\":95.0000,\"scrapQuantity\":5.0000,"
                + "\"operators\":[],\"rejectionReasons\":[],\"reworkReasons\":[],\"materials\":[],\"batchAllocations\":[],"
                + "\"additionalOutputs\":[{\"outputType\":\"CO_PRODUCT\",\"itemCode\":\"CO-FW\",\"location\":\"STORE\",\"quantity\":30.0000}]}";

        MvcResult created = mockMvc.perform(post("/api/v1/production/entries")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.additionalOutputs.length()").value(1))
                .andReturn();
        long id = objectMapper.readTree(created.getResponse().getContentAsString()).get("id").asLong();
        String entryNumber = jdbc.queryForObject("SELECT entry_number FROM production_entry WHERE id=" + id, String.class);

        // POST once (idempotent key)
        mockMvc.perform(post("/api/v1/production/entries/{id}/actions/post", id)
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", "idem-fw-rev-1")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("POSTED"));

        // WIP = 100 - (95 + 0 + 0 + 5) = 0 — unchanged by the reversals below
        BigDecimal wipBefore = jdbc.queryForObject(
                "SELECT wip FROM prod_execution_session WHERE entry_number='" + entryNumber + "'", BigDecimal.class);
        assertEquals(0, wipBefore.signum());

        // Reversal #1 -> negated additional-output (-30)
        MvcResult rev = mockMvc.perform(post("/api/v1/production/entries/{id}/actions/reverse", id)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reversalReason\":\"correction\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isReversal").value(true))
                .andReturn();
        JsonNode revNode = objectMapper.readTree(rev.getResponse().getContentAsString());
        long revId = revNode.get("id").asLong();
        assertEquals(1, revNode.get("additionalOutputs").size());
        assertEquals(0, new BigDecimal("-30.0000").compareTo(revNode.get("additionalOutputs").get(0).get("quantity").decimalValue()));

        // The negated row is PERSISTED in the Flyway-managed table (V7+V12)
        assertEquals(0, new BigDecimal("-30.0000").compareTo(jdbc.queryForObject(
                "SELECT quantity FROM production_entry_output WHERE production_entry_id=" + revId, BigDecimal.class)));

        // The corrected constraint itself is present in the migrated schema
        String condef = jdbc.queryForObject(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='ck_production_entry_output_qty_nonzero'", String.class);
        assertTrue(condef != null && condef.contains("quantity <>"),
                "V12 non-zero CHECK must be present, got: " + condef);
        assertFalse(condef != null && condef.contains("quantity >"),
                "V12 CHECK must not retain the positive-only rule, got: " + condef);
        assertEquals(0L, scopedCount("pg_constraint", "conname='ck_production_entry_output_qty_positive'"),
                "V7 positive CHECK must be gone");

        // A zero-quantity fact is still rejected by the DB (no invalid persisted data)
        assertThrows(DataIntegrityViolationException.class,
                () -> jdbc.update("INSERT INTO production_entry_output "
                        + "(production_entry_id, output_type, item_code, location, quantity) "
                        + "VALUES (" + revId + ", 'BY_PRODUCT', 'SW-FW', 'STORE', 0)"),
                "DB must reject a zero-quantity output row");

        // Repeated (re-reversal) is DB-safe: sign alternates, no constraint violation
        MvcResult rev2 = mockMvc.perform(post("/api/v1/production/entries/{id}/actions/reverse", revId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reversalReason\":\"re-reversal\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isReversal").value(true))
                .andReturn();
        JsonNode rev2Node = objectMapper.readTree(rev2.getResponse().getContentAsString());
        long rev2Id = rev2Node.get("id").asLong();
        assertEquals(0, new BigDecimal("30.0000").compareTo(rev2Node.get("additionalOutputs").get(0).get("quantity").decimalValue()));
        assertEquals(0, new BigDecimal("30.0000").compareTo(jdbc.queryForObject(
                "SELECT quantity FROM production_entry_output WHERE production_entry_id=" + rev2Id, BigDecimal.class)));

        // WIP still untouched by reversals
        assertEquals(0, wipBefore.compareTo(jdbc.queryForObject(
                "SELECT wip FROM prod_execution_session WHERE entry_number='" + entryNumber + "'", BigDecimal.class)));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // F6 — stock_ledger (doc_no, doc_type) unique index enforced at the DB
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    @DisplayName("F6: stock_ledger (doc_no, doc_type) unique index exists and rejects duplicates")
    void stockLedgerDocIdentityUniqueRejectsDuplicates() {
        assertEquals(1L, scopedCount("pg_indexes",
                "tablename='stock_ledger' AND indexname='uq_stock_ledger_doc_no_doc_type'"),
                "F6 unique index must exist in the migrated schema");

        jdbc.update("INSERT INTO stock_ledger "
                + "(doc_no, doc_type, tx_type, item_code, location, stock_status, in_qty, out_qty, tx_date, created_at) "
                + "VALUES ('DUP-1','ds-t','IN','I-1','MAIN','FREE',1,0,CURRENT_DATE,now())");
        jdbc.update("INSERT INTO stock_ledger "
                + "(doc_no, doc_type, tx_type, item_code, location, stock_status, in_qty, out_qty, tx_date, created_at) "
                + "VALUES ('DUP-1','ds-t2','IN','I-2','MAIN','FREE',1,0,CURRENT_DATE,now())");

        assertThrows(DataIntegrityViolationException.class,
                () -> jdbc.update("INSERT INTO stock_ledger "
                        + "(doc_no, doc_type, tx_type, item_code, location, stock_status, in_qty, out_qty, tx_date, created_at) "
                        + "VALUES ('DUP-1','ds-t','IN','I-3','MAIN','FREE',1,0,CURRENT_DATE,now())"),
                "DB must reject a duplicate (doc_no, doc_type) identity");
    }

    private long tableCount(String schemaTable, String where) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM " + schemaTable + " WHERE " + where, Long.class);
        return n == null ? 0L : n;
    }

    private long scopedCount(String table, String where) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + where, Long.class);
        return n == null ? 0L : n;
    }
}