import { useEffect, useState, useCallback } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';

interface MachineCapability {
  id: number;
  machineCode: string;
  operationCode: string;
  partFamily: string | null;
  remarks: string | null;
  active: boolean;
}

export default function MachineCapabilityScreen() {
  const { toast } = useToast();
  const { can } = useAuth();
  const [rows, setRows] = useState<MachineCapability[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<MachineCapability | null>(null);
  const [machines, setMachines] = useState<Array<{ code: string; name: string }>>([]);

  const fetchMachines = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/master/machines', { params: { size: 500 } });
      setMachines((data?.content ?? data ?? []).filter((m: any) => m.active !== false));
    } catch { /* best-effort */ }
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/v1/production/machine-capabilities');
      setRows(Array.isArray(data) ? data : []);
    } catch (e) { toast(getApiErrorMessage(e, 'Load failed.'), 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(); fetchMachines(); }, [fetchMachines]);

  const set = (k: string, v: unknown) => setForm((c) => ({ ...c, [k]: v }));

  const save = async () => {
    if (!String(form.machineCode ?? '').trim()) { toast('Machine is required.', 'error'); return; }
    if (!String(form.operationCode ?? '').trim()) { toast('Operation Code is required.', 'error'); return; }
    setBusy(true);
    try {
      await apiClient.post('/v1/production/machine-capabilities', form);
      toast('Capability added.');
      setForm({});
      load();
    } catch (e) { toast(getApiErrorMessage(e, 'Save failed.'), 'error'); }
    setBusy(false);
  };

  const del = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiClient.delete(`/v1/production/machine-capabilities/${deleteTarget.id}`);
      toast('Removed.');
      setDeleteTarget(null);
      load();
    } catch (e) { toast(getApiErrorMessage(e, 'Delete failed.'), 'error'); }
    setBusy(false);
  };

  const filtered = rows.filter((r) => !search
    || r.machineCode.toLowerCase().includes(search.toLowerCase())
    || r.operationCode.toLowerCase().includes(search.toLowerCase()));

  const machinesWithCapabilities = new Set(rows.map((r) => r.machineCode));

  return (
    <>
      <div className="pg-head">
        <h1>Machine Capability Matrix</h1>
        <p>Which operations each machine is qualified to run — filters machine choice on the Job Card.
          A machine with no rows here stays unrestricted, so nothing already in use is affected until you add its first row.</p>
      </div>

      <div className="panel">
        <div className="panel-h"><h2>Add Capability</h2></div>
        <div className="fgrid">
          <label className="fld"><span>Machine *</span>
            <select className="in" value={String(form.machineCode ?? '')} onChange={(e) => set('machineCode', e.target.value)}>
              <option value="">Select machine...</option>
              {machines.map((m) => <option key={m.code} value={m.code}>{m.code} - {m.name}</option>)}
            </select>
          </label>
          <label className="fld"><span>Operation Code *</span><input className="in" placeholder="e.g. TURNING, MILLING" value={String(form.operationCode ?? '')} onChange={(e) => set('operationCode', e.target.value)} /></label>
          <label className="fld"><span>Part Family (optional)</span><input className="in" value={String(form.partFamily ?? '')} onChange={(e) => set('partFamily', e.target.value)} /></label>
          <label className="fld"><span>Remarks</span><input className="in" value={String(form.remarks ?? '')} onChange={(e) => set('remarks', e.target.value)} /></label>
        </div>
        <div className="actbar">
          <div className="rgt">
            <button className="btn btn-p" onClick={save} disabled={busy || !can('master', 'Edit')}>+ Add Capability</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <input className="in" placeholder="Search by machine or operation..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="twrap">
          {loading ? <div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading...</div> : (
            <table className="tbl">
              <thead><tr><th className="num">S.No</th><th>Machine</th><th>Operation Code</th><th>Part Family</th><th>Remarks</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6}><div className="empty"><span className="material-symbols-rounded">description</span> No capability rows yet — every machine is unrestricted until you add one.</div></td></tr>
                ) : filtered.map((r, idx) => (
                  <tr key={r.id}>
                    <td className="num mut">{idx + 1}</td>
                    <td>{r.machineCode}</td>
                    <td>{r.operationCode}</td>
                    <td>{r.partFamily ?? '-'}</td>
                    <td>{r.remarks ?? '-'}</td>
                    <td>
                      {can('master', 'Delete') && <button className="ibtn danger" title="Remove" onClick={() => setDeleteTarget(r)}><span className="material-symbols-rounded">delete</span></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {rows.length > 0 && (
          <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--muted)' }}>
            Restricted machines (have at least one capability row): {machinesWithCapabilities.size > 0 ? Array.from(machinesWithCapabilities).join(', ') : 'none'}
          </div>
        )}
      </div>

      <ConfirmActionModal open={Boolean(deleteTarget)} title={`Remove capability`} body={`Remove ${deleteTarget?.machineCode} → ${deleteTarget?.operationCode}? If this was the machine's last row, it becomes unrestricted again.`} okLabel="Remove" danger busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={del} />
    </>
  );
}
