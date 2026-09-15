import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { useToast } from '../../../../contexts/ToastContext';
import {
  useSirDocument,
  useSirLookups,
  useSirMutations,
  useSirNextNumber,
} from '../../../../hooks/useStockIssueRequest';
import type {
  SirDocumentAction,
  SirDto,
} from '../../../../types/inventory/stockIssueRequest.types';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { toOptionalNumber } from '../../../../utils/format';
import { filterPurchaseRelevantItems } from '../../../../utils/itemClassification';
import StatusBadge from '../../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../../components/common/ConfirmActionModal';
import SearchableItemLookup from '../../../../components/common/SearchableItemLookup';
import {
  buildPayload,
  createEmptyForm,
  createEmptyLine,
  formFromDto,
  isLineDirty,
  validateSirForm,
  type SirFormState,
  type SirLineFormState,
} from './stockIssueRequestForm';

// Stored value stays 'Yes'/'No' (matches IssueInternalExternalForm.tsx's same field) —
// only the displayed label changes to Returnable / Non-Returnable.
const RETURNABLE_OPTIONS = [
  { value: 'Yes', label: 'Returnable' },
  { value: 'No', label: 'Non-Returnable' },
];

interface ActionModalState {
  action: SirDocumentAction;
  title: string;
  body: string;
  okLabel: string;
  danger?: boolean;
}

interface StockIssueRequestFormProps {
  documentId?: string | null;
  viewOnly?: boolean;
  onBack: () => void;
  onSaved?: (id: string) => void;
}

