// src/pages/inventory/inward/po-inward/PoInwardForm.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { useToast } from '../../../../contexts/ToastContext';
import { usePoInwardDocument } from '../../../../hooks/usePoInwardDocument';
import { usePoInwardLookups } from '../../../../hooks/usePoInwardLookups';
import { usePoInwardMutations } from '../../../../hooks/usePoInwardMutations';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { toNumber } from '../../../../utils/format';
import { logSystemActivity } from '../../../../utils/activityLog';
import StatusBadge from '../../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../../components/common/ConfirmActionModal';
import SearchableItemLookup from '../../../../components/common/SearchableItemLookup';
import type { PoInwardDto, DocumentAction } from '../../../../types/inventory/poInward.types';
import type { ItemMasterDto } from '../../../../types/master.types';
import { lookupDocumentByNumber } from '../../../../utils/documentLookup';
import { filterPurchaseRelevantItems } from '../../../../utils/itemClassification';
import {
  buildPayload,
  createEmptyForm,
  createEmptyLine,
  formFromDto,
  validatePoInwardForm,
  type PoInwardFormState,
  type PoInwardLineFormState,
} from './poInwardForm';


interface ActionModalState {
  action: DocumentAction;
  title: string;
  body: string;
  okLabel: string;
  danger?: boolean;
}

interface PoInwardFormProps {
  documentId?: string | null;
  viewOnly?: boolean;
  onBack: () => void;
  onSaved?: (id: string) => void;
}

