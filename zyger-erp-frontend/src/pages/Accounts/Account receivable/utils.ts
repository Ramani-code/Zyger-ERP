// components/AccountsReceivable/utils.ts

export const formatCurrency = (amt: number) => {
    return '₹' + amt.toLocaleString('en-IN');
};