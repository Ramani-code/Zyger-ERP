import React from 'react';
import { misData } from '../data/mockData';

interface ProfitAndLossProps {
    fiscalQuarter: 'q1' | 'q2' | 'ytd';
    formatCurrency: (amt: number) => string;
}

export const ProfitAndLoss: React.FC<ProfitAndLossProps> = ({
                                                                fiscalQuarter,
                                                                formatCurrency
                                                            }) => {
    const totalRev = misData.profitAndLoss.revenue.reduce((sum, r) => sum + r[fiscalQuarter], 0);
    const totalCogs = misData.profitAndLoss.costOfGoods.reduce((sum, r) => sum + r[fiscalQuarter], 0);
    const grossProfit = totalRev - totalCogs;
    const grossMargin = totalRev > 0 ? ((grossProfit / totalRev) * 100).toFixed(1) : '0';

    const totalOpex = misData.profitAndLoss.operatingExpenses.reduce((sum, r) => sum + r[fiscalQuarter], 0);
    const netOperatingProfit = grossProfit - totalOpex;
    const netMargin = totalRev > 0 ? ((netOperatingProfit / totalRev) * 100).toFixed(1) : '0';

    return (
        <div className="space-y-6">
            {/* Executive KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <span className="text-xs text-slate-600 font-medium">Total Operating Revenue</span>
                    <div className="text-xl font-bold text-black mt-1">{formatCurrency(totalRev)}</div>
                    <span className="text-[10px] text-emerald-700 font-mono mt-1 block font-semibold">+16.4% YoY Growth</span>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <span className="text-xs text-slate-600 font-medium">Gross Manufacturing Profit</span>
                    <div className="text-xl font-bold text-emerald-700 mt-1">{formatCurrency(grossProfit)}</div>
                    <span className="text-[10px] text-emerald-800 font-mono mt-1 block font-medium">{grossMargin}% Gross Margin</span>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <span className="text-xs text-slate-600 font-medium">Operating Expenses (OPEX)</span>
                    <div className="text-xl font-bold text-black mt-1">{formatCurrency(totalOpex)}</div>
                    <span className="text-[10px] text-slate-600 font-mono mt-1 block">Plant & Admin Overheads</span>
                </div>

                <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200 shadow-sm">
                    <span className="text-xs text-emerald-800 font-semibold">Net Operating Profit</span>
                    <div className="text-xl font-bold text-emerald-800 mt-1">{formatCurrency(netOperatingProfit)}</div>
                    <span className="text-[10px] text-emerald-700 font-mono mt-1 block font-medium">{netMargin}% Net Margin</span>
                </div>
            </div>

            {/* Detailed Statement Table */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-6 shadow-sm">
                <div className="text-xs font-semibold text-black uppercase tracking-wider border-b border-slate-200 pb-2">
                    Income & Revenue Stream
                </div>
                <div className="space-y-2 text-xs">
                    {misData.profitAndLoss.revenue.map(r => (
                        <div key={r.category} className="flex justify-between py-1 text-black hover:bg-slate-50 px-2 rounded">
                            <span>{r.category}</span>
                            <span className="font-mono font-medium text-black">{formatCurrency(r[fiscalQuarter])}</span>
                        </div>
                    ))}
                    <div className="flex justify-between py-2 font-bold text-black border-t border-slate-200 px-2">
                        <span>Total Operating Revenue</span>
                        <span className="text-emerald-700 font-mono">{formatCurrency(totalRev)}</span>
                    </div>
                </div>

                <div className="text-xs font-semibold text-black uppercase tracking-wider border-b border-slate-200 pb-2 pt-4">
                    Cost of Goods Sold (Direct Production)
                </div>
                <div className="space-y-2 text-xs">
                    {misData.profitAndLoss.costOfGoods.map(c => (
                        <div key={c.category} className="flex justify-between py-1 text-black hover:bg-slate-50 px-2 rounded">
                            <span>{c.category}</span>
                            <span className="font-mono font-medium text-black">{formatCurrency(c[fiscalQuarter])}</span>
                        </div>
                    ))}
                    <div className="flex justify-between py-2 font-bold text-black border-t border-slate-200 px-2">
                        <span>Total COGS</span>
                        <span className="font-mono text-black">{formatCurrency(totalCogs)}</span>
                    </div>
                </div>

                <div className="text-xs font-semibold text-black uppercase tracking-wider border-b border-slate-200 pb-2 pt-4">
                    Operating Expenses (Administrative & Logistics)
                </div>
                <div className="space-y-2 text-xs">
                    {misData.profitAndLoss.operatingExpenses.map(o => (
                        <div key={o.category} className="flex justify-between py-1 text-black hover:bg-slate-50 px-2 rounded">
                            <span>{o.category}</span>
                            <span className="font-mono font-medium text-black">{formatCurrency(o[fiscalQuarter])}</span>
                        </div>
                    ))}
                    <div className="flex justify-between py-2 font-bold text-black border-t border-slate-200 px-2">
                        <span>Total OPEX</span>
                        <span className="font-mono text-black">{formatCurrency(totalOpex)}</span>
                    </div>
                </div>

                {/* Bottom Final Net Result */}
                <div className="bg-emerald-50/80 p-4 rounded-xl border border-emerald-200 flex justify-between items-center text-sm font-bold text-black">
                    <div>
                        <span>Net Operating Profit before Tax (EBT)</span>
                        <div className="text-xs font-normal text-slate-600 mt-0.5">Automated calculation per Indian Accounting Standards (Ind AS)</div>
                    </div>
                    <span className="text-lg text-emerald-800 font-mono font-bold">{formatCurrency(netOperatingProfit)}</span>
                </div>
            </div>
        </div>
    );
};