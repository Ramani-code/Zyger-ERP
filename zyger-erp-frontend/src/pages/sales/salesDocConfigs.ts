export interface SalesFieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'datetime-local' | 'select' | 'checkbox' | 'textarea';
  options?: string[];
  required?: boolean;
  span2?: boolean;
  readOnly?: boolean;
}

export interface SalesLineFieldDef {
  colNo: number;
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'lookup';
  options?: string[];
  readOnly?: boolean;
  required?: boolean;
}

export interface SalesColumnDef {
  label: string;
  field: string;
  numeric?: boolean;
  badge?: boolean;
}

export interface SalesDocScreenConfig {
  docType: string;
  title: string;
  subtitle: string;
  columns: SalesColumnDef[];
  statusField: string;
  statusOptions: string[];
  typeFilter?: { field: string; label: string; options: string[] };
  fields: SalesFieldDef[];
  lines?: { title: string; fields: SalesLineFieldDef[] };
}

const GENERIC_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CLOSED'];

// 1. Sales Order (SO) Config
export const SALES_ORDER_CONFIG: SalesDocScreenConfig = {
  docType: 'sales-order',
  title: 'Sales Order',
  subtitle: 'Central document recording customer confirmed requirements for production, delivery, and invoicing',
  columns: [
    { label: 'SO Number', field: 'docNo' },
    { label: 'SO Date', field: 'date' },
    { label: 'Customer', field: 'customer' },
    { label: 'Customer PO', field: 'customerPoNumber' },
    { label: 'Sales Rep', field: 'salesPerson' },
    { label: 'Order Value', field: 'totalAmount', numeric: true },
    { label: 'Delivery Date', field: 'targetDeliveryDate' },
    { label: 'Delivery Status', field: 'deliveryStatus', badge: true },
    { label: 'Status', field: 'status', badge: true },
  ],
  statusField: 'status',
  // PENDING_TIER1/2/3: Phase 4 tier router — a submitted SO lands on one of these
  // instead of the generic SUBMITTED (Technical Design §3.2).
  statusOptions: [...GENERIC_STATUSES, 'PENDING_TIER1', 'PENDING_TIER2', 'PENDING_TIER3', 'RELEASED', 'PARTIALLY_DISPATCHED', 'DELIVERED'],
  fields: [
    { key: 'docNo', label: 'SO Number (Auto)', readOnly: true },
    { key: 'date', label: 'SO Date *', type: 'date', required: true },
    { key: 'customerCode', label: 'Customer Code (Lookup)' },
    { key: 'customer', label: 'Customer Name *', required: true },
    { key: 'customerPoNumber', label: 'Customer PO Number *', required: true },
    { key: 'customerPoDate', label: 'Customer PO Date', type: 'date' },
    { key: 'customerGstin', label: 'Customer GSTIN' },
    { key: 'placeOfSupply', label: 'Place of Supply (State)' },
    { key: 'salesPerson', label: 'Sales Representative *', required: true },
    { key: 'currency', label: 'Currency', type: 'select', options: ['INR - Indian Rupee', 'USD - US Dollar', 'EUR - Euro', 'GBP - British Pound', 'AED - UAE Dirham'] },
    { key: 'exchangeRate', label: 'Exchange Rate', type: 'number' },
    { key: 'paymentTerms', label: 'Payment Terms', type: 'select', options: ['Advance', '15 Days', '30 Days', '45 Days', '60 Days', 'LC', 'PDC'] },
    { key: 'deliveryTerms', label: 'Delivery Terms / Incoterms', type: 'select', options: ['EXW - Ex Works', 'FOB - Free on Board', 'CIF - Cost Insurance Freight', 'DAP - Delivered at Place', 'DDP - Delivered Duty Paid'] },
    { key: 'creditLimitStatus', label: 'Credit Limit Status', type: 'select', options: ['OK', 'Exceeded', 'Blocked'], readOnly: true },
    { key: 'complianceChecklist', label: 'Compliance Checklist', type: 'select', options: ['Tax Verified', 'Quality Standards Approved', 'Export Clearance Valid', 'Full Compliance'] },
    { key: 'targetDeliveryDate', label: 'Target Delivery Date', type: 'date' },
    { key: 'deliveryStatus', label: 'Delivery Status', type: 'select', options: ['Pending', 'Partial', 'Delivered'], readOnly: true },
    { key: 'billingAddress', label: 'Billing Address (Lookup)', type: 'textarea', span2: true },
    { key: 'shippingAddress', label: 'Shipping Address (Lookup)', type: 'textarea', span2: true },
    { key: 'remarks', label: 'Remarks', type: 'textarea', span2: true },
  ],
  lines: {
    title: 'Sales Order Line Items Grid',
    fields: [
      { colNo: 1, key: 'lineNo', label: 'Line #', readOnly: true },
      { colNo: 2, key: 'itemCode', label: 'Item Code / Name (Master Lookup)', type: 'lookup', required: true },
      { colNo: 3, key: 'description', label: 'Description' },
      { colNo: 4, key: 'revisionLevel', label: 'Revision Level' },
      { colNo: 5, key: 'qty', label: 'Quantity *', type: 'number', required: true },
      { colNo: 6, key: 'uom', label: 'UOM' },
      { colNo: 7, key: 'unitPrice', label: 'Unit Price (₹)', type: 'number' },
      { colNo: 8, key: 'discount', label: 'Discount %', type: 'number' },
      { colNo: 9, key: 'taxCode', label: 'Tax Code', type: 'select', options: ['GST 18%', 'GST 28%', 'GST 12%', 'GST 5%', 'Exempt'] },
      { colNo: 10, key: 'taxAmount', label: 'Tax Amount (₹)', type: 'number', readOnly: true },
      { colNo: 11, key: 'netAmount', label: 'Net Amount (₹)', type: 'number', readOnly: true },
      { colNo: 12, key: 'targetDeliveryDate', label: 'Target Delivery Date', type: 'date' },
      { colNo: 13, key: 'linkedJobId', label: 'Linked Job / Prod ID' },
      { colNo: 14, key: 'dispatchedQty', label: 'Dispatched Qty', type: 'number', readOnly: true },
      { colNo: 15, key: 'invoicedQty', label: 'Invoiced Qty', type: 'number', readOnly: true },
      { colNo: 16, key: 'pendingQty', label: 'Pending Qty', type: 'number', readOnly: true },
      { colNo: 17, key: 'lineStatus', label: 'Line Status', type: 'select', options: ['Open', 'Partially Dispatched', 'Closed'] },
    ],
  },
};

