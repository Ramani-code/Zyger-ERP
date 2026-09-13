package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
import in.zygertechnology.zygererp.entity.AppUser;
import in.zygertechnology.zygererp.entity.ItemMaster;
import in.zygertechnology.zygererp.entity.JobCard;
import in.zygertechnology.zygererp.entity.JobCardSubjob;
import in.zygertechnology.zygererp.entity.Permission;
import in.zygertechnology.zygererp.entity.QualityInspection;
import in.zygertechnology.zygererp.entity.QualityInspectionType;
import in.zygertechnology.zygererp.entity.Role;
import in.zygertechnology.zygererp.repo.ItemRepository;
import in.zygertechnology.zygererp.repo.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.util.HashSet;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * P11 — Production Quality Gate (CLAR-PROD-012; DOCUMENT_61) end-to-end via the
 * real HTTP API against a PostgreSQL Testcontainer.
 *
 * <p>Verifies:
 * <ul>
 *   <li>entry post is blocked while a PRODUCTION-sourced inspection is PENDING/FAIL/HELD;</li>
 *   <li>the joint override (Quality Supervisor + Production Supervisor, distinct users)
 *       and the Plant-Head single-signature override both clear the gate;</li>
 *   <li>override is one-time: after consumption the gate blocks again (APPLIED);</li>
 *   <li>duplicate override request for one inspection is idempotent;</li>
 *   <li>a user without the quality/plant-head authority cannot sign;</li>
 *   <li>audit trail is written; zero stock/WIP/normalized-event mutation (recording-only).</li>
 * </ul>
 */
@SpringBootTest(properties = {
        "production.normalized-ops.enabled=true",
        "spring.mvc.log-resolved-exception=true",
        "logging.level.org.hibernate=ERROR",
        "logging.level.org.springframework=INFO"
})
@ActiveProfiles("test")
class ProductionQualityGateIntegrationTest extends AbstractPostgresIntegrationTest {

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
    @Autowired
    private UserRepository userRepo;
    @Autowired
    private PasswordEncoder passwordEncoder;
    @Autowired
    private PlatformTransactionManager txm;
    @Autowired
    private in.zygertechnology.zygererp.security.JwtService jwtService;

    @PersistenceContext
    private EntityManager em;

    private TransactionTemplate tx;

    private static final AtomicInteger SEQ = new AtomicInteger(700);

    @BeforeEach
    void seed() {
        tx = new TransactionTemplate(txm);
        if (!itemRepo.existsByCode("PC-Q")) {
            itemRepo.save(ItemMaster.builder().code("PC-Q").name("Quality Gated Part")
                    .active(true).build());
        }
        seedGateUser("qc-user", "QUALITY_MANAGER");
        seedGateUser("pm-user", "PRODUCTION_SUPERVISOR");
        seedGateUser("ph-user", "PLANT_HEAD");
    }

    // ============================ helpers ============================

    private void seedGateUser(String username, String roleCode) {
        if (!userRepo.existsByUsername(username)) {
            AppUser u = AppUser.builder().username(username)
                    .password(passwordEncoder.encode("Gate-Pass-1!"))
                    .fullName(roleCode.replace('_', ' '))
                    .email(username + "@zyger.in")
                    .role(roleCode)
                    .status("ACTIVE")
                    .active(true)
                    .build();
            userRepo.save(u);
        }
        tx.executeWithoutResult(s -> {
            AppUser u = userRepo.findByUsername(username).orElseThrow();
            if (u.getRoles() == null) u.setRoles(new HashSet<>());
            Role role = null;
            var found = em.createQuery("select r from Role r where r.name = :n", Role.class)
                    .setParameter("n", roleCode + "_GATE").getResultList();
            if (!found.isEmpty()) {
                role = found.get(0);
            } else {
                role = new Role();
                role.setName(roleCode + "_GATE");
                role.setDescription("Gate integration role");
                role.setActive(true);
                var perms = em.createQuery(
                                "select p from Permission p where p.module=:m and p.screen=:s and p.action=:a",
                                Permission.class)
                        .setParameter("m", "PRODUCTION")
                        .setParameter("s", "*")
                        .setParameter("a", "VIEW")
                        .getResultList();
                Permission perm = perms.isEmpty()
                        ? new Permission()
                        : perms.get(0);
                if (perms.isEmpty()) {
                    perm.setModule("PRODUCTION");
                    perm.setScreen("*");
                    perm.setAction("VIEW");
                    perm.setDescription("Production view permission");
                    em.persist(perm);
                    em.flush();
                }
                role.getPermissions().add(perm);
                em.persist(role);
            }
            Role finalRole = role;
            if (u.getRoles().stream().noneMatch(r -> r.getName().equals(finalRole.getName()))) {
                u.getRoles().add(finalRole);
                userRepo.save(u);
            }
        });
    }

