import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../../api/axiosClient';
import { productionApi } from '../../../services/production-api';
import type { JobCard, JobCardSubjob } from '../../../types/production/production.types';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';
import StatusBadge from '../../../components/common/StatusBadge';
import AuditHistoryDrawer from '../../../components/common/AuditHistoryDrawer';
import { printDocument as printDoc } from '../../../utils/printDocument';
import { exportToCsv } from '../../../utils/csvExport';
import { useTabs } from '../../../contexts/TabsContext';

interface CompletionCheck {
  jobCardNumber: string;
  canComplete: boolean;
  checks: { check: string; passed: boolean; detail: string }[];
}

const SC: Record<string, { color: string; bg: string }> = {
  DRAFT: { color: '#888', bg: '#e9ecef' }, RELEASED: { color: '#2563eb', bg: '#dbeafe' },
  IN_PROGRESS: { color: '#f59e0b', bg: '#fef3c7' }, ON_HOLD: { color: '#ef4444', bg: '#f8d7da' },
  COMPLETED: { color: '#22c55e', bg: '#d4edda' }, CLOSED: { color: '#6b7280', bg: '#f3f4f6' },
  CANCELLED: { color: '#991b1b', bg: '#fde2e2' }, PENDING: { color: '#888', bg: '#e9ecef' },
  QUALITY_HOLD: { color: '#7c3aed', bg: '#ede9fe' },
};

