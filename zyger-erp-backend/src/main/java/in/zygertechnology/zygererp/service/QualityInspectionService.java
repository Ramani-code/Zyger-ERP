package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.InstrumentMaster;
import in.zygertechnology.zygererp.entity.QualityCalibrationInstrument;
import in.zygertechnology.zygererp.entity.QualityInspection;
import in.zygertechnology.zygererp.entity.QualityInspectionLine;
import in.zygertechnology.zygererp.entity.QualityInspectionType;
import in.zygertechnology.zygererp.entity.QualityInspectionStatusHistory;
import in.zygertechnology.zygererp.entity.QualityNcr;
import in.zygertechnology.zygererp.entity.QualityScar;
import in.zygertechnology.zygererp.entity.QualityDisposition;
import in.zygertechnology.zygererp.entity.DocEntity;
import in.zygertechnology.zygererp.entity.InspectionPlan;
import in.zygertechnology.zygererp.entity.InspectionPlanCharacteristic;
import in.zygertechnology.zygererp.entity.SamplingPlanMaster;
import in.zygertechnology.zygererp.entity.QualityCharacteristicMeasurement;
import in.zygertechnology.zygererp.doc.DocTypes;
import in.zygertechnology.zygererp.repo.InstrumentMasterRepository;
import in.zygertechnology.zygererp.repo.QualityCalibrationInstrumentRepository;
import in.zygertechnology.zygererp.repo.QualityInspectionStatusHistoryRepository;
import in.zygertechnology.zygererp.repo.QualityDispositionRepository;
import in.zygertechnology.zygererp.repo.LedgerRepository;
import in.zygertechnology.zygererp.repository.InspectionPlanRepository;
import in.zygertechnology.zygererp.repository.QualityCharacteristicMeasurementRepository;
import in.zygertechnology.zygererp.repository.SamplingPlanMasterRepository;
import in.zygertechnology.zygererp.config.BusinessRuleException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.TypedQuery;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.security.Principal;
import java.time.LocalDate;
import java.time.Instant;
import java.util.*;

@Service
@RequiredArgsConstructor
public class QualityInspectionService {

    private static final Logger log = LoggerFactory.getLogger(QualityInspectionService.class);

    private final EntityManager em;
    private final ObjectMapper mapper;
    private final DocNumberService numbers;
    private final DocumentFacade docs;
    private final QualityCalibrationInstrumentRepository instruments;
    private final InstrumentMasterRepository instrumentMasters;
    private final InspectionPlanRepository inspectionPlanRepo;
    private final SamplingPlanMasterRepository samplingRepo;
    private final QualityCharacteristicMeasurementRepository spcRepo;
    private final QualityInspectionStatusHistoryRepository statusHistoryRepo;
    private final QualityDispositionRepository dispositionRepo;
    private final CalibrationGuardService calibrationGuard;
    private final DocumentWorkflowEngine workflowEngine;
    private final EmailService emailService;
    private final StockService stockService;
    private final ApplicationEventPublisher publisher;

    public static final String KEY = "quality-inspection";
    private static final String INSPECT = "SUBMITTED";
    private static final String APPROVED = "APPROVED";

    public static final List<String> MRB_DISPOSITIONS =
            List.of("USE_AS_IS", "REWORK", "RTV", "SCRAP", "QUARANTINE");

