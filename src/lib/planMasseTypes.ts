/** Types partagés entre PlanMasseEditor et planMasseRenderer. */

export type MaterialType =
  | "tuiles_canal"
  | "tuiles_plates"
  | "ardoise"
  | "bac_acier"
  | "zinc"
  | "beton"
  | "gravillon"
  | "carrelage"
  | "bois_deck";

export interface MaterialConfig {
  type: MaterialType;
  colorOverride?: string; // couleur personnalisée (hex)
}

export interface MaterialPreset {
  label: string;
  fill: string;    // couleur de remplissage
  stroke: string;  // couleur de contour
  hatch: string;   // couleur des hachures sur les pans
}

export const MATERIAL_PRESETS: Record<MaterialType, MaterialPreset> = {
  tuiles_canal:  { label: "Tuiles canal",  fill: "#c87840", stroke: "#8B4010", hatch: "#7a3808" },
  tuiles_plates: { label: "Tuiles plates", fill: "#b09080", stroke: "#7a6050", hatch: "#6a5040" },
  ardoise:       { label: "Ardoise",       fill: "#6a7278", stroke: "#3a4248", hatch: "#2a3238" },
  bac_acier:     { label: "Bac acier",     fill: "#8898a8", stroke: "#5a7080", hatch: "#4a6070" },
  zinc:          { label: "Zinc",          fill: "#8a9aaa", stroke: "#5a7088", hatch: "#4a6078" },
  beton:         { label: "Béton",         fill: "#aaa8a4", stroke: "#7a7870", hatch: "#6a6860" },
  gravillon:     { label: "Gravillon",     fill: "#c8c0b0", stroke: "#909080", hatch: "#808070" },
  carrelage:     { label: "Carrelage",     fill: "#d8d2c4", stroke: "#a8a090", hatch: "#989080" },
  bois_deck:     { label: "Bois deck",     fill: "#a87040", stroke: "#6a4020", hatch: "#5a3010" },
};
