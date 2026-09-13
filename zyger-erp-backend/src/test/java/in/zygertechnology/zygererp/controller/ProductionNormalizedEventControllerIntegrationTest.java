package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
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

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * P3 — End-to-end controller test, feature flag ON.
 *
 * <p>Verifies the wired create -> POST -> REVERSE flow through the real HTTP API
 * keeps the legacy {@code production_entry} authority and status transitions
 * (DRAFT -> POSTED -> REVERSED) fully compatible (P3-09 / legacy API compatibility),
 * while the derived normalized projection is persisted in the same transaction
 * (P3-01/02) and reverse preserves original history (P3-06).
 */
@SpringBootTest(properties = "production.normalized-ops.enabled=true")
@ActiveProfiles("test")
class ProductionNormalizedEventControllerIntegrationTest extends AbstractPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("GET /entries/next-number previews the next PE number without consuming (BR-NUM-001)")
    void nextEntryNumberPreviewIsReadOnly() throws Exception {
        String token = adminToken();

        MvcResult first = mockMvc.perform(get("/api/v1/production/entries/next-number")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nextNumber").isNotEmpty())
                .andReturn();
        JsonNode firstBody = objectMapper.readTree(first.getResponse().getContentAsString());
        String firstNumber = firstBody.get("nextNumber").asText();
        assertTrue(firstNumber.startsWith("PE-"), "nextNumber should use the PE- prefix: " + firstNumber);

        // A second preview (no intervening save) yields the SAME number -> refresh does not consume.
        MvcResult second = mockMvc.perform(get("/api/v1/production/entries/next-number")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        String secondNumber = objectMapper.readTree(second.getResponse().getContentAsString()).get("nextNumber").asText();
        assertEquals(firstNumber, secondNumber,
                "refreshing the preview must not advance/consume the sequence");
    }

    @Test
    @DisplayName("create -> POST -> REVERSE via API keeps legacy authority and projects events (P3-01/02/06)")
    void entryLifecycleProjectsEventsAndStaysLegacyAuthoritative() throws Exception {
        String token = adminToken();

        // 1. Create a valid DRAFT entry (no reject/rework -> no mandatory reason checks)
        String createBody = "{"
                + "\"productionType\":\"GENERAL\","
                + "\"supervisorCode\":\"SUP-1\","
                + "\"supervisorName\":\"Sup One\","
                + "\"jobCardNumber\":\"JC-API\","
                + "\"operationCode\":\"OP-1\","
                + "\"operationSequence\":1,"
                + "\"processQty\":100.0000,"
                + "\"goodQuantity\":90.0000,"
                + "\"scrapQuantity\":10.0000,"
                + "\"operators\":[],"
                + "\"rejectionReasons\":[],"
                + "\"reworkReasons\":[],"
                + "\"materials\":[],"
                + "\"batchAllocations\":[]"
                + "}";

        MvcResult create = mockMvc.perform(post("/api/v1/production/entries")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.entryNumber").isNotEmpty())
                .andReturn();

        JsonNode created = objectMapper.readTree(create.getResponse().getContentAsString());
        long id = created.get("id").asLong();
        String entryNumber = created.get("entryNumber").asText();

        // CREATE projected an OPEN session (flag ON)
        assertEquals(1L, scopedCount("prod_execution_session", "entry_number='" + entryNumber + "'"));

        // 2. POST action
        mockMvc.perform(post("/api/v1/production/entries/{id}/actions/post", id)
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", "idem-" + entryNumber)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("POSTED"));

        // POST projected a COMPLETED session + 4 outputs (2 nonzero here: ACCEPTED, SCRAP)
        Long sessionId = jdbc.queryForObject(
                "SELECT id FROM prod_execution_session WHERE entry_number='" + entryNumber + "'", Long.class);
        assertEquals("COMPLETED", jdbc.queryForObject(
                "SELECT session_status FROM prod_execution_session WHERE id=" + sessionId, String.class));
        assertEquals(2L, scopedCount("prod_output_event", "session_id=" + sessionId + " AND quantity <> 0"));
        // wip never negative: 100 - (90+0+0+10) = 0
        assertEquals(0, jdbc.queryForObject(
                "SELECT wip FROM prod_execution_session WHERE id=" + sessionId, java.math.BigDecimal.class).signum());

        // 3. REVERSE action
        mockMvc.perform(post("/api/v1/production/entries/{id}/actions/reverse", id)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reversalReason\":\"correction\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isReversal").value(true))
                .andExpect(jsonPath("$.status").value("POSTED"));

        // The original projection is preserved (COMPLETED); the mirror is CANCELLED.
        assertEquals("COMPLETED", jdbc.queryForObject(
                "SELECT session_status FROM prod_execution_session WHERE entry_number='" + entryNumber + "'", String.class));
        Long mirrorCount = jdbc.queryForObject(
                "SELECT COUNT(*) FROM prod_execution_session WHERE session_status='CANCELLED' AND entry_number LIKE 'PE-REV-%'", Long.class);
        assertTrue(mirrorCount >= 1L, "a compensating CANCELLED mirror should exist for the reversal");

        // 4. Legacy entry remains authoritative: the original entry row is REVERSED, not deleted.
        assertEquals("REVERSED", jdbc.queryForObject(
                "SELECT status FROM production_entry WHERE id=" + id, String.class));
    }

    private long scopedCount(String table, String where) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + where, Long.class);
        return n == null ? 0L : n;
    }
}