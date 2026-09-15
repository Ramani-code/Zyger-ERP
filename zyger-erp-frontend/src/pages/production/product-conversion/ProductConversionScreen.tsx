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

interface ProductConversion {
  id: number;
  version?: number;
  conversionNumber: string;
  conversionDate: string;
  conversionType: string;
  conversionRate: number;
  sourceWarehouse: string;
  destinationWarehouse: string;
  workOrderNumber: string;
  jobCardNumber: string;
  reference: string;
  inputItemCode: string;
  inputBatchNumber: string;
  inputQuantity: number;
  inputUom: string;
  outputItemCode: string;
  outputBatchNumber: string;
  outputQuantity: number;
  outputUom: string;
  processLossQty: number;
  scrapQty: number;
  lossReason: string;
  status: string;
  remarks: string;
}

const SC: Record<string, { color: string; bg: string }> = {
  DRAFT: { color: '#888', bg: '#e9ecef' }, SUBMITTED: { color: '#6f42c1', bg: '#e8daef' },
  VERIFIED: { color: '#2563eb', bg: '#dbeafe' }, POSTED: { color: '#22c55e', bg: '#d4edda' },
  REJECTED: { color: '#c0392b', bg: '#fdecea' }, CANCELLED: { color: '#991b1b', bg: '#fde2e2' },
};

