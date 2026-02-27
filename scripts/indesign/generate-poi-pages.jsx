/**
 * generate-poi-pages.jsx
 * Script InDesign ExtendScript — génération automatique des pages POI
 *
 * Prérequis InDesign :
 *   - Un style de caractère nommé "Gras" (pour le bold **...**)
 *   - Un gabarit nommé "G-POI" (pages POI) et "A-COUVERTURE" (couverture)
 *   - Les blocs étiquetés (label) avec le NOM EXACT du champ de template
 *     Ex : frame texte → label "POI_titre_1", frame image → label "POI_image_1"
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

// Champs gérés par injectPictoBar ou injectHyperlink — exclus de l'injection texte standard
// POI_meta_1 et POI_meta_duree désignent le même champ selon la convention de nommage du template
var SKIP_IN_TEXT_STEP  = { "POI_meta_duree": true, "POI_meta_1": true, "POI_lien_1": true };

// Champs à NE PAS masquer à l'étape A (ils gardent leur texte statique du gabarit)
var SKIP_IN_MASK_STEP  = { "POI_lien_1": true };

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
// Utilise tf.parentStory car findGrep/changeGrep ne sont pas disponibles sur TextFrame directement.
function applyBoldMarkers(tf) {
    try {
        var story = tf.parentStory;
        var boldStyle = doc.characterStyles.itemByName(BOLD_STYLE_NAME);

        // Chercher les patterns **...** dans cette story
        app.findGrepPreferences  = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "\\*\\*[^*]+\\*\\*";
        var matches = story.findGrep();
        app.findGrepPreferences = NothingEnum.NOTHING;

        // Appliquer le style "Gras" à chaque correspondance (marqueurs inclus)
        if (boldStyle.isValid) {
            for (var m = 0; m < matches.length; m++) {
                try { matches[m].appliedCharacterStyle = boldStyle; } catch(e) {}
            }
        }

        // Supprimer les marqueurs ** — le texte garde le style gras
        app.findGrepPreferences  = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat  = "\\*\\*";
        app.changeGrepPreferences.changeTo = "";
        story.changeGrep();
        app.findGrepPreferences  = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
    } catch(e) {
        // Ne pas bloquer le reste du script si le gras échoue
    }
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
// Note : les TextFrames sont ignorés — placer un fichier dans un TextFrame
// crée un graphic inline qui laisse une ligne blanche dans le bloc.
function injectImage(page, label, imageData) {
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        // Ignorer les TextFrames : seuls les cadres image (Rectangle, etc.) acceptent place()
        if (block instanceof TextFrame) {
            block.visible = false;
            continue;
        }
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

// ─── 8. Injecter un hyperlien sur un bloc texte ──────────────────────────────
// Le texte du bloc reste inchangé (statique du gabarit), seul le lien est ajouté.
function injectHyperlink(page, label, url) {
    if (!url || String(url).replace(/^\s+|\s+$/, "") === "") return;
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        var tf = blocks[i];
        tf.visible = true;

        // Supprimer les hyperliens existants sur ce bloc (évite les doublons)
        var existingLinks = doc.hyperlinks;
        for (var h = existingLinks.length - 1; h >= 0; h--) {
            try {
                var src = existingLinks.item(h).source;
                if (src && src.sourceText && src.sourceText.parentTextFrames &&
                    src.sourceText.parentTextFrames.length > 0 &&
                    src.sourceText.parentTextFrames[0] === tf) {
                    existingLinks.item(h).remove();
                }
            } catch(e) {}
        }

        // Créer la destination URL
        var dest;
        try {
            dest = doc.hyperlinkURLDestinations.add(url);
        } catch(e) {
            try { dest = doc.hyperlinkURLDestinations.itemByName(url); } catch(e2) { continue; }
        }

        // Créer la source sur tout le texte du bloc (via parentStory)
        var src;
        try {
            src = doc.hyperlinkTextSources.add(tf.parentStory.texts.item(0));
        } catch(e) { continue; }

        // Créer l'hyperlien avec soulignement visible
        try {
            var hl = doc.hyperlinks.add(src, dest, {
                visible:     false,
                highlight:   HyperlinkAppearanceHighlight.NONE
            });
            // Appliquer le soulignement au texte pour signaler visuellement le lien
            tf.texts.item(0).underline = true;
        } catch(e) {}
    }
}

// ─── 9. Barre de pictos avec reflow dynamique + durée ────────────────────────
//
// Architecture propre :
//   - ALL_PICTO_LABELS : liste exhaustive des labels InDesign possibles (masquage initial)
//   - injectPictoBar   : utilise content._derived.pictos_active (déjà ordonné et filtré)
//
// _derived.pictos_active est calculé par le backend depuis le template :
//   chaque entrée contient { indesign_layer, variant_layer }
//   → le script InDesign ne connaît PLUS les noms de champs JSON, seulement les labels ID.
//
// Ajouter un nouveau picto = ajouter son label dans ALL_PICTO_LABELS et dans le template.
// Aucune modification du script nécessaire pour le reste.

// Labels des cadres picto dans InDesign — doivent correspondre aux noms de champs du template.
// Les variant_layer (ex: POI_picto_interet_incontournable) sont définis dans option_layers
// du template et résolus dynamiquement depuis _derived.pictos_active.
var ALL_PICTO_LABELS = [
    // Noms sémantiques (convention actuelle : champ = label InDesign)
    "POI_picto_interet",
    "POI_picto_pmr",
    "POI_picto_escaliers",
    "POI_picto_toilettes",
    "POI_picto_restauration",
    "POI_picto_famille",
    // Noms numérotés (alternative)
    "POI_picto_1", "POI_picto_2", "POI_picto_3",
    "POI_picto_4", "POI_picto_5", "POI_picto_6",
    // Picto durée (cadre horloge — label statique dans le gabarit)
    "picto_duree"
];


/**
 * Positionne les pictos actifs en reflow horizontal.
 * Gère également picto_duree (clock) et txt_poi_duree en fin de barre.
 *
 * @param {Page}   page         - page InDesign cible
 * @param {Object} contentData  - pageData.content (objet complet, pas seulement .pictos)
 * @param {string} durationValue- valeur de durée de visite (ou null)
 */
