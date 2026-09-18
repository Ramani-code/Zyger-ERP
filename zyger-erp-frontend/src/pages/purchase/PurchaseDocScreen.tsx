import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useFormValidation } from '../../hooks/useFormValidation';
import SearchableItemLookup from '../../components/common/SearchableItemLookup';
import {
  usePurchaseDoc,
  usePurchaseDocAction,
  usePurchaseDocCreate,
  usePurchaseDocDelete,
  usePurchaseDocList,
  usePurchaseDocNextNumber,
  usePurchaseDocUpdate,
  useSendEnquiryEmail,
  useSendPoEmail,
  useSendJoEmail,
} from '../../hooks/usePurchaseDocs';
import type { DocScreenConfig } from './purchaseDocConfigs';
import { formatNumber, todayISO } from '../../utils/format';
import { getApiErrorMessage } from '../../utils/apiError';
import { useToast } from '../../contexts/ToastContext';
import StatusBadge from '../../components/common/StatusBadge';
import ConfirmActionModal from '../../components/common/ConfirmActionModal';
import AuditHistoryDrawer from '../../components/common/AuditHistoryDrawer';
import { auditEntityTypeFor } from '../../utils/auditEntity';
import axiosClient from '../../api/axiosClient';
import { purchaseApi } from '../../services/purchase-api';
import { lookupDocumentByNumber } from '../../utils/documentLookup';
import { logSystemActivity } from '../../utils/activityLog';
import { exportToCsv } from '../../utils/csvExport';
import { filterPurchaseRelevantItems } from '../../utils/itemClassification';

const PAGE_SIZE = 10;

export interface PurchaseDocScreenProps {
  config: DocScreenConfig;
  initialDocId?: string | number;
  viewOnly?: boolean;
  defaultType?: string;
  prefill?: {
    supplier?: string;
    poNumber?: string;
    itemCode?: string;
    orderQty?: number;
    scheduledDate?: string;
  };
}

type ActionModal = { action: 'submit' | 'approve' | 'reject' | 'reopen' | 'cancel'; danger: boolean };

