import { useMemo, useState } from 'react';
import { useTabs } from '../../../contexts/TabsContext';
import { useToast } from '../../../contexts/ToastContext';
import { getScreenComponent } from '../../../config/screenRegistry';
import {
  useReportsOverview,
  useSimpleReport,
  useStockSummary,
} from '../../../hooks/useInventoryReports';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatCurrency, formatNumber } from '../../../utils/format';
import ReportKpiCards from './ReportKpiCards';
import LowStockAlertPanel from './LowStockAlertPanel';
import ItemStockTab from './ItemStockTab';
import StoreStockTab from './StoreStockTab';
import MovementsTab from './MovementsTab';
import type { KpiCardConfig } from './reportsConfig';
import DrilldownPage from './DrilldownPage';
import StatusBarChart from './charts/StatusBarChart';
import CategoryDonut from './charts/CategoryDonut';
import LocationBarChart from './charts/LocationBarChart';
import TrendLineChart from './charts/TrendLineChart';
import AccuracyGauge from './charts/AccuracyGauge';
import TopItemsBarChart from './charts/TopItemsBarChart';
import AbcAnalysisChart from './charts/AbcAnalysisChart';
import StockAgingChart from './charts/StockAgingChart';

type Period = 'LAST_7' | 'LAST_30' | 'THIS_MONTH' | 'THIS_YEAR';
type TabKey = 'overview' | 'item' | 'store' | 'movements' | 'reorder';

const PERIOD_LABELS: Record<Period, string> = {
  LAST_7: 'Last 7 Days',
  LAST_30: 'Last 30 Days',
  THIS_MONTH: 'This Month',
  THIS_YEAR: 'This Year',
};

// Single left-rail nav for the whole page — replaces the old toolbar-row +
// tab-strip pair, which gave every screen two different-looking places to
// start from. An item with `key` switches the in-page view below; an item
// with `screenId` opens a separate full tab instead (a raw ledger, a fully
// filterable drilldown grid, etc. — content that doesn't fit as a sub-view).
type NavItem =
  | { kind: 'tab'; key: TabKey; label: string; icon: string }
  | { kind: 'screen'; screenId: string; label: string; icon: string };

const NAV_ITEMS: NavItem[] = [
  { kind: 'tab', key: 'overview', label: 'Overview', icon: 'space_dashboard' },
  { kind: 'screen', screenId: 'store-stock-summary', label: 'Stock by Store', icon: 'warehouse' },
  // Renders one row per item × store (StoreStockTab / the store-stock API) —
  // genuinely SKU-level detail, not the store-level totals "Stock by Store"
  // (store-stock-summary) shows. Naming it "Stock by Store" collided with
  // that other, different-granularity screen.
  { kind: 'tab', key: 'store', label: 'Stock Detail', icon: 'grid_view' },
  { kind: 'tab', key: 'item', label: 'Item-wise Stock', icon: 'view_list' },
  { kind: 'screen', screenId: 'current-stock', label: 'Current Stock (full grid)', icon: 'inventory' },
  { kind: 'tab', key: 'movements', label: 'Stock Movements', icon: 'swap_vert' },
  { kind: 'screen', screenId: 'inventory-log', label: 'Inventory Log', icon: 'menu_book' },
  { kind: 'tab', key: 'reorder', label: 'Re-order', icon: 'shopping_cart' },
  { kind: 'screen', screenId: 'traceability-viewer', label: 'Traceability', icon: 'timeline' },
  { kind: 'screen', screenId: 'inventory-period-report', label: 'Daily / Weekly / Monthly', icon: 'calendar_month' },
];

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

