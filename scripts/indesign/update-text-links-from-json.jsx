#target indesign
#include "json2.js"

/**
 * update-text-links-from-json.jsx
 *
 * Met a jour un document InDesign existant depuis un JSON exporte :
 * - injecte uniquement les textes
 * - met a jour uniquement les hyperliens
 * - ne touche jamais aux images (aucun place(), aucun masquage image)
 * - ne cree/supprime aucune page
 *
 * Mapping page JSON -> page InDesign:
 *   pageIndex = page_number + offset - 1
 */

var doc = app.activeDocument;

var BOLD_STYLE_NAME        = "Gras";
var ORANGE_STYLE_NAME      = "Orange";
var CHIFFRE_STYLE_NAME     = "Chiffre";
var GRAS_ORANGE_STYLE_NAME = "Gras-orange";
var HASHTAG_PARA_STYLE_NAME = "Hashtag";
var NOM_POI_PARA_STYLE_NAME = "Inspiration_nom";

// Champs graphiques lien (cadres cliquables)
var FRAME_LINK_FIELDS = {
    "POI_lien_2":             true,
    "ALLER_PLUS_LOIN_lien_1": true,
    "ALLER_PLUS_LOIN_lien_2": true,
    "ALLER_PLUS_LOIN_lien_3": true,
    "ALLER_PLUS_LOIN_lien_4": true,
    "ALLER_PLUS_LOIN_lien_5": true,
    "ALLER_PLUS_LOIN_lien_6": true
};

// Option prudente: ne pas tronquer automatiquement en mode MAJ traduction.
var TRUNCATE_OVERFLOW = false;

function findByLabelOnPage(page, label) {
    var res = [];
    var items = page.allPageItems;
    for (var i = 0; i < items.length; i++) {
        try {
            if (items[i].label == label) res.push(items[i]);
        } catch (e) {}
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

        app.findGrepPreferences = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(?s)\\*\\*.+?\\*\\*";
        var boldMatches = story.findGrep();
        app.findGrepPreferences = NothingEnum.NOTHING;
        if (boldStyle.isValid) for (var b = 0; b < boldMatches.length; b++) { try { boldMatches[b].appliedCharacterStyle = boldStyle; } catch(e) {} }
        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "\\*\\*"; app.changeGrepPreferences.changeTo = "";
        story.changeGrep();

        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(?s)\\{.+?\\}";
        var orangeMatches = story.findGrep();
        app.findGrepPreferences = NothingEnum.NOTHING;
        if (orangeStyle.isValid) for (var o = 0; o < orangeMatches.length; o++) { try { orangeMatches[o].appliedCharacterStyle = orangeStyle; } catch(e2) {} }
        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "[{}]"; app.changeGrepPreferences.changeTo = "";
        story.changeGrep();

        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(?s)\\^.+?\\^";
        var chiffreMatches = story.findGrep();
        app.findGrepPreferences = NothingEnum.NOTHING;
        if (chiffreStyle.isValid) for (var c = 0; c < chiffreMatches.length; c++) { try { chiffreMatches[c].appliedCharacterStyle = chiffreStyle; } catch(e3) {} }
        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "\\^"; app.changeGrepPreferences.changeTo = "";
        story.changeGrep();

        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(?s)\\x7E.+?\\x7E";
        var grasOrangeMatches = story.findGrep();
        app.findGrepPreferences = NothingEnum.NOTHING;
        if (grasOrangeStyle.isValid) for (var g = 0; g < grasOrangeMatches.length; g++) { try { grasOrangeMatches[g].appliedCharacterStyle = grasOrangeStyle; } catch(e4) {} }
        app.findGrepPreferences = NothingEnum.NOTHING; app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "~"; app.changeGrepPreferences.changeTo = "";
        story.changeGrep();

        app.findGrepPreferences = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
    } catch (e) {}
}

function truncateOverflow(tf) {
    if (!TRUNCATE_OVERFLOW) return;
    try {
        if (!tf.overflows) return;
        var story = tf.parentStory;
        var visCount = tf.characters.length;
        var total = story.characters.length;
        if (total > visCount && visCount > 0) {
            story.characters.itemByRange(visCount, total - 1).remove();
        }
    } catch(e) {}
}