function injectPictoBar(page, contentData, durationValue) {

    // 1. Masquer TOUS les blocs picto connus + texte durée
    for (var p = 0; p < ALL_PICTO_LABELS.length; p++) {
        var pBlocks = findByLabelOnPage(page, ALL_PICTO_LABELS[p]);
        for (var b = 0; b < pBlocks.length; b++) {
            pBlocks[b].visible = false;
        }
    }
    // Masquer le bloc texte durée (label = nom du champ de template)
    var durTextBlocks = findByLabelOnPage(page, "POI_meta_duree");
    var durTextBlocks2 = findByLabelOnPage(page, "POI_meta_1");
    for (var d = 0; d < durTextBlocks.length; d++)  durTextBlocks[d].visible = false;
    for (var d = 0; d < durTextBlocks2.length; d++) durTextBlocks2[d].visible = false;

    if (!contentData) return;

    // 2. Source de vérité : _derived.pictos_active (calculé par le backend)
    //    Chaque entrée : { field, picto_key, indesign_layer, variant_layer, value, label }
    //    variant_layer = calque exact du gabarit (ex: picto_interet_2, picto_pmr_half)
    //    indesign_layer = calque de base, utilisé en fallback si variant absent du gabarit
    var pictosActive = (contentData._derived && contentData._derived.pictos_active)
        ? contentData._derived.pictos_active
        : [];

    // 3. Collecter les blocs InDesign dans l'ordre de la liste
    var activePictos = [];
    for (var o = 0; o < pictosActive.length; o++) {
        var entry = pictosActive[o];
        // Résolution calque :
        //   variant_layer (calque précis, ex: picto_interet_2) calculé par le backend
        //   depuis field.option_layers du template.
        //   indesign_layer (calque de base) utilisé uniquement si variant absent du gabarit.
        var layer = entry.variant_layer || entry.indesign_layer;
        if (!layer) continue;

        var found = findByLabelOnPage(page, layer);
        if (found.length === 0 && entry.indesign_layer && layer !== entry.indesign_layer) {
            found = findByLabelOnPage(page, entry.indesign_layer);
        }
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

        // Chercher le bloc texte durée (POI_meta_duree ou POI_meta_1 selon le template)
        var durText = findByLabelOnPage(page, "POI_meta_duree");
        if (durText.length === 0) durText = findByLabelOnPage(page, "POI_meta_1");
        if (durText.length > 0 && durText[0] instanceof TextFrame) {
            moveItem(durText[0], currentX, refY);
            durText[0].visible = true;
            durText[0].contents = String(durationValue);
        }
    }
}

