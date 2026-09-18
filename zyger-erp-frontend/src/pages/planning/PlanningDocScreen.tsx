import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  usePlanningDoc,
  usePlanningDocAction,
  usePlanningDocCreate,
  usePlanningDocDelete,
  usePlanningDocList,
  usePlanningDocNextNumber,
  usePlanningDocUpdate,
} from '../../hooks/usePlanningDocs';
import type { DocScreenConfig } from './planningDocConfigs';
import { formatDate, formatNumber, toOptionalNumber } from '../../utils/format';
import { getApiErrorMessage } from '../../utils/apiError';
import { useToast } from '../../contexts/ToastContext';
import StatusBadge from '../../components/common/StatusBadge';
import ConfirmActionModal from '../../components/common/ConfirmActionModal';
import AuditHistoryDrawer from '../../components/common/AuditHistoryDrawer';
import SearchableItemLookup from '../../components/common/SearchableItemLookup';
import { filterPurchaseRelevantItems } from '../../utils/itemClassification';
import ConflictModal from '../../components/common/ConflictModal';
import { auditEntityTypeFor } from '../../utils/auditEntity';
import { exportToCsv } from '../../utils/csvExport';
import { useFormKeyboard } from '../../hooks/useFormKeyboard';
import { useUnsavedWarning } from '../../hooks/useUnsavedWarning';
import { useFormValidation } from '../../hooks/useFormValidation';
import apiClient from '../../api/axiosClient';
import { TreeRow, type TNode } from '../master/bom/BomMappingEditor';

const PAGE_SIZE = 8;

interface PlanningDocScreenProps {
  config: DocScreenConfig;
  initialDocId?: string | number;
  viewOnly?: boolean;
  defaultType?: string;
}

type ActionModal = { action: 'submit' | 'approve' | 'reject' | 'reopen' | 'cancel' | 'revise' | 'release' | 'obsolete'; danger: boolean };

function parseComponentType(typeStr?: string, bomLevelStr?: string): 'FG' | 'SFG' | 'RM' {
  const t = String(typeStr ?? '').toUpperCase();
  const l = String(bomLevelStr ?? '').toUpperCase();

  if (t.includes('SEMI') || t === 'SFG' || t === 'SEMI_FG' || l.includes('SEMI') || l.includes('SFG')) return 'SFG';
  if (t.includes('RAW') || t === 'RM' || l.includes('RM') || l.includes('RAW')) return 'RM';
  if (t.includes('FINISHED') || t === 'FG' || l.includes('FG')) return 'FG';

  return 'RM';
}

function convertRawNodeToTNode(raw: Record<string, unknown>, index = 0, parentPath = ''): TNode {
  const rawChildren = Array.isArray(raw.children) ? (raw.children as Array<Record<string, unknown>>) : [];
  const rawLevel = String(raw.bomLevel ?? raw.levelPath ?? '');
  let path = rawLevel.replace(/^[^\d]*([\d]+(?:\.[\d]+)*).*/, '$1').trim();
  if (!path) {
    path = parentPath ? `${parentPath}.${index + 1}` : `${index + 1}`;
  }

  const compType = parseComponentType(String(raw.componentType ?? raw.itemType ?? ''), rawLevel);
  const code = String(raw.componentItemCode ?? raw.itemCode ?? raw.bomNumber ?? '');
  const desc = String(raw.description ?? raw.name ?? '');

  const children = rawChildren.map((c, i) => convertRawNodeToTNode(c, i, path));

  return {
    id: String(raw.id ?? `${path}-${index}`),
    path,
    type: compType,
    code,
    label: desc,
    qty: raw.quantityPer != null ? Number(raw.quantityPer) : undefined,
    weightPerQty: raw.weightPerQty != null ? Number(raw.weightPerQty) : undefined,
    totalWeight: raw.totalWeight != null ? Number(raw.totalWeight) : undefined,
    remarks: raw.remarks ? String(raw.remarks) : undefined,
    children,
  };
}

