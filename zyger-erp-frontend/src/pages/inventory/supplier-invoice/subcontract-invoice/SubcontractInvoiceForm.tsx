import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { useToast } from '../../../../contexts/ToastContext';
import {
  useSubcontractInvoiceDocument,
  useSubcontractInvoiceLookups,
  useSubcontractInvoiceMutations,
  useSubcontractInvoiceNextNumber,
} from '../../../../hooks/useSupplierInvoice';
import type {
  SubcontractInvoiceDto,
  SupplierInvoiceAttachment,
  SupplierInvoiceDocumentAction,
} from '../../../../types/inventory/supplierInvoice.types';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { filterPurchaseRelevantItems } from '../../../../utils/itemClassification';
import { toNumber } from '../../../../utils/format';
import StatusBadge from '../../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../../components/common/ConfirmActionModal';
import SearchableItemLookup from '../../../../components/common/SearchableItemLookup';
import { PROCESS_OPTIONS } from '../../../../config/supplierInvoiceConfig';
import { subcontractInvoiceService } from '../../../../services/supplierInvoiceService';
import {
  buildPayload,
  createEmptyForm,
  createEmptyLine,
  formFromDto,

  validateSubcontractInvoiceForm,
  type SubcontractInvoiceFormState,
  type SubcontractInvoiceLineFormState,
} from './subcontractInvoiceForm';

interface ActionModalState {
  action: SupplierInvoiceDocumentAction;
  title: string;
  body: string;
  okLabel: string;
  danger?: boolean;
}

interface SubcontractInvoiceFormProps {
  documentId?: string | null;
  viewOnly?: boolean;
  onBack: () => void;
  onSaved?: (id: string) => void;
}

