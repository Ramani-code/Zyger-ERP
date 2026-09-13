package in.zygertechnology.zygererp.service;

import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class DocumentWorkflowEngine {

    private static final Map<String, Map<String, Set<String>>> TRANSITIONS = new HashMap<>();

    static {
        // Quality Inspection: OPEN → SUBMITTED → APPROVED | REJECTED | CANCELLED
        Map<String, Set<String>> qi = new HashMap<>();
        qi.put("OPEN",       Set.of("SUBMITTED", "CANCELLED"));
        qi.put("SUBMITTED",  Set.of("APPROVED", "REJECTED", "IN_PROCESS"));
        qi.put("IN_PROCESS", Set.of("APPROVED", "REJECTED"));
        qi.put("APPROVED",   Set.of("CLOSED"));
        qi.put("REJECTED",   Set.of("OPEN")); // reopen
        qi.put("CANCELLED",  Set.of("OPEN")); // reopen
        qi.put("CLOSED",     Set.of());       // terminal
        TRANSITIONS.put("QUALITY_INSPECTION", qi);

        // Quality NCR: OPEN → IN_PROGRESS → CLOSED
        Map<String, Set<String>> ncr = new HashMap<>();
        ncr.put("OPEN",         Set.of("IN_PROGRESS", "CANCELLED"));
        ncr.put("IN_PROGRESS",  Set.of("CLOSED"));
        ncr.put("CLOSED",       Set.of());
        ncr.put("CANCELLED",    Set.of("OPEN"));
        TRANSITIONS.put("QUALITY_NCR", ncr);

        // Quality Concession: DRAFT → SUBMITTED → APPROVED | REJECTED
        Map<String, Set<String>> conc = new HashMap<>();
        conc.put("DRAFT",     Set.of("SUBMITTED", "CANCELLED"));
        conc.put("SUBMITTED", Set.of("APPROVED", "REJECTED"));
        conc.put("APPROVED",  Set.of("CLOSED"));
        conc.put("REJECTED",  Set.of("DRAFT"));
        conc.put("CANCELLED", Set.of("DRAFT"));
        conc.put("CLOSED",    Set.of());
        TRANSITIONS.put("QUALITY_CONCESSION", conc);

        // Quality Test Certificate: DRAFT → SUBMITTED → APPROVED
        Map<String, Set<String>> tc = new HashMap<>();
        tc.put("DRAFT",     Set.of("SUBMITTED", "CANCELLED"));
        tc.put("SUBMITTED", Set.of("APPROVED", "REJECTED"));
        tc.put("APPROVED",  Set.of());
        tc.put("REJECTED",  Set.of("DRAFT"));
        tc.put("CANCELLED", Set.of("DRAFT"));
        TRANSITIONS.put("QUALITY_TEST_CERTIFICATE", tc);

        // Quality Calibration Record: PLANNED → DUE → DONE → OVERDUE
        Map<String, Set<String>> cal = new HashMap<>();
        cal.put("PLANNED", Set.of("DUE"));
        cal.put("DUE",     Set.of("DONE", "OVERDUE"));
        cal.put("OVERDUE", Set.of("DONE"));
        cal.put("DONE",    Set.of());
        TRANSITIONS.put("QUALITY_CALIBRATION_RECORD", cal);

        // Quality Customer Complaint: OPEN → UNDER_INVESTIGATION → RESOLVED | CLOSED
        Map<String, Set<String>> comp = new HashMap<>();
        comp.put("OPEN",                 Set.of("UNDER_INVESTIGATION"));
        comp.put("UNDER_INVESTIGATION",  Set.of("RESOLVED"));
        comp.put("RESOLVED",             Set.of("CLOSED"));
        comp.put("CLOSED",               Set.of());
        TRANSITIONS.put("QUALITY_CUSTOMER_COMPLAINT", comp);

        // Quality CAPA: OPEN → IN_PROGRESS → EFFECTIVENESS_CHECK → CLOSED
        Map<String, Set<String>> capa = new HashMap<>();
        capa.put("OPEN",                   Set.of("IN_PROGRESS"));
        capa.put("IN_PROGRESS",            Set.of("EFFECTIVENESS_CHECK"));
        capa.put("EFFECTIVENESS_CHECK",    Set.of("CLOSED", "IN_PROGRESS"));
        capa.put("CLOSED",                 Set.of());
        TRANSITIONS.put("QUALITY_CAPA", capa);

        // Quality 8D: DRAFT → TEAM_FORMED → CONTAINMENT → ROOT_CAUSE → PERMANENT_ACTION → VALIDATION → CLOSED
        Map<String, Set<String>> eightD = new HashMap<>();
        eightD.put("DRAFT",             Set.of("TEAM_FORMED"));
        eightD.put("TEAM_FORMED",       Set.of("CONTAINMENT"));
        eightD.put("CONTAINMENT",       Set.of("ROOT_CAUSE"));
        eightD.put("ROOT_CAUSE",        Set.of("PERMANENT_ACTION"));
        eightD.put("PERMANENT_ACTION",  Set.of("VALIDATION"));
        eightD.put("VALIDATION",        Set.of("CLOSED", "ROOT_CAUSE"));
        eightD.put("CLOSED",            Set.of());
        TRANSITIONS.put("QUALITY_8D", eightD);

        // Breakdown Intimation: OPEN → ASSIGNED → DIAGNOSED → CLOSED, CANCELLED from any
        // non-terminal state. [CORRECTED — Maintenance Module audit] the old vocabulary here
        // (DRAFT/OPEN/IN_PROGRESS/CLOSED) never matched what MaintenanceService.breakdownAction
        // actually writes, so the _allowedTransitions metadata sent to the frontend was
        // meaningless; validate() is not called against this map (breakdownAction enforces its
        // own rules — BR-03 — directly), so this fixes only that displayed metadata, not
        // enforcement.
        Map<String, Set<String>> bi = new HashMap<>();
        bi.put("OPEN",       Set.of("ASSIGNED", "CANCELLED"));
        bi.put("ASSIGNED",   Set.of("DIAGNOSED", "CANCELLED"));
        bi.put("DIAGNOSED",  Set.of("CLOSED", "CANCELLED"));
        bi.put("CLOSED",     Set.of());
        bi.put("CANCELLED",  Set.of());
        TRANSITIONS.put("BREAKDOWN_INTIMATION", bi);

        // PM Schedule: UPCOMING → IN_PROGRESS → COMPLETED, with SKIPPED and OVERDUE side
        // paths. [CORRECTED — Maintenance Module audit] same situation as above: the old
        // PLANNED/DUE/DONE/OVERDUE vocabulary never matched MaintenanceService.pmScheduleAction
        // or the daily OVERDUE status-recalc job; validate() is not called against this map.
        Map<String, Set<String>> pms = new HashMap<>();
        pms.put("UPCOMING",    Set.of("IN_PROGRESS", "SKIPPED", "OVERDUE"));
        pms.put("OVERDUE",     Set.of("IN_PROGRESS", "COMPLETED"));
        pms.put("IN_PROGRESS", Set.of("COMPLETED"));
        pms.put("COMPLETED",   Set.of());
        pms.put("SKIPPED",     Set.of());
        TRANSITIONS.put("PM_SCHEDULE", pms);
    }

    /**
     * Validate that the requested transition is allowed.
     * @throws IllegalStateException if transition is not allowed
     */
    public void validate(String docKey, String currentStatus, String requestedStatus) {
        Map<String, Set<String>> allowed = TRANSITIONS.get(docKey);
        if (allowed == null) return; // No workflow configured → allow
        Set<String> targets = allowed.get(currentStatus);
        if (targets == null || !targets.contains(requestedStatus)) {
            throw new IllegalStateException(
                    String.format("Transition %s → %s not allowed for %s. Allowed: %s",
                            currentStatus, requestedStatus, docKey,
                            targets != null ? targets : Set.of()));
        }
    }

    /**
     * Get all allowed next states for a given document type and current status.
     */
    public Set<String> allowedTransitions(String docKey, String currentStatus) {
        Map<String, Set<String>> allowed = TRANSITIONS.get(docKey);
        if (allowed == null) return Set.of();
        return allowed.getOrDefault(currentStatus, Set.of());
    }

    /**
     * Check if terminal state (no further transitions).
     */
    public boolean isTerminal(String docKey, String status) {
        return allowedTransitions(docKey, status).isEmpty();
    }

    /**
     * Enrich a DTO map with _allowedTransitions.
     */
    public Map<String, Object> enrich(String docKey, String status, Map<String, Object> dto) {
        dto.put("_allowedTransitions", allowedTransitions(docKey, status));
        dto.put("_isTerminal", isTerminal(docKey, status));
        return dto;
    }
}
