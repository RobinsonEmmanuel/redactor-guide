/**
 * inject-text-links-from-json.jsx
 *
 * Met a jour TEXTES et HYPERLIENS d'un document InDesign existant depuis un JSON exporte.
 * NE TOUCHE PAS aux images. NE TOUCHE PAS aux liens Google Maps (_url_maps_).
 *
 * Basé sur generate-poi-pages.jsx avec le correctif critique pour les mises a jour :
 * tf.texts.item(0) est capturé AVANT la suppression des sources existantes,
 * car src.remove() invalide la référence tf dans ExtendScript.
 *
 * Usage :
 *   Fichier > Scripts > Parcourir... -> selectionner ce fichier
 *   Choisir le JSON dans la boite de dialogue
 */

#target indesign
#include "json2.js"

var doc = app.activeDocument;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

var BOLD_STYLE_NAME        = "Gras";
var ORANGE_STYLE_NAME      = "Orange";
var CHIFFRE_STYLE_NAME     = "Chiffre";
var GRAS_ORANGE_STYLE_NAME = "Gras-orange";
var HASHTAG_PARA_STYLE_NAME  = "Hashtag";
var NOM_POI_PARA_STYLE_NAME  = "Inspiration_nom";

// Champs traites comme liste a puces (construits dynamiquement depuis data.bullet_fields)
var BULLET_LIST_FIELDS = { "POI_texte_2": true, "PRESENTATION_GUIDE_liste_sections": true };

// Champs injectes via injectFrameHyperlink (cadre graphique cliquable, pas cadre texte)
// POI_lien_1 : cadre TEXTE  -> injectText  -> injectHyperlink  (chemin normal)
// POI_lien_2 : cadre GRAPHIQUE -> injectFrameHyperlink
var FRAME_LINK_FIELDS = {
    "POI_lien_2":             true,
    "ALLER_PLUS_LOIN_lien_1": true,
    "ALLER_PLUS_LOIN_lien_2": true,
    "ALLER_PLUS_LOIN_lien_3": true,
    "ALLER_PLUS_LOIN_lien_4": true,
    "ALLER_PLUS_LOIN_lien_5": true,
    "ALLER_PLUS_LOIN_lien_6": true
};

// Champs exclus de l'étape texte (traites separement ou ignores)
var SKIP_IN_TEXT_STEP = {
    "POI_meta_duree":   true,
    "POI_meta_1":       true,
    "POI_lien_2":       true,
    "SOMMAIRE_texte_1": true
};

// Champs de type URL brute a poser sur un cadre graphique picto (_url_article_ sont des liens,
// _url_maps_ sont des Google Maps -> IGNORES comme demande)
var SKIP_URL_MAPS = true;

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function findByLabelOnPage(page, label) {
    var res = [];
    var items = page.allPageItems;
    for (var i = 0; i < items.length; i++) {
        try { if (items[i].label == label) res.push(items[i]); } catch(e) {}
    }
    return res;
}

function applyStyleMarkers(tf) {
    try {
        var story = tf.parentStory;
        var boldStyle       = doc.characterStyles.itemByName(BOLD_STYLE_NAME);
        var orangeStyle     = doc.characterStyles.itemByName(ORANGE_STYLE_NAME);
        var chiffreStyle    = doc.characterStyles.itemByName(CHIFFRE_STYLE_NAME);
        var grasOrangeStyle = doc.characterStyles.itemByName(GRAS_ORANGE_STYLE_NAME);

        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(?s)\\*\\*.+?\\*\\*";
        var boldMatches = story.findGrep();
        app.findGrepPreferences = NothingEnum.NOTHING;
        if (boldStyle.isValid) for (var m = 0; m < boldMatches.length; m++) { try { boldMatches[m].appliedCharacterStyle = boldStyle; } catch(e) {} }
        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "\\*\\*"; app.changeGrepPreferences.changeTo = "";
        story.changeGrep();

        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(?s)\\{.+?\\}";
        var orangeMatches = story.findGrep();
        app.findGrepPreferences = NothingEnum.NOTHING;
        if (orangeStyle.isValid) for (var o = 0; o < orangeMatches.length; o++) { try { orangeMatches[o].appliedCharacterStyle = orangeStyle; } catch(e) {} }
        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "[{}]"; app.changeGrepPreferences.changeTo = "";
        story.changeGrep();

        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(?s)\\^.+?\\^";
        var chiffreMatches = story.findGrep();
        app.findGrepPreferences = NothingEnum.NOTHING;
        if (chiffreStyle.isValid) for (var c = 0; c < chiffreMatches.length; c++) { try { chiffreMatches[c].appliedCharacterStyle = chiffreStyle; } catch(e) {} }
        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "\\^"; app.changeGrepPreferences.changeTo = "";
        story.changeGrep();

        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(?s)\\x7E.+?\\x7E";
        var grasOrangeMatches = story.findGrep();
        app.findGrepPreferences = NothingEnum.NOTHING;
        if (grasOrangeStyle.isValid) for (var g = 0; g < grasOrangeMatches.length; g++) { try { grasOrangeMatches[g].appliedCharacterStyle = grasOrangeStyle; } catch(e) {} }
        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "~"; app.changeGrepPreferences.changeTo = "";
        story.changeGrep();
        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
    } catch(e) {}
}

