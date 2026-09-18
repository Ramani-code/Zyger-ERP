import type { ItemMasterDto } from '../../../../types/master.types';
import type {
  PhysicalStockAmendmentDto,
  PhysicalStockAmendmentLineDto,
  PhysicalStockAmendmentPayload,
} from '../../../../types/inventory/adjustment.types';
import { toNumber, todayISO } from '../../../../utils/format';

export interface PhysicalStockAmendmentLineFormState {
  itemCode: string;
  itemDesc: string;
  batchNo: string;
  systemQty: string;
  physicalQty: string;
  varianceQty: string;
  varianceValue: string;
  reasonCode: string;
}

export interface PhysicalStockAmendmentFormState {
  date: string;
  storeLocation: string;
  countTeam: string;
  countType: string;
  lines: PhysicalStockAmendmentLineFormState[];
}

const DIRTY_LINE_KEYS: Array<keyof PhysicalStockAmendmentLineFormState> = [
  'itemCode',
  'physicalQty',
  'batchNo',
  'reasonCode',
];

export function createEmptyLine(): PhysicalStockAmendmentLineFormState {
  return {
    itemCode: '',
    itemDesc: '',
    batchNo: '',
    systemQty: '',
    physicalQty: '',
    varianceQty: '',
    varianceValue: '',
    reasonCode: '',
  };
}

export function createEmptyForm(): PhysicalStockAmendmentFormState {
  return {
    date: todayISO(),
    storeLocation: '',
    countTeam: '',
    countType: '',
    lines: [createEmptyLine()],
  };
}

export function isLineDirty(
  line: PhysicalStockAmendmentLineFormState
): boolean {
  return DIRTY_LINE_KEYS.some(
    (key) => String(line[key] ?? '').trim() !== ''
  );
}

function lineFromDto(
  line: PhysicalStockAmendmentLineDto,
  itemsMap: Map<string, ItemMasterDto>
): PhysicalStockAmendmentLineFormState {
  const item = itemsMap.get(line.itemCode);

  return {
    itemCode: line.itemCode ?? '',
    itemDesc: line.itemDesc ?? item?.description ?? '',
    batchNo: line.batchNo ?? '',
    systemQty: line.systemQty?.toString() ?? '',
    physicalQty: line.physicalQty?.toString() ?? '',
    varianceQty: line.varianceQty?.toString() ?? '',
    varianceValue: line.varianceValue?.toString() ?? '',
    reasonCode: line.reasonCode ?? '',
  };
}

export function formFromDto(
  dto: PhysicalStockAmendmentDto,
  items: ItemMasterDto[]
): PhysicalStockAmendmentFormState {
  const itemsMap = new Map(items.map((item) => [item.code, item]));

  return {
    date: dto.date ?? '',
    storeLocation: dto.storeLocation ?? '',
    countTeam: dto.countTeam ?? '',
    countType: dto.countType ?? '',
    lines:
      dto.lines && dto.lines.length > 0
        ? dto.lines.map((line) => lineFromDto(line, itemsMap))
        : [createEmptyLine()],
  };
}

export function buildPayload(
  form: PhysicalStockAmendmentFormState
): PhysicalStockAmendmentPayload {
  const activeLines = form.lines.filter(isLineDirty);

  return {
    date: form.date,
    storeLocation: form.storeLocation.trim(),
    countTeam: form.countTeam.trim(),
    countType: form.countType.trim(),
    lines: activeLines.map((line) => ({
      itemCode: line.itemCode.trim(),
      batchNo: line.batchNo.trim() || undefined,
      physicalQty: toNumber(line.physicalQty),
      reasonCode: line.reasonCode.trim() || undefined,
    })),
  };
}

export function calculateVariance(
  systemQty: string,
  physicalQty: string
): string {
  const system = toNumber(systemQty);
  const physical = toNumber(physicalQty);
  return String(physical - system);
}

export function calculateVarianceValue(
  varianceQty: string,
  itemRate: number
): string {
  const variance = toNumber(varianceQty);
  return String(Math.round(variance * itemRate));
}

export function validatePhysicalStockAmendmentForm(
  form: PhysicalStockAmendmentFormState,
  itemsMap: Map<string, ItemMasterDto>,
  _strict: boolean
): string[] {
  const errors: string[] = [];

  if (!form.date) {
    errors.push('Date is required.');
  }

  if (!form.storeLocation.trim()) {
    errors.push('Store / Location is required.');
  }

  if (!form.countTeam.trim()) {
    errors.push('Count Team is required.');
  }

  if (!form.countType.trim()) {
    errors.push('Count Type is required.');
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

    const physicalQty = toNumber(line.physicalQty);

    if (line.physicalQty.trim() === '' || physicalQty < 0) {
      errors.push(
        `Line ${lineNo}: Physical Qty is required and must be zero or greater.`
      );
    }

    // Mirrors DocumentFacade.validateAmendmentReason() (INV-ADJ-01) on the backend,
    // which requires a reason code per line for physical stock amendments.
    if (!line.reasonCode.trim()) {
      errors.push(`Line ${lineNo}: Reason code is required.`);
    }

  });

  return [...new Set(errors)];
}