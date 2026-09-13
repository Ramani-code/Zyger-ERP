package in.zygertechnology.zygererp.integration;

import in.zygertechnology.zygererp.entity.SalesDc;

/**
 * Phase 5 (Improvement Plan §F / Technical Design §2.4): pluggable seam for
 * E-Way Bill generation. Same swap-in-a-real-implementation contract as
 * {@link EInvoiceProvider} — see its Javadoc.
 */
public interface EWayBillProvider {
    EWayBillResult generate(SalesDc dc);

    /** En-route vehicle change (Part-B update) against an already-generated E-Way Bill. */
    void updatePartB(SalesDc dc, String newVehicleNo);
}
