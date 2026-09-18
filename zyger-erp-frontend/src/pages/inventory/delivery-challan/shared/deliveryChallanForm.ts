import type { ItemMasterDto } from '../../../../types/master.types';
import type {
  DeliveryChallanDto,
  DeliveryChallanLineDto,
  DeliveryChallanPayload,
  DeliveryChallanTypeConfig,
} from '../../../../types/inventory/deliveryChallan.types';
import { toNumber, todayISO } from '../../../../utils/format';

export interface DeliveryChallanLineFormState {
  itemCode: string;
  itemDesc: string;
  qty: string;
  rate: string;
  amount: string;
  hsnCode: string;
  uom: string;
  batchNo: string;
  heatNo: string;
  location: string;
  taxPercent: string;
  transferValue: string;
  remarks: string;
}

export interface DeliveryChallanFormState {
  date: string;
  party: string;
  sourceLocation: string;
  destinationLocation: string;
  referenceNo: string;
  referenceDate: string;
  vehicleNo: string;
  transporter: string;
  lrNo: string;
  modeOfTransport: string;
  linkedDocumentNo: string;
  remarks: string;

  // JO DC fields
  jobOrderNo: string;
  challanPurpose: string; // 'Sending for Job Work' / 'Receiving after Job Work'
  processName: string;
  expectedReturnDate: string;
  jobWorkRateApplicable: boolean;
  gstOnJobWork: string;

  // General DC fields
  dcAgainst: string; // Sale/Sample/Approval/Replacement/Others
  salesOrderNo: string;
  billingAddress: string;
  shippingAddress: string;
  gstin: string;
  taxApplicable: boolean;
  paymentTerms: string;
  convertToInvoiceLater: boolean;

  // Transfer DC fields
  transferType: string; // Inter-Branch/Inter-Godown/Inter-Plant
  transferRequestNo: string;
  approvalRequired: boolean;
  inTransitTracking: boolean;

  lines: DeliveryChallanLineFormState[];

  partyAddress: string;
  partyGstin: string;
  partyContactPerson: string;
  partyPhone: string;
}

const DIRTY_LINE_KEYS: Array<keyof DeliveryChallanLineFormState> = [
  'itemCode',
  'qty',
  'rate',
  'batchNo',
  'heatNo',
  'remarks',
];

export function createEmptyLine(
  defaultLocation = ''
): DeliveryChallanLineFormState {
  return {
    itemCode: '',
    itemDesc: '',
    qty: '',
    rate: '',
    amount: '',
    hsnCode: '',
    uom: 'PCS',
    batchNo: '',
    heatNo: '',
    location: defaultLocation,
    taxPercent: '',
    transferValue: '',
    remarks: '',
  };
}

export function createEmptyForm(): DeliveryChallanFormState {
  return {
    date: todayISO(),
    party: '',
    sourceLocation: '',
    destinationLocation: '',
    referenceNo: '',
    referenceDate: '',
    vehicleNo: '',
    transporter: '',
    lrNo: '',
    modeOfTransport: 'Road',
    linkedDocumentNo: '',
    remarks: '',

    // JO DC defaults
    jobOrderNo: '',
    challanPurpose: 'Sending for Job Work',
    processName: '',
    expectedReturnDate: '',
    jobWorkRateApplicable: false,
    gstOnJobWork: 'Nil',

    // General DC defaults
    dcAgainst: 'Sale',
    salesOrderNo: '',
    billingAddress: '',
    shippingAddress: '',
    gstin: '',
    taxApplicable: false,
    paymentTerms: '',
    convertToInvoiceLater: false,

    // Transfer DC defaults
    transferType: 'Inter-Branch',
    transferRequestNo: '',
    approvalRequired: false,
    inTransitTracking: false,

    lines: [createEmptyLine()],
    partyAddress: '',
    partyGstin: '',
    partyContactPerson: '',
    partyPhone: '',
  };
}

export function isLineDirty(
  line: DeliveryChallanLineFormState
): boolean {
  return DIRTY_LINE_KEYS.some(
    (key) => String(line[key] ?? '').trim() !== ''
  );
}

