import { useEffect, useState } from 'react';
import apiClient from '../../../../api/axiosClient';
import { useToast } from '../../../../contexts/ToastContext';
import { getApiErrorMessage } from '../../../../utils/apiError';
import ConfirmActionModal from '../../../../components/common/ConfirmActionModal';

export interface CustomerSuppliedItemForm {
  id?: number;
  groupType: string;
  code: string;
  itemGroup: string;
  description: string;
  specification: string;
  printName: string;
  classification: string;
  productItemType: string;
  itemCatalog: string;
  processGroup: string;
  formula: string;
  salablePrice: number;
  manufacturingCost: number;
  primaryDepartment: string;
  drawingNumber: string;
  amountCalculationType: string;
  storeLocation: string;
  rack: string;
  bin: string;
  uom: string;
  hsnCode: string;
  remarks: string;

  // Flags & Storage
  stockMaintain: boolean;
  bomMaintain: boolean;
  billingItem: boolean;
  inspectionRequired: boolean;
  active: boolean;
  purchase: boolean;
  tcCustomerFormat: boolean;
  batchControl: boolean;
  storageType: string;
  itemImageUrl: string;
  consumeDepartment: string;
  generalRemark: string;
  attachmentUrl: string;
  documentType: string;
  attachmentRemarks: string;

  // Purchase Info
  purchaseRate: number;
  scrapRate: number;
  purchaseAllowance: number;
  purchaseLedger: string;
  inventoryRate: number;
  maxPurchaseRate: number;
  warrantyType: string;
  warrantyPeriodMonths: number;

  // Sale Info
  sellingRate: number;
  itemCost: number;
  salesAllowance: number;
  salesLedger: string;
  minSellingRate: number;
  mrpRate: number;

  // Engineering Info
  drawingNo: string;
  revisionNo: string;
  revisionDate: string;
  batchExpiry: string;
  expiryPeriod: number;
  purchasePackSize: number;
  issuePackSize: number;
  batchQty: number;
  inspectionReport: boolean;
  kanbanStockPolicy: string;
  palletSize: number;
  engineeringDocUrl: string;

  // Purchase Controls
  rejectionAllowance: number;
  inwardOutwardAllowancePct: number;
  issueAllowance: number;
  scrapAllowance: number;
  kanbanQtyPerDay: number;
  excessProductionPct: number;
  productionRmConsumptionPct: number;
  excessWorkOrderPct: number;
  excessRoutesheetPct: number;
  leadDays: number;

  // Dimensions
  shape: string;
  dimensionUom: string;
  length: number;
  width: number;
  height: number;
  volume: number;
  rmCutSize: string;
  dia: number;
  innerDia: number;
  outerDia: number;
  surfaceArea: number;
  netWeight: number;
  colorPallet: string;

  // Inventory Info
  inventoryCalculation: string;
  minStock: number;
  minStockDays: number;
  maxStock: number;
  minOrderQty: number;
  fifoRate: number;
  reorderPoint: number;
  eoq: number;
  materialName: string;
  maxOrderQty: number;
  minRouteSheetQty: number;
  makeName: string;
  model: string;
  brand: string;
  category: string;
  endBitItem: string;

  // Customer Part Info
  customerCode: string;
  customerPartNo: string;
  customerDescription: string;
  hsnNo: string;
  inputIgstPct: number;
  inputCgstPct: number;
  inputSgstPct: number;
  outputIgstPct: number;
  outputCgstPct: number;
  outputSgstPct: number;
  sacNo: string;
  sacInputIgstPct: number;
  sacInputCgstPct: number;
  sacInputSgstPct: number;
  sacOutputIgstPct: number;
  sacOutputCgstPct: number;
  sacOutputSgstPct: number;

  // Supplier Part Info
  supplierCode: string;
  supplierPartNo: string;
  supplierDescription: string;
  tool: string;
  supHsnNo: string;
  supInputIgstPct: number;
  supInputCgstPct: number;
  supInputSgstPct: number;
  supOutputIgstPct: number;
  supOutputCgstPct: number;
  supOutputSgstPct: number;

  // Extra Information
  costControlRequired: boolean;
  spcRequired: boolean;
  includeInInventoryCost: boolean;
  rmScanMandatory: boolean;
  loadInRmLabel: boolean;
  chemicalItem: boolean;
  packingType: string;
  packingPeriod: number;
  poInwardType: string;
  poInwardPeriod: number;
  maturationPeriodMins: number;
}

