import React from 'react';
import { QrCode, FileText, ExternalLink } from 'lucide-react';
import { Invoice } from '../types';

export const EWayEInvoice: React.FC<{ invoice: Invoice }> = ({ invoice }) => {
    return (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wide">Government Portals</h3>

            <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-4 border border-slate-200 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-bold text-slate-600">E-Invoice (IRN)</span>
                        {invoice.eInvoiceStatus === 'Generated' ? <QrCode className="w-4 h-4 text-slate-800" /> : <FileText className="w-4 h-4 text-slate-400" />}
                    </div>
                    {invoice.eInvoiceStatus === 'Generated' ? (
                        <p className="text-[10px] font-mono text-slate-500 break-all">{invoice.irnNumber}</p>
                    ) : (
                        <button className="text-xs text-blue-600 font-semibold flex items-center gap-1 hover:underline">
                            Generate IRN <ExternalLink className="w-3 h-3" />
                        </button>
                    )}
                </div>

                <div className="bg-white p-4 border border-slate-200 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-bold text-slate-600">E-Way Bill</span>
                    </div>
                    {invoice.eWayBillNumber ? (
                        <p className="text-sm font-bold text-slate-900">{invoice.eWayBillNumber}</p>
                    ) : (
                        <button className="text-xs text-blue-600 font-semibold flex items-center gap-1 hover:underline">
                            Generate E-Way Bill <ExternalLink className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};