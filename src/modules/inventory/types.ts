export type StockLevel = 'ok' | 'low' | 'out';

export type InventoryItemRow = {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string | null;
  categoryName: string | null;
  unit: string;
  /** Decimal strings throughout; quantities and money are never JavaScript numbers. */
  quantityOnHand: string;
  reorderLevel: string | null;
  unitCost: string | null;
  /** Quantity on hand × unit cost, worked out by the database. */
  stockValue: string | null;
  currency: string;
  level: StockLevel;
  isActive: boolean;
};

export type InventoryItemDetail = InventoryItemRow & {
  supplierName: string | null;
  notes: string | null;
};

export type InventorySummary = {
  items: number;
  low: number;
  out: number;
  archived: number;
  /** Total value of active stock with a known cost. */
  stockValue: string;
};

export type InventoryMovementRow = {
  id: string;
  type: 'received' | 'used' | 'wasted' | 'adjusted' | 'stocktake';
  quantityDelta: string;
  quantityAfter: string;
  unitCost: string | null;
  note: string | null;
  occurredAt: Date;
  byName: string | null;
};

export type CategoryOption = { id: string; name: string };
