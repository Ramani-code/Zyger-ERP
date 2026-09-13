package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import in.zygertechnology.zygererp.config.AuditEntityListener;

@Entity
@Table(name = "production_entry")
@Getter @Setter @Builder
@NoArgsConstructor @AllArgsConstructor
@EntityListeners(AuditEntityListener.class)
public class ProductionEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "entry_number", unique = true, length = 60)
    private String entryNumber;

    @Column(name = "entry_type", length = 30)
    @Builder.Default
    private String entryType = "Production Entry";

    @Column(name = "production_type", length = 30)
    @Builder.Default
    private String productionType = "GENERAL"; // GENERAL or REWORK

    @Column(name = "supervisor_code", length = 60)
    private String supervisorCode;

    @Column(name = "supervisor_name", length = 200)
    private String supervisorName;

    @Column(name = "financial_year", length = 20)
    private String financialYear;

    @Column(name = "work_order_number", length = 60)
    private String workOrderNumber;

    @Column(name = "job_card_number", length = 60)
    private String jobCardNumber;

    @Column(name = "subjob_number", length = 60)
    private String subjobNumber;

    @Column(name = "route_sheet_number", length = 60)
    private String routeSheetNumber;

    @Column(name = "pending_sequence_only")
    @Builder.Default
    private Boolean pendingSequenceOnly = true;

    /** Production Module FRS §5.3 BR: a mandatory reason from a Production Supervisor/Plant
     * Head lets an entry push cumulative Good+Rejected+Rework past the Job Card's planned
     * quantity — otherwise that remains a hard block (see ProductionEntryValidationService). */
    @Column(name = "override_reason", length = 250)
    private String overrideReason;

    @Column(name = "part_code", length = 60)
    private String partCode;

    @Column(name = "part_description", length = 255)
    private String partDescription;

    @Column(name = "operation_code", length = 60)
    private String operationCode;

    @Column(name = "operation_sequence")
    private Integer operationSequence;

    @Column(name = "process_qty", precision = 18, scale = 4)
    private BigDecimal processQty;

    @Column(name = "route_sheet_qty", precision = 18, scale = 4)
    private BigDecimal routeSheetQty;

    @Column(name = "uom", length = 20)
    private String uom;

    @Column(name = "route_sheet_date")
    private LocalDate routeSheetDate;

    @Column(name = "machine_code", length = 60)
    private String machineCode;

    @Column(name = "operator_code", length = 60)
    private String operatorCode;

    @Column(name = "shift_code", length = 60)
    private String shiftCode;

    @Column(name = "production_date")
    private Instant productionDate;

    @Column(name = "start_time")
    private Instant startTime;

    @Column(name = "end_time")
    private Instant endTime;

    @Column(name = "process_time", precision = 14, scale = 2)
    private BigDecimal processTime;

    /** Production Module FRS §5.3 BR: true when processTime (Actual Run Time) exceeded the
     * Route Sheet's standard cycle time by more than ProductionPolicy.cycleTimeTolerancePercent
     * — a flag for supervisor review, not a block. Null/false when there's no route/operation
     * to compare against. */
    @Column(name = "cycle_time_variance_flagged")
    private Boolean cycleTimeVarianceFlagged;

    @Column(name = "process_rate", precision = 14, scale = 2)
    private BigDecimal processRate;

    @Column(name = "mhr", precision = 14, scale = 2)
    private BigDecimal mhr;

    @Column(name = "item_weight", precision = 14, scale = 4)
    private BigDecimal itemWeight;

    @Column(name = "idle_time", precision = 14, scale = 2)
    private BigDecimal idleTime;

    @Column(name = "idle_reason", length = 255)
    private String idleReason;

    @Column(name = "produced_quantity", precision = 18, scale = 4)
    private BigDecimal producedQuantity;

    @Column(name = "good_quantity", precision = 18, scale = 4)
    private BigDecimal goodQuantity;

    @Column(name = "rework_quantity", precision = 18, scale = 4)
    private BigDecimal reworkQuantity;

    @Column(name = "rejected_quantity", precision = 18, scale = 4)
    private BigDecimal rejectedQuantity;

    @Column(name = "scrap_quantity", precision = 18, scale = 4)
    private BigDecimal scrapQuantity;

    @Column(length = 30)
    private String status; // DRAFT, POSTED, SUBMITTED, APPROVED, REJECTED, CANCELLED, REVERSED

    @Column(name = "quality_status", length = 30)
    private String qualityStatus;

    @Column(name = "reversed_from_entry_id")
    private Long reversedFromEntryId;

    @Column(name = "is_reversal")
    @Builder.Default
    private Boolean isReversal = false;

    @Column(name = "reversal_reason", length = 500)
    private String reversalReason;

    @Column(length = 500)
    private String remarks;

    @Version
    private Long version;

    @Column(name = "created_by", length = 60)
    private String createdBy;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_by", length = 60)
    private String updatedBy;

    @Column(name = "updated_at")
    private Instant updatedAt;

    // --- Child Detail Collections ---

    @OneToMany(mappedBy = "productionEntry", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @Builder.Default
    private List<ProductionEntryOperator> operators = new ArrayList<>();

    @OneToMany(mappedBy = "productionEntry", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @Builder.Default
    private List<ProductionEntryRejection> rejectionReasons = new ArrayList<>();

    @OneToMany(mappedBy = "productionEntry", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @Builder.Default
    private List<ProductionEntryRework> reworkReasons = new ArrayList<>();

    @OneToMany(mappedBy = "productionEntry", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @Builder.Default
    private List<ProductionEntryMaterial> materials = new ArrayList<>();

    @OneToMany(mappedBy = "productionEntry", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @Builder.Default
    private List<ProductionEntryBatch> batchAllocations = new ArrayList<>();

    @OneToMany(mappedBy = "productionEntry", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @Builder.Default
    private List<ProductionEntryOutput> additionalOutputs = new ArrayList<>();

    public void setOperators(List<ProductionEntryOperator> list) {
        this.operators.clear();
        if (list != null) {
            for (ProductionEntryOperator o : list) {
                o.setProductionEntry(this);
                this.operators.add(o);
            }
        }
    }

    public void setRejectionReasons(List<ProductionEntryRejection> list) {
        this.rejectionReasons.clear();
        if (list != null) {
            for (ProductionEntryRejection r : list) {
                r.setProductionEntry(this);
                this.rejectionReasons.add(r);
            }
        }
    }

    public void setReworkReasons(List<ProductionEntryRework> list) {
        this.reworkReasons.clear();
        if (list != null) {
            for (ProductionEntryRework rw : list) {
                rw.setProductionEntry(this);
                this.reworkReasons.add(rw);
            }
        }
    }

    public void setMaterials(List<ProductionEntryMaterial> list) {
        this.materials.clear();
        if (list != null) {
            for (ProductionEntryMaterial m : list) {
                m.setProductionEntry(this);
                this.materials.add(m);
            }
        }
    }

    public void setBatchAllocations(List<ProductionEntryBatch> list) {
        this.batchAllocations.clear();
        if (list != null) {
            for (ProductionEntryBatch b : list) {
                b.setProductionEntry(this);
                this.batchAllocations.add(b);
            }
        }
    }

    public void setAdditionalOutputs(List<ProductionEntryOutput> list) {
        this.additionalOutputs = new ArrayList<>();
        if (list != null) {
            for (ProductionEntryOutput o : list) {
                o.setProductionEntry(this);
                this.additionalOutputs.add(o);
            }
        }
    }
}
