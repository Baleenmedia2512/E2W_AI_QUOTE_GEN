/**
 * Isolated Gemini call for missing qty_measurement_unit only.
 * No RAG / chat path. Preview-only enrich uses this.
 */

import type { QuoteItem } from '../types/quote';
import {
  reportAiTelemetry,
  usageFromGeminiResponse,
} from './aiTokenMonitor';
import { generateContent, type TraceContext } from './geminiClient';

const MODEL = 'gemini-3.1-flash-lite';
const BATCH_SIZE = 20;
const TELEMETRY_MODULE = 'qty_unit_inference';

function isNaLikeUnit(value: string | undefined | null): boolean {
  if (value == null || String(value).trim() === '') return true;
  return String(value).trim().toUpperCase() === 'NA';
}

function itemLabel(item: QuoteItem): string {
  return (
    (item.serviceName || item.title || '').trim() ||
    (item.description || '').split(/\s*-\s*/)[0]?.trim() ||
    ''
  );
}

function cleanUnit(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  let text = String(raw).trim();
  if (!text) return undefined;
  text = text.replace(/^["'`]+|["'`]+$/g, '').trim();
  text = text.replace(/^per\s+/i, '').trim();
  text = text.replace(/[.,;:!?]+$/g, '').trim();
  if (!text || text.toUpperCase() === 'NA') return undefined;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 4 || text.length > 40) {
    text = words.slice(0, 3).join(' ');
  }
  if (!text || text.length > 40) return undefined;
  return text;
}

function parseIndexedUnitMap(raw: string, count: number): Record<number, string> {
  const out: Record<number, string> = {};
  if (!raw.trim()) return out;

  let jsonText = raw.trim();
  const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonText = fence[1].trim();
  const brace = jsonText.match(/\{[\s\S]*\}/);
  if (brace) jsonText = brace[0];

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed)) {
      const idx = Number(String(k).trim());
      const unit = cleanUnit(v);
      if (!Number.isFinite(idx) || !unit) continue;
      if (idx >= 1 && idx <= count) out[idx] = unit;
    }
  } catch (e) {
    console.warn('🏷️ [QtyUnit-AI-EXACT] JSON_PARSE_FAIL', {
      error: e instanceof Error ? e.message : String(e),
      rawPreview: raw.slice(0, 800),
    });
  }
  return out;
}

/**
 * Batch-infer qty units via Gemini. Uses numbered keys so matching
 * does not depend on long location strings.
 */