function lineFromDto(
  line: DeliveryChallanLineDto,
  itemsMap: Map<string, ItemMasterDto>,
  fallbackLocation: string
): DeliveryChallanLineFormState {
  const item = itemsMap.get(line.itemCode);

  return {
    itemCode: line.itemCode ?? '',
    itemDesc: line.itemDesc ?? item?.description ?? '',
    qty: line.qty?.toString() ?? '',
    rate: line.rate?.toString() ?? '',
    amount: line.amount?.toString() ?? '',
    hsnCode: line.hsnCode ?? (item as any)?.hsnCode ?? (item as any)?.hsn ?? '',
    uom: line.uom ?? item?.uom ?? 'PCS',
    batchNo: line.batchNo ?? '',
    heatNo: line.heatNo ?? '',
    location: line.location ?? fallbackLocation,
    taxPercent: line.taxPercent?.toString() ?? '',
    transferValue: line.transferValue?.toString() ?? '',
    remarks: line.remarks ?? '',
  };
}

export function formFromDto(
  dto: DeliveryChallanDto,
  items: ItemMasterDto[]
): DeliveryChallanFormState {
  const itemsMap = new Map(items.map((item) => [item.code, item]));

  return {
    date: dto.date ?? '',
    party: dto.party ?? '',
    sourceLocation: dto.sourceLocation ?? '',
    destinationLocation: dto.destinationLocation ?? '',
    referenceNo: dto.referenceNo ?? '',
    referenceDate: dto.referenceDate ?? '',
    vehicleNo: dto.vehicleNo ?? '',
    transporter: dto.transporter ?? '',
    lrNo: dto.lrNo ?? '',
    modeOfTransport: dto.modeOfTransport ?? 'Road',
    linkedDocumentNo: dto.linkedDocumentNo ?? '',
    remarks: dto.remarks ?? '',

    jobOrderNo: dto.jobOrderNo ?? '',
    challanPurpose: dto.challanPurpose ?? 'Sending for Job Work',
    processName: dto.processName ?? '',
    expectedReturnDate: dto.expectedReturnDate ?? '',
    jobWorkRateApplicable: Boolean(dto.jobWorkRateApplicable),
    gstOnJobWork: dto.gstOnJobWork ?? 'Nil',

    dcAgainst: dto.dcAgainst ?? 'Sale',
    salesOrderNo: dto.salesOrderNo ?? '',
    billingAddress: dto.billingAddress ?? '',
    shippingAddress: dto.shippingAddress ?? '',
    gstin: dto.gstin ?? '',
    taxApplicable: Boolean(dto.taxApplicable),
    paymentTerms: dto.paymentTerms ?? '',
    convertToInvoiceLater: Boolean(dto.convertToInvoiceLater),

    transferType: dto.transferType ?? 'Inter-Branch',
    transferRequestNo: dto.transferRequestNo ?? '',
    approvalRequired: Boolean(dto.approvalRequired),
    inTransitTracking: Boolean(dto.inTransitTracking),

    lines:
      dto.lines && dto.lines.length > 0
        ? dto.lines.map((line) =>
            lineFromDto(line, itemsMap, dto.sourceLocation ?? '')
          )
        : [createEmptyLine(dto.sourceLocation ?? '')],
    partyAddress: dto.billingAddress ?? '',
    partyGstin: dto.gstin ?? '',
    partyContactPerson: '',
    partyPhone: '',
  };
}