function SearchableDocLookup({
  value,
  onChange,
  disabled,
  options,
  placeholder,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  options: Array<{ value: string; label: string; sublabel?: string }>;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState(value || '');
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateCoords = () => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 2,
        left: rect.left,
        width: Math.max(rect.width, 240),
      });
    }
  };

  useEffect(() => {
    setSearch(value || '');
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleScrollOrResize() {
      if (isOpen) updateCoords();
    }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  const handleFocus = () => {
    updateCoords();
    setIsOpen(true);
  };

  const filtered = options.filter((opt) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      opt.value.toLowerCase().includes(q) ||
      (opt.label && opt.label.toLowerCase().includes(q)) ||
      (opt.sublabel && opt.sublabel.toLowerCase().includes(q))
    );
  });

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={search}
        onFocus={handleFocus}
        onChange={(e) => {
          setSearch(e.target.value);
          onChange(e.target.value);
          updateCoords();
          setIsOpen(true);
        }}
        className="in"
        placeholder={placeholder || 'Type to search...'}
        style={{ fontWeight: 700, color: '#1e3a8a', width: '100%', boxSizing: 'border-box' }}
      />
      {isOpen && !disabled && coords && createPortal(
        <div
          style={{
            position: 'fixed',
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            width: `${coords.width}px`,
            zIndex: 999999,
            maxHeight: '200px',
            overflowY: 'auto',
            backgroundColor: '#ffffff',
            border: '1px solid #94a3b8',
            borderRadius: '6px',
            boxShadow: '0 10px 30px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            boxSizing: 'border-box',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '8px 12px', fontSize: '12px', color: '#94a3b8', textAlign: 'left' }}>
              No matching records
            </div>
          ) : (
            filtered.map((opt) => (
              <div
                key={opt.value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSearch(opt.value);
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                style={{
                  padding: '8px 10px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f1f5f9',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '12px', color: '#1e293b' }}>
                  {opt.value}
                </span>
                {opt.sublabel && (
                  <span style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {opt.sublabel}
                  </span>
                )}
              </div>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

export default function PurchaseDocScreen({ config, initialDocId, viewOnly = false, defaultType, prefill }: PurchaseDocScreenProps) {
  const { toast } = useToast();
  const { user, can } = useAuth();
  const { validate: validateFields, hasError: isFieldError } = useFormValidation();
  const { docType } = config;

  const [mode, setMode] = useState<'list' | 'form'>(initialDocId ? 'form' : 'list');
  const [documentId, setDocumentId] = useState<string | null>(initialDocId ? String(initialDocId) : null);
  const [isViewOnly, setIsViewOnly] = useState(viewOnly);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [lines, setLines] = useState<Array<Record<string, unknown>>>([]);
  const [initializedForId, setInitializedForId] = useState('');
  const [actionModal, setActionModal] = useState<ActionModal | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  // Master dropdown data
  const [supplierMasters, setSupplierMasters] = useState<Array<{ id: number; name: string; code: string; contactPerson?: string; phone?: string; email?: string }>>([]);
  const [itemMasters, setItemMasters] = useState<Array<{ id: number; name: string; code: string; uom?: string; price?: number; description?: string }>>([]);
  const [uomMasters, setUomMasters] = useState<Array<{ id: number; code: string; name: string }>>([]);

  // Company Info Master state for Billing & Shipping addresses
  const [companyInfoMaster, setCompanyInfoMaster] = useState<any>(null);

  useEffect(() => {
    axiosClient.get('/master/company-info').then((res) => {
      if (res.data && Object.keys(res.data).length > 0) setCompanyInfoMaster(res.data);
    }).catch(() => { });
  }, []);

  const getCompanyAddress = (isShipping = false, masterData = companyInfoMaster) => {
    if (!masterData) return '';
    const specificAddr = isShipping ? masterData.deliveryAddress : masterData.registeredAddress;
    const fallbackAddr = isShipping ? masterData.registeredAddress : masterData.deliveryAddress;
    const street = (specificAddr && String(specificAddr).trim()) || (fallbackAddr && String(fallbackAddr).trim()) || [masterData.addressLine1, masterData.addressLine2].filter(Boolean).join(', ');
    
    if (!street) return '';
    
    const parts = [street];
    if (masterData.city && !street.toLowerCase().includes(String(masterData.city).toLowerCase())) {
      parts.push(masterData.city);
    }
    if (masterData.state && !street.toLowerCase().includes(String(masterData.state).toLowerCase())) {
      parts.push(masterData.state);
    }
    if (masterData.pincode && !street.toLowerCase().includes(String(masterData.pincode))) {
      parts.push(masterData.pincode);
    }
    return parts.join(', ');
  };

  useEffect(() => {
    if (companyInfoMaster) {
      setForm(prev => {
        const newBill = prev.billingAddress || getCompanyAddress(false, companyInfoMaster);
        const newShip = prev.shippingAddress || getCompanyAddress(true, companyInfoMaster);
        if (newBill !== prev.billingAddress || newShip !== prev.shippingAddress) {
          return {
            ...prev,
            billingAddress: newBill,
            shippingAddress: newShip,
          };
        }
        return prev;
      });
    }
  }, [companyInfoMaster]);

  // Reference document options for Select Options header fields
  const [prList, setPrList] = useState<Array<Record<string, unknown>>>([]);
  const [enquiryList, setEnquiryList] = useState<Array<Record<string, unknown>>>([]);
  const [quotationList, setQuotationList] = useState<Array<Record<string, unknown>>>([]);
  const [poInwardList, setPoInwardList] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    // Load suppliers
    axiosClient.get('/master/parties?kind=SUPPLIER&size=100').then((res) => {
      const data = res.data?.content || res.data || [];
      if (Array.isArray(data) && data.length > 0) {
        setSupplierMasters(data.map((s: any) => ({
          id: s.id,
          name: s.name || '',
          code: s.code || '',
          contactPerson: s.contactPerson || '',
          phone: s.phone || s.mobile || '',
          email: s.email || '',
        })));
      } else {
        setSupplierMasters([
          { id: 1, name: 'Tata Steel Ltd', code: 'SUPP-001', contactPerson: 'Ramesh Patel', phone: '+91 98765 43210', email: 'sales@tatasteel.com' },
          { id: 2, name: 'Apex Industrial Fasteners', code: 'SUPP-002', contactPerson: 'Suresh Shah', phone: '+91 98250 12345', email: 'info@apexfasteners.com' },
          { id: 3, name: 'Bharat Forge Tools', code: 'SUPP-003', contactPerson: 'Vikram Singh', phone: '+91 94260 67890', email: 'contact@bharatforge.com' },
          { id: 4, name: 'Precision Heat Treaters', code: 'SUPP-004', contactPerson: 'Anil Mehta', phone: '+91 98980 11223', email: 'orders@precisionht.com' },
        ]);
      }
    }).catch(() => {
      setSupplierMasters([
        { id: 1, name: 'Tata Steel Ltd', code: 'SUPP-001', contactPerson: 'Ramesh Patel', phone: '+91 98765 43210', email: 'sales@tatasteel.com' },
        { id: 2, name: 'Apex Industrial Fasteners', code: 'SUPP-002', contactPerson: 'Suresh Shah', phone: '+91 98250 12345', email: 'info@apexfasteners.com' },
        { id: 3, name: 'Bharat Forge Tools', code: 'SUPP-003', contactPerson: 'Vikram Singh', phone: '+91 94260 67890', email: 'contact@bharatforge.com' },
        { id: 4, name: 'Precision Heat Treaters', code: 'SUPP-004', contactPerson: 'Anil Mehta', phone: '+91 98980 11223', email: 'orders@precisionht.com' },
      ]);
    });

    // Load master items (Purchasable, Customer Supplied, Manufacturing)
    axiosClient.get('/master/items?size=500').then((res) => {
      const data = res.data?.content || res.data || [];
      if (Array.isArray(data) && data.length > 0) {
        const filtered = filterPurchaseRelevantItems(data);

        setItemMasters(filtered.map((i: any) => ({
          id: i.id,
          code: i.code || '',
          name: i.name || i.description || i.code || '',
          description: i.description && i.description !== i.name ? i.description : '',
          uom: i.uom || i.purchaseUom || 'PCS',
          price: Number(i.defaultRate || i.price || 0)
        })));
      } else {
        setItemMasters([
          { id: 1, code: 'PIT-2026-0001', name: 'Precision CNC Shaft 25mm', uom: 'PCS', price: 450, description: 'Purchasable Item' },
          { id: 2, code: 'CSM-2026-0001', name: 'Customer Provided Casing', uom: 'NOS', price: 0, description: 'Customer Supplied Item' },
          { id: 3, code: 'MFG-2026-0001', name: 'Assembled Motor Unit 5HP', uom: 'NOS', price: 12500, description: 'Manufacturing Item' },
        ]);
      }
    }).catch(() => {
      setItemMasters([
        { id: 1, code: 'PIT-2026-0001', name: 'Precision CNC Shaft 25mm', uom: 'PCS', price: 450, description: 'Purchasable Item' },
        { id: 2, code: 'CSM-2026-0001', name: 'Customer Provided Casing', uom: 'NOS', price: 0, description: 'Customer Supplied Item' },
        { id: 3, code: 'MFG-2026-0001', name: 'Assembled Motor Unit 5HP', uom: 'NOS', price: 12500, description: 'Manufacturing Item' },
      ]);
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

    // Load POSTED PO Inwards (Purchase Return's reference lookup) — only needed on that screen.
    if (config.docType === 'purchase-return') {
      axiosClient.get('/inventory/documents/po-inward?size=200&status=POSTED').then((res) => {
        const content = res.data?.content || res.data || [];
        setPoInwardList(Array.isArray(content) ? content : []);
      }).catch(() => setPoInwardList([]));
    }

    // Load active PRs
    axiosClient.get('/v1/purchase/purchase-request?size=100').then((res) => {
      const content = res.data?.content || res.data || [];
      if (Array.isArray(content) && content.length > 0) setPrList(content);
      else setPrList([{ docNo: 'PR-2026-0001', date: '2026-02-10', requestingDepartment: 'Production', requestBy: 'Ramesh Kumar', lines: [{ lineNo: 1, itemCode: 'ITEM-001', description: 'Precision CNC Shaft 25mm', qty: 250, uom: 'PCS' }] }]);
    }).catch(() => {
      setPrList([{ docNo: 'PR-2026-0001', date: '2026-02-10', requestingDepartment: 'Production', requestBy: 'Ramesh Kumar', lines: [{ lineNo: 1, itemCode: 'ITEM-001', description: 'Precision CNC Shaft 25mm', qty: 250, uom: 'PCS' }] }]);
    });

    // Load active Enquiries
    axiosClient.get('/v1/purchase/supplier-enquiry?size=100').then((res) => {
      const content = res.data?.content || res.data || [];
      if (Array.isArray(content) && content.length > 0) setEnquiryList(content);
      else setEnquiryList([{ docNo: 'ENQ-2026-0001', date: '2026-02-12', buyer: 'Sanjay Kumar', supplier: 'Tata Steel Ltd', currency: 'INR - Indian Rupee', lines: [{ lineNo: 1, itemCode: 'ITEM-001', description: 'Precision CNC Shaft 25mm', qty: 250, uom: 'PCS' }] }]);
    }).catch(() => {
      setEnquiryList([{ docNo: 'ENQ-2026-0001', date: '2026-02-12', buyer: 'Sanjay Kumar', supplier: 'Tata Steel Ltd', currency: 'INR - Indian Rupee', lines: [{ lineNo: 1, itemCode: 'ITEM-001', description: 'Precision CNC Shaft 25mm', qty: 250, uom: 'PCS' }] }]);
    });

    // Load active Quotations
    axiosClient.get('/v1/purchase/supplier-quotation?size=100').then((res) => {
      const content = res.data?.content || res.data || [];
      if (Array.isArray(content) && content.length > 0) setQuotationList(content);
      else setQuotationList([
        {
          docNo: 'QUOT-2026-0001',
          date: '2026-02-14',
          enquiryNumber: 'ENQ-2026-0001',
          supplier: 'Tata Steel Ltd',
          supplierCode: 'SUPP-001',
          contactPerson: 'Ramesh Patel',
          phone: '+91 98765 43210',
          email: 'sales@tatasteel.com',
          paymentTerms: '30 Days',
          deliveryTerms: 'EXW - Ex Works',
          validUntil: '2026-03-14',
          lines: [
            { lineNo: 1, itemCode: 'ITEM-001', itemName: 'Precision CNC Shaft 25mm', description: 'Ground alloy steel shaft', requiredQty: 250, orderQty: 250, uom: 'PCS', unitPrice: 440, discount: 0, tax: 19800, netAmount: 129800 },
            { lineNo: 2, itemCode: 'ITEM-002', itemName: 'Hex Bolt M12 x 50mm 8.8 Grade', description: 'High tensile zinc plated bolt', requiredQty: 500, orderQty: 500, uom: 'KGS', unitPrice: 115, discount: 0, tax: 10350, netAmount: 67850 }
          ]
        },
        {
          docNo: 'QUOT-2026-0002',
          date: '2026-02-15',
          enquiryNumber: 'ENQ-2026-0002',
          supplier: 'Apex Industrial Fasteners',
          supplierCode: 'SUPP-002',
          contactPerson: 'Suresh Shah',
          phone: '+91 98250 12345',
          email: 'info@apexfasteners.com',
          paymentTerms: '15 Days',
          deliveryTerms: 'FOB - Free on Board',
          validUntil: '2026-03-15',
          lines: [
            { lineNo: 1, itemCode: 'ITEM-003', itemName: 'Carbide Insert WNMG 080408', description: 'Turning insert for CNC', requiredQty: 50, orderQty: 50, uom: 'BOX', unitPrice: 2350, discount: 0, tax: 21150, netAmount: 138650 }
          ]
        }
      ]);
    }).catch(() => {
      setQuotationList([
        {
          docNo: 'QUOT-2026-0001',
          date: '2026-02-14',
          enquiryNumber: 'ENQ-2026-0001',
          supplier: 'Tata Steel Ltd',
          supplierCode: 'SUPP-001',
          contactPerson: 'Ramesh Patel',
          phone: '+91 98765 43210',
          email: 'sales@tatasteel.com',
          paymentTerms: '30 Days',
          deliveryTerms: 'EXW - Ex Works',
          validUntil: '2026-03-14',
          lines: [
            { lineNo: 1, itemCode: 'ITEM-001', itemName: 'Precision CNC Shaft 25mm', description: 'Ground alloy steel shaft', requiredQty: 250, orderQty: 250, uom: 'PCS', unitPrice: 440, discount: 0, tax: 19800, netAmount: 129800 },
            { lineNo: 2, itemCode: 'ITEM-002', itemName: 'Hex Bolt M12 x 50mm 8.8 Grade', description: 'High tensile zinc plated bolt', requiredQty: 500, orderQty: 500, uom: 'KGS', unitPrice: 115, discount: 0, tax: 10350, netAmount: 67850 }
          ]
        },
        {
          docNo: 'QUOT-2026-0002',
          date: '2026-02-15',
          enquiryNumber: 'ENQ-2026-0002',
          supplier: 'Apex Industrial Fasteners',
          supplierCode: 'SUPP-002',
          contactPerson: 'Suresh Shah',
          phone: '+91 98250 12345',
          email: 'info@apexfasteners.com',
          paymentTerms: '15 Days',
          deliveryTerms: 'FOB - Free on Board',
          validUntil: '2026-03-15',
          lines: [
            { lineNo: 1, itemCode: 'ITEM-003', itemName: 'Carbide Insert WNMG 080408', description: 'Turning insert for CNC', requiredQty: 50, orderQty: 50, uom: 'BOX', unitPrice: 2350, discount: 0, tax: 21150, netAmount: 138650 }
          ]
        }
      ]);
    });
  }, []);

  const listQuery = usePurchaseDocList(docType, {
    page,
    size: PAGE_SIZE,
    sort: 'date,desc',
    search: search || undefined,
    status: status || undefined,
    type: defaultType || undefined,
  });

  const nextNumberQuery = usePurchaseDocNextNumber(docType);
  const documentQuery = usePurchaseDoc(docType, mode === 'form' && documentId ? documentId : null);
  const createMutation = usePurchaseDocCreate(docType);
  const updateMutation = usePurchaseDocUpdate(docType);
  const deleteMutation = usePurchaseDocDelete(docType);
  const actionMutation = usePurchaseDocAction(docType);
  const sendEnquiryMutation = useSendEnquiryEmail();
  const sendPoMutation = useSendPoEmail();
  const sendJoMutation = useSendJoEmail();

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

    const docData = { ...doc };
    if (Array.isArray(docData.suppliers) && docData.suppliers.length > 0) {
      const supp0 = docData.suppliers[0] as Record<string, unknown>;
      if (!docData.supplier && supp0.supplierName) docData.supplier = supp0.supplierName;
      if (!docData.supplierCode && supp0.supplierCode) docData.supplierCode = supp0.supplierCode;
      if (!docData.contactPerson && supp0.contactPerson) docData.contactPerson = supp0.contactPerson;
      if (!docData.phone && supp0.phone) docData.phone = supp0.phone;
      if (!docData.email && supp0.email) docData.email = supp0.email;
    }

    if (!docData.billingAddress) {
      docData.billingAddress = getCompanyAddress(false);
    }
    if (!docData.shippingAddress) {
      docData.shippingAddress = getCompanyAddress(true);
    }

    const normalizeLoadedLine = (l: Record<string, unknown>, i: number) => {
      const rawQty = (l.orderQty !== undefined && l.orderQty !== null && l.orderQty !== '')
        ? l.orderQty
        : ((l.requiredQty !== undefined && l.requiredQty !== null && l.requiredQty !== '') ? l.requiredQty : l.qty);
      const qty = Number(rawQty ?? 0);
      const price = Number(l.unitPrice ?? l.rate ?? 0);
      const grossAmount = qty * price;
      const discPct = Number(l.discount ?? 0);
      const discAmt = (grossAmount * discPct) / 100;
      const taxableAmount = grossAmount - discAmt;
      const taxPct = Number(l.tax ?? 0);
      const taxAmt = (taxableAmount * taxPct) / 100;
      const computedNet = taxableAmount + taxAmt;
      const net = (qty > 0 || price > 0) ? computedNet : Number(l.netAmount ?? l.netPrice ?? 0);
      return {
        lineNo: i + 1,
        ...l,
        orderQty: qty,
        requiredQty: qty,
        qty: qty,
        unitPrice: price,
        rate: price,
        discount: discPct,
        discountAmount: discAmt,
        tax: taxPct,
        taxAmount: l.taxAmount !== undefined && l.taxAmount !== null ? Number(l.taxAmount) : taxAmt,
        netPrice: net,
        netAmount: net,
      };
    };

    setForm(docData);
    setLines(Array.isArray(docData.lines) ? (docData.lines as Array<Record<string, unknown>>).map((l, i) => normalizeLoadedLine(l, i)) : []);
  }, [documentQuery.data, documentId, initializedForId]);

  // Auto-fill missing contactPerson/phone/email from supplierMasters when supplier is selected/loaded
  useEffect(() => {
    if (form.supplier && (!form.contactPerson || !form.phone || !form.email) && supplierMasters.length > 0) {
      const found = supplierMasters.find(s => s.name === form.supplier);
      if (found) {
        setForm(prev => ({
          ...prev,
          supplierCode: prev.supplierCode || found.code || '',
          contactPerson: prev.contactPerson || found.contactPerson || '',
          phone: prev.phone || found.phone || '',
          email: prev.email || found.email || '',
        }));
      }
    }
  }, [form.supplier, supplierMasters]);

  useEffect(() => {
    if (prefill) {
      const p = prefill as any;
      setMode('form');
      const dateToday = todayISO();
      const initialCode = nextNumberQuery.data?.nextNumber || '';
      const selectedSuppName = p.supplier || 'Tata Steel Ltd';
      const foundSupp = supplierMasters.find(s => s.name === selectedSuppName || s.code === selectedSuppName);

      setForm({
        date: dateToday,
        docNo: initialCode,
        supplier: selectedSuppName,
        supplierCode: foundSupp?.code || 'SUPP-001',
        contactPerson: foundSupp?.contactPerson || 'Sales Representative',
        phone: foundSupp?.phone || '9876543210',
        email: foundSupp?.email || 'sales@supplier.com',
        buyer: p.buyer || '',
        requestingDepartment: 'Production',
        requestBy: '',
        requiredDate: p.scheduledDate || dateToday,
        closingDate: dateToday,
        quotationValidityDate: dateToday,
        validUntil: docType === 'supplier-quotation' ? '' : dateToday,
        expectedReturnDate: dateToday,
        startDate: dateToday,
        endDate: dateToday,
        paymentTerms: '30 Days',
        deliveryTerms: 'EXW - Ex Works',
        billingAddress: getCompanyAddress(false),
        shippingAddress: getCompanyAddress(true),
        requestType: 'Material',
        jobWorkType: 'Subcontract',
        process: 'Heat Treatment',
        period: 'Monthly',
        targetType: 'Value',
        ...(config.typeFilter && defaultType ? { [config.typeFilter.field]: defaultType } : {})
      });

      const qty = Number(p.scheduledQty ?? p.orderQty ?? p.qty ?? 1);
      const price = Number(p.unitPrice ?? p.rate ?? 100);
      const grossAmount = qty * price;
      const netAmount = grossAmount;

      setLines([
        {
          lineNo: 1,
          itemCode: p.itemCode || 'ITEM-001',
          itemName: p.itemName || p.itemCode || 'Raw Material',
          description: p.description || p.itemName || '',
          specification: p.specification || '',
          materialGrade: '',
          size: '',
          requiredQty: qty,
          orderQty: qty,
          qty: qty,
          uom: p.uom || 'PCS',
          unitPrice: price,
          discount: 0,
          tax: 0,
          netAmount: netAmount,
          netPrice: netAmount,
          requiredDate: p.scheduledDate || dateToday,
          lineStatus: 'Open'
        }
      ]);
    }
  }, [prefill]);

  const doc = documentQuery.data;
  const genericStatus = String(doc?.status ?? 'DRAFT');
  const editable = !isViewOnly && (!documentId || ['DRAFT', 'REJECTED'].includes(genericStatus) || Boolean(config.disableApprovalWorkflow));
  const isBusy = createMutation.isPending || updateMutation.isPending || actionMutation.isPending || deleteMutation.isPending;

  const rows = listQuery.data?.content ?? [];
  const totalElements = listQuery.data?.totalElements ?? rows.length;
  const totalPages = listQuery.data?.totalPages ?? 1;

  const openForm = (id: string | null, _view: boolean) => {
    setDocumentId(id);
    setIsViewOnly(_view);
    setInitializedForId('');

    const normalizeLoadedLine = (l: Record<string, unknown>, i: number) => {
      const qty = Number(l.requiredQty ?? l.orderQty ?? l.qty ?? 0);
      const price = Number(l.unitPrice ?? l.rate ?? 0);
      const grossAmount = qty * price;
      const discPct = Number(l.discount ?? 0);
      const discAmt = (grossAmount * discPct) / 100;
      const taxableAmount = grossAmount - discAmt;
      const taxPct = Number(l.tax ?? 0);
      const taxAmt = (taxableAmount * taxPct) / 100;
      const computedNet = taxableAmount + taxAmt;
      const net = (qty > 0 || price > 0) ? computedNet : Number(l.netPrice ?? l.netAmount ?? 0);
      return {
        lineNo: i + 1,
        ...l,
        taxAmount: l.taxAmount !== undefined && l.taxAmount !== null ? Number(l.taxAmount) : taxAmt,
        netPrice: net,
        netAmount: net,
      };
    };

    if (id) {
      const existing = rows.find((r: any) => String(r.id) === String(id));
      if (existing) {
        const rowData = { ...existing };
        if (Array.isArray(rowData.suppliers) && rowData.suppliers.length > 0) {
          const supp0 = rowData.suppliers[0] as Record<string, unknown>;
          if (!rowData.supplier && supp0.supplierName) rowData.supplier = supp0.supplierName;
          if (!rowData.supplierCode && supp0.supplierCode) rowData.supplierCode = supp0.supplierCode;
          if (!rowData.contactPerson && supp0.contactPerson) rowData.contactPerson = supp0.contactPerson;
          if (!rowData.phone && supp0.phone) rowData.phone = supp0.phone;
          if (!rowData.email && supp0.email) rowData.email = supp0.email;
        }
        if (!rowData.billingAddress) {
          rowData.billingAddress = getCompanyAddress(false);
        }
        if (!rowData.shippingAddress) {
          rowData.shippingAddress = getCompanyAddress(true);
        }
        setForm(rowData);
        if (Array.isArray(rowData.lines)) {
          setLines(rowData.lines.map((l: any, i: number) => normalizeLoadedLine(l, i)));
        }
      }
      setMode('form');
      return;
    }

    const dateToday = new Date().toISOString().split('T')[0];
    const initialCode = nextNumberQuery.data?.nextNumber || '';

    setForm({
      date: dateToday,
      docNo: initialCode,
      supplier: '',
      supplierCode: '',
      contactPerson: '',
      phone: '',
      email: '',
      buyer: user?.username || '',
      requestingDepartment: '',
      requestBy: user?.username || '',
      requiredDate: dateToday,
      closingDate: dateToday,
      quotationValidityDate: dateToday,
      validUntil: docType === 'supplier-quotation' ? '' : dateToday,
      expectedReturnDate: dateToday,
      startDate: dateToday,
      endDate: dateToday,
      paymentTerms: '30 Days',
      deliveryTerms: 'EXW - Ex Works',
      priority: 'Low',
      billingAddress: getCompanyAddress(false),
      shippingAddress: getCompanyAddress(true),
      requestType: 'Material',
      jobWorkType: 'Subcontract',
      process: 'Heat Treatment',
      period: 'Monthly',
      targetType: 'Value',
      ...(config.typeFilter && defaultType ? { [config.typeFilter.field]: defaultType } : {})
    });
    setLines([
      { lineNo: 1, itemCode: '', itemName: '', description: '', specification: '', materialGrade: '', size: '', requiredQty: '', orderQty: '', qty: '', uom: '', unitPrice: '', discount: 0, taxAmount: 0, netAmount: 0, netPrice: 0, requiredDate: '', remarks: '', lineStatus: 'Open' }
    ]);
    setMode('form');
  };

  const backToList = () => {
    setDocumentId(null);
    setInitializedForId('');
    setIsViewOnly(false);
    setMode('list');
  };

  // Select Option Reference Handlers
  const handlePRSelect = async (prNo: string) => {
    if (!prNo) return;
    let selected = prList.find(p => p.docNo === prNo);
    if (selected && selected.id && (!selected.lines || (selected.lines as any[]).length === 0)) {
      try {
        const res = await axiosClient.get(`/v1/purchase/purchase-request/${selected.id}`);
        if (res.data) selected = res.data;
      } catch (e) {
        console.error('Failed to fetch full PR details', e);
      }
    }

    if (selected) {
      setForm(prev => ({
        ...prev,
        purchaseRequestNumber: prNo,
        buyer: docType === 'supplier-enquiry' ? (prev.buyer || '') : (selected?.requestBy || selected?.buyer || prev.buyer),
        requiredDate: selected?.requiredDate || prev.requiredDate,
        quotationValidityDate: selected?.requiredDate || prev.quotationValidityDate,
        requestingDepartment: selected?.requestingDepartment || prev.requestingDepartment,
        requestBy: selected?.requestBy || prev.requestBy,
        remarks: selected?.remarks ? `Ref PR: ${prNo} — ${selected.remarks}` : prev.remarks,
      }));

      const prLines = selected.lines;
      if (Array.isArray(prLines) && prLines.length > 0) {
        setLines(prLines.map((l: any, i: number) => ({
          lineNo: i + 1,
          itemCode: l.itemCode || 'ITEM-001',
          itemName: l.itemName || l.description || l.itemCode || '',
          specification: l.specification || '',
          drawingNumber: l.drawingNumber || '',
          drawingRevision: l.drawingRevision || '',
          requiredQty: Number(l.requiredQty ?? l.qty ?? 1),
          uom: l.uom || 'PCS',
          requiredDeliveryDate: l.requiredDate || selected?.requiredDate || '',
          remarks: l.remarks || '',
        })));
      }
    }
  };

  const handleEnquirySelect = async (enqNo: string) => {
    if (!enqNo) return;
    let selected = enquiryList.find(e => e.docNo === enqNo);
    if (selected && selected.id && (!selected.lines || (selected.lines as any[]).length === 0)) {
      try {
        const res = await axiosClient.get(`/v1/purchase/supplier-enquiry/${selected.id}`);
        if (res.data) selected = res.data;
      } catch (e) {
        console.error('Failed to fetch full Enquiry details', e);
      }
    }

    if (selected) {
      setForm(prev => ({
        ...prev,
        enquiryNumber: enqNo,
        supplier: selected?.supplier || prev.supplier,
        supplierCode: selected?.supplierCode || prev.supplierCode,
        contactPerson: selected?.contactPerson || prev.contactPerson,
        phone: selected?.phone || prev.phone,
        email: selected?.email || prev.email,
        buyer: selected?.buyer || prev.buyer,
        currency: selected?.currency || prev.currency,
        paymentTerms: selected?.paymentTerms || prev.paymentTerms,
        deliveryTerms: selected?.deliveryTerms || prev.deliveryTerms,
        validUntil: docType === 'supplier-quotation' ? prev.validUntil : (selected?.quotationValidityDate || prev.validUntil),
        remarks: selected?.remarks ? `Ref Enquiry: ${enqNo} — ${selected.remarks}` : prev.remarks,
      }));

      const enqLines = selected.lines;
      if (Array.isArray(enqLines) && enqLines.length > 0) {
        setLines(enqLines.map((l: any, i: number) => ({
          lineNo: i + 1,
          itemCode: l.itemCode || 'ITEM-001',
          itemName: l.itemName || l.description || l.itemCode || '',
          description: (l.description && l.description !== l.itemName && l.description !== l.itemCode) ? l.description : '',
          specification: l.specification || '',
          requiredQty: Number(l.requiredQty ?? l.qty ?? 1),
          orderQty: Number(l.requiredQty ?? l.qty ?? 1),
          qty: Number(l.requiredQty ?? l.qty ?? 1),
          uom: l.uom || 'PCS',
          unitPrice: Number(l.unitPrice ?? 0),
          discount: 0,
          tax: 0,
          netPrice: 0,
          netAmount: 0,
          deliveryLeadTime: 7,
          remarks: l.remarks || '',
        })));
      }
    }
  };

  const handleQuotationSelect = async (quotNo: string) => {
    if (!quotNo) return;
    let selected = quotationList.find(q => q.docNo === quotNo);
    if (!selected) {
      void lookupDocumentByNumber('supplier-quotation', quotNo).then((doc) => {
        if (!doc) return;
        const foundSupp = supplierMasters.find(s => s.name === doc.supplier || s.code === doc.supplier);
        const billAddr = getCompanyAddress(false);
        const shipAddr = getCompanyAddress(true);

        setForm(prev => ({
          ...prev,
          quotationNumber: quotNo,
          supplier: doc.supplier || doc.party || prev.supplier,
          supplierCode: doc.supplier || foundSupp?.code || prev.supplierCode,
          contactPerson: doc.raw?.contactPerson || foundSupp?.contactPerson || prev.contactPerson,
          phone: doc.raw?.phone || foundSupp?.phone || prev.phone,
          email: doc.raw?.email || foundSupp?.email || prev.email,
          paymentTerms: doc.raw?.paymentTerms || prev.paymentTerms,
          deliveryTerms: doc.raw?.deliveryTerms || prev.deliveryTerms,
          billingAddress: billAddr,
          shippingAddress: shipAddr,
        }));

        if (Array.isArray(doc.lines) && doc.lines.length > 0) {
          setLines(doc.lines.map((l: any, i: number) => {
            const qty = Number(l.orderQty ?? l.requiredQty ?? l.qty ?? 1);
            const price = Number(l.unitPrice ?? l.rate ?? 0);
            const grossAmount = qty * price;
            const discPct = Number(l.discount ?? 0);
            const discAmt = (grossAmount * discPct) / 100;
            const taxableAmount = grossAmount - discAmt;
            const taxPct = Number(l.tax ?? 0);
            const taxAmt = (taxableAmount * taxPct) / 100;
            const computedNet = taxableAmount + taxAmt;
            const net = (qty > 0 || price > 0) ? computedNet : Number(l.netAmount ?? l.netPrice ?? 0);

            return {
              lineNo: i + 1,
              itemCode: l.itemCode || 'ITEM-001',
              itemName: l.itemName || l.itemDesc || l.description || l.itemCode || '',
              description: l.description || l.itemDesc || l.itemName || '',
              specification: l.specification || '',
              orderQty: qty,
              requiredQty: qty,
              qty: qty,
              uom: l.uom || 'PCS',
              unitPrice: price,
              rate: price,
              discount: discPct,
              discountAmount: discAmt,
              tax: taxPct,
              taxAmount: l.taxAmount !== undefined && l.taxAmount !== null ? Number(l.taxAmount) : taxAmt,
              netAmount: net,
              netPrice: net,
              requiredDate: doc.date || '',
              remarks: l.remarks || '',
            };
          }));
        }
      });
      return;
    }

    if (selected && selected.id && (!selected.lines || (selected.lines as any[]).length === 0)) {
      try {
        const res = await axiosClient.get(`/v1/purchase/supplier-quotation/${selected.id}`);
        if (res.data) selected = res.data;
      } catch (e) {
        console.error('Failed to fetch full Quotation details', e);
      }
    }

    if (selected) {
      const foundSupp = supplierMasters.find(s => s.name === selected.supplier || s.code === selected.supplierCode);
      const billAddr = getCompanyAddress(false);
      const shipAddr = getCompanyAddress(true);

      setForm(prev => ({
        ...prev,
        quotationNumber: quotNo,
        purchaseRequestNumber: selected?.purchaseRequestNumber || selected?.enquiryNumber || prev.purchaseRequestNumber,
        supplier: selected?.supplier || prev.supplier,
        supplierCode: selected?.supplierCode || foundSupp?.code || prev.supplierCode,
        contactPerson: selected?.contactPerson || foundSupp?.contactPerson || prev.contactPerson,
        phone: selected?.phone || foundSupp?.phone || prev.phone,
        email: selected?.email || foundSupp?.email || prev.email,
        buyer: selected?.buyer || prev.buyer || '',
        department: selected?.department || prev.department,
        paymentTerms: selected?.paymentTerms || prev.paymentTerms,
        deliveryTerms: selected?.deliveryTerms || prev.deliveryTerms,
        currency: selected?.currency || prev.currency,
        expectedDeliveryDate: selected?.validUntil || prev.expectedDeliveryDate,
        billingAddress: billAddr,
        shippingAddress: shipAddr,
        remarks: selected?.remarks ? `Ref Quotation: ${quotNo} — ${selected.remarks}` : prev.remarks,
      }));

      const quotLines = selected.lines;
      if (Array.isArray(quotLines) && quotLines.length > 0) {
        setLines(quotLines.map((l: any, i: number) => {
          const qty = Number(l.orderQty ?? l.requiredQty ?? l.qty ?? 1);
          const price = Number(l.unitPrice ?? l.rate ?? 0);
          const grossAmount = qty * price;
          const discPct = Number(l.discount ?? 0);
          const discAmt = (grossAmount * discPct) / 100;
          const taxableAmount = grossAmount - discAmt;
          const taxPct = Number(l.tax ?? 0);
          const taxAmt = (taxableAmount * taxPct) / 100;
          const computedNet = taxableAmount + taxAmt;
          const net = (qty > 0 || price > 0) ? computedNet : Number(l.netAmount ?? l.netPrice ?? 0);

          return {
            lineNo: i + 1,
            itemCode: l.itemCode || 'ITEM-001',
            itemName: l.itemName || l.description || l.itemCode || '',
            description: l.description || l.itemName || '',
            specification: l.specification || '',
            drawingNumber: l.drawingNumber || '',
            drawingRevision: l.drawingRevision || '',
            orderQty: qty,
            requiredQty: qty,
            qty: qty,
            uom: l.uom || 'PCS',
            unitPrice: price,
            rate: price,
            discount: discPct,
            discountAmount: discAmt,
            tax: taxPct,
            taxAmount: l.taxAmount !== undefined && l.taxAmount !== null ? Number(l.taxAmount) : taxAmt,
            netAmount: net,
            netPrice: net,
            requiredDate: selected?.validUntil || '',
            remarks: l.remarks || '',
          };
        }));
      }
    }
  };

  // FRS DOC-PUR-FRS-02 §9 (PUR-07) [ASSUMPTION]: auto-fill only wired for originalDocumentType
  // === 'po-inward' — that's also the tighter server-side over-return guard (checked against
  // actual received qty, not ordered qty). Selecting a Purchase Order as the reference is still
  // allowed but the user enters lines manually; wiring full PO-line auto-fill was out of scope
  // for this pass given the size of the rest of this build.
  const handleOriginalDocSelect = async (docNo: string) => {
    if (!docNo) return;
    const listed = poInwardList.find((d) => d.docNo === docNo) as any;
    let full = listed;
    if (listed?.id) {
      try {
        const res = await axiosClient.get(`/inventory/documents/po-inward/${listed.id}`);
        if (res.data) full = res.data;
      } catch (e) {
        console.error('Failed to fetch full PO Inward details', e);
      }
    }
    if (!full) return;

    const foundSupp = supplierMasters.find((s) => s.name === full.supplier || s.code === full.supplier);
    setForm((prev) => ({
      ...prev,
      originalDocumentNo: docNo,
      supplier: full.supplier || prev.supplier,
      supplierCode: foundSupp?.code || prev.supplierCode,
    }));

    const srcLines = Array.isArray(full.lines) ? full.lines : [];
    if (srcLines.length > 0) {
      setLines(srcLines.map((l: any, i: number) => {
        const receivedQty = Number(l.receivedQty ?? l.qty ?? 0);
        const acceptedQty = Number(l.acceptedQty ?? receivedQty);
        const rate = Number(l.rate ?? 0);
        // Carry the source line's tax rate and store location forward so the return defaults
        // to the same tax the goods were originally bought under, and posts stock-out against
        // the store they actually sit in — the user can still edit either before saving.
        const taxPct = Number(l.tax ?? 0);
        const discPct = Number(l.discount ?? 0);
        const taxableAmount = acceptedQty * rate * (1 - discPct / 100);
        const taxAmt = (taxableAmount * taxPct) / 100;
        return {
          lineNo: i + 1,
          itemCode: l.itemCode || '',
          itemDesc: l.itemDesc || l.description || l.itemCode || '',
          uom: l.uom || '',
          returnQty: acceptedQty,
          qty: acceptedQty,
          rate,
          tax: taxPct,
          taxAmount: taxAmt,
          netAmount: taxableAmount + taxAmt,
          originalReceivedQty: acceptedQty,
          location: l.location || '',
          warehouse: l.warehouse || '',
          batchNo: l.batchNo || '',
          heatNo: l.heatNo || '',
          lotNo: l.lotNo || '',
          reasonCode: '',
        };
      }));
    }
  };

  const handleSupplierSelect = (supplierName: string) => {
    if (!supplierName) {
      setForm(prev => ({
        ...prev,
        supplier: '',
        supplierCode: '',
        contactPerson: '',
        phone: '',
        email: '',
      }));
      return;
    }
    const found = supplierMasters.find(s => s.name === supplierName);
    const code = found?.code || 'SUPP-001';
    const cp = (found as any)?.contactPerson || 'Purchase Manager';
    const ph = (found as any)?.phone || '+91 98765 43210';
    const em = (found as any)?.email || `sales@${supplierName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;

    setForm(prev => ({
      ...prev,
      supplier: supplierName,
      supplierCode: code,
      contactPerson: cp,
      phone: ph,
      email: em,
    }));
  };

  // Line item change & Column Master Item Lookup
  const handleLineItemChange = (index: number, fieldKey: string, value: any) => {
    setLines(prev => {
      const next = [...prev];
      const row = { ...next[index], [fieldKey]: value };

      if (fieldKey === 'itemCode') {
        if (value === 'OTHERS') {
          row.itemName = '';
          row.description = '';
          row.drawingNumber = '';
          row.storeWarehouse = '';
        } else {
          const item = itemMasters.find(i => i.code === value || i.name === value || `${i.code} — ${i.name || i.description || i.code}` === value);
          if (item) {
            row.itemCode = item.code;
            row.itemName = item.name || item.description || item.code;
            row.description = docType === 'supplier-quotation' ? '' : (item.description && item.description !== item.name ? item.description : '');
            if (item.uom) row.uom = item.uom;
            if (item.price) row.unitPrice = item.price;
          }
        }
      }

      // Recalculate row amounts
      // Purchase Return's qty field is 'returnQty' (not 'orderQty'/'requiredQty'/'qty' like
      // every other purchase doc using this screen), so it needs its own branch here — without
      // it, rawQty falls through to the always-blank orderQty/requiredQty/qty fields and the
      // row's amount/tax silently compute as zero regardless of what was typed into Return Qty.
      const rawQty = fieldKey === 'orderQty'
        ? row.orderQty
        : fieldKey === 'requiredQty'
          ? row.requiredQty
          : fieldKey === 'qty'
            ? row.qty
            : fieldKey === 'returnQty'
              ? row.returnQty
              : (row.orderQty ?? row.requiredQty ?? row.qty ?? row.returnQty);
      const qty = Number(rawQty ?? 0);
      row.orderQty = qty;
      row.requiredQty = qty;
      row.qty = qty;
      if (docType === 'purchase-return') row.returnQty = qty;

      const price = Number(row.unitPrice ?? row.rate ?? 0);
      row.unitPrice = price;
      row.rate = price;

      const grossAmount = qty * price;
      const discPct = Number(row.discount ?? 0);
      const discAmt = (grossAmount * discPct) / 100;
      row.discountAmount = discAmt;
      const taxableAmount = grossAmount - discAmt;

      let taxPct = Number(row.tax ?? 0);
      if (row.tax === undefined || row.tax === null || row.tax === '') {
        const tc = String(row.taxCode || 'GST 18%');
        if (tc.includes('28%')) taxPct = 28;
        else if (tc.includes('12%')) taxPct = 12;
        else if (tc.includes('5%')) taxPct = 5;
        else if (tc.includes('Exempt')) taxPct = 0;
        else taxPct = 18;
      }

      const taxAmt = (taxableAmount * taxPct) / 100;
      row.taxAmount = taxAmt;

      const netAmount = taxableAmount + taxAmt;
      row.netAmount = netAmount;
      row.netPrice = netAmount;

      next[index] = row;
      return next;
    });
  };

  const addLine = () => {
    setLines(prev => [
      ...prev,
      {
        lineNo: prev.length + 1,
        itemCode: '',
        itemName: '',
        description: '',
        specification: '',
        materialGrade: '',
        size: '',
        requiredQty: '',
        orderQty: '',
        qty: '',
        uom: '',
        unitPrice: '',
        discount: 0,
        taxAmount: 0,
        netAmount: 0,
        netPrice: 0,
        requiredDate: '',
        remarks: '',
        lineStatus: 'Open'
      }
    ]);
  };

  const removeLine = (index: number) => {
    setLines(prev => prev.filter((_, i) => i !== index).map((l, i) => ({ ...l, lineNo: i + 1 })));
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = { supplierOverride: true, ...form };
    if (config.lines) {
      payload.lines = lines.map(l => ({ ...l }));
      const total = lines.reduce((sum, l) => sum + (Number(l.netAmount ?? l.netPrice ?? l.totalAmount ?? 0)), 0);
      if (total > 0 && !payload.totalAmount) {
        payload.totalAmount = total;
      }
    }
    return payload;
  };

  // Every field/line-column marked with an asterisk (`required: true` in the
  // config) must actually be filled in before a save/submit is allowed — the
  // asterisk was previously only cosmetic text in the label.
  const validate = (): boolean => {
    const errs = validateFields(config.fields, form);
    if (errs.length > 0) { toast(errs[0].message, 'error'); return false; }
    if (config.lines) {
      const requiredLineFields = config.lines.fields.filter((f) => f.required);
      if (requiredLineFields.length > 0) {
        if (lines.length === 0) { toast('At least one line item is required.', 'error'); return false; }
        for (let i = 0; i < lines.length; i++) {
          for (const f of requiredLineFields) {
            const v = lines[i][f.key];
            const str = v == null ? '' : String(v).trim();
            if (!str) {
              toast(`Line ${i + 1}: ${f.label.replace(' *', '')} is required.`, 'error');
              return false;
            }
          }
        }
      }
    }
    return true;
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!validate()) return;
    try {
      const payload = buildPayload();
      let savedRes: any;
      if (documentId) {
        savedRes = await updateMutation.mutateAsync({ id: documentId, payload });
        toast(`${config.title} updated successfully!`, 'success');
      } else {
        savedRes = await createMutation.mutateAsync(payload);
        toast(`${config.title} saved successfully!`, 'success');
      }

      logSystemActivity({
        module: 'Purchase',
        activity: `${config.title} (${savedRes?.docNo || form.docNo || 'Document'})`,
        refNo: savedRes?.docNo || form.docNo || '',
        party: String(form.supplier || form.party || 'Supplier'),
        user: user?.username || 'Unknown',
        status: savedRes?.status || (docType === 'purchase-order' ? 'DRAFT' : 'RELEASED'),
      });
      // Land back on a fresh blank entry form rather than staying on the just-saved
      // document — the same behavior every success path in this screen now follows.
      openForm(null, false);
    } catch (err: any) {
      toast(getApiErrorMessage(err, 'Failed to save purchase document'), 'error');
    }
  };

  // submitOnly doc types (e.g. Purchase Request) skip the separate "Save as
  // Draft" step entirely — a brand-new document is created and immediately
  // transitioned to SUBMITTED in one action, since there's no Approve/Reject
  // stage for a draft to wait in.
  const handleCreateAndSubmit = async () => {
    if (!validate()) return;
    try {
      const payload = buildPayload();
      const savedRes: any = await createMutation.mutateAsync(payload);
      const newId = savedRes && (savedRes.id ?? savedRes.docNo);
      if (newId) {
        await actionMutation.mutateAsync({ id: String(newId), action: 'submit' });
      }
      toast(`${config.title} submitted successfully!`, 'success');
      logSystemActivity({
        module: 'Purchase',
        activity: `${config.title} (${savedRes?.docNo || form.docNo || 'Document'})`,
        refNo: savedRes?.docNo || form.docNo || '',
        party: String(form.supplier || form.party || 'Supplier'),
        user: user?.username || 'Unknown',
        status: 'SUBMITTED',
      });
      openForm(null, false);
    } catch (err: any) {
      toast(getApiErrorMessage(err, 'Failed to submit purchase document'), 'error');
    }
  };

  const handleAction = async () => {
    if (!actionModal || !documentId) return;
    try {
      await actionMutation.mutateAsync({ id: documentId, action: actionModal.action });
      toast(`Purchase Document ${actionModal.action}d successfully!`, 'success');
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
      toast('Purchase Document deleted successfully!', 'success');
      setDeleteTarget(null);
    } catch (err: any) {
      toast(getApiErrorMessage(err, 'Failed to delete purchase document'), 'error');
    }
  };

  // What the backend's send-email endpoint actually persists to the generic
  // `status` field per doc type — must match service/PurchaseService.java
  // - supplier-enquiry: sets status to SENT
  // - purchase-order: sets status to SENT
  // - job-order: doesn't touch status at all — only emailStatus, so leave it
  const isPoMailSent = (r: any): boolean => {
    const st = String(r?.status || '');
    const emailSt = String(r?.emailStatus || '');
    return st === 'SENT' || st === 'MAIL SENT' || st === 'MAIL_SENT' || emailSt === 'SENT' || Boolean(r?.emailSent);
  };

  const getEffectiveStatus = (r: any, dType: string): string => {
    if (dType === 'purchase-order') {
      return isPoMailSent(r) ? 'SENT' : 'DRAFT';
    }
    return String(r?.status || 'DRAFT');
  };

  const handleSendEmail = async () => {
    if (!documentId) return;
    const mutation = mutationForSend();
    if (!mutation) return;
    try {
      const res = await mutation.mutateAsync(documentId) as { sent?: boolean; message?: string } | undefined;
      // The backend returns HTTP 200 even when the email itself failed to send
      // (sent: false, with the real reason in message) — check the payload, not
      // just whether the request succeeded, or a failed send gets reported as a
      // green success toast and the form gets marked SENT anyway.
      if (res?.sent === false) {
        toast(res.message || 'Failed to send email', 'error');
        return;
      }
      toast(res?.message || 'Mail sent successfully!', 'success');
      openForm(null, false);
    } catch (err: any) {
      toast(getApiErrorMessage(err, 'Failed to send email'), 'error');
    }
  };

  const mutationForSend = () => {
    if (docType === 'supplier-enquiry') return sendEnquiryMutation;
    if (docType === 'purchase-order') return sendPoMutation;
    if (docType === 'job-order') return sendJoMutation;
    return null;
  };

  const canSendEmail = ['supplier-enquiry', 'purchase-order', 'job-order'].includes(docType);
  const isMailSent = docType === 'purchase-order' ? isPoMailSent(form) : (String(form.status) === 'SENT' || Boolean(form.emailSent));

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
                  <th style={{ width: '50px', textAlign: 'center' }}>S.No</th>
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
                      Loading purchase documents...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={config.columns.length + 2} className="empty">
                      <span className="material-symbols-rounded">inventory_2</span>
                      No purchase documents found. Click <strong>+ New {config.title}</strong> to create one.
                    </td>
                  </tr>
                ) : (
                  rows.map((row: any, idx: number) => (
                    <tr key={row.id}>
                      <td style={{ textAlign: 'center', fontWeight: 500, color: '#64748b' }}>
                        {page * PAGE_SIZE + idx + 1}
                      </td>
                      {config.columns.map((col) => {
                        let val = row[col.field];
                        if (col.field === 'requestingDepartment' && (val === undefined || val === null || val === '')) {
                          val = row['department'];
                        }
                        if (col.field === 'requestBy' && (val === undefined || val === null || val === '')) {
                          val = row['requestedBy'];
                        }
                        if (col.badge) {
                          return (
                            <td key={col.field}>
                              <StatusBadge status={getEffectiveStatus(row, docType)} />
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
                          title={
                            ['DRAFT', 'REJECTED'].includes(String(row.status))
                              ? 'Delete'
                              : 'Only DRAFT or REJECTED documents can be deleted'
                          }
                          disabled={!['DRAFT', 'REJECTED'].includes(String(row.status))}
                        >
                          <span className="material-symbols-rounded">delete</span>
                        </button>
                        <button
                          onClick={() => purchaseApi.printDocument(docType, row.id, 'download')}
                          className="ibtn"
                          title="Download PDF"
                        >
                          <span className="material-symbols-rounded">download</span>
                        </button>
                        <button
                          onClick={() => purchaseApi.printDocument(docType, row.id, 'print')}
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
              {form.status ? (
                <StatusBadge status={getEffectiveStatus(form, docType)} />
              ) : null}
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
          {editable && !config.hideTopSave && !(config.submitOnly && !documentId) && (
            <button
              onClick={() => handleSave()}
              disabled={isBusy}
              className="btn btn-p"
            >
              <span className="material-symbols-rounded">save</span>
              {isBusy ? 'Saving...' : 'Save Document'}
            </button>
          )}
          {config.submitOnly && !documentId && (
            <button
              onClick={() => handleCreateAndSubmit()}
              disabled={isBusy}
              className="btn btn-g"
            >
              <span className="material-symbols-rounded">send</span>
              {isBusy ? 'Submitting...' : 'Submit'}
            </button>
          )}
          {!config.disableApprovalWorkflow && documentId && (String(form.status) === 'DRAFT' || String(form.status) === 'REJECTED') && (
            <button
              onClick={() => { if (validate()) setActionModal({ action: 'submit', danger: false }); }}
              className="btn btn-g"
            >
              <span className="material-symbols-rounded">send</span>
              Submit
            </button>
          )}
          {!config.disableApprovalWorkflow && !config.submitOnly && documentId && String(form.status) === 'SUBMITTED' && can('purchase', 'Approve') && (
            <>
              <button
                onClick={() => setActionModal({ action: 'approve', danger: false })}
                className="btn btn-p"
              >
                <span className="material-symbols-rounded">check_circle</span>
                Approve
              </button>
              <button
                onClick={() => setActionModal({ action: 'reject', danger: true })}
                className="btn btn-d"
                style={{ backgroundColor: '#dc2626', color: '#fff' }}
              >
                <span className="material-symbols-rounded">cancel</span>
                Reject
              </button>
            </>
          )}
          {!config.disableApprovalWorkflow && !config.submitOnly && documentId && String(form.status) === 'REJECTED' && (
            <button
              onClick={() => setActionModal({ action: 'reopen', danger: false })}
              className="btn btn-g"
            >
              <span className="material-symbols-rounded">restart_alt</span>
              Reopen
            </button>
          )}
          {documentId && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(String(form.status)) && can('purchase', 'Cancel') && (
            <button
              onClick={() => setActionModal({ action: 'cancel', danger: true })}
              className="btn"
              style={{ color: '#dc2626', borderColor: '#fca5a5' }}
            >
              <span className="material-symbols-rounded">block</span>
              Cancel
            </button>
          )}
          {canSendEmail && documentId && (
            <button
              onClick={() => handleSendEmail()}
              disabled={isMailSent || sendEnquiryMutation.isPending || sendPoMutation.isPending || sendJoMutation.isPending || isBusy}
              className={`btn ${isMailSent ? '' : 'btn-p'}`}
              style={isMailSent ? { backgroundColor: '#e2e8f0', color: '#64748b', cursor: 'not-allowed', borderColor: '#cbd5e1' } : undefined}
              title={isMailSent ? 'Mail has been sent' : 'Send document via email'}
            >
              <span className="material-symbols-rounded">{isMailSent ? 'mark_email_read' : 'mail'}</span>
              {sendEnquiryMutation.isPending || sendPoMutation.isPending || sendJoMutation.isPending
                ? 'Sending...'
                : isMailSent
                ? 'Mail Sent'
                : 'Send Mail'}
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

            // Header Document Reference Input Fields with Searchable Lookup
            if (field.key === 'purchaseRequestNumber') {
              const prOptions = prList.map((pr: any) => ({
                value: String(pr.docNo || ''),
                label: String(pr.docNo || ''),
                sublabel: `${pr.requestingDepartment || pr.department || 'Dept'} - ${pr.requestBy || pr.requestedBy || ''}`
              }));
              return (
                <div key={field.key} className="fld">
                  <span>
                    PR Reference {field.required ? <em className="req">*</em> : null}
                  </span>
                  <SearchableDocLookup
                    value={String(val || '')}
                    disabled={!editable}
                    options={prOptions}
                    placeholder="Search PR No or Dept..."
                    onChange={(selectedPrNo) => {
                      setForm((prev) => ({ ...prev, purchaseRequestNumber: selectedPrNo }));
                      handlePRSelect(selectedPrNo);
                    }}
                  />
                </div>
              );
            }

            if (field.key === 'enquiryNumber') {
              const enqOptions = enquiryList.map((enq: any) => ({
                value: String(enq.docNo || ''),
                label: String(enq.docNo || ''),
                sublabel: `${enq.supplier || 'Supplier'} (${enq.date || ''})`
              }));
              return (
                <div key={field.key} className="fld">
                  <span>
                    Enquiry Reference <em className="req">*</em>
                  </span>
                  <SearchableDocLookup
                    value={String(val || '')}
                    disabled={!editable}
                    options={enqOptions}
                    placeholder="Search Enquiry No or Supplier..."
                    onChange={(selectedEnqNo) => {
                      setForm((prev) => ({ ...prev, enquiryNumber: selectedEnqNo }));
                      handleEnquirySelect(selectedEnqNo);
                    }}
                  />
                </div>
              );
            }

            if (field.key === 'quotationNumber') {
              const quotOptions = quotationList.map((q: any) => ({
                value: String(q.docNo || ''),
                label: String(q.docNo || ''),
                sublabel: `${q.supplier || 'Supplier'} (${q.date || ''})`
              }));
              return (
                <div key={field.key} className="fld">
                  <span>
                    Quotation Reference <em className="req">*</em>
                  </span>
                  <SearchableDocLookup
                    value={String(val || '')}
                    disabled={!editable}
                    options={quotOptions}
                    placeholder="Search Quotation No or Supplier..."
                    onChange={(selectedQuotNo) => {
                      setForm((prev) => ({ ...prev, quotationNumber: selectedQuotNo }));
                      handleQuotationSelect(selectedQuotNo);
                    }}
                  />
                </div>
              );
            }

            if (field.key === 'originalDocumentNo') {
              const poiOptions = poInwardList.map((d: any) => ({
                value: String(d.docNo || ''),
                label: String(d.docNo || ''),
                sublabel: `${d.supplier || 'Supplier'} (${d.date || ''})`,
              }));
              return (
                <div key={field.key} className="fld">
                  <span>Original PO Inward *</span>
                  <SearchableDocLookup
                    value={String(val || '')}
                    disabled={!editable}
                    options={poiOptions}
                    placeholder="Search posted PO Inward No or Supplier..."
                    onChange={(selectedDocNo) => {
                      setForm((prev) => ({ ...prev, originalDocumentNo: selectedDocNo }));
                      handleOriginalDocSelect(selectedDocNo);
                    }}
                  />
                </div>
              );
            }

            // Supplier Master Select with Searchable Lookup
            if (field.key === 'supplier') {
              const suppOptions = supplierMasters.map((s) => ({
                value: String(s.name || ''),
                label: String(s.name || ''),
                sublabel: `${s.code}${s.contactPerson ? ` • ${s.contactPerson}` : ''}`,
              }));
              return (
                <div key={field.key} className="fld">
                  <span>
                    {field.label} {field.required ? <em className="req">*</em> : null}
                  </span>
                  <SearchableDocLookup
                    value={String(val || '')}
                    disabled={!editable}
                    options={suppOptions}
                    placeholder="Type to search Supplier..."
                    onChange={(selectedSupplierName) => {
                      handleSupplierSelect(selectedSupplierName);
                    }}
                  />
                </div>
              );
            }

            return (
              <div key={field.key} className={`fld ${field.span2 ? 'span2' : ''} ${isFieldError(field.key) ? 'invalid' : ''}`}>
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
                    {!val && <option value="">{`-- Select ${field.label.replace(' *', '')} --`}</option>}
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
                    <th className="num" style={{ width: '50px' }}>S.No</th>
                    {config.lines.fields.map((f) => (
                      <th key={f.key} style={f.width ? { width: f.width, minWidth: f.width } : undefined}>
                        {f.label}
                      </th>
                    ))}
                    {editable && <th style={{ textAlign: 'right', width: '60px' }}>Remove</th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={idx}>
                      <td className="num mut">{idx + 1}</td>
                      {config.lines!.fields.map((f) => {
                        const cellVal = line[f.key] ?? '';
                        const isOthers = String(line.itemCode).toUpperCase() === 'OTHERS';
                        const colStyle = f.width ? { width: f.width, minWidth: f.width } : undefined;

                        // If item is OTHERS, remove storeWarehouse and drawingNumber
                        if (isOthers && (f.key === 'storeWarehouse' || f.key === 'drawingNumber')) {
                          return (
                            <td key={f.key} style={{ background: '#f8fafc', color: '#94a3b8', textAlign: 'center', fontSize: '12px', ...colStyle }}>
                              N/A
                            </td>
                          );
                        }

                        // Item Code Lookup Select + Input
                        if (f.type === 'lookup') {
                          return (
                            <td key={f.key} className={f.width ? undefined : "w-i"} style={colStyle}>
                              <SearchableItemLookup
                                value={String(cellVal)}
                                disabled={!editable}
                                items={itemMasters}
                                allowOthers={f.allowOthers}
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
                                    {u.name || u.code}
                                  </option>
                                ))}
                                {cellVal && !uomMasters.some((u) => u.code === cellVal || u.name === cellVal) && (
                                  <option value={String(cellVal)}>{String(cellVal)}</option>
                                )}
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
                              style={{
                                width: '100%',
                                textAlign: f.key === 'lineNo' ? 'center' : f.type === 'number' ? 'right' : 'left'
                              }}
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
          {config.disableApprovalWorkflow ? 'Fill all mandatory header and item details before saving.' : 'Fill all mandatory header and item details before submitting.'}
        </div>
        <button type="button" onClick={backToList} className="btn">
          Cancel
        </button>

        {editable && !config.hideBottomSave && !(config.submitOnly && !documentId) && (
          <button type="button" onClick={() => handleSave()} disabled={isBusy} className="btn btn-p">
            <span className="material-symbols-rounded">save</span>
            {isBusy ? 'Saving...' : 'Save Document'}
          </button>
        )}
        {config.submitOnly && !documentId && (
          <button type="button" onClick={() => handleCreateAndSubmit()} disabled={isBusy} className="btn btn-g">
            <span className="material-symbols-rounded">send</span>
            {isBusy ? 'Submitting...' : 'Submit'}
          </button>
        )}

      </div>

      {actionModal && (
        <ConfirmActionModal
          open={Boolean(actionModal)}
          title={`Confirm ${actionModal.action.toUpperCase()}`}
          body={`Are you sure you want to ${actionModal.action} this purchase document?`}
          okLabel={actionModal.action.toUpperCase()}
          danger={actionModal.danger}
          onConfirm={() => handleAction()}
          onClose={() => setActionModal(null)}
        />
      )}

      <AuditHistoryDrawer open={auditOpen} entityType={auditEntityTypeFor(docType)} entityId={documentId ?? undefined} onClose={() => setAuditOpen(false)} />
    </div>
  );
}
