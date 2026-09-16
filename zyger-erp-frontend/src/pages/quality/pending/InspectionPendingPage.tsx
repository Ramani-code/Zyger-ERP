import { useEffect, useState } from 'react';
import apiClient from '../../../api/axiosClient';
import { qualityApi } from '../../../services/quality-api';
import { useToast } from '../../../contexts/ToastContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useTabs } from '../../../contexts/TabsContext';
import { getScreenComponent } from '../../../config/screenRegistry';
import StatusBadge from '../../../components/common/StatusBadge';

interface PendingInspection {
  id: number | null;
  inspectionNumber: string;
  inspectionType: string;
  itemCode: string;
  itemDescription: string;
  sourceNumber: string;
  poInwardNumber: string;
  priority: string;
  inspector: string;
  receivedQuantity: number;
  inspectionStatus: string;
  decisionStatus: string;
  dueDate: string;
  createdAt: string;
  isLocked: boolean;
  pendingFromInward?: boolean;
  sourceDocKey?: string;
  sourceDocId?: number;
}

interface GateCheck {
  blocked: boolean;
  pendingInspectionCount: number;
  message: string;
}

const TYPE_FILTERS = ['', 'IQC', 'LO', 'JOMIN', 'FAI', 'IPQC', 'LINE', 'LAST_OFF', 'FINAL'];
const PRIORITY_FILTERS = ['', 'Critical', 'High', 'Normal', 'Low'];

const PRIORITY_COLORS: Record<string, { color: string; bg: string }> = {
  Critical: { color: '#991b1b', bg: '#fde2e2' },
  High: { color: '#92400e', bg: '#fef3c7' },
  Normal: { color: '#1d4ed8', bg: '#dbeafe' },
  Low: { color: '#6b7280', bg: '#f3f4f6' },
};

const TYPE_LABELS: Record<string, string> = {
  IQC: 'Inward (IQC)', LO: 'LO', JOMIN: 'JOMIN', FAI: 'First Article', IPQC: 'Process (IPQC)', LINE: 'Line', LAST_OFF: 'Last Off', FINAL: 'Final',
};

