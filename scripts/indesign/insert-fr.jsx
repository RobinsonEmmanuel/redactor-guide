/**
 * insert-fr.jsx
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
var DEBUG_SOMMAIRE    = false;
// Debug structure sommaire vers fichier texte dedie (pages sommaire uniquement).
var DEBUG_SOMMAIRE_FILE = true;
// Mode diagnostic : affiche uniquement les numeros bruts du sommaire, sans liens.
var SOMMAIRE_NUMBERS_ONLY_NO_LINKS = false;
// Reprise a zero: injection simple JSON -> SOMMAIRE_numeros_1 avec saut de paragraphe.
var SOMMAIRE_NUMBERS_STRICT_SIMPLE = true;
// Log cible: afficher uniquement les 2 premieres lignes injectees dans SOMMAIRE_numeros_1.
var DEBUG_SOMMAIRE_FIRST_TWO_LINES = false;
// Log amont garanti: verifier que le bloc numeros est bien trouve et que l'injection passe ici.
var DEBUG_SOMMAIRE_ENTRY_PROBE = false;
var SOMMAIRE_DEBUG_LOGS = [];

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
var PICTO_GAP          = 20;    // mm - espace entre pictos
var DURATION_GAP       = 3;     // mm - espace entre dernier picto et clock/duree

// Champs rendus en liste a puces : construits dynamiquement depuis data.bullet_fields
// (tous les champs de type 'liste' dans les templates exportes).
// Fallback statique conserve pour compatibilite avec d'anciens exports JSON.
var BULLET_LIST_FIELDS_FALLBACK = {
    "POI_texte_2": true,
    "PRESENTATION_GUIDE_liste_sections": true,
    // Page PRESENTATION_DESTINATION : textes multilignes stylés comme listes
    // dans InDesign, même si certains exports ne les déclarent pas `type: liste`.
    "PRESENTATION_DESTINATION_texte_2": true,
    "PRESENTATION_DESTINATION_texte_3": true,
    "PRESENTATION_DESTINATION_texte_4": true,
    "PRESENTATION_DESTINATION_liste_1": true,
    "PRESENTATION_DESTINATION_liste_2": true,
    "PRESENTATION_DESTINATION_liste_3": true
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
// Cle = nom du champ JSON, valeur = true ou label cible.
var FRAME_LINK_FIELDS  = {
    // Le label visible reste injecte dans POI_lien_1 (TextFrame).
    // La zone graphique POI_lien_1_zone (ou alias « lien 1 », ou groupe parent) rend toute la pastille cliquable.
    "POI_lien_1":                "POI_lien_1_zone",
    "POI_lien_2":                true,
    // Idem pour CLUSTER_lien_1 : cherche CLUSTER_lien_1_zone, sinon groupe parent du TextFrame.
    "CLUSTER_lien_1":            "CLUSTER_lien_1_zone",
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

var data = null;
try {
    data = JSON.parse(String(raw || "").replace(/^\uFEFF/g, ""));
} catch (eJson) {
    // Fallback legacy ExtendScript: certains exports peuvent contenir un JSON "presque valide".
    try {
        data = eval("(" + String(raw || "") + ")");
    } catch (eEval) {
        alert(
            "JSON invalide : impossible de lire le fichier.\n\n"
            + "Erreur JSON.parse : " + eJson + "\n"
            + "Erreur fallback : " + eEval + "\n\n"
            + "Verifie le JSON exporte (virgule en trop, guillemets, encodage UTF-8)."
        );
        exit();
    }
}

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

function findByLabelOrOverrideMaster(page, label) {
    var res = findByLabelOnPage(page, label);
    if (res.length > 0) return res;

    try {
        var master = page.appliedMaster;
        if (!master || !master.isValid) return res;

        var masterItems = [];
        try {
            for (var ai = 0; ai < master.allPageItems.length; ai++) {
                masterItems.push(master.allPageItems[ai]);
            }
        } catch (eAllMasterItems) {}
        if (masterItems.length === 0) {
            try {
                for (var mp = 0; mp < master.pages.length; mp++) {
                    var masterPageItems = master.pages[mp].allPageItems;
                    for (var mpi = 0; mpi < masterPageItems.length; mpi++) {
                        masterItems.push(masterPageItems[mpi]);
                    }
                }
            } catch (eMasterPages) {}
        }

        for (var m = 0; m < masterItems.length; m++) {
            try {
                var masterItem = masterItems[m];
                if (String(masterItem.label || "") !== label) continue;
                var overridden = masterItem.override(page);
                try { overridden.label = label; } catch (eLabel) {}
                res.push(overridden);
            } catch (eOverride) {}
        }
    } catch (eMaster) {}

    return res;
}

// Alias acceptes pour la zone cliquable POI_lien_1 (bulle + picto lien).
var POI_LIEN_1_ZONE_ALIASES = ["lien 1", "lien_1", "lien1", "POI lien 1"];

function findParentGroup(item) {
    try {
        var p = item.parent;
        for (var d = 0; d < 10 && p; d++) {
            try {
                if (p.constructor && String(p.constructor.name) === "Group") return p;
            } catch (eG) {}
            try { p = p.parent; } catch (eP) { break; }
        }
    } catch (e) {}
    return null;
}

function findGroupContainingTextLabel(page, textLabel) {
    var out = [];
    var tfs = findByLabelOrOverrideMaster(page, textLabel);
    for (var i = 0; i < tfs.length; i++) {
        var g = findParentGroup(tfs[i]);
        if (!g) continue;
        var dup = false;
        for (var j = 0; j < out.length; j++) {
            if (out[j] === g) { dup = true; break; }
        }
        if (!dup) out.push(g);
    }
    return out;
}

/** Zone cliquable POI_lien_1 : label zone, alias (ex. « lien 1 »), ou groupe parent du TextFrame. */
function findPoiLien1ClickableBlocks(page, zoneLabel, textLabel) {
    var blocks = findByLabelOrOverrideMaster(page, zoneLabel);
    if (blocks.length > 0) return blocks;
    for (var a = 0; a < POI_LIEN_1_ZONE_ALIASES.length; a++) {
        blocks = findByLabelOrOverrideMaster(page, POI_LIEN_1_ZONE_ALIASES[a]);
        if (blocks.length > 0) return blocks;
    }
    return findGroupContainingTextLabel(page, textLabel);
}

