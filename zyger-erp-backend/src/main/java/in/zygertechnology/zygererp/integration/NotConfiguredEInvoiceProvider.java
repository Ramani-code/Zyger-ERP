package in.zygertechnology.zygererp.integration;

import in.zygertechnology.zygererp.config.BusinessRuleException;
import in.zygertechnology.zygererp.entity.SalesInvoice;
import org.springframework.stereotype.Component;

/**
 * Default {@link EInvoiceProvider} until a real GSP/IRP is chosen and
 * credentialed — deliberately fails loudly rather than fabricating an IRN, so
 * nothing downstream can ever mistake a stub response for a real government
 * acknowledgement. Replace with a real implementation (see the interface
 * Javadoc) once a provider is confirmed; until then app.sales.einvoice-required
 * should stay false so this is never hit on a normal Invoice post.
 */
@Component
public class NotConfiguredEInvoiceProvider implements EInvoiceProvider {
    @Override
    public EInvoiceResult generateIrn(SalesInvoice invoice) {
        throw new BusinessRuleException("EINVOICE_PROVIDER_NOT_CONFIGURED",
                "No GSP/IRP provider is configured for e-invoicing. Contact an administrator to choose and " +
                        "credential a provider before generating an IRN for " + invoice.getDocNo() + ".");
    }
}
