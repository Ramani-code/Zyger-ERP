package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import in.zygertechnology.zygererp.config.AuditEntityListener;
import java.math.BigDecimal;
import java.time.Instant;

@Entity @Table(name="item_master")
@EntityListeners(AuditEntityListener.class)
@Getter @Setter @Builder @NoArgsConstructor @AllArgsConstructor
public class ItemMaster {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) Long id;
    @Column(length = 60) String code;
    @Column(length = 200) String name;
    @Column(length = 200) String description;
    @Column(length = 20) String uom;
    @Column(length = 60) String category;
    BigDecimal defaultRate;
    BigDecimal safetyStock;
    @Builder.Default Boolean requiresBatch = Boolean.FALSE;
    @Builder.Default Boolean requiresHeat = Boolean.FALSE;
    @Builder.Default Boolean active = Boolean.TRUE;
    @Column(length = 30) String itemType;
    @Column(name = "drawing_number", length = 60) String drawingNumber;
    @Column(name = "drawing_revision", length = 30) String drawingRevision;
    @Column(length = 30) String revision;
    /** Forward FK to the canonical Drawing & Revision Master row for this item's current
     * drawing/revision — {@code drawingNumber}/{@code drawingRevision} above stay as the
     * denormalized display fields (too many existing read sites to remove them), this is
     * the new source of truth going forward. */
    @Column(name = "active_drawing_revision_id") Long activeDrawingRevisionId;
    @Column(name = "lead_time_days") Integer leadTimeDays;
    @Column(name = "min_order_qty") BigDecimal minOrderQty;
    @Column(name = "order_multiple") BigDecimal orderMultiple;
    @Column(name = "shelf_life_days") Integer shelfLifeDays;
    @Builder.Default Boolean batchControl = Boolean.FALSE;
    @Builder.Default Boolean serialControl = Boolean.FALSE;
    @Column(name = "inspection_required") @Builder.Default Boolean inspectionRequired = Boolean.FALSE;
    @Column(name = "serial_generation_rule", length = 30) @Builder.Default String serialGenerationRule = "NONE";
    @Column(name = "fg_serial_prefix", length = 60) String fgSerialPrefix;
    @Column(name = "default_warehouse", length = 60) String defaultWarehouse;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "item_group_id") ItemGroup itemGroup;
    @Column(name = "material_grade", length = 100) String materialGrade;
    @Column(length = 200) String specification;
    @Column(name = "product_type", length = 60) String productType;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "uom_id") UOMMaster uomRef;
    @Column(name = "drawing_path", length = 500) String drawingPath;
    @Column(name = "dimension_type", length = 60) String dimensionType;
    @Column(name = "hs_code", length = 30) String hsCode;
    @Column(precision = 12, scale = 4) BigDecimal weight;
    @Column(name = "weight_uom", length = 20) String weightUom;
    @Column(name = "min_stock_level") BigDecimal minStockLevel;
    @Column(name = "max_stock_level") BigDecimal maxStockLevel;
    @Column(name = "reorder_point") BigDecimal reorderPoint;
    @Column(name = "reorder_qty") BigDecimal reorderQty;
    @Column(name = "hsn_code", length = 30) String hsnCode;
    @Column(name = "supplier_lead_time") Integer supplierLeadTime;
    @Column(name = "avg_daily_consumption", precision = 12, scale = 4) BigDecimal avgDailyConsumption;
    @Column(name = "storage_category", length = 60) String storageCategory;
    @Column(length = 100) String barcode;
    @Column(name = "alternate_items", length = 500) String alternateItems;
    @Column(name = "substitute_items", length = 500) String substituteItems;
    @Column(name = "parent_item", length = 60) String parentItem;
    @Column(name = "material_type", length = 60) String materialType;
    @Column(length = 200) String dimensions;
    @Column(length = 100) String tolerance;
    @Column(name = "surface_finish", length = 100) String surfaceFinish;
    @Column(length = 100) String hardness;
    @Column(length = 200) String manufacturer;
    @Column(name = "purchase_uom", length = 30) String purchaseUom;
    @Column(name = "conversion_factor", precision = 12, scale = 6) BigDecimal conversionFactor;
    @Column(name = "default_receiving_store", length = 60) String defaultReceivingStore;
    @Column(name = "customer_owned") @Builder.Default Boolean customerOwned = Boolean.FALSE;
    @Column(name = "customer_code", length = 60) String customerCode;

    @Column(name = "planning_policy", length = 30) String planningPolicy;
    @Column(name = "ordering_policy", length = 30) String orderingPolicy;
    @Column(name = "fixed_lot_size") BigDecimal fixedLotSize;
    @Column(name = "min_stock_qty") BigDecimal minStockQty;
    @Column(name = "max_stock_qty") BigDecimal maxStockQty;
    @Column(name = "safety_stock_qty") BigDecimal safetyStockQty;
    @Column(name = "purchase_lead_time_days") BigDecimal purchaseLeadTimeDays;
    @Column(name = "manufacturing_lead_time_days") BigDecimal manufacturingLeadTimeDays;
    @Column(name = "abc_class", length = 5) String abcClass;

    @Column(columnDefinition = "TEXT") String extraData;
    @Version Long version;
    String createdBy;
    Instant createdAt;
    String updatedBy;
    Instant updatedAt;
    @PrePersist void prePersist() {
        if (active == null) active = Boolean.TRUE;
        if (createdAt == null) createdAt = Instant.now();
        if (createdBy == null || createdBy.isBlank()) createdBy = "system";
    }
    public boolean isActive() { return Boolean.TRUE.equals(active); }
}
