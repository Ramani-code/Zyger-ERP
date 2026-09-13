import { useEffect, useState } from 'react';
import {
  useSalesDoc,
  useSalesDocAction,
  useSalesDocCreate,
  useSalesDocDelete,
  useSalesDocList,
  useSalesDocNextNumber,
  useSalesDocUpdate,
  type SalesDocAction,
} from '../../../hooks/useSalesDocs';
import { formatNumber, todayISO } from '../../../utils/format';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import StatusBadge from '../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';

const PAGE_SIZE = 10;
const DOC_TYPE = 'credit-debit-note';
const REASON_CODES = ['PRICE_CORRECTION', 'RATE_DIFFERENCE', 'REBATE', 'SHORTAGE', 'OTHER'];

type ActionModal = { action: Extract<SalesDocAction, 'submit' | 'approve' | 'reject'>; danger: boolean };

export default function CreditDebitNotePage() {
  const { toast } = useToast();
  const { can } = useAuth();

  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const [actionModal, setActionModal] = useState<ActionModal | null>(null);
  const [postConfirm, setPostConfirm] = useState(false);

  const [form, setForm] = useState<Record<string, unknown>>({});

  const listQuery = useSalesDocList(DOC_TYPE, { page, size: PAGE_SIZE, sort: 'date,desc', search, status });
  const docQuery = useSalesDoc(DOC_TYPE, documentId);
  const createMutation = useSalesDocCreate(DOC_TYPE);
  const updateMutation = useSalesDocUpdate(DOC_TYPE);
  const deleteMutation = useSalesDocDelete(DOC_TYPE);
  const actionMutation = useSalesDocAction(DOC_TYPE);
  const nextNumberQuery = useSalesDocNextNumber(DOC_TYPE);

  const rows = (listQuery.data?.content ?? []) as Array<Record<string, unknown>>;
  const totalElements = listQuery.data?.totalElements ?? 0;
  const totalPages = Math.max(1, listQuery.data?.totalPages ?? 1);

  useEffect(() => {
    if (mode === 'form' && !documentId) {
      setForm({ date: todayISO(), noteType: 'CREDIT', reasonCode: 'PRICE_CORRECTION', taxImpact: true });
    }
  }, [mode, documentId]);

  useEffect(() => {
    if (docQuery.data) setForm(docQuery.data);
  }, [docQuery.data]);

  const status_ = String(form.status ?? 'DRAFT');
  const editable = !documentId || status_ === 'DRAFT' || status_ === 'REJECTED';

  function openForm(id: string | null) {
    setDocumentId(id);
    setMode('form');
  }

  function backToList() {
    setMode('list');
    setDocumentId(null);
  }

  async function handleSave() {
    try {
      const payload = { ...form };
      if (documentId) {
        const updated = await updateMutation.mutateAsync({ id: documentId, payload });
        toast(`${updated.docNo} updated`, 'success');
      } else {
        const created = await createMutation.mutateAsync(payload);
        toast(`${created.docNo} saved`, 'success');
        setDocumentId(String(created.id));
      }
    } catch (err) {
      toast(getApiErrorMessage(err, 'Failed to save note'), 'error');
    }
  }

  async function handleAction(note: string) {
    if (!actionModal || !documentId) return;
    try {
      await actionMutation.mutateAsync({ id: documentId, action: actionModal.action, note });
      toast(`${actionModal.action} successful`, 'success');
      setActionModal(null);
    } catch (err) {
      toast(getApiErrorMessage(err, `${actionModal.action} failed`), 'error');
    }
  }

  async function handlePost() {
    if (!documentId) return;
    try {
      await actionMutation.mutateAsync({ id: documentId, action: 'post' });
      toast('Note posted', 'success');
      setPostConfirm(false);
    } catch (err) {
      toast(getApiErrorMessage(err, 'Post failed'), 'error');
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id as string | number);
      toast('Note deleted', 'success');
      setDeleteTarget(null);
    } catch (err) {
      toast(getApiErrorMessage(err, 'Delete failed'), 'error');
    }
  }

  if (mode === 'list') {
    return (
      <div className="view-container">
        <div className="pg-head pg-head-flex">
          <div className="pg-head-text">
            <h1>Credit / Debit Note</h1>
            <p>Financial adjustments against a posted Sales Invoice, not tied to a physical return</p>
          </div>
          <button className="btn btn-p" onClick={() => openForm(null)}>
            <span className="material-symbols-rounded">add</span>
            New Note
          </button>
        </div>

        <div className="panel">
          <div className="toolbar" style={{ gap: '8px', justifyContent: 'flex-start' }}>
            <div className="searchwrap" style={{ flex: '0 0 auto' }}>
              <span className="material-symbols-rounded">search</span>
              <input
                type="text"
                className="in"
                placeholder="Search Credit/Debit Notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: '250px' }}
              />
            </div>
            <select className="in" value={status} onChange={(e) => setStatus(e.target.value)} style={{ flex: '0 0 auto', width: '180px' }}>
              <option value="">All Statuses</option>
              {['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div className="sp" />
            <span className="count">{totalElements} records</span>
          </div>

          <div className="twrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="num">S.No</th>
                  <th>Note No</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Original Invoice</th>
                  <th>Reason</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading ? (
                  <tr><td colSpan={9} className="empty">Loading notes...</td></tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="empty">
                      <span className="material-symbols-rounded">inventory_2</span>
                      No credit/debit notes found. Click <strong>+ New Note</strong> to create one.
                    </td>
                  </tr>
                ) : (
                  rows.map((row: any, idx: number) => (
                    <tr key={row.id}>
                      <td className="num mut">{page * PAGE_SIZE + idx + 1}</td>
                      <td><a onClick={() => openForm(String(row.id))} className="cell-b">{row.docNo}</a></td>
                      <td>{row.noteType}</td>
                      <td>{row.date || row.docDate}</td>
                      <td>{row.originalInvoiceRef}</td>
                      <td>{row.reasonCode}</td>
                      <td className="num cell-b">{formatNumber(row.amount)}</td>
                      <td><StatusBadge status={String(row.status || 'DRAFT')} /></td>
                      <td style={{ textAlign: 'right' }}>
                        <button onClick={() => openForm(String(row.id))} className="ibtn" title="View">
                          <span className="material-symbols-rounded">visibility</span>
                        </button>
                        {row.status === 'DRAFT' && (
                          <button onClick={() => setDeleteTarget(row)} className="ibtn danger" title="Delete">
                            <span className="material-symbols-rounded">delete</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="pager">
            <span>Showing page {page + 1} of {totalPages} ({totalElements} items)</span>
            <div className="pgs">
              <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹</button>
              <button className="on">{page + 1}</button>
              <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>›</button>
            </div>
          </div>
        </div>

        {deleteTarget && (
          <ConfirmActionModal
            open={Boolean(deleteTarget)}
            title="Delete Credit/Debit Note"
            body={`Are you sure you want to delete ${String(deleteTarget.docNo || deleteTarget.id)}?`}
            okLabel="Delete"
            danger
            onConfirm={() => handleDelete()}
            onClose={() => setDeleteTarget(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="view-container">
      <div className="pg-head pg-head-flex">
        <div className="pg-head-text" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={backToList} className="btn btn-sm" title="Back to list">
            <span className="material-symbols-rounded">arrow_back</span>
            Back
          </button>
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {documentId ? `Edit ${form.docNo ?? ''}` : 'New Credit/Debit Note'}
              {form.status ? <StatusBadge status={String(form.status)} /> : null}
            </h1>
            <p>Financial adjustment against a posted Sales Invoice</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {editable && (
            <button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending} className="btn btn-p">
              <span className="material-symbols-rounded">save</span>
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save Note'}
            </button>
          )}
          {documentId && editable && (
            <button onClick={() => setActionModal({ action: 'submit', danger: false })} className="btn btn-g">
              <span className="material-symbols-rounded">send</span>
              Submit
            </button>
          )}
          {documentId && status_ === 'SUBMITTED' && can('sales', 'Approve') && (
            <button onClick={() => setActionModal({ action: 'approve', danger: false })} className="btn btn-p">
              <span className="material-symbols-rounded">check_circle</span>
              Approve
            </button>
          )}
          {documentId && status_ === 'SUBMITTED' && (
            <button onClick={() => setActionModal({ action: 'reject', danger: true })} className="btn btn-d">
              <span className="material-symbols-rounded">cancel</span>
              Reject
            </button>
          )}
          {documentId && status_ === 'APPROVED' && (
            <button onClick={() => setPostConfirm(true)} className="btn btn-p">
              <span className="material-symbols-rounded">task_alt</span>
              Post
            </button>
          )}
        </div>
      </div>

      <div className="sec-head">
        <div className="sec-title">
          <span className="material-symbols-rounded">edit_note</span>
          1. Header Information
        </div>
      </div>
      <div className="sec-body">
        <div className="fgrid">
          <div className="fld">
            <span>Note Number (Auto)</span>
            <input className="in" disabled value={String(form.docNo ?? nextNumberQuery.data?.nextNumber ?? '')} />
          </div>
          <div className="fld">
            <span>Note Type *</span>
            <select className="in" disabled={!editable} value={String(form.noteType ?? 'CREDIT')} onChange={(e) => setForm((p) => ({ ...p, noteType: e.target.value }))}>
              <option value="CREDIT">CREDIT</option>
              <option value="DEBIT">DEBIT</option>
            </select>
          </div>
          <div className="fld">
            <span>Note Date *</span>
            <input type="date" className="in" disabled={!editable} value={String(form.date ?? form.docDate ?? '')} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
          </div>
          <div className="fld">
            <span>Original Invoice Reference *</span>
            <input className="in" disabled={!editable} value={String(form.originalInvoiceRef ?? '')} onChange={(e) => setForm((p) => ({ ...p, originalInvoiceRef: e.target.value }))} placeholder="e.g. SINV-2026-0001" />
          </div>
          <div className="fld">
            <span>Reason Code *</span>
            <select className="in" disabled={!editable} value={String(form.reasonCode ?? 'PRICE_CORRECTION')} onChange={(e) => setForm((p) => ({ ...p, reasonCode: e.target.value }))}>
              {REASON_CODES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="fld">
            <span>Amount *</span>
            <input type="number" className="in" disabled={!editable} value={String(form.amount ?? '')} onChange={(e) => setForm((p) => ({ ...p, amount: Number(e.target.value) }))} />
          </div>
          <div className="fld">
            <span>Tax Impact</span>
            <select className="in" disabled={!editable} value={String(form.taxImpact ?? true)} onChange={(e) => setForm((p) => ({ ...p, taxImpact: e.target.value === 'true' }))}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div className="fld">
            <span>Original Invoice Period (System)</span>
            <input className="in" disabled value={String(form.originalInvoicePeriod ?? '')} />
          </div>
          <div className="fld span2">
            <span>Remarks</span>
            <textarea className="in" rows={2} disabled={!editable} value={String(form.remarks ?? '')} onChange={(e) => setForm((p) => ({ ...p, remarks: e.target.value }))} />
          </div>
        </div>
      </div>

      <div className="actbar" style={{ marginTop: '24px' }}>
        <div className="lft">
          <span className="material-symbols-rounded">info</span>
          A CREDIT note reduces the invoice's outstanding balance; a DEBIT note increases it. Both take effect on Post.
        </div>
        <button type="button" onClick={backToList} className="btn">Close</button>
      </div>

      {actionModal && (
        <ConfirmActionModal
          open={Boolean(actionModal)}
          title={`Confirm ${actionModal.action.toUpperCase()}`}
          body={`Are you sure you want to ${actionModal.action} this note?`}
          okLabel={actionModal.action.toUpperCase()}
          danger={actionModal.danger}
          busy={actionMutation.isPending}
          onConfirm={(note) => handleAction(note)}
          onClose={() => setActionModal(null)}
        />
      )}
      {postConfirm && (
        <ConfirmActionModal
          open
          title="Confirm POST"
          body="Are you sure you want to post this note? The referenced invoice's outstanding balance will be adjusted immediately."
          okLabel="POST"
          busy={actionMutation.isPending}
          onConfirm={() => handlePost()}
          onClose={() => setPostConfirm(false)}
        />
      )}
    </div>
  );
}
