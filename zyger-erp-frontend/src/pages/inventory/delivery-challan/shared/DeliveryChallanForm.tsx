import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { useToast } from '../../../../contexts/ToastContext';
import {
  useDcDocument,
  useDcLookups,
  useDcMutations,
  useDcNextNumber,
} from '../../../../hooks/useDeliveryChallan';
import type {
  DeliveryChallanDocumentAction,
  DeliveryChallanDto,
  DeliveryChallanTypeConfig,
} from '../../../../types/inventory/deliveryChallan.types';
import type {
  StockAvailabilityPair,
  StockAvailabilityResult,
} from '../../../../types/inventory/stockIssue.types';
import apiClient from '../../../../api/axiosClient';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { filterPurchaseRelevantItems } from '../../../../utils/itemClassification';
import { lookupDocumentByNumber } from '../../../../utils/documentLookup';
import StatusBadge from '../../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../../components/common/ConfirmActionModal';
import {
  buildPayload,
  createEmptyForm,
  createEmptyLine,
  formFromDto,
  validateDeliveryChallanForm,
  type DeliveryChallanFormState,
  type DeliveryChallanLineFormState,
} from './deliveryChallanForm';

interface ActionModalState {
  action: DeliveryChallanDocumentAction;
  title: string;
  body: string;
  okLabel: string;
  danger?: boolean;
}

interface DeliveryChallanFormProps {
  config: DeliveryChallanTypeConfig;
  documentId?: string | null;
  viewOnly?: boolean;
  onBack: () => void;
  onSaved?: (id: string) => void;
}

