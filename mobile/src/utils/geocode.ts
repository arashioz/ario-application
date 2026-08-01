/** تبدیل مختصات به آدرس خیابان (بدون نمایش lat/lng) */

export interface GeoAddress {
  display: string;
  road?: string;
  neighbourhood?: string;
  city?: string;
  state?: string;
}

function pick(addr: Record<string, string | undefined>, keys: string[]): string | undefined {
  for (const k of keys) {
    if (addr[k]) return addr[k];
  }
  return undefined;
}

function formatFromParts(addr: Record<string, string | undefined>): string {
  const road = pick(addr, ['road', 'pedestrian', 'path', 'residential', 'street']);
  const neighbourhood = pick(addr, ['neighbourhood', 'suburb', 'quarter', 'district', 'city_district']);
  const city = pick(addr, ['city', 'town', 'village', 'municipality', 'county']);
  const state = pick(addr, ['state', 'province', 'region']);
  const house = pick(addr, ['house_number']);

  const parts = [
    road ? (house ? `${road}، پلاک ${house}` : road) : null,
    neighbourhood,
    city,
    state && state !== city ? state : null,
  ].filter(Boolean) as string[];

  return parts.join('، ') || 'آدرس یافت نشد';
}

/** Nominatim — رایگان؛ برای ایران اغلب آدرس فارسی می‌دهد */
export async function reverseGeocode(lat: number, lng: number): Promise<GeoAddress> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}` +
    `&accept-language=fa&addressdetails=1`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      // Nominatim usage policy
      'User-Agent': 'ArioShop/1.0 (local wholesale app)',
    },
  });
  if (!res.ok) throw new Error('آدرس خیابان پیدا نشد');

  const data = (await res.json()) as {
    display_name?: string;
    address?: Record<string, string>;
  };
  const address = data.address || {};
  const display = formatFromParts(address);
  return {
    display: display !== 'آدرس یافت نشد' ? display : data.display_name || display,
    road: address.road,
    neighbourhood: address.neighbourhood || address.suburb,
    city: address.city || address.town || address.village,
    state: address.state,
  };
}
