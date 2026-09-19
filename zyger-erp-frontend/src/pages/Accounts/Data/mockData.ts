export const misData = {
  profitAndLoss: {
    revenue: [
      { category: 'Product Sales', q1: 1250000, q2: 1420000, ytd: 2670000 },
      { category: 'Service Revenue', q1: 180000, q2: 210000, ytd: 390000 },
    ],
    costOfGoods: [
      { category: 'Raw Materials', q1: 650000, q2: 720000, ytd: 1370000 },
      { category: 'Direct Labour', q1: 180000, q2: 195000, ytd: 375000 },
    ],
    operatingExpenses: [
      { category: 'Administration', q1: 110000, q2: 120000, ytd: 230000 },
      { category: 'Logistics', q1: 75000, q2: 82000, ytd: 157000 },
    ],
  },
  trialBalance: [
    { code: '1100', head: 'Accounts Receivable', debit: 950000, credit: 0 },
    { code: '1200', head: 'Inventory', debit: 1250000, credit: 0 },
    { code: '2100', head: 'Accounts Payable', debit: 0, credit: 720000 },
    { code: '4100', head: 'Sales Revenue', debit: 0, credit: 3060000 },
    { code: '5100', head: 'Cost of Goods Sold', debit: 1745000, credit: 0 },
  ],
};
