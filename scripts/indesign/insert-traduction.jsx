/**
 * insert-traduction.jsx
 * Script InDesign ExtendScript — Injection textes et liens depuis JSON
 *
 * Ce script lit un fichier JSON exporte depuis l'application et injecte
 * dans le document courant :
 *   - Les textes (champs simples, listes a puces, noms+hashtags)
 *   - Les labels des liens (intitule visible dans le cadre)
 *   - Les hyperliens cliquables (actifs apres export PDF depuis InDesign)
 *
 * Ce script ne touche PAS :
 *   - Les images (blocs graphiques sans label lien)
 *   - Les liens de type Google Maps (_url_maps_)
 *
 * Prerequis InDesign :
 *   - Styles de caractere "Gras", "Orange", "Chiffre", "Gras-orange"
 *   - Blocs etiquetes (label) correspondant aux cles du JSON
 *
 * Usage :
 *   Fichier > Scripts > Parcourir... -> selectionner ce fichier
 *   Choisir le JSON dans la boite de dialogue
 */

#target indesign
#include "json2.js"


// ---------------------------------------------------------------------------
// Document courant
// ---------------------------------------------------------------------------

var doc = app.activeDocument;

// Debordements texte — rapport overflow-report.txt (meme logique que insert-fr.jsx)
var overflowWarnings = [];
var currentPageNum   = 0;
var currentPageTitre = "";

// --- TRACE DEBUG GRAS (jetable) ---------------------------------------------
// Trace pas-a-pas le traitement d'un bloc precis pour comprendre le gras.
var DEBUG_TRACE        = true;
var DEBUG_TRACE_TITLE  = "Punta del Hidalgo";   // page ciblee (titre exact)
var DEBUG_TRACE_LABELS = { "POI_liste_1": true }; // champs ciblés (cle JSON)
var TRACE_ACTIVE = false;   // mis a true pendant le traitement du bloc cible
var TRACE_LINES  = [];

function traceStyleName(ch) {
    try { var cs = ch.appliedCharacterStyle; return (cs && cs.isValid) ? cs.name : "(?)"; }
    catch (e) { return "(err)"; }
}
function traceFontStyle(ch) {
    try { return String(ch.fontStyle); } catch (e) { return "(err)"; }
}
// Regroupe les caracteres consecutifs partageant (styleCaractere + graisse).
function traceDumpRuns(tf) {
    var s = "";
    try {
        var chars = tf.characters;
        var n = chars.length;
        var curKey = null, buf = "", curStyle = "", curFont = "";
        for (var i = 0; i < n; i++) {
            var ch = chars.item(i);
            var st = traceStyleName(ch), ft = traceFontStyle(ch);
            var key = st + "|" + ft;
            var c; try { c = String(ch.contents); } catch (e) { c = "?"; }
            if (c === "\r") c = "\\r"; if (c === "\n") c = "\\n";
            if (key !== curKey) {
                if (curKey !== null) s += "    [" + curStyle + " / " + curFont + "] \"" + buf + "\"\n";
                curKey = key; curStyle = st; curFont = ft; buf = c;
            } else { buf += c; }
        }
        if (curKey !== null) s += "    [" + curStyle + " / " + curFont + "] \"" + buf + "\"\n";
        s += "    (total " + n + " car.)\n";
    } catch (e) { s += "    (dump impossible: " + e + ")\n"; }
    return s;
}
function trace(step, tf) {
    if (!TRACE_ACTIVE) return;
    TRACE_LINES.push("== " + step + " ==");
    if (tf) TRACE_LINES.push(traceDumpRuns(tf));
}
function traceRaw(label, str) {
    if (!TRACE_ACTIVE) return;
    var shown = String(str).replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    TRACE_LINES.push("== " + label + " ==");
    TRACE_LINES.push("    \"" + shown + "\"");
}

// ---------------------------------------------------------------------------
// Noms des styles de caractere utilises par les marqueurs inline
// ---------------------------------------------------------------------------

var STYLE_GRAS        = "Gras";        // **texte**
var STYLE_ORANGE      = "Orange";      // {texte}
var STYLE_CHIFFRE     = "Chiffre";     // ^texte^
var STYLE_GRAS_ORANGE = "Gras-orange"; // ~texte~

// Styles de paragraphe pour les blocs nom+hashtag (pages Inspiration)
var STYLE_PARA_NOM     = "Inspiration_nom";
var STYLE_PARA_HASHTAG = "Hashtag";

// ---------------------------------------------------------------------------
// Champs ignores lors de l'injection texte standard
// ---------------------------------------------------------------------------

// Ces champs sont traites par des fonctions dediees (pas par injectText).
// POI_meta_1 / POI_meta_duree : blocs picto geres separement
// POI_lien_2 : cadre graphique — traite par injectFrameHyperlink
// SOMMAIRE_texte_1 : JSON structure — traite par injectSommaire (evite style Orange sur "{")
var SKIP_TEXT = {
    "POI_meta_duree":   true,
    "POI_meta_1":       true,
    "POI_lien_2":       true,
    "SOMMAIRE_texte_1": true
};

// ---------------------------------------------------------------------------
// Configuration sommaire — valeurs identiques a insert-fr.jsx
// ---------------------------------------------------------------------------

// Styles paragraphe — cadre titres
var SOMMAIRE_STYLE_BY_LEVEL = {
    0: "Titre-section",
    1: "Page-section-sommaire",
    2: "Page-unique-sommaire"
};
// Fallback anciens exports
var SOMMAIRE_STYLE_N1 = "Sommaire_niveau1";
var SOMMAIRE_STYLE_N2 = "Sommaire_niveau2";

// Styles paragraphe — cadre numeros (candidats par ordre de priorite)
var SOMMAIRE_NUMEROS_STYLE_CANDIDATES      = ["Sommaire-numeros",              "sommaire-numeros",              "Sommaire_numeros"];
var SOMMAIRE_NUMEROS_VIDE_STYLE_CANDIDATES = ["Sommaire-numeros-absent",       "sommaire-numeros-absent",       "Sommaire_numeros_absent"];
var SOMMAIRE_NUMEROS_PAGE_SECTION_CANDIDATES = ["Sommaire-numeros-page-section","sommaire-numeros-page-section", "Sommaire_numeros_page_section"];
var SOMMAIRE_NUMEROS_PAGE_SEULE_CANDIDATES = ["Sommaire-numeros-page-seule",   "sommaire-numeros-page-seule",   "Sommaire_numeros_page_seule"];

// Seuils wrap (estimation 2 lignes par comptage de caracteres)
var SOMMAIRE_TITLE_WRAP_CHAR_MAX_SECTION = 31;
var SOMMAIRE_TITLE_WRAP_CHAR_MAX_DEFAULT = 38;
var SOMMAIRE_FORCE_TWO_LINES_ENABLED = true;
var SOMMAIRE_FORCE_TWO_LINES_CHAR_THRESHOLD = 35;
var SOMMAIRE_SECTION_TITLE_LEADING_PT = 18;
var SOMMAIRE_SECTION_TITLE_SPACE_BEFORE_PT = 22;
var SOMMAIRE_PAGE_SECTION_LEADING_PT = 18;
var SOMMAIRE_PAGE_UNIQUE_LEADING_PT = 45;

// spaceAfter colonne numeros (level 1 uniquement)
var SOMMAIRE_NUMEROS_SPACE_AFTER_ONE_LINE_PT = 17;
var SOMMAIRE_NUMEROS_SPACE_AFTER_TWO_LINES_PT = 36;
var SOMMAIRE_NUMEROS_ABSENT_SPACE_AFTER_TOP_PT     = 18;
var SOMMAIRE_NUMEROS_ABSENT_SPACE_AFTER_DEFAULT_PT = 18;

// Compteur de pages sommaire (1re page traitee = partie 1, 2e = partie 2, …)
var sommairePageIndex = 0;

// Champs dont la valeur est un lien {label, url} a poser sur un cadre GRAPHIQUE
var FRAME_LINK_FIELDS = {
    // Le label visible reste injecte dans POI_lien_1 (TextFrame).
    // La zone graphique POI_lien_1_zone (ou alias « lien 1 », ou groupe parent) rend toute la pastille cliquable.
    "POI_lien_1":             "POI_lien_1_zone",
    "POI_lien_2":             true,
    // Idem pour CLUSTER_lien_1 : cherche CLUSTER_lien_1_zone, sinon groupe parent du TextFrame.
    "CLUSTER_lien_1":         "CLUSTER_lien_1_zone",
    "ALLER_PLUS_LOIN_lien_1": true,
    "ALLER_PLUS_LOIN_lien_2": true,
    "ALLER_PLUS_LOIN_lien_3": true,
    "ALLER_PLUS_LOIN_lien_4": true,
    "ALLER_PLUS_LOIN_lien_5": true,
    "ALLER_PLUS_LOIN_lien_6": true
};

// ---------------------------------------------------------------------------
// 1. Chargement du JSON
// ---------------------------------------------------------------------------

var jsonFile = File.openDialog("Choisir le fichier JSON a injecter");
if (!jsonFile) { alert("Annule."); exit(); }

var rootFolder = jsonFile.parent;

jsonFile.encoding = "UTF-8";
jsonFile.open("r");
var rawJson = jsonFile.read();
jsonFile.close();

// Retirer le BOM UTF-8 eventuel
rawJson = rawJson.replace(/^\uFEFF/, "");

var data;
try {
    data = JSON.parse(rawJson);
} catch (eJson) {
    // Fallback : certains exports contiennent un JSON "presque valide"
    try {
        data = eval("(" + rawJson + ")");
    } catch (eEval) {
        alert(
            "Impossible de lire le JSON.\n\n" +
            "Erreur JSON.parse : " + eJson + "\n" +
            "Erreur fallback   : " + eEval + "\n\n" +
            "Verifiez l'encodage (UTF-8) et la syntaxe du fichier."
        );
        exit();
    }
}

if (!data || !data.pages || !data.pages.length) {
    alert("JSON invalide ou sans pages. Verifiez le fichier exporte.");
    exit();
}

// ---------------------------------------------------------------------------
// 2. Construire les dictionnaires de configuration depuis le JSON
// ---------------------------------------------------------------------------

// Champs de type liste a puces (depuis data.mappings.bullet_fields ou data.bullet_fields)
var bulletFields = {};
var bfSource = null;
try {
    if (data.mappings && data.mappings.bullet_fields && data.mappings.bullet_fields.length) {
        bfSource = data.mappings.bullet_fields;
    } else if (data.bullet_fields && data.bullet_fields.length) {
        bfSource = data.bullet_fields;
    }
} catch(eBf) {}

