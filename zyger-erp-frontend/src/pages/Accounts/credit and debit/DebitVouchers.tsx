import React, { useState, useMemo } from 'react';
import { Plus, Search, TrendingDown } from 'lucide-react';
import {type Voucher } from '../types';
import { VoucherTable } from './VoucherTable';
import { VoucherModal } from './VoucherModal';

interface Props {
    vouchers: Voucher[];
    onCreateVoucher: (v: Voucher) => void;
}

export const DebitVouchers: React.FC<Props> = ({ vouchers, onCreateVoucher }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [showModal, setShowModal] = useState(false);

    const debitVouchers = useMemo(() => vouchers.filter(v => v.type === 'Debit Voucher'), [vouchers]);
    const totalAmount = useMemo(() => debitVouchers.reduce((sum, v) => sum + v.amount, 0), [debitVouchers]);

    const filtered = useMemo(() => {
        const q = searchQuery.toLowerCase();
        return debitVouchers.filter(v =>
            v.voucherNumber.toLowerCase().includes(q) || v.partyName.toLowerCase().includes(q)
        );
    }, [debitVouchers, searchQuery]);

    return (
        <div className="space-y-6 text-slate-800 p-6">
            <div className="flex justify-between items-center bg-white p-6 rounded-2xl border shadow-sm">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <TrendingDown className="text-rose-500 w-6 h-6" /> Debit Vouchers
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Total: ₹{totalAmount.toLocaleString('en-IN')}</p>
                </div>
                <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2 bg-rose-600 text-white rounded-xl hover:bg-rose-700">
                    <Plus className="w-4 h-4" /> New Debit
                </button>
            </div>

            <div className="bg-white rounded-t-2xl border-x border-t border-slate-200/80 p-4">
                <div className="relative w-72">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search debits..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm"
                    />
                </div>
            </div>

            <VoucherTable vouchers={filtered} />
            <VoucherModal isOpen={showModal} onClose={() => setShowModal(false)} onCreateVoucher={onCreateVoucher} voucherType="Debit Voucher" currentCount={vouchers.length} />
        </div>
    );
};