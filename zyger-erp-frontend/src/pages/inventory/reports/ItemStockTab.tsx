import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { masterService } from '../../../services/masterService';
import { useCurrentStock } from '../../../hooks/useInventoryReports';
import { inventoryReportsService } from '../../../services/inventoryReportsService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useToast } from '../../../contexts/ToastContext';
import { formatDate, formatNumber } from '../../../utils/format';
import type { ReportQueryParams } from '../../../types/inventory/reports.types';
import ItemTypeChip from './ItemTypeChip';
import ReportPager from './ReportPager';

const PAGE_SIZE = 12;

const STATUS_OPTIONS = [
  { value: '', label: 'All States' },
  { value: 'OK', label: 'OK — Enough Stock' },
  { value: 'REORDER_SOON', label: 'Reorder Soon' },
  { value: 'PURCHASE_NOW', label: 'Purchase Now' },
  { value: 'OUT_OF_STOCK', label: 'Out of Stock' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'All Item Types' },
  { value: 'PURCHASABLE', label: 'Purchasable' },
  { value: 'CUSTOMER_SUPPLIED', label: 'Customer Supplied' },
  { value: 'MANUFACTURING', label: 'Manufacturing' },
];

export default function ItemStockTab() {
  const { toast } = useToast();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [itemType, setItemType] = useState('');
  const [status, setStatus] = useState('');
  const [location, setLocation] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
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
  }, [search, itemType, status, location, lowStockOnly]);

  const params = useMemo<ReportQueryParams>(
    () => ({
      page,
      size: PAGE_SIZE,
      search,
      itemType,
      status,
      location,
      lowStockOnly,
      // This tab lists every item's status including out-of-stock ones by
      // default (unlike the Current Stock dashboard, which hides zero-stock
      // items unless asked) — includeZero keeps that behavior now that both
      // screens share the same current-stock endpoint/computation.
      includeZero: true,
    }),
    [page, search, itemType, status, location, lowStockOnly]
  );

  const { data, isPending, isError, error, refetch } = useCurrentStock(params);

  const rows = data?.content ?? [];
  const totalElements = data?.totalElements ?? 0;

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    try {
      await inventoryReportsService.exportFile('current-stock', 'Item-wise Stock', params, format);
      toast('Item-wise stock export downloaded.');
    } catch (exportError) {
      toast(getApiErrorMessage(exportError, 'Export failed.'), 'error');
    }
  };

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
            <select
              className="in"
              value={itemType}
              onChange={(event) => setItemType(event.target.value)}
              style={{ width: '170px' }}
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <select
              className="in"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              style={{ width: '170px' }}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <select
              className="in"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              style={{ width: '170px' }}
            >
              <option value="">All Stores</option>
              {stores.map((store) => (
                <option key={store.code} value={store.code}>
                  {store.name || store.code}
                </option>
              ))}
            </select>
          </div>

          <label
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(event) => setLowStockOnly(event.target.checked)}
            />
            Low stock only
          </label>

          <span className="count">{formatNumber(totalElements)} items</span>

          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
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
            Loading item-wise stock...
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="empty">
            <span className="material-symbols-rounded">error</span>
            {getApiErrorMessage(error, 'Unable to load item-wise stock.')}
            <div style={{ marginTop: '14px' }}>
              <button className="btn" onClick={() => refetch()}>
                <span className="material-symbols-rounded">refresh</span>
                Retry
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="twrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="num">S.No</th>
                  <th>Item</th>
                  <th>Name / Specification</th>
                  <th>Type</th>
                  <th className="num">Total in Store</th>
                  <th className="num">Held / Reserved</th>
                  <th className="num">Available to Use</th>
                  <th>Per Store</th>
                  <th>Stock State</th>
                  <th className="num">Last In/Out</th>
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? (
                  rows.map((row, idx) => (
                    <tr key={row.id}>
                      <td className="num mut">{page * PAGE_SIZE + idx + 1}</td>
                      <td>
                        <div style={{ fontWeight: 700 }}>{row.itemCode}</div>
                      </td>
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
                      <td
                        className="num"
                        style={{
                          fontWeight: 700,
                          color: row.available <= 0 ? 'var(--red)' : undefined,
                        }}
                      >
                        {formatNumber(row.available)}
                      </td>
                      <td>
                        {row.perStore.length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {row.perStore.map((store) => (
                              <span
                                key={store.storeCode}
                                title={`${store.storeName || store.storeCode}: ${formatNumber(store.onHand)} in store, ${formatNumber(store.available)} available`}
                                style={{
                                  padding: '2px 8px',
                                  borderRadius: 6,
                                  fontSize: 12,
                                  background: 'var(--item-bg, #f1f3f5)',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                <strong>{store.storeCode}</strong> {formatNumber(store.available)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="mut">—</span>
                        )}
                      </td>
                      <td>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 9px',
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            color:
                              row.reorderStatus === 'OK'
                                ? 'var(--green)'
                                : row.reorderStatus === 'REORDER_SOON'
                                  ? 'var(--yellow)'
                                  : 'var(--red)',
                            background:
                              row.reorderStatus === 'OK'
                                ? 'var(--green-bg, #e7f6ec)'
                                : row.reorderStatus === 'REORDER_SOON'
                                  ? 'var(--yellow-bg, #fdf3dc)'
                                  : 'var(--red-bg, #fdecec)',
                          }}
                        >
                          {row.reorderStatus === 'OK'
                            ? 'OK — Enough'
                            : row.reorderStatus === 'REORDER_SOON'
                              ? 'Reorder Soon'
                              : row.reorderStatus === 'OUT_OF_STOCK'
                                ? 'Out of Stock'
                                : 'Purchase Now'}
                        </span>
                      </td>
                      <td className="num">
                        {formatDate(row.lastMovementDate)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10}>
                      <div className="empty">
                        <span className="material-symbols-rounded">folder_open</span>
                        No items match the filters.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <ReportPager
            page={page}
            pageSize={PAGE_SIZE}
            totalElements={totalElements}
            totalPages={data?.totalPages ?? 1}
            onChange={setPage}
          />
        </div>
      )}
    </>
  );
}