    public QualityInspection get(Long id) {
        return (QualityInspection) docs.get(KEY, id);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getRow(Long id) {
        return docs.getRow(KEY, id);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> list(Map<String, String> q) {
        return docs.list(KEY, q);
    }

    @Transactional
    public QualityInspection create(Map<String, Object> body, String user) {
        QualityInspection e = mapper.convertValue(body, QualityInspection.class);
        if (e.getInspectionNumber() == null || e.getInspectionNumber().isBlank()) {
            e.setInspectionNumber(numbers.nextFy(prefixFor(e)));
        }
        e.setDocNo(e.getInspectionNumber());
        LocalDate d = parseDate(body.get("date"));
        if (d == null) d = parseDate(body.get("inspectionDate"));
        if (d == null) d = LocalDate.now();
        e.setDocDate(d);
        e.setInspectionDate(d);

        boolean directUpdate = Boolean.TRUE.equals(body.get("directInventoryUpdate"))
                || "PASS".equalsIgnoreCase(String.valueOf(body.get("inspectionStatus")))
                || "PASSED".equalsIgnoreCase(String.valueOf(body.get("inspectionStatus")))
                || "APPROVED".equalsIgnoreCase(String.valueOf(body.get("inspectionStatus")));

        if (directUpdate) {
            e.setInspectionStatus("PASS");
            e.setDecisionStatus("PASS");
            e.setFinalDecision("PASS");
            e.setApprovedBy(user);
            e.setApprovedAt(Instant.now());
            e.setSignedAt(Instant.now());
            e.setIsLocked(true);
        } else {
            e.setInspectionStatus("DRAFT");
            e.setDecisionStatus("NONE");
        }

        if (body.get("receivedQuantity") != null)
            e.setReceivedQuantity(bdVal(body.get("receivedQuantity")));
        if (body.get("inspectionQuantity") != null)
            e.setInspectionQuantity(bdVal(body.get("inspectionQuantity")));
        if (body.get("acceptedQuantity") != null)
            e.setAcceptedQuantity(bdVal(body.get("acceptedQuantity")));
        if (body.get("rejectedQuantity") != null)
            e.setRejectedQuantity(bdVal(body.get("rejectedQuantity")));
        if (body.get("location") != null)
            e.setLocation(String.valueOf(body.get("location")));

        e.setCreatedBy(user);
        e.setCreatedAt(Instant.now());
        e.setUpdatedAt(Instant.now());
        attach(e, body);

        // §6.5: Auto-load inspection plan characteristics if no lines provided
        if (e.getLines().isEmpty() && e.getItemCode() != null) {
            autoLoadInspectionPlan(e);
        }

        // FRS §?: Apply AQL / ANSI Z1.4 sampling plan to derive sample size + acceptance criteria.
        applySamplingPlan(e);

        for (QualityInspectionLine l : e.getLines()) evaluate(l);
        em.persist(e);

        // §4.2: Record initial status history
        recordStatusChange(e, null, e.getInspectionStatus(), user, directUpdate ? "Directly passed and updated inventory" : "Inspection created");

        if (directUpdate) {
            postAcceptedQuantityToInventory(e, user);
        }

        return e;
    }

    private void postAcceptedQuantityToInventory(QualityInspection e, String user) {
        if (e.getItemCode() == null || e.getItemCode().isBlank()) return;

        // Only the Accepted Qty updates inventory — rejected/on-hold stock never should,
        // so unlike before this no longer falls back to the full inspection/received qty.
        BigDecimal acceptedQty = e.getAcceptedQuantity();
        if (acceptedQty == null || acceptedQty.compareTo(BigDecimal.ZERO) <= 0) return;

        String batch = e.getBatchNumber() != null ? e.getBatchNumber() : "";
        String heat = e.getHeatNumber() != null ? e.getHeatNumber() : "";
        String location = e.getLocation() != null ? e.getLocation() : "MAIN";

        try {
            stockService.recordStockIn(
                    e.getDocNo(),
                    KEY,
                    "QC_INSPECTION_PASS",
                    e.getItemCode(),
                    location,
                    batch,
                    heat,
                    acceptedQty,
                    e.getInspectionDate(),
                    user,
                    "FREE"
            );
            e.setStockSyncStatus("SYNCED");
            em.persist(e);
        } catch (Exception ex) {
            log.warn("Direct inventory update error for inspection {}: {}", e.getDocNo(), ex.getMessage());
            e.setStockSyncStatus("SYNC_ERROR");
            em.persist(e);
        }
    }

    public static String prefixForType(QualityInspectionType type) {
        if (type == null) return DocTypes.get(KEY).prefix();
        return switch (type) {
            case IQC -> "IQC";
            case LO -> "LOI";       // spec §3
            case JOMIN -> "JOM";    // spec §3
            case FAI -> "FAI";
            case IPQC -> "IPQ";     // spec §3
            case LINE -> "LIN";
            case LAST_OFF -> "LOF";
            case FINAL -> "FIN";
        };
    }

    private String prefixFor(QualityInspection e) {
        return prefixForType(e.getInspectionType());
    }

    @Transactional
    public QualityInspection saveMeasurements(Long inspectionId,
                                              List<Map<String, Object>> results, String user) {
        return saveMeasurements(inspectionId, results, user, null, null);
    }

    @Transactional
    public QualityInspection saveMeasurements(Long inspectionId,
                                              List<Map<String, Object>> results, String user,
                                              String overrideReason, String overrideUser) {
        QualityInspection ins = get(inspectionId);
        checkEditable(ins);

        Map<String, QualityInspectionLine> byCode = new HashMap<>();
        for (QualityInspectionLine l : ins.getLines()) byCode.put(l.getCharacteristicCode(), l);

        for (Map<String, Object> r : results) {
            String code = strVal(r.get("characteristicCode"));
            QualityInspectionLine l = byCode.get(code);
            if (l == null) continue;
            if (r.get("balloonNo") != null) l.setBalloonNo(strVal(r.get("balloonNo")));
            if (r.get("actualValue") != null) l.setActualValue(bdVal(r.get("actualValue")));
            if (r.get("actualText") != null) l.setActualText(strVal(r.get("actualText")));
            if (r.get("actualMin") != null) l.setActualMin(bdVal(r.get("actualMin")));
            if (r.get("actualMax") != null) l.setActualMax(bdVal(r.get("actualMax")));
            if (r.get("actualAvg") != null) l.setActualAvg(bdVal(r.get("actualAvg")));
            if (r.get("instrumentCode") != null) {
                l.setInstrumentCode(strVal(r.get("instrumentCode")));
                calibGuard(strVal(r.get("instrumentCode")), ins, overrideReason, overrideUser);
                QualityCalibrationInstrument inst = instruments.findByInstrumentCode(l.getInstrumentCode()).orElse(null);
                if (inst != null) {
                    l.setCalibrationStatus(inst.getStatus());
                    l.setInstrumentCode(inst.getInstrumentCode());
                }
            }
            if (r.get("sampleNumber") != null) l.setSampleNumber((Integer) r.get("sampleNumber"));
            if (r.get("pieceNumber") != null) l.setPieceNumber((Integer) r.get("pieceNumber"));
            if (r.get("remark") != null) l.setRemark(strVal(r.get("remark")));
            l.setMeasuredBy(user);
            l.setMeasuredAt(Instant.now());
            evaluate(l);

            // §6.6: Record SPC fact table for numeric characteristics
            if (l.getActualValue() != null && ins.getId() != null) {
                try { recordSpcMeasurement(ins, l); } catch (Exception ex) {
                    log.warn("SPC recording failed for line {}: {}", l.getCharacteristicCode(), ex.getMessage());
                }
            }
        }
        ins.setUpdatedAt(Instant.now());
        em.flush();
        return ins;
    }

    @Transactional
    public Map<String, Object> bulkImportMeasurements(Long inspectionId, String csvContent, String user) {
        return bulkImportMeasurements(inspectionId, csvContent, user, null, null);
    }

    @Transactional
    public Map<String, Object> bulkImportMeasurements(Long inspectionId, String csvContent, String user,
                                                      String overrideReason, String overrideUser) {
        QualityInspection ins = get(inspectionId);
        checkEditable(ins);

        Map<String, QualityInspectionLine> byBalloon = new HashMap<>();
        Map<String, QualityInspectionLine> byCode = new HashMap<>();
        for (QualityInspectionLine l : ins.getLines()) {
            if (l.getBalloonNo() != null && !l.getBalloonNo().isBlank())
                byBalloon.put(l.getBalloonNo().trim(), l);
            if (l.getCharacteristicCode() != null && !l.getCharacteristicCode().isBlank())
                byCode.put(l.getCharacteristicCode().trim(), l);
        }

        int matched = 0, unmatched = 0;
        String[] rows = csvContent.split("\\r?\\n");

        for (String row : rows) {
            if (row.trim().isEmpty()) continue;
            String[] parts = row.split(",");
            if (parts.length < 2) continue;

            String balloonOrCode = parts[0].trim();
            String actualVal = parts.length > 1 ? parts[1].trim() : "";
            String instrument = parts.length > 2 ? parts[2].trim() : null;
            String remark = parts.length > 3 ? parts[3].trim() : null;

            QualityInspectionLine il = byBalloon.getOrDefault(balloonOrCode, byCode.get(balloonOrCode));
            if (il == null) { unmatched++; continue; }

            BigDecimal bd = null;
            try { bd = new BigDecimal(actualVal); } catch (Exception ignored) {}
            if (bd != null) {
                il.setActualValue(bd);
            } else {
                il.setActualText(actualVal);
            }
            if (instrument != null && !instrument.isBlank()) {
                il.setInstrumentCode(instrument);
                calibGuard(instrument, ins, overrideReason, overrideUser);
            }
            if (remark != null && !remark.isBlank()) il.setRemark(remark);
            il.setMeasuredBy(user);
            il.setMeasuredAt(Instant.now());
            evaluate(il);

            if (il.getActualValue() != null && ins.getId() != null) {
                try { recordSpcMeasurement(ins, il); } catch (Exception ex) {
                    log.warn("SPC recording failed for line {}: {}", il.getCharacteristicCode(), ex.getMessage());
                }
            }
            matched++;
        }

        ins.setUpdatedAt(Instant.now());
        em.flush();

        Map<String, Object> result = new HashMap<>();
        result.put("totalRows", rows.length);
        result.put("matched", matched);
        result.put("unmatched", unmatched);
        return result;
    }

    void evaluate(QualityInspectionLine l) {
        BigDecimal actual = l.getActualValue();
        String actualTxt = l.getActualText();
        Boolean mandatory = Boolean.TRUE.equals(l.getIsMandatory());

        if (actual == null && (actualTxt == null || actualTxt.isBlank()) && !mandatory) {
            l.setResult("NA");
            return;
        }
        if (actual == null && (actualTxt == null || actualTxt.isBlank())) {
            l.setResult("PENDING");
            return;
        }

        // Text / Visual characteristic evaluation
        if (actualTxt != null && !actualTxt.isBlank() && l.getSpecificationText() != null && !l.getSpecificationText().isBlank()) {
            boolean pass = actualTxt.trim().equalsIgnoreCase(l.getSpecificationText().trim())
                    || actualTxt.trim().equalsIgnoreCase("PASS")
                    || actualTxt.trim().equalsIgnoreCase("OK");
            l.setResult(pass ? "PASS" : "FAIL");
            return;
        }

        if (actual != null) {
            BigDecimal lo = l.getLowerLimit();
            BigDecimal hi = l.getUpperLimit();

            // No tolerance limits defined and no specificationText matched above:
            // cannot be auto-evaluated, route to manual review.
            if (lo == null && hi == null) {
                l.setResult("PENDING_REVIEW");
                return;
            }

            boolean within = true;

            if (lo != null && hi != null) {
                within = actual.compareTo(lo) >= 0 && actual.compareTo(hi) <= 0;
            } else if (hi != null) {
                within = actual.compareTo(hi) <= 0;
            } else if (lo != null) {
                within = actual.compareTo(lo) >= 0;
            }

            l.setOotFlag(!within);
            l.setResult(within ? "PASS" : "FAIL");
            BigDecimal nom = l.getNominalValue();
            if (nom != null) {
                l.setDeviation(actual.subtract(nom));
            } else if (lo != null && hi != null) {
                l.setDeviation(actual.subtract(lo.add(hi).divide(BigDecimal.valueOf(2))));
            } else {
                l.setDeviation(BigDecimal.ZERO);
            }
        } else {
            // actualText present but no specificationText to compare against:
            // cannot be auto-evaluated, route to manual review.
            l.setResult("PENDING_REVIEW");
        }
    }

    @Transactional
    public QualityInspection start(Long id, String user) {
        QualityInspection ins = get(id);
        String from = ins.getInspectionStatus();
        require(ins, "DRAFT", "PENDING", "REJECTED");
        ins.setInspectionStatus("IN_PROGRESS");
        ins.setAssignedInspector(user);
        ins.setAssignedAt(Instant.now());
        ins.setStartedAt(Instant.now());
        ins.setUpdatedAt(Instant.now());
        recordStatusChange(ins, from, "IN_PROGRESS", user, null);
        return ins;
    }

    @Transactional
    public QualityInspection submit(Long id, String user) {
        QualityInspection ins = get(id);
        String from = ins.getInspectionStatus();
        require(ins, "IN_PROGRESS", "DRAFT");
        validateWorkflowTransition(ins, "SUBMIT");
        List<QualityInspectionLine> pendingMandatory = ins.getLines().stream()
                .filter(QualityInspectionLine::getIsMandatory)
                .filter(l -> "PENDING".equals(l.getResult()))
                .toList();
        if (!pendingMandatory.isEmpty()) {
            throw new IllegalArgumentException("Cannot submit: " + pendingMandatory.size() + " mandatory characteristic(s) still pending measurement.");
        }
        validateQuantities(ins);
        ins.setSubmittedBy(user);
        ins.setSubmittedAt(Instant.now());
        ins.setInspectionStatus(INSPECT);
        ins.setDecisionStatus("PENDING");
        ins.setUpdatedAt(Instant.now());
        recordStatusChange(ins, from, INSPECT, user, null);
        return ins;
    }

    @Transactional
    public QualityInspection hold(Long id, String reason, String user) {
        QualityInspection ins = get(id);
        String from = ins.getInspectionStatus();
        require(ins, INSPECT, "IN_PROGRESS");
        ins.setInspectionStatus("HOLD");
        ins.setDecisionRemarks(reason);
        ins.setUpdatedAt(Instant.now());
        recordStatusChange(ins, from, "HOLD", user, reason);
        sendQualityNotification(ins, "ON_HOLD", reason);
        return ins;
    }

    @Transactional
    public QualityInspection releaseHold(Long id, String user) {
        QualityInspection ins = get(id);
        String from = ins.getInspectionStatus();
        require(ins, "HOLD");
        ins.setInspectionStatus(INSPECT);
        ins.setHoldSince(null);
        ins.setUpdatedAt(Instant.now());
        recordStatusChange(ins, from, INSPECT, user, "Hold released");
        return ins;
    }

    @Transactional
    public QualityInspection decide(Long id, String decision, String remarks, String severity, String user) {
        QualityInspection ins = get(id);
        String from = ins.getInspectionStatus();
        require(ins, INSPECT);
        validateWorkflowTransition(ins, "DECIDE");
        String d = (decision == null) ? "PASS" : decision.toUpperCase();
        if (List.of("FAIL", "REJECT", "FAILING").contains(d)) {
            ins.setInspectionStatus("FAIL");
            ins.setDecisionStatus("FAIL");
            ins.setHoldSince(null);
            autoCreateNcr(ins, severity, user);
        } else if (d.equals("HOLD")) {
            ins.setInspectionStatus("HOLD");
            ins.setDecisionStatus("HOLD");
            ins.setHoldSince(Instant.now());
        } else {
            if (hasCriticalFail(ins)) {
                ins.setInspectionStatus("HOLD");
                ins.setDecisionStatus("HOLD");
                ins.setHoldSince(Instant.now());
                ins.setDecisionRemarks("Critical characteristic failed; requires review. " + safe(remarks));
            } else {
                ins.setInspectionStatus("PASS");
                ins.setDecisionStatus("PASS");
                ins.setHoldSince(null);
            }
        }
        ins.setFinalDecision(ins.getInspectionStatus());
        ins.setDecisionRemarks(safe(remarks));
        ins.setUpdatedAt(Instant.now());
        recordStatusChange(ins, from, ins.getInspectionStatus(), user, remarks);
        return ins;
    }

    @Transactional
    public QualityInspection approve(Long id, String minorAcceptanceReason, String user) {
        QualityInspection ins = get(id);
        String from = ins.getInspectionStatus();
        boolean isFailPath = "FAIL".equals(from) || "REJECTED".equals(from) || hasFailedLine(ins);

        if (isFailPath) {
            // VAL-APR-02 / VAL-NCR-01: a FAIL requires a resolved MRB disposition before approve,
            // unless the NCR severity is MINOR/LOW, which may be accepted with a reason instead.
            QualityNcr ncr = findNcrFor(ins);
            String sev = ncr != null && ncr.getSeverity() != null
                    ? ncr.getSeverity().trim().toUpperCase() : "";
            if (List.of("MINOR", "LOW").contains(sev)) {
                if (minorAcceptanceReason == null || minorAcceptanceReason.isBlank()) {
                    throw new IllegalStateException(
                            "Cannot approve: minor failure requires a minor acceptance reason before approval.");
                }
                ins.setMinorAcceptanceReason(minorAcceptanceReason);
                if (ncr != null) { ncr.setStatus("MINOR_ACCEPTED"); em.persist(ncr); }
            } else {
                List<QualityDisposition> disps = ncr != null ? dispositionRepo.findByNcrId(ncr.getId()) : List.of();
                QualityDisposition disp = disps.isEmpty() ? null : disps.get(0);
                if (disp == null || disp.getDispositionType() == null
                        || "PENDING".equalsIgnoreCase(disp.getDispositionType())) {
                    throw new IllegalStateException(
                            "Cannot approve: failed inspection requires a resolved MRB disposition before approval.");
                }
            }
            validateWorkflowTransition(ins, "APPROVE");
            ins.setInspectionStatus(APPROVED);
            ins.setDecisionStatus(ins.getDecisionStatus());
            ins.setApprovedBy(user);
            ins.setApprovedAt(Instant.now());
            ins.setSignedAt(Instant.now());
            ins.setIsLocked(true);
            ins.setHoldSince(null);
            ins.setUpdatedAt(Instant.now());
            recordStatusChange(ins, from, APPROVED, user, null);
            sendQualityNotification(ins, APPROVED, null);
            ins.setStockSyncKey(ins.getDocNo() + ":QC_REJECT");
            ins.setStockSyncStatus("PENDING");
            publisher.publishEvent(new QualityInspectionApprovedEvent(
                    ins.getId(), "DISPOSE", ins.getStockSyncKey(), user));
            return ins;
        }

        require(ins, "SUBMITTED", "PASS", "IN_PROGRESS");
        validateWorkflowTransition(ins, "APPROVE");
        if (hasCriticalFail(ins)) {
            throw new IllegalArgumentException("Cannot approve: inspection has critical characteristic failures. Use HOLD disposition instead.");
        }
        validateQuantities(ins);
        ins.setInspectionStatus(APPROVED);
        ins.setDecisionStatus(ins.getDecisionStatus());
        ins.setApprovedBy(user);
        ins.setApprovedAt(Instant.now());
        ins.setSignedAt(Instant.now());
        ins.setIsLocked(true);
        ins.setHoldSince(null);
        ins.setStockSyncKey(ins.getDocNo() + ":QC_RELEASE");
        ins.setStockSyncStatus("PENDING");
        ins.setUpdatedAt(Instant.now());
        recordStatusChange(ins, from, APPROVED, user, null);
        sendQualityNotification(ins, APPROVED, null);
        autoCreateTestCertificate(ins, user);
        publisher.publishEvent(new QualityInspectionApprovedEvent(
                ins.getId(), "RELEASE", ins.getStockSyncKey(), user));
        return ins;
    }

    /** Applies the resolved MRB disposition's stock mapping on approve of a failed inspection. */
    private void applyDispositionStock(QualityInspection ins, QualityDisposition disp, String user) {
        try {
            if (disp == null) return;
            if (ins.getItemCode() == null || ins.getItemCode().isBlank()) return;
            String d = disp.getDispositionType() == null ? "" : disp.getDispositionType().toUpperCase();
            String targetStatus;
            switch (d) {
                case "USE_AS_IS", "REWORK" -> targetStatus = "REJECTED";
                case "RTV" -> targetStatus = "REJECTED";
                case "SCRAP" -> targetStatus = "SCRAP";
                case "QUARANTINE" -> targetStatus = "QUARANTINE";
                default -> targetStatus = "REJECTED";
            }
            BigDecimal qty = disp.getQuantity() != null ? disp.getQuantity() : ins.getRejectedQuantity();
            if (qty == null || qty.compareTo(BigDecimal.ZERO) <= 0) return;
            String batch = ins.getBatchNumber() != null ? ins.getBatchNumber() : "";
            String heat = ins.getHeatNumber() != null ? ins.getHeatNumber() : "";
            stockService.disposeHeldForItem(
                    ins.getDocNo(), KEY, "QC_REJECT", ins.getItemCode(), batch, heat,
                    qty, targetStatus, LocalDate.now(), user);
        } catch (Exception ex) {
            log.warn("Disposition stock mapping skipped for inspection {}: {}", ins.getId(), ex.getMessage());
        }
    }

    private void releaseHeldStockToStore(QualityInspection ins, String user) {
        try {
            if (ins.getItemCode() == null || ins.getItemCode().isBlank()) return;
            BigDecimal accepted = ins.getAcceptedQuantity() != null ? ins.getAcceptedQuantity()
                    : ins.getInspectionQuantity();
            if (accepted == null || accepted.compareTo(BigDecimal.ZERO) <= 0) return;
            String batch = ins.getBatchNumber() != null ? ins.getBatchNumber() : "";
            String heat = ins.getHeatNumber() != null ? ins.getHeatNumber() : "";
            stockService.releaseQcHoldForItem(
                    ins.getDocNo(), KEY, "QC_RELEASE", ins.getItemCode(), batch, heat,
                    accepted, LocalDate.now(), user);
        } catch (Exception ex) {
            log.warn("QC auto-release skipped for inspection {}: {}", ins.getId(), ex.getMessage());
        }
    }

    /** CoC (OUTWARD test certificate) auto-generation on OQC-type approval. */
    private void autoCreateTestCertificate(QualityInspection ins, String user) {
        try {
            if (ins.getInspectionType() == null) return;
            String t = ins.getInspectionType().name();
            if (!List.of("FINAL", "LAST_OFF", "LINE").contains(t)) return;
            if (ins.getId() == null) return;
            long existing = em.createQuery(
                            "select count(c) from QualityTestCertificate c where c.inspectionId = :id", Long.class)
                    .setParameter("id", ins.getId()).getSingleResult();
            if (existing > 0) return;

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("certificateType", "OUTWARD");
            body.put("certificateDate", LocalDate.now().toString());
            body.put("inspectionId", ins.getId());
            body.put("itemCode", ins.getItemCode());
            body.put("customerPartNumber", ins.getItemCode());
            body.put("drawingNumber", ins.getDrawingNumber());
            body.put("drawingRevision", ins.getDrawingRevision());
            body.put("batchNumber", ins.getBatchNumber());
            body.put("lotNumber", ins.getLotNumber());
            body.put("heatNumber", ins.getHeatNumber());
            body.put("salesOrderNumber", ins.getSalesOrderNumber());
            body.put("jobOrderNumber", ins.getJobOrderNumber());
            body.put("overallResult", "PASS");
            body.put("preparedBy", user);

            List<Map<String, Object>> lines = new ArrayList<>();
            for (QualityInspectionLine l : ins.getLines()) {
                Map<String, Object> line = new LinkedHashMap<>();
                line.put("parameterName", l.getCharacteristicName() != null ? l.getCharacteristicName() : l.getCharacteristicCode());
                line.put("specification", l.getSpecificationText());
                line.put("nominalValue", l.getNominalValue());
                line.put("resultValue", l.getActualValue());
                line.put("uom", l.getUom());
                line.put("instrumentCode", l.getInstrumentCode());
                line.put("result", "NA".equals(l.getResult()) ? "NA" : l.getResult());
                line.put("remark", l.getRemark());
                lines.add(line);
            }
            body.put("lines", lines);

            docs.create("quality-test-certificate", body, user);
            log.info("CoC auto-generated for OQC inspection {}", ins.getId());
        } catch (Exception ex) {
            log.warn("CoC auto-generation failed for inspection {}: {}", ins.getId(), ex.getMessage());
        }
    }

    @EventListener
    @Transactional
    public void onQualityApproved(QualityInspectionApprovedEvent evt) {
        try {
            QualityInspection ins = get(evt.getInspectionId());
            if (ins == null) return;
            // Idempotency guard: only apply each stock sync once per inspection
            if ("SYNCED".equals(ins.getStockSyncStatus())) return;
            if ("RELEASE".equals(evt.getAction())) {
                releaseHeldStockToStore(ins, evt.getUser());
            } else {
                applyDispositionStock(ins, resolvedDisposition(ins), evt.getUser());
            }
            ins.setStockSyncStatus("SYNCED");
            em.persist(ins);
        } catch (Exception ex) {
            log.warn("Stock sync failed for inspection {}: {}", evt.getInspectionId(), ex.getMessage());
            try {
                QualityInspection ins = get(evt.getInspectionId());
                if (ins != null) {
                    ins.setStockSyncStatus("SYNC_ERROR");
                    em.persist(ins);
                }
            } catch (Exception ignored) {
            }
        }
    }

    private QualityDisposition resolvedDisposition(QualityInspection ins) {
        QualityNcr ncr = findNcrFor(ins);
        if (ncr == null) return null;
        List<QualityDisposition> disps = dispositionRepo.findByNcrId(ncr.getId());
        return disps.isEmpty() ? null : disps.get(0);
    }

    @Transactional
    public QualityInspection close(Long id, String user) {
        QualityInspection ins = get(id);
        String from = ins.getInspectionStatus();
        if (ins.getInspectionStatus().equals("FAIL") || hasFailedLine(ins)) {
            if (!hasNcr(ins)) {
                throw new IllegalStateException(
                        "Inspection with failed characteristics cannot be closed without a disposition/NCR");
            }
        } else {
            requireClosable(ins, INSPECT, "PASS", "HOLD", APPROVED);
        }
        ins.setInspectionStatus("CLOSED");
        ins.setClosedAt(Instant.now());
        ins.setCompletedAt(Instant.now());
        ins.setUpdatedAt(Instant.now());
        recordStatusChange(ins, from, "CLOSED", user, null);
        sendQualityNotification(ins, "CLOSED", null);
        return ins;
    }

    @Transactional
    public QualityInspection cancel(Long id, String reason, String user) {
        QualityInspection ins = get(id);
        String from = ins.getInspectionStatus();
        require(ins, "DRAFT", INSPECT);
        ins.setInspectionStatus("CANCELLED");
        ins.setCancellationReason(reason);
        ins.setCancelledAt(Instant.now());
        ins.setUpdatedAt(Instant.now());
        recordStatusChange(ins, from, "CANCELLED", user, reason);
        return ins;
    }

    @Transactional
    public QualityInspection reopen(Long id, String reason, String user) {
        QualityInspection ins = get(id);
        String from = ins.getInspectionStatus();
        require(ins, "CLOSED");
        ins.setInspectionStatus("IN_PROGRESS");
        ins.setReopenReason(reason);
        ins.setClosedAt(null);
        ins.setIsLocked(false);
        ins.setUpdatedAt(Instant.now());
        recordStatusChange(ins, from, "IN_PROGRESS", user, reason);
        return ins;
    }

    private void checkEditable(QualityInspection ins) {
        String s = ins.getInspectionStatus();
        if (s.equals("CLOSED") || s.equals(APPROVED)) {
            throw new IllegalStateException("Approved/closed inspection cannot be modified");
        }
    }

    private void require(QualityInspection ins, String... allowed) {
        for (String a : allowed) if (a.equals(ins.getInspectionStatus())) return;
        throw new IllegalStateException("Action not allowed in status " + ins.getInspectionStatus());
    }

    /**
     * §3.5: Validate transition against the DocumentWorkflowEngine guard table.
     * Maps service action names to workflow target statuses.
     */
    private void validateWorkflowTransition(QualityInspection ins, String action) {
        if (ins.getStatus() == null) return;
        String upperStatus = ins.getInspectionStatus();
        String upperAction = action.toUpperCase();
        // Map action names to the workflow engine's target status keys
        String targetStatus = switch (upperAction) {
            case "START" -> "IN_PROGRESS";
            case "SUBMIT" -> "SUBMITTED";
            case "DECIDE", "APPROVE" -> "APPROVED";
            case "HOLD" -> "HOLD";
            case "CLOSE" -> "CLOSED";
            case "CANCEL" -> "CANCELLED";
            case "REOPEN" -> "DRAFT";
            default -> upperAction;
        };
        Set<String> allowed = workflowEngine.allowedTransitions("QUALITY_INSPECTION", upperStatus);
        if (!allowed.isEmpty() && !allowed.contains(targetStatus)) {
            throw new BusinessRuleException("WORKFLOW_VIOLATION",
                    "Transition from " + upperStatus + " to " + targetStatus + " is not allowed",
                    Map.of("currentStatus", upperStatus, "targetStatus", targetStatus, "allowed", allowed));
        }
    }

    private void requireClosable(QualityInspection ins, String... allowed) {
        for (String a : allowed) if (a.equals(ins.getInspectionStatus())) return;
        throw new IllegalStateException("Cannot close in status " + ins.getInspectionStatus());
    }

    // ─── Spec §4.2: Status History Recording ───

    /**
     * Core trackability: write a history row for every status transition.
     * Also stamps the timing fields on the inspection itself.
     */
    private void recordStatusChange(QualityInspection ins, String fromStatus, String toStatus, String user, String remarks) {
        QualityInspectionStatusHistory h = QualityInspectionStatusHistory.builder()
                .inspectionId(ins.getId())
                .inspectionNumber(ins.getInspectionNumber())
                .inspectionType(ins.getInspectionType() != null ? ins.getInspectionType().name() : null)
                .previousStatus(fromStatus)
                .newStatus(toStatus)
                .remarks(remarks)
                .changedBy(user)
                .changedAt(Instant.now())
                .assignedAt(ins.getAssignedAt())
                .startedAt(ins.getStartedAt())
                .completedAt(ins.getCompletedAt())
                .build();
        statusHistoryRepo.save(h);

        Instant now = Instant.now();
        switch (toStatus) {
            case "IN_PROGRESS" -> {
                if (ins.getStartedAt() == null) ins.setStartedAt(now);
            }
            case "CLOSED" -> {
                if (ins.getCompletedAt() == null) ins.setCompletedAt(now);
            }
            case "APPROVED" -> {
                ins.setApprovedBy(user);
                ins.setApprovedAt(now);
                ins.setIsLocked(true);
            }
        }
    }

    private void sendQualityNotification(QualityInspection ins, String status, String remarks) {
        try {
            String recipient = ins.getAssignedInspector();
            if (recipient == null || recipient.isBlank()) recipient = ins.getCreatedBy();
            if (recipient == null || recipient.isBlank()) return;
            String typeName = ins.getInspectionType() != null ? ins.getInspectionType().name() : "";
            emailService.sendQualityInspectionNotification(
                    recipient, ins.getInspectionNumber(), typeName,
                    ins.getItemCode(), status, remarks);
        } catch (Exception e) {
            log.warn("Failed to send quality notification for {}: {}", ins.getInspectionNumber(), e.getMessage());
        }
    }

    private void validateQuantities(QualityInspection ins) {
        BigDecimal insp = ins.getInspectionQuantity();
        BigDecimal recv = ins.getReceivedQuantity();
        if (insp != null && recv != null && insp.compareTo(recv) > 0) {
            throw new IllegalArgumentException("Inspection quantity cannot exceed received quantity");
        }
        BigDecimal sum = BigDecimal.ZERO;
        sum = sum.add(nz(ins.getAcceptedQuantity()));
        sum = sum.add(nz(ins.getRejectedQuantity()));
        sum = sum.add(nz(ins.getHoldQuantity()));
        sum = sum.add(nz(ins.getReworkQuantity()));
        sum = sum.add(nz(ins.getScrapQuantity()));
        sum = sum.add(nz(ins.getReturnQuantity()));
        sum = sum.add(nz(ins.getConcessionQuantity()));
        BigDecimal limit = insp != null ? insp : (recv != null ? recv : BigDecimal.ZERO);
        if (sum.compareTo(limit) > 0) {
            throw new IllegalArgumentException(
                    "Accepted+rejected+hold+rework+scrap+return+concession ("
                            + sum + ") must not exceed inspected quantity (" + limit + ")");
        }
    }

    private BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }

    private boolean hasCriticalFail(QualityInspection ins) {
        for (QualityInspectionLine l : ins.getLines()) {
            if (Boolean.TRUE.equals(l.getIsCritical()) && "FAIL".equals(l.getResult())) return true;
        }
        return false;
    }

    private boolean hasFailedLine(QualityInspection ins) {
        for (QualityInspectionLine l : ins.getLines()) {
            if ("FAIL".equals(l.getResult())) return true;
        }
        return false;
    }

    private boolean hasNcr(QualityInspection ins) {
        String check = "select count(n) from in.zygertechnology.zygererp.entity.QualityNcr n " +
                "where n.inspectionId = :id";
        Long c = em.createQuery(check, Long.class)
                .setParameter("id", ins.getId()).getSingleResult();
        return c != null && c > 0;
    }

    /** FRS FR-Q-07 / VAL-NCR-01: auto-create an NCR (1:1) when a FAIL decision is recorded. */
    private void autoCreateNcr(QualityInspection ins, String severityOverride, String user) {
        try {
            if (ins.getId() == null || hasNcr(ins)) return;

            String severity = "MAJOR";
            if (severityOverride != null) {
                String s = severityOverride.trim().toUpperCase();
                if (List.of("MINOR", "LOW", "MAJOR", "CRITICAL").contains(s)) {
                    severity = s;
                }
            }
            if (List.of("MINOR", "LOW").contains(severity)) {
                for (QualityInspectionLine l : ins.getLines()) {
                    if ("FAIL".equals(l.getResult()) && Boolean.TRUE.equals(l.getIsCritical())) {
                        severity = "CRITICAL"; break;
                    }
                }
            } else if (severity.equals("MAJOR")) {
                for (QualityInspectionLine l : ins.getLines()) {
                    if ("FAIL".equals(l.getResult()) && Boolean.TRUE.equals(l.getIsCritical())) {
                        severity = "CRITICAL"; break;
                    }
                }
            }

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("inspectionId", ins.getId());
            body.put("sourceType", "quality-inspection");
            body.put("sourceId", String.valueOf(ins.getId()));
            body.put("sourceNumber", ins.getInspectionNumber());
            body.put("itemCode", ins.getItemCode());
            body.put("itemDescription", ins.getItemDescription());
            body.put("batchNumber", ins.getBatchNumber());
            body.put("lotNumber", ins.getLotNumber());
            body.put("heatNumber", ins.getHeatNumber());
            body.put("quantityAffected", ins.getRejectedQuantity() != null ? ins.getRejectedQuantity()
                    : ins.getInspectionQuantity());
            body.put("severity", severity);
            body.put("identifiedBy", user);
            body.put("identifiedAt", Instant.now().toString());
            body.put("defectDescription", safe(ins.getDecisionRemarks()));
            body.put("status", "MRB_DISPOSITION");
            body.put("createdBy", user);

            QualityNcr ncr = (QualityNcr) docs.create("quality-ncr", body, user);
            ncr.setStatus("MRB_DISPOSITION");
            em.persist(ncr);
            List<QualityDisposition> existing = dispositionRepo.findByNcrId(ncr.getId());
            if (existing.isEmpty()) {
                dispose(ins, ncr, "PENDING", "Awaiting MRB disposition", user, false);
            }
            recordStatusChange(ins, ins.getInspectionStatus(), ins.getInspectionStatus(), user,
                    "Auto-created NCR " + ncr.getDocNo() + " on FAIL");
        } catch (Exception ex) {
            log.warn("Auto-NCR creation failed for inspection {}: {}", ins.getId(), ex.getMessage());
        }
    }

    private String inspectTypeName(QualityInspection ins) {
        return ins.getInspectionType() == null ? "" : ins.getInspectionType().name();
    }

    /** FRS FR-Q-08 / MRB: record the disposition for a failed inspection against its NCR. */
    @Transactional
    public QualityDisposition setDisposition(Long id, String disposition, String reason, String user) {
        QualityInspection ins = get(id);
        if (ins.getInspectionStatus() == null
                || !(ins.getInspectionStatus().equals("FAIL") || ins.getInspectionStatus().equals("REJECTED"))) {
            throw new BusinessRuleException("INVALID_STATE",
                    "MRB disposition is only valid for a FAILED inspection.", null);
        }
        if (disposition == null || !MRB_DISPOSITIONS.contains(disposition.toUpperCase())) {
            throw new BusinessRuleException("INVALID_DISPOSITION",
                    "Disposition must be one of " + MRB_DISPOSITIONS + ".", null);
        }
        String disp = disposition.toUpperCase();

        // VAL-NCR-02: RTV only valid for IQC
        if ("RTV".equals(disp) && !"IQC".equalsIgnoreCase(inspectTypeName(ins))) {
            throw new BusinessRuleException("VALIDATION_FAILED",
                    "RTV (return to vendor) disposition is only permitted for IQC inspections.", null);
        }

        if (reason == null || reason.isBlank()) {
            throw new BusinessRuleException("VALIDATION_FAILED",
                    "Disposition reason is mandatory.", null);
        }

        QualityNcr ncr = findNcrFor(ins);
        List<QualityDisposition> existing = ncr != null
                ? dispositionRepo.findByNcrId(ncr.getId()) : List.of();

        QualityDisposition dispRow;
        if (existing.isEmpty()) {
            dispRow = new QualityDisposition();
            dispRow.setInspectionId(ins.getId());
            if (ncr != null) dispRow.setNcrId(ncr.getId());
            dispRow.setCreatedBy(user);
        } else {
            dispRow = existing.get(0);
        }
        dispRow.setDispositionType(disp);
        dispRow.setQuantity(ins.getRejectedQuantity() != null ? ins.getRejectedQuantity()
                : ins.getInspectionQuantity());
        dispRow.setReason(reason);
        dispRow.setAuthorizedBy(user);
        dispRow.setAuthorizedAt(Instant.now());
        em.persist(dispRow);
        em.flush();

        if (ncr != null) {
            ncr.setDispositionType(disp);
            ncr.setDisposition(disp);
            ncr.setStatus("MRB_RESOLVED");
            em.persist(ncr);
        }

        if ("REWORK".equals(disp)) {
            spawnChildInspection(ins, user);
            dispRow.setDownstreamReference("REWORK_CHILD");
        }

        if ("RTV".equals(disp)) {
            autoCreateScar(ins, ncr, user);
            dispRow.setDownstreamReference("SCAR_CREATED");
        }

        recordStatusChange(ins, ins.getInspectionStatus(), ins.getInspectionStatus(), user,
                "MRB disposition: " + disp + (reason == null ? "" : " - " + reason));
        return dispRow;
    }

    /** FRS FR-Q-14: RTV auto-raises a Supplier Corrective Action Report (SCAR) to the vendor. */
    private void autoCreateScar(QualityInspection ins, QualityNcr ncr, String user) {
        try {
            if (ins.getId() == null || hasScar(ins)) return;
            String[] supplier = resolveSupplier(ins);

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("inspectionId", ins.getId());
            body.put("ncrId", ncr != null ? ncr.getId() : null);
            body.put("inspectionType", inspectTypeName(ins));
            body.put("inspectionNumber", ins.getInspectionNumber());
            body.put("supplierCode", supplier[0]);
            body.put("supplierName", supplier[1]);
            body.put("itemCode", ins.getItemCode());
            body.put("itemDescription", ins.getItemDescription());
            body.put("batchNumber", ins.getBatchNumber());
            body.put("lotNumber", ins.getLotNumber());
            body.put("heatNumber", ins.getHeatNumber());
            body.put("quantityAffected", ins.getRejectedQuantity() != null ? ins.getRejectedQuantity()
                    : ins.getInspectionQuantity());
            body.put("defectDescription", safe(ins.getDecisionRemarks()));
            body.put("severity", ncr != null ? ncr.getSeverity() : null);
            body.put("issueDescription", "Return to vendor - supplier corrective action required. " + safe(ins.getDecisionRemarks()));
            body.put("requiredByDate", LocalDate.now().plusDays(14).toString());
            body.put("scarStatus", "OPEN");
            body.put("createdBy", user);

            QualityScar scar = (QualityScar) docs.create("quality-scar", body, user);
            log.info("RTV: auto-created SCAR {} for inspection {} (NCR {})",
                    scar.getDocNo(), ins.getId(), ncr != null ? ncr.getId() : null);
        } catch (Exception ex) {
            log.warn("RTV: SCAR auto-creation failed for inspection {}: {}", ins.getId(), ex.getMessage());
        }
    }

    private boolean hasScar(QualityInspection ins) {
        // Fail-closed: a database failure must never be interpreted as "no SCAR exists",
        // which would create a duplicate SCAR for the same inspection on retry. The error
        // propagates into autoCreateScar's controlled catch boundary (log + skip).
        Long count = em.createQuery(
                        "select count(s) from QualityScar s where s.inspectionId = :id", Long.class)
                .setParameter("id", ins.getId()).getSingleResult();
        return count != null && count > 0;
    }

    /** Best-effort supplier resolution for the SCAR: [supplierCode, supplierName]. */
    private String[] resolveSupplier(QualityInspection ins) {
        String code = null;
        String name = null;
        try {
            Long sourceId = null;
            if (ins.getSourceId() != null) {
                try { sourceId = Long.valueOf(ins.getSourceId()); } catch (Exception ignored) {}
            }
            if (sourceId != null && ins.getSourceType() != null) {
                String en = switch (ins.getSourceType().toUpperCase()) {
                    // "INWARD"/"PO_INWARD" are the legacy generic tags this field used to carry
                    // before it was corrected to hold the specific doc-type key; both are kept
                    // for inspections created before that fix.
                    case "PO_INWARD", "INWARD", "PO-INWARD" -> "PoInward";
                    case "GRN" -> "Grn";
                    case "LO_INWARD", "LO-INWARD" -> "LoInward";
                    case "JO_INWARD", "JO-INWARD" -> "JoInward";
                    case "GENERAL_INWARD", "GENERAL-INWARD" -> "GeneralInward";
                    default -> null;
                };
                if (en != null) {
                    Object n = em.createQuery(
                            "select e.supplier from " + en + " e where e.id = :id", String.class)
                            .setParameter("id", sourceId).getSingleResult();
                    if (n != null) name = n.toString();
                }
            }
        } catch (Exception ex) {
            log.warn("resolveSupplier(source) skipped for inspection {}: {}", ins.getId(), ex.getMessage());
        }
        try {
            if (ins.getPurchaseOrderNumber() != null && !ins.getPurchaseOrderNumber().isBlank()) {
                Object[] row = em.createQuery(
                                "select e.supplierCode, e.supplier from PurchaseOrder e where e.docNo = :po",
                                Object[].class)
                        .setParameter("po", ins.getPurchaseOrderNumber())
                        .setMaxResults(1).getSingleResult();
                if (row != null) {
                    if (row[0] != null) code = row[0].toString();
                    if (row[1] != null) name = row[1].toString();
                }
            }
        } catch (Exception ex) {
            log.warn("resolveSupplier(po) skipped for inspection {}: {}", ins.getId(), ex.getMessage());
        }
        return new String[]{code, name};
    }

    private QualityNcr findNcrFor(QualityInspection ins) {
        try {
            String q = "select n from in.zygertechnology.zygererp.entity.QualityNcr n " +
                    "where n.inspectionId = :id order by n.id desc";
            return em.createQuery(q, QualityNcr.class)
                    .setParameter("id", ins.getId()).setMaxResults(1).getSingleResult();
        } catch (Exception ex) {
            return null;
        }
    }

    private void dispose(QualityInspection ins, QualityNcr ncr, String type, String reason, String user,
                         boolean authoritative) {
        List<QualityDisposition> existing = ncr != null
                ? dispositionRepo.findByNcrId(ncr.getId()) : List.of();
        QualityDisposition row;
        if (authoritative && !existing.isEmpty()) {
            row = existing.get(0);
        } else if (!authoritative && !existing.isEmpty()) {
            return;
        } else {
            row = new QualityDisposition();
            row.setInspectionId(ins.getId());
            if (ncr != null) row.setNcrId(ncr.getId());
            row.setCreatedBy(user);
        }
        row.setDispositionType(type);
        row.setQuantity(ins.getRejectedQuantity() != null ? ins.getRejectedQuantity() : ins.getInspectionQuantity());
        row.setReason(reason);
        row.setAuthorizedBy(user);
        row.setAuthorizedAt(Instant.now());
        em.persist(row);
    }

    /** FRS FR-Q-08: REWORK spawns a child inspection in DRAFT with parentInspectionId set. */
    private void spawnChildInspection(QualityInspection parent, String user) {
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("inspectionType", inspectTypeName(parent));
            body.put("sourceType", "quality-inspection");
            body.put("sourceId", String.valueOf(parent.getId()));
            body.put("sourceNumber", parent.getInspectionNumber());
            body.put("itemCode", parent.getItemCode());
            body.put("itemDescription", parent.getItemDescription());
            body.put("batchNumber", parent.getBatchNumber());
            body.put("lotNumber", parent.getLotNumber());
            body.put("heatNumber", parent.getHeatNumber());
            body.put("parentInspectionId", parent.getId());
            body.put("inspectionQuantity", parent.getRejectedQuantity());
            body.put("date", LocalDate.now().toString());
            body.put("assignedInspector", parent.getAssignedInspector());
            QualityInspection child = create(body, user);
            log.info("REWORK: spawned child inspection {} for parent {}", child.getId(), parent.getId());
        } catch (Exception ex) {
            log.warn("REWORK: child inspection spawn failed for parent {}: {}", parent.getId(), ex.getMessage());
        }
    }