if (bfSource) {
    for (var bf = 0; bf < bfSource.length; bf++) {
        bulletFields[bfSource[bf]] = true;
    }
}
// Valeurs de secours pour les anciens exports
bulletFields["POI_liste_1"]                     = true;
bulletFields["POI_texte_2"]                     = true;
bulletFields["PRESENTATION_GUIDE_liste_sections"] = true;
// Page PRESENTATION_DESTINATION : ces champs sont des textes multilignes
// stylés comme listes dans InDesign, même lorsqu'ils ne viennent pas
// d'un champ template `type: liste` dans certains exports.
bulletFields["PRESENTATION_DESTINATION_texte_2"] = true;
bulletFields["PRESENTATION_DESTINATION_texte_3"] = true;
bulletFields["PRESENTATION_DESTINATION_texte_4"] = true;
bulletFields["PRESENTATION_DESTINATION_liste_1"] = true;
bulletFields["PRESENTATION_DESTINATION_liste_2"] = true;
bulletFields["PRESENTATION_DESTINATION_liste_3"] = true;

// Mapping cle JSON -> label InDesign (data.mappings.fields)
// Si absent, la cle JSON est utilisee directement comme label.
var fieldMappings = {};
try {
    if (data.mappings && data.mappings.fields) {
        fieldMappings = data.mappings.fields;
    }
} catch(eFm) {}

function resolveLabel(key) {
    return (fieldMappings[key]) ? String(fieldMappings[key]) : key;
}

// ---------------------------------------------------------------------------
// 3. Offset de page (fixe)
// ---------------------------------------------------------------------------

// Dans insert-traduction, l'offset est force a 0 (pas de modale).
var pageOffset = 0;

// ---------------------------------------------------------------------------
// 4. Utilitaires
// ---------------------------------------------------------------------------

// Retourne tous les objets d'une page portant le label donne.
function findByLabel(page, label) {
    var result = [];
    var items = page.allPageItems;
    for (var i = 0; i < items.length; i++) {
        try {
            if (items[i].label === label) result.push(items[i]);
        } catch(e) {}
    }
    return result;
}

function findByLabelOrOverrideMaster(page, label) {
    var result = findByLabel(page, label);
    if (result.length > 0) return result;

    // Les zones cliquables ajoutees au template peuvent rester sur le gabarit.
    // page.allPageItems ne les voit pas tant qu'elles ne sont pas overridées sur
    // la page courante ; or l'URL est propre a chaque page, donc on doit créer
    // une instance locale avant d'ajouter le HyperlinkPageItemSource.
    try {
        var master = page.appliedMaster;
        if (!master || !master.isValid) return result;
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
                var miLabel = String(masterItem.label || "");
                if (miLabel !== label) continue;
                var overridden = masterItem.override(page);
                try { overridden.label = label; } catch (eLabel) {}
                result.push(overridden);
            } catch (eOverride) {}
        }
    } catch (eMaster) {}
    return result;
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

// Extrait une URL depuis une valeur qui peut etre :
//   - un objet {label, url}
//   - une chaine JSON "{...}"
//   - une URL brute
// Retourne null si rien de valide.
function extractUrl(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "object") {
        try { return (value.url && String(value.url).replace(/^\s+|\s+$/g, "")) || null; } catch(e) {}
        return null;
    }
    var str = String(value).replace(/^\s+|\s+$/g, "");
    if (str === "") return null;
    if (str.charAt(0) === "{") {
        try {
            var parsed = eval("(" + str + ")");
            if (parsed && parsed.url) return String(parsed.url).replace(/^\s+|\s+$/g, "") || null;
        } catch(e) {}
    }
    return str;
}

// Extrait le label et l'URL depuis un objet lien structure {label, url}
// Retourne {label: string|null, url: string|null} ou null si non-structure.
function extractLinkObject(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "object") {
        if (value.label !== undefined && value.url !== undefined) {
            return { label: String(value.label || ""), url: String(value.url || "") };
        }
        return null;
    }
    var str = String(value).replace(/^\s+|\s+$/g, "");
    if (str.charAt(0) === "{") {
        try {
            var p = eval("(" + str + ")");
            if (p && p.label !== undefined && p.url !== undefined) {
                return { label: String(p.label || ""), url: String(p.url || "") };
            }
        } catch(e) {}
    }
    return null;
}

// ---------------------------------------------------------------------------
// 5. Application des styles de caractere via GREP
//
// Marqueurs supportes :
//   **texte**  -> style "Gras"
//   {texte}    -> style "Orange"
//   ^texte^    -> style "Chiffre"
//   ~texte~    -> style "Gras-orange"
//
// IMPORTANT : ne pas utiliser parentStory seul pour findGrep — si le cadre est
// filete, la story contient d'autres blocs et les ** d'un autre cadre faussent
// les plages de style. On limite au texte visible dans CE cadre (tf.texts.item(0)).
// Les styles sont appliques via story.characters.itemByRange(index, index) (indices
// story absolus), du dernier match au premier, pour eviter references invalides.
// ---------------------------------------------------------------------------

/** Texte du cadre (hors fil avec d'autres champs) ; fallback story si indispo. */
function grepScopeForTextFrame(tf) {
    // parentStory couvre TOUS les paragraphes du cadre, y compris ceux crees par
    // un \n JSON qui devient un saut de paragraphe InDesign (\r).
    // tf.texts.item(0) ne couvrait que le premier paragraphe, laissant les suivants
    // sans traitement GREP (styles non appliques, marqueurs non supprimes).
    return tf.parentStory;
}

/** Applique un style de caractere ET retire les marqueurs en UNE operation atomique.
 *  findWhat doit capturer le contenu interne dans le groupe $1 ; changeTo = "$1" remplace
 *  le match (marqueurs inclus) par son seul contenu, et appliedCharacterStyle stylise
 *  le texte resultant. Insensible a la position (debut de paragraphe inclus) — contrairement
 *  a l'ancienne approche par index absolus + suppression separee qui faisait baver le gras
 *  sur tout le paragraphe quand un marqueur ouvrait la ligne. */
function styleAndStripMarkers(scope, story, findWhat, charStyle) {
    if (!charStyle || !charStyle.isValid) return;
    app.findGrepPreferences = NothingEnum.NOTHING;
    app.changeGrepPreferences = NothingEnum.NOTHING;
    app.findGrepPreferences.findWhat = findWhat;
    app.changeGrepPreferences.changeTo = "$1";
    try { app.changeGrepPreferences.appliedCharacterStyle = charStyle; } catch (eCS) {}
    try {
        scope.changeGrep();
    } catch (eC) {
        try { story.changeGrep(); } catch (e2) {}
    }
    app.findGrepPreferences = NothingEnum.NOTHING;
    app.changeGrepPreferences = NothingEnum.NOTHING;
}

function changeGrepOnScope(scope, story, findWhat, changeTo) {
    app.findGrepPreferences = NothingEnum.NOTHING;
    app.changeGrepPreferences = NothingEnum.NOTHING;
    app.findGrepPreferences.findWhat = findWhat;
    app.changeGrepPreferences.changeTo = changeTo;
    try {
        scope.changeGrep();
    } catch (eC) {
        try { story.changeGrep(); } catch (e2) {}
    }
    app.findGrepPreferences = NothingEnum.NOTHING;
    app.changeGrepPreferences = NothingEnum.NOTHING;
}

/**
 * Apres application GREP des marqueurs, retire le gras (ou autre formatage)
 * herite du master FR sur les caracteres qui ne portent pas un style de marqueur.
 * Corrige le cas des listes POI traduites ou tout le paragraphe restait en gras.
 */
function resetNonMarkerCharacterFormatting(tf) {
    var noneCh = getNoneCharacterStyle();
    if (!noneCh || !noneCh.isValid) return;

    var markerStyles = {};
    markerStyles[STYLE_GRAS] = true;
    markerStyles[STYLE_ORANGE] = true;
    markerStyles[STYLE_CHIFFRE] = true;
    markerStyles[STYLE_GRAS_ORANGE] = true;

    try {
        var scope = grepScopeForTextFrame(tf);
        var chars = scope.characters;
        for (var c = 0; c < chars.length; c++) {
            try {
                var ch = chars.item(c);
                var applied = ch.appliedCharacterStyle;
                var isMarker = applied && applied.isValid && markerStyles[applied.name] === true;
                if (!isMarker) {
                    ch.appliedCharacterStyle = noneCh;
                    if (typeof ch.clearOverrides === "function") {
                        try { ch.clearOverrides(OverrideType.CHARACTER_ONLY); } catch (eClr) { ch.clearOverrides(); }
                    }
                }
            } catch (eChar) {}
        }
    } catch (eScope) {}
}

// Application atomique des marqueurs : chaque passe stylise le contenu interne ($1)
// et retire les marqueurs en une seule operation changeGrep. Fiable quelle que soit
// la position du marqueur (y compris en tout debut de paragraphe).
function applyStyleMarkers(tf, clearAllCharacterInheritance) {
    try {
        var story = tf.parentStory;
        var scope = grepScopeForTextFrame(tf);

        var sGras       = doc.characterStyles.itemByName(STYLE_GRAS);
        var sOrange     = doc.characterStyles.itemByName(STYLE_ORANGE);
        var sChiffre    = doc.characterStyles.itemByName(STYLE_CHIFFRE);
        var sGrasOrange = doc.characterStyles.itemByName(STYLE_GRAS_ORANGE);

        trace("5a. applyStyleMarkers ENTREE", tf);

        // Pass 0 : combinaison {**texte**} → Gras-orange. DOIT preceder les passes
        // bold/orange separees pour eviter que l'une ne consomme l'autre.
        styleAndStripMarkers(scope, story, "(?s)\\{\\*\\*([^*}]+?)\\*\\*\\}", sGrasOrange);
        trace("5b. apres passe {**...**} (Gras-orange)", tf);

        // **texte** → Gras
        styleAndStripMarkers(scope, story, "(?s)\\*\\*([^*]+?)\\*\\*", sGras);
        trace("5c. apres passe **...** (Gras)", tf);

        // {texte} → Orange
        styleAndStripMarkers(scope, story, "(?s)\\{([^}]+?)\\}", sOrange);
        changeGrepOnScope(scope, story, "\\{", "");   // accolades orphelines
        changeGrepOnScope(scope, story, "\\}", "");

        // ^texte^ → Chiffre
        styleAndStripMarkers(scope, story, "(?s)\\^([^\\^]+?)\\^", sChiffre);

        // ~texte~ → Gras-orange
        styleAndStripMarkers(scope, story, "(?s)\\x7E([^\\x7E]+?)\\x7E", sGrasOrange);

        // Retirer d'eventuels marqueurs ** orphelins (paires desequilibrees)
        changeGrepOnScope(scope, story, "\\*\\*", "");
        trace("5d. apres toutes passes + strip orphelins", tf);

        if (clearAllCharacterInheritance === true) {
            resetNonMarkerCharacterFormatting(tf);
            trace("5e. apres resetNonMarkerCharacterFormatting", tf);
        }
    } catch(e) {}
}

