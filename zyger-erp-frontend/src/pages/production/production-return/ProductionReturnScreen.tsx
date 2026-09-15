import { useEffect, useState, useCallback } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';
import StatusBadge from '../../../components/common/StatusBadge';
import { printDocument as printDoc } from '../../../utils/printDocument';
import { exportToCsv } from '../../../utils/csvExport';
import { filterPurchaseRelevantItems } from '../../../utils/itemClassification';
import { useTabs } from '../../../contexts/TabsContext';

interface ProductionReturn {
  id: number;
  returnNumber: string;
  returnDate: string;
  workOrderNumber: string;
  jobCardNumber: string;
  itemCode: string;
  itemDescription: string;
  batchNumber: string;
  quantity: number;
  uom: string;
  originalIssueReference: string;
  returnReason: string;
  condition: string;
  warehouse: string;
  location: string;
  status: string;
  remarks: string;
  version?: number;
}

const DISPOSITIONS: Array<{ value: string; label: string }> = [
  { value: 'GOOD', label: 'Good' },
  { value: 'QC_HOLD', label: 'QC Hold' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'SCRAP', label: 'Scrap' },
  { value: 'REWORK', label: 'Rework' },
];

const SC: Record<string, { color: string; bg: string }> = {
  DRAFT: { color: '#888', bg: '#e9ecef' }, SUBMITTED: { color: '#6f42c1', bg: '#e8daef' },
  VERIFIED: { color: '#2563eb', bg: '#dbeafe' },
  RECEIVED: { color: '#22c55e', bg: '#d4edda' }, CANCELLED: { color: '#991b1b', bg: '#fde2e2' },
};

