import { useEffect, useMemo, useState } from 'react';
import {
  useSalesDoc,
  useSalesDocAction,
  useSalesDocCreate,
  useSalesDocDelete,
  useSalesDocList,
  useSalesDocNextNumber,
  useSalesDocUpdate,
} from '../../../hooks/useSalesDocs';
import { salesApi } from '../../../services/sales-api';
import { formatNumber, todayISO } from '../../../utils/format';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useToast } from '../../../contexts/ToastContext';
import StatusBadge from '../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';

const PAGE_SIZE = 10;
const DOC_TYPE = 'payment-receipt';
const PAYMENT_MODES = ['BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER'];

interface AllocationRow {
  invoiceNo: string;
  invoiceBalance: number;
  amountAllocated: number;
}

// The generic list/get row transform (DocumentFacade.toRow) recomputes a display
// "totalAmount" as a naive sum(rate*qty) across every doc type — for Sales Invoice
// that's pre-discount, pre-tax, and does not match what the invoice actually bills.
// The true grand total (what SalesService.invoiceBalance uses server-side, and what
// the printed invoice shows) comes through as "netAmount" instead. Balance must be
// computed the same way the backend computes it, or allocations here would be
// validated against a different number than what's shown to the user.
function invoiceGrandTotal(inv: Record<string, any>): number {
  return Number(inv.netAmount ?? inv.totalAmount ?? 0);
}

