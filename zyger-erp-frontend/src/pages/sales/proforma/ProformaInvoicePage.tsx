import SalesDocScreen from '../SalesDocScreen';
import { PROFORMA_INVOICE_CONFIG } from '../salesDocConfigs';
export default function ProformaInvoicePage(props: { initialDocId?: string | number; viewOnly?: boolean; initialStatus?: string }) {
  return <SalesDocScreen config={PROFORMA_INVOICE_CONFIG} {...props} />;
}