export default function ProductionReturnScreen() {
  const { toast } = useToast();
  const { can } = useAuth();
  const { closeTab } = useTabs();
  const backToList = () => closeTab('production-return');
  const [rows, setRows] = useState<ProductionReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductionReturn | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [actionBusyId, setActionBusyId] = useState<number | null>(null);
  const [tab, setTab] = useState<'list' | 'form'>('list');
  const [items, setItems] = useState<Array<{ code: string; name: string; description?: string; uom?: string }>>([]);
  const [entryOptions, setEntryOptions] = useState<Array<{ id: number; entryNumber: string; workOrderNumber: string; jobCardNumber: string; partCode: string; partDescription: string }>>([]);
  const [entryLookup, setEntryLookup] = useState('');

  const fetchItems = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/master/items', { params: { size: 500, active: true, sort: 'code,asc' } });
      setItems(filterPurchaseRelevantItems((data?.content ?? data ?? []).filter((i: any) => i.active !== false)));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (tab === 'form' && !editId) fetchItems(); }, [tab, editId, fetchItems]);

  const fetchEntries = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/v1/production/entries', { params: { size: 50 } });
      setEntryOptions(Array.isArray(data) ? data : data.content ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (tab === 'form' && !editId) fetchEntries(); }, [tab, editId, fetchEntries]);

  const handleEntrySelect = (entryNumber: string) => {
    setEntryLookup(entryNumber);
    const entry = entryOptions.find((e) => e.entryNumber === entryNumber);
    if (entry) {
      setForm((prev) => ({
        ...prev,
        workOrderNumber: entry.workOrderNumber || prev.workOrderNumber || '',
        jobCardNumber: entry.jobCardNumber || prev.jobCardNumber || '',
        itemCode: entry.partCode || prev.itemCode || '',
        itemDescription: entry.partDescription || prev.itemDescription || '',
        originalIssueReference: entry.entryNumber || prev.originalIssueReference || '',
      }));
      const item = items.find((i) => i.code === entry.partCode);
      if (item?.uom) setForm((prev) => ({ ...prev, uom: item.uom }));
      toast('Production entry details auto-filled.');
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/v1/production/returns');
      setRows(Array.isArray(data) ? data : data.content ?? []);
    } catch (e) { toast(getApiErrorMessage(e, 'Load failed.'), 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!String(form.itemCode ?? '').trim()) { toast('Item Code is required.', 'error'); return; }
    const qty = Number(form.quantity ?? 0);
    if (!(qty > 0)) { toast('Return quantity must be greater than zero.', 'error'); return; }
    setBusy(true);
    try {
      const payload = { ...form, version: editId ? (form.version ?? undefined) : undefined };
      if (editId) { await apiClient.put(`/v1/production/returns/${editId}`, payload); toast('Return updated.'); }
      else { await apiClient.post('/v1/production/returns', payload); toast('Return created.'); }
      setForm({}); setEditId(null); setTab('list'); load();
    } catch (e) { toast(getApiErrorMessage(e, 'Save failed.'), 'error'); }
    setBusy(false);
  };

  const del = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try { await apiClient.delete(`/v1/production/returns/${deleteTarget.id}`); toast('Deleted.'); setDeleteTarget(null); load(); }
    catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  const action = async (id: number, act: string) => {
    if (actionBusyId !== null) return;
    setActionBusyId(id);
    try { await apiClient.post(`/v1/production/returns/${id}/actions/${act}`); toast(`Return ${act}.`); load(); }
    catch (e) { toast(getApiErrorMessage(e, 'Action failed.'), 'error'); }
    setActionBusyId(null);
  };

  const set = (k: string, v: unknown) => setForm((c) => ({ ...c, [k]: v }));

  const printDocument = (id: number | string, mode: 'print' | 'download' = 'print') => {
    const base = import.meta.env.VITE_API_BASE_URL || '/api';
    printDoc(`${base}/v1/production/returns/${id}/print?download=${mode === 'download'}`, mode);
  };

  const filtered = rows.filter((r) => !search || (r.returnNumber ?? '').toLowerCase().includes(search.toLowerCase()) || (r.itemCode ?? '').toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="pg-head"><h1>Production Return</h1><p>Return unused / excess material to stores</p></div>

      {tab === 'form' && (
        <div className="panel">
          <div className="panel-h"><h2>{editId ? 'Edit' : 'New'} Return</h2></div>
          <div className="fgrid">
            {!editId && entryOptions.length > 0 && (
              <div style={{ gridColumn: '1 / -1', padding: '0 0 8px', background: '#f0f7ff', borderRadius: 8, marginBottom: 4, border: '1px solid #bfdbfe' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, padding: '8px 12px 0' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 18, color: '#2563eb' }}>link</span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: '#1e40af' }}>Quick Fill from Production Entry</span>
                </div>
                <div style={{ padding: '0 12px 8px' }}>
                  <select className="in" value={entryLookup} onChange={(e) => handleEntrySelect(e.target.value)}>
                    <option value="">Select Production Entry to auto-fill...</option>
                    {entryOptions.map((e) => (
                      <option key={e.entryNumber} value={e.entryNumber}>{e.entryNumber} | {e.partCode} | {e.partDescription || 'N/A'}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <label className="fld"><span>Return Date</span><input className="in" type="date" value={String(form.returnDate ?? '').slice(0, 10)} onChange={(e) => set('returnDate', e.target.value)} /></label>
            <label className="fld"><span>Work Order No</span><input className="in" value={String(form.workOrderNumber ?? '')} onChange={(e) => set('workOrderNumber', e.target.value)} /></label>
            <label className="fld"><span>Job Card No</span><input className="in" value={String(form.jobCardNumber ?? '')} onChange={(e) => set('jobCardNumber', e.target.value)} /></label>
            <label className="fld"><span>Item Code *</span>
              <select className="in" value={String(form.itemCode ?? '')} onChange={(e) => { const item = items.find((i) => i.code === e.target.value); set('itemCode', e.target.value); if (item) { set('itemDescription', item.description || item.name); set('uom', item.uom || ''); } }}>
                <option value="">Select item...</option>
                {items.map((i) => <option key={i.code} value={i.code}>{i.code} - {i.description || i.name}</option>)}
              </select>
            </label>
            <label className="fld"><span>Item Description</span><input className="in" value={String(form.itemDescription ?? '')} onChange={(e) => set('itemDescription', e.target.value)} /></label>
            <label className="fld"><span>Batch No</span><input className="in" value={String(form.batchNumber ?? '')} onChange={(e) => set('batchNumber', e.target.value)} /></label>
            <label className="fld"><span>Quantity</span><input className="in" type="number" value={String(form.quantity ?? '')} onChange={(e) => set('quantity', Number(e.target.value))} /></label>
            <label className="fld"><span>UOM</span><input className="in" value={String(form.uom ?? '')} onChange={(e) => set('uom', e.target.value)} /></label>
            <label className="fld"><span>Original Issue Ref</span><input className="in" value={String(form.originalIssueReference ?? '')} onChange={(e) => set('originalIssueReference', e.target.value)} /></label>
            <label className="fld"><span>Return Reason</span><input className="in" value={String(form.returnReason ?? '')} onChange={(e) => set('returnReason', e.target.value)} /></label>
            <label className="fld"><span>Condition</span>
              <select className="in" value={String(form.condition ?? 'GOOD')} onChange={(e) => set('condition', e.target.value)}>
                {DISPOSITIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </label>
            <label className="fld"><span>Warehouse</span><input className="in" value={String(form.warehouse ?? '')} onChange={(e) => set('warehouse', e.target.value)} /></label>
            <label className="fld"><span>Location</span><input className="in" value={String(form.location ?? '')} onChange={(e) => set('location', e.target.value)} /></label>
            <label className="fld"><span>Remarks</span><input className="in" value={String(form.remarks ?? '')} onChange={(e) => set('remarks', e.target.value)} /></label>
          </div>
          <div className="actbar">
            <div className="lft">
              <button className="btn btn-sm" onClick={backToList} disabled={busy}><span className="material-symbols-rounded">arrow_back</span> Back</button>
            </div>
            <div className="rgt">
              {editId && <button className="btn btn-sm" onClick={() => { setForm({}); setEditId(null); setTab('list'); }} disabled={busy}>Cancel</button>}
              <button className="btn btn-sm btn-p" onClick={save} disabled={busy || !can('production', 'Edit')}>{editId ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'list' && (
        <div className="panel">
          <div className="toolbar">
            <input className="in" placeholder="Search returns..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="ibtn" title="Export CSV" onClick={() => exportToCsv(filtered as unknown as Record<string, unknown>[], [
              { key: 'returnNumber', label: 'Doc No' },
              { key: 'returnDate', label: 'Date' },
              { key: 'itemCode', label: 'Item' },
              { key: 'quantity', label: 'Qty' },
              { key: 'condition', label: 'Condition' },
              { key: 'status', label: 'Status' },
            ], 'production-returns')}><span className="material-symbols-rounded">download</span></button>
            <button className="btn btn-p" onClick={() => { setForm({}); setEditId(null); setTab('form'); }} disabled={!can('production', 'Edit')}>+ New Return</button>
          </div>
          <div className="twrap">
            {loading ? <div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading...</div> : (
              <table className="tbl">
                <thead><tr><th className="num">S.No</th><th>Return No</th><th>Work Order</th><th>Item Code</th><th>Qty</th><th>Reason</th><th>Condition</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {filtered.length === 0 ? <tr><td colSpan={9}><div className="empty"><span className="material-symbols-rounded">description</span> No returns.</div></td></tr> : filtered.map((r, idx) => (
                    <tr key={r.id}>
                      <td className="num mut">{idx + 1}</td>
                      <td><b>{r.returnNumber}</b></td>
                      <td>{r.workOrderNumber ?? '-'}</td>
                      <td>{r.itemCode}</td>
                      <td>{r.quantity} {r.uom}</td>
                      <td>{r.returnReason ?? '-'}</td>
                      <td>{r.condition ?? '-'}</td>
                      <td><StatusBadge status={r.status} variant={SC} /></td>
                      <td>
                        {r.status === 'DRAFT' && can('production', 'Approve') && <button className="ibtn" title="Verify" disabled={actionBusyId === r.id} onClick={() => action(r.id, 'verify')}><span className="material-symbols-rounded">fact_check</span></button>}
                        {r.status === 'VERIFIED' && can('production', 'Approve') && <button className="ibtn" title="Receive" disabled={actionBusyId === r.id} onClick={() => action(r.id, 'receive')}><span className="material-symbols-rounded">inventory_2</span></button>}
                        {r.status !== 'RECEIVED' && can('production', 'Cancel') && <button className="ibtn" title="Cancel" disabled={actionBusyId === r.id} onClick={() => action(r.id, 'cancel')}><span className="material-symbols-rounded">block</span></button>}
                        {can('production', 'Edit') && <button className="ibtn" title="Edit" onClick={() => { setForm(r as unknown as Record<string, unknown>); setEditId(r.id); setTab('form'); }}><span className="material-symbols-rounded">edit</span></button>}
                        <button className="ibtn" title="Print" onClick={() => printDocument(r.id, 'print')}><span className="material-symbols-rounded">print</span></button>
                        <button className="ibtn" title="Download PDF" onClick={() => printDocument(r.id, 'download')}><span className="material-symbols-rounded">download</span></button>
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

      <ConfirmActionModal open={Boolean(deleteTarget)} title={`Delete ${deleteTarget?.returnNumber ?? ''}`} body="Permanently delete?" okLabel="Delete" danger busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={del} />
    </>
  );
}
