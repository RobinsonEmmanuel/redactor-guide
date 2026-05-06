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

/** Compteur de pages SOMMAIRE (1 = premiere page sommaire, 2 = deuxieme) pour repartir les entrees JSON. */
var SOMMAIRE_SPREAD_INDEX = 0;

/** page_number redactionnel (JSON) -> reference Page InDesign (rempli a la generation). */
var REDACTOR_PAGE_MAP_GLOBAL = {};
/** Indice JSON -> Page InDesign pour lier le sommaire apres coup. */
var DOC_PAGE_BY_JSON_INDEX = [];

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
// POI_lien_2 et ALLER_PLUS_LOIN_lien_N : NE PAS ajouter ici.
// injectText gere deja les JSON {"label","url"} → il injecte le label dans le cadre texte.
// FRAME_LINK_FIELDS s'occupe en plus d'appliquer le lien sur le groupe entier.
var SKIP_IN_TEXT_STEP  = {
    "POI_meta_duree":            true,
    "POI_meta_1":                true,
    "POI_lien_2":                true,
    // JSON sommaire : les "{" declencheraient applyStyleMarkers / style Orange par erreur
    "SOMMAIRE_texte_1":          true
};

// Champs a NE PAS masquer a l'etape A (injectText null ne sait pas masquer les cadres graphiques)
var SKIP_IN_MASK_STEP  = {
    "POI_lien_2":                true,
    "ALLER_PLUS_LOIN_lien_1":    true,
    "ALLER_PLUS_LOIN_lien_2":    true,
    "ALLER_PLUS_LOIN_lien_3":    true,
    "ALLER_PLUS_LOIN_lien_4":    true,
    "ALLER_PLUS_LOIN_lien_5":    true,
    "ALLER_PLUS_LOIN_lien_6":    true
};

// Champs dont la valeur est un lien {label, url} ou une URL brute a appliquer
// sur un cadre GRAPHIQUE (non-TextFrame) via HyperlinkPageItemSource.
// Cle = nom du champ JSON, valeur = true.
var FRAME_LINK_FIELDS  = {
    "POI_lien_2":                true,
    "ALLER_PLUS_LOIN_lien_1":    true,
    "ALLER_PLUS_LOIN_lien_2":    true,
    "ALLER_PLUS_LOIN_lien_3":    true,
    "ALLER_PLUS_LOIN_lien_4":    true,
    "ALLER_PLUS_LOIN_lien_5":    true,
    "ALLER_PLUS_LOIN_lien_6":    true
};

// Noms des gabarits InDesign associes a chaque template
// Ajouter ici chaque nouveau template : { "NOM_TEMPLATE": "NOM_GABARIT_INDESIGN" }
var GABARIT_NAMES = {
    "COUVERTURE":              "A-COUVERTURE",
    "PRESENTATION_GUIDE":      "B-PRESENTATION_GUIDE",
    "SOMMAIRE":                "F-SOMMAIRE",
    "PRESENTATION_DESTINATION":"C-PRESENTATION_DESTINATION",
    "CARTE":                   "E-CARTE_DESTINATION",
    "CARTE_DESTINATION":       "E-CARTE_DESTINATION", // compatibilite anciens exports
    "CLUSTER":                 "D-CLUSTER",
    "POI":                     "G-POI",
    "INSPIRATION":             "H-INSPIRATION-6", // fallback par defaut
    "INSPIRATION_6":           "H-INSPIRATION-6",
    "INSPIRATION_5":           "M-INSPIRATION-5",
    "INSPIRATION_4":           "N-INSPIRATION-4",
    "INSPIRATION_3":           "O-INSPIRATION-3",
    "INSPIRATION_2":           "P-INSPIRATION-2",
    "INSPIRATION_1":           "Q-INSPIRATION-1",
    "SAISON":                  "I-SAISON",
    "ALLER_PLUS_LOIN":         "J-ALLER_PLUS_LOIN",
    "A_PROPOS_RL":             "K-A_PROPOS_RL",
    "SECTION":                 "L-SECTION"
};

// Cache des gabarits charges (evite de recharger plusieurs fois)
// null = gabarit absent (deja signale), undefined = pas encore teste
var gabaritCache = {};

// Liste des gabarits manquants detectes (pour le rapport final)
var missingGabarits = [];

// Liste des blocs tronques (texte trop long) detectes pendant la generation
// Format : { page: N, label: "...", titre: "..." }
var overflowWarnings = [];
// Images réellement non placées (échec local + URL) — rapport final
var imagePlacementWarnings = [];
// Evite de répéter le même popup debug pictos sur la même page
var pictoDebugShownPages = {};

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

// --- 1b. Choix automatique du gabarit INSPIRATION selon nb de cartes ----------
// Compte les slots N actifs (1..6) via les cles _card_N, _nom_hashtag_N, _url_*_N et _image_N.
// Retourne un entier 0..6.
function countInspirationCards(pageData) {
    var textContent  = (pageData && pageData.content && pageData.content.text)   || {};
    var imageContent = (pageData && pageData.content && pageData.content.images) || {};
    var seen = {};

    function markFromKey(key, value, strictBooleanCard) {
        var m = key.match(/^INSPIRATION_1_(?:card|nom_hashtag|url_article|url_maps|image)_(\d+)$/);
        if (!m) return;
        var idx = parseInt(m[1], 10);
        if (!(idx >= 1 && idx <= 6)) return;

        if (strictBooleanCard) {
            var s = String(value === undefined || value === null ? "" : value).toLowerCase().replace(/^\s+|\s+$/g, "");
            if (s === "" || s === "0" || s === "false" || s === "non" || s === "null" || s === "undefined") return;
            seen[idx] = true;
            return;
        }

        if (value === null || value === undefined) return;
        if (typeof value === "string") {
            var t = value.replace(/^\s+|\s+$/g, "");
            if (t === "") return;
            seen[idx] = true;
            return;
        }
        if (typeof value === "object") {
            if (value.url && String(value.url).replace(/^\s+|\s+$/g, "") !== "") seen[idx] = true;
            return;
        }
        seen[idx] = true;
    }

    for (var tKey in textContent) {
        if (!textContent.hasOwnProperty(tKey)) continue;
        markFromKey(tKey, textContent[tKey], tKey.indexOf("_card_") !== -1);
    }
    for (var iKey in imageContent) {
        if (!imageContent.hasOwnProperty(iKey)) continue;
        markFromKey(iKey, imageContent[iKey], false);
    }

    var count = 0;
    for (var i = 1; i <= 6; i++) if (seen[i]) count++;
    return count;
}

