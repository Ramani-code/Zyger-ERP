import { useEffect, useState } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';

interface Store { id: number; code: string; name: string; }
interface Rack {
  id: number; code: string; name: string; storeId?: number; storeName?: string;
  location?: string; capacity?: number; capacityUnit?: string; remarks?: string; active: boolean;
}

const CAPACITY_UNITS = ['Kg', 'Nos', 'Pallet', 'Liters', 'CBM', 'Boxes'];

export default function RackScreen() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Rack[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Rack | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [racksRes, storesRes] = await Promise.all([
        apiClient.get('/master/racks'),
        apiClient.get('/master/stores')
      ]);
      setRows(racksRes.data);
      setStores(storesRes.data);
    } catch (e) { toast(getApiErrorMessage(e, 'Load failed.'), 'error'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const fetchNextCode = async () => {
    try {
      const { data } = await apiClient.get('/master/racks/next-code');
      setForm(c => ({ ...c, code: data.code }));
    } catch { /* ignore */ }
  };
  useEffect(() => { if (!editId) fetchNextCode(); }, []);

  const save = async () => {
    if (!String(form.name ?? '').trim()) { toast('Name is required.', 'error'); return; }
    if (!form.storeId) { toast('Store is required.', 'error'); return; }
    setBusy(true);
    try {
      if (editId) { await apiClient.put(`/master/racks/${editId}`, form); toast('Rack updated.'); }
      else { await apiClient.post('/master/racks', form); toast('Rack created.'); }
      setForm({}); setEditId(null); fetchNextCode(); load();
    } catch (e) { toast(getApiErrorMessage(e, 'Save failed.'), 'error'); }
    setBusy(false);
  };

  const del = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const { data } = await apiClient.delete(`/master/racks/${deleteTarget.id}`);
      toast(data?.deactivated ? (data.message || 'Rack is in use; it was deactivated.') : 'Rack deleted.', data?.deactivated ? 'success' : undefined);
      setDeleteTarget(null); load();
    }
    catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  const set = (k: string, v: unknown) => setForm(c => ({ ...c, [k]: v }));

  return (
    <>
      <div className="pg-head"><h1>Rack Master</h1><p>Define racks within stores</p></div>
      <div className="panel">
        <div className="panel-h"><h2><span className="material-symbols-rounded">add</span> {editId ? 'Edit' : 'Add'} Rack</h2></div>
        <div className="fgrid">
          <label className="fld"><span>Code</span><input className="in" value={String(form.code ?? '')} readOnly onChange={e => set('code', e.target.value)} /></label>
          <label className="fld"><span>Name *</span><input className="in" value={String(form.name ?? '')} onChange={e => set('name', e.target.value)} /></label>
          <label className="fld"><span>Store *</span>
            <select className="in" value={String(form.storeId ?? '')} onChange={e => set('storeId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Select...</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="fld"><span>Location</span><input className="in" value={String(form.location ?? '')} onChange={e => set('location', e.target.value)} /></label>
          <label className="fld"><span>Capacity</span><input className="in" type="number" step="0.01" value={String(form.capacity ?? '')} onChange={e => set('capacity', e.target.value ? Number(e.target.value) : null)} /></label>
          <label className="fld"><span>Capacity Unit</span>
            <select className="in" value={String(form.capacityUnit ?? '')} onChange={e => set('capacityUnit', e.target.value)}>
              <option value="">Select...</option>
              {CAPACITY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="fld full"><span>Remarks</span><textarea className="in" rows={2} value={String(form.remarks ?? '')} onChange={e => set('remarks', e.target.value)} /></label>
        </div>
        <div className="actbar" style={{ justifyContent: 'flex-end' }}>
          {editId && <button className="btn" onClick={() => { setForm({}); setEditId(null); fetchNextCode(); }} disabled={busy}>Cancel</button>}
          <button className="btn btn-p" onClick={save} disabled={busy}>{editId ? 'Update' : 'Create'}</button>
        </div>
      </div>
      <div className="panel">
        <div className="twrap">
          {loading ? <div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading...</div> : (
            <table className="tbl">
              <thead><tr><th className="num">S.No</th><th>Code</th><th>Name</th><th>Store</th><th>Location</th><th>Capacity</th><th>Unit</th><th>Active</th><th>Actions</th></tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={9}><div className="empty"><span className="material-symbols-rounded">description</span> No racks.</div></td></tr>
                : rows.map((r, idx) => (
                  <tr key={r.id}><td className="num mut">{idx + 1}</td><td>{r.code}</td><td>{r.name}</td><td>{r.storeName ?? ''}</td><td>{r.location ?? ''}</td>
                    <td>{r.capacity ?? ''}</td><td>{r.capacityUnit ?? ''}</td>
                    <td>{r.active ? <span className="badge badge-green">Active</span> : <span className="badge badge-yellow">Inactive</span>}</td>
                    <td>
                      <button className="ibtn" title="Edit" onClick={() => { setForm(r as unknown as Record<string, unknown>); setEditId(r.id); }}><span className="material-symbols-rounded">edit</span></button>
                      <button className="ibtn danger" title="Delete" onClick={() => setDeleteTarget(r)}><span className="material-symbols-rounded">delete</span></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <ConfirmActionModal open={Boolean(deleteTarget)} title={`Delete ${deleteTarget?.code ?? ''}`} body="Permanently delete this rack?" okLabel="Delete" danger busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={del} />
    </>
  );
}
