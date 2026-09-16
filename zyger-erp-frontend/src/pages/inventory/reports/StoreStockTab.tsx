import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { masterService } from '../../../services/masterService';
import { useStoreStock } from '../../../hooks/useInventoryReports';
import { inventoryReportsService } from '../../../services/inventoryReportsService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useToast } from '../../../contexts/ToastContext';
import { formatCurrency, formatDate, formatNumber } from '../../../utils/format';
import type { ReportQueryParams, StoreStockRow } from '../../../types/inventory/reports.types';
import ItemTypeChip from './ItemTypeChip';
import ReportPager from './ReportPager';

const PAGE_SIZE = 14;

export default function StoreStockTab() {
  const { toast } = useToast();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [page, setPage] = useState(0);

  const storesQuery = useQuery({
    queryKey: ['master', 'stores'],
    queryFn: ({ signal }) => masterService.getStores(signal),
    staleTime: 1000 * 60 * 10,
  });

  const stores = storesQuery.data ?? [];

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [search, location]);

  const params = useMemo<ReportQueryParams>(
    () => ({ page, size: PAGE_SIZE, search, location }),
    [page, search, location]
  );

  const { data, isPending, isError, error, refetch } = useStoreStock(params);

  const rows = data?.content ?? [];

  const totalByStore = useMemo(() => {
    const map = new Map<string, { name: string; items: number; onHand: number; available: number; value: number }>();
    for (const row of rows) {
      const entry =
        map.get(row.storeCode) ??
        { name: row.storeName, items: 0, onHand: 0, available: 0, value: 0 };
      entry.items += 1;
      entry.onHand += row.onHand;
      entry.available += row.available;
      entry.value += row.value;
      map.set(row.storeCode, entry);
    }
    return map;
  }, [rows]);

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    try {
      await inventoryReportsService.exportFile('store-stock', 'Stock Detail', params, format);
      toast('Stock detail export downloaded.');
    } catch (exportError) {
      toast(getApiErrorMessage(exportError, 'Export failed.'), 'error');
    }
  };

  const groupRows = (all: StoreStockRow[]) => {
    const grouped = new Map<string, StoreStockRow[]>();
    for (const row of all) {
      const list = grouped.get(row.storeCode) ?? [];
      list.push(row);
      grouped.set(row.storeCode, list);
    }
    return [...grouped.entries()];
  };

  const groups = groupRows(rows);

  return (
    <>
      <div className="panel" style={{ marginBottom: 14 }}>
        <div
          className="toolbar"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <div className="searchwrap" style={{ minWidth: '200px', flex: '0 1 280px' }}>
            <span className="material-symbols-rounded">search</span>
            <input
              className="in"
              value={searchInput}
              placeholder="Search item / name / specification"
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)' }}>
              Store:
            </span>
            <select
              className="in"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              style={{ width: '200px' }}
            >
              <option value="">All Stores</option>
              {stores.map((store) => (
                <option key={store.code} value={store.code}>
                  {store.name || store.code}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="btn" onClick={() => handleExport('xlsx')}>
              <span className="material-symbols-rounded">download</span>
              Excel
            </button>
            <button className="btn" onClick={() => handleExport('pdf')}>
              <span className="material-symbols-rounded">picture_as_pdf</span>
              PDF
            </button>
          </div>
        </div>
      </div>

      {isPending ? (
        <div className="panel">
          <div className="empty">
            <span className="material-symbols-rounded">hourglass_empty</span>
            Loading store-wise stock...
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="empty">
            <span className="material-symbols-rounded">error</span>
            {getApiErrorMessage(error, 'Unable to load store-wise stock.')}
            <div style={{ marginTop: '14px' }}>
              <button className="btn" onClick={() => refetch()}>
                <span className="material-symbols-rounded">refresh</span>
                Retry
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 14,
              marginBottom: 14,
            }}
          >
            {[...totalByStore.entries()].map(([code, entry]) => (
              <div key={code} className="panel" style={{ padding: '14px 16px' }}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <div>
                    <div style={{ fontWeight: 800 }}>{entry.name || code}</div>
                    <div className="mut" style={{ fontSize: 12 }}>
                      {entry.items} items
                    </div>
                  </div>
                  <span
                    className="material-symbols-rounded"
                    style={{ color: 'var(--blue)', fontSize: 28 }}
                  >
                    warehouse
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>In Store</div>
                    <div style={{ fontWeight: 700 }}>{formatNumber(entry.onHand)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Available to Use</div>
                    <div style={{ fontWeight: 700, color: 'var(--green)' }}>
                      {formatNumber(entry.available)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Value</div>
                    <div style={{ fontWeight: 700 }}>{formatCurrency(entry.value)}</div>
                  </div>
                </div>
              </div>
            ))}
            {totalByStore.size === 0 && (
              <div className="panel">
                <div className="empty">
                  <span className="material-symbols-rounded">warehouse</span>
                  No stock found in the selected store.
                </div>
              </div>
            )}
          </div>

          {groups.map(([storeCode, storeRows]) => (
            <div className="panel" key={storeCode} style={{ marginBottom: 14 }}>
              <div className="panel-h">
                <h2>
                  <span className="material-symbols-rounded">warehouse</span>
                  {storeRows[0].storeName || storeCode}
                </h2>
                <span className="mut" style={{ fontSize: 12 }}>
                  {storeRows.length} items
                </span>
              </div>
              <div className="twrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="num">S.No</th>
                      <th>Item</th>
                      <th>Name / Specification</th>
                      <th>Type</th>
                      <th className="num">In Store</th>
                      <th className="num">Reserved</th>
                      <th className="num">QC Hold</th>
                      <th className="num">Available to Use</th>
                      <th className="num">Value</th>
                      <th className="num">Last In/Out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storeRows.map((row, idx) => (
                      <tr key={row.id}>
                        <td className="num mut">{idx + 1}</td>
                        <td style={{ fontWeight: 700 }}>{row.itemCode}</td>
                        <td>
                          <div>{row.itemName}</div>
                          <div className="mut" style={{ fontSize: 12 }}>
                            {row.specification && row.specification !== row.itemName
                              ? row.specification
                              : row.uom || '—'}
                          </div>
                        </td>
                        <td>
                          <ItemTypeChip type={row.itemType} />
                        </td>
                        <td className="num">{formatNumber(row.onHand)}</td>
                        <td className="num">
                          {row.reserved > 0 ? (
                            <span style={{ color: 'var(--yellow, #b58900)' }}>
                              {formatNumber(row.reserved)}
                            </span>
                          ) : (
                            0
                          )}
                        </td>
                        <td className="num">
                          {row.qcHold > 0 ? (
                            <span style={{ color: 'var(--purple)' }}>
                              {formatNumber(row.qcHold)}
                            </span>
                          ) : (
                            0
                          )}
                        </td>
                        <td
                          className="num"
                          style={{
                            fontWeight: 700,
                            color: row.available <= 0 ? 'var(--red)' : undefined,
                          }}
                        >
                          {formatNumber(row.available)}
                        </td>
                        <td className="num">{formatCurrency(row.value)}</td>
                        <td className="num">{formatDate(row.lastMovementDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div className="panel">
            <ReportPager
              page={page}
              pageSize={PAGE_SIZE}
              totalElements={data?.totalElements ?? 0}
              totalPages={data?.totalPages ?? 1}
              onChange={setPage}
            />
          </div>
        </>
      )}
    </>
  );
}