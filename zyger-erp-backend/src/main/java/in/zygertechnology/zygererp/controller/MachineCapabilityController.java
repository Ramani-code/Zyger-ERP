package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.entity.MachineCapability;
import in.zygertechnology.zygererp.repo.MachineCapabilityRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.time.Instant;
import java.util.List;

/** Production Module FRS v1.0 §4.1 — Machine Capability Matrix maintenance. */
@RestController
@RequestMapping("/api/v1/production/machine-capabilities")
@RequiredArgsConstructor
public class MachineCapabilityController {

    private final MachineCapabilityRepository repo;

    private static String principalName(Principal p) { return p != null ? p.getName() : "system"; }

    @GetMapping
    public List<MachineCapability> list(@RequestParam(required = false) String machineCode) {
        if (machineCode != null && !machineCode.isBlank()) {
            return repo.findByMachineCodeOrderByOperationCode(machineCode);
        }
        return repo.findAllByOrderByMachineCodeAscOperationCodeAsc();
    }

    @PostMapping
    public MachineCapability create(@RequestBody MachineCapability body, Principal p) {
        if (body.getMachineCode() == null || body.getMachineCode().isBlank()) {
            throw new IllegalArgumentException("Machine Code is required");
        }
        if (body.getOperationCode() == null || body.getOperationCode().isBlank()) {
            throw new IllegalArgumentException("Operation Code is required");
        }
        body.setId(null);
        body.setActive(true);
        body.setCreatedBy(principalName(p));
        body.setCreatedAt(Instant.now());
        return repo.save(body);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id) {
        repo.deleteById(id);
    }
}
