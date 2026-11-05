package com.zyger.vms.repository;

import java.util.Optional;

import com.zyger.vms.domain.Department;

import org.springframework.data.jpa.repository.JpaRepository;

public interface DepartmentRepository extends JpaRepository<Department, Long> {

    Optional<Department> findByNameIgnoreCase(String name);
}