    /** FRS §4.6 + §6.5: BLOCK when instrument calibration is expired/failed (hard enforcement). */
    private void calibGuard(String code, QualityInspection ins, String overrideReason, String overrideUser) {
        QualityCalibrationInstrument i = instruments.findByInstrumentCode(code).orElse(null);
        if (i != null) {
            String st = i.getStatus();
            if (st != null && List.of("EXPIRED", "FAILED", "UNDER_REPAIR", "RETIRED").contains(st.toUpperCase())) {
                Map<String, Object> details = Map.of(
                        "instrumentCode", code,
                        "calibrationStatus", st,
                        "inspectionId", ins.getId() != null ? ins.getId() : "new"
                );
                throw new BusinessRuleException("CALIBRATION_BLOCKED",
                        "Instrument " + code + " has calibration status " + st + ". Cannot record measurement.",
                        details);
            }
            return;
        }
        InstrumentMaster im = instrumentMasters.findByCode(code).orElse(null);
        if (im != null) {
            String st = im.getCalibrationStatus();
            if (st != null && List.of("EXPIRED", "FAILED").contains(st.toUpperCase())) {
                Map<String, Object> details = Map.of(
                        "instrumentCode", code,
                        "calibrationStatus", st
                );
                throw new BusinessRuleException("CALIBRATION_BLOCKED",
                        "Instrument " + code + " has calibration status " + st + ". Cannot record measurement.",
                        details);
            }
        }
        // §6.5: Delegate to CalibrationGuardService for schedule-based policy enforcement (BLOCK/WARN)
        calibrationGuard.enforcePolicy(code, overrideReason, overrideUser);
    }