export default function PaymentReceiptPage() {
  const { toast } = useToast();

  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const [confirmAction, setConfirmAction] = useState<'post' | 'reverse' | null>(null);

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [allocRows, setAllocRows] = useState<AllocationRow[]>([]);
  const [openInvoices, setOpenInvoices] = useState<Array<Record<string, any>>>([]);

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
      setForm({ date: todayISO(), mode: 'BANK_TRANSFER' });
      setAllocRows([]);
    }
  }, [mode, documentId]);

  useEffect(() => {
    if (docQuery.data) {
      setForm(docQuery.data);
      const lines = ((docQuery.data.lines as Array<Record<string, unknown>>) || []).map((l) => ({
        invoiceNo: String(l.invoiceNo ?? ''),
        invoiceBalance: Number(l.invoiceBalance ?? 0),
        amountAllocated: Number(l.amountAllocated ?? 0),
      }));
      setAllocRows(lines);
    }
  }, [docQuery.data]);

  useEffect(() => {
    if (mode !== 'form') return;
    salesApi
      .listDocs('sales-invoice', { size: 200, sort: 'date,desc' })
      .then((res) => {
        const list = (res.content || []) as Array<Record<string, any>>;
        setOpenInvoices(list.filter((i) => i.status === 'POSTED' || i.status === 'PARTIALLY_PAID'));
      })
      .catch(() => setOpenInvoices([]));
  }, [mode]);

  const status_ = String(form.status ?? 'DRAFT');
  const isDraft = !documentId || status_ === 'DRAFT';
  const isAllocated = status_ === 'ALLOCATED';
  const isPosted = status_ === 'POSTED';

  const allocatedTotal = useMemo(
    () => allocRows.reduce((sum, r) => sum + (Number(r.amountAllocated) || 0), 0),
    [allocRows]
  );
  const amountReceived = Number(form.amountReceived ?? 0);

  function openForm(id: string | null) {
    setDocumentId(id);
    setMode('form');
  }

  function backToList() {
    setMode('list');
    setDocumentId(null);
  }

  async function handleSaveHeader() {
    try {
      const payload = { ...form };
      if (documentId) {
        const updated = await updateMutation.mutateAsync({ id: documentId, payload });
        toast(`Receipt ${updated.docNo} updated`, 'success');
      } else {
        const created = await createMutation.mutateAsync(payload);
        toast(`Receipt ${created.docNo} saved`, 'success');
        setDocumentId(String(created.id));
      }
    } catch (err) {
      toast(getApiErrorMessage(err, 'Failed to save receipt'), 'error');
    }
  }

  function addAllocationRow() {
    setAllocRows((prev) => [...prev, { invoiceNo: '', invoiceBalance: 0, amountAllocated: 0 }]);
  }

  function removeAllocationRow(idx: number) {
    setAllocRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateAllocationRow(idx: number, field: keyof AllocationRow, value: string) {
    setAllocRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        if (field === 'invoiceNo') {
          const inv = openInvoices.find((o) => o.docNo === value);
          const balance = inv ? invoiceGrandTotal(inv) - Number(inv.paidAmount ?? 0) : 0;
          return { ...r, invoiceNo: value, invoiceBalance: balance };
        }
        return { ...r, [field]: Number(value) || 0 };
      })
    );
  }

  async function handleAllocate() {
    if (allocRows.length === 0) {
      toast('Add at least one invoice allocation', 'error');
      return;
    }
    if (allocatedTotal > amountReceived) {
      toast(`Total allocated (${allocatedTotal}) exceeds amount received (${amountReceived})`, 'error');
      return;
    }
    try {
      await actionMutation.mutateAsync({
        id: documentId!,
        action: 'allocate',
        options: { allocations: allocRows.map((r) => ({ invoiceNo: r.invoiceNo, amountAllocated: r.amountAllocated })) },
      });
      toast('Allocation saved', 'success');
    } catch (err) {
      toast(getApiErrorMessage(err, 'Allocation failed'), 'error');
    }
  }

  async function handlePost() {
    try {
      await actionMutation.mutateAsync({ id: documentId!, action: 'post' });
      toast('Receipt posted', 'success');
      setConfirmAction(null);
    } catch (err) {
      toast(getApiErrorMessage(err, 'Post failed'), 'error');
    }
  }

  async function handleReverse(note: string) {
    try {
      await actionMutation.mutateAsync({ id: documentId!, action: 'reverse', note });
      toast('Receipt reversed', 'success');
      setConfirmAction(null);
    } catch (err) {
      toast(getApiErrorMessage(err, 'Reversal failed'), 'error');
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id as string | number);
      toast('Receipt deleted', 'success');
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
            <h1>Payment Collection</h1>
            <p>Record customer receipts and allocate against open Sales Invoices</p>
          </div>
          <button className="btn btn-p" onClick={() => openForm(null)}>
            <span className="material-symbols-rounded">add</span>
            New Receipt
          </button>
        </div>

        <div className="panel">
          <div className="toolbar" style={{ gap: '8px', justifyContent: 'flex-start' }}>
            <div className="searchwrap" style={{ flex: '0 0 auto' }}>
              <span className="material-symbols-rounded">search</span>
              <input
                type="text"
                className="in"
                placeholder="Search Payment Receipts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: '250px' }}
              />
            </div>
            <select className="in" value={status} onChange={(e) => setStatus(e.target.value)} style={{ flex: '0 0 auto', width: '180px' }}>
              <option value="">All Statuses</option>
              {['DRAFT', 'ALLOCATED', 'POSTED', 'REVERSED'].map((s) => (
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
                  <th>Receipt No</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Mode</th>
                  <th className="num">Amount Received</th>
                  <th className="num">Unallocated</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading ? (
                  <tr><td colSpan={9} className="empty">Loading receipts...</td></tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="empty">
                      <span className="material-symbols-rounded">inventory_2</span>
                      No payment receipts found. Click <strong>+ New Receipt</strong> to create one.
                    </td>
                  </tr>
                ) : (
                  rows.map((row: any, idx: number) => (
                    <tr key={row.id}>
                      <td className="num mut">{page * PAGE_SIZE + idx + 1}</td>
                      <td>
                        <a onClick={() => openForm(String(row.id))} className="cell-b">{row.docNo}</a>
                      </td>
                      <td>{row.date || row.docDate}</td>
                      <td>{row.customer || '-'}</td>
                      <td>{row.mode || '-'}</td>
                      <td className="num cell-b">{formatNumber(row.amountReceived)}</td>
                      <td className="num">{formatNumber(row.unallocatedBalance)}</td>
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
            title="Delete Payment Receipt"
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

  // Form mode
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
              {documentId ? `Edit Receipt ${form.docNo ?? ''}` : 'New Payment Receipt'}
              {form.status ? <StatusBadge status={String(form.status)} /> : null}
            </h1>
            <p>Record a customer receipt and allocate it against open Sales Invoices</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {isDraft && (
            <button onClick={handleSaveHeader} disabled={createMutation.isPending || updateMutation.isPending} className="btn btn-p">
              <span className="material-symbols-rounded">save</span>
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save Receipt'}
            </button>
          )}
          {documentId && isDraft && (
            <button onClick={handleAllocate} disabled={actionMutation.isPending} className="btn btn-g">
              <span className="material-symbols-rounded">call_split</span>
              Allocate
            </button>
          )}
          {isAllocated && (
            <button onClick={() => setConfirmAction('post')} className="btn btn-p">
              <span className="material-symbols-rounded">task_alt</span>
              Post
            </button>
          )}
          {isPosted && (
            <button onClick={() => setConfirmAction('reverse')} className="btn btn-d">
              <span className="material-symbols-rounded">undo</span>
              Reverse
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
            <span>Receipt Number (Auto)</span>
            <input className="in" disabled value={String(form.docNo ?? nextNumberQuery.data?.nextNumber ?? '')} />
          </div>
          <div className="fld">
            <span>Receipt Date *</span>
            <input type="date" className="in" disabled={!isDraft} value={String(form.date ?? form.docDate ?? '')} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
          </div>
          <div className="fld">
            <span>Customer Code *</span>
            <input className="in" disabled={!isDraft} value={String(form.customerCode ?? '')} onChange={(e) => setForm((p) => ({ ...p, customerCode: e.target.value }))} />
          </div>
          <div className="fld">
            <span>Customer Name *</span>
            <input className="in" disabled={!isDraft} value={String(form.customer ?? '')} onChange={(e) => setForm((p) => ({ ...p, customer: e.target.value }))} />
          </div>
          <div className="fld">
            <span>Payment Mode *</span>
            <select className="in" disabled={!isDraft} value={String(form.mode ?? 'BANK_TRANSFER')} onChange={(e) => setForm((p) => ({ ...p, mode: e.target.value }))}>
              {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="fld">
            <span>Reference No {String(form.mode) !== 'CASH' && <em className="req">*</em>}</span>
            <input className="in" disabled={!isDraft} value={String(form.referenceNo ?? '')} onChange={(e) => setForm((p) => ({ ...p, referenceNo: e.target.value }))} />
          </div>
          <div className="fld">
            <span>Amount Received *</span>
            <input type="number" className="in" disabled={!isDraft} value={String(form.amountReceived ?? '')} onChange={(e) => setForm((p) => ({ ...p, amountReceived: Number(e.target.value) }))} />
          </div>
          <div className="fld">
            <span>Unallocated Balance (System)</span>
            <input className="in" disabled value={formatNumber((form.unallocatedBalance as number) ?? amountReceived - allocatedTotal)} />
          </div>
        </div>
      </div>

      <div className="sec-head" style={{ marginTop: '24px' }}>
        <div className="sec-title">
          <span className="material-symbols-rounded">list_alt</span>
          2. Invoice Allocation Grid
        </div>
        {documentId && isDraft && (
          <button type="button" onClick={addAllocationRow} className="btn btn-sm btn-p">
            <span className="material-symbols-rounded">add</span>
            Add Allocation
          </button>
        )}
      </div>
      <div className="sec-body" style={{ padding: '0' }}>
        <div className="twrap">
          <table className="tbl lines">
            <thead>
              <tr>
                <th>Invoice No</th>
                <th className="num">Invoice Balance</th>
                <th className="num">Amount Allocated</th>
                {documentId && isDraft && <th style={{ textAlign: 'right' }}>Remove</th>}
              </tr>
            </thead>
            <tbody>
              {allocRows.length === 0 ? (
                <tr><td colSpan={4} className="empty">No allocations yet.</td></tr>
              ) : (
                allocRows.map((row, idx) => (
                  <tr key={idx}>
                    <td className="w-i">
                      {isDraft ? (
                        <select className="in" value={row.invoiceNo} onChange={(e) => updateAllocationRow(idx, 'invoiceNo', e.target.value)}>
                          <option value="">-- Select Invoice --</option>
                          {openInvoices.map((inv) => (
                            <option key={inv.docNo} value={inv.docNo}>
                              {inv.docNo} - {inv.customer} (Bal: {formatNumber(invoiceGrandTotal(inv) - Number(inv.paidAmount ?? 0))})
                            </option>
                          ))}
                        </select>
                      ) : row.invoiceNo}
                    </td>
                    <td className="num">{formatNumber(row.invoiceBalance)}</td>
                    <td className="num">
                      {isDraft ? (
                        <input type="number" className="in" value={row.amountAllocated} onChange={(e) => updateAllocationRow(idx, 'amountAllocated', e.target.value)} />
                      ) : formatNumber(row.amountAllocated)}
                    </td>
                    {documentId && isDraft && (
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" onClick={() => removeAllocationRow(idx)} className="ibtn danger" title="Remove row">
                          <span className="material-symbols-rounded">delete</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="actbar" style={{ marginTop: '24px' }}>
        <div className="lft">
          <span className="material-symbols-rounded">info</span>
          {isDraft
            ? 'Save the receipt header first, then add allocations and click Allocate.'
            : 'Allocated total: ' + formatNumber(allocatedTotal)}
        </div>
        <button type="button" onClick={backToList} className="btn">Close</button>
      </div>

      {confirmAction === 'post' && (
        <ConfirmActionModal
          open
          title="Confirm POST"
          body="Are you sure you want to post this receipt? Allocated invoices will be marked PARTIALLY_PAID/PAID."
          okLabel="POST"
          busy={actionMutation.isPending}
          onConfirm={() => handlePost()}
          onClose={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === 'reverse' && (
        <ConfirmActionModal
          open
          title="Confirm REVERSE"
          body="Are you sure you want to reverse this receipt? A reason is required and invoice balances will be restored."
          okLabel="REVERSE"
          danger
          busy={actionMutation.isPending}
          onConfirm={(note) => handleReverse(note)}
          onClose={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
