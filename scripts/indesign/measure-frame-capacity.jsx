/**
 * measure-frame-capacity.jsx
 * Script InDesign ExtendScript - Mesure la capacite REELLE en caracteres de
 * chaque bloc texte labelise du document, page par page.
 *
 * Strategie :
 *   On modifie directement chaque bloc avec un texte de test (3 000 'x' ou un
 *   texte personnalise), on mesure le nombre de caracteres VISIBLES, puis on
 *   appelle app.undo() pour annuler TOUTES les modifications en une seule
 *   operation. Cela garantit que la typographie reelle du bloc (police, corps,
 *   surcharges locales) est respectee — la duplication d'un cadre, elle, perd
 *   les surcharges locales et donne des resultats faux.
 *
 * Usage :
 *   Fichier > Scripts > Parcourir... -> selectionner ce fichier.
 *
 * IMPORTANT : le script appelle app.undo() a la fin. Ne pas sauvegarder le
 * document pendant l'execution (les blocs sont temporairement modifies).
 * En cas de crash, les blocs affichent le texte de test — faire Ctrl+Z.
 */

#target indesign

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

// Texte de test utilise pour remplir chaque bloc.
// Utiliser une chaine de 'x' (valeur neutre, largeur moyenne) ou remplacer
// par un texte reel pour mesurer combien de caracteres de CE texte tiennent.
// Le script n'insere QUE les premiers TEST_MAX_CHARS caracteres.
var TEST_MAX_CHARS = 3000;
var TEST_CHAR      = "x"; // remplacer par null pour utiliser TEST_TEXT_CUSTOM

// Texte personnalise (utilise si TEST_CHAR === null)
var TEST_TEXT_CUSTOM =
    "Sie haben beschlossen, ein Wochenende in Le Havre, unserer Geburts- und " +
    "Heimatstadt, zu verbringen? Wir konnen Sie dazu nur begluckwunschen, denn " +
    "diese Stadt, die auf den ersten Blick manchmal schwierig erscheint, ist so " +
    "reich und zutiefst liebenswert. " +
    "Damit Sie die Seele unserer Stadt entdecken konnen, stellen wir Ihnen in " +
    "diesem Artikel unser bevorzugtes Programm fur ein Wochenende vor. Wir fuhren " +
    "Sie von einem Appartement, das zum UNESCO-Weltkulturerbe gehort, zu einem " +
    "begrünten Fort. Wir werden Ihnen einige Varianten vorschlagen, wenn Sie die " +
    "Stadt mit Kindern besuchen. " +
    "In einem ersten Teil geben wir Ihnen einige praktische Ratschlage, um Ihre " +
    "Anreise optimal vorzubereiten und Ihr Wochenende in vollen Zugen zu geniessen.";

// Etiquettes a exclure (blocs image, lien, meta, picto — pas de texte redactionnel)
// Les labels contenant l'un de ces motifs (casse insensible) sont ignores.
var EXCLUDE_LABEL_PATTERNS = ["_image", "_picto", "_lien", "_meta"];

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
function repeatChar(ch, n) {
    var s = "";
    for (var i = 0; i < n; i++) s += ch;
    return s;
}

