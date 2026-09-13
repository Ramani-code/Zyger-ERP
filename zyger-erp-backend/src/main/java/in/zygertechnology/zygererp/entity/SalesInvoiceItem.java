package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

@Entity @Table(name="sales_invoice_item") @Getter @Setter
public class SalesInvoiceItem extends BaseLine implements LineEntity {

    @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="doc_id") @com.fasterxml.jackson.annotation.JsonIgnore
    SalesInvoice doc;

    @Column(name="item_name", length=200) String itemName;
    @Column(name="customer_part_number", length=60) String customerPartNumber;
    String description;
    @Column(name="drawing_number", length=60) String drawingNumber;
    @Column(name="drawing_revision", length=30) String drawingRevision;
    @Column(name="sales_dc_reference", length=60) String salesDcReference;
    /** HSN as it existed in the Item Master at the moment this line was created — frozen
     * here deliberately so a later change to the Item Master's HSN never rewrites what
     * was actually declared to GST for this transaction (BR-NEW-012). */
    @Column(name="hsn_snapshot", length=8) String hsnSnapshot;
    BigDecimal qty;
    @Column(length=30) String uom;
    @Column(name="unit_price") BigDecimal unitPrice;
    BigDecimal discount;
    BigDecimal tax;
    @Column(name="tax_amount") BigDecimal taxAmount;
    @Column(name="net_amount") BigDecimal netAmount;

    @Override public BigDecimal getQty() { return qty == null ? BigDecimal.ZERO : qty; }
    @Override public BigDecimal getRate() { return unitPrice; }
}
