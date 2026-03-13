/**
 * collapse-sommaire-whitespace.jsx  — version multi-pages
 *
 * Fonctionnement :
 *   1. Détecte automatiquement TOUTES les pages sommaire du document
 *      (une page sommaire = une page qui possède un cadre nommé PREFIX+'titre_1')
 *   2. Pour chaque page sommaire, indépendamment :
 *        a. Masque les groupes de slots dont le titre est vide
 *        b. Réduit les cadres sous_titres à la hauteur exacte de leur contenu
 *        c. Remonte les cadres suivants pour combler les espaces libérés
 *
 * Toutes les pages sommaire du document sont traitées en un seul passage.
 * Chaque page est traitée indépendamment (le décalage (yOffset) se remet à 0
 * entre deux pages).
 *
 * Convention de nommage des cadres (identique au template InDesign) :
 *   SOMMAIRE_1_titre_N        — titre de l'entrée
 *   SOMMAIRE_1_page_N         — numéro de page (aligné à droite)
 *   SOMMAIRE_1_sous_titres_N  — sous-lignes "Nom\tPage" (clusters, inspirations…)
 *
 * Paramètres :
 *   PREFIX        — préfixe commun à tous les cadres sommaire
 *   MAX_SLOTS     — nombre de slots par page (= entries_per_page du template)
 *   GAP_BETWEEN_MM— espacement vertical entre deux slots (mm)
 */

// ── Paramètres ───────────────────────────────────────────────────────────────

var PREFIX         = 'SOMMAIRE_1_';
var MAX_SLOTS      = 12;
var GAP_BETWEEN_MM = 2;

// ─────────────────────────────────────────────────────────────────────────────

var MM_TO_PT = 2.834645669;
function mmToPt(mm) { return mm * MM_TO_PT; }

var doc = app.activeDocument;

// ── 1. Détecter toutes les pages sommaire ─────────────────────────────────────
// Une page est une page sommaire si elle contient un cadre PREFIX+'titre_1'

var sommairePagesIndexes = [];
for (var pi = 0; pi < doc.pages.length; pi++) {
  if (findFrameOnPage(doc.pages[pi], PREFIX + 'titre_1') !== null) {
    sommairePagesIndexes.push(pi);
  }
}

