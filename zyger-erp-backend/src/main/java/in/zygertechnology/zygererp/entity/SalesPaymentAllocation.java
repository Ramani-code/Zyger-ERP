package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.math.BigDecimal;

/** One invoice allocation line of a {@link SalesPaymentReceipt}. Modeled as a
 * LineEntity (amountAllocated stands in for "qty") so it flows through the same
 * generic doc/line machinery as every other Sales document's line grid. */
@Entity @Table(name="sales_payment_allocation") @Getter @Setter
public class SalesPaymentAllocation extends BaseLine implements LineEntity {

    @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="doc_id") @JsonIgnore
    SalesPaymentReceipt doc;

    @Column(name="invoice_no", length=30) String invoiceNo;
    /** Invoice's outstanding balance at the moment this allocation was made — a
     * snapshot for audit/display, not re-derived later. */
    @Column(name="invoice_balance", precision=18, scale=2) BigDecimal invoiceBalance;
    @Column(name="amount_allocated", precision=18, scale=2) BigDecimal amountAllocated;

    @Override public BigDecimal getQty() { return amountAllocated; }
}
