import { defineField, defineType } from "sanity";

export const projetType = defineType({
  name: "projet",
  title: "Projet",
  type: "document",
  fields: [
    defineField({
      name: "titre",
      title: "Titre",
      type: "string",
      validation: (r) => r.required(),
    }),
    defineField({
      name: "slug",
      title: "Slug (URL)",
      type: "slug",
      options: { source: "titre" },
      validation: (r) => r.required(),
    }),
    defineField({
      name: "localisation",
      title: "Localisation",
      type: "string",
      validation: (r) => r.required(),
    }),
    defineField({
      name: "categorie",
      title: "Catégorie",
      type: "string",
      options: {
        list: [
          { title: "Maison individuelle", value: "Maison individuelle" },
          { title: "Extension", value: "Extension" },
          { title: "Rénovation", value: "Rénovation" },
          { title: "Aménagement", value: "Aménagement" },
          { title: "Opérations immobilières", value: "Opérations immobilières" },
          { title: "Déclaration préalable", value: "Déclaration préalable" },
        ],
      },
      validation: (r) => r.required(),
    }),
    defineField({
      name: "annee",
      title: "Année",
      type: "number",
      validation: (r) => r.required().min(2000).max(2100),
    }),
    defineField({
      name: "surface",
      title: "Surface (ex: 180 m²)",
      type: "string",
    }),
    defineField({
      name: "typologie",
      title: "Typologie (ex: T3, T4, Villa...)",
      type: "string",
    }),
    defineField({
      name: "mission",
      title: "Mission (ex: ESQ+AVP+PC)",
      type: "string",
    }),
    defineField({
      name: "avancement",
      title: "Avancement (ex: PC accepté, Maison terminée...)",
      type: "string",
    }),
    defineField({
      name: "dimensions",
      title: "Dimensions (ex: 8×4 m)",
      type: "string",
    }),
    defineField({
      name: "volume",
      title: "Volume (ex: 32 m³)",
      type: "string",
    }),
    defineField({
      name: "typePiscine",
      title: "Type de piscine",
      type: "string",
      options: {
        list: [
          { title: "Enterrée", value: "Enterrée" },
          { title: "Semi-enterrée", value: "Semi-enterrée" },
          { title: "Hors-sol", value: "Hors-sol" },
        ],
      },
    }),
    defineField({
      name: "video",
      title: "Vidéo Vimeo (URL)",
      type: "url",
      description: "Ex: https://vimeo.com/123456789",
    }),
    defineField({
      name: "description",
      title: "Description du projet",
      type: "text",
      rows: 5,
    }),
    defineField({
      name: "imageprincipale",
      title: "Image principale",
      type: "image",
      options: { hotspot: true },
      validation: (r) => r.required(),
    }),
    defineField({
      name: "galerie",
      title: "Galerie de photos",
      type: "array",
      of: [
        {
          type: "image",
          options: { hotspot: true },
          fields: [
            defineField({
              name: "caption",
              title: "Légende",
              type: "string",
            }),
          ],
        },
      ],
    }),
    defineField({
      name: "plans",
      title: "Plans",
      type: "array",
      of: [
        {
          type: "image",
          options: { hotspot: true },
          fields: [
            defineField({
              name: "caption",
              title: "Légende (ex: Plan de masse, Coupe A-A...)",
              type: "string",
            }),
          ],
        },
      ],
    }),
    defineField({
      name: "ordre",
      title: "Ordre d'affichage",
      type: "number",
      description: "1 = affiché en premier",
    }),
  ],
  orderings: [
    {
      title: "Ordre d'affichage",
      name: "ordreAsc",
      by: [{ field: "ordre", direction: "asc" }],
    },
    {
      title: "Année (récent d'abord)",
      name: "anneeDesc",
      by: [{ field: "annee", direction: "desc" }],
    },
  ],
});
