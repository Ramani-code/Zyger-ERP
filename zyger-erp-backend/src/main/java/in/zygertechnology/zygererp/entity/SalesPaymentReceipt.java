package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/** SCR-103 Payment Collection — records a customer receipt and its allocation
 * against one or more open Sales Invoices. Workflow: DRAFT -> ALLOCATED -> POSTED
 * (or REVERSED after POSTED). */
@Entity @Table(name="sales_payment_receipt") @Getter @Setter @DocKey("payment-receipt")
public class SalesPaymentReceipt extends BaseDoc implements DocEntity {

    @Column(name="customer_code", length=60) String customerCode;
    @Column(name="customer", length=200) String customer;
    @Column(length=30) String mode;
    @Column(name="reference_no", length=60) String referenceNo;
    @Column(name="amount_received", precision=18, scale=2) BigDecimal amountReceived;
    @Column(name="unallocated_balance", precision=18, scale=2) BigDecimal unallocatedBalance;

    @OneToMany(mappedBy="doc", cascade=CascadeType.ALL, orphanRemoval=true, fetch=FetchType.EAGER)
    List<SalesPaymentAllocation> lines = new ArrayList<>();
}
