export type InspectionType = 'IQC' | 'LO' | 'JOMIN' | 'FAI' | 'IPQC' | 'LINE' | 'LAST_OFF' | 'FINAL';

export type InspectionStatus = 'DRAFT' | 'PENDING' | 'IN_PROGRESS' | 'SUBMITTED' | 'PASS' | 'HOLD' | 'FAIL' | 'APPROVED' | 'CLOSED' | 'CANCELLED';

export type DecisionStatus = 'PENDING' | 'PASS' | 'FAIL' | 'HOLD';

export type MeasurementResult = 'PASS' | 'FAIL' | 'PENDING' | 'NA';

export interface CharacteristicLinePayload {
  balloonNo?: string;
  characteristicCode: string;
  characteristicName?: string;
  nominalValue?: number;
  lowerLimit?: number;
  upperLimit?: number;
  tolerance?: number;
  actualValue?: number;
  actualText?: string;
  result?: MeasurementResult;
  deviation?: number;
  calibrationStatus?: string;
  isCritical?: boolean;
  isMandatory?: boolean;
  isSpecial?: boolean;
  qty?: number;
  uom?: string;
  instrumentCode?: string;
  remarks?: string;
}

export interface InspectionCreatePayload {
  inspectionType: InspectionType;
  inspectionStatus?: InspectionStatus;
  decisionStatus?: DecisionStatus;
  directInventoryUpdate?: boolean;
  itemCode: string;
  itemDescription?: string;
  location?: string;
  receivedQuantity: number;
  inspectionQuantity: number;
  referenceDocNo?: string;
  purchaseOrderNumber?: string;
  partyCode?: string;
  partyName?: string;
  supplierChallanNo?: string;
  materialGrade?: string;
  mtcVerified?: boolean;
  mtcNumber?: string;
  ndtStatus?: string;
  measurementMethod?: string;
  machine?: string;
  operation?: string;
  operationSequence?: string;
  programNumber?: string;
  setupNumber?: string;
  drawingNumber?: string;
  drawingRevision?: string;
  inspector?: string;
  inspectionPlanId?: string;
  lotNumber?: string;
  batchNumber?: string;
  serialNumber?: string;
  heatNumber?: string;
  acceptedQuantity?: number;
  rejectedQuantity?: number;
  holdQuantity?: number;
  reworkQuantity?: number;
  lines: CharacteristicLinePayload[];
  remarks?: string;
}

export interface DecisionQuantitiesPayload {
  acceptedQuantity?: number;
  rejectedQuantity?: number;
  reworkQuantity?: number;
  holdQuantity?: number;
  location?: string;
  remarks?: string;
}

export interface InspectionLineDto {
  id: number;
  balloonNo?: string;
  characteristicCode: string;
  characteristicName?: string;
  nominalValue?: number;
  lowerLimit?: number;
  upperLimit?: number;
  tolerance?: number;
  actualValue?: number;
  actualText?: string;
  result: MeasurementResult;
  deviation?: number;
  calibrationStatus?: string;
  isCritical?: boolean;
  isMandatory?: boolean;
  isSpecial?: boolean;
  qty: number;
  uom?: string;
  instrumentCode?: string;
  remarks?: string;
}

export interface InspectionDto {
  id: number;
  docNo: string;
  inspectionType: InspectionType;
  inspectionNumber: string;
  inspectionDate: string;
  itemCode: string;
  itemName?: string;
  itemDescription?: string;
  location?: string;
  inspectionQuantity: number;
  receivedQuantity: number;
  sourceType?: string;
  sourceNumber?: string;
  referenceDocNo?: string;
  purchaseOrderNumber?: string;
  partyCode?: string;
  partyName?: string;
  supplierChallanNo?: string;
  materialGrade?: string;
  mtcVerified?: boolean;
  mtcNumber?: string;
  ndtStatus?: string;
  ho?: string;
  machine?: string;
  operation?: string;
  operationSequence?: string;
  programNumber?: string;
  setupNumber?: string;
  drawingNumber?: string;
  drawingRevision?: string;
  inspector?: string;
  assignedInspector?: string;
  measurementMethod?: string;
  lotNumber?: string;
  batchNumber?: string;
  serialNumber?: string;
  heatNumber?: string;
  status: string;
  inspectionStatus: InspectionStatus;
  decisionStatus: DecisionStatus;
  finalDecision: DecisionStatus;
  approvedBy?: string;
  approvedAt?: string;
  approvedByCustomer?: string;
  customerApprovalReceived?: boolean;
  customerApprovalEvidence?: string;
  requireCustomerApproval?: boolean;
  hasCriticalCharacteristic?: boolean;
  hasSpecialCharacteristic?: boolean;
  lines: InspectionLineDto[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  remarks?: string;
  closedAt?: string;
  cancellationReason?: string;
  cancellationDate?: string;
  reopenedAt?: string;
  holdQuantity?: number;
  rejectedQuantity?: number;
  acceptedQuantity?: number;
  concessionQuantity?: number;
  reworkQuantity?: number;
  returnQuantity?: number;
  scrapQuantity?: number;
  totalAmount?: number;
  referenceId?: number;
  referenceNumber?: string;
  referenceType?: string;
  _allowedTransitions?: string[];
  _isTerminal?: boolean;
}

export interface InspectionListRowDto {
  id: number;
  docNo: string;
  inspectionNumber: string;
  inspectionDate: string;
  inspectionType: InspectionType;
  itemCode: string;
  itemName?: string;
  inspectionQuantity?: number;
  receivedQuantity?: number;
  status: InspectionStatus;
  inspectionStatus: InspectionStatus;
  decisionStatus: DecisionStatus;
  lines?: InspectionLineDto[];
}

export interface InspectionListParams {
  page: number;
  size: number;
  sort?: string;
  search?: string;
  status?: InspectionStatus;
  inspectionType?: InspectionType;
  itemCode?: string;
  inspectionDateFrom?: string;
  inspectionDateTo?: string;
}

export type DecisionInput = 'PASS' | 'FAIL' | 'HOLD' | 'REJECT' | 'CANCEL';

export type NcrSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'ADVISORY';

export interface NcrCreatePayload {
  inspectionId: number;
  itemCode: string;
  quantityAffected: number;
  defectCode: string;
  defectDescription?: string;
  severity: NcrSeverity;
  rootCause?: string;
  ncrNumber?: string;
  remarks?: string;
}

export interface NcrDto {
  id: number;
  docNo: string;
  ncrNumber?: string;
  inspectionId: number;
  itemCode: string;
  itemName?: string;
  quantityAffected: number;
  defectCode: string;
  defectDescription?: string;
  severity: NcrSeverity;
  rootCause?: string;
  dispositionType?: 'REWORK' | 'SCRAP' | 'RETURN' | 'CONCESSION' | 'CONTAINMENT';
  sourceType?: string;
  sourceNumber?: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  remarks?: string;
}

export interface NcrListParams {
  page: number;
  size: number;
  sort?: string;
  search?: string;
  status?: string;
}

export interface QualityDashboardData {
  pendingByType: Record<string, number>;
  pendingTotal: number;
  openNcr: number;
  openConcession: number;
  openComplaints: number;
  openCapa: number;
  open8d: number;
  pass: number;
  fail: number;
  hold: number;
  calibration: {
    total: number;
    dueWithin7Days: number;
    dueWithin30Days: number;
    overdue: number;
    underRepair: number;
    failed: number;
  };
}

export type QualityDocAction = 'submit' | 'approve' | 'reject' | 'reopen' | 'cancel';
