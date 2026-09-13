import { useEffect, useState } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';
import type { Store } from './storeTypes';

const PAGE_SIZE = 20;

interface Props {
  onAdd: () => void;
  onEdit: (id: number) => void;
  onView: (id: number) => void;
}

export default function StoreList({ onAdd, onEdit, onView }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Store[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Store | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) });
      if (search) params.set('search', search);
      const { data } = await apiClient.get(`/master/stores?${params}`);
      setRows(data.content ?? data ?? []);
      setTotal(data.totalElements ?? (Array.isArray(data) ? data.length : 0));
    } catch (e) { toast(getApiErrorMessage(e, 'Load failed.'), 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [page, search]);

  const del = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const { data } = await apiClient.delete(`/master/stores/${deleteTarget.id}`);
      toast(data?.deactivated ? (data.message || 'Store is in use; it was deactivated.') : 'Store deleted.', data?.deactivated ? 'success' : undefined);
      setDeleteTarget(null); load();
    } catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  return (
    <>
      <div className="pg-head">
        <h1>Store Master</h1>
        <p>Warehouses, bins, and storage locations</p>
      </div>

      <div className="panel">
        <div className="panel-h" style={{ gap: 12, flexWrap: 'wrap' }}>
          <input className="in" placeholder="Search..." value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={{ maxWidth: 200 }} />
          <span className="count">{total} stores</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-p" onClick={onAdd}>
            <span className="material-symbols-rounded">add</span> Add Store
          </button>
        </div>
        <div className="twrap">
          {loading ? (
            <div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading...</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>#</th>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Department</th>
                  <th>QC Hold</th>
                  <th>WIP</th>
                  <th>FG</th>
                  <th>Active/Inactive</th>
                  <th style={{ width: 120 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={10}><div className="empty"><span className="material-symbols-rounded">description</span> No stores found.</div></td></tr>
                ) : rows.map((r, idx) => (
                  <tr key={r.id}>
                    <td>{page * PAGE_SIZE + idx + 1}</td>
                    <td className="cell-b">{r.code}</td>
                    <td>{r.name}</td>
                    <td>{r.storeType ?? '-'}</td>
                    <td className="mut">{r.department ?? '-'}</td>
                    <td>{r.isQcHold ? <span className="bdg bdg-SUBMITTED">Yes</span> : 'No'}</td>
                    <td>{r.isWip ? <span className="bdg bdg-SUBMITTED">Yes</span> : 'No'}</td>
                    <td>{r.isFinished ? <span className="bdg bdg-COMPLETED">Yes</span> : 'No'}</td>
                    <td><span className={`bdg bdg-${r.active ? 'COMPLETED' : 'CANCELLED'}`}>{r.active ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="ibtn" title="View" onClick={() => onView(r.id)}>
                          <span className="material-symbols-rounded">visibility</span>
                        </button>
                        <button className="ibtn" title="Edit" onClick={() => onEdit(r.id)}>
                          <span className="material-symbols-rounded">edit</span>
                        </button>
                        <button className="ibtn danger" title="Delete" onClick={() => setDeleteTarget(r)}>
                          <span className="material-symbols-rounded">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {total > PAGE_SIZE && (
          <div className="pager">
            <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <span className="material-symbols-rounded">chevron_left</span> Prev
            </button>
            <span>Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}</span>
            <button className="btn btn-sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
              Next <span className="material-symbols-rounded">chevron_right</span>
            </button>
          </div>
        )}
      </div>

      <ConfirmActionModal open={Boolean(deleteTarget)} title={`Delete ${deleteTarget?.code ?? ''}`}
        body="Permanently delete this store?" okLabel="Delete" danger busy={busy}
        onClose={() => setDeleteTarget(null)} onConfirm={del} />
    </>
  );
}
