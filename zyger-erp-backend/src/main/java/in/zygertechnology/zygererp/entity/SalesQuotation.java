package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.util.ArrayList;
import java.util.List;
import java.math.BigDecimal;
import java.time.LocalDate;

/** SCR-102 Quotation (Costed) — engineering-costed, revisable, tiered-approval
 * quotation. Workflow: DRAFT -> SUBMITTED -> APPROVED/REJECTED -> SENT_TO_CUSTOMER
 * -> WON/LOST. An edit after SUBMITTED never mutates in place — see "revise": it
 * creates a new row (parentQuotationId -> this row) and this row moves to SUPERSEDED. */
// docNo is deliberately NOT unique here (unlike every other BaseDoc subclass): a
// revision chain reuses the same docNo across multiple rows (revisionNo distinguishes
// them — see §1.4 of the Technical Design). BaseDoc's inherited @Column(unique=true)
// on docNo is overridden off for this entity only.
@Entity @Table(name="sales_quotation") @Getter @Setter @DocKey("quotation")
@AttributeOverride(name="docNo", column=@Column(name="doc_no", unique=false))
public class SalesQuotation extends BaseDoc implements DocEntity {

    @Column(name="revision_no") Integer revisionNo = 0;
    @Column(name="parent_quotation_id") Long parentQuotationId;
    @Column(name="enquiry_ref", length=30) String enquiryRef;
    @Column(name="customer_code", length=60) String customerCode;
    @Column(name="customer_name", length=200) String customerName;
    @Column(name="validity_date") LocalDate validityDate;
    @Column(length=3) String currency = "INR";
    @Column(name="exchange_rate", precision=18, scale=6) BigDecimal exchangeRate = BigDecimal.ONE;
    @Column(name="payment_terms", length=200) String paymentTerms;
    @Column(name="delivery_terms", length=200) String deliveryTerms;
    @Column(name="converted_so_no", length=30) String convertedSoNo;
    @Column(name="lost_reason", length=300) String lostReason;
    /** Mandatory justification when any line's unitPrice deviates from its computed
     * suggestedSellingPrice beyond CostingPolicy.priceDeviationTolerancePercent. */
    @Column(name="price_override_reason", length=500) String priceOverrideReason;

    @OneToMany(mappedBy="doc", cascade=CascadeType.ALL, orphanRemoval=true, fetch=FetchType.EAGER)
    List<SalesQuotationLine> lines = new ArrayList<>();
}
