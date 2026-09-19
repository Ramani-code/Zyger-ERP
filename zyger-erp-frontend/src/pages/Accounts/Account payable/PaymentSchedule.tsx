import React from 'react';
import { CalendarClock, CheckCircle, Clock } from 'lucide-react';

export interface ScheduledPayment {
    id: string;
    supplierName: string;
    billNumber: string;
    amount: number;
    scheduledDate: string;
    bankAccount: string;
    status: 'Awaiting Approval' | 'Approved' | 'Processing';
}

interface PaymentScheduleProps {
    scheduledPayments: ScheduledPayment[];
}

export const PaymentSchedule: React.FC<PaymentScheduleProps> = ({ scheduledPayments = [] }) => {
    const formatCurrency = (amt: number) => '₹' + amt.toLocaleString('en-IN');

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm text-black">
            <div className="p-5 border-b border-slate-200 bg-slate-50/50 rounded-t-xl">
                <div className="flex items-center gap-2">
                    <CalendarClock className="w-5 h-5 text-blue-600" />
                    <h2 className="text-lg font-bold text-slate-900">Upcoming Payment Schedule</h2>
                </div>
                <p className="text-xs text-slate-500 mt-1 pl-7">Review and approve scheduled outbound transfers.</p>
            </div>

            <div className="p-5">
                <div className="space-y-4">
                    {scheduledPayments.map((payment) => (
                        <div key={payment.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-blue-300 transition-colors bg-white shadow-sm gap-4">
                            <div className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex flex-col items-center justify-center text-slate-700">
                                    <span className="text-[10px] font-bold uppercase leading-none">{new Date(payment.scheduledDate).toLocaleString('default', { month: 'short' })}</span>
                                    <span className="text-sm font-bold leading-none mt-1">{new Date(payment.scheduledDate).getDate()}</span>
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-slate-900">{payment.supplierName}</h4>
                                    <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                                        <span className="font-mono">Bill: {payment.billNumber}</span>
                                        <span>•</span>
                                        <span>Via: {payment.bankAccount}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-6 sm:w-1/3">
                                <div className="text-left sm:text-right">
                                    <div className="text-sm font-bold font-mono text-slate-900">{formatCurrency(payment.amount)}</div>
                                    <div className={`text-[10px] font-semibold mt-0.5 flex items-center justify-start sm:justify-end gap-1 ${
                                        payment.status === 'Approved' ? 'text-emerald-600' :
                                            payment.status === 'Processing' ? 'text-blue-600' : 'text-amber-600'
                                    }`}>
                                        {payment.status === 'Approved' ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                                        {payment.status}
                                    </div>
                                </div>

                                {payment.status === 'Awaiting Approval' && (
                                    <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all">
                                        Approve
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}

                    {scheduledPayments.length === 0 && (
                        <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                            <CalendarClock className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                            <h3 className="text-sm font-semibold text-slate-700">No Scheduled Payments</h3>
                            <p className="text-xs text-slate-500 mt-1">You have no upcoming outbound bank transfers scheduled.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};