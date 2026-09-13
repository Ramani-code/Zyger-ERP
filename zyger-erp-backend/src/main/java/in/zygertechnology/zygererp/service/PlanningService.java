package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

@Service
@RequiredArgsConstructor
public class PlanningService {

    static final Set<String> PLANNING_KEYS = Set.of(
            "production-bom", "route-sheet", "work-order", "shop-floor-entry"
    );

    private final DocumentFacade docs;
    private final ProductionBOMRepository bomRepo;
    private final RouteSheetRepository routeRepo;
    private final BomRevisionHistoryRepository bomRevisionHistoryRepo;
    private final jakarta.persistence.EntityManager em;
    private final in.zygertechnology.zygererp.repo.WorkOrderStatusHistoryRepository woStatusHistoryRepo;
    private final ProcessMasterRepository processRepo;
    private final in.zygertechnology.zygererp.repository.ResourceMasterRepository resourceRepo;
    private final DocStatusHistoryRepository docStatusHistoryRepo;
    private final ProductionJobCardService productionJobCardService;

    public boolean isPlanning(String key) { return PLANNING_KEYS.contains(key); }

    @Transactional
    public DocEntity create(String key, Map<String, Object> body, String user) {
        body.put("createdBy", user);
        if ("route-sheet".equals(key)) preResolveRouteLineIds(body);
        validateBeforeCreate(key, body);
        DocEntity e = docs.create(key, body, user);
        applyCreationDefaults(key, e);
        if ("production-bom".equals(key) && e instanceof ProductionBOM bom) {
            if (body.get("itemType") != null && !String.valueOf(body.get("itemType")).isBlank()) {
                bom.setItemType(String.valueOf(body.get("itemType")).trim());
            }
            if (body.get("baseQuantity") != null) {
                try {
                    bom.setBaseQuantity(new BigDecimal(String.valueOf(body.get("baseQuantity"))));
                } catch (Exception ignored) {}
            }
            if (body.get("weight") != null) {
                try {
                    BigDecimal w = new BigDecimal(String.valueOf(body.get("weight")));
                    if (w.compareTo(BigDecimal.ZERO) > 0) bom.setWeight(w);
                } catch (Exception ignored) {}
            }
            autoDeriveBomItemType(bom);
            recomputeBomWeights(bom);
            recomputeBomTotalMaterialCost(bom);
        }
        if ("route-sheet".equals(key) && e instanceof RouteSheet route) {
            resolveRouteRefs(route);
            recomputeRouteDerivedFields(route);
            recomputeRouteTotals(route);
        }
        if ("work-order".equals(key) && e instanceof WorkOrder wo) {
            // FRS v4.0 §3: auto-derive item fields from ItemMaster
            autoDeriveWoItemFields(wo);
            recomputeWoBalanceQty(wo);
        }
        return e;
    }

    @Transactional
    public DocEntity update(String key, Long id, Map<String, Object> body, String user) {
        if ("route-sheet".equals(key)) preResolveRouteLineIds(body);
        validateBeforeUpdate(key, id, body);
        DocEntity e = docs.update(key, id, body, user);
        if ("production-bom".equals(key) && e instanceof ProductionBOM bom) {
            if (body.get("itemType") != null && !String.valueOf(body.get("itemType")).isBlank()) {
                bom.setItemType(String.valueOf(body.get("itemType")).trim());
            }
            if (body.get("baseQuantity") != null) {
                try {
                    bom.setBaseQuantity(new BigDecimal(String.valueOf(body.get("baseQuantity"))));
                } catch (Exception ignored) {}
            }
            if (body.get("weight") != null) {
                try {
                    BigDecimal w = new BigDecimal(String.valueOf(body.get("weight")));
                    if (w.compareTo(BigDecimal.ZERO) > 0) bom.setWeight(w);
                } catch (Exception ignored) {}
            }
            recomputeBomWeights(bom);
            recomputeBomTotalMaterialCost(bom);
        }
        if ("route-sheet".equals(key) && e instanceof RouteSheet route) {
            resolveRouteRefs(route);
            recomputeRouteDerivedFields(route);
            recomputeRouteTotals(route);
        }
        if ("work-order".equals(key) && e instanceof WorkOrder wo) {
            recomputeWoBalanceQty(wo);
        }
        return e;
    }

    private void validateBeforeUpdate(String key, Long id, Map<String, Object> body) {
        if ("production-bom".equals(key) && body.containsKey("parentBomId")) {
            Object parentBomId = body.get("parentBomId");
            if (parentBomId != null) {
                long parentId = Long.parseLong(String.valueOf(parentBomId));
                if (parentId == id) {
                    throw new IllegalArgumentException("BOM cannot reference itself as parent.");
                }
                validateNotCircular(id, parentId);
                validateParentNotCyclic(parentId);
            }
        }
        if ("work-order".equals(key)) {
            // FRD §7.0: SO is mandatory on update too (cannot remove SO from WO)
            if (body.containsKey("salesOrderId") && body.get("salesOrderId") == null
                    && body.get("sourceDocNo") == null) {
                throw new IllegalArgumentException("Sales Order is mandatory.");
            }
            WorkOrder wo = (WorkOrder) docs.get("work-order", id);
            // FRD §7.0: Planned End Date > Start Date on update
            String sd = body.containsKey("plannedStartDate") ? String.valueOf(body.getOrDefault("plannedStartDate", "")) : String.valueOf(wo.getPlannedStartDate() != null ? wo.getPlannedStartDate() : "");
            String ed = body.containsKey("plannedEndDate") ? String.valueOf(body.getOrDefault("plannedEndDate", "")) : String.valueOf(wo.getPlannedEndDate() != null ? wo.getPlannedEndDate() : "");
            if (!sd.isEmpty() && sd.length() >= 10 && !ed.isEmpty() && ed.length() >= 10) {
                LocalDate startDate = LocalDate.parse(sd.substring(0, 10));
                LocalDate endDate = LocalDate.parse(ed.substring(0, 10));
                if (!endDate.isAfter(startDate)) {
                    throw new IllegalArgumentException("Planned End Date should be greater than Planned Start Date.");
                }
            }
        }
    }

    private void validateBeforeCreate(String key, Map<String, Object> body) {
        if ("production-bom".equals(key)) {
            String itemType = body.get("itemType") != null ? String.valueOf(body.get("itemType")).trim() : "";
            if (itemType.isEmpty()) {
                throw new IllegalArgumentException("Item Type is mandatory.");
            }
            if ("RM".equalsIgnoreCase(itemType) || "RAW_MATERIAL".equalsIgnoreCase(itemType)) {
                throw new IllegalArgumentException("BOM cannot be created for Raw Material items.");
            }
            String itemCode = body.get("itemCode") != null ? String.valueOf(body.get("itemCode")).trim() : "";
            if (itemCode.isEmpty()) {
                throw new IllegalArgumentException("BOM Item is mandatory.");
            }
            if (body.containsKey("baseQuantity") && body.get("baseQuantity") != null) {
                try {
                    BigDecimal qty = new BigDecimal(String.valueOf(body.get("baseQuantity")));
                    if (qty.compareTo(BigDecimal.ZERO) <= 0) {
                        throw new IllegalArgumentException("Quantity should be greater than zero.");
                    }
                } catch (NumberFormatException ignored) {}
            }

            // Uniqueness validation (V-06 / V-21 / V-22)
            Object soIdObj = body.get("salesOrderId");
            Long soId = soIdObj != null && !String.valueOf(soIdObj).isBlank() ? Long.parseLong(String.valueOf(soIdObj)) : null;
            Object bomIdObj = body.get("id");
            Long currentBomId = bomIdObj != null && !String.valueOf(bomIdObj).isBlank() ? Long.parseLong(String.valueOf(bomIdObj)) : null;

            if (soId == null) {
                long existingCount = currentBomId != null
                    ? bomRepo.countByItemCodeAndSalesOrderIdIsNullAndIsActiveTrueAndIdNot(itemCode, currentBomId)
                    : bomRepo.countByItemCodeAndSalesOrderIdIsNullAndIsActiveTrue(itemCode);
                if (existingCount > 0) {
                    throw new IllegalStateException("Active BOM already exists for the selected item.");
                }
            } else {
                long existingSoCount = currentBomId != null
                    ? bomRepo.countByItemCodeAndSalesOrderIdAndIsActiveTrueAndIdNot(itemCode, soId, currentBomId)
                    : bomRepo.countByItemCodeAndSalesOrderIdAndIsActiveTrue(itemCode, soId);
                if (existingSoCount > 0) {
                    throw new IllegalStateException("BOM already exists for the selected Sales Order and Item.");
                }
            }

            // Component Lines validation (V-13, V-14, V-16, V-09, V-20)
            Object linesObj = body.get("lines");
            if (linesObj instanceof List<?> lineList) {
                if (lineList.isEmpty()) {
                    throw new IllegalArgumentException("At least one component is required.");
                }
                Set<String> seenComponents = new HashSet<>();
                for (Object lineItem : lineList) {
                    if (lineItem instanceof Map<?, ?> lineMap) {
                        String compCode = lineMap.get("componentItemCode") != null ? String.valueOf(lineMap.get("componentItemCode")).trim() : "";
                        if (compCode.isEmpty()) {
                            throw new IllegalArgumentException("Item Name is mandatory.");
                        }
                        if (itemCode.equals(compCode)) {
                            throw new IllegalArgumentException("Parent item and component item cannot be same.");
                        }
                        if (!seenComponents.add(compCode)) {
                            throw new IllegalArgumentException("Duplicate component item is not allowed.");
                        }
                        Object qObj = lineMap.get("quantityPer");
                        if (qObj != null) {
                            try {
                                BigDecimal qPer = new BigDecimal(String.valueOf(qObj));
                                if (qPer.compareTo(BigDecimal.ZERO) <= 0) {
                                    throw new IllegalArgumentException("Component quantity must be greater than zero.");
                                }
                            } catch (NumberFormatException ignored) {}
                        }
                    }
                }
            }

            Object parentBomId = body.get("parentBomId");
            Object bomId = body.get("id");
            if (parentBomId != null) {
                long parentId = Long.parseLong(String.valueOf(parentBomId));
                if (bomId != null) {
                    long id = Long.parseLong(String.valueOf(bomId));
                    validateNotCircular(id, parentId);
                } else {
                    validateParentNotCyclic(parentId);
                }
            }
        }
        if ("work-order".equals(key)) {
            validateWorkOrderBeforeCreate(body);
        }
    }

    private void validateParentNotCyclic(Long parentBomId) {
        Set<Long> visited = new HashSet<>();
        Long current = parentBomId;
        while (current != null) {
            if (!visited.add(current)) {
                throw new IllegalArgumentException("Circular BOM hierarchy detected: cycle at BOM " + current);
            }
            Optional<ProductionBOM> bom = bomRepo.findById(current);
            if (bom.isPresent() && bom.get().getParentBomId() != null) {
                current = bom.get().getParentBomId();
            } else {
                break;
            }
        }
    }

    private void validateNotCircular(Long bomId, Long childBomId) {
        if (bomId.equals(childBomId)) {
            throw new IllegalArgumentException("BOM cannot reference itself as parent.");
        }
        Set<Long> visited = new HashSet<>();
        visited.add(bomId);
        Queue<Long> queue = new LinkedList<>();
        queue.add(childBomId);
        while (!queue.isEmpty()) {
            Long current = queue.poll();
            if (current.equals(bomId)) {
                throw new IllegalArgumentException("Circular BOM detected: " + childBomId + " creates a cycle.");
            }
            if (!visited.add(current)) continue;
            Optional<ProductionBOM> bom = bomRepo.findById(current);
            if (bom.isPresent() && bom.get().getLines() != null) {
                for (ProductionBOMLine line : bom.get().getLines()) {
                    if (line.getChildBomId() != null) queue.add(line.getChildBomId());
                }
            }
        }
    }

    private void applyCreationDefaults(String key, DocEntity e) {
        switch (key) {
            case "production-bom" -> {
                if (e instanceof ProductionBOM bom) {
                    if (bom.getBaseQuantity() == null) bom.setBaseQuantity(BigDecimal.ONE);
                    if (bom.getBaseUom() == null) bom.setBaseUom("PCS");
                    if (bom.getBomVersion() == null) bom.setBomVersion("1.0");
                    if (bom.getEffectiveFrom() == null) bom.setEffectiveFrom(LocalDate.now());
                }
            }
            case "route-sheet" -> {
                if (e instanceof RouteSheet rt) {
                    if (rt.getBaseQuantity() == null) rt.setBaseQuantity(BigDecimal.ONE);
                    if (rt.getBaseUom() == null) rt.setBaseUom("PCS");
                    if (rt.getRouteVersion() == null) rt.setRouteVersion("1.0");
                    if (rt.getEffectiveFrom() == null) rt.setEffectiveFrom(LocalDate.now());
                    if (rt.getRevisionNo() == null) rt.setRevisionNo(0);
                    if (rt.getItemRevision() == null) rt.setItemRevision("Rev 0");
                }
            }
            case "work-order" -> {
                if (e instanceof WorkOrder wo) {
                    if (wo.getPriority() == null) wo.setPriority("MEDIUM");
                    if (wo.getPlannedStartDate() == null) wo.setPlannedStartDate(LocalDate.now());
                    if (wo.getPlannedEndDate() == null) wo.setPlannedEndDate(LocalDate.now().plusDays(14));
                }
            }
            case "shop-floor-entry" -> {}
        }
    }

