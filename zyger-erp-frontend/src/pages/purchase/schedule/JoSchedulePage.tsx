import { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import axiosClient from '../../../api/axiosClient';
import StatusBadge from '../../../components/common/StatusBadge';
import { useTabs } from '../../../contexts/TabsContext';
import { useToast } from '../../../contexts/ToastContext';
import JobOrderPage from '../job-order/JobOrderPage';
import { logSystemActivity } from '../../../utils/activityLog';
import { exportToCsv } from '../../../utils/csvExport';
import { filterPurchaseRelevantItems } from '../../../utils/itemClassification';
import SearchableItemLookup from '../../../components/common/SearchableItemLookup';

interface JoScheduleRow {
  id?: number;
  joNo: string;
  refDocNo?: string;
  subcontractor: string;
  subcontractorCode?: string;
  process: string;
  itemCode: string;
  itemDescription?: string;
  uom?: string;
  unitPrice?: number;
  totalAmount?: number;
  scheduledQty: number;
  issueDate: string;
  expectedReturnDate: string;
  receivedQty: number;
  pendingQty: number;
  location?: string;
  priority?: 'NORMAL' | 'HIGH' | 'URGENT';
  status: string;
  remarks?: string;
}

export default function JoSchedulePage() {
  const { openTab } = useTabs();
  const { toast } = useToast();
  const { user } = useAuth();

  const [schedules, setSchedules] = useState<JoScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  // Lookups for Auto-Fill Dropdowns
  const [subcontractors, setSubcontractors] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [referenceDocs, setReferenceDocs] = useState<any[]>([]);

  const [activeNotification, setActiveNotification] = useState<{
    joNo: string;
    subcontractor: string;
    process: string;
    itemCode: string;
    itemDescription?: string;
    scheduledQty: number;
    expectedReturnDate: string;
  } | null>(null);

  // Detailed Form State for New JO Schedule
  const [newSchedule, setNewSchedule] = useState(() => ({
    refDocNo: '',
    joId: undefined as number | undefined,
    joNo: '',
    subcontractor: '',
    subcontractorCode: '',
    process: '',
    itemCode: '',
    itemDescription: '',
    uom: '',
    unitPrice: 0,
    scheduledQty: 0,
    totalAmount: 0,
    issueDate: new Date().toISOString().split('T')[0],
    expectedReturnDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    location: '',
    priority: 'NORMAL',
    remarks: '',
    contactPerson: '',
  }));

  useEffect(() => {
    // Fetch JO Schedules from API
    axiosClient
      .get('/v1/purchase/job-order?size=100')
      .then((res) => {
        const docs = res.data?.content || res.data || [];
        const list: JoScheduleRow[] = [];
        if (Array.isArray(docs)) {
          docs.forEach((jo: any) => {
            if (Array.isArray(jo.schedules) && jo.schedules.length > 0) {
              jo.schedules.forEach((s: any) => {
                const qty = Number(s.scheduledQty || 100);
                const price = Number(s.unitPrice || s.rate || 120);
                list.push({
                  id: s.id,
                  joNo: jo.docNo || '',
                  refDocNo: s.refDocNo || jo.docNo || '',
                  subcontractor: jo.supplierJobWorker || jo.supplier || '',
                  subcontractorCode: jo.supplierCode || '',
                  process: s.process || jo.process || '',
                  itemCode: s.itemCode || '',
                  itemDescription: s.itemDescription || '',
                  uom: s.uom || '',
                  unitPrice: price,
                  totalAmount: qty * price,
                  scheduledQty: qty,
                  issueDate: s.issueDate || jo.date || '',
                  expectedReturnDate: s.expectedReturnDate || jo.expectedReturnDate || '',
                  receivedQty: Number(s.receivedQty || 0),
                  pendingQty: Number(s.pendingQty || qty),
                  location: s.location || '',
                  priority: s.priority || 'NORMAL',
                  status: s.status || jo.status || 'PLANNED',
                  remarks: s.remarks,
                });
              });
            } else {
              const lines = Array.isArray(jo.lines) ? jo.lines : [];
              lines.forEach((l: any, i: number) => {
                const qty = Number(l.orderQty || l.qty || 100);
                const price = Number(l.unitPrice || l.rate || 120);
                list.push({
                  id: i + 1,
                  joNo: jo.docNo || '',
                  refDocNo: jo.docNo || '',
                  subcontractor: jo.supplierJobWorker || jo.supplier || '',
                  subcontractorCode: jo.supplierCode || '',
                  process: jo.process || '',
                  itemCode: l.itemCode || '',
                  itemDescription: l.description || l.itemName || l.itemDesc || '',
                  uom: l.uom || '',
                  unitPrice: price,
                  totalAmount: qty * price,
                  scheduledQty: qty,
                  issueDate: jo.date || '',
                  expectedReturnDate: jo.expectedReturnDate || '',
                  receivedQty: 0,
                  pendingQty: qty,
                  location: '',
                  priority: 'NORMAL',
                  status: jo.status || 'PLANNED',
                });
              });
            }
          });
        }
        setSchedules(list);
        setLoading(false);
      })
      .catch(() => {
        setSchedules([]);
        setLoading(false);
      });

    // Fetch Master Lookups & Reference JO Options for Auto-Fill Dropdowns
    Promise.allSettled([
      axiosClient.get('/master/suppliers'),
      axiosClient.get('/master/items'),
      axiosClient.get('/v1/purchase/job-order?size=20'),
    ]).then(([suppRes, itemRes, joRes]) => {
      if (suppRes.status === 'fulfilled' && Array.isArray(suppRes.value.data)) {
        setSubcontractors(suppRes.value.data);
      } else {
        setSubcontractors([]);
      }

      if (itemRes.status === 'fulfilled' && Array.isArray(itemRes.value.data)) {
        setItems(filterPurchaseRelevantItems(itemRes.value.data));
      } else {
        setItems([]);
      }

      const refs: any[] = [];
      if (joRes.status === 'fulfilled' && Array.isArray(joRes.value.data?.content)) {
        joRes.value.data.content.forEach((j: any) => {
          const l0 = Array.isArray(j.lines) && j.lines[0] ? j.lines[0] : {};
          refs.push({
            id: `JO-${j.docNo}`,
            joId: j.id,
            docNo: j.docNo,
            type: 'Job Order',
            subcontractor: j.supplierJobWorker || j.supplier || '',
            subcontractorCode: j.supplierCode || '',
            process: j.process || '',
            itemCode: l0.itemCode || '',
            itemDescription: l0.description || l0.itemName || l0.itemDesc || '',
            qty: Number(l0.orderQty || l0.qty || 0),
            uom: l0.uom || '',
            unitPrice: Number(l0.unitPrice || l0.rate || 0),
          });
        });
      }
      setReferenceDocs(refs);
    }).catch(() => {});
  }, []);

  // AUTO-FILL HANDLERS
  const handleReferenceSelect = (refDocNo: string) => {
    const selected = referenceDocs.find((r) => r.docNo === refDocNo);
    if (selected) {
      const qty = Number(selected.qty || 100);
      const price = Number(selected.unitPrice || 120);
      setNewSchedule((prev) => ({
        ...prev,
        refDocNo: selected.docNo,
        joId: selected.joId,
        joNo: selected.docNo,
        subcontractor: selected.subcontractor,
        subcontractorCode: selected.subcontractorCode || 'SUB-001',
        process: selected.process || 'Heat Treatment',
        itemCode: selected.itemCode,
        itemDescription: selected.itemDescription,
        uom: selected.uom || 'PCS',
        unitPrice: price,
        scheduledQty: qty,
        totalAmount: qty * price,
      }));
      toast(`✨ Auto-filled JO schedule details from ${selected.type} ${selected.docNo}`, 'success');
    }
  };

  const handleSubcontractorSelect = (subName: string) => {
    const foundSub = subcontractors.find((s) => s.name === subName || s.code === subName);
    setNewSchedule((prev) => ({
      ...prev,
      subcontractor: subName,
      subcontractorCode: foundSub?.code || prev.subcontractorCode,
    }));
  };

  const handleItemSelect = (itemCode: string) => {
    const foundItem = items.find((i) => i.code === itemCode);
    setNewSchedule((prev) => {
      const price = foundItem?.price || prev.unitPrice || 120;
      const desc = foundItem ? `${foundItem.name}${foundItem.description ? ` (${foundItem.description})` : ''}` : prev.itemDescription;
      const qty = prev.scheduledQty || 100;
      return {
        ...prev,
        itemCode: itemCode,
        itemDescription: desc,
        uom: foundItem?.uom || prev.uom || 'PCS',
        unitPrice: price,
        totalAmount: qty * price,
      };
    });
  };

  const handleGoToJobOrder = (s: JoScheduleRow) => {
    openTab({
      id: 'job-order',
      label: 'Job Order',
      icon: 'precision_manufacturing',
      component: JobOrderPage,
      props: {
        prefill: {
          supplier: s.subcontractor,
          poNumber: s.joNo,
          itemCode: s.itemCode,
          orderQty: s.scheduledQty,
          scheduledDate: s.expectedReturnDate,
        },
      },
    });
  };

  const [saving, setSaving] = useState(false);

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    // A schedule row only means something tied to a real Job Order — this used to create
    // a local-only row that vanished on refresh even when a JO was selected, since nothing
    // was ever persisted. Now it requires a real JO reference and actually saves.
    if (!newSchedule.joId) {
      toast('Select a Job Order from "Reference Document" first — a schedule must be tied to a real JO to be saved.', 'error');
      return;
    }
    setSaving(true);
    try {
      const { data: savedRow } = await axiosClient.post(
        `/v1/purchase/job-order/${newSchedule.joId}/schedules`,
        {
          itemCode: newSchedule.itemCode.trim(),
          process: newSchedule.process,
          scheduledQty: Number(newSchedule.scheduledQty) || 0,
          issueDate: newSchedule.issueDate,
          expectedReturnDate: newSchedule.expectedReturnDate,
          status: 'PLANNED',
        }
      );

      const created: JoScheduleRow = {
        id: savedRow.id,
        joNo: newSchedule.joNo,
        refDocNo: newSchedule.refDocNo || newSchedule.joNo,
        subcontractor: newSchedule.subcontractor.trim(),
        subcontractorCode: newSchedule.subcontractorCode,
        process: newSchedule.process,
        itemCode: newSchedule.itemCode.trim(),
        itemDescription: newSchedule.itemDescription,
        uom: newSchedule.uom,
        unitPrice: newSchedule.unitPrice,
        totalAmount: newSchedule.scheduledQty * newSchedule.unitPrice,
        scheduledQty: Number(newSchedule.scheduledQty) || 0,
        issueDate: newSchedule.issueDate,
        expectedReturnDate: newSchedule.expectedReturnDate,
        receivedQty: 0,
        pendingQty: Number(newSchedule.scheduledQty) || 0,
        location: newSchedule.location,
        priority: newSchedule.priority as any,
        status: 'PLANNED',
        remarks: newSchedule.remarks,
      };

      setSchedules((prev) => [created, ...prev]);
      setShowModal(false);

      setActiveNotification({
        joNo: created.joNo,
        subcontractor: created.subcontractor,
        process: created.process,
        itemCode: created.itemCode,
        itemDescription: created.itemDescription,
        scheduledQty: created.scheduledQty,
        expectedReturnDate: created.expectedReturnDate,
      });

      toast(`🔔 Scheduled JO ${created.joNo} for ${created.process}! Go to Job Order to issue job.`, 'success');

      logSystemActivity({
        module: 'Purchase',
        activity: `Scheduled JO Subcontract (${created.joNo})`,
        refNo: created.joNo,
        party: created.subcontractor,
        user: user?.username || 'Unknown',
        status: 'PLANNED',
      });

      setNewSchedule({
        refDocNo: '',
        joId: undefined,
        joNo: '',
        subcontractor: '',
        subcontractorCode: '',
        process: '',
        itemCode: '',
        itemDescription: '',
        uom: '',
        unitPrice: 0,
        scheduledQty: 0,
        totalAmount: 0,
        contactPerson: '',
        issueDate: new Date().toISOString().split('T')[0],
        expectedReturnDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        location: '',
        priority: 'NORMAL',
        remarks: '',
      });
    } catch (err) {
      toast('Failed to save the schedule row — see console for details.', 'error');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const filtered = schedules.filter(
    (s) =>
      s.joNo.toLowerCase().includes(search.toLowerCase()) ||
      s.subcontractor.toLowerCase().includes(search.toLowerCase()) ||
      s.process.toLowerCase().includes(search.toLowerCase()) ||
      s.itemCode.toLowerCase().includes(search.toLowerCase()) ||
      (s.itemDescription && s.itemDescription.toLowerCase().includes(search.toLowerCase())) ||
      (s.refDocNo && s.refDocNo.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="view-container">
      <div className="pg-head pg-head-flex">
        <div className="pg-head-text">
          <h1>Job Order Subcontract Delivery Schedules</h1>
          <p>Monitor external subcontract processing schedules, material issues, and return fulfillment status</p>
        </div>
        <button className="btn btn-p" onClick={() => setShowModal(true)}>
          <span className="material-symbols-rounded">event_available</span>
          Schedule JO Subcontract
        </button>
      </div>

      {/* Notification Banner Alert */}
      {activeNotification && (
        <div
          style={{
            marginBottom: '20px',
            padding: '16px 20px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, rgba(115, 103, 240, 0.12) 0%, rgba(0, 123, 214, 0.12) 100%)',
            border: '1px solid #7367f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '50%',
                background: '#7367f0',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <span className="material-symbols-rounded">notifications_active</span>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>
                JO Scheduled: {activeNotification.joNo} ({activeNotification.process})
              </div>
              <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '2px' }}>
                You scheduled <strong>{activeNotification.process}</strong> for <strong>{activeNotification.itemCode}</strong> (Qty: {activeNotification.scheduledQty}) with <strong>{activeNotification.subcontractor}</strong> due on {activeNotification.expectedReturnDate}. Go to Job Order to issue job!
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <button
              className="btn btn-p"
              onClick={() =>
                handleGoToJobOrder({
                  joNo: activeNotification.joNo,
                  subcontractor: activeNotification.subcontractor,
                  process: activeNotification.process,
                  itemCode: activeNotification.itemCode,
                  scheduledQty: activeNotification.scheduledQty,
                  issueDate: new Date().toISOString().split('T')[0],
                  expectedReturnDate: activeNotification.expectedReturnDate,
                  receivedQty: 0,
                  pendingQty: activeNotification.scheduledQty,
                  status: 'PLANNED',
                })
              }
              style={{ fontWeight: 700 }}
            >
              <span className="material-symbols-rounded">precision_manufacturing</span>
              Go to Job Order
            </button>
            <button
              className="btn btn-s"
              onClick={() => setActiveNotification(null)}
              style={{ padding: '6px' }}
            >
              <span className="material-symbols-rounded">close</span>
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="toolbar" style={{ gap: '10px', alignItems: 'center' }}>
          <div className="searchwrap" style={{ flex: '0 0 auto' }}>
            <span className="material-symbols-rounded">search</span>
            <input
              type="text"
              className="in"
              placeholder="Search JO schedule, subcontractor, process..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '280px' }}
            />
          </div>
          <button
            className="ibtn"
            title="Export CSV"
            onClick={() =>
              exportToCsv(
                filtered as unknown as Record<string, unknown>[],
                [
                  { key: 'joNo', label: 'JO No' },
                  { key: 'refDocNo', label: 'Ref Doc No' },
                  { key: 'subcontractor', label: 'Subcontractor' },
                  { key: 'subcontractorCode', label: 'Subcontractor Code' },
                  { key: 'process', label: 'Process' },
                  { key: 'itemCode', label: 'Item Code' },
                  { key: 'itemDescription', label: 'Item Description' },
                  { key: 'uom', label: 'UOM' },
                  { key: 'unitPrice', label: 'Unit Price' },
                  { key: 'scheduledQty', label: 'Scheduled Qty' },
                  { key: 'totalAmount', label: 'Est Amount' },
                  { key: 'issueDate', label: 'Issue Date' },
                  { key: 'expectedReturnDate', label: 'Expected Return Date' },
                  { key: 'receivedQty', label: 'Received Qty' },
                  { key: 'pendingQty', label: 'Pending Qty' },
                  { key: 'location', label: 'Location' },
                  { key: 'priority', label: 'Priority' },
                  { key: 'status', label: 'Status' },
                ],
                'jo-subcontract-schedules'
              )
            }
          >
            <span className="material-symbols-rounded">download</span>
          </button>
          <span className="count">{filtered.length} schedules</span>
        </div>

        <div className="twrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>JO / Ref No</th>
                <th>Subcontractor</th>
                <th>Process</th>
                <th>Item Details</th>
                <th className="num">Rate (₹)</th>
                <th className="num">Scheduled Qty</th>
                <th className="num">Est Amount (₹)</th>
                <th>Issue Date</th>
                <th>Expected Return</th>
                <th>Priority</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="empty">Loading JO subcontract schedules...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="empty">No JO schedules found matching your search.</td>
                </tr>
              ) : (
                filtered.map((s, idx) => (
                  <tr key={idx}>
                    <td className="cell-b">
                      <div>{s.joNo}</div>
                      {s.refDocNo && s.refDocNo !== s.joNo && (
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Ref: {s.refDocNo}</div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.subcontractor}</div>
                      {s.subcontractorCode && (
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{s.subcontractorCode}</div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-info" style={{ fontWeight: 700 }}>{s.process}</span>
                    </td>
                    <td>
                      <span className="badge badge-neutral" style={{ fontWeight: 700 }}>{s.itemCode}</span>
                      {s.itemDescription && (
                        <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>{s.itemDescription}</div>
                      )}
                    </td>
                    <td className="num">₹{s.unitPrice ?? 120}</td>
                    <td className="num cell-b">
                      {s.scheduledQty} <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{s.uom || 'PCS'}</span>
                    </td>
                    <td className="num cell-b" style={{ color: '#7367f0' }}>
                      ₹{(s.totalAmount ?? (s.scheduledQty * (s.unitPrice ?? 120))).toLocaleString()}
                    </td>
                    <td>{s.issueDate}</td>
                    <td>{s.expectedReturnDate}</td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                          background: s.priority === 'URGENT' ? 'rgba(234,84,85,0.15)' : s.priority === 'HIGH' ? 'rgba(255,159,67,0.15)' : 'rgba(100,116,139,0.12)',
                          color: s.priority === 'URGENT' ? '#ea5455' : s.priority === 'HIGH' ? '#ff9f43' : '#64748b',
                        }}
                      >
                        {s.priority || 'NORMAL'}
                      </span>
                    </td>
                    <td><StatusBadge status={s.status} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-s btn-p"
                        onClick={() => handleGoToJobOrder(s)}
                        style={{ padding: '4px 10px', fontSize: '12px', whiteSpace: 'nowrap' }}
                      >
                        <span className="material-symbols-rounded" style={{ fontSize: '15px' }}>precision_manufacturing</span>
                        Go to Job Order
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Schedule JO Modal with Auto-Fill Dropdowns */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div className="panel" style={{ width: '640px', maxWidth: '95vw', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="panel-h" style={{ marginBottom: '16px' }}>
              <h2>
                <span className="material-symbols-rounded" style={{ color: '#7367f0' }}>event_available</span>
                Schedule JO Subcontract Delivery
              </h2>
              <button className="btn btn-s" onClick={() => setShowModal(false)}>
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateSchedule} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Reference JO / Subcon Quotation Auto-Fill Dropdown */}
              <label className="fld" style={{ background: 'rgba(115,103,240,0.06)', padding: '12px', borderRadius: '8px', border: '1px solid #7367f0' }}>
                <span style={{ fontWeight: 700, color: '#7367f0' }}>
                  Auto-Fill from Reference JO / Subcon Quotation (Select Option)
                </span>
                <select
                  className="in"
                  value={newSchedule.refDocNo}
                  onChange={(e) => handleReferenceSelect(e.target.value)}
                  style={{ background: '#fff' }}
                >
                  <option value="">— Select Reference JO or Subcon Quotation to Auto-Fill —</option>
                  {referenceDocs.map((ref) => (
                    <option key={ref.id} value={ref.docNo}>
                      {ref.docNo} ({ref.type}) — {ref.subcontractor} — {ref.process} — {ref.itemCode} ({ref.qty} {ref.uom})
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label className="fld">
                  <span>JO / Ref Number</span>
                  <input
                    className="in"
                    placeholder="e.g. JO-2026-0003"
                    value={newSchedule.joNo}
                    onChange={(e) => setNewSchedule((prev) => ({ ...prev, joNo: e.target.value }))}
                  />
                </label>

                <label className="fld">
                  <span>
                    Subcontractor (Select Option) <em>*</em>
                  </span>
                  <select
                    className="in"
                    value={newSchedule.subcontractor}
                    required
                    onChange={(e) => handleSubcontractorSelect(e.target.value)}
                  >
                    <option value="">— Select Subcontractor —</option>
                    {subcontractors.map((s: any) => (
                      <option key={s.code || s.name} value={s.name}>
                        {s.name} ({s.code || 'SUB'})
                      </option>
                    ))}
                    {newSchedule.subcontractor && !subcontractors.some((s) => s.name === newSchedule.subcontractor) && (
                      <option value={newSchedule.subcontractor}>{newSchedule.subcontractor}</option>
                    )}
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label className="fld">
                  <span>Process Type <em>*</em></span>
                  <select
                    className="in"
                    value={newSchedule.process}
                    onChange={(e) => setNewSchedule((prev) => ({ ...prev, process: e.target.value }))}
                  >
                    <option value="Heat Treatment">Heat Treatment</option>
                    <option value="Electroplating">Electroplating / Galvanizing</option>
                    <option value="Plating">Zinc / Chrome Plating</option>
                    <option value="Anodizing">Anodizing</option>
                    <option value="Precision CNC Machining">Precision CNC Machining</option>
                    <option value="Powder Coating">Powder Coating / Painting</option>
                    <option value="Grinding">Centerless / Surface Grinding</option>
                  </select>
                </label>

                <label className="fld">
                  <span>
                    Item Code (Select Option) <em>*</em>
                  </span>
                  <SearchableItemLookup
                    value={newSchedule.itemCode}
                    items={items}
                    onChange={handleItemSelect}
                  />
                </label>
              </div>

              <label className="fld">
                <span>Item Description</span>
                <input
                  className="in"
                  placeholder="Item description"
                  value={newSchedule.itemDescription}
                  onChange={(e) => setNewSchedule((prev) => ({ ...prev, itemDescription: e.target.value }))}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <label className="fld">
                  <span>Scheduled Qty <em>*</em></span>
                  <input
                    type="number"
                    className="in"
                    required
                    min={1}
                    value={newSchedule.scheduledQty}
                    onChange={(e) => {
                      const q = Number(e.target.value);
                      setNewSchedule((prev) => ({
                        ...prev,
                        scheduledQty: q,
                        totalAmount: q * prev.unitPrice,
                      }));
                    }}
                  />
                </label>

                <label className="fld">
                  <span>Process Rate (₹)</span>
                  <input
                    type="number"
                    className="in"
                    value={newSchedule.unitPrice}
                    onChange={(e) => {
                      const p = Number(e.target.value);
                      setNewSchedule((prev) => ({
                        ...prev,
                        unitPrice: p,
                        totalAmount: prev.scheduledQty * p,
                      }));
                    }}
                  />
                </label>

                <label className="fld">
                  <span>UOM</span>
                  <select
                    className="in"
                    value={newSchedule.uom}
                    onChange={(e) => setNewSchedule((prev) => ({ ...prev, uom: e.target.value }))}
                  >
                    <option value="PCS">PCS</option>
                    <option value="NOS">NOS</option>
                    <option value="KGS">KGS</option>
                    <option value="MTRS">MTRS</option>
                    <option value="SET">SET</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label className="fld">
                  <span>Material Issue Date <em>*</em></span>
                  <input
                    type="date"
                    className="in"
                    required
                    value={newSchedule.issueDate}
                    onChange={(e) => setNewSchedule((prev) => ({ ...prev, issueDate: e.target.value }))}
                  />
                </label>

                <label className="fld">
                  <span>Expected Return Date <em>*</em></span>
                  <input
                    type="date"
                    className="in"
                    required
                    value={newSchedule.expectedReturnDate}
                    onChange={(e) => setNewSchedule((prev) => ({ ...prev, expectedReturnDate: e.target.value }))}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label className="fld">
                  <span>Delivery Location / Work Center</span>
                  <select
                    className="in"
                    value={newSchedule.location}
                    onChange={(e) => setNewSchedule((prev) => ({ ...prev, location: e.target.value }))}
                  >
                    <option value="SUBCON-01 - Heat Treatment Bay">SUBCON-01 - Heat Treatment Bay</option>
                    <option value="STORE-02 - Subcontracting Store">STORE-02 - Subcontracting Store</option>
                    <option value="MAIN - Main Warehouse">MAIN - Main Warehouse</option>
                  </select>
                </label>

                <label className="fld">
                  <span>Est Total Process Amount (₹)</span>
                  <input
                    className="in"
                    value={`₹${(newSchedule.scheduledQty * newSchedule.unitPrice).toLocaleString()}`}
                    readOnly
                    tabIndex={-1}
                    style={{ fontWeight: 700, color: '#7367f0' }}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label className="fld">
                  <span>Subcontract Priority</span>
                  <select
                    className="in"
                    value={newSchedule.priority}
                    onChange={(e) => setNewSchedule((prev) => ({ ...prev, priority: e.target.value as any }))}
                  >
                    <option value="NORMAL">NORMAL - Standard Lead Time</option>
                    <option value="HIGH">HIGH - High Priority</option>
                    <option value="URGENT">URGENT - Expedite / Fast Track</option>
                  </select>
                </label>

                <label className="fld">
                  <span>Subcontractor Contact Person</span>
                  <input
                    className="in"
                    placeholder="Contact person name"
                    value={newSchedule.contactPerson}
                    onChange={(e) => setNewSchedule((prev) => ({ ...prev, contactPerson: e.target.value }))}
                  />
                </label>
              </div>

              <label className="fld">
                <span>Remarks / Process Instructions</span>
                <input
                  className="in"
                  placeholder="Special heat treat specs, hardness requirements, plating thickness..."
                  value={newSchedule.remarks}
                  onChange={(e) => setNewSchedule((prev) => ({ ...prev, remarks: e.target.value }))}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button type="button" className="btn btn-s" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-p" disabled={saving}>
                  <span className="material-symbols-rounded">save</span>
                  {saving ? 'Saving...' : 'Save JO Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