function isExcluded(label) {
    var lbl = label.toLowerCase();
    for (var k = 0; k < EXCLUDE_LABEL_PATTERNS.length; k++) {
        if (lbl.indexOf(EXCLUDE_LABEL_PATTERNS[k]) !== -1) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
var doc = app.activeDocument;

// --- Construire le texte de test ---
var testText;
if (TEST_CHAR !== null) {
    testText = repeatChar(TEST_CHAR, TEST_MAX_CHARS);
} else {
    testText = TEST_TEXT_CUSTOM;
}

// --- Collecter tous les blocs labelises a mesurer ---
var frameData = []; // [{pageIdx, pageNum, masterName, label, tf, currentLen, overflow}]

for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    var masterName = (page.appliedMaster && page.appliedMaster.isValid)
        ? page.appliedMaster.name : "";
    var allItems = page.allPageItems;

    for (var i = 0; i < allItems.length; i++) {
        var item = allItems[i];
        if (!(item instanceof TextFrame)) continue;
        var lbl = item.label;
        if (!lbl || lbl === "") continue;
        if (isExcluded(lbl)) continue;

        frameData.push({
            pageIdx:    p,
            pageNum:    page.name,
            masterName: masterName,
            label:      lbl,
            tf:         item,
            currentLen: item.characters.length,
            overflow:   item.overflows
        });
    }
}

if (frameData.length === 0) {
    alert("Aucun bloc texte labelise trouve dans ce document.");
    exit();
}

// --- Desactiver Smart Text Reflow et rafraichissement ecran ------------------
// Smart Text Reflow : si actif, injecter 3000 chars dans un cadre filionne
// provoque l'ajout automatique de pages par InDesign — effet "boucle infinie".
// On le desactive le temps de la mesure et on le restaure ensuite.
var origSmartReflow = doc.textPreferences.smartTextReflow;
var origRedraw      = app.scriptPreferences.enableRedraw;
doc.textPreferences.smartTextReflow = false;
app.scriptPreferences.enableRedraw  = false;

// Mesurer en modifiant directement les blocs (preserve la typo reelle).
// Toutes les modifications sont regroupees en UN SEUL undo via doScript.
// Les mesures sont stockees en memoire JS et survivent au undo.
var measurements = {}; // key: pageIdx+"_"+label, value: chars visibles (-1=erreur, -2=>test tient tout)

try {
    app.doScript(
        function() {
            for (var f = 0; f < frameData.length; f++) {
                var tf  = frameData[f].tf;
                var key = frameData[f].pageIdx + "_" + frameData[f].label;
                try {
                    // Pour les stories filonnees (cadres lies) : ne modifier QUE
                    // si ce cadre est le premier de la chaine, pour eviter de
                    // polluer les cadres suivants avec le texte de test.
                    var story      = tf.parentStory;
                    var containers = story.textContainers;
                    var isFirst    = (containers.length === 0 || containers[0] === tf);

                    if (!isFirst) {
                        // Cadre filionne non-premier : mesure depuis le cadre principal
                        measurements[key] = -3; // sentinelle "cadre lie, voir cadre principal"
                        continue;
                    }

                    // Remplacer le contenu — la typo (style + surcharges locales) est
                    // preservee car on modifie le bloc original, pas un duplicata.
                    tf.contents = testText;

                    // characters.length = chars VISIBLES dans CE cadre (avant debordement)
                    measurements[key] = tf.overflows ? tf.characters.length : -2;

                } catch(e) {
                    measurements[key] = -1;
                }
            }
        },
        undefined,
        undefined,
        UndoModes.ENTIRE_SCRIPT,
        "MesureCapaciteBlocs"
    );
} catch(err) {
    // Restaurer avant de quitter
    doc.textPreferences.smartTextReflow = origSmartReflow;
    app.scriptPreferences.enableRedraw  = origRedraw;
    alert("Erreur pendant la mesure : " + err.message + "\nAppuyez sur Ctrl+Z pour restaurer le document.");
    exit();
}

// --- Restaurer le document (annule le doScript en une operation) ---
app.undo();

// --- Reactiver Smart Text Reflow et redraw ---
doc.textPreferences.smartTextReflow = origSmartReflow;
app.scriptPreferences.enableRedraw  = origRedraw;

// --- Construire le rapport ---
var reportLines = [];
var totalFrames = 0;
var totalPages  = 0;

reportLines.push("RAPPORT DE CAPACITE DES BLOCS TEXTE INDESIGN");
reportLines.push("Document  : " + doc.name);
reportLines.push("Date      : " + new Date().toString());
reportLines.push("Pages     : " + doc.pages.length);
if (TEST_CHAR !== null) {
    reportLines.push("Texte test : " + TEST_MAX_CHARS + " x '" + TEST_CHAR + "'");
} else {
    reportLines.push("Texte test : texte personnalise (" + testText.length + " car.)");
}
reportLines.push("=".repeat ? "=".repeat(60) : "============================================================");
reportLines.push("");

var prevPageIdx = -1;

for (var f = 0; f < frameData.length; f++) {
    var fd  = frameData[f];
    var key = fd.pageIdx + "_" + fd.label;
    var cap = measurements.hasOwnProperty(key) ? measurements[key] : -1;

    // En-tete de page (a chaque changement de page)
    if (fd.pageIdx !== prevPageIdx) {
        if (prevPageIdx !== -1) reportLines.push(""); // ligne vide entre pages
        var hdr = "--- Page " + fd.pageNum;
        if (fd.masterName) hdr += "  [" + fd.masterName + "]";
        hdr += " ---";
        reportLines.push(hdr);
        prevPageIdx = fd.pageIdx;
        totalPages++;
    }

    // Formater la ligne de resultat
    var capStr, fillStr;
    if (cap === -1) {
        capStr  = "? (erreur)";
        fillStr = "";
    } else if (cap === -2) {
        var testLen = testText.length;
        capStr  = "> " + testLen;
        fillStr = "";
    } else if (cap === -3) {
        capStr  = "(cadre filionne — voir cadre principal)";
        fillStr = "";
    } else {
        capStr = String(cap);
        if (cap > 0 && fd.currentLen > 0) {
            var pct = Math.round(fd.currentLen / cap * 100);
            fillStr = "  (" + pct + "% rempli)";
        } else {
            fillStr = "";
        }
    }

    var ovfStr = fd.overflow ? "  /!\\ OVERFLOW actuel" : "";

    reportLines.push(
        "  " + fd.label +
        " : max " + capStr + " car." +
        "  |  actuel " + fd.currentLen + " car." +
        fillStr + ovfStr
    );
    totalFrames++;
}

reportLines.push("");
reportLines.push("============================================================");
reportLines.push("Pages analysees : " + totalPages);
reportLines.push("Blocs analyses  : " + totalFrames);

// --- Sauvegarder ---
var outFile = File.saveDialog(
    "Enregistrer le rapport de capacite",
    "Fichiers texte:*.txt"
);

if (outFile) {
    outFile.encoding = "UTF-8";
    outFile.open("w");
    for (var l = 0; l < reportLines.length; l++) {
        outFile.writeln(reportLines[l]);
    }
    outFile.close();
    alert(
        "Rapport genere !\n\n" +
        totalFrames + " blocs analyses sur " + doc.pages.length + " pages.\n\n" +
        outFile.fsName
    );
} else {
    var preview = "";
    var limit = Math.min(reportLines.length, 35);
    for (var ll = 0; ll < limit; ll++) preview += reportLines[ll] + "\n";
    if (reportLines.length > 35) preview += "... (" + (reportLines.length - 35) + " lignes suppl.)";
    alert(preview);
}
