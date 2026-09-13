package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.util.List;

/** SCR-104 Credit/Debit Note — a financial adjustment against a posted Sales
 * Invoice, not tied to a physical return. Workflow: DRAFT -> SUBMITTED ->
 * APPROVED -> POSTED (or REJECTED). No line grid — header-only per FRS §3 SCR-104. */
@Entity @Table(name="sales_credit_debit_note") @Getter @Setter @DocKey("credit-debit-note")
public class SalesCreditDebitNote extends BaseDoc implements DocEntity {

    @Column(name="note_type", length=10) String noteType;
    @Column(name="original_invoice_ref", length=30) String originalInvoiceRef;
    @Column(name="reason_code", length=30) String reasonCode;
    @Column(precision=18, scale=2) BigDecimal amount;
    @Column(name="tax_impact") Boolean taxImpact = true;
    /** Derived from the original invoice's docDate (YYYY-MM), for GSTR-1 amendment reporting. */
    @Column(name="original_invoice_period", length=7) String originalInvoicePeriod;

    @Override public List<? extends LineEntity> getLines() { return List.of(); }
}
