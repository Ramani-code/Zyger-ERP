import { useEffect, useState } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useTabs } from '../../../contexts/TabsContext';
import { getScreenComponent } from '../../../config/screenRegistry';
import { formatNumber } from '../../../utils/format';

interface SalesDashboardData {
  newSalesOrders: number;
  pendingApproval: number;
  approvedOrders: number;
  partiallyDispatched: number;
  overdueOrders: number;
  pendingPi: number;
  pendingDispatch: number;
  dispatched: number;
  pendingInvoice: number;
  postedInvoices: number;
  pendingReturns: number;
  totalSO: number;
  totalPI: number;
  totalDC: number;
  totalInvoice: number;
  totalReturns: number;
  openOrderValue: number;
  dispatchedMtd: number;
  invoicedMtd: number;
  overdueBeyondMsme45Count: number;
  overdueBeyondMsme45Value: number;
}

interface KpiCard {
  key: keyof SalesDashboardData;
  icon: string;
  label: string;
  color: string;
  bg: string;
  /** Screen this card drills into; omitted for cards with no single natural target. */
  screenId?: string;
  /** Status to pre-filter the target list by, when it lands on a status field. */
  status?: string;
  /** Renders the value as ₹ currency instead of a plain count. */
  currency?: boolean;
}

const KPI_CARDS: KpiCard[] = [
  { key: 'newSalesOrders', icon: 'shopping_cart', label: 'New Sales Orders', color: '#1d4ed8', bg: '#dbeafe', screenId: 'sales-order', status: 'DRAFT' },
  { key: 'pendingApproval', icon: 'hourglass_top', label: 'Pending Approval', color: '#b45309', bg: '#fef3c7', screenId: 'sales-order', status: 'SUBMITTED' },
  { key: 'approvedOrders', icon: 'task_alt', label: 'Approved Orders', color: '#166534', bg: '#d4edda', screenId: 'sales-order', status: 'APPROVED' },
  { key: 'partiallyDispatched', icon: 'local_shipping', label: 'Partially Dispatched', color: '#b45309', bg: '#fef3c7', screenId: 'sales-order', status: 'PARTIALLY_DISPATCHED' },
  { key: 'overdueOrders', icon: 'event_busy', label: 'Overdue Orders', color: '#991b1b', bg: '#fde2e2', screenId: 'sales-order' },
  { key: 'pendingPi', icon: 'request_quote', label: 'Pending PI', color: '#b45309', bg: '#fef3c7', screenId: 'proforma-invoice', status: 'SUBMITTED' },
  { key: 'pendingDispatch', icon: 'outbox', label: 'Pending Dispatch', color: '#b45309', bg: '#fef3c7', screenId: 'sales-sales-dc', status: 'SUBMITTED' },
  { key: 'dispatched', icon: 'local_shipping', label: 'Dispatched', color: '#166534', bg: '#d4edda', screenId: 'sales-sales-dc', status: 'DISPATCHED' },
  { key: 'pendingInvoice', icon: 'receipt_long', label: 'Pending Invoice', color: '#b45309', bg: '#fef3c7', screenId: 'sales-invoice', status: 'SUBMITTED' },
  { key: 'postedInvoices', icon: 'price_check', label: 'Posted Invoices', color: '#166534', bg: '#d4edda', screenId: 'sales-invoice', status: 'POSTED' },
  { key: 'pendingReturns', icon: 'replay', label: 'Pending Returns', color: '#b45309', bg: '#fef3c7', screenId: 'sales-dc-return', status: 'SUBMITTED' },
  { key: 'totalSO', icon: 'assignment', label: 'Total SO', color: '#6b7280', bg: '#f3f4f6', screenId: 'sales-order' },
  { key: 'totalPI', icon: 'description', label: 'Total PI', color: '#6b7280', bg: '#f3f4f6', screenId: 'proforma-invoice' },
  { key: 'totalDC', icon: 'table_view', label: 'Total DC', color: '#6b7280', bg: '#f3f4f6', screenId: 'sales-sales-dc' },
  { key: 'totalInvoice', icon: 'receipt', label: 'Total Invoices', color: '#6b7280', bg: '#f3f4f6', screenId: 'sales-invoice' },
  { key: 'totalReturns', icon: 'assignment_return', label: 'Total Returns', color: '#6b7280', bg: '#f3f4f6', screenId: 'sales-dc-return' },
  // Phase 6: value-based KPIs (Technical Design §2.9 / Improvement Plan §G)
  { key: 'openOrderValue', icon: 'payments', label: 'Open Order Value', color: '#1d4ed8', bg: '#dbeafe', screenId: 'sales-order', status: 'APPROVED', currency: true },
  { key: 'dispatchedMtd', icon: 'local_shipping', label: 'Dispatched MTD (₹)', color: '#166534', bg: '#d4edda', screenId: 'sales-sales-dc', currency: true },
  { key: 'invoicedMtd', icon: 'price_check', label: 'Invoiced MTD (₹)', color: '#166534', bg: '#d4edda', screenId: 'sales-invoice', currency: true },
  { key: 'overdueBeyondMsme45Value', icon: 'gavel', label: 'Overdue Beyond MSME-45d', color: '#991b1b', bg: '#fde2e2', screenId: 'sales-invoice', currency: true },
];