// 2. Proforma Invoice (PI) Config
export const PROFORMA_INVOICE_CONFIG: SalesDocScreenConfig = {
  docType: 'proforma-invoice',
  title: 'Proforma Invoice',
  subtitle: 'Preliminary commercial document for advance payment, customer approval, or export documentation',
  columns: [
    { label: 'PI Number', field: 'docNo' },
    { label: 'SO Reference', field: 'salesOrderNumber' },
    { label: 'PI Date', field: 'date' },
    { label: 'Customer', field: 'customer' },
    { label: 'Customer PO', field: 'customerPoNumber' },
    { label: 'Total Amount', field: 'totalAmount', numeric: true },
    { label: 'Validity Date', field: 'validityDate' },
    { label: 'Status', field: 'status', badge: true },
  ],
  statusField: 'status',
  statusOptions: [...GENERIC_STATUSES, 'ISSUED', 'PARTIALLY_FULFILLED', 'COMPLETED', 'EXPIRED'],
  fields: [
    { key: 'docNo', label: '1. PI Number (Auto)', readOnly: true },
    { key: 'salesOrderNumber', label: '2. SO Number (Select Option) *', required: true },
    { key: 'date', label: '3. PI Date *', type: 'date', required: true },
    { key: 'customer', label: '4. Customer Name (Auto)', readOnly: true },
    { key: 'customerPoNumber', label: '5. Customer PO Number (Auto)', readOnly: true },
    { key: 'salesPerson', label: '6. Sales Person (Auto)', readOnly: true },
    { key: 'currency', label: '7. Currency', type: 'select', options: ['INR - Indian Rupee', 'USD - US Dollar', 'EUR - Euro'] },
    { key: 'paymentTerms', label: '8. Payment Terms' },
    { key: 'deliveryTerms', label: '9. Delivery Terms' },
    { key: 'validityDate', label: '10. Validity Date', type: 'date' },
    { key: 'expectedDeliveryDate', label: '11. Expected Delivery Date', type: 'date' },
    { key: 'billingAddress', label: '12. Billing Address', type: 'textarea', span2: true },
    { key: 'shippingAddress', label: '13. Shipping Address', type: 'textarea', span2: true },
    { key: 'remarks', label: '14. Remarks', type: 'textarea', span2: true },
  ],
  lines: {
    title: 'Proforma Invoice Line Items Grid',
    fields: [
      { colNo: 1, key: 'lineNo', label: 'Line #', readOnly: true },
      { colNo: 2, key: 'itemCode', label: 'Item Code / Name (Master Lookup)', type: 'lookup', required: true },
      { colNo: 3, key: 'description', label: 'Description' },
      { colNo: 4, key: 'qty', label: 'Quantity *', type: 'number', required: true },
      { colNo: 5, key: 'uom', label: 'UOM' },
      { colNo: 6, key: 'unitPrice', label: 'Unit Price (₹)', type: 'number' },
      { colNo: 7, key: 'taxCode', label: 'Tax Code', type: 'select', options: ['GST 18%', 'GST 28%', 'GST 12%', 'GST 5%', 'Exempt'] },
      { colNo: 8, key: 'taxAmount', label: 'Tax Amount (₹)', type: 'number', readOnly: true },
      { colNo: 9, key: 'netAmount', label: 'Total Amount (₹)', type: 'number', readOnly: true },
      { colNo: 10, key: 'lineRemark', label: 'Remark' },
    ],
  },
};

