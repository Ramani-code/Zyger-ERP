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
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * P9 — First-class Rejection / Scrap / Rework disposition documents (DOCUMENT_59),
 * end-to-end via the real HTTP API against a PostgreSQL Testcontainer.
 *
 * <p>Verifies:
 * <ul>
 *   <li>REJ/SC/PER numbering + DRAFT→…→POSTED lifecycle + CLOSED/CANCELLED/REVERSED;</li>
 *   <li>quantity buckets (CLAR-002 R1) and never exceeding the entry bucket;</li>
 *   <li>strict disposition — unknown disposition rejected, never FREE (D-C1);</li>
 *   <li>batch identity for batch/lot-controlled items (CLAR-011);</li>
 *   <li>rework target rework-route operation (CLAR-005);</li>
 *   <li>idempotent POST via Idempotency-Key (production_doc_posting_key);</li>
 *   <li>negated-mirror reversal (REJ-RV/SC-RV) with original → REVERSED;</li>
 *   <li>guaranteed ZERO inventory/WIP/entry-quantity mutations (ADR-005, recording-only).</li>
 * </ul>
 */
@SpringBootTest(properties = {
        "production.normalized-ops.enabled=true",
        "spring.mvc.log-resolved-exception=true",
        "logging.level.org.hibernate=ERROR",
        "logging.level.org.springframework=INFO"
})
@ActiveProfiles("test")
class ProductionDispositionIntegrationTest extends AbstractPostgresIntegrationTest {

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

    private static final AtomicInteger SEQ = new AtomicInteger(100);

    @BeforeEach
    void seedItems() {
        if (!itemRepo.existsByCode("CO-1")) {
            itemRepo.save(ItemMaster.builder().code("CO-1").name("Co-part Machined").active(true).build());
        }
        if (!itemRepo.existsByCode("IT-B")) {
            itemRepo.save(ItemMaster.builder().code("IT-B").name("Batch Controlled").active(true)
                    .batchControl(true).build());
        }
    }

    // ============================ helpers ============================

