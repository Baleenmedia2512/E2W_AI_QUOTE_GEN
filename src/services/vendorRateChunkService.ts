import * as XLSX from 'xlsx';
import { supabase } from './supabaseClient';

export interface VendorRateRow {
  vendorName?: string;
  city: string;
  medium: string;
  type1?: string;
  type2?: string;
  type3?: string;
  minQty?: number;
  qtyMeasurementUnit?: string;
  totalCost?: number;
  displayCost?: number;
  printingCost?: number;
  mountingCost?: number;
  printingAndMountingCost?: number;
  rtoCertificate?: string;
  extraKm?: number;
  spaceRentalCost?: number;
  location?: string;
  traffic?: string;
  displayWidth?: number;
  displayHeight?: number;
  displayMeasurementUnit?: string;
  minDuration?: number;
  durationMeasurementUnit?: string;
  durationPerSpot?: string;
  audioEnabled?: boolean | null;
  dayStart?: string;
  dayEnd?: string;
  replacement?: string;
  spotsPerDay?: number;
  leadTimeDays?: number;
}

export interface VendorRateChunkRecord {
  id: string;
  service_name: string;
  service_id: string;
  content: string;
  metadata: Record<string, unknown>;
  document_id: string;
  document_name: string;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorImportResult {
  documentId: string;
  documentName: string;
  imported: number;
  skipped: number;
  errors: string[];
  vendorCount: number;
}

export interface VendorImportProgress {
  phase: 'parsing' | 'importing' | 'done';
  current: number;
  total: number;
  message: string;
}

const HEADER_ALIASES: Record<string, keyof VendorRateRow> = {
  vendor_name: 'vendorName',
  vendor: 'vendorName',
  city: 'city',
  medium: 'medium',
  service: 'medium',
  type1: 'type1',
  type_1: 'type1',
  type2: 'type2',
  type_2: 'type2',
  type3: 'type3',
  type_3: 'type3',
  min_qty: 'minQty',
  min_quantity: 'minQty',
  minqty: 'minQty',
  qty_measurement: 'qtyMeasurementUnit',
  qty_measurement_unit: 'qtyMeasurementUnit',
  quantity_measurement: 'qtyMeasurementUnit',
  total_cost: 'totalCost',
  display_cost: 'displayCost',
  printing_cost: 'printingCost',
  mounting_cost: 'mountingCost',
  printing_mounting_cost: 'printingAndMountingCost',
  printing_and_mounting_cost: 'printingAndMountingCost',
  printing_mounting: 'printingAndMountingCost',
  rto_certificate: 'rtoCertificate',
  rto_cost: 'rtoCertificate',
  extra_km: 'extraKm',
  space_rental_cost: 'spaceRentalCost',
  location: 'location',
  traffic: 'traffic',
  display_width: 'displayWidth',
  display_height: 'displayHeight',
  display_measurement_unit: 'displayMeasurementUnit',
  min_duration: 'minDuration',
  duration_measurement_unit: 'durationMeasurementUnit',
  duration_unit: 'durationMeasurementUnit',
  per_spot: 'durationPerSpot',
  duration_per_spot: 'durationPerSpot',
  audio_enabled: 'audioEnabled',
  day_start: 'dayStart',
  day_end: 'dayEnd',
  replacement: 'replacement',
  spots_per_day: 'spotsPerDay',
  no_of_spots_per_day: 'spotsPerDay',
  lead_time: 'leadTimeDays',
  lead_time_days: 'leadTimeDays',
  lead_time_in_days: 'leadTimeDays',
};

const NUMERIC_FIELDS = new Set<keyof VendorRateRow>([
  'minQty',
  'totalCost',
  'displayCost',
  'printingCost',
  'mountingCost',
  'printingAndMountingCost',
  'extraKm',
  'spaceRentalCost',
  'displayWidth',
  'displayHeight',
  'minDuration',
  'spotsPerDay',
  'leadTimeDays',
]);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[.()]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const text = String(value).trim();
  return text === '' || text.toUpperCase() === 'NA' || text === '-';
}

function parseNumber(value: unknown): number | undefined {
  if (isEmptyValue(value)) return undefined;
  const cleaned = String(value).replace(/[₹,\s]/g, '').trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseText(value: unknown): string | undefined {
  if (isEmptyValue(value)) return undefined;
  return String(value).trim();
}

function parseAudio(value: unknown): boolean | null | undefined {
  if (isEmptyValue(value)) return undefined;
  const text = String(value).trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(text)) return true;
  if (['no', 'n', 'false', '0'].includes(text)) return false;
  return null;
}

