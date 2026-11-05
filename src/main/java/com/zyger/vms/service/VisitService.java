package com.zyger.vms.service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.Year;
import java.util.Arrays;
import java.util.List;

import com.zyger.vms.domain.Department;
import com.zyger.vms.domain.Gate;
import com.zyger.vms.domain.Visit;
import com.zyger.vms.domain.VisitStatus;
import com.zyger.vms.domain.VisitorProfile;
import com.zyger.vms.dto.RescheduleRequest;
import com.zyger.vms.dto.VisitorProfileResponse;
import com.zyger.vms.dto.VisitorRegistrationRequest;
import com.zyger.vms.dto.VisitorResponse;
import com.zyger.vms.repository.DepartmentRepository;
import com.zyger.vms.repository.GateRepository;
import com.zyger.vms.repository.VisitRepository;
import com.zyger.vms.repository.VisitorProfileRepository;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class VisitService {

    /** Recorded as the decision-maker now that sign-in is removed. */
    public static final String DESK_ACTOR = "Front desk";

    private static final LocalDate MIN_DATE = LocalDate.of(1900, 1, 1);
    private static final LocalDate MAX_DATE = LocalDate.of(9999, 12, 31);

    private final VisitRepository visits;
    private final VisitorProfileRepository profiles;
    private final DepartmentRepository departments;
    private final PhotoService photos;
    private final GateRepository gates;
    private final Clock clock;

    public VisitService(VisitRepository visits, VisitorProfileRepository profiles,
                        DepartmentRepository departments, PhotoService photos, GateRepository gates, Clock clock) {
        this.visits = visits;
        this.profiles = profiles;
        this.departments = departments;
        this.photos = photos;
        this.gates = gates;
        this.clock = clock;
    }

    // ---------- queries ----------

    @Transactional(readOnly = true)
    public List<VisitorResponse> list(String name, String department, String status,
                                      LocalDate fromDate, LocalDate toDate) {
        String namePattern = "%" + (name == null ? "" : name.trim().toLowerCase()) + "%";
        String dept = department == null ? "" : department.trim();
        List<VisitStatus> statuses = hasText(status)
                ? List.of(VisitStatus.parse(status))
                : Arrays.asList(VisitStatus.values());
        LocalDate from = fromDate == null ? MIN_DATE : fromDate;
        LocalDate to = toDate == null ? MAX_DATE : toDate;
        if (to.isBefore(from)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "'To' date cannot be before 'From' date");
        }
        return visits.search(namePattern, dept, statuses, from, to).stream()
                .map(VisitorResponse::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public VisitorResponse getByCode(String code) {
        return VisitorResponse.from(findByCode(code));
    }

    @Transactional(readOnly = true)
    public VisitorResponse getByPass(String passId) {
        return VisitorResponse.from(findByPass(passId));
    }

    @Transactional(readOnly = true)
    public List<VisitorProfileResponse> searchProfiles(String q) {
        if (!hasText(q) || q.trim().length() < 2) {
            return List.of();
        }
        String term = q.trim();
        return profiles.findTop10ByFullNameContainingIgnoreCaseOrPhoneContaining(term, term).stream()
                .map(p -> {
                    Visit last = visits.findFirstByVisitorIdOrderByIdDesc(p.getId()).orElse(null);
                    String host = last == null ? null : last.getHostName();
                    String dept = last == null || last.getDepartment() == null ? null : last.getDepartment().getName();
                    return new VisitorProfileResponse(p.getId(), p.getFullName(), p.getPhone(),
                            p.getEmail(), p.getCompany(), host, dept);
                })
                .toList();
    }

    // ---------- registration ----------

    @Transactional
    public VisitorResponse register(VisitorRegistrationRequest r) {
        if (r.visitDate().isBefore(LocalDate.now(clock))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Visit date cannot be in the past");
        }

        String phone = r.mobile().trim();
        VisitorProfile profile = profiles.findByPhone(phone).orElseGet(VisitorProfile::new);
        profile.setPhone(phone);
        profile.setFullName(r.name().trim());
        if (hasText(r.email())) {
            profile.setEmail(r.email().trim());
        }
        if (hasText(r.company())) {
            profile.setCompany(r.company().trim());
        }
        profile = profiles.save(profile);

        Department department = null;
        if (hasText(r.department())) {
            String deptName = r.department().trim();
            department = departments.findByNameIgnoreCase(deptName)
                    .orElseGet(() -> departments.save(new Department(deptName)));
        }

        Gate gate = gates.findByNameIgnoreCase(r.gate().trim())
                .filter(Gate::isActive)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose an active gate for the visit."));

        long n = visits.nextCodeNumber();
        Visit visit = new Visit();
        visit.setVisitCode(String.format("V-%03d", n));
        visit.setPassId(String.format("QR-%d-%04d", Year.now(clock).getValue(), n));
        visit.setVisitor(profile);
        visit.setPurpose(r.purpose().trim());
        visit.setHostName(hasText(r.host()) ? r.host().trim() : null);
        visit.setDepartment(department);
        visit.setGate(gate);
        visit.setVisitDate(r.visitDate());
        visit.setVisitTime(r.visitTime());
        visit.setStatus(VisitStatus.PENDING_APPROVAL);
        Visit saved = visits.save(visit);
        photos.store(saved.getVisitCode(), r.photo());
        return VisitorResponse.from(saved);
    }

    // ---------- approvals ----------

    @Transactional
    public VisitorResponse approve(String code, String actor) {
        Visit v = findByCode(code);
        requireStatus(v, "approved", VisitStatus.PENDING_APPROVAL);
        v.setStatus(VisitStatus.APPROVED);
        stampDecision(v, actor);
        return VisitorResponse.from(v);
    }

    @Transactional
    public VisitorResponse reject(String code, String actor) {
        Visit v = findByCode(code);
        requireStatus(v, "rejected", VisitStatus.PENDING_APPROVAL);
        v.setStatus(VisitStatus.REJECTED);
        stampDecision(v, actor);
        return VisitorResponse.from(v);
    }

    @Transactional
    public VisitorResponse reschedule(String code, RescheduleRequest r) {
        Visit v = findByCode(code);
        requireStatus(v, "rescheduled", VisitStatus.PENDING_APPROVAL, VisitStatus.APPROVED);
        if (r.visitDate().isBefore(LocalDate.now(clock))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Visit date cannot be in the past");
        }
        v.setVisitDate(r.visitDate());
        v.setVisitTime(r.visitTime());
        v.setStatus(VisitStatus.PENDING_APPROVAL);
        return VisitorResponse.from(v);
    }

    // ---------- delete ----------

    /** Deletes a visit with its photo. The visitor profile is removed too when it has no other visit. */
    @Transactional
    public void delete(String code) {
        Visit v = findByCode(code);
        VisitorProfile profile = v.getVisitor();
        photos.delete(v.getVisitCode());
        visits.delete(v);
        visits.flush();
        if (profile != null && !visits.existsByVisitorId(profile.getId())) {
            profiles.delete(profile);
        }
    }

    // ---------- gate ----------

    @Transactional
    public VisitorResponse checkIn(String passId) {
        Visit v = findByPass(passId);
        switch (v.getStatus()) {
            case APPROVED -> {
                v.setStatus(VisitStatus.CHECKED_IN);
                v.setCheckInAt(LocalDateTime.now(clock));
            }
            case PENDING_APPROVAL, REJECTED ->
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "This pass isn't cleared for entry yet");
            case CHECKED_IN ->
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "Visitor is already checked in");
            case CHECKED_OUT ->
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "This pass has already been used");
        }
        return VisitorResponse.from(v);
    }

    @Transactional
    public VisitorResponse checkOut(String passId) {
        Visit v = findByPass(passId);
        if (v.getStatus() != VisitStatus.CHECKED_IN) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Visitor is not currently checked in");
        }
        v.setStatus(VisitStatus.CHECKED_OUT);
        v.setCheckOutAt(LocalDateTime.now(clock));
        return VisitorResponse.from(v);
    }

    // ---------- helpers ----------

    private Visit findByCode(String code) {
        return visits.findByVisitCode(code.trim())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Visit not found: " + code));
    }

    private Visit findByPass(String passId) {
        return visits.findByPassIdIgnoreCase(passId.trim())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "No pass matches that ID. Check the number and try again."));
    }

    private void requireStatus(Visit v, String action, VisitStatus... allowed) {
        for (VisitStatus s : allowed) {
            if (v.getStatus() == s) {
                return;
            }
        }
        throw new ResponseStatusException(HttpStatus.CONFLICT,
                "Visit cannot be " + action + " while it is '" + v.getStatus().getLabel() + "'");
    }

    private void stampDecision(Visit v, String actor) {
        v.setDecidedBy(actor);
        v.setDecidedAt(LocalDateTime.now(clock));
    }

    private static boolean hasText(String s) {
        return s != null && !s.isBlank();
    }
}
