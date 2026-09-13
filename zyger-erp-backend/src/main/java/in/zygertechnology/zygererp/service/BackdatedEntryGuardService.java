package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.config.BusinessRuleException;
import in.zygertechnology.zygererp.security.CurrentUserRoles;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.Map;

@Service
public class BackdatedEntryGuardService {

    private static final Logger log = LoggerFactory.getLogger(BackdatedEntryGuardService.class);
    private static final int MAX_BACKDATED_HOURS = 2;
    private static final ZoneId SYSTEM_ZONE = ZoneId.of("Asia/Kolkata");

    public void enforce(String docDateStr, String enteredBy) {
        enforce(docDateStr, enteredBy, null);
    }

    /**
     * §9.3 / Inward Entry FRD v2.0 §7 BR-06: backdated-entry authorization guard.
     * If the doc date is more than MAX_BACKDATED_HOURS before now, a Store Manager or Admin
     * may authorize the entry by supplying a mandatory reason — this is the real override the
     * error message below has always promised but, until now, had no way to actually grant.
     * The override itself is audit-logged (who, when, why) rather than silently accepted.
     */
    public void enforce(String docDateStr, String enteredBy, String overrideReason) {
        if (docDateStr == null || docDateStr.isBlank()) return;

        LocalDate docDate;
        try {
            docDate = LocalDate.parse(docDateStr);
        } catch (Exception e) {
            return;
        }

        LocalDateTime docDateTime = docDate.atTime(LocalTime.of(23, 59, 59));
        LocalDateTime now = LocalDateTime.now(SYSTEM_ZONE);

        long hoursBack = Duration.between(docDateTime, now).toHours();

        if (hoursBack > MAX_BACKDATED_HOURS) {
            boolean hasReason = overrideReason != null && !overrideReason.isBlank();
            boolean authorized = hasReason && CurrentUserRoles.hasAnyRole("ADMIN", "STORE_MANAGER", "STORES_MANAGER");

            if (authorized) {
                log.warn("BACKDATED ENTRY AUTHORIZED: docDate={}, hoursBackdated={}, enteredBy={}, authorizedBy={}, reason={}",
                        docDateStr, hoursBack, enteredBy, CurrentUserRoles.username(), overrideReason);
                return;
            }

            Map<String, Object> details = Map.of(
                    "docDate", docDateStr,
                    "hoursBackdated", hoursBack,
                    "maxAllowed", MAX_BACKDATED_HOURS,
                    "enteredBy", enteredBy != null ? enteredBy : "unknown",
                    "overrideRequiresRole", "STORE_MANAGER or ADMIN, with a reason"
            );
            String msg = hasReason
                    ? "Document date " + docDateStr + " is " + hoursBack + " hours in the past. " +
                      "Overriding a backdated entry beyond " + MAX_BACKDATED_HOURS + " hours requires a Store Manager or Admin role."
                    : "Document date " + docDateStr + " is " + hoursBack + " hours in the past. " +
                      "Backdated entries beyond " + MAX_BACKDATED_HOURS + " hours require management authorization (a reason from a Store Manager or Admin).";
            throw new BusinessRuleException("BACKDATED_ENTRY", msg, details);
        }
    }
}
