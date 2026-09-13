package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
import in.zygertechnology.zygererp.entity.ItemMaster;
import in.zygertechnology.zygererp.repo.ItemRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * P10 — First-class Batch Card document (DOCUMENT_60; FR-PROD-BATCH-001; DOC_57 §4 #12)
 * end-to-end via the real HTTP API against a PostgreSQL Testcontainer.
 *
 * <p>Verifies:
 * <ul>
 *   <li>BC numbering + numbering_config + doc_sequence registration (NUM-PROD-BATCH);</li>
 *   <li>lifecycle OPEN → HELD ↔ OPEN / OPEN, HELD → CLOSED with entry snapshot;</li>
 *   <li>manual allocation (CLAR-PROD-011): duplicate batch, over-allocation and
 *       output-bucket exhaustion all rejected with 400;</li>
 *   <li>idempotent duplicate create for the same entry + physical batch;</li>
 *   <li>negated-mirror reversal (BC-RV) with the original staying CLOSED + posting key;</li>
 *   <li>guaranteed ZERO inventory/WIP/entry-quantity/normalized-event mutations
 *       (ADR-005 recording-only boundary).</li>
 * </ul>
 */
@SpringBootTest(properties = {
        "production.normalized-ops.enabled=true",
        "spring.mvc.log-resolved-exception=true",
        "logging.level.org.hibernate=ERROR",
        "logging.level.org.springframework=INFO"
})
@ActiveProfiles("test")
class ProductionBatchCardIntegrationTest extends AbstractPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private ItemRepository itemRepo;

    private static final AtomicInteger SEQ = new AtomicInteger(300);

    @BeforeEach
    void seedItems() {
        if (!itemRepo.existsByCode("PC-B")) {
            itemRepo.save(ItemMaster.builder().code("PC-B").name("Batch Controlled Part")
                    .active(true).batchControl(true).requiresBatch(true).build());
        }
        // Mirror the V9 migration registration contract (ADR-PROD-004) for the test DB,
        // which does not run Flyway (ddl-auto=update only).
        jdbc.update(
                "INSERT INTO numbering_config (active, doc_type, fy_start_month, prefix, reset_per_year,"
                        + " separator, use_fy_segment, use_plant_segment, zero_pad)"
                        + " VALUES (true,'batch-card',4,'BC',true,'-',true,true,6)"
                        + " ON CONFLICT (doc_type) DO NOTHING");
    }

    // ============================ helpers ============================

    private long createAndPostEntry(String token, String woPrefix) throws Exception {
        int seq = SEQ.incrementAndGet();
        String wo = "WO-P10-" + woPrefix + "-" + seq;
        String body = "{"
                + "\"productionType\":\"GENERAL\","
                + "\"entryNumber\":\"PE-X\","
                + "\"supervisorCode\":\"SUP-A\","
                + "\"supervisorName\":\"Supervisor A\","
                + "\"workOrderNumber\":\"" + wo + "\","
                + "\"operationCode\":\"OP-1\","
                + "\"operationSequence\":1,"
                + "\"partCode\":\"PC-B\","
                + "\"partDescription\":\"Batch Controlled Part\","
                + "\"processQty\":100.0000,"
                + "\"goodQuantity\":90.0000,"
                + "\"rejectedQuantity\":4.0000,"
                + "\"reworkQuantity\":3.0000,"
                + "\"scrapQuantity\":3.0000,"
                + "\"operators\":[],"
                + "\"rejectionReasons\":[{\"reasonCode\":\"R-01\",\"reasonDescription\":\"Surface defect\",\"quantity\":4.0000}],"
                + "\"reworkReasons\":[{\"reasonCode\":\"R-03\",\"reasonDescription\":\"Oversize\",\"quantity\":3.0000,\"targetProcessCode\":\"REW-1\"}],"
                + "\"materials\":[],"
                + "\"batchAllocations\":[]"
                + "}";
        MvcResult created = mockMvc.perform(post("/api/v1/production/entries")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn();
        if (created.getResponse().getStatus() != 200) {
            fail("entry create failed with " + created.getResponse().getStatus()
                    + ": " + created.getResponse().getContentAsString());
        }
        long id = objectMapper.readTree(created.getResponse().getContentAsString()).get("id").asLong();
        MvcResult posted = mockMvc.perform(post("/api/v1/production/entries/{id}/actions/post", id)
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", "idem-entry-p10-" + seq)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andReturn();
        if (posted.getResponse().getStatus() != 200) {
            fail("entry post failed with " + posted.getResponse().getStatus()
                    + ": " + posted.getResponse().getContentAsString());
        }
        return id;
    }

    private String cardBody(long entryId, String batch, String qty, String allocationsJson) {
        StringBuilder sb = new StringBuilder("{")
                .append("\"entryId\":").append(entryId).append(",")
                .append("\"itemCode\":\"PC-B\",")
                .append("\"physicalBatchNumber\":\"").append(batch).append("\",")
                .append("\"lotNumber\":\"LOT-1\",")
                .append("\"heatNumber\":\"HEAT-1\",")
                .append("\"quantity\":").append(qty);
        if (allocationsJson != null) {
            sb.append(",\"allocations\":").append(allocationsJson);
        }
        return sb.append(",\"remarks\":\"P10 batch card test\"}").toString();
    }

    private long createCardRet(String token, String body, String expectStatus) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/batch-cards")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(expectStatus))
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString()).get("id").asLong();
    }

    private long count(String table, String where) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + where, Long.class);
        return n == null ? 0L : n;
    }

    // ============================ tests ============================

    @Test
    @DisplayName("P10: full workflow — create BC number, numbering_config/doc_sequence registration, lifecycle, audit")
    void batchCardFullWorkflow() throws Exception {
        String token = adminToken();
        long entryId = createAndPostEntry(token, "WF");

        MvcResult created = mockMvc.perform(post("/api/v1/batch-cards")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cardBody(entryId, "B-WF", "45.0000",
                                "[{\"batchNumber\":\"B-WF\",\"lotNumber\":\"LOT-1\",\"heatNumber\":\"HEAT-1\",\"quantity\":45.0000}]")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OPEN"))
                .andReturn();
        long id = objectMapper.readTree(created.getResponse().getContentAsString()).get("id").asLong();
        JsonNode node = objectMapper.readTree(created.getResponse().getContentAsString());
        assertTrue(node.get("docNumber").asText().startsWith("BC-"), node.get("docNumber").asText());
        assertTrue(node.get("entryNumber").asText().startsWith("PE-"),
                node.get("entryNumber").asText());

        // numbering_config + doc_sequence registration (NUM-PROD-BATCH / ADR-004)
        Long cfg = jdbc.queryForObject(
                "SELECT COUNT(*) FROM numbering_config WHERE doc_type='batch-card'", Long.class);
        assertTrue(cfg != null && cfg > 0, "numbering_config missing batch-card");
        Long seq = jdbc.queryForObject(
                "SELECT COUNT(*) FROM doc_sequence WHERE key LIKE 'batch-card/%'", Long.class);
        assertTrue(seq != null && seq > 0, "doc_sequence row missing for batch-card");

        // lifecycle OPEN → HOLD → REOPEN → CLOSE
        mockMvc.perform(post("/api/v1/batch-cards/{id}/actions/{action}", id, "hold")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("HELD"));
        mockMvc.perform(post("/api/v1/batch-cards/{id}/actions/{action}", id, "reopen")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("OPEN"));
        mockMvc.perform(post("/api/v1/batch-cards/{id}/actions/{action}", id, "close")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CLOSED"));

        // GET + list include it; allocations persisted via UNIQUE(batch_card_id, batch_number)
        mockMvc.perform(get("/api/v1/batch-cards/" + id)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CLOSED"))
                .andExpect(jsonPath("$.allocations[0].batchNumber").value("B-WF"))
                .andExpect(jsonPath("$.allocations[0].quantity").value(45.0))
                .andExpect(jsonPath("$.allocations[0].heatNumber").value("HEAT-1"));
        mockMvc.perform(get("/api/v1/batch-cards")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id==" + id + ")]").exists());

        // audit trail written (CREATE + HOLD + REOPEN + CLOSE)
        Long audit = count("production_batch_card_audit_log", "doc_id=" + id);
        assertTrue(audit >= 4, "audit trail too small: " + audit);
    }

    @Test
    @DisplayName("P10: allocation rules — duplicate batch, over-allocation, exhaustion, all 400")
    void allocationRules() throws Exception {
        String token = adminToken();
        long entryId = createAndPostEntry(token, "ALLOC");

        // duplicate batch number on one card → 400
        mockMvc.perform(post("/api/v1/batch-cards")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cardBody(entryId, "B-A", "10.0000",
                                "[{\"batchNumber\":\"B-A\",\"quantity\":4.0000},{\"batchNumber\":\"B-A\",\"quantity\":3.0000}]")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("already allocated")));

        // Σ allocations > card quantity → 400
        mockMvc.perform(post("/api/v1/batch-cards")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cardBody(entryId, "B-B", "10.0000",
                                "[{\"batchNumber\":\"BX-1\",\"quantity\":6.0000},{\"batchNumber\":\"BX-2\",\"quantity\":5.0000}]")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("exceeds the Batch Card quantity")));

        // output-bucket exhaustion: 50 + 50 > 90 → 400; 50 + 40 = 90 OK
        long c1 = createCardRet(token, cardBody(entryId, "B-C1", "50.0000", null), "OPEN");
        mockMvc.perform(post("/api/v1/batch-cards")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cardBody(entryId, "B-C2", "50.0000", null)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("exceeds the available output quantity")));
        createCardRet(token, cardBody(entryId, "B-C2", "40.0000", null), "OPEN");

        // update c1 to 60 while c2 = 40 (total would be 100) → 400
        mockMvc.perform(put("/api/v1/batch-cards/{id}", c1)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"entryId\":" + entryId + ",\"itemCode\":\"PC-B\",\"physicalBatchNumber\":\"B-C1\",\"quantity\":60.0000}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("exceeds the available output quantity")));
    }

    @Test
    @DisplayName("P10: idempotent duplicate create returns the original card, no extra row")
    void duplicateCreateIdempotent() throws Exception {
        String token = adminToken();
        long entryId = createAndPostEntry(token, "DUP");

        long first = createCardRet(token, cardBody(entryId, "B-DUP", "30.0000", null), "OPEN");
        MvcResult second = mockMvc.perform(post("/api/v1/batch-cards")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cardBody(entryId, "B-DUP", "30.0000", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OPEN"))
                .andReturn();
        long secondId = objectMapper.readTree(second.getResponse().getContentAsString()).get("id").asLong();
        assertEquals(first, secondId);
        assertEquals(1, count("production_batch_card",
                "entry_id=" + entryId + " AND physical_batch_number='B-DUP' AND is_reversal=false"));
    }

    @Test
    @DisplayName("P10: reversal — BC-RV mirror with negated allocations; original stays CLOSED; double reverse guarded")
    void reversalMirror() throws Exception {
        String token = adminToken();
        long entryId = createAndPostEntry(token, "REV");

        long id = createCardRet(token, cardBody(entryId, "B-RV", "40.0000",
                "[{\"batchNumber\":\"B-RV\",\"quantity\":40.0000}]"), "OPEN");
        mockMvc.perform(post("/api/v1/batch-cards/{id}/actions/{action}", id, "close")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CLOSED"));

        MvcResult rev = mockMvc.perform(post("/api/v1/batch-cards/{id}/actions/{action}", id, "reverse")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", "idem-bc-rev-" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reversalReason\":\"restate batch card\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CLOSED"))
                .andExpect(jsonPath("$.isReversal").value(true))
                .andReturn();
        JsonNode mirrorNode = objectMapper.readTree(rev.getResponse().getContentAsString());
        assertTrue(mirrorNode.get("docNumber").asText().startsWith("BC-RV-"), mirrorNode.get("docNumber").asText());
        assertEquals(-40.0, mirrorNode.get("quantity").asDouble(), 0.0001);
        assertEquals(-40.0, mirrorNode.get("allocations").get(0).get("quantity").asDouble(), 0.0001);
        long mirrorId = mirrorNode.get("id").asLong();

        // original card stays CLOSED, reversal recorded
        mockMvc.perform(get("/api/v1/batch-cards/" + id)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CLOSED"))
                .andExpect(jsonPath("$.reversalReason").value("restate batch card"));

        // same-key retry returns the mirror (idempotent)
        MvcResult retry = mockMvc.perform(post("/api/v1/batch-cards/{id}/actions/{action}", id, "reverse")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", "idem-bc-rev-" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reversalReason\":\"restate batch card\"}"))
                .andExpect(status().isOk())
                .andReturn();
        assertEquals(mirrorId, objectMapper.readTree(retry.getResponse().getContentAsString()).get("id").asLong());

        // different key on an already-reversed card → 400
        mockMvc.perform(post("/api/v1/batch-cards/{id}/actions/{action}", id, "reverse")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reversalReason\":\"again\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("already been reversed")));

        // posting key recorded
        assertEquals(1, count("production_doc_posting_key",
                "doc_family='BATCH_CARD' AND doc_id=" + mirrorId));
    }

    @Test
    @DisplayName("P10: recording-only — batch card ops touch zero inventory/WIP/entry/normalized-event state")
    void recordingOnlyBoundary() throws Exception {
        String token = adminToken();
        long entryId = createAndPostEntry(token, "BOUND");

        long stockBefore = count("stock_ledger", "1=1");
        long balanceBefore = count("stock_balance", "1=1");
        long entryBatchBefore = count("production_entry_batch", "production_entry_id=" + entryId);
        long sessionBefore = count("prod_execution_session", "1=1");

        long id = createCardRet(token, cardBody(entryId, "B-BOUND", "20.0000",
                "[{\"batchNumber\":\"B-BOUND\",\"quantity\":20.0000}]"), "OPEN");
        mockMvc.perform(post("/api/v1/batch-cards/{id}/actions/{action}", id, "close")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/v1/batch-cards/{id}/actions/{action}", id, "reverse")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", "idem-bc-bound-" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reversalReason\":\"restate\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.isReversal").value(true));

        String cols = jdbc.queryForObject(
                "SELECT good_quantity||'|'||rejected_quantity||'|'||rework_quantity||'|'||scrap_quantity"
                        + " FROM production_entry WHERE id=" + entryId, String.class);
        assertEquals("90.0000|4.0000|3.0000|3.0000", cols,
                "entry quantities must be untouched (CLAR-002 R1)");
        assertEquals(stockBefore, count("stock_ledger", "1=1"), "stock_ledger mutated");
        assertEquals(balanceBefore, count("stock_balance", "1=1"), "stock_balance mutated");
        assertEquals(entryBatchBefore, count("production_entry_batch", "production_entry_id=" + entryId),
                "production_entry_batch mutated");
        assertEquals(sessionBefore, count("prod_execution_session", "1=1"),
                "normalized ops session mutated");
    }

    @Test
    @DisplayName("P10: card against a non-POSTED entry is rejected")
    void rejectsDraftEntry() throws Exception {
        String token = adminToken();
        int seq = SEQ.incrementAndGet();
        String body = "{"
                + "\"productionType\":\"GENERAL\","
                + "\"entryNumber\":\"PE-X\","
                + "\"supervisorCode\":\"SUP-A\","
                + "\"supervisorName\":\"Supervisor A\","
                + "\"workOrderNumber\":\"WO-P10-DRAFT-" + seq + "\","
                + "\"operationCode\":\"OP-1\","
                + "\"operationSequence\":1,"
                + "\"partCode\":\"PC-B\","
                + "\"partDescription\":\"Batch Controlled Part\","
                + "\"processQty\":100.0000,\"goodQuantity\":90.0000,"
                + "\"rejectedQuantity\":4.0000,\"reworkQuantity\":3.0000,\"scrapQuantity\":3.0000,"
                + "\"operators\":[],"
                + "\"rejectionReasons\":[{\"reasonCode\":\"R-01\",\"reasonDescription\":\"Surface defect\",\"quantity\":4.0000}],"
                + "\"reworkReasons\":[{\"reasonCode\":\"R-03\",\"reasonDescription\":\"Oversize\",\"quantity\":3.0000,\"targetProcessCode\":\"REW-1\"}],"
                + "\"materials\":[],\"batchAllocations\":[]"
                + "}";
        MvcResult created = mockMvc.perform(post("/api/v1/production/entries")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk()).andReturn();
        long id = objectMapper.readTree(created.getResponse().getContentAsString()).get("id").asLong();

        mockMvc.perform(post("/api/v1/batch-cards")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cardBody(id, "B-DRAFT", "10.0000", null)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("POSTED")));
    }
}