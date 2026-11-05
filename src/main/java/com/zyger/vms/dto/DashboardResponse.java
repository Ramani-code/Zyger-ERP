package com.zyger.vms.dto;

import java.util.List;

public record DashboardResponse(
        String date,
        long visitorsToday,
        long currentlyInside,
        long checkedOutToday,
        long vehiclesLogged,
        List<DepartmentCount> departments,
        List<GateActivity> gates) {
}
