package com.zyger.vms.web;

import java.time.LocalDate;
import java.util.List;

import com.zyger.vms.dto.RescheduleRequest;
import com.zyger.vms.dto.VisitorProfileResponse;
import com.zyger.vms.dto.VisitorRegistrationRequest;
import com.zyger.vms.dto.VisitorResponse;
import com.zyger.vms.service.VisitService;

import jakarta.validation.Valid;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/visitors")
public class VisitorController {

    private final VisitService service;

    public VisitorController(VisitService service) {
        this.service = service;
    }

    /** Filter by one day (date) or by a range (from, to). */
    @GetMapping
    public List<VisitorResponse> list(
            @RequestParam(name = "name", required = false) String name,
            @RequestParam(name = "department", required = false) String department,
            @RequestParam(name = "status", required = false) String status,
            @RequestParam(name = "date", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(name = "from", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(name = "to", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        LocalDate start = from != null ? from : date;
        LocalDate end = to != null ? to : (from != null ? from : date);
        return service.list(name, department, status, start, end);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public VisitorResponse register(@Valid @RequestBody VisitorRegistrationRequest request) {
        return service.register(request);
    }

    @GetMapping("/profiles/search")
    public List<VisitorProfileResponse> searchProfiles(@RequestParam(name = "q") String q) {
        return service.searchProfiles(q);
    }

    @GetMapping("/pass/{passId}")
    public VisitorResponse getByPass(@PathVariable("passId") String passId) {
        return service.getByPass(passId);
    }

    @PostMapping("/pass/{passId}/check-in")
    public VisitorResponse checkIn(@PathVariable("passId") String passId) {
        return service.checkIn(passId);
    }

    @PostMapping("/pass/{passId}/check-out")
    public VisitorResponse checkOut(@PathVariable("passId") String passId) {
        return service.checkOut(passId);
    }

    @GetMapping("/{code}")
    public VisitorResponse get(@PathVariable("code") String code) {
        return service.getByCode(code);
    }

    @PostMapping("/{code}/approve")
    public VisitorResponse approve(@PathVariable("code") String code) {
        return service.approve(code, VisitService.DESK_ACTOR);
    }

    @PostMapping("/{code}/reject")
    public VisitorResponse reject(@PathVariable("code") String code) {
        return service.reject(code, VisitService.DESK_ACTOR);
    }

    @PostMapping("/{code}/reschedule")
    public VisitorResponse reschedule(@PathVariable("code") String code,
                                      @Valid @RequestBody RescheduleRequest request) {
        return service.reschedule(code, request);
    }

    @DeleteMapping("/{code}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable("code") String code) {
        service.delete(code);
    }
}
