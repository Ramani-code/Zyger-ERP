import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import { useEffect } from 'react';
import { useTabs } from '../../../contexts/TabsContext';
import { useToast } from '../../../contexts/ToastContext';
import { getScreenComponent } from '../../../config/screenRegistry';
import {
  useCurrentStock,
  useDrilldown,
  useReportsOverview,
  useSimpleReport,
  useStockLedger,
  useStockSummary,
} from '../../../hooks/useInventoryReports';
import { inventoryReportsService } from '../../../services/inventoryReportsService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatCurrency, formatDate, formatNumber } from '../../../utils/format';
import {
  classifyStock,
  reorderThreshold,
  REORDER_STATUS_META,
  suggestedOrderQty,
  type ReorderStatus,
  type StockLevelRow,
} from '../../../utils/stockLevels';
import LowStockAlertPanel from './LowStockAlertPanel';
import DrilldownPage from './DrilldownPage';
import ItemTypeChip from './ItemTypeChip';
import StatusBarChart from './charts/StatusBarChart';
import CategoryDonut from './charts/CategoryDonut';
import LocationBarChart from './charts/LocationBarChart';
import TrendLineChart from './charts/TrendLineChart';
import AccuracyGauge from './charts/AccuracyGauge';
import AbcAnalysisChart from './charts/AbcAnalysisChart';
import type { DrilldownRow } from '../../../types/inventory/reports.types';

type Period = 'LAST_7' | 'LAST_30' | 'THIS_MONTH' | 'THIS_YEAR';

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getRange(period: Period): { fromDate: string; toDate: string } {
  const now = new Date();
  const toDate = toDateInput(now);

  if (period === 'LAST_7') {
    const from = new Date(now);
    from.setDate(now.getDate() - 6);
    return { fromDate: toDateInput(from), toDate };
  }

  if (period === 'LAST_30') {
    const from = new Date(now);
    from.setDate(now.getDate() - 29);
    return { fromDate: toDateInput(from), toDate };
  }

  if (period === 'THIS_MONTH') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { fromDate: toDateInput(from), toDate };
  }

  const from = new Date(now.getFullYear(), 0, 1);
  return { fromDate: toDateInput(from), toDate };
}

function num(row: DrilldownRow, key: string): number {
  const v = row[key];
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
}

function str(row: DrilldownRow, key: string): string {
  const v = row[key];
  if (v === null || v === undefined) return '';
  return String(v);
}

/** Direction icon for a stock-ledger transaction type, keyword-matched since
 * txType values are free-form business codes. */
function txTypeIcon(txType: string): string {
  const t = txType.toUpperCase();
  if (t.includes('TRANSFER')) return '🔄';
  if (t.includes('RETURN')) return '↩';
  if (t.includes('ISSUE') || t.includes('DISPATCH') || t.includes('OUT')) return '⬆';
  if (t.includes('RECEIPT') || t.includes('INWARD') || t.includes('RELEASE')) return '⬇';
  return '•';
}

function StatusPill({ status }: { status: ReorderStatus }) {
  const meta = REORDER_STATUS_META[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '3px 10px',
        borderRadius: '12px',
        fontSize: '0.78rem',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        background: meta.bg,
        color: meta.color,
      }}
    >
      <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>
        {meta.icon}
      </span>
      {meta.label}
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: '11px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--muted)',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '14px', fontWeight: 600, marginTop: 2 }}>{value || '—'}</div>
    </div>
  );
}

function AnalyticsList({
  title,
  rows,
}: {
  title: string;
  rows: { itemCode: string; itemName: string; value: number }[];
}) {
  return (
    <div className="panel" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
      <div className="panel-h"><h2>{title}</h2></div>
      {rows.length === 0 ? (
        <div className="empty">No data.</div>
      ) : (
        <div style={{ padding: '8px 0' }}>
          {rows.map((row, idx) => (
            <div
              key={row.itemCode}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                padding: '8px 16px',
                borderBottom: '1px solid var(--border-subtle, #f1f5f9)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--muted)' }}>
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '13px' }}>{row.itemName || row.itemCode}</div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'monospace' }}>
                    {row.itemCode}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '13px', fontWeight: 800, whiteSpace: 'nowrap' }}>
                {formatCurrency(row.value)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PRINT_TABLE: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginBottom: '16px',
  fontSize: '12px',
};