function loadInspirationGabarit(pageData) {
    var count = countInspirationCards(pageData);
    var safeCount = (count >= 1 && count <= 6) ? count : 6;
    var key = "INSPIRATION_" + safeCount;
    var ms = loadGabarit(key, false);

    // Fallback securise : si le gabarit cible manque, tenter le 6 puis le fallback historique.
    if (!ms && safeCount !== 6) ms = loadGabarit("INSPIRATION_6", false);
    if (!ms) ms = loadGabarit("INSPIRATION", false);

    try {
        $.writeln("[INSPIRATION] cards=" + count + " -> gabarit=" + (ms ? key : "NONE"));
    } catch(e) {}

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
// Quand un gabarit est une planche multi-pages (ex : B-PRESENTATION_GUIDE sur 4 pages),
// InDesign ajoute automatiquement des pages compagnes dans le meme Spread.
// doc.pages[i].remove() echoue silencieusement sur ces pages liees a une planche.
// Solution : travailler au niveau du Spread (targetPage.parent) et non de doc.pages.
function addPageWithMaster(masterSpread, templateName) {
    var targetPage = doc.pages.add();
    targetPage.appliedMaster = masterSpread;
    overrideAllFromMaster(masterSpread, targetPage);

    // Supprimer les pages compagnes au niveau du Spread contenant targetPage
    try {
        var theSpread = targetPage.parent; // objet Spread InDesign
        for (var sp = theSpread.pages.length - 1; sp >= 0; sp--) {
            var pg = theSpread.pages[sp];
            if (pg !== targetPage) {
                try { pg.remove(); } catch(e) {}
            }
        }
    } catch(e) {}

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
        app.findGrepPreferences.findWhat = "(?s)\\*\\*.+?\\*\\*";
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
        app.findGrepPreferences.findWhat = "(?s)\\{.+?\\}";
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
        app.findGrepPreferences.findWhat = "(?s)\\^.+?\\^";
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
        // \x7E = code hex du caractere tilde (ASCII 126).
        // En GREP InDesign, "~" est un prefixe de codes speciaux (ex: ~n, ~S…),
        // et meme [~] peut etre mal interprete. \x7E bypass toute interpretation.
        // (?s) = dotall, +? = non-greedy.
        app.findGrepPreferences   = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(?s)\\x7E.+?\\x7E";
        var grasOrangeMatches = story.findGrep();
        app.findGrepPreferences = NothingEnum.NOTHING;
        if (grasOrangeStyle.isValid) {
            for (var g = 0; g < grasOrangeMatches.length; g++) {
                try { grasOrangeMatches[g].appliedCharacterStyle = grasOrangeStyle; } catch(e) {}
            }
        }
        // Suppression des marqueurs ~  ("~" seul fonctionne pour la suppression)
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
            var strRaw = String(value).replace(/^\s+|\s+$/g, "");
            var linkLabel = null;
            var linkUrl   = null;
            if (value && typeof value === "object") {
                try {
                    if (value.label !== undefined && value.url !== undefined) {
                        linkLabel = String(value.label || "");
                        linkUrl   = String(value.url   || "");
                    }
                } catch(e) {}
            } else if (strRaw.charAt(0) === "{") {
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
function resolveImageTarget(item) {
    if (!item) return null;
    if (item instanceof TextFrame) return null;

    // Cadres image standards InDesign
    if ((item instanceof Rectangle) || (item instanceof Oval) || (item instanceof Polygon)) {
        return item;
    }

    // Si le label est posé sur un groupe, chercher dedans le premier cadre placeable
    try {
        if (item.allPageItems && item.allPageItems.length > 0) {
            for (var gi = 0; gi < item.allPageItems.length; gi++) {
                var child = item.allPageItems[gi];
                if ((child instanceof Rectangle) || (child instanceof Oval) || (child instanceof Polygon)) {
                    return child;
                }
            }
        }
    } catch(e) {}

    // Fallback : certains objets supportent place() sans être typés ici
    try {
        if (typeof item.place === "function") return item;
    } catch(e) {}

    return null;
}

function injectImage(page, label, imageData) {
    var blocks = findByLabelOnPage(page, label);
    var hasGraphicBlock = false;
    var placedAtLeastOne = false;
    for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        var target = resolveImageTarget(block);
        // Ignorer les TextFrames et objets non placeables
        if (!target) {
            block.visible = false;
            continue;
        }
        hasGraphicBlock = true;
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
                    target.place(localFile);
                    target.fit(FitOptions.FILL_PROPORTIONALLY);
                    placed = true;
                    placedAtLeastOne = true;
                } catch(e) {}
            }
        }
        if (!placed && imageData.url) {
            try {
                target.place(new File(imageData.url));
                target.fit(FitOptions.FILL_PROPORTIONALLY);
                placedAtLeastOne = true;
            } catch(e) { block.visible = false; }
        }
    }
    // Rapporter uniquement les vrais échecs de placement d'image
    if (hasGraphicBlock && imageData && (imageData.local || imageData.url) && !placedAtLeastOne) {
        imagePlacementWarnings.push({
            page:  currentPageNum,
            titre: currentPageTitre,
            label: label,
            local: imageData.local || '',
            url:   imageData.url || ''
        });
    }
}