    private void resolveRouteRefs(RouteSheet route) {
        if (route.getOperations() == null) return;
        for (RouteOperation op : route.getOperations()) {
            if (op.getProcess() != null) {
                if (op.getProcessCode() == null || op.getProcessCode().isBlank()) {
                    op.setProcessCode(op.getProcess().getCode());
                }
                if (op.getResource() == null && op.getProcess().getRequiredResource() != null) {
                    op.setResource(op.getProcess().getRequiredResource());
                }
            }
            if (op.getResource() != null) {
                if (op.getResourceName() == null || op.getResourceName().isBlank()) {
                    op.setResourceName(op.getResource().getResourceName());
                }
                if (op.getResourceType() == null || op.getResourceType().isBlank()) {
                    op.setResourceType(op.getResource().getResourceType());
                }
            }
            if (op.getProcess() != null) {
                if (op.getResource() != null && "Vendor".equalsIgnoreCase(op.getResource().getResourceType())) {
                    op.setProcessType("Outsource");
                } else if (op.getProcessType() == null || op.getProcessType().isBlank()) {
                    op.setProcessType(op.getProcess().getProcessType() != null ? op.getProcess().getProcessType() : "Insource");
                }
            }
        }
    }

    @SuppressWarnings("unchecked")
    private void preResolveRouteLineIds(Map<String, Object> body) {
        Object linesObj = body.get("lines");
        if (!(linesObj instanceof List)) return;
        for (Object lineObj : (List<?>) linesObj) {
            if (!(lineObj instanceof Map)) continue;
            Map<String, Object> line = (Map<String, Object>) lineObj;
            Object processIdVal = line.remove("processId");
            if (processIdVal != null && !String.valueOf(processIdVal).isBlank()) {
                try {
                    Optional<ProcessMaster> p = processRepo.findById(Long.parseLong(String.valueOf(processIdVal)));
                    p.ifPresent(pm -> {
                        line.put("process", pm);
                        line.put("processCode", pm.getCode());
                        if (line.get("resource") == null && pm.getRequiredResource() != null) {
                            line.put("resource", pm.getRequiredResource());
                            line.put("resourceName", pm.getRequiredResource().getResourceName());
                            line.put("resourceType", pm.getRequiredResource().getResourceType());
                        }
                        if (line.get("processType") == null || String.valueOf(line.get("processType")).isBlank()) {
                            line.put("processType", pm.getProcessType());
                        }
                    });
                } catch (Exception ignored) {}
            }
            Object resourceIdVal = line.remove("resourceId");
            if (resourceIdVal != null && !String.valueOf(resourceIdVal).isBlank()) {
                try {
                    Optional<ResourceMaster> r = resourceRepo.findById(Long.parseLong(String.valueOf(resourceIdVal)));
                    r.ifPresent(rm -> {
                        line.put("resource", rm);
                        line.put("resourceName", rm.getResourceName());
                        line.put("resourceType", rm.getResourceType());
                        if ("Vendor".equalsIgnoreCase(rm.getResourceType())) {
                            line.put("processType", "Outsource");
                        }
                    });
                } catch (Exception ignored) {}
            }
        }
    }

    @Transactional
    public DocEntity action(String key, Long id, String action, String note, String user) {
        if ("work-order".equals(key)) {
            return workOrderAction(id, action, note, user);
        }
        if ("route-sheet".equals(key)) {
            return routeSheetAction(id, action, note, user);
        }
        if ("production-bom".equals(key) && "release".equals(action)) {
            return bomReleaseAction(id, note, user);
        }
        DocEntity e = docs.action(key, id, action, note, user);
        postActionHook(key, e, action, user);
        return e;
    }

    @Transactional
    public DocEntity workOrderAction(Long id, String action, String note, String user) {
        WorkOrder wo = (WorkOrder) docs.get("work-order", id);
        String current = wo.getStatus();
        String next;

        switch (action) {
            case "submit" -> {
                requireStatus(current, "DRAFT", "REJECTED");
                next = "SUBMITTED";
            }
            case "approve" -> {
                requireStatus(current, "DRAFT", "SUBMITTED");
                if (wo.getSubmittedBy() != null && !wo.getSubmittedBy().isBlank()) {
                    validateSegregationOfDuty(wo.getSubmittedBy(), user);
                }
                next = "APPROVED";
                wo.setApprovedBy(user);
                // Production Module FRS §7 BR: snapshot at approval, so release can tell
                // whether qty/due date were edited afterward (a deviation).
                wo.setApprovedQuantity(wo.getOrderQuantity());
                wo.setApprovedDueDate(wo.getDueDate());
            }
            case "reject" -> {
                requireStatus(current, "SUBMITTED");
                next = "REJECTED";
            }
            case "reopen" -> {
                requireStatus(current, "REJECTED");
                next = "DRAFT";
            }
            case "release" -> {
                requireStatus(current, "APPROVED");
                validateWoCanRelease(wo);
                // Production Module FRS §7 BR: auto-release only when qty/due date still
                // match what was approved; a deviation since approval needs a Production
                // Supervisor/Plant Head to authorize the release with a reason.
                boolean qtyDeviates = wo.getApprovedQuantity() != null
                        && wo.getOrderQuantity() != null && wo.getApprovedQuantity().compareTo(wo.getOrderQuantity()) != 0;
                boolean dateDeviates = wo.getApprovedDueDate() != null
                        && wo.getDueDate() != null && !wo.getApprovedDueDate().isEqual(wo.getDueDate());
                if (qtyDeviates || dateDeviates) {
                    boolean authorized = note != null && !note.isBlank()
                            && in.zygertechnology.zygererp.security.CurrentUserRoles.hasAnyRole(
                                    "ADMIN", "PRODUCTION_SUPERVISOR", "PLANT_HEAD");
                    if (!authorized) {
                        throw new in.zygertechnology.zygererp.config.BusinessRuleException("RELEASE_DEVIATION",
                                "Order quantity/due date changed since approval (approved: "
                                        + wo.getApprovedQuantity() + " qty, due " + wo.getApprovedDueDate()
                                        + " -> now: " + wo.getOrderQuantity() + " qty, due " + wo.getDueDate()
                                        + "). A Production Supervisor/Plant Head can authorize release with a reason.",
                                Map.of("approvedQuantity", String.valueOf(wo.getApprovedQuantity()),
                                        "currentQuantity", String.valueOf(wo.getOrderQuantity())));
                    }
                }
                next = "RELEASED";
                wo.setReleasedBy(user);
                wo.setReleasedQty(wo.getOrderQuantity());
                // FRS §3.1: AUTO-GEN batch_lot_no on release
                if (wo.getBatchLotNo() == null) {
                    wo.setBatchLotNo("BL-" + wo.getWoNumber() + "-" + System.currentTimeMillis() % 100000);
                }
                // FRS §9.2: set releasedQty = productionQty
                if (wo.getProductionQty() != null) {
                    wo.setReleasedQty(wo.getProductionQty());
                }
                // FRS §10.6: snapshot BOM and Route revision on release
                snapshotBomRouteRevision(wo);
                // Production Module FRS §5.1/§5.2: Release must auto-generate the Job Card
                // (with one subjob per Route operation) — this used to be a separate manual
                // step the user could forget; Draft still creates none, matching the FRS.
                try {
                    Map<String, Object> jcBody = new HashMap<>();
                    jcBody.put("workOrderNumber", wo.getDocNo() != null ? wo.getDocNo() : wo.getWoNumber());
                    java.security.Principal principal = () -> user;
                    productionJobCardService.createFromWorkOrder(jcBody, principal);
                } catch (Exception ex) {
                    throw new IllegalStateException("Failed to auto-generate Job Card on release: " + ex.getMessage(), ex);
                }
            }
            case "start" -> {
                requireStatus(current, "RELEASED", "ON_HOLD");
                next = "IN_PROCESS";
                wo.setActualStartDate(LocalDate.now());
                wo.setStartedBy(user);
                wo.setStartedAt(Instant.now());
            }
            case "complete" -> {
                requireStatus(current, "IN_PROCESS");
                next = "COMPLETED";
                wo.setActualEndDate(LocalDate.now());
                wo.setCompletedBy(user);
                wo.setCompletedAt(Instant.now());
                // FRS §12.24: completedQty = productionQty unless short close
                if (wo.getCompletedQty() == null || wo.getCompletedQty().compareTo(BigDecimal.ZERO) == 0) {
                    wo.setCompletedQty(wo.getProductionQty() != null ? wo.getProductionQty() : wo.getOrderQuantity());
                }
                recomputeWoBalanceQty(wo);
            }
            case "close" -> {
                requireStatus(current, "COMPLETED");
                next = "CLOSED";
                wo.setClosedBy(user);
                wo.setClosedAt(Instant.now());
            }
            case "hold" -> {
                requireStatus(current, "RELEASED", "IN_PROCESS");
                next = "ON_HOLD";
                if (note == null || note.isBlank()) {
                    throw new IllegalArgumentException("Hold reason is mandatory.");
                }
                wo.setHoldReason(note);
            }
            case "cancel" -> {
                requireStatus(current, "DRAFT", "SUBMITTED", "APPROVED");
                next = "CANCELLED";
                if (note != null && !note.isBlank()) {
                    wo.setCancelReason(note);
                }
                // FRS §6.3: recompute pending_qty on SO item
                recomputeSOPendingQty(wo);
            }
            case "shortClose" -> {
                // FRS v4.0 §6.3.7: Short Close RELEASED/IN_PROCESS/ON_HOLD -> CLOSED
                requireStatus(current, "RELEASED", "IN_PROCESS", "ON_HOLD");
                if (note == null || note.isBlank()) {
                    throw new IllegalArgumentException("Short Close Reason is mandatory.");
                }
                next = "CLOSED";
                wo.setShortCloseReason(note);
                wo.setClosedBy(user);
                wo.setClosedAt(Instant.now());
                // If not yet started, set actual dates
                if (wo.getActualStartDate() == null) {
                    wo.setActualStartDate(LocalDate.now());
                    wo.setStartedBy(user);
                    wo.setStartedAt(Instant.now());
                }
                if (wo.getActualEndDate() == null) {
                    wo.setActualEndDate(LocalDate.now());
                }
                // Set completed qty to whatever was produced so far
                if (wo.getCompletedQty() == null || wo.getCompletedQty().compareTo(BigDecimal.ZERO) == 0) {
                    wo.setCompletedQty(wo.getProductionQty() != null ? wo.getProductionQty() : wo.getOrderQuantity());
                }
                recomputeWoBalanceQty(wo);
                recomputeSOPendingQty(wo);
            }
            default -> throw new IllegalArgumentException("Unknown action: " + action);
        }

        String previousStatus = wo.getStatus();
        wo.setStatus(next);
        wo.setUpdatedAt(Instant.now());

        // FRS §19.3: record status history (WO-specific + generic)
        recordStatusHistory(wo, previousStatus, next, note, user);
        recordStatusChange("work-order", wo.getId(), wo.getWoNumber(), previousStatus, next, note, user);

        return wo;
    }

    // ═══════════════════════════════════════════════════════════════
    // FRS Route Sheet Action Handler
    // ═══════════════════════════════════════════════════════════════

