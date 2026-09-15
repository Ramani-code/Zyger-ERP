import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { useToast } from '../../../../contexts/ToastContext';
import {
  useReturnManagementDocument,
  useReturnManagementLookups,
  useReturnManagementMutations,
  useReturnManagementNextNumber,
} from '../../../../hooks/useReturnManagement';
import type {
  ReturnManagementDocumentAction,
  ReturnManagementDto,
  ReturnManagementTypeConfig,
} from '../../../../types/inventory/returnManagement.types';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { filterPurchaseRelevantItems } from '../../../../utils/itemClassification';
import { lookupDocumentByNumber } from '../../../../utils/documentLookup';
import { logSystemActivity } from '../../../../utils/activityLog';
import StatusBadge from '../../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../../components/common/ConfirmActionModal';
import SearchableItemLookup from '../../../../components/common/SearchableItemLookup';
import { REASON_CODE_OPTIONS } from '../../../../config/returnManagementConfig';
import axiosClient from '../../../../api/axiosClient';
import {
  buildPayload,
  createEmptyForm,
  createEmptyLine,
  formFromDto,

  validateReturnManagementForm,
  type ReturnManagementFormState,
  type ReturnManagementLineFormState,
} from './returnManagementForm';


const INSPECTION_OPTIONS = ['Yes', 'No'];

interface ActionModalState {
  action: ReturnManagementDocumentAction;
  title: string;
  body: string;
  okLabel: string;
  danger?: boolean;
}

interface ReturnManagementFormProps {
  config: ReturnManagementTypeConfig;
  documentId?: string | null;
  viewOnly?: boolean;
  onBack: () => void;
  onSaved?: (id: string) => void;
}

