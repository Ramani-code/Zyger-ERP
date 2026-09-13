import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import {
  buildLineFields,
  INWARD_TYPE_LIST,
  INWARD_TYPES,
  type InwardFieldConfig,
  type InwardType,
} from '../../../config/inwardConfig';
import {
  useInwardDocument,
  useInwardMutations,
  useInwardNextNumber,
  useInwardOptions,
} from '../../../hooks/useInward';
import { getApiErrorMessage } from '../../../utils/apiError';
import { toNumber, todayISO } from '../../../utils/format';
import { lookupDocumentByNumber } from '../../../utils/documentLookup';
import { logSystemActivity } from '../../../utils/activityLog';
import { filterPurchaseRelevantItems } from '../../../utils/itemClassification';
import StatusBadge from '../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';
import AttachmentsDrawer from '../../../components/common/AttachmentsDrawer';

interface InwardFormProps {
  inwardType?: InwardType;
  documentId?: string | null;
  viewOnly?: boolean;
  onBack: () => void;
  onSaved?: (id: string) => void;
}

type HeaderState = Record<string, string>;
type LineState = Record<string, string>;

interface ActionModalState {
  action: string;
  title: string;
  body: string;
  okLabel: string;
  danger?: boolean;
}

function emptyLine(): LineState {
  return {};
}

function valueOf(doc: Record<string, any>, line: Record<string, any>, key: string): string {
  const raw = line[key] ?? doc[key] ?? '';
  return raw === null || raw === undefined ? '' : String(raw);
}

function formFromDto(
  doc: Record<string, any>,
  config: (typeof INWARD_TYPES)[InwardType],
  items: Array<{ code: string; uom?: string }>
): { header: HeaderState; lines: LineState[] } {
  const header: HeaderState = {};
  const lineFields = buildLineFields(config.qtyField, config.type);

  config.headerFields.forEach((field) => {
    if (field.type === 'auto') {
      return;
    }
    if (field.key === 'date') {
      header.date = valueOf(doc, {}, 'date') || todayISO();
      return;
    }
    if (field.key === 'qcRequired') {
      header.qcRequired = valueOf(doc, {}, 'qcRequired') || 'Yes';
      return;
    }
    header[field.key] = valueOf(doc, {}, field.key);
  });

  const lines: LineState[] = (doc.lines ?? []).map((line: Record<string, any>) => {
    const state: LineState = {};
    lineFields.forEach((field) => {
      if (field.type === 'item') {
        state.itemCode = valueOf(doc, line, 'itemCode');
        return;
      }
      if (field.type === 'auto') {
        if (field.key === 'itemDesc') {
          state.itemDesc = valueOf(doc, line, 'itemDesc') || line.description || '';
          return;
        }
        if (field.key === 'uom') {
          const item = items.find((entry) => entry.code === line.itemCode);
          state.uom = line.uom ?? item?.uom ?? '';
          return;
        }
        if (field.key === 'amount') {
          const qty = toNumber(line.qty ?? line[config.qtyField]);
          const rate = toNumber(line.rate);
          const base = qty * rate;
          state.amount = line.amount !== undefined && line.amount !== null && String(line.amount) !== ''
            ? String(line.amount)
            : String(Number(base.toFixed(2)));
          return;
        }
        if (field.key === 'taxAmount') {
          const qty = toNumber(line.qty ?? line[config.qtyField]);
          const rate = toNumber(line.rate);
          const discountPct = toNumber(line.discount);
          const taxPct = toNumber(line.tax);
          const base = qty * rate;
          const discAmt = (base * discountPct) / 100;
          const taxable = base - discAmt;
          const taxAmt = (taxable * taxPct) / 100;
          state.taxAmount = line.taxAmount !== undefined && line.taxAmount !== null && String(line.taxAmount) !== ''
            ? String(line.taxAmount)
            : String(Number(taxAmt.toFixed(2)));
          return;
        }
        if (field.key === 'netAmount') {
          const qty = toNumber(line.qty ?? line[config.qtyField]);
          const rate = toNumber(line.rate);
          const discountPct = toNumber(line.discount);
          const taxPct = toNumber(line.tax);
          const base = qty * rate;
          const discAmt = (base * discountPct) / 100;
          const taxable = base - discAmt;
          const taxAmt = (taxable * taxPct) / 100;
          const netAmt = taxable + taxAmt;
          state.netAmount = line.netAmount !== undefined && line.netAmount !== null && String(line.netAmount) !== ''
            ? String(line.netAmount)
            : String(Number(netAmt.toFixed(2)));
          return;
        }
        return;
      }
      if (field.key === config.qtyField) {
        state[field.key] = line.qty ?? line[config.qtyField] ?? '';
        return;
      }
      state[field.key] = valueOf(doc, line, field.key);
    });
    return state;
  });

  return { header, lines: lines.length > 0 ? lines : [emptyLine()] };
}