    @Transactional
    public DocEntity routeSheetAction(Long id, String action, String note, String user) {
        RouteSheet rs = (RouteSheet) docs.get("route-sheet", id);
        String current = rs.getStatus();
        String next;

        switch (action) {
            case "release" -> {
                requireStatus(current, "DRAFT");
                // V-R3: at least one detail row before release
                if (rs.getOperations() == null || rs.getOperations().isEmpty()) {
                    throw new IllegalStateException("At least one detail row is required before releasing.");
                }
                // V-R1: one released per item
                long releasedCount = routeRepo.countByItemCodeAndStatus(rs.getItemCode(), "RELEASED");
                if (releasedCount > 0) {
                    throw new IllegalStateException("A Released Route Sheet already exists for item: " + rs.getItemCode());
                }
                // V-R2: validate sequence uniqueness
                validateSequenceUniqueness(rs);
                // V-R4: validate setup/cycle times >= 0
                validateOperationTimes(rs);
                // V-R5: validate all referenced processes are active
                for (RouteOperation op : rs.getOperations()) {
                    if (op.getProcess() != null && !op.getProcess().isActive()) {
                        throw new IllegalStateException("Process is not active: " + op.getProcess().getName());
                    }
                }
                next = "RELEASED";
                rs.setApprovedBy(user);
                rs.setApprovedAt(Instant.now());
            }
            case "revise" -> {
                requireStatus(current, "RELEASED");
                if (note == null || note.isBlank()) {
                    throw new IllegalArgumentException("Remarks are mandatory for a new revision.");
                }
                // Create new revision: clone header + lines
                RouteSheet newRs = createRouteSheetRevision(rs, note, user);
                // Mark old as UNDER_REVISION
                rs.setStatus("UNDER_REVISION");
                rs.setUpdatedAt(Instant.now());
                recordStatusChange("route-sheet", rs.getId(), rs.getRouteNumber(), current, "UNDER_REVISION", note, user);
                return newRs;
            }
            case "obsolete" -> {
                requireStatus(current, "RELEASED", "UNDER_REVISION");
                next = "OBSOLETE";
            }
            default -> throw new IllegalArgumentException("Unknown route-sheet action: " + action);
        }

        String previousStatus = rs.getStatus();
        rs.setStatus(next);
        rs.setUpdatedAt(Instant.now());
        recordStatusChange("route-sheet", rs.getId(), rs.getRouteNumber(), current, next, note, user);
        return rs;
    }

    private void validateSequenceUniqueness(RouteSheet rs) {
        if (rs.getOperations() == null) return;
        java.util.Set<Integer> seqs = new java.util.HashSet<>();
        for (RouteOperation op : rs.getOperations()) {
            if (op.getSequenceNo() == null) continue;
            if (!seqs.add(op.getSequenceNo())) {
                throw new IllegalArgumentException("Duplicate sequence number: " + op.getSequenceNo());
            }
        }
    }

    private void validateOperationTimes(RouteSheet rs) {
        if (rs.getOperations() == null) return;
        for (RouteOperation op : rs.getOperations()) {
            if (op.getSetupTime() != null && op.getSetupTime().compareTo(BigDecimal.ZERO) < 0) {
                throw new IllegalArgumentException("Setup time cannot be negative at sequence " + op.getSequenceNo());
            }
            if (op.getCycleTime() != null && op.getCycleTime().compareTo(BigDecimal.ZERO) < 0) {
                throw new IllegalArgumentException("Cycle time cannot be negative at sequence " + op.getSequenceNo());
            }
        }
    }

    private RouteSheet createRouteSheetRevision(RouteSheet source, String remarks, String user) {
        RouteSheet newRs = new RouteSheet();
        newRs.setItemCode(source.getItemCode());
        newRs.setItemType(source.getItemType());
        newRs.setDescription(source.getDescription());
        newRs.setBaseQuantity(source.getBaseQuantity());
        newRs.setBaseUom(source.getBaseUom());
        newRs.setEffectiveFrom(LocalDate.now());
        newRs.setStatus("DRAFT");
        // Bump revision
        int newRev = (source.getRevisionNo() != null ? source.getRevisionNo() : 0) + 1;
        newRs.setRevisionNo(newRev);
        newRs.setItemRevision("Rev " + newRev);
        newRs.setRouteVersion("Rev " + newRev);
        newRs.setRemarks(remarks);
        newRs.setCreatedBy(user);
        newRs.setCreatedAt(Instant.now());
        // Save first to get ID
        routeRepo.save(newRs);
        routeRepo.flush();
        // Clone operations
        if (source.getOperations() != null) {
            for (RouteOperation srcOp : source.getOperations()) {
                RouteOperation newOp = new RouteOperation();
                newOp.setDoc(newRs);
                newOp.setSequenceNo(srcOp.getSequenceNo());
                newOp.setProcess(srcOp.getProcess());
                newOp.setProcessCode(srcOp.getProcessCode());
                newOp.setResource(srcOp.getResource());
                newOp.setResourceName(srcOp.getResourceName());
                newOp.setResourceType(srcOp.getResourceType());
                newOp.setProcessType(srcOp.getProcessType());
                newOp.setSetupTime(srcOp.getSetupTime());
                newOp.setCycleTime(srcOp.getCycleTime());
                newOp.setInspectionRequired(srcOp.isInspectionRequired());
                newOp.setRemarks(srcOp.getRemarks());
                newRs.getOperations().add(newOp);
            }
        }
        routeRepo.save(newRs);
        return newRs;
    }

    // ═══════════════════════════════════════════════════════════════
    // FRS BOM Release Action
    // ═══════════════════════════════════════════════════════════════

    @Transactional
    public DocEntity bomReleaseAction(Long id, String note, String user) {
        ProductionBOM bom = (ProductionBOM) docs.get("production-bom", id);
        String current = bom.getStatus();
        requireStatus(current, "DRAFT");

        // FRS v4.0 §3 §0: Auto-derive itemType from ItemMaster if not set
        autoDeriveBomItemType(bom);

        // FRS v4.0 X-06: only one APPROVED + Primary BOM per (Item Code) at a time
        if ("Primary".equalsIgnoreCase(bom.getBomType()) || bom.getBomType() == null) {
            if (bom.getSalesOrderId() == null) {
                long approvedCount = bomRepo.countByItemCodeAndStatusAndBomTypeAndIdNot(
                    bom.getItemCode(), "APPROVED", "Primary", id);
                if (approvedCount > 0) {
                    throw new IllegalStateException("An Approved Primary BOM already exists for item: " + bom.getItemCode()
                        + ". Only one Approved Primary BOM is allowed per item.");
                }
            } else {
                long approvedSoCount = bomRepo.countByItemCodeAndSalesOrderIdAndStatusAndIdNot(
                    bom.getItemCode(), bom.getSalesOrderId(), "APPROVED", id);
                if (approvedSoCount > 0) {
                    throw new IllegalStateException("An Approved BOM already exists for this Item and Sales Order.");
                }
            }
        }

        // V-20: at least one component required
        List<ProductionBOMLine> activeLines = bom.getLines().stream()
            .filter(l -> !Boolean.TRUE.equals(l.getIsDeleted()))
            .toList();
        if (activeLines.isEmpty()) {
            throw new IllegalStateException("At least one component is required.");
        }
        // V-07/V-16: no self-references
        for (ProductionBOMLine line : activeLines) {
            if (bom.getItemCode().equals(line.getComponentItemCode())) {
                throw new IllegalStateException("Parent item and component item cannot be same.");
            }
        }
        // V-09: no duplicate components
        Set<String> seenComponents = new HashSet<>();
        for (ProductionBOMLine line : activeLines) {
            String compCode = line.getComponentItemCode();
            if (compCode != null && !seenComponents.add(compCode)) {
                throw new IllegalArgumentException("Duplicate component item is not allowed: " + compCode);
            }
        }
        // Validate quantities > 0
        if (bom.getBaseQuantity() != null && bom.getBaseQuantity().compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("Quantity should be greater than zero.");
        }
        for (ProductionBOMLine line : activeLines) {
            if (line.getQuantityPer() != null && line.getQuantityPer().compareTo(BigDecimal.ZERO) <= 0) {
                throw new IllegalArgumentException("Component quantity must be greater than zero.");
            }
        }
        bom.setStatus("APPROVED");
        bom.setIsActive(true);
        bom.setApprovedBy(user);
        bom.setApprovedAt(Instant.now());
        bom.setReleaseDate(LocalDate.now());
        recomputeBomWeights(bom);
        recordStatusChange("production-bom", bom.getId(), bom.getBomNumber(), current, "APPROVED", note, user);
        return bom;
    }

    /** FRS v4.0 Changelog #4, #9: Auto-derive BOM itemType, description from ItemMaster if not explicitly provided */
    private void autoDeriveBomItemType(ProductionBOM bom) {
        if (bom.getItemCode() == null || bom.getItemCode().isBlank()) return;
        try {
            List<?> items = em.createQuery(
                "SELECT i FROM ItemMaster i WHERE i.code = :code")
                .setParameter("code", bom.getItemCode()).setMaxResults(1).getResultList();
            if (!items.isEmpty()) {
                ItemMaster item = (ItemMaster) items.get(0);
                if (bom.getItemType() == null || bom.getItemType().isBlank()) {
                    String derived = null;
                    if (item.getItemGroup() != null && item.getItemGroup().getItemType() != null) {
                        derived = normalizeBomType(item.getItemGroup().getItemType());
                    }
                    if (derived == null && item.getItemType() != null) {
                        derived = normalizeBomType(item.getItemType());
                    }
                    if (derived != null) bom.setItemType(derived);
                }
                if (item.getDescription() != null && (bom.getDescription() == null || bom.getDescription().isBlank())) {
                    bom.setDescription(item.getDescription());
                }
                if (item.getRevision() != null && (bom.getItemRevision() == null || bom.getItemRevision().isBlank())) {
                    bom.setItemRevision(item.getRevision());
                }
            }
        } catch (Exception ignored) {}
    }

    private String normalizeBomType(String raw) {
        String t = raw == null ? "" : raw.trim().toUpperCase().replace("-", "_").replace(" ", "_");
        if (t.equals("SEMI_FG") || t.equals("SFG") || t.contains("SEMI")) return "SEMI_FG";
        if (t.equals("FG") || t.equals("FINISHED") || t.equals("FINISHED_GOODS")
                || (t.contains("FINISHED") && !t.contains("SEMI"))
                || t.equals("MANUFACTURING") || t.equals("MANUFACTURING_ITEM")) return "FG";
        if (t.equals("RM") || t.equals("RAW_MATERIAL") || t.contains("RAW")) return "RAW_MATERIAL";
        return null;
    }

    /** FRS v4.0 §3 §0: Auto-derive WO item fields from ItemMaster */
    private void autoDeriveWoItemFields(WorkOrder wo) {
        if (wo.getItemCode() == null || wo.getItemCode().isBlank()) return;
        try {
            List<?> items = em.createQuery(
                "SELECT i FROM ItemMaster i WHERE i.code = :code")
                .setParameter("code", wo.getItemCode()).setMaxResults(1).getResultList();
            if (!items.isEmpty()) {
                ItemMaster item = (ItemMaster) items.get(0);
                if (item.getDescription() != null) wo.setItemDescription(item.getDescription());
                if (item.getRevision() != null && (wo.getItemRevision() == null || wo.getItemRevision().isBlank())) {
                    wo.setItemRevision(item.getRevision());
                }
                if (item.getDrawingNumber() != null && (wo.getDrawingNumber() == null || wo.getDrawingNumber().isBlank())) {
                    wo.setDrawingNumber(item.getDrawingNumber());
                }
                if (item.getDrawingRevision() != null && (wo.getDrawingRev() == null || wo.getDrawingRev().isBlank())) {
                    wo.setDrawingRev(item.getDrawingRevision());
                }
                if (item.getUom() != null && (wo.getUom() == null || wo.getUom().isBlank())) wo.setUom(item.getUom());
            }
        } catch (Exception ignored) {}
    }

    /** FRS v4.0 §3: Segregation of duties — approver cannot be the submitter */
    private void validateSegregationOfDuty(String submitter, String approver) {
        if (submitter != null && submitter.equals(approver)) {
            throw new IllegalStateException("Segregation of duty violation: the submitter cannot also approve this document.");
        }
    }

    /** FRS §10.6/§11.5: Snapshot BOM and Route revision on release */
    private void snapshotBomRouteRevision(WorkOrder wo) {
        if (wo.getBomId() != null && wo.getBomRevision() == null) {
            try {
                var bomOpt = bomRepo.findById(wo.getBomId());
                if (bomOpt.isPresent()) {
                    ProductionBOM bom = bomOpt.get();
                    wo.setBomRevision(bom.getBomVersion());
                    wo.setBomCode(bom.getBomNumber());
                }
            } catch (Exception ignored) {}
        }
        if (wo.getRouteId() != null && wo.getRouteRevision() == null) {
            try {
                var routeOpt = routeRepo.findById(wo.getRouteId());
                if (routeOpt.isPresent()) {
                    RouteSheet route = routeOpt.get();
                    wo.setRouteRevision(route.getRouteVersion());
                    wo.setRouteSheetCode(route.getRouteNumber());
                }
            } catch (Exception ignored) {}
        }
    }