export default function SubcontractInvoiceForm({
  documentId,
  viewOnly = false,
  onBack,
  onSaved,
}: SubcontractInvoiceFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const lookups = useSubcontractInvoiceLookups();
  const documentQuery = useSubcontractInvoiceDocument(documentId ?? null);
  const nextNumberQuery = useSubcontractInvoiceNextNumber();

  const { createMutation, updateMutation, actionMutation } =
    useSubcontractInvoiceMutations();

  const [form, setForm] = useState<SubcontractInvoiceFormState>(() =>
    createEmptyForm()
  );
  const [currentDocument, setCurrentDocument] =
    useState<SubcontractInvoiceDto | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null);

  const validationBoxRef = useRef<HTMLDivElement | null>(null);
  const initializedFor = useRef<string | null>(null);

  const items = lookups.items;
  const suppliers = lookups.suppliers;
  const labourOrders = lookups.labourOrders;

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

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const attachmentRoom = 3 - form.attachments.length - pendingFiles.length;

  const docNo =
    currentDocument?.docNo ||
    nextNumberQuery.data?.nextNumber ||
    'Auto';

  useEffect(() => {
    if (!documentId) {
      initializedFor.current = null;
      setCurrentDocument(null);
      setForm(createEmptyForm());
      setPendingFiles([]);
      return;
    }

    if (documentQuery.data && initializedFor.current !== documentId) {
      initializedFor.current = documentId;
      setCurrentDocument(documentQuery.data);
      setForm(formFromDto(documentQuery.data, items));
      setPendingFiles([]);
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

  useEffect(() => {
    if (validationErrors.length > 0 && validationBoxRef.current) {
      validationBoxRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [validationErrors]);

  const updateField = (
    key: keyof Omit<SubcontractInvoiceFormState, 'lines'>,
    value: string
  ) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const updateLine = (
    index: number,
    key: keyof SubcontractInvoiceLineFormState,
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

      if (key === 'processedQty' || key === 'rate') {
        const processedQty = toNumber(line.processedQty);
        const rate = toNumber(line.rate);
        line.amount = String(Math.round(processedQty * rate));
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

    const errors = validateSubcontractInvoiceForm(form, itemsMap);
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

      let saved: SubcontractInvoiceDto;

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

      if (saved.id && pendingFiles.length > 0) {
        try {
          saved = await subcontractInvoiceService.uploadAttachments(
            saved.id,
            pendingFiles
          );
        } catch (attachmentError) {
          toast(
            getApiErrorMessage(attachmentError, 'Attachment upload failed.'),
            'error'
          );
        }
      }
      setPendingFiles([]);

      setCurrentDocument(saved);
      setForm(formFromDto(saved, items));

      if (saved.id) {
        initializedFor.current = saved.id;
        onSaved?.(saved.id);
      }

      toast(
        `${saved.docNo || 'Sub-Contract Invoice'} ${
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

  const onSelectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';

    if (selected.length > attachmentRoom) {
      toast('Maximum 3 attachments allowed.', 'error');
    }

    setPendingFiles((previous) => [
      ...previous,
      ...selected.slice(0, Math.max(attachmentRoom, 0)),
    ]);
  };

  const dropPendingFile = (name: string) => {
    setPendingFiles((previous) =>
      previous.filter((file) => file.name !== name)
    );
  };

  const downloadAttachment = async (attachment: SupplierInvoiceAttachment) => {
    const id = currentDocument?.id ?? documentId;
    if (!id) {
      toast('Document is not saved yet.', 'error');
      return;
    }

    try {
      await subcontractInvoiceService.downloadAttachment(
        id,
        attachment.id,
        attachment.fileName
      );
    } catch (attachmentError) {
      toast(
        getApiErrorMessage(attachmentError, 'Attachment download failed.'),
        'error'
      );
    }
  };

  const removeAttachment = async (attachment: SupplierInvoiceAttachment) => {
    const id = currentDocument?.id ?? documentId;
    if (!id) {
      toast('Document is not saved yet.', 'error');
      return;
    }

    setAttachmentBusy(true);
    try {
      const updated = await subcontractInvoiceService.removeAttachment(
        id,
        attachment.id
      );
      setCurrentDocument(updated);
      setForm(formFromDto(updated, items));
      toast('Attachment removed.');
    } catch (attachmentError) {
      toast(
        getApiErrorMessage(attachmentError, 'Attachment removal failed.'),
        'error'
      );
    } finally {
      setAttachmentBusy(false);
    }
  };

  const runAction = async (
    action: SupplierInvoiceDocumentAction,
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

      toast(`${updated.docNo || 'Sub-Contract Invoice'} • ${action} completed.`);
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

    const docNumber = currentDocument?.docNo || 'Sub-Contract Invoice';

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
          Loading Sub-Contract Invoice document...
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
            'Unable to load Sub-Contract Invoice document.'
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
          Loading Sub-Contract Invoice master data...
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
          {viewOnly ? 'View' : documentId ? 'Edit' : 'Add'} Sub-Contract
          Invoice — {docNo}
        </h1>
        <p>Subcontract processing charges</p>
      </div>

      <div className="note">
        <span className="material-symbols-rounded">info</span>
        <span>
          Workflow: DRAFT → SUBMITTED → APPROVED → POSTED • Financial document
          — no stock movement
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
                Vendor <em>*</em>
              </span>
              <select
                className="in"
                value={form.vendor}
                disabled={!editable}
                onChange={(event) => updateField('vendor', event.target.value)}
              >
                <option value="">— Select —</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.code} value={supplier.code}>
                    {supplier.code} — {supplier.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld">
              <span>
                Labour Order <em>*</em>
              </span>
              <select
                className="in"
                value={form.labourOrderNo}
                disabled={!editable}
                onChange={(event) =>
                  updateField('labourOrderNo', event.target.value)
                }
              >
                <option value="">— Select —</option>
                {labourOrders.map((lo) => (
                  <option key={lo.number} value={lo.number}>
                    {lo.number}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld">
              <span>
                Process <em>*</em>
              </span>
              <select
                className="in"
                value={form.process}
                disabled={!editable}
                onChange={(event) =>
                  updateField('process', event.target.value)
                }
              >
                <option value="">— Select —</option>
                {PROCESS_OPTIONS.map((process) => (
                  <option key={process} value={process}>
                    {process}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld">
              <span>
                Total Amount <em>*</em>
              </span>
              <input
                type="number"
                step="any"
                className="in"
                value={form.totalAmount}
                readOnly={!editable}
                onChange={(event) =>
                  updateField('totalAmount', event.target.value)
                }
              />
            </label>

            <label className="fld">
              <span>
                Attachment{editable ? ' (up to 3)' : ''}
              </span>
              <span className="atch">
                {form.attachments.map((attachment) => (
                  <span className="achip" key={attachment.id}>
                    <button
                      type="button"
                      className="lbtn"
                      onClick={() => downloadAttachment(attachment)}
                    >
                      <span className="material-symbols-rounded">
                        download
                      </span>
                      {attachment.fileName}
                    </button>
                    {editable && (
                      <button
                        type="button"
                        className="lbtn danger"
                        disabled={attachmentBusy}
                        onClick={() => removeAttachment(attachment)}
                      >
                        <span className="material-symbols-rounded">
                          delete
                        </span>
                        Remove
                      </button>
                    )}
                  </span>
                ))}

                {pendingFiles.map((file) => (
                  <span className="achip" key={`pending-${file.name}`}>
                    <span className="nm">{file.name}</span>
                    {editable && (
                      <button
                        type="button"
                        className="lbtn danger"
                        onClick={() => dropPendingFile(file.name)}
                      >
                        <span className="material-symbols-rounded">close</span>
                      </button>
                    )}
                  </span>
                ))}

                {editable && attachmentRoom > 0 ? (
                  <input
                    type="file"
                    multiple
                    className="in"
                    onChange={onSelectFiles}
                  />
                ) : (
                  form.attachments.length === 0 &&
                  pendingFiles.length === 0 && (
                    <span className="nm">None</span>
                  )
                )}
              </span>
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
                  <th>Processed Qty *</th>
                  <th>Rate *</th>
                  <th>Amount</th>
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
                        value={line.processedQty}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'processedQty', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="any"
                        className="in"
                        value={line.rate}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'rate', event.target.value)
                        }
                      />
                    </td>

                    <td>
                      <input
                        className="in"
                        value={line.amount}
                        readOnly
                        tabIndex={-1}
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
                Post
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