package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.math.BigDecimal;

@Entity @Table(name="sales_invoice") @Getter @Setter @DocKey("sales-invoice")
public class SalesInvoice extends BaseDoc implements DocEntity {

    @Column(name="customer", length=200) String customer;
    @Column(name="customer_code", length=60) String customerCode;
    @Column(name="customer_po_number", length=60) String customerPoNumber;
    @Column(name="sales_order_no", length=60) String salesOrderNo;
    @Column(name="sales_order_number", length=60) String salesOrderNumber;
    @Column(name="dc_no", length=60) String dcNo;
    @Column(name="sales_dc_number", length=60) String salesDcNumber;
    @Column(name="pi_number", length=60) String piNumber;
    @Column(name="billing_address", length=500) String billingAddress;
    @Column(name="shipping_address", length=500) String shippingAddress;
    @Column(length=30) String currency;
    @Column(name="payment_terms", length=200) String paymentTerms;
    @Column(name="due_date") LocalDate dueDate;
    @Column(name="vehicle_no", length=60) String vehicleNo;
    /** GST invoice requirement — moment the goods/service are supplied. */
    @Column(name="date_time_of_supply") LocalDateTime dateTimeOfSupply;
    /** 2-digit GST state code of the place of supply (auto-filled from the customer
     * GSTIN's first two digits when blank at creation). */
    @Column(name="place_of_supply_code", length=2) String placeOfSupplyCode;
    @Column(name="tax_details", length=200) String taxDetails;
    @Column(name="transport_details", length=200) String transportDetails;
    @Column(name="eway_bill_reference", length=60) String ewayBillReference;

    /** GST compliance — customer's GSTIN, place of supply drives CGST+SGST vs IGST. */
    @Column(name="customer_gstin", length=15) String customerGstin;
    /** Length 100, not the 2-digit GST state code, since no GST state-code master
     * exists yet in this codebase — stored as the free-text state name for now
     * (see SalesService.deriveTaxType). Revisit once a proper state-code master exists. */
    @Column(name="place_of_supply", length=100) String placeOfSupply;
    /** "CGST_SGST" or "IGST" — derived from placeOfSupply vs. the company's registered
     * state at creation time (BR-NEW-013). Stored rather than recomputed on every read
     * so a later company-address change never silently reclassifies an old invoice. */
    @Column(name="tax_type", length=20) String taxType;

    /** E-Invoice (IRP) fields — populated once the E-Invoice API integration (Phase 4/5) is wired. */
    @Column(name="irn_number", length=64) String irnNumber;
    @Column(name="irn_ack_no", length=20) String irnAckNo;
    @Column(name="irn_ack_date") java.time.Instant irnAckDate;
    @Column(name="qr_payload", columnDefinition="TEXT") String qrPayload;
    @Column(name="eway_bill_no", length=12) String ewayBillNo;

    @Column(name="total_amount") BigDecimal totalAmount;
    @Column(name="tax_amount") BigDecimal taxAmount;
    /** Sum of POSTED Payment Receipt allocations + Credit Note adjustments against this
     * invoice. Drives status PARTIALLY_PAID/PAID (Phase 2, SCR-103/SCR-104). Never
     * negative; a Debit Note increases what's owed instead of touching this field. */
    @Column(name="paid_amount", precision=18, scale=2) BigDecimal paidAmount = BigDecimal.ZERO;

    @OneToMany(mappedBy="doc", cascade=CascadeType.ALL, orphanRemoval=true, fetch=FetchType.EAGER)
    List<SalesInvoiceItem> lines = new ArrayList<>();
}
