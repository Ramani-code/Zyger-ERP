export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea';
  options?: string[];
  required?: boolean;
  span2?: boolean;
}

export interface LineFieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select';
  options?: string[];
  readonly?: boolean;
  width?: string;
}

export interface ColumnDef {
  label: string;
  field: string;
  numeric?: boolean;
}

export interface DocScreenConfig {
  docType: string;
  title: string;
  subtitle: string;
  columns: ColumnDef[];
  statusField: string;
  statusOptions: string[];
  typeFilter?: { field: string; label: string; options: string[] };
  fields: FieldDef[];
  lines?: { title: string; fields: LineFieldDef[]; seed?: Record<string, string>[] };
}

const GENERIC_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'];

export const NCR_CONFIG: DocScreenConfig = {
  docType: 'quality-ncr',
  title: 'Non-Conformance Report (NCR)',
  subtitle: 'Identify, document and disposition non-conforming material or processes',
  columns: [
    { label: 'Doc No', field: 'docNo' },
    { label: 'Date', field: 'date' },
    { label: 'Item', field: 'itemCode' },
    { label: 'Machine', field: 'machine' },
    { label: 'Party', field: 'partyName' },
    { label: 'Defect', field: 'defectCode' },
    { label: 'Severity', field: 'severity' },
    { label: 'Qty Affected', field: 'quantityAffected', numeric: true },
    { label: 'Disposition', field: 'dispositionType' },
    { label: 'Status', field: 'status' },
  ],
  statusField: 'status',
  statusOptions: GENERIC_STATUSES,
  fields: [
    { key: 'referenceDocNo', label: 'Reference Doc No (GRN / Inward / WO / JO)' },
    { key: 'inspectionId', label: 'Inspection ID', type: 'number' },
    { key: 'itemCode', label: 'Item Code *', required: true },
    { key: 'itemDescription', label: 'Item Description' },
    { key: 'machine', label: 'CNC Machine / Equipment ID' },
    { key: 'operation', label: 'Operation No / Name' },
    { key: 'machineOperator', label: 'Machine Operator / Setter' },
    { key: 'partyCode', label: 'Party Code (Supplier / Customer)' },
    { key: 'partyName', label: 'Party Name' },
    { key: 'quantityAffected', label: 'Quantity Affected *', type: 'number', required: true },
    { key: 'financialImpact', label: 'Rejection Cost / COPQ (₹)', type: 'number' },
    { key: 'uom', label: 'UOM' },
    { key: 'defectCode', label: 'Defect Code *', required: true },
    {
      key: 'severity',
      label: 'Severity *',
      type: 'select',
      options: ['CRITICAL', 'MAJOR', 'MINOR', 'ADVISORY'],
      required: true,
    },
    { key: 'reportedBy', label: 'Reported By / Inspector' },
    { key: 'targetCompletionDate', label: 'Target Completion Date', type: 'date' },
    { key: 'defectDescription', label: 'Defect Description', type: 'textarea', span2: true },
    { key: 'immediateAction', label: 'Immediate Action / Containment', type: 'textarea', span2: true },
    {
      key: 'rootCauseCategory',
      label: 'Root Cause Category (5M1E)',
      type: 'select',
      options: ['MAN', 'MACHINE', 'MATERIAL', 'METHOD', 'MEASUREMENT', 'ENVIRONMENT'],
    },
    { key: 'rootCause', label: 'Root Cause Analysis', type: 'textarea', span2: true },
    {
      key: 'dispositionType',
      label: 'Disposition',
      type: 'select',
      options: ['REWORK', 'SCRAP', 'RETURN', 'CONCESSION', 'CONTAINMENT'],
    },
    { key: 'remarks', label: 'Remarks', type: 'textarea', span2: true },
  ],
};

