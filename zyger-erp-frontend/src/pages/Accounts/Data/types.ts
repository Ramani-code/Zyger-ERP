export type TabId =
    | 'ar-dashboard'
    | 'customer-outstanding'
    | 'due-invoices'
    | 'collections'
    | 'create-invoice'
    | 'invoice-approval'
    | 'e-invoice'
    | 'gstin-portal'
    | 'credit-debit-vouchers'
    | 'journal-entries'
    | 'sale-accounts'
    | 'purchase-accounts'
    | 'account-payable'
    | 'inventory-accounting'
    | 'mis-pnl'
    | 'mis-balance-sheet'
    | 'mis-trial-balance'
    | 'customer-master';

export interface OpenTab {
    id: TabId;
    title: string;
    category?: string;
    isClosable: boolean;
}

export interface CustomerOutstanding {
    id: string;
    code: string;
    name: string;
    industry: string;
    gstin: string;
    contactPerson: string;
    phone: string;
    email: string;
    creditLimit: number;
    creditDays: number;
    totalInvoiced: number;
    totalOutstanding: number;
    bucket0to30: number;
    bucket31to60: number;
    bucket61to90: number;
    bucket90Plus: number;
    riskTier: 'Low' | 'Medium' | 'High';
    lastPaymentDate: string;
    lastPaymentAmount: number;
    paymentStatus: 'On-Track' | 'Due Soon' | 'Overdue';
}

export interface InvoiceItem {
    id: string;
    description: string;
    hsn: string;
    quantity: number;
    unit: string;
    rate: number;
    discountPercent: number;
    taxableAmount: number;
    gstRate: number; // e.g. 18
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalAmount: number;
}

export interface Invoice {
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    customerId: string;
    customerName: string;
    customerGstin: string;
    billingAddress: string;
    shippingAddress: string;
    items: InvoiceItem[];
    subTotal: number;
    taxTotal: number;
    grandTotal: number;
    amountPaid: number;
    balanceDue: number;
    status: 'Draft' | 'Pending Approval' | 'Approved' | 'Sent' | 'Partially Paid' | 'Paid' | 'Cancelled' | 'Overdue';
    eInvoiceStatus: 'Generated' | 'Pending' | 'Not Applicable';
    irnNumber?: string;
    eWayBillNumber?: string;
    paymentTerms: string;
    notes?: string;
}

export interface PaymentRecord {
    id: string;
    receiptNumber: string;
    date: string;
    customerId: string;
    customerName: string;
    invoiceNumber: string;
    amount: number;
    paymentMode: 'NEFT/RTGS' | 'Cheque' | 'UPI' | 'Wire Transfer' | 'Cash';
    referenceNo: string;
    tdsDeducted: number;
    bankAccount: string;
    status: 'Reconciled' | 'Pending Clearance';
}

export interface Voucher {
    id: string;
    voucherNumber: string;
    date: string;
    type: 'Debit Voucher' | 'Credit Voucher' | 'Journal Entry';
    partyName: string;
    accountHead: string;
    amount: number;
    narration: string;
    preparedBy: string;
    status: 'Approved' | 'Draft';
}

export interface MISFinancialSummary {
    revenueThisMonth: number;
    revenueYTD: number;
    grossProfit: number;
    grossProfitMargin: number;
    netOperatingProfit: number;
    ebitda: number;
    totalAssets: number;
    totalLiabilities: number;
    totalReceivables: number;
    totalPayables: number;
    currentRatio: number;
    quickRatio: number;
}
