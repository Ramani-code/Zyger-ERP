package com.zyger.vms.dto;

import java.time.LocalDate;
import java.time.LocalTime;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record VisitorRegistrationRequest(
        @NotBlank @Size(max = 120) String name,
        @NotBlank @Size(max = 30) String mobile,
        @Email @Size(max = 150) String email,
        @Size(max = 150) String company,
        @NotBlank @Size(max = 200) String purpose,
        @Size(max = 120) String host,
        @Size(max = 100) String department,
        @NotBlank @Size(max = 50) String gate,
        @NotNull LocalDate visitDate,
        @NotNull LocalTime visitTime,
        @Size(max = 1_600_000) String photo) {
}
