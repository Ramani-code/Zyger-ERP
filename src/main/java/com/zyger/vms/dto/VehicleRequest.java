package com.zyger.vms.dto;

import java.math.BigDecimal;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record VehicleRequest(
        @NotBlank @Size(max = 30) String vehicleNumber,
        @NotBlank @Size(max = 120) String driverName,
        @Size(max = 150) String vendor,
        @Size(max = 150) String material,
        @Size(max = 150) String purpose,
        @DecimalMin(value = "0", inclusive = false) @DecimalMax("100000") BigDecimal loadWeight,
        @NotBlank String gate,
        @Size(max = 1_600_000) String photo) {
}