    /** FRS §19.3: Record status change in work_order_status_history */
    private void recordStatusHistory(WorkOrder wo, String fromStatus, String toStatus, String reason, String user) {
        in.zygertechnology.zygererp.entity.WorkOrderStatusHistory history =
                new in.zygertechnology.zygererp.entity.WorkOrderStatusHistory();
        history.setWorkOrderId(wo.getId());
        history.setWoNumber(wo.getWoNumber());
        history.setFromStatus(fromStatus);
        history.setToStatus(toStatus);
        history.setReason(reason);
        history.setCreatedBy(user);
        history.setCreatedAt(Instant.now());
        woStatusHistoryRepo.save(history);
    }

    private void requireStatus(String current, String... allowed) {
        for (String s : allowed) if (s.equals(current)) return;
        throw new IllegalStateException("Action not allowed in status " + current + ". Required: " + Arrays.toString(allowed));
    }

    // FRS §6: Work Order creation validations (V1-V6)
    private void validateWorkOrderBeforeCreate(Map<String, Object> body) {
        // V1: Sales Order is mandatory
        if (body.get("salesOrderId") == null && body.get("sourceDocNo") == null) {
            throw new IllegalArgumentException("Sales Order is mandatory.");
        }
        // V2: Production Qty is mandatory
        BigDecimal prodQty = body.containsKey("productionQty") && body.get("productionQty") != null
            ? new BigDecimal(String.valueOf(body.get("productionQty")))
            : (body.containsKey("orderQuantity") && body.get("orderQuantity") != null
                ? new BigDecimal(String.valueOf(body.get("orderQuantity"))) : null);
        if (prodQty == null || prodQty.signum() <= 0) {
            throw new IllegalArgumentException("Production Quantity is mandatory.");
        }
        // V6: Planned End Date > Start Date
        if (body.containsKey("plannedStartDate") && body.containsKey("plannedEndDate")) {
            String start = String.valueOf(body.getOrDefault("plannedStartDate", ""));
            String end = String.valueOf(body.getOrDefault("plannedEndDate", ""));
            if (!start.isEmpty() && !end.isEmpty()) {
                LocalDate sd = LocalDate.parse(start.substring(0, 10));
                LocalDate ed = LocalDate.parse(end.substring(0, 10));
                if (!ed.isAfter(sd)) {
                    throw new IllegalArgumentException("Planned End Date should be greater than Planned Start Date.");
                }
            }
        }
    }

    private void validateWoCanRelease(WorkOrder wo) {
        // V4: Active BOM must exist for item_code
        if (wo.getBomId() == null && wo.getItemCode() != null) {
            List<?> activeBoms = em.createQuery(
                "SELECT b.id FROM ProductionBOM b WHERE b.itemCode = :itemCode AND b.status = 'APPROVED'")
                .setParameter("itemCode", wo.getItemCode()).setMaxResults(1).getResultList();
            if (activeBoms.isEmpty()) {
                throw new IllegalStateException("Active BOM not found for item: " + wo.getItemCode());
            }
        }
        if (wo.getBomId() != null) {
            Optional<ProductionBOM> bom = bomRepo.findById(wo.getBomId());
            if (bom.isPresent() && !"APPROVED".equals(bom.get().getStatus())) {
                throw new IllegalStateException("BOM must be APPROVED before releasing Work Order.");
            }
        }
        // V5: Active Route Sheet must exist for item_code (route sheets use RELEASED status)
        if (wo.getRouteId() == null && wo.getItemCode() != null) {
            List<?> activeRoutes = em.createQuery(
                "SELECT r.id FROM RouteSheet r WHERE r.itemCode = :itemCode AND r.status = 'RELEASED'")
                .setParameter("itemCode", wo.getItemCode()).setMaxResults(1).getResultList();
            if (activeRoutes.isEmpty()) {
                throw new IllegalStateException("Active Route Sheet not found for item: " + wo.getItemCode());
            }
        }
        if (wo.getRouteId() != null) {
            Optional<RouteSheet> route = routeRepo.findById(wo.getRouteId());
            if (route.isPresent() && !"RELEASED".equals(route.get().getStatus())) {
                throw new IllegalStateException("Route Sheet must be RELEASED before releasing Work Order.");
            }
        }
    }

    private void postActionHook(String key, DocEntity e, String action, String user) {
        if ("approve".equals(action)) {
            switch (key) {
                case "work-order" -> {
                    if (e instanceof WorkOrder wo) {
                        wo.setApprovedBy(user);
                    }
                }
                default -> {}
            }
        }
        // FRS §6.6: When a Shop Floor Entry is posted, update parent WO operation quantities
        if ("post".equals(action) && "shop-floor-entry".equals(key) && e instanceof ShopFloorEntry sfe) {
            updateWorkOrderFromShopFloor(sfe);
        }
    }

    /**
     * FRS §6.6: Accumulate posted Shop Floor Entry quantities into the parent WorkOrderOperation
     * and recompute parent WO aggregated quantities.
     */
    private void updateWorkOrderFromShopFloor(ShopFloorEntry sfe) {
        if (sfe.getWorkOrderNo() == null || sfe.getOperationSequence() == null) return;
        // Find WorkOrder by woNumber
        List<?> woResults = em.createQuery("SELECT w FROM WorkOrder w WHERE w.woNumber = :woNo")
                .setParameter("woNo", sfe.getWorkOrderNo()).getResultList();
        if (woResults.isEmpty()) return;
        WorkOrder wo = (WorkOrder) woResults.get(0);

        // Find matching WorkOrderOperation by operationSequence
        WorkOrderOperation targetOp = null;
        if (wo.getLines() != null) {
            for (Object lineObj : wo.getLines()) {
                if (lineObj instanceof WorkOrderOperation woOp) {
                    if (woOp.getOperationSequence() != null && woOp.getOperationSequence().equals(sfe.getOperationSequence())) {
                        targetOp = woOp;
                        break;
                    }
                }
            }
        }
        if (targetOp == null) return;

        BigDecimal goodQty = sfe.getGoodQuantity() != null ? sfe.getGoodQuantity() : BigDecimal.ZERO;
        BigDecimal scrapQty = sfe.getScrapQuantity() != null ? sfe.getScrapQuantity() : BigDecimal.ZERO;
        BigDecimal reworkQty = sfe.getReworkQuantity() != null ? sfe.getReworkQuantity() : BigDecimal.ZERO;

        // Accumulate quantities on the operation
        targetOp.setCompletedQuantity(nvl(targetOp.getCompletedQuantity()).add(goodQty).add(scrapQty).add(reworkQty));
        targetOp.setGoodQuantity(nvl(targetOp.getGoodQuantity()).add(goodQty));
        targetOp.setScrapQuantity(nvl(targetOp.getScrapQuantity()).add(scrapQty));
        targetOp.setReworkQuantity(nvl(targetOp.getReworkQuantity()).add(reworkQty));
        em.merge(targetOp);

        // Recompute parent WO aggregated quantities
        BigDecimal totalCompleted = BigDecimal.ZERO;
        BigDecimal totalGood = BigDecimal.ZERO;
        BigDecimal totalScrap = BigDecimal.ZERO;
        BigDecimal totalRework = BigDecimal.ZERO;
        if (wo.getLines() != null) {
            for (Object lineObj : wo.getLines()) {
                if (lineObj instanceof WorkOrderOperation op) {
                    totalCompleted = totalCompleted.add(nvl(op.getCompletedQuantity()));
                    totalGood = totalGood.add(nvl(op.getGoodQuantity()));
                    totalScrap = totalScrap.add(nvl(op.getScrapQuantity()));
                    totalRework = totalRework.add(nvl(op.getReworkQuantity()));
                }
            }
        }
        wo.setCompletedQty(totalGood);
        wo.setScrapQty(totalScrap);
        recomputeWoBalanceQty(wo);
        em.merge(wo);
    }

    private static BigDecimal nvl(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }

    /** FRS §10.1: Record status transition for any planning document. */
    private void recordStatusChange(String docType, Long docId, String docNumber, String fromStatus, String toStatus, String reason, String user) {
        DocStatusHistory h = new DocStatusHistory();
        h.setDocType(docType);
        h.setDocId(docId);
        h.setDocNumber(docNumber);
        h.setFromStatus(fromStatus);
        h.setToStatus(toStatus);
        h.setReason(reason);
        h.setCreatedBy(user);
        docStatusHistoryRepo.save(h);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> getDocStatusHistory(String docType, Long docId) {
        List<DocStatusHistory> history = docStatusHistoryRepo.findByDocTypeAndDocIdOrderByCreatedAtAsc(docType, docId);
        List<Map<String, Object>> result = new ArrayList<>();
        for (var h : history) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", h.getId());
            row.put("docType", h.getDocType());
            row.put("docId", h.getDocId());
            row.put("fromStatus", h.getFromStatus());
            row.put("toStatus", h.getToStatus());
            row.put("reason", h.getReason());
            row.put("createdBy", h.getCreatedBy());
            row.put("createdAt", h.getCreatedAt() != null ? h.getCreatedAt().toString() : null);
            result.add(row);
        }
        return result;
    }

    // FRS §6.3: recompute SalesOrderItem.pending_qty after WO cancel
    private void recomputeSOPendingQty(WorkOrder wo) {
        if (wo.getSalesOrderId() == null) return;
        try {
            List<?> results = em.createQuery(
                "SELECT COALESCE(SUM(CASE WHEN wo.orderQuantity IS NOT NULL THEN wo.orderQuantity ELSE COALESCE(wo.productionQty, BigDecimal.ZERO) END), 0) FROM WorkOrder wo WHERE wo.salesOrderId = :soId AND wo.status NOT IN ('CANCELLED', 'REJECTED')")
                .setParameter("soId", wo.getSalesOrderId())
                .getResultList();
            BigDecimal totalCommitted = results.isEmpty() ? BigDecimal.ZERO : (BigDecimal) results.get(0);

            SalesOrder so = em.find(SalesOrder.class, wo.getSalesOrderId());
            if (so != null && so.getLines() != null) {
                for (SalesOrderItem item : so.getLines()) {
                    BigDecimal orderQty = item.getOrderQty() != null ? item.getOrderQty() : BigDecimal.ZERO;
                    BigDecimal pending = orderQty.subtract(totalCommitted);
                    item.setPendingQty(pending.max(BigDecimal.ZERO));
                }
                em.merge(so);
            }
        } catch (Exception ignored) {
        }
    }

    /** FRS §4.5: Compute weightPerQty from ItemMaster, totalWeight per line, and parent BOM weight. */
    private void recomputeBomWeights(ProductionBOM bom) {
        if (bom.getLines() == null || bom.getLines().isEmpty()) {
            if (bom.getWeight() == null) bom.setWeight(BigDecimal.ZERO);
            return;
        }
        BigDecimal totalWeight = BigDecimal.ZERO;
        for (ProductionBOMLine line : bom.getLines()) {
            if (line.getWeightPerQty() == null && line.getComponentItemCode() != null) {
                try {
                    List<?> items = em.createQuery("SELECT i.weight FROM ItemMaster i WHERE i.code = :code")
                        .setParameter("code", line.getComponentItemCode()).setMaxResults(1).getResultList();
                    if (!items.isEmpty() && items.get(0) != null) {
                        line.setWeightPerQty((BigDecimal) items.get(0));
                    }
                } catch (Exception ignored) {}
            }
            BigDecimal qty = line.getQuantityPer() == null ? BigDecimal.ZERO : line.getQuantityPer();
            BigDecimal wpq = line.getWeightPerQty() == null ? BigDecimal.ZERO : line.getWeightPerQty();
            line.setTotalWeight(qty.multiply(wpq));
            totalWeight = totalWeight.add(line.getTotalWeight());
        }
        if (totalWeight.compareTo(BigDecimal.ZERO) > 0 || bom.getWeight() == null) {
            bom.setWeight(totalWeight);
        }
    }

