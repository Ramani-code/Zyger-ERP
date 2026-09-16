export interface ReportsOverviewKpis {
  totalOnHand: number;
  skuCount: number;
  stockValue: number;
  reserved: number;
  available: number;
  lowStockCount: number;
  outOfStockCount: number;
  pendingInward: number;
  pendingApprovals: number;
  ledgerEntries: number;
  accuracyPct: number;
  activeStoreCount: number;
}

export interface MonthlyStatusPoint {
  month: string;
  received: number;
  onHand: number;
  issued: number;
}

export interface CategorySlice {
  category: string;
  value: number;
}

export interface LocationBar {
  location: string;
  onHand: number;
}

export interface TrendPoint {
  date: string;
  inward: number;
  issued: number;
}

export interface TopItemBar {
  itemCode: string;
  itemName: string;
  value: number;
}

export interface AbcTier {
  tier: 'A' | 'B' | 'C';
  itemCount: number;
  value: number;
  valuePct: number;
}

export interface AgingBucket {
  bucket: string;
  itemCount: number;
  qty: number;
  value: number;
}

export interface MovementSlice {
  count: number;
  qty: number;
}

export interface MovementSummary {
  count: number;
  qty: number;
  byType: Record<string, MovementSlice>;
}

export interface ReportsOverviewDto {
  kpis: ReportsOverviewKpis;
  monthlyStatus: MonthlyStatusPoint[];
  categoryDistribution: CategorySlice[];
  locationDistribution: LocationBar[];
  inwardIssueTrend: TrendPoint[];
  topItemsByValue: TopItemBar[];
  slowMovingItems: TopItemBar[];
  abcAnalysis: AbcTier[];
  stockAging: AgingBucket[];
  received?: MovementSummary;
  issued?: MovementSummary;
  receivedToday?: MovementSummary;
  issuedToday?: MovementSummary;
}

export interface ReportQueryParams {
  page: number;
  size: number;
  sort?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  itemCode?: string;
  location?: string;
  category?: string;
  itemType?: string;
  status?: string;
  txType?: string;
  lowStockOnly?: boolean;
  includeZero?: boolean;
}

export type DrilldownRow = { id: string } & Record<
  string,
  string | number | null | undefined
>;

export interface ItemGroupSummary {
  group: string;
  itemCount: number;
  qtyOnHand: number;
  qtyAvailable: number;
  value: number;
  notAvailableCount: number;
  lowStockCount: number;
}

export interface StockSummaryTotals {
  itemCount: number;
  qtyOnHand: number;
  qtyAvailable: number;
  value: number;
  notAvailableCount: number;
  lowStockCount: number;
}

export interface NotAvailableItem {
  itemCode: string;
  itemName: string;
  specification: string;
  category: string;
  itemType: string;
  itemGroup: string;
  uom: string;
  defaultWarehouse: string;
  available: number;
  status: string;
}

export interface StockSummaryDto {
  groups: ItemGroupSummary[];
  totals: StockSummaryTotals;
  notAvailableItems: NotAvailableItem[];
}

export interface SimpleReportDto {
  totals: StockSummaryTotals;
  groups: ItemGroupSummary[];
  reorderList: DrilldownRow[];
  reorderSoonList: DrilldownRow[];
}

export interface ItemStockStore {
  storeCode: string;
  storeName: string;
  onHand: number;
  available: number;
}

export interface ItemStockRow {
  id: string;
  itemCode: string;
  itemName: string;
  specification: string;
  itemType: string;
  itemGroup: string;
  category: string;
  uom: string;
  onHand: number;
  reserved: number;
  qcHold: number;
  available: number;
  value: number;
  safetyStock: number;
  reorderPoint: number;
  maxStockLevel: number;
  reorderQty: number | null;
  suggestedOrderQty: number;
  avgDailyConsumption: number;
  reorderStatus: string;
  lowStock: boolean;
  multiStore: boolean;
  lastMovementDate: string | null;
  perStore: ItemStockStore[];
}

export interface StoreStockRow {
  id: string;
  storeCode: string;
  storeName: string;
  itemCode: string;
  itemName: string;
  specification: string;
  itemType: string;
  itemGroup: string;
  category: string;
  uom: string;
  onHand: number;
  reserved: number;
  qcHold: number;
  available: number;
  value: number;
  lastMovementDate: string | null;
}