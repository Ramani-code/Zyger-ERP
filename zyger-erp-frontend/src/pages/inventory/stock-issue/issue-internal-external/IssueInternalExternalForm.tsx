import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { useToast } from '../../../../contexts/ToastContext';
import {
  useApprovedIssueRequests,
  useIssueInternalExternalDocument,
  useIssueInternalExternalLookups,
  useIssueInternalExternalMutations,
  useIssueInternalExternalNextNumber,
} from '../../../../hooks/useIssueInternalExternal';
import { issueInternalExternalService } from '../../../../services/issueInternalExternalService';
import { stockIssueRequestService } from '../../../../services/stockIssueRequestService';
import type {
  IssueInternalExternalDocumentAction,
  IssueInternalExternalDto,
  IssueInternalExternalType,
} from '../../../../types/inventory/issueInternalExternal.types';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { filterPurchaseRelevantItems } from '../../../../utils/itemClassification';

import StatusBadge from '../../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../../components/common/ConfirmActionModal';
import SearchableItemLookup from '../../../../components/common/SearchableItemLookup';
import {
  availabilityKey,
  buildPayload,
  createEmptyForm,
  createEmptyLine,
  formFromDto,
  validateIssueInternalExternalForm,
  type IssueInternalExternalFormState,
  type IssueInternalExternalLineFormState,
} from './issueInternalExternalForm';

const RETURNABLE_OPTIONS = [
  { value: 'Yes', label: 'Returnable' },
  { value: 'No', label: 'Non-Returnable' },
];

interface ActionModalState {
  action: IssueInternalExternalDocumentAction;
  title: string;
  body: string;
  okLabel: string;
  danger?: boolean;
}

interface IssueInternalExternalFormProps {
  documentId?: string | null;
  viewOnly?: boolean;
  onBack: () => void;
  onSaved?: (id: string) => void;
}

