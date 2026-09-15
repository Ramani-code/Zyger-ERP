import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { useToast } from '../../../../contexts/ToastContext';
import {
  useStockReleaseDocument,
  useStockReleaseLookups,
  useStockReleaseMutations,
  useStockReleaseNextNumber,
} from '../../../../hooks/useAllotment';
import { stockAllotmentService } from '../../../../services/allotmentService';
import type {
  ReleaseDocumentAction,
  StockReleaseDto,
} from '../../../../types/inventory/allotment.types';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { filterPurchaseRelevantItems } from '../../../../utils/itemClassification';
import StatusBadge from '../../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../../components/common/ConfirmActionModal';
import SearchableItemLookup from '../../../../components/common/SearchableItemLookup';
import { RELEASE_REASON_OPTIONS } from '../../../../config/allotmentConfig';
import {
  buildPayload,
  createEmptyForm,
  createEmptyLine,
  formFromDto,
  isLineDirty,
  validateStockReleaseForm,
  type StockReleaseFormState,
  type StockReleaseLineFormState,
} from './stockReleaseForm';

interface ActionModalState {
  action: ReleaseDocumentAction;
  title: string;
  body: string;
  okLabel: string;
  danger?: boolean;
}

interface StockReleaseFormProps {
  documentId?: string | null;
  viewOnly?: boolean;
  onBack: () => void;
  onSaved?: (id: string) => void;
}

export default function StockReleaseForm({
  documentId,
  viewOnly = false,
  onBack,
  onSaved,
}: StockReleaseFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const lookups = useStockReleaseLookups();
  const documentQuery = useStockReleaseDocument(documentId ?? null);
  const nextNumberQuery = useStockReleaseNextNumber();

  const { createMutation, updateMutation, actionMutation } =
    useStockReleaseMutations();

  const [form, setForm] = useState<StockReleaseFormState>(() =>
    createEmptyForm()
  );
  const [currentDocument, setCurrentDocument] =
    useState<StockReleaseDto | null>(null);
  const [validationMode, setValidationMode] = useState<
    'draft' | 'submit' | null
  >(null);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(
    null
  );
  const [allotmentLines, setAllotmentLines] = useState<
    Array<{ itemCode: string; allottedQty: number }>
  >([]);

  const validationBoxRef = useRef<HTMLDivElement | null>(null);
  const initializedFor = useRef<string | null>(null);

  const items = lookups.items;
  const approvedAllotments = lookups.approvedAllotments;

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

  // Fetch allotment details when allotment number changes
  useEffect(() => {
    if (!form.allotmentNo) {
      setAllotmentLines([]);
      return;
    }

    let active = true;
    const controller = new AbortController();

    const fetchAllotment = async () => {
      try {
        const allotment = await stockAllotmentService.getByNumber(
          form.allotmentNo,
          controller.signal
        );

        if (!active) {
          return;
        }

        const lines = (allotment.lines ?? []).map((line) => ({
          itemCode: line.itemCode,
          allottedQty: line.allottedQty ?? 0,
          batchNo: line.batchNo ?? '',
          location: line.location ?? '',
        }));

        setAllotmentLines(lines);

        // Auto-fill lines from the selected stock allotment when the
        // release has no user-entered lines yet (create mode). When lines
        // already exist (e.g. editing a saved release), only refresh the
        // reserved quantity from the allotment.
        setForm((previous) => {
          const hasUserLines = previous.lines.some(isLineDirty);
          const allotmentMap = new Map(
            lines.map((line) => [line.itemCode, line])
          );

          if (!hasUserLines && lines.length > 0) {
            return {
              ...previous,
              lines: lines.map((line) => ({
                itemCode: line.itemCode,
                itemDesc:
                  itemsMap.get(line.itemCode)?.description ?? '',
                reservedQty: String(line.allottedQty || ''),
                releasedQty: String(line.allottedQty || ''),
                batchNo: line.batchNo ?? '',
                location: line.location ?? '',
              })),
            };
          }

          return {
            ...previous,
            lines: previous.lines.map((line) => {
              if (!line.itemCode) {
                return line;
              }

              const allotmentLine = allotmentMap.get(line.itemCode);

              return {
                ...line,
                reservedQty: allotmentLine
                  ? String(allotmentLine.allottedQty || '')
                  : '',
              };
            }),
          };
        });
      } catch {
        if (active) {
          setAllotmentLines([]);
        }
      }
    };

    fetchAllotment();

    return () => {
      active = false;
      controller.abort();
    };
  }, [form.allotmentNo, itemsMap]);

  const validationErrors = useMemo(() => {
    if (!validationMode) {
      return [];
    }

    return validateStockReleaseForm(
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
    key: keyof Omit<StockReleaseFormState, 'lines'>,
    value: string
  ) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const updateLine = (
    index: number,
    key: keyof StockReleaseLineFormState,
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

        // Update reserved qty from allotment
        const allotmentLine = allotmentLines.find(
          (al) => al.itemCode === value
        );
        line.reservedQty = allotmentLine
          ? String(allotmentLine.allottedQty)
          : '';
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

    const errors = validateStockReleaseForm(form, itemsMap, submit);

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

      let saved: StockReleaseDto;

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
        `${saved.docNo || 'Stock Release'} ${
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
    action: ReleaseDocumentAction,
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

      toast(`${updated.docNo || 'Stock Release'} • ${action} completed.`);
    } catch (actionError) {
      toast(getApiErrorMessage(actionError, 'Action failed.'), 'error');
    }
  };

  const openActionModal = (action: 'approve' | 'cancel') => {
    const id = currentDocument?.id ?? documentId;

    if (!id) {
      toast('Document is not saved yet.', 'error');
      return;
    }

    const docNumber = currentDocument?.docNo || 'Stock Release';

    if (action === 'approve') {
      setActionModal({
        action,
        title: `Approve ${docNumber}`,
        body: 'Add approval comment (optional).',
        okLabel: 'Approve',
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
          Loading Stock Release document...
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
            'Unable to load Stock Release document.'
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
          Loading Stock Release master data...
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
        <h1>{viewOnly ? 'View' : documentId ? 'Edit' : 'Add'} Stock Release — {docNo}</h1>
        <p>Release reserved stock back to available</p>
      </div>

      <div className="note">
        <span className="material-symbols-rounded">info</span>
        <span>
          Workflow: DRAFT → SUBMITTED → APPROVED → POSTED • Posting releases
          reserved stock
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
                Allotment No <em>*</em>
              </span>
              <select
                className="in"
                value={form.allotmentNo}
                disabled={!editable}
                onChange={(event) =>
                  updateField('allotmentNo', event.target.value)
                }
              >
                <option value="">— Select —</option>
                {approvedAllotments.map((allotment) => (
                  <option key={allotment.docNo} value={allotment.docNo}>
                    {allotment.docNo}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld">
              <span>
                Reason <em>*</em>
              </span>
              <select
                className="in"
                value={form.reason}
                disabled={!editable}
                onChange={(event) =>
                  updateField('reason', event.target.value)
                }
              >
                <option value="">— Select —</option>
                {RELEASE_REASON_OPTIONS.map((option) => (
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
                  <th>Reserved</th>
                  <th>Released Qty *</th>
                  <th>Batch No</th>
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
                        value={line.reservedQty}
                        readOnly
                        tabIndex={-1}
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="any"
                        className="in"
                        value={line.releasedQty}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'releasedQty', event.target.value)
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
                Post (Release Stock)
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