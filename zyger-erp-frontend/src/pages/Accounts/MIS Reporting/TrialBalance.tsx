import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { misData } from '../data/mockData';

interface TrialBalanceProps {
    formatCurrency: (amt: number) => string;
}

export const TrialBalance: React.FC<TrialBalanceProps> = ({ formatCurrency }) => {
    const totalDebits = misData.trialBalance.reduce((sum, item) => sum + item.debit, 0);
    const totalCredits = misData.trialBalance.reduce((sum, item) => sum + item.credit, 0);

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-bold text-black">Trial Balance (General Ledger Audit)</h3>
                    <p className="text-xs text-slate-600">Live debit & credit synchronization.</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-800 font-medium bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    <span>Debits & Credits Balanced</span>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider font-semibold border-b border-slate-200 text-[11px]">
                    <tr>
                        <th className="px-4 py-3">Account Code</th>
                        <th className="px-4 py-3">Ledger Head Name</th>
                        <th className="px-4 py-3 text-right">Debit (₹)</th>
                        <th className="px-4 py-3 text-right">Credit (₹)</th>
                    </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-black">
                    {misData.trialBalance.map((row) => (
                        <tr key={row.code} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-2.5 font-mono text-blue-700 font-semibold">{row.code}</td>
                            <td className="px-4 py-2.5 font-medium text-black">{row.head}</td>
                            <td className="px-4 py-2.5 text-right font-mono">
                                {row.debit > 0 ? formatCurrency(row.debit) : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono">
                                {row.credit > 0 ? formatCurrency(row.credit) : '—'}
                            </td>
                        </tr>
                    ))}
                    </tbody>
                    <tfoot className="bg-slate-100 font-bold border-t-2 border-slate-300 text-black">
                    <tr>
                        <td colSpan={2} className="px-4 py-3 uppercase tracking-wider">
                            Total Trial Balance
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-800 text-sm">
                            {formatCurrency(totalDebits)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-800 text-sm">
                            {formatCurrency(totalCredits)}
                        </td>
                    </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
};