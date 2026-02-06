'use client';

import { useState, useEffect } from 'react';
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
}

export default function CheminDeFerTab({ guideId, cheminDeFer, apiUrl }: CheminDeFerTabProps) {
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

  // États pour l'ajout multiple de pages
  const [showAddPagesModal, setShowAddPagesModal] = useState(false);
  const [addingPages, setAddingPages] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    loadTemplates();
    loadExistingProposal();
    if (cheminDeFer) {
      loadPages();
    } else {
      setLoading(false);
    }
  }, [cheminDeFer]);

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
    try {
      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setPages(data.pages || []);
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
      console.log('Aucune proposition existante');
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

    // Drag d'une proposition IA vers un emplacement spécifique ou la grille
    if (active.data.current?.type === 'proposal') {
      const proposalData = active.data.current;
      await handleCreatePageFromProposal(proposalData, targetOrder);
      return;
    }

    // Réorganisation des pages existantes (drag d'une page vers n'importe quel slot)
    const activePage = pages.find((p) => p._id === active.id);
    if (activePage && over && active.id !== over.id) {
      let targetOrdre: number | null = null;
      
      // Cas 1 : Drop sur une autre page existante (échange)
      const targetPage = pages.find((p) => p._id === over.id);
      if (targetPage) {
        targetOrdre = targetPage.ordre;
        console.log(`🔄 Échange page ${activePage.ordre} ↔️ page ${targetOrdre}`);
        
        // Échanger les ordres
        const updatedPages = pages.map((p) => {
          if (p._id === activePage._id) return { ...p, ordre: targetOrdre! };
          if (p._id === targetPage._id) return { ...p, ordre: activePage.ordre };
          return p;
        });

        setPages(updatedPages);

        // Sauvegarder
        try {
          await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/reorder`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              pages: updatedPages.map((p) => ({ _id: p._id, ordre: p.ordre })),
            }),
          });
          console.log('✅ Échange sauvegardé');
        } catch (err) {
          console.error('❌ Erreur échange:', err);
          loadPages();
        }
        return;
      }
      
      // Cas 2 : Drop sur un emplacement vide (déplacement libre)
      if (typeof over.id === 'string' && over.id.startsWith('empty-slot-')) {
        targetOrdre = parseInt(over.id.replace('empty-slot-', ''), 10);
        console.log(`🔄 Déplacement page ${activePage.ordre} → position ${targetOrdre}`);
        
        // Simplement changer l'ordre de cette page
        const updatedPages = pages.map((p) => {
          if (p._id === activePage._id) return { ...p, ordre: targetOrdre! };
          return p;
        });

        setPages(updatedPages);

        // Sauvegarder
        try {
          await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/${activePage._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ ordre: targetOrdre }),
          });
          console.log(`✅ Page déplacée vers position ${targetOrdre}`);
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
        type_de_page: '',
        statut_editorial: 'draft',
        ordre: targetOrder || pages.length + 1,
      };

      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(pageData),
      });

      if (res.ok) {
        loadPages();
      }
    } catch (err) {
      console.error('Erreur création page depuis template:', err);
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

      // Récupérer l'image de l'article WordPress si disponible (pour les POI)
      let imageUrl: string | undefined;
      if (proposalData.proposalType === 'poi' && proposalData.articleSlug) {
        try {
          const articleRes = await fetch(
            `${apiUrl}/api/v1/guides/${guideId}/articles?slug=${proposalData.articleSlug}`,
            { credentials: 'include' }
          );
          if (articleRes.ok) {
            const articleData = await articleRes.json();
            const article = articleData.articles?.[0];
            if (article && article.images && article.images.length > 0) {
              imageUrl = article.images[0]; // Première image de l'article
              console.log(`📸 Image récupérée pour "${proposalData.title}": ${imageUrl}`);
            }
          }
        } catch (err) {
          console.warn('Impossible de récupérer l\'image de l\'article:', err);
        }
      }

      const pageData = {
        page_id: nanoid(10),
        titre: proposalData.title,
        template_id: defaultTemplate._id,
        type_de_page: proposalData.proposalType || '',
        statut_editorial: 'draft',
        ordre: targetOrder || pages.length + 1,
        section_id: proposalData.id,
        url_source: proposalData.url,
        image_url: imageUrl, // Image de l'article WordPress
      };

      const res = await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(pageData),
      });

      if (res.ok) {
        loadPages();
      }
    } catch (err) {
      console.error('Erreur création page depuis proposition:', err);
    }
  };

  const handleOpenContent = async (page: Page) => {
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

  const handleEditPage = (page: Page) => {
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
        {/* COLONNE GAUCHE : Palette unifiée compacte */}
        <div className="w-72 flex-shrink-0 bg-gradient-to-b from-gray-50 to-gray-100 border-r-2 border-gray-300 flex flex-col overflow-hidden">
          {/* Section Templates - Plus compacte */}
          <div className="flex-shrink-0 border-b border-gray-300 bg-white">
            <div className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1 bg-blue-100 rounded">
                  <DocumentTextIcon className="w-4 h-4 text-blue-600" />
                </div>
                <h3 className="text-xs font-bold text-gray-900">Templates</h3>
              </div>
              
              <div className="grid grid-cols-2 gap-1.5">
                {templates.length === 0 && (
                  <div className="col-span-2 text-center py-4 px-2">
                    <div className="text-gray-400 mb-1 text-xl">📝</div>
                    <div className="text-xs text-gray-500">Aucun template</div>
                  </div>
                )}
                {templates.map((template) => (
                  <TemplatePaletteItemMini key={template._id} template={template} />
                ))}
              </div>
            </div>
          </div>

          {/* Section Propositions IA - Plus compacte */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-gray-300 bg-white flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-1 bg-purple-100 rounded">
                    <SparklesIcon className="w-4 h-4 text-purple-600" />
                  </div>
                  <h3 className="text-xs font-bold text-gray-900">Propositions IA</h3>
                </div>
                <button
                  onClick={generateSommaire}
                  disabled={loadingProposal}
                  className="flex items-center gap-1 px-2 py-1 bg-purple-600 text-white text-xs font-medium rounded hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  <ArrowPathIcon className={`h-3 w-3 ${loadingProposal ? 'animate-spin' : ''}`} />
                  {loadingProposal ? 'Génération...' : 'Générer'}
                </button>
              </div>

              {proposalError && (
                <div className="mt-1 p-1.5 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                  {proposalError}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {!proposal && !loadingProposal && (
                <div className="text-center py-6">
                  <SparklesIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-xs text-gray-500">Cliquez sur Générer</p>
                </div>
              )}

              {loadingProposal && (
                <div className="text-center py-6">
                  <ArrowPathIcon className="w-8 h-8 text-purple-600 mx-auto mb-2 animate-spin" />
                  <p className="text-xs text-gray-500">Génération...</p>
                </div>
              )}

              {proposal && (
                <>
                  {/* Sections */}
                  {proposal.sections && proposal.sections.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <RectangleStackIcon className="w-3 h-3 text-blue-600" />
                        <h4 className="font-semibold text-gray-700 text-xs">
                          Sections ({proposal.sections.length})
                        </h4>
                      </div>
                      <div className="space-y-1">
                        {proposal.sections.map((section: any) => (
                          <ProposalCardMini
                            key={section.section_id}
                            id={section.section_id}
                            type="section"
                            title={section.section_nom}
                            description={section.description_courte}
                            icon={RectangleStackIcon}
                            color="blue"
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* POIs */}
                  {proposal.pois && proposal.pois.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <MapPinIcon className="w-3 h-3 text-green-600" />
                        <h4 className="font-semibold text-gray-700 text-xs">
                          Lieux ({proposal.pois.length})
                        </h4>
                      </div>
                      <div className="space-y-1">
                        {proposal.pois.map((poi: any) => (
                          <ProposalCardMini
                            key={poi.poi_id}
                            id={poi.poi_id}
                            type="poi"
                            title={poi.nom}
                            description={`${poi.type}`}
                            icon={MapPinIcon}
                            color="green"
                            articleSlug={poi.article_source}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Inspirations */}
                  {proposal.inspirations && proposal.inspirations.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <LightBulbIcon className="w-3 h-3 text-orange-600" />
                        <h4 className="font-semibold text-gray-700 text-xs">
                          Inspiration ({proposal.inspirations.length})
                        </h4>
                      </div>
                      <div className="space-y-1">
                        {proposal.inspirations.map((inspiration: any) => (
                          <ProposalCardMini
                            key={inspiration.theme_id}
                            id={inspiration.theme_id}
                            type="inspiration"
                            title={inspiration.titre}
                            description={inspiration.angle_editorial}
                            icon={LightBulbIcon}
                            color="orange"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
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
              <div className="text-xs text-gray-500">
                💡 Glissez depuis la palette
              </div>
            </div>
          </div>

          {/* Grille de pages - Maximum d'espace */}
          <div className="flex-1 overflow-auto p-4">
            <CheminDeFerGrid
              pages={pages}
              onEdit={handleEditPage}
              onDelete={handleDeletePage}
              onOpenContent={handleOpenContent}
              isEmpty={pages.length === 0}
              onAddPages={() => setShowAddPagesModal(true)}
            />
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
        />
      )}

      {showAddPagesModal && (
        <AddPagesModal
          onClose={() => setShowAddPagesModal(false)}
          onConfirm={handleAddMultiplePages}
          isLoading={addingPages}
        />
      )}
    </div>
  );
}

// Composant Template MINI pour la palette (grille 2 colonnes)
function TemplatePaletteItemMini({ template }: { template: any }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `template-${template._id}`,
    data: { type: 'template', template },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`bg-white rounded border p-2 cursor-grab active:cursor-grabbing transition-all ${
        isDragging 
          ? 'opacity-50 scale-95 border-blue-500 shadow-lg' 
          : 'border-blue-200 hover:border-blue-400 hover:shadow-sm'
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <div className="p-0.5 bg-blue-100 rounded flex-shrink-0">
          <DocumentTextIcon className="w-3 h-3 text-blue-600" />
        </div>
        <h4 className="font-bold text-gray-900 text-xs line-clamp-1 flex-1">{template.name}</h4>
      </div>
      <div className="text-xs text-blue-600 font-medium">
        {template.fields?.length || 0} champs
      </div>
    </div>
  );
}

// Composant Proposition IA MINI pour la palette
function ProposalCardMini({ id, type, title, description, icon: Icon, color, articleSlug }: any) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `proposal-${type}-${id}`,
    data: { type: 'proposal', proposalType: type, id, title, description, articleSlug },
  });

  const colorClasses = {
    blue: 'border-blue-200 hover:border-blue-400 bg-blue-50/40',
    green: 'border-green-200 hover:border-green-400 bg-green-50/40',
    orange: 'border-orange-200 hover:border-orange-400 bg-orange-50/40',
  };

  const iconColorClasses = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    orange: 'bg-orange-100 text-orange-600',
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`p-1.5 bg-white border rounded cursor-grab active:cursor-grabbing transition-all ${
        isDragging ? 'opacity-50 scale-95' : ''
      } ${colorClasses[color as keyof typeof colorClasses]}`}
    >
      <div className="flex items-center gap-1.5">
        <div className={`p-0.5 rounded flex-shrink-0 ${iconColorClasses[color as keyof typeof iconColorClasses]}`}>
          <Icon className="w-3 h-3" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-gray-900 text-xs line-clamp-1">{title}</h4>
          {description && (
            <p className="text-xs text-gray-500 line-clamp-1">{description}</p>
          )}
        </div>
      </div>
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
  isEmpty,
  onAddPages,
}: {
  pages: Page[];
  onEdit: (page: Page) => void;
  onDelete: (pageId: string) => void;
  onOpenContent: (page: Page) => void;
  isEmpty: boolean;
  onAddPages: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'chemin-de-fer-grid',
  });

  // Grille pour 100-200 pages : afficher les pages existantes + emplacements vides jusqu'à 200
  // Si moins de 50 pages, afficher 100 emplacements
  // Si plus de 50, afficher jusqu'à 200 ou pages.length + 20
  const targetSize = pages.length < 50 ? 100 : Math.min(200, pages.length + 20);
  const gridSize = Math.max(targetSize, pages.length);
  
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
        {/* Grille responsive optimisée pour plus de colonnes */}
        <SortableContext
          items={pages.map((p) => p._id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
            {slots.map((slot: any) => {
              if (slot.isEmpty) {
                // Case vide droppable
                return (
                  <EmptySlot 
                    key={`empty-${slot.ordre}`} 
                    ordre={slot.ordre}
                    isGlobalOver={isOver}
                  />
                );
              } else {
                // Case avec page
                return (
                  <PageCard
                    key={slot._id}
                    page={slot}
                    onEdit={() => onEdit(slot)}
                    onDelete={() => onDelete(slot._id)}
                    onOpenContent={() => onOpenContent(slot)}
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
          Ajouter pages
        </div>
        <div className="text-xs text-green-600">
          En masse
        </div>
      </div>
    </button>
  );
}

// Modale pour ajouter plusieurs pages
function AddPagesModal({ 
  onClose, 
  onConfirm, 
  isLoading 
}: { 
  onClose: () => void; 
  onConfirm: (count: number) => void; 
  isLoading: boolean;
}) {
  const [count, setCount] = useState(10);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(count);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Ajouter plusieurs pages</h2>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="text-gray-400 hover:text-gray-600"
          >
            <span className="text-xl">×</span>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nombre de pages à créer
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value) || 1)}
              disabled={isLoading}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-center text-2xl font-bold"
              required
            />
            <p className="mt-2 text-xs text-gray-500">
              Les pages seront créées avec le template par défaut et ajoutées à la suite
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <ArrowPathIcon className="w-4 h-4 animate-spin" />
                  Création...
                </>
              ) : (
                <>
                  <PlusIcon className="w-4 h-4" />
                  Créer {count} page{count > 1 ? 's' : ''}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