function buildDescription(row: VendorRateRow): string {
  const parts = [
    `${row.medium} advertising service`,
    row.city ? `available in ${row.city}` : null,
    row.location ? `at ${row.location}` : null,
    row.vendorName ? `offered by ${row.vendorName}` : null,
  ].filter(Boolean);

  return `${parts.join(', ')}.`;
}

function buildPricingFromRow(row: VendorRateRow): Record<string, unknown> {
  const displayCost = row.displayCost || 0;
  const printingCost = row.printingCost || 0;
  const mountingCost = row.mountingCost || 0;
  const printingAndMounting =
    row.printingAndMountingCost ||
    (printingCost > 0 || mountingCost > 0 ? printingCost + mountingCost : 0);
  const totalCost = row.totalCost || 0;
  const period = row.durationMeasurementUnit
    ? `per ${row.durationMeasurementUnit}`
    : 'per month';

  if (displayCost > 0 && printingAndMounting > 0) {
    return {
      structure: 'separate',
      display_price: displayCost,
      display_period: period,
      production_price: printingAndMounting,
      production_unit: row.qtyMeasurementUnit || 'per unit',
      printing_cost: printingCost || undefined,
      mounting_cost: mountingCost || undefined,
      printing_and_mounting_cost: printingAndMounting,
      total: totalCost || undefined,
      min_quantity: row.minQty || undefined,
    };
  }

  if ((totalCost > 0 || displayCost > 0) && (row.minQty || 0) > 1) {
    const unit = displayCost || totalCost;
    return {
      structure: 'campaign',
      unit_price: unit,
      min_quantity: row.minQty,
      period,
      total: totalCost || unit * (row.minQty || 1),
      printing_cost: printingCost || undefined,
      mounting_cost: mountingCost || undefined,
      printing_and_mounting_cost: printingAndMounting || undefined,
    };
  }

  const combined = totalCost || displayCost || printingAndMounting || printingCost || mountingCost;
  return {
    structure: 'combined',
    combined_price: combined,
    period,
    display_price: displayCost || undefined,
    production_price: printingAndMounting || undefined,
    printing_cost: printingCost || undefined,
    mounting_cost: mountingCost || undefined,
    printing_and_mounting_cost: printingAndMounting || undefined,
    total: totalCost || undefined,
    min_quantity: row.minQty || undefined,
  };
}

function buildExcelColumnMetadata(row: VendorRateRow): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    columns[key] = value;
  };

  set('vendor_name', row.vendorName);
  set('city', row.city);
  set('medium', row.medium);
  set('type1', row.type1);
  set('type2', row.type2);
  set('type3', row.type3);
  set('min_qty', row.minQty);
  set('qty_measurement_unit', row.qtyMeasurementUnit);
  set('total_cost', row.totalCost);
  set('display_cost', row.displayCost);
  set('printing_cost', row.printingCost);
  set('mounting_cost', row.mountingCost);
  set('printing_and_mounting_cost', row.printingAndMountingCost);
  set('rto_certificate', row.rtoCertificate);
  set('extra_km', row.extraKm);
  set('space_rental_cost', row.spaceRentalCost);
  set('location', row.location);
  set('traffic', row.traffic);
  set('display_width', row.displayWidth);
  set('display_height', row.displayHeight);
  set('display_measurement_unit', row.displayMeasurementUnit);
  set('min_duration', row.minDuration);
  set('duration_measurement_unit', row.durationMeasurementUnit);
  set('duration_per_spot', row.durationPerSpot);
  if (row.audioEnabled !== undefined && row.audioEnabled !== null) {
    columns.audio_enabled = row.audioEnabled;
  }
  set('day_start', row.dayStart);
  set('day_end', row.dayEnd);
  set('replacement', row.replacement);
  set('spots_per_day', row.spotsPerDay);
  set('lead_time_days', row.leadTimeDays);

  return columns;
}

function buildDisplaySize(row: VendorRateRow): string | undefined {
  if (row.displayWidth && row.displayHeight) {
    const unit = row.displayMeasurementUnit || '';
    return `${row.displayWidth} x ${row.displayHeight}${unit ? ` ${unit}` : ''}`.trim();
  }
  return undefined;
}

