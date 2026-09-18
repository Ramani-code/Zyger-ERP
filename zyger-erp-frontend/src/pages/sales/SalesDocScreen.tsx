import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  useSalesDoc,
  useSalesDocAction,
  useSalesDocCreate,
  useSalesDocDelete,
  useSalesDocList,
  useSalesDocNextNumber,
  useSalesDocUpdate,
} from '../../hooks/useSalesDocs';
import type { SalesDocScreenConfig } from './salesDocConfigs';
import { formatMoney, formatNumber, todayISO } from '../../utils/format';
import { getApiErrorMessage } from '../../utils/apiError';
import { useToast } from '../../contexts/ToastContext';
import StatusBadge from '../../components/common/StatusBadge';
import ConfirmActionModal from '../../components/common/ConfirmActionModal';
import AuditHistoryDrawer from '../../components/common/AuditHistoryDrawer';
import SearchableItemLookup from '../../components/common/SearchableItemLookup';
import { auditEntityTypeFor } from '../../utils/auditEntity';
import axiosClient from '../../api/axiosClient';
import { salesApi } from '../../services/sales-api';
import { lookupDocumentByNumber } from '../../utils/documentLookup';
import { logSystemActivity } from '../../utils/activityLog';
import { exportToCsv } from '../../utils/csvExport';
import { filterPurchaseRelevantItems } from '../../utils/itemClassification';

const PAGE_SIZE = 10;

// Doc types with no submit/approve workflow — Save is the only action.
const NO_WORKFLOW_DOC_TYPES = new Set(['sales-order', 'proforma-invoice']);

// Doc types whose line-level Tax % is a plain number field rather than a
// "GST 18%"-style text/select code.
const NUMERIC_TAX_DOC_TYPES = new Set(['sales-order', 'proforma-invoice']);

// Doc types that skip Submit/Approve and post their stock movement on the same
// action as Save — "Save as Draft" / "Save & Post Stock" instead of a separate
// workflow. Matches DocumentFacade's DIRECT_POST_DC_KEYS / DIRECT_POST_RETURN_KEYS
// on the backend — dc-return/invoice-return are entered against stock that was
// already issued via an already-approved DC/Invoice, so re-approving the return
// itself is pure friction, not a control.
const DIRECT_POST_ON_SAVE_DOC_TYPES = new Set(['sales-dc', 'dc-return', 'invoice-return']);

// Reads a tax percentage out of whatever the user typed into the Tax Code / Tax %
// cell — "18", "18%", "GST 18%", "Exempt" all resolve to the right rate. Falling
// back to a fixed 18% for anything that didn't match one of a few hardcoded presets
// (the old behaviour) silently mis-taxed every manually entered rate that wasn't in
// that preset list.
function parseTaxPct(taxCode: unknown): number {
  const tc = String(taxCode ?? '').trim();
  if (!tc || /exempt/i.test(tc)) return 0;
  const match = tc.match(/[\d.]+/);
  return match ? Number(match[0]) : 0;
}

interface SalesDocScreenProps {
  config: SalesDocScreenConfig;
  initialDocId?: string | number;
  viewOnly?: boolean;
  defaultType?: string;
  /** Pre-applies a status filter on the list view — used for dashboard KPI
   * card click-through (e.g. "Pending Approval" opens straight to that filter). */
  initialStatus?: string;
}

type ActionModal = { action: 'submit' | 'approve' | 'reject' | 'reopen' | 'cancel' | 'post'; danger: boolean };

