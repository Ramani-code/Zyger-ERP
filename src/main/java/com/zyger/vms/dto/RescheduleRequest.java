package com.zyger.vms.dto;

import java.time.LocalDate;
import java.time.LocalTime;

import jakarta.validation.constraints.NotNull;

public record RescheduleRequest(@NotNull LocalDate visitDate, @NotNull LocalTime visitTime) {
}
