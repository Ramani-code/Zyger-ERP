import { useEffect, useState } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';

const STORE_TYPES = [
  'Raw Material Store',
  'WIP Store',
  'Finished Goods Store',
  'Tool Store',
  'Consumable Store',
  'Spare Parts Store',
  'Packing Material Store',
  'Quarantine Store',
  'Rejection Store',
  'Scrap Store',
  'General Store',
  'Customer Material Store',
  'Subcontractor Material Store',
  'Dispatch Store',
];

interface StoreItem {
  id: number;
  code: string;
  name: string;
  location?: string;
  description?: string;
  active: boolean;
  storeType?: string;
  department?: string;
  binLocation?: string;
  capacity?: number;
  remarks?: string;
  isRaw?: boolean;
  isWip?: boolean;
  isFinished?: boolean;
  isQcHold?: boolean;
  isScrap?: boolean;
  isDispatch?: boolean;
}

interface RackItem {
  id: number;
  storeId?: number;
  storeName?: string;
  code: string;
  name: string;
  locationNote?: string;
  capacity?: number;
  active: boolean;
}

interface BinItem {
  id: number;
  rackId?: number;
  rackName?: string;
  code: string;
  name: string;
  locationNote?: string;
  active: boolean;
}

export default function StoreScreen() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<'LIST' | 'FORM'>('LIST');
  const [viewOnly, setViewOnly] = useState(false);

  // Stores state
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [storeForm, setStoreForm] = useState<Partial<StoreItem>>({
    code: 'STORE-01', name: '', location: '', description: '', active: true,
    storeType: '', department: '', binLocation: '', capacity: undefined, remarks: '',
    isRaw: false, isWip: false, isFinished: false, isQcHold: false, isScrap: false, isDispatch: false,
  });
  const [editStoreId, setEditStoreId] = useState<number | null>(null);
  const [storeSearch, setStoreSearch] = useState('');
  const [deleteStoreTarget, setDeleteStoreTarget] = useState<StoreItem | null>(null);

  // Racks state
  const [racks, setRacks] = useState<RackItem[]>([]);
  const [rackForm, setRackForm] = useState<Partial<RackItem>>({ code: 'RACK-A01', name: '', locationNote: '', capacity: undefined, active: true });
  const [editRackId, setEditRackId] = useState<number | null>(null);
  const [rackSearch, setRackSearch] = useState('');
  const [deleteRackTarget, setDeleteRackTarget] = useState<RackItem | null>(null);

  // Bins state
  const [bins, setBins] = useState<BinItem[]>([]);
  const [binForm, setBinForm] = useState<Partial<BinItem>>({ code: 'BIN-001', name: '', locationNote: '', active: true });
  const [editBinId, setEditBinId] = useState<number | null>(null);
  const [binSearch, setBinSearch] = useState('');
  const [deleteBinTarget, setDeleteBinTarget] = useState<BinItem | null>(null);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Collapse states
  const [openSec, setOpenSec] = useState({ store: true, rack: true, bin: true });

  const loadAll = async () => {
    setLoading(true);
    try {
      const [sRes, rRes, bRes] = await Promise.all([
        apiClient.get('/master/stores'),
        apiClient.get('/master/racks').catch(() => ({ data: [] })),
        apiClient.get('/master/bins').catch(() => ({ data: [] })),
      ]);
      setStores(sRes.data ?? []);
      setRacks(rRes.data ?? []);
      setBins(bRes.data ?? []);
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to load data.'), 'error');
    }
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const openNewStore = () => {
    setStoreForm({
      code: `STORE-0${stores.length + 1}`, name: '', location: '', description: '', active: true,
      storeType: '', department: '', binLocation: '', capacity: undefined, remarks: '',
      isRaw: false, isWip: false, isFinished: false, isQcHold: false, isScrap: false, isDispatch: false,
    });
    setEditStoreId(null);
    setViewOnly(false);
    setViewMode('FORM');
  };

  // STORE HANDLERS
  const saveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeForm.code?.trim()) { toast('Store Code is required.', 'error'); return; }
    if (!storeForm.name?.trim()) { toast('Store Name is required.', 'error'); return; }
    setBusy(true);
    try {
      if (editStoreId) {
        await apiClient.put(`/master/stores/${editStoreId}`, storeForm);
        toast('Store updated.');
      } else {
        await apiClient.post('/master/stores', storeForm);
        toast('Store created.');
      }
      setViewMode('LIST');
      loadAll();
    } catch (e) { toast(getApiErrorMessage(e, 'Failed to save store.'), 'error'); }
    setBusy(false);
  };

  const delStore = async () => {
    if (!deleteStoreTarget) return;
    const targetId = deleteStoreTarget.id;
    setBusy(true);
    try {
      const { data } = await apiClient.delete(`/master/stores/${targetId}`);
      if (data?.deactivated) {
        toast(data.message || 'Store is in use; it was deactivated.', 'success');
      } else {
        toast('Store deleted.');
        setStores(prev => prev.filter(s => s.id !== targetId));
      }
      setDeleteStoreTarget(null);
      loadAll();
    } catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  // RACK HANDLERS
  const saveRack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rackForm.storeId) { toast('Store is required.', 'error'); return; }
    if (!rackForm.code?.trim()) { toast('Rack Code is required.', 'error'); return; }
    if (!rackForm.name?.trim()) { toast('Rack Name is required.', 'error'); return; }
    setBusy(true);
    try {
      if (editRackId) {
        await apiClient.put(`/master/racks/${editRackId}`, rackForm);
        toast('Rack updated.');
      } else {
        await apiClient.post('/master/racks', rackForm);
        toast('Rack created.');
      }
      setRackForm({ code: `RACK-A0${racks.length + 2}`, name: '', locationNote: '', capacity: undefined, active: true });
      setEditRackId(null);
      loadAll();
    } catch (e) { toast(getApiErrorMessage(e, 'Failed to save rack.'), 'error'); }
    setBusy(false);
  };

  const delRack = async () => {
    if (!deleteRackTarget) return;
    const targetId = deleteRackTarget.id;
    setBusy(true);
    try {
      const { data } = await apiClient.delete(`/master/racks/${targetId}`);
      if (data?.deactivated) {
        toast(data.message || 'Rack is in use; it was deactivated.', 'success');
      } else {
        toast('Rack deleted.');
        setRacks(prev => prev.filter(r => r.id !== targetId));
      }
      setDeleteRackTarget(null);
      loadAll();
    } catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  // BIN HANDLERS
  const saveBin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!binForm.rackId) { toast('Rack is required.', 'error'); return; }
    if (!binForm.code?.trim()) { toast('Bin Code is required.', 'error'); return; }
    if (!binForm.name?.trim()) { toast('Bin Name is required.', 'error'); return; }
    setBusy(true);
    try {
      if (editBinId) {
        await apiClient.put(`/master/bins/${editBinId}`, binForm);
        toast('Bin updated.');
      } else {
        await apiClient.post('/master/bins', binForm);
        toast('Bin created.');
      }
      setBinForm({ code: `BIN-00${bins.length + 2}`, name: '', locationNote: '', active: true });
      setEditBinId(null);
      loadAll();
    } catch (e) { toast(getApiErrorMessage(e, 'Failed to save bin.'), 'error'); }
    setBusy(false);
  };

  const delBin = async () => {
    if (!deleteBinTarget) return;
    const targetId = deleteBinTarget.id;
    setBusy(true);
    try {
      await apiClient.delete(`/master/bins/${targetId}`);
      toast('Bin deleted.');
      setBins(prev => prev.filter(b => b.id !== targetId));
      setDeleteBinTarget(null);
      loadAll();
    } catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  const filteredStores = stores.filter(s => {
    if (!storeSearch.trim()) return true;
    const q = storeSearch.toLowerCase();
    return (s.code && s.code.toLowerCase().includes(q)) || (s.name && s.name.toLowerCase().includes(q)) || (s.location && s.location.toLowerCase().includes(q));
  });

  const filteredRacks = racks.filter(r => {
    if (!rackSearch.trim()) return true;
    const q = rackSearch.toLowerCase();
    return (r.code && r.code.toLowerCase().includes(q)) || (r.name && r.name.toLowerCase().includes(q)) || (r.storeName && r.storeName.toLowerCase().includes(q));
  });

  const filteredBins = bins.filter(b => {
    if (!binSearch.trim()) return true;
    const q = binSearch.toLowerCase();
    return (b.code && b.code.toLowerCase().includes(q)) || (b.name && b.name.toLowerCase().includes(q)) || (b.rackName && b.rackName.toLowerCase().includes(q));
  });

  return (
    <>
      <div className="pg-head pg-head-flex" style={{ marginBottom: '20px' }}>
        <div className="pg-head-text" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {viewMode === 'FORM' && (
            <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span className="material-symbols-rounded">arrow_back</span> Back
            </button>
          )}
          <div>
            <h1>{viewMode === 'LIST' ? 'Store Master' : viewOnly ? 'View Store Master' : editStoreId ? 'Edit Store Master' : 'Create Store Master'}</h1>
            <p>Master -&gt; Inventory -&gt; Store Master. Maintain stores, racks, bins, and physical locations.</p>
          </div>
        </div>
        <div>
          {viewMode === 'LIST' ? (
            <button type="button" className="btn btn-primary" onClick={openNewStore}>
              + Add Store Master
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              {!viewOnly && (
                <button type="button" className="btn btn-primary" onClick={saveStore} disabled={busy}>
                  {busy ? 'Saving...' : 'Save Store'}
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')}>
                {viewOnly ? 'Back to List' : 'Cancel'}
              </button>
            </div>
          )}
        </div>
      </div>

      {viewMode === 'LIST' ? (
        /* TABLE LIST VIEW DEFAULT */
        <div className="panel">
          <div className="panel-h" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 20px' }}>
            <input
              className="in"
              placeholder="Search by Code, Name, Location..."
              value={storeSearch}
              onChange={e => setStoreSearch(e.target.value)}
              style={{ width: '320px' }}
            />
            <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>{filteredStores.length} records</span>
          </div>

          <div className="twrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: '50px' }}>#</th>
                  <th>STORE CODE</th>
                  <th>STORE NAME</th>
                  <th>RACKS</th>
                  <th>BINS</th>
                  <th>LOCATION</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="empty">Loading stores...</td></tr>
                ) : filteredStores.length === 0 ? (
                  <tr><td colSpan={8} className="empty">No stores found.</td></tr>
                ) : (
                  filteredStores.map((s, idx) => {
                    const rackCount = racks.filter(r => r.storeId === s.id).length;
                    const binCount = bins.filter(b => racks.some(r => r.storeId === s.id && (r.id === b.rackId || (b as any).storeId === s.id))).length;
                    return (
                      <tr key={s.id}>
                        <td>{idx + 1}</td>
                        <td style={{ fontWeight: 700 }}>{s.code}</td>
                        <td style={{ fontWeight: 600 }}>{s.name}</td>
                        <td>
                          <span style={{ fontWeight: 700, color: '#1e3a8a', backgroundColor: '#eff6ff', padding: '2px 8px', borderRadius: '4px', fontSize: '0.85rem' }}>
                            {rackCount} Racks
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 700, color: '#0284c7', backgroundColor: '#f0f9ff', padding: '2px 8px', borderRadius: '4px', fontSize: '0.85rem' }}>
                            {binCount} Bins
                          </span>
                        </td>
                        <td>{s.location || '—'}</td>
                        <td><span style={{ fontWeight: 700, color: s.active ? '#166534' : '#dc2626' }}>{s.active ? 'Active' : 'Inactive'}</span></td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button type="button" className="ibtn" title="View" onClick={() => { setStoreForm(s); setEditStoreId(s.id); setViewOnly(true); setViewMode('FORM'); }}>
                              <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>visibility</span>
                            </button>
                            <button type="button" className="ibtn" title="Edit" onClick={() => { setStoreForm(s); setEditStoreId(s.id); setViewOnly(false); setViewMode('FORM'); }}>
                              <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>edit</span>
                            </button>
                            <button type="button" className="ibtn danger" title="Delete" onClick={() => setDeleteStoreTarget(s)}>
                              <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="pager" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Showing 1–{filteredStores.length} of {filteredStores.length}</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button type="button" className="btn btn-sm" disabled>&lt;</button>
              <button type="button" className="btn btn-sm btn-primary">1</button>
              <button type="button" className="btn btn-sm" disabled>&gt;</button>
            </div>
          </div>
        </div>
      ) : (
        /* FORM VIEW INPUT PAGE */
        <>
          {/* SECTION 1: STORE MASTER */}
          <div className="sec-head" onClick={() => setOpenSec(s => ({ ...s, store: !s.store }))} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">location_on</span>
              <span>{viewOnly ? 'View Store Details' : editStoreId ? 'Edit Store Details' : 'Create Store'}</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.store ? 'expand_less' : 'expand_more'}</span>
          </div>

          {openSec.store && (
            <div className="sec-body" style={{ marginBottom: '24px' }}>
              <form onSubmit={saveStore}>
                <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                  <label className="fld">
                    <span>STORE CODE *</span>
                    <input className="in" type="text" required disabled={viewOnly} value={storeForm.code || ''} onChange={e => setStoreForm(c => ({ ...c, code: e.target.value }))} placeholder="STORE-01" />
                  </label>
                  <label className="fld">
                    <span>STORE NAME *</span>
                    <input className="in" type="text" required disabled={viewOnly} value={storeForm.name || ''} onChange={e => setStoreForm(c => ({ ...c, name: e.target.value }))} placeholder="Main Store" />
                  </label>
                  <label className="fld">
                    <span>LOCATION *</span>
                    <input className="in" type="text" required disabled={viewOnly} value={storeForm.location || ''} onChange={e => setStoreForm(c => ({ ...c, location: e.target.value }))} placeholder="Plant / Building / Floor" />
                  </label>
                  <label className="fld">
                    <span>STORE TYPE</span>
                    <select
                      className="in"
                      disabled={viewOnly}
                      value={storeForm.storeType || ''}
                      onChange={e => setStoreForm(c => ({ ...c, storeType: e.target.value }))}
                    >
                      <option value="">Select...</option>
                      {STORE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                  <label className="fld">
                    <span>DEPARTMENT</span>
                    <input className="in" type="text" disabled={viewOnly} value={storeForm.department || ''} onChange={e => setStoreForm(c => ({ ...c, department: e.target.value }))} />
                  </label>
                  <label className="fld">
                    <span>BIN LOCATION</span>
                    <input className="in" type="text" disabled={viewOnly} value={storeForm.binLocation || ''} onChange={e => setStoreForm(c => ({ ...c, binLocation: e.target.value }))} />
                  </label>
                  <label className="fld">
                    <span>CAPACITY</span>
                    <input className="in" type="number" step="0.01" disabled={viewOnly} value={storeForm.capacity ?? ''} onChange={e => setStoreForm(c => ({ ...c, capacity: e.target.value === '' ? undefined : parseFloat(e.target.value) }))} />
                  </label>
                  <label className="fld">
                    <span>STATUS</span>
                    <select
                      className="in"
                      disabled={viewOnly}
                      value={storeForm.active !== false ? 'Active' : 'Inactive'}
                      onChange={e => setStoreForm(c => ({ ...c, active: e.target.value === 'Active' }))}
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </label>
                  <label className="fld span3">
                    <span>USAGE FLAGS</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', paddingTop: '6px' }}>
                      {([
                        ['isRaw', 'Raw Material'],
                        ['isWip', 'WIP'],
                        ['isFinished', 'Finished Goods'],
                        ['isQcHold', 'QC Hold'],
                        ['isScrap', 'Scrap'],
                        ['isDispatch', 'Dispatch'],
                      ] as const).map(([field, label]) => (
                        <label key={field} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 400 }}>
                          <input
                            type="checkbox"
                            disabled={viewOnly}
                            checked={!!storeForm[field]}
                            onChange={e => setStoreForm(c => ({ ...c, [field]: e.target.checked }))}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </label>
                  <label className="fld span2">
                    <span>DESCRIPTION</span>
                    <textarea className="in" disabled={viewOnly} value={storeForm.description || ''} onChange={e => setStoreForm(c => ({ ...c, description: e.target.value }))} />
                  </label>
                  <label className="fld span2">
                    <span>REMARKS</span>
                    <textarea className="in" disabled={viewOnly} value={storeForm.remarks || ''} onChange={e => setStoreForm(c => ({ ...c, remarks: e.target.value }))} />
                  </label>
                </div>

                {!viewOnly && (
                  <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                    <button type="submit" className="btn btn-primary" disabled={busy}>Save Store</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')}>Cancel</button>
                  </div>
                )}
              </form>
            </div>
          )}

          {/* SECTION 2: RACK MASTER */}
          <div className="sec-head" onClick={() => setOpenSec(s => ({ ...s, rack: !s.rack }))} style={{ cursor: 'pointer', marginTop: '24px' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">shelves</span>
              <span>Rack Master</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.rack ? 'expand_less' : 'expand_more'}</span>
          </div>

          {openSec.rack && (
            <div className="sec-body" style={{ marginBottom: '24px' }}>
              <form onSubmit={saveRack}>
                <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                  <label className="fld">
                    <span>STORE *</span>
                    <select className="in" required disabled={viewOnly} value={rackForm.storeId || ''} onChange={e => setRackForm(c => ({ ...c, storeId: e.target.value ? Number(e.target.value) : undefined }))}>
                      <option value="">Select...</option>
                      {stores.map(s => (
                        <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                      ))}
                    </select>
                  </label>
                  <label className="fld">
                    <span>RACK CODE *</span>
                    <input className="in" type="text" required disabled={viewOnly} value={rackForm.code || ''} onChange={e => setRackForm(c => ({ ...c, code: e.target.value }))} placeholder="RACK-A01" />
                  </label>
                  <label className="fld">
                    <span>RACK NAME *</span>
                    <input className="in" type="text" required disabled={viewOnly} value={rackForm.name || ''} onChange={e => setRackForm(c => ({ ...c, name: e.target.value }))} placeholder="Gear Rack" />
                  </label>
                  <label className="fld">
                    <span>RACK LOCATION NOTE</span>
                    <input className="in" type="text" disabled={viewOnly} value={rackForm.locationNote || ''} onChange={e => setRackForm(c => ({ ...c, locationNote: e.target.value }))} placeholder="Left aisle / Ground floor" />
                  </label>
                  <label className="fld">
                    <span>CAPACITY</span>
                    <input className="in" type="number" disabled={viewOnly} value={rackForm.capacity ?? ''} onChange={e => setRackForm(c => ({ ...c, capacity: e.target.value ? Number(e.target.value) : undefined }))} placeholder="250" />
                  </label>
                  <label className="fld">
                    <span>STATUS</span>
                    <select
                      className="in"
                      disabled={viewOnly}
                      value={rackForm.active !== false ? 'Active' : 'Inactive'}
                      onChange={e => setRackForm(c => ({ ...c, active: e.target.value === 'Active' }))}
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </label>
                </div>

                {!viewOnly && (
                  <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                    <button type="submit" className="btn btn-primary" disabled={busy}>Save Rack</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')}>Cancel</button>
                  </div>
                )}
              </form>

              {/* Racks List Table */}
              <div className="panel" style={{ marginTop: '24px', marginBottom: 0 }}>
                <div className="panel-h" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 16px' }}>
                  <input className="in" placeholder="Search..." value={rackSearch} onChange={e => setRackSearch(e.target.value)} style={{ width: '260px' }} />
                  <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>{filteredRacks.length} records</span>
                </div>

                <div className="twrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ width: '50px' }}>#</th>
                        <th>STORE</th>
                        <th>RACK CODE</th>
                        <th>RACK NAME</th>
                        <th>LOCATION NOTE</th>
                        <th>CAPACITY</th>
                        <th>STATUS</th>
                        <th>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRacks.length === 0 ? (
                        <tr><td colSpan={8} className="empty">No racks found.</td></tr>
                      ) : (
                        filteredRacks.map((r, idx) => (
                          <tr key={r.id}>
                            <td>{idx + 1}</td>
                            <td>{r.storeName || 'Production Store'}</td>
                            <td style={{ fontWeight: 700 }}>{r.code}</td>
                            <td style={{ fontWeight: 600 }}>{r.name}</td>
                            <td style={{ color: '#64748b' }}>{r.locationNote || '—'}</td>
                            <td>{r.capacity ?? '—'}</td>
                            <td><span style={{ fontWeight: 700, color: r.active ? '#166534' : '#dc2626' }}>{r.active ? 'Active' : 'Inactive'}</span></td>
                            <td>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                {!viewOnly && (
                                  <>
                                    <button type="button" className="ibtn" title="Edit" onClick={() => { setRackForm(r); setEditRackId(r.id); }}>
                                      <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>edit</span>
                                    </button>
                                    <button type="button" className="ibtn danger" title="Delete" onClick={() => setDeleteRackTarget(r)}>
                                      <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>delete</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 3: BIN MASTER */}
          <div className="sec-head" onClick={() => setOpenSec(s => ({ ...s, bin: !s.bin }))} style={{ cursor: 'pointer', marginTop: '24px' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">inventory</span>
              <span>Bin Master</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.bin ? 'expand_less' : 'expand_more'}</span>
          </div>

          {openSec.bin && (
            <div className="sec-body" style={{ marginBottom: '24px' }}>
              <form onSubmit={saveBin}>
                <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                  <label className="fld">
                    <span>RACK *</span>
                    <select className="in" required disabled={viewOnly} value={binForm.rackId || ''} onChange={e => setBinForm(c => ({ ...c, rackId: e.target.value ? Number(e.target.value) : undefined }))}>
                      <option value="">Select...</option>
                      {racks.map(r => (
                        <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
                      ))}
                    </select>
                  </label>
                  <label className="fld">
                    <span>BIN CODE *</span>
                    <input className="in" type="text" required disabled={viewOnly} value={binForm.code || ''} onChange={e => setBinForm(c => ({ ...c, code: e.target.value }))} placeholder="BIN-001" />
                  </label>
                  <label className="fld">
                    <span>BIN NAME *</span>
                    <input className="in" type="text" required disabled={viewOnly} value={binForm.name || ''} onChange={e => setBinForm(c => ({ ...c, name: e.target.value }))} placeholder="Gear" />
                  </label>
                  <label className="fld">
                    <span>BIN LOCATION NOTE</span>
                    <input className="in" type="text" disabled={viewOnly} value={binForm.locationNote || ''} onChange={e => setBinForm(c => ({ ...c, locationNote: e.target.value }))} placeholder="Shelf 1 / Level 2" />
                  </label>
                  <label className="fld">
                    <span>STATUS</span>
                    <select
                      className="in"
                      disabled={viewOnly}
                      value={binForm.active !== false ? 'Active' : 'Inactive'}
                      onChange={e => setBinForm(c => ({ ...c, active: e.target.value === 'Active' }))}
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </label>
                </div>

                {!viewOnly && (
                  <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                    <button type="submit" className="btn btn-primary" disabled={busy}>Save Bin</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')}>Cancel</button>
                  </div>
                )}
              </form>

              {/* Bins List Table */}
              <div className="panel" style={{ marginTop: '24px', marginBottom: 0 }}>
                <div className="panel-h" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 16px' }}>
                  <input className="in" placeholder="Search..." value={binSearch} onChange={e => setBinSearch(e.target.value)} style={{ width: '260px' }} />
                  <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>{filteredBins.length} records</span>
                </div>

                <div className="twrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ width: '50px' }}>#</th>
                        <th>RACK</th>
                        <th>BIN CODE</th>
                        <th>BIN NAME</th>
                        <th>LOCATION NOTE</th>
                        <th>STATUS</th>
                        <th>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBins.length === 0 ? (
                        <tr><td colSpan={7} className="empty">No bins found.</td></tr>
                      ) : (
                        filteredBins.map((b, idx) => (
                          <tr key={b.id}>
                            <td>{idx + 1}</td>
                            <td>{b.rackName || 'Gear Rack'}</td>
                            <td style={{ fontWeight: 700 }}>{b.code}</td>
                            <td style={{ fontWeight: 600 }}>{b.name}</td>
                            <td style={{ color: '#64748b' }}>{b.locationNote || '—'}</td>
                            <td><span style={{ fontWeight: 700, color: b.active ? '#166534' : '#dc2626' }}>{b.active ? 'Active' : 'Inactive'}</span></td>
                            <td>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button type="button" className="ibtn" title="Edit" onClick={() => { setBinForm(b); setEditBinId(b.id); }}>
                                  <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>edit</span>
                                </button>
                                <button type="button" className="ibtn danger" title="Delete" onClick={() => setDeleteBinTarget(b)}>
                                  <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>delete</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Delete Modals */}
      <ConfirmActionModal open={Boolean(deleteStoreTarget)} title={`Delete ${deleteStoreTarget?.code ?? ''}`} body="Permanently delete this store?" okLabel="Delete" danger busy={busy} onClose={() => setDeleteStoreTarget(null)} onConfirm={delStore} />
      <ConfirmActionModal open={Boolean(deleteRackTarget)} title={`Delete ${deleteRackTarget?.code ?? ''}`} body="Permanently delete this rack?" okLabel="Delete" danger busy={busy} onClose={() => setDeleteRackTarget(null)} onConfirm={delRack} />
      <ConfirmActionModal open={Boolean(deleteBinTarget)} title={`Delete ${deleteBinTarget?.code ?? ''}`} body="Permanently delete this bin?" okLabel="Delete" danger busy={busy} onClose={() => setDeleteBinTarget(null)} onConfirm={delBin} />
    </>
  );
}