// 3. Sales Delivery Challan (DC) Config
export const SALES_DC_CONFIG: SalesDocScreenConfig = {
  docType: 'sales-dc',
  title: 'Sales Delivery Challan',
  subtitle: 'Dispatch document recording physical goods sent from facility to customer',
  columns: [
    { label: 'DC Number', field: 'docNo' },
    { label: 'SO Reference', field: 'salesOrderNumber' },
    { label: 'DC Date', field: 'date' },
    { label: 'Customer', field: 'customer' },
    { label: 'Vehicle No', field: 'vehicleNo' },
    { label: 'Transporter', field: 'transporter' },
    { label: 'Status', field: 'status', badge: true },
  ],
  statusField: 'status',
  statusOptions: [...GENERIC_STATUSES, 'READY_FOR_DISPATCH', 'DISPATCHED', 'DELIVERED', 'PARTIALLY_DISPATCHED'],
  fields: [
    { key: 'docNo', label: '1. DC Number (Auto)', readOnly: true },
    { key: 'salesInvoiceNumber', label: '2. Sales Invoice Number (Select Option)' },
    { key: 'salesOrderNumber', label: '3. SO Number (Select Option) *', required: true },
    { key: 'date', label: '4. DC Date *', type: 'date', required: true },
    { key: 'customer', label: '5. Customer Name (Auto)', readOnly: true },
    { key: 'customerCode', label: '6. Customer Code', readOnly: true },
    { key: 'customerPoNumber', label: '7. Customer PO Reference', readOnly: true },
    { key: 'piReference', label: '8. PI Reference' },
    { key: 'transporter', label: '9. Transporter Name' },
    { key: 'vehicleNo', label: '10. Vehicle Number' },
    { key: 'lrNumber', label: '11. LR / Docket Number' },
    { key: 'ewayBillReference', label: '12. E-Way Bill Number' },
    { key: 'gatePassNumber', label: '13. Gate Pass Number (Auto)', readOnly: true },
    { key: 'dispatchDate', label: '14. Dispatch Date', type: 'date' },
    { key: 'shippingAddress', label: '15. Shipping Address', type: 'textarea', span2: true },
    { key: 'remarks', label: '16. Remarks', type: 'textarea', span2: true },
  ],
  lines: {
    title: 'Sales DC Line Items Grid',
    fields: [
      { colNo: 1, key: 'lineNo', label: 'Line #', readOnly: true },
      { colNo: 2, key: 'itemCode', label: 'Item Code / Name (Master Lookup)', type: 'lookup', required: true },
      { colNo: 3, key: 'description', label: 'Description' },
      { colNo: 4, key: 'dispatchQty', label: 'Dispatch Quantity *', type: 'number', required: true },
      { colNo: 5, key: 'uom', label: 'UOM' },
      { colNo: 6, key: 'batchNumber', label: 'Batch Number' },
      { colNo: 7, key: 'lotNumber', label: 'Lot Number' },
      { colNo: 8, key: 'heatNumber', label: 'Heat Number' },
      { colNo: 9, key: 'serialNumber', label: 'Serial Number' },
      { colNo: 10, key: 'packingReference', label: 'Packing Reference' },
      { colNo: 11, key: 'qualityInspectionReference', label: 'Quality Inspection Ref' },
      { colNo: 12, key: 'lineRemark', label: 'Remarks' },
    ],
  },
};

