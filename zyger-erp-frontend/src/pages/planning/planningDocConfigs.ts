export interface LookupDef {
  api: string;
  valueKey: string;
  labelKeys?: string[];
  separator?: string;
  /** UI-only control — its value is never sent in the payload. */
  ephemeral?: boolean;
  /** Only shown while creating a new document, hidden when editing an existing one. */
  addOnly?: boolean;
}

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea';
  options?: string[];
  optionLabels?: Record<string, string>;
  required?: boolean;
  span2?: boolean;
  readonly?: boolean;
  lookup?: LookupDef;
  /** Field must hold a value (e.g. Item Type) before this field can be edited. */
  enableField?: string;
}

export interface LineFieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select';
  options?: string[];
  readonly?: boolean;
  required?: boolean;
  width?: string;
}

export interface ColumnDef {
  label: string;
  field: string;
  numeric?: boolean;
}

export interface ChildGridConfig {
  title: string;
  parentIdField: string;
  apiPath: string;
  fields: LineFieldDef[];
}

export interface DocScreenConfig {
  docType: string;
  title: string;
  subtitle: string;
  addButtonLabel?: string;
  columns: ColumnDef[];
  statusField: string;
  statusOptions: string[];
  typeFilter?: { field: string; label: string; options: string[] };
  fields: FieldDef[];
  lines?: {
    title: string;
    fields: LineFieldDef[];
    seed?: Record<string, string>[];
  };
  childGrids?: ChildGridConfig[];
  includeInactive?: boolean;
}

export const PRODUCTION_BOM_FRESH_CONFIG: DocScreenConfig = {
  docType: 'production-bom',
  title: 'Production BOM',
  subtitle: 'Bill of materials for shop-floor planning',
  addButtonLabel: 'Add Production BOM',
  columns: [
    { label: 'Doc No', field: 'docNo' },
    { label: 'Date', field: 'date' },
    { label: 'Item', field: 'itemCode' },
    { label: 'Revision', field: 'revisionLabel' },
    { label: 'Version', field: 'bomVersion' },
    { label: 'Type', field: 'itemType' },
  ],
  statusField: 'status',
  statusOptions: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'],
  fields: [
    {
      key: 'salesOrderId',
      label: 'Sales Order',
      type: 'number',
      lookup: {
        api: '/v1/sales/sales-order',
        valueKey: 'id',
        labelKeys: ['docNo', 'customer'],
        separator: ' — ',
      },
    },
    {
      key: 'copyBomCode',
      label: 'Copy BOM Item',
      lookup: {
        api: '/master/bom-mappings',
        valueKey: 'id',
        labelKeys: ['code', 'name'],
        separator: ' — ',
        ephemeral: true,
        addOnly: true,
      },
    },
    {
      key: 'itemType',
      label: 'Item Type',
      type: 'select',
      options: ['FG', 'SEMI_FG'],
      optionLabels: { FG: 'Finished Goods (FG)', SEMI_FG: 'Semi Finished Goods (Semi FG)' },
      required: true,
    },
    { key: 'itemCode', label: 'BOM Item', type: 'select', required: true, enableField: 'itemType' },
    { key: 'baseQuantity', label: 'Quantity', type: 'number', required: true },
    { key: 'weight', label: 'Weight', type: 'number', readonly: true },
    { key: 'specifications', label: 'Specifications', type: 'textarea', span2: true },
    { key: 'remarks', label: 'Remarks', type: 'textarea', span2: true },
  ],
  lines: {
    title: 'Components',
    fields: [
      { key: 'bomLevel', label: 'Level', type: 'text', width: '70px' },
      { key: 'componentItemCode', label: 'Component Item (Code / Name) *', type: 'text', required: true, width: '220px' },
      { key: 'quantityPer', label: 'Quantity *', type: 'number', required: true, width: '90px' },
      { key: 'weightPerQty', label: 'Weight/Unit', type: 'number', width: '100px' },
      { key: 'totalWeight', label: 'Total Weight', type: 'number', width: '100px' },
      { key: 'remarks', label: 'Remarks', type: 'text', width: '130px' },
    ],
  },
};

