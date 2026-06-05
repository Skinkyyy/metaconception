// Types de surfaces dessinées et leurs règles PLU associées

export type ShapeType =
  | "rdc" | "r1" | "r2"
  | "garage" | "annexe"
  | "piscine" | "terrasse"
  | "parking" | "autre";

export interface ShapeTypeConfig {
  label: string;
  color: string;
  // Calculs de surface
  compteEmpriseSol: boolean;       // inclus dans l'emprise au sol PLU
  compteSurfacePlancher: boolean;  // inclus dans la surface de plancher
  // Application des retraits
  appliqueRetraitLateral: boolean; // doit respecter le retrait latéral/fond
  appliqueRetraitVoirie: boolean;  // doit respecter le retrait voirie
  appliqueGabarit: boolean;        // soumis à la règle H ≤ L (ou H ≤ 2L)
  // Hauteurs par défaut (Phase 1 → Phase 2 3D)
  hauteurBaseDefaut: number;       // pied du volume au-dessus du sol naturel (m)
  hauteurFaitageDefaut: number;    // sommet du volume — hauteur PLU (m)
  hauteurMaxPLU: number | null;    // contrainte propre au type (ex: annexe 3.5 m)
}

export const SHAPE_TYPE_CONFIG: Record<ShapeType, ShapeTypeConfig> = {
  rdc: {
    label: "RDC", color: "#2563eb",
    compteEmpriseSol: true,  compteSurfacePlancher: true,
    appliqueRetraitLateral: true,  appliqueRetraitVoirie: true,  appliqueGabarit: true,
    hauteurBaseDefaut: 0,   hauteurFaitageDefaut: 3,   hauteurMaxPLU: null,
  },
  r1: {
    label: "R+1", color: "#7c3aed",
    compteEmpriseSol: true, compteSurfacePlancher: true,
    appliqueRetraitLateral: true,  appliqueRetraitVoirie: true,  appliqueGabarit: true,
    hauteurBaseDefaut: 3,   hauteurFaitageDefaut: 6,   hauteurMaxPLU: null,
  },
  r2: {
    label: "R+2", color: "#9333ea",
    compteEmpriseSol: true, compteSurfacePlancher: true,
    appliqueRetraitLateral: true,  appliqueRetraitVoirie: true,  appliqueGabarit: true,
    hauteurBaseDefaut: 6,   hauteurFaitageDefaut: 9,   hauteurMaxPLU: null,
  },
  garage: {
    label: "Garage", color: "#64748b",
    compteEmpriseSol: true,  compteSurfacePlancher: false,
    appliqueRetraitLateral: true,  appliqueRetraitVoirie: true,  appliqueGabarit: false,
    hauteurBaseDefaut: 0,   hauteurFaitageDefaut: 2.5, hauteurMaxPLU: null,
  },
  annexe: {
    label: "Annexe", color: "#f97316",
    compteEmpriseSol: true,  compteSurfacePlancher: false,
    appliqueRetraitLateral: false, appliqueRetraitVoirie: true,  appliqueGabarit: false,
    hauteurBaseDefaut: 0,   hauteurFaitageDefaut: 3.5, hauteurMaxPLU: 3.5,
  },
  piscine: {
    label: "Piscine", color: "#0ea5e9",
    compteEmpriseSol: false, compteSurfacePlancher: false,
    appliqueRetraitLateral: false, appliqueRetraitVoirie: false, appliqueGabarit: false,
    hauteurBaseDefaut: -1.5, hauteurFaitageDefaut: 0.2, hauteurMaxPLU: null,
  },
  terrasse: {
    label: "Terrasse", color: "#eab308",
    compteEmpriseSol: false, compteSurfacePlancher: false,
    appliqueRetraitLateral: false, appliqueRetraitVoirie: false, appliqueGabarit: false,
    hauteurBaseDefaut: 0,   hauteurFaitageDefaut: 0.3, hauteurMaxPLU: null,
  },
  parking: {
    label: "Stationnement", color: "#f59e0b",
    compteEmpriseSol: false, compteSurfacePlancher: false,
    appliqueRetraitLateral: false, appliqueRetraitVoirie: false, appliqueGabarit: false,
    hauteurBaseDefaut: 0,   hauteurFaitageDefaut: 0,   hauteurMaxPLU: null,
  },
  autre: {
    label: "Autre", color: "#94a3b8",
    compteEmpriseSol: true,  compteSurfacePlancher: false,
    appliqueRetraitLateral: true,  appliqueRetraitVoirie: true,  appliqueGabarit: false,
    hauteurBaseDefaut: 0,   hauteurFaitageDefaut: 3,   hauteurMaxPLU: null,
  },
};

// Ordre d'affichage dans la palette de dessin (parking = auto uniquement)
export const SHAPE_TYPES_PALETTE: ShapeType[] = [
  "rdc", "r1", "r2", "garage", "annexe", "piscine", "terrasse", "autre",
];
