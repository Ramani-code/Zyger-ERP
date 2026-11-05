package com.zyger.vms.dto;

import java.time.Duration;
import java.time.format.DateTimeFormatter;

import com.zyger.vms.domain.VehicleEntry;

/** One row of the vehicle log report (includes dates, unlike the live gate log). */
public record VehicleLogResponse(
        String id,
        String vehicleNumber,
        String driverName,
        String vendor,
        String material,
        String purpose,
        String gate,
        String entryDate,
        String entryTime,
        String exitDate,
        String exitTime,
        String duration,
        String status,
        String loadWeight) {

    private static final DateTimeFormatter DATE = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    public static VehicleLogResponse from(VehicleEntry e) {
        String duration = null;
        if (e.getExitAt() != null) {
            Duration d = Duration.between(e.getEntryAt(), e.getExitAt());
            long minutes = Math.max(0, d.toMinutes());
            duration = (minutes / 60) + "h " + String.format("%02d", minutes % 60) + "m";
        }
        return new VehicleLogResponse(
                e.getEntryCode(),
                e.getVehicleNumber(),
                e.getDriverName(),
                e.getVendor(),
                e.getMaterial(),
                e.getPurpose(),
                e.getGate().getName(),
                e.getEntryAt().format(DATE),
                e.getEntryAt().format(HH_MM),
                e.getExitAt() == null ? null : e.getExitAt().format(DATE),
                e.getExitAt() == null ? null : e.getExitAt().format(HH_MM),
                duration,
                e.getExitAt() == null ? "Inside" : "Exited",
                e.getLoadWeightKg() == null ? null : e.getLoadWeightKg().stripTrailingZeros().toPlainString());
    }
}
