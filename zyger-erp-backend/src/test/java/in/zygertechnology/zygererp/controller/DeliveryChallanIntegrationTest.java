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

@DisplayName("Delivery Challan Controller & Integration Tests")
class DeliveryChallanIntegrationTest extends AbstractPostgresIntegrationTest {

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
        seedStore(location);
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

    private void seedStore(String code) {
        if (storeMasterRepository.findByCode(code).isPresent()) return;
        StoreMaster store = StoreMaster.builder()
                .code(code)
                .name(code)
                .active(Boolean.TRUE)
                .build();
        storeMasterRepository.save(store);
    }

    @Test
    @DisplayName("JO DC: Create, Next Number, Get by ID")
    void testJoDcWorkflow() throws Exception {
        seedStock("RM-001", "Main Warehouse", 100.0);

        // Next Number
        mockMvc.perform(get("/api/inventory/delivery-challan/jo-dc/next-number")
                        .header("Authorization", bearer(adminToken())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nextNumber").exists());

        // Create JO DC
        Map<String, Object> body = Map.of(
                "party", "Job Worker Vendor Inc",
                "sourceLocation", "Main Warehouse",
                "docDate", "2026-09-09",
                "jobOrderNo", "JO-2026-0001",
                "challanPurpose", "Sending for Job Work",
                "processName", "Plating",
                "expectedReturnDate", "2026-09-25",
                "jobWorkRateApplicable", true,
                "gstOnJobWork", "Nil",
                "lines", List.of(
                        Map.of("itemCode", "RM-001", "qty", 10.0, "rate", 25.0, "amount", 250.0, "uom", "PCS")
                )
        );

        MvcResult res = mockMvc.perform(post("/api/inventory/delivery-challan/jo-dc")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").exists())
                .andExpect(jsonPath("$.docNo").value(org.hamcrest.Matchers.startsWith("JODC")))
                .andReturn();

        String content = res.getResponse().getContentAsString();
        Map<?, ?> created = objectMapper.readValue(content, Map.class);
        Long id = Long.valueOf(String.valueOf(created.get("id")));

        // Fetch JO DC by ID
        mockMvc.perform(get("/api/inventory/delivery-challan/jo-dc/" + id)
                        .header("Authorization", bearer(adminToken())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.party").value("Job Worker Vendor Inc"))
                .andExpect(jsonPath("$.jobOrderNo").value("JO-2026-0001"));
    }

    @Test
    @DisplayName("General DC: Create, Convert to Invoice flag, Print PDF")
    void testGeneralDcWorkflow() throws Exception {
        seedStock("FG-001", "Main Warehouse", 100.0);

        Map<String, Object> body = Map.of(
                "party", "ACME Customer Ltd",
                "sourceLocation", "Main Warehouse",
                "docDate", "2026-09-09",
                "dcAgainst", "Sale",
                "salesOrderNo", "SO-2026-0100",
                "convertToInvoiceLater", true,
                "taxApplicable", true,
                "gstin", "GSTIN27AACC123456789",
                "lines", List.of(
                        Map.of("itemCode", "FG-001", "qty", 5.0, "rate", 100.0, "amount", 500.0, "uom", "PCS")
                )
        );

        MvcResult res = mockMvc.perform(post("/api/inventory/delivery-challan/general-dc")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.docNo").value(org.hamcrest.Matchers.startsWith("GDC")))
                .andReturn();

        Map<?, ?> created = objectMapper.readValue(res.getResponse().getContentAsString(), Map.class);
        Long id = Long.valueOf(String.valueOf(created.get("id")));

        // Print PDF Endpoint Test
        mockMvc.perform(get("/api/inventory/delivery-challan/general-dc/" + id + "/print")
                        .header("Authorization", bearer(adminToken())))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/pdf"));
    }

    @Test
    @DisplayName("Transfer DC: Create with In-Transit Tracking")
    void testTransferDcWorkflow() throws Exception {
        seedStock("ITM-100", "Main Warehouse", 100.0);

        Map<String, Object> body = Map.of(
                "destinationLocation", "Branch Warehouse South",
                "sourceLocation", "Main Warehouse",
                "docDate", "2026-09-09",
                "transferType", "Inter-Branch",
                "inTransitTracking", true,
                "lines", List.of(
                        Map.of("itemCode", "ITM-100", "qty", 15.0, "uom", "PCS")
                )
        );

        mockMvc.perform(post("/api/inventory/delivery-challan/transfer-dc")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.docNo").value(org.hamcrest.Matchers.startsWith("TDC")))
                .andExpect(jsonPath("$.inTransitTracking").value(true));
    }

    @Test
    @DisplayName("Transfer DC: In-Transit Tracking posts to In-Transit bucket until Confirm Receipt")
    void testTransferDcInTransitPostingFlow() throws Exception {
        seedStock("ITM-200", "Main Warehouse", 100.0);
        seedStore("Branch Warehouse South");

        Map<String, Object> body = Map.of(
                "destinationLocation", "Branch Warehouse South",
                "sourceLocation", "Main Warehouse",
                "docDate", "2026-09-09",
                "transferType", "Inter-Branch",
                "inTransitTracking", true,
                "lines", List.of(
                        Map.of("itemCode", "ITM-200", "qty", 15.0, "uom", "PCS")
                )
        );

        MvcResult res = mockMvc.perform(post("/api/inventory/delivery-challan/transfer-dc")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.docNo").value(org.hamcrest.Matchers.startsWith("TDC")))
                .andReturn();

        Long id = Long.valueOf(objectMapper.readTree(res.getResponse().getContentAsString()).get("id").asText());

        mockMvc.perform(post("/api/inventory/delivery-challan/transfer-dc/" + id + "/actions/post")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"Save & Confirm DC\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("POSTED"));

        // FRS §3.3 E: stock must sit in the In-Transit bucket, NOT at the destination.
        assertEquals(0.0, stockService.available("ITM-200", "Branch Warehouse South"), 0.0001);
        assertEquals(15.0, stockService.available("ITM-200", "In-Transit"), 0.0001);

        mockMvc.perform(post("/api/inventory/delivery-challan/transfer-dc/" + id + "/actions/confirm-receipt")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"Goods received\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("RECEIVED"))
                .andExpect(jsonPath("$.receiptConfirmed").value(true));

        assertEquals(15.0, stockService.available("ITM-200", "Branch Warehouse South"), 0.0001);
        assertEquals(0.0, stockService.available("ITM-200", "In-Transit"), 0.0001);
    }

    @Test
    @DisplayName("JO DC: Sending funds Goods with Job Worker bucket; Receiving pulls it back")
    void testJoDcSendReceiveFlow() throws Exception {
        seedStock("RM-200", "Main Warehouse", 100.0);

        Map<String, Object> sendBody = Map.of(
                "party", "Job Worker Vendor Inc",
                "sourceLocation", "Main Warehouse",
                "docDate", "2026-09-09",
                "jobOrderNo", "JO-FLOW-0001",
                "challanPurpose", "Sending for Job Work",
                "processName", "Plating",
                "expectedReturnDate", "2026-09-25",
                "lines", List.of(
                        Map.of("itemCode", "RM-200", "qty", 10.0, "uom", "PCS")
                )
        );

        MvcResult sendRes = mockMvc.perform(post("/api/inventory/delivery-challan/jo-dc")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(sendBody)))
                .andExpect(status().isOk())
                .andReturn();

        Long sendId = Long.valueOf(objectMapper.readTree(sendRes.getResponse().getContentAsString()).get("id").asText());

        mockMvc.perform(post("/api/inventory/delivery-challan/jo-dc/" + sendId + "/actions/post")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"Save & Confirm DC\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("POSTED"));

        assertEquals(90.0, stockService.available("RM-200", "Main Warehouse"), 0.0001);
        assertEquals(10.0, stockService.available("RM-200", "Goods with Job Worker"), 0.0001);

        Map<String, Object> recvBody = Map.of(
                "party", "Job Worker Vendor Inc",
                "sourceLocation", "Main Warehouse",
                "docDate", "2026-09-12",
                "jobOrderNo", "JO-FLOW-0001",
                "challanPurpose", "Receiving after Job Work",
                "processName", "Plating",
                "lines", List.of(
                        Map.of("itemCode", "RM-200", "qty", 10.0, "uom", "PCS")
                )
        );

        MvcResult recvRes = mockMvc.perform(post("/api/inventory/delivery-challan/jo-dc")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(recvBody)))
                .andExpect(status().isOk())
                .andReturn();

        Long recvId = Long.valueOf(objectMapper.readTree(recvRes.getResponse().getContentAsString()).get("id").asText());

        mockMvc.perform(post("/api/inventory/delivery-challan/jo-dc/" + recvId + "/actions/post")
                        .header("Authorization", bearer(adminToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"Save & Confirm DC\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("POSTED"));

        assertEquals(100.0, stockService.available("RM-200", "Main Warehouse"), 0.0001);
        assertEquals(0.0, stockService.available("RM-200", "Goods with Job Worker"), 0.0001);
    }

    @Test
    @DisplayName("DC Reports: Register, Job Work Ageing, Pending Invoice, Stock in Transit, Item Movement")
    void testDcReports() throws Exception {
        mockMvc.perform(get("/api/inventory/delivery-challan/reports/register")
                        .header("Authorization", bearer(adminToken()))
                        .param("dcType", "ALL"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());

        mockMvc.perform(get("/api/inventory/delivery-challan/reports/job-work-ageing")
                        .header("Authorization", bearer(adminToken())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());

        mockMvc.perform(get("/api/inventory/delivery-challan/reports/pending-invoice")
                        .header("Authorization", bearer(adminToken())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());

        mockMvc.perform(get("/api/inventory/delivery-challan/reports/stock-in-transit")
                        .header("Authorization", bearer(adminToken())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());

        mockMvc.perform(get("/api/inventory/delivery-challan/reports/dc-wise-item-movement")
                        .header("Authorization", bearer(adminToken()))
                        .param("dcType", "ALL"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());
    }
}
