import { useEffect, useMemo, useState } from 'react';
import axiosClient from '../../../api/axiosClient';
import { useAuth } from '../../../contexts/AuthContext';
import { formatNumber } from '../../../utils/format';
import { useToast } from '../../../contexts/ToastContext';
import { useTabs } from '../../../contexts/TabsContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import { purchaseApi } from '../../../services/purchase-api';
import PurchaseOrderPage from '../order/PurchaseOrderPage';

interface QuotationLine {
  lineNo: number;
  itemCode?: string;
  itemName?: string;
  description?: string;
  orderQty?: number;
  requiredQty?: number;
  qty?: number;
  uom?: string;
  unitPrice?: number;
  rate?: number;
  discount?: number;
  tax?: number;
  netPrice?: number;
  netAmount?: number;
  deliveryLeadTime?: number;
}

interface QuotationDoc {
  id: number;
  docNo: string;
  date: string;
  enquiryNumber?: string;
  supplier: string;
  supplierCode?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  validUntil?: string;
  expectedDeliveryDate?: string;
  status?: string;
  freight?: number;
  insurance?: number;
  taxes?: number;
  otherCharges?: number;
  lines?: QuotationLine[];
}

interface MatrixItem {
  itemCode: string;
  itemName: string;
  uom: string;
  qty: number;
  lines: Record<number, QuotationLine>;
}

const STORAGE_KEY = 'qc.selectedIds';

function loadSelection(): number[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.map(Number).filter((n) => Number.isFinite(n));
    }
  } catch {
    /* ignore */
  }
  return [];
}

