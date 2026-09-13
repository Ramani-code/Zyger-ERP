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
import { useAuth } from '../../../contexts/AuthContext';
import { formatNumber, todayISO } from '../../../utils/format';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useToast } from '../../../contexts/ToastContext';
import StatusBadge from '../../../components/common/StatusBadge';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';

const PAGE_SIZE = 10;
const DOC_TYPE = 'quotation';
const TAX_CODES = ['GST 18%', 'GST 28%', 'GST 12%', 'GST 5%', 'Exempt'];

interface QLine {
  itemCode: string;
  materialGrade: string;
  toleranceClass: string;
  surfaceFinishRequirement: string;
  processRouteRef: string;
  cycleTimeMinutes: number;
  setupTimeMinutes: number;
  toolingRequired: boolean;
  heatTreatmentRequired: boolean;
  heatTreatmentSpec: string;
  platingCoatingSpec: string;
  inspectionMethod: string;
  faiPpapRequired: boolean;
  machineCode: string;
  materialCostPerUnit: number;
  machiningCostPerUnit: number;
  setupCostPerUnit: number;
  toolingCostPerUnit: number;
  overheadPercent: number | null;
  marginPercent: number | null;
  suggestedSellingPrice: number;
  unitPrice: number;
  qty: number;
  uom: string;
  taxCode: string;
  taxAmount: number;
  netAmount: number;
}

const BLANK_LINE: QLine = {
  itemCode: '', materialGrade: '', toleranceClass: '', surfaceFinishRequirement: '', processRouteRef: '',
  cycleTimeMinutes: 0, setupTimeMinutes: 0, toolingRequired: false, heatTreatmentRequired: false,
  heatTreatmentSpec: '', platingCoatingSpec: '', inspectionMethod: '', faiPpapRequired: false,
  machineCode: '', materialCostPerUnit: 0, machiningCostPerUnit: 0, setupCostPerUnit: 0, toolingCostPerUnit: 0,
  overheadPercent: null, marginPercent: null, suggestedSellingPrice: 0, unitPrice: 0, qty: 0, uom: 'NOS',
  taxCode: 'GST 18%', taxAmount: 0, netAmount: 0,
};

type ActionModal = { action: Extract<SalesDocAction, 'submit' | 'approve' | 'reject' | 'reopen'>; danger: boolean };