/**
 * Reinitialise UNIQUEMENT les styles de caractere poses par applyStyleMarkers
 * (Gras, Orange, Chiffre, Gras-orange) sur la portee du cadre.
 * Ne touche a AUCUN autre style de caractere ni aux styles de paragraphe
 * du gabarit (titres, chapô, boutons...).
 *
 * Principe : apres un aller-retour FR->EN, InDesign peut heriter ces 4 styles
 * sur le nouveau texte injecte via tf.contents. Ce nettoyage cible est la seule
 * operation necessaire et suffisante — pas de clearOverrides, pas de [None] global.
 */
function getNoneCharacterStyle() {
    // characterStyles[0] est TOUJOURS le style [None]/[Aucun], quelle que soit la
    // langue de l'UI InDesign. C'est la methode fiable : itemByName("[None]") echoue
    // en InDesign francais (le style se nomme "[Aucun]"), ce qui renvoyait null et
    // rendait resetMarkerCharStyles / resetNonMarkerCharacterFormatting inoperants
    // (le gras du gabarit survivait alors a tout le pipeline).
    try {
        var first = doc.characterStyles.item(0);
        if (first && first.isValid) return first;
    } catch (e0) {}
    var cand = ["[None]", "[Aucun]", "[Aucun style de caractere]", "[Aucun style de caractère]", "None"];
    for (var k = 0; k < cand.length; k++) {
        try {
            var t = doc.characterStyles.itemByName(cand[k]);
            if (t.isValid) return t;
        } catch (e1) {}
    }
    return null;
}

function resetMarkerCharStyles(tf) {
    var noneCh = getNoneCharacterStyle();
    if (!noneCh || !noneCh.isValid) return;

    var scope = grepScopeForTextFrame(tf);
    var markerStyles = {};
    markerStyles[STYLE_GRAS] = true;
    markerStyles[STYLE_ORANGE] = true;
    markerStyles[STYLE_CHIFFRE] = true;
    markerStyles[STYLE_GRAS_ORANGE] = true;

    // Quand on remplace le contenu d'un master FR par une nouvelle langue,
    // InDesign conserve parfois les styles de caractere par position. Le GREP
    // rate certains morceaux dans les textes mixtes ; le parcours caractère par
    // caractère est plus fiable et ne touche qu'aux styles issus des marqueurs.
    try {
        var chars = scope.characters;
        for (var c = 0; c < chars.length; c++) {
            try {
                var ch = chars.item(c);
                var applied = ch.appliedCharacterStyle;
                if (applied && applied.isValid && markerStyles[applied.name] === true) {
                    ch.appliedCharacterStyle = noneCh;
                }
            } catch (eChar) {}
        }
    } catch (eScope) {
        try {
            var storyChars = tf.parentStory.characters;
            for (var sc = 0; sc < storyChars.length; sc++) {
                try {
                    var sch = storyChars.item(sc);
                    var sapplied = sch.appliedCharacterStyle;
                    if (sapplied && sapplied.isValid && markerStyles[sapplied.name] === true) {
                        sch.appliedCharacterStyle = noneCh;
                    }
                } catch (eStoryChar) {}
            }
        } catch (e) {}
    }
    app.findGrepPreferences = NothingEnum.NOTHING;
    app.changeGrepPreferences = NothingEnum.NOTHING;
}

function clearCharacterOnlyOverrides(tf) {
    try {
        var scope = grepScopeForTextFrame(tf);
        if (scope && typeof scope.clearOverrides === "function") {
            scope.clearOverrides(OverrideType.CHARACTER_ONLY);
            return;
        }
    } catch (eScopeClear) {}
    try {
        if (tf.texts && tf.texts.length > 0 &&
            typeof tf.texts.item(0).clearOverrides === "function") {
            tf.texts.item(0).clearOverrides(OverrideType.CHARACTER_ONLY);
        }
    } catch (eTextClear) {}
}

function clearAllOverridesForText(tf) {
    try {
        var scope = grepScopeForTextFrame(tf);
        if (scope && typeof scope.clearOverrides === "function") {
            try { scope.clearOverrides(OverrideType.ALL); } catch (eScopeAll) { scope.clearOverrides(); }
            return;
        }
    } catch (eScopeClear) {}
    try {
        if (tf.texts && tf.texts.length > 0 &&
            typeof tf.texts.item(0).clearOverrides === "function") {
            try { tf.texts.item(0).clearOverrides(OverrideType.ALL); } catch (eTextAll) { tf.texts.item(0).clearOverrides(); }
        }
    } catch (eTextClear) {}
}

function setCleanTextFrameContents(tf, text, clearAllOverrides) {
    var paraStyles = [];
    try {
        for (var p = 0; p < tf.paragraphs.length; p++) {
            try {
                var ps = tf.paragraphs[p].appliedParagraphStyle;
                paraStyles.push((ps && ps.isValid) ? ps : null);
            } catch (ePara) { paraStyles.push(null); }
        }
    } catch (eReadPara) {}

    // Vider vraiment le bloc avant d'ecrire la nouvelle langue. Sinon InDesign
    // conserve des styles de caractere par position depuis le master FR.
    try { tf.contents = ""; } catch (eEmpty) {}
    try {
        if (tf.insertionPoints && tf.insertionPoints.length > 0) {
            var ip = tf.insertionPoints.item(0);
            var noneCh = getNoneCharacterStyle();
            if (noneCh && noneCh.isValid) ip.appliedCharacterStyle = noneCh;
            if (typeof ip.clearOverrides === "function") {
                try { ip.clearOverrides(OverrideType.ALL); } catch (eIpAll) { ip.clearOverrides(); }
            }
        }
    } catch (eIp) {}

    tf.contents = text;

    if (clearAllOverrides === true) {
        clearAllOverridesForText(tf);
    } else {
        clearCharacterOnlyOverrides(tf);
    }

    try {
        var lastStyle = null;
        for (var np = 0; np < tf.paragraphs.length; np++) {
            var styleToApply = paraStyles[np] || lastStyle || paraStyles[0];
            if (styleToApply && styleToApply.isValid) {
                tf.paragraphs[np].appliedParagraphStyle = styleToApply;
                lastStyle = styleToApply;
            }
        }
    } catch (eApplyPara) {}
}

function setBulletTextWithCapturedParagraphStyle(tf, text) {
    var bulletStyle = null;
    try {
        if (tf.paragraphs && tf.paragraphs.length > 0) {
            var ps = tf.paragraphs[0].appliedParagraphStyle;
            if (ps && ps.isValid) bulletStyle = ps;
        }
    } catch (eStyle) {}

    try { tf.contents = ""; } catch (eEmpty) {}
    tf.contents = text;

    try {
        for (var p = 0; p < tf.paragraphs.length; p++) {
            try {
                if (bulletStyle && bulletStyle.isValid) {
                    tf.paragraphs[p].appliedParagraphStyle = bulletStyle;
                }
                // Nettoyage CARACTERE uniquement : retire le gras/italique herite du
                // master FR sans toucher aux surcharges de PARAGRAPHE (puces, retraits,
                // espacements) portees par le gabarit. clearOverrides(ALL) effacerait
                // les puces locales — c'est ce qui cassait les listes SAISON.
                if (typeof tf.paragraphs[p].clearOverrides === "function") {
                    try { tf.paragraphs[p].clearOverrides(OverrideType.CHARACTER_ONLY); } catch (eCh) {}
                }
            } catch (ePara) {}
        }
    } catch (eParas) {}

    clearCharacterOnlyOverrides(tf);
}

// Verifie si une chaine contient des marqueurs de style
function hasMarkers(str) {
    return (str.indexOf("**") !== -1 ||
            str.indexOf("{")  !== -1 ||
            str.indexOf("^")  !== -1 ||
            str.indexOf("~")  !== -1);
}

/**
 * Normalise les marqueurs avant injection InDesign :
 * 1. {**texte**} → ~texte~  (Gras-orange via le pass tilde, pas de GREP imbriqué)
 * 2. \n → \r               (saut de paragraphe InDesign, couvre tous les paragraphes)
 */
function normalizeMarkersForIndesign(s) {
    if (!s) return s;
    // {**texte**} → ~texte~ : slice(2, len-2) retire les ** de debut/fin
    // sans regex (ancres ^ et $ instables dans ExtendScript).
    // Note : on ne convertit PAS \n en \r — le \n produit un retour force
    // InDesign (meme paragraphe = meme style) alors que \r creerait un nouveau
    // paragraphe avec un style potentiellement different (ex. gras parasite).
    s = s.replace(/\{(\*\*[^*}]+?\*\*)\}/g, function(all, inner) {
        return "~" + inner.slice(2, inner.length - 2) + "~";
    });
    return s;
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
        // 1. "a**nd" → "** and"
        out = out.replace(/\*\*([^*]+?)\s+a\*\*(nd)\b/gi, "**$1** and");
        // 2. Lettre orpheline avant ouverture : "t**o choose**" → "**to choose**"
        out = out.replace(/(^|[\s\n\r"'"\u00AB\u00BB().,;:!?\-])([a-z\u00E0-\u00FF])\*\*([^*\r\n]+?)\*\*/gim,
            function(all, sep, letter, inner) {
                if (!innerStartsVowel(inner)) return all;
                return sep + "**" + letter + inner + "**";
            });
        // 3. Fermeture prématurée coupe un mot : "**Mudejar st**yle" → "**Mudejar style**"
        out = out.replace(/\*\*([^*\r\n]+?)\*\*([a-z\u00C0-\u00FF]+)/g, "**$1$2**");
        if (out === prev) break;
    }
    return out;
}