export default function JobCardScreen({ initialSearch }: { initialSearch?: string }) {
  const { toast } = useToast();
  const { can } = useAuth();
  const { closeTab } = useTabs();
  const backToList = () => closeTab('job-card');
  const [rows, setRows] = useState<JobCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [subActionBusyId, setSubActionBusyId] = useState<number | null>(null);
  const [search, setSearch] = useState(initialSearch ?? '');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [subjobs, setSubjobs] = useState<JobCardSubjob[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [subForm, setSubForm] = useState<Record<string, unknown>>({});
  const [editSubId, setEditSubId] = useState<number | null>(null);
  const [deleteSubTarget, setDeleteSubTarget] = useState<JobCardSubjob | null>(null);
  const [tab, setTab] = useState<'list' | 'form' | 'from-wo'>('list');
  const [woNumber, setWoNumber] = useState('');
  const [compCheck, setCompCheck] = useState<CompletionCheck | null>(null);
  const [showCompCheck, setShowCompCheck] = useState(false);
  const [actionNote, setActionNote] = useState('');
  const [actionTarget, setActionTarget] = useState<{ id: number; action: string } | null>(null);
  const [openActionMenu, setOpenActionMenu] = useState<number | null>(null);
  const [machines, setMachines] = useState<Array<{ code: string; name: string }>>([]);
  const [users, setUsers] = useState<Array<{ username: string; fullName: string }>>([]);
  const [workCenters, setWorkCenters] = useState<Array<{ code: string; name: string }>>([]);
  const [shifts, setShifts] = useState<Array<{ code: string; name: string }>>([]);
  const [workOrdersList, setWorkOrdersList] = useState<Array<any>>([]);
  const [fetchingWo, setFetchingWo] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  const fetchMasters = useCallback(async () => {
    try {
      const [mRes, uRes, wRes, sRes, woRes] = await Promise.allSettled([
        apiClient.get('/master/machines', { params: { size: 200 } }),
        apiClient.get('/master/users', { params: { size: 200 } }),
        apiClient.get('/master/work-centers', { params: { size: 100 } }),
        apiClient.get('/master/shifts', { params: { size: 100 } }),
        apiClient.get('/v1/planning/work-order', { params: { size: 200 } }),
      ]);
      if (mRes.status === 'fulfilled') setMachines((mRes.value.data?.content ?? mRes.value.data ?? []).filter((m: any) => m.active !== false));
      if (uRes.status === 'fulfilled') setUsers((uRes.value.data?.content ?? uRes.value.data ?? []).filter((u: any) => u.active !== false));
      if (wRes.status === 'fulfilled') setWorkCenters(wRes.value.data?.content ?? wRes.value.data ?? []);
      if (sRes.status === 'fulfilled') setShifts(sRes.value.data?.content ?? sRes.value.data ?? []);
      if (woRes.status === 'fulfilled') {
        const raw = woRes.value.data;
        const list = Array.isArray(raw) ? raw : (raw?.data ?? raw?.content ?? []);
        setWorkOrdersList(list);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchMasters(); }, [fetchMasters]);

  const load = async () => {
    setLoading(true);
    try {
      const page = await productionApi.listJobCards({ page: 0, size: 1000 });
      setRows(Array.isArray(page) ? page : (page.content ?? []));
    } catch (e) { toast(getApiErrorMessage(e, 'Load failed.'), 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Auto-fetch Work Order data when a Work Order number is selected or typed
  const handleWorkOrderSelect = async (selectedWoNo: string) => {
    setForm((c) => ({ ...c, workOrderNumber: selectedWoNo }));
    if (!selectedWoNo.trim()) return;

    setFetchingWo(true);
    try {
      // Look up in loaded work orders list first
      let matched = workOrdersList.find(
        (w) =>
          String(w.docNo ?? w.woNumber ?? '').toLowerCase() === selectedWoNo.trim().toLowerCase() ||
          String(w.woNumber ?? '').toLowerCase() === selectedWoNo.trim().toLowerCase()
      );

      // If not in cache, query backend API
      if (!matched) {
        const { data } = await apiClient.get('/v1/planning/work-order', {
          params: { search: selectedWoNo.trim(), size: 10 },
        });
        const list = Array.isArray(data) ? data : (data?.data ?? data?.content ?? []);
        matched = list.find(
          (w: any) =>
            String(w.docNo ?? w.woNumber ?? '').toLowerCase() === selectedWoNo.trim().toLowerCase() ||
            String(w.woNumber ?? '').toLowerCase() === selectedWoNo.trim().toLowerCase()
        );
        if (!matched && list.length > 0) matched = list[0];
      }

      if (matched) {
        setForm((prev) => ({
          ...prev,
          workOrderNumber: matched.docNo || matched.woNumber || selectedWoNo,
          partCode: matched.itemCode || matched.partCode || prev.partCode || '',
          partDescription: matched.itemDescription || matched.partDescription || matched.itemCode || prev.partDescription || '',
          revision: matched.itemRevision || matched.revision || prev.revision || '',
          plannedQuantity: matched.orderQuantity ?? matched.plannedQuantity ?? matched.quantity ?? prev.plannedQuantity ?? 0,
          priority: matched.priority || prev.priority || 'MEDIUM',
          plannedStartDate: matched.plannedStartDate ? String(matched.plannedStartDate).slice(0, 10) : prev.plannedStartDate || '',
          plannedEndDate: matched.dueDate ? String(matched.dueDate).slice(0, 10) : matched.plannedEndDate ? String(matched.plannedEndDate).slice(0, 10) : prev.plannedEndDate || '',
          routeSheetNumber: matched.routeSheetCode || matched.routeCode || matched.routeSheetNumber || prev.routeSheetNumber || '',
          bomNumber: matched.bomCode || matched.bomNumber || prev.bomNumber || '',
          customerCode: matched.customerCode || prev.customerCode || '',
        }));
        toast(`Auto-fetched details for Work Order ${matched.docNo || matched.woNumber}`);
      } else {
        toast(`Work Order '${selectedWoNo}' not found in database`, 'error');
      }
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to fetch Work Order details.'), 'error');
    } finally {
      setFetchingWo(false);
    }
  };

  const save = async () => {
    if (!String(form.partCode ?? '').trim()) { toast('Part Code is required.', 'error'); return; }
    if (!form.plannedQuantity) { toast('Planned Quantity is required.', 'error'); return; }
    setBusy(true);
    try {
      if (editId) {
        await productionApi.updateJobCard(editId, form);
        toast('Job Card updated.');
      } else {
        await productionApi.createJobCard(form);
        toast('Job Card created.');
      }
      // Land back on a fresh blank entry form (same state "+ Manual" opens)
      // rather than the list, so the next Job Card can be entered right away.
      setForm({}); setEditId(null); setTab('form'); load();
    } catch (e) { toast(getApiErrorMessage(e, 'Save failed.'), 'error'); }
    setBusy(false);
  };

  const createFromWO = async () => {
    if (!woNumber.trim()) { toast('Work Order Number is required.', 'error'); return; }
    setBusy(true);
    try {
      const data = (await productionApi.createJobCardFromWorkOrder(woNumber)) as { success?: boolean; errors?: string[]; jobCardNumber?: string; jobCard?: { jobCardNumber?: string } };
      if (data.success === false) {
        toast(data.errors?.join(', ') || 'Failed to create from Work Order.', 'error');
      } else {
        toast(`Job Card ${data.jobCardNumber || data.jobCard?.jobCardNumber} created from Work Order.`);
        setWoNumber(''); load();
      }
    } catch (e) { toast(getApiErrorMessage(e, 'Create from WO failed.'), 'error'); }
    setBusy(false);
  };

  const del = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await productionApi.deleteJobCard(deleteTarget.id);
      toast('Job Card deleted.'); setDeleteTarget(null); load();
    } catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  const action = async (id: number, act: string, note?: string) => {
    if (busy) return; // double-submit guard (duplicate action re-fire)
    setBusy(true);
    try {
      const data = (await productionApi.jobCardAction(id, act, note)) as { success?: boolean; errors?: string[] };
      if (data.success === false) {
        toast(data.errors?.join('\n') || 'Action failed.', 'error');
      } else {
        toast(`Job Card ${act}.`);
        load();
        if (expandedId) loadSubjobs(id);
      }
    } catch (e) { toast(getApiErrorMessage(e, 'Action failed.'), 'error'); }
    setBusy(false);
  };

  const loadCompCheck = async (id: number) => {
    try {
      const data = (await productionApi.completionCheck(id)) as CompletionCheck;
      setCompCheck(data);
      setShowCompCheck(true);
    } catch (e) { toast(getApiErrorMessage(e, 'Completion check failed.'), 'error'); }
  };

  const loadSubjobs = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); setSubjobs([]); return; }
    setExpandedId(id);
    setLoadingSubs(true);
    try {
      const data = await productionApi.listJobCardSubjobs(id);
      setSubjobs(Array.isArray(data) ? data : (data as unknown as { content?: JobCardSubjob[] }).content ?? []);
    } catch (e) { toast(getApiErrorMessage(e, 'Failed to load subjobs.'), 'error'); setSubjobs([]); }
    setLoadingSubs(false);
  };

  const saveSub = async () => {
    if (!expandedId) return;
    if (!String(subForm.operationCode ?? '').trim()) { toast('Operation Code is required.', 'error'); return; }
    setBusy(true);
    try {
      if (editSubId) {
        await productionApi.updateJobCardSubjob(editSubId, subForm);
        toast('Subjob updated.');
      } else {
        await productionApi.createJobCardSubjob(expandedId, subForm);
        toast('Subjob added.');
      }
      setSubForm({}); setEditSubId(null); loadSubjobs(expandedId);
    } catch (e) { toast(getApiErrorMessage(e, 'Save failed.'), 'error'); }
    setBusy(false);
  };

  const delSub = async () => {
    if (!deleteSubTarget) return;
    setBusy(true);
    try {
      await productionApi.deleteJobCardSubjob(deleteSubTarget.id);
      toast('Subjob deleted.'); setDeleteSubTarget(null);
      if (expandedId) loadSubjobs(expandedId);
    } catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  const subAction = async (lineId: number, act: string) => {
    if (subActionBusyId !== null) return;
    setSubActionBusyId(lineId);
    try {
      await productionApi.jobCardSubjobAction(lineId, act);
      toast(`Subjob ${act}.`); if (expandedId) loadSubjobs(expandedId);
    } catch (e) { toast(getApiErrorMessage(e, 'Action failed.'), 'error'); }
    setSubActionBusyId(null);
  };

  const set = (k: string, v: unknown) => setForm((c) => ({ ...c, [k]: v }));
  const setSub = (k: string, v: unknown) => setSubForm((c) => ({ ...c, [k]: v }));

  const printDocument = (id: number | string, mode: 'print' | 'download' = 'print') => {
    const base = import.meta.env.VITE_API_BASE_URL || '/api';
    printDoc(`${base}/v1/production/job-cards/${id}/print?download=${mode === 'download'}`, mode);
  };

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (r.jobCardNumber ?? '').toLowerCase().includes(q) || (r.partCode ?? '').toLowerCase().includes(q) || (r.workOrderNumber ?? '').toLowerCase().includes(q);
  });

  return (
    <>
      <div className="pg-head"><h1>Job Card</h1><p>Shop floor execution - Job entry, subjobs & completion</p></div>

      {/* ========= CREATE FROM WORK ORDER ========= */}
      {tab === 'from-wo' && (
        <div className="panel">
          <div className="panel-h"><h2>Create Job Card from Work Order</h2></div>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px' }}>
            Select or enter an approved Work Order number. The system will auto-populate part details, BOM, Route Sheet, and create subjobs from route operations.
          </p>
          <div className="fgrid" style={{ gridTemplateColumns: '1fr auto' }}>
            <label className="fld"><span>Work Order Number *</span>
              <input
                className="in"
                placeholder="Select or enter Work Order..."
                list="wo-options-create"
                value={woNumber}
                onChange={(e) => setWoNumber(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createFromWO(); }}
                autoFocus
              />
              <datalist id="wo-options-create">
                {workOrdersList.map((w: any) => {
                  const num = w.docNo || w.woNumber;
                  return (
                    <option key={w.id || num} value={num}>
                      {num} - {w.itemCode || ''} ({w.orderQuantity || 0} pcs)
                    </option>
                  );
                })}
              </datalist>
            </label>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <button className="btn btn-p" onClick={createFromWO} disabled={busy || !woNumber.trim()}>
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>add_task</span> Create Job Card
              </button>
            </div>
          </div>
          <div className="actbar">
            <div className="lft">
              <button className="btn btn-sm" onClick={backToList}><span className="material-symbols-rounded">arrow_back</span> Back</button>
            </div>
          </div>
        </div>
      )}

      {/* ========= MANUAL FORM WITH WORK ORDER AUTO-FETCH ========= */}
      {tab === 'form' && (
        <div className="panel">
          <div className="panel-h">
            <h2>{editId ? 'Edit' : 'New'} Job Card</h2>
            {editId && (
              <button type="button" className="btn btn-sm" title="Audit History" onClick={() => setAuditOpen(true)}>
                <span className="material-symbols-rounded">history</span> Audit
              </button>
            )}
          </div>
          <div className="fgrid">
            <label className="fld">
              <span>Work Order No</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="in"
                  placeholder="Select or type Work Order No..."
                  list="wo-options-form"
                  value={String(form.workOrderNumber ?? '')}
                  onChange={(e) => {
                    const val = e.target.value;
                    set('workOrderNumber', val);
                    handleWorkOrderSelect(val);
                  }}
                />
                <datalist id="wo-options-form">
                  {workOrdersList.map((w: any) => {
                    const num = w.docNo || w.woNumber;
                    return (
                      <option key={w.id || num} value={num}>
                        {num} - {w.itemCode || ''} ({w.orderQuantity || 0} pcs)
                      </option>
                    );
                  })}
                </datalist>
                <button
                  type="button"
                  className="btn btn-sm"
                  title="Auto Fetch Work Order Details"
                  onClick={() => handleWorkOrderSelect(String(form.workOrderNumber ?? ''))}
                  disabled={fetchingWo}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
                    {fetchingWo ? 'progress_activity' : 'sync'}
                  </span>{' '}
                  Auto Fetch
                </button>
              </div>
            </label>

            <label className="fld"><span>Part Code *</span><input className="in" value={String(form.partCode ?? '')} onChange={(e) => set('partCode', e.target.value)} /></label>
            <label className="fld"><span>Part Description</span><input className="in" value={String(form.partDescription ?? '')} onChange={(e) => set('partDescription', e.target.value)} /></label>
            <label className="fld"><span>Revision</span><input className="in" value={String(form.revision ?? '')} onChange={(e) => set('revision', e.target.value)} /></label>
            <label className="fld"><span>Planned Qty *</span><input className="in" type="number" value={String(form.plannedQuantity ?? '')} onChange={(e) => set('plannedQuantity', Number(e.target.value))} /></label>
            <label className="fld"><span>Priority</span>
              <select className="in" value={String(form.priority ?? 'MEDIUM')} onChange={(e) => set('priority', e.target.value)}>
                <option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option>
              </select>
            </label>
            <label className="fld"><span>Planned Start Date</span><input className="in" type="date" value={String(form.plannedStartDate ?? '').slice(0, 10)} onChange={(e) => set('plannedStartDate', e.target.value)} /></label>
            <label className="fld"><span>Planned End Date</span><input className="in" type="date" value={String(form.plannedEndDate ?? '').slice(0, 10)} onChange={(e) => set('plannedEndDate', e.target.value)} /></label>
            <label className="fld"><span>Shift</span>
              <select className="in" value={String(form.shiftCode ?? '')} onChange={(e) => set('shiftCode', e.target.value)}>
                <option value="">Select shift...</option>
                {shifts.map((s) => <option key={s.code} value={s.code}>{s.code} - {s.name}</option>)}
              </select>
            </label>
            <label className="fld"><span>Route Sheet No</span><input className="in" value={String(form.routeSheetNumber ?? '')} onChange={(e) => set('routeSheetNumber', e.target.value)} /></label>
            <label className="fld"><span>Production BOM No</span><input className="in" value={String(form.bomNumber ?? '')} onChange={(e) => set('bomNumber', e.target.value)} /></label>
            <label className="fld"><span>Customer Code</span><input className="in" value={String(form.customerCode ?? '')} onChange={(e) => set('customerCode', e.target.value)} /></label>
            <label className="fld"><span>Remarks</span><input className="in" value={String(form.remarks ?? '')} onChange={(e) => set('remarks', e.target.value)} /></label>
          </div>
          <div className="actbar">
            <div className="lft">
              <button className="btn btn-sm" onClick={backToList} disabled={busy}><span className="material-symbols-rounded">arrow_back</span> Back</button>
            </div>
            <div className="rgt">
              {editId && <button className="btn btn-sm" onClick={() => { setForm({}); setEditId(null); setTab('list'); }} disabled={busy}>Cancel</button>}
              <button className="btn btn-sm btn-p" onClick={save} disabled={busy}>{editId ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ========= LIST ========= */}
      {tab === 'list' && (
        <div className="panel">
          <div className="toolbar">
            <input className="in" placeholder="Search job cards..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="ibtn" title="Export CSV" onClick={() => exportToCsv(filtered as unknown as Record<string, unknown>[], [
                { key: 'jobCardNumber', label: 'JC No' },
                { key: 'workOrderNumber', label: 'WO No' },
                { key: 'partCode', label: 'Part' },
                { key: 'plannedQuantity', label: 'Planned' },
                { key: 'completedQuantity', label: 'Completed' },
                { key: 'reworkQuantity', label: 'Rework' },
                { key: 'scrapQuantity', label: 'Scrap' },
                { key: 'status', label: 'Status' },
              ], 'job-cards')}><span className="material-symbols-rounded">download</span></button>
              <button className="btn btn-p" onClick={() => setTab('from-wo')}>
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>add_task</span> Create from WO
              </button>
              <button className="btn" onClick={() => { setForm({}); setEditId(null); setTab('form'); }}>+ Manual</button>
            </div>
          </div>
          <div className="twrap">
            {loading ? (
              <div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading...</div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="num">S.No</th>
                    <th style={{ width: 40 }}></th>
                    <th>Job Card No</th>
                    <th>Work Order</th>
                    <th>Part Code</th>
                    <th>Planned</th>
                    <th>Completed</th>
                    <th>Rework</th>
                    <th>Scrap</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={12}><div className="empty"><span className="material-symbols-rounded">description</span> No job cards.</div></td></tr>
                  ) : filtered.map((r, rIdx) => (
                    <React.Fragment key={r.id}>
                      <tr onClick={() => loadSubjobs(r.id)} style={{ cursor: 'pointer' }}>
                        <td className="num mut">{rIdx + 1}</td>
                        <td><span className="material-symbols-rounded">{expandedId === r.id ? 'expand_less' : 'expand_more'}</span></td>
                        <td><b>{r.jobCardNumber}</b></td>
                        <td>{r.workOrderNumber ?? '-'}</td>
                        <td>{r.partCode}</td>
                        <td>{r.plannedQuantity}</td>
                        <td style={{ color: '#22c55e', fontWeight: 600 }}>{r.completedQuantity}</td>
                        <td style={{ color: (r.reworkQuantity ?? 0) > 0 ? '#f59e0b' : undefined }}>{r.reworkQuantity}</td>
                        <td style={{ color: (r.scrapQuantity ?? 0) > 0 ? '#ef4444' : undefined }}>{r.scrapQuantity}</td>
                        <td>{r.priority ?? '-'}</td>
                        <td><StatusBadge status={r.status} variant={SC} /></td>
                        <td style={{ position: 'relative' }}>
                          <button className="ibtn" title="Actions" onClick={(e) => { e.stopPropagation(); setOpenActionMenu(openActionMenu === r.id ? null : r.id); }}>
                            <span className="material-symbols-rounded">more_vert</span>
                          </button>
                          {openActionMenu === r.id && (
                            <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 20, background: 'var(--card-bg, #fff)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', minWidth: 180, padding: '4px 0' }} onClick={(e) => e.stopPropagation()}>
                              {r.status === 'DRAFT' && can('production', 'Approve') && (
                                <>
                                  <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--blue-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')} onClick={() => { setOpenActionMenu(null); action(r.id, 'approve'); }}><span className="material-symbols-rounded" style={{ fontSize: 18, color: '#16a34a' }}>check_circle</span> Approve Job Card</button>
                                  <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--blue-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')} onClick={() => { setOpenActionMenu(null); action(r.id, 'release'); }}><span className="material-symbols-rounded" style={{ fontSize: 18, color: '#2563eb' }}>play_arrow</span> Release Job</button>
                                </>
                              )}
                              {r.status === 'RELEASED' && <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--blue-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')} onClick={() => { setOpenActionMenu(null); action(r.id, 'start'); }}><span className="material-symbols-rounded" style={{ fontSize: 18, color: '#f59e0b' }}>play_circle</span> Start Production</button>}
                              {(r.status === 'RELEASED' || r.status === 'IN_PROGRESS') && <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--blue-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')} onClick={() => { setOpenActionMenu(null); setActionTarget({ id: r.id, action: 'hold' }); }}><span className="material-symbols-rounded" style={{ fontSize: 18, color: '#ef4444' }}>pause</span> Hold</button>}
                              {r.status === 'IN_PROGRESS' && <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--blue-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')} onClick={() => { setOpenActionMenu(null); loadCompCheck(r.id); }}><span className="material-symbols-rounded" style={{ fontSize: 18, color: '#22c55e' }}>check_circle</span> Complete</button>}
                              {r.status === 'ON_HOLD' && <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--blue-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')} onClick={() => { setOpenActionMenu(null); action(r.id, 'resume'); }}><span className="material-symbols-rounded" style={{ fontSize: 18, color: '#2563eb' }}>play_circle</span> Resume</button>}
                              {r.status === 'COMPLETED' && <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--blue-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')} onClick={() => { setOpenActionMenu(null); action(r.id, 'close'); }}><span className="material-symbols-rounded" style={{ fontSize: 18, color: '#6b7280' }}>lock</span> Close Job</button>}
                              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                              <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--blue-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')} onClick={() => { setOpenActionMenu(null); printDocument(r.id, 'print'); }}><span className="material-symbols-rounded" style={{ fontSize: 18 }}>print</span> Print</button>
                              <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--blue-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')} onClick={() => { setOpenActionMenu(null); printDocument(r.id, 'download'); }}><span className="material-symbols-rounded" style={{ fontSize: 18 }}>download</span> Download PDF</button>
                              <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--blue-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')} onClick={() => { setOpenActionMenu(null); setForm(r as unknown as Record<string, unknown>); setEditId(r.id); setTab('form'); }}><span className="material-symbols-rounded" style={{ fontSize: 18 }}>edit</span> Edit</button>
                              {r.status === 'DRAFT' && <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left', color: '#ef4444' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')} onClick={() => { setOpenActionMenu(null); setDeleteTarget(r); }}><span className="material-symbols-rounded" style={{ fontSize: 18 }}>delete</span> Delete</button>}
                            </div>
                          )}
                        </td>
                      </tr>
                      {expandedId === r.id && (
                        <tr key={`${r.id}-subs`}>
                          <td colSpan={12}>
                            <div style={{ background: 'var(--card-bg, #f9fafb)', padding: 12, borderBottom: '1px solid var(--border)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                                <h4 style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Subjobs / Operations ({subjobs.length})</h4>
                                {(r.status === 'DRAFT' || r.status === 'RELEASED') && (
                                  <button className="btn btn-sm" onClick={() => { setSubForm({}); setEditSubId(null); }}>+ Add Subjob</button>
                                )}
                              </div>
                              {loadingSubs ? <div className="empty">Loading...</div> : subjobs.length === 0 ? <div className="empty">No subjobs. Add operations or create from Work Order.</div> : (
                                <table className="tbl">
                                  <thead><tr><th>Seq</th><th>Subjob No</th><th>Operation</th><th>Machine</th><th>Work Center</th><th>Operator</th><th>Planned</th><th>Completed</th><th>Rework</th><th>Reject</th><th>Scrap</th><th>Status</th><th>Actions</th></tr></thead>
                                  <tbody>
                                    {subjobs.map((s) => (
                                      <tr key={s.id}>
                                        <td>{s.sequenceNo}</td>
                                        <td><b>{s.subjobNumber}</b></td>
                                        <td>{s.operationCode} - {s.operationDescription ?? ''}</td>
                                        <td>{s.machineCode ?? '-'}</td>
                                        <td>{s.workCenterCode ?? '-'}</td>
                                        <td>{s.operatorCode ?? '-'}</td>
                                        <td>{s.plannedQuantity}</td>
                                        <td style={{ color: '#22c55e', fontWeight: 600 }}>{s.completedQuantity}</td>
                                        <td style={{ color: (s.reworkQuantity ?? 0) > 0 ? '#f59e0b' : undefined }}>{s.reworkQuantity}</td>
                                        <td style={{ color: (s.rejectedQuantity ?? 0) > 0 ? '#ef4444' : undefined }}>{s.rejectedQuantity}</td>
                                        <td style={{ color: (s.scrapQuantity ?? 0) > 0 ? '#ef4444' : undefined }}>{s.scrapQuantity}</td>
                                        <td><StatusBadge status={s.status} variant={SC} /></td>
                                        <td>
                                          {s.status === 'PENDING' && can('production', 'Approve') && <button className="ibtn" title="Release" disabled={subActionBusyId === s.id} onClick={() => subAction(s.id, 'release')}><span className="material-symbols-rounded">play_arrow</span></button>}
                                          {s.status === 'RELEASED' && <button className="ibtn" title="Start" disabled={subActionBusyId === s.id} onClick={() => subAction(s.id, 'start')}><span className="material-symbols-rounded">play_circle</span></button>}
                                          {s.status === 'IN_PROGRESS' && <>
                                            <button className="ibtn" title="Quality Hold" disabled={subActionBusyId === s.id} onClick={() => subAction(s.id, 'quality-hold')}><span className="material-symbols-rounded">pause_circle</span></button>
                                            <button className="ibtn" title="Complete" disabled={subActionBusyId === s.id} onClick={() => subAction(s.id, 'complete')}><span className="material-symbols-rounded">check_circle</span></button>
                                          </>}
                                          {(s.status === 'ON_HOLD' || s.status === 'QUALITY_HOLD') && <button className="ibtn" title="Resume" disabled={subActionBusyId === s.id} onClick={() => subAction(s.id, 'resume')}><span className="material-symbols-rounded">play_circle</span></button>}
                                          <button className="ibtn" title="Edit" onClick={() => { setSubForm(s as unknown as Record<string, unknown>); setEditSubId(s.id); }}><span className="material-symbols-rounded">edit</span></button>
                                          {(s.status === 'PENDING' || s.status === 'RELEASED') && <button className="ibtn danger" title="Delete" onClick={() => setDeleteSubTarget(s)}><span className="material-symbols-rounded">delete</span></button>}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ========= SUBJOB FORM ========= */}
      {expandedId && (
        <div className="panel">
          <div className="panel-h"><h2>{editSubId ? 'Edit' : 'Add'} Subjob</h2></div>
          <div className="fgrid">
            <label className="fld"><span>Sequence No</span><input className="in" type="number" value={String(subForm.sequenceNo ?? '')} onChange={(e) => setSub('sequenceNo', Number(e.target.value))} /></label>
            <label className="fld"><span>Operation Code *</span><input className="in" value={String(subForm.operationCode ?? '')} onChange={(e) => setSub('operationCode', e.target.value)} /></label>
            <label className="fld"><span>Description</span><input className="in" value={String(subForm.operationDescription ?? '')} onChange={(e) => setSub('operationDescription', e.target.value)} /></label>
            <label className="fld"><span>Machine Code</span>
              <select className="in" value={String(subForm.machineCode ?? '')} onChange={(e) => setSub('machineCode', e.target.value)}>
                <option value="">Select machine...</option>
                {machines.map((m) => <option key={m.code} value={m.code}>{m.code} - {m.name}</option>)}
                {Boolean(subForm.machineCode) && !machines.some((m) => m.code === subForm.machineCode) && <option value={String(subForm.machineCode)}>{String(subForm.machineCode)}</option>}
              </select>
            </label>
            <label className="fld"><span>Work Center</span>
              <select className="in" value={String(subForm.workCenterCode ?? '')} onChange={(e) => setSub('workCenterCode', e.target.value)}>
                <option value="">Select work center...</option>
                {workCenters.map((w) => <option key={w.code} value={w.code}>{w.code} - {w.name}</option>)}
              </select>
            </label>
            <label className="fld"><span>Operator</span>
              <select className="in" value={String(subForm.operatorCode ?? '')} onChange={(e) => setSub('operatorCode', e.target.value)}>
                <option value="">Select operator...</option>
                {users.map((u) => <option key={u.username} value={u.username}>{u.username} - {u.fullName || u.username}</option>)}
              </select>
            </label>
            <label className="fld"><span>Planned Qty</span><input className="in" type="number" value={String(subForm.plannedQuantity ?? '')} onChange={(e) => setSub('plannedQuantity', Number(e.target.value))} /></label>
            <label className="fld"><span>Completed Qty</span><input className="in" type="number" value={String(subForm.completedQuantity ?? '')} onChange={(e) => setSub('completedQuantity', Number(e.target.value))} /></label>
            <label className="fld"><span>Rework Qty</span><input className="in" type="number" value={String(subForm.reworkQuantity ?? '')} onChange={(e) => setSub('reworkQuantity', Number(e.target.value))} /></label>
            <label className="fld"><span>Rejected Qty</span><input className="in" type="number" value={String(subForm.rejectedQuantity ?? '')} onChange={(e) => setSub('rejectedQuantity', Number(e.target.value))} /></label>
            <label className="fld"><span>Scrap Qty</span><input className="in" type="number" value={String(subForm.scrapQuantity ?? '')} onChange={(e) => setSub('scrapQuantity', Number(e.target.value))} /></label>
            <label className="fld"><span>Inspection Required</span>
              <select className="in" value={String(subForm.inspectionRequired ?? 'false')} onChange={(e) => setSub('inspectionRequired', e.target.value === 'true')}>
                <option value="false">No</option><option value="true">Yes</option>
              </select>
            </label>
            <label className="fld"><span>Remarks</span><input className="in" value={String(subForm.remarks ?? '')} onChange={(e) => setSub('remarks', e.target.value)} /></label>
          </div>
          <div className="actbar">
            <div className="lft">
              {editSubId && <button className="btn btn-sm" onClick={() => { setSubForm({}); setEditSubId(null); }} disabled={busy}><span className="material-symbols-rounded">arrow_back</span> Cancel</button>}
            </div>
            <div className="rgt">
              <button className="btn btn-sm btn-p" onClick={saveSub} disabled={busy}>{editSubId ? 'Update' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ========= COMPLETION CHECK MODAL ========= */}
      {showCompCheck && compCheck && (
        <div className="search-pop" onClick={() => setShowCompCheck(false)}>
          <div className="search-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Completion Check - {compCheck.jobCardNumber}</h3>
              <button className="btn btn-sm" onClick={() => setShowCompCheck(false)}>X</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {compCheck.checks.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: c.passed ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)' }}>
                  <span className="material-symbols-rounded" style={{ color: c.passed ? '#22c55e' : '#ef4444', fontSize: 20 }}>{c.passed ? 'check_circle' : 'error'}</span>
                  <div style={{ flex: 1 }}><b style={{ fontSize: 13 }}>{c.check}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.detail}</div></div>
                </div>
              ))}
            </div>
            {compCheck.canComplete ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-p" onClick={() => { if (!expandedId) return; setShowCompCheck(false); setActionTarget({ id: expandedId, action: 'complete' }); }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>check_circle</span> Complete Job Card
                </button>
              </div>
            ) : (
              <div style={{ padding: 12, background: 'rgba(239,68,68,0.08)', borderRadius: 8, fontSize: 13, color: '#ef4444' }}>
                Cannot complete - fix the issues above first.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========= ACTION NOTE MODAL ========= */}
      {actionTarget && (
        <div className="search-pop" onClick={() => setActionTarget(null)}>
          <div className="search-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h3 style={{ margin: '0 0 12px' }}>{actionTarget.action.charAt(0).toUpperCase() + actionTarget.action.slice(1)} Job Card</h3>
            <label className="fld"><span>Note (optional)</span>
              <input className="in" value={actionNote} onChange={(e) => setActionNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { action(actionTarget.id, actionTarget.action, actionNote); setActionTarget(null); setActionNote(''); } }} autoFocus />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => { setActionTarget(null); setActionNote(''); }}>Cancel</button>
              <button className="btn btn-p" onClick={() => { action(actionTarget.id, actionTarget.action, actionNote); setActionTarget(null); setActionNote(''); }} disabled={busy}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmActionModal open={Boolean(deleteTarget)} title={`Delete ${deleteTarget?.jobCardNumber ?? ''}`} body="Permanently delete this job card?" okLabel="Delete" danger busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={del} />
      <ConfirmActionModal open={Boolean(deleteSubTarget)} title="Delete Subjob" body="Permanently delete this subjob?" okLabel="Delete" danger busy={busy} onClose={() => setDeleteSubTarget(null)} onConfirm={delSub} />
      <AuditHistoryDrawer open={auditOpen} entityType="JobCard" entityId={editId ?? undefined} onClose={() => setAuditOpen(false)} />
    </>
  );
}
