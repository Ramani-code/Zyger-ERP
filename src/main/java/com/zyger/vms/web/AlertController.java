package com.zyger.vms.web;

import java.util.List;

import com.zyger.vms.dto.AlertItem;
import com.zyger.vms.service.AlertService;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/alerts")
public class AlertController {

    private final AlertService service;

    public AlertController(AlertService service) {
        this.service = service;
    }

    @GetMapping
    public List<AlertItem> active() {
        return service.active();
    }
}
