package in.zygertechnology.zygererp.service;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import in.zygertechnology.zygererp.entity.CompanyInfo;
import in.zygertechnology.zygererp.entity.ItemMaster;
import org.jsoup.Jsoup;
import org.jsoup.helper.W3CDom;
import org.jsoup.nodes.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Renders individual documents as print-ready PDFs.
 *
 * <p>All documents share one visual identity — a centered company letterhead, a dark
 * title bar, a bordered details grid, a striped items table, a totals bar, a terms
 * box, and a signature strip — modeled directly on the client-supplied print template
 * (letterhead HTML). Every document type below builds real HTML against that shared
 * stylesheet and renders it to PDF via openhtmltopdf, rather than constructing PDF
 * primitives by hand (the previous OpenPDF/PdfPTable approach, which gave every
 * document type its own ad-hoc look).</p>
 */
@Service
public class PrintService {

    private static final Logger log = LoggerFactory.getLogger(PrintService.class);

    private final in.zygertechnology.zygererp.repo.CompanyInfoRepository companyInfos;
    private final in.zygertechnology.zygererp.repo.ItemRepository items;

    public PrintService(in.zygertechnology.zygererp.repo.CompanyInfoRepository companyInfos,
                         in.zygertechnology.zygererp.repo.ItemRepository items) {
        this.companyInfos = companyInfos;
        this.items = items;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Shared stylesheet — adapted from the client-supplied print template.
    // Every document type below reuses these exact classes.
    // ═══════════════════════════════════════════════════════════════════════

    private static final String CSS = """
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @page { size: A4 portrait; margin: 10mm; }
        body { font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; font-size: 9pt; color: #0f172a; }
        .divmain { width: 100%; border: 1.5px solid #334155; background: #ffffff; }
        table { width: 100%; border-collapse: collapse; border-spacing: 0; table-layout: fixed; }
        td, th { padding: 6px 8px; vertical-align: middle; word-wrap: break-word; }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .text-left { text-align: left; }
        .bold { font-weight: 700; }
        .company-header-table { width: 100%; border-bottom: 1px solid #cbd5e1; background-color: #ffffff; }
        .logo-container { text-align: center; margin-bottom: 6px; }
        .logo-img { max-height: 46px; width: auto; }
        .inv-logo { max-width: 90px; max-height: 55px; object-fit: contain; }
        .inv-company { font-size: 15pt; font-weight: 800; color: #0f172a; letter-spacing: -0.2px; text-transform: uppercase; }
        .company-title { font-size: 15pt; font-weight: 800; color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; }
        .company-address { font-size: 8.5pt; color: #475569; margin-top: 3px; line-height: 1.35; text-align: center; }
        .company-contact { font-size: 8pt; color: #334155; line-height: 1.4; text-align: center; margin-top: 4px; }
        .dc-title-header { width: 100%; background-color: #1e293b; color: #ffffff; text-align: center; font-size: 12pt; font-weight: 700; letter-spacing: 1px; padding: 6px 0; text-transform: uppercase; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .copy-label { text-align: center; font-size: 9pt; font-weight: 700; color: #1e293b; padding: 4px 0; letter-spacing: 1px; }
        .details-table { border-top: 1px solid #334155; border-bottom: 1px solid #334155; border-collapse: collapse; }
        .details-table td { font-size: 8.5pt; }
        .border-right { border-right: 1px solid #cbd5e1; }
        .border-bottom { border-bottom: 1px solid #cbd5e1; }
        .meta-label { color: #334155; font-weight: 600; }
        .meta-value { color: #0f172a; font-weight: 700; }
        .highlight-text { color: #0f172a; font-weight: 700; }
        .section-bar { width: 100%; background-color: #1e293b; color: #ffffff; font-size: 9.5pt; font-weight: 700; letter-spacing: 0.5px; padding: 5px 8px; text-transform: uppercase; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .item-table { width: 100%; border-collapse: collapse; border-spacing: 0; border-bottom: 1px solid #334155; }
        .item-table th { background-color: #f1f5f9; color: #0f172a; font-weight: 700; font-size: 8.5pt; text-align: center; border: 1px solid #cbd5e1; padding: 6px 4px; text-transform: uppercase; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .item-table td { border-right: 1px solid #cbd5e1; border-bottom: 1px solid #e2e8f0; font-size: 8.5pt; padding: 6px; vertical-align: middle; }
        .item-table td:last-child { border-right: none; }
        .item-table tr:nth-child(even) td { background-color: #f8fafc; }
        .total-row { background-color: #f1f5f9; border-top: 1px solid #334155; border-bottom: 1px solid #334155; font-weight: 700; font-size: 9pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .terms-box { padding: 8px 10px; border-bottom: 1px solid #334155; font-size: 8.5pt; background-color: #ffffff; }
        .terms-title { font-weight: 700; color: #1e293b; margin-bottom: 4px; text-decoration: underline; }
        .sig-container { width: 100%; border-bottom: 1px solid #334155; border-collapse: collapse; }
        .sig-block { height: 78px; font-size: 8pt; vertical-align: top; padding: 6px; }
        .computer-generated { text-align: center; font-size: 7.5pt; color: #64748b; padding: 5px 0; font-style: italic; }
        .footer-note { text-align: left; font-size: 7pt; color: #64748b; padding: 4px 8px; }
        .two-col-grid td { vertical-align: top; padding: 8px; font-size: 8.5pt; }
        .box-heading { display: block; font-weight: 700; color: #334155; font-size: 8pt; text-transform: uppercase; margin-bottom: 3px; }
        .box-shaded { background-color: #f8fafc; }
        .watermark { position: fixed; top: 45%; left: 0; width: 100%; text-align: center; font-size: 26pt; font-weight: 800; transform: rotate(-30deg); z-index: 999; opacity: 0.20; white-space: nowrap; }
        .watermark-draft { color: #dc3c3c; }
        .watermark-cancelled { color: #c81e1e; }
        .watermark-invoiced { color: #288c3c; }
        """;

    // ═══════════════════════════════════════════════════════════════════════
    // Sales Invoice — dedicated GST tax-invoice stylesheet. This template is
    // deliberately scoped to the sales invoice only; every other document keeps
    // the shared {@link #CSS} above. Adapted from the client-supplied invoice.html.
    // ═══════════════════════════════════════════════════════════════════════

    private static final String INVOICE_CSS = """
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @page { size: A4 portrait; margin: 8mm; }
        html, body { width: 100%; margin: 0; padding: 0; background-color: #ffffff;
                     font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #1e293b; }
        .inv-box { width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; background: #ffffff; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        td, th { padding: 4px 6px; vertical-align: top; word-wrap: break-word; }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .text-left { text-align: left; }
        .bold { font-weight: 700; }
        .text-muted { color: #64748b; }
        .border-bottom { border-bottom: 1px solid #cbd5e1; }
        .border-top { border-top: 1px solid #cbd5e1; }
        .border-right { border-right: 1px solid #cbd5e1; }
        .accent-bg { background-color: #f8fafc; }
        .banner-title { background-color: #0f172a; color: #ffffff; font-size: 11pt; font-weight: 700;
                         letter-spacing: 1.5px; text-transform: uppercase; padding: 4px 0; text-align: center; }
        .kv-table td { padding: 2px 4px; font-size: 9pt; }
        .kv-label { color: #475569; font-weight: 600; font-size: 8pt; }
        .nowrap { white-space: nowrap; }
        .inv-logo { max-width: 90px; max-height: 55px; object-fit: contain; }
        .inv-qr { width: 62px; height: 62px; }
        .inv-company { font-size: 15pt; font-weight: 800; color: #0f172a; letter-spacing: -0.2px; text-transform: uppercase; }
        .items-table th { background-color: #f1f5f9; color: #0f172a; font-size: 8pt; font-weight: 700;
                          text-transform: uppercase; border-bottom: 2px solid #cbd5e1; border-right: 1px solid #cbd5e1; padding: 5px; white-space: nowrap; }
        .items-table th:last-child { border-right: none; }
        .items-table td { border-bottom: 1px solid #f1f5f9; border-right: 1px solid #f1f5f9; font-size: 9pt; padding: 5px; vertical-align: top; }
        .items-table td:last-child { border-right: none; }
        .items-table tbody tr:nth-child(even) { background-color: #fafafa; }
        .grand-total-row { background-color: #f1f5f9; border-top: 2px solid #cbd5e1; border-bottom: 2px solid #cbd5e1; }
        .footer-note { text-align: left; font-size: 7pt; color: #64748b; padding: 6px 8px 2px; }
        .computer-generated { text-align: center; font-size: 7.5pt; color: #64748b; padding: 4px 0 8px; font-style: italic; }
        .terms-text { font-size: 8.5pt; color: #475569; line-height: 1.3; }
        .watermark { position: fixed; top: 45%; left: 0; width: 100%; text-align: center; font-size: 26pt; font-weight: 800;
                     transform: rotate(-30deg); z-index: 999; opacity: 0.20; white-space: nowrap; }
        .watermark-draft { color: #dc3c3c; }
        """;

    // ═══════════════════════════════════════════════════════════════════════
    // Shared HTML-building blocks
    // ═══════════════════════════════════════════════════════════════════════

    private String logoDataUri() {
        try {
            CompanyInfo ci = companyInfos.findById(1L).orElse(null);
            if (ci == null || ci.getCompanyLogoUrl() == null || ci.getCompanyLogoUrl().isBlank()) return null;
            Path filePath = Path.of("." + ci.getCompanyLogoUrl());
            if (!Files.exists(filePath)) return null;
            byte[] bytes = Files.readAllBytes(filePath);
            String mime = Files.probeContentType(filePath);
            if (mime == null) mime = "image/png";
            return "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(bytes);
        } catch (Exception e) {
            log.warn("Could not load company logo for PDF: {}", e.getMessage());
            return null;
        }
    }

    /** Company block shared by the sales invoice and all other prints: bold uppercase
     * title including the display type (e.g. "PRIVATE LIMITED"), address, GSTIN/PAN
     * and Email/Phone — visually identical in every document type. */
    private String companyCenterBlock(CompanyInfo ci) {
        String company = ci != null ? firstNonEmpty(ci.getPrintName(), ci.getCompanyName(), "Company") : "Company";
        String companyType = ci != null ? str(ci.getDisplayType()) : "";
        String addr = firstNonEmpty(ci != null ? ci.getAddressLine1() : "", ci != null ? ci.getRegisteredAddress() : "");
        String cityLine = String.join(", ", nonEmpty(ci != null ? ci.getCity() : "", ci != null ? ci.getState() : "", ci != null ? ci.getPincode() : ""));
        String addrFull = mergeAddress(addr, cityLine);
        String gstin = ci != null ? firstNonEmpty(ci.getGstin(), ci.getGstNumber()) : "";
        String pan = ci != null ? firstNonEmpty(ci.getPan(), ci.getPanNumber()) : "";
        String email = ci != null ? ci.getEmail() : "";
        String phone = "", mobile = "";
        if (ci != null) { phone = str(ci.getPhone()); mobile = str(ci.getMobile()); }
        phone = phone.isBlank() ? mobile
                : (mobile.isBlank() || phone.equals(mobile) ? phone : phone + " / " + mobile);

        StringBuilder sb = new StringBuilder();
        String companyLine = companyType.isBlank() ? company : company + " " + companyType.toUpperCase();
        sb.append("<div class=\"inv-company\">").append(esc(companyLine)).append("</div>");
        if (!addrFull.isBlank()) {
            sb.append("<div style=\"font-size:9pt; color:#475569; margin-top:2px; line-height:1.3;\">").append(multiLine(addrFull)).append("</div>");
        }
        if (!gstin.isBlank() || !pan.isBlank()) {
            sb.append("<div style=\"font-size:9pt; margin-top:2px;\"><span class=\"bold\">GSTIN:</span> ").append(esc(gstin));
            if (!pan.isBlank()) sb.append(" &nbsp;|&nbsp; <span class=\"bold\">PAN:</span> ").append(esc(pan));
            sb.append("</div>");
        }
        if (!email.isBlank() || !phone.isBlank()) {
            sb.append("<div style=\"font-size:9pt; color:#475569; margin-top:1px;\"><span class=\"bold\">Email:</span> ").append(esc(email));
            if (!phone.isBlank()) sb.append(" &nbsp;|&nbsp; <span class=\"bold\">Phone:</span> ").append(esc(phone));
            sb.append("</div>");
        }
        return sb.toString();
    }

    /** Sales-invoice style letterhead shared by all non-invoice prints: logo on the
     * left, company block centred (20/60/20 grid), empty right cell. */
    private String letterhead() {
        CompanyInfo ci = companyInfos.findById(1L).orElse(null);
        String logo = logoDataUri();
        StringBuilder sb = new StringBuilder();
        sb.append("<table class=\"company-header-table\"><tr>");
        sb.append("<td style=\"width:20%; vertical-align:middle;\" class=\"text-center\">");
        if (logo != null) {
            sb.append("<img src=\"").append(logo).append("\" class=\"inv-logo\" alt=\"logo\"/>");
        }
        sb.append("</td>");
        sb.append("<td style=\"width:60%; vertical-align:middle;\" class=\"text-center\">").append(companyCenterBlock(ci)).append("</td>");
        sb.append("<td style=\"width:20%; vertical-align:middle;\" class=\"text-center\"></td>");
        sb.append("</tr></table>");
        return sb.toString();
    }

    private String titleBarHtml(String title) {
        return "<div class=\"dc-title-header\">" + esc(title) + "</div>";
    }

    private String sectionBarHtml(String title) {
        return "<div class=\"section-bar\">" + esc(title) + "</div>";
    }

    private String copyLabelHtml(Integer copyNumber) {
        if (copyNumber == null || copyNumber <= 0) return "";
        String label = switch (copyNumber) {
            case 1 -> "ORIGINAL";
            case 2 -> "DUPLICATE";
            case 3 -> "TRIPLICATE";
            default -> "COPY " + copyNumber;
        };
        return "<div class=\"copy-label\">" + label + "</div>";
    }

    /** Two-column meta grid (like the template's Challan No./Date/Ref PO block). */
    private String metaGrid(List<String[]> rows) {
        StringBuilder sb = new StringBuilder("<table class=\"details-table\"><tr><td style=\"width:100%; padding:0;\"><table>");
        for (int i = 0; i < rows.size(); i++) {
            String[] r = rows.get(i);
            boolean last = i == rows.size() - 1;
            String bb = last ? "" : " border-bottom";
            sb.append("<tr><td style=\"width:40%;\" class=\"border-right").append(bb).append(" meta-label\">")
              .append(esc(r[0])).append("</td><td style=\"width:60%;\" class=\"").append(bb.trim())
              .append(" highlight-text\">").append(esc(r[1])).append("</td></tr>");
        }
        sb.append("</table></td></tr></table>");
        return sb.toString();
    }

    /** Full-width details grid: label/value pairs, 2 per row (4 cells), used for header info blocks. */
    private String fieldGrid(List<String[]> pairs) {
        StringBuilder sb = new StringBuilder("<table class=\"details-table\">");
        for (int i = 0; i < pairs.size(); i += 2) {
            sb.append("<tr>");
            sb.append(fieldCells(pairs.get(i)[0], pairs.get(i)[1]));
            if (i + 1 < pairs.size()) {
                sb.append(fieldCells(pairs.get(i + 1)[0], pairs.get(i + 1)[1]));
            } else {
                sb.append("<td class=\"border-right\" style=\"width:18%;\"></td><td style=\"width:32%;\"></td>");
            }
            sb.append("</tr>");
        }
        return sb.append("</table>").toString();
    }

    private String fieldCells(String label, String value) {
        return "<td style=\"width:18%;\" class=\"border-right meta-label\">" + esc(label) + "</td>"
             + "<td style=\"width:32%;\" class=\"meta-value\">" + esc(value == null ? "" : value) + "</td>";
    }

    /** Two boxes side by side (Consignee/From-Location, Vendor/Deliver-To, Billed-To/Shipped-To, etc.). */
    private String twoBoxGrid(String leftHeading, List<String> leftLines, String rightHeading, List<String> rightLines) {
        StringBuilder sb = new StringBuilder("<table class=\"two-col-grid\"><tr>");
        sb.append("<td style=\"width:50%;\" class=\"border-right box-shaded\">");
        sb.append("<span class=\"box-heading\">").append(esc(leftHeading)).append("</span>");
        for (int i = 0; i < leftLines.size(); i++) {
            sb.append("<div style=\"").append(i == 0 ? "font-weight:700;font-size:9.5pt;" : "color:#334155;margin-top:2px;")
              .append("\">").append(esc(leftLines.get(i))).append("</div>");
        }
        sb.append("</td>");
        sb.append("<td style=\"width:50%;\" class=\"box-shaded\">");
        sb.append("<span class=\"box-heading\">").append(esc(rightHeading)).append("</span>");
        for (int i = 0; i < rightLines.size(); i++) {
            sb.append("<div style=\"").append(i == 0 ? "font-weight:700;font-size:9.5pt;" : "color:#334155;margin-top:2px;")
              .append("\">").append(esc(rightLines.get(i))).append("</div>");
        }
        sb.append("</td></tr></table>");
        return sb.toString();
    }

    /** The striped items table with a footer totals row (`.total-row`, colspan on first N-1 columns). */
    private String itemsTable(List<String> headers, List<List<String>> rows, boolean[] rightAlign,
                               String totalLabel, List<String> totalValues) {
        return itemsTable(headers, rows, rightAlign, null, totalLabel, totalValues);
    }

    /** Same as above, with explicit relative column widths (normalized to 100%, need not sum to 100 themselves). */
    private String itemsTable(List<String> headers, List<List<String>> rows, boolean[] rightAlign,
                               int[] widths, String totalLabel, List<String> totalValues) {
        StringBuilder sb = new StringBuilder("<table class=\"item-table\">");
        if (widths != null && widths.length == headers.size()) {
            double sum = 0;
            for (int w : widths) sum += w;
            sb.append("<colgroup>");
            for (int w : widths) sb.append("<col style=\"width:").append(String.format("%.3f", w * 100.0 / sum)).append("%;\"/>");
            sb.append("</colgroup>");
        }
        sb.append("<thead><tr>");
        for (String h : headers) sb.append("<th>").append(esc(h)).append("</th>");
        sb.append("</tr></thead><tbody>");
        for (List<String> row : rows) {
            sb.append("<tr>");
            for (int c = 0; c < row.size(); c++) {
                String align = rightAlign != null && c < rightAlign.length && rightAlign[c] ? "right" : "left";
                sb.append("<td style=\"text-align:").append(align).append(";\">").append(esc(row.get(c))).append("</td>");
            }
            sb.append("</tr>");
        }
        sb.append("</tbody></table>");
        if (totalLabel != null) {
            int labelSpan = Math.max(1, headers.size() - totalValues.size());
            sb.append("<table class=\"total-row\"><tr>");
            sb.append("<td colspan=\"").append(labelSpan).append("\" style=\"text-align:right;\">").append(esc(totalLabel)).append("</td>");
            for (String v : totalValues) {
                sb.append("<td style=\"text-align:right;\">").append(esc(v)).append("</td>");
            }
            sb.append("</tr></table>");
        }
        return sb.toString();
    }

    private String termsBox(String title, List<String> lines) {
        if (lines.isEmpty()) return "";
        StringBuilder sb = new StringBuilder("<div class=\"terms-box\">");
        if (title != null) sb.append("<div class=\"terms-title\">").append(esc(title)).append("</div>");
        sb.append("<div style=\"color:#334155; line-height:1.4;\">");
        for (int i = 0; i < lines.size(); i++) {
            if (i > 0) sb.append("<br/>");
            sb.append(esc(lines.get(i)));
        }
        sb.append("</div></div>");
        return sb.toString();
    }

    /** N signature blocks in one row, optionally preceded by a non-signature info cell. */
    private String sigContainer(String infoCellHtml, String... labels) {
        int cols = labels.length + (infoCellHtml != null ? 1 : 0);
        int pct = 100 / cols;
        StringBuilder sb = new StringBuilder("<table class=\"sig-container\"><tr>");
        int i = 0;
        if (infoCellHtml != null) {
            sb.append("<td style=\"width:").append(pct).append("%;\" class=\"border-right sig-block\">").append(infoCellHtml).append("</td>");
            i++;
        }
        for (String label : labels) {
            boolean last = ++i == cols;
            sb.append("<td style=\"width:").append(pct).append("%; text-align:center;\" class=\"sig-block")
              .append(last ? "" : " border-right").append("\">")
              .append("<div style=\"height:44px;\"></div>")
              .append("<div style=\"font-weight:700; color:#334155; border-top:1px solid #cbd5e1; padding-top:4px;\">")
              .append(esc(label)).append("</div></td>");
        }
        sb.append("</tr></table>");
        return sb.toString();
    }

    private String footerNote(String text) {
        return "<div class=\"footer-note\">" + esc(text) + "</div>";
    }

    private String computerGenerated(String text) {
        return "<div class=\"computer-generated\">" + esc(text) + "</div>";
    }

    private String watermarkHtml(String text, String cssClass) {
        if (text == null) return "";
        return "<div class=\"watermark " + cssClass + "\">" + esc(text) + "</div>";
    }

    private byte[] renderPdf(String title, String bodyHtml, String watermarkHtml) {
        return renderPdf(title, CSS, "<div class=\"divmain\">" + bodyHtml + "</div>", watermarkHtml);
    }

    /** Renders a full HTML page to PDF with an explicit stylesheet and outer wrapper. */
    private byte[] renderPdf(String title, String cssBlock, String outerHtml, String watermarkHtml) {
        String html = "<!doctype html><html><head><meta charset=\"UTF-8\"/><title>" + esc(title) + "</title>"
                + "<style>" + cssBlock + "</style></head><body>"
                + (watermarkHtml == null ? "" : watermarkHtml)
                + outerHtml
                + "</body></html>";
        try (ByteArrayOutputStream os = new ByteArrayOutputStream()) {
            // Parsed leniently via jsoup (regular HTML5, not strict XHTML) and handed to
            // openhtmltopdf as a W3C DOM — its own XML parser rejects HTML5 constructs
            // (bare &nbsp;, unclosed tags) that jsoup normalizes for us.
            Document jsoupDoc = Jsoup.parse(html);
            jsoupDoc.outputSettings().syntax(Document.OutputSettings.Syntax.xml).escapeMode(org.jsoup.nodes.Entities.EscapeMode.xhtml);
            org.w3c.dom.Document w3cDoc = new W3CDom().fromJsoup(jsoupDoc);

            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.useFastMode();
            builder.withW3cDocument(w3cDoc, null);
            builder.toStream(os);
            builder.run();
            return os.toByteArray();
        } catch (Exception e) {
            log.error("PDF print failed for {}", title, e);
            throw new IllegalStateException("PDF print failed", e);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Field-extraction helpers (unchanged behavior from the previous version)
    // ═══════════════════════════════════════════════════════════════════════

    private String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    /** Escapes a value and preserves stored line breaks as HTML <br/> (multi-line
     * addresses currently collapse to a run-on sentence on the PDF). */
    private String multiLine(String s) {
        if (s == null || s.isBlank()) return "";
        return esc(s).replace("\r\n", "<br/>").replace("\n", "<br/>");
    }

    /** Joins a stored address with its city/state/pincode line, skipping the region
     * when it is already part of the address text (avoids the duplicated
     * "..., Tamil Nadu, India, Chennai, Tamil Nadu, 600028" on printed headers). */
    private String mergeAddress(String addr, String cityLine) {
        if (cityLine == null || cityLine.isBlank()) return addr == null ? "" : addr;
        String a = (addr == null ? "" : addr).toLowerCase();
        for (String part : cityLine.split(",")) {
            String t = part.trim().toLowerCase();
            if (t.length() >= 4 && !t.isBlank() && a.contains(t)) return addr == null ? "" : addr;
        }
        return String.join(", ", nonEmpty(addr, cityLine));
    }

    private String str(Object v) {
        if (v == null) return "";
        String s = String.valueOf(v);
        return s.replace("null", "");
    }

    /** Prints stored dates ("yyyy-MM-dd", optionally with a time suffix) as "dd-MM-yyyy". */
    private String formatDate(Object v) {
        String s = str(v);
        if (s.isBlank()) return "";
        try {
            String datePart = s.length() > 10 ? s.substring(0, 10) : s;
            return java.time.LocalDate.parse(datePart)
                    .format(java.time.format.DateTimeFormatter.ofPattern("dd-MM-yyyy"));
        } catch (Exception e) {
            return s;
        }
    }

    private String num(Object v) {
        if (v == null) return "";
        try {
            double d = Double.parseDouble(String.valueOf(v));
            if (d == Math.floor(d) && !Double.isInfinite(d)) return String.valueOf((long) d);
            return String.valueOf(d);
        } catch (Exception e) {
            return String.valueOf(v);
        }
    }

    /** Indian-grouped, 2-decimal money formatting matching invoice.html ("45,000.00"). */
    private String money(Object v) {
        BigDecimal b = bd(v);
        java.text.DecimalFormat f = new java.text.DecimalFormat("#,##,##0.00");
        f.setDecimalFormatSymbols(java.text.DecimalFormatSymbols.getInstance(java.util.Locale.US));
        return f.format(b.setScale(2, RoundingMode.HALF_UP));
    }

    private boolean isEmpty(Object v) {
        return v == null || String.valueOf(v).isEmpty();
    }

    private String firstNonEmpty(String... vals) {
        for (String v : vals) {
            if (v != null && !v.isBlank() && !"null".equalsIgnoreCase(v)) return v;
        }
        return "";
    }

    private List<String> nonEmpty(String... vals) {
        List<String> out = new ArrayList<>();
        for (String v : vals) if (v != null && !v.isBlank()) out.add(v);
        return out;
    }

    private String firstOf(Map<String, Object> m, String... keys) {
        for (String k : keys) {
            Object v = m.get(k);
            if (v != null && !String.valueOf(v).isBlank()) return str(v);
        }
        return "";
    }

    private Object firstOfObj(Map<String, Object> m, String... keys) {
        for (String k : keys) {
            Object v = m.get(k);
            if (v != null) return v;
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private List<Object> lines(Map<String, Object> doc) {
        Object l = doc.get("lines");
        return l instanceof List ? (List<Object>) l : List.of();
    }

    @SuppressWarnings("unchecked")
    private List<?> safeList(Object obj) {
        return obj instanceof List ? (List<?>) obj : List.of();
    }

    private BigDecimal bd(Object v) {
        if (v == null) return BigDecimal.ZERO;
        try { return new BigDecimal(String.valueOf(v)); } catch (Exception e) { return BigDecimal.ZERO; }
    }

    private double numOrZeroInt(Object v) {
        if (v == null) return 0;
        try { return Double.parseDouble(String.valueOf(v)); } catch (Exception e) { return 0; }
    }

    private static final String[] ONES = {"", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
            "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"};
    private static final String[] TENS = {"", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"};

    /** Converts a rupee amount to words using the Indian numbering system (Lakh/Crore). */
    private String numberToWords(BigDecimal amount) {
        long n = amount == null ? 0 : amount.setScale(0, RoundingMode.HALF_UP).longValue();
        if (n == 0) return "Zero";
        if (n < 0) return "Minus " + numberToWords(BigDecimal.valueOf(-n));
        StringBuilder sb = new StringBuilder();
        long crore = n / 10000000; n %= 10000000;
        long lakh = n / 100000; n %= 100000;
        long thousand = n / 1000; n %= 1000;
        long hundred = n / 100; n %= 100;
        if (crore > 0) sb.append(twoDigit(crore)).append(" Crore ");
        if (lakh > 0) sb.append(twoDigit(lakh)).append(" Lakh ");
        if (thousand > 0) sb.append(twoDigit(thousand)).append(" Thousand ");
        if (hundred > 0) sb.append(ONES[(int) hundred]).append(" Hundred ");
        if (n > 0) {
            if (sb.length() > 0) sb.append("and ");
            sb.append(twoDigit(n));
        }
        return sb.toString().trim();
    }

    private String twoDigit(long n) {
        if (n < 20) return ONES[(int) n];
        return (TENS[(int) (n / 10)] + " " + ONES[(int) (n % 10)]).trim();
    }

    private String convertNumberToWords(double amount) {
        if (amount <= 0) return "Zero Only";
        return numberToWords(BigDecimal.valueOf(amount)) + " Only";
    }

    private String printedAt(String docNo, Integer copyNumber) {
        String text = docNo + "  •  Printed " +
                java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("dd-MMM-yyyy HH:mm"));
        if (copyNumber != null && copyNumber > 3) {
            text += "  •  COPY " + copyNumber;
        }
        return text;
    }

    // ── GST tax-invoice helpers (logo/QR header, date-time, tax breakdown) ──

    /** Renders arbitrary text as a small PNG QR code, returned as a base64 data URI
     * (so openhtmltopdf can embed it without a temp file). Returns null on failure. */
    private String qrDataUri(String content) {
        if (content == null || content.isBlank()) return null;
        try {
            var matrix = new MultiFormatWriter().encode(content, BarcodeFormat.QR_CODE, 220, 220);
            BufferedImage img = MatrixToImageWriter.toBufferedImage(matrix);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ImageIO.write(img, "png", baos);
            return "data:image/png;base64," + Base64.getEncoder().encodeToString(baos.toByteArray());
        } catch (Exception e) {
            log.warn("Could not build invoice QR code: {}", e.getMessage());
            return null;
        }
    }

    /** GST-style invoice-summary QR content: supplier + buyer GSTIN, invoice number,
     * date, taxable value, total tax and grand total — the fields the GST QR on an
     * ordinary (non-e-invoice) tax invoice must carry. When a real E-Invoice IRN QR
     * payload has been stored it is used verbatim instead. */
    private String invoiceQrContent(Map<String, Object> doc, String supplierGstin,
                                    BigDecimal taxable, BigDecimal tax, BigDecimal grand) {
        String content = str(doc.get("qrPayload"));
        if (!content.isBlank()) return content;
        String date = str(doc.get("date"));
        if (date.length() > 10) date = date.substring(0, 10);
        String buyerGstin = firstNonEmpty(str(doc.get("customerGstin")), str(doc.get("gstin")));
        return "{\"inv\":\"" + jsonEsc(str(doc.get("docNo")))
                + "\",\"gstin\":\"" + jsonEsc(supplierGstin)
                + "\",\"buyerGstin\":\"" + jsonEsc(buyerGstin)
                + "\",\"dt\":\"" + jsonEsc(date)
                + "\",\"taxable\":" + bd(taxable)
                + ",\"tax\":" + bd(tax)
                + ",\"total\":" + bd(grand) + "}";
    }

    private String jsonEsc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    /** Formats an ISO instant/dateTime as "dd-MM-yyyy -- hh:mm AM/PM" (time optional). */
    private String formatDateTime(Object v, boolean includeTime) {
        String s = str(v).trim();
        if (s.isBlank()) return "";
        String datePart = s.length() > 10 ? s.substring(0, 10) : s;
        String out = formatDate(datePart);
        if (!includeTime || s.length() < 19) return out;
        try {
            java.time.LocalDateTime ldt = java.time.LocalDateTime.parse(s.substring(0, 19));
            out += " -- " + ldt.format(java.time.format.DateTimeFormatter.ofPattern("hh:mm a"));
        } catch (Exception e) {
            // ignore — date-only fallback is fine
        }
        return out;
    }

    /** Parses a GST rate percent from a line map: accepts a "GST 18%"/"GST18" taxCode
     * string or a numeric tax fraction (0.18), falling back to tax/supply derived. */
    private int taxRatePercent(Map<String, Object> line) {
        Object code = line.get("taxCode");
        if (code != null) {
            String s = String.valueOf(code).replaceAll("[^0-9]", "");
            if (!s.isBlank()) {
                try { return Integer.parseInt(s); } catch (NumberFormatException ignored) {}
            }
        }
        BigDecimal taxable = bd(line.get("netAmount")).subtract(bd(line.get("taxAmount")));
        BigDecimal taxAmt = bd(line.get("taxAmount"));
        if (taxAmt.signum() != 0 && taxable.signum() != 0) {
            return taxAmt.multiply(BigDecimal.valueOf(100)).divide(taxable, 0, RoundingMode.HALF_UP).intValue();
        }
        return 0;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Delivery Challan — the document type this template was itself modeled on.
    // ═══════════════════════════════════════════════════════════════════════

    public byte[] deliveryChallan(Map<String, Object> doc, String type) {
        return deliveryChallan(doc, type, 1);
    }

    /**
     * DOCUMENT 02 v2.0 §08.3 — Delivery Challan print. A non-POSTED document prints with a
     * diagonal "DRAFT — NOT VALID FOR DISPATCH" watermark (BR-INV-DC-PRINT-3), and any print
     * after the first shows "COPY N" (FR-INV-DC-PRINT-1).
     */
    public byte[] deliveryChallan(Map<String, Object> doc, String type, int copyNumber) {
        StringBuilder body = new StringBuilder();
        body.append(letterhead());
        body.append(titleBarHtml(dcTitle(type)));
        body.append(copyLabelHtml(copyNumber));

        List<String[]> meta = new ArrayList<>();
        meta.add(new String[]{"DC No.", str(doc.get("docNo"))});
        meta.add(new String[]{"DC Date", formatDate(doc.get("docDate"))});
        meta.add(new String[]{"Ref PO No.", firstNonEmpty(str(doc.get("referenceNo")), str(doc.get("jobOrderNo")), str(doc.get("salesOrderNo")), str(doc.get("transferRequestNo")), str(doc.get("linkedDocumentNo")))});
        meta.add(new String[]{"Ref PO Date", formatDate(doc.get("referenceDate"))});
        meta.add(new String[]{"Mode of Transport", str(doc.getOrDefault("modeOfTransport", "Road"))});
        meta.add(new String[]{"Vehicle No.", str(doc.get("vehicleNo"))});
        meta.add(new String[]{"Transporter", str(doc.get("transporter"))});
        meta.add(new String[]{"LR / Docket No.", str(doc.get("lrNo"))});
        meta.add(new String[]{"e-Way Bill No.", firstNonEmpty(str(doc.get("ewayBillNo")), str(doc.get("ewayBillReference")))});

        String partyHeading = "jo-dc".equals(type) ? "Job Worker / Vendor:" : "transfer-dc".equals(type) ? "Transfer To (Destination):" : "Consignee / Customer:";
        List<String> partyLines = new ArrayList<>();
        partyLines.add(firstNonEmpty(str(doc.get("party")), str(doc.get("customer"))));
        String address = firstNonEmpty(str(doc.get("billingAddress")), str(doc.get("shippingAddress")), str(doc.get("deliveryAddress")));
        if (!address.isBlank()) partyLines.add(address);
        if (!isEmpty(doc.get("gstin"))) partyLines.add("GSTIN: " + str(doc.get("gstin")));

        String purposeText = "jo-dc".equals(type) ? str(doc.getOrDefault("challanPurpose", "Job Work"))
                : "transfer-dc".equals(type) ? "Stock Transfer (" + str(doc.getOrDefault("transferType", "Internal")) + ")"
                : "sales-dc".equals(type) ? "Dispatch against Sales Order"
                : str(doc.getOrDefault("dcAgainst", "Dispatch / Sale"));
        List<String> locLines = List.of(str(doc.get("sourceLocation")), "Purpose: " + purposeText);

        body.append("<table class=\"details-table\"><tr>");
        body.append("<td style=\"width:52%;\" class=\"border-right\">");
        body.append("<div class=\"meta-label\">").append(esc(partyHeading)).append("</div>");
        body.append("<div style=\"font-size:9.5pt; font-weight:bold; margin-top:2px;\">").append(esc(partyLines.get(0))).append("</div>");
        for (int i = 1; i < partyLines.size(); i++) {
            body.append("<div style=\"margin-top:3px; color:#334155;\">").append(esc(partyLines.get(i))).append("</div>");
        }
        body.append("</td><td style=\"width:48%; padding:0;\">");
        body.append(metaGrid(meta));
        body.append("</td></tr></table>");

        body.append(sectionBarHtml("From Location: " + str(doc.get("sourceLocation")) + "  —  " + purposeText));

        List<String> headers = List.of("Sl.", "Item Code", "Description", "HSN", "Batch", "UOM", "Qty", "Rate", "Amount");
        List<List<String>> rows = new ArrayList<>();
        int sl = 0;
        double totalQty = 0, totalAmt = 0;
        for (Object o : lines(doc)) {
            @SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) o;
            sl++;
            double q = line.get("qty") != null ? Double.parseDouble(String.valueOf(line.get("qty"))) : 0;
            double r = line.get("rate") != null ? Double.parseDouble(String.valueOf(line.get("rate"))) : 0;
            double a = line.get("amount") != null ? Double.parseDouble(String.valueOf(line.get("amount"))) : q * r;
            totalQty += q; totalAmt += a;
            rows.add(List.of(String.valueOf(sl), str(line.get("itemCode")), str(line.get("itemDesc")),
                    str(line.get("hsnCode")), str(line.get("batchNo")), str(line.get("uom")),
                    num(q), r > 0 ? String.format("%.2f", r) : "-", a > 0 ? String.format("%.2f", a) : "-"));
        }
        body.append(itemsTable(headers, rows, new boolean[]{false, false, false, false, false, false, true, true, true},
                new int[]{5, 14, 25, 10, 10, 8, 9, 9, 10},
                "TOTAL", List.of(num(totalQty), "-", totalAmt > 0 ? String.format("%.2f", totalAmt) : "-")));

        double docQty = doc.get("qty") != null ? Double.parseDouble(String.valueOf(doc.get("qty"))) : totalQty;
        String note = "jo-dc".equals(type)
                ? "Note: Goods sent for Outside Processing / Job Work - NOT FOR SALE / RETURNABLE. Received goods in good condition subject to verification."
                : "transfer-dc".equals(type)
                ? "Note: Goods transferred internally between company locations - STOCK TRANSFER - NOT FOR SALE."
                : "Note: Goods delivered against DC - Invoice to follow. Received goods in good condition subject to verification.";
        body.append(termsBox(null, List.of("Total Quantity in Words: " + convertNumberToWords(docQty), note)));

        CompanyInfo ci = companyInfos.findById(1L).orElse(null);
        String ourGstin = ci != null ? firstNonEmpty(ci.getGstin(), ci.getGstNumber()) : "";
        String ourPan = ci != null ? firstNonEmpty(ci.getPan(), ci.getPanNumber()) : "";
        String partyGstin = str(doc.get("gstin"));
        String taxInfo = "<b>OUR GSTIN:</b> " + esc(ourGstin.isBlank() ? "-" : ourGstin)
                + "<br/><b>OUR PAN:</b> " + esc(ourPan.isBlank() ? "-" : ourPan)
                + "<br/><b>PARTY'S GSTIN:</b> " + esc(partyGstin.isBlank() ? "-" : partyGstin);
        String prepUser = str(doc.getOrDefault("preparedBy", doc.getOrDefault("createdBy", "User")));
        body.append(sigContainer(taxInfo, "Prepared By (" + prepUser + ")", "Checked / Approved By", "Receiver's Signature & Stamp"));
        body.append(footerNote(printedAt(str(doc.get("docNo")), copyNumber)));
        body.append(computerGenerated("This is a Computer Generated " + dcTitle(type)));

        String wm = Boolean.TRUE.equals(doc.get("invoiced")) ? watermarkHtml("INVOICED — TAX INVOICE ISSUED", "watermark-invoiced") : null;

        return renderPdf(dcTitle(type), body.toString(), wm);
    }

    /** DOCUMENT 02 v2.0 §08.3 — the printed title changes automatically by DC sub-type. */
    private String dcTitle(String type) {
        return switch (String.valueOf(type)) {
            case "jo-dc" -> "JOB WORK DELIVERY CHALLAN";
            case "return-dc" -> "RETURN DELIVERY CHALLAN";
            case "transfer-dc" -> "STOCK TRANSFER CHALLAN";
            default -> "DELIVERY CHALLAN";
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // GRN / Store Receipt
    // ═══════════════════════════════════════════════════════════════════════

    public byte[] grn(Map<String, Object> doc) {
        StringBuilder body = new StringBuilder();
        body.append(letterhead());
        body.append(titleBarHtml("GRN / STORE RECEIPT"));
        body.append(metaGridRow2("Doc No", str(doc.get("docNo")), "Date", formatDate(doc.get("date"))));

        List<String[]> fields = new ArrayList<>();
        fields.add(new String[]{"Party", str(doc.get("party"))});
        fields.add(new String[]{"Source Type", str(doc.get("sourceType"))});
        fields.add(new String[]{"Source Document", str(doc.get("sourceDocumentNo"))});
        fields.add(new String[]{"Inspection Ref", str(doc.get("inspectionRef"))});
        fields.add(new String[]{"Status", str(doc.get("status"))});
        fields.add(new String[]{"Created By", str(doc.get("createdBy"))});
        fields.add(new String[]{"Created At", str(doc.get("createdAt"))});
        body.append(fieldGrid(fields));
        if (!isEmpty(doc.get("remarks"))) body.append(termsBox(null, List.of("Remarks: " + str(doc.get("remarks")))));

        body.append(sectionBarHtml("Items"));
        List<String> headers = List.of("#", "Item Code", "Item Description", "Accepted Qty", "Rate", "Batch No", "Heat No", "Location");
        List<List<String>> rows = new ArrayList<>();
        int n = 0;
        for (Object o : lines(doc)) {
            @SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) o;
            n++;
            rows.add(List.of(String.valueOf(n), str(line.get("itemCode")), str(line.get("itemDesc")),
                    num(line.get("qty")), num(line.get("rate")), str(line.get("batchNo")), str(line.get("heatNo")), str(line.get("location"))));
        }
        body.append(itemsTable(headers, rows, new boolean[]{false, false, false, true, true, false, false, false},
                new int[]{3, 14, 34, 14, 14, 12, 12, 14},
                "TOTAL QTY", List.of(num(doc.get("qty")))));

        body.append(sigContainer(null, "Received By", "Authorized Signatory"));
        body.append(computerGenerated("This is a Computer Generated GRN / Store Receipt"));
        return renderPdf("GRN / Store Receipt", body.toString(), null);
    }

    private String metaGridRow2(String l1, String v1, String l2, String v2) {
        return "<table class=\"details-table\"><tr>"
                + "<td style=\"width:15%;\" class=\"border-right meta-label\">" + esc(l1) + "</td>"
                + "<td style=\"width:35%;\" class=\"border-right highlight-text\">" + esc(v1) + "</td>"
                + "<td style=\"width:15%;\" class=\"border-right meta-label\">" + esc(l2) + "</td>"
                + "<td style=\"width:35%;\" class=\"highlight-text\">" + esc(v2) + "</td>"
                + "</tr></table>";
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Work Order — FRS §18
    // ═══════════════════════════════════════════════════════════════════════

    public byte[] workOrder(Map<String, Object> doc) {
        StringBuilder body = new StringBuilder();
        body.append(letterhead());
        body.append(titleBarHtml("WORK ORDER"));
        body.append(metaGrid(List.of(
                new String[]{"WO No", str(doc.get("woNumber"))},
                new String[]{"Status", str(doc.get("status"))},
                new String[]{"Date", str(doc.get("docDate"))}
        )));

        List<String[]> fields = new ArrayList<>();
        fields.add(new String[]{"Sales Order No", str(doc.get("salesOrderNo"))});
        fields.add(new String[]{"SO Line No", str(doc.get("salesOrderLineNo"))});
        fields.add(new String[]{"Customer", str(doc.get("customerCode"))});
        fields.add(new String[]{"Item Code", str(doc.get("itemCode"))});
        fields.add(new String[]{"Item Description", str(doc.get("itemDescription"))});
        fields.add(new String[]{"Drawing No", str(doc.get("drawingNumber"))});
        fields.add(new String[]{"Drawing Rev", str(doc.get("drawingRev"))});
        fields.add(new String[]{"Production Qty", num(doc.get("productionQty"))});
        fields.add(new String[]{"Completed Qty", num(doc.get("completedQty"))});
        fields.add(new String[]{"Rejected Qty", num(doc.get("rejectedQty"))});
        fields.add(new String[]{"Scrap Qty", num(doc.get("scrapQty"))});
        fields.add(new String[]{"UOM", str(doc.get("uom"))});
        fields.add(new String[]{"Planned Start", str(doc.get("plannedStartDate"))});
        fields.add(new String[]{"Planned End", str(doc.get("plannedEndDate"))});
        fields.add(new String[]{"Due Date", str(doc.get("dueDate"))});
        fields.add(new String[]{"Promised Delivery", str(doc.get("promisedDeliveryDate"))});
        fields.add(new String[]{"BOM Reference", str(doc.get("bomId"))});
        fields.add(new String[]{"BOM Revision", str(doc.get("bomRevision"))});
        fields.add(new String[]{"Route Reference", str(doc.get("routeId"))});
        fields.add(new String[]{"Route Revision", str(doc.get("routeRevision"))});
        fields.add(new String[]{"Priority", str(doc.get("priority"))});
        fields.add(new String[]{"Batch/Lot No", str(doc.get("batchLotNo"))});
        fields.add(new String[]{"Released By", str(doc.get("releasedBy"))});
        fields.add(new String[]{"Released Qty", num(doc.get("releasedQty"))});
        body.append(fieldGrid(fields));
        if (!isEmpty(doc.get("remarks"))) body.append(termsBox(null, List.of("Remarks: " + str(doc.get("remarks")))));

        List<?> materialLines = safeList(doc.get("materialLines"));
        if (!materialLines.isEmpty()) {
            body.append(sectionBarHtml("Material Lines"));
            List<String> headers = List.of("#", "Component Code", "Description", "UOM", "Required Qty", "Issued Qty");
            List<List<String>> rows = new ArrayList<>();
            int n = 0;
            for (Object o : materialLines) {
                @SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) o;
                n++;
                rows.add(List.of(String.valueOf(n), str(line.get("componentItemCode")), str(line.get("description")),
                        str(line.get("uom")), num(line.get("requiredQuantity")), num(line.get("issuedQuantity"))));
            }
            body.append(itemsTable(headers, rows, new boolean[]{false, false, false, false, true, true},
                    new int[]{4, 15, 30, 10, 12, 12}, null, null));
        }

        List<?> processLines = safeList(doc.get("lines"));
        if (!processLines.isEmpty()) {
            body.append(sectionBarHtml("Process Lines"));
            List<String> headers = List.of("#", "Seq", "Operation", "Work Centre", "Setup Time", "Cycle Time", "Status");
            List<List<String>> rows = new ArrayList<>();
            int n = 0;
            for (Object o : processLines) {
                @SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) o;
                n++;
                rows.add(List.of(String.valueOf(n), str(line.get("operationSequence")), str(line.get("operationCode")),
                        str(line.get("workCenterCode")), num(line.get("setupTimePlanned")), num(line.get("cycleTimePlanned")), str(line.get("status"))));
            }
            body.append(itemsTable(headers, rows, new boolean[]{false, false, false, false, true, true, false},
                    new int[]{4, 8, 20, 16, 12, 12, 12}, null, null));
        }

        body.append(sigContainer(null, "Prepared By", "Released By", "Production Supervisor"));
        body.append(footerNote("Printed: " + java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
                + "  |  Version: " + str(doc.get("version"))));
        body.append(computerGenerated("This is a Computer Generated Work Order"));
        return renderPdf("Work Order", body.toString(), null);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Purchase Order — supplier-facing, HSN/tax breakdown, amount in words.
    // ═══════════════════════════════════════════════════════════════════════

    public byte[] purchaseOrder(Map<String, Object> doc) {
        return purchaseOrder(doc, 1);
    }

    public byte[] purchaseOrder(Map<String, Object> doc, int copyNumber) {
        String status = str(doc.get("status"));
        StringBuilder body = new StringBuilder();
        body.append(letterhead());
        body.append(titleBarHtml("PURCHASE ORDER"));
        body.append(copyLabelHtml(copyNumber));

        int revision = (int) numOrZeroInt(doc.get("revisionNumber"));
        List<String[]> meta = new ArrayList<>();
        meta.add(new String[]{"PO No.", str(doc.get("docNo"))});
        meta.add(new String[]{"PO Date", formatDate(doc.get("date"))});
        meta.add(new String[]{"Status", status});
        if (revision > 1) {
            meta.add(new String[]{"Amendment No.", (revision - 1) + " — Rev. " + revision});
            String amendedAt = str(doc.get("lastAmendedAt"));
            if (!amendedAt.isBlank()) meta.add(new String[]{"Revised", amendedAt.substring(0, Math.min(10, amendedAt.length()))});
        }

        List<String> vendorLines = new ArrayList<>();
        vendorLines.add(str(doc.get("supplier")));
        if (!isEmpty(doc.get("supplierCode"))) vendorLines.add("Code: " + str(doc.get("supplierCode")));
        if (!isEmpty(doc.get("billingAddress"))) vendorLines.add(str(doc.get("billingAddress")));
        if (!isEmpty(doc.get("contactPerson"))) vendorLines.add("Contact: " + str(doc.get("contactPerson")));
        if (!isEmpty(doc.get("phone"))) vendorLines.add("Phone: " + str(doc.get("phone")));
        if (!isEmpty(doc.get("email"))) vendorLines.add("Email: " + str(doc.get("email")));

        List<String> deliverLines = new ArrayList<>();
        String shipTo = firstNonEmpty(str(doc.get("shippingAddress")), str(doc.get("deliveryLocation")));
        deliverLines.add(isEmpty(shipTo) ? "-" : shipTo);
        if (!isEmpty(doc.get("expectedDeliveryDate"))) deliverLines.add("Expected Delivery: " + str(doc.get("expectedDeliveryDate")));
        if (!isEmpty(doc.get("deliveryTerms"))) deliverLines.add("Delivery Terms: " + str(doc.get("deliveryTerms")));

        body.append("<table class=\"details-table\"><tr>");
        body.append("<td style=\"width:52%;\" class=\"border-right\">").append(twoBoxLines("VENDOR", vendorLines)).append("</td>");
        body.append("<td style=\"width:48%; padding:0;\">").append(metaGrid(meta)).append("</td>");
        body.append("</tr></table>");
        body.append(sectionBarHtml("DELIVER TO: " + (deliverLines.isEmpty() ? "-" : deliverLines.get(0))));

        List<String[]> refs = new ArrayList<>();
        refs.add(new String[]{"Buyer", str(doc.get("buyer"))});
        refs.add(new String[]{"Department", str(doc.get("department"))});
        refs.add(new String[]{"Quotation Ref", str(doc.get("quotationNumber"))});
        refs.add(new String[]{"PR Ref", str(doc.get("purchaseRequestNumber"))});
        refs.add(new String[]{"Payment Terms", str(doc.get("paymentTerms"))});
        refs.add(new String[]{"Currency", str(doc.get("currency"))});
        refs.add(new String[]{"Priority", str(doc.get("priority"))});
        refs.add(new String[]{"Freight Terms", str(doc.get("freightTerms"))});
        body.append(fieldGrid(refs));
        if (!isEmpty(doc.get("remarks"))) body.append(termsBox(null, List.of("Remarks: " + str(doc.get("remarks")))));

        body.append(sectionBarHtml("Items"));
        List<String> headers = List.of("#", "Item Code", "Description", "HSN", "Qty", "UOM", "Rate", "Disc %", "Tax %", "Amount");
        List<List<String>> rows = new ArrayList<>();
        BigDecimal taxableTotal = BigDecimal.ZERO, taxTotal = BigDecimal.ZERO, grandTotal = BigDecimal.ZERO;
        int n = 0;
        for (Object o : lines(doc)) {
            @SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) o;
            n++;
            BigDecimal qty = bd(line.get("orderQty") != null ? line.get("orderQty") : line.get("qty"));
            BigDecimal rate = bd(line.get("unitPrice"));
            BigDecimal discPct = bd(line.get("discount"));
            BigDecimal taxPct = bd(line.get("tax"));
            BigDecimal gross = qty.multiply(rate);
            BigDecimal discAmt = gross.multiply(discPct).divide(BigDecimal.valueOf(100), 4, RoundingMode.HALF_UP);
            BigDecimal taxable = gross.subtract(discAmt);
            BigDecimal taxAmt = taxable.multiply(taxPct).divide(BigDecimal.valueOf(100), 4, RoundingMode.HALF_UP);
            BigDecimal net = taxable.add(taxAmt);
            taxableTotal = taxableTotal.add(taxable); taxTotal = taxTotal.add(taxAmt); grandTotal = grandTotal.add(net);

            String itemCode = str(line.get("itemCode"));
            String hsn = items.findByCode(itemCode).map(ItemMaster::getHsnCode).filter(s -> !s.isBlank()).orElse("");
            String desc = firstNonEmpty(str(line.get("itemName")), str(line.get("specification")));
            rows.add(List.of(String.valueOf(n), itemCode, desc, hsn, num(qty), str(line.get("uom")),
                    num(rate), num(discPct), num(taxPct), num(net)));
        }
        body.append(itemsTable(headers, rows, new boolean[]{false, false, false, false, true, false, true, true, true, true},
                new int[]{4, 11, 22, 9, 8, 7, 9, 9, 8, 13}, null, null));
        body.append(poTotalsHtml(taxableTotal, taxTotal, grandTotal));

        body.append(sigContainer(null, "Prepared By", "Authorized Signatory"));
        body.append(footerNote(printedAt(str(doc.get("docNo")), copyNumber)));
        body.append(computerGenerated("This is a Computer Generated Purchase Order"));

        boolean cancelled = "CANCELLED".equalsIgnoreCase(status);
        String wm = cancelled ? watermarkHtml("CANCELLED", "watermark-cancelled") : null;
        return renderPdf("Purchase Order", body.toString(), wm);
    }

    private String twoBoxLines(String heading, List<String> lines) {
        StringBuilder sb = new StringBuilder("<div class=\"box-heading\">").append(esc(heading)).append("</div>");
        for (int i = 0; i < lines.size(); i++) {
            sb.append("<div style=\"").append(i == 0 ? "font-weight:700;font-size:10pt;" : "color:#334155;margin-top:2px;font-size:8pt;")
              .append("\">").append(esc(lines.get(i))).append("</div>");
        }
        return sb.toString();
    }

    private String poTotalsHtml(BigDecimal taxable, BigDecimal tax, BigDecimal grand) {
        StringBuilder sb = new StringBuilder();
        sb.append("<table style=\"width:45%; margin-left:55%;\">");
        sb.append(totalRowHtml("Taxable Value", taxable, false));
        sb.append(totalRowHtml("Total Tax", tax, false));
        sb.append(totalRowHtml("Grand Total", grand, true));
        sb.append("</table>");
        sb.append("<div style=\"padding:6px 8px; font-style:italic; color:#64748b; font-size:8pt;\">Amount in words: ")
          .append(esc(numberToWords(grand))).append(" Rupees Only</div>");
        return sb.toString();
    }

    private String totalRowHtml(String label, BigDecimal value, boolean bold) {
        String weight = bold ? "font-weight:700;" : "";
        String bg = bold ? "background-color:#f1f5f9;" : "";
        return "<tr><td style=\"" + weight + bg + " padding:4px; color:" + (bold ? "#0f172a" : "#64748b") + ";\">" + esc(label) + "</td>"
                + "<td style=\"" + weight + bg + " padding:4px; text-align:right;\">Rs. " + esc(num(value)) + "</td></tr>";
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Generic Sales Document (Quotation / SO / DC / etc. that don't have a
    // dedicated tax-invoice layout)
    // ═══════════════════════════════════════════════════════════════════════

    public byte[] salesDoc(Map<String, Object> doc, String type) {
        StringBuilder body = new StringBuilder();
        body.append(letterhead());
        String title = type.replace('-', ' ').toUpperCase();
        body.append(titleBarHtml(title));
        body.append(metaGridRow2("Doc No", str(doc.get("docNo")), "Date", formatDate(doc.get("date"))));

        List<String[]> fields = new ArrayList<>();
        fields.add(new String[]{"Customer", str(doc.get("customer"))});
        fields.add(new String[]{"Customer Code", str(doc.get("customerCode"))});
        fields.add(new String[]{"Doc Date", formatDate(doc.get("docDate"))});
        fields.add(new String[]{"Status", str(doc.get("status"))});
        fields.add(new String[]{"SO Reference", str(doc.get("salesOrderNumber"))});
        fields.add(new String[]{"PI Number", str(doc.get("piNumber"))});
        fields.add(new String[]{"DC Number", str(doc.get("salesDcNumber"))});
        fields.add(new String[]{"Customer PO", str(doc.get("customerPoNumber"))});
        fields.add(new String[]{"Currency", str(doc.get("currency"))});
        fields.add(new String[]{"Payment Terms", str(doc.get("paymentTerms"))});
        fields.add(new String[]{"Total Qty", num(doc.get("qty"))});
        fields.add(new String[]{"Total Amount", num(doc.get("totalAmount"))});
        fields.add(new String[]{"Tax Amount", num(doc.get("taxAmount"))});
        fields.add(new String[]{"E-Way Bill Ref", str(doc.get("ewayBillReference"))});
        if (!isEmpty(doc.get("billingAddress"))) fields.add(new String[]{"Billing Address", str(doc.get("billingAddress"))});
        if (!isEmpty(doc.get("shippingAddress"))) fields.add(new String[]{"Shipping Address", str(doc.get("shippingAddress"))});
        if (!isEmpty(doc.get("transportDetails"))) fields.add(new String[]{"Transport Details", str(doc.get("transportDetails"))});
        body.append(fieldGrid(fields));
        if (!isEmpty(doc.get("remarks"))) body.append(termsBox(null, List.of("Remarks: " + str(doc.get("remarks")))));

        body.append(sectionBarHtml("Items"));
        List<String> headers = List.of("#", "Item Code", "Description", "UOM", "Qty", "Rate", "Tax", "Amount");
        List<List<String>> rows = new ArrayList<>();
        int n = 0;
        for (Object o : lines(doc)) {
            @SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) o;
            n++;
            rows.add(List.of(String.valueOf(n), str(line.get("itemCode")), str(line.get("description")), str(line.get("uom")),
                    num(line.get("billedQty")), num(line.get("unitPrice")), str(line.get("taxCode")), num(line.get("netAmount"))));
        }
        body.append(itemsTable(headers, rows, new boolean[]{false, false, false, false, true, true, false, true},
                new int[]{4, 14, 28, 10, 10, 10, 10, 14},
                "TOTAL", List.of(num(doc.get("totalAmount")))));

        body.append(sigContainer(null, "Received By", "Authorized Signatory"));
        body.append(computerGenerated("This is a Computer Generated " + title));
        return renderPdf(title, body.toString(), null);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Sales Invoice — dedicated GST tax-invoice template (client-supplied
    // invoice.html): logo + company info + QR header, dark banner, invoice-meta
    // and transport grid, IRN/e-way bill block, Billed-To/Shipped-To panels,
    // CGST/SGST or IGST breakdown with round-off and amount in words, bank + terms,
    // and signature strip. All other document types keep the shared template.
    // ═══════════════════════════════════════════════════════════════════════

    public byte[] salesInvoice(Map<String, Object> doc) {
        return salesInvoice(doc, 1);
    }

    public byte[] salesInvoice(Map<String, Object> doc, int copyNumber) {
        return renderInvoice(doc, copyNumber, false);
    }

    /** Proforma Invoice — same GST layout as the Tax Invoice but titled
     * PROFORMA INVOICE, with PI-specific meta (validity / expected delivery /
     * sales person), no IRN/e-way bill block and no header QR code, and line
     * quantities read from the qty field instead of billedQty. */
    public byte[] proformaInvoice(Map<String, Object> doc) {
        return proformaInvoice(doc, 1);
    }

    public byte[] proformaInvoice(Map<String, Object> doc, int copyNumber) {
        return renderInvoice(doc, copyNumber, true);
    }

    private byte[] renderInvoice(Map<String, Object> doc, int copyNumber, boolean proforma) {
        CompanyInfo ci = companyInfos.findById(1L).orElse(null);

        // ---- Compute totals + per-rate tax breakdown up front so the header
        //      QR code and the summary block can both use them. ----
        BigDecimal taxableTotal = BigDecimal.ZERO, taxTotal = BigDecimal.ZERO, grandTotal = BigDecimal.ZERO;
        java.util.TreeMap<Integer, BigDecimal[]> byRate = new java.util.TreeMap<>(); // rate% -> [taxable, tax]
        for (Object o : lines(doc)) {
            @SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) o;
            BigDecimal qty = proforma ? bd(line.get("qty")) : bd(line.get("billedQty"));
            BigDecimal rate = bd(line.get("unitPrice"));
            BigDecimal taxAmt = bd(line.get("taxAmount"));
            BigDecimal net = line.get("netAmount") != null ? bd(line.get("netAmount")) : qty.multiply(rate).add(taxAmt);
            BigDecimal taxable = net.subtract(taxAmt);
            taxableTotal = taxableTotal.add(taxable); taxTotal = taxTotal.add(taxAmt); grandTotal = grandTotal.add(net);
            int pct = taxRatePercent(line);
            byRate.computeIfAbsent(pct, k -> new BigDecimal[]{BigDecimal.ZERO, BigDecimal.ZERO})[0] = byRate.get(pct)[0].add(taxable);
            byRate.get(pct)[1] = byRate.get(pct)[1].add(taxAmt);
        }
        BigDecimal roundedGrand = grandTotal.setScale(0, RoundingMode.HALF_UP);
        BigDecimal roundOff = roundedGrand.subtract(grandTotal);

        StringBuilder body = new StringBuilder();
        body.append(invoiceHeader(doc, ci, taxableTotal, taxTotal, grandTotal, proforma));
        body.append("<div class=\"banner-title\">").append(proforma ? "PROFORMA INVOICE" : "TAX INVOICE").append("</div>");
        if (copyNumber > 1) body.append(copyLabelHtml(copyNumber));

        // 3. Invoice meta & transportation details
        body.append("<table class=\"border-bottom\"><tr>");
        List<String> metaLeft = new ArrayList<>();
        metaLeft.add(invoiceKvRow(proforma ? "PI No" : "Invoice No", str(doc.get("docNo")), true));
        metaLeft.add(invoiceKvRow(proforma ? "PI Date" : "Invoice Date", formatDate(doc.get("date")), false));
        if (proforma) {
            metaLeft.add(invoiceKvRow("Ref. SO", str(doc.get("salesOrderNumber")), false));
            metaLeft.add(invoiceKvRow("Customer Code", str(doc.get("customerCode")), false));
        } else {
            metaLeft.add(invoiceKvRow("DC No", firstNonEmpty(str(doc.get("dcNo")), str(doc.get("salesDcNumber"))), false));
            metaLeft.add(invoiceKvRow("DC Date", formatDate(doc.get("dcDate")), false));
            metaLeft.add(invoiceKvRow("Customer Code", str(doc.get("customerCode")), false));
        }
        body.append("<td style=\"width:50%;\" class=\"border-right\">").append(invoiceKvTable(metaLeft)).append("</td>");
        List<String> metaRight = new ArrayList<>();
        if (proforma) {
            metaRight.add(invoiceKvRow("Validity Date", formatDate(doc.get("validityDate")), false));
            metaRight.add(invoiceKvRow("Expected Delivery", formatDate(doc.get("expectedDeliveryDate")), false));
            metaRight.add(invoiceKvRow("Sales Person", str(doc.get("salesPerson")), false));
            metaRight.add(invoiceKvRow("Payment Terms", str(doc.get("paymentTerms")), false));
        } else {
            metaRight.add(invoiceKvRow("Transport Mode", str(doc.get("transportDetails")), false));
            metaRight.add(invoiceKvRow("Vehicle Number", firstNonEmpty(str(doc.get("vehicleNo")), str(doc.get("vehicleNumber"))), false));
            metaRight.add(invoiceKvRow("Date & Time of Supply",
                    formatDateTime(doc.get("dateTimeOfSupply") != null ? doc.get("dateTimeOfSupply") : doc.get("date"), doc.get("dateTimeOfSupply") != null), false));
            metaRight.add(invoiceKvRow("Place of Supply", placeOfSupplyDisplay(doc), false));
            metaRight.add(invoiceKvRow("Payment Terms", str(doc.get("paymentTerms")), false));
        }
        body.append("<td style=\"width:50%;\">").append(invoiceKvTable(metaRight)).append("</td>");
        body.append("</tr></table>");

        // 4. E-Invoice / IRN & e-way bill block (only when data exists)
        String irn = str(doc.get("irnNumber"));
        String eway = firstNonEmpty(str(doc.get("ewayBillNo")), str(doc.get("ewayBillReference")));
        if (!proforma && (!irn.isBlank() || !eway.isBlank())) {
            body.append("<table class=\"border-bottom accent-bg\"><tr><td style=\"padding:3px 6px;\">");
            List<String> irnRows = new ArrayList<>();
            irnRows.add(invoiceWideRow("IRN No:", irn));
            String ack = firstNonEmpty(str(doc.get("irnAckNo")), ""),
                   ackDate = formatDate(doc.get("irnAckDate"));
            if (!ack.isBlank() || !ackDate.isBlank()) {
                irnRows.add(invoiceWideRow("Ack No & Date:", (ack.isBlank() ? "" : ack) + (!ack.isBlank() && !ackDate.isBlank() ? " &nbsp;|&nbsp; " : "") + ackDate, false));
            }
            irnRows.add(invoiceWideRow("E-Way Bill No:", eway));
            body.append(invoiceKvTable(irnRows));
            body.append("</td></tr></table>");
        }

        // 5. Billed To (Buyer) / Shipped To (Consignee)
        body.append("<table class=\"border-bottom\"><tr class=\"accent-bg\">");
        body.append("<th style=\"width:50%;\" class=\"border-right text-left bold\">BILLED TO (BUYER)</th>");
        body.append("<th style=\"width:50%;\" class=\"text-left bold\">SHIPPED TO (CONSIGNEE)</th></tr><tr>");
        body.append("<td style=\"width:50%;\" class=\"border-right\">").append(invoiceKvTable(partyKvRows(doc, true, proforma))).append("</td>");
        body.append("<td style=\"width:50%;\">").append(invoiceKvTable(partyKvRows(doc, false, proforma))).append("</td>");
        body.append("</tr></table>");

        // 6. Items table
        // Column grid mirrors the client-supplied invoice.html template.
        body.append("<table class=\"items-table\"><thead><tr>");
        for (String h : List.of("S.No", "Item Description", "Part no", "Qty", "UOM", "Rate (Rs.)", "Tax (%)", "Amount (Rs.)")) {
            String cls = h.equals("Item Description") ? " class=\"text-left\"" : (h.equals("Rate (Rs.)") || h.equals("Tax (%)") || h.equals("Amount (Rs.)") ? " class=\"text-right\"" : "");
            String wdt = switch (h) {
                case "S.No" -> "style=\"width:5%;\"";
                case "Item Description" -> "style=\"width:33%;\"";
                case "Part no" -> "style=\"width:10%;\"";
                case "Qty" -> "style=\"width:9%;\"";
                case "UOM" -> "style=\"width:8%;\"";
                case "Rate (Rs.)" -> "style=\"width:11%;\"";
                case "Tax (%)" -> "style=\"width:10%;\"";
                default -> "style=\"width:14%;\"";
            };
            body.append("<th ").append(wdt).append(cls).append(">").append(esc(h)).append("</th>");
        }
        body.append("</tr></thead><tbody>");
        int n = 0;
        for (Object o : lines(doc)) {
            @SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) o;
            n++;
            String itemCode = str(line.get("itemCode"));
            String hsn = firstNonEmpty(str(line.get("hsnSnapshot")),
                    items.findByCode(itemCode).map(ItemMaster::getHsnCode).filter(s -> !s.isBlank()).orElse(""));
            String desc = firstNonEmpty(str(line.get("description")), str(line.get("itemName")));
            BigDecimal qty = proforma ? bd(line.get("qty")) : bd(line.get("billedQty"));
            BigDecimal rate = bd(line.get("unitPrice"));
            BigDecimal net = bd(line.get("netAmount"));
            int pct = taxRatePercent(line);
            String taxPct = bd(line.get("taxAmount")).signum() == 0 && "Exempt".equalsIgnoreCase(str(line.get("taxCode")))
                    ? "Exempt" : pct + "%";
            body.append("<tr>");
            body.append("<td class=\"text-center nowrap\">").append(n).append("</td>");
            String custPartNo = str(line.get("customerPartNumber"));
            body.append("<td class=\"text-left\"><span class=\"bold\">").append(esc(desc)).append("</span>");
            if (!itemCode.isBlank()) {
                body.append("<br/><span class=\"text-muted\" style=\"font-size:8.5pt;\">Item Code: ").append(esc(itemCode)).append("</span>");
            }
            if (!custPartNo.isBlank()) {
                body.append("<br/><span class=\"text-muted\" style=\"font-size:8.5pt;\">Cust. Part No: ").append(esc(custPartNo)).append("</span>");
            }
            body.append("</td>");
            body.append("<td class=\"text-center nowrap\">").append(esc(hsn)).append("</td>");
            body.append("<td class=\"text-right bold nowrap\">").append(money(qty)).append("</td>");
            body.append("<td class=\"text-center nowrap\">").append(esc(str(line.get("uom")))).append("</td>");
            body.append("<td class=\"text-right nowrap\">").append(money(rate)).append("</td>");
            body.append("<td class=\"text-right nowrap\">").append(esc(taxPct)).append("</td>");
            body.append("<td class=\"text-right bold nowrap\">").append(money(net)).append("</td>");
            body.append("</tr>");
        }
        // Match the template's two trailing blank item rows.
        for (int s = 0; s < 2; s++) {
            body.append("<tr>");
            for (int c = 0; c < 8; c++) body.append("<td>&nbsp;</td>");
            body.append("</tr>");
        }
        body.append("</tbody></table>");

        // 7. Summary & tax breakdown
        body.append("<table class=\"border-bottom\"><tr>");
        body.append("<td style=\"width:58%;\" class=\"border-right\">");
        body.append("<div style=\"padding:2px 0;\"><span class=\"kv-label\">Total Amount in Words:</span><br/>")
             .append("<span class=\"bold\" style=\"font-size:9.5pt; color:#0f172a;\">").append(esc(numberToWords(roundedGrand))).append(" Only</span></div>");
        body.append("<div class=\"border-top\" style=\"padding-top:3px; margin-top:4px;\"><span class=\"kv-label\">Tax Amount in Words:</span><br/>")
             .append("<span style=\"font-size:9pt;\">").append(esc(numberToWords(taxTotal))).append(" Only</span></div>");
        body.append("</td>");
        body.append("<td style=\"width:42%; padding:0;\">").append(invoiceSummaryTable(doc, byRate, taxableTotal, taxTotal, roundedGrand, roundOff)).append("</td>");
        body.append("</tr></table>");

        // 8. Bank details & terms
        body.append("<table class=\"border-bottom\"><tr>");
        body.append("<td style=\"width:50%;\" class=\"border-right\">");
        body.append("<div class=\"bold\" style=\"font-size:9.5pt; margin-bottom:2px; color:#0f172a;\">Bank Transfer Details:</div>");
        List<String> bankRows = new ArrayList<>();
        String companyName = ci != null ? firstNonEmpty(ci.getPrintName(), ci.getCompanyName()) : "";
        String accountHolder = ci != null ? firstNonEmpty(ci.getBankAccountHolder(), companyName) : "";
        if (ci != null && !isEmpty(ci.getBankName())) {
            bankRows.add(invoiceKvRow("Bank Name", str(ci.getBankName()), false, 30));
            if (!accountHolder.isBlank()) bankRows.add(invoiceKvRow("Account Name", accountHolder, false, 30));
            if (!isEmpty(ci.getBankAccount())) bankRows.add(invoiceKvRow("Account No", str(ci.getBankAccount()), false, 30));
            if (!isEmpty(ci.getBankIfsc())) bankRows.add(invoiceKvRow("IFSC Code", str(ci.getBankIfsc()), false, 30));
            if (!isEmpty(ci.getBankBranch())) bankRows.add(invoiceKvRow("Branch", str(ci.getBankBranch()), false, 30));
        } else {
            bankRows.add(invoiceKvRow("Bank Name", "-", false, 30));
        }
        body.append(invoiceKvTable(bankRows));
        body.append("</td>");
        body.append("<td style=\"width:50%;\">");
        body.append("<div class=\"bold\" style=\"font-size:9.5pt; margin-bottom:2px; color:#0f172a;\">Terms &amp; Conditions:</div>");
        body.append("<ol class=\"terms-text\" style=\"margin:0; padding-left:12px;\">");
        for (String t : List.of(
                "Goods once sold will not be taken back or exchanged.",
                "Our responsibility ceases once the goods leave our Godown.",
                "Interest will be payable at 18% P.A if the invoice is not paid within the due date.",
                "Payments are to be made by Cheque / Draft / NEFT / RTGS.")) {
            body.append("<li>").append(esc(t)).append("</li>");
        }
        body.append("</ol>");
        String remarks = str(doc.get("remarks"));
        if (!remarks.isBlank()) {
            body.append("<div class=\"terms-text text-muted\" style=\"margin-top:4px;\">Remarks: ").append(esc(remarks)).append("</div>");
        }
        body.append("</td></tr></table>");

        // 9. Signature section
        body.append("<table><tr style=\"height:60px;\">");
        body.append("<td style=\"width:50%; vertical-align:bottom;\" class=\"border-right text-center\">");
        body.append("<div style=\"border-top:1px dashed #cbd5e1; width:70%; margin:0 auto 4px auto;\"></div>");
        body.append("<div class=\"bold\" style=\"font-size:9pt;\">Receiver's Stamp &amp; Signature</div></td>");
        body.append("<td style=\"width:50%; vertical-align:top;\" class=\"text-center\">");
        String signatoryCompany = companyName
                + (ci != null && !str(ci.getDisplayType()).isBlank() ? " " + str(ci.getDisplayType()) : "");
        body.append("<div class=\"bold\" style=\"font-size:9pt; color:#0f172a; text-transform:uppercase;\">For ").append(esc(signatoryCompany)).append("</div>");
        body.append("<div style=\"height:45px;\"></div>");
        body.append("<span class=\"bold\" style=\"font-size:9pt;\">Authorized Signatory</span></td>");
        body.append("</tr></table>");

        String wm = null;
        return renderPdf(proforma ? "Proforma Invoice" : "Tax Invoice", INVOICE_CSS, "<div class=\"inv-box\">" + body + "</div>", wm);
    }

    /** Logo (left) + company info (centre) + QR code (right) header, per invoice.html.
     * The grid is always 20/60/20 so the company block stays centred even when a
     * logo or QR is absent (an empty side cell is emitted instead). */
    private String invoiceHeader(Map<String, Object> doc, CompanyInfo ci,
                                 BigDecimal taxable, BigDecimal tax, BigDecimal grand) {
        return invoiceHeader(doc, ci, taxable, tax, grand, false);
    }

    private String invoiceHeader(Map<String, Object> doc, CompanyInfo ci,
                                 BigDecimal taxable, BigDecimal tax, BigDecimal grand, boolean proforma) {
        String logo = logoDataUri();
        String gstin = ci != null ? firstNonEmpty(ci.getGstin(), ci.getGstNumber()) : "";

        String qr = proforma ? null : qrDataUri(invoiceQrContent(doc, gstin, taxable, tax, grand));

        StringBuilder sb = new StringBuilder();
        sb.append("<table class=\"border-bottom\"><tr>");
        sb.append("<td style=\"width:20%; vertical-align:middle;\" class=\"text-center\">");
        if (logo != null) {
            sb.append("<img src=\"").append(logo).append("\" class=\"inv-logo\" alt=\"logo\"/>");
        }
        sb.append("</td>");
        sb.append("<td style=\"width:60%; vertical-align:middle;\" class=\"text-center\">").append(companyCenterBlock(ci)).append("</td>");
        sb.append("<td style=\"width:20%; vertical-align:middle;\" class=\"text-center\">");
        if (qr != null) {
            sb.append("<div style=\"border:1px solid #e2e8f0; padding:3px; display:inline-block; border-radius:4px;\">");
            sb.append("<img src=\"").append(qr).append("\" class=\"inv-qr\" alt=\"QR Code\"/></div>");
        }
        sb.append("</td></tr></table>");
        return sb.toString();
    }

    private String invoiceKvRow(String label, String value, boolean blue) {
        return invoiceKvRow(label, value, blue, 40);
    }

    private String invoiceKvRow(String label, String value, boolean blue, int labelPct) {
        int valuePct = 100 - labelPct - 4;
        StringBuilder sb = new StringBuilder("<tr>");
        sb.append("<td style=\"width:").append(labelPct).append("%;\" class=\"kv-label\">").append(esc(label)).append("</td>");
        sb.append("<td style=\"width:4%;\">:</td>");
        sb.append("<td style=\"width:").append(valuePct).append("%;").append(blue ? " color:#2563eb;" : "").append("\" class=\"bold\">").append(esc(value)).append("</td>");
        sb.append("</tr>");
        return sb.toString();
    }

    /** Wide single-label row used by the IRN / e-way bill block: label inherits the
     * template's 18/82 split with the colon inside the label cell. */
    private String invoiceWideRow(String label, String value) {
        return invoiceWideRow(label, value, true);
    }

    private String invoiceWideRow(String label, String value, boolean bold) {
        return "<tr><td style=\"width:18%;\" class=\"kv-label\">" + esc(label) + "</td>"
                + "<td style=\"width:82%; word-break: break-all;\"" + (bold ? " class=\"bold\"" : "") + ">" + esc(value) + "</td></tr>";
    }

    private String invoiceKvTable(List<String> rows) {
        return "<table class=\"kv-table\">" + String.join("", rows) + "</table>";
    }

    private String placeOfSupplyDisplay(Map<String, Object> doc) {
        String pos = str(doc.get("placeOfSupply"));
        String code = str(doc.get("placeOfSupplyCode"));
        if (code.isBlank()) {
            String gstin = str(doc.get("customerGstin"));
            if (gstin.length() >= 2) code = gstin.substring(0, 2);
        }
        return pos + (code.isBlank() ? "" : " (Code: " + code + ")");
    }

    /** Billed-To / Shipped-To key-value rows. Proformas carry no GSTIN / place-of-
     * supply data, so those rows are skipped for the proforma variant. */
    private List<String> partyKvRows(Map<String, Object> doc, boolean billed) {
        return partyKvRows(doc, billed, false);
    }

    private List<String> partyKvRows(Map<String, Object> doc, boolean billed, boolean proforma) {
        List<String> rows = new ArrayList<>();
        String customer = str(doc.get("customer"));
        String contact = str(doc.get("contactPerson"));
        String address = billed ? str(doc.get("billingAddress"))
                : firstNonEmpty(str(doc.get("shippingAddress")), str(doc.get("billingAddress")));
        String gstin = firstNonEmpty(str(doc.get("customerGstin")), str(doc.get("gstin")));
        String phone = str(doc.get("phone"));
        String email = str(doc.get("email"));
        rows.add(invoiceKvRow("Company Name", customer, false, 32));
        rows.add(invoiceKvRow("Contact Person", contact, false, 32));
        rows.add(invoiceKvRow("Address", address, false, 32));
        if (!proforma) {
            rows.add(invoiceKvRow("GSTIN", gstin, false, 32));
            rows.add(invoiceKvRow("State Code", placeOfSupplyDisplay(doc), false, 32));
        }
        rows.add(invoiceKvRow("Contact No", phone, false, 32));
        rows.add(invoiceKvRow("Email ID", email, false, 32));
        return rows;
    }

    /** Right-hand summary table: taxable, CGST/SGST-per-rate (or IGST), round off, grand total. */
    private String invoiceSummaryTable(Map<String, Object> doc, java.util.TreeMap<Integer, BigDecimal[]> byRate,
                                       BigDecimal taxableTotal, BigDecimal taxTotal,
                                       BigDecimal roundedGrand, BigDecimal roundOff) {
        boolean igst = "IGST".equalsIgnoreCase(str(doc.get("taxType")));
        List<String> rows = new ArrayList<>();
        rows.add("<tr><td style=\"width:60%;\" class=\"text-right kv-label\">Taxable Subtotal:</td>"
                + "<td style=\"width:40%;\" class=\"text-right bold\">" + esc(money(taxableTotal)) + "</td></tr>");
        for (var e : byRate.entrySet()) {
            int rate = e.getKey();
            BigDecimal taxable = e.getValue()[0];
            BigDecimal taxAmt = e.getValue()[1];
            if (taxAmt.signum() == 0) continue;
            if (igst) {
                rows.add("<tr><td class=\"text-right kv-label\">IGST @ " + rate + "%:</td>"
                        + "<td class=\"text-right\">" + esc(money(taxAmt)) + "</td></tr>");
            } else {
                BigDecimal half = taxAmt.divide(BigDecimal.valueOf(2), 2, RoundingMode.HALF_UP);
                rows.add("<tr><td class=\"text-right kv-label\">CGST @ " + rate / 2 + "%:</td>"
                        + "<td class=\"text-right\">" + esc(money(half)) + "</td></tr>");
                rows.add("<tr><td class=\"text-right kv-label\">SGST @ " + rate / 2 + "%:</td>"
                        + "<td class=\"text-right\">" + esc(money(half)) + "</td></tr>");
            }
        }
        rows.add("<tr><td class=\"text-right kv-label\">Round Off:</td>"
                + "<td class=\"text-right\">" + esc(money(roundOff)) + "</td></tr>");
        rows.add("<tr class=\"grand-total-row\"><td class=\"text-right bold\" style=\"font-size:10pt; color:#0f172a;\">Grand Total (Rs.):</td>"
                + "<td class=\"text-right bold\" style=\"font-size:10pt; color:#2563eb;\">" + esc(money(roundedGrand)) + "</td></tr>");
        return "<table class=\"kv-table\">" + String.join("", rows) + "</table>";
    }

    // ═══════════════════════════════════════════════════════════════════════
    // BOM — FRS §5.4 FR-23/FR-24
    // ═══════════════════════════════════════════════════════════════════════

    public byte[] bom(Map<String, Object> doc) {
        StringBuilder body = new StringBuilder();
        body.append(letterhead());
        body.append(titleBarHtml("BILL OF MATERIALS"));
        body.append(sectionBarHtml("Header"));

        List<String[]> fields = new ArrayList<>();
        fields.add(new String[]{"BOM Code", str(doc.get("bomNumber"))});
        fields.add(new String[]{"BOM Item", str(doc.get("itemCode"))});
        fields.add(new String[]{"Item Type", str(doc.get("itemType"))});
        fields.add(new String[]{"Base Qty", num(doc.get("baseQuantity"))});
        fields.add(new String[]{"Revision", str(doc.get("revisionLabel"))});
        fields.add(new String[]{"Total Weight", num(doc.get("weight"))});
        fields.add(new String[]{"Status", str(doc.get("status"))});
        fields.add(new String[]{"Sales Order", str(doc.get("salesOrderId"))});
        fields.add(new String[]{"Specifications", str(doc.get("specifications"))});
        fields.add(new String[]{"Remarks", str(doc.get("remarks"))});
        body.append(fieldGrid(fields));

        body.append(sectionBarHtml("Component List"));
        List<String> headers = List.of("#", "Level", "Component", "Revision", "Qty", "Total Wt", "Remarks");
        List<List<String>> rows = new ArrayList<>();
        int seq = 1;
        for (Object o : lines(doc)) {
            @SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) o;
            rows.add(List.of(String.valueOf(seq++), str(line.get("bomLevel")), str(line.get("componentItemCode")),
                    str(line.get("componentRevision")), num(line.get("quantityPer")), num(line.get("totalWeight")), str(line.get("remarks"))));
        }
        body.append(itemsTable(headers, rows, new boolean[]{false, false, false, false, true, true, false},
                new int[]{6, 8, 14, 14, 18, 18, 22}, null, null));

        body.append(sigContainer(null, "Prepared By", "Approved By"));
        body.append(computerGenerated("This is a Computer Generated Bill of Materials"));
        return renderPdf("Bill of Materials", body.toString(), null);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Route Sheet
    // ═══════════════════════════════════════════════════════════════════════

    public byte[] routeSheet(Map<String, Object> doc) {
        StringBuilder body = new StringBuilder();
        body.append(letterhead());
        body.append(titleBarHtml("ROUTE SHEET"));
        body.append(sectionBarHtml("Header"));

        List<String[]> fields = new ArrayList<>();
        fields.add(new String[]{"Route No", str(doc.get("routeNumber"))});
        fields.add(new String[]{"Item Code", str(doc.get("itemCode"))});
        fields.add(new String[]{"Item Type", str(doc.get("itemType"))});
        fields.add(new String[]{"Revision", str(doc.get("routeVersion"))});
        fields.add(new String[]{"Base Qty", num(doc.get("baseQuantity"))});
        fields.add(new String[]{"Status", str(doc.get("status"))});
        fields.add(new String[]{"Total Setup", num(doc.get("totalSetupTime"))});
        fields.add(new String[]{"Total Cycle", num(doc.get("totalCycleTime"))});
        body.append(fieldGrid(fields));

        body.append(sectionBarHtml("Operation Sequence"));
        List<String> headers = List.of("Seq", "Process", "Resource", "Type", "Setup(min)", "Cycle(min)", "QC");
        List<List<String>> rows = new ArrayList<>();
        for (Object o : lines(doc)) {
            @SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) o;
            rows.add(List.of(num(line.get("sequenceNo")), str(line.get("processCode")), str(line.get("resourceName")),
                    str(line.get("resourceType")), num(line.get("setupTime")), num(line.get("cycleTime")),
                    Boolean.TRUE.equals(line.get("inspectionRequired")) ? "Yes" : "No"));
        }
        body.append(itemsTable(headers, rows, new boolean[]{true, false, false, false, true, true, false},
                new int[]{8, 14, 14, 14, 14, 14, 22}, null, null));

        body.append(sigContainer(null, "Prepared By", "Approved By"));
        body.append(computerGenerated("This is a Computer Generated Route Sheet"));
        return renderPdf("Route Sheet", body.toString(), null);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Return Note (DC / Invoice / Stock Return) — Return Management FRS v1.0 §12
    // ═══════════════════════════════════════════════════════════════════════

    public byte[] returnNote(Map<String, Object> doc, String type) {
        String title = switch (type) {
            case "invoice-return" -> "INVOICE RETURN NOTE";
            case "stock-return" -> "STOCK RETURN NOTE";
            default -> "DC RETURN NOTE";
        };
        StringBuilder body = new StringBuilder();
        body.append(letterhead());
        body.append(titleBarHtml(title));

        List<String[]> fields = new ArrayList<>();
        fields.add(new String[]{"Return No", str(doc.get("docNo"))});
        fields.add(new String[]{"Return Date", str(doc.get("docDate"))});
        fields.add(new String[]{"Source No", str(doc.get("sourceNo"))});
        fields.add(new String[]{"Status", str(doc.get("status"))});
        Object reason = doc.get("reasonCode");
        fields.add(new String[]{"Reason", reason == null ? "" : str(reason)});
        Object cond = doc.get("condition");
        fields.add(new String[]{"Condition", cond == null ? "" : str(cond)});
        body.append(fieldGrid(fields));

        body.append(sectionBarHtml("Returned Items"));
        List<String> headers = List.of("Sl No", "Item Code", "Location", "Batch / Heat", "Qty", "Status", "Ret Qty");
        List<List<String>> rows = new ArrayList<>();
        int i = 1;
        for (Object o : lines(doc)) {
            @SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) o;
            rows.add(List.of(String.valueOf(i++), str(line.get("itemCode")), firstOf(line, "location"),
                    firstOf(line, "batchNo", "batchNumber", "heatNo"), num(line.get("qty")), firstOf(line, "stockStatus"),
                    num(firstOfObj(line, "currentReturnQty", "returnedQty"))));
        }
        body.append(itemsTable(headers, rows, new boolean[]{true, false, false, false, true, false, true},
                new int[]{10, 26, 12, 18, 12, 10, 12}, null, null));

        body.append(sigContainer(null, "Received By", "Authorized Signatory"));
        body.append(computerGenerated("This is a Computer Generated " + title));
        return renderPdf(title, body.toString(), null);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Allotment / Release note — Stock Allotment & Adjustment FRS v1.0 §12
    // ═══════════════════════════════════════════════════════════════════════

    public byte[] allotmentIssuance(Map<String, Object> doc, String type) {
        String title = "stock-release".equals(type) ? "STOCK RELEASE NOTE" : "STOCK ALLOTMENT NOTE";
        StringBuilder body = new StringBuilder();
        body.append(letterhead());
        body.append(titleBarHtml(title));

        List<String[]> fields = new ArrayList<>();
        fields.add(new String[]{"Doc No", str(doc.get("docNo"))});
        fields.add(new String[]{"Date", str(doc.get("docDate"))});
        fields.add(new String[]{"Item Code", str(doc.get("itemCode"))});
        fields.add(new String[]{"Status", str(doc.get("status"))});
        Object ref = doc.get("referenceNo");
        fields.add(new String[]{"Reference", ref == null ? "" : str(ref)});
        body.append(fieldGrid(fields));

        body.append(sectionBarHtml("Items"));
        List<String> headers = List.of("Sl No", "Item Code", "Location", "Batch / Heat", "Qty", "Status");
        List<List<String>> rows = new ArrayList<>();
        int i = 1;
        for (Object o : lines(doc)) {
            @SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) o;
            rows.add(List.of(String.valueOf(i++), str(line.get("itemCode")), firstOf(line, "location"),
                    firstOf(line, "batchNo", "batchNumber", "heatNo"), num(line.get("qty")), firstOf(line, "stockStatus")));
        }
        body.append(itemsTable(headers, rows, new boolean[]{true, false, false, false, true, false},
                new int[]{8, 26, 18, 16, 16, 16}, null, null));

        body.append(sigContainer(null, "Issued By", "Authorized Signatory"));
        body.append(computerGenerated("This is a Computer Generated " + title));
        return renderPdf(title, body.toString(), null);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Stock / Physical Amendment note — Stock Allotment & Adjustment FRS v1.0 §12
    // ═══════════════════════════════════════════════════════════════════════

    public byte[] amendmentNote(Map<String, Object> doc, String type) {
        String title = "physical-stock-amendment".equals(type) ? "PHYSICAL STOCK AMENDMENT" : "STOCK AMENDMENT";
        StringBuilder body = new StringBuilder();
        body.append(letterhead());
        body.append(titleBarHtml(title));

        List<String[]> fields = new ArrayList<>();
        fields.add(new String[]{"Doc No", str(doc.get("docNo"))});
        fields.add(new String[]{"Date", str(doc.get("docDate"))});
        fields.add(new String[]{"Item Code", str(doc.get("itemCode"))});
        fields.add(new String[]{"Status", str(doc.get("status"))});
        Object reason = doc.get("reasonCode");
        fields.add(new String[]{"Reason", reason == null ? "" : str(reason)});
        body.append(fieldGrid(fields));

        boolean physical = "physical-stock-amendment".equals(type);
        body.append(sectionBarHtml("Adjustment Lines"));
        List<String> headers = physical
                ? List.of("Sl No", "Item Code", "Location", "Batch / Heat", "System", "Physical", "Variance")
                : List.of("Sl No", "Item Code", "Location", "Batch / Heat", "Diff Qty");
        List<List<String>> rows = new ArrayList<>();
        int i = 1;
        for (Object o : lines(doc)) {
            @SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) o;
            List<String> row = new ArrayList<>(List.of(String.valueOf(i++), str(line.get("itemCode")),
                    firstOf(line, "location", "storeLocation"), firstOf(line, "batchNo", "batchNumber", "heatNo")));
            if (physical) {
                row.add(num(line.get("systemQty")));
                row.add(num(line.get("physicalQty")));
                row.add(num(line.get("varianceQty")));
            } else {
                row.add(num(line.get("differenceQty")));
            }
            rows.add(row);
        }
        boolean[] align = physical
                ? new boolean[]{true, false, false, false, true, true, true}
                : new boolean[]{true, false, false, false, true};
        int[] widths = physical
                ? new int[]{8, 26, 12, 12, 12, 14, 16}
                : new int[]{8, 26, 20, 18, 28};
        body.append(itemsTable(headers, rows, align, widths, null, null));

        body.append(sigContainer(null, "Verified By", "Authorized Signatory"));
        body.append(computerGenerated("This is a Computer Generated " + title));
        return renderPdf(title, body.toString(), null);
    }
}
