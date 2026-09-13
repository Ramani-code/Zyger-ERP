import SalesDocScreen from '../../SalesDocScreen';
import { DC_RETURN_CONFIG } from '../../salesDocConfigs';
export default function DcReturnSalesPage(props: { initialDocId?: string | number; viewOnly?: boolean; initialStatus?: string }) {
  return <SalesDocScreen config={DC_RETURN_CONFIG} {...props} />;
}
