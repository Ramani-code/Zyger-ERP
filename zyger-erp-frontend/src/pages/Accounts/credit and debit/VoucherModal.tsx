import React, { useState } from 'react';
import { X } from 'lucide-react';
import {type Voucher } from '../types';

interface VoucherModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreateVoucher: (voucher: Voucher) => void;
    voucherType: 'Debit Voucher' | 'Credit Voucher' | 'Journal Entry';
    currentCount: number;
}

export const VoucherModal: React.FC<VoucherModalProps> = ({
                                                              isOpen,
                                                              onClose,
                                                              onCreateVoucher,
                                                              voucherType,
                                                              currentCount
                                                          }) => {
    const [partyName, setPartyName] = useState('');
    const [accountHead, setAccountHead] = useState('');
    const [amount, setAmount] = useState<number | ''>('');
    const [narration, setNarration] = useState('');

    if (!isOpen) return null;

    const handleSaveVoucher = (e: React.FormEvent) => {
        e.preventDefault();
        if (!partyName || !amount || Number(amount) <= 0) return;

        const prefix =
            voucherType === 'Debit Voucher' ? 'DBV' : voucherType === 'Credit Voucher' ? 'CRV' : 'JRN';
        const formattedDate = new Date().toISOString().split('T')[0];

        const newVoucher: Voucher = {
            id: `v-${Date.now()}`,
            voucherNumber: `${prefix}-2026-${String(currentCount + 1).padStart(3, '0')}`,
            date: formattedDate,
            type: voucherType,
            partyName,
            accountHead: accountHead || 'General Adjustment',
            amount: Number(amount),
            narration,
            preparedBy: 'Finance User',
            status: 'Approved',
        };

        onCreateVoucher(newVoucher);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white border border-slate-200/80 rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900">New {voucherType}</h2>
                        <p className="text-xs text-slate-500 mt-0.5">Record a new entry.</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:bg-slate-100 p-1 rounded-lg">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSaveVoucher} className="space-y-4 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-slate-700 font-semibold mb-1.5">Party Name *</label>
                            <input
                                type="text"
                                required
                                value={partyName}
                                onChange={(e) => setPartyName(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5"
                            />
                        </div>
                        <div>
                            <label className="block text-slate-700 font-semibold mb-1.5">Account Head</label>
                            <input
                                type="text"
                                value={accountHead}
                                onChange={(e) => setAccountHead(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-slate-700 font-semibold mb-1.5">Amount (₹) *</label>
                        <input
                            type="number"
                            required
                            min="1"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : '')}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 font-mono"
                        />
                    </div>
                    <div>
                        <label className="block text-slate-700 font-semibold mb-1.5">Narration</label>
                        <textarea
                            rows={3}
                            value={narration}
                            onChange={(e) => setNarration(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5"
                        />
                    </div>
                    <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                        <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-semibold">Cancel</button>
                        <button type="submit" className="px-5 py-2 rounded-xl bg-slate-900 text-white font-semibold">Save Voucher</button>
                    </div>
                </form>
            </div>
        </div>
    );
};