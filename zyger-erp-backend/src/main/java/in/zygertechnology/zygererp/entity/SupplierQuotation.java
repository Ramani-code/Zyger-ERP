package in.zygertechnology.zygererp.entity;
import jakarta.persistence.*; import lombok.*;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.math.BigDecimal;
@Entity @Table(name="supplier_quotation") @Getter @Setter @DocKey("supplier-quotation")
public class SupplierQuotation extends BaseDoc implements DocEntity {
    String supplier;
    @Column(name = "quotation_no", length = 60) String quotationNo;
    @Column(name = "contact_person", length = 100) String contactPerson;
    @Column(length = 30) String phone;
    @Column(length = 100) String email;
    @Column(name = "enquiry_ref_no", length = 60) String enquiryRefNo;
    @Column(name = "enquiry_number", length = 60) String enquiryNumber;
    @Column(name = "valid_until") LocalDate validUntil;
    @Column(name = "expected_delivery_date") LocalDate expectedDeliveryDate;
    @Column(length = 30) String currency;
    @Column(name = "payment_terms", length = 200) String paymentTerms;
    @Column(name = "delivery_terms", length = 200) String deliveryTerms;
    BigDecimal freight;
    BigDecimal insurance;
    BigDecimal taxes;
    @Column(name = "other_charges") BigDecimal otherCharges;
    @Column(name = "attachment_file_name", length = 200) String attachmentFileName;
    @OneToMany(mappedBy = "doc", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    List<SupplierQuotationItem> lines = new ArrayList<>();
}