// ─── 9. Gabarits ─────────────────────────────────────────────────────────────
var master = doc.masterSpreads.itemByName("G-POI");
if (!master.isValid) {
    alert("Gabarit \u00abG-POI\u00bb introuvable dans ce document.");
    exit();
}

var masterCouverture = doc.masterSpreads.itemByName("A-COUVERTURE");
if (!masterCouverture.isValid) {
    alert("Gabarit \u00abA-COUVERTURE\u00bb introuvable dans ce document.");
    exit();
}

// ─── 10. Génération des pages ────────────────────────────────────────────────
for (var i = 0; i < data.pages.length; i++) {

    var pageData = data.pages[i];

    // ── COUVERTURE ────────────────────────────────────────────────────────────
    if (pageData.template === "COUVERTURE") {

        var coverPage = doc.pages.add(LocationOptions.AT_BEGINNING);
        coverPage.appliedMaster = masterCouverture;

        // Override de tous les éléments du gabarit
        var coverMasterItems = masterCouverture.allPageItems;
        for (var mc = 0; mc < coverMasterItems.length; mc++) {
            try { coverMasterItems[mc].override(coverPage); } catch(e) {}
        }

        var coverText   = pageData.content.text;
        var coverImages = pageData.content.images;

        // Masquer tous les champs mappés
        for (var ckey in data.mappings.fields) {
            if (!data.mappings.fields.hasOwnProperty(ckey)) continue;
            injectText(coverPage, data.mappings.fields[ckey], null);
        }

        // Injection textes
        if (coverText) {
            for (var ckey in coverText) {
                if (!coverText.hasOwnProperty(ckey)) continue;
                var cMapping = data.mappings.fields[ckey];
                if (!cMapping) continue;
                var cVal = coverText[ckey];
                if (cVal === null || cVal === undefined) continue;
                var cStrVal = String(cVal).replace(/^\s+|\s+$/, "");
                if (cStrVal === "") continue;
                injectText(coverPage, cMapping, cStrVal);
            }
        }

        // Injection images
        if (coverImages) {
            for (var cImgKey in coverImages) {
                if (!coverImages.hasOwnProperty(cImgKey)) continue;
                var cImgMapping = data.mappings.fields[cImgKey];
                if (!cImgMapping) continue;
                injectImage(coverPage, cImgMapping, coverImages[cImgKey]);
            }
        }

        continue;
    }

    // ── POI ───────────────────────────────────────────────────────────────────
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

    // Étape A : masquer tous les champs mappés (sauf les champs statiques du gabarit)
    for (var key in data.mappings.fields) {
        if (!data.mappings.fields.hasOwnProperty(key)) continue;
        if (SKIP_IN_MASK_STEP[key]) continue;
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
    // durationVal : lecture depuis les champs texte (sémantique ou numéroté)
    var durationVal = null;
    if (textContent) {
        durationVal = textContent["POI_meta_duree"] || textContent["POI_meta_1"] || null;
    }
    // injectPictoBar reçoit l'objet content complet pour accéder à _derived.pictos_active
    injectPictoBar(newPage, pageData.content, durationVal);

    // Étape E : hyperlien sur le lien bas de page → url_source de l'article
    var linkLabel = data.mappings.fields["POI_lien_1"];
    if (linkLabel) {
        injectHyperlink(newPage, linkLabel, pageData.url_source);
    }
}

alert("Pages POI g\u00e9n\u00e9r\u00e9es avec succ\u00e8s \u2714");
