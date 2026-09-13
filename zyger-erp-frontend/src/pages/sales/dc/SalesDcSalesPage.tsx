import SalesDocScreen from '../SalesDocScreen';
import { SALES_DC_CONFIG } from '../salesDocConfigs';
export default function SalesDcSalesPage(props: { initialDocId?: string | number; viewOnly?: boolean; initialStatus?: string }) {
  return <SalesDocScreen config={SALES_DC_CONFIG} {...props} />;
}
