package com.zyger.vms.web;

import java.util.List;

import com.zyger.vms.domain.Department;
import com.zyger.vms.domain.Gate;
import com.zyger.vms.repository.DepartmentRepository;
import com.zyger.vms.repository.GateRepository;

import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class ReferenceController {

    private final DepartmentRepository departments;
    private final GateRepository gates;

    public ReferenceController(DepartmentRepository departments, GateRepository gates) {
        this.departments = departments;
        this.gates = gates;
    }

    @GetMapping("/departments")
    public List<String> departments() {
        return departments.findAll(Sort.by("name")).stream().map(Department::getName).toList();
    }

    @GetMapping("/gates")
    public List<String> gates() {
        return gates.findByActiveTrueOrderByNameAsc().stream().map(Gate::getName).toList();
    }
}
