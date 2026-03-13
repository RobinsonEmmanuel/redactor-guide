/**
 * collapse-sommaire-whitespace.jsx
 *
 * À exécuter APRÈS le data-merge du sommaire.
 *
 * Pour chaque slot sommaire (1 à MAX_SLOTS), le script :
 *   1. Masque le groupe entier si le titre est vide (slot non rempli)
 *   2. Pour les slots visibles, redimensionne le cadre "sous_titres" à la
 *      hauteur exacte de son contenu (supprime le blanc inférieur)
 *   3. Remonte tous les cadres suivants pour fermer les espaces vides
 *
 * Convention de nommage des cadres (même que le template) :
 *   SOMMAIRE_1_titre_N        — cadre titre principal
 *   SOMMAIRE_1_page_N         — cadre numéro de page (niveau titre)
 *   SOMMAIRE_1_sous_titres_N  — cadre sous-lignes (clusters / inspirations / saisons)
 *
 * Chaque "groupe" N est supposé avoir une hauteur de référence stockée dans
 * la variable SLOT_HEIGHT_MM (hauteur quand sous_titres est vide).
 * Si le sous_titres déborde, la hauteur effective est calculée via fitContent.
 *
 * Utilisation :
 *   1. Ouvrir le document InDesign après data-merge
 *   2. Sélectionner la ou les pages sommaire
 *   3. Exécuter ce script via Fichier > Scripts > Exécuter un script
 */

// ── Paramètres à adapter selon ton gabarit ───────────────────────────────────

var PREFIX          = 'SOMMAIRE_1_';   // préfixe des noms de cadre
var MAX_SLOTS       = 12;              // entrées par page (= entries_per_page du template)
var SLOT_HEIGHT_MM  = 12;              // hauteur d'un slot sans sous_titres (en mm)
var GAP_BETWEEN_MM  = 2;               // espacement vertical entre deux slots (en mm)
var MM_TO_PT        = 2.834645669;     // 1 mm = 2.834645669 pt (unité interne InDesign)

// ─────────────────────────────────────────────────────────────────────────────

function mmToPt(mm) { return mm * MM_TO_PT; }

var doc = app.activeDocument;

// Traiter toutes les pages du document (si plusieurs pages sommaire)
for (var pi = 0; pi < doc.pages.length; pi++) {
  var page = doc.pages[pi];
  processPage(page);
}

function processPage(page) {
  var yOffset = 0; // décalage cumulé vers le haut (en pt) dû aux slots masqués / réduits

  for (var n = 1; n <= MAX_SLOTS; n++) {
    var frameTitre     = findFrame(page, PREFIX + 'titre_'     + n);
    var framePage      = findFrame(page, PREFIX + 'page_'      + n);
    var frameSousTitres = findFrame(page, PREFIX + 'sous_titres_' + n);

    if (!frameTitre) continue; // cadre introuvable → passer

    // ── 1. Slot vide → masquer tous les cadres du groupe ─────────────────
    var titreText = getFrameText(frameTitre);
    if (!titreText) {
      setVisible(frameTitre,      false);
      setVisible(framePage,       false);
      setVisible(frameSousTitres, false);
      continue; // pas de décalage à appliquer (cadres masqués, pas de hauteur)
    }

    // ── 2. Slot visible → appliquer le décalage cumulé ───────────────────
    if (yOffset > 0) {
      moveFrameUp(frameTitre,      yOffset);
      moveFrameUp(framePage,       yOffset);
      moveFrameUp(frameSousTitres, yOffset);
    }

    // ── 3. Redimensionner le cadre sous_titres à la hauteur du contenu ───
    if (frameSousTitres) {
      var sousTitresText = getFrameText(frameSousTitres);
      if (!sousTitresText) {
        // Aucune sous-ligne → réduire la hauteur à 0 et accumuler le gain
        var originalHeight = getFrameHeight(frameSousTitres);
        setFrameHeight(frameSousTitres, 0);
        setVisible(frameSousTitres, false);
        yOffset += originalHeight + mmToPt(GAP_BETWEEN_MM / 2);
      } else {
        // Ajuster à la hauteur exacte du contenu
        var before = getFrameHeight(frameSousTitres);
        fitFrameToContent(frameSousTitres);
        var after  = getFrameHeight(frameSousTitres);
        var saved  = before - after;
        if (saved > 0) yOffset += saved;
      }
    }
  }

  if (yOffset > 0) {
    $.writeln('[sommaire] Page "' + page.name + '" : ' +
      Math.round(yOffset / MM_TO_PT * 10) / 10 + ' mm récupérés');
  }
}

// ── Utilitaires ──────────────────────────────────────────────────────────────

function findFrame(page, name) {
  try {
    var items = page.allPageItems;
    for (var i = 0; i < items.length; i++) {
      if (items[i].name === name) return items[i];
    }
  } catch(e) {}
  return null;
}

function getFrameText(frame) {
  if (!frame) return '';
  try { return frame.contents || ''; } catch(e) { return ''; }
}

function getFrameHeight(frame) {
  if (!frame) return 0;
  try {
    var b = frame.geometricBounds; // [y1, x1, y2, x2]
    return b[2] - b[0];
  } catch(e) { return 0; }
}

function setFrameHeight(frame, heightPt) {
  if (!frame) return;
  try {
    var b = frame.geometricBounds;
    frame.geometricBounds = [b[0], b[1], b[0] + heightPt, b[3]];
  } catch(e) {}
}

function fitFrameToContent(frame) {
  if (!frame) return;
  try {
    // Forcer l'auto-size du cadre texte si disponible (CS6+)
    if (frame.textFramePreferences) {
      frame.textFramePreferences.autoSizingType = AutoSizingTypeEnum.HEIGHT_ONLY;
    }
    frame.fit(FitOptions.FRAME_TO_CONTENT);
  } catch(e) {
    // Fallback : ajuster manuellement à partir du nombre de lignes
    try { frame.fit(FitOptions.FRAME_TO_CONTENT); } catch(e2) {}
  }
}

function moveFrameUp(frame, deltaPt) {
  if (!frame) return;
  try {
    var b = frame.geometricBounds;
    frame.geometricBounds = [b[0] - deltaPt, b[1], b[2] - deltaPt, b[3]];
  } catch(e) {}
}

function setVisible(frame, visible) {
  if (!frame) return;
  try { frame.visible = visible; } catch(e) {}
}
