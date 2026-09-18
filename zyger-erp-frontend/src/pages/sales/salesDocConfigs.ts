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
  width?: string;
}

export interface SalesColumnDef {
  label: string;
  field: string;
  numeric?: boolean;
  money?: boolean;
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
    { label: 'Net Amount', field: 'netAmount', numeric: true },
    { label: 'Delivery Date', field: 'targetDeliveryDate' },
    { label: 'Status', field: 'status', badge: true },
  ],
  statusField: 'status',
  // Sales Order is Save-only (no submit/approve workflow) — status just tracks
  // whether the order is open, fully dispatched, or cancelled.
  statusOptions: ['DRAFT', 'CONFIRMED', 'PARTIALLY_DISPATCHED', 'DELIVERED', 'CANCELLED'],
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
      { colNo: 1, key: 'lineNo', label: 'Line #', readOnly: true, width: '55px' },
      { colNo: 2, key: 'itemCode', label: 'Item Code', type: 'lookup', required: true, width: '150px' },
      { colNo: 3, key: 'itemName', label: 'Item Name', width: '150px' },
      { colNo: 4, key: 'description', label: 'Description', width: '150px' },
      { colNo: 5, key: 'qty', label: 'Quantity *', type: 'number', required: true, width: '85px' },
      { colNo: 6, key: 'uom', label: 'UOM', width: '90px' },
      { colNo: 7, key: 'unitPrice', label: 'Unit Price (₹)', type: 'number', width: '100px' },
      { colNo: 8, key: 'discount', label: 'Discount %', type: 'number', width: '85px' },
      { colNo: 9, key: 'taxCode', label: 'Tax %', type: 'number', width: '105px' },
      { colNo: 10, key: 'taxAmount', label: 'Tax Amount (₹)', type: 'number', readOnly: true, width: '100px' },
      { colNo: 11, key: 'netAmount', label: 'Net Amount (₹)', type: 'number', readOnly: true, width: '100px' },
      { colNo: 12, key: 'linkedJobId', label: 'Linked Job / Prod ID', width: '120px' },
      { colNo: 13, key: 'dispatchedQty', label: 'Dispatched Qty', type: 'number', readOnly: true, width: '95px' },
      { colNo: 14, key: 'invoicedQty', label: 'Invoiced Qty', type: 'number', readOnly: true, width: '90px' },
      { colNo: 15, key: 'pendingQty', label: 'Pending Qty', type: 'number', readOnly: true, width: '90px' },
      { colNo: 16, key: 'lineStatus', label: 'Line Status', type: 'select', options: ['Open', 'Partially Dispatched', 'Closed'], width: '130px' },
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
    { label: 'Total Amount', field: 'netAmount', numeric: true },
    { label: 'Validity Date', field: 'validityDate' },
    { label: 'Status', field: 'status', badge: true },
  ],
  statusField: 'status',
  // Proforma Invoice is Save-only (no submit/approve workflow) — status just tracks
  // whether it's newly created, issued, fulfilled, expired, or cancelled.
  statusOptions: ['CREATED', 'ISSUED', 'PARTIALLY_FULFILLED', 'COMPLETED', 'EXPIRED', 'CANCELLED'],
  fields: [
    { key: 'docNo', label: 'PI Number (Auto)', readOnly: true },
    { key: 'salesOrderNumber', label: 'SO Number (Select Option) *', required: true },
    { key: 'date', label: 'PI Date *', type: 'date', required: true },
    { key: 'customer', label: 'Customer Name (Auto)', readOnly: true },
    { key: 'customerPoNumber', label: 'Customer PO Number (Auto)', readOnly: true },
    { key: 'salesPerson', label: 'Sales Person (Auto)', readOnly: true },
    { key: 'currency', label: 'Currency', type: 'select', options: ['INR - Indian Rupee', 'USD - US Dollar', 'EUR - Euro'] },
    { key: 'paymentTerms', label: 'Payment Terms' },
    { key: 'deliveryTerms', label: 'Delivery Terms' },
    { key: 'validityDate', label: 'Validity Date', type: 'date' },
    { key: 'expectedDeliveryDate', label: 'Expected Delivery Date', type: 'date' },
    { key: 'billingAddress', label: 'Billing Address', type: 'textarea', span2: true },
    { key: 'shippingAddress', label: 'Shipping Address', type: 'textarea', span2: true },
    { key: 'remarks', label: 'Remarks', type: 'textarea', span2: true },
  ],
  lines: {
    title: 'Proforma Invoice Line Items Grid',
    fields: [
      { colNo: 1, key: 'lineNo', label: 'Line #', readOnly: true, width: '55px' },
      { colNo: 2, key: 'itemCode', label: 'Item Code', type: 'lookup', required: true, width: '150px' },
      { colNo: 3, key: 'itemName', label: 'Item Name', width: '150px' },
      { colNo: 4, key: 'description', label: 'Description', width: '150px' },
      { colNo: 5, key: 'qty', label: 'Quantity *', type: 'number', required: true, width: '85px' },
      { colNo: 6, key: 'uom', label: 'UOM', width: '90px' },
      { colNo: 7, key: 'unitPrice', label: 'Unit Price (₹)', type: 'number', width: '100px' },
      { colNo: 8, key: 'taxCode', label: 'Tax %', type: 'number', width: '105px' },
      { colNo: 9, key: 'taxAmount', label: 'Tax Amount (₹)', type: 'number', readOnly: true, width: '100px' },
      { colNo: 10, key: 'netAmount', label: 'Total Amount (₹)', type: 'number', readOnly: true, width: '110px' },
      { colNo: 11, key: 'lineRemark', label: 'Remark', width: '120px' },
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
    { key: 'docNo', label: 'DC Number (Auto)', readOnly: true },
    { key: 'salesOrderNumber', label: 'SO Number (Select Option) *', required: true },
    { key: 'sourceLocation', label: 'Source Location (Select Option) *', required: true },
    { key: 'date', label: 'DC Date *', type: 'date', required: true },
    { key: 'customer', label: 'Customer Name (Auto)', readOnly: true },
    { key: 'customerCode', label: 'Customer Code', readOnly: true },
    { key: 'customerPoNumber', label: 'Customer PO Reference', readOnly: true },
    { key: 'piReference', label: 'PI Reference' },
    { key: 'transporter', label: 'Transporter Name' },
    { key: 'vehicleNo', label: 'Vehicle Number' },
    { key: 'lrNumber', label: 'LR / Docket Number' },
    { key: 'ewayBillReference', label: 'E-Way Bill Number' },
    { key: 'gatePassNumber', label: 'Gate Pass Number (Auto)', readOnly: true },
    { key: 'dispatchDate', label: 'Dispatch Date', type: 'date' },
    { key: 'shippingAddress', label: 'Shipping Address', type: 'textarea', span2: true },
    { key: 'remarks', label: 'Remarks', type: 'textarea', span2: true },
  ],
  lines: {
    title: 'Sales DC Line Items Grid',
    fields: [
      { colNo: 1, key: 'lineNo', label: 'Line #', readOnly: true, width: '55px' },
      { colNo: 2, key: 'itemCode', label: 'Item Code', type: 'lookup', required: true, width: '150px' },
      { colNo: 3, key: 'itemName', label: 'Item Name', width: '150px' },
      { colNo: 4, key: 'description', label: 'Description', width: '140px' },
      { colNo: 5, key: 'dispatchQty', label: 'Dispatch Quantity *', type: 'number', required: true, width: '95px' },
      { colNo: 6, key: 'uom', label: 'UOM', width: '90px' },
      { colNo: 7, key: 'batchNumber', label: 'Batch Number', width: '100px' },
      { colNo: 8, key: 'lotNumber', label: 'Lot Number', width: '100px' },
      { colNo: 9, key: 'heatNumber', label: 'Heat Number', width: '100px' },
      { colNo: 10, key: 'serialNumber', label: 'Serial Number', width: '100px' },
      { colNo: 11, key: 'packingReference', label: 'Packing Reference', width: '120px' },
      { colNo: 12, key: 'qualityInspectionReference', label: 'Quality Inspection Ref', width: '130px' },
      { colNo: 13, key: 'lineRemark', label: 'Remarks', width: '110px' },
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
    { label: 'Total Amount', field: 'netAmount', money: true },
    { label: 'Status', field: 'status', badge: true },
  ],
  statusField: 'status',
  statusOptions: [...GENERIC_STATUSES, 'POSTED', 'PARTIALLY_PAID', 'PAID', 'ADJUSTMENT_REQUIRED'],
  fields: [
    { key: 'docNo', label: 'Invoice Number (Auto)', readOnly: true },
    { key: 'salesDcNumber', label: 'Sales DC Number (Select Option)' },
    { key: 'salesOrderNumber', label: 'SO Number (Select Option) *', required: true },
    { key: 'date', label: 'Invoice Date *', type: 'date', required: true },
    { key: 'customer', label: 'Customer Name (Auto)', readOnly: true },
    { key: 'customerPoNumber', label: 'Customer PO Reference (Auto)', readOnly: true },
    { key: 'piNumber', label: 'PI Number' },
    { key: 'customerGstin', label: 'Customer GSTIN' },
    { key: 'placeOfSupply', label: 'Place of Supply (State)' },
    { key: 'placeOfSupplyCode', label: 'Place of Supply Code (auto from GSTIN)' },
    { key: 'currency', label: 'Currency', type: 'select', options: ['INR - Indian Rupee', 'USD - US Dollar', 'EUR - Euro'] },
    { key: 'paymentTerms', label: 'Payment Terms' },
    { key: 'dueDate', label: 'Payment Due Date (Auto)', type: 'date' },
    { key: 'transportDetails', label: 'Transport Details', type: 'select', options: ['By Road', 'By Air', 'By Rail', 'By Courier'] },
    { key: 'vehicleNo', label: 'Vehicle Number' },
    { key: 'dateTimeOfSupply', label: 'Date & Time of Supply', type: 'datetime-local' },
    { key: 'billingAddress', label: 'Billing Address', type: 'textarea', span2: true },
    { key: 'shippingAddress', label: 'Shipping Address', type: 'textarea', span2: true },
    { key: 'remarks', label: 'Remarks', type: 'textarea', span2: true },
    { key: 'irnNumber', label: 'E-Invoice IRN', readOnly: true },
    { key: 'ewayBillNo', label: 'E-Way Bill No', readOnly: true },
  ],
  lines: {
    title: 'Sales Invoice Line Items Grid',
    fields: [
      { colNo: 1, key: 'lineNo', label: 'Line #', readOnly: true, width: '55px' },
      { colNo: 2, key: 'itemCode', label: 'Item Code', type: 'lookup', required: true, width: '150px' },
      { colNo: 3, key: 'description', label: 'Description (Item Name)', width: '170px' },
      { colNo: 5, key: 'batchHeatNumber', label: 'Batch / Heat Number', width: '120px' },
      { colNo: 6, key: 'billedQty', label: 'Billed Quantity *', type: 'number', required: true, width: '95px' },
      { colNo: 7, key: 'uom', label: 'UOM', width: '90px' },
      { colNo: 8, key: 'unitPrice', label: 'Unit Price (₹)', type: 'number', width: '100px' },
      { colNo: 9, key: 'taxCode', label: 'Tax Code', type: 'select', options: ['GST 18%', 'GST 28%', 'GST 12%', 'GST 5%', 'Exempt'], width: '105px' },
      { colNo: 10, key: 'taxAmount', label: 'Tax Amount (₹)', type: 'number', readOnly: true, width: '100px' },
      { colNo: 11, key: 'netAmount', label: 'Net Total (₹)', type: 'number', readOnly: true, width: '100px' },
      { colNo: 12, key: 'hsnSnapshot', label: 'HSN (frozen at save)', readOnly: true, width: '110px' },
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
    { key: 'docNo', label: 'Return Number (Auto)', readOnly: true },
    { key: 'originalDcNumber', label: 'Original DC Number (Select Option) *', required: true },
    { key: 'date', label: 'Return Date *', type: 'date', required: true },
    { key: 'customer', label: 'Customer (Auto)', readOnly: true },
    { key: 'originalDcDate', label: 'Original DC Date', type: 'date', readOnly: true },
    { key: 'salesOrderNumber', label: 'Sales Order Number (Auto)', readOnly: true },
    { key: 'customerPoNumber', label: 'Customer PO Number (Auto)', readOnly: true },
    { key: 'returnReason', label: 'Return Reason', type: 'textarea' },
    { key: 'customerRemarks', label: 'Customer Remarks', type: 'textarea', span2: true },
    { key: 'transportDetails', label: 'Transport Details' },
    { key: 'qualityInspectionReference', label: 'Quality Inspection Ref' },
    { key: 'disposition', label: 'Disposition', type: 'select', options: ['Return to Stock', 'Rework', 'Scrap', 'Refund'] },
  ],
  lines: {
    title: 'DC Return Line Items Grid',
    fields: [
      { colNo: 1, key: 'lineNo', label: 'Line #', readOnly: true, width: '55px' },
      { colNo: 2, key: 'itemCode', label: 'Item Code', type: 'lookup', required: true, width: '150px' },
      { colNo: 3, key: 'itemName', label: 'Item Name', width: '150px' },
      { colNo: 4, key: 'description', label: 'Description', width: '140px' },
      { colNo: 5, key: 'batchNumber', label: 'Batch', width: '90px' },
      { colNo: 6, key: 'heatNumber', label: 'Heat', width: '90px' },
      { colNo: 7, key: 'serialNumber', label: 'Serial Number', width: '110px' },
      { colNo: 8, key: 'currentReturnQty', label: 'Returned Quantity *', type: 'number', required: true, width: '100px' },
      { colNo: 9, key: 'acceptedQty', label: 'Accepted Qty (IQC)', type: 'number', width: '100px' },
      { colNo: 10, key: 'rejectedQty', label: 'Rejected Qty (IQC)', type: 'number', width: '100px' },
      { colNo: 11, key: 'disposition', label: 'Disposition', type: 'select', options: ['Return to Stock', 'Rework', 'Scrap', 'Refund'], width: '130px' },
      { colNo: 12, key: 'lineRemark', label: 'Remarks', width: '110px' },
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
    { key: 'docNo', label: 'Return Number (Auto)', readOnly: true },
    { key: 'originalInvoiceNumber', label: 'Original Invoice Reference (Select Option) *', required: true },
    { key: 'date', label: 'Return Date *', type: 'date', required: true },
    { key: 'returnType', label: 'Return Type', type: 'select', options: ['Invoice Return'], readOnly: true },
    { key: 'originalInvoiceDate', label: 'Original Invoice Date', type: 'date', readOnly: true },
    { key: 'salesOrderNumber', label: 'Sales Order Reference (Auto)', readOnly: true },
    { key: 'customer', label: 'Customer Name (Auto)', readOnly: true },
    { key: 'customerPoNumber', label: 'Customer PO Reference (Auto)', readOnly: true },
    { key: 'currency', label: 'Currency', type: 'select', options: ['INR - Indian Rupee', 'USD - US Dollar', 'EUR - Euro'] },
    { key: 'returnReason', label: 'Return Reason', type: 'select', options: ['QUALITY_REJECTION', 'DIMENSIONAL_ISSUE', 'WRONG_ITEM', 'DAMAGED_IN_TRANSIT', 'OTHER'] },
    { key: 'customerRemarks', label: 'Customer Remarks', type: 'textarea', span2: true },
    { key: 'transportDetails', label: 'Transport Details' },
    { key: 'qualityInspectionReference', label: 'Quality Inspection Ref' },
    { key: 'creditNoteReference', label: 'Credit Note Reference (Auto)', readOnly: true },
    { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Approved', 'Posted'], readOnly: true },
    { key: 'remarks', label: 'Remarks', type: 'textarea', span2: true },
  ],
  lines: {
    title: 'Invoice Return Line Items Grid',
    fields: [
      { colNo: 1, key: 'lineNo', label: 'Line #', readOnly: true, width: '55px' },
      { colNo: 2, key: 'itemCode', label: 'Item Code', type: 'lookup', required: true, width: '150px' },
      { colNo: 3, key: 'itemName', label: 'Item Name', width: '150px' },
      { colNo: 4, key: 'description', label: 'Description', width: '140px' },
      { colNo: 5, key: 'batchNumber', label: 'Batch', width: '90px' },
      { colNo: 6, key: 'heatNumber', label: 'Heat', width: '90px' },
      { colNo: 7, key: 'serialNumber', label: 'Serial Number', width: '110px' },
      { colNo: 8, key: 'currentReturnQty', label: 'Returned Quantity *', type: 'number', required: true, width: '100px' },
      { colNo: 9, key: 'acceptedQty', label: 'Accepted Qty (IQC)', type: 'number', width: '100px' },
      { colNo: 10, key: 'rejectedQty', label: 'Rejected Qty (IQC)', type: 'number', width: '100px' },
      { colNo: 11, key: 'unitPrice', label: 'Unit Price (₹)', type: 'number', width: '100px' },
      { colNo: 12, key: 'taxCode', label: 'Tax Code', type: 'select', options: ['GST 18%', 'GST 28%', 'GST 12%', 'GST 5%', 'Exempt'], width: '105px' },
      { colNo: 13, key: 'taxAmount', label: 'Tax Amount (₹)', type: 'number', readOnly: true, width: '100px' },
      { colNo: 14, key: 'netAmount', label: 'Line Total (₹)', type: 'number', readOnly: true, width: '100px' },
      { colNo: 15, key: 'disposition', label: 'Disposition', type: 'select', options: ['Return to Stock', 'Rework', 'Scrap', 'Refund'], width: '130px' },
      { colNo: 16, key: 'lineRemark', label: 'Remarks', width: '110px' },
    ],
  },
};
