import { NextRequest, NextResponse } from "next/server";

interface Feature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { label: string; citycode?: string };
}

async function fetchBAN(q: string, type?: string): Promise<Feature[] | null> {
  const params = new URLSearchParams({ q, limit: "6", autocomplete: "1" });
  if (type) params.set("type", type);
  const res = await fetch(`https://api-adresse.data.gouv.fr/search/?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  return (data.features ?? []).length > 0 ? data.features : null;
}

async function fetchNominatim(q: string, municipality: boolean): Promise<Feature[]> {
  const params = new URLSearchParams({
    q,
    format: "json",
    countrycodes: "fr",
    limit: "6",
    addressdetails: "1",
  });
  if (municipality) params.set("featuretype", "city");
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": "metaconception-plu/1.0" },
  });
  if (!res.ok) return [];
  const items: Array<{ display_name: string; lat: string; lon: string; address?: { postcode?: string } }> = await res.json();
  return items.map((item) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [parseFloat(item.lon), parseFloat(item.lat)] },
    properties: {
      label: item.display_name.split(",").slice(0, 3).join(",").trim(),
      citycode: item.address?.postcode ?? "",
    },
  }));
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const type = req.nextUrl.searchParams.get("type") ?? "";
  if (q.trim().length < 2) return NextResponse.json({ features: [] });

  try {
    const ban = await fetchBAN(q, type || undefined);
    if (ban) return NextResponse.json({ features: ban });
    const nom = await fetchNominatim(q, type === "municipality");
    return NextResponse.json({ features: nom });
  } catch {
    return NextResponse.json({ features: [] });
  }
}