export default function StockIssueRequestForm({
  documentId,
  viewOnly = false,
  onBack,
  onSaved,
}: StockIssueRequestFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const lookups = useSirLookups();
  const documentQuery = useSirDocument(documentId ?? null);
  const nextNumberQuery = useSirNextNumber();

  const {
    createMutation,
    updateMutation,
    actionMutation,
    approveMutation,
  } = useSirMutations();

  const [form, setForm] = useState<SirFormState>(() => createEmptyForm());
  const [currentDocument, setCurrentDocument] = useState<SirDto | null>(null);
  const [validationMode, setValidationMode] = useState<'draft' | 'submit' | null>(null);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null);

  const validationBoxRef = useRef<HTMLDivElement | null>(null);
  const initializedFor = useRef<string | null>(null);

  const items = lookups.items;
  const departments = lookups.departments;
  const jobOrders = lookups.jobOrders;

  const itemsMap = useMemo(
    () => new Map(items.map((item) => [item.code, item])),
    [items]
  );

  const allowedItems = useMemo(() => {
    const filtered = filterPurchaseRelevantItems(items);
    const selectedCodes = new Set(form.lines.map((l) => l.itemCode).filter(Boolean));
    const filteredCodes = new Set(filtered.map((i) => i.code));
    const missingSelected = items.filter((i) => selectedCodes.has(i.code) && !filteredCodes.has(i.code));
    return missingSelected.length > 0 ? [...filtered, ...missingSelected] : filtered;
  }, [items, form.lines]);

  const status = currentDocument?.status ?? 'DRAFT';

  // Requested fields editable only while drafting.
  const canEditRequested = !viewOnly && (status === 'DRAFT' || status === 'REJECTED');

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
        return { ...line, itemDesc: line.itemDesc || item.description };
      }),
    }));
  }, [items, itemsMap]);

  const validationErrors = useMemo(() => {
    if (!validationMode) return [];
    return validateSirForm(form);
  }, [form, validationMode]);

  useEffect(() => {
    if (validationErrors.length > 0 && validationBoxRef.current) {
      validationBoxRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [validationErrors]);

  const updateHeader = (
    key: keyof Omit<SirFormState, 'lines'>,
    value: string
  ) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const updateLine = (
    index: number,
    key: keyof SirLineFormState,
    value: string
  ) => {
    setForm((previous) => {
      const lines = [...previous.lines];
      const line = { ...lines[index], [key]: value };

      if (key === 'itemCode') {
        const item = itemsMap.get(value);
        line.itemDesc = item?.description ?? '';
      }

      lines[index] = line;

      return { ...previous, lines };
    });
  };

  const addLine = () => {
    if (!canEditRequested) return;
    setForm((previous) => ({
      ...previous,
      lines: [...previous.lines, createEmptyLine()],
    }));
  };

  const deleteLine = (index: number) => {
    if (!canEditRequested) return;
    setForm((previous) => {
      const lines = [...previous.lines];
      if (lines.length === 1) {
        lines[0] = createEmptyLine();
      } else {
        lines.splice(index, 1);
      }
      return { ...previous, lines };
    });
  };

  const isBusy =
    createMutation.isPending ||
    updateMutation.isPending ||
    actionMutation.isPending ||
    approveMutation.isPending;

  const save = async (submit: boolean) => {
    if (!canEditRequested) return;

    setValidationMode(submit ? 'submit' : 'draft');

    const errors = validateSirForm(form);
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

      let saved: SirDto;

      if (targetId) {
        saved = await updateMutation.mutateAsync({ id: targetId, payload });
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

      if (saved.id) {
        initializedFor.current = saved.id;
        onSaved?.(saved.id);
      }

      toast(`${saved.docNo || 'Request'} ${submit ? 'submitted' : 'saved as draft'}.`);
    } catch (saveError) {
      toast(
        getApiErrorMessage(saveError, submit ? 'Submit failed.' : 'Save failed.'),
        'error'
      );
    }
  };

  const runAction = async (action: SirDocumentAction, note: string) => {
    const id = currentDocument?.id ?? documentId;
    if (!id) {
      toast('Document is not saved yet.', 'error');
      return;
    }

    try {
      const updated = await actionMutation.mutateAsync({ id, action, note });
      setCurrentDocument(updated);
      setForm(formFromDto(updated, items));
      setActionModal(null);
      toast(`${updated.docNo || 'Request'} • ${action} completed.`);
    } catch (actionError) {
      toast(getApiErrorMessage(actionError, 'Action failed.'), 'error');
    }
  };

  // Approval sends the approver-edited approved quantities to the backend.
  const runApprove = async (note: string) => {
    const id = currentDocument?.id ?? documentId;
    if (!id) {
      toast('Document is not saved yet.', 'error');
      return;
    }

    const approvedLines = form.lines
      .filter(isLineDirty)
      .map((line) => ({
        itemCode: line.itemCode,
        approvedQty: toOptionalNumber(line.approvedQty),
      }));

    try {
      const updated = await approveMutation.mutateAsync({
        id,
        note,
        lines: approvedLines,
      });

      setCurrentDocument(updated);
      setForm(formFromDto(updated, items));
      setActionModal(null);
      toast(`${updated.docNo || 'Request'} approved.`);
    } catch (approveError) {
      toast(getApiErrorMessage(approveError, 'Approve failed.'), 'error');
    }
  };

  const openActionModal = (action: 'approve' | 'reject' | 'cancel') => {
    const id = currentDocument?.id ?? documentId;
    if (!id) {
      toast('Document is not saved yet.', 'error');
      return;
    }

    const docNumber = currentDocument?.docNo || 'Request';

    if (action === 'approve') {
      setActionModal({
        action,
        title: `Approve ${docNumber}`,
        body: 'Review Approved Qty in the lines, then add a comment (optional).',
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
        okLabel: 'Cancel Request',
        danger: true,
      });
    }
  };

  const handleModalConfirm = (note: string) => {
    if (!actionModal) return;

    if (actionModal.action === 'approve') {
      runApprove(note);
    } else {
      runAction(actionModal.action, note);
    }
  };

  if (documentId && documentQuery.isPending) {
    return (
      <div className="panel">
        <div className="empty">
          <span className="material-symbols-rounded">hourglass_empty</span>
          Loading Stock Issue Request...
        </div>
      </div>
    );
  }

  if (documentId && documentQuery.isError) {
    return (
      <div className="panel">
        <div className="empty">
          <span className="material-symbols-rounded">error</span>
          {getApiErrorMessage(documentQuery.error, 'Unable to load request.')}
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
          Loading master data...
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
        <h1>{viewOnly ? 'View' : documentId ? 'Edit' : 'Add'} Stock Issue Request — {docNo}</h1>
        <p>Department request for material — does not reduce stock</p>
      </div>

      <div className="note">
        <span className="material-symbols-rounded">info</span>
        <span>
          Workflow: DRAFT → SUBMITTED → APPROVED / REJECTED • Does not reduce
          stock. Once APPROVED, this request number becomes available for stock
          issuance.
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
                readOnly={!canEditRequested}
                onChange={(event) => updateHeader('date', event.target.value)}
              />
            </label>

            <label className="fld">
              <span>
                Department <em>*</em>
              </span>
              <select
                className="in"
                value={form.department}
                disabled={!canEditRequested}
                onChange={(event) =>
                  updateHeader('department', event.target.value)
                }
              >
                <option value="">— Select —</option>
                {departments.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld">
              <span>
                Requested By <em>*</em>
              </span>
              <input
                className="in"
                value={form.requestedBy}
                readOnly={!canEditRequested}
                onChange={(event) =>
                  updateHeader('requestedBy', event.target.value)
                }
              />
            </label>

            <label className="fld">
              <span>
                Required Date <em>*</em>
              </span>
              <input
                type="date"
                className="in"
                value={form.requiredDate}
                readOnly={!canEditRequested}
                onChange={(event) =>
                  updateHeader('requiredDate', event.target.value)
                }
              />
            </label>

            <label className="fld">
              <span>Job Order</span>
              <select
                className="in"
                value={form.jobOrderNo}
                disabled={!canEditRequested}
                onChange={(event) =>
                  updateHeader('jobOrderNo', event.target.value)
                }
              >
                <option value="">— Select —</option>
                {jobOrders.map((jobOrder) => (
                  <option key={jobOrder.number} value={jobOrder.number}>
                    {jobOrder.number}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld">
              <span>
                Purpose <em>*</em>
              </span>
              <input
                className="in"
                value={form.purpose}
                readOnly={!canEditRequested}
                onChange={(event) => updateHeader('purpose', event.target.value)}
              />
            </label>

            <label className="fld">
              <span>Remarks</span>
              <input
                className="in"
                value={form.remarks}
                readOnly={!canEditRequested}
                onChange={(event) => updateHeader('remarks', event.target.value)}
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
              disabled={!canEditRequested || isBusy}
            >
              <span className="material-symbols-rounded">add</span>
              Add Line
            </button>
          </div>

          <div className="twrap">
            <table className="tbl lines">
              <thead>
                <tr>
                  <th className="num">S.No</th>
                  <th>Item Code *</th>
                  <th>Item Name</th>
                  <th>Requested Qty *</th>
                  <th>Returnable *</th>
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
                        disabled={!canEditRequested}
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
                        value={line.requestedQty}
                        readOnly={!canEditRequested}
                        onChange={(event) =>
                          updateLine(index, 'requestedQty', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <select
                        className="in"
                        value={line.returnable}
                        disabled={!canEditRequested}
                        onChange={(event) =>
                          updateLine(index, 'returnable', event.target.value)
                        }
                      >
                        <option value="">— Select —</option>
                        {RETURNABLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <input
                        className="in"
                        value={line.remarks}
                        readOnly={!canEditRequested}
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
                        disabled={!canEditRequested || isBusy}
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

            {canEditRequested && (
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

            {!['CANCELLED'].includes(status) && (
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
        busy={approveMutation.isPending || actionMutation.isPending}
        onClose={() => setActionModal(null)}
        onConfirm={handleModalConfirm}
      />
    </>
  );
}