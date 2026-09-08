export interface VendorExcelLineItemInput {
  serviceId: string;
  mediumName: string;
  vendorName: string;
  marginPercent?: number;
  requiredQuantity: number | string | null;
  durationDays: number | string | null;
  recurringUnitCost: number | string | null;
  oneTimeUnitCost: number | string | null;
  recurringUnitPrice: number | string | null;
  oneTimeUnitPrice: number | string | null;
}

export interface VendorExcelLineItem {
  serviceId: string;
  mediumName: string;
  vendorName: string;
  marginPercent?: number;
  requiredQuantity: number;
  durationDays: number;
  recurringCost: number;
  oneTimeCost: number;
  totalCost: number;
  recurringPrice: number;
  oneTimePrice: number;
  totalPrice: number;
}

export interface VendorExcelSummary {
  totalPrice: number;
  recurringPrice: number;
  oneTimePrice: number;
  totalCost: number;
  recurringCost: number;
  oneTimeCost: number;
}

export function excelNumber(value: unknown): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'string' && ['-', 'NA', 'N/A'].includes(value.trim().toUpperCase())) return 0;
  const parsed = Number(typeof value === 'string' ? value.replace(/,/g, '').replace(/^₹\s*/u, '').trim() : value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateVendorExcelLineItem(input: VendorExcelLineItemInput): VendorExcelLineItem {
  const requiredQuantity = excelNumber(input.requiredQuantity);
  const durationDays = excelNumber(input.durationDays);
  const recurringUnitCost = excelNumber(input.recurringUnitCost);
  const oneTimeUnitCost = excelNumber(input.oneTimeUnitCost);
  const recurringUnitPrice = excelNumber(input.recurringUnitPrice);
  const oneTimeUnitPrice = excelNumber(input.oneTimeUnitPrice);
  const recurringCost = requiredQuantity * durationDays * recurringUnitCost;
  const oneTimeCost = requiredQuantity * oneTimeUnitCost;
  const recurringPrice = requiredQuantity * durationDays * recurringUnitPrice;
  const oneTimePrice = requiredQuantity * oneTimeUnitPrice;

  return {
    serviceId: input.serviceId,
    mediumName: input.mediumName,
    vendorName: input.vendorName,
    marginPercent: input.marginPercent,
    requiredQuantity,
    durationDays,
    recurringCost,
    oneTimeCost,
    totalCost: recurringCost + oneTimeCost,
    recurringPrice,
    oneTimePrice,
    totalPrice: recurringPrice + oneTimePrice,
  };
}

export function summarizeVendorExcelRows(rows: readonly VendorExcelLineItem[]): VendorExcelSummary {
  return rows.reduce<VendorExcelSummary>(
    (summary, row) => ({
      totalPrice: summary.totalPrice + row.totalPrice,
      recurringPrice: summary.recurringPrice + row.recurringPrice,
      oneTimePrice: summary.oneTimePrice + row.oneTimePrice,
      totalCost: summary.totalCost + row.totalCost,
      recurringCost: summary.recurringCost + row.recurringCost,
      oneTimeCost: summary.oneTimeCost + row.oneTimeCost,
    }),
    {
      totalPrice: 0,
      recurringPrice: 0,
      oneTimePrice: 0,
      totalCost: 0,
      recurringCost: 0,
      oneTimeCost: 0,
    },
  );
}
