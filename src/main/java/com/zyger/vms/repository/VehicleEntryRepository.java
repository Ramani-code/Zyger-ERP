package com.zyger.vms.repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import com.zyger.vms.domain.VehicleEntry;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface VehicleEntryRepository extends JpaRepository<VehicleEntry, Long> {

    @EntityGraph(attributePaths = {"gate"})
    List<VehicleEntry> findByEntryAtGreaterThanEqualAndEntryAtLessThanOrderByEntryAtDesc(
            LocalDateTime from, LocalDateTime to);

    @EntityGraph(attributePaths = {"gate"})
    Optional<VehicleEntry> findByEntryCode(String entryCode);

    @EntityGraph(attributePaths = {"gate"})
    List<VehicleEntry> findByExitAtIsNullAndEntryAtBefore(LocalDateTime cutoff);

    @Query(value = "select nextval('vehicle_code_seq')", nativeQuery = true)
    Long nextCodeNumber();
}