if (sommairePagesIndexes.length === 0) {
  alert('Aucune page sommaire détectée.\n' +
        'Vérifiez que les cadres sont nommés avec le préfixe "' + PREFIX + '".');
} else {
  $.writeln('[sommaire] ' + sommairePagesIndexes.length +
            ' page(s) sommaire détectée(s) : pages ' +
            sommairePagesIndexes.map(function(i){ return i + 1; }).join(', '));

  // ── 2. Traiter chaque page sommaire indépendamment ────────────────────────
  for (var s = 0; s < sommairePagesIndexes.length; s++) {
    var pageIdx = sommairePagesIndexes[s];
    var page    = doc.pages[pageIdx];
    $.writeln('\n--- Page ' + (pageIdx + 1) + ' (sommaire ' + (s + 1) + '/' +
              sommairePagesIndexes.length + ') ---');
    processPage(page);
  }

  $.writeln('\n[sommaire] Traitement terminé.');
  if (sommairePagesIndexes.length > 1) {
    alert('Collapse terminé sur ' + sommairePagesIndexes.length + ' pages sommaire.\n' +
          'Consultez la console (ESTK) pour le détail des gains.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Traiter une page sommaire : masquer les slots vides, réduire sous_titres,
// remonter les cadres suivants.
// ─────────────────────────────────────────────────────────────────────────────
function processPage(page) {
  var yOffset  = 0;   // décalage cumulatif vers le haut (pts) — remis à 0 par page
  var visible  = 0;
  var hidden   = 0;

  for (var n = 1; n <= MAX_SLOTS; n++) {
    var fTitre  = findFrameOnPage(page, PREFIX + 'titre_'      + n);
    var fPage   = findFrameOnPage(page, PREFIX + 'page_'       + n);
    var fSous   = findFrameOnPage(page, PREFIX + 'sous_titres_' + n);

    if (!fTitre) {
      $.writeln('  slot ' + n + ' : cadre titre introuvable, ignoré');
      continue;
    }

    var titreText = getContent(fTitre);

    // ── Slot vide → masquer tous les cadres, pas de déplacement ──────────
    if (!titreText) {
      setVisible(fTitre, false);
      setVisible(fPage,  false);
      setVisible(fSous,  false);
      hidden++;
      $.writeln('  slot ' + n + ' : vide → masqué');
      continue;
    }

    visible++;

    // ── Appliquer le décalage cumulé (remonter ce slot) ──────────────────
    if (yOffset > 0) {
      moveUp(fTitre, yOffset);
      moveUp(fPage,  yOffset);
      moveUp(fSous,  yOffset);
    }

    // ── Ajuster la hauteur du cadre sous_titres ───────────────────────────
    if (fSous) {
      var sousTxt = getContent(fSous);
      if (!sousTxt) {
        // Pas de sous-lignes → réduire à 0 et accumuler le gain
        var h = frameHeight(fSous);
        setFrameHeight(fSous, 0);
        setVisible(fSous, false);
        yOffset += h + mmToPt(GAP_BETWEEN_MM * 0.4);
        $.writeln('  slot ' + n + ' : sous_titres vide → gain ' +
                  Math.round(h / MM_TO_PT * 10) / 10 + ' mm');
      } else {
        // Sous-lignes présentes → fit exact
        var hBefore = frameHeight(fSous);
        fitToContent(fSous);
        var hAfter  = frameHeight(fSous);
        var gained  = hBefore - hAfter;
        if (gained > 0.5) { // ignorer les micro-différences < 0.5 pt
          yOffset += gained;
          $.writeln('  slot ' + n + ' : sous_titres réduit de ' +
                    Math.round(gained / MM_TO_PT * 10) / 10 + ' mm');
        }
      }
    }
  }

  var totalGainMm = Math.round(yOffset / MM_TO_PT * 10) / 10;
  $.writeln('  → ' + visible + ' slot(s) visible(s), ' + hidden + ' masqué(s), ' +
            totalGainMm + ' mm récupérés');
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cherche un cadre par son nom UNIQUEMENT dans les items de la page donnée.
 * Ignore les cadres d'autres pages ou du gabarit (master page).
 */
function findFrameOnPage(page, name) {
  try {
    var items = page.pageItems;          // items directs sur cette page (hors gabarit)
    for (var i = 0; i < items.length; i++) {
      if (items[i].name === name) return items[i];
      // Chercher aussi dans les groupes éventuels
      if (items[i].constructor.name === 'Group' || items[i].hasOwnProperty('pageItems')) {
        var found = findInGroup(items[i], name);
        if (found) return found;
      }
    }
    // Fallback : inclure les items du gabarit si non trouvé
    var allItems = page.allPageItems;
    for (var j = 0; j < allItems.length; j++) {
      if (allItems[j].name === name) return allItems[j];
    }
  } catch(e) {
    $.writeln('  findFrameOnPage error: ' + e.message);
  }
  return null;
}

function findInGroup(group, name) {
  try {
    var items = group.pageItems || group.allPageItems;
    for (var i = 0; i < items.length; i++) {
      if (items[i].name === name) return items[i];
    }
  } catch(e) {}
  return null;
}

function getContent(frame) {
  if (!frame) return '';
  try { return (frame.contents || '').toString().replace(/\s/g, ''); } catch(e) { return ''; }
}

function frameHeight(frame) {
  if (!frame) return 0;
  try {
    var b = frame.geometricBounds; // [y1, x1, y2, x2]
    return b[2] - b[0];
  } catch(e) { return 0; }
}

function setFrameHeight(frame, hPt) {
  if (!frame) return;
  try {
    var b = frame.geometricBounds;
    frame.geometricBounds = [b[0], b[1], b[0] + hPt, b[3]];
  } catch(e) {}
}

function fitToContent(frame) {
  if (!frame) return;
  try {
    // CS6+ : auto-size en hauteur uniquement
    if (frame.textFramePreferences &&
        typeof AutoSizingTypeEnum !== 'undefined') {
      frame.textFramePreferences.autoSizingType = AutoSizingTypeEnum.HEIGHT_ONLY;
    }
    frame.fit(FitOptions.FRAME_TO_CONTENT);
  } catch(e) {
    try { frame.fit(FitOptions.FRAME_TO_CONTENT); } catch(e2) {}
  }
}

function moveUp(frame, deltaPt) {
  if (!frame) return;
  try {
    var b = frame.geometricBounds;
    frame.geometricBounds = [b[0] - deltaPt, b[1], b[2] - deltaPt, b[3]];
  } catch(e) {}
}

function setVisible(frame, v) {
  if (!frame) return;
  try { frame.visible = v; } catch(e) {}
}
