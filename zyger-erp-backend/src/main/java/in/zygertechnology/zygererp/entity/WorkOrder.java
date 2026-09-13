package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.math.BigDecimal;

@Entity @Table(name = "work_order") @Getter @Setter @DocKey("work-order")
public class WorkOrder extends BaseDoc implements DocEntity {
    @Column(name = "wo_number", unique = true) String woNumber;
    @Column(name = "wo_type", length = 30) String woType;
    @Column(name = "source_type", length = 30) String sourceType;
    @Column(name = "source_doc_no", length = 60) String sourceDocNo;
    @Column(name = "customer_code", length = 60) String customerCode;
    @Column(name = "customer_order_no", length = 60) String customerOrderNo;
    @Column(name = "item_code", nullable = false, length = 60) String itemCode;
    @Column(name = "item_description", length = 255) String itemDescription;
    @Column(name = "item_revision", length = 30) String itemRevision;
    @Column(name = "drawing_number", length = 60) String drawingNumber;
    @Column(name = "drawing_rev", length = 30) String drawingRev;
    @Column(name = "order_quantity", nullable = false) BigDecimal orderQuantity;
    @Column(length = 20) String uom;
    @Column(length = 20) String priority;
    @Column(name = "due_date") LocalDate dueDate;
    @Column(name = "planned_start_date") LocalDate plannedStartDate;
    @Column(name = "planned_end_date") LocalDate plannedEndDate;
    @Column(name = "actual_start_date") LocalDate actualStartDate;
    @Column(name = "actual_end_date") LocalDate actualEndDate;
    String plant;
    @Column(name = "production_line", length = 60) String productionLine;
    @Column(name = "bom_id") Long bomId;
    @Column(name = "bom_code", length = 60) String bomCode;
    @Column(name = "bom_revision", length = 20) String bomRevision;
    @Column(name = "route_id") Long routeId;
    @Column(name = "route_sheet_code", length = 60) String routeSheetCode;
    @Column(name = "route_revision", length = 20) String routeRevision;
    @Column(name = "pending_qty") BigDecimal pendingQty;
    @Column(name = "production_qty") BigDecimal productionQty;
    @Column(name = "sales_order_id") Long salesOrderId;
    @Column(name = "sales_order_no", length = 30) String salesOrderNo;
    @Column(name = "so_line_id") Long soLineId;
    @Column(name = "sales_order_line_no", length = 20) String salesOrderLineNo;
    @Column(name = "released_qty") BigDecimal releasedQty;
    @Column(name = "completed_qty") BigDecimal completedQty;
    @Column(name = "rejected_qty") BigDecimal rejectedQty;
    @Column(name = "scrap_qty") BigDecimal scrapQty;
    @Column(name = "balance_qty") BigDecimal balanceQty;
    @Column(name = "promised_delivery_date") LocalDate promisedDeliveryDate;
    @Column(name = "batch_lot_no", length = 60) String batchLotNo;
    @Column(name = "production_department", length = 100) String productionDepartment;
    @Column(name = "approved_by", length = 60) String approvedBy;
    /** Production Module FRS §7 BR: snapshot of qty/due date at the moment of approval, so
     * "release" can detect whether they were edited since — a deviation that requires
     * Production Supervisor/Plant Head authorization rather than auto-releasing. */
    @Column(name = "approved_quantity", precision = 18, scale = 4) BigDecimal approvedQuantity;
    @Column(name = "approved_due_date") LocalDate approvedDueDate;
    @Column(name = "released_by", length = 60) String releasedBy;
    @Column(name = "closed_by", length = 60) String closedBy;
    @Column(name = "started_by", length = 60) String startedBy;
    @Column(name = "started_at") Instant startedAt;
    @Column(name = "completed_by", length = 60) String completedBy;
    @Column(name = "completed_at") Instant completedAt;
    @Column(name = "cancel_reason", length = 500) String cancelReason;
    @Column(name = "hold_reason", length = 500) String holdReason;
    @Column(name = "short_close_reason", length = 500) String shortCloseReason;
    /** FRS §3.1: quantity received into FG store */
    @Column(name = "fg_receipt_qty") BigDecimal fgReceiptQty;
    /** FRS §3.1: scrap allowance % on WO header */
    @Column(name = "scrap_allowance_percent") BigDecimal scrapAllowancePercent;

    @OneToMany(mappedBy = "doc", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    List<WorkOrderOperation> operations = new ArrayList<>();

    @OneToMany(mappedBy = "doc", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    List<WorkOrderMaterial> materials = new ArrayList<>();

    @OneToMany(mappedBy = "workOrder", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @com.fasterxml.jackson.annotation.JsonIgnore
    List<WorkOrderStatusHistory> statusHistory = new ArrayList<>();

    @SuppressWarnings("unchecked")
    @Override public List<WorkOrderOperation> getLines() { return (List<WorkOrderOperation>)(List<? extends LineEntity>) operations; }

    @com.fasterxml.jackson.annotation.JsonProperty("materialLines")
    public List<WorkOrderMaterial> getMaterialLines() { return materials; }

    @com.fasterxml.jackson.annotation.JsonProperty("materialLines")
    public void setMaterialLines(List<WorkOrderMaterial> materialLines) {
        this.materials = materialLines != null ? materialLines : new ArrayList<>();
    }

    @com.fasterxml.jackson.annotation.JsonProperty("routeCode")
    public String getRouteCode() { return routeSheetCode; }

    @com.fasterxml.jackson.annotation.JsonProperty("routeCode")
    public void setRouteCode(String routeCode) { if (routeCode != null && !routeCode.isBlank()) this.routeSheetCode = routeCode; }

    @com.fasterxml.jackson.annotation.JsonProperty("routeSheet")
    public String getRouteSheet() { return routeSheetCode; }

    @com.fasterxml.jackson.annotation.JsonProperty("routeSheet")
    public void setRouteSheet(String routeSheet) { if (routeSheet != null && !routeSheet.isBlank()) this.routeSheetCode = routeSheet; }
}
