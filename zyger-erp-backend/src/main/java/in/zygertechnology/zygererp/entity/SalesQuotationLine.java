package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.math.BigDecimal;

@Entity @Table(name="sales_quotation_line") @Getter @Setter
public class SalesQuotationLine extends BaseLine implements LineEntity {

    @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="doc_id") @JsonIgnore
    SalesQuotation doc;

    // CNC engineering block (FRS §B2)
    @Column(name="material_grade", length=60) String materialGrade;
    @Column(name="tolerance_class", length=30) String toleranceClass;
    @Column(name="surface_finish_requirement", length=60) String surfaceFinishRequirement;
    /** Free-text reference to a RouteSheet doc/version — no hard FK, mirroring how
     * other Sales cross-doc references (e.g. salesOrderNo) work in this codebase. */
    @Column(name="process_route_ref", length=60) String processRouteRef;
    @Column(name="cycle_time_minutes", precision=10, scale=2) BigDecimal cycleTimeMinutes = BigDecimal.ZERO;
    @Column(name="setup_time_minutes", precision=10, scale=2) BigDecimal setupTimeMinutes = BigDecimal.ZERO;
    @Column(name="tooling_required") Boolean toolingRequired = false;
    @Column(name="heat_treatment_required") Boolean heatTreatmentRequired = false;
    @Column(name="heat_treatment_spec", length=100) String heatTreatmentSpec;
    @Column(name="plating_coating_spec", length=100) String platingCoatingSpec;
    @Column(name="inspection_method", length=60) String inspectionMethod;
    @Column(name="fai_ppap_required") Boolean faiPpapRequired = false;

    // Costing block (FRS §B1 / D1)
    /** Machine/work-center code used to source machineHourRate for MachiningCost —
     * looked up live against MachineMaster/WorkCenter at compute time, not stored. */
    @Column(name="machine_code", length=60) String machineCode;
    @Column(name="material_cost_per_unit", precision=18, scale=4) BigDecimal materialCostPerUnit = BigDecimal.ZERO;
    @Column(name="machining_cost_per_unit", precision=18, scale=4) BigDecimal machiningCostPerUnit = BigDecimal.ZERO;
    @Column(name="setup_cost_per_unit", precision=18, scale=4) BigDecimal setupCostPerUnit = BigDecimal.ZERO;
    @Column(name="tooling_cost_per_unit", precision=18, scale=4) BigDecimal toolingCostPerUnit = BigDecimal.ZERO;
    @Column(name="overhead_percent", precision=5, scale=2) BigDecimal overheadPercent;
    @Column(name="margin_percent", precision=5, scale=2) BigDecimal marginPercent;
    @Column(name="suggested_selling_price", precision=18, scale=4) BigDecimal suggestedSellingPrice;
    @Column(name="unit_price", precision=18, scale=4) BigDecimal unitPrice;
    BigDecimal qty;
    @Column(length=30) String uom;
    @Column(name="tax_code", length=30) String taxCode;
    @Column(name="tax_amount", precision=18, scale=4) BigDecimal taxAmount;
    @Column(name="net_amount", precision=18, scale=4) BigDecimal netAmount;

    @Override public BigDecimal getQty() { return qty; }
}
