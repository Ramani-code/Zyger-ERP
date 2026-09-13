package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/** Minimal costing_policy_master per Technical Design §1.3 — a single active-row
 * config table (not a workflow document) read by the Quotation pricing engine
 * (BR-NEW-002 margin floor, D1 default overhead/margin, price-deviation tolerance).
 * Seeded with one row (id=1) on first read if none exists; a later screen can add
 * per-customer-category variants by extending this table, not replacing it. */
@Entity @Table(name="costing_policy_master") @Getter @Setter
public class CostingPolicy {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) Long id;

    @Column(name="default_overhead_percent", precision=5, scale=2) BigDecimal defaultOverheadPercent = new BigDecimal("15.00");
    @Column(name="default_margin_percent", precision=5, scale=2) BigDecimal defaultMarginPercent = new BigDecimal("20.00");
    /** BR-NEW-002: unitPrice may never imply a margin below this floor without a
     * logged override reason. */
    @Column(name="margin_floor_percent", precision=5, scale=2) BigDecimal marginFloorPercent = new BigDecimal("5.00");
    /** unitPrice deviating from suggestedSellingPrice by more than this % requires
     * SalesQuotation.priceOverrideReason to be set. */
    @Column(name="price_deviation_tolerance_percent", precision=5, scale=2) BigDecimal priceDeviationTolerancePercent = new BigDecimal("10.00");

    // Phase 4 (Technical Design §3.2 tier router): Sales Order approval-tier ceilings.
    // An order below tier0Ceiling auto-approves; below tier1Ceiling needs Tier 1;
    // below tier2Ceiling (or breaching discount/margin) needs Tier 2; above that, or
    // export/new-customer, needs Tier 3 (dual sign-off).
    @Column(name="tier0_ceiling_amount", precision=18, scale=2) BigDecimal tier0CeilingAmount = new BigDecimal("100000.00");
    @Column(name="tier1_ceiling_amount", precision=18, scale=2) BigDecimal tier1CeilingAmount = new BigDecimal("500000.00");
    @Column(name="tier2_ceiling_amount", precision=18, scale=2) BigDecimal tier2CeilingAmount = new BigDecimal("2000000.00");
    @Column(name="tier1_discount_ceiling_percent", precision=5, scale=2) BigDecimal tier1DiscountCeilingPercent = new BigDecimal("10.00");

    @Column(name="active") Boolean active = true;
}
