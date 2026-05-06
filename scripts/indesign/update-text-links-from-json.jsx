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

// Champs graphiques lien (cadres cliquables) : hyperlien via HyperlinkPageItemSource
// (souvent plus fiable en PDF interactif que seul le fil de texte, surtout gabarits EN
// en groupe / bouton). Le texte du libellé reste géré dans injectText ; l'URL est
// appliquée ici pour éviter doublons (voir injectText + skip si jsonFieldKey ci-dessous).
var FRAME_LINK_FIELDS = {
    "POI_lien_1":             true,
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

/** page_number JSON -> Page InDesign (hyperliens sommaire, mode MAJ). */
var REDACTOR_PAGE_MAP_GLOBAL = {};

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
        // Sur story filee, parentStory.texts.item(0) = debut du fil (souvent un autre cadre) :
        // l'hyperlien ne couvre pas le bon texte / echoue en silence. Cibler le texte de CE cadre.
        var rangeText = null;
        try {
            if (tf.texts && tf.texts.length > 0) {
                rangeText = tf.texts.item(0);
            }
        } catch(eR) {}
        if (!rangeText) {
            try { rangeText = tf.parentStory.texts.item(0); } catch(eS) { return; }
        }

        var srcText = doc.hyperlinkTextSources.add(rangeText);
        doc.hyperlinks.add(srcText, dest, {
            visible: false,
            highlight: HyperlinkAppearanceHighlight.NONE
        });
    } catch(e5) {}
}

/** Retourne { label, url } si valeur = objet lien ou chaîne JSON {label,url}, sinon null. */
function parseStructuredLink(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "object") {
        try {
            if (value.label !== undefined && value.url !== undefined) {
                return {
                    label: String(value.label || ""),
                    url:   String(value.url || "").replace(/^\s+|\s+$/g, "")
                };
            }
        } catch(e) {}
        return null;
    }
    var strRaw = String(value).replace(/^\uFEFF/g, "").replace(/^\s+|\s+$/g, "");
    if (strRaw === "" || strRaw.charAt(0) !== "{") return null;
    try {
        var parsed = JSON.parse(strRaw);
        if (parsed && parsed.label !== undefined && parsed.url !== undefined) {
            return {
                label: String(parsed.label || ""),
                url:   String(parsed.url || "").replace(/^\s+|\s+$/g, "")
            };
        }
    } catch(eJ) {
        try {
            var parsedE = eval("(" + strRaw + ")");
            if (parsedE && parsedE.label !== undefined && parsedE.url !== undefined) {
                return {
                    label: String(parsedE.label || ""),
                    url:   String(parsedE.url || "").replace(/^\s+|\s+$/g, "")
                };
            }
        } catch(e) {}
    }
    return null;
}

function parseUrlFromLinkValue(value) {
    var url = null;
    if (value === null || value === undefined) return null;
    if (typeof value === "object") {
        try {
            if (value.url) url = String(value.url).replace(/^\s+|\s+$/g, "");
        } catch(e) {}
        return url;
    }
    var strRaw = String(value).replace(/^\uFEFF/g, "").replace(/^\s+|\s+$/g, "");
    if (strRaw === "") return null;
    if (strRaw.charAt(0) === "{") {
        try {
            var parsed = JSON.parse(strRaw);
            if (parsed && parsed.url) url = String(parsed.url).replace(/^\s+|\s+$/g, "");
        } catch(eJ) {
            try {
                var parsed2 = eval("(" + strRaw + ")");
                if (parsed2 && parsed2.url) url = String(parsed2.url).replace(/^\s+|\s+$/g, "");
            } catch(e) {}
        }
    } else {
        url = strRaw;
    }
    return url;
}

