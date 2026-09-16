import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { masterService } from '../../../services/masterService';
import { useCurrentStock, useStockLedger } from '../../../hooks/useInventoryReports';
import { useTabs } from '../../../contexts/TabsContext';
import { useToast } from '../../../contexts/ToastContext';
import { getScreenComponent } from '../../../config/screenRegistry';
import { formatCurrency, formatDate, formatNumber } from '../../../utils/format';
import ItemTypeChip from './ItemTypeChip';

type DetailTab = 'stock' | 'movement' | 'aging' | 'replenishment';

const TABS: Array<{ key: DetailTab; label: string; icon: string }> = [
  { key: 'stock', label: 'Stock', icon: 'inventory_2' },
  { key: 'movement', label: 'Movement', icon: 'swap_vert' },
  { key: 'aging', label: 'Aging', icon: 'schedule' },
  { key: 'replenishment', label: 'Replenishment', icon: 'shopping_cart' },
];

const AGING_BUCKETS = [
  { label: '0-30 days', min: 0, max: 30 },
  { label: '31-60 days', min: 31, max: 60 },
  { label: '61-90 days', min: 61, max: 90 },
  { label: '91-180 days', min: 91, max: 180 },
  { label: '181-365 days', min: 181, max: 365 },
  { label: '365+ days', min: 366, max: Infinity },
];

function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

interface StoreDetailPageProps {
  initialFilters?: { location?: string };
}

