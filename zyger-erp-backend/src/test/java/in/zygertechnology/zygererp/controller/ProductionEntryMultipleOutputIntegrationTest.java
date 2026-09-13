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

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * P8 CAPABILITY A — Multiple-Output Production Entry (DOCUMENT_58), end-to-end via the
 * real HTTP API against a PostgreSQL Testcontainer, feature flag ON.
 *
 * <p>Verifies:
 * <ul>
 *   <li>create/save with additional (co/by-product) outputs persists and returns them;</li>
 *   <li>backend validation rejects duplicate/zero-qty/unknown-item lines with 400 and no
 *       partial save;</li>
 *   <li>POST is idempotent (same X-Idempotency-Key) and projections emitto one
 *       prod_output_event row per additional output;</li>
 *   <li>REVERSAL carries negated additional outputs and creates the compensating mirror;</li>
 *   <li>guaranteed ZERO inventory postings from this capability (ADR-005 / P6 Model B-a).</li>
 * </ul>
 */
@SpringBootTest(properties = "production.normalized-ops.enabled=true")
@ActiveProfiles("test")
class ProductionEntryMultipleOutputIntegrationTest extends AbstractPostgresIntegrationTest {

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

    @BeforeEach
    void seedItems() {
        if (!itemRepo.existsByCode("CO-1")) {
            itemRepo.save(ItemMaster.builder().code("CO-1").name("Co-part Machined").active(true).build());
        }
        if (!itemRepo.existsByCode("SW-1")) {
            itemRepo.save(ItemMaster.builder().code("SW-1").name("Swarf By-product").active(true).build());
        }
    }

    private String createBody(String entryNumber, String additionalJson) {
        String tail = additionalJson == null || additionalJson.isBlank()
                ? "\"additionalOutputs\":[]"
                : "\"additionalOutputs\":[" + additionalJson + "]";
        return "{\"productionType\":\"GENERAL\","
                + "\"entryNumber\":\"" + entryNumber + "\","
                + "\"supervisorCode\":\"SUP-A\","
                + "\"supervisorName\":\"Supervisor A\","
                + "\"workOrderNumber\":\"WO-" + entryNumber + "\","
                + "\"operationCode\":\"OP-A\","
                + "\"operationSequence\":1,"
                + "\"processQty\":100.0000,"
                + "\"goodQuantity\":95.0000,"
                + "\"scrapQuantity\":5.0000,"
                + "\"operators\":[],"
                + "\"rejectionReasons\":[],"
                + "\"reworkReasons\":[],"
                + "\"materials\":[],"
                + "\"batchAllocations\":[],"
                + tail
                + "}";
    }

