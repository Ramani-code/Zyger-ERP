/**
 * Classifies an Item Master row as Purchasable / Customer-Supplied / Manufacturing,
 * matching the three item screens under Master → Inventory → Items exactly — the same
 * itemType-only check each of those three screens uses to build its own list (see
 * PurchasableItemScreen.tsx, CustomerSuppliedItemScreen.tsx, ManufacturingItemScreen.tsx).
 * Deliberately does NOT fall back to matching on code prefix or category text: an earlier
 * version of this function did, which let items through a picker that don't actually appear
 * in any of the three master screens themselves (e.g. legacy/seed items whose code happens
 * to start with "MFG-"/"PIT-"/"CSM-" but whose itemType doesn't match, or raw-material rows
 * with a category name that merely contains "Purchas..."). Match the master screens'
 * itemType check exactly, nothing looser.
 *
 * This is the one shared copy used by every Item Code picker across the app: Purchase and
 * Sales document line items, Inventory (Inward / PO Inward, Stock Issue Request, Stock
 * Issue, Delivery Challan, Return Management, GRN, Stock Allotment, Adjustment), Production
 * (Consumption, Material Request, Product Conversion, Production Return), Planning
 * (Route Sheet / Production BOM item pickers), Purchase/Job Order Schedule, and BOM Master.
 */
export function isPurchaseRelevantItem(item: {
  code?: string;
  itemType?: string;
  groupType?: string;
  itemCategory?: string;
  category?: string;
  itemGroupType?: string;
  groupItemType?: string;
  customerOwned?: boolean;
  active?: boolean;
  status?: string;
}): boolean {
  if (!item || !item.code || !String(item.code).trim()) return false;
  if (item.active === false || item.status === 'INACTIVE' || item.status === 'DISCONTINUED') {
    return false;
  }

  const t = String(item.itemType || '').toUpperCase().replace(' ', '_');

  const isPurchasable = t === 'PURCHASABLE' || t === 'RAW_MATERIAL' || t === 'BUY_ITEM';
  const isCustomerSupplied = t === 'CUSTOMER_SUPPLIED' || item.customerOwned === true;
  const isManufacturing = t === 'FG' || t === 'SEMI_FG' || t === 'SFG' || t === 'MANUFACTURING';

  return isPurchasable || isCustomerSupplied || isManufacturing;
}

/**
 * Filters to Purchasable/Customer-Supplied/Manufacturing items. Unlike an earlier version,
 * this does NOT fall back to the unfiltered list when nothing matches — an empty picker is
 * the correct, honest result when none of the loaded items belong to one of the three
 * masters (falling back to "show everything" is exactly the bug this function exists to fix).
 */
export function filterPurchaseRelevantItems<T extends Parameters<typeof isPurchaseRelevantItem>[0]>(
  items: T[]
): T[] {
  return items.filter(isPurchaseRelevantItem);
}