const defaultFormState: CustomerSuppliedItemForm = {
  groupType: 'Customer Supplied',
  code: '',
  itemGroup: '',
  description: '',
  specification: '',
  printName: '',
  classification: '',
  productItemType: '',
  itemCatalog: '',
  processGroup: '',
  formula: '',
  salablePrice: 0,
  manufacturingCost: 0,
  primaryDepartment: '',
  drawingNumber: '',
  amountCalculationType: '',
  storeLocation: '',
  rack: '',
  bin: '',
  uom: 'NOS',
  hsnCode: '',
  remarks: '',
  stockMaintain: true,
  bomMaintain: false,
  billingItem: true,
  inspectionRequired: true,
  active: true,
  purchase: false,
  tcCustomerFormat: false,
  batchControl: true,
  storageType: 'Bin / Box / Tray / Trolley',
  itemImageUrl: '',
  consumeDepartment: '',
  generalRemark: '',
  attachmentUrl: '',
  documentType: '',
  attachmentRemarks: '',

  purchaseRate: 0,
  scrapRate: 0,
  purchaseAllowance: 0,
  purchaseLedger: '',
  inventoryRate: 0,
  maxPurchaseRate: 0,
  warrantyType: '',
  warrantyPeriodMonths: 0,

  sellingRate: 0,
  itemCost: 0,
  salesAllowance: 0,
  salesLedger: '',
  minSellingRate: 0,
  mrpRate: 0,

  drawingNo: '',
  revisionNo: '',
  revisionDate: '',
  batchExpiry: '',
  expiryPeriod: 0,
  purchasePackSize: 0,
  issuePackSize: 0,
  batchQty: 0,
  inspectionReport: false,
  kanbanStockPolicy: '',
  palletSize: 0,
  engineeringDocUrl: '',

  rejectionAllowance: 0,
  inwardOutwardAllowancePct: 0,
  issueAllowance: 0,
  scrapAllowance: 0,
  kanbanQtyPerDay: 0,
  excessProductionPct: 0,
  productionRmConsumptionPct: 0,
  excessWorkOrderPct: 0,
  excessRoutesheetPct: 0,
  leadDays: 7,

  shape: '',
  dimensionUom: '',
  length: 0,
  width: 0,
  height: 0,
  volume: 0,
  rmCutSize: '',
  dia: 0,
  innerDia: 0,
  outerDia: 0,
  surfaceArea: 0,
  netWeight: 0,
  colorPallet: '',

  inventoryCalculation: '',
  minStock: 0,
  minStockDays: 0,
  maxStock: 0,
  minOrderQty: 1,
  fifoRate: 0,
  reorderPoint: 0,
  eoq: 0,
  materialName: '',
  maxOrderQty: 0,
  minRouteSheetQty: 0,
  makeName: '',
  model: '',
  brand: '',
  category: '',
  endBitItem: '',

  customerCode: '',
  customerPartNo: '',
  customerDescription: '',
  hsnNo: '',
  inputIgstPct: 0,
  inputCgstPct: 0,
  inputSgstPct: 0,
  outputIgstPct: 0,
  outputCgstPct: 0,
  outputSgstPct: 0,
  sacNo: '',
  sacInputIgstPct: 0,
  sacInputCgstPct: 0,
  sacInputSgstPct: 0,
  sacOutputIgstPct: 0,
  sacOutputCgstPct: 0,
  sacOutputSgstPct: 0,

  supplierCode: '',
  supplierPartNo: '',
  supplierDescription: '',
  tool: '',
  supHsnNo: '',
  supInputIgstPct: 0,
  supInputCgstPct: 0,
  supInputSgstPct: 0,
  supOutputIgstPct: 0,
  supOutputCgstPct: 0,
  supOutputSgstPct: 0,

  costControlRequired: false,
  spcRequired: false,
  includeInInventoryCost: false,
  rmScanMandatory: false,
  loadInRmLabel: false,
  chemicalItem: false,
  packingType: '',
  packingPeriod: 0,
  poInwardType: '',
  poInwardPeriod: 0,
  maturationPeriodMins: 0,
};

