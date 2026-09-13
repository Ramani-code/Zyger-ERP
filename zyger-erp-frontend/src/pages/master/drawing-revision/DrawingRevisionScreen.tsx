import { useEffect, useState } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';

export interface DrawingRevisionItem {
  id: number;
  drawingNumber: string;
  revision: string;
  effectiveDate?: string;
  attachedFilePath?: string;
  status: 'Active' | 'Superseded';
}

export default function DrawingRevisionScreen() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<'LIST' | 'FORM'>('LIST');
  const [rows, setRows] = useState<DrawingRevisionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DrawingRevisionItem | null>(null);

  const [drawingNumber, setDrawingNumber] = useState('');
  const [revision, setRevision] = useState('A');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [attachedFilePath, setAttachedFilePath] = useState('');
  const [status, setStatus] = useState<'Active' | 'Superseded'>('Active');

  const loadAll = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/master/drawing-revisions');
      setRows(data?.content ?? data ?? []);
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to load drawing revisions.'), 'error');
    }
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const openNew = () => {
    setEditId(null);
    setDrawingNumber(''); setRevision('A'); setEffectiveDate('');
    setAttachedFilePath(''); setStatus('Active');
    setViewMode('FORM');
  };

  const openEdit = (item: DrawingRevisionItem) => {
    setEditId(item.id);
    setDrawingNumber(item.drawingNumber || '');
    setRevision(item.revision || 'A');
    setEffectiveDate(item.effectiveDate || '');
    setAttachedFilePath(item.attachedFilePath || '');
    setStatus(item.status || 'Active');
    setViewMode('FORM');
  };

  const save = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!drawingNumber.trim()) { toast('Drawing Number is required.', 'error'); return; }
    if (!revision.trim()) { toast('Revision is required.', 'error'); return; }

    setBusy(true);
    try {
      const payload = { drawingNumber, revision, effectiveDate: effectiveDate || null, attachedFilePath, status };
      if (editId) {
        await apiClient.put(`/master/drawing-revisions/${editId}`, payload);
        toast('Drawing revision updated successfully.');
      } else {
        await apiClient.post('/master/drawing-revisions', payload);
        toast(status === 'Active'
          ? 'Drawing revision created — any prior Active revision for this drawing was superseded automatically.'
          : 'Drawing revision created successfully.');
      }
      setViewMode('LIST');
      loadAll();
    } catch (err) {
      toast(getApiErrorMessage(err, 'Failed to save drawing revision.'), 'error');
    }
    setBusy(false);
  };

  const del = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiClient.delete(`/master/drawing-revisions/${deleteTarget.id}`);
      toast('Drawing revision marked Superseded.');
      setDeleteTarget(null);
      loadAll();
    } catch (e) {
      toast(getApiErrorMessage(e, 'Delete failed.'), 'error');
    }
    setBusy(false);
  };

  const filteredRows = rows.filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (r.drawingNumber && r.drawingNumber.toLowerCase().includes(q)) || (r.revision && r.revision.toLowerCase().includes(q));
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
            <h1>{viewMode === 'LIST' ? 'Drawing & Revision Master' : editId ? 'Edit Drawing Revision' : 'New Drawing Revision'}</h1>
            <p>Master -&gt; Engineering -&gt; Drawing & Revision Master. Only one Active revision per drawing number at a time.</p>
          </div>
        </div>
        <div>
          {viewMode === 'LIST' ? (
            <button type="button" className="btn btn-primary" onClick={openNew}>+ Add Revision</button>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn btn-primary" onClick={() => save()} disabled={busy}>
                {busy ? 'Saving...' : 'Save Revision'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')}>Cancel</button>
            </div>
          )}
        </div>
      </div>

      {viewMode === 'LIST' ? (
        <div className="panel">
          <div className="panel-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <input type="text" className="in" placeholder="Search Drawing No, Revision..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: '280px' }} />
              <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>{filteredRows.length} records</span>
            </div>
          </div>

          <div className="twrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="num">S.No</th>
                  <th>DRAWING NO</th>
                  <th>REVISION</th>
                  <th>EFFECTIVE DATE</th>
                  <th>ATTACHMENT</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="empty">Loading drawing revisions...</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={7} className="empty">No drawing revisions found.</td></tr>
                ) : (
                  filteredRows.map((r, idx) => (
                    <tr key={r.id}>
                      <td className="num mut">{idx + 1}</td>
                      <td style={{ fontWeight: 700, color: '#0f172a' }}>{r.drawingNumber}</td>
                      <td style={{ fontWeight: 600 }}>{r.revision}</td>
                      <td>{r.effectiveDate || '—'}</td>
                      <td>{r.attachedFilePath ? 'Attached' : '—'}</td>
                      <td>{r.status === 'Active'
                        ? <span style={{ fontWeight: 700, color: '#166534', backgroundColor: '#dcfce7', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>Active</span>
                        : <span style={{ fontWeight: 700, color: '#475569', backgroundColor: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>Superseded</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button type="button" className="ibtn" title="Edit" onClick={() => openEdit(r)}>
                            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>edit</span>
                          </button>
                          <button type="button" className="ibtn danger" title="Mark Superseded" onClick={() => setDeleteTarget(r)}>
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

          <div className="pager" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Showing 1–{filteredRows.length} of {filteredRows.length}</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button type="button" className="btn btn-sm" disabled>&lt;</button>
              <button type="button" className="btn btn-sm btn-primary">1</button>
              <button type="button" className="btn btn-sm" disabled>&gt;</button>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={save}>
          <div className="sec-head">
            <div className="sec-title">
              <span className="material-symbols-rounded">design_services</span>
              <span>Drawing Revision Details</span>
            </div>
          </div>

          <div className="sec-body" style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: '0 0 12px 12px', padding: '24px', marginBottom: '24px' }}>
            <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
              <label className="fld">
                <span>DRAWING NUMBER *</span>
                <input className="in" type="text" required placeholder="DWG-10045" value={drawingNumber} onChange={e => setDrawingNumber(e.target.value)} disabled={!!editId} />
              </label>
              <label className="fld">
                <span>REVISION *</span>
                <input className="in" type="text" required placeholder="A" value={revision} onChange={e => setRevision(e.target.value)} />
              </label>
              <label className="fld">
                <span>EFFECTIVE DATE</span>
                <input className="in" type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
              </label>
              <label className="fld">
                <span>ATTACHED FILE PATH</span>
                <input className="in" type="text" placeholder="/attachments/drawings/DWG-10045-A.pdf" value={attachedFilePath} onChange={e => setAttachedFilePath(e.target.value)} />
              </label>
              <label className="fld">
                <span>STATUS</span>
                <select className="in" value={status} onChange={e => setStatus(e.target.value as 'Active' | 'Superseded')}>
                  <option value="Active">Active</option>
                  <option value="Superseded">Superseded</option>
                </select>
              </label>
            </div>

            {status === 'Active' && (
              <p style={{ fontSize: '0.8rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 12px', marginBottom: '20px' }}>
                Saving this as Active will automatically mark any other Active revision for drawing "{drawingNumber || '…'}" as Superseded.
              </p>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving...' : 'Save Revision'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')}>Cancel</button>
            </div>
          </div>
        </form>
      )}

      <ConfirmActionModal
        open={Boolean(deleteTarget)}
        title={`Mark ${deleteTarget?.drawingNumber ?? ''} Rev ${deleteTarget?.revision ?? ''} Superseded`}
        body="This drawing revision will be marked Superseded (not deleted, to preserve history)."
        okLabel="Mark Superseded"
        danger
        busy={busy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={del}
      />
    </>
  );
}
