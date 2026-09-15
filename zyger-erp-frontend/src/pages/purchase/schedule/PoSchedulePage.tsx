import { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import axiosClient from '../../../api/axiosClient';
import StatusBadge from '../../../components/common/StatusBadge';
import { useTabs } from '../../../contexts/TabsContext';
import { useToast } from '../../../contexts/ToastContext';
import PurchaseOrderPage from '../order/PurchaseOrderPage';
import { logSystemActivity } from '../../../utils/activityLog';
import { exportToCsv } from '../../../utils/csvExport';
import { filterPurchaseRelevantItems } from '../../../utils/itemClassification';
import SearchableItemLookup from '../../../components/common/SearchableItemLookup';

interface ScheduleRow {
  id?: number;
  poNo: string;
  refDocNo?: string;
  supplier: string;
  supplierCode?: string;
  itemCode: string;
  itemDescription?: string;
  uom?: string;
  unitPrice?: number;
  totalAmount?: number;
  scheduledQty: number;
  scheduledDate: string;
  receivedQty: number;
  pendingQty: number;
  location?: string;
  priority?: 'NORMAL' | 'HIGH' | 'URGENT';
  contactPerson?: string;
  status: string;
  remarks?: string;
}

export default function PoSchedulePage() {
  const { openTab } = useTabs();
  const { toast } = useToast();
  const { user } = useAuth();

  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  // Master & Reference Lookups for Auto-Fill Dropdowns
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [referenceDocs, setReferenceDocs] = useState<any[]>([]);

  const [activeNotification, setActiveNotification] = useState<{
    poNo: string;
    supplier: string;
    itemCode: string;
    itemDescription?: string;
    scheduledQty: number;
    scheduledDate: string;
  } | null>(null);

  // Form state with detailed schedule attributes
  const [newSchedule, setNewSchedule] = useState({
    refDocNo: '',
    poId: undefined as number | undefined,
    poNo: '',
    supplier: '',
    supplierCode: '',
    itemCode: '',
    itemDescription: '',
    uom: '',
    unitPrice: 0,
    scheduledQty: 0,
    totalAmount: 0,
    scheduledDate: new Date().toISOString().split('T')[0],
    location: '',
    priority: 'NORMAL',
    contactPerson: '',
    phone: '',
    remarks: '',
  });

  useEffect(() => {
    // Fetch Schedules from backend & seed fallbacks
    axiosClient
      .get('/v1/purchase/purchase-order?size=100')
      .then((res) => {
        const docs = res.data?.content || res.data || [];
        const list: ScheduleRow[] = [];
        if (Array.isArray(docs)) {
          docs.forEach((po: any) => {
            if (Array.isArray(po.schedules) && po.schedules.length > 0) {
              po.schedules.forEach((s: any) => {
                const qty = Number(s.scheduledQty || 0);
                const price = Number(s.unitPrice || 0);
                list.push({
                  id: s.id,
                  poNo: po.docNo || '',
                  refDocNo: s.refDocNo || po.docNo,
                  supplier: po.supplier || '',
                  supplierCode: po.supplierCode || '',
                  itemCode: s.itemCode || '',
                  itemDescription: s.itemDescription || '',
                  uom: s.uom || '',
                  unitPrice: price,
                  totalAmount: qty * price,
                  scheduledQty: qty,
                  scheduledDate: s.scheduledDate || po.date || '',
                  receivedQty: Number(s.receivedQty || 0),
                  pendingQty: Number(s.pendingQty ?? qty),
                  location: s.location || '',
                  priority: s.priority || 'NORMAL',
                  status: s.status || po.status || 'PLANNED',
                  remarks: s.remarks,
                });
              });
            } else {
              const lines = Array.isArray(po.lines) ? po.lines : [];
              lines.forEach((l: any, i: number) => {
                const qty = Number(l.orderQty || l.qty || 0);
                const price = Number(l.unitPrice || l.rate || 0);
                list.push({
                  id: i + 1,
                  poNo: po.docNo || '',
                  refDocNo: po.docNo,
                  supplier: po.supplier || '',
                  supplierCode: po.supplierCode || '',
                  itemCode: l.itemCode || '',
                  itemDescription: l.description || l.itemName || l.itemDesc || '',
                  uom: l.uom || '',
                  unitPrice: price,
                  totalAmount: qty * price,
                  scheduledQty: qty,
                  scheduledDate: po.expectedDeliveryDate || po.date || '',
                  // No backend service populates PurchaseOrderSchedule.receivedQty from GRN/PO
                  // Inward postings yet, so this stays 0 for real data until that reconciliation
                  // is built — deliberately not fabricated here.
                  receivedQty: 0,
                  pendingQty: qty,
                  location: '',
                  priority: 'NORMAL',
                  status: po.status || 'PLANNED',
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

    // Fetch Master Lookups & Reference Quotation/PO options for Auto-Fill Dropdowns
    Promise.allSettled([
      axiosClient.get('/master/suppliers'),
      axiosClient.get('/master/items'),
      axiosClient.get('/v1/purchase/supplier-quotation?size=20'),
      axiosClient.get('/v1/purchase/purchase-order?size=20'),
    ]).then(([suppRes, itemRes, quotRes, poRes]) => {
      if (suppRes.status === 'fulfilled' && Array.isArray(suppRes.value.data)) {
        setSuppliers(suppRes.value.data);
      } else {
        setSuppliers([]);
      }

      if (itemRes.status === 'fulfilled' && Array.isArray(itemRes.value.data)) {
        setItems(filterPurchaseRelevantItems(itemRes.value.data));
      } else {
        setItems([]);
      }

      const refs: any[] = [];
      if (quotRes.status === 'fulfilled' && Array.isArray(quotRes.value.data?.content)) {
        quotRes.value.data.content.forEach((q: any) => {
          const l0 = Array.isArray(q.lines) && q.lines[0] ? q.lines[0] : {};
          refs.push({
            id: `QUOT-${q.docNo}`,
            docNo: q.docNo,
            type: 'Supplier Quotation',
            supplier: q.supplier || '',
            supplierCode: q.supplierCode || '',
            itemCode: l0.itemCode || '',
            itemDescription: l0.description || l0.itemName || l0.itemDesc || '',
            qty: Number(l0.orderQty || l0.qty || 0),
            uom: l0.uom || '',
            unitPrice: Number(l0.unitPrice || l0.rate || 0),
          });
        });
      }
      if (poRes.status === 'fulfilled' && Array.isArray(poRes.value.data?.content)) {
        poRes.value.data.content.forEach((p: any) => {
          const l0 = Array.isArray(p.lines) && p.lines[0] ? p.lines[0] : {};
          refs.push({
            id: `PO-${p.docNo}`,
            poId: p.id,
            docNo: p.docNo,
            type: 'Purchase Order',
            supplier: p.supplier || '',
            supplierCode: p.supplierCode || '',
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
      const qty = Number(selected.qty || 0);
      const price = Number(selected.unitPrice || 0);
      setNewSchedule((prev) => ({
        ...prev,
        refDocNo: selected.docNo,
        poId: selected.type === 'Purchase Order' ? selected.poId : undefined,
        poNo: selected.type === 'Purchase Order' ? selected.docNo : `SCH-${selected.docNo}`,
        supplier: selected.supplier,
        supplierCode: selected.supplierCode || '',
        itemCode: selected.itemCode,
        itemDescription: selected.itemDescription,
        uom: selected.uom || '',
        unitPrice: price,
        scheduledQty: qty,
        totalAmount: qty * price,
      }));
      toast(`✨ Auto-filled schedule details from ${selected.type} ${selected.docNo}`, 'success');
    }
  };

  const handleSupplierSelect = (suppName: string) => {
    const foundSupp = suppliers.find((s) => s.name === suppName || s.code === suppName);
    setNewSchedule((prev) => ({
      ...prev,
      supplier: suppName,
      supplierCode: foundSupp?.code || prev.supplierCode,
      contactPerson: foundSupp?.contactPerson || prev.contactPerson,
      phone: foundSupp?.phone || prev.phone,
    }));
  };

  const handleItemSelect = (itemCode: string) => {
    const foundItem = items.find((i) => i.code === itemCode);
    setNewSchedule((prev) => {
      const price = foundItem?.price || prev.unitPrice || 0;
      const desc = foundItem ? `${foundItem.name}${foundItem.description ? ` (${foundItem.description})` : ''}` : prev.itemDescription;
      const qty = prev.scheduledQty || 0;
      return {
        ...prev,
        itemCode: itemCode,
        itemDescription: desc,
        uom: foundItem?.uom || prev.uom || '',
        unitPrice: price,
        totalAmount: qty * price,
      };
    });
  };

  const handleGoToPurchase = (s: ScheduleRow) => {
    openTab({
      id: 'purchase-order',
      label: 'Purchase Order',
      icon: 'shopping_bag',
      component: PurchaseOrderPage,
      props: {
        prefill: {
          supplier: s.supplier,
          poNumber: s.poNo,
          itemCode: s.itemCode,
          orderQty: s.scheduledQty,
          scheduledDate: s.scheduledDate,
        },
      },
    });
  };

  const [saving, setSaving] = useState(false);

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    // A schedule row only means something tied to a real Purchase Order — this used to
    // create a local-only row that vanished on refresh even when a PO was selected, since
    // nothing was ever persisted. Now it requires a real PO reference and actually saves.
    if (!newSchedule.poId) {
      toast('Select a Purchase Order from "Reference Document" first — a schedule must be tied to a real PO to be saved.', 'error');
      return;
    }
    setSaving(true);
    try {
      const { data: savedRow } = await axiosClient.post(
        `/v1/purchase/purchase-order/${newSchedule.poId}/schedules`,
        {
          itemCode: newSchedule.itemCode.trim(),
          scheduledQty: Number(newSchedule.scheduledQty) || 0,
          scheduledDate: newSchedule.scheduledDate,
          supplier: newSchedule.supplier.trim(),
          status: 'PLANNED',
        }
      );

      const created: ScheduleRow = {
        id: savedRow.id,
        poNo: newSchedule.poNo,
        refDocNo: newSchedule.refDocNo || newSchedule.poNo,
        supplier: newSchedule.supplier.trim(),
        supplierCode: newSchedule.supplierCode,
        itemCode: newSchedule.itemCode.trim(),
        itemDescription: newSchedule.itemDescription,
        uom: newSchedule.uom,
        unitPrice: newSchedule.unitPrice,
        totalAmount: newSchedule.scheduledQty * newSchedule.unitPrice,
        scheduledQty: Number(newSchedule.scheduledQty) || 0,
        scheduledDate: newSchedule.scheduledDate,
        receivedQty: 0,
        pendingQty: Number(newSchedule.scheduledQty) || 0,
        location: newSchedule.location,
        priority: newSchedule.priority as any,
        contactPerson: newSchedule.contactPerson,
        status: 'PLANNED',
        remarks: newSchedule.remarks,
      };

      setSchedules((prev) => [created, ...prev]);
      setShowModal(false);

      setActiveNotification({
        poNo: created.poNo,
        supplier: created.supplier,
        itemCode: created.itemCode,
        itemDescription: created.itemDescription,
        scheduledQty: created.scheduledQty,
        scheduledDate: created.scheduledDate,
      });

      toast(`🔔 Scheduled PO ${created.poNo} for ${created.itemCode}! Go to Purchase to buy items.`, 'success');

      logSystemActivity({
        module: 'Purchase',
        activity: `Scheduled PO Delivery (${created.poNo})`,
        refNo: created.poNo,
        party: created.supplier,
        user: user?.username || 'Unknown',
        status: 'PLANNED',
      });

      setNewSchedule({
        refDocNo: '',
        poId: undefined,
        poNo: '',
        supplier: '',
        supplierCode: '',
        itemCode: '',
        itemDescription: '',
        uom: '',
        unitPrice: 0,
        scheduledQty: 0,
        totalAmount: 0,
        scheduledDate: new Date().toISOString().split('T')[0],
        location: '',
        priority: 'NORMAL',
        contactPerson: '',
        phone: '',
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
      s.poNo.toLowerCase().includes(search.toLowerCase()) ||
      s.supplier.toLowerCase().includes(search.toLowerCase()) ||
      s.itemCode.toLowerCase().includes(search.toLowerCase()) ||
      (s.itemDescription && s.itemDescription.toLowerCase().includes(search.toLowerCase())) ||
      (s.refDocNo && s.refDocNo.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="view-container">
      <div className="pg-head pg-head-flex">
        <div className="pg-head-text">
          <h1>Purchase Order Delivery Schedules</h1>
          <p>Monitor line-item delivery schedules, supplier fulfillment status and pending delivery quantities</p>
        </div>
        <button className="btn btn-p" onClick={() => setShowModal(true)}>
          <span className="material-symbols-rounded">event_available</span>
          Schedule PO Delivery
        </button>
      </div>

      {/* Notification Banner Alert */}
      {activeNotification && (
        <div
          style={{
            marginBottom: '20px',
            padding: '16px 20px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, rgba(0, 123, 214, 0.12) 0%, rgba(115, 103, 240, 0.12) 100%)',
            border: '1px solid var(--blue)',
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
                background: 'var(--blue)',
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
                PO Scheduled: {activeNotification.poNo}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '2px' }}>
                You scheduled <strong>{activeNotification.itemCode}</strong> {activeNotification.itemDescription ? `(${activeNotification.itemDescription})` : ''} (Qty: {activeNotification.scheduledQty}) for <strong>{activeNotification.supplier}</strong> due on {activeNotification.scheduledDate}. Go to Purchase to buy these items!
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <button
              className="btn btn-p"
              onClick={() =>
                handleGoToPurchase({
                  poNo: activeNotification.poNo,
                  supplier: activeNotification.supplier,
                  itemCode: activeNotification.itemCode,
                  scheduledQty: activeNotification.scheduledQty,
                  scheduledDate: activeNotification.scheduledDate,
                  receivedQty: 0,
                  pendingQty: activeNotification.scheduledQty,
                  status: 'PLANNED',
                })
              }
              style={{ fontWeight: 700 }}
            >
              <span className="material-symbols-rounded">shopping_bag</span>
              Go to Purchase
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
              placeholder="Search PO schedule, supplier, item..."
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
                  { key: 'poNo', label: 'PO / Ref No' },
                  { key: 'refDocNo', label: 'Ref Doc No' },
                  { key: 'supplier', label: 'Supplier' },
                  { key: 'supplierCode', label: 'Supplier Code' },
                  { key: 'itemCode', label: 'Item Code' },
                  { key: 'itemDescription', label: 'Item Description' },
                  { key: 'uom', label: 'UOM' },
                  { key: 'unitPrice', label: 'Unit Price' },
                  { key: 'scheduledQty', label: 'Scheduled Qty' },
                  { key: 'totalAmount', label: 'Est Amount' },
                  { key: 'scheduledDate', label: 'Scheduled Date' },
                  { key: 'receivedQty', label: 'Received Qty' },
                  { key: 'pendingQty', label: 'Pending Qty' },
                  { key: 'location', label: 'Location' },
                  { key: 'priority', label: 'Priority' },
                  { key: 'status', label: 'Status' },
                ],
                'po-delivery-schedules'
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
                <th>PO / Ref No</th>
                <th>Supplier</th>
                <th>Item Details</th>
                <th className="num">Price (₹)</th>
                <th className="num">Scheduled Qty</th>
                <th className="num">Est Amount (₹)</th>
                <th>Scheduled Date</th>
                <th>Location</th>
                <th>Priority</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="empty">Loading PO delivery schedules...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="empty">No PO schedules found matching your search.</td>
                </tr>
              ) : (
                filtered.map((s, idx) => (
                  <tr key={idx}>
                    <td className="cell-b">
                      <div>{s.poNo}</div>
                      {s.refDocNo && s.refDocNo !== s.poNo && (
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Ref: {s.refDocNo}</div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.supplier}</div>
                      {s.supplierCode && (
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{s.supplierCode}</div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-neutral" style={{ fontWeight: 700 }}>{s.itemCode}</span>
                      {s.itemDescription && (
                        <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>{s.itemDescription}</div>
                      )}
                    </td>
                    <td className="num">₹{s.unitPrice ?? 0}</td>
                    <td className="num cell-b">
                      {s.scheduledQty} <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{s.uom}</span>
                    </td>
                    <td className="num cell-b" style={{ color: 'var(--blue)' }}>
                      ₹{(s.totalAmount ?? (s.scheduledQty * (s.unitPrice ?? 0))).toLocaleString()}
                    </td>
                    <td>{s.scheduledDate}</td>
                    <td>
                      <span style={{ fontSize: '12px' }}>{s.location || 'MAIN'}</span>
                    </td>
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
                        onClick={() => handleGoToPurchase(s)}
                        style={{ padding: '4px 10px', fontSize: '12px', whiteSpace: 'nowrap' }}
                      >
                        <span className="material-symbols-rounded" style={{ fontSize: '15px' }}>shopping_bag</span>
                        Go to Purchase
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Schedule PO Modal with Auto-Fill Dropdowns */}
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
                <span className="material-symbols-rounded" style={{ color: 'var(--blue)' }}>event_available</span>
                Schedule PO Delivery
              </h2>
              <button className="btn btn-s" onClick={() => setShowModal(false)}>
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateSchedule} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Reference Quotation / PO Auto-Fill Dropdown */}
              <label className="fld" style={{ background: 'rgba(0,123,214,0.05)', padding: '12px', borderRadius: '8px', border: '1px stroke var(--blue)' }}>
                <span style={{ fontWeight: 700, color: 'var(--blue)' }}>
                  Auto-Fill from Reference Quotation / PO (Select Option)
                </span>
                <select
                  className="in"
                  value={newSchedule.refDocNo}
                  onChange={(e) => handleReferenceSelect(e.target.value)}
                  style={{ background: '#fff' }}
                >
                  <option value="">— Select Reference Quotation or PO to Auto-Fill —</option>
                  {referenceDocs.map((ref) => (
                    <option key={ref.id} value={ref.docNo}>
                      {ref.docNo} ({ref.type}) — {ref.supplier} — {ref.itemCode} ({ref.qty} {ref.uom})
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label className="fld">
                  <span>PO / Ref Number</span>
                  <input
                    className="in"
                    placeholder="e.g. PO-2026-0003"
                    value={newSchedule.poNo}
                    onChange={(e) => setNewSchedule((prev) => ({ ...prev, poNo: e.target.value }))}
                  />
                </label>

                <label className="fld">
                  <span>
                    Supplier (Select Option) <em>*</em>
                  </span>
                  <select
                    className="in"
                    value={newSchedule.supplier}
                    required
                    onChange={(e) => handleSupplierSelect(e.target.value)}
                  >
                    <option value="">— Select Supplier —</option>
                    {suppliers.map((s: any) => (
                      <option key={s.code || s.name} value={s.name}>
                        {s.name} ({s.code || 'SUPP'})
                      </option>
                    ))}
                    {newSchedule.supplier && !suppliers.some((s) => s.name === newSchedule.supplier) && (
                      <option value={newSchedule.supplier}>{newSchedule.supplier}</option>
                    )}
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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

                <label className="fld">
                  <span>Item Description</span>
                  <input
                    className="in"
                    placeholder="Item description"
                    value={newSchedule.itemDescription}
                    onChange={(e) => setNewSchedule((prev) => ({ ...prev, itemDescription: e.target.value }))}
                  />
                </label>
              </div>

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
                  <span>Unit Price (₹)</span>
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
                    <option value="SHEET">SHEET</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label className="fld">
                  <span>Scheduled Date <em>*</em></span>
                  <input
                    type="date"
                    className="in"
                    required
                    value={newSchedule.scheduledDate}
                    onChange={(e) => setNewSchedule((prev) => ({ ...prev, scheduledDate: e.target.value }))}
                  />
                </label>

                <label className="fld">
                  <span>Delivery Location / Store</span>
                  <select
                    className="in"
                    value={newSchedule.location}
                    onChange={(e) => setNewSchedule((prev) => ({ ...prev, location: e.target.value }))}
                  >
                    <option value="MAIN - Main Warehouse">MAIN - Main Warehouse</option>
                    <option value="STORE-01 - Raw Material Store">STORE-01 - Raw Material Store</option>
                    <option value="STORE-02 - Subcon Store">STORE-02 - Subcon Store</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label className="fld">
                  <span>Delivery Priority</span>
                  <select
                    className="in"
                    value={newSchedule.priority}
                    onChange={(e) => setNewSchedule((prev) => ({ ...prev, priority: e.target.value as any }))}
                  >
                    <option value="NORMAL">NORMAL - Normal Delivery</option>
                    <option value="HIGH">HIGH - High Priority</option>
                    <option value="URGENT">URGENT - Critical / Expedite</option>
                  </select>
                </label>

                <label className="fld">
                  <span>Est Total Amount (₹)</span>
                  <input
                    className="in"
                    value={`₹${(newSchedule.scheduledQty * newSchedule.unitPrice).toLocaleString()}`}
                    readOnly
                    tabIndex={-1}
                    style={{ fontWeight: 700, color: 'var(--blue)' }}
                  />
                </label>
              </div>

              <label className="fld">
                <span>Remarks / Delivery Instructions</span>
                <input
                  className="in"
                  placeholder="Notes, instructions or specific packaging guidelines..."
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
                  {saving ? 'Saving...' : 'Save Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
