// components/AccountsReceivable/DueInvoiceSchedule.tsx
import React, { useMemo } from 'react';
import { CustomerOutstanding } from '../../types'; // Adjust path to types as needed
import { formatCurrency } from './utils';

interface DueInvoiceScheduleProps {
    customers: CustomerOutstanding[];
}

export const DueInvoiceSchedule: React.FC<DueInvoiceScheduleProps> = ({ customers }) => {
    const total0to30 = useMemo(() => customers.reduce((sum, c) => sum + c.bucket0to30, 0), [customers]);
    const total31to60 = useMemo(() => customers.reduce((sum, c) => sum + c.bucket31to60, 0), [customers]);
    const total61to90 = useMemo(() => customers.reduce((sum, c) => sum + c.bucket61to90, 0), [customers]);
    const total90Plus = useMemo(() => customers.reduce((sum, c) => sum + c.bucket90Plus, 0), [customers]);

    return (
        <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-3">
            <h2 className="text-sm font-bold text-slate-900">
                Aging Summary
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-medium text-slate-600 block">0 - 30 Days</span>
                    <span className="text-base font-bold text-slate-900 mt-1 block">
            {formatCurrency(total0to30)}
          </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-medium text-slate-600 block">31 - 60 Days</span>
                    <span className="text-base font-bold text-slate-900 mt-1 block">
            {formatCurrency(total31to60)}
          </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-medium text-slate-600 block">61 - 90 Days</span>
                    <span className="text-base font-bold text-slate-900 mt-1 block">
            {formatCurrency(total61to90)}
          </span>
                </div>
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-100">
                    <span className="text-[11px] font-medium text-rose-700 block">90+ Days</span>
                    <span className="text-base font-bold text-rose-700 mt-1 block">
            {formatCurrency(total90Plus)}
          </span>
                </div>
            </div>
        </div>
    );
};