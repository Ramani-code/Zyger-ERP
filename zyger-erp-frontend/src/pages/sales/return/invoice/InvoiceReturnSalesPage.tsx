import SalesDocScreen from '../../SalesDocScreen';
import { INVOICE_RETURN_CONFIG } from '../../salesDocConfigs';
export default function InvoiceReturnSalesPage(props: { initialDocId?: string | number; viewOnly?: boolean; initialStatus?: string }) {
  return <SalesDocScreen config={INVOICE_RETURN_CONFIG} {...props} />;
}
