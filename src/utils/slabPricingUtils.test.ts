import { describe, expect, it } from 'vitest';
import {
  buildLineItemsFromSlabs,
  buildTheatreRateCardRow,
  isNonTypeMediumType,
  isSlabPricingService,
  listRateSlabs,
  parseSlabServiceId,
  slabQuoteServiceId,
} from './slabPricingUtils';
import { hasQuotablePricing, buildLineItemsFromDbPricing } from './dbPricingUtils';
import type { DbService } from './serviceResolver';
import {
  normalizeVendorRateRow,
  vendorRatesToDbServices,
} from '../services/vendorRateService';
import type { VendorRateRow } from '../types/vendorRate';

function theatreSvc(): DbService {
  return {
    service_id: 'theatre_screen_ad-chennai-cinepolis_bsr_sentosa_avenue',
    service_name: 'THEATRE SCREEN AD',
    content: 'theatre',
    document_id: 'doc',
    document_name: 'xls',
    metadata: {
      city: 'Chennai',
      medium: 'THEATRE SCREEN AD',
      medium_type: 'multi_rate_slabs',
      pricing_mode: 'per_spot_scale',
      area_name: 'Cinepolis Bsr Sentosa Avenue',
      direction_remarks: 'State: Tamil Nadu',
      min_qty: 8,
      pricing: { display_price: 'NA', total_price: 0 },
      slabs: {
        slab_1: {
          qty: 8,
          label: 'Cinepolis Bsr Sentosa Avenue · Rate for 10s in a week',
          price: 80000,
          min_days: 7,
          cost_unit: 'WEEK',
          display_cost: 68000,
          display_unit_cost_per_day: 9714.29,
        },
        slab_4: {
          qty: 1,
          label: 'Cinepolis Bsr Sentosa Avenue · Arch Gate',
          price: 282352.94,
          min_days: 30,
          cost_unit: 'MONTH',
          display_cost: 240000,
          display_unit_cost_per_day: 8000,
        },
      },
    },
  };
}

describe('slabPricingUtils', () => {
  it('lists slabs and marks service quotable', () => {
    const svc = theatreSvc();
    expect(isSlabPricingService(svc)).toBe(true);
    expect(hasQuotablePricing(svc)).toBe(true);
    expect(listRateSlabs(svc)).toHaveLength(2);
  });

  it('treats multi_rate_slabs as non-type', () => {
    expect(isNonTypeMediumType('multi_rate_slabs')).toBe(true);
    expect(isNonTypeMediumType('Frontlit')).toBe(false);
  });

  it('builds package lines ≈ selling price (not cost)', () => {
    const items = buildLineItemsFromSlabs(theatreSvc(), ['slab_1', 'slab_4'], 0);
    expect(items).toHaveLength(2);
    expect(Math.round(items[0].total)).toBe(80000);
    expect(Math.round(items[1].total)).toBe(282353);
    expect(items[0].serviceId).toBe(
      slabQuoteServiceId(theatreSvc().service_id, 'slab_1'),
    );
    expect(items[0].serviceName).toContain('Cinepolis');
  });

  it('buildLineItemsFromDbPricing requires keys when 2+ slabs', () => {
    const svc = theatreSvc();
    expect(buildLineItemsFromDbPricing(svc, 1, '', 0)).toEqual([]);
    expect(buildLineItemsFromDbPricing(svc, 1, '', 0, ['slab_1'])).toHaveLength(1);
  });

  it('builds rate card row with selling prices', () => {
    const card = buildTheatreRateCardRow(theatreSvc());
    expect(card?.cinema).toContain('Cinepolis');
    expect(card?.rate10sWeek).toBe(80000);
    expect(card?.archMonth).toBe(282352.94);
    expect(card?.state).toBe('Tamil Nadu');
  });

  it('keeps slabKeys through review draft', async () => {
    const { createReviewDraft, reviewItemsToConfirmationRows } = await import(
      './quoteReviewDraft'
    );
    const draft = createReviewDraft(
      [{
        service: 'Theatre',
        qty: 1,
        city: 'Chennai',
        serviceId: 'abc',
        slabKeys: ['slab_1', 'slab_4'],
      }],
      'ai',
      'theatre',
      [],
    );
    expect(draft.items[0].slabKeys).toEqual(['slab_1', 'slab_4']);
    expect(reviewItemsToConfirmationRows(draft.items)[0].slabKeys).toEqual([
      'slab_1',
      'slab_4',
    ]);
  });

  it('keeps slabs through vendor normalize → catalog', () => {
    const row = normalizeVendorRateRow({
      service_id: 'theatre_screen_ad-chennai-x',
      service_name: 'THEATRE SCREEN AD',
      metadata: {
        city: 'Chennai',
        medium: 'THEATRE SCREEN AD',
        medium_type: 'multi_rate_slabs',
        pricing_mode: 'per_spot_scale',
        area_name: 'Test Cinema',
        pricing: { display_price: 'NA' },
        slabs: {
          slab_1: {
            qty: 1,
            label: '10s',
            price: 100,
            min_days: 7,
            cost_unit: 'WEEK',
            display_cost: 100,
            display_unit_cost_per_day: 100 / 7,
          },
        },
      },
    });
    expect(row?.slabs?.slab_1).toBeTruthy();
    const catalog = vendorRatesToDbServices([row as VendorRateRow]);
    expect(hasQuotablePricing(catalog[0])).toBe(true);
    expect(parseSlabServiceId('a|slab_2')?.slabKey).toBe('slab_2');
  });
});