function injectHyperlinkOnTextFrame(tf, url) {
    if (!url || String(url).replace(/^\s+|\s+$/g, "") === "") return;
    try { tf.visible = true; } catch(e) {}

    var existingLinks = doc.hyperlinks;
    for (var h = existingLinks.length - 1; h >= 0; h--) {
        try {
            var src = existingLinks.item(h).source;
            if (src && src.sourceText && src.sourceText.parentTextFrames &&
                src.sourceText.parentTextFrames.length > 0 &&
                src.sourceText.parentTextFrames[0] === tf) {
                existingLinks.item(h).remove();
            }
        } catch(e2) {}
    }

    var dest = null;
    try { dest = doc.hyperlinkURLDestinations.add(url); }
    catch(e3) { try { dest = doc.hyperlinkURLDestinations.itemByName(url); } catch(e4) {} }
    if (!dest) return;

    try {
        var srcText = doc.hyperlinkTextSources.add(tf.parentStory.texts.item(0));
        doc.hyperlinks.add(srcText, dest, {
            visible: false,
            highlight: HyperlinkAppearanceHighlight.NONE
        });
    } catch(e5) {}
}

function injectFrameHyperlink(page, label, value) {
    var url = null;
    if (value !== null && value !== undefined) {
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

    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (!url) continue; // en mode MAJ traduction: ne pas masquer les objets

        var existingLinks = doc.hyperlinks;
        for (var h = existingLinks.length - 1; h >= 0; h--) {
            try {
                var hs = existingLinks.item(h).source;
                if (hs && hs.sourcePageItem && hs.sourcePageItem === block) {
                    existingLinks.item(h).remove();
                }
            } catch(e2) {}
        }

        var dest = null;
        try { dest = doc.hyperlinkURLDestinations.add(url); }
        catch(e3) { try { dest = doc.hyperlinkURLDestinations.itemByName(url); } catch(e4) {} }
        if (!dest) continue;

        try {
            var src = doc.hyperlinkPageItemSources.add(block);
            doc.hyperlinks.add(src, dest, {
                visible: false,
                highlight: HyperlinkAppearanceHighlight.NONE
            });
        } catch(e5) {}
    }
}

function injectText(page, label, value) {
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        if (value === null || value === undefined) continue;

        var tf = blocks[i];
        var strRaw = String(value).replace(/^\s+|\s+$/g, "");
        if (strRaw === "") continue; // ne rien faire si vide

        var linkLabel = null;
        var linkUrl = null;
        if (strRaw.charAt(0) === "{") {
            try {
                var parsed = eval("(" + strRaw + ")");
                if (parsed && parsed.label !== undefined && parsed.url !== undefined) {
                    linkLabel = String(parsed.label || "");
                    linkUrl = String(parsed.url || "");
                }
            } catch(e) {}
        }

        if (linkLabel !== null) {
            tf.contents = linkLabel;
            truncateOverflow(tf);
            if (linkUrl !== "") injectHyperlinkOnTextFrame(tf, linkUrl);
            continue;
        }

        tf.contents = "";
        var hasMarkers = strRaw.indexOf("**") !== -1 ||
                         strRaw.indexOf("{")  !== -1 ||
                         strRaw.indexOf("^")  !== -1 ||
                         strRaw.indexOf("~")  !== -1;
        if (hasMarkers) applyStyleMarkers((tf.contents = strRaw, tf));
        else tf.contents = strRaw;
        truncateOverflow(tf);
    }
}

function injectBulletText(page, label, value) {
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        if (!value) continue;
        var tf = blocks[i];
        var rawLines = String(value).split("\n");
        var items = [];
        for (var l = 0; l < rawLines.length; l++) {
            var line = rawLines[l].replace(/^\s+|\s+$/g, "");
            if (line !== "") items.push(line);
        }
        if (items.length === 0) continue;

        var fullText = items.join("\r");
        tf.contents = fullText;
        var hasMarkers = fullText.indexOf("**") !== -1 ||
                         fullText.indexOf("{")  !== -1 ||
                         fullText.indexOf("^")  !== -1 ||
                         fullText.indexOf("~")  !== -1;
        if (hasMarkers) applyStyleMarkers(tf);
        truncateOverflow(tf);
    }
}

