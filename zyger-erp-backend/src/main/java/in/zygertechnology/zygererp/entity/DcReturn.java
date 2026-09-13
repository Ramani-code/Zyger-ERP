package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

@Entity @Table(name="dc_return") @Getter @Setter @DocKey("dc-return")
public class DcReturn extends BaseDoc implements DocEntity {

    @Column(name="customer", length=200) String customer;
    @Column(name="customer_code", length=60) String customerCode;
    /** @deprecated legacy duplicate of {@link #originalDcNumber}; kept only for
     * backward compatibility with old API callers (SalesService bridges the two
     * both ways). Do not read/write this directly in new code. */
    @Deprecated
    @Column(name="dc_no", length=60) String dcNo;
    /** Canonical original-DC-reference field — use this one. */
    @Column(name="original_dc_number", length=60) String originalDcNumber;
    @Column(name="original_dc_date") LocalDate originalDcDate;
    @Column(name="return_date") LocalDate returnDate;
    @Column(name="sales_order_number", length=60) String salesOrderNumber;
    @Column(name="customer_po_number", length=60) String customerPoNumber;
    /** @deprecated legacy duplicate of {@link #returnReason}; kept only for
     * backward compatibility with old API callers (SalesService bridges the two
     * both ways). Do not read/write this directly in new code. */
    @Deprecated
    @Column(name="reason", length=200) String reason;
    /** Canonical return-reason field — use this one. */
    @Column(name="return_reason", length=200) String returnReason;
    @Column(name="customer_remarks", length=500) String customerRemarks;
    @Column(name="transport_details", length=200) String transportDetails;
    @Column(name="quality_inspection_reference", length=60) String qualityInspectionReference;
    @Column(length=30) String disposition;

    @OneToMany(mappedBy="doc", cascade=CascadeType.ALL, orphanRemoval=true, fetch=FetchType.EAGER)
    List<DcReturnLine> lines = new ArrayList<>();
}
