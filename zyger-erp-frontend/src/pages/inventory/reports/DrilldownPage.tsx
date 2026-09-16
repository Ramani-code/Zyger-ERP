import { useEffect, useMemo, useState } from 'react';
import { useTabs } from '../../../contexts/TabsContext';
import { useDrilldown } from '../../../hooks/useInventoryReports';
import {
  DRILLDOWN_CONFIGS,
  TX_TYPE_OPTIONS,
} from './reportsConfig';
import { docTypeScreenMap } from './docTypeScreenMap';
import { inventoryReportsService } from '../../../services/inventoryReportsService';
import type { ReportQueryParams } from '../../../types/inventory/reports.types';
import {
  formatCurrency,
  formatDate,
  formatNumber,
} from '../../../utils/format';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useToast } from '../../../contexts/ToastContext';
import StatusBadge from '../../../components/common/StatusBadge';
import { getScreenComponent } from '../../../config/screenRegistry';
import StoreValueBarChart from './charts/StoreValueBarChart';

const PAGE_SIZE = 10;

const STATUS_OPTIONS = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'POSTED',
  'REJECTED',
  'CANCELLED',
];

/** Direction icon for a stock-ledger transaction type, keyword-matched since
 * txType values are free-form business codes (RECEIPT, RM_ISSUE, DC_RETURN, …)
 * rather than a fixed enum. */
function txTypeIcon(txType: string): string {
  const t = txType.toUpperCase();
  if (t.includes('TRANSFER')) return '🔄';
  if (t.includes('RETURN')) return '↩';
  if (t.includes('ISSUE') || t.includes('DISPATCH') || t.includes('OUT')) return '⬆';
  if (t.includes('RECEIPT') || t.includes('INWARD') || t.includes('RELEASE')) return '⬇';
  return '•';
}

interface DrilldownPageProps {
  drilldownType: string;
  initialFilters?: { location?: string; fromDate?: string; toDate?: string };
}

