package com.zyger.vms.web;

import java.time.LocalDate;
import java.util.List;

import com.zyger.vms.dto.CheckpointLogEntry;
import com.zyger.vms.service.CheckpointService;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/checkpoint")
public class CheckpointController {

    private final CheckpointService service;

    public CheckpointController(CheckpointService service) {
        this.service = service;
    }

    @GetMapping("/log")
    public List<CheckpointLogEntry> log(
            @RequestParam(name = "date", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return service.log(date);
    }
}
