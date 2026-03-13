'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { DndContext, closestCenter, DragEndEvent, DragOverEvent, PointerSensor, useSensor, useSensors, useDroppable, useDraggable, DragOverlay } from '@dnd-kit/core';
import { arrayMove, SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { nanoid } from 'nanoid';
import PageCard from './PageCard';
import PageModal from './PageModal';
import ContentEditorModal from './ContentEditorModal';
import { 
  DocumentTextIcon, 
  SparklesIcon, 
  ArrowPathIcon,
  RectangleStackIcon,
  MapPinIcon,
  LightBulbIcon,
  PlusIcon,
  TableCellsIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';

interface Page {
  _id: string;
  page_id: string;
  titre: string;
  template_id: string;
  template_name?: string;
  ordre: number;
  type_de_page?: string;
  statut_editorial?: string;
  section_id?: string;
  url_source?: string;
  image_url?: string; // Image de l'article WordPress
}

interface CheminDeFerTabProps {
  guideId: string;
  cheminDeFer: any;
  apiUrl: string;
  googleDriveFolderId?: string;
}

export default function CheminDeFerTab({ guideId, cheminDeFer, apiUrl, googleDriveFolderId }: CheminDeFerTabProps) {
  const [pages, setPages] = useState<Page[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPage, setEditingPage] = useState<Page | null>(null);
  const [showContentModal, setShowContentModal] = useState(false);
  const [editingContent, setEditingContent] = useState<any>(null);
  const [currentPageContent, setCurrentPageContent] = useState<Record<string, any>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  
  // États pour les propositions IA
  const [loadingProposal, setLoadingProposal] = useState(false);
  const [proposal, setProposal] = useState<any>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [templateProposals, setTemplateProposals] = useState<any>(null);
  const [loadingTemplateProposals, setLoadingTemplateProposals] = useState(false);

  // États pour l'ajout multiple de pages
  const [showAddPagesModal, setShowAddPagesModal] = useState(false);
  const [additionalSlots, setAdditionalSlots] = useState(0);
  // Mode grille vide : affiche la grille avec N slots même sans pages en base
  const [emptyGridMode, setEmptyGridMode] = useState(false);

  // Polling — useRef pour éviter les closures stale
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [generatingPageIds, setGeneratingPageIds] = useState<Set<string>>(new Set());
  // Compteur de séquence pour annuler les réponses loadPages obsolètes (race condition)
  const loadPagesSeqRef = useRef(0);
  
  // États pour la génération de structure
  const [generatingStructure, setGeneratingStructure] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);

  // États pour la reconstruction des inspirations
  const [rebuildingInspirations, setRebuildingInspirations] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    loadTemplates();
    loadTemplateProposals();
    // Charger les pages même si guide.chemin_de_fer n'est pas défini :
    // l'API gère elle-même le cas "CdF non créé" (404 → pages = [])
    loadPages();
  }, [guideId]);

  // ─── Helpers polling (refs → pas de closure stale) ──────────────────────
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
      console.log('✅ Polling arrêté');
    }
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
  }, []);

  const startPolling = useCallback((loadPagesFn: () => void) => {
    if (pollingRef.current) return; // déjà actif
    pollingRef.current = setInterval(() => {
      loadPagesFn();
    }, 3000);

    // Timeout de sécurité : stoppe au bout de 5 minutes
    pollingTimeoutRef.current = setTimeout(() => {
      console.warn('⏱ Polling timeout (5min) — arrêt forcé');
      stopPolling();
      loadPagesFn(); // dernier rechargement
    }, 5 * 60 * 1000);
  }, [stopPolling]);

  // Nettoyage à la destruction
  useEffect(() => () => stopPolling(), [stopPolling]);

  // 🔄 Réagir aux changements de pages pour démarrer/arrêter le polling
  useEffect(() => {
    const pagesEnGeneration = pages.filter(p => p.statut_editorial === 'en_attente');

    // Pages qui viennent de terminer (étaient en génération, ne le sont plus)
    const pagesTerminees = pages.filter(p =>
      (p.statut_editorial === 'generee_ia' || p.statut_editorial === 'non_conforme') &&
      generatingPageIds.has(p._id)
    );

    if (pagesTerminees.length > 0) {
      const ids = pagesTerminees.map(p => p._id);
      setGeneratingPageIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      const ok  = pagesTerminees.filter(p => p.statut_editorial === 'generee_ia').length;
      const nok = pagesTerminees.filter(p => p.statut_editorial === 'non_conforme').length;
      console.log(`✅ ${ok} page(s) générée(s)${nok ? `, ⚠️ ${nok} non conforme(s)` : ''}`);
    }

    if (pagesEnGeneration.length > 0) {
      // Enregistrer les IDs en génération
      setGeneratingPageIds(prev => {
        const next = new Set(prev);
        pagesEnGeneration.forEach(p => next.add(p._id));
        return next;
      });
      startPolling(loadPages);
    } else {
      // Plus rien en attente → arrêter
      if (pollingRef.current) stopPolling();
    }
  }, [pages]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTemplates = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/templates`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error('Erreur chargement templates:', err);
    }
  };

  const loadPages = async () => {
    // Incrémenter le compteur — seule la réponse du dernier appel est appliquée
    const seq = ++loadPagesSeqRef.current;
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer`, {
        credentials: 'include',
      });
      // Ignorer la réponse si un appel plus récent a déjà été lancé
      if (seq !== loadPagesSeqRef.current) return;
      if (res.ok) {
        const data = await res.json();
        const loadedPages = data.pages || [];
        const inspiPages = loadedPages.filter((p: any) => p.metadata?.page_type === 'inspiration');
        setPages(loadedPages);
        // Si des pages existent en base, quitter le mode grille vide
        if (loadedPages.length > 0) setEmptyGridMode(false);
      }
    } catch (err) {
      console.error('Erreur chargement pages:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadExistingProposal = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/sommaire-proposal`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setProposal(data.proposal);
      }
    } catch (err) {
    }
  };

  const loadTemplateProposals = async () => {
    setLoadingTemplateProposals(true);
    try {
      const token = document.cookie
        .split('; ')
        .find(row => row.startsWith('accessToken='))
        ?.split('=')[1];

      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/proposals`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        setTemplateProposals(data);
      }
    } catch (err) {
      console.error('Erreur chargement propositions:', err);
    } finally {
      setLoadingTemplateProposals(false);
    }
  };

  const generateSommaire = async () => {
    setLoadingProposal(true);
    setProposalError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/generate-sommaire`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        setProposal(data.proposal);
      } else {
        const errorData = await res.json();
        setProposalError(errorData.error || 'Erreur lors de la génération');
      }
    } catch (err) {
      console.error('Erreur génération sommaire:', err);
      setProposalError('Erreur lors de la génération du sommaire');
    } finally {
      setLoadingProposal(false);
    }
  };

  const handleGeneratePartial = async (parts: string[]) => {
    setLoadingProposal(true);
    setProposalError(null);
    try {
      const partsQuery = parts.join(',');
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/generate-sommaire?parts=${partsQuery}`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        setProposal(data.proposal);
      } else {
        const errorData = await res.json();
        setProposalError(errorData.error || 'Erreur lors de la régénération');
      }
    } catch (err) {
      console.error('Erreur régénération partielle:', err);
      setProposalError('Erreur lors de la régénération');
    } finally {
      setLoadingProposal(false);
    }
  };

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    // Extraire le numéro d'ordre si on droppe sur un emplacement vide spécifique
    let targetOrder: number | null = null;
    if (typeof over.id === 'string' && over.id.startsWith('empty-slot-')) {
      targetOrder = parseInt(over.id.replace('empty-slot-', ''), 10);
    }

    // Drag d'un template vers un emplacement spécifique ou la grille
    if (active.data.current?.type === 'template') {
      const template = active.data.current.template;
      await handleCreatePageFromTemplate(template, targetOrder);
      return;
    }

    // Drag d'une page suggérée du template vers un emplacement
    if (active.data.current?.type === 'template_page') {
      const templatePageData = active.data.current.templatePage;
      await handleCreatePageFromTemplatePage(templatePageData, targetOrder);
      return;
    }

    // Drag d'une proposition IA vers un emplacement spécifique ou la grille
    if (active.data.current?.type === 'proposal') {
      const proposalData = active.data.current;
      await handleCreatePageFromProposal(proposalData, targetOrder);
      return;
    }

    // Réorganisation des pages existantes : insertion entre deux pages
    // Décalage local uniquement — seules les pages entre la source et la cible
    // sont affectées. Les pages hors de cette plage (ex : pages inspiration à
    // des ordres élevés) conservent leur ordre et ne deviennent pas visibles.
    const activePage = pages.find((p) => p._id === active.id);
    if (activePage && over && active.id !== over.id) {
      const overPage = pages.find((p) => p._id === over.id);

      if (overPage) {
        const fromOrdre = activePage.ordre;
        const toOrdre   = overPage.ordre;

        const updatedPages = pages.map((p) => {
          if (p._id === activePage._id) {
            // La page glissée prend l'ordre de la cible
            return { ...p, ordre: toOrdre };
          }
          if (fromOrdre < toOrdre) {
            // Déplacement vers l'avant : les pages entre from+1 et to reculent d'une case
            if (p.ordre > fromOrdre && p.ordre <= toOrdre) return { ...p, ordre: p.ordre - 1 };
          } else {
            // Déplacement vers l'arrière : les pages entre to et from-1 avancent d'une case
            if (p.ordre >= toOrdre && p.ordre < fromOrdre) return { ...p, ordre: p.ordre + 1 };
          }
          return p;
        });

        setPages(updatedPages);

        // N'envoyer que les pages dont l'ordre a réellement changé
        const changedPages = updatedPages.filter((p) => {
          const original = pages.find((o) => o._id === p._id);
          return original && original.ordre !== p.ordre;
        });

        try {
          await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/reorder`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              pages: changedPages.map((p) => ({ _id: p._id, ordre: p.ordre })),
            }),
          });
        } catch (err) {
          console.error('❌ Erreur réorganisation:', err);
          loadPages();
        }
        return;
      }

      // Drop sur un emplacement vide : déplacement simple sans décalage
      if (typeof over.id === 'string' && over.id.startsWith('empty-slot-')) {
        const targetOrdre = parseInt(over.id.replace('empty-slot-', ''), 10);
        const updatedPages = pages.map((p) =>
          p._id === activePage._id ? { ...p, ordre: targetOrdre } : p
        );
        setPages(updatedPages);
        try {
          await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${activePage._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ ordre: targetOrdre }),
          });
        } catch (err) {
          console.error('❌ Erreur déplacement:', err);
          loadPages();
        }
      }
    }
  };

  const handleCreatePageFromTemplate = async (template: any, targetOrder: number | null = null) => {
    try {
      const pageData = {
        page_id: nanoid(10),
        titre: `Nouvelle page ${template.name}`,
        template_id: template._id,
        type_de_page: undefined, // ✅ undefined au lieu de ''
        statut_editorial: 'draft',
        ordre: targetOrder || pages.length + 1,
        url_source: undefined, // ✅ undefined au lieu de manquant
        commentaire_interne: undefined, // ✅ undefined au lieu de manquant
      };

      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(pageData),
      });

      if (res.ok) {
        loadPages();
      } else {
        const errorData = await res.json();
        console.error('❌ Erreur création page depuis template:', errorData);
        alert(`Erreur: ${errorData.error || 'Impossible de créer la page'}`);
      }
    } catch (err) {
      console.error('Erreur création page depuis template:', err);
      alert('Erreur lors de la création de la page');
    }
  };

  const handleCreatePageFromTemplatePage = async (templatePageData: any, targetOrder: number | null = null) => {
    try {
      if (process.env.NODE_ENV === 'development') console.log('🎯 [handleCreatePageFromTemplatePage] Données reçues:', {
        titre: templatePageData.titre,
        type: templatePageData.type,
        template_name: templatePageData.template_name,
        article_source: templatePageData.article_source,
        url_source: templatePageData.url_source,
        autres_articles_mentions: templatePageData.autres_articles_mentions,
      });

      // ── Pages inspiration : gérées par le rebuild, ne jamais créer de doublons ──
      if (templatePageData.type === 'inspiration') {
        const baseTitre = templatePageData.titre ?? '';
        const existing = (pages as any[]).find((p: any) =>
          p.metadata?.inspiration_title === baseTitre ||
          p.metadata?.inspiration_title === baseTitre.replace(/\s*\(\d+\/\d+\)$/, '') ||
          p.titre === baseTitre ||
          (p.titre ?? '').startsWith(baseTitre.replace(/\s*\(\d+\/\d+\)$/, ''))
        );
        if (existing && targetOrder) {
          // Déplacer la page existante à la position cible plutôt que créer un doublon
          await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${existing._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ ordre: targetOrder }),
          });
          loadPages();
        } else if (!existing) {
          // Pas de page existante → utiliser "Sync. inspirations" pour créer correctement
          alert(`ℹ️ La page inspiration "${baseTitre}" doit être créée via le bouton "Sync. inspirations" pour avoir ses POIs configurés correctement.`);
        }
        return;
      }

      // Trouver le template correspondant
      const template = templates.find((t) => t.name === templatePageData.template_name);
      if (!template) {
        alert(`Template "${templatePageData.template_name}" introuvable`);
        return;
      }

      // Mapper les types de pages vers des types valides du schéma backend
      const mapPageType = (type: string): string => {
        const typeMapping: Record<string, string> = {
          'fixed': 'intro',
          'cluster_intro': 'section',
          'saison': 'section',
          'inspiration': 'inspiration',
          'poi': 'poi',
        };
        return typeMapping[type] || 'section';
      };

      // Résoudre url_source pour les pages POI
      // templatePageData.url_source = slug de l'article (ex: "piscines-naturelles-el-caleton-garachico")
      // templatePageData.article_source = titre de l'article (ne pas utiliser pour le lookup slug)
      let url_source: string | undefined;
      const articleSlug = templatePageData.url_source || null;
      if (templatePageData.type === 'poi' && articleSlug) {
        try {
          const articleRes = await fetch(
            `${apiUrl}/api/v1/guides/${guideId}/articles?slug=${encodeURIComponent(articleSlug)}`,
            { credentials: 'include' }
          );
          if (articleRes.ok) {
            const articleData = await articleRes.json();
            const article = articleData.articles?.[0];
            if (article) {
              const urlsMap = article.urls_by_lang ?? article.urls ?? {};
              url_source = urlsMap['fr'] || urlsMap['en'] || article.url_francais || undefined;
            }
          }
        } catch (err) {
          console.warn('[url_source] Erreur fetch:', err);
        }
      }

      // Construire les données de la page en ne gardant que les champs définis
      const pageData: any = {
        page_id: templatePageData.page_id || nanoid(10),
        titre: templatePageData.titre,
        template_id: template._id,
        type_de_page: mapPageType(templatePageData.type),
        statut_editorial: 'draft',
        ordre: targetOrder || pages.length + 1,
        url_source: url_source || undefined,
      };

      // Ajouter section_id uniquement si section_name est défini
      if (templatePageData.section_name) {
        pageData.section_id = templatePageData.section_name;
      }


      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(pageData),
      });

      if (res.ok) {
        console.log(`✅ Page "${templatePageData.titre}" créée`);
        loadPages();
      } else {
        const errorData = await res.json();
        console.error('❌ Erreur création page depuis template:', errorData);
        console.error('📋 Données envoyées:', pageData);
        alert(`Erreur: ${errorData.error || 'Impossible de créer la page'}`);
      }
    } catch (err) {
      console.error('Erreur création page depuis template page:', err);
      alert('Erreur lors de la création de la page');
    }
  };

  const handleCreatePageFromProposal = async (proposalData: any, targetOrder: number | null = null) => {
    try {
      // Sélectionner un template par défaut (le premier disponible)
      const defaultTemplate = templates[0];
      if (!defaultTemplate) {
        alert('Aucun template disponible. Créez-en un d\'abord.');
        return;
      }

      // Récupérer l'image ET l'URL de l'article WordPress si disponible (pour les POI)
      let imageUrl: string | undefined;
      let articleUrl: string | undefined;
      if (proposalData.proposalType === 'poi' && proposalData.articleSlug) {
        try {
          const articleRes = await fetch(
            `${apiUrl}/api/v1/guides/${guideId}/articles?slug=${encodeURIComponent(proposalData.articleSlug)}`,
            { credentials: 'include' }
          );
          if (articleRes.ok) {
            const articleData = await articleRes.json();
            const article = articleData.articles?.[0];
            if (article) {
              // Récupérer l'image
              if (article.images && article.images.length > 0) {
                imageUrl = article.images[0];
                console.log(`📸 Image récupérée pour "${proposalData.title}": ${imageUrl}`);
              }
              // urls_by_lang peut être retourné sous urls_by_lang OU urls selon la version de l'API
              const urlsMap = article.urls_by_lang ?? article.urls ?? {};
              articleUrl = urlsMap['fr'] || urlsMap['en'] || article.url_francais || undefined;
              if (articleUrl) {
                console.log(`🔗 URL source récupérée pour "${proposalData.title}": ${articleUrl}`);
              } else {
                console.warn(`⚠️ Aucune URL trouvée pour "${proposalData.title}" (slug: ${proposalData.articleSlug})`);
              }
            } else {
              console.warn(`⚠️ Article introuvable pour le slug "${proposalData.articleSlug}"`);
            }
          }
        } catch (err) {
          console.warn('Impossible de récupérer les données de l\'article:', err);
        }
      }

      // Sélectionner le bon template en fonction du type de proposition
      let selectedTemplate = defaultTemplate;
      if (proposalData.proposalType === 'poi') {
        // Chercher le template POI
        const poiTemplate = templates.find((t) => 
          t.name.toLowerCase().includes('poi') || 
          t.name.toLowerCase().includes('point')
        );
        if (poiTemplate) {
          selectedTemplate = poiTemplate;
          console.log(`✅ Template POI sélectionné: ${selectedTemplate.name}`);
        }
      }

      const pageData = {
        page_id: nanoid(10),
        titre: proposalData.title,
        template_id: selectedTemplate._id, // Template POI pour les POI
        type_de_page: proposalData.proposalType === 'poi' ? 'poi' : proposalData.proposalType, // ✅ Utiliser 'poi' pour les POI (PageTypeEnum)
        statut_editorial: 'draft',
        ordre: targetOrder || pages.length + 1,
        section_id: proposalData.id,
        url_source: articleUrl || proposalData.url || undefined,
        image_url: imageUrl || undefined,
        coordinates: proposalData.coordinates || undefined, // ✅ Ajouter les coordonnées GPS
        commentaire_interne: [
          proposalData.poiType ? `Type POI: ${proposalData.poiType}` : null, // ✅ Type du POI dans commentaire
          proposalData.autresArticlesMentions && proposalData.autresArticlesMentions.length > 0
            ? `Autres mentions: ${proposalData.autresArticlesMentions.join(', ')}`
            : null,
        ].filter(Boolean).join(' | ') || undefined,
      };

      console.log('📄 Données page POI complètes:', pageData);

      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(pageData),
      });

      if (res.ok) {
        loadPages();
      } else {
        const errorData = await res.json();
        console.error('❌ Erreur création page POI:', errorData);
        console.error('📋 Détails validation:', JSON.stringify(errorData.details, null, 2));
        
        let errorMessage = `Erreur: ${errorData.error || 'Impossible de créer la page'}`;
        if (errorData.details && errorData.details.length > 0) {
          errorMessage += '\n\nDétails:\n' + errorData.details.map((d: any) => 
            `- ${d.path?.join('.') || 'unknown'}: ${d.message}`
          ).join('\n');
        }
        alert(errorMessage);
      }
    } catch (err) {
      console.error('Erreur création page depuis proposition:', err);
      alert('Erreur lors de la création de la page');
    }
  };

  // Templates qui nécessitent un article WordPress spécifique pour la génération
  // INSPIRATION utilise les articles de ses POIs associés (metadata.inspiration_pois),
  // pas d'url_source globale — ne pas bloquer la génération pour ce type.
  const TEMPLATES_REQUIRING_URL = ['POI'];

  const handleOpenContent = async (page: Page) => {
    // Pour les pages sans contenu (draft) : toujours lancer la génération directement
    const hasContent = page.statut_editorial && !['draft'].includes(page.statut_editorial);
    if (!hasContent) {
      const requiresUrl = TEMPLATES_REQUIRING_URL.some(t =>
        (page.template_name || '').toUpperCase().startsWith(t)
      );
      if (requiresUrl && !(page as any).url_source) {
        // Pas d'URL source : ouvrir le modal pour proposer la génération via base de connaissance LLM
        // (ne plus bloquer avec une alert, laisser le ContentEditorModal gérer le choix)
        setEditingContent(page);
        try {
          const res = await fetch(
            `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${page._id}/content`,
            { credentials: 'include' }
          );
          if (res.ok) {
            const data = await res.json();
            setCurrentPageContent(data.content || {});
          } else {
            setCurrentPageContent({});
          }
        } catch {
          setCurrentPageContent({});
        }
        setShowContentModal(true);
        return;
      }
      // Pour les pages inspiration : vérifier la présence des POIs associés
      const isInspirationTemplate = (page.template_name || '').toUpperCase().startsWith('INSPIRATION')
        || (page as any).metadata?.page_type === 'inspiration';
      if (isInspirationTemplate && !((page as any).metadata?.inspiration_pois?.length)) {
        alert('Aucun POI associé à cette page inspiration. Lancez d\'abord "Sync. inspirations" pour configurer les POIs.');
        return;
      }
      console.log('🚀 Lancement direct de la génération pour:', page.titre);
      await handleGeneratePageContent(page);
      return;
    }

    // Pour les pages avec contenu existant : ouvrir la modale d'édition
    setEditingContent(page);
    
    // Charger le contenu existant
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${page._id}/content`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setCurrentPageContent(data.content || {});
      } else {
        setCurrentPageContent({});
      }
    } catch (err) {
      console.error('Erreur chargement contenu:', err);
      setCurrentPageContent({});
    }
    
    setShowContentModal(true);
  };

  const handleGeneratePageContent = async (page: Page) => {
    try {
      console.log('🤖 Génération du contenu pour la page:', page.titre);
      
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${page._id}/generate-content`,
        {
          method: 'POST',
          credentials: 'include',
        }
      );

      const data = await res.json();

      if (res.ok) {
        console.log('✅ Génération lancée avec succès');
        // Recharger les pages pour afficher le statut "en_attente"
        loadPages();
      } else {
        console.error('❌ Erreur génération:', data);
        alert(`Erreur: ${data.error || 'Impossible de lancer la génération'}`);
      }
    } catch (err) {
      console.error('Erreur génération:', err);
      alert('Erreur lors du lancement de la génération');
    }
  };

  const handleSaveContent = async (content: Record<string, any>) => {
    if (!editingContent) return;

    try {
      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${editingContent._id}/content`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ content }),
        }
      );

      if (res.ok) {
        setShowContentModal(false);
        loadPages();
      }
    } catch (err) {
      console.error('Erreur sauvegarde contenu:', err);
    }
  };

  const handleEditPage = (page: any) => {
    setEditingPage(page);
    setShowModal(true);
  };

  const handleDeletePage = async (pageId: string) => {
    if (!confirm('Supprimer cette page ?')) return;

    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${pageId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        loadPages();
      }
    } catch (err) {
      console.error('Erreur suppression:', err);
    }
  };

  const handleResetPage = async (pageId: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${pageId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          statut_editorial: 'draft',
          commentaire_interne: undefined,
          content: undefined,
        }),
      });

      if (res.ok) {
        console.log('✅ Page réinitialisée');
        loadPages();
      } else {
        const errorData = await res.json();
        console.error('❌ Erreur réinitialisation:', errorData);
        alert(`Erreur: ${errorData.error || 'Impossible de réinitialiser'}`);
      }
    } catch (err) {
      console.error('Erreur réinitialisation:', err);
      alert('Erreur lors de la réinitialisation');
    }
  };

  const handleClearAllPages = async () => {
    if (pages.length === 0) {
      alert('Le chemin de fer est déjà vide.');
      return;
    }

    const confirmMessage = `⚠️ ATTENTION : Vous allez supprimer TOUTES les ${pages.length} page${pages.length !== 1 ? 's' : ''} du chemin de fer.\n\nCette action est irréversible.\n\nÊtes-vous sûr de vouloir continuer ?`;
    
    if (!confirm(confirmMessage)) return;

    // Double confirmation pour éviter les suppressions accidentelles
    const doubleConfirm = confirm(`Dernière confirmation : Supprimer définitivement les ${pages.length} page${pages.length !== 1 ? 's' : ''} ?`);
    if (!doubleConfirm) return;

    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { deleted } = await res.json();

      alert(`✅ Chemin de fer vidé avec succès (${deleted} page${deleted !== 1 ? 's' : ''} supprimée${deleted !== 1 ? 's' : ''})`);
      loadPages();
    } catch (err) {
      console.error('Erreur suppression en masse:', err);
      alert('❌ Erreur lors de la suppression des pages');
    }
  };

  const handleAddMultipleSlots = (count: number) => {
    if (count < 1 || count > 100) {
      alert('Veuillez saisir un nombre entre 1 et 100');
      return;
    }

    // Ajouter des emplacements vides à la grille
    setAdditionalSlots(prev => prev + count);
    setShowAddPagesModal(false);
  };

  const generateStructure = async () => {
    if (pages.length > 0) {
      const ok = confirm(
        `⚠️ Cette action va supprimer les ${pages.length} page(s) existante(s) et régénérer la structure complète depuis le template.\n\nContinuer ?`
      );
      if (!ok) return;
    }

    setGeneratingStructure(true);
    setStructureError(null);

    try {
      const token = document.cookie
        .split('; ')
        .find(row => row.startsWith('accessToken='))
        ?.split('=')[1];

      const res = await fetch(
        `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/generate-structure`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({}),
          credentials: 'include',
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Erreur lors de la génération');
      }

      console.log('✅ Structure générée:', data);
      
      // Recharger les pages
      await loadPages();
      
      // Afficher un message de succès
      alert(`✅ Structure générée avec succès !\n\n${data.pages_created} pages créées :\n- ${data.structure.fixed_pages} pages fixes\n- ${data.structure.cluster_pages} pages cluster\n- ${data.structure.poi_pages} pages POI\n- ${data.structure.inspiration_pages} pages inspiration\n- ${data.structure.other_pages} autres pages`);
    } catch (error: any) {
      console.error('❌ Erreur génération structure:', error);
      setStructureError(error.message || 'Erreur lors de la génération');
    } finally {
      setGeneratingStructure(false);
    }
  };

  const rebuildInspirations = async () => {
    const ok = confirm(
      '⚠️ Cette action va recalculer le nombre de pages inspiration et redistribuer les POIs selon l\'étape 4.\n\nLes pages POI, saison et fixes ne sont pas touchées.\n\nContinuer ?'
    );
    if (!ok) return;

    setRebuildingInspirations(true);
    try {
      const token = document.cookie
        .split('; ')
        .find(row => row.startsWith('accessToken='))
        ?.split('=')[1];

      const res = await fetch(
        `${apiUrl}/api/v1/workers/rebuild-inspiration-sections`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ guideId }),
          credentials: 'include',
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');

      await loadPages();
      alert(
        `✅ Pages inspiration synchronisées !\n\n` +
        `• ${data.pagesCreated} page(s) créée(s)\n` +
        `• ${data.pagesDeleted} page(s) supprimée(s)\n` +
        `• ${data.pagesUpdated} page(s) mise(s) à jour`
      );
    } catch (error: any) {
      alert(`❌ Erreur : ${error.message}`);
    } finally {
      setRebuildingInspirations(false);
    }
  };

  const startEmptyStructure = (count = 100) => {
    // Affiche N emplacements vides dans la grille.
    // Aucune page n'est créée en base — l'utilisateur glisse les templates dessus.
    setAdditionalSlots(count);
    setEmptyGridMode(true);
  };

  const handleSavePage = async (pageData: any) => {
    try {
      if (editingPage) {
        const res = await fetch(
          `${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${editingPage._id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(pageData),
          }
        );

        if (res.ok) {
          loadPages();
          setShowModal(false);
        }
      } else {
        const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            ...pageData,
            ordre: pages.length + 1,
          }),
        });

        if (res.ok) {
          loadPages();
          setShowModal(false);
        }
      }
    } catch (err) {
      console.error('Erreur sauvegarde page:', err);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Chargement...</div>;
  }

  if (!cheminDeFer) {
    return (
      <div className="text-center py-12 text-gray-500">
        Chemin de fer non disponible
      </div>
    );
  }

  return (
    <div className="flex h-full gap-0">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* COLONNE GAUCHE : Pages suggérées */}
        <div className="w-72 flex-shrink-0 bg-gradient-to-b from-gray-50 to-gray-100 border-r-2 border-gray-300 flex flex-col overflow-hidden">
          {/* Section Pages suggérées du template */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-gray-300 bg-white flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-1 bg-blue-100 rounded">
                    <DocumentTextIcon className="w-4 h-4 text-blue-600" />
                  </div>
                  <h3 className="text-xs font-bold text-gray-900">Pages suggérées</h3>
                </div>
                <button
                  onClick={loadTemplateProposals}
                  disabled={loadingTemplateProposals}
                  className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  <ArrowPathIcon className={`h-3 w-3 ${loadingTemplateProposals ? 'animate-spin' : ''}`} />
                  {loadingTemplateProposals ? 'Chargement...' : 'Actualiser'}
                </button>
              </div>
              {pages.length > 0 && (
                <button
                  onClick={rebuildInspirations}
                  disabled={rebuildingInspirations}
                  className="w-full mb-2 flex items-center justify-center gap-1.5 px-2 py-1.5 bg-orange-50 text-orange-700 text-xs font-medium rounded border border-orange-200 hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Recalcule le nombre de pages inspiration et redistribue les POIs selon l'étape 4"
                >
                  <ArrowPathIcon className={`h-3 w-3 ${rebuildingInspirations ? 'animate-spin' : ''}`} />
                  {rebuildingInspirations ? 'Sync en cours...' : '⟳ Sync. pages inspiration'}
                </button>
              )}

              {templateProposals && (
                <div className="text-xs text-gray-600">
                  📋 {templateProposals.template_name} • {templateProposals.stats?.total || 0} pages
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {!templateProposals && !loadingTemplateProposals && (
                <div className="text-center py-6">
                  <DocumentTextIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-xs text-gray-500">Aucune proposition chargée</p>
                </div>
              )}

              {loadingTemplateProposals && (
                <div className="text-center py-6">
                  <ArrowPathIcon className="w-8 h-8 text-blue-600 mx-auto mb-2 animate-spin" />
                  <p className="text-xs text-gray-500">Chargement...</p>
                </div>
              )}

              {templateProposals && (() => {
                // Ensemble des page_id déjà placés dans le chemin de fer
                const usedPageIds = new Set(pages.map((p) => p.page_id));

                return (
                <>
                  {/* Pages fixes */}
                  {templateProposals.proposals?.fixed_pages && templateProposals.proposals.fixed_pages.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <DocumentTextIcon className="w-3 h-3 text-blue-600" />
                        <h4 className="font-semibold text-gray-700 text-xs">
                          Pages fixes ({templateProposals.proposals.fixed_pages.length})
                        </h4>
                      </div>
                      <div className="space-y-1">
                        {templateProposals.proposals.fixed_pages.map((page: any) => (
                          <ProposalCardMini
                            key={page.page_id}
                            id={page.page_id}
                            type="template_page"
                            title={page.titre}
                            description={page.template_name}
                            icon={DocumentTextIcon}
                            color="blue"
                            templatePage={page}
                            isPlaced={usedPageIds.has(page.page_id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Clusters et POIs groupés */}
                  {templateProposals.proposals?.cluster_pages && templateProposals.proposals.cluster_pages.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <RectangleStackIcon className="w-3 h-3 text-green-600" />
                        <h4 className="font-semibold text-gray-700 text-xs">
                          Clusters et Lieux ({templateProposals.proposals.cluster_pages.length} clusters, {templateProposals.proposals.poi_pages?.length || 0} POIs)
                        </h4>
                      </div>
                      <div className="space-y-2">
                        {templateProposals.proposals.cluster_pages.map((clusterPage: any) => {
                          // Trouver les POIs de ce cluster
                          const clusterPois = templateProposals.proposals.poi_pages?.filter(
                            (poi: any) => poi.cluster_id === clusterPage.cluster_id
                          ) || [];
                          
                          return (
                            <div key={clusterPage.page_id} className="border border-green-200 rounded-md bg-green-50/30 p-2">
                              {/* Page cluster */}
                              <ProposalCardMini
                                id={clusterPage.page_id}
                                type="template_page"
                                title={clusterPage.titre}
                                description={`${clusterPage.poi_count} POIs`}
                                icon={RectangleStackIcon}
                                color="green"
                                templatePage={clusterPage}
                                isPlaced={usedPageIds.has(clusterPage.page_id)}
                              />
                              
                              {/* POIs du cluster */}
                              {clusterPois.length > 0 && (
                                <div className="mt-1.5 ml-3 pl-2 border-l-2 border-green-300 space-y-1">
                                  {clusterPois.map((poi: any) => (
                                    <ProposalCardMini
                                      key={poi.page_id}
                                      id={poi.page_id}
                                      type="template_page"
                                      title={poi.titre}
                                      description="POI"
                                      icon={MapPinIcon}
                                      color="green"
                                      templatePage={poi}
                                      apiUrl={apiUrl}
                                      guideId={guideId}
                                      isPlaced={usedPageIds.has(poi.page_id)}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Pages inspirations */}
                  {templateProposals.proposals?.inspiration_pages && templateProposals.proposals.inspiration_pages.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <LightBulbIcon className="w-3 h-3 text-orange-600" />
                        <h4 className="font-semibold text-gray-700 text-xs">
                          Inspirations ({templateProposals.proposals.inspiration_pages.length})
                        </h4>
                      </div>
                      <div className="space-y-1">
                        {templateProposals.proposals.inspiration_pages.map((page: any) => (
                          <ProposalCardMini
                            key={page.page_id}
                            id={page.page_id}
                            type="template_page"
                            title={page.titre}
                            description={`${page.poi_count} POIs`}
                            icon={LightBulbIcon}
                            color="orange"
                            templatePage={page}
                            isPlaced={usedPageIds.has(page.page_id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pages saisons */}
                  {templateProposals.proposals?.saison_pages && templateProposals.proposals.saison_pages.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <SparklesIcon className="w-3 h-3 text-purple-600" />
                        <h4 className="font-semibold text-gray-700 text-xs">
                          Saisons ({templateProposals.proposals.saison_pages.length})
                        </h4>
                      </div>
                      <div className="space-y-1">
                        {templateProposals.proposals.saison_pages.map((page: any) => (
                          <ProposalCardMini
                            key={page.page_id}
                            id={page.page_id}
                            type="template_page"
                            title={page.titre}
                            description={page.template_name}
                            icon={SparklesIcon}
                            color="purple"
                            templatePage={page}
                            isPlaced={usedPageIds.has(page.page_id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* ZONE PRINCIPALE : Chemin de fer - Plus d'espace */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          {/* Header compact */}
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900">Chemin de fer</h2>
                <p className="text-xs text-gray-500">
                  {pages.length} page{pages.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-gray-500">
                  💡 Glissez depuis la palette
                </div>
                {pages.length > 0 && (
                  <button
                    onClick={handleClearAllPages}
                    className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-white border border-red-300 hover:bg-red-600 rounded-md transition-colors flex items-center gap-1.5"
                    title="Vider le chemin de fer (supprimer toutes les pages)"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Vider tout
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Bande de templates rapides */}
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center gap-2 overflow-x-auto">
              {templates.length === 0 ? (
                <div className="text-xs text-gray-400 italic">Aucun template disponible</div>
              ) : (
                templates.map((template) => (
                  <QuickTemplateButton key={template._id} template={template} />
                ))
              )}
            </div>
          </div>

          {/* Grille de pages - Maximum d'espace */}
          <div className="flex-1 overflow-auto p-4">
            {pages.length === 0 && !emptyGridMode ? (
              /* État vide — deux options de démarrage */
              <div className="h-full flex items-center justify-center p-6">
                <div className="w-full max-w-3xl">
                  <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 mb-4">
                      <DocumentTextIcon className="w-8 h-8 text-purple-600" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-1">
                      Votre chemin de fer est vide
                    </h3>
                    <p className="text-gray-500 text-sm">
                      Choisissez comment démarrer votre mise en pages
                    </p>
                  </div>

                  {structureError && (
                    <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 text-center">
                      {structureError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    {/* Option 1 — Générer depuis le template */}
                    <div className="relative flex flex-col bg-white border-2 border-purple-200 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-purple-400 transition-all group">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center flex-shrink-0">
                          <SparklesIcon className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900">Depuis le template</div>
                          <div className="text-xs text-purple-600 font-medium">Recommandé</div>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 mb-5 flex-1">
                        Génère automatiquement toutes les pages du guide — pages fixes, clusters, POIs, inspirations et saisons — dans l'ordre défini par le template.
                      </p>
                      <div className="grid grid-cols-2 gap-1.5 mb-5">
                        {[
                          { color: 'blue', label: 'Pages fixes' },
                          { color: 'green', label: 'Clusters & POIs' },
                          { color: 'orange', label: 'Inspirations' },
                          { color: 'purple', label: 'Saisons' },
                        ].map(({ color, label }) => (
                          <div key={label} className="flex items-center gap-1.5">
                            <div className={`w-4 h-4 rounded-full bg-${color}-100 flex items-center justify-center flex-shrink-0`}>
                              <span className={`text-${color}-600 text-xs font-bold leading-none`}>✓</span>
                            </div>
                            <span className="text-xs text-gray-600">{label}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={generateStructure}
                        disabled={generatingStructure}
                        className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-semibold rounded-xl hover:from-purple-700 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow hover:shadow-md flex items-center justify-center gap-2"
                      >
                        {generatingStructure ? (
                          <>
                            <ArrowPathIcon className="w-4 h-4 animate-spin" />
                            Génération en cours...
                          </>
                        ) : (
                          <>
                            <SparklesIcon className="w-4 h-4" />
                            Générer la structure
                          </>
                        )}
                      </button>
                    </div>

                    {/* Option 2 — Structure vide */}
                    <div className="relative flex flex-col bg-white border-2 border-gray-200 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-gray-400 transition-all group">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:bg-gray-200 transition-colors">
                          <TableCellsIcon className="w-5 h-5 text-gray-600" />
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900">Structure vide</div>
                          <div className="text-xs text-gray-500 font-medium">Libre &amp; flexible</div>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 mb-5 flex-1">
                        Crée 100 cases vides. Glissez-déposez vos templates de pages depuis la palette pour composer votre guide librement, sans contrainte de structure.
                      </p>
                      <div className="grid grid-cols-2 gap-1.5 mb-5">
                        {[
                          { label: '100 cases vides' },
                          { label: 'Glisser-déposer' },
                          { label: 'Ordre libre' },
                          { label: 'Sans contrainte' },
                        ].map(({ label }) => (
                          <div key={label} className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                              <span className="text-gray-500 text-xs font-bold leading-none">○</span>
                            </div>
                            <span className="text-xs text-gray-600">{label}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => startEmptyStructure(100)}
                        className="w-full py-2.5 bg-white text-gray-700 text-sm font-semibold rounded-xl border-2 border-gray-300 hover:border-gray-400 hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
                      >
                        <TableCellsIcon className="w-4 h-4" />
                        Partir de 100 cases vides
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <CheminDeFerGrid
                pages={pages}
                onEdit={handleEditPage}
                onDelete={handleDeletePage}
                onOpenContent={handleOpenContent}
                onReset={handleResetPage}
                isEmpty={pages.length === 0}
                onAddPages={() => setShowAddPagesModal(true)}
                additionalSlots={additionalSlots}
              />
            )}
          </div>
        </div>

        {/* Overlay pour le drag */}
        <DragOverlay>
          {activeId ? (
            <div className="bg-white border-2 border-blue-500 rounded-lg p-3 shadow-2xl opacity-90">
              <div className="text-sm font-medium text-gray-900">Déplacement...</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Modales */}
      {showModal && (
        <PageModal
          page={editingPage}
          onClose={() => setShowModal(false)}
          onSave={handleSavePage}
          apiUrl={apiUrl}
          guideId={guideId}
        />
      )}

      {showContentModal && editingContent && (
        <ContentEditorModal
          page={editingContent}
          template={templates.find((t) => t._id === editingContent.template_id) || null}
          content={currentPageContent}
          onClose={() => setShowContentModal(false)}
          onSave={handleSaveContent}
          onGenerationStarted={loadPages} // ✅ Recharger les pages immédiatement après lancement génération
          guideId={guideId}
          apiUrl={apiUrl}
          googleDriveFolderId={googleDriveFolderId}
        />
      )}

      {showAddPagesModal && (
        <AddPagesModal
          onClose={() => setShowAddPagesModal(false)}
          onConfirm={handleAddMultipleSlots}
        />
      )}

    </div>
  );
}

// Composant Template MINI pour la palette (grille 2 colonnes)
// Composant Proposition IA MINI pour la palette
function ProposalCardMini({ id, type, title, description, icon: Icon, color, articleSlug, autresArticlesMentions, poiType, coordinates, templatePage, apiUrl, guideId, isPlaced }: any) {
  const [showOthers, setShowOthers] = useState(false);
  const [openingArticle, setOpeningArticle] = useState(false);

  const slug = articleSlug || templatePage?.url_source || null;

  const handleOpenArticle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!slug) return;
    // Si c'est déjà une URL complète
    if (slug.startsWith('http')) { window.open(slug, '_blank', 'noopener'); return; }
    setOpeningArticle(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/articles?slug=${encodeURIComponent(slug)}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const article = Array.isArray(data) ? data[0] : data.articles?.[0] ?? data;
        const url = article?.urls_by_lang?.fr || article?.urls_by_lang?.en;
        if (url) { window.open(url, '_blank', 'noopener'); }
      }
    } finally {
      setOpeningArticle(false);
    }
  };
  
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `proposal-${type}-${id}`,
    data: { 
      type: type === 'template_page' ? 'template_page' : 'proposal', 
      proposalType: type, 
      id, 
      title, 
      description, 
      articleSlug,
      autresArticlesMentions,
      poiType,
      coordinates,
      templatePage, // Données complètes de la page du template
    },
  });

  const colorClasses = {
    blue: 'border-blue-200 hover:border-blue-400 bg-blue-50/40',
    green: 'border-green-200 hover:border-green-400 bg-green-50/40',
    orange: 'border-orange-200 hover:border-orange-400 bg-orange-50/40',
    purple: 'border-purple-200 hover:border-purple-400 bg-purple-50/40',
  };

  const iconColorClasses = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    orange: 'bg-orange-100 text-orange-600',
    purple: 'bg-purple-100 text-purple-600',
  };

  const placedClass = isPlaced
    ? 'border-emerald-300 bg-emerald-50/60 opacity-70'
    : '';

  const hasOtherArticles = autresArticlesMentions && autresArticlesMentions.length > 0;

  return (
    <div className="relative">
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className={`p-1.5 border rounded cursor-grab active:cursor-grabbing transition-all ${
          isDragging ? 'opacity-50 scale-95' : ''
        } ${isPlaced ? placedClass : `bg-white ${colorClasses[color as keyof typeof colorClasses]}`}`}
      >
        <div className="flex items-center gap-1.5">
          <div className={`p-0.5 rounded flex-shrink-0 ${isPlaced ? 'bg-emerald-100 text-emerald-600' : iconColorClasses[color as keyof typeof iconColorClasses]}`}>
            <Icon className="w-3 h-3" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <h4 className={`font-medium text-xs line-clamp-1 ${isPlaced ? 'text-emerald-700' : 'text-gray-900'}`}>{title}</h4>
              {isPlaced && (
                <span className="flex-shrink-0 text-[9px] font-semibold text-emerald-600 bg-emerald-100 px-1 py-0.5 rounded-full leading-none">✓</span>
              )}
            </div>
            {description && (
              <p className={`text-xs line-clamp-1 ${isPlaced ? 'text-emerald-600/70' : 'text-gray-500'}`}>{description}</p>
            )}
            {coordinates && (
              <p className="text-[10px] text-gray-400 font-mono">
                📍 {coordinates.lat.toFixed(5)}, {coordinates.lon.toFixed(5)}
              </p>
            )}
          </div>
          {slug && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleOpenArticle}
              disabled={openingArticle}
              title="Ouvrir l'article source"
              className="flex-shrink-0 text-gray-400 hover:text-blue-600 disabled:opacity-40 transition-colors"
            >
              <ArrowTopRightOnSquareIcon className="w-3 h-3" />
            </button>
          )}
          {hasOtherArticles && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowOthers(!showOthers);
              }}
              className="flex-shrink-0 text-xs text-gray-400 hover:text-gray-600 font-medium"
              title={`${autresArticlesMentions.length} autre(s) article(s)`}
            >
              +{autresArticlesMentions.length}
            </button>
          )}
        </div>
      </div>
      
      {/* Dropdown avec les autres articles */}
      {showOthers && hasOtherArticles && (
        <div className="absolute z-50 mt-1 left-0 right-0 bg-white border border-gray-300 rounded-lg shadow-lg p-2 text-xs">
          <div className="font-medium text-gray-700 mb-1 flex items-center justify-between">
            <span>Autres articles ({autresArticlesMentions.length})</span>
            <button
              onClick={() => setShowOthers(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
          <div className="space-y-1">
            {autresArticlesMentions.map((slug: string, idx: number) => (
              <a
                key={idx}
                href={`#article-${slug}`}
                className="block text-blue-600 hover:text-blue-800 hover:underline truncate"
                title={slug}
              >
                📄 {slug}
              </a>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-gray-200 text-gray-500">
            ℹ️ L'article principal est utilisé pour l'analyse photo
          </div>
        </div>
      )}
    </div>
  );
}

// Composant pour une case vide droppable
function EmptySlot({ ordre, isGlobalOver }: { ordre: number; isGlobalOver: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `empty-slot-${ordre}`,
  });

  return (
    <div
      ref={setNodeRef}
      className={`relative bg-gray-50 rounded-lg border-2 border-dashed transition-all ${
        isOver 
          ? 'border-blue-500 bg-blue-200 scale-105' 
          : isGlobalOver
          ? 'border-blue-400 bg-blue-100'
          : 'border-gray-300 hover:border-blue-300 hover:bg-blue-50'
      }`}
      style={{ minHeight: '180px' }}
    >
      {/* Numéro de l'emplacement */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className={`text-5xl font-black leading-none ${
            isOver ? 'text-blue-600' : 'text-gray-300'
          }`}>
            {ordre}
          </div>
          <div className={`text-xs font-semibold mt-1 ${
            isOver ? 'text-blue-700' : 'text-gray-400'
          }`}>
            {isOver ? 'Placer ici' : 'Libre'}
          </div>
        </div>
      </div>
    </div>
  );
}

// Composant Droppable Grid avec cases visibles
function CheminDeFerGrid({
  pages,
  onEdit,
  onDelete,
  onOpenContent,
  onReset,
  isEmpty,
  onAddPages,
  additionalSlots,
}: {
  pages: Page[];
  onEdit: (page: Page) => void;
  onDelete: (pageId: string) => void;
  onOpenContent: (page: Page) => void;
  onReset: (pageId: string) => void;
  isEmpty: boolean;
  onAddPages: () => void;
  additionalSlots: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'chemin-de-fer-grid',
  });

  const targetSize = pages.length < 50 ? 100 : Math.min(200, pages.length + 20);
  const gridSize = Math.max(targetSize, pages.length) + additionalSlots;
  
  const slots = Array.from({ length: gridSize }, (_, i) => {
    const pageAtPosition = pages.find(p => p.ordre === i + 1);
    return pageAtPosition || { isEmpty: true, ordre: i + 1 };
  });

  return (
    <div
      ref={setNodeRef}
      className="rounded-lg border-2 border-gray-200 bg-white transition-all min-h-full"
    >
      <div className="p-3">
          <SortableContext
            items={[...pages].sort((a, b) => a.ordre - b.ordre).map((p) => p._id)}
            strategy={rectSortingStrategy}
          >
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
            {slots.map((slot: any, idx: number) => {
              const isFilledSlot = !slot.isEmpty;
              // Afficher le bouton d'insertion uniquement entre deux pages remplies consécutives,
              // ou après une page remplie si la suivante est vide/inexistante.
              // On le place comme overlay sur le bord droit de la carte.
              if (slot.isEmpty) {
                return (
                  <EmptySlot 
                    key={`empty-${slot.ordre}`} 
                    ordre={slot.ordre}
                    isGlobalOver={isOver}
                  />
                );
              } else {
                return (
                  <PageCard
                    key={slot._id}
                    page={slot}
                    onEdit={() => onEdit(slot)}
                    onDelete={() => onDelete(slot._id)}
                    onOpenContent={() => onOpenContent(slot)}
                    onReset={() => onReset(slot._id)}
                  />
                );
              }
            })}
            
            {/* Carte + pour ajouter plusieurs pages */}
            <AddPagesCard onClick={onAddPages} />
          </div>
        </SortableContext>
      </div>
    </div>
  );
}

// Composant bouton de template rapide (bande en haut du Chemin de fer)
function QuickTemplateButton({ template }: { template: any }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `quick-template-${template._id}`,
  });

  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: `template-quick-${template._id}`,
    data: {
      type: 'template',
      template: template,
    },
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  return (
    <div
      ref={setDragRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`
        flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium
        bg-white border border-gray-300 hover:border-blue-400 hover:bg-blue-50
        cursor-grab active:cursor-grabbing
        transition-all
        ${isDragging ? 'shadow-lg' : 'shadow-sm'}
      `}
      title={`Template: ${template.name || template.template_name || 'Sans nom'}`}
    >
      <div className="flex items-center gap-1.5">
        <DocumentTextIcon className="w-3.5 h-3.5 text-gray-500" />
        <span className="text-gray-700 whitespace-nowrap">
          {template.name || template.template_name || 'Sans nom'}
        </span>
      </div>
    </div>
  );
}

// Composant Carte + pour ajouter plusieurs pages
function AddPagesCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative bg-gradient-to-br from-green-50 to-green-100 rounded-lg border-2 border-dashed border-green-300 hover:border-green-500 hover:from-green-100 hover:to-green-200 transition-all cursor-pointer group"
      style={{ minHeight: '180px' }}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <div className="w-12 h-12 rounded-full bg-green-500 group-hover:bg-green-600 flex items-center justify-center transition-colors shadow-md">
          <PlusIcon className="w-7 h-7 text-white" />
        </div>
        <div className="text-sm font-semibold text-green-700 group-hover:text-green-800">
          Ajouter cases
        </div>
        <div className="text-xs text-green-600">
          Vides
        </div>
      </div>
    </button>
  );
}

// Modale pour ajouter plusieurs emplacements vides
function AddPagesModal({ 
  onClose, 
  onConfirm, 
}: { 
  onClose: () => void; 
  onConfirm: (count: number) => void; 
}) {
  const [count, setCount] = useState(20);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(count);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Ajouter des emplacements vides</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <span className="text-xl">×</span>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nombre d'emplacements à ajouter
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value) || 1)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-center text-2xl font-bold"
              required
            />
            <p className="mt-2 text-xs text-gray-500">
              Des cases vides seront ajoutées à la fin de la grille. Tu pourras ensuite y glisser des templates ou propositions IA.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="flex-1 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
            >
              <PlusIcon className="w-4 h-4" />
              Ajouter {count} case{count > 1 ? 's' : ''}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
