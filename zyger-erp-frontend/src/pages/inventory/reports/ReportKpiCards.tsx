import { KPI_CARDS, type KpiCardConfig } from './reportsConfig';
import type { ReportsOverviewKpis } from '../../../types/inventory/reports.types';
import { formatCurrency, formatNumber } from '../../../utils/format';

interface ReportKpiCardsProps {
  kpis?: ReportsOverviewKpis;
  onCardClick: (card: KpiCardConfig) => void;
}

export default function ReportKpiCards({
  kpis,
  onCardClick,
}: ReportKpiCardsProps) {
  const valueFor = (card: KpiCardConfig): string => {
    const raw = (kpis as Record<string, number> | undefined)?.[card.key] ?? 0;

    return card.format === 'money' ? formatCurrency(raw) : formatNumber(raw);
  };

  return (
    <div className="ir-kpi-grid">
      {KPI_CARDS.map((card) => (
        <button
          key={card.key}
          type="button"
          className="ir-kpi-tile"
          onClick={() => onCardClick(card)}
          title={`Open ${card.label} details`}
        >
          <div className="ir-kpi-top">
            <span className="ir-kpi-label">{card.label}</span>
            <span
              className="ir-kpi-ic"
              style={{ color: card.color, background: `color-mix(in srgb, ${card.color} 16%, transparent)` }}
            >
              <span className="material-symbols-rounded">{card.icon}</span>
            </span>
          </div>
          <div className="ir-kpi-value">{kpis ? valueFor(card) : '—'}</div>
        </button>
      ))}
    </div>
  );
}