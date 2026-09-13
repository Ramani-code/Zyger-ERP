export interface ItemMasterDto {
  code: string;
  description: string;
  uom: string;
  defaultRate?: number;
  requiresBatch?: boolean;
  requiresHeat?: boolean;
  active?: boolean;
  itemType?: string;
  groupType?: string;
  itemCategory?: string;
  category?: string;
  customerOwned?: boolean;
  itemGroupType?: string;
  groupItemType?: string;
  defaultReceivingStore?: string;
  inspectionRequired?: boolean;
  purchaseUom?: string;
  conversionFactor?: number;
}

export interface SupplierDto {
  code: string;
  name: string;
  active?: boolean;
}

export interface PurchaseOrderDto {
  number: string;
  supplierCode?: string;
  supplier?: string;
  supplierName?: string;
  party?: string;
  status?: string;
}

export interface LocationDto {
  code: string;
  name?: string;
  active?: boolean;
}