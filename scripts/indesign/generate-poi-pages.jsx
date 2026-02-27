/**
 * generate-poi-pages.jsx
 * Script InDesign ExtendScript - generation automatique des pages POI
 *
 * Prerequis InDesign :
 *   - Styles de caractere "Gras", "Orange", "Chiffre" dans le document
 *   - Gabarits "G-POI", "A-COUVERTURE", "B-PRESENTATION_GUIDE"
 *   - Blocs etiquetes (label) avec le NOM EXACT du champ de template
 *     Ex : frame texte -> label "POI_titre_1", frame image -> label "POI_image_1"
 *   - Le JSON exporte depuis l'app (export ZIP recommande : JSON + images locales)
 *
 * Usage :
 *   Fichier > Scripts > Parcourir... -> selectionner ce fichier
 *   Une boite de dialogue demande le fichier JSON
 */

#target indesign
#include "json2.js"

var doc = app.activeDocument;

// --- Configuration -----------------------------------------------------------
var BOLD_STYLE_NAME        = "Gras";        // Marqueurs **...**
var ORANGE_STYLE_NAME      = "Orange";      // Marqueurs {...}   - couleur #f39428
var CHIFFRE_STYLE_NAME     = "Chiffre";     // Marqueurs ^...^   - taille 18pt
var GRAS_ORANGE_STYLE_NAME = "Gras-orange"; // Marqueurs ~...~   - gras + couleur #f39428
var BULLET_LEFT_INDENT = 6.35;  // mm - retrait gauche paragraphe puce
var BULLET_FIRST_LINE  = -6.35; // mm - retrait premiere ligne (hanging indent)
var BULLET_SPACE_AFTER = 7;     // mm - espace apres chaque puce
var PICTO_W            = 12.7;  // mm - largeur d'un bloc picto (gabarit)
var PICTO_H            = 19.7;  // mm - hauteur d'un bloc picto (gabarit)
var PICTO_GAP          = 1;     // mm - espace entre pictos
var DURATION_GAP       = 3;     // mm - espace entre dernier picto et clock/duree

// Champs dont le texte est rendu en liste a puces (par nom de champ)
var BULLET_LIST_FIELDS = {
    "POI_texte_2": true,
    "PRESENTATION_GUIDE_liste_sections": true
};

// Champs geres par injectPictoBar ou injectHyperlink - exclus de l'injection texte standard
// POI_meta_1 et POI_meta_duree designent le meme champ selon la convention de nommage du template
var SKIP_IN_TEXT_STEP  = { "POI_meta_duree": true, "POI_meta_1": true, "POI_lien_1": true };

// Champs a NE PAS masquer a l'etape A (ils gardent leur texte statique du gabarit)
var SKIP_IN_MASK_STEP  = { "POI_lien_1": true };

// Noms des gabarits InDesign associes a chaque template
// Ajouter ici chaque nouveau template : { "NOM_TEMPLATE": "NOM_GABARIT_INDESIGN" }
var GABARIT_NAMES = {
    "COUVERTURE":         "A-COUVERTURE",
    "PRESENTATION_GUIDE": "B-PRESENTATION_GUIDE",
    "POI":                "G-POI"
};

// Cache des gabarits charges (evite de recharger plusieurs fois)
var gabaritCache = {};

// Charge un gabarit InDesign par nom de template.
// Retourne le MasterSpread ou null si introuvable (avec alerte).
// param templateName : nom du template (ex: "PRESENTATION_GUIDE")
// param required     : si true, bloque le script en cas d'absence
function loadGabarit(templateName, required) {
    if (gabaritCache[templateName]) return gabaritCache[templateName];
    var gabaritName = GABARIT_NAMES[templateName];
    if (!gabaritName) return null;
    var ms = doc.masterSpreads.itemByName(gabaritName);
    if (!ms.isValid) {
        alert("Gabarit \u00ab" + gabaritName + "\u00bb introuvable dans ce document.\nLes pages " + templateName + " seront ignor\u00e9es.");
        if (required) exit();
        return null;
    }
    gabaritCache[templateName] = ms;
    return ms;
}

// --- 1. Charger JSON ---------------------------------------------------------
var jsonFile = File.openDialog("Choisir le JSON du guide");
if (!jsonFile) exit();

var rootFolder = jsonFile.parent;
jsonFile.encoding = "UTF-8";
jsonFile.open("r");
var raw = jsonFile.read();
jsonFile.close();

var data = JSON.parse(raw);

// --- 2. Trouver les blocs par label (page courante uniquement) ---------------
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

