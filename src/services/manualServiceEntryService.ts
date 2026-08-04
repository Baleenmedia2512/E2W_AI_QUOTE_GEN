import { supabase } from './supabaseClient';
import { generateEmbedding } from './pdfEmbeddingService';

export type ManualImageType = 'reference' | 'specification' | 'review';

interface ManualServiceImageInput {
  file: File;
  type: ManualImageType;
}

/**
 * Excel-style columns for manual service entry.
 * All values are persisted into proposal_chunks.metadata.
 */
export interface ManualServiceColumnData {
  vendorName?: string;
  city: string;
  medium: string;
  minQty?: number;
  qtyMeasurementUnit?: string;
  totalCost?: number;
  displayCost?: number;
  printingCost?: number;
  mountingCost?: number;
  printingAndMountingCost?: number;
  rtoCertificate?: string;
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

export interface ManualServiceEntryInput extends ManualServiceColumnData {
  /** Optional free-text description used for embedding; auto-built if empty. */
  description?: string;
  documentId?: string;
  documentName?: string;
  currency?: string;
  terms?: string;
  userId?: string;
  images?: ManualServiceImageInput[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getFileExtension(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName) {
    return fromName;
  }

  if (file.type === 'image/png') {
    return 'png';
  }

  if (file.type === 'image/webp') {
    return 'webp';
  }

  return 'jpg';
}

function trimOrUndefined(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildDescription(input: ManualServiceEntryInput): string {
  if (input.description?.trim()) {
    return input.description.trim();
  }

  const parts = [
    `${input.medium.trim()} advertising service`,
    input.city ? `available in ${input.city.trim()}` : null,
    input.location ? `at ${input.location.trim()}` : null,
    input.vendorName ? `offered by ${input.vendorName.trim()}` : null,
  ].filter(Boolean);

  return `${parts.join(', ')}.`;
}

async function uploadManualServiceImage(
  serviceId: string,
  citySlug: string | null,
  image: ManualServiceImageInput,
): Promise<{ url: string; type: ManualImageType; pageNumber: number }> {
  const extension = getFileExtension(image.file);
  const basePath = citySlug ? `${citySlug}/${serviceId}` : serviceId;
  const fileName = `${basePath}/${image.type}/manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('proposal-images')
    .upload(fileName, image.file, {
      cacheControl: '3600',
      upsert: false,
      contentType: image.file.type || 'image/jpeg',
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data } = supabase.storage.from('proposal-images').getPublicUrl(fileName);

  return {
    url: data.publicUrl,
    type: image.type,
    pageNumber: 0,
  };
}

/**
 * Map Excel cost columns into the pricing shape already used by quote/chat helpers.
 */
function buildPricingFromColumns(input: ManualServiceEntryInput): Record<string, unknown> {
  const displayCost = input.displayCost || 0;
  const printingCost = input.printingCost || 0;
  const mountingCost = input.mountingCost || 0;
  const printingAndMounting =
    input.printingAndMountingCost ||
    (printingCost > 0 || mountingCost > 0 ? printingCost + mountingCost : 0);
  const totalCost = input.totalCost || 0;
  const period = input.durationMeasurementUnit
    ? `per ${input.durationMeasurementUnit}`
    : 'per month';

  // Prefer separate pricing when display + production costs exist
  if (displayCost > 0 && printingAndMounting > 0) {
    return {
      structure: 'separate',
      display_price: displayCost,
      display_period: period,
      production_price: printingAndMounting,
      production_unit: input.qtyMeasurementUnit || 'per unit',
      printing_cost: printingCost || undefined,
      mounting_cost: mountingCost || undefined,
      printing_and_mounting_cost: printingAndMounting,
      total: totalCost || undefined,
      min_quantity: input.minQty || undefined,
    };
  }

  // Campaign-style when unit/total + min qty present
  if ((totalCost > 0 || displayCost > 0) && (input.minQty || 0) > 1) {
    const unit = displayCost || totalCost;
    return {
      structure: 'campaign',
      unit_price: unit,
      min_quantity: input.minQty,
      period,
      total: totalCost || unit * (input.minQty || 1),
      printing_cost: printingCost || undefined,
      mounting_cost: mountingCost || undefined,
      printing_and_mounting_cost: printingAndMounting || undefined,
    };
  }

  // Combined / single rate
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
    min_quantity: input.minQty || undefined,
  };
}

function validateManualServiceInput(input: ManualServiceEntryInput): void {
  if (!input.medium?.trim()) {
    throw new Error('Medium is required.');
  }

  if (!input.city?.trim()) {
    throw new Error('City is required.');
  }

  const hasAnyCost =
    (input.totalCost || 0) > 0 ||
    (input.displayCost || 0) > 0 ||
    (input.printingCost || 0) > 0 ||
    (input.mountingCost || 0) > 0 ||
    (input.printingAndMountingCost || 0) > 0;

  if (!hasAnyCost) {
    throw new Error('At least one cost field is required (Total / Display / Printing / Mounting).');
  }
}

/**
 * Build the Excel-header metadata block (snake_case keys matching column names).
 * Only fills keys that have values so empty fields are not stored as blank noise.
 */
function buildExcelColumnMetadata(input: ManualServiceEntryInput): Record<string, unknown> {
  const columns: Record<string, unknown> = {};

  const set = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    columns[key] = value;
  };

  set('vendor_name', trimOrUndefined(input.vendorName));
  set('city', trimOrUndefined(input.city));
  set('medium', trimOrUndefined(input.medium));
  set('min_qty', input.minQty);
  set('qty_measurement_unit', trimOrUndefined(input.qtyMeasurementUnit));
  set('total_cost', input.totalCost);
  set('display_cost', input.displayCost);
  set('printing_cost', input.printingCost);
  set('mounting_cost', input.mountingCost);
  set('printing_and_mounting_cost', input.printingAndMountingCost);
  set('rto_certificate', trimOrUndefined(input.rtoCertificate));
  set('location', trimOrUndefined(input.location));
  set('traffic', trimOrUndefined(input.traffic));
  set('display_width', input.displayWidth);
  set('display_height', input.displayHeight);
  set('display_measurement_unit', trimOrUndefined(input.displayMeasurementUnit));
  set('min_duration', input.minDuration);
  set('duration_measurement_unit', trimOrUndefined(input.durationMeasurementUnit));
  set('duration_per_spot', trimOrUndefined(input.durationPerSpot));
  if (input.audioEnabled !== undefined && input.audioEnabled !== null) {
    columns.audio_enabled = input.audioEnabled;
  }
  set('day_start', trimOrUndefined(input.dayStart));
  set('day_end', trimOrUndefined(input.dayEnd));
  set('replacement', trimOrUndefined(input.replacement));
  set('spots_per_day', input.spotsPerDay);
  set('lead_time_days', input.leadTimeDays);

  return columns;
}

function buildDisplaySize(input: ManualServiceEntryInput): string | undefined {
  if (input.displayWidth && input.displayHeight) {
    const unit = trimOrUndefined(input.displayMeasurementUnit) || '';
    return `${input.displayWidth} x ${input.displayHeight}${unit ? ` ${unit}` : ''}`.trim();
  }
  return undefined;
}

export async function createManualServiceChunk(input: ManualServiceEntryInput): Promise<{ serviceId: string }> {
  validateManualServiceInput(input);

  const cityLabel = input.city.trim();
  const citySlug = slugify(cityLabel);
  const medium = input.medium.trim();
  const serviceId = `manual-${citySlug}-${slugify(medium)}-${Date.now()}`;
  const content = buildDescription(input);

  const locationParts = [trimOrUndefined(input.location), cityLabel].filter(Boolean) as string[];
  const uniqueLocations = [...new Set(locationParts)];

  const images = await Promise.all(
    (input.images || []).map((image) => uploadManualServiceImage(serviceId, citySlug, image)),
  );

  const pricing = buildPricingFromColumns(input);
  const excelColumns = buildExcelColumnMetadata(input);
  const size = buildDisplaySize(input);

  const unitPrice =
    Number(pricing.unit_price) ||
    Number(pricing.display_price) ||
    Number(pricing.combined_price) ||
    input.displayCost ||
    input.totalCost ||
    0;

  // Keep all Excel columns + quotable shapes the chat/quote pipeline already understands
  const metadata: Record<string, unknown> = {
    ...excelColumns,
    city: citySlug,
    pricing,
    currency: input.currency || 'INR',
    unit_price: unitPrice,
    size: size || undefined,
    duration: input.durationMeasurementUnit
      ? `1 ${input.durationMeasurementUnit}`
      : undefined,
    min_duration: input.minDuration
      ? `${input.minDuration} ${input.durationMeasurementUnit || 'days'}`
      : undefined,
    min_quantity: input.minQty || undefined,
    locations: uniqueLocations,
    category: medium,
    production_included: Boolean(input.printingCost || input.mountingCost || input.printingAndMountingCost),
    installation_included: Boolean(input.mountingCost || input.printingAndMountingCost),
    terms: trimOrUndefined(input.terms),
    images,
    thumbnail: images[0]?.url || null,
    source: 'manual-entry',
    // Nested copy of columns for explicit debugging / future forms
    excel_columns: excelColumns,
  };

  const embedding = await generateEmbedding(content);

  const { error } = await supabase.from('proposal_chunks').insert({
    service_name: medium,
    service_id: serviceId,
    content,
    embedding,
    metadata,
    document_id: input.documentId || `manual-entry-${Date.now()}`,
    document_name: input.documentName?.trim() || 'Manual Service Entry',
    user_id: input.userId || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return { serviceId };
}
