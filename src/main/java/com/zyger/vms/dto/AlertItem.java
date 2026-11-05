package com.zyger.vms.dto;

/**
 * A visitor or vehicle that is still inside past the alert limit.
 * level is "6H" for the first alert and "24H" once the escalation limit is reached.
 */
public record AlertItem(
        String key,
        String kind,
        String level,
        String code,
        String passOrVehicle,
        String name,
        String detail,
        String sinceTime,
        long minutesInside,
        String message) {
}