// --- 3. Deplacer un objet sans toucher au contenu interieur ------------------
// Utilise move() au lieu de geometricBounds = pour preserver le ratio image
function moveItem(item, targetX, targetY) {
    var b = item.geometricBounds; // [top, left, bottom, right]
    var deltaX = targetX - b[1];
    var deltaY = targetY - b[0];
    item.move(null, [deltaX, deltaY]);
}

// --- 4. Appliquer les styles via GREP ----------------------------------------
//
// Styles geres :
//   **text**  -> style "Gras"        (caractere gras)
//   {text}    -> style "Orange"      (couleur #f39428)
//   ^text^    -> style "Chiffre"     (taille 18pt)
//   ~text~    -> style "Gras-orange" (gras + couleur #f39428)
//
// Prerequis InDesign : styles de caractere "Gras", "Orange", "Chiffre", "Gras-orange".
// Utilise tf.parentStory car findGrep/changeGrep ne sont pas disponibles
// sur TextFrame directement.

function applyStyleMarkers(tf) {
    try {
        var story = tf.parentStory;

        var boldStyle       = doc.characterStyles.itemByName(BOLD_STYLE_NAME);
        var orangeStyle     = doc.characterStyles.itemByName(ORANGE_STYLE_NAME);
        var chiffreStyle    = doc.characterStyles.itemByName(CHIFFRE_STYLE_NAME);
        var grasOrangeStyle = doc.characterStyles.itemByName(GRAS_ORANGE_STYLE_NAME);

        // -- Gras : **text** --------------------------------------------------
        app.findGrepPreferences   = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "\\*\\*[^*]+\\*\\*";
        var boldMatches = story.findGrep();
        app.findGrepPreferences = NothingEnum.NOTHING;
        if (boldStyle.isValid) {
            for (var m = 0; m < boldMatches.length; m++) {
                try { boldMatches[m].appliedCharacterStyle = boldStyle; } catch(e) {}
            }
        }
        app.findGrepPreferences   = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat   = "\\*\\*";
        app.changeGrepPreferences.changeTo = "";
        story.changeGrep();
        app.findGrepPreferences   = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;

        // -- Orange : {text} --------------------------------------------------
        app.findGrepPreferences   = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "\\{[^}]+\\}";
        var orangeMatches = story.findGrep();
        app.findGrepPreferences = NothingEnum.NOTHING;
        if (orangeStyle.isValid) {
            for (var o = 0; o < orangeMatches.length; o++) {
                try { orangeMatches[o].appliedCharacterStyle = orangeStyle; } catch(e) {}
            }
        }
        app.findGrepPreferences   = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat   = "[{}]";
        app.changeGrepPreferences.changeTo = "";
        story.changeGrep();
        app.findGrepPreferences   = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;

        // -- Chiffre : ^text^ -------------------------------------------------
        app.findGrepPreferences   = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "\\^[^^]+\\^";
        var chiffreMatches = story.findGrep();
        app.findGrepPreferences = NothingEnum.NOTHING;
        if (chiffreStyle.isValid) {
            for (var c = 0; c < chiffreMatches.length; c++) {
                try { chiffreMatches[c].appliedCharacterStyle = chiffreStyle; } catch(e) {}
            }
        }
        app.findGrepPreferences   = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat   = "\\^";
        app.changeGrepPreferences.changeTo = "";
        story.changeGrep();
        app.findGrepPreferences   = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;

        // -- Gras-orange : ~text~ ---------------------------------------------
        app.findGrepPreferences   = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "~[^~]+~";
        var grasOrangeMatches = story.findGrep();
        app.findGrepPreferences = NothingEnum.NOTHING;
        if (grasOrangeStyle.isValid) {
            for (var g = 0; g < grasOrangeMatches.length; g++) {
                try { grasOrangeMatches[g].appliedCharacterStyle = grasOrangeStyle; } catch(e) {}
            }
        }
        app.findGrepPreferences   = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat   = "~";
        app.changeGrepPreferences.changeTo = "";
        story.changeGrep();
        app.findGrepPreferences   = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;

    } catch(e) {
        // Ne pas bloquer le reste du script si l'application de styles echoue
    }
}

// --- 5. Injecter texte avec styles optionnels --------------------------------
function setTextWithStyles(textFrame, rawText) {
    textFrame.contents = rawText;  // definir avec les marqueurs en place
    applyStyleMarkers(textFrame);  // GREP trouve, applique styles, supprime marqueurs
}

