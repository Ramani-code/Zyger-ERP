package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.entity.ToolLifeEntry;
import in.zygertechnology.zygererp.service.ToolLifeService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.List;

/** Production Module FRS v1.0 §5.5 — Tool Life / Tool Change Entry endpoints. */
@RestController
@RequestMapping("/api/v1/production/tool-life")
@RequiredArgsConstructor
public class ToolLifeController {

    private final ToolLifeService toolLifeService;

    private static String principalName(Principal p) { return p != null ? p.getName() : "system"; }

    @GetMapping
    public List<ToolLifeEntry> list(@RequestParam(required = false) String toolCode,
                                     @RequestParam(required = false) String jobCardNumber) {
        if (toolCode != null && !toolCode.isBlank()) return toolLifeService.byTool(toolCode);
        if (jobCardNumber != null && !jobCardNumber.isBlank()) return toolLifeService.byJobCard(jobCardNumber);
        return toolLifeService.list();
    }

    @PostMapping
    public ToolLifeEntry create(@RequestBody ToolLifeEntry entry, Principal p) {
        return toolLifeService.create(entry, principalName(p));
    }
}
