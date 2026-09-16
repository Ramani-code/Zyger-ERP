import { IN_TX_TYPES, OUT_TX_TYPES } from './movementLabels';

export interface KpiCardConfig {
  key: string;
  label: string;
  icon: string;
  color: string;
  format: 'number' | 'money';
  screenId?: string;
  drilldown?: string;
}

export const KPI_CARDS: KpiCardConfig[] = [
  {
    key: 'totalOnHand',
    label: 'Total Qty On Hand',
    icon: 'inventory_2',
    color: 'var(--blue)',
    format: 'number',
    screenId: 'current-stock',
  },
  {
    key: 'skuCount',
    label: 'Total SKUs',
    icon: 'category',
    color: 'var(--blue)',
    format: 'number',
    screenId: 'current-stock',
  },
  {
    key: 'stockValue',
    label: 'Stock Value',
    icon: 'payments',
    color: 'var(--purple)',
    format: 'money',
    screenId: 'current-stock',
  },
  {
    key: 'reserved',
    label: 'Reserved',
    icon: 'lock',
    color: 'var(--yellow)',
    format: 'number',
    drilldown: 'reservations',
  },
  {
    key: 'available',
    label: 'Available',
    icon: 'check_circle',
    color: 'var(--green)',
    format: 'number',
    screenId: 'current-stock',
  },
  {
    key: 'lowStockCount',
    label: 'Low Stock',
    icon: 'warning',
    color: 'var(--red)',
    format: 'number',
    drilldown: 'low-stock',
  },
  {
    key: 'outOfStockCount',
    label: 'Out of Stock',
    icon: 'block',
    color: 'var(--red)',
    format: 'number',
    drilldown: 'low-stock',
  },
  {
    key: 'ledgerEntries',
    label: 'Ledger Entries',
    icon: 'menu_book',
    color: 'var(--dark-nav)',
    format: 'number',
    screenId: 'inventory-log',
  },
  {
    key: 'activeStoreCount',
    label: 'Active Stores',
    icon: 'warehouse',
    color: 'var(--blue)',
    format: 'number',
    screenId: 'store-stock-summary',
  },
];

export type DrilldownFilterKey =
  | 'search'
  | 'dateRange'
  | 'item'
  | 'location'
  | 'category'
  | 'status'
  | 'txType'
  | 'lowStockOnly'
  | 'includeZero';

export interface DrilldownColumn {
  key: string;
  label: string;
  numeric?: boolean;
  money?: boolean;
  date?: boolean;
  badge?: boolean;
}

export interface DrilldownConfig {
  type: string;
  title: string;
  subtitle: string;
  icon: string;
  columns: DrilldownColumn[];
  filters: DrilldownFilterKey[];
}

