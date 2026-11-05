package com.zyger.vms.domain;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public enum VisitStatus {
    PENDING_APPROVAL("Pending Approval"),
    APPROVED("Approved"),
    REJECTED("Rejected"),
    CHECKED_IN("Checked In"),
    CHECKED_OUT("Checked Out");

    private final String label;

    VisitStatus(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }

    /** Accepts either the display label ("Checked In") or the enum name ("CHECKED_IN"). */
    public static VisitStatus parse(String value) {
        String text = value == null ? "" : value.trim();
        for (VisitStatus s : values()) {
            if (s.label.equalsIgnoreCase(text) || s.name().equalsIgnoreCase(text)) {
                return s;
            }
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown status: " + value);
    }
}
