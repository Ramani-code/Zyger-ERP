package com.zyger.vms.repository;

import java.util.List;
import java.util.Optional;

import com.zyger.vms.domain.Gate;

import org.springframework.data.jpa.repository.JpaRepository;

public interface GateRepository extends JpaRepository<Gate, Long> {

    Optional<Gate> findByNameIgnoreCase(String name);

    List<Gate> findByActiveTrueOrderByNameAsc();
}