export default function InspectionPendingPage() {
  const { toast } = useToast();
  const { openTab } = useTabs();
  const [rows, setRows] = useState<PendingInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [gateCheck, setGateCheck] = useState<GateCheck | null>(null);

  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [inspectorFilter, setInspectorFilter] = useState('');
  const [itemFilter, setItemFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('size', '50');
      if (typeFilter) params.set('inspectionType', typeFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (inspectorFilter) params.set('inspector', inspectorFilter);
      if (itemFilter) params.set('itemCode', itemFilter);

      const { data } = await apiClient.get(`/v1/quality/inspection-pending?${params.toString()}`);
      setRows(data.content ?? []);
      setTotal(data.totalElements ?? 0);
    } catch (e) { toast(getApiErrorMessage(e, 'Load failed.'), 'error'); }
    setLoading(false);
  };

  const checkGate = async () => {
    try {
      const params = new URLSearchParams();
      if (itemFilter) params.set('itemCode', itemFilter);
      const { data } = await apiClient.get(`/v1/quality/production-gate/check?${params.toString()}`);
      setGateCheck(data);
    } catch (e) { /* ignore */ }
  };

  useEffect(() => { load(); }, [page, typeFilter, priorityFilter, inspectorFilter, itemFilter]);
  useEffect(() => { checkGate(); }, [itemFilter]);

  const openInspection = (id: number) => {
    openTab({
      id: `quality-inspection-${id}`,
      label: `Inspection ${id}`,
      icon: 'fact_check',
      component: getScreenComponent('quality-inspection'),
      props: { initialDocId: id },
    });
  };

  const processAwaitingInward = async (row: PendingInspection) => {
    if (!row.sourceDocKey || row.sourceDocId == null) {
      return;
    }
    setProcessingId(row.sourceDocId);
    try {
      const result = await qualityApi.createInspectionFromInward({
        sourceDocKey: row.sourceDocKey,
        sourceDocId: row.sourceDocId,
      });
      const id = result.inspectionId;
      if (id == null) {
        toast('No inspection created — verify the inward has QC-required lines.', 'error');
        return;
      }
      const created = result.inspections?.[0];
      openTab({
        id: `quality-inspection-${id}`,
        label: created?.docNo ? `Inspection ${created.docNo}` : `Inspection ${id}`,
        icon: 'fact_check',
        component: getScreenComponent('quality-inspection'),
        props: { initialDocId: id },
      });
      toast(
        `✅ ${created?.inspectionType ?? 'Inspection'} created for ${row.sourceNumber} — enter quantities and Save.`,
        'success'
      );
      load();
    } catch (createError) {
      toast(getApiErrorMessage(createError, 'Could not create inspection.'), 'error');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <>
      <div className="pg-head">
        <h3>Inspection Pending Queue</h3>
        <p>{total} inspection(s) awaiting processing — sorted by priority then due date</p>
      </div>

      {gateCheck && (
        <div className="panel" style={{
          marginBottom: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
          background: gateCheck.blocked ? '#fef2f2' : '#f0fdf4', borderLeft: `4px solid ${gateCheck.blocked ? '#ef4444' : '#22c55e'}`,
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: 20, color: gateCheck.blocked ? '#ef4444' : '#22c55e' }}>
            {gateCheck.blocked ? 'block' : 'check_circle'}
          </span>
          <div>
            <strong style={{ fontSize: 13 }}>{gateCheck.blocked ? 'Production BLOCKED' : 'Production ALLOWED'}</strong>
            <span style={{ fontSize: 12, color: '#666', marginLeft: 8 }}>{gateCheck.message}</span>
          </div>
        </div>
      )}

      <div className="panel" style={{ marginBottom: 12, padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="in" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }} style={{ width: 150 }}>
            <option value="">All Types</option>
            {TYPE_FILTERS.filter(Boolean).map((t) => <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>)}
          </select>
          <select className="in" value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setPage(0); }} style={{ width: 140 }}>
            <option value="">All Priorities</option>
            {PRIORITY_FILTERS.filter(Boolean).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input className="in" placeholder="Inspector..." value={inspectorFilter} onChange={(e) => { setInspectorFilter(e.target.value); setPage(0); }} style={{ width: 140 }} />
          <input className="in" placeholder="Item code..." value={itemFilter} onChange={(e) => { setItemFilter(e.target.value); setPage(0); }} style={{ width: 140 }} />
          <button className="btn" onClick={() => { setTypeFilter(''); setPriorityFilter(''); setInspectorFilter(''); setItemFilter(''); setPage(0); }}>Clear</button>
        </div>
      </div>

      {loading ? <p>Loading...</p> : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Inspection #</th>
              <th>Type</th>
              <th>Item</th>
              <th>Source</th>
              <th>Priority</th>
              <th>Inspector</th>
              <th>Rcvd Qty</th>
              <th>Status</th>
              <th>Due Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: '#999' }}>No pending inspections</td></tr>}
            {rows.map((r) => {
              const pc = PRIORITY_COLORS[r.priority] ?? PRIORITY_COLORS.Normal;
              const awaiting = Boolean(r.pendingFromInward);
              const rowKey = awaiting ? `aw-${r.sourceDocKey}-${r.sourceDocId}` : `qc-${r.id}`;
              const busy = awaiting && processingId === r.sourceDocId;
              return (
                <tr key={rowKey} style={{ background: awaiting ? '#f0f5ff' : r.isLocked ? '#fef9ee' : undefined }}>
                  <td>
                    <strong>{r.inspectionNumber}</strong>
                    {awaiting && <div style={{ fontSize: 11, color: '#2563eb' }}>Awaiting creation</div>}
                  </td>
                  <td>{TYPE_LABELS[r.inspectionType] ?? r.inspectionType}</td>
                  <td>{r.itemCode}</td>
                  <td>{r.poInwardNumber || r.sourceNumber}</td>
                  <td>
                    <span style={{ background: pc.bg, color: pc.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                      {r.priority}
                    </span>
                  </td>
                  <td>{r.inspector || '-'}</td>
                  <td>{r.receivedQuantity}</td>
                  <td>
                    {awaiting ? (
                      <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                        AWAITING
                      </span>
                    ) : (
                      <StatusBadge status={r.inspectionStatus} />
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>{r.dueDate || '-'}</td>
                  <td>
                    {awaiting ? (
                      <button
                        className="btn primary"
                        onClick={() => processAwaitingInward(r)}
                        disabled={busy || loading}
                        style={{ fontSize: 12 }}
                      >
                        {busy ? 'Creating...' : 'Process'}
                      </button>
                    ) : (
                      <button className="btn primary" onClick={() => openInspection(r.id!)} style={{ fontSize: 12 }}>Process</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {total > 50 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: 12 }}>
          <button className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span style={{ lineHeight: '32px', fontSize: 13 }}>Page {page + 1} of {Math.ceil(total / 50)}</span>
          <button className="btn" disabled={(page + 1) * 50 >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </>
  );
}
