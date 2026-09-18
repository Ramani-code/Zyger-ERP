import type { ItemMasterDto } from '../../../../types/master.types';
import type {
  ReturnManagementDto,
  ReturnManagementLineDto,
  ReturnManagementPayload,
  ReturnManagementTypeConfig,
} from '../../../../types/inventory/returnManagement.types';
import { toNumber, todayISO } from '../../../../utils/format';

export interface ReturnManagementLineFormState {
  itemCode: string;
  itemDesc: string;
  returnedQty: string;
  acceptedQty: string;
  rejectedQty: string;
  batchNo: string;
  heatNo: string;
  location: string;
  stockStatus: string;
  originalIssueNo: string;
  remarks: string;
}

export interface ReturnManagementFormState {
  date: string;
  party: string;
  originalDocumentNo: string;
  originalDcDate: string;
  soNumber: string;
  customerPoNumber: string;
  originalIssueType: string;
  jobOrderNo: string;
  condition: string;
  reduceConsumption: boolean;
  reasonCode: string;
  inspectionRequired: string;
  remarks: string;
  lines: ReturnManagementLineFormState[];
}

const DIRTY_LINE_KEYS: Array<keyof ReturnManagementLineFormState> = [
  'itemCode',
  'returnedQty',
  'acceptedQty',
  'rejectedQty',
  'batchNo',
  'heatNo',
  'remarks',
];

export function createEmptyLine(
  defaultLocation = ''
): ReturnManagementLineFormState {
  return {
    itemCode: '',
    itemDesc: '',
    returnedQty: '',
    acceptedQty: '',
    rejectedQty: '',
    batchNo: '',
    heatNo: '',
    location: defaultLocation,
    stockStatus: 'FREE',
    originalIssueNo: '',
    remarks: '',
  };
}

export function createEmptyForm(): ReturnManagementFormState {
  return {
    date: todayISO(),
    party: '',
    originalDocumentNo: '',
    originalDcDate: '',
    soNumber: '',
    customerPoNumber: '',
    originalIssueType: '',
    jobOrderNo: '',
    condition: 'FREE',
    reduceConsumption: true,
    reasonCode: '',
    inspectionRequired: '',
    remarks: '',
    lines: [createEmptyLine()],
  };
}

export function isLineDirty(
  line: ReturnManagementLineFormState
): boolean {
  return DIRTY_LINE_KEYS.some(
    (key) => String(line[key] ?? '').trim() !== ''
  );
}

function lineFromDto(
  line: ReturnManagementLineDto,
  itemsMap: Map<string, ItemMasterDto>,
  fallbackLocation: string
): ReturnManagementLineFormState {
  const item = itemsMap.get(line.itemCode);

  return {
    itemCode: line.itemCode ?? '',
    itemDesc: line.itemDesc ?? item?.description ?? '',
    returnedQty: line.returnedQty?.toString() ?? '',
    acceptedQty: line.acceptedQty?.toString() ?? '',
    rejectedQty: line.rejectedQty?.toString() ?? '',
    batchNo: line.batchNo ?? '',
    heatNo: line.heatNo ?? '',
    location: line.location ?? fallbackLocation,
    stockStatus: line.stockStatus ?? 'FREE',
    originalIssueNo: line.originalIssueNo ?? '',
    remarks: line.remarks ?? '',
  };
}

export function formFromDto(
  dto: ReturnManagementDto,
  items: ItemMasterDto[]
): ReturnManagementFormState {
  const itemsMap = new Map(items.map((item) => [item.code, item]));

  return {
    date: dto.date ?? '',
    party: dto.party ?? (dto as any).customer ?? '',
    originalDocumentNo: dto.originalDocumentNo ?? (dto as any).originalDcNumber ?? (dto as any).originalInvoiceNumber ?? '',
    originalDcDate: dto.originalDcDate || (dto as any).originalDcDate || (dto as any).originalInvoiceDate || (dto as any).dcDate || '',
    soNumber: dto.soNumber || (dto as any).salesOrderNumber || '',
    customerPoNumber: dto.customerPoNumber || (dto as any).customerPo || '',
    originalIssueType: dto.originalIssueType ?? '',
    jobOrderNo: dto.jobOrderNo ?? '',
    condition: dto.condition ?? 'FREE',
    reduceConsumption: dto.reduceConsumption !== false,
    reasonCode: dto.reasonCode || (dto as any).returnReason || (dto as any).reason || '',
    inspectionRequired: dto.inspectionRequired ?? '',
    remarks: dto.remarks ?? '',
    lines:
      dto.lines && dto.lines.length > 0
        ? dto.lines.map((line) => lineFromDto(line, itemsMap, ''))
        : [createEmptyLine()],
  };
}

export function buildPayload(
  form: ReturnManagementFormState
): ReturnManagementPayload {
  const activeLines = form.lines.filter(isLineDirty);

  return {
    date: form.date,
    party: form.party.trim(),
    originalDocumentNo: form.originalDocumentNo.trim(),
    originalDcDate: form.originalDcDate.trim() || undefined,
    soNumber: form.soNumber.trim() || undefined,
    customerPoNumber: form.customerPoNumber.trim() || undefined,
    originalIssueType: form.originalIssueType.trim() || undefined,
    jobOrderNo: form.jobOrderNo.trim() || undefined,
    condition: form.condition.trim() || undefined,
    reduceConsumption: form.reduceConsumption,
    reasonCode: form.reasonCode.trim(),
    inspectionRequired: form.inspectionRequired.trim() || undefined,
    remarks: form.remarks.trim() || undefined,
    lines: activeLines.map((line) => ({
      itemCode: line.itemCode.trim(),
      returnedQty: toNumber(line.returnedQty),
      acceptedQty: toNumber(line.acceptedQty) || undefined,
      rejectedQty: toNumber(line.rejectedQty) || undefined,
      batchNo: line.batchNo.trim() || undefined,
      heatNo: line.heatNo.trim() || undefined,
      location: line.location.trim(),
      stockStatus: line.stockStatus.trim() || 'FREE',
      originalIssueNo: line.originalIssueNo.trim() || undefined,
      remarks: line.remarks.trim() || undefined,
    })),
  };
}

export function validateReturnManagementForm(
  config: ReturnManagementTypeConfig,
  form: ReturnManagementFormState,
  itemsMap: Map<string, ItemMasterDto>,
  _strict: boolean
): string[] {
  const errors: string[] = [];

  if (!form.date) {
    errors.push('Date is required.');
  }

  if (!form.party.trim()) {
    errors.push(`${config.partyLabel} is required.`);
  }

  if (!form.originalDocumentNo.trim()) {
    errors.push('Original Document is required.');
  }

  if (!form.reasonCode.trim()) {
    errors.push('Reason Code is required.');
  }

  const activeLines = form.lines.filter(isLineDirty);

  if (activeLines.length === 0) {
    errors.push('At least one line item is required.');
  }

  activeLines.forEach((line, index) => {
    const lineNo = index + 1;

    if (!line.itemCode.trim()) {
      errors.push(`Line ${lineNo}: Item Code is required.`);
    } else if (!itemsMap.has(line.itemCode.trim())) {
      errors.push(
        `Line ${lineNo}: Item code "${line.itemCode.trim()}" is not valid.`
      );
    }

    const returnedQty = toNumber(line.returnedQty);

    if (!returnedQty || returnedQty <= 0) {
      errors.push(`Line ${lineNo}: Returned Qty is required.`);
    }

    if (!line.location.trim()) {
      errors.push(`Line ${lineNo}: Location is required.`);
    }
  });

  return [...new Set(errors)];
}