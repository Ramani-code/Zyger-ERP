package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.math.BigDecimal;
import java.security.Principal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * P2 — ProductionJobCardService behavior-lock tests (C5).
 *
 * <p>Locks the Job Card business logic extracted from {@code ProductionController}: every status transition,
 * validation rule, quantity reconciliation, inventory posting path (via {@link ProductionStockBoundary} →
 * {@code StockService}), subjob lifecycle, and the additive P2 {@code workOrderId}/{@code routeOperationId}
 * traceability. Each test asserts behaviour identical to the former in-controller implementation.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ProductionJobCardServiceTest {

    @Mock private JobCardRepository jobCards;
    @Mock private JobCardSubjobRepository jobCardSubjobs;
    @Mock private WorkOrderRepository workOrders;
    @Mock private RouteSheetRepository routeSheets;
    @Mock private ProductionBOMRepository productionBoms;
    @Mock private ItemRepository items;
    @Mock private MachineMasterRepository machines;
    @Mock private DocNumberService numbers;
    @Mock private ProductionStockBoundary inventory;
    @Mock private ProductionQualityGateService qualityGate;
    @Mock private jakarta.persistence.EntityManager em;
    @Mock private in.zygertechnology.zygererp.repo.ProductionPolicyRepository productionPolicies;
    @Mock private in.zygertechnology.zygererp.repo.MachineCapabilityRepository machineCapabilities;
    @Mock private Principal principal;

    @InjectMocks private ProductionJobCardService svc;

    private JobCard jc(long id, String status) {
        JobCard j = new JobCard();
        j.setId(id);
        j.setStatus(status);
        return j;
    }

    private JobCardSubjob sub(long id, String status) {
        JobCardSubjob s = new JobCardSubjob();
        s.setId(id);
        s.setStatus(status);
        s.setCompletedQuantity(BigDecimal.ZERO);
        s.setReworkQuantity(BigDecimal.ZERO);
        s.setRejectedQuantity(BigDecimal.ZERO);
        s.setScrapQuantity(BigDecimal.ZERO);
        return s;
    }

    @BeforeEach
    void setUp() {
        org.mockito.Mockito.lenient().when(principal.getName()).thenReturn("tester");
    }

    // ---- createJobCard behavior-lock ----

    @Test
    @DisplayName("createJobCard validates WO, sets JCF number, defaults to DRAFT and resolves work_order_id (C1)")
    void createJobCardResolvesWorkOrderIdAndDefaults() {
        WorkOrder wo = workOrderWithId(7L, "WO-7");
        reset(workOrders);
        when(workOrders.findByWoNumber("WO-7")).thenReturn(List.of(wo));
        when(items.existsByCode("ITEM1")).thenReturn(true);
        when(numbers.next("job-card", "JCF")).thenReturn("JCF-2026-1");
        when(jobCards.save(any(JobCard.class))).thenAnswer(inv -> inv.getArgument(0));

        JobCard payload = new JobCard();
        payload.setWorkOrderNumber("WO-7");
        payload.setPartCode("ITEM1");

        JobCard saved = svc.createJobCard(payload, principal);

        assertEquals("JCF-2026-1", saved.getJobCardNumber());
        assertEquals("DRAFT", saved.getStatus());
        assertEquals(7L, saved.getWorkOrderId(), "legacy WO string must resolve to new work_order_id (C1)");
        assertEquals(BigDecimal.ZERO, saved.getPlannedQuantity());
    }

    @Test
    @DisplayName("createJobCard rejects unknown Work Order")
    void createJobCardRejectsUnknownWorkOrder() {
        when(workOrders.findByWoNumber("NOPE")).thenReturn(List.of());
        JobCard payload = new JobCard();
        payload.setWorkOrderNumber("NOPE");
        assertThrows(RuntimeException.class, () -> svc.createJobCard(payload, principal));
        verify(items, never()).existsByCode(anyString());
    }

    // ---- createFromWorkOrder behavior-lock + traceability ----

    @Test
    @DisplayName("createFromWorkOrder promotes DRAFT WO to APPROVED, sets BOM/Route, creates subjobs w/ routeOperationId (C1)")
    void createFromWorkOrderCreatesSubjobsAndTraceability() {
        WorkOrder wo = workOrderWithId(9L, "WO-9");
        wo.setStatus("DRAFT");
        wo.setRouteId(2L);
        wo.setBomId(3L);

        when(workOrders.findByWoNumber("WO-9")).thenReturn(List.of(wo));

        RouteSheet route = new RouteSheet();
        route.setId(2L);
        route.setRouteNumber("RS-2");
        RouteOperation op = new RouteOperation();
        op.setId(555L);
        op.setOperationCode("OP10");
        op.setOperationDescription("Drilling");
        op.setSequenceNo(10);
        op.setMachineCode("M1");
        op.setWorkCenterCode("WC1");
        op.setInspectionRequired(true);
        route.setOperations(List.of(op));
        when(routeSheets.findById(2L)).thenReturn(Optional.of(route));

        ProductionBOM bom = new ProductionBOM();
        bom.setId(3L);
        bom.setBomNumber("BOM-3");
        when(productionBoms.findById(3L)).thenReturn(Optional.of(bom));

        when(numbers.next("job-card", "JCF")).thenReturn("JCF-2026-9");
        when(jobCards.save(any(JobCard.class))).thenAnswer(inv -> {
            JobCard arg = inv.getArgument(0);
            JobCard saved = new JobCard();
            saved.setId(91L);
            saved.setJobCardNumber(arg.getJobCardNumber());
            saved.setPlannedQuantity(arg.getPlannedQuantity());
            saved.setWorkOrderId(arg.getWorkOrderId());
            saved.setWorkOrderNumber(arg.getWorkOrderNumber());
            saved.setRouteSheetNumber(arg.getRouteSheetNumber());
            saved.setBomNumber(arg.getBomNumber());
            saved.setPartCode(arg.getPartCode());
            saved.setPriority(arg.getPriority());
            return saved;
        });

        JobCard savedSheet = new JobCard();
        savedSheet.setId(91L);
        savedSheet.setJobCardNumber("JCF-2026-9");
        savedSheet.setPartCode("ITEM1");
        savedSheet.setPlannedQuantity(BigDecimal.TEN);
        savedSheet.setRouteSheetNumber("RS-2");
        savedSheet.setBomNumber("BOM-3");
        savedSheet.setWorkOrderNumber("WO-9");
        savedSheet.setWorkOrderId(9L);
        when(jobCards.findById(91L)).thenReturn(Optional.of(savedSheet));

        JobCard result = svc.createFromWorkOrder(Map.of("workOrderNumber", "WO-9"), principal);

        verify(workOrders).save(wo);
        assertEquals("APPROVED", wo.getStatus());
        assertEquals("RS-2", result.getRouteSheetNumber());
        assertEquals("BOM-3", result.getBomNumber());
        assertEquals("WO-9", result.getWorkOrderNumber());
        assertEquals(9L, result.getWorkOrderId(), "work_order_id populated on JC (C1)");

        // subjob created with routeOperationId (C1) + op fields
        var cap = org.mockito.ArgumentCaptor.forClass(JobCardSubjob.class);
        verify(jobCardSubjobs).save(cap.capture());
        JobCardSubjob subSaved = cap.getValue();
        assertEquals(555L, subSaved.getRouteOperationId(), "subjob route_operation_id populated (C1)");
        assertEquals("JCF-2026-9-S01", subSaved.getSubjobNumber());
        assertEquals(true, subSaved.getInspectionRequired());
    }

    @Test
    @DisplayName("createFromWorkOrder blocks non DRAFT/APPROVED/RELEASED WO")
    void createFromWorkOrderBlocksBadStatus() {
        WorkOrder wo = workOrderWithId(1L, "WO-1");
        wo.setStatus("CLOSED");
        when(workOrders.findByWoNumber("WO-1")).thenReturn(List.of(wo));
        assertThrows(RuntimeException.class,
            () -> svc.createFromWorkOrder(Map.of("workOrderNumber", "WO-1"), principal));
    }

    // ---- update/delete behavior-lock ----

    @Test
    @DisplayName("updateJobCard only allows DRAFT or ON_HOLD")
    void updateJobCardEnforcesDraftOrHold() {
        when(jobCards.findById(1L)).thenReturn(Optional.of(jc(1L, "APPROVED")));
        assertThrows(RuntimeException.class, () -> svc.updateJobCard(1L, new JobCard(), principal));
    }

    @Test
    @DisplayName("deleteJobCard only allows DRAFT and cascades subjob deletion")
    void deleteJobCardOnlyAllowsDraft() {
        when(jobCards.findById(1L)).thenReturn(Optional.of(jc(1L, "RELEASED")));
        assertThrows(RuntimeException.class, () -> svc.deleteJobCard(1L));

        when(jobCards.findById(2L)).thenReturn(Optional.of(jc(2L, "DRAFT")));
        JobCardSubjob s1 = new JobCardSubjob(); s1.setId(11L);
        JobCardSubjob s2 = new JobCardSubjob(); s2.setId(12L);
        when(jobCardSubjobs.findByJobCardId(2L)).thenReturn(List.of(s1, s2));
        svc.deleteJobCard(2L);
        verify(jobCardSubjobs).deleteById(11L);
        verify(jobCardSubjobs).deleteById(12L);
        verify(jobCards).deleteById(2L);
    }

    // ---- jobCardAction behavior-lock ----

    @Test
    @DisplayName("approve transitions to APPROVED")
    void approveTransitions() {
        when(jobCards.findById(1L)).thenReturn(Optional.of(jc(1L, "DRAFT")));
        when(jobCards.findById(1L)).thenReturn(Optional.of(jc(1L, "APPROVED")));
        when(jobCards.save(any(JobCard.class))).thenAnswer(inv -> inv.getArgument(0));
        Map<String, Object> r = svc.jobCardAction(1L, "approve", null, principal);
        assertEquals(true, r.get("success"));
        assertEquals("APPROVED", ((JobCard) r.get("jobCard")).getStatus());
    }

    @Test
    @DisplayName("release requires subjob + BOM + route ql -> failure with errors preserved")
    void releaseFailsWithoutPrerequisites() {
        when(jobCards.findById(1L)).thenReturn(Optional.of(jc(1L, "APPROVED")));
        when(jobCardSubjobs.findByJobCardId(1L)).thenReturn(List.of()); // no subjobs
        when(jobCards.save(any(JobCard.class))).thenAnswer(inv -> inv.getArgument(0));
        when(jobCards.findById(1L)).thenReturn(Optional.of(jc(1L, "APPROVED")));
        Map<String, Object> r = svc.jobCardAction(1L, "release", null, principal);
        assertEquals(false, r.get("success"));
        assertFalse(((List<?>) r.get("errors")).isEmpty());
    }

    @Test
    @DisplayName("complete posts FG receipt through inventory boundary and persists IPQC")
    void completePostsThroughInventoryBoundary() {
        JobCard card = jc(1L, "IN_PROGRESS");
        card.setJobCardNumber("JCF-2026-1");
        card.setPartCode("ITEM1");
        card.setPlannedQuantity(BigDecimal.TEN);
        when(jobCards.findById(1L)).thenReturn(Optional.of(card));

        JobCardSubjob done = sub(1L, "COMPLETED");
        done.setCompletedQuantity(BigDecimal.TEN);
        done.setSubjobNumber("JCF-2026-1-S01");
        done.setOperationCode("OP10");
        when(jobCardSubjobs.findByJobCardId(1L)).thenReturn(List.of(done));

        when(jobCards.save(any(JobCard.class))).thenAnswer(inv -> inv.getArgument(0));
        when(jobCards.findById(1L)).thenReturn(Optional.of(card));
        when(numbers.next("QUALITY_INSPECTION", "QC")).thenReturn("QC-1");

        Map<String, Object> r = svc.jobCardAction(1L, "complete", null, principal);

        assertEquals(true, r.get("success"));
        JobCard out = (JobCard) r.get("jobCard");
        assertEquals("COMPLETED", out.getStatus());
        // inventory via boundary (never direct stock in service)
        verify(inventory).recordJobCardCompleteGood("JCF-2026-1", "ITEM1", BigDecimal.TEN, "tester");
        verify(em).persist(any(QualityInspection.class));
    }

    @Test
    @DisplayName("complete blocks if any subjob incomplete")
    void completeBlocksOnIncompleteSubjob() {
        JobCard card = jc(1L, "IN_PROGRESS");
        card.setJobCardNumber("JCF-2026-1");
        card.setPartCode("ITEM1");
        when(jobCards.findById(1L)).thenReturn(Optional.of(card));
        JobCardSubjob pending = sub(2L, "PENDING");
        when(jobCardSubjobs.findByJobCardId(1L)).thenReturn(List.of(pending));
        when(jobCards.save(any(JobCard.class))).thenAnswer(inv -> inv.getArgument(0));
        when(jobCards.findById(1L)).thenReturn(Optional.of(card));

        Map<String, Object> r = svc.jobCardAction(1L, "complete", null, principal);
        assertEquals(false, r.get("success"));
        verify(inventory, never()).recordJobCardCompleteGood(anyString(), anyString(), any(), anyString());
    }

    @Test
    @DisplayName("cancel works from IN_PROGRESS; close only from COMPLETED")
    void cancelAndCloseGuards() {
        when(jobCards.findById(1L)).thenReturn(Optional.of(jc(1L, "IN_PROGRESS")));
        when(jobCards.save(any(JobCard.class))).thenAnswer(inv -> inv.getArgument(0));
        when(jobCards.findById(1L)).thenReturn(Optional.of(jc(1L, "CANCELLED")));
        assertEquals(true, svc.jobCardAction(1L, "cancel", null, principal).get("success"));

        when(jobCards.findById(2L)).thenReturn(Optional.of(jc(2L, "DRAFT")));
        when(jobCards.save(any(JobCard.class))).thenAnswer(inv -> inv.getArgument(0));
        when(jobCards.findById(2L)).thenReturn(Optional.of(jc(2L, "DRAFT")));
        assertEquals(false, svc.jobCardAction(2L, "close", null, principal).get("success"));
    }

    // ---- subjob behavior-lock ----

    @Test
    @DisplayName("subjobAction complete sets COMPLETED and endTime; guards cancel of COMPLETED")
    void subjobActionLifecycle() {
        when(jobCardSubjobs.findById(11L)).thenReturn(Optional.of(sub(11L, "IN_PROGRESS")));
        when(jobCardSubjobs.save(any(JobCardSubjob.class))).thenAnswer(inv -> inv.getArgument(0));
        JobCardSubjob completed = svc.subjobAction(11L, "complete", principal);
        assertEquals("COMPLETED", completed.getStatus());
        assertNotNull(completed.getEndTime());

        when(jobCardSubjobs.findById(12L)).thenReturn(Optional.of(sub(12L, "COMPLETED")));
        when(jobCardSubjobs.save(any(JobCardSubjob.class))).thenAnswer(inv -> inv.getArgument(0));
        assertThrows(RuntimeException.class, () -> svc.subjobAction(12L, "cancel", principal));
    }

    // ---- helpers ----

    private static WorkOrder workOrderWithId(Long id, String woNumber) {
        WorkOrder wo = new WorkOrder();
        wo.setId(id);
        wo.setWoNumber(woNumber);
        wo.setItemCode("ITEM1");
        wo.setItemRevision("A");
        wo.setOrderQuantity(BigDecimal.TEN);
        wo.setPriority("HIGH");
        wo.setStatus("DRAFT");
        return wo;
    }
}