import React from 'react';
import { Printer, FileText, CheckCircle2 } from 'lucide-react';
import {type Voucher } from '../types';

interface VoucherTableProps {
    vouchers: Voucher[];
}

export const VoucherTable: React.FC<VoucherTableProps> = ({ vouchers }) => {
    const formatCurrency = (amt: number) => '₹' + Number(amt || 0).toLocaleString('en-IN');

    if (vouchers.length === 0) {
        return (
            <div className="py-12 text-center text-slate-400 bg-white rounded-b-2xl border-x border-b border-slate-200/80">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium text-slate-600">No vouchers found</p>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto bg-white rounded-b-2xl border-x border-b border-slate-200/80">
            <table className="w-full text-left text-xs">
                <thead>
                <tr className="bg-slate-50/50 text-slate-500 border-b border-slate-100 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="px-5 py-3.5">Voucher Details</th>
                    <th className="px-5 py-3.5">Type</th>
                    <th className="px-5 py-3.5">Party & Account Head</th>
                    <th className="px-5 py-3.5">Narration / Notes</th>
                    <th className="px-5 py-3.5 text-right">Amount</th>
                    <th className="px-5 py-3.5 text-center">Status</th>
                    <th className="px-5 py-3.5 text-right">Action</th>
                </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                {vouchers.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50/80 transition-colors group">
                        <td className="px-5 py-4">
                            <div className="font-mono font-semibold text-slate-900">{v.voucherNumber}</div>
                            <div className="text-[11px] text-slate-400 mt-0.5">{v.date}</div>
                        </td>
                        <td className="px-5 py-4 font-semibold">{v.type}</td>
                        <td className="px-5 py-4">
                            <div className="font-semibold text-slate-900">{v.partyName}</div>
                            <div className="text-[11px] text-slate-400 mt-0.5">{v.accountHead}</div>
                        </td>
                        <td className="px-5 py-4 max-w-xs truncate text-slate-600">{v.narration || '—'}</td>
                        <td className="px-5 py-4 text-right font-mono font-bold text-slate-900 text-sm">
                            {formatCurrency(v.amount)}
                        </td>
                        <td className="px-5 py-4 text-center">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                            <button onClick={() => alert(`Printing: ${v.voucherNumber}`)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900">
                                <Printer className="w-4 h-4" />
                            </button>
                        </td>
                    </tr>
                ))}
                </tbody>
            </table>
        </div>
    );
};