// 4. Sales Invoice Config
export const SALES_INVOICE_CONFIG: SalesDocScreenConfig = {
  docType: 'sales-invoice',
  title: 'Sales Invoice',
  subtitle: 'Official billing document for goods dispatched to customer with tax and receivable tracking',
  columns: [
    { label: 'Invoice No', field: 'docNo' },
    { label: 'SO Ref', field: 'salesOrderNumber' },
    { label: 'Invoice Date', field: 'date' },
    { label: 'Customer', field: 'customer' },
    { label: 'Total Amount', field: 'totalAmount', numeric: true },
    { label: 'Tax Amount', field: 'taxAmount', numeric: true },
    { label: 'Status', field: 'status', badge: true },
  ],
  statusField: 'status',
  statusOptions: [...GENERIC_STATUSES, 'POSTED', 'PARTIALLY_PAID', 'PAID', 'ADJUSTMENT_REQUIRED'],
  fields: [
    { key: 'docNo', label: '1. Invoice Number (Auto)', readOnly: true },
    { key: 'salesOrderNumber', label: '2. SO Number (Select Option) *', required: true },
    { key: 'date', label: '3. Invoice Date *', type: 'date', required: true },
    { key: 'customer', label: '4. Customer Name (Auto)', readOnly: true },
    { key: 'customerPoNumber', label: '5. Customer PO Reference (Auto)', readOnly: true },
    { key: 'piNumber', label: '6. PI Number' },
    { key: 'customerGstin', label: '6a. Customer GSTIN' },
    { key: 'placeOfSupply', label: '6b. Place of Supply (State)' },
    { key: 'placeOfSupplyCode', label: '6c. Place of Supply Code (auto from GSTIN)' },
    { key: 'currency', label: '7. Currency', type: 'select', options: ['INR - Indian Rupee', 'USD - US Dollar', 'EUR - Euro'] },
    { key: 'paymentTerms', label: '8. Payment Terms' },
    { key: 'dueDate', label: '9. Payment Due Date (Auto)', type: 'date' },
    { key: 'transportDetails', label: '10. Transport Details', type: 'select', options: ['By Road', 'By Air', 'By Rail', 'By Courier'] },
    { key: 'vehicleNo', label: '10a. Vehicle Number' },
    { key: 'dateTimeOfSupply', label: '10b. Date & Time of Supply', type: 'datetime-local' },
    { key: 'billingAddress', label: '11. Billing Address', type: 'textarea', span2: true },
    { key: 'shippingAddress', label: '12. Shipping Address', type: 'textarea', span2: true },
    { key: 'remarks', label: '13. Remarks', type: 'textarea', span2: true },
    { key: 'irnNumber', label: 'E-Invoice IRN', readOnly: true },
    { key: 'ewayBillNo', label: 'E-Way Bill No', readOnly: true },
  ],
  lines: {
    title: 'Sales Invoice Line Items Grid',
    fields: [
      { colNo: 1, key: 'lineNo', label: 'Line #', readOnly: true },
      { colNo: 2, key: 'itemCode', label: 'Item Code / Name (Master Lookup)', type: 'lookup', required: true },
      { colNo: 3, key: 'description', label: 'Description' },
      { colNo: 4, key: 'batchHeatNumber', label: 'Batch / Heat Number' },
      { colNo: 5, key: 'billedQty', label: 'Billed Quantity *', type: 'number', required: true },
      { colNo: 6, key: 'uom', label: 'UOM' },
      { colNo: 7, key: 'unitPrice', label: 'Unit Price (₹)', type: 'number' },
      { colNo: 8, key: 'taxCode', label: 'Tax Code', type: 'select', options: ['GST 18%', 'GST 28%', 'GST 12%', 'GST 5%', 'Exempt'] },
      { colNo: 9, key: 'taxAmount', label: 'Tax Amount (₹)', type: 'number', readOnly: true },
      { colNo: 10, key: 'netAmount', label: 'Net Total (₹)', type: 'number', readOnly: true },
      { colNo: 11, key: 'hsnSnapshot', label: 'HSN (frozen at save)', readOnly: true },
    ],
  },
};

