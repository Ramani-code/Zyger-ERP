package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.*;
import in.zygertechnology.zygererp.repo.CompanyInfoRepository;
import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * Email dispatch for Purchase documents (Supplier Enquiry / RFQ, Purchase Order, Job Order).
 *
 * Uses the configured SMTP transport (spring.mail.*). If dispatch fails, falls back to a
 * log-only dry-run so the business flow is never blocked by mail configuration issues.
 */
@Service
@RequiredArgsConstructor
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);
    private static final DateTimeFormatter D_FMT = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    private final JavaMailSender mailSender;
    private final CompanyInfoRepository companyInfoRepository;

    @Value("${app.mail.from-email:}")
    private String fromEmailOverride;

    /**
     * Send a Request-for-Quotation (Supplier Enquiry) email to a single supplier.
     *
     * @return true when dispatched (SMTP or dry-run), false when recipient email is missing.
     */
    public boolean sendSupplierEnquiryEmail(SupplierEnquiry enquiry, String toEmail, String ccEmail, String targetName) {
        if (enquiry == null) throw new IllegalArgumentException("enquiry is required");
        String recipient = toEmail == null || toEmail.isBlank()
                ? enquiry.getEmail()
                : toEmail;
        if (recipient == null || recipient.isBlank()) {
            log.error("Cannot send Enquiry email for doc {}: Recipient email is missing.", enquiry.getDocNo());
            return false;
        }
        CompanyInfo company = companyInfoRepository.findAll().stream().findFirst().orElse(null);
        String companyName = company != null && company.getCompanyName() != null ? company.getCompanyName() : "Zyger Precision Manufacturing";
        String sender = fromEmailOverride != null && !fromEmailOverride.isBlank()
                ? fromEmailOverride
                : (company != null && company.getEmail() != null ? company.getEmail() : "noreply@zyger.local");
        String subject = "Request for Quotation (RFQ) - " + enquiry.getDocNo() + " | " + safe(targetName != null ? targetName : enquiry.getSupplier());
        String body = buildEnquiryHtmlBody(enquiry, safe(targetName != null ? targetName : enquiry.getSupplier()), company, sender);
        return dispatch(sender, recipient, ccEmail, subject, body, null, null, enquiry.getDocNo());
    }

    /**
     * Send a Purchase Order email to the supplier with the PO PDF attached.
     *
     * @return true when dispatched (SMTP or dry-run), false when recipient email is missing.
     */
    public boolean sendPurchaseOrderEmail(PurchaseOrder po, String toEmail, String ccEmail, byte[] pdf, String pdfName) {
        if (po == null) throw new IllegalArgumentException("purchaseOrder is required");
        String recipient = toEmail == null || toEmail.isBlank() ? po.getEmail() : toEmail;
        if (recipient == null || recipient.isBlank()) {
            log.error("Cannot send PO email for doc {}: Recipient email is missing.", po.getDocNo());
            return false;
        }
        CompanyInfo company = companyInfoRepository.findAll().stream().findFirst().orElse(null);
        String companyName = company != null && company.getCompanyName() != null ? company.getCompanyName() : "Zyger Precision Manufacturing";
        String sender = fromEmailOverride != null && !fromEmailOverride.isBlank()
                ? fromEmailOverride
                : (company != null && company.getEmail() != null ? company.getEmail() : "noreply@zyger.local");
        String subject = "Purchase Order - " + po.getDocNo() + " | " + safe(po.getSupplier());
        String body = buildPoHtmlBody(po, company);
        return dispatch(sender, recipient, ccEmail, subject, body, pdf, pdfName, po.getDocNo());
    }

    /**
     * Send a Job Order email to the subcontractor with the JO PDF attached (optional symmetric flow).
     */
    public boolean sendJobOrderEmail(JobOrder jo, String toEmail, String ccEmail, byte[] pdf, String pdfName) {
        if (jo == null) throw new IllegalArgumentException("jobOrder is required");
        String recipient = toEmail == null || toEmail.isBlank() ? jo.getEmail() : toEmail;
        if (recipient == null || recipient.isBlank()) {
            log.error("Cannot send JO email for doc {}: Recipient email is missing.", jo.getDocNo());
            return false;
        }
        CompanyInfo company = companyInfoRepository.findAll().stream().findFirst().orElse(null);
        String sender = fromEmailOverride != null && !fromEmailOverride.isBlank()
                ? fromEmailOverride
                : (company != null && company.getEmail() != null ? company.getEmail() : "noreply@zyger.local");
        String subject = "Job Order - " + jo.getDocNo() + " | " + safe(jo.getSupplierJobWorker() != null ? jo.getSupplierJobWorker() : jo.getSupplier());
        String body = buildJoHtmlBody(jo, company);
        return dispatch(sender, recipient, ccEmail, subject, body, pdf, pdfName, jo.getDocNo());
    }

    // ─── Calibration notifications ──────────────────────────────────────

    public boolean sendCalibrationDueNotification(String recipient, String scheduleNumber,
                                                    String instrumentCode, LocalDate dueDate, boolean isOverdue) {
        if (recipient == null || recipient.isBlank()) {
            log.warn("Calibration notification skipped for {}: no recipient", scheduleNumber);
            return false;
        }
        CompanyInfo company = companyInfoRepository.findAll().stream().findFirst().orElse(null);
        String sender = fromEmailOverride != null && !fromEmailOverride.isBlank()
                ? fromEmailOverride
                : (company != null && company.getEmail() != null ? company.getEmail() : "noreply@zyger.local");
        String severityColor = isOverdue ? "#dc2626" : "#f59e0b";
        String severityLabel = isOverdue ? "OVERDUE" : "DUE SOON";
        String subject = "Calibration " + severityLabel + " — " + scheduleNumber;
        String body = "<div style=\"font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;\">"
                + "<div style=\"background:#0f172a;color:#fff;padding:14px 20px;\">"
                + "<div style=\"font-size:16px;font-weight:bold;\">Zyger ERP — Calibration Alert</div></div>"
                + "<div style=\"padding:20px;\">"
                + "<p style=\"font-size:14px;color:#334155;\">Instrument calibration is <b style=\"color:" + severityColor + ";\">" + escape(severityLabel) + "</b>:</p>"
                + "<table style=\"width:100%;font-size:13px;border-collapse:collapse;\">"
                + "<tr><td style=\"padding:6px 8px;color:#64748b;width:40%;\">Schedule Number</td><td style=\"padding:6px 8px;font-weight:600;\">" + escape(scheduleNumber) + "</td></tr>"
                + "<tr><td style=\"padding:6px 8px;color:#64748b;\">Instrument Code</td><td style=\"padding:6px 8px;\">" + escape(instrumentCode) + "</td></tr>"
                + "<tr><td style=\"padding:6px 8px;color:#64748b;\">Due Date</td><td style=\"padding:6px 8px;\">" + (dueDate != null ? dueDate.toString() : "-") + "</td></tr>"
                + "<tr><td style=\"padding:6px 8px;color:#64748b;\">Status</td><td style=\"padding:6px 8px;\"><span style=\"background:" + severityColor + ";color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;\">" + escape(severityLabel) + "</span></td></tr>"
                + "</table>"
                + "<p style=\"font-size:12px;color:#94a3b8;margin-top:16px;\">This is an automated notification from Zyger ERP.</p>"
                + "</div></div>";
        return dispatch(sender, recipient, null, subject, body, null, null, scheduleNumber);
    }

    // ─── Quality notifications ──────────────────────────────────────

    public boolean sendQualityInspectionNotification(String recipient, String inspectionNumber,
                                                      String inspectionType, String itemCode,
                                                      String status, String remarks) {
        if (recipient == null || recipient.isBlank()) {
            log.warn("Quality notification skipped for {}: no recipient", inspectionNumber);
            return false;
        }
        CompanyInfo company = companyInfoRepository.findAll().stream().findFirst().orElse(null);
        String sender = fromEmailOverride != null && !fromEmailOverride.isBlank()
                ? fromEmailOverride
                : (company != null && company.getEmail() != null ? company.getEmail() : "noreply@zyger.local");
        String statusColor = switch (status.toUpperCase()) {
            case "APPROVED", "CLOSED" -> "#16a34a";
            case "REJECTED", "CANCELLED" -> "#dc2626";
            case "ON_HOLD" -> "#f59e0b";
            default -> "#2563eb";
        };
        String subject = "Quality Inspection " + status.toUpperCase() + " — " + inspectionNumber;
        String body = "<div style=\"font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;\">"
                + "<div style=\"background:#0f172a;color:#fff;padding:14px 20px;\">"
                + "<div style=\"font-size:16px;font-weight:bold;\">Zyger ERP — Quality Notification</div></div>"
                + "<div style=\"padding:20px;\">"
                + "<p style=\"font-size:14px;color:#334155;\">The following inspection has been <b style=\"color:" + statusColor + ";\">" + escape(status) + "</b>:</p>"
                + "<table style=\"width:100%;font-size:13px;border-collapse:collapse;\">"
                + "<tr><td style=\"padding:6px 8px;color:#64748b;width:40%;\">Inspection Number</td><td style=\"padding:6px 8px;font-weight:600;\">" + escape(inspectionNumber) + "</td></tr>"
                + "<tr><td style=\"padding:6px 8px;color:#64748b;\">Type</td><td style=\"padding:6px 8px;\">" + escape(inspectionType) + "</td></tr>"
                + "<tr><td style=\"padding:6px 8px;color:#64748b;\">Item Code</td><td style=\"padding:6px 8px;\">" + escape(itemCode) + "</td></tr>"
                + "<tr><td style=\"padding:6px 8px;color:#64748b;\">Status</td><td style=\"padding:6px 8px;\"><span style=\"background:" + statusColor + ";color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;\">" + escape(status) + "</span></td></tr>"
                + (remarks != null && !remarks.isBlank() ? "<tr><td style=\"padding:6px 8px;color:#64748b;\">Remarks</td><td style=\"padding:6px 8px;\">" + escape(remarks) + "</td></tr>" : "")
                + "</table>"
                + "<p style=\"font-size:12px;color:#94a3b8;margin-top:16px;\">This is an automated notification from Zyger ERP.</p>"
                + "</div></div>";
        return dispatch(sender, recipient, null, subject, body, null, null, inspectionNumber);
    }

    // ─── user management notifications ────────────────────────────

    public boolean sendUserStatusNotification(String recipient, String displayName,
                                              String status, String reason, String approvedRole) {
        if (recipient == null || recipient.isBlank()) {
            log.warn("User status notification skipped: no recipient");
            return false;
        }
        CompanyInfo company = companyInfoRepository.findAll().stream().findFirst().orElse(null);
        String sender = fromEmailOverride != null && !fromEmailOverride.isBlank()
                ? fromEmailOverride
                : (company != null && company.getEmail() != null ? company.getEmail() : "noreply@zyger.local");
        String statusLabel = status == null ? "" : status.toUpperCase();
        String color = switch (statusLabel) {
            case "ACTIVE" -> "#16a34a";
            case "REJECTED", "SUSPENDED", "DISABLED" -> "#dc2626";
            default -> "#2563eb";
        };
        String subject = "Zyger ERP — Account " + (statusLabel.isBlank() ? "Update" : statusLabel);
        String body = "<div style=\"font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;\">"
                + "<div style=\"background:#0f172a;color:#fff;padding:14px 20px;\">"
                + "<div style=\"font-size:16px;font-weight:bold;\">Zyger ERP — Account Status</div></div>"
                + "<div style=\"padding:20px;\">"
                + "<p style=\"font-size:14px;color:#334155;\">Hi " + escape(displayName) + ",</p>"
                + "<p style=\"font-size:14px;color:#334155;\">Your Zyger ERP account status is <b style=\"color:" + color + ";\">" + escape(statusLabel) + "</b>.</p>"
                + "<table style=\"width:100%;font-size:13px;border-collapse:collapse;\">"
                + (approvedRole != null && !approvedRole.isBlank() ? "<tr><td style=\"padding:6px 8px;color:#64748b;width:40%;\">Role</td><td style=\"padding:6px 8px;font-weight:600;\">" + escape(approvedRole) + "</td></tr>" : "")
                + (reason != null && !reason.isBlank() ? "<tr><td style=\"padding:6px 8px;color:#64748b;\">Reason</td><td style=\"padding:6px 8px;\">" + escape(reason) + "</td></tr>" : "")
                + "</table>"
                + "<p style=\"font-size:12px;color:#94a3b8;margin-top:16px;\">This is an automated notification from Zyger ERP.</p>"
                + "</div></div>";
        return dispatch(sender, recipient, null, subject, body, null, null, "USER_STATUS");
    }

    /**
     * Send a Sales Invoice email to the customer with the invoice PDF attached —
     * parity with the Purchase module's PO email (Technical Design §2.5).
     */
    public boolean sendSalesInvoiceEmail(SalesInvoice invoice, String toEmail, String ccEmail, byte[] pdf, String pdfName) {
        if (invoice == null) throw new IllegalArgumentException("invoice is required");
        String recipient = toEmail == null || toEmail.isBlank() ? null : toEmail;
        if (recipient == null || recipient.isBlank()) {
            log.error("Cannot send Invoice email for doc {}: Recipient email is missing.", invoice.getDocNo());
            return false;
        }
        CompanyInfo company = companyInfoRepository.findAll().stream().findFirst().orElse(null);
        String sender = fromEmailOverride != null && !fromEmailOverride.isBlank()
                ? fromEmailOverride
                : (company != null && company.getEmail() != null ? company.getEmail() : "noreply@zyger.local");
        String subject = "Tax Invoice - " + invoice.getDocNo() + " | " + safe(invoice.getCustomer());
        String body = buildSalesInvoiceHtmlBody(invoice, company);
        return dispatch(sender, recipient, ccEmail, subject, body, pdf, pdfName, invoice.getDocNo());
    }

    // ─── private helpers ──────────────────────────────────────────────

    private boolean dispatch(String from, String to, String cc, String subject, String body,
                             byte[] pdf, String pdfName, String ref) {
        if (to == null || to.isBlank()) return false;
        String target = to + (cc != null && !cc.isBlank() ? " (cc: " + cc + ")" : "");
        log.info("Preparing to send email for Doc: {}, Target: {}", ref, target);
        try {
            MimeMessage msg = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(msg, true, "UTF-8");
            helper.setFrom(from);
            helper.setTo(to);
            if (cc != null && !cc.isBlank()) helper.setCc(cc);
            helper.setSubject(subject);
            helper.setText(body, true);
            if (pdf != null && pdf.length > 0) {
                byte[] bytes = pdf;
                String fname = pdfName != null ? pdfName : "document.pdf";
                helper.addAttachment(fname, new org.springframework.core.io.InputStreamSource() {
                    @Override public java.io.InputStream getInputStream() {
                        return new java.io.ByteArrayInputStream(bytes);
                    }
                });
            }
            mailSender.send(msg);
            log.info("Successfully sent email for {} to {} via SMTP", ref, to);
            return true;
        } catch (Exception e) {
            log.warn("SMTP email delivery failed ({}), falling back to Log/Dry-Run mode: {}", e.getMessage(), ref);
            log.info("============== [DRY-RUN / LOG MODE EMAIL DISPATCH] ==============");
            log.info("TO: {}", to);
            if (cc != null && !cc.isBlank()) log.info("CC: {}", cc);
            log.info("SUBJECT: {}", subject);
            log.info("BODY LENGTH: {} chars, PDF: {} bytes", body.length(), pdf != null ? pdf.length : 0);
            log.info("=============================================================");
            return true;
        }
    }

    private String buildEnquiryHtmlBody(SupplierEnquiry se, String supplierName, CompanyInfo company, String sender) {
        String companyName = company != null && company.getCompanyName() != null ? company.getCompanyName() : "Zyger Precision Manufacturing";
        String address = company != null
                ? joinParts(company.getRegisteredAddress(), company.getCity(), company.getState(), company.getPincode(), company.getCinNumber())
                : "";
        StringBuilder items = new StringBuilder();
        if (se.getLines() != null) {
            for (SupplierEnquiryItem it : se.getLines()) {
                items.append("<tr>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;\">").append(safe(it.getItemCode())).append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;\">").append(safe(it.getItemName())).append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;\">").append(safe(it.getSpecification())).append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;\">").append(it.getRequiredQty() != null ? it.getRequiredQty().toPlainString() : "").append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;\">").append(safe(it.getUom())).append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;\">").append(fmtDate(it.getRequiredDeliveryDate())).append("</td>")
                        .append("</tr>");
            }
        }
        return "<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;\">"
                + "<div style=\"background:#0f172a;color:#fff;padding:16px 24px;\">"
                + "<div style=\"font-size:18px;font-weight:bold;\">" + escape(safe(companyName)) + "</div>"
                + "<div style=\"font-size:11px;color:#cbd5e1;margin-top:2px;\">" + escape(address) + "</div>"
                + "</div>"
                + "<div style=\"padding:24px;\">"
                + "<div style=\"font-size:16px;font-weight:bold;color:#0f172a;\">REQUEST FOR QUOTATION (RFQ) — ENQUIRY NO: " + escape(safe(se.getDocNo())) + "</div>"
                + "<div style=\"font-size:12px;color:#64748b;margin-top:4px;\">Dear " + escape(supplierName) + ",</div>"
                + "<p style=\"font-size:13px;color:#334155;\">Kindly quote your best price and delivery for the items below. Please respond before the closing date mentioned.</p>"
                + "<table style=\"width:100%;border-collapse:collapse;font-size:12px;margin:12px 0;\">"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;width:50%;\">Supplier Name</td><td style=\"padding:4px 8px;font-weight:bold;\">" + escape(supplierName) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">Enquiry Date</td><td style=\"padding:4px 8px;\">" + fmtDate(se.getDocDate()) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">Required Delivery Date</td><td style=\"padding:4px 8px;\">" + fmtDate(se.getRequiredDate()) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">Quotation Closing Date</td><td style=\"padding:4px 8px;\">" + fmtDate(se.getQuotationValidityDate() != null ? se.getQuotationValidityDate() : se.getValidUntil()) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">Payment Terms</td><td style=\"padding:4px 8px;\">" + escape(safe(se.getPaymentTerms())) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">Delivery Terms</td><td style=\"padding:4px 8px;\">" + escape(safe(se.getDeliveryTerms())) + "</td></tr>"
                + "</table>"
                + "<table style=\"width:100%;border-collapse:collapse;font-size:12px;margin:12px 0;\">"
                + "<tr style=\"background:#f1f5f9;\"><th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:left;color:#334155;\">Item Code</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:left;color:#334155;\">Item Description</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:left;color:#334155;\">Specification</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;color:#334155;\">Qty</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:left;color:#334155;\">UOM</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:left;color:#334155;\">Req. Date</th></tr>"
                + items
                + "</table>"
                + (se.getRemarks() != null && !se.getRemarks().isBlank()
                    ? "<div style=\"background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 12px;font-size:12px;color:#1e40af;\"><b>Special Instructions from Buyer:</b> " + escape(se.getRemarks()) + "</div>"
                    : "")
                + "<p style=\"font-size:12px;color:#475569;margin-top:16px;\">We look forward to your quotation. Please get in touch if you need any clarification.</p>"
                + "<p style=\"font-size:12px;color:#475569;\">Regards,<br/>" + escape(safe(se.getBuyer())) + "<br/>" + escape(companyName) + "</p>"
                + "</div></div>";
    }

    private String buildPoHtmlBody(PurchaseOrder po, CompanyInfo company) {
        String companyName = company != null && company.getCompanyName() != null ? company.getCompanyName() : "Zyger Precision Manufacturing";
        StringBuilder items = new StringBuilder();
        java.math.BigDecimal total = java.math.BigDecimal.ZERO;
        if (po.getLines() != null) {
            for (PurchaseOrderItem it : po.getLines()) {
                java.math.BigDecimal lineTotal = it.getNetAmount() != null ? it.getNetAmount() : java.math.BigDecimal.ZERO;
                total = total.add(lineTotal);
                items.append("<tr>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;\">").append(safe(it.getItemCode())).append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;\">").append(safe(it.getItemName())).append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;\">").append(it.getOrderQty() != null ? it.getOrderQty().toPlainString() : "").append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;\">").append(safe(it.getUom())).append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;\">").append(it.getUnitPrice() != null ? it.getUnitPrice().toPlainString() : "").append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;\">").append(lineTotal.toPlainString()).append("</td>")
                        .append("</tr>");
            }
        }
        return "<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;\">"
                + "<div style=\"background:#0f172a;color:#fff;padding:16px 24px;\">"
                + "<div style=\"font-size:18px;font-weight:bold;\">" + escape(safe(companyName)) + "</div>"
                + "</div>"
                + "<div style=\"padding:24px;\">"
                + "<div style=\"font-size:16px;font-weight:bold;color:#0f172a;\">PURCHASE ORDER — " + escape(safe(po.getDocNo())) + "</div>"
                + "<div style=\"font-size:12px;color:#64748b;margin-top:4px;\">Dear " + escape(safe(po.getSupplier())) + ",</div>"
                + "<p style=\"font-size:13px;color:#334155;\">Please find attached our Purchase Order. Kindly confirm acceptance and schedule the delivery as per the terms below.</p>"
                + "<table style=\"width:100%;border-collapse:collapse;font-size:12px;margin:12px 0;\">"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;width:50%;\">Supplier</td><td style=\"padding:4px 8px;font-weight:bold;\">" + escape(safe(po.getSupplier())) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">PO Date</td><td style=\"padding:4px 8px;\">" + fmtDate(po.getDocDate()) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">Expected Delivery</td><td style=\"padding:4px 8px;\">" + fmtDate(po.getExpectedDeliveryDate()) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">Payment Terms</td><td style=\"padding:4px 8px;\">" + escape(safe(po.getPaymentTerms())) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">Delivery Location</td><td style=\"padding:4px 8px;\">" + escape(safe(po.getDeliveryLocation())) + "</td></tr>"
                + "</table>"
                + "<table style=\"width:100%;border-collapse:collapse;font-size:12px;margin:12px 0;\">"
                + "<tr style=\"background:#f1f5f9;\"><th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:left;color:#334155;\">Item</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:left;color:#334155;\">Description</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;color:#334155;\">Qty</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:left;color:#334155;\">UOM</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;color:#334155;\">Rate</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;color:#334155;\">Amount</th></tr>"
                + items
                + "<tr><td colspan=\"5\" style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;font-weight:bold;\">Total</td>"
                + "<td style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;font-weight:bold;\">" + total.toPlainString() + "</td></tr>"
                + "</table>"
                + (po.getRemarks() != null && !po.getRemarks().isBlank()
                    ? "<div style=\"background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:10px 12px;font-size:12px;color:#92400e;\"><b>Remarks:</b> " + escape(po.getRemarks()) + "</div>"
                    : "")
                + "<p style=\"font-size:12px;color:#475569;margin-top:16px;\">Regards,<br/>" + escape(safe(po.getBuyer())) + "<br/>" + escape(companyName) + "</p>"
                + "</div></div>";
    }

    private String buildSalesInvoiceHtmlBody(SalesInvoice invoice, CompanyInfo company) {
        String companyName = company != null && company.getCompanyName() != null ? company.getCompanyName() : "Zyger Precision Manufacturing";
        StringBuilder items = new StringBuilder();
        if (invoice.getLines() != null) {
            for (SalesInvoiceItem it : invoice.getLines()) {
                java.math.BigDecimal lineTotal = it.getNetAmount() != null ? it.getNetAmount() : java.math.BigDecimal.ZERO;
                items.append("<tr>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;\">").append(safe(it.getItemCode())).append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;\">").append(it.getQty() != null ? it.getQty().toPlainString() : "").append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;\">").append(safe(it.getUom())).append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;\">").append(it.getUnitPrice() != null ? it.getUnitPrice().toPlainString() : "").append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;\">").append(lineTotal.toPlainString()).append("</td>")
                        .append("</tr>");
            }
        }
        java.math.BigDecimal total = invoice.getTotalAmount() != null ? invoice.getTotalAmount() : java.math.BigDecimal.ZERO;
        return "<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;\">"
                + "<div style=\"background:#0f172a;color:#fff;padding:16px 24px;\">"
                + "<div style=\"font-size:18px;font-weight:bold;\">" + escape(safe(companyName)) + "</div>"
                + "</div>"
                + "<div style=\"padding:24px;\">"
                + "<div style=\"font-size:16px;font-weight:bold;color:#0f172a;\">TAX INVOICE — " + escape(safe(invoice.getDocNo())) + "</div>"
                + "<div style=\"font-size:12px;color:#64748b;margin-top:4px;\">Dear " + escape(safe(invoice.getCustomer())) + ",</div>"
                + "<p style=\"font-size:13px;color:#334155;\">Please find attached our tax invoice for goods dispatched as per the details below.</p>"
                + "<table style=\"width:100%;border-collapse:collapse;font-size:12px;margin:12px 0;\">"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;width:50%;\">Customer</td><td style=\"padding:4px 8px;font-weight:bold;\">" + escape(safe(invoice.getCustomer())) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">Invoice Date</td><td style=\"padding:4px 8px;\">" + fmtDate(invoice.getDocDate()) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">Payment Due Date</td><td style=\"padding:4px 8px;\">" + fmtDate(invoice.getDueDate()) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">Customer GSTIN</td><td style=\"padding:4px 8px;\">" + escape(safe(invoice.getCustomerGstin())) + "</td></tr>"
                + "</table>"
                + "<table style=\"width:100%;border-collapse:collapse;font-size:12px;margin:12px 0;\">"
                + "<tr style=\"background:#f1f5f9;\"><th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:left;color:#334155;\">Item</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;color:#334155;\">Qty</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:left;color:#334155;\">UOM</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;color:#334155;\">Rate</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;color:#334155;\">Amount</th></tr>"
                + items
                + "<tr><td colspan=\"4\" style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;font-weight:bold;\">Total</td>"
                + "<td style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;font-weight:bold;\">" + total.toPlainString() + "</td></tr>"
                + "</table>"
                + "<p style=\"font-size:12px;color:#475569;margin-top:16px;\">Regards,<br/>" + escape(companyName) + "</p>"
                + "</div></div>";
    }

    private String buildJoHtmlBody(JobOrder jo, CompanyInfo company) {
        String companyName = company != null && company.getCompanyName() != null ? company.getCompanyName() : "Zyger Precision Manufacturing";
        StringBuilder items = new StringBuilder();
        if (jo.getLines() != null) {
            for (JobOrderItem it : jo.getLines()) {
                items.append("<tr>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;\">").append(safe(it.getItemCode())).append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;\">").append(safe(it.getItemName())).append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;\">").append(it.getOrderQty() != null ? it.getOrderQty().toPlainString() : "").append("</td>")
                        .append("<td style=\"padding:6px 8px;border:1px solid #e2e8f0;\">").append(safe(it.getUom())).append("</td>")
                        .append("</tr>");
            }
        }
        return "<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;\">"
                + "<div style=\"background:#0f172a;color:#fff;padding:16px 24px;\">"
                + "<div style=\"font-size:18px;font-weight:bold;\">" + escape(safe(companyName)) + "</div>"
                + "</div>"
                + "<div style=\"padding:24px;\">"
                + "<div style=\"font-size:16px;font-weight:bold;color:#0f172a;\">JOB ORDER — " + escape(safe(jo.getDocNo())) + "</div>"
                + "<div style=\"font-size:12px;color:#64748b;margin-top:4px;\">Dear " + escape(safe(jo.getSupplierJobWorker() != null ? jo.getSupplierJobWorker() : jo.getSupplier())) + ",</div>"
                + "<p style=\"font-size:13px;color:#334155;\">Please process the following job work as per the attached Job Order. Kindly confirm receipt and expected completion date.</p>"
                + "<table style=\"width:100%;border-collapse:collapse;font-size:12px;margin:12px 0;\">"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;width:50%;\">Subcontractor</td><td style=\"padding:4px 8px;font-weight:bold;\">" + escape(safe(jo.getSupplierJobWorker() != null ? jo.getSupplierJobWorker() : jo.getSupplier())) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">Process</td><td style=\"padding:4px 8px;\">" + escape(safe(jo.getProcess() != null ? jo.getProcess() : jo.getProcessName())) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">JO Date</td><td style=\"padding:4px 8px;\">" + fmtDate(jo.getDocDate()) + "</td></tr>"
                + "<tr><td style=\"padding:4px 8px;color:#64748b;\">Expected Return</td><td style=\"padding:4px 8px;\">" + fmtDate(jo.getExpectedReturnDate()) + "</td></tr>"
                + "</table>"
                + "<table style=\"width:100%;border-collapse:collapse;font-size:12px;margin:12px 0;\">"
                + "<tr style=\"background:#f1f5f9;\"><th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:left;color:#334155;\">Item</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:left;color:#334155;\">Description</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:right;color:#334155;\">Qty</th>"
                + "<th style=\"padding:6px 8px;border:1px solid #e2e8f0;text-align:left;color:#334155;\">UOM</th></tr>"
                + items
                + "</table>"
                + "</div></div>";
    }

    private String fmtDate(java.time.LocalDate d) {
        return d == null ? "" : D_FMT.format(d);
    }

    private String joinParts(Object... parts) {
        StringBuilder sb = new StringBuilder();
        for (Object p : parts) {
            if (p == null) continue;
            String s = String.valueOf(p).trim();
            if (!s.isEmpty()) {
                if (sb.length() > 0) sb.append(", ");
                sb.append(s);
            }
        }
        return sb.toString();
    }

    private String safe(String s) { return s == null ? "" : s; }

    private String escape(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&#39;");
    }
}