function validateVendorRow(row: VendorRateRow, rowNumber: number): string | null {
  if (!row.medium?.trim()) {
    return `Row ${rowNumber}: Medium is required.`;
  }
  if (!row.city?.trim()) {
    return `Row ${rowNumber}: City is required.`;
  }

  const hasAnyCost =
    (row.totalCost || 0) > 0 ||
    (row.displayCost || 0) > 0 ||
    (row.printingCost || 0) > 0 ||
    (row.mountingCost || 0) > 0 ||
    (row.printingAndMountingCost || 0) > 0 ||
    (row.spaceRentalCost || 0) > 0;

  if (!hasAnyCost) {
    return `Row ${rowNumber}: At least one cost field is required.`;
  }

  return null;
}

function mapRawRowToVendorRate(
  rawRow: Record<string, unknown>,
  headerMap: Map<string, keyof VendorRateRow>,
): VendorRateRow {
  const row: VendorRateRow = {
    city: '',
    medium: '',
  };

  for (const [header, field] of headerMap.entries()) {
    const rawValue = rawRow[header];
    if (isEmptyValue(rawValue)) continue;

    if (field === 'audioEnabled') {
      row.audioEnabled = parseAudio(rawValue);
      continue;
    }

    if (NUMERIC_FIELDS.has(field)) {
      const parsed = parseNumber(rawValue);
      if (parsed !== undefined) {
        (row as Record<string, unknown>)[field] = parsed;
      }
      continue;
    }

    const text = parseText(rawValue);
    if (text) {
      (row as Record<string, unknown>)[field] = text;
    }
  }

  return row;
}

function buildHeaderMap(headers: string[]): Map<string, keyof VendorRateRow> {
  const headerMap = new Map<string, keyof VendorRateRow>();

  headers.forEach((header) => {
    const normalized = normalizeHeader(header);
    const field = HEADER_ALIASES[normalized];
    if (field) {
      headerMap.set(header, field);
    }
  });

  return headerMap;
}

function buildChunkPayload(
  row: VendorRateRow,
  rowNumber: number,
  sheetName: string,
  documentId: string,
  documentName: string,
  userId?: string,
) {
  const cityLabel = row.city.trim();
  const citySlug = slugify(cityLabel);
  const medium = row.medium.trim();
  const vendorSlug = row.vendorName ? slugify(row.vendorName) : 'vendor';
  const serviceId = `vrc-${citySlug}-${slugify(medium)}-${vendorSlug}-${rowNumber}`;
  const content = buildDescription(row);
  const pricing = buildPricingFromRow(row);
  const excelColumns = buildExcelColumnMetadata(row);
  const size = buildDisplaySize(row);

  const unitPrice =
    Number(pricing.unit_price) ||
    Number(pricing.display_price) ||
    Number(pricing.combined_price) ||
    row.displayCost ||
    row.totalCost ||
    0;

  const locationParts = [row.location, cityLabel].filter(Boolean) as string[];
  const uniqueLocations = [...new Set(locationParts)];

  const metadata: Record<string, unknown> = {
    ...excelColumns,
    city: citySlug,
    pricing,
    currency: 'INR',
    unit_price: unitPrice,
    size: size || undefined,
    duration: row.durationMeasurementUnit ? `1 ${row.durationMeasurementUnit}` : undefined,
    min_duration: row.minDuration
      ? `${row.minDuration} ${row.durationMeasurementUnit || 'days'}`
      : undefined,
    min_quantity: row.minQty || undefined,
    locations: uniqueLocations,
    category: medium,
    production_included: Boolean(row.printingCost || row.mountingCost || row.printingAndMountingCost),
    installation_included: Boolean(row.mountingCost || row.printingAndMountingCost),
    source: 'excel-import',
    excel_row_index: rowNumber,
    excel_sheet: sheetName,
    excel_columns: excelColumns,
  };

  return {
    service_name: medium,
    service_id: serviceId,
    content,
    embedding: null,
    metadata,
    document_id: documentId,
    document_name: documentName,
    user_id: userId || null,
  };
}

