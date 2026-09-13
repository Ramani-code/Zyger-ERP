import { useEffect, useState } from 'react';
import apiClient from '../../api/axiosClient';
import { useToast } from '../../contexts/ToastContext';
import { getApiErrorMessage } from '../../utils/apiError';
import ConfirmActionModal from '../../components/common/ConfirmActionModal';

interface Item {
  id: number; code: string; description: string; uom?: string;
  category?: string; itemType?: string; defaultRate?: number;
  safetyStock?: number; active: boolean; requiresBatch?: boolean;
  requiresHeat?: boolean; drawingNumber?: string; drawingRevision?: string;
  revision?: string; leadTimeDays?: number; minOrderQty?: number;
  orderMultiple?: number; shelfLifeDays?: number;
  batchControl?: boolean; serialControl?: boolean;
  inspectionRequired?: boolean; defaultWarehouse?: string;
  itemGroup?: string; weight?: number;
}

const PAGE_SIZE = 20;

export default function ItemMasterScreen() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const [groupRows, setGroupRows] = useState<Array<{id:number;code:string;name:string;itemType?:string}>>([]);

  useEffect(() => { apiClient.get('/master/item-groups?activeOnly=false').then(r => setGroupRows(r.data ?? [])).catch(() => {}); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) });
      if (search) params.set('search', search);
      if (catFilter) params.set('category', catFilter);
      const { data } = await apiClient.get(`/master/items?${params}`);
      setRows(data.content);
      setTotal(data.totalElements);
    } catch (e) { toast(getApiErrorMessage(e, 'Load failed.'), 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [page, search, catFilter]);

  const save = async () => {
    if (!String(form.code ?? '').trim()) { toast('Code is required.', 'error'); return; }
    if (!String(form.description ?? '').trim()) { toast('Description is required.', 'error'); return; }
    setBusy(true);
    try {
      if (editId) {
        await apiClient.put(`/master/items/${editId}`, form);
        toast('Item updated.');
      } else {
        await apiClient.post('/master/items', form);
        toast('Item created.');
      }
      setForm({}); setEditId(null); load();
    } catch (e) { toast(getApiErrorMessage(e, 'Save failed.'), 'error'); }
    setBusy(false);
  };

  const del = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiClient.delete(`/master/items/${deleteTarget.id}`);
      toast('Item deleted.');
      setDeleteTarget(null); load();
    } catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  const set = (k: string, v: unknown) => setForm((c) => ({ ...c, [k]: v }));

  const visibleGroups = groupRows.filter((g) => {
    const it = String(form.itemType ?? '').toUpperCase();
    if (it === 'RAW') return g.itemType === 'PURCHASABLE' || g.itemType === 'RAW_MATERIAL';
    if (it === 'FG' || it === 'SFG') return g.itemType === 'MANUFACTURING' || g.itemType === 'FG' || g.itemType === 'SEMI_FG';
    return true;
  });

  return (
    <>
      <div className="pg-head">
        <h1>Item Master</h1>
        <p>Manage items, materials, and parts</p>
      </div>

      <div className="panel">
        <div className="panel-h">
          <h2><span className="material-symbols-rounded">add</span> {editId ? 'Edit' : 'Add'} Item</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button type="button" className={`btn btn-sm ${activeTab === 'basic' ? 'btn-p' : ''}`} onClick={() => setActiveTab('basic')}>Basic Info</button>
          <button type="button" className={`btn btn-sm ${activeTab === 'purchase' ? 'btn-p' : ''}`} onClick={() => setActiveTab('purchase')}>Purchase</button>
          <button type="button" className={`btn btn-sm ${activeTab === 'sales' ? 'btn-p' : ''}`} onClick={() => setActiveTab('sales')}>Sales</button>
          <button type="button" className={`btn btn-sm ${activeTab === 'engineering' ? 'btn-p' : ''}`} onClick={() => setActiveTab('engineering')}>Engineering</button>
          <button type="button" className={`btn btn-sm ${activeTab === 'inventory' ? 'btn-p' : ''}`} onClick={() => setActiveTab('inventory')}>Inventory</button>
        </div>
        <div className="fgrid">
          {activeTab === 'basic' && (
            <>
              <label className="fld"><span>Code *</span>
                <input className="in" value={String(form.code ?? '')} onChange={(e) => set('code', e.target.value)} />
              </label>
              <label className="fld"><span>Description *</span>
                <input className="in" value={String(form.description ?? '')} onChange={(e) => set('description', e.target.value)} />
              </label>
              <label className="fld"><span>UOM</span>
                <select className="in" value={String(form.uom ?? '')} onChange={(e) => set('uom', e.target.value)}>
                  <option value="">Select...</option>
                  <option value="NOS">Nos</option>
                  <option value="KG">Kg</option>
                  <option value="MTR">Meter</option>
                  <option value="LTR">Litre</option>
                  <option value="SQM">Sq. Meter</option>
                  <option value="SET">Set</option>
                  <option value="BOX">Box</option>
                  <option value="PCS">Pcs</option>
                </select>
              </label>
              <label className="fld"><span>Category</span>
                <input className="in" value={String(form.category ?? '')} onChange={(e) => set('category', e.target.value)} />
              </label>
              <label className="fld"><span>Item Group</span>
                <select className="in" value={String(form.itemGroupId ?? '')} onChange={(e) => set('itemGroupId', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Select...</option>
                  {visibleGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
              <label className="fld"><span>Item Type</span>
                <select className="in" value={String(form.itemType ?? '')} onChange={(e) => set('itemType', e.target.value)}>
                  <option value="">Select...</option>
                  <option value="RAW">Raw Material</option>
                  <option value="FG">Finished Good</option>
                  <option value="SFG">Semi-Finished</option>
                  <option value="CONSUMABLE">Consumable</option>
                  <option value="TOOL">Tool</option>
                  <option value="SPARE">Spare Part</option>
                </select>
              </label>
              <label className="fld"><span>Weight of Material (kg)</span>
                <input className="in" type="number" step="0.001" placeholder="e.g. 1.250" value={form.weight != null ? String(form.weight) : ''} onChange={(e) => set('weight', e.target.value ? Number(e.target.value) : null)} />
              </label>
              <label className="fld"><span>Active</span>
                <select className="in" value={String(form.active ?? 'true')} onChange={(e) => set('active', e.target.value === 'true')}>
                  <option value="true">Yes</option><option value="false">No</option>
                </select>
              </label>
            </>
          )}
          {activeTab === 'purchase' && (
            <>
              <label className="fld"><span>Lead Time (Days)</span>
                <input className="in" type="number" value={String(form.leadTimeDays ?? '')} onChange={(e) => set('leadTimeDays', e.target.value ? Number(e.target.value) : null)} />
              </label>
              <label className="fld"><span>Min Order Qty</span>
                <input className="in" type="number" step="0.01" value={String(form.minOrderQty ?? '')} onChange={(e) => set('minOrderQty', e.target.value ? Number(e.target.value) : null)} />
              </label>
            </>
          )}
          {activeTab === 'sales' && (
            <>
              <label className="fld"><span>Default Rate</span>
                <input className="in" type="number" step="0.01" value={String(form.defaultRate ?? '')} onChange={(e) => set('defaultRate', e.target.value ? Number(e.target.value) : null)} />
              </label>
            </>
          )}
          {activeTab === 'engineering' && (
            <>
              <label className="fld"><span>Drawing Number</span>
                <input className="in" value={String(form.drawingNumber ?? '')} onChange={(e) => set('drawingNumber', e.target.value)} />
              </label>
              <label className="fld"><span>Drawing Revision</span>
                <input className="in" value={String(form.drawingRevision ?? '')} onChange={(e) => set('drawingRevision', e.target.value)} />
              </label>
            </>
          )}
          {activeTab === 'inventory' && (
            <>
              <label className="fld"><span>Safety Stock</span>
                <input className="in" type="number" step="0.01" value={String(form.safetyStock ?? '')} onChange={(e) => set('safetyStock', e.target.value ? Number(e.target.value) : null)} />
              </label>
              <label className="fld"><span>Default Warehouse</span>
                <input className="in" value={String(form.defaultWarehouse ?? '')} onChange={(e) => set('defaultWarehouse', e.target.value)} />
              </label>
              <label className="fld"><span>Batch Control</span>
                <select className="in" value={String(form.batchControl ?? false)} onChange={(e) => set('batchControl', e.target.value === 'true')}>
                  <option value="false">No</option><option value="true">Yes</option>
                </select>
              </label>
              <label className="fld"><span>Serial Control</span>
                <select className="in" value={String(form.serialControl ?? false)} onChange={(e) => set('serialControl', e.target.value === 'true')}>
                  <option value="false">No</option><option value="true">Yes</option>
                </select>
              </label>
              <label className="fld"><span>Inspection Required</span>
                <select className="in" value={String(form.inspectionRequired ?? false)} onChange={(e) => set('inspectionRequired', e.target.value === 'true')}>
                  <option value="false">No</option><option value="true">Yes</option>
                </select>
              </label>
              <label className="fld"><span>Serial Generation Rule</span>
                <select className="in" value={String(form.serialGenerationRule ?? 'NONE')} onChange={(e) => set('serialGenerationRule', e.target.value)}>
                  <option value="NONE">None</option>
                  <option value="AUTO_SEQUENTIAL">Auto Sequential</option>
                  <option value="WO_LINKED">Work Order Linked</option>
                </select>
              </label>
              <label className="fld"><span>FG Serial Prefix Pattern</span>
                <input className="in" placeholder="e.g. {ItemCode}-{WONumber}" value={String(form.fgSerialPrefix ?? '')} onChange={(e) => set('fgSerialPrefix', e.target.value)} />
              </label>
            </>
          )}
        </div>
        <div className="actbar" style={{ justifyContent: 'flex-end' }}>
          {editId && <button className="btn" onClick={() => { setForm({}); setEditId(null); }} disabled={busy}>Cancel</button>}
          <button className="btn btn-p" onClick={save} disabled={busy}>{editId ? 'Update' : 'Create'}</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-h" style={{ gap: 12, flexWrap: 'wrap' }}>
          <input className="in" placeholder="Search..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={{ maxWidth: 200 }} />
          <input className="in" placeholder="Category filter..." value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(0); }} style={{ maxWidth: 150 }} />
          <span style={{ color: '#888', fontSize: 13 }}>{total} items</span>
        </div>
        <div className="twrap">
          {loading ? (
            <div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading...</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th className="num">S.No</th><th>Code</th><th>Description</th><th>UOM</th><th>Weight of Material (kg)</th><th>Group</th><th>Category</th><th>Type</th><th>Rate</th><th>Active</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={11}><div className="empty"><span className="material-symbols-rounded">description</span> No items.</div></td></tr>
                ) : rows.map((r, idx) => (
                  <tr key={r.id}>
                    <td className="num mut">{page * PAGE_SIZE + idx + 1}</td>
                    <td>{r.code}</td>
                    <td>{r.description}</td>
                    <td>{r.uom ?? ''}</td>
                    <td>{r.weight != null && Number(r.weight) > 0 ? `${r.weight} kg` : '—'}</td>
                    <td>{groupRows.find(g => g.code === r.itemGroup)?.name ?? r.itemGroup ?? ''}</td>
                    <td>{r.category ?? ''}</td>
                    <td>{r.itemType ?? ''}</td>
                    <td>{r.defaultRate != null ? `₹${r.defaultRate}` : ''}</td>
                    <td>{r.active ? 'Yes' : 'No'}</td>
                    <td>
                      <button className="ibtn" title="Edit" onClick={() => { const g = groupRows.find(x => x.code === (r as unknown as Record<string, unknown>).itemGroup); setForm({ ...(r as unknown as Record<string, unknown>), itemGroupId: g?.id ?? null }); setEditId(r.id); }}>
                        <span className="material-symbols-rounded">edit</span>
                      </button>
                      <button className="ibtn danger" title="Delete" onClick={() => setDeleteTarget(r)}>
                        <span className="material-symbols-rounded">delete</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {total > PAGE_SIZE && (
          <div className="actbar" style={{ justifyContent: 'center', gap: 8 }}>
            <button className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
            <span style={{ color: '#666' }}>Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}</span>
            <button className="btn" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </div>

      <ConfirmActionModal open={Boolean(deleteTarget)} title={`Delete ${deleteTarget?.code ?? ''}`} body="Permanently delete this item?" okLabel="Delete" danger busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={del} />
    </>
  );
}
