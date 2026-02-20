/**
 * generate-poi-pages.jsx
 * Script InDesign ExtendScript — génération automatique des pages POI
 *
 * Prérequis InDesign :
 *   - Un style de caractère nommé "Gras" (pour le bold **...**)
 *   - Un gabarit nommé "B-POI_TEMPLATE"
 *   - Les blocs étiquetés (label) selon le mapping InDesign du guide
 *   - Le JSON exporté depuis l'app (export ZIP recommandé : JSON + images locales)
 *
 * Usage :
 *   Fichier > Scripts > Parcourir… → sélectionner ce fichier
 *   Une boîte de dialogue demande le fichier JSON
 */

#target indesign
#include "json2.js"

var doc = app.activeDocument;

// ─── Configuration ────────────────────────────────────────────────────────────
var BOLD_STYLE_NAME    = "Gras";
var BULLET_LEFT_INDENT = 6.35;  // mm — retrait gauche paragraphe puce
var BULLET_FIRST_LINE  = -6.35; // mm — retrait première ligne (hanging indent)
var BULLET_SPACE_AFTER = 7;     // mm — espace après chaque puce
var PICTO_W            = 12.7;  // mm — largeur d'un bloc picto (gabarit)
var PICTO_H            = 19.7;  // mm — hauteur d'un bloc picto (gabarit)
var PICTO_GAP          = 1;     // mm — espace entre pictos
var DURATION_GAP       = 3;     // mm — espace entre dernier picto et clock/durée

// Champs dont le texte est rendu en liste à puces
var BULLET_LIST_FIELDS = { "POI_texte_2": true };

// Champs gérés par injectPictoBar — exclus de l'injection texte standard
var SKIP_IN_TEXT_STEP  = { "POI_meta_duree": true };

// ─── 1. Charger JSON ──────────────────────────────────────────────────────────
var jsonFile = File.openDialog("Choisir le JSON du guide");
if (!jsonFile) exit();

var rootFolder = jsonFile.parent;
jsonFile.encoding = "UTF-8";
jsonFile.open("r");
var raw = jsonFile.read();
jsonFile.close();

var data = JSON.parse(raw);

// ─── 2. Trouver les blocs par label (page courante uniquement) ────────────────
function findByLabelOnPage(page, label) {
    var items = page.allPageItems;
    var res = [];
    for (var i = 0; i < items.length; i++) {
        if (items[i].label == label) {
            try {
                if (items[i].parentPage && items[i].parentPage.name === page.name) {
                    res.push(items[i]);
                }
            } catch(e) {
                res.push(items[i]);
            }
        }
    }
    return res;
}

// ─── 3. Déplacer un objet sans toucher au contenu intérieur ──────────────────
// Utilise move() au lieu de geometricBounds = pour préserver le ratio image
function moveItem(item, targetX, targetY) {
    var b = item.geometricBounds; // [top, left, bottom, right]
    var deltaX = targetX - b[1];
    var deltaY = targetY - b[0];
    item.move(null, [deltaX, deltaY]);
}

// ─── 4. Appliquer le gras via GREP (cherche **...**, applique style, supprime marqueurs)
// Approche GREP : évite tout calcul d'indices de caractères (incompatible avec ExtendScript)
function applyBoldMarkers(tf) {
    var boldStyle = doc.characterStyles.itemByName(BOLD_STYLE_NAME);

    // Chercher les patterns **...** dans ce bloc texte
    app.findGrepPreferences  = NothingEnum.NOTHING;
    app.changeGrepPreferences = NothingEnum.NOTHING;
    app.findGrepPreferences.findWhat = "\\*\\*[^*]+\\*\\*";
    var matches = tf.findGrep();
    app.findGrepPreferences = NothingEnum.NOTHING;

    // Appliquer le style "Gras" à chaque correspondance (marqueurs inclus)
    if (boldStyle.isValid) {
        for (var m = 0; m < matches.length; m++) {
            matches[m].appliedCharacterStyle = boldStyle;
        }
    }

    // Supprimer les marqueurs ** — le texte garde le style gras
    app.findGrepPreferences  = NothingEnum.NOTHING;
    app.changeGrepPreferences = NothingEnum.NOTHING;
    app.findGrepPreferences.findWhat  = "\\*\\*";
    app.changeGrepPreferences.changeTo = "";
    tf.changeGrep();
    app.findGrepPreferences  = NothingEnum.NOTHING;
    app.changeGrepPreferences = NothingEnum.NOTHING;
}

// ─── 5. Injecter texte simple avec gras optionnel ────────────────────────────
function setTextWithBold(textFrame, rawText) {
    textFrame.contents = rawText;   // définir avec les marqueurs ** en place
    applyBoldMarkers(textFrame);    // GREP trouve, style, supprime **
}

