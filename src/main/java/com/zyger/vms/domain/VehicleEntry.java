package com.zyger.vms.domain;

import java.math.BigDecimal;
import java.time.LocalDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

@Entity
@Table(name = "vehicle_entries")
public class VehicleEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "entry_code", nullable = false, unique = true, length = 20)
    private String entryCode;

    @Column(name = "vehicle_number", nullable = false, length = 30)
    private String vehicleNumber;

    @Column(name = "driver_name", nullable = false, length = 120)
    private String driverName;

    @Column(name = "vendor", length = 150)
    private String vendor;

    @Column(name = "material", length = 150)
    private String material;

    @Column(name = "purpose", length = 150)
    private String purpose;

    @Column(name = "load_weight_kg", precision = 10, scale = 2)
    private BigDecimal loadWeightKg;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "gate_id", nullable = false)
    private Gate gate;

    @Column(name = "entry_at", nullable = false)
    private LocalDateTime entryAt;

    @Column(name = "exit_at")
    private LocalDateTime exitAt;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }

    public Long getId() { return id; }
    public String getEntryCode() { return entryCode; }
    public void setEntryCode(String entryCode) { this.entryCode = entryCode; }
    public String getVehicleNumber() { return vehicleNumber; }
    public void setVehicleNumber(String vehicleNumber) { this.vehicleNumber = vehicleNumber; }
    public String getDriverName() { return driverName; }
    public void setDriverName(String driverName) { this.driverName = driverName; }
    public String getVendor() { return vendor; }
    public void setVendor(String vendor) { this.vendor = vendor; }
    public String getMaterial() { return material; }
    public void setMaterial(String material) { this.material = material; }
    public String getPurpose() { return purpose; }
    public void setPurpose(String purpose) { this.purpose = purpose; }
    public BigDecimal getLoadWeightKg() { return loadWeightKg; }
    public void setLoadWeightKg(BigDecimal loadWeightKg) { this.loadWeightKg = loadWeightKg; }
    public Gate getGate() { return gate; }
    public void setGate(Gate gate) { this.gate = gate; }
    public LocalDateTime getEntryAt() { return entryAt; }
    public void setEntryAt(LocalDateTime entryAt) { this.entryAt = entryAt; }
    public LocalDateTime getExitAt() { return exitAt; }
    public void setExitAt(LocalDateTime exitAt) { this.exitAt = exitAt; }
    public LocalDateTime getCreatedAt() { return createdAt; }
}