function findFrameLinkBlocks(page, label, frameLinkOpts) {
    if (frameLinkOpts && frameLinkOpts.poiLien1 === true) {
        return findPoiLien1ClickableBlocks(page, label, frameLinkOpts.textLinkLabel || label);
    }
    var blocks = findByLabelOrOverrideMaster(page, label);
    if (blocks.length > 0) return blocks;
    if (frameLinkOpts && frameLinkOpts.aliases) {
        for (var a = 0; a < frameLinkOpts.aliases.length; a++) {
            blocks = findByLabelOrOverrideMaster(page, frameLinkOpts.aliases[a]);
            if (blocks.length > 0) return blocks;
        }
    }
    if (frameLinkOpts && frameLinkOpts.textLinkLabel) {
        blocks = findGroupContainingTextLabel(page, frameLinkOpts.textLinkLabel);
    }
    return blocks;
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
// GREP limite a tf.texts.item(0) pour ne pas melanger les ** avec un fil filete ;
// styles appliques via indices story absolus (du dernier au premier match).

function grepScopeForTextFrame(tf) {
    // parentStory couvre TOUS les paragraphes du cadre, y compris ceux crees par
    // un \n JSON qui devient un saut de paragraphe InDesign (\r).
    // tf.texts.item(0) ne couvrait que le premier paragraphe, laissant les suivants
    // sans traitement GREP (styles non appliques, marqueurs non supprimes).
    return tf.parentStory;
}

function findGrepOnScope(scope, findWhat) {
    app.findGrepPreferences   = NothingEnum.NOTHING;
    app.changeGrepPreferences = NothingEnum.NOTHING;
    app.findGrepPreferences.findWhat = findWhat;
    var arr;
    try {
        arr = scope.findGrep();
    } catch (eFG) {
        arr = [];
    }
    app.findGrepPreferences = NothingEnum.NOTHING;
    return arr;
}

function applyInnerStyledMatches(scope, story, findWhat, charStyle, headSkip, tailSkip) {
    if (!charStyle || !charStyle.isValid) return;
    var matches = findGrepOnScope(scope, findWhat);
    var i, r, nChars, stIdx, enIdx;
    for (i = matches.length - 1; i >= 0; i--) {
        try {
            r = matches[i];
            nChars = r.characters.length;
            if (nChars <= headSkip + tailSkip) continue;
            stIdx = r.characters.item(headSkip).index;
            enIdx = r.characters.item(nChars - tailSkip - 1).index;
            if (enIdx < stIdx) continue;
            story.characters.itemByRange(stIdx, enIdx).appliedCharacterStyle = charStyle;
        } catch (eA) {}
    }
}

function changeGrepOnScope(scope, story, findWhat, changeTo) {
    app.findGrepPreferences   = NothingEnum.NOTHING;
    app.changeGrepPreferences = NothingEnum.NOTHING;
    app.findGrepPreferences.findWhat   = findWhat;
    app.changeGrepPreferences.changeTo = changeTo;
    try {
        scope.changeGrep();
    } catch (eC) {
        try { story.changeGrep(); } catch (e2) {}
    }
    app.findGrepPreferences   = NothingEnum.NOTHING;
    app.changeGrepPreferences = NothingEnum.NOTHING;
}

function applyStyleMarkers(tf) {
    try {
        var story = tf.parentStory;
        var scope = grepScopeForTextFrame(tf);

        var boldStyle       = doc.characterStyles.itemByName(BOLD_STYLE_NAME);
        var orangeStyle     = doc.characterStyles.itemByName(ORANGE_STYLE_NAME);
        var chiffreStyle    = doc.characterStyles.itemByName(CHIFFRE_STYLE_NAME);
        var grasOrangeStyle = doc.characterStyles.itemByName(GRAS_ORANGE_STYLE_NAME);

        // Pass 0 : combinaison {**texte**} → Gras-orange atomique.
        // DOIT preceder les passes bold/orange separees pour eviter que l'une ecrase l'autre.
        applyInnerStyledMatches(scope, story, "(?s)\\{\\*\\*[^*}]+?\\*\\*\\}", grasOrangeStyle, 3, 3);
        changeGrepOnScope(scope, story, "\\{\\*\\*|\\*\\*\\}", "");

        applyInnerStyledMatches(scope, story, "(?s)\\*\\*[^*]+?\\*\\*", boldStyle, 2, 2);
        changeGrepOnScope(scope, story, "\\*\\*", "");

        applyInnerStyledMatches(scope, story, "(?s)\\{[^}]+?\\}", orangeStyle, 1, 1);
        changeGrepOnScope(scope, story, "\\{", "");   // supprime { orphelins
        changeGrepOnScope(scope, story, "\\}", "");   // supprime } orphelins

        applyInnerStyledMatches(scope, story, "(?s)\\^[^\\^]+?\\^", chiffreStyle, 1, 1);
        changeGrepOnScope(scope, story, "\\^", "");

        applyInnerStyledMatches(scope, story, "(?s)\\x7E[^\\x7E]+?\\x7E", grasOrangeStyle, 1, 1);
        changeGrepOnScope(scope, story, "~", "");

    } catch(e) {
        // Ne pas bloquer le reste du script si l'application de styles echoue
    }
}

/**
 * Normalise les marqueurs avant injection InDesign :
 * 1. {**texte**} → ~texte~  (Gras-orange via le pass tilde, évite les GREP imbriqués)
 * 2. \n → \r               (saut de paragraphe InDesign, couvre tous les paragraphes)
 */
function normalizeMarkersForIndesign(s) {
    if (!s) return s;
    // {**texte**} → ~texte~ : slice(2, len-2) retire les ** sans regex
    // (ancres ^ et $ avec /g instables dans ExtendScript).
    // Note : on ne convertit PAS \n en \r — le \n produit un retour force
    // InDesign (meme paragraphe = meme style), alors que \r creerait un
    // nouveau paragraphe avec un style potentiellement different (gras parasite).
    s = s.replace(/\{(\*\*[^*}]+?\*\*)\}/g, function(all, inner) {
        return "~" + inner.slice(2, inner.length - 2) + "~";
    });
    return s;
}

// --- 5. Injecter texte avec styles optionnels --------------------------------
function setTextWithStyles(textFrame, rawText) {
    var normalized = normalizeMarkersForIndesign(rawText);
    textFrame.contents = normalized;  // definir avec les marqueurs en place
    applyStyleMarkers(textFrame);     // GREP trouve, applique styles, supprime marqueurs
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
            var texteComplet = "";
            try { texteComplet = String(story.contents); } catch(eCap) {}
            overflowWarnings.push({
                page:         currentPageNum,
                titre:        currentPageTitre,
                label:        tf.label || "(sans label)",
                texteComplet: texteComplet,
                visibleChars: visCount,
                totalChars:   total
            });
            story.characters.itemByRange(visCount, total - 1).remove();
        }
    } catch(e) {}
}

