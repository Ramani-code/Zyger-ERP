package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repository.*;
import in.zygertechnology.zygererp.security.RequirePermission;
import org.springframework.web.bind.annotation.*;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v2/master")
@RequirePermission(module = "MASTER", screen = "*", action = "VIEW")
public class MasterDataController {

    private final PlantMasterRepository plantRepo;
    private final WorkCenterMasterRepository wcRepo;
    private final MeterMasterRepository meterRepo;
    private final SparePartMasterRepository spareRepo;
    private final SamplingPlanMasterRepository samplingRepo;
    private final InspectionPlanRepository ipRepo;
    private final InspectionPlanCharacteristicRepository ipcRepo;
    private final EscalationRuleRepository escRuleRepo;
    private final EscalationLogRepository escLogRepo;
    private final in.zygertechnology.zygererp.repo.ItemRepository items;

    public MasterDataController(PlantMasterRepository plantRepo,
                                WorkCenterMasterRepository wcRepo,
                                MeterMasterRepository meterRepo,
                                SparePartMasterRepository spareRepo,
                                SamplingPlanMasterRepository samplingRepo,
                                InspectionPlanRepository ipRepo,
                                InspectionPlanCharacteristicRepository ipcRepo,
                                EscalationRuleRepository escRuleRepo,
                                EscalationLogRepository escLogRepo,
                                IdleReasonMasterRepository idleReasonRepo,
                                PendingReasonMasterRepository pendingReasonRepo,
                                RejectReasonMasterRepository rejectReasonRepo,
                                ApprovalStepRepository approvalStepRepo,
                                in.zygertechnology.zygererp.service.WorkflowStateMachine stateMachine,
                                jakarta.persistence.EntityManager em,
                                in.zygertechnology.zygererp.repo.ItemRepository items) {
        this.plantRepo = plantRepo;
        this.wcRepo = wcRepo;
        this.meterRepo = meterRepo;
        this.spareRepo = spareRepo;
        this.samplingRepo = samplingRepo;
        this.ipRepo = ipRepo;
        this.ipcRepo = ipcRepo;
        this.escRuleRepo = escRuleRepo;
        this.escLogRepo = escLogRepo;
        this.idleReasonRepo = idleReasonRepo;
        this.pendingReasonRepo = pendingReasonRepo;
        this.rejectReasonRepo = rejectReasonRepo;
        this.approvalStepRepo = approvalStepRepo;
        this.stateMachine = stateMachine;
        this.em = em;
        this.items = items;
    }

