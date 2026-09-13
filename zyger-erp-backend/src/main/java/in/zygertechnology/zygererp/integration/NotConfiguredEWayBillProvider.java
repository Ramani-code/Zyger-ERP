package in.zygertechnology.zygererp.integration;

import in.zygertechnology.zygererp.config.BusinessRuleException;
import in.zygertechnology.zygererp.entity.SalesDc;
import org.springframework.stereotype.Component;

/**
 * Default {@link EWayBillProvider} until a real API provider is chosen and
 * credentialed — see {@link NotConfiguredEInvoiceProvider} for the rationale.
 * app.sales.eway-bill-required should stay false so this is never hit on a
 * normal DC post.
 */
@Component
public class NotConfiguredEWayBillProvider implements EWayBillProvider {
    @Override
    public EWayBillResult generate(SalesDc dc) {
        throw new BusinessRuleException("EWAY_BILL_PROVIDER_NOT_CONFIGURED",
                "No E-Way Bill API provider is configured. Contact an administrator to choose and credential " +
                        "a provider before generating an E-Way Bill for " + dc.getDocNo() + ".");
    }

    @Override
    public void updatePartB(SalesDc dc, String newVehicleNo) {
        throw new BusinessRuleException("EWAY_BILL_PROVIDER_NOT_CONFIGURED",
                "No E-Way Bill API provider is configured. Contact an administrator to choose and credential " +
                        "a provider before updating the E-Way Bill for " + dc.getDocNo() + ".");
    }
}
