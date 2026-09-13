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

import java.math.BigDecimal;
import java.time.Instant;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ProductionEntryValidationServiceTest {

    @Mock
    private RouteSheetRepository routeSheetRepo;

    @Mock
    private JobCardRepository jobCardRepo;

    @Mock
    private JobCardSubjobRepository subjobRepo;

    @Mock
    private MachineMasterRepository machineRepo;

    @Mock
    private ProductionEntryRepository productionEntryRepo;

    @Mock
    private ItemRepository itemRepo;

    @InjectMocks
    private ProductionEntryValidationService validationService;

    private ProductionEntry validEntry;

    @BeforeEach
    void setUp() {
        validEntry = ProductionEntry.builder()
                .productionType("GENERAL")
                .supervisorCode("SUP001")
                .jobCardNumber("JC1001")
                .workOrderNumber("WO1001")
                .operationCode("TURNING")
                .processQty(new BigDecimal("100"))
                .goodQuantity(new BigDecimal("100"))
                .rejectedQuantity(BigDecimal.ZERO)
                .reworkQuantity(BigDecimal.ZERO)
                .scrapQuantity(BigDecimal.ZERO)
                .pendingSequenceOnly(true)
                .build();
    }

    @Test
    @DisplayName("V-01: Production Type is mandatory")
    void testMissingProductionType() {
        validEntry.setProductionType(null);
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("Production Type is mandatory"));
    }

    @Test
    @DisplayName("V-02: Supervisor is mandatory")
    void testMissingSupervisor() {
        validEntry.setSupervisorCode("");
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("Supervisor is mandatory"));
    }

    @Test
    @DisplayName("V-03: Route Sheet operation context (Work Order / Job Card) is mandatory")
    void testMissingOperationContext() {
        validEntry.setJobCardNumber(null);
        validEntry.setWorkOrderNumber(null);
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("Route Sheet operation context is mandatory"));
    }

    @Test
    @DisplayName("V-04: Process / Operation is mandatory")
    void testMissingOperationCode() {
        validEntry.setOperationCode(null);
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("Process is mandatory"));
    }

    @Test
    @DisplayName("V-05: Process quantity must be greater than zero")
    void testZeroProcessQuantity() {
        validEntry.setProcessQty(BigDecimal.ZERO);
        validEntry.setProducedQuantity(BigDecimal.ZERO);
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("Process quantity must be greater than zero"));
    }

    @Test
    @DisplayName("V-07: Accepted + rejected + rework + scrap cannot exceed process quantity")
    void testAllocationExceedsProcessQty() {
        // 100 process, but 30 good + 10 reject + 20 rework + 50 scrap = 110 > 100
        validEntry.setGoodQuantity(new BigDecimal("30"));
        validEntry.setRejectedQuantity(new BigDecimal("10"));
        validEntry.setReworkQuantity(new BigDecimal("20"));
        validEntry.setScrapQuantity(new BigDecimal("50"));
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("Accepted, rejected and rework quantities cannot exceed process quantity"));
    }

    @Test
    @DisplayName("V-09: Rework quantity requires a rework reason")
    void testReworkReasonMandatory() {
        validEntry.setGoodQuantity(new BigDecimal("80"));
        validEntry.setReworkQuantity(new BigDecimal("20"));
        validEntry.setRejectedQuantity(BigDecimal.ZERO);
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("Rework reason is mandatory"));
    }

    @Test
    @DisplayName("V-11: End time cannot be earlier than start time")
    void testEndBeforeStart() {
        Instant start = Instant.now();
        Instant end = start.minusSeconds(600);
        validEntry.setStartTime(start);
        validEntry.setEndTime(end);
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("End time cannot be earlier than start time"));
    }

    @Test
    @DisplayName("V-13: Idle reason is mandatory when idle time is positive")
    void testIdleReasonMandatory() {
        Instant start = Instant.now();
        Instant end = start.plusSeconds(3600); // 60 mins
        validEntry.setStartTime(start);
        validEntry.setEndTime(end);
        validEntry.setIdleTime(new BigDecimal("10"));
        validEntry.setIdleReason(null);
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("Idle reason is mandatory"));
    }

    @Test
    @DisplayName("V-15 & V-16: Selected machine must exist and be active")
    void testInactiveMachine() {
        validEntry.setMachineCode("MISSING");
        when(machineRepo.existsByCode("MISSING")).thenReturn(false);
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("Selected machine is inactive or does not exist"));
    }

    @Test
    @DisplayName("V-19: Consumed RM quantity cannot exceed available quantity")
    void testMaterialConsumptionExceedsAvailable() {
        ProductionEntryMaterial mat = ProductionEntryMaterial.builder()
                .rmCode("RM01")
                .consumedQty(new BigDecimal("50"))
                .availableQty(new BigDecimal("30"))
                .build();
        validEntry.setMaterials(List.of(mat));
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("exceeds available quantity"));
    }

    @Test
    @DisplayName("V-20: Batch allocation must equal good or process quantity")
    void testIncompleteBatchAllocation() {
        validEntry.setGoodQuantity(new BigDecimal("100"));
        ProductionEntryBatch batch = ProductionEntryBatch.builder()
                .batchNumber("B001")
                .allocatedQty(new BigDecimal("40"))
                .build();
        validEntry.setBatchAllocations(List.of(batch));
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("Batch allocation is incomplete"));
    }

    @Test
    @DisplayName("V-08 & V-10: Rejected quantity requires rejection reason matching rejected qty")
    void testRejectionReasonValidation() {
        validEntry.setRejectedQuantity(new BigDecimal("10"));
        validEntry.setGoodQuantity(new BigDecimal("90"));

        // No reason provided
        IllegalArgumentException ex1 = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex1.getMessage().contains("Rejection reason is mandatory"));

        // Reason provided but total quantity mismatched
        ProductionEntryRejection rej = ProductionEntryRejection.builder()
                .reasonCode("R01")
                .quantity(new BigDecimal("5"))
                .build();
        validEntry.setRejectionReasons(List.of(rej));

        IllegalArgumentException ex2 = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex2.getMessage().contains("Reason-wise rejection quantity must equal rejected quantity"));
    }

    @Test
    @DisplayName("V-12: Idle time cannot exceed operation elapsed time")
    void testIdleTimeExceedsElapsed() {
        Instant start = Instant.now();
        Instant end = start.plusSeconds(1800); // 30 mins
        validEntry.setStartTime(start);
        validEntry.setEndTime(end);
        validEntry.setIdleTime(new BigDecimal("45")); // 45 mins idle > 30 mins elapsed
        validEntry.setIdleReason("MACHINE_BREAKDOWN");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("Idle time cannot exceed operation elapsed time"));
    }

    @Test
    @DisplayName("V-17: Cannot post out of sequence operation when Pending Sequence Only is enabled")
    void testOutofSequenceOperation() {
        JobCardSubjob sj1 = JobCardSubjob.builder().sequenceNo(1).operationCode("TURNING").status("IN_PROGRESS").build();
        JobCardSubjob sj2 = JobCardSubjob.builder().sequenceNo(2).operationCode("MILLING").status("PENDING").build();

        when(subjobRepo.findByJobCardJobCardNumber("JC1001")).thenReturn(new ArrayList<>(List.of(sj1, sj2)));

        // Attempting MILLING when TURNING is not COMPLETED/POSTED
        validEntry.setOperationCode("MILLING");
        validEntry.setPendingSequenceOnly(true);

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validateSequenceAndPending(validEntry));
        assertTrue(ex.getMessage().contains("not currently eligible according to the Route Sheet sequence"));
    }

    @Test
    @DisplayName("V-06 & V-18: Cannot over-consume pending quantity including draft soft reservations")
    void testOverConsumePendingQuantityWithDrafts() {
        JobCardSubjob sj1 = JobCardSubjob.builder()
                .sequenceNo(1)
                .operationCode("TURNING")
                .status("IN_PROGRESS")
                .plannedQuantity(new BigDecimal("100"))
                .completedQuantity(new BigDecimal("60"))
                .build();

        when(subjobRepo.findByJobCardJobCardNumber("JC1001")).thenReturn(new ArrayList<>(List.of(sj1)));

        // Other draft entry taking 20 units
        ProductionEntry draftEntry = ProductionEntry.builder()
                .id(99L)
                .processQty(new BigDecimal("20"))
                .status("DRAFT")
                .build();
        when(productionEntryRepo.findByJobCardNumberAndOperationCodeAndStatus("JC1001", "TURNING", "DRAFT"))
                .thenReturn(List.of(draftEntry));

        // Available pending = 100 - 60 - 20 = 20. Attempting 30.
        // Now a BusinessRuleException (OVERPRODUCTION_LIMIT) rather than a plain
        // IllegalArgumentException, since a Production Supervisor/Plant Head override with a
        // reason can clear it (Production Module FRS §5.3 BR) — no override supplied here,
        // so it still blocks, just with a more specific/overridable exception type.
        validEntry.setProcessQty(new BigDecimal("30"));
        in.zygertechnology.zygererp.config.BusinessRuleException ex = assertThrows(
                in.zygertechnology.zygererp.config.BusinessRuleException.class,
                () -> validationService.validateSequenceAndPending(validEntry));
        assertTrue(ex.getMessage().contains("exceeds the available pending quantity"));
    }

    // ---- P8 Capability A: additional (co/by-product) outputs (DOCUMENT_58 §8) ----

    private ProductionEntryOutput output(String type, String item, String location, String qty) {
        return ProductionEntryOutput.builder()
                .outputType(type)
                .itemCode(item)
                .location(location)
                .quantity(qty == null ? null : new BigDecimal(qty))
                .build();
    }

    @Test
    @DisplayName("P8: valid additional outputs pass primary reconciliation unchanged")
    void validAdditionalOutputsPass() {
        when(itemRepo.existsByCode("CO-1")).thenReturn(true);
        when(itemRepo.existsByCode("SW-1")).thenReturn(true);
        validEntry.setAdditionalOutputs(new ArrayList<>(List.of(
                output("CO_PRODUCT", "CO-1", "STORE", "30.0000"),
                output("BY_PRODUCT", "SW-1", "SWARD", "5.0000"))));
        assertDoesNotThrow(() -> validationService.validate(validEntry));
    }

    @Test
    @DisplayName("P8: additional output quantity must be greater than zero")
    void additionalOutputZeroOrNegativeRejected() {
        validEntry.setAdditionalOutputs(new ArrayList<>(List.of(output("CO_PRODUCT", "CO-1", "STORE", "0"))));
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("greater than zero"));

        validEntry.setAdditionalOutputs(new ArrayList<>(List.of(output("CO_PRODUCT", "CO-1", "STORE", "-5"))));
        ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("greater than zero"));
    }

    @Test
    @DisplayName("P8: additional output item code is mandatory and must exist in item master")
    void additionalOutputItemRequiredAndKnown() {
        validEntry.setAdditionalOutputs(new ArrayList<>(List.of(output("CO_PRODUCT", "", "STORE", "10"))));
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("item code is mandatory"));

        when(itemRepo.existsByCode("UNKNOWN-1")).thenReturn(false);
        validEntry.setAdditionalOutputs(new ArrayList<>(List.of(output("CO_PRODUCT", "UNKNOWN-1", "STORE", "10"))));
        ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("does not exist in the item master"));
    }

    @Test
    @DisplayName("P8: additional output type restricted to CO_PRODUCT / BY_PRODUCT")
    void additionalOutputTypeRestricted() {
        validEntry.setAdditionalOutputs(new ArrayList<>(List.of(output("SCRAP", "CO-1", "STORE", "10"))));
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("CO_PRODUCT or BY_PRODUCT"));
    }

    @Test
    @DisplayName("P8: duplicate (outputType, itemCode, location) within one entry is rejected")
    void additionalOutputDuplicateRejected() {
        when(itemRepo.existsByCode("CO-1")).thenReturn(true);
        validEntry.setAdditionalOutputs(new ArrayList<>(List.of(
                output("CO_PRODUCT", "CO-1", "STORE", "10"),
                output("CO_PRODUCT", "CO-1", "STORE", "10"))));
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("Duplicate additional output"));
    }

    @Test
    @DisplayName("P8: additional output weight cannot be negative")
    void additionalOutputNegativeWeightRejected() {
        when(itemRepo.existsByCode("CO-1")).thenReturn(true);
        ProductionEntryOutput o = output("CO_PRODUCT", "CO-1", "STORE", "10");
        o.setWeight(new BigDecimal("-2"));
        validEntry.setAdditionalOutputs(new ArrayList<>(List.of(o)));
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> validationService.validate(validEntry));
        assertTrue(ex.getMessage().contains("weight cannot be negative"));
    }
}
