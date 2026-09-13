package in.zygertechnology.zygererp.config;

import in.zygertechnology.zygererp.entity.EscalationRule;
import in.zygertechnology.zygererp.repository.EscalationRuleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Production Module FRS §7 (audit finding): the escalation_rule seed for BREAKDOWN_INTIMATION
 * (and the other Quality/Maintenance rules alongside it) already existed correctly — at
 * exactly the FRS's 2-hour breakdown threshold — but only inside {@link DataSeeder}, which is
 * {@code @Profile("dev")}-gated. That meant a real (non-dev) deployment's escalation_rule
 * table stayed empty forever and EscalationEngine.checkAndEscalate() never had a rule to
 * fire, even though the engine and its 15-minute scheduled check are both fully working.
 * This mirrors the same rows without the dev-only restriction, so they exist in every
 * environment; it is a pure no-op if they're already there (dev seeding included).
 */
@Component
@RequiredArgsConstructor
public class EscalationRuleSeedRunner implements CommandLineRunner {

    private final EscalationRuleRepository escalationRules;

    @Override
    public void run(String... args) {
        try {
            if (escalationRules.count() == 0) {
                escalationRules.saveAll(List.of(
                        EscalationRule.builder().docKey("QUALITY_INSPECTION").priority("HIGH").slaHours(4).escalateToRole("QUALITY_MANAGER").notifyChannels("IN_APP").active(true).build(),
                        EscalationRule.builder().docKey("QUALITY_NCR").priority("CRITICAL").slaHours(24).escalateToRole("QUALITY_MANAGER").notifyChannels("IN_APP").active(true).build(),
                        EscalationRule.builder().docKey("QUALITY_CAPA").priority("CRITICAL").slaHours(72).escalateToRole("QUALITY_MANAGER").notifyChannels("IN_APP").active(true).build(),
                        EscalationRule.builder().docKey("BREAKDOWN_INTIMATION").priority("HIGH").slaHours(2).escalateToRole("MAINTENANCE_MANAGER").notifyChannels("IN_APP").active(true).build(),
                        // Production Module FRS §7: breakdown >2hrs must also alert the
                        // Production side, not just Maintenance — no separate PRODUCTION_MANAGER
                        // role exists in this codebase's Role master, so this uses the closest
                        // established one (PRODUCTION_SUPERVISOR).
                        EscalationRule.builder().docKey("BREAKDOWN_INTIMATION").priority("HIGH").slaHours(2).escalateToRole("PRODUCTION_SUPERVISOR").notifyChannels("IN_APP").active(true).build(),
                        EscalationRule.builder().docKey("BREAKDOWN_INTIMATION").priority("CRITICAL").slaHours(8).escalateToRole("MAINTENANCE_MANAGER").notifyChannels("IN_APP").active(true).build(),
                        EscalationRule.builder().docKey("PM_COMPLETION").priority("HIGH").slaHours(48).escalateToRole("MAINTENANCE_MANAGER").notifyChannels("IN_APP").active(true).build(),
                        EscalationRule.builder().docKey("CALIBRATION_ENTRY").priority("HIGH").slaHours(24).escalateToRole("QUALITY_MANAGER").notifyChannels("IN_APP").active(true).build()
                ));
            }
        } catch (Exception ignored) {
            // Table may not exist yet on a fresh schema before Hibernate's ddl-auto has run;
            // harmless — the next startup will succeed once it does.
        }
    }
}
