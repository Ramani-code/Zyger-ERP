import { useState, useEffect, useCallback } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import { exportSimpleCsv } from '../../../utils/csvExport';
import { formatNumber } from '../../../utils/format';

type SummaryReportType =
  | 'rejection' | 'rework' | 'idle' | 'machine' | 'operator'
  | 'daily-production' | 'shift' | 'wip' | 'tool-consumption' | 'order-status';

const SUMMARY_REPORTS: { key: SummaryReportType; label: string; icon: string; desc: string }[] = [
  { key: 'daily-production', label: 'Daily Production', icon: 'calendar_today', desc: 'Good/rejected/rework/scrap qty by date' },
  { key: 'rejection', label: 'Rejection', icon: 'block', desc: 'Rejection reason-wise summary' },
  { key: 'rework', label: 'Rework', icon: 'replay', desc: 'Rework reason & routing summary' },
  { key: 'idle', label: 'Idle', icon: 'schedule', desc: 'Idle reason & duration summary' },
  { key: 'machine', label: 'Machine', icon: 'precision_manufacturing', desc: 'Machine-wise output, quality & utilization %' },
  { key: 'operator', label: 'Operator', icon: 'engineering', desc: 'Operator-wise output & efficiency %' },
  { key: 'shift', label: 'Shift-wise', icon: 'groups', desc: 'Shift-wise output, rejection % & manpower' },
  { key: 'wip', label: 'WIP', icon: 'inventory_2', desc: 'Work-in-process qty by operation, with ageing' },
  { key: 'tool-consumption', label: 'Tool Life', icon: 'construction', desc: 'Tool usage vs. rated life, replacement alerts' },
  { key: 'order-status', label: 'Order Status', icon: 'local_shipping', desc: 'Planned vs. actual completion, delay tracking' },
];

interface DashboardSummary {
  totalOrders: number;
  ordersInProcess: number;
  jobsOpen: number;
  jobsCompleted: number;
  entriesToday: number;
  pendingApprovals: number;
}

interface PendingItem {
  jobCardNumber: string;
  workOrderNumber: string;
  partCode: string;
  pendingQuantity: number;
  overdue: boolean;
  status: string;
}