export default function PoInwardForm({
  documentId,
  viewOnly = false,
  onBack,
  onSaved,
}: PoInwardFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const lookups = usePoInwardLookups();
  const documentQuery = usePoInwardDocument(documentId ?? null);

  const {
    createMutation,
    updateMutation,
    actionMutation,
  } = usePoInwardMutations();

  const [form, setForm] = useState<PoInwardFormState>(() => createEmptyForm());
  const [currentDocument, setCurrentDocument] = useState<PoInwardDto | null>(
    null
  );
  const [validationMode, setValidationMode] = useState<'draft' | 'submit' | null>(
    null
  );
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null);

  // Rejected Reason & Direct Inventory Update Modal States
  const [editingRejectIndex, setEditingRejectIndex] = useState<number | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [showUpdateInventoryConfirm, setShowUpdateInventoryConfirm] = useState(false);

  // File Attachment State & Handlers
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; size: string; url?: string }>>([]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newAtts = Array.from(files).map(file => ({
      id: Math.random().toString(36).substring(2, 9),
      name: file.name,
      size: `${(file.size / 1024).toFixed(1)} KB`,
      url: URL.createObjectURL(file),
    }));
    setAttachments(prev => [...prev, ...newAtts]);
    toast(`${newAtts.length} file(s) attached.`);
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
    toast('Attachment removed.');
  };

  const validationBoxRef = useRef<HTMLDivElement | null>(null);
  const initializedFor = useRef<string | null>(null);

  const items = lookups.items;
  const suppliers = lookups.suppliers;
  const purchaseOrders = lookups.purchaseOrders;
  // Priority#1 [FIXED] — was `lookups.locations` alone, never considering store_master at
  // all for this default; merged so a store_master-only site still gets a sane default.
  const locations = lookups.stores ?? [];

  const itemsMap = useMemo(
    () => new Map(items.map((item: ItemMasterDto) => [item.code, item])),
    [items]
  );

  const status = currentDocument?.status ?? 'DRAFT';
  const editable = !viewOnly && (status === 'DRAFT' || status === 'REJECTED');

  useEffect(() => {
    if (!documentId) {
      initializedFor.current = null;
      setCurrentDocument(null);
      setForm(createEmptyForm());
      return;
    }

    if (
      documentQuery.data &&
      initializedFor.current !== documentId
    ) {
      initializedFor.current = documentId;
      setCurrentDocument(documentQuery.data);
      setForm(formFromDto(documentQuery.data, items));
    }
  }, [documentId, documentQuery.data, items]);

  useEffect(() => {
    if (!items.length) {
      return;
    }

    setForm((previous) => ({
      ...previous,
      lines: previous.lines.map((line) => {
        if (!line.itemCode) {
          return line;
        }

        const item = itemsMap.get(line.itemCode);

        if (!item) {
          return line;
        }

        return {
          ...line,
          itemDesc: line.itemDesc || item.description,
          uom: line.uom || item.uom,
        };
      }),
    }));
  }, [items, itemsMap]);

  const validationErrors = useMemo(() => {
    if (!validationMode) {
      return [];
    }

    return validatePoInwardForm(form, itemsMap, validationMode === 'submit');
  }, [form, itemsMap, validationMode]);

  useEffect(() => {
    if (validationErrors.length > 0 && validationBoxRef.current) {
      validationBoxRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [validationErrors]);

  const updateHeader = (
    key: keyof Omit<PoInwardFormState, 'lines'>,
    value: string
  ) => {
    setForm((previous) => ({
      ...previous,
      [key]: value,
    }));

    if (key === 'purchaseOrderNo' && value) {
      const selectedPo = purchaseOrders.find((p: any) => p.docNo === value || p.number === value);
      const poSupplier = selectedPo?.supplier || selectedPo?.supplierName || selectedPo?.party;
      if (poSupplier) {
        const matchedSupplier = suppliers.find((s: any) => s.code === poSupplier || s.name === poSupplier || s.code === selectedPo?.supplierCode);
        const supplierValue = matchedSupplier ? matchedSupplier.code : poSupplier;
        setForm((prev) => ({ ...prev, supplier: supplierValue }));
      }

      void lookupDocumentByNumber('purchase-order', value).then((doc: any) => {
        if (!doc) return;
        const supp = doc.supplier || doc.party;
        if (supp) {
          const matchedSupplier = suppliers.find((s: any) => s.code === supp || s.name === supp || s.code === (doc.raw as any)?.supplierCode);
          const supplierValue = matchedSupplier ? matchedSupplier.code : supp;
          setForm((prev) => ({ ...prev, supplier: supplierValue }));
        }

        if (doc.lines && doc.lines.length > 0) {
          const defaultLoc = locations[0]?.code ?? '';
          setForm((prev) => ({
            ...prev,
            lines: doc.lines.map((l: any) => {
              const item = itemsMap.get(l.itemCode);
              const qty = String(l.orderQty ?? l.qty ?? '');
              const rate = String(l.unitPrice ?? l.rate ?? item?.defaultRate ?? '');
              const discount = String(l.discount ?? l.discountPercentage ?? '0');
              const tax = String(l.tax ?? l.taxPercentage ?? '0');

              const base = toNumber(qty) * toNumber(rate);
              const discAmt = (base * toNumber(discount)) / 100;
              const taxable = base - discAmt;
              const taxAmt = (taxable * toNumber(tax)) / 100;
              const netAmt = taxable + taxAmt;

              return {
                itemCode: l.itemCode || 'ITEM-001',
                itemDesc: l.itemDesc || l.itemName || item?.description || '',
                uom: l.uom || item?.uom || 'PCS',
                receivedQty: qty,
                acceptedQty: qty,
                rejectedQty: '0',
                rate,
                discount,
                tax,
                taxAmount: taxAmt ? String(Number(taxAmt.toFixed(2))) : '0',
                netAmount: netAmt ? String(Number(netAmt.toFixed(2))) : '0',
                amount: base ? String(Number(base.toFixed(2))) : '0',
                batchNo: '',
                heatNo: '',
                location: l.location || defaultLoc,
                remarks: l.remarks || '',
              };
            }),
          }));
        }
      });
    }
  };

  const updateLine = (
    index: number,
    key: keyof PoInwardLineFormState,
    value: string
  ) => {
    setForm((previous) => {
      const lines = [...previous.lines];

      const line = {
        ...lines[index],
        [key]: value,
      };

      if (key === 'itemCode') {
        if (value === 'OTHERS') {
          line.itemDesc = '';
          line.description = '';
          line.uom = lookups.uoms[0]?.code ?? 'PCS';
        } else {
          const item = itemsMap.get(value);
          line.itemDesc = item?.description ?? '';
          line.description = '';
          line.uom = item?.uom || (lookups.uoms[0]?.code ?? 'PCS');
          // DOCUMENT 02 v2.0 §12 — storeLocation auto-defaulted from Item Master's
          // defaultReceivingStore, editable (only fills if the line has none yet).
          if (!line.location && item?.defaultReceivingStore) {
            line.location = item.defaultReceivingStore;
          }
        }
      }

      if (key === 'acceptedQty' || key === 'receivedQty') {
        const recQty = toNumber(line.receivedQty);
        const accQty = toNumber(key === 'acceptedQty' ? value : line.acceptedQty);
        if (line.acceptedQty !== '' || key === 'acceptedQty') {
          line.rejectedQty = String(Math.max(0, recQty - accQty));
        }
      }

      if (key === 'receivedQty' || key === 'rate' || key === 'discount' || key === 'tax') {
        const qty = toNumber(line.receivedQty);
        const rate = toNumber(line.rate);
        const discountPct = toNumber(line.discount);
        const taxPct = toNumber(line.tax);

        const base = qty * rate;
        const discAmt = (base * discountPct) / 100;
        const taxable = base - discAmt;
        const taxAmt = (taxable * taxPct) / 100;
        const netAmt = taxable + taxAmt;

        line.amount = base ? String(Number(base.toFixed(2))) : '0';
        line.taxAmount = taxAmt ? String(Number(taxAmt.toFixed(2))) : '0';
        line.netAmount = netAmt ? String(Number(netAmt.toFixed(2))) : '0';
      }

      lines[index] = line;

      // DOCUMENT 02 v2.0 §12 — qcRequired auto-defaulted from the first line's Item
      // Master inspectionRequired flag, editable.
      let qcRequired = previous.qcRequired;
      if (key === 'itemCode' && index === 0 && value !== 'OTHERS') {
        const item = itemsMap.get(value);
        if (item) qcRequired = item.inspectionRequired ? 'Yes' : 'No';
      }

      return {
        ...previous,
        qcRequired,
        lines,
      };
    });
  };

  const addLine = () => {
    if (!editable) {
      return;
    }

    setForm((previous) => ({
      ...previous,
      lines: [...previous.lines, createEmptyLine()],
    }));
  };

  const deleteLine = (index: number) => {
    if (!editable) {
      return;
    }

    setForm((previous) => {
      const lines = [...previous.lines];

      if (lines.length === 1) {
        lines[0] = createEmptyLine();
      } else {
        lines.splice(index, 1);
      }

      return {
        ...previous,
        lines,
      };
    });
  };

  const isBusy =
    createMutation.isPending ||
    updateMutation.isPending ||
    actionMutation.isPending;

  const save = async (submit: boolean) => {
    if (!editable) {
      return;
    }

    setValidationMode(submit ? 'submit' : 'draft');

    const errors = validatePoInwardForm(form, itemsMap, submit);

    if (errors.length > 0) {
      return;
    }

    try {
      const targetId = documentId ?? currentDocument?.id ?? null;

      if (targetId && status === 'REJECTED') {
        await actionMutation.mutateAsync({
          id: targetId,
          action: 'reopen',
          note: '',
        });
      }

      const payload = buildPayload(form);

      let saved: PoInwardDto;

      if (targetId) {
        saved = await updateMutation.mutateAsync({
          id: targetId,
          payload,
        });
      } else {
        saved = await createMutation.mutateAsync(payload);
      }

      if (submit && saved.id) {
        const isQc = (form.qcRequired === 'Yes' || form.qcRequired === 'Y' || form.qcRequired === 'true');
        if (isQc) {
          if (saved.status !== 'SUBMITTED') {
            saved = await actionMutation.mutateAsync({
              id: saved.id,
              action: 'submit',
              note: 'Submitted for Quality Inspection',
            });
          }
          toast(`⚠️ Sent to QC — ${saved.docNo || 'Document'} has been submitted & routed to Inward Inspection (IQC).`, 'success');
          window.location.hash = '#/inward-inspection-iqc';
        } else {
          // Direct Store Addition - bypass QC
          saved = await actionMutation.mutateAsync({
            id: saved.id,
            action: 'post',
            note: 'Direct Store Addition (QC Not Required)',
          });
          toast(`✅ Direct Store Receipt — Quality Inspection not required. Stock ${saved.docNo || 'Document'} has been directly added to Store Stock!`, 'success');
        }
      } else {
        toast(`${saved.docNo || 'Document'} saved as draft.`);
      }

      setCurrentDocument(saved);
      setForm(formFromDto(saved, items));

      logSystemActivity({
        module: 'Inventory',
        activity: `PO Inward Entry (${saved.docNo || 'Document'})`,
        refNo: saved.docNo || '',
        party: form.supplier || 'Supplier',
        user: user?.username || 'Unknown',
        status: saved.status || (submit ? 'SUBMITTED' : 'DRAFT'),
      });

      if (saved.id) {
        initializedFor.current = saved.id;
        onSaved?.(saved.id);
      }
    } catch (saveError) {
      toast(
        getApiErrorMessage(
          saveError,
          submit ? 'Submit failed.' : 'Save failed.'
        ),
        'error'
      );
    }
  };

  const runAction = async (action: DocumentAction, note: string) => {
    const id = currentDocument?.id ?? documentId;

    if (!id) {
      toast('Document is not saved yet.', 'error');
      return;
    }

    try {
      const updated = await actionMutation.mutateAsync({
        id,
        action,
        note,
      });

      setCurrentDocument(updated);
      setForm(formFromDto(updated, items));
      setActionModal(null);

      toast(`${updated.docNo || 'Document'} • ${action} completed.`);
    } catch (actionError) {
      toast(
        getApiErrorMessage(actionError, 'Action failed.'),
        'error'
      );
    }
  };

  const handlePost = async () => {
    setValidationMode('submit');

    const errors = validatePoInwardForm(form, itemsMap, true);

    if (errors.length > 0) {
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

    const docNo = currentDocument?.docNo || 'Document';

    if (action === 'approve') {
      setActionModal({
        action,
        title: `Approve ${docNo}`,
        body: 'Add approval comment (optional).',
        okLabel: 'Approve',
      });
    }

    if (action === 'reject') {
      setActionModal({
        action,
        title: `Reject ${docNo}`,
        body: 'Reason for rejection:',
        okLabel: 'Reject',
        danger: true,
      });
    }

    if (action === 'cancel') {
      setActionModal({
        action,
        title: `Cancel ${docNo}`,
        body: 'This creates an auditable reversal.',
        okLabel: 'Cancel Document',
        danger: true,
      });
    }
  };

  if (documentId && documentQuery.isPending) {
    return (
      <div className="panel">
        <div className="empty">
          <span className="material-symbols-rounded">hourglass_empty</span>
          Loading PO Inward document...
        </div>
      </div>
    );
  }

  if (documentId && documentQuery.isError) {
    return (
      <div className="panel">
        <div className="empty">
          <span className="material-symbols-rounded">error</span>
          {getApiErrorMessage(
            documentQuery.error,
            'Unable to load PO Inward document.'
          )}
          <div style={{ marginTop: '14px' }}>
            <button className="btn" onClick={() => documentQuery.refetch()}>
              <span className="material-symbols-rounded">refresh</span>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (lookups.isLoading) {
    return (
      <div className="panel">
        <div className="empty">
          <span className="material-symbols-rounded">hourglass_empty</span>
          Loading PO Inward master data...
        </div>
      </div>
    );
  }

  if (lookups.isError) {
    return (
      <div className="panel">
        <div className="empty">
          <span className="material-symbols-rounded">error</span>
          {lookups.errorMessage}
          <div style={{ marginTop: '14px' }}>
            <button className="btn" onClick={() => lookups.refetch()}>
              <span className="material-symbols-rounded">refresh</span>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pg-head">
        <h1>
          {viewOnly ? 'View' : documentId ? 'Edit' : 'Add'} PO Inward —{' '}
          {currentDocument?.docNo || 'New'}
        </h1>
        <p>Manage purchase order inward entries and stock updates</p>
      </div>

      <div className="note">
        <span className="material-symbols-rounded">info</span>
        <span>Workflow: DRAFT → SUBMITTED → APPROVED → POSTED</span>
      </div>

      <div id="valBox" ref={validationBoxRef}>
        {validationErrors.length > 0 && (
          <div className="vals">
            <span className="material-symbols-rounded">warning</span>
            <div>
              <b>Please fix the following:</b>
              <ul>
                {validationErrors.map((errorMessage: string) => (
                  <li key={errorMessage}>{errorMessage}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={(event) => event.preventDefault()}>
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
              <span>Inward Type</span>
              <input
                className="in"
                value="PO Inward"
                readOnly
                tabIndex={-1}
              />
            </label>

            <label className="fld">
              <span>Doc No</span>
              <input
                className="in"
                value={currentDocument?.docNo || 'Auto'}
                readOnly
                tabIndex={-1}
              />
            </label>

            <label className="fld">
              <span>
                Date <em>*</em>
              </span>
              <input
                type="date"
                className="in"
                value={form.date}
                readOnly={!editable}
                onChange={(event) => updateHeader('date', event.target.value)}
              />
            </label>

            <label className="fld">
              <span>
                Purchase Order <em>*</em>
              </span>
              <input
                className="in"
                list="po-number-options"
                placeholder="Search or select Purchase Order..."
                value={form.purchaseOrderNo}
                disabled={!editable}
                onChange={(event) =>
                  updateHeader('purchaseOrderNo', event.target.value)
                }
              />
              <datalist id="po-number-options">
                {purchaseOrders.map((purchaseOrder: any) => {
                  const num = purchaseOrder.docNo || purchaseOrder.number || '';
                  const supp = purchaseOrder.supplier || purchaseOrder.supplierName ? ` — ${purchaseOrder.supplier || purchaseOrder.supplierName}` : '';
                  return (
                    <option key={num} value={num}>
                      {num}{supp}
                    </option>
                  );
                })}
              </datalist>
            </label>

            <label className="fld">
              <span>
                Supplier <em>*</em>
              </span>
              <select
                className="in"
                value={form.supplier}
                disabled={!editable}
                onChange={(event) =>
                  updateHeader('supplier', event.target.value)
                }
              >
                <option value="">— Select Supplier —</option>
                {suppliers.map((supplier: any) => (
                  <option key={supplier.code} value={supplier.code}>
                    {supplier.name}
                  </option>
                ))}
                {form.supplier && !suppliers.some((s: any) => s.code === form.supplier || s.name === form.supplier) && (
                  <option value={form.supplier}>{form.supplier}</option>
                )}
              </select>
            </label>

            <label className="fld">
              <span>Supplier Invoice Number</span>
              <input
                className="in"
                value={form.supplierInvoiceNo}
                readOnly={!editable}
                onChange={(event) =>
                  updateHeader('supplierInvoiceNo', event.target.value)
                }
              />
            </label>

            <label className="fld">
              <span>DC Number</span>
              <input
                className="in"
                value={form.dcNumber}
                readOnly={!editable}
                onChange={(event) =>
                  updateHeader('dcNumber', event.target.value)
                }
              />
            </label>

            <label className="fld">
              <span>Vehicle No</span>
              <input
                className="in"
                value={form.vehicleNo}
                readOnly={!editable}
                onChange={(event) =>
                  updateHeader('vehicleNo', event.target.value)
                }
              />
            </label>

            <label className="fld">
              <span>
                Received By <em>*</em>
              </span>
              <input
                className="in"
                value={form.receivedBy}
                readOnly={!editable}
                onChange={(event) =>
                  updateHeader('receivedBy', event.target.value)
                }
              />
            </label>

            <label className="fld">
              <span>
                Quality Inspection Required <em>*</em>
              </span>
              <select
                className="in"
                value={form.qcRequired || 'Yes'}
                disabled={!editable}
                onChange={(event) => updateHeader('qcRequired', event.target.value)}
              >
                <option value="Yes">Yes (Go to IQC Inspection)</option>
                <option value="No">No (Directly Add to Store Stock)</option>
              </select>
            </label>

            <label className="fld span2">
              <span>Remarks</span>
              <input
                className="in"
                value={form.remarks}
                readOnly={!editable}
                onChange={(event) =>
                  updateHeader('remarks', event.target.value)
                }
              />
            </label>

            <label className="fld span2" style={{ gridColumn: 'span 2' }}>
              <span>File Attachment (Invoice / Challan / Inspection Copy)</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                {editable && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label className="btn btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#2563eb', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '6px', fontWeight: 600 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>attach_file</span>
                      Choose File to Attach
                      <input
                        type="file"
                        multiple
                        style={{ display: 'none' }}
                        onChange={handleFileUpload}
                      />
                    </label>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      Attach Supplier Invoice, Delivery Challan, Quality Report, or Images (Max 10MB)
                    </span>
                  </div>
                )}

                {attachments.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
                    {attachments.map(att => (
                      <div
                        key={att.id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 12px',
                          background: '#f8fafc',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          fontSize: '13px',
                        }}
                      >
                        <span className="material-symbols-rounded" style={{ fontSize: '18px', color: '#2563eb' }}>
                          description
                        </span>
                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{att.name}</span>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>({att.size})</span>
                        {att.url && (
                          <a
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="lbtn"
                            title="Download Attachment"
                            style={{ display: 'inline-flex', alignItems: 'center', color: '#2563eb', textDecoration: 'none', marginLeft: '4px' }}
                          >
                            <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>download</span>
                          </a>
                        )}
                        {editable && (
                          <button
                            type="button"
                            className="lbtn danger"
                            onClick={() => removeAttachment(att.id)}
                            title="Remove Attachment"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: '4px' }}
                          >
                            <span className="material-symbols-rounded" style={{ fontSize: '16px', color: '#ef4444' }}>close</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>
                    No file attached yet. Click "Choose File to Attach" above to upload invoice/challan copies.
                  </div>
                )}
              </div>
            </label>
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            <h2>
              <span className="material-symbols-rounded">table_view</span>
              Line Items
            </h2>

            <button
              type="button"
              className="btn btn-sm"
              onClick={addLine}
              disabled={!editable || isBusy}
            >
              <span className="material-symbols-rounded">add</span>
              Add Line
            </button>
          </div>
          <div className="twrap">
            <table className="tbl lines">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th style={{ minWidth: '130px' }}>Item Code *</th>
                  <th style={{ minWidth: '130px' }}>Item Name</th>
                  <th style={{ minWidth: '130px' }}>Description</th>
                  <th style={{ minWidth: '65px' }}>UOM</th>
                  <th style={{ minWidth: '65px' }}>Qty *</th>
                  <th style={{ minWidth: '65px' }}>Unit Price</th>
                  <th style={{ minWidth: '65px' }}>Disc (%)</th>
                  <th style={{ minWidth: '65px' }}>Tax (%)</th>
                  <th style={{ minWidth: '65px' }}>Tax Amt</th>
                  <th style={{ minWidth: '65px' }}>Net Amt</th>
                  <th style={{ minWidth: '65px' }}>Accepted</th>
                  <th style={{ minWidth: '65px' }}>Rejected</th>
                  <th style={{ minWidth: '100px' }}>Store Location *</th>
                  <th style={{ minWidth: '100px' }}>Remarks</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {form.lines.map((line, index) => {
                  const allowedItems = filterPurchaseRelevantItems(items);

                  const uomMasterList = lookups.uoms && lookups.uoms.length > 0
                    ? lookups.uoms
                    : [{ code: line.uom || 'PCS', name: line.uom || 'PCS' }];

                  // `locations` is already the merged store_master+location_master union
                  // (Priority#1 fix above) — no need to prefer stores separately here.
                  const storeList = locations;

                  return (
                    <tr key={index}>
                      <td className="num mut">{index + 1}</td>
                      <td className="w-i">
                        <SearchableItemLookup
                          value={line.itemCode}
                          disabled={!editable}
                          items={allowedItems}
                          onChange={(val) => updateLine(index, 'itemCode', val)}
                          placeholder="Search Item..."
                        />
                      </td>

                    <td className="w-i">
                      <input
                        className="in"
                        style={{ minWidth: '130px', padding: '5px 6px', fontSize: '.74rem', width: '100%' }}
                        value={line.itemDesc}
                        readOnly={!editable || line.itemCode !== 'OTHERS'}
                        placeholder={line.itemCode === 'OTHERS' ? 'Enter item name...' : ''}
                        onChange={(event) =>
                          updateLine(index, 'itemDesc', event.target.value)
                        }
                        tabIndex={line.itemCode === 'OTHERS' ? 0 : -1}
                      />
                    </td>

                    <td className="w-i">
                      <input
                        className="in"
                        style={{ minWidth: '130px', padding: '5px 6px', fontSize: '.74rem', width: '100%' }}
                        value={line.description}
                        disabled={!editable}
                        placeholder="Description..."
                        onChange={(event) =>
                          updateLine(index, 'description', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <select
                        className="in"
                        style={{ minWidth: '65px', padding: '5px 6px', fontSize: '.74rem', width: '100%' }}
                        value={line.uom || 'PCS'}
                        disabled={!editable}
                        onChange={(event) =>
                          updateLine(index, 'uom', event.target.value)
                        }
                      >
                        {uomMasterList.map((u: any) => (
                          <option key={u.code} value={u.code}>
                            {u.name || u.code}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <input
                        type="number"
                        step="any"
                        className="in"
                        style={{ minWidth: '65px', padding: '5px 6px', fontSize: '.74rem', width: '100%', textAlign: 'right' }}
                        value={line.receivedQty}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'receivedQty', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="any"
                        className="in"
                        style={{ minWidth: '65px', padding: '5px 6px', fontSize: '.74rem', width: '100%', textAlign: 'right' }}
                        value={line.rate}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'rate', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="any"
                        className="in"
                        style={{ minWidth: '65px', padding: '5px 6px', fontSize: '.74rem', width: '100%', textAlign: 'right' }}
                        value={line.discount}
                        readOnly={!editable}
                        placeholder="0"
                        onChange={(event) =>
                          updateLine(index, 'discount', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="any"
                        className="in"
                        style={{ minWidth: '65px', padding: '5px 6px', fontSize: '.74rem', width: '100%', textAlign: 'right' }}
                        value={line.tax}
                        readOnly={!editable}
                        placeholder="0"
                        onChange={(event) =>
                          updateLine(index, 'tax', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <input
                        className="in"
                        style={{ minWidth: '65px', padding: '5px 6px', fontSize: '.74rem', width: '100%', textAlign: 'right' }}
                        value={line.taxAmount}
                        readOnly
                        tabIndex={-1}
                      />
                    </td>

                    <td>
                      <input
                        className="in"
                        style={{ minWidth: '65px', padding: '5px 6px', fontSize: '.74rem', width: '100%', textAlign: 'right' }}
                        value={line.netAmount}
                        readOnly
                        tabIndex={-1}
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="any"
                        className="in"
                        style={{ minWidth: '65px', padding: '5px 6px', fontSize: '.74rem', width: '100%', textAlign: 'right' }}
                        value={line.acceptedQty}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'acceptedQty', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="number"
                          step="any"
                          className="in"
                          style={{ minWidth: '65px', padding: '5px 6px', fontSize: '.74rem', width: '100%', textAlign: 'right', flex: 1 }}
                          value={line.rejectedQty}
                          readOnly={!editable}
                          onChange={(event) =>
                            updateLine(index, 'rejectedQty', event.target.value)
                          }
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
                    </td>

                    <td>
                      <select
                        className="in"
                        style={{ minWidth: '100px', padding: '5px 6px', fontSize: '.74rem', width: '100%' }}
                        value={line.location}
                        disabled={!editable}
                        onChange={(event) =>
                          updateLine(index, 'location', event.target.value)
                        }
                      >
                        {storeList.map((store: any) => (
                          <option key={store.code} value={store.code}>
                            {store.name || store.code}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <input
                        className="in"
                        style={{ minWidth: '100px', padding: '5px 6px', fontSize: '.74rem', width: '100%' }}
                        value={line.remarks}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'remarks', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <button
                        type="button"
                        className="ibtn danger"
                        onClick={() => deleteLine(index)}
                        disabled={!editable || isBusy}
                      >
                        <span className="material-symbols-rounded">delete</span>
                      </button>
                    </td>
                  </tr>
                  );
                })}
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

            <button type="button" className="btn" onClick={onBack}>
              <span className="material-symbols-rounded">arrow_back</span>
              Back
            </button>

            {editable && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => save(false)}
                  disabled={isBusy}
                >
                  <span className="material-symbols-rounded">save</span>
                  Save Draft
                </button>

                {(form.qcRequired === 'No' || form.qcRequired === 'N' || form.qcRequired === 'false') ? (
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
                    type="button"
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

            {status === 'REJECTED' && (
              <button
                type="button"
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
                type="button"
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

            {!['POSTED', 'CANCELLED'].includes(status) && (
              <button
                type="button"
                className="btn btn-d"
                onClick={() => openActionModal('cancel')}
                disabled={isBusy}
              >
                <span className="material-symbols-rounded">block</span>
                Cancel
              </button>
            )}
          </div>
        </div>
      </form>

      <ConfirmActionModal
        open={Boolean(actionModal)}
        title={actionModal?.title ?? ''}
        body={actionModal?.body ?? ''}
        okLabel={actionModal?.okLabel ?? 'Confirm'}
        danger={actionModal?.danger}
        busy={actionMutation.isPending}
        onClose={() => setActionModal(null)}
        onConfirm={(note: string) => {
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
    </>
  );
}