// ─── 6. Injecter texte (masque le bloc si vide / absent) ─────────────────────
function injectText(page, label, value) {
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        var isEmpty = (value === null || value === undefined ||
                       String(value).replace(/^\s+|\s+$/, "") === "");
        if (isEmpty) {
            blocks[i].visible = false;
        } else {
            blocks[i].visible = true;
            blocks[i].contents = "";
            var strValue = String(value);
            if (strValue.indexOf("**") !== -1) {
                setTextWithBold(blocks[i], strValue);
            } else {
                blocks[i].contents = strValue;
            }
        }
    }
}

// ─── 7. Injecter liste à puces avec mise en forme paragraphe ─────────────────
function injectBulletText(page, label, value) {
    var BULLET = "\u2022\t";
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        if (!value) { blocks[i].visible = false; continue; }
        blocks[i].visible = true;
        var tf = blocks[i];
        tf.contents = "";

        var rawLines = value.split("\n");
        var items = [];
        for (var l = 0; l < rawLines.length; l++) {
            var line = rawLines[l].replace(/^\s+|\s+$/, "");
            if (line !== "") items.push(line);
        }
        if (items.length === 0) { blocks[i].visible = false; continue; }

        // Construire le texte avec les marqueurs ** conservés (GREP les traitera)
        var fullText = "";
        for (var it = 0; it < items.length; it++) {
            fullText += (it > 0 ? "\r" : "") + BULLET + items[it];
        }

        tf.contents = fullText;

        // Appliquer le gras via GREP si des marqueurs ** sont présents
        if (fullText.indexOf("**") !== -1) {
            applyBoldMarkers(tf);
        }

        // Mise en forme paragraphe : hanging indent + espace après + tab stop
        for (var pg = 0; pg < tf.paragraphs.length; pg++) {
            var para = tf.paragraphs.item(pg);
            para.leftIndent      = BULLET_LEFT_INDENT;
            para.firstLineIndent = BULLET_FIRST_LINE;
            para.spaceAfter      = BULLET_SPACE_AFTER;
            while (para.tabStops.length > 0) {
                para.tabStops.item(0).remove();
            }
            var ts = para.tabStops.add();
            ts.alignment = TabStopAlignment.LEFT_ALIGN;
            ts.position  = BULLET_LEFT_INDENT;
        }
    }
}

// ─── 7. Injecter image (local en priorité, URL en fallback) ──────────────────
function injectImage(page, label, imageData) {
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (!imageData || (!imageData.local && !imageData.url)) {
            block.visible = false;
            continue;
        }
        block.visible = true;
        var placed = false;
        if (imageData.local) {
            var localFile = new File(rootFolder.fullName + "/" + imageData.local);
            if (localFile.exists) {
                try {
                    block.place(localFile);
                    block.fit(FitOptions.FILL_PROPORTIONALLY);
                    placed = true;
                } catch(e) {}
            }
        }
        if (!placed && imageData.url) {
            try {
                block.place(new File(imageData.url));
                block.fit(FitOptions.FILL_PROPORTIONALLY);
            } catch(e) { block.visible = false; }
        }
    }
}

// ─── 8. Barre de pictos avec reflow dynamique + durée ────────────────────────
// Inclut les labels de base ET les variants pour masquer tous les blocs possibles
var ALL_PICTO_LABELS = [
    "picto_interet",  "picto_interet_1", "picto_interet_2", "picto_interet_3",
    "picto_pmr",      "picto_pmr_full",  "picto_pmr_half",  "picto_pmr_none",
    "picto_escaliers",    "picto_escaliers_oui",
    "picto_toilettes",    "picto_toilettes_oui",
    "picto_restauration", "picto_restauration_oui",
    "picto_famille",      "picto_famille_oui",
    "picto_duree"
];

var PICTO_ORDER = [
    "POI_picto_interet",
    "POI_picto_pmr",
    "POI_picto_escaliers",
    "POI_picto_toilettes",
    "POI_picto_restauration",
    "POI_picto_famille"
];

/**
 * Positionne les pictos actifs en reflow horizontal.
 * Gère également picto_duree (clock) et txt_poi_duree en fin de barre.
 *
 * @param {Page}   page          - page InDesign cible
 * @param {Object} pictoContent  - pageData.content.pictos
 * @param {string} durationValue - valeur de POI_meta_duree (ou null)
 */