async function inferQtyUnitsBatchRest(
  labels: string[],
  trace?: TraceContext
): Promise<Record<string, string>> {
  const unique = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
  const resultMap: Record<string, string> = {};
  if (unique.length === 0) return resultMap;

  for (let start = 0; start < unique.length; start += BATCH_SIZE) {
    const chunk = unique.slice(start, start + BATCH_SIZE);
    const listBlock = chunk.map((l, i) => `${i + 1}. ${l}`).join('\n');
    const prompt = [
      'You are a BTL outdoor advertising inventory specialist.',
      'For each numbered service below, return the quantity measurement unit (what one qty counts).',
      '',
      'STRICT RULES:',
      '1. Prefer the medium/type word from the START of the service name (before city/location).',
      '   Examples of how to think (do not copy unless present in the name):',
      '   - Name starts with "Hoarding …" → unit must be "hoarding" (NOT board, NOT billboard).',
      '   - Name starts with "Police Booth …" or "Booth …" → "booth".',
      '   - Name contains Bus Shelter / Shelter → "shelter".',
      '   - Bus / Auto / Van branding → "bus" / "auto" / "van".',
      '2. NEVER invent synonyms. If the name says Hoarding, output "hoarding" only.',
      '3. NEVER use city, road, area, landmark, junction, flyover, or direction words as the unit.',
      '4. Reply with ONLY a JSON object. Keys = "1","2",… Values = one short unit word (lowercase preferred).',
      '5. No markdown. No explanation.',
      '',
      'Services:',
      listBlock,
    ].join('\n');

    console.warn('🏷️ [QtyUnit-AI-EXACT] REQUEST', {
      model: MODEL,
      chunkStart: start,
      chunkSize: chunk.length,
      sample: chunk.slice(0, 2),
    });

    const startedAt = Date.now();
    let raw = '';
    try {
      const res = await generateContent(
        prompt,
        { module: 'QTY_UNIT_EXTRACT', ...trace },
        undefined,
        { temperature: 0, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      );
      raw = (res.response.text() || '').trim();
      const usage = usageFromGeminiResponse(
        (res.response as { usageMetadata?: unknown }).usageMetadata
          ? { usageMetadata: (res.response as { usageMetadata?: unknown }).usageMetadata }
          : null,
      );
      reportAiTelemetry({
        model: MODEL,
        module: TELEMETRY_MODULE,
        latency: Date.now() - startedAt,
        status: 'SUCCESS',
        usage,
      });
    } catch (err) {
      console.error('🏷️ [QtyUnit-AI-EXACT] GENERATE_FAIL', err);
      reportAiTelemetry({
        model: MODEL,
        module: TELEMETRY_MODULE,
        latency: Date.now() - startedAt,
        status: 'FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    console.warn('🏷️ [QtyUnit-AI-EXACT] RESPONSE', {
      rawLen: raw.length,
      rawPreview: raw.slice(0, 1500),
    });

    if (!raw) {
      console.error('🏷️ [QtyUnit-AI-EXACT] EMPTY_RESPONSE');
      continue;
    }

    const indexed = parseIndexedUnitMap(raw, chunk.length);
    console.warn('🏷️ [QtyUnit-AI-EXACT] PARSED_INDEXED', {
      expected: chunk.length,
      got: Object.keys(indexed).length,
      indexed,
    });

    chunk.forEach((label, i) => {
      const unit = indexed[i + 1];
      if (unit) resultMap[label.toLowerCase()] = unit;
    });
  }

  console.warn('🏷️ [QtyUnit-AI-EXACT] BATCH_TOTAL', {
    input: unique.length,
    mapped: Object.keys(resultMap).length,
    sample: Object.entries(resultMap).slice(0, 5),
  });
  return resultMap;
}

let enrichInFlight: Promise<QuoteItem[]> | null = null;

/**
 * Fill missing quantityUnit via AI. Returns updated items array.
 */
export async function enrichMissingQtyUnitsWithAi(
  items: QuoteItem[],
  trace?: TraceContext
): Promise<QuoteItem[]> {
  if (enrichInFlight) {
    console.warn('🏷️ [QtyUnit-AI-EXACT] join in-flight enrich');
    return enrichInFlight;
  }

  const run = (async (): Promise<QuoteItem[]> => {
    const missingLabels: string[] = [];
    for (const item of items) {
      if (!isNaLikeUnit(item.quantityUnit)) continue;
      const label = itemLabel(item);
      if (label) missingLabels.push(label);
    }
    const uniqueMissing = [...new Set(missingLabels)];
    console.warn('🏷️ [QtyUnit-AI-EXACT] enrich start', {
      total: items.length,
      uniqueMissing: uniqueMissing.length,
    });

    const unitByLabel =
      uniqueMissing.length > 0 ? await inferQtyUnitsBatchRest(uniqueMissing, trace) : {};

    const out = items.map((item) => {
      if (!isNaLikeUnit(item.quantityUnit)) return item;
      const label = itemLabel(item);
      if (!label) return item;
      const unit = unitByLabel[label.toLowerCase()];
      return unit ? { ...item, quantityUnit: unit } : item;
    });

    console.warn('🏷️ [QtyUnit-AI-EXACT] enrich done', {
      withUnit: out.filter((i) => !isNaLikeUnit(i.quantityUnit)).length,
      stillMissing: out.filter((i) => isNaLikeUnit(i.quantityUnit)).length,
    });
    return out;
  })();

  enrichInFlight = run.finally(() => {
    enrichInFlight = null;
  });
  return run;
}

export async function inferQtyMeasurementUnitWithAi(
  serviceName: string,
  trace?: TraceContext
): Promise<string | undefined> {
  const map = await inferQtyUnitsBatchRest([serviceName], trace);
  return map[serviceName.trim().toLowerCase()];
}
