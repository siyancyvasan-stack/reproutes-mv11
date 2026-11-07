type NominatimPlace = {
  lat: string;
  lon: string;
  display_name: string;
};

export type PlaceMatch = {
  latitude: number;
  longitude: number;
  label: string;
};

/** Resolve a typed Sri Lankan address into a point for destination assignment. */
export const findSriLankanPlace = async (
  query: string,
  signal?: AbortSignal,
): Promise<PlaceMatch | null> => {
  const address = query.trim();
  if (address.length < 3) return null;
  const params = new URLSearchParams({
    q: address,
    format: "jsonv2",
    limit: "1",
    countrycodes: "lk",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Location search is temporarily unavailable.");
  const result = (await response.json()) as NominatimPlace[];
  const place = result[0];
  if (!place) return null;
  const latitude = Number(place.lat);
  const longitude = Number(place.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, label: place.display_name };
};