export default function ProductConversionScreen() {
  const { toast } = useToast();
  const { can } = useAuth();
  const { closeTab } = useTabs();
  const backToList = () => closeTab('product-conversion');
  const [rows, setRows] = useState<ProductConversion[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductConversion | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [actionBusyId, setActionBusyId] = useState<number | null>(null);
  const [tab, setTab] = useState<'list' | 'form'>('list');
  const [items, setItems] = useState<Array<{ code: string; name: string; description?: string; uom?: string }>>([]);

  const fetchItems = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/master/items', { params: { size: 500, active: true, sort: 'code,asc' } });
      setItems(filterPurchaseRelevantItems((data?.content ?? data ?? []).filter((i: any) => i.active !== false)));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (tab === 'form') fetchItems(); }, [tab, fetchItems]);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/v1/production/conversions');
      setRows(Array.isArray(data) ? data : data.content ?? []);
    } catch (e) { toast(getApiErrorMessage(e, 'Load failed.'), 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!String(form.inputItemCode ?? '').trim()) { toast('Input Item Code is required.', 'error'); return; }
    if (!String(form.outputItemCode ?? '').trim()) { toast('Output Item Code is required.', 'error'); return; }
    const iq = Number(form.inputQuantity ?? 0);
    const oq = Number(form.outputQuantity ?? 0);
    const loss = Number(form.processLossQty ?? 0);
    const scrap = Number(form.scrapQty ?? 0);
    if (iq <= 0) { toast('Input quantity must be > 0.', 'error'); return; }
    if (oq <= 0) { toast('Output quantity must be > 0.', 'error'); return; }
    if (loss < 0 || scrap < 0) { toast('Loss / scrap quantities cannot be negative.', 'error'); return; }
    if (oq + loss + scrap > iq) { toast('Output + loss + scrap cannot exceed input quantity.', 'error'); return; }
    setBusy(true);
    try {
      const payload = { ...form, version: editId ? (form.version ?? undefined) : undefined };
      if (editId) { await apiClient.put(`/v1/production/conversions/${editId}`, payload); toast('Conversion updated.'); }
      else { await apiClient.post('/v1/production/conversions', payload); toast('Conversion created.'); }
      setForm({}); setEditId(null); setTab('list'); load();
    } catch (e) { toast(getApiErrorMessage(e, 'Save failed.'), 'error'); }
    setBusy(false);
  };

  const del = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try { await apiClient.delete(`/v1/production/conversions/${deleteTarget.id}`); toast('Deleted.'); setDeleteTarget(null); load(); }
    catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  const action = async (id: number, act: string) => {
    if (actionBusyId !== null) return;
    setActionBusyId(id);
    try { await apiClient.post(`/v1/production/conversions/${id}/actions/${act}`); toast(`Conversion ${act}.`); load(); }
    catch (e) { toast(getApiErrorMessage(e, 'Action failed.'), 'error'); }
    setActionBusyId(null);
  };

  const set = (k: string, v: unknown) => setForm((c) => ({ ...c, [k]: v }));

  const printDocument = (id: number | string, mode: 'print' | 'download' = 'print') => {
    const base = import.meta.env.VITE_API_BASE_URL || '/api';
    printDoc(`${base}/v1/production/conversions/${id}/print?download=${mode === 'download'}`, mode);
  };

  const filtered = rows.filter((r) => !search || (r.conversionNumber ?? '').toLowerCase().includes(search.toLowerCase()) || (r.inputItemCode ?? '').toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="pg-head"><h1>Product Conversion</h1><p>Convert raw material to semi-finished / finished products</p></div>

      {tab === 'form' && (
        <div className="panel">
          <div className="panel-h"><h2>{editId ? 'Edit' : 'New'} Conversion</h2></div>
          <div className="fgrid">
            <label className="fld"><span>Conversion Date</span><input className="in" type="date" value={String(form.conversionDate ?? '').slice(0, 10)} onChange={(e) => set('conversionDate', e.target.value)} /></label>
            <label className="fld"><span>Conversion Type</span>
              <select className="in" value={String(form.conversionType ?? 'RM_TO_SFG')} onChange={(e) => set('conversionType', e.target.value)}>
                <option value="RM_TO_SFG">Raw to Semi-Finished</option><option value="SFG_TO_FG">Semi-Finished to Finished</option><option value="OTHER">Other</option>
              </select>
            </label>
            <label className="fld"><span>Source Warehouse</span><input className="in" value={String(form.sourceWarehouse ?? '')} onChange={(e) => set('sourceWarehouse', e.target.value)} /></label>
            <label className="fld"><span>Destination Warehouse</span><input className="in" value={String(form.destinationWarehouse ?? '')} onChange={(e) => set('destinationWarehouse', e.target.value)} /></label>
            <label className="fld"><span>Work Order No</span><input className="in" value={String(form.workOrderNumber ?? '')} onChange={(e) => set('workOrderNumber', e.target.value)} /></label>
            <label className="fld"><span>Job Card No</span><input className="in" value={String(form.jobCardNumber ?? '')} onChange={(e) => set('jobCardNumber', e.target.value)} /></label>
            <hr style={{ gridColumn: '1 / -1', border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />
            <label className="fld"><span>Input Item Code *</span>
              <select className="in" value={String(form.inputItemCode ?? '')} onChange={(e) => { const item = items.find((i) => i.code === e.target.value); set('inputItemCode', e.target.value); if (item?.uom) set('inputUom', item.uom); }}>
                <option value="">Select item...</option>
                {items.map((i) => <option key={i.code} value={i.code}>{i.code} - {i.description || i.name}</option>)}
              </select>
            </label>
            <label className="fld"><span>Input Batch No</span><input className="in" value={String(form.inputBatchNumber ?? '')} onChange={(e) => set('inputBatchNumber', e.target.value)} /></label>
            <label className="fld"><span>Input Quantity</span><input className="in" type="number" value={String(form.inputQuantity ?? '')} onChange={(e) => { const iq = Number(e.target.value); set('inputQuantity', iq); const oq = Number(form.outputQuantity ?? 0); if (iq > 0 && oq > 0) set('conversionRate', oq / iq); }} /></label>
            <label className="fld"><span>Input UOM</span><input className="in" value={String(form.inputUom ?? '')} onChange={(e) => set('inputUom', e.target.value)} /></label>
            <hr style={{ gridColumn: '1 / -1', border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />
            <label className="fld"><span>Output Item Code *</span>
              <select className="in" value={String(form.outputItemCode ?? '')} onChange={(e) => { const item = items.find((i) => i.code === e.target.value); set('outputItemCode', e.target.value); if (item?.uom) set('outputUom', item.uom); }}>
                <option value="">Select item...</option>
                {items.map((i) => <option key={i.code} value={i.code}>{i.code} - {i.description || i.name}</option>)}
              </select>
            </label>
            <label className="fld"><span>Output Batch No</span><input className="in" value={String(form.outputBatchNumber ?? '')} onChange={(e) => set('outputBatchNumber', e.target.value)} /></label>
            <label className="fld"><span>Output Quantity</span><input className="in" type="number" value={String(form.outputQuantity ?? '')} onChange={(e) => { const oq = Number(e.target.value); set('outputQuantity', oq); const iq = Number(form.inputQuantity ?? 0); if (iq > 0 && oq > 0) set('conversionRate', oq / iq); }} /></label>
            <label className="fld"><span>Output UOM</span><input className="in" value={String(form.outputUom ?? '')} onChange={(e) => set('outputUom', e.target.value)} /></label>
            <label className="fld"><span>Conversion Rate</span><input className="in" type="number" step="0.001" value={String(form.conversionRate ?? '')} onChange={(e) => set('conversionRate', Number(e.target.value))} readOnly /></label>
            <hr style={{ gridColumn: '1 / -1', border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />
            <label className="fld"><span>Process Loss Qty</span><input className="in" type="number" value={String(form.processLossQty ?? '')} onChange={(e) => set('processLossQty', Number(e.target.value))} /></label>
            <label className="fld"><span>Scrap Qty</span><input className="in" type="number" value={String(form.scrapQty ?? '')} onChange={(e) => set('scrapQty', Number(e.target.value))} /></label>
            <label className="fld"><span>Loss Reason</span><input className="in" value={String(form.lossReason ?? '')} onChange={(e) => set('lossReason', e.target.value)} /></label>
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
            <input className="in" placeholder="Search conversions..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="ibtn" title="Export CSV" onClick={() => exportToCsv(filtered as unknown as Record<string, unknown>[], [
              { key: 'conversionNumber', label: 'Doc No' },
              { key: 'conversionDate', label: 'Date' },
              { key: 'inputItemCode', label: 'Input Item' },
              { key: 'inputQuantity', label: 'Input Qty' },
              { key: 'outputItemCode', label: 'Output Item' },
              { key: 'outputQuantity', label: 'Output Qty' },
              { key: 'conversionRate', label: 'Rate' },
              { key: 'status', label: 'Status' },
            ], 'product-conversion')}><span className="material-symbols-rounded">download</span></button>
            <button className="btn btn-p" onClick={() => { setForm({}); setEditId(null); setTab('form'); }} disabled={!can('production', 'Edit')}>+ New Conversion</button>
          </div>
          <div className="twrap">
            {loading ? <div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading...</div> : (
              <table className="tbl">
                <thead><tr><th className="num">S.No</th><th>Conversion No</th><th>Type</th><th>Input Item</th><th>Input Qty</th><th>Output Item</th><th>Output Qty</th><th>Loss</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {filtered.length === 0 ? <tr><td colSpan={10}><div className="empty"><span className="material-symbols-rounded">description</span> No conversions.</div></td></tr> : filtered.map((r, idx) => (
                    <tr key={r.id}>
                      <td className="num mut">{idx + 1}</td>
                      <td><b>{r.conversionNumber}</b></td>
                      <td>{r.conversionType}</td>
                      <td>{r.inputItemCode}</td>
                      <td>{r.inputQuantity} {r.inputUom}</td>
                      <td>{r.outputItemCode}</td>
                      <td>{r.outputQuantity} {r.outputUom}</td>
                      <td>{r.processLossQty ?? 0}</td>
                      <td><StatusBadge status={r.status} variant={SC} /></td>
                      <td>
                        {r.status === 'DRAFT' && can('production', 'Approve') && <button className="ibtn" title="Submit" disabled={actionBusyId === r.id} onClick={() => action(r.id, 'submit')}><span className="material-symbols-rounded">send</span></button>}
                        {r.status === 'SUBMITTED' && can('production', 'Approve') && <button className="ibtn" title="Verify" disabled={actionBusyId === r.id} onClick={() => action(r.id, 'verify')}><span className="material-symbols-rounded">verified</span></button>}
                        {r.status === 'VERIFIED' && can('production', 'Approve') && <button className="ibtn" title="Post (stock in/out)" disabled={actionBusyId === r.id} onClick={() => action(r.id, 'post')}><span className="material-symbols-rounded">check_circle</span></button>}
                        {r.status === 'SUBMITTED' && can('production', 'Approve') && <button className="ibtn danger" title="Reject" disabled={actionBusyId === r.id} onClick={() => action(r.id, 'reject')}><span className="material-symbols-rounded">cancel</span></button>}
                        {r.status === 'DRAFT' && can('production', 'Cancel') && <button className="ibtn danger" title="Cancel" disabled={actionBusyId === r.id} onClick={() => action(r.id, 'cancel')}><span className="material-symbols-rounded">block</span></button>}
                        {can('production', 'Edit') && r.status === 'DRAFT' && <button className="ibtn" title="Edit" onClick={() => { setForm(r as unknown as Record<string, unknown>); setEditId(r.id); setTab('form'); }}><span className="material-symbols-rounded">edit</span></button>}
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

      <ConfirmActionModal open={Boolean(deleteTarget)} title={`Delete ${deleteTarget?.conversionNumber ?? ''}`} body="Permanently delete?" okLabel="Delete" danger busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={del} />
    </>
  );
}
