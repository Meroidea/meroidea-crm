export type SupplierRow = {
  id: string;
  name: string;
  contactName: string | null;
  orderEmail: string | null;
  phone: string | null;
  deliveryDays: number[];
  leadDays: number;
  cutoffTime: string | null;
  isActive: boolean;
  itemCount: number;
};

export type SupplierDetail = SupplierRow & {
  accountNumber: string | null;
  notes: string | null;
  orderChannel: string;
};

export type SupplierItemRow = {
  id: string;
  name: string;
  code: string | null;
  unit: string | null;
  /** A decimal string; prices are never JavaScript numbers. */
  unitPrice: string;
};

export type OrderStatus = 'sent' | 'not_sent' | 'cancelled';

export type OrderRow = {
  id: string;
  number: number;
  supplierId: string;
  supplierName: string;
  deliveryDate: string;
  status: OrderStatus;
  total: string;
  currency: string;
  createdAt: Date;
};

export type OrderLineRow = {
  id: string;
  name: string;
  code: string | null;
  unit: string | null;
  unitPrice: string;
  quantity: string;
  lineTotal: string;
};

export type OrderDetail = OrderRow & {
  notes: string | null;
  channel: string;
  sentTo: string | null;
  sentAt: Date | null;
  externalReference: string | null;
  lines: OrderLineRow[];
};

export const orderNumber = (number: number) => `PO-${String(number).padStart(4, '0')}`;