export function buildPayload(
  form: DeliveryChallanFormState
): DeliveryChallanPayload {
  const activeLines = form.lines.filter(isLineDirty);

  return {
    date: form.date,
    party: form.party.trim(),
    sourceLocation: form.sourceLocation.trim(),
    destinationLocation: form.destinationLocation.trim() || undefined,
    referenceNo: form.referenceNo.trim() || undefined,
    referenceDate: form.referenceDate || undefined,
    vehicleNo: form.vehicleNo.trim() || undefined,
    transporter: form.transporter.trim() || undefined,
    lrNo: form.lrNo.trim() || undefined,
    modeOfTransport: form.modeOfTransport || 'Road',
    linkedDocumentNo: form.linkedDocumentNo.trim() || undefined,
    remarks: form.remarks.trim() || undefined,

    jobOrderNo: form.jobOrderNo.trim() || undefined,
    challanPurpose: form.challanPurpose || undefined,
    processName: form.processName.trim() || undefined,
    expectedReturnDate: form.expectedReturnDate || undefined,
    jobWorkRateApplicable: form.jobWorkRateApplicable,
    gstOnJobWork: form.gstOnJobWork || undefined,

    dcAgainst: form.dcAgainst || undefined,
    salesOrderNo: form.salesOrderNo.trim() || undefined,
    billingAddress: form.billingAddress.trim() || undefined,
    shippingAddress: form.shippingAddress.trim() || undefined,
    gstin: form.gstin.trim() || undefined,
    taxApplicable: form.taxApplicable,
    paymentTerms: form.paymentTerms.trim() || undefined,
    convertToInvoiceLater: form.convertToInvoiceLater,

    transferType: form.transferType || undefined,
    transferRequestNo: form.transferRequestNo.trim() || undefined,
    approvalRequired: form.approvalRequired,
    inTransitTracking: form.inTransitTracking,

    lines: activeLines.map((line) => {
      const q = toNumber(line.qty);
      const r = toNumber(line.rate);
      const amt = toNumber(line.amount) || q * r;

      return {
        itemCode: line.itemCode.trim(),
        qty: q,
        rate: r || undefined,
        amount: amt || undefined,
        hsnCode: line.hsnCode.trim() || undefined,
        uom: line.uom.trim() || 'PCS',
        batchNo: line.batchNo.trim() || undefined,
        heatNo: line.heatNo.trim() || undefined,
        location: line.location.trim(),
        taxPercent: toNumber(line.taxPercent) || undefined,
        transferValue: toNumber(line.transferValue) || undefined,
        remarks: line.remarks.trim() || undefined,
      };
    }),
  };
}

export function validateDeliveryChallanForm(
  config: DeliveryChallanTypeConfig,
  form: DeliveryChallanFormState,
  itemsMap: Map<string, ItemMasterDto>,
  strict: boolean,
  availabilityMap: Record<string, string> = {}
): string[] {
  const errors: string[] = [];

  if (!form.date) {
    errors.push('DC Date is required.');
  }

  if (!form.party.trim()) {
    errors.push(`${config.partyLabel} is required.`);
  }

  if (!form.sourceLocation.trim()) {
    errors.push('From Location is required.');
  }

  if (config.screenId === 'transfer-dc') {
    if (!form.destinationLocation.trim()) {
      errors.push('To Location / Branch is required.');
    }
    if (form.sourceLocation.trim() === form.destinationLocation.trim()) {
      errors.push('From Location and To Location cannot be identical.');
    }
  }

  if (config.screenId === 'jo-dc') {
    if (!form.jobOrderNo.trim()) {
      errors.push('Job Order No is required.');
    }
  }

  if (config.screenId === 'general-dc') {
    if (!form.dcAgainst.trim()) {
      errors.push('DC Against selection is required.');
    }
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

    const qty = toNumber(line.qty);

    if (!qty || qty <= 0) {
      errors.push(`Line ${lineNo}: Qty must be greater than zero.`);
    }

    if (!line.location.trim()) {
      errors.push(`Line ${lineNo}: Location is required.`);
    }

    // FRS §07/BR-INV-TRACE-6: an OUT posting must never exceed store-available stock —
    // Stock Issue already enforces this client-side; DC dispatch relied on the backend's
    // late rejection alone, so a user only found out after submitting.
    if (strict && line.itemCode && qty > 0) {
      const effectiveLocation = line.location || form.sourceLocation;
      if (effectiveLocation) {
        const availableValue = availabilityMap[`${line.itemCode.trim()}||${effectiveLocation}`];
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