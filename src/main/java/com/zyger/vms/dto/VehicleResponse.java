package com.zyger.vms.dto;

import java.math.BigDecimal;
import java.time.format.DateTimeFormatter;

import com.zyger.vms.domain.VehicleEntry;

/** Same shape as the frontend's `VehicleEntry` TypeScript interface. */
public record VehicleResponse(
        String id,
        String vehicleNumber,
        String driverName,
        String vendor,
        String material,
        String purpose,
        String gate,
        String entryTime,
        String exitTime,
        BigDecimal loadWeight) {

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    public static VehicleResponse from(VehicleEntry e) {
        return new VehicleResponse(
                e.getEntryCode(),
                e.getVehicleNumber(),
                e.getDriverName(),
                e.getVendor(),
                e.getMaterial(),
                e.getPurpose(),
                e.getGate().getName(),
                e.getEntryAt().format(HH_MM),
                e.getExitAt() == null ? null : e.getExitAt().format(HH_MM),
                e.getLoadWeightKg());
    }
}
