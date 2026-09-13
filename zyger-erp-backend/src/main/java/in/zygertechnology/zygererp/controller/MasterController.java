package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.service.DocNumberService;
import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.*;
import jakarta.persistence.EntityManager;
import in.zygertechnology.zygererp.repository.ResourceMasterRepository;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.databind.JsonNode;
import in.zygertechnology.zygererp.security.RequirePermission;
import in.zygertechnology.zygererp.security.PublicAccess;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.crypto.password.PasswordEncoder;
import java.security.Principal;
import org.springframework.web.bind.annotation.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;

import java.security.Principal;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@RestController @RequiredArgsConstructor
@RequirePermission(module = "MASTER", screen = "*", action = "VIEW")
public class MasterController {
    private final ItemRepository items;
    private final PartyRepository parties;
    private final LocationRepository locs;
    private final RefDocRepository refs;
    private final WorkCenterRepository workCenters;
    private final MachineMasterRepository machines;
    private final OperationMasterRepository operations;
    private final ShiftCalendarRepository shifts;
    private final DocNumberService docNumbers;
    private final ItemBomComponentRepository bomRepo;
    private final ItemSupplierRepository itemSupplierRepo;
    private final jakarta.persistence.EntityManager em;
    private final BomMappingRepository bomMappings;
    private final SemiFgMappingRepository semiFgMappings;
    private final SemiFgMappingRmRepository semiFgMappingRms;
    private final FgMappingRepository fgMappings;
    private final FgMappingLineRepository fgMappingLines;
    private final MultiLevelBomRepository multiLevelBoms;
    private final MultiLevelBomLineRepository multiLevelBomLines;


    private String principalName(Principal p) { return p != null ? p.getName() : "system"; }

    private static final ObjectMapper _mapper = new ObjectMapper();

    @SuppressWarnings("unchecked")
    private <T> T mergePatch(T existing, ObjectNode incoming) {
        try {
            ObjectNode tree = (ObjectNode) _mapper.valueToTree(existing);
            for (var entry : incoming.properties()) {
                String key = entry.getKey();
                if (!"id".equals(key) && !"version".equals(key) && !"class".equals(key)) {
                    tree.set(key, entry.getValue());
                }
            }
            return (T) _mapper.treeToValue(tree, existing.getClass());
        } catch (Exception ex) {
            throw new RuntimeException("Merge failed", ex);
        }
    }

    @GetMapping("/api/master/parties/next-code")
    Map<String,String> nextPartyCode(@RequestParam(defaultValue="CUSTOMER") String kind) {
        String docType = switch (kind) {
            case "SUPPLIER" -> "supplier";
            case "SUBCONTRACTOR" -> "subcontractor";
            default -> "customer";
        };
        return Map.of("code", docNumbers.peek(docType));
    }

    @GetMapping("/api/master/uoms/next-code")
    Map<String,String> nextUomCode() { return Map.of("code", docNumbers.peek("uom")); }

    @GetMapping("/api/master/item-groups/next-code")
    Map<String,String> nextItemGroupCode() { return Map.of("code", docNumbers.peek("item-group")); }

    @GetMapping("/api/master/processes/next-code")
    Map<String,String> nextProcessCode() { return Map.of("code", docNumbers.peek("process")); }

    @GetMapping("/api/master/items/next-code")
    Map<String,String> nextItemCode(@RequestParam(defaultValue="PURCHASABLE") String itemType) {
        String docType = switch (itemType.toUpperCase()) {
            case "CUSTOMER_SUPPLIED" -> "item-customer";
            case "MANUFACTURING" -> "item-manufacturing";
            default -> "item-purchasable";
        };
        return Map.of("code", docNumbers.peek(docType));
    }

    @GetMapping("/api/master/process-groups/next-code")

    Map<String,String> nextProcessGroupCode() { return Map.of("code", docNumbers.peek("process-group")); }

    @GetMapping("/api/master/machines/next-code")
    Map<String,String> nextMachineCode() { return Map.of("code", docNumbers.peek("machine")); }

    @GetMapping("/api/master/instruments/next-code")
    Map<String,String> nextInstrumentCode() { return Map.of("code", docNumbers.peek("instrument")); }

    @GetMapping("/api/master/operators/next-code")
    Map<String,String> nextOperatorCode() { return Map.of("code", docNumbers.peek("operator")); }

    @GetMapping("/api/master/drawing-revisions/next-code")
    Map<String,String> nextDrawingRevisionCode() { return Map.of("code", docNumbers.peek("drawing-revision")); }

    @GetMapping("/api/master/tools/next-code")
    Map<String,String> nextToolCode() { return Map.of("code", docNumbers.peek("tool")); }

    @GetMapping("/api/master/work-centers/next-code")
    Map<String,String> nextWorkCenterCode() { return Map.of("code", docNumbers.peek("work-center")); }

    @GetMapping("/api/master/operations/next-code")
    Map<String,String> nextOperationCode() { return Map.of("code", docNumbers.peek("operation")); }

    @GetMapping("/api/master/locations/next-code")
    Map<String,String> nextLocationCode() { return Map.of("code", docNumbers.peek("location")); }

    @GetMapping("/api/master/items")
    @Transactional(readOnly = true)
    public Map<String,Object> itemPage(@RequestParam(defaultValue="0") int page,
                                       @RequestParam(defaultValue="200") int size,
                                       @RequestParam(required=false) String search,
                                       @RequestParam(required=false) String category,
                                       @RequestParam(required=false) String itemType,
                                       @RequestParam(required=false) String groupType,
                                       @RequestParam(required=false) String bomCategory,
                                       @RequestParam(required=false) String active,
                                       @RequestParam(required=false) String includeInactive) {
        List<ItemMaster> all = new ArrayList<>(items.findAll());
        if (!"true".equalsIgnoreCase(includeInactive)) all.removeIf(i -> !i.isActive());
        if (search != null && !search.isEmpty()) {
            String s = search.toLowerCase();
            all.removeIf(i -> {
                String haystack = Stream.of(i.getCode(), i.getDescription())
                    .filter(Objects::nonNull).collect(java.util.stream.Collectors.joining()).toLowerCase();
                return !haystack.contains(s);
            });
        }
        if (category != null && !category.isEmpty())
            all.removeIf(i -> !category.equals(i.getCategory()));
        if (itemType != null && !itemType.isEmpty())
            all.removeIf(i -> !itemType.equals(i.getItemType()));
        if (groupType != null && !groupType.isEmpty())
            all.removeIf(i -> i.getItemGroup() == null || !groupType.equals(groupToItemType(i.getItemGroup())));
        if (bomCategory != null && !bomCategory.isEmpty())
            all.removeIf(i -> !bomCategory.equals(bomBucket(i)));
        if (active != null && !active.isEmpty())
            all.removeIf(i -> !String.valueOf(i.isActive()).equals(active));
        all.sort(Comparator.comparing(ItemMaster::getCode));
        int total = all.size(), pages = Math.max(1, (int)Math.ceil((double)total/size));
        int from = Math.min(page*size, total), to = Math.min(from+size, total);
        Map<String,Object> out = new LinkedHashMap<>();
        out.put("content", all.subList(from, to).stream().map(this::itemToMap).toList());
        out.put("totalElements", total); out.put("totalPages", pages);
        out.put("number", page); out.put("size", size);
        return out;
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/items") @Transactional ItemMaster create(@RequestBody Map<String,Object> body){
        ItemMaster i = new ItemMaster();
        applyItemFields(i, body);
        deriveItemTypeFromGroup(i, body);
        i.setCode(docNumbers.allocate(itemDocType(i, body)));
        i.setId(null);
        return items.save(i);
    }
    @GetMapping("/api/master/items/{id}") ItemMaster getItem(@PathVariable Long id) {
        return items.findById(id).orElseThrow(() -> new RuntimeException("Item not found"));
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/items/{id}") @Transactional ItemMaster update(@PathVariable Long id, @RequestBody Map<String,Object> body){
        ItemMaster e = items.findById(id).orElseThrow(() -> new RuntimeException("Item not found"));
        applyItemFields(e, body);
        deriveItemTypeFromGroup(e, body);
        e.setId(id); e.setCode(e.getCode());
        return items.save(e);
    }

    private static final java.util.Set<String> KNOWN_ITEM_FIELDS = java.util.Set.of(
        "id","code","description","uom","category","defaultRate","safetyStock",
        "requiresBatch","requiresHeat","active","itemType","drawingNumber",
        "drawingRevision","revision","leadTimeDays","minOrderQty","orderMultiple",
        "shelfLifeDays","batchControl","serialControl","inspectionRequired",
        "defaultWarehouse","itemGroupId","itemGroup","materialGrade","specification",
        "productType","uomRefId","uomRef","drawingPath","dimensionType","hsCode",
        "weight","weightUom","minStockLevel","maxStockLevel","reorderPoint",
        "hsnCode","supplierLeadTime","avgDailyConsumption","storageCategory",
        "barcode","alternateItems","substituteItems","parentItem","materialType",
        "dimensions","tolerance","surfaceFinish","hardness","manufacturer",
        "purchaseUom","conversionFactor","defaultReceivingStore","customerOwned",
        "customerCode","version","createdBy","createdAt","updatedBy","updatedAt","extraData","reorderLevel"
    );

    private String itemDocType(ItemMaster i, Map<String,Object> b) {
        String t = i.getItemType() == null ? "" : i.getItemType().trim().toUpperCase();
        return switch (t) {
            case "SEMI_FG", "FG", "SFG", "MANUFACTURING" -> "item-manufacturing";
            case "CUSTOMER_SUPPLIED" -> "item-customer";
            case "RAW_MATERIAL", "PURCHASABLE" -> "item-purchasable";
            default -> {
                String g = b.get("groupType") == null ? "" : String.valueOf(b.get("groupType")).toUpperCase();
                if (g.contains("MANUFACTUR")) yield "item-manufacturing";
                if (g.contains("CUSTOMER")) yield "item-customer";
                yield "item-purchasable";
            }
        };
    }