function setTextWithStyles(tf, rawText) {
    tf.contents = rawText;
    applyStyleMarkers(tf);
}

function truncateOverflow(tf) {
    try {
        if (!tf.overflows) return;
        var story    = tf.parentStory;
        var visCount = tf.characters.length;
        var total    = story.characters.length;
        if (total > visCount && visCount > 0) {
            story.characters.itemByRange(visCount, total - 1).remove();
        }
    } catch(e) {}
}

// ---------------------------------------------------------------------------
// Injection texte
// ---------------------------------------------------------------------------

function injectText(page, label, value) {
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        var isEmpty = (value === null || value === undefined ||
                       String(value).replace(/^\s+|\s+$/, "") === "");
        if (isEmpty) {
            blocks[i].visible = false;
        } else {
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

function injectBulletText(page, label, value) {
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        if (!value) { blocks[i].visible = false; continue; }
        blocks[i].visible = true;
        var tf = blocks[i];
        tf.contents = "";
        var rawLines = String(value).split("\n");
        var items = [];
        for (var l = 0; l < rawLines.length; l++) {
            var line = rawLines[l].replace(/^\s+|\s+$/, "");
            if (line !== "") items.push(line);
        }
        if (items.length === 0) { blocks[i].visible = false; continue; }
        var fullText = items.join("\r");
        tf.contents = fullText;
        var hasMarkers = fullText.indexOf("**") !== -1 || fullText.indexOf("{") !== -1 ||
                         fullText.indexOf("^")  !== -1 || fullText.indexOf("~") !== -1;
        if (hasMarkers) applyStyleMarkers(tf);
        truncateOverflow(tf);
    }
}

function injectItemVisibility(page, label, value) {
    var blocks = findByLabelOnPage(page, label);
    var show = (value !== null && value !== undefined &&
                String(value).replace(/^\s+|\s+$/, "") !== "");
    for (var i = 0; i < blocks.length; i++) {
        try { blocks[i].visible = show; } catch(e) {}
    }
}

function injectNomHashtag(page, label, value) {
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        if (!value || String(value).replace(/^\s+|\s+$/, "") === "") { blocks[i].visible = false; continue; }
        var tf = blocks[i];
        tf.visible = true;
        var strVal = String(value).replace(/\r\n/g, "\r").replace(/\n/g, "\r");
        tf.contents = strVal;
        try {
            var paras    = tf.paragraphs;
            var nomStyle  = doc.paragraphStyles.itemByName(NOM_POI_PARA_STYLE_NAME);
            var hashStyle = doc.paragraphStyles.itemByName(HASHTAG_PARA_STYLE_NAME);
            if (paras.length >= 1 && nomStyle.isValid)  paras[0].appliedParagraphStyle = nomStyle;
            if (paras.length >= 2 && hashStyle.isValid) paras[1].appliedParagraphStyle = hashStyle;
        } catch(e) {}
        var hasMarkers = strVal.indexOf("**") !== -1 || strVal.indexOf("{") !== -1 ||
                         strVal.indexOf("^")  !== -1 || strVal.indexOf("~") !== -1;
        if (hasMarkers) applyStyleMarkers(tf);
        truncateOverflow(tf);
    }
}

// ---------------------------------------------------------------------------
// Injection hyperliens texte
// Correctif par rapport a generate-poi : dans un document existant, les sources
// (HyperlinkTextSource) doivent etre supprimees avant de creer une nouvelle source
// sur la meme plage. Or src.remove() invalide la reference tf dans ExtendScript.
// Solution : capturer rangeText = tf.texts.item(0) AVANT tout nettoyage, puis
// supprimer les anciens liens/sources, puis creer la source sur rangeText.
// ---------------------------------------------------------------------------