    @Test
    @DisplayName("P8: create with additional outputs persists and returns them")
    void createWithAdditionalOutputsPersists() throws Exception {
        String token = adminToken();
        // entryNumber in body is overridden by the controller (server assigns PE-…);
        // pass it only as a uniqueness marker for the work order.
        String body = createBody("MULT-1",
                "{\"outputType\":\"CO_PRODUCT\",\"itemCode\":\"CO-1\",\"location\":\"STORE\",\"quantity\":30.0000,\"weight\":12.5000,\"destinationStageCode\":\"FG\"},"
              + "{\"outputType\":\"BY_PRODUCT\",\"itemCode\":\"SW-1\",\"location\":\"SWARD\",\"quantity\":5.0000}");

        MvcResult created = mockMvc.perform(post("/api/v1/production/entries")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.additionalOutputs.length()").value(2))
                .andReturn();

        JsonNode node = objectMapper.readTree(created.getResponse().getContentAsString());
        long id = node.get("id").asLong();

        mockMvc.perform(get("/api/v1/production/entries/" + id)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.additionalOutputs.length()").value(2))
                .andExpect(jsonPath("$.additionalOutputs[*].itemCode", org.hamcrest.Matchers.hasItems("CO-1", "SW-1")));
    }

    @Test
    @DisplayName("P8: create with duplicate/zero-qty/unknown-item additional outputs is rejected with 400, no partial save")
    void createRejectsInvalidAdditionalOutputs() throws Exception {
        String token = adminToken();

        // duplicate (outputType, itemCode, location)
        mockMvc.perform(post("/api/v1/production/entries")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("MULT-DUP",
                                "{\"outputType\":\"CO_PRODUCT\",\"itemCode\":\"CO-1\",\"location\":\"STORE\",\"quantity\":10},"
                              + "{\"outputType\":\"CO_PRODUCT\",\"itemCode\":\"CO-1\",\"location\":\"STORE\",\"quantity\":10}")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Validation Error"))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("Duplicate additional output")));

        // zero quantity
        mockMvc.perform(post("/api/v1/production/entries")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("MULT-ZERO",
                                "{\"outputType\":\"BY_PRODUCT\",\"itemCode\":\"SW-1\",\"location\":\"STORE\",\"quantity\":0}")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Validation Error"))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("greater than zero")));

        // unknown item
        mockMvc.perform(post("/api/v1/production/entries")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("MULT-UNK",
                                "{\"outputType\":\"CO_PRODUCT\",\"itemCode\":\"ZZZ-NOT-EXISTS\",\"location\":\"STORE\",\"quantity\":10}")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Validation Error"))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("does not exist in the item master")));

        // no entry rows persisted for the rejected payloads
        assertEquals(0L, scopedCount("production_entry", "work_order_number='WO-MULT-DUP'"));
        assertEquals(0L, scopedCount("production_entry", "work_order_number='WO-MULT-ZERO'"));
        assertEquals(0L, scopedCount("production_entry", "work_order_number='WO-MULT-UNK'"));
    }

    @Test
    @DisplayName("P8: idempotent POST projects one output row per additional output; repeat key does not duplicate; zero stock writes")
    void postIsIdempotentAndProjectsAdditionalOutputsWithoutInventory() throws Exception {
        String token = adminToken();
        long ledgerBefore = scopedCount("stock_ledger", "1=1");
        long balanceBefore = scopedCount("stock_balance", "1=1");

        MvcResult created = mockMvc.perform(post("/api/v1/production/entries")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("MULT-2",
                                "{\"outputType\":\"CO_PRODUCT\",\"itemCode\":\"CO-1\",\"location\":\"STORE\",\"quantity\":30.0000},"
                              + "{\"outputType\":\"BY_PRODUCT\",\"itemCode\":\"SW-1\",\"location\":\"SWARD\",\"quantity\":5.0000}")))
                .andExpect(status().isOk())
                .andReturn();
        long id = objectMapper.readTree(created.getResponse().getContentAsString()).get("id").asLong();

        String idemKey = "idem-mult-" + id;
        mockMvc.perform(post("/api/v1/production/entries/{id}/actions/post", id)
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", idemKey)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("POSTED"));

        String entryNumber = jdbc.queryForObject(
                "SELECT entry_number FROM production_entry WHERE id=" + id, String.class);
        Long sessionId = jdbc.queryForObject(
                "SELECT id FROM prod_execution_session WHERE entry_number='" + entryNumber + "'", Long.class);

        // 4 nonzero output rows: ACCEPTED 95, SCRAP 5, CO_PRODUCT 30, BY_PRODUCT 5
        assertEquals(4L, scopedCount("prod_output_event", "session_id=" + sessionId + " AND quantity <> 0"));
        assertEquals(1L, scopedCount("prod_output_event",
                "session_id=" + sessionId + " AND output_type='CO_PRODUCT' AND item_code='CO-1' AND quantity=30.0000"));
        assertEquals(1L, scopedCount("prod_output_event",
                "session_id=" + sessionId + " AND output_type='BY_PRODUCT' AND item_code='SW-1' AND location='SWARD'"));

        // second POST with the SAME idempotency key -> no new projection rows
        mockMvc.perform(post("/api/v1/production/entries/{id}/actions/post", id)
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", idemKey)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("POSTED"));
        assertEquals(4L, scopedCount("prod_output_event", "session_id=" + sessionId + " AND quantity <> 0"));

        // zero inventory postings (ADR-005 / P6 Model B-a)
        assertEquals(ledgerBefore, scopedCount("stock_ledger", "1=1"));
        assertEquals(balanceBefore, scopedCount("stock_balance", "1=1"));

        // WIP over PRIMARY quantities only: 100 - (95+0+0+5) = 0
        assertEquals(0, jdbc.queryForObject(
                "SELECT wip FROM prod_execution_session WHERE id=" + sessionId, BigDecimal.class).signum());
    }

    @Test
    @DisplayName("P8: reversal carries negated additional outputs and creates compensating mirror")
    void reversalNegatesAdditionalOutputs() throws Exception {
        String token = adminToken();
        MvcResult created = mockMvc.perform(post("/api/v1/production/entries")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("MULT-3",
                                "{\"outputType\":\"CO_PRODUCT\",\"itemCode\":\"CO-1\",\"location\":\"STORE\",\"quantity\":30.0000}")))
                .andExpect(status().isOk())
                .andReturn();
        long id = objectMapper.readTree(created.getResponse().getContentAsString()).get("id").asLong();

        mockMvc.perform(post("/api/v1/production/entries/{id}/actions/post", id)
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", "idem-mult-3")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk());

        MvcResult rev = mockMvc.perform(post("/api/v1/production/entries/{id}/actions/reverse", id)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reversalReason\":\"correction\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isReversal").value(true))
                .andReturn();

        JsonNode revNode = objectMapper.readTree(rev.getResponse().getContentAsString());
        assertEquals(1, revNode.get("additionalOutputs").size());
        assertEquals(0, new BigDecimal("-30.0000").compareTo(
                new BigDecimal(revNode.get("additionalOutputs").get(0).get("quantity").decimalValue().toString())));

        // original projection preserved COMPLETED; compensating CANCELLED mirror exists
        String entryNumber = jdbc.queryForObject(
                "SELECT entry_number FROM production_entry WHERE id=" + id, String.class);
        assertEquals("COMPLETED", jdbc.queryForObject(
                "SELECT session_status FROM prod_execution_session WHERE entry_number='" + entryNumber + "'", String.class));
        Long mirrorCount = jdbc.queryForObject(
                "SELECT COUNT(*) FROM prod_execution_session WHERE session_status='CANCELLED' AND entry_number LIKE 'PE-REV-%'", Long.class);
        assertTrue(mirrorCount >= 1L);
    }

    private long scopedCount(String table, String where) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + where, Long.class);
        return n == null ? 0L : n;
    }
}