    private String token(String username, String role) {
        return jwtService.generate(username, role);
    }

    private void seedJobCardAndInspection(String jcNo, String op, String inspectionStatus) {
        tx.executeWithoutResult(s -> {
            JobCard jc = new JobCard();
            jc.setJobCardNumber(jcNo);
            jc.setWorkOrderNumber("WO-QG-" + jcNo);
            jc.setPartCode("PC-Q");
            jc.setPartDescription("Quality Gated Part");
            jc.setPlannedQuantity(new BigDecimal("100"));
            jc.setStatus("RELEASED");
            em.persist(jc);

            JobCardSubjob sj = new JobCardSubjob();
            sj.setJobCard(jc);
            sj.setSubjobNumber("SJ-" + op);
            sj.setOperationCode(op);
            sj.setOperationDescription("Gate op");
            sj.setSequenceNo(1);
            sj.setPlannedQuantity(new BigDecimal("100"));
            sj.setStatus("IN_PROGRESS");
            sj.setInspectionRequired(true);
            em.persist(sj);

            QualityInspection qi = new QualityInspection();
            qi.setDocNo("QC-QG-" + jcNo);
            qi.setStatus("SUBMITTED");
            qi.setSourceType("PRODUCTION");
            qi.setSourceNumber(jcNo);
            qi.setOperation(op);
            qi.setOperationSequence(1);
            qi.setInspectionType(QualityInspectionType.IPQC);
            qi.setInspectionStatus(inspectionStatus);
            qi.setDecisionStatus("PENDING");
            qi.setItemCode("PC-Q");
            qi.setReceivedQuantity(new BigDecimal("100"));
            qi.setInspectionQuantity(new BigDecimal("100"));
            qi.setCreatedBy("qc-user");
            em.persist(qi);
        });
    }

private String entryBody(String jcNo, String op, String seq) {
    return "{"
            + "\"productionType\":\"GENERAL\","
            + "\"entryNumber\":\"PE-QG-" + seq + "\","
            + "\"supervisorCode\":\"SUP-A\","
            + "\"supervisorName\":\"Supervisor A\","
            + "\"jobCardNumber\":\"" + jcNo + "\","
            + "\"workOrderNumber\":\"WO-QG-" + seq + "\","
            + "\"operationCode\":\"" + op + "\","
            + "\"operationSequence\":1,"
            + "\"partCode\":\"PC-Q\","
            + "\"partDescription\":\"Quality Gated Part\","
            + "\"processQty\":100.0000,"
            + "\"goodQuantity\":90.0000,"
            + "\"rejectedQuantity\":4.0000,"
            + "\"reworkQuantity\":3.0000,"
            + "\"scrapQuantity\":3.0000,"
            + "\"operators\":[],"
            + "\"rejectionReasons\":[{\"reasonCode\":\"R-01\",\"reasonDescription\":\"Surface defect\",\"quantity\":4.0000}],"
            + "\"reworkReasons\":[{\"reasonCode\":\"R-03\",\"reasonDescription\":\"Oversize\",\"quantity\":3.0000,\"targetProcessCode\":\"REW-1\"}],"
            + "\"materials\":[],\"batchAllocations\":[]"
            + "}";
}

private long createDraftEntry(String token, String jcNo, String op, String seq) throws Exception {
    MvcResult created = mockMvc.perform(post("/api/v1/production/entries")
                    .header("Authorization", "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(entryBody(jcNo, op, seq)))
            .andReturn();
    if (created.getResponse().getStatus() != 200) {
        fail("entry create failed with " + created.getResponse().getStatus()
                + ": " + created.getResponse().getContentAsString());
    }
    return objectMapper.readTree(created.getResponse().getContentAsString()).get("id").asLong();
}

    private int postEntry(String token, long entryId, String idemKey) throws Exception {
        return mockMvc.perform(post("/api/v1/production/entries/{id}/actions/post", entryId)
                        .header("Authorization", "Bearer " + token)
                        .header("Idempotency-Key", idemKey)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andReturn().getResponse().getStatus();
    }

    private long requestOverride(String token, long inspectionId) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/v1/production/quality-gate/overrides")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"inspectionId\":" + inspectionId
                                + ",\"reason\":\"QC re-inspection planned; continue per CLAR-PROD-012\""
                                + ",\"quantity\":100}"))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString()).get("id").asLong();
    }

    private long inspectionId(String jcNo) {
        Long id = jdbc.queryForObject(
                "SELECT id FROM quality_inspection WHERE source_number = ?", Long.class, jcNo);
        assertNotNull(id, "seeded inspection not found for " + jcNo);
        return id;
    }

    private long count(String table, String where) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + where, Long.class);
        return n == null ? 0L : n;
    }

    private long countAll(String table) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class);
        return n == null ? 0L : n;
    }

    // ============================ tests ============================

    @Test
    @DisplayName("P11: joint override (Quality + Production) clears the entry-post gate once, then re-blocks")
    void jointOverrideClearsGateOnce() throws Exception {
        String jcNo = "JC-QG-" + SEQ.incrementAndGet();
        seedJobCardAndInspection(jcNo, "OP-9000", "SUBMITTED");
        String admin = adminToken();
        long stockBefore = countAll("stock_ledger");
        long balanceBefore = countAll("stock_balance");
        long entryId = createDraftEntry(admin, jcNo, "OP-9000", String.valueOf(SEQ.incrementAndGet()));
        long sessionAfterDraft = countAll("prod_execution_session");

        // blocked while inspection SUBMITTED/PENDING
        assertEquals(400, postEntry(admin, entryId, "idem-qg-post-1-" + jcNo),
                "entry post must be blocked while gate is PENDING");
        assertEquals(sessionAfterDraft, countAll("prod_execution_session"),
                "the blocked post itself must not create a normalized-op session");

        // override request + joint signatures (distinct users)
        long inspectionId = inspectionId(jcNo);
        long ovrId = requestOverride(token("pm-user", "PRODUCTION_SUPERVISOR"), inspectionId);
        mockMvc.perform(post("/api/v1/production/quality-gate/overrides/{id}/sign-quality", ovrId)
                        .header("Authorization", "Bearer " + token("qc-user", "QUALITY_MANAGER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));
        mockMvc.perform(post("/api/v1/production/quality-gate/overrides/{id}/sign-production", ovrId)
                        .header("Authorization", "Bearer " + token("pm-user", "PRODUCTION_SUPERVISOR")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));

        // the first gate attempt after approval consumes the override (one-time) → 200, override APPLIED
        assertEquals(200, postEntry(admin, entryId, "idem-qg-post-2-" + jcNo),
                "the first post after joint approval must clear the gate and consume the override");
        mockMvc.perform(get("/api/v1/production/quality-gate/overrides/{id}", ovrId)
                        .header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.override.status").value("APPLIED"));

        // second entry for the same job card / op → gate is blocking again (one-time)
        String jcNo2 = "JC-QG-" + SEQ.incrementAndGet();
        seedJobCardAndInspection(jcNo2, "OP-9000", "SUBMITTED");
        long entry2 = createDraftEntry(admin, jcNo2, "OP-9000", String.valueOf(SEQ.incrementAndGet()));
        long sessionAfterDraft2 = countAll("prod_execution_session");
        assertEquals(400, postEntry(admin, entry2, "idem-qg-post-3-" + jcNo),
                "consumed override must not cover the next entry (one-time)");
        assertEquals(sessionAfterDraft2, countAll("prod_execution_session"),
                "the second blocked post must not create a normalized-op session");

        // audit trail + recording-only boundary
        assertTrue(count("production_gate_override_audit", "override_id=" + ovrId) >= 4,
                "override audit trail missing CREATE_REQUEST/APPROVED/APPLIED events");
        String cols = jdbc.queryForObject(
                "SELECT good_quantity||'|'||rejected_quantity||'|'||rework_quantity||'|'||scrap_quantity"
                        + " FROM production_entry WHERE id=" + entryId, String.class);
        assertEquals("90.0000|4.0000|3.0000|3.0000", cols, "entry quantities must be untouched");
        assertEquals(stockBefore, countAll("stock_ledger"), "stock_ledger mutated by gate/override");
        assertEquals(balanceBefore, countAll("stock_balance"), "stock_balance mutated by gate/override");
    }

    @Test
    @DisplayName("P11: Plant-Head single signature approves and the gate honors it once")
    void plantHeadClearsGateOnce() throws Exception {
        String jcNo = "JC-QG-" + SEQ.incrementAndGet();
        seedJobCardAndInspection(jcNo, "OP-9100", "HOLD"); // gateStatus HELD is blocking
        String admin = adminToken();
        long entryId = createDraftEntry(admin, jcNo, "OP-9100", String.valueOf(SEQ.incrementAndGet()));

        assertEquals(400, postEntry(admin, entryId, "idem-ph-post-1-" + jcNo),
                "HELD inspection must block entry post");

        long inspectionId = inspectionId(jcNo);
        long ovrId = requestOverride(admin, inspectionId);
        mockMvc.perform(post("/api/v1/production/quality-gate/overrides/{id}/sign-plant-head", ovrId)
                        .header("Authorization", "Bearer " + token("ph-user", "PLANT_HEAD")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.category").value("PLANT_HEAD"));

        assertEquals(200, postEntry(admin, entryId, "idem-ph-post-2-" + jcNo));
        mockMvc.perform(get("/api/v1/production/quality-gate/overrides/{id}", ovrId)
                        .header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.override.status").value("APPLIED"));
    }

    @Test
    @DisplayName("P11: duplicate override request for one inspection is idempotent")
    void duplicateRequestIdempotent() throws Exception {
        String jcNo = "JC-QG-" + SEQ.incrementAndGet();
        seedJobCardAndInspection(jcNo, "OP-9200", "SUBMITTED");
        String admin = adminToken();
        long inspectionId = inspectionId(jcNo);

        long first = requestOverride(admin, inspectionId);
        long second = requestOverride(admin, inspectionId);
        assertEquals(first, second, "duplicate request must return the original override");
        assertEquals(1, count("production_gate_override", "inspection_id=" + inspectionId));
    }

    @Test
    @DisplayName("P11: a user without the Plant-Head authority cannot sign as Plant Head")
    void unauthorizedPlantHeadSignRefused() throws Exception {
        String jcNo = "JC-QG-" + SEQ.incrementAndGet();
        seedJobCardAndInspection(jcNo, "OP-9300", "SUBMITTED");
String admin = adminToken();
        long inspectionId = inspectionId(jcNo);
        long ovrId = requestOverride(admin, inspectionId);
        mockMvc.perform(post("/api/v1/production/quality-gate/overrides/{id}/sign-plant-head", ovrId)
                        .header("Authorization", "Bearer " + token("qc-user", "QUALITY_MANAGER")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail").value(
                        org.hamcrest.Matchers.containsString("PLANT_HEAD")));
        mockMvc.perform(get("/api/v1/production/quality-gate/overrides/{id}", ovrId)
                        .header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.override.status").value("PENDING"));
    }

    @Test
    @DisplayName("P11: gate status endpoint reports blockers for the UI")
    void gateStatusReportsBlockers() throws Exception {
        String jcNo = "JC-QG-" + SEQ.incrementAndGet();
        seedJobCardAndInspection(jcNo, "OP-9400", "FAIL"); // FAIL is blocking
        String admin = adminToken();

        mockMvc.perform(get("/api/v1/production/quality-gate/status")
                        .header("Authorization", "Bearer " + admin)
                        .param("jobCardNumber", jcNo))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.jobCardGate").value("BLOCKED"))
                .andExpect(jsonPath("$.operations[0].qualityBlocked").value(true))
                .andExpect(jsonPath("$.operations[0].blockers[0].docNo").value("QC-QG-" + jcNo))
                .andExpect(jsonPath("$.operations[0].blockers[0].gateStatus").value("FAIL"));
    }
}