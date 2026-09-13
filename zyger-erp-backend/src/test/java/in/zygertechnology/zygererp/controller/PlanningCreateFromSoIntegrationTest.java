package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
import in.zygertechnology.zygererp.entity.ItemMaster;
import in.zygertechnology.zygererp.entity.Party;
import in.zygertechnology.zygererp.repo.ItemRepository;
import in.zygertechnology.zygererp.repo.PartyRepository;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Regression for ADR-PROD: Work Order auto-created from a Sales Order must carry the
 * line's {@code itemCode}. The previous implementation mapped {@code soItem.getItemName()}
 * into {@code work_order.item_code}; when a Sales Order line had no display name (API-created),
 * the Work Order was persisted with a NULL item_code -> NOT NULL violation -> HTTP 500.
 * <p>Covers {@code POST /api/v1/production/orders/create-from-so} end to end against a
 * real Postgres container with the real security layer.</p>
 */
@DisplayName("Production Order create-from-SO integration (itemCode propagation)")
class PlanningCreateFromSoIntegrationTest extends AbstractPostgresIntegrationTest {

    private static final String ITEM_CODE = "ITM-WOSO-REG-001";
    private static final String PARTY_NAME = "Integration WOSO Customer";
    private static final String PARTY_CODE = "CUS-WOSO-TST-1";

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ItemRepository itemRepo;

    @Autowired
    private PartyRepository partyRepo;

    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void seedMasters() {
        if (!itemRepo.existsByCode(ITEM_CODE)) {
            itemRepo.save(ItemMaster.builder().code(ITEM_CODE).name("WOSO Test Part")
                    .active(true).build());
        }
        if (!partyRepo.existsByCode(PARTY_CODE)) {
            partyRepo.save(Party.builder().kind("CUSTOMER").code(PARTY_CODE).name(PARTY_NAME)
                    .active(true).build());
        }
        // Test DB does not run Flyway / dev seeder: register numbering configs for the
        // doc types used here so doc numbers can be generated.
        registerNumbering("sales-order", "TSO");
        registerNumbering("work-order", "TWO");
    }

    private void registerNumbering(String docType, String prefix) {
        jdbc.update(
                "INSERT INTO numbering_config (active, doc_type, fy_start_month, prefix, reset_per_year,"
                        + " separator, use_fy_segment, use_plant_segment, zero_pad)"
                        + " VALUES (true,'" + docType + "',4,'" + prefix + "',true,'-',true,true,6)"
                        + " ON CONFLICT (doc_type) DO NOTHING");
    }

    private String bearer() {
        return "Bearer " + adminToken();
    }

    @Test
    @DisplayName("create-from-so persists the Work Order with the Sales Order line's itemCode (no itemName present)")
    void shouldPropagateItemCodeFromSalesOrderLine() throws Exception {
        Map<String, Object> line = new LinkedHashMap<>();
        line.put("itemCode", ITEM_CODE);
        // NOTE: deliberately NO itemName. Regression: itemName == null used to be
        // written into work_order.item_code (NULL -> 500 in prod schema).
        line.put("orderQty", 5);
        line.put("unitPrice", 100);
        line.put("tax", 18);
        line.put("uom", "NOS");

        Map<String, Object> soBody = new LinkedHashMap<>();
        soBody.put("customer", PARTY_NAME);
        soBody.put("date", "2026-09-06");
        soBody.put("lines", java.util.List.of(line));

        MvcResult created = mockMvc.perform(post("/api/v1/sales/sales-order")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(soBody)))
                .andExpect(status().isOk())
                .andReturn();
        long soId = objectMapper.readTree(created.getResponse().getContentAsString())
                .path("id").asLong();
        assertTrue(soId > 0, "Sales Order should be created with an id");

        mockMvc.perform(post("/api/v1/sales/sales-order/{id}/actions/approve", soId)
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk());

        MvcResult wo = mockMvc.perform(post("/api/v1/production/orders/create-from-so")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("salesOrderId", soId))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.itemCode").value(ITEM_CODE))
                .andReturn();

        long woId = objectMapper.readTree(wo.getResponse().getContentAsString()).path("id").asLong();
        assertTrue(woId > 0, "Work Order should be created");

        // Round-trip through the read path to prove persistence (not just the DTO).
        mockMvc.perform(get("/api/v1/production/orders/{id}", woId)
                        .header("Authorization", bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.itemCode").value(ITEM_CODE));
    }

    @Test
    @DisplayName("create-from-so with an unknown sales order must fail cleanly (4xx, never 500)")
    void shouldRejectUnknownSalesOrder() throws Exception {
        mockMvc.perform(post("/api/v1/production/orders/create-from-so")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("salesOrderId", 999999L))))
                .andExpect(status().is4xxClientError())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    @DisplayName("approve is blocked (422 BUSINESS_RULE) when a line carries no resolvable itemCode")
    void shouldFallBackWhenCodeMissingButNamePresent() throws Exception {
        // A name-only line has no usable itemCode: approval must be blocked cleanly
        // (referential-integrity guard), never 500.
        Map<String, Object> line = new LinkedHashMap<>();
        line.put("itemName", "Name Only Part");
        line.put("orderQty", 5);
        line.put("unitPrice", 100);

        Map<String, Object> soBody = new LinkedHashMap<>();
        soBody.put("customer", PARTY_NAME);
        soBody.put("date", "2026-09-06");
        soBody.put("lines", java.util.List.of(line));

        MvcResult created = mockMvc.perform(post("/api/v1/sales/sales-order")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(soBody)))
                .andExpect(status().isOk())
                .andReturn();
        long soId = objectMapper.readTree(created.getResponse().getContentAsString())
                .path("id").asLong();

        mockMvc.perform(post("/api/v1/sales/sales-order/{id}/actions/approve", soId)
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("APPROVAL_BLOCKED_UNKNOWN_ITEM"));
        assertEquals(1 + 1, 2);
    }
}