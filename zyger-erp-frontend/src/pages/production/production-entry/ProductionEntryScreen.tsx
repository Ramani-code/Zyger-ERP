import { useEffect, useState, useCallback } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';
import QRScanInput from '../../../components/common/QRScanInput';
import StatusBadge from '../../../components/common/StatusBadge';
import { printDocument as printDoc } from '../../../utils/printDocument';
import { exportToCsv } from '../../../utils/csvExport';
import { enqueue } from '../../../utils/offlineQueue';
import { usePendingSyncCount } from '../../../hooks/usePendingSyncCount';
import { useTabs } from '../../../contexts/TabsContext';

import MultipleOperatorsModal, { type OperatorAssignment } from './MultipleOperatorsModal';
import RejectionReasonModal, { type RejectionReasonItem } from './RejectionReasonModal';
import ReworkReasonModal, { type ReworkReasonItem } from './ReworkReasonModal';
import ProductionSummaryReportModal from './ProductionSummaryReportModal';

interface ProductionEntryItem {
  id?: number;
  entryNumber?: string;
  version?: number;
  entryType?: string;
  productionType?: string;
  supervisorCode?: string;
  supervisorName?: string;
  financialYear?: string;
  workOrderNumber?: string;
  jobCardNumber?: string;
  subjobNumber?: string;
  routeSheetNumber?: string;
  pendingSequenceOnly?: boolean;
  partCode?: string;
  partDescription?: string;
  operationCode?: string;
  operationSequence?: number;
  processQty?: number;
  routeSheetQty?: number;
  uom?: string;
  routeSheetDate?: string;
  machineCode?: string;
  operatorCode?: string;
  shiftCode?: string;
  productionDate?: string;
  startTime?: string;
  endTime?: string;
  processTime?: number;
  cycleTimeVarianceFlagged?: boolean;
  processRate?: number;
  mhr?: number;
  itemWeight?: number;
  idleTime?: number;
  idleReason?: string;
  producedQuantity?: number;
  goodQuantity?: number;
  reworkQuantity?: number;
  rejectedQuantity?: number;
  scrapQuantity?: number;
  status?: string;
  qualityStatus?: string;
  reversedFromEntryId?: number;
  isReversal?: boolean;
  reversalReason?: string;
  remarks?: string;
  operators?: OperatorAssignment[];
  rejectionReasons?: RejectionReasonItem[];
  reworkReasons?: ReworkReasonItem[];
  materials?: Array<{ rmCode: string; reqQty: number; totalIssuedQty: number; availableQty: number; consumedQty: number; scrapQty: number; rpQty: number; deviationQty: number; returnQty: number; rate: number; batchNumber: string }>;
  batchAllocations?: Array<{ batchNumber: string; allocatedQty: number; warehouseCode?: string; batchType?: string }>;
  additionalOutputs?: AdditionalOutput[];
}

export interface AdditionalOutput {
  id?: number;
  outputType: 'CO_PRODUCT' | 'BY_PRODUCT';
  itemCode: string;
  itemName?: string;
  uom?: string;
  location?: string;
  quantity: number;
  weight?: number;
  destinationStageCode?: string;
  remarks?: string;
}

interface MasterOption { id: number; code: string; name?: string; }

const SC: Record<string, { color: string; bg: string }> = {
  DRAFT: { color: '#888', bg: '#e9ecef' },
  SUBMITTED: { color: '#2563eb', bg: '#dbeafe' },
  POSTED: { color: '#166534', bg: '#dcfce7' },
  APPROVED: { color: '#22c55e', bg: '#d4edda' },
  REJECTED: { color: '#ef4444', bg: '#f8d7da' },
  CANCELLED: { color: '#991b1b', bg: '#fde2e2' },
  REVERSED: { color: '#7c3aed', bg: '#f3e8ff' },
};

