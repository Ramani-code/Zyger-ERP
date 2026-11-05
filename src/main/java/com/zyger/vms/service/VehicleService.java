package com.zyger.vms.service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import com.zyger.vms.domain.Gate;
import com.zyger.vms.domain.VehicleEntry;
import com.zyger.vms.dto.VehicleRequest;
import com.zyger.vms.dto.VehicleResponse;
import com.zyger.vms.repository.GateRepository;
import com.zyger.vms.repository.VehicleEntryRepository;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class VehicleService {

    private final VehicleEntryRepository entries;
    private final GateRepository gates;
    private final PhotoService photos;
    private final Clock clock;

    public VehicleService(VehicleEntryRepository entries, GateRepository gates, PhotoService photos, Clock clock) {
        this.entries = entries;
        this.gates = gates;
        this.photos = photos;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<VehicleResponse> list(LocalDate date) {
        LocalDate day = date == null ? LocalDate.now(clock) : date;
        return entries.findByEntryAtGreaterThanEqualAndEntryAtLessThanOrderByEntryAtDesc(
                        day.atStartOfDay(), day.plusDays(1).atStartOfDay())
                .stream().map(VehicleResponse::from).toList();
    }

    @Transactional
    public VehicleResponse create(VehicleRequest r) {
        Gate gate = gates.findByNameIgnoreCase(r.gate().trim())
                .filter(Gate::isActive)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown gate: " + r.gate()));
        long n = entries.nextCodeNumber();
        VehicleEntry e = new VehicleEntry();
        e.setEntryCode(String.format("VH-%03d", n));
        e.setVehicleNumber(r.vehicleNumber().trim().toUpperCase());
        e.setDriverName(r.driverName().trim());
        e.setVendor(blankToNull(r.vendor()));
        e.setMaterial(blankToNull(r.material()));
        e.setPurpose(blankToNull(r.purpose()));
        e.setLoadWeightKg(r.loadWeight());
        e.setGate(gate);
        e.setEntryAt(LocalDateTime.now(clock));
        VehicleEntry saved = entries.save(e);
        photos.store(saved.getEntryCode(), r.photo());
        return VehicleResponse.from(saved);
    }

    @Transactional
    public VehicleResponse logExit(String code) {
        VehicleEntry e = entries.findByEntryCode(code.trim())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Vehicle entry not found: " + code));
        if (e.getExitAt() != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Exit already logged for " + code);
        }
        e.setExitAt(LocalDateTime.now(clock));
        return VehicleResponse.from(e);
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