    /**
     * §6.5: Auto-load inspection characteristics from the active InspectionPlan
     * matching itemCode + inspectionType. Falls back to default if no plan found.
     */
    private void autoLoadInspectionPlan(QualityInspection e) {
        if (e.getItemCode() == null || e.getInspectionType() == null) return;

        String inspTypeStr = e.getInspectionType().name();
        InspectionPlan plan = null;
        // Prefer the published revision; fall back to any active plan for backward compat.
        Optional<InspectionPlan> planOpt = inspectionPlanRepo
                .findFirstByPlantIdAndItemCodeAndInspectionTypeAndPlanStatusAndActiveTrueOrderByRevisionNoDesc(
                        1L, e.getItemCode(), inspTypeStr, "PUBLISHED");
        if (planOpt.isEmpty()) {
            planOpt = inspectionPlanRepo
                    .findFirstByPlantIdAndItemCodeAndDrawingNumberAndDrawingRevisionAndOperationAndInspectionTypeAndActiveTrue(
                            1L, e.getItemCode(), null, null, null, inspTypeStr);
        }
        if (planOpt.isEmpty()) return;

        plan = planOpt.get();
        e.setInspectionPlanId(String.valueOf(plan.getId()));
        e.setInspectionPlanRevision(plan.getRevisionNo());
        int lineNo = 1;
        for (InspectionPlanCharacteristic pc : plan.getCharacteristics()) {
            QualityInspectionLine l = new QualityInspectionLine();
            l.setCharacteristicCode(pc.getCharacteristicCode());
            l.setCharacteristicName(pc.getCharacteristicName());
            l.setBalloonNo(pc.getBalloonNo());
            l.setItemCode(e.getItemCode());
            l.setDataType(pc.getDataType());
            l.setLowerLimit(pc.getLowerLimit());
            l.setUpperLimit(pc.getUpperLimit());
            l.setNominalValue(pc.getNominalValue());
            l.setTolerance(pc.getTolerance());
            l.setUom(pc.getUom());
            l.setIsSpecial(pc.getIsSpecial());
            l.setMeasurementMethod(pc.getMeasurementMethod());
            if (pc.getRequiredInstrumentType() != null) {
                l.setRequiredInstrumentId(pc.getRequiredInstrumentType());
            }
            l.setSpecificationText(pc.getSpecificationText());
            l.setIsMandatory(pc.getIsMandatory());
            l.setIsCritical(pc.getIsCritical());
            l.setLineNo(lineNo++);
            l.setQty(BigDecimal.ONE);
            l.setDoc(e);
            e.getLines().add(l);
        }
    }