function injectHyperlink(page, label, url) {
    if (!url || String(url).replace(/^\s+|\s+$/g, "") === "") return;
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        var tf = blocks[i];
        try { tf.visible = true; } catch(eVis) {}

        // 1. Capturer rangeText pendant que tf est encore valide
        var rangeText = null;
        try {
            if (tf.texts && tf.texts.length > 0) rangeText = tf.texts.item(0);
        } catch(eR) {}
        if (!rangeText) {
            try { rangeText = tf.parentStory.texts.item(0); } catch(eS) { continue; }
        }

        // 2. Supprimer les Hyperlinks et HyperlinkTextSources existants sur cette story
        //    (evite "L'objet est utilise par un autre hyperlien" a l'etape suivante)
        var story = null;
        try { story = rangeText.parentStory; } catch(ePs) {}
        if (story) {
            // Passe A : Hyperlinks dont la source est dans cette story
            var existingLinks = doc.hyperlinks;
            for (var h = existingLinks.length - 1; h >= 0; h--) {
                try {
                    var hl  = existingLinks.item(h);
                    var src = hl.source;
                    if (!src || !src.sourceText) continue;
                    var pStory = null;
                    try { pStory = src.sourceText.parentStory; } catch(ep) {}
                    if (pStory !== story) continue;
                    try { src.remove(); } catch(eSrcRm) {}
                    try { hl.remove();  } catch(eHlRm)  {}
                } catch(eH) {}
            }
            // Passe B : sources orphelines (source restante apres suppression du lien parent)
            var existingSources = doc.hyperlinkTextSources;
            for (var s = existingSources.length - 1; s >= 0; s--) {
                try {
                    var hts    = existingSources.item(s);
                    var pStory2 = null;
                    try { pStory2 = hts.sourceText.parentStory; } catch(ep2) {}
                    if (pStory2 === story) { try { hts.remove(); } catch(eHts) {} }
                } catch(eS2) {}
            }
        }

        // 3. Destination URL
        var dest;
        try {
            dest = doc.hyperlinkURLDestinations.add(url);
        } catch(e) {
            try { dest = doc.hyperlinkURLDestinations.itemByName(url); } catch(e2) { continue; }
        }

        // 4. Source sur rangeText capture avant le nettoyage
        var srcNew;
        try {
            srcNew = doc.hyperlinkTextSources.add(rangeText);
        } catch(eSrc) { continue; }

        // 5. Hyperlink
        try {
            doc.hyperlinks.add(srcNew, dest, {
                visible:   false,
                highlight: HyperlinkAppearanceHighlight.NONE
            });
        } catch(eHl) {}
    }
}

// ---------------------------------------------------------------------------
// Injection hyperliens cadres graphiques (POI_lien_2, ALLER_PLUS_LOIN_lien_*, _url_article_*)
// ---------------------------------------------------------------------------

function injectFrameHyperlink(page, label, value) {
    var url = null;
    if (value !== null && value !== undefined) {
        if (typeof value === "object") {
            try { if (value.url) url = String(value.url).replace(/^\s+|\s+$/g, ""); } catch(e) {}
        } else {
            var strRaw2 = String(value).replace(/^\s+|\s+$/g, "");
            if (strRaw2.charAt(0) === "{") {
                try {
                    var parsed2 = eval("(" + strRaw2 + ")");
                    if (parsed2 && parsed2.url) url = String(parsed2.url).replace(/^\s+|\s+$/g, "");
                } catch(e) {}
            } else if (strRaw2 !== "") {
                url = strRaw2;
            }
        }
    }

    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (!url) { try { block.visible = false; } catch(e) {} continue; }
        try { block.visible = true; } catch(e) {}

        // Supprimer les hyperliens page-item existants
        var existingLinks2 = doc.hyperlinks;
        for (var h = existingLinks2.length - 1; h >= 0; h--) {
            try {
                var hs = existingLinks2.item(h).source;
                if (hs && hs.sourcePageItem && hs.sourcePageItem === block) {
                    existingLinks2.item(h).remove();
                }
            } catch(e) {}
        }

        var dest2;
        try {
            dest2 = doc.hyperlinkURLDestinations.add(url);
        } catch(e) {
            try { dest2 = doc.hyperlinkURLDestinations.itemByName(url); } catch(e2) { continue; }
        }

        var src3;
        try { src3 = doc.hyperlinkPageItemSources.add(block); } catch(e) { continue; }
        try {
            doc.hyperlinks.add(src3, dest2, {
                visible:   false,
                highlight: HyperlinkAppearanceHighlight.NONE
            });
        } catch(e) {}
    }
}

// ---------------------------------------------------------------------------
// Traitement d'une page
// ---------------------------------------------------------------------------

