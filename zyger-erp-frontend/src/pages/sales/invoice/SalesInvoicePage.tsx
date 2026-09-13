import SalesDocScreen from '../SalesDocScreen';
import { SALES_INVOICE_CONFIG } from '../salesDocConfigs';
export default function SalesInvoicePage(props: { initialDocId?: string | number; viewOnly?: boolean; initialStatus?: string }) {
  return <SalesDocScreen config={SALES_INVOICE_CONFIG} {...props} />;
}
