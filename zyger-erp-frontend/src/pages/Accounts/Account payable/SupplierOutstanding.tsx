import React from 'react';
import {
    Building2,
    AlertCircle,
    CreditCard,
    ExternalLink,
    FileText,
    ArrowUpRight
} from 'lucide-react';

// Assumed Types (Move to your ../types file)
export interface SupplierOutstandingData {
    id: string;
    name: string;
    code: string;
    totalOutstanding: number;
    creditLimit: number;
    bucket0to30: number;
    bucket31to60: number;
    bucket61to90: number;
    bucket90Plus: number;
    paymentStatus: 'Overdue' | 'Due Soon' | 'Normal';
}

interface SupplierOutstandingProps {
    suppliers: SupplierOutstandingData[];
    onNavigate: (tabId: string, title: string) => void;
    onOpenPaymentModal: (supplier?: SupplierOutstandingData) => void;
}

export const SupplierOutstanding: React.FC<SupplierOutstandingProps> = ({
                                                                            suppliers = [],
                                                                            onNavigate,
                                                                            onOpenPaymentModal,
                                                                        }) => {
    const totalPayables = suppliers.reduce((sum, s) => sum + s.totalOutstanding, 0);
    const total0to30 = suppliers.reduce((sum, s) => sum + s.bucket0to30, 0);
    const total31to60 = suppliers.reduce((sum, s) => sum + s.bucket31to60, 0);
    const total61to90 = suppliers.reduce((sum, s) => sum + s.bucket61to90, 0);
    const total90Plus = suppliers.reduce((sum, s) => sum + s.bucket90Plus, 0);

    const overdueSuppliers = suppliers.filter(s => s.paymentStatus === 'Overdue');
    const overdueTotal = overdueSuppliers.reduce((sum, s) => sum + s.totalOutstanding, 0); // Simplified for example

    const formatCurrency = (amt: number) => '₹' + amt.toLocaleString('en-IN');

    return (
        <div className="space-y-6 bg-white p-6 rounded-xl text-black">
            {/* Header & Quick Actions */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Accounts Payable</h1>
                    <p className="text-xs text-slate-500 mt-1">
                        Overview of supplier balances, pending bills, and aging breakdown.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => onNavigate('due-bill-registry', 'Due Bills')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold border border-slate-200 transition-all"
                    >
                        <FileText className="w-4 h-4" />
                        <span>View All Bills</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => onOpenPaymentModal()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-all"
                    >
                        <ArrowUpRight className="w-4 h-4" />
                        <span>Make Payment</span>
                    </button>
                </div>
            </div>

            {/* Primary Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition-all">
                    <div className="flex items-center justify-between text-slate-600 text-xs mb-1">
                        <span className="font-semibold text-slate-700">Total Outstanding (Creditors)</span>
                        <Building2 className="w-4 h-4 text-slate-500" />
                    </div>
                    <div className="text-2xl font-bold text-slate-900 tracking-tight mt-1">
                        {formatCurrency(totalPayables)}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-2">Across {suppliers.length} suppliers</p>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 hover:border-rose-300 transition-all">
                    <div className="flex items-center justify-between text-slate-600 text-xs mb-1">
                        <span className="font-semibold text-rose-700">Overdue Payables</span>
                        <AlertCircle className="w-4 h-4 text-rose-600" />
                    </div>
                    <div className="text-2xl font-bold text-rose-600 tracking-tight mt-1">
                        {formatCurrency(overdueTotal)}
                    </div>
                    <p className="text-[11px] text-rose-600 font-medium mt-2">
                        Requires immediate attention
                    </p>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between text-slate-600 text-xs mb-1">
                        <span className="font-semibold text-slate-700">Average Payable Days</span>
                        <CreditCard className="w-4 h-4 text-slate-500" />
                    </div>
                    <div className="text-2xl font-bold text-slate-900 tracking-tight mt-1">42 Days</div>
                    <p className="text-[11px] text-slate-500 mt-2">Based on the last 30 days</p>
                </div>
            </div>

            {/* Aging Summary Grid */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-3">
                <h2 className="text-sm font-bold text-slate-900">Payables Aging Summary</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <span className="text-[11px] font-medium text-slate-600 block">0 - 30 Days</span>
                        <span className="text-base font-bold text-slate-900 mt-1 block">{formatCurrency(total0to30)}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <span className="text-[11px] font-medium text-slate-600 block">31 - 60 Days</span>
                        <span className="text-base font-bold text-slate-900 mt-1 block">{formatCurrency(total31to60)}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <span className="text-[11px] font-medium text-slate-600 block">61 - 90 Days</span>
                        <span className="text-base font-bold text-slate-900 mt-1 block">{formatCurrency(total61to90)}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-rose-50 border border-rose-100">
                        <span className="text-[11px] font-medium text-rose-700 block">90+ Days</span>
                        <span className="text-base font-bold text-rose-700 mt-1 block">{formatCurrency(total90Plus)}</span>
                    </div>
                </div>
            </div>

            {/* Supplier Balances Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                    <h2 className="text-sm font-bold text-slate-900">Supplier Balances</h2>
                    <button className="text-xs text-blue-600 hover:underline font-medium flex items-center gap-1">
                        <span>Export List</span>
                        <ExternalLink className="w-3 h-3" />
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                        <tr>
                            <th className="px-4 py-3">Supplier Name</th>
                            <th className="px-4 py-3 text-right">Outstanding (₹)</th>
                            <th className="px-4 py-3 text-right">Credit Terms</th>
                            <th className="px-4 py-3 text-center">Status</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                        {suppliers.map((sup) => (
                            <tr key={sup.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-3 font-medium text-slate-900">
                                    <div>{sup.name}</div>
                                    <div className="text-[10px] text-slate-500">{sup.code}</div>
                                </td>
                                <td className="px-4 py-3 text-right font-semibold text-slate-900 font-mono">
                                    {formatCurrency(sup.totalOutstanding)}
                                </td>
                                <td className="px-4 py-3 text-right text-slate-600">
                                    {formatCurrency(sup.creditLimit)} limit
                                </td>
                                <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                        sup.paymentStatus === 'Overdue' ? 'bg-rose-100 text-rose-800' :
                            sup.paymentStatus === 'Due Soon' ? 'bg-amber-100 text-amber-800' :
                                'bg-emerald-100 text-emerald-800'
                    }`}>
                      {sup.paymentStatus}
                    </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <button
                                        onClick={() => onOpenPaymentModal(sup)}
                                        className="px-3 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white text-[11px] transition-colors"
                                    >
                                        Pay Now
                                    </button>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};