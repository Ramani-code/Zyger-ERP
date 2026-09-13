import { useEffect, useState } from 'react';
import {
  useSalesDoc,
  useSalesDocAction,
  useSalesDocCreate,
  useSalesDocDelete,
  useSalesDocList,
  useSalesDocNextNumber,
  useSalesDocUpdate,
} from '../../../hooks/useSalesDocs';
import { todayISO } from '../../../utils/format';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useToast } from '../../../contexts/ToastContext';
import StatusBadge from '../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';

const PAGE_SIZE = 10;
const DOC_TYPE = 'enquiry';
const SOURCES = ['EXISTING_CUSTOMER', 'NEW_ENQUIRY', 'REPEAT_ORDER'];

interface EnquiryLine {
  itemCode: string;
  drawingNumber: string;
  drawingRevision: string;
  description: string;
  qty: number;
  targetPrice: number;
  uom: string;
}

const BLANK_LINE: EnquiryLine = { itemCode: '', drawingNumber: '', drawingRevision: '', description: '', qty: 0, targetPrice: 0, uom: 'NOS' };

export default function EnquiryPage() {
  const { toast } = useToast();

  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const [lostConfirm, setLostConfirm] = useState(false);
  const [convertConfirm, setConvertConfirm] = useState(false);

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [lines, setLines] = useState<EnquiryLine[]>([]);

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
      setForm({ date: todayISO(), source: 'EXISTING_CUSTOMER' });
      setLines([{ ...BLANK_LINE }]);
    }
  }, [mode, documentId]);

  useEffect(() => {
    if (docQuery.data) {
      setForm(docQuery.data);
      const l = ((docQuery.data.lines as Array<Record<string, unknown>>) || []).map((x) => ({
        itemCode: String(x.itemCode ?? ''),
        drawingNumber: String(x.drawingNumber ?? ''),
        drawingRevision: String(x.drawingRevision ?? ''),
        description: String(x.description ?? ''),
        qty: Number(x.qty ?? 0),
        targetPrice: Number(x.targetPrice ?? 0),
        uom: String(x.uom ?? 'NOS'),
      }));
      setLines(l.length > 0 ? l : [{ ...BLANK_LINE }]);
    }
  }, [docQuery.data]);

  const status_ = String(form.status ?? 'NEW');
  const editable = !documentId || status_ === 'NEW' || status_ === 'UNDER_REVIEW';

  function openForm(id: string | null) {
    setDocumentId(id);
    setMode('form');
  }

  function backToList() {
    setMode('list');
    setDocumentId(null);
  }

  function addLine() {
    setLines((prev) => [...prev, { ...BLANK_LINE }]);
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateLine(idx: number, field: keyof EnquiryLine, value: string) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: field === 'qty' || field === 'targetPrice' ? Number(value) || 0 : value } : l)));
  }

  async function handleSave() {
    try {
      const payload = { ...form, lines };
      if (documentId) {
        const updated = await updateMutation.mutateAsync({ id: documentId, payload });
        toast(`${updated.docNo} updated`, 'success');
      } else {
        const created = await createMutation.mutateAsync(payload);
        toast(`${created.docNo} saved`, 'success');
        setDocumentId(String(created.id));
      }
    } catch (err) {
      toast(getApiErrorMessage(err, 'Failed to save enquiry'), 'error');
    }
  }

  async function handleConvert() {
    if (!documentId) return;
    try {
      const q = await actionMutation.mutateAsync({ id: documentId, action: 'convert-to-quotation' as any });
      toast(`Converted to Quotation ${q.docNo}`, 'success');
      setConvertConfirm(false);
    } catch (err) {
      toast(getApiErrorMessage(err, 'Convert failed'), 'error');
    }
  }

  async function handleMarkLost(note: string) {
    if (!documentId) return;
    try {
      await actionMutation.mutateAsync({ id: documentId, action: 'mark-lost' as any, note });
      toast('Enquiry marked Lost', 'success');
      setLostConfirm(false);
    } catch (err) {
      toast(getApiErrorMessage(err, 'Mark Lost failed'), 'error');
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id as string | number);
      toast('Enquiry deleted', 'success');
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
            <h1>Enquiry / RFQ</h1>
            <p>Capture a customer's request for quotation before commercial commitment</p>
          </div>
          <button className="btn btn-p" onClick={() => openForm(null)}>
            <span className="material-symbols-rounded">add</span>
            New Enquiry
          </button>
        </div>

        <div className="panel">
          <div className="toolbar" style={{ gap: '8px', justifyContent: 'flex-start' }}>
            <div className="searchwrap" style={{ flex: '0 0 auto' }}>
              <span className="material-symbols-rounded">search</span>
              <input type="text" className="in" placeholder="Search Enquiries..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '250px' }} />
            </div>
            <select className="in" value={status} onChange={(e) => setStatus(e.target.value)} style={{ flex: '0 0 auto', width: '180px' }}>
              <option value="">All Statuses</option>
              {['NEW', 'UNDER_REVIEW', 'QUOTED', 'CONVERTED', 'LOST'].map((s) => (
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
                  <th>Enquiry No</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Required By</th>
                  <th>Sales Owner</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading ? (
                  <tr><td colSpan={8} className="empty">Loading enquiries...</td></tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty">
                      <span className="material-symbols-rounded">inventory_2</span>
                      No enquiries found. Click <strong>+ New Enquiry</strong> to create one.
                    </td>
                  </tr>
                ) : (
                  rows.map((row: any, idx: number) => (
                    <tr key={row.id}>
                      <td className="num mut">{page * PAGE_SIZE + idx + 1}</td>
                      <td><a onClick={() => openForm(String(row.id))} className="cell-b">{row.docNo}</a></td>
                      <td>{row.date || row.docDate}</td>
                      <td>{row.customerName || '-'}</td>
                      <td>{row.requiredByDate || '-'}</td>
                      <td>{row.salesOwner || '-'}</td>
                      <td><StatusBadge status={String(row.status || 'NEW')} /></td>
                      <td style={{ textAlign: 'right' }}>
                        <button onClick={() => openForm(String(row.id))} className="ibtn" title="View">
                          <span className="material-symbols-rounded">visibility</span>
                        </button>
                        {row.status === 'NEW' && (
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
            title="Delete Enquiry"
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
              {documentId ? `Edit ${form.docNo ?? ''}` : 'New Enquiry'}
              {form.status ? <StatusBadge status={String(form.status)} /> : null}
            </h1>
            <p>Capture a customer's request for quotation</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {editable && (
            <button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending} className="btn btn-p">
              <span className="material-symbols-rounded">save</span>
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save Enquiry'}
            </button>
          )}
          {documentId && (status_ === 'NEW' || status_ === 'UNDER_REVIEW') && (
            <button onClick={() => setConvertConfirm(true)} className="btn btn-g">
              <span className="material-symbols-rounded">request_quote</span>
              Convert to Quotation
            </button>
          )}
          {documentId && !['CONVERTED', 'LOST'].includes(status_) && (
            <button onClick={() => setLostConfirm(true)} className="btn btn-d">
              <span className="material-symbols-rounded">cancel</span>
              Mark Lost
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
            <span>Enquiry Number (Auto)</span>
            <input className="in" disabled value={String(form.docNo ?? nextNumberQuery.data?.nextNumber ?? '')} />
          </div>
          <div className="fld">
            <span>Enquiry Date *</span>
            <input type="date" className="in" disabled={!editable} value={String(form.date ?? form.docDate ?? '')} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
          </div>
          <div className="fld">
            <span>Customer Code *</span>
            <input className="in" disabled={!editable} value={String(form.customerCode ?? '')} onChange={(e) => setForm((p) => ({ ...p, customerCode: e.target.value }))} />
          </div>
          <div className="fld">
            <span>Customer Name *</span>
            <input className="in" disabled={!editable} value={String(form.customerName ?? '')} onChange={(e) => setForm((p) => ({ ...p, customerName: e.target.value }))} />
          </div>
          <div className="fld">
            <span>Contact Person</span>
            <input className="in" disabled={!editable} value={String(form.contactPerson ?? '')} onChange={(e) => setForm((p) => ({ ...p, contactPerson: e.target.value }))} />
          </div>
          <div className="fld">
            <span>Required By Date</span>
            <input type="date" className="in" disabled={!editable} value={String(form.requiredByDate ?? '')} onChange={(e) => setForm((p) => ({ ...p, requiredByDate: e.target.value }))} />
          </div>
          <div className="fld">
            <span>Source *</span>
            <select className="in" disabled={!editable} value={String(form.source ?? 'EXISTING_CUSTOMER')} onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))}>
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="fld">
            <span>Sales Owner *</span>
            <input className="in" disabled={!editable} value={String(form.salesOwner ?? '')} onChange={(e) => setForm((p) => ({ ...p, salesOwner: e.target.value }))} placeholder="defaults to creator" />
          </div>
          {form.convertedQuotationNo ? (
            <div className="fld">
              <span>Converted Quotation (System)</span>
              <input className="in" disabled value={String(form.convertedQuotationNo)} />
            </div>
          ) : null}
          <div className="fld span2">
            <span>Remarks</span>
            <textarea className="in" rows={2} disabled={!editable} value={String(form.remarks ?? '')} onChange={(e) => setForm((p) => ({ ...p, remarks: e.target.value }))} />
          </div>
        </div>
      </div>

      <div className="sec-head" style={{ marginTop: '24px' }}>
        <div className="sec-title">
          <span className="material-symbols-rounded">list_alt</span>
          2. Enquiry Line Items Grid
        </div>
        {editable && (
          <button type="button" onClick={addLine} className="btn btn-sm btn-p">
            <span className="material-symbols-rounded">add</span>
            Add Item
          </button>
        )}
      </div>
      <div className="sec-body" style={{ padding: '0' }}>
        <div className="twrap">
          <table className="tbl lines">
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Drawing No</th>
                <th>Rev</th>
                <th>Description</th>
                <th className="num">Qty *</th>
                <th>UOM</th>
                <th className="num">Target Price</th>
                {editable && <th style={{ textAlign: 'right' }}>Remove</th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx}>
                  <td><input className="in" disabled={!editable} value={l.itemCode} onChange={(e) => updateLine(idx, 'itemCode', e.target.value)} /></td>
                  <td><input className="in" disabled={!editable} value={l.drawingNumber} onChange={(e) => updateLine(idx, 'drawingNumber', e.target.value)} /></td>
                  <td><input className="in" disabled={!editable} value={l.drawingRevision} onChange={(e) => updateLine(idx, 'drawingRevision', e.target.value)} /></td>
                  <td><input className="in" disabled={!editable} value={l.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} /></td>
                  <td className="num"><input type="number" className="in" disabled={!editable} value={l.qty} onChange={(e) => updateLine(idx, 'qty', e.target.value)} /></td>
                  <td><input className="in" disabled={!editable} value={l.uom} onChange={(e) => updateLine(idx, 'uom', e.target.value)} /></td>
                  <td className="num"><input type="number" className="in" disabled={!editable} value={l.targetPrice} onChange={(e) => updateLine(idx, 'targetPrice', e.target.value)} /></td>
                  {editable && (
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" onClick={() => removeLine(idx)} className="ibtn danger" title="Remove row">
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

      <div className="actbar" style={{ marginTop: '24px' }}>
        <div className="lft">
          <span className="material-symbols-rounded">info</span>
          At least one line needs both Item Code and Qty before this enquiry can convert to a Quotation.
        </div>
        <button type="button" onClick={backToList} className="btn">Close</button>
      </div>

      {convertConfirm && (
        <ConfirmActionModal
          open
          title="Convert to Quotation"
          body="Create a new Costed Quotation from this enquiry's customer and lines?"
          okLabel="CONVERT"
          busy={actionMutation.isPending}
          onConfirm={() => handleConvert()}
          onClose={() => setConvertConfirm(false)}
        />
      )}
      {lostConfirm && (
        <ConfirmActionModal
          open
          title="Mark Lost"
          body="Are you sure you want to mark this enquiry Lost? A reason is required."
          okLabel="MARK LOST"
          danger
          busy={actionMutation.isPending}
          onConfirm={(note) => handleMarkLost(note)}
          onClose={() => setLostConfirm(false)}
        />
      )}
    </div>
  );
}
