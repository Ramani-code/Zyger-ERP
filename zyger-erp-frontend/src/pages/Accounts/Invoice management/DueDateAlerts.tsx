import React from 'react';
import { AlertCircle, Clock } from 'lucide-react';
import { Invoice } from '../types';

export const DueDateAlerts: React.FC<{ invoices: Invoice[] }> = ({ invoices }) => {
    const overdueInvoices = invoices.filter(inv => new Date(inv.dueDate) < new Date() && inv.status !== 'Paid');

    return (
        <div className="bg-white border border-rose-200 rounded-xl overflow-hidden shadow-sm">
            <div className="bg-rose-50 px-4 py-3 border-b border-rose-100 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                <h3 className="text-sm font-bold text-rose-900">Overdue Invoices ({overdueInvoices.length})</h3>
            </div>
            <div className="divide-y divide-slate-100">
                {overdueInvoices.map(inv => (
                    <div key={inv.id} className="p-4 flex justify-between items-center hover:bg-slate-50 transition-colors">
                        <div>
                            <div className="font-semibold text-sm text-slate-900">{inv.customerName}</div>
                            <div className="text-xs text-slate-500 mt-1">{inv.invoiceNumber}</div>
                        </div>
                        <div className="text-right">
                            <div className="font-bold text-sm text-rose-600">₹{inv.grandTotal.toLocaleString('en-IN')}</div>
                            <div className="text-[11px] font-medium text-rose-500 flex items-center justify-end gap-1 mt-1">
                                <Clock className="w-3 h-3" /> Due {inv.dueDate}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};