import React, { useState } from 'react';
import { BarChart3, FileSpreadsheet, BookOpen, Download, Printer } from 'lucide-react';
import { ProfitAndLoss } from './ProfitAndLoss';
import { BalanceSheet } from './BalanceSheet';
import { TrialBalance } from './TrialBalance';

interface MISReportsViewProps {
    initialReport?: 'pnl' | 'balance-sheet' | 'trial-balance';
}

export const MISReportsView: React.FC<MISReportsViewProps> = ({
                                                                  initialReport = 'pnl'
                                                              }) => {
    const [activeReport, setActiveReport] = useState<'pnl' | 'balance-sheet' | 'trial-balance'>(initialReport);
    const [fiscalQuarter, setFiscalQuarter] = useState<'q1' | 'q2' | 'ytd'>('ytd');

    // Shared utility passed to child components
    const formatCurrency = (amt: number) => '₹' + amt.toLocaleString('en-IN');

    return (
        <div id="mis-financial-reports" className="space-y-6 text-black bg-white min-h-screen p-4">
            {/* Top Banner */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                    <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-mono text-[11px] font-semibold">
              8. MIS & FINANCIAL STATEMENTS
            </span>
                        <span className="text-slate-400">•</span>
                        <span className="text-xs text-slate-600">Statutory & Management Audits</span>
                    </div>
                    <h1 className="text-xl font-bold text-black tracking-tight mt-1">
                        Real-Time Financial Reporting Dashboard
                    </h1>
                    <p className="text-xs text-slate-600">
                        Automated Profit & Loss, Balance Sheet, and Trial Balance from live general ledger postings.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => window.print()}
                        className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-800 text-xs font-medium border border-slate-300 flex items-center gap-1.5 transition-colors shadow-sm"
                    >
                        <Printer className="w-3.5 h-3.5 text-blue-600" />
                        <span>Print Report</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => alert('Downloading Financial Statement as Spreadsheet...')}
                        className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-md flex items-center gap-1.5 transition-colors"
                    >
                        <Download className="w-3.5 h-3.5" />
                        <span>Export Statement</span>
                    </button>
                </div>
            </div>

            {/* Navigation sub-tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2 text-xs font-medium">
                    <button
                        type="button"
                        onClick={() => setActiveReport('pnl')}
                        className={`px-3.5 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                            activeReport === 'pnl'
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-slate-700 hover:text-black bg-slate-100'
                        }`}
                    >
                        <BarChart3 className="w-3.5 h-3.5" />
                        <span>8.1 Profit & Loss Statement</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveReport('balance-sheet')}
                        className={`px-3.5 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                            activeReport === 'balance-sheet'
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-slate-700 hover:text-black bg-slate-100'
                        }`}
                    >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        <span>8.2 Balance Sheet</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveReport('trial-balance')}
                        className={`px-3.5 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                            activeReport === 'trial-balance'
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-slate-700 hover:text-black bg-slate-100'
                        }`}
                    >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>8.3 Trial Balance</span>
                    </button>
                </div>

                {activeReport === 'pnl' && (
                    <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
                        <span className="text-slate-600 px-2 text-[11px] font-medium">Period:</span>
                        <button
                            type="button"
                            onClick={() => setFiscalQuarter('q1')}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium ${fiscalQuarter === 'q1' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-200'}`}
                        >
                            Q1
                        </button>
                        <button
                            type="button"
                            onClick={() => setFiscalQuarter('q2')}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium ${fiscalQuarter === 'q2' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-200'}`}
                        >
                            Q2
                        </button>
                        <button
                            type="button"
                            onClick={() => setFiscalQuarter('ytd')}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium ${fiscalQuarter === 'ytd' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-200'}`}
                        >
                            YTD (FY 2026-27)
                        </button>
                    </div>
                )}
            </div>

            {/* View Rendering */}
            {activeReport === 'pnl' && (
                <ProfitAndLoss fiscalQuarter={fiscalQuarter} formatCurrency={formatCurrency} />
            )}

            {activeReport === 'balance-sheet' && (
                <BalanceSheet />
            )}

            {activeReport === 'trial-balance' && (
                <TrialBalance formatCurrency={formatCurrency} />
            )}
        </div>
    );
};