/** Hyperlien sur un objet page (groupe, rectangle, ovale, polygone, bouton…). */
function injectHyperlinkOnPageItem(block, url) {
    if (!url || String(url).replace(/^\s+|\s+$/g, "") === "") return;
    try { block.visible = true; } catch(e0) {}

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
    if (!dest) return;

    try {
        var src = doc.hyperlinkPageItemSources.add(block);
        doc.hyperlinks.add(src, dest, {
            visible: false,
            highlight: HyperlinkAppearanceHighlight.NONE
        });
    } catch(e5) {}
}

function injectFrameHyperlink(page, label, value) {
    var url = parseUrlFromLinkValue(value);

    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (!url) continue; // en mode MAJ traduction: ne pas masquer les objets
        injectHyperlinkOnPageItem(block, url);
    }
}

/**
 * @param {string} [jsonFieldKey] cle JSON (ex: POI_lien_1). Si presente et dans FRAME_LINK_FIELDS,
 *        on n'ajoute pas l'hyperlien ici : injectFrameHyperlink le fera (cadre / page item).
 */
function injectText(page, label, value, jsonFieldKey) {
    var deferFrameLink = jsonFieldKey && FRAME_LINK_FIELDS[jsonFieldKey];
    var blocks = findByLabelOnPage(page, label);
    for (var i = 0; i < blocks.length; i++) {
        if (value === null || value === undefined) continue;

        var blk = blocks[i];
        var strRaw = String(value).replace(/^\uFEFF/g, "").replace(/^\s+|\s+$/g, "");
        if (strRaw === "") continue; // ne rien faire si vide

        var structured = parseStructuredLink(value);
        if (!(blk instanceof TextFrame)) {
            if (structured && structured.url) {
                try { blk.visible = true; } catch(eV) {}
                try {
                    if (blk.allPageItems && blk.allPageItems.length > 0) {
                        for (var si = 0; si < blk.allPageItems.length; si++) {
                            var sub = blk.allPageItems[si];
                            if (sub instanceof TextFrame) {
                                sub.contents = structured.label || "";
                                truncateOverflow(sub);
                                break;
                            }
                        }
                    }
                } catch(eSub) {}
                if (!deferFrameLink) injectHyperlinkOnPageItem(blk, structured.url);
            }
            continue;
        }

        var tf = blk;
        var linkLabel = null;
        var linkUrl = null;
        if (structured) {
            linkLabel = structured.label;
            linkUrl = structured.url;
        }

        if (linkLabel !== null) {
            tf.contents = linkLabel;
            truncateOverflow(tf);
            if (linkUrl !== "" && !deferFrameLink) injectHyperlinkOnTextFrame(tf, linkUrl);
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

// --- Sommaire (aligne sur generate-poi-pages.jsx) -----------------------------
//
// Deux cadres optionnels : libelle titres (mapping, ex. SOMMAIRE_texte_1) + SOMMAIRE_numeros_1.
// Voir entete generate-poi-pages.jsx section 10b : styles numeros par level (section / page seule / absent).
//
var SOMMAIRE_STYLE_BY_LEVEL = {
    0: "Titre-section",
    1: "Page-section-sommaire",
    2: "Page-unique-sommaire"
};
var SOMMAIRE_STYLE_N1 = "Sommaire_niveau1";
var SOMMAIRE_STYLE_N2 = "Sommaire_niveau2";
var SOMMAIRE_NUMEROS_LABEL = "SOMMAIRE_numeros_1";
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

var SOMMAIRE_TITLE_WRAP_CHAR_MAX = 29;
var SOMMAIRE_NUMEROS_WRAP_EXTRA_SPACE_PT = 18;

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

function sommaireFirstValidParagraphStyle(names) {
    if (!names || !names.length) return null;
    for (var i = 0; i < names.length; i++) {
        var pst = doc.paragraphStyles.itemByName(names[i]);
        if (pst.isValid) return pst;
    }
    return null;
}

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
            var hasNum = String(lineVal || "").replace(/^\s+|\s+$/g, "") !== "";
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
            return { title: "\t" + parts[1], num: String(parts[parts.length - 1] || "").replace(/^\s+|\s+$/g, "") };
        }
        return { title: t, num: "" };
    }
    var idx = t.indexOf("\t");
    if (idx >= 0) {
        return {
            title: t.substring(0, idx),
            num: t.substring(idx + 1).replace(/^\s+|\s+$/g, "")
        };
    }
    return { title: t, num: "" };
}

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

