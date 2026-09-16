package in.zygertechnology.zygererp.config;

import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.*;
import in.zygertechnology.zygererp.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;
import java.util.stream.Collectors;

@Component @Profile("dev") @RequiredArgsConstructor
public class DataSeeder implements CommandLineRunner {
    private final RoleRepository roles;
    private final PermissionRepository permissions;
    private final EscalationRuleRepository escRuleRepo;

    @Override
    public void run(String... args) {
        try { seedRbac(); } catch (Exception e) { /* tables may not exist */ }
    }

    private void seedRbac() {
        try {
            if (roles.count() > 0) return;
        } catch (Exception e) {
            System.err.println("[DataSeeder] RBAC seed skipped: " + e.getMessage());
            e.printStackTrace();
            return;
        }

        // FRS A.6.1: Actions = View | Create | Edit | Delete | Approve | Reject | Cancel | Print | Export
        String[] actions = {"VIEW", "CREATE", "EDIT", "DELETE", "APPROVE", "REJECT", "CANCEL", "PRINT", "EXPORT"};
        String[] modules = {"MASTER", "INVENTORY", "PURCHASE", "SALES", "PLANNING", "PRODUCTION", "QUALITY", "MAINTENANCE", "REPORTS"};

        Map<String, String[]> moduleScreens = Map.of(
            "MASTER", new String[]{"ITEM", "ITEM_GROUP", "STORE", "RACK", "BIN", "UOM", "PROCESS", "PROCESS_GROUP",
                                   "MACHINE", "INSTRUMENT", "TOOL", "CUSTOMER", "SUPPLIER", "SUBCONTRACTOR",
                                   "USER", "COMPANY_INFO", "WORK_CENTER", "OPERATION", "SHIFT"},
            "INVENTORY", new String[]{"PO_INWARD", "LO_INWARD", "JO_INWARD", "GENERAL_INWARD", "GRN",
                                      "STOCK_ISSUE_REQUEST", "RM_ISSUE", "GENERAL_ISSUE", "JO_DC", "INTERNAL_ISSUE", "ISSUE_AGAINST_RECEIPT",
                                      "SALES_DC", "JO_DC_ISSUE", "GENERAL_DC", "RETURN_DC", "TRANSFER_DC",
                                      "PURCHASE_INVOICE", "SUBCONTRACT_INVOICE",
                                      "INWARD_RETURN", "DC_RETURN", "INVOICE_RETURN", "STOCK_RETURN", "RECEIVED_AGAINST_ISSUE", "RECEIPT_RETURN",
                                      "STOCK_ALLOTMENT", "STOCK_RELEASE", "STOCK_AMENDMENT", "PHYSICAL_STOCK_AMENDMENT",
                                      "STOCK_LEDGER", "STOCK_BALANCE"},
            "PURCHASE", new String[]{"PURCHASE_REQUEST", "SUPPLIER_ENQUIRY", "SUPPLIER_QUOTATION", "PURCHASE_ORDER",
                                      "PURCHASE_SCHEDULE", "JOB_ORDER", "JOB_ORDER_SCHEDULE", "PURCHASE_TARGET",
                                      "PURCHASE_PRICE_LIST", "JOB_WORK_PRICE_LIST"},
            "SALES", new String[]{"SALES_ORDER", "PROFORMA_INVOICE", "SALES_DC", "SALES_INVOICE", "CUSTOMER_RETURN"},
            "PLANNING", new String[]{"WORK_ORDER", "PRODUCTION_BOM", "ROUTE_SHEET", "MATERIAL_PLANNING",
                                      "FG_POSSIBLE", "DISPATCH_PLAN", "MACHINE_LOAD", "ENGINEERING_CHANGE",
                                      "GAP_ANALYSIS", "COST_ESTIMATION"},
            "PRODUCTION", new String[]{"PRODUCTION_ENTRY", "PRODUCT_CONVERSION", "PRODUCTION_RETURN",
                                        "PRODUCTION_LOG", "JOB_CARD", "JOB_SUBJOB", "IDLE_TIME", "PRODUCTION_PENDING"},
            "QUALITY", new String[]{"IQC", "LO_INSPECTION", "JOMIN", "FAI", "IPQC", "LINE_INSPECTION",
                                     "LAST_OFF", "FINAL_INSPECTION", "INSPECTION_PENDING",
                                     "NCR", "CONCESSION", "TEST_CERTIFICATE", "CUSTOMER_COMPLAINT", "CAPA", "8D_REPORT",
                                     "CALIBRATION_INSTRUMENT", "CALIBRATION_RECORD"},
            "MAINTENANCE", new String[]{"BREAKDOWN_INTIMATION", "BREAKDOWN_RECTIFICATION",
                                         "PM_PLAN", "PM_SCHEDULE", "PM_COMPLETION",
                                         "TOOL_SERVICE_INTIMATION", "TOOL_SERVICE_RECTIFICATION",
                                         "CALIBRATION_SCHEDULE", "CALIBRATION_ENTRY",
                                         "POWER_CONSUMPTION", "WATER_CONSUMPTION",
                                         "ROOT_CAUSE_ANALYSIS", "MAINTENANCE_ANALYSIS"},
            "REPORTS", new String[]{"INVENTORY_REPORTS", "PURCHASE_REPORTS", "SALES_REPORTS",
                                     "PLANNING_REPORTS", "PRODUCTION_REPORTS", "QUALITY_REPORTS", "MAINTENANCE_REPORTS"}
        );

        // Create all permissions in one batch
        List<Permission> allPerms = new ArrayList<>();
        for (String mod : modules) {
            String[] screens = moduleScreens.getOrDefault(mod, new String[]{});
            for (String screen : screens) {
                for (String action : actions) {
                    allPerms.add(Permission.builder()
                        .module(mod).screen(screen).action(action)
                        .description(mod + " / " + screen + " / " + action)
                        .build());
                }
            }
        }
        allPerms = permissions.saveAll(allPerms);

        Map<String, Permission> permMap = allPerms.stream()
            .collect(Collectors.toMap(Permission::code, p -> p));

        // Create roles
        Role admin = createAndSaveRole("ADMIN", "System Administrator - full access to all modules");
        admin.setPermissions(new HashSet<>(allPerms));
        roles.save(admin);

        Role mgmt = createAndSaveRole("MANAGEMENT", "Management - view all, approve high-value");
        mgmt.setPermissions(filterPerms(permMap, new String[]{"VIEW"}, modules));
        roles.save(mgmt);

        Role purchaseExec = createAndSaveRole("PURCHASE_EXECUTIVE", "Purchase Executive - create PR/PO/JO");
        purchaseExec.setPermissions(filterPerms(permMap, new String[]{"VIEW","CREATE","EDIT","PRINT","EXPORT"}, new String[]{"MASTER","PURCHASE","INVENTORY"}));
        roles.save(purchaseExec);

        Role purchaseMgr = createAndSaveRole("PURCHASE_MANAGER", "Purchase Manager - approve PO, manage prices");
        purchaseMgr.setPermissions(filterPerms(permMap, new String[]{"VIEW","CREATE","EDIT","APPROVE","REJECT","PRINT","EXPORT"}, new String[]{"MASTER","PURCHASE","INVENTORY"}));
        roles.save(purchaseMgr);

        Role storeOp = createAndSaveRole("STORE_OPERATOR", "Store Operator - inward, issue, receipt, view stock");
        storeOp.setPermissions(filterPerms(permMap, new String[]{"VIEW","CREATE","EDIT","PRINT"}, new String[]{"INVENTORY","MASTER"}));
        roles.save(storeOp);

        Role storeMgr = createAndSaveRole("STORE_MANAGER", "Store Manager - approve transactions, adjustments");
        storeMgr.setPermissions(filterPerms(permMap, new String[]{"VIEW","CREATE","EDIT","APPROVE","REJECT","CANCEL","PRINT","EXPORT"}, new String[]{"INVENTORY","MASTER"}));
        roles.save(storeMgr);

        Role salesExec = createAndSaveRole("SALES_EXECUTIVE", "Sales Executive - create SO/PI/DC");
        salesExec.setPermissions(filterPerms(permMap, new String[]{"VIEW","CREATE","EDIT","PRINT","EXPORT"}, new String[]{"SALES","MASTER"}));
        roles.save(salesExec);

        Role salesMgr = createAndSaveRole("SALES_MANAGER", "Sales Manager - approve SO/PI/DC");
        salesMgr.setPermissions(filterPerms(permMap, new String[]{"VIEW","CREATE","EDIT","APPROVE","REJECT","CANCEL","PRINT","EXPORT"}, new String[]{"SALES","MASTER"}));
        roles.save(salesMgr);

        Role planningMgr = createAndSaveRole("PLANNING_MANAGER", "Planning Manager - WO, BOM, Route, MRP");
        planningMgr.setPermissions(filterPerms(permMap, new String[]{"VIEW","CREATE","EDIT","DELETE","APPROVE","REJECT","CANCEL","PRINT","EXPORT"}, new String[]{"PLANNING","MASTER","INVENTORY"}));
        roles.save(planningMgr);

        Role planner = createAndSaveRole("PLANNER", "PPC Executive - create WO, material plans");
        planner.setPermissions(filterPerms(permMap, new String[]{"VIEW","CREATE","EDIT","PRINT"}, new String[]{"PLANNING","MASTER","INVENTORY"}));
        roles.save(planner);

        Role prodOp = createAndSaveRole("PRODUCTION_OPERATOR", "Production Operator - view jobs, record production");
        prodOp.setPermissions(filterPerms(permMap, new String[]{"VIEW","CREATE","EDIT"}, new String[]{"PRODUCTION","MASTER"}));
        roles.save(prodOp);

        Role prodSup = createAndSaveRole("PRODUCTION_SUPERVISOR", "Production Supervisor - release jobs, verify");
        prodSup.setPermissions(filterPerms(permMap, new String[]{"VIEW","CREATE","EDIT","APPROVE","CANCEL","PRINT"}, new String[]{"PRODUCTION","MASTER","QUALITY"}));
        roles.save(prodSup);

        Role qualityInsp = createAndSaveRole("QUALITY_INSPECTOR", "Quality Inspector - perform inspections");
        qualityInsp.setPermissions(filterPerms(permMap, new String[]{"VIEW","CREATE","EDIT","PRINT"}, new String[]{"QUALITY","MASTER"}));
        roles.save(qualityInsp);

        Role qualityMgr = createAndSaveRole("QUALITY_MANAGER", "Quality Manager - approve, concessions, CAPA, 8D");
        qualityMgr.setPermissions(filterPerms(permMap, new String[]{"VIEW","CREATE","EDIT","APPROVE","REJECT","CANCEL","PRINT","EXPORT"}, new String[]{"QUALITY","MASTER"}));
        roles.save(qualityMgr);

        Role maintTech = createAndSaveRole("MAINTENANCE_TECHNICIAN", "Maintenance Technician - view, update status");
        maintTech.setPermissions(filterPerms(permMap, new String[]{"VIEW","CREATE","EDIT"}, new String[]{"MAINTENANCE","MASTER"}));
        roles.save(maintTech);

        Role maintMgr = createAndSaveRole("MAINTENANCE_MANAGER", "Maintenance Manager - PM, analysis, cost");
        maintMgr.setPermissions(filterPerms(permMap, new String[]{"VIEW","CREATE","EDIT","APPROVE","REJECT","CANCEL","PRINT","EXPORT"}, new String[]{"MAINTENANCE","MASTER"}));
        roles.save(maintMgr);

        // FRS §2.5: Seed default escalation rules
        try {
            if (escRuleRepo.count() == 0) {
                escRuleRepo.saveAll(List.of(
                    EscalationRule.builder().docKey("QUALITY_INSPECTION").priority("HIGH").slaHours(4).escalateToRole("QUALITY_MANAGER").notifyChannels("IN_APP").active(true).build(),
                    EscalationRule.builder().docKey("QUALITY_NCR").priority("CRITICAL").slaHours(24).escalateToRole("QUALITY_MANAGER").notifyChannels("IN_APP").active(true).build(),
                    EscalationRule.builder().docKey("QUALITY_CAPA").priority("CRITICAL").slaHours(72).escalateToRole("QUALITY_MANAGER").notifyChannels("IN_APP").active(true).build(),
                    EscalationRule.builder().docKey("BREAKDOWN_INTIMATION").priority("HIGH").slaHours(2).escalateToRole("MAINTENANCE_MANAGER").notifyChannels("IN_APP").active(true).build(),
                    EscalationRule.builder().docKey("BREAKDOWN_INTIMATION").priority("CRITICAL").slaHours(8).escalateToRole("MAINTENANCE_MANAGER").notifyChannels("IN_APP").active(true).build(),
                    EscalationRule.builder().docKey("PM_COMPLETION").priority("HIGH").slaHours(48).escalateToRole("MAINTENANCE_MANAGER").notifyChannels("IN_APP").active(true).build(),
                    EscalationRule.builder().docKey("CALIBRATION_ENTRY").priority("HIGH").slaHours(24).escalateToRole("QUALITY_MANAGER").notifyChannels("IN_APP").active(true).build()
                ));
            }
        } catch (Exception ignored) {}
    }

    private Role createAndSaveRole(String name, String description) {
        return Role.builder().name(name).description(description).active(true).build();
    }

    private String[] actions(String... acts) { return acts; }
    private String[] allModules(String[] modules) { return modules; }

    private Set<Permission> filterPerms(Map<String, Permission> permMap, String[] actions, String[] modules) {
        Set<Permission> result = new HashSet<>();
        for (String mod : modules) {
            for (String action : actions) {
                // Add module:*:action (wildcard screen)
                Permission wildcard = permMap.get(mod + ":*:" + action);
                if (wildcard != null) result.add(wildcard);
            }
        }
        // Also add all specific screen permissions for the requested modules/actions
        for (Map.Entry<String, Permission> entry : permMap.entrySet()) {
            String[] parts = entry.getKey().split(":");
            if (parts.length == 3) {
                for (String mod : modules) {
                    if (parts[0].equalsIgnoreCase(mod)) {
                        for (String action : actions) {
                            if (parts[2].equalsIgnoreCase(action)) {
                                result.add(entry.getValue());
                            }
                        }
                    }
                }
            }
        }
        return result;
    }
}