// Tronque le surplus si le cadre deborde (evite la creation de pages supplementaires).
// Meme comportement que insert-fr.jsx : enregistrement pour overflow-report.txt.
function truncateOverflow(tf) {
    try {
        if (!tf.overflows) return;
        var story    = tf.parentStory;
        var visCount = tf.characters.length;
        var total    = story.characters.length;
        if (total > visCount && visCount > 0) {
            var texteComplet = "";
            try { texteComplet = String(story.contents); } catch (eCap) { texteComplet = ""; }
            overflowWarnings.push({
                page:           currentPageNum,
                titre:          currentPageTitre,
                label:          tf.label || "(sans label)",
                texteComplet:   texteComplet,
                visibleChars:   visCount,
                totalChars:     total
            });
            story.characters.itemByRange(visCount, total - 1).remove();
        }
    } catch(e) {}
}

// ---------------------------------------------------------------------------
// 6. Injection texte dans un cadre TextFrame
// ---------------------------------------------------------------------------

// Injecte un texte simple ou un lien structure {label, url} dans un cadre texte.
// Si la valeur est vide/null, le cadre est masque.
function injectText(page, label, value) {
    var blocks = findByLabel(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        var tf = blocks[i];

        var isEmpty = (value === null || value === undefined ||
                       String(value).replace(/^\s+|\s+$/, "") === "");
        if (isEmpty) {
            tf.visible = false;
            continue;
        }

        // Detecter un objet lien {label, url}
        var linkObj = extractLinkObject(value);
        if (linkObj !== null) {
            var show = linkObj.label !== "" || linkObj.url !== "";
            tf.visible = show;
            if (show) {
                tf.contents = repairBoldMarkersInJsonContent(linkObj.label);
                resetMarkerCharStyles(tf);
                if (hasMarkers(tf.contents)) applyStyleMarkers(tf);
                truncateOverflow(tf);
                if (linkObj.url !== "") {
                    injectHyperlink(page, label, linkObj.url);
                }
            }
            continue;
        }

        // Texte simple
        tf.visible = true;
        var rawStr = repairBoldMarkersInJsonContent(String(value).replace(/^\s+|\s+$/g, ""));
        var str    = normalizeMarkersForIndesign(rawStr);
        // Vider le cadre avant réécriture : InDesign conserve sinon les styles
        // de caractère par position (comportement documenté).
        // On ne touche QUE ce cadre — pas de clearOverrides sur parentStory
        // qui détruirait les styles d'autres blocs.
        try { tf.contents = ""; } catch (eClear) {}
        try {
            if (tf.insertionPoints && tf.insertionPoints.length > 0) {
                var ip = tf.insertionPoints.item(0);
                var nc = getNoneCharacterStyle();
                if (nc && nc.isValid) ip.appliedCharacterStyle = nc;
            }
        } catch (eIp) {}
        tf.contents = str;
        resetMarkerCharStyles(tf);
        if (hasMarkers(str)) applyStyleMarkers(tf);
        truncateOverflow(tf);
    }
}

// Injecte une liste a puces : une ligne = un item, separateur \n -> \r (InDesign).
// Le style de puce est porte par le cadre InDesign ; le script n'envoie que le texte brut.
function injectBulletText(page, label, value) {
    var blocks = findByLabel(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        var tf = blocks[i];
        if (!value) { tf.visible = false; continue; }

        var lines = String(value).split("\n");
        var items = [];
        for (var l = 0; l < lines.length; l++) {
            var line = lines[l].replace(/^\s+|\s+$/, "");
            if (line !== "") items.push(line);
        }
        if (items.length === 0) { tf.visible = false; continue; }

        tf.visible = true;

        // --- TRACE DEBUG : activer pour la page + le bloc cibles ---
        TRACE_ACTIVE = (DEBUG_TRACE &&
                        currentPageTitre === DEBUG_TRACE_TITLE &&
                        String(label).indexOf("POI_liste") === 0);
        if (TRACE_ACTIVE) {
            TRACE_LINES.push("############################################");
            TRACE_LINES.push("PAGE: " + currentPageTitre + "  |  LABEL: " + label);
            TRACE_LINES.push("############################################");
            traceRaw("0. value brute (depuis JSON)", value);
            trace("1. ENTREE — placeholder du cadre AVANT toute modif", tf);
        }

        var fullText = repairBoldMarkersInJsonContent(items.join("\r"));
        if (TRACE_ACTIVE) traceRaw("2. fullText (apres repair + join \\r)", fullText);

        // Le nettoyage profond est nécessaire sur les listes POI pour supprimer
        // le gras hérité du master FR. Les autres listes repartent du style
        // paragraphe porté par le gabarit (puces définies dans le template).
        var deepCleanBullet = (String(label).indexOf("POI_") === 0);
        if (deepCleanBullet) {
            setCleanTextFrameContents(tf, fullText, true);
            trace("3. apres setCleanTextFrameContents(clearAll=true)", tf);
        } else {
            setBulletTextWithCapturedParagraphStyle(tf, fullText);
            trace("3. apres setBulletTextWithCapturedParagraphStyle", tf);
        }
        resetMarkerCharStyles(tf);
        trace("4. apres resetMarkerCharStyles", tf);

        if (hasMarkers(fullText)) applyStyleMarkers(tf, deepCleanBullet);
        trace("6. apres applyStyleMarkers (FINAL)", tf);

        truncateOverflow(tf);
        TRACE_ACTIVE = false;
    }
}

// Injecte un champ "Nom\rHashtag" (style paragraphe different pour chaque partie).
// Utilise pour les cartes Inspiration : 1er para = Inspiration_nom, 2eme = Hashtag.
function injectNomHashtag(page, label, value) {
    var blocks = findByLabel(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        var tf = blocks[i];
        if (!value || String(value).replace(/^\s+|\s+$/, "") === "") {
            tf.visible = false;
            continue;
        }
        tf.visible = true;
        var strVal = repairBoldMarkersInJsonContent(String(value).replace(/\r\n/g, "\r").replace(/\n/g, "\r"));
        tf.contents = strVal;
        try {
            var nomStyle  = doc.paragraphStyles.itemByName(STYLE_PARA_NOM);
            var hashStyle = doc.paragraphStyles.itemByName(STYLE_PARA_HASHTAG);
            var paras = tf.paragraphs;
            if (paras.length >= 1 && nomStyle.isValid)  paras[0].appliedParagraphStyle = nomStyle;
            if (paras.length >= 2 && hashStyle.isValid) paras[1].appliedParagraphStyle = hashStyle;
        } catch(e) {}
        resetMarkerCharStyles(tf);
        if (hasMarkers(strVal)) applyStyleMarkers(tf);
        truncateOverflow(tf);
    }
}

// Affiche ou masque un objet quelconque (Group, Rectangle…) selon la presence d'une valeur.
// Utilise pour les slots repetes (_card_N) dont la visibilite depend du contenu.
function injectVisibility(page, label, value) {
    var show = (value !== null && value !== undefined &&
                String(value).replace(/^\s+|\s+$/, "") !== "");
    var blocks = findByLabel(page, label);
    for (var i = 0; i < blocks.length; i++) {
        try { blocks[i].visible = show; } catch(e) {}
    }
}

// ---------------------------------------------------------------------------
// 7. Injection hyperlien sur un cadre TEXTE (cliquable apres export PDF)
//
// Ordre critique pour un document existant (pages deja remplies) :
//
//   1. Capturer rangeText = tf.texts.item(0) EN PREMIER, avant tout nettoyage.
//      src.remove() invalide la reference tf dans ExtendScript ;
//      rangeText (objet Text) survit a src.remove() et reste utilisable.
//
//   2. Supprimer les Hyperlinks sur CE cadre (comparaison par cadre,
//      pas par story — evite de toucher des cadres lies dans le meme flux).
//
//   3. Supprimer les HyperlinkTextSources orphelines sur CE cadre.
//      Apres hl.remove(), la source peut rester orpheline.
//      hyperlinkTextSources.add() echoue si une source orpheline existe deja
//      sur la meme plage de texte → le lien n'est jamais cree.
//      Note : hts.remove() invalide tf, mais rangeText est deja capture (etape 1).
//
//   4. Creer destination + source (sur rangeText) + hyperlien.
// ---------------------------------------------------------------------------

function injectHyperlink(page, label, url) {
    if (!url || String(url).replace(/^\s+|\s+$/g, "") === "") return;
    var cleanUrl = String(url).replace(/^\s+|\s+$/g, "");

    var blocks = findByLabel(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        var tf = blocks[i];

        // Etape 1 : capturer rangeText AVANT tout nettoyage
        var rangeText = null;
        try {
            if (tf.texts && tf.texts.length > 0) rangeText = tf.texts.item(0);
        } catch(eR) {}
        if (!rangeText) {
            try { rangeText = tf.parentStory.texts.item(0); } catch(eS) { continue; }
        }

        // Etape 2 : supprimer les Hyperlinks sur CE cadre (comparaison par cadre)
        var hlList = doc.hyperlinks;
        for (var h = hlList.length - 1; h >= 0; h--) {
            try {
                var hl  = hlList.item(h);
                var src = hl.source;
                if (src && src.sourceText &&
                    src.sourceText.parentTextFrames &&
                    src.sourceText.parentTextFrames.length > 0 &&
                    src.sourceText.parentTextFrames[0] === tf) {
                    hl.remove();
                }
            } catch(eH) {}
        }

        // Etape 3 : supprimer les HyperlinkTextSources orphelines sur CE cadre
        // (hl.remove() ne supprime pas toujours la source associee)
        // Apres hts.remove(), tf peut etre invalide — rangeText reste utilisable.
        var htsList = doc.hyperlinkTextSources;
        for (var s = htsList.length - 1; s >= 0; s--) {
            try {
                var hts = htsList.item(s);
                if (hts.sourceText &&
                    hts.sourceText.parentTextFrames &&
                    hts.sourceText.parentTextFrames.length > 0 &&
                    hts.sourceText.parentTextFrames[0] === tf) {
                    hts.remove();
                }
            } catch(eS2) {}
        }
        // tf potentiellement invalide a partir d'ici — on utilise uniquement rangeText

        // Etape 4 : destination URL
        var dest;
        try {
            dest = doc.hyperlinkURLDestinations.add(cleanUrl);
        } catch(eDest) {
            try { dest = doc.hyperlinkURLDestinations.itemByName(cleanUrl); } catch(eDest2) { continue; }
        }

        // Etape 5 : source texte sur rangeText (capture a l'etape 1)
        var srcNew;
        try {
            srcNew = doc.hyperlinkTextSources.add(rangeText);
        } catch(eSrcNew) { continue; }

        // Etape 6 : hyperlien (invisible dans le document, actif au PDF)
        try {
            doc.hyperlinks.add(srcNew, dest, {
                visible:   false,
                highlight: HyperlinkAppearanceHighlight.NONE
            });
        } catch(eNew) {}
    }
}

