/**
 * measure-frame-capacity.jsx
 * Script InDesign ExtendScript - Mesure la capacite en caracteres de chaque
 * bloc texte labelise du document, page par page.
 *
 * Principe :
 *   Pour chaque TextFrame avec un label non vide, un cadre temporaire identique
 *   est cree (memes dimensions, meme style de paragraphe), rempli avec des 'x'
 *   jusqu'a debordement, puis supprime.
 *   tf.characters.length renvoie les caracteres VISIBLES dans le cadre, ce qui
 *   correspond exactement a la capacite maximale.
 *
 * Usage :
 *   Fichier > Scripts > Parcourir... -> selectionner ce fichier.
 *   A la fin, une boite de dialogue demande ou sauvegarder le rapport TXT.
 *
 * Le document InDesign doit etre ouvert. Aucune modification n'est apportee
 * au document (les cadres temporaires sont supprimes avant la fin du script).
 */

#target indesign

// ---------------------------------------------------------------------------
// Utilitaire : repeter un caractere N fois (polyfill String.repeat)
// ---------------------------------------------------------------------------
function repeatChar(ch, n) {
    var s = "";
    for (var i = 0; i < n; i++) s += ch;
    return s;
}

// ---------------------------------------------------------------------------
// Mesure la capacite d'un TextFrame en caracteres.
// Strategie : duplicate() copie le cadre avec TOUTE sa typographie reelle
// (police, corps, interligne, insets, colonnes, styles de caracteres...).
// On vide ensuite le contenu, on reapplique le style de paragraphe, on remplit
// avec des 'x', puis on lit tf.characters.length (= caracteres visibles = capacite).
// Le cadre temporaire est systematiquement supprime. Retourne -1 en cas d'erreur.
// ---------------------------------------------------------------------------
function measureCapacity(tf) {
    var tempTF = null;
    try {
        // --- Sauvegarder le style de paragraphe avant duplication
        var ps = null;
        if (tf.paragraphs.length > 0) {
            try { ps = tf.paragraphs[0].appliedParagraphStyle; } catch(e2) {}
        }

        // --- Dupliquer le cadre : copie EXACTE (dimensions, insets, colonnes,
        //     options de cadre, objet style, etc.)
        tempTF = tf.duplicate();
        tempTF.label = "__TEMP_CAP__";

        // --- Remplir d'abord avec les caracteres de test, PUIS reappliquer le
        //     style de paragraphe : l'assignation de .contents reinitialise le
        //     style au defaut du document, donc l'ordre est critique.
        var testStr = repeatChar("x", 3000);
        tempTF.contents = testStr;

        if (ps && ps.isValid) {
            tempTF.paragraphs.everyItem().appliedParagraphStyle = ps;
        }

        // --- Lire la capacite : characters.length sur le cadre = visibles seuls
        var cap = tempTF.characters.length;

        // --- Cas ou 3 000 'x' tiennent tous (petit corps ou grand cadre)
        //     -> indiquer "> 3000" plutot que retourner une valeur fausse
        if (!tempTF.overflows) {
            cap = -2; // sentinelle "> 3000" traitee a l'affichage
        }

        tempTF.remove();
        tempTF = null;
        return cap;

    } catch(e) {
        if (tempTF !== null) {
            try { tempTF.remove(); } catch(e3) {}
        }
        return -1;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
var doc = app.activeDocument;

var reportLines = [];
var totalFrames = 0;
var totalPages  = 0;

// En-tete
reportLines.push("RAPPORT DE CAPACITE DES BLOCS TEXTE INDESIGN");
reportLines.push("Document  : " + doc.name);
reportLines.push("Date      : " + new Date().toString());
reportLines.push("Pages     : " + doc.pages.length);
reportLines.push("========================================================");
reportLines.push("");

// Parcourir toutes les pages
for (var p = 0; p < doc.pages.length; p++) {
    var page        = doc.pages[p];
    var pageNum     = page.name;          // numero affiche dans InDesign
    var masterName  = "";

    if (page.appliedMaster && page.appliedMaster.isValid) {
        masterName = page.appliedMaster.name;
    }

    // Collecter tous les TextFrames labelises sur cette page
    var allItems   = page.allPageItems;
    var pageFrames = [];

    for (var i = 0; i < allItems.length; i++) {
        var item = allItems[i];
        if (!(item instanceof TextFrame)) continue;

        var lbl = item.label;
        if (!lbl || lbl === "" || lbl === "__TEMP_CAP__") continue;

        // Ignorer les cadres qui font partie d'un thread de texte filonne
        // mais ne sont pas le cadre principal (on ne mesure que le 1er cadre)
        // -- on les inclut tous : chaque cadre a sa propre capacite
        var cap         = measureCapacity(item);
        var currentLen  = item.characters.length;
        var isOverflow  = item.overflows;

        pageFrames.push({
            label:    lbl,
            capacity: cap,
            current:  currentLen,
            overflow: isOverflow
        });
        totalFrames++;
    }

    if (pageFrames.length === 0) continue;

    totalPages++;

    // Trier par label pour faciliter la lecture
    pageFrames.sort(function(a, b) {
        return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
    });

    var header = "--- Page " + pageNum;
    if (masterName) header += "  [" + masterName + "]";
    header += " ---";
    reportLines.push(header);

    for (var j = 0; j < pageFrames.length; j++) {
        var fr = pageFrames[j];

        // fr.capacity :
        //   >= 0  : nombre de caracteres 'x' mesure (police reelle)
        //   -1    : erreur
        //   -2    : > 3000 (grand cadre ou tres petit corps)
        var capStr, fillStr;
        if (fr.capacity === -1) {
            capStr  = "? (erreur)";
            fillStr = "";
        } else if (fr.capacity === -2) {
            capStr  = "> 3000";
            fillStr = "";
        } else {
            capStr  = String(fr.capacity);
            var fill = fr.capacity > 0 ? Math.round(fr.current / fr.capacity * 100) : 0;
            fillStr  = (fr.capacity > 0 && fr.current > 0) ? "  (" + fill + "% rempli)" : "";
        }

        var ovfStr = fr.overflow ? "  /!\\ OVERFLOW" : "";

        reportLines.push(
            "  " + fr.label +
            " : max " + capStr + " car." +
            "  |  actuel " + String(fr.current) + " car." +
            fillStr + ovfStr
        );
    }

    reportLines.push("");
}

// Pied de rapport
reportLines.push("========================================================");
reportLines.push("Pages avec blocs labels : " + totalPages);
reportLines.push("Total blocs analyses    : " + totalFrames);

// Sauvegarder le fichier
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
    // Si l'utilisateur annule, afficher dans une boite de dialogue
    var preview = reportLines.slice(0, 30).join("\n");
    if (reportLines.length > 30) preview += "\n... (" + (reportLines.length - 30) + " lignes supplementaires)";
    alert(preview);
}
