import React from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { Invoice } from '../types';

interface InvoiceApprovalProps {
    invoice: Invoice;
    onApprove: (id: string) => void;
    onReject: (id: string) => void;
}

export const InvoiceApproval: React.FC<InvoiceApprovalProps> = ({ invoice, onApprove, onReject }) => {
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between shadow-sm">
            <div>
                <h3 className="text-sm font-bold text-slate-900">Pending Approval: {invoice.invoiceNumber}</h3>
                <p className="text-xs text-slate-500 mt-1">Submitted by Finance Team • Total: ₹{invoice.grandTotal.toLocaleString('en-IN')}</p>
            </div>
            <div className="flex gap-2">
                <button
                    onClick={() => onReject(invoice.id)}
                    className="px-3 py-1.5 border border-rose-200 bg-rose-50 text-rose-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 hover:bg-rose-100"
                >
                    <XCircle className="w-4 h-4" /> Reject
                </button>
                <button
                    onClick={() => onApprove(invoice.id)}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 hover:bg-emerald-700"
                >
                    <CheckCircle className="w-4 h-4" /> Approve
                </button>
            </div>
        </div>
    );
};