export default function DrilldownPage({ drilldownType, initialFilters }: DrilldownPageProps) {
  const config = DRILLDOWN_CONFIGS[drilldownType];
  const { setActiveTab } = useTabs();
  const { toast } = useToast();
  const { openTab } = useTabs();

  const hasActions = drilldownType === 'pending-inward' || drilldownType === 'pending-approvals';

  const resolveScreenId = (row: Record<string, unknown>): string | undefined => {
    const docType = String(row.docType ?? '');
    return docTypeScreenMap.labelToScreen(docType);
  };

  const openDocument = (row: Record<string, unknown>, viewOnly: boolean) => {
    const screenId = resolveScreenId(row);
    const id = String(row.id ?? '');
    if (!screenId || !id) return;

    openTab({
      id: `${screenId}-${viewOnly ? 'view' : 'edit'}-${id}`,
      label: `${viewOnly ? 'View' : 'Edit'} ${String(row.docNo ?? id)}`,
      icon: 'pageview',
      component: getScreenComponent(screenId),
      props: {
        initialDocId: id,
        viewOnly,
        screenId,
      },
    });
  };

  /** FR-INV-STORE-3 — a store row drills into its dedicated Store Detail page. */
  const openStoreDetail = (row: Record<string, unknown>) => {
    const storeCode = String(row.storeCode ?? '');
    if (!storeCode) return;
    openTab({
      id: `store-detail-${storeCode}`,
      label: `Store — ${String(row.storeName ?? storeCode)}`,
      icon: 'warehouse',
      component: getScreenComponent('store-detail'),
      props: { initialFilters: { location: storeCode } },
    });
  };

  const handleDelete = async (row: Record<string, unknown>) => {
    const screenId = resolveScreenId(row);
    const id = String(row.id ?? '');
    const docType = String(row.docType ?? 'document');
    if (!screenId || !id) return;

    const confirmed = window.confirm(
      `Delete ${docType} ${row.docNo ?? id}?\nThis cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await inventoryReportsService.deleteDocument(screenId, id);
      toast('Document deleted.');
      refetch();
    } catch (deleteError) {
      toast(
        getApiErrorMessage(deleteError, 'Could not delete the document.'),
        'error'
      );
    }
  };

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState(initialFilters?.fromDate ?? '');
  const [toDate, setToDate] = useState(initialFilters?.toDate ?? '');
  const [itemCode, setItemCode] = useState('');
  const [location, setLocation] = useState(initialFilters?.location ?? '');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [txType, setTxType] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [includeZero, setIncludeZero] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [search, fromDate, toDate, itemCode, location, category, status, txType, lowStockOnly, includeZero]);

  const params = useMemo<ReportQueryParams>(
    () => ({
      page,
      size: PAGE_SIZE,
      search,
      fromDate,
      toDate,
      itemCode,
      location,
      category,
      status,
      txType,
      lowStockOnly,
      includeZero,
    }),
    [page, search, fromDate, toDate, itemCode, location, category, status, txType, lowStockOnly, includeZero]
  );

  const { data, isPending, isError, error, refetch } = useDrilldown(
    drilldownType,
    params
  );

  if (!config) {
    return (
      <div className="panel">
        <div className="empty">Unknown report type.</div>
      </div>
    );
  }

  const has = (filter: string) => config.filters.includes(filter as never);

  const rows = data?.content ?? [];
  const totalElements = data?.totalElements ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    try {
      await inventoryReportsService.exportFile(
        `drilldown/${drilldownType}`,
        config.title,
        params,
        format
      );

      toast('Export downloaded.');
    } catch (exportError) {
      toast(
        getApiErrorMessage(
          exportError,
          'Export failed. Backend export endpoint is not available.'
        ),
        'error'
      );
    }
  };

  const renderCell = (columnKey: string, row: Record<string, unknown>) => {
    const column = config.columns.find((c) => c.key === columnKey);

    if (!column) {
      return '—';
    }

    const value = row[column.key];

    if (column.badge) {
      return <StatusBadge status={String(value ?? '')} />;
    }

    if (column.key === 'txType') {
      return `${txTypeIcon(String(value ?? ''))} ${String(value ?? '') || '—'}`;
    }

    if (column.date) {
      return formatDate(String(value ?? ''));
    }

    if (column.key === 'location') {
      return String(row.storeName || row.location || '—');
    }

    if (column.key === 'value') {
      const val = typeof value === 'number' && !Number.isNaN(value)
        ? value
        : ((Number(row.onHand) || 0) * (Number(row.rate) || 0));
      return formatCurrency(val);
    }

    if (column.money) {
      return formatCurrency(value as number);
    }

    if (column.numeric) {
      return formatNumber(value as number);
    }

    return (value as string) || '—';
  };

  return (
    <>
      <div className="pg-head">
        <h1>{config.title}</h1>
        <p>{config.subtitle}</p>
      </div>

      <div className="panel">
        <div className="toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          <button className="btn" onClick={() => setActiveTab('reports')}>
            <span className="material-symbols-rounded">arrow_back</span>
            Back
          </button>

          {has('search') && (
            <div className="searchwrap" style={{ minWidth: '200px', flex: '0 1 240px' }}>
              <span className="material-symbols-rounded">search</span>
              <input
                className="in"
                value={searchInput}
                placeholder="Search report..."
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
          )}

          {has('dateRange') && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>From:</span>
                <input
                  type="date"
                  className="in"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  style={{ width: '135px' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>To:</span>
                <input
                  type="date"
                  className="in"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  style={{ width: '135px' }}
                />
              </div>
            </>
          )}

          {has('item') && (
            <input
              className="in"
              value={itemCode}
              placeholder="Item code"
              onChange={(event) => setItemCode(event.target.value)}
              style={{ width: '130px' }}
            />
          )}

          {has('location') && (
            <input
              className="in"
              value={location}
              placeholder="Location"
              onChange={(event) => setLocation(event.target.value)}
              style={{ width: '130px' }}
            />
          )}

          {has('category') && (
            <input
              className="in"
              value={category}
              placeholder="Category"
              onChange={(event) => setCategory(event.target.value)}
              style={{ width: '130px' }}
            />
          )}

          {has('status') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Status:</span>
              <select
                className="in"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                style={{ width: '135px' }}
              >
                <option value="">All Status</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          )}

          {has('txType') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Txn:</span>
              <select
                className="in"
                value={txType}
                onChange={(event) => setTxType(event.target.value)}
                style={{ width: '135px' }}
              >
                <option value="">All Txn Types</option>
                {TX_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          )}

          {has('lowStockOnly') && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={lowStockOnly}
                onChange={(event) => setLowStockOnly(event.target.checked)}
              />
              Low stock only
            </label>
          )}

          {has('includeZero') && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeZero}
                onChange={(event) => setIncludeZero(event.target.checked)}
              />
              Include not available
            </label>
          )}

          <span className="count" style={{ marginLeft: '4px' }}>
            {formatNumber(totalElements)} record
            {totalElements === 1 ? '' : 's'}
          </span>

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

        {isPending ? (
          <div className="empty">
            <span className="material-symbols-rounded">hourglass_empty</span>
            Loading {config.title}...
          </div>
        ) : isError ? (
          <div className="empty">
            <span className="material-symbols-rounded">error</span>
            {getApiErrorMessage(error, `Unable to load ${config.title}.`)}
            <div style={{ marginTop: '14px' }}>
              <button className="btn" onClick={() => refetch()}>
                <span className="material-symbols-rounded">refresh</span>
                Retry
              </button>
            </div>
          </div>
        ) : (
          <>
            {drilldownType === 'store-stock-summary' && rows.length > 1 && (
              <div style={{ padding: '12px 4px 4px' }}>
                <StoreValueBarChart
                  data={rows.map((r) => ({
                    storeCode: String(r.storeCode ?? ''),
                    storeName: String(r.storeName ?? r.storeCode ?? ''),
                    totalValue: Number(r.totalValue ?? 0),
                  }))}
                />
              </div>
            )}
            <div className="twrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="num">S.No</th>
                    {config.columns.map((column) => (
                      <th
                        key={column.key}
                        className={column.numeric || column.money ? 'num' : ''}
                      >
                        {column.label}
                      </th>
                    ))}
                    {hasActions && <th className="actions">Actions</th>}
                  </tr>
                </thead>

                <tbody>
                  {rows.length > 0 ? (
                    rows.map((row, idx) => (
                      <tr
                        key={row.id}
                        onClick={
                          drilldownType === 'store-stock-summary'
                            ? () => openStoreDetail(row)
                            : undefined
                        }
                        style={
                          drilldownType === 'store-stock-summary'
                            ? { cursor: 'pointer' }
                            : undefined
                        }
                      >
                        <td className="num mut">{page * PAGE_SIZE + idx + 1}</td>
                        {config.columns.map((column) => (
                          <td
                            key={column.key}
                            className={
                              column.numeric || column.money ? 'num' : ''
                            }
                          >
                            {renderCell(column.key, row)}
                          </td>
                        ))}
                        {hasActions && (
                          <td className="actions">
                            <button
                              className="ibtn"
                              title="View"
                              onClick={() => openDocument(row, true)}
                            >
                              <span className="material-symbols-rounded">visibility</span>
                            </button>
                            <button
                              className="ibtn"
                              title="Edit"
                              onClick={() => openDocument(row, false)}
                            >
                              <span className="material-symbols-rounded">edit</span>
                            </button>
                            <button
                              className="ibtn danger"
                              title="Delete"
                              onClick={() => handleDelete(row)}
                            >
                              <span className="material-symbols-rounded">delete</span>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={config.columns.length + 1 + (hasActions ? 1 : 0)}>
                        <div className="empty">
                          <span className="material-symbols-rounded">
                            folder_open
                          </span>
                          No records found.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="pager">
              <span>
                Showing {rows.length === 0 ? 0 : page * PAGE_SIZE + 1}–
                {Math.min((page + 1) * PAGE_SIZE, totalElements)} of{' '}
                {formatNumber(totalElements)}
              </span>

              <div className="pgs">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((previous) => Math.max(0, previous - 1))}
                >
                  ‹
                </button>

                {Array.from({ length: totalPages }, (_, index) => index).map(
                  (pageIndex) => (
                    <button
                      key={pageIndex}
                      className={pageIndex === page ? 'on' : ''}
                      onClick={() => setPage(pageIndex)}
                    >
                      {pageIndex + 1}
                    </button>
                  )
                )}

                <button
                  disabled={page >= totalPages - 1}
                  onClick={() =>
                    setPage((previous) => Math.min(totalPages - 1, previous + 1))
                  }
                >
                  ›
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}