export default function QuotationComparisonPage() {
  const { toast } = useToast();
  const { openTab } = useTabs();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [creatingPO, setCreatingPO] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allQuotations, setAllQuotations] = useState<QuotationDoc[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>(loadSelection);
  const [pendingIds, setPendingIds] = useState<number[]>([]);
  const [selectedEnquiry, setSelectedEnquiry] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  // Quotation lines store the UOM master's code (e.g. "UOM-2026-0001"), not
  // its display name — this map resolves code -> name so the matrix shows
  // "Nos" instead of the raw code.
  const [uomNameByCode, setUomNameByCode] = useState<Record<string, string>>({});

  const fetchQuotations = async () => {
    setLoading(true);
    try {
      const res = await axiosClient.get('/v1/purchase/supplier-quotation?size=100');
      const content = res.data?.content || res.data || [];
      setAllQuotations(Array.isArray(content) ? content : []);
    } catch {
      setAllQuotations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotations();
    axiosClient.get('/master/uoms').then((res) => {
      const data = Array.isArray(res.data) ? res.data : [];
      const map: Record<string, string> = {};
      data.forEach((u: any) => {
        if (u.code) map[u.code] = u.name || u.code;
      });
      setUomNameByCode(map);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selectedIds));
    } catch {
      /* ignore */
    }
  }, [selectedIds]);

  const selectedQuotations = useMemo(
    () => allQuotations.filter((q) => selectedIds.includes(q.id)),
    [allQuotations, selectedIds]
  );

  const enquiryList = useMemo(
    () => Array.from(new Set(allQuotations.map((q) => q.enquiryNumber).filter(Boolean))) as string[],
    [allQuotations]
  );

  const filteredQuotations = selectedQuotations.filter((q) => {
    if (selectedEnquiry !== 'ALL' && q.enquiryNumber !== selectedEnquiry) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchSupplier = q.supplier?.toLowerCase().includes(term);
      const matchDoc = q.docNo?.toLowerCase().includes(term);
      const matchItem = (q.lines ?? []).some(
        (l) => (l.itemCode ?? '').toLowerCase().includes(term) || (l.itemName ?? '').toLowerCase().includes(term)
      );
      if (!matchSupplier && !matchDoc && !matchItem) return false;
    }
    return true;
  });

  // Only quotes that actually have line items participate in the cost comparison.
  const comparables = filteredQuotations.filter((q) => (q.lines ?? []).length > 0);

  const lineRate = (l?: QuotationLine) => Number(l?.unitPrice ?? l?.rate ?? 0);
  const lineQty = (l?: QuotationLine) => Number(l?.requiredQty ?? l?.orderQty ?? l?.qty ?? 1);
  const lineUom = (l?: QuotationLine) => {
    const raw = l?.uom || 'PCS';
    return uomNameByCode[raw] || raw;
  };
  const lineLead = (l?: QuotationLine) => Number(l?.deliveryLeadTime ?? 7);

  // Supplier quotation line semantics: discount & tax are % values, netPrice is the line total.
  const lineDiscountPct = (l?: QuotationLine) => Number(l?.discount ?? 0);
  const lineTaxPct = (l?: QuotationLine) => Number(l?.tax ?? 0);
  const lineNet = (l?: QuotationLine): number => {
    if (!l) return 0;
    const qty = lineQty(l);
    const rate = lineRate(l);
    const discPct = lineDiscountPct(l);
    const taxPct = lineTaxPct(l);
    const gross = qty * rate;
    const discAmt = (gross * discPct) / 100;
    const taxable = gross - discAmt;
    const taxAmt = (taxable * taxPct) / 100;
    const computedNet = taxable + taxAmt;
    if (computedNet > 0 || (qty > 0 && rate > 0)) {
      return computedNet;
    }
    if (typeof l.netPrice === 'number' && l.netPrice > 0) {
      return Number(l.netPrice);
    }
    if (typeof l.netAmount === 'number' && l.netAmount > 0) {
      return Number(l.netAmount);
    }
    return 0;
  };

  const headerCharges = (q: QuotationDoc): number =>
    Number(q.freight ?? 0) + Number(q.insurance ?? 0) + Number(q.taxes ?? 0) + Number(q.otherCharges ?? 0);

  const getQuotationLineTotal = (q: QuotationDoc): number => {
    const lines = q.lines ?? [];
    return lines.reduce((sum, l) => sum + lineNet(l), 0);
  };

  const getQuotationTotal = (q: QuotationDoc): number => getQuotationLineTotal(q) + headerCharges(q);

  const sortedByCost = [...comparables].sort((a, b) => {
    const totA = getQuotationTotal(a);
    const totB = getQuotationTotal(b);
    if (totA > 0 && totB > 0) return totA - totB;
    if (totA > 0) return -1;
    if (totB > 0) return 1;
    return 0;
  });

  // Fastest delivery: earliest Expected Delivery Date among quotes that have
  // one set. Only meaningful once at least one quote in the comparison has
  // actually entered a date, so it stays unset (no badge shown) otherwise.
  const quotesWithDeliveryDate = comparables.filter((q) => !!q.expectedDeliveryDate);
  const sortedByDelivery = [...quotesWithDeliveryDate].sort(
    (a, b) => new Date(a.expectedDeliveryDate!).getTime() - new Date(b.expectedDeliveryDate!).getTime()
  );
  const fastestDeliveryId = sortedByDelivery[0]?.id;

  const matrixItems = useMemo<MatrixItem[]>(() => {
    const map = new Map<string, MatrixItem>();
    comparables.forEach((q) => {
      (q.lines ?? []).forEach((l) => {
        const code = l.itemCode || `ITEM-${l.lineNo}`;
        const name = l.itemName || l.description || l.itemCode || code;
        if (!map.has(code)) {
          map.set(code, { itemCode: code, itemName: name, uom: lineUom(l), qty: lineQty(l), lines: {} });
        }
        const item = map.get(code)!;
        item.lines[q.id] = l;
      });
    });
    return Array.from(map.values());
  }, [comparables, uomNameByCode]);

  const getRankBadge = (idx: number) => {
    const style: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '3px 10px',
      borderRadius: 99,
      fontSize: 11,
      fontWeight: 800,
      letterSpacing: '.03em',
    };
    if (idx === 0) {
      return (
        <span style={{ ...style, background: '#22c55e', color: '#ffffff', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
          <span className="material-symbols-rounded" style={{ fontSize: 14 }}>workspace_premium</span>
          L1 · LOWEST BIDDER
        </span>
      );
    }
    if (idx === 1) {
      return <span style={{ ...style, background: '#e8f3ff', color: '#0b6cc4' }}>L2 Bidder</span>;
    }
    if (idx === 2) {
      return <span style={{ ...style, background: '#fff6e0', color: '#b7791f' }}>L3 Bidder</span>;
    }
    return <span style={{ ...style, background: 'var(--body)', color: 'var(--muted)' }}>L{idx + 1}</span>;
  };

  const openPicker = () => {
    setPendingIds([]);
    setPickerOpen(true);
  };

  const availableForPicker = allQuotations.filter((q) => !selectedIds.includes(q.id));
  const confirmedPending = pendingIds.filter((id) => availableForPicker.some((q) => q.id === id));

  const addConfirmed = () => {
    if (confirmedPending.length === 0) return;
    const existing = (q: QuotationDoc) => selectedIds.includes(q.id);
    const toAdd = allQuotations.filter((q) => confirmedPending.includes(q.id));
    const withLines = toAdd.filter((q) => (q.lines ?? []).length > 0);
    if (withLines.length < toAdd.length) {
      toast('Some selected quotations have no line items and were skipped.', 'error');
    }
    if (withLines.length === 0) {
      setPickerOpen(false);
      return;
    }
    setSelectedIds((prev) => {
      const next = [...prev];
      withLines.forEach((q) => {
        if (!existing(q)) next.push(q.id);
      });
      return next;
    });
    setPickerOpen(false);
    toast(`${withLines.length} quotation(s) added to comparison.`, 'success');
  };

  const removeQuotation = (id: number) => {
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    setSelectedEnquiry('ALL');
    setSearchTerm('');
  };

  const clearAll = () => {
    setSelectedIds([]);
    setSelectedEnquiry('ALL');
    setSearchTerm('');
  };

  const handleCreatePO = async (quot: QuotationDoc) => {
    if (creatingPO) return;
    if (!quot.lines || quot.lines.length === 0) {
      toast('Selected quotation has no line items to create a Purchase Order.', 'error');
      return;
    }
    setCreatingPO(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const lines = quot.lines.map((l, idx) => {
        const qty = lineQty(l);
        const rate = lineRate(l);
        const discPct = lineDiscountPct(l);
        const taxPct = lineTaxPct(l);
        const gross = qty * rate;
        const discAmt = (gross * discPct) / 100;
        const taxable = gross - discAmt;
        const taxAmt = (taxable * taxPct) / 100;
        const computedNet = taxable + taxAmt;

        return {
          lineNo: idx + 1,
          itemCode: l.itemCode,
          itemName: l.itemName || l.description || l.itemCode,
          description: l.itemName || l.description || l.itemCode,
          orderQty: qty,
          requiredQty: qty,
          qty: qty,
          uom: l.uom || 'PCS',
          unitPrice: rate,
          rate: rate,
          discount: discPct,
          discountAmount: discAmt,
          tax: taxPct,
          taxAmount: taxAmt,
          netAmount: computedNet,
          netPrice: computedNet,
          requiredDate: today,
          lineStatus: 'Open',
        };
      });

      const payload: Record<string, unknown> = {
        supplier: quot.supplier,
        supplierCode: quot.supplierCode,
        contactPerson: quot.contactPerson,
        phone: quot.phone,
        email: quot.email,
        buyer: user?.username || '',
        paymentTerms: quot.paymentTerms || '30 Days',
        deliveryTerms: quot.deliveryTerms || 'EXW - Ex Works',
        currency: 'INR',
        supplierOverride: true,
        quotationNumber: quot.docNo,
        remark: `Created from L1 quotation ${quot.docNo}`,
        notes: `PO auto-generated by comparing quotations; source quote ${quot.docNo} (${quot.supplier}).`,
        date: today,
        lines,
      };

      const created = await purchaseApi.createDoc('purchase-order', payload);
      const docNo = String(created?.docNo || 'Purchase Order');
      toast(`Purchase Order ${docNo} created from ${quot.supplier}.`, 'success');
      openTab({
        id: `po-${created?.id || Date.now()}`,
        label: docNo,
        icon: 'shopping_cart_checkout',
        component: PurchaseOrderPage,
        props: { initialDocId: created?.id },
      });
    } catch (err: any) {
      toast(getApiErrorMessage(err, 'Failed to create Purchase Order from quotation'), 'error');
    } finally {
      setCreatingPO(false);
    }
  };

  const l1Total = sortedByCost[0] ? getQuotationTotal(sortedByCost[0]) : 0;
  const maxTotal = sortedByCost.length ? getQuotationTotal(sortedByCost[sortedByCost.length - 1]) : 0;
  const potentialSavings = maxTotal > l1Total ? maxTotal - l1Total : 0;
  const rankOf = (qId: number) => sortedByCost.findIndex((q) => q.id === qId);

  const hasSelection = selectedIds.length > 0;

  return (
    <div className="view-container">
      <div className="pg-head pg-head-flex">
        <div className="pg-head-text">
          <h1>Quotation Comparison Matrix</h1>
          <p>Add supplier quotations to compare side-by-side, evaluate landed cost and select the L1 bidder</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {hasSelection && (
            <button className="btn btn-sm" onClick={clearAll} title="Clear all selected quotations">
              <span className="material-symbols-rounded">close</span> Clear All
            </button>
          )}
          <button className="btn btn-p" onClick={openPicker}>
            <span className="material-symbols-rounded">playlist_add</span> Add Compare Quotation
          </button>
        </div>
      </div>

      {/* Summary KPI cards */}
      <div className="stats" style={{ marginBottom: 20 }}>
        <div className="stat">
          <div className="ic" style={{ background: '#1d4ed8' }}>
            <span className="material-symbols-rounded">requests_caption</span>
          </div>
          <div>
            <div className="l">Quotes Compared</div>
            <div className="v">{filteredQuotations.length}</div>
            <div className="s">of {allQuotations.length} available</div>
          </div>
        </div>
        <div className="stat">
          <div className="ic" style={{ background: '#1f9d58' }}>
            <span className="material-symbols-rounded">workspace_premium</span>
          </div>
          <div>
            <div className="l">L1 Best Bidder</div>
            <div className="v" style={{ fontSize: 18, whiteSpace: 'nowrap' }}>{sortedByCost[0]?.supplier || 'N/A'}</div>
            <div className="s">Landed total ₹{formatNumber(l1Total)}</div>
          </div>
        </div>
        <div className="stat">
          <div className="ic" style={{ background: '#007bd6' }}>
            <span className="material-symbols-rounded">savings</span>
          </div>
          <div>
            <div className="l">Potential L1 Savings</div>
            <div className="v">₹{formatNumber(potentialSavings)}</div>
            <div className="s">vs highest comparable quote</div>
          </div>
        </div>
        <div className="stat">
          <div className="ic" style={{ background: '#b7791f' }}>
            <span className="material-symbols-rounded">local_shipping</span>
          </div>
          <div>
            <div className="l">Fastest Lead Time</div>
            <div className="v">
              {comparables.length
                ? Math.min(...comparables.flatMap((q) => (q.lines ?? []).map((l) => lineLead(l))))
                : '—'}{' '}
              <span style={{ fontSize: 12, fontWeight: 600 }}>days</span>
            </div>
            <div className="s">across all quoted line items</div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="panel">
          <div className="empty">
            <span className="material-symbols-rounded">hourglass_empty</span> Loading quotations...
          </div>
        </div>
      ) : !hasSelection ? (
        <div className="panel">
          <div className="empty" style={{ padding: 60 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 56 }}>compare_arrows</span>
            <div style={{ fontWeight: 700, color: 'var(--text)', marginTop: 10, fontSize: 15 }}>
              No Quotations Selected for Comparison
            </div>
            <p style={{ marginTop: 8, maxWidth: 460, marginInline: 'auto' }}>
              Click <b>Add Compare Quotation</b> above, then tick the supplier quotations you recorded in the
              Supplier Quotation module to bring them into the comparison matrix.
            </p>
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-p" onClick={openPicker}>
                <span className="material-symbols-rounded">playlist_add</span> Add Compare Quotation
              </button>
            </div>
          </div>
        </div>
      ) : filteredQuotations.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <span className="material-symbols-rounded">filter_alt_off</span>
            <div style={{ fontWeight: 700, color: 'var(--text)', marginTop: 6 }}>
              No quotations match the current filter
            </div>
            <p style={{ marginTop: 6 }}>Adjust the search text or enquiry filter.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Toolbar / filters */}
          <div className="panel">
            <div className="toolbar">
              <div className="searchwrap">
                <span className="material-symbols-rounded">search</span>
                <input
                  className="in"
                  type="text"
                  placeholder="Search supplier, doc, item..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <select className="in" value={selectedEnquiry} onChange={(e) => setSelectedEnquiry(e.target.value)}>
                <option value="ALL">All Enquiries</option>
                {enquiryList.map((enq) => (
                  <option key={enq} value={enq}>{enq}</option>
                ))}
              </select>
              <span className="sp" />
              <span className="count">{comparables.length} comparable · {filteredQuotations.length} showing</span>
              <button className="btn btn-sm" onClick={fetchQuotations} title="Refresh Data">
                <span className="material-symbols-rounded">refresh</span> Refresh
              </button>
              <button className="btn btn-sm btn-p" onClick={openPicker}>
                <span className="material-symbols-rounded">add</span> Add
              </button>
            </div>
          </div>

          {/* Comparative matrix table */}
          <div className="panel">
            <div className="twrap">
              <table className="tbl qc-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 240 }}>Commercial / Technical Parameter</th>
                    {filteredQuotations.map((q) => {
                      const rank = rankOf(q.id);
                      const isL1 = sortedByCost[0]?.id === q.id;
                      const isFastest = fastestDeliveryId !== undefined && q.id === fastestDeliveryId;
                      const headClasses = [isL1 ? 'l1-col-head' : '', isFastest ? 'fast-col-head' : ''].filter(Boolean).join(' ') || undefined;
                      return (
                        <th key={q.id} className={headClasses} style={{ textAlign: 'center', minWidth: 220 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }}>
                            {getRankBadge(rank)}
                            {isFastest && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 800, letterSpacing: '.03em', background: '#2563eb', color: '#ffffff', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
                                <span className="material-symbols-rounded" style={{ fontSize: 14 }}>bolt</span>
                                FASTEST DELIVERY
                              </span>
                            )}
                          </div>
                          <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, marginTop: 8, textTransform: 'none', letterSpacing: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <span>{q.supplier}</span>
                            <button
                              className="ibtn"
                              style={{ color: '#fca5a5', width: 22, height: 22, background: 'rgba(255,255,255,.06)' }}
                              title={`Remove ${q.supplier}`}
                              onClick={() => removeQuotation(q.id)}
                            >
                              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>close</span>
                            </button>
                          </div>
                          <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                            {q.docNo}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ fontWeight: 600, color: 'var(--text)' }}>Supplier Code</td>
                    {filteredQuotations.map((q) => {
                      const isL1 = sortedByCost[0]?.id === q.id;
                      return (
                        <td key={q.id} className={isL1 ? 'l1-col-cell' : undefined} style={{ textAlign: 'center', fontFamily: 'monospace' }}>{q.supplierCode || '—'}</td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td>Quote Date &amp; Validity</td>
                    {filteredQuotations.map((q) => {
                      const isL1 = sortedByCost[0]?.id === q.id;
                      return (
                        <td key={q.id} className={isL1 ? 'l1-col-cell' : undefined} style={{ textAlign: 'center' }}>
                          <div>{q.date || '—'}</div>
                          <div className="mut">Valid till {q.validUntil || '—'}</div>
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td>Expected Delivery Date</td>
                    {filteredQuotations.map((q) => {
                      const isL1 = sortedByCost[0]?.id === q.id;
                      const isFastest = fastestDeliveryId !== undefined && q.id === fastestDeliveryId;
                      const cellClasses = [isL1 ? 'l1-col-cell' : '', isFastest ? 'fast-col-cell' : ''].filter(Boolean).join(' ') || undefined;
                      return (
                        <td key={q.id} className={cellClasses} style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: isFastest ? 700 : 400, color: isFastest ? '#2563eb' : undefined }}>
                            {q.expectedDeliveryDate || '—'}
                          </div>
                          {isFastest && (
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', background: '#dbeafe', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: 4, display: 'inline-block', marginTop: 3 }}>
                              Fastest Delivery
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td>Enquiry Reference</td>
                    {filteredQuotations.map((q) => {
                      const isL1 = sortedByCost[0]?.id === q.id;
                      return (
                        <td key={q.id} className={isL1 ? 'l1-col-cell' : undefined} style={{ textAlign: 'center' }}>{q.enquiryNumber || '—'}</td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td>Payment Terms</td>
                    {filteredQuotations.map((q) => {
                      const isL1 = sortedByCost[0]?.id === q.id;
                      return (
                        <td key={q.id} className={isL1 ? 'l1-col-cell' : undefined} style={{ textAlign: 'center', fontWeight: 600 }}>{q.paymentTerms || '—'}</td>
                      );
                    })}
                  </tr>

                  {matrixItems.length === 0 ? (
                    <tr>
                      <td colSpan={filteredQuotations.length + 1} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>
                        No comparable line items across the selected quotations.
                      </td>
                    </tr>
                  ) : (
                    matrixItems.map((item) => {
                      const validLines = filteredQuotations
                        .map((q) => ({ qId: q.id, line: item.lines[q.id] }))
                        .filter((x) => x.line);
                      const minNet = validLines.length > 0 ? Math.min(...validLines.map((x) => lineNet(x.line))) : 0;

                      return (
                        <tr key={item.itemCode}>
                          <td style={{ fontWeight: 600, color: 'var(--text)' }}>
                            {item.itemCode} — {item.itemName}
                            <div className="mut">Req Qty: {item.qty} {item.uom}</div>
                          </td>
                          {filteredQuotations.map((q) => {
                            const l = item.lines[q.id];
                            const isL1 = sortedByCost[0]?.id === q.id;
                            if (!l) {
                              return (
                                <td key={q.id} className={isL1 ? 'l1-col-cell' : undefined} style={{ textAlign: 'center', color: 'var(--muted)' }}>—</td>
                              );
                            }
                            const isLowestLine = validLines.length > 1 && lineNet(l) === minNet && minNet > 0;
                            return (
                              <td key={q.id} className={isL1 ? 'l1-col-cell' : undefined} style={{ textAlign: 'center' }}>
                                <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                                  ₹{formatNumber(lineRate(l))} / {lineUom(l)}
                                </div>
                                {lineDiscountPct(l) > 0 && (
                                  <div style={{ fontSize: 11, color: '#1f9d58', fontWeight: 600 }}>
                                    Disc {lineDiscountPct(l)}%
                                  </div>
                                )}
                                {lineTaxPct(l) > 0 && (
                                  <div style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>
                                    Tax {lineTaxPct(l)}%
                                  </div>
                                )}
                                <div className="mut" style={{ marginTop: 2 }}>Net ₹{formatNumber(lineNet(l))}</div>
                                {isLowestLine && (
                                  <div style={{ fontSize: 10, fontWeight: 700, color: '#15803d', background: '#dcfce7', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: 4, display: 'inline-block', marginTop: 3 }}>
                                    Lowest Item Rate
                                  </div>
                                )}
                                <div style={{ fontSize: 11, color: '#b7791f', fontWeight: 600, marginTop: 4 }}>
                                  <span className="material-symbols-rounded" style={{ fontSize: 12, verticalAlign: 'middle' }}>local_shipping</span>{' '}
                                  Lead {lineLead(l)} days
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}

                  {/* Total row */}
                  <tr style={{ background: 'var(--dark-nav)', color: '#fff' }}>
                    <td style={{ fontWeight: 800, color: '#fff' }}>TOTAL LANDED COST (INC. TAX &amp; CHARGES)</td>
                    {filteredQuotations.map((q) => {
                      const total = getQuotationTotal(q);
                      const isL1 = sortedByCost[0]?.id === q.id;
                      const hc = headerCharges(q);
                      return (
                        <td key={q.id} className={isL1 ? 'l1-col-total' : undefined} style={{ textAlign: 'center', fontWeight: 800, color: isL1 ? '#86efac' : '#fff' }}>
                          ₹{formatNumber(total)}
                          {hc > 0 && (
                            <div style={{ fontSize: 10, fontWeight: 500, color: isL1 ? '#bbf7d0' : '#a5b4fc', letterSpacing: 0, textTransform: 'none' }}>
                              + charges ₹{formatNumber(hc)}
                            </div>
                          )}
                          {isL1 && total > 0 && (
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#86efac', letterSpacing: 0, textTransform: 'none', marginTop: 2 }}>
                              ★ Lowest Commercial Price (L1)
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  <tr>
                    <td style={{ fontWeight: 700, color: 'var(--text)' }}>Award Contract Action</td>
                    {filteredQuotations.map((q) => {
                      const hasLines = (q.lines ?? []).length > 0;
                      const isL1 = sortedByCost[0]?.id === q.id;
                      return (
                        <td key={q.id} className={isL1 ? 'l1-col-cell' : undefined} style={{ textAlign: 'center' }}>
                          {hasLines ? (
                            <button
                              className="btn btn-sm"
                              style={isL1 ? { background: '#16a34a', borderColor: '#16a34a', color: '#fff', fontWeight: 700, boxShadow: '0 2px 6px rgba(22, 163, 74, 0.4)' } : undefined}
                              onClick={() => handleCreatePO(q)}
                              disabled={creatingPO}
                            >
                              {creatingPO ? (
                                <>
                                  <span className="material-symbols-rounded">sync</span> Creating...
                                </>
                              ) : (
                                <>
                                  <span className="material-symbols-rounded">shopping_cart_checkout</span>
                                  Issue PO to {q.supplier.split(' ')[0] || q.supplier}
                                </>
                              )}
                            </button>
                          ) : (
                            <span className="mut">No line items</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Header charges footnote */}
          {filteredQuotations.some((q) => headerCharges(q) > 0) && (
            <div className="note">
              <span className="material-symbols-rounded">info</span>
              <span>
                Landed totals include header-level charges (freight, insurance, taxes, other charges) on top of item
                net prices.
              </span>
            </div>
          )}
        </>
      )}

      {/* Selector modal */}
      {pickerOpen && (
        <div className="mwrap" onClick={(e) => { if (e.target === e.currentTarget) setPickerOpen(false); }}>
          <div className="modal" style={{ maxWidth: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Add Compare Quotation</h3>
              <button className="ibtn" onClick={() => setPickerOpen(false)}>
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: '.8rem', marginBottom: 10 }}>
              Select supplier quotations (from the Supplier Quotation module) to bring into the comparison. Only
              quotations with line items can be compared.
            </p>
            {availableForPicker.length === 0 ? (
              <div className="empty" style={{ padding: 30 }}>
                <span className="material-symbols-rounded">done_all</span>
                <div style={{ marginTop: 8 }}>All supplier quotations are already in the comparison.</div>
              </div>
            ) : (
              <div style={{ overflowY: 'auto', maxHeight: '46vh', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table className="tbl" style={{ minWidth: 560 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40, textAlign: 'center' }}>✓</th>
                      <th>Quote No</th>
                      <th>Supplier</th>
                      <th>Enquiry</th>
                      <th>Lines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableForPicker.map((q) => {
                      const lineCount = (q.lines ?? []).length;
                      const enabled = lineCount > 0;
                      const checked = confirmedPending.includes(q.id);
                      return (
                        <tr key={q.id} style={enabled ? undefined : { opacity: 0.5 }}>
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              disabled={!enabled}
                              checked={checked}
                              onChange={(e) =>
                                setPendingIds((prev) =>
                                  e.target.checked ? [...prev, q.id] : prev.filter((x) => x !== q.id)
                                )
                              }
                              style={{ accentColor: '#2563eb' }}
                            />
                          </td>
                          <td style={{ fontWeight: 600 }}>{q.docNo}</td>
                          <td>{q.supplier}</td>
                          <td className="mut">{q.enquiryNumber || '—'}</td>
                          <td className="mut">{enabled ? lineCount : 'No lines'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="acts" style={{ marginTop: 14 }}>
              <span className="count" style={{ marginRight: 'auto' }}>
                {confirmedPending.length} selected
              </span>
              <button className="btn" onClick={() => setPickerOpen(false)}>Cancel</button>
              <button className="btn btn-p" disabled={confirmedPending.length === 0} onClick={addConfirmed}>
                <span className="material-symbols-rounded">add</span> Add Selected ({confirmedPending.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