// ---------------------------------------------------------------------------
// 8. Injection hyperlien sur un cadre GRAPHIQUE (Rectangle, Oval, Group…)
//    Rend le cadre entier cliquable apres export PDF (HyperlinkPageItemSource).
//
//    Meme probleme que pour les cadres texte :
//    hl.remove() ne supprime pas toujours la HyperlinkPageItemSource associee.
//    Si la source orpheline reste, hyperlinkPageItemSources.add(block) echoue
//    et aucun hyperlien n'est cree. On doit donc nettoyer explicitement
//    les sources orphelines apres la suppression des hyperlinks.
// ---------------------------------------------------------------------------

function injectFrameHyperlink(page, label, value, frameLinkOpts) {
    var url = extractUrl(value);
    var blocks = findFrameLinkBlocks(page, label, frameLinkOpts);

    for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (!url) {
            try { block.visible = false; } catch(e) {}
            continue;
        }
        try { block.visible = true; } catch(e) {}

        // Etape 1 : supprimer les Hyperlinks sur ce cadre
        var hlList = doc.hyperlinks;
        for (var h = hlList.length - 1; h >= 0; h--) {
            try {
                var hs = hlList.item(h).source;
                if (hs && hs.sourcePageItem && hs.sourcePageItem === block) {
                    hlList.item(h).remove();
                }
            } catch(e) {}
        }

        // Etape 2 : supprimer les HyperlinkPageItemSources orphelines sur ce cadre
        var pisList = doc.hyperlinkPageItemSources;
        for (var ps = pisList.length - 1; ps >= 0; ps--) {
            try {
                if (pisList.item(ps).sourcePageItem === block) {
                    pisList.item(ps).remove();
                }
            } catch(e) {}
        }

        // Etape 3 : destination URL
        var dest;
        try {
            dest = doc.hyperlinkURLDestinations.add(url);
        } catch(eDest) {
            try {
                dest = doc.hyperlinkURLDestinations.itemByName(url);
            } catch(eDest2) {
                continue;
            }
        }

        // Etape 4 : source page-item et hyperlien
        var srcPi;
        try {
            srcPi = doc.hyperlinkPageItemSources.add(block);
        } catch(eSrcPi) {
            continue;
        }
        try {
            doc.hyperlinks.add(srcPi, dest, {
                visible:   false,
                highlight: HyperlinkAppearanceHighlight.NONE
            });
        } catch(eHl) {}
    }
}

// ---------------------------------------------------------------------------
// 9. Sommaire — helpers (portage rigoureux de insert-fr.jsx)
// ---------------------------------------------------------------------------

// Paragraphes depuis la story complete (cadres files inclus) ou depuis le cadre seul.
function sommaireStoryParas(tf) {
    if (!tf) return null;
    try {
        var st = tf.parentStory;
        if (st && st.paragraphs && st.paragraphs.length > 0) return st.paragraphs;
    } catch(e) {}
    try { return tf.paragraphs; } catch(e2) {}
    return null;
}

// Detache le cadre de tout fil (thread) precedent et suivant.
function sommaireDetachThread(tf) {
    if (!tf) return;
    try {
        var prev = tf.previousTextFrame;
        if (prev && prev.isValid) {
            try { prev.nextTextFrame = NothingEnum.NOTHING; } catch(e) { try { prev.nextTextFrame = null; } catch(e2) {} }
        }
    } catch(eP) {}
    try { tf.nextTextFrame = NothingEnum.NOTHING; } catch(e0) { try { tf.nextTextFrame = null; } catch(e1) {} }
}

// Retourne la valeur de page d'une entree (supporte page / page_number / numero_page).
function sommaireEntryPage(entry) {
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

// Construit la slice pour une partie du sommaire depuis les entries ou entries_by_sommaire_page.
function sommaireSliceForPart(parsed, part) {
    var slice = [];
    if (parsed.entries_by_sommaire_page) {
        var bag = parsed.entries_by_sommaire_page[String(part)];
        if (bag instanceof Array) {
            for (var si = 0; si < bag.length; si++) slice.push(bag[si]);
            return slice;
        }
    }
    var allE = parsed.entries || [];
    for (var ei = 0; ei < allE.length; ei++) {
        var sp = parseInt(allE[ei].sommaire_page, 10);
        if (isNaN(sp)) sp = 1;
        if (sp === part) slice.push(allE[ei]);
    }
    return slice;
}

// Resout un numero de page JSON (ex "08") en page InDesign.
// Priorite : nom exact → nom numerique equivalent → fallback offset.
function sommaireResolvePage(pgStr) {
    var raw = String(pgStr === null || pgStr === undefined ? "" : pgStr).replace(/^\s+|\s+$/g, "");
    if (raw === "") return null;
    // Recherche par nom exact
    try {
        for (var p = 0; p < doc.pages.length; p++) {
            if (String(doc.pages[p].name || "").replace(/^\s+|\s+$/g, "") === raw) return doc.pages[p];
        }
    } catch(e) {}
    // Recherche par valeur numerique (tolerant "02" vs "2")
    var k = parseInt(raw, 10);
    if (isNaN(k)) return null;
    try {
        for (var p2 = 0; p2 < doc.pages.length; p2++) {
            var n2 = parseInt(String(doc.pages[p2].name || ""), 10);
            if (!isNaN(n2) && n2 === k) return doc.pages[p2];
        }
    } catch(e2) {}
    // Fallback offset (pageOffset est defini au niveau module)
    var idx = k + pageOffset - 1;
    if (idx >= 0 && idx < doc.pages.length) return doc.pages[idx];
    return null;
}

// Cree ou recupere une HyperlinkPageDestination pour une page InDesign.
// Nom unique "RD_pg_<id>" pour eviter les doublons entre executions.
function sommaireGetOrCreatePageDest(targetPage) {
    if (!targetPage) return null;
    var uid = "RD_pg_";
    try { uid += String(targetPage.id); } catch(eId) { uid += "0"; }
    try {
        var d0 = doc.hyperlinkPageDestinations.itemByName(uid);
        if (d0.isValid) return d0;
    } catch(eIt) {}
    try { return doc.hyperlinkPageDestinations.add(targetPage, { name: uid }); } catch(e1) {
        try { return doc.hyperlinkPageDestinations.add(targetPage); } catch(e2) {}
    }
    return null;
}

// Retourne le style de caractere [None] pour eviter que InDesign applique
// automatiquement le style "Hyperlien" (qui ecrase couleur / graisse).
function sommaireNoneCharStyle() {
    var candidates = ["[None]", "[Aucun style de caractere]", "[Aucun style de caractère]", "None"];
    for (var i = 0; i < candidates.length; i++) {
        try {
            var s = doc.characterStyles.itemByName(candidates[i]);
            if (s.isValid) return s;
        } catch(e) {}
    }
    try { if (doc.characterStyles.length > 0) return doc.characterStyles[0]; } catch(e2) {}
    return null;
}

// Cree un hyperlien texte -> page interne sur une plage de texte.
function sommaireAddPageHyperlink(textRange, targetPage) {
    if (!textRange || !targetPage) return;
    var dest = sommaireGetOrCreatePageDest(targetPage);
    if (!dest) return;
    var src;
    try { src = doc.hyperlinkTextSources.add(textRange); } catch(eS) { return; }
    try {
        var hl = doc.hyperlinks.add(src, dest, {
            visible: false,
            highlight: HyperlinkAppearanceHighlight.NONE
        });
        // Appliquer [None] sur le lien pour ne pas ecraser la mise en forme du texte
        try {
            var noneCh = sommaireNoneCharStyle();
            if (noneCh && noneCh.isValid) hl.appliedCharacterStyle = noneCh;
        } catch(eApp) {}
    } catch(eHl) {}
}

// Supprime tous les hyperliens texte ET les HyperlinkTextSources orphelines
// dont la source est dans CE cadre (mode mono-cadre — sommaireWireTitres).
function sommaireRemoveHyperlinksOnFrame(tf) {
    if (!tf) return;
    // Etape 1 : supprimer les Hyperlink sur ce cadre
    var links = doc.hyperlinks;
    for (var h = links.length - 1; h >= 0; h--) {
        try {
            var hl  = links.item(h);
            var src = hl.source;
            if (!src) continue;
            var st = null;
            try { st = src.sourceText; } catch(eNoSt) {}
            if (!st) continue;
            var pfs = st.parentTextFrames;
            if (pfs && pfs.length > 0 && pfs[0] === tf) hl.remove();
        } catch(eH) {}
    }
    // Etape 2 : supprimer les HyperlinkTextSources orphelines sur ce cadre
    var htsList = doc.hyperlinkTextSources;
    for (var s = htsList.length - 1; s >= 0; s--) {
        try {
            var hts = htsList.item(s);
            var stHts = null;
            try { stHts = hts.sourceText; } catch(eNoSt2) {}
            if (!stHts) continue;
            var pfs2 = stHts.parentTextFrames;
            if (pfs2 && pfs2.length > 0 && pfs2[0] === tf) hts.remove();
        } catch(eH2) {}
    }
}

// Supprime tous les hyperliens texte ET les HyperlinkTextSources orphelines
// dont la source appartient a la story du cadre numeros.
// hl.remove() ne supprime pas toujours la source — si elle reste orpheline,
// doc.hyperlinkTextSources.add() echoue silencieusement sur la meme plage.
function sommaireRemoveHyperlinksOnStory(tf) {
    if (!tf) return;
    var story = null;
    try { story = tf.parentStory; } catch(e0) { return; }
    if (!story) return;
    // Etape 1 : supprimer les Hyperlink dont la source texte est dans cette story
    var links = doc.hyperlinks;
    for (var h = links.length - 1; h >= 0; h--) {
        try {
            var hl  = links.item(h);
            var src = hl.source;
            if (!src) continue;
            var st = null;
            try { st = src.sourceText; } catch(eNoSt) {}
            if (!st) continue;
            try { if (st.parentStory === story) hl.remove(); } catch(ePs) {}
        } catch(eH) {}
    }
    // Etape 2 : supprimer les HyperlinkTextSources orphelines dans cette story
    var htsList = doc.hyperlinkTextSources;
    for (var s = htsList.length - 1; s >= 0; s--) {
        try {
            var hts = htsList.item(s);
            var stHts = null;
            try { stHts = hts.sourceText; } catch(eNoSt2) {}
            if (!stHts) continue;
            try { if (stHts.parentStory === story) hts.remove(); } catch(ePs2) {}
        } catch(eH2) {}
    }
}

// Retourne le premier style paragraphe valide d'une liste de candidats.
function sommaireFirstStyle(candidates) {
    for (var i = 0; i < candidates.length; i++) {
        try {
            var s = doc.paragraphStyles.itemByName(candidates[i]);
            if (s.isValid) return s;
        } catch(e) {}
    }
    return null;
}

// Applique un style paragraphe sur un titre et strip les overrides + style caractere [None].
// Identique a sommaireApplyParagraphStyleStripOverrides dans insert-fr.jsx.
function sommaireApplyTitleStyle(paragraph, pst) {
    if (!paragraph || !pst || !pst.isValid) return;
    try {
        paragraph.appliedParagraphStyle = pst;
        if (typeof paragraph.clearOverrides === "function") {
            try { paragraph.clearOverrides(OverrideType.ALL); } catch(e) { paragraph.clearOverrides(); }
        }
        try {
            var noneCh = sommaireNoneCharStyle();
            if (noneCh && noneCh.isValid) paragraph.characters.everyItem().appliedCharacterStyle = noneCh;
        } catch(eNc) {}
    } catch(e) {}
}

function sommaireSafeStr(v) {
    return String(v === undefined || v === null ? "" : v).replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}


// Applique un style paragraphe sur un numero sans toucher au style caractere
// (clearOverrides seulement — identique a sommaireApplyNumerosParagraphOnly).
function sommaireApplyNumStyle(paragraph, pst) {
    if (!paragraph || !pst || !pst.isValid) return;
    try {
        paragraph.appliedParagraphStyle = pst;
        if (typeof paragraph.clearOverrides === "function") {
            try { paragraph.clearOverrides(OverrideType.ALL); } catch(e) { paragraph.clearOverrides(); }
        }
    } catch(e) {}
}

// Retourne true si le paragraphe est le premier de son cadre direct (pas de la story).
// Identique a sommaireParagraphStartsAtFrameTop dans insert-fr.jsx.
function sommaireParaAtFrameTop(paragraph) {
    if (!paragraph) return false;
    try {
        var pfs = paragraph.parentTextFrames;
        if (!pfs || pfs.length === 0) return false;
        var tf = pfs[0];
        var tfParas = tf.paragraphs;
        if (!tfParas || tfParas.length === 0) return false;
        return tfParas[0] === paragraph;
    } catch(e) {}
    return false;
}

// Applique spaceAfter sur un paragraphe numero absent de page.
// Utilise la detection frame-top (identique a sommaireApplyAbsentSpacing).
function sommaireAbsentSpacing(paragraph) {
    try {
        paragraph.spaceAfter = sommaireParaAtFrameTop(paragraph)
            ? SOMMAIRE_NUMEROS_ABSENT_SPACE_AFTER_TOP_PT
            : SOMMAIRE_NUMEROS_ABSENT_SPACE_AFTER_DEFAULT_PT;
    } catch(e) {}
}

// (Re-)applique les styles paragraphe sur la colonne numeros apres injection ou apres
// création des hyperliens (qui appliquent souvent le style "Hyperlien" par defaut).
// Identique a sommaireApplyNumerosStyles dans insert-fr.jsx.
function sommaireApplyNumStyles(tfNums, slice) {
    if (!tfNums || !slice || slice.length === 0) return;
    var stGeneric = sommaireFirstStyle(SOMMAIRE_NUMEROS_STYLE_CANDIDATES);
    var stVide    = sommaireFirstStyle(SOMMAIRE_NUMEROS_VIDE_STYLE_CANDIDATES);
    var stSection = sommaireFirstStyle(SOMMAIRE_NUMEROS_PAGE_SECTION_CANDIDATES);
    var stSeule   = sommaireFirstStyle(SOMMAIRE_NUMEROS_PAGE_SEULE_CANDIDATES);
    var paras = sommaireStoryParas(tfNums);
    if (!paras) return;
    for (var pn = 0; pn < paras.length && pn < slice.length; pn++) {
        var lv   = parseInt(slice[pn].level, 10);
        if (isNaN(lv)) lv = 2;
        var pg   = sommaireEntryPage(slice[pn]);
        var hasNum = pg !== "" && lv !== 0;
        var pstPick = null;
        if (!hasNum || lv === 0) {
            pstPick = stVide;
        } else if (lv === 1) {
            pstPick = stSection || stGeneric;
        } else {
            pstPick = stSeule || stGeneric;
        }
        if (pstPick) {
            sommaireApplyNumStyle(paras[pn], pstPick);
            if (lv === 0) {
                try { paras[pn].spaceBefore = sommaireSectionTitleSpaceBeforePt(pn); } catch(eSb0) {}
            }
            if (!hasNum || lv === 0) sommaireAbsentSpacing(paras[pn]);
        }
    }
}

// Compensation spaceAfter pour les numeros de page dont le titre associe est sur 2 lignes.
// Identique a sommaireApplyDualNumerosWrapSpacing dans insert-fr.jsx.
// Retourne true si le cadre numeros est la colonne 1 (label SOMMAIRE_numeros_1).
// Identique a sommaireIsNumerosColumnOne dans insert-fr.jsx.
function sommaireIsNumerosColumnOne(tfNums) {
    if (!tfNums) return false;
    try {
        var lbl = String(tfNums.label || "").replace(/^\s+|\s+$/g, "");
        if (lbl === "SOMMAIRE_numeros_1" || lbl === "SOMMAIRE-numeros-1") return true;
    } catch(eLbl) {}
    return false;
}

function sommaireTitleWrapsTwoLinesByCharCount(entryTitle, maxChars) {
    return String(entryTitle || "").length > maxChars;
}

function sommaireEntryWrapCharMax(entry, titleText) {
    var lv = entry && entry.level !== undefined && entry.level !== null ? parseInt(entry.level, 10) : NaN;
    if (!isNaN(lv) && lv === 1) return SOMMAIRE_TITLE_WRAP_CHAR_MAX_SECTION;
    var t = String(titleText || "");
    if (t.charAt(0) === "\t") return SOMMAIRE_TITLE_WRAP_CHAR_MAX_SECTION;
    return SOMMAIRE_TITLE_WRAP_CHAR_MAX_DEFAULT;
}

function sommaireEntryNeedsNumerosExtraSpacing(entry, titleText, hasNumber) {
    if (!hasNumber) return false;
    return sommaireTitleWrapsTwoLinesByCharCount(titleText, sommaireEntryWrapCharMax(entry, titleText));
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
        var pg = sommaireEntryPage(e);
        var hasNum = pg !== "";
        if (e) {
            var lv = parseInt(e.level, 10);
            if (isNaN(lv)) lv = 2;
            if (lv === 0) hasNum = false;
        }
        flags.push(sommaireEntryNeedsNumerosExtraSpacing(e, e && e.title, hasNum));
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
            try { wraps = paras[i].lines.length > 1; } catch(eL) {}
            flags.push(wraps);
        }
    } catch(eAll) {}
    return flags;
}

