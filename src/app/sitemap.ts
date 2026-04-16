import type { MetadataRoute } from "next";
import { getProjetsSlug } from "@/sanity/queries";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await getProjetsSlug();

  const projets = slugs.map((s) => ({
    url: `https://metaconception.eu/realisations/${s.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  return [
    {
      url: "https://metaconception.eu",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: "https://metaconception.eu/realisations",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...projets,
  ];
}
