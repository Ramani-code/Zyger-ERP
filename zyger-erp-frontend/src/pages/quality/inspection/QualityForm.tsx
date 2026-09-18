import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import apiClient from '../../../api/axiosClient';
import {
  useQualityInspection,
  useQualityInspectionCreate,
  useQualityDecisionQuantitiesUpdate,
  useQualitySaveMeasurements,
  useQualityWorkflow,
} from '../../../hooks/useQuality';
import { useQualityNcrCreate } from '../../../hooks/useQualityNcr';
import { qualityApi } from '../../../services/quality-api';
import inspectionPlanApi from '../../../services/inspectionPlanApi';
import DynamicFormRenderer from '../../../components/common/DynamicFormRenderer';
import type { InspectionCharacteristic } from '../../../components/common/DynamicFormRenderer';
import type {
  CharacteristicLinePayload,
  InspectionLineDto,
  InspectionStatus,
  InspectionType,
} from '../../../types/quality/quality.types';
import { formatDate, toOptionalNumber } from '../../../utils/format';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useToast } from '../../../contexts/ToastContext';
import { masterService } from '../../../services/masterService';
import { lookupDocumentByNumber } from '../../../utils/documentLookup';
import WorkflowStatusStepper from '../../../components/common/WorkflowStatusStepper';
import AttachmentsDrawer from '../../../components/common/AttachmentsDrawer';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';
import AuditHistoryDrawer from '../../../components/common/AuditHistoryDrawer';
import { printDocLabel } from '../../../utils/barcode';

const INSPECTION_TYPES: InspectionType[] = ['IQC', 'LO', 'JOMIN', 'FAI', 'IPQC', 'LINE', 'LAST_OFF', 'FINAL'];

const TYPE_LABELS: Record<InspectionType, string> = {
  IQC: 'Inward (IQC)',
  LO: 'LO',
  JOMIN: 'JOMIN',
  FAI: 'First Article (FAI)',
  IPQC: 'Process (IPQC)',
  LINE: 'Line',
  LAST_OFF: 'Last Off',
  FINAL: 'Final',
};

type DraftLineTemplate = Omit<DraftLine, 'actualValue'>;