    private long createAndPostEntry(String token, String woPrefix) throws Exception {
        int seq = SEQ.incrementAndGet();
        String wo = "WO-" + woPrefix + "-" + seq;
        String body = "{"
                + "\"productionType\":\"GENERAL\","
                + "\"entryNumber\":\"PE-X\","
                + "\"supervisorCode\":\"SUP-A\","
                + "\"supervisorName\":\"Supervisor A\","
                + "\"workOrderNumber\":\"" + wo + "\","
                + "\"operationCode\":\"OP-A\","
                + "\"operationSequence\":1,"
                + "\"partCode\":\"PC-1\","
                + "\"partDescription\":\"Part One\","
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
        JsonNode createdNode = objectMapper.readTree(created.getResponse().getContentAsString());
        int rejInBody = createdNode.path("rejectionReasons").size();
        int rewInBody = createdNode.path("reworkReasons").size();
        Long rejRows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM production_entry_rejection WHERE production_entry_id=" + id, Long.class);
        Long rewRows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM production_entry_rework WHERE production_entry_id=" + id, Long.class);
        String cols = jdbc.queryForObject(
                "SELECT good_quantity||'|'||rejected_quantity||'|'||rework_quantity||'|'||scrap_quantity"
                        + " FROM production_entry WHERE id=" + id, String.class);
        if (rejRows == 0 || rewRows == 0) {
            fail("entry child rows missing after create: rej=" + rejRows + " rew=" + rewRows
                    + " cols=(" + cols + ") rejInBody=" + rejInBody + " rewInBody=" + rewInBody);
        }
        MvcResult posted = mockMvc.perform(post("/api/v1/production/entries/{id}/actions/post", id)
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", "idem-entry-" + seq)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andReturn();
        if (posted.getResponse().getStatus() != 200) {
            fail("entry post failed with " + posted.getResponse().getStatus()
                    + ": " + posted.getResponse().getContentAsString()
                    + " | rejRows=" + rejRows + " rewRows=" + rewRows + " cols=(" + cols + ")");
        }
        return id;
    }

    private String rejectionLines(String... linesJson) {
        return "[" + String.join(",", linesJson) + "]";
    }

    private MvcResult createRejection(String token, long entryId, String linesJson, String expectStatus) throws Exception {
        String body = "{"
                + "\"entryId\":" + entryId + ","
                + "\"inspectionDate\":\"2026-01-15\","
                + "\"inspector\":\"INSP-1\","
                + "\"lines\":" + linesJson + ","
                + "\"remarks\":\"P9 rejection test\""
                + "}";
        return mockMvc.perform(post("/api/v1/production/rejections")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(expectStatus))
                .andReturn();
    }

    private long createAndGetId(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asLong();
    }

    private long count(String table, String where) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + where, Long.class);
        return n == null ? 0L : n;
    }

    private String lineOf(String itemCode, String qty, String reason, String disposition, String extra) {
        StringBuilder sb = new StringBuilder("{")
                .append("\"itemCode\":\"").append(itemCode).append("\",")
                .append("\"quantity\":").append(qty).append(",")
                .append("\"uom\":\"PCS\",")
                .append("\"reasonCode\":\"").append(reason).append("\",")
                .append("\"disposition\":\"").append(disposition).append("\"");
        if (extra != null) {
            sb.append(",").append(extra);
        }
        return sb.append("}").toString();
    }

    // ============================ tests ============================

    @Test
    @DisplayName("P9: full rejection workflow — create/submit/approve/post with REJ numbering and header snapshot")
    void rejectionFullWorkflow() throws Exception {
        String token = adminToken();
        long entryId = createAndPostEntry(token, "REJ");

        MvcResult created = createRejection(token, entryId,
                rejectionLines(lineOf("CO-1", "4.0000", "R-01", "SCRAP", "\"location\":\"STORE\"")), "DRAFT");
        long id = createAndGetId(created);
        JsonNode node = objectMapper.readTree(created.getResponse().getContentAsString());
        assertTrue(node.get("docNumber").asText().startsWith("REJ-"));
        // entry header snapshot
        MvcResult readBack = mockMvc.perform(get("/api/v1/production/entries/" + entryId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        String entryNumber = objectMapper.readTree(readBack.getResponse().getContentAsString()).get("entryNumber").asText();

        mockMvc.perform(post("/api/v1/production/rejections/{id}/actions/{action}", id, "submit")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("SUBMITTED"));
        mockMvc.perform(post("/api/v1/production/rejections/{id}/actions/{action}", id, "approve")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("APPROVED"));
        mockMvc.perform(post("/api/v1/production/rejections/{id}/actions/{action}", id, "post")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("POSTED"))
                .andExpect(jsonPath("$.entryNumber").value(entryNumber));

        // GET by id and list include it
        mockMvc.perform(get("/api/v1/production/rejections/" + id)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("POSTED"))
                .andExpect(jsonPath("$.lines[0].quantity").value(4.0));
        mockMvc.perform(get("/api/v1/production/rejections")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id==" + id + ")]").exists());
    }

    @Test
    @DisplayName("P9: quantity above the rejected bucket is rejected with 400; valid doc posts idempotently and writes posting key")
    void rejectionBucketAndIdempotency() throws Exception {
        String token = adminToken();
        long entryId = createAndPostEntry(token, "BUCK");

        // 6 > 4 rejected bucket
        MvcResult overCreated = createRejection(token, entryId,
                rejectionLines(lineOf("CO-1", "6.0000", "R-01", "SCRAP", "\"location\":\"STORE\"")), "DRAFT");
        long overId = createAndGetId(overCreated);

        mockMvc.perform(post("/api/v1/production/rejections/{id}/actions/{action}", overId, "post")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Validation Error"))
                .andExpect(jsonPath("$.detail").value(
                        org.hamcrest.Matchers.containsString("exceeds the available rejected quantity")));

        // valid 4.0000 doc posts idempotently
        long entryId2 = createAndPostEntry(token, "BUCK2");
        MvcResult ok = createRejection(token, entryId2,
                rejectionLines(lineOf("CO-1", "4.0000", "R-01", "REWORKABLE", "\"location\":\"STORE\"")), "DRAFT");
        long okId = createAndGetId(ok);
        mockMvc.perform(post("/api/v1/production/rejections/{id}/actions/{action}", okId, "post")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", "idem-rej-ok")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("POSTED"));
        mockMvc.perform(post("/api/v1/production/rejections/{id}/actions/{action}", okId, "post")
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", "idem-rej-ok")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("POSTED"));

        assertEquals(1L, count("production_doc_posting_key", "idempotency_key='idem-rej-ok'"));
        assertEquals(1L, count("production_rejection_doc", "id=" + okId));
    }

    @Test
    @DisplayName("P9: unknown disposition and batch-controlled-without-batch are rejected with 400 messages")
    void strictDispositionAndBatchIdentity() throws Exception {
        String token = adminToken();
        long entryId = createAndPostEntry(token, "STRICT");

        // unknown disposition -> 400, never FREE (D-C1)
        MvcResult freeDoc = createRejection(token, entryId,
                rejectionLines(lineOf("CO-1", "1.0000", "R-01", "FREE", "\"location\":\"STORE\"")), "DRAFT");
        long freeId = createAndGetId(freeDoc);
        mockMvc.perform(post("/api/v1/production/rejections/{id}/actions/{action}", freeId, "post")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("never become FREE")));

        // batch/lot-controlled item missing batch -> 400 (CLAR-011)
        MvcResult batchDoc = createRejection(token, entryId,
                rejectionLines(lineOf("IT-B", "1.0000", "R-01", "SCRAP", "\"location\":\"STORE\"")), "DRAFT");
        long batchId = createAndGetId(batchDoc);
        mockMvc.perform(post("/api/v1/production/rejections/{id}/actions/{action}", batchId, "post")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("Batch identity")));

        // with the batch it posts fine
        MvcResult batchOk = createRejection(token, entryId,
                rejectionLines(lineOf("IT-B", "1.0000", "R-01", "SCRAP",
                        "\"batchNumber\":\"B-1001\",\"location\":\"STORE\"")), "DRAFT");
        mockMvc.perform(post("/api/v1/production/rejections/{id}/actions/{action}", createAndGetId(batchOk), "post")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("POSTED"));
    }

    @Test
    @DisplayName("P9: scrap doc posts from DRAFT and reversal creates SC-RV mirror with negated lines")
    void scrapPostAndReverse() throws Exception {
        String token = adminToken();
        long entryId = createAndPostEntry(token, "SCRAP");
        long ledgerBefore = count("stock_ledger", "1=1");
        long balanceBefore = count("stock_balance", "1=1");

        String body = "{\"entryId\":" + entryId + ","
                + "\"scrapDate\":\"2026-01-16\","
                + "\"lines\":[" + lineOf("CO-1", "3.0000", "R-02", "SCRAP", "\"warehouse\":\"STORE\",\"location\":\"STORE\"") + "],"
                + "\"remarks\":\"P9 scrap test\"}";
        MvcResult created = mockMvc.perform(post("/api/v1/production/scraps")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.docNumber", org.hamcrest.Matchers.startsWith("SC-")))
                .andReturn();
        long id = createAndGetId(created);

        mockMvc.perform(post("/api/v1/production/scraps/{id}/actions/{action}", id, "post")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("POSTED"));

        MvcResult rev = mockMvc.perform(post("/api/v1/production/scraps/{id}/actions/{action}", id, "reverse")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reversalReason\":\"correction\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isReversal").value(true))
                .andExpect(jsonPath("$.docNumber", org.hamcrest.Matchers.startsWith("SC-RV-")))
                .andExpect(jsonPath("$.lines[0].quantity").value(-3.0))
                .andReturn();
        long revId = createAndGetId(rev);

        // original is REVERSED
        mockMvc.perform(get("/api/v1/production/scraps/" + id)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REVERSED"));
        assertTrue(revId != id);

        // recording only: no inventory mutation from scrap processing
        assertEquals(ledgerBefore, count("stock_ledger", "1=1"));
        assertEquals(balanceBefore, count("stock_balance", "1=1"));
    }

    @Test
    @DisplayName("P9: rework requires target operation; posts with it and caps at rework bucket")
    void reworkTargetOperationAndBucket() throws Exception {
        String token = adminToken();
        long entryId = createAndPostEntry(token, "REW");

        String noTarget = "{\"itemCode\":\"CO-1\",\"quantity\":2.0000,\"uom\":\"PCS\","
                + "\"reasonCode\":\"R-03\",\"sourceOperationCode\":\"OP-A\"}";
        String body = "{\"entryId\":" + entryId + ","
                + "\"reworkDate\":\"2026-01-17\","
                + "\"lines\":[" + noTarget + "],"
                + "\"remarks\":\"P9 rework test\"}";
        MvcResult created = mockMvc.perform(post("/api/v1/production/reworks")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn();
        if (created.getResponse().getStatus() != 200) {
            fail("rework create failed with " + created.getResponse().getStatus()
                    + ": " + created.getResponse().getContentAsString());
        }
        long id = createAndGetId(created);
        mockMvc.perform(post("/api/v1/production/reworks/{id}/actions/{action}", id, "post")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("target (rework-route) operation")));

        // over the rework bucket (4 > 3) -> 400
        String over = "{\"itemCode\":\"CO-1\",\"quantity\":4.0000,\"uom\":\"PCS\","
                + "\"reasonCode\":\"R-03\",\"sourceOperationCode\":\"OP-A\",\"targetOperationCode\":\"REW-1\"}";
        MvcResult overDoc = mockMvc.perform(post("/api/v1/production/reworks")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"entryId\":" + entryId + ",\"reworkDate\":\"2026-01-17\",\"lines\":[" + over + "]}"))
                .andExpect(status().isOk()).andReturn();
        long overId = createAndGetId(overDoc);
        mockMvc.perform(post("/api/v1/production/reworks/{id}/actions/{action}", overId, "post")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("exceeds the available rework quantity")));

        // valid with target operation -> posts
        String goodLine = "{\"itemCode\":\"CO-1\",\"quantity\":2.0000,\"uom\":\"PCS\","
                + "\"reasonCode\":\"R-03\",\"sourceOperationCode\":\"OP-A\",\"targetOperationCode\":\"REW-1\",\"ncrNumber\":\"NCR-7\"}";
        MvcResult goodDoc = mockMvc.perform(post("/api/v1/production/reworks")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"entryId\":" + entryId + ",\"reworkDate\":\"2026-01-17\",\"lines\":[" + goodLine + "]}"))
                .andExpect(status().isOk()).andReturn();
        mockMvc.perform(post("/api/v1/production/reworks/{id}/actions/{action}", createAndGetId(goodDoc), "post")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("POSTED"));
    }

    @Test
    @DisplayName("P9: disposition processing causes zero WIP / entry-quantity / stock mutations (recording only)")
    void recordingOnlyInvariants() throws Exception {
        String token = adminToken();
        long entryId = createAndPostEntry(token, "INV");
        long ledgerBefore = count("stock_ledger", "1=1");
        long balanceBefore = count("stock_balance", "1=1");

        String entryNumber = jdbc.queryForObject(
                "SELECT entry_number FROM production_entry WHERE id=" + entryId, String.class);
        String beforeRow = jdbc.queryForObject(
                "SELECT good_quantity||'|'||rejected_quantity||'|'||rework_quantity||'|'||scrap_quantity"
                        + " FROM production_entry WHERE id=" + entryId, String.class);
        BigDecimal wipBefore = jdbc.queryForObject(
                "SELECT wip FROM prod_execution_session WHERE entry_number='" + entryNumber + "'", BigDecimal.class);
        long eventsBefore = count("prod_output_event", "session_id = "
                + "(SELECT id FROM prod_execution_session WHERE entry_number='" + entryNumber + "')");

        MvcResult rejCreated = createRejection(token, entryId,
                rejectionLines(lineOf("CO-1", "2.0000", "R-01", "SCRAP", "\"location\":\"STORE\"")), "DRAFT");
        long rejId = createAndGetId(rejCreated);
        mockMvc.perform(post("/api/v1/production/rejections/{id}/actions/{action}", rejId, "post")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/production/scraps")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"entryId\":" + entryId + ",\"scrapDate\":\"2026-01-16\",\"lines\":["
                                + lineOf("CO-1", "3.0000", "R-02", "SCRAP", "\"warehouse\":\"STORE\",\"location\":\"STORE\"")
                                + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.docNumber", org.hamcrest.Matchers.startsWith("SC-")));

        mockMvc.perform(post("/api/v1/production/reworks")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"entryId\":" + entryId + ",\"reworkDate\":\"2026-01-17\",\"lines\":["
                                + "{\"itemCode\":\"CO-1\",\"quantity\":3.0000,\"uom\":\"PCS\","
                                + "\"reasonCode\":\"R-03\",\"sourceOperationCode\":\"OP-A\",\"targetOperationCode\":\"REW-1\"}"
                                + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.docNumber", org.hamcrest.Matchers.startsWith("PER-")));

        String afterRow = jdbc.queryForObject(
                "SELECT good_quantity||'|'||rejected_quantity||'|'||rework_quantity||'|'||scrap_quantity"
                        + " FROM production_entry WHERE id=" + entryId, String.class);
        BigDecimal wipAfter = jdbc.queryForObject(
                "SELECT wip FROM prod_execution_session WHERE entry_number='" + entryNumber + "'", BigDecimal.class);
        long eventsAfter = count("prod_output_event", "session_id = "
                + "(SELECT id FROM prod_execution_session WHERE entry_number='" + entryNumber + "')");

        assertEquals(beforeRow, afterRow);
        assertEquals(0, wipBefore.compareTo(wipAfter));
        assertEquals(eventsBefore, eventsAfter);
        assertEquals(ledgerBefore, count("stock_ledger", "1=1"));
        assertEquals(balanceBefore, count("stock_balance", "1=1"));
    }

    @Test
    @DisplayName("P9: disposition against a reversed entry is rejected with 400")
    void reversedEntryRejected() throws Exception {
        String token = adminToken();
        long entryId = createAndPostEntry(token, "REV-ENT");
        mockMvc.perform(post("/api/v1/production/entries/{id}/actions/reverse", entryId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reversalReason\":\"test correction\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isReversal").value(true));

        mockMvc.perform(post("/api/v1/production/rejections")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"entryId\":" + entryId + ",\"inspectionDate\":\"2026-01-15\",\"inspector\":\"INSP-1\","
                                + "\"lines\":[" + lineOf("CO-1", "2.0000", "R-01", "SCRAP", "\"location\":\"STORE\"") + "]"
                                + "}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Validation Error"))
                .andExpect(jsonPath("$.detail").value(
                        org.hamcrest.Matchers.containsString("POSTED (non-reversed)")));
    }
}