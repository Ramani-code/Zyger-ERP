package in.zygertechnology.zygererp.service;

import com.lowagie.text.Document;
import com.lowagie.text.Font;
import com.lowagie.text.FontFactory;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.Phrase;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfWriter;
import org.springframework.stereotype.Service;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@Service
public class ExportService {

    /** Builds an export blob for the requested format (xlsx | pdf). */
    public byte[] build(List<Map<String, Object>> rows, String format, String title) {
        List<String> headers = rows.isEmpty() ? List.of("docNo", "date", "status")
                : new ArrayList<>(rows.get(0).keySet());
        List<List<String>> data = rows.stream()
                .map(r -> headers.stream().map(h -> String.valueOf(r.get(h))).collect(Collectors.toList()))
                .collect(Collectors.toList());
        if ("pdf".equalsIgnoreCase(format)) return pdf(title, headers, data);
        if ("xlsx".equalsIgnoreCase(format)) return xlsx(title, headers, data);
        return csv(headers, data);
    }

    private byte[] csv(List<String> headers, List<List<String>> rows) {
        StringBuilder sb = new StringBuilder("\uFEFF");
        sb.append(headers.stream().map(ExportService::esc).collect(Collectors.joining(","))).append("\n");
        for (List<String> r : rows)
            sb.append(r.stream().map(ExportService::esc).collect(Collectors.joining(","))).append("\n");
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    private static String esc(String s) {
        if (s == null) return "";
        return (s.contains(",") || s.contains("\"") || s.contains("\n"))
                ? "\"" + s.replace("\"", "\"\"") + "\"" : s;
    }

    private byte[] pdf(String title, List<String> headers, List<List<String>> rows) {
        try (ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            Document doc = new Document(PageSize.A4.rotate());
            PdfWriter.getInstance(doc, baos);
            doc.open();
            doc.add(new Paragraph(title, FontFactory.getFont(FontFactory.HELVETICA_BOLD, 14)));
            doc.add(new Paragraph(" "));
            PdfPTable t = new PdfPTable(headers.size());
            t.setWidthPercentage(100);
            for (String h : headers) {
                PdfPCell c = new PdfPCell(new Phrase(h,
                        FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9, Color.WHITE)));
                c.setBackgroundColor(new Color(27, 36, 51));
                t.addCell(c);
            }
            for (List<String> r : rows)
                for (String v : r)
                    t.addCell(new Phrase(v == null ? "" : v,
                            FontFactory.getFont(FontFactory.HELVETICA, 8)));
            doc.add(t);
            doc.close();
            return baos.toByteArray();
        } catch (Exception e) {
            throw new IllegalStateException("PDF export failed");
        }
    }

    /** Minimal-but-valid XLSX writer (inline strings) using java.util.zip. */
    private byte[] xlsx(String title, List<String> headers, List<List<String>> rows) {
        StringBuilder sheet = new StringBuilder();
        sheet.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
        sheet.append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">");
        sheet.append("<sheetData>");
        sheet.append("<row r=\"1\">");
        for (String h : headers) sheet.append(cell(h, true));
        sheet.append("</row>");
        int r = 2;
        for (List<String> row : rows) {
            sheet.append("<row r=\"").append(r).append("\">");
            for (String v : row) sheet.append(cell(v, false));
            sheet.append("</row>");
            r++;
        }
        sheet.append("</sheetData></worksheet>");

        String contentTypes = """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                  <Default Extension="xml" ContentType="application/xml"/>
                  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
                  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
                  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
                </Types>""";
        String rootRels = """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
                </Relationships>""";
        String workbook = """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                  <sheets><sheet name="%s" sheetId="1" r:id="rId1"/></sheets>
                </workbook>""".formatted(xmlSafe(title));
        String wbRels = """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
                  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
                </Relationships>""";
        String styles = """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                  <fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font></fonts>
                  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
                  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
                  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
                  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
                </styleSheet>""";

        try (ByteArrayOutputStream baos = new ByteArrayOutputStream();
             ZipOutputStream zip = new ZipOutputStream(baos)) {
            zip.putNextEntry(new ZipEntry("[Content_Types].xml"));
            zip.write(contentTypes.getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
            zip.putNextEntry(new ZipEntry("_rels/.rels"));
            zip.write(rootRels.getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
            zip.putNextEntry(new ZipEntry("xl/workbook.xml"));
            zip.write(workbook.getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
            zip.putNextEntry(new ZipEntry("xl/_rels/workbook.xml.rels"));
            zip.write(wbRels.getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
            zip.putNextEntry(new ZipEntry("xl/worksheets/sheet1.xml"));
            zip.write(sheet.toString().getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
            zip.putNextEntry(new ZipEntry("xl/styles.xml"));
            zip.write(styles.getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
            // finish() flushes the ZIP central directory into baos; without it the returned
            // bytes are captured before try-with-resources closes zip, so every export was a
            // truncated archive with no central directory (unreadable by Excel/openpyxl/unzip).
            zip.finish();
            return baos.toByteArray();
        } catch (Exception e) {
            throw new IllegalStateException("XLSX export failed");
        }
    }

    private String cell(String v, boolean bold) {
        String style = bold ? " s=\"1\"" : "";
        return "<c t=\"inlineStr\"" + style + "><is><t xml:space=\"preserve\">"
                + xmlSafe(v == null ? "" : v) + "</t></is></c>";
    }

    private static String xmlSafe(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;");
    }
}