// 5. DC Return Config
export const DC_RETURN_CONFIG: SalesDocScreenConfig = {
  docType: 'dc-return',
  title: 'DC Return',
  subtitle: 'Customer return of goods originally dispatched through a Sales Delivery Challan',
  columns: [
    { label: 'Return Number', field: 'docNo' },
    { label: 'Return Date', field: 'date' },
    { label: 'Customer', field: 'customer' },
    { label: 'Original DC', field: 'originalDcNumber' },
    { label: 'SO Ref', field: 'salesOrderNumber' },
    { label: 'Reason', field: 'returnReason' },
    { label: 'Disposition', field: 'disposition', badge: true },
    { label: 'Status', field: 'status', badge: true },
  ],
  statusField: 'status',
  statusOptions: [...GENERIC_STATUSES, 'RECEIVED', 'INSPECTION_PENDING', 'DISPOSITIONED'],
  fields: [
    { key: 'docNo', label: '1. Return Number (Auto)', readOnly: true },
    { key: 'originalDcNumber', label: '2. Original DC Number (Select Option) *', required: true },
    { key: 'date', label: '3. Return Date *', type: 'date', required: true },
    { key: 'customer', label: '4. Customer (Auto)', readOnly: true },
    { key: 'originalDcDate', label: '5. Original DC Date', type: 'date', readOnly: true },
    { key: 'salesOrderNumber', label: '6. Sales Order Number (Auto)', readOnly: true },
    { key: 'customerPoNumber', label: '7. Customer PO Number (Auto)', readOnly: true },
    { key: 'returnReason', label: '8. Return Reason', type: 'textarea' },
    { key: 'customerRemarks', label: '9. Customer Remarks', type: 'textarea', span2: true },
    { key: 'transportDetails', label: '10. Transport Details' },
    { key: 'qualityInspectionReference', label: '11. Quality Inspection Ref' },
    { key: 'disposition', label: '12. Disposition', type: 'select', options: ['Return to Stock', 'Rework', 'Scrap', 'Refund'] },
  ],
  lines: {
    title: 'DC Return Line Items Grid',
    fields: [
      { colNo: 1, key: 'lineNo', label: 'Line #', readOnly: true },
      { colNo: 2, key: 'itemCode', label: 'Item Code / Name (Master Lookup)', type: 'lookup', required: true },
      { colNo: 3, key: 'description', label: 'Description' },
      { colNo: 4, key: 'batchNumber', label: 'Batch' },
      { colNo: 5, key: 'heatNumber', label: 'Heat' },
      { colNo: 6, key: 'serialNumber', label: 'Serial Number' },
      { colNo: 7, key: 'currentReturnQty', label: 'Returned Quantity *', type: 'number', required: true },
      { colNo: 8, key: 'acceptedQty', label: 'Accepted Qty (IQC)', type: 'number' },
      { colNo: 9, key: 'rejectedQty', label: 'Rejected Qty (IQC)', type: 'number' },
      { colNo: 10, key: 'disposition', label: 'Disposition', type: 'select', options: ['Return to Stock', 'Rework', 'Scrap', 'Refund'] },
      { colNo: 11, key: 'lineRemark', label: 'Remarks' },
    ],
  },
};