interface KpiTile {
  label: string;
  value: string;
  sub: string;
  icon: string;
  color: string;
  onClick?: () => void;
}

export default function InventoryDashboardPage() {
  const { openTab } = useTabs();
  const { toast } = useToast();

  const [period, setPeriod] = useState<Period>('LAST_30');
  const [store, setStore] = useState('');
  const [category, setCategory] = useState('');
  const [reorderStatus, setReorderStatus] = useState<string>('ALL');
  const [itemType, setItemType] = useState('');
  const [tableTab, setTableTab] = useState<'transactions' | 'analytics'>('transactions');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const { fromDate, toDate } = useMemo(() => getRange(period), [period]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const overviewQuery = useReportsOverview(fromDate, toDate);
  const stockSummaryQuery = useStockSummary();
  const simpleReportQuery = useSimpleReport();
  const ledgerQuery = useStockLedger({ page: 0, size: 12, fromDate, toDate });
  const itemStockQuery = useCurrentStock({
    page: 0,
    size: 200,
    search: search || undefined,
    location: store || undefined,
    category: category || undefined,
    status: reorderStatus === 'ALL' ? undefined : reorderStatus,
    itemType: itemType || undefined,
    includeZero: true,
  });
  const storeSummaryQuery = useDrilldown('store-stock-summary', { page: 0, size: 100 });

  const overview = overviewQuery.data;
  const stockSummary = stockSummaryQuery.data;
  const totals = stockSummary?.totals;
  const storeRows = storeSummaryQuery.data?.content ?? [];

  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (overview?.categoryDistribution ?? []).map((c) => c.category).filter(Boolean)
        )
      ).sort(),
    [overview]
  );

  const openScreenTab = (screenId: string, label: string, icon: string) => {
    openTab({
      id: screenId,
      label,
      icon,
      component: getScreenComponent(screenId),
      props: { title: label, screenId },
    });
  };

  const openDrilldownTab = (type: string, label: string, icon: string) => {
    openTab({
      id: `drilldown-${type}`,
      label,
      icon,
      component: DrilldownPage,
      props: { drilldownType: type },
    });
  };

  const openStoreStockTab = (storeCode: string) => {
    openTab({
      id: `store-detail-${storeCode}`,
      label: `Store — ${storeCode}`,
      icon: 'warehouse',
      component: getScreenComponent('store-detail'),
      props: { initialFilters: { location: storeCode } },
    });
  };

  const handleCreatePurchaseRequest = (
    itemCode: string,
    itemName: string,
    suggestedQty: number
  ) => {
    openTab({
      id: `purchase-request-low-stock-${itemCode}`,
      label: 'Purchase Request',
      icon: 'shopping_cart',
      component: getScreenComponent('purchase-request'),
      props: { prefill: { itemCode, orderQty: suggestedQty } },
    });
    toast(
      `New Purchase Request opened for ${itemCode} — ${itemName}, suggested qty ${formatNumber(suggestedQty)}. Review and submit.`
    );
  };

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    try {
      await inventoryReportsService.exportFile(
        'simple',
        'Inventory Dashboard Report',
        { page: 0, size: 100 },
        format
      );
      toast('Inventory report downloaded.');
    } catch (exportError) {
      toast(
        getApiErrorMessage(exportError, 'Export failed. Backend export endpoint is not available.'),
        'error'
      );
    }
  };

  const kpiTiles: KpiTile[] = [
    {
      label: 'Stock Value',
      value: formatCurrency(totals?.value ?? 0),
      sub: 'Total value in store',
      icon: 'payments',
      color: 'var(--purple)',
      onClick: () => openScreenTab('current-stock', 'Current Stock', 'inventory'),
    },
    {
      label: 'Items in Store',
      value: formatNumber(totals?.itemCount ?? 0),
      sub: 'Active item count',
      icon: 'category',
      color: 'var(--blue)',
      onClick: () => openScreenTab('current-stock', 'Current Stock', 'inventory'),
    },
    {
      label: 'Qty On Hand',
      value: formatNumber(totals?.qtyOnHand ?? 0),
      sub: 'Total pieces',
      icon: 'inventory_2',
      color: 'var(--blue)',
      onClick: () => openScreenTab('current-stock', 'Current Stock', 'inventory'),
    },
    {
      label: 'Available',
      value: formatNumber(totals?.qtyAvailable ?? 0),
      sub: 'Free to issue',
      icon: 'check_circle',
      color: 'var(--green)',
      onClick: () => openScreenTab('current-stock', 'Current Stock', 'inventory'),
    },
    {
      label: 'Low Stock',
      value: formatNumber(totals?.lowStockCount ?? 0),
      sub: 'Need reorder',
      icon: 'warning',
      color: 'var(--yellow)',
      onClick: () => openDrilldownTab('low-stock', 'Low Stock', 'warning'),
    },
    {
      label: 'Not Available',
      value: formatNumber(totals?.notAvailableCount ?? 0),
      sub: 'No stock now',
      icon: 'block',
      color: 'var(--red)',
      onClick: () => openDrilldownTab('not-available', 'Not Available', 'inventory_2'),
    },
    {
      label: 'Active Stores',
      value: formatNumber(overview?.kpis?.activeStoreCount ?? 0),
      sub: 'Open stores',
      icon: 'warehouse',
      color: 'var(--green)',
      onClick: () => openScreenTab('store-stock-summary', 'Stock by Store', 'warehouse'),
    },
  ];

  const ledgerRows = ledgerQuery.data?.content ?? [];

  return (
    <>
      <style>{`
        @media print {
          .inv-dash-screen { display: none !important; }
          .inv-dash-print { display: block !important; }
        }
        .inv-dash-print { display: none; }
        .inv-dash-print table, .inv-dash-print th, .inv-dash-print td {
          border: 1px solid #999; padding: 5px 8px;
        }
      `}</style>

      {/* ──────────────────────────────── PRINTABLE REPORT ─────────────────── */}
      <div className="inv-dash-print">
        <h1 style={{ margin: 0 }}>Inventory Dashboard Report</h1>
        <p style={{ margin: '4px 0 16px', color: '#555' }}>
          Generated {new Date().toLocaleString()} · Period:{' '}
          {period.replace('_', ' ').toLowerCase()} ({fromDate} → {toDate})
          {store ? ` · Store: ${store}` : ''}
        </p>

        <h2>1. Stock Summary</h2>
        <table style={PRINT_TABLE}>
          <thead>
            <tr>
              <th>Items in Store</th>
              <th>Qty On Hand</th>
              <th>Value</th>
              <th>Low Stock</th>
              <th>Not Available</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{formatNumber(totals?.itemCount ?? 0)}</td>
              <td>{formatNumber(totals?.qtyOnHand ?? 0)}</td>
              <td>{formatCurrency(totals?.value ?? 0)}</td>
              <td>{formatNumber(totals?.lowStockCount ?? 0)}</td>
              <td>{formatNumber(totals?.notAvailableCount ?? 0)}</td>
            </tr>
          </tbody>
        </table>

        <h2>2. Low Stock Alert</h2>
        <table style={PRINT_TABLE}>
          <thead>
            <tr>
              <th>Item Code</th>
              <th>Item Name</th>
              <th>On Hand</th>
              <th>Reorder At</th>
              <th>Suggested Order</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(simpleReportQuery.data?.reorderList ?? []).map((row) => (
              <tr key={String(row.id)}>
                <td>{str(row, 'itemCode')}</td>
                <td>{str(row, 'itemName')}</td>
                <td>{formatNumber(num(row, 'onHandQty'))}</td>
                <td>{formatNumber(reorderThreshold(row))}</td>
                <td>{formatNumber(suggestedOrderQty(row))}</td>
                <td>{classifyStock(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>3. Stock by Store</h2>
        <table style={PRINT_TABLE}>
          <thead>
            <tr>
              <th>Store</th>
              <th>Items</th>
              <th>On Hand</th>
              <th>Available</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {storeRows.map((row) => (
              <tr key={str(row, 'storeCode')}>
                <td>{str(row, 'storeName') || str(row, 'storeCode')}</td>
                <td>{formatNumber(num(row, 'itemCount'))}</td>
                <td>{formatNumber(num(row, 'totalOnHand'))}</td>
                <td>{formatNumber(num(row, 'totalAvailable'))}</td>
                <td>{formatCurrency(num(row, 'totalValue'))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>4. Current Stock</h2>
        <table style={PRINT_TABLE}>
          <thead>
            <tr>
              <th>Item</th>
              <th>Name</th>
              <th>Location</th>
              <th>On Hand</th>
              <th>Value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(itemStockQuery.data?.content ?? []).slice(0, 50).map((row) => (
              <tr key={row.id}>
                <td>{row.itemCode}</td>
                <td>{row.itemName}</td>
                <td>{formatNumber(row.onHand)}</td>
                <td>{formatCurrency(row.value)}</td>
                <td>{classifyStock({ reorderStatus: row.reorderStatus } as StockLevelRow)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>5. Recent Transactions</h2>
        <table style={PRINT_TABLE}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Document</th>
              <th>Type</th>
              <th>Item</th>
              <th>In</th>
              <th>Out</th>
            </tr>
          </thead>
          <tbody>
            {ledgerRows.map((row) => (
              <tr key={String(row.id)}>
                <td>{formatDate(str(row, 'date'))}</td>
                <td>{str(row, 'docNo')}</td>
                <td>{str(row, 'txType')}</td>
                <td>{str(row, 'itemCode')}</td>
                <td>{formatNumber(num(row, 'inQty'))}</td>
                <td>{formatNumber(num(row, 'outQty'))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ───────────────────────────────── DASHBOARD ───────────────────────── */}
      <div className="inv-dash-screen">
        <div
          className="pg-head"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h1 style={{ fontWeight: 800 }}>Inventory Dashboard</h1>
            <p>KPI tiles, low stock alerts, store-wise comparison and current stock</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => window.print()}>
              <span className="material-symbols-rounded">print</span>
              Print
            </button>
            <button className="btn" onClick={() => handleExport('pdf')}>
              <span className="material-symbols-rounded">picture_as_pdf</span>
              PDF
            </button>
            <button className="btn" onClick={() => handleExport('xlsx')}>
              <span className="material-symbols-rounded">download</span>
              Excel
            </button>
            <button className="btn" onClick={() => openScreenTab('reports', 'Detailed Reports', 'monitoring')}>
              <span className="material-symbols-rounded">open_in_new</span>
              Detailed
            </button>
          </div>
        </div>

        {/* Sticky filter bar */}
        <div className="panel" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
          <div className="toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)' }}>Store:</span>
              <select className="in" value={store} onChange={(e) => setStore(e.target.value)} style={{ width: '170px' }}>
                <option value="">All Stores</option>
                {storeRows.map((row) => (
                  <option key={str(row, 'storeCode')} value={str(row, 'storeCode')}>
                    {str(row, 'storeName') || str(row, 'storeCode')}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)' }}>Category:</span>
              <select className="in" value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: '170px' }}>
                <option value="">All Categories</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)' }}>Period:</span>
              <select className="in" value={period} onChange={(e) => setPeriod(e.target.value as Period)} style={{ width: '150px' }}>
                <option value="LAST_7">Last 7 Days</option>
                <option value="LAST_30">Last 30 Days</option>
                <option value="THIS_MONTH">This Month</option>
                <option value="THIS_YEAR">This Year</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)' }}>Status:</span>
              <select className="in" value={reorderStatus} onChange={(e) => setReorderStatus(e.target.value)} style={{ width: '150px' }}>
                <option value="ALL">All Statuses</option>
                <option value="OUT_OF_STOCK">Out of Stock</option>
                <option value="PURCHASE_NOW">Purchase Now</option>
                <option value="REORDER_SOON">Reorder Soon</option>
                <option value="OK">OK</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)' }}>Type:</span>
              <select className="in" value={itemType} onChange={(e) => setItemType(e.target.value)} style={{ width: '155px' }}>
                <option value="">All Types</option>
                <option value="PURCHASABLE">Purchasable</option>
                <option value="CUSTOMER_SUPPLIED">Customer Supplied</option>
                <option value="MANUFACTURING">Manufacturing</option>
              </select>
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button className="btn" onClick={() => openScreenTab('current-stock', 'Current Stock', 'inventory')}>
                <span className="material-symbols-rounded">inventory</span>
                Current Stock
              </button>
              <button className="btn" onClick={() => openScreenTab('store-stock-summary', 'Stock by Store', 'warehouse')}>
                <span className="material-symbols-rounded">warehouse</span>
                Stock by Store
              </button>
            </div>
          </div>
        </div>

        {/* Region A — KPI tiles (8) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px' }}>
          {kpiTiles.map((tile) => (
            <div
              key={tile.label}
              className="card"
              onClick={tile.onClick}
              style={{
                padding: '16px',
                borderRadius: '12px',
                cursor: tile.onClick ? 'pointer' : 'default',
                borderLeft: `5px solid ${tile.color}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)' }}>{tile.label}</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px' }}>
                    {tile.value}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>{tile.sub}</div>
                </div>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    background: `${tile.color}1f`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <span className="material-symbols-rounded" style={{ color: tile.color, fontSize: '24px' }}>
                    {tile.icon}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Regions B + C — Low stock alert + store-wise comparison */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)',
            gap: '16px',
            marginTop: '16px',
          }}
        >
          <LowStockAlertPanel
            items={simpleReportQuery.data?.reorderList ?? []}
            soonItems={simpleReportQuery.data?.reorderSoonList ?? []}
            isLoading={simpleReportQuery.isPending}
            onCreateRequest={handleCreatePurchaseRequest}
            onViewAll={() => openDrilldownTab('low-stock', 'Low Stock', 'warning')}
          />

          <div className="panel">
            <div className="panel-h">
              <h2>
                <span className="material-symbols-rounded">warehouse</span>
                Store-wise Comparison
              </h2>
              {/* "View All" removed — redundant with the "Stock by Store" button in the
                  sticky filter bar above, which opens this exact same screen. */}
            </div>
            {storeSummaryQuery.isPending ? (
              <div className="empty">
                <span className="material-symbols-rounded">hourglass_empty</span>
                Loading stores...
              </div>
            ) : (
              <>
                <div style={{ padding: '12px 16px' }}>
                  <LocationBarChart
                    data={storeRows.map((row) => ({
                      location: str(row, 'storeName') || str(row, 'storeCode'),
                      onHand: num(row, 'totalOnHand'),
                    }))}
                  />
                </div>
                <div className="twrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Store</th>
                        <th className="num">Items</th>
                        <th className="num">On Hand</th>
                        <th className="num">Available</th>
                        <th className="num">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storeRows.map((row) => (
                        <tr
                          key={str(row, 'storeCode')}
                          onClick={() => openStoreStockTab(str(row, 'storeCode'))}
                          style={{ cursor: 'pointer' }}
                          title="Drill into this store"
                        >
                          <td>{str(row, 'storeName') || str(row, 'storeCode')}</td>
                          <td className="num">{formatNumber(num(row, 'itemCount'))}</td>
                          <td className="num">{formatNumber(num(row, 'totalOnHand'))}</td>
                          <td className="num">{formatNumber(num(row, 'totalAvailable'))}</td>
                          <td className="num">{formatCurrency(num(row, 'totalValue'))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Region E — Item-wise Current Stock table */}
        <div className="panel" style={{ marginTop: '16px' }}>
          <div className="panel-h">
            <h2>
              <span className="material-symbols-rounded" style={{ color: 'var(--green)' }}>inventory</span>
              Current Stock
            </h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="searchwrap" style={{ minWidth: '200px', flex: '0 1 240px' }}>
                <span className="material-symbols-rounded">search</span>
                <input
                  className="in"
                  value={searchInput}
                  placeholder="Search item, name, or specification..."
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <select className="in" value={itemType} onChange={(e) => setItemType(e.target.value)} style={{ width: '150px' }}>
                  <option value="">All Types</option>
                  <option value="PURCHASABLE">Purchasable</option>
                  <option value="CUSTOMER_SUPPLIED">Customer Supplied</option>
                  <option value="MANUFACTURING">Manufacturing</option>
                </select>
              </div>
              {/* "View All" removed — it dropped this panel's own search/type filters and
                  landed on the exact same unfiltered screen as the sticky bar's "Current
                  Stock" button above. */}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px', padding: '6px 16px', borderBottom: '1px solid var(--border)', fontSize: '12.5px', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
              OK — Enough
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--yellow)', display: 'inline-block' }} />
              Reorder Soon
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--red)', display: 'inline-block' }} />
              Need to Re-Order
            </span>
          </div>

          {itemStockQuery.isPending ? (
            <div className="empty">
              <span className="material-symbols-rounded">hourglass_empty</span>
              Loading current stock...
            </div>
          ) : itemStockQuery.isError ? (
            <div className="empty">
              <span className="material-symbols-rounded">error</span>
              {getApiErrorMessage(itemStockQuery.error, 'Unable to load current stock.')}
              <div style={{ marginTop: '14px' }}>
                <button className="btn" onClick={() => itemStockQuery.refetch()}>
                  <span className="material-symbols-rounded">refresh</span>
                  Retry
                </button>
              </div>
            </div>
          ) : (itemStockQuery.data?.content ?? []).length === 0 ? (
            <div className="empty">
              <span className="material-symbols-rounded">folder_open</span>
              No stock rows match the current filters.
            </div>
          ) : (
            <div className="twrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: '34px' }} />
                    <th>Item</th>
                    <th>Name / Specification</th>
                    <th>Type</th>
                    <th className="num">In Store</th>
                    <th className="num">Reserved</th>
                    <th className="num">Available to Use</th>
                    <th>Per Store</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {(itemStockQuery.data?.content ?? []).map((row) => {
                    const expanded = expandedRow === row.id;
                    return (
                      <Fragment key={row.id}>
                        <tr onClick={() => setExpandedRow(expanded ? null : row.id)} style={{ cursor: 'pointer' }}>
                          <td>
                            <span
                              className="material-symbols-rounded"
                              style={{
                                fontSize: '18px',
                                color: 'var(--muted)',
                                transform: expanded ? 'rotate(90deg)' : undefined,
                                transition: 'transform .15s',
                              }}
                            >
                              chevron_right
                            </span>
                          </td>
                          <td style={{ fontWeight: 700 }}>{row.itemCode}</td>
                          <td>
                            <div>{row.itemName}</div>
                            <div className="mut" style={{ fontSize: 12 }}>{row.specification || '—'}</div>
                          </td>
                          <td><ItemTypeChip type={row.itemType} /></td>
                          <td className="num">{formatNumber(row.onHand)}</td>
                          <td className="num">
                            {row.reserved > 0 ? (
                              <span style={{ color: 'var(--yellow)' }}>{formatNumber(row.reserved)}</span>
                            ) : 0}
                          </td>
                          <td className="num" style={{ fontWeight: 700, color: row.available <= 0 ? 'var(--red)' : undefined }}>
                            {formatNumber(row.available)}
                          </td>
                          <td>
                            {row.perStore.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {row.perStore.map((s) => (
                                  <span key={s.storeCode} title={`${s.storeName || s.storeCode}: ${formatNumber(s.onHand)} in store`} style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, background: 'var(--item-bg, #f1f3f5)' }}>
                                    <strong>{s.storeCode}</strong> {formatNumber(s.available)}
                                  </span>
                                ))}
                              </div>
                            ) : <span className="mut">—</span>}
                          </td>
                          <td>
                            <StatusPill status={classifyStock({ onHand: row.onHand, reorderPoint: row.reorderPoint, safetyStock: row.safetyStock, reorderStatus: row.reorderStatus })} />
                          </td>
                        </tr>
                        {expanded && (
                          <tr style={{ background: 'var(--bg-muted, #f8fafc)' }}>
                            <td colSpan={9} style={{ padding: '12px 16px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px 20px' }}>
                                <Detail label="Category" value={row.category} />
                                <Detail label="Item Group" value={row.itemGroup} />
                                <Detail label="UOM" value={row.uom} />
                                <Detail label="Total Value" value={formatCurrency(row.value)} />
                                <Detail label="Safety Stock" value={formatNumber(row.safetyStock)} />
                                <Detail label="Reorder Point" value={formatNumber(row.reorderPoint)} />
                                <Detail label="Reorder Qty" value={row.reorderQty != null ? formatNumber(row.reorderQty) : '—'} />
                                <Detail label="Max Stock Level" value={formatNumber(row.maxStockLevel)} />
                                <Detail label="Suggested Order" value={formatNumber(row.suggestedOrderQty)} />
                                <Detail label="Avg Daily Consumption" value={formatNumber(row.avgDailyConsumption)} />
                                <Detail label="QC Hold" value={formatNumber(row.qcHold)} />
                                <Detail label="Last In/Out" value={row.lastMovementDate ? formatDate(String(row.lastMovementDate)) : '—'} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Region D — Charts band */}
        <div className="report-grid" style={{ marginTop: '16px' }}>
          <div className="panel">
            <div className="panel-h">
              <h2><span className="material-symbols-rounded">speed</span> Stock Health</h2>
            </div>
            <div style={{ padding: 16 }}>
              <AccuracyGauge value={overview?.kpis?.accuracyPct ?? 0} />
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              <h2><span className="material-symbols-rounded">donut_large</span> Stock by Category</h2>
            </div>
            <div style={{ padding: 16 }}>
              <CategoryDonut data={overview?.categoryDistribution ?? []} />
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              <h2><span className="material-symbols-rounded">warehouse</span> Stock by Location</h2>
            </div>
            <div style={{ padding: 16 }}>
              <LocationBarChart data={overview?.locationDistribution ?? []} />
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              <h2><span className="material-symbols-rounded">show_chart</span> Inward vs Issue Trend</h2>
            </div>
            <div style={{ padding: 16 }}>
              <TrendLineChart data={overview?.inwardIssueTrend ?? []} />
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              <h2><span className="material-symbols-rounded">stacked_bar_chart</span> ABC Analysis</h2>
            </div>
            <div style={{ padding: 16 }}>
              <AbcAnalysisChart data={overview?.abcAnalysis ?? []} />
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              <h2><span className="material-symbols-rounded">bar_chart</span> Inventory Status (Monthly)</h2>
            </div>
            <div style={{ padding: 16 }}>
              <StatusBarChart data={overview?.monthlyStatus ?? []} />
            </div>
          </div>
        </div>

        {/* Region F — Transactions & Analytics tabs */}
        <div className="panel" style={{ marginTop: '16px' }}>
          <div className="panel-h">
            <h2><span className="material-symbols-rounded">swap_horiz</span> Transactions & Analytics</h2>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                className="btn"
                style={tableTab === 'transactions' ? { background: 'var(--blue)', borderColor: 'var(--blue)', color: '#fff' } : undefined}
                onClick={() => setTableTab('transactions')}
              >
                Transactions
              </button>
              <button
                className="btn"
                style={tableTab === 'analytics' ? { background: 'var(--blue)', borderColor: 'var(--blue)', color: '#fff' } : undefined}
                onClick={() => setTableTab('analytics')}
              >
                Analytics
              </button>
            </div>
          </div>

          {tableTab === 'transactions' ? (
            ledgerQuery.isPending ? (
              <div className="empty">
                <span className="material-symbols-rounded">hourglass_empty</span>
                Loading transactions...
              </div>
            ) : ledgerRows.length === 0 ? (
              <div className="empty">
                <span className="material-symbols-rounded">folder_open</span>
                No ledger entries in this period.
              </div>
            ) : (
              <div className="twrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Document</th>
                      <th>Type</th>
                      <th>Item</th>
                      <th>Name</th>
                      <th>Location</th>
                      <th className="num">In</th>
                      <th className="num">Out</th>
                      <th className="num">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRows.map((row) => (
                      <tr key={String(row.id)}>
                        <td>{formatDate(str(row, 'date'))}</td>
                        <td style={{ fontWeight: 600 }}>{str(row, 'docNo')}</td>
                        <td>{txTypeIcon(str(row, 'txType'))} {str(row, 'txType') || '—'}</td>
                        <td>{str(row, 'itemCode')}</td>
                        <td>{str(row, 'itemName')}</td>
                        <td>{str(row, 'location')}</td>
                        <td className="num" style={{ color: 'var(--green)' }}>{formatNumber(num(row, 'inQty'))}</td>
                        <td className="num" style={{ color: 'var(--red)' }}>{formatNumber(num(row, 'outQty'))}</td>
                        <td className="num">{formatNumber(num(row, 'runningBalance'))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', padding: '16px' }}>
              <AnalyticsList title="Top Fast Movers" rows={overview?.topItemsByValue ?? []} />
              <AnalyticsList title="Slow Movers / Dead Stock" rows={overview?.slowMovingItems ?? []} />
              <div className="panel" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
                <div className="panel-h"><h2>Stock Aging</h2></div>
                <div className="twrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Bucket</th>
                        <th className="num">Items</th>
                        <th className="num">Qty</th>
                        <th className="num">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(overview?.stockAging ?? []).map((bucket) => (
                        <tr key={bucket.bucket}>
                          <td>{bucket.bucket}</td>
                          <td className="num">{formatNumber(bucket.itemCount)}</td>
                          <td className="num">{formatNumber(bucket.qty)}</td>
                          <td className="num">{formatCurrency(bucket.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}