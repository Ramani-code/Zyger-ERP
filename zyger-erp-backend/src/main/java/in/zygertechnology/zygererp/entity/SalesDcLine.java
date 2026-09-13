package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

@Entity @Table(name="sales_dc_line") @Getter @Setter
public class SalesDcLine extends BaseLine implements LineEntity {

    @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="doc_id") @JsonIgnore
    SalesDc doc;

    @OneToMany(mappedBy="dcLine", cascade=CascadeType.ALL, orphanRemoval=true, fetch=FetchType.EAGER)
    List<SalesDcPackingDetail> packingDetails = new ArrayList<>();

    @Column(name="item_name", length=200) String itemName;
    @Column(name="customer_part_number", length=60) String customerPartNumber;
    @Column(name="drawing_number", length=60) String drawingNumber;
    @Column(name="drawing_revision", length=30) String drawingRevision;
    @Column(name="so_qty") BigDecimal soQty;
    @Column(name="previously_dispatched_qty") BigDecimal previouslyDispatchedQty;
    @Column(name="current_dispatch_qty") BigDecimal currentDispatchQty;
    @Column(name="pending_qty") BigDecimal pendingQty;
    BigDecimal qty;
    @Column(length=30) String uom;
    @Column(name="batch_number", length=60) String batchNumber;
    @Column(name="lot_number", length=60) String lotNumber;
    @Column(name="serial_number", length=60) String serialNumber;
    @Column(name="packing_reference", length=60) String packingReference;
    @Column(name="quality_inspection_reference", length=60) String qualityInspectionReference;

    @PrePersist
    void prePersist() {
        if (qty == null && currentDispatchQty != null) qty = currentDispatchQty;
        if (currentDispatchQty == null && qty != null) currentDispatchQty = qty;
    }

    @Override public BigDecimal getQty() { return currentDispatchQty != null ? currentDispatchQty : qty; }
}