export function parseVendorExcelRows(fileBuffer: ArrayBuffer): {
  rows: Array<{ row: VendorRateRow; rowNumber: number; sheetName: string }>;
  errors: string[];
} {
  const workbook = XLSX.read(fileBuffer, { type: 'array' });
  const parsedRows: Array<{ row: VendorRateRow; rowNumber: number; sheetName: string }> = [];
  const errors: string[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const table = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: '',
      raw: false,
    });

    if (table.length === 0) return;

    const headers = Object.keys(table[0] || {});
    const headerMap = buildHeaderMap(headers);

    if (![...headerMap.values()].includes('medium')) {
      errors.push(`Sheet "${sheetName}": Missing Medium column.`);
      return;
    }
    if (![...headerMap.values()].includes('city')) {
      errors.push(`Sheet "${sheetName}": Missing City column.`);
      return;
    }

    table.forEach((rawRow, index) => {
      const rowNumber = index + 2;
      const mapped = mapRawRowToVendorRate(rawRow, headerMap);
      const validationError = validateVendorRow(mapped, rowNumber);

      if (validationError) {
        errors.push(`Sheet "${sheetName}" ${validationError}`);
        return;
      }

      parsedRows.push({ row: mapped, rowNumber, sheetName });
    });
  });

  return { rows: parsedRows, errors };
}

export async function importVendorExcelFile(
  file: File,
  userId?: string,
  onProgress?: (progress: VendorImportProgress) => void,
): Promise<VendorImportResult> {
  const documentId = `vendor_excel_${Date.now()}`;
  const documentName = file.name;
  const buffer = await file.arrayBuffer();

  onProgress?.({
    phase: 'parsing',
    current: 0,
    total: 0,
    message: 'Reading Excel rows...',
  });

  const { rows, errors: parseErrors } = parseVendorExcelRows(buffer);
  const payloads = rows.map(({ row, rowNumber, sheetName }) =>
    buildChunkPayload(row, rowNumber, sheetName, documentId, documentName, userId),
  );

  if (payloads.length === 0) {
    throw new Error(
      parseErrors[0] || 'No valid vendor rows found. Check Excel headers and data.',
    );
  }

  const batchSize = 50;
  let imported = 0;

  onProgress?.({
    phase: 'importing',
    current: 0,
    total: payloads.length,
    message: 'Importing vendor rates...',
  });

  for (let index = 0; index < payloads.length; index += batchSize) {
    const batch = payloads.slice(index, index + batchSize);
    const { error } = await supabase.from('vendor_rate_chunks').insert(batch);

    if (error) {
      throw new Error(`Import failed at row ${index + 1}: ${error.message}`);
    }

    imported += batch.length;
    onProgress?.({
      phase: 'importing',
      current: imported,
      total: payloads.length,
      message: `Imported ${imported} of ${payloads.length} rows...`,
    });
  }

  const vendorCount = new Set(
    rows.map(({ row }) => row.vendorName?.trim().toLowerCase()).filter(Boolean),
  ).size;

  onProgress?.({
    phase: 'done',
    current: imported,
    total: payloads.length,
    message: 'Import complete.',
  });

  return {
    documentId,
    documentName,
    imported,
    skipped: parseErrors.length,
    errors: parseErrors,
    vendorCount,
  };
}

export async function loadVendorRateChunks(limit = 500): Promise<VendorRateChunkRecord[]> {
  const { data, error } = await supabase
    .from('vendor_rate_chunks')
    .select('id, service_name, service_id, content, metadata, document_id, document_name, user_id, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as VendorRateChunkRecord[];
}

export async function loadVendorSummary(): Promise<{
  totalRates: number;
  vendorCount: number;
  documentCount: number;
}> {
  const { data, error } = await supabase
    .from('vendor_rate_chunks')
    .select('metadata, document_id');

  if (error) {
    throw new Error(error.message);
  }

  const rows = data || [];
  const vendors = new Set<string>();
  const documents = new Set<string>();

  rows.forEach((row) => {
    const metadata = row.metadata as Record<string, unknown> | null;
    const vendor = String(metadata?.vendor_name || '').trim().toLowerCase();
    if (vendor) vendors.add(vendor);
    if (row.document_id) documents.add(row.document_id);
  });

  return {
    totalRates: rows.length,
    vendorCount: vendors.size,
    documentCount: documents.size,
  };
}

export async function deleteVendorRatesByDocument(documentId: string): Promise<void> {
  const { error } = await supabase
    .from('vendor_rate_chunks')
    .delete()
    .eq('document_id', documentId);

  if (error) {
    throw new Error(error.message);
  }
}
