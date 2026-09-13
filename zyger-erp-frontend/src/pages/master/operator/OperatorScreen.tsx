import { useEffect, useState } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';

const MACHINE_CLASSES = ['CNC Turning', 'CNC Milling', 'VMC', 'HMC', 'CNC Grinding', 'Conventional', 'Inspection Equipment'];
const SKILL_CATEGORIES = ['Turning', 'Milling', 'VMC-HMC', 'Grinding', 'Inspection', 'Multi-skilled'];
const SHIFTS = ['A', 'B', 'C', 'General'];

export interface OperatorItem {
  id: number;
  code: string;
  name: string;
  skillCategory?: string;
  machineClassAuthorization?: string;
  certificationExpiry?: string;
  shift?: string;
  active: boolean;
}

export default function OperatorScreen() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<'LIST' | 'FORM'>('LIST');
  const [rows, setRows] = useState<OperatorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OperatorItem | null>(null);

  const [code, setCode] = useState('OP-0001');
  const [name, setName] = useState('');
  const [skillCategory, setSkillCategory] = useState('Turning');
  const [machineClasses, setMachineClasses] = useState<string[]>([]);
  const [certificationExpiry, setCertificationExpiry] = useState('');
  const [shift, setShift] = useState('General');
  const [active, setActive] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/master/operators');
      setRows(data?.content ?? data ?? []);
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to load operators.'), 'error');
    }
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const openNew = async () => {
    setEditId(null);
    setName(''); setSkillCategory('Turning'); setMachineClasses([]);
    setCertificationExpiry(''); setShift('General'); setActive(true);
    setViewMode('FORM');
    try {
      const { data } = await apiClient.get('/master/operators/next-code');
      setCode(data.code || 'OP-0001');
    } catch {
      setCode(`OP-000${rows.length + 1}`);
    }
  };

  const openEdit = (item: OperatorItem) => {
    setEditId(item.id);
    setCode(item.code);
    setName(item.name || '');
    setSkillCategory(item.skillCategory || 'Turning');
    setMachineClasses(item.machineClassAuthorization ? item.machineClassAuthorization.split(',').map(s => s.trim()).filter(Boolean) : []);
    setCertificationExpiry(item.certificationExpiry || '');
    setShift(item.shift || 'General');
    setActive(item.active ?? true);
    setViewMode('FORM');
  };

  const toggleMachineClass = (mc: string) => {
    setMachineClasses(prev => prev.includes(mc) ? prev.filter(x => x !== mc) : [...prev, mc]);
  };

  const save = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!code.trim()) { toast('Operator Code is required.', 'error'); return; }
    if (!name.trim()) { toast('Operator Name is required.', 'error'); return; }

    setBusy(true);
    try {
      const payload = {
        code, name, skillCategory,
        machineClassAuthorization: machineClasses.join(', '),
        certificationExpiry: certificationExpiry || null,
        shift, active,
      };
      if (editId) {
        await apiClient.put(`/master/operators/${editId}`, payload);
        toast('Operator updated successfully.');
      } else {
        await apiClient.post('/master/operators', payload);
        toast('Operator created successfully.');
      }
      setViewMode('LIST');
      loadAll();
    } catch (err) {
      toast(getApiErrorMessage(err, 'Failed to save operator.'), 'error');
    }
    setBusy(false);
  };

  const del = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiClient.delete(`/master/operators/${deleteTarget.id}`);
      toast('Operator deleted.');
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
    return (r.code && r.code.toLowerCase().includes(q)) || (r.name && r.name.toLowerCase().includes(q))
      || (r.skillCategory && r.skillCategory.toLowerCase().includes(q));
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
            <h1>{viewMode === 'LIST' ? 'Operator Master' : editId ? 'Edit Operator' : 'New Operator'}</h1>
            <p>Master -&gt; Shop Floor -&gt; Operator Master. Skill category & machine-class authorization.</p>
          </div>
        </div>
        <div>
          {viewMode === 'LIST' ? (
            <button type="button" className="btn btn-primary" onClick={openNew}>+ Add Operator</button>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn btn-primary" onClick={() => save()} disabled={busy}>
                {busy ? 'Saving...' : 'Save Operator'}
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
              <input type="text" className="in" placeholder="Search Code, Name, Skill..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: '280px' }} />
              <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>{filteredRows.length} records</span>
            </div>
          </div>

          <div className="twrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="num">S.No</th>
                  <th>CODE</th>
                  <th>OPERATOR NAME</th>
                  <th>SKILL CATEGORY</th>
                  <th>MACHINE AUTHORIZATION</th>
                  <th>SHIFT</th>
                  <th>CERT. EXPIRY</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="empty">Loading operators...</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={9} className="empty">No operators found.</td></tr>
                ) : (
                  filteredRows.map((r, idx) => (
                    <tr key={r.id}>
                      <td className="num mut">{idx + 1}</td>
                      <td style={{ fontWeight: 700, color: '#0f172a' }}>{r.code}</td>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{r.skillCategory || '—'}</td>
                      <td>{r.machineClassAuthorization || '—'}</td>
                      <td>{r.shift || '—'}</td>
                      <td style={r.certificationExpiry && new Date(r.certificationExpiry) < new Date() ? { color: '#dc2626', fontWeight: 700 } : {}}>
                        {r.certificationExpiry || '—'}
                      </td>
                      <td>{r.active
                        ? <span style={{ fontWeight: 700, color: '#166534', backgroundColor: '#dcfce7', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>Active</span>
                        : <span style={{ fontWeight: 700, color: '#991b1b', backgroundColor: '#fee2e2', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>Inactive</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button type="button" className="ibtn" title="Edit" onClick={() => openEdit(r)}>
                            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>edit</span>
                          </button>
                          <button type="button" className="ibtn danger" title="Delete" onClick={() => setDeleteTarget(r)}>
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
              <span className="material-symbols-rounded">engineering</span>
              <span>Operator Details & Machine Authorization</span>
            </div>
          </div>

          <div className="sec-body" style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: '0 0 12px 12px', padding: '24px', marginBottom: '24px' }}>
            <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
              <label className="fld">
                <span>OPERATOR CODE *</span>
                <input className="in" type="text" readOnly value={code} style={{ backgroundColor: '#f8fafc', fontWeight: 600 }} />
              </label>
              <label className="fld">
                <span>OPERATOR NAME *</span>
                <input className="in" type="text" required placeholder="Ramesh Kumar" value={name} onChange={e => setName(e.target.value)} />
              </label>
              <label className="fld">
                <span>SKILL CATEGORY *</span>
                <select className="in" value={skillCategory} onChange={e => setSkillCategory(e.target.value)}>
                  {SKILL_CATEGORIES.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                </select>
              </label>
              <label className="fld">
                <span>SHIFT</span>
                <select className="in" value={shift} onChange={e => setShift(e.target.value)}>
                  {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="fld">
                <span>CERTIFICATION EXPIRY</span>
                <input className="in" type="date" value={certificationExpiry} onChange={e => setCertificationExpiry(e.target.value)} />
              </label>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '8px', textTransform: 'uppercase' }}>
                Machine Class Authorization
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {MACHINE_CLASSES.map(mc => (
                  <label key={mc} className="fld chk" style={{ flex: '0 0 auto' }}>
                    <input type="checkbox" checked={machineClasses.includes(mc)} onChange={() => toggleMachineClass(mc)} />
                    <span>{mc}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label className="fld chk">
                <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
                <span>Active</span>
              </label>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving...' : 'Save Operator'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')}>Cancel</button>
            </div>
          </div>
        </form>
      )}

      <ConfirmActionModal
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.code ?? ''}`}
        body="Permanently delete this operator?"
        okLabel="Delete"
        danger
        busy={busy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={del}
      />
    </>
  );
}
