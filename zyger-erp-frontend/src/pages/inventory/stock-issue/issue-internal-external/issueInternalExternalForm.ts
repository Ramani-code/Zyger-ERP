import type { ItemMasterDto } from '../../../../types/master.types';
import type {
  IssueInternalExternalDto,
  IssueInternalExternalLineDto,
  IssueInternalExternalPayload,
  IssueInternalExternalReturnable,
  IssueInternalExternalType,
} from '../../../../types/inventory/issueInternalExternal.types';
import { toNumber, todayISO } from '../../../../utils/format';

export interface IssueInternalExternalLineFormState {
  itemCode: string;
  itemDesc: string;
  availableQty: string;
  issueQty: string;
  batchNo: string;
  heatNo: string;
  returnable: string;
  location: string;
  remarks: string;
}

export interface IssueInternalExternalFormState {
  issueType: IssueInternalExternalType | '';
  toDepartment: string;
  issuedTo: string;
  date: string;
  issueRequestNo: string;
  sourceLocation: string;
  remarks: string;
  lines: IssueInternalExternalLineFormState[];
}

const DIRTY_LINE_KEYS: Array<keyof IssueInternalExternalLineFormState> = [
  'itemCode',
  'issueQty',
  'batchNo',
  'heatNo',
  'returnable',
  'remarks',
];

export function availabilityKey(itemCode: string, location: string): string {
  return `${itemCode}|${location}`;
}

export function createEmptyLine(
  defaultLocation = ''
): IssueInternalExternalLineFormState {
  return {
    itemCode: '',
    itemDesc: '',
    availableQty: '',
    issueQty: '',
    batchNo: '',
    heatNo: '',
    returnable: '',
    location: defaultLocation,
    remarks: '',
  };
}

export function createEmptyForm(): IssueInternalExternalFormState {
  return {
    issueType: 'INTERNAL',
    toDepartment: '',
    issuedTo: '',
    date: todayISO(),
    issueRequestNo: '',
    sourceLocation: '',
    remarks: '',
    lines: [createEmptyLine()],
  };
}

export function isLineDirty(
  line: IssueInternalExternalLineFormState
): boolean {
  return DIRTY_LINE_KEYS.some(
    (key) => String(line[key] ?? '').trim() !== ''
  );
}

function lineFromDto(
  line: IssueInternalExternalLineDto,
  itemsMap: Map<string, ItemMasterDto>,
  fallbackLocation: string
): IssueInternalExternalLineFormState {
  const item = itemsMap.get(line.itemCode);

  return {
    itemCode: line.itemCode ?? '',
    itemDesc: line.itemDesc ?? item?.description ?? '',
    availableQty: '',
    issueQty: line.issueQty?.toString() ?? '',
    batchNo: line.batchNo ?? '',
    heatNo: line.heatNo ?? '',
    returnable: line.returnable ?? '',
    location: line.location ?? fallbackLocation,
    remarks: line.remarks ?? '',
  };
}

export function formFromDto(
  dto: IssueInternalExternalDto,
  items: ItemMasterDto[]
): IssueInternalExternalFormState {
  const itemsMap = new Map(items.map((item) => [item.code, item]));

  return {
    issueType: dto.issueType ?? 'INTERNAL',
    toDepartment: dto.toDepartment ?? '',
    issuedTo: dto.issuedTo ?? '',
    date: dto.date ?? '',
    issueRequestNo: dto.issueRequestNo ?? '',
    sourceLocation: dto.sourceLocation ?? '',
    remarks: dto.remarks ?? '',
    lines:
      dto.lines && dto.lines.length > 0
        ? dto.lines.map((line) =>
            lineFromDto(line, itemsMap, dto.sourceLocation ?? '')
          )
        : [createEmptyLine(dto.sourceLocation ?? '')],
  };
}

export function buildPayload(
  form: IssueInternalExternalFormState
): IssueInternalExternalPayload {
  const activeLines = form.lines.filter(isLineDirty);

  return {
    issueType: form.issueType as IssueInternalExternalType,
    returnable:
      (activeLines.find((line) => line.returnable)?.returnable as
        | IssueInternalExternalReturnable
        | undefined) ?? 'No',
    toDepartment:
      form.issueType === 'INTERNAL' ? form.toDepartment.trim() : undefined,
    issuedTo:
      form.issueType === 'EXTERNAL' ? form.issuedTo.trim() : undefined,
    date: form.date,
    issueRequestNo: form.issueRequestNo.trim() || undefined,
    sourceLocation: form.sourceLocation.trim(),
    remarks: form.remarks.trim() || undefined,
    lines: activeLines.map((line) => ({
      itemCode: line.itemCode.trim(),
      issueQty: toNumber(line.issueQty),
      batchNo: line.batchNo.trim() || undefined,
      heatNo: line.heatNo.trim() || undefined,
      returnable: line.returnable.trim() || undefined,
      location: line.location.trim(),
      remarks: line.remarks.trim() || undefined,
    })),
  };
}

export function validateIssueInternalExternalForm(
  form: IssueInternalExternalFormState,
  itemsMap: Map<string, ItemMasterDto>,
  strict: boolean,
  availabilityMap: Record<string, string>
): string[] {
  const errors: string[] = [];

  if (!form.date) {
    errors.push('Date is required.');
  }

  if (!form.issueType) {
    errors.push('Issue Type is required.');
  }

  if (form.issueType === 'INTERNAL' && !form.toDepartment.trim()) {
    errors.push('To Department is required.');
  }

  if (form.issueType === 'EXTERNAL' && !form.issuedTo.trim()) {
    errors.push('Issued To is required.');
  }

  if (!form.sourceLocation.trim()) {
    errors.push('Source Location is required.');
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
    } else {
      // Mirrors DocumentFacade.validateBatchHeat() on the backend — surface the
      // same rule here so it's a clear inline message instead of a failed post.
      const item = itemsMap.get(line.itemCode.trim());
      if (item?.requiresBatch && !line.batchNo.trim()) {
        errors.push(`Line ${lineNo}: Item ${line.itemCode.trim()} requires a batch number.`);
      }
      if (item?.requiresHeat && !line.heatNo.trim()) {
        errors.push(`Line ${lineNo}: Item ${line.itemCode.trim()} requires a heat number.`);
      }
    }

    const qty = toNumber(line.issueQty);

    if (!qty || qty <= 0) {
      errors.push(`Line ${lineNo}: Issue Qty is required.`);
    }

    if (!line.location.trim()) {
      errors.push(`Line ${lineNo}: Location is required.`);
    }

    if (!line.returnable.trim()) {
      errors.push(`Line ${lineNo}: Returnable is required.`);
    }

    if (strict && line.itemCode) {
      const effectiveLocation = line.location || form.sourceLocation;

      if (effectiveLocation) {
        const availableValue =
          availabilityMap[availabilityKey(line.itemCode, effectiveLocation)];

        if (availableValue !== undefined) {
          const availableQty = toNumber(availableValue);

          if (qty > availableQty + 0.001) {
            errors.push(
              `Line ${lineNo}: insufficient stock for ${line.itemCode} (available ${availableQty}).`
            );
          }
        }
      }
    }
  });

  return [...new Set(errors)];
}