function sommaireResolveWrapFlags(tfTitle, sliceOrNull) {
    var charFlags = sommaireWrapFlagsFromSlice(sliceOrNull);
    var renderedFlags = sommaireWrapFlagsFromRenderedTitle(tfTitle, charFlags.length || (sliceOrNull ? sliceOrNull.length : 0));
    if (renderedFlags.length === 0) return charFlags;
    if (charFlags.length === 0) return renderedFlags;
    if (renderedFlags.length === charFlags.length) return renderedFlags;
    var n = charFlags.length > renderedFlags.length ? charFlags.length : renderedFlags.length;
    var merged = [];
    for (var i = 0; i < n; i++) {
        merged.push((i < charFlags.length && charFlags[i]) || (i < renderedFlags.length && renderedFlags[i]));
    }
    return merged;
}

function sommaireEntryIsPaginatedContentAt(sliceOrNull, idx) {
    if (!sliceOrNull || idx < 0 || idx >= sliceOrNull.length) return true;
    var e = sliceOrNull[idx];
    if (!e) return false;
    var lv = parseInt(e.level, 10);
    if (isNaN(lv)) lv = 2;
    return lv === 1 || lv === 2;
}

function sommaireSectionTitleSpaceBeforePt(indexInSlice) {
    return indexInSlice > 0 ? SOMMAIRE_SECTION_TITLE_SPACE_BEFORE_PT : 0;
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

function sommaireEntryHasNumberAt(sliceOrNull, idx) {
    if (!sliceOrNull || idx < 0 || idx >= sliceOrNull.length) return false;
    var e = sliceOrNull[idx];
    if (!e) return false;
    var lv = parseInt(e.level, 10);
    if (isNaN(lv)) lv = 2;
    if (lv === 0) return false;
    return sommaireEntryPage(e) !== "";
}

function sommaireResolveEntryLevel(sliceOrNull, idx, titlePara) {
    if (sliceOrNull && idx >= 0 && idx < sliceOrNull.length) {
        var lv = parseInt(sliceOrNull[idx].level, 10);
        if (!isNaN(lv)) return lv;
    }
    var hasNum = sommaireEntryHasNumberAt(sliceOrNull, idx);
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
    try { lines = titlePara.lines.length; } catch(eLines) {}
    if (lines < 1) lines = 1;
    try { sb = Number(titlePara.spaceBefore || 0); } catch(eSb) {}
    try { sa = Number(titlePara.spaceAfter || 0); } catch(eSa) {}
    try {
        var curLd = Number(titlePara.leading);
        if (!sommaireIsAutoLeading(curLd)) ld = curLd;
    } catch(eLd) {}
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

function sommaireSyncVerticalAlignment(tfTitle, tfNums, sliceOrNull) {
    if (!tfTitle || !tfNums || !sommaireIsNumerosColumnOne(tfNums)) return;
    var titleParas = null;
    var numParas = null;
    try { titleParas = tfTitle.paragraphs; } catch(e0) { return; }
    try { numParas = sommaireStoryParas(tfNums); } catch(e1) { return; }
    if (!titleParas || !numParas) return;
    var n = titleParas.length;
    if (numParas.length < n) n = numParas.length;

    for (var i = 0; i < n; i++) {
        var tp = titleParas[i];
        var np = numParas[i];
        var lv = sommaireResolveEntryLevel(sliceOrNull, i, tp);
        try { tp.leading = sommaireLeadingForLevel(lv); } catch(eTl) {}
        var tm = sommaireTitleBlockMetrics(tp, lv);
        var expectedNumSa = sommaireExpectedNumerosSpaceAfter(tm);
        try { np.spaceBefore = tm.spaceBefore; } catch(eNSb) {}
        try { np.leading = tm.leading; } catch(eNLd) {}
        try { np.spaceAfter = expectedNumSa; } catch(eNSa) {}
    }
}

function sommaireApplyWrapSpacing(tfNums, tfTitle, slice) {
    if (!tfNums || !slice || slice.length === 0) return;
    sommaireSyncVerticalAlignment(tfTitle, tfNums, slice);
}

// Injection stricte de la colonne numeros (1 colonne, lignes nettoyees).
// Identique a sommaireInjectNumerosStrictSimple dans insert-fr.jsx.
function sommaireInjectNumeros(tfNums, numLines) {
    if (!tfNums) return;
    sommaireDetachThread(tfNums);
    try { tfNums.textFramePreferences.textColumnCount = 1; } catch(eCol) {}
    var out = [];
    for (var i = 0; i < numLines.length; i++) {
        out.push(String(numLines[i] === null || numLines[i] === undefined ? "" : numLines[i])
            .replace(/[\r\n]+/g, "").replace(/^\s+|\s+$/g, ""));
    }
    try {
        tfNums.contents = out.join("\r");
    } catch(eSet) {
        try { tfNums.contents = ""; } catch(e0) {}
        for (var j = 0; j < out.length; j++) {
            try {
                if (j > 0) tfNums.insertionPoints[-1].contents = "\r";
                tfNums.insertionPoints[-1].contents = out[j];
            } catch(eIp) {}
        }
    }
}

// Pose les hyperliens page sur la colonne numeros (mode 2 cadres).
// Identique a sommaireWireDualFrameNumbers dans insert-fr.jsx.
function sommaireWireNumeros(tfNums, tfTitre, slice) {
    if (!tfNums || !slice || slice.length === 0) return;
    // Capturer story et paragraphes AVANT le nettoyage.
    // sommaireRemoveHyperlinksOnStory appelle hts.remove() qui peut invalider tfNums.
    // La story et ses paragraphes restent accessibles via la reference capturee.
    var story = null;
    var storyParas = null;
    try { story = tfNums.parentStory; } catch(eStory) {}
    try { storyParas = story ? story.paragraphs : null; } catch(eSp) {}
    sommaireRemoveHyperlinksOnStory(tfNums);
    for (var j = 0; j < slice.length; j++) {
        var pg = sommaireEntryPage(slice[j]);
        var lv = parseInt(slice[j].level, 10);
        if (isNaN(lv)) lv = 2;
        if (pg === "" || lv === 0) continue;
        var targetPage = sommaireResolvePage(pg);
        if (!targetPage) continue;
        if (!storyParas || j >= storyParas.length) break;
        var para = storyParas[j];
        var display = pg.replace(/^\s+|\s+$/g, "");
        // Remplir le paragraphe s'il est vide (peut arriver apres injection stricte)
        var curText = "";
        try { curText = String(para.contents || "").replace(/\r/g, "").replace(/^\s+|\s+$/g, ""); } catch(eTxt) {}
        if (curText === "") {
            try { para.contents = display; } catch(eC) { continue; }
        }
        // Creer le lien sur l'integralite du paragraphe — utiliser story deja capturee
        try {
            para = storyParas[j];
            if (para.characters.length === 0) continue;
            var st  = para.characters.item(0).index;
            var en  = para.characters.item(para.characters.length - 1).index;
            var tr  = story.characters.itemByRange(st, en);
            sommaireAddPageHyperlink(tr, targetPage);
        } catch(eR) {}
    }
    // Re-appliquer styles + wrap apres les hyperliens (qui imposent le style "Hyperlien")
    sommaireApplyNumStyles(tfNums, slice);
    sommaireApplyWrapSpacing(tfNums, tfTitre, slice);
}

// Pose les hyperliens page sur les numeros en fin de ligne (mode 1 cadre).
// Identique a sommaireWireSingleFrameNumbers dans insert-fr.jsx.
function sommaireWireTitres(tfTitle, slice) {
    if (!tfTitle || !slice || slice.length === 0) return;
    // Capturer story et paragraphes AVANT le nettoyage (hts.remove() peut invalider tfTitle).
    var story2 = null;
    var paras = null;
    try { story2 = tfTitle.parentStory; } catch(eStory2) {}
    try { paras = tfTitle.paragraphs; } catch(ePar) {}
    sommaireRemoveHyperlinksOnFrame(tfTitle);
    for (var j = 0; j < slice.length && paras && j < paras.length; j++) {
        var pg = sommaireEntryPage(slice[j]);
        var lv = parseInt(slice[j].level, 10);
        if (isNaN(lv)) lv = 2;
        if (pg === "" || lv === 0) continue;
        var targetPage = sommaireResolvePage(pg);
        if (!targetPage) continue;
        var para    = paras[j];
        var line    = String(para.contents || "");
        var display = pg.replace(/^\s+|\s+$/g, "");
        var idxTab  = line.lastIndexOf("\t");
        if (idxTab < 0) continue;
        // S'assurer que le numero affiche correspond au JSON
        var newLine = line.substring(0, idxTab + 1) + display;
        try { para.contents = newLine; } catch(eL) { continue; }
        // Creer le lien uniquement sur la partie numero (apres le dernier tab)
        // Utiliser story2 deja capturee (tfTitle potentiellement invalide apres cleanup)
        para = paras[j];
        var lineTrim = String(para.contents || "").replace(/\r$/, "");
        var numStart = idxTab + 1;
        if (numStart >= lineTrim.length) continue;
        try {
            var c0 = para.characters.item(numStart);
            var c1 = para.characters.item(lineTrim.length - 1);
            var tr = story2.characters.itemByRange(c0.index, c1.index);
            sommaireAddPageHyperlink(tr, targetPage);
        } catch(eT) {}
    }
}

// ---------------------------------------------------------------------------
// 10. injectSommaire — point d'entree (appelé depuis processPage)
//
// Portage rigoureux de injectSommaireText + sommaireWirePageNumberHyperlinksOnPage
// de insert-fr.jsx.
// ---------------------------------------------------------------------------

function injectSommaire(page, rawValue) {
    sommairePageIndex++;
    var currentPart = sommairePageIndex;

    var titreLabel   = resolveLabel("SOMMAIRE_texte_1");
    var numerosLabel = resolveLabel("SOMMAIRE_numeros_1");

    // --- Cadre titres (obligatoire) ---
    var tfTitre = null;
    var titreBlocks = findByLabel(page, titreLabel);
    for (var tb = 0; tb < titreBlocks.length; tb++) {
        if (titreBlocks[tb] instanceof TextFrame) { tfTitre = titreBlocks[tb]; break; }
    }
    if (!tfTitre) return;
    sommaireDetachThread(tfTitre);
    try { tfTitre.visible = true; } catch(eVisT) {}

    // --- Cadre numeros (optionnel — cadre le plus a droite, convention insert-fr) ---
    var tfNums = null;
    var numBlocks = findByLabel(page, numerosLabel);
    var bestX = -999999;
    for (var nb = 0; nb < numBlocks.length; nb++) {
        if (!(numBlocks[nb] instanceof TextFrame)) continue;
        var x1 = -999999;
        try { x1 = Number(numBlocks[nb].geometricBounds[1]); } catch(eGb) {}
        if (x1 > bestX) { bestX = x1; tfNums = numBlocks[nb]; }
    }
    if (tfNums) {
        sommaireDetachThread(tfNums);
        try { tfNums.visible = true; } catch(eVisN) {}
    }
    var dualMode = (tfNums !== null);

    // --- Parser le JSON ---
    var rawStr = String(rawValue).replace(/^\uFEFF/g, "").replace(/^\s+|\s+$/g, "");
    var parsed = null;
    if (rawStr.charAt(0) === "{") {
        try { parsed = JSON.parse(rawStr); } catch(eJ) {
            try { parsed = eval("(" + rawStr + ")"); } catch(eE) {}
        }
    }

    // --- Fallback legacy (texte tabule sans schema JSON) ---
    if (!parsed || !parsed.entries) {
        if (currentPart > 1) return;
        var legacyText = rawStr.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
        if (dualMode) {
            var legLines = legacyText.split("\r");
            var legTitles = [], legNums = [];
            for (var li = 0; li < legLines.length; li++) {
                var legLine = legLines[li];
                var tabIdx  = legLine.lastIndexOf("\t");
                if (tabIdx >= 0) {
                    legTitles.push(legLine.substring(0, tabIdx));
                    legNums.push(legLine.substring(tabIdx + 1).replace(/^\s+|\s+$/g, ""));
                } else {
                    legTitles.push(legLine);
                    legNums.push("");
                }
            }
            tfTitre.contents = legTitles.join("\r");
            sommaireInjectNumeros(tfNums, legNums);
            // Styles legacy : paragraphe commence par \t -> N2, sinon N1
            try {
                var styleN1 = doc.paragraphStyles.itemByName(SOMMAIRE_STYLE_N1);
                var styleN2 = doc.paragraphStyles.itemByName(SOMMAIRE_STYLE_N2);
                var lParas  = tfTitre.paragraphs;
                for (var lp = 0; lp < lParas.length; lp++) {
                    var lTxt = String(lParas[lp].contents || "");
                    if (lTxt.charAt(0) === "\t" && styleN2.isValid) sommaireApplyTitleStyle(lParas[lp], styleN2);
                    else if (styleN1.isValid) sommaireApplyTitleStyle(lParas[lp], styleN1);
                }
            } catch(eLs) {}
        } else {
            tfTitre.contents = legacyText;
            try {
                var styleN1b = doc.paragraphStyles.itemByName(SOMMAIRE_STYLE_N1);
                var styleN2b = doc.paragraphStyles.itemByName(SOMMAIRE_STYLE_N2);
                var lParasB  = tfTitre.paragraphs;
                for (var lp2 = 0; lp2 < lParasB.length; lp2++) {
                    var lTxtB = String(lParasB[lp2].contents || "");
                    if (lTxtB.charAt(0) === "\t" && styleN2b.isValid) sommaireApplyTitleStyle(lParasB[lp2], styleN2b);
                    else if (styleN1b.isValid) sommaireApplyTitleStyle(lParasB[lp2], styleN1b);
                }
            } catch(eLs2) {}
        }
        truncateOverflow(tfTitre);
        return;
    }

    // --- Slice pour cette partie du sommaire ---
    var slice = sommaireSliceForPart(parsed, currentPart);
    // Fallback : si aucune entree filtree et qu'on est sur la partie 1, tout afficher
    if (slice.length === 0 && currentPart === 1) slice = parsed.entries || [];
    if (slice.length === 0) {
        try { tfTitre.contents = ""; } catch(eCl) {}
        if (dualMode && tfNums) { try { tfNums.contents = ""; } catch(eCl2) {} }
        return;
    }

    // --- Construire les lignes ---
    var titleLines = [];
    var numLines   = [];

    for (var j = 0; j < slice.length; j++) {
        var ent   = slice[j];
        var title = String(ent.title || "");
        var pgVal = sommaireEntryPage(ent);
        var lv    = parseInt(ent.level, 10);
        if (isNaN(lv)) lv = 2;
        var hasPageNumber = (lv !== 0 && pgVal !== "");
        var forcedTitle = sommaireMaybeForceTwoLinesTitle(ent, title, hasPageNumber);

        numLines.push((lv === 0 || pgVal === "") ? "" : pgVal);

        if (dualMode) {
            // Deux cadres : pas de tab d'indentation, le style de paragraphe s'en charge.
            titleLines.push(forcedTitle);
        } else {
            // Un seul cadre : titre + tab + page en fin de ligne
            if (lv === 0 || pgVal === "") {
                titleLines.push(forcedTitle);
            } else if (lv === 1) {
                titleLines.push("\t" + forcedTitle + "\t" + pgVal);
            } else {
                titleLines.push(forcedTitle + "\t" + pgVal);
            }
        }
    }

    // --- Injecter les titres ---
    tfTitre.contents = titleLines.join("\r");
    try {
        var tParas = tfTitre.paragraphs;
        for (var tp = 0; tp < tParas.length && tp < slice.length; tp++) {
            var lv2 = parseInt(slice[tp].level, 10);
            if (isNaN(lv2)) lv2 = 2;
            var stName = SOMMAIRE_STYLE_BY_LEVEL[lv2];
            if (!stName) continue;
            var pst = doc.paragraphStyles.itemByName(stName);
            if (pst.isValid) {
                sommaireApplyTitleStyle(tParas[tp], pst);
                if (lv2 === 0) {
                    try { tParas[tp].leading = SOMMAIRE_SECTION_TITLE_LEADING_PT; } catch(eLead0) {}
                    try { tParas[tp].spaceBefore = sommaireSectionTitleSpaceBeforePt(tp); } catch(eSb0) {}
                } else if (lv2 === 1) {
                    try { tParas[tp].leading = SOMMAIRE_PAGE_SECTION_LEADING_PT; } catch(eLead1) {}
                } else if (lv2 === 2) {
                    try { tParas[tp].leading = SOMMAIRE_PAGE_UNIQUE_LEADING_PT; } catch(eLead2) {}
                }
            }
        }
    } catch(eTp) {}
    truncateOverflow(tfTitre);

    // --- Injecter les numeros (mode 2 cadres) ---
    if (dualMode) {
        sommaireInjectNumeros(tfNums, numLines);
        sommaireApplyNumStyles(tfNums, slice);
        sommaireApplyWrapSpacing(tfNums, tfTitre, slice);
        truncateOverflow(tfNums);
    }

    // --- Poser les hyperliens vers les pages internes ---
    // Identique a sommaireWirePageNumberHyperlinksOnPage dans insert-fr.jsx.
    if (dualMode) {
        sommaireWireNumeros(tfNums, tfTitre, slice);
        // Re-appliquer wrap apres hyperliens (deja fait dans sommaireWireNumeros,
        // mais on le refait ici pour etre sur — insert-fr le fait aussi)
        sommaireApplyWrapSpacing(tfNums, tfTitre, slice);
        try { truncateOverflow(tfNums); } catch(eTr0) {}
    } else {
        sommaireWireTitres(tfTitre, slice);
    }
    try { truncateOverflow(tfTitre); } catch(eTr1) {}
}

// ---------------------------------------------------------------------------
// 11. Traitement d'une page
// ---------------------------------------------------------------------------

function processPage(idPage, pageData) {
    var textContent = (pageData.content && pageData.content.text) || {};

    // --- Cas special : sommaire ---
    // SOMMAIRE_texte_1 est un JSON structure qui ne doit pas passer par injectText.
    // On le traite ici avant la boucle generale, et il reste dans SKIP_TEXT.
    var sommaireKey = null;
    if (textContent.hasOwnProperty("SOMMAIRE_texte_1")) {
        sommaireKey = "SOMMAIRE_texte_1";
    } else {
        // Recherche via le mapping (cle JSON non standard)
        for (var sk in textContent) {
            if (textContent.hasOwnProperty(sk) &&
                resolveLabel(sk) === resolveLabel("SOMMAIRE_texte_1")) {
                sommaireKey = sk;
                break;
            }
        }
    }
    if (sommaireKey !== null && textContent[sommaireKey]) {
        injectSommaire(idPage, String(textContent[sommaireKey]));
    }

    // --- Etape A : injection des textes et liens structures ---
    for (var key in textContent) {
        if (!textContent.hasOwnProperty(key)) continue;

        // Ignorer les images (ne pas toucher aux blocs image)
        if (key.indexOf("_image_") !== -1) continue;

        // Ignorer les liens Google Maps
        if (key.indexOf("_url_maps_") !== -1) continue;

        // Ignorer les champs traites separement (dont SOMMAIRE_texte_1)
        if (SKIP_TEXT[key]) continue;

        var value   = textContent[key];
        var label   = resolveLabel(key);

        if (value === null || value === undefined) continue;
        var strVal = String(value).replace(/^\s+|\s+$/, "");

        // Slots de visibilite (_card_N)
        if (key.indexOf("_card_") !== -1) {
            injectVisibility(idPage, label, strVal);
            continue;
        }

        if (strVal === "") continue;

        // Champs nom+hashtag (Inspiration)
        if (key.indexOf("_nom_hashtag_") !== -1) {
            injectNomHashtag(idPage, label, strVal);
            continue;
        }

        // Listes a puces
        if (bulletFields[key]) {
            injectBulletText(idPage, label, strVal);
            continue;
        }

        // Texte simple ou lien structure {label, url}
        injectText(idPage, label, value);
    }

    // --- Etape B : hyperliens sur cadres graphiques (FRAME_LINK_FIELDS) ---
    for (var flKey in FRAME_LINK_FIELDS) {
        if (!FRAME_LINK_FIELDS.hasOwnProperty(flKey)) continue;
        if (!textContent.hasOwnProperty(flKey)) continue;
        var flVal = textContent[flKey];
        if (flVal === null || flVal === undefined) continue;
        if (String(flVal).replace(/^\s+|\s+$/, "") === "") continue;
        var frameTarget = FRAME_LINK_FIELDS[flKey];
        var frameLabel = (typeof frameTarget === "string")
            ? resolveLabel(frameTarget)
            : resolveLabel(flKey);
        var frameOpts = null;
        if (flKey === "POI_lien_1") {
            frameOpts = {
                poiLien1: true,
                textLinkLabel: resolveLabel("POI_lien_1"),
            };
        } else if (flKey === "CLUSTER_lien_1") {
            // Cherche CLUSTER_lien_1_zone ; sinon groupe parent du TextFrame CLUSTER_lien_1.
            frameOpts = {
                textLinkLabel: resolveLabel("CLUSTER_lien_1"),
            };
        }
        injectFrameHyperlink(idPage, frameLabel, flVal, frameOpts);
    }

    // --- Etape C : hyperliens pictos articles (_url_article_*, Google Maps ignores) ---
    for (var lKey in textContent) {
        if (!textContent.hasOwnProperty(lKey)) continue;
        if (lKey.indexOf("_url_article_") === -1) continue;
        var lVal = textContent[lKey];
        if (!lVal) continue;
        var lTrim = String(lVal).replace(/^\s+|\s+$/, "");
        if (lTrim === "") continue;
        injectFrameHyperlink(idPage, resolveLabel(lKey), lVal);
    }
}

// ---------------------------------------------------------------------------
// 10. Boucle principale
// ---------------------------------------------------------------------------

var pages   = data.pages;
var updated = 0;
var skipped = 0;
var errors  = [];

for (var i = 0; i < pages.length; i++) {
    var p      = pages[i];
    var pNum   = (p.page_number !== undefined && p.page_number !== null) ? p.page_number : (i + 1);
    var tgtIdx = pNum + pageOffset - 1;

    if (tgtIdx < 0 || tgtIdx >= doc.pages.length) {
        skipped++;
        continue;
    }

    try {
        currentPageNum   = pNum;
        currentPageTitre = (p.titre || p.title || "");
        processPage(doc.pages[tgtIdx], p);
        updated++;
    } catch(eProc) {
        skipped++;
        errors.push("Page " + pNum + " : " + String(eProc));
    }
}

// ---------------------------------------------------------------------------
// 11. Rapport final
// ---------------------------------------------------------------------------

var report =
    "Injection terminee.\n\n" +
    "Pages JSON traitees : " + pages.length + "\n" +
    "Pages mises a jour  : " + updated + "\n" +
    "Pages ignorees      : " + skipped + "\n\n" +
    "Images non modifiees.\n" +
    "Liens Google Maps non modifies.";

if (errors.length > 0) {
    report += "\n\nErreurs (" + errors.length + ") :\n" + errors.slice(0, 5).join("\n");
    if (errors.length > 5) report += "\n... et " + (errors.length - 5) + " autre(s).";
}

// --- Rapport debordement texte (fichier a cote du JSON, comme insert-fr.jsx) ---
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
    } catch (eOv) {}

    report += "\n\n[!] " + overflowWarnings.length + " bloc(s) tronque(s)"
              + (overflowWritten ? " -> voir overflow-report.txt" : " (impossible d ecrire le fichier rapport)");
}

// --- TRACE DEBUG GRAS : ecriture du rapport pas-a-pas (jetable) ---
if (DEBUG_TRACE && TRACE_LINES.length > 0) {
    var traceWritten = false;
    try {
        var tf2 = new File(rootFolder + "/trace-gras-report.txt");
        tf2.encoding = "UTF-8";
        tf2.open("w");
        tf2.writeln("TRACE GRAS — " + DEBUG_TRACE_TITLE);
        tf2.writeln("====================================================");
        for (var t = 0; t < TRACE_LINES.length; t++) tf2.writeln(TRACE_LINES[t]);
        tf2.close();
        traceWritten = true;
    } catch (eTr) {}
    report += "\n\n[TRACE] " + (traceWritten
        ? "voir trace-gras-report.txt"
        : "impossible d'ecrire trace-gras-report.txt");
}

alert(report);
