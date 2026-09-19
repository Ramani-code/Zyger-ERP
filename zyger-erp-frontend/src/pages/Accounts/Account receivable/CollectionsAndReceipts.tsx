// components/AccountsReceivable/CollectionsAndReceipts.tsx
import React, { useMemo } from 'react';
import { Users, AlertCircle, PlusCircle, CreditCard, DollarSign } from 'lucide-react';
import { CustomerOutstanding, Invoice, TabId } from '../../types'; // Adjust path to types as needed
import { formatCurrency } from './utils';

interface CollectionsAndReceiptsProps {
    customers: CustomerOutstanding[];
    invoices: Invoice[];
    onNavigate: (tabId: TabId, title: string) => void;
    onOpenPaymentModal: (customer?: CustomerOutstanding) => void;
}

export const CollectionsAndReceipts: React.FC<CollectionsAndReceiptsProps> = ({
                                                                                  customers,
                                                                                  invoices,
                                                                                  onNavigate,
                                                                                  onOpenPaymentModal,
                                                                              }) => {
    const totalReceivables = useMemo(
        () => customers.reduce((sum, c) => sum + c.totalOutstanding, 0),
        [customers]
    );

    const overdueInvoices = useMemo(
        () => invoices.filter(inv => inv.status === 'Overdue'),
        [invoices]
    );

    const overdueTotal = useMemo(
        () => overdueInvoices.reduce((sum, inv) => sum + inv.balanceDue, 0),
        [overdueInvoices]
    );

    return (
        <>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                        Accounts Receivable
                    </h1>
                    <p className="text-xs text-slate-500 mt-1">
                        Overview of customer balances, overdue payments, and aging breakdown.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => onNavigate('create-invoice', 'Create Invoice')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
                    >
                        <PlusCircle className="w-4 h-4" />
                        <span>Create Invoice</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => onOpenPaymentModal()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
                    >
                        <CreditCard className="w-4 h-4" />
                        <span>Record Payment</span>
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div
                    onClick={() => onNavigate('customer-outstanding', 'Customer Outstanding')}
                    className="bg-slate-50 p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition-all cursor-pointer"
                >
                    <div className="flex items-center justify-between text-slate-600 text-xs mb-1">
                        <span className="font-semibold text-slate-700">Total Outstanding</span>
                        <Users className="w-4 h-4 text-slate-500" />
                    </div>
                    <div className="text-2xl font-bold text-slate-900 tracking-tight mt-1">
                        {formatCurrency(totalReceivables)}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-2">
                        Across {customers.length} customer accounts
                    </p>
                </div>

                <div
                    onClick={() => onNavigate('due-invoices', 'Due Invoices')}
                    className="bg-slate-50 p-4 rounded-xl border border-slate-200 hover:border-rose-300 transition-all cursor-pointer"
                >
                    <div className="flex items-center justify-between text-slate-600 text-xs mb-1">
                        <span className="font-semibold text-rose-700">Overdue Amount</span>
                        <AlertCircle className="w-4 h-4 text-rose-600" />
                    </div>
                    <div className="text-2xl font-bold text-rose-600 tracking-tight mt-1">
                        {formatCurrency(overdueTotal)}
                    </div>
                    <p className="text-[11px] text-rose-600 font-medium mt-2">
                        {overdueInvoices.length} unpaid overdue invoice(s)
                    </p>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between text-slate-600 text-xs mb-1">
                        <span className="font-semibold text-slate-700">Average Collection Period</span>
                        <DollarSign className="w-4 h-4 text-slate-500" />
                    </div>
                    <div className="text-2xl font-bold text-slate-900 tracking-tight mt-1">
                        34 Days
                    </div>
                    <p className="text-[11px] text-slate-500 mt-2">
                        Based on the last 30 days
                    </p>
                </div>
            </div>
        </>
    );
};