    /**
     * §6.x: Apply an AQL / ANSI Z1.4 / ISO 2859-1 sampling plan to the inspection.
     * Resolves the sampling plan matching the lot size band + AQL from the inspection
     * plan, then derives the sample size and acceptance/rejection numbers.
     */
    private void applySamplingPlan(QualityInspection e) {
        try {
            BigDecimal lotSize = e.getReceivedQuantity() != null ? e.getReceivedQuantity()
                    : e.getInspectionQuantity();
            if (lotSize == null) lotSize = BigDecimal.ZERO;
            int lotQty = lotSize.compareTo(BigDecimal.ZERO) <= 0 ? 0 : lotSize.intValue();

            InspectionPlan plan = null;
            if (e.getInspectionPlanId() != null) {
                try {
                    plan = inspectionPlanRepo.findById(Long.valueOf(e.getInspectionPlanId())).orElse(null);
                } catch (Exception ignored) {}
            }

            String standard = null;
            BigDecimal aql = null;
            if (plan != null) {
                if (plan.getSamplingPlan() != null) {
                    if (standard == null) standard = plan.getSamplingPlan().getStandard();
                    if (aql == null) aql = plan.getSamplingPlan().getAql();
                }
                if (aql == null && plan.getAql() != null) aql = plan.getAql();
            }
            if (standard == null) standard = "ISO2859_1";
            if (aql == null) aql = new BigDecimal("1.0");

            final BigDecimal fAql = aql;
            SamplingPlanMaster sp = samplingRepo.findByStandardAndActiveTrue(standard).stream()
                    .filter(p -> p.getLotSizeMin() != null && p.getLotSizeMax() != null
                            && p.getLotSizeMin() <= lotQty && p.getLotSizeMax() >= lotQty)
                    .filter(p -> p.getAql() != null && p.getAql().compareTo(fAql) == 0)
                    .findFirst().orElse(null);
            if (sp == null) return;

            e.setSamplingStandard(sp.getStandard());
            e.setAql(sp.getAql());
            e.setAcceptNumber(sp.getAcceptNumber());
            e.setRejectNumber(sp.getRejectNumber());
            e.setLotSize(lotSize);
            if (sp.getSampleSize() != null) {
                e.setSampleSize(BigDecimal.valueOf(sp.getSampleSize()));
                // Only auto-derive the inspection quantity if the user did not set one.
                if (e.getInspectionQuantity() == null) {
                    e.setInspectionQuantity(BigDecimal.valueOf(sp.getSampleSize()));
                }
            }
            log.info("Sampling plan applied for inspection {}: lot {} {}, sample {}, accept {}, reject {}",
                    e.getInspectionNumber() != null ? e.getInspectionNumber() : e.getId(),
                    lotQty, standard, sp.getSampleSize(), sp.getAcceptNumber(), sp.getRejectNumber());
        } catch (Exception ex) {
            log.warn("applySamplingPlan skipped for inspection {}: {}", e.getInspectionNumber(), ex.getMessage());
        }
    }

