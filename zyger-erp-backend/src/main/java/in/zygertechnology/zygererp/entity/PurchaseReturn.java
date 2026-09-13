package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * FRS DOC-PUR-FRS-02 §9 (PUR-07) — Purchase Return / Debit Note.
 * Records material physically returned to a vendor (stock OUT) with a reference back to the
 * originating Purchase Order and/or GRN/PO Inward. Follows the same generic DRAFT -> SUBMITTED
 * -> APPROVED -> POSTED lifecycle as every other document type (DocumentFacade); posting decreases
 * the store balance via the standard Effect.OUT path (doc/DocTypes.java).
 *
 * When `debitNoteRequired` is true and `debitNoteAmount` (or, if blank, the summed line net
 * amounts) is greater than zero, reaching POSTED automatically writes a negative VendorLedgerEntry
 * (txType RETURN) reducing the vendor's payable — see DocumentFacade.postToVendorLedger(). This
 * is idempotent per (refDocType, refDocNo); there is still no full AP module (no Payment document
 * type, no ledger reconciliation UI) beyond this ledger-entry posting.
 */
@Entity @Table(name = "purchase_return") @Getter @Setter @DocKey("purchase-return")
public class PurchaseReturn extends BaseDoc implements DocEntity {
    String supplier;
    @Column(name = "supplier_code", length = 60) String supplierCode;

    /** "purchase-order" or "po-inward" — which document type originalDocumentNo refers to. */
    @Column(name = "original_document_type", length = 30) String originalDocumentType;
    @Column(name = "original_document_no", length = 60) String originalDocumentNo;

    /** [ASSUMPTION] free-text-backed reason code; no fixed master exists for this yet. */
    @Column(name = "reason_code", length = 60) String reasonCode;

    /** Link back to the Quality Inspection that triggered this return, when applicable. */
    @Column(name = "qc_inspection_ref", length = 60) String qcInspectionRef;

    @Column(name = "debit_note_required") Boolean debitNoteRequired = Boolean.TRUE;
    @Column(name = "debit_note_amount", precision = 14, scale = 2) BigDecimal debitNoteAmount;
    @Column(name = "debit_note_reference", length = 60) String debitNoteReference;

    @OneToMany(mappedBy = "doc", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    List<PurchaseReturnLine> lines = new ArrayList<>();
}