export default function IssueInternalExternalForm({
  documentId,
  viewOnly = false,
  onBack,
  onSaved,
}: IssueInternalExternalFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const lookups = useIssueInternalExternalLookups();
  const approvedRequestsQuery = useApprovedIssueRequests();
  const documentQuery = useIssueInternalExternalDocument(documentId ?? null);

  const { createMutation, updateMutation, actionMutation } =
    useIssueInternalExternalMutations();

  const [form, setForm] = useState<IssueInternalExternalFormState>(() =>
    createEmptyForm()
  );
  const [currentDocument, setCurrentDocument] =
    useState<IssueInternalExternalDto | null>(null);
  const [validationMode, setValidationMode] = useState<
    'draft' | 'submit' | null
  >(null);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(
    null
  );
  const [availabilityMap, setAvailabilityMap] = useState<
    Record<string, string>
  >({});

  const validationBoxRef = useRef<HTMLDivElement | null>(null);
  const initializedFor = useRef<string | null>(null);

  const items = lookups.items;
  // FRS DOC-INV-FRS-02 Priority#1 [FIXED] — merged union instead of an all-or-nothing
  // stores-vs-locations fallback; see utils/locationOptions.ts for why.
  const locations = lookups.stores ?? [];
  const departments = lookups.departments;

  const itemsMap = useMemo(
    () => new Map(items.map((item) => [item.code, item])),
    [items]
  );

  // Item Code should only ever offer Purchasable / Customer-Supplied / Manufacturing
  // items (the three item screens under Master → Inventory → Items) — this picker
  // previously showed every item in the system unfiltered.
  const allowedItems = useMemo(() => filterPurchaseRelevantItems(items), [items]);

  const nextNumberQuery = useIssueInternalExternalNextNumber(
    (form.issueType as IssueInternalExternalType) || null
  );

  const status = currentDocument?.status ?? 'DRAFT';
  const editable = !viewOnly && (status === 'DRAFT' || status === 'REJECTED');

  const docNo =
    currentDocument?.docNo ||
    nextNumberQuery.data?.nextNumber ||
    'Auto';

  const availabilityPairs = useMemo(() => {
    const pairs: Array<{ itemCode: string; location: string }> = [];

    form.lines.forEach((line) => {
      const effectiveLocation = line.location || form.sourceLocation;

      if (line.itemCode && effectiveLocation) {
        pairs.push({
          itemCode: line.itemCode,
          location: effectiveLocation,
        });
      }
    });

    const unique = new Map(
      pairs.map((pair) => [
        availabilityKey(pair.itemCode, pair.location),
        pair,
      ])
    );

    return Array.from(unique.values());
  }, [form.lines, form.sourceLocation]);

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

  useEffect(() => {
    if (availabilityPairs.length === 0) {
      setAvailabilityMap({});
      return;
    }

    let active = true;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const results =
          await issueInternalExternalService.checkAvailability(
            availabilityPairs,
            controller.signal
          );

        if (!active) {
          return;
        }

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
    if (!validationMode) {
      return [];
    }

    return validateIssueInternalExternalForm(
      form,
      itemsMap,
      validationMode === 'submit',
      availabilityMap
    );
  }, [form, itemsMap, validationMode, availabilityMap]);

  useEffect(() => {
    if (validationErrors.length > 0 && validationBoxRef.current) {
      validationBoxRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [validationErrors]);

  const updateField = (
    key: keyof Omit<IssueInternalExternalFormState, 'lines'>,
    value: string
  ) => {
    setForm((previous) => {
      const next = {
        ...previous,
        [key]: value,
      };

      if (key === 'sourceLocation') {
        // Priority#1 [FIXED] — was `line.location ? line : {...}`: once a line acquired ANY
        // location (even just inherited from the header on the very first render), changing
        // Source Location again silently stopped updating it, so the availability check kept
        // querying the old store forever. Now a line still follows the header unless its
        // location has actually diverged from the header's *previous* value (a real per-line
        // override), matching what a user switching stores on this doc actually expects.
        next.lines = previous.lines.map((line) =>
          (!line.location || line.location === previous.sourceLocation)
            ? { ...line, location: value }
            : line
        );
      }

      return next;
    });
  };

  const updateIssueRequest = (value: string) => {
    setForm((previous) => ({ ...previous, issueRequestNo: value }));

    if (!value) {
      return;
    }

    const request = approvedRequestsQuery.data?.find(
      (entry) => entry.docNo === value
    );

    if (!request?.id) {
      toast('Issue Request not found.', 'error');
      return;
    }

    void stockIssueRequestService
      .getById(request.id)
      .then((sir) => {
        setForm((previous) => ({
          ...previous,
          toDepartment:
            previous.issueType === 'INTERNAL'
              ? sir.department ?? previous.toDepartment
              : previous.toDepartment,
          lines: (sir.lines ?? []).map((line) => ({
            itemCode: line.itemCode,
            itemDesc: itemsMap.get(line.itemCode)?.description ?? '',
            availableQty: '',
            issueQty: String(line.approvedQty ?? line.requestedQty ?? ''),
            batchNo: '',
            heatNo: '',
            returnable: line.returnable ?? '',
            location: previous.sourceLocation,
            remarks: '',
          })),
        }));
      })
      .catch((applyError) => {
        toast(
          getApiErrorMessage(
            applyError,
            'Unable to load Issue Request details.'
          ),
          'error'
        );
      });
  };

  const updateLine = (
    index: number,
    key: keyof IssueInternalExternalLineFormState,
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
      lines: [...previous.lines, createEmptyLine(previous.sourceLocation)],
    }));
  };

  const deleteLine = (index: number) => {
    if (!editable) {
      return;
    }

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

  const getAvailableDisplay = (
    line: IssueInternalExternalLineFormState
  ): string => {
    const effectiveLocation = line.location || form.sourceLocation;

    if (!line.itemCode || !effectiveLocation) {
      return '';
    }

    return (
      availabilityMap[availabilityKey(line.itemCode, effectiveLocation)] ??
      ''
    );
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

    const errors = validateIssueInternalExternalForm(
      form,
      itemsMap,
      submit,
      availabilityMap
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

      let saved: IssueInternalExternalDto;

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
        `${saved.docNo || 'Issue'} ${
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

  const handleStockIssue = async () => {
    if (!editable) {
      return;
    }

    setValidationMode('submit');

    const errors = validateIssueInternalExternalForm(
      form,
      itemsMap,
      true,
      availabilityMap
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

      let saved: IssueInternalExternalDto = targetId
        ? await updateMutation.mutateAsync({ id: targetId, payload })
        : await createMutation.mutateAsync(payload);

      if (saved.status === 'DRAFT' && saved.id) {
        saved = await actionMutation.mutateAsync({
          id: saved.id,
          action: 'submit',
          note: '',
        });
      }

      if (saved.status === 'SUBMITTED' && saved.id) {
        saved = await actionMutation.mutateAsync({
          id: saved.id,
          action: 'approve',
          note: '',
        });
      }

      if (saved.status === 'APPROVED' && saved.id) {
        saved = await actionMutation.mutateAsync({
          id: saved.id,
          action: 'post',
          note: '',
        });
      }

      setCurrentDocument(saved);
      setForm(formFromDto(saved, items));

      if (saved.id) {
        initializedFor.current = saved.id;
        onSaved?.(saved.id);
      }

      toast(`${saved.docNo || 'Issue'} — Stock issued successfully.`);
    } catch (issueError) {
      toast(
        getApiErrorMessage(issueError, 'Stock issue failed.'),
        'error'
      );
    }
  };

  const runAction = async (
    action: IssueInternalExternalDocumentAction,
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

      toast(`${updated.docNo || 'Issue'} • ${action} completed.`);
    } catch (actionError) {
      toast(getApiErrorMessage(actionError, 'Action failed.'), 'error');
    }
  };

  const handlePost = async () => {
    setValidationMode('submit');

    const errors = validateIssueInternalExternalForm(
      form,
      itemsMap,
      true,
      availabilityMap
    );

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

    const docNumber = currentDocument?.docNo || 'Issue';

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
          Loading Issue document...
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
            'Unable to load Issue document.'
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
        <h1>{viewOnly ? 'View' : documentId ? 'Edit' : 'Add'} Issue Internal / External — {docNo}</h1>
        <p>
          Stock issue to a department (internal) or external party — stock
          reduces on posting
        </p>
      </div>

      <div className="note">
        <span className="material-symbols-rounded">info</span>
        <span>
          Click Stock Issue to post in one step — stock reduces immediately •
          Internal = INT, External = EXT
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
              <span>Issue Request</span>
              <select
                className="in"
                value={form.issueRequestNo}
                disabled={!editable || approvedRequestsQuery.isPending}
                onChange={(event) =>
                  updateIssueRequest(event.target.value)
                }
              >
                <option value="">— Select —</option>
                {approvedRequestsQuery.data?.map((request) => (
                  <option key={request.id} value={request.docNo}>
                    {request.docNo}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld">
              <span>
                Issue Type <em>*</em>
              </span>
              <select
                className="in"
                value={form.issueType}
                disabled={!editable}
                onChange={(event) =>
                  updateField('issueType', event.target.value)
                }
              >
                <option value="INTERNAL">Internal Issue</option>
                <option value="EXTERNAL">External Issue</option>
              </select>
            </label>

            {form.issueType === 'INTERNAL' && (
              <label className="fld">
                <span>
                  To Department <em>*</em>
                </span>
                <select
                  className="in"
                  value={form.toDepartment}
                  disabled={!editable}
                  onChange={(event) =>
                    updateField('toDepartment', event.target.value)
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
            )}

            {form.issueType === 'EXTERNAL' && (
              <label className="fld">
                <span>
                  Issued To <em>*</em>
                </span>
                <input
                  className="in"
                  value={form.issuedTo}
                  readOnly={!editable}
                  onChange={(event) =>
                    updateField('issuedTo', event.target.value)
                  }
                />
              </label>
            )}

            <label className="fld">
              <span>
                Source Location <em>*</em>
              </span>
              <select
                className="in"
                value={form.sourceLocation}
                disabled={!editable}
                onChange={(event) =>
                  updateField('sourceLocation', event.target.value)
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
                  <th>Available</th>
                  <th>Issue Qty *</th>
                  <th>Heat No</th>
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
                        value={getAvailableDisplay(line)}
                        readOnly
                        tabIndex={-1}
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        step="any"
                        className="in"
                        value={line.issueQty}
                        readOnly={!editable}
                        onChange={(event) =>
                          updateLine(index, 'issueQty', event.target.value)
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
                        value={line.returnable}
                        disabled={!editable}
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
                  className="btn btn-g"
                  onClick={handleStockIssue}
                  disabled={isBusy}
                >
                  <span className="material-symbols-rounded">
                    published_with_changes
                  </span>
                  Stock Issue
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
        onConfirm={(note) => {
          if (actionModal) {
            runAction(actionModal.action, note);
          }
        }}
      />
    </>
  );
}