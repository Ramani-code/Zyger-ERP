import React, { useState } from 'react';
import { CheckCircle2, DollarSign } from 'lucide-react';

interface PaymentStatusProps {
    invoiceId: string;
    currentStatus: 'Unpaid' | 'Partial' | 'Paid';
    onUpdatePayment: (id: string, amount: number, method: string) => void;
}

export const PaymentStatus: React.FC<PaymentStatusProps> = ({ invoiceId, currentStatus, onUpdatePayment }) => {
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState('Bank Transfer');

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
                <DollarSign className="w-4 h-4 text-emerald-600" /> Payment Collection
            </h3>

            <div className="flex gap-4 items-end">
                <div className="flex-1">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Amount Received (₹)</label>
                    <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm font-mono focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                    />
                </div>
                <div className="flex-1">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Payment Mode</label>
                    <select
                        value={method}
                        onChange={(e) => setMethod(e.target.value)}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                    >
                        <option>Bank Transfer</option>
                        <option>UPI</option>
                        <option>Cash</option>
                    </select>
                </div>
                <button
                    onClick={() => onUpdatePayment(invoiceId, Number(amount), method)}
                    className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 h-[38px]"
                >
                    Record Payment
                </button>
            </div>
        </div>
    );
};