/**
 * @param {string} [frameLabel] libelle du cadre titres (mapping InDesign)
 */
function injectSommaireText(page, pageData, sommaireSpreadPart, frameLabel) {
    var textContent = (pageData.content && pageData.content.text) || {};
    var rawValue = textContent["SOMMAIRE_texte_1"];
    var labelTitres = frameLabel || "SOMMAIRE_texte_1";

    if (!rawValue || String(rawValue).replace(/^\s+|\s+$/g, "") === "") return;

    var tfTitle = sommaireGetTextFrame(page, labelTitres);
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
        var rawStr = String(rawValue).replace(/^\uFEFF/g, "").replace(/^\s+|\s+$/g, "");
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
                        var haspg = pg !== null && pg !== undefined && String(pg).replace(/^\s+|\s+$/g, "") !== "";
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
                        var hasPage = pg2 !== null && pg2 !== undefined && String(pg2).replace(/^\s+|\s+$/g, "") !== "";
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

function updatePageFromJson(page, pageData, bulletFields, sommaireSpreadPart) {
    var textContent = (pageData.content && pageData.content.text) || {};

    for (var tKey in textContent) {
        if (!textContent.hasOwnProperty(tKey)) continue;
        var mapping = (data.mappings && data.mappings.fields && data.mappings.fields[tKey]) || tKey;
        var tVal = textContent[tKey];
        // Jamais injectText ici : le JSON contient des "{" qui declencheraient applyStyleMarkers (Orange).
        // Meme logique que SKIP_IN_TEXT_STEP.SOMMAIRE_texte_1 dans generate-poi-pages.jsx.
        if (tKey === "SOMMAIRE_texte_1") {
            injectSommaireText(page, pageData, sommaireSpreadPart || 1, mapping);
            continue;
        }
        if (tKey.indexOf("_card_") !== -1) {
            injectItemVisibility(page, mapping, tVal);
        } else if (tKey.indexOf("_nom_hashtag_") !== -1) {
            injectNomHashtag(page, mapping, tVal);
        } else if (bulletFields[tKey]) {
            injectBulletText(page, mapping, tVal);
        } else {
            injectText(page, mapping, tVal, tKey);
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

    if ((pageData.template || "").toUpperCase() === "SOMMAIRE") {
        sommaireFinalizeTitreAppearance(page, pageData);
        var mapTitresSommaire = (data.mappings && data.mappings.fields && data.mappings.fields["SOMMAIRE_texte_1"]) || "SOMMAIRE_texte_1";
        try {
            sommaireWirePageNumberHyperlinksOnPage(page, pageData, sommaireSpreadPart || 1, data, pageOffset, mapTitresSommaire);
        } catch (eSH) {}
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

REDACTOR_PAGE_MAP_GLOBAL = {};
sommaireMergePageMapFromOffset(data, pageOffset);

var updated = 0, skipped = 0;
var pages = data.pages || [];
var sommaireSpreadIndex = 0;
for (var i = 0; i < pages.length; i++) {
    var p = pages[i];
    var pNum = p.page_number || (i + 1);
    var targetIdx = pNum + pageOffset - 1;
    if (targetIdx < 0 || targetIdx >= doc.pages.length) {
        skipped++;
        continue;
    }
    var sommairePart = 0;
    var tpl = (p.template || "").toUpperCase();
    if (tpl === "SOMMAIRE") {
        sommaireSpreadIndex++;
        sommairePart = sommaireSpreadIndex;
    }
    try {
        updatePageFromJson(doc.pages[targetIdx], p, bulletFields, sommairePart);
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