export default function ProductionEntryScreen() {
  const { toast } = useToast();
  const { can } = useAuth();
  const pendingCount = usePendingSyncCount();
  const { closeTab } = useTabs();
  const backToList = () => closeTab('production-entry');

  const [rows, setRows] = useState<ProductionEntryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Partial<ProductionEntryItem>>({
    entryType: 'Production Entry',
    productionType: 'GENERAL',
    pendingSequenceOnly: true,
    producedQuantity: 0,
    goodQuantity: 0,
    reworkQuantity: 0,
    rejectedQuantity: 0,
    scrapQuantity: 0,
    processQty: 0,
    idleTime: 0,
  });
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductionEntryItem | null>(null);
  const [reversalTarget, setReversalTarget] = useState<ProductionEntryItem | null>(null);
  const [reversalReasonText, setReversalReasonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'list' | 'form'>('list');

  // Filters (§3.1)
  const [search] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterPartCode, setFilterPartCode] = useState('');
  const [filterPartName] = useState('');
  const [filterEntryNo, setFilterEntryNo] = useState('');
  const [filterRouteSheet, setFilterRouteSheet] = useState('');
  const [filterMachine, setFilterMachine] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Summary Dropdown Menu state
  const [summaryMenuOpen, setSummaryMenuOpen] = useState(false);
  const [summaryReportType, setSummaryReportType] = useState<'rejection' | 'rework' | 'idle' | 'machine' | 'operator' | null>(null);

  // Modals
  const [moModalOpen, setMoModalOpen] = useState(false);
  const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
  const [reworkModalOpen, setReworkModalOpen] = useState(false);

  // Lookups & Options
  const [jcLookup, setJcLookup] = useState('');
  const [jcOptions, setJcOptions] = useState<Array<{ jobCardNumber: string; partCode: string; partDescription: string; machineCode: string; workOrderNumber: string; routeSheetNumber?: string; subjobs?: Array<{ subjobNumber: string; operationCode: string; machineCode: string; workCenterCode: string; plannedQuantity: number; completedQuantity: number }> }>>([]);
  const [eligibleOps, setEligibleOps] = useState<Array<{ operationCode: string; operationDescription: string; sequenceNo: number; pendingQuantity: number; eligible: boolean; machineCode?: string }>>([]);

  const [machines, setMachines] = useState<MasterOption[]>([]);
  const [operators, setOperators] = useState<MasterOption[]>([]);
  const [shifts, setShifts] = useState<MasterOption[]>([]);
  const [supervisors, setSupervisors] = useState<MasterOption[]>([]);

  // Added Items Summary Grid (§3.5)
  const [addedItems, setAddedItems] = useState<ProductionEntryItem[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/v1/production/entries');
      setRows(Array.isArray(data) ? data : data.content ?? []);
    } catch (e) { toast(getApiErrorMessage(e, 'Load failed.'), 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const fetchMasters = useCallback(async () => {
    try {
      const [mRes, sRes, uRes] = await Promise.allSettled([
        apiClient.get('/master/machines', { params: { size: 200 } }),
        apiClient.get('/master/shifts', { params: { size: 100 } }).catch(() => ({ data: [] })),
        apiClient.get('/master/users', { params: { size: 200 } }).catch(() => ({ data: [] })),
      ]);
      if (mRes.status === 'fulfilled') {
        const list = Array.isArray(mRes.value.data) ? mRes.value.data : mRes.value.data.content ?? [];
        setMachines(list.map((m: Record<string, unknown>) => ({ id: m.id as number, code: (m.machineCode ?? m.code ?? '') as string, name: (m.description ?? m.name ?? '') as string })));
      }
      if (sRes.status === 'fulfilled' && Array.isArray(sRes.value.data)) {
        setShifts(sRes.value.data.map((s: Record<string, unknown>) => ({ id: s.id as number, code: s.code as string, name: s.name as string })));
      }
      if (uRes.status === 'fulfilled' && Array.isArray(uRes.value.data)) {
        setSupervisors(uRes.value.data.map((u: Record<string, unknown>) => ({ id: u.id as number, code: String(u.username ?? ''), name: String(u.fullName || u.username || '') })));
        setOperators(uRes.value.data.map((u: Record<string, unknown>) => ({ id: u.id as number, code: String(u.username ?? ''), name: String(u.fullName || u.username || '') })));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (tab === 'form') fetchMasters(); }, [tab, fetchMasters]);

  const fetchJobCards = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/v1/production/job-cards', { params: { size: 50 } });
      setJcOptions(Array.isArray(data) ? data : data.content ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (tab === 'form' && !editId) fetchJobCards(); }, [tab, editId, fetchJobCards]);

  const loadEligibleOperations = useCallback(async (jobCardNumber: string, pendingSeqOnly: boolean) => {
    try {
      const { data } = await apiClient.get('/v1/production/entries/eligible-operations', {
        params: { jobCardNumber, pendingSequenceOnly: pendingSeqOnly }
      });
      setEligibleOps(Array.isArray(data) ? data : []);
    } catch { setEligibleOps([]); }
  }, []);

  const handleJcSelect = (jcNumber: string) => {
    setJcLookup(jcNumber);
    const jc = jcOptions.find((j) => j.jobCardNumber === jcNumber);
    if (jc) {
      const firstSubjob = jc.subjobs?.[0];
      setForm((prev) => ({
        ...prev,
        jobCardNumber: jc.jobCardNumber,
        workOrderNumber: jc.workOrderNumber || prev.workOrderNumber || '',
        partCode: jc.partCode || prev.partCode || '',
        partDescription: jc.partDescription || prev.partDescription || '',
        routeSheetNumber: jc.routeSheetNumber || prev.routeSheetNumber || '',
        machineCode: firstSubjob?.machineCode || jc.machineCode || prev.machineCode || '',
        operationCode: firstSubjob?.operationCode || prev.operationCode || '',
        productionDate: prev.productionDate || new Date().toISOString().split('T')[0],
      }));
      loadEligibleOperations(jc.jobCardNumber, Boolean(form.pendingSequenceOnly));
      toast('Job Card context loaded.');
    }
  };

  const set = (k: keyof ProductionEntryItem, v: unknown) => {
    setForm((c) => {
      const updated = { ...c, [k]: v };
      // Live stage quantity derivation: Accepted = Process Qty - Rejected Qty - Rework Qty
      if (k === 'processQty' || k === 'producedQuantity' || k === 'rejectedQuantity' || k === 'reworkQuantity') {
        const proc = Number(updated.processQty ?? updated.producedQuantity ?? 0);
        const rej = Number(updated.rejectedQuantity ?? 0);
        const rew = Number(updated.reworkQuantity ?? 0);
        updated.goodQuantity = Math.max(0, proc - rej - rew);
        updated.producedQuantity = proc;
      }
      return updated;
    });
  };

  const handleAddItem = () => {
    if (!form.workOrderNumber || !form.partCode || !form.operationCode) {
      toast('Please complete mandatory fields before adding to transaction summary.', 'error');
      return;
    }
    setAddedItems((prev) => [...prev, { ...form }]);
    toast('Added operation entry to transaction summary.');
  };

  // --- P8 Capability A: Additional (co/by-product) outputs (FR-PROD-ENTRY-003) --//
  const additionalOutputs = form.additionalOutputs ?? [];

  const addAdditionalOutput = () => {
    const lines = [...additionalOutputs, { outputType: 'CO_PRODUCT' as const, itemCode: '', location: 'STORE', quantity: 0 }];
    set('additionalOutputs', lines);
  };

  const updateAdditionalOutput = (idx: number, field: keyof AdditionalOutput, v: unknown) => {
    const lines = additionalOutputs.map((line, i) => (i === idx ? { ...line, [field]: v } : line));
    set('additionalOutputs', lines);
  };

  const removeAdditionalOutput = (idx: number) => {
    set('additionalOutputs', additionalOutputs.filter((_, i) => i !== idx));
  };

  const validateAdditionalOutputs = () => {
    if (additionalOutputs.length === 0) return true;
    const seen = new Set<string>();
    for (let i = 0; i < additionalOutputs.length; i++) {
      const line = additionalOutputs[i];
      if (!line.itemCode || !line.itemCode.trim()) {
        toast(`Additional output line ${i + 1}: Item Code is mandatory.`, 'error');
        return false;
      }
      const qty = Number(line.quantity ?? 0);
      if (!(qty > 0)) {
        toast(`Additional output line ${i + 1}: Quantity must be greater than zero.`, 'error');
        return false;
      }
      if (!line.location || !line.location.trim()) {
        toast(`Additional output line ${i + 1}: Location is mandatory.`, 'error');
        return false;
      }
      if (Number(line.weight ?? 0) < 0) {
        toast(`Additional output line ${i + 1}: Weight cannot be negative.`, 'error');
        return false;
      }
      const key = `${line.outputType}|${line.itemCode.trim()}|${line.location.trim()}`;
      if (seen.has(key)) {
        toast(`Additional output line ${i + 1}: Duplicate (type, item, location) is not allowed.`, 'error');
        return false;
      }
      seen.add(key);
    }
    return true;
  };

  const save = async (actionStatus: 'DRAFT' | 'POSTED' = 'DRAFT') => {
    if (!form.productionType) { toast('Production Type is mandatory (V-01).', 'error'); return; }
    if (!form.supervisorCode) { toast('Supervisor is mandatory (V-02).', 'error'); return; }
    if (!form.workOrderNumber && !form.jobCardNumber) { toast('Route Sheet operation context is mandatory (V-03).', 'error'); return; }
    if (!form.operationCode) { toast('Process is mandatory (V-04).', 'error'); return; }

    const procQty = Number(form.processQty ?? form.producedQuantity ?? 0);
    if (procQty <= 0) { toast('Process quantity must be greater than zero (V-05).', 'error'); return; }

    const rejQty = Number(form.rejectedQuantity ?? 0);
    if (rejQty > 0 && (!form.rejectionReasons || form.rejectionReasons.length === 0)) {
      toast('Rejection reason is mandatory when Rejected Qty > 0 (V-08).', 'error');
      setRejectionModalOpen(true);
      return;
    }

    const rewQty = Number(form.reworkQuantity ?? 0);
    if (rewQty > 0 && (!form.reworkReasons || form.reworkReasons.length === 0)) {
      toast('Rework reason is mandatory when Rework Qty > 0 (V-09).', 'error');
      setReworkModalOpen(true);
      return;
    }

    if (!validateAdditionalOutputs()) return;

    const payload: Record<string, unknown> = {
      ...form,
      version: editId ? (form.version ?? undefined) : undefined,
    };

    if (!navigator.onLine) {
      const id = await enqueue({
        type: 'production-entry',
        endpoint: editId ? `/v1/production/entries/${editId}` : '/v1/production/entries',
        method: editId ? 'PUT' : 'POST',
        body: payload,
      });
      toast(`Queued for sync (${id.id}). Will submit when online.`, 'success');
      setForm({}); setEditId(null); setTab('list');
      return;
    }

    setBusy(true);
    const submit = async (body: Record<string, unknown>) => {
      if (editId) {
        const { data } = await apiClient.put(`/v1/production/entries/${editId}`, body);
        toast('Production Entry draft updated.');
        return data as ProductionEntryItem;
      }
      const { data } = await apiClient.post('/v1/production/entries', body);
      toast('Production Entry created.');
      return data as ProductionEntryItem;
    };

    try {
      let result: ProductionEntryItem;
      try {
        result = await submit(payload);
      } catch (createError) {
        // BR (Production Module FRS §5.3): cumulative qty past the Job Card's planned
        // quantity now has a real override path (Production Supervisor/Plant Head + reason)
        // instead of just being an unconditional block.
        const code = (createError as any)?.response?.data?.code;
        if (code === 'OVERPRODUCTION_LIMIT') {
          const reason = window.prompt(
            getApiErrorMessage(createError, 'Overproduction blocked.') +
              '\n\nIf you have Production Supervisor/Plant Head authorization, enter a reason to override:'
          );
          if (!reason || !reason.trim()) throw createError;
          result = await submit({ ...payload, overrideReason: reason.trim() });
        } else {
          throw createError;
        }
      }

      if (actionStatus === 'POSTED' && result.id) {
        const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `post-${Date.now()}-${Math.random()}`;
        await apiClient.post(`/v1/production/entries/${result.id}/actions/post`, {}, {
          headers: { 'X-Idempotency-Key': idempotencyKey }
        });
        toast('Production Entry posted successfully.');
      }

      setForm({}); setEditId(null); setTab('list'); load();
    } catch (e) { toast(getApiErrorMessage(e, 'Save failed.'), 'error'); }
    setBusy(false);
  };

  const executeReversal = async () => {
    if (!reversalTarget || !reversalTarget.id) return;
    setBusy(true);
    try {
      await apiClient.post(`/v1/production/entries/${reversalTarget.id}/actions/reverse`, { reversalReason: reversalReasonText });
      toast(`Created linked reversal entry for ${reversalTarget.entryNumber}.`);
      setReversalTarget(null); setReversalReasonText(''); load();
    } catch (e) { toast(getApiErrorMessage(e, 'Reversal failed.'), 'error'); }
    setBusy(false);
  };

  const del = async () => {
    if (!deleteTarget || !deleteTarget.id) return;
    setBusy(true);
    try {
      await apiClient.delete(`/v1/production/entries/${deleteTarget.id}`);
      toast('Entry deleted.'); setDeleteTarget(null); load();
    } catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  const action = async (id: number, act: string) => {
    try {
      const reqHeaders: Record<string, string> = {};
      if (act.toLowerCase() === 'post') {
        reqHeaders['X-Idempotency-Key'] = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `post-${Date.now()}-${Math.random()}`;
      }
      await apiClient.post(`/v1/production/entries/${id}/actions/${act}`, {}, { headers: reqHeaders });
      toast(`Entry ${act}.`); load();
    } catch (e) { toast(getApiErrorMessage(e, 'Action failed.'), 'error'); }
  };

  const printDocument = (id: number | string, mode: 'print' | 'download' = 'print') => {
    const base = import.meta.env.VITE_API_BASE_URL || '/api';
    printDoc(`${base}/v1/production/entries/${id}/print?download=${mode === 'download'}`, mode);
  };

  const filtered = rows.filter((r) => {
    if (search && !(r.entryNumber ?? '').toLowerCase().includes(search.toLowerCase()) && !(r.partCode ?? '').toLowerCase().includes(search.toLowerCase()) && !(r.workOrderNumber ?? '').toLowerCase().includes(search.toLowerCase())) return false;
    if (startDate && r.productionDate && r.productionDate.slice(0, 10) < startDate) return false;
    if (endDate && r.productionDate && r.productionDate.slice(0, 10) > endDate) return false;
    if (filterPartCode && !(r.partCode ?? '').toLowerCase().includes(filterPartCode.toLowerCase())) return false;
    if (filterPartName && !(r.partDescription ?? '').toLowerCase().includes(filterPartName.toLowerCase())) return false;
    if (filterEntryNo && !(r.entryNumber ?? '').toLowerCase().includes(filterEntryNo.toLowerCase())) return false;
    if (filterRouteSheet && !(r.routeSheetNumber ?? '').toLowerCase().includes(filterRouteSheet.toLowerCase())) return false;
    if (filterMachine && r.machineCode !== filterMachine) return false;
    if (filterStatus ? r.status !== filterStatus : r.status === 'CANCELLED') return false; // Default active = excluding CANCELLED
    return true;
  });

  const procQty = Number(form.processQty ?? form.producedQuantity ?? 0);
  const goodQty = Number(form.goodQuantity ?? 0);
  const rewQty = Number(form.reworkQuantity ?? 0);
  const rejQty = Number(form.rejectedQuantity ?? 0);
  const scrapQty = Number(form.scrapQuantity ?? 0);
  const allocatedSum = goodQty + rewQty + rejQty + scrapQty;
  const balanceOk = procQty > 0 && allocatedSum <= procQty;

  return (
    <>
      <div className="pg-head">
        <h1>Production Entry {pendingCount > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8, padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d' }}><span className="material-symbols-rounded" style={{ fontSize: 14 }}>cloud_upload</span> Pending sync ({pendingCount})</span>}</h1>
        <p>Record actual shop-floor production, stage quantities, machines, operators, time & batch details</p>
      </div>

      {tab === 'form' && (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel-h"><h2>{editId ? 'Edit' : 'New'} Production Entry Transaction</h2></div>

          {/* Quick Fill section */}
          {!editId && jcOptions.length > 0 && (
            <div style={{ padding: 12, background: '#f0f7ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 18, color: '#2563eb' }}>link</span>
                <span style={{ fontWeight: 600, fontSize: 13, color: '#1e40af' }}>Select Route Sheet / Job Card Context</span>
              </div>
              <select className="in" value={jcLookup} onChange={(e) => handleJcSelect(e.target.value)}>
                <option value="">Select Job Card to auto-fill fields...</option>
                {jcOptions.map((jc) => (
                  <option key={jc.jobCardNumber} value={jc.jobCardNumber}>{jc.jobCardNumber} | {jc.partCode} | Route: {jc.routeSheetNumber || 'N/A'}</option>
                ))}
              </select>
            </div>
          )}

          <QRScanInput
            label="Scan Work Order / Job Card Barcode"
            placeholder="Scan or type WO/JC number…"
            onScan={(code) => {
              const jc = jcOptions.find((j) => j.jobCardNumber === code);
              if (jc) { handleJcSelect(code); return; }
              set('workOrderNumber', code);
              toast(`Work Order set to ${code}.`);
            }}
          />

          {/* 3.2 Header Area */}
          <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#334155' }}>1. Production Entry Header</h4>
            <div className="fgrid">
              <label className="fld"><span>Entry Type *</span>
                <select className="in" value={String(form.entryType ?? 'Production Entry')} onChange={(e) => set('entryType', e.target.value)}>
                  <option value="Production Entry">Production Entry</option>
                </select>
              </label>

              <label className="fld"><span>Production Type *</span>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', height: 38 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="radio" name="prodType" value="GENERAL" checked={form.productionType === 'GENERAL'} onChange={() => set('productionType', 'GENERAL')} /> General
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="radio" name="prodType" value="REWORK" checked={form.productionType === 'REWORK'} onChange={() => set('productionType', 'REWORK')} /> Rework
                  </label>
                </div>
              </label>

              <label className="fld"><span>Supervisor *</span>
                <select className="in" value={String(form.supervisorCode ?? '')} onChange={(e) => {
                  const s = supervisors.find((sup) => sup.code === e.target.value);
                  set('supervisorCode', e.target.value);
                  set('supervisorName', s?.name || e.target.value);
                }}>
                  <option value="">Select Supervisor...</option>
                  {supervisors.map((sup) => (
                    <option key={sup.id} value={sup.code}>{sup.name} ({sup.code})</option>
                  ))}
                </select>
              </label>

              <label className="fld"><span>Entry Date *</span><input className="in" type="date" value={String(form.productionDate ?? '').slice(0, 10)} onChange={(e) => set('productionDate', e.target.value)} /></label>
              <label className="fld"><span>Entry No (System)</span><input className="in" disabled value={form.entryNumber || 'PE-AUTO'} /></label>
              <label className="fld"><span>Financial Year</span><input className="in" disabled value={form.financialYear || 'FY 2026-27'} /></label>
            </div>
          </div>

          {/* 3.3 Route Sheet / Process Selection Area */}
          <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#334155' }}>2. Route Sheet & Process Selection</h4>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: '#1e40af', fontWeight: 500 }}>
                <input type="checkbox" checked={Boolean(form.pendingSequenceOnly)} onChange={(e) => {
                  set('pendingSequenceOnly', e.target.checked);
                  if (form.jobCardNumber) loadEligibleOperations(form.jobCardNumber, e.target.checked);
                }} /> Pending Sequence Only
              </label>
            </div>

            <div className="fgrid">
              <label className="fld"><span>Route Sheet No *</span><input className="in" value={String(form.routeSheetNumber ?? '')} onChange={(e) => set('routeSheetNumber', e.target.value)} /></label>
              <label className="fld"><span>Work Order No *</span><input className="in" value={String(form.workOrderNumber ?? '')} onChange={(e) => set('workOrderNumber', e.target.value)} /></label>
              <label className="fld"><span>Job Card No</span><input className="in" value={String(form.jobCardNumber ?? '')} onChange={(e) => set('jobCardNumber', e.target.value)} /></label>
              <label className="fld"><span>Part Code *</span><input className="in" value={String(form.partCode ?? '')} onChange={(e) => set('partCode', e.target.value)} /></label>
              <label className="fld"><span>Part Description</span><input className="in" value={String(form.partDescription ?? '')} onChange={(e) => set('partDescription', e.target.value)} /></label>

              <label className="fld"><span>Process / Operation *</span>
                {eligibleOps.length > 0 ? (
                  <select className="in" value={String(form.operationCode ?? '')} onChange={(e) => {
                    const op = eligibleOps.find((o) => o.operationCode === e.target.value);
                    set('operationCode', e.target.value);
                    if (op) {
                      set('operationSequence', op.sequenceNo);
                      if (op.machineCode) set('machineCode', op.machineCode);
                    }
                  }}>
                    <option value="">Select Process Operation...</option>
                    {eligibleOps.map((op) => (
                      <option key={op.operationCode} value={op.operationCode} disabled={!op.eligible}>
                        {op.sequenceNo}. {op.operationCode} - {op.operationDescription} ({op.eligible ? `Pending: ${op.pendingQuantity}` : 'Locked by Sequence'})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="in" placeholder="Operation Code" value={String(form.operationCode ?? '')} onChange={(e) => set('operationCode', e.target.value)} />
                )}
              </label>

              <label className="fld"><span>Primary Operator *</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select className="in" value={String(form.operatorCode ?? '')} onChange={(e) => set('operatorCode', e.target.value)}>
                    <option value="">Select Primary Operator...</option>
                    {operators.map((o) => <option key={o.id} value={o.code}>{o.code} {o.name ? `- ${o.name}` : ''}</option>)}
                  </select>
                  <button className="btn btn-sm" type="button" onClick={() => setMoModalOpen(true)}>MO ({form.operators?.length || 1})</button>
                </div>
              </label>

              <label className="fld"><span>Machine</span>
                <select className="in" value={String(form.machineCode ?? '')} onChange={(e) => set('machineCode', e.target.value)}>
                  <option value="">Select Machine...</option>
                  {machines.map((m) => <option key={m.id} value={m.code}>{m.code} {m.name ? `- ${m.name}` : ''}</option>)}
                </select>
              </label>

              <label className="fld"><span>Shift</span>
                <select className="in" value={String(form.shiftCode ?? '')} onChange={(e) => set('shiftCode', e.target.value)}>
                  <option value="">Select Shift...</option>
                  {shifts.map((s) => <option key={s.id} value={s.code}>{s.code} - {s.name}</option>)}
                </select>
              </label>

              <label className="fld"><span>Start Date-Time</span><input className="in" type="datetime-local" value={String(form.startTime ?? '')} onChange={(e) => set('startTime', e.target.value)} /></label>
              <label className="fld"><span>End Date-Time</span><input className="in" type="datetime-local" value={String(form.endTime ?? '')} onChange={(e) => set('endTime', e.target.value)} /></label>
              <label className="fld"><span>Idle Time (Mins)</span><input className="in" type="number" value={String(form.idleTime ?? 0)} onChange={(e) => set('idleTime', Number(e.target.value))} /></label>
              <label className="fld"><span>Actual Run Time (Mins)</span><input className="in" readOnly value={form.processTime != null ? String(form.processTime) : 'Computed on save'} /></label>
              <label className="fld"><span>Idle Reason</span><input className="in" placeholder="Required if Idle Time > 0" value={String(form.idleReason ?? '')} onChange={(e) => set('idleReason', e.target.value)} /></label>
            </div>
          </div>

          {/* 3.4 Material & Stage Quantity Area */}
          <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#334155' }}>3. Stage Quantity & Reason Breakdown</h4>

            <div className="fgrid" style={{ marginBottom: 12 }}>
              <label className="fld"><span>Process Qty (Total Output) *</span>
                <input className="in" type="number" value={String(form.processQty ?? form.producedQuantity ?? '')} onChange={(e) => set('processQty', Number(e.target.value))} />
              </label>
              <label className="fld"><span>Accepted Qty (Auto Derived)</span>
                <input className="in" type="number" readOnly style={{ background: '#f0fdf4', fontWeight: 600, color: '#166534' }} value={String(goodQty)} />
              </label>
              <label className="fld"><span>Rejected Qty</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="in" type="number" value={String(rejQty)} onChange={(e) => set('rejectedQuantity', Number(e.target.value))} />
                  {rejQty > 0 && <button className="btn btn-sm danger" type="button" onClick={() => setRejectionModalOpen(true)}>Reasons ({form.rejectionReasons?.length || 0})</button>}
                </div>
              </label>
              <label className="fld"><span>Rework Qty</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="in" type="number" value={String(rewQty)} onChange={(e) => set('reworkQuantity', Number(e.target.value))} />
                  {rewQty > 0 && <button className="btn btn-sm" type="button" onClick={() => setReworkModalOpen(true)}>Reasons ({form.reworkReasons?.length || 0})</button>}
                </div>
              </label>
              <label className="fld"><span>Scrap Qty</span>
                <input className="in" type="number" value={String(scrapQty)} onChange={(e) => set('scrapQuantity', Number(e.target.value))} />
              </label>
            </div>

            <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 13, background: balanceOk ? '#d4edda' : '#f8d7da', color: balanceOk ? '#155724' : '#721c24', border: `1px solid ${balanceOk ? '#c3e6cb' : '#f5c6cb'}` }}>
              <b>Stage Formula Verification (V-07):</b> Accepted ({goodQty}) + Rejected ({rejQty}) + Rework ({rewQty}) + Scrap ({scrapQty}) = <b>{allocatedSum}</b> {balanceOk ? `<= Process Qty (${procQty}) ✓` : `> Process Qty (${procQty}) ERROR`}
            </div>
          </div>

          {/* 3A. Additional Outputs (P8 Capability A — FR-PROD-ENTRY-003) */}
          <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#334155' }}>
                3A. Additional Outputs (Co/By-Products) {' '}
                <span style={{ fontWeight: 400, fontSize: 12, color: '#64748b' }}>Optional — records co-part / swarf / by-product output of this operation (recording only, no stock posting)</span>
              </h4>
              <button className="btn btn-sm" type="button" onClick={addAdditionalOutput}>+ Add Output</button>
            </div>

            {additionalOutputs.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 13, color: '#94a3b8', background: '#fff', borderRadius: 6, border: '1px dashed #cbd5e1' }}>
                No additional outputs. A machining operation that yields only the primary part stays single-output.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>S.No</th><th>Type</th><th>Item Code *</th><th>Quantity *</th><th>Location *</th><th>Weight</th><th>UoM</th><th>Dest. Stage</th><th>Remarks</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {additionalOutputs.map((line, idx) => (
                      <tr key={idx}>
                        <td>{idx + 1}</td>
                        <td>
                          <select className="in" value={line.outputType} onChange={(e) => updateAdditionalOutput(idx, 'outputType', e.target.value)}>
                            <option value="CO_PRODUCT">CO_PRODUCT</option>
                            <option value="BY_PRODUCT">BY_PRODUCT</option>
                          </select>
                        </td>
                        <td><input className="in" placeholder="Item Code" value={String(line.itemCode ?? '')} onChange={(e) => updateAdditionalOutput(idx, 'itemCode', e.target.value)} /></td>
                        <td><input className="in" type="number" value={String(line.quantity ?? '')} onChange={(e) => updateAdditionalOutput(idx, 'quantity', Number(e.target.value))} /></td>
                        <td><input className="in" value={String(line.location ?? 'STORE')} onChange={(e) => updateAdditionalOutput(idx, 'location', e.target.value)} /></td>
                        <td><input className="in" type="number" value={String(line.weight ?? '')} onChange={(e) => updateAdditionalOutput(idx, 'weight', Number(e.target.value))} /></td>
                        <td><input className="in" value={String(line.uom ?? '')} onChange={(e) => updateAdditionalOutput(idx, 'uom', e.target.value)} /></td>
                        <td><input className="in" placeholder="Next op / FG / SFG" value={String(line.destinationStageCode ?? '')} onChange={(e) => updateAdditionalOutput(idx, 'destinationStageCode', e.target.value)} /></td>
                        <td><input className="in" value={String(line.remarks ?? '')} onChange={(e) => updateAdditionalOutput(idx, 'remarks', e.target.value)} /></td>
                        <td><button className="ibtn danger" title="Remove output" onClick={() => removeAdditionalOutput(idx)}><span className="material-symbols-rounded">delete</span></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 3.5 Added Items / Posting Summary Grid */}
          <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#334155' }}>4. Transaction Summary Grid</h4>
              <button className="btn btn-sm btn-p" type="button" onClick={handleAddItem}>+ Add Operation Item</button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>S.No</th><th>Route Sheet</th><th>Part Code</th><th>Operation</th><th>Process Qty</th><th>Accepted</th><th>Rejected</th><th>Rework</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {addedItems.length === 0 ? (
                    <tr><td colSpan={9} style={{ textAlign: 'center', padding: 16, color: '#94a3b8' }}>Current operation staged. Click "+ Add Operation Item" to stack multiple operation results.</td></tr>
                  ) : addedItems.map((item, idx) => (
                    <tr key={idx}>
                      <td>{idx + 1}</td>
                      <td>{item.routeSheetNumber || '-'}</td>
                      <td>{item.partCode}</td>
                      <td>{item.operationCode}</td>
                      <td>{item.processQty}</td>
                      <td style={{ color: '#22c55e' }}>{item.goodQuantity}</td>
                      <td style={{ color: '#ef4444' }}>{item.rejectedQuantity}</td>
                      <td style={{ color: '#f59e0b' }}>{item.reworkQuantity}</td>
                      <td>
                        <button className="ibtn danger" onClick={() => setAddedItems((prev) => prev.filter((_, i) => i !== idx))}><span className="material-symbols-rounded">delete</span></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="actbar">
            <div className="lft">
              <button className="btn btn-sm" onClick={backToList} disabled={busy}><span className="material-symbols-rounded">arrow_back</span> Back</button>
            </div>
            <div className="rgt" style={{ display: 'flex', gap: 8 }}>
              {editId && <button className="btn btn-sm" onClick={() => { setForm({}); setEditId(null); setTab('list'); }} disabled={busy}>Cancel</button>}
              {can('production', 'Edit') && <button className="btn btn-sm" onClick={() => save('DRAFT')} disabled={busy}>Save Draft</button>}
              {can('production', 'Edit') && <button className="btn btn-sm btn-p" onClick={() => save('POSTED')} disabled={busy}>Final Post</button>}
            </div>
          </div>
        </div>
      )}

      {tab === 'list' && (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* §3.1 Filter Bar */}
          <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1e293b' }}>Production Entries Filter</h3>
              <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
                <button className="btn btn-sm" onClick={() => setSummaryMenuOpen(!summaryMenuOpen)}>
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>menu</span> Report Options
                </button>
                {summaryMenuOpen && (
                  <div style={{ position: 'absolute', right: 0, top: 38, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', zIndex: 100, width: 220, overflow: 'hidden' }}>
                    <button style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }} onClick={() => { setSummaryReportType('rejection'); setSummaryMenuOpen(false); }}>Rejection Summary</button>
                    <button style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }} onClick={() => { setSummaryReportType('rework'); setSummaryMenuOpen(false); }}>Rework Summary</button>
                    <button style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }} onClick={() => { setSummaryReportType('idle'); setSummaryMenuOpen(false); }}>Idle Reason Production</button>
                    <button style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }} onClick={() => { setSummaryReportType('machine'); setSummaryMenuOpen(false); }}>Machine-wise Production</button>
                    <button style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }} onClick={() => { setSummaryReportType('operator'); setSummaryMenuOpen(false); }}>Operator-wise Production</button>
                  </div>
                )}
                <button className="ibtn" title="Export Excel" onClick={() => exportToCsv(filtered as unknown as Record<string, unknown>[], [], 'production-entries-export')}><span className="material-symbols-rounded">download</span> Export XLSX</button>
                <button className="btn btn-p" onClick={() => { setForm({ entryType: 'Production Entry', productionType: 'GENERAL', pendingSequenceOnly: true, processQty: 0, goodQuantity: 0, reworkQuantity: 0, rejectedQuantity: 0 }); setEditId(null); setTab('form'); }} disabled={!can('production', 'Edit')}>+ Create New</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <label className="fld"><span>Date From (&gt;=)</span><input className="in" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
              <label className="fld"><span>Date To (&lt;=)</span><input className="in" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
              <label className="fld"><span>Part Code</span><input className="in" placeholder="Filter Part Code" value={filterPartCode} onChange={(e) => setFilterPartCode(e.target.value)} /></label>
              <label className="fld"><span>Entry No</span><input className="in" placeholder="Filter Entry No" value={filterEntryNo} onChange={(e) => setFilterEntryNo(e.target.value)} /></label>
              <label className="fld"><span>Route Sheet</span><input className="in" placeholder="Filter Route Sheet" value={filterRouteSheet} onChange={(e) => setFilterRouteSheet(e.target.value)} /></label>
              <label className="fld"><span>Machine</span>
                <select className="in" value={filterMachine} onChange={(e) => setFilterMachine(e.target.value)}>
                  <option value="">All Machines</option>
                  {machines.map((m) => <option key={m.id} value={m.code}>{m.code}</option>)}
                </select>
              </label>
              <label className="fld"><span>Status</span>
                <select className="in" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="">All Statuses</option>
                  <option value="DRAFT">DRAFT</option>
                  <option value="POSTED">POSTED</option>
                  <option value="SUBMITTED">SUBMITTED</option>
                  <option value="APPROVED">APPROVED</option>
                  <option value="REVERSED">REVERSED</option>
                </select>
              </label>
            </div>
          </div>

          <div className="twrap">
            {loading ? <div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading...</div> : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="num">S.No</th><th>Entry No</th><th>Type</th><th>Work Order</th><th>Part Code</th><th>Machine</th><th>Operator</th><th>Process Qty</th><th>Accepted</th><th>Scrap</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? <tr><td colSpan={12}><div className="empty"><span className="material-symbols-rounded">description</span> No matching production entries.</div></td></tr> : filtered.map((r, idx) => (
                    <tr key={r.id}>
                      <td className="num mut">{idx + 1}</td>
                      <td><b>{r.entryNumber}</b>{r.cycleTimeVarianceFlagged && (
                        <span title="Actual Run Time exceeded standard cycle time beyond tolerance" style={{ marginLeft: 6, display: 'inline-flex', padding: '1px 6px', fontSize: 11, borderRadius: 8, background: '#fef3c7', color: '#92400e' }}>
                          <span className="material-symbols-rounded" style={{ fontSize: 13 }}>timer_off</span>
                        </span>
                      )}</td>
                      <td><span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: r.productionType === 'REWORK' ? '#fef3c7' : '#f1f5f9', color: r.productionType === 'REWORK' ? '#92400e' : '#475569' }}>{r.productionType || 'GENERAL'}</span></td>
                      <td>{r.workOrderNumber}</td>
                      <td>{r.partCode}</td>
                      <td>{r.machineCode ?? '-'}</td>
                      <td>{r.operatorCode ?? '-'}</td>
                      <td>{r.processQty || r.producedQuantity}{Array.isArray(r.additionalOutputs) && r.additionalOutputs.length > 0 && <span style={{ display: 'inline-flex', marginLeft: 6, padding: '1px 6px', fontSize: 11, borderRadius: 8, background: '#ede9fe', color: '#6d28d9' }}>{r.additionalOutputs.length} addl.</span>}</td>
                      <td style={{ color: '#22c55e', fontWeight: 600 }}>{r.goodQuantity}</td>
                      <td style={{ color: Number(r.scrapQuantity) > 0 ? '#ef4444' : undefined }}>{r.scrapQuantity}</td>
                      <td><StatusBadge status={r.status || 'DRAFT'} variant={SC} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {r.status === 'DRAFT' && can('production', 'Edit') && <button className="ibtn" title="Submit" onClick={() => r.id && action(r.id, 'submit')}><span className="material-symbols-rounded">send</span></button>}
                        {r.status === 'SUBMITTED' && <>{can('production', 'Approve') && <button className="ibtn" title="Approve" onClick={() => r.id && action(r.id, 'approve')}><span className="material-symbols-rounded">check_circle</span></button>}</>}
                        {r.status === 'POSTED' && <button className="ibtn danger" title="Reverse / Correct Entry" onClick={() => setReversalTarget(r)}><span className="material-symbols-rounded">undo</span></button>}
                        {r.status !== 'POSTED' && can('production', 'Edit') && <button className="ibtn" title="Edit" onClick={() => { setForm(r); setEditId(r.id || null); setTab('form'); }}><span className="material-symbols-rounded">edit</span></button>}
                        <button className="ibtn" title="Print" onClick={() => r.id && printDocument(r.id, 'print')}><span className="material-symbols-rounded">print</span></button>
                        <button className="ibtn" title="Download PDF" onClick={() => r.id && printDocument(r.id, 'download')}><span className="material-symbols-rounded">download</span></button>
                        {r.status === 'DRAFT' && can('production', 'Delete') && <button className="ibtn danger" title="Delete" onClick={() => setDeleteTarget(r)}><span className="material-symbols-rounded">delete</span></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <MultipleOperatorsModal open={moModalOpen} onClose={() => setMoModalOpen(false)} operators={form.operators || []} masterOperators={operators} onSave={(ops) => set('operators', ops)} />
      <RejectionReasonModal open={rejectionModalOpen} onClose={() => setRejectionModalOpen(false)} targetRejectedQty={Number(form.rejectedQuantity || 0)} rejectionReasons={form.rejectionReasons || []} onSave={(rejs) => set('rejectionReasons', rejs)} />
      <ReworkReasonModal open={reworkModalOpen} onClose={() => setReworkModalOpen(false)} targetReworkQty={Number(form.reworkQuantity || 0)} reworkReasons={form.reworkReasons || []} availableProcesses={eligibleOps.map((o) => o.operationCode)} onSave={(rews) => set('reworkReasons', rews)} />
      <ProductionSummaryReportModal open={Boolean(summaryReportType)} onClose={() => setSummaryReportType(null)} reportType={summaryReportType || 'rejection'} />

      <ConfirmActionModal open={Boolean(deleteTarget)} title={`Delete ${deleteTarget?.entryNumber ?? ''}`} body="Permanently delete this Production Entry draft?" okLabel="Delete" danger busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={del} />

      {/* Reversal Confirmation Modal */}
      {reversalTarget && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div className="modal-card" style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 480, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 18, color: '#7c3aed' }}>Reverse Posted Production Entry ({reversalTarget.entryNumber})</h3>
            <p style={{ fontSize: 13, color: '#475569', marginBottom: 16 }}>Posted entries are immutable (V-22). Executing reversal will create an offset transaction and adjust completed quantities.</p>

            <label className="fld" style={{ marginBottom: 16 }}>
              <span>Reversal / Correction Reason *</span>
              <input className="in" placeholder="Specify reason for correction..." value={reversalReasonText} onChange={(e) => setReversalReasonText(e.target.value)} />
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-sm" onClick={() => setReversalTarget(null)}>Cancel</button>
              <button className="btn btn-sm btn-p" style={{ background: '#7c3aed', borderColor: '#6d28d9' }} onClick={executeReversal} disabled={!reversalReasonText.trim() || busy}>Confirm Reversal</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
