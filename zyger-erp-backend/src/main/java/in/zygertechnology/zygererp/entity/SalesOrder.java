package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.math.BigDecimal;

@Entity @Table(name="sales_order") @Getter @Setter @DocKey("sales-order")
public class SalesOrder extends BaseDoc implements DocEntity {

    @Column(name="customer", length=200) String customer;
    @Column(name="customer_code", length=60) String customerCode;
    @Column(name="customer_po_no", length=60) String customerPoNo;
    @Column(name="customer_po_number", length=60) String customerPoNumber;
    @Column(name="customer_po_date") LocalDate customerPoDate;
    @Column(name="contact_person", length=200) String contactPerson;
    @Column(name="customer_contact", length=200) String customerContact;
    @Column(length=30) String phone;
    @Column(length=100) String email;
    @Column(name="sales_person", length=100) String salesPerson;
    @Column(name="customer_type", length=60) String customerType;
    @Column(name="billing_address", length=500) String billingAddress;
    @Column(name="shipping_address", length=500) String shippingAddress;
    @Column(length=30) String currency;
    @Column(name="exchange_rate", precision=18, scale=6) BigDecimal exchangeRate = BigDecimal.ONE;
    /** GST compliance — customer's GSTIN, captured at order time. */
    @Column(name="customer_gstin", length=15) String customerGstin;
    /** GST state code determining CGST+SGST vs IGST on the resulting invoice. */
    /** Length 100 — see the matching note on SalesInvoice.placeOfSupply. */
    @Column(name="place_of_supply", length=100) String placeOfSupply;
    @Column(name="payment_terms", length=200) String paymentTerms;
    @Column(name="delivery_terms", length=200) String deliveryTerms;
    @Column(name="delivery_date") LocalDate deliveryDate;
    @Column(name="order_priority", length=30) String orderPriority;
    @Column(name="requested_delivery_date") LocalDate requestedDeliveryDate;
    @Column(name="customer_required_date") LocalDate customerRequiredDate;
    @Column(name="internal_target_date") LocalDate internalTargetDate;
    @Column(name="shipping_method", length=100) String shippingMethod;
    /** FRS §4.8: Open or Fixed */
    @Column(name="so_type", length=30) String soType;
    /** FRS §4.8: generic terms and conditions */
    @Column(name="terms_and_conditions", columnDefinition="TEXT") String termsAndConditions;
    @Column(name="target_delivery_date") LocalDate targetDeliveryDate;
    @Column(name="credit_limit_status", length=30) String creditLimitStatus;
    @Column(name="compliance_checklist", length=60) String complianceChecklist;
    @Column(name="delivery_status", length=30) String deliveryStatus;

    @Column(name="ordered_qty") BigDecimal orderedQty;
    @Column(name="produced_qty") BigDecimal producedQty;
    @Column(name="approved_qty") BigDecimal approvedQty;
    @Column(name="packed_qty") BigDecimal packedQty;
    @Column(name="dispatched_qty") BigDecimal dispatchedQty;
    @Column(name="invoiced_qty") BigDecimal invoicedQty;
    @Column(name="returned_qty") BigDecimal returnedQty;
    @Column(name="pending_qty") BigDecimal pendingQty;

    @Column(name="attachment_file_name", length=200) String attachmentFileName;
    /** Set when this SO was created via Quotation "Convert to Sales Order" (Phase 3). */
    @Column(name="quotation_ref", length=30) String quotationRef;

    @OneToMany(mappedBy="doc", cascade=CascadeType.ALL, orphanRemoval=true, fetch=FetchType.EAGER)
    List<SalesOrderItem> lines = new ArrayList<>();

    @OneToMany(mappedBy="doc", cascade=CascadeType.ALL, orphanRemoval=true, fetch=FetchType.EAGER)
    List<SalesOrderSchedule> schedules = new ArrayList<>();
}
