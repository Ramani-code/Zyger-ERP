import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  useQualityDoc,
  useQualityDocAction,
  useQualityDocCreate,
  useQualityDocDelete,
  useQualityDocList,
  useQualityDocNextNumber,
  useQualityDocUpdate,
} from '../../../hooks/useQualityDocs';
import type { DocScreenConfig, FieldDef } from './qualityDocConfigs';
import { formatDate, formatNumber, toOptionalNumber } from '../../../utils/format';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useToast } from '../../../contexts/ToastContext';
import { masterService } from '../../../services/masterService';
import { lookupDocumentByNumber } from '../../../utils/documentLookup';
import StatusBadge from '../../../components/common/StatusBadge';
import WorkflowStatusStepper from '../../../components/common/WorkflowStatusStepper';
import AttachmentsDrawer from '../../../components/common/AttachmentsDrawer';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';
import AuditHistoryDrawer from '../../../components/common/AuditHistoryDrawer';
import { auditEntityTypeFor } from '../../../utils/auditEntity';
import { exportToCsv } from '../../../utils/csvExport';
import { printDocLabel } from '../../../utils/barcode';

const PAGE_SIZE = 8;

interface QualityDocScreenProps {
  config: DocScreenConfig;
  initialDocId?: string | number;
  viewOnly?: boolean;
  defaultType?: string;
}

type ActionModal = { action: 'submit' | 'approve' | 'reject' | 'reopen' | 'cancel'; danger: boolean };

