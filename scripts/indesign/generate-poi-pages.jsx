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
var DEBUG_PICTOS = false;

// Mettre a true pour afficher un rapport de diagnostic sur chaque page INSPIRATION.
// Affiche : cles JSON avec/sans mapping, labels trouves sur la page.
// Desactiver (false) en production.
var DEBUG_INSPIRATION = true;

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
    "INSPIRATION":             "H-INSPIRATION"
};

// Cache des gabarits charges (evite de recharger plusieurs fois)
// null = gabarit absent (deja signale), undefined = pas encore teste
var gabaritCache = {};

// Liste des gabarits manquants detectes (pour le rapport final)
var missingGabarits = [];

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
            injectItemVisibility(page, aKey, null); // masque le groupe initialement
        } else {
            injectText(page, aKey, null);
        }
    }

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
        overrideAllFromMaster(msCover, coverPage);
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
        overrideAllFromMaster(msPresGuide, presPage);
        injectPageContent(presPage, pageData);
        pagesGenerated++;
        continue;
    }

    // -- CLUSTER --------------------------------------------------------------
    if (pageData.template === "CLUSTER") {
        var msCluster = loadGabarit("CLUSTER", false);
        if (!msCluster) continue;

        var clusterPage = doc.pages.add();
        clusterPage.appliedMaster = msCluster;
        overrideAllFromMaster(msCluster, clusterPage);
        injectPageContent(clusterPage, pageData);
        pagesGenerated++;
        continue;
    }

    // -- CARTE_DESTINATION ----------------------------------------------------
    if (pageData.template === "CARTE_DESTINATION") {
        var msCarteDest = loadGabarit("CARTE_DESTINATION", false);
        if (!msCarteDest) continue;

        var carteDestPage = doc.pages.add();
        carteDestPage.appliedMaster = msCarteDest;
        overrideAllFromMaster(msCarteDest, carteDestPage);
        injectPageContent(carteDestPage, pageData);
        pagesGenerated++;
        continue;
    }

    // -- PRESENTATION_DESTINATION ---------------------------------------------
    if (pageData.template === "PRESENTATION_DESTINATION") {
        var msPresDest = loadGabarit("PRESENTATION_DESTINATION", false);
        if (!msPresDest) continue;

        var presDestPage = doc.pages.add();
        presDestPage.appliedMaster = msPresDest;
        overrideAllFromMaster(msPresDest, presDestPage);
        injectPageContent(presDestPage, pageData);
        pagesGenerated++;
        continue;
    }

    // -- INSPIRATION ----------------------------------------------------------
    if (pageData.template === "INSPIRATION") {
        var msInspi = loadGabarit("INSPIRATION", false);
        if (!msInspi) continue;

        var inspiPage = doc.pages.add();
        inspiPage.appliedMaster = msInspi;
        overrideAllFromMaster(msInspi, inspiPage);
        injectPageContent(inspiPage, pageData);
        pagesGenerated++;
        continue;
    }

    // -- POI ------------------------------------------------------------------
    if (pageData.template !== "POI") continue;

    var newPage = doc.pages.add();
    newPage.appliedMaster = master;
    overrideAllFromMaster(master, newPage);

    var textContent  = pageData.content.text   || {};
    var imageContent = pageData.content.images || {};

    // ---- DEBUG POI (une seule page) ----------------------------------------
    if (DEBUG_PICTOS) {
        // Alerte 1 : textContent + presence dans les mappings
        var dbg1 = "=== DEBUG POI page " + (i+1) + " - CONTENU JSON ===\n\n";
        dbg1 += "textContent (" + (function(){ var n=0; for(var k in textContent) if(textContent.hasOwnProperty(k)) n++; return n; }()) + " cles) :\n";
        for (var _tk in textContent) {
            if (!textContent.hasOwnProperty(_tk)) continue;
            var _tv = String(textContent[_tk] || "");
            var _inMap = data.mappings.fields.hasOwnProperty(_tk) ? "MAP OK -> " + data.mappings.fields[_tk] : "ABSENT DES MAPPINGS";
            dbg1 += "  " + _tk + " [" + _inMap + "] = \"" + _tv.substring(0, 40) + "\"\n";
        }
        alert(dbg1);

        // Alerte 2 : labels sur la page vs mappings POI
        var dbg2 = "=== DEBUG POI page " + (i+1) + " - LABELS & MAPPINGS POI ===\n\n";
        var _pi2 = newPage.allPageItems;
        dbg2 += "Labels sur la page :\n";
        for (var _d2 = 0; _d2 < _pi2.length; _d2++) {
            try { var _l2 = _pi2[_d2].label; if (_l2) dbg2 += "  " + _l2 + "\n"; } catch(e) {}
        }
        dbg2 += "\nMappings contenant 'POI' :\n";
        var _poiFound = false;
        for (var _mk2 in data.mappings.fields) {
            if (!data.mappings.fields.hasOwnProperty(_mk2)) continue;
            if (_mk2.indexOf("POI") !== -1) { dbg2 += "  " + _mk2 + " -> " + data.mappings.fields[_mk2] + "\n"; _poiFound = true; }
        }
        if (!_poiFound) dbg2 += "  (AUCUN champ POI dans data.mappings.fields !)\n";
        alert(dbg2);
    }
    // ---- FIN DEBUG ---------------------------------------------------------

    // Etape A : masquer tous les champs mappes (sauf statiques du gabarit)
    for (var key in data.mappings.fields) {
        if (!data.mappings.fields.hasOwnProperty(key)) continue;
        if (SKIP_IN_MASK_STEP[key]) continue;
        if (key.indexOf("_card_") !== -1) {
            injectItemVisibility(newPage, data.mappings.fields[key], null);
        } else {
            injectText(newPage, data.mappings.fields[key], null);
        }
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
        if (key.indexOf("_card_") !== -1) {
            injectItemVisibility(newPage, mapping, strVal);
        } else {
            if (strVal === "") continue;
            // Resoudre les placeholders {{VAR}} avec les donnees de la page courante
            strVal = strVal.replace(/\{\{URL_ARTICLE_SOURCE\}\}/g,   pageData.url_source || "");
            strVal = strVal.replace(/\{\{TITRE_ARTICLE_SOURCE\}\}/g, pageData.title       || "");
            if (key.indexOf("_nom_hashtag_") !== -1) {
                injectNomHashtag(newPage, mapping, strVal);
            } else if (BULLET_LIST_FIELDS[key]) {
                injectBulletText(newPage, mapping, strVal);
            } else {
                injectText(newPage, mapping, strVal);
            }
        }
    }

    // Etape B2 : liens sur cadres graphiques (FRAME_LINK_FIELDS)
    for (var flKey in FRAME_LINK_FIELDS) {
        if (!FRAME_LINK_FIELDS.hasOwnProperty(flKey)) continue;
        var flMapping = data.mappings.fields[flKey];
        if (!flMapping) continue;
        injectFrameHyperlink(newPage, flMapping, textContent[flKey] || null);
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

    // ---- DEBUG FINAL (apres toutes les etapes) ------------------------------
    if (DEBUG_PICTOS) {
        var dbgF = "=== ETAT FINAL (apres A+B+C+D+E) ===\n\n";
        var _piF = newPage.allPageItems;
        for (var _dF = 0; _dF < _piF.length; _dF++) {
            try {
                var _lF = _piF[_dF].label;
                if (!_lF) continue;
                var _visF = _piF[_dF].visible;
                var _contF = "";
                try { if (_piF[_dF] instanceof TextFrame) _contF = String(_piF[_dF].contents).substring(0, 30); else _contF = "[img]"; } catch(e) {}
                // Verifier la visibilite des parents
                var _parentVis = "parent?";
                try {
                    var _par = _piF[_dF].parent;
                    if (_par && typeof _par.visible !== "undefined") _parentVis = "parent.visible=" + _par.visible + " (" + _par.typename + ")";
                    else _parentVis = "parent=page";
                } catch(e) { _parentVis = "parent=page"; }
                dbgF += _lF + "\n  visible=" + _visF + " " + _parentVis + "\n  \"" + _contF + "\"\n";
            } catch(e) {}
        }
        alert(dbgF);
        DEBUG_PICTOS = false;
    }
    // ---- FIN DEBUG FINAL ---------------------------------------------------

    pagesGenerated++;
}

var finalMsg = pagesGenerated + " page(s) g\u00e9n\u00e9r\u00e9e(s) avec succ\u00e8s \u2714";
if (missingGabarits.length > 0) {
    finalMsg += "\n\n\u26a0 Gabarit(s) introuvable(s) dans ce document \u2014 pages ignor\u00e9es :\n";
    for (var mg = 0; mg < missingGabarits.length; mg++) {
        finalMsg += "  \u2022 " + missingGabarits[mg] + "\n";
    }
    finalMsg += "\nV\u00e9rifie que ces gabarits existent bien dans le panneau Pages (Fen\u00eatre \u2192 Pages).";
}
alert(finalMsg);
