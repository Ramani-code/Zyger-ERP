import React, { useState } from 'react';
import { Search, Filter } from 'lucide-react';

export interface BillRecord {
    id: string;
    supplierName: string;
    billNumber: string;
    billDate: string;
    dueDate: string;
    amount: number;
    status: 'Pending' | 'Overdue' | 'Partially Paid';
}

interface DueBillRegistryProps {
    bills: BillRecord[];
    onSchedulePayment: (bill: BillRecord) => void;
}

export const DueBillRegistry: React.FC<DueBillRegistryProps> = ({ bills = [], onSchedulePayment }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const formatCurrency = (amt: number) => '₹' + amt.toLocaleString('en-IN');

    const filteredBills = bills.filter(b =>
        b.supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.billNumber.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm text-black">
            <div className="p-5 border-b border-slate-200">
                <h2 className="text-lg font-bold text-slate-900">Due Bill Registry</h2>
                <p className="text-xs text-slate-500 mt-1">Manage and track all pending supplier invoices.</p>

                <div className="mt-4 flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search by supplier or bill number..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        />
                    </div>
                    <button className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-xs font-semibold flex items-center gap-2 hover:bg-slate-100">
                        <Filter className="w-4 h-4" /> Filter Status
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                    <tr>
                        <th className="px-4 py-3">Bill Details</th>
                        <th className="px-4 py-3">Supplier</th>
                        <th className="px-4 py-3">Dates</th>
                        <th className="px-4 py-3 text-right">Amount (₹)</th>
                        <th className="px-4 py-3 text-center">Status</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                    {filteredBills.map((bill) => (
                        <tr key={bill.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3">
                                <div className="font-semibold text-blue-700">{bill.billNumber}</div>
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-900">{bill.supplierName}</td>
                            <td className="px-4 py-3 text-slate-600">
                                <div>Iss: {bill.billDate}</div>
                                <div className="text-rose-600 font-medium">Due: {bill.dueDate}</div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                                {formatCurrency(bill.amount)}
                            </td>
                            <td className="px-4 py-3 text-center">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                      bill.status === 'Overdue' ? 'bg-rose-100 text-rose-800' :
                          bill.status === 'Partially Paid' ? 'bg-blue-100 text-blue-800' :
                              'bg-slate-100 text-slate-800'
                  }`}>
                    {bill.status}
                  </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                                <button
                                    onClick={() => onSchedulePayment(bill)}
                                    className="px-3 py-1.5 rounded bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-[11px] font-semibold transition-colors shadow-sm"
                                >
                                    Schedule
                                </button>
                            </td>
                        </tr>
                    ))}
                    {filteredBills.length === 0 && (
                        <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                                No due bills found matching your search.
                            </td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};