function injectPictoBar(page, pictoContent, durationValue) {

    // 1. Masquer TOUS les blocs pictos (labels base + variants) + texte durée
    for (var p = 0; p < ALL_PICTO_LABELS.length; p++) {
        var pBlocks = findByLabelOnPage(page, ALL_PICTO_LABELS[p]);
        for (var b = 0; b < pBlocks.length; b++) {
            pBlocks[b].visible = false;
        }
    }
    var durTextBlocks = findByLabelOnPage(page, "txt_poi_duree");
    for (var d = 0; d < durTextBlocks.length; d++) {
        durTextBlocks[d].visible = false;
    }

    if (!pictoContent) return;

    // 2. Collecter les pictos actifs dans l'ordre défini
    var activePictos = [];
    for (var o = 0; o < PICTO_ORDER.length; o++) {
        var fieldKey = PICTO_ORDER[o];
        var pictoData = pictoContent[fieldKey];
        if (!pictoData || !pictoData.picto_key) continue;

        var found = [];
        if (pictoData.variant_layer) found = findByLabelOnPage(page, pictoData.variant_layer);
        if (found.length === 0 && pictoData.indesign_layer) found = findByLabelOnPage(page, pictoData.indesign_layer);
        if (found.length > 0) activePictos.push(found[0]);
    }

    if (activePictos.length === 0) return;

    // 3. Référence : position du PREMIER picto actif (pas de picto_bar_anchor)
    //    → le 1er picto ne bouge pas, les suivants se calent contre lui
    var refBounds = activePictos[0].geometricBounds; // [top, left, bottom, right]
    var refX = refBounds[1];
    var refY = refBounds[0];
    var currentX = refX;

    // 4. Repositionner chaque picto avec move() (préserve le contenu intérieur)
    //    Utilise la largeur RÉELLE du bloc (pas la constante PICTO_W) pour éviter
    //    tout décalage si les blocs ont des largeurs légèrement différentes.
    for (var a = 0; a < activePictos.length; a++) {
        var pictoW = activePictos[a].geometricBounds[3] - activePictos[a].geometricBounds[1];
        moveItem(activePictos[a], currentX, refY);
        activePictos[a].visible = true;
        currentX += pictoW + PICTO_GAP;
    }

    // 5. Picto durée (clock) + texte durée en fin de barre
    if (durationValue) {
        currentX += DURATION_GAP;

        var clockBlocks = findByLabelOnPage(page, "picto_duree");
        if (clockBlocks.length > 0) {
            var clockW = clockBlocks[0].geometricBounds[3] - clockBlocks[0].geometricBounds[1];
            moveItem(clockBlocks[0], currentX, refY);
            clockBlocks[0].visible = true;
            currentX += clockW + PICTO_GAP;
        }

        var durText = findByLabelOnPage(page, "txt_poi_duree");
        if (durText.length > 0 && durText[0] instanceof TextFrame) {
            moveItem(durText[0], currentX, refY);
            durText[0].visible = true;
            durText[0].contents = String(durationValue);
        }
    }
}

// ─── 9. Gabarit POI ───────────────────────────────────────────────────────────
var master = doc.masterSpreads.itemByName("B-POI_TEMPLATE");
if (!master.isValid) {
    alert("Gabarit \u00abB-POI_TEMPLATE\u00bb introuvable dans ce document.");
    exit();
}

// ─── 10. Génération des pages ────────────────────────────────────────────────
for (var i = 0; i < data.pages.length; i++) {

    var pageData = data.pages[i];
    if (pageData.template != "POI") continue;

    var newPage = doc.pages.add();
    newPage.appliedMaster = master;

    // Override de tous les éléments du gabarit
    var masterItems = master.allPageItems;
    for (var m = 0; m < masterItems.length; m++) {
        try { masterItems[m].override(newPage); } catch(e) {}
    }

    var textContent  = pageData.content.text;
    var imageContent = pageData.content.images;
    var pictoContent = pageData.content.pictos;

    // Étape A : masquer tous les champs mappés
    for (var key in data.mappings.fields) {
        if (!data.mappings.fields.hasOwnProperty(key)) continue;
        injectText(newPage, data.mappings.fields[key], null);
    }

    // Étape B : injection textes (sauf champs gérés par injectPictoBar)
    for (var key in textContent) {
        if (!textContent.hasOwnProperty(key)) continue;
        if (SKIP_IN_TEXT_STEP[key]) continue;
        var mapping = data.mappings.fields[key];
        if (!mapping) continue;
        var val = textContent[key];
        if (val === null || val === undefined) continue;
        var strVal = String(val).replace(/^\s+|\s+$/, "");
        if (strVal === "") continue;
        if (BULLET_LIST_FIELDS[key]) {
            injectBulletText(newPage, mapping, strVal);
        } else {
            injectText(newPage, mapping, strVal);
        }
    }

    // Étape C : injection images
    for (var imgKey in imageContent) {
        if (!imageContent.hasOwnProperty(imgKey)) continue;
        var imgMapping = data.mappings.fields[imgKey];
        if (!imgMapping) continue;
        injectImage(newPage, imgMapping, imageContent[imgKey]);
    }

    // Étape D : pictos + durée
    var durationVal = (textContent && textContent["POI_meta_duree"]) ? textContent["POI_meta_duree"] : null;
    injectPictoBar(newPage, pictoContent, durationVal);
}

alert("Pages POI g\u00e9n\u00e9r\u00e9es avec succ\u00e8s \u2714");