const EMPTY: SalesDashboardData = {
  newSalesOrders: 0, pendingApproval: 0, approvedOrders: 0, partiallyDispatched: 0,
  overdueOrders: 0, pendingPi: 0, pendingDispatch: 0, dispatched: 0,
  pendingInvoice: 0, postedInvoices: 0, pendingReturns: 0,
  totalSO: 0, totalPI: 0, totalDC: 0, totalInvoice: 0, totalReturns: 0,
  openOrderValue: 0, dispatchedMtd: 0, invoicedMtd: 0,
  overdueBeyondMsme45Count: 0, overdueBeyondMsme45Value: 0,
};

export default function SalesDashboard() {
  const { toast } = useToast();
  const { openTab } = useTabs();
  const [data, setData] = useState<SalesDashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: d } = await apiClient.get('/v1/sales/dashboard');
        setData((c) => ({ ...c, ...d }));
      } catch (e) { toast(getApiErrorMessage(e, 'Dashboard load failed.'), 'error'); }
      setLoading(false);
    };
    load();
  }, []);

  function handleCardClick(kpi: KpiCard) {
    if (!kpi.screenId) return;
    const Comp = getScreenComponent(kpi.screenId);
    if (!Comp) return;
    openTab({
      id: kpi.status ? `${kpi.screenId}:${kpi.status}` : kpi.screenId,
      label: kpi.label,
      icon: kpi.icon,
      component: Comp,
      props: kpi.status ? { initialStatus: kpi.status } : undefined,
    } as any);
  }

  return (
    <>
      <div className="pg-head">
        <h1>Sales Dashboard</h1>
        <p>Order, dispatch, billing and return monitoring</p>
      </div>

      <div className="panel">
        {loading ? (
          <div className="empty"><span className="material-symbols-rounded">hourglass_empty</span> Loading dashboard...</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, padding: 20 }}>
            {KPI_CARDS.map((kpi) => (
              <div
                key={kpi.key}
                onClick={() => handleCardClick(kpi)}
                style={{
                  background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20,
                  display: 'flex', alignItems: 'center', gap: 16,
                  cursor: kpi.screenId ? 'pointer' : 'default',
                  transition: 'box-shadow 0.15s, transform 0.15s',
                }}
                onMouseEnter={(ev) => { if (kpi.screenId) { ev.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; ev.currentTarget.style.transform = 'translateY(-1px)'; } }}
                onMouseLeave={(ev) => { ev.currentTarget.style.boxShadow = 'none'; ev.currentTarget.style.transform = 'none'; }}
                title={kpi.screenId ? `View ${kpi.label}` : undefined}
              >
                <div style={{ width: 48, height: 48, borderRadius: 12, background: kpi.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 24, color: kpi.color }}>{kpi.icon}</span>
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
                    {kpi.currency ? `₹${formatNumber(data[kpi.key])}` : data[kpi.key]}
                  </div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                    {kpi.label}
                    {kpi.key === 'overdueBeyondMsme45Value' && data.overdueBeyondMsme45Count > 0
                      ? ` (${data.overdueBeyondMsme45Count} invoice${data.overdueBeyondMsme45Count === 1 ? '' : 's'})`
                      : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