export default function QuotationPage() {
  const { toast } = useToast();
  const { can } = useAuth();

  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const [actionModal, setActionModal] = useState<ActionModal | null>(null);
  const [reviseConfirm, setReviseConfirm] = useState(false);
  const [convertConfirm, setConvertConfirm] = useState(false);
  const [sendConfirm, setSendConfirm] = useState(false);
  const [lostConfirm, setLostConfirm] = useState(false);

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [lines, setLines] = useState<QLine[]>([]);

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
      setForm({ date: todayISO(), currency: 'INR', exchangeRate: 1, paymentTerms: '30 Days' });
      setLines([{ ...BLANK_LINE }]);
    }
  }, [mode, documentId]);

  useEffect(() => {
    if (docQuery.data) {
      setForm(docQuery.data);
      const l = ((docQuery.data.lines as Array<Record<string, unknown>>) || []).map((x) => ({
        itemCode: String(x.itemCode ?? ''),
        materialGrade: String(x.materialGrade ?? ''),
        toleranceClass: String(x.toleranceClass ?? ''),
        surfaceFinishRequirement: String(x.surfaceFinishRequirement ?? ''),
        processRouteRef: String(x.processRouteRef ?? ''),
        cycleTimeMinutes: Number(x.cycleTimeMinutes ?? 0),
        setupTimeMinutes: Number(x.setupTimeMinutes ?? 0),
        toolingRequired: Boolean(x.toolingRequired),
        heatTreatmentRequired: Boolean(x.heatTreatmentRequired),
        heatTreatmentSpec: String(x.heatTreatmentSpec ?? ''),
        platingCoatingSpec: String(x.platingCoatingSpec ?? ''),
        inspectionMethod: String(x.inspectionMethod ?? ''),
        faiPpapRequired: Boolean(x.faiPpapRequired),
        machineCode: String(x.machineCode ?? ''),
        materialCostPerUnit: Number(x.materialCostPerUnit ?? 0),
        machiningCostPerUnit: Number(x.machiningCostPerUnit ?? 0),
        setupCostPerUnit: Number(x.setupCostPerUnit ?? 0),
        toolingCostPerUnit: Number(x.toolingCostPerUnit ?? 0),
        overheadPercent: x.overheadPercent == null ? null : Number(x.overheadPercent),
        marginPercent: x.marginPercent == null ? null : Number(x.marginPercent),
        suggestedSellingPrice: Number(x.suggestedSellingPrice ?? 0),
        unitPrice: Number(x.unitPrice ?? 0),
        qty: Number(x.qty ?? 0),
        uom: String(x.uom ?? 'NOS'),
        taxCode: String(x.taxCode ?? 'GST 18%'),
        taxAmount: Number(x.taxAmount ?? 0),
        netAmount: Number(x.netAmount ?? 0),
      }));
      setLines(l.length > 0 ? l : [{ ...BLANK_LINE }]);
    }
  }, [docQuery.data]);

  const status_ = String(form.status ?? 'DRAFT');
  const editable = !documentId || status_ === 'DRAFT';
  const canRevise = documentId && !['DRAFT', 'SUPERSEDED', 'WON', 'LOST'].includes(status_);
  const canConvert = documentId && ['APPROVED', 'SENT_TO_CUSTOMER'].includes(status_);
  const canMarkLost = documentId && !['SUPERSEDED', 'WON', 'LOST'].includes(status_);

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
  function updateLine(idx: number, field: keyof QLine, value: string | boolean) {
    setLines((prev) => prev.map((l, i) => {
      if (i !== idx) return l;
      if (typeof value === 'boolean') return { ...l, [field]: value };
      const numericFields: (keyof QLine)[] = ['cycleTimeMinutes', 'setupTimeMinutes', 'materialCostPerUnit', 'toolingCostPerUnit', 'overheadPercent', 'marginPercent', 'unitPrice', 'qty'];
      return { ...l, [field]: numericFields.includes(field) ? (value === '' ? null : Number(value)) : value };
    }));
  }

  async function handleSave() {
    try {
      const payload = { ...form, lines };
      if (documentId) {
        const updated = await updateMutation.mutateAsync({ id: documentId, payload });
        toast(`${updated.docNo} saved — pricing recomputed`, 'success');
      } else {
        const created = await createMutation.mutateAsync(payload);
        toast(`${created.docNo} saved`, 'success');
        setDocumentId(String(created.id));
      }
    } catch (err) {
      toast(getApiErrorMessage(err, 'Failed to save quotation'), 'error');
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

  async function handleRevise() {
    if (!documentId) return;
    try {
      const rev = await actionMutation.mutateAsync({ id: documentId, action: 'revise' as any });
      toast(`Revision ${rev.docNo}-R${rev.revisionNo} created`, 'success');
      setReviseConfirm(false);
      setDocumentId(String(rev.id));
    } catch (err) {
      toast(getApiErrorMessage(err, 'Revise failed'), 'error');
    }
  }

  async function handleConvert() {
    if (!documentId) return;
    try {
      const so = await actionMutation.mutateAsync({ id: documentId, action: 'convert-to-so' as any });
      toast(`Converted to Sales Order ${so.docNo}`, 'success');
      setConvertConfirm(false);
    } catch (err) {
      toast(getApiErrorMessage(err, 'Convert failed'), 'error');
    }
  }

  async function handleSendToCustomer() {
    if (!documentId) return;
    try {
      await actionMutation.mutateAsync({ id: documentId, action: 'send-to-customer' as any });
      toast('Marked Sent to Customer', 'success');
      setSendConfirm(false);
    } catch (err) {
      toast(getApiErrorMessage(err, 'Send failed'), 'error');
    }
  }

  async function handleMarkLost(note: string) {
    if (!documentId) return;
    try {
      await actionMutation.mutateAsync({ id: documentId, action: 'mark-lost' as any, note });
      toast('Quotation marked Lost', 'success');
      setLostConfirm(false);
    } catch (err) {
      toast(getApiErrorMessage(err, 'Mark Lost failed'), 'error');
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id as string | number);
      toast('Quotation deleted', 'success');
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
            <h1>Quotation (Costed)</h1>
            <p>Engineering-costed, revisable, tiered-approval quotation</p>
          </div>
          <button className="btn btn-p" onClick={() => openForm(null)}>
            <span className="material-symbols-rounded">add</span>
            New Quotation
          </button>
        </div>

        <div className="panel">
          <div className="toolbar" style={{ gap: '8px', justifyContent: 'flex-start' }}>
            <div className="searchwrap" style={{ flex: '0 0 auto' }}>
              <span className="material-symbols-rounded">search</span>
              <input type="text" className="in" placeholder="Search Quotations..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '250px' }} />
            </div>
            <select className="in" value={status} onChange={(e) => setStatus(e.target.value)} style={{ flex: '0 0 auto', width: '200px' }}>
              <option value="">All Statuses</option>
              {['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SENT_TO_CUSTOMER', 'WON', 'LOST', 'SUPERSEDED'].map((s) => (
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
                  <th>Quotation No</th>
                  <th className="num">Rev</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Validity</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading ? (
                  <tr><td colSpan={8} className="empty">Loading quotations...</td></tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty">
                      <span className="material-symbols-rounded">inventory_2</span>
                      No quotations found. Click <strong>+ New Quotation</strong> to create one.
                    </td>
                  </tr>
                ) : (
                  rows.map((row: any, idx: number) => (
                    <tr key={row.id}>
                      <td className="num mut">{page * PAGE_SIZE + idx + 1}</td>
                      <td><a onClick={() => openForm(String(row.id))} className="cell-b">{row.docNo}</a></td>
                      <td className="num">{row.revisionNo ?? 0}</td>
                      <td>{row.date || row.docDate}</td>
                      <td>{row.customerName || '-'}</td>
                      <td>{row.validityDate || '-'}</td>
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
            title="Delete Quotation"
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
              {documentId ? `${form.docNo ?? ''}${form.revisionNo ? '-R' + form.revisionNo : ''}` : 'New Quotation'}
              {form.status ? <StatusBadge status={String(form.status)} /> : null}
            </h1>
            <p>Engineering-costed quotation — pricing is computed server-side on every save</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {editable && (
            <button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending} className="btn btn-p">
              <span className="material-symbols-rounded">save</span>
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save Quotation'}
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
          {documentId && status_ === 'REJECTED' && (
            <button onClick={() => setActionModal({ action: 'reopen', danger: false })} className="btn btn-g">
              <span className="material-symbols-rounded">restart_alt</span>
              Reopen
            </button>
          )}
          {documentId && status_ === 'APPROVED' && (
            <button onClick={() => setSendConfirm(true)} className="btn btn-p">
              <span className="material-symbols-rounded">forward_to_inbox</span>
              Send to Customer
            </button>
          )}
          {canRevise && (
            <button onClick={() => setReviseConfirm(true)} className="btn btn-sm">
              <span className="material-symbols-rounded">history_edu</span>
              Revise
            </button>
          )}
          {canConvert && (
            <button onClick={() => setConvertConfirm(true)} className="btn btn-p">
              <span className="material-symbols-rounded">shopping_cart_checkout</span>
              Convert to SO
            </button>
          )}
          {canMarkLost && (
            <button onClick={() => setLostConfirm(true)} className="btn btn-d">
              <span className="material-symbols-rounded">block</span>
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
            <span>Quotation Number (Auto)</span>
            <input className="in" disabled value={String(form.docNo ?? nextNumberQuery.data?.nextNumber ?? '')} />
          </div>
          <div className="fld">
            <span>Revision No (System)</span>
            <input className="in" disabled value={String(form.revisionNo ?? 0)} />
          </div>
          <div className="fld">
            <span>Quotation Date *</span>
            <input type="date" className="in" disabled={!editable} value={String(form.date ?? form.docDate ?? '')} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
          </div>
          <div className="fld">
            <span>Enquiry Reference</span>
            <input className="in" disabled value={String(form.enquiryRef ?? '')} />
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
            <span>Validity Date *</span>
            <input type="date" className="in" disabled={!editable} value={String(form.validityDate ?? '')} onChange={(e) => setForm((p) => ({ ...p, validityDate: e.target.value }))} />
          </div>
          <div className="fld">
            <span>Currency *</span>
            <select className="in" disabled={!editable} value={String(form.currency ?? 'INR')} onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}>
              <option value="INR">INR - Indian Rupee</option>
              <option value="USD">USD - US Dollar</option>
              <option value="EUR">EUR - Euro</option>
            </select>
          </div>
          <div className="fld">
            <span>Exchange Rate</span>
            <input type="number" className="in" disabled={!editable} value={String(form.exchangeRate ?? 1)} onChange={(e) => setForm((p) => ({ ...p, exchangeRate: Number(e.target.value) }))} />
          </div>
          <div className="fld">
            <span>Payment Terms *</span>
            <input className="in" disabled={!editable} value={String(form.paymentTerms ?? '')} onChange={(e) => setForm((p) => ({ ...p, paymentTerms: e.target.value }))} />
          </div>
          <div className="fld">
            <span>Delivery Terms</span>
            <input className="in" disabled={!editable} value={String(form.deliveryTerms ?? '')} onChange={(e) => setForm((p) => ({ ...p, deliveryTerms: e.target.value }))} />
          </div>
          {form.convertedSoNo ? (
            <div className="fld">
              <span>Converted Sales Order (System)</span>
              <input className="in" disabled value={String(form.convertedSoNo)} />
            </div>
          ) : null}
          <div className="fld span2">
            <span>Price Override Reason {'—'} required if any line's Unit Price deviates from Suggested Price beyond tolerance</span>
            <textarea className="in" rows={2} disabled={!editable} value={String(form.priceOverrideReason ?? '')} onChange={(e) => setForm((p) => ({ ...p, priceOverrideReason: e.target.value }))} />
          </div>
        </div>
      </div>

      <div className="sec-head" style={{ marginTop: '24px' }}>
        <div className="sec-title">
          <span className="material-symbols-rounded">precision_manufacturing</span>
          2. Costed Line Items Grid
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
                <th>Material Grade</th>
                <th>Tolerance</th>
                <th>Machine Code</th>
                <th className="num">Cycle Time (min)</th>
                <th className="num">Setup Time (min)</th>
                <th>Tooling Req.</th>
                <th className="num">Material Cost/Unit</th>
                <th className="num">Machining Cost/Unit</th>
                <th className="num">Setup Cost/Unit</th>
                <th className="num">Tooling Cost/Unit</th>
                <th className="num">Overhead %</th>
                <th className="num">Margin %</th>
                <th className="num">Suggested Price</th>
                <th className="num">Unit Price</th>
                <th className="num">Qty *</th>
                <th>UOM</th>
                <th>Tax Code</th>
                <th className="num">Tax Amount</th>
                <th className="num">Net Amount</th>
                {editable && <th style={{ textAlign: 'right' }}>Remove</th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const deviates = l.suggestedSellingPrice > 0 && Math.abs(l.unitPrice - l.suggestedSellingPrice) / l.suggestedSellingPrice > 0.10;
                return (
                  <tr key={idx}>
                    <td className="w-i"><input className="in" disabled={!editable} value={l.itemCode} onChange={(e) => updateLine(idx, 'itemCode', e.target.value)} /></td>
                    <td><input className="in" disabled={!editable} value={l.materialGrade} onChange={(e) => updateLine(idx, 'materialGrade', e.target.value)} /></td>
                    <td><input className="in" disabled={!editable} value={l.toleranceClass} onChange={(e) => updateLine(idx, 'toleranceClass', e.target.value)} /></td>
                    <td><input className="in" disabled={!editable} value={l.machineCode} onChange={(e) => updateLine(idx, 'machineCode', e.target.value)} placeholder="e.g. CNC-01" /></td>
                    <td className="num"><input type="number" className="in" disabled={!editable} value={l.cycleTimeMinutes} onChange={(e) => updateLine(idx, 'cycleTimeMinutes', e.target.value)} /></td>
                    <td className="num"><input type="number" className="in" disabled={!editable} value={l.setupTimeMinutes} onChange={(e) => updateLine(idx, 'setupTimeMinutes', e.target.value)} /></td>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" disabled={!editable} checked={l.toolingRequired} onChange={(e) => updateLine(idx, 'toolingRequired', e.target.checked)} /></td>
                    <td className="num"><input type="number" className="in" disabled={!editable} value={l.materialCostPerUnit} onChange={(e) => updateLine(idx, 'materialCostPerUnit', e.target.value)} /></td>
                    <td className="num">{formatNumber(l.machiningCostPerUnit)}</td>
                    <td className="num">{formatNumber(l.setupCostPerUnit)}</td>
                    <td className="num"><input type="number" className="in" disabled={!editable || !l.toolingRequired} value={l.toolingCostPerUnit} onChange={(e) => updateLine(idx, 'toolingCostPerUnit', e.target.value)} /></td>
                    <td className="num"><input type="number" className="in" disabled={!editable} value={l.overheadPercent ?? ''} placeholder="policy default" onChange={(e) => updateLine(idx, 'overheadPercent', e.target.value)} /></td>
                    <td className="num"><input type="number" className="in" disabled={!editable} value={l.marginPercent ?? ''} placeholder="policy default" onChange={(e) => updateLine(idx, 'marginPercent', e.target.value)} /></td>
                    <td className="num cell-b">{formatNumber(l.suggestedSellingPrice)}</td>
                    <td className="num">
                      <input type="number" className="in" disabled={!editable} value={l.unitPrice} onChange={(e) => updateLine(idx, 'unitPrice', e.target.value)}
                        style={deviates ? { borderColor: '#dc2626', color: '#dc2626', fontWeight: 700 } : undefined} />
                    </td>
                    <td className="num"><input type="number" className="in" disabled={!editable} value={l.qty} onChange={(e) => updateLine(idx, 'qty', e.target.value)} /></td>
                    <td><input className="in" disabled={!editable} value={l.uom} onChange={(e) => updateLine(idx, 'uom', e.target.value)} /></td>
                    <td>
                      <select className="in" disabled={!editable} value={l.taxCode} onChange={(e) => updateLine(idx, 'taxCode', e.target.value)}>
                        {TAX_CODES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="num">{formatNumber(l.taxAmount)}</td>
                    <td className="num cell-b">{formatNumber(l.netAmount)}</td>
                    {editable && (
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" onClick={() => removeLine(idx)} className="ibtn danger" title="Remove row">
                          <span className="material-symbols-rounded">delete</span>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="actbar" style={{ marginTop: '24px' }}>
        <div className="lft">
          <span className="material-symbols-rounded">info</span>
          Unit Price shown in red deviates from the Suggested Price by more than the configured tolerance — a Price Override Reason is required to save.
        </div>
        <button type="button" onClick={backToList} className="btn">Close</button>
      </div>

      {actionModal && (
        <ConfirmActionModal
          open={Boolean(actionModal)}
          title={`Confirm ${actionModal.action.toUpperCase()}`}
          body={`Are you sure you want to ${actionModal.action} this quotation?`}
          okLabel={actionModal.action.toUpperCase()}
          danger={actionModal.danger}
          busy={actionMutation.isPending}
          onConfirm={(note) => handleAction(note)}
          onClose={() => setActionModal(null)}
        />
      )}
      {reviseConfirm && (
        <ConfirmActionModal
          open
          title="Revise Quotation"
          body="This creates a new revision (same quotation number, +1 revision) carrying today's lines forward as an editable DRAFT. This quotation becomes read-only (SUPERSEDED)."
          okLabel="REVISE"
          busy={actionMutation.isPending}
          onConfirm={() => handleRevise()}
          onClose={() => setReviseConfirm(false)}
        />
      )}
      {convertConfirm && (
        <ConfirmActionModal
          open
          title="Convert to Sales Order"
          body="Create a new Sales Order carrying this quotation's approved pricing and lines forward?"
          okLabel="CONVERT"
          busy={actionMutation.isPending}
          onConfirm={() => handleConvert()}
          onClose={() => setConvertConfirm(false)}
        />
      )}
      {sendConfirm && (
        <ConfirmActionModal
          open
          title="Send to Customer"
          body="Mark this quotation as sent to the customer?"
          okLabel="SEND"
          busy={actionMutation.isPending}
          onConfirm={() => handleSendToCustomer()}
          onClose={() => setSendConfirm(false)}
        />
      )}
      {lostConfirm && (
        <ConfirmActionModal
          open
          title="Mark Lost"
          body="Are you sure you want to mark this quotation Lost? A reason is required."
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
