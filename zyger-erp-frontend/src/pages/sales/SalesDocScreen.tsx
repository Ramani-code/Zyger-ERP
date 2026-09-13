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
import { formatNumber, todayISO } from '../../utils/format';
import { getApiErrorMessage } from '../../utils/apiError';
import { useToast } from '../../contexts/ToastContext';
import StatusBadge from '../../components/common/StatusBadge';
import ConfirmActionModal from '../../components/common/ConfirmActionModal';
import AuditHistoryDrawer from '../../components/common/AuditHistoryDrawer';
import { auditEntityTypeFor } from '../../utils/auditEntity';
import axiosClient from '../../api/axiosClient';
import { salesApi } from '../../services/sales-api';
import { lookupDocumentByNumber } from '../../utils/documentLookup';
import { logSystemActivity } from '../../utils/activityLog';
import { exportToCsv } from '../../utils/csvExport';

const PAGE_SIZE = 10;

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
  const [customerMasters, setCustomerMasters] = useState<Array<{ id: number; name: string; code: string; billingAddress?: string; shippingAddress?: string; address?: string; city?: string; state?: string; pincode?: string; addressesJson?: string; deliveryAddressesJson?: string }>>([]);
  const [itemMasters, setItemMasters] = useState<Array<{ id: number; name: string; code: string; uom?: string; price?: number; description?: string; active?: boolean }>>([]);
  const [uomMasters, setUomMasters] = useState<Array<{ id: number; code: string; name: string }>>([]);

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

    // Load master items (inventory items for sale)
    axiosClient.get('/master/items?size=500').then((res) => {
      const data = res.data?.content || res.data || [];
      const items = (Array.isArray(data) ? data : []).map((it: any) => ({
        id: it.id,
        code: it.code,
        name: it.description || it.name || '',
        uom: it.uom || 'NOS',
        price: it.sellingRate || it.defaultRate || 0,
        description: it.description || '',
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

    // Load active sales orders
    axiosClient.get('/v1/sales/sales-order?size=100').then((res) => {
      const content = res.data?.content || res.data || [];
      if (Array.isArray(content) && content.length > 0) {
        setSalesOrderList(content);
      } else {
        setSalesOrderList([
          {
            docNo: 'SO-2026-0001',
            date: '2026-02-12',
            customer: 'ABC Engineering Ltd',
            customerCode: 'CUST-001',
            customerPoNumber: 'PO-7882',
            salesPerson: 'Ravi Teja',
            currency: 'INR - Indian Rupee',
            paymentTerms: '30 Days',
            deliveryTerms: 'EXW - Ex Works',
            billingAddress: 'Plot 45, GIDC Industrial Estate, Rajkot, Gujarat',
            shippingAddress: 'Plot 45, GIDC Industrial Estate, Rajkot, Gujarat',
            lines: [
              { lineNo: 1, itemCode: 'ITEM-001', description: 'Precision CNC Shaft 25mm', qty: 250, uom: 'PCS', unitPrice: 450, discount: 0, taxCode: 'GST 18%', taxAmount: 20250, netAmount: 132750, lineStatus: 'Open' }
            ]
          },
        ]);
      }
    }).catch(() => {
      setSalesOrderList([
        {
          docNo: 'SO-2026-0001',
          date: '2026-02-12',
          customer: 'ABC Engineering Ltd',
          customerCode: 'CUST-001',
          customerPoNumber: 'PO-7882',
          salesPerson: 'Ravi Teja',
          currency: 'INR - Indian Rupee',
          paymentTerms: '30 Days',
          deliveryTerms: 'EXW - Ex Works',
          billingAddress: 'Plot 45, GIDC Industrial Estate, Rajkot, Gujarat',
          shippingAddress: 'Plot 45, GIDC Industrial Estate, Rajkot, Gujarat',
          lines: [
            { lineNo: 1, itemCode: 'ITEM-001', description: 'Precision CNC Shaft 25mm', qty: 250, uom: 'PCS', unitPrice: 450, discount: 0, taxCode: 'GST 18%', taxAmount: 20250, netAmount: 132750, lineStatus: 'Open' }
          ]
        },
      ]);
    });

    // Load proforma invoices
    axiosClient.get('/v1/sales/proforma-invoice?size=100').then((res) => {
      const content = res.data?.content || res.data || [];
      if (Array.isArray(content) && content.length > 0) {
        setProformaInvoiceList(content);
      } else {
        setProformaInvoiceList([
          {
            docNo: 'PI-2026-0001',
            salesOrderNumber: 'SO-2026-0001',
            customer: 'ABC Engineering Ltd',
          }
        ]);
      }
    }).catch(() => {
      setProformaInvoiceList([
        {
          docNo: 'PI-2026-0001',
          salesOrderNumber: 'SO-2026-0001',
          customer: 'ABC Engineering Ltd',
        }
      ]);
    });

    // Load active sales DCs
    axiosClient.get('/v1/sales/sales-dc?size=100').then((res) => {
      const content = res.data?.content || res.data || [];
      if (Array.isArray(content) && content.length > 0) {
        setSalesDcList(content);
      } else {
        setSalesDcList([
          {
            docNo: 'SDC-2026-0001',
            date: '2026-02-14',
            customer: 'ABC Engineering Ltd',
            customerCode: 'CUST-001',
            salesOrderNumber: 'SO-2026-0001',
            customerPoNumber: 'PO-7882',
            lines: [
              { lineNo: 1, itemCode: 'ITEM-001', description: 'Precision CNC Shaft 25mm', dispatchQty: 250, batchNumber: 'BT-101', heatNumber: 'HT-501' },
              { lineNo: 2, itemCode: 'ITEM-002', description: 'High Tensile Bolt M12', dispatchQty: 500, batchNumber: 'BT-102', heatNumber: 'HT-502' }
            ]
          },
          {
            docNo: 'SDC-2026-0002',
            date: '2026-02-15',
            customer: 'Precision Auto Tech',
            customerCode: 'CUST-002',
            salesOrderNumber: 'SO-2026-0002',
            customerPoNumber: 'PO-9102',
            lines: [
              { lineNo: 1, itemCode: 'ITEM-003', description: 'Hydraulic Flange Ring', dispatchQty: 100, batchNumber: 'BT-103', heatNumber: 'HT-503' }
            ]
          }
        ]);
      }
    }).catch(() => {
      setSalesDcList([
        {
          docNo: 'SDC-2026-0001',
          date: '2026-02-14',
          customer: 'ABC Engineering Ltd',
          customerCode: 'CUST-001',
          salesOrderNumber: 'SO-2026-0001',
          customerPoNumber: 'PO-7882',
          lines: [
            { lineNo: 1, itemCode: 'ITEM-001', description: 'Precision CNC Shaft 25mm', dispatchQty: 250, batchNumber: 'BT-101', heatNumber: 'HT-501' },
            { lineNo: 2, itemCode: 'ITEM-002', description: 'High Tensile Bolt M12', dispatchQty: 500, batchNumber: 'BT-102', heatNumber: 'HT-502' }
          ]
        },
        {
          docNo: 'SDC-2026-0002',
          date: '2026-02-15',
          customer: 'Precision Auto Tech',
          customerCode: 'CUST-002',
          salesOrderNumber: 'SO-2026-0002',
          customerPoNumber: 'PO-9102',
          lines: [
            { lineNo: 1, itemCode: 'ITEM-003', description: 'Hydraulic Flange Ring', dispatchQty: 100, batchNumber: 'BT-103', heatNumber: 'HT-503' }
          ]
        }
      ]);
    });

    // Load active sales invoices
    axiosClient.get('/v1/sales/sales-invoice?size=100').then((res) => {
      const content = res.data?.content || res.data || [];
      if (Array.isArray(content) && content.length > 0) {
        setSalesInvoiceList(content);
      } else {
        setSalesInvoiceList([
          {
            docNo: 'INV-2026-0001',
            date: '2026-02-16',
            salesOrderNumber: 'SO-2026-0001',
            customer: 'ABC Engineering Ltd',
            customerCode: 'CUST-001',
            customerPoNumber: 'PO-7882',
            piNumber: 'PI-2026-0001',
            piReference: 'PI-2026-0001',
            currency: 'INR - Indian Rupee',
            paymentTerms: '30 Days',
            deliveryTerms: 'EXW - Ex Works',
            billingAddress: 'Plot 45, GIDC Industrial Estate, Rajkot, Gujarat',
            shippingAddress: 'Plot 45, GIDC Industrial Estate, Rajkot, Gujarat',
            lines: [
              { lineNo: 1, itemCode: 'ITEM-001', description: 'Precision CNC Shaft 25mm', billedQty: 250, qty: 250, uom: 'PCS', unitPrice: 450, batchNumber: 'BT-101', heatNumber: 'HT-501' },
              { lineNo: 2, itemCode: 'ITEM-002', description: 'High Tensile Bolt M12', billedQty: 500, qty: 500, uom: 'NOS', unitPrice: 85, batchNumber: 'BT-102', heatNumber: 'HT-502' }
            ]
          },
          {
            docNo: 'INV-2026-0002',
            date: '2026-02-17',
            salesOrderNumber: 'SO-2026-0002',
            customer: 'Precision Auto Tech',
            customerCode: 'CUST-002',
            customerPoNumber: 'PO-9102',
            piNumber: 'PI-2026-0002',
            piReference: 'PI-2026-0002',
            currency: 'INR - Indian Rupee',
            paymentTerms: '15 Days',
            deliveryTerms: 'FOB - Free on Board',
            billingAddress: '302 Park Road, Ambattur Industrial Estate, Chennai, Tamil Nadu',
            shippingAddress: '302 Park Road, Ambattur Industrial Estate, Chennai, Tamil Nadu',
            lines: [
              { lineNo: 1, itemCode: 'ITEM-003', description: 'Hydraulic Flange Ring', billedQty: 100, qty: 100, uom: 'PCS', unitPrice: 1250, batchNumber: 'BT-103', heatNumber: 'HT-503' }
            ]
          }
        ]);
      }
    }).catch(() => {
      setSalesInvoiceList([
        {
          docNo: 'INV-2026-0001',
          date: '2026-02-16',
          salesOrderNumber: 'SO-2026-0001',
          customer: 'ABC Engineering Ltd',
          customerCode: 'CUST-001',
          customerPoNumber: 'PO-7882',
          piNumber: 'PI-2026-0001',
          piReference: 'PI-2026-0001',
          currency: 'INR - Indian Rupee',
          paymentTerms: '30 Days',
          deliveryTerms: 'EXW - Ex Works',
          billingAddress: 'Plot 45, GIDC Industrial Estate, Rajkot, Gujarat',
          shippingAddress: 'Plot 45, GIDC Industrial Estate, Rajkot, Gujarat',
          lines: [
            { lineNo: 1, itemCode: 'ITEM-001', description: 'Precision CNC Shaft 25mm', billedQty: 250, qty: 250, uom: 'PCS', unitPrice: 450, batchNumber: 'BT-101', heatNumber: 'HT-501' },
            { lineNo: 2, itemCode: 'ITEM-002', description: 'High Tensile Bolt M12', billedQty: 500, qty: 500, uom: 'NOS', unitPrice: 85, batchNumber: 'BT-102', heatNumber: 'HT-502' }
          ]
        },
        {
          docNo: 'INV-2026-0002',
          date: '2026-02-17',
          salesOrderNumber: 'SO-2026-0002',
          customer: 'Precision Auto Tech',
          customerCode: 'CUST-002',
          customerPoNumber: 'PO-9102',
          piNumber: 'PI-2026-0002',
          piReference: 'PI-2026-0002',
          currency: 'INR - Indian Rupee',
          paymentTerms: '15 Days',
          deliveryTerms: 'FOB - Free on Board',
          billingAddress: '302 Park Road, Ambattur Industrial Estate, Chennai, Tamil Nadu',
          shippingAddress: '302 Park Road, Ambattur Industrial Estate, Chennai, Tamil Nadu',
          lines: [
            { lineNo: 1, itemCode: 'ITEM-003', description: 'Hydraulic Flange Ring', billedQty: 100, qty: 100, uom: 'PCS', unitPrice: 1250, batchNumber: 'BT-103', heatNumber: 'HT-503' }
          ]
        }
      ]);
    });
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
    setLines(Array.isArray(doc.lines) ? (doc.lines as Array<Record<string, unknown>>).map((l, i) => ({ lineNo: i + 1, ...l, description: String(l.description || l.itemName || l.itemDesc || '') })) : []);
  }, [documentQuery.data, documentId, initializedForId]);

  const doc = documentQuery.data;
  const genericStatus = String(doc?.status ?? 'DRAFT');
  const editable = !isViewOnly && (!documentId || ['DRAFT', 'REJECTED'].includes(genericStatus));
  const isBusy = createMutation.isPending || updateMutation.isPending || actionMutation.isPending || deleteMutation.isPending;

  const rows = listQuery.data?.content ?? [];
  const totalElements = listQuery.data?.totalElements ?? rows.length;
  const totalPages = listQuery.data?.totalPages ?? 1;

  const openForm = (id: string | null, _view: boolean) => {
    setDocumentId(id);
    const dateToday = todayISO();
    const initialCode = id ? '' : (nextNumberQuery.data?.nextNumber || '');
    const defaultCust = customerMasters[0] || { name: 'ABC Engineering Ltd', code: 'CUST-001' };

    setForm({
      date: dateToday,
      docNo: initialCode,
      customer: defaultCust.name,
      customerCode: defaultCust.code,
      salesPerson: 'Sanjay Kumar',
      customerPoNumber: '',
      currency: 'INR - Indian Rupee',
      exchangeRate: 1.00,
      paymentTerms: '30 Days',
      deliveryTerms: 'EXW - Ex Works',
      billingAddress: 'Plot 45, GIDC Industrial Estate, Rajkot, Gujarat',
      shippingAddress: 'Plot 45, GIDC Industrial Estate, Rajkot, Gujarat',
      ...(config.typeFilter && defaultType ? { [config.typeFilter.field]: defaultType } : {})
    });
    setLines([]);
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
            setLines(doc.lines.map((l: any, i: number) => {
              const qty = Number(l.qty || l.dispatchQty || 0);
              return {
                lineNo: i + 1,
                itemCode: l.itemCode || '',
                description: l.description || l.itemDesc || '',
                batchNumber: l.batchNo || l.batchNumber || '',
                heatNumber: l.heatNo || l.heatNumber || '',
                serialNumber: l.serialNumber || '',
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
      setLines(selectedDC.lines.map((l: any, i: number) => {
        const qty = Number(l.dispatchQty ?? l.currentDispatchQty ?? l.qty ?? 0);
        return {
          lineNo: i + 1,
          itemCode: l.itemCode || '',
          description: l.description || l.itemName || l.itemDesc || '',
          batchNumber: l.batchNumber || l.batchNo || '',
          heatNumber: l.heatNumber || l.heatNo || '',
          serialNumber: l.serialNumber || '',
          currentReturnQty: qty,
          acceptedQty: qty,
          rejectedQty: 0,
          disposition: 'Return to Stock',
          lineRemark: l.lineRemark || l.remarks || '',
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

        let taxPct = 18;
        const tc = String(l.taxCode || l.tax || 'GST 18%');
        if (tc.includes('28%')) taxPct = 28;
        else if (tc.includes('12%')) taxPct = 12;
        else if (tc.includes('5%')) taxPct = 5;
        else if (tc.includes('Exempt')) taxPct = 0;

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

  const handleInvoiceSelectForDC = (invoiceNo: string) => {
    const selectedInvoice = salesInvoiceList.find(inv => inv.docNo === invoiceNo);
    if (!selectedInvoice) {
      if (invoiceNo) {
        void lookupDocumentByNumber('sales-invoice', invoiceNo).then((doc) => {
          if (!doc) return;
          setForm(prev => ({
            ...prev,
            salesInvoiceNumber: invoiceNo,
            salesOrderNumber: doc.salesOrderNo || doc.raw?.salesOrderNumber || prev.salesOrderNumber,
            customer: doc.customer || doc.party || prev.customer,
            customerCode: doc.supplier || doc.customer || prev.customerCode,
            customerPoNumber: doc.raw?.customerPoNumber || prev.customerPoNumber,
            piReference: doc.raw?.piNumber || doc.raw?.piReference || prev.piReference,
            shippingAddress: doc.raw?.shippingAddress || prev.shippingAddress,
            billingAddress: doc.raw?.billingAddress || prev.billingAddress,
          }));

          if (Array.isArray(doc.lines) && doc.lines.length > 0) {
            setLines(doc.lines.map((l: any, i: number) => {
              const qty = Number(l.qty || l.billedQty || l.dispatchQty || 0);
              return {
                lineNo: i + 1,
                itemCode: l.itemCode || '',
                description: l.description || l.itemName || l.itemDesc || '',
                qty: qty,
                dispatchQty: qty,
                uom: l.uom || 'PCS',
                batchNumber: l.batchNo || l.batchNumber || '',
                heatNumber: l.heatNo || l.heatNumber || '',
                serialNumber: l.serialNumber || '',
                unitPrice: l.unitPrice || l.rate || 0,
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
      salesInvoiceNumber: invoiceNo,
      salesOrderNumber: selectedInvoice.salesOrderNumber || prev.salesOrderNumber,
      customer: selectedInvoice.customer || selectedInvoice.party || prev.customer,
      customerCode: selectedInvoice.customerCode || prev.customerCode,
      customerPoNumber: selectedInvoice.customerPoNumber || prev.customerPoNumber,
      piReference: selectedInvoice.piNumber || selectedInvoice.piReference || prev.piReference,
      currency: selectedInvoice.currency || prev.currency,
      paymentTerms: selectedInvoice.paymentTerms || prev.paymentTerms,
      deliveryTerms: selectedInvoice.deliveryTerms || prev.deliveryTerms,
      billingAddress: selectedInvoice.billingAddress || prev.billingAddress,
      shippingAddress: selectedInvoice.shippingAddress || prev.shippingAddress,
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

        return {
          lineNo: i + 1,
          itemCode: l.itemCode || '',
          description: l.description || l.itemName || l.itemDesc || '',
          qty: qty,
          dispatchQty: qty,
          uom: l.uom || 'NOS',
          batchNumber: batchNumber,
          heatNumber: heatNumber,
          serialNumber: l.serialNumber || '',
          unitPrice: price,
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
        const item = itemMasters.find(i => i.code === value);
        if (item) {
          row.description = item.description || item.name || '';
          row.uom = item.uom || 'PCS';
          if (item.price) row.unitPrice = item.price;
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

      let taxPct = 18;
      const tc = String(row.taxCode || 'GST 18%');
      if (tc.includes('28%')) taxPct = 28;
      else if (tc.includes('12%')) taxPct = 12;
      else if (tc.includes('5%')) taxPct = 5;
      else if (tc.includes('Exempt')) taxPct = 0;

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
      { lineNo: prev.length + 1, itemCode: '', description: '', qty: 0, uom: 'NOS', unitPrice: 0, discount: 0, taxCode: 'GST 18%', taxAmount: 0, netAmount: 0, lineStatus: 'Open' }
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

  const handleSave = async (e?: React.FormEvent) => {
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

      logSystemActivity({
        module: 'Sales',
        activity: `${config.title} (${savedRes?.docNo || form.docNo || 'Document'})`,
        refNo: savedRes?.docNo || form.docNo || '',
        party: String(form.customer || form.party || 'Customer'),
        user: user?.username || 'Unknown',
        status: savedRes?.status || 'APPROVED',
      });

      backToList();
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
      backToList();
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
          {editable && (
            <button
              onClick={() => handleSave()}
              disabled={isBusy}
              className="btn btn-p"
            >
              <span className="material-symbols-rounded">save</span>
              {isBusy ? 'Saving...' : 'Save Document'}
            </button>
          )}
          {documentId && editable && (
            <button
              onClick={() => setActionModal({ action: 'submit', danger: false })}
              className="btn btn-g"
            >
              <span className="material-symbols-rounded">send</span>
              Submit
            </button>
          )}
          {documentId && ['SUBMITTED', 'PENDING_TIER1', 'PENDING_TIER2', 'PENDING_TIER3'].includes(String(form.status)) && can('sales', 'Approve') && (
            <button
              onClick={() => setActionModal({ action: 'approve', danger: false })}
              className="btn btn-p"
            >
              <span className="material-symbols-rounded">check_circle</span>
              Approve{String(form.status).startsWith('PENDING_TIER') ? ` (${String(form.status).replace('PENDING_', '')})` : ''}
            </button>
          )}
          {documentId && ['SUBMITTED', 'PENDING_TIER1', 'PENDING_TIER2', 'PENDING_TIER3'].includes(String(form.status)) && (
            <button
              onClick={() => setActionModal({ action: 'reject', danger: true })}
              className="btn btn-d"
            >
              <span className="material-symbols-rounded">cancel</span>
              Reject
            </button>
          )}
          {documentId && String(form.status) === 'REJECTED' && (
            <button
              onClick={() => setActionModal({ action: 'reopen', danger: false })}
              className="btn btn-g"
            >
              <span className="material-symbols-rounded">restart_alt</span>
              Reopen
            </button>
          )}
          {documentId && String(form.status) === 'APPROVED' && (
            <button
              onClick={() => setActionModal({ action: 'post', danger: false })}
              className="btn btn-p"
            >
              <span className="material-symbols-rounded">task_alt</span>
              Post
            </button>
          )}
          {documentId && ['DRAFT', 'SUBMITTED', 'PENDING_TIER1', 'PENDING_TIER2', 'PENDING_TIER3', 'APPROVED', 'CONFIRMED', 'POSTED', 'RECEIVED'].includes(String(form.status)) && (
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

            // 2nd Header Input Field (SO Number Select Option)
            if (field.key === 'salesOrderNumber') {
              return (
                <div key={field.key} className="fld">
                  <span>
                    3. SO Number (Select Option) <em className="req">*</em>
                  </span>
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

            // Sales Invoice Number Select (for Sales DC)
            if (field.key === 'salesInvoiceNumber') {
              return (
                <div key={field.key} className="fld">
                  <span>2. Sales Invoice Number (Select Option)</span>
                  <select
                    disabled={!editable}
                    value={String(val)}
                    onChange={(e) => handleInvoiceSelectForDC(e.target.value)}
                    className="in"
                    style={{ fontWeight: 700, color: '#1e3a8a' }}
                  >
                    <option value="">-- Select Sales Invoice --</option>
                    {salesInvoiceList.map((inv: any) => (
                      <option key={inv.docNo} value={inv.docNo}>
                        {inv.docNo} - {inv.customer || 'Customer'} ({inv.date})
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
                    disabled={!editable}
                    value={String(val)}
                    onChange={(e) => handleCustomerSelect(e.target.value)}
                    className="in"
                  >
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
                      <th key={f.key}>{f.label}</th>
                    ))}
                    {editable && <th style={{ textAlign: 'right' }}>Remove</th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={idx}>
                      {config.lines!.fields.map((f) => {
                        const cellVal = line[f.key] ?? '';

                        // Column 2 Master Item Lookup Select
                        if (f.colNo === 2 || f.type === 'lookup') {
                          return (
                            <td key={f.key} className="w-i">
                              <select
                                disabled={!editable}
                                value={String(cellVal)}
                                onChange={(e) => handleLineItemChange(idx, f.key, e.target.value)}
                                className="in"
                                style={{ fontWeight: 700, color: '#1e3a8a' }}
                              >
                                <option value="">-- Select Item --</option>
                                {itemMasters.filter(it => it.active !== false).map((item) => (
                                  <option key={item.id} value={item.code}>
                                    {item.code} - {item.description || item.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                          );
                        }

                        // UOM Master Lookup Select
                        if (f.key === 'uom') {
                          return (
                            <td key={f.key}>
                              <select
                                disabled={!editable}
                                value={String(cellVal)}
                                onChange={(e) => handleLineItemChange(idx, f.key, e.target.value)}
                                className="in"
                              >
                                <option value="">-- UOM --</option>
                                {uomMasters.map((u) => (
                                  <option key={u.id} value={u.code}>
                                    {u.code} - {u.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                          );
                        }

                        if (f.type === 'select') {
                          return (
                            <td key={f.key}>
                              <select
                                disabled={!editable || f.readOnly}
                                value={String(cellVal)}
                                onChange={(e) => handleLineItemChange(idx, f.key, e.target.value)}
                                className="in"
                              >
                                {(f.options || []).map((o) => (
                                  <option key={o} value={o}>{o}</option>
                                ))}
                              </select>
                            </td>
                          );
                        }

                        return (
                          <td key={f.key}>
                            <input
                              type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                              disabled={!editable || f.readOnly}
                              value={String(cellVal)}
                              onChange={(e) => handleLineItemChange(idx, f.key, e.target.value)}
                              className="in"
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
        {editable && (
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
