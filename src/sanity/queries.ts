import { client } from "./client";

export interface SanityImage {
  _key?: string;
  asset: { _ref: string };
  hotspot?: { x: number; y: number };
  caption?: string;
}

export interface SanityProjet {
  _id: string;
  titre: string;
  slug: { current: string };
  localisation: string;
  categorie: string;
  annee: number;
  surface?: string;
  typologie?: string;
  mission?: string;
  avancement?: string;
  description?: string;
  imageprincipale?: SanityImage;
  galerie?: SanityImage[];
  plans?: SanityImage[];
}

const PROJET_CARD_FIELDS = `
  _id,
  titre,
  "slug": slug.current,
  localisation,
  categorie,
  annee,
  surface,
  imageprincipale
`;

export async function getProjets(): Promise<SanityProjet[]> {
  return client.fetch(
    `*[_type == "projet"] | order(ordre asc, annee desc) { ${PROJET_CARD_FIELDS} }`
  );
}

export async function getProjetBySlug(slug: string): Promise<SanityProjet | null> {
  return client.fetch(
    `*[_type == "projet" && slug.current == $slug][0] {
      _id,
      titre,
      "slug": slug.current,
      localisation,
      categorie,
      annee,
      surface,
      typologie,
      mission,
      avancement,
      description,
      prestations,
      imageprincipale,
      galerie[] { ..., "caption": caption },
      plans[] { ..., "caption": caption }
    }`,
    { slug }
  );
}

export async function getProjetsSlug(): Promise<{ slug: string }[]> {
  return client.fetch(`*[_type == "projet"]{ "slug": slug.current }`);
}
