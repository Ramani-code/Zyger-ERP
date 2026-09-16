import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatNumber } from '../../../../utils/format';

interface StoreMovementBarChartProps {
  data: { storeCode: string; storeName: string; received: number; issued: number }[];
}

export default function StoreMovementBarChart({ data }: StoreMovementBarChartProps) {
  const sorted = [...data].sort((a, b) => (b.received + b.issued) - (a.received + a.issued));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={sorted} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="storeName" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(Number(v) || 0)} />
        <Tooltip formatter={(v) => formatNumber(Number(v) || 0)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="received" name="Received" fill="var(--green, #28c76f)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="issued" name="Issued" fill="var(--blue, #007bd6)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
