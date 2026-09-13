package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.math.BigDecimal;

@Entity @Table(name="sales_enquiry_line") @Getter @Setter
public class SalesEnquiryLine extends BaseLine implements LineEntity {

    @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="doc_id") @JsonIgnore
    SalesEnquiry doc;

    @Column(name="drawing_number", length=60) String drawingNumber;
    @Column(name="drawing_revision", length=30) String drawingRevision;
    @Column(length=500) String description;
    BigDecimal qty;
    @Column(name="target_price", precision=18, scale=4) BigDecimal targetPrice;
    @Column(length=30) String uom;

    @Override public BigDecimal getQty() { return qty; }
}