export default function ProductionReportsScreen() {
  const { toast } = useToast();
  const [kpis, setKpis] = useState<DashboardSummary | null>(null);
  const [pendingRows, setPendingRows] = useState<PendingItem[]>([]);
  const [activeReport, setActiveReport] = useState<SummaryReportType>('rejection');
  const [reportData, setReportData] = useState<Record<string, unknown>[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(false);
  const [loadingKpis, setLoadingKpis] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoadingKpis(true);
    try {
      const [dRes, pRes] = await Promise.all([
        apiClient.get('/v1/production/dashboard'),
        apiClient.get('/v1/production/pending'),
      ]);
      setKpis(dRes.data);
      setPendingRows(Array.isArray(pRes.data) ? pRes.data : (pRes.data?.content ?? []));
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to load production summary.'), 'error');
    } finally {
      setLoadingKpis(false);
    }
  }, [toast]);

  const loadReport = useCallback(async (type: SummaryReportType) => {
    setReportLoading(true);
    setReportError(false);
    try {
      const res = await apiClient.get(`/v1/production/reports/${type}-summary`);
      setReportData(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setReportData([]);
      setReportError(true);
      toast(getApiErrorMessage(e, `Failed to load ${type} summary.`), 'error');
    } finally {
      setReportLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  useEffect(() => { loadReport(activeReport); }, [activeReport, loadReport]);

  const kpiCards: { label: string; value: number; color: string }[] = kpis
    ? [
        { label: 'Total Orders', value: kpis.totalOrders, color: '#2563eb' },
        { label: 'Orders In Process', value: kpis.ordersInProcess, color: '#f59e0b' },
        { label: 'Jobs Open', value: kpis.jobsOpen, color: '#0ea5e9' },
        { label: 'Jobs Completed', value: kpis.jobsCompleted, color: '#22c55e' },
        { label: 'Entries Today', value: kpis.entriesToday, color: '#8b5cf6' },
        { label: 'Pending Approvals', value: kpis.pendingApprovals, color: '#ef4444' },
      ]
    : [];

  const totalPendingQty = pendingRows.reduce((s, r) => s + (r.pendingQuantity ?? 0), 0);
  const overdueCount = pendingRows.filter((r) => r.overdue).length;
  const inProcessCount = pendingRows.filter((r) => r.status === 'IN_PROGRESS').length;

  const reportTitle = SUMMARY_REPORTS.find((r) => r.key === activeReport);

  return (
    <>
      <div className="pg-head">
        <h1>Production Reports &amp; Analytics</h1>
        <p>Summary and analytical reports across production</p>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-h"><h2><span className="material-symbols-rounded">insights</span> Production Overview</h2></div>
        {loadingKpis ? (
          <div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading overview...</div>
        ) : kpis ? (
          <div className="fgrid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, padding: 16 }}>
            {kpiCards.map((c) => (
              <div key={c.label} style={{ textAlign: 'center', padding: '14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: c.color }}>{formatNumber(c.value)}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginTop: 4 }}>{c.label}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty"><span className="material-symbols-rounded">error_outline</span> Overview unavailable.</div>
        )}
        <div className="panel-h" style={{ borderTop: '1px solid #eef2f7', marginTop: 8 }}>
          <h2><span className="material-symbols-rounded">pending_actions</span> Pending Production</h2>
          <span className="count">{formatNumber(pendingRows.length)} jobs · {formatNumber(totalPendingQty)} qty · {overdueCount} overdue</span>
        </div>
        <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: '8px 16px 16px' }}>
          {[
            { label: 'Pending Jobs', value: pendingRows.length, color: 'var(--text)' },
            { label: 'Total Pending Qty', value: totalPendingQty, color: '#f59e0b' },
            { label: 'In Progress', value: inProcessCount, color: '#22c55e' },
          ].map((c) => (
            <div key={c.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: c.color }}>{formatNumber(c.value)}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-h"><h2><span className="material-symbols-rounded">assessment</span> Summary Reports</h2></div>
        <div className="toolbar" style={{ flexWrap: 'wrap', gap: 6 }}>
          {SUMMARY_REPORTS.map((r) => (
            <button key={r.key} className={`btn btn-sm ${activeReport === r.key ? 'btn-p' : ''}`} onClick={() => setActiveReport(r.key)}>
              <span className="material-symbols-rounded">{r.icon}</span> {r.label}
            </button>
          ))}
          <div className="sp" />
          <button className="btn btn-sm" onClick={() => { loadDashboard(); loadReport(activeReport); }} disabled={reportLoading}>
            <span className="material-symbols-rounded">refresh</span>
          </button>
          <button className="btn btn-sm" onClick={() => exportSimpleCsv(reportData, `production-${activeReport}-summary`)} disabled={reportData.length === 0}>
            <span className="material-symbols-rounded">download</span> Export
          </button>
        </div>

        {reportLoading && <div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading {reportTitle?.label.toLowerCase()} summary...</div>}

        {!reportLoading && reportError && (
          <div className="empty"><span className="material-symbols-rounded">error_outline</span> {reportTitle?.label} summary is currently unavailable.</div>
        )}

        {!reportLoading && !reportError && reportData.length === 0 && (
          <div className="empty"><span className="material-symbols-rounded">check_circle</span> No {reportTitle?.label.toLowerCase()} records found.</div>
        )}

        {!reportLoading && !reportError && reportData.length > 0 && (
          <div className="twrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="num">S.No</th>
                  {Object.keys(reportData[0]).map((key) => (
                    <th key={key}>{key.replace(/([A-Z])/g, ' $1')}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reportData.map((row, i) => (
                  <tr key={i}>
                    <td className="num mut">{i + 1}</td>
                    {Object.keys(reportData[0]).map((key) => {
                      const val = row[key];
                      return <td key={key} className="num">{typeof val === 'number' ? formatNumber(val) : String(val ?? '-')}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
