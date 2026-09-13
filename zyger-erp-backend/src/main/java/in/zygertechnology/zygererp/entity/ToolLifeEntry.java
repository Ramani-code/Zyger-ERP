package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.Instant;

/**
 * Production Module FRS v1.0 §5.5 — Tool Life / Tool Change Entry. A transaction record
 * (not a master) logging tool usage against a Job Card: each entry increments the linked
 * ToolMaster's cumulative currentUsage and snapshots the resulting remaining-life % at the
 * time of the entry, so history is preserved even as the tool keeps wearing.
 *
 * This is the missing link the Production Module audit flagged: ToolMaster.currentUsage
 * existed as a field but was never incremented anywhere — tool life tracking was purely
 * reactive (intimation -> rectification) with no usage/prediction logic behind it at all.
 */
@Entity
@Table(name = "tool_life_entry")
@Getter @Setter @Builder @NoArgsConstructor @AllArgsConstructor
public class ToolLifeEntry {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) Long id;

    @Column(name = "doc_no", unique = true, length = 60) String docNo;

    @Column(name = "tool_code", length = 60, nullable = false) String toolCode;
    @Column(name = "job_card_number", length = 60) String jobCardNumber;
    @Column(name = "subjob_number", length = 60) String subjobNumber;
    @Column(name = "machine_code", length = 60) String machineCode;

    /** Life consumed by this entry alone, in the tool's own toolLifeUnit. */
    @Column(name = "life_consumed", precision = 12, scale = 2) BigDecimal lifeConsumed;
    /** ToolMaster.currentUsage snapshot immediately after this entry was applied. */
    @Column(name = "cumulative_life_consumed", precision = 12, scale = 2) BigDecimal cumulativeLifeConsumed;
    /** Remaining life % snapshot immediately after this entry, null if the tool has no
     * rated life (toolLifeCount) on record to compute against. */
    @Column(name = "remaining_life_percent", precision = 5, scale = 2) BigDecimal remainingLifePercent;

    /** Mandatory only when the tool is being changed before reaching its rated life:
     * BREAKAGE / WEAR / QUALITY_ISSUE / PREVENTIVE. Null for a plain usage-only entry. */
    @Column(name = "change_reason", length = 30) String changeReason;
    /** Mandatory alongside changeReason — the new tool's life counter starts at zero. */
    @Column(name = "replaced_by_tool_code", length = 60) String replacedByToolCode;

    /** True if replacedByToolCode's rejected-quantity link was recorded — informational, per
     * FRS §5.5 BR ("optionally linked to the rejected quantity caused by it"). */
    @Column(name = "linked_rejected_qty", precision = 14, scale = 4) BigDecimal linkedRejectedQty;

    @Column(length = 500) String remarks;

    @Column(name = "created_by", length = 60) String createdBy;
    @Column(name = "created_at") Instant createdAt;
}
