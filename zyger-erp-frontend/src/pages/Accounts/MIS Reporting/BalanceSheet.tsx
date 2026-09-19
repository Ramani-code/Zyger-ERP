import React from 'react';

export const BalanceSheet: React.FC = () => {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Assets */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <h3 className="text-sm font-bold text-black">ASSETS (Application of Funds)</h3>
                    <span className="text-xs font-mono text-emerald-700 font-bold">Total: ₹3,86,80,000</span>
                </div>

                <div className="space-y-3 text-xs">
                    <div>
                        <span className="font-semibold text-blue-800 uppercase text-[10px]">Current Assets</span>
                        <div className="mt-2 space-y-1.5">
                            <div className="flex justify-between text-black">
                                <span>Trade Accounts Receivable (Current Book):</span>
                                <span className="font-mono text-black font-bold">₹40,90,000</span>
                            </div>
                            <div className="flex justify-between text-black">
                                <span>Cash & Bank Balances (HDFC / SBI):</span>
                                <span className="font-mono">₹58,40,000</span>
                            </div>
                            <div className="flex justify-between text-black">
                                <span>Inventories (Raw Material & Work In Progress):</span>
                                <span className="font-mono">₹96,00,000</span>
                            </div>
                            <div className="flex justify-between text-black">
                                <span>Prepaid Taxes & GST Input Tax Credit (ITC):</span>
                                <span className="font-mono">₹16,50,000</span>
                            </div>
                        </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200">
                        <span className="font-semibold text-blue-800 uppercase text-[10px]">Non-Current / Fixed Assets</span>
                        <div className="mt-2 space-y-1.5">
                            <div className="flex justify-between text-black">
                                <span>Plant & CNC Machinery (DMG Mori, Makino):</span>
                                <span className="font-mono">₹1,45,00,000</span>
                            </div>
                            <div className="flex justify-between text-black">
                                <span>Factory Land & Tooling Building:</span>
                                <span className="font-mono">₹30,00,000</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Liabilities & Equity */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <h3 className="text-sm font-bold text-black">LIABILITIES & EQUITY (Sources of Funds)</h3>
                    <span className="text-xs font-mono text-blue-700 font-bold">Total: ₹3,86,80,000</span>
                </div>

                <div className="space-y-3 text-xs">
                    <div>
                        <span className="font-semibold text-amber-800 uppercase text-[10px]">Current Liabilities</span>
                        <div className="mt-2 space-y-1.5">
                            <div className="flex justify-between text-black">
                                <span>Trade Accounts Payable (Suppliers):</span>
                                <span className="font-mono text-black">₹28,50,000</span>
                            </div>
                            <div className="flex justify-between text-black">
                                <span>GST & Statutory Taxes Payable:</span>
                                <span className="font-mono">₹14,20,000</span>
                            </div>
                            <div className="flex justify-between text-black">
                                <span>Short-term Working Capital Facility:</span>
                                <span className="font-mono">₹25,00,000</span>
                            </div>
                        </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200">
                        <span className="font-semibold text-amber-800 uppercase text-[10px]">Shareholder Equity & Reserves</span>
                        <div className="mt-2 space-y-1.5">
                            <div className="flex justify-between text-black">
                                <span>Paid-Up Share Capital:</span>
                                <span className="font-mono">₹1,50,00,000</span>
                            </div>
                            <div className="flex justify-between text-black">
                                <span>Retained Earnings & Reserves:</span>
                                <span className="font-mono">₹1,69,10,000</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};