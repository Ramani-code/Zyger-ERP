import { useEffect, useState, useCallback } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';
import StatusBadge from '../../../components/common/StatusBadge';
import { exportToCsv } from '../../../utils/csvExport';
import { filterPurchaseRelevantItems } from '../../../utils/itemClassification';
import { useTabs } from '../../../contexts/TabsContext';
import type {
  ProductionConsumption,
  ProductionConsumptionLine,
} from '../../../types/production/production.types';

interface JobOption {
  id: number;
  jobCardNumber: string;
  workOrderNumber?: string;
  partCode?: string;
  status?: string;
}

const SC: Record<string, { color: string; bg: string }> = {
  DRAFT: { color: '#888', bg: '#e9ecef' }, SUBMITTED: { color: '#6f42c1', bg: '#e8daef' },
  POSTED: { color: '#22c55e', bg: '#d4edda' }, CANCELLED: { color: '#991b1b', bg: '#fde2e2' },
};

const emptyLine = (): ProductionConsumptionLine => ({
  itemCode: '', itemDescription: '', issuedQty: 0, consumedQty: 1,
  returnQty: 0, scrapQty: 0, uom: '', location: '', batchNumber: '',
});

export default function ConsumptionScreen() {
  const { toast } = useToast();
  const { can } = useAuth();
  const { closeTab } = useTabs();
  const backToList = () => closeTab('consumption');

  const [rows, setRows] = useState<ProductionConsumption[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [lines, setLines] = useState<ProductionConsumptionLine[]>([emptyLine()]);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductionConsumption | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [actionBusyId, setActionBusyId] = useState<number | null>(null);
  const [tab, setTab] = useState<'list' | 'form'>('list');
  const [jobOptions, setJobOptions] = useState<JobOption[]>([]);
  const [items, setItems] = useState<Array<{ code: string; name: string; description?: string; uom?: string }>>([]);

  const fetchItems = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/master/items', { params: { size: 500, active: true, sort: 'code,asc' } });
      setItems(filterPurchaseRelevantItems((data?.content ?? data ?? []).filter((i: any) => i.active !== false)));
    } catch { /* ignore */ }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/v1/production/job-cards', { params: { size: 100 } });
      setJobOptions(Array.isArray(data) ? data : data.content ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (tab === 'form' && !editId) { fetchItems(); fetchJobs(); } }, [tab, editId, fetchItems, fetchJobs]);

  const handleJobSelect = (id: string) => {
    const job = jobOptions.find((j) => String(j.id) === id);
    if (!job) return;
    setForm((prev) => ({
      ...prev,
      jobCardId: job.id,
      jobCardNumber: job.jobCardNumber,
      workOrderNumber: job.workOrderNumber || prev.workOrderNumber || '',
    }));
    toast('Job card selected.');
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/v1/production/consumptions', { params: { size: 100 } });
      setRows(Array.isArray(data) ? data : data.content ?? []);
    } catch (e) { toast(getApiErrorMessage(e, 'Load failed.'), 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const set = (k: string, v: unknown) => setForm((c) => ({ ...c, [k]: v }));

  const setLine = (i: number, k: keyof ProductionConsumptionLine, v: unknown) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  const handleItemPick = (i: number, code: string) => {
    const item = items.find((it) => it.code === code);
    setLine(i, 'itemCode', code);
    if (item) { setLine(i, 'itemDescription', item.description || item.name); setLine(i, 'uom', item.uom || ''); }
  };

  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const save = async () => {
    if (!form.jobCardId) { toast('Select a Job Card.', 'error'); return; }
    const cleaned = lines.filter((l) => String(l.itemCode ?? '').trim() && Number(l.consumedQty) > 0);
    if (cleaned.length === 0) { toast('Add at least one line with consumed quantity.', 'error'); return; }
    const payload = { ...form, lines: cleaned, version: editId ? (form.version ?? undefined) : undefined };
    setBusy(true);
    try {
      if (editId) { await apiClient.put(`/v1/production/consumptions/${editId}`, payload); toast('Consumption updated.'); }
      else { await apiClient.post('/v1/production/consumptions', payload); toast('Consumption recorded.'); }
      setForm({}); setLines([emptyLine()]); setEditId(null); setTab('list'); load();
    } catch (e) { toast(getApiErrorMessage(e, 'Save failed.'), 'error'); }
    setBusy(false);
  };

  const startEdit = (r: ProductionConsumption) => {
    setForm(r as unknown as Record<string, unknown>);
    setLines(r.lines?.length ? r.lines.map((l) => ({ ...l })) : [emptyLine()]);
    setEditId(r.id ?? null);
    setTab('form');
    fetchItems();
  };

  const del = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try { await apiClient.delete(`/v1/production/consumptions/${deleteTarget.id}`); toast('Deleted.'); setDeleteTarget(null); load(); }
    catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  const action = async (id: number, act: string) => {
    if (actionBusyId !== null) return;
    setActionBusyId(id);
    try { await apiClient.post(`/v1/production/consumptions/${id}/actions/${act}`); toast(`Consumption ${act}.`); load(); }
    catch (e) { toast(getApiErrorMessage(e, 'Action failed.'), 'error'); }
    setActionBusyId(null);
  };

  const filtered = rows.filter((r) =>
    !search ||
    (r.consumptionNo ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.jobCardNumber ?? '').toLowerCase().includes(search.toLowerCase()));

  const totalQty = lines.reduce((s, l) => s + (Number(l.consumedQty) || 0), 0);

  return (
    <>
      <div className="pg-head"><h1>Production Consumption</h1><p>Record material consumed against a job card</p></div>

      {tab === 'form' && (
        <div className="panel">
          <div className="panel-h"><h2>{editId ? 'Edit' : 'New'} Consumption</h2></div>
          <div className="fgrid">
            {!editId && (
              <label className="fld" style={{ gridColumn: '1 / -1' }}><span>Job Card *</span>
                <select className="in" value={String(form.jobCardId ?? '')} onChange={(e) => handleJobSelect(e.target.value)}>
                  <option value="">Select Job Card...</option>
                  {jobOptions.filter((j) => j.status === 'RELEASED' || j.status === 'IN_PROGRESS').map((j) => (
                    <option key={j.id} value={j.id}>{j.jobCardNumber} | {j.partCode || 'N/A'}</option>
                  ))}
                </select>
              </label>
            )}
            {!!form.jobCardId && (
              <>
                <label className="fld"><span>Consumption No</span><input className="in" value={String(form.consumptionNo ?? '')} disabled /></label>
                <label className="fld"><span>Consumption Date</span><input className="in" type="date" value={String(form.consumptionDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10)} onChange={(e) => set('consumptionDate', e.target.value)} /></label>
                <label className="fld"><span>Work Order No</span><input className="in" value={String(form.workOrderNumber ?? '')} disabled /></label>
                <label className="fld"><span>Job Card No</span><input className="in" value={String(form.jobCardNumber ?? '')} disabled /></label>
              </>
            )}
            <label className="fld"><span>Material Request No</span><input className="in" value={String(form.materialRequestNo ?? '')} onChange={(e) => set('materialRequestNo', e.target.value)} /></label>
            <label className="fld" style={{ gridColumn: '1 / -1' }}><span>Remarks</span><input className="in" value={String(form.remarks ?? '')} onChange={(e) => set('remarks', e.target.value)} /></label>
          </div>

          <div className="panel-h" style={{ marginTop: 16 }}><h2>Consumed Material</h2></div>
          <div className="twrap">
            <table className="tbl">
              <thead><tr><th>S.No</th><th>Item Code *</th><th>Description</th><th>Issued Qty</th><th>Consumed Qty *</th><th>Return</th><th>Scrap</th><th>UOM</th><th>Location</th><th>Batch</th><th></th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="num mut">{i + 1}</td>
                    <td>
                      <select className="in" value={l.itemCode} onChange={(e) => handleItemPick(i, e.target.value)}>
                        <option value="">Select...</option>
                        {items.map((it) => <option key={it.code} value={it.code}>{it.code} - {it.description || it.name}</option>)}
                      </select>
                    </td>
                    <td><input className="in" value={l.itemDescription ?? ''} onChange={(e) => setLine(i, 'itemDescription', e.target.value)} /></td>
                    <td><input className="in" type="number" value={String(l.issuedQty ?? '')} onChange={(e) => setLine(i, 'issuedQty', Number(e.target.value))} /></td>
                    <td><input className="in" type="number" value={String(l.consumedQty ?? '')} onChange={(e) => setLine(i, 'consumedQty', Number(e.target.value))} /></td>
                    <td><input className="in" type="number" value={String(l.returnQty ?? '')} onChange={(e) => setLine(i, 'returnQty', Number(e.target.value))} /></td>
                    <td><input className="in" type="number" value={String(l.scrapQty ?? '')} onChange={(e) => setLine(i, 'scrapQty', Number(e.target.value))} /></td>
                    <td><input className="in" value={l.uom ?? ''} onChange={(e) => setLine(i, 'uom', e.target.value)} /></td>
                    <td><input className="in" value={l.location ?? ''} onChange={(e) => setLine(i, 'location', e.target.value)} /></td>
                    <td><input className="in" value={l.batchNumber ?? ''} onChange={(e) => setLine(i, 'batchNumber', e.target.value)} /></td>
                    <td><button className="ibtn danger" onClick={() => removeLine(i)}><span className="material-symbols-rounded">remove</span></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button className="btn btn-sm" onClick={addLine}>+ Add Line</button>
            <span style={{ fontWeight: 600 }}>Total Consumed: {totalQty}</span>
          </div>

          <div className="actbar">
            <div className="lft">
              <button className="btn btn-sm" onClick={backToList} disabled={busy}><span className="material-symbols-rounded">arrow_back</span> Back</button>
            </div>
            <div className="rgt">
              {editId && <button className="btn btn-sm" onClick={() => { setForm({}); setLines([emptyLine()]); setEditId(null); setTab('list'); }} disabled={busy}>Cancel</button>}
              <button className="btn btn-sm btn-p" onClick={save} disabled={busy || !can('production', 'Edit')}>{editId ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'list' && (
        <div className="panel">
          <div className="toolbar">
            <input className="in" placeholder="Search consumptions..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="ibtn" title="Export CSV" onClick={() => exportToCsv(filtered as unknown as Record<string, unknown>[], [
              { key: 'consumptionNo', label: 'Doc No' },
              { key: 'consumptionDate', label: 'Date' },
              { key: 'jobCardNumber', label: 'Job Card' },
              { key: 'workOrderNumber', label: 'Work Order' },
              { key: 'status', label: 'Status' },
            ], 'consumptions')}><span className="material-symbols-rounded">download</span></button>
            <button className="btn btn-p" onClick={() => { setForm({}); setLines([emptyLine()]); setEditId(null); setTab('form'); }} disabled={!can('production', 'Edit')}>+ New Consumption</button>
          </div>
          <div className="twrap">
            {loading ? <div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading...</div> : (
              <table className="tbl">
                <thead><tr><th className="num">S.No</th><th>Consumption No</th><th>Date</th><th>Job Card</th><th>Work Order</th><th>Lines</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {filtered.length === 0 ? <tr><td colSpan={8}><div className="empty"><span className="material-symbols-rounded">description</span> No consumptions.</div></td></tr> : filtered.map((r, idx) => (
                    <tr key={r.id}>
                      <td className="num mut">{idx + 1}</td>
                      <td><b>{r.consumptionNo}</b></td>
                      <td>{String(r.consumptionDate ?? '').slice(0, 10)}</td>
                      <td>{r.jobCardNumber ?? '-'}</td>
                      <td>{r.workOrderNumber ?? '-'}</td>
                      <td>{r.lines?.length ?? 0}</td>
                      <td><StatusBadge status={r.status ?? ''} variant={SC} /></td>
                      <td>
                        {r.status === 'DRAFT' && can('production', 'Approve') && <button className="ibtn" title="Submit" disabled={actionBusyId === r.id} onClick={() => action(r.id!, 'submit')}><span className="material-symbols-rounded">send</span></button>}
                        {r.status === 'SUBMITTED' && can('production', 'Edit') && <button className="ibtn" title="Post" disabled={actionBusyId === r.id} onClick={() => action(r.id!, 'post')}><span className="material-symbols-rounded">publish</span></button>}
                        {r.status !== 'POSTED' && r.status !== 'CANCELLED' && can('production', 'Cancel') && <button className="ibtn" title="Cancel" disabled={actionBusyId === r.id} onClick={() => action(r.id!, 'cancel')}><span className="material-symbols-rounded">block</span></button>}
                        {r.status === 'DRAFT' && can('production', 'Edit') && <button className="ibtn" title="Edit" onClick={() => startEdit(r)}><span className="material-symbols-rounded">edit</span></button>}
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

      <ConfirmActionModal open={Boolean(deleteTarget)} title={`Delete ${deleteTarget?.consumptionNo ?? ''}`} body="Permanently delete?" okLabel="Delete" danger busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={del} />
    </>
  );
}