export const PRODUCTION_BOM_CONFIG: DocScreenConfig = {
  docType: 'production-bom',
  title: 'Production BOM',
  subtitle: 'Bill of Materials with multi-level sub-assembly support',
  columns: [
    { label: 'Doc No', field: 'docNo' },
    { label: 'Date', field: 'date' },
    { label: 'Item', field: 'itemCode' },
    { label: 'Revision', field: 'itemRevision' },
    { label: 'Version', field: 'bomVersion' },
    { label: 'Type', field: 'itemType' },
  ],
  statusField: 'status',
  statusOptions: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'],
  fields: [
    { key: 'itemCode', label: 'Item Code *', type: 'text', required: true },
    { key: 'itemRevision', label: 'Revision', type: 'text', readonly: true },
    { key: 'revisionLabel', label: 'Revision Label', type: 'text', readonly: true },
    { key: 'bomVersion', label: 'Version', type: 'text' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['FG', 'SEMI_FG', 'RM'], readonly: true },
    { key: 'bomType', label: 'BOM Type', type: 'select', options: ['Primary', 'Alternate'] },
    { key: 'salesOrderId', label: 'Sales Order ID', type: 'number' },
    { key: 'baseQuantity', label: 'Base Quantity', type: 'number' },
    { key: 'baseUom', label: 'UOM', type: 'text' },
    { key: 'weight', label: 'Total Weight (kg)', type: 'number' },
    { key: 'effectiveFrom', label: 'Effective From', type: 'date' },
    { key: 'effectiveTo', label: 'Effective To', type: 'date' },
    { key: 'previousRevisionId', label: 'Previous Revision BOM ID', type: 'number' },
    { key: 'parentBomId', label: 'Parent BOM ID', type: 'number' },
    { key: 'approvedBy', label: 'Approved By', type: 'text' },
    { key: 'releaseDate', label: 'Release Date', type: 'date' },
    { key: 'obsoleteDate', label: 'Obsolete Date', type: 'date' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', span2: true },
  ],
  lines: {
    title: 'BOM Components',
    fields: [
      { key: 'bomLevel', label: 'Level', type: 'text', width: '70px' },
      { key: 'componentItemCode', label: 'Component Item (Code / Name) *', type: 'text', required: true, width: '220px' },
      { key: 'quantityPer', label: 'Quantity *', type: 'number', required: true, width: '90px' },
      { key: 'weightPerQty', label: 'Weight/Unit', type: 'number', width: '100px' },
      { key: 'totalWeight', label: 'Total Weight', type: 'number', width: '100px' },
      { key: 'remarks', label: 'Remarks', type: 'text', width: '130px' },
    ],
  },
};

export const ROUTE_SHEET_CONFIG: DocScreenConfig = {
  docType: 'route-sheet',
  title: 'Route Sheet',
  subtitle: 'Manufacturing operations sequence with work center assignments',
  columns: [
    { label: 'Doc No', field: 'docNo' },
    { label: 'Date', field: 'date' },
    { label: 'Item', field: 'itemCode' },
    { label: 'Type', field: 'itemType' },
    { label: 'Revision', field: 'itemRevision' },
    { label: 'Status', field: 'status' },
  ],
  statusField: 'status',
  statusOptions: ['DRAFT', 'RELEASED', 'UNDER_REVISION', 'OBSOLETE'],
  fields: [
    { key: 'itemCode', label: 'Item *', type: 'text', required: true },
    { key: 'itemType', label: 'Item Type', type: 'text', readonly: true },
    { key: 'itemRevision', label: 'Revision *', type: 'text', required: true },
    { key: 'status', label: 'Status', type: 'select', options: ['DRAFT', 'RELEASED', 'UNDER_REVISION', 'OBSOLETE'], readonly: true },
    { key: 'remarks', label: 'Remarks', type: 'textarea', span2: true },
  ],
  lines: {
    title: 'Operations',
    fields: [
      { key: 'sequenceNo', label: 'Seq # *', type: 'number', required: true, width: '75px' },
      { key: 'processId', label: 'Process *', type: 'text', required: true, width: '170px' },
      { key: 'processCode', label: 'Process Code', type: 'text', readonly: true, width: '110px' },
      { key: 'resourceId', label: 'Resource', type: 'text', width: '170px' },
      { key: 'resourceType', label: 'Resource Type', type: 'text', readonly: true, width: '110px' },
      { key: 'processType', label: 'Process Type', type: 'text', readonly: true, width: '110px' },
      { key: 'setupTime', label: 'Setup (min) *', type: 'number', required: true, width: '95px' },
      { key: 'cycleTime', label: 'Cycle (min) *', type: 'number', required: true, width: '95px' },
      { key: 'inspectionRequired', label: 'QC Required *', type: 'select', options: ['Yes', 'No'], required: true, width: '110px' },
      { key: 'remarks', label: 'Remarks', type: 'text', width: '130px' },
    ],
  },
};

export const WORK_ORDER_CONFIG: DocScreenConfig = {
  docType: 'work-order',
  title: 'Work Order',
  subtitle: 'Production work order with operation tracking and material requirements',
  columns: [
    { label: 'WO No', field: 'woNumber' },
    { label: 'Date', field: 'date' },
    { label: 'SO No', field: 'salesOrderNo' },
    { label: 'Item', field: 'itemCode' },
    { label: 'Production Qty', field: 'productionQty', numeric: true },
    { label: 'Completed Qty', field: 'completedQty', numeric: true },
    { label: 'Balance Qty', field: 'balanceQty', numeric: true },
    { label: 'Priority', field: 'priority' },
    { label: 'Planned End', field: 'plannedEndDate' },
    { label: 'Status', field: 'status' },
  ],
  statusField: 'status',
  statusOptions: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PROCESS', 'ON_HOLD', 'COMPLETED', 'CLOSED', 'CANCELLED', 'REJECTED'],
  fields: [
    { key: 'itemCode', label: 'Item Code *', type: 'text', required: true },
    { key: 'itemDescription', label: 'Item Description', type: 'text', readonly: true },
    { key: 'itemRevision', label: 'Revision', type: 'text', readonly: true },
    { key: 'drawingNumber', label: 'Drawing No', type: 'text', readonly: true },
    { key: 'drawingRev', label: 'Drawing Rev', type: 'text', readonly: true },
    { key: 'orderQuantity', label: 'Order Quantity *', type: 'number', required: true },
    { key: 'productionQty', label: 'Production Qty', type: 'number' },
    { key: 'releasedQty', label: 'Released Qty', type: 'number' },
    { key: 'completedQty', label: 'Completed Qty', type: 'number' },
    { key: 'rejectedQty', label: 'Rejected Qty', type: 'number' },
    { key: 'scrapQty', label: 'Scrap Qty', type: 'number' },
    { key: 'balanceQty', label: 'Balance Qty', type: 'number' },
    { key: 'pendingQty', label: 'Pending Qty', type: 'number', readonly: true },
    { key: 'fgReceiptQty', label: 'FG Receipt Qty', type: 'number' },
    { key: 'scrapAllowancePercent', label: 'Scrap Allowance %', type: 'number' },
    { key: 'uom', label: 'UOM', type: 'text' },
    { key: 'woType', label: 'WO Type', type: 'select', options: ['Production', 'Rework', 'Trial', 'Sample', 'Internal', 'Subcontract'] },
    { key: 'priority', label: 'Priority', type: 'select', options: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
    { key: 'dueDate', label: 'Due Date *', type: 'date', required: true },
    { key: 'plannedStartDate', label: 'Planned Start *', type: 'date', required: true },
    { key: 'plannedEndDate', label: 'Planned End *', type: 'date', required: true },
    { key: 'actualStartDate', label: 'Actual Start', type: 'date' },
    { key: 'actualEndDate', label: 'Actual End', type: 'date' },
    { key: 'promisedDeliveryDate', label: 'Promised Delivery', type: 'date' },
    { key: 'batchLotNo', label: 'Batch/Lot No', type: 'text' },
    { key: 'bomId', label: 'BOM ID', type: 'select', options: [] },
    { key: 'bomRevision', label: 'BOM Revision', type: 'text' },
    { key: 'routeId', label: 'Route ID', type: 'select', options: [] },
    { key: 'routeRevision', label: 'Route Revision', type: 'text' },
    { key: 'plant', label: 'Plant', type: 'text' },
    { key: 'productionLine', label: 'Production Line', type: 'text' },
    { key: 'productionDepartment', label: 'Production Dept', type: 'text' },
    { key: 'customerCode', label: 'Customer', type: 'text' },
    { key: 'customerOrderNo', label: 'Customer Order No', type: 'text' },
    { key: 'sourceType', label: 'Source Type', type: 'select', options: ['Manual', 'Sales Order', 'Forecast'] },
    { key: 'sourceDocNo', label: 'Source Doc No', type: 'text' },
    { key: 'salesOrderId', label: 'Sales Order ID', type: 'number' },
    { key: 'salesOrderNo', label: 'Sales Order No', type: 'text' },
    { key: 'soLineId', label: 'SO Line ID', type: 'number' },
    { key: 'approvedBy', label: 'Approved By', type: 'text' },
    { key: 'releasedBy', label: 'Released By', type: 'text' },
    { key: 'startedBy', label: 'Started By', type: 'text' },
    { key: 'completedBy', label: 'Completed By', type: 'text' },
    { key: 'closedBy', label: 'Closed By', type: 'text' },
    { key: 'cancelReason', label: 'Cancel Reason', type: 'textarea' },
    { key: 'holdReason', label: 'Hold Reason', type: 'textarea' },
    { key: 'shortCloseReason', label: 'Short Close Reason', type: 'textarea' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', span2: true },
  ],
  lines: {
    title: 'Operations',
    fields: [
      { key: 'operationSequence', label: 'Seq # *', type: 'number', width: '75px' },
      { key: 'operationCode', label: 'Operation', type: 'text', width: '110px' },
      { key: 'operationDescription', label: 'Description', type: 'text', width: '140px' },
      { key: 'workCenterCode', label: 'Work Center', type: 'text', width: '110px' },
      { key: 'machineCode', label: 'Machine', type: 'text', width: '100px' },
      { key: 'plannedQuantity', label: 'Planned Qty', type: 'number', width: '95px' },
      { key: 'completedQuantity', label: 'Completed Qty', type: 'number', width: '100px' },
      { key: 'goodQuantity', label: 'Good Qty', type: 'number', width: '90px' },
      { key: 'scrapQuantity', label: 'Scrap Qty', type: 'number', width: '90px' },
      { key: 'reworkQuantity', label: 'Rework Qty', type: 'number', width: '95px' },
      { key: 'setupTimePlanned', label: 'Setup Planned', type: 'number', width: '100px' },
      { key: 'setupTimeActual', label: 'Setup Actual', type: 'number', width: '95px' },
      { key: 'cycleTimePlanned', label: 'Cycle Planned', type: 'number', width: '100px' },
      { key: 'cycleTimeActual', label: 'Cycle Actual', type: 'number', width: '95px' },
      { key: 'operator', label: 'Operator', type: 'text', width: '100px' },
      { key: 'ncProgramReference', label: 'NC Program', type: 'text', width: '110px' },
      { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'In Progress', 'Completed', 'On Hold'], width: '120px' },
      { key: 'remarks', label: 'Remarks', type: 'text', width: '120px' },
    ],
  },
};

export interface MaterialLineDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select';
  options?: string[];
  readonly?: boolean;
}

export interface WorkOrderConfig extends DocScreenConfig {
  materialLines: {
    title: string;
    fields: MaterialLineDef[];
  };
}

export const WORK_ORDER_MATERIAL_FIELDS: MaterialLineDef[] = [
  { key: 'lineNo', label: 'Line #', type: 'number' },
  { key: 'componentItemCode', label: 'Component Item *', type: 'text' },
  { key: 'componentRevision', label: 'Revision', type: 'text' },
  { key: 'description', label: 'Description', type: 'text' },
  { key: 'uom', label: 'UOM', type: 'text' },
  { key: 'requiredQuantity', label: 'Required Qty', type: 'number' },
  { key: 'issuedQuantity', label: 'Issued Qty', type: 'number' },
  { key: 'balanceQty', label: 'Balance Qty', type: 'number' },
  { key: 'returnedQuantity', label: 'Returned Qty', type: 'number' },
  { key: 'shortageQuantity', label: 'Shortage', type: 'number' },
  { key: 'requiredDate', label: 'Required Date', type: 'date' },
  { key: 'issueMethod', label: 'Issue Method', type: 'select', options: ['Manual', 'Backflush', 'Auto'] },
  { key: 'batchNumber', label: 'Batch No', type: 'text' },
  { key: 'warehouse', label: 'Warehouse', type: 'text' },
  { key: 'reservationStatus', label: 'Reservation', type: 'select', options: ['None', 'Reserved', 'Partial'] },
  { key: 'issueStatus', label: 'Issue Status', type: 'select', options: ['Pending', 'Issued', 'Partial'] },
  { key: 'remarks', label: 'Remarks', type: 'text' },
];

export const SHOP_FLOOR_ENTRY_CONFIG: DocScreenConfig = {
  docType: 'shop-floor-entry',
  title: 'Shop Floor Entry',
  subtitle: 'Record operator activity, machine time, and production quantities',
  columns: [
    { label: 'Doc No', field: 'docNo' },
    { label: 'Date', field: 'date' },
    { label: 'Work Order', field: 'workOrderNo' },
    { label: 'Operation', field: 'operationCode' },
    { label: 'Operator', field: 'operatorCode' },
    { label: 'Good Qty', field: 'goodQuantity', numeric: true },
    { label: 'Status', field: 'status' },
  ],
  statusField: 'status',
  statusOptions: ['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED'],
  fields: [
    { key: 'workOrderNo', label: 'Work Order No *', type: 'text', required: true },
    { key: 'operationSequence', label: 'Operation Seq', type: 'number' },
    { key: 'operationCode', label: 'Operation Code', type: 'text' },
    { key: 'operatorCode', label: 'Operator *', type: 'text', required: true },
    { key: 'machineCode', label: 'Machine', type: 'text' },
    { key: 'startTime', label: 'Start Time', type: 'date' },
    { key: 'endTime', label: 'End Time', type: 'date' },
    { key: 'goodQuantity', label: 'Good Quantity', type: 'number' },
    { key: 'scrapQuantity', label: 'Scrap Quantity', type: 'number' },
    { key: 'reworkQuantity', label: 'Rework Quantity', type: 'number' },
    { key: 'inspectionResult', label: 'Inspection Result', type: 'select', options: ['PASS', 'FAIL', 'HOLD', 'PENDING'] },
    { key: 'remarks', label: 'Remarks', type: 'textarea', span2: true },
  ],
};