export default function StoreDetailPage({ initialFilters }: StoreDetailPageProps) {
  const storeCode = initialFilters?.location ?? '';
  const { openTab, setActiveTab } = useTabs();
  const { toast } = useToast();
  const [tab, setTab] = useState<DetailTab>('stock');

  const storesQuery = useQuery({
    queryKey: ['master', 'stores'],
    queryFn: ({ signal }) => masterService.getStores(signal),
    staleTime: 1000 * 60 * 10,
  });
  const store = (storesQuery.data ?? []).find((s) => s.code === storeCode);

  // One data source for this store's items — current-stock filtered to this
  // location — serves the Stock, Aging, and Replenishment tabs so all three
  // agree with each other instead of each pulling from a slightly different
  // endpoint.
  const itemsQuery = useCurrentStock({
    page: 0,
    size: 500,
    location: storeCode,
    includeZero: true,
  });
  const items = useMemo(() => itemsQuery.data?.content ?? [], [itemsQuery.data]);

  const ninetyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  }, []);
  const ledgerQuery = useStockLedger({
    page: 0,
    size: 20,
    location: storeCode,
    fromDate: ninetyDaysAgo,
  });
  const ledgerRows = ledgerQuery.data?.content ?? [];

  const kpis = useMemo(() => {
    let onHand = 0, reserved = 0, qcHold = 0, available = 0, value = 0;
    let lastMovement: string | null = null;
    for (const row of items) {
      onHand += row.onHand;
      reserved += row.reserved;
      qcHold += row.qcHold;
      available += row.available;
      value += row.value;
      if (row.lastMovementDate && (!lastMovement || row.lastMovementDate > lastMovement)) {
        lastMovement = row.lastMovementDate;
      }
    }
    return { onHand, reserved, qcHold, available, value, lastMovement };
  }, [items]);

  const agingBuckets = useMemo(() => {
    return AGING_BUCKETS.map((bucket) => {
      let count = 0;
      let value = 0;
      for (const row of items) {
        if (row.onHand <= 0) continue;
        const days = daysSince(row.lastMovementDate);
        if (days == null) continue;
        if (days >= bucket.min && days <= bucket.max) {
          count += 1;
          value += row.value;
        }
      }
      return { ...bucket, count, value };
    });
  }, [items]);

  const replenishmentRows = useMemo(
    () => items.filter((row) => row.reorderStatus && row.reorderStatus !== 'OK'),
    [items]
  );

  const handleCreateRequest = (itemCode: string, itemName: string, suggestedQty: number) => {
    openTab({
      id: `purchase-request-low-stock-${itemCode}`,
      label: 'Purchase Request',
      icon: 'shopping_cart',
      component: getScreenComponent('purchase-request'),
      props: { prefill: { itemCode, orderQty: suggestedQty } },
    });
    toast(`New Purchase Request opened for ${itemCode} — ${itemName}, suggested qty ${formatNumber(suggestedQty)}. Review and submit.`);
  };

  if (!storeCode) {
    return (
      <div className="panel">
        <div className="empty">
          <span className="material-symbols-rounded">error</span>
          No store specified.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pg-head">
        <h1>{store?.name ?? storeCode}</h1>
        <p>
          Store {storeCode}
          {kpis.lastMovement ? ` — last movement ${formatDate(kpis.lastMovement)}` : ''}
        </p>
      </div>

      <div className="panel" style={{ padding: 8, display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        <button className="btn" onClick={() => setActiveTab('reports')}>
          <span className="material-symbols-rounded">arrow_back</span>
          Back
        </button>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'btn on' : 'btn'}
            onClick={() => setTab(t.key)}
            style={tab === t.key ? { background: 'var(--btn-primary, #1d2b53)', color: '#fff' } : undefined}
          >
            <span className="material-symbols-rounded">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="ic" style={{ background: 'var(--blue)' }}>
            <span className="material-symbols-rounded">inventory_2</span>
          </div>
          <div>
            <div className="l">On Hand</div>
            <div className="v">{itemsQuery.isPending ? '—' : formatNumber(kpis.onHand)}</div>
          </div>
        </div>
        <div className="stat">
          <div className="ic" style={{ background: 'var(--yellow)' }}>
            <span className="material-symbols-rounded">lock</span>
          </div>
          <div>
            <div className="l">Reserved</div>
            <div className="v">{itemsQuery.isPending ? '—' : formatNumber(kpis.reserved)}</div>
          </div>
        </div>
        <div className="stat">
          <div className="ic" style={{ background: 'var(--green)' }}>
            <span className="material-symbols-rounded">check_circle</span>
          </div>
          <div>
            <div className="l">Available</div>
            <div className="v">{itemsQuery.isPending ? '—' : formatNumber(kpis.available)}</div>
          </div>
        </div>
        <div className="stat">
          <div className="ic" style={{ background: 'var(--purple)' }}>
            <span className="material-symbols-rounded">payments</span>
          </div>
          <div>
            <div className="l">Stock Value</div>
            <div className="v">{itemsQuery.isPending ? '—' : formatCurrency(kpis.value)}</div>
          </div>
        </div>
        <div className="stat">
          <div className="ic" style={{ background: 'var(--red)' }}>
            <span className="material-symbols-rounded">shopping_cart</span>
          </div>
          <div>
            <div className="l">Needs Reorder</div>
            <div className="v">{itemsQuery.isPending ? '—' : formatNumber(replenishmentRows.length)}</div>
          </div>
        </div>
      </div>

      {tab === 'stock' && (
        <div className="panel">
          <div className="panel-h">
            <h2><span className="material-symbols-rounded">inventory_2</span> Items at this Store</h2>
            <span className="mut" style={{ fontSize: 12 }}>{items.length} items</span>
          </div>
          {itemsQuery.isPending ? (
            <div className="empty">
              <span className="material-symbols-rounded">hourglass_empty</span>
              Loading stock...
            </div>
          ) : items.length === 0 ? (
            <div className="empty">
              <span className="material-symbols-rounded">folder_open</span>
              No items on hand at this store.
            </div>
          ) : (
            <div className="twrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="num">S.No</th>
                    <th>Item</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th className="num">On Hand</th>
                    <th className="num">Available</th>
                    <th className="num">Value</th>
                    <th>Last Movement</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row, idx) => (
                    <tr key={row.id}>
                      <td className="num mut">{idx + 1}</td>
                      <td style={{ fontWeight: 700 }}>{row.itemCode}</td>
                      <td>{row.itemName}</td>
                      <td><ItemTypeChip type={row.itemType} /></td>
                      <td className="num">{formatNumber(row.onHand)}</td>
                      <td className="num">{formatNumber(row.available)}</td>
                      <td className="num">{formatCurrency(row.value)}</td>
                      <td>{row.lastMovementDate ? formatDate(row.lastMovementDate) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'movement' && (
        <div className="panel">
          <div className="panel-h">
            <h2><span className="material-symbols-rounded">swap_vert</span> Recent Movement</h2>
            <span className="mut" style={{ fontSize: 12 }}>Last 90 days</span>
          </div>
          {ledgerQuery.isPending ? (
            <div className="empty">
              <span className="material-symbols-rounded">hourglass_empty</span>
              Loading movement...
            </div>
          ) : ledgerRows.length === 0 ? (
            <div className="empty">
              <span className="material-symbols-rounded">folder_open</span>
              No movement at this store in the last 90 days.
            </div>
          ) : (
            <div className="twrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Doc No</th>
                    <th>Type</th>
                    <th>Item</th>
                    <th className="num">Qty In</th>
                    <th className="num">Qty Out</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDate(String(row.date ?? ''))}</td>
                      <td>{String(row.docNo ?? '—')}</td>
                      <td>{String(row.txType ?? '—')}</td>
                      <td>{String(row.itemCode ?? '—')}</td>
                      <td className="num">{formatNumber(Number(row.inQty) || 0)}</td>
                      <td className="num">{formatNumber(Number(row.outQty) || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'aging' && (
        <div className="panel">
          <div className="panel-h">
            <h2><span className="material-symbols-rounded">schedule</span> Stock Aging</h2>
          </div>
          <div className="twrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th className="num">Items</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {agingBuckets.map((bucket) => (
                  <tr key={bucket.label}>
                    <td>{bucket.label}</td>
                    <td className="num">{formatNumber(bucket.count)}</td>
                    <td className="num">{formatCurrency(bucket.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'replenishment' && (
        <div className="panel">
          <div className="panel-h">
            <h2><span className="material-symbols-rounded">shopping_cart</span> Needs Reorder</h2>
            <span className="mut" style={{ fontSize: 12 }}>{replenishmentRows.length} items</span>
          </div>
          {replenishmentRows.length === 0 ? (
            <div className="empty">
              <span className="material-symbols-rounded">check_circle</span>
              Everything at this store is above its reorder point.
            </div>
          ) : (
            <div className="twrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">On Hand</th>
                    <th className="num">Reorder Point</th>
                    <th className="num">Suggested Order</th>
                    <th>Status</th>
                    <th className="actions">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {replenishmentRows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ fontWeight: 700 }}>{row.itemCode}</td>
                      <td className="num">{formatNumber(row.onHand)}</td>
                      <td className="num">{formatNumber(row.reorderPoint)}</td>
                      <td className="num">{formatNumber(row.suggestedOrderQty)}</td>
                      <td>{row.reorderStatus}</td>
                      <td className="actions">
                        <button
                          className="ibtn"
                          title="Create Purchase Request"
                          onClick={() => handleCreateRequest(row.itemCode, row.itemName, row.suggestedOrderQty)}
                        >
                          <span className="material-symbols-rounded">add_shopping_cart</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
