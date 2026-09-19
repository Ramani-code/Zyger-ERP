// components/AccountsReceivable/CustomerOutstandingTable.tsx
import React from 'react';
import { ExternalLink, Send } from 'lucide-react';
import { CustomerOutstanding, Invoice, TabId } from '../../types'; // Adjust path to types as needed
import { formatCurrency } from './utils';

interface CustomerOutstandingTableProps {
    customers: CustomerOutstanding[];
    onNavigate: (tabId: TabId, title: string) => void;
    onOpenPaymentModal: (customer?: CustomerOutstanding) => void;
    onOpenReminderModal: (invoice?: Invoice, customer?: CustomerOutstanding) => void;
}

export const CustomerOutstandingTable: React.FC<CustomerOutstandingTableProps> = ({
                                                                                      customers,
                                                                                      onNavigate,
                                                                                      onOpenPaymentModal,
                                                                                      onOpenReminderModal
                                                                                  }) => {
    return (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <h2 className="text-sm font-bold text-slate-900">
                    Customer Balances
                </h2>
                <button
                    type="button"
                    onClick={() => onNavigate('customer-outstanding', 'Customer Outstanding')}
                    className="text-xs text-blue-600 hover:underline font-medium flex items-center gap-1"
                >
                    <span>View All</span>
                    <ExternalLink className="w-3 h-3" />
                </button>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                        <th className="px-4 py-3">Customer Name</th>
                        <th className="px-4 py-3 text-right">Outstanding</th>
                        <th className="px-4 py-3 text-right">Credit Limit</th>
                        <th className="px-4 py-3 text-center">Status</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                    {customers.map((cust) => (
                        <tr key={cust.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-slate-900">
                                <div>{cust.name}</div>
                                <div className="text-[10px] text-slate-500">{cust.code}</div>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                {formatCurrency(cust.totalOutstanding)}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-600">
                                {formatCurrency(cust.creditLimit)}
                            </td>
                            <td className="px-4 py-3 text-center">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                      cust.paymentStatus === 'Overdue'
                          ? 'bg-rose-100 text-rose-800'
                          : cust.paymentStatus === 'Due Soon'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {cust.paymentStatus}
                  </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => onOpenReminderModal(undefined, cust)}
                                        className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] transition-colors flex items-center gap-1 border border-slate-200"
                                    >
                                        <Send className="w-3 h-3 text-slate-500" />
                                        <span>Remind</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onOpenPaymentModal(cust)}
                                        className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white text-[11px] transition-colors"
                                    >
                                        Collect
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};