const TYPE_TEMPLATES: Record<InspectionType, DraftLineTemplate[]> = {
  IQC: [
    { characteristicCode: 'RM_DIM_OD', characteristicName: 'Raw Material OD / Thickness Check', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'RM_DIM_LEN', characteristicName: 'Raw Material Length Check', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
    { characteristicCode: 'MAT_GRADE', characteristicName: 'Material Grade & Spec Verification', uom: 'SPEC', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'MTC_COC', characteristicName: 'Mill Test Certificate (MTC) / CoC Verified', uom: 'DOC', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'HEAT_NO', characteristicName: 'Heat Number Traceability & Stamping', uom: 'CHK', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'SURFACE_RUST', characteristicName: 'Visual Surface Defect / Rust / Bending Check', uom: 'VIS', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
    { characteristicCode: 'HARDNESS', characteristicName: 'Material Hardness Check (HRC/BHN)', uom: 'HRC', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
  ],
  FAI: [
    { characteristicCode: 'FAI_DIM_1', characteristicName: 'First Article Dimensional Check 1', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'FAI_DIM_2', characteristicName: 'First Article Dimensional Check 2', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'FAI_DIM_3', characteristicName: 'First Article Dimensional Check 3', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'FAI_PROFILE', characteristicName: 'Profile / Form Check', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'FAI_SURFACE', characteristicName: 'Surface Finish (Ra)', uom: 'Ra', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'FAI_HARDNESS', characteristicName: 'Hardness (HRC/BHN)', uom: 'HRC', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
    { characteristicCode: 'FAI_VISUAL', characteristicName: 'Visual / Cosmetic Inspection', uom: 'VIS', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
    { characteristicCode: 'FAI_COC', characteristicName: 'Material Certificate Verified', uom: 'DOC', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
  ],
  IPQC: [
    { characteristicCode: 'IPQC_DIM_1', characteristicName: 'In-Process Dimensional Check 1', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'IPQC_DIM_2', characteristicName: 'In-Process Dimensional Check 2', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
    { characteristicCode: 'IPQC_SURFACE', characteristicName: 'Surface Finish Check', uom: 'Ra', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
    { characteristicCode: 'IPQC_VISUAL', characteristicName: 'Visual / Cosmetic Check', uom: 'VIS', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
  ],
  LINE: [
    { characteristicCode: 'LINE_DIM_1', characteristicName: 'Line Dimensional Check 1', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'LINE_DIM_2', characteristicName: 'Line Dimensional Check 2', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
    { characteristicCode: 'LINE_VISUAL', characteristicName: 'Visual / Cosmetic Check', uom: 'VIS', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
  ],
  LAST_OFF: [
    { characteristicCode: 'LO_DIM_1', characteristicName: 'Last Off Dimensional Check 1', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'LO_DIM_2', characteristicName: 'Last Off Dimensional Check 2', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'LO_SURFACE', characteristicName: 'Surface Finish (Ra)', uom: 'Ra', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
    { characteristicCode: 'LO_VISUAL', characteristicName: 'Visual / Cosmetic Inspection', uom: 'VIS', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
  ],
  LO: [
    { characteristicCode: 'LO_RECV_QTY', characteristicName: 'Received Quantity Verification', uom: 'QTY', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'LO_VISUAL', characteristicName: 'Visual Inspection', uom: 'VIS', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
  ],
  JOMIN: [
    { characteristicCode: 'JOMIN_DIM_1', characteristicName: 'Job Order Dimensional Check 1', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'JOMIN_VISUAL', characteristicName: 'Visual / Cosmetic Check', uom: 'VIS', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
    { characteristicCode: 'JOMIN_COC', characteristicName: 'Subcontract Process Certificate Verified', uom: 'DOC', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
  ],
  FINAL: [
    { characteristicCode: 'FINAL_DIM_1', characteristicName: 'Final Dimensional Check 1', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'FINAL_DIM_2', characteristicName: 'Final Dimensional Check 2', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'FINAL_DIM_3', characteristicName: 'Final Dimensional Check 3', uom: 'mm', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'FINAL_SURFACE', characteristicName: 'Surface Finish (Ra)', uom: 'Ra', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
    { characteristicCode: 'FINAL_VISUAL', characteristicName: 'Final Visual / Cosmetic Inspection', uom: 'VIS', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: false, instrumentCode: '' },
    { characteristicCode: 'FINAL_COC', characteristicName: 'Material & Process Certificates Verified', uom: 'DOC', nominalValue: '', lowerLimit: '', upperLimit: '', isCritical: true, instrumentCode: '' },
  ],
};

interface DraftLine {
  balloonNo?: string;
  characteristicCode: string;
  characteristicName: string;
  uom: string;
  nominalValue: string;
  lowerLimit: string;
  upperLimit: string;
  actualValue: string;
  isCritical: boolean;
  instrumentCode: string;
}

interface QualityFormProps {
  documentId?: string | number | null;
  viewOnly?: boolean;
  onBack: () => void;
  defaultInspectionType?: InspectionType;
}

function emptyDraftLine(): DraftLine {
  return {
    balloonNo: '',
    characteristicCode: '',
    characteristicName: '',
    uom: '',
    nominalValue: '',
    lowerLimit: '',
    upperLimit: '',
    actualValue: '',
    isCritical: false,
    instrumentCode: '',
  };
}

function draftLineFromDto(line: InspectionLineDto): DraftLine {
  return {
    balloonNo: line.balloonNo ?? '',
    characteristicCode: line.characteristicCode ?? '',
    characteristicName: line.characteristicName ?? '',
    uom: line.uom ?? '',
    nominalValue: line.nominalValue != null ? String(line.nominalValue) : '',
    lowerLimit: line.lowerLimit != null ? String(line.lowerLimit) : '',
    upperLimit: line.upperLimit != null ? String(line.upperLimit) : '',
    actualValue: line.actualValue != null ? String(line.actualValue) : '',
    isCritical: Boolean(line.isCritical),
    instrumentCode: line.instrumentCode ?? '',
  };
}

function payloadFromDraftLines(lines: DraftLine[]): CharacteristicLinePayload[] {
  return lines
    .filter((line) => line.characteristicCode.trim() !== '')
    .map((line) => ({
      balloonNo: line.balloonNo?.trim() || undefined,
      characteristicCode: line.characteristicCode.trim(),
      characteristicName: line.characteristicName.trim() || undefined,
      uom: line.uom.trim() || undefined,
      nominalValue: toOptionalNumber(line.nominalValue),
      lowerLimit: toOptionalNumber(line.lowerLimit),
      upperLimit: toOptionalNumber(line.upperLimit),
      actualValue: toOptionalNumber(line.actualValue),
      isCritical: line.isCritical,
      instrumentCode: line.instrumentCode.trim() || undefined,
    }));
}

/** Client-side preview of the engine evaluation (persisted by the backend on save). */
function previewResult(line: DraftLine): 'PASS' | 'FAIL' | 'PENDING' {
  if (line.actualValue.trim() === '') {
    return 'PENDING';
  }

  const actual = Number(line.actualValue);

  if (Number.isNaN(actual)) {
    return 'PENDING';
  }

  const lower = line.lowerLimit.trim() === '' ? null : Number(line.lowerLimit);
  const upper = line.upperLimit.trim() === '' ? null : Number(line.upperLimit);

  if (lower != null && actual < lower) return 'FAIL';
  if (upper != null && actual > upper) return 'FAIL';

  return 'PASS';
}

export function deviationLabel(line: DraftLine): string {
  if (line.actualValue.trim() === '' || line.nominalValue.trim() === '') {
    return '—';
  }

  const actual = Number(line.actualValue);
  const nominal = Number(line.nominalValue);

  if (Number.isNaN(actual) || Number.isNaN(nominal)) {
    return '—';
  }

  return (actual - nominal).toFixed(3);
}

type DecisionModal =
  | { kind: 'decide'; decision: 'PASS' | 'HOLD' | 'REJECT' }
  | { kind: 'hold' }
  | { kind: 'cancel' }
  | { kind: 'close' }
  | { kind: 'reopen' };

export default function QualityForm({ documentId, viewOnly = false, onBack, defaultInspectionType }: QualityFormProps) {
  const { toast } = useToast();
  const { can } = useAuth();

  const isCreateMode = !documentId;

  const documentQuery = useQualityInspection(isCreateMode ? null : documentId);
  const inspection = documentQuery.data;

  const createMutation = useQualityInspectionCreate();
  const decisionQuantitiesMutation = useQualityDecisionQuantitiesUpdate();
  const measurementsMutation = useQualitySaveMeasurements();
  const workflowMutation = useQualityWorkflow();
  const ncrCreateMutation = useQualityNcrCreate();
  const [auditOpen, setAuditOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);

  const [inwardOptions, setInwardOptions] = useState<Array<{ docNo: string; purchaseOrderNo?: string; supplier?: string; date?: string; items?: string }>>([]);
  const [stores, setStores] = useState<Array<{ code: string; name: string }>>([]);

  useEffect(() => {
    void masterService.getStores().then(setStores).catch(() => setStores([]));
  }, []);

  const [nextNumber, setNextNumber] = useState('—');
  const [header, setHeader] = useState(() => ({
    inspectionType: (defaultInspectionType ?? 'IQC') as InspectionType,
    referenceDocNo: '',
    purchaseOrderNumber: '',
    partyCode: '',
    partyName: '',
    supplierChallanNo: '',
    materialGrade: '',
    mtcVerified: false,
    mtcNumber: '',
    ndtStatus: 'NA',
    itemCode: '',
    itemDescription: '',
    location: '',
    receivedQuantity: '',
    inspectionQuantity: '',
    acceptedQuantity: '',
    rejectedQuantity: '',
    reworkQuantity: '',
    holdQuantity: '',
    machine: '',
    operation: '',
    programNumber: '',
    setupNumber: '',
    drawingNumber: '',
    drawingRevision: '',
    inspector: '',
    lotNumber: '',
    batchNumber: '',
    serialNumber: '',
    heatNumber: '',
    remarks: '',
  }));
  const [draftLines, setDraftLines] = useState<DraftLine[]>([emptyDraftLine()]);
  const [planCharacteristics, setPlanCharacteristics] = useState<InspectionCharacteristic[]>([]);
  const [decisionModal, setDecisionModal] = useState<DecisionModal | null>(null);
  const [ncrForm, setNcrForm] = useState({ defectCode: '', quantityAffected: '', severity: 'MAJOR' });
  const [initializedForId, setInitializedForId] = useState('');
  const [spcData, setSpcData] = useState<any[] | null>(null);
  const [spcLoading, setSpcLoading] = useState(false);
  const [spcCharFilter] = useState('');

  useEffect(() => {
    if (isCreateMode) {
      const docTypeKey =
        header.inspectionType === 'IQC'
          ? 'po-inward'
          : header.inspectionType === 'LO'
          ? 'lo-inward'
          : header.inspectionType === 'JOMIN' || header.inspectionType === 'IPQC'
          ? 'job-order'
          : 'general-inward';

      apiClient.get<any>(`/inventory/documents/${docTypeKey}`, { params: { size: 50, sort: 'date,desc' } })
        .then((res) => {
          const content = res.data?.content || (Array.isArray(res.data) ? res.data : []);
          // Only inward documents marked "Quality Inspection Required" should be
          // pickable here — everything else was already posted straight to stock.
          const opts = content
            .filter((d: any) => String(d.qcRequired ?? '').trim().toLowerCase() === 'yes')
            .map((d: any) => ({
              docNo: String(d.docNo || d.number || ''),
              purchaseOrderNo: String(d.purchaseOrderNo || d.purchaseOrderNumber || d.reference || ''),
              supplier: String(d.supplier || d.party || d.supplierName || ''),
              date: String(d.date || d.docDate || ''),
              items: (d.lines || []).map((l: any) => l.itemCode).filter(Boolean).join(', '),
            })).filter((o: any) => Boolean(o.docNo));
          setInwardOptions(opts);
        })
        .catch(() => setInwardOptions([]));
    }
  }, [isCreateMode, header.inspectionType]);

  const updateReferenceDocNo = (value: string) => {
    setHeader((current) => ({ ...current, referenceDocNo: value }));
    if (!value.trim()) return;

    const docTypeKey =
      header.inspectionType === 'IQC'
        ? 'po-inward'
        : header.inspectionType === 'LO'
        ? 'lo-inward'
        : header.inspectionType === 'JOMIN' || header.inspectionType === 'IPQC'
        ? 'job-order'
        : 'general-inward';

    void lookupDocumentByNumber(docTypeKey, value.trim()).then((doc) => {
      if (!doc) return;
      const raw = doc.raw || {};
      const firstLine = doc.lines && doc.lines.length > 0 ? doc.lines[0] : null;

      const poNo = raw.purchaseOrderNo || raw.purchaseOrderNumber || raw.poNo || doc.jobOrderNo || doc.workOrderNo || '';
      const suppCode = raw.supplierCode || raw.partyCode || raw.supplier || doc.supplier || doc.party || '';
      const suppName = raw.supplierName || raw.partyName || doc.party || doc.supplier || suppCode;
      const challanOrInvNo = raw.supplierInvoiceNo || raw.supplierChallanNo || raw.challanNo || raw.dcNumber || raw.invoiceNo || raw.referenceNo || '';
      const itemCd = firstLine?.itemCode || raw.itemCode || raw.firstItemCode || '';
      const itemNm = firstLine?.itemDesc || firstLine?.description || firstLine?.itemName || raw.itemDescription || raw.itemName || raw.firstItemName || '';
      const qtyStr = firstLine?.qty != null && firstLine.qty > 0 ? String(firstLine.qty) : (firstLine?.receivedQty != null ? String(firstLine.receivedQty) : '');

      setHeader((current) => ({
        ...current,
        referenceDocNo: doc.docNo || value.trim(),
        purchaseOrderNumber: poNo || current.purchaseOrderNumber,
        partyCode: suppCode || current.partyCode,
        partyName: suppName || current.partyName,
        supplierChallanNo: challanOrInvNo || current.supplierChallanNo,
        itemCode: itemCd || current.itemCode,
        itemDescription: itemNm || current.itemDescription,
        location: firstLine?.location || raw.location || current.location,
        receivedQuantity: qtyStr || current.receivedQuantity,
        inspectionQuantity: qtyStr || current.inspectionQuantity,
        acceptedQuantity: qtyStr || current.acceptedQuantity,
        batchNumber: firstLine?.batchNo || raw.batchNo || current.batchNumber,
        heatNumber: firstLine?.heatNo || raw.heatNo || current.heatNumber,
        drawingNumber: raw.drawingNo || raw.drawingNumber || firstLine?.drawingNumber || current.drawingNumber,
        drawingRevision: raw.drawingRev || raw.drawingRevision || firstLine?.drawingRevision || current.drawingRevision,
        materialGrade: raw.materialGrade || raw.grade || firstLine?.materialGrade || current.materialGrade,
      }));

      if (itemCd) {
        void masterService.getItems().then((items) => {
          const item = items.find((i) => i.code === itemCd.trim());
          if (item) {
            setHeader((current) => ({
              ...current,
              itemDescription: current.itemDescription || item.description || '',
            }));
          }
        });
      }

      // Pre-seed default characteristic inspection lines if only 1 blank line exists.
      // Skipped for IQC — that flow doesn't use the characteristics grid at all.
      const typeTemplates = header.inspectionType === 'IQC' ? null : TYPE_TEMPLATES[header.inspectionType as InspectionType];
      if (typeTemplates && typeTemplates.length > 0) {
        setDraftLines((lines) => {
          if (lines.length <= 1 && (!lines[0]?.characteristicCode || lines[0]?.characteristicCode === '')) {
            return typeTemplates.map((t) => ({ ...t, actualValue: '' }));
          }
          return lines;
        });
      }
    });
  };

  const updateItemCode = (value: string) => {
    setHeader((current) => ({ ...current, itemCode: value }));
    if (!value.trim()) return;

    void masterService.getItems().then((items) => {
      const item = items.find((i) => i.code === value.trim());
      if (item) {
        setHeader((current) => ({
          ...current,
          itemDescription: item.description || current.itemDescription,
        }));
        setDraftLines((current) =>
          current.map((line, idx) => (idx === 0 && !line.uom ? { ...line, uom: item.uom } : line))
        );
      }
    });
  };

  useEffect(() => {
    const typeParam = header.inspectionType ? `?inspectionType=${header.inspectionType}` : '';
    qualityApi.getNextNumber(typeParam).then((result) => setNextNumber(result.nextNumber)).catch(() => setNextNumber('—'));
  }, [isCreateMode, header.inspectionType]);

  // Auto-load InspectionPlan characteristics when item code + type are set
  useEffect(() => {
    if (!isCreateMode || !header.itemCode.trim() || !header.inspectionType || header.inspectionType === 'IQC') {
      setPlanCharacteristics([]);
      return;
    }
    let cancelled = false;
    inspectionPlanApi
      .getByItemAndType(header.itemCode.trim(), header.inspectionType)
      .then((plan) => {
        if (cancelled || !plan || !plan.characteristics?.length) return;
        setPlanCharacteristics(plan.characteristics);
        // Auto-populate draft lines from plan if current lines are blank
        setDraftLines((lines) => {
          if (lines.length <= 1 && !lines[0]?.characteristicCode) {
            return plan.characteristics.map((ch) => ({
              balloonNo: ch.balloonNo || '',
              characteristicCode: ch.characteristicCode,
              characteristicName: ch.characteristicName,
              uom: ch.uom || '',
              nominalValue: String(ch.nominalValue ?? ''),
              lowerLimit: String(ch.lowerLimit ?? ''),
              upperLimit: String(ch.upperLimit ?? ''),
              actualValue: '',
              isCritical: ch.isCritical || false,
              isMandatory: ch.isMandatory || false,
              instrumentCode: '',
              dataType: ch.dataType || 'NUMERIC',
              specificationText: ch.specificationText || '',
            }));
          }
          return lines;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isCreateMode, header.itemCode, header.inspectionType]);

  const [aqlResult, setAqlResult] = useState<{ sampleSize: number; acceptNumber: number; rejectNumber: number } | null>(null);

  // §6.2: Auto-calculate AQL sample size when received quantity (lot size) changes
  useEffect(() => {
    if (!isCreateMode || !header.receivedQuantity) { setAqlResult(null); return; }
    const lotSize = parseInt(String(header.receivedQuantity), 10);
    if (isNaN(lotSize) || lotSize <= 0) return;
    let cancelled = false;
    apiClient.get('/master/aql-lookup', { params: { lotSize } })
      .then(({ data }) => {
        if (cancelled || !data?.found) { setAqlResult(null); return; }
        setAqlResult({ sampleSize: data.sampleSize, acceptNumber: data.acceptNumber, rejectNumber: data.rejectNumber });
        // Auto-fill inspection quantity if currently empty
        setHeader((current) => ({
          ...current,
          inspectionQuantity: current.inspectionQuantity || String(data.sampleSize),
        }));
      })
      .catch(() => { setAqlResult(null); });
    return () => { cancelled = true; };
  }, [isCreateMode, header.receivedQuantity]);

  useEffect(() => {
    if (!inspection || !documentId) {
      return;
    }

    const key = String(documentId);

    if (initializedForId === key) {
      return;
    }

    setInitializedForId(key);
    setHeader({
      inspectionType: inspection.inspectionType,
      referenceDocNo: inspection.sourceNumber ?? inspection.referenceNumber ?? inspection.referenceDocNo ?? '',
      purchaseOrderNumber: inspection.purchaseOrderNumber ?? '',
      partyCode: inspection.partyCode ?? '',
      partyName: inspection.partyName ?? '',
      supplierChallanNo: inspection.supplierChallanNo ?? '',
      materialGrade: inspection.materialGrade ?? '',
      mtcVerified: inspection.mtcVerified ?? false,
      mtcNumber: inspection.mtcNumber ?? '',
      ndtStatus: inspection.ndtStatus ?? 'NA',
      itemCode: inspection.itemCode ?? '',
      itemDescription: inspection.itemDescription ?? '',
      location: inspection.location ?? '',
      receivedQuantity: inspection.receivedQuantity != null ? String(inspection.receivedQuantity) : '',
      inspectionQuantity: inspection.inspectionQuantity != null ? String(inspection.inspectionQuantity) : '',
      acceptedQuantity: inspection.acceptedQuantity != null ? String(inspection.acceptedQuantity) : '',
      rejectedQuantity: inspection.rejectedQuantity != null ? String(inspection.rejectedQuantity) : '',
      reworkQuantity: inspection.reworkQuantity != null ? String(inspection.reworkQuantity) : '',
      holdQuantity: inspection.holdQuantity != null ? String(inspection.holdQuantity) : '',
      machine: inspection.machine ?? '',
      operation: inspection.operation ?? '',
      programNumber: inspection.programNumber ?? '',
      setupNumber: inspection.setupNumber ?? '',
      drawingNumber: inspection.drawingNumber ?? '',
      drawingRevision: inspection.drawingRevision ?? '',
      inspector: inspection.inspector ?? inspection.assignedInspector ?? '',
      lotNumber: inspection.lotNumber ?? '',
      batchNumber: inspection.batchNumber ?? '',
      serialNumber: inspection.serialNumber ?? '',
      heatNumber: inspection.heatNumber ?? '',
      remarks: inspection.remarks ?? '',
    });
    setDraftLines(
      (inspection.lines ?? []).length > 0
        ? inspection.lines.map(draftLineFromDto)
        : [emptyDraftLine()]
    );
  }, [inspection, documentId, initializedForId]);

  const status: InspectionStatus = inspection?.inspectionStatus ?? 'DRAFT';
  const allowedTransitions = (inspection?._allowedTransitions as string[]) ?? [];
  const isTerminal = Boolean(inspection?._isTerminal);
  const measurementsEditable =
    !viewOnly && !isCreateMode && !['CLOSED', 'APPROVED', 'CANCELLED'].includes(status);

  const isBusy =
    createMutation.isPending ||
    measurementsMutation.isPending ||
    workflowMutation.isPending ||
    ncrCreateMutation.isPending;

  const summary = useMemo(() => {
    const evaluated = draftLines.filter((line) => previewResult(line) !== 'PENDING');

    return {
      total: draftLines.filter((line) => line.characteristicCode.trim() !== '').length,
      passed: evaluated.filter((line) => previewResult(line) === 'PASS').length,
      failed: evaluated.filter((line) => previewResult(line) === 'FAIL').length,
      criticalFailed: draftLines.filter((line) => line.isCritical && previewResult(line) === 'FAIL').length,
    };
  }, [draftLines]);

  const updateDraftLine = (index: number, changes: Partial<DraftLine>) => {
    setDraftLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...changes } : line))
    );
  };

  void summary;
  void updateDraftLine;

  const handleCreate = async () => {
    let payloadLines = payloadFromDraftLines(draftLines);

    if (!header.itemCode.trim()) {
      toast('Item code is required.', 'error');
      return;
    }

    if (!header.location.trim()) {
      toast('Store Location is required.', 'error');
      return;
    }

    if (payloadLines.length === 0) {
      payloadLines = [
        {
          characteristicCode: 'INSP_GEN',
          characteristicName: 'General Quality Inspection',
          uom: 'PCS',
          isCritical: false,
        },
      ];
    }

    try {
      const created = await createMutation.mutateAsync({
        inspectionType: header.inspectionType,
        inspectionStatus: 'PASS',
        decisionStatus: 'PASS',
        directInventoryUpdate: true,
        itemCode: header.itemCode.trim(),
        itemDescription: header.itemDescription.trim() || undefined,
        location: header.location.trim() || undefined,
        referenceDocNo: header.referenceDocNo.trim() || undefined,
        purchaseOrderNumber: header.purchaseOrderNumber.trim() || undefined,
        partyCode: header.partyCode.trim() || undefined,
        partyName: header.partyName.trim() || undefined,
        supplierChallanNo: header.supplierChallanNo.trim() || undefined,
        materialGrade: header.materialGrade.trim() || undefined,
        mtcVerified: header.mtcVerified,
        mtcNumber: header.mtcNumber.trim() || undefined,
        ndtStatus: header.ndtStatus || undefined,
        receivedQuantity: Number(header.receivedQuantity || 0),
        inspectionQuantity: Number(header.inspectionQuantity || 0),
        acceptedQuantity: toOptionalNumber(header.acceptedQuantity),
        rejectedQuantity: toOptionalNumber(header.rejectedQuantity),
        reworkQuantity: toOptionalNumber(header.reworkQuantity),
        holdQuantity: toOptionalNumber(header.holdQuantity),
        machine: header.machine.trim() || undefined,
        operation: header.operation.trim() || undefined,
        programNumber: header.programNumber.trim() || undefined,
        setupNumber: header.setupNumber.trim() || undefined,
        drawingNumber: header.drawingNumber.trim() || undefined,
        drawingRevision: header.drawingRevision.trim() || undefined,
        inspector: header.inspector.trim() || undefined,
        lotNumber: header.lotNumber.trim() || undefined,
        batchNumber: header.batchNumber.trim() || undefined,
        serialNumber: header.serialNumber.trim() || undefined,
        heatNumber: header.heatNumber.trim() || undefined,
        remarks: header.remarks.trim() || undefined,
        lines: payloadLines,
      });

      toast(`${created.docNo ?? 'Inspection'} marked PASSED and inventory updated with accepted qty.`);
      onBack();
    } catch (createError) {
      toast(getApiErrorMessage(createError, 'Create failed.'), 'error');
    }
  };

  const runWorkflow = async (
    action: Parameters<typeof workflowMutation.mutateAsync>[0]['action'],
    remarks?: string,
    decision?: 'PASS' | 'HOLD' | 'REJECT'
  ) => {
    if (!documentId) {
      return;
    }

    try {
      // Persist Accepted/Rejected/Rework/Hold Qty and Store Location before advancing the
      // workflow — these are typed on this screen and are exactly what the release posts to
      // stock, but nothing else saves them. Without this, approve() acted on stale/empty
      // server-side values and released the full inspected qty instead of just what was
      // accepted. Narrower than the generic update endpoint on purpose: that one replaces
      // the whole characteristics/lines collection and requires DRAFT/REJECTED, so it can't
      // be reused here without either wiping evaluated results or blocking on SUBMITTED.
      if (!viewOnly) {
        await decisionQuantitiesMutation.mutateAsync({
          id: documentId,
          payload: {
            acceptedQuantity: toOptionalNumber(header.acceptedQuantity),
            rejectedQuantity: toOptionalNumber(header.rejectedQuantity),
            reworkQuantity: toOptionalNumber(header.reworkQuantity),
            holdQuantity: toOptionalNumber(header.holdQuantity),
            location: header.location.trim() || undefined,
            remarks: header.remarks.trim() || undefined,
          },
        });
      }

      const updated = await workflowMutation.mutateAsync({
        id: documentId,
        action,
        decision,
        remarks,
      });

      setDecisionModal(null);
      toast(`${updated.docNo ?? 'Inspection'} • ${action} completed.`);
    } catch (actionError) {
      toast(getApiErrorMessage(actionError, `${action} failed.`), 'error');
    }
  };

  const handleWorkflowAction = (act: string) => {
    switch (act) {
      case 'submit': runWorkflow('submit'); break;
      case 'approve': runWorkflow('decide', undefined, 'PASS'); break;
      case 'reject': runWorkflow('decide', undefined, 'REJECT'); break;
      case 'hold': runWorkflow('decide', undefined, 'HOLD'); break;
      case 'start': runWorkflow('start'); break;
      case 'close': runWorkflow('close'); break;
      case 'cancel': runWorkflow('cancel'); break;
      case 'reopen': runWorkflow('reopen'); break;
    }
  };

  const runUpdateInventory = async () => {
    if (!documentId || !inspection) {
      return;
    }
    try {
      if (!viewOnly) {
        const payloadLines = payloadFromDraftLines(draftLines);
        if (payloadLines.length > 0) {
          await measurementsMutation.mutateAsync({
            id: documentId,
            lines: payloadLines,
          });
        }
        await decisionQuantitiesMutation.mutateAsync({
          id: documentId,
          payload: {
            acceptedQuantity: toOptionalNumber(header.acceptedQuantity),
            rejectedQuantity: toOptionalNumber(header.rejectedQuantity),
            reworkQuantity: toOptionalNumber(header.reworkQuantity),
            holdQuantity: toOptionalNumber(header.holdQuantity),
            location: header.location.trim() || undefined,
            remarks: header.remarks.trim() || undefined,
          },
        });
      }
      const updated = await apiClient.post(`/v1/quality/inspections/${documentId}/update-inventory`, {});
      const accepted = toOptionalNumber(header.acceptedQuantity);
      toast(
        `${(updated.data?.docNo ?? 'Inspection')} • inventory updated — only the accepted qty${accepted ? ` (${accepted})` : ''} was released.`,
        'success'
      );
      documentQuery.refetch();
    } catch (actionError) {
      toast(getApiErrorMessage(actionError, 'Update Inventory failed.'), 'error');
    }
  };

  const handleCreateNcr = async () => {
    if (!documentId || !inspection) {
      return;
    }

    if (!ncrForm.defectCode.trim()) {
      toast('Defect code is required.', 'error');
      return;
    }

    try {
      const ncr = await ncrCreateMutation.mutateAsync({
        inspectionId: Number(documentId),
        itemCode: inspection.itemCode ?? '',
        quantityAffected: Number(ncrForm.quantityAffected || 0),
        defectCode: ncrForm.defectCode.trim(),
        severity: ncrForm.severity as 'CRITICAL' | 'MAJOR' | 'MINOR' | 'ADVISORY',
      });

      setNcrForm({ defectCode: '', quantityAffected: '', severity: 'MAJOR' });
      toast(`${ncr.docNo ?? 'NCR'} created — inspection can now be closed.`);
    } catch (ncrError) {
      toast(getApiErrorMessage(ncrError, 'NCR creation failed.'), 'error');
    }
  };

  if (!isCreateMode && documentQuery.isPending) {
    return (
      <div className="panel">
        <div className="empty">
          <span className="material-symbols-rounded">hourglass_empty</span>
          Loading inspection...
        </div>
      </div>
    );
  }

  if (!isCreateMode && documentQuery.isError) {
    return (
      <div className="panel">
        <div className="empty">
          <span className="material-symbols-rounded">error</span>
          {getApiErrorMessage(documentQuery.error, 'Unable to load inspection.')}
          <div style={{ marginTop: '14px' }}>
            <button className="btn" onClick={() => documentQuery.refetch()}>
              <span className="material-symbols-rounded">refresh</span>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const docNo = inspection?.docNo ?? nextNumber;
  // Inward (IQC) inspection is meant to be a plain accept/reject-and-store-update step,
  // not a full dimensional/process inspection — hide the characteristics grid, SPC chart,
  // and machine/drawing/certificate fields that don't apply to a raw-material receipt.
  const isIqc = header.inspectionType === 'IQC';

  return (
    <>
      <div className="pg-head">
        <h1>
          {viewOnly ? 'View' : isCreateMode ? 'New' : 'Open'} Inspection — {docNo}
        </h1>
        <p>
          {TYPE_LABELS[header.inspectionType]} • Workflow: DRAFT → IN_PROGRESS → SUBMITTED →
          PASS/HOLD/FAIL → CLOSED
        </p>
      </div>

      {!isCreateMode && (
        <div className="note">
          <span className="material-symbols-rounded">info</span>
          <span>
            Auto-evaluation: PASS when lower ≤ actual ≤ upper • Critical failures force HOLD •
            Failed characteristics require an NCR before closing
          </span>
        </div>
      )}

      <form onSubmit={(event) => event.preventDefault()}>
        <div className="panel">
          <div className="panel-h">
            <h2>
              <span className="material-symbols-rounded">description</span>
              Header
            </h2>

            {!isCreateMode && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button type="button" className="btn btn-sm" title="Print Label" onClick={() => {
                  printDocLabel(docNo, 'QUALITY_INSPECTION', `${header.inspectionType} - ${header.referenceDocNo || docNo}`);
                }}>
                  <span className="material-symbols-rounded">qr_code_2</span>
                </button>
                <button type="button" className="btn btn-sm" title="Attachments" onClick={() => setAttachmentsOpen(true)}>
                  <span className="material-symbols-rounded">attach_file</span>
                </button>
                <button type="button" className="btn btn-sm" title="Audit History" onClick={() => setAuditOpen(true)}>
                  <span className="material-symbols-rounded">history</span> Audit
                </button>
                <WorkflowStatusStepper
                  currentStatus={status}
                  allowedTransitions={allowedTransitions}
                  isTerminal={isTerminal}
                  onAction={(act) => handleWorkflowAction(act)}
                />
              </div>
            )}
          </div>

          <div className="fgrid">
            <label className="fld">
              <span>Inspection No</span>
              <input className="in" value={docNo} readOnly tabIndex={-1} />
            </label>

            <label className="fld">
              <span>
                Type <em>*</em>
              </span>
              <select
                className="in"
                value={header.inspectionType}
                disabled={!isCreateMode || Boolean(defaultInspectionType)}
                onChange={(event) =>
                  setHeader((current) => ({
                    ...current,
                    inspectionType: event.target.value as InspectionType,
                  }))
                }
              >
                {INSPECTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>

            {isCreateMode && !isIqc && (
              <label className="fld">
                <span>&nbsp;</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const tpl = TYPE_TEMPLATES[header.inspectionType as InspectionType];
                    if (tpl && tpl.length > 0) {
                      setDraftLines(tpl.map((t) => ({ ...t, actualValue: '' })));
                      toast(`Loaded ${TYPE_LABELS[header.inspectionType as InspectionType]} template (${tpl.length} characteristics)`);
                    }
                  }}
                >
                  <span className="material-symbols-rounded">content_copy</span> Load Template
                </button>
              </label>
            )}

            <label className="fld">
              <span>Ref Doc No (GRN / Inward / JO / PO)</span>
              {isCreateMode && inwardOptions.length > 0 ? (
                <select
                  className="in"
                  value={header.referenceDocNo}
                  onChange={(event) => updateReferenceDocNo(event.target.value)}
                >
                  <option value="">-- Select Reference Doc --</option>
                  {inwardOptions.map((opt) => (
                    <option key={opt.docNo} value={opt.docNo}>
                      {opt.docNo} {opt.purchaseOrderNo ? `(PO: ${opt.purchaseOrderNo})` : ''} {opt.supplier ? `• ${opt.supplier}` : ''} {opt.items ? `[${opt.items}]` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="in"
                  placeholder="Enter ref doc no to auto-fill..."
                  value={header.referenceDocNo}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) => updateReferenceDocNo(event.target.value)}
                />
              )}
            </label>

            <label className="fld">
              <span>Purchase Order No</span>
              <input
                className="in"
                placeholder="e.g. PO-2026-0089"
                value={header.purchaseOrderNumber}
                readOnly={!isCreateMode && !measurementsEditable}
                onChange={(event) =>
                  setHeader((current) => ({ ...current, purchaseOrderNumber: event.target.value }))
                }
              />
            </label>

            <label className="fld">
              <span>Supplier Code & Name</span>
              <input
                className="in"
                placeholder="e.g. SUP-001 • Apex Metals Corp"
                value={
                  header.partyCode && header.partyName && !header.partyName.includes(header.partyCode)
                    ? `${header.partyCode} • ${header.partyName}`
                    : header.partyName || header.partyCode
                }
                readOnly={!isCreateMode && !measurementsEditable}
                onChange={(event) => {
                  const val = event.target.value;
                  setHeader((current) => ({ ...current, partyName: val }));
                }}
              />
            </label>

            <label className="fld">
              <span>Supplier Invoice / Challan No</span>
              <input
                className="in"
                placeholder="e.g. INV-8821 / DC-4091"
                value={header.supplierChallanNo}
                readOnly={!isCreateMode && !measurementsEditable}
                onChange={(event) =>
                  setHeader((current) => ({ ...current, supplierChallanNo: event.target.value }))
                }
              />
            </label>

            {!isIqc && (
              <label className="fld">
                <span>Material Grade / Specification</span>
                <input
                  className="in"
                  placeholder="e.g. SS304, AL6061-T6, EN8"
                  value={header.materialGrade}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, materialGrade: event.target.value }))
                  }
                />
              </label>
            )}

            {!isIqc && (
              <label className="fld">
                <span>MTC / CoC Verified?</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                  <input
                    type="checkbox"
                    id="mtcVerifiedCheck"
                    checked={header.mtcVerified}
                    disabled={!isCreateMode && !measurementsEditable}
                    onChange={(event) =>
                      setHeader((current) => ({ ...current, mtcVerified: event.target.checked }))
                    }
                  />
                  <label htmlFor="mtcVerifiedCheck" style={{ fontSize: '0.82rem', cursor: 'pointer', margin: 0 }}>
                    Mill Test Cert Verified
                  </label>
                </div>
              </label>
            )}

            {!isIqc && (
              <label className="fld">
                <span>MTC Certificate No</span>
                <input
                  className="in"
                  placeholder="e.g. MTC-2026-904"
                  value={header.mtcNumber}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, mtcNumber: event.target.value }))
                  }
                />
              </label>
            )}

            {!isIqc && (
              <label className="fld">
                <span>NDT / Ultrasonic Clearance</span>
                <select
                  className="in"
                  value={header.ndtStatus}
                  disabled={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, ndtStatus: event.target.value }))
                  }
                >
                  <option value="NA">N/A (Not Applicable)</option>
                  <option value="PASS">PASS (UT Cleared)</option>
                  <option value="FAIL">FAIL (Defect Detected)</option>
                  <option value="PENDING">PENDING (Testing Underway)</option>
                </select>
              </label>
            )}

            <label className="fld">
              <span>
                Item Code <em>*</em>
              </span>
              <input
                className="in"
                value={header.itemCode}
                readOnly={!isCreateMode && !measurementsEditable}
                onChange={(event) => updateItemCode(event.target.value)}
              />
            </label>

            <label className="fld">
              <span>
                Item Name <em>*</em>
              </span>
              <input
                className="in"
                placeholder="Enter item name..."
                value={header.itemDescription}
                readOnly={!isCreateMode && !measurementsEditable}
                onChange={(event) =>
                  setHeader((current) => ({ ...current, itemDescription: event.target.value }))
                }
              />
            </label>

            <label className="fld">
              <span>
                Store Location <em>*</em>
              </span>
              <select
                className="in"
                value={header.location}
                disabled={!isCreateMode && !measurementsEditable}
                onChange={(event) =>
                  setHeader((current) => ({ ...current, location: event.target.value }))
                }
              >
                <option value="">-- Select Store --</option>
                {stores.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name || s.code}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld">
              <span>
                Received Qty <em>*</em>
              </span>
              <input
                type="number"
                className="in"
                value={header.receivedQuantity}
                readOnly={!isCreateMode && !measurementsEditable}
                onChange={(event) =>
                  setHeader((current) => ({ ...current, receivedQuantity: event.target.value }))
                }
              />
            </label>

            {!isIqc && (
              <label className="fld">
                <span>
                  Inspection Qty <em>*</em>
                </span>
                <input
                  type="number"
                  className="in"
                  value={header.inspectionQuantity}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, inspectionQuantity: event.target.value }))
                  }
                />
                {aqlResult && (
                  <span className="text-xs text-blue-600 mt-0.5">
                    AQL sample: {aqlResult.sampleSize} | Accept: {aqlResult.acceptNumber} | Reject: {aqlResult.rejectNumber}
                  </span>
                )}
              </label>
            )}

            {!isIqc && (
              <label className="fld">
                <span>Lot No</span>
                <input
                  className="in"
                  value={header.lotNumber}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, lotNumber: event.target.value }))
                  }
                />
              </label>
            )}

            <label className="fld">
              <span>Batch No</span>
              <input
                className="in"
                value={header.batchNumber}
                readOnly={!isCreateMode && !measurementsEditable}
                onChange={(event) =>
                  setHeader((current) => ({ ...current, batchNumber: event.target.value }))
                }
              />
            </label>

            {!isIqc && (
              <label className="fld">
                <span>Serial No</span>
                <input
                  className="in"
                  value={header.serialNumber}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, serialNumber: event.target.value }))
                  }
                />
              </label>
            )}

            <label className="fld">
              <span>Heat No</span>
              <input
                className="in"
                value={header.heatNumber}
                readOnly={!isCreateMode && !measurementsEditable}
                onChange={(event) =>
                  setHeader((current) => ({ ...current, heatNumber: event.target.value }))
                }
              />
            </label>

            {!isIqc && (
              <label className="fld">
                <span>CNC Machine / Equip ID</span>
                <input
                  className="in"
                  placeholder="e.g. VMC-01, CNC-LATHE-02"
                  value={header.machine}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, machine: event.target.value }))
                  }
                />
              </label>
            )}

            {!isIqc && (
              <label className="fld">
                <span>Operation No / Name</span>
                <input
                  className="in"
                  placeholder="e.g. Op 10 Turning"
                  value={header.operation}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, operation: event.target.value }))
                  }
                />
              </label>
            )}

            {!isIqc && (
              <label className="fld">
                <span>CNC Program No</span>
                <input
                  className="in"
                  placeholder="e.g. O1002"
                  value={header.programNumber}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, programNumber: event.target.value }))
                  }
                />
              </label>
            )}

            {!isIqc && (
              <label className="fld">
                <span>Setup No</span>
                <input
                  className="in"
                  placeholder="e.g. Setup 1"
                  value={header.setupNumber}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, setupNumber: event.target.value }))
                  }
                />
              </label>
            )}

            {!isIqc && (
              <label className="fld">
                <span>Drawing No</span>
                <input
                  className="in"
                  value={header.drawingNumber}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, drawingNumber: event.target.value }))
                  }
                />
              </label>
            )}

            {!isIqc && (
              <label className="fld">
                <span>Drawing Rev</span>
                <input
                  className="in"
                  value={header.drawingRevision}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, drawingRevision: event.target.value }))
                  }
                />
              </label>
            )}

            {!isIqc && (
              <label className="fld">
                <span>Inspector / Operator</span>
                <input
                  className="in"
                  value={header.inspector}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, inspector: event.target.value }))
                  }
                />
              </label>
            )}

            <label className="fld">
              <span>Accepted Qty</span>
              <input
                type="number"
                className="in"
                value={header.acceptedQuantity}
                readOnly={!isCreateMode && !measurementsEditable}
                onChange={(event) => {
                  const val = event.target.value;
                  const accepted = Number(val);
                  const recv = Number(header.receivedQuantity || header.inspectionQuantity || 0);
                  let rejStr = header.rejectedQuantity;
                  if (!isNaN(accepted) && recv > 0) {
                    const rej = Math.max(0, recv - accepted);
                    rejStr = String(rej);
                  }
                  setHeader((current) => ({
                    ...current,
                    acceptedQuantity: val,
                    rejectedQuantity: rejStr,
                  }));
                }}
              />
            </label>

            <label className="fld">
              <span>Rejected Qty</span>
              <input
                type="number"
                className="in"
                value={header.rejectedQuantity}
                readOnly={!isCreateMode && !measurementsEditable}
                onChange={(event) =>
                  setHeader((current) => ({ ...current, rejectedQuantity: event.target.value }))
                }
              />
            </label>

            {!isIqc && (
              <label className="fld">
                <span>Rework Qty</span>
                <input
                  type="number"
                  className="in"
                  value={header.reworkQuantity}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, reworkQuantity: event.target.value }))
                  }
                />
              </label>
            )}

            {!isIqc && (
              <label className="fld">
                <span>Hold Qty</span>
                <input
                  type="number"
                  className="in"
                  value={header.holdQuantity}
                  readOnly={!isCreateMode && !measurementsEditable}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, holdQuantity: event.target.value }))
                  }
                />
              </label>
            )}

            <label className="fld span2">
              <span>Remarks</span>
              <input
                className="in"
                value={header.remarks}
                readOnly={!isCreateMode && !measurementsEditable}
                onChange={(event) =>
                  setHeader((current) => ({ ...current, remarks: event.target.value }))
                }
              />
            </label>
          </div>
        </div>

        {/* Dynamic characteristics grid — plan-driven or manual. Not shown for Inward (IQC):
            that flow is a plain accept/reject + stock update, not a dimensional inspection. */}
        {!isIqc && (
        <div className="panel">
          <div className="panel-h">
            <h2>
              <span className="material-symbols-rounded">checklist</span>
              Characteristics
              {planCharacteristics.length > 0 && (
                <span style={{ fontSize: 12, color: '#a6e3a1', marginLeft: 8, fontWeight: 400 }}>
                  (from Inspection Plan: {planCharacteristics.length} loaded)
                </span>
              )}
            </h2>
          </div>
          <DynamicFormRenderer
            characteristics={planCharacteristics.length > 0 ? planCharacteristics : draftLines}
            draftLines={draftLines}
            onUpdate={(idx, field, value) => {
              setDraftLines((current) =>
                current.map((line, i) => (i === idx ? { ...line, [field]: value } : line))
              );
            }}
            onPaste={(rows) => {
              setDraftLines((lines) => {
                const updated = [...lines];
                rows.forEach((row, ri) => {
                  const idx = ri < updated.length ? ri : updated.length;
                  if (idx >= updated.length) return;
                  if (row[0]) updated[idx] = { ...updated[idx], actualValue: row[0] };
                  if (row[1]) updated[idx] = { ...updated[idx], instrumentCode: row[1] };
                });
                return updated;
              });
            }}
            readOnly={viewOnly}
          />
          {!viewOnly && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, padding: '0 4px' }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setDraftLines((current) => [...current, emptyDraftLine()]);
                }}
              >
                <span className="material-symbols-rounded">add</span> Add Line
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  const tpl = TYPE_TEMPLATES[header.inspectionType as InspectionType];
                  if (tpl && tpl.length > 0) {
                    setPlanCharacteristics([]);
                    setDraftLines(tpl.map((t) => ({ ...t, actualValue: '' })));
                    toast(`Loaded ${TYPE_LABELS[header.inspectionType as InspectionType]} template (${tpl.length} characteristics)`);
                  }
                }}
              >
                <span className="material-symbols-rounded">content_copy</span> Load Template
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  if (!header.itemCode.trim()) {
                    toast('Enter item code first to load from plan.', 'error');
                    return;
                  }
                  const plan = await inspectionPlanApi.getByItemAndType(header.itemCode.trim(), header.inspectionType);
                  if (plan && plan.characteristics?.length) {
                    setPlanCharacteristics(plan.characteristics);
                    setDraftLines(plan.characteristics.map((ch) => ({
                      balloonNo: ch.balloonNo || '',
                      characteristicCode: ch.characteristicCode,
                      characteristicName: ch.characteristicName,
                      uom: ch.uom || '',
                      nominalValue: String(ch.nominalValue ?? ''),
                      lowerLimit: String(ch.lowerLimit ?? ''),
                      upperLimit: String(ch.upperLimit ?? ''),
                      actualValue: '',
                      isCritical: ch.isCritical || false,
                      isMandatory: ch.isMandatory || false,
                      instrumentCode: '',
                      dataType: ch.dataType || 'NUMERIC',
                      specificationText: ch.specificationText || '',
                    })));
                    toast(`Loaded Inspection Plan: ${plan.characteristics.length} characteristics`);
                  } else {
                    toast('No Inspection Plan found for this item/type.', 'error');
                  }
                }}
              >
                <span className="material-symbols-rounded">auto_fix_high</span> Load from Plan
              </button>
            </div>
          )}
        </div>
        )}

        {!isIqc && header.itemCode && (
          <div className="panel">
            <div className="panel-h">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-symbols-rounded">monitoring</span>
                SPC Chart
                {spcData && <span style={{ fontSize: 12, color: '#a6e3a1', fontWeight: 400 }}>({spcData.length} characteristic{spcData.length !== 1 ? 's' : ''})</span>}
              </h2>
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  setSpcLoading(true);
                  try {
                    const params = new URLSearchParams({ itemCode: header.itemCode });
                    if (spcCharFilter) params.set('characteristicCode', spcCharFilter);
                    const { data } = await apiClient.get(`/v1/quality/spc?${params.toString()}`);
                    setSpcData(data.characteristics ?? []);
                  } catch (e) { toast(getApiErrorMessage(e, 'SPC load failed.'), 'error'); }
                  setSpcLoading(false);
                }}
                disabled={spcLoading}
              >
                <span className="material-symbols-rounded">{spcLoading ? 'hourglass_empty' : 'refresh'}</span>
                {spcData ? 'Refresh' : 'Load SPC'}
              </button>
            </div>
            {!spcData && !spcLoading && (
              <p style={{ padding: '12px 16px', color: '#888', fontSize: 13 }}>Click "Load SPC" to view historical measurement data for item <strong>{header.itemCode}</strong>.</p>
            )}
            {spcLoading && <p style={{ padding: '12px 16px', color: '#888', fontSize: 13 }}>Loading SPC data...</p>}
            {spcData && spcData.length === 0 && (
              <p style={{ padding: '12px 16px', color: '#888', fontSize: 13 }}>No historical measurement data found for <strong>{header.itemCode}</strong>.</p>
            )}
            {spcData && spcData.length > 0 && (
              <div style={{ padding: '0 16px 16px' }}>
                {spcData.map((ch: any) => {
                  const samples: any[] = ch.samples ?? [];
                  const values = samples.map((s) => Number(s.value)).filter((v) => !isNaN(v));
                  if (values.length === 0) return null;
                  const lsl = Number(ch.lowerLimit);
                  const usl = Number(ch.upperLimit);
                  const mean = values.reduce((a, b) => a + b, 0) / values.length;
                  const maxVal = Math.max(...values, usl || 0);
                  const minVal = Math.min(...values, lsl || 0);
                  const range = maxVal - minVal || 1;
                  const chartH = 120;
                  const barW = Math.max(20, Math.min(40, 600 / values.length));

                  const toY = (v: number) => chartH - ((v - minVal) / range) * chartH;

                  return (
                    <div key={ch.characteristicCode} style={{ marginBottom: 16, border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, padding: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div>
                          <strong style={{ fontSize: 13 }}>{ch.characteristicCode}</strong>
                          <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>{ch.characteristicName}</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#888' }}>
                          n={values.length} | x̄={mean.toFixed(3)} {ch.uom} | {ch.nominalValue != null ? `Nom: ${ch.nominalValue}` : ''}
                        </div>
                      </div>
                      <svg width="100%" height={chartH + 40} viewBox={`0 0 ${Math.max(200, values.length * barW + 60)} ${chartH + 40}`} style={{ display: 'block' }}>
                        {/* UCL/LCL lines */}
                        {usl != null && (
                          <>
                            <line x1={30} y1={toY(usl)} x2={values.length * barW + 30} y2={toY(usl)} stroke="#ef4444" strokeWidth={1} strokeDasharray="4,3" />
                            <text x={2} y={toY(usl) + 4} fontSize={9} fill="#ef4444">USL</text>
                          </>
                        )}
                        {lsl != null && (
                          <>
                            <line x1={30} y1={toY(lsl)} x2={values.length * barW + 30} y2={toY(lsl)} stroke="#ef4444" strokeWidth={1} strokeDasharray="4,3" />
                            <text x={2} y={toY(lsl) + 4} fontSize={9} fill="#ef4444">LSL</text>
                          </>
                        )}
                        {/* Mean line */}
                        <line x1={30} y1={toY(mean)} x2={values.length * barW + 30} y2={toY(mean)} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="6,3" />
                        <text x={2} y={toY(mean) + 4} fontSize={9} fill="#2563eb">x̄</text>
                        {/* Data points */}
                        {values.map((v, i) => (
                          <g key={i}>
                            {i > 0 && (
                              <line x1={30 + (i - 1) * barW + barW / 2} y1={toY(values[i - 1])} x2={30 + i * barW + barW / 2} y2={toY(v)} stroke="#2563eb" strokeWidth={1} />
                            )}
                            <circle cx={30 + i * barW + barW / 2} cy={toY(v)} r={3.5}
                              fill={samples[i]?.result === 'FAIL' ? '#ef4444' : samples[i]?.result === 'PASS' ? '#22c55e' : '#888'} />
                            <text x={30 + i * barW + barW / 2} y={chartH + 14} fontSize={8} fill="#999" textAnchor="middle">
                              {samples[i]?.inspectionNumber?.slice(-3) ?? ''}
                            </text>
                          </g>
                        ))}
                      </svg>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {status === 'FAIL' && !viewOnly && (
          <div className="panel">
            <div className="panel-h">
              <h2>
                <span className="material-symbols-rounded">report</span>
                Disposition Required — Create NCR
              </h2>
            </div>

            <div className="fgrid">
              <label className="fld">
                <span>
                  Defect Code <em>*</em>
                </span>
                <input
                  className="in"
                  value={ncrForm.defectCode}
                  onChange={(event) =>
                    setNcrForm((current) => ({ ...current, defectCode: event.target.value }))
                  }
                />
              </label>

              <label className="fld">
                <span>Quantity Affected</span>
                <input
                  className="in"
                  type="number"
                  value={ncrForm.quantityAffected}
                  onChange={(event) =>
                    setNcrForm((current) => ({ ...current, quantityAffected: event.target.value }))
                  }
                />
              </label>

              <label className="fld">
                <span>Severity</span>
                <select
                  className="in"
                  value={ncrForm.severity}
                  onChange={(event) =>
                    setNcrForm((current) => ({ ...current, severity: event.target.value }))
                  }
                >
                  <option value="CRITICAL">Critical</option>
                  <option value="MAJOR">Major</option>
                  <option value="MINOR">Minor</option>
                  <option value="ADVISORY">Advisory</option>
                </select>
              </label>

              <div className="fld">
                <span>&nbsp;</span>
                <button
                  type="button"
                  className="btn btn-p"
                  onClick={handleCreateNcr}
                  disabled={isBusy}
                >
                  <span className="material-symbols-rounded">add_circle</span>
                  Create NCR
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="panel">
          <div className="actbar">
            <span className="lft">
              <span className="material-symbols-rounded">lock</span>
              {isCreateMode
                ? 'New inspection'
                : `Audited • created ${formatDate(inspection?.createdAt ?? null)}`}
            </span>

            <button type="button" className="btn" onClick={onBack} disabled={isBusy}>
              <span className="material-symbols-rounded">arrow_back</span>
              Back
            </button>

            {isCreateMode && (
              <button type="button" className="btn btn-p" onClick={handleCreate} disabled={isBusy}>
                <span className="material-symbols-rounded">inventory</span>
                Save &amp; Update Inventory
              </button>
            )}

            {!isCreateMode && !viewOnly && (
              <>
                {['DRAFT', 'IN_PROGRESS', 'SUBMITTED', 'PASS', 'HOLD'].includes(status) && (
                  <>
                    {status === 'HOLD' ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => runWorkflow('release-hold')}
                        disabled={isBusy}
                      >
                        <span className="material-symbols-rounded">play_circle</span>
                        Release Hold
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setDecisionModal({ kind: 'hold' })}
                        disabled={isBusy}
                      >
                        <span className="material-symbols-rounded">back_hand</span>
                        Hold
                      </button>
                    )}

                    {can('quality', 'Approve') ? (
                      <button
                        type="button"
                        className="btn btn-p"
                        onClick={runUpdateInventory}
                        disabled={isBusy}
                      >
                        <span className="material-symbols-rounded">inventory</span>
                        Update Inventory
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-p"
                        disabled
                        title="Requires Quality Approve permission"
                      >
                        <span className="material-symbols-rounded">inventory</span>
                        Update Inventory
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </form>

      <ConfirmActionModal
        open={decisionModal !== null}
        title={
          decisionModal?.kind === 'decide'
            ? `Decide ${decisionModal.decision} — ${docNo}`
            : decisionModal?.kind === 'close'
              ? `Close ${docNo}`
              : decisionModal?.kind === 'cancel'
                ? `Cancel ${docNo}`
                : decisionModal?.kind === 'reopen'
                  ? `Reopen ${docNo}`
                  : `Hold ${docNo}`
        }
        body={
          decisionModal?.kind === 'decide'
            ? decisionModal.decision === 'PASS'
              ? 'Confirm the inspection PASSED all characteristics. Critical failures will still force HOLD.'
              : decisionModal.decision === 'HOLD'
                ? 'Confirm the inspection should be placed ON HOLD pending review.'
                : 'Confirm the inspection is REJECTED. An NCR disposition will be required before closing.'
            : decisionModal?.kind === 'close'
              ? 'Close the inspection. Failed characteristics require an NCR disposition first.'
              : decisionModal?.kind === 'cancel'
                ? 'This cancels the inspection with an audit trail.'
                : decisionModal?.kind === 'reopen'
                  ? 'Reopening a closed inspection requires authorization.'
                  : 'Reason for holding the inspection:'
        }
        okLabel={
          decisionModal?.kind === 'decide'
            ? `Decide ${decisionModal.decision}`
            : decisionModal?.kind === 'close'
              ? 'Close'
              : decisionModal?.kind === 'cancel'
                ? 'Cancel Inspection'
                : decisionModal?.kind === 'reopen'
                  ? 'Reopen'
                  : 'Hold'
        }
        danger={
          decisionModal?.kind === 'cancel' ||
          (decisionModal?.kind === 'decide' && decisionModal.decision === 'REJECT')
        }
        busy={workflowMutation.isPending}
        onClose={() => setDecisionModal(null)}
        onConfirm={(note) => {
          if (!decisionModal) {
            return;
          }

          if (decisionModal.kind === 'decide') {
            runWorkflow('decide', note, decisionModal.decision);
          } else if (decisionModal.kind === 'hold') {
            runWorkflow('hold', note);
          } else if (decisionModal.kind === 'cancel') {
            runWorkflow('cancel', note);
          } else if (decisionModal.kind === 'reopen') {
            runWorkflow('reopen', note);
          } else {
            runWorkflow('close', note);
          }
        }}
      />

      <AuditHistoryDrawer open={auditOpen} entityType="QualityInspection" entityId={documentId ?? undefined} onClose={() => setAuditOpen(false)} />

      {attachmentsOpen && documentId && (
        <AttachmentsDrawer ownerType="quality-inspection" ownerId={Number(documentId)} onClose={() => setAttachmentsOpen(false)} />
      )}
    </>
  );
}