export default function DeliveryChallanForm({
  config,
  documentId,
  viewOnly = false,
  onBack,
  onSaved,
}: DeliveryChallanFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const lookups = useDcLookups(config);
  const documentQuery = useDcDocument(config, documentId ?? null);
  const nextNumberQuery = useDcNextNumber(config);

  const { createMutation, updateMutation, actionMutation } =
    useDcMutations(config);

  const [form, setForm] = useState<DeliveryChallanFormState>(() =>
    createEmptyForm()
  );
  const [currentDocument, setCurrentDocument] =
    useState<DeliveryChallanDto | null>(null);
  const [validationMode, setValidationMode] = useState<
    'draft' | 'submit' | null
  >(null);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(
    null
  );
  const [showPrintPreview, setShowPrintPreview] = useState<boolean>(false);

  const [availabilityMap, setAvailabilityMap] = useState<Record<string, string>>(
    {}
  );

  const validationBoxRef = useRef<HTMLDivElement | null>(null);
  const initializedFor = useRef<string | null>(null);

  const items = lookups.items;
  const locations = lookups.stores ?? [];
  const partyOptions = lookups.partyOptions;

  const itemsMap = useMemo(
    () => new Map(items.map((item) => [item.code, item])),
    [items]
  );

  const allowedItems = useMemo(() => filterPurchaseRelevantItems(items), [items]);

  const partyDetailsMap = useMemo(() => {
    const map = new Map<
      string,
      { address: string; gstin: string; contactPerson: string; phone: string }
    >();
    if (config.partySource === 'customers') {
      const customers = lookups.parties as Array<{
        code: string;
        address?: string;
        billingAddress?: string;
        shippingAddress?: string;
        gstin?: string;
        contactPerson?: string;
        phone?: string;
        mobile?: string;
      }>;
      for (const p of customers) {
        map.set(p.code, {
          address: p.billingAddress || p.address || p.shippingAddress || '',
          gstin: p.gstin || '',
          contactPerson: p.contactPerson || '',
          phone: p.phone || p.mobile || '',
        });
      }
    }
    return map;
  }, [lookups.parties, config.partySource]);

  useEffect(() => {
    if (config.partySource !== 'customers') return;
    const info = partyDetailsMap.get(form.party);
    if (!info) return;
    setForm((prev) => ({
      ...prev,
      partyAddress: info.address,
      partyGstin: info.gstin,
      partyContactPerson: info.contactPerson,
      partyPhone: info.phone,
      billingAddress: prev.billingAddress || info.address,
      gstin: prev.gstin || info.gstin,
    }));
  }, [form.party, partyDetailsMap, config.partySource]);

  const status = currentDocument?.status ?? 'DRAFT';
  const editable = !viewOnly && (status === 'DRAFT' || status === 'REJECTED');

  useEffect(() => {
    if (documentId || !editable) return;
    if (!locations.length) return;
    setForm((previous) => {
      if (previous.sourceLocation) return previous;
      const defaultLocation = locations[0].code;
      return {
        ...previous,
        sourceLocation: defaultLocation,
        lines: previous.lines.map((line) => ({
          ...line,
          location: line.location || defaultLocation,
        })),
      };
    });
  }, [locations, documentId, editable]);

  const docNo =
    currentDocument?.docNo ||
    nextNumberQuery.data?.nextNumber ||
    'Auto';

  useEffect(() => {
    if (!documentId) {
      initializedFor.current = null;
      setCurrentDocument(null);
      setForm(createEmptyForm());
      return;
    }

    if (documentQuery.data && initializedFor.current !== documentId) {
      initializedFor.current = documentId;
      setCurrentDocument(documentQuery.data);
      setForm(formFromDto(documentQuery.data, items));
    }
  }, [documentId, documentQuery.data, items]);

  useEffect(() => {
    if (!items.length) return;

    setForm((previous) => ({
      ...previous,
      lines: previous.lines.map((line) => {
        if (!line.itemCode) return line;
        const item = itemsMap.get(line.itemCode);
        if (!item) return line;
        return {
          ...line,
          itemDesc: line.itemDesc || item.description,
          hsnCode: line.hsnCode || (item as any)?.hsnCode || (item as any)?.hsn || '',
          uom: line.uom || item.uom || 'PCS',
        };
      }),
    }));
  }, [items, itemsMap]);

  const availabilityKey = (itemCode: string, location: string) =>
    `${itemCode}||${location}`;

  const availabilityPairs: StockAvailabilityPair[] = useMemo(
    () =>
      form.lines
        .filter((line) => line.itemCode && line.location)
        .map((line) => ({
          itemCode: line.itemCode,
          location: line.location,
        })),
    [form.lines]
  );

  useEffect(() => {
    if (availabilityPairs.length === 0) {
      setAvailabilityMap({});
      return;
    }

    let active = true;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.post<
          StockAvailabilityResult[] | { results: StockAvailabilityResult[] }
        >(
          '/inventory/stock/availability/check',
          { lines: availabilityPairs },
          { signal: controller.signal }
        );

        if (!active) return;

        const data = res.data;
        const results = Array.isArray(data) ? data : data.results ?? [];
        const nextMap: Record<string, string> = {};

        results.forEach((result) => {
          nextMap[availabilityKey(result.itemCode, result.location)] =
            String(result.availableQty ?? 0);
        });

        setAvailabilityMap(nextMap);
      } catch {
        if (active) {
          setAvailabilityMap({});
        }
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [availabilityPairs]);

  const validationErrors = useMemo(() => {
    if (!validationMode) return [];
    return validateDeliveryChallanForm(
      config,
      form,
      itemsMap,
      validationMode === 'submit',
      availabilityMap
    );
  }, [config, form, itemsMap, validationMode, availabilityMap]);

  useEffect(() => {
    if (validationErrors.length > 0 && validationBoxRef.current) {
      validationBoxRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [validationErrors]);

  const updateField = (
    key: keyof Omit<DeliveryChallanFormState, 'lines'>,
    value: any
  ) => {
    setForm((previous) => {
      const next = {
        ...previous,
        [key]: value,
      };

      if (key === 'sourceLocation') {
        next.lines = previous.lines.map((line) =>
          (!line.location || line.location === previous.sourceLocation)
            ? { ...line, location: value }
            : line
        );
      }

      if (key === 'party') {
        const info = partyDetailsMap.get(value);
        if (info) {
          next.partyAddress = info.address;
          next.partyGstin = info.gstin;
          next.partyContactPerson = info.contactPerson;
          next.partyPhone = info.phone;
          if (config.screenId === 'general-dc') {
            next.billingAddress = info.address;
            next.gstin = info.gstin;
          }
        }
      }

      return next;
    });

    if (key === 'jobOrderNo' && value) {
      lookupDocumentByNumber('job-order', value).then((doc: any) => {
        if (!doc) return;
        setForm((prev) => ({
          ...prev,
          party: doc.jobWorker || doc.party || doc.vendor || prev.party,
          processName: doc.processName || doc.process || prev.processName,
          lines: doc.lines && doc.lines.length > 0 ? doc.lines.map((l: any) => ({
            itemCode: l.itemCode,
            itemDesc: l.itemDesc || itemsMap.get(l.itemCode)?.description || '',
            qty: String(l.pendingQty || l.qty || ''),
            rate: String(l.rate || ''),
            amount: String(l.amount || ''),
            hsnCode: l.hsnCode || '',
            uom: l.uom || 'PCS',
            batchNo: l.batchNo || '',
            heatNo: l.heatNo || '',
            location: prev.sourceLocation || '',
            taxPercent: '',
            transferValue: '',
            remarks: l.remarks || '',
          })) : prev.lines,
        }));
      });
    }

    if (key === 'salesOrderNo' && value) {
      lookupDocumentByNumber('sales-order', value).then((doc: any) => {
        if (!doc) return;
        setForm((prev) => ({
          ...prev,
          party: doc.customer || doc.party || prev.party,
          billingAddress: doc.billingAddress || prev.billingAddress,
          shippingAddress: doc.shippingAddress || prev.shippingAddress,
          gstin: doc.gstin || prev.gstin,
          lines: doc.lines && doc.lines.length > 0 ? doc.lines.map((l: any) => ({
            itemCode: l.itemCode,
            itemDesc: l.itemDesc || itemsMap.get(l.itemCode)?.description || '',
            qty: String(l.qty || l.orderQty || ''),
            rate: String(l.rate || ''),
            amount: String(l.amount || ''),
            hsnCode: l.hsnCode || '',
            uom: l.uom || 'PCS',
            batchNo: l.batchNo || '',
            heatNo: l.heatNo || '',
            location: prev.sourceLocation || '',
            taxPercent: String(l.taxPercent || ''),
            transferValue: '',
            remarks: l.remarks || '',
          })) : prev.lines,
        }));
      });
    }

    if (key === 'transferRequestNo' && value) {
      lookupDocumentByNumber('stock-issue-request', value).then((doc: any) => {
        if (!doc) return;
        setForm((prev) => ({
          ...prev,
          sourceLocation: doc.sourceLocation || prev.sourceLocation,
          destinationLocation: doc.destinationLocation || prev.destinationLocation,
          lines: doc.lines && doc.lines.length > 0 ? doc.lines.map((l: any) => ({
            itemCode: l.itemCode,
            itemDesc: l.itemDesc || itemsMap.get(l.itemCode)?.description || '',
            qty: String(l.requestedQty || l.qty || ''),
            rate: '',
            amount: '',
            hsnCode: l.hsnCode || '',
            uom: l.uom || 'PCS',
            batchNo: l.batchNo || '',
            heatNo: l.heatNo || '',
            location: doc.sourceLocation || prev.sourceLocation || '',
            taxPercent: '',
            transferValue: String(l.transferValue || ''),
            remarks: l.remarks || '',
          })) : prev.lines,
        }));
      });
    }
  };

  const updateLine = (
    index: number,
    key: keyof DeliveryChallanLineFormState,
    value: string
  ) => {
    setForm((previous) => {
      const lines = [...previous.lines];
      const line = {
        ...lines[index],
        [key]: value,
      };

      if (key === 'itemCode') {
        const item = itemsMap.get(value);
        line.itemDesc = item?.description ?? '';
        line.hsnCode = (item as any)?.hsnCode ?? (item as any)?.hsn ?? '';
        line.uom = item?.uom ?? 'PCS';
        if (!line.location) {
          line.location = previous.sourceLocation || locations[0]?.code || '';
        }
      }

      if (key === 'qty' || key === 'rate') {
        const q = parseFloat(key === 'qty' ? value : line.qty) || 0;
        const r = parseFloat(key === 'rate' ? value : line.rate) || 0;
        if (q > 0 && r > 0) {
          line.amount = (q * r).toFixed(2);
        }
      }

      lines[index] = line;
      return {
        ...previous,
        lines,
      };
    });
  };

  const addLine = () => {
    if (!editable) return;
    setForm((previous) => ({
      ...previous,
      lines: [...previous.lines, createEmptyLine(previous.sourceLocation)],
    }));
  };

  const deleteLine = (index: number) => {
    if (!editable) return;
    setForm((previous) => {
      const lines = [...previous.lines];
      if (lines.length === 1) {
        lines[0] = createEmptyLine(previous.sourceLocation);
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
    if (!editable) return;

    setValidationMode(submit ? 'submit' : 'draft');
    const errors = validateDeliveryChallanForm(config, form, itemsMap, submit, availabilityMap);

    if (errors.length > 0) return;

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
      let saved: DeliveryChallanDto;

      if (targetId) {
        saved = await updateMutation.mutateAsync({
          id: targetId,
          payload,
        });
      } else {
        saved = await createMutation.mutateAsync(payload);
      }

      if (submit && saved.status !== 'POSTED' && saved.status !== 'CONFIRMED' && saved.id) {
        saved = await actionMutation.mutateAsync({
          id: saved.id,
          action: 'post',
          note: 'Save & Confirm DC',
        });
      }

      setCurrentDocument(saved);
      setForm(formFromDto(saved, items));

      if (saved.id) {
        initializedFor.current = saved.id;
        onSaved?.(saved.id);
      }

      toast(
        `${saved.docNo || config.title} ${
          submit ? 'saved and stock movement posted' : 'saved as draft'
        }.`
      );
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

  const runAction = async (
    action: DeliveryChallanDocumentAction,
    note: string
  ) => {
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

      toast(`${updated.docNo || config.title} • ${action} completed.`);
    } catch (actionError) {
      toast(getApiErrorMessage(actionError, 'Action failed.'), 'error');
    }
  };

  const openActionModal = (action: 'approve' | 'reject' | 'cancel') => {
    const id = currentDocument?.id ?? documentId;

    if (!id) {
      toast('Document is not saved yet.', 'error');
      return;
    }

    const docNumber = currentDocument?.docNo || config.title;

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
        body: 'Provide mandatory cancellation remark. This automatically reverses stock movement.',
        okLabel: 'Cancel Document',
        danger: true,
      });
    }
  };

  const handleClearNew = () => {
    if (currentDocument?.id || documentId) {
      onBack();
      return;
    }
    initializedFor.current = null;
    setCurrentDocument(null);
    setForm(createEmptyForm());
    setAvailabilityMap({});
    setValidationMode(null);
    nextNumberQuery.refetch();
  };

  const handlePrint = (download: boolean) => {
    const id = currentDocument?.id || documentId;
    if (!id) {
      toast('Please save the document before printing.', 'error');
      return;
    }
    const printUrl = `/api/inventory/delivery-challan/${config.screenId}/${id}/print?download=${download}`;
    if (download) {
      window.open(printUrl, '_blank');
    } else {
      setShowPrintPreview(true);
    }
  };

  const totalQty = form.lines.reduce((acc, l) => acc + (parseFloat(l.qty) || 0), 0);
  const totalAmount = form.lines.reduce((acc, l) => acc + (parseFloat(l.amount) || (parseFloat(l.qty) || 0) * (parseFloat(l.rate) || 0)), 0);

  if (documentId && documentQuery.isPending) {
    return (
      <div className="panel">
        <div className="empty">
          <span className="material-symbols-rounded">hourglass_empty</span>
          Loading {config.title} document...
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
            `Unable to load ${config.title} document.`
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
          Loading {config.title} master data...
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pg-head">
        <h1>
          {viewOnly ? 'View' : documentId ? 'Edit' : 'Add'} {config.title} — {docNo}
        </h1>
        <p>{config.subtitle}</p>
      </div>

      <div className="note">
        <span className="material-symbols-rounded">info</span>
        <span>
          Workflow: DRAFT → CONFIRMED / POSTED • Stock movement posts automatically on Save
        </span>
      </div>

      <div id="valBox" ref={validationBoxRef}>
        {validationErrors.length > 0 && (
          <div className="vals">
            <span className="material-symbols-rounded">warning</span>
            <div>
              <b>Please fix the following:</b>
              <ul>
                {validationErrors.map((errorMessage) => (
                  <li key={errorMessage}>{errorMessage}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={(event) => event.preventDefault()}>
        {/* SECTION A: COMMON HEADER FIELDS */}
        <div className="panel">
          <div className="panel-h">
            <h2>
              <span className="material-symbols-rounded">description</span>
              Header Section (Common Fields)
            </h2>

            <StatusBadge status={status} />
          </div>

          <div className="fgrid">
            <label className="fld">
              <span>DC Type</span>
              <input className="in" value={config.title} readOnly tabIndex={-1} />
            </label>

            <label className="fld">
              <span>DC No</span>
              <input className="in" value={docNo} readOnly tabIndex={-1} />
            </label>

            <label className="fld">
              <span>
                DC Date <em>*</em>
              </span>
              <input
                type="date"
                className="in"
                value={form.date}
                readOnly={!editable}
                onChange={(event) => updateField('date', event.target.value)}
              />
            </label>

            <label className="fld">
              <span>Financial Year</span>
              <input
                className="in"
                value={form.date ? `${new Date(form.date).getFullYear()}-${new Date(form.date).getFullYear() + 1}` : '2026-2027'}
                readOnly
                tabIndex={-1}
              />
            </label>

            <label className="fld">
              <span>
                From Location <em>*</em>
              </span>
              <select
                className="in"
                value={form.sourceLocation}
                disabled={!editable}
                onChange={(event) =>
                  updateField('sourceLocation', event.target.value)
                }
              >
                <option value="">— Select Location —</option>
                {locations.map((location) => (
                  <option key={location.code} value={location.code}>
                    {location.name || location.code}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld">
              <span>
                {config.partyLabel} <em>*</em>
              </span>
              {config.screenId === 'transfer-dc' ? (
                <select
                  className="in"
                  value={form.destinationLocation || form.party}
                  disabled={!editable}
                  onChange={(event) => {
                    updateField('party', event.target.value);
                    updateField('destinationLocation', event.target.value);
                  }}
                >
                  <option value="">— Select To Location / Branch —</option>
                  {locations.map((location) => (
                    <option key={location.code} value={location.code}>
                      {location.name || location.code}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="in"
                  value={form.party}
                  disabled={!editable}
                  onChange={(event) => updateField('party', event.target.value)}
                >
                  <option value="">— Select Party —</option>
                  {partyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </label>

            <label className="fld">
              <span>Reference No</span>
              <input
                className="in"
                placeholder="PO / SO / JO / TR No"
                value={form.referenceNo || form.linkedDocumentNo}
                readOnly={!editable}
                onChange={(event) => {
                  updateField('referenceNo', event.target.value);
                  updateField('linkedDocumentNo', event.target.value);
                }}
              />
            </label>

            <label className="fld">
              <span>Reference Date</span>
              <input
                type="date"
                className="in"
                value={form.referenceDate}
                readOnly={!editable}
                onChange={(event) => updateField('referenceDate', event.target.value)}
              />
            </label>

            <label className="fld">
              <span>Vehicle No</span>
              <input
                className="in"
                placeholder="e.g. KA-05-AB-1234"
                style={{ textTransform: 'uppercase' }}
                value={form.vehicleNo}
                readOnly={!editable}
                onChange={(event) =>
                  updateField('vehicleNo', event.target.value.toUpperCase())
                }
              />
            </label>

            <label className="fld">
              <span>Transporter Name</span>
              <input
                className="in"
                value={form.transporter}
                readOnly={!editable}
                onChange={(event) =>
                  updateField('transporter', event.target.value)
                }
              />
            </label>

            <label className="fld">
              <span>LR No / Docket No</span>
              <input
                className="in"
                value={form.lrNo}
                readOnly={!editable}
                onChange={(event) => updateField('lrNo', event.target.value)}
              />
            </label>

            <label className="fld">
              <span>Mode of Transport</span>
              <select
                className="in"
                value={form.modeOfTransport}
                disabled={!editable}
                onChange={(event) => updateField('modeOfTransport', event.target.value)}
              >
                <option value="Road">Road</option>
                <option value="Rail">Rail</option>
                <option value="Air">Air</option>
                <option value="Sea">Sea</option>
                <option value="Courier">Courier</option>
              </select>
            </label>

            <label className="fld" style={{ gridColumn: 'span 2' }}>
              <span>Remarks</span>
              <input
                className="in"
                placeholder="Narration / internal notes"
                value={form.remarks}
                readOnly={!editable}
                onChange={(event) =>
                  updateField('remarks', event.target.value)
                }
              />
            </label>
          </div>
        </div>

        {/* SECTION B: TYPE-SPECIFIC HEADER FIELDS */}
        {config.screenId === 'jo-dc' && (
          <div className="panel">
            <div className="panel-h">
              <h2>
                <span className="material-symbols-rounded">build</span>
                Job Order DC (JO DC) Specific Fields
              </h2>
            </div>
            <div className="fgrid">
              <label className="fld">
                <span>Job Order No *</span>
                <input
                  className="in"
                  placeholder="Select or enter Job Order No"
                  value={form.jobOrderNo}
                  readOnly={!editable}
                  onChange={(e) => updateField('jobOrderNo', e.target.value)}
                />
              </label>

              <label className="fld" style={{ gridColumn: 'span 2' }}>
                <span>Challan Purpose *</span>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '6px' }}>
                  <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      type="radio"
                      name="challanPurpose"
                      value="Sending for Job Work"
                      checked={form.challanPurpose === 'Sending for Job Work'}
                      disabled={!editable}
                      onChange={(e) => updateField('challanPurpose', e.target.value)}
                    />
                    Sending for Job Work
                  </label>
                  <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      type="radio"
                      name="challanPurpose"
                      value="Receiving after Job Work"
                      checked={form.challanPurpose === 'Receiving after Job Work'}
                      disabled={!editable}
                      onChange={(e) => updateField('challanPurpose', e.target.value)}
                    />
                    Receiving after Job Work
                  </label>
                </div>
              </label>

              <label className="fld">
                <span>Process Name</span>
                <input
                  className="in"
                  placeholder="e.g. Plating, Heat Treatment"
                  value={form.processName}
                  readOnly
                  tabIndex={-1}
                />
              </label>

              {form.challanPurpose === 'Sending for Job Work' && (
                <label className="fld">
                  <span>Expected Return Date</span>
                  <input
                    type="date"
                    className="in"
                    value={form.expectedReturnDate}
                    readOnly={!editable}
                    onChange={(e) => updateField('expectedReturnDate', e.target.value)}
                  />
                </label>
              )}

              <label className="fld" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '18px' }}>
                <input
                  type="checkbox"
                  checked={form.jobWorkRateApplicable}
                  disabled={!editable}
                  onChange={(e) => updateField('jobWorkRateApplicable', e.target.checked)}
                />
                <span>Job Work Rate Applicable</span>
              </label>

              {form.jobWorkRateApplicable && (
                <label className="fld">
                  <span>GST on Job Work</span>
                  <select
                    className="in"
                    value={form.gstOnJobWork}
                    disabled={!editable}
                    onChange={(e) => updateField('gstOnJobWork', e.target.value)}
                  >
                    <option value="Nil">Nil</option>
                    <option value="Applicable">Applicable</option>
                  </select>
                </label>
              )}
            </div>
          </div>
        )}

        {config.screenId === 'general-dc' && (
          <div className="panel">
            <div className="panel-h">
              <h2>
                <span className="material-symbols-rounded">store</span>
                General DC Specific Fields
              </h2>
            </div>
            <div className="fgrid">
              <label className="fld">
                <span>DC Against *</span>
                <select
                  className="in"
                  value={form.dcAgainst}
                  disabled={!editable}
                  onChange={(e) => updateField('dcAgainst', e.target.value)}
                >
                  <option value="Sale">Sale</option>
                  <option value="Sample">Sample</option>
                  <option value="Approval">Approval</option>
                  <option value="Replacement">Replacement</option>
                  <option value="Others">Others</option>
                </select>
              </label>

              <label className="fld">
                <span>Sales Order No</span>
                <input
                  className="in"
                  placeholder="Sales Order reference"
                  value={form.salesOrderNo}
                  readOnly={!editable}
                  onChange={(e) => updateField('salesOrderNo', e.target.value)}
                />
              </label>

              <label className="fld">
                <span>GSTIN</span>
                <input
                  className="in"
                  value={form.gstin}
                  readOnly={!editable}
                  onChange={(e) => updateField('gstin', e.target.value)}
                />
              </label>

              <label className="fld">
                <span>Payment Terms</span>
                <input
                  className="in"
                  placeholder="e.g. 30 Days Net"
                  value={form.paymentTerms}
                  readOnly={!editable}
                  onChange={(e) => updateField('paymentTerms', e.target.value)}
                />
              </label>

              <label className="fld" style={{ gridColumn: 'span 2' }}>
                <span>Billing Address *</span>
                <textarea
                  className="in"
                  rows={2}
                  style={{ height: 'auto' }}
                  value={form.billingAddress}
                  readOnly={!editable}
                  onChange={(e) => updateField('billingAddress', e.target.value)}
                />
              </label>

              <label className="fld" style={{ gridColumn: 'span 2' }}>
                <span>Shipping Address *</span>
                <textarea
                  className="in"
                  rows={2}
                  style={{ height: 'auto' }}
                  value={form.shippingAddress}
                  readOnly={!editable}
                  onChange={(e) => updateField('shippingAddress', e.target.value)}
                />
              </label>

              <label className="fld" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={form.taxApplicable}
                  disabled={!editable}
                  onChange={(e) => updateField('taxApplicable', e.target.checked)}
                />
                <span>Tax Applicable</span>
              </label>

              <label className="fld" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={form.convertToInvoiceLater}
                  disabled={!editable}
                  onChange={(e) => updateField('convertToInvoiceLater', e.target.checked)}
                />
                <span>Convert to Invoice Later</span>
              </label>
            </div>
          </div>
        )}

        {config.screenId === 'transfer-dc' && (
          <div className="panel">
            <div className="panel-h">
              <h2>
                <span className="material-symbols-rounded">sync_alt</span>
                Transfer DC Specific Fields
              </h2>
            </div>
            <div className="fgrid">
              <label className="fld">
                <span>Transfer Type *</span>
                <select
                  className="in"
                  value={form.transferType}
                  disabled={!editable}
                  onChange={(e) => updateField('transferType', e.target.value)}
                >
                  <option value="Inter-Branch">Inter-Branch</option>
                  <option value="Inter-Godown">Inter-Godown</option>
                  <option value="Inter-Plant">Inter-Plant</option>
                </select>
              </label>

              <label className="fld">
                <span>Transfer Request No</span>
                <input
                  className="in"
                  placeholder="Stock Transfer Request reference"
                  value={form.transferRequestNo}
                  readOnly={!editable}
                  onChange={(e) => updateField('transferRequestNo', e.target.value)}
                />
              </label>

              <label className="fld" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '18px' }}>
                <input
                  type="checkbox"
                  checked={form.approvalRequired}
                  disabled={!editable}
                  onChange={(e) => updateField('approvalRequired', e.target.checked)}
                />
                <span>Approval Required</span>
              </label>

              <label className="fld" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '18px' }}>
                <input
                  type="checkbox"
                  checked={form.inTransitTracking}
                  disabled={!editable}
                  onChange={(e) => updateField('inTransitTracking', e.target.checked)}
                />
                <span>In-Transit Tracking (Goods-in-Transit)</span>
              </label>
            </div>
          </div>
        )}

        {/* SECTION C: LINE ITEM GRID */}
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
                  <th>Sl No</th>
                  <th>Item Code *</th>
                  <th>Description</th>
                  <th>HSN</th>
                  <th>Batch / Lot No</th>
                  <th>UOM</th>
                  <th>Qty *</th>
                  <th>Available</th>
                  {(form.jobWorkRateApplicable || config.screenId === 'general-dc') && <th>Rate</th>}
                  {form.taxApplicable && <th>Tax %</th>}
                  {(form.jobWorkRateApplicable || config.screenId === 'general-dc') && <th>Amount</th>}
                  {config.screenId === 'transfer-dc' && <th>Transfer Value</th>}
                  <th>Line Remarks</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {form.lines.map((line, index) => (
                  <tr key={index}>
                    <td className="num mut">{index + 1}</td>
                    <td>
                      <select
                        className="in w-i"
                        value={line.itemCode}
                        disabled={!editable}
                        onChange={(event) =>
                          updateLine(index, 'itemCode', event.target.value)
                        }
                      >
                        <option value="">— Select Item —</option>
                        {allowedItems.map((item) => (
                          <option key={item.code} value={item.code}>
                            {item.code} — {item.description}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <input
                        className="in"
                        value={line.itemDesc}
                        readOnly
                        tabIndex={-1}
                      />
                    </td>

                    <td>
                      <input
                        className="in"
                        style={{ width: '80px' }}
                        value={line.hsnCode}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'hsnCode', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <input
                        className="in"
                        placeholder="Batch/Lot"
                        value={line.batchNo}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'batchNo', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <input
                        className="in"
                        style={{ width: '60px' }}
                        value={line.uom}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'uom', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="any"
                        className="in"
                        style={{ width: '90px' }}
                        value={line.qty}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'qty', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <input
                        className="in mut"
                        style={{ width: '80px' }}
                        value={
                          line.itemCode && line.location
                            ? availabilityMap[availabilityKey(line.itemCode, line.location)] ?? '—'
                            : '—'
                        }
                        readOnly
                        tabIndex={-1}
                      />
                    </td>

                    {(form.jobWorkRateApplicable || config.screenId === 'general-dc') && (
                      <td>
                        <input
                          type="number"
                          step="any"
                          className="in"
                          style={{ width: '90px' }}
                          value={line.rate}
                          readOnly={!editable}
                          onChange={(event) =>
                            updateLine(index, 'rate', event.target.value)
                          }
                        />
                      </td>
                    )}

                    {form.taxApplicable && (
                      <td>
                        <input
                          type="number"
                          step="any"
                          className="in"
                          style={{ width: '70px' }}
                          value={line.taxPercent}
                          readOnly={!editable}
                          onChange={(event) =>
                            updateLine(index, 'taxPercent', event.target.value)
                          }
                        />
                      </td>
                    )}

                    {(form.jobWorkRateApplicable || config.screenId === 'general-dc') && (
                      <td>
                        <input
                          className="in"
                          style={{ width: '100px' }}
                          value={line.amount}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                    )}

                    {config.screenId === 'transfer-dc' && (
                      <td>
                        <input
                          type="number"
                          step="any"
                          className="in"
                          style={{ width: '90px' }}
                          value={line.transferValue}
                          readOnly={!editable}
                          onChange={(event) =>
                            updateLine(index, 'transferValue', event.target.value)
                          }
                        />
                      </td>
                    )}

                    <td>
                      <input
                        className="in"
                        placeholder="Item remark"
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
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px', background: 'var(--surface-2, #f7f7f8)', gap: '24px', fontWeight: 'bold' }}>
            <span>Total Qty: {totalQty}</span>
            {totalAmount > 0 && <span>Total Amount: ₹ {totalAmount.toFixed(2)}</span>}
          </div>
        </div>

        {/* SECTION D: ACTION BUTTONS */}
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

            {!viewOnly && (
              <button
                type="button"
                className="btn"
                onClick={handleClearNew}
                disabled={isBusy}
              >
                <span className="material-symbols-rounded">add_circle</span>
                New / Clear
              </button>
            )}

            {editable && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => save(false)}
                  disabled={isBusy}
                >
                  <span className="material-symbols-rounded">save</span>
                  Save as Draft
                </button>

                <button
                  type="button"
                  className="btn btn-p"
                  onClick={() => save(true)}
                  disabled={isBusy}
                >
                  <span className="material-symbols-rounded">check_circle</span>
                  Save & Post Stock
                </button>
              </>
            )}

            {(currentDocument?.id || documentId) && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => handlePrint(false)}
                >
                  <span className="material-symbols-rounded">visibility</span>
                  Print Preview
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() => handlePrint(false)}
                >
                  <span className="material-symbols-rounded">print</span>
                  Print
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() => handlePrint(true)}
                >
                  <span className="material-symbols-rounded">download</span>
                  Download PDF
                </button>
              </>
            )}

            {config.screenId === 'transfer-dc' &&
              currentDocument?.inTransitTracking &&
              !currentDocument?.receiptConfirmed &&
              (status === 'CONFIRMED' || status === 'POSTED') && (
                <button
                  type="button"
                  className="btn btn-p"
                  onClick={() => runAction('confirm-receipt', 'Destination receipt confirmed')}
                  disabled={isBusy}
                >
                  <span className="material-symbols-rounded">move_to_inbox</span>
                  Confirm Receipt at Destination
                </button>
              )}

            {(status === 'DRAFT' || status === 'CONFIRMED' || status === 'POSTED') && (currentDocument?.id || documentId) && (
              <button
                type="button"
                className="btn btn-d"
                onClick={() => openActionModal('cancel')}
                disabled={isBusy}
              >
                <span className="material-symbols-rounded">cancel</span>
                Cancel DC
              </button>
            )}
          </div>
        </div>
      </form>

      {/* PRINT PREVIEW MODAL */}
      {showPrintPreview && (currentDocument?.id || documentId) && (
        <div className="modal-backdrop" onClick={() => setShowPrintPreview(false)}>
          <div
            className="modal-box"
            style={{ maxWidth: '850px', width: '90%', height: '85vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #ccc' }}>
              <h3>Print Preview — {docNo}</h3>
              <button type="button" className="btn btn-sm" onClick={() => setShowPrintPreview(false)}>
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>
            <div style={{ flex: 1, padding: 0 }}>
              <iframe
                src={`/api/inventory/delivery-challan/${config.screenId}/${currentDocument?.id || documentId}/print?download=false`}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="DC Print Preview"
              />
            </div>
          </div>
        </div>
      )}

      {actionModal && (
        <ConfirmActionModal
          open={!!actionModal}
          title={actionModal.title}
          body={actionModal.body}
          okLabel={actionModal.okLabel}
          danger={actionModal.danger}
          onConfirm={(note) => runAction(actionModal.action, note)}
          onClose={() => setActionModal(null)}
        />
      )}
    </>
  );
}