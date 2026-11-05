package com.zyger.vms.dto;

import java.time.format.DateTimeFormatter;

import com.zyger.vms.domain.Visit;

/** Same shape as the frontend's `Visitor` TypeScript interface. */
public record VisitorResponse(
        String id,
        String passId,
        String name,
        String company,
        String phone,
        String email,
        String purpose,
        String host,
        String department,
        String visitDate,
        String visitTime,
        String status,
        String checkInTime,
        String checkOutTime,
        String photoInitials,
        String gate) {

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    public static VisitorResponse from(Visit v) {
        String name = v.getVisitor().getFullName();
        return new VisitorResponse(
                v.getVisitCode(),
                v.getPassId(),
                name,
                v.getVisitor().getCompany(),
                v.getVisitor().getPhone(),
                v.getVisitor().getEmail(),
                v.getPurpose(),
                v.getHostName(),
                v.getDepartment() == null ? null : v.getDepartment().getName(),
                v.getVisitDate().toString(),
                v.getVisitTime().format(HH_MM),
                v.getStatus().getLabel(),
                v.getCheckInAt() == null ? null : v.getCheckInAt().format(HH_MM),
                v.getCheckOutAt() == null ? null : v.getCheckOutAt().format(HH_MM),
                initials(name),
                v.getGate() == null ? null : v.getGate().getName());
    }

    static String initials(String name) {
        StringBuilder sb = new StringBuilder();
        for (String part : name.trim().split("\\s+")) {
            if (!part.isEmpty() && sb.length() < 2) {
                sb.append(Character.toUpperCase(part.charAt(0)));
            }
        }
        return sb.toString();
    }
}
