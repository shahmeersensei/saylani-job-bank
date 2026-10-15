import { listMasterData } from '@/domains/settings';
import { apiHandler, ok } from '@/domains/shared/http';
import { searchGeocode, searchGeocodeQuery } from '@/lib/geocode/search';

/**
 * GET /api/v1/geocode/search?q=Gulshan-e-Iqbal — search area or landmark in Pakistan.
 * Returns coordinates, formatted address line, and matching cityCode from master data.
 */
export const GET = apiHandler({
  auth: 'public',
  query: searchGeocodeQuery,
  handler: async ({ actor, query }) => {
    let cities: { code: string; label: string }[] = [];
    if (actor) {
      try {
        cities = (await listMasterData(actor, { type: 'CITY' })).map((c) => ({
          code: c.code,
          label: c.label,
        }));
      } catch {
        // Fallback if master data lookup fails
      }
    }
    const results = await searchGeocode(query.q, cities);
    return ok(results);
  },
});