export default function InwardForm({
  inwardType: lockedType,
  documentId,
  viewOnly = false,
  onBack,
  onSaved,
}: InwardFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const options = useInwardOptions();
  const mutations = useInwardMutations();

  const [inwardType, setInwardType] = useState<InwardType>(lockedType ?? 'PO_INWARD');
  const config = INWARD_TYPES[inwardType];
  const lineFields = useMemo(
    () => buildLineFields(config.qtyField, inwardType),
    [config.qtyField, inwardType]
  );

  const [header, setHeader] = useState<HeaderState>({ date: todayISO() });
  const [lines, setLines] = useState<LineState[]>([emptyLine()]);
  const [errors, setErrors] = useState<string[]>([]);
  const [currentDocument, setCurrentDocument] = useState<Record<string, any> | null>(null);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null);

  // Rejected Reason & Direct Inventory Update Modal States
  const [editingRejectIndex, setEditingRejectIndex] = useState<number | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [showUpdateInventoryConfirm, setShowUpdateInventoryConfirm] = useState(false);

  // File Attachment: persisted server-side via the generic Attachments API,
  // keyed by this document's doc-type key (config.apiPath) + numeric id.
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const attachmentOwnerType = config.apiPath.replace('/inventory/documents/', '');

  const documentQuery = useInwardDocument(inwardType, documentId);
  const nextNumberQuery = useInwardNextNumber(lockedType ? null : inwardType);

  const status = currentDocument?.status ?? 'DRAFT';
  const editable = !viewOnly && (status === 'DRAFT' || status === 'REJECTED');

  const docNo =
    currentDocument?.docNo ??
    nextNumberQuery.data?.nextNumber ??
    `${config.prefix}-${new Date().getFullYear()}-…`;

  useEffect(() => {
    if (!documentId) {
      setCurrentDocument(null);
      setHeader({ date: todayISO() });
      setLines([emptyLine()]);
      setErrors([]);
      return;
    }

    if (documentQuery.data) {
      setCurrentDocument(documentQuery.data);
      setHeader(formFromDto(documentQuery.data, config, options.items).header);
      setLines(formFromDto(documentQuery.data, config, options.items).lines);
      setErrors([]);
    }
  }, [documentId, documentQuery.data, config, options.items]);

  useEffect(() => {
    if (documentId) {
      return;
    }
    setHeader({ date: todayISO() });
    setLines([emptyLine()]);
    setErrors([]);
  }, [inwardType, documentId]);

  const isBusy =
    mutations.createMutation.isPending ||
    mutations.updateMutation.isPending ||
    mutations.actionMutation.isPending;

  const resolveOptions = (source?: InwardFieldConfig['options']) => {
    if (!source) return [];

    if (Array.isArray(source)) {
      return source.map((value) => ({ value, label: value }));
    }

    switch (source) {
      case 'suppliers':
        return options.suppliers.map((s) => ({
          value: s.code,
          label: s.name,
        }));
      case 'customers':
        return options.customers.map((c) => ({
          value: c.code,
          label: `${c.code} — ${c.name}`,
        }));
      case 'locations':
      case 'stores': {
        const storeList = options.stores ?? [];
        return storeList.map((l: any) => ({
          value: l.code,
          label: l.name || l.code,
        }));
      }
      case 'pos':
        return options.purchaseOrders.map((p: any) => {
          const num = p.docNo || p.number || '';
          const supp = p.supplier || p.supplierName ? ` — ${p.supplier || p.supplierName}` : '';
          return {
            value: num,
            label: `${num}${supp}`,
          };
        });
      case 'jos':
        return options.jobOrders.map((j) => ({ value: j.number, label: j.number }));
      case 'los':
        return options.labourOrders.map((l) => ({
          value: l.number,
          label: l.number,
        }));
      case 'yn':
        return [
          { value: 'Yes', label: 'Yes' },
          { value: 'No', label: 'No' },
        ];
      case 'uoms': {
        const masterUoms = (options.uoms || []).map((u: any) => ({
          value: u.code,
          label: u.name || u.code,
        }));
        if (masterUoms.length > 0) return masterUoms;
        const defaultUoms = ['PCS', 'NOS', 'KG', 'MTR', 'SET', 'BOX', 'LTR', 'PKT', 'BAG', 'TON', 'M3', 'SQM', 'FT', 'INCH', 'MM'];
        return defaultUoms.map((u) => ({ value: u, label: u }));
      }
      default:
        return [];
    }
  };

  const updateHeader = (key: string, value: string) => {
    setHeader((prev) => ({ ...prev, [key]: value }));

    if ((key === 'poNumber' || key === 'purchaseOrderNo' || key === 'jobOrderNo' || key === 'labourOrderNo') && value) {
      const docTypeKey = (key === 'poNumber' || key === 'purchaseOrderNo') ? 'purchase-order' : key === 'jobOrderNo' ? 'job-order' : 'labour-order';

      const foundPo = options.purchaseOrders.find((p: any) => p.docNo === value || p.number === value);
      if (foundPo) {
        const supp = foundPo.supplier || foundPo.supplierName || foundPo.party;
        if (supp) {
          const matchedSupplier = options.suppliers.find((s: any) => s.code === supp || s.name === supp || s.code === foundPo.supplierCode);
          setHeader((prev) => ({ ...prev, supplier: matchedSupplier ? matchedSupplier.code : supp }));
        }
      }

      void lookupDocumentByNumber(docTypeKey, value).then((doc) => {
        if (!doc) return;
        const supp = doc.supplier || doc.party;
        if (supp) {
          const matchedSupplier = options.suppliers.find((s: any) => s.code === supp || s.name === supp || s.code === (doc.raw as any)?.supplierCode);
          setHeader((prev) => ({ ...prev, supplier: matchedSupplier ? matchedSupplier.code : supp }));
        }
        if (doc.subcontractor) {
          setHeader((prev) => ({ ...prev, subcontractor: doc.subcontractor || '' }));
        }

        if (doc.lines && doc.lines.length > 0) {
          const newLines = doc.lines.map((l: any) => {
            const item = options.items.find((i) => i.code === l.itemCode);
            return {
              ...emptyLine(),
              itemCode: l.itemCode || 'ITEM-001',
              itemDesc: l.itemDesc || l.description || item?.description || '',
              description: '',
              uom: l.uom || item?.uom || (options.uoms && options.uoms[0]?.code) || 'PCS',
              [config.qtyField]: String(l.qty ?? l.quantity ?? 1),
              rate: String(l.unitPrice ?? l.rate ?? item?.defaultRate ?? 0),
              amount: String(l.amount ?? l.lineTotal ?? 0),
              location: (options.stores && options.stores[0]?.code) || options.locations[0]?.code || '',
            };
          });
          setLines(newLines);
        }
      });
    }
  };

  const updateLine = (index: number, key: string, value: string) => {
    setLines((prev) => {
      const next = [...prev];
      const defaultLoc = (options.stores && options.stores[0]?.code) || options.locations[0]?.code || '';
      const line = { ...next[index], [key]: value };

      if (key === 'itemCode') {
        if (value === 'OTHERS') {
          line.itemDesc = '';
          line.description = '';
          line.uom = (options.uoms && options.uoms[0]?.code) || 'PCS';
        } else {
          const item = options.items.find((i) => i.code === value);
          line.itemDesc = item?.description ?? '';
          line.description = '';
          line.uom = item?.uom || (options.uoms && options.uoms[0]?.code) || 'PCS';
          if (!line.rate && item?.defaultRate) {
            line.rate = String(item.defaultRate);
          }
          // DOCUMENT 02 v2.0 §12 — qcRequired auto-defaulted from the first line's
          // Item Master inspectionRequired flag, editable.
          if (index === 0) {
            const qcRequired = item?.inspectionRequired ? 'Yes' : 'No';
            setHeader((prev) => ({ ...prev, qcRequired }));
          }
        }
        // DOCUMENT 02 v2.0 §12 — storeLocation auto-defaulted from Item Master's
        // defaultReceivingStore when present, editable.
        if (!line.location) {
          const item = value === 'OTHERS' ? undefined : options.items.find((i) => i.code === value);
          line.location = item?.defaultReceivingStore || defaultLoc;
        }
      }

      if (key === config.qtyField || key === 'acceptedQty') {
        const recQty = toNumber(line[config.qtyField]);
        const accQty = toNumber(key === 'acceptedQty' ? value : line.acceptedQty);
        if (line.acceptedQty !== '' || key === 'acceptedQty') {
          line.rejectedQty = String(Math.max(0, recQty - accQty));
        }
      }

      if (key === config.qtyField || key === 'rate' || key === 'discount' || key === 'tax') {
        const qty = toNumber(line[config.qtyField]);
        const rate = toNumber(line.rate);
        const discountPct = toNumber(line.discount);
        const taxPct = toNumber(line.tax);

        const base = qty * rate;
        const discAmt = (base * discountPct) / 100;
        const taxable = base - discAmt;
        const taxAmt = (taxable * taxPct) / 100;
        const netAmt = taxable + taxAmt;

        line.amount = String(Math.round(base));
        line.taxAmount = String(Math.round(taxAmt));
        line.netAmount = String(Math.round(netAmt));
      }

      next[index] = line;
      return next;
    });
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);

  const deleteLine = (index: number) => {
    setLines((prev) => {
      if (prev.length === 1) return [emptyLine()];
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
  };

  const isLineDirty = (line: LineState) =>
    Object.values(line).some((value) => String(value ?? '').trim() !== '');

  const validate = (): string[] => {
    const found: string[] = [];

    config.headerFields.forEach((field) => {
      if (field.required && field.type !== 'auto') {
        if (!String(header[field.key] ?? '').trim()) {
          found.push(`${field.label} is required.`);
        }
      }
    });

    const activeLines = lines.filter(isLineDirty);

    if (activeLines.length === 0) {
      found.push('At least one line item is required.');
    }

    activeLines.forEach((line, index) => {
      const lineNo = index + 1;

      lineFields.forEach((field) => {
        if (field.required && !String(line[field.key] ?? '').trim()) {
          found.push(`Line ${lineNo}: ${field.label} is required.`);
        }
      });

      const qty = toNumber(line[config.qtyField]);
      if (!qty || qty <= 0) {
        found.push(`Line ${lineNo}: Qty is required.`);
      }
    });

    return [...new Set(found)];
  };

  const buildPayload = () => {
    const activeLines = lines.filter(isLineDirty);

    const headerFields: Record<string, any> = {};
    config.headerFields.forEach((field) => {
      if (field.type === 'auto' || field.key === 'date') {
        return;
      }
      if (header[field.key] !== undefined) {
        headerFields[field.key] = header[field.key];
      }
    });

    return {
      date: header.date,
      ...headerFields,
      lines: activeLines.map((line) => ({
        itemCode: line.itemCode,
        itemDesc: line.itemDesc || undefined,
        description: line.description || undefined,
        uom: line.uom || undefined,
        [config.qtyField]: toNumber(line[config.qtyField]),
        rate: line.rate ? toNumber(line.rate) : undefined,
        amount: line.amount ? toNumber(line.amount) : undefined,
        discount: line.discount ? toNumber(line.discount) : undefined,
        tax: line.tax ? toNumber(line.tax) : undefined,
        taxAmount: line.taxAmount ? toNumber(line.taxAmount) : undefined,
        netAmount: line.netAmount ? toNumber(line.netAmount) : undefined,
        acceptedQty: line.acceptedQty ? toNumber(line.acceptedQty) : undefined,
        rejectedQty: line.rejectedQty ? toNumber(line.rejectedQty) : undefined,
        rejectedReason: line.rejectedReason || undefined,
        batchNo: line.batchNo || undefined,
        heatNo: line.heatNo || undefined,
        lotNo: line.lotNo || undefined,
        serialNo: line.serialNo || undefined,
        location: line.location,
        remarks: line.remarks || undefined,
      })),
    };
  };

  const save = async (submit: boolean) => {
    if (!editable) {
      return;
    }

    const validationErrors = validate();
    setErrors(validationErrors);

    if (validationErrors.length > 0) {
      return;
    }

    const payload = buildPayload();
    const targetId = documentId ?? currentDocument?.id ?? null;

    try {
      let saved: Record<string, any>;

      if (targetId) {
        saved = await mutations.updateMutation.mutateAsync({
          inwardType,
          id: targetId,
          payload,
        });
      } else {
        try {
          saved = await mutations.createMutation.mutateAsync({
            inwardType,
            payload,
          });
        } catch (createError) {
          // BR-06: a genuine override now exists server-side (Store Manager/Admin + reason) —
          // offer it inline instead of just reporting the block as before.
          const code = (createError as any)?.response?.data?.code;
          if (code === 'BACKDATED_ENTRY') {
            const reason = window.prompt(
              getApiErrorMessage(createError, 'Backdated entry blocked.') +
                '\n\nIf you have Store Manager/Admin authorization, enter a reason to override:'
            );
            if (!reason || !reason.trim()) throw createError;
            saved = await mutations.createMutation.mutateAsync({
              inwardType,
              payload: { ...payload, backdatedOverrideReason: reason.trim() },
            });
          } else {
            throw createError;
          }
        }
      }

      if (submit && saved.id) {
        const isQc = (header.qcRequired === 'Yes' || header.qcRequired === 'Y' || header.qcRequired === 'true');
        if (isQc) {
          if (saved.status !== 'SUBMITTED' && saved.status !== 'POSTED') {
            saved = await mutations.actionMutation.mutateAsync({
              inwardType,
              id: saved.id,
              action: 'submit',
              note: 'Submitted for Quality Inspection',
            });
          }
          // Inward Entry FRD v2.0 (G1, resolved): the receipt is a completed fact the moment
          // it's submitted, so it posts immediately too — stock lands in the QC_HOLD bucket
          // (server-side, per line's qcRequired), visible as held rather than invisible.
          // The already-auto-created QualityInspection (linked via sourceId) is what tracks
          // whether it's actually cleared; its own accept/reject releases or rejects that
          // held stock. This is what makes the "Post" button's old dead end unnecessary.
          if (saved.status !== 'POSTED') {
            saved = await mutations.actionMutation.mutateAsync({
              inwardType,
              id: saved.id,
              action: 'post',
              note: 'Received — stock held pending Quality Inspection (IQC)',
            });
          }
          toast(`⚠️ Received into QC Hold — ${saved.docNo ?? docNo} stock is held pending Quality Inspection (IQC).`, 'success');
          window.location.hash = '#/inward-inspection-iqc';
        } else {
          // Direct Store Addition - bypass QC
          saved = await mutations.actionMutation.mutateAsync({
            inwardType,
            id: saved.id,
            action: 'post',
            note: 'Direct Store Addition (QC Not Required)',
          });
          toast(`✅ Direct Store Receipt — Quality Inspection not required. Stock ${saved.docNo ?? docNo} has been directly added to Store Stock!`, 'success');
        }
      } else {
        toast(`${saved.docNo ?? docNo} saved as draft.`);
      }

      setCurrentDocument(saved);
      setHeader(formFromDto(saved, config, options.items).header);
      setLines(formFromDto(saved, config, options.items).lines);

      logSystemActivity({
        module: 'Inventory',
        activity: `Material Inward Entry (${saved.docNo ?? docNo})`,
        refNo: saved.docNo ?? docNo,
        party: header.party || header.supplier || header.vendor || 'Supplier',
        user: user?.username || 'Unknown',
        status: saved.status || (submit ? 'SUBMITTED' : 'DRAFT'),
      });

      if (saved.id) {
        onSaved?.(saved.id);
      }
    } catch (saveError) {
      toast(
        getApiErrorMessage(saveError, submit ? 'Submit failed.' : 'Save failed.'),
        'error'
      );
    }
  };


  const runAction = async (action: string, note: string) => {
    const id = currentDocument?.id ?? documentId;

    if (!id) {
      toast('Document is not saved yet.', 'error');
      return;
    }

    try {
      const updated = await mutations.actionMutation.mutateAsync({
        inwardType,
        id,
        action,
        note,
      });

      setCurrentDocument(updated);
      setHeader(formFromDto(updated, config, options.items).header);
      setLines(formFromDto(updated, config, options.items).lines);
      setActionModal(null);

      toast(`${updated.docNo ?? docNo} • ${action} completed.`);
    } catch (actionError) {
      toast(getApiErrorMessage(actionError, 'Action failed.'), 'error');
    }
  };

  const handlePost = async () => {
    const validationErrors = validate();
    setErrors(validationErrors);

    if (validationErrors.length > 0) {
      return;
    }

    await runAction('post', '');
  };

  const openActionModal = (action: 'approve' | 'reject' | 'cancel') => {
    const id = currentDocument?.id ?? documentId;

    if (!id) {
      toast('Document is not saved yet.', 'error');
      return;
    }

    const docNumber = currentDocument?.docNo ?? docNo;

    if (action === 'approve') {
      setActionModal({
        action,
        title: `Approve ${docNumber}`,
        body: 'Add approval comment (optional).',
        okLabel: 'Approve',
      });
    }

    if (action === 'reject') {
      setActionModal({
        action,
        title: `Reject ${docNumber}`,
        body: 'Reason for rejection:',
        okLabel: 'Reject',
        danger: true,
      });
    }

    if (action === 'cancel') {
      setActionModal({
        action,
        title: `Cancel ${docNumber}`,
        body: status === 'POSTED'
          ? 'This document has already updated stock. Cancelling will reverse that stock exactly, and requires a reason (Store Manager/Admin only). It will be blocked if this receipt has already been issued or dispatched downstream.'
          : 'This creates an auditable reversal.',
        okLabel: 'Cancel Document',
        danger: true,
      });
    }
  };

  const resetForNewEntry = () => {
    setCurrentDocument(null);
    setHeader({ date: todayISO() });
    setLines([emptyLine()]);
    setErrors([]);
    setActionModal(null);
  };

  if (documentId && documentQuery.isPending) {
    return (
      <div className="panel">
        <div className="empty">
          <span className="material-symbols-rounded">hourglass_empty</span>
          Loading inward document...
        </div>
      </div>
    );
  }

  if (documentId && documentQuery.isError) {
    return (
      <div className="panel">
        <div className="empty">
          <span className="material-symbols-rounded">error</span>
          {getApiErrorMessage(documentQuery.error, 'Unable to load document.')}
          <div style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => documentQuery.refetch()}>
              <span className="material-symbols-rounded">refresh</span>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderHeaderField = (field: InwardFieldConfig) => {
    const value = field.type === 'auto' ? docNo : header[field.key] ?? '';

    if (field.type === 'attachment') {
      const ownerId = documentId ?? currentDocument?.id ?? null;
      return (
        <label key={field.key} className="fld span2" style={{ gridColumn: 'span 2' }}>
          <span>{field.label}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
            {ownerId ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setAttachmentsOpen(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#2563eb', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>attach_file</span>
                  Manage Attachments
                </button>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Supplier Invoice, Delivery Challan, Quality Report, or Images — stored on the server, survives refresh
                </span>
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>
                Save this document as a draft first, then attach invoice/challan copies.
              </div>
            )}
          </div>
        </label>
      );
    }

    return (
      <label
        key={field.key}
        className={`fld ${field.span === 2 ? 'span2' : ''}`}
      >
        <span>
          {field.label} {field.required ? <em>*</em> : null}
        </span>

        {field.type === 'auto' ? (
          <input className="in" value={value} readOnly tabIndex={-1} />
        ) : field.type === 'select' ? (
          field.options === 'pos' || field.key === 'purchaseOrderNo' ? (
            <>
              <input
                className="in"
                list={`list-${field.key}`}
                placeholder="Search or select Purchase Order..."
                value={value}
                disabled={!editable}
                onChange={(e) => updateHeader(field.key, e.target.value)}
              />
              <datalist id={`list-${field.key}`}>
                {resolveOptions(field.options).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </datalist>
            </>
          ) : (
            <select
              className="in"
              value={value}
              disabled={!editable}
              onChange={(e) => updateHeader(field.key, e.target.value)}
            >
              <option value="">— Select —</option>
              {resolveOptions(field.options).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {value && !resolveOptions(field.options).some((o) => o.value === value) && (
                <option value={value}>{value}</option>
              )}
            </select>
          )
        ) : (
          <input
            className="in"
            type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
            value={value}
            step="any"
            readOnly={!editable}
            onChange={(e) => updateHeader(field.key, e.target.value)}
          />
        )}
      </label>
    );
  };

  const renderLineField = (field: InwardFieldConfig, index: number) => {
    const line = lines[index];
    const value = line[field.key] ?? '';

    if (field.key === 'rejectedQty') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            className="in"
            style={{ minWidth: '65px', padding: '5px 6px', fontSize: '.74rem', width: '100%', textAlign: 'right', flex: 1 }}
            type="number"
            step="any"
            value={value}
            readOnly={!editable}
            onChange={(e) => updateLine(index, field.key, e.target.value)}
          />
          <button
            type="button"
            title={line.rejectedReason ? `Reason: ${line.rejectedReason}` : 'Set Rejection Reason'}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: '2px',
              color: line.rejectedReason ? '#ef4444' : '#94a3b8',
              display: 'inline-flex',
              alignItems: 'center',
            }}
            onClick={() => {
              setEditingRejectIndex(index);
              setRejectReasonInput(line.rejectedReason || '');
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>
              report_problem
            </span>
          </button>
        </div>
      );
    }

    if (field.type === 'auto') {
      if (field.key === 'itemDesc' && line?.itemCode === 'OTHERS') {
        return (
          <input
            className="in"
            type="text"
            style={{ minWidth: '130px', padding: '5px 6px', fontSize: '.74rem', width: '100%' }}
            value={value}
            disabled={!editable}
            placeholder="Enter item name..."
            onChange={(e) => updateLine(index, 'itemDesc', e.target.value)}
          />
        );
      }
      const isNumAuto = field.key === 'amount' || field.key === 'taxAmount' || field.key === 'netAmount';

      // Informational only, per Inward Entry FRD v2.0 §6.2/A-2: shows the Item Master's
      // purchase-vs-stock UOM conversion when it applies, without changing what quantity
      // actually posts to stock — that stays exactly as entered, as it always has.
      if (field.key === 'uom') {
        const item = options.items.find((i) => i.code === line.itemCode) as
          | { purchaseUom?: string; conversionFactor?: number }
          | undefined;
        const showConversion = item?.purchaseUom && item.purchaseUom !== value && item.conversionFactor != null;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <input
              className="in"
              style={{ minWidth: '65px', padding: '5px 6px', fontSize: '.74rem', width: '100%' }}
              value={value}
              readOnly
              tabIndex={-1}
            />
            {showConversion && (
              <span
                style={{ fontSize: '.62rem', color: '#64748b', whiteSpace: 'nowrap' }}
                title="Item Master conversion — the quantity entered above is posted to stock as-is, in this UOM; this is shown for reference only."
              >
                1 {item!.purchaseUom} = {item!.conversionFactor} {value}
              </span>
            )}
          </div>
        );
      }

      return (
        <input
          className="in"
          style={{
            minWidth: '65px',
            padding: '5px 6px',
            fontSize: '.74rem',
            width: '100%',
            textAlign: isNumAuto ? 'right' : 'left',
          }}
          value={value}
          readOnly
          tabIndex={-1}
        />
      );
    }

    if (field.type === 'item') {
      const allowedItems = filterPurchaseRelevantItems(options.items);

      return (
        <>
          <input
            className="in"
            style={{ minWidth: '130px', padding: '5px 6px', fontSize: '.74rem', width: '100%' }}
            list={`item-code-datalist-${index}`}
            placeholder="Search Item..."
            value={value}
            disabled={!editable}
            onChange={(e) => updateLine(index, field.key, e.target.value)}
          />
          <datalist id={`item-code-datalist-${index}`}>
            {allowedItems.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} — {item.description}
              </option>
            ))}
          </datalist>
        </>
      );
    }

    if (field.type === 'select') {
      return (
        <select
          className="in"
          style={{ minWidth: field.key === 'uom' ? '65px' : '100px', padding: '5px 6px', fontSize: '.74rem', width: '100%' }}
          value={value}
          disabled={!editable}
          onChange={(e) => updateLine(index, field.key, e.target.value)}
        >
          <option value="">— Select —</option>
          {resolveOptions(field.options).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {value && !resolveOptions(field.options).some((o) => o.value === value) && (
            <option value={value}>{value}</option>
          )}
        </select>
      );
    }

    const fieldMinWidth =
      field.key === 'discount' || field.key === 'tax' || field.key === 'receivedQty' || field.key === 'acceptedQty' || field.key === 'rate'
        ? '65px'
        : field.key === 'description' || field.key === 'itemDesc'
          ? '130px'
          : '100px';

    return (
      <input
        className="in"
        style={{
          minWidth: fieldMinWidth,
          padding: '5px 6px',
          fontSize: '.74rem',
          width: '100%',
          textAlign: field.type === 'number' ? 'right' : 'left',
        }}
        type={field.type === 'number' ? 'number' : 'text'}
        step="any"
        value={value}
        readOnly={!editable}
        onChange={(e) => updateLine(index, field.key, e.target.value)}
      />
    );
  };

  return (
    <>
      <div className="pg-head">
        <h1>
          {viewOnly ? 'View' : documentId ? 'Edit' : 'Add'} Inward — {docNo}
        </h1>
        <p>{config.subtitle}</p>
      </div>

      <div id="valBox">
        {errors.length > 0 && (
          <div className="vals">
            <span className="material-symbols-rounded">warning</span>
            <div>
              <b>Please fix the following:</b>
              <ul>
                {errors.map((errorMessage) => (
                  <li key={errorMessage}>{errorMessage}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-h">
          <h2>
            <span className="material-symbols-rounded">description</span>
            Header
          </h2>
          <StatusBadge status={status} />
        </div>

        <div className="fgrid">
          <label className="fld">
            <span>
              Inward Type <em>*</em>
            </span>
            <select
              className="in"
              value={inwardType}
              disabled={Boolean(lockedType) || !editable}
              onChange={(e) => setInwardType(e.target.value as InwardType)}
            >
              {INWARD_TYPE_LIST.map((typeConfig) => (
                <option key={typeConfig.type} value={typeConfig.type}>
                  {typeConfig.label}
                </option>
              ))}
            </select>
          </label>

          {config.headerFields.map(renderHeaderField)}
        </div>
      </div>

      <div className="panel">
        <div className="panel-h">
          <h2>
            <span className="material-symbols-rounded">table_view</span>
            Line Items
          </h2>

          {editable && (
            <button className="btn btn-sm" onClick={addLine} disabled={isBusy}>
              <span className="material-symbols-rounded">add</span>
              Add Line
            </button>
          )}
        </div>

        <div className="twrap">
          <table className="tbl lines">
            <thead>
              <tr>
                <th>S.No</th>
                {lineFields.map((field) => (
                  <th key={field.key}>
                    {field.label} {field.required ? '*' : ''}
                  </th>
                ))}
                <th />
              </tr>
            </thead>

            <tbody>
              {lines.map((_, index) => (
                <tr key={index}>
                  <td className="num mut">{index + 1}</td>
                  {lineFields.map((field) => (
                    <td key={field.key}>{renderLineField(field, index)}</td>
                  ))}
                  <td>
                    {editable && (
                      <button
                        className="ibtn danger"
                        onClick={() => deleteLine(index)}
                        disabled={isBusy}
                      >
                        <span className="material-symbols-rounded">delete</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="actbar">
          <span className="lft">
            <span className="material-symbols-rounded">lock</span>
            Audited as {user?.username || 'System'}
          </span>

          <button className="btn" onClick={onBack}>
            <span className="material-symbols-rounded">arrow_back</span>
            Back
          </button>

          {!documentId && !viewOnly && (
            <button className="btn" onClick={resetForNewEntry} disabled={isBusy}>
              <span className="material-symbols-rounded">restart_alt</span>
              New Entry
            </button>
          )}

          {editable && (
            <>
              <button
                className="btn"
                onClick={() => save(false)}
                disabled={isBusy}
              >
                <span className="material-symbols-rounded">save</span>
                Save Draft
              </button>

              {(header.qcRequired === 'No' || header.qcRequired === 'N' || header.qcRequired === 'false') ? (
                <button
                  type="button"
                  className="btn btn-g"
                  style={{ background: '#16a34a', borderColor: '#16a34a', color: '#ffffff' }}
                  onClick={() => setShowUpdateInventoryConfirm(true)}
                  disabled={isBusy}
                >
                  <span className="material-symbols-rounded">inventory</span>
                  Update Inventory
                </button>
              ) : (
                <button
                  className="btn btn-p"
                  onClick={() => save(true)}
                  disabled={isBusy}
                >
                  <span className="material-symbols-rounded">verified</span>
                  Send to QC
                </button>
              )}
            </>
          )}

          {status === 'REJECTED' && editable && (
            <button
              className="btn"
              onClick={() => runAction('reopen', '')}
              disabled={isBusy}
            >
              <span className="material-symbols-rounded">restart_alt</span>
              Reopen
            </button>
          )}

          {status === 'APPROVED' && (
            <button
              className="btn btn-g"
              onClick={handlePost}
              disabled={isBusy}
            >
              <span className="material-symbols-rounded">
                published_with_changes
              </span>
              Post (Update Stock)
            </button>
          )}

          {status !== 'CANCELLED' && (
            <button
              className="btn btn-d"
              onClick={() => openActionModal('cancel')}
              disabled={isBusy}
              title={status === 'POSTED' ? 'Reverses the stock this receipt added — Store Manager/Admin only' : undefined}
            >
              <span className="material-symbols-rounded">block</span>
              Cancel
            </button>
          )}
        </div>
      </div>

      <ConfirmActionModal
        open={Boolean(actionModal)}
        title={actionModal?.title ?? ''}
        body={actionModal?.body ?? ''}
        okLabel={actionModal?.okLabel ?? 'Confirm'}
        danger={actionModal?.danger}
        busy={mutations.actionMutation.isPending}
        onClose={() => setActionModal(null)}
        onConfirm={(note) => {
          if (actionModal) {
            runAction(actionModal.action, note);
          }
        }}
      />

      {/* Rejected Reason Modal */}
      {editingRejectIndex !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#ffffff', borderRadius: '8px', padding: '24px', width: '420px', maxWidth: '90vw', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', color: '#0f172a', fontSize: '18px' }}>
              <span className="material-symbols-rounded" style={{ color: '#ef4444' }}>report_problem</span>
              Rejection Reason (Line #{editingRejectIndex + 1})
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '14px', lineHeight: 1.4 }}>
              Specify why items in this line are being rejected.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <select
                className="in"
                style={{ width: '100%' }}
                value={rejectReasonInput}
                onChange={(e) => setRejectReasonInput(e.target.value)}
              >
                <option value="">— Select Common Reason —</option>
                <option value="Damaged in transit">Damaged in transit</option>
                <option value="Quality defect / Out of specification">Quality defect / Out of specification</option>
                <option value="Incorrect item / Wrong specification">Incorrect item / Wrong specification</option>
                <option value="Expired or near expiry">Expired or near expiry</option>
                <option value="Quantity mismatch / Shortage">Quantity mismatch / Shortage</option>
                <option value="Surface rust / Physical defect">Surface rust / Physical defect</option>
              </select>
              <textarea
                className="in"
                rows={3}
                style={{ width: '100%', resize: 'vertical' }}
                placeholder="Or type custom rejection reason here..."
                value={rejectReasonInput}
                onChange={(e) => setRejectReasonInput(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
              <button
                type="button"
                className="btn"
                onClick={() => setEditingRejectIndex(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-p"
                onClick={() => {
                  updateLine(editingRejectIndex, 'rejectedReason', rejectReasonInput);
                  setEditingRejectIndex(null);
                }}
              >
                Save Reason
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Direct Update Inventory Modal */}
      <ConfirmActionModal
        open={showUpdateInventoryConfirm}
        title="Confirm Inventory Update"
        body="Quality Inspection Required is set to 'No'. Submitting will directly add items to Store Stock and update inventory records without quality inspection. Are you sure you want to proceed?"
        okLabel="Update Inventory Now"
        busy={isBusy}
        onClose={() => setShowUpdateInventoryConfirm(false)}
        onConfirm={async () => {
          setShowUpdateInventoryConfirm(false);
          await save(true);
        }}
      />

      {attachmentsOpen && (documentId ?? currentDocument?.id) && (
        <AttachmentsDrawer
          ownerType={attachmentOwnerType}
          ownerId={Number(documentId ?? currentDocument?.id)}
          onClose={() => setAttachmentsOpen(false)}
        />
      )}
    </>
  );
}
