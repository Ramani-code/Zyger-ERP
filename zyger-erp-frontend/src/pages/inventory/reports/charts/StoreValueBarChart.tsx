import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '../../../../utils/format';

interface StoreValueBarChartProps {
  data: { storeCode: string; storeName: string; totalValue: number }[];
}

export default function StoreValueBarChart({ data }: StoreValueBarChartProps) {
  const sorted = [...data].sort((a, b) => b.totalValue - a.totalValue);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={sorted} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="storeName" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatCurrency(v)} width={80} />
        <Tooltip formatter={(v) => formatCurrency(Number(v) || 0)} />
        <Bar dataKey="totalValue" name="Stock Value" fill="#007bd6" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