function processPage(idPage, pageData, bulletFields) {
    var textContent = (pageData.content && pageData.content.text) || {};

    // Etape 1 : injection textes
    for (var tKey in textContent) {
        if (!textContent.hasOwnProperty(tKey)) continue;
        if (SKIP_IN_TEXT_STEP[tKey]) continue;
        // Ignorer champs images et maps
        if (tKey.indexOf("_image_") !== -1) continue;
        if (tKey.indexOf("_url_maps_") !== -1) continue;

        var tMapping = (data.mappings && data.mappings.fields && data.mappings.fields[tKey]) || tKey;
        var tVal = textContent[tKey];
        if (tVal === null || tVal === undefined) continue;
        var tStrVal = String(tVal).replace(/^\s+|\s+$/, "");

        if (tKey.indexOf("_card_") !== -1) {
            injectItemVisibility(idPage, tMapping, tStrVal);
        } else if (tStrVal === "") {
            // valeur vide : ne pas injecter
        } else if (tKey.indexOf("_nom_hashtag_") !== -1) {
            injectNomHashtag(idPage, tMapping, tStrVal);
        } else if (bulletFields[tKey]) {
            injectBulletText(idPage, tMapping, tStrVal);
        } else {
            injectText(idPage, tMapping, tStrVal);
        }
    }

    // Etape 2 : liens cadres graphiques (FRAME_LINK_FIELDS)
    for (var flKey in FRAME_LINK_FIELDS) {
        if (!FRAME_LINK_FIELDS.hasOwnProperty(flKey)) continue;
        if (!textContent.hasOwnProperty(flKey)) continue;
        var flRaw = textContent[flKey];
        if (!flRaw && flRaw !== 0) continue;
        if (String(flRaw).replace(/^\s+|\s+$/, "") === "") continue;
        var flMapping = (data.mappings && data.mappings.fields && data.mappings.fields[flKey]) || flKey;
        injectFrameHyperlink(idPage, flMapping, flRaw);
    }

    // Etape 3 : hyperliens pictos (_url_article_* seulement, _url_maps_ ignores)
    for (var lKey in textContent) {
        if (!textContent.hasOwnProperty(lKey)) continue;
        if (lKey.indexOf("_url_article_") === -1) continue;
        var lRaw = textContent[lKey];
        if (!lRaw) continue;
        var lTrim = String(lRaw).replace(/^\s+|\s+$/, "");
        if (lTrim === "") continue;
        var lMapping = (data.mappings && data.mappings.fields && data.mappings.fields[lKey]) || lKey;
        injectFrameHyperlink(idPage, lMapping, lRaw);
    }
}

// ---------------------------------------------------------------------------
// Chargement du JSON
// ---------------------------------------------------------------------------

var jsonFile = File.openDialog("Choisir le JSON a injecter");
if (!jsonFile) { alert("Annulé."); exit(); }
jsonFile.encoding = "UTF-8";
jsonFile.open("r");
var rawJson = jsonFile.read();
jsonFile.close();

rawJson = rawJson.replace(/^\uFEFF/, ""); // BOM
var data;
try { data = JSON.parse(rawJson); } catch(e) {
    alert("Erreur JSON : " + String(e));
    exit();
}

if (!data || !data.pages || !data.pages.length) {
    alert("JSON invalide ou sans pages.");
    exit();
}

// Bullet fields dynamiques
var bulletFields = {};
try {
    if (data.bullet_fields) {
        for (var bf = 0; bf < data.bullet_fields.length; bf++) {
            bulletFields[data.bullet_fields[bf]] = true;
        }
    }
} catch(eBF) {}
for (var bfFallback in BULLET_LIST_FIELDS) {
    if (BULLET_LIST_FIELDS.hasOwnProperty(bfFallback)) bulletFields[bfFallback] = true;
}

// Offset de page (optionnel : boite de dialogue)
var pageOffsetStr = prompt(
    "Offset de page (0 = page 1 JSON -> page 1 InDesign).\n" +
    "Ex : saisir 2 si la page 1 du JSON correspond a la page 3 du document.",
    "0"
);
var pageOffset = parseInt(pageOffsetStr, 10);
if (isNaN(pageOffset)) pageOffset = 0;

// ---------------------------------------------------------------------------
// Boucle principale
// ---------------------------------------------------------------------------

var updated = 0;
var skipped = 0;
var pages   = data.pages || [];

for (var i = 0; i < pages.length; i++) {
    var p      = pages[i];
    var pNum   = p.page_number || (i + 1);
    var tgtIdx = pNum + pageOffset - 1;

    if (tgtIdx < 0 || tgtIdx >= doc.pages.length) { skipped++; continue; }

    try {
        processPage(doc.pages[tgtIdx], p, bulletFields);
        updated++;
    } catch(e) {
        skipped++;
    }
}

alert(
    "Injection terminee.\n" +
    "- Pages JSON traitees : " + pages.length + "\n" +
    "- Pages mises a jour  : " + updated + "\n" +
    "- Pages ignorees      : " + skipped + "\n\n" +
    "Images non modifiees. Liens Google Maps non modifies."
);
