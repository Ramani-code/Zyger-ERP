package com.zyger.vms.service;

import java.time.Clock;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.zyger.vms.domain.Gate;
import com.zyger.vms.domain.VehicleEntry;
import com.zyger.vms.domain.Visit;
import com.zyger.vms.domain.VisitStatus;
import com.zyger.vms.dto.DashboardResponse;
import com.zyger.vms.dto.DepartmentCount;
import com.zyger.vms.dto.GateActivity;
import com.zyger.vms.repository.GateRepository;
import com.zyger.vms.repository.VehicleEntryRepository;
import com.zyger.vms.repository.VisitRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DashboardService {

    private final VisitRepository visits;
    private final VehicleEntryRepository vehicles;
    private final GateRepository gates;
    private final Clock clock;

    public DashboardService(VisitRepository visits, VehicleEntryRepository vehicles,
                            GateRepository gates, Clock clock) {
        this.visits = visits;
        this.vehicles = vehicles;
        this.gates = gates;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public DashboardResponse today() {
        LocalDate today = LocalDate.now(clock);

        List<Visit> todaysVisits = visits.findByVisitDate(today);
        Map<String, Long> byDepartment = new LinkedHashMap<>();
        for (Visit v : todaysVisits) {
            if (v.getDepartment() != null) {
                byDepartment.merge(v.getDepartment().getName(), 1L, Long::sum);
            }
        }
        List<DepartmentCount> departments = byDepartment.entrySet().stream()
                .map(e -> new DepartmentCount(e.getKey(), e.getValue()))
                .sorted(Comparator.comparingLong(DepartmentCount::visitors).reversed())
                .toList();

        List<VehicleEntry> todaysVehicles = vehicles
                .findByEntryAtGreaterThanEqualAndEntryAtLessThanOrderByEntryAtDesc(
                        today.atStartOfDay(), today.plusDays(1).atStartOfDay());
        List<GateActivity> gateActivity = gates.findByActiveTrueOrderByNameAsc().stream()
                .map(g -> toGateActivity(g, todaysVehicles))
                .toList();

        return new DashboardResponse(
                today.toString(),
                todaysVisits.size(),
                visits.countByStatus(VisitStatus.CHECKED_IN),
                visits.countByVisitDateAndStatus(today, VisitStatus.CHECKED_OUT),
                todaysVehicles.size(),
                departments,
                gateActivity);
    }

    private static GateActivity toGateActivity(Gate gate, List<VehicleEntry> entries) {
        long total = entries.stream().filter(e -> e.getGate().getId().equals(gate.getId())).count();
        long inside = entries.stream()
                .filter(e -> e.getGate().getId().equals(gate.getId()) && e.getExitAt() == null)
                .count();
        return new GateActivity(gate.getName(), total, inside);
    }
}