// --- 6. Injecter texte (masque le bloc si vide / absent) ---------------------
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
            var hasMarkers = strValue.indexOf("**") !== -1 ||
                             strValue.indexOf("{")  !== -1 ||
                             strValue.indexOf("^")  !== -1 ||
                             strValue.indexOf("~")  !== -1;
            if (hasMarkers) {
                setTextWithStyles(blocks[i], strValue);
            } else {
                blocks[i].contents = strValue;
            }
        }
    }
}

// --- 7. Injecter liste a puces avec mise en forme paragraphe -----------------
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

        // Construire le texte avec les marqueurs ** conserves (GREP les traitera)
        var fullText = "";
        for (var it = 0; it < items.length; it++) {
            fullText += (it > 0 ? "\r" : "") + BULLET + items[it];
        }

        tf.contents = fullText;

        // Appliquer les styles via GREP si des marqueurs sont presents
        var hasMarkers = fullText.indexOf("**") !== -1 ||
                         fullText.indexOf("{")  !== -1 ||
                         fullText.indexOf("^")  !== -1 ||
                         fullText.indexOf("~")  !== -1;
        if (hasMarkers) {
            applyStyleMarkers(tf);
        }

        // Mise en forme paragraphe : hanging indent + espace apres + tab stop
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

// --- 8. Injecter image (local en priorite, URL en fallback) ------------------
// Note : les TextFrames sont ignores - placer un fichier dans un TextFrame
// cree un graphic inline qui laisse une ligne blanche dans le bloc.
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

