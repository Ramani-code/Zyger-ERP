import React, { useState } from 'react';
import { Plus, Save, Building } from 'lucide-react';
import { Invoice } from '../types';

export const CreateInvoice: React.FC = () => {
    const [customerName, setCustomerName] = useState('');
    const [gstin, setGstin] = useState('');

    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 text-slate-800">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-bold text-slate-900">Create New Invoice</h2>
                <button className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold flex items-center gap-2 hover:bg-slate-800">
                    <Save className="w-4 h-4" /> Save Invoice
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Customer Details</label>
                    <input
                        type="text"
                        placeholder="Customer Name"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="w-full mb-3 p-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-slate-900/10"
                    />
                    <input
                        type="text"
                        placeholder="Billing Address"
                        className="w-full p-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-slate-900/10"
                    />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Tax Information</label>
                    <input
                        type="text"
                        placeholder="GSTIN"
                        value={gstin}
                        onChange={(e) => setGstin(e.target.value)}
                        className="w-full mb-3 p-2.5 rounded-lg border border-slate-200 text-sm uppercase focus:ring-2 focus:ring-slate-900/10"
                    />
                </div>
            </div>

            {/* Add Line Items Section Here */}
            <button className="mt-4 px-4 py-2 border border-slate-200 rounded-lg text-xs font-medium flex items-center gap-2 hover:bg-slate-50">
                <Plus className="w-4 h-4" /> Add Line Item
            </button>
        </div>
    );
};