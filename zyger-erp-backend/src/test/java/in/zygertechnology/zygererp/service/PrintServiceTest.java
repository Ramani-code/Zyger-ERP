package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.CompanyInfo;
import in.zygertechnology.zygererp.repo.CompanyInfoRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PrintServiceTest {

    @Mock private CompanyInfoRepository companyInfos;
    @Mock private in.zygertechnology.zygererp.repo.ItemRepository items;
    @InjectMocks private PrintService printService;

    @Nested
    @DisplayName("deliveryChallan()")
    class DeliveryChallan {
        @Test
        @DisplayName("Should generate PDF bytes for delivery challan")
        void generatePdf() {
            when(companyInfos.findById(1L)).thenReturn(Optional.empty());

            Map<String, Object> doc = new LinkedHashMap<>();
            doc.put("docNo", "DC-001");
            doc.put("docDate", "2026-01-15");
            doc.put("customer", "Acme Corp");
            doc.put("lines", List.of());

            byte[] result = printService.deliveryChallan(doc, "sales-dc");
            assertNotNull(result);
            assertTrue(result.length > 0);
            // PDF magic bytes: %PDF
            assertTrue(result[0] == (byte) '%');
        }

        @Test
        @DisplayName("Should generate PDF with lines")
        void generatePdfWithLines() {
            when(companyInfos.findById(1L)).thenReturn(Optional.empty());

            Map<String, Object> doc = new LinkedHashMap<>();
            doc.put("docNo", "DC-002");
            doc.put("customer", "Beta Inc");
            doc.put("lines", List.of(
                    Map.of("itemCode", "ITEM-1", "description", "Widget", "quantity", 10, "uom", "NOS")
            ));

            byte[] result = printService.deliveryChallan(doc, "sales-dc");
            assertNotNull(result);
            assertTrue(result.length > 100);
        }
    }

    @Nested
    @DisplayName("workOrder()")
    class WorkOrderPrint {
        @Test
        @DisplayName("Should generate PDF for work order")
        void generatePdf() {
            when(companyInfos.findById(1L)).thenReturn(Optional.empty());

            Map<String, Object> doc = new LinkedHashMap<>();
            doc.put("docNo", "WO-001");
            doc.put("itemCode", "ITEM-100");
            doc.put("lines", List.of());

            byte[] result = printService.workOrder(doc);
            assertNotNull(result);
            assertTrue(result.length > 0);
        }
    }

    @Nested
    @DisplayName("salesDoc()")
    class SalesDocPrint {
        @Test
        @DisplayName("Should generate PDF for sales document")
        void generatePdf() {
            when(companyInfos.findById(1L)).thenReturn(Optional.empty());

            Map<String, Object> doc = new LinkedHashMap<>();
            doc.put("docNo", "SO-001");
            doc.put("customer", "Acme Corp");
            doc.put("lines", List.of());

            byte[] result = printService.salesDoc(doc, "sales-order");
            assertNotNull(result);
            assertTrue(result.length > 0);
        }
    }

    @Nested
    @DisplayName("salesInvoice() — GST tax-invoice template")
    class SalesInvoicePrint {
        @Test
        @DisplayName("Should generate tax invoice with company header, QR and CGST/SGST breakdown")
        void generatePdf() {
            CompanyInfo ci = new CompanyInfo();
            ci.setId(1L);
            ci.setCompanyName("Acme Pvt Ltd");
            ci.setDisplayType("Private Limited");
            ci.setAddressLine1("Plot 1, Industrial Area\nNear By-Pass Road");
            ci.setCity("Coimbatore"); ci.setState("Tamil Nadu"); ci.setPincode("641001");
            ci.setGstin("33ABCDE1234F1Z5"); ci.setPan("ABCDE1234F");
            ci.setEmail("billing@acme.in"); ci.setPhone("+911234567890");
            ci.setBankName("HDFC"); ci.setBankAccount("50100100000000");
            ci.setBankIfsc("HDFC0000001"); ci.setBankBranch("Coimbatore");
            ci.setBankAccountHolder("Acme Pvt Ltd");
            when(companyInfos.findById(1L)).thenReturn(Optional.of(ci));

            Map<String, Object> doc = new LinkedHashMap<>();
            doc.put("docNo", "SI-2026-0001");
            doc.put("date", "2026-01-15");
            doc.put("customer", "Beta Inc");
            doc.put("customerCode", "CUS-001");
            doc.put("customerGstin", "33XYZWQ0000G1Z5");
            doc.put("placeOfSupply", "Tamil Nadu");
            doc.put("placeOfSupplyCode", "33");
            doc.put("taxType", "CGST_SGST");
            doc.put("status", "POSTED");
            doc.put("lines", List.of(Map.of(
                    "itemCode", "ITEM-1", "description", "Precision Shaft",
                    "hsnSnapshot", "8483", "billedQty", 10, "uom", "NOS",
                    "unitPrice", 100, "taxAmount", 180, "netAmount", 1180)));

            byte[] result = printService.salesInvoice(doc);
            assertNotNull(result);
            assertTrue(result.length > 1000);
        }
    }
}
