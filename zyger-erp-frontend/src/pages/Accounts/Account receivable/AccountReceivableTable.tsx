// components/AccountsReceivable/AccountsReceivableDashboard.tsx
import React from 'react';
import { CustomerOutstanding, Invoice, TabId } from '../../types'; // Adjust path to types as needed

// Import the separated child components
import { CollectionsAndReceipts } from './CollectionsAndReceipts';
import { DueInvoiceSchedule } from './DueInvoiceSchedule';
import { CustomerOutstandingTable } from './CustomerOutstandingTable';

interface ARDashboardProps {
    customers: CustomerOutstanding[];
    invoices: Invoice[];
    onNavigate: (tabId: TabId, title: string) => void;
    onOpenPaymentModal: (customer?: CustomerOutstanding) => void;
    onOpenReminderModal: (invoice?: Invoice, customer?: CustomerOutstanding) => void;
    onSelectInvoice: (invoice: Invoice) => void;
}

export const AccountsReceivableDashboard: React.FC<ARDashboardProps> = ({
                                                                            customers,
                                                                            invoices,
                                                                            onNavigate,
                                                                            onOpenPaymentModal,
                                                                            onOpenReminderModal,
                                                                        }) => {
    return (
        <div id="ar-dashboard-view" className="space-y-6 bg-white p-6 rounded-xl text-black">
            <CollectionsAndReceipts
                customers={customers}
                invoices={invoices}
                onNavigate={onNavigate}
                onOpenPaymentModal={onOpenPaymentModal}
            />

            <DueInvoiceSchedule
                customers={customers}
            />

            <CustomerOutstandingTable
                customers={customers}
                onNavigate={onNavigate}
                onOpenPaymentModal={onOpenPaymentModal}
                onOpenReminderModal={onOpenReminderModal}
            />
        </div>
    );
};