export default function InventoryReportsPage() {
  const { openTab } = useTabs();
  const { toast } = useToast();

  const [period, setPeriod] = useState<Period>('LAST_30');
  const [tab, setTab] = useState<TabKey>('overview');

  const { fromDate, toDate } = useMemo(() => getRange(period), [period]);

  const overviewQuery = useReportsOverview(fromDate, toDate);
  const stockSummaryQuery = useStockSummary();
  const simpleReportQuery = useSimpleReport();

  const handleCardClick = (card: KpiCardConfig) => {
    if (card.screenId) {
      openTab({
        id: card.screenId,
        label: card.label,
        icon: card.icon,
        component: getScreenComponent(card.screenId),
        props: { title: card.label, screenId: card.screenId },
      });
      return;
    }

    if (card.drilldown) {
      openTab({
        id: `drilldown-${card.drilldown}`,
        label: card.label,
        icon: card.icon,
        component: DrilldownPage,
        props: { drilldownType: card.drilldown },
      });
    }
  };

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
      props: {
        prefill: {
          itemCode,
          orderQty: suggestedQty,
        },
      },
    });
    toast(
      `New Purchase Request opened for ${itemCode} — ${itemName}, suggested qty ${formatNumber(suggestedQty)}. Review and submit.`
    );
  };

  const overview = overviewQuery.data;
  const stockSummary = stockSummaryQuery.data;
  const totals = stockSummary?.totals;

  return (
    <>
      <div className="pg-head">
        <h1>Inventory Reports</h1>
        <p>Catch-all stock picture in plain words — by item, by store, and what moved</p>
      </div>

      <div className="ir-shell">
        {/* One nav, one place to start from — replaces the old toolbar-buttons
            row plus a separate tab-strip row below it. A horizontal, wrapping
            button row above the content (sticky while scrolling). An item
            either switches the view below, or opens a full separate tab
            (marked with the "open in new" glyph) for content that doesn't
            fit as a sub-view — see .ir-rail in main.css. */}
        <nav className="panel ir-rail" aria-label="Inventory Reports sections">
          {NAV_ITEMS.map((item) => {
            const active = item.kind === 'tab' && tab === item.key;
            return (
              <button
                key={item.kind === 'tab' ? item.key : item.screenId}
                className={active ? 'btn on' : 'btn'}
                onClick={() =>
                  item.kind === 'tab'
                    ? setTab(item.key)
                    : openScreenTab(item.screenId, item.label, item.icon)
                }
                style={{
                  justifyContent: 'flex-start',
                  ...(active ? { background: 'var(--btn-primary, #1d2b53)', color: '#fff' } : undefined),
                }}
              >
                <span className="material-symbols-rounded">{item.icon}</span>
                {item.label}
                {item.kind === 'screen' && (
                  <span
                    className="material-symbols-rounded"
                    style={{ marginLeft: 'auto', fontSize: 15, opacity: 0.55 }}
                    aria-label="Opens in a new tab"
                  >
                    open_in_new
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="panel" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginBottom: 16 }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)' }}>Time Period:</span>
            <select
              className="in"
              value={period}
              onChange={(event) => setPeriod(event.target.value as Period)}
              style={{ width: '160px' }}
            >
              {Object.entries(PERIOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

      {overviewQuery.isError && tab === 'overview' && (
        <div className="panel">
          <div className="empty">
            <span className="material-symbols-rounded">error</span>
            {getApiErrorMessage(
              overviewQuery.error,
              'Unable to load inventory reports.'
            )}
            <div style={{ marginTop: '14px' }}>
              <button className="btn" onClick={() => overviewQuery.refetch()}>
                <span className="material-symbols-rounded">refresh</span>
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'item' && <ItemStockTab />}

      {tab === 'store' && <StoreStockTab />}

      {tab === 'movements' && (
        <MovementsTab
          received={overview?.received}
          issued={overview?.issued}
          receivedToday={overview?.receivedToday}
          issuedToday={overview?.issuedToday}
          fromDate={fromDate}
          toDate={toDate}
        />
      )}

      {tab === 'reorder' && (
        <>
          <LowStockAlertPanel
            items={simpleReportQuery.data?.reorderList ?? []}
            soonItems={simpleReportQuery.data?.reorderSoonList ?? []}
            isLoading={simpleReportQuery.isPending}
            onCreateRequest={handleCreatePurchaseRequest}
            onViewAll={() => openDrilldownTab('low-stock', 'Low Stock', 'warning')}
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 14,
            }}
          >
            <div className="panel" style={{ background: 'var(--green-bg, #e7f6ec)', borderLeft: '5px solid var(--green)' }}>
              <div className="panel-h"><h2><span className="material-symbols-rounded">inventory_2</span> Items in Store</h2></div>
              <div style={{ padding: 8, fontSize: 28, fontWeight: 800 }}>{formatNumber(totals?.itemCount)}</div>
              <div style={{ padding: '0 8px 8px', color: 'var(--muted)' }}>
                {formatNumber(totals?.qtyOnHand)} pieces total
              </div>
            </div>

            <div className="panel" style={{ background: 'var(--purple-bg, #f0ecfb)', borderLeft: '5px solid var(--purple)' }}>
              <div className="panel-h"><h2><span className="material-symbols-rounded">payments</span> Stock Value</h2></div>
              <div style={{ padding: 8, fontSize: 28, fontWeight: 800 }}>{formatCurrency(totals?.value)}</div>
              <div style={{ padding: '0 8px 8px', color: 'var(--muted)' }}>Total value of items in store</div>
            </div>

            <div className="panel" style={{ background: '#fdf3e7', borderLeft: '5px solid var(--yellow)' }}>
              <div className="panel-h"><h2><span className="material-symbols-rounded">warning</span> Low Stock</h2></div>
              <div style={{ padding: 8, fontSize: 28, fontWeight: 800 }}>{formatNumber(totals?.lowStockCount)}</div>
              <div style={{ padding: '0 8px 8px', color: 'var(--muted)' }}>Items running low, need reorder</div>
            </div>

            <div className="panel" style={{ background: '#fdecec', borderLeft: '5px solid var(--red)' }}>
              <div className="panel-h"><h2><span className="material-symbols-rounded">block</span> Not Available</h2></div>
              <div style={{ padding: 8, fontSize: 28, fontWeight: 800 }}>{formatNumber(totals?.notAvailableCount)}</div>
              <div style={{ padding: '0 8px 8px', color: 'var(--muted)' }}>Items not in store right now</div>
            </div>
          </div>

          {(stockSummary?.notAvailableItems?.length ?? 0) > 0 && (
            <div className="panel">
              <div className="panel-h">
                <h2><span className="material-symbols-rounded">block</span> Items Not Available</h2>
                <button className="btn" onClick={() => openDrilldownTab('not-available', 'Not Available', 'inventory_2')}>
                  <span className="material-symbols-rounded">open_in_new</span>
                  View All
                </button>
              </div>
              <div className="twrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="num">S.No</th>
                      <th>Item</th>
                      <th>Name</th>
                      <th>Specification</th>
                      <th>Type</th>
                      <th>Location</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(stockSummary?.notAvailableItems ?? []).slice(0, 8).map((item, idx) => (
                      <tr key={item.itemCode}>
                        <td className="num mut">{idx + 1}</td>
                        <td>{item.itemCode}</td>
                        <td>{item.itemName}</td>
                        <td className="mut">{item.specification || '—'}</td>
                        <td>{item.itemType}</td>
                        <td>{item.defaultWarehouse || '—'}</td>
                        <td><span className="badge" style={{ background: 'var(--red-bg, #fdecec)', color: 'var(--red)' }}>Not Available</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'overview' &&
        (overviewQuery.isPending ? (
          <div className="panel">
            <div className="empty">
              <span className="material-symbols-rounded">hourglass_empty</span>
              Loading inventory reports...
            </div>
          </div>
        ) : overview ? (
          <>
            {/* The full low-stock alert list lives only on the Re-order tab now —
                this screen's "Low Stock" KPI card is the one entry point into it,
                instead of showing the identical panel on both tabs. */}
            <ReportKpiCards kpis={overview.kpis} onCardClick={handleCardClick} />

            <div className="report-grid">
              <div className="panel">
                <div className="panel-h">
                  <h2>
                    <span className="material-symbols-rounded">bar_chart</span>
                    Inventory Status (Monthly)
                  </h2>
                </div>
                <div style={{ padding: 16 }}>
                  <StatusBarChart data={overview.monthlyStatus ?? []} />
                </div>
              </div>

              <div className="panel">
                <div className="panel-h">
                  <h2>
                    <span className="material-symbols-rounded">donut_large</span>
                    Stock by Category
                  </h2>
                </div>
                <div style={{ padding: 16 }}>
                  <CategoryDonut data={overview.categoryDistribution ?? []} />
                </div>
              </div>

              <div className="panel">
                <div className="panel-h">
                  <h2>
                    <span className="material-symbols-rounded">show_chart</span>
                    Inward vs Issue Trend
                  </h2>
                </div>
                <div style={{ padding: 16 }}>
                  <TrendLineChart data={overview.inwardIssueTrend ?? []} />
                </div>
              </div>

              <div className="panel">
                <div className="panel-h">
                  <h2>
                    <span className="material-symbols-rounded">warehouse</span>
                    Stock by Location
                  </h2>
                </div>
                <div style={{ padding: 16 }}>
                  <LocationBarChart data={overview.locationDistribution ?? []} />
                </div>
              </div>

              <div className="panel">
                <div className="panel-h">
                  <h2>
                    <span className="material-symbols-rounded">leaderboard</span>
                    Top 10 Fast-Moving Items (by Value)
                  </h2>
                </div>
                <div style={{ padding: 16 }}>
                  <TopItemsBarChart data={overview.topItemsByValue ?? []} />
                </div>
              </div>

              <div className="panel">
                <div className="panel-h">
                  <h2>
                    <span className="material-symbols-rounded">inventory_2</span>
                    Top 10 Slow-Moving / Dead Stock
                  </h2>
                </div>
                <div style={{ padding: 16 }}>
                  <TopItemsBarChart data={overview.slowMovingItems ?? []} />
                </div>
              </div>

              <div className="panel">
                <div className="panel-h">
                  <h2>
                    <span className="material-symbols-rounded">speed</span>
                    Stock Health
                  </h2>
                </div>
                <div style={{ padding: 16 }}>
                  <AccuracyGauge value={overview.kpis?.accuracyPct ?? 0} />
                </div>
              </div>

              <div className="panel">
                <div className="panel-h">
                  <h2>
                    <span className="material-symbols-rounded">stacked_bar_chart</span>
                    ABC Analysis
                  </h2>
                </div>
                <div style={{ padding: 16 }}>
                  <AbcAnalysisChart data={overview.abcAnalysis ?? []} />
                </div>
              </div>

              <div className="panel">
                <div className="panel-h">
                  <h2>
                    <span className="material-symbols-rounded">schedule</span>
                    Stock Aging
                  </h2>
                </div>
                <div style={{ padding: 16 }}>
                  <StockAgingChart data={overview.stockAging ?? []} />
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-h">
                <h2>
                  <span className="material-symbols-rounded">category</span>
                  Stock by Item Group
                </h2>
                {/* Same tab-id as the toolbar's "Current Stock" button (openScreenTab,
                    not openDrilldownTab) so this never opens a second, identical tab. */}
                <button className="btn" onClick={() => openScreenTab('current-stock', 'Current Stock', 'inventory')}>
                  <span className="material-symbols-rounded">open_in_new</span>
                  Current Stock
                </button>
              </div>
              {stockSummaryQuery.isPending ? (
                <div className="empty">
                  <span className="material-symbols-rounded">hourglass_empty</span>
                  Loading item group summary...
                </div>
              ) : (
                <div className="twrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th className="num">S.No</th>
                        <th>Item Group</th>
                        <th className="num">Items</th>
                        <th className="num">Qty in Store</th>
                        <th className="num">Value</th>
                        <th className="num">Not Available</th>
                        <th className="num">Low Stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stockSummary?.groups ?? []).map((group, idx) => (
                        <tr key={group.group}>
                          <td className="num mut">{idx + 1}</td>
                          <td>{group.group}</td>
                          <td className="num">{formatNumber(group.itemCount)}</td>
                          <td className="num">{formatNumber(group.qtyOnHand)}</td>
                          <td className="num">{formatCurrency(group.value)}</td>
                          <td className="num" style={{ color: group.notAvailableCount > 0 ? 'var(--red)' : undefined }}>
                            {formatNumber(group.notAvailableCount)}
                          </td>
                          <td className="num" style={{ color: group.lowStockCount > 0 ? 'var(--yellow)' : undefined }}>
                            {formatNumber(group.lowStockCount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : null)}
        </div>
      </div>
    </>
  );
}
