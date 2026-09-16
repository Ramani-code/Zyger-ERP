package in.zygertechnology.zygererp.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipFile;

import static org.junit.jupiter.api.Assertions.assertTrue;

class ExportServiceTest {

    private final ExportService export = new ExportService();

    @Test
    @DisplayName("XLSX export produces a ZIP archive with a valid central directory (openable by Excel/unzip)")
    void xlsxExportIsAValidZipArchive() throws IOException {
        byte[] bytes = export.build(
                List.of(Map.of("itemCode", "ITEM-1", "onHand", "100")),
                "xlsx", "current-stock");

        Path tmp = Files.createTempFile("export-test", ".xlsx");
        try {
            Files.write(tmp, bytes);
            // ZipFile does random-access reads driven by the end-of-central-directory record —
            // unlike ZipInputStream (which streams local headers and would happily "succeed" on
            // a truncated archive), this throws ZipException if the central directory is missing,
            // exactly reproducing the failure Excel/unzip/openpyxl hit on the pre-fix output.
            try (ZipFile zf = new ZipFile(tmp.toFile())) {
                assertTrue(zf.size() >= 5, "expected the standard xlsx parts (content types, rels, workbook, sheet, styles)");
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }
}
