/**
 * Détection des champs « nom de lieu » (toponymes touristiques).
 * Même logique pour les 8 langues cibles — pas de règle par langue.
 */

/** POI_titre_*, noms de cartes inspiration, entrées sommaire. */
const PLACE_NAME_FIELD_PATTERNS = [
  /^POI_titre_\d+$/,
  /^INSPIRATION_\d+_nom_\d+$/,
  /^SOMMAIRE_texte_1_entry_\d+$/,
];

export function isPlaceNameField(fieldKey: string): boolean {
  return PLACE_NAME_FIELD_PATTERNS.some(re => re.test(fieldKey));
}

export function splitTranslatableFields(fields: Record<string, string>): {
  placeNames: Record<string, string>;
  body: Record<string, string>;
} {
  const placeNames: Record<string, string> = {};
  const body: Record<string, string> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (isPlaceNameField(key)) placeNames[key] = value;
    else body[key] = value;
  }

  return { placeNames, body };
}
