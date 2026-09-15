import React, { useEffect, useState, useCallback, useMemo } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import StatusBadge from '../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';
import AuditHistoryDrawer from '../../../components/common/AuditHistoryDrawer';
import SearchableItemLookup from '../../../components/common/SearchableItemLookup';
import BomMappingEditor from './BomMappingEditor';
import type { BomMappingDoc } from './BomMappingEditor';
import { TreeRow, type TNode } from './BomMappingEditor';
import { filterPurchaseRelevantItems } from '../../../utils/itemClassification';

/* ── Types ── */

export interface BomLine {
  id?: number;
  lineNo: number;
  componentItemCode: string;
  componentRevision: string;
  description: string;
  quantityPer: number;
  uom: string;
  componentType: string;
  weightPerQty: number;
  totalWeight: number;
  bomLevel: string;
  warehouse: string;
  scrapPercentage: number;
  childBomId: number | null;
  operationSequenceLink: number | null;
  issueMethod: string;
  supplyType: string;
  isPhantom: boolean;
  isActive: boolean;
  remarks: string;
}

export interface BomDoc {
  id: number;
  docNo: string;
  bomNumber: string;
  bomVersion: string;
  itemCode: string;
  itemRevision: string;
  description: string;
  itemType: string;
  bomType: string;
  baseQuantity: number;
  baseUom: string;
  weight: number;
  totalMaterialCost: number;
  specifications: string;
  salesOrderId: number | null;
  effectiveFrom: string;
  effectiveTo: string;
  approvedBy: string;
  releaseDate: string;
  obsoleteDate: string;
  parentBomId: number | null;
  previousRevisionId: number | null;
  revisionNo: number;
  status: string;
  isActive: boolean;
  active: boolean;
  remarks: string;
  lines: BomLine[];
}

interface ItemOption {
  id: number;
  code: string;
  name: string;
  weight: number;
  uom: string;
  itemType: string;
  itemGroup?: string;
  itemGroupName?: string;
  itemGroupType?: string;
  groupItemType?: string;
  bomCategory?: string;
  groupType?: string;
  category?: string;
  active: boolean;
}

interface SoOption {
  id: number;
  orderNo: string;
  customerName: string;
  status: string;
}

interface TreeNode {
  id?: number;
  bomNumber?: string;
  itemCode: string;
  itemType?: string;
  lineNo?: number;
  componentItemCode?: string;
  componentRevision?: string;
  description?: string;
  quantityPer: number;
  weightPerQty?: number;
  totalWeight?: number;
  remarks?: string;
  level: number;
  levelPath: string;
  children?: TreeNode[];
}

interface BomRevision {
  id: number;
  revisionNo: number;
  bomVersion: string;
  createdAt: string;
  createdBy: string;
  remarks: string;
}

/* ── Constants ── */

const ITEM_TYPES = ['FG', 'SEMI_FG'];
const BOM_TYPES = ['Primary', 'Alternate'];

const emptyBom = (): Omit<BomDoc, 'id'> => ({
  docNo: '', bomNumber: '', bomVersion: '1.0', itemCode: '', itemRevision: '',
  description: '', itemType: 'FG', bomType: 'Primary',
  baseQuantity: 1, baseUom: 'PCS', weight: 0, totalMaterialCost: 0,
  specifications: '', salesOrderId: null,
  effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '',
  approvedBy: '', releaseDate: '', obsoleteDate: '',
  parentBomId: null, previousRevisionId: null, revisionNo: 0,
  status: 'DRAFT', isActive: true, active: true, remarks: '', lines: [],
});

const emptyLine = (n: number): BomLine => ({
  lineNo: n, componentItemCode: '', componentRevision: '', description: '',
  quantityPer: 1, uom: 'PCS', componentType: 'RAW_MATERIAL',
  weightPerQty: 0, totalWeight: 0, bomLevel: '1',
  warehouse: '', scrapPercentage: 0, childBomId: null,
  operationSequenceLink: null, issueMethod: 'Manual', supplyType: 'Make',
  isPhantom: false, isActive: true, remarks: '',
});

/* ── Component ── */

