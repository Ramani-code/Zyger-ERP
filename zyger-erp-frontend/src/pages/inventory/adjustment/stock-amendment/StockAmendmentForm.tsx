import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { useToast } from '../../../../contexts/ToastContext';
import {
  useStockAmendmentDocument,
  useStockAmendmentLookups,
  useStockAmendmentMutations,
  useStockAmendmentNextNumber,
} from '../../../../hooks/useAdjustment';
import { getStockBalance } from '../../../../services/adjustmentService';
import type {
  AdjustmentDocumentAction,
  StockAmendmentDto,
} from '../../../../types/inventory/adjustment.types';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { filterPurchaseRelevantItems } from '../../../../utils/itemClassification';

import StatusBadge from '../../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../../components/common/ConfirmActionModal';
import SearchableItemLookup from '../../../../components/common/SearchableItemLookup';
import { AMENDMENT_REASON_OPTIONS } from '../../../../config/adjustmentConfig';
import {
  buildPayload,
  calculateDifference,
  createEmptyForm,
  formFromDto,
  validateStockAmendmentForm,
  type StockAmendmentFormState,
} from './stockAmendmentForm';

interface ActionModalState {
  action: AdjustmentDocumentAction;
  title: string;
  body: string;
  okLabel: string;
  danger?: boolean;
}

interface StockAmendmentFormProps {
  documentId?: string | null;
  viewOnly?: boolean;
  onBack: () => void;
  onSaved?: (id: string) => void;
}

export default function StockAmendmentForm({
  documentId,
  viewOnly = false,
  onBack,
  onSaved,
}: StockAmendmentFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const lookups = useStockAmendmentLookups();
  const documentQuery = useStockAmendmentDocument(documentId ?? null);
  const nextNumberQuery = useStockAmendmentNextNumber();

  const { createMutation, updateMutation, actionMutation } =
    useStockAmendmentMutations();

  const [form, setForm] = useState<StockAmendmentFormState>(() =>
    createEmptyForm()
  );
  const [currentDocument, setCurrentDocument] =
    useState<StockAmendmentDto | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(
    null
  );

  const validationBoxRef = useRef<HTMLDivElement | null>(null);
  const initializedFor = useRef<string | null>(null);

  const items = lookups.items;
  // FRS DOC-INV-FRS-02 Priority#1 [FIXED] — merged union instead of an all-or-nothing
  // stores-vs-locations fallback; see utils/locationOptions.ts for why.
  const locations = lookups.stores ?? [];

  // Item Code should only ever offer Purchasable / Customer-Supplied / Manufacturing items
  // (the three item screens under Master → Inventory → Items) — this picker previously
  // showed every item in the system unfiltered.
  const allowedItems = useMemo(() => filterPurchaseRelevantItems(items), [items]);

  const status = currentDocument?.status ?? 'DRAFT';
  const editable = !viewOnly && (status === 'DRAFT' || status === 'REJECTED');

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
      setForm(formFromDto(documentQuery.data));
    }
  }, [documentId, documentQuery.data]);

  // Fetch system qty when item/location/batch changes
  useEffect(() => {
    if (!form.itemCode || !form.location) {
      setForm((previous) => ({
        ...previous,
        systemQty: '',
        differenceQty: '',
      }));
      return;
    }

    let active = true;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const balance = await getStockBalance(
          form.itemCode,
          form.location,
          form.batchNo || undefined,
          controller.signal
        );

        if (!active) {
          return;
        }

        const systemQty = String(balance.onHand ?? 0);

        setForm((previous) => ({
          ...previous,
          systemQty,
          differenceQty: calculateDifference(systemQty, previous.correctedQty),
        }));
      } catch {
        if (active) {
          setForm((previous) => ({
            ...previous,
            systemQty: '',
            differenceQty: '',
          }));
        }
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [form.itemCode, form.location, form.batchNo]);

  useEffect(() => {
    if (validationErrors.length > 0 && validationBoxRef.current) {
      validationBoxRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [validationErrors]);

  const updateField = (
    key: keyof StockAmendmentFormState,
    value: string
  ) => {
    setForm((previous) => {
      const next = { ...previous, [key]: value };

      if (key === 'correctedQty') {
        next.differenceQty = calculateDifference(
          previous.systemQty,
          value
        );
      }

      return next;
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

    const errors = validateStockAmendmentForm(form);
    setValidationErrors(errors);

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

      let saved: StockAmendmentDto;

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
      setForm(formFromDto(saved));

      if (saved.id) {
        initializedFor.current = saved.id;
        onSaved?.(saved.id);
      }

      toast(
        `${saved.docNo || 'Stock Amendment'} ${
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
    action: AdjustmentDocumentAction,
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
      setForm(formFromDto(updated));
      setActionModal(null);

      toast(`${updated.docNo || 'Stock Amendment'} • ${action} completed.`);
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

    const docNumber = currentDocument?.docNo || 'Stock Amendment';

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
          Loading Stock Amendment document...
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
            'Unable to load Stock Amendment document.'
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
          Loading Stock Amendment master data...
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
        <h1>{viewOnly ? 'View' : documentId ? 'Edit' : 'Add'} Stock Amendment — {docNo}</h1>
        <p>Authorized correction with mandatory reason</p>
      </div>

      <div className="note">
        <span className="material-symbols-rounded">info</span>
        <span>
          Workflow: DRAFT → SUBMITTED → APPROVED → POSTED • Posting adjusts
          stock (increase or decrease based on difference)
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
              Amendment Details
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
                Item <em>*</em>
              </span>
              <SearchableItemLookup
                value={form.itemCode}
                disabled={!editable}
                items={allowedItems}
                onChange={(val) => updateField('itemCode', val)}
              />
            </label>

            <label className="fld">
              <span>
                Location <em>*</em>
              </span>
              <select
                className="in"
                value={form.location}
                disabled={!editable}
                onChange={(event) =>
                  updateField('location', event.target.value)
                }
              >
                <option value="">— Select —</option>
                {locations.map((location) => (
                  <option key={location.code} value={location.code}>
                    {location.name || location.code}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld">
              <span>Batch No</span>
              <input
                className="in"
                value={form.batchNo}
                readOnly={!editable}
                onChange={(event) =>
                  updateField('batchNo', event.target.value)
                }
              />
            </label>

            <label className="fld">
              <span>System Qty</span>
              <input
                className="in"
                value={form.systemQty}
                readOnly
                tabIndex={-1}
              />
            </label>

            <label className="fld">
              <span>
                Corrected Qty <em>*</em>
              </span>
              <input
                type="number"
                step="any"
                className="in"
                value={form.correctedQty}
                readOnly={!editable}
                onChange={(event) =>
                  updateField('correctedQty', event.target.value)
                }
              />
            </label>

            <label className="fld">
              <span>Difference Qty</span>
              <input
                className="in"
                value={form.differenceQty}
                readOnly
                tabIndex={-1}
              />
            </label>

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
                {AMENDMENT_REASON_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld span2">
              <span>
                Remarks <em>*</em>
              </span>
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
                Post (Adjust Stock)
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