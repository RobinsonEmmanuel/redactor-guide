/**
 * generate-poi-pages.jsx
 * Script InDesign ExtendScript - generation automatique des pages POI
 *
 * Prerequis InDesign :
 *   - Styles de caractere "Gras", "Orange", "Chiffre" dans le document
 *   - Gabarits "G-POI", "A-COUVERTURE", "B-PRESENTATION_GUIDE", "C-PRESENTATION_DESTINATION", "E-CARTE_DESTINATION", "D-CLUSTER"
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
// Mettre a true pour afficher une alerte de diagnostic picto sur chaque page POI.
// Desactiver (false) en production.
var DEBUG_PICTOS      = false;
var DEBUG_INSPIRATION = false;
var DEBUG_PAGES       = false;

var BOLD_STYLE_NAME        = "Gras";        // Marqueurs **...**
var ORANGE_STYLE_NAME      = "Orange";      // Marqueurs {...}   - couleur #f39428
var CHIFFRE_STYLE_NAME     = "Chiffre";     // Marqueurs ^...^   - taille 18pt
var GRAS_ORANGE_STYLE_NAME = "Gras-orange"; // Marqueurs ~...~   - gras + couleur #f39428
var HASHTAG_PARA_STYLE_NAME  = "Hashtag";          // Style paragraphe pour le hashtag des cartes inspiration
var NOM_POI_PARA_STYLE_NAME  = "Inspiration_nom";  // Style paragraphe pour le nom du POI (1er paragraphe)
var BULLET_LEFT_INDENT = 6.35;  // mm - retrait gauche paragraphe puce
var BULLET_FIRST_LINE  = -6.35; // mm - retrait premiere ligne (hanging indent)
var BULLET_SPACE_AFTER = 7;     // mm - espace apres chaque puce
var PICTO_W            = 12.7;  // mm - largeur d'un bloc picto (gabarit)
var PICTO_H            = 19.7;  // mm - hauteur d'un bloc picto (gabarit)
var PICTO_GAP          = 5;     // mm - espace entre pictos
var DURATION_GAP       = 3;     // mm - espace entre dernier picto et clock/duree

// Champs rendus en liste a puces : construits dynamiquement depuis data.bullet_fields
// (tous les champs de type 'liste' dans les templates exportes).
// Fallback statique conserve pour compatibilite avec d'anciens exports JSON.
var BULLET_LIST_FIELDS_FALLBACK = {
    "POI_texte_2": true,
    "PRESENTATION_GUIDE_liste_sections": true
};
var BULLET_LIST_FIELDS = BULLET_LIST_FIELDS_FALLBACK;

// Champs geres par injectPictoBar - exclus de l'injection texte standard
// POI_meta_1 et POI_meta_duree designent le meme champ selon la convention de nommage du template
// POI_lien_1 est maintenant traite par injectText (lien structure JSON) - retire des deux listes
// POI_lien_2 est un cadre graphique cliquable - gere par injectFrameHyperlink, pas injectText
var SKIP_IN_TEXT_STEP  = { "POI_meta_duree": true, "POI_meta_1": true, "POI_lien_2": true };

// Champs a NE PAS masquer a l'etape A (injectText null ne sait pas masquer les cadres graphiques)
// POI_lien_2 : masquage/affichage gere par injectFrameHyperlink
var SKIP_IN_MASK_STEP  = { "POI_lien_2": true };

// Champs dont la valeur est un lien {label, url} ou une URL brute a appliquer
// sur un cadre GRAPHIQUE (non-TextFrame) via HyperlinkPageItemSource.
// Cle = nom du champ JSON, valeur = true.
var FRAME_LINK_FIELDS  = { "POI_lien_2": true };

// Noms des gabarits InDesign associes a chaque template
// Ajouter ici chaque nouveau template : { "NOM_TEMPLATE": "NOM_GABARIT_INDESIGN" }
var GABARIT_NAMES = {
    "COUVERTURE":              "A-COUVERTURE",
    "PRESENTATION_GUIDE":      "B-PRESENTATION_GUIDE",
    "PRESENTATION_DESTINATION":"C-PRESENTATION_DESTINATION",
    "CARTE_DESTINATION":       "E-CARTE_DESTINATION",
    "CLUSTER":                 "D-CLUSTER",
    "POI":                     "G-POI",
    "INSPIRATION":             "H-INSPIRATION",
    "SAISON":                  "I-SAISON"
};

// Cache des gabarits charges (evite de recharger plusieurs fois)
// null = gabarit absent (deja signale), undefined = pas encore teste
var gabaritCache = {};

// Liste des gabarits manquants detectes (pour le rapport final)
var missingGabarits = [];

// Liste des blocs tronques (texte trop long) detectes pendant la generation
// Format : { page: N, label: "...", titre: "..." }
var overflowWarnings = [];

// Contexte de la page en cours de generation (mis a jour a chaque iteration).
// Permet a truncateOverflow de contextualiser les avertissements.
var currentPageNum   = 0;
var currentPageTitre = "";

// Charge un gabarit InDesign par nom de template.
// Retourne le MasterSpread ou null si introuvable.
// param templateName : nom du template (ex: "PRESENTATION_GUIDE")
// param required     : si true, bloque le script en cas d'absence
function loadGabarit(templateName, required) {
    // Deja en cache (null = absent connu, objet = charge)
    if (gabaritCache.hasOwnProperty(templateName)) return gabaritCache[templateName];
    var gabaritName = GABARIT_NAMES[templateName];
    if (!gabaritName) {
        gabaritCache[templateName] = null;
        return null;
    }
    var ms = doc.masterSpreads.itemByName(gabaritName);
    if (!ms.isValid) {
        gabaritCache[templateName] = null;
        missingGabarits.push(gabaritName);
        if (required) {
            alert("Gabarit requis \u00ab" + gabaritName + "\u00bb introuvable dans ce document.\nScript arr\u00eat\u00e9.");
            exit();
        }
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

// Construire BULLET_LIST_FIELDS depuis data.mappings.bullet_fields (export v2.3+)
// Fallback sur le dictionnaire statique pour les anciens exports.
if (data.mappings && data.mappings.bullet_fields && data.mappings.bullet_fields.length > 0) {
    BULLET_LIST_FIELDS = {};
    for (var bf = 0; bf < data.mappings.bullet_fields.length; bf++) {
        BULLET_LIST_FIELDS[data.mappings.bullet_fields[bf]] = true;
    }
}

// --- 2a. Overrider tous les items d'un gabarit sur une page cible -------------
// Utilise allPageItems pour preserver l'ordre d'empilement (z-order) du gabarit.
// L'ordre d'override determine l'ordre de superposition sur la page cible :
// inverser cet ordre (ex: pageItems top-level seulement) decale les calques et
// masque le contenu. allPageItems retourne les items dans leur ordre document
// (du bas vers le haut de la pile), ce qui correspond exactement au gabarit.
function overrideAllFromMaster(masterSpread, targetPage) {
    var allItems = masterSpread.allPageItems;
    for (var a = 0; a < allItems.length; a++) {
        try { allItems[a].override(targetPage); } catch(e) {}
    }
}

// --- 2c. Ajouter une page, appliquer un gabarit et purger les pages supplementaires -
// IMPORTANT : la purge est basee sur le COMPTAGE avant/apres (beforeCount).
// Elle ne supprime QUE les pages ajoutees automatiquement par InDesign (gabarits
// multi-pages, ex : H-INSPIRATION sur 2 pages) et ne touche JAMAIS aux pages
// precedemment generees — contrairement a une purge par spread qui supprimerait
// la page voisine dans les cahiers recto-verso.
function addPageWithMaster(masterSpread, templateName) {
    var beforeCount = doc.pages.length;
    var targetPage  = doc.pages.add();
    targetPage.appliedMaster = masterSpread;
    overrideAllFromMaster(masterSpread, targetPage);

    // Supprimer uniquement les pages SUPPLEMENTAIRES creees par InDesign
    // (au-dela de la page cible qu'on vient d'ajouter).
    while (doc.pages.length > beforeCount + 1) {
        var extraPage = doc.pages.lastItem();
        if (extraPage !== targetPage) {
            try { extraPage.remove(); } catch(e) { break; }
        } else {
            break;
        }
    }

    return targetPage;
}

// --- 2b. Trouver les blocs par label (page courante uniquement) ---------------
// Recherche simple dans page.allPageItems (collection recursive, items overrides seulement).
// Ne tente PAS de re-overrider : overrideAllFromMaster() doit avoir ete appele avant.
function findByLabelOnPage(page, label) {
    var res = [];
    var items = page.allPageItems;
    for (var i = 0; i < items.length; i++) {
        try {
            if (items[i].label == label) res.push(items[i]);
        } catch(e) {}
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

// --- 5b. Couper le surplus de texte d'un bloc filonne ------------------------
// Si le texte injecte ne tient pas dans le bloc (overflows), on tronque la story
// au nombre de caracteres visibles dans ce bloc. Cela empeche le texte de deborder
// dans un bloc lie (thread) et de provoquer la creation d'une page supplementaire,
// quelle que soit la configuration Smart Text Reflow du document.
// Le label du bloc et le numero de page sont ajoutes a overflowWarnings pour
// figurer dans le rapport final.
function truncateOverflow(tf) {
    try {
        if (!tf.overflows) return;
        var story    = tf.parentStory;
        var visCount = tf.characters.length;
        var total    = story.characters.length;
        if (total > visCount && visCount > 0) {
            overflowWarnings.push({
                page:  currentPageNum,
                titre: currentPageTitre,
                label: tf.label || "(sans label)"
            });
            story.characters.itemByRange(visCount, total - 1).remove();
        }
    } catch(e) {}
}

// --- 6. Injecter texte (masque le bloc si vide / absent) ---------------------
// Si value est un objet JSON {"label":"...","url":"..."} (champ lien structure),
// l'intitule est injecte comme texte et l'URL est ajoutee comme hyperlien.
function injectText(page, label, value) {
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        var isEmpty = (value === null || value === undefined ||
                       String(value).replace(/^\s+|\s+$/, "") === "");
        if (isEmpty) {
            blocks[i].visible = false;
        } else {
            // Detecter un lien structure {"label":"...","url":"..."}
            var strRaw = String(value).replace(/^\s+|\s+$/, "");
            var linkLabel = null;
            var linkUrl   = null;
            if (strRaw.charAt(0) === "{") {
                try {
                    var parsed = eval("(" + strRaw + ")");
                    if (parsed && parsed.label !== undefined && parsed.url !== undefined) {
                        linkLabel = String(parsed.label || "");
                        linkUrl   = String(parsed.url   || "");
                    }
                } catch(e) {}
            }

            if (linkLabel !== null) {
                // Champ lien structure : injecter l'intitule puis ajouter l'hyperlien
                blocks[i].visible = linkLabel !== "" || linkUrl !== "";
                if (blocks[i].visible) {
                    blocks[i].contents = linkLabel;
                    truncateOverflow(blocks[i]);
                    if (linkUrl !== "") {
                        injectHyperlink(page, label, linkUrl);
                    }
                }
            } else {
                blocks[i].visible = true;
                blocks[i].contents = "";
                var strValue = strRaw;
                var hasMarkers = strValue.indexOf("**") !== -1 ||
                                 strValue.indexOf("{")  !== -1 ||
                                 strValue.indexOf("^")  !== -1 ||
                                 strValue.indexOf("~")  !== -1;
                if (hasMarkers) {
                    setTextWithStyles(blocks[i], strValue);
                } else {
                    blocks[i].contents = strValue;
                }
                truncateOverflow(blocks[i]);
            }
        }
    }
}

// --- 7. Injecter liste a puces avec mise en forme paragraphe -----------------
// Injecte un champ de type liste dans un bloc InDesign configure en liste a puces.
// Le bloc est responsable de l'affichage des puces (style de paragraphe InDesign).
// Le script envoie uniquement le texte brut : un item par paragraphe, separe par \r.
function injectBulletText(page, label, value) {
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

        var fullText = items.join("\r");
        tf.contents = fullText;

        // Appliquer les styles via GREP si des marqueurs sont presents
        var hasMarkers = fullText.indexOf("**") !== -1 ||
                         fullText.indexOf("{")  !== -1 ||
                         fullText.indexOf("^")  !== -1 ||
                         fullText.indexOf("~")  !== -1;
        if (hasMarkers) {
            applyStyleMarkers(tf);
        }
        truncateOverflow(tf);
    }
}

// --- 8. Masquer/afficher un objet quelconque (Group, Rectangle…) par label ---
// Utilise pour les groupes de cartes repetitif (_card_N) :
// value non vide → visible=true, value vide/null → visible=false.
// Contrairement a injectText, fonctionne sur tout type d'objet InDesign.
function injectItemVisibility(page, label, value) {
    var blocks = findByLabelOnPage(page, label);
    var show = (value !== null && value !== undefined &&
                String(value).replace(/^\s+|\s+$/, "") !== "");
    for (var i = 0; i < blocks.length; i++) {
        try { blocks[i].visible = show; } catch(e) {}
    }
}

// --- 8b. Injecter Nom+Hashtag (champ fusionné avec style paragraphe) ---------
// Injecte un champ "Nom\rHashtag" dans un seul cadre texte.
// Le nom occupe le 1er paragraphe (style du cadre), le hashtag le 2e (style "Hashtag").
// Champs concernes : cles contenant "_nom_hashtag_" (ex: INSPIRATION_1_nom_hashtag_1)
function injectNomHashtag(page, label, value) {
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        var isEmpty = (value === null || value === undefined ||
                       String(value).replace(/^\s+|\s+$/, "") === "");
        if (isEmpty) {
            blocks[i].visible = false;
            continue;
        }
        var tf = blocks[i];
        tf.visible = true;
        // Normaliser les separateurs de paragraphe (\n ou \r) en \r (InDesign)
        var strVal = String(value).replace(/\r\n/g, "\r").replace(/\n/g, "\r");
        tf.contents = strVal;

        // Appliquer les styles de paragraphe :
        //   - 1er paragraphe (nom)    : style "Inspiration_nom"
        //   - 2eme paragraphe (hashtag, commence par #) : style "Hashtag"
        // Utiliser tf.paragraphs (propre au cadre) et NON tf.parentStory.paragraphs
        // (qui retournerait tous les paragraphes du story, decalant les indices).
        try {
            var paras    = tf.paragraphs;
            var nomStyle  = doc.paragraphStyles.itemByName(NOM_POI_PARA_STYLE_NAME);
            var hashStyle = doc.paragraphStyles.itemByName(HASHTAG_PARA_STYLE_NAME);
            if (paras.length >= 1 && nomStyle.isValid) {
                paras[0].appliedParagraphStyle = nomStyle;
            }
            if (paras.length >= 2 && hashStyle.isValid) {
                paras[1].appliedParagraphStyle = hashStyle;
            }
        } catch(e) {}
        // Appliquer les marqueurs de style caractere si presents
        var hasMarkers = strVal.indexOf("**") !== -1 ||
                         strVal.indexOf("{")  !== -1 ||
                         strVal.indexOf("^")  !== -1 ||
                         strVal.indexOf("~")  !== -1;
        if (hasMarkers) { applyStyleMarkers(tf); }
        truncateOverflow(tf);
    }
}

// --- 8b. Injecter image (local en priorite, URL en fallback) -----------------
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

        try {
            var hl = doc.hyperlinks.add(src, dest, {
                visible:   false,
                highlight: HyperlinkAppearanceHighlight.NONE
            });
        } catch(e) {}
    }
}

// --- 9b. Injecter un hyperlien sur un cadre GRAPHIQUE (non-TextFrame) --------
// Utilise HyperlinkPageItemSource pour rendre un Rectangle, Oval ou Groupe cliquable.
// La valeur peut etre un JSON structure {"label":"...","url":"..."} ou une URL brute.
// Si l'URL est absente ou vide, le cadre est masque.
function injectFrameHyperlink(page, label, value) {
    // Extraire l'URL depuis un JSON structure ou une chaine brute
    var url = null;
    if (value) {
        var strRaw = String(value).replace(/^\s+|\s+$/, "");
        if (strRaw.charAt(0) === "{") {
            try {
                var parsed = eval("(" + strRaw + ")");
                if (parsed && parsed.url) url = String(parsed.url).replace(/^\s+|\s+$/, "");
            } catch(e) {}
        } else if (strRaw !== "") {
            url = strRaw;
        }
    }

    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (!url) {
            block.visible = false;
            continue;
        }
        block.visible = true;

        // Supprimer les hyperliens page-item existants sur ce cadre (evite les doublons)
        var existingLinks = doc.hyperlinks;
        for (var h = existingLinks.length - 1; h >= 0; h--) {
            try {
                var hs = existingLinks.item(h).source;
                if (hs && hs.sourcePageItem && hs.sourcePageItem === block) {
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

        // Creer la source sur le cadre graphique (HyperlinkPageItemSource)
        var src;
        try {
            src = doc.hyperlinkPageItemSources.add(block);
        } catch(e) { continue; }

        try {
            doc.hyperlinks.add(src, dest, {
                visible:   false,
                highlight: HyperlinkAppearanceHighlight.NONE
            });
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
// Labels REELS detectes dans le gabarit G-POI (diagnostic 2026-03) :
//   picto_escaliers, picto_famille, picto_restauration, picto_toilettes
//   picto_interet_1/2/3, picto_pmr_full/half/none, picto_duree
// Convention gabarit : prefixe "picto_" sans "POI_" pour les cadres picto.
// Les champs template utilisent "POI_picto_X" -> fallback "POI_" strip dans injectPictoBar.
var ALL_PICTO_LABELS = [
    // Booleens (oui/non) - labels reels dans le gabarit
    "picto_escaliers",
    "picto_toilettes",
    "picto_restauration",
    "picto_famille",
    // Variants interet (3 cadres superposes, un par valeur)
    "picto_interet_1",   // Incontournable
    "picto_interet_2",   // Interessant
    "picto_interet_3",   // A voir
    // Variants PMR (3 cadres superposes)
    "picto_pmr_full",    // Accessible 100%
    "picto_pmr_half",    // Partiellement accessible
    "picto_pmr_none",    // Non accessible
    // Picto duree (cadre horloge)
    "picto_duree",
    // Anciens noms numerotes (compatibilite) et alias POI_ (si renommes un jour)
    "POI_picto_1", "POI_picto_2", "POI_picto_3",
    "POI_picto_4", "POI_picto_5", "POI_picto_6",
    "POI_picto_interet", "POI_picto_pmr",
    "POI_picto_escaliers", "POI_picto_toilettes",
    "POI_picto_restauration", "POI_picto_famille"
];


// Positionne les pictos actifs en reflow horizontal.
// Gere egalement picto_duree (clock) et le texte de duree en fin de barre.
// param page          : page InDesign cible
// param contentData   : pageData.content (objet complet, pas seulement .pictos)
// param durationValue : valeur de duree de visite (ou null)
function injectPictoBar(page, contentData, durationValue) {

    // --- DIAGNOSTIC (DEBUG_PICTOS = true) ------------------------------------
    if (DEBUG_PICTOS) {
        var _items  = page.allPageItems;
        var _labels = [];
        for (var _i = 0; _i < _items.length; _i++) {
            try {
                var _lbl = _items[_i].label;
                if (_lbl && _lbl !== "") _labels.push(_lbl);
            } catch(e) {}
        }
        var _found = [], _missing = [];
        for (var _p = 0; _p < ALL_PICTO_LABELS.length; _p++) {
            var _cnt = 0;
            for (var _j = 0; _j < _items.length; _j++) if (_items[_j].label === ALL_PICTO_LABELS[_p]) _cnt++;
            if (_cnt > 0) _found.push(ALL_PICTO_LABELS[_p]);
            else          _missing.push(ALL_PICTO_LABELS[_p]);
        }
        alert(
            "=== DEBUG PICTOS ===\n" +
            "Items sur la page (" + _items.length + " total, " + _labels.length + " avec label) :\n" +
            _labels.join("\n") +
            "\n\n--- ALL_PICTO_LABELS trouves (" + _found.length + ") ---\n" +
            (_found.length ? _found.join("\n") : "(aucun)") +
            "\n\n--- ALL_PICTO_LABELS MANQUANTS (" + _missing.length + ") ---\n" +
            (_missing.length ? _missing.join("\n") : "(aucun)")
        );
    }
    // --- FIN DIAGNOSTIC ------------------------------------------------------

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
        // Fallback 1 : essayer indesign_layer si variant_layer non trouve
        if (found.length === 0 && entry.indesign_layer && layer !== entry.indesign_layer) {
            found = findByLabelOnPage(page, entry.indesign_layer);
        }
        // Fallback 2 : retirer le prefixe "POI_" (convention gabarit sans prefixe)
        if (found.length === 0 && layer.indexOf("POI_") === 0) {
            found = findByLabelOnPage(page, layer.substring(4));
        }
        if (found.length === 0 && entry.indesign_layer && entry.indesign_layer.indexOf("POI_") === 0) {
            found = findByLabelOnPage(page, entry.indesign_layer.substring(4));
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

    // Etape A : masquer tous les champs du template courant.
    // Passe 1 : champs declares dans data.mappings.fields (templates de premier niveau)
    for (var key in data.mappings.fields) {
        if (!data.mappings.fields.hasOwnProperty(key)) continue;
        if (SKIP_IN_MASK_STEP[key]) continue;
        if (key.indexOf("_card_") !== -1) {
            injectItemVisibility(page, data.mappings.fields[key], null);
        } else {
            injectText(page, data.mappings.fields[key], null);
        }
    }
    // Passe 2 : champs exploses absents de data.mappings.fields (repetitif sous-champs)
    // Utilise le nom du champ comme label (convention label = nom champ).
    for (var aKey in textContent) {
        if (!textContent.hasOwnProperty(aKey)) continue;
        if (data.mappings.fields[aKey]) continue; // deja traite en passe 1
        if (SKIP_IN_MASK_STEP[aKey]) continue;
        if (aKey.indexOf("_card_") !== -1) {
            injectItemVisibility(page, aKey, null);
        } else {
            injectText(page, aKey, null);
        }
    }
    // Passe 3 : masquer TOUS les groupes _card_ presents sur la page (par scan direct).
    // Garantit le masquage meme si le JSON ne contient pas de slot vide pour ce groupe
    // (ex : max_repetitions non defini dans le template → slot 6 absent du JSON).
    try {
        var allItems = page.allPageItems;
        for (var pi = 0; pi < allItems.length; pi++) {
            var pItem = allItems[pi];
            if (pItem.label && pItem.label.indexOf("_card_") !== -1) {
                try { pItem.visible = false; } catch(e2) {}
            }
        }
    } catch(e) {}

    // --- Diagnostic INSPIRATION (DEBUG_INSPIRATION = true) -------------------
    // Affiche uniquement l'etat des slots _card_N (visibles ou masques)
    // et verifie que le label correspondant existe bien sur la page.
    if (DEBUG_INSPIRATION && pageData.template === "INSPIRATION") {
        var diagMsg = "=== INSPIRATION — slots card ===\n";
        diagMsg += "Titre : " + (pageData.titre || "?") + "\n\n";
        for (var dKey in textContent) {
            if (!textContent.hasOwnProperty(dKey)) continue;
            if (dKey.indexOf("_card_") === -1) continue;
            var cardVal   = String(textContent[dKey]);
            var cardLabel = data.mappings.fields[dKey] || dKey;
            var found     = findByLabelOnPage(page, cardLabel).length > 0;
            diagMsg += dKey + " = \"" + cardVal + "\""
                     + " | label InDesign : " + (found ? "TROUVE" : "ABSENT") + "\n";
        }
        alert(diagMsg);
    }
    // -------------------------------------------------------------------------

    // Etape B : injection textes
    // Pour les champs exploses (INSPIRATION_1_card_N, _nom_hashtag_N, etc.)
    // absents de data.mappings.fields (qui ne contient que les champs de premier niveau),
    // on utilise le nom du champ lui-meme comme label InDesign (convention label = nom champ).
    for (var tKey in textContent) {
        if (!textContent.hasOwnProperty(tKey)) continue;
        if (SKIP_IN_TEXT_STEP[tKey]) continue;
        var tMapping = data.mappings.fields[tKey] || tKey; // fallback : label = nom du champ
        var tVal = textContent[tKey];
        if (tVal === null || tVal === undefined) continue;
        var tStrVal = String(tVal).replace(/^\s+|\s+$/, "");
        if (tKey.indexOf("_card_") !== -1) {
            injectItemVisibility(page, tMapping, tStrVal); // affiche le groupe si '1'
        } else if (tStrVal === "") {
            // valeur vide → ne pas injecter (le masquage Step A a deja eu lieu)
        } else if (tKey.indexOf("_nom_hashtag_") !== -1) {
            injectNomHashtag(page, tMapping, tStrVal);
        } else if (BULLET_LIST_FIELDS[tKey]) {
            injectBulletText(page, tMapping, tStrVal);
        } else {
            injectText(page, tMapping, tStrVal);
        }
    }

    // Etape B2 : liens sur cadres graphiques (FRAME_LINK_FIELDS)
    for (var flKey in FRAME_LINK_FIELDS) {
        if (!FRAME_LINK_FIELDS.hasOwnProperty(flKey)) continue;
        var flMapping = data.mappings.fields[flKey] || flKey;
        injectFrameHyperlink(page, flMapping, textContent[flKey] || null);
    }

    // Etape B3 : hyperliens sur les pictos des cartes inspiration
    // Les cles _url_article_N et _url_maps_N contiennent une URL brute a appliquer
    // sur le cadre graphique (picto lien / picto carte) du meme label.
    for (var lKey in textContent) {
        if (!textContent.hasOwnProperty(lKey)) continue;
        if (lKey.indexOf("_url_article_") === -1 && lKey.indexOf("_url_maps_") === -1) continue;
        var lUrl = String(textContent[lKey] || "").replace(/^\s+|\s+$/, "");
        var lLabel = data.mappings.fields[lKey] || lKey;
        injectFrameHyperlink(page, lLabel, lUrl || null);
    }

    // Etape C : injection images
    // Meme convention fallback label = nom du champ pour les sous-champs _image_N.
    for (var iKey in imageContent) {
        if (!imageContent.hasOwnProperty(iKey)) continue;
        var iMapping = data.mappings.fields[iKey] || iKey;
        injectImage(page, iMapping, imageContent[iKey]);
    }
}

// --- 12. Gabarits ------------------------------------------------------------
// G-POI est requis - le script s'arrete s'il est absent.
var master = loadGabarit("POI", true);

// --- 12b. Desactiver le Smart Text Reflow ------------------------------------
var savedSmartReflow   = app.textPreferences.smartTextReflow;
var savedLimitToMaster = app.textPreferences.limitToMasterTextFrames;
try {
    app.textPreferences.smartTextReflow         = false;
    app.textPreferences.limitToMasterTextFrames = false;
} catch(e) {}

// --- 13. Purger les pages existantes du document -----------------------------
// Le document peut contenir des pages residuelles (page blanche initiale,
// reliquat d'une generation precedente, etc.).
// On supprime toutes les pages sauf la derniere (InDesign exige au moins 1 page),
// puis cette derniere sera ecrasee par la premiere page generee (COUVERTURE AT_BEGINNING).
try {
    while (doc.pages.length > 1) {
        doc.pages.lastItem().remove();
    }
} catch(purgeErr) {}

// --- 14. Generation des pages ------------------------------------------------
var pagesGenerated = 0;

for (var i = 0; i < data.pages.length; i++) {

    var pageData = data.pages[i];

    // Mettre a jour le contexte pour les avertissements de debordement
    currentPageNum   = pageData.page_number || (i + 1);
    currentPageTitre = pageData.titre || pageData.title || "";

    // -- COUVERTURE - placee en debut de document -----------------------------
    if (pageData.template === "COUVERTURE") {
        var msCover = loadGabarit("COUVERTURE", false);
        if (!msCover) continue;

        var coverPage = doc.pages.add(LocationOptions.AT_BEGINNING);
        // Supprimer la page residuelle qui etait au rang 0 avant l'insertion
        // (maintenant au rang 1 apres AT_BEGINNING) pour eviter un blanc parasite.
        try {
            if (doc.pages.length > 1) { doc.pages.item(1).remove(); }
        } catch(e) {}
        coverPage.appliedMaster = msCover;
        overrideAllFromMaster(msCover, coverPage);
        injectPageContent(coverPage, pageData);
        pagesGenerated++;
        continue;
    }

    // -- PRESENTATION_GUIDE ---------------------------------------------------
    if (pageData.template === "PRESENTATION_GUIDE") {
        var msPresGuide = loadGabarit("PRESENTATION_GUIDE", false);
        if (!msPresGuide) continue;

        var presPage = addPageWithMaster(msPresGuide, "PRESENTATION_GUIDE");
        injectPageContent(presPage, pageData);
        pagesGenerated++;
        continue;
    }

    // -- CLUSTER --------------------------------------------------------------
    if (pageData.template === "CLUSTER") {
        var msCluster = loadGabarit("CLUSTER", false);
        if (!msCluster) continue;

        var clusterPage = addPageWithMaster(msCluster, "CLUSTER");
        injectPageContent(clusterPage, pageData);
        pagesGenerated++;
        continue;
    }

    // -- CARTE_DESTINATION ----------------------------------------------------
    if (pageData.template === "CARTE_DESTINATION") {
        var msCarteDest = loadGabarit("CARTE_DESTINATION", false);
        if (!msCarteDest) continue;

        var carteDestPage = addPageWithMaster(msCarteDest, "CARTE_DESTINATION");
        injectPageContent(carteDestPage, pageData);
        pagesGenerated++;
        continue;
    }

    // -- PRESENTATION_DESTINATION ---------------------------------------------
    if (pageData.template === "PRESENTATION_DESTINATION") {
        var msPresDest = loadGabarit("PRESENTATION_DESTINATION", false);
        if (!msPresDest) continue;

        var presDestPage = addPageWithMaster(msPresDest, "PRESENTATION_DESTINATION");
        injectPageContent(presDestPage, pageData);
        pagesGenerated++;
        continue;
    }

    // -- INSPIRATION ----------------------------------------------------------
    if (pageData.template === "INSPIRATION") {
        var msInspi = loadGabarit("INSPIRATION", false);
        if (!msInspi) continue;

        var inspiPage = addPageWithMaster(msInspi, "INSPIRATION");
        injectPageContent(inspiPage, pageData);
        pagesGenerated++;
        continue;
    }

    // -- SAISON ---------------------------------------------------------------
    if (pageData.template === "SAISON") {
        var msSaison = loadGabarit("SAISON", false);
        if (!msSaison) continue;

        var saisonPage = addPageWithMaster(msSaison, "SAISON");
        injectPageContent(saisonPage, pageData);
        pagesGenerated++;
        continue;
    }

    // -- POI ------------------------------------------------------------------
    if (pageData.template !== "POI") continue;

    var newPage = addPageWithMaster(master, "POI");

    // Injection unifiee via injectPageContent (textes, images, liens cadres)
    // puis injectPictoBar pour la barre pictos + duree (champs SKIP_IN_TEXT_STEP).
    injectPageContent(newPage, pageData);
    var durationVal = (pageData.content.text || {})["POI_meta_duree"]
                   || (pageData.content.text || {})["POI_meta_1"]
                   || null;
    injectPictoBar(newPage, pageData.content, durationVal);

    pagesGenerated++;
}

var finalMsg = pagesGenerated + " page(s) générée(s) ✔  |  "
             + doc.pages.length + " page(s) dans le document  |  "
             + "JSON : " + data.pages.length + " page(s)";

if (doc.pages.length !== data.pages.length) {
    finalMsg += "\n\n[!] ECART : " + doc.pages.length + " pages dans le doc vs "
              + data.pages.length + " dans le JSON\n";
    finalMsg += "Gabarit par page :\n";
    for (var rp = 0; rp < doc.pages.length; rp++) {
        var rpPage = doc.pages.item(rp);
        var rpMaster = "?";
        try { rpMaster = rpPage.appliedMaster ? rpPage.appliedMaster.name : "[None]"; } catch(e) {}
        finalMsg += "  p." + (rp + 1) + " : " + rpMaster + "\n";
    }
}

// --- Ecrire le rapport de debordement dans un fichier texte -------------------
// Un fichier overflow-report.txt est cree a cote du JSON si des blocs ont ete
// tronques. L'alerte n'affiche qu'un resume d'une ligne pour eviter les dialogs
// interminables lors des generations de 100+ pages.
if (overflowWarnings.length > 0) {
    var overflowReportPath = rootFolder + "/overflow-report.txt";
    var overflowWritten    = false;
    try {
        var now        = new Date();
        var nowStr     = now.getFullYear() + "-"
                       + (now.getMonth() + 1 < 10 ? "0" : "") + (now.getMonth() + 1) + "-"
                       + (now.getDate()         < 10 ? "0" : "") + now.getDate()      + " "
                       + (now.getHours()        < 10 ? "0" : "") + now.getHours()     + ":"
                       + (now.getMinutes()      < 10 ? "0" : "") + now.getMinutes();
        var rf = new File(overflowReportPath);
        rf.encoding = "UTF-8";
        rf.open("w");
        rf.writeln("TEXTE TROP LONG - " + nowStr);
        rf.writeln("Blocs tronques : " + overflowWarnings.length);
        rf.writeln("----------------------------------------------------");
        for (var ow = 0; ow < overflowWarnings.length; ow++) {
            rf.writeln("p." + overflowWarnings[ow].page
                     + "  [" + overflowWarnings[ow].label + "]"
                     + (overflowWarnings[ow].titre ? "  " + overflowWarnings[ow].titre : ""));
        }
        rf.writeln("----------------------------------------------------");
        rf.writeln("Reduisez le texte de ces champs dans l editeur de contenu.");
        rf.close();
        overflowWritten = true;
    } catch(e) {}

    finalMsg += "\n\n[!] " + overflowWarnings.length + " bloc(s) tronque(s)"
              + (overflowWritten ? " -> voir overflow-report.txt" : " (impossible d ecrire le fichier rapport)");
}

if (missingGabarits.length > 0) {
    finalMsg += "\n[!] Gabarit(s) introuvable(s) :";
    for (var mg = 0; mg < missingGabarits.length; mg++) {
        finalMsg += " " + missingGabarits[mg];
    }
}

// Restaurer les preferences Smart Text Reflow
try {
    app.textPreferences.smartTextReflow         = savedSmartReflow;
    app.textPreferences.limitToMasterTextFrames = savedLimitToMaster;
} catch(e) {}

alert(finalMsg);