    /** FRS §4.7: Tamper prevention — recompute derived fields on RouteOperation from ProcessMaster/ResourceMaster. */
    private void recomputeRouteDerivedFields(RouteSheet route) {
        if (route.getItemCode() != null && !route.getItemCode().isBlank()) {
            List<?> items = em.createQuery("SELECT i FROM ItemMaster i WHERE i.code = :code")
                    .setParameter("code", route.getItemCode())
                    .getResultList();
            if (!items.isEmpty() && items.get(0) instanceof ItemMaster item) {
                String desc = item.getDescription() != null ? item.getDescription().toLowerCase() : "";
                String name = item.getName() != null ? item.getName().toLowerCase() : "";
                String code = item.getCode() != null ? item.getCode().toLowerCase() : "";
                if (desc.contains("wheel") || name.contains("wheel") || code.contains("wheel") || "CUSTOMER_SUPPLIED".equalsIgnoreCase(item.getItemType())) {
                    route.setItemType("SEMI_FG");
                } else if (route.getItemType() == null || route.getItemType().isBlank()) {
                    route.setItemType(item.getItemType());
                }
            }
        }
        if (route.getOperations() == null) return;
        for (RouteOperation op : route.getOperations()) {
            if (op.getProcess() != null) {
                ProcessMaster pm = em.find(ProcessMaster.class, op.getProcess().getId());
                if (pm != null) {
                    // FRS §3.3: derived process_code from ProcessMaster
                    op.setProcessCode(pm.getCode());
                    if (pm.getResourceName() != null) op.setResourceName(pm.getResourceName());
                    if (pm.getResourceType() != null) op.setResourceType(pm.getResourceType());
                    if (pm.getProcessType() != null) op.setProcessType(pm.getProcessType());
                    if (pm.getCycleTime() != null && (op.getCycleTime() == null || op.getCycleTime().signum() == 0))
                        op.setCycleTime(pm.getCycleTime());
                    if (pm.getSetupTime() != null && (op.getSetupTime() == null || op.getSetupTime().signum() == 0))
                        op.setSetupTime(pm.getSetupTime());
                }
            }
            if (op.getResource() != null) {
                ResourceMaster res = em.find(ResourceMaster.class, op.getResource().getId());
                if (res != null) {
                    op.setResourceName(res.getResourceName());
                    op.setResourceType(res.getResourceType());
                }
            }
            op.setStandardCostRate(null);
            if (op.getResource() != null && op.getResource().getHourlyRate() != null && op.getCycleTime() != null) {
                BigDecimal cycleHours = op.getCycleTime().divide(BigDecimal.valueOf(60), 4, RoundingMode.HALF_UP);
                op.setStandardCostRate(op.getResource().getHourlyRate().multiply(cycleHours));
            }
        }
    }

    /** FRS §3.3: Compute total_setup_time, total_cycle_time, total_run_time on RouteSheet header. */
    private void recomputeRouteTotals(RouteSheet route) {
        if (route.getOperations() == null || route.getOperations().isEmpty()) {
            route.setTotalSetupTime(BigDecimal.ZERO);
            route.setTotalCycleTime(BigDecimal.ZERO);
            route.setTotalRunTime(BigDecimal.ZERO);
            return;
        }
        BigDecimal totalSetup = BigDecimal.ZERO;
        BigDecimal totalCycle = BigDecimal.ZERO;
        BigDecimal totalRun = BigDecimal.ZERO;
        BigDecimal baseQty = route.getBaseQuantity() == null ? BigDecimal.ONE : route.getBaseQuantity();
        for (RouteOperation op : route.getOperations()) {
            totalSetup = totalSetup.add(op.getSetupTime() != null ? op.getSetupTime() : BigDecimal.ZERO);
            totalCycle = totalCycle.add(op.getCycleTime() != null ? op.getCycleTime() : BigDecimal.ZERO);
            BigDecimal setup = op.getSetupTime() != null ? op.getSetupTime() : BigDecimal.ZERO;
            BigDecimal cycle = op.getCycleTime() != null ? op.getCycleTime() : BigDecimal.ZERO;
            totalRun = totalRun.add(setup.add(cycle.multiply(baseQty)));
        }
        route.setTotalSetupTime(totalSetup);
        route.setTotalCycleTime(totalCycle);
        route.setTotalRunTime(totalRun);
    }

    /** FRS §3.2: Compute totalMaterialCost on BOM = Σ(component defaultRate × netQty). */
    private void recomputeBomTotalMaterialCost(ProductionBOM bom) {
        if (bom.getLines() == null || bom.getLines().isEmpty()) {
            bom.setTotalMaterialCost(BigDecimal.ZERO);
            return;
        }
        BigDecimal total = BigDecimal.ZERO;
        for (ProductionBOMLine line : bom.getLines()) {
            if (line.getComponentItemCode() != null && line.getQuantityPer() != null) {
                try {
                    List<?> rates = em.createQuery(
                        "SELECT COALESCE(i.defaultRate, 0) FROM ItemMaster i WHERE i.code = :code")
                        .setParameter("code", line.getComponentItemCode()).setMaxResults(1).getResultList();
                    BigDecimal rate = rates.isEmpty() ? BigDecimal.ZERO : (BigDecimal) rates.get(0);
                    BigDecimal scrap = line.getScrapPercent() != null ? line.getScrapPercent() : BigDecimal.ZERO;
                    BigDecimal netQty = line.getQuantityPer().multiply(BigDecimal.ONE.add(scrap.divide(BigDecimal.valueOf(100), 6, RoundingMode.HALF_UP)));
                    total = total.add(rate.multiply(netQty));
                } catch (Exception ignored) {}
            }
        }
        bom.setTotalMaterialCost(total);
    }

    /** FRS §3.1: Compute balance_qty = orderQuantity - completedQty - rejectedQty. */
    private void recomputeWoBalanceQty(WorkOrder wo) {
        BigDecimal order = wo.getOrderQuantity() != null ? wo.getOrderQuantity() : BigDecimal.ZERO;
        BigDecimal completed = wo.getCompletedQty() != null ? wo.getCompletedQty() : BigDecimal.ZERO;
        BigDecimal rejected = wo.getRejectedQty() != null ? wo.getRejectedQty() : BigDecimal.ZERO;
        wo.setBalanceQty(order.subtract(completed).subtract(rejected));
        // FRS §3.2: recompute material balance_qty = required_qty - issued_qty
        if (wo.getMaterials() != null) {
            for (WorkOrderMaterial mat : wo.getMaterials()) {
                BigDecimal req = mat.getRequiredQuantity() != null ? mat.getRequiredQuantity() : BigDecimal.ZERO;
                BigDecimal issued = mat.getIssuedQuantity() != null ? mat.getIssuedQuantity() : BigDecimal.ZERO;
                mat.setBalanceQty(req.subtract(issued));
            }
        }
    }

    /** FRS §3.3: Compute derived summary for work order process lines. */
    @Transactional(readOnly = true)
    public Map<String, Object> getWorkOrderSummary(Long workOrderId) {
        WorkOrder wo = (WorkOrder) docs.get("work-order", workOrderId);
        BigDecimal totalSetupTime = BigDecimal.ZERO;
        BigDecimal totalCycleTimePerUnit = BigDecimal.ZERO;
        BigDecimal productionQty = wo.getProductionQty() != null ? wo.getProductionQty() : BigDecimal.ZERO;

        if (wo.getOperations() != null) {
            for (WorkOrderOperation op : wo.getOperations()) {
                totalSetupTime = totalSetupTime.add(op.getSetupTimePlanned() != null ? op.getSetupTimePlanned() : BigDecimal.ZERO);
                totalCycleTimePerUnit = totalCycleTimePerUnit.add(op.getCycleTimePlanned() != null ? op.getCycleTimePlanned() : BigDecimal.ZERO);
            }
        }
        BigDecimal totalProductionTimeMin = totalSetupTime.add(totalCycleTimePerUnit.multiply(productionQty));
        BigDecimal totalProductionTimeHrs = totalProductionTimeMin.divide(BigDecimal.valueOf(60), 2, RoundingMode.HALF_UP);

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("totalSetupTimeMin", totalSetupTime);
        summary.put("totalCycleTimePerUnitMin", totalCycleTimePerUnit);
        summary.put("totalProductionTimeMin", totalProductionTimeMin);
        summary.put("totalProductionTimeHrs", totalProductionTimeHrs);
        summary.put("materialLineCount", wo.getMaterials() != null ? wo.getMaterials().size() : 0);
        summary.put("processLineCount", wo.getOperations() != null ? wo.getOperations().size() : 0);
        return summary;
    }

    /** FRS §4.4: Create new BOM revision from existing. */
    @Transactional
    public ProductionBOM createBomRevision(Long sourceBomId, String newVersion, String remarks, String user) {
        ProductionBOM source = (ProductionBOM) docs.get("production-bom", sourceBomId);
        if (source == null) throw new IllegalArgumentException("Source BOM not found: " + sourceBomId);

        // V-27: remarks mandatory for new revision
        if (remarks == null || remarks.isBlank()) {
            throw new IllegalArgumentException("Remarks are mandatory for a new revision.");
        }

        // Deactivate old revision
        source.setIsActive(false);
        source.setUpdatedAt(Instant.now());
        bomRepo.save(source);

        ProductionBOM newBom = new ProductionBOM();
        // FRS §3.4: bom_code carries revision suffix
        String baseCode = source.getBomNumber() != null ? source.getBomNumber() : "BOM-NEW";
        newBom.setBomNumber(baseCode + "/R" + (source.getRevisionNo() != null ? source.getRevisionNo() + 1 : 1));
        newBom.setItemCode(source.getItemCode());
        newBom.setItemRevision(source.getItemRevision());
        newBom.setBomVersion(newVersion);
        newBom.setDescription(source.getDescription());
        newBom.setSpecifications(source.getSpecifications());
        newBom.setBaseQuantity(source.getBaseQuantity());
        newBom.setBaseUom(source.getBaseUom());
        newBom.setItemType(source.getItemType());
        newBom.setSalesOrderId(source.getSalesOrderId());
        newBom.setBomType(source.getBomType());
        newBom.setPreviousRevisionId(sourceBomId);
        newBom.setIsActive(true);
        newBom.setEffectiveFrom(LocalDate.now());
        newBom.setStatus("DRAFT");
        newBom.setCreatedBy(user);
        newBom.setPlantId(source.getPlantId());
        newBom.setDocDate(source.getDocDate());
        newBom.setRemarks(remarks);
        // FRS §3.4: auto-increment revision_no
        int newRev = (source.getRevisionNo() != null ? source.getRevisionNo() : 0) + 1;
        newBom.setRevisionNo(newRev);

        List<ProductionBOMLine> newLines = new ArrayList<>();
        if (source.getLines() != null) {
            int lineNo = 1;
            for (ProductionBOMLine srcLine : source.getLines()) {
                if (Boolean.TRUE.equals(srcLine.getIsDeleted())) continue;
                ProductionBOMLine newLine = new ProductionBOMLine();
                newLine.setLineNo(lineNo++);
                newLine.setComponentItemCode(srcLine.getComponentItemCode());
                newLine.setComponentRevision(srcLine.getComponentRevision());
                newLine.setDescription(srcLine.getDescription());
                newLine.setQuantityPer(srcLine.getQuantityPer());
                newLine.setUom(srcLine.getUom());
                newLine.setScrapPercentage(srcLine.getScrapPercentage());
                newLine.setYieldPercentage(srcLine.getYieldPercentage());
                newLine.setOperationSequenceLink(srcLine.getOperationSequenceLink());
                newLine.setIssueMethod(srcLine.getIssueMethod());
                newLine.setSupplyType(srcLine.getSupplyType());
                newLine.setWarehouse(srcLine.getWarehouse());
                newLine.setChildBomId(srcLine.getChildBomId());
                newLine.setWeightPerQty(srcLine.getWeightPerQty());
                newLine.setComponentType(srcLine.getComponentType());
                newLines.add(newLine);
            }
        }
        newBom.setLines(newLines);

        ProductionBOM saved = bomRepo.save(newBom);
        recomputeBomWeights(saved);
        saved = bomRepo.save(saved);

        // FRS §3.4: Record revision history
        bomRevisionHistoryRepo.save(BomRevisionHistory.builder()
            .bomId(saved.getId())
            .revisionNo(newRev)
            .bomVersion(newVersion)
            .createdBy(user)
            .remarks(remarks)
            .previousRevisionId(sourceBomId)
            .build());
        // Also record the original as first revision if not already recorded
        if (source.getRevisionNo() == null || source.getRevisionNo() == 0) {
            bomRevisionHistoryRepo.save(BomRevisionHistory.builder()
                .bomId(source.getId())
                .revisionNo(0)
                .bomVersion(source.getBomVersion())
                .createdBy(source.getCreatedBy())
                .remarks("Initial revision")
                .build());
        }

        return saved;
    }

