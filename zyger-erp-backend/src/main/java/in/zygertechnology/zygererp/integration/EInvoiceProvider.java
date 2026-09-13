package in.zygertechnology.zygererp.integration;

import in.zygertechnology.zygererp.entity.SalesInvoice;

/**
 * Phase 5 (Improvement Plan §F / Technical Design §2.5): pluggable seam for
 * e-invoicing (IRN/QR generation) via a GSP (GST Suvidha Provider) or a direct
 * IRP integration. A real provider becomes a second {@code @Component}
 * implementation (marked {@code @Primary}, or swapped in via Spring profile) —
 * calling code (SalesService) never changes when the provider changes.
 *
 * No real provider is wired yet: {@link NotConfiguredEInvoiceProvider} is the
 * only implementation until a GSP/IRP is chosen and credentialed.
 */
public interface EInvoiceProvider {
    EInvoiceResult generateIrn(SalesInvoice invoice);
}