function injectNomHashtag(page, label, value) {
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (!(blocks[i] instanceof TextFrame)) continue;
        if (value === null || value === undefined) continue;
        var strVal = String(value).replace(/^\s+|\s+$/g, "");
        if (strVal === "") continue;

        var tf = blocks[i];
        strVal = strVal.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
        tf.contents = strVal;
        try {
            var paras = tf.paragraphs;
            var nomStyle = doc.paragraphStyles.itemByName(NOM_POI_PARA_STYLE_NAME);
            var hashStyle = doc.paragraphStyles.itemByName(HASHTAG_PARA_STYLE_NAME);
            if (paras.length >= 1 && nomStyle.isValid) paras[0].appliedParagraphStyle = nomStyle;
            if (paras.length >= 2 && hashStyle.isValid) paras[1].appliedParagraphStyle = hashStyle;
        } catch(e2) {}
        truncateOverflow(tf);
    }
}

function injectItemVisibility(page, label, value) {
    var blocks = findByLabelOnPage(page, label);
    var show = (value !== null && value !== undefined && String(value).replace(/^\s+|\s+$/g, "") !== "");
    for (var i = 0; i < blocks.length; i++) {
        try { blocks[i].visible = show; } catch(e) {}
    }
}

function updatePageFromJson(page, pageData, bulletFields) {
    var textContent = (pageData.content && pageData.content.text) || {};

    for (var tKey in textContent) {
        if (!textContent.hasOwnProperty(tKey)) continue;
        var mapping = (data.mappings && data.mappings.fields && data.mappings.fields[tKey]) || tKey;
        var tVal = textContent[tKey];
        if (tKey.indexOf("_card_") !== -1) {
            injectItemVisibility(page, mapping, tVal);
        } else if (tKey.indexOf("_nom_hashtag_") !== -1) {
            injectNomHashtag(page, mapping, tVal);
        } else if (bulletFields[tKey]) {
            injectBulletText(page, mapping, tVal);
        } else {
            injectText(page, mapping, tVal);
        }
    }

    for (var flKey in FRAME_LINK_FIELDS) {
        if (!FRAME_LINK_FIELDS.hasOwnProperty(flKey)) continue;
        var flMapping = (data.mappings && data.mappings.fields && data.mappings.fields[flKey]) || flKey;
        injectFrameHyperlink(page, flMapping, textContent[flKey] || null);
    }

    for (var lKey in textContent) {
        if (!textContent.hasOwnProperty(lKey)) continue;
        if (lKey.indexOf("_url_article_") === -1 && lKey.indexOf("_url_maps_") === -1) continue;
        var lMapping = (data.mappings && data.mappings.fields && data.mappings.fields[lKey]) || lKey;
        injectFrameHyperlink(page, lMapping, textContent[lKey] || null);
    }
}

// ---- Run ----
var jsonFile = File.openDialog("Choisir le JSON (traduction) a injecter");
if (!jsonFile) exit();
jsonFile.encoding = "UTF-8";
jsonFile.open("r");
var raw = jsonFile.read();
jsonFile.close();
var data = JSON.parse(raw);

var offsetInput = prompt("Offset de pagination (JSON -> InDesign). Ex: 0", "0");
if (offsetInput === null) exit();
var pageOffset = parseInt(offsetInput, 10);
if (isNaN(pageOffset)) pageOffset = 0;

var bulletFields = {};
if (data.mappings && data.mappings.bullet_fields && data.mappings.bullet_fields.length) {
    for (var b = 0; b < data.mappings.bullet_fields.length; b++) {
        bulletFields[data.mappings.bullet_fields[b]] = true;
    }
}

var updated = 0, skipped = 0;
var pages = data.pages || [];
for (var i = 0; i < pages.length; i++) {
    var p = pages[i];
    var pNum = p.page_number || (i + 1);
    var targetIdx = pNum + pageOffset - 1;
    if (targetIdx < 0 || targetIdx >= doc.pages.length) {
        skipped++;
        continue;
    }
    try {
        updatePageFromJson(doc.pages[targetIdx], p, bulletFields);
        updated++;
    } catch(e) {
        skipped++;
    }
}

alert(
    "Mise a jour terminee.\n" +
    "- Pages JSON traitees : " + pages.length + "\n" +
    "- Pages mises a jour  : " + updated + "\n" +
    "- Pages ignorees      : " + skipped + "\n\n" +
    "Aucune image n'a ete modifiee."
);