    /** FRS §3.4: Get revision history for a BOM */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> getBomRevisionHistory(Long bomId) {
        List<BomRevisionHistory> history = bomRevisionHistoryRepo.findByBomIdOrderByRevisionNoDesc(bomId);
        List<Map<String, Object>> result = new ArrayList<>();
        for (BomRevisionHistory h : history) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", h.getId());
            row.put("revisionNo", h.getRevisionNo());
            row.put("bomVersion", h.getBomVersion());
            row.put("createdAt", h.getCreatedAt());
            row.put("createdBy", h.getCreatedBy());
            row.put("remarks", h.getRemarks());
            row.put("previousRevisionId", h.getPreviousRevisionId());
            result.add(row);
        }
        return result;
    }

    /** FRS §5.1 FR-04: Copy a BOM from source_bom_code */
    @Transactional
    public ProductionBOM copyBom(String sourceBomCode, Map<String, Object> overrides, String user) {
        ProductionBOM source = bomRepo.findByBomNumber(sourceBomCode);
        if (source == null) {
            var candidates = bomRepo.findByItemCodeAndIsActiveTrue(sourceBomCode);
            if (candidates != null && !candidates.isEmpty()) source = candidates.get(0);
        }
        if (source == null) throw new IllegalArgumentException("Source BOM not found: " + sourceBomCode);

        ProductionBOM newBom = new ProductionBOM();
        // Generate new BOM number via doc numbering
        String newBomNumber = docs.nextNumber("production-bom");
        newBom.setBomNumber(newBomNumber);
        newBom.setItemCode(overrides.containsKey("itemCode") ? String.valueOf(overrides.get("itemCode")) : source.getItemCode());
        newBom.setItemRevision(source.getItemRevision());
        newBom.setBomVersion("1.0");
        newBom.setDescription(source.getDescription());
        newBom.setSpecifications(source.getSpecifications());
        newBom.setBaseQuantity(overrides.containsKey("baseQuantity")
            ? new BigDecimal(String.valueOf(overrides.get("baseQuantity")))
            : source.getBaseQuantity());
        newBom.setBaseUom(source.getBaseUom());
        newBom.setItemType(source.getItemType());
        newBom.setSalesOrderId(overrides.containsKey("salesOrderId") && overrides.get("salesOrderId") != null
            ? Long.parseLong(String.valueOf(overrides.get("salesOrderId")))
            : null);
        newBom.setBomType(source.getBomType());
        newBom.setIsActive(true);
        newBom.setEffectiveFrom(LocalDate.now());
        newBom.setStatus("DRAFT");
        newBom.setCreatedBy(user);
        newBom.setPlantId(source.getPlantId());
        newBom.setDocDate(LocalDate.now());
        newBom.setRevisionNo(0);

        List<ProductionBOMLine> newLines = new ArrayList<>();
        if (source.getLines() != null) {
            int lineNo = 1;
            for (ProductionBOMLine srcLine : source.getLines()) {
                if (Boolean.TRUE.equals(srcLine.getIsDeleted())) continue;
                ProductionBOMLine newLine = new ProductionBOMLine();
                newLine.setLineNo(lineNo++);
                newLine.setComponentItemCode(srcLine.getComponentItemCode());
                newLine.setComponentRevision(srcLine.getComponentRevision());
                newLine.setDescription(srcLine.getDescription());
                newLine.setQuantityPer(srcLine.getQuantityPer());
                newLine.setUom(srcLine.getUom());
                newLine.setScrapPercentage(srcLine.getScrapPercentage());
                newLine.setYieldPercentage(srcLine.getYieldPercentage());
                newLine.setOperationSequenceLink(srcLine.getOperationSequenceLink());
                newLine.setIssueMethod(srcLine.getIssueMethod());
                newLine.setSupplyType(srcLine.getSupplyType());
                newLine.setWarehouse(srcLine.getWarehouse());
                newLine.setChildBomId(srcLine.getChildBomId());
                newLine.setWeightPerQty(srcLine.getWeightPerQty());
                newLine.setComponentType(srcLine.getComponentType());
                newLines.add(newLine);
            }
        }
        newBom.setLines(newLines);

        ProductionBOM saved = bomRepo.save(newBom);
        recomputeBomWeights(saved);
        return bomRepo.save(saved);
    }

    @Transactional
    public WorkOrder populateFromBomAndRoute(Long workOrderId) {
        WorkOrder wo = (WorkOrder) docs.get("work-order", workOrderId);
        BigDecimal orderQty = wo.getOrderQuantity() == null ? BigDecimal.ONE : wo.getOrderQuantity();

        // FRS §6.2: SO-specific BOM priority
        Long effectiveBomId = wo.getBomId();
        if (wo.getSalesOrderId() != null && wo.getItemCode() != null && effectiveBomId == null) {
            // Look for SO-specific BOM first
            try {
                List<?> soBoms = em.createQuery(
                    "SELECT b.id FROM ProductionBOM b WHERE b.itemCode = :itemCode AND b.salesOrderId = :soId AND b.status = 'APPROVED'")
                    .setParameter("itemCode", wo.getItemCode())
                    .setParameter("soId", wo.getSalesOrderId())
                    .setMaxResults(1)
                    .getResultList();
                if (!soBoms.isEmpty()) {
                    effectiveBomId = (Long) soBoms.get(0);
                    wo.setBomId(effectiveBomId);
                }
            } catch (Exception ignored) {}
        }

        if (effectiveBomId != null) {
            Optional<ProductionBOM> bomOpt = bomRepo.findById(effectiveBomId);
            if (bomOpt.isPresent()) {
                ProductionBOM bom = bomOpt.get();
                // FRS §3.1: snapshot BOM code display
                wo.setBomCode(bom.getBomNumber());
                wo.setBomRevision(bom.getBomVersion());
                BigDecimal bomBaseQty = bom.getBaseQuantity() == null ? BigDecimal.ONE : bom.getBaseQuantity();
                BigDecimal scaleFactor = orderQty.divide(bomBaseQty, 10, RoundingMode.HALF_UP);

                List<WorkOrderMaterial> newMats = new ArrayList<>();
                int lineNo = 1;
                if (bom.getLines() != null) {
                    for (ProductionBOMLine bomLine : bom.getLines()) {
                        WorkOrderMaterial mat = new WorkOrderMaterial();
                        mat.setDoc(wo);
                        mat.setLineNo(lineNo++);
                        mat.setComponentItemCode(bomLine.getComponentItemCode());
                        mat.setComponentRevision(bomLine.getComponentRevision());
                        mat.setDescription(bomLine.getDescription());
                        // FRS v4.0 Changelog #8: traceability link to source BOM line
                        mat.setBomLineId(bomLine.getId());
                        BigDecimal qtyPer = bomLine.getQuantityPer() == null ? BigDecimal.ZERO : bomLine.getQuantityPer();
                        BigDecimal scrap = bomLine.getScrapPercentage() == null ? BigDecimal.ZERO : bomLine.getScrapPercentage();
                        BigDecimal required = qtyPer.multiply(scaleFactor)
                                .multiply(BigDecimal.ONE.add(scrap.divide(BigDecimal.valueOf(100), 10, RoundingMode.HALF_UP)));
                        mat.setRequiredQuantity(required.setScale(0, RoundingMode.CEILING));
                        mat.setIssuedQuantity(BigDecimal.ZERO);
                        mat.setReturnedQuantity(BigDecimal.ZERO);
                        mat.setShortageQuantity(mat.getRequiredQuantity());
                        mat.setRequiredDate(wo.getPlannedStartDate());
                        mat.setIssueMethod(bomLine.getIssueMethod());
                        mat.setWarehouse(bomLine.getWarehouse());
                        mat.setUom(bomLine.getUom());
                        mat.setBalanceQty(required);
                        mat.setReservationStatus("None");
                        mat.setIssueStatus("Pending");
                        newMats.add(mat);
                    }
                }
                wo.getMaterials().clear();
                wo.getMaterials().addAll(newMats);
            }
        }

        if (wo.getRouteId() != null) {
            Optional<RouteSheet> routeOpt = routeRepo.findById(wo.getRouteId());
            if (routeOpt.isPresent()) {
                RouteSheet route = routeOpt.get();
                // FRS §3.1: snapshot Route Sheet code display
                wo.setRouteSheetCode(route.getRouteNumber());
                wo.setRouteRevision(route.getRouteVersion());
                List<WorkOrderOperation> newOps = new ArrayList<>();
                if (route.getOperations() != null) {
                    for (RouteOperation rtOp : route.getOperations()) {
                        WorkOrderOperation woOp = new WorkOrderOperation();
                        woOp.setDoc(wo);
                        woOp.setOperationSequence(rtOp.getSequenceNo());
                        woOp.setOperationCode(rtOp.getOperationCode());
                        woOp.setOperationDescription(rtOp.getOperationDescription());
                        woOp.setWorkCenterCode(rtOp.getWorkCenterCode());
                        woOp.setMachineCode(rtOp.getMachineCode());
                        // FRS v4.0 Changelog #7: traceability link to source Route operation
                        woOp.setRouteOperationId(rtOp.getId());
                        woOp.setPlannedQuantity(orderQty);
                        woOp.setCompletedQuantity(BigDecimal.ZERO);
                        woOp.setGoodQuantity(BigDecimal.ZERO);
                        woOp.setScrapQuantity(BigDecimal.ZERO);
                        woOp.setReworkQuantity(BigDecimal.ZERO);
                        woOp.setSetupTimePlanned(rtOp.getSetupTime());
                        woOp.setSetupTimeActual(BigDecimal.ZERO);
                        woOp.setCycleTimePlanned(rtOp.getCycleTime());
                        woOp.setCycleTimeActual(BigDecimal.ZERO);
                        woOp.setInspectionRequired(rtOp.isInspectionRequired());
                        woOp.setSubcontractFlag(rtOp.isSubcontractFlag());
                        woOp.setToolRequired(rtOp.isToolRequired());
                        woOp.setFixtureRequired(rtOp.isFixtureRequired());
                        woOp.setNcProgramReference(rtOp.getNcProgramReference());
                        woOp.setStatus("Pending");
                        newOps.add(woOp);
                    }
                }
                wo.getOperations().clear();
                wo.getOperations().addAll(newOps);
            }
        }

        wo.setUpdatedAt(Instant.now());
        return wo;
    }

    /** FRS §6: Create Work Order directly from a Sales Order line item. */
    @Transactional
    public WorkOrder createWorkOrderFromSO(Long salesOrderId, Long salesOrderItemId, int quantity, String user) {
        SalesOrder so = em.find(SalesOrder.class, salesOrderId);
        if (so == null) throw new IllegalArgumentException("Sales Order not found: " + salesOrderId);

        SalesOrderItem soItem = null;
        if (so.getLines() != null && salesOrderItemId != null) {
            for (SalesOrderItem item : so.getLines()) {
                if (item.getId().equals(salesOrderItemId)) { soItem = item; break; }
            }
        }
        if (soItem == null && so.getLines() != null && !so.getLines().isEmpty()) {
            soItem = so.getLines().get(0);
        }
        if (soItem == null) throw new IllegalArgumentException("Sales Order has no line items.");

        int qty = quantity > 0 ? quantity : (soItem.getOrderQty() != null ? soItem.getOrderQty().intValue() : 1);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("salesOrderId", so.getId());
        body.put("soLineId", soItem.getId());
        body.put("itemCode", soItem.getItemCode() != null ? soItem.getItemCode() : soItem.getItemName());
        body.put("orderQuantity", qty);
        body.put("productionQty", qty);
        body.put("pendingQty", soItem.getPendingQty() != null ? soItem.getPendingQty() : soItem.getOrderQty());
        body.put("customerCode", so.getCustomerCode());
        body.put("drawingNumber", soItem.getDrawingNumber());
        body.put("drawingRev", soItem.getDrawingRevision());
        body.put("promisedDeliveryDate", so.getCustomerRequiredDate() != null ? so.getCustomerRequiredDate() : so.getDeliveryDate());
        body.put("priority", "MEDIUM");
        body.put("sourceType", "Sales Order");
        body.put("sourceDocNo", so.getDocNo());
        body.put("remarks", "Auto-created from SO " + so.getDocNo());

        DocEntity e = create("work-order", body, user);
        if (e instanceof WorkOrder wo) {
            populateFromBomAndRoute(wo.getId());
            return wo;
        }
        throw new IllegalStateException("Failed to create Work Order.");
    }

    /** FRS FR-09: Multi-level recursive tree loading for Semi-FG components */
    @Transactional(readOnly = true)
    public Map<String, Object> getBomTree(Long bomId) {
        ProductionBOM bom = (ProductionBOM) docs.get("production-bom", bomId);
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("id", bom.getId());
        root.put("bomNumber", bom.getBomNumber() != null ? bom.getBomNumber() : bom.getDocNo());
        root.put("itemCode", bom.getItemCode());
        root.put("itemType", bom.getItemType());
        root.put("description", bom.getDescription());
        root.put("level", 1);
        root.put("levelPath", "1");
        root.put("quantityPer", bom.getBaseQuantity());
        root.put("totalWeight", bom.getWeight());

        List<ProductionBOMLine> activeLines = (bom.getLines() == null) ? List.of()
            : bom.getLines().stream().filter(l -> !Boolean.TRUE.equals(l.getIsDeleted())).toList();

        boolean hasLevelPaths = activeLines.stream().anyMatch(l -> l.getBomLevel() != null && l.getBomLevel().matches("^[0-9]+(\\.[0-9]+)*.*"));

        List<Map<String, Object>> children;
        if (hasLevelPaths) {
            children = buildTreeFromBomLevels(activeLines);
            // FRS FR-09: the FG's own line (path "1") duplicates the root item; flatten it
            // so level-2 Semi-FG components become direct children of the FG root.
            List<Map<String, Object>> flattened = new ArrayList<>();
            for (Map<String, Object> child : children) {
                Object p = child.get("levelPath");
                if (p != null && p.toString().equals("1")) {
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> grand = (List<Map<String, Object>>) child.getOrDefault("children", List.of());
                    flattened.addAll(grand.isEmpty() ? List.of(child) : grand);
                } else {
                    flattened.add(child);
                }
            }
            children = flattened;
        } else {
            int seq = 1;
            children = new ArrayList<>();
            for (ProductionBOMLine line : activeLines) {
                children.add(buildBomTreeNode(line, seq++, "1"));
            }
        }

        root.put("children", children);
        return root;
    }

    private List<Map<String, Object>> buildTreeFromBomLevels(List<ProductionBOMLine> lines) {
        Map<String, Map<String, Object>> nodeMap = new LinkedHashMap<>();
        List<Map<String, Object>> rootNodes = new ArrayList<>();

        for (int i = 0; i < lines.size(); i++) {
            ProductionBOMLine line = lines.get(i);
            String rawLevel = line.getBomLevel() != null ? line.getBomLevel().trim() : "";
            String path = rawLevel.replaceAll("^[\\s]*([0-9]+(?:\\.[0-9]+)*).*", "$1");
            if (path.isBlank()) {
                path = String.valueOf(i + 1);
            }

            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", line.getId());
            node.put("lineNo", line.getLineNo());
            node.put("componentItemCode", line.getComponentItemCode());
            node.put("componentRevision", line.getComponentRevision());
            node.put("description", line.getDescription());
            node.put("quantityPer", line.getQuantityPer());
            node.put("weightPerQty", line.getWeightPerQty());
            node.put("totalWeight", line.getTotalWeight());
            node.put("componentType", line.getComponentType());
            node.put("itemType", line.getComponentType());
            node.put("bomLevel", line.getBomLevel());
            node.put("remarks", line.getRemarks());
            node.put("levelPath", path);
            node.put("children", new ArrayList<Map<String, Object>>());

            nodeMap.put(path, node);

            int lastDot = path.lastIndexOf('.');
            if (lastDot > 0) {
                String parentPath = path.substring(0, lastDot);
                Map<String, Object> parentNode = nodeMap.get(parentPath);
                if (parentNode != null) {
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> parentChildren = (List<Map<String, Object>>) parentNode.get("children");
                    parentChildren.add(node);
                } else {
                    rootNodes.add(node);
                }
            } else {
                rootNodes.add(node);
            }
        }
        return rootNodes;
    }

    private Map<String, Object> buildBomTreeNode(ProductionBOMLine line, int seq, String parentPath) {
        Map<String, Object> node = new LinkedHashMap<>();
        String levelPath = parentPath + "." + seq;
        node.put("lineNo", line.getLineNo());
        node.put("componentItemCode", line.getComponentItemCode());
        node.put("componentRevision", line.getComponentRevision());
        node.put("description", line.getDescription());
        node.put("quantityPer", line.getQuantityPer());
        node.put("weightPerQty", line.getWeightPerQty());
        node.put("totalWeight", line.getTotalWeight());
        node.put("componentType", line.getComponentType());
        node.put("itemType", line.getComponentType());
        node.put("bomLevel", line.getBomLevel());
        node.put("remarks", line.getRemarks());
        node.put("level", levelPath.split("\\.").length);
        node.put("levelPath", line.getBomLevel() != null ? line.getBomLevel() : levelPath);

        // FRS FR-09: recursively load child BOM for Semi-FG components
        List<Map<String, Object>> children = new ArrayList<>();
        if (line.getChildBomId() != null) {
            try {
                ProductionBOM childBom = bomRepo.findById(line.getChildBomId()).orElse(null);
                if (childBom != null && childBom.getLines() != null) {
                    int childSeq = 1;
                    for (ProductionBOMLine childLine : childBom.getLines()) {
                        if (Boolean.TRUE.equals(childLine.getIsDeleted())) continue;
                        children.add(buildBomTreeNode(childLine, childSeq++, levelPath));
                    }
                }
            } catch (Exception ignored) {}
        }
        node.put("children", children);
        return node;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> dashboard() {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("totalBom", docs.count("production-bom"));
        d.put("totalRoutes", docs.count("route-sheet"));
        d.put("totalWorkOrders", docs.count("work-order"));
        d.put("pendingApproval", countByStatus("work-order", "SUBMITTED"));
        d.put("released", countByStatus("work-order", "RELEASED"));
        d.put("inProcess", countByStatus("work-order", "IN_PROCESS"));
        d.put("completed", countByStatus("work-order", "COMPLETED"));
        d.put("closed", countByStatus("work-order", "CLOSED"));
        d.put("cancelled", countByStatus("work-order", "CANCELLED"));
        d.put("totalShopFloor", docs.count("shop-floor-entry"));
        // FRS v4.0 §6.15: count overdue WOs
        long overdueCount = em.createQuery(
            "SELECT COUNT(w) FROM WorkOrder w WHERE w.plannedEndDate < CURRENT_DATE " +
            "AND w.status NOT IN ('COMPLETED', 'CLOSED', 'CANCELLED')", Long.class)
            .getSingleResult();
        d.put("overdue", overdueCount);
        return d;
    }

    // FRS §6.15: Return documents in SUBMITTED status across planning types (pending approval)
    @Transactional(readOnly = true)
    public List<Map<String, Object>> getPendingApprovals() {
        List<Map<String, Object>> result = new ArrayList<>();
        for (String key : List.of("work-order", "production-bom", "route-sheet")) {
            Map<String, Object> page = docs.list(key, Map.of("status", "SUBMITTED", "size", "50", "page", "0"));
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> rows = (List<Map<String, Object>>) page.getOrDefault("content", List.of());
            for (Map<String, Object> row : rows) {
                row.put("_docType", key);
                result.add(row);
            }
        }
        return result;
    }

    private long countByStatus(String key, String status) {
        Map<String, Object> page = docs.list(key, Map.of("status", status, "size", "1", "page", "0"));
        Object total = page.get("totalElements");
        if (total instanceof Number n) return n.longValue();
        return 0;
    }

    public void validateBomCanBeDeleted(Long id) {
        Long count = em.createQuery("SELECT COUNT(wo) FROM WorkOrder wo WHERE wo.bomId = :bomId", Long.class)
                .setParameter("bomId", id)
                .getSingleResult();
        if (count > 0) {
            throw new IllegalStateException("This BOM is referenced in an existing Work Order and cannot be deleted.");
        }
    }

    // ── FRS §19.3: Status History ──

    @Transactional(readOnly = true)
    public List<Map<String, Object>> getWorkOrderStatusHistory(Long workOrderId) {
        List<in.zygertechnology.zygererp.entity.WorkOrderStatusHistory> history =
                woStatusHistoryRepo.findByWorkOrderIdOrderByCreatedAtAsc(workOrderId);
        List<Map<String, Object>> result = new ArrayList<>();
        for (var h : history) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", h.getId());
            row.put("workOrderId", h.getWorkOrderId());
            row.put("woNumber", h.getWoNumber());
            row.put("fromStatus", h.getFromStatus());
            row.put("toStatus", h.getToStatus());
            row.put("reason", h.getReason());
            row.put("createdBy", h.getCreatedBy());
            row.put("createdAt", h.getCreatedAt() != null ? h.getCreatedAt().toString() : null);
            result.add(row);
        }
        return result;
    }

    // ── FRS §17: Reports ──

    @Transactional(readOnly = true)
    public Map<String, Object> getOverdueWorkOrders(Map<String, String> q) {
        List<?> results = em.createQuery(
            "SELECT w FROM WorkOrder w WHERE w.plannedEndDate < CURRENT_DATE " +
            "AND w.status NOT IN ('COMPLETED', 'CLOSED', 'CANCELLED') " +
            "ORDER BY w.plannedEndDate ASC")
            .getResultList();
        return toReportMap(results);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getMaterialShortageReport(Map<String, String> q) {
        List<?> results = em.createQuery(
            "SELECT DISTINCT w FROM WorkOrder w JOIN w.materials m " +
            "WHERE m.shortageQuantity IS NOT NULL AND m.shortageQuantity > 0 " +
            "ORDER BY w.plannedEndDate ASC")
            .getResultList();
        return toReportMap(results);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getWoStatusSummary() {
        Map<String, Object> summary = new LinkedHashMap<>();
        String[] statuses = {"DRAFT", "SUBMITTED", "APPROVED", "RELEASED", "IN_PROCESS", "COMPLETED", "CLOSED", "CANCELLED", "ON_HOLD", "REJECTED"};
        for (String status : statuses) {
            long count = countByStatus("work-order", status);
            summary.put(status, count);
        }
        summary.put("TOTAL", docs.count("work-order"));
        return summary;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getCompletionReport(Map<String, String> q) {
        List<?> results = em.createQuery(
            "SELECT w FROM WorkOrder w WHERE w.status IN ('COMPLETED', 'CLOSED') " +
            "ORDER BY w.completedAt DESC")
            .getResultList();
        return toReportMap(results);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getSoPendingReport(Map<String, String> q) {
        List<?> results = em.createQuery(
            "SELECT w FROM WorkOrder w WHERE w.salesOrderId IS NOT NULL " +
            "AND w.status NOT IN ('CANCELLED') " +
            "ORDER BY w.salesOrderId ASC")
            .getResultList();
        return toReportMap(results);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getOpenWorkOrders(Map<String, String> q) {
        List<?> results = em.createQuery(
            "SELECT w FROM WorkOrder w WHERE w.status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PROCESS') " +
            "ORDER BY w.plannedEndDate ASC")
            .getResultList();
        return toReportMap(results);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getRouteSheetResourceUtilizationReport(Map<String, String> q) {
        List<ResourceMaster> activeResources = resourceRepo.findByActiveTrue();
        List<RouteSheet> routes = routeRepo.findAll();

        List<Map<String, Object>> rows = new ArrayList<>();
        for (ResourceMaster res : activeResources) {
            long assignedOpsCount = 0;
            BigDecimal totalSetup = BigDecimal.ZERO;
            BigDecimal totalCycle = BigDecimal.ZERO;

            for (RouteSheet rs : routes) {
                if (rs.getOperations() != null) {
                    for (RouteOperation op : rs.getOperations()) {
                        if (op.getResource() != null && op.getResource().getId().equals(res.getId())) {
                            assignedOpsCount++;
                            if (op.getSetupTime() != null) totalSetup = totalSetup.add(op.getSetupTime());
                            if (op.getCycleTime() != null) totalCycle = totalCycle.add(op.getCycleTime());
                        }
                    }
                }
            }

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("resourceId", res.getId());
            row.put("resourceCode", res.getResourceCode());
            row.put("resourceName", res.getResourceName());
            row.put("resourceType", res.getResourceType());
            row.put("department", res.getDepartment());
            row.put("capacity", res.getCapacity());
            row.put("capacityUom", res.getCapacityUom());
            row.put("assignedOperationsCount", assignedOpsCount);
            row.put("totalSetupTimeMin", totalSetup);
            row.put("totalCycleTimeMin", totalCycle);
            row.put("totalTimeMin", totalSetup.add(totalCycle));
            row.put("status", res.getStatus());
            rows.add(row);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("content", rows);
        result.put("totalElements", rows.size());
        return result;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getRouteSheetOutsourceReport(Map<String, String> q) {
        List<RouteSheet> routes = routeRepo.findAll();
        List<Map<String, Object>> rows = new ArrayList<>();

        for (RouteSheet rs : routes) {
            if (rs.getOperations() == null) continue;
            for (RouteOperation op : rs.getOperations()) {
                boolean isOutsource = "Outsource".equalsIgnoreCase(op.getProcessType())
                        || op.isSubcontractFlag()
                        || (op.getResource() != null && "Vendor".equalsIgnoreCase(op.getResource().getResourceType()));
                if (isOutsource) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("routeId", rs.getId());
                    row.put("routeNumber", rs.getRouteNumber());
                    row.put("itemCode", rs.getItemCode());
                    row.put("itemRevision", rs.getItemRevision());
                    row.put("routeStatus", rs.getStatus());
                    row.put("sequenceNo", op.getSequenceNo());
                    row.put("processCode", op.getProcessCode());
                    row.put("processName", op.getProcess() != null ? op.getProcess().getName() : op.getProcessCode());
                    row.put("resourceName", op.getResourceName() != null ? op.getResourceName() : (op.getResource() != null ? op.getResource().getResourceName() : "—"));
                    row.put("resourceType", op.getResourceType());
                    row.put("processType", op.getProcessType() != null ? op.getProcessType() : "Outsource");
                    row.put("setupTime", op.getSetupTime());
                    row.put("cycleTime", op.getCycleTime());
                    row.put("inspectionRequired", op.isInspectionRequired());
                    row.put("remarks", op.getRemarks());
                    rows.add(row);
                }
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("content", rows);
        result.put("totalElements", rows.size());
        return result;
    }

    private Map<String, Object> toReportMap(List<?> entities) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Object e : entities) {
            if (e instanceof WorkOrder wo) {
                rows.add(docs.toRow(wo));
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("content", rows);
        result.put("totalElements", rows.size());
        return result;
    }

    /** FRD §6.1: Return active Sales Orders with pending qty for the WO SO picker. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> getActiveSOsForWO() {
        List<SalesOrder> sos = em.createQuery(
            "SELECT so FROM SalesOrder so WHERE so.status IN ('APPROVED','RELEASED') AND so.deleted = false ORDER BY so.docNo",
            SalesOrder.class).getResultList();

        List<Map<String, Object>> result = new ArrayList<>();
        for (SalesOrder so : sos) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", so.getId());
            row.put("docNo", so.getDocNo());
            row.put("customerCode", so.getCustomerCode());
            row.put("customer", so.getCustomer());
            row.put("deliveryDate", so.getDeliveryDate());
            row.put("customerRequiredDate", so.getCustomerRequiredDate());

            List<SalesOrderItem> itemsList = so.getLines();
            if (itemsList == null || itemsList.isEmpty()) {
                itemsList = em.createQuery(
                    "SELECT i FROM SalesOrderItem i WHERE i.doc.id = :docId", SalesOrderItem.class)
                    .setParameter("docId", so.getId())
                    .getResultList();
            }

            List<Map<String, Object>> lineRows = new ArrayList<>();
            BigDecimal totalPending = BigDecimal.ZERO;

            if (itemsList != null && !itemsList.isEmpty()) {
                for (SalesOrderItem item : itemsList) {
                    BigDecimal pending = item.getPendingQty() != null 
                        ? item.getPendingQty() 
                        : (item.getOrderQty() != null ? item.getOrderQty() : BigDecimal.ZERO);
                    
                    if (pending.compareTo(BigDecimal.ZERO) <= 0 && itemsList.size() > 1) {
                        continue;
                    }
                    totalPending = totalPending.add(pending);

                    Map<String, Object> lr = new LinkedHashMap<>();
                    lr.put("id", item.getId());
                    String code = item.getItemCode() != null && !item.getItemCode().isBlank() 
                        ? item.getItemCode() 
                        : (item.getItemName() != null && !item.getItemName().isBlank() 
                            ? item.getItemName() 
                            : (item.getDescription() != null && !item.getDescription().isBlank()
                                ? item.getDescription()
                                : (item.getInternalPartNumber() != null && !item.getInternalPartNumber().isBlank()
                                    ? item.getInternalPartNumber()
                                    : (item.getCustomerPartNumber() != null && !item.getCustomerPartNumber().isBlank()
                                        ? item.getCustomerPartNumber()
                                        : so.getDocNo()))));
                    
                    String name = item.getItemName() != null && !item.getItemName().isBlank()
                        ? item.getItemName()
                        : (item.getDescription() != null && !item.getDescription().isBlank() ? item.getDescription() : code);
                    String desc = item.getDescription() != null && !item.getDescription().isBlank() 
                        ? item.getDescription() : name;

                    lr.put("itemCode", code);
                    lr.put("itemName", name);
                    lr.put("description", desc);
                    lr.put("orderQty", item.getOrderQty() != null ? item.getOrderQty() : pending);
                    lr.put("pendingQty", pending);
                    lr.put("drawingNumber", item.getDrawingNumber());
                    lr.put("drawingRevision", item.getDrawingRevision());
                    lr.put("uom", item.getUom() != null ? item.getUom() : "Nos");
                    lineRows.add(lr);
                }
            }

            // Fallback to SalesOrderSchedule if lines are still empty
            if (lineRows.isEmpty() && so.getSchedules() != null && !so.getSchedules().isEmpty()) {
                for (SalesOrderSchedule sch : so.getSchedules()) {
                    BigDecimal pending = sch.getPendingQty() != null 
                        ? sch.getPendingQty() 
                        : (sch.getScheduledQty() != null ? sch.getScheduledQty() : BigDecimal.ZERO);
                    if (pending.compareTo(BigDecimal.ZERO) <= 0 && so.getSchedules().size() > 1) continue;
                    totalPending = totalPending.add(pending);

                    Map<String, Object> lr = new LinkedHashMap<>();
                    lr.put("id", sch.getId());
                    String code = sch.getItemCode() != null && !sch.getItemCode().isBlank() ? sch.getItemCode() : so.getDocNo();
                    lr.put("itemCode", code);
                    lr.put("itemName", code);
                    lr.put("description", "Scheduled Item");
                    lr.put("orderQty", sch.getScheduledQty());
                    lr.put("pendingQty", pending);
                    lr.put("uom", "Nos");
                    lineRows.add(lr);
                }
            }

            BigDecimal headerPending = so.getPendingQty() != null && so.getPendingQty().compareTo(BigDecimal.ZERO) > 0 
                ? so.getPendingQty() : totalPending;

            if (headerPending.compareTo(BigDecimal.ZERO) <= 0 && lineRows.isEmpty()) {
                continue;
            }

            // Guarantee clean fallback item row if lines are still empty
            if (lineRows.isEmpty()) {
                Map<String, Object> lr = new LinkedHashMap<>();
                lr.put("id", so.getId());
                String code = so.getDocNo();
                String name = (so.getCustomer() != null ? so.getCustomer() : "Customer") + " Finished Part";
                lr.put("itemCode", code);
                lr.put("itemName", name);
                lr.put("description", name);
                lr.put("orderQty", so.getOrderedQty() != null ? so.getOrderedQty() : headerPending);
                lr.put("pendingQty", headerPending);
                lr.put("uom", "Nos");
                lineRows.add(lr);
            }

            row.put("pendingQty", headerPending);

            // Populate header-level item fields from first line for fallback
            if (!lineRows.isEmpty()) {
                Map<String, Object> firstLine = lineRows.get(0);
                row.put("itemCode", firstLine.get("itemCode"));
                row.put("itemName", firstLine.get("itemName"));
                row.put("description", firstLine.get("description"));
                row.put("uom", firstLine.get("uom"));
                row.put("orderQty", firstLine.get("orderQty"));
            }

            row.put("lines", lineRows);
            result.add(row);
        }
        return result;
    }

    /** FRD §6.1: Find active BOM (APPROVED) and active Route Sheet (RELEASED) for an item, prioritizing SO-specific BOM. */
    @Transactional(readOnly = true)
    public Map<String, Object> getActiveBomAndRoute(String itemCode, Long salesOrderId) {
        Map<String, Object> result = new LinkedHashMap<>();

        List<ProductionBOM> boms = new ArrayList<>();
        // 1. Try finding BOM by Sales Order ID first (if provided)
        if (salesOrderId != null) {
            if (itemCode != null && !itemCode.isBlank()) {
                boms = em.createQuery(
                    "SELECT b FROM ProductionBOM b WHERE b.salesOrderId = :soId AND b.itemCode = :itemCode AND b.deleted = false ORDER BY b.id DESC", ProductionBOM.class)
                    .setParameter("soId", salesOrderId)
                    .setParameter("itemCode", itemCode)
                    .getResultList();
            }
            if (boms.isEmpty()) {
                boms = em.createQuery(
                    "SELECT b FROM ProductionBOM b WHERE b.salesOrderId = :soId AND b.deleted = false ORDER BY b.id DESC", ProductionBOM.class)
                    .setParameter("soId", salesOrderId)
                    .getResultList();
            }
        }
        // 2. Fallback to general item code active BOM
        if (boms.isEmpty() && itemCode != null && !itemCode.isBlank()) {
            boms = em.createQuery(
                "SELECT b FROM ProductionBOM b WHERE b.itemCode = :itemCode AND b.deleted = false ORDER BY b.id DESC", ProductionBOM.class)
                .setParameter("itemCode", itemCode)
                .getResultList();
        }

        List<Map<String, Object>> bomList = boms.stream().map(b -> docs.toRow(b)).toList();
        result.put("boms", bomList);

        if (!bomList.isEmpty()) {
            Map<String, Object> firstBom = bomList.get(0);
            result.put("bomId", firstBom.get("id"));
            result.put("bomCode", firstBom.get("bomNumber"));
            result.put("bomRevision", firstBom.get("bomVersion"));
            result.put("itemCode", firstBom.get("itemCode"));
            result.put("materials", firstBom.get("lines"));
        }

        // Route Sheet lookup
        List<RouteSheet> routes = new ArrayList<>();
        String effectiveItemCode = itemCode != null && !itemCode.isBlank() ? itemCode : (String) result.get("itemCode");
        if (effectiveItemCode != null && !effectiveItemCode.isBlank()) {
            routes = em.createQuery(
                "SELECT r FROM RouteSheet r WHERE r.itemCode = :itemCode AND r.deleted = false ORDER BY r.id DESC", RouteSheet.class)
                .setParameter("itemCode", effectiveItemCode).getResultList();
        }
        List<Map<String, Object>> routeList = routes.stream().map(r -> docs.toRow(r)).toList();
        result.put("routes", routeList);

        if (!routeList.isEmpty()) {
            Map<String, Object> firstRoute = routeList.get(0);
            result.put("routeId", firstRoute.get("id"));
            result.put("routeSheetCode", firstRoute.get("routeNumber"));
            result.put("routeRevision", firstRoute.get("routeVersion"));
            result.put("operations", firstRoute.get("operations"));
        }

        return result;
    }

    public Map<String, Object> getActiveBomAndRoute(String itemCode) {
        return getActiveBomAndRoute(itemCode, null);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> getAllAvailableBoms() {
        List<ProductionBOM> list = em.createQuery(
            "SELECT b FROM ProductionBOM b WHERE b.deleted = false ORDER BY b.id DESC", ProductionBOM.class)
            .getResultList();
        return list.stream().map(b -> docs.toRow(b)).toList();
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> getAllAvailableRoutes() {
        List<RouteSheet> list = em.createQuery(
            "SELECT r FROM RouteSheet r WHERE r.deleted = false ORDER BY r.id DESC", RouteSheet.class)
            .getResultList();
        return list.stream().map(r -> docs.toRow(r)).toList();
    }

    /** FRS §4.4: Route Sheet detail row Process auto-fetch resolution */
    @Transactional(readOnly = true)
    public Map<String, Object> getRouteSheetProcessAutoFetch(Long processId, Long overrideResourceId) {
        if (processId == null) throw new IllegalArgumentException("processId is mandatory");
        ProcessMaster pm = em.find(ProcessMaster.class, processId);
        if (pm == null) throw new IllegalArgumentException("Process not found: " + processId);
        if (!pm.isActive()) throw new IllegalStateException("Process is inactive: " + pm.getName());

        Long defaultResourceId = pm.getRequiredResource() != null ? pm.getRequiredResource().getId() : null;
        Long effectiveResourceId = overrideResourceId != null ? overrideResourceId : defaultResourceId;

        String resourceName = pm.getResourceName();
        String resourceType = pm.getResourceType();
        boolean typeMismatch = false;

        if (effectiveResourceId != null) {
            ResourceMaster rm = em.find(ResourceMaster.class, effectiveResourceId);
            if (rm != null) {
                resourceName = rm.getResourceName();
                resourceType = rm.getResourceType();
                if (pm.getRequiredResource() != null && !rm.getResourceType().equalsIgnoreCase(pm.getRequiredResource().getResourceType())) {
                    typeMismatch = true;
                }
            }
        }

        String processType = pm.getProcessType();
        if (processType == null || processType.isBlank()) {
            processType = "Vendor".equalsIgnoreCase(resourceType) ? "Outsource" : "Insource";
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("processId", pm.getId());
        result.put("processCode", pm.getCode());
        result.put("processName", pm.getName());
        result.put("resourceId", effectiveResourceId);
        result.put("resourceName", resourceName);
        result.put("resourceType", resourceType);
        result.put("processType", processType);
        result.put("setupTime", pm.getSetupTime() != null ? pm.getSetupTime() : java.math.BigDecimal.ZERO);
        result.put("cycleTime", pm.getCycleTime() != null ? pm.getCycleTime() : java.math.BigDecimal.ZERO);
        result.put("inspectionRequired", pm.isInspection());
        result.put("typeMismatch", typeMismatch);
        return result;
    }
}
