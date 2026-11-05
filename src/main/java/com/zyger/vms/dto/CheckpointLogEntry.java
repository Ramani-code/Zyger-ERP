package com.zyger.vms.dto;

/** One row of today's check-in / check-out history for visitors and vehicles. */
public record CheckpointLogEntry(
        String kind,
        String code,
        String name,
        String detail,
        String place,
        String inTime,
        String outTime,
        String status,
        long minutesInside,
        boolean overdue) {
}
