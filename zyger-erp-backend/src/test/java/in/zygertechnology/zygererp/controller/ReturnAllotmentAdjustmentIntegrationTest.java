package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
import in.zygertechnology.zygererp.entity.StoreMaster;
import in.zygertechnology.zygererp.repo.StoreMasterRepository;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Return Management Module FRS v1.0 + Stock Allotment & Adjustment Modules FRS v1.0
 * integration tests for the two modules' DocumentController + DocumentFacade flows.
 */
@DisplayName("Return Management + Allotment & Adjustment Integration Tests")
class ReturnAllotmentAdjustmentIntegrationTest extends AbstractPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private in.zygertechnology.zygererp.service.StockService stockService;

    @Autowired
    private StoreMasterRepository storeMasterRepository;

    private String bearer(String token) {
        return "Bearer " + token;
    }

    private void seedStock(String itemCode, String location, double qty) {
        seedStoreLocation(location);
        stockService.recordStockIn(
                "SEED-" + System.currentTimeMillis(),
                "stock-in",
                "STOCK_IN",
                itemCode,
                location,
                null,
                null,
                java.math.BigDecimal.valueOf(qty),
                java.time.LocalDate.now(),
                "system",
                "FREE"
        );
    }

    private void seedStoreLocation(String code) {
        if (storeMasterRepository.findByCode(code).isPresent()) return;
        StoreMaster store = StoreMaster.builder()
                .code(code)
                .name(code)
                .active(Boolean.TRUE)
                .build();
        storeMasterRepository.save(store);
    }

    // Direct-post types (jo-dc/general-dc/transfer-dc) can go DRAFT -> POSTED in one step.
    private Long createAndPostDirect(String path, Map<String, Object> body) throws Exception {
        MvcResult res = mockMvc.perform(post(path)
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andReturn();
        Long id = Long.valueOf(objectMapper.readTree(res.getResponse().getContentAsString()).get("id").asText());
        String r = postAction(path, id);
        return id;
    }

    // Workflow governed types require DRAFT -> SUBMITTED -> APPROVED -> POSTED.
    private Long createWorkflowAndPost(String path, Map<String, Object> body) throws Exception {
        Long id = createOnly(path, body);
        String t = postAction(path, id);
        return id;
    }

    private String postAction(String path, Long id) throws Exception {
        mockMvc.perform(post(path + "/" + id + "/actions/submit")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"Submit\"}"))
                .andExpect(status().isOk());
        mockMvc.perform(post(path + "/" + id + "/actions/approve")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"Approve\"}"))
                .andExpect(status().isOk());
        mockMvc.perform(post(path + "/" + id + "/actions/post")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"Post\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("POSTED"));
        return null;
    }

    private Long createOnly(String path, Map<String, Object> body) throws Exception {
        MvcResult res = mockMvc.perform(post(path)
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andReturn();
        return Long.valueOf(objectMapper.readTree(res.getResponse().getContentAsString()).get("id").asText());
    }

    private String getDocNo(String path, Long id) throws Exception {
        return objectMapper.readTree(
                mockMvc.perform(get(path + "/" + id)
                                .header("Authorization", bearer(adminToken())))
                        .andExpect(status().isOk())
                        .andReturn().getResponse().getContentAsString()).get("docNo").asText();
    }

    @Test
    @DisplayName("General Issue: post deducts stock (Allotment/Adjustment source for Stock Return)")
    void testGeneralIssuePostsStock() throws Exception {
        seedStock("RTN-001", "Main Warehouse", 100.0);
        createWorkflowAndPost("/api/inventory/stock-issue/general-issue", Map.of(
                "department", "Production",
                "purpose", "Consumption",
                "sourceLocation", "Main Warehouse",
                "docDate", java.time.LocalDate.now().toString(),
                "lines", List.of(Map.of("itemCode", "RTN-001", "issueQty", 10.0, "location", "Main Warehouse"))
        ));
        assertEquals(90.0, stockService.available("RTN-001", "Main Warehouse"), 0.0001);
    }

    @Test
    @DisplayName("Stock Return: create carries STKRET prefix; post increases stock; source lookup reflects balance")
    void testStockReturnWorkflow() throws Exception {
        seedStock("SR-001", "Main Warehouse", 100.0);
        // Create + post a General Issue to serve as a return source
        Long issueId = createWorkflowAndPost("/api/inventory/stock-issue/general-issue", Map.of(
                "department", "Production",
                "purpose", "Consumption",
                "sourceLocation", "Main Warehouse",
                "docDate", java.time.LocalDate.now().toString(),
                "lines", List.of(Map.of("itemCode", "SR-001", "issueQty", 20.0, "location", "Main Warehouse"))
        ));
        String issueNo = getDocNo("/api/inventory/stock-issue/general-issue", issueId);

        // Source-line lookup should show issued 20 / returned 0
        mockMvc.perform(get("/api/inventory/return-management/source-lines/stock-return")
                        .header("Authorization", bearer(adminToken()))
                        .param("docNo", issueNo)
                        .param("sourceType", "general-issue"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalOriginal").value(20.0));

        // Stock Return document (DRAFT create) prefixes with STKRET
        MvcResult res = mockMvc.perform(post("/api/inventory/return-management/stock-return")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "date", "2026-09-10",
                                "party", "Production",
                                "originalDocumentNo", issueNo,
                                "originalIssueType", "general-issue",
                                "condition", "FREE",
                                "reduceConsumption", "false",
                                "reasonCode", "Excess Quantity",
                                "lines", List.of(Map.of(
                                        "itemCode", "SR-001",
                                        "location", "Main Warehouse",
                                        "returnedQty", 5.0,
                                        "stockStatus", "FREE"))))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").exists())
                .andExpect(jsonPath("$.docNo").value(org.hamcrest.Matchers.startsWith("STKRET")))
                .andReturn();

        Long id = Long.valueOf(objectMapper.readTree(res.getResponse().getContentAsString()).get("id").asText());

        // Post the return: stock increases back
        postAction("/api/inventory/return-management/stock-return", id);

        assertEquals(85.0, stockService.available("SR-001", "Main Warehouse"), 0.0001);

        // Source-line lookup now reflects returned 5 / balance 15
        mockMvc.perform(get("/api/inventory/return-management/source-lines/stock-return")
                        .header("Authorization", bearer(adminToken()))
                        .param("docNo", issueNo)
                        .param("sourceType", "general-issue"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalReturned").value(5.0));
    }

    @Test
    @DisplayName("DC Return: create under DCRET prefix and post restores stock")
    void testDcReturnWorkflow() throws Exception {
        seedStock("DCRT-001", "Main Warehouse", 50.0);
        // General DC source
        Long dcId = createAndPostDirect("/api/inventory/delivery-challan/general-dc", Map.of(
                "party", "ACME Customer Ltd",
                "sourceLocation", "Main Warehouse",
                "docDate", "2026-09-08",
                "dcAgainst", "Sale",
                "convertToInvoiceLater", false,
                "lines", List.of(Map.of("itemCode", "DCRT-001", "qty", 10.0, "rate", 100.0, "amount", 1000.0, "uom", "PCS"))
        ));
        String dcNo = getDocNo("/api/inventory/delivery-challan/general-dc", dcId);
        assertEquals(40.0, stockService.available("DCRT-001", "Main Warehouse"), 0.0001);

        // DC Return
        MvcResult res = mockMvc.perform(post("/api/inventory/return-management/dc-return")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "date", "2026-09-11",
                                "customer", "ACME Customer Ltd",
                                "originalDcNumber", dcNo,
                                "reason", "Wrong Material",
                                "lines", List.of(Map.of("itemCode", "DCRT-001", "location", "Main Warehouse", "currentReturnQty", 4.0))))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.docNo").value(org.hamcrest.Matchers.startsWith("DCRET")))
                .andReturn();

        Long id = Long.valueOf(objectMapper.readTree(res.getResponse().getContentAsString()).get("id").asText());
        postAction("/api/inventory/return-management/dc-return", id);

        assertEquals(44.0, stockService.available("DCRT-001", "Main Warehouse"), 0.0001);
    }

    @Test
    @DisplayName("Stock Allotment: STKALT prefix; Release consumes stock")
    void testAllotmentAndRelease() throws Exception {
        seedStock("ALT-001", "Main Warehouse", 100.0);

        MvcResult allotRes = mockMvc.perform(post("/api/inventory/allotment/stock-allotment")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "date", java.time.LocalDate.now().toString(),
                                "itemCode", "ALT-001",
                                "location", "Main Warehouse",
                                "neededBy", "Production",
                                "lines", List.of(Map.of("itemCode", "ALT-001", "location", "Main Warehouse", "allottedQty", 25.0))))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.docNo").value(org.hamcrest.Matchers.startsWith("STKALT")))
                .andReturn();
        Long allotId = Long.valueOf(objectMapper.readTree(allotRes.getResponse().getContentAsString()).get("id").asText());

        postAction("/api/inventory/allotment/stock-allotment", allotId);

        String allotNo = getDocNo("/api/inventory/allotment/stock-allotment", allotId);

        MvcResult relRes = mockMvc.perform(post("/api/inventory/allotment/stock-release")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "date", java.time.LocalDate.now().toString(),
                                "allotmentNo", allotNo,
                                "itemCode", "ALT-001",
                                "location", "Main Warehouse",
                                "lines", List.of(Map.of("itemCode", "ALT-001", "location", "Main Warehouse", "releasedQty", 25.0))))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.docNo").value(org.hamcrest.Matchers.startsWith("STKREL")))
                .andReturn();
        Long relId = Long.valueOf(objectMapper.readTree(relRes.getResponse().getContentAsString()).get("id").asText());

        postAction("/api/inventory/allotment/stock-release", relId);

        assertEquals(75.0, stockService.available("ALT-001", "Main Warehouse"), 0.0001);
    }

    @Test
    @DisplayName("Stock Release: release 100% allotted stock succeeds when available is 0.0")
    void testFullyAllottedStockRelease() throws Exception {
        seedStock("CSM-2026-0001", "MAIN", 700.0);

        MvcResult allotRes = mockMvc.perform(post("/api/inventory/allotment/stock-allotment")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "date", java.time.LocalDate.now().toString(),
                                "itemCode", "CSM-2026-0001",
                                "location", "MAIN",
                                "neededBy", "Production",
                                "lines", List.of(Map.of("itemCode", "CSM-2026-0001", "location", "MAIN", "allottedQty", 700.0))))))
                .andExpect(status().isOk())
                .andReturn();
        Long allotId = Long.valueOf(objectMapper.readTree(allotRes.getResponse().getContentAsString()).get("id").asText());
        postAction("/api/inventory/allotment/stock-allotment", allotId);

        // At this point onHand = 700, reserved = 700, available = 0.0
        assertEquals(0.0, stockService.available("CSM-2026-0001", "MAIN"), 0.0001);
        assertEquals(700.0, stockService.onHand("CSM-2026-0001", "MAIN", null), 0.0001);

        String allotNo = getDocNo("/api/inventory/allotment/stock-allotment", allotId);

        MvcResult relRes = mockMvc.perform(post("/api/inventory/allotment/stock-release")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "date", java.time.LocalDate.now().toString(),
                                "allotmentNo", allotNo,
                                "reason", "Production Consumption",
                                "lines", List.of(Map.of("itemCode", "CSM-2026-0001", "location", "MAIN", "releasedQty", 700.0))))))
                .andExpect(status().isOk())
                .andReturn();
        Long relId = Long.valueOf(objectMapper.readTree(relRes.getResponse().getContentAsString()).get("id").asText());

        // Submit, approve and post stock release
        postAction("/api/inventory/allotment/stock-release", relId);

        // After release: onHand = 700 (physical stock retained), reserved = 0, available = 700
        assertEquals(700.0, stockService.onHand("CSM-2026-0001", "MAIN", null), 0.0001);
        assertEquals(700.0, stockService.available("CSM-2026-0001", "MAIN"), 0.0001);
    }

    @Test
    @DisplayName("Stock Release: posting without explicit line location updates physical stock and reports correctly")
    void testStockReleaseUpdatesInventoryReportAndCurrentStockWithoutExplicitLineLocation() throws Exception {
        seedStock("ITEM-REL-001", "MAIN", 100.0);

        MvcResult allotRes = mockMvc.perform(post("/api/inventory/allotment/stock-allotment")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "date", java.time.LocalDate.now().toString(),
                                "itemCode", "ITEM-REL-001",
                                "location", "MAIN",
                                "neededBy", "Production",
                                "lines", List.of(Map.of("itemCode", "ITEM-REL-001", "location", "MAIN", "allottedQty", 40.0))))))
                .andExpect(status().isOk())
                .andReturn();
        Long allotId = Long.valueOf(objectMapper.readTree(allotRes.getResponse().getContentAsString()).get("id").asText());
        postAction("/api/inventory/allotment/stock-allotment", allotId);

        assertEquals(100.0, stockService.onHand("ITEM-REL-001", "MAIN", null), 0.0001);
        assertEquals(60.0, stockService.available("ITEM-REL-001", "MAIN"), 0.0001);

        String allotNo = getDocNo("/api/inventory/allotment/stock-allotment", allotId);

        MvcResult relRes = mockMvc.perform(post("/api/inventory/allotment/stock-release")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "date", java.time.LocalDate.now().toString(),
                                "allotmentNo", allotNo,
                                "reason", "Order Cancelled",
                                "lines", List.of(Map.of("itemCode", "ITEM-REL-001", "releasedQty", 20.0))))))
                .andExpect(status().isOk())
                .andReturn();
        Long relId = Long.valueOf(objectMapper.readTree(relRes.getResponse().getContentAsString()).get("id").asText());

        postAction("/api/inventory/allotment/stock-release", relId);

        // After releasing 20 of 40 reserved: physical onHand remains 100, available increases to 80
        assertEquals(100.0, stockService.onHand("ITEM-REL-001", "MAIN", null), 0.0001);
        assertEquals(80.0, stockService.available("ITEM-REL-001", "MAIN"), 0.0001);

        mockMvc.perform(get("/api/inventory/reports/current-stock")
                        .header("Authorization", bearer(adminToken()))
                        .param("itemCode", "ITEM-REL-001")
                        .param("location", "MAIN"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].onHand").value(100.0))
                .andExpect(jsonPath("$.content[0].available").value(80.0));
    }

    @Test
    @DisplayName("Current Stock: one item code across multiple batches/heats/stores collapses to a single row")
    void testCurrentStockCollapsesMultipleBatchesIntoOneRow() throws Exception {
        seedStoreLocation("MAIN");
        seedStoreLocation("STORE-01");
        stockService.recordStockIn("BATCH-A", "stock-in", "STOCK_IN", "ITEM-MULTI-001",
                "MAIN", "B1", null, java.math.BigDecimal.valueOf(100.0),
                java.time.LocalDate.now(), "system", "FREE");
        stockService.recordStockIn("BATCH-B", "stock-in", "STOCK_IN", "ITEM-MULTI-001",
                "MAIN", "B2", null, java.math.BigDecimal.valueOf(50.0),
                java.time.LocalDate.now(), "system", "FREE");
        stockService.recordStockIn("BATCH-C", "stock-in", "STOCK_IN", "ITEM-MULTI-001",
                "STORE-01", "B3", null, java.math.BigDecimal.valueOf(25.0),
                java.time.LocalDate.now(), "system", "FREE");

        mockMvc.perform(get("/api/inventory/reports/current-stock")
                        .header("Authorization", bearer(adminToken()))
                        .param("itemCode", "ITEM-MULTI-001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].itemCode").value("ITEM-MULTI-001"))
                .andExpect(jsonPath("$.content[0].onHand").value(175.0))
                .andExpect(jsonPath("$.content[0].available").value(175.0));
    }

    @Test
    @DisplayName("Reports: all 12 Return + Allotment/Adjustment report endpoints return arrays")
    void testAllReports() throws Exception {
        // Return Management (6)
        mockMvc.perform(get("/api/inventory/return-management/reports/register")
                        .header("Authorization", bearer(adminToken()))
                        .param("returnType", "ALL")).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        mockMvc.perform(get("/api/inventory/return-management/reports/pending-dc-return")
                        .header("Authorization", bearer(adminToken()))).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        mockMvc.perform(get("/api/inventory/return-management/reports/pending-invoice-return")
                        .header("Authorization", bearer(adminToken()))).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        mockMvc.perform(get("/api/inventory/return-management/reports/pending-stock-return")
                        .header("Authorization", bearer(adminToken()))).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        mockMvc.perform(get("/api/inventory/return-management/reports/damaged-rejected-scrap")
                        .header("Authorization", bearer(adminToken()))).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        mockMvc.perform(get("/api/inventory/return-management/reports/consumption-adjustment")
                        .header("Authorization", bearer(adminToken()))).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());

        // Allotment/Adjustment (6)
        mockMvc.perform(get("/api/inventory/allotment/reports/register")
                        .header("Authorization", bearer(adminToken()))).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        mockMvc.perform(get("/api/inventory/allotment/reports/ageing")
                        .header("Authorization", bearer(adminToken()))).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        mockMvc.perform(get("/api/inventory/allotment/reports/release-register")
                        .header("Authorization", bearer(adminToken()))).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        mockMvc.perform(get("/api/inventory/adjustment/reports/amendment-analysis")
                        .header("Authorization", bearer(adminToken()))).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        mockMvc.perform(get("/api/inventory/allotment/reports/pending-approval")
                        .header("Authorization", bearer(adminToken()))).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        mockMvc.perform(get("/api/inventory/adjustment/reports/physical-variance")
                        .header("Authorization", bearer(adminToken()))).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
    }

    @Test
    @DisplayName("Print: Return Note for stock-return emits a PDF")
    void testStockReturnPrint() throws Exception {
        seedStock("PRT-001", "Main Warehouse", 40.0);
        Long issueId = createWorkflowAndPost("/api/inventory/stock-issue/general-issue", Map.of(
                "department", "Production",
                "purpose", "Consumption",
                "sourceLocation", "Main Warehouse",
                "docDate", java.time.LocalDate.now().toString(),
                "lines", List.of(Map.of("itemCode", "PRT-001", "issueQty", 10.0, "location", "Main Warehouse"))
        ));
        String issueNo = getDocNo("/api/inventory/stock-issue/general-issue", issueId);

        Long id = createOnly("/api/inventory/return-management/stock-return", Map.of(
                "date", "2026-09-10",
                "party", "Production",
                "originalDocumentNo", issueNo,
                "originalIssueType", "general-issue",
                "condition", "FREE",
                "reasonCode", "Excess Quantity",
                "lines", List.of(Map.of("itemCode", "PRT-001", "location", "Main Warehouse", "returnedQty", 2.0))
        ));

        mockMvc.perform(get("/api/inventory/return-management/stock-return/" + id + "/print")
                        .header("Authorization", bearer(adminToken())))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/pdf"));
    }
}
