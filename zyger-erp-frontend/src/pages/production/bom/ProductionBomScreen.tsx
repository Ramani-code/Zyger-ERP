import { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import StatusBadge from '../../../components/common/StatusBadge';
import AuditHistoryDrawer from '../../../components/common/AuditHistoryDrawer';
import SearchableItemLookup from '../../../components/common/SearchableItemLookup';
import { filterPurchaseRelevantItems } from '../../../utils/itemClassification';

interface ItemMasterRow {
  id: number;
  code: string;
  name?: string;
  description?: string;
  itemType?: string;
  itemGroup?: string;
  itemGroupName?: string;
  itemGroupType?: string;
  groupItemType?: string;
  bomCategory?: string;
  category?: string;
  groupType?: string;
  weight?: number;
  netWeight?: number;
  isActive?: boolean;
}

interface SalesOrderRow {
  id: number;
  docNo?: string;
  customer?: string;
}

interface BomLineRow {
  id?: number | string;
  lineNo?: number;
  bomLevel?: string;
  componentItemCode: string;
  quantityPer: number | '';
  weightPerQty?: number;
  totalWeight?: number;
  remarks?: string;
  componentType?: string;
  description?: string;
}

interface ProductionBomData {
  id?: number;
  docNo?: string;
  bomNumber?: string;
  date?: string;
  salesOrderId?: number | string;
  itemType?: string;
  itemCode?: string;
  description?: string;
  revision?: number;
  revisionNo?: number;
  revisionLabel?: string;
  bomVersion?: number;
  baseQuantity?: number;
  weight?: number;
  specifications?: string;
  remarks?: string;
  status?: string;
  isActive?: boolean;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
  version?: number;
  lines?: BomLineRow[];
}

interface TNode {
  id: string;
  path: string;
  type: 'FG' | 'SFG' | 'RM';
  code: string;
  label: string;
  qty?: number;
  weightPerQty?: number;
  totalWeight?: number;
  remarks?: string;
  children: TNode[];
}

export default function ProductionBomScreen() {
  const { toast } = useToast();

  // Mode & state
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [activeBomId, setActiveBomId] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);

  // List state
  const [bomList, setBomList] = useState<ProductionBomData[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Dropdown master data
  const [items, setItems] = useState<ItemMasterRow[]>([]);
  const [itemGroups, setItemGroups] = useState<Array<{ id: number; code: string; name: string; itemType?: string }>>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrderRow[]>([]);
  const [existingBoms, setExistingBoms] = useState<ProductionBomData[]>([]);

  // Form State
  const [formData, setFormData] = useState<ProductionBomData>({
    salesOrderId: '',
    itemType: '',
    itemCode: '',
    baseQuantity: 1,
    weight: 0,
    specifications: '',
    remarks: '',
    bomNumber: '',
    status: 'DRAFT',
    isActive: true,
    lines: [],
  });
  const [lines, setLines] = useState<BomLineRow[]>([]);
  const [selectedCopyBomCode, setSelectedCopyBomCode] = useState('');

  // Requirement Line Independent State
  const [reqItemType, setReqItemType] = useState<string>('');
  const [reqItemCode, setReqItemCode] = useState<string>('');
  const [breakdownViewMode, setBreakdownViewMode] = useState<'table' | 'tree'>('table');

  // Modals & Drawers
  const [revisionModalOpen, setRevisionModalOpen] = useState(false);
  const [revisionRemarks, setRevisionRemarks] = useState('');
  const [revisionSubmitting, setRevisionSubmitting] = useState(false);

  const [treeModalOpen, setTreeModalOpen] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeNodes, setTreeNodes] = useState<TNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);

  // Initial Fetch
  useEffect(() => {
    fetchMasterData();
    fetchBomList();
  }, [includeInactive]);

  const fetchMasterData = async () => {
    try {
      const [itemsRes, soRes, bomsRes, itemGroupsRes] = await Promise.all([
        apiClient.get('/master/items', { params: { size: 1000 } }),
        apiClient.get('/v1/sales/sales-order', { params: { size: 500 } }).catch(() => ({ data: [] })),
        apiClient.get('/v1/planning/production-bom', { params: { size: 1000 } }).catch(() => ({ data: [] })),
        apiClient.get('/master/item-groups').catch(() => ({ data: [] })),
      ]);

      const itemData = Array.isArray(itemsRes.data)
        ? itemsRes.data
        : itemsRes.data?.content ?? [];
      setItems(filterPurchaseRelevantItems(itemData));

      const groupData = Array.isArray(itemGroupsRes.data)
        ? itemGroupsRes.data
        : itemGroupsRes.data?.content ?? [];
      setItemGroups(groupData);

      const soData = Array.isArray(soRes.data)
        ? soRes.data
        : soRes.data?.content ?? [];
      setSalesOrders(soData);

      const bomData = Array.isArray(bomsRes.data)
        ? bomsRes.data
        : bomsRes.data?.content ?? [];
      setExistingBoms(bomData);
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to load master data.'), 'error');
    }
  };

  const fetchBomList = async () => {
    setListLoading(true);
    try {
      const res = await apiClient.get('/v1/planning/production-bom', {
        params: { size: 1000 },
      });
      const dataPayload = res.data?.data ?? res.data;
      const raw = Array.isArray(dataPayload) ? dataPayload : dataPayload?.content ?? [];
      setBomList(raw);
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to load BOM list.'), 'error');
    } finally {
      setListLoading(false);
    }
  };

  // Filtered List
  const filteredBomList = useMemo(() => {
    return bomList.filter((b) => {
      if (!includeInactive && b.isActive === false) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      const itemObj = items.find((i) => i.code === b.itemCode);
      const itemName = (itemObj?.name || itemObj?.description || b.description || '').toLowerCase();
      return (
        (b.bomNumber && b.bomNumber.toLowerCase().includes(q)) ||
        (b.docNo && b.docNo.toLowerCase().includes(q)) ||
        (b.itemCode && b.itemCode.toLowerCase().includes(q)) ||
        itemName.includes(q) ||
        (b.itemType && b.itemType.toLowerCase().includes(q)) ||
        (b.specifications && b.specifications.toLowerCase().includes(q))
      );
    });
  }, [bomList, items, includeInactive, searchQuery]);

  const groupMap = useMemo(() => {
    const map = new Map<string, any>();
    itemGroups.forEach((g) => {
      if (g.code) map.set(g.code.toUpperCase(), g);
    });
    return map;
  }, [itemGroups]);

  // Item Type Normalizer (FG vs SEMI_FG vs RM) — classifies by the item's group first,
  // then the item's own type/category, so e.g. a CUSTOMER_SUPPLIED item in a "Semi FG"
  // group is treated as SEMI_FG.
  const normalizeItemType = useCallback((typeStr?: string, itemCode?: string): string => {
    let raw = (typeStr || '').trim().toUpperCase();

    if (!raw && itemCode && items.length > 0) {
      const matchedItem = items.find((i) => i.code === itemCode);
      if (matchedItem) {
        raw = (matchedItem.itemGroupType || matchedItem.groupItemType || matchedItem.itemType || matchedItem.itemGroup || matchedItem.category || '').trim().toUpperCase();
      }
    }

    if (raw === 'SEMI_FG' || raw === 'SFG' || raw.includes('SEMI')) {
      return 'SEMI_FG';
    }
    if (raw === 'FG' || raw === 'FINISHED' || raw === 'FINISHED_GOODS' || (raw.includes('FINISHED') && !raw.includes('SEMI'))) {
      return 'FG';
    }
    if (raw === 'RM' || raw === 'RAW_MATERIAL' || raw.includes('RAW')) {
      return 'RM';
    }
    return raw;
  }, [items]);

  const formatTableItemType = useCallback((itemTypeStr?: string, itemCode?: string): { label: string; badgeStyle: React.CSSProperties } => {
    let raw = (itemTypeStr || '').trim().toUpperCase();

    if (raw === 'SEMI_FG' || raw === 'SFG' || raw.includes('SEMI')) {
      return {
        label: 'Semi FG',
        badgeStyle: {
          background: '#dcfce7',
          color: '#15803d',
          border: '1px solid #86efac',
          padding: '2px 10px',
          borderRadius: '6px',
          fontWeight: 800,
          fontSize: '0.75rem',
          letterSpacing: '0.5px',
          display: 'inline-block',
        },
      };
    }

    if (raw === 'FG' || raw === 'FINISHED' || (raw.includes('FINISHED') && !raw.includes('SEMI'))) {
      return {
        label: 'FG',
        badgeStyle: {
          background: '#dbeafe',
          color: '#1d4ed8',
          border: '1px solid #93c5fd',
          padding: '2px 10px',
          borderRadius: '6px',
          fontWeight: 800,
          fontSize: '0.75rem',
          letterSpacing: '0.5px',
          display: 'inline-block',
        },
      };
    }

    if (!raw && itemCode && items.length > 0) {
      const matchedItem = items.find((i) => i.code === itemCode);
      if (matchedItem) {
        raw = (matchedItem.itemGroupType || matchedItem.groupItemType || matchedItem.itemType || matchedItem.itemGroup || matchedItem.category || '').trim().toUpperCase();
      }
    }

    const isSemi = raw.includes('SEMI') || raw === 'SFG' || raw === 'SEMI_FG';
    if (isSemi) {
      return {
        label: 'Semi FG',
        badgeStyle: {
          background: '#dcfce7',
          color: '#15803d',
          border: '1px solid #86efac',
          padding: '2px 10px',
          borderRadius: '6px',
          fontWeight: 800,
          fontSize: '0.75rem',
          letterSpacing: '0.5px',
          display: 'inline-block',
        },
      };
    }

    return {
      label: 'FG',
      badgeStyle: {
        background: '#dbeafe',
        color: '#1d4ed8',
        border: '1px solid #93c5fd',
        padding: '2px 10px',
        borderRadius: '6px',
        fontWeight: 800,
        fontSize: '0.75rem',
        letterSpacing: '0.5px',
        display: 'inline-block',
      },
    };
  }, [items]);

  const getComponentLineItemType = useCallback((line: BomLineRow): { label: string; badgeStyle: React.CSSProperties } => {
    const code = (line.componentItemCode || '').trim().toUpperCase();
    if (!code) {
      return {
        label: 'RM',
        badgeStyle: {
          background: '#fef3c7',
          color: '#b45309',
          border: '1px solid #fde68a',
          padding: '2px 8px',
          borderRadius: '6px',
          fontWeight: 800,
          fontSize: '0.72rem',
          letterSpacing: '0.4px',
          display: 'inline-block',
        },
      };
    }

    // 1. Check if item has a BOM created in bomList
    const subBom = bomList.find((b) => b.itemCode && b.itemCode.toUpperCase() === code);
    if (subBom) {
      const bomType = (subBom.itemType || '').toUpperCase();
      if (bomType.includes('SEMI') || bomType === 'SFG' || bomType === 'SEMI_FG') {
        return {
          label: 'Semi FG',
          badgeStyle: {
            background: '#dcfce7',
            color: '#15803d',
            border: '1px solid #86efac',
            padding: '2px 8px',
            borderRadius: '6px',
            fontWeight: 800,
            fontSize: '0.72rem',
            letterSpacing: '0.4px',
            display: 'inline-block',
          },
        };
      }
      if (bomType === 'FG' || bomType.includes('FINISHED')) {
        return {
          label: 'FG',
          badgeStyle: {
            background: '#dbeafe',
            color: '#1d4ed8',
            border: '1px solid #93c5fd',
            padding: '2px 8px',
            borderRadius: '6px',
            fontWeight: 800,
            fontSize: '0.72rem',
            letterSpacing: '0.4px',
            display: 'inline-block',
          },
        };
      }
      return {
        label: 'Semi FG',
        badgeStyle: {
          background: '#dcfce7',
          color: '#15803d',
          border: '1px solid #86efac',
          padding: '2px 8px',
          borderRadius: '6px',
          fontWeight: 800,
          fontSize: '0.72rem',
          letterSpacing: '0.4px',
          display: 'inline-block',
        },
      };
    }

    // 2. Check Item Master attributes
    const matchedItem = items.find((i) => i.code && i.code.toUpperCase() === code);
    if (matchedItem) {
      const type = (matchedItem.itemType || '').toUpperCase();
      const groupCode = (matchedItem.itemGroup || '').toUpperCase();
      const igObj = groupCode ? groupMap.get(groupCode) : null;
      const igName = (igObj?.name || matchedItem.itemGroupName || '').toUpperCase();
      const igType = (igObj?.itemType || matchedItem.itemGroupType || matchedItem.groupItemType || '').toUpperCase();
      const category = (matchedItem.category || matchedItem.bomCategory || '').toUpperCase();
      const groupType = (matchedItem.groupType || '').toUpperCase();

      const isSemiFg = (
        type === 'SEMI_FG' || type === 'SFG' || type.includes('SEMI') ||
        groupCode === 'SEMI_FG' || groupCode === 'SFG' || groupCode.includes('SEMI') ||
        igName.includes('SEMI') || igName.includes('SFG') ||
        igType === 'SEMI_FG' || igType === 'SFG' || igType.includes('SEMI') ||
        category === 'SEMI_FG' || category === 'SFG' || category.includes('SEMI') ||
        groupType === 'SEMI_FG' || groupType === 'SFG' || groupType.includes('SEMI')
      );

      const isRm = (
        type === 'RM' || type === 'RAW_MATERIAL' || type.includes('RAW') ||
        groupCode === 'RM' || groupCode === 'RAW_MATERIAL' || groupCode.includes('RAW') ||
        igName.includes('RAW') || igName.includes('RM') ||
        igType === 'RM' || igType === 'RAW_MATERIAL' || igType.includes('RAW') ||
        category === 'RM' || category === 'RAW_MATERIAL' || category.includes('RAW') ||
        groupType === 'RM' || groupType === 'RAW_MATERIAL' || groupType.includes('RAW')
      );

      const isFg = !isSemiFg && !isRm && (
        type === 'FG' || type === 'FINISHED' || type === 'FINISHED_GOODS' || (type.includes('FINISHED') && !type.includes('SEMI')) ||
        groupCode === 'FG' || (groupCode.includes('FINISHED') && !groupCode.includes('SEMI')) ||
        (igName.includes('FINISHED') && !igName.includes('SEMI')) ||
        igType === 'FG' || (igType.includes('FINISHED') && !igType.includes('SEMI')) ||
        category === 'FG' || (category.includes('FINISHED') && !category.includes('SEMI')) ||
        groupType === 'FG' || (groupType.includes('FINISHED') && !groupType.includes('SEMI'))
      );

      if (isSemiFg) {
        return {
          label: 'Semi FG',
          badgeStyle: {
            background: '#dcfce7',
            color: '#15803d',
            border: '1px solid #86efac',
            padding: '2px 8px',
            borderRadius: '6px',
            fontWeight: 800,
            fontSize: '0.72rem',
            letterSpacing: '0.4px',
            display: 'inline-block',
          },
        };
      }

      if (isFg) {
        return {
          label: 'FG',
          badgeStyle: {
            background: '#dbeafe',
            color: '#1d4ed8',
            border: '1px solid #93c5fd',
            padding: '2px 8px',
            borderRadius: '6px',
            fontWeight: 800,
            fontSize: '0.72rem',
            letterSpacing: '0.4px',
            display: 'inline-block',
          },
        };
      }

      if (isRm) {
        return {
          label: 'RM',
          badgeStyle: {
            background: '#fef3c7',
            color: '#b45309',
            border: '1px solid #fde68a',
            padding: '2px 8px',
            borderRadius: '6px',
            fontWeight: 800,
            fontSize: '0.72rem',
            letterSpacing: '0.4px',
            display: 'inline-block',
          },
        };
      }
    }

    // 3. Fallback to line.componentType
    const rawType = (line.componentType || '').toUpperCase();
    if (rawType.includes('SEMI') || rawType === 'SFG' || rawType === 'SEMI_FG') {
      return {
        label: 'Semi FG',
        badgeStyle: {
          background: '#dcfce7',
          color: '#15803d',
          border: '1px solid #86efac',
          padding: '2px 8px',
          borderRadius: '6px',
          fontWeight: 800,
          fontSize: '0.72rem',
          letterSpacing: '0.4px',
          display: 'inline-block',
        },
      };
    }
    if (rawType.includes('FINISHED') || rawType === 'FG' || rawType === 'FINISHED_GOODS') {
      return {
        label: 'FG',
        badgeStyle: {
          background: '#dbeafe',
          color: '#1d4ed8',
          border: '1px solid #93c5fd',
          padding: '2px 8px',
          borderRadius: '6px',
          fontWeight: 800,
          fontSize: '0.72rem',
          letterSpacing: '0.4px',
          display: 'inline-block',
        },
      };
    }

    return {
      label: 'RM',
      badgeStyle: {
        background: '#fef3c7',
        color: '#b45309',
        border: '1px solid #fde68a',
        padding: '2px 8px',
        borderRadius: '6px',
        fontWeight: 800,
        fontSize: '0.72rem',
        letterSpacing: '0.4px',
        display: 'inline-block',
      },
    };
  }, [items, bomList, groupMap]);

  // Hierarchical Level Engine: 1.1 for 1st Semi FG, 1.1.1 for its RM; 1.2 for 2nd Semi FG, 1.2.1 for its RM; 1.3 for 3rd Semi FG, 1.3.1 for its RM
  const autoAssignComponentLevels = useCallback((currentLines: BomLineRow[]): BomLineRow[] => {
    let semiFgCount = 0;
    let currentRmCount = 0;

    return currentLines.map((line, idx) => {
      const badge = getComponentLineItemType(line);
      const isSemi = badge.label === 'Semi FG';

      if (isSemi) {
        semiFgCount += 1;
        currentRmCount = 0;
        return {
          ...line,
          lineNo: idx + 1,
          bomLevel: `1.${semiFgCount}`,
        };
      } else {
        currentRmCount += 1;
        if (semiFgCount === 0) {
          return {
            ...line,
            lineNo: idx + 1,
            bomLevel: `1.${currentRmCount}`,
          };
        }
        return {
          ...line,
          lineNo: idx + 1,
          bomLevel: `1.${semiFgCount}.${currentRmCount}`,
        };
      }
    });
  }, [getComponentLineItemType]);

  // Parent Item Filter by Item Type
  const eligibleParentItems = useMemo(() => {
    const normType = normalizeItemType(formData.itemType || reqItemType, formData.itemCode || reqItemCode);
    if (!normType && !formData.itemCode) return items;

    return items.filter((item) => {
      if (formData.itemCode && item.code === formData.itemCode) return true;
      if (item.isActive === false) return false;

      const type = (item.itemType || '').toUpperCase();
      const groupCode = (item.itemGroup || '').toUpperCase();
      const igObj = groupCode ? groupMap.get(groupCode) : null;
      const igName = (igObj?.name || item.itemGroupName || '').toUpperCase();
      const igType = (igObj?.itemType || item.itemGroupType || item.groupItemType || '').toUpperCase();
      const category = (item.category || item.bomCategory || '').toUpperCase();
      const groupType = (item.groupType || '').toUpperCase();

      const isSemiFg = (
        type === 'SEMI_FG' || type === 'SFG' || type.includes('SEMI') ||
        groupCode === 'SEMI_FG' || groupCode === 'SFG' || groupCode.includes('SEMI') ||
        igName.includes('SEMI') || igName.includes('SFG') ||
        igType === 'SEMI_FG' || igType === 'SFG' || igType.includes('SEMI') ||
        category === 'SEMI_FG' || category === 'SFG' || category.includes('SEMI') ||
        groupType === 'SEMI_FG' || groupType === 'SFG' || groupType.includes('SEMI')
      );

      const isFg = !isSemiFg && (
        type === 'FG' || type === 'FINISHED' || type === 'FINISHED_GOODS' || (type.includes('FINISHED') && !type.includes('SEMI')) ||
        groupCode === 'FG' || (groupCode.includes('FINISHED') && !groupCode.includes('SEMI')) ||
        (igName.includes('FINISHED') && !igName.includes('SEMI')) ||
        igType === 'FG' || (igType.includes('FINISHED') && !igType.includes('SEMI')) ||
        category === 'FG' || (category.includes('FINISHED') && !category.includes('SEMI')) ||
        groupType === 'FG' || (groupType.includes('FINISHED') && !groupType.includes('SEMI'))
      );

      if (normType === 'FG') return isFg;
      if (normType === 'SEMI_FG') return isSemiFg;
      return true;
    });
  }, [items, groupMap, formData.itemType, formData.itemCode, reqItemType, reqItemCode, normalizeItemType]);

  // Track item codes that already have a BOM created in BOM Creation & Maintenance
  const createdBomItemCodes = useMemo(() => {
    const set = new Set<string>();
    bomList.forEach((b) => {
      if (b.itemCode) set.add(b.itemCode.toUpperCase());
    });
    return set;
  }, [bomList]);

  // Requirement Line Filtered & Sorted Items
  const reqEligibleItems = useMemo(() => {
    if (!reqItemType) return items;
    const filtered = items.filter((item) => {
      if (item.isActive === false) return false;
      const type = (item.itemType || '').toUpperCase();
      const groupCode = (item.itemGroup || '').toUpperCase();
      const igObj = groupCode ? groupMap.get(groupCode) : null;
      const igName = (igObj?.name || item.itemGroupName || '').toUpperCase();
      const igType = (igObj?.itemType || item.itemGroupType || item.groupItemType || '').toUpperCase();
      const category = (item.category || item.bomCategory || '').toUpperCase();
      const groupType = (item.groupType || '').toUpperCase();

      const isSemiFg = (
        type === 'SEMI_FG' || type === 'SFG' || type.includes('SEMI') ||
        groupCode === 'SEMI_FG' || groupCode === 'SFG' || groupCode.includes('SEMI') ||
        igName.includes('SEMI') || igName.includes('SFG') ||
        igType === 'SEMI_FG' || igType === 'SFG' || igType.includes('SEMI') ||
        category === 'SEMI_FG' || category === 'SFG' || category.includes('SEMI') ||
        groupType === 'SEMI_FG' || groupType === 'SFG' || groupType.includes('SEMI')
      );

      const isRm = (
        type === 'RM' || type === 'RAW_MATERIAL' || type.includes('RAW') ||
        groupCode === 'RM' || groupCode === 'RAW_MATERIAL' || groupCode.includes('RAW') ||
        igName.includes('RAW') || igName.includes('RM') ||
        igType === 'RM' || igType === 'RAW_MATERIAL' || igType.includes('RAW') ||
        category === 'RM' || category === 'RAW_MATERIAL' || category.includes('RAW') ||
        groupType === 'RM' || groupType === 'RAW_MATERIAL' || groupType.includes('RAW')
      );

      const isFg = !isSemiFg && !isRm && (
        type === 'FG' || type === 'FINISHED' || type === 'FINISHED_GOODS' || (type.includes('FINISHED') && !type.includes('SEMI')) ||
        groupCode === 'FG' || (groupCode.includes('FINISHED') && !groupCode.includes('SEMI')) ||
        (igName.includes('FINISHED') && !igName.includes('SEMI')) ||
        igType === 'FG' || (igType.includes('FINISHED') && !igType.includes('SEMI')) ||
        category === 'FG' || (category.includes('FINISHED') && !category.includes('SEMI')) ||
        groupType === 'FG' || (groupType.includes('FINISHED') && !groupType.includes('SEMI'))
      );

      if (reqItemType === 'FG') return isFg;
      if (reqItemType === 'SEMI_FG') return isSemiFg;
      if (reqItemType === 'RM' || reqItemType === 'RAW_MATERIAL') return isRm;
      return true;
    });

    if (reqItemType === 'SEMI_FG') {
      return [...filtered].sort((a, b) => {
        const aHasBom = createdBomItemCodes.has(a.code.toUpperCase());
        const bHasBom = createdBomItemCodes.has(b.code.toUpperCase());
        if (aHasBom && !bHasBom) return -1;
        if (!aHasBom && bHasBom) return 1;
        return a.code.localeCompare(b.code);
      });
    }

    return filtered;
  }, [items, itemGroups, groupMap, reqItemType, createdBomItemCodes]);

  // Total Weight Header Calculation
  const headerTotalWeight = useMemo(() => {
    return lines.reduce((acc, line) => {
      const qty = typeof line.quantityPer === 'number' ? line.quantityPer : 0;
      const wpq = line.weightPerQty ?? 0;
      return acc + qty * wpq;
    }, 0);
  }, [lines]);

  // 3-Tier Tree Hierarchy Builder: Level 1 (FG) -> Level 2 (Semi FG) -> Level 3 (RM)
  const buildNestedBomTree = useCallback((
    parentCode: string,
    parentType: string,
    parentDesc: string,
    baseQty: number,
    totalWeight: number,
    currentLines: BomLineRow[]
  ): TNode[] => {
    const parentItemObj = items.find((i) => i.code === parentCode);
    const parentLabel = parentItemObj?.description || parentItemObj?.name || parentDesc || parentCode;
    const normParentType = normalizeItemType(parentType, parentCode);
    const rootType: 'FG' | 'SFG' | 'RM' = normParentType === 'SEMI_FG' ? 'SFG' : 'FG';

    const rootNode: TNode = {
      id: `nested-root-${parentCode}`,
      path: '1',
      type: rootType,
      code: parentCode,
      label: parentLabel,
      qty: baseQty || 1,
      weightPerQty: totalWeight,
      totalWeight: totalWeight,
      children: [],
    };

    const semiFgNodesMap = new Map<string, TNode>();
    const orphanRmNodes: TNode[] = [];

    currentLines.forEach((l, idx) => {
      const itemObj = items.find((i) => i.code === l.componentItemCode);
      const levelStr = l.bomLevel || `${idx + 1}`;
      const lineBadge = getComponentLineItemType(l);
      const isSemi = lineBadge.label === 'Semi FG';

      const qty = typeof l.quantityPer === 'number' ? l.quantityPer : 1;
      const wpq = l.weightPerQty ?? 0;
      const totW = l.totalWeight ?? qty * wpq;

      const node: TNode = {
        id: `nested-node-${idx}-${l.componentItemCode}`,
        path: levelStr,
        type: isSemi ? 'SFG' : 'RM',
        code: l.componentItemCode || '—',
        label: itemObj?.description || itemObj?.name || l.componentItemCode || 'Unspecified Component',
        qty,
        weightPerQty: wpq,
        totalWeight: totW,
        remarks: l.remarks,
        children: [],
      };

      if (isSemi) {
        semiFgNodesMap.set(levelStr, node);
      } else {
        const pathParts = levelStr.split('.');
        if (pathParts.length >= 3) {
          const parentSemiPath = pathParts.slice(0, 2).join('.');
          const parentSemiNode = semiFgNodesMap.get(parentSemiPath);
          if (parentSemiNode) {
            parentSemiNode.children.push(node);
          } else {
            orphanRmNodes.push(node);
          }
        } else {
          orphanRmNodes.push(node);
        }
      }
    });

    rootNode.children = [...Array.from(semiFgNodesMap.values()), ...orphanRmNodes];
    return [rootNode];
  }, [items, getComponentLineItemType, normalizeItemType]);

  // Breakdown Live Tree Construction for Tree View mode
  const breakdownTreeNodes = useMemo(() => {
    const parentCode = formData.itemCode || reqItemCode || 'PARENT_BOM_ITEM';
    return buildNestedBomTree(
      parentCode,
      formData.itemType || reqItemType,
      formData.description || '',
      formData.baseQuantity || 1,
      headerTotalWeight,
      lines
    );
  }, [formData.itemCode, formData.itemType, formData.description, formData.baseQuantity, reqItemCode, reqItemType, headerTotalWeight, lines, buildNestedBomTree]);

  // Handlers
  const handleAddNew = () => {
    setActiveBomId(null);
    setReqItemType('');
    setReqItemCode('');
    setFormData({
      salesOrderId: '',
      itemType: '',
      itemCode: '',
      baseQuantity: 1,
      weight: 0,
      specifications: '',
      remarks: '',
      bomNumber: '',
      status: 'DRAFT',
      isActive: true,
    });
    setLines([]);
    setSelectedCopyBomCode('');
    setIsEditing(true);
    setMode('form');
  };

  const handleOpenDoc = async (id: number) => {
    try {
      const res = await apiClient.get(`/v1/planning/production-bom/${id}`);
      const doc: ProductionBomData = res.data;
      const normType = normalizeItemType(doc.itemType, doc.itemCode);
      setActiveBomId(id);
      setFormData({
        ...doc,
        salesOrderId: doc.salesOrderId ?? '',
        itemType: normType,
        itemCode: doc.itemCode ?? '',
        baseQuantity: doc.baseQuantity ?? 1,
        weight: doc.weight ?? 0,
        specifications: doc.specifications ?? '',
        remarks: doc.remarks ?? '',
      });
      setReqItemType(normType);
      setReqItemCode(doc.itemCode ?? '');
      const rawLines = Array.isArray(doc.lines) ? doc.lines : [];
      const processed = rawLines.map((l, i) => {
        const qty = typeof l.quantityPer === 'number' ? l.quantityPer : 1;
        const wpq = l.weightPerQty ?? 0;
        return {
          ...l,
          lineNo: i + 1,
          quantityPer: qty,
          weightPerQty: wpq,
          totalWeight: qty * wpq,
        };
      });
      setLines(autoAssignComponentLevels(processed));
      setIsEditing(false);
      setMode('form');
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to load BOM details.'), 'error');
    }
  };

  const handleCopyBom = async (code: string) => {
    setSelectedCopyBomCode(code);
    if (!code) return;
    try {
      const res = await apiClient.post('/v1/planning/production-bom/copy', {
        sourceBomCode: code,
        salesOrderId: formData.salesOrderId || null,
      });
      const copied: ProductionBomData = res.data;
      setFormData((prev) => ({
        ...prev,
        itemType: copied.itemType || prev.itemType,
        itemCode: copied.itemCode || prev.itemCode,
        specifications: copied.specifications || prev.specifications,
        remarks: copied.remarks || prev.remarks,
        baseQuantity: copied.baseQuantity || prev.baseQuantity,
      }));
      if (Array.isArray(copied.lines)) {
        const copiedProcessed = copied.lines.map((l, i) => {
          const qty = typeof l.quantityPer === 'number' ? l.quantityPer : 1;
          const wpq = l.weightPerQty ?? 0;
          return {
            lineNo: i + 1,
            componentItemCode: l.componentItemCode,
            componentType: l.componentType,
            quantityPer: qty,
            weightPerQty: wpq,
            totalWeight: qty * wpq,
            remarks: l.remarks || '',
          };
        });
        setLines(autoAssignComponentLevels(copiedProcessed));
      }
      toast(`Copied BOM structure from ${code}`);
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to copy BOM.'), 'error');
    }
  };

  const handleAddLine = () => {
    setLines((prev) => {
      const newLine: BomLineRow = {
        lineNo: prev.length + 1,
        componentItemCode: '',
        quantityPer: 1,
        weightPerQty: 0,
        totalWeight: 0,
        remarks: '',
      };
      return autoAssignComponentLevels([...prev, newLine]);
    });
  };

  const handleAddRequirementLine = async () => {
    if (!reqItemCode) {
      toast('Please select an item to add', 'error');
      return;
    }
    const itemObj = items.find((i) => i.code === reqItemCode);
    const unitWeight = Number(itemObj?.weight ?? itemObj?.netWeight ?? 0);

    // Check if this item has an existing created BOM in bomList
    const subBom = bomList.find((b) => b.itemCode && b.itemCode.toUpperCase() === reqItemCode.toUpperCase());

    if (subBom && subBom.id) {
      try {
        setBusy(true);
        // Fetch sub-BOM details to get its component breakdown lines
        const res = await apiClient.get(`/v1/planning/production-bom/${subBom.id}`);
        const subBomData: ProductionBomData = res.data?.data ?? res.data;
        const subLines = Array.isArray(subBomData?.lines) ? subBomData.lines : [];

        setLines((prev) => {
          const parentRow: BomLineRow = {
            lineNo: prev.length + 1,
            componentItemCode: reqItemCode,
            componentType: reqItemType || 'SFG',
            quantityPer: 1,
            weightPerQty: subBomData.weight ?? unitWeight,
            totalWeight: subBomData.weight ?? unitWeight,
            remarks: `Sub-BOM: ${subBomData.bomNumber || subBomData.docNo || reqItemCode}`,
          };

          const childRows: BomLineRow[] = subLines.map((l, idx) => {
            const qty = typeof l.quantityPer === 'number' ? l.quantityPer : 1;
            const wpq = l.weightPerQty ?? 0;
            const childItem = items.find((i) => i.code === l.componentItemCode);
            const childW = wpq > 0 ? wpq : Number(childItem?.weight ?? childItem?.netWeight ?? 0);
            return {
              lineNo: prev.length + 2 + idx,
              componentItemCode: l.componentItemCode,
              componentType: l.componentType || 'RM',
              quantityPer: qty,
              weightPerQty: childW,
              totalWeight: qty * childW,
              remarks: l.remarks || `Linked to ${reqItemCode}`,
            };
          });

          return autoAssignComponentLevels([...prev, parentRow, ...childRows]);
        });

        toast(`Added ${reqItemCode} and exploded ${subLines.length} linked components into breakdown lines`, 'success');
        setReqItemCode('');
      } catch (e) {
        toast(getApiErrorMessage(e, `Failed to load sub-BOM for ${reqItemCode}. Adding single line.`), 'error');
        setLines((prev) =>
          autoAssignComponentLevels([
            ...prev,
            {
              lineNo: prev.length + 1,
              componentItemCode: reqItemCode,
              componentType: reqItemType || 'SFG',
              quantityPer: 1,
              weightPerQty: unitWeight,
              totalWeight: unitWeight,
              remarks: '',
            },
          ])
        );
        setReqItemCode('');
      } finally {
        setBusy(false);
      }
    } else {
      // Single line addition when item has no sub-BOM
      setLines((prev) =>
        autoAssignComponentLevels([
          ...prev,
          {
            lineNo: prev.length + 1,
            componentItemCode: reqItemCode,
            componentType: reqItemType || 'RM',
            quantityPer: 1,
            weightPerQty: unitWeight,
            totalWeight: unitWeight * 1,
            remarks: '',
          },
        ])
      );
      setReqItemCode('');
      toast(`Added item ${reqItemCode} to breakdown lines`);
    }
  };

  const handleDeleteLine = (index: number) => {
    setLines((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return autoAssignComponentLevels(next);
    });
  };

  const handleLineChange = (index: number, field: keyof BomLineRow, val: unknown) => {
    setLines((prev) => {
      const next = [...prev];
      const line = { ...next[index], [field]: val };

      if (field === 'componentItemCode') {
        const codeStr = String(val).toUpperCase();
        const subBom = bomList.find((b) => b.itemCode && b.itemCode.toUpperCase() === codeStr);
        const itemObj = items.find((i) => i.code === val);
        if (itemObj) {
          line.weightPerQty = itemObj.weight ?? itemObj.netWeight ?? 0;
          line.description = itemObj.description ?? itemObj.name ?? '';
        }
        if (subBom) {
          line.componentType = subBom.itemType || 'SEMI_FG';
        } else if (itemObj) {
          line.componentType = itemObj.itemType || itemObj.itemGroup || itemObj.category || 'RM';
        }
      }

      const qty = typeof line.quantityPer === 'number' ? line.quantityPer : 0;
      const wpq = line.weightPerQty ?? 0;
      line.totalWeight = qty * wpq;

      next[index] = line;
      return autoAssignComponentLevels(next);
    });
  };

  const validateForm = (): boolean => {
    const effItemType = formData.itemType || reqItemType;
    const effItemCode = formData.itemCode || reqItemCode;

    if (!effItemType) {
      toast('Item Type is mandatory.', 'error');
      return false;
    }    if (effItemType === 'RM' || effItemType === 'RAW_MATERIAL') {
      toast('BOM cannot be created for Raw Material items.', 'error');
      return false;
    }
    if (!effItemCode) {
      toast('BOM Item is mandatory.', 'error');
      return false;
    }
    if (formData.baseQuantity == null || formData.baseQuantity <= 0) {
      toast('Quantity should be greater than zero.', 'error');
      return false;
    }

    const isSoSpecific = Boolean(formData.salesOrderId);
    const conflict = existingBoms.find((b) => {
      if (b.id === activeBomId || b.isActive === false) return false;
      if (isSoSpecific) {
        return (
          String(b.salesOrderId) === String(formData.salesOrderId) &&
          b.itemCode === effItemCode
        );
      }
      return !b.salesOrderId && b.itemCode === effItemCode;
    });

    if (conflict) {
      if (isSoSpecific) {
        toast('BOM already exists for the selected Sales Order and Item.', 'error');
      } else {
        toast('Active BOM already exists for the selected item.', 'error');
      }
      return false;
    }

    if (lines.length === 0) {
      toast('At least one component is required.', 'error');
      return false;
    }

    const seenComponents = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.componentItemCode) {
        toast(`Line ${i + 1}: Item Name is mandatory.`, 'error');
        return false;
      }
      if (l.quantityPer === '' || l.quantityPer <= 0) {
        toast(`Line ${i + 1}: Component quantity must be greater than zero.`, 'error');
        return false;
      }
      if (l.componentItemCode === effItemCode) {
        toast(`Line ${i + 1}: Parent item and component item cannot be same.`, 'error');
        return false;
      }
      if (seenComponents.has(l.componentItemCode)) {
        toast(`Line ${i + 1}: Duplicate component item is not allowed.`, 'error');
        return false;
      }
      seenComponents.add(l.componentItemCode);
    }

    return true;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    const effItemType = formData.itemType;
    const effItemCode = formData.itemCode || reqItemCode;
    const finalQuantity = formData.baseQuantity != null && formData.baseQuantity > 0 ? Number(formData.baseQuantity) : 1;

    const payload = {
      ...formData,
      itemType: effItemType,
      itemCode: effItemCode,
      baseQuantity: finalQuantity,
      salesOrderId: formData.salesOrderId ? Number(formData.salesOrderId) : null,
      weight: headerTotalWeight,
      lines: lines.map((l, idx) => ({
        lineNo: idx + 1,
        bomLevel: l.bomLevel || `${idx + 1}`,
        componentItemCode: l.componentItemCode,
        quantityPer: Number(l.quantityPer),
        weightPerQty: l.weightPerQty ?? 0,
        totalWeight: Number(l.quantityPer) * (l.weightPerQty ?? 0),
        remarks: l.remarks || '',
      })),
    };

    try {
      let resData: Record<string, unknown>;
      if (activeBomId) {
        const res = await apiClient.put(`/v1/planning/production-bom/${activeBomId}`, payload);
        resData = res.data?.data ?? res.data;
        toast('BOM updated successfully.', 'success');
      } else {
        const res = await apiClient.post('/v1/planning/production-bom', payload);
        resData = res.data?.data ?? res.data;
        toast('BOM created successfully.', 'success');
      }

      const savedId = resData.id ? Number(resData.id) : activeBomId;
      if (savedId) setActiveBomId(savedId);

      const chosenItemType = effItemType || String(resData.itemType || '');
      const chosenItemCode = effItemCode || String(resData.itemCode || '');
      const normType = normalizeItemType(chosenItemType, chosenItemCode);
      const savedQuantity = resData.baseQuantity != null && Number(resData.baseQuantity) > 0 ? Number(resData.baseQuantity) : finalQuantity;
      const finalWeight = headerTotalWeight > 0 ? headerTotalWeight : Number(formData.weight ?? resData.weight ?? 0);

      setFormData((prev) => ({
        ...prev,
        id: savedId ?? prev.id,
        bomNumber: String(resData.bomNumber || resData.docNo || prev.bomNumber || ''),
        status: String(resData.status || prev.status || 'DRAFT'),
        salesOrderId: resData.salesOrderId != null ? String(resData.salesOrderId) : prev.salesOrderId,
        itemType: normType,
        itemCode: chosenItemCode,
        baseQuantity: savedQuantity,
        weight: finalWeight,
        specifications: String(formData.specifications || resData.specifications || prev.specifications || ''),
        remarks: String(formData.remarks || resData.remarks || prev.remarks || ''),
      }));

      setReqItemType(normType);
      setReqItemCode(chosenItemCode);
      setIsEditing(false);
      await fetchBomList();
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to save BOM.'), 'error');
    }
  };

  const handleDeleteBom = async (id: number, bomNumber?: string) => {
    if (!window.confirm(`Are you sure you want to delete BOM ${bomNumber || id}?`)) {
      return;
    }
    setBusy(true);
    try {
      await apiClient.delete(`/v1/planning/production-bom/${id}`);
      toast('BOM deleted successfully.', 'success');
      setBomList((prev) => prev.filter((b) => b.id !== id));
      if (activeBomId === id) {
        setMode('list');
        setActiveBomId(null);
      }
      fetchBomList();
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to delete BOM.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateRevisionSubmit = async () => {
    if (!revisionRemarks.trim()) {
      toast('Remarks are mandatory for a new revision.', 'error');
      return;
    }
    if (!activeBomId) return;

    setRevisionSubmitting(true);
    try {
      const res = await apiClient.post(`/v1/planning/production-bom/${activeBomId}/revise`, {
        newVersion: '2.0',
        remarks: revisionRemarks.trim(),
      });
      const newRevDoc: ProductionBomData = res.data;
      toast(`Created Revision ${newRevDoc.revisionLabel || newRevDoc.bomNumber}`, 'success');
      setRevisionModalOpen(false);
      setRevisionRemarks('');
      handleOpenDoc(newRevDoc.id!);
      fetchBomList();
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to create revision.'), 'error');
    } finally {
      setRevisionSubmitting(false);
    }
  };

  const handleDownloadPdf = () => {
    if (!activeBomId) return;
    const url = `/api/v1/planning/production-bom/${activeBomId}/pdf`;
    window.open(url, '_blank');
  };

  const handlePrint = () => {
    if (!activeBomId) return;
    const url = `/api/v1/planning/production-bom/${activeBomId}/print`;
    window.open(url, '_blank');
  };

  const handleOpenTreeModal = async () => {
    if (!activeBomId) return;
    setTreeModalOpen(true);
    setTreeLoading(true);
    try {
      const parentCode = formData.itemCode || reqItemCode || 'PARENT';
      const nodes = buildNestedBomTree(
        parentCode,
        formData.itemType || reqItemType,
        formData.description || '',
        formData.baseQuantity || 1,
        headerTotalWeight,
        lines
      );

      setTreeNodes(nodes);

      const collectPaths = (nodes: TNode[], acc: Set<string>): void => {
        nodes.forEach((n) => {
          acc.add(n.path);
          collectPaths(n.children, acc);
        });
      };
      const expanded = new Set<string>();
      collectPaths(nodes, expanded);
      setExpandedPaths(expanded);
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to build BOM tree structure.'), 'error');
    } finally {
      setTreeLoading(false);
    }
  };

  const toggleTreeNode = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderTreeSingleNode = (node: TNode) => {
    const isExpanded = expandedPaths.has(node.path);
    const hasChildren = Boolean(node.children && node.children.length > 0);
    const itemObj = items.find((i) => i.code === node.code);
    const displayLabel = node.label && node.label !== node.code
      ? node.label
      : (itemObj?.description || itemObj?.name || '');

    const unitW = node.weightPerQty != null && node.weightPerQty > 0
      ? node.weightPerQty
      : Number(itemObj?.weight ?? itemObj?.netWeight ?? 0);
    const qtyVal = node.qty != null && node.qty > 0 ? node.qty : 1;
    const totalW = node.totalWeight != null && node.totalWeight > 0
      ? node.totalWeight
      : unitW * qtyVal;

    return (
      <div key={node.id} style={{ marginBottom: '10px' }}>
        {/* Node Card Row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '10px 16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          {/* Left Metadata */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleTreeNode(node.path)}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                  {isExpanded ? 'expand_more' : 'chevron_right'}
                </span>
              </button>
            ) : (
              <div style={{ width: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#94a3b8', display: 'inline-block' }} />
              </div>
            )}

            {/* Level Badge */}
            <span
              style={{
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '2px 10px',
                fontWeight: 700,
                fontSize: '0.82rem',
                color: '#475569',
                fontFamily: 'monospace',
                letterSpacing: '0.5px',
              }}
            >
              {node.path}
            </span>

            {/* Color-Coded Item Type Badge */}
            {node.type === 'FG' ? (
              <span
                style={{
                  background: '#dbeafe',
                  border: '1px solid #93c5fd',
                  borderRadius: '6px',
                  padding: '2px 10px',
                  fontWeight: 800,
                  fontSize: '0.75rem',
                  color: '#1d4ed8',
                  letterSpacing: '0.5px',
                }}
              >
                FG
              </span>
            ) : node.type === 'SFG' ? (
              <span
                style={{
                  background: '#dcfce7',
                  border: '1px solid #86efac',
                  borderRadius: '6px',
                  padding: '2px 10px',
                  fontWeight: 800,
                  fontSize: '0.75rem',
                  color: '#15803d',
                  letterSpacing: '0.5px',
                }}
              >
                SEMI FG
              </span>
            ) : (
              <span
                style={{
                  background: '#fef3c7',
                  border: '1px solid #fde047',
                  borderRadius: '6px',
                  padding: '2px 10px',
                  fontWeight: 800,
                  fontSize: '0.75rem',
                  color: '#b45309',
                  letterSpacing: '0.5px',
                }}
              >
                RM
              </span>
            )}

            {/* Item Code & Description */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#0f172a' }}>
                {node.code}
              </span>
              {displayLabel && (
                <span style={{ fontWeight: 500, fontSize: '0.85rem', color: '#64748b' }}>
                  {displayLabel}
                </span>
              )}
            </div>
          </div>
          {/* Right Metrics - Fixed Grid Columns for 100% Straight Column Alignment */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '70px 125px 145px 230px',
              gap: '8px',
              alignItems: 'center',
              marginLeft: 'auto',
              flexShrink: 0,
            }}
          >
            {/* Qty Pill */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '3px 6px',
                fontSize: '0.8rem',
                color: '#64748b',
                whiteSpace: 'nowrap',
                textAlign: 'center',
              }}
            >
              Qty: <strong style={{ color: '#0f172a', fontWeight: 700 }}>{qtyVal}</strong>
            </div>

            {/* W/Unit Pill */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '3px 6px',
                fontSize: '0.8rem',
                color: '#64748b',
                whiteSpace: 'nowrap',
                textAlign: 'center',
              }}
            >
              W/Unit: <strong style={{ color: '#0f172a', fontWeight: 700 }}>{unitW.toFixed(3).replace(/\.?0+$/, '') || '0'} kg</strong>
            </div>

            {/* Total Wt Pill */}
            <div
              style={{
                background: '#e0f2fe',
                border: '1px solid #bae6fd',
                borderRadius: '6px',
                padding: '3px 8px',
                fontSize: '0.8rem',
                color: '#0284c7',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                textAlign: 'center',
              }}
            >
              Total Wt: <strong style={{ color: '#0369a1', fontWeight: 800 }}>{totalW.toFixed(3).replace(/\.?0+$/, '') || '0'} kg</strong>
            </div>

            {/* Remarks Tag */}
            {node.remarks ? (
              <div
                title={node.remarks}
                style={{
                  background: '#fdf2f8',
                  border: '1px solid #fbcfe8',
                  borderRadius: '12px',
                  padding: '3px 12px',
                  fontSize: '0.78rem',
                  color: '#db2777',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  textAlign: 'center',
                }}
              >
                {node.remarks}
              </div>
            ) : (
              <div
                style={{
                  background: '#fdf2f8',
                  border: '1px solid #fbcfe8',
                  borderRadius: '12px',
                  padding: '3px 12px',
                  fontSize: '0.78rem',
                  color: '#db2777',
                  fontWeight: 600,
                  opacity: 0.7,
                  whiteSpace: 'nowrap',
                  textAlign: 'center',
                }}
              >
                note
              </div>
            )}
          </div>
        </div>

        {/* Children Sub-Tree Branch */}
        {hasChildren && isExpanded && (
          <div
            style={{
              position: 'relative',
              marginTop: '10px',
              paddingLeft: '36px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Vertical spine connector line */}
            <div
              style={{
                position: 'absolute',
                left: '16px',
                top: '0px',
                bottom: '26px',
                width: '2px',
                background: '#cbd5e1',
              }}
            />
            {node.children.map((child) => (
              <div key={child.id} style={{ position: 'relative' }}>
                {/* Horizontal elbow connector line */}
                <div
                  style={{
                    position: 'absolute',
                    left: '-20px',
                    top: '20px',
                    width: '18px',
                    height: '14px',
                    borderLeft: '2px solid #cbd5e1',
                    borderBottom: '2px solid #cbd5e1',
                    borderBottomLeftRadius: '6px',
                  }}
                />
                {renderTreeSingleNode(child)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderTreeNodesRecursive = (nodes: TNode[]) => {
    return nodes.map((node) => renderTreeSingleNode(node));
  };

  return (
    <div className="bom-container">
      {/* Top Header Card */}
      <div className="bom-card bom-header-bar">
        <div className="bom-title-wrap">
          <h1>
            <span className="material-symbols-rounded" style={{ color: '#2563eb', fontSize: 28 }}>account_tree</span>
            BOM Creation & Maintenance
          </h1>
          <p>Manufacturing Product Data Management (PDM) — Multi-level BOM hierarchy & revision control</p>
        </div>

        {mode === 'list' ? (
          <div className="bom-toolbar-actions">
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
                style={{ borderRadius: 4 }}
              />
              Show Inactive Revisions
            </label>
            <button className="btn btn-p" onClick={handleAddNew}>
              <span className="material-symbols-rounded">add</span> New BOM
            </button>
          </div>
        ) : (
          <div className="bom-toolbar-actions">
            {isEditing ? (
              <button className="btn btn-p" onClick={handleSave}>
                <span className="material-symbols-rounded">save</span> Save
              </button>
            ) : (
              <button
                className="btn"
                onClick={() => {
                  if (formData.isActive === false) {
                    toast('This revision is inactive and cannot be edited.', 'error');
                    return;
                  }
                  setIsEditing(true);
                }}
                disabled={formData.isActive === false}
              >
                <span className="material-symbols-rounded">edit</span> Edit
              </button>
            )}

            {activeBomId && (
              <>
                <button
                  className="btn"
                  onClick={() => setRevisionModalOpen(true)}
                  disabled={formData.isActive === false}
                  title="Create New Revision"
                >
                  <span className="material-symbols-rounded">history</span> BOM Revision
                </button>
                <button className="btn" onClick={handleDownloadPdf} title="Export PDF">
                  <span className="material-symbols-rounded">picture_as_pdf</span> PDF
                </button>
                <button className="btn" onClick={handlePrint} title="Print View">
                  <span className="material-symbols-rounded">print</span> Print
                </button>
                <button className="btn" onClick={handleOpenTreeModal} title="View BOM Hierarchy Tree">
                  <span className="material-symbols-rounded">account_tree</span> Tree View
                </button>
                <button className="btn" onClick={() => setHistoryDrawerOpen(true)} title="Audit History">
                  <span className="material-symbols-rounded">manage_search</span> Audit
                </button>
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => handleDeleteBom(activeBomId, formData.bomNumber || formData.docNo)}
                  title="Delete BOM"
                  style={{ background: '#ef4444', color: '#fff', border: '1px solid #dc2626' }}
                >
                  <span className="material-symbols-rounded">delete</span> Delete
                </button>
              </>
            )}

            <button
              className="btn"
              onClick={() => {
                setMode('list');
                fetchBomList();
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      {mode === 'list' ? (
        <div className="bom-card">
          <div className="bom-search-row">
            <div className="bom-search-input-wrap">
              <span className="material-symbols-rounded">search</span>
              <input
                className="in"
                type="text"
                placeholder="Search BOM Code, Item Code, Type..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 500 }}>
              Showing <strong style={{ color: '#0f172a' }}>{filteredBomList.length}</strong> BOM structures
            </div>
          </div>

          {listLoading ? (
            <div className="empty">
              <span className="material-symbols-rounded">hourglass_empty</span> Loading BOM master records...
            </div>
          ) : filteredBomList.length === 0 ? (
            <div className="empty">
              <span className="material-symbols-rounded">search_off</span> No BOM records found matching your query.
            </div>
          ) : (
            <div className="bom-table-wrap">
              <table className="bom-table">
                <thead>
                  <tr>
                    <th className="num">S.No</th>
                    <th>BOM Code</th>
                    <th>Item Name</th>
                    <th>Item Type</th>
                    <th>Revision</th>
                    <th style={{ textAlign: 'right' }}>Base Qty</th>
                    <th style={{ textAlign: 'right' }}>Total Weight</th>
                    <th>Status</th>
                    <th>Active</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBomList.map((bom, bomIdx) => {
                    const itemObj = items.find((i) => i.code === bom.itemCode);
                    const itemName = itemObj?.name || itemObj?.description || bom.description || bom.itemCode || '—';
                    const typeBadge = formatTableItemType(bom.itemType, bom.itemCode);
                    return (
                      <tr key={bom.id} onClick={() => handleOpenDoc(bom.id!)}>
                        <td className="num mut">{bomIdx + 1}</td>
                        <td style={{ fontWeight: 700, color: '#2563eb' }}>{bom.bomNumber || bom.docNo || `BOM-${bom.id}`}</td>
                        <td style={{ fontWeight: 600, color: '#0f172a' }}>{itemName}</td>
                        <td>
                          <span style={typeBadge.badgeStyle}>{typeBadge.label}</span>
                        </td>
                        <td style={{ color: '#d97706', fontWeight: 600 }}>{bom.revisionLabel || `Rev ${bom.revisionNo || 0}`}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{bom.baseQuantity ?? 1}</td>
                        <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>{(bom.weight ?? 0).toFixed(3)} kg</td>
                        <td>
                          <StatusBadge status={bom.status || 'DRAFT'} />
                        </td>
                        <td>
                          {bom.isActive !== false ? (
                            <span style={{ color: '#16a34a', fontWeight: 700, fontSize: '0.78rem' }}>Active</span>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Inactive</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
                            <button
                              className="btn btn-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenDoc(bom.id!);
                              }}
                            >
                              View / Edit
                            </button>
                            <button
                              className="btn btn-sm danger"
                              title="Delete BOM"
                              disabled={busy}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteBom(bom.id!, bom.bomNumber || bom.docNo);
                              }}
                              style={{ padding: '4px 8px' }}
                            >
                              <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Form View */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Header Card */}
          <div className="bom-card">
            <div className="panel-h" style={{ padding: '0 0 14px 0', borderBottom: '1px solid #e2e8f0', marginBottom: 16 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-symbols-rounded" style={{ color: '#2563eb' }}>description</span>
                BOM Master Details
              </h2>
              {activeBomId && <StatusBadge status={formData.status || 'DRAFT'} />}
            </div>

            <div className="fgrid" style={{ padding: '16px 0 0 0' }}>
              <label className="fld">
                <span>Doc No / BOM Code</span>
                <input className="in" readOnly tabIndex={-1} value={formData.bomNumber || formData.docNo || 'Auto-generated'} style={{ background: '#f8fafc', fontWeight: 600 }} />
              </label>

              <label className="fld">
                <span>Sales Order</span>
                <select
                  className="in"
                  disabled={!isEditing}
                  value={String(formData.salesOrderId ?? '')}
                  onChange={(e) => setFormData((c) => ({ ...c, salesOrderId: e.target.value }))}
                >
                  <option value="">— Standard / Global BOM —</option>
                  {salesOrders.map((so) => (
                    <option key={String(so.id)} value={String(so.id)}>
                      {so.docNo ?? `SO-${so.id}`} {so.customer ? `— ${so.customer}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="fld">
                <span>Copy BOM Item</span>
                <select
                  className="in"
                  disabled={!isEditing}
                  value={selectedCopyBomCode}
                  onChange={(e) => handleCopyBom(e.target.value)}
                >
                  <option value="">— Select to Copy BOM —</option>
                  {existingBoms.map((b) => (
                    <option key={String(b.id)} value={b.bomNumber || b.itemCode || String(b.id)}>
                      {b.bomNumber || `BOM-${b.id}`} — {b.itemCode}
                    </option>
                  ))}
                </select>
              </label>

              <label className="fld">
                <span>Item Type <em className="req">*</em></span>
                <select
                  className="in"
                  disabled={!isEditing}
                  value={formData.itemType === 'SEMI_FG' || formData.itemType === 'SFG' || formData.itemType === 'Semi FG' || formData.itemType?.includes('SEMI')
                    ? 'SEMI_FG'
                    : formData.itemType === 'FG' || formData.itemType === 'Finished Goods (FG)' || formData.itemType?.includes('FINISHED')
                    ? 'FG'
                    : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData((prev) => ({ ...prev, itemType: val, itemCode: '' }));
                    setReqItemType(val);
                    setReqItemCode('');
                  }}
                >
                  <option value="">— Select Item Type —</option>
                  <option value="FG">Finished Goods (FG)</option>
                  <option value="SEMI_FG">Semi Finished Goods (Semi FG)</option>
                </select>
              </label>

              <label className="fld">
                <span>BOM Item <em className="req">*</em></span>
                <select
                  className="in"
                  disabled={!isEditing || (!formData.itemType && !reqItemType)}
                  value={formData.itemCode || ''}
                  onChange={(e) => {
                    const code = e.target.value;
                    if (!code) {
                      setFormData((c) => ({ ...c, itemCode: '', description: '' }));
                      setReqItemCode('');
                      return;
                    }
                    const item = items.find((i) => i.code === code);
                    const masterWeight = Number(item?.weight ?? item?.netWeight ?? 0);

                    setFormData((c) => ({
                      ...c,
                      itemCode: code,
                      description: item?.description ?? item?.name ?? c.description,
                      weight: masterWeight > 0 ? masterWeight : c.weight,
                    }));
                    setReqItemCode(code);
                  }}
                >
                  <option value="">— Select BOM Item —</option>
                  {eligibleParentItems.map((it) => (
                    <option key={String(it.id)} value={it.code}>
                      {it.code} — {it.description || it.name || ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="fld">
                <span>Quantity <em className="req">*</em></span>
                <input
                  className="in"
                  type="number"
                  disabled={!isEditing}
                  value={formData.baseQuantity ?? 1}
                  onChange={(e) => setFormData((c) => ({ ...c, baseQuantity: Number(e.target.value) }))}
                />
              </label>

              <label className="fld">
                <span>Total Weight (KG)</span>
                <input
                  className="in"
                  type="number"
                  step="0.001"
                  disabled={!isEditing}
                  value={formData.weight ?? (headerTotalWeight > 0 ? headerTotalWeight : 0)}
                  onChange={(e) => setFormData((c) => ({ ...c, weight: Number(e.target.value) }))}
                  placeholder="0.000"
                  style={{ fontWeight: 600, color: '#16a34a' }}
                />
              </label>

              <label className="fld span2">
                <span>Specifications</span>
                <textarea
                  className="in"
                  rows={2}
                  readOnly={!isEditing}
                  value={formData.specifications || ''}
                  onChange={(e) => setFormData((c) => ({ ...c, specifications: e.target.value }))}
                />
              </label>

              <label className="fld span3">
                <span>Remarks</span>
                <textarea
                  className="in"
                  rows={2}
                  readOnly={!isEditing}
                  value={formData.remarks || ''}
                  onChange={(e) => setFormData((c) => ({ ...c, remarks: e.target.value }))}
                />
              </label>
            </div>
          </div>

          {/* Requirement Line Card (Below BOM Master Details) */}
          <div className="bom-card">
            <div className="panel-h" style={{ padding: '0 0 14px 0', borderBottom: '1px solid #e2e8f0', marginBottom: 16 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-symbols-rounded" style={{ color: '#2563eb' }}>list_alt</span>
                Requirement Line
              </h2>
            </div>

            <div className="fgrid" style={{ padding: '16px 0 0 0', display: 'flex', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap' }}>
              <label className="fld" style={{ flex: '1 1 200px' }}>
                <span>Item Type <em className="req">*</em></span>
                <select
                  className="in"
                  disabled={!isEditing}
                  value={reqItemType}
                  onChange={(e) => {
                    setReqItemType(e.target.value);
                    setReqItemCode('');
                  }}
                >
                  <option value="">— Select Item Type —</option>
                  <option value="FG">Finished Goods (FG)</option>
                  <option value="SEMI_FG">Semi Finished Goods (Semi FG)</option>
                  <option value="RM">Raw Material (RM)</option>
                </select>
              </label>

              <label className="fld" style={{ flex: '2 1 300px' }}>
                <span>Item <em className="req">*</em></span>
                <SearchableItemLookup
                  disabled={!isEditing || !reqItemType}
                  value={reqItemCode}
                  items={reqEligibleItems.map((it) => {
                    const hasBom = createdBomItemCodes.has(it.code.toUpperCase());
                    return {
                      id: it.id,
                      code: it.code,
                      description: `${hasBom ? '★ [BOM Created] ' : ''}${it.description || it.name || ''}`,
                    };
                  })}
                  onChange={(val) => setReqItemCode(val)}
                />
              </label>

              {isEditing && (
                <button
                  type="button"
                  className="btn btn-p"
                  disabled={!reqItemCode}
                  onClick={handleAddRequirementLine}
                  style={{ height: '38px', padding: '0 22px', display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', fontWeight: 600 }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span> Add
                </button>
              )}
            </div>
          </div>

          {/* Component Table Card */}
          <div className="bom-card">
            <div className="panel-h" style={{ padding: '0 0 14px 0', borderBottom: '1px solid #e2e8f0', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-symbols-rounded" style={{ color: '#2563eb' }}>view_list</span>
                Components Breakdown
              </h2>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: '8px', overflow: 'hidden', padding: '2px', background: '#f8fafc' }}>
                  <button
                    type="button"
                    onClick={() => setBreakdownViewMode('table')}
                    style={{
                      padding: '5px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      background: breakdownViewMode === 'table' ? '#ffffff' : 'transparent',
                      color: breakdownViewMode === 'table' ? '#2563eb' : '#64748b',
                      boxShadow: breakdownViewMode === 'table' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>table_rows</span> Table View
                  </button>
                  <button
                    type="button"
                    onClick={() => setBreakdownViewMode('tree')}
                    style={{
                      padding: '5px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      background: breakdownViewMode === 'tree' ? '#ffffff' : 'transparent',
                      color: breakdownViewMode === 'tree' ? '#2563eb' : '#64748b',
                      boxShadow: breakdownViewMode === 'tree' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>account_tree</span> Tree Structure
                  </button>
                </div>
                {isEditing && (
                  <button className="btn btn-sm btn-p" onClick={handleAddLine}>
                    <span className="material-symbols-rounded">add</span> Add Component Line
                  </button>
                )}
              </div>
            </div>

            {breakdownViewMode === 'tree' ? (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
                <div style={{ marginBottom: 12, fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '18px', color: '#16a34a' }}>park</span> Multi-Level Interactive Tree View
                </div>
                {renderTreeNodesRecursive(breakdownTreeNodes)}
              </div>
            ) : (
              <div className="twrap">
                <table className="tbl lines">
                  <thead>
                    <tr>
                      <th className="num">S.No</th>
                      <th style={{ width: '80px' }}>Level</th>
                      <th style={{ width: '100px' }}>Item Type</th>
                      <th style={{ minWidth: '180px' }}>Item Code *</th>
                      <th style={{ minWidth: '220px' }}>Item Name</th>
                      <th style={{ width: '120px', textAlign: 'right' }}>Quantity *</th>
                      <th style={{ width: '130px', textAlign: 'right' }}>Weight/Unit</th>
                      <th style={{ width: '130px', textAlign: 'right' }}>Total Weight</th>
                      <th>Remarks</th>
                      {isEditing && <th style={{ width: '60px' }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr>
                        <td colSpan={isEditing ? 10 : 9}>
                          <div className="empty">
                            <span className="material-symbols-rounded">playlist_add</span> No components added yet. Click &quot;Add Component Line&quot;.
                          </div>
                        </td>
                      </tr>
                    ) : (
                      lines.map((line, index) => {
                        const itemObj = items.find((i) => i.code === line.componentItemCode);
                        const itemName = itemObj?.description || itemObj?.name || line.description || '—';
                        const lineBadge = getComponentLineItemType(line);
                        return (
                          <tr key={index}>
                            <td className="num mut">{index + 1}</td>
                            <td>
                              <input
                                className="in"
                                disabled={!isEditing}
                                value={line.bomLevel || `${index + 1}`}
                                onChange={(e) => handleLineChange(index, 'bomLevel', e.target.value)}
                                style={{ textAlign: 'center' }}
                              />
                            </td>
                            <td>
                              <span style={lineBadge.badgeStyle}>{lineBadge.label}</span>
                            </td>
                            <td>
                              {isEditing ? (
                                <SearchableItemLookup
                                  value={line.componentItemCode || ''}
                                  items={items.map((it) => ({ id: it.id, code: it.code, description: `${it.description || it.name || ''} (${it.itemType || 'RM'})` }))}
                                  onChange={(val) => handleLineChange(index, 'componentItemCode', val)}
                                />
                              ) : (
                                <div style={{ fontWeight: 600 }}>{line.componentItemCode}</div>
                              )}
                            </td>
                            <td style={{ color: '#475569', fontSize: '0.85rem' }}>
                              {itemName}
                            </td>
                            <td>
                              <input
                                className="in"
                                type="number"
                                disabled={!isEditing}
                                value={line.quantityPer}
                                onChange={(e) => handleLineChange(index, 'quantityPer', Number(e.target.value))}
                                style={{ textAlign: 'right' }}
                              />
                            </td>
                            <td>
                              <input
                                className="in"
                                type="number"
                                disabled={!isEditing}
                                value={line.weightPerQty ?? 0}
                                onChange={(e) => handleLineChange(index, 'weightPerQty', Number(e.target.value))}
                                style={{ textAlign: 'right' }}
                              />
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>
                              {(line.totalWeight ?? 0).toFixed(3)} kg
                            </td>
                            <td>
                              <input
                                className="in"
                                disabled={!isEditing}
                                value={line.remarks || ''}
                                onChange={(e) => handleLineChange(index, 'remarks', e.target.value)}
                              />
                            </td>
                            {isEditing && (
                              <td style={{ textAlign: 'center' }}>
                                <button className="ibtn danger" title="Delete Row" onClick={() => handleDeleteLine(index)}>
                                  <span className="material-symbols-rounded">delete</span>
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tree View Modal - Full Screen Spacious Layout */}
      {treeModalOpen && (
        <div className="modal-overlay" style={{ padding: '12px', zIndex: 1100 }}>
          <div
            className="modal"
            style={{
              width: '98vw',
              maxWidth: '1800px',
              height: '92vh',
              maxHeight: '95vh',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              margin: 'auto',
            }}
          >
            <div
              className="modal-h"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 24px',
                borderBottom: '1px solid #e2e8f0',
                background: '#ffffff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span
                  className="material-symbols-rounded"
                  style={{
                    color: '#0284c7',
                    background: '#e0f2fe',
                    padding: '8px',
                    borderRadius: '10px',
                    fontSize: '24px',
                  }}
                >
                  account_tree
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                    Multi-Level BOM Tree Structure View
                  </h3>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Full screen interactive component hierarchy & breakdown
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const allPaths = new Set<string>();
                    const collect = (nodes: TNode[]) => {
                      nodes.forEach((n) => {
                        allPaths.add(n.path);
                        if (n.children) collect(n.children);
                      });
                    };
                    collect(treeNodes);
                    setExpandedPaths(expandedPaths.size === allPaths.size ? new Set() : allPaths);
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>
                    {expandedPaths.size > 0 ? 'unfold_less' : 'unfold_more'}
                  </span>
                  {expandedPaths.size > 0 ? 'Collapse All' : 'Expand All'}
                </button>
                <button className="ibtn" onClick={() => setTreeModalOpen(false)}>
                  <span className="material-symbols-rounded">close</span>
                </button>
              </div>
            </div>

            <div
              className="modal-b"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '24px',
                background: '#f8fafc',
              }}
            >
              {treeLoading ? (
                <div className="empty" style={{ padding: '60px 0' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '36px', color: '#0284c7' }}>hourglass_empty</span>
                  <div>Building tree hierarchy...</div>
                </div>
              ) : treeNodes.length === 0 ? (
                <div className="empty" style={{ padding: '60px 0' }}>No tree data available.</div>
              ) : (
                <div style={{ width: '100%', maxWidth: '1700px', margin: '0 auto' }}>
                  {renderTreeNodesRecursive(treeNodes)}
                </div>
              )}
            </div>

            <div
              className="modal-f"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 24px',
                borderTop: '1px solid #e2e8f0',
                background: '#ffffff',
              }}
            >
              <div style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>
                💡 Tip: Click branch arrows to toggle sub-components or click &quot;Expand All&quot; to inspect full hierarchy.
              </div>
              <button className="btn btn-p" onClick={() => setTreeModalOpen(false)} style={{ padding: '6px 24px' }}>
                Close Tree View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revision Modal */}
      {revisionModalOpen && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '500px' }}>
            <div className="modal-h">
              <h3>Create New BOM Revision</h3>
            </div>
            <div className="modal-b" style={{ padding: '16px 0' }}>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: 12 }}>
                Creating a new revision will mark current revision active and bump version. Please provide mandatory revision remarks.
              </p>
              <label className="fld">
                <span>Revision Remarks <em className="req">*</em></span>
                <textarea
                  className="in"
                  rows={3}
                  placeholder="Reason for revision..."
                  value={revisionRemarks}
                  onChange={(e) => setRevisionRemarks(e.target.value)}
                />
              </label>
            </div>
            <div className="modal-f" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setRevisionModalOpen(false)} disabled={revisionSubmitting}>
                Cancel
              </button>
              <button className="btn btn-p" onClick={handleCreateRevisionSubmit} disabled={revisionSubmitting}>
                {revisionSubmitting ? 'Creating...' : 'Confirm Revision'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit History Drawer */}
      {historyDrawerOpen && activeBomId && (
        <AuditHistoryDrawer
          open={historyDrawerOpen}
          onClose={() => setHistoryDrawerOpen(false)}
          entityType="production-bom"
          entityId={String(activeBomId)}
        />
      )}
    </div>
  );
}