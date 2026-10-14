import { listMasterData } from '@/domains/settings';
import { apiHandler, ok } from '@/domains/shared/http';
import { reverseGeocode, reverseGeocodeQuery } from '@/lib/geocode/reverse';

/**
 * GET /api/v1/geocode/reverse?lat=24.86&lng=67.00 — map pin → address line +
 * city code (matched against CITY master data). Any signed-in user; used by
 * the employer job form to autofill the location after placing a pin.
 */
export const GET = apiHandler({
  query: reverseGeocodeQuery,
  handler: async ({ actor, query }) => {
    const cities = (await listMasterData(actor!, { type: 'CITY' })).map((c) => ({
      code: c.code,
      label: c.label,
    }));
    return ok(await reverseGeocode(query.lat, query.lng, cities));
  },
});