// --- 9. Injecter un hyperlien sur un bloc texte ------------------------------
// Le texte du bloc reste inchange (statique du gabarit), seul le lien est ajoute.
function injectHyperlink(page, label, url) {
    if (!url || String(url).replace(/^\s+|\s+$/, "") === "") return;
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        var tf = blocks[i];
        tf.visible = true;

        // Supprimer les hyperliens existants sur ce bloc (evite les doublons)
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

        // Creer la destination URL
        var dest;
        try {
            dest = doc.hyperlinkURLDestinations.add(url);
        } catch(e) {
            try { dest = doc.hyperlinkURLDestinations.itemByName(url); } catch(e2) { continue; }
        }

        // Creer la source sur tout le texte du bloc (via parentStory)
        var src;
        try {
            src = doc.hyperlinkTextSources.add(tf.parentStory.texts.item(0));
        } catch(e) { continue; }

        // Creer l'hyperlien avec soulignement visible
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

// --- 10. Barre de pictos avec reflow dynamique + duree -----------------------
//
// Architecture :
//   - ALL_PICTO_LABELS : liste exhaustive des labels InDesign possibles (masquage initial)
//   - injectPictoBar   : utilise content._derived.pictos_active (deja ordonne et filtre)
//
// _derived.pictos_active est calcule par le backend depuis le template :
//   chaque entree contient { indesign_layer, variant_layer }
//   -> le script InDesign ne connait PAS les noms de champs JSON, seulement les labels ID.
//
// Ajouter un nouveau picto = ajouter son label dans ALL_PICTO_LABELS et dans le template.

// Labels des cadres picto dans InDesign - doivent correspondre aux noms de champs du template.
// Les variant_layer (ex: POI_picto_interet_incontournable) sont definis dans option_layers
// du template et resolus dynamiquement depuis _derived.pictos_active.
var ALL_PICTO_LABELS = [
    // Noms semantiques (convention actuelle : champ = label InDesign)
    "POI_picto_interet",
    "POI_picto_pmr",
    "POI_picto_escaliers",
    "POI_picto_toilettes",
    "POI_picto_restauration",
    "POI_picto_famille",
    // Noms numerotes (alternative)
    "POI_picto_1", "POI_picto_2", "POI_picto_3",
    "POI_picto_4", "POI_picto_5", "POI_picto_6",
    // Picto duree (cadre horloge - label statique dans le gabarit)
    "picto_duree"
];


// Positionne les pictos actifs en reflow horizontal.
// Gere egalement picto_duree (clock) et le texte de duree en fin de barre.
// param page          : page InDesign cible
// param contentData   : pageData.content (objet complet, pas seulement .pictos)
// param durationValue : valeur de duree de visite (ou null)
function injectPictoBar(page, contentData, durationValue) {

    // 1. Masquer TOUS les blocs picto connus + texte duree
    for (var p = 0; p < ALL_PICTO_LABELS.length; p++) {
        var pBlocks = findByLabelOnPage(page, ALL_PICTO_LABELS[p]);
        for (var b = 0; b < pBlocks.length; b++) {
            pBlocks[b].visible = false;
        }
    }
    // Masquer le bloc texte duree (label = nom du champ de template)
    var durTextBlocks = findByLabelOnPage(page, "POI_meta_duree");
    var durTextBlocks2 = findByLabelOnPage(page, "POI_meta_1");
    for (var d = 0; d < durTextBlocks.length; d++)  durTextBlocks[d].visible = false;
    for (var d = 0; d < durTextBlocks2.length; d++) durTextBlocks2[d].visible = false;

    if (!contentData) return;

    // 2. Source de verite : _derived.pictos_active (calcule par le backend)
    //    Chaque entree : { field, picto_key, indesign_layer, variant_layer, value, label }
    //    variant_layer = calque exact du gabarit (ex: picto_interet_2, picto_pmr_half)
    //    indesign_layer = calque de base, utilise en fallback si variant absent du gabarit
    var pictosActive = (contentData._derived && contentData._derived.pictos_active)
        ? contentData._derived.pictos_active
        : [];

    // 3. Collecter les blocs InDesign dans l'ordre de la liste
    var activePictos = [];
    for (var o = 0; o < pictosActive.length; o++) {
        var entry = pictosActive[o];
        // Resolution calque :
        //   variant_layer (calque precis, ex: picto_interet_2) calcule par le backend
        //   depuis field.option_layers du template.
        //   indesign_layer (calque de base) utilise uniquement si variant absent du gabarit.
        var layer = entry.variant_layer || entry.indesign_layer;
        if (!layer) continue;

        var found = findByLabelOnPage(page, layer);
        if (found.length === 0 && entry.indesign_layer && layer !== entry.indesign_layer) {
            found = findByLabelOnPage(page, entry.indesign_layer);
        }
        if (found.length > 0) activePictos.push(found[0]);
    }

    if (activePictos.length === 0) return;

    // 3. Reference : position du PREMIER picto actif (pas de picto_bar_anchor)
    //    -> le 1er picto ne bouge pas, les suivants se calent contre lui
    var refBounds = activePictos[0].geometricBounds; // [top, left, bottom, right]
    var refX = refBounds[1];
    var refY = refBounds[0];
    var currentX = refX;

    // 4. Repositionner chaque picto avec move() (preserve le contenu interieur)
    //    Utilise la largeur REELLE du bloc (pas la constante PICTO_W) pour eviter
    //    tout decalage si les blocs ont des largeurs legerement differentes.
    for (var a = 0; a < activePictos.length; a++) {
        var pictoW = activePictos[a].geometricBounds[3] - activePictos[a].geometricBounds[1];
        moveItem(activePictos[a], currentX, refY);
        activePictos[a].visible = true;
        currentX += pictoW + PICTO_GAP;
    }

    // 5. Picto duree (clock) + texte duree en fin de barre
    if (durationValue) {
        currentX += DURATION_GAP;

        var clockBlocks = findByLabelOnPage(page, "picto_duree");
        if (clockBlocks.length > 0) {
            var clockW = clockBlocks[0].geometricBounds[3] - clockBlocks[0].geometricBounds[1];
            moveItem(clockBlocks[0], currentX, refY);
            clockBlocks[0].visible = true;
            currentX += clockW + PICTO_GAP;
        }

        // Chercher le bloc texte duree (POI_meta_duree ou POI_meta_1 selon le template)
        var durText = findByLabelOnPage(page, "POI_meta_duree");
        if (durText.length === 0) durText = findByLabelOnPage(page, "POI_meta_1");
        if (durText.length > 0 && durText[0] instanceof TextFrame) {
            moveItem(durText[0], currentX, refY);
            durText[0].visible = true;
            durText[0].contents = String(durationValue);
        }
    }
}

// --- 11. Injection generique textes + images (templates sans pictos) ---------
//
// Utilisee par COUVERTURE, PRESENTATION_GUIDE et tout futur template standard.
// Pour chaque page : masque les champs du template, injecte textes puis images.
// Les champs dans SKIP_IN_MASK_STEP et SKIP_IN_TEXT_STEP sont exclus.
//
// param page     : page InDesign cible (deja creee et gabarit applique)
// param pageData : entree data.pages[i] du JSON exporte

function injectPageContent(page, pageData) {
    var textContent  = pageData.content.text   || {};
    var imageContent = pageData.content.images || {};

    // Etape A : masquer tous les champs mappes du template courant
    for (var key in data.mappings.fields) {
        if (!data.mappings.fields.hasOwnProperty(key)) continue;
        if (SKIP_IN_MASK_STEP[key]) continue;
        injectText(page, data.mappings.fields[key], null);
    }

    // Etape B : injection textes
    for (var tKey in textContent) {
        if (!textContent.hasOwnProperty(tKey)) continue;
        if (SKIP_IN_TEXT_STEP[tKey]) continue;
        var tMapping = data.mappings.fields[tKey];
        if (!tMapping) continue;
        var tVal = textContent[tKey];
        if (tVal === null || tVal === undefined) continue;
        var tStrVal = String(tVal).replace(/^\s+|\s+$/, "");
        if (tStrVal === "") continue;
        if (BULLET_LIST_FIELDS[tKey]) {
            injectBulletText(page, tMapping, tStrVal);
        } else {
            injectText(page, tMapping, tStrVal);
        }
    }

    // Etape C : injection images
    for (var iKey in imageContent) {
        if (!imageContent.hasOwnProperty(iKey)) continue;
        var iMapping = data.mappings.fields[iKey];
        if (!iMapping) continue;
        injectImage(page, iMapping, imageContent[iKey]);
    }
}

// --- 12. Gabarits ------------------------------------------------------------
// G-POI est requis - le script s'arrete s'il est absent.
var master = loadGabarit("POI", true);

// --- 13. Generation des pages ------------------------------------------------
var pagesGenerated = 0;

for (var i = 0; i < data.pages.length; i++) {

    var pageData = data.pages[i];

    // -- COUVERTURE - placee en debut de document -----------------------------
    if (pageData.template === "COUVERTURE") {
        var msCover = loadGabarit("COUVERTURE", false);
        if (!msCover) continue;

        var coverPage = doc.pages.add(LocationOptions.AT_BEGINNING);
        coverPage.appliedMaster = msCover;
        var coverItems = msCover.allPageItems;
        for (var ci = 0; ci < coverItems.length; ci++) {
            try { coverItems[ci].override(coverPage); } catch(e) {}
        }
        injectPageContent(coverPage, pageData);
        pagesGenerated++;
        continue;
    }

    // -- PRESENTATION_GUIDE ---------------------------------------------------
    if (pageData.template === "PRESENTATION_GUIDE") {
        var msPresGuide = loadGabarit("PRESENTATION_GUIDE", false);
        if (!msPresGuide) continue;

        var presPage = doc.pages.add();
        presPage.appliedMaster = msPresGuide;
        var presItems = msPresGuide.allPageItems;
        for (var pi = 0; pi < presItems.length; pi++) {
            try { presItems[pi].override(presPage); } catch(e) {}
        }
        injectPageContent(presPage, pageData);
        pagesGenerated++;
        continue;
    }

    // -- POI ------------------------------------------------------------------
    if (pageData.template !== "POI") continue;

    var newPage = doc.pages.add();
    newPage.appliedMaster = master;
    var masterItems = master.allPageItems;
    for (var m = 0; m < masterItems.length; m++) {
        try { masterItems[m].override(newPage); } catch(e) {}
    }

    var textContent  = pageData.content.text   || {};
    var imageContent = pageData.content.images || {};

    // Etape A : masquer tous les champs mappes (sauf statiques du gabarit)
    for (var key in data.mappings.fields) {
        if (!data.mappings.fields.hasOwnProperty(key)) continue;
        if (SKIP_IN_MASK_STEP[key]) continue;
        injectText(newPage, data.mappings.fields[key], null);
    }

    // Etape B : injection textes (sauf champs geres par injectPictoBar)
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

    // Etape C : injection images
    for (var imgKey in imageContent) {
        if (!imageContent.hasOwnProperty(imgKey)) continue;
        var imgMapping = data.mappings.fields[imgKey];
        if (!imgMapping) continue;
        injectImage(newPage, imgMapping, imageContent[imgKey]);
    }

    // Etape D : pictos + duree
    var durationVal = textContent["POI_meta_duree"] || textContent["POI_meta_1"] || null;
    injectPictoBar(newPage, pageData.content, durationVal);

    // Etape E : hyperlien bas de page -> url_source de l'article
    var linkLabel = data.mappings.fields["POI_lien_1"];
    if (linkLabel) {
        injectHyperlink(newPage, linkLabel, pageData.url_source);
    }

    pagesGenerated++;
}

alert(pagesGenerated + " page(s) g\u00e9n\u00e9r\u00e9e(s) avec succ\u00e8s \u2714");
