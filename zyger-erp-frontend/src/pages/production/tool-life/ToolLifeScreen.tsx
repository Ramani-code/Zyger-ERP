import { useEffect, useState, useCallback } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import { exportToCsv } from '../../../utils/csvExport';
import { useTabs } from '../../../contexts/TabsContext';

interface ToolLifeEntry {
  id: number;
  docNo: string;
  toolCode: string;
  jobCardNumber: string;
  subjobNumber: string;
  machineCode: string;
  lifeConsumed: number;
  cumulativeLifeConsumed: number;
  remainingLifePercent: number | null;
  changeReason: string | null;
  replacedByToolCode: string | null;
  remarks: string;
  createdBy: string;
  createdAt: string;
}

const CHANGE_REASONS = ['BREAKAGE', 'WEAR', 'QUALITY_ISSUE', 'PREVENTIVE'];

export default function ToolLifeScreen() {
  const { toast } = useToast();
  const { can } = useAuth();
  const { closeTab } = useTabs();
  const backToList = () => closeTab('tool-life');

  const [rows, setRows] = useState<ToolLifeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'list' | 'form'>('list');
  const [tools, setTools] = useState<Array<{ code: string; name: string; currentUsage?: number; toolLifeCount?: number; toolLifeUnit?: string }>>([]);
  const [jobCards, setJobCards] = useState<Array<{ jobCardNumber: string }>>([]);

  const fetchMasters = useCallback(async () => {
    try {
      const [tRes, jRes] = await Promise.allSettled([
        apiClient.get('/master/tools', { params: { size: 500 } }),
        apiClient.get('/v1/production/job-cards', { params: { size: 500, sort: 'id,desc' } }),
      ]);
      if (tRes.status === 'fulfilled') setTools(tRes.value.data?.content ?? tRes.value.data ?? []);
      if (jRes.status === 'fulfilled') setJobCards(jRes.value.data?.content ?? jRes.value.data ?? []);
    } catch { /* masters are best-effort */ }
  }, []);

  useEffect(() => { if (tab === 'form') fetchMasters(); }, [tab, fetchMasters]);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/v1/production/tool-life');
      setRows(Array.isArray(data) ? data : []);
    } catch (e) { toast(getApiErrorMessage(e, 'Load failed.'), 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const selectedTool = tools.find((t) => t.code === form.toolCode);
  const isChange = Boolean(String(form.changeReason ?? '').trim());

  const save = async () => {
    if (!String(form.toolCode ?? '').trim()) { toast('Tool ID is required.', 'error'); return; }
    if (isChange && !String(form.replacedByToolCode ?? '').trim()) {
      toast('Replaced By (New Tool ID) is required when changing a tool.', 'error');
      return;
    }
    setBusy(true);
    try {
      await apiClient.post('/v1/production/tool-life', form);
      toast('Tool life entry recorded.');
      setForm({}); setTab('list'); load();
    } catch (e) { toast(getApiErrorMessage(e, 'Save failed.'), 'error'); }
    setBusy(false);
  };

  const set = (k: string, v: unknown) => setForm((c) => ({ ...c, [k]: v }));
  const filtered = rows.filter((r) => !search
    || (r.docNo ?? '').toLowerCase().includes(search.toLowerCase())
    || (r.toolCode ?? '').toLowerCase().includes(search.toLowerCase())
    || (r.jobCardNumber ?? '').toLowerCase().includes(search.toLowerCase()));

  const lifeBadge = (pct: number | null) => {
    if (pct == null) return <span className="mut">-</span>;
    const color = pct <= 10 ? '#991b1b' : pct <= 25 ? '#92400e' : '#166534';
    const bg = pct <= 10 ? '#fde2e2' : pct <= 25 ? '#fef3c7' : '#d4edda';
    return <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600, color, background: bg }}>{pct}%</span>;
  };

  return (
    <>
      <div className="pg-head">
        <h1>Tool Life / Tool Change</h1>
        <p>Track cumulative tool usage against rated life and log tool changes</p>
      </div>

      {tab === 'form' && (
        <div className="panel">
          <div className="panel-h"><h2>New Tool Life Entry</h2></div>
          <div className="fgrid">
            <label className="fld"><span>Tool ID *</span>
              <select className="in" value={String(form.toolCode ?? '')} onChange={(e) => set('toolCode', e.target.value)}>
                <option value="">Select tool...</option>
                {tools.map((t) => <option key={t.code} value={t.code}>{t.code} - {t.name}</option>)}
              </select>
            </label>
            {selectedTool && (
              <label className="fld"><span>Current Usage / Rated Life</span>
                <input className="in" readOnly value={`${selectedTool.currentUsage ?? 0} / ${selectedTool.toolLifeCount ?? '-'} ${selectedTool.toolLifeUnit ?? ''}`} />
              </label>
            )}
            <label className="fld"><span>Job Card No</span>
              <select className="in" value={String(form.jobCardNumber ?? '')} onChange={(e) => set('jobCardNumber', e.target.value)}>
                <option value="">Select...</option>
                {jobCards.map((j) => <option key={j.jobCardNumber} value={j.jobCardNumber}>{j.jobCardNumber}</option>)}
              </select>
            </label>
            <label className="fld"><span>Machine Code</span><input className="in" value={String(form.machineCode ?? '')} onChange={(e) => set('machineCode', e.target.value)} /></label>
            <label className="fld"><span>Life Consumed (this entry) *</span><input className="in" type="number" step="any" value={String(form.lifeConsumed ?? '')} onChange={(e) => set('lifeConsumed', e.target.value)} /></label>
            <label className="fld"><span>Change Reason</span>
              <select className="in" value={String(form.changeReason ?? '')} onChange={(e) => set('changeReason', e.target.value)}>
                <option value="">Not changing — usage only</option>
                {CHANGE_REASONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
            {isChange && (
              <label className="fld"><span>Replaced By (New Tool ID) *</span>
                <select className="in" value={String(form.replacedByToolCode ?? '')} onChange={(e) => set('replacedByToolCode', e.target.value)}>
                  <option value="">Select tool...</option>
                  {tools.filter((t) => t.code !== form.toolCode).map((t) => <option key={t.code} value={t.code}>{t.code} - {t.name}</option>)}
                </select>
              </label>
            )}
            {isChange && (
              <label className="fld"><span>Rejected Qty Caused (optional)</span><input className="in" type="number" step="any" value={String(form.linkedRejectedQty ?? '')} onChange={(e) => set('linkedRejectedQty', e.target.value)} /></label>
            )}
            <label className="fld"><span>Remarks</span><input className="in" value={String(form.remarks ?? '')} onChange={(e) => set('remarks', e.target.value)} /></label>
          </div>
          <div className="actbar">
            <div className="lft">
              <button className="btn btn-sm" onClick={backToList} disabled={busy}><span className="material-symbols-rounded">arrow_back</span> Back</button>
            </div>
            <div className="rgt">
              <button className="btn btn-sm" onClick={() => { setForm({}); setTab('list'); }} disabled={busy}>Cancel</button>
              <button className="btn btn-sm btn-p" onClick={save} disabled={busy || !can('production', 'Edit')}>Record Entry</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'list' && (
        <div className="panel">
          <div className="toolbar">
            <input className="in" placeholder="Search tool life entries..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="ibtn" title="Export CSV" onClick={() => exportToCsv(filtered as unknown as Record<string, unknown>[], [
              { key: 'docNo', label: 'Doc No' },
              { key: 'toolCode', label: 'Tool' },
              { key: 'jobCardNumber', label: 'Job Card' },
              { key: 'lifeConsumed', label: 'Life Consumed' },
              { key: 'cumulativeLifeConsumed', label: 'Cumulative' },
              { key: 'remainingLifePercent', label: 'Remaining %' },
              { key: 'changeReason', label: 'Change Reason' },
              { key: 'replacedByToolCode', label: 'Replaced By' },
            ], 'tool-life')}><span className="material-symbols-rounded">download</span></button>
            <button className="btn btn-p" onClick={() => { setForm({}); setTab('form'); }} disabled={!can('production', 'Edit')}>+ New Entry</button>
          </div>
          <div className="twrap">
            {loading ? <div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading...</div> : (
              <table className="tbl">
                <thead><tr><th className="num">S.No</th><th>Doc No</th><th>Tool</th><th>Job Card</th><th>Life Consumed</th><th>Cumulative</th><th>Remaining %</th><th>Change</th></tr></thead>
                <tbody>
                  {filtered.length === 0 ? <tr><td colSpan={8}><div className="empty"><span className="material-symbols-rounded">description</span> No tool life entries.</div></td></tr> : filtered.map((r, idx) => (
                    <tr key={r.id}>
                      <td className="num mut">{idx + 1}</td>
                      <td><b>{r.docNo}</b></td>
                      <td>{r.toolCode}</td>
                      <td>{r.jobCardNumber ?? '-'}</td>
                      <td>{r.lifeConsumed}</td>
                      <td>{r.cumulativeLifeConsumed}</td>
                      <td>{lifeBadge(r.remainingLifePercent)}</td>
                      <td>{r.changeReason ? `${r.changeReason.replace(/_/g, ' ')} → ${r.replacedByToolCode}` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}
