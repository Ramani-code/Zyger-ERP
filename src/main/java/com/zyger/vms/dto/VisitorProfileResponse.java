package com.zyger.vms.dto;

public record VisitorProfileResponse(
        Long id,
        String name,
        String phone,
        String email,
        String company,
        String lastHost,
        String lastDepartment) {
}
