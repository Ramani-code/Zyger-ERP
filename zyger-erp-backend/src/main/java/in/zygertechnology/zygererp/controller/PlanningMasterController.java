package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.*;
import in.zygertechnology.zygererp.service.DocNumberService;
import in.zygertechnology.zygererp.security.RequirePermission;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.security.Principal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequirePermission(module = "PLANNING", screen = "*", action = "VIEW")
@RequiredArgsConstructor
public class PlanningMasterController {

    private final MaterialPlanRepository materialPlans;
    private final MaterialPlanLineRepository materialPlanLines;
    private final DispatchPlanRepository dispatchPlans;
    private final DispatchPlanLineRepository dispatchPlanLines;
    private final MachineLoadPlanRepository machineLoadPlans;
    private final MachineLoadLineRepository machineLoadLines;
    private final EngineeringChangeRepository engineeringChanges;
    private final GapAnalysisRunRepository gapAnalysisRuns;
    private final GapAnalysisResultRepository gapAnalysisResults;
    private final CostEstimationRepository costEstimations;
    private final CostEstimationLineRepository costEstimationLines;
    private final WorkOrderRepository workOrders;
    private final ProductionBOMRepository productionBoms;
    private final RouteSheetRepository routeSheets;
    private final ItemRepository items;
    private final WorkCenterRepository workCenters;
    private final MachineMasterRepository machines;
    private final DocNumberService numbers;
    private final StockBalanceRepository stockBalances;
    private final jakarta.persistence.EntityManager em;
    private final in.zygertechnology.zygererp.repository.ApprovalStepRepository approvalSteps;
    private final in.zygertechnology.zygererp.repository.EscalationRuleRepository escalationRules;
    private final in.zygertechnology.zygererp.service.NotificationService notificationService;
    private final MaterialReservationRepository materialReservations;
    private final FgPossibleRepository fgPossibles;
    private final CostComponentTypeRepository costComponentTypes;
    private final RouteOperationInspectionRepository routeOpInspections;

    private String principalName(Principal p) { return p != null ? p.getName() : "system"; }

    // ===========================
    // ---- Material Planning ----
    // ===========================

    @GetMapping("/api/v1/planning/material-plans")
    public List<MaterialPlan> listMaterialPlans() { return materialPlans.findAll(); }

    @PostMapping("/api/v1/planning/material-plans")
    @RequirePermission(module = "PLANNING", screen = "*", action = "CREATE")
    public MaterialPlan createMaterialPlan(@RequestBody MaterialPlan p, Principal principal) {
        p.setId(null);
        p.setPlanNumber(numbers.next("material-plan", "MP"));
        if (p.getPlanDate() == null) p.setPlanDate(Instant.now());
        if (p.getStatus() == null) p.setStatus("DRAFT");
        p.setCreatedBy(principalName(principal));
        p.setCreatedAt(Instant.now());
        return materialPlans.save(p);
    }

    @GetMapping("/api/v1/planning/material-plans/{id}")
    public MaterialPlan getMaterialPlan(@PathVariable Long id) {
        return materialPlans.findById(id).orElseThrow(() -> new RuntimeException("Material Plan not found"));
    }

