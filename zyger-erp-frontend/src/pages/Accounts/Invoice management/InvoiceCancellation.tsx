import React, { useState } from 'react';
import { AlertOctagon, X } from 'lucide-react';

interface CancellationProps {
    invoiceId: string;
    onClose: () => void;
    onConfirmCancel: (id: string, reason: string) => void;
}

export const InvoiceCancellation: React.FC<CancellationProps> = ({ invoiceId, onClose, onConfirmCancel }) => {
    const [reason, setReason] = useState('');

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-2 text-rose-600">
                        <AlertOctagon className="w-5 h-5" />
                        <h2 className="text-base font-bold">Cancel Invoice</h2>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                </div>
                <p className="text-xs text-slate-600 mb-4">
                    Canceling this invoice will invalidate it. If an IRN was generated, it must be canceled on the E-Invoice portal within 24 hours.
                </p>
                <textarea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason for cancellation..."
                    className="w-full p-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-rose-500/20 mb-4"
                />
                <div className="flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">Close</button>
                    <button
                        onClick={() => onConfirmCancel(invoiceId, reason)}
                        disabled={!reason}
                        className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                    >
                        Confirm Cancellation
                    </button>
                </div>
            </div>
        </div>
    );
};