export const CALIBRATION_RECORD_CONFIG: DocScreenConfig = {
  docType: 'quality-calibration-record',
  title: 'Calibration Record',
  subtitle: 'Document instrument calibration results and schedule next calibration',
  columns: [
    { label: 'Doc No', field: 'docNo' },
    { label: 'Date', field: 'calibrationDate' },
    { label: 'Instrument Code', field: 'instrumentCode' },
    { label: 'Instrument Name', field: 'instrumentName' },
    { label: 'Calibration #', field: 'calibrationNumber' },
    { label: 'Result', field: 'result' },
    { label: 'Next Due', field: 'nextDueDate' },
    { label: 'Status', field: 'status' },
  ],
  statusField: 'status',
  statusOptions: GENERIC_STATUSES,
  fields: [
    { key: 'instrumentCode', label: 'Instrument Code *', required: true },
    { key: 'instrumentName', label: 'Instrument Name' },
    { key: 'calibrationNumber', label: 'Calibration Certificate #' },
    { key: 'calibrationDate', label: 'Calibration Date *', type: 'date', required: true },
    { key: 'calibrationFrequencyMonths', label: 'Frequency (Months)', type: 'number' },
    {
      key: 'calibrationType',
      label: 'Calibration Type',
      type: 'select',
      options: ['INTERNAL', 'EXTERNAL', 'NABL'],
    },
    { key: 'externalAgency', label: 'External Agency / NABL Lab' },
    { key: 'certificateNumber', label: 'Master Certificate #' },
    { key: 'location', label: 'Location / Department' },
    { key: 'calibrationPerformedBy', label: 'Calibration Performed By' },
    { key: 'approvedBy', label: 'Approved By' },
    {
      key: 'result',
      label: 'Result *',
      type: 'select',
      options: ['PASS', 'FAIL', 'CONDITIONAL'],
      required: true,
    },
    { key: 'nextDueDate', label: 'Next Due Date', type: 'date' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', span2: true },
  ],
};

export const CONCESSION_CONFIG: DocScreenConfig = {
  docType: 'quality-concession',
  title: 'Concession Entry',
  subtitle: 'Controlled acceptance of non-conforming material under approved deviation',
  columns: [
    { label: 'Doc No', field: 'docNo' },
    { label: 'Date', field: 'date' },
    { label: 'Item', field: 'itemCode' },
    { label: 'Party', field: 'partyName' },
    { label: 'Qty Covered', field: 'quantityCovered', numeric: true },
    { label: 'Valid To', field: 'validTo' },
    { label: 'Status', field: 'status' },
  ],
  statusField: 'status',
  statusOptions: GENERIC_STATUSES,
  fields: [
    { key: 'inspectionId', label: 'Inspection ID', type: 'number' },
    { key: 'ncrId', label: 'NCR ID', type: 'number' },
    {
      key: 'concessionType',
      label: 'Concession Type',
      type: 'select',
      options: ['INTERNAL_DEVIATION', 'CUSTOMER_CONCESSION', 'SUPPLIER_CONCESSION'],
    },
    { key: 'itemCode', label: 'Item Code *', required: true },
    { key: 'itemDescription', label: 'Item Description' },
    { key: 'machine', label: 'CNC Machine ID' },
    { key: 'operation', label: 'Operation No' },
    { key: 'partyCode', label: 'Customer / Supplier Code' },
    { key: 'partyName', label: 'Customer / Supplier Name' },
    { key: 'drawingNumber', label: 'Drawing Number' },
    { key: 'drawingRevision', label: 'Drawing Revision' },
    { key: 'deviatedDimension', label: 'Drawing Dimension Deviated' },
    { key: 'deviationValue', label: 'Measured Deviation (+/- mm)' },
    { key: 'batchNumber', label: 'Batch Number' },
    { key: 'serialNumber', label: 'Serial Number' },
    { key: 'heatNumber', label: 'Heat Number' },
    { key: 'quantityCovered', label: 'Quantity Covered *', type: 'number', required: true },
    { key: 'uom', label: 'UOM' },
    { key: 'deviationDescription', label: 'Deviation Description', type: 'textarea', span2: true },
    { key: 'deviationReason', label: 'Reason for Deviation', type: 'textarea', span2: true },
    { key: 'riskAssessment', label: 'Risk & Impact Analysis', type: 'textarea', span2: true },
    { key: 'customerApprovalRequired', label: 'Customer Approval Required', type: 'checkbox' },
    { key: 'customerApprovalReceived', label: 'Customer Approval Received', type: 'checkbox' },
    { key: 'customerApprovalEvidence', label: 'Customer Approval Evidence', span2: true },
    { key: 'approvalAuthority', label: 'Internal Approval Authority' },
    { key: 'validFrom', label: 'Valid From', type: 'date' },
    { key: 'validTo', label: 'Valid To', type: 'date' },
  ],
};

const TC_LINE_FIELDS: LineFieldDef[] = [
  { key: 'parameterName', label: 'Parameter *', width: '160px' },
  { key: 'specification', label: 'Specification', width: '130px' },
  { key: 'nominalValue', label: 'Nominal', width: '100px' },
  { key: 'resultValue', label: 'Result Value', width: '110px' },
  { key: 'uom', label: 'UOM', width: '90px' },
  { key: 'instrumentCode', label: 'Instrument', width: '120px' },
  { key: 'result', label: 'Result', type: 'select', options: ['PASS', 'FAIL', 'NA'], width: '100px' },
];

export const TEST_CERTIFICATE_CONFIG: DocScreenConfig = {
  docType: 'quality-test-certificate',
  title: 'Test Certificate',
  subtitle: 'Inward / Internal / Outward quality certificates with test parameters',
  columns: [
    { label: 'Doc No', field: 'docNo' },
    { label: 'Date', field: 'certificateDate' },
    { label: 'Type', field: 'certificateType' },
    { label: 'Item', field: 'itemCode' },
    { label: 'Party', field: 'partyName' },
    { label: 'Test Type', field: 'testType' },
    { label: 'Status', field: 'status' },
  ],
  statusField: 'status',
  statusOptions: GENERIC_STATUSES,
  typeFilter: { field: 'certificateType', label: 'All Types', options: ['INWARD', 'INTERNAL', 'OUTWARD'] },
  fields: [
    { key: 'certificateType', label: 'Certificate Type *', type: 'select', options: ['INWARD', 'INTERNAL', 'OUTWARD'], required: true },
    { key: 'certificateDate', label: 'Certificate Date *', type: 'date', required: true },
    { key: 'testType', label: 'Test Type' },
    { key: 'partyCode', label: 'Supplier / Customer Code' },
    { key: 'partyName', label: 'Supplier / Customer Name' },
    { key: 'purchaseOrderNumber', label: 'Purchase Order' },
    { key: 'inwardNumber', label: 'Inward Number' },
    { key: 'grnNumber', label: 'GRN Number' },
    { key: 'jobOrderNumber', label: 'Job Order' },
    { key: 'salesOrderNumber', label: 'Sales Order' },
    { key: 'dcNumber', label: 'DC Number' },
    { key: 'invoiceNumber', label: 'Invoice Number' },
    { key: 'inspectionId', label: 'Source Inspection ID', type: 'number' },
    { key: 'itemCode', label: 'Item Code *', required: true },
    { key: 'itemDescription', label: 'Item Description' },
    { key: 'customerPartNumber', label: 'Customer Part Number' },
    { key: 'drawingNumber', label: 'Drawing Number' },
    { key: 'drawingRevision', label: 'Drawing Revision' },
    { key: 'batchNumber', label: 'Batch Number' },
    { key: 'lotNumber', label: 'Lot Number' },
    { key: 'heatNumber', label: 'Heat Number' },
    { key: 'testedQuantity', label: 'Tested Quantity', type: 'number' },
    { key: 'passedQuantity', label: 'Passed Quantity', type: 'number' },
    { key: 'uom', label: 'UOM' },
    { key: 'testedBy', label: 'Tested By / Inspector' },
    { key: 'approvedBy', label: 'Approved By' },
    { key: 'specificationReference', label: 'Specification Reference', type: 'textarea', span2: true },
  ],
  lines: {
    title: 'Test Parameters & Chemical / Mechanical MTC Verification',
    fields: TC_LINE_FIELDS,
    seed: [
      { parameterName: 'Carbon (%C)', uom: '%' },
      { parameterName: 'Manganese (%Mn)', uom: '%' },
      { parameterName: 'Silicon (%Si)', uom: '%' },
      { parameterName: 'Chromium (%Cr)', uom: '%' },
      { parameterName: 'Nickel (%Ni)', uom: '%' },
      { parameterName: 'Hardness (HRC / BHN)', uom: 'HRC' },
      { parameterName: 'Tensile Strength (UTS)', uom: 'MPa' },
      { parameterName: 'Yield Strength', uom: 'MPa' },
    ],
  },
};

export const COMPLAINT_CONFIG: DocScreenConfig = {
  docType: 'quality-customer-complaint',
  title: 'Customer Complaint',
  subtitle: 'Record, investigate, track and resolve customer complaints',
  columns: [
    { label: 'Doc No', field: 'docNo' },
    { label: 'Date', field: 'complaintDate' },
    { label: 'Customer', field: 'customerName' },
    { label: 'Item', field: 'itemCode' },
    { label: 'Type', field: 'complaintType' },
    { label: 'Severity', field: 'severity' },
    { label: 'Status', field: 'complaintStatus' },
  ],
  statusField: 'complaintStatus',
  statusOptions: ['OPEN', 'UNDER_REVIEW', 'INVESTIGATION', 'ACTION_PLANNED', 'ACTION_IMPLEMENTED', 'RESPONSE_SENT', 'CLOSED', 'REOPENED'],
  fields: [
    { key: 'customerCode', label: 'Customer Code *', required: true },
    { key: 'customerName', label: 'Customer Name' },
    { key: 'complaintDate', label: 'Complaint Date', type: 'date' },
    { key: 'targetClosureDate', label: 'Target Closure Date', type: 'date' },
    { key: 'actualClosureDate', label: 'Actual Closure Date', type: 'date' },
    { key: 'customerPo', label: 'Customer PO' },
    { key: 'salesOrderNumber', label: 'Sales Order' },
    { key: 'dispatchReference', label: 'Dispatch Reference / DC No' },
    { key: 'invoiceNumber', label: 'Invoice Number' },
    { key: 'rmaNumber', label: 'RMA Number' },
    { key: 'itemCode', label: 'Item Code' },
    { key: 'itemDescription', label: 'Item Description' },
    { key: 'customerPartNumber', label: 'Customer Part Number' },
    { key: 'drawingNumber', label: 'Drawing Number' },
    { key: 'batchNumber', label: 'Batch Number' },
    { key: 'serialNumber', label: 'Serial Number' },
    { key: 'quantityComplained', label: 'Quantity Complained', type: 'number' },
    { key: 'financialImpact', label: 'Financial Impact (₹)', type: 'number' },
    { key: 'uom', label: 'UOM' },
    {
      key: 'complaintType',
      label: 'Complaint Type',
      type: 'select',
      options: [
        'Dimensional rejection', 'Surface finish issue', 'Material defect', 'Wrong part supplied',
        'Quantity shortage', 'Damage in transit', 'Packaging issue', 'Missing documentation',
        'Missing certificate', 'Delivery issue', 'Service issue', 'Other',
      ],
    },
    { key: 'severity', label: 'Severity', type: 'select', options: ['CRITICAL', 'MAJOR', 'MINOR'] },
    { key: 'receivedChannel', label: 'Received Channel' },
    { key: 'responsiblePerson', label: 'Responsible Person' },
    { key: 'initialResponseDate', label: 'Initial Response Date', type: 'date' },
    { key: 'complaintDescription', label: 'Complaint Description', type: 'textarea', span2: true },
    { key: 'containmentAction', label: 'Containment Action', type: 'textarea', span2: true },
    { key: 'rootCause', label: 'Root Cause', type: 'textarea', span2: true },
    { key: 'correctiveAction', label: 'Corrective Action', type: 'textarea', span2: true },
    { key: 'customerResponse', label: 'Customer Response', type: 'textarea', span2: true },
  ],
};

export const CAPA_CONFIG: DocScreenConfig = {
  docType: 'quality-capa',
  title: 'CAPA',
  subtitle: 'Corrective and Preventive Action tracking',
  columns: [
    { label: 'Doc No', field: 'docNo' },
    { label: 'Date', field: 'date' },
    { label: 'Source', field: 'sourceType' },
    { label: 'Owner', field: 'responsiblePerson' },
    { label: 'Due', field: 'dueDate' },
    { label: 'Status', field: 'capaStatus' },
  ],
  statusField: 'capaStatus',
  statusOptions: ['OPEN', 'IN_PROGRESS', 'ACTION_COMPLETED', 'VERIFICATION', 'CLOSED', 'OVERDUE'],
  fields: [
    {
      key: 'sourceType',
      label: 'Source Type *',
      type: 'select',
      options: ['CUSTOMER_COMPLAINT', 'INTERNAL_REJECTION', 'INSPECTION_FAILURE', 'SUPPLIER_REJECTION', 'AUDIT', 'REPEATED_DEFECT'],
      required: true,
    },
    { key: 'sourceReference', label: 'Source Reference' },
    { key: 'complaintId', label: 'Complaint ID', type: 'number' },
    { key: 'inspectionId', label: 'Inspection ID', type: 'number' },
    { key: 'ncrId', label: 'NCR ID', type: 'number' },
    { key: 'itemCode', label: 'Item Code' },
    { key: 'partyName', label: 'Customer / Supplier Name' },
    { key: 'riskLevel', label: 'Risk Level', type: 'select', options: ['HIGH', 'MEDIUM', 'LOW'] },
    { key: 'responsiblePerson', label: 'Responsible Person' },
    { key: 'verificationBy', label: 'Verified By' },
    { key: 'dueDate', label: 'Due Date', type: 'date' },
    { key: 'completionDate', label: 'Completion Date', type: 'date' },
    { key: 'problemDescription', label: 'Problem Description', type: 'textarea', span2: true },
    { key: 'rootCause', label: 'Root Cause Analysis', type: 'textarea', span2: true },
    { key: 'correctiveAction', label: 'Corrective Action', type: 'textarea', span2: true },
    { key: 'preventiveAction', label: 'Preventive Action', type: 'textarea', span2: true },
    { key: 'evidence', label: 'Implementation Evidence', type: 'textarea', span2: true },
    { key: 'effectivenessResult', label: 'Effectiveness Audit Result', type: 'textarea', span2: true },
    { key: 'effectivenessDate', label: 'Effectiveness Review Date', type: 'date' },
  ],
};

export const EIGHT_D_CONFIG: DocScreenConfig = {
  docType: 'quality-8d',
  title: '8D Report',
  subtitle: 'Eight Disciplines problem solving for major quality failures',
  columns: [
    { label: 'Doc No', field: 'docNo' },
    { label: 'Date', field: 'date' },
    { label: 'Source', field: 'sourceType' },
    { label: 'Item', field: 'itemCode' },
    { label: 'Team Lead', field: 'teamLead' },
    { label: 'Target Close', field: 'targetCloseDate' },
    { label: 'Status', field: 'reportStatus' },
  ],
  statusField: 'reportStatus',
  statusOptions: ['OPEN', 'IN_PROGRESS', 'CLOSED'],
  fields: [
    {
      key: 'sourceType',
      label: 'Source Type *',
      type: 'select',
      options: ['CUSTOMER_COMPLAINT', 'SUPPLIER_PROBLEM', 'INTERNAL_DEFECT', 'REPEATED_ISSUE', 'MAJOR_FAILURE'],
      required: true,
    },
    { key: 'sourceReference', label: 'Source Reference' },
    { key: 'complaintId', label: 'Complaint ID', type: 'number' },
    { key: 'ncrId', label: 'NCR ID', type: 'number' },
    { key: 'capaId', label: 'CAPA ID', type: 'number' },
    { key: 'customerCode', label: 'Customer Code' },
    { key: 'customerName', label: 'Customer Name' },
    { key: 'itemCode', label: 'Item Code' },
    { key: 'itemDescription', label: 'Item Description' },
    { key: 'batchNumber', label: 'Batch / Lot Number' },
    { key: 'quantityAffected', label: 'Quantity Affected', type: 'number' },
    { key: 'teamLead', label: 'Team Lead' },
    { key: 'teamMembers', label: 'Team Members (CSV / List)' },
    { key: 'targetCloseDate', label: 'Target Close Date', type: 'date' },
    { key: 'actualCloseDate', label: 'Actual Closure Date', type: 'date' },
    { key: 'problemStatement', label: 'Problem Statement (D2)', type: 'textarea', span2: true },
  ],
  lines: {
    title: 'Disciplines (D1 – D8)',
    fields: [
      { key: 'disciplineCode', label: 'Code', readonly: true, width: '70px' },
      { key: 'disciplineName', label: 'Discipline', readonly: true, width: '190px' },
      { key: 'description', label: 'Description', width: '180px' },
      { key: 'responsiblePerson', label: 'Responsible', width: '120px' },
      { key: 'dueDate', label: 'Due', type: 'date', width: '130px' },
      { key: 'completionDate', label: 'Completed', type: 'date', width: '130px' },
      { key: 'status', label: 'Status', type: 'select', options: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED'], width: '130px' },
    ],
    seed: [
      { disciplineCode: 'D1', disciplineName: 'Team Formation' },
      { disciplineCode: 'D2', disciplineName: 'Problem Description' },
      { disciplineCode: 'D3', disciplineName: 'Containment Action' },
      { disciplineCode: 'D4', disciplineName: 'Root Cause Analysis' },
      { disciplineCode: 'D5', disciplineName: 'Corrective Action Selection' },
      { disciplineCode: 'D6', disciplineName: 'Corrective Action Implementation' },
      { disciplineCode: 'D7', disciplineName: 'Prevent Recurrence' },
      { disciplineCode: 'D8', disciplineName: 'Closure' },
    ],
  },
};
