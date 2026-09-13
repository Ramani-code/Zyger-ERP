package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/**
 * Production Module FRS v1.0 §10 (Open Point Q2): a single active-row plant-wide config
 * table (not a workflow document), mirroring the costing_policy_master pattern — read by
 * whichever service needs to compare an actual against a standard/planned value. Seeded
 * with default field values on first read if no row exists (see CostingPolicy for the
 * established pattern this follows).
 */
@Entity @Table(name = "production_policy_master") @Getter @Setter
public class ProductionPolicy {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) Long id;

    /** Job Card completion: total output (good+rework) may exceed planned qty by up to
     * this %, replacing the previous hardcoded 10%. Beyond this, a Production
     * Supervisor/Plant Head override with a reason is required. */
    @Column(name = "overproduction_tolerance_percent", precision = 5, scale = 2)
    BigDecimal overproductionTolerancePercent = new BigDecimal("10.00");

    /** Product Conversion: actual raw-material consumption may exceed the theoretical
     * consumption (qty produced x standard unit weight) by up to this % before being
     * flagged for review. */
    @Column(name = "material_consumption_tolerance_percent", precision = 5, scale = 2)
    BigDecimal materialConsumptionTolerancePercent = new BigDecimal("5.00");

    /** Reserved for Actual Run Time vs. Standard Cycle Time variance flagging once Actual
     * Run Time is actually computed (it is currently a dead, uncalculated field on
     * ProductionEntry) — not yet wired to any check. */
    @Column(name = "cycle_time_tolerance_percent", precision = 5, scale = 2)
    BigDecimal cycleTimeTolerancePercent = new BigDecimal("10.00");

    /** Tool Life FRS §5.5 BR: alert Stores/Tool Room once a tool's remaining life % falls
     * at or below this threshold, before it is fully exhausted mid-batch. */
    @Column(name = "tool_life_alert_threshold_percent", precision = 5, scale = 2)
    BigDecimal toolLifeAlertThresholdPercent = new BigDecimal("10.00");

    @Column(name = "active") Boolean active = true;
}
