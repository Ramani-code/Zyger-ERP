import SalesDocScreen from '../SalesDocScreen';
import { SALES_ORDER_CONFIG } from '../salesDocConfigs';
export default function SalesOrderPage(props: { initialDocId?: string | number; viewOnly?: boolean; initialStatus?: string }) {
  return <SalesDocScreen config={SALES_ORDER_CONFIG} {...props} />;
}
