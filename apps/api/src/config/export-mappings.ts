/**
 * Mapping des champs de template vers les noms de calques InDesign
 * et mapping des valeurs de picto vers les clés picto abstraites.
 *
 * Ces mappings sont inclus dans le JSON exporté afin que le script InDesign
 * puisse retrouver les calques/frames par leur nom sans connaître les conventions
 * internes du redactor-guide.
 */

// ─── Field → InDesign layer mapping ─────────────────────────────────────────
//
// Ce tableau est désormais vide : le nom du calque InDesign est identique au
// nom du champ de template (ex: POI_titre_1 → frame nommée "POI_titre_1").
// Utilise `indesign_layer` sur un champ de template uniquement pour un cas
// exceptionnel (gabarit InDesign hérité avec des noms non conformes).

export const FIELD_LAYER_MAPPINGS: Record<string, string> = {};

// ─── Picto layer mapping ─────────────────────────────────────────────────────

/**
 * Mapping des champs picto vers le calque InDesign de base.
 * Vide : le calque InDesign est identique au nom du champ (ex: POI_picto_interet).
 * Nomme tes frames picto InDesign exactement comme tes champs de template.
 */
export const PICTO_LAYER_MAPPINGS: Record<string, string> = {};

/**
 * Résout le variant_layer d'un picto depuis field.option_layers.
 *
 * Normalise la casse pour accepter "oui"/"Oui"/"OUI" de façon uniforme.
 * Retourne null si la valeur correspond à un état inactif (ex: "non": null dans option_layers).
 *
 * Pré-requis : chaque champ picto du template doit définir option_layers.
 * Ex : { "oui": "picto_escaliers", "non": null }
 */
export function resolveVariantLayer(
  optionLayers: Record<string, string | null> | undefined,
  value: string
): string | null {
  if (!optionLayers) return null;
  // Essai exact, puis minuscules, puis première lettre majuscule
  return (
    optionLayers[value] ??
    optionLayers[value.toLowerCase()] ??
    optionLayers[value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()] ??
    null
  );
}

/** Retourne vrai si un champ est de type picto */
export function isPictoField(fieldName: string): boolean {
  return fieldName.includes('_picto_');
}

/**
 * Retourne le nom du calque InDesign pour un champ donné.
 *
 * Convention : le nom du calque InDesign est identique au nom du champ de template.
 *   POI_titre_1        → POI_titre_1
 *   COUVERTURE_image_1 → COUVERTURE_image_1
 *
 * Nomme donc tes frames InDesign exactement comme tes champs de template.
 * Utilisé en fallback quand `field.indesign_layer` n'est pas renseigné.
 */
export function deriveLayerName(fieldName: string): string {
  return fieldName;
}

/**
 * Résout le nom du calque InDesign pour un champ donné.
 * Priorité : field.indesign_layer > FIELD_LAYER_MAPPINGS > PICTO_LAYER_MAPPINGS > deriveLayerName()
 *
 * À utiliser dans export.service.ts plutôt que resolveLayerName() hardcodée.
 */
export function resolveFieldLayer(fieldName: string, explicitLayer?: string): string {
  return (
    explicitLayer ??
    FIELD_LAYER_MAPPINGS[fieldName] ??
    PICTO_LAYER_MAPPINGS[fieldName] ??
    deriveLayerName(fieldName)
  );
}

/** @deprecated Utiliser resolveFieldLayer() à la place */
export function resolveLayerName(fieldName: string): string {
  return resolveFieldLayer(fieldName);
}