export default function BomMasterScreen() {
  const { toast } = useToast();

  // List state
  const [allBoms, setAllBoms] = useState<BomDoc[]>([]);

  // Form state
  const [bom, setBom] = useState(emptyBom());
  const [editId, setEditId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewMode, setViewMode] = useState<'LIST' | 'FORM' | 'MAPPING_EDITOR'>('LIST');
  const [formTab, setFormTab] = useState<'details' | 'where-used' | 'version-compare' | 'revisions'>('details');

  // Lookup data
  const [items, setItems] = useState<ItemOption[]>([]);
  const [itemGroups, setItemGroups] = useState<Array<{ id: number; code: string; name: string; itemType?: string }>>([]);
  const [salesOrders, setSalesOrders] = useState<SoOption[]>([]);

  // Copy BOM
  const [copyBomId, setCopyBomId] = useState('');

  // Where-used & version compare
  const [whereUsedRows, setWhereUsedRows] = useState<Array<{ type: string; reference: string; itemCode: string; status: string; quantity: number }>>([]);
  const [whereUsedLoading, setWhereUsedLoading] = useState(false);
  const [versionRows, setVersionRows] = useState<Array<{ currentVersion: string; previousVersion: string; componentCount: number; changed: boolean }>>([]);
  const [versionLoading, setVersionLoading] = useState(false);

  // Revision history
  const [revisionRows, setRevisionRows] = useState<BomRevision[]>([]);
  const [revisionLoading, setRevisionLoading] = useState(false);

  // Tree view
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeData, setTreeData] = useState<TreeNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // BOM Mapping tree view (list)
  const [bmTreeOpen, setBmTreeOpen] = useState(false);
  const [bmTreeLoading, setBmTreeLoading] = useState(false);
  const [bmTreeMeta, setBmTreeMeta] = useState<{ code: string; name: string }>({ code: '', name: '' });
  const [bmTreeRoots, setBmTreeRoots] = useState<TNode[]>([]);

  // Next BOM number
  const [nextBomNumber, setNextBomNumber] = useState('');

  // Modals
  const [deleteTarget, setDeleteTarget] = useState<BomDoc | null>(null);
  const [reviseModal, setReviseModal] = useState(false);
  const [reviseRemarks, setReviseRemarks] = useState('');
  const [auditOpen, setAuditOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ action: string; danger: boolean; body: string } | null>(null);
  const [bmDocs, setBmDocs] = useState<Array<{ id: number; bmId: number; code: string; name: string; fgCount: number; semiFgCount: number; rmCount: number; multiLevelCount: number; active: boolean }>>([]);
  const [bmLoading, setBmLoading] = useState(false);
  const [bmDelTarget, setBmDelTarget] = useState<{ bmId: number; fgItemCode: string } | null>(null);
  const [bmEditor, setBmEditor] = useState<{ mapping: BomMappingDoc | null; mode: 'new' | 'view' | 'edit' }>({ mapping: null, mode: 'new' });

  /* ── Loaders ── */

  const loadBoms = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/v1/planning/production-bom', { params: { size: 500, page: 0 } });
      const list = data.content ?? data ?? [];
      setAllBoms(list);
    } catch (e) { toast(getApiErrorMessage(e, 'Load failed.'), 'error'); }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const [itemsRes, groupRes] = await Promise.all([
        apiClient.get('/master/items', { params: { size: 500, page: 0 } }),
        apiClient.get('/master/item-groups').catch(() => ({ data: [] })),
      ]);
      const rawList = itemsRes.data.content ?? itemsRes.data ?? [];
      const list = rawList.map((i: Record<string, unknown>) => ({
        id: i.id as number, code: i.code as string, name: (i.name as string) || (i.description as string) || '',
        weight: (i.weight as number) || 0, uom: (i.uom as string) || 'PCS',
        itemType: (i.itemType as string) || (i.groupType as string) || '',
        itemGroup: (i.itemGroup as string) || (i.groupName as string) || '',
        itemGroupName: (i.itemGroupName as string) || '',
        itemGroupType: (i.itemGroupType as string) || '',
        groupItemType: (i.groupItemType as string) || '',
        bomCategory: (i.bomCategory as string) || '',
        category: (i.category as string) || '',
        groupType: (i.groupType as string) || '',
        active: i.active !== false,
      }));
      setItems(filterPurchaseRelevantItems(list));
      const rawGroups = groupRes.data?.content ?? groupRes.data ?? [];
      setItemGroups(rawGroups);
    } catch { /* silent */ }
  }, []);

  const loadSalesOrders = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/v1/sales/sales-order', { params: { size: 500 } });
      const list = (data.content ?? data ?? []).map((s: Record<string, unknown>) => ({
        id: s.id as number, orderNo: (s.orderNo ?? s.docNo ?? '') as string,
        customerName: (s.customerName ?? s.customerCode ?? '') as string, status: (s.status ?? '') as string,
      }));
      setSalesOrders(list);
    } catch { /* silent */ }
  }, []);

  const loadNextNumber = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/v1/planning/production-bom/next-number');
      setNextBomNumber(data.nextNumber || '');
    } catch { /* silent */ }
  }, []);

  const loadBmDocs = useCallback(async () => {
    setBmLoading(true);
    try {
      const { data } = await apiClient.get('/master/bom-mappings');
      setBmDocs(Array.isArray(data) ? data : (data?.content ?? []));
    } catch (e) { toast(getApiErrorMessage(e, 'Load BOM Mappings failed.'), 'error'); }
    setBmLoading(false);
  }, []);

  useEffect(() => { loadBoms(); loadItems(); loadSalesOrders(); loadNextNumber(); loadBmDocs(); }, [loadBoms, loadItems, loadSalesOrders, loadNextNumber, loadBmDocs]);

  useEffect(() => {
    const refresh = () => loadBmDocs();
    window.addEventListener('bomMappingsChanged', refresh);
    return () => window.removeEventListener('bomMappingsChanged', refresh);
  }, [loadBmDocs]);

  /* ── Derived ── */

  const groupMap = useMemo(() => {
    const map = new Map<string, any>();
    itemGroups.forEach((g) => {
      if (g.code) map.set(g.code.toUpperCase(), g);
    });
    return map;
  }, [itemGroups]);

  const matchesType = useCallback((i: ItemOption, targetType: string) => {
    const t = (i.itemType || '').toUpperCase();
    const gCode = (i.itemGroup || '').toUpperCase();
    const igObj = gCode ? groupMap.get(gCode) : null;
    const igName = (igObj?.name || i.itemGroupName || '').toUpperCase();
    const igType = (igObj?.itemType || i.itemGroupType || i.groupItemType || '').toUpperCase();
    const cat = (i.category || i.bomCategory || '').toUpperCase();
    const gt = (i.groupType || '').toUpperCase();

    const isSemiFg = (
      t === 'SEMI_FG' || t === 'SFG' || t.includes('SEMI') ||
      gCode === 'SEMI_FG' || gCode === 'SFG' || gCode.includes('SEMI') ||
      igName.includes('SEMI') || igName.includes('SFG') ||
      igType === 'SEMI_FG' || igType === 'SFG' || igType.includes('SEMI') ||
      cat === 'SEMI_FG' || cat === 'SFG' || cat.includes('SEMI') ||
      gt === 'SEMI_FG' || gt === 'SFG' || gt.includes('SEMI')
    );

    const isFg = !isSemiFg && (
      t === 'FG' || t === 'FINISHED' || t === 'FINISHED_GOODS' || (t.includes('FINISHED') && !t.includes('SEMI')) ||
      gCode === 'FG' || (gCode.includes('FINISHED') && !gCode.includes('SEMI')) ||
      (igName.includes('FINISHED') && !igName.includes('SEMI')) ||
      igType === 'FG' || (igType.includes('FINISHED') && !igType.includes('SEMI')) ||
      cat === 'FG' || (cat.includes('FINISHED') && !cat.includes('SEMI')) ||
      gt === 'FG' || (gt.includes('FINISHED') && !gt.includes('SEMI'))
    );

    if (targetType === 'FG') {
      return isFg;
    }
    if (targetType === 'SEMI_FG') {
      return isSemiFg;
    }
    return true;
  }, [groupMap]);

  const filteredItems = useMemo(() => {
    if (!bom.itemType) return items;
    return items.filter((i) => matchesType(i, bom.itemType));
  }, [items, bom.itemType, matchesType]);

  const computedWeight = useMemo(() => {
    return bom.lines.filter((l) => !l.isActive || true).reduce((sum, l) => sum + (l.totalWeight || 0), 0);
  }, [bom.lines]);

  /* ── Field setters ── */

  const setField = (k: string, v: unknown) => setBom((p) => ({ ...p, [k]: v }));

  const setLine = (idx: number, k: string, v: unknown) => setBom((p) => {
    const lines = [...p.lines];
    lines[idx] = { ...lines[idx], [k]: v };
    return { ...p, lines };
  });

  const addLine = () => {
    const n = bom.lines.length + 1;
    const parentLevel = '1';
    const qty = bom.baseQuantity || 1;
    setBom((p) => ({ ...p, lines: [...p.lines, { ...emptyLine(n), bomLevel: parentLevel, quantityPer: qty }] }));
  };

  const insertLineAt = (atIdx: number) => {
    const qty = bom.baseQuantity || 1;
    setBom((p) => {
      const lines = [...p.lines];
      lines.splice(atIdx, 0, { ...emptyLine(atIdx + 1), bomLevel: '1', quantityPer: qty });
      return { ...p, lines: lines.map((l, i) => ({ ...l, lineNo: i + 1 })) };
    });
  };

  const removeLine = (idx: number) => setBom((p) => ({
    ...p,
    lines: p.lines.filter((_, i) => i !== idx).map((l, i) => ({ ...l, lineNo: i + 1 })),
  }));

  /* ── Item selection on component line ── */

  const onComponentItemSelect = (idx: number, itemCode: string) => {
    const item = items.find((i) => i.code === itemCode);
    setBom((p) => {
      const lines = [...p.lines];
      lines[idx] = {
        ...lines[idx],
        componentItemCode: itemCode,
        description: item?.name ?? '',
        quantityPer: lines[idx].quantityPer || bom.baseQuantity || 1,
        weightPerQty: item?.weight ?? 0,
        uom: item?.uom || 'PCS',
        componentType: item?.itemType === 'FG' ? 'FINISHED_GOOD' : item?.itemType === 'SEMI_FG' ? 'SEMI_FG' : 'RAW_MATERIAL',
        totalWeight: (item?.weight ?? 0) * (lines[idx].quantityPer || bom.baseQuantity || 1),
      };
      const totalWt = lines.reduce((s, l) => s + (l.totalWeight || 0), 0);
      return { ...p, lines, weight: totalWt };
    });
  };

  const onComponentQtyChange = (idx: number, qty: number) => {
    setBom((p) => {
      const lines = [...p.lines];
      lines[idx] = { ...lines[idx], quantityPer: qty, totalWeight: qty * (lines[idx].weightPerQty || 0) };
      const totalWt = lines.reduce((s, l) => s + (l.totalWeight || 0), 0);
      return { ...p, lines, weight: totalWt };
    });
  };

  /* ── Save ── */

  const save = async () => {
    if (!bom.itemCode.trim()) { toast('BOM Item is mandatory.', 'error'); return; }
    if (!bom.itemType) { toast('Item Type is mandatory.', 'error'); return; }
    if (bom.baseQuantity <= 0) { toast('Quantity should be greater than zero.', 'error'); return; }
    const activeLines = bom.lines.filter((l) => l.componentItemCode.trim());
    if (activeLines.length === 0) { toast('At least one component is required.', 'error'); return; }
    // Check duplicate components
    const codes = new Set<string>();
    for (const l of activeLines) {
      const code = l.componentItemCode.trim();
      if (codes.has(code)) { toast(`Duplicate component item is not allowed: ${code}`, 'error'); return; }
      codes.add(code);
    }
    // Check qty > 0
    for (const l of activeLines) {
      if (l.quantityPer <= 0) { toast(`Component quantity must be greater than zero: ${l.componentItemCode}`, 'error'); return; }
    }

    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        itemCode: bom.itemCode, itemRevision: bom.itemRevision, bomVersion: bom.bomVersion,
        description: bom.description, itemType: bom.itemType, bomType: bom.bomType,
        baseQuantity: bom.baseQuantity, baseUom: bom.baseUom,
        weight: computedWeight, specifications: bom.specifications,
        salesOrderId: bom.salesOrderId || null,
        effectiveFrom: bom.effectiveFrom, effectiveTo: bom.effectiveTo || null,
        remarks: bom.remarks,
        lines: activeLines.map((l, i) => ({
          lineNo: i + 1, componentItemCode: l.componentItemCode,
          componentRevision: l.componentRevision, description: l.description,
          quantityPer: l.quantityPer, uom: l.uom, componentType: l.componentType,
          weightPerQty: l.weightPerQty, totalWeight: l.totalWeight,
          bomLevel: l.bomLevel, warehouse: l.warehouse,
          scrapPercentage: l.scrapPercentage, childBomId: l.childBomId,
          issueMethod: l.issueMethod, supplyType: l.supplyType,
          isPhantom: l.isPhantom, isActive: true, remarks: l.remarks,
        })),
      };
      if (editId) {
        const { data } = await apiClient.put(`/v1/planning/production-bom/${editId}`, payload);
        setBom({ ...data, lines: data.lines ?? [] });
        toast('BOM updated.');
      } else {
        const { data } = await apiClient.post('/v1/planning/production-bom', payload);
        setEditId(data.id);
        setBom({ ...data, lines: data.lines ?? [] });
        toast('BOM created. BOM Code: ' + (data.bomNumber || data.docNo));
      }
      loadBoms();
      loadNextNumber();
    } catch (e) { toast(getApiErrorMessage(e, 'Save failed.'), 'error'); }
    setBusy(false);
  };

  /* ── Workflow actions ── */

  const runAction = async (action: string, note = '') => {
    if (!editId) return;
    setBusy(true);
    try {
      const body = note ? { note } : {};
      const { data } = await apiClient.post(`/v1/planning/production-bom/${editId}/actions/${action}`, body);
      setBom({ ...data, lines: data.lines ?? [] });
      toast(`BOM ${action}d.`);
      setConfirmAction(null);
      loadBoms();
    } catch (e) { toast(getApiErrorMessage(e, `${action} failed.`), 'error'); }
    setBusy(false);
  };

  /* ── BOM Revision ── */

  const createRevision = async () => {
    if (!editId) return;
    if (!reviseRemarks.trim()) { toast('Remarks are mandatory for a new revision.', 'error'); return; }
    setBusy(true);
    try {
      const { data } = await apiClient.post(`/v1/planning/production-bom/${editId}/revise`, {
        newVersion: String(Number(bom.bomVersion) + 1),
        remarks: reviseRemarks,
      });
      setEditId(data.id);
      setBom({ ...data, lines: data.lines ?? [] });
      setReviseModal(false);
      setReviseRemarks('');
      toast('New revision created. New BOM Code: ' + (data.bomNumber || data.docNo));
      loadBoms();
    } catch (e) { toast(getApiErrorMessage(e, 'Revision failed.'), 'error'); }
    setBusy(false);
  };

  /* ── Copy BOM ── */

  const copyBom = async (id?: string) => {
    const bomId = id || copyBomId;
    if (!bomId) return;
    setBusy(true);
    try {
      const source = allBoms.find((b) => String(b.id) === bomId);
      if (!source) { toast('Source BOM not found.', 'error'); setBusy(false); return; }
      const { data } = await apiClient.get(`/v1/planning/production-bom/${source.id}`);
      setBom((p) => ({
        ...p,
        itemCode: data.itemCode || p.itemCode,
        lines: (data.lines || []).map((l: BomLine, i: number) => ({ ...l, lineNo: i + 1 })),
      }));
      setCopyBomId('');
      toast(`Copied ${data.lines?.length || 0} components from ${data.bomNumber || data.itemCode}.`);
    } catch (e) { toast(getApiErrorMessage(e, 'Copy failed.'), 'error'); }
    setBusy(false);
  };

  /* ── Delete ── */

  const del = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiClient.delete(`/v1/planning/production-bom/${deleteTarget.id}`);
      toast('BOM deleted.');
      setDeleteTarget(null);
      loadBoms();
    } catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  /* ── Where-Used ── */

  const fetchWhereUsed = async (id: number) => {
    setWhereUsedLoading(true);
    try {
      const { data } = await apiClient.get(`/v1/planning/production-bom/${id}/where-used`);
      setWhereUsedRows(Array.isArray(data) ? data : data.content ?? []);
    } catch { setWhereUsedRows([]); }
    setWhereUsedLoading(false);
  };

  /* ── Version Compare ── */

  const fetchVersionCompare = async (id: number) => {
    setVersionLoading(true);
    try {
      const { data } = await apiClient.get(`/v1/planning/production-bom/${id}/version-compare`);
      setVersionRows(Array.isArray(data) ? data : data.content ?? []);
    } catch { setVersionRows([]); }
    setVersionLoading(false);
  };

  /* ── Revision History ── */

  const fetchRevisions = async (id: number) => {
    setRevisionLoading(true);
    try {
      const { data } = await apiClient.get(`/v1/planning/production-bom/${id}/revisions`);
      setRevisionRows(Array.isArray(data) ? data : []);
    } catch { setRevisionRows([]); }
    setRevisionLoading(false);
  };

  /* ── Tree View ── */

  const fetchTree = async (_id?: number) => {
    setTreeLoading(true);
    setTreeOpen(true);
    try {
      // Build tree client-side from flat BOM lines
      const itemMap = new Map(items.map((i) => [i.code, i]));
      const activeLines = bom.lines.filter((l) => l.componentItemCode);
      // First line is the BOM Item itself — use its data for root
      const firstLine = activeLines.length > 0 ? activeLines[0] : null;
      const rootItem = itemMap.get(bom.itemCode || '');
      const root: TreeNode = {
        itemCode: bom.itemCode || '',
        description: rootItem?.name || firstLine?.description || '',
        quantityPer: firstLine?.quantityPer || bom.baseQuantity || 1,
        weightPerQty: firstLine?.weightPerQty || rootItem?.weight || 0,
        totalWeight: firstLine?.totalWeight || bom.weight || 0,
        remarks: firstLine?.remarks || '',
        level: 1,
        levelPath: '1',
        children: [],
      };

      let seq = 1;
      let lastSemiFg: TreeNode | null = null;

      // Start from line 1 (skip first which is the root item itself)
      const childLines = activeLines.slice(1);

      for (const line of childLines) {
        const item = itemMap.get(line.componentItemCode);
        const level = line.bomLevel || item?.itemType || 'RAW_MATERIAL';

        if (level === 'SEMI_FG' || level === 'SFG') {
          const node: TreeNode = {
            itemCode: line.componentItemCode,
            componentItemCode: line.componentItemCode,
            description: item?.name || line.description || '',
            quantityPer: line.quantityPer,
            weightPerQty: line.weightPerQty || item?.weight || 0,
            totalWeight: line.totalWeight || 0,
            remarks: line.remarks || '',
            level: 2,
            levelPath: `${root.levelPath}.${seq}`,
            children: [],
          };
          root.children!.push(node);
          lastSemiFg = node;
          seq++;
        } else if (level === 'FG') {
          const node: TreeNode = {
            itemCode: line.componentItemCode,
            componentItemCode: line.componentItemCode,
            description: item?.name || line.description || '',
            quantityPer: line.quantityPer,
            weightPerQty: line.weightPerQty || item?.weight || 0,
            totalWeight: line.totalWeight || 0,
            remarks: line.remarks || '',
            level: 2,
            levelPath: `${root.levelPath}.${seq}`,
            children: [],
          };
          root.children!.push(node);
          lastSemiFg = null;
          seq++;
        } else {
          // RAW_MATERIAL — child of last Semi-FG or direct child of root
          if (lastSemiFg && lastSemiFg.children) {
            const childSeq = lastSemiFg.children.length + 1;
            lastSemiFg.children.push({
              itemCode: line.componentItemCode,
              componentItemCode: line.componentItemCode,
              description: item?.name || line.description || '',
              quantityPer: line.quantityPer,
              weightPerQty: line.weightPerQty || item?.weight || 0,
              totalWeight: line.totalWeight || 0,
              remarks: line.remarks || '',
              level: 3,
              levelPath: `${lastSemiFg.levelPath}.${childSeq}`,
            });
          } else {
            const node: TreeNode = {
              itemCode: line.componentItemCode,
              componentItemCode: line.componentItemCode,
              description: item?.name || line.description || '',
              quantityPer: line.quantityPer,
              weightPerQty: line.weightPerQty || item?.weight || 0,
              totalWeight: line.totalWeight || 0,
              remarks: line.remarks || '',
              level: 2,
              levelPath: `${root.levelPath}.${seq}`,
              children: [],
            };
            root.children!.push(node);
            seq++;
          }
        }
      }

      // Fix levelPaths after building
      root.children?.forEach((child, i) => {
        child.levelPath = `${root.levelPath}.${i + 1}`;
        child.children?.forEach((grandchild, j) => {
          grandchild.levelPath = `${child.levelPath}.${j + 1}`;
        });
      });

      setTreeData(root);
      // Expand all levels by default
      const expanded = new Set<string>();
      const expandAll = (node: TreeNode) => {
        if (node.children && node.children.length > 0) {
          expanded.add(node.levelPath);
          for (const child of node.children) expandAll(child);
        }
      };
      expandAll(root);
      setExpandedNodes(expanded);
    } catch { toast('Failed to load BOM tree.', 'error'); }
    setTreeLoading(false);
  };

  const toggleNode = (path: string) => setExpandedNodes((prev) => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  /* ── Navigation ── */

  const openFormTab = (tab: typeof formTab) => {
    setFormTab(tab);
    if (!editId) return;
    if (tab === 'where-used') fetchWhereUsed(editId);
    if (tab === 'version-compare') fetchVersionCompare(editId);
    if (tab === 'revisions') fetchRevisions(editId);
  };

  /* ── BOM Mapping actions (list) ── */

  const openMappingEditor = async (r?: { id: number; bmId: number }, mode: 'new' | 'view' | 'edit' = 'new') => {
    if (r && mode !== 'new') {
      setBusy(true);
      try {
        const { data } = await apiClient.get(`/master/bom-mappings/editor/${r.bmId}`);
        setBmEditor({ mapping: data as BomMappingDoc, mode });
      } catch (e) {
        setBusy(false);
        toast(getApiErrorMessage(e, 'Load mapping failed.'), 'error');
        return;
      }
      setBusy(false);
    } else {
      setBmEditor({ mapping: null, mode: 'new' });
    }
    setViewMode('MAPPING_EDITOR');
  };

  const delBmRow = async () => {
    const t = bmDelTarget;
    if (!t) return;
    setBusy(true);
    try {
      await apiClient.delete(`/master/bom-mappings/${t.bmId}`);
      toast('BOM Mapping deleted.');
      setBmDelTarget(null);
      loadBmDocs();
    } catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  /* ── BOM Mapping tree view (read-only) ── */

  const buildMappingTree = (d: BomMappingDoc): TNode[] => d.fgMappings.map((f, i) => ({
    id: f.autoCode,
    label: f.name,
    code: f.fgItemCode,
    type: 'FG',
    path: String(i + 1),
    children: f.semis.map((s, j) => {
      const sfm = d.semiFgs.find((x) => x.autoCode === s.autoCode);
      return {
        id: s.autoCode,
        label: sfm?.name ?? s.name,
        code: sfm?.semiFgItemCode,
        type: 'SFG',
        path: `${i + 1}.${j + 1}`,
        children: (sfm?.rms ?? []).map((r, k) => ({
          id: r.code, label: r.name, code: r.code, type: 'RM', path: `${i + 1}.${j + 1}.${k + 1}`, children: [],
        })),
      };
    }),
  }));

  const openBmTree = async (m: { bmId: number; code: string; name: string }) => {
    setBmTreeMeta({ code: m.code, name: m.name });
    setBmTreeOpen(true);
    setBmTreeLoading(true);
    try {
      const { data } = await apiClient.get(`/master/bom-mappings/editor/${m.bmId}`);
      const roots = buildMappingTree(data as BomMappingDoc);
      setBmTreeRoots(roots);
      const expanded = new Set<string>();
      const expandAll = (n: TNode) => { if (n.children.length > 0) { expanded.add(n.path); n.children.forEach(expandAll); } };
      roots.forEach(expandAll);
      setExpandedNodes(expanded);
    } catch (e) {
      setBmTreeOpen(false);
      toast(getApiErrorMessage(e, 'Failed to load BOM tree.'), 'error');
    }
    setBmTreeLoading(false);
  };

  /* ── List View ── */

  if (viewMode === 'MAPPING_EDITOR') {
    return (
      <BomMappingEditor
        onBack={() => setViewMode('LIST')}
        mode={bmEditor.mode}
        mapping={bmEditor.mapping}
        onSaveSuccess={() => loadBmDocs()}
      />
    );
  }

  if (viewMode === 'LIST') {
    return (
      <>
        <div className="pg-head pg-head-flex" style={{ marginBottom: '20px' }}>
          <div className="pg-head-text" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div>
              <h1>Bill of Material (BOM)</h1>
              <p>Multi-level BOM with components, quantities, and structure</p>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            <span style={{ fontSize: '0.85em', color: '#6b7280' }}>{bmDocs.length} BOM Mappings</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn" onClick={loadBmDocs} title="Refresh"><span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>refresh</span></button>
              <button className="btn btn-primary" onClick={() => openMappingEditor()}><span className="material-symbols-rounded">alt_route</span> New BOM Mapping</button>
            </div>
          </div>
          <div className="twrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="num">S.No</th>
                  <th>BOM Mapping Code</th>
                  <th>BOM Mapping Name</th>
                  <th style={{ textAlign: 'center' }}>FG</th>
                  <th style={{ textAlign: 'center' }}>Semi FG</th>
                  <th style={{ textAlign: 'center' }}>RM</th>
                  <th style={{ textAlign: 'center' }}>Multi Level</th>
                  <th style={{ textAlign: 'center' }}>Status</th>
                  <th style={{ textAlign: 'center' }}>Tree</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bmLoading ? (
                  <tr><td colSpan={10} className="empty">Loading...</td></tr>
                ) : bmDocs.length === 0 ? (
                  <tr><td colSpan={10} className="empty">No BOM Mappings yet.</td></tr>
                ) : bmDocs.map((m, idx) => (
                  <tr key={m.id}>
                    <td className="num mut">{idx + 1}</td>
                    <td style={{ fontWeight: 700 }}>{m.code}</td>
                    <td>{m.name || '\u2014'}</td>
                    <td style={{ textAlign: 'center' }}><span style={{ fontWeight: 700, color: '#6d28d9' }}>{m.fgCount ?? 0} FG</span></td>
                    <td style={{ textAlign: 'center' }}><span style={{ fontWeight: 700, color: '#166534' }}>{m.semiFgCount ?? 0} SEMI-FG</span></td>
                    <td style={{ textAlign: 'center' }}><span style={{ fontWeight: 700, color: '#b45309' }}>{m.rmCount ?? 0} RM</span></td>
                    <td style={{ textAlign: 'center' }}><span style={{ fontWeight: 700, color: '#0e7490' }}>{m.multiLevelCount ?? 0} MBM</span></td>
                    <td style={{ textAlign: 'center' }}><StatusBadge status={m.active ? 'ACTIVE' : 'INACTIVE'} /></td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="ibtn" title="Tree View" onClick={() => openBmTree(m)}>
                        <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>account_tree</span>
                      </button>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button className="ibtn" title="View" onClick={() => openMappingEditor(m, 'view')}><span className="material-symbols-rounded" style={{ fontSize: '18px' }}>visibility</span></button>
                        <button className="ibtn" title="Edit" onClick={() => openMappingEditor(m, 'edit')}><span className="material-symbols-rounded" style={{ fontSize: '18px' }}>edit</span></button>
                        <button className="ibtn danger" title="Delete" onClick={() => setBmDelTarget({ bmId: m.bmId, fgItemCode: m.name || m.code })}><span className="material-symbols-rounded" style={{ fontSize: '18px' }}>delete</span></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {bmDelTarget && (
          <ConfirmActionModal open title="Delete BOM Mapping" body={`Delete mapping for ${bmDelTarget.fgItemCode}? Its FG, Semi-FG, RM and Multi-Level BOM lines will be deleted too.`} okLabel="Delete" danger busy={busy} onClose={() => setBmDelTarget(null)} onConfirm={delBmRow} />
        )}

        {bmTreeOpen && (
          <div className="mwrap" onClick={() => setBmTreeOpen(false)} style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(6px)' }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              width: 720, maxWidth: '94vw', background: '#ffffff', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              border: '1px solid #e2e8f0', padding: 24, maxHeight: '85vh', overflow: 'auto', display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="material-symbols-rounded" style={{ color: '#6366f1', fontSize: '1.4rem' }}>account_tree</span>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#1e293b' }}>Bill Of Material (BOM) Structure</h2>
                    <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.8rem', marginTop: 2 }}>{bmTreeMeta.code} — {bmTreeMeta.name || 'Unnamed mapping'}</p>
                  </div>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => setBmTreeOpen(false)}>
                  <span className="material-symbols-rounded">close</span>
                </button>
              </div>
              <div style={{ display: 'flex', gap: 24, padding: '10px 14px', background: '#f1f5f9', borderRadius: 8, marginBottom: 16, fontSize: '0.78rem', color: '#64748b' }}>
                <span><strong style={{ color: '#3b82f6' }}>{bmTreeRoots.length}</strong> FG</span>
                <span><strong style={{ color: '#3b82f6' }}>{new Set(bmTreeRoots.flatMap((f) => f.children.map((c) => c.id))).size}</strong> Semi-FG</span>
                <span><strong style={{ color: '#f59e0b' }}>{new Set(bmTreeRoots.flatMap((f) => f.children.flatMap((c) => c.children.map((g) => g.id)))).size}</strong> Raw Material</span>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {bmTreeLoading ? (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>Loading tree...</div>
                ) : bmTreeRoots.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: '#94a3b8' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '3rem', marginBottom: 8 }}>account_tree</span> No tree data.
                  </div>
                ) : (
                  <div style={{ maxWidth: 680, margin: '0 auto' }}>
                    {bmTreeRoots.map((n) => (
                      <TreeRow key={n.id} node={n} expanded={expandedNodes} toggle={toggleNode} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  /* ── Form View ── */

  const isEditable = bom.status === 'DRAFT' || bom.status === 'REJECTED';
  const canRevise = editId && (bom.status === 'APPROVED') && bom.isActive;
  const docNo = editId ? (bom.bomNumber || bom.docNo || '\u2014') : '\u2014';

  return (
    <>
      <div className="pg-head">
        <div>
          <h1>{editId ? 'Edit' : 'New'} Bill of Material (BOM) \u2014 {docNo}</h1>
          <p>{editId ? `Status: ${bom.status} | Version: ${bom.bomVersion} | Rev: ${bom.revisionNo}` : 'Create a new Bill of Material'}</p>
        </div>
      </div>

      {editId && (
        <div className="panel-h" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`btn btn-sm ${formTab === 'details' ? 'btn-p' : ''}`} onClick={() => openFormTab('details')}>Details</button>
            <button type="button" className={`btn btn-sm ${formTab === 'revisions' ? 'btn-p' : ''}`} onClick={() => openFormTab('revisions')}>Revisions</button>
            <button type="button" className={`btn btn-sm ${formTab === 'where-used' ? 'btn-p' : ''}`} onClick={() => openFormTab('where-used')}>Where-Used</button>
            <button type="button" className={`btn btn-sm ${formTab === 'version-compare' ? 'btn-p' : ''}`} onClick={() => openFormTab('version-compare')}>Version Compare</button>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {editId && (bom.status === 'production-bom' || true) && (
              <>
                {isEditable && <button type="button" className="btn btn-sm btn-g" onClick={() => setConfirmAction({ action: 'submit', danger: false, body: 'Submit this BOM for review?' })} disabled={busy}><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>send</span> Submit</button>}
                {bom.status === 'SUBMITTED' && <button type="button" className="btn btn-sm btn-g" onClick={() => setConfirmAction({ action: 'approve', danger: false, body: 'Approve this BOM?' })} disabled={busy}><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>thumb_up</span> Approve</button>}
                {bom.status === 'SUBMITTED' && <button type="button" className="btn btn-sm btn-d" onClick={() => setConfirmAction({ action: 'reject', danger: true, body: 'Reason for rejection:' })} disabled={busy}><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>thumb_down</span> Reject</button>}
                {canRevise && <button type="button" className="btn btn-sm btn-p" onClick={() => setReviseModal(true)} disabled={busy}><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>edit_note</span> Revise</button>}
                {bom.status !== 'DRAFT' && bom.status !== 'CANCELLED' && <button type="button" className="btn btn-sm" onClick={() => setConfirmAction({ action: 'cancel', danger: true, body: 'Cancel this BOM?' })} disabled={busy}><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>block</span> Cancel</button>}
              </>
            )}
            <a href={`/api/v1/planning/production-bom/${editId}/print`} target="_blank" rel="noopener noreferrer" className="btn btn-sm" title="Print PDF"><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>print</span> PDF</a>
            <button type="button" className="btn btn-sm" onClick={() => fetchTree(editId!)} title="View BOM Tree"><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>account_tree</span> Tree</button>
            <button type="button" className="btn btn-sm" title="Audit History" onClick={() => setAuditOpen(true)}><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>history</span></button>
            <StatusBadge status={bom.status} />
          </div>
        </div>
      )}

      <form onSubmit={(e) => e.preventDefault()}>
        {formTab === 'details' && (<>
          {/* ── Header Section ── */}
          <div className="panel">
            <div className="panel-h"><h2><span className="material-symbols-rounded">description</span> BOM Header</h2></div>
            <div className="fgrid">
              <label className="fld"><span>BOM Mapping Code</span>
                <input className="in" value={bom.bomNumber || bom.docNo || nextBomNumber || (editId ? '\u2014' : '\u2014')} readOnly tabIndex={-1} style={{ background: '#f9fafb', fontWeight: 600 }} />
              </label>

              <label className="fld"><span>Sales Order No</span>
                <select className="in" value={bom.salesOrderId ?? ''} onChange={(e) => setField('salesOrderId', e.target.value ? Number(e.target.value) : null)} disabled={!isEditable && !!editId}>
                  <option value="">\u2014 No SO (Standard BOM) \u2014</option>
                  {salesOrders.map((s) => <option key={s.id} value={s.id}>{s.orderNo} {s.customerName ? `(${s.customerName})` : ''}</option>)}
                </select>
              </label>

              <label className="fld"><span>BOM Item *</span>
                <SearchableItemLookup
                  value={bom.itemCode}
                  disabled={!isEditable && !!editId}
                  items={filteredItems.map((i) => ({ id: i.id, code: i.code, name: i.name }))}
                  onChange={(code) => {
                  setField('itemCode', code);
                  // Auto-fill weight and UOM from item master
                  const item = items.find((i) => i.code === code);
                  if (item) {
                    setField('baseUom', item.uom || 'PCS');
                    const itemWt = item.weight || (item as any).netWeight || 0;
                    if (itemWt > 0) setField('weight', itemWt);
                  }
                  // Always show BOM Item as first component row
                  if (code) {
                    const levelMap: Record<string, string> = { FG: 'FG', SEMI_FG: 'SEMI_FG', RAW_MATERIAL: 'RAW_MATERIAL' };
                    const bomLevel = levelMap[item?.itemType || ''] || 'FG';
                    const qty = bom.baseQuantity || 1;
                    const wt = item?.weight || (item as any)?.netWeight || 0;
                    setBom((p) => {
                      const existing = p.lines.filter((l) => l.componentItemCode);
                      const firstRow: BomLine = { ...emptyLine(1), bomLevel, componentItemCode: code, description: item?.name || '', quantityPer: qty, weightPerQty: wt, totalWeight: wt * qty, uom: item?.uom || 'PCS' };
                      const rest = existing.filter((l) => l.componentItemCode !== code).map((l, i) => ({ ...l, lineNo: i + 2 }));
                      return { ...p, lines: [firstRow, ...rest] };
                    });
                  }
                }}
                />
              </label>

              <label className="fld"><span>Item Type *</span>
                <select className="in" value={bom.itemType} onChange={(e) => {
                  const newType = e.target.value;
                  // Clear itemCode if it doesn't match the new type
                  const matchItems = items.filter((i) => matchesType(i, newType));
                  const stillValid = matchItems.some((i) => i.code === bom.itemCode);
                  setField('itemType', newType);
                  if (!stillValid) setField('itemCode', '');
                }} disabled={!isEditable && !!editId}>
                  {ITEM_TYPES.map((t) => <option key={t} value={t}>{t === 'SEMI_FG' ? 'Semi FG' : t}</option>)}
                </select>
              </label>

              <label className="fld"><span>Quantity *</span>
                <input className="in" type="number" min="0.01" step="0.01" value={bom.baseQuantity} onChange={(e) => {
                  const qty = parseFloat(e.target.value) || 1;
                  setField('baseQuantity', qty);
                  // Sync quantity to first component row (BOM Item)
                  setBom((p) => {
                    if (p.lines.length > 0 && p.lines[0].componentItemCode === p.itemCode) {
                      const lines = [...p.lines];
                      lines[0] = { ...lines[0], quantityPer: qty, totalWeight: qty * (lines[0].weightPerQty || 0) };
                      const totalWt = lines.reduce((s, l) => s + (l.totalWeight || 0), 0);
                      return { ...p, lines, weight: totalWt };
                    }
                    return p;
                  });
                }} disabled={!isEditable && !!editId} />
              </label>

              <label className="fld"><span>Weight (auto)</span>
                <input className="in" value={computedWeight > 0 ? computedWeight.toFixed(4) : '0'} readOnly tabIndex={-1} style={{ background: '#f9fafb', fontWeight: 600 }} />
              </label>

              <label className="fld"><span>UOM</span>
                <input className="in" value={bom.baseUom} onChange={(e) => setField('baseUom', e.target.value)} disabled={!isEditable && !!editId} />
              </label>

              <label className="fld" style={{ gridColumn: 'span 2' }}><span>Copy BOM</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select className="in" value={copyBomId} onChange={(e) => { const v = e.target.value; setCopyBomId(v); if (v) copyBom(v); }} style={{ flex: 1 }}>
                    <option value="">\u2014 Select BOM to Copy \u2014</option>
                    {allBoms.filter((b) => b.id !== editId).map((b) => <option key={b.id} value={String(b.id)}>{b.bomNumber || b.docNo} - {b.itemCode} ({b.bomVersion})</option>)}
                  </select>
                </div>
              </label>

              <label className="fld"><span>BOM Type</span>
                <select className="in" value={bom.bomType} onChange={(e) => setField('bomType', e.target.value)} disabled={!isEditable && !!editId}>
                  {BOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>

              <label className="fld" style={{ gridColumn: 'span 2' }}><span>Specifications</span>
                <textarea className="in" rows={2} value={bom.specifications || ''} onChange={(e) => setField('specifications', e.target.value)} disabled={!isEditable && !!editId} />
              </label>

              <label className="fld" style={{ gridColumn: 'span 2' }}><span>Remarks {editId && bom.status !== 'DRAFT' ? '' : ''}</span>
                <textarea className="in" rows={2} value={bom.remarks || ''} onChange={(e) => setField('remarks', e.target.value)} disabled={!editId} />
              </label>
            </div>
          </div>

          {/* ── Component Table ── */}
          <div className="panel">
            <div className="panel-h">
              <h2><span className="material-symbols-rounded">table_view</span> BOM Components ({bom.lines.length})</h2>
              {isEditable && <button type="button" className="btn btn-sm" onClick={addLine} disabled={busy}><span className="material-symbols-rounded">add</span> Add Row</button>}
            </div>
            {bom.lines.length > 0 ? (
              <div className="twrap">
                <table className="tbl lines">
                  <thead>
                    <tr>
                      <th>S.No</th>
                      <th>Level</th>
                      <th>Item Name *</th>
                      <th>Qty *</th>
                      <th>Wt/Unit</th>
                      <th>Total Wt</th>
                      <th>Remarks</th>
                      {isEditable && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {bom.lines.map((line, idx) => (
                      <tr key={idx}>
                        <td>{line.lineNo}</td>
                        <td>
                          <select className="in" value={line.bomLevel || 'FG'} onChange={(e) => setLine(idx, 'bomLevel', e.target.value)} disabled={!isEditable}>
                            <option value="FG">FG</option>
                            <option value="SEMI_FG">Semi FG</option>
                            <option value="RAW_MATERIAL">RM</option>
                          </select>
                        </td>
                        <td>
                          <SearchableItemLookup
                            value={line.componentItemCode}
                            disabled={!isEditable}
                            items={items.map((i) => ({ id: i.id, code: i.code, name: `${i.name}${i.weight ? ` (${i.weight} kg)` : ''}` }))}
                            onChange={(val) => onComponentItemSelect(idx, val)}
                          />
                        </td>
                        <td>
                          <input className="in" type="number" min="0.01" step="0.01" value={line.quantityPer} onChange={(e) => onComponentQtyChange(idx, parseFloat(e.target.value) || 0)} disabled={!isEditable} style={{ width: 80 }} />
                        </td>
                        <td style={{ background: '#f9fafb', fontWeight: 500 }}>{line.weightPerQty > 0 ? line.weightPerQty.toFixed(4) : '\u2014'}</td>
                        <td style={{ background: '#f9fafb', fontWeight: 600 }}>{line.totalWeight > 0 ? line.totalWeight.toFixed(4) : '\u2014'}</td>
                        <td>
                          <input className="in" value={line.remarks || ''} onChange={(e) => setLine(idx, 'remarks', e.target.value)} disabled={!isEditable} style={{ width: 120 }} />
                        </td>
                        {isEditable && (
                          <td style={{ display: 'flex', gap: 4 }}>
                            <button type="button" className="ibtn" onClick={() => insertLineAt(idx + 1)} disabled={busy} title="Insert row below" style={{ fontSize: '0.8rem', padding: '2px 6px' }}>
                              <span className="material-symbols-rounded">add</span>
                            </button>
                            <button type="button" className="ibtn danger" onClick={() => removeLine(idx)} disabled={busy} title="Delete row">
                              <span className="material-symbols-rounded">delete</span>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty" style={{ padding: 20 }}>
                <span className="material-symbols-rounded">playlist_add</span> No components added. Click "Add Row" to start.
              </div>
            )}
          </div>
        </>)}

        {/* ── Revisions Tab ── */}
        {formTab === 'revisions' && (
          <div className="panel">
            <div className="panel-h"><h2><span className="material-symbols-rounded">history</span> Revision History</h2></div>
            {revisionLoading ? <div className="empty" style={{ padding: 16 }}>Loading...</div> : (
              revisionRows.length > 0 ? (
                <div className="twrap">
                  <table className="tbl">
                    <thead><tr><th>Rev #</th><th>Version</th><th>Created At</th><th>Created By</th><th>Remarks</th></tr></thead>
                    <tbody>
                      {revisionRows.map((r) => (
                        <tr key={r.id}>
                          <td>R{r.revisionNo}</td>
                          <td>{r.bomVersion}</td>
                          <td>{r.createdAt}</td>
                          <td>{r.createdBy}</td>
                          <td>{r.remarks || '\u2014'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="empty" style={{ padding: 16 }}>No revision history.</div>
            )}
          </div>
        )}

        {/* ── Where-Used Tab ── */}
        {formTab === 'where-used' && (
          <div className="panel">
            <div className="panel-h"><h2><span className="material-symbols-rounded">search</span> Where-Used</h2></div>
            {whereUsedLoading ? <div className="empty" style={{ padding: 16 }}>Loading...</div> : (
              whereUsedRows.length > 0 ? (
                <div className="twrap">
                  <table className="tbl">
                    <thead><tr><th className="num">S.No</th><th>Type</th><th>Reference</th><th>Item Code</th><th>Status</th><th>Quantity</th></tr></thead>
                    <tbody>
                      {whereUsedRows.map((r, i) => (
                        <tr key={i}><td className="num mut">{i + 1}</td><td>{r.type}</td><td>{r.reference}</td><td>{r.itemCode}</td><td><StatusBadge status={r.status} /></td><td>{r.quantity}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="empty" style={{ padding: 16 }}>No references found.</div>
            )}
          </div>
        )}

        {/* ── Version Compare Tab ── */}
        {formTab === 'version-compare' && (
          <div className="panel">
            <div className="panel-h"><h2><span className="material-symbols-rounded">compare</span> Version Compare</h2></div>
            {versionLoading ? <div className="empty" style={{ padding: 16 }}>Loading...</div> : (
              versionRows.length > 0 ? (
                <div className="twrap">
                  <table className="tbl">
                    <thead><tr><th className="num">S.No</th><th>Current Version</th><th>Previous Version</th><th>Components</th><th>Changed</th></tr></thead>
                    <tbody>
                      {versionRows.map((r, i) => (
                        <tr key={i}><td className="num mut">{i + 1}</td><td>{r.currentVersion}</td><td>{r.previousVersion}</td><td>{r.componentCount}</td><td>{r.changed ? 'Yes' : 'No'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="empty" style={{ padding: 16 }}>No version comparison data.</div>
            )}
          </div>
        )}

        {/* ── Action Bar ── */}
        <div className="panel">
          <div className="actbar">
            <div className="lft">
              <button type="button" className="btn btn-sm" onClick={() => setViewMode('LIST')} disabled={busy}><span className="material-symbols-rounded">arrow_back</span> Back</button>
              <span className="material-symbols-rounded">lock</span>{editId ? 'Audited document' : 'New document'}
            </div>
            <div className="rgt">
              {isEditable && (
                <button type="button" className="btn btn-sm btn-p" onClick={save} disabled={busy}><span className="material-symbols-rounded">save</span> {editId ? 'Update' : 'Create Draft'}</button>
              )}
              {!editId && (
                <button type="button" className="btn btn-sm btn-p" onClick={save} disabled={busy}><span className="material-symbols-rounded">save</span> Create Draft</button>
              )}
            </div>
          </div>
        </div>
      </form>

      {/* ── Delete Modal ── */}
      {deleteTarget && (
        <ConfirmActionModal open title="Delete BOM" body={`Delete ${deleteTarget.bomNumber || deleteTarget.itemCode}? This action cannot be undone.`} okLabel="Delete" danger busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={del} />
      )}

      {/* ── Revise Modal ── */}
      {reviseModal && (
        <div className="modal-overlay" onClick={() => setReviseModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create BOM Revision</h3>
            <p style={{ marginBottom: 12, color: '#6b7280' }}>This will deactivate the current BOM and create a new revision.</p>
            <label className="fld" style={{ marginBottom: 12 }}>
              <span>Remarks (required)</span>
              <textarea className="in" rows={3} value={reviseRemarks} onChange={(e) => setReviseRemarks(e.target.value)} placeholder="Enter reason for revision..." autoFocus />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm" onClick={() => { setReviseModal(false); setReviseRemarks(''); }}>Cancel</button>
              <button className="btn btn-sm btn-p" onClick={createRevision} disabled={busy || !reviseRemarks.trim()}><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>edit_note</span> Create Revision</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Workflow Action Modal ── */}
      {confirmAction && (
        <ConfirmActionModal
          open title={`${confirmAction.action.charAt(0).toUpperCase() + confirmAction.action.slice(1)} BOM`}
          body={confirmAction.body}
          okLabel={confirmAction.action.charAt(0).toUpperCase() + confirmAction.action.slice(1)}
          danger={confirmAction.danger} busy={busy}
          onClose={() => setConfirmAction(null)}
          onConfirm={(note) => { if (confirmAction.action === 'reject') { runAction(confirmAction.action, note); } else { runAction(confirmAction.action, note); } }}
        />
      )}

      {/* ── Tree View Modal ── */}
      {treeOpen && (
        <div className="mwrap" onClick={() => setTreeOpen(false)} style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(6px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            position: 'fixed', inset: 20, background: '#fafbfc', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #e2e8f0',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="material-symbols-rounded" style={{ color: '#6366f1', fontSize: '1.4rem' }}>account_tree</span>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>BOM Structure</h2>
                  <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.78rem', marginTop: 2 }}>{bom.bomNumber || bom.docNo} — {bom.itemCode}</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button type="button" className="btn btn-sm" onClick={() => setExpandedNodes(new Set())} style={{ fontSize: '0.75rem' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>unfold_less</span> Collapse
                </button>
                <button type="button" className="btn btn-sm" onClick={() => {
                  const all = new Set<string>();
                  const collect = (n: TreeNode) => { if (n.children?.length) { all.add(n.levelPath); n.children.forEach(collect); } };
                  if (treeData) collect(treeData);
                  setExpandedNodes(all);
                }} style={{ fontSize: '0.75rem' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>unfold_more</span> Expand
                </button>
                <button className="btn btn-sm" onClick={() => setTreeOpen(false)} style={{ marginLeft: 4 }}>
                  <span className="material-symbols-rounded">close</span>
                </button>
              </div>
            </div>

            {/* Summary bar */}
            {treeData && (
              <div style={{ display: 'flex', gap: 24, padding: '10px 24px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', fontSize: '0.78rem', color: '#64748b' }}>
                <span><strong style={{ color: '#1e293b' }}>{countNodes(treeData)}</strong> total nodes</span>
                <span><strong style={{ color: '#3b82f6' }}>{countByType(treeData, 'FG')}</strong> FG</span>
                <span><strong style={{ color: '#22c55e' }}>{countByType(treeData, 'SFG')}</strong> Semi-FG</span>
                <span><strong style={{ color: '#f59e0b' }}>{countByType(treeData, 'RM')}</strong> Raw Material</span>
                <span style={{ marginLeft: 'auto' }}>Total weight: <strong style={{ color: '#1e293b' }}>{treeData.totalWeight ? treeData.totalWeight.toFixed(2) : '—'} kg</strong></span>
              </div>
            )}

            {/* Tree Body */}
            <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
              {treeLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, color: '#94a3b8' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '2rem', marginRight: 8, animation: 'spin 1s linear infinite' }}>progress_activity</span> Loading tree...
                </div>
              ) : treeData ? (
                <div style={{ maxWidth: 960, margin: '0 auto' }}>
                  {renderTreeRows(treeData, expandedNodes, toggleNode, true)}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: '#94a3b8' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '3rem', marginBottom: 8 }}>account_tree</span> No tree data.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Audit Drawer ── */}
      <AuditHistoryDrawer open={auditOpen} entityType="production_bom" entityId={editId ?? undefined} onClose={() => setAuditOpen(false)} />
    </>
  );
}

/* ── Tree Row Renderer ── */

function countNodes(node: TreeNode): number {
  let c = 1;
  if (node.children) for (const ch of node.children) c += countNodes(ch);
  return c;
}
function countByType(node: TreeNode, type: string): number {
  let c = 0;
  const code = (node.componentItemCode || node.itemCode || '').toUpperCase();
  if (type === 'FG' && code.startsWith('FG')) c = 1;
  else if (type === 'SFG' && (code.startsWith('SFG') || code.startsWith('SMFG'))) c = 1;
  else if (type === 'RM' && !code.startsWith('FG') && !code.startsWith('SFG') && !code.startsWith('SMFG')) c = 1;
  if (node.children) for (const ch of node.children) c += countByType(ch, type);
  return c;
}

function renderTreeRows(node: TreeNode, expanded: Set<string>, toggle: (path: string) => void, isRoot = false): React.ReactNode[] {
  const rows: React.ReactNode[] = [];
  const isLeaf = !node.children || node.children.length === 0;
  const path = node.levelPath || '1';
  const isExpanded = expanded.has(path);

  const code = node.itemCode || node.componentItemCode || '';
  const desc = node.description || (node as any).name || '';
  const qtyVal = node.quantityPer != null && node.quantityPer > 0 ? node.quantityPer : 1;
  const unitW = node.weightPerQty != null ? Number(node.weightPerQty) : 0;
  const totalW = node.totalWeight != null && node.totalWeight > 0 ? Number(node.totalWeight) : unitW * qtyVal;
  const rmk = node.remarks || '';

  // Type classification matching FG vs SEMI FG vs RM
  const typeUpper = (node.itemType || (node as any).type || '').toUpperCase();
  const codeUpper = code.toUpperCase();
  const isSemiFg = (typeUpper.includes('SEMI') || typeUpper === 'SFG' || typeUpper === 'SEMI_FG' || codeUpper.startsWith('SFG') || codeUpper.startsWith('SMFG') || codeUpper.startsWith('CSM'));
  const isFg = !isSemiFg && (typeUpper.includes('FG') || typeUpper.includes('FINISHED') || codeUpper.startsWith('FG') || codeUpper.startsWith('MFG') || isRoot);

  const badgeText = isFg ? 'FG' : isSemiFg ? 'SEMI FG' : 'RM';

  rows.push(
    <div key={path} style={{ marginBottom: '10px' }}>
      {/* Node Card Row */}
      <div
        onClick={() => !isLeaf && toggle(path)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: isRoot ? '#ffffff' : '#ffffff',
          border: isRoot ? '1.5px solid #93c5fd' : '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '10px 16px',
          boxShadow: isRoot ? '0 2px 8px rgba(37,99,235,0.06)' : '0 1px 3px rgba(0,0,0,0.02)',
          gap: '12px',
          flexWrap: 'wrap',
          cursor: isLeaf ? 'default' : 'pointer',
        }}
      >
        {/* Left Metadata */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {!isLeaf ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggle(path); }}
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
            {path}
          </span>

          {/* Color-Coded Item Type Badge */}
          {badgeText === 'FG' ? (
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
          ) : badgeText === 'SEMI FG' ? (
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
              {code}
            </span>
            {desc && (
              <span style={{ fontWeight: 500, fontSize: '0.85rem', color: '#64748b' }}>
                {desc}
              </span>
            )}
          </div>
        </div>

        {/* Right Metrics */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Qty Pill */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              padding: '3px 10px',
              fontSize: '0.8rem',
              color: '#64748b',
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
              padding: '3px 10px',
              fontSize: '0.8rem',
              color: '#64748b',
            }}
          >
            W/Unit: <strong style={{ color: '#0f172a', fontWeight: 700 }}>{unitW > 0 ? `${unitW.toFixed(3).replace(/\.?0+$/, '')} kg` : '0 kg'}</strong>
          </div>

          {/* Total Wt Pill */}
          <div
            style={{
              background: '#e0f2fe',
              border: '1px solid #bae6fd',
              borderRadius: '6px',
              padding: '3px 12px',
              fontSize: '0.8rem',
              color: '#0284c7',
              fontWeight: 600,
            }}
          >
            Total Wt: <strong style={{ color: '#0369a1', fontWeight: 800 }}>{totalW > 0 ? `${totalW.toFixed(3).replace(/\.?0+$/, '')} kg` : '0 kg'}</strong>
          </div>

          {/* Remarks Tag */}
          {rmk ? (
            <div
              style={{
                background: '#fdf2f8',
                border: '1px solid #fbcfe8',
                borderRadius: '12px',
                padding: '3px 14px',
                fontSize: '0.78rem',
                color: '#db2777',
                fontWeight: 600,
              }}
            >
              {rmk}
            </div>
          ) : (
            <div
              style={{
                background: '#fdf2f8',
                border: '1px solid #fbcfe8',
                borderRadius: '12px',
                padding: '3px 14px',
                fontSize: '0.78rem',
                color: '#db2777',
                fontWeight: 600,
                opacity: 0.7,
              }}
            >
              note
            </div>
          )}
        </div>
      </div>

      {/* Children Sub-Tree Branch */}
      {isExpanded && node.children && node.children.length > 0 && (
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
            <div key={child.levelPath || child.itemCode} style={{ position: 'relative' }}>
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
              {renderTreeRows(child, expanded, toggle, false)}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return rows;
}
