package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.util.ArrayList;
import java.util.List;
import java.time.LocalDate;

/** SCR-101 Enquiry / RFQ — pre-commercial capture of a customer's request, ahead
 * of any costed commitment. Workflow: NEW -> QUOTED -> CONVERTED, or -> LOST. */
@Entity @Table(name="sales_enquiry") @Getter @Setter @DocKey("enquiry")
public class SalesEnquiry extends BaseDoc implements DocEntity {

    @Column(name="customer_code", length=60) String customerCode;
    @Column(name="customer_name", length=200) String customerName;
    @Column(name="contact_person", length=200) String contactPerson;
    @Column(name="required_by_date") LocalDate requiredByDate;
    @Column(length=20) String source = "EXISTING_CUSTOMER";
    @Column(name="sales_owner", length=100) String salesOwner;
    @Column(name="lost_reason", length=300) String lostReason;
    /** Set once "Convert to Quotation" has run, so the UI can link straight through. */
    @Column(name="converted_quotation_no", length=30) String convertedQuotationNo;

    @OneToMany(mappedBy="doc", cascade=CascadeType.ALL, orphanRemoval=true, fetch=FetchType.EAGER)
    List<SalesEnquiryLine> lines = new ArrayList<>();
}
