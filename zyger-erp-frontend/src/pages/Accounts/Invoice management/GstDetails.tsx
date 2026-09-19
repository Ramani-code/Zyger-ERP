import React from 'react';
import { Invoice } from '../types';

export const GstDetails: React.FC<{ invoice: Invoice }> = ({ invoice }) => {
    // Logic determining intra vs inter state would occur before passing props
    const isInterState = invoice.customerGstin?.substring(0, 2) !== '27'; // Example assuming seller state code 27 (Maharashtra)

    return (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden text-xs">
            <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 font-bold text-slate-700">
                GST Tax Breakdown
            </div>
            <div className="p-4 space-y-3">
                <div className="flex justify-between">
                    <span className="text-slate-500">Taxable Value</span>
                    <span className="font-semibold">₹{invoice.subTotal.toLocaleString('en-IN')}</span>
                </div>

                {isInterState ? (
                    <div className="flex justify-between">
                        <span className="text-slate-500">IGST (18%)</span>
                        <span className="font-semibold">₹{invoice.taxTotal.toLocaleString('en-IN')}</span>
                    </div>
                ) : (
                    <>
                        <div className="flex justify-between">
                            <span className="text-slate-500">CGST (9%)</span>
                            <span className="font-semibold">₹{(invoice.taxTotal / 2).toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">SGST (9%)</span>
                            <span className="font-semibold">₹{(invoice.taxTotal / 2).toLocaleString('en-IN')}</span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};