    /**
     * §6.6: Record SPC fact table entry for each measured characteristic.
     */
    private void recordSpcMeasurement(QualityInspection ins, QualityInspectionLine l) {
        QualityCharacteristicMeasurement m = QualityCharacteristicMeasurement.builder()
                .inspectionId(ins.getId())
                .inspectionNumber(ins.getInspectionNumber())
                .inspectionType(ins.getInspectionType() != null ? ins.getInspectionType().name() : null)
                .itemCode(ins.getItemCode())
                .characteristicCode(l.getCharacteristicCode())
                .characteristicName(l.getCharacteristicName())
                .balloonNo(l.getBalloonNo())
                .nominalValue(l.getNominalValue())
                .lowerLimit(l.getLowerLimit())
                .upperLimit(l.getUpperLimit())
                .actualValue(l.getActualValue())
                .actualMin(l.getActualMin())
                .actualMax(l.getActualMax())
                .actualAvg(l.getActualAvg())
                .deviation(l.getDeviation())
                .result(l.getResult())
                .measuredAt(l.getMeasuredAt())
                .inspectionDate(ins.getInspectionDate())
                .build();
        spcRepo.save(m);
    }

    private void attach(QualityInspection e, Map<String, Object> body) {
        Object lines = body.get("lines");
        if (lines instanceof Collection<?> c) {
            for (Object o : c) {
                QualityInspectionLine l = mapper.convertValue(o, QualityInspectionLine.class);
                if (l.getCharacteristicCode() == null && l.getItemCode() != null)
                    l.setCharacteristicCode(l.getItemCode());
                l.setQty(BigDecimal.ONE);
                l.setDoc(e);
                e.getLines().add(l);
            }
        }
    }

    private LocalDate parseDate(Object v) {
        if (v == null) return null;
        try { return LocalDate.parse(v.toString().substring(0, 10)); }
        catch (Exception e) { return null; }
    }

    private BigDecimal bdVal(Object v) {
        if (v == null) return null;
        try { return new BigDecimal(String.valueOf(v)); } catch (Exception e) { return BigDecimal.ZERO; }
    }

    private String strVal(Object v) { return v == null ? "" : String.valueOf(v); }

    private String safe(String s) { return s == null ? "" : s; }

    public String nextNumber(String key) { return numbers.nextFy(key); }
}
