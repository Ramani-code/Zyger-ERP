package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import in.zygertechnology.zygererp.config.AuditEntityListener;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "product_conversion")
@Getter @Setter @Builder @NoArgsConstructor @AllArgsConstructor
@EntityListeners(AuditEntityListener.class)
public class ProductConversion {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) Long id;
    @Column(name = "doc_no", unique = true, length = 60) String docNo;
    @Column(name = "conversion_number", unique = true, length = 60) String conversionNumber;
    @Builder.Default
    @Column(name = "plant_id") Long plantId = 1L;
    @Column(name = "conversion_type", length = 30) String conversionType;
    @Column(name = "conversion_date") Instant conversionDate;

    @Column(name = "source_warehouse") String sourceWarehouse;
    @Column(name = "destination_warehouse") String destinationWarehouse;
    @Column(name = "source_warehouse_id") Long sourceWarehouseId;
    @Column(name = "dest_warehouse_id") Long destWarehouseId;
    @Column(name = "wo_id") Long woId;
    @Column(name = "work_order_number", length = 60) String workOrderNumber;
    @Column(name = "job_card_id") Long jobCardId;
    @Column(name = "job_card_number", length = 60) String jobCardNumber;
    @Builder.Default Boolean isInterPlantTransfer = Boolean.FALSE;

    @Column(name = "input_item_code", length = 60) String inputItemCode;
    @Column(name = "input_batch_number", length = 60) String inputBatchNumber;
    @Column(precision = 14, scale = 4) BigDecimal inputQuantity;
    @Column(name = "input_uom", length = 20) String inputUom;
    @Column(name = "output_item_code", length = 60) String outputItemCode;
    @Column(name = "output_batch_number", length = 60) String outputBatchNumber;
    @Column(precision = 14, scale = 4) BigDecimal outputQuantity;
    @Column(name = "output_uom", length = 20) String outputUom;
    @Column(name = "process_loss_qty", precision = 14, scale = 4) BigDecimal processLossQty;
    @Column(name = "scrap_qty", precision = 14, scale = 4) BigDecimal scrapQty;
    /** Production Module FRS §5.7 BR: the designated scrap/by-product item this conversion's
     * chips/turnings post into as sellable FREE stock. Optional — left blank, scrap remains
     * an informational quantity only (unchanged from before), since InventoryIntegrationService
     * deliberately does not accept a SCRAP stock-status through this boundary (see its D-C1
     * note) — scrap must be its own countable item, not a status flag on the input material. */
    @Column(name = "scrap_item_code", length = 60) String scrapItemCode;
    @Column(name = "scrap_location", length = 60) String scrapLocation;

    /** Production Module FRS §5.7 BR: theoretical consumption (output qty x the output
     * item's Item Master standard weight) computed and stored at post time, for
     * traceability — null when the output item has no standard weight on record. */
    @Column(name = "theoretical_consumption_qty", precision = 14, scale = 4) BigDecimal theoreticalConsumptionQty;
    /** True when actual inputQuantity exceeded theoreticalConsumptionQty by more than the
     * plant-wide materialConsumptionTolerancePercent (ProductionPolicy) — a flag for
     * supervisor review, not a block; the FRS asks this to be flagged, not stopped. */
    @Column(name = "material_variance_flagged") @Builder.Default Boolean materialVarianceFlagged = false;

    @Column(length = 30) @Builder.Default String status = "DRAFT";
    @Column(length = 500) String remarks;
    @Version Long version;
    String createdBy;
    Instant createdAt;
    String updatedBy;
    Instant updatedAt;

    @OneToMany(mappedBy = "conversion", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    List<ProductConversionInput> inputs = new ArrayList<>();
    @OneToMany(mappedBy = "conversion", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    List<ProductConversionOutput> outputs = new ArrayList<>();
    @OneToMany(mappedBy = "conversion", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    List<ProductConversionLoss> losses = new ArrayList<>();

    @PrePersist void prePersist() { if (createdAt == null) createdAt = Instant.now(); }
}