export default function CustomerSuppliedItemScreen() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<'FORM' | 'LIST'>('LIST');
  const [rows, setRows] = useState<CustomerSuppliedItemForm[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<CustomerSuppliedItemForm>(defaultFormState);
  const [editId, setEditId] = useState<number | null>(null);
  const [isViewOnly, setIsViewOnly] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomerSuppliedItemForm | null>(null);

  // Dynamic Grid Tables
  const [customerPartRows, setCustomerPartRows] = useState<Array<any>>([]);
  const [supplierPartRows, setSupplierPartRows] = useState<Array<any>>([]);
  const [locationRows, setLocationRows] = useState<Array<any>>([]);
  const [accessoriesRows, setAccessoriesRows] = useState<Array<any>>([]);
  const [uomRows, setUomRows] = useState<Array<any>>([]);
  const [altItemRows, setAltItemRows] = useState<Array<any>>([]);
  const [itemGroupRows, setItemGroupRows] = useState<Array<{ id: number; code: string; name: string; itemType?: string; active?: boolean }>>([]);
  const [uomOptions, setUomOptions] = useState<Array<{ id: number; code: string; name: string; symbol?: string }>>([]);

  const [openSec, setOpenSec] = useState<Record<string, boolean>>({
    sec1: true, sec2: true, sec3: true, sec4: true, sec5: true,
    sec6: true, sec7: true, sec8: true, sec9: true, sec10: true,
    sec11: true, sec12: true, sec13: true, sec14: true,
  });

  const toggleSec = (sec: string) => setOpenSec(c => ({ ...c, [sec]: !c[sec] }));

  const loadItems = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/master/items?size=500');
      const content = data?.content ?? data ?? [];
      const csmItems = content.filter((i: any) => {
        const t = (i.itemType || '').toUpperCase().replace(' ', '_');
        return t === 'CUSTOMER_SUPPLIED' || i.customerOwned;
      });
      setRows(csmItems);
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to load customer supplied items.'), 'error');
    }
    setLoading(false);
  };

  const openNew = async () => {
    setForm(defaultFormState);
    setEditId(null);
    setIsViewOnly(false);
    setViewMode('FORM');
    try {
      const { data } = await apiClient.get('/master/items/next-code?itemType=CUSTOMER_SUPPLIED');
      setForm(c => ({ ...c, code: data.code }));
    } catch {
      setForm(c => ({ ...c, code: 'CSM-0001' }));
    }
  };

  useEffect(() => { loadItems(); apiClient.get('/master/item-groups?activeOnly=false').then(r => setItemGroupRows(r.data ?? [])).catch(() => { }); apiClient.get('/master/uoms').then(r => setUomOptions(r.data ?? [])).catch(() => { }); }, []);

  const setFld = (k: keyof CustomerSuppliedItemForm, v: any) => setForm(c => ({ ...c, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code?.trim()) { toast('Item Code is required.', 'error'); return; }
    if (!form.description?.trim()) { toast('Item Name is required.', 'error'); return; }

    setBusy(true);
    try {
      const payload = { ...form, customerOwned: true };
      if (editId) {
        await apiClient.put(`/master/items/${editId}`, payload);
        toast('Customer Supplied item updated successfully.');
      } else {
        await apiClient.post('/master/items', payload);
        toast('Customer Supplied item created successfully.');
      }
      setViewMode('LIST');
      loadItems();
    } catch (err) {
      toast(getApiErrorMessage(err, 'Save failed.'), 'error');
    }
    setBusy(false);
  };

  const del = async () => {
    if (!deleteTarget?.id) return;
    setBusy(true);
    try {
      await apiClient.delete(`/master/items/${deleteTarget.id}`);
      toast('Item deleted successfully.');
      setDeleteTarget(null);
      loadItems();
    } catch (e) {
      toast(getApiErrorMessage(e, 'Delete failed.'), 'error');
    }
    setBusy(false);
  };

  const filteredRows = rows.filter(r => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      (r.code && r.code.toLowerCase().includes(s)) ||
      (r.description && r.description.toLowerCase().includes(s)) ||
      (r.customerCode && r.customerCode.toLowerCase().includes(s))
    );
  });

  return (
    <>
      <div className="pg-head pg-head-flex" style={{ marginBottom: '24px' }}>
        <div className="pg-head-text" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {viewMode === 'FORM' && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setViewMode('LIST')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <span className="material-symbols-rounded">arrow_back</span> Back
            </button>
          )}
          <div>
            <h1>
              {viewMode === 'LIST'
                ? 'Customer Supplied Item Master'
                : isViewOnly
                ? 'View Customer Supplied Item'
                : editId
                ? 'Edit Customer Supplied Item'
                : 'New Customer Supplied Item'}
            </h1>
            <p>Inventory -&gt; Items -&gt; Customer Supplied</p>
          </div>
        </div>
        <div>
          {viewMode === 'LIST' ? (
            <button type="button" className="btn btn-primary" onClick={openNew}>
              + Add Customer Supplied Item
            </button>
          ) : isViewOnly ? (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn btn-primary" onClick={() => setIsViewOnly(false)}>
                Edit
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')}>
                Back
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
                {busy ? 'Saving...' : editId ? 'Update' : 'Save'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {viewMode === 'LIST' ? (
        <div className="panel">
          <div className="panel-h">
            <h2><span className="material-symbols-rounded">inventory_2</span> Customer Supplied Items ({filteredRows.length})</h2>
            <input
              type="text"
              className="in"
              placeholder="Search by Code, Item Name, Customer..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '320px' }}
            />
          </div>
          <div className="twrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th>Item Group</th>
                  <th>Classification</th>
                  <th>UOM</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="empty">Loading Customer Supplied Items...</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={9} className="empty">No Customer Supplied Items found.</td></tr>
                ) : (
                  filteredRows.map((r, idx) => (
                    <tr key={r.id}>
                      <td>{idx + 1}</td>
                      <td className="cell-b">{r.code}</td>
                      <td><b>{r.description}</b></td>
                      <td>{(itemGroupRows.find(g => g.code === r.itemGroup || g.name === r.itemGroup || String(g.id) === String(r.itemGroup))?.name ?? r.itemGroup) || '—'}</td>
                      <td>{r.classification || 'Customer Supplied'}</td>
                      <td>{r.uom}</td>
                      <td>{r.customerCode || '—'}</td>
                      <td>
                        <span className={`bdg ${r.active ? 'bdg-POSTED' : 'bdg-REJECTED'}`}>
                          {r.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center' }}>
                          <button type="button" className="ibtn" title="View" onClick={() => { setForm(r); setEditId(r.id!); setIsViewOnly(true); setViewMode('FORM'); }}>
                            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>visibility</span>
                          </button>
                          <button type="button" className="ibtn" title="Edit" onClick={() => { setForm(r); setEditId(r.id!); setIsViewOnly(false); setViewMode('FORM'); }}>
                            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>edit</span>
                          </button>
                          <button type="button" className="ibtn danger" title="Delete" onClick={() => setDeleteTarget(r)}>
                            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <form onSubmit={save}>
          <fieldset disabled={isViewOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
          {/* SECTION 1: Item Information */}
          <div className="sec-head" onClick={() => toggleSec('sec1')} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">info</span>
              <span>Item Information</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.sec1 ? 'expand_less' : 'expand_more'}</span>
          </div>
          {openSec.sec1 && (
            <div className="sec-body">
              <div className="fgrid">
                <label className="fld">
                  <span>Group Type *</span>
                  <select className="in" value={form.groupType} onChange={e => setFld('groupType', e.target.value)}>
                    <option value="Customer Supplied">Customer Supplied</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Item Code *</span>
                  <input className="in" type="text" readOnly value={form.code} />
                </label>
                <label className="fld">
                  <span>Item Group</span>
                  <select className="in" value={form.itemGroup} onChange={e => setFld('itemGroup', e.target.value)}>
                    <option value="">Select...</option>
                    {itemGroupRows.filter(g => (g.active !== false && g.itemType === 'CUSTOMER_SUPPLIED') || g.code === form.itemGroup || g.name === form.itemGroup).map(g => <option key={g.id} value={g.code}>{g.name}</option>)}
                  </select>
                </label>

                <label className="fld">
                  <span>Item Name *</span>
                  <input className="in" type="text" required placeholder="Enter item name" value={form.description} onChange={e => setFld('description', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Specification</span>
                  <input className="in" type="text" placeholder="Enter specification" value={form.specification} onChange={e => setFld('specification', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Print Name</span>
                  <input className="in" type="text" value={form.printName} onChange={e => setFld('printName', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Classification</span>
                  <select className="in" value={form.classification} onChange={e => setFld('classification', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>

                <label className="fld">
                  <span>Product Item Type</span>
                  <select className="in" value={form.productItemType} onChange={e => setFld('productItemType', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Item Catalog</span>
                  <input className="in" type="text" placeholder="Item Catalog" value={form.itemCatalog} onChange={e => setFld('itemCatalog', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Process Group</span>
                  <select className="in" value={form.processGroup} onChange={e => setFld('processGroup', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>

                <label className="fld">
                  <span>Formula</span>
                  <input className="in" type="text" placeholder="Formula" value={form.formula} onChange={e => setFld('formula', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Salable Price</span>
                  <input className="in" type="number" step="0.01" value={form.salablePrice} onChange={e => setFld('salablePrice', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Manufacturing Cost</span>
                  <input className="in" type="number" step="0.01" value={form.manufacturingCost} onChange={e => setFld('manufacturingCost', parseFloat(e.target.value))} />
                </label>

                <label className="fld">
                  <span>Primary Department</span>
                  <input className="in" type="text" placeholder="Primary Department" value={form.primaryDepartment} onChange={e => setFld('primaryDepartment', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Drawing Number</span>
                  <input className="in" type="text" placeholder="Drawing Number" value={form.drawingNumber} onChange={e => setFld('drawingNumber', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Amount Calculation Type</span>
                  <input className="in" type="text" placeholder="Amount Calculation Type" value={form.amountCalculationType} onChange={e => setFld('amountCalculationType', e.target.value)} />
                </label>

                <label className="fld">
                  <span>Store / Location</span>
                  <select className="in" value={form.storeLocation} onChange={e => setFld('storeLocation', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Rack</span>
                  <select className="in" value={form.rack} onChange={e => setFld('rack', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Bin</span>
                  <select className="in" value={form.bin} onChange={e => setFld('bin', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>

                <label className="fld">
                  <span>Stock UOM</span>
                  <select className="in" value={form.uom} onChange={e => setFld('uom', e.target.value)}>
                    <option value="">Select...</option>
                    {uomOptions.length > 0 ? (
                      uomOptions.map(u => <option key={u.id} value={u.code}>{u.code} - {u.name}</option>)
                    ) : (
                      <option value="NOS">NOS</option>
                    )}
                  </select>
                </label>
                <label className="fld span2">
                  <span>HSN Code</span>
                  <input className="in" type="text" value={form.hsnCode} onChange={e => setFld('hsnCode', e.target.value)} />
                </label>

                <label className="fld span3">
                  <span>Remarks</span>
                  <textarea className="in" value={form.remarks} onChange={e => setFld('remarks', e.target.value)} />
                </label>
              </div>

              {/* Checkboxes Row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', padding: '12px 20px 20px', borderTop: '1px solid #e0e7ff', marginTop: '10px' }}>
                <label className="fld chk">
                  <input type="checkbox" checked={form.stockMaintain} onChange={e => setFld('stockMaintain', e.target.checked)} />
                  <span>Stock Maintain</span>
                </label>
                <label className="fld chk">
                  <input type="checkbox" checked={form.bomMaintain} onChange={e => setFld('bomMaintain', e.target.checked)} />
                  <span>BOM Maintain</span>
                </label>
                <label className="fld chk">
                  <input type="checkbox" checked={form.billingItem} onChange={e => setFld('billingItem', e.target.checked)} />
                  <span>Billing Item</span>
                </label>
                <label className="fld chk">
                  <input type="checkbox" checked={form.inspectionRequired} onChange={e => setFld('inspectionRequired', e.target.checked)} />
                  <span>Inspection Required</span>
                </label>
                <label className="fld chk">
                  <input type="checkbox" checked={form.active} onChange={e => setFld('active', e.target.checked)} />
                  <span>Active</span>
                </label>
                <label className="fld chk">
                  <input type="checkbox" checked={form.purchase} onChange={e => setFld('purchase', e.target.checked)} />
                  <span>Purchase</span>
                </label>
                <label className="fld chk">
                  <input type="checkbox" checked={form.tcCustomerFormat} onChange={e => setFld('tcCustomerFormat', e.target.checked)} />
                  <span>TC Customer Format</span>
                </label>
                <label className="fld chk">
                  <input type="checkbox" checked={form.batchControl} onChange={e => setFld('batchControl', e.target.checked)} />
                  <span>Batch Number</span>
                </label>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#1e3a8a' }}>STORAGE</span>
                  <select className="in" style={{ width: 'auto', height: '36px' }} value={form.storageType} onChange={e => setFld('storageType', e.target.value)}>
                    <option value="Bin / Box / Tray / Trolley">Bin / Box / Tray / Trolley</option>
                  </select>
                </div>
              </div>

              <div className="fgrid">
                <label className="fld">
                  <span>Consume Department</span>
                  <select className="in" value={form.consumeDepartment} onChange={e => setFld('consumeDepartment', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
                <label className="fld">
                  <span>General Remark</span>
                  <textarea className="in" value={form.generalRemark} onChange={e => setFld('generalRemark', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Attachment</span>
                  <input className="in" type="file" onChange={e => setFld('attachmentUrl', e.target.files?.[0]?.name || '')} />
                </label>
                <label className="fld">
                  <span>Document Type</span>
                  <select className="in" value={form.documentType} onChange={e => setFld('documentType', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
                <label className="fld span2">
                  <span>Attachment Remarks</span>
                  <input className="in" type="text" value={form.attachmentRemarks} onChange={e => setFld('attachmentRemarks', e.target.value)} />
                </label>
              </div>
            </div>
          )}

          {/* SECTION 2: Purchase Information */}
          <div className="sec-head" onClick={() => toggleSec('sec2')} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">shopping_cart</span>
              <span>Purchase Information</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.sec2 ? 'expand_less' : 'expand_more'}</span>
          </div>
          {openSec.sec2 && (
            <div className="sec-body">
              <div className="fgrid">
                <label className="fld">
                  <span>Purchase Rate</span>
                  <input className="in" type="number" step="0.01" value={form.purchaseRate} onChange={e => setFld('purchaseRate', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Scrap Rate</span>
                  <input className="in" type="number" step="0.01" value={form.scrapRate} onChange={e => setFld('scrapRate', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Purchase Allowance (%)</span>
                  <input className="in" type="number" step="0.01" value={form.purchaseAllowance} onChange={e => setFld('purchaseAllowance', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Purchase Ledger</span>
                  <select className="in" value={form.purchaseLedger} onChange={e => setFld('purchaseLedger', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Inventory Rate</span>
                  <input className="in" type="number" step="0.01" value={form.inventoryRate} onChange={e => setFld('inventoryRate', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Maximum Purchase Rate</span>
                  <input className="in" type="number" step="0.01" value={form.maxPurchaseRate} onChange={e => setFld('maxPurchaseRate', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Warranty Type</span>
                  <select className="in" value={form.warrantyType} onChange={e => setFld('warrantyType', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Warranty Period (Months)</span>
                  <input className="in" type="number" value={form.warrantyPeriodMonths} onChange={e => setFld('warrantyPeriodMonths', parseInt(e.target.value))} />
                </label>
              </div>
            </div>
          )}

          {/* SECTION 3: Sale Information */}
          <div className="sec-head" onClick={() => toggleSec('sec3')} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">sell</span>
              <span>Sale Information</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.sec3 ? 'expand_less' : 'expand_more'}</span>
          </div>
          {openSec.sec3 && (
            <div className="sec-body">
              <div className="fgrid">
                <label className="fld">
                  <span>Selling Rate</span>
                  <input className="in" type="number" step="0.01" value={form.sellingRate} onChange={e => setFld('sellingRate', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Item Cost</span>
                  <input className="in" type="number" step="0.01" value={form.itemCost} onChange={e => setFld('itemCost', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Sales Allowance (%)</span>
                  <input className="in" type="number" step="0.01" value={form.salesAllowance} onChange={e => setFld('salesAllowance', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Sales Ledger</span>
                  <select className="in" value={form.salesLedger} onChange={e => setFld('salesLedger', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Minimum Selling Rate</span>
                  <input className="in" type="number" step="0.01" value={form.minSellingRate} onChange={e => setFld('minSellingRate', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>MRP Rate</span>
                  <input className="in" type="number" step="0.01" value={form.mrpRate} onChange={e => setFld('mrpRate', parseFloat(e.target.value))} />
                </label>
              </div>
            </div>
          )}

          {/* SECTION 4: Engineering Information */}
          <div className="sec-head" onClick={() => toggleSec('sec4')} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">engineering</span>
              <span>Engineering Information</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.sec4 ? 'expand_less' : 'expand_more'}</span>
          </div>
          {openSec.sec4 && (
            <div className="sec-body">
              <div className="fgrid">
                <label className="fld">
                  <span>Drawing No</span>
                  <input className="in" type="text" value={form.drawingNo} onChange={e => setFld('drawingNo', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Revision No</span>
                  <input className="in" type="text" value={form.revisionNo} onChange={e => setFld('revisionNo', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Revision Date</span>
                  <input className="in" type="date" value={form.revisionDate} onChange={e => setFld('revisionDate', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Batch Expiry</span>
                  <select className="in" value={form.batchExpiry} onChange={e => setFld('batchExpiry', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Expiry Period</span>
                  <input className="in" type="number" value={form.expiryPeriod} onChange={e => setFld('expiryPeriod', parseInt(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Purchase Pack Size</span>
                  <input className="in" type="number" value={form.purchasePackSize} onChange={e => setFld('purchasePackSize', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Issue Pack Size</span>
                  <input className="in" type="number" value={form.issuePackSize} onChange={e => setFld('issuePackSize', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Batch Qty</span>
                  <input className="in" type="number" value={form.batchQty} onChange={e => setFld('batchQty', parseFloat(e.target.value))} />
                </label>
                <label className="fld chk" style={{ marginTop: '22px' }}>
                  <input type="checkbox" checked={form.inspectionReport} onChange={e => setFld('inspectionReport', e.target.checked)} />
                  <span>Inspection Report</span>
                </label>
                <label className="fld">
                  <span>Kanban Stock Policy</span>
                  <select className="in" value={form.kanbanStockPolicy} onChange={e => setFld('kanbanStockPolicy', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Pallet Size</span>
                  <input className="in" type="number" value={form.palletSize} onChange={e => setFld('palletSize', parseFloat(e.target.value))} />
                </label>
                <label className="fld span2">
                  <span>Upload Drawing / Engineering PDF</span>
                  <input className="in" type="file" onChange={e => setFld('engineeringDocUrl', e.target.files?.[0]?.name || '')} />
                </label>
              </div>
            </div>
          )}

          {/* SECTION 5: Purchase Controls */}
          <div className="sec-head" onClick={() => toggleSec('sec5')} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">tune</span>
              <span>Purchase Controls</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.sec5 ? 'expand_less' : 'expand_more'}</span>
          </div>
          {openSec.sec5 && (
            <div className="sec-body">
              <div className="fgrid">
                <label className="fld">
                  <span>Rejection Allowance</span>
                  <input className="in" type="number" step="0.01" value={form.rejectionAllowance} onChange={e => setFld('rejectionAllowance', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Inward/Outward Allowance %</span>
                  <input className="in" type="number" step="0.01" value={form.inwardOutwardAllowancePct} onChange={e => setFld('inwardOutwardAllowancePct', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Issue Allowance</span>
                  <input className="in" type="number" step="0.01" value={form.issueAllowance} onChange={e => setFld('issueAllowance', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Scrap Allowance</span>
                  <input className="in" type="number" step="0.01" value={form.scrapAllowance} onChange={e => setFld('scrapAllowance', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Kanban Qty/Per Day Plan</span>
                  <input className="in" type="number" value={form.kanbanQtyPerDay} onChange={e => setFld('kanbanQtyPerDay', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Excess Production % (+/-)</span>
                  <input className="in" type="number" step="0.01" value={form.excessProductionPct} onChange={e => setFld('excessProductionPct', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Production RM Consumption % (+/-)</span>
                  <input className="in" type="number" step="0.01" value={form.productionRmConsumptionPct} onChange={e => setFld('productionRmConsumptionPct', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Excess Work Order %</span>
                  <input className="in" type="number" step="0.01" value={form.excessWorkOrderPct} onChange={e => setFld('excessWorkOrderPct', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Excess Routesheet %</span>
                  <input className="in" type="number" step="0.01" value={form.excessRoutesheetPct} onChange={e => setFld('excessRoutesheetPct', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Lead Days</span>
                  <input className="in" type="number" value={form.leadDays} onChange={e => setFld('leadDays', parseInt(e.target.value))} />
                </label>
              </div>
            </div>
          )}

          {/* SECTION 6: Dimensions */}
          <div className="sec-head" onClick={() => toggleSec('sec6')} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">aspect_ratio</span>
              <span>Dimensions</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.sec6 ? 'expand_less' : 'expand_more'}</span>
          </div>
          {openSec.sec6 && (
            <div className="sec-body">
              <div className="fgrid">
                <label className="fld">
                  <span>Shape</span>
                  <select className="in" value={form.shape} onChange={e => setFld('shape', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
                <label className="fld">
                  <span>UOM</span>
                  <select className="in" value={form.dimensionUom} onChange={e => setFld('dimensionUom', e.target.value)}>
                    <option value="">Select...</option>
                    {uomOptions.length > 0 && uomOptions.filter(u => ['MM', 'CM', 'MTR', 'INCH', 'FT'].includes(u.code)).map(u => <option key={u.id} value={u.code}>{u.code} - {u.name}</option>)}
                  </select>
                </label>
                <label className="fld">
                  <span>Length</span>
                  <input className="in" type="number" step="0.01" value={form.length} onChange={e => setFld('length', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Width</span>
                  <input className="in" type="number" step="0.01" value={form.width} onChange={e => setFld('width', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Height</span>
                  <input className="in" type="number" step="0.01" value={form.height} onChange={e => setFld('height', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Volume</span>
                  <input className="in" type="number" step="0.01" value={form.volume} onChange={e => setFld('volume', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>RM Cut Size</span>
                  <input className="in" type="text" value={form.rmCutSize} onChange={e => setFld('rmCutSize', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Dia</span>
                  <input className="in" type="number" step="0.01" value={form.dia} onChange={e => setFld('dia', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Inner Dia</span>
                  <input className="in" type="number" step="0.01" value={form.innerDia} onChange={e => setFld('innerDia', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Outer Dia</span>
                  <input className="in" type="number" step="0.01" value={form.outerDia} onChange={e => setFld('outerDia', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Surface Area</span>
                  <input className="in" type="number" step="0.01" value={form.surfaceArea} onChange={e => setFld('surfaceArea', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Weight of Material (kg)</span>
                  <input className="in" type="number" step="0.001" value={form.netWeight} onChange={e => setFld('netWeight', parseFloat(e.target.value))} />
                </label>
                <label className="fld span2">
                  <span>Color Pallet</span>
                  <input className="in" type="text" value={form.colorPallet} onChange={e => setFld('colorPallet', e.target.value)} />
                </label>
              </div>
            </div>
          )}

          {/* SECTION 7: Inventory Information */}
          <div className="sec-head" onClick={() => toggleSec('sec7')} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">warehouse</span>
              <span>Inventory Information</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.sec7 ? 'expand_less' : 'expand_more'}</span>
          </div>
          {openSec.sec7 && (
            <div className="sec-body">
              <div className="fgrid">
                <label className="fld">
                  <span>Inventory Calculation</span>
                  <select className="in" value={form.inventoryCalculation} onChange={e => setFld('inventoryCalculation', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Minimum Stock</span>
                  <input className="in" type="number" value={form.minStock} onChange={e => setFld('minStock', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Minimum Stock Days</span>
                  <input className="in" type="number" value={form.minStockDays} onChange={e => setFld('minStockDays', parseInt(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Maximum Stock</span>
                  <input className="in" type="number" value={form.maxStock} onChange={e => setFld('maxStock', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Minimum Order Qty</span>
                  <input className="in" type="number" value={form.minOrderQty} onChange={e => setFld('minOrderQty', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>FIFO Rate</span>
                  <input className="in" type="number" step="0.01" value={form.fifoRate} onChange={e => setFld('fifoRate', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>ROL</span>
                  <input className="in" type="number" value={form.reorderPoint} onChange={e => setFld('reorderPoint', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>EOQ</span>
                  <input className="in" type="number" value={form.eoq} onChange={e => setFld('eoq', parseFloat(e.target.value))} />
                </label>
                <label className="fld">
                  <span>Material Name</span>
                  <select className="in" value={form.materialName} onChange={e => setFld('materialName', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
              </div>
            </div>
          )}

          {/* SECTION 8: Customer Part Information */}
          <div className="sec-head" onClick={() => toggleSec('sec8')} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">person</span>
              <span>Customer Part Information</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.sec8 ? 'expand_less' : 'expand_more'}</span>
          </div>
          {openSec.sec8 && (
            <div className="sec-body">
              <div className="fgrid">
                <label className="fld">
                  <span>Customer</span>
                  <select className="in" value={form.customerCode} onChange={e => setFld('customerCode', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Customer Part No</span>
                  <input className="in" type="text" value={form.customerPartNo} onChange={e => setFld('customerPartNo', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Customer Description</span>
                  <input className="in" type="text" value={form.customerDescription} onChange={e => setFld('customerDescription', e.target.value)} />
                </label>
              </div>
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '8px' }}>CUSTOMER PART DETAILS</div>
                {customerPartRows.length > 0 && (
                  <table className="tbl" style={{ marginBottom: '10px' }}>
                    <thead>
                      <tr>
                        <th>S.No</th><th>CUSTOMER</th><th>PART NO</th><th>DESCRIPTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerPartRows.map((_r, idx) => (
                        <tr key={idx}><td>{idx + 1}</td><td><input className="in" type="text" /></td><td><input className="in" type="text" /></td><td><input className="in" type="text" /></td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <button type="button" className="btn btn-sm btn-p" onClick={() => setCustomerPartRows(r => [...r, {}])}>+ Add Customer Part</button>
              </div>
            </div>
          )}

          {/* SECTION 9: Supplier Part Information */}
          <div className="sec-head" onClick={() => toggleSec('sec9')} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">local_shipping</span>
              <span>Supplier Part Information</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.sec9 ? 'expand_less' : 'expand_more'}</span>
          </div>
          {openSec.sec9 && (
            <div className="sec-body">
              <div className="fgrid">
                <label className="fld">
                  <span>Supplier</span>
                  <select className="in" value={form.supplierCode} onChange={e => setFld('supplierCode', e.target.value)}>
                    <option value="">Select...</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Supplier Part No</span>
                  <input className="in" type="text" value={form.supplierPartNo} onChange={e => setFld('supplierPartNo', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Supplier Description</span>
                  <input className="in" type="text" value={form.supplierDescription} onChange={e => setFld('supplierDescription', e.target.value)} />
                </label>
              </div>
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '8px' }}>SUPPLIER PART DETAILS</div>
                {supplierPartRows.length > 0 && (
                  <table className="tbl" style={{ marginBottom: '10px' }}>
                    <thead>
                      <tr>
                        <th>S.No</th><th>SUPPLIER</th><th>PART NO</th><th>DESCRIPTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplierPartRows.map((_r, idx) => (
                        <tr key={idx}><td>{idx + 1}</td><td><input className="in" type="text" /></td><td><input className="in" type="text" /></td><td><input className="in" type="text" /></td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <button type="button" className="btn btn-sm btn-p" onClick={() => setSupplierPartRows(r => [...r, {}])}>+ Add Supplier Part</button>
              </div>
            </div>
          )}

          {/* SECTION 10: Extra Information */}
          <div className="sec-head" onClick={() => toggleSec('sec10')} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">settings</span>
              <span>Extra Information</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.sec10 ? 'expand_less' : 'expand_more'}</span>
          </div>
          {openSec.sec10 && (
            <div className="sec-body">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                <label className="fld chk">
                  <input type="checkbox" checked={form.inspectionRequired} onChange={e => setFld('inspectionRequired', e.target.checked)} />
                  <span>Inspection Required</span>
                </label>
                <label className="fld chk">
                  <input type="checkbox" checked={form.costControlRequired} onChange={e => setFld('costControlRequired', e.target.checked)} />
                  <span>Cost Control Required</span>
                </label>
                <label className="fld chk">
                  <input type="checkbox" checked={form.spcRequired} onChange={e => setFld('spcRequired', e.target.checked)} />
                  <span>SPC Required</span>
                </label>
              </div>
            </div>
          )}

          {/* SECTION 11: Division wise Location */}
          <div className="sec-head" onClick={() => toggleSec('sec11')} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">grid_view</span>
              <span>Division wise Location</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.sec11 ? 'expand_less' : 'expand_more'}</span>
          </div>
          {openSec.sec11 && (
            <div className="sec-body">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>S.No</th>
                    <th>STORE / LOCATION</th>
                    <th>RACK</th>
                    <th>BIN</th>
                    <th>MINIMUM STOCK/CAPACITY</th>
                    <th>ROL</th>
                    <th>SEQUENCE ORDER</th>
                  </tr>
                </thead>
                <tbody>
                  {locationRows.length === 0 ? (
                    <tr><td colSpan={7} className="empty">No rows added yet</td></tr>
                  ) : (
                    locationRows.map((_r, idx) => (
                      <tr key={idx}>
                        <td>{idx + 1}</td>
                        <td><input className="in" type="text" /></td>
                        <td><input className="in" type="text" /></td>
                        <td><input className="in" type="text" /></td>
                        <td><input className="in" type="number" /></td>
                        <td><input className="in" type="number" /></td>
                        <td><input className="in" type="number" /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <button type="button" className="btn btn-sm btn-p" style={{ marginTop: '12px' }} onClick={() => setLocationRows(r => [...r, {}])}>+ Add Location</button>
            </div>
          )}

          {/* SECTION 12: Accessories Information */}
          <div className="sec-head" onClick={() => toggleSec('sec12')} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">extension</span>
              <span>Accessories Information</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.sec12 ? 'expand_less' : 'expand_more'}</span>
          </div>
          {openSec.sec12 && (
            <div className="sec-body">
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '16px' }}>
                <label className="fld" style={{ flex: 1 }}>
                  <span>ACCESSORIES ITEM</span>
                  <input className="in" type="text" placeholder="Search by item name" />
                </label>
                <label className="fld" style={{ width: '120px' }}>
                  <span>QTY</span>
                  <input className="in" type="number" defaultValue={0} />
                </label>
                <button type="button" className="btn btn-primary" onClick={() => setAccessoriesRows(r => [...r, {}])}>Add</button>
              </div>

              <table className="tbl">
                <thead>
                  <tr>
                    <th>S.No</th>
                    <th>ACCESSORIES ITEM CODE</th>
                    <th>ACCESSORIES ITEM NAME</th>
                    <th>ITEM QTY</th>
                  </tr>
                </thead>
                <tbody>
                  {accessoriesRows.length === 0 ? (
                    <tr><td colSpan={4} className="empty">No rows added yet</td></tr>
                  ) : (
                    accessoriesRows.map((_r, idx) => (
                      <tr key={idx}>
                        <td>{idx + 1}</td>
                        <td><input className="in" type="text" /></td>
                        <td><input className="in" type="text" /></td>
                        <td><input className="in" type="number" /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* SECTION 13: UOM Conversion */}
          <div className="sec-head" onClick={() => toggleSec('sec13')} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">swap_horiz</span>
              <span>UOM Conversion</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.sec13 ? 'expand_less' : 'expand_more'}</span>
          </div>
          {openSec.sec13 && (
            <div className="sec-body">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>S.No</th>
                    <th>UOM NAME</th>
                    <th>CONVERSION RATIO</th>
                    <th>DECIMAL POINT</th>
                    <th>MRP</th>
                    <th>RATE</th>
                  </tr>
                </thead>
                <tbody>
                  {uomRows.length === 0 ? (
                    <tr><td colSpan={6} className="empty">No rows added yet</td></tr>
                  ) : (
                    uomRows.map((_r, idx) => (
                      <tr key={idx}>
                        <td>{idx + 1}</td>
                        <td><input className="in" type="text" /></td>
                        <td><input className="in" type="number" /></td>
                        <td><input className="in" type="number" /></td>
                        <td><input className="in" type="number" /></td>
                        <td><input className="in" type="number" /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <button type="button" className="btn btn-sm btn-p" style={{ marginTop: '12px' }} onClick={() => setUomRows(r => [...r, {}])}>+ Add UOM Conversion</button>
            </div>
          )}

          {/* SECTION 14: Alternative Item Information */}
          <div className="sec-head" onClick={() => toggleSec('sec14')} style={{ cursor: 'pointer' }}>
            <div className="sec-title">
              <span className="material-symbols-rounded">alt_route</span>
              <span>Alternative Item Information</span>
            </div>
            <span className="material-symbols-rounded sec-toggle">{openSec.sec14 ? 'expand_less' : 'expand_more'}</span>
          </div>
          {openSec.sec14 && (
            <div className="sec-body">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>S.No</th>
                    <th>ALTERNATIVE ITEM</th>
                    <th>ALTERNATIVE ITEM CODE</th>
                    <th>ALTERNATIVE ITEM NAME</th>
                  </tr>
                </thead>
                <tbody>
                  {altItemRows.length === 0 ? (
                    <tr><td colSpan={4} className="empty">No rows added yet</td></tr>
                  ) : (
                    altItemRows.map((_r, idx) => (
                      <tr key={idx}>
                        <td>{idx + 1}</td>
                        <td><input className="in" type="text" /></td>
                        <td><input className="in" type="text" /></td>
                        <td><input className="in" type="text" /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <button type="button" className="btn btn-sm btn-p" style={{ marginTop: '12px' }} onClick={() => setAltItemRows(r => [...r, {}])}>+ Add Alternative Item</button>
            </div>
          )}
          </fieldset>

          <div className="actbar" style={{ marginTop: '24px' }}>
            {isViewOnly ? (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')}>Back</button>
                <button type="button" className="btn btn-primary" onClick={() => setIsViewOnly(false)}>Edit Item</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Saving Item...' : editId ? 'Update Customer Supplied Item' : 'Save Customer Supplied Item'}
                </button>
              </>
            )}
          </div>
        </form>
      )}

      {deleteTarget && (
        <ConfirmActionModal
          open={Boolean(deleteTarget)}
          title="Delete Customer Supplied Item"
          body={`Are you sure you want to delete customer supplied item "${deleteTarget.code}"?`}
          okLabel="Delete"
          onConfirm={del}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