    @PutMapping("/api/v1/planning/material-plans/{id}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "EDIT")
    public MaterialPlan updateMaterialPlan(@PathVariable Long id, @RequestBody MaterialPlan p, Principal principal) {
        MaterialPlan e = materialPlans.findById(id).orElseThrow(() -> new RuntimeException("Material Plan not found"));
        p.setId(id);
        p.setPlanNumber(e.getPlanNumber());
        p.setCreatedAt(e.getCreatedAt());
        p.setCreatedBy(e.getCreatedBy());
        p.setUpdatedAt(Instant.now());
        p.setUpdatedBy(principalName(principal));
        return materialPlans.save(p);
    }

    @DeleteMapping("/api/v1/planning/material-plans/{id}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "DELETE")
    public void deleteMaterialPlan(@PathVariable Long id) {
        MaterialPlan e = materialPlans.findById(id).orElseThrow(() -> new RuntimeException("Material Plan not found"));
        if (!"DRAFT".equals(e.getStatus())) throw new RuntimeException("Only DRAFT plans can be deleted");
        materialPlanLines.findByPlanId(id).forEach(l -> materialPlanLines.deleteById(l.getId()));
        materialPlans.deleteById(id);
    }

    @GetMapping("/api/v1/planning/material-plans/{id}/lines")
    public List<MaterialPlanLine> getMaterialPlanLines(@PathVariable Long id) {
        return materialPlanLines.findByPlanId(id);
    }

    @PostMapping("/api/v1/planning/material-plans/{id}/lines")
    @RequirePermission(module = "PLANNING", screen = "*", action = "CREATE")
    public MaterialPlanLine addMaterialPlanLine(@PathVariable Long id, @RequestBody MaterialPlanLine line, Principal principal) {
        MaterialPlan plan = materialPlans.findById(id).orElseThrow(() -> new RuntimeException("Material Plan not found"));
        line.setId(null);
        line.setPlan(plan);
        if (line.getGrossRequirement() == null) line.setGrossRequirement(BigDecimal.ZERO);
        if (line.getOnHandStock() == null) line.setOnHandStock(BigDecimal.ZERO);
        if (line.getOnOrderQty() == null) line.setOnOrderQty(BigDecimal.ZERO);
        if (line.getWipQty() == null) line.setWipQty(BigDecimal.ZERO);
        if (line.getSafetyStock() == null) line.setSafetyStock(BigDecimal.ZERO);
        if (line.getNetRequirement() == null) {
            line.setNetRequirement(
                line.getGrossRequirement()
                    .subtract(line.getOnHandStock())
                    .subtract(line.getOnOrderQty())
                    .subtract(line.getWipQty())
                    .add(line.getSafetyStock())
            );
        }
        if (line.getRecommendedOrderQty() == null) line.setRecommendedOrderQty(line.getNetRequirement().max(BigDecimal.ZERO));
        line.setCreatedAt(Instant.now());
        return materialPlanLines.save(line);
    }

    @PutMapping("/api/v1/planning/material-plans/lines/{lineId}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "EDIT")
    public MaterialPlanLine updateMaterialPlanLine(@PathVariable Long lineId, @RequestBody MaterialPlanLine line, Principal principal) {
        MaterialPlanLine e = materialPlanLines.findById(lineId).orElseThrow(() -> new RuntimeException("Material Plan Line not found"));
        line.setId(lineId);
        line.setPlan(e.getPlan());
        line.setCreatedAt(e.getCreatedAt());
        line.setUpdatedAt(Instant.now());
        return materialPlanLines.save(line);
    }

    @DeleteMapping("/api/v1/planning/material-plans/lines/{lineId}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "DELETE")
    public void deleteMaterialPlanLine(@PathVariable Long lineId) { materialPlanLines.deleteById(lineId); }

    // ---- MRP Run ----
    @PostMapping("/api/v1/planning/material-plans/{id}/run")
    @RequirePermission(module = "PLANNING", screen = "*", action = "APPROVE")
    public MaterialPlan runMRP(@PathVariable Long id) {
        MaterialPlan plan = materialPlans.findById(id).orElseThrow(() -> new RuntimeException("Material Plan not found"));
        materialPlanLines.findByPlanId(id).forEach(l -> materialPlanLines.deleteById(l.getId()));

        List<WorkOrder> activeWOs = new ArrayList<>(workOrders.findByStatus("RELEASED"));
        activeWOs.addAll(workOrders.findByStatus("IN_PROCESS"));

        Set<String> visitedItems = new HashSet<>();
        Map<String, BigDecimal> grossByItem = new LinkedHashMap<>();
        Map<String, Integer> maxLevelByItem = new LinkedHashMap<>();
        Map<String, String> sourceWoByItem = new LinkedHashMap<>();

        for (WorkOrder wo : activeWOs) {
            if (wo.getBomId() == null) continue;
            ProductionBOM bom = productionBoms.findById(wo.getBomId()).orElse(null);
            if (bom == null) continue;
            BigDecimal woQty = wo.getOrderQuantity() == null ? BigDecimal.ONE : wo.getOrderQuantity();
            explodeBom(bom, woQty, 0, grossByItem, maxLevelByItem, sourceWoByItem, wo.getWoNumber(), visitedItems, 5);
        }

        for (Map.Entry<String, BigDecimal> entry : grossByItem.entrySet()) {
            String itemCode = entry.getKey();
            BigDecimal gross = entry.getValue();
            Optional<ItemMaster> itemOpt = items.findByCode(itemCode);
            BigDecimal safetyStock = itemOpt.map(ItemMaster::getSafetyStock).orElse(BigDecimal.ZERO);
            if (safetyStock == null) safetyStock = BigDecimal.ZERO;

            BigDecimal onHand = stockBalances.sumAvailableByItem(itemCode, null);
            if (onHand == null) onHand = BigDecimal.ZERO;

            BigDecimal onOrder = activeWOs.stream()
                .filter(wo -> wo.getItemCode() != null && wo.getItemCode().equals(itemCode))
                .map(wo -> wo.getOrderQuantity() == null ? BigDecimal.ZERO : wo.getOrderQuantity())
                .reduce(BigDecimal.ZERO, BigDecimal::add);

            // Planning Module audit: this used to re-read grossByItem for the same itemCode,
            // which — since grossByItem is keyed uniquely per item via merge() — just returned
            // gross itself. That made wip == gross, which cancelled gross out of the net
            // formula entirely (net = gross - (onHand+onOrder+gross) + safetyStock reduces to
            // safetyStock - onHand - onOrder, completely independent of actual demand). There
            // is no real work-in-process quantity tracked anywhere this run has access to, so
            // rather than fabricate one, wip is zeroed until a genuine WIP source exists —
            // this at least restores gross demand actually driving the net requirement.
            BigDecimal wip = BigDecimal.ZERO;

            BigDecimal available = onHand.add(onOrder).add(wip);
            BigDecimal net = gross.subtract(available).add(safetyStock).max(BigDecimal.ZERO);

            MaterialPlanLine line = new MaterialPlanLine();
            line.setPlan(plan);
            line.setItemCode(itemCode);
            itemOpt.ifPresent(item -> {
                line.setItemDescription(item.getDescription());
                line.setUom(item.getUom());
                line.setLeadTimeDays(item.getLeadTimeDays());
            });
            line.setBomLevel(maxLevelByItem.getOrDefault(itemCode, 0));
            line.setGrossRequirement(gross);
            line.setOnHandStock(onHand);
            line.setOnOrderQty(onOrder);
            line.setWipQty(wip);
            line.setSafetyStock(safetyStock);
            line.setNetRequirement(net);
            line.setRecommendedOrderQty(net.max(BigDecimal.ZERO));
            line.setSourceWoNumber(sourceWoByItem.getOrDefault(itemCode, ""));
            line.setOrderType(hasActiveWoForItem(itemCode, activeWOs) ? "PRODUCTION" : "PURCHASE");
            line.setActionStatus("PENDING");
            materialPlanLines.save(line);
        }

        plan.setStatus("COMPLETE");
        plan.setUpdatedAt(Instant.now());
        return materialPlans.save(plan);
    }

    private void explodeBom(ProductionBOM bom, BigDecimal parentQty, int level,
                           Map<String, BigDecimal> grossByItem, Map<String, Integer> maxLevelByItem,
                           Map<String, String> sourceWoByItem, String woNumber,
                           Set<String> visitedItems, int maxDepth) {
        if (level > maxDepth) return;
        for (ProductionBOMLine bomLine : bom.getLines()) {
            BigDecimal qtyPer = bomLine.getQuantityPer() == null ? BigDecimal.ONE : bomLine.getQuantityPer();
            BigDecimal scrapPct = bomLine.getScrapPercentage() == null ? BigDecimal.ZERO : bomLine.getScrapPercentage();
            BigDecimal effectiveQtyPer = qtyPer.multiply(BigDecimal.ONE.add(scrapPct.divide(BigDecimal.valueOf(100), 6, RoundingMode.HALF_UP)));
            BigDecimal gross = parentQty.multiply(effectiveQtyPer);

            String compCode = bomLine.getComponentItemCode();
            grossByItem.merge(compCode, gross, BigDecimal::add);
            maxLevelByItem.merge(compCode, level, Math::max);
            sourceWoByItem.putIfAbsent(compCode, woNumber);

            if (bomLine.getChildBomId() != null && !visitedItems.contains(compCode)) {
                visitedItems.add(compCode);
                ProductionBOM childBom = productionBoms.findById(bomLine.getChildBomId()).orElse(null);
                if (childBom != null) {
                    explodeBom(childBom, gross, level + 1, grossByItem, maxLevelByItem,
                              sourceWoByItem, woNumber, visitedItems, maxDepth);
                }
            }
        }
    }

    private boolean hasActiveWoForItem(String itemCode, List<WorkOrder> activeWOs) {
        return activeWOs.stream().anyMatch(wo -> itemCode.equals(wo.getItemCode()));
    }

    // ===========================
    // ---- FG Possible ----------
    // ===========================

    @PostMapping("/api/v1/planning/fg-possible/check")
    @RequirePermission(module = "PLANNING", screen = "*", action = "APPROVE")
    public Map<String, Object> checkFgPossible(@RequestBody Map<String, Object> body) {
        String itemCode = (String) body.get("itemCode");
        if (itemCode == null || itemCode.isBlank()) throw new RuntimeException("itemCode is required");

        BigDecimal targetQty = body.containsKey("quantity") && body.get("quantity") != null
            ? new BigDecimal(body.get("quantity").toString()) : null;

        List<ProductionBOM> boms = productionBoms.findByItemCode(itemCode);
        ProductionBOM bom = boms.stream()
            .filter(b -> !"REJECTED".equals(b.getStatus()) && !"OBSOLETE".equals(b.getStatus()))
            .findFirst()
            .orElse(null);

        if (bom == null) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("maxProducibleQty", BigDecimal.ZERO);
            r.put("limitingComponent", "No BOM found");
            r.put("isFeasible", false);
            r.put("breakdown", List.of());
            return r;
        }

        List<Map<String, Object>> breakdown = new ArrayList<>();
        BigDecimal maxProducible = targetQty != null ? targetQty : null;
        String limitingComponent = "None";

        for (ProductionBOMLine line : bom.getLines()) {
            String compCode = line.getComponentItemCode();
            BigDecimal qtyPer = line.getQuantityPer() == null ? BigDecimal.ONE : line.getQuantityPer();

            BigDecimal scrapPct = line.getScrapPercentage() == null ? BigDecimal.ZERO : line.getScrapPercentage();
            BigDecimal effectiveQtyPer = qtyPer.multiply(BigDecimal.ONE.add(scrapPct.divide(BigDecimal.valueOf(100), 6, RoundingMode.HALF_UP)));

            BigDecimal available = stockBalances.sumAvailableByItem(compCode, null);
            if (available == null) available = BigDecimal.ZERO;

            BigDecimal requiredForTarget = targetQty != null ? effectiveQtyPer.multiply(targetQty) : effectiveQtyPer;

            String status = available.compareTo(requiredForTarget) >= 0 ? "OK" : "SHORT";
            if ("SHORT".equals(status)) {
                if (targetQty == null) {
                    BigDecimal canProduce = effectiveQtyPer.compareTo(BigDecimal.ZERO) > 0
                        ? available.divide(effectiveQtyPer, 0, RoundingMode.FLOOR) : BigDecimal.ZERO;
                    if (maxProducible == null || canProduce.compareTo(maxProducible) < 0) {
                        maxProducible = canProduce;
                        limitingComponent = compCode;
                    }
                } else {
                    maxProducible = BigDecimal.ZERO;
                    limitingComponent = compCode;
                }
            }

            Optional<ItemMaster> compItem = items.findByCode(compCode);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("componentCode", compCode);
            row.put("componentDescription", compItem.map(ItemMaster::getDescription).orElse(""));
            row.put("uom", compItem.map(ItemMaster::getUom).orElse(line.getUom() != null ? line.getUom() : ""));
            row.put("requiredQty", requiredForTarget);
            row.put("availableQty", available);
            row.put("status", status);
            breakdown.add(row);
        }

        if (maxProducible == null) maxProducible = BigDecimal.ZERO;
        boolean feasible = maxProducible.compareTo(BigDecimal.ZERO) > 0
            && (targetQty == null || maxProducible.compareTo(targetQty) >= 0);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("maxProducibleQty", maxProducible);
        result.put("limitingComponent", limitingComponent);
        result.put("isFeasible", feasible);
        result.put("breakdown", breakdown);
        return result;
    }

    // ===========================
    // ---- Dispatch Plan --------
    // ===========================

    @GetMapping("/api/v1/planning/dispatch-plans")
    public List<DispatchPlan> listDispatchPlans() { return dispatchPlans.findAll(); }

    @PostMapping("/api/v1/planning/dispatch-plans")
    @RequirePermission(module = "PLANNING", screen = "*", action = "CREATE")
    public DispatchPlan createDispatchPlan(@RequestBody DispatchPlan p, Principal principal) {
        p.setId(null);
        p.setDispatchNumber(numbers.next("dispatch-plan", "DP"));
        if (p.getDispatchDate() == null) p.setDispatchDate(Instant.now());
        if (p.getStatus() == null) p.setStatus("DRAFT");
        p.setCreatedBy(principalName(principal));
        p.setCreatedAt(Instant.now());
        return dispatchPlans.save(p);
    }

    @GetMapping("/api/v1/planning/dispatch-plans/{id}")
    public DispatchPlan getDispatchPlan(@PathVariable Long id) {
        return dispatchPlans.findById(id).orElseThrow(() -> new RuntimeException("Dispatch Plan not found"));
    }

    @PutMapping("/api/v1/planning/dispatch-plans/{id}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "EDIT")
    public DispatchPlan updateDispatchPlan(@PathVariable Long id, @RequestBody DispatchPlan p, Principal principal) {
        DispatchPlan e = dispatchPlans.findById(id).orElseThrow(() -> new RuntimeException("Dispatch Plan not found"));
        p.setId(id);
        p.setDispatchNumber(e.getDispatchNumber());
        p.setCreatedAt(e.getCreatedAt());
        p.setCreatedBy(e.getCreatedBy());
        p.setUpdatedAt(Instant.now());
        p.setUpdatedBy(principalName(principal));
        return dispatchPlans.save(p);
    }

    @DeleteMapping("/api/v1/planning/dispatch-plans/{id}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "DELETE")
    public void deleteDispatchPlan(@PathVariable Long id) {
        dispatchPlanLines.findByDispatchPlanId(id).forEach(l -> dispatchPlanLines.deleteById(l.getId()));
        dispatchPlans.deleteById(id);
    }

    @GetMapping("/api/v1/planning/dispatch-plans/{id}/lines")
    public List<DispatchPlanLine> getDispatchPlanLines(@PathVariable Long id) {
        return dispatchPlanLines.findByDispatchPlanId(id);
    }

    @PostMapping("/api/v1/planning/dispatch-plans/{id}/lines")
    @RequirePermission(module = "PLANNING", screen = "*", action = "CREATE")
    public DispatchPlanLine addDispatchPlanLine(@PathVariable Long id, @RequestBody DispatchPlanLine line, Principal principal) {
        DispatchPlan plan = dispatchPlans.findById(id).orElseThrow(() -> new RuntimeException("Dispatch Plan not found"));
        line.setId(null);
        line.setDispatchPlan(plan);
        line.setCreatedAt(Instant.now());
        return dispatchPlanLines.save(line);
    }

    @PutMapping("/api/v1/planning/dispatch-plans/lines/{lineId}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "EDIT")
    public DispatchPlanLine updateDispatchPlanLine(@PathVariable Long lineId, @RequestBody DispatchPlanLine line, Principal principal) {
        DispatchPlanLine e = dispatchPlanLines.findById(lineId).orElseThrow(() -> new RuntimeException("Dispatch Plan Line not found"));
        line.setId(lineId);
        line.setDispatchPlan(e.getDispatchPlan());
        line.setCreatedAt(e.getCreatedAt());
        line.setUpdatedAt(Instant.now());
        return dispatchPlanLines.save(line);
    }

    @DeleteMapping("/api/v1/planning/dispatch-plans/lines/{lineId}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "DELETE")
    public void deleteDispatchPlanLine(@PathVariable Long lineId) { dispatchPlanLines.deleteById(lineId); }

    // ===========================
    // ---- Machine Load Plan ----
    // ===========================

    @GetMapping("/api/v1/planning/machine-load-plans")
    public List<MachineLoadPlan> listMachineLoadPlans() { return machineLoadPlans.findAll(); }

    @PostMapping("/api/v1/planning/machine-load-plans")
    @RequirePermission(module = "PLANNING", screen = "*", action = "CREATE")
    public MachineLoadPlan createMachineLoadPlan(@RequestBody MachineLoadPlan p, Principal principal) {
        p.setId(null);
        p.setPlanNumber(numbers.next("machine-load-plan", "MLP"));
        if (p.getStatus() == null) p.setStatus("DRAFT");
        p.setCreatedBy(principalName(principal));
        p.setCreatedAt(Instant.now());
        return machineLoadPlans.save(p);
    }

    @GetMapping("/api/v1/planning/machine-load-plans/{id}")
    public MachineLoadPlan getMachineLoadPlan(@PathVariable Long id) {
        return machineLoadPlans.findById(id).orElseThrow(() -> new RuntimeException("Machine Load Plan not found"));
    }

    @PutMapping("/api/v1/planning/machine-load-plans/{id}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "EDIT")
    public MachineLoadPlan updateMachineLoadPlan(@PathVariable Long id, @RequestBody MachineLoadPlan p, Principal principal) {
        MachineLoadPlan e = machineLoadPlans.findById(id).orElseThrow(() -> new RuntimeException("Machine Load Plan not found"));
        p.setId(id);
        p.setPlanNumber(e.getPlanNumber());
        p.setCreatedAt(e.getCreatedAt());
        p.setCreatedBy(e.getCreatedBy());
        p.setUpdatedAt(Instant.now());
        p.setUpdatedBy(principalName(principal));
        return machineLoadPlans.save(p);
    }

    @DeleteMapping("/api/v1/planning/machine-load-plans/{id}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "DELETE")
    public void deleteMachineLoadPlan(@PathVariable Long id) {
        machineLoadLines.findByLoadPlanId(id).forEach(l -> machineLoadLines.deleteById(l.getId()));
        machineLoadPlans.deleteById(id);
    }

    @GetMapping("/api/v1/planning/machine-load-plans/{id}/lines")
    public List<MachineLoadLine> getMachineLoadPlanLines(@PathVariable Long id) {
        return machineLoadLines.findByLoadPlanId(id);
    }

    @PostMapping("/api/v1/planning/machine-load-plans/{id}/lines")
    @RequirePermission(module = "PLANNING", screen = "*", action = "CREATE")
    public MachineLoadLine addMachineLoadLine(@PathVariable Long id, @RequestBody MachineLoadLine line, Principal principal) {
        MachineLoadPlan plan = machineLoadPlans.findById(id).orElseThrow(() -> new RuntimeException("Machine Load Plan not found"));
        line.setId(null);
        line.setLoadPlan(plan);
        line.setCreatedAt(Instant.now());
        return machineLoadLines.save(line);
    }

    @DeleteMapping("/api/v1/planning/machine-load-plans/lines/{lineId}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "DELETE")
    public void deleteMachineLoadLine(@PathVariable Long lineId) { machineLoadLines.deleteById(lineId); }

    // ---- Generate load from active WOs ----
    @PostMapping("/api/v1/planning/machine-load-plans/{id}/generate")
    @RequirePermission(module = "PLANNING", screen = "*", action = "APPROVE")
    public MachineLoadPlan generateMachineLoad(@PathVariable Long id, Principal principal) {
        MachineLoadPlan plan = machineLoadPlans.findById(id).orElseThrow(() -> new RuntimeException("Machine Load Plan not found"));
        machineLoadLines.findByLoadPlanId(id).forEach(l -> machineLoadLines.deleteById(l.getId()));

        List<WorkOrder> activeWOs = new ArrayList<>(workOrders.findByStatus("RELEASED"));
        activeWOs.addAll(workOrders.findByStatus("IN_PROCESS"));

        Map<String, BigDecimal> loadByMachine = new LinkedHashMap<>();
        Map<String, BigDecimal> availableByMachine = new LinkedHashMap<>();

        for (WorkOrder wo : activeWOs) {
            for (WorkOrderOperation op : wo.getOperations()) {
                if (op.getMachineCode() == null) continue;
                BigDecimal setup = op.getSetupTimePlanned() == null ? BigDecimal.ZERO : op.getSetupTimePlanned();
                BigDecimal cycle = op.getCycleTimePlanned() == null ? BigDecimal.ZERO : op.getCycleTimePlanned();
                BigDecimal qty = op.getPlannedQuantity() == null ? BigDecimal.ONE : op.getPlannedQuantity();
                BigDecimal totalLoad = setup.add(cycle.multiply(qty)).divide(BigDecimal.valueOf(60), 4, RoundingMode.HALF_UP);
                loadByMachine.merge(op.getMachineCode(), totalLoad, BigDecimal::add);

                machines.findByCode(op.getMachineCode()).ifPresent(m -> {
                    if (m.getWorkCenterCode() != null) {
                        workCenters.findByCode(m.getWorkCenterCode()).ifPresent(wc -> {
                            BigDecimal cap = wc.getCapacityPerDay() == null ? BigDecimal.valueOf(8) : wc.getCapacityPerDay();
                            availableByMachine.merge(op.getMachineCode(), cap, BigDecimal::add);
                        });
                    }
                });
            }
        }

        int seq = 1;
        for (Map.Entry<String, BigDecimal> entry : loadByMachine.entrySet()) {
            String machineCode = entry.getKey();
            BigDecimal plannedLoad = entry.getValue();
            BigDecimal available = availableByMachine.getOrDefault(machineCode, BigDecimal.valueOf(8));

            // FRS §7.2: Check machine status — BREAKDOWN/UNDER_MAINTENANCE machines get 0 available hours
            boolean isBlocked = machines.findByCode(machineCode)
                    .map(m -> "BREAKDOWN".equals(m.getStatus()) || "UNDER_MAINTENANCE".equals(m.getStatus()))
                    .orElse(false);
            if (isBlocked) {
                available = BigDecimal.ZERO;
            }

            BigDecimal utilPct = available.compareTo(BigDecimal.ZERO) > 0
                ? plannedLoad.multiply(BigDecimal.valueOf(100)).divide(available, 2, RoundingMode.HALF_UP)
                : BigDecimal.ZERO;
            boolean overloaded = utilPct.compareTo(BigDecimal.valueOf(100)) > 0;

            MachineLoadLine line = new MachineLoadLine();
            line.setLoadPlan(plan);
            line.setMachineCode(machineCode);
            line.setAvailableHours(available);
            line.setPlannedLoadHours(plannedLoad);
            line.setUtilizationPercent(utilPct);
            line.setIsOverloaded(overloaded);
            line.setOverloadHours(overloaded ? plannedLoad.subtract(available) : BigDecimal.ZERO);
            line.setSequenceOnMachine(seq++);
            line.setCreatedAt(Instant.now());
            machineLoadLines.save(line);
        }

        plan.setStatus("COMPLETE");
        plan.setGeneratedDate(Instant.now());
        plan.setGeneratedBy(principalName(principal));
        plan.setUpdatedAt(Instant.now());
        return machineLoadPlans.save(plan);
    }

    // ===========================
    // ---- ECR/ECO --------------
    // ===========================

    @GetMapping("/api/v1/planning/engineering-changes")
    public List<EngineeringChange> listEngineeringChanges() { return engineeringChanges.findAll(); }

    @PostMapping("/api/v1/planning/engineering-changes")
    @RequirePermission(module = "PLANNING", screen = "*", action = "CREATE")
    public EngineeringChange createEngineeringChange(@RequestBody EngineeringChange ec, Principal principal) {
        ec.setId(null);
        ec.setEcrNumber(numbers.next("engineering-change", "ECR"));
        if (ec.getStatus() == null) ec.setStatus("DRAFT");
        ec.setCreatedBy(principalName(principal));
        ec.setCreatedAt(Instant.now());
        return engineeringChanges.save(ec);
    }

    @GetMapping("/api/v1/planning/engineering-changes/{id}")
    public EngineeringChange getEngineeringChange(@PathVariable Long id) {
        return engineeringChanges.findById(id).orElseThrow(() -> new RuntimeException("Engineering Change not found"));
    }

    @PutMapping("/api/v1/planning/engineering-changes/{id}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "EDIT")
    public EngineeringChange updateEngineeringChange(@PathVariable Long id, @RequestBody EngineeringChange ec, Principal principal) {
        EngineeringChange e = engineeringChanges.findById(id).orElseThrow(() -> new RuntimeException("Engineering Change not found"));
        ec.setId(id);
        ec.setEcrNumber(e.getEcrNumber());
        ec.setCreatedAt(e.getCreatedAt());
        ec.setCreatedBy(e.getCreatedBy());
        ec.setUpdatedAt(Instant.now());
        ec.setUpdatedBy(principalName(principal));
        return engineeringChanges.save(ec);
    }

    @DeleteMapping("/api/v1/planning/engineering-changes/{id}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "DELETE")
    public void deleteEngineeringChange(@PathVariable Long id) { engineeringChanges.deleteById(id); }

    @PostMapping("/api/v1/planning/engineering-changes/{id}/actions/{action}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "APPROVE")
    public EngineeringChange engineeringChangeAction(@PathVariable Long id, @PathVariable String action,
                                                    @RequestBody(required = false) Map<String, String> body,
                                                    Principal principal) {
        EngineeringChange ec = engineeringChanges.findById(id).orElseThrow(() -> new RuntimeException("Engineering Change not found"));
        String note = body != null ? body.getOrDefault("note", "") : "";
        switch (action.toLowerCase()) {
            case "submit-ecr":
                ec.setEcrStatus("SUBMITTED");
                ec.setStatus("SUBMITTED");
                createApprovalSteps("ENGINEERING_CHANGE", ec.getId(), List.of("PLANNING_MANAGER", "PLANT_HEAD"), principal);
                break;
            case "approve-ecr":
                ec.setEcrStatus("APPROVED");
                ec.setStatus("APPROVED");
                ec.setApprovedBy(principalName(principal));
                advanceApprovalStep("ENGINEERING_CHANGE", ec.getId(), principalName(principal));
                break;
            case "reject-ecr":
                ec.setEcrStatus("REJECTED");
                ec.setStatus("REJECTED");
                break;
            case "approve":
                ec.setEcrStatus("APPROVED");
                ec.setStatus("APPROVED");
                ec.setApprovedBy(principalName(principal));
                break;
            case "reject":
                ec.setEcrStatus("REJECTED");
                ec.setStatus("REJECTED");
                break;
            case "implement": {
                if (!"APPROVED".equals(ec.getEcrStatus())) {
                    throw new IllegalStateException("ECR must be APPROVED before ECO can be implemented. Current ECR status: " + ec.getEcrStatus());
                }
                ec.setEcoStatus("IMPLEMENTED");
                ec.setStatus("IMPLEMENTED");
                ec.setEffectiveDate(Instant.now());
                break;
            }
            case "close":
                ec.setEcoStatus("CLOSED");
                ec.setStatus("CLOSED");
                break;
            default:
                throw new RuntimeException("Unknown action: " + action);
        }
        ec.setUpdatedAt(Instant.now());
        ec.setUpdatedBy(principalName(principal));
        return engineeringChanges.save(ec);
    }

    // ===========================
    // ---- Gap Analysis ---------
    // ===========================

    @GetMapping("/api/v1/planning/gap-analysis")
    public List<GapAnalysisRun> listGapAnalysisRuns() { return gapAnalysisRuns.findAll(); }

    @PostMapping("/api/v1/planning/gap-analysis")
    @RequirePermission(module = "PLANNING", screen = "*", action = "CREATE")
    public GapAnalysisRun createGapAnalysisRun(@RequestBody GapAnalysisRun run, Principal principal) {
        run.setId(null);
        run.setRunNumber(numbers.next("gap-analysis", "GA"));
        if (run.getAnalysisDate() == null) run.setAnalysisDate(Instant.now());
        if (run.getStatus() == null) run.setStatus("DRAFT");
        run.setCreatedBy(principalName(principal));
        run.setCreatedAt(Instant.now());
        return gapAnalysisRuns.save(run);
    }

    @GetMapping("/api/v1/planning/gap-analysis/{id}")
    public Map<String, Object> getGapAnalysisRun(@PathVariable Long id) {
        GapAnalysisRun run = gapAnalysisRuns.findById(id).orElseThrow(() -> new RuntimeException("Gap Analysis Run not found"));
        List<GapAnalysisResult> results = gapAnalysisResults.findByRunId(id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("run", run);
        out.put("results", results);
        return out;
    }

    @GetMapping("/api/v1/planning/gap-analysis/{id}/results")
    public List<GapAnalysisResult> getGapAnalysisResults(@PathVariable Long id) {
        return gapAnalysisResults.findByRunId(id);
    }

    // ---- Run Gap Analysis ----
    @PostMapping("/api/v1/planning/gap-analysis/{id}/run")
    @RequirePermission(module = "PLANNING", screen = "*", action = "APPROVE")
    public GapAnalysisRun runGapAnalysis(@PathVariable Long id, Principal principal) {
        GapAnalysisRun run = gapAnalysisRuns.findById(id).orElseThrow(() -> new RuntimeException("Gap Analysis Run not found"));
        gapAnalysisResults.findByRunId(id).forEach(r -> gapAnalysisResults.deleteById(r.getId()));

        LocalDate now = LocalDate.now();
        LocalDate horizonEnd = run.getPlanningHorizonEnd() != null
            ? run.getPlanningHorizonEnd().atZone(ZoneId.systemDefault()).toLocalDate()
            : now.plusDays(90);

        List<WorkOrder> activeWOs = workOrders.findByStatus("RELEASED");
        activeWOs.addAll(workOrders.findByStatus("IN_PROCESS"));

        for (WorkOrder wo : activeWOs) {
            if (wo.getDueDate() == null || wo.getDueDate().isAfter(horizonEnd)) continue;

            // Material gap
            BigDecimal grossReq = BigDecimal.ZERO;
            if (wo.getBomId() != null) {
                Optional<ProductionBOM> bomOpt = productionBoms.findById(wo.getBomId());
                if (bomOpt.isPresent()) {
                    for (ProductionBOMLine bomLine : bomOpt.get().getLines()) {
                        BigDecimal qtyPer = bomLine.getQuantityPer() == null ? BigDecimal.ONE : bomLine.getQuantityPer();
                        grossReq = grossReq.add(wo.getOrderQuantity().multiply(qtyPer));
                    }
                }
            }
            BigDecimal issued = BigDecimal.ZERO;
            for (WorkOrderMaterial mat : wo.getMaterials()) {
                issued = issued.add(mat.getIssuedQuantity() == null ? BigDecimal.ZERO : mat.getIssuedQuantity());
            }
            BigDecimal materialGap = grossReq.subtract(issued);
            if (materialGap.compareTo(BigDecimal.ZERO) > 0) {
                GapAnalysisResult result = new GapAnalysisResult();
                result.setRun(run);
                result.setGapType("MATERIAL");
                result.setContextCode(wo.getWoNumber());
                result.setContextDescription(wo.getItemCode() + " - Material shortage");
                result.setDemandQty(grossReq);
                result.setSupplyQty(issued);
                result.setGapQty(materialGap);
                result.setSeverity(classifySeverity(materialGap, grossReq));
                result.setRootCause("Insufficient material issued against work order");
                result.setSuggestedAction("Issue pending materials or expedite procurement");
                result.setActionStatus("OPEN");
                result.setCreatedAt(Instant.now());
                gapAnalysisResults.save(result);
            }

            // Delivery date gap
            long daysBetween = java.time.temporal.ChronoUnit.DAYS.between(now, wo.getDueDate());
            if (daysBetween < 0) {
                GapAnalysisResult result = new GapAnalysisResult();
                result.setRun(run);
                result.setGapType("DELIVERY");
                result.setContextCode(wo.getWoNumber());
                result.setContextDescription(wo.getItemCode() + " - Overdue work order");
                result.setDemandQty(wo.getOrderQuantity());
                result.setSupplyQty(BigDecimal.ZERO);
                result.setGapQty(wo.getOrderQuantity());
                result.setGapDays((int) Math.abs(daysBetween));
                result.setSeverity(Math.abs(daysBetween) > 30 ? "CRITICAL" : Math.abs(daysBetween) > 20 ? "HIGH" : "MEDIUM");
                result.setRootCause("Work order delivery date has passed");
                result.setSuggestedAction("Expedite production or renegotiate delivery date");
                result.setActionStatus("OPEN");
                result.setCreatedAt(Instant.now());
                gapAnalysisResults.save(result);
            }
        }

        run.setStatus("COMPLETE");
        run.setGeneratedBy(principalName(principal));
        run.setUpdatedAt(Instant.now());
        GapAnalysisRun saved = gapAnalysisRuns.save(run);

        // Escalation: notify roles for CRITICAL/HIGH gaps
        List<GapAnalysisResult> criticalResults = gapAnalysisResults.findByRunIdAndSeverityIn(
                saved.getId(), List.of("CRITICAL", "HIGH"));
        if (!criticalResults.isEmpty()) {
            List<EscalationRule> rules = escalationRules.findByDocKeyAndActiveTrue("gap-analysis");
            for (EscalationRule rule : rules) {
                boolean matches = criticalResults.stream().anyMatch(r -> rule.getPriority().equals(r.getSeverity()));
                if (matches) {
                    long criticalCount = criticalResults.stream().filter(r -> rule.getPriority().equals(r.getSeverity())).count();
                    notificationService.notify(
                            "GAP_ESCALATION", "PLANNING", "GapAnalysisRun", saved.getId(),
                            rule.getPriority(),
                            String.format("[%s] Gap Analysis %s: %d %s gaps found in run %s",
                                    rule.getPriority(), rule.getEscalateToRole(), criticalCount,
                                    rule.getPriority().toLowerCase(), saved.getRunNumber()),
                            saved.getRunNumber()
                    );
                }
            }
        }

        return saved;
    }

    // ===========================
    // ---- Cost Estimation ------
    // ===========================

    @GetMapping("/api/v1/planning/cost-estimations")
    public List<CostEstimation> listCostEstimations() { return costEstimations.findAll(); }

    @PostMapping("/api/v1/planning/cost-estimations")
    @RequirePermission(module = "PLANNING", screen = "*", action = "CREATE")
    public CostEstimation createCostEstimation(@RequestBody CostEstimation ce, Principal principal) {
        ce.setId(null);
        ce.setEstimationNumber(numbers.next("cost-estimation", "CE"));
        if (ce.getStatus() == null) ce.setStatus("DRAFT");
        if (ce.getEstimationVersion() == null) ce.setEstimationVersion(1);
        if (ce.getCurrencyCode() == null) ce.setCurrencyCode("INR");
        ce.setCreatedBy(principalName(principal));
        ce.setCreatedAt(Instant.now());
        return costEstimations.save(ce);
    }

    @GetMapping("/api/v1/planning/cost-estimations/{id}")
    public CostEstimation getCostEstimation(@PathVariable Long id) {
        return costEstimations.findById(id).orElseThrow(() -> new RuntimeException("Cost Estimation not found"));
    }

    @PutMapping("/api/v1/planning/cost-estimations/{id}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "EDIT")
    public CostEstimation updateCostEstimation(@PathVariable Long id, @RequestBody CostEstimation ce, Principal principal) {
        CostEstimation e = costEstimations.findById(id).orElseThrow(() -> new RuntimeException("Cost Estimation not found"));
        ce.setId(id);
        ce.setEstimationNumber(e.getEstimationNumber());
        ce.setCreatedAt(e.getCreatedAt());
        ce.setCreatedBy(e.getCreatedBy());
        ce.setUpdatedAt(Instant.now());
        ce.setUpdatedBy(principalName(principal));
        return costEstimations.save(ce);
    }

    @DeleteMapping("/api/v1/planning/cost-estimations/{id}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "DELETE")
    public void deleteCostEstimation(@PathVariable Long id) {
        costEstimationLines.findByEstimationId(id).forEach(l -> costEstimationLines.deleteById(l.getId()));
        costEstimations.deleteById(id);
    }

    @GetMapping("/api/v1/planning/cost-estimations/{id}/lines")
    public List<CostEstimationLine> getCostEstimationLines(@PathVariable Long id) {
        return costEstimationLines.findByEstimationId(id);
    }

    @PostMapping("/api/v1/planning/cost-estimations/{id}/lines")
    @RequirePermission(module = "PLANNING", screen = "*", action = "CREATE")
    public CostEstimationLine addCostEstimationLine(@PathVariable Long id, @RequestBody CostEstimationLine line, Principal principal) {
        CostEstimation ce = costEstimations.findById(id).orElseThrow(() -> new RuntimeException("Cost Estimation not found"));
        line.setId(null);
        line.setEstimation(ce);
        line.setCreatedAt(Instant.now());
        return costEstimationLines.save(line);
    }

    @PutMapping("/api/v1/planning/cost-estimations/lines/{lineId}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "EDIT")
    public CostEstimationLine updateCostEstimationLine(@PathVariable Long lineId, @RequestBody CostEstimationLine line, Principal principal) {
        CostEstimationLine e = costEstimationLines.findById(lineId).orElseThrow(() -> new RuntimeException("Cost Estimation Line not found"));
        line.setId(lineId);
        line.setEstimation(e.getEstimation());
        line.setCreatedAt(e.getCreatedAt());
        line.setUpdatedAt(Instant.now());
        return costEstimationLines.save(line);
    }

    @DeleteMapping("/api/v1/planning/cost-estimations/lines/{lineId}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "DELETE")
    public void deleteCostEstimationLine(@PathVariable Long lineId) { costEstimationLines.deleteById(lineId); }

    @PostMapping("/api/v1/planning/cost-estimations/{id}/actions/{action}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "APPROVE")
    public CostEstimation costEstimationAction(@PathVariable Long id, @PathVariable String action, Principal principal) {
        CostEstimation ce = costEstimations.findById(id).orElseThrow(() -> new RuntimeException("Cost Estimation not found"));
        switch (action.toLowerCase()) {
            case "submit":
                ce.setStatus("SUBMITTED");
                ce.setPreparedBy(principalName(principal));
                createApprovalSteps("COST_ESTIMATION", ce.getId(), List.of("COST_ACCOUNTANT", "PLANT_HEAD"), principal);
                break;
            case "approve":
                ce.setStatus("APPROVED");
                ce.setApprovedBy(principalName(principal));
                advanceApprovalStep("COST_ESTIMATION", ce.getId(), principalName(principal));
                break;
            default:
                throw new RuntimeException("Unknown action: " + action);
        }
        ce.setUpdatedAt(Instant.now());
        ce.setUpdatedBy(principalName(principal));
        return costEstimations.save(ce);
    }

    // ---- Auto-calculate cost estimation from BOM + Route ----
    @PostMapping("/api/v1/planning/cost-estimations/{id}/calculate")
    @RequirePermission(module = "PLANNING", screen = "*", action = "APPROVE")
    public CostEstimation calculateCostEstimation(@PathVariable Long id, Principal principal) {
        CostEstimation ce = costEstimations.findById(id).orElseThrow(() -> new RuntimeException("Cost Estimation not found"));
        costEstimationLines.findByEstimationId(id).forEach(l -> costEstimationLines.deleteById(l.getId()));

        BigDecimal totalMaterialCost = BigDecimal.ZERO;
        BigDecimal totalMachineCost = BigDecimal.ZERO;
        BigDecimal batchQty = ce.getBatchQty() == null ? BigDecimal.ONE : ce.getBatchQty();

        // Material cost from BOM
        if (ce.getBomId() != null) {
            ProductionBOM bom = productionBoms.findById(ce.getBomId()).orElse(null);
            if (bom != null) {
                for (ProductionBOMLine bomLine : bom.getLines()) {
                    BigDecimal qtyPer = bomLine.getQuantityPer() == null ? BigDecimal.ONE : bomLine.getQuantityPer();
                    BigDecimal totalQty = qtyPer.multiply(batchQty);
                    BigDecimal rate = BigDecimal.ZERO;
                    Optional<ItemMaster> itemOpt = items.findByCode(bomLine.getComponentItemCode());
                    if (itemOpt.isPresent() && itemOpt.get().getDefaultRate() != null) {
                        rate = itemOpt.get().getDefaultRate();
                    }
                    BigDecimal amount = totalQty.multiply(rate);
                    totalMaterialCost = totalMaterialCost.add(amount);

                    CostEstimationLine line = new CostEstimationLine();
                    line.setEstimation(ce);
                    line.setLineType("MATERIAL");
                    line.setComponentItemCode(bomLine.getComponentItemCode());
                    line.setComponentName(bomLine.getDescription());
                    line.setQtyRequired(totalQty);
                    line.setRatePerUnit(rate);
                    line.setAmount(amount);
                    line.setCreatedAt(Instant.now());
                    costEstimationLines.save(line);
                }
            }
        }

        // Machine cost from Route
        if (ce.getRouteId() != null) {
            RouteSheet route = routeSheets.findById(ce.getRouteId()).orElse(null);
            if (route != null) {
                for (RouteOperation op : route.getOperations()) {
                    BigDecimal setupMin = op.getSetupTime() == null ? BigDecimal.ZERO : op.getSetupTime();
                    BigDecimal cycleMin = op.getCycleTime() == null ? BigDecimal.ZERO : op.getCycleTime();
                    BigDecimal setupHrs = setupMin.divide(BigDecimal.valueOf(60), 4, RoundingMode.HALF_UP);
                    BigDecimal cycleHrs = cycleMin.divide(BigDecimal.valueOf(60), 4, RoundingMode.HALF_UP);
                    BigDecimal totalTimeHrs = setupHrs.add(cycleHrs.multiply(batchQty));

                    BigDecimal hourlyRate = BigDecimal.ZERO;
                    if (op.getWorkCenterCode() != null) {
                        Optional<WorkCenter> wcOpt = workCenters.findByCode(op.getWorkCenterCode());
                        if (wcOpt.isPresent() && wcOpt.get().getHourlyRate() != null) {
                            hourlyRate = wcOpt.get().getHourlyRate();
                        }
                    }
                    if (hourlyRate.compareTo(BigDecimal.ZERO) == 0 && op.getStandardCostRate() != null) {
                        hourlyRate = op.getStandardCostRate();
                    }
                    BigDecimal machineCost = totalTimeHrs.multiply(hourlyRate);
                    totalMachineCost = totalMachineCost.add(machineCost);

                    CostEstimationLine line = new CostEstimationLine();
                    line.setEstimation(ce);
                    line.setLineType("MACHINE");
                    line.setOpSequence(op.getSequenceNo());
                    line.setOperationName(op.getOperationDescription());
                    line.setMachineCode(op.getMachineCode());
                    line.setMachineHourRate(hourlyRate);
                    line.setSetupTimeHrs(setupHrs);
                    line.setCycleTimeHrs(cycleHrs);
                    line.setTotalTimeHrs(totalTimeHrs);
                    line.setMachineCost(machineCost);
                    line.setCreatedAt(Instant.now());
                    costEstimationLines.save(line);
                }
            }
        }

        BigDecimal scrapAllowance = ce.getScrapAllowanceCost() == null ? BigDecimal.ZERO : ce.getScrapAllowanceCost();
        BigDecimal totalManufacturingCost = totalMaterialCost.add(totalMachineCost).add(scrapAllowance);
        BigDecimal labourCost = ce.getTotalLabourCost() == null ? BigDecimal.ZERO : ce.getTotalLabourCost();
        BigDecimal toolingCost = ce.getTotalToolingCost() == null ? BigDecimal.ZERO : ce.getTotalToolingCost();
        BigDecimal subcontractCost = ce.getTotalSubcontractCost() == null ? BigDecimal.ZERO : ce.getTotalSubcontractCost();
        BigDecimal overheadCost = ce.getTotalOverheadCost() == null ? BigDecimal.ZERO : ce.getTotalOverheadCost();
        totalManufacturingCost = totalManufacturingCost.add(labourCost).add(toolingCost).add(subcontractCost).add(overheadCost);

        BigDecimal profitMargin = ce.getProfitMarginPercent() == null ? BigDecimal.ZERO : ce.getProfitMarginPercent();
        BigDecimal profitAmount = totalManufacturingCost.multiply(profitMargin).divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
        BigDecimal sellingPrice = totalManufacturingCost.add(profitAmount);

        ce.setTotalMaterialCost(totalMaterialCost);
        ce.setTotalMachineCost(totalMachineCost);
        ce.setTotalManufacturingCost(totalManufacturingCost);
        ce.setProfitAmount(profitAmount);
        ce.setEstimatedSellingPrice(sellingPrice);
        ce.setUpdatedAt(Instant.now());
        return costEstimations.save(ce);
    }

    // ---- Cost Estimate vs Actual Reconciliation ----
    @PostMapping("/api/v1/planning/cost-estimations/{id}/reconcile")
    @RequirePermission(module = "PLANNING", screen = "*", action = "APPROVE")
    public Map<String, Object> reconcileCostEstimation(@PathVariable Long id, Principal principal) {
        CostEstimation ce = costEstimations.findById(id).orElseThrow(() -> new RuntimeException("Cost Estimation not found"));

        String itemCode = ce.getItemCode();
        List<WorkOrder> wos = workOrders.findByItemCode(itemCode);

        BigDecimal actualMachine = BigDecimal.ZERO;
        for (WorkOrder wo : wos) {
            // Machine cost from production entries: run_time × work_center.hourly_rate
            Number machCost = (Number) em.createNativeQuery(
                    "SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(sfe.end_time, NOW()) - sfe.start_time)) / 3600 * " +
                    "COALESCE(wc.hourly_rate, 0)), 0) " +
                    "FROM shop_floor_entry sfe " +
                    "LEFT JOIN work_center wc ON wc.code = sfe.machine_code " +
                    "WHERE sfe.work_order_no = :woNo AND sfe.status = 'APPROVED' AND sfe.deleted_at IS NULL")
                    .setParameter("woNo", wo.getDocNo())
                    .getSingleResult();
            actualMachine = actualMachine.add(machCost != null ? new BigDecimal(machCost.toString()) : BigDecimal.ZERO);
        }

        BigDecimal actualTotal = actualMachine;
        BigDecimal estMaterial = ce.getTotalMaterialCost() != null ? ce.getTotalMaterialCost() : BigDecimal.ZERO;
        BigDecimal estMachine = ce.getTotalMachineCost() != null ? ce.getTotalMachineCost() : BigDecimal.ZERO;
        BigDecimal estTotal = ce.getTotalManufacturingCost() != null ? ce.getTotalManufacturingCost() : BigDecimal.ZERO;

        BigDecimal varMachine = actualMachine.subtract(estMachine);
        BigDecimal varTotal = actualTotal.subtract(estTotal);

        ce.setActualMachineCost(actualMachine);
        ce.setActualTotalCost(actualTotal);
        ce.setVarianceMachine(varMachine);
        ce.setVarianceTotal(varTotal);
        ce.setUpdatedAt(Instant.now());
        costEstimations.save(ce);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("estimationNumber", ce.getEstimationNumber());
        result.put("itemCode", ce.getItemCode());
        result.put("workOrders", wos.stream().map(WorkOrder::getDocNo).toList());
        result.put("estimated", Map.of(
                "material", estMaterial, "machine", estMachine, "total", estTotal));
        result.put("actual", Map.of(
                "machine", actualMachine, "total", actualTotal));
        result.put("variance", Map.of(
                "machine", varMachine, "total", varTotal));
        if (estTotal.compareTo(BigDecimal.ZERO) > 0) {
            result.put("variancePercent", Map.of(
                    "machine", varMachine.multiply(BigDecimal.valueOf(100)).divide(estTotal, 2, RoundingMode.HALF_UP),
                    "total", varTotal.multiply(BigDecimal.valueOf(100)).divide(estTotal, 2, RoundingMode.HALF_UP)));
        }
        return result;
    }

    // ===========================
    // §3.4 Material Reservation --
    // ===========================

    @GetMapping("/api/v1/planning/material-reservations")
    public List<MaterialReservation> listMaterialReservations() { return materialReservations.findAll(); }

    @PostMapping("/api/v1/planning/material-reservations")
    @RequirePermission(module = "PLANNING", screen = "*", action = "CREATE")
    public MaterialReservation createMaterialReservation(@RequestBody MaterialReservation r, Principal principal) {
        r.setId(null);
        r.setReservationNumber(numbers.next("material-reservation", "MRES"));
        r.setReservedDate(Instant.now());
        r.setStatus("RESERVED");
        r.setCreatedBy(principalName(principal));
        return materialReservations.save(r);
    }

    @PutMapping("/api/v1/planning/material-reservations/{id}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "EDIT")
    public MaterialReservation updateMaterialReservation(@PathVariable Long id, @RequestBody MaterialReservation r, Principal principal) {
        r.setId(id);
        r.setUpdatedBy(principalName(principal));
        return materialReservations.save(r);
    }

    @PostMapping("/api/v1/planning/material-reservations/{id}/release")
    @RequirePermission(module = "PLANNING", screen = "*", action = "APPROVE")
    public MaterialReservation releaseMaterialReservation(@PathVariable Long id) {
        MaterialReservation r = materialReservations.findById(id).orElseThrow(() -> new RuntimeException("Reservation not found"));
        r.setStatus("RELEASED");
        r.setReleasedDate(Instant.now());
        return materialReservations.save(r);
    }

    // ===========================
    // §3.5 FG Possible Persistent
    // ===========================

    @GetMapping("/api/v1/planning/fg-possible-list")
    public List<FgPossible> listFgPossible() { return fgPossibles.findAll(); }

    @PostMapping("/api/v1/planning/fg-possible-list")
    @RequirePermission(module = "PLANNING", screen = "*", action = "CREATE")
    public FgPossible createFgPossible(@RequestBody FgPossible fp, Principal principal) {
        fp.setId(null);
        fp.setInquiryNumber(numbers.next("fg-possible", "FGP"));
        fp.setRunBy(principalName(principal));
        fp.setRunDate(Instant.now());
        fp.setStatus("COMPLETE");
        return fgPossibles.save(fp);
    }

    @GetMapping("/api/v1/planning/fg-possible-list/{id}")
    public FgPossible getFgPossible(@PathVariable Long id) {
        return fgPossibles.findById(id).orElseThrow(() -> new RuntimeException("FG Possible inquiry not found"));
    }

    @PutMapping("/api/v1/planning/fg-possible-list/{id}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "EDIT")
    public FgPossible updateFgPossible(@PathVariable Long id, @RequestBody FgPossible fp, Principal principal) {
        fp.setId(id);
        fp.setUpdatedBy(principalName(principal));
        return fgPossibles.save(fp);
    }

    // ===========================
    // §3.10 Cost Component Type --
    // ===========================

    @GetMapping("/api/v1/planning/cost-component-types")
    public List<CostComponentType> listCostComponentTypes() {
        return costComponentTypes.findByIsActiveTrueOrderBySortOrderAsc();
    }

    // ===========================
    // §3.3 Route Operation Inspections
    // ===========================

    @GetMapping("/api/v1/planning/route-operations/{opId}/inspections")
    public List<RouteOperationInspection> listInspections(@PathVariable Long opId) {
        return routeOpInspections.findByRouteOperationIdOrderBySortOrderAsc(opId);
    }

    @PostMapping("/api/v1/planning/route-operations/{opId}/inspections")
    @RequirePermission(module = "PLANNING", screen = "*", action = "CREATE")
    public RouteOperationInspection addInspection(@PathVariable Long opId, @RequestBody RouteOperationInspection insp) {
        RouteOperation op = em.find(RouteOperation.class, opId);
        if (op == null) throw new RuntimeException("Route Operation not found");
        insp.setRouteOperation(op);
        insp.setId(null);
        return routeOpInspections.save(insp);
    }

    @DeleteMapping("/api/v1/planning/route-inspections/{id}")
    @RequirePermission(module = "PLANNING", screen = "*", action = "DELETE")
    public void deleteInspection(@PathVariable Long id) {
        routeOpInspections.deleteById(id);
    }

    // ===========================
    // §3.2 BOM Where-Used + Version Compare
    // ===========================

    @GetMapping("/api/v1/planning/production-bom/{id}/where-used")
    public List<Map<String, Object>> bomWhereUsed(@PathVariable Long id) {
        ProductionBOM bom = productionBoms.findById(id).orElseThrow(() -> new RuntimeException("BOM not found"));
        String itemCode = bom.getItemCode();
        List<Map<String, Object>> result = new ArrayList<>();
        // Find WOs using this BOM
        List<WorkOrder> wos = workOrders.findByBomId(id);
        for (WorkOrder wo : wos) {
            Map<String, Object> entry = new HashMap<>();
            entry.put("type", "WORK_ORDER");
            entry.put("reference", wo.getWoNumber());
            entry.put("itemCode", wo.getItemCode());
            entry.put("status", wo.getStatus());
            entry.put("quantity", wo.getOrderQuantity());
            result.add(entry);
        }
        // Find other BOMs referencing this item as a component
        List<ProductionBOM> allBoms = productionBoms.findAll();
        for (ProductionBOM other : allBoms) {
            if (other.getId().equals(id)) continue;
            boolean used = other.getLines().stream()
                .anyMatch(line -> itemCode.equals(line.getComponentItemCode()));
            if (used) {
                Map<String, Object> entry = new HashMap<>();
                entry.put("type", "PRODUCTION_BOM");
                entry.put("reference", other.getBomNumber());
                entry.put("itemCode", other.getItemCode());
                entry.put("status", other.getStatus());
                entry.put("quantity", other.getBaseQuantity());
                result.add(entry);
            }
        }
        return result;
    }

    @GetMapping("/api/v1/planning/production-bom/{id}/version-compare")
    public Map<String, Object> bomVersionCompare(@PathVariable Long id) {
        ProductionBOM bom = productionBoms.findById(id).orElseThrow(() -> new RuntimeException("BOM not found"));
        Map<String, Object> result = new HashMap<>();
        result.put("currentVersion", bom.getBomVersion());
        result.put("currentRevision", bom.getItemRevision());
        result.put("componentCount", bom.getLines().size());
        if (bom.getPreviousRevisionId() != null) {
            ProductionBOM prev = productionBoms.findById(bom.getPreviousRevisionId()).orElse(null);
            if (prev != null) {
                result.put("previousVersion", prev.getBomVersion());
                result.put("previousComponentCount", prev.getLines().size());
                result.put("changed", !bom.getLines().stream()
                    .map(ProductionBOMLine::getComponentItemCode)
                    .collect(Collectors.toSet())
                    .equals(prev.getLines().stream()
                        .map(ProductionBOMLine::getComponentItemCode)
                        .collect(Collectors.toSet())));
            }
        } else {
            result.put("previousVersion", null);
            result.put("changed", null);
        }
        return result;
    }

    // ===========================
    // §3.8 ECO Existing Orders Gate
    // ===========================

    @GetMapping("/api/v1/planning/engineering-changes/{id}/existing-orders")
    public List<Map<String, Object>> getExistingOrdersForEco(@PathVariable Long id) {
        EngineeringChange ec = engineeringChanges.findById(id).orElseThrow(() -> new RuntimeException("ECR/ECO not found"));
        String itemCode = ec.getItemCode();
        List<WorkOrder> wos = workOrders.findByItemCode(itemCode);
        List<Map<String, Object>> result = new ArrayList<>();
        for (WorkOrder wo : wos) {
            if (wo.getStatus() != null && !List.of("CLOSED", "CANCELLED").contains(wo.getStatus())) {
                Map<String, Object> entry = new HashMap<>();
                entry.put("workOrderId", wo.getId());
                entry.put("woNumber", wo.getWoNumber());
                entry.put("status", wo.getStatus());
                entry.put("orderQuantity", wo.getOrderQuantity());
                entry.put("disposition", null);
                result.add(entry);
            }
        }
        return result;
    }

    @PutMapping("/api/v1/planning/engineering-changes/{id}/mark-evaluated")
    @RequirePermission(module = "PLANNING", screen = "*", action = "APPROVE")
    public EngineeringChange markExistingOrdersEvaluated(@PathVariable Long id) {
        EngineeringChange ec = engineeringChanges.findById(id).orElseThrow(() -> new RuntimeException("ECR/ECO not found"));
        ec.setExistingOrdersEvaluated(true);
        return engineeringChanges.save(ec);
    }

    // ===========================
    // ---- Helper Methods -------
    // ===========================

    private String classifySeverity(BigDecimal gapQty, BigDecimal demandQty) {
        if (demandQty.compareTo(BigDecimal.ZERO) == 0) return "LOW";
        BigDecimal pct = gapQty.multiply(BigDecimal.valueOf(100)).divide(demandQty, 2, RoundingMode.HALF_UP);
        if (pct.compareTo(BigDecimal.valueOf(30)) > 0) return "CRITICAL";
        if (pct.compareTo(BigDecimal.valueOf(20)) > 0) return "HIGH";
        if (pct.compareTo(BigDecimal.valueOf(10)) > 0) return "MEDIUM";
        return "LOW";
    }

    private void createApprovalSteps(String docType, Long docId, List<String> roles, Principal principal) {
        approvalSteps.deleteByDocTypeAndDocId(docType, docId);
        int step = 1;
        for (String role : roles) {
            ApprovalStep as = new ApprovalStep();
            as.setDocType(docType);
            as.setDocId(docId);
            as.setStepNo(step++);
            as.setRoleRequired(role);
            as.setStatus("PENDING");
            approvalSteps.save(as);
        }
    }

    private void advanceApprovalStep(String docType, Long docId, String decidedBy) {
        List<ApprovalStep> steps = approvalSteps.findByDocTypeAndDocIdOrderByStepNoAsc(docType, docId);
        for (ApprovalStep s : steps) {
            if ("PENDING".equals(s.getStatus())) {
                s.setStatus("APPROVED");
                s.setDecidedAt(Instant.now());
                s.setComments("Approved by " + decidedBy);
                approvalSteps.save(s);
                break;
            }
        }
    }
}