// Repare les ** mal places (traduction LLM) — aligne apps/api/src/utils/repair-style-markers.ts
function repairBoldMarkersInJsonContent(s) {
    if (!s || s.indexOf("**") === -1) return s;
    function innerStartsVowel(inner) {
        if (!inner || inner.length < 3) return false;
        var c = inner.charAt(0);
        return /[aeiouyAEIOUY\u00E0-\u00FC\u00F2-\u00F6\u00E8-\u00EB\u00EC-\u00EF\u00F9-\u00FC\u00E6\u0153]/i.test(c);
    }
    var out = s;
    var iter, prev;
    for (iter = 0; iter < 12; iter++) {
        prev = out;
        out = out.replace(/\*\*([^*]+?)\s+a\*\*(nd)\b/gi, "**$1** and");
        out = out.replace(/(^|[\s\n\r"'"\u00AB\u00BB().,;:!?\-])([a-z\u00E0-\u00FF])\*\*([^*\r\n]+?)\*\*/gim,
            function(all, sep, letter, inner) {
                if (!innerStartsVowel(inner)) return all;
                return sep + "**" + letter + inner + "**";
            });
        if (out === prev) break;
    }
    return out;
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
                linkLabel = repairBoldMarkersInJsonContent(linkLabel);
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
                var strValue = repairBoldMarkersInJsonContent(strRaw);
                var sommaireTitreLabel = "SOMMAIRE_titre_1";
                try {
                    if (data && data.mappings && data.mappings.fields && data.mappings.fields["SOMMAIRE_titre_1"]) {
                        sommaireTitreLabel = data.mappings.fields["SOMMAIRE_titre_1"];
                    }
                } catch (eLbl) {}
                var skipMarkersForSommaireTitre = (label === "SOMMAIRE_titre_1" || label === sommaireTitreLabel);
                var hasMarkers = !skipMarkersForSommaireTitre && (
                                 strValue.indexOf("**") !== -1 ||
                                 strValue.indexOf("{")  !== -1 ||
                                 strValue.indexOf("^")  !== -1 ||
                                 strValue.indexOf("~")  !== -1);
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
        var bulletStyle = null;
        try {
            if (tf.paragraphs && tf.paragraphs.length > 0) {
                var ps = tf.paragraphs[0].appliedParagraphStyle;
                if (ps && ps.isValid) bulletStyle = ps;
            }
        } catch (eBulletStyle) {}
        tf.contents = "";

        var rawLines = value.split("\n");
        var items = [];
        for (var l = 0; l < rawLines.length; l++) {
            var line = rawLines[l].replace(/^\s+|\s+$/, "");
            if (line !== "") items.push(line);
        }
        if (items.length === 0) { blocks[i].visible = false; continue; }

        var fullText = repairBoldMarkersInJsonContent(items.join("\r"));
        tf.contents = fullText;
        try {
            if (bulletStyle && bulletStyle.isValid) {
                for (var bp = 0; bp < tf.paragraphs.length; bp++) {
                    try { tf.paragraphs[bp].appliedParagraphStyle = bulletStyle; } catch (eBp) {}
                }
            }
        } catch (eApplyBulletStyle) {}

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
        var strVal = repairBoldMarkersInJsonContent(String(value).replace(/\r\n/g, "\r").replace(/\n/g, "\r"));
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
function injectFrameHyperlink(page, label, value, frameLinkOpts) {
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

    var blocks = findFrameLinkBlocks(page, label, frameLinkOpts);
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
//      Titre sur 2 lignes : detection par lines.length InDesign (+ seuil caracteres en secours) ;
//      espace apres numeros ajuste sur level 1 et 2 pour aligner les blocs suivants.
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
var SOMMAIRE_NUMEROS_LABEL_ALIASES = [
    "SOMMAIRE_numeros_1",
    "SOMMAIRE-numeros-1"
];
/** Noms possibles (InDesign : casse / variante). Le premier qui existe est utilise. */
var SOMMAIRE_NUMEROS_STYLE_CANDIDATES = ["Sommaire-numeros", "sommaire-numeros", "Sommaire_numeros"];
var SOMMAIRE_NUMEROS_VIDE_STYLE_CANDIDATES = ["Sommaire-numeros-absent", "sommaire-numeros-absent", "Sommaire_numeros_absent"];
// Titres de section (sans numero) : alignement sur l'interligne cible 18 pt.
var SOMMAIRE_NUMEROS_ABSENT_SPACE_AFTER_TOP_PT = 18;
var SOMMAIRE_NUMEROS_ABSENT_SPACE_AFTER_DEFAULT_PT = 18;
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
var SOMMAIRE_TITLE_WRAP_CHAR_MAX_SECTION = 31;
var SOMMAIRE_TITLE_WRAP_CHAR_MAX_DEFAULT = 38;
/** Force un titre pagine sur 2 lignes (> seuil) en envoyant le dernier mot ligne 2. */
var SOMMAIRE_FORCE_TWO_LINES_ENABLED = true;
var SOMMAIRE_FORCE_TWO_LINES_CHAR_THRESHOLD = 35;
/** Titre de section (level 0) : interligne force pour eviter un style maquette a 40 pt. */
var SOMMAIRE_SECTION_TITLE_LEADING_PT = 18;
/** Espace avant un titre de section suivant (level 0), pour retrouver le rythme visuel. */
var SOMMAIRE_SECTION_TITLE_SPACE_BEFORE_PT = 22;
/** Interligne force sur les entrees page-section (level 1). */
var SOMMAIRE_PAGE_SECTION_LEADING_PT = 18;
/** Interligne force sur les entrees page-unique (level 2). */
var SOMMAIRE_PAGE_UNIQUE_LEADING_PT = 45;
/** Colonne numeros : espace apres du numero si titre sur 1 ligne. */
var SOMMAIRE_NUMEROS_SPACE_AFTER_ONE_LINE_PT = 17;
/** Colonne numeros : espace apres du numero si titre sur 2 lignes. */
var SOMMAIRE_NUMEROS_SPACE_AFTER_TWO_LINES_PT = 36;
var SOMMAIRE_ENABLE_WRAP_SPACING = true;

/** @param {string} entryTitle titre JSON brut (sans tabulation niveau 1). */
function sommaireTitleWrapsTwoLinesByCharCount(entryTitle, maxChars) {
    return String(entryTitle || "").length > maxChars;
}

function sommaireIsNumerosColumnOne(tfNums) {
    if (!tfNums) return false;
    try {
        var lbl = String(tfNums.label || "").replace(/^\s+|\s+$/g, "");
        if (lbl === "SOMMAIRE_numeros_1" || lbl === "SOMMAIRE-numeros-1") return true;
    } catch (eLbl) {}
    return false;
}

function sommaireEntryWrapCharMax(entry, titleText) {
    var lv = entry && entry.level !== undefined && entry.level !== null ? parseInt(entry.level, 10) : NaN;
    if (!isNaN(lv) && lv === 1) return SOMMAIRE_TITLE_WRAP_CHAR_MAX_SECTION;
    // Fallback legacy: ligne avec tab = sous-entree type page-section.
    var t = String(titleText || "");
    if (t.charAt(0) === "\t") return SOMMAIRE_TITLE_WRAP_CHAR_MAX_SECTION;
    return SOMMAIRE_TITLE_WRAP_CHAR_MAX_DEFAULT;
}

function sommaireEntryNeedsNumerosExtraSpacing(entry, titleText, hasNumber) {
    if (!hasNumber) return false;
    var maxChars = sommaireEntryWrapCharMax(entry, titleText);
    return sommaireTitleWrapsTwoLinesByCharCount(titleText, maxChars);
}

function sommaireForceLastWordLineBreak(titleText) {
    var txt = String(titleText || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    if (txt === "") return txt;
    if (txt.indexOf("\n") >= 0 || txt.indexOf("\r") >= 0) return txt;
    var lastSpace = txt.lastIndexOf(" ");
    if (lastSpace <= 0 || lastSpace >= txt.length - 1) return txt;
    var first = txt.substring(0, lastSpace).replace(/\s+$/g, "");
    var last = txt.substring(lastSpace + 1).replace(/^\s+/g, "");
    if (!first || !last) return txt;
    return first + "\n" + last;
}

function sommaireNormalizeTitleText(titleText) {
    return String(titleText || "")
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^\s+|\s+$/g, "");
}

function sommaireMaybeForceTwoLinesTitle(entry, titleText, hasNumber) {
    var txt = sommaireNormalizeTitleText(titleText);
    if (!SOMMAIRE_FORCE_TWO_LINES_ENABLED || !hasNumber) return txt;
    if (txt.length <= SOMMAIRE_FORCE_TWO_LINES_CHAR_THRESHOLD) return txt;
    return sommaireForceLastWordLineBreak(txt);
}

function sommaireWrapFlagsFromSlice(slice) {
    var flags = [];
    if (!slice) return flags;
    for (var i = 0; i < slice.length; i++) {
        var e = slice[i] || null;
        var pg = sommaireEntryPageValue(e);
        var hasNum = pg !== "";
        flags.push(sommaireEntryNeedsNumerosExtraSpacing(e, e && e.title, hasNum));
    }
    return flags;
}

function sommaireWrapFlagsFromTitleLines(titleLines, numLines) {
    var flags = [];
    if (!titleLines) return flags;
    for (var i = 0; i < titleLines.length; i++) {
        var t = String(titleLines[i] || "");
        var hasNum = numLines && i < numLines.length && String(numLines[i] || "").replace(/^\s+|\s+$/g, "") !== "";
        var clean = t.charAt(0) === "\t" ? t.substring(1) : t;
        flags.push(sommaireEntryNeedsNumerosExtraSpacing(null, clean, hasNum));
    }
    return flags;
}

function sommaireWrapFlagsFromRenderedTitle(tfTitle, expectedCount) {
    var flags = [];
    if (!tfTitle) return flags;
    try {
        var paras = tfTitle.paragraphs;
        var n = paras.length;
        if (expectedCount !== undefined && expectedCount !== null && expectedCount < n) n = expectedCount;
        for (var i = 0; i < n; i++) {
            var wraps = false;
            try {
                wraps = paras[i].lines.length > 1;
            } catch (eL) {}
            flags.push(wraps);
        }
    } catch (eAll) {}
    return flags;
}

/**
 * Fusionne estimation par caracteres et mesure InDesign reelle (lines.length).
 * On retient le OR des deux : si l'un detecte 2 lignes, on compense (evite les faux negatifs).
 */
function sommaireResolveWrapFlags(tfTitle, sliceOrNull, titleLinesOrNull, numLinesOrNull) {
    var charFlags = sliceOrNull
        ? sommaireWrapFlagsFromSlice(sliceOrNull)
        : sommaireWrapFlagsFromTitleLines(titleLinesOrNull, numLinesOrNull);
    var expectedCount = charFlags.length;
    if (!expectedCount && sliceOrNull) expectedCount = sliceOrNull.length;
    if (!expectedCount && titleLinesOrNull) expectedCount = titleLinesOrNull.length;
    var renderedFlags = sommaireWrapFlagsFromRenderedTitle(tfTitle, expectedCount || null);
    if (renderedFlags.length === 0) return charFlags;
    if (charFlags.length === 0) return renderedFlags;
    // Quand on a une mesure 1:1 depuis InDesign, elle prime (evite les faux positifs au seuil).
    if (renderedFlags.length === charFlags.length) return renderedFlags;
    var n = charFlags.length > renderedFlags.length ? charFlags.length : renderedFlags.length;
    var merged = [];
    for (var i = 0; i < n; i++) {
        var byChar = i < charFlags.length && charFlags[i];
        var byRender = i < renderedFlags.length && renderedFlags[i];
        merged.push(byChar || byRender);
    }
    return merged;
}

/** Entree paginee (level 1 page-section ou level 2 page-unique) eligible au wrap numeros. */
function sommaireEntryIsPaginatedContentAt(sliceOrNull, idx) {
    if (!sliceOrNull || idx < 0 || idx >= sliceOrNull.length) return true;
    var e = sliceOrNull[idx];
    if (!e) return false;
    var lv = parseInt(e.level, 10);
    if (isNaN(lv)) lv = 2;
    return lv === 1 || lv === 2;
}

/** Espace avant un titre de section (level 0) : 0 en tete de page, sinon 22 pt (ex. apres pages uniques). */
function sommaireSectionTitleSpaceBeforePt(indexInSlice) {
    return indexInSlice > 0 ? SOMMAIRE_SECTION_TITLE_SPACE_BEFORE_PT : 0;
}

/**
 * Ne pas mettre de spaceBefore "compensation" sur la ligne numeros du titre-section (level 0)
 * ni sur la premiere ligne de contenu qui suit un titre-section (evite le trou sous "Les inspirations").
 * sliceOrNull : entrees JSON ; numLinesOrNull : repli legacy (ligne precedente sans numero).
 */
function sommaireShouldSkipWrapSpaceBeforeTarget(sliceOrNull, numLinesOrNull, targetIdx) {
    if (targetIdx < 0) return true;
    if (sliceOrNull && targetIdx < sliceOrNull.length) {
        var cur = sliceOrNull[targetIdx];
        if (cur) {
            var lvC = parseInt(cur.level, 10);
            if (isNaN(lvC)) lvC = 2;
            if (lvC === 0) return true;
        }
        if (targetIdx > 0) {
            var prev = sliceOrNull[targetIdx - 1];
            if (prev) {
                var lvP = parseInt(prev.level, 10);
                if (isNaN(lvP)) lvP = 2;
                if (lvP === 0) return true;
            }
        }
        return false;
    }
    if (numLinesOrNull && targetIdx > 0) {
        var prevNum = String(numLinesOrNull[targetIdx - 1] || "").replace(/^\s+|\s+$/g, "");
        if (prevNum === "") return true;
    }
    return false;
}

function sommaireEntryHasNumberAt(sliceOrNull, numLinesOrNull, idx) {
    if (idx < 0) return false;
    if (sliceOrNull && idx < sliceOrNull.length) {
        var e = sliceOrNull[idx];
        if (!e) return false;
        var lv = parseInt(e.level, 10);
        if (isNaN(lv)) lv = 2;
        if (lv === 0) return false;
        return sommaireEntryPageValue(e) !== "";
    }
    if (numLinesOrNull && idx < numLinesOrNull.length) {
        return String(numLinesOrNull[idx] || "").replace(/^\s+|\s+$/g, "") !== "";
    }
    return false;
}

function sommaireEntryIsPageSectionAt(sliceOrNull, idx) {
    if (!sliceOrNull || idx < 0 || idx >= sliceOrNull.length) return false;
    var e = sliceOrNull[idx];
    if (!e) return false;
    var lv = parseInt(e.level, 10);
    if (isNaN(lv)) lv = 2;
    return lv === 1;
}

function sommaireIsAutoLeading(leadingVal) {
    var n = Number(leadingVal);
    return !isFinite(n) || n <= 0 || n > 1000;
}

function sommaireLeadingForLevel(level) {
    var lv = parseInt(level, 10);
    if (isNaN(lv)) lv = 2;
    if (lv === 0) return SOMMAIRE_SECTION_TITLE_LEADING_PT;
    if (lv === 1) return SOMMAIRE_PAGE_SECTION_LEADING_PT;
    return SOMMAIRE_PAGE_UNIQUE_LEADING_PT;
}

function sommaireResolveEntryLevel(sliceOrNull, styleLevelsOrNull, numLinesOrNull, idx, titlePara) {
    if (sliceOrNull && idx >= 0 && idx < sliceOrNull.length) {
        var lv = parseInt(sliceOrNull[idx].level, 10);
        if (!isNaN(lv)) return lv;
    }
    if (styleLevelsOrNull && idx >= 0 && idx < styleLevelsOrNull.length) {
        var lv2 = parseInt(styleLevelsOrNull[idx], 10);
        if (!isNaN(lv2)) return lv2;
    }
    var hasNum = sommaireEntryHasNumberAt(sliceOrNull, numLinesOrNull, idx);
    if (!hasNum) return 0;
    try {
        var t0 = String(titlePara && titlePara.contents ? titlePara.contents : "");
        if (t0.charAt(0) === "\t") return 1;
    } catch (eInf) {}
    return 2;
}

function sommaireTitleBlockMetrics(titlePara, level) {
    var lines = 1;
    var sb = 0;
    var sa = 0;
    var ld = sommaireLeadingForLevel(level);
    if (!titlePara) return { lines: lines, spaceBefore: sb, spaceAfter: sa, leading: ld, blockHeight: ld };
    try { lines = titlePara.lines.length; } catch (eLines) {}
    if (lines < 1) lines = 1;
    try { sb = Number(titlePara.spaceBefore || 0); } catch (eSb) {}
    try { sa = Number(titlePara.spaceAfter || 0); } catch (eSa) {}
    try {
        var curLd = Number(titlePara.leading);
        if (!sommaireIsAutoLeading(curLd)) ld = curLd;
    } catch (eLd) {}
    return {
        lines: lines,
        spaceBefore: sb,
        spaceAfter: sa,
        leading: ld,
        blockHeight: sb + (lines * ld) + sa
    };
}

function sommaireExpectedNumerosSpaceAfter(titleMetrics) {
    if (!titleMetrics) return 0;
    var sb = titleMetrics.spaceBefore;
    var ld = titleMetrics.leading;
    var blockH = titleMetrics.blockHeight;
    var expected = blockH - sb - ld;
    return expected < 0 ? 0 : expected;
}

/**
 * Aligne verticalement chaque paragraphe numeros sur la hauteur reelle du titre associe
 * (spaceBefore + lignes * leading + spaceAfter).
 */
function sommaireSyncVerticalAlignment(tfTitle, tfNums, sliceOrNull, styleLevelsOrNull, numLinesOrNull) {
    if (!tfTitle || !tfNums || !sommaireIsNumerosColumnOne(tfNums)) return;
    var titleParas = null;
    var numParas = null;
    try { titleParas = tfTitle.paragraphs; } catch (e0) { return; }
    try { numParas = sommaireNumerosStoryParagraphs(tfNums); } catch (e1) { return; }
    if (!titleParas || !numParas) return;
    var n = titleParas.length;
    if (numParas.length < n) n = numParas.length;

    for (var i = 0; i < n; i++) {
        var tp = titleParas[i];
        var np = numParas[i];
        var lv = sommaireResolveEntryLevel(sliceOrNull, styleLevelsOrNull, numLinesOrNull, i, tp);
        try { tp.leading = sommaireLeadingForLevel(lv); } catch (eTl) {}
        var tm = sommaireTitleBlockMetrics(tp, lv);
        var expectedNumSa = sommaireExpectedNumerosSpaceAfter(tm);
        try { np.spaceBefore = tm.spaceBefore; } catch (eNSb) {}
        try { np.leading = tm.leading; } catch (eNLd) {}
        try { np.spaceAfter = expectedNumSa; } catch (eNSa) {}
    }
}

/** @param {Array|null} sliceOrNull entrees sommaire JSON
 *  @param {Array|null} numLinesOrNull numeros par ligne (legacy si pas de slice) */
function sommaireApplyDualNumerosWrapSpacing(tfTitle, tfNums, wrapFlags, sliceOrNull, numLinesOrNull) {
    if (!tfNums) return;
    var styleLevels = null;
    if (sliceOrNull) {
        styleLevels = [];
        for (var si = 0; si < sliceOrNull.length; si++) {
            var lvS = parseInt(sliceOrNull[si].level, 10);
            if (isNaN(lvS)) lvS = 2;
            styleLevels.push(lvS);
        }
    }
    sommaireSyncVerticalAlignment(tfTitle, tfNums, sliceOrNull, styleLevels, numLinesOrNull);
}

/**
 * Paragraphes de la colonne numeros sur toute la story (cadre + enchainements).
 * Sinon seuls les paragraphes commencant dans le 1er cadre sont exposes — les derniers
 * numeros restent en police par defaut (effet "2 dernieres lignes").
 */
function sommaireNumerosStoryParagraphs(tfNums) {
    if (!tfNums) return null;
    try {
        var story = tfNums.parentStory;
        if (story && story.paragraphs && story.paragraphs.length > 0)
            return story.paragraphs;
    } catch (eS) {}
    try {
        return tfNums.paragraphs;
    } catch (eF) {}
    return null;
}

/** Retire les hyperliens texte dont la source appartient a la meme story que la colonne numeros (y compris cadres files). */
function sommaireRemoveInternalHyperlinksForNumerosStory(tfNums) {
    if (!tfNums) return;
    var story = null;
    try { story = tfNums.parentStory; } catch (e0) { return; }
    if (!story) return;
    var links = doc.hyperlinks;
    for (var h = links.length - 1; h >= 0; h--) {
        try {
            var hl = links.item(h);
            var src = hl.source;
            if (!src) continue;
            var st = null;
            try { st = src.sourceText; } catch (eNoSt) {}
            if (!st) continue;
            try {
                if (st.parentStory === story) hl.remove();
            } catch (ePs) {}
        } catch (eH) {}
    }
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

function sommaireParagraphStartsAtFrameTop(paragraph) {
    if (!paragraph) return false;
    try {
        var pfs = paragraph.parentTextFrames;
        if (!pfs || pfs.length === 0) return false;
        var tf = pfs[0];
        var tfParas = tf.paragraphs;
        if (!tfParas || tfParas.length === 0) return false;
        return tfParas[0] === paragraph;
    } catch (e) {}
    return false;
}

function sommaireApplyAbsentSpacing(paragraph) {
    if (!paragraph) return;
    try {
        paragraph.spaceAfter = sommaireParagraphStartsAtFrameTop(paragraph)
            ? SOMMAIRE_NUMEROS_ABSENT_SPACE_AFTER_TOP_PT
            : SOMMAIRE_NUMEROS_ABSENT_SPACE_AFTER_DEFAULT_PT;
    } catch (e) {}
}
var SOMMAIRE_TITRE_PARAGRAPH_STYLE_NAME = "";
/** Style de caractere sur tout le titre (ex. "Orange"). Vide "" pour desactiver. */
var SOMMAIRE_TITRE_CHARACTER_STYLE_NAME = "";

function sommaireEntrySommairePage(entry) {
    var v = entry.sommaire_page;
    if (v === null || v === undefined) return -1;
    var n = parseInt(v, 10);
    return isNaN(n) ? -1 : n;
}

function sommaireEntryPageValue(entry) {
    if (!entry) return "";
    var candidates = [entry.page, entry.page_number, entry.pageNumber, entry.numero_page];
    for (var i = 0; i < candidates.length; i++) {
        var v = candidates[i];
        if (v === null || v === undefined) continue;
        var s = String(v).replace(/^\s+|\s+$/g, "");
        if (s !== "") return s;
    }
    return "";
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

function sommaireGetTextFrameByAliases(page, labels) {
    if (!labels || !labels.length) return null;
    for (var li = 0; li < labels.length; li++) {
        var tf = sommaireGetTextFrame(page, labels[li]);
        if (tf) return tf;
    }
    return null;
}

function sommaireGetNumerosFrame(page, labels) {
    if (!page || !labels || !labels.length) return null;
    var all = [];
    var seen = {};
    for (var li = 0; li < labels.length; li++) {
        var items = findByLabelOnPage(page, labels[li]) || [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (!(it instanceof TextFrame)) continue;
            var id = null;
            try { id = String(it.id); } catch (eId) { id = "x_" + li + "_" + i; }
            if (seen[id]) continue;
            seen[id] = true;
            all.push(it);
        }
    }
    if (all.length === 0) return null;
    var best = all[0];
    var bestX = -999999;
    for (var k = 0; k < all.length; k++) {
        var x1 = -999999;
        try { x1 = Number(all[k].geometricBounds[1]); } catch (eGb) {}
        if (x1 > bestX) {
            bestX = x1;
            best = all[k];
        }
    }
    if (DEBUG_SOMMAIRE) {
        var dbg = "Candidats cadre numeros: " + all.length + "\n";
        for (var d = 0; d < all.length; d++) {
            try {
                var gb = all[d].geometricBounds;
                dbg += "- id=" + all[d].id + " label=" + String(all[d].label || "")
                    + " x1=" + gb[1] + " y1=" + gb[0] + "\n";
            } catch (eDbg) {}
        }
        try {
            dbg += "Choisi id=" + best.id + " label=" + String(best.label || "");
        } catch (eDbg2) {}
        sommaireDebugAlert(dbg);
    }
    return best;
}

function sommaireBuildNumerosLabelCandidates() {
    var out = [];
    var seen = {};
    function addLabel(v) {
        var s = String(v || "").replace(/^\s+|\s+$/g, "");
        if (!s || seen[s]) return;
        seen[s] = true;
        out.push(s);
    }
    try {
        if (data && data.mappings && data.mappings.fields) {
            addLabel(data.mappings.fields["SOMMAIRE_numeros_1"]);
        }
    } catch (eMap) {}
    addLabel(SOMMAIRE_NUMEROS_LABEL);
    for (var i = 0; i < SOMMAIRE_NUMEROS_LABEL_ALIASES.length; i++) {
        addLabel(SOMMAIRE_NUMEROS_LABEL_ALIASES[i]);
    }
    return out;
}

function sommaireDebugAlert(msg) {
    if (!DEBUG_SOMMAIRE) return;
    try { alert("[DEBUG SOMMAIRE]\n" + String(msg || "")); } catch (eDbg) {}
}

function sommaireSafeStr(v) {
    return String(v === undefined || v === null ? "" : v).replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

function sommaireCollectDebugForPage(page, part, slice, tfTitle, tfNums, dualMode) {
    if (!DEBUG_SOMMAIRE_FILE) return;
    try {
        var lines = [];
        lines.push("=== PAGE SOMMAIRE p." + String(page && page.name ? page.name : "?") + " | part=" + String(part) + " | dualMode=" + (dualMode ? "true" : "false") + " ===");
        lines.push("entries=" + (slice ? slice.length : 0));
        var titleParas = null;
        var numParas = null;
        try { titleParas = tfTitle ? tfTitle.paragraphs : null; } catch (eTp) {}
        try { numParas = tfNums ? sommaireNumerosStoryParagraphs(tfNums) : null; } catch (eNp) {}
        var n = 0;
        if (slice && slice.length > n) n = slice.length;
        try { if (titleParas && titleParas.length > n) n = titleParas.length; } catch (eTl) {}
        try { if (numParas && numParas.length > n) n = numParas.length; } catch (eNl) {}

        for (var i = 0; i < n; i++) {
            var e = (slice && i < slice.length) ? slice[i] : null;
            var lv = e ? parseInt(e.level, 10) : NaN;
            if (isNaN(lv)) lv = -1;
            var title = e ? sommaireSafeStr(e.title) : "";
            var pageNum = e ? sommaireEntryPageValue(e) : "";

            var tp = (titleParas && i < titleParas.length) ? titleParas[i] : null;
            var np = (numParas && i < numParas.length) ? numParas[i] : null;

            var tpTxt = "", tpLines = -1, tpSb = 0, tpSa = 0, tpLd = 0;
            var npTxt = "", npLines = -1, npSb = 0, npSa = 0, npLd = 0;
            try { if (tp) tpTxt = sommaireSafeStr(tp.contents).replace(/\\r$/g, ""); } catch (eT0) {}
            try { if (tp) tpLines = tp.lines.length; } catch (eT1) {}
            try { if (tp) tpSb = Number(tp.spaceBefore || 0); } catch (eT2) {}
            try { if (tp) tpSa = Number(tp.spaceAfter || 0); } catch (eT3) {}
            try { if (tp) tpLd = Number(tp.leading || 0); } catch (eT4) {}

            try { if (np) npTxt = sommaireSafeStr(np.contents).replace(/\\r$/g, ""); } catch (eN0) {}
            try { if (np) npLines = np.lines.length; } catch (eN1) {}
            try { if (np) npSb = Number(np.spaceBefore || 0); } catch (eN2) {}
            try { if (np) npSa = Number(np.spaceAfter || 0); } catch (eN3) {}
            try { if (np) npLd = Number(np.leading || 0); } catch (eN4) {}

            var effLd = sommaireIsAutoLeading(tpLd) ? sommaireLeadingForLevel(lv) : tpLd;
            var titleBlockH = tpSb + ((tpLines > 0 ? tpLines : 1) * effLd) + tpSa;
            var expectedNumSa = titleBlockH - tpSb - effLd;
            if (expectedNumSa < 0) expectedNumSa = 0;

            lines.push(
                "#" + i
                + " | lv=" + lv
                + " | entryTitle=\"" + title + "\""
                + " | entryPage=\"" + sommaireSafeStr(pageNum) + "\""
                + " | titleTxt=\"" + tpTxt + "\" lines=" + tpLines + " sb=" + tpSb + " sa=" + tpSa + " ld=" + tpLd
                + " | numTxt=\"" + npTxt + "\" lines=" + npLines + " sb=" + npSb + " sa=" + npSa + " ld=" + npLd
                + " | titleBlockH=" + titleBlockH + " expectedNumSa=" + expectedNumSa
            );
        }
        SOMMAIRE_DEBUG_LOGS.push(lines.join("\n"));
    } catch (eAll) {}
}

function sommaireForceVisibleNumeros(tfNums) {
    if (!tfNums) return;
    try {
        var noneCh = doc.characterStyles.itemByName("[None]");
        if (!noneCh.isValid) noneCh = doc.characterStyles[0];
        if (noneCh && noneCh.isValid) {
            try { tfNums.characters.everyItem().appliedCharacterStyle = noneCh; } catch (eN0) {}
        }
        var black = doc.swatches.itemByName("Black");
        if (!black.isValid) black = doc.swatches.itemByName("Noir");
        if (!black.isValid && doc.swatches.length > 0) black = doc.swatches[0];
        try { tfNums.texts.everyItem().fillColor = black; } catch (eN1) {}
        try { tfNums.texts.everyItem().pointSize = 11; } catch (eN2) {}
        try { tfNums.texts.everyItem().leading = 13; } catch (eN3) {}
    } catch (eAll) {}
}

function sommaireDetachTextFrameThread(tf) {
    if (!tf) return;
    try {
        var prev = tf.previousTextFrame;
        if (prev && prev.isValid) {
            try { prev.nextTextFrame = NothingEnum.NOTHING; } catch (ePrev0) { try { prev.nextTextFrame = null; } catch (ePrev1) {} }
        }
    } catch (eP) {}
    try { tf.nextTextFrame = NothingEnum.NOTHING; } catch (eN0) { try { tf.nextTextFrame = null; } catch (eN1) {} }
}

function sommaireRebuildStandaloneFrame(page, tf) {
    if (!page || !tf) return tf;
    var gb = null, lbl = "", layerRef = null, strokeW = null, vis = true;
    try { gb = tf.geometricBounds; } catch (eGb) {}
    try { lbl = String(tf.label || ""); } catch (eLbl) {}
    try { layerRef = tf.itemLayer; } catch (eLy) {}
    try { strokeW = tf.textFramePreferences.textColumnCount; } catch (eCol) {}
    try { vis = tf.visible !== false; } catch (eVis) {}
    if (!gb) return tf;
    var fresh = null;
    try {
        fresh = page.textFrames.add();
        fresh.geometricBounds = [gb[0], gb[1], gb[2], gb[3]];
        if (layerRef) fresh.itemLayer = layerRef;
        if (lbl !== "") fresh.label = lbl;
        try { if (strokeW) fresh.textFramePreferences.textColumnCount = strokeW; } catch (eColSet) {}
        try { fresh.visible = vis; } catch (eVisSet) {}
        try { tf.remove(); } catch (eRm) {}
        return fresh;
    } catch (eNew) {
        return tf;
    }
}

function sommairePrepareRuntimeNumerosFrame(page, sourceTf) {
    if (!page || !sourceTf) return sourceTf;
    var gb = null, layerRef = null;
    try { gb = sourceTf.geometricBounds; } catch (eGb) {}
    try { layerRef = sourceTf.itemLayer; } catch (eLy) {}
    if (!gb) return sourceTf;

    // Neutraliser completement le cadre source du gabarit pour eviter le debordement
    // de son story (pages SOMMAIRE vides + texte en exces).
    try { sourceTf.contents = ""; } catch (eC0) {}
    try { sourceTf.visible = false; } catch (eV0) {}
    sommaireDetachTextFrameThread(sourceTf);

    // Reutiliser un cadre runtime deja cree sur la page si present.
    var rt = sommaireGetTextFrame(page, "SOMMAIRE_numeros_runtime");
    if (rt) {
        try { rt.geometricBounds = [gb[0], gb[1], gb[2], gb[3]]; } catch (eRg) {}
        sommaireDetachTextFrameThread(rt);
        return rt;
    }

    try {
        rt = page.textFrames.add();
        rt.label = "SOMMAIRE_numeros_runtime";
        rt.geometricBounds = [gb[0], gb[1], gb[2], gb[3]];
        if (layerRef) rt.itemLayer = layerRef;
        try { rt.visible = true; } catch (eV1) {}
        sommaireDetachTextFrameThread(rt);
        return rt;
    } catch (eNew) {
        return sourceTf;
    }
}

function sommaireWriteLinesToFrame(tf, lines) {
    if (!tf) return;
    var arr = lines || [];
    try { tf.contents = ""; } catch (e0) { return; }
    for (var i = 0; i < arr.length; i++) {
        // Garder les "\n" (saut de ligne force dans un paragraphe), supprimer seulement "\r".
        var val = String(arr[i] === null || arr[i] === undefined ? "" : arr[i]).replace(/\r+/g, "");
        try {
            if (i > 0) {
                try {
                    tf.insertionPoints[-1].contents = SpecialCharacters.PARAGRAPH_BREAK;
                } catch (ePb) {
                    tf.insertionPoints[-1].contents = "\r";
                }
            }
            tf.insertionPoints[-1].contents = val;
        } catch (eW) {}
    }
    // Validation defensive: si InDesign n'a pas cree tous les paragraphes attendus,
    // reconstruire en une passe avec separateur explicite.
    try {
        var pc = tf.paragraphs.length;
        if (arr.length > 1 && pc < arr.length) {
            tf.contents = arr.join("\r") + "\r";
        }
    } catch (eChk) {}
}

function sommaireInjectNumerosStrictSimple(tfNums, numLines) {
    if (!tfNums) return;
    sommaireDetachTextFrameThread(tfNums);
    try {
        // Evite l'affichage type "0203 / 149150" quand le cadre est en multi-colonnes.
        tfNums.textFramePreferences.textColumnCount = 1;
    } catch (eCol1) {}
    var arr = numLines || [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
        var v = String(arr[i] === null || arr[i] === undefined ? "" : arr[i]);
        // Un numero = une seule ligne, sans retour parasite.
        v = v.replace(/[\r\n]+/g, "").replace(/^\s+|\s+$/g, "");
        out.push(v);
    }
    try {
        tfNums.contents = out.join("\r");
    } catch (eSet) {
        sommaireWriteLinesToFrame(tfNums, out);
    }
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
        var paras = sommaireNumerosStoryParagraphs(tfNums);
        if (!paras) return;
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
                    if (pstPick) {
                        sommaireApplyNumerosParagraphOnly(paras[pn], pstPick);
                        if (useLevels && !isNaN(lv) && lv === 0) {
                            try { paras[pn].spaceBefore = sommaireSectionTitleSpaceBeforePt(pn); } catch (eSb0) {}
                        }
                        if (!hasNum && pstPick === stVide) sommaireApplyAbsentSpacing(paras[pn]);
                    }
                } else {
                    if (hasNum && stGeneric) {
                        sommaireApplyNumerosParagraphOnly(paras[pn], stGeneric);
                    } else if (!hasNum && stVide) {
                        sommaireApplyNumerosParagraphOnly(paras[pn], stVide);
                        sommaireApplyAbsentSpacing(paras[pn]);
                    } else if (stGeneric) {
                        sommaireApplyNumerosParagraphOnly(paras[pn], stGeneric);
                    } else if (stVide) {
                        sommaireApplyNumerosParagraphOnly(paras[pn], stVide);
                        sommaireApplyAbsentSpacing(paras[pn]);
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
    if (DEBUG_SOMMAIRE_ENTRY_PROBE) {
        var rv = String(rawValue === null || rawValue === undefined ? "" : rawValue);
        var rvHead = rv.length > 160 ? rv.substring(0, 160) + "..." : rv;
        alert(
            "[DEBUG INJECT SOMMAIRE ENTRY]\n"
            + "Page=" + String(page.name || "?") + "\n"
            + "part=" + String(sommaireSpreadPart) + "\n"
            + "raw head=" + rvHead
        );
    }

    if (!rawValue || String(rawValue).replace(/^\s+|\s+$/, "") === "") return;

    var tfTitle = sommaireGetTextFrame(page, "SOMMAIRE_texte_1");
    if (!tfTitle) return;
    sommaireDetachTextFrameThread(tfTitle);

    try { tfTitle.visible = true; } catch (eVis0) {}

    var numLabelCandidates = sommaireBuildNumerosLabelCandidates();
    var tfNums = sommaireGetNumerosFrame(page, numLabelCandidates);
    if (tfNums) sommaireDetachTextFrameThread(tfNums);
    if (tfNums) { try { tfNums.visible = true; } catch (eVisN) {} }
    var dualMode = tfNums !== null;
    if (DEBUG_SOMMAIRE_ENTRY_PROBE) {
        alert(
            "[DEBUG SOMMAIRE ENTRY]\n"
            + "Page=" + String(page.name || "?") + "\n"
            + "dualMode=" + (dualMode ? "true" : "false") + "\n"
            + "tfNums=" + (tfNums ? "trouve" : "null")
        );
    }
    sommaireDebugAlert(
        "Page InDesign: " + String(page.name || "?")
        + "\nCadres numeros cherches: " + numLabelCandidates.join(", ")
        + "\nCadre numeros trouve: " + (tfNums ? "OUI (" + String(tfNums.label || "sans label") + ")" : "NON")
    );

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
                        var pg = sommaireEntryPageValue(e);
                        var haspg = pg !== "";
                        var titleOut = sommaireMaybeForceTwoLinesTitle(e, String(e.title || ""), haspg && lv !== 0);
                        if (!haspg) {
                            titleLines.push(titleOut);
                            numLines.push("");
                        } else if (lv === 1) {
                            // Mode 2 cadres : pas de tab d'indentation (le style gere deja l'alignement).
                            titleLines.push(titleOut);
                            numLines.push(String(pg));
                        } else {
                            titleLines.push(titleOut);
                            numLines.push(String(pg));
                        }
                    }
                    indesignText = titleLines.join("\r");
                    if (DEBUG_SOMMAIRE_FIRST_TWO_LINES) {
                        var d1 = numLines.length > 0 ? numLines[0] : "";
                        var d2 = numLines.length > 1 ? numLines[1] : "";
                        alert(
                            "[DEBUG NUMLINES JSON]\n"
                            + "count=" + numLines.length + "\n"
                            + "L1=[" + d1 + "]\n"
                            + "L2=[" + d2 + "]"
                        );
                    }
                } else {
                    var lines = [];
                    for (var j2 = 0; j2 < slice.length; j2++) {
                        var e2 = slice[j2];
                        var lv2 = parseInt(e2.level, 10);
                        if (isNaN(lv2)) lv2 = 2;
                        styleLevels.push(lv2);
                        var pg2 = sommaireEntryPageValue(e2);
                        var hasPage = pg2 !== "";
                        var titleOut2 = sommaireMaybeForceTwoLinesTitle(e2, String(e2.title || ""), hasPage && lv2 !== 0);
                        if (!hasPage) {
                            lines.push(titleOut2);
                        } else if (lv2 === 1) {
                            lines.push("\t" + titleOut2 + "\t" + String(pg2));
                        } else {
                            lines.push(titleOut2 + "\t" + String(pg2));
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
        sommaireWriteLinesToFrame(tfTitle, titleLines);
        if (SOMMAIRE_NUMBERS_STRICT_SIMPLE) {
            sommaireInjectNumerosStrictSimple(tfNums, numLines);
        } else {
            sommaireWriteLinesToFrame(tfNums, numLines);
        }
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
                    if (pst.isValid) {
                        sommaireApplyParagraphStyleStripOverrides(paras[p], pst);
                        if (lvl === 0) {
                            try { paras[p].leading = SOMMAIRE_SECTION_TITLE_LEADING_PT; } catch (eLead0) {}
                            try { paras[p].spaceBefore = sommaireSectionTitleSpaceBeforePt(p); } catch (eSb0) {}
                        } else if (lvl === 1) {
                            try { paras[p].leading = SOMMAIRE_PAGE_SECTION_LEADING_PT; } catch (eLead1) {}
                        } else if (lvl === 2) {
                            try { paras[p].leading = SOMMAIRE_PAGE_UNIQUE_LEADING_PT; } catch (eLead2) {}
                        }
                    }
                } catch (ePara) {}
            }
            if (dualMode && numLines) {
                if (SOMMAIRE_NUMBERS_ONLY_NO_LINKS) {
                    if (SOMMAIRE_NUMBERS_STRICT_SIMPLE) {
                        sommaireInjectNumerosStrictSimple(tfNums, numLines);
                    } else {
                        try { tfNums.contents = numLines.join("\r"); } catch (eNoLink0) {}
                        sommaireWriteLinesToFrame(tfNums, numLines);
                    }
                    sommaireApplyNumerosStyles(tfNums, numLines, styleLevels);
                    if (tfNums && sommaireDualSliceRef && sommaireIsNumerosColumnOne(tfNums))
                        sommaireApplyDualNumerosWrapSpacing(tfTitle, tfNums, sommaireResolveWrapFlags(tfTitle, sommaireDualSliceRef, null, null), sommaireDualSliceRef, null);
                } else {
                    sommaireApplyNumerosStyles(tfNums, numLines, styleLevels);
                    if (tfNums && sommaireDualSliceRef && sommaireIsNumerosColumnOne(tfNums))
                        sommaireApplyDualNumerosWrapSpacing(tfTitle, tfNums, sommaireResolveWrapFlags(tfTitle, sommaireDualSliceRef, null, null), sommaireDualSliceRef, null);
                }
            }
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
            if (dualMode && numLines) {
                if (SOMMAIRE_NUMBERS_ONLY_NO_LINKS) {
                    if (SOMMAIRE_NUMBERS_STRICT_SIMPLE) {
                        sommaireInjectNumerosStrictSimple(tfNums, numLines);
                    } else {
                        try { tfNums.contents = numLines.join("\r"); } catch (eNoLink1) {}
                        sommaireWriteLinesToFrame(tfNums, numLines);
                    }
                    sommaireApplyNumerosStyles(tfNums, numLines, null);
                    if (tfNums && titleLines && sommaireIsNumerosColumnOne(tfNums))
                        sommaireApplyDualNumerosWrapSpacing(tfTitle, tfNums, sommaireResolveWrapFlags(tfTitle, null, titleLines, numLines), null, numLines);
                } else {
                    sommaireApplyNumerosStyles(tfNums, numLines, null);
                    if (tfNums && titleLines && sommaireIsNumerosColumnOne(tfNums))
                        sommaireApplyDualNumerosWrapSpacing(tfTitle, tfNums, sommaireResolveWrapFlags(tfTitle, null, titleLines, numLines), null, numLines);
                }
            }
        }
    } catch (eSt) {}

    truncateOverflow(tfTitle);
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
    var raw = String(editorialPageNum === null || editorialPageNum === undefined ? "" : editorialPageNum)
        .replace(/^\s+|\s+$/g, "");
    if (raw === "") return null;

    // Priorite : lier a la page qui porte exactement ce numero dans InDesign.
    try {
        for (var p = 0; p < doc.pages.length; p++) {
            var pgName = String(doc.pages[p].name || "").replace(/^\s+|\s+$/g, "");
            if (pgName === raw) return doc.pages[p];
        }
    } catch (eEx) {}

    // Fallback tolerant : "02" cote JSON peut correspondre a "2" cote InDesign.
    var k = parseInt(raw, 10);
    if (isNaN(k)) return null;
    try {
        for (var p2 = 0; p2 < doc.pages.length; p2++) {
            var pgName2 = String(doc.pages[p2].name || "").replace(/^\s+|\s+$/g, "");
            var n2 = parseInt(pgName2, 10);
            if (!isNaN(n2) && n2 === k) return doc.pages[p2];
        }
    } catch (eNum) {}
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

/** Style caractere a appliquer au texte du lien (evite le style "Hyperlien" du doc qui casse graisse/couleur). */
function sommaireHyperlinkNoneCharacterStyle() {
    try {
        var noneCh = doc.characterStyles.itemByName("[None]");
        if (noneCh.isValid) return noneCh;
    } catch (e0) {}
    try {
        var noneFr = doc.characterStyles.itemByName("[Aucun style de caractère]");
        if (noneFr.isValid) return noneFr;
    } catch (eFr) {}
    try {
        var none2 = doc.characterStyles.itemByName("None");
        if (none2.isValid) return none2;
    } catch (e1) {}
    try {
        if (doc.characterStyles.length > 0) return doc.characterStyles[0];
    } catch (e2) {}
    return null;
}

function sommaireAddTextToPageHyperlink(textRange, targetPage) {
    if (!textRange || !targetPage) return;
    var dest = sommaireGetOrCreatePageDestination(targetPage);
    if (!dest) return;
    var src;
    try { src = doc.hyperlinkTextSources.add(textRange); } catch (eS) { return; }
    try {
        var hl = doc.hyperlinks.add(src, dest, {
            visible: false,
            highlight: HyperlinkAppearanceHighlight.NONE
        });
        try {
            var noneCh = sommaireHyperlinkNoneCharacterStyle();
            if (noneCh && noneCh.isValid) hl.appliedCharacterStyle = noneCh;
        } catch (eApp) {}
    } catch (eHl) {}
}

/** Reconstruit les lignes de numeros + niveaux a partir du slice (apres liens : reappliquer styles paragraphe). */
function sommaireBuildNumerosLinesAndLevelsFromSlice(slice) {
    var numLines = [];
    var styleLevels = [];
    if (!slice) return { numLines: numLines, styleLevels: styleLevels };
    for (var s0 = 0; s0 < slice.length; s0++) {
        var lv0 = parseInt(slice[s0].level, 10);
        if (isNaN(lv0)) lv0 = 2;
        styleLevels.push(lv0);
        var pg0 = sommaireEntryPageValue(slice[s0]);
        var hasPg0 = pg0 !== "";
        numLines.push((lv0 === 0 || !hasPg0) ? "" : String(pg0));
    }
    return { numLines: numLines, styleLevels: styleLevels };
}

function sommaireWireDualFrameNumbers(tfNums, tfTitle, slice, data, pageOffset) {
    if (!tfNums || !slice || slice.length === 0) return;
    sommaireRemoveInternalHyperlinksForNumerosStory(tfNums);
    var linksCreated = 0;
    var targetsMissing = 0;
    var rangeFailures = 0;
    var paraCountAtStart = 0;
    var lastRangeError = "";
    var storyParas = sommaireNumerosStoryParagraphs(tfNums);
    try { paraCountAtStart = storyParas ? storyParas.length : 0; } catch (ePc) {}
    for (var j = 0; j < slice.length; j++) {
        var entry = slice[j];
        var pg = sommaireEntryPageValue(entry);
        var lv = parseInt(entry.level, 10);
        if (isNaN(lv)) lv = 2;
        if (pg === "" || lv === 0)
            continue;
        var target = sommaireResolveTargetPage(pg, data, pageOffset);
        if (!target) { targetsMissing++; continue; }
        if (!storyParas || j >= storyParas.length) break;
        var para = storyParas[j];
        var display = String(pg).replace(/^\s+|\s+$/g, "");
        var curText = "";
        try { curText = String(para.contents || "").replace(/\r/g, "").replace(/^\s+|\s+$/g, ""); } catch (eTxt) {}
        // Ne pas reconstruire la colonne numeros ici : on preserve l'affichage deja injecte.
        // On ne remplit que les paragraphes vides pour conserver une base cliquable.
        if (curText === "") {
            try { para.contents = display; } catch (eC) { continue; }
        }
        try {
            para = storyParas[j];
            if (para.characters.length === 0) continue;
            var st = para.characters.item(0).index;
            var en = para.characters.item(para.characters.length - 1).index;
            var story = tfNums.parentStory;
            var tr = story.characters.itemByRange(st, en);
            sommaireAddTextToPageHyperlink(tr, target);
            linksCreated++;
        } catch (eR) { rangeFailures++; lastRangeError = String(eR); }
    }
    // Les hyperliens appliquent souvent le style caractere "Hyperlien" du document,
    // ce qui ecrase graisse / couleur des numeros. On reapplique les styles paragraphe
    // puis l'ajustement wrap (spaceBefore) calcule apres injection.
    try {
        var metaNums = sommaireBuildNumerosLinesAndLevelsFromSlice(slice);
        sommaireApplyNumerosStyles(tfNums, metaNums.numLines, metaNums.styleLevels);
        if (sommaireIsNumerosColumnOne(tfNums))
            sommaireApplyDualNumerosWrapSpacing(tfTitle, tfNums, sommaireResolveWrapFlags(tfTitle, slice, null, null), slice, null);
    } catch (eRestyle) {}
    sommaireDebugAlert(
        "Colonne numeros: " + String(tfNums.label || "sans label")
        + "\nLignes traitees: " + slice.length
        + "\nParagraphes au depart: " + paraCountAtStart
        + "\nLiens crees: " + linksCreated
        + "\nCibles introuvables: " + targetsMissing
        + "\nEchecs creation range/lien: " + rangeFailures
        + (lastRangeError ? ("\nDerniere erreur range/lien: " + lastRangeError) : "")
    );
}

function sommaireWireSingleFrameNumbers(tfTitle, slice, data, pageOffset) {
    if (!tfTitle || !slice || slice.length === 0) return;
    sommaireRemoveInternalHyperlinks(tfTitle);
    var paras = tfTitle.paragraphs;
    for (var j = 0; j < slice.length && j < paras.length; j++) {
        var entry2 = slice[j];
        var pg2 = sommaireEntryPageValue(entry2);
        var lv2 = parseInt(entry2.level, 10);
        if (isNaN(lv2)) lv2 = 2;
        if (pg2 === "" || lv2 === 0)
            continue;
        var target2 = sommaireResolveTargetPage(pg2, data, pageOffset);
        if (!target2) continue;
        var para2 = paras[j];
        var line = String(para2.contents || "");
        var display2 = String(pg2).replace(/^\s+|\s+$/g, "");
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
    var tfNums = sommaireGetNumerosFrame(idPage, sommaireBuildNumerosLabelCandidates());
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

    if (dualMode) sommaireWireDualFrameNumbers(tfNums, tfTitle, slice, data, pageOffset);
    else sommaireWireSingleFrameNumbers(tfTitle, slice, data, pageOffset);
    try {
        if (dualMode && tfNums) truncateOverflow(tfNums);
        truncateOverflow(tfTitle);
    } catch (eTr0) {}
    sommaireCollectDebugForPage(idPage, spreadPart, slice, tfTitle, tfNums, dualMode);
}

function sommaireWireAllSommairePagesForGenerate(data) {
    if (SOMMAIRE_NUMBERS_ONLY_NO_LINKS) return;
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
        var flTarget = FRAME_LINK_FIELDS[flKey];
        var flTargetKey = (typeof flTarget === "string") ? flTarget : flKey;
        var flMapping = data.mappings.fields[flTargetKey] || flTargetKey;
        var frameOpts = null;
        if (flKey === "POI_lien_1") {
            frameOpts = {
                poiLien1: true,
                textLinkLabel: data.mappings.fields["POI_lien_1"] || "POI_lien_1",
            };
        } else if (flKey === "CLUSTER_lien_1") {
            // Cherche CLUSTER_lien_1_zone ; sinon groupe parent du TextFrame CLUSTER_lien_1.
            frameOpts = {
                textLinkLabel: data.mappings.fields["CLUSTER_lien_1"] || "CLUSTER_lien_1",
            };
        }
        injectFrameHyperlink(page, flMapping, textContent[flKey] || null, frameOpts);
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

var finalMsg = pagesGenerated + " page(s) g\u00e9n\u00e9r\u00e9e(s) \u2714  |  "
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
            var owRec = overflowWarnings[ow];
            rf.writeln("p." + owRec.page
                     + "  [" + owRec.label + "]"
                     + (owRec.titre ? "  " + owRec.titre : ""));
            rf.writeln("Calibre : " + owRec.visibleChars + " car. visibles / "
                     + owRec.totalChars + " car. total  ("
                     + (owRec.totalChars - owRec.visibleChars) + " tronques)");
            var fullStr = (owRec.texteComplet !== undefined && owRec.texteComplet !== null)
                ? String(owRec.texteComplet) : "";
            var visStr  = fullStr.slice(0, owRec.visibleChars);
            var cutStr  = fullStr.slice(owRec.visibleChars);
            rf.writeln("Partie visible :");
            rf.writeln("---8<---");
            rf.writeln(visStr || "(vide)");
            rf.writeln("---8<---");
            rf.writeln("Partie tronquee :");
            rf.writeln("---8<---");
            rf.writeln(cutStr || "(vide)");
            rf.writeln("---8<---");
            rf.writeln("");
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
    finalMsg += "\n\n[!] " + imagePlacementWarnings.length + " image(s) non plac\u00e9e(s)";
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

if (DEBUG_SOMMAIRE_FILE && SOMMAIRE_DEBUG_LOGS.length > 0) {
    var sommaireDebugWritten = false;
    try {
        var srf = new File(rootFolder + "/sommaire-debug-report.txt");
        srf.encoding = "UTF-8";
        srf.open("w");
        srf.writeln("SOMMAIRE DEBUG REPORT");
        srf.writeln("Pages sommaire loggees : " + SOMMAIRE_DEBUG_LOGS.length);
        srf.writeln("====================================================");
        for (var sd = 0; sd < SOMMAIRE_DEBUG_LOGS.length; sd++) {
            srf.writeln(SOMMAIRE_DEBUG_LOGS[sd]);
            srf.writeln("----------------------------------------------------");
        }
        srf.close();
        sommaireDebugWritten = true;
    } catch (eSd) {}
    finalMsg += "\n\n[DEBUG SOMMAIRE] " + SOMMAIRE_DEBUG_LOGS.length + " page(s) loggee(s)"
             + (sommaireDebugWritten ? " -> voir sommaire-debug-report.txt" : " (impossible d ecrire sommaire-debug-report.txt)");
}

// Restaurer les preferences Smart Text Reflow
try {
    app.textPreferences.smartTextReflow         = savedSmartReflow;
    app.textPreferences.limitToMasterTextFrames = savedLimitToMaster;
} catch(e) {}

alert(finalMsg);
