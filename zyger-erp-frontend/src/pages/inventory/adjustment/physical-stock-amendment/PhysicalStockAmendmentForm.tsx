import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { useToast } from '../../../../contexts/ToastContext';
import {
  usePhysicalStockAmendmentDocument,
  usePhysicalStockAmendmentLookups,
  usePhysicalStockAmendmentMutations,
  usePhysicalStockAmendmentNextNumber,
} from '../../../../hooks/useAdjustment';
import { getStockBalance } from '../../../../services/adjustmentService';
import type {
  AdjustmentDocumentAction,
  PhysicalStockAmendmentDto,
} from '../../../../types/inventory/adjustment.types';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { filterPurchaseRelevantItems } from '../../../../utils/itemClassification';

import StatusBadge from '../../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../../components/common/ConfirmActionModal';
import SearchableItemLookup from '../../../../components/common/SearchableItemLookup';
import {
  COUNT_TYPE_OPTIONS,
  PHYSICAL_AMENDMENT_REASON_OPTIONS,
} from '../../../../config/adjustmentConfig';
import {
  buildPayload,
  calculateVariance,
  calculateVarianceValue,
  createEmptyForm,
  createEmptyLine,
  formFromDto,

  validatePhysicalStockAmendmentForm,
  type PhysicalStockAmendmentFormState,
  type PhysicalStockAmendmentLineFormState,
} from './physicalStockAmendmentForm';

interface ActionModalState {
  action: AdjustmentDocumentAction;
  title: string;
  body: string;
  okLabel: string;
  danger?: boolean;
}

interface PhysicalStockAmendmentFormProps {
  documentId?: string | null;
  viewOnly?: boolean;
  onBack: () => void;
  onSaved?: (id: string) => void;
}

export default function PhysicalStockAmendmentForm({
  documentId,
  viewOnly = false,
  onBack,
  onSaved,
}: PhysicalStockAmendmentFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const lookups = usePhysicalStockAmendmentLookups();
  const documentQuery = usePhysicalStockAmendmentDocument(documentId ?? null);
  const nextNumberQuery = usePhysicalStockAmendmentNextNumber();

  const { createMutation, updateMutation, actionMutation } =
    usePhysicalStockAmendmentMutations();

  const [form, setForm] = useState<PhysicalStockAmendmentFormState>(() =>
    createEmptyForm()
  );
  const [currentDocument, setCurrentDocument] =
    useState<PhysicalStockAmendmentDto | null>(null);
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

  // Fetch system qty for each line when item/batch changes
  useEffect(() => {
    if (!form.storeLocation) {
      return;
    }

    const linesToFetch = form.lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.itemCode);

    if (linesToFetch.length === 0) {
      return;
    }

    let active = true;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      const updates: Array<{
        index: number;
        systemQty: string;
      }> = [];

      for (const { line, index } of linesToFetch) {
        try {
          const balance = await getStockBalance(
            line.itemCode,
            form.storeLocation,
            line.batchNo || undefined,
            controller.signal
          );

          updates.push({
            index,
            systemQty: String(balance.onHand ?? 0),
          });
        } catch {
          // Skip failed fetches
        }
      }

      if (!active) {
        return;
      }

      setForm((previous) => ({
        ...previous,
        lines: previous.lines.map((line, index) => {
          const update = updates.find((u) => u.index === index);

          if (!update) {
            return line;
          }

          const varianceQty = calculateVariance(
            update.systemQty,
            line.physicalQty
          );

          const item = itemsMap.get(line.itemCode);
          const itemRate = item?.defaultRate ?? 0;

          return {
            ...line,
            systemQty: update.systemQty,
            varianceQty,
            varianceValue: calculateVarianceValue(varianceQty, itemRate),
          };
        }),
      }));
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [form.storeLocation, form.lines, itemsMap]);

  const validationErrors = useMemo(() => {
    if (!validationMode) {
      return [];
    }

    return validatePhysicalStockAmendmentForm(
      form,
      itemsMap,
      validationMode === 'submit'
    );
  }, [form, itemsMap, validationMode]);

  useEffect(() => {
    if (validationErrors.length > 0 && validationBoxRef.current) {
      validationBoxRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [validationErrors]);

  const updateField = (
    key: keyof Omit<PhysicalStockAmendmentFormState, 'lines'>,
    value: string
  ) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const updateLine = (
    index: number,
    key: keyof PhysicalStockAmendmentLineFormState,
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
      }

      if (key === 'physicalQty' || key === 'systemQty') {
        line.varianceQty = calculateVariance(line.systemQty, line.physicalQty);

        const item = itemsMap.get(line.itemCode);
        const itemRate = item?.defaultRate ?? 0;

        line.varianceValue = calculateVarianceValue(
          line.varianceQty,
          itemRate
        );
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

    const errors = validatePhysicalStockAmendmentForm(
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

      let saved: PhysicalStockAmendmentDto;

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

      if (saved.id) {
        initializedFor.current = saved.id;
        onSaved?.(saved.id);
      }

      toast(
        `${saved.docNo || 'Physical Stock Amendment'} ${
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
      setForm(formFromDto(updated, items));
      setActionModal(null);

      toast(
        `${updated.docNo || 'Physical Stock Amendment'} • ${action} completed.`
      );
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

    const docNumber = currentDocument?.docNo || 'Physical Stock Amendment';

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
          Loading Physical Stock Amendment document...
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
            'Unable to load Physical Stock Amendment document.'
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
          Loading Physical Stock Amendment master data...
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
        <h1>{viewOnly ? 'View' : documentId ? 'Edit' : 'Add'} Physical Stock Amendment — {docNo}</h1>
        <p>Adjustment after physical verification — never silent overwrite</p>
      </div>

      <div className="note">
        <span className="material-symbols-rounded">info</span>
        <span>
          Workflow: DRAFT → SUBMITTED → APPROVED → POSTED • Posting adjusts
          stock based on variance
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
                Store / Location <em>*</em>
              </span>
              <select
                className="in"
                value={form.storeLocation}
                disabled={!editable}
                onChange={(event) =>
                  updateField('storeLocation', event.target.value)
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
              <span>
                Count Team <em>*</em>
              </span>
              <input
                className="in"
                value={form.countTeam}
                readOnly={!editable}
                onChange={(event) =>
                  updateField('countTeam', event.target.value)
                }
              />
            </label>

            <label className="fld">
              <span>
                Count Type <em>*</em>
              </span>
              <select
                className="in"
                value={form.countType}
                disabled={!editable}
                onChange={(event) =>
                  updateField('countType', event.target.value)
                }
              >
                <option value="">— Select —</option>
                {COUNT_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
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
                  <th>Batch No</th>
                  <th>System Qty</th>
                  <th>Physical Qty *</th>
                  <th>Variance Qty</th>
                  <th>Variance Value</th>
                  <th>Reason</th>
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
                        value={line.systemQty}
                        readOnly
                        tabIndex={-1}
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="any"
                        className="in"
                        value={line.physicalQty}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'physicalQty', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <input
                        className="in"
                        value={line.varianceQty}
                        readOnly
                        tabIndex={-1}
                      />
                    </td>

                    <td>
                      <input
                        className="in"
                        value={line.varianceValue}
                        readOnly
                        tabIndex={-1}
                      />
                    </td>

                    <td>
                      <select
                        className="in"
                        value={line.reasonCode}
                        disabled={!editable}
                        onChange={(event) =>
                          updateLine(index, 'reasonCode', event.target.value)
                        }
                      >
                        <option value="">— Select —</option>
                        {PHYSICAL_AMENDMENT_REASON_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
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