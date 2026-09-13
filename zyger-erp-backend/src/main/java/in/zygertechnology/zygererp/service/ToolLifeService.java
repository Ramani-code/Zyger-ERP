package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.ProductionPolicy;
import in.zygertechnology.zygererp.entity.ToolLifeEntry;
import in.zygertechnology.zygererp.entity.ToolMaster;
import in.zygertechnology.zygererp.repo.ProductionPolicyRepository;
import in.zygertechnology.zygererp.repo.ToolLifeEntryRepository;
import in.zygertechnology.zygererp.repo.ToolMasterRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.Set;

/**
 * Production Module FRS v1.0 §5.5 — Tool Life / Tool Change Entry.
 *
 * <p>Closes a confirmed audit gap: ToolMaster.currentUsage existed as a column but nothing
 * anywhere incremented it, so tool life tracking was purely reactive (an intimation raised
 * only after a tool actually failed) with zero predictive visibility. This service is the
 * single place a tool's cumulative usage is updated; every entry recomputes remaining
 * life % and — below the configured threshold — raises an in-app alert exactly once per
 * threshold breach (not on every subsequent entry) so Stores/Tool Room isn't spammed.</p>
 */
@Service
@RequiredArgsConstructor
public class ToolLifeService {

    private static final Set<String> VALID_CHANGE_REASONS = Set.of("BREAKAGE", "WEAR", "QUALITY_ISSUE", "PREVENTIVE");

    private final ToolLifeEntryRepository entries;
    private final ToolMasterRepository tools;
    private final ProductionPolicyRepository productionPolicies;
    private final DocNumberService numbers;
    private final NotificationService notifications;

    public List<ToolLifeEntry> list() {
        return entries.findAllByOrderByCreatedAtDesc();
    }

    public List<ToolLifeEntry> byTool(String toolCode) {
        return entries.findByToolCodeOrderByCreatedAtDesc(toolCode);
    }

    public List<ToolLifeEntry> byJobCard(String jobCardNumber) {
        return entries.findByJobCardNumber(jobCardNumber);
    }

    @Transactional
    public ToolLifeEntry create(ToolLifeEntry e, String user) {
        if (e.getToolCode() == null || e.getToolCode().isBlank()) {
            throw new IllegalArgumentException("Tool ID is mandatory");
        }
        ToolMaster tool = tools.findByCode(e.getToolCode())
                .orElseThrow(() -> new IllegalArgumentException("Tool '" + e.getToolCode() + "' does not exist"));

        BigDecimal lifeConsumed = e.getLifeConsumed() != null ? e.getLifeConsumed() : BigDecimal.ZERO;
        if (lifeConsumed.compareTo(BigDecimal.ZERO) < 0) {
            throw new IllegalArgumentException("Life Consumed cannot be negative");
        }

        boolean isChange = e.getChangeReason() != null && !e.getChangeReason().isBlank();
        if (isChange) {
            String reason = e.getChangeReason().toUpperCase();
            if (!VALID_CHANGE_REASONS.contains(reason)) {
                throw new IllegalArgumentException("Change Reason must be one of " + VALID_CHANGE_REASONS);
            }
            e.setChangeReason(reason);
            if (e.getReplacedByToolCode() == null || e.getReplacedByToolCode().isBlank()) {
                throw new IllegalArgumentException("Replaced By (New Tool ID) is mandatory when changing a tool");
            }
            if (!tools.existsByCode(e.getReplacedByToolCode())) {
                throw new IllegalArgumentException("Replacement tool '" + e.getReplacedByToolCode() + "' does not exist");
            }
        }

        // Accumulate this tool's own usage.
        BigDecimal cumulative = (tool.getCurrentUsage() != null ? tool.getCurrentUsage() : BigDecimal.ZERO).add(lifeConsumed);
        tool.setCurrentUsage(cumulative);

        BigDecimal remainingPct = remainingLifePercent(tool, cumulative);
        boolean wasBelowThreshold = wasAlreadyBelowThreshold(tool, cumulative.subtract(lifeConsumed));
        boolean nowBelowThreshold = remainingPct != null && remainingPct.compareTo(alertThreshold()) <= 0;
        if (nowBelowThreshold && !wasBelowThreshold) {
            notifications.notify("TOOL_LIFE_LOW", "PRODUCTION", "tool", tool.getId(), "HIGH",
                    "Tool " + tool.getCode() + " (" + (tool.getName() != null ? tool.getName() : "") + ") has only "
                            + remainingPct + "% life remaining — reorder/replace before it runs out mid-batch.",
                    tool.getCode());
        }

        // A completed change resets the replacement tool's own counter to zero, per FRS.
        if (isChange) {
            tools.findByCode(e.getReplacedByToolCode()).ifPresent(replacement -> {
                replacement.setCurrentUsage(BigDecimal.ZERO);
                tools.save(replacement);
            });
        }
        tools.save(tool);

        e.setId(null);
        e.setDocNo(numbers.next("tool-life", "TLE"));
        e.setLifeConsumed(lifeConsumed);
        e.setCumulativeLifeConsumed(cumulative);
        e.setRemainingLifePercent(remainingPct);
        e.setCreatedBy(user);
        e.setCreatedAt(Instant.now());
        return entries.save(e);
    }

    /** Null when the tool has no rated life on record — nothing to compute a % against. */
    private BigDecimal remainingLifePercent(ToolMaster tool, BigDecimal cumulativeUsage) {
        if (tool.getToolLifeCount() == null || tool.getToolLifeCount().compareTo(BigDecimal.ZERO) <= 0) return null;
        BigDecimal remaining = tool.getToolLifeCount().subtract(cumulativeUsage);
        BigDecimal pct = remaining.multiply(new BigDecimal("100")).divide(tool.getToolLifeCount(), 2, RoundingMode.HALF_UP);
        return pct.compareTo(BigDecimal.ZERO) < 0 ? BigDecimal.ZERO : pct;
    }

    private boolean wasAlreadyBelowThreshold(ToolMaster tool, BigDecimal usageBeforeThisEntry) {
        BigDecimal pctBefore = remainingLifePercent(tool, usageBeforeThisEntry);
        return pctBefore != null && pctBefore.compareTo(alertThreshold()) <= 0;
    }

    private BigDecimal alertThreshold() {
        ProductionPolicy policy = productionPolicies.findFirstByActiveTrue().orElseGet(ProductionPolicy::new);
        return policy.getToolLifeAlertThresholdPercent() != null
                ? policy.getToolLifeAlertThresholdPercent() : new BigDecimal("10.00");
    }
}