export default function QualityDocScreen({ config, initialDocId, viewOnly = false, defaultType }: QualityDocScreenProps) {
  const { toast } = useToast();
  const { can } = useAuth();
  const { docType } = config;

  const [mode, setMode] = useState<'list' | 'form'>(initialDocId ? 'form' : 'list');
  const [documentId, setDocumentId] = useState<string | null>(initialDocId ? String(initialDocId) : null);
  const [isViewOnly, setIsViewOnly] = useState(viewOnly);

  // list state
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState(defaultType ?? '');
  const [page, setPage] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);

  // form state
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [lines, setLines] = useState<Array<Record<string, unknown>>>([]);
  const [initializedForId, setInitializedForId] = useState('');
  const [actionModal, setActionModal] = useState<ActionModal | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);

  const listQuery = useQualityDocList(docType, {
    page,
    size: PAGE_SIZE,
    sort: 'date,desc',
    search: search || undefined,
    status: status || undefined,
    type: type || undefined,
  });
  const nextNumberQuery = useQualityDocNextNumber(docType);
  const documentQuery = useQualityDoc(docType, mode === 'form' && documentId ? documentId : null);
  const createMutation = useQualityDocCreate(docType);
  const updateMutation = useQualityDocUpdate(docType);
  const deleteMutation = useQualityDocDelete(docType);
  const actionMutation = useQualityDocAction(docType);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [search, status, type]);

  useEffect(() => {
    if (initialDocId) {
      setDocumentId(String(initialDocId));
      setIsViewOnly(viewOnly);
      setMode('form');
    }
  }, [initialDocId, viewOnly]);

  useEffect(() => {
    const doc = documentQuery.data;
    if (!doc || !documentId) return;
    const key = String(documentId);
    if (initializedForId === key) return;
    setInitializedForId(key);
    setForm({ ...doc });
    setLines(Array.isArray(doc.lines) ? (doc.lines as Array<Record<string, unknown>>).map((l) => ({ ...l })) : []);
  }, [documentQuery.data, documentId, initializedForId]);

  const doc = documentQuery.data;
  const genericStatus = String(doc?.status ?? 'DRAFT');
  const editable = !isViewOnly && (!documentId || ['DRAFT', 'REJECTED'].includes(genericStatus));
  const allowedTransitions = (doc?._allowedTransitions as string[]) ?? [];
  const isTerminal = Boolean(doc?._isTerminal);

  const isBusy = createMutation.isPending || updateMutation.isPending || actionMutation.isPending || deleteMutation.isPending;

  const rows = listQuery.data?.content ?? [];
  const totalElements = listQuery.data?.totalElements ?? 0;
  const totalPages = listQuery.data?.totalPages ?? 1;

  const openForm = (id: string | null, view: boolean) => {
    setDocumentId(id);
    setInitializedForId('');
    setIsViewOnly(view);
    setForm(
      config.typeFilter && defaultType
        ? { [config.typeFilter.field]: defaultType }
        : {}
    );
    setLines(config.lines?.seed ? config.lines.seed.map((s) => ({ ...s })) : (config.lines ? [{}] : []));
    setMode('form');
  };

  const backToList = () => {
    setDocumentId(null);
    setInitializedForId('');
    setIsViewOnly(false);
    setMode('list');
  };

  const updateFormField = (key: string, value: unknown) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };

      if (key === 'calibrationDate' || key === 'calibrationFrequencyMonths') {
        const calDateStr = String(next.calibrationDate || '');
        const months = Number(next.calibrationFrequencyMonths || 12);
        if (calDateStr && !Number.isNaN(months) && months > 0) {
          try {
            const d = new Date(calDateStr);
            d.setMonth(d.getMonth() + months);
            next.nextDueDate = d.toISOString().slice(0, 10);
          } catch {
            // ignore
          }
        }
      }

      return next;
    });

    if (typeof value === 'string' && value.trim()) {
      const strVal = value.trim();

      if (key === 'itemCode') {
        void masterService.getItems().then((items) => {
          const item = items.find((i) => i.code === strVal);
          if (item) {
            setForm((prev) => ({
              ...prev,
              itemDescription: prev.itemDescription || item.description,
              uom: prev.uom || item.uom,
            }));
          }
        });
      }

      if (key === 'customerCode' || key === 'partyCode') {
        void masterService.getCustomers().then((customers) => {
          const cust = customers.find((c) => c.code === strVal);
          if (cust) {
            setForm((prev) => ({
              ...prev,
              customerName: prev.customerName || cust.name,
              partyName: prev.partyName || cust.name,
            }));
          }
        });
        void masterService.getSuppliers().then((suppliers) => {
          const sup = suppliers.find((s) => s.code === strVal);
          if (sup) {
            setForm((prev) => ({
              ...prev,
              partyName: prev.partyName || sup.name,
            }));
          }
        });
      }

      if (
        key === 'referenceDocNo' ||
        key === 'grnNumber' ||
        key === 'inwardNumber' ||
        key === 'purchaseOrderNumber' ||
        key === 'jobOrderNumber' ||
        key === 'salesOrderNumber' ||
        key === 'dcNumber'
      ) {
        const docTypeKey =
          key === 'purchaseOrderNumber'
            ? 'purchase-order'
            : key === 'jobOrderNumber'
            ? 'job-order'
            : key === 'salesOrderNumber'
            ? 'sales-order'
            : key === 'grnNumber'
            ? 'grn'
            : key === 'dcNumber'
            ? 'sales-dc'
            : 'general-inward';

        void lookupDocumentByNumber(docTypeKey, strVal).then((doc) => {
          if (!doc) return;
          setForm((prev) => ({
            ...prev,
            itemCode: prev.itemCode || doc.lines[0]?.itemCode || '',
            itemDescription: prev.itemDescription || doc.lines[0]?.itemDesc || '',
            partyCode: prev.partyCode || doc.party || doc.supplier || doc.customer || '',
            partyName: prev.partyName || doc.party || doc.supplier || doc.customer || '',
            uom: prev.uom || doc.lines[0]?.uom || '',
            drawingNumber: prev.drawingNumber || doc.raw?.drawingNumber || '',
            batchNumber: prev.batchNumber || doc.lines[0]?.batchNo || '',
            heatNumber: prev.heatNumber || doc.lines[0]?.heatNo || '',
            quantityAffected: prev.quantityAffected || doc.lines[0]?.qty || '',
            quantityCovered: prev.quantityCovered || doc.lines[0]?.qty || '',
          }));
        });
      }
    }
  };

  const fieldLabel = (field: FieldDef) => field.label.replace(' *', '');

  const buildPayload = () => {
    const payload: Record<string, unknown> = {};
    for (const field of config.fields) {
      const raw = form[field.key];
      if (field.type === 'number') {
        payload[field.key] = toOptionalNumber(raw == null ? '' : String(raw));
      } else if (field.type === 'checkbox') {
        payload[field.key] = Boolean(raw);
      } else {
        payload[field.key] = raw == null ? null : String(raw);
      }
    }
    if (config.lines) {
      payload.lines = lines
        .filter((l) => String(l[config.lines!.fields[0].key] ?? '').trim() !== '')
        .map((l) => {
          const out: Record<string, unknown> = { ...l };
          delete out.id;
          delete out.qty;
          return out;
        });
    }
    return payload;
  };

  const validate = () => {
    const errors: string[] = [];
    for (const field of config.fields) {
      if (field.required && !String(form[field.key] ?? '').trim()) {
        errors.push(`${fieldLabel(field)} is required.`);
      }
    }
    return errors;
  };

  const handleCreate = async () => {
    const errors = validate();
    if (errors.length > 0) {
      toast(errors[0], 'error');
      return;
    }
    try {
      const created = await createMutation.mutateAsync(buildPayload());
      toast(`${created.docNo ?? docType} created as draft.`);
      setDocumentId(String(created.id ?? ''));
      setInitializedForId('');
    } catch (createError) {
      toast(getApiErrorMessage(createError, 'Create failed.'), 'error');
    }
  };

  const handleSave = async () => {
    if (!documentId) return;
    try {
      const updated = await updateMutation.mutateAsync({ id: documentId, payload: buildPayload() });
      setForm({ ...updated });
      toast(`${updated.docNo ?? docType} saved.`);
    } catch (saveError) {
      toast(getApiErrorMessage(saveError, 'Save failed.'), 'error');
    }
  };

  const runAction = async (action: string, note?: string) => {
    if (!documentId) return;
    try {
      const updated = await actionMutation.mutateAsync({ id: documentId, action: action as 'submit', note });
      setForm({ ...updated });
      setActionModal(null);
      toast(`${updated.docNo ?? docType} • ${action} completed.`);
    } catch (actionError) {
      toast(getApiErrorMessage(actionError, `${action} failed.`), 'error');
    }
  };

  const cellValue = (row: Record<string, unknown>, field: string): string => {
    const raw = row[field];
    if (raw == null) return '—';
    if (typeof raw === 'number') return formatNumber(raw);
    const s = String(raw);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return formatDate(s.slice(0, 10));
    return s;
  };

  const listBody = useMemo(() => {
    if (listQuery.isPending) {
      return (
        <div className="panel">
          <div className="empty">
            <span className="material-symbols-rounded">hourglass_empty</span> Loading {config.title} records...
          </div>
        </div>
      );
    }
    if (listQuery.isError) {
      return (
        <div className="panel">
          <div className="empty">
            <span className="material-symbols-rounded">error</span>
            {getApiErrorMessage(listQuery.error, 'Unable to load records.')}
            <div style={{ marginTop: '14px' }}>
              <button className="btn" onClick={() => listQuery.refetch()}>
                <span className="material-symbols-rounded">refresh</span> Retry
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="panel">
        <div className="toolbar" style={{ gap: '8px', justifyContent: 'flex-start' }}>
          <div className="searchwrap" style={{ flex: '0 0 auto' }}>
            <span className="material-symbols-rounded">search</span>
            <input className="in" style={{ width: '250px' }} value={searchInput} placeholder="Search..." onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <button
            className="ibtn"
            title="Export CSV"
            onClick={() =>
              exportToCsv(
                rows as unknown as Record<string, unknown>[],
                config.columns.map((c) => ({ key: c.field, label: c.label })),
                config.docType
              )
            }
          >
            <span className="material-symbols-rounded">download</span>
          </button>
          <span className="count">
            {formatNumber(totalElements)} record{totalElements === 1 ? '' : 's'}
          </span>
          <select className="in" style={{ flex: '0 0 auto', width: '180px' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All Status</option>
            {config.statusOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {config.typeFilter && (
            <select className="in" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">{config.typeFilter.label}</option>
              {config.typeFilter.options.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
          <div className="sp" />
          <button className="btn btn-p" onClick={() => openForm(null, false)}>
            <span className="material-symbols-rounded">add</span> Add
          </button>
        </div>

        <div className="twrap">
          <table className="tbl">
            <thead>
              <tr>
                {config.columns.map((c) => (
                  <th key={c.field} className={c.numeric ? 'num' : ''}>{c.label}</th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? (
                rows.map((row) => (
                  <tr key={String(row.id)}>
                    {config.columns.map((c) => (
                      <td key={c.field} className={c.numeric ? 'num' : ''}>
                        {c.field === config.statusField ? (
                          <StatusBadge status={String(row[c.field] ?? 'DRAFT')} />
                        ) : (
                          cellValue(row, c.field)
                        )}
                      </td>
                    ))}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="ibtn" title="View" onClick={() => openForm(String(row.id), true)}>
                        <span className="material-symbols-rounded">visibility</span>
                      </button>
                      <button className="ibtn" title="Edit / Open" onClick={() => openForm(String(row.id), false)}>
                        <span className="material-symbols-rounded">edit</span>
                      </button>
                      <button className="ibtn danger" title="Delete" onClick={() => setDeleteTarget(row)}>
                        <span className="material-symbols-rounded">delete</span>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={config.columns.length + 1}>
                    <div className="empty">
                      <span className="material-symbols-rounded">description</span> No records found. Click “Add”.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pager">
          <span>
            Showing {rows.length === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalElements)} of {formatNumber(totalElements)}
          </span>
          <div className="pgs">
            <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹</button>
            {Array.from({ length: totalPages }, (_, i) => i).map((i) => (
              <button key={i} className={i === page ? 'on' : ''} onClick={() => setPage(i)}>{i + 1}</button>
            ))}
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>›</button>
          </div>
        </div>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQuery.data, listQuery.isPending, listQuery.isError, searchInput, status, type, page, totalElements, totalPages, rows]);

  if (mode === 'list') {
    return (
      <>
        <div className="pg-head">
          <h1>{config.title}</h1>
          <p>{config.subtitle}</p>
        </div>
        {listBody}
        <ConfirmActionModal
          open={Boolean(deleteTarget)}
          title={`Delete ${String(deleteTarget?.docNo ?? '')}`}
          body="The record will be permanently removed. Only DRAFT/REJECTED documents can be deleted."
          okLabel="Delete"
          danger
          busy={deleteMutation.isPending}
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            if (!deleteTarget) return;
            try {
              await deleteMutation.mutateAsync(String(deleteTarget.id));
              toast(`${String(deleteTarget.docNo ?? '')} deleted.`);
              setDeleteTarget(null);
            } catch (deleteError) {
              toast(getApiErrorMessage(deleteError, 'Delete failed.'), 'error');
            }
          }}
        />
      </>
    );
  }

  if (documentId && documentQuery.isPending) {
    return (
      <div className="panel">
        <div className="empty">
          <span className="material-symbols-rounded">hourglass_empty</span> Loading {config.title}...
        </div>
      </div>
    );
  }

  if (documentId && documentQuery.isError) {
    return (
      <div className="panel">
        <div className="empty">
          <span className="material-symbols-rounded">error</span>
          {getApiErrorMessage(documentQuery.error, 'Unable to load record.')}
          <div style={{ marginTop: '14px' }}>
            <button className="btn" onClick={() => documentQuery.refetch()}>
              <span className="material-symbols-rounded">refresh</span> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const docNo = documentId ? String(doc?.docNo ?? '') : String(nextNumberQuery.data?.nextNumber ?? '—');

  return (
    <>
      <div className="pg-head">
        <h1>
          {isViewOnly ? 'View' : documentId ? 'Edit' : 'Add'} {config.title} — {docNo}
        </h1>
        <p>{config.subtitle}</p>
      </div>

      <div className="note">
        <span className="material-symbols-rounded">info</span>
        <span>Workflow: DRAFT → SUBMITTED → APPROVED • Only DRAFT/REJECTED records are editable</span>
      </div>

      <form onSubmit={(e) => e.preventDefault()}>
        <div className="panel">
          <div className="panel-h">
            <h2>
              <span className="material-symbols-rounded">description</span> Header
            </h2>
            {documentId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button type="button" className="btn btn-sm" title="Print Label" onClick={() => {
                  const docNo = String(form.docNo ?? form.documentNumber ?? documentId);
                  printDocLabel(docNo, docType, String(form.title ?? form.itemCode ?? docNo));
                }}>
                  <span className="material-symbols-rounded">qr_code_2</span>
                </button>
                <button type="button" className="btn btn-sm" title="Attachments" onClick={() => setAttachmentsOpen(true)}>
                  <span className="material-symbols-rounded">attach_file</span> Attach
                </button>
                <button type="button" className="btn btn-sm" title="Audit History" onClick={() => setAuditOpen(true)}>
                  <span className="material-symbols-rounded">history</span> Audit
                </button>
                <WorkflowStatusStepper
                  currentStatus={genericStatus}
                  allowedTransitions={allowedTransitions}
                  isTerminal={isTerminal}
                  onAction={(act) => {
                    if (act === 'submit' || act === 'approve' || act === 'reject' || act === 'cancel' || act === 'reopen') {
                      if (act === 'submit' || act === 'approve' || act === 'reject' || act === 'cancel') {
                        setActionModal({ action: act as ActionModal['action'], danger: act === 'reject' || act === 'cancel' });
                      } else {
                        runAction(act);
                      }
                    }
                  }}
                />
              </div>
            )}
          </div>
          <div className="fgrid">
            {config.fields.map((field) => (
              <label key={field.key} className={`fld ${field.span2 ? 'span2' : ''}`}>
                <span>{field.label}</span>
                {field.type === 'textarea' ? (
                  <textarea
                    className="in"
                    rows={2}
                    readOnly={!editable}
                    value={String(form[field.key] ?? '')}
                    onChange={(e) => updateFormField(field.key, e.target.value)}
                  />
                ) : field.type === 'select' ? (
                  <select
                    className="in"
                    disabled={!editable}
                    value={String(form[field.key] ?? '')}
                    onChange={(e) => updateFormField(field.key, e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {(field.options ?? []).map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : field.type === 'checkbox' ? (
                  <input
                    type="checkbox"
                    className="checkbox"
                    disabled={!editable}
                    checked={Boolean(form[field.key])}
                    onChange={(e) => updateFormField(field.key, e.target.checked)}
                  />
                ) : (
                  <input
                    className="in"
                    type={field.type ?? 'text'}
                    readOnly={!editable}
                    value={String(form[field.key] ?? '')}
                    onChange={(e) => updateFormField(field.key, e.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
        </div>

        {config.lines && editable && (
          <div className="panel">
            <div className="panel-h">
              <h2>
                <span className="material-symbols-rounded">table_view</span> {config.lines.title}
              </h2>
              {!config.lines.seed && (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={isBusy}
                  onClick={() => setLines((c) => [...c, {}])}
                >
                  <span className="material-symbols-rounded">add</span> Add Line
                </button>
              )}
            </div>
            <div className="twrap">
              <table className="tbl lines">
                <thead>
                  <tr>
                    {config.lines.fields.map((f) => (
                      <th key={f.key} style={f.width ? { width: f.width, minWidth: f.width } : undefined}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={index}>
                      {config.lines!.fields.map((f) => (
                        <td key={f.key} style={f.width ? { width: f.width, minWidth: f.width } : undefined}>
                          {f.type === 'select' ? (
                            <select
                              className="in"
                              value={String(line[f.key] ?? '')}
                              onChange={(e) =>
                                setLines((c) => c.map((l, i) => (i === index ? { ...l, [f.key]: e.target.value } : l)))
                              }
                            >
                              <option value="">—</option>
                              {(f.options ?? []).map((o) => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="in"
                              type={f.type ?? 'text'}
                              readOnly={f.readonly || !editable}
                              value={String(line[f.key] ?? '')}
                              onChange={(e) =>
                                setLines((c) => c.map((l, i) => (i === index ? { ...l, [f.key]: e.target.value } : l)))
                              }
                            />
                          )}
                        </td>
                      ))}
                      {!config.lines!.seed && (
                        <td>
                          <button
                            type="button"
                            className="ibtn danger"
                            disabled={isBusy}
                            onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                          >
                            <span className="material-symbols-rounded">delete</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {config.lines && !editable && Array.isArray(form.lines) && (form.lines as Array<Record<string, unknown>>).length > 0 && (
          <div className="panel">
            <div className="panel-h">
              <h2>
                <span className="material-symbols-rounded">table_view</span> {config.lines.title}
              </h2>
            </div>
            <div className="twrap">
              <table className="tbl">
                <thead>
                  <tr>
                    {config.lines.fields.map((f) => (
                      <th key={f.key} style={f.width ? { width: f.width, minWidth: f.width } : undefined}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(form.lines as Array<Record<string, unknown>>).map((line, index) => (
                    <tr key={index}>
                      {config.lines!.fields.map((f) => (
                        <td key={f.key} style={f.width ? { width: f.width, minWidth: f.width } : undefined}>{line[f.key] == null ? '—' : String(line[f.key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="panel">
          <div className="actbar">
            <span className="lft">
              <span className="material-symbols-rounded">lock</span>
              {documentId ? 'Audited document' : 'New document'}
            </span>

            <button type="button" className="btn" onClick={backToList} disabled={isBusy}>
              <span className="material-symbols-rounded">arrow_back</span> Back
            </button>

            {!documentId && (
              <button type="button" className="btn btn-p" onClick={handleCreate} disabled={isBusy}>
                <span className="material-symbols-rounded">save</span> Create Draft
              </button>
            )}

            {documentId && editable && (
              <>
                <button type="button" className="btn" onClick={handleSave} disabled={isBusy}>
                  <span className="material-symbols-rounded">save</span> Save
                </button>
                {genericStatus !== 'DRAFT' && (
                  <button type="button" className="btn" onClick={() => runAction('reopen')} disabled={isBusy}>
                    <span className="material-symbols-rounded">restart_alt</span> Reopen to Draft
                  </button>
                )}
              </>
            )}

            {documentId && !isViewOnly && genericStatus === 'DRAFT' && (
              <button
                type="button"
                className="btn btn-p"
                onClick={() => setActionModal({ action: 'submit', danger: false })}
                disabled={isBusy}
              >
                <span className="material-symbols-rounded">send</span> Submit
              </button>
            )}

            {documentId && !isViewOnly && genericStatus === 'SUBMITTED' && can('quality', 'Approve') && (
              <>
                <button
                  type="button"
                  className="btn btn-g"
                  onClick={() => setActionModal({ action: 'approve', danger: false })}
                  disabled={isBusy}
                >
                  <span className="material-symbols-rounded">thumb_up</span> Approve
                </button>
                <button
                  type="button"
                  className="btn btn-d"
                  onClick={() => setActionModal({ action: 'reject', danger: true })}
                  disabled={isBusy}
                >
                  <span className="material-symbols-rounded">thumb_down</span> Reject
                </button>
              </>
            )}

            {documentId && !isViewOnly && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(genericStatus) && can('quality', 'Cancel') && (
              <button
                type="button"
                className="btn btn-d"
                onClick={() => setActionModal({ action: 'cancel', danger: true })}
                disabled={isBusy}
              >
                <span className="material-symbols-rounded">block</span> Cancel
              </button>
            )}
          </div>
        </div>
      </form>

      <ConfirmActionModal
        open={Boolean(actionModal)}
        title={`${actionModal?.action ?? ''} ${docNo}`}
        body={
          actionModal?.action === 'approve'
            ? 'Approving records the action with your user in the audit trail.'
            : actionModal?.action === 'reject'
              ? 'Reason for rejection:'
              : actionModal?.action === 'cancel'
                ? 'This cancels the record with an audit trail.'
                : 'Submit this record for review?'
        }
        okLabel={actionModal ? actionModal.action.charAt(0).toUpperCase() + actionModal.action.slice(1) : 'Confirm'}
        danger={actionModal?.danger}
        busy={actionMutation.isPending}
        onClose={() => setActionModal(null)}
        onConfirm={(note) => actionModal && runAction(actionModal.action, note)}
      />

      <AuditHistoryDrawer open={auditOpen} entityType={auditEntityTypeFor(docType)} entityId={documentId ?? undefined} onClose={() => setAuditOpen(false)} />

      {attachmentsOpen && documentId && (
        <AttachmentsDrawer ownerType={docType} ownerId={Number(documentId)} onClose={() => setAttachmentsOpen(false)} />
      )}
    </>
  );
}