export default function SalesDocScreen({ config, initialDocId, viewOnly = false, defaultType, initialStatus }: SalesDocScreenProps) {
  const { toast } = useToast();
  const { user, can } = useAuth();
  const { docType } = config;

  const [mode, setMode] = useState<'list' | 'form'>(initialDocId ? 'form' : 'list');
  const [documentId, setDocumentId] = useState<string | null>(initialDocId ? String(initialDocId) : null);
  const [isViewOnly, setIsViewOnly] = useState(viewOnly);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(initialStatus ?? '');
  const [page, setPage] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [lines, setLines] = useState<Array<Record<string, unknown>>>([]);
  const [initializedForId, setInitializedForId] = useState('');
  const [actionModal, setActionModal] = useState<ActionModal | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  // Master dropdown data
  const [customerMasters, setCustomerMasters] = useState<Array<{ id: number; name: string; code: string; billingAddress?: string; shippingAddress?: string; address?: string; city?: string; state?: string; pincode?: string; gstNumber?: string; gstin?: string; addressesJson?: string; deliveryAddressesJson?: string }>>([]);
  const [itemMasters, setItemMasters] = useState<Array<{ id: number; name: string; code: string; uom?: string; price?: number; description?: string; taxCode?: string; active?: boolean }>>([]);
  const [uomMasters, setUomMasters] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [storeMasters, setStoreMasters] = useState<Array<{ code: string; name: string }>>([]);

  // Active Sales Orders for Proforma, DC, Invoice auto-population
  const [salesOrderList, setSalesOrderList] = useState<Array<Record<string, unknown>>>([]);

  // Active Proforma Invoices for PI Reference/PI Number auto-population
  const [proformaInvoiceList, setProformaInvoiceList] = useState<Array<Record<string, unknown>>>([]);

  // Active Sales DCs for DC Return
  const [salesDcList, setSalesDcList] = useState<Array<Record<string, any>>>([]);

  // Active Sales Invoices for Invoice Return
  const [salesInvoiceList, setSalesInvoiceList] = useState<Array<Record<string, any>>>([]);

  useEffect(() => {
    // Load customer masters
    axiosClient.get('/master/parties?kind=CUSTOMER&size=100').then((res) => {
      const data = res.data?.content || res.data || [];
      if (Array.isArray(data) && data.length > 0) {
        setCustomerMasters(data);
      } else {
        setCustomerMasters([
          { id: 1, name: 'ABC Engineering Ltd', code: 'CUST-001' },
          { id: 2, name: 'Precision Auto Tech', code: 'CUST-002' },
          { id: 3, name: 'Global Energy Systems', code: 'CUST-003' },
        ]);
      }
    }).catch(() => {
      setCustomerMasters([
        { id: 1, name: 'ABC Engineering Ltd', code: 'CUST-001' },
        { id: 2, name: 'Precision Auto Tech', code: 'CUST-002' },
        { id: 3, name: 'Global Energy Systems', code: 'CUST-003' },
      ]);
    });

    // Load master items (inventory items for sale) — restrict to the item
    // types maintained under Master > Inventory > Items (Purchasable,
    // Customer Supplied, Manufacturing) so the line-item lookup only offers
    // items that actually exist in one of those three masters.
    axiosClient.get('/master/items?size=500').then((res) => {
      const data = res.data?.content || res.data || [];
      const filtered = filterPurchaseRelevantItems(Array.isArray(data) ? data : []);
      const items = filtered.map((it: any) => ({
        id: it.id,
        code: it.code,
        name: it.description || it.name || '',
        uom: it.uom || 'NOS',
        price: it.sellingRate || it.defaultRate || 0,
        description: it.description || '',
        taxCode: it.taxCode || '',
        active: it.active,
      }));
      setItemMasters(items.length > 0 ? items : []);
    }).catch(() => {
      setItemMasters([]);
    });

    // Load UOM masters
    axiosClient.get('/master/uoms').then((res) => {
      const data = res.data || [];
      if (Array.isArray(data) && data.length > 0) {
        setUomMasters(data.filter((u: any) => u.active !== false).map((u: any) => ({ id: u.id, code: u.code, name: u.name })));
      } else {
        setUomMasters([{ id: 1, code: 'NOS', name: 'Numbers' }, { id: 2, code: 'KG', name: 'Kilogram' }, { id: 3, code: 'MTR', name: 'Metre' }]);
      }
    }).catch(() => {
      setUomMasters([{ id: 1, code: 'NOS', name: 'Numbers' }, { id: 2, code: 'KG', name: 'Kilogram' }, { id: 3, code: 'MTR', name: 'Metre' }]);
    });

    // Load store/location masters (Sales DC's Source Location dropdown — stock is
    // checked against and deducted from whichever store is picked here).
    axiosClient.get('/master/stores').then((res) => {
      const data = res.data || [];
      setStoreMasters(Array.isArray(data) ? data.map((s: any) => ({ code: s.code, name: s.name || s.code })) : []);
    }).catch(() => setStoreMasters([]));

    // Load active sales orders, PIs, DCs and invoices for the cross-document
    // lookup dropdowns (e.g. "SO Number" on a Proforma Invoice). These must only
    // ever reflect real documents — a hardcoded sample row here previously showed
    // up in the dropdown even when no such Sales Order actually existed.
    axiosClient.get('/v1/sales/sales-order?size=100').then((res) => {
      const content = res.data?.content || res.data || [];
      setSalesOrderList(Array.isArray(content) ? content : []);
    }).catch(() => setSalesOrderList([]));

    axiosClient.get('/v1/sales/proforma-invoice?size=100').then((res) => {
      const content = res.data?.content || res.data || [];
      setProformaInvoiceList(Array.isArray(content) ? content : []);
    }).catch(() => setProformaInvoiceList([]));

    axiosClient.get('/v1/sales/sales-dc?size=100').then((res) => {
      const content = res.data?.content || res.data || [];
      setSalesDcList(Array.isArray(content) ? content : []);
    }).catch(() => setSalesDcList([]));

    axiosClient.get('/v1/sales/sales-invoice?size=100').then((res) => {
      const content = res.data?.content || res.data || [];
      setSalesInvoiceList(Array.isArray(content) ? content : []);
    }).catch(() => setSalesInvoiceList([]));
  }, []);

  const listQuery = useSalesDocList(docType, {
    page,
    size: PAGE_SIZE,
    sort: 'date,desc',
    search: search || undefined,
    status: status || undefined,
    type: defaultType || undefined,
  });

  const nextNumberQuery = useSalesDocNextNumber(docType);
  const documentQuery = useSalesDoc(docType, mode === 'form' && documentId ? documentId : null);
  const createMutation = useSalesDocCreate(docType);
  const updateMutation = useSalesDocUpdate(docType);
  const deleteMutation = useSalesDocDelete(docType);
  const actionMutation = useSalesDocAction(docType);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [search, status]);

  useEffect(() => {
    if (initialDocId) {
      setDocumentId(String(initialDocId));
      setIsViewOnly(viewOnly);
      setMode('form');
    }
  }, [initialDocId, viewOnly]);

  useEffect(() => {
    const doc = documentQuery.data;
    if (!doc || !documentId) return;
    const key = String(documentId);
    if (initializedForId === key) return;
    setInitializedForId(key);
    setForm({ ...doc });
    setLines(Array.isArray(doc.lines) ? (doc.lines as Array<Record<string, unknown>>).map((l, i) => {
      const line: Record<string, unknown> = { lineNo: i + 1, ...l, description: String(l.description || l.itemName || l.itemDesc || '') };
      // Tax % is a plain number field for these doc types — the backend hands back a
      // display string like "GST 9%", which would render as invalid in a number input.
      if (NUMERIC_TAX_DOC_TYPES.has(docType)) {
        line.taxCode = parseTaxPct(line.taxCode);
      }
      // Some line entities (e.g. SalesOrderItem) don't persist taxAmount separately —
      // only the tax-inclusive netAmount is stored — so taxAmount comes back null and
      // renders as a blank/invalid number field. Back it out from netAmount so the
      // grid shows the real value instead of nothing.
      if (line.taxAmount === null || line.taxAmount === undefined) {
        const qty = Number(line.qty ?? line.billedQty ?? line.dispatchQty ?? line.orderedQty ?? line.currentReturnQty ?? 0);
        const price = Number(line.unitPrice ?? line.rate ?? 0);
        const discPct = Number(line.discount ?? 0);
        const baseNet = (qty * price) - (qty * price * discPct) / 100;
        const net = Number(line.netAmount ?? 0);
        if (net > 0) line.taxAmount = Math.max(0, net - baseNet);
      }
      return line;
    }) : []);
  }, [documentQuery.data, documentId, initializedForId]);

  const doc = documentQuery.data;
  const genericStatus = String(doc?.status ?? 'DRAFT');
  // Sales Order / Proforma Invoice have no submit/approve/cancel workflow — they stay
  // editable at any status other than CANCELLED, since there's no transition to hand
  // them back to DRAFT.
  const editable = !isViewOnly && (NO_WORKFLOW_DOC_TYPES.has(docType)
    ? genericStatus !== 'CANCELLED'
    : (!documentId || ['DRAFT', 'REJECTED'].includes(genericStatus)));
  const isBusy = createMutation.isPending || updateMutation.isPending || actionMutation.isPending || deleteMutation.isPending;

  const rows = listQuery.data?.content ?? [];
  const totalElements = listQuery.data?.totalElements ?? rows.length;
  const totalPages = listQuery.data?.totalPages ?? 1;

  const openForm = (id: string | null, _view: boolean) => {
    setDocumentId(id);
    const dateToday = todayISO();
    const initialCode = id ? '' : (nextNumberQuery.data?.nextNumber || '');

    setForm({
      date: dateToday,
      docNo: initialCode,
      customer: '',
      customerCode: '',
      salesPerson: '',
      customerPoNumber: '',
      currency: 'INR - Indian Rupee',
      exchangeRate: 1.00,
      paymentTerms: '30 Days',
      deliveryTerms: 'EXW - Ex Works',
      // Matches the first <option> these selects show by default — without an
      // explicit value here, the browser displays that option but form state
      // stays empty, so it never actually gets saved.
      creditLimitStatus: 'OK',
      complianceChecklist: 'Tax Verified',
      deliveryStatus: 'Pending',
      billingAddress: '',
      shippingAddress: '',
      ...(config.typeFilter && defaultType ? { [config.typeFilter.field]: defaultType } : {})
    });
    setLines([{ lineNo: 1, itemCode: '', description: '', qty: 0, uom: 'NOS', unitPrice: 0, discount: 0, taxCode: NUMERIC_TAX_DOC_TYPES.has(docType) ? 18 : 'GST 18%', taxAmount: 0, netAmount: 0, lineStatus: 'Open' }]);
    setMode('form');
  };

  const backToList = () => {
    setDocumentId(null);
    setInitializedForId('');
    setIsViewOnly(false);
    setMode('list');
  };

  const handleSOSelect = (soNo: string) => {
    const selectedSO = salesOrderList.find(so => so.docNo === soNo);
    if (!selectedSO) return;

    const matchingPI = proformaInvoiceList.find(pi => pi.salesOrderNumber === soNo);
    const piRef = matchingPI ? String(matchingPI.docNo || matchingPI.id || '') : '';

    setForm(prev => {
      const updatedForm: Record<string, any> = {
        ...prev,
        salesOrderNumber: soNo,
        customer: selectedSO.customer || prev.customer,
        customerCode: selectedSO.customerCode || prev.customerCode,
        customerPoNumber: selectedSO.customerPoNumber || '',
        salesPerson: selectedSO.salesPerson || prev.salesPerson,
        currency: selectedSO.currency || prev.currency,
        paymentTerms: selectedSO.paymentTerms || prev.paymentTerms,
        deliveryTerms: selectedSO.deliveryTerms || prev.deliveryTerms,
        billingAddress: selectedSO.billingAddress || prev.billingAddress,
        shippingAddress: selectedSO.shippingAddress || prev.shippingAddress,
      };

      if (docType === 'sales-dc') {
        updatedForm.piReference = piRef;
      } else if (docType === 'sales-invoice') {
        updatedForm.piNumber = piRef;
      }

      return updatedForm;
    });

    if (Array.isArray(selectedSO.lines) && selectedSO.lines.length > 0) {
      setLines(selectedSO.lines.map((l: any, i: number) => {
        const lineData: Record<string, any> = { lineNo: i + 1, ...l };
        const defaultQty = (l.pendingQty !== undefined && l.pendingQty !== null) ? l.pendingQty : (l.qty || 0);
        if (docType === 'sales-dc') {
          lineData.dispatchQty = defaultQty;
        } else if (docType === 'sales-invoice') {
          lineData.billedQty = defaultQty;
        }
        if (NUMERIC_TAX_DOC_TYPES.has(docType)) {
          const taxPct = parseTaxPct(l.taxCode);
          lineData.taxCode = taxPct;
          const qty = Number(lineData.qty ?? defaultQty ?? 0);
          const price = Number(lineData.unitPrice ?? lineData.rate ?? 0);
          const baseNet = qty * price;
          const taxAmt = (baseNet * taxPct) / 100;
          lineData.taxAmount = taxAmt;
          lineData.netAmount = baseNet + taxAmt;
        }
        return lineData;
      }));
    }
  };

  const handleDCSelect = (dcNo: string) => {
    const selectedDC = salesDcList.find(dc => dc.docNo === dcNo);
    if (!selectedDC) {
      if (dcNo) {
        void lookupDocumentByNumber('sales-dc', dcNo).then((doc) => {
          if (!doc) return;
          setForm((prev) => ({
            ...prev,
            originalDcNumber: dcNo,
            customer: doc.customer || doc.party || prev.customer,
            customerCode: doc.supplier || doc.customer || prev.customerCode,
            originalDcDate: doc.date || prev.originalDcDate,
            salesOrderNumber: doc.salesOrderNo || doc.raw?.salesOrderNumber || prev.salesOrderNumber,
            customerPoNumber: doc.raw?.customerPoNumber || prev.customerPoNumber,
          }));
          if (doc.lines && doc.lines.length > 0) {
            // The original DC's stock left from a specific store — the return must go
            // back into that same store, not the "MAIN" the backend otherwise defaults
            // to (which isn't a real registered location and fails to post).
            const returnLocation = doc.raw?.sourceLocation || doc.sourceLocation || '';
            setLines(doc.lines.map((l: any, i: number) => {
              const qty = Number(l.qty || l.dispatchQty || 0);
              return {
                lineNo: i + 1,
                itemCode: l.itemCode || '',
                description: l.description || l.itemDesc || '',
                batchNumber: l.batchNo || l.batchNumber || '',
                heatNumber: l.heatNo || l.heatNumber || '',
                serialNumber: l.serialNumber || '',
                location: returnLocation,
                currentReturnQty: qty,
                acceptedQty: qty,
                rejectedQty: 0,
                disposition: 'Return to Stock',
                lineRemark: l.remarks || l.lineRemark || '',
              };
            }));
          }
        });
      }
      return;
    }

    setForm(prev => ({
      ...prev,
      originalDcNumber: dcNo,
      customer: selectedDC.customer || selectedDC.party || prev.customer,
      customerCode: selectedDC.customerCode || prev.customerCode,
      originalDcDate: selectedDC.date || selectedDC.docDate || prev.originalDcDate,
      salesOrderNumber: selectedDC.salesOrderNumber || prev.salesOrderNumber,
      customerPoNumber: selectedDC.customerPoNumber || prev.customerPoNumber,
    }));

    if (Array.isArray(selectedDC.lines) && selectedDC.lines.length > 0) {
      // Same as above — the return must post back into the store the original DC
      // actually shipped from, not the "MAIN" fallback.
      const returnLocation = selectedDC.sourceLocation || '';
      setLines(selectedDC.lines.map((l: any, i: number) => {
        const qty = Number(l.dispatchQty ?? l.currentDispatchQty ?? l.qty ?? 0);
        return {
          lineNo: i + 1,
          itemCode: l.itemCode || '',
          description: l.description || l.itemName || l.itemDesc || '',
          batchNumber: l.batchNumber || l.batchNo || '',
          heatNumber: l.heatNumber || l.heatNo || '',
          serialNumber: l.serialNumber || '',
          location: returnLocation,
          currentReturnQty: qty,
          acceptedQty: qty,
          rejectedQty: 0,
          disposition: 'Return to Stock',
          lineRemark: l.lineRemark || l.remarks || '',
        };
      }));
    }
  };

  // Sales DC Number select on the Sales Invoice form — a Sales Invoice is normally
  // raised against goods already dispatched via a DC, so picking the DC auto-fills
  // the customer/SO/PO details and carries the dispatched lines (with batch/heat and
  // item pricing looked up from the item master, since DC lines don't carry price).
  const handleDcSelectForInvoice = (dcNo: string) => {
    const selectedDC = salesDcList.find(dc => dc.docNo === dcNo);
    if (!selectedDC) return;

    const customerName = selectedDC.customer || selectedDC.party || '';
    const customerMaster: any = customerMasters.find(c => c.name === customerName)
      ?? customerMasters.find(c => c.code === selectedDC.customerCode);
    const selectedSO = salesOrderList.find(so => so.docNo === selectedDC.salesOrderNumber);
    const customerState = customerMaster?.state || '';
    const customerGst = customerMaster?.gstNumber || customerMaster?.gstin || '';
    const customerBillAddr = customerMaster?.billingAddress
      || [customerMaster?.address, customerMaster?.city, customerMaster?.pincode].filter(Boolean).join(', ');

    setForm(prev => ({
      ...prev,
      salesDcNumber: dcNo,
      salesOrderNumber: selectedDC.salesOrderNumber || prev.salesOrderNumber,
      customer: customerName || prev.customer,
      customerCode: selectedDC.customerCode || prev.customerCode,
      customerPoNumber: selectedDC.customerPoNumber || prev.customerPoNumber,
      piNumber: selectedDC.piReference || selectedSO?.linkedProformaInvoice || prev.piNumber,
      customerGstin: customerGst || selectedSO?.customerGstin || prev.customerGstin,
      placeOfSupply: customerState || selectedSO?.placeOfSupply || prev.placeOfSupply,
      billingAddress: customerBillAddr || selectedSO?.billingAddress || prev.billingAddress,
      shippingAddress: selectedDC.deliveryAddress || selectedDC.shippingAddress
        || customerMaster?.shippingAddress || selectedSO?.shippingAddress || prev.shippingAddress,
      vehicleNo: selectedDC.vehicleNo || prev.vehicleNo,
      dateTimeOfSupply: selectedDC.dispatchDate || prev.dateTimeOfSupply,
    }));

    if (Array.isArray(selectedDC.lines) && selectedDC.lines.length > 0) {
      const soLines = Array.isArray(selectedSO?.lines) ? (selectedSO.lines as any[]) : [];
      setLines(selectedDC.lines.map((l: any, i: number) => {
        // Price/tax travel on the Sales Order line, not the DC line — the DC only
        // records what was dispatched. Fall back to the item master's defaultRate
        // when there's no matching SO line so unit price / tax / totals auto-fill
        // instead of every line coming back at ₹0.
        const soLine = soLines.find((sl: any) => sl.itemCode === l.itemCode);
        const item = itemMasters.find(it => it.code === l.itemCode);
        const qty = Number(l.dispatchQty ?? l.currentDispatchQty ?? l.qty ?? 0);
        const price = Number(l.unitPrice ?? soLine?.unitPrice ?? soLine?.rate ?? item?.price ?? 0);
        const taxCode = l.taxCode || soLine?.taxCode || soLine?.tax || 'GST 18%';
        const taxPct = parseTaxPct(taxCode);
        const baseNet = qty * price;
        const taxAmt = (baseNet * taxPct) / 100;

        const batch = l.batchNumber || l.batchNo || '';
        const heat = l.heatNumber || l.heatNo || '';
        const batchHeatNumber = [batch, heat].filter(Boolean).join('/');
        const itemName = item?.name || l.itemName || item?.description || '';

        return {
          lineNo: i + 1,
          itemCode: l.itemCode || '',
          itemName,
          description: itemName,
          batchHeatNumber,
          billedQty: qty,
          uom: l.uom || item?.uom || 'NOS',
          unitPrice: price,
          taxCode,
          taxAmount: taxAmt,
          netAmount: baseNet + taxAmt,
        };
      }));
    }
  };

  const handleInvoiceSelect = (invoiceNo: string) => {
    const selectedInvoice = salesInvoiceList.find(inv => inv.docNo === invoiceNo);
    if (!selectedInvoice) return;

    setForm(prev => ({
      ...prev,
      originalInvoiceNumber: invoiceNo,
      customer: selectedInvoice.customer || selectedInvoice.party || prev.customer,
      customerCode: selectedInvoice.customerCode || prev.customerCode,
      originalInvoiceDate: selectedInvoice.date || selectedInvoice.docDate || prev.originalInvoiceDate,
      salesOrderNumber: selectedInvoice.salesOrderNumber || prev.salesOrderNumber,
      customerPoNumber: selectedInvoice.customerPoNumber || prev.customerPoNumber,
      currency: selectedInvoice.currency || prev.currency,
    }));

    if (Array.isArray(selectedInvoice.lines) && selectedInvoice.lines.length > 0) {
      setLines(selectedInvoice.lines.map((l: any, i: number) => {
        let batchNumber: string;
        let heatNumber: string;
        if (l.batchHeatNumber) {
          const parts = String(l.batchHeatNumber).split('/');
          batchNumber = parts[0]?.trim() || '';
          heatNumber = parts[1]?.trim() || '';
        } else {
          batchNumber = l.batchNumber || l.batchNo || '';
          heatNumber = l.heatNumber || l.heatNo || '';
        }

        const qty = Number(l.billedQty ?? l.qty ?? 0);
        const price = Number(l.unitPrice ?? l.rate ?? 0);
        const baseNet = qty * price;

        const taxPct = parseTaxPct(l.taxCode || l.tax || 'GST 18%');

        const taxAmt = (baseNet * taxPct) / 100;
        const netAmt = baseNet + taxAmt;

        return {
          lineNo: i + 1,
          itemCode: l.itemCode || '',
          description: l.description || l.itemName || l.itemDesc || '',
          batchNumber: batchNumber,
          heatNumber: heatNumber,
          serialNumber: l.serialNumber || '',
          currentReturnQty: qty,
          acceptedQty: qty,
          rejectedQty: 0,
          unitPrice: price,
          taxCode: l.taxCode || l.tax || 'GST 18%',
          taxAmount: taxAmt,
          netAmount: netAmt,
          disposition: 'Return to Stock',
          lineRemark: l.lineRemark || l.remarks || '',
        };
      }));
    }
  };

  const handleCustomerSelect = (customerName: string) => {
    const found: any = customerMasters.find(c => c.name === customerName);
    const buildAddr = (p: any) => {
      if (!p) return '';
      const parts: string[] = [];
      if (p.address) parts.push(p.address);
      if (p.city) parts.push(p.city);
      if (p.state) parts.push(p.state);
      if (p.pincode) parts.push(p.pincode);
      if (p.country && p.country !== 'India') parts.push(p.country);
      return parts.filter(Boolean).join(', ');
    };
    let billingAddr = '';
    let shippingAddr = '';
    if (found) {
      billingAddr = found.billingAddress || '';
      shippingAddr = found.shippingAddress || '';
      if (!billingAddr) {
        try {
          const addrs = JSON.parse(found.addressesJson || '[]');
          if (Array.isArray(addrs) && addrs.length > 0) {
            const a = addrs[0];
            const parts: string[] = [];
            if (a.addressLine1) parts.push(a.addressLine1);
            if (a.addressLine2) parts.push(a.addressLine2);
            if (a.city) parts.push(a.city);
            if (a.state) parts.push(a.state);
            if (a.pinZipCode) parts.push(a.pinZipCode);
            billingAddr = parts.filter(Boolean).join(', ');
          }
        } catch { /* use default */ }
      }
      if (!billingAddr) billingAddr = buildAddr(found);
      if (!shippingAddr) {
        try {
          const delAddrs = JSON.parse(found.deliveryAddressesJson || '[]');
          if (Array.isArray(delAddrs) && delAddrs.length > 0) {
            const a = delAddrs[0];
            const parts: string[] = [];
            if (a.addressLine1) parts.push(a.addressLine1);
            if (a.addressLine2) parts.push(a.addressLine2);
            if (a.city) parts.push(a.city);
            if (a.state) parts.push(a.state);
            if (a.pinZipCode) parts.push(a.pinZipCode);
            shippingAddr = parts.filter(Boolean).join(', ');
          }
        } catch { /* use default */ }
      }
      if (!shippingAddr) shippingAddr = buildAddr(found);
    }
    setForm(prev => ({
      ...prev,
      customer: customerName,
      customerCode: found?.code ?? prev.customerCode ?? '',
      billingAddress: billingAddr,
      shippingAddress: shippingAddr,
    }));
  };

  // Line item change & Column 2 Master Item Lookup
  const handleLineItemChange = (index: number, fieldKey: string, value: any) => {
    setLines(prev => {
      const next = [...prev];
      const row = { ...next[index], [fieldKey]: value };

      if (fieldKey === 'itemCode') {
        // Item Name / Description / UOM / Unit Price / Tax Code all auto-fill from
        // the item master when a line item is picked; tax amount & net total are
        // recomputed below from qty × price × tax%.
        const item = itemMasters.find(i => i.code === value);
        if (item) {
          row.itemName = item.name || item.description || item.code;
          row.description = row.itemName;
          row.uom = item.uom || 'PCS';
          row.unitPrice = Number(item.price ?? 0);
          if (item.taxCode) row.taxCode = item.taxCode;
          // Item Master has no defaultRate for most rows — fall back to the last
          // known SO line price for this item so unit price still auto-fills.
          if (!row.unitPrice) {
            for (const so of salesOrderList) {
              const soLines = Array.isArray(so.lines) ? (so.lines as any[]) : [];
              const sl = soLines.find((l: any) => l.itemCode === value);
              const soPrice = Number(sl?.unitPrice ?? sl?.rate ?? 0);
              if (soPrice > 0) { row.unitPrice = soPrice; break; }
            }
          }
        } else {
          row.itemName = '';
        }
      }

      // BR-INV-SDC-2 / FRS §08.1: currentDispatchQty must never exceed the SO line's
      // pendingQty (soQty − previouslyDispatchedQty) — the backend already rejects an
      // over-dispatch on post, but that's a late, generic error; capping here gives
      // immediate feedback instead of a round-trip failure.
      if (fieldKey === 'dispatchQty' && docType === 'sales-dc') {
        const pending = row.pendingQty !== undefined && row.pendingQty !== null ? Number(row.pendingQty) : null;
        const requested = Number(value);
        if (pending !== null && Number.isFinite(pending) && requested > pending) {
          row.dispatchQty = pending;
          toast(`Dispatch Quantity cannot exceed pending quantity (${pending})`, 'error');
        }
      }

      // Recalculate row amounts
      const qty = Number(row.qty ?? row.billedQty ?? row.dispatchQty ?? row.orderedQty ?? row.currentReturnQty ?? 1);
      const price = Number(row.unitPrice ?? 0);
      const discPct = Number(row.discount ?? 0);
      const discAmt = (qty * price * discPct) / 100;
      row.discountAmount = discAmt;
      const baseNet = (qty * price) - discAmt;

      const taxPct = parseTaxPct(row.taxCode ?? 'GST 18%');

      const taxAmt = (baseNet * taxPct) / 100;
      row.taxAmount = taxAmt;
      row.netAmount = baseNet + taxAmt;

      next[index] = row;
      return next;
    });
  };

  const addLine = () => {
    setLines(prev => [
      ...prev,
      { lineNo: prev.length + 1, itemCode: '', description: '', qty: 0, uom: 'NOS', unitPrice: 0, discount: 0, taxCode: NUMERIC_TAX_DOC_TYPES.has(docType) ? 18 : 'GST 18%', taxAmount: 0, netAmount: 0, lineStatus: 'Open' }
    ]);
  };

  const removeLine = (index: number) => {
    setLines(prev => prev.filter((_, i) => i !== index).map((l, i) => ({ ...l, lineNo: i + 1 })));
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = { ...form };
    if (config.lines) {
      payload.lines = lines.map(l => ({ ...l }));
    }
    return payload;
  };

  const handleSave = async (e?: React.FormEvent, postAfter = false) => {
    if (e) e.preventDefault();
    try {
      const payload = buildPayload();
      let savedRes: any;
      if (documentId) {
        savedRes = await updateMutation.mutateAsync({ id: documentId, payload });
        toast('Sales Document updated successfully!', 'success');
      } else {
        savedRes = await createMutation.mutateAsync(payload);
        toast('Sales Document created successfully!', 'success');
      }

      // Sales DC ships straight from Draft to a posted stock movement in one action —
      // no separate Submit/Approve step, same as DC Return/Invoice Return already do.
      if (postAfter && savedRes?.id && savedRes.status !== 'POSTED') {
        savedRes = await actionMutation.mutateAsync({ id: savedRes.id, action: 'post', note: 'Save & Post Stock' });
        toast('Stock movement posted successfully!', 'success');
      }

      logSystemActivity({
        module: 'Sales',
        activity: `${config.title} (${savedRes?.docNo || form.docNo || 'Document'})`,
        refNo: savedRes?.docNo || form.docNo || '',
        party: String(form.customer || form.party || 'Customer'),
        user: user?.username || 'Unknown',
        status: savedRes?.status || 'APPROVED',
      });

      // Land back on a fresh blank entry form rather than the list — same behavior
      // every success path in this screen now follows.
      openForm(null, false);
    } catch (err: any) {
      toast(getApiErrorMessage(err, 'Failed to save sales document'), 'error');
    }
  };

  const handleAction = async (note: string) => {
    if (!actionModal || !documentId) return;
    if (actionModal.action === 'reject' && !note.trim()) {
      toast('A reason is required to reject this document.', 'error');
      return;
    }
    try {
      await actionMutation.mutateAsync({ id: documentId, action: actionModal.action, note });
      toast(`Sales Document ${actionModal.action}d successfully!`, 'success');
      setActionModal(null);
      openForm(null, false);
    } catch (err: any) {
      toast(getApiErrorMessage(err, 'Failed to perform action'), 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget?.id) return;
    try {
      await deleteMutation.mutateAsync(String(deleteTarget.id));
      toast('Sales Document deleted successfully!', 'success');
      setDeleteTarget(null);
    } catch (err: any) {
      toast(getApiErrorMessage(err, 'Failed to delete sales document'), 'error');
    }
  };

  // Header Renderers
  if (mode === 'list') {
    return (
      <div className="view-container">
        <div className="pg-head pg-head-flex">
          <div className="pg-head-text">
            <h1>{config.title}</h1>
            <p>{config.subtitle}</p>
          </div>
          <button className="btn btn-p" onClick={() => openForm(null, false)}>
            <span className="material-symbols-rounded">add</span>
            New {config.title}
          </button>
        </div>

        {/* Filter Controls Panel */}
        <div className="panel">
          <div className="toolbar" style={{ gap: '8px', justifyContent: 'flex-start' }}>
            <div className="searchwrap" style={{ flex: '0 0 auto' }}>
              <span className="material-symbols-rounded">search</span>
              <input
                type="text"
                className="in"
                placeholder={`Search ${config.title}...`}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{ width: '250px' }}
              />
            </div>
            <button
              className="ibtn"
              title="Export CSV"
              onClick={() =>
                exportToCsv(
                  rows as unknown as Record<string, unknown>[],
                  config.columns.map((c) => ({ key: c.field, label: c.label })),
                  config.docType
                )
              }
            >
              <span className="material-symbols-rounded">download</span>
            </button>
            <select
              className="in"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={{ flex: '0 0 auto', width: '180px' }}
            >
              <option value="">All Statuses</option>
              {config.statusOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div className="sp" />
            <span className="count">{totalElements} records</span>
          </div>

          {/* List Table */}
          <div className="twrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="num">S.No</th>
                  {config.columns.map((col) => (
                    <th key={col.field} className={col.numeric ? 'num' : ''}>
                      {col.label}
                    </th>
                  ))}
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading ? (
                  <tr>
                    <td colSpan={config.columns.length + 2} className="empty">
                      Loading sales documents...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={config.columns.length + 2} className="empty">
                      <span className="material-symbols-rounded">inventory_2</span>
                      No sales documents found. Click <strong>+ New {config.title}</strong> to create one.
                    </td>
                  </tr>
                ) : (
                  rows.map((row: any, idx: number) => (
                    <tr key={row.id}>
                      <td className="num mut">{page * PAGE_SIZE + idx + 1}</td>
                      {config.columns.map((col) => {
                        const val = row[col.field];
                        if (col.badge) {
                          return (
                            <td key={col.field}>
                              <StatusBadge status={String(val || 'DRAFT')} />
                            </td>
                          );
                        }
                        if (col.money) {
                          return (
                            <td key={col.field} className="num cell-b">
                              {formatMoney(val)}
                            </td>
                          );
                        }
                        if (col.numeric) {
                          return (
                            <td key={col.field} className="num cell-b">
                              {typeof val === 'number' ? formatNumber(val) : (val ?? '0')}
                            </td>
                          );
                        }
                        return (
                          <td key={col.field}>
                            {col.field === 'docNo' ? (
                              <a
                                onClick={() => openForm(String(row.id), true)}
                                className="cell-b"
                              >
                                {String(val || row.id)}
                              </a>
                            ) : (
                              String(val ?? '-')
                            )}
                          </td>
                        );
                      })}
                      <td style={{ textAlign: 'right' }}>
                        <button
                          onClick={() => openForm(String(row.id), true)}
                          className="ibtn"
                          title="View"
                        >
                          <span className="material-symbols-rounded">visibility</span>
                        </button>
                        <button
                          onClick={() => openForm(String(row.id), false)}
                          className="ibtn"
                          title="Edit"
                        >
                          <span className="material-symbols-rounded">edit</span>
                        </button>
                        <button
                          onClick={() => setDeleteTarget(row)}
                          className="ibtn danger"
                          title="Delete"
                        >
                          <span className="material-symbols-rounded">delete</span>
                        </button>
                        <button
                          onClick={() => salesApi.printDocument(docType, row.id, 'download')}
                          className="ibtn"
                          title="Download PDF"
                        >
                          <span className="material-symbols-rounded">download</span>
                        </button>
                        <button
                          onClick={() => salesApi.printDocument(docType, row.id, 'print')}
                          className="ibtn"
                          title="Print"
                        >
                          <span className="material-symbols-rounded">print</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="pager">
            <span>Showing page {page + 1} of {totalPages} ({totalElements} items)</span>
            <div className="pgs">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ‹
              </button>
              <button className="on">{page + 1}</button>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                ›
              </button>
            </div>
          </div>
        </div>

        {deleteTarget && (
          <ConfirmActionModal
            open={Boolean(deleteTarget)}
            title={`Delete ${config.title}`}
            body={`Are you sure you want to delete ${String(deleteTarget.docNo || deleteTarget.id)}?`}
            okLabel="Delete"
            danger={true}
            onConfirm={() => handleDelete()}
            onClose={() => setDeleteTarget(null)}
          />
        )}
      </div>
    );
  }

  // Form Mode
  return (
    <div className="view-container">
      {/* Form Page Header */}
      <div className="pg-head pg-head-flex">
        <div className="pg-head-text" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={backToList} className="btn btn-sm" title="Back to list">
            <span className="material-symbols-rounded">arrow_back</span>
            Back
          </button>
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {documentId ? `Edit ${config.title}` : `New ${config.title}`}
              {form.status ? <StatusBadge status={String(form.status)} /> : null}
            </h1>
            <p>{config.subtitle}</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {documentId && (
            <button
              onClick={() => setAuditOpen(true)}
              className="btn btn-sm"
              title="Audit History"
            >
              <span className="material-symbols-rounded">history</span>
              Audit
            </button>
          )}
          {editable && DIRECT_POST_ON_SAVE_DOC_TYPES.has(docType) && (
            <>
              <button
                onClick={() => handleSave(undefined, false)}
                disabled={isBusy}
                className="btn"
              >
                <span className="material-symbols-rounded">save</span>
                {isBusy ? 'Saving...' : 'Save as Draft'}
              </button>
              <button
                onClick={() => handleSave(undefined, true)}
                disabled={isBusy}
                className="btn btn-p"
                title="Saves this DC and immediately posts it — stock reduces right away, no separate Submit/Approve step."
              >
                <span className="material-symbols-rounded">check_circle</span>
                {isBusy ? 'Saving...' : 'Save & Post Stock'}
              </button>
            </>
          )}
          {editable && !DIRECT_POST_ON_SAVE_DOC_TYPES.has(docType) && (
            <button
              onClick={() => handleSave()}
              disabled={isBusy}
              className="btn btn-p"
            >
              <span className="material-symbols-rounded">save</span>
              {isBusy ? 'Saving...' : 'Save Document'}
            </button>
          )}
          {/* Sales Order / Proforma Invoice are Save-only; Sales DC posts on Save — none of
              these three need the submit/approve/reject/post workflow below. */}
          {!NO_WORKFLOW_DOC_TYPES.has(docType) && !DIRECT_POST_ON_SAVE_DOC_TYPES.has(docType) && documentId && editable && (
            <button
              onClick={() => setActionModal({ action: 'submit', danger: false })}
              className="btn btn-g"
            >
              <span className="material-symbols-rounded">send</span>
              Submit
            </button>
          )}
          {!NO_WORKFLOW_DOC_TYPES.has(docType) && !DIRECT_POST_ON_SAVE_DOC_TYPES.has(docType) && documentId && ['SUBMITTED', 'PENDING_TIER1', 'PENDING_TIER2', 'PENDING_TIER3'].includes(String(form.status)) && can('sales', 'Approve') && (
            <button
              onClick={() => setActionModal({ action: 'approve', danger: false })}
              className="btn btn-p"
            >
              <span className="material-symbols-rounded">check_circle</span>
              Approve{String(form.status).startsWith('PENDING_TIER') ? ` (${String(form.status).replace('PENDING_', '')})` : ''}
            </button>
          )}
          {!NO_WORKFLOW_DOC_TYPES.has(docType) && !DIRECT_POST_ON_SAVE_DOC_TYPES.has(docType) && documentId && ['SUBMITTED', 'PENDING_TIER1', 'PENDING_TIER2', 'PENDING_TIER3'].includes(String(form.status)) && (
            <button
              onClick={() => setActionModal({ action: 'reject', danger: true })}
              className="btn btn-d"
            >
              <span className="material-symbols-rounded">cancel</span>
              Reject
            </button>
          )}
          {!NO_WORKFLOW_DOC_TYPES.has(docType) && !DIRECT_POST_ON_SAVE_DOC_TYPES.has(docType) && documentId && String(form.status) === 'REJECTED' && (
            <button
              onClick={() => setActionModal({ action: 'reopen', danger: false })}
              className="btn btn-g"
            >
              <span className="material-symbols-rounded">restart_alt</span>
              Reopen
            </button>
          )}
          {!NO_WORKFLOW_DOC_TYPES.has(docType) && !DIRECT_POST_ON_SAVE_DOC_TYPES.has(docType) && documentId && String(form.status) === 'APPROVED' && (
            <button
              onClick={() => setActionModal({ action: 'post', danger: false })}
              className="btn btn-p"
            >
              <span className="material-symbols-rounded">task_alt</span>
              Post
            </button>
          )}
          {!NO_WORKFLOW_DOC_TYPES.has(docType) && documentId && ['DRAFT', 'SUBMITTED', 'PENDING_TIER1', 'PENDING_TIER2', 'PENDING_TIER3', 'APPROVED', 'CONFIRMED', 'POSTED', 'RECEIVED'].includes(String(form.status)) && (
            <button
              onClick={() => setActionModal({ action: 'cancel', danger: true })}
              className="btn btn-d"
            >
              <span className="material-symbols-rounded">block</span>
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Header Fields Section */}
      <div className="sec-head">
        <div className="sec-title">
          <span className="material-symbols-rounded">edit_note</span>
          1. Header Information
        </div>
      </div>
      <div className="sec-body">
        <div className="fgrid">
          {config.fields.map((field) => {
            const val = form[field.key] ?? '';

            // SO Number Select Option
            if (field.key === 'salesOrderNumber') {
              return (
                <div key={field.key} className="fld">
                  <span>{field.label}</span>
                  <select
                    disabled={!editable}
                    value={String(val)}
                    onChange={(e) => handleSOSelect(e.target.value)}
                    className="in"
                    style={{ fontWeight: 700, color: '#1e3a8a' }}
                  >
                    <option value="">-- Select Sales Order --</option>
                    {salesOrderList.map((so: any) => (
                      <option key={so.docNo} value={so.docNo}>
                        {so.docNo} - {so.customer || 'Customer'} ({so.date})
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            // Source Location Select Option (Sales DC) — which store to check stock
            // availability against and deduct from on post.
            if (field.key === 'sourceLocation') {
              return (
                <div key={field.key} className="fld">
                  <span>{field.label}</span>
                  <select
                    disabled={!editable}
                    value={String(val)}
                    onChange={(e) => setForm(prev => ({ ...prev, sourceLocation: e.target.value }))}
                    className="in"
                  >
                    <option value="">-- Select Location --</option>
                    {storeMasters.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            // Sales DC Number Select Option (Sales Invoice) — only shown when there
            // are actual Sales DC documents to pick from.
            if (field.key === 'salesDcNumber') {
              if (salesDcList.length === 0) return null;
              return (
                <div key={field.key} className="fld">
                  <span>{field.label}</span>
                  <select
                    disabled={!editable}
                    value={String(val)}
                    onChange={(e) => handleDcSelectForInvoice(e.target.value)}
                    className="in"
                    style={{ fontWeight: 700, color: '#1e3a8a' }}
                  >
                    <option value="">-- Select Sales DC --</option>
                    {salesDcList.map((dc: any) => (
                      <option key={dc.docNo} value={dc.docNo}>
                        {dc.docNo} - {dc.customer || 'Customer'} ({dc.date})
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            // Customer Master Select
            if (field.key === 'customer') {
              return (
                <div key={field.key} className="fld">
                  <span>{field.label}</span>
                  <select
                    disabled={!editable || field.readOnly}
                    value={String(val)}
                    onChange={(e) => handleCustomerSelect(e.target.value)}
                    className="in"
                  >
                    <option value="">-- Select Customer --</option>
                    {customerMasters.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            // Original DC Number dropdown
            if (field.key === 'originalDcNumber') {
              return (
                <div key={field.key} className="fld">
                  <span>{field.label}</span>
                  <select
                    disabled={!editable}
                    value={String(val)}
                    onChange={(e) => handleDCSelect(e.target.value)}
                    className="in"
                    style={{ fontWeight: 700, color: '#1e3a8a' }}
                  >
                    <option value="">-- Select Delivery Challan --</option>
                    {salesDcList.map((dc: any) => (
                      <option key={dc.docNo} value={dc.docNo}>
                        {dc.docNo} - {dc.customer || 'Customer'} ({dc.date})
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            // Original Invoice Reference dropdown
            if (field.key === 'originalInvoiceNumber') {
              return (
                <div key={field.key} className="fld">
                  <span>{field.label}</span>
                  <select
                    disabled={!editable}
                    value={String(val)}
                    onChange={(e) => handleInvoiceSelect(e.target.value)}
                    className="in"
                    style={{ fontWeight: 700, color: '#1e3a8a' }}
                  >
                    <option value="">-- Select Invoice --</option>
                    {salesInvoiceList.map((inv: any) => (
                      <option key={inv.docNo} value={inv.docNo}>
                        {inv.docNo} - {inv.customer || 'Customer'} ({inv.date})
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            return (
              <div key={field.key} className={`fld ${field.span2 ? 'span2' : ''}`}>
                <span>{field.label}</span>
                {field.type === 'textarea' ? (
                  <textarea
                    disabled={!editable || field.readOnly}
                    rows={2}
                    value={String(val)}
                    onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className="in"
                  />
                ) : field.type === 'select' ? (
                  <select
                    disabled={!editable || field.readOnly}
                    value={String(val)}
                    onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className="in"
                  >
                    {(field.options || []).map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type || 'text'}
                    disabled={!editable || field.readOnly}
                    value={String(val)}
                    onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className="in"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Line Items Grid Section */}
      {config.lines && (
        <>
          <div className="sec-head" style={{ marginTop: '24px' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">list_alt</span>
              2. {config.lines.title}
            </div>
            {editable && (
              <button type="button" onClick={addLine} className="btn btn-sm btn-p">
                <span className="material-symbols-rounded">add</span>
                Add Item
              </button>
            )}
          </div>
          <div className="sec-body" style={{ padding: '0' }}>
            <div className="twrap">
              <table className="tbl lines">
                <thead>
                  <tr>
                    {config.lines.fields.map((f) => (
                      <th key={f.key} style={f.width ? { width: f.width, minWidth: f.width } : undefined}>{f.label}</th>
                    ))}
                    {editable && <th style={{ textAlign: 'right' }}>Remove</th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={idx}>
                      {config.lines!.fields.map((f) => {
                        const cellVal = line[f.key] ?? '';
                        const colStyle = f.width ? { width: f.width, minWidth: f.width } : undefined;

                        // Column 2 Master Item Lookup: type-to-search
                        if (f.colNo === 2 || f.type === 'lookup') {
                          return (
                            <td key={f.key} className={f.width ? undefined : "w-i"} style={colStyle}>
                              <SearchableItemLookup
                                value={String(cellVal)}
                                disabled={!editable}
                                items={itemMasters.filter(it => it.active !== false)}
                                onChange={(val) => handleLineItemChange(idx, f.key, val)}
                              />
                            </td>
                          );
                        }

                        // UOM Master Lookup Select
                        if (f.key === 'uom') {
                          return (
                            <td key={f.key} style={colStyle}>
                              <select
                                disabled={!editable}
                                value={String(cellVal)}
                                onChange={(e) => handleLineItemChange(idx, f.key, e.target.value)}
                                className="in"
                                style={{ width: '100%' }}
                              >
                                <option value="">-- UOM --</option>
                                {uomMasters.map((u) => (
                                  <option key={u.id} value={u.code}>
                                    {u.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                          );
                        }

                        if (f.type === 'select') {
                          return (
                            <td key={f.key} style={colStyle}>
                              <select
                                disabled={!editable || f.readOnly}
                                value={String(cellVal)}
                                onChange={(e) => handleLineItemChange(idx, f.key, e.target.value)}
                                className="in"
                                style={{ width: '100%' }}
                              >
                                {(f.options || []).map((o) => (
                                  <option key={o} value={o}>{o}</option>
                                ))}
                              </select>
                            </td>
                          );
                        }

                        return (
                          <td key={f.key} style={colStyle}>
                            <input
                              type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                              disabled={!editable || f.readOnly}
                              value={String(cellVal)}
                              onChange={(e) => handleLineItemChange(idx, f.key, e.target.value)}
                              className="in"
                              style={{ width: '100%' }}
                            />
                          </td>
                        );
                      })}
                      {editable && (
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            className="ibtn danger"
                            title="Remove row"
                          >
                            <span className="material-symbols-rounded">delete</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Action Footer Bar */}
      <div className="actbar" style={{ marginTop: '24px' }}>
        <div className="lft">
          <span className="material-symbols-rounded">info</span>
          Fill all mandatory header and item details before submitting.
        </div>
        <button type="button" onClick={backToList} className="btn">
          Close
        </button>
        {editable && DIRECT_POST_ON_SAVE_DOC_TYPES.has(docType) && (
          <>
            <button type="button" onClick={() => handleSave(undefined, false)} disabled={isBusy} className="btn">
              <span className="material-symbols-rounded">save</span>
              {isBusy ? 'Saving...' : 'Save as Draft'}
            </button>
            <button type="button" onClick={() => handleSave(undefined, true)} disabled={isBusy} className="btn btn-p">
              <span className="material-symbols-rounded">check_circle</span>
              {isBusy ? 'Saving...' : 'Save & Post Stock'}
            </button>
          </>
        )}
        {editable && !DIRECT_POST_ON_SAVE_DOC_TYPES.has(docType) && (
          <button type="button" onClick={() => handleSave()} disabled={isBusy} className="btn btn-p">
            <span className="material-symbols-rounded">save</span>
            {isBusy ? 'Saving...' : 'Save Document'}
          </button>
        )}
      </div>

      {actionModal && (
        <ConfirmActionModal
          open={Boolean(actionModal)}
          title={`Confirm ${actionModal.action.toUpperCase()}`}
          body={`Are you sure you want to ${actionModal.action} this sales document?`}
          okLabel={actionModal.action.toUpperCase()}
          danger={actionModal.danger}
          onConfirm={(note) => handleAction(note)}
          onClose={() => setActionModal(null)}
        />
      )}

      <AuditHistoryDrawer open={auditOpen} entityType={auditEntityTypeFor(docType)} entityId={documentId ?? undefined} onClose={() => setAuditOpen(false)} />
    </div>
  );
}
