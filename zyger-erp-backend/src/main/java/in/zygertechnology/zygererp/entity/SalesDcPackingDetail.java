package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.math.BigDecimal;

/** Packing/box breakdown for a Sales DC line — repeating sub-grid per
 * Sales_Module_Stage3_Technical_Design.md §1.2. */
@Entity @Table(name="sales_dc_packing_detail") @Getter @Setter
public class SalesDcPackingDetail {

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) Long id;

    @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="dc_line_id") @JsonIgnore
    SalesDcLine dcLine;

    @Column(name="box_no", length=20) String boxNo;
    @Column(name="gross_weight", precision=10, scale=3) BigDecimal grossWeight;
    @Column(name="net_weight", precision=10, scale=3) BigDecimal netWeight;
    @Column(name="length_cm", precision=10, scale=2) BigDecimal lengthCm;
    @Column(name="width_cm", precision=10, scale=2) BigDecimal widthCm;
    @Column(name="height_cm", precision=10, scale=2) BigDecimal heightCm;
}