// --- 9. Injecter un hyperlien sur un bloc texte ------------------------------
// Le texte du bloc reste inchange (statique du gabarit), seul le lien est ajoute.
function injectHyperlink(page, label, url) {
    if (!url || String(url).replace(/^\s+|\s+$/g, "") === "") return;
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

        // Source sur le texte de CE cadre (story filee : parentStory.item(0) peut etre un autre bloc)
        var rangeText = null;
        try {
            if (tf.texts && tf.texts.length > 0) {
                rangeText = tf.texts.item(0);
            }
        } catch(eR) {}
        if (!rangeText) {
            try { rangeText = tf.parentStory.texts.item(0); } catch(eS) { continue; }
        }
        var src;
        try {
            src = doc.hyperlinkTextSources.add(rangeText);
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
    if (value !== null && value !== undefined) {
        if (typeof value === "object") {
            try {
                if (value.url) url = String(value.url).replace(/^\s+|\s+$/g, "");
            } catch(e) {}
        } else {
            var strRaw = String(value).replace(/^\s+|\s+$/g, "");
            if (strRaw.charAt(0) === "{") {
                try {
                    var parsed = eval("(" + strRaw + ")");
                    if (parsed && parsed.url) url = String(parsed.url).replace(/^\s+|\s+$/g, "");
                } catch(e) {}
            } else if (strRaw !== "") {
            url = strRaw;
            }
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
    "picto_reservation",
    "picto_payant",
    // Variants interet (3 cadres superposes, un par valeur)
    "picto_interet_1",   // Incontournable
    "picto_interet_2",   // Interessant
    "picto_interet_3",   // A voir
    // Variants PMR (3 cadres superposes)
    "picto_pmr_full",    // Accessible 100%
    "picto_pmr_half",    // Partiellement accessible
    "picto_pmr_none",    // Non accessible
    // Picto duree (cadre horloge)
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
    var pictosRaw = (contentData._derived && contentData._derived.pictos_active)
        ? contentData._derived.pictos_active
        : [];
    // Filet de securite : exclure les pictos dont la valeur est "non" (booleen inactif).
    // Protege contre une mauvaise configuration option_layers dans le template MongoDB
    // qui mapperait "non" vers un calque non-null.
    var pictosActive = [];
    for (var fi = 0; fi < pictosRaw.length; fi++) {
        var fVal = String(pictosRaw[fi].value || "").toLowerCase().replace(/^\s+|\s+$/, "");
        if (fVal !== "non") { pictosActive.push(pictosRaw[fi]); }
    }

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

    // Debug ciblé : alerte seulement s'il manque des pictos demandés par le contenu.
    if (DEBUG_PICTOS && pictosActive.length > 0 && activePictos.length < pictosActive.length) {
        var debugKey = String(currentPageNum || 0) + "|" + (currentPageTitre || "");
        if (!pictoDebugShownPages[debugKey]) {
            pictoDebugShownPages[debugKey] = true;
            alert(
                "DEBUG PICTOS — page " + (currentPageNum || "?")
                + (currentPageTitre ? (" (" + currentPageTitre + ")") : "")
                + "\nDemandés par le JSON : " + pictosActive.length
                + "\nTrouvés sur le gabarit : " + activePictos.length
                + "\n\nVérifiez les labels indesign_layer / variant_layer du template."
            );
        }
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

// --- 10b. Injection du texte de sommaire -------------------------------------
//
// Export actuel : JSON { schema_version: 1, entries: [...], legacy_text } dans SOMMAIRE_texte_1.
// Chaque entree : title, page (null si titre de section), level (0/1/2), sommaire_page (1 ou 2).
//
// level → styles de paragraphe (cadre titres SOMMAIRE_texte_1) :
//   0 → Titre-section
//   1 → Page-section-sommaire
//   2 → Page-unique-sommaire
//
// Deux dispositions :
//   A) Un seul cadre (SOMMAIRE_texte_1) : titre + tab + page sur une ligne ; regler un taquet
//      droit sur les styles niveau 1 et 2 pour la colonne des numeros.
//   B) Deux cadres : SOMMAIRE_texte_1 (titres) + SOMMAIRE_numeros_1 (numeros). Meme nombre
//      de paragraphes dans chaque cadre — pas de tabulation entre titre et page : l’alignement
//      vertical vient des interlignes (styles jumeles entre colonnes). Pas de coordonnees X/Y
//      dans le script : vous placez le cadre numeros dans la maquette.
//      Titre > 29 caracteres (espaces inclus) : suppose 2 lignes (15/18 pt) ; espace apres +18 pt
//      sur le paragraphe numeros aligne pour compenser la hauteur du bloc titre.
//      Styles numeros (cadre SOMMAIRE_numeros_1), alignes sur level :
//        Titre-section (0) → Sommaire-numeros-absent
//        Page-section-sommaire (1) → Sommaire-numeros-page-section
//        Page-unique-sommaire (2) → Sommaire-numeros-page-seule
//      Export JSON non-structuré (legacy) : Sommaire-numeros / Sommaire-numeros-absent.
//      Export JSON : privilegier entries_by_sommaire_page["1"|"2"] (decoupage explicite). Eviter
//      un fil de texte unique reliant les deux pages sommaire : chaque page = son propre cadre / fil.
//
// Premiere page SOMMAIRE du document : sommaire_page === 1 ; deuxieme : === 2.
//
// Anciens exports : texte tabule seul → traitement Sommaire_niveau1 / Sommaire_niveau2.
//
var SOMMAIRE_STYLE_BY_LEVEL = {
    0: "Titre-section",
    1: "Page-section-sommaire",
    2: "Page-unique-sommaire"
};

var SOMMAIRE_STYLE_N1 = "Sommaire_niveau1"; // fallback ancien export : entrees principales
var SOMMAIRE_STYLE_N2 = "Sommaire_niveau2"; // fallback ancien export : sous-entrees (\t en tete)

/** Cadre optionnel : colonne des numeros (un paragraphe par ligne de titres). */
var SOMMAIRE_NUMEROS_LABEL = "SOMMAIRE_numeros_1";
/** Noms possibles (InDesign : casse / variante). Le premier qui existe est utilise. */
var SOMMAIRE_NUMEROS_STYLE_CANDIDATES = ["Sommaire-numeros", "sommaire-numeros", "Sommaire_numeros"];
var SOMMAIRE_NUMEROS_VIDE_STYLE_CANDIDATES = ["Sommaire-numeros-absent", "sommaire-numeros-absent", "Sommaire_numeros_absent"];
var SOMMAIRE_NUMEROS_PAGE_SECTION_CANDIDATES = [
    "Sommaire-numeros-page-section",
    "sommaire-numeros-page-section",
    "Sommaire_numeros_page_section"
];
var SOMMAIRE_NUMEROS_PAGE_SEULE_CANDIDATES = [
    "Sommaire-numeros-page-seule",
    "sommaire-numeros-page-seule",
    "Sommaire_numeros_page_seule"
];

/**
 * Sommaire 2 cadres : si le titre depasse cette longueur (caracteres, espaces inclus),
 * il occupe 2 lignes avec 15 pt / 18 pt interligne — on ajoute de l'espace apres sur
 * le paragraphe de la colonne numeros pour aligner les blocs suivants.
 */
var SOMMAIRE_TITLE_WRAP_CHAR_MAX = 29;
var SOMMAIRE_NUMEROS_WRAP_EXTRA_SPACE_PT = 18;

/** @param {string} entryTitle titre JSON brut (sans tabulation niveau 1). */
function sommaireTitleWrapsTwoLinesByCharCount(entryTitle) {
    return String(entryTitle || "").length > SOMMAIRE_TITLE_WRAP_CHAR_MAX;
}

function sommaireWrapFlagsFromSlice(slice) {
    var flags = [];
    if (!slice) return flags;
    for (var i = 0; i < slice.length; i++)
        flags.push(sommaireTitleWrapsTwoLinesByCharCount(slice[i] && slice[i].title));
    return flags;
}

function sommaireWrapFlagsFromTitleLines(titleLines) {
    var flags = [];
    if (!titleLines) return flags;
    for (var i = 0; i < titleLines.length; i++) {
        var t = String(titleLines[i] || "");
        if (t.charAt(0) === "\t") t = t.substring(1);
        flags.push(t.length > SOMMAIRE_TITLE_WRAP_CHAR_MAX);
    }
    return flags;
}

function sommaireApplyDualNumerosWrapSpacing(tfNums, wrapFlags) {
    if (!tfNums || !wrapFlags || wrapFlags.length === 0) return;
    try {
        var paras = tfNums.paragraphs;
        var n = paras.length;
        if (wrapFlags.length < n) n = wrapFlags.length;
        for (var pi = 0; pi < n; pi++) {
            if (!wrapFlags[pi]) continue;
            try {
                var p = paras[pi];
                var cur = p.spaceAfter;
                if (cur === undefined || cur === null || isNaN(cur)) cur = 0;
                p.spaceAfter = Number(cur) + SOMMAIRE_NUMEROS_WRAP_EXTRA_SPACE_PT;
            } catch (eP) {}
        }
    } catch (eAll) {}
}

/** @param {string[]} names */
function sommaireFirstValidParagraphStyle(names) {
    if (!names || !names.length) return null;
    for (var i = 0; i < names.length; i++) {
        var pst = doc.paragraphStyles.itemByName(names[i]);
        if (pst.isValid) return pst;
    }
    return null;
}

/**
 * Colonne numeros : style de paragraphe + clearOverrides, sans forcer [None] caractere
 * (sinon graisse / couleur du style Sommaire-numeros peuvent sembler absentes).
 */
function sommaireApplyNumerosParagraphOnly(paragraph, pst) {
    if (!paragraph || !pst || !pst.isValid) return;
    try {
        paragraph.appliedParagraphStyle = pst;
        if (typeof paragraph.clearOverrides === "function") {
            try {
                paragraph.clearOverrides(OverrideType.ALL);
            } catch (eEnum) {
                paragraph.clearOverrides();
            }
        }
    } catch (e) {}
}
var SOMMAIRE_TITRE_PARAGRAPH_STYLE_NAME = "";
/** Style de caractere sur tout le titre (ex. "Orange"). Vide "" pour desactiver. */
var SOMMAIRE_TITRE_CHARACTER_STYLE_NAME = "Orange";

function sommaireEntrySommairePage(entry) {
    var v = entry.sommaire_page;
    if (v === null || v === undefined) return -1;
    var n = parseInt(v, 10);
    return isNaN(n) ? -1 : n;
}

function sommaireFinalizeTitreAppearance(page, pageData) {
    var tc = pageData.content && pageData.content.text;
    if (!tc) return;
    if (tc["SOMMAIRE_titre_1"] === undefined || tc["SOMMAIRE_titre_1"] === null) return;
    var rawT = String(tc["SOMMAIRE_titre_1"]).replace(/^\s+|\s+$/g, "");
    if (rawT === "") return;
    var labelT = (data.mappings.fields && data.mappings.fields["SOMMAIRE_titre_1"]) || "SOMMAIRE_titre_1";

    var pn = String(SOMMAIRE_TITRE_PARAGRAPH_STYLE_NAME || "").replace(/^\s+|\s+$/g, "");
    if (pn) {
        var pst = doc.paragraphStyles.itemByName(pn);
        var tfp = sommaireGetTextFrame(page, labelT);
        if (tfp && pst.isValid) {
            try { tfp.visible = true; } catch (e0) {}
            try {
                var ppar = tfp.paragraphs;
                for (var pi = 0; pi < ppar.length; pi++) {
                    sommaireApplyParagraphStyleStripOverrides(ppar[pi], pst);
                }
            } catch (e1) {}
        }
    }
    var cn = String(SOMMAIRE_TITRE_CHARACTER_STYLE_NAME || "").replace(/^\s+|\s+$/g, "");
    if (cn) {
        var chSt = doc.characterStyles.itemByName(cn);
        var tfc = sommaireGetTextFrame(page, labelT);
        if (tfc && chSt.isValid) {
            try { tfc.visible = true; } catch (e2) {}
            try { tfc.characters.everyItem().appliedCharacterStyle = chSt; } catch (e3) {}
        }
    }
}

function sommaireGetTextFrame(page, label) {
    var blocks = findByLabelOnPage(page, label);
    for (var b = 0; b < blocks.length; b++) {
        if (blocks[b] instanceof TextFrame) return blocks[b];
    }
    return null;
}

/**
 * Applique un style de paragraphe puis retire les dérogations caractère
 * (texte issu du gabarit hérite souvent orange / gras / 45 pt du titre « Sommaire »).
 */
function sommaireApplyParagraphStyleStripOverrides(paragraph, pst) {
    if (!paragraph || !pst || !pst.isValid) return;
    try {
        paragraph.appliedParagraphStyle = pst;
        if (typeof paragraph.clearOverrides === "function") {
            try {
                paragraph.clearOverrides(OverrideType.ALL);
            } catch (eEnum) {
                paragraph.clearOverrides();
            }
        }
        try {
            var noneCh = doc.characterStyles.itemByName("[None]");
            if (!noneCh.isValid) noneCh = doc.characterStyles[0];
            if (noneCh.isValid) paragraph.characters.everyItem().appliedCharacterStyle = noneCh;
        } catch (eNc) {}
    } catch (e) {}
}

function sommaireApplyNumerosStyles(tfNums, numLines, styleLevels) {
    if (!tfNums || !numLines || numLines.length === 0) return;
    try {
        var stGeneric = sommaireFirstValidParagraphStyle(SOMMAIRE_NUMEROS_STYLE_CANDIDATES);
        var stVide = sommaireFirstValidParagraphStyle(SOMMAIRE_NUMEROS_VIDE_STYLE_CANDIDATES);
        var stSection = sommaireFirstValidParagraphStyle(SOMMAIRE_NUMEROS_PAGE_SECTION_CANDIDATES);
        var stSeule = sommaireFirstValidParagraphStyle(SOMMAIRE_NUMEROS_PAGE_SEULE_CANDIDATES);
        var paras = tfNums.paragraphs;
        var count = paras.length;
        var useLevels = styleLevels && styleLevels.length > 0;
        for (var pn = 0; pn < count; pn++) {
            var lineVal = pn < numLines.length ? numLines[pn] : "";
            var hasNum = String(lineVal || "").replace(/^\s+|\s+$/, "") !== "";
            try {
                if (useLevels && pn < styleLevels.length) {
                    var lv = parseInt(styleLevels[pn], 10);
                    var pstPick = null;
                    if (isNaN(lv) || lv === 0 || !hasNum) {
                        pstPick = stVide;
                    } else if (lv === 1) {
                        pstPick = stSection || stGeneric;
                    } else {
                        pstPick = stSeule || stGeneric;
                    }
                    if (pstPick) sommaireApplyNumerosParagraphOnly(paras[pn], pstPick);
                } else {
                    if (hasNum && stGeneric) {
                        sommaireApplyNumerosParagraphOnly(paras[pn], stGeneric);
                    } else if (!hasNum && stVide) {
                        sommaireApplyNumerosParagraphOnly(paras[pn], stVide);
                    } else if (stGeneric) {
                        sommaireApplyNumerosParagraphOnly(paras[pn], stGeneric);
                    } else if (stVide) {
                        sommaireApplyNumerosParagraphOnly(paras[pn], stVide);
                    }
                }
            } catch (eN) {}
        }
    } catch (eAll) {}
}

function sommaireSplitLegacyLineToTitleNum(line) {
    var t = String(line || "");
    if (t.charAt(0) === "\t") {
        var parts = t.split("\t");
        if (parts.length >= 3) {
            return { title: "\t" + parts[1], num: String(parts[parts.length - 1] || "").replace(/^\s+|\s+$/, "") };
        }
        return { title: t, num: "" };
    }
    var idx = t.indexOf("\t");
    if (idx >= 0) {
        return {
            title: t.substring(0, idx),
            num: t.substring(idx + 1).replace(/^\s+|\s+$/, "")
        };
    }
    return { title: t, num: "" };
}

/** Utilise entries_by_sommaire_page du JSON si present ; sinon filtre entries. */
function sommaireBuildSliceForPart(parsed, part) {
    var slice = [];
    var explicitByPage = false;
    var byPage = parsed.entries_by_sommaire_page;
    if (byPage && typeof byPage === "object") {
        var pk = String(part);
        if (byPage[pk] !== undefined && byPage[pk] !== null) {
            explicitByPage = true;
            var bag = byPage[pk];
            if (bag instanceof Array) {
                for (var si = 0; si < bag.length; si++) slice.push(bag[si]);
            }
        }
    }
    if (!explicitByPage) {
        var allE = parsed.entries || [];
        for (var ei = 0; ei < allE.length; ei++) {
            if (sommaireEntrySommairePage(allE[ei]) === part) slice.push(allE[ei]);
        }
    }
    return { slice: slice, explicitByPage: explicitByPage };
}

function injectSommaireText(page, pageData, sommaireSpreadPart) {
    var textContent = pageData.content.text || {};
    var rawValue = textContent["SOMMAIRE_texte_1"];

    if (!rawValue || String(rawValue).replace(/^\s+|\s+$/, "") === "") return;

    var tfTitle = sommaireGetTextFrame(page, "SOMMAIRE_texte_1");
    if (!tfTitle) return;

    try { tfTitle.visible = true; } catch (eVis0) {}

    var tfNums = sommaireGetTextFrame(page, SOMMAIRE_NUMEROS_LABEL);
    if (tfNums) { try { tfNums.visible = true; } catch (eVisN) {} }
    var dualMode = tfNums !== null;

    var part = parseInt(sommaireSpreadPart, 10);
    if (isNaN(part) || part < 1) part = 1;
    var indesignText = "";
    var styleLevels = null;
    var useLegacyParaStyles = false;
    var titleLines = null;
    var numLines = null;
    var sommaireDualSliceRef = null;

    try {
        var rawStr = String(rawValue).replace(/^\uFEFF/g, "").replace(/^\s+|\s+$/, "");
        if (rawStr.charAt(0) === "{") {
            var parsed = JSON.parse(rawStr);
            if (parsed.schema_version === 1 && (parsed.entries || parsed.entries_by_sommaire_page)) {
                var sl = sommaireBuildSliceForPart(parsed, part);
                var slice = sl.slice;
                var explicitByPage = sl.explicitByPage;
                if (slice.length === 0) {
                    if (explicitByPage) {
                        try { tfTitle.contents = ""; } catch (eCl0) {}
                        if (dualMode && tfNums) { try { tfNums.contents = ""; } catch (eCl1) {} }
                    }
                    return;
                }

                sommaireDualSliceRef = slice;

                styleLevels = [];
                if (dualMode) {
                    titleLines = [];
                    numLines = [];
                    for (var j = 0; j < slice.length; j++) {
                        var e = slice[j];
                        var lv = parseInt(e.level, 10);
                        if (isNaN(lv)) lv = 2;
                        styleLevels.push(lv);
                        var pg = e.page;
                        var haspg = pg !== null && pg !== undefined && String(pg).replace(/^\s+|\s+$/, "") !== "";
                        if (!haspg) {
                            titleLines.push(String(e.title || ""));
                            numLines.push("");
                        } else if (lv === 1) {
                            titleLines.push("\t" + String(e.title || ""));
                            numLines.push(String(pg));
                        } else {
                            titleLines.push(String(e.title || ""));
                            numLines.push(String(pg));
                        }
                    }
                    indesignText = titleLines.join("\r");
                } else {
                    var lines = [];
                    for (var j2 = 0; j2 < slice.length; j2++) {
                        var e2 = slice[j2];
                        var lv2 = parseInt(e2.level, 10);
                        if (isNaN(lv2)) lv2 = 2;
                        styleLevels.push(lv2);
                        var pg2 = e2.page;
                        var hasPage = pg2 !== null && pg2 !== undefined && String(pg2).replace(/^\s+|\s+$/, "") !== "";
                        if (!hasPage) {
                            lines.push(String(e2.title || ""));
                        } else if (lv2 === 1) {
                            lines.push("\t" + String(e2.title || "") + "\t" + String(pg2));
                        } else {
                            lines.push(String(e2.title || "") + "\t" + String(pg2));
                        }
                    }
                    indesignText = lines.join("\r");
                }
            } else {
                throw new Error("not v1");
            }
        } else {
            throw new Error("not json");
        }
    } catch (parseErr) {
        styleLevels = null;
        useLegacyParaStyles = true;
        var rawLegacy = String(rawValue).replace(/\r\n/g, "\r").replace(/\n/g, "\r");
        if (part > 1) return;

        if (dualMode) {
            var leg = rawLegacy.split("\r");
            titleLines = [];
            numLines = [];
            for (var li = 0; li < leg.length; li++) {
                var sp = sommaireSplitLegacyLineToTitleNum(leg[li]);
                titleLines.push(sp.title);
                numLines.push(sp.num);
            }
            indesignText = titleLines.join("\r");
        } else {
            indesignText = rawLegacy;
        }
    }

    if (dualMode && titleLines !== null && numLines !== null) {
        tfTitle.contents = titleLines.join("\r");
        tfNums.contents = numLines.join("\r");
    } else {
        tfTitle.contents = indesignText;
    }

    try {
        var paras = tfTitle.paragraphs;
        if (styleLevels && styleLevels.length > 0) {
            for (var p = 0; p < paras.length && p < styleLevels.length; p++) {
                try {
                    var lvl = styleLevels[p];
                    var stName = SOMMAIRE_STYLE_BY_LEVEL[lvl];
                    if (!stName) continue;
                    var pst = doc.paragraphStyles.itemByName(stName);
                    if (pst.isValid) sommaireApplyParagraphStyleStripOverrides(paras[p], pst);
                } catch (ePara) {}
            }
            if (dualMode && numLines) sommaireApplyNumerosStyles(tfNums, numLines, styleLevels);
            if (dualMode && tfNums && sommaireDualSliceRef)
                sommaireApplyDualNumerosWrapSpacing(tfNums, sommaireWrapFlagsFromSlice(sommaireDualSliceRef));
        } else if (useLegacyParaStyles) {
            var styleN1 = doc.paragraphStyles.itemByName(SOMMAIRE_STYLE_N1);
            var styleN2 = doc.paragraphStyles.itemByName(SOMMAIRE_STYLE_N2);
            var n1Valid = styleN1.isValid;
            var n2Valid = styleN2.isValid;
            if (n1Valid || n2Valid) {
                for (var p2 = 0; p2 < paras.length; p2++) {
                    try {
                        var paraText = paras[p2].contents;
                        if (paraText.charAt(0) === "\t" && n2Valid) {
                            sommaireApplyParagraphStyleStripOverrides(paras[p2], styleN2);
                        } else if (n1Valid) {
                            sommaireApplyParagraphStyleStripOverrides(paras[p2], styleN1);
                        }
                    } catch (e2) {}
                }
            }
            if (dualMode && numLines) sommaireApplyNumerosStyles(tfNums, numLines, null);
            if (dualMode && tfNums && titleLines)
                sommaireApplyDualNumerosWrapSpacing(tfNums, sommaireWrapFlagsFromTitleLines(titleLines));
        }
    } catch (eSt) {}

    truncateOverflow(tfTitle);
    if (tfNums) truncateOverflow(tfNums);
}

/** Associe la page creee a son indice JSON et au numero redactionnel (sommaire cliquable). */
function docRegisterJsonPage(jsonIndex, pageData, idPage) {
    if (!idPage) return;
    try {
        DOC_PAGE_BY_JSON_INDEX[jsonIndex] = idPage;
        var pn = pageData.page_number;
        if (pn === null || pn === undefined) return;
        var ps = String(pn).replace(/^\s+|\s+$/g, "");
        if (ps === "") return;
        var k = parseInt(ps, 10);
        if (!isNaN(k)) REDACTOR_PAGE_MAP_GLOBAL[k] = idPage;
    } catch (eReg) {}
}

/** Complete la carte n° -> Page pour les cles manquantes (offset JSON / PDF, script de mise a jour). */
function sommaireMergePageMapFromOffset(data, pageOffset) {
    if (!data || !data.pages) return;
    var off = pageOffset || 0;
    for (var i = 0; i < data.pages.length; i++) {
        var pn = data.pages[i].page_number;
        if (pn === null || pn === undefined) continue;
        var k = parseInt(String(pn), 10);
        if (isNaN(k)) continue;
        if (REDACTOR_PAGE_MAP_GLOBAL[k]) continue;
        var idx = k + off - 1;
        if (idx >= 0 && idx < doc.pages.length)
            REDACTOR_PAGE_MAP_GLOBAL[k] = doc.pages[idx];
    }
}

function sommaireResolveTargetPage(editorialPageNum, data, pageOffset) {
    var k = parseInt(String(editorialPageNum), 10);
    if (isNaN(k)) return null;
    sommaireMergePageMapFromOffset(data, pageOffset);
    try {
        var pg = REDACTOR_PAGE_MAP_GLOBAL[k];
        if (pg) return pg;
    } catch (e0) {}
    var off = pageOffset || 0;
    var idx = k + off - 1;
    if (idx >= 0 && idx < doc.pages.length) return doc.pages[idx];
    return null;
}

function sommaireRemoveInternalHyperlinks(tf) {
    if (!tf) return;
    var links = doc.hyperlinks;
    for (var h = links.length - 1; h >= 0; h--) {
        try {
            var hl = links.item(h);
            var src = hl.source;
            if (!src) continue;
            var st = null;
            try { st = src.sourceText; } catch (eNoSt) {}
            if (!st) continue;
            var pfs = st.parentTextFrames;
            if (pfs && pfs.length > 0 && pfs[0] === tf) hl.remove();
        } catch (eH) {}
    }
}

function sommaireGetOrCreatePageDestination(targetPage) {
    if (!targetPage) return null;
    var uid = "RD_pg_";
    try { uid += String(targetPage.id); } catch (eId) { uid += "0"; }
    try {
        var d0 = doc.hyperlinkPageDestinations.itemByName(uid);
        if (d0.isValid) return d0;
    } catch (eIt) {}
    try {
        return doc.hyperlinkPageDestinations.add(targetPage, { name: uid });
    } catch (e1) {
        try { return doc.hyperlinkPageDestinations.add(targetPage); } catch (e2) {}
    }
    return null;
}

function sommaireAddTextToPageHyperlink(textRange, targetPage) {
    if (!textRange || !targetPage) return;
    var dest = sommaireGetOrCreatePageDestination(targetPage);
    if (!dest) return;
    var src;
    try { src = doc.hyperlinkTextSources.add(textRange); } catch (eS) { return; }
    try {
        doc.hyperlinks.add(src, dest, {
            visible: false,
            highlight: HyperlinkAppearanceHighlight.NONE
        });
    } catch (eHl) {}
}

function sommaireWireDualFrameNumbers(tfNums, slice, data, pageOffset) {
    if (!tfNums || !slice || slice.length === 0) return;
    sommaireRemoveInternalHyperlinks(tfNums);
    var numLines = [];
    var styleLevels = [];
    for (var s0 = 0; s0 < slice.length; s0++) {
        var lv0 = parseInt(slice[s0].level, 10);
        styleLevels.push(isNaN(lv0) ? 2 : lv0);
        numLines.push("");
    }
    for (var j = 0; j < slice.length; j++) {
        var entry = slice[j];
        var pg = entry.page;
        var lv = parseInt(entry.level, 10);
        if (isNaN(lv)) lv = 2;
        if (pg === null || pg === undefined || String(pg).replace(/^\s+|\s+$/g, "") === "" || lv === 0)
            continue;
        var target = sommaireResolveTargetPage(pg, data, pageOffset);
        if (!target) continue;
        if (j >= tfNums.paragraphs.length) break;
        var para = tfNums.paragraphs[j];
        var display = String(target.name).replace(/^\s+|\s+$/g, "");
        try { para.contents = display; } catch (eC) { continue; }
        numLines[j] = display;
        try {
            para = tfNums.paragraphs[j];
            if (para.characters.length === 0) continue;
            var st = para.characters.item(0).index;
            var en = para.characters.item(para.characters.length - 1).index;
            var story = tfNums.parentStory;
            var tr = story.characters.itemByRange(st, en);
            sommaireAddTextToPageHyperlink(tr, target);
        } catch (eR) {}
    }
    sommaireApplyNumerosStyles(tfNums, numLines, styleLevels);
    sommaireApplyDualNumerosWrapSpacing(tfNums, sommaireWrapFlagsFromSlice(slice));
}

function sommaireWireSingleFrameNumbers(tfTitle, slice, data, pageOffset) {
    if (!tfTitle || !slice || slice.length === 0) return;
    sommaireRemoveInternalHyperlinks(tfTitle);
    var paras = tfTitle.paragraphs;
    for (var j = 0; j < slice.length && j < paras.length; j++) {
        var entry2 = slice[j];
        var pg2 = entry2.page;
        var lv2 = parseInt(entry2.level, 10);
        if (isNaN(lv2)) lv2 = 2;
        if (pg2 === null || pg2 === undefined || String(pg2).replace(/^\s+|\s+$/g, "") === "" || lv2 === 0)
            continue;
        var target2 = sommaireResolveTargetPage(pg2, data, pageOffset);
        if (!target2) continue;
        var para2 = paras[j];
        var line = String(para2.contents || "");
        var display2 = String(target2.name).replace(/^\s+|\s+$/g, "");
        var idxTab = line.lastIndexOf("\t");
        if (idxTab < 0) continue;
        var newLine = line.substring(0, idxTab + 1) + display2;
        try { para2.contents = newLine; } catch (eL) { continue; }
        para2 = tfTitle.paragraphs[j];
        var lineTrim = String(para2.contents || "").replace(/\r$/, "");
        var numStart = idxTab + 1;
        if (numStart >= lineTrim.length) continue;
        try {
            var c0 = para2.characters.item(numStart);
            var c1 = para2.characters.item(lineTrim.length - 1);
            var story2 = tfTitle.parentStory;
            var tr2 = story2.characters.itemByRange(c0.index, c1.index);
            sommaireAddTextToPageHyperlink(tr2, target2);
        } catch (eT) {}
    }
}

/**
 * Hyperliens page interne sur les numeros du sommaire + libelle = Page.name (pagination active).
 * @param pageOffset meme convention que update-text-links-from-json (0 en generation standard).
 * @param titleLabel libelle du cadre titres (ex. mapping SOMMAIRE_texte_1).
 */
function sommaireWirePageNumberHyperlinksOnPage(idPage, pageData, spreadPart, data, pageOffset, titleLabel) {
    if (!idPage || !pageData || !data) return;
    var tc = pageData.content && pageData.content.text;
    if (!tc) return;
    var rawValue = tc["SOMMAIRE_texte_1"];
    if (!rawValue || String(rawValue).replace(/^\s+|\s+$/g, "") === "") return;

    var labelTitres = titleLabel || "SOMMAIRE_texte_1";
    if (data.mappings && data.mappings.fields && data.mappings.fields["SOMMAIRE_texte_1"])
        labelTitres = data.mappings.fields["SOMMAIRE_texte_1"];

    var tfTitle = sommaireGetTextFrame(idPage, labelTitres);
    if (!tfTitle) return;
    var tfNums = sommaireGetTextFrame(idPage, SOMMAIRE_NUMEROS_LABEL);
    var dualMode = tfNums !== null;

    var rawStr = String(rawValue).replace(/^\uFEFF/g, "").replace(/^\s+|\s+$/g, "");
    if (rawStr.charAt(0) !== "{") return;
    var parsed;
    try { parsed = JSON.parse(rawStr); } catch (eP) { return; }
    if (parsed.schema_version !== 1 || (!parsed.entries && !parsed.entries_by_sommaire_page)) return;
    var sl = sommaireBuildSliceForPart(parsed, spreadPart);
    var slice = sl.slice;
    if (slice.length === 0) return;

    sommaireMergePageMapFromOffset(data, pageOffset);

    if (dualMode) sommaireWireDualFrameNumbers(tfNums, slice, data, pageOffset);
    else sommaireWireSingleFrameNumbers(tfTitle, slice, data, pageOffset);
    try {
        if (dualMode && tfNums) truncateOverflow(tfNums);
        truncateOverflow(tfTitle);
    } catch (eTr0) {}
}

function sommaireWireAllSommairePagesForGenerate(data) {
    if (!data || !data.pages) return;
    var somIdx = 0;
    for (var i = 0; i < data.pages.length; i++) {
        if (data.pages[i].template !== "SOMMAIRE") continue;
        somIdx++;
        var idP = DOC_PAGE_BY_JSON_INDEX[i];
        if (!idP) continue;
        try {
            sommaireWirePageNumberHyperlinksOnPage(idP, data.pages[i], somIdx, data, 0, "SOMMAIRE_texte_1");
        } catch (eW) {}
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
REDACTOR_PAGE_MAP_GLOBAL = {};
DOC_PAGE_BY_JSON_INDEX = [];
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
        docRegisterJsonPage(i, pageData, coverPage);
        pagesGenerated++;
        continue;
    }

    // -- PRESENTATION_GUIDE ---------------------------------------------------
    if (pageData.template === "PRESENTATION_GUIDE") {
        var msPresGuide = loadGabarit("PRESENTATION_GUIDE", false);
        if (!msPresGuide) continue;

        var presPage = addPageWithMaster(msPresGuide, "PRESENTATION_GUIDE");
        injectPageContent(presPage, pageData);
        docRegisterJsonPage(i, pageData, presPage);
        pagesGenerated++;
        continue;
    }

    // -- SOMMAIRE -------------------------------------------------------------
    // Deux pages SOMMAIRE consecutives dans le JSON : la 1re recoit sommaire_page 1,
    // la 2e recoit sommaire_page 2 (contenu filtre depuis le meme JSON structuré).
    if (pageData.template === "SOMMAIRE") {
        var msSommaire = loadGabarit("SOMMAIRE", false);
        if (!msSommaire) continue;

        SOMMAIRE_SPREAD_INDEX++;
        var sommairePage = addPageWithMaster(msSommaire, "SOMMAIRE");
        injectPageContent(sommairePage, pageData);
        injectSommaireText(sommairePage, pageData, SOMMAIRE_SPREAD_INDEX);
        sommaireFinalizeTitreAppearance(sommairePage, pageData);
        docRegisterJsonPage(i, pageData, sommairePage);
        pagesGenerated++;
        continue;
    }

    // -- CLUSTER --------------------------------------------------------------
    if (pageData.template === "CLUSTER") {
        var msCluster = loadGabarit("CLUSTER", false);
        if (!msCluster) continue;

        var clusterPage = addPageWithMaster(msCluster, "CLUSTER");
        injectPageContent(clusterPage, pageData);
        docRegisterJsonPage(i, pageData, clusterPage);
        pagesGenerated++;
        continue;
    }

    // -- CARTE / CARTE_DESTINATION --------------------------------------------
    if (pageData.template === "CARTE" || pageData.template === "CARTE_DESTINATION") {
        var msCarteDest = loadGabarit("CARTE", false);
        if (!msCarteDest) continue;

        var carteDestPage = addPageWithMaster(msCarteDest, "CARTE");
        injectPageContent(carteDestPage, pageData);
        docRegisterJsonPage(i, pageData, carteDestPage);
        pagesGenerated++;
        continue;
    }

    // -- PRESENTATION_DESTINATION ---------------------------------------------
    if (pageData.template === "PRESENTATION_DESTINATION") {
        var msPresDest = loadGabarit("PRESENTATION_DESTINATION", false);
        if (!msPresDest) continue;

        var presDestPage = addPageWithMaster(msPresDest, "PRESENTATION_DESTINATION");
        injectPageContent(presDestPage, pageData);
        docRegisterJsonPage(i, pageData, presDestPage);
        pagesGenerated++;
        continue;
    }

    // -- INSPIRATION ----------------------------------------------------------
    if (pageData.template === "INSPIRATION") {
        var msInspi = loadInspirationGabarit(pageData);
        if (!msInspi) continue;

        var inspiPage = addPageWithMaster(msInspi, "INSPIRATION");
        injectPageContent(inspiPage, pageData);
        docRegisterJsonPage(i, pageData, inspiPage);
        pagesGenerated++;
        continue;
    }

    // -- SAISON ---------------------------------------------------------------
    if (pageData.template === "SAISON") {
        var msSaison = loadGabarit("SAISON", false);
        if (!msSaison) continue;

        var saisonPage = addPageWithMaster(msSaison, "SAISON");
        injectPageContent(saisonPage, pageData);
        docRegisterJsonPage(i, pageData, saisonPage);
        pagesGenerated++;
        continue;
    }

    if (pageData.template === "ALLER_PLUS_LOIN") {
        var msAllerPlusLoin = loadGabarit("ALLER_PLUS_LOIN", false);
        if (!msAllerPlusLoin) continue;

        var allerPlusLoinPage = addPageWithMaster(msAllerPlusLoin, "ALLER_PLUS_LOIN");
        injectPageContent(allerPlusLoinPage, pageData);
        docRegisterJsonPage(i, pageData, allerPlusLoinPage);
        pagesGenerated++;
        continue;
    }

    // -- A_PROPOS_RL ----------------------------------------------------------
    if (pageData.template === "A_PROPOS_RL") {
        var msAProposRL = loadGabarit("A_PROPOS_RL", false);
        if (!msAProposRL) continue;

        var aProposRLPage = addPageWithMaster(msAProposRL, "A_PROPOS_RL");
        injectPageContent(aProposRLPage, pageData);
        docRegisterJsonPage(i, pageData, aProposRLPage);
        pagesGenerated++;
        continue;
    }

    // -- SECTION ---------------------------------------------------------------
    if (pageData.template === "SECTION") {
        var msSection = loadGabarit("SECTION", false);
        if (!msSection) continue;

        var sectionPage = addPageWithMaster(msSection, "SECTION");
        injectPageContent(sectionPage, pageData);
        docRegisterJsonPage(i, pageData, sectionPage);
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

    docRegisterJsonPage(i, pageData, newPage);

    pagesGenerated++;
}

try {
    sommaireWireAllSommairePagesForGenerate(data);
} catch (eSomHl) {}

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

if (imagePlacementWarnings.length > 0) {
    finalMsg += "\n\n[!] " + imagePlacementWarnings.length + " image(s) non placée(s)";
    // Ecrire un rapport dédié pour diagnostic précis
    try {
        var imgReport = new File(rootFolder + "/image-placement-report.txt");
        imgReport.encoding = "UTF-8";
        imgReport.open("w");
        imgReport.writeln("IMAGES NON PLACEES");
        imgReport.writeln("----------------------------------------------------");
        for (var iw = 0; iw < imagePlacementWarnings.length; iw++) {
            var w = imagePlacementWarnings[iw];
            imgReport.writeln("p." + w.page
                + "  [" + w.label + "]"
                + (w.titre ? ("  " + w.titre) : ""));
            if (w.local) imgReport.writeln("  local: " + w.local);
            if (w.url)   imgReport.writeln("  url  : " + w.url);
            imgReport.writeln("");
        }
        imgReport.close();
        finalMsg += " -> voir image-placement-report.txt";
    } catch(e) {
        finalMsg += " (impossible d ecrire image-placement-report.txt)";
    }
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