    // ── PLANT ──
    @GetMapping("/plants")
    public List<Map<String, Object>> listPlants() {
        return plantRepo.findAll().stream().map(p -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", p.getId());
            m.put("code", p.getCode());
            m.put("name", p.getName());
            m.put("address", p.getAddress());
            m.put("timezone", p.getTimezone());
            m.put("active", p.getActive());
            return m;
        }).toList();
    }

    @PostMapping("/plants")
    public Map<String, Object> savePlant(@RequestBody Map<String, Object> body) {
        PlantMaster p = new PlantMaster();
        p.setCode((String) body.get("code"));
        p.setName((String) body.get("name"));
        p.setAddress((String) body.get("address"));
        p.setTimezone((String) body.getOrDefault("timezone", "Asia/Kolkata"));
        p.setActive(true);
        plantRepo.save(p);
        return Map.of("id", p.getId(), "code", p.getCode(), "name", p.getName());
    }

    // ── WORK CENTERS ──
    @GetMapping("/work-centers")
    public List<Map<String, Object>> listWorkCenters(@RequestParam(defaultValue = "1") Long plantId) {
        return wcRepo.findByPlantIdAndActiveTrue(plantId).stream().map(wc -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", wc.getId());
            m.put("code", wc.getCode());
            m.put("name", wc.getName());
            m.put("department", wc.getDepartment());
            m.put("capacity", wc.getCapacity());
            m.put("hourlyRate", wc.getHourlyRate());
            return m;
        }).toList();
    }

    @PostMapping("/work-centers")
    public Map<String, Object> saveWorkCenter(@RequestBody Map<String, Object> body) {
        PlantMaster plant = plantRepo.findById(((Number) body.getOrDefault("plantId", 1L)).longValue()).orElseThrow();
        WorkCenterMaster wc = WorkCenterMaster.builder()
                .plant(plant)
                .code((String) body.get("code"))
                .name((String) body.get("name"))
                .department((String) body.get("department"))
                .capacity(body.get("capacity") != null ? new java.math.BigDecimal(body.get("capacity").toString()) : null)
                .hourlyRate(body.get("hourlyRate") != null ? new java.math.BigDecimal(body.get("hourlyRate").toString()) : null)
                .active(true)
                .build();
        wcRepo.save(wc);
        return Map.of("id", wc.getId(), "code", wc.getCode(), "name", wc.getName());
    }

    // ── METERS ──
    @GetMapping("/meters")
    public List<Map<String, Object>> listMeters(@RequestParam(required = false) String type) {
        List<MeterMaster> list = type != null ? meterRepo.findByMeterTypeAndActiveTrue(type) : meterRepo.findAll();
        return list.stream().map(mt -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", mt.getId());
            m.put("code", mt.getCode());
            m.put("name", mt.getName());
            m.put("meterType", mt.getMeterType());
            m.put("location", mt.getLocation());
            m.put("budgetMonthlyUnits", mt.getBudgetMonthlyUnits());
            return m;
        }).toList();
    }

    @PostMapping("/meters")
    public Map<String, Object> saveMeter(@RequestBody Map<String, Object> body) {
        PlantMaster plant = plantRepo.findById(((Number) body.getOrDefault("plantId", 1L)).longValue()).orElseThrow();
        MeterMaster mt = MeterMaster.builder()
                .plant(plant)
                .code((String) body.get("code"))
                .name((String) body.get("name"))
                .meterType((String) body.get("meterType"))
                .location((String) body.get("location"))
                .active(true)
                .build();
        meterRepo.save(mt);
        return Map.of("id", mt.getId(), "code", mt.getCode());
    }

    // ── SPARE PARTS ──
    @GetMapping("/spare-parts")
    public List<Map<String, Object>> listSpareParts() {
        return spareRepo.findByActiveTrue().stream().map(sp -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", sp.getId());
            m.put("code", sp.getCode());
            m.put("name", sp.getName());
            m.put("uom", sp.getUom());
            m.put("reorderLevel", sp.getReorderLevel());
            m.put("unitCost", sp.getUnitCost());
            m.put("itemId", sp.getItemId());
            m.put("itemCode", sp.getItemCode());
            return m;
        }).toList();
    }

    @PostMapping("/spare-parts")
    public Map<String, Object> saveSparePart(@RequestBody Map<String, Object> body) {
        PlantMaster plant = plantRepo.findById(((Number) body.getOrDefault("plantId", 1L)).longValue()).orElseThrow();
        Long itemId = body.get("itemId") != null ? ((Number) body.get("itemId")).longValue() : null;
        String itemCode = (String) body.get("itemCode");
        String code = (String) body.get("code");
        String name = (String) body.get("name");
        in.zygertechnology.zygererp.entity.ItemMaster item = null;
        if (itemId != null) item = items.findById(itemId).orElse(null);
        else if (itemCode != null && !itemCode.isBlank()) item = items.findByCode(itemCode).orElse(null);
        if (item != null) {
            if (code == null || code.isBlank()) code = item.getCode();
            if (name == null || name.isBlank()) name = item.getName();
            itemCode = item.getCode();
        }
        SparePartMaster sp = SparePartMaster.builder()
                .plant(plant)
                .itemId(item != null ? item.getId() : null)
                .itemCode(item != null ? item.getCode() : itemCode)
                .code(code)
                .name(name)
                .description((String) body.get("description"))
                .uom(body.get("uom") != null ? (String) body.get("uom") : (item != null && item.getUom() != null ? item.getUom() : "NOS"))
                .unitCost(body.get("unitCost") != null ? new java.math.BigDecimal(body.get("unitCost").toString()) : java.math.BigDecimal.ZERO)
                .active(true)
                .build();
        spareRepo.save(sp);
        return Map.of("id", sp.getId(), "code", sp.getCode(), "itemId", sp.getItemId(), "itemCode", sp.getItemCode());
    }

    // ── SAMPLING PLANS ──
    @GetMapping("/sampling-plans")
    public List<Map<String, Object>> listSamplingPlans(@RequestParam(defaultValue = "ISO2859_1") String standard) {
        return samplingRepo.findByStandardAndActiveTrue(standard).stream().map(sp -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", sp.getId());
            m.put("standard", sp.getStandard());
            m.put("inspectionLevel", sp.getInspectionLevel());
            m.put("lotSizeMin", sp.getLotSizeMin());
            m.put("lotSizeMax", sp.getLotSizeMax());
            m.put("aql", sp.getAql());
            m.put("sampleSize", sp.getSampleSize());
            m.put("acceptNumber", sp.getAcceptNumber());
            m.put("rejectNumber", sp.getRejectNumber());
            return m;
        }).toList();
    }

    // ── INSPECTION PLANS ──
    @GetMapping("/inspection-plans")
    public List<Map<String, Object>> listInspectionPlans(@RequestParam(defaultValue = "1") Long plantId,
                                                          @RequestParam(required = false) String itemCode) {
        List<InspectionPlan> plans;
        if (itemCode != null && !itemCode.isBlank()) {
            plans = ipRepo.findByPlantIdAndItemCodeAndActiveTrue(plantId, itemCode);
        } else {
            plans = ipRepo.findAll();
        }
        return plans.stream().map(ip -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", ip.getId());
            m.put("itemCode", ip.getItemCode());
            m.put("drawingNumber", ip.getDrawingNumber());
            m.put("drawingRevision", ip.getDrawingRevision());
            m.put("operation", ip.getOperation());
            m.put("inspectionType", ip.getInspectionType());
            m.put("aql", ip.getAql());
            m.put("revisionNo", ip.getRevisionNo());
            m.put("planStatus", ip.getPlanStatus());
            List<InspectionPlanCharacteristic> chars = ipcRepo.findByPlanIdAndActiveTrueOrderByLineNoAsc(ip.getId());
            m.put("characteristics", chars.stream().map(c -> {
                Map<String, Object> cm = new LinkedHashMap<>();
                cm.put("id", c.getId());
                cm.put("balloonNo", c.getBalloonNo());
                cm.put("characteristicCode", c.getCharacteristicCode());
                cm.put("characteristicName", c.getCharacteristicName());
                cm.put("dataType", c.getDataType());
                cm.put("specificationText", c.getSpecificationText());
                cm.put("nominalValue", c.getNominalValue());
                cm.put("lowerLimit", c.getLowerLimit());
                cm.put("upperLimit", c.getUpperLimit());
                cm.put("uom", c.getUom());
                cm.put("isMandatory", c.getIsMandatory());
                cm.put("isCritical", c.getIsCritical());
                return cm;
            }).toList());
            return m;
        }).toList();
    }

    @PostMapping("/inspection-plans")
    public Map<String, Object> saveInspectionPlan(@RequestBody Map<String, Object> body) {
        PlantMaster plant = plantRepo.findById(((Number) body.getOrDefault("plantId", 1L)).longValue()).orElseThrow();
        String itemCode = (String) body.get("itemCode");
        String inspectionType = (String) body.get("inspectionType");

        // Retirement policy (VAL-PLAN-03): a new save is a new published revision.
        // Retire any active plan with the same natural key (item + inspection type) so the
        // unique business key stays unique, while the old revision remains read-only (RETIRED).
        List<InspectionPlan> existing = itemCode != null && inspectionType != null
                ? ipRepo.findByPlantIdAndItemCodeAndInspectionTypeOrderByRevisionNoDesc(
                        plant.getId(), itemCode, inspectionType)
                : List.of();
        int nextRevision = 1;
        for (InspectionPlan p : existing) {
            if (p.getRevisionNo() != null) nextRevision = Math.max(nextRevision, p.getRevisionNo() + 1);
            if (Boolean.TRUE.equals(p.getActive())) {
                p.setActive(false);
                p.setPlanStatus("RETIRED");
                ipRepo.save(p);
            }
        }

        InspectionPlan ip = InspectionPlan.builder()
                .plant(plant)
                .itemCode(itemCode)
                .drawingNumber((String) body.get("drawingNumber"))
                .drawingRevision((String) body.get("drawingRevision"))
                .operation((String) body.get("operation"))
                .inspectionType(inspectionType)
                .active(true)
                .planStatus("PUBLISHED")
                .revisionNo(nextRevision)
                .build();
        ipRepo.save(ip);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> chars = (List<Map<String, Object>>) body.get("characteristics");
        if (chars != null) {
            for (int i = 0; i < chars.size(); i++) {
                Map<String, Object> cb = chars.get(i);
                InspectionPlanCharacteristic c = InspectionPlanCharacteristic.builder()
                        .plan(ip)
                        .balloonNo((String) cb.get("balloonNo"))
                        .characteristicCode((String) cb.get("characteristicCode"))
                        .characteristicName((String) cb.get("characteristicName"))
                        .dataType((String) cb.getOrDefault("dataType", "NUMERIC"))
                        .specificationText((String) cb.get("specificationText"))
                        .nominalValue(cb.get("nominalValue") != null ? new java.math.BigDecimal(cb.get("nominalValue").toString()) : null)
                        .lowerLimit(cb.get("lowerLimit") != null ? new java.math.BigDecimal(cb.get("lowerLimit").toString()) : null)
                        .upperLimit(cb.get("upperLimit") != null ? new java.math.BigDecimal(cb.get("upperLimit").toString()) : null)
                        .tolerance(cb.get("tolerance") != null ? new java.math.BigDecimal(cb.get("tolerance").toString()) : null)
                        .uom((String) cb.get("uom"))
                        .isMandatory(Boolean.TRUE.equals(cb.get("isMandatory")))
                        .isCritical(Boolean.TRUE.equals(cb.get("isCritical")))
                        .isSpecial(Boolean.TRUE.equals(cb.get("isSpecial")))
                        .measurementMethod((String) cb.get("measurementMethod"))
                        .requiredInstrumentType((String) cb.get("requiredInstrumentType"))
                        .lineNo(i + 1)
                        .active(true)
                        .build();
                ipcRepo.save(c);
            }
        }
        return Map.of("id", ip.getId(), "itemCode", ip.getItemCode(),
                "revisionNo", ip.getRevisionNo(), "planStatus", ip.getPlanStatus());
    }

    // ── AQL AUTO-CALCULATE ──
    @GetMapping("/aql-lookup")
    public Map<String, Object> aqlLookup(@RequestParam int lotSize,
                                          @RequestParam(defaultValue = "ISO2859_1") String standard,
                                          @RequestParam(defaultValue = "1") double aql) {
        Optional<SamplingPlanMaster> plan = samplingRepo.findByStandardAndActiveTrue(standard).stream()
                .filter(sp -> sp.getLotSizeMin() <= lotSize && sp.getLotSizeMax() >= lotSize)
                .filter(sp -> sp.getAql().doubleValue() == aql)
                .findFirst();
        if (plan.isPresent()) {
            SamplingPlanMaster sp = plan.get();
            return Map.of(
                    "found", true,
                    "sampleSize", sp.getSampleSize(),
                    "acceptNumber", sp.getAcceptNumber(),
                    "rejectNumber", sp.getRejectNumber(),
                    "lotSizeMin", sp.getLotSizeMin(),
                    "lotSizeMax", sp.getLotSizeMax(),
                    "aql", sp.getAql(),
                    "standard", sp.getStandard()
            );
        }
        return Map.of("found", false, "message", "No sampling plan found for lot size " + lotSize + " and AQL " + aql);
    }

    // ── ESCALATION RULES ──
    @GetMapping("/escalation-rules")
    public List<Map<String, Object>> listEscalationRules(@RequestParam(required = false) String docKey) {
        List<EscalationRule> rules = docKey != null ? escRuleRepo.findByDocKeyAndActiveTrue(docKey) : escRuleRepo.findAll();
        return rules.stream().map(r -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.getId());
            m.put("docKey", r.getDocKey());
            m.put("priority", r.getPriority());
            m.put("slaHours", r.getSlaHours());
            m.put("escalateToRole", r.getEscalateToRole());
            m.put("notifyChannels", r.getNotifyChannels());
            m.put("active", r.getActive());
            return m;
        }).toList();
    }

    @PostMapping("/escalation-rules")
    public Map<String, Object> createEscalationRule(@RequestBody Map<String, Object> body) {
        EscalationRule rule = EscalationRule.builder()
                .docKey((String) body.get("docKey"))
                .priority((String) body.getOrDefault("priority", "HIGH"))
                .slaHours((Integer) body.getOrDefault("slaHours", 24))
                .escalateToRole((String) body.getOrDefault("escalateToRole", "QUALITY_MANAGER"))
                .notifyChannels((String) body.getOrDefault("notifyChannels", "IN_APP"))
                .active(true)
                .build();
        rule = escRuleRepo.save(rule);
        return Map.of("id", rule.getId(), "message", "Escalation rule created");
    }

    @PutMapping("/escalation-rules/{id}")
    public Map<String, Object> updateEscalationRule(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        EscalationRule rule = escRuleRepo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Escalation rule not found"));
        if (body.containsKey("docKey")) rule.setDocKey((String) body.get("docKey"));
        if (body.containsKey("priority")) rule.setPriority((String) body.get("priority"));
        if (body.containsKey("slaHours")) rule.setSlaHours((Integer) body.get("slaHours"));
        if (body.containsKey("escalateToRole")) rule.setEscalateToRole((String) body.get("escalateToRole"));
        if (body.containsKey("notifyChannels")) rule.setNotifyChannels((String) body.get("notifyChannels"));
        if (body.containsKey("active")) rule.setActive((Boolean) body.get("active"));
        escRuleRepo.save(rule);
        return Map.of("message", "Escalation rule updated");
    }

    @DeleteMapping("/escalation-rules/{id}")
    public Map<String, Object> deleteEscalationRule(@PathVariable Long id) {
        EscalationRule rule = escRuleRepo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Escalation rule not found"));
        rule.setActive(false);
        escRuleRepo.save(rule);
        return Map.of("message", "Escalation rule deactivated");
    }

    // ── IDLE REASONS ──
    private final IdleReasonMasterRepository idleReasonRepo;
    private final PendingReasonMasterRepository pendingReasonRepo;
    private final RejectReasonMasterRepository rejectReasonRepo;
    private final ApprovalStepRepository approvalStepRepo;
    private final in.zygertechnology.zygererp.service.WorkflowStateMachine stateMachine;

    @GetMapping("/idle-reasons")
    public List<IdleReasonMaster> listIdleReasons() { return idleReasonRepo.findByActiveTrue(); }

    @PostMapping("/idle-reasons")
    public Map<String, Object> createIdleReason(@RequestBody IdleReasonMaster r) {
        r.setId(null);
        idleReasonRepo.save(r);
        return Map.of("id", r.getId(), "message", "Idle reason created");
    }

    // ── PENDING REASONS ──
    @GetMapping("/pending-reasons")
    public List<PendingReasonMaster> listPendingReasons() { return pendingReasonRepo.findByActiveTrue(); }

    @PostMapping("/pending-reasons")
    public Map<String, Object> createPendingReason(@RequestBody PendingReasonMaster r) {
        r.setId(null);
        pendingReasonRepo.save(r);
        return Map.of("id", r.getId(), "message", "Pending reason created");
    }

    // ── REJECT REASONS ──
    @GetMapping("/reject-reasons")
    public List<RejectReasonMaster> listRejectReasons() { return rejectReasonRepo.findByActiveTrue(); }

    @PostMapping("/reject-reasons")
    public Map<String, Object> createRejectReason(@RequestBody RejectReasonMaster r) {
        r.setId(null);
        rejectReasonRepo.save(r);
        return Map.of("id", r.getId(), "message", "Reject reason created");
    }

    // ── APPROVAL STEPS ──
    @GetMapping("/approval-steps")
    public List<ApprovalStep> listApprovalSteps(@RequestParam String docType, @RequestParam Long docId) {
        return approvalStepRepo.findByDocTypeAndDocIdOrderByStepNo(docType, docId);
    }

    @PostMapping("/approval-steps")
    public Map<String, Object> createApprovalStep(@RequestBody ApprovalStep step) {
        step.setId(null);
        approvalStepRepo.save(step);
        return Map.of("id", step.getId(), "message", "Approval step created");
    }

    @PutMapping("/approval-steps/{id}/action")
    public Map<String, Object> approveStep(@PathVariable Long id, @RequestBody Map<String, String> body, java.security.Principal p) {
        ApprovalStep step = approvalStepRepo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Approval step not found"));
        String action = body.getOrDefault("action", "APPROVE").toUpperCase();
        String comments = body.getOrDefault("comments", "");
        step.setStatus(action.equals("APPROVE") ? "APPROVED" : "REJECTED");
        step.setDecidedAt(java.time.Instant.now());
        step.setComments(comments);
        step.setApproverUserId(getUserId(p));
        approvalStepRepo.save(step);
        return Map.of("message", "Step " + step.getStatus());
    }

    // ── STATE MACHINE ──
    @GetMapping("/workflow/allowed-actions")
    public Map<String, Object> getAllowedActions(@RequestParam String docType, @RequestParam String status) {
        Set<String> actions = stateMachine.getAllowedActions(docType, status);
        return Map.of("docType", docType, "status", status, "allowedActions", actions);
    }

    private Long getUserId(java.security.Principal p) {
        if (p == null) return null;
        try {
            return ((Number) em.createQuery("SELECT u.id FROM AppUser u WHERE u.username = :u")
                    .setParameter("u", p.getName()).getSingleResult()).longValue();
        } catch (Exception e) { return null; }
    }

    private final jakarta.persistence.EntityManager em;
}