function buildTNodeTreeFromRaw(treeData: Record<string, unknown> | null, lines: Array<Record<string, unknown>>): TNode[] {
  if (treeData && Array.isArray(treeData.children) && treeData.children.length > 0) {
    const rawChildren = treeData.children as Array<Record<string, unknown>>;
    return rawChildren.map((c, i) => convertRawNodeToTNode(c, i, ''));
  }
  if (lines.length > 0) {
    const nodeMap = new Map<string, TNode>();
    const roots: TNode[] = [];
    lines.forEach((l, i) => {
      const rawLevel = String(l.bomLevel ?? '');
      let path = rawLevel.replace(/^[^\d]*([\d]+(?:\.[\d]+)*).*/, '$1').trim();
      if (!path) path = String(i + 1);
      const compType = parseComponentType(String(l.componentType ?? ''), rawLevel);
      const code = String(l.componentItemCode ?? '');
      const desc = String(l.description ?? '');
      const node: TNode = {
        id: String(l.id ?? `line-${i}`),
        path,
        type: compType,
        code,
        label: desc,
        qty: l.quantityPer != null ? Number(l.quantityPer) : undefined,
        weightPerQty: l.weightPerQty != null ? Number(l.weightPerQty) : undefined,
        totalWeight: l.totalWeight != null ? Number(l.totalWeight) : undefined,
        remarks: l.remarks ? String(l.remarks) : undefined,
        children: [],
      };
      nodeMap.set(path, node);
      const lastDot = path.lastIndexOf('.');
      if (lastDot > 0) {
        const parent = nodeMap.get(path.substring(0, lastDot));
        if (parent) parent.children.push(node);
        else roots.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }
  return [];
}

export default function PlanningDocScreen({ config, initialDocId, viewOnly = false, defaultType }: PlanningDocScreenProps) {
  const { toast } = useToast();
  const { docType } = config;

  const [mode, setMode] = useState<'list' | 'form'>(initialDocId ? 'form' : 'list');
  const [documentId, setDocumentId] = useState<string | null>(initialDocId ? String(initialDocId) : null);
  const [isViewOnly, setIsViewOnly] = useState(viewOnly);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState(defaultType ?? '');
  const [page, setPage] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [lines, setLines] = useState<Array<Record<string, unknown>>>([]);
  const [initializedForId, setInitializedForId] = useState('');
  const [actionModal, setActionModal] = useState<ActionModal | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [treeModalOpen, setTreeModalOpen] = useState(false);
  const [treeData, setTreeData] = useState<Record<string, unknown> | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const openTreeModal = async () => {
    if (!documentId) return;
    setTreeModalOpen(true);
    setTreeLoading(true);
    try {
      const { data } = await apiClient.get(`/v1/planning/production-bom/${documentId}/tree`);
      const raw = data as Record<string, unknown>;
      setTreeData(raw);
      const roots = buildTNodeTreeFromRaw(raw, lines);
      const allPaths = new Set(roots.flatMap((r) => [r.path, ...r.children.map((c) => c.path), ...r.children.flatMap((c) => c.children.map((g) => g.path))]));
      setExpandedNodes(allPaths);
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to load BOM tree.'), 'error');
    } finally {
      setTreeLoading(false);
    }
  };
  const [selectedLineIdx, setSelectedLineIdx] = useState<number | null>(null);
  const [childGridData, setChildGridData] = useState<Record<string, unknown>[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [processes, setProcesses] = useState<Array<Record<string, unknown>>>([]);
  const [resources, setResources] = useState<Array<Record<string, unknown>>>([]);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [itemGroups, setItemGroups] = useState<Array<Record<string, unknown>>>([]);
  const [lookupOptions, setLookupOptions] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [conflictState, setConflictState] = useState<{ serverData: Record<string, unknown> | null; localData: Record<string, unknown> | null }>({ serverData: null, localData: null });

  const lookupApis = useMemo(() => {
    const apis = new Set<string>();
    for (const f of config.fields) {
      if (f.lookup?.api) apis.add(f.lookup.api);
    }
    return Array.from(apis);
  }, [config.fields]);

  useEffect(() => { setPage(0); }, [search, status, type]);

  useEffect(() => {
    apiClient.get('/master/item-groups').then((r) => {
      const data = r.data as { content?: unknown[] } | unknown[];
      const list = Array.isArray(data) ? data : (data?.content ?? []);
      setItemGroups(list as Array<Record<string, unknown>>);
    }).catch(() => { });
    apiClient.get('/master/processes').then((r) => {
      const data = r.data as { content?: unknown[] } | unknown[];
      const list = Array.isArray(data) ? data : (data?.content ?? []);
      setProcesses(list as Array<Record<string, unknown>>);
    }).catch(() => { });
    apiClient.get('/master/resources').then((r) => {
      const d = r.data as unknown;
      setResources(Array.isArray(d) ? (d as Array<Record<string, unknown>>) : []);
    }).catch(() => { });
    apiClient.get('/master/items', { params: { size: 1000 } }).then((r) => {
      const d = r.data as { content?: unknown[] } | unknown[];
      const list = Array.isArray(d) ? d : (d?.content ?? []);
      setItems(filterPurchaseRelevantItems(list as Array<Record<string, unknown>>));
    }).catch(() => { });
  }, []);

  useEffect(() => {
    for (const api of lookupApis) {
      if (lookupOptions[api]) continue;
      apiClient.get(api, { params: { size: 500, page: 0 } }).then((r) => {
        const d = r.data as { content?: unknown[] } | unknown[] | Record<string, unknown>;
        const list = Array.isArray(d) ? d : (Array.isArray((d as { content?: unknown[] })?.content) ? (d as { content?: unknown[] }).content as unknown[] : []);
        setLookupOptions((c) => ({ ...c, [api]: list as Array<Record<string, unknown>> }));
      }).catch(() => { });
    }
  }, [lookupApis]);

  const listQuery = usePlanningDocList(docType, {
    page,
    size: PAGE_SIZE,
    sort: 'date,desc',
    search: search || undefined,
    status: status || undefined,
    type: type || undefined,
  });
  const nextNumberQuery = usePlanningDocNextNumber(docType);
  const documentQuery = usePlanningDoc(docType, mode === 'form' && documentId ? documentId : null);
  const createMutation = usePlanningDocCreate(docType);
  const updateMutation = usePlanningDocUpdate(docType);
  const deleteMutation = usePlanningDocDelete(docType);
  const actionMutation = usePlanningDocAction(docType);

  const childGrid = config.childGrids?.[0];
  const selectedLine = selectedLineIdx !== null && config.lines ? lines[selectedLineIdx] ?? (form.lines as Array<Record<string, unknown>>)?.[selectedLineIdx] : null;
  const selectedLineId = selectedLine?.[childGrid?.parentIdField ?? 'id'];

  const childGridQuery = useQuery({
    queryKey: ['child-grid', docType, documentId, childGrid?.apiPath, selectedLineId],
    queryFn: () => {
      const url = (childGrid?.apiPath ?? '').replace('{parentId}', String(selectedLineId));
      return apiClient.get<Record<string, unknown>[]>(url).then((r) => r.data);
    },
    enabled: Boolean(childGrid && documentId && selectedLineId != null),
    staleTime: 0,
    retry: 1,
  });

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setSelectedLineIdx(null);
    setChildGridData([]);
  }, [documentId]);

  useEffect(() => {
    if (initialDocId) {
      setDocumentId(String(initialDocId));
      setIsViewOnly(viewOnly);
      setMode('form');
    }
  }, [initialDocId, viewOnly]);

  useEffect(() => {
    const doc = documentQuery.data;
    if (!doc || !documentId) return;
    const key = String(documentId);
    if (initializedForId === key) return;
    setInitializedForId(key);
    setForm({ ...doc });
    setLines(Array.isArray(doc.lines) ? (doc.lines as Array<Record<string, unknown>>).map((l) => ({ ...l, inspectionRequired: l.inspectionRequired === true ? 'Yes' : l.inspectionRequired === false ? 'No' : l.inspectionRequired })) : []);
  }, [documentQuery.data, documentId, initializedForId]);

  useEffect(() => {
    if (childGridQuery.data) setChildGridData(childGridQuery.data as Record<string, unknown>[]);
  }, [childGridQuery.data]);

  const doc = documentQuery.data;
  const genericStatus = String(doc?.status ?? 'DRAFT');
  const isRouteSheet = config.docType === 'route-sheet';
  const isProductionBom = config.docType === 'production-bom';
  const editable = !isViewOnly && (!documentId || isProductionBom || (isRouteSheet
    ? ['DRAFT'].includes(genericStatus)
    : ['DRAFT', 'REJECTED'].includes(genericStatus)));
  const remarksEditable = !isViewOnly && (isRouteSheet || editable);
  const isBusy = createMutation.isPending || updateMutation.isPending || actionMutation.isPending || deleteMutation.isPending;

  useEffect(() => {
    if (config.docType === 'production-bom' && editable && lines.length > 0) {
      const updatedLines = lines.map((line) => {
        const wPerQty = Number(line.weightPerQty ?? 0);
        const qtyPer = Number(line.quantityPer ?? 0);
        const computedTotal = wPerQty * qtyPer;
        return { ...line, totalWeight: computedTotal > 0 ? String(computedTotal) : line.totalWeight };
      });
      const totalWeightSum = updatedLines.reduce((sum, l) => sum + Number(l.totalWeight ?? 0), 0);
      if (JSON.stringify(updatedLines) !== JSON.stringify(lines)) {
        setLines(updatedLines);
      }
      if (totalWeightSum > 0 && Number(form.weight ?? 0) !== totalWeightSum) {
        setForm((c) => ({ ...c, weight: String(totalWeightSum) }));
      }
    }
  }, [lines.map((l) => `${l.weightPerQty}-${l.quantityPer}`).join(','), config.docType, editable]);
  const rows = listQuery.data?.content ?? [];
  const totalElements = listQuery.data?.totalElements ?? 0;
  const totalPages = listQuery.data?.totalPages ?? 1;

  const openForm = (id: string | null, view: boolean) => {
    setDocumentId(id);
    setInitializedForId('');
    setIsViewOnly(view);
    setForm(config.typeFilter && defaultType ? { [config.typeFilter.field]: defaultType } : config.docType === 'production-bom' ? { baseQuantity: '1', weight: '0' } : {});
    setLines(config.lines?.seed ? config.lines.seed.map((s) => ({ ...s })) : (config.lines ? [{ sequenceNo: 10 }] : []));
    setMode('form');
  };

  const backToList = () => { setDocumentId(null); setInitializedForId(''); setIsViewOnly(false); setMode('list'); };

  const applyLookupCopy = async (fieldKey: string, value: string) => {
    const field = config.fields.find((f) => f.key === fieldKey);
    if (!field?.lookup || !value) return;
    const opts = lookupOptions[field.lookup.api] ?? [];
    const row = opts.find((o) => String(o[field.lookup!.valueKey]) === String(value));
    if (!row) return;
    try {
      if (field.lookup.api.includes('master/bom-mappings')) {
        const { data } = await apiClient.get(`/master/bom-mappings/editor/${row.id}`);
        const mapping = data.mapping ?? data ?? {};
        const fgMappings = Array.isArray(data.fgMappings) ? data.fgMappings : [];
        const semiFgs = Array.isArray(data.semiFgs) ? data.semiFgs : [];

        const newLines: Array<Record<string, unknown>> = [];

        if (fgMappings.length > 0) {
          fgMappings.forEach((fg: any, fgIdx: number) => {
            const fgNum = `${fgIdx + 1}`;
            if (fg.fgItemCode) {
              newLines.push({
                bomLevel: `${fgNum} - FG`,
                lineNo: newLines.length + 1,
                componentItemCode: fg.fgItemCode,
                description: fg.fgItemName || fg.name || 'Finished Good',
                quantityPer: 1,
                uom: 'PCS',
                componentType: 'FINISHED_GOOD',
                remarks: '',
              });
            }

            semiFgs.forEach((s: any, sIdx: number) => {
              const sNum = `${fgNum}.${sIdx + 1}`;
              if (s.semiFgItemCode) {
                newLines.push({
                  bomLevel: `${sNum} - Semi FG`,
                  lineNo: newLines.length + 1,
                  componentItemCode: s.semiFgItemCode,
                  description: s.semiFgItemName || s.name || 'Semi Finished Good',
                  quantityPer: 1,
                  uom: 'PCS',
                  componentType: 'SEMI_FG',
                  remarks: '',
                });
              }

              (s.rms || []).forEach((r: any, rIdx: number) => {
                const rNum = s.semiFgItemCode ? `${sNum}.${rIdx + 1}` : `${fgNum}.${rIdx + 1}`;
                newLines.push({
                  bomLevel: `${rNum} - RM`,
                  lineNo: newLines.length + 1,
                  componentItemCode: r.code || r.itemCode,
                  description: r.name || r.itemName || 'Raw Material',
                  quantityPer: r.qty || 1,
                  uom: r.uom || 'PCS',
                  componentType: 'RAW_MATERIAL',
                  remarks: '',
                });
              });
            });
          });
        } else {
          semiFgs.forEach((s: any, sIdx: number) => {
            const sNum = `${sIdx + 1}`;
            if (s.semiFgItemCode) {
              newLines.push({
                bomLevel: `${sNum} - Semi FG`,
                lineNo: newLines.length + 1,
                componentItemCode: s.semiFgItemCode,
                description: s.semiFgItemName || s.name || 'Semi Finished Good',
                quantityPer: 1,
                uom: 'PCS',
                componentType: 'SEMI_FG',
                remarks: '',
              });
            }

            (s.rms || []).forEach((r: any, rIdx: number) => {
              const rNum = s.semiFgItemCode ? `${sNum}.${rIdx + 1}` : `${sNum}`;
              newLines.push({
                bomLevel: `${rNum} - RM`,
                lineNo: newLines.length + 1,
                componentItemCode: r.code || r.itemCode,
                description: r.name || r.itemName || 'Raw Material',
                quantityPer: r.qty || 1,
                uom: r.uom || 'PCS',
                componentType: 'RAW_MATERIAL',
                remarks: '',
              });
            });
          });
        }

        let headerItemCode = '';
        let headerItemType = '';
        if (fgMappings.length > 0 && fgMappings[0].fgItemCode) {
          headerItemCode = fgMappings[0].fgItemCode;
          headerItemType = 'FG';
        } else if (semiFgs.length > 0 && semiFgs[0].semiFgItemCode) {
          headerItemCode = semiFgs[0].semiFgItemCode;
          headerItemType = 'SEMI_FG';
        }

        const enrichLineWithWeight = (line: Record<string, unknown>) => {
          const code = String(line.componentItemCode ?? '');
          const item = items.find((i) => String(i.code) === code);
          const unitWt = Number(item?.weight ?? item?.netWeight ?? 0);
          const qty = Number(line.quantityPer ?? 1);
          const totalWt = unitWt * qty;
          return {
            ...line,
            weightPerQty: unitWt > 0 ? String(unitWt) : (line.weightPerQty ?? ''),
            totalWeight: totalWt > 0 ? String(totalWt) : (line.totalWeight ?? ''),
          };
        };

        const enrichedLines = newLines.map(enrichLineWithWeight);
        setForm((prev) => ({
          ...prev,
          [fieldKey]: String(value),
          ...(headerItemType ? { itemType: headerItemType } : {}),
          ...(headerItemCode ? { itemCode: headerItemCode } : {}),
          description: mapping.name ? `Derived from BOM Mapping: ${mapping.name} (${mapping.autoCode || row.code || ''})` : prev.description
        }));
        if (enrichedLines.length > 0) setLines(enrichedLines);
        toast(`Selected BOM Mapping ${String(row.code || row.name || '')}. Loaded ${enrichedLines.length} item(s) and components.`);
      } else {
        const { data } = await apiClient.get(`/v1/planning/production-bom/${row.id}`);
        setForm({ ...(data as Record<string, unknown>), [fieldKey]: String(value), baseQuantity: String(data.baseQuantity ?? 1), docNo: undefined });
        setLines(Array.isArray(data.lines) ? (data.lines as Array<Record<string, unknown>>).map((l) => ({ ...l, inspectionRequired: l.inspectionRequired === true ? 'Yes' : l.inspectionRequired === false ? 'No' : l.inspectionRequired })) : []);
        toast(`Copied header and ${Array.isArray(data.lines) ? data.lines.length : 0} components from ${String(data.bomNumber ?? data.docNo ?? '')}. Save to create a new BOM.`);
      }
    } catch (e) { toast(getApiErrorMessage(e, 'Copy failed.'), 'error'); }
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = {};
    for (const field of config.fields) {
      if (field.lookup?.ephemeral) continue;
      const raw = form[field.key];
      if (field.type === 'number') payload[field.key] = toOptionalNumber(raw == null ? '' : String(raw));
      else if (field.type === 'checkbox') payload[field.key] = Boolean(raw);
      else payload[field.key] = raw == null ? null : String(raw);
    }
    if (isRouteSheet) {
      if (!payload.routeVersion) payload.routeVersion = '1.0';
      if (!payload.baseQuantity) payload.baseQuantity = 1;
      if (!payload.baseUom) payload.baseUom = 'PCS';
      if (!payload.description) payload.description = '';
    }
    if (config.lines) {
      payload.lines = lines
        .filter((l) => String(l[config.lines!.fields[0].key] ?? '').trim() !== '')
        .map((l) => {
          const out = { ...l };
          delete out.id;
          delete out.qty;
          if (typeof out.componentItemCode === 'string' && out.componentItemCode.includes(' — ')) {
            const parts = out.componentItemCode.split(' — ');
            out.componentItemCode = parts[0].trim();
            if (!out.description) out.description = parts.slice(1).join(' — ').trim();
          }
          if (out.inspectionRequired === 'Yes') out.inspectionRequired = true;
          else if (out.inspectionRequired === 'No') out.inspectionRequired = false;
          return out;
        });
    }
    return payload;
  };

  const validate = () => {
    const errs = validateFields(config.fields, form);
    if (errs.length > 0) { toast(errs[0].message, 'error'); return false; }
    // Route Sheet specific validations (FRS §6)
    if (isRouteSheet && config.lines && lines.length > 0) {
      // V-02: Sequence No must be unique
      const seqs = lines.map((l) => Number(l.sequenceNo)).filter((s) => s > 0);
      const dupSeq = seqs.find((s, i) => seqs.indexOf(s) !== i);
      if (dupSeq) { toast(`V-02: Duplicate Sequence No ${dupSeq} — each operation must have a unique sequence.`, 'error'); return false; }
      // V-03: At least one row required before release
      if (lines.length === 0) { toast('V-03: At least one operation row is required.', 'error'); return false; }
      // V-04: Setup/Cycle time cannot be negative
      for (let i = 0; i < lines.length; i++) {
        const st = Number(lines[i].setupTime ?? 0);
        const ct = Number(lines[i].cycleTime ?? 0);
        if (st < 0) { toast(`V-04: Row ${i + 1} — Setup Time cannot be negative.`, 'error'); return false; }
        if (ct < 0) { toast(`V-04: Row ${i + 1} — Cycle Time cannot be negative.`, 'error'); return false; }
      }
      // V-05: All processes must be active
      for (let i = 0; i < lines.length; i++) {
        const proc = processes.find((p) => String(p.id) === String(lines[i].processId));
        if (proc && proc.active === false) {
          toast(`V-05: Row ${i + 1} — Selected process is inactive. Please select an active process.`, 'error');
          return false;
        }
      }
    }
    return true;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    try {
      const created = await createMutation.mutateAsync(buildPayload());
      toast(`${created.docNo ?? docType} created as draft.`);
      // Land back on a fresh blank entry form rather than staying on the doc
      // just created — same behavior every success path in this screen follows.
      openForm(null, false);
    } catch (e) { toast(getApiErrorMessage(e, 'Create failed.'), 'error'); }
  };

  const handleSave = async () => {
    if (!documentId) return;
    try {
      await updateMutation.mutateAsync({ id: documentId, payload: buildPayload() });
      toast(`${docType} saved.`);
      openForm(null, false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('CONFLICT:')) {
        try {
          const { data: serverData } = await apiClient.get(`/api/v1/planning/${docType}/${documentId}`);
          setConflictState({ serverData, localData: buildPayload() as Record<string, unknown> });
        } catch { toast('Version conflict detected but could not load server version.', 'error'); }
      } else {
        toast(getApiErrorMessage(e, 'Save failed.'), 'error');
      }
    }
  };

  const runAction = async (action: string, note?: string) => {
    if (!documentId) return;
    try {
      const updated = await actionMutation.mutateAsync({ id: documentId, action, note });
      setActionModal(null);
      toast(`${updated.docNo ?? docType} \u2022 ${action} completed.`);
      openForm(null, false);
    } catch (e) { toast(getApiErrorMessage(e, `${action} failed.`), 'error'); }
  };

  const isDirty = JSON.stringify(form) !== JSON.stringify(documentQuery.data ?? {}) || lines.length > 0;
  const { validate: validateFields, hasError: isFieldError } = useFormValidation();
  useUnsavedWarning(isDirty && !!documentId);
  useFormKeyboard({
    enabled: mode === 'form',
    onSave: editable ? handleSave : undefined,
    onSubmit: !documentId ? handleCreate : undefined,
    onBack: backToList,
  });

  const cellValue = (row: Record<string, unknown>, field: string): string => {
    const raw = row[field];
    if (raw == null) return '\u2014';
    if (typeof raw === 'number') return formatNumber(raw);
    const s = String(raw);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return formatDate(s.slice(0, 10));
    return s;
  };

  const listBody = useMemo(() => {
    if (listQuery.isPending) {
      return <div className="panel"><div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading {config.title} records...</div></div>;
    }
    if (listQuery.isError) {
      return <div className="panel"><div className="empty"><span className="material-symbols-rounded">error</span>{getApiErrorMessage(listQuery.error, 'Unable to load records.')}<div style={{ marginTop: '14px' }}><button className="btn" onClick={() => listQuery.refetch()}><span className="material-symbols-rounded">refresh</span> Retry</button></div></div></div>;
    }
    return (
      <div className="panel">
        <div className="toolbar">
          <div className="searchwrap">
            <span className="material-symbols-rounded">search</span>
            <input className="in" value={searchInput} placeholder="Search..." onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <button
            className="ibtn"
            title="Export CSV"
            onClick={() =>
              exportToCsv(
                rows as unknown as Record<string, unknown>[],
                config.columns.map((c) => ({ key: c.field, label: c.label })),
                config.docType
              )
            }
          >
            <span className="material-symbols-rounded">download</span>
          </button>
          <span className="count">{formatNumber(totalElements)} record{totalElements === 1 ? '' : 's'}</span>
          <select className="in" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All Status</option>
            {config.statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {config.typeFilter && (
            <select className="in" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">{config.typeFilter.label}</option>
              {config.typeFilter.options.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {config.docType === 'production-bom' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8em' }}>
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              Show Inactive
            </label>
          )}
          <div className="sp" />
          <button className="btn btn-p" onClick={() => openForm(null, false)}>
            <span className="material-symbols-rounded">add</span> {config.addButtonLabel ?? 'Add'}
          </button>
        </div>
        <div className="twrap">
          <table className="tbl">
            <thead><tr><th className="num">S.No</th>{config.columns.map((c) => <th key={c.field} className={c.numeric ? 'num' : ''}>{c.label}</th>)}<th>Actions</th></tr></thead>
            <tbody>
              {rows.length > 0 ? rows.map((row: Record<string, unknown>, idx: number) => (
                <tr key={String(row.id)}>
                  <td className="num mut">{page * PAGE_SIZE + idx + 1}</td>
                  {config.columns.map((c) => (
                    <td key={c.field} className={c.numeric ? 'num' : ''}>
                      {c.field === config.statusField ? <StatusBadge status={String(row[c.field] ?? 'DRAFT')} /> : cellValue(row, c.field)}
                    </td>
                  ))}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="ibtn" title="View" onClick={() => openForm(String(row.id), true)}><span className="material-symbols-rounded">visibility</span></button>
                    <button className="ibtn" title="Edit" onClick={() => openForm(String(row.id), false)}><span className="material-symbols-rounded">edit</span></button>
                    <button className="ibtn danger" title="Delete" onClick={() => setDeleteTarget(row)}><span className="material-symbols-rounded">delete</span></button>
                  </td>
                </tr>
              )) : <tr><td colSpan={config.columns.length + 2}><div className="empty"><span className="material-symbols-rounded">description</span> No records found. Click &quot;Add&quot;.</div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span>Showing {rows.length === 0 ? 0 : page * PAGE_SIZE + 1}\u2013{Math.min((page + 1) * PAGE_SIZE, totalElements)} of {formatNumber(totalElements)}</span>
          <div className="pgs">
            <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>\u2039</button>
            {Array.from({ length: totalPages }, (_, i) => i).map((i) => <button key={i} className={i === page ? 'on' : ''} onClick={() => setPage(i)}>{i + 1}</button>)}
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>\u203A</button>
          </div>
        </div>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQuery.data, listQuery.isPending, listQuery.isError, searchInput, status, type, page, totalElements, totalPages, rows]);

  if (mode === 'list') {
    return (
      <>
        <div className="pg-head"><h1>{config.title}</h1><p>{config.subtitle}</p></div>
        {listBody}
        <ConfirmActionModal open={Boolean(deleteTarget)} title={`Delete ${String(deleteTarget?.docNo ?? '')}`} body="The record will be permanently removed. Only DRAFT/REJECTED documents can be deleted." okLabel="Delete" danger busy={deleteMutation.isPending} onClose={() => setDeleteTarget(null)} onConfirm={async () => { if (!deleteTarget) return; try { await deleteMutation.mutateAsync(String(deleteTarget.id)); toast(`${String(deleteTarget.docNo ?? '')} deleted.`); setDeleteTarget(null); } catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); } }} />
      </>
    );
  }

  if (documentId && documentQuery.isPending) {
    return <div className="panel"><div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading {config.title}...</div></div>;
  }
  if (documentId && documentQuery.isError) {
    return <div className="panel"><div className="empty"><span className="material-symbols-rounded">error</span>{getApiErrorMessage(documentQuery.error, 'Unable to load record.')}<div style={{ marginTop: '14px' }}><button className="btn" onClick={() => documentQuery.refetch()}><span className="material-symbols-rounded">refresh</span> Retry</button></div></div></div>;
  }

  const docNo = documentId ? String(doc?.docNo ?? '') : String(nextNumberQuery.data?.nextNumber ?? '\u2014');

  return (
    <>
      <div className="pg-head"><h1>{isViewOnly ? 'View' : documentId ? 'Edit' : 'Add'} {config.title}{documentId ? ` \u2014 ${docNo}` : ''}</h1><p>{config.subtitle}</p></div>
      {!isProductionBom && (
        <div className="note"><span className="material-symbols-rounded">info</span><span>{isRouteSheet ? 'Workflow: DRAFT \u2192 RELEASED \u2192 UNDER_REVISION \u2022 Only DRAFT records are editable' : 'Workflow: DRAFT \u2192 SUBMITTED \u2192 APPROVED \u2022 Only DRAFT/REJECTED records are editable'}</span></div>
      )}
      <form onSubmit={(e) => e.preventDefault()}>
        <div className="panel">
          <div className="panel-h"><h2><span className="material-symbols-rounded">description</span> Header</h2>
            {documentId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {!isProductionBom && documentId && !isViewOnly && (genericStatus === 'DRAFT' || genericStatus === 'SUBMITTED') && <button type="button" className="btn btn-sm btn-g" onClick={() => setActionModal({ action: 'approve', danger: false })} disabled={isBusy}><span className="material-symbols-rounded">thumb_up</span> Approve</button>}
                {!isProductionBom && !isRouteSheet && documentId && !isViewOnly && genericStatus === 'DRAFT' && <button type="button" className="btn btn-sm btn-p" onClick={() => setActionModal({ action: 'submit', danger: false })} disabled={isBusy}><span className="material-symbols-rounded">send</span> Submit</button>}
                {!isProductionBom && documentId && !isViewOnly && genericStatus === 'SUBMITTED' && <button type="button" className="btn btn-sm btn-d" onClick={() => setActionModal({ action: 'reject', danger: true })} disabled={isBusy}><span className="material-symbols-rounded">thumb_down</span> Reject</button>}
                {isRouteSheet && documentId && !isViewOnly && genericStatus === 'DRAFT' && <button type="button" className="btn btn-sm btn-g" onClick={() => { if (lines.length === 0) { toast('V-03: At least one operation row is required before Release.', 'error'); return; } setActionModal({ action: 'release', danger: false }); }} disabled={isBusy}><span className="material-symbols-rounded">rocket_launch</span> Release</button>}
                {isRouteSheet && documentId && !isViewOnly && genericStatus === 'RELEASED' && <button type="button" className="btn btn-sm btn-p" onClick={() => setActionModal({ action: 'revise', danger: false })} disabled={isBusy}><span className="material-symbols-rounded">edit_note</span> Revise</button>}
                {isRouteSheet && documentId && !isViewOnly && (genericStatus === 'RELEASED' || genericStatus === 'UNDER_REVISION') && <button type="button" className="btn btn-sm btn-d" onClick={() => runAction('obsolete')} disabled={isBusy}><span className="material-symbols-rounded">archive</span> Obsolete</button>}
                {!isProductionBom && !isRouteSheet && documentId && editable && genericStatus !== 'DRAFT' && <button type="button" className="btn btn-sm" onClick={() => runAction('reopen')} disabled={isBusy}><span className="material-symbols-rounded">restart_alt</span> Reopen</button>}
                {!isProductionBom && !isRouteSheet && documentId && !isViewOnly && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(genericStatus) && <button type="button" className="btn btn-sm btn-d" onClick={() => setActionModal({ action: 'cancel', danger: true })} disabled={isBusy}><span className="material-symbols-rounded">block</span> Cancel</button>}
                <button type="button" className="btn btn-sm" title="Audit History" onClick={() => setAuditOpen(true)}>
                  <span className="material-symbols-rounded">history</span> Audit
                </button>
                {documentId && (config.docType === 'production-bom' || config.docType === 'route-sheet' || config.docType === 'work-order') && (
                  <a href={`/api/v1/planning/${config.docType}/${documentId}/print`} target="_blank" rel="noopener noreferrer" className="btn btn-sm" title="Print PDF">
                    <span className="material-symbols-rounded">print</span> Print
                  </a>
                )}
                {documentId && config.docType === 'production-bom' && (
                  <button type="button" className="btn btn-sm" onClick={openTreeModal} title="View BOM Tree">
                    <span className="material-symbols-rounded">account_tree</span> Tree
                  </button>
                )}
                {!isProductionBom && <StatusBadge status={genericStatus} />}
              </div>
            )}
          </div>
          <div className="fgrid">
            <label className="fld">
              <span>{isRouteSheet ? 'Route Sheet Code' : 'Doc No'}</span>
              <input className="in" value={docNo} readOnly tabIndex={-1} style={{ fontWeight: 600, background: '#f9fafb' }} />
            </label>
            {config.fields.map((field) => {
              const isFieldReadonly = field.readonly || (isRouteSheet && field.key === 'itemType');
              const isAutoDerived = field.readonly;
              const isAddOnlyHidden = Boolean(field.lookup?.addOnly && documentId);
              const gatedOff = Boolean(field.enableField && !String(form[field.enableField] ?? '').trim());
              const isProductionBomItem = config.docType === 'production-bom' && field.key === 'itemCode';
              const bomItemOptions = isProductionBomItem ? (() => {
                const selectedType = String(form.itemType ?? '').toUpperCase();
                if (!selectedType) return items;
                const groupMap = new Map<string, Record<string, unknown>>();
                itemGroups.forEach((g) => {
                  if (g.code) groupMap.set(String(g.code).toUpperCase(), g);
                });
                const filtered = items.filter((it) => {
                  if (String(it.code ?? '') === String(form.itemCode ?? '')) return true;
                  const t = String(it.itemType ?? it.type ?? '').toUpperCase();
                  const grp = String(it.itemGroup ?? '').toUpperCase();
                  const igObj = grp ? groupMap.get(grp) : null;
                  const igName = String(igObj?.name ?? it.itemGroupName ?? '').toUpperCase();
                  const igType = String(igObj?.itemType ?? it.itemGroupType ?? it.groupItemType ?? '').toUpperCase();
                  const cat = String(it.category ?? it.bomCategory ?? '').toUpperCase();
                  const gt = String(it.groupType ?? '').toUpperCase();
                  const isFg = (
                    t === 'FG' || t.includes('FINISHED') || t.includes('FG') ||
                    grp === 'FG' || grp.includes('FINISHED') || grp.includes('FG') ||
                    igName.includes('FINISHED') || igName.includes('FG') ||
                    igType === 'FG' || igType.includes('FINISHED') || igType.includes('FG') ||
                    cat === 'FG' || cat.includes('FINISHED') || cat.includes('FG') ||
                    gt === 'FG' || gt.includes('FINISHED') || gt.includes('FG')
                  );
                  const isSemiFg = (
                    t === 'SEMI_FG' || t === 'SFG' || t.includes('SEMI') ||
                    grp === 'SEMI_FG' || grp === 'SFG' || grp.includes('SEMI') ||
                    igName.includes('SEMI') || igName.includes('SFG') ||
                    igType === 'SEMI_FG' || igType === 'SFG' || igType.includes('SEMI') ||
                    cat === 'SEMI_FG' || cat === 'SFG' || cat.includes('SEMI') ||
                    gt === 'SEMI_FG' || gt === 'SFG' || gt.includes('SEMI')
                  );
                  if (selectedType === 'FG' || selectedType.includes('FINISHED')) {
                    return isFg || isSemiFg;
                  }
                  if (selectedType === 'SEMI_FG' || selectedType === 'SFG' || selectedType.includes('SEMI')) {
                    return isSemiFg;
                  }
                  return true;
                });
                return filtered.length > 0 ? filtered : items;
              })() : items;
              if (isAddOnlyHidden) return null;
              return (
                <label key={field.key} className={`fld ${field.span2 ? 'span2' : ''} ${isFieldError(field.key) ? 'invalid' : ''}`}>
                  <span>{field.label}</span>
                  {isRouteSheet && field.key === 'itemCode' ? (
                    <SearchableItemLookup
                      disabled={!editable}
                      value={String(form[field.key] ?? '')}
                      items={items.map((it) => ({ id: String(it.id ?? it.code ?? ''), code: String(it.code ?? ''), name: it.name ? String(it.name) : undefined, description: it.description ? String(it.description) : undefined }))}
                      onChange={(code) => {
                        const it = items.find((i) => String(i.code) === code);
                        let derivedType = it ? String(it.itemType ?? '') : '';
                        if (it && (String(it.code ?? '').toLowerCase().includes('wheel') || String(it.description ?? '').toLowerCase().includes('wheel') || String(it.name ?? '').toLowerCase().includes('wheel') || derivedType === 'CUSTOMER_SUPPLIED' || derivedType === 'Customer_supplied' || derivedType === 'CSM')) {
                          derivedType = 'SEMI_FG';
                        }
                        setForm((c) => ({ ...c, itemCode: code, itemType: derivedType || c.itemType }));
                      }}
                    />
                  ) : isProductionBomItem ? (
                    <SearchableItemLookup
                      disabled={!editable || gatedOff}
                      value={String(form[field.key] ?? '')}
                      items={bomItemOptions.map((it) => ({ id: String(it.id ?? it.code ?? ''), code: String(it.code ?? ''), description: it.description ? String(it.description) : undefined }))}
                      onChange={(code) => {
                        const it = items.find((i) => String(i.code) === code);
                        const unitWt = Number(it?.weight ?? it?.netWeight ?? 0);
                        const qty = Number(form.baseQuantity ?? 1);
                        const computedWt = unitWt > 0 ? (unitWt * (qty > 0 ? qty : 1)).toFixed(3) : form.weight;
                        // FRS v4.0 Changelog #4: auto-derive itemType, weight, description from ItemMaster on BOM item select
                        setForm((c) => ({
                          ...c,
                          itemCode: code,
                          itemType: it ? String(it.itemType ?? '') : c.itemType,
                          itemRevision: it && it.revision ? String(it.revision) : c.itemRevision,
                          description: it && it.description ? String(it.description) : c.description,
                          ...(unitWt > 0 ? { weight: String(computedWt) } : {}),
                        }));
                      }}
                    />
                  ) : field.lookup ? (
                    <select className="in" disabled={isFieldReadonly || !editable} value={String(form[field.key] ?? '')}
                      onChange={(e) => {
                        const value = e.target.value;
                        setForm((c) => ({ ...c, [field.key]: value }));
                        if (field.lookup?.ephemeral) applyLookupCopy(field.key, value);
                      }}>
                      <option value="">{'\u2014 Select \u2014'}</option>
                      {(lookupOptions[field.lookup.api] ?? []).map((opt) => {
                        const label = (field.lookup?.labelKeys ?? [field.lookup!.valueKey])
                          .map((k) => String(opt[k] ?? ''))
                          .filter(Boolean)
                          .join(field.lookup?.separator ?? ' — ');
                        return <option key={String(opt[field.lookup!.valueKey])} value={String(opt[field.lookup!.valueKey] ?? '')}>{label}</option>;
                      })}
                    </select>
                  ) : field.type === 'textarea' ? (
                    <textarea className="in" rows={2} readOnly={field.key === 'remarks' ? !remarksEditable : isFieldReadonly || !editable} value={String(form[field.key] ?? '')} onChange={(e) => setForm((c) => ({ ...c, [field.key]: e.target.value }))} />
                  ) : field.type === 'select' ? (
                    <select className="in" disabled={isFieldReadonly || !editable || gatedOff} value={String(form[field.key] ?? '')} onChange={(e) => setForm((c) => ({ ...c, [field.key]: e.target.value }))}>
                      <option value="">\u2014 Select \u2014</option>
                      {(field.options ?? []).map((o) => <option key={o} value={o}>{field.optionLabels?.[o] ?? o}</option>)}
                    </select>
                  ) : field.type === 'checkbox' ? (
                    <input type="checkbox" className="checkbox" disabled={isFieldReadonly || !editable} checked={Boolean(form[field.key])} onChange={(e) => setForm((c) => ({ ...c, [field.key]: e.target.checked }))} />
                  ) : (
                    <input className="in" type={field.type ?? 'text'} readOnly={isFieldReadonly || !editable} value={String(form[field.key] ?? '')}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (config.docType === 'production-bom' && field.key === 'baseQuantity') {
                          setForm((c) => {
                            const qty = Number(val ?? 0);
                            const it = items.find((i) => String(i.code) === String(c.itemCode ?? ''));
                            const unitWt = Number(it?.weight ?? it?.netWeight ?? 0);
                            const computedWt = unitWt > 0 && qty > 0 ? (unitWt * qty).toFixed(3) : c.weight;
                            return {
                              ...c,
                              baseQuantity: val,
                              ...(unitWt > 0 && qty > 0 ? { weight: String(computedWt) } : {}),
                            };
                          });
                        } else {
                          setForm((c) => ({ ...c, [field.key]: val }));
                        }
                      }}
                      style={isAutoDerived ? { background: '#f9fafb', fontStyle: 'italic' } : undefined} />
                  )}
                  {isAutoDerived && <span style={{ fontSize: '10px', color: '#9ca3af', marginTop: '2px' }}>Auto-derived</span>}
                </label>
              );
            })}
          </div>
        </div>

        {config.lines && editable && (
          <div className="panel">
            <div className="panel-h"><h2><span className="material-symbols-rounded">table_view</span> {config.lines.title}</h2>
              {!config.lines.seed && <button type="button" className="btn btn-sm" disabled={isBusy} onClick={() => setLines((c) => [...c, { sequenceNo: (c.length + 1) * 10 }])}><span className="material-symbols-rounded">add</span> Add Line</button>}
            </div>
            <div className="twrap">
              <table className="tbl lines">
                <thead><tr><th className="num">S.No</th>{config.lines.fields.map((f) => <th key={f.key} style={f.width ? { width: f.width, minWidth: f.width } : undefined}>{f.label}</th>)}{!config.lines.seed && <th></th>}</tr></thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={index} onClick={() => config.childGrids && setSelectedLineIdx(selectedLineIdx === index ? null : index)} style={config.childGrids ? { cursor: 'pointer' } : undefined} className={selectedLineIdx === index ? 'selected-row' : ''}>
                      <td className="num mut">{index + 1}</td>
                      {config.lines!.fields.map((f) => (
                        <td key={f.key} style={f.width ? { width: f.width, minWidth: f.width } : undefined}>
                          {docType === 'route-sheet' && f.key === 'processId' ? (
                            <select className="in" value={String(line[f.key] ?? '')} onChange={(e) => {
                              const selectedId = e.target.value;
                              const proc = processes.find((p) => String(p.id) === selectedId);
                              const reqResId = proc?.requiredResource != null ? String(proc.requiredResource) : (proc?.resourceId != null ? String(proc.resourceId) : '');
                              const reqRes = resources.find((r) => String(r.id) === reqResId);
                              setLines((c) => c.map((l, i) => i === index ? {
                                ...l,
                                sequenceNo: l.sequenceNo ? l.sequenceNo : (index + 1) * 10,
                                processId: selectedId || '',
                                processCode: proc?.code ?? '',
                                processType: proc?.processType ?? (reqRes?.resourceType === 'Vendor' ? 'Outsource' : 'Insource'),
                                resourceId: reqResId || l.resourceId || '',
                                resourceName: reqRes?.resourceName ?? proc?.resourceName ?? l.resourceName ?? '',
                                resourceType: reqRes?.resourceType ?? proc?.resourceType ?? l.resourceType ?? '',
                                setupTime: proc?.setupTime ?? l.setupTime ?? 0,
                                cycleTime: proc?.cycleTime ?? l.cycleTime ?? 0,
                                inspectionRequired: proc?.inspection ? 'Yes' : (l.inspectionRequired ?? 'No'),
                              } : l));
                            }}>
                              <option value="">— Select Process —</option>
                              {processes.filter((p) => p.active !== false).map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.code || '')}{p.code ? ' — ' : ''}{String(p.name || '')}</option>)}
                            </select>
                          ) : docType === 'route-sheet' && f.key === 'resourceId' ? (
                            <select className="in" value={String(line[f.key] ?? '')} onChange={(e) => {
                              const selectedResId = e.target.value;
                              const res = resources.find((r) => String((r as any).id) === selectedResId);
                              const proc = processes.find((p) => String((p as any).id) === String(line.processId));
                              const procResType = String((proc as any)?.resourceType || '');
                              const resResType = String((res as any)?.resourceType || '');
                              if (res && proc && procResType && resResType && procResType.toLowerCase() !== resResType.toLowerCase()) {
                                toast(`Rule 17 Soft Warning: Selected resource type (${resResType}) differs from default process resource type (${procResType}).`, 'error');
                              }
                              setLines((c) => c.map((l, i) => i === index ? {
                                ...l,
                                resourceId: selectedResId || '',
                                resourceName: res?.resourceName ?? '',
                                resourceType: res?.resourceType ?? '',
                                processType: res?.resourceType === 'Vendor' ? 'Outsource' : (l.processType || 'Insource'),
                              } : l));
                            }}>
                              <option value="">— Default from Process —</option>
                              {resources.filter((r) => r.active !== false).map((r) => <option key={String(r.id)} value={String(r.id)}>{String(r.resourceCode || '')} — {String(r.resourceName || '')} ({String(r.resourceType || '')})</option>)}
                            </select>
                          ) : f.type === 'select' ? (
                            <select className="in" value={String(line[f.key] ?? '')} onChange={(e) => setLines((c) => c.map((l, i) => (i === index ? { ...l, [f.key]: e.target.value } : l)))}>
                              <option value="">\u2014</option>
                              {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : config.docType === 'production-bom' && f.key === 'componentItemCode' ? (
                            <SearchableItemLookup
                              disabled={f.readonly || !editable}
                              value={String(line.componentItemCode ?? '')}
                              items={items.map((it) => ({ id: String(it.id ?? it.code ?? ''), code: String(it.code ?? ''), description: it.description ? String(it.description) : undefined }))}
                              onChange={(code) => {
                                setLines((c) =>
                                  c.map((l, i) => {
                                    if (i !== index) return l;
                                    const item = items.find((i2) => String(i2.code) === code);
                                    const unitWt = Number(item?.weight ?? item?.netWeight ?? 0);
                                    const qty = Number(l.quantityPer ?? 1);
                                    const totW = unitWt * qty;
                                    return {
                                      ...l,
                                      componentItemCode: code,
                                      description: String(item?.description ?? item?.name ?? ''),
                                      ...(unitWt > 0 ? { weightPerQty: String(unitWt), totalWeight: totW > 0 ? String(totW) : l.totalWeight } : {})
                                    };
                                  })
                                );
                              }}
                            />
                          ) : (
                            <input
                              className="in"
                              type={f.type ?? 'text'}
                              readOnly={f.readonly || !editable}
                              value={String(line[f.key] ?? '')}
                              onChange={(e) => {
                                const val = e.target.value;
                                setLines((c) =>
                                  c.map((l, i) => {
                                    if (i !== index) return l;
                                    if (config.docType === 'production-bom' && (f.key === 'quantityPer' || f.key === 'weightPerQty')) {
                                      const qty = Number(f.key === 'quantityPer' ? val : l.quantityPer ?? 0);
                                      const w = Number(f.key === 'weightPerQty' ? val : l.weightPerQty ?? 0);
                                      const totW = (qty || 0) * (w || 0);
                                      return { ...l, [f.key]: val, totalWeight: totW > 0 ? String(totW) : '' };
                                    }
                                    return { ...l, [f.key]: val };
                                  })
                                );
                              }}
                            />
                          )}
                        </td>
                      ))}
                      {!config.lines!.seed && <td><button type="button" className="ibtn danger" disabled={isBusy} onClick={(e) => { e.stopPropagation(); setLines((c) => c.filter((_, i) => i !== index)); if (selectedLineIdx === index) setSelectedLineIdx(null); }}><span className="material-symbols-rounded">delete</span></button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* FRS §6.1.6: Pinned weight/cost summary bar at bottom of BOM component grid */}
        {config.docType === 'production-bom' && (documentId || lines.length > 0) && (
          <div style={{ position: 'sticky', bottom: 0, zIndex: 10, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 32, marginBottom: 16, boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 16, color: '#0369a1' }}>scale</span>
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Total Weight:</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0c4a6e' }}>{Number(form.weight ?? 0).toFixed(3)} kg</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 16, color: '#0369a1' }}>inventory_2</span>
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Components:</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0c4a6e' }}>{lines.length}</span>
            </div>
            {Number(form.cost ?? 0) > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 16, color: '#0369a1' }}>payments</span>
                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Est. Cost:</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0c4a6e' }}>{Number(form.cost ?? 0).toFixed(2)}</span>
              </div>
            )}
          </div>
        )}

        {config.lines && !editable && Array.isArray(form.lines) && (form.lines as Array<Record<string, unknown>>).length > 0 && (
          <div className="panel">
            <div className="panel-h"><h2><span className="material-symbols-rounded">table_view</span> {config.lines.title}</h2></div>
            <div className="twrap">
              <table className="tbl">
                <thead><tr><th className="num">S.No</th>{config.lines.fields.map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
                <tbody>
                  {(form.lines as Array<Record<string, unknown>>).map((line, index) => (
                    <tr key={index} onClick={() => config.childGrids && setSelectedLineIdx(selectedLineIdx === index ? null : index)} style={config.childGrids ? { cursor: 'pointer' } : undefined} className={selectedLineIdx === index ? 'selected-row' : ''}>
                      <td className="num mut">{index + 1}</td>
                      {config.lines!.fields.map((f) => {
                        let displayVal = line[f.key] == null ? '—' : String(line[f.key]);
                        if (config.docType === 'production-bom' && f.key === 'componentItemCode') {
                          const code = line.componentItemCode ? String(line.componentItemCode) : '';
                          const desc = line.description ? String(line.description) : '';
                          if (code && desc && !code.includes(desc)) displayVal = `${code} — ${desc}`;
                          else if (code) displayVal = code;
                          else if (desc) displayVal = desc;
                        } else if (docType === 'route-sheet') {
                          if (f.key === 'processId') {
                            displayVal = String(line.processCode || (processes.find(p => String(p.id) === String(line.processId))?.code) || displayVal);
                          } else if (f.key === 'resourceId') {
                            displayVal = String(line.resourceName || (resources.find(r => String(r.id) === String(line.resourceId))?.resourceName) || displayVal);
                          } else if (f.key === 'inspectionRequired') {
                            displayVal = line.inspectionRequired === true || line.inspectionRequired === 'Yes' ? 'Yes' : 'No';
                          }
                        }
                        return <td key={f.key}>{displayVal}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {config.childGrids && selectedLineIdx !== null && childGrid && (
          <div className="panel">
            <div className="panel-h"><h2><span className="material-symbols-rounded">checklist</span> {childGrid.title}</h2></div>
            {childGridQuery.isPending && <div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading...</div>}
            {childGridQuery.isError && <div className="empty"><span className="material-symbols-rounded">error</span> Failed to load inspection parameters.</div>}
            {childGridQuery.isSuccess && childGridData.length === 0 && <div className="empty"><span className="material-symbols-rounded">info</span> No inspection parameters for this operation.</div>}
            {childGridQuery.isSuccess && childGridData.length > 0 && (
              <div className="twrap">
                <table className="tbl">
                  <thead><tr><th className="num">S.No</th>{childGrid.fields.map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
                  <tbody>
                    {childGridData.map((row, idx) => (
                      <tr key={idx}><td className="num mut">{idx + 1}</td>{childGrid.fields.map((f) => <td key={f.key}>{row[f.key] == null ? '\u2014' : String(row[f.key])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="panel">
          <div className="actbar">
            <div className="lft">
              <button type="button" className="btn btn-sm" onClick={backToList} disabled={isBusy}><span className="material-symbols-rounded">arrow_back</span> Back</button>
              <span className="material-symbols-rounded">lock</span>{documentId ? 'Audited document' : 'New document'}
            </div>
            <div className="rgt">
              <span className="kbd-hint"><kbd className="kbd">Ctrl+S</kbd> Save</span>
              {documentId && (genericStatus === 'DRAFT' || genericStatus === 'SUBMITTED') && (
                <button type="button" className="btn btn-sm btn-g" onClick={() => setActionModal({ action: 'approve', danger: false })} disabled={isBusy}>
                  <span className="material-symbols-rounded">thumb_up</span> Approve
                </button>
              )}
              {documentId && editable && (
                <button type="button" className="btn btn-sm" onClick={handleSave} disabled={isBusy}><span className="material-symbols-rounded">save</span> Save</button>
              )}
              {!documentId && <button type="button" className="btn btn-sm btn-p" onClick={handleCreate} disabled={isBusy}><span className="material-symbols-rounded">save</span> {isProductionBom ? 'Save Production BOM' : 'Create Draft'}</button>}
            </div>
          </div>
        </div>
      </form>
      <ConfirmActionModal open={Boolean(actionModal)} title={`${actionModal?.action ?? ''} ${docNo}`} body={actionModal?.action === 'approve' ? 'Approving records the action with your user in the audit trail.' : actionModal?.action === 'reject' ? 'Reason for rejection:' : actionModal?.action === 'revise' ? 'Remarks for new revision (required):' : actionModal?.action === 'cancel' ? 'This cancels the record with an audit trail.' : actionModal?.action === 'release' ? 'Release this Route Sheet? It will become read-only except Remarks.' : actionModal?.action === 'obsolete' ? 'Mark this Route Sheet as Obsolete? It will no longer be selectable for production.' : 'Submit this record for review?'} okLabel={actionModal ? actionModal.action.charAt(0).toUpperCase() + actionModal.action.slice(1) : 'Confirm'} danger={actionModal?.danger} busy={actionMutation.isPending} onClose={() => setActionModal(null)} onConfirm={(note) => actionModal && runAction(actionModal.action, note)} />
      <AuditHistoryDrawer open={auditOpen} entityType={auditEntityTypeFor(docType)} entityId={documentId ?? undefined} onClose={() => setAuditOpen(false)} />
      {/* FRS §5.4: Conflict resolution modal */}
      <ConflictModal
        open={Boolean(conflictState.serverData)}
        serverData={conflictState.serverData}
        localData={conflictState.localData}
        busy={isBusy}
        onCancel={() => setConflictState({ serverData: null, localData: null })}
        onOverwrite={async () => {
          if (!documentId || !conflictState.localData) return;
          try {
            const { data } = await apiClient.put(`/api/v1/planning/${docType}/${documentId}`, { ...conflictState.localData, forceOverwrite: true });
            setForm({ ...data });
            setConflictState({ serverData: null, localData: null });
            toast('Overwritten successfully.', 'success');
          } catch (e) { toast(getApiErrorMessage(e, 'Overwrite failed.'), 'error'); }
        }}
        onMerge={async (merged) => {
          if (!documentId) return;
          try {
            const { data } = await apiClient.put(`/api/v1/planning/${docType}/${documentId}`, { ...merged, forceOverwrite: true });
            setForm({ ...data });
            setConflictState({ serverData: null, localData: null });
            toast('Merged and saved successfully.', 'success');
          } catch (e) { toast(getApiErrorMessage(e, 'Merge save failed.'), 'error'); }
        }}
      />
      {treeModalOpen && (() => {
        const treeRoots = buildTNodeTreeFromRaw(treeData, lines);
        const treeNodeCount = treeRoots.reduce((n, r) => n + 1 + r.children.reduce((x, c) => x + 1 + c.children.length, 0), 0);
        const treeFgCount = treeRoots.filter((r) => r.type === 'FG').length || treeRoots.length;
        const treeSemiCount = new Set(treeRoots.flatMap((r) => r.children.map((c) => c.id))).size;
        const treeRmCount = new Set(treeRoots.flatMap((r) => r.children.flatMap((c) => c.children.map((g) => g.id)))).size;

        return (
          <div className="mwrap" onClick={() => setTreeModalOpen(false)} style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(6px)' }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              position: 'fixed', inset: 20, background: '#fafbfc', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #e2e8f0',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="material-symbols-rounded" style={{ color: '#6366f1', fontSize: '1.4rem' }}>account_tree</span>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>Production BOM Structure</h2>
                    <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.78rem', marginTop: 2 }}>{docNo} {form.itemCode ? `— ${form.itemCode}` : ''}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button type="button" className="btn btn-sm" onClick={() => setExpandedNodes(new Set())} style={{ fontSize: '0.75rem' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>unfold_less</span> Collapse
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setExpandedNodes(new Set(treeRoots.flatMap((r) => [r.path, ...r.children.map((c) => c.path), ...r.children.flatMap((c) => c.children.map((g) => g.path))])))} style={{ fontSize: '0.75rem' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>unfold_more</span> Expand
                  </button>
                  <button className="btn btn-sm" onClick={() => setTreeModalOpen(false)} style={{ marginLeft: 4 }}>
                    <span className="material-symbols-rounded">close</span>
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 24, padding: '10px 24px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', fontSize: '0.78rem', color: '#64748b' }}>
                <span><strong style={{ color: '#1e293b' }}>{treeNodeCount}</strong> total nodes</span>
                <span><strong style={{ color: '#3b82f6' }}>{treeFgCount}</strong> FG</span>
                <span><strong style={{ color: '#22c55e' }}>{treeSemiCount}</strong> Semi-FG</span>
                <span><strong style={{ color: '#f59e0b' }}>{treeRmCount}</strong> Raw Material</span>
              </div>

              <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
                {treeLoading ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 32, display: 'block', margin: '0 auto 8px' }}>hourglass_empty</span> Loading BOM tree structure...
                  </div>
                ) : treeRoots.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: '#94a3b8' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '3rem', marginBottom: 8 }}>account_tree</span> No tree data.
                  </div>
                ) : (
                  <div style={{ maxWidth: 960, margin: '0 auto' }}>
                    {treeRoots.map((n) => (
                      <TreeRow
                        key={n.id}
                        node={n}
                        expanded={expandedNodes}
                        toggle={(p) => setExpandedNodes((prev) => { const nx = new Set(prev); if (nx.has(p)) nx.delete(p); else nx.add(p); return nx; })}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
