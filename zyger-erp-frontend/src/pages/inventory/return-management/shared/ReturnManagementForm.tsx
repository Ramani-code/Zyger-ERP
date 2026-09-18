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
  /** Remounts the form blank (bumps the parent's formKey) — called after every
   * successful Save/Submit/Post/Approve/Reject/Cancel so the user lands on a
   * fresh entry form instead of staying on the just-saved document. */
  onReset?: () => void;
}

export default function ReturnManagementForm({
  config,
  documentId,
  viewOnly = false,
  onBack,
  onSaved,
  onReset,
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
  // Defaults to "all" — defaulting to one specific issue type (as this used to,
  // 'rm-issue') silently hid every General Issue / Internal Issue document from
  // the "Original Stock Issue Number" dropdown until the user noticed this
  // filter existed and changed it themselves.
  const [sourceIssueType, setSourceIssueType] = useState('all');

  // For DC Return, load active/posted Sales DC documents for select dropdown
  const isDcReturn = config.screenId === 'dc-return' || config.transactionType === 'DC_RETURN';
  const isInvoiceReturn = config.screenId === 'invoice-return' || config.transactionType === 'SALES_RETURN';
  const [originalDcDocs, setOriginalDcDocs] = useState<Array<{ docNo: string; date?: string; customer?: string; party?: string; salesOrderNumber?: string; customerPoNumber?: string; lines?: any[] }>>([]);
  const [originalInvoiceDocs, setOriginalInvoiceDocs] = useState<Array<{ docNo: string; date?: string; customer?: string; party?: string; salesOrderNumber?: string; customerPoNumber?: string; lines?: any[] }>>([]);

  useEffect(() => {
    if (!isDcReturn) return;
    // Load issued DCs across Sales (Sales DC) and Delivery Challan module
    // (JO DC + General DC) so the Original DC dropdown shows every DC that has
    // actually moved stock — de-duplicated by doc no, and excluding JO DC
    // "Receiving after Job Work" challans (those are stock-IN returns, not issues).
    let cancelled = false;

    const issuedStatuses = ['POSTED', 'DISPATCHED', 'PARTIALLY_DISPATCHED', 'CONFIRMED'];
    const hasIssuedQty = (lines: any[]) =>
      Array.isArray(lines) &&
      lines.some(
        (l: any) => Number(l.returnedQty || l.dispatchQty || l.qty || 0) > 0
      );

    const sourceType: Array<[string, () => Promise<any[]>, (d: any) => boolean]> = [
      [
        'sales-dc',
        () =>
          axiosClient
            .get('/v1/sales/sales-dc?size=500')
            .then((res) => {
              const data = res.data?.content || res.data || [];
              return Array.isArray(data) ? data : [];
            }),
        (d) => issuedStatuses.includes(d.status),
      ],
      [
        'jo-dc',
        () =>
          axiosClient
            .get('/inventory/delivery-challan/jo-dc?size=500')
            .then((res) => {
              const data = res.data?.content || res.data || [];
              return Array.isArray(data) ? data : [];
            }),
        (d) =>
          d.status === 'POSTED' &&
          !(d.challanPurpose || '').toLowerCase().startsWith('receiving'),
      ],
      [
        'general-dc',
        () =>
          axiosClient
            .get('/inventory/delivery-challan/general-dc?size=500')
            .then((res) => {
              const data = res.data?.content || res.data || [];
              return Array.isArray(data) ? data : [];
            }),
        (d) => d.status === 'POSTED',
      ],
    ];

    Promise.all(
      sourceType.map(([, fetcher]) =>
        fetcher().catch(() => [] as any[])
      )
    ).then((lists) => {
      if (cancelled) return;
      const seen = new Map<string, any>();
      lists.forEach((docs, idx) => {
        for (const d of docs) {
          if (!sourceType[idx][2](d)) continue;
          if (!hasIssuedQty(d.lines || [])) continue;
          const docNo = d.docNo;
          if (!docNo || seen.has(docNo)) continue;
          seen.set(docNo, {
            docNo,
            date: d.date || d.docDate || '',
            party: d.customer || d.party || '',
            salesOrderNumber:
              d.salesOrderNumber || d.salesOrderNo || d.linkedDocumentNo || '',
            customerPoNumber: d.customerPoNumber || '',
            lines: d.lines || [],
          });
        }
      });
      setOriginalDcDocs(Array.from(seen.values()));
    });
    return () => {
      cancelled = true;
    };
  }, [isDcReturn]);

  useEffect(() => {
    if (!isInvoiceReturn) return;
    // Load only posted Sales Invoice documents that have moved stock so the
    // Original Invoice dropdown shows real invoices with issued quantities.
    let cancelled = false;

    axiosClient
      .get('/v1/sales/sales-invoice?size=500')
      .then((res) => {
        if (cancelled) return;
        const data = res.data?.content || res.data || [];
        const docs = Array.isArray(data) ? data : [];
        const invoiceStatuses = ['POSTED', 'PARTIALLY_PAID', 'PAID'];
        const hasIssuedQty = (lines: any[]) =>
          Array.isArray(lines) &&
          lines.some((l: any) => Number(l.qty || l.invoiceQty || l.dispatchQty || 0) > 0);
        const seen = new Map<string, any>();
        for (const d of docs) {
          if (!invoiceStatuses.includes(d.status)) continue;
          if (!hasIssuedQty(d.lines || [])) continue;
          const docNo = d.docNo;
          if (!docNo || seen.has(docNo)) continue;
          seen.set(docNo, {
            docNo,
            date: d.date || d.docDate || d.invoiceDate || '',
            party: d.customer || d.party || '',
            salesOrderNumber: d.salesOrderNumber || d.salesOrderNo || d.linkedDocumentNo || '',
            customerPoNumber: d.customerPoNumber || '',
            lines: d.lines || [],
          });
        }
        setOriginalInvoiceDocs(Array.from(seen.values()));
      })
      .catch(() => {
        if (!cancelled) setOriginalInvoiceDocs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isInvoiceReturn]);

  useEffect(() => {
    if (!isIssueReturn) return;
    // Load stock issue documents across all sources: RM Issue (JO), General
    // Issue, and Internal/External Issue (IIE). A document that already had
    // one return posted against it moves from POSTED to PARTIALLY_RETURNED —
    // it can still have more returned against its remaining balance (checked
    // server-side against source-lines when the line is saved), so both
    // statuses must stay selectable here. Matches the multi-status allowlist
    // pattern already used by the DC/Invoice Return dropdowns above; this one
    // used to hard-filter to status=POSTED only, so a document silently
    // vanished from the picker the moment its first partial return posted.
    const issuableStatuses = ['POSTED', 'PARTIALLY_RETURNED'];
    const sourceTypes: Array<[string, string]> = [
      ['rm-issue', 'JO Issue'],
      ['general-issue', 'General Issue'],
      ['issue-internal-external', 'Internal Issue'],
    ];
    let cancelled = false;

    Promise.all(
      sourceTypes.map(([type]) =>
        axiosClient.get(`/inventory/stock-issue/${type}?size=200`)
          .then((res) => {
            const data = res.data?.content || res.data || [];
            return (Array.isArray(data) ? data : [])
              .filter((d: any) => issuableStatuses.includes(d.status))
              .map((d: any) => ({
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
        setStockIssueDocs(lists.flat());
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

    if (isInvoiceReturn) {
      const selectedInvoice = originalInvoiceDocs.find(d => d.docNo === docNoVal);
      if (selectedInvoice) {
        setForm((prev) => ({
          ...prev,
          originalDocumentNo: docNoVal,
          party: selectedInvoice.customer || selectedInvoice.party || prev.party,
          originalDcDate: selectedInvoice.date || (selectedInvoice as any).docDate || prev.originalDcDate,
          soNumber: selectedInvoice.salesOrderNumber || prev.soNumber,
          customerPoNumber: selectedInvoice.customerPoNumber || prev.customerPoNumber,
          lines: selectedInvoice.lines && selectedInvoice.lines.length > 0 ? selectedInvoice.lines.map((l: any) => ({
            itemCode: l.itemCode || '',
            itemDesc: l.itemDesc || itemsMap.get(l.itemCode)?.description || l.description || '',
            returnedQty: String(l.qty || l.invoiceQty || l.dispatchQty || ''),
            acceptedQty: String(l.qty || l.invoiceQty || l.dispatchQty || ''),
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

      void lookupDocumentByNumber('sales-invoice', docNoVal).then((doc) => {
        if (!doc) return;
        setForm((prev) => ({
          ...prev,
          originalDocumentNo: docNoVal,
          party: doc.party || doc.customer || prev.party,
          originalDcDate: doc.date || (doc as any).docDate || (doc as any).invoiceDate || prev.originalDcDate,
          soNumber: doc.salesOrderNo || doc.raw?.salesOrderNumber || prev.soNumber,
          customerPoNumber: doc.raw?.customerPoNumber || prev.customerPoNumber,
          lines: doc.lines && doc.lines.length > 0 ? doc.lines.map((l) => ({
            itemCode: l.itemCode,
            itemDesc: l.itemDesc || itemsMap.get(l.itemCode)?.description || '',
            returnedQty: String(l.qty || l.invoiceQty || ''),
            acceptedQty: String(l.qty || l.invoiceQty || ''),
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
      const docTypeKey = config.screenId === 'inward-return' ? 'po-inward' : isDcReturn ? 'sales-dc' : isInvoiceReturn ? 'sales-invoice' : 'general-inward';
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

      if (key === 'returnedQty' || key === 'acceptedQty') {
        const returned = parseFloat(line.returnedQty === '' ? '0' : String(line.returnedQty)) || 0;
        const accepted = parseFloat(line.acceptedQty === '' ? '0' : String(line.acceptedQty)) || 0;
        line.rejectedQty = String(Math.max(Number((returned - accepted).toFixed(3)), 0));
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

  // DC Return and Invoice Return are entered against stock that was already issued out via a
  // real, already-approved DC/Invoice — re-approving the return itself is pure friction, not a
  // control, so those two skip Submit/Approve and post straight from Draft (backend:
  // DocumentFacade.DIRECT_POST_RETURN_KEYS). Stock Return keeps the full workflow.
  const directPostEligible =
    config.screenId === 'dc-return' || config.screenId === 'invoice-return';

  // Prefers the parent's onReset (remounts this Form via a formKey bump — the
  // clean way to clear the documentId prop this Form doesn't own) and falls
  // back to an in-place reset if no onReset was passed.
  const resetToNew = () => {
    if (onReset) {
      onReset();
      return;
    }
    initializedFor.current = null;
    setCurrentDocument(null);
    setForm(createEmptyForm());
    nextNumberQuery.refetch();
  };

  const save = async (mode: 'draft' | 'submit' | 'post') => {
    if (!editable) {
      return;
    }

    const submit = mode === 'submit';
    setValidationMode(mode === 'draft' ? 'draft' : 'submit');

    const errors = validateReturnManagementForm(
      config,
      form,
      itemsMap,
      mode !== 'draft'
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

      if (mode === 'post' && saved.status !== 'POSTED' && saved.id) {
        saved = await actionMutation.mutateAsync({
          id: saved.id,
          action: 'post',
          note: '',
        });
      }

      logSystemActivity({
        module: 'Inventory',
        activity: `${config.title} (${saved.docNo || 'Document'})`,
        refNo: saved.docNo || '',
        party: form.party || 'Party',
        user: user?.username || 'Unknown',
        status: saved.status || (submit ? 'SUBMITTED' : 'DRAFT'),
      });

      if (saved.id) {
        onSaved?.(saved.id);
      }

      const verb =
        mode === 'post' ? 'posted — stock updated' : submit ? 'submitted' : 'saved as draft';
      toast(`${saved.docNo || config.title} ${verb}.`);
      resetToNew();
    } catch (saveError) {
      toast(
        getApiErrorMessage(
          saveError,
          mode === 'post' ? 'Save & Post failed.' : submit ? 'Submit failed.' : 'Save failed.'
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

      setActionModal(null);
      toast(`${updated.docNo || config.title} • ${action} completed.`);
      resetToNew();
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
          {directPostEligible
            ? 'Click Save & Post to post in one step — stock increases immediately'
            : 'Workflow: DRAFT → SUBMITTED → APPROVED → POSTED • Posting increases stock'}
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
                {isInvoiceReturn
                  ? 'Original Invoice Number (Select Option)'
                  : isIssueReturn
                    ? 'Original Stock Issue Number (Select Option)'
                    : 'Original DC Number (Select Option)'}{' '}
                <em>*</em>
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
              ) : isInvoiceReturn ? (
                <select
                  className="in"
                  value={form.originalDocumentNo}
                  disabled={!editable}
                  onChange={(event) =>
                    handleOriginalDocSelect(event.target.value)
                  }
                  style={{ fontWeight: 700, color: '#1e3a8a' }}
                >
                  <option value="">— Select Original Invoice No —</option>
                  {originalInvoiceDocs.map((doc) => (
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

            {(isDcReturn || isInvoiceReturn) && (
              <>
                <label className="fld">
                  <span>{isInvoiceReturn ? 'Original Invoice Date' : 'Original DC Date'}</span>
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
                        style={{ backgroundColor: '#f1f5f9' }}
                        value={line.rejectedQty}
                        readOnly
                        tabIndex={-1}
                        title="Rejected Qty = Returned Qty − Accepted Qty"
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
                  onClick={() => save('draft')}
                  disabled={isBusy}
                >
                  <span className="material-symbols-rounded">save</span>
                  Save Draft
                </button>

                {directPostEligible ? (
                  <button
                    type="button"
                    className="btn btn-g"
                    onClick={() => save('post')}
                    disabled={isBusy}
                    title="Saves this return and posts it immediately — stock increases right away, no separate Submit/Approve step."
                  >
                    <span className="material-symbols-rounded">published_with_changes</span>
                    Save &amp; Post
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-p"
                    onClick={() => save('submit')}
                    disabled={isBusy}
                  >
                    <span className="material-symbols-rounded">send</span>
                    Submit
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