    private void applyItemFields(ItemMaster i, Map<String,Object> b) {
        if (b.containsKey("code")) i.setCode((String) b.get("code"));        if (b.containsKey("description")) i.setDescription((String) b.get("description"));
        if (b.containsKey("uom")) i.setUom((String) b.get("uom"));
        if (b.containsKey("category")) i.setCategory((String) b.get("category"));
        if (b.containsKey("defaultRate")) i.setDefaultRate(b.get("defaultRate") != null ? new java.math.BigDecimal(b.get("defaultRate").toString()) : null);
        if (b.containsKey("safetyStock")) i.setSafetyStock(b.get("safetyStock") != null ? new java.math.BigDecimal(b.get("safetyStock").toString()) : null);
        if (b.containsKey("requiresBatch")) i.setRequiresBatch(Boolean.TRUE.equals(b.get("requiresBatch")));
        if (b.containsKey("requiresHeat")) i.setRequiresHeat(Boolean.TRUE.equals(b.get("requiresHeat")));
        if (b.containsKey("active")) i.setActive(Boolean.TRUE.equals(b.get("active")));
        if (b.containsKey("itemType")) i.setItemType((String) b.get("itemType"));
        if (b.containsKey("drawingNumber")) i.setDrawingNumber((String) b.get("drawingNumber"));
        if (b.containsKey("drawingRevision")) i.setDrawingRevision((String) b.get("drawingRevision"));
        if (b.containsKey("revision")) i.setRevision((String) b.get("revision"));
        if (b.containsKey("leadTimeDays")) i.setLeadTimeDays(b.get("leadTimeDays") != null ? Integer.valueOf(b.get("leadTimeDays").toString()) : null);
        if (b.containsKey("minOrderQty")) i.setMinOrderQty(b.get("minOrderQty") != null ? new java.math.BigDecimal(b.get("minOrderQty").toString()) : null);
        if (b.containsKey("orderMultiple")) i.setOrderMultiple(b.get("orderMultiple") != null ? new java.math.BigDecimal(b.get("orderMultiple").toString()) : null);
        if (b.containsKey("shelfLifeDays")) i.setShelfLifeDays(b.get("shelfLifeDays") != null ? Integer.valueOf(b.get("shelfLifeDays").toString()) : null);
        if (b.containsKey("batchControl")) {
            boolean bc = Boolean.TRUE.equals(b.get("batchControl"));
            i.setBatchControl(bc);
            i.setRequiresBatch(bc);
        }
        if (b.containsKey("serialControl")) i.setSerialControl(Boolean.TRUE.equals(b.get("serialControl")));
        if (b.containsKey("inspectionRequired")) i.setInspectionRequired(Boolean.TRUE.equals(b.get("inspectionRequired")));
        if (b.containsKey("defaultWarehouse")) i.setDefaultWarehouse((String) b.get("defaultWarehouse"));
        if (b.containsKey("materialGrade")) i.setMaterialGrade((String) b.get("materialGrade"));
        if (b.containsKey("specification")) i.setSpecification((String) b.get("specification"));
        if (b.containsKey("productType")) i.setProductType((String) b.get("productType"));
        if (b.containsKey("drawingPath")) i.setDrawingPath((String) b.get("drawingPath"));
        if (b.containsKey("dimensionType")) i.setDimensionType((String) b.get("dimensionType"));
        if (b.containsKey("hsCode")) i.setHsCode((String) b.get("hsCode"));
        if (b.containsKey("weight")) i.setWeight(b.get("weight") != null ? new java.math.BigDecimal(b.get("weight").toString()) : null);
        else if (b.containsKey("netWeight")) i.setWeight(b.get("netWeight") != null ? new java.math.BigDecimal(b.get("netWeight").toString()) : null);
        if (b.containsKey("weightUom")) i.setWeightUom((String) b.get("weightUom"));
        if (b.containsKey("minStockLevel")) i.setMinStockLevel(b.get("minStockLevel") != null ? new java.math.BigDecimal(b.get("minStockLevel").toString()) : null);
        if (b.containsKey("maxStockLevel")) i.setMaxStockLevel(b.get("maxStockLevel") != null ? new java.math.BigDecimal(b.get("maxStockLevel").toString()) : null);
        if (b.containsKey("reorderPoint")) i.setReorderPoint(b.get("reorderPoint") != null ? new java.math.BigDecimal(b.get("reorderPoint").toString()) : null);
        if (b.containsKey("hsnCode")) i.setHsnCode((String) b.get("hsnCode"));
        if (b.containsKey("supplierLeadTime")) i.setSupplierLeadTime(b.get("supplierLeadTime") != null ? Integer.valueOf(b.get("supplierLeadTime").toString()) : null);
        if (b.containsKey("avgDailyConsumption")) i.setAvgDailyConsumption(b.get("avgDailyConsumption") != null ? new java.math.BigDecimal(b.get("avgDailyConsumption").toString()) : null);
        if (b.containsKey("storageCategory")) i.setStorageCategory((String) b.get("storageCategory"));
        if (b.containsKey("barcode")) i.setBarcode((String) b.get("barcode"));
        if (b.containsKey("alternateItems")) i.setAlternateItems((String) b.get("alternateItems"));
        if (b.containsKey("substituteItems")) i.setSubstituteItems((String) b.get("substituteItems"));
        if (b.containsKey("parentItem")) i.setParentItem((String) b.get("parentItem"));
        if (b.containsKey("materialType")) i.setMaterialType((String) b.get("materialType"));
        if (b.containsKey("dimensions")) i.setDimensions((String) b.get("dimensions"));
        if (b.containsKey("tolerance")) i.setTolerance((String) b.get("tolerance"));
        if (b.containsKey("surfaceFinish")) i.setSurfaceFinish((String) b.get("surfaceFinish"));
        if (b.containsKey("hardness")) i.setHardness((String) b.get("hardness"));
        if (b.containsKey("manufacturer")) i.setManufacturer((String) b.get("manufacturer"));
        if (b.containsKey("purchaseUom")) i.setPurchaseUom((String) b.get("purchaseUom"));
        if (b.containsKey("conversionFactor")) i.setConversionFactor(b.get("conversionFactor") != null ? new java.math.BigDecimal(b.get("conversionFactor").toString()) : null);
        if (b.containsKey("defaultReceivingStore")) i.setDefaultReceivingStore((String) b.get("defaultReceivingStore"));
        if (b.containsKey("customerOwned")) i.setCustomerOwned(Boolean.TRUE.equals(b.get("customerOwned")));
        if (b.containsKey("customerCode")) i.setCustomerCode((String) b.get("customerCode"));
        if (b.containsKey("reorderLevel")) i.setReorderPoint(b.get("reorderLevel") != null ? new java.math.BigDecimal(b.get("reorderLevel").toString()) : null);
        if (b.containsKey("itemGroupId") && b.get("itemGroupId") != null) {
            i.setItemGroup(itemGroups.findById(Long.valueOf(b.get("itemGroupId").toString())).orElse(null));
        } else if (b.containsKey("itemGroup") && b.get("itemGroup") != null && b.get("itemGroup") instanceof String s && !s.isBlank()) {
            ItemGroup ig = itemGroups.findByCode(s).or(() -> itemGroups.findAll().stream().filter(g -> s.equalsIgnoreCase(g.getName()) || s.equalsIgnoreCase(g.getCode())).findFirst()).orElse(null);
            i.setItemGroup(ig);
        }
        if (b.containsKey("uomRefId") && b.get("uomRefId") != null) {
            i.setUomRef(uoms.findById(Long.valueOf(b.get("uomRefId").toString())).orElse(null));
        } else if (b.containsKey("uomRef") && b.get("uomRef") != null && b.get("uomRef") instanceof String s && !s.isBlank()) {
            i.setUomRef(uoms.findByCode(s).orElse(null));
        }

        Map<String,Object> extra = new LinkedHashMap<>();
        if (i.getExtraData() != null && !i.getExtraData().isBlank()) {
            try {
                ObjectMapper om = new ObjectMapper();
                @SuppressWarnings("unchecked")
                Map<String,Object> existing = om.readValue(i.getExtraData(), Map.class);
                extra.putAll(existing);
            } catch (Exception ignored) {}
        }
        for (Map.Entry<String,Object> e : b.entrySet()) {
            if (!KNOWN_ITEM_FIELDS.contains(e.getKey())) {
                if (e.getValue() != null) {
                    extra.put(e.getKey(), e.getValue());
                } else {
                    extra.remove(e.getKey());
                }
            }
        }
        if (i.getItemGroup() == null && b.containsKey("itemGroup") && b.get("itemGroup") != null) {
            extra.put("itemGroup", b.get("itemGroup"));
        }
        if (!extra.isEmpty()) {
            try {
                ObjectMapper om = new ObjectMapper();
                i.setExtraData(om.writeValueAsString(extra));
            } catch (Exception ignored) {}
        }
    }

    /** The Item Group is the source of truth: its type drives the item's type. */
    private String groupToItemType(ItemGroup g) {
        if (g == null || g.getItemType() == null) return null;
        String t = g.getItemType().trim().toUpperCase().replace("-", "_").replace(" ", "_");
        return switch (t) {
            case "SEMI_FG", "SFG" -> "SEMI_FG";
            case "RM", "RAW_MATERIAL" -> "RAW_MATERIAL";
            case "FG", "MANUFACTURING", "MANUFACTURING_ITEM" -> "FG";
            case "PURCHASABLE", "PURCHASABLE_ITEM" -> "PURCHASABLE";
            case "CUSTOMER_SUPPLIED", "CUSTOMER_SUPPLIED_ITEM" -> "CUSTOMER_SUPPLIED";
            default -> t;
        };
    }

    /** BOM Mapping routes an item by its Item Group first; no-group items fall back to their item type. */
    private String bomBucket(ItemMaster i) {
        String g = groupToItemType(i.getItemGroup());
        if (g != null) return g;
        if (i.getItemType() == null) return "";
        return i.getItemType().trim().toUpperCase().replace("-", "_").replace(" ", "_");
    }

    /** The screen decides the category; the group only refines the type within that category. No screen signal => group is the source of truth. */
    private void deriveItemTypeFromGroup(ItemMaster i, Map<String,Object> b) {
        if (Boolean.TRUE.equals(i.getCustomerOwned())) {
            i.setItemType("CUSTOMER_SUPPLIED");
            return;
        }
        String screen = b.get("groupType") == null ? "" : String.valueOf(b.get("groupType")).toUpperCase();
        if (screen.contains("CUSTOMER")) {
            i.setItemType("CUSTOMER_SUPPLIED");
            return;
        }
        String t = groupToItemType(i.getItemGroup());
        if (screen.contains("MANUFACTUR")) {
            boolean valid = t != null && ("FG".equals(t) || "SEMI_FG".equals(t) || "SFG".equals(t) || "MANUFACTURING".equals(t));
            i.setItemType(valid ? t : "FG");
            return;
        }
        if (!screen.isBlank()) {
            boolean valid = t != null && ("RAW_MATERIAL".equals(t) || "PURCHASABLE".equals(t));
            i.setItemType(valid ? t : "RAW_MATERIAL");
            return;
        }
        if (t != null) i.setItemType(t);
    }

