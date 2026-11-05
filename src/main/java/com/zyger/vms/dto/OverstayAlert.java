package com.zyger.vms.dto;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

import com.zyger.vms.domain.Visit;

/** A visitor still checked in after the overstay limit (6 hours). */
public record OverstayAlert(
        String code,
        String passId,
        String name,
        String company,
        String host,
        String checkInTime,
        long minutesInside,
        String staffMessage,
        String adminMessage) {

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    public static OverstayAlert from(Visit v, LocalDateTime now) {
        String name = v.getVisitor().getFullName();
        long minutes = Math.max(0, Duration.between(v.getCheckInAt(), now).toMinutes());
        String elapsed = (minutes / 60) + "h " + String.format("%02d", minutes % 60) + "m";
        String checkIn = v.getCheckInAt().format(HH_MM);
        return new OverstayAlert(
                v.getVisitCode(),
                v.getPassId(),
                name,
                v.getVisitor().getCompany(),
                v.getHostName(),
                checkIn,
                minutes,
                "Visitor " + name + " (" + v.getPassId() + ") has been inside for " + elapsed
                        + ". Please check them out at the gate.",
                "ADMIN ALERT: " + name + " (" + v.getPassId() + ") checked in at " + checkIn
                        + " and has no check-out after " + elapsed + ".");
    }
}
