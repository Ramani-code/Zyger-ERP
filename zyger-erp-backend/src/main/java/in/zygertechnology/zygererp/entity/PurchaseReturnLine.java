package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.math.BigDecimal;

@Entity @Table(name = "purchase_return_line") @Getter @Setter
public class PurchaseReturnLine extends BaseLine implements LineEntity {
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "doc_id") @JsonIgnore
    PurchaseReturn doc;

    @Column(name = "item_desc", length = 200) String itemDesc;
    @Column(length = 30) String uom;
    @Column(name = "return_qty", precision = 14, scale = 4) BigDecimal returnQty;
    @Column(precision = 14, scale = 4) BigDecimal rate;
    /** Tax rate %, normally carried forward from the original PO Inward line's rate. */
    @Column(precision = 10, scale = 2) BigDecimal tax;
    @Column(name = "tax_amount", precision = 14, scale = 4) BigDecimal taxAmount;
    /** Qty × Rate, net of tax — i.e. the debit-note-able value of this line. */
    @Column(name = "net_amount", precision = 14, scale = 4) BigDecimal netAmount;
    /** Original received/accepted qty against the source PO/GRN line, for the over-return guard. */
    @Column(name = "original_received_qty", precision = 14, scale = 4) BigDecimal originalReceivedQty;
    @Column(name = "reason_code", length = 60) String reasonCode;

    @Override public BigDecimal getQty() { return returnQty == null ? BigDecimal.ZERO : returnQty; }
    @Override public BigDecimal getRate() { return rate; }
    @Override public BigDecimal getNetAmount() { return netAmount; }
    @Override public String getItemDesc() { return itemDesc; }
    @Override public String getUom() { return uom; }
}
