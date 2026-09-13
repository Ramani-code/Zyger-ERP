package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import in.zygertechnology.zygererp.config.AuditEntityListener;

@Entity
@Table(name = "job_card")
@Getter @Setter @Builder
@NoArgsConstructor @AllArgsConstructor
@EntityListeners(AuditEntityListener.class)
public class JobCard {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "job_card_number", unique = true, length = 60)
    private String jobCardNumber;

    @Column(name = "work_order_number", length = 60)
    private String workOrderNumber;

    @Column(name = "work_order_id")
    private Long workOrderId;

    @Column(name = "route_operation_id")
    private Long routeOperationId;

    @Column(name = "part_code", length = 60)
    private String partCode;

    @Column(name = "part_description", length = 255)
    private String partDescription;

    @Column(name = "revision", length = 20)
    private String revision;

    @Column(name = "plant_id") Long plantId;

    @Column(name = "planned_quantity", precision = 18, scale = 4)
    private BigDecimal plannedQuantity;

    @Column(name = "completed_qty_computed", precision = 18, scale = 4, insertable = false, updatable = false)
    private BigDecimal completedQtyComputed;

    @Column(name = "rework_qty_computed", precision = 18, scale = 4, insertable = false, updatable = false)
    private BigDecimal reworkQtyComputed;

    @Column(name = "reject_qty_computed", precision = 18, scale = 4, insertable = false, updatable = false)
    private BigDecimal rejectQtyComputed;

    @Column(name = "scrap_qty_computed", precision = 18, scale = 4, insertable = false, updatable = false)
    private BigDecimal scrapQtyComputed;

    @Column(name = "completed_quantity", precision = 18, scale = 4)
    private BigDecimal completedQuantity;

    @Column(name = "rework_quantity", precision = 18, scale = 4)
    private BigDecimal reworkQuantity;

    @Column(name = "rejected_quantity", precision = 18, scale = 4)
    private BigDecimal rejectedQuantity;

    @Column(name = "scrap_quantity", precision = 18, scale = 4)
    private BigDecimal scrapQuantity;

    @Column(length = 20)
    private String priority;

    @Column(name = "planned_start_date")
    private Instant plannedStartDate;

    @Column(name = "planned_end_date")
    private Instant plannedEndDate;

    @Column(name = "actual_start_date")
    private Instant actualStartDate;

    @Column(name = "actual_end_date")
    private Instant actualEndDate;

    @Column(name = "route_sheet_number", length = 60)
    private String routeSheetNumber;

    @Column(name = "bom_number", length = 60)
    private String bomNumber;

    @Column(name = "customer_code", length = 60)
    private String customerCode;

    @Column(length = 30)
    private String status;

    @Column(name = "completion_status", length = 30)
    private String completionStatus;

    @Column(name = "release_remarks", length = 500)
    private String releaseRemarks;

    @Column(name = "complete_remarks", length = 500)
    private String completeRemarks;

    /** Production Module FRS §5.3 BR: reason a Production Supervisor/Plant Head gave to
     * override the overproduction-tolerance block at completion. Null when no override
     * was needed. */
    @Column(name = "override_reason", length = 500)
    private String overrideReason;

    @Column(name = "hold_reason", length = 255)
    private String holdReason;

    @Column(length = 500)
    private String remarks;

    @OneToMany(mappedBy = "jobCard", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @Builder.Default
    private List<JobCardSubjob> subjobs = new ArrayList<>();

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
}