export const DRILLDOWN_CONFIGS: Record<string, DrilldownConfig> = {
  'current-stock': {
    type: 'current-stock',
    title: 'Current Stock',
    subtitle: 'On hand / reserved / available by item, summed across all stores and batches — one row per item code',
    icon: 'inventory',
    columns: [
      { key: 'itemCode', label: 'Item' },
      { key: 'itemName', label: 'Name' },
      { key: 'category', label: 'Category' },
      { key: 'itemType', label: 'Type' },
      { key: 'itemGroup', label: 'Group' },
      { key: 'batchNo', label: 'Batches' },
      { key: 'heatNo', label: 'Heats' },
      { key: 'safetyStock', label: 'Safety', numeric: true },
      { key: 'onHand', label: 'On Hand', numeric: true },
      { key: 'reserved', label: 'Reserved', numeric: true },
      { key: 'qcHold', label: 'QC Hold', numeric: true },
      { key: 'available', label: 'Available', numeric: true },
      { key: 'value', label: 'Value', money: true },
      { key: 'status', label: 'Status', badge: true },
      { key: 'sourceTrace', label: 'Source Trace' },
    ],
    filters: ['search', 'item', 'location', 'category', 'lowStockOnly', 'includeZero'],
  },

  'store-stock-summary': {
    type: 'store-stock-summary',
    title: 'Stock by Store',
    subtitle: 'On hand / reserved / available, aggregated per store',
    icon: 'warehouse',
    columns: [
      { key: 'storeCode', label: 'Store' },
      { key: 'storeName', label: 'Name' },
      { key: 'storeType', label: 'Type' },
      { key: 'itemCount', label: 'Items', numeric: true },
      { key: 'totalOnHand', label: 'On Hand', numeric: true },
      { key: 'totalReserved', label: 'Reserved', numeric: true },
      { key: 'totalQcHold', label: 'QC Hold', numeric: true },
      { key: 'totalAvailable', label: 'Available', numeric: true },
      { key: 'totalValue', label: 'Value', money: true },
      { key: 'lastTransactionDate', label: 'Last Txn', date: true },
    ],
    filters: ['search'],
  },

  'not-available': {
    type: 'not-available',
    title: 'Not Available',
    subtitle: 'Items in the item master not currently in store (stock unavailable)',
    icon: 'inventory_2',
    columns: [
      { key: 'itemCode', label: 'Item' },
      { key: 'itemName', label: 'Name' },
      { key: 'category', label: 'Category' },
      { key: 'itemType', label: 'Type' },
      { key: 'itemGroup', label: 'Group' },
      { key: 'uom', label: 'UOM' },
      { key: 'defaultWarehouse', label: 'Location' },
      { key: 'available', label: 'Available', numeric: true },
      { key: 'status', label: 'Status', badge: true },
    ],
    filters: ['search', 'item', 'category'],
  },

  'low-stock': {
    type: 'low-stock',
    title: 'Low Stock',
    subtitle: 'Items below safety stock',
    icon: 'warning',
    columns: [
      { key: 'itemCode', label: 'Item' },
      { key: 'itemName', label: 'Name' },
      { key: 'location', label: 'Location' },
      { key: 'onHand', label: 'On Hand', numeric: true },
      { key: 'safetyQty', label: 'Safety', numeric: true },
      { key: 'shortage', label: 'Shortage', numeric: true },
    ],
    filters: ['search', 'location'],
  },

  reservations: {
    type: 'reservations',
    title: 'Reserved Stock',
    subtitle: 'Approved allotments holding stock',
    icon: 'lock',
    columns: [
      { key: 'docNo', label: 'Allotment' },
      { key: 'date', label: 'Date', date: true },
      { key: 'itemCode', label: 'Item' },
      { key: 'itemName', label: 'Name' },
      { key: 'location', label: 'Location' },
      { key: 'batchNo', label: 'Batch' },
      { key: 'reservedQty', label: 'Reserved', numeric: true },
      { key: 'referenceNo', label: 'Reference' },
      { key: 'status', label: 'Status', badge: true },
    ],
    filters: ['search', 'item', 'location'],
  },

  'pending-inward': {
    type: 'pending-inward',
    title: 'Pending Inward',
    subtitle: 'Inward documents awaiting receipt',
    icon: 'hourglass_top',
    columns: [
      { key: 'docNo', label: 'Doc No' },
      { key: 'date', label: 'Date', date: true },
      { key: 'docType', label: 'Type' },
      { key: 'party', label: 'Party' },
      { key: 'qty', label: 'Qty', numeric: true },
      { key: 'status', label: 'Status', badge: true },
    ],
    filters: ['search', 'dateRange', 'status'],
  },

  'pending-approvals': {
    type: 'pending-approvals',
    title: 'Pending Approvals',
    subtitle: 'All SUBMITTED documents awaiting approval',
    icon: 'task_alt',
    columns: [
      { key: 'docNo', label: 'Doc No' },
      { key: 'date', label: 'Date', date: true },
      { key: 'docType', label: 'Document Type' },
      { key: 'reference', label: 'Reference' },
      { key: 'qty', label: 'Qty', numeric: true },
      { key: 'status', label: 'Status', badge: true },
    ],
    filters: ['search', 'dateRange'],
  },

  'inventory-log': {
    type: 'inventory-log',
    title: 'Inventory Log',
    subtitle: 'Stock ledger — every in / out transaction',
    icon: 'menu_book',
    columns: [
      { key: 'date', label: 'Date', date: true },
      { key: 'docNo', label: 'Document' },
      { key: 'txType', label: 'Txn' },
      { key: 'itemCode', label: 'Item' },
      { key: 'itemName', label: 'Name' },
      { key: 'location', label: 'Location' },
      { key: 'batchNo', label: 'Batch' },
      { key: 'inQty', label: 'In', numeric: true },
      { key: 'outQty', label: 'Out', numeric: true },
      { key: 'runningBalance', label: 'Balance', numeric: true },
    ],
    filters: ['search', 'dateRange', 'item', 'location', 'txType'],
  },
};

export const TX_TYPE_OPTIONS = [
  ...IN_TX_TYPES,
  ...OUT_TX_TYPES,
  'QC_RELEASE',
  'QIC_ISSUE',
];