// 6. Invoice Return Config
export const INVOICE_RETURN_CONFIG: SalesDocScreenConfig = {
  docType: 'invoice-return',
  title: 'Invoice Return',
  subtitle: 'Customer return of goods already billed through a Sales Invoice with financial adjustment',
  columns: [
    { label: 'Return Number', field: 'docNo' },
    { label: 'Return Date', field: 'date' },
    { label: 'Customer', field: 'customer' },
    { label: 'Original Invoice', field: 'originalInvoiceNumber' },
    { label: 'SO Ref', field: 'salesOrderNumber' },
    { label: 'Reason', field: 'returnReason' },
    { label: 'Credit Note Ref', field: 'creditNoteReference' },
    { label: 'Status', field: 'status', badge: true },
  ],
  statusField: 'status',
  statusOptions: [...GENERIC_STATUSES, 'RECEIVED', 'INSPECTION_PENDING', 'POSTED'],
  fields: [
    { key: 'docNo', label: '1. Return Number (Auto)', readOnly: true },
    { key: 'originalInvoiceNumber', label: '2. Original Invoice Reference (Select Option) *', required: true },
    { key: 'date', label: '3. Return Date *', type: 'date', required: true },
    { key: 'returnType', label: '4. Return Type', type: 'select', options: ['Invoice Return'], readOnly: true },
    { key: 'originalInvoiceDate', label: '5. Original Invoice Date', type: 'date', readOnly: true },
    { key: 'salesOrderNumber', label: '6. Sales Order Reference (Auto)', readOnly: true },
    { key: 'customer', label: '7. Customer Name (Auto)', readOnly: true },
    { key: 'customerPoNumber', label: '8. Customer PO Reference (Auto)', readOnly: true },
    { key: 'currency', label: '9. Currency', type: 'select', options: ['INR - Indian Rupee', 'USD - US Dollar', 'EUR - Euro'] },
    { key: 'returnReason', label: '10. Return Reason', type: 'select', options: ['QUALITY_REJECTION', 'DIMENSIONAL_ISSUE', 'WRONG_ITEM', 'DAMAGED_IN_TRANSIT', 'OTHER'] },
    { key: 'customerRemarks', label: '11. Customer Remarks', type: 'textarea', span2: true },
    { key: 'transportDetails', label: '12. Transport Details' },
    { key: 'qualityInspectionReference', label: '13. Quality Inspection Ref' },
    { key: 'creditNoteReference', label: '14. Credit Note Reference (Auto)', readOnly: true },
    { key: 'status', label: '15. Status', type: 'select', options: ['Draft', 'Approved', 'Posted'], readOnly: true },
    { key: 'remarks', label: '16. Remarks', type: 'textarea', span2: true },
  ],
  lines: {
    title: 'Invoice Return Line Items Grid',
    fields: [
      { colNo: 1, key: 'lineNo', label: 'Line #', readOnly: true },
      { colNo: 2, key: 'itemCode', label: 'Item Code / Name (Master Lookup)', type: 'lookup', required: true },
      { colNo: 3, key: 'description', label: 'Description' },
      { colNo: 4, key: 'batchNumber', label: 'Batch' },
      { colNo: 5, key: 'heatNumber', label: 'Heat' },
      { colNo: 6, key: 'serialNumber', label: 'Serial Number' },
      { colNo: 7, key: 'currentReturnQty', label: 'Returned Quantity *', type: 'number', required: true },
      { colNo: 8, key: 'acceptedQty', label: 'Accepted Qty (IQC)', type: 'number' },
      { colNo: 9, key: 'rejectedQty', label: 'Rejected Qty (IQC)', type: 'number' },
      { colNo: 10, key: 'unitPrice', label: 'Unit Price (₹)', type: 'number' },
      { colNo: 11, key: 'taxCode', label: 'Tax Code', type: 'select', options: ['GST 18%', 'GST 28%', 'GST 12%', 'GST 5%', 'Exempt'] },
      { colNo: 12, key: 'taxAmount', label: 'Tax Amount (₹)', type: 'number', readOnly: true },
      { colNo: 13, key: 'netAmount', label: 'Line Total (₹)', type: 'number', readOnly: true },
      { colNo: 14, key: 'disposition', label: 'Disposition', type: 'select', options: ['Return to Stock', 'Rework', 'Scrap', 'Refund'] },
      { colNo: 15, key: 'lineRemark', label: 'Remarks' },
    ],
  },
};
