export type InwardType =
  | 'PO_INWARD'
  | 'LO_INWARD'
  | 'JO_INWARD'
  | 'GENERAL_INWARD';

export type InwardFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'auto'
  | 'item'
  | 'attachment';

export type InwardOptionsSource =
  | 'suppliers'
  | 'customers'
  | 'locations'
  | 'stores'
  | 'uoms'
  | 'pos'
  | 'jos'
  | 'los'
  | 'yn'
  | string[];

export interface InwardFieldConfig {
  key: string;
  label: string;
  type: InwardFieldType;
  required?: boolean;
  span?: number;
  wide?: boolean;
  options?: InwardOptionsSource;
}

export interface InwardTypeConfig {
  type: InwardType;
  label: string;
  prefix: string;
  icon: string;
  subtitle: string;
  color: string;
  qtyField: string;
  apiPath: string;
  headerFields: InwardFieldConfig[];
}

const baseHeader = (): InwardFieldConfig[] => [
  { key: 'no', label: 'Doc No', type: 'auto' },
  { key: 'date', label: 'Date', type: 'date', required: true },
  { key: 'supplierInvoiceNo', label: 'Supplier Invoice Number', type: 'text' },
  { key: 'dcNumber', label: 'DC Number', type: 'text' },
  { key: 'qcRequired', label: 'Quality Inspection Required', type: 'select', required: true, options: 'yn' },
  { key: 'attachment', label: 'File Attachment (Invoice / Challan / Inspection Copy)', type: 'attachment', span: 2 },
];

const processOptions = ['Heat Treatment', 'Plating', 'Grinding', 'Coating'];
const workCenterOptions = ['VMC-01', 'VMC-02', 'CNC-Lathe-01'];
const sourceTypeOptions = ['Customer', 'Vendor', 'Internal Department', 'Other'];
const reasonCodeOptions = [
  'Opening Stock',
  'Free Sample',
  'Customer Return',
  'Internal Transfer',
  'Other',
];

export const INWARD_TYPES: Record<InwardType, InwardTypeConfig> = {
  PO_INWARD: {
    type: 'PO_INWARD',
    label: 'PO Inward',
    prefix: 'POI',
    icon: 'move_to_inbox',
    subtitle: 'Purchase order inward entries',
    color: 'var(--blue)',
    qtyField: 'receivedQty',
    apiPath: '/inventory/documents/po-inward',
    headerFields: [
      { key: 'no', label: 'Doc No', type: 'auto' },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'qcRequired', label: 'Quality Inspection Required', type: 'select', required: true, options: 'yn' },
      { key: 'purchaseOrderNo', label: 'Purchase Order', type: 'select', required: true, options: 'pos' },
      { key: 'supplier', label: 'Supplier', type: 'select', required: true, options: 'suppliers' },
      { key: 'supplierInvoiceNo', label: 'Supplier Invoice Number', type: 'text' },
      { key: 'dcNumber', label: 'DC Number', type: 'text' },
      { key: 'vehicleNo', label: 'Vehicle No', type: 'text' },
      { key: 'receivedBy', label: 'Received By', type: 'text', required: true },
      { key: 'attachment', label: 'File Attachment (Invoice / Challan / Inspection Copy)', type: 'attachment', span: 2 },
      { key: 'remarks', label: 'Remarks', type: 'text', span: 2 },
    ],
  },

  LO_INWARD: {
    type: 'LO_INWARD',
    label: 'LO Inward',
    prefix: 'LOI',
    icon: 'move_to_inbox',
    subtitle: 'Material returned from subcontractor',
    color: 'var(--purple)',
    qtyField: 'receivedQty',
    apiPath: '/inventory/documents/lo-inward',
    headerFields: [
      ...baseHeader(),
      { key: 'vendor', label: 'Vendor', type: 'select', required: true, options: 'suppliers' },
      { key: 'labourOrderNo', label: 'Labour Order', type: 'select', required: true, options: 'los' },
      { key: 'jobOrderNo', label: 'Job Order', type: 'select', options: 'jos' },
      { key: 'process', label: 'Process', type: 'select', required: true, options: processOptions },
      { key: 'remarks', label: 'Remarks', type: 'text' },
    ],
  },

  JO_INWARD: {
    type: 'JO_INWARD',
    label: 'JO Inward',
    prefix: 'JOI',
    icon: 'move_to_inbox',
    subtitle: 'Finished / semi-finished from production',
    color: 'var(--green)',
    qtyField: 'producedQty',
    apiPath: '/inventory/documents/jo-inward',
    headerFields: [
      ...baseHeader(),
      { key: 'jobOrderNo', label: 'Job Order', type: 'select', required: true, options: 'jos' },
      { key: 'workCenter', label: 'Work Center', type: 'select', options: workCenterOptions },
      { key: 'operationNo', label: 'Operation No', type: 'text' },
      { key: 'remarks', label: 'Remarks', type: 'text' },
    ],
  },

  GENERAL_INWARD: {
    type: 'GENERAL_INWARD',
    label: 'General Inward',
    prefix: 'GIN',
    icon: 'move_to_inbox',
    subtitle: 'Approved receipts not linked to PO / LO / JO',
    color: 'var(--yellow)',
    qtyField: 'receivedQty',
    apiPath: '/inventory/documents/general-inward',
    headerFields: [
      ...baseHeader(),
      { key: 'sourceType', label: 'Source Type', type: 'select', required: true, options: sourceTypeOptions },
      { key: 'party', label: 'Party', type: 'text', required: true },
      { key: 'reasonCode', label: 'Reason Code', type: 'select', required: true, options: reasonCodeOptions },
      { key: 'returnable', label: 'Returnable', type: 'select', required: true, options: 'yn' },
      { key: 'remarks', label: 'Remarks', type: 'text' },
    ],
  },
};

export const INWARD_TYPE_LIST: InwardTypeConfig[] = [
  INWARD_TYPES.PO_INWARD,
  INWARD_TYPES.LO_INWARD,
  INWARD_TYPES.JO_INWARD,
  INWARD_TYPES.GENERAL_INWARD,
];

export function buildLineFields(qtyField: string, _inwardType?: InwardType): InwardFieldConfig[] {
  const fields: InwardFieldConfig[] = [
    { key: 'itemCode', label: 'Item Code', type: 'item', required: true },
    { key: 'itemDesc', label: 'Item Name', type: 'auto' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'uom', label: 'UOM', type: 'select', options: 'uoms' },
    { key: qtyField, label: 'Qty', type: 'number', required: true },
    { key: 'rate', label: 'Unit Price', type: 'number' },
    { key: 'discount', label: 'Disc (%)', type: 'number' },
    { key: 'tax', label: 'Tax (%)', type: 'number' },
    { key: 'taxAmount', label: 'Tax Amt', type: 'auto' },
    { key: 'netAmount', label: 'Net Amt', type: 'auto' },
    { key: 'acceptedQty', label: 'Accepted', type: 'number' },
    { key: 'rejectedQty', label: 'Rejected', type: 'number' },
  ];

  // Batch/Heat/Lot/Serial No render for every inward type, PO_INWARD included, so there's
  // always a field to enter them when the received item needs traceability — batchNo/heatNo
  // were already here; lotNo/serialNo exist on the line entity (BaseLine) but had no field on
  // this screen at all until now (Inward Entry FRD v2.0 §6.2, closes as-is Open Question Q5).
  // None of these four are currently enforced as mandatory server-side.
  fields.push(
    { key: 'batchNo', label: 'Batch No', type: 'text' },
    { key: 'heatNo', label: 'Heat No', type: 'text' },
    { key: 'lotNo', label: 'Lot No', type: 'text' },
    { key: 'serialNo', label: 'Serial No', type: 'text' }
  );

  fields.push(
    { key: 'location', label: 'Store Location', type: 'select', required: true, options: 'stores' },
    { key: 'remarks', label: 'Remarks', type: 'text' }
  );

  return fields;
}