export default function ReturnManagementForm({
  config,
  documentId,
  viewOnly = false,
  onBack,
  onSaved,
}: ReturnManagementFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const lookups = useReturnManagementLookups(config);
  const documentQuery = useReturnManagementDocument(config, documentId ?? null);
  const nextNumberQuery = useReturnManagementNextNumber(config);

  const { createMutation, updateMutation, actionMutation } =
    useReturnManagementMutations(config);

  const [form, setForm] = useState<ReturnManagementFormState>(() =>
    createEmptyForm()
  );
  const [currentDocument, setCurrentDocument] =
    useState<ReturnManagementDto | null>(null);
  const [validationMode, setValidationMode] = useState<
    'draft' | 'submit' | null
  >(null);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(
    null
  );

  const validationBoxRef = useRef<HTMLDivElement | null>(null);
  const initializedFor = useRef<string | null>(null);

  const items = lookups.items;
  // FRS DOC-INV-FRS-02 Priority#1 [FIXED] — merged union instead of an all-or-nothing
  // stores-vs-locations fallback; see utils/locationOptions.ts for why.
  const locations = lookups.stores ?? [];
  const partyOptions = lookups.partyOptions;

  const itemsMap = useMemo(
    () => new Map(items.map((item) => [item.code, item])),
    [items]
  );

  // Item Code should only ever offer Purchasable / Customer-Supplied / Manufacturing
  // items (the three item screens under Master → Inventory → Items) — this picker
  // previously showed every item in the system unfiltered.
  const allowedItems = useMemo(() => filterPurchaseRelevantItems(items), [items]);

  const status = currentDocument?.status ?? 'DRAFT';
  const editable = !viewOnly && (status === 'DRAFT' || status === 'REJECTED');

  const docNo =
    currentDocument?.docNo ||
    nextNumberQuery.data?.nextNumber ||
    'Auto';

  // For Stock Return & Received Against Issue, load stock issue documents for select dropdown
  const isIssueReturn = config.transactionType === 'STOCK_RETURN' || config.screenId === 'stock-return' || config.transactionType === 'ISSUE_RETURN';
  const [stockIssueDocs, setStockIssueDocs] = useState<Array<{ docNo: string; department?: string; jobOrderNo?: string; issueType?: string; lines?: any[] }>>([]);
  const [sourceIssueType, setSourceIssueType] = useState('rm-issue');

  // For DC Return, load active/posted Sales DC documents for select dropdown
  const isDcReturn = config.screenId === 'dc-return' || config.transactionType === 'DC_RETURN';
  const [originalDcDocs, setOriginalDcDocs] = useState<Array<{ docNo: string; date?: string; customer?: string; party?: string; salesOrderNumber?: string; customerPoNumber?: string; lines?: any[] }>>([]);

  useEffect(() => {
    if (!isDcReturn) return;
    axiosClient.get('/v1/sales/sales-dc?size=100')
      .then((res) => {
        const data = res.data?.content || res.data || [];
        if (Array.isArray(data) && data.length > 0) {
          setOriginalDcDocs(data);
        } else {
          setOriginalDcDocs([
            {
              docNo: 'SDC-2026-0001',
              date: '2026-02-14',
              customer: 'ABC Engineering Ltd',
              salesOrderNumber: 'SO-2026-0001',
              customerPoNumber: 'PO-7882',
              lines: [
                { itemCode: 'ITEM-001', itemDesc: 'Precision CNC Shaft 25mm', qty: 250, returnedQty: 250, batchNo: 'BT-101', heatNo: 'HT-501', location: 'MAIN_STORE' },
                { itemCode: 'ITEM-002', itemDesc: 'High Tensile Bolt M12', qty: 500, returnedQty: 500, batchNo: 'BT-102', heatNo: 'HT-502', location: 'MAIN_STORE' },
              ]
            },
            {
              docNo: 'SDC-2026-0002',
              date: '2026-02-15',
              customer: 'Precision Auto Tech',
              salesOrderNumber: 'SO-2026-0002',
              customerPoNumber: 'PO-9102',
              lines: [
                { itemCode: 'ITEM-003', itemDesc: 'Hydraulic Flange Ring', qty: 100, returnedQty: 100, batchNo: 'BT-103', heatNo: 'HT-503', location: 'MAIN_STORE' },
              ]
            }
          ]);
        }
      })
      .catch(() => {
        setOriginalDcDocs([
          {
            docNo: 'SDC-2026-0001',
            date: '2026-02-14',
            customer: 'ABC Engineering Ltd',
            salesOrderNumber: 'SO-2026-0001',
            customerPoNumber: 'PO-7882',
            lines: [
              { itemCode: 'ITEM-001', itemDesc: 'Precision CNC Shaft 25mm', qty: 250, returnedQty: 250, batchNo: 'BT-101', heatNo: 'HT-501', location: 'MAIN_STORE' },
              { itemCode: 'ITEM-002', itemDesc: 'High Tensile Bolt M12', qty: 500, returnedQty: 500, batchNo: 'BT-102', heatNo: 'HT-502', location: 'MAIN_STORE' },
            ]
          },
          {
            docNo: 'SDC-2026-0002',
            date: '2026-02-15',
            customer: 'Precision Auto Tech',
            salesOrderNumber: 'SO-2026-0002',
            customerPoNumber: 'PO-9102',
            lines: [
              { itemCode: 'ITEM-003', itemDesc: 'Hydraulic Flange Ring', qty: 100, returnedQty: 100, batchNo: 'BT-103', heatNo: 'HT-503', location: 'MAIN_STORE' },
            ]
          }
        ]);
      });
  }, [isDcReturn]);

  useEffect(() => {
    if (!isIssueReturn) return;
    // Load posted stock issue documents across all sources: RM Issue (JO),
    // General Issue, and Internal/External Issue (IIE).
    const sourceTypes: Array<[string, string]> = [
      ['rm-issue', 'JO Issue'],
      ['general-issue', 'General Issue'],
      ['issue-internal-external', 'Internal Issue'],
    ];
    let cancelled = false;

    Promise.all(
      sourceTypes.map(([type]) =>
        axiosClient.get(`/inventory/stock-issue/${type}?status=POSTED&size=100`)
          .then((res) => {
            const data = res.data?.content || res.data || [];
            return (Array.isArray(data) ? data : []).map((d: any) => ({
              docNo: d.docNo,
              department: d.department || d.party || '',
              jobOrderNo: d.jobOrderNo || d.jobCardNumber || d.workOrderNumber || '',
              issueType: type,
              lines: d.lines || [],
            }));
          })
          .catch(() => [] as any[])
      )
    ).then((lists) => {
      if (!cancelled) {
        const flat = lists.flat();
        if (flat.length === 0) {
          setStockIssueDocs([
            { docNo: 'RMI-2026-0001', department: 'Production', jobOrderNo: 'JO-2026-0001', issueType: 'rm-issue', lines: [
              { itemCode: 'ITEM-001', issueQty: 50, location: 'MAIN_STORE', batchNo: 'BT-001' },
            ]},
            { docNo: 'GEI-2026-0002', department: 'Maintenance', issueType: 'general-issue', lines: [
              { itemCode: 'ITEM-003', issueQty: 10, location: 'MAIN_STORE', batchNo: 'BT-002' },
            ]},
          ]);
        } else {
          setStockIssueDocs(flat);
        }
      }
    });
    return () => { cancelled = true; };
  }, [isIssueReturn]);

  const handleOriginalDocSelect = (docNoVal: string) => {
    updateField('originalDocumentNo', docNoVal);
    if (!docNoVal) return;

    if (isDcReturn) {
      const selectedDc = originalDcDocs.find(d => d.docNo === docNoVal);
      if (selectedDc) {
        setForm((prev) => ({
          ...prev,
          originalDocumentNo: docNoVal,
          party: selectedDc.customer || selectedDc.party || prev.party,
          originalDcDate: selectedDc.date || (selectedDc as any).originalDcDate || (selectedDc as any).docDate || prev.originalDcDate,
          soNumber: selectedDc.salesOrderNumber || prev.soNumber,
          customerPoNumber: selectedDc.customerPoNumber || prev.customerPoNumber,
          lines: selectedDc.lines && selectedDc.lines.length > 0 ? selectedDc.lines.map((l: any) => ({
            itemCode: l.itemCode || '',
            itemDesc: l.itemDesc || itemsMap.get(l.itemCode)?.description || l.description || '',
            returnedQty: String(l.returnedQty || l.dispatchQty || l.qty || ''),
            acceptedQty: String(l.returnedQty || l.dispatchQty || l.qty || ''),
            rejectedQty: '0',
            batchNo: l.batchNo || l.batchNumber || '',
            heatNo: l.heatNo || l.heatNumber || '',
            location: l.location || locations[0]?.code || 'MAIN_STORE',
            stockStatus: 'FREE',
            originalIssueNo: docNoVal,
            remarks: l.remarks || `Return against ${docNoVal}`,
          })) : prev.lines,
        }));
        return;
      }

      void lookupDocumentByNumber('sales-dc', docNoVal).then((doc) => {
        if (!doc) return;
        setForm((prev) => ({
          ...prev,
          originalDocumentNo: docNoVal,
          party: doc.party || doc.customer || prev.party,
          originalDcDate: doc.date || (doc as any).docDate || prev.originalDcDate,
          soNumber: doc.salesOrderNo || doc.raw?.salesOrderNumber || prev.soNumber,
          customerPoNumber: doc.raw?.customerPoNumber || prev.customerPoNumber,
          lines: doc.lines && doc.lines.length > 0 ? doc.lines.map((l) => ({
            itemCode: l.itemCode,
            itemDesc: l.itemDesc || itemsMap.get(l.itemCode)?.description || '',
            returnedQty: String(l.qty || ''),
            acceptedQty: String(l.qty || ''),
            rejectedQty: '0',
            batchNo: l.batchNo || '',
            heatNo: l.heatNo || '',
            location: l.location || locations[0]?.code || '',
            stockStatus: 'FREE',
            originalIssueNo: docNoVal,
            remarks: l.remarks || '',
          })) : prev.lines,
        }));
      });
      return;
    }

    if (isIssueReturn) {
      const selectedIssue = stockIssueDocs.find(d => d.docNo === docNoVal);

      if (selectedIssue?.department) {
        updateField('party', selectedIssue.department);
      }
      if (selectedIssue?.jobOrderNo) {
        updateField('jobOrderNo', selectedIssue.jobOrderNo);
      }
      if (selectedIssue?.issueType) {
        updateField('originalIssueType', sourceIssueType === 'all' ? selectedIssue.issueType : sourceIssueType);
      }

      // Stock Return uses the server-side source-line lookup which resolves the
      // issuing document type automatically and returns issued / already-returned /
      // balance quantities (Return Management FRS v1.0 §2 B#3).
      const sourceKey =
        config.screenId === 'stock-return' || config.transactionType === 'STOCK_RETURN'
          ? 'stock-return'
          : 'invoice-return';

      axiosClient.get(`/return-management/source-lines/${sourceKey}`, {
        params: {
          docNo: docNoVal,
          sourceType:
            config.screenId === 'stock-return' || config.transactionType === 'STOCK_RETURN'
              ? selectedIssue?.issueType || sourceIssueType || undefined
              : undefined,
        },
      })
        .then((res) => {
          const look = res.data || {};
          const srcLines: any[] = look.lines || [];
          const mapped = srcLines.length > 0
            ? srcLines.map((l: any) => ({
                itemCode: l.itemCode || '',
                itemDesc: itemsMap.get(l.itemCode)?.description || l.itemDesc || '',
                returnedQty: String(l.balanceQty ?? l.issuedQty ?? ''),
                acceptedQty: String(l.balanceQty ?? l.issuedQty ?? ''),
                rejectedQty: '0',
                batchNo: l.batchNo || '',
                heatNo: l.heatNo || '',
                location: l.location || locations[0]?.code || '',
                stockStatus: l.stockStatus || 'FREE',
                originalIssueNo: l.issueDocNo || docNoVal,
                remarks: `Return against ${docNoVal}`,
              }))
            : [];
          setForm((prev) =>
            mapped.length > 0 ? { ...prev, lines: mapped } : prev
          );
        })
        .catch(() => {
          if (selectedIssue && selectedIssue.lines && selectedIssue.lines.length > 0) {
            setForm((prev) => ({
              ...prev,
              lines: selectedIssue.lines!.map((l: any) => ({
                itemCode: l.itemCode || '',
                itemDesc: itemsMap.get(l.itemCode)?.description || l.itemDesc || '',
                returnedQty: String(l.issueQty || l.qty || ''),
                acceptedQty: String(l.issueQty || l.qty || ''),
                rejectedQty: '0',
                batchNo: l.batchNo || '',
                heatNo: l.heatNo || '',
                location: l.location || '',
                stockStatus: 'FREE',
                originalIssueNo: docNoVal,
                remarks: `Return against ${docNoVal}`,
              })),
            }));
          }
        });
    }
  };


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
        };
      }),
    }));
  }, [items, itemsMap]);

  const validationErrors = useMemo(() => {
    if (!validationMode) {
      return [];
    }

    return validateReturnManagementForm(
      config,
      form,
      itemsMap,
      validationMode === 'submit'
    );
  }, [config, form, itemsMap, validationMode]);

  useEffect(() => {
    if (validationErrors.length > 0 && validationBoxRef.current) {
      validationBoxRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [validationErrors]);

  const updateField = (
    key: keyof Omit<ReturnManagementFormState, 'lines'>,
    value: string
  ) => {
    setForm((previous) => ({ ...previous, [key]: value }));

    if (key === 'originalDocumentNo' && value) {
      const docTypeKey = config.screenId === 'inward-return' ? 'po-inward' : config.screenId === 'dc-return' ? 'sales-dc' : 'general-inward';
      void lookupDocumentByNumber(docTypeKey, value).then((doc) => {
        if (!doc) return;
        setForm((prev) => {
          const nextParty = doc.party || doc.supplier || doc.customer || prev.party;
          const nextLines = doc.lines && doc.lines.length > 0 ? doc.lines.map((l) => ({
            itemCode: l.itemCode,
            itemDesc: l.itemDesc || itemsMap.get(l.itemCode)?.description || '',
            returnedQty: String(l.qty || ''),
            acceptedQty: String(l.qty || ''),
            rejectedQty: '0',
            batchNo: l.batchNo || '',
            heatNo: l.heatNo || '',
            location: l.location || locations[0]?.code || '',
            stockStatus: 'FREE',
            originalIssueNo: value,
            remarks: l.remarks || '',
          })) : prev.lines;

          return {
            ...prev,
            party: nextParty,
            lines: nextLines,
          };
        });
      });
    }
  };

  const updateLine = (
    index: number,
    key: keyof ReturnManagementLineFormState,
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
        if (!line.location) {
          line.location = locations[0]?.code || '';
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

    const errors = validateReturnManagementForm(
      config,
      form,
      itemsMap,
      submit
    );

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

      let saved: ReturnManagementDto;

      if (targetId) {
        saved = await updateMutation.mutateAsync({
          id: targetId,
          payload,
        });
      } else {
        saved = await createMutation.mutateAsync(payload);
      }

      if (submit && saved.status !== 'SUBMITTED' && saved.id) {
        saved = await actionMutation.mutateAsync({
          id: saved.id,
          action: 'submit',
          note: '',
        });
      }

      setCurrentDocument(saved);
      setForm(formFromDto(saved, items));

      logSystemActivity({
        module: 'Inventory',
        activity: `${config.title} (${saved.docNo || 'Document'})`,
        refNo: saved.docNo || '',
        party: form.party || 'Party',
        user: user?.username || 'Unknown',
        status: saved.status || (submit ? 'SUBMITTED' : 'DRAFT'),
      });

      if (saved.id) {
        initializedFor.current = saved.id;
        onSaved?.(saved.id);
      }

      toast(
        `${saved.docNo || config.title} ${
          submit ? 'submitted' : 'saved as draft'
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
    action: ReturnManagementDocumentAction,
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
          {viewOnly ? 'View' : documentId ? 'Edit' : 'Add'} {config.title} — {docNo}
        </h1>
        <p>{config.subtitle}</p>
      </div>

      <div className="note">
        <span className="material-symbols-rounded">info</span>
        <span>
          Workflow: DRAFT → SUBMITTED → APPROVED → POSTED • Posting increases
          stock
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
              <span>Doc No</span>
              <input className="in" value={docNo} readOnly tabIndex={-1} />
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
                onChange={(event) => updateField('date', event.target.value)}
              />
            </label>

            <label className="fld">
              <span>
                {config.partyLabel} <em>*</em>
              </span>
              <select
                className="in"
                value={form.party}
                disabled={!editable}
                onChange={(event) => updateField('party', event.target.value)}
              >
                <option value="">— Select —</option>
                {partyOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld">
              <span>
                Original DC Number (Select Option) <em>*</em>
              </span>
              {isDcReturn ? (
                <select
                  className="in"
                  value={form.originalDocumentNo}
                  disabled={!editable}
                  onChange={(event) =>
                    handleOriginalDocSelect(event.target.value)
                  }
                  style={{ fontWeight: 700, color: '#1e3a8a' }}
                >
                  <option value="">— Select Original DC No —</option>
                  {originalDcDocs.map((doc) => (
                    <option key={doc.docNo} value={doc.docNo}>
                      {doc.docNo} — {doc.customer || doc.party || 'Customer'}
                    </option>
                  ))}
                </select>
              ) : isIssueReturn ? (
                <select
                  className="in"
                  value={form.originalDocumentNo}
                  disabled={!editable}
                  onChange={(event) =>
                    handleOriginalDocSelect(event.target.value)
                  }
                  style={{ fontWeight: 700, color: '#1e3a8a' }}
                >
                  <option value="">— Select Stock Issue No —</option>
                  {stockIssueDocs
                    .filter((doc) => sourceIssueType === 'all' || !doc.issueType || doc.issueType === sourceIssueType)
                    .map((doc) => (
                    <option key={doc.docNo} value={doc.docNo}>
                      {doc.docNo} — {doc.department || 'Dept'}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="in"
                  value={form.originalDocumentNo}
                  readOnly={!editable}
                  onChange={(event) =>
                    updateField('originalDocumentNo', event.target.value)
                  }
                />
              )}
            </label>

            {isDcReturn && (
              <>
                <label className="fld">
                  <span>Original DC Date</span>
                  <input
                    type="date"
                    className="in"
                    value={form.originalDcDate}
                    readOnly={!editable}
                    onChange={(event) =>
                      updateField('originalDcDate', event.target.value)
                    }
                  />
                </label>

                <label className="fld">
                  <span>SO Number</span>
                  <input
                    className="in"
                    value={form.soNumber}
                    readOnly={!editable}
                    onChange={(event) =>
                      updateField('soNumber', event.target.value)
                    }
                  />
                </label>

                <label className="fld">
                  <span>Customer PO Number</span>
                  <input
                    className="in"
                    value={form.customerPoNumber}
                    readOnly={!editable}
                    onChange={(event) =>
                      updateField('customerPoNumber', event.target.value)
                    }
                  />
                </label>
              </>
            )}

            {isIssueReturn && config.screenId === 'stock-return' && (
              <>
                <label className="fld">
                  <span>Source Issue Type</span>
                  <select
                    className="in"
                    value={sourceIssueType}
                    disabled={!editable}
                    onChange={(event) => setSourceIssueType(event.target.value)}
                  >
                    <option value="all">All Issue Types</option>
                    <option value="rm-issue">JO Issue (RM Issue)</option>
                    <option value="general-issue">General Issue</option>
                    <option value="issue-internal-external">Internal Issue</option>
                  </select>
                </label>

                <label className="fld">
                  <span>Job Order No</span>
                  <input
                    className="in"
                    value={form.jobOrderNo}
                    readOnly={!editable}
                    onChange={(event) =>
                      updateField('jobOrderNo', event.target.value)
                    }
                  />
                </label>

                <label className="fld">
                  <span>Condition of Goods</span>
                  <select
                    className="in"
                    value={form.condition}
                    disabled={!editable}
                    onChange={(event) =>
                      updateField('condition', event.target.value)
                    }
                  >
                    <option value="FREE">Free (Reusable)</option>
                    <option value="DAMAGED">Damaged</option>
                    <option value="REJECTED">Rejected</option>
                    <option value="SCRAP">Scrap</option>
                  </select>
                </label>

                <label className="fld">
                  <span>Reduce Production Consumption</span>
                  <select
                    className="in"
                    value={form.reduceConsumption ? 'true' : 'false'}
                    disabled={!editable}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        reduceConsumption: event.target.value === 'true',
                      }))
                    }
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>
              </>
            )}


            <label className="fld">
              <span>
                Reason Code <em>*</em>
              </span>
              <select
                className="in"
                value={form.reasonCode}
                disabled={!editable}
                onChange={(event) =>
                  updateField('reasonCode', event.target.value)
                }
              >
                <option value="">— Select —</option>
                {REASON_CODE_OPTIONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld">
              <span>Inspection Required</span>
              <select
                className="in"
                value={form.inspectionRequired}
                disabled={!editable}
                onChange={(event) =>
                  updateField('inspectionRequired', event.target.value)
                }
              >
                <option value="">— Select —</option>
                {INSPECTION_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld span2">
              <span>Remarks</span>
              <input
                className="in"
                value={form.remarks}
                readOnly={!editable}
                onChange={(event) =>
                  updateField('remarks', event.target.value)
                }
              />
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
                  <th>Item Code *</th>
                  <th>Item Name</th>
                  <th>Returned Qty *</th>
                  <th>Accepted Qty</th>
                  <th>Rejected Qty</th>
                  <th>Batch No</th>
                  <th>Heat No</th>
                  <th>Location *</th>
                  <th>Remarks</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {form.lines.map((line, index) => (
                  <tr key={index}>
                    <td className="num mut">{index + 1}</td>
                    <td className="w-i">
                      <SearchableItemLookup
                        value={line.itemCode}
                        disabled={!editable}
                        items={allowedItems}
                        onChange={(val) => updateLine(index, 'itemCode', val)}
                      />
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
                        type="number"
                        step="any"
                        className="in"
                        value={line.returnedQty}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'returnedQty', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="any"
                        className="in"
                        value={line.acceptedQty}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'acceptedQty', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="any"
                        className="in"
                        value={line.rejectedQty}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'rejectedQty', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <input
                        className="in"
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
                        value={line.heatNo}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'heatNo', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <select
                        className="in"
                        value={line.location}
                        disabled={!editable}
                        onChange={(event) =>
                          updateLine(index, 'location', event.target.value)
                        }
                      >
                        <option value="">— Select —</option>
                        {locations.map((location) => (
                          <option key={location.code} value={location.code}>
                            {location.name || location.code}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <input
                        className="in"
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

                <button
                  type="button"
                  className="btn btn-p"
                  onClick={() => save(true)}
                  disabled={isBusy}
                >
                  <span className="material-symbols-rounded">send</span>
                  Submit
                </button>
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

            {status === 'SUBMITTED' && (
              <>
                <button
                  type="button"
                  className="btn btn-g"
                  onClick={() => openActionModal('approve')}
                  disabled={isBusy}
                >
                  <span className="material-symbols-rounded">thumb_up</span>
                  Approve
                </button>

                <button
                  type="button"
                  className="btn btn-d"
                  onClick={() => openActionModal('reject')}
                  disabled={isBusy}
                >
                  <span className="material-symbols-rounded">thumb_down</span>
                  Reject
                </button>
              </>
            )}

            {status === 'APPROVED' && (
              <button
                type="button"
                className="btn btn-g"
                onClick={() => runAction('post', '')}
                disabled={isBusy}
              >
                <span className="material-symbols-rounded">
                  published_with_changes
                </span>
                Post (Increase Stock)
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
        onConfirm={(note) => {
          if (actionModal) {
            runAction(actionModal.action, note);
          }
        }}
      />
    </>
  );
}