    private Map<String,Object> itemToMap(ItemMaster i) {
        Map<String,Object> m = new LinkedHashMap<>();
        m.put("id", i.getId()); m.put("code", i.getCode()); m.put("description", i.getDescription());
        m.put("name", i.getName()); m.put("uom", i.getUom()); m.put("category", i.getCategory()); m.put("active", i.isActive());
        m.put("itemType", i.getItemType()); m.put("weight", i.getWeight()); m.put("netWeight", i.getWeight()); m.put("drawingNumber", i.getDrawingNumber());
        m.put("hsnCode", i.getHsnCode()); m.put("batchControl", i.getBatchControl());
        m.put("inspectionRequired", i.getInspectionRequired()); m.put("reorderPoint", i.getReorderPoint());
        m.put("minOrderQty", i.getMinOrderQty()); m.put("safetyStock", i.getSafetyStock());
        m.put("customerOwned", i.getCustomerOwned()); m.put("customerCode", i.getCustomerCode());
        m.put("materialGrade", i.getMaterialGrade()); m.put("specification", i.getSpecification());
        m.put("productType", i.getProductType()); m.put("drawingPath", i.getDrawingPath());
        m.put("dimensionType", i.getDimensionType()); m.put("hsCode", i.getHsCode());
        m.put("weightUom", i.getWeightUom()); m.put("minStockLevel", i.getMinStockLevel());
        m.put("maxStockLevel", i.getMaxStockLevel()); m.put("supplierLeadTime", i.getSupplierLeadTime());
        m.put("avgDailyConsumption", i.getAvgDailyConsumption()); m.put("storageCategory", i.getStorageCategory());
        m.put("barcode", i.getBarcode()); m.put("alternateItems", i.getAlternateItems());
        m.put("substituteItems", i.getSubstituteItems()); m.put("parentItem", i.getParentItem());
        m.put("materialType", i.getMaterialType()); m.put("dimensions", i.getDimensions());
        m.put("tolerance", i.getTolerance()); m.put("surfaceFinish", i.getSurfaceFinish());
        m.put("hardness", i.getHardness()); m.put("manufacturer", i.getManufacturer());
        m.put("purchaseUom", i.getPurchaseUom()); m.put("conversionFactor", i.getConversionFactor());
        m.put("defaultReceivingStore", i.getDefaultReceivingStore());
        if (i.getItemGroup() != null) {
            m.put("itemGroup", i.getItemGroup().getCode());
            m.put("itemGroupName", i.getItemGroup().getName());
            m.put("itemGroupType", i.getItemGroup().getItemType());
        }
        m.put("groupItemType", groupToItemType(i.getItemGroup()));
        m.put("bomCategory", bomBucket(i));
        if (i.getExtraData() != null && !i.getExtraData().isBlank()) {
            try {
                ObjectMapper om = new ObjectMapper();
                @SuppressWarnings("unchecked")
                Map<String,Object> extra = om.readValue(i.getExtraData(), Map.class);
                m.putAll(extra);
            } catch (Exception ignored) {}
        }
        if (i.getItemGroup() != null) {
            m.put("itemGroup", i.getItemGroup().getCode());
        }
        return m;
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/items/{id}") void del(@PathVariable Long id){ items.findById(id).ifPresent(i -> { i.setActive(false); items.save(i); }); }

    @GetMapping("/api/master/items/{code}/bom")
    public List<ItemBomComponent> getItemBom(@PathVariable String code) {
        return bomRepo.findByParentItemCodeOrderByIdAsc(code);
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/items/{code}/bom")
    @Transactional
    public List<ItemBomComponent> saveItemBom(@PathVariable String code, @RequestBody List<ItemBomComponent> components) {
        bomRepo.deleteByParentItemCode(code);
        for (ItemBomComponent c : components) {
            c.setId(null);
            c.setParentItemCode(code);
        }
        return bomRepo.saveAll(components);
    }

    @GetMapping("/api/master/items/{code}/suppliers")
    public List<ItemSupplier> getItemSuppliers(@PathVariable String code) {
        return itemSupplierRepo.findByItemCodeOrderByIdAsc(code);
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/items/{code}/suppliers")
    @Transactional
    public List<ItemSupplier> saveItemSuppliers(@PathVariable String code, @RequestBody List<ItemSupplier> suppliers) {
        itemSupplierRepo.deleteByItemCode(code);
        for (ItemSupplier s : suppliers) {
            s.setId(null);
            s.setItemCode(code);
        }
        return itemSupplierRepo.saveAll(suppliers);
    }


    @Cacheable(value = "masterRefs", key = "'suppliers'") @GetMapping("/api/master/suppliers") List<Party> sup(){ return parties.findByKind("SUPPLIER").stream().filter(Party::isActive).toList(); }
    @Cacheable(value = "masterRefs", key = "'customers'") @GetMapping("/api/master/customers") List<Party> cus(){ return parties.findByKind("CUSTOMER").stream().filter(Party::isActive).toList(); }

    // ---- Party CRUD (suppliers & customers) ----
    @GetMapping("/api/master/parties/{id}")
    Party getParty(@PathVariable Long id) {
        return parties.findById(id).orElseThrow(() -> new IllegalArgumentException("Party not found"));
    }

    @GetMapping("/api/master/parties") Map<String,Object> partyPage(
            @RequestParam(defaultValue="0") int page,
            @RequestParam(defaultValue="200") int size,
            @RequestParam(required=false) String search,
            @RequestParam(required=false) String kind,
            @RequestParam(required=false) Boolean activeOnly) {
        List<Party> all = new ArrayList<>();
        if (kind != null && !kind.isEmpty()) {
            all.addAll(parties.findByKind(kind));
        } else {
            all.addAll(parties.findAll());
        }
        if (Boolean.TRUE.equals(activeOnly)) {
            all.removeIf(p -> !p.isActive());
        }
        if (search != null && !search.isEmpty()) {
            String s = search.toLowerCase();
            all.removeIf(p -> {
                String haystack = Stream.of(p.getCode(), p.getName(), p.getContactPerson())
                    .filter(Objects::nonNull).collect(java.util.stream.Collectors.joining()).toLowerCase();
                return !haystack.contains(s);
            });
        }
        all.sort(Comparator.comparing(Party::getCode));
        int total = all.size(), pages = Math.max(1, (int)Math.ceil((double)total/size));
        int from = Math.min(page*size, total), to = Math.min(from+size, total);
        Map<String,Object> out = new LinkedHashMap<>();
        out.put("content", all.subList(from, to));
        out.put("totalElements", total); out.put("totalPages", pages);
        out.put("number", page); out.put("size", size);
        return out;
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/parties") Party createParty(@RequestBody Party p, Principal principal) {
        p.setId(null);
        p.setCode(docNumbers.allocate(partyDocType(p)));
        if (p.getCreatedBy() == null) p.setCreatedBy(principalName(principal));
        p.setCreatedAt(java.time.Instant.now());
        return parties.save(p);
    }

    private String partyDocType(Party p) {
        if (p.getKind() == null) return "customer";
        return switch (p.getKind().trim().toUpperCase()) {
            case "SUPPLIER" -> "supplier";
            case "SUBCONTRACTOR" -> "subcontractor";
            default -> "customer";
        };
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/parties/{id}") @Transactional Party updateParty(@PathVariable Long id, @RequestBody ObjectNode body, Principal principal) {
        Party e = parties.findById(id).orElseThrow(() -> new RuntimeException("Party not found"));
        Party merged = mergePatch(e, body);
        merged.setId(id); merged.setVersion(e.getVersion()); merged.setCreatedBy(e.getCreatedBy()); merged.setCreatedAt(e.getCreatedAt());
        merged.setUpdatedAt(java.time.Instant.now()); merged.setUpdatedBy(principalName(principal));
        return parties.save(merged);
    }

    // Soft-delete by default: a customer/supplier can be referenced by documents (POs, invoices,
    // sales orders) created long after this call returns, with no FK to guard against a hard
    // delete — deactivating instead keeps the record (and its code/history) recoverable and
    // never silently erases it. Deactivated parties already drop out of every active-party lookup
    // (sup()/cus() above) and out of the master list when the frontend passes activeOnly=true;
    // by default the list still shows them, marked Inactive, so deletions stay visible/auditable.
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/parties/{id}") void delParty(@PathVariable Long id) {
        parties.findById(id).ifPresent(p -> {
            p.setActive(false);
            p.setCustomerStatus("Inactive");
            parties.save(p);
        });
    }

    // ---- Location CRUD ----
    @GetMapping("/api/inventory/locations") List<LocationMaster> loc(){ return locs.findAll().stream().filter(LocationMaster::isActive).toList(); }
    @GetMapping("/api/inventory/locations/{id}") LocationMaster getLoc(@PathVariable Long id){ return locs.findById(id).orElseThrow(); }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/inventory/locations") LocationMaster createLoc(@RequestBody LocationMaster l, Principal principal) {
        l.setId(null);
        l.setCode(docNumbers.allocate("location"));
        if (l.getCreatedBy() == null) l.setCreatedBy(principalName(principal));
        l.setCreatedAt(java.time.Instant.now());
        return locs.save(l);
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/inventory/locations/{id}") @Transactional LocationMaster updateLoc(@PathVariable Long id, @RequestBody ObjectNode body, Principal principal) {
        LocationMaster e = locs.findById(id).orElseThrow(() -> new RuntimeException("Location not found"));
        LocationMaster merged = mergePatch(e, body);
        merged.setId(id); merged.setVersion(e.getVersion()); merged.setCreatedBy(e.getCreatedBy()); merged.setCreatedAt(e.getCreatedAt());
        merged.setUpdatedAt(java.time.Instant.now()); merged.setUpdatedBy(principalName(principal));
        return locs.save(merged);
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/inventory/locations/{id}") void delLoc(@PathVariable Long id) { locs.findById(id).ifPresent(l -> { l.setActive(false); locs.save(l); }); }

    @GetMapping("/api/master/departments") List<String> depts(){ return List.of("Production","Maintenance","Quality","Tool Room","Stores"); }
    @GetMapping("/api/purchase-orders") List<RefDoc> po(@RequestParam(required=false) String status){ return refs.findByKind("PO"); }
    @GetMapping("/api/job-orders") List<RefDoc> jo(){ return refs.findByKind("JO"); }
    @GetMapping("/api/labour-orders") List<RefDoc> lo(){ return refs.findByKind("LO"); }

    // ---- Work Centers ----
    @Cacheable(value = "masterRefs", key = "'work-centers'") @GetMapping("/api/master/work-centers") List<WorkCenter> workCenters(){ return workCenters.findAll().stream().filter(WorkCenter::isActive).toList(); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/work-centers") WorkCenter createWC(@RequestBody WorkCenter wc){ wc.setId(null); wc.setCode(docNumbers.allocate("work-center")); return workCenters.save(wc); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/work-centers/{id}") @Transactional WorkCenter updateWC(@PathVariable Long id, @RequestBody ObjectNode body){
        WorkCenter e = workCenters.findById(id).orElseThrow(() -> new RuntimeException("Work Center not found"));
        WorkCenter merged = mergePatch(e, body);
        merged.setId(id); merged.setVersion(e.getVersion());
        return workCenters.save(merged); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/work-centers/{id}") void delWC(@PathVariable Long id){ workCenters.findById(id).ifPresent(w -> { w.setActive(false); workCenters.save(w); }); }

    // ---- Machines ----
    @Cacheable(value = "masterRefs", key = "'machines'") @GetMapping("/api/master/machines") List<MachineMaster> machines(){ return machines.findAll().stream().filter(MachineMaster::isActive).toList(); }
    @GetMapping("/api/master/machines/{id}") MachineMaster getMachine(@PathVariable Long id){ return machines.findById(id).orElseThrow(); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/machines") MachineMaster createMachine(@RequestBody MachineMaster m){ m.setId(null); m.setCode(docNumbers.allocate("machine")); return machines.save(m); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/machines/{id}") @Transactional MachineMaster updateMachine(@PathVariable Long id, @RequestBody ObjectNode body){
        MachineMaster e = machines.findById(id).orElseThrow(() -> new RuntimeException("Machine not found"));
        MachineMaster merged = mergePatch(e, body);
        merged.setId(id); merged.setVersion(e.getVersion());
        return machines.save(merged); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/machines/{id}") void delMachine(@PathVariable Long id){ machines.findById(id).ifPresent(m -> { m.setActive(false); machines.save(m); }); }

    // ---- Operations ----
    @Cacheable(value = "masterRefs", key = "'operations'") @GetMapping("/api/master/operations") List<OperationMaster> operations(){ return operations.findAll().stream().filter(OperationMaster::isActive).toList(); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/operations") OperationMaster createOp(@RequestBody OperationMaster o){ o.setId(null); o.setCode(docNumbers.allocate("operation")); return operations.save(o); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/operations/{id}") @Transactional OperationMaster updateOp(@PathVariable Long id, @RequestBody ObjectNode body){
        OperationMaster e = operations.findById(id).orElseThrow(() -> new RuntimeException("Operation not found"));
        OperationMaster merged = mergePatch(e, body);
        merged.setId(id); merged.setVersion(e.getVersion());
        return operations.save(merged); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/operations/{id}") void delOp(@PathVariable Long id){ operations.findById(id).ifPresent(o -> { o.setActive(false); operations.save(o); }); }

    // ---- Shift Calendar ----
    @GetMapping("/api/master/shifts/next-code")
    Map<String,String> nextShiftCode() { return Map.of("code", "SH"+String.format("%03d", shifts.count()+1)); }
    @Cacheable(value = "masterRefs", key = "'shifts'") @GetMapping("/api/master/shifts") List<ShiftCalendar> shifts(){ return shifts.findAll().stream().filter(ShiftCalendar::isActive).toList(); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/shifts") ShiftCalendar createShift(@RequestBody ShiftCalendar s){ s.setId(null); return shifts.save(s); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/shifts/{id}") @Transactional ShiftCalendar updateShift(@PathVariable Long id, @RequestBody ObjectNode body){
        ShiftCalendar e = shifts.findById(id).orElseThrow(() -> new RuntimeException("Shift not found"));
        ShiftCalendar merged = mergePatch(e, body);
        merged.setId(id); merged.setVersion(e.getVersion());
        return shifts.save(merged); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/shifts/{id}") void delShift(@PathVariable Long id){ shifts.findById(id).ifPresent(s -> { s.setActive(false); shifts.save(s); }); }

    // ================================================================
    //  MASTER MODULE V9 — New master data CRUD
    // ================================================================
    private final UOMMasterRepository uoms;
    private final ItemGroupRepository itemGroups;
    private final StoreMasterRepository stores;
    private final ProcessGroupRepository processGroups;
    private final ProcessMasterRepository processMasters;
    private final InstrumentMasterRepository instruments;
    private final ToolMasterRepository toolMasters;
    private final CompanyInfoRepository companyInfos;
    private final MasterAuditLogRepository auditLogs;
    private final OperatorMasterRepository operators;
    private final DrawingRevisionRepository drawingRevisions;

    // ---- UOM Master ----
    @Cacheable(value = "masterRefs", key = "'uoms-' + (#activeOnly == null ? 'all' : #activeOnly)")
    @GetMapping("/api/master/uoms")
    List<Map<String,Object>> uomList(@RequestParam(required = false) Boolean activeOnly) {
        return uoms.findAll().stream()
            .filter(u -> activeOnly == null || !activeOnly || u.isActive())
            .map(u -> {
                Map<String,Object> m = new LinkedHashMap<>();
                m.put("id", u.getId()); m.put("code", u.getCode()); m.put("name", u.getName());
                m.put("description", u.getDescription()); m.put("active", u.isActive());
                return m;
            }).toList();
    }
    @GetMapping("/api/master/uoms/{id}") UOMMaster getUom(@PathVariable Long id){
        return uoms.findById(id).orElseThrow(() -> new RuntimeException("UOM not found"));
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/uoms") UOMMaster createUom(@RequestBody UOMMaster u){ u.setId(null); u.setCode(docNumbers.allocate("uom")); return uoms.save(u); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/uoms/{id}") @Transactional UOMMaster updateUom(@PathVariable Long id, @RequestBody ObjectNode body){
        UOMMaster e = uoms.findById(id).orElseThrow(() -> new RuntimeException("UOM not found"));
        UOMMaster merged = mergePatch(e, body);
        merged.setId(id); merged.setVersion(e.getVersion());
        return uoms.save(merged);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/uoms/{id}") void delUom(@PathVariable Long id){
        try {
            uoms.deleteById(id);
        } catch (Exception e) {
            uoms.findById(id).ifPresent(u -> { u.setActive(false); uoms.save(u); });
        }
    }

    // ---- Item Group ----
    @GetMapping("/api/master/item-groups") @Transactional(readOnly = true)
    List<Map<String,Object>> itemGroupList(@RequestParam(defaultValue = "true") boolean activeOnly) {
        return itemGroups.findAll().stream().filter(g -> !activeOnly || g.isActive()).map(g -> {
            Map<String,Object> m = new LinkedHashMap<>();
            m.put("id", g.getId()); m.put("code", g.getCode()); m.put("name", g.getName());
            m.put("itemType", g.getItemType()); m.put("description", g.getDescription()); m.put("active", g.isActive());
            m.put("parentId", g.getParent() != null ? g.getParent().getId() : null);
            m.put("parentCode", g.getParent() != null ? g.getParent().getCode() : null);
            m.put("createdAt", g.getCreatedAt()); m.put("updatedAt", g.getUpdatedAt());
            return m;
        }).toList();
    }
    @GetMapping("/api/master/item-groups/{id}") ItemGroup getItemGroup(@PathVariable Long id){
        return itemGroups.findById(id).orElseThrow(() -> new RuntimeException("Item Group not found"));
    }
    /** When no item type is supplied, assign one from the group's name, else default to PURCHASABLE. Canonical values preserve MANUFACTURING (do not fold into FG) so typed group pickers can filter on it. */
    private String resolveGroupItemType(ItemGroup g) {
        String t = g.getItemType();
        if (t != null && !t.isBlank()) return normalizeGroupType(t);
        String n = (g.getName() == null ? "" : g.getName()).trim().toUpperCase().replace("-", "_").replace(" ", "_");
        if (n.equals("SEMI_FG") || n.equals("SFG")) return "SEMI_FG";
        if (n.equals("RM") || n.equals("RAW_MATERIAL")) return "RAW_MATERIAL";
        if (n.equals("FG")) return "FG";
        if (n.equals("MANUFACTURING") || n.equals("MANUFACTURING_ITEM")) return "MANUFACTURING";
        if (n.equals("CUSTOMER_SUPPLIED")) return "CUSTOMER_SUPPLIED";
        return "PURCHASABLE";
    }

    /** Canonicalizes a group item type, keeping the three user-facing kinds (and legacy values) distinct. */
    private String normalizeGroupType(String t) {
        String v = t.trim().toUpperCase().replace("-", "_").replace(" ", "_");
        return switch (v) {
            case "RAW_MATERIAL", "RM" -> "RAW_MATERIAL";
            case "SEMI_FG", "SFG" -> "SEMI_FG";
            case "FG" -> "FG";
            case "MANUFACTURING", "MANUFACTURING_ITEM" -> "MANUFACTURING";
            case "CUSTOMER_SUPPLIED", "CUSTOMER_SUPPLIED_ITEM" -> "CUSTOMER_SUPPLIED";
            default -> "PURCHASABLE";
        };
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/item-groups") ItemGroup createItemGroup(@RequestBody ItemGroup g, Principal principal){
        g.setId(null); g.setCode(docNumbers.allocate("item-group"));
        g.setItemType(resolveGroupItemType(g));
        if (g.getCreatedBy() == null) g.setCreatedBy(principalName(principal));
        g.setCreatedAt(java.time.Instant.now()); g.setUpdatedAt(java.time.Instant.now());
        return itemGroups.save(g);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/item-groups/{id}") @Transactional ItemGroup updateItemGroup(@PathVariable Long id, @RequestBody ObjectNode body, Principal principal){
        ItemGroup e = itemGroups.findById(id).orElseThrow(() -> new RuntimeException("Item Group not found"));
        ItemGroup merged = mergePatch(e, body);
        merged.setItemType(resolveGroupItemType(merged));
        merged.setId(id); merged.setVersion(e.getVersion()); merged.setCreatedBy(e.getCreatedBy()); merged.setCreatedAt(e.getCreatedAt());
        merged.setUpdatedAt(java.time.Instant.now()); merged.setUpdatedBy(principalName(principal));
        if (body.has("parentId") && !body.get("parentId").isNull()) {
            merged.setParent(itemGroups.findById(body.get("parentId").asLong()).orElse(null));
        } else if (body.has("parentId") && body.get("parentId").isNull()) {
            merged.setParent(null);
        }
        return itemGroups.save(merged);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/item-groups/{id}") @Transactional Map<String,Object> delItemGroup(@PathVariable Long id){
        ItemGroup g = itemGroups.findById(id).orElseThrow(() -> new RuntimeException("Item Group not found"));
        Map<String,Object> out = new LinkedHashMap<>();
        long refs = items.countByItemGroupId(id) + itemGroups.countByParentId(id);
        if (refs > 0L) {
            g.setActive(false);
            g.setUpdatedAt(java.time.Instant.now());
            itemGroups.save(g);
            out.put("deleted", false); out.put("deactivated", true);
            out.put("message", "Item Group is in use (" + refs + " reference(s)) and cannot be deleted. It has been deactivated instead.");
            return out;
        }
        itemGroups.delete(g);
        out.put("deleted", true); out.put("deactivated", false); out.put("message", "Item Group deleted.");
        return out;
    }

    // ---- BOM Mapping (fresh CRUD: BMP / SFM / FGM / MBM) ----

    @GetMapping("/api/master/bom-mappings") @Transactional(readOnly = true)
    List<Map<String,Object>> bomMappingList(@RequestParam(defaultValue = "true") boolean activeOnly) {
        return bomMappings.findAllByOrderByAutoCode().stream()
            .filter(b -> !activeOnly || b.isActive())
            .map(b -> {
                List<FgMapping> fgms = fgMappings.findByBomMappingIdOrderByAutoCodeAsc(b.getId());
                List<SemiFgMapping> semis = semiFgMappings.findByBomMappingIdOrderByAutoCodeAsc(b.getId());
                List<Long> semiIds = semis.stream().map(SemiFgMapping::getId).toList();
                long rmCount = semiIds.isEmpty() ? 0L
                    : semiFgMappingRms.findBySemiFgMappingIdIn(semiIds).stream().count();
                List<MultiLevelBom> mbms = multiLevelBoms.findByBomMappingIdOrderByAutoCodeAsc(b.getId());
                Map<String,Object> m = new LinkedHashMap<>();
                m.put("id", b.getId());
                m.put("bmId", b.getId());
                m.put("code", b.getAutoCode());
                m.put("name", b.getName());
                m.put("fgCount", (long) fgms.size());
                m.put("semiFgCount", (long) semis.size());
                m.put("rmCount", rmCount);
                m.put("multiLevelCount", (long) mbms.size());
                m.put("active", b.isActive());
                return m;
            })
            .toList();
    }

    @GetMapping("/api/master/bom-mappings/next-codes") @Transactional(readOnly = true)
    Map<String,String> bomMappingNextCodes() {
        int y = java.time.Year.now().getValue();
        Map<String,String> out = new LinkedHashMap<>();
        out.put("bmp", bomMappingNextCode("BMM", y, bomMappings.findAll().stream().map(BomMapping::getAutoCode).toList()));
        out.put("sfm", bomMappingNextCode("SFM", y, semiFgMappings.findAll().stream().map(SemiFgMapping::getAutoCode).toList()));
        out.put("fgm", bomMappingNextCode("FGM", y, fgMappings.findAll().stream().map(FgMapping::getAutoCode).toList()));
        out.put("mbm", bomMappingNextCode("MBM", y, multiLevelBoms.findAll().stream().map(MultiLevelBom::getAutoCode).toList()));
        return out;
    }

    private String bomMappingNextCode(String prefix, int year, List<String> codes) {
        int max = codes.stream()
            .filter(c -> c != null && (c.startsWith(prefix + "-") || ("BMM".equals(prefix) && c.startsWith("BOM-"))))
            .mapToInt(c -> {
                try { return Integer.parseInt(c.substring(c.lastIndexOf('-') + 1)); } catch (Exception e) { return 0; }
            }).max().orElse(0);
        return prefix + "-" + year + "-" + String.format("%04d", max + 1);
    }

    @GetMapping("/api/master/bom-mappings/editor/{id}") @Transactional(readOnly = true)
    Map<String,Object> getBomMappingEditor(@PathVariable Long id) {
        BomMapping b = bomMappings.findById(id).orElseThrow(() -> new IllegalArgumentException("BOM Mapping not found"));
        return buildBomMappingEditorView(b);
    }

    @GetMapping("/api/master/bom-mappings/{id}") @Transactional(readOnly = true)
    Map<String,Object> getBomMapping(@PathVariable Long id) {
        BomMapping b = bomMappings.findById(id).orElseThrow(() -> new IllegalArgumentException("BOM Mapping not found"));
        return buildBomMappingEditorView(b);
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/bom-mappings") @Transactional
    Map<String,Object> createBomMapping(@RequestBody JsonNode body) {
        String name = text(body.get("name"));
        if (name == null || name.isBlank()) throw new IllegalArgumentException("BOM Mapping Name is required");
        String autoCode = text(body.get("autoCode"));
        if (autoCode == null || autoCode.isBlank()) {
            autoCode = bomMappingNextCode("BOM", java.time.Year.now().getValue(), bomMappings.findAll().stream().map(BomMapping::getAutoCode).toList());
        }
        if (bomMappings.existsByAutoCode(autoCode.trim())) throw new IllegalStateException("Auto code already in use: " + autoCode.trim());
        BomMapping b = bomMappings.save(BomMapping.builder()
            .autoCode(autoCode.trim()).name(name.trim())
            .active(!body.has("active") || body.get("active").asBoolean(true)).build());
        populateSections(b.getId(), body);
        return buildBomMappingEditorView(b);
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/bom-mappings/{id}") @Transactional
    Map<String,Object> updateBomMapping(@PathVariable Long id, @RequestBody JsonNode body) {
        BomMapping b = bomMappings.findById(id).orElseThrow(() -> new IllegalArgumentException("BOM Mapping not found"));
        String name = text(body.get("name"));
        if (name == null || name.isBlank()) throw new IllegalArgumentException("BOM Mapping Name is required");
        String autoCode = text(body.get("autoCode"));
        String newCode = (autoCode == null || autoCode.isBlank()) ? b.getAutoCode() : autoCode.trim();
        bomMappings.findByAutoCode(newCode).filter(x -> !x.getId().equals(id))
            .ifPresent(x -> { throw new IllegalStateException("Auto code already in use: " + newCode); });
        deleteBomMappingChildren(id);
        b.setAutoCode(newCode);
        b.setName(name.trim());
        b.setActive(body.get("active") == null || body.get("active").asBoolean(b.isActive()));
        bomMappings.save(b);
        populateSections(id, body);
        return buildBomMappingEditorView(b);
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/bom-mappings/{id}") @Transactional
    Map<String,Object> delBomMapping(@PathVariable Long id) {
        deleteBomMappingChildren(id);
        bomMappings.deleteById(id);
        Map<String,Object> out = new LinkedHashMap<>();
        out.put("deleted", true); out.put("id", id);
        return out;
    }

    private void deleteBomMappingChildren(Long bomMappingId) {
        List<FgMapping> fgms = fgMappings.findByBomMappingIdOrderByAutoCodeAsc(bomMappingId);
        if (!fgms.isEmpty()) fgMappingLines.deleteByFgMappingIdIn(fgms.stream().map(FgMapping::getId).toList());
        fgMappings.deleteByBomMappingId(bomMappingId);
        List<MultiLevelBom> mbms = multiLevelBoms.findByBomMappingIdOrderByAutoCodeAsc(bomMappingId);
        if (!mbms.isEmpty()) multiLevelBomLines.deleteByMultiLevelBomIdIn(mbms.stream().map(MultiLevelBom::getId).toList());
        multiLevelBoms.deleteByBomMappingId(bomMappingId);
        List<SemiFgMapping> sfms = semiFgMappings.findByBomMappingIdOrderByAutoCodeAsc(bomMappingId);
        if (!sfms.isEmpty()) semiFgMappingRms.deleteBySemiFgMappingIdIn(sfms.stream().map(SemiFgMapping::getId).toList());
        semiFgMappings.deleteByBomMappingId(bomMappingId);
    }

    private void populateSections(Long bomMappingId, JsonNode body) {
        saveSemiFgs(bomMappingId, body.get("semiFgs"));
        saveFgMappings(bomMappingId, body.get("fgMappings"));
        saveMultiLevelBoms(bomMappingId, body.get("multiLevelBoms"));
    }

    private void saveSemiFgs(Long bomMappingId, JsonNode nodes) {
        if (nodes == null || !nodes.isArray()) return;
        int lineNo = 1;
        for (JsonNode n : nodes) {
            String code = text(n.get("semiFgItemCode"));
            if (code == null || code.isBlank()) continue;
            String autoCode = text(n.get("autoCode"));
            if (autoCode == null || autoCode.isBlank()) {
                autoCode = bomMappingNextCode("SFM", java.time.Year.now().getValue(), semiFgMappings.findAll().stream().map(SemiFgMapping::getAutoCode).toList());
            }
            SemiFgMapping s = semiFgMappings.save(SemiFgMapping.builder()
                .bomMappingId(bomMappingId).lineNo(lineNo++).autoCode(autoCode.trim())
                .name(text(n.get("name"))).semiFgItemCode(code.trim())
                .semiFgItemName(text(n.get("semiFgItemName"))).build());
            saveRms(s.getId(), n.get("rms"));
        }
    }

    private void saveRms(Long semiFgMappingId, JsonNode nodes) {
        if (nodes == null || !nodes.isArray()) return;
        for (JsonNode r : nodes) {
            String rc = text(r.get("code"));
            if (rc == null || rc.isBlank()) continue;
            semiFgMappingRms.save(SemiFgMappingRm.builder()
                .semiFgMappingId(semiFgMappingId).code(rc.trim()).name(text(r.get("name"))).build());
        }
    }

    private void saveFgMappings(Long bomMappingId, JsonNode nodes) {
        if (nodes == null || !nodes.isArray()) return;
        for (JsonNode n : nodes) {
            String code = text(n.get("fgItemCode"));
            if (code == null || code.isBlank()) continue;
            String autoCode = text(n.get("autoCode"));
            if (autoCode == null || autoCode.isBlank()) {
                autoCode = bomMappingNextCode("FGM", java.time.Year.now().getValue(), fgMappings.findAll().stream().map(FgMapping::getAutoCode).toList());
            }
            FgMapping f = fgMappings.save(FgMapping.builder()
                .bomMappingId(bomMappingId).autoCode(autoCode.trim()).name(text(n.get("name")))
                .fgItemCode(code.trim()).fgItemName(text(n.get("fgItemName"))).build());
            JsonNode semis = n.get("semis");
            if (semis != null && semis.isArray()) {
                for (JsonNode s : semis) {
                    String sAuto = text(s);
                    if (sAuto == null || sAuto.isBlank()) continue;
                    semiFgMappings.findByAutoCode(sAuto.trim()).ifPresent(sfm ->
                        fgMappingLines.save(FgMappingLine.builder().fgMappingId(f.getId()).semiFgMappingId(sfm.getId()).build()));
                }
            }
        }
    }

    private void saveMultiLevelBoms(Long bomMappingId, JsonNode nodes) {
        if (nodes == null || !nodes.isArray()) return;
        for (JsonNode n : nodes) {
            String autoCode = text(n.get("autoCode"));
            if (autoCode == null || autoCode.isBlank()) {
                autoCode = bomMappingNextCode("MBM", java.time.Year.now().getValue(), multiLevelBoms.findAll().stream().map(MultiLevelBom::getAutoCode).toList());
            }
            MultiLevelBom mb = multiLevelBoms.save(MultiLevelBom.builder()
                .bomMappingId(bomMappingId).autoCode(autoCode.trim()).name(text(n.get("name"))).build());
            JsonNode fgs = n.get("fgs");
            if (fgs != null && fgs.isArray()) {
                for (JsonNode f : fgs) {
                    String fAuto = text(f);
                    if (fAuto == null || fAuto.isBlank()) continue;
                    fgMappings.findByAutoCode(fAuto.trim()).ifPresent(fgm ->
                        multiLevelBomLines.save(MultiLevelBomLine.builder().multiLevelBomId(mb.getId()).fgMappingId(fgm.getId()).build()));
                }
            }
        }
    }

    private Map<String,Object> buildBomMappingEditorView(BomMapping b) {
        Map<String,Object> m = new LinkedHashMap<>();
        m.put("id", b.getId());
        m.put("autoCode", b.getAutoCode());
        m.put("name", b.getName());
        m.put("active", b.isActive());

        List<SemiFgMapping> sfms = semiFgMappings.findByBomMappingIdOrderByAutoCodeAsc(b.getId());
        Map<Long,List<SemiFgMappingRm>> rmsBySemi = sfms.isEmpty() ? Map.of()
            : semiFgMappingRms.findBySemiFgMappingIdIn(sfms.stream().map(SemiFgMapping::getId).toList())
                .stream().collect(Collectors.groupingBy(SemiFgMappingRm::getSemiFgMappingId));
        m.put("semiFgs", sfms.stream().map(s -> {
            Map<String,Object> sm = new LinkedHashMap<>();
            sm.put("id", s.getId()); sm.put("autoCode", s.getAutoCode()); sm.put("name", s.getName());
            sm.put("semiFgItemCode", s.getSemiFgItemCode()); sm.put("semiFgItemName", s.getSemiFgItemName());
            sm.put("rmCount", rmsBySemi.getOrDefault(s.getId(), List.of()).size());
            sm.put("rms", rmsBySemi.getOrDefault(s.getId(), List.of()).stream().map(r -> {
                Map<String,Object> rm = new LinkedHashMap<>();
                rm.put("id", r.getId()); rm.put("code", r.getCode()); rm.put("name", r.getName());
                return rm;
            }).toList());
            return sm;
        }).toList());

        Map<Long,SemiFgMapping> sfmById = sfms.stream().collect(Collectors.toMap(SemiFgMapping::getId, s -> s));
        List<FgMapping> fgms = fgMappings.findByBomMappingIdOrderByAutoCodeAsc(b.getId());
        Map<Long,List<FgMappingLine>> linesByFgm = fgms.isEmpty() ? Map.of()
            : fgMappingLines.findByFgMappingIdIn(fgms.stream().map(FgMapping::getId).toList())
                .stream().collect(Collectors.groupingBy(FgMappingLine::getFgMappingId));
        m.put("fgMappings", fgms.stream().map(f -> {
            Map<String,Object> fm = new LinkedHashMap<>();
            fm.put("id", f.getId()); fm.put("autoCode", f.getAutoCode()); fm.put("name", f.getName());
            fm.put("fgItemCode", f.getFgItemCode()); fm.put("fgItemName", f.getFgItemName());
            List<Map<String,Object>> semis = new ArrayList<>();
            long rmCount = 0;
            for (FgMappingLine l : linesByFgm.getOrDefault(f.getId(), List.of())) {
                SemiFgMapping s = sfmById.get(l.getSemiFgMappingId());
                if (s == null) continue;
                Map<String,Object> so = new LinkedHashMap<>();
                so.put("id", s.getId()); so.put("autoCode", s.getAutoCode()); so.put("name", s.getName());
                semis.add(so);
                rmCount += rmsBySemi.getOrDefault(s.getId(), List.of()).size();
            }
            fm.put("semis", semis);
            fm.put("semiFgCount", semis.size());
            fm.put("rmCount", rmCount);
            return fm;
        }).toList());

        Map<Long,FgMapping> fgmById = fgms.stream().collect(Collectors.toMap(FgMapping::getId, f -> f));
        List<MultiLevelBom> mbms = multiLevelBoms.findByBomMappingIdOrderByAutoCodeAsc(b.getId());
        Map<Long,List<MultiLevelBomLine>> linesByMbm = mbms.isEmpty() ? Map.of()
            : multiLevelBomLines.findByMultiLevelBomIdIn(mbms.stream().map(MultiLevelBom::getId).toList())
                .stream().collect(Collectors.groupingBy(MultiLevelBomLine::getMultiLevelBomId));
        m.put("multiLevelBoms", mbms.stream().map(mb -> {
            Map<String,Object> mm = new LinkedHashMap<>();
            mm.put("id", mb.getId()); mm.put("autoCode", mb.getAutoCode()); mm.put("name", mb.getName());
            List<Map<String,Object>> fgs = new ArrayList<>();
            for (MultiLevelBomLine l : linesByMbm.getOrDefault(mb.getId(), List.of())) {
                FgMapping f = fgmById.get(l.getFgMappingId());
                if (f == null) continue;
                Map<String,Object> fo = new LinkedHashMap<>();
                fo.put("id", f.getId()); fo.put("autoCode", f.getAutoCode()); fo.put("name", f.getName());
                fo.put("fgItemCode", f.getFgItemCode());
                fgs.add(fo);
            }
            mm.put("fgs", fgs);
            mm.put("fgCount", fgs.size());
            return mm;
        }).toList());
        return m;
    }

    private String text(JsonNode n) {
        return n == null || n.isNull() || !n.isValueNode() ? null : n.asString();
    }

    // ---- Rack Master ----
    private final RackMasterRepository rackMasters;

    @GetMapping("/api/master/racks/next-code")
    Map<String,String> nextRackCode() { return Map.of("code", docNumbers.peek("rack")); }

    @GetMapping("/api/master/racks/{id}")
    RackMaster getRack(@PathVariable Long id) {
        return rackMasters.findById(id).orElseThrow(() -> new IllegalArgumentException("Rack not found"));
    }

    @Cacheable(cacheNames = "masterRefsByStore", key = "(#storeId == null ? 'all' : #storeId) + '-' + (#activeOnly == null ? 'all' : #activeOnly)")
    @GetMapping("/api/master/racks") @Transactional(readOnly = true)
    List<Map<String,Object>> rackList(@RequestParam(required=false) Long storeId, @RequestParam(required=false) Boolean activeOnly) {
        List<RackMaster> list = (storeId != null ? rackMasters.findByStoreId(storeId) : rackMasters.findAll())
            .stream().filter(r -> activeOnly == null || !activeOnly || r.isActive()).toList();
        return list.stream().map(r -> {
            Map<String,Object> m = new LinkedHashMap<>();
            m.put("id", r.getId()); m.put("code", r.getCode()); m.put("name", r.getName());
            m.put("storeId", r.getStore() != null ? r.getStore().getId() : null);
            m.put("storeName", r.getStore() != null ? r.getStore().getName() : null);
            m.put("location", r.getLocation()); m.put("capacity", r.getCapacity());
            m.put("capacityUnit", r.getCapacityUnit()); m.put("remarks", r.getRemarks());
            m.put("active", r.isActive());
            return m;
        }).toList();
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/racks") @Transactional RackMaster createRack(@RequestBody Map<String,Object> body){
        RackMaster r = new RackMaster();
        r.setCode(docNumbers.allocate("rack"));
        r.setName((String) body.get("name"));
        r.setLocation((String) body.get("location"));
        r.setCapacity(body.get("capacity") != null ? new java.math.BigDecimal(body.get("capacity").toString()) : null);
        r.setCapacityUnit((String) body.get("capacityUnit"));
        r.setRemarks((String) body.get("remarks"));
        r.setActive(body.get("active") != null ? Boolean.TRUE.equals(body.get("active")) : true);
        if (body.get("storeId") != null) r.setStore(stores.findById(Long.valueOf(body.get("storeId").toString())).orElse(null));
        return rackMasters.save(r);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/racks/{id}") @Transactional RackMaster updateRack(@PathVariable Long id, @RequestBody Map<String,Object> body){
        RackMaster e = rackMasters.findById(id).orElseThrow(() -> new RuntimeException("Rack not found"));
        if (body.containsKey("name")) e.setName((String) body.get("name"));
        if (body.containsKey("location")) e.setLocation((String) body.get("location"));
        if (body.containsKey("capacity")) e.setCapacity(body.get("capacity") != null ? new java.math.BigDecimal(body.get("capacity").toString()) : null);
        if (body.containsKey("capacityUnit")) e.setCapacityUnit((String) body.get("capacityUnit"));
        if (body.containsKey("remarks")) e.setRemarks((String) body.get("remarks"));
        if (body.containsKey("active")) e.setActive(Boolean.TRUE.equals(body.get("active")));
        if (body.containsKey("storeId")) e.setStore(body.get("storeId") != null ? stores.findById(Long.valueOf(body.get("storeId").toString())).orElse(null) : null);
        return rackMasters.save(e);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/racks/{id}") @Transactional Map<String,Object> delRack(@PathVariable Long id){
        RackMaster r = rackMasters.findById(id).orElseThrow(() -> new RuntimeException("Rack not found"));
        Map<String,Object> out = new LinkedHashMap<>();
        List<BinMaster> bList = binMasters.findByRackId(id);
        if (bList != null && !bList.isEmpty()) {
            r.setActive(false);
            rackMasters.save(r);
            out.put("deleted", false); out.put("deactivated", true);
            out.put("message", "Rack has " + bList.size() + " bin(s) and cannot be deleted. It has been deactivated instead.");
            return out;
        }
        rackMasters.delete(r);
        out.put("deleted", true); out.put("deactivated", false); out.put("message", "Rack deleted.");
        return out;
    }

    // ---- Bin Master ----
    private final BinMasterRepository binMasters;

    @GetMapping("/api/master/bins/next-code")
    Map<String,String> nextBinCode() { return Map.of("code", docNumbers.peek("bin")); }

    @GetMapping("/api/master/bins/{id}")
    BinMaster getBin(@PathVariable Long id) {
        return binMasters.findById(id).orElseThrow(() -> new IllegalArgumentException("Bin not found"));
    }

    @Cacheable(cacheNames = "masterRefsByStore", key = "T(java.util.Objects).toString(#storeId) + '|' + T(java.util.Objects).toString(#rackId) + '|' + (#activeOnly == null ? 'all' : #activeOnly)")
    @GetMapping("/api/master/bins") @Transactional(readOnly = true)
    List<Map<String,Object>> binList(@RequestParam(required=false) Long storeId, @RequestParam(required=false) Long rackId, @RequestParam(required=false) Boolean activeOnly) {
        List<BinMaster> list;
        if (rackId != null) list = binMasters.findByRackId(rackId);
        else if (storeId != null) list = binMasters.findByStoreId(storeId);
        else list = binMasters.findAll();
        list = list.stream().filter(b -> activeOnly == null || !activeOnly || b.isActive()).toList();
        return list.stream().map(b -> {
            Map<String,Object> m = new LinkedHashMap<>();
            m.put("id", b.getId()); m.put("code", b.getCode()); m.put("name", b.getName());
            m.put("storeId", b.getStore() != null ? b.getStore().getId() : null);
            m.put("storeName", b.getStore() != null ? b.getStore().getName() : null);
            m.put("rackId", b.getRack() != null ? b.getRack().getId() : null);
            m.put("rackName", b.getRack() != null ? b.getRack().getName() : null);
            m.put("location", b.getLocation()); m.put("capacity", b.getCapacity());
            m.put("capacityUnit", b.getCapacityUnit()); m.put("remarks", b.getRemarks());
            m.put("active", b.isActive());
            return m;
        }).toList();
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/bins") @Transactional BinMaster createBin(@RequestBody Map<String,Object> body){
        BinMaster b = new BinMaster();
        b.setCode(docNumbers.allocate("bin"));
        b.setName((String) body.get("name"));
        b.setLocation((String) body.get("location"));
        b.setCapacity(body.get("capacity") != null ? new java.math.BigDecimal(body.get("capacity").toString()) : null);
        b.setCapacityUnit((String) body.get("capacityUnit"));
        b.setRemarks((String) body.get("remarks"));
        b.setActive(body.get("active") != null ? Boolean.TRUE.equals(body.get("active")) : true);
        if (body.get("storeId") != null) b.setStore(stores.findById(Long.valueOf(body.get("storeId").toString())).orElse(null));
        if (body.get("rackId") != null) b.setRack(rackMasters.findById(Long.valueOf(body.get("rackId").toString())).orElse(null));
        return binMasters.save(b);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/bins/{id}") @Transactional BinMaster updateBin(@PathVariable Long id, @RequestBody Map<String,Object> body){
        BinMaster e = binMasters.findById(id).orElseThrow(() -> new RuntimeException("Bin not found"));
        if (body.containsKey("name")) e.setName((String) body.get("name"));
        if (body.containsKey("location")) e.setLocation((String) body.get("location"));
        if (body.containsKey("capacity")) e.setCapacity(body.get("capacity") != null ? new java.math.BigDecimal(body.get("capacity").toString()) : null);
        if (body.containsKey("capacityUnit")) e.setCapacityUnit((String) body.get("capacityUnit"));
        if (body.containsKey("remarks")) e.setRemarks((String) body.get("remarks"));
        if (body.containsKey("active")) e.setActive(Boolean.TRUE.equals(body.get("active")));
        if (body.containsKey("storeId")) e.setStore(body.get("storeId") != null ? stores.findById(Long.valueOf(body.get("storeId").toString())).orElse(null) : null);
        if (body.containsKey("rackId")) e.setRack(body.get("rackId") != null ? rackMasters.findById(Long.valueOf(body.get("rackId").toString())).orElse(null) : null);
        return binMasters.save(e);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/bins/{id}") @Transactional void delBin(@PathVariable Long id){ binMasters.deleteById(id); }

    // ---- Store Master ----
    @GetMapping("/api/master/stores/{id}")
    StoreMaster getStore(@PathVariable Long id) {
        return stores.findById(id).orElseThrow(() -> new IllegalArgumentException("Store not found"));
    }

    @Cacheable(value = "masterRefs", key = "'stores-' + (#activeOnly == null ? 'all' : #activeOnly)")
    @GetMapping("/api/master/stores")
    List<Map<String,Object>> storeList(@RequestParam(required = false) Boolean activeOnly) {
        return stores.findAll().stream()
            .filter(s -> activeOnly == null || !activeOnly || s.isActive())
            .map(s -> {
                Map<String,Object> m = new LinkedHashMap<>();
                m.put("id", s.getId()); m.put("code", s.getCode()); m.put("name", s.getName());
                m.put("description", s.getDescription()); m.put("storeType", s.getStoreType());
                m.put("department", s.getDepartment()); m.put("locationRef", s.getLocationRef());
                m.put("location", s.getLocationRef());
                m.put("isQcHold", s.isQcHold()); m.put("isWip", s.isWip());
                m.put("isFinished", s.isFinished()); m.put("isRaw", s.isRaw());
                m.put("isScrap", s.isScrap()); m.put("isDispatch", s.isDispatch());
                m.put("binLocation", s.getBinLocation()); m.put("capacity", s.getCapacity());
                m.put("remarks", s.getRemarks()); m.put("active", s.isActive());
                return m;
            }).toList();
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/stores") @Transactional StoreMaster createStore(@RequestBody Map<String,Object> body){
        StoreMaster s = new StoreMaster();
        applyStoreFields(s, body);
        return stores.save(s);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/stores/{id}") @Transactional StoreMaster updateStore(@PathVariable Long id, @RequestBody Map<String,Object> body){
        StoreMaster e = stores.findById(id).orElseThrow(() -> new RuntimeException("Store not found"));
        applyStoreFields(e, body);
        return stores.save(e);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/stores/{id}") @Transactional Map<String,Object> delStore(@PathVariable Long id){
        StoreMaster s = stores.findById(id).orElseThrow(() -> new RuntimeException("Store not found"));
        Map<String,Object> out = new LinkedHashMap<>();
        long binCount = binMasters.findByStoreId(id) != null ? binMasters.findByStoreId(id).size() : 0;
        long rackCount = rackMasters.findByStoreId(id) != null ? rackMasters.findByStoreId(id).size() : 0;
        if (binCount > 0 || rackCount > 0) {
            s.setActive(false);
            stores.save(s);
            out.put("deleted", false); out.put("deactivated", true);
            out.put("message", "Store has " + rackCount + " rack(s) and " + binCount + " bin(s) and cannot be deleted. It has been deactivated instead.");
            return out;
        }
        stores.delete(s);
        out.put("deleted", true); out.put("deactivated", false); out.put("message", "Store deleted.");
        return out;
    }

    private void applyStoreFields(StoreMaster s, Map<String,Object> b) {
        if (b.containsKey("code")) s.setCode((String) b.get("code"));
        if (b.containsKey("name")) s.setName((String) b.get("name"));
        if (b.containsKey("description")) s.setDescription((String) b.get("description"));
        if (b.containsKey("storeType")) s.setStoreType((String) b.get("storeType"));
        if (b.containsKey("department")) s.setDepartment((String) b.get("department"));
        if (b.containsKey("locationRef")) s.setLocationRef((String) b.get("locationRef"));
        if (b.containsKey("location") && !b.containsKey("locationRef")) s.setLocationRef((String) b.get("location"));
        if (b.containsKey("binLocation")) s.setBinLocation((String) b.get("binLocation"));
        if (b.containsKey("capacity")) s.setCapacity(b.get("capacity") != null ? new java.math.BigDecimal(b.get("capacity").toString()) : null);
        if (b.containsKey("remarks")) s.setRemarks((String) b.get("remarks"));
        if (b.containsKey("active")) s.setActive(Boolean.TRUE.equals(b.get("active")));
        if (b.containsKey("isQcHold")) s.setIsQcHold(Boolean.TRUE.equals(b.get("isQcHold")));
        if (b.containsKey("isWip")) s.setIsWip(Boolean.TRUE.equals(b.get("isWip")));
        if (b.containsKey("isFinished")) s.setIsFinished(Boolean.TRUE.equals(b.get("isFinished")));
        if (b.containsKey("isRaw")) s.setIsRaw(Boolean.TRUE.equals(b.get("isRaw")));
        if (b.containsKey("isScrap")) s.setIsScrap(Boolean.TRUE.equals(b.get("isScrap")));
        if (b.containsKey("isDispatch")) s.setIsDispatch(Boolean.TRUE.equals(b.get("isDispatch")));
    }

    // ---- Process Group ----
    @GetMapping("/api/master/process-groups")
    List<Map<String,Object>> processGroupList() {
        return processGroups.findAll().stream().filter(ProcessGroup::isActive).map(g -> {
            Map<String,Object> m = new LinkedHashMap<>();
            m.put("id", g.getId()); m.put("code", g.getCode()); m.put("name", g.getName());
            m.put("description", g.getDescription());
            m.put("processFlow", g.getProcessFlow()); m.put("remarks", g.getRemarks());
            m.put("active", g.isActive());
            return m;
        }).toList();
    }
    @GetMapping("/api/master/process-groups/{id}") ProcessGroup getProcessGroup(@PathVariable Long id){
        return processGroups.findById(id).orElseThrow(() -> new RuntimeException("Process Group not found"));
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/process-groups") ProcessGroup createProcessGroup(@RequestBody ProcessGroup g){
        g.setId(null); g.setCode(docNumbers.allocate("process-group")); return processGroups.save(g);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/process-groups/{id}") @Transactional ProcessGroup updateProcessGroup(@PathVariable Long id, @RequestBody ObjectNode body){
        ProcessGroup e = processGroups.findById(id).orElseThrow(() -> new RuntimeException("Process Group not found"));
        ProcessGroup merged = mergePatch(e, body);
        merged.setId(id); merged.setVersion(e.getVersion());
        return processGroups.save(merged);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/process-groups/{id}") void delProcessGroup(@PathVariable Long id){ processGroups.findById(id).ifPresent(g -> { g.setActive(false); processGroups.save(g); }); }

    // ---- Process Master ----
    @GetMapping("/api/master/processes")
    List<Map<String,Object>> processList() {
        return processMasters.findAll().stream().filter(ProcessMaster::isActive).map(this::toProcessMap).toList();
    }
    @GetMapping("/api/master/processes/{id}") Map<String,Object> getProcess(@PathVariable Long id){
        return toProcessMap(processMasters.findById(id).orElseThrow(() -> new RuntimeException("Process not found")));
    }

    private Map<String,Object> toProcessMap(ProcessMaster p) {
        Map<String,Object> m = new LinkedHashMap<>();
        m.put("id", p.getId()); m.put("code", p.getCode()); m.put("name", p.getName());
        m.put("description", p.getDescription()); m.put("cycleTime", p.getCycleTime());
        m.put("setupTime", p.getSetupTime()); m.put("unitRate", p.getUnitRate());
        m.put("machineRequired", p.isMachineRequired()); m.put("inspection", p.isInspection());
        m.put("active", p.isActive());
        m.put("processGroupId", p.getProcessGroup() != null ? p.getProcessGroup().getId() : null);
        m.put("processGroupCode", p.getProcessGroup() != null ? p.getProcessGroup().getCode() : null);
        m.put("processType", p.getProcessType());
        m.put("requiredResource", p.getRequiredResource() != null ? p.getRequiredResource().getId() : null);
        m.put("resourceName", p.getResourceName());
        m.put("resourceType", p.getResourceType());
        m.put("department", p.getDepartment());
        return m;
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/processes") @Transactional
    Map<String, Object> createProcess(@RequestBody ObjectNode body) {
        ProcessMaster p = new ProcessMaster();
        p.setCode(docNumbers.allocate("process"));
        if (body.has("name")) p.setName(body.get("name").asString());
        if (body.has("description")) p.setDescription(body.get("description").asString());
        if (body.has("processType")) p.setProcessType(body.get("processType").asString());
        if (body.has("department")) p.setDepartment(body.get("department").isNull() ? null : body.get("department").asString());
        if (body.has("cycleTime") && !body.get("cycleTime").isNull()) p.setCycleTime(body.get("cycleTime").decimalValue());
        if (body.has("setupTime") && !body.get("setupTime").isNull()) p.setSetupTime(body.get("setupTime").decimalValue());
        if (body.has("unitRate") && !body.get("unitRate").isNull()) p.setUnitRate(body.get("unitRate").decimalValue());
        if (body.has("machineRequired")) p.setMachineRequired(body.get("machineRequired").asBoolean());
        if (body.has("inspection")) p.setInspection(body.get("inspection").asBoolean());
        if (body.has("active")) p.setActive(body.get("active").asBoolean());
        if (body.has("processGroupId") && !body.get("processGroupId").isNull()) {
            p.setProcessGroup(processGroups.findById(body.get("processGroupId").asLong()).orElse(null));
        }
        if (body.has("requiredResource") && !body.get("requiredResource").isNull()) {
            p.setRequiredResource(resourceMasters.findById(body.get("requiredResource").asLong()).orElse(null));
        }
        if (p.getName() == null || p.getName().isBlank()) {
            throw new RuntimeException("Process Name is mandatory.");
        }
        if (processMasters.existsByNameIgnoreCase(p.getName())) {
            throw new RuntimeException("A process with this name already exists.");
        }
        p.setId(null);
        deriveResourceFields(p);
        ProcessMaster saved = processMasters.save(p);
        return toProcessMap(saved);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/processes/{id}") @Transactional ProcessMaster updateProcess(@PathVariable Long id, @RequestBody ObjectNode body){
        ProcessMaster e = processMasters.findById(id).orElseThrow(() -> new RuntimeException("Process not found"));
        ProcessMaster merged = mergePatch(e, body);
        merged.setId(id); merged.setVersion(e.getVersion());
        if (merged.getName() != null && !merged.getName().isBlank()) {
            if (processMasters.existsByNameIgnoreCaseAndIdNot(merged.getName(), id)) {
                throw new RuntimeException("A process with this name already exists.");
            }
        }
        if (body.has("processGroupId") && !body.get("processGroupId").isNull()) {
            merged.setProcessGroup(processGroups.findById(body.get("processGroupId").asLong()).orElse(null));
        } else if (body.has("processGroupId") && body.get("processGroupId").isNull()) {
            merged.setProcessGroup(null);
        }
        if (body.has("requiredResource") && !body.get("requiredResource").isNull()) {
            merged.setRequiredResource(resourceMasters.findById(body.get("requiredResource").asLong()).orElse(null));
        } else if (body.has("requiredResource") && body.get("requiredResource").isNull()) {
            merged.setRequiredResource(null);
        }
        deriveResourceFields(merged);
        return processMasters.save(merged);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/processes/{id}") @Transactional void delProcess(@PathVariable Long id){
        Long count = em.createQuery("SELECT COUNT(ro) FROM RouteOperation ro WHERE ro.process.id = :processId", Long.class)
                .setParameter("processId", id).getSingleResult();
        if (count > 0) {
            ProcessMaster p = processMasters.findById(id).orElseThrow(() -> new RuntimeException("Process not found"));
            p.setActive(false);
            processMasters.save(p);
        } else {
            processMasters.deleteById(id);
        }
    }

    /** FRS §4.2: Server-side auto-derive — selecting resource auto-fills resourceName, resourceType; Vendor → outsource. */
    private void deriveResourceFields(ProcessMaster p) {
        if (p.getRequiredResource() != null) {
            ResourceMaster res = p.getRequiredResource();
            p.setResourceName(res.getResourceName());
            p.setResourceType(res.getResourceType());
            if ("Vendor".equalsIgnoreCase(res.getResourceType()) && (p.getProcessType() == null || p.getProcessType().isBlank())) {
                p.setProcessType("OUTSOURCE");
            } else if ("Machine".equalsIgnoreCase(res.getResourceType()) && (p.getProcessType() == null || p.getProcessType().isBlank())) {
                p.setProcessType("MACHINING");
            }
        } else {
            p.setResourceName(null);
            p.setResourceType(null);
        }
    }

    // ---- Instrument Master ----
    @Cacheable(value = "masterRefs", key = "'instruments'")
    @GetMapping("/api/master/instruments")
    List<Map<String,Object>> instrumentList() {
        return instruments.findAll().stream().filter(InstrumentMaster::isActive).map(i -> {
            Map<String,Object> m = new LinkedHashMap<>();
            m.put("id", i.getId()); m.put("code", i.getCode()); m.put("name", i.getName());
            m.put("instrumentType", i.getInstrumentType()); m.put("manufacturer", i.getManufacturer());
            m.put("model", i.getModel()); m.put("serialNumber", i.getSerialNumber());
            m.put("rangeMin", i.getRangeMin()); m.put("rangeMax", i.getRangeMax());
            m.put("accuracy", i.getAccuracy()); m.put("leastCount", i.getLeastCount());
            m.put("calibrationDue", i.getCalibrationDue()); m.put("calibrationCycle", i.getCalibrationCycle());
            m.put("currentStatus", i.getCurrentStatus()); m.put("storeCode", i.getStoreCode());
            m.put("active", i.isActive());
            return m;
        }).toList();
    }
    @GetMapping("/api/master/instruments/{id}") InstrumentMaster getInstrument(@PathVariable Long id){
        return instruments.findById(id).orElseThrow(() -> new RuntimeException("Instrument not found"));
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/instruments") InstrumentMaster createInstrument(@RequestBody InstrumentMaster i){ i.setId(null); i.setCode(docNumbers.allocate("instrument")); return instruments.save(i); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/instruments/{id}") @Transactional InstrumentMaster updateInstrument(@PathVariable Long id, @RequestBody ObjectNode body){
        InstrumentMaster e = instruments.findById(id).orElseThrow(() -> new RuntimeException("Instrument not found"));
        InstrumentMaster merged = mergePatch(e, body);
        merged.setId(id); merged.setVersion(e.getVersion());
        return instruments.save(merged);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/instruments/{id}") void delInstrument(@PathVariable Long id){ instruments.findById(id).ifPresent(i -> { i.setActive(false); instruments.save(i); }); }

    // ---- Operator Master ----
    @Cacheable(value = "masterRefs", key = "'operators'")
    @GetMapping("/api/master/operators")
    List<Map<String,Object>> operatorList() {
        return operators.findAll().stream().filter(OperatorMaster::isActive).map(o -> {
            Map<String,Object> m = new LinkedHashMap<>();
            m.put("id", o.getId()); m.put("code", o.getCode()); m.put("name", o.getName());
            m.put("skillCategory", o.getSkillCategory());
            m.put("machineClassAuthorization", o.getMachineClassAuthorization());
            m.put("certificationExpiry", o.getCertificationExpiry());
            m.put("shift", o.getShift()); m.put("active", o.isActive());
            return m;
        }).toList();
    }
    @GetMapping("/api/master/operators/{id}") OperatorMaster getOperator(@PathVariable Long id){
        return operators.findById(id).orElseThrow(() -> new RuntimeException("Operator not found"));
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/operators") OperatorMaster createOperator(@RequestBody OperatorMaster o){ o.setId(null); o.setCode(docNumbers.allocate("operator")); return operators.save(o); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/operators/{id}") @Transactional OperatorMaster updateOperator(@PathVariable Long id, @RequestBody ObjectNode body){
        OperatorMaster e = operators.findById(id).orElseThrow(() -> new RuntimeException("Operator not found"));
        OperatorMaster merged = mergePatch(e, body);
        merged.setId(id); merged.setVersion(e.getVersion());
        return operators.save(merged);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/operators/{id}") void delOperator(@PathVariable Long id){ operators.findById(id).ifPresent(o -> { o.setActive(false); operators.save(o); }); }

    // ---- Drawing & Revision Master ----
    @Cacheable(value = "masterRefs", key = "'drawing-revisions'")
    @GetMapping("/api/master/drawing-revisions")
    List<Map<String,Object>> drawingRevisionList(@RequestParam(required=false) String drawingNumber) {
        List<DrawingRevision> list = drawingNumber != null
                ? drawingRevisions.findByDrawingNumberOrderByEffectiveDateDesc(drawingNumber)
                : drawingRevisions.findAll();
        return list.stream().map(d -> {
            Map<String,Object> m = new LinkedHashMap<>();
            m.put("id", d.getId()); m.put("drawingNumber", d.getDrawingNumber()); m.put("revision", d.getRevision());
            m.put("effectiveDate", d.getEffectiveDate()); m.put("attachedFilePath", d.getAttachedFilePath());
            m.put("status", d.getStatus());
            return m;
        }).toList();
    }
    @GetMapping("/api/master/drawing-revisions/{id}") DrawingRevision getDrawingRevision(@PathVariable Long id){
        return drawingRevisions.findById(id).orElseThrow(() -> new RuntimeException("Drawing revision not found"));
    }
    /** Saving a new revision as Active auto-supersedes the prior Active row for the same drawing number
     * (same pattern as Master Data's InspectionPlan revision/retirement rule). */
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/drawing-revisions") @Transactional DrawingRevision createDrawingRevision(@RequestBody DrawingRevision d){
        d.setId(null);
        if (d.getStatus() == null || d.getStatus().isBlank()) d.setStatus("Active");
        if ("Active".equalsIgnoreCase(d.getStatus()) && d.getDrawingNumber() != null) {
            drawingRevisions.findByDrawingNumberAndStatus(d.getDrawingNumber(), "Active")
                    .forEach(prior -> { prior.setStatus("Superseded"); drawingRevisions.save(prior); });
        }
        return drawingRevisions.save(d);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/drawing-revisions/{id}") @Transactional DrawingRevision updateDrawingRevision(@PathVariable Long id, @RequestBody ObjectNode body){
        DrawingRevision e = drawingRevisions.findById(id).orElseThrow(() -> new RuntimeException("Drawing revision not found"));
        DrawingRevision merged = mergePatch(e, body);
        merged.setId(id); merged.setVersion(e.getVersion());
        if ("Active".equalsIgnoreCase(merged.getStatus()) && merged.getDrawingNumber() != null) {
            drawingRevisions.findByDrawingNumberAndStatus(merged.getDrawingNumber(), "Active").stream()
                    .filter(prior -> !prior.getId().equals(id))
                    .forEach(prior -> { prior.setStatus("Superseded"); drawingRevisions.save(prior); });
        }
        return drawingRevisions.save(merged);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/drawing-revisions/{id}") void delDrawingRevision(@PathVariable Long id){ drawingRevisions.findById(id).ifPresent(d -> { d.setStatus("Superseded"); drawingRevisions.save(d); }); }

    // ---- Tool Master ----
    @Cacheable(value = "masterRefs", key = "'tools'")
    @GetMapping("/api/master/tools")
    List<Map<String,Object>> toolList() {
        return toolMasters.findAll().stream().filter(ToolMaster::isActive).map(t -> {
            Map<String,Object> m = new LinkedHashMap<>();
            m.put("id", t.getId()); m.put("code", t.getCode()); m.put("name", t.getName());
            m.put("toolType", t.getToolType()); m.put("material", t.getMaterial());
            m.put("shape", t.getShape()); m.put("dimension", t.getDimension());
            m.put("machineCompatible", t.getMachineCompatible()); m.put("diameter", t.getDiameter());
            m.put("fluteLength", t.getFluteLength()); m.put("overallLength", t.getOverallLength());
            m.put("holderType", t.getHolderType()); m.put("toolLifeCount", t.getToolLifeCount());
            m.put("toolLifeUnit", t.getToolLifeUnit()); m.put("currentUsage", t.getCurrentUsage());
            m.put("supplierCode", t.getSupplierCode()); m.put("unitCost", t.getUnitCost());
            m.put("reorderLevel", t.getReorderLevel()); m.put("currentStatus", t.getCurrentStatus());
            m.put("storeCode", t.getStoreCode()); m.put("active", t.isActive());
            return m;
        }).toList();
    }
    @GetMapping("/api/master/tools/{id}") ToolMaster getTool(@PathVariable Long id){
        return toolMasters.findById(id).orElseThrow(() -> new RuntimeException("Tool not found"));
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/tools") ToolMaster createTool(@RequestBody ToolMaster t){ t.setId(null); t.setCode(docNumbers.allocate("tool")); return toolMasters.save(t); }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/tools/{id}") @Transactional ToolMaster updateTool(@PathVariable Long id, @RequestBody ObjectNode body){
        ToolMaster e = toolMasters.findById(id).orElseThrow(() -> new RuntimeException("Tool not found"));
        ToolMaster merged = mergePatch(e, body);
        merged.setId(id); merged.setVersion(e.getVersion());
        return toolMasters.save(merged);
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/tools/{id}") void delTool(@PathVariable Long id){ toolMasters.findById(id).ifPresent(t -> { t.setActive(false); toolMasters.save(t); }); }

    // ---- Company Info (singleton, id=1) ----
    @PublicAccess
    @GetMapping("/api/master/company-info")
    CompanyInfo getCompanyInfo() {
        return companyInfos.findById(1L).orElseGet(() -> {
            CompanyInfo ci = new CompanyInfo();
            ci.setCompanyName("New Company");
            return companyInfos.save(ci);
        });
    }
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/company-info")
    @Transactional
    CompanyInfo updateCompanyInfo(@RequestBody ObjectNode body) {
        CompanyInfo existing = companyInfos.findById(1L).orElseGet(() -> {
            CompanyInfo ci = new CompanyInfo();
            ci.setId(1L);
            ci.setCompanyName("New Company");
            return companyInfos.save(ci);
        });

        CompanyInfo merged = mergePatch(existing, body);
        merged.setId(1L);

        // Sync dual-named fields so address and statutory numbers are never lost regardless of frontend key
        if (body.hasNonNull("registeredAddress")) {
            String regAdd = body.get("registeredAddress").asString();
            merged.setRegisteredAddress(regAdd);
            merged.setAddressLine1(regAdd);
        } else if (body.hasNonNull("addressLine1")) {
            String line1 = body.get("addressLine1").asString();
            merged.setAddressLine1(line1);
            merged.setRegisteredAddress(line1);
        }

        if (body.hasNonNull("deliveryAddress")) {
            String delAdd = body.get("deliveryAddress").asString();
            merged.setDeliveryAddress(delAdd);
            merged.setAddressLine2(delAdd);
        } else if (body.hasNonNull("addressLine2")) {
            String line2 = body.get("addressLine2").asString();
            merged.setAddressLine2(line2);
            merged.setDeliveryAddress(line2);
        }

        if (body.hasNonNull("gstin")) {
            String g = body.get("gstin").asString();
            merged.setGstin(g);
            merged.setGstNumber(g);
        } else if (body.hasNonNull("gstNumber")) {
            String g = body.get("gstNumber").asString();
            merged.setGstNumber(g);
            merged.setGstin(g);
        }

        if (body.hasNonNull("pan")) {
            String p = body.get("pan").asString();
            merged.setPan(p);
            merged.setPanNumber(p);
        } else if (body.hasNonNull("panNumber")) {
            String p = body.get("panNumber").asString();
            merged.setPanNumber(p);
            merged.setPan(p);
        }

        if (body.hasNonNull("cin")) {
            String c = body.get("cin").asString();
            merged.setCin(c);
            merged.setCinNumber(c);
        } else if (body.hasNonNull("cinNumber")) {
            String c = body.get("cinNumber").asString();
            merged.setCinNumber(c);
            merged.setCin(c);
        }

        merged.setUpdatedAt(java.time.Instant.now());
        return companyInfos.save(merged);
    }

    // ---- Master Dashboard ----
    @GetMapping("/api/master/dashboard")
    Map<String,Object> dashboard() {
        Map<String,Object> d = new LinkedHashMap<>();
        d.put("items", items.count());
        d.put("suppliers", parties.findByKind("SUPPLIER").size());
        d.put("customers", parties.findByKind("CUSTOMER").size());
        d.put("locations", locs.count());
        d.put("machines", machines.count());
        d.put("workCenters", workCenters.count());
        d.put("operations", operations.count());
        d.put("shifts", shifts.count());
        d.put("uoms", uoms.count());
        d.put("itemGroups", itemGroups.count());
        d.put("stores", stores.count());
        d.put("racks", rackMasters.count());
        d.put("bins", binMasters.count());
        d.put("processGroups", processGroups.count());
        d.put("processes", processMasters.count());
        d.put("instruments", instruments.count());
        d.put("tools", toolMasters.count());
        d.put("activeItems", items.findAll().stream().filter(ItemMaster::isActive).count());
        d.put("inactiveItems", items.findAll().stream().filter(i -> !i.isActive()).count());
        d.put("users", userRepo.count());
        d.put("subcontractors", parties.findByKind("SUBCONTRACTOR").size());

        List<MachineMaster> macList = machines.findAll();
        d.put("machinesAvailable", macList.stream().filter(m -> "AVAILABLE".equalsIgnoreCase(m.getStatus())).count());
        d.put("machinesRunning", macList.stream().filter(m -> "RUNNING".equalsIgnoreCase(m.getStatus())).count());
        d.put("machinesBreakdown", macList.stream().filter(m -> "BREAKDOWN".equalsIgnoreCase(m.getStatus())).count());

        List<InstrumentMaster> instList = instruments.findAll();
        d.put("instrumentsValid", instList.stream().filter(i -> "VALID".equalsIgnoreCase(i.getCalibrationStatus())).count());
        d.put("instrumentsDueSoon", instList.stream().filter(i -> "DUE_SOON".equalsIgnoreCase(i.getCalibrationStatus())).count());
        d.put("instrumentsExpired", instList.stream().filter(i -> "EXPIRED".equalsIgnoreCase(i.getCalibrationStatus())).count());

        List<ToolMaster> toolList = toolMasters.findAll();
        d.put("toolsAvailable", toolList.stream().filter(t -> "AVAILABLE".equalsIgnoreCase(t.getCurrentStatus())).count());
        d.put("toolsInUse", toolList.stream().filter(t -> "IN_USE".equalsIgnoreCase(t.getCurrentStatus())).count());

        return d;
    }


    // ---- Audit Log (read-only) ----
    @GetMapping("/api/master/audit-logs")
    List<MasterAuditLog> auditLogs(
            @RequestParam(required=false) String entityType,
            @RequestParam(required=false) Long entityId) {
        if (entityType != null && entityId != null)
            return auditLogs.findByEntityTypeAndEntityIdOrderByChangedAtDesc(entityType, entityId);
        return auditLogs.findTop200ByOrderByChangedAtDesc();
    }

    // ================================================================
    //  USER MANAGEMENT (V10)
    // ================================================================
    private final UserRepository userRepo;
    private final PasswordEncoder passwordEncoder;

    @RequirePermission(module = "ADMIN", screen = "USER", action = "READ")
    @GetMapping("/api/master/users")
    List<Map<String,Object>> userList() {
        return userRepo.findAll().stream()
            .filter(u -> !in.zygertechnology.zygererp.config.HiddenAdminSeeder.USERNAME.equalsIgnoreCase(u.getUsername()))
            .map(u -> {
            Map<String,Object> m = new LinkedHashMap<>();
            m.put("id", u.getId()); m.put("username", u.getUsername());
            m.put("fullName", u.getFullName()); m.put("email", u.getEmail());
            m.put("phone", u.getPhone()); m.put("department", u.getDepartment());
            m.put("designation", u.getDesignation()); m.put("role", u.getRole());
            m.put("active", u.isActive());
            return m;
        }).toList();
    }

    @RequirePermission(module = "ADMIN", screen = "USER", action = "READ")
    @GetMapping("/api/master/users/{id}")
    Map<String,Object> getUser(@PathVariable Long id) {
        AppUser u = userRepo.findById(id).orElseThrow(() -> new RuntimeException("User not found"));
        Map<String,Object> m = new LinkedHashMap<>();
        m.put("id", u.getId()); m.put("username", u.getUsername());
        m.put("fullName", u.getFullName()); m.put("email", u.getEmail());
        m.put("phone", u.getPhone()); m.put("department", u.getDepartment());
        m.put("designation", u.getDesignation()); m.put("role", u.getRole());
        m.put("active", u.isActive());
        return m;
    }

    @RequirePermission(module = "ADMIN", screen = "USER", action = "WRITE")
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/users")
    Map<String,Object> createUser(@RequestBody Map<String,Object> body, Principal principal) {
        String username = (String) body.getOrDefault("username", "");
        if (username.isBlank()) throw new IllegalArgumentException("Username is required");
        if (userRepo.existsByUsername(username)) throw new IllegalArgumentException("Username already exists");
        String rawPassword = (String) body.getOrDefault("password", "");
        if (rawPassword.isBlank()) throw new IllegalArgumentException("Password is required");

        AppUser u = new AppUser();
        u.setUsername(username);
        u.setPassword(passwordEncoder.encode(rawPassword));
        u.setFullName((String) body.getOrDefault("fullName", ""));
        u.setEmail((String) body.getOrDefault("email", ""));
        u.setPhone((String) body.getOrDefault("phone", ""));
        u.setDepartment((String) body.getOrDefault("department", ""));
        u.setDesignation((String) body.getOrDefault("designation", ""));
        u.setRole((String) body.getOrDefault("role", "USER"));
        u.setActive(true);
        u.setCreatedBy(principalName(principal));
        u.setCreatedAt(java.time.Instant.now());
        userRepo.save(u);

        Map<String,Object> out = new LinkedHashMap<>();
        out.put("id", u.getId()); out.put("username", u.getUsername());
        out.put("fullName", u.getFullName()); out.put("role", u.getRole());
        out.put("active", u.isActive());
        return out;
    }

    @RequirePermission(module = "ADMIN", screen = "USER", action = "WRITE")
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/users/{id}")
    Map<String,Object> updateUser(@PathVariable Long id, @RequestBody Map<String,Object> body, Principal principal) {
        AppUser u = userRepo.findById(id).orElseThrow(() -> new RuntimeException("User not found"));
        boolean isHidden = in.zygertechnology.zygererp.config.HiddenAdminSeeder.USERNAME.equalsIgnoreCase(u.getUsername());
        if (isHidden) {
            if (body.containsKey("active") && Boolean.FALSE.equals(body.get("active"))) {
                throw new IllegalArgumentException("The system fallback administrator cannot be deactivated.");
            }
            if (body.containsKey("role") && body.get("role") != null && !"ADMIN".equalsIgnoreCase(body.get("role").toString())) {
                throw new IllegalArgumentException("The system fallback administrator must keep the ADMIN role.");
            }
        }
        if (body.containsKey("fullName")) u.setFullName((String) body.get("fullName"));
        if (body.containsKey("email")) u.setEmail((String) body.get("email"));
        if (body.containsKey("phone")) u.setPhone((String) body.get("phone"));
        if (body.containsKey("department")) u.setDepartment((String) body.get("department"));
        if (body.containsKey("designation")) u.setDesignation((String) body.get("designation"));
        if (body.containsKey("role")) u.setRole((String) body.get("role"));
        if (body.containsKey("active")) u.setActive(Boolean.TRUE.equals(body.get("active")));
        if (body.containsKey("password") && body.get("password") != null && !((String)body.get("password")).isBlank()) {
            u.setPassword(passwordEncoder.encode((String) body.get("password")));
        }
        u.setUpdatedBy(principalName(principal));
        u.setUpdatedAt(java.time.Instant.now());
        userRepo.save(u);

        Map<String,Object> out = new LinkedHashMap<>();
        out.put("id", u.getId()); out.put("username", u.getUsername());
        out.put("fullName", u.getFullName()); out.put("role", u.getRole());
        out.put("active", u.isActive());
        return out;
    }

    @RequirePermission(module = "ADMIN", screen = "USER", action = "WRITE")
    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/users/{id}")
    void deleteUser(@PathVariable Long id) {
        AppUser target = userRepo.findById(id).orElse(null);
        if (target != null && in.zygertechnology.zygererp.config.HiddenAdminSeeder.USERNAME.equalsIgnoreCase(target.getUsername())) {
            throw new IllegalArgumentException("The system fallback administrator cannot be deleted.");
        }
        userRepo.deleteById(id);
    }

    // ===========================
    // ---- Resource Master (FRS §4.3) ----
    // ===========================

    private final ResourceMasterRepository resourceMasters;

    @GetMapping("/api/master/resources/next-code")
    Map<String,String> nextResourceCode() { return Map.of("code", docNumbers.peek("resource")); }

    @GetMapping("/api/master/resources")
    List<ResourceMaster> resources() { return resourceMasters.findByActiveTrue(); }

    @GetMapping("/api/master/resources/{id}")
    ResourceMaster getResource(@PathVariable Long id) { return resourceMasters.findById(id).orElseThrow(); }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PostMapping("/api/master/resources")
    @Transactional ResourceMaster createResource(@RequestBody ResourceMaster r) {
        r.setId(null);
        r.setResourceCode(docNumbers.allocate("resource"));
        if (resourceMasters.existsByResourceCode(r.getResourceCode())) {
            throw new RuntimeException("Resource code already exists: " + r.getResourceCode());
        }
        if (r.getResourceName() == null || r.getResourceName().isBlank()) {
            throw new RuntimeException("Resource Name is mandatory.");
        }
        if (resourceMasters.existsByResourceNameIgnoreCase(r.getResourceName())) {
            throw new RuntimeException("A resource with this name already exists.");
        }
        if (r.getResourceType() == null || r.getResourceType().isBlank()) {
            throw new RuntimeException("Resource Type is mandatory.");
        }
        if (r.getCapacity() == null || r.getCapacity().signum() <= 0) {
            throw new RuntimeException("Capacity must be greater than 0.");
        }
        r.setActive(Boolean.TRUE);
        r.setStatus("Active");
        r.setCreatedAt(java.time.Instant.now());
        return resourceMasters.save(r);
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @PutMapping("/api/master/resources/{id}")
    @Transactional ResourceMaster updateResource(@PathVariable Long id, @RequestBody ResourceMaster r) {
        ResourceMaster existing = resourceMasters.findById(id).orElseThrow();
        if (r.getResourceName() == null || r.getResourceName().isBlank()) {
            throw new RuntimeException("Resource Name is mandatory.");
        }
        if (resourceMasters.existsByResourceNameIgnoreCaseAndIdNot(r.getResourceName(), id)) {
            throw new RuntimeException("A resource with this name already exists.");
        }
        if (r.getResourceType() == null || r.getResourceType().isBlank()) {
            throw new RuntimeException("Resource Type is mandatory.");
        }
        if (r.getCapacity() == null || r.getCapacity().signum() <= 0) {
            throw new RuntimeException("Capacity must be greater than 0.");
        }
        existing.setResourceName(r.getResourceName());
        existing.setResourceType(r.getResourceType());
        existing.setCapacity(r.getCapacity());
        existing.setCapacityUom(r.getCapacityUom());
        existing.setDepartment(r.getDepartment());
        existing.setHourlyRate(r.getHourlyRate());
        existing.setDescription(r.getDescription());
        existing.setStatus(r.getStatus() != null ? r.getStatus() : existing.getStatus());
        existing.setUpdatedAt(java.time.Instant.now());
        return resourceMasters.save(existing);
    }

    @CacheEvict(cacheNames = {"masterRefs", "masterRefsByStore"}, allEntries = true)
    @DeleteMapping("/api/master/resources/{id}")
    void deleteResource(@PathVariable Long id) {
        resourceMasters.findById(id).ifPresent(r -> {
            r.setActive(false);
            r.setStatus("Inactive");
            resourceMasters.save(r);
        });
    }

    // FRS §4.3: auto-derive process_type when Resource is Vendor
    @GetMapping("/api/master/resources/{id}/suggest-process-type")
    String suggestProcessType(@PathVariable Long id) {
        ResourceMaster r = resourceMasters.findById(id).orElseThrow();
        return "Vendor".equalsIgnoreCase(r.getResourceType()) ? "Outsource" : "Insource";
    }
}