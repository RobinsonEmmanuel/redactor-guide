'use client';

import { useState, useEffect } from 'react';
import { DndContext, closestCenter, DragEndEvent, DragOverEvent, PointerSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core';
import { arrayMove, SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { nanoid } from 'nanoid';
import PageCard from './PageCard';
import PageModal from './PageModal';
import TemplatePalette from './TemplatePalette';
import ContentEditorModal from './ContentEditorModal';

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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    loadTemplates();
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

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    // Drag d'un template vers la grille
    if (active.data.current?.type === 'template' && over?.id === 'chemin-de-fer-grid') {
      const template = active.data.current.template;
      await handleCreatePageFromTemplate(template);
      return;
    }

    // Réorganisation des pages existantes
    if (over && active.id !== over.id) {
      const oldIndex = pages.findIndex((p) => p._id === active.id);
      const newIndex = pages.findIndex((p) => p._id === over.id);
      
      if (oldIndex === -1 || newIndex === -1) return;
      
      const newPages = arrayMove(pages, oldIndex, newIndex);

      // Mettre à jour les numéros d'ordre
      const reorderedPages = newPages.map((p, idx) => ({
        ...p,
        ordre: idx + 1,
      }));

      setPages(reorderedPages);

      // Sauvegarder l'ordre
      try {
        await fetch(`${apiUrl}/api/v1/guides/${guideId}/chemin-de-fer/pages/reorder`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            pages: reorderedPages.map((p) => ({ _id: p._id, ordre: p.ordre })),
          }),
        });
      } catch (err) {
        console.error('Erreur réorganisation:', err);
        loadPages();
      }
    }
  };

  const handleCreatePageFromTemplate = async (template: any) => {
    try {
      const pageData = {
        page_id: nanoid(10),
        titre: `Nouvelle page ${template.name}`,
        template_id: template._id,
        type_de_page: '',
        statut_editorial: 'draft',
        ordre: pages.length + 1,
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
        // Optionnel : mettre à jour le statut de la page
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
        // Modifier
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
        // Créer
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
    <div className="flex h-[calc(100vh-16rem)] gap-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        {/* Colonne gauche : Palette de templates */}
        <div className="w-1/5 flex-shrink-0">
          <TemplatePalette templates={templates} />
        </div>

        {/* Colonne centrale : Grille du chemin de fer */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Chemin de fer</h2>
              <p className="text-sm text-gray-600 mt-1">
                {pages.length} page{pages.length > 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {/* Grille de pages */}
          <CheminDeFerGrid
            pages={pages}
            onEdit={handleEditPage}
            onDelete={handleDeletePage}
            onOpenContent={handleOpenContent}
            isEmpty={pages.length === 0}
          />
        </div>
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
}: {
  pages: Page[];
  onEdit: (page: Page) => void;
  onDelete: (pageId: string) => void;
  onOpenContent: (page: Page) => void;
  isEmpty: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'chemin-de-fer-grid',
  });

  // Créer une grille avec des emplacements vides
  const gridSize = Math.max(12, pages.length + 4); // Min 12, max actuel + 4 vides
  const slots = Array.from({ length: gridSize }, (_, i) => {
    const pageAtPosition = pages.find(p => p.ordre === i + 1);
    return pageAtPosition || { isEmpty: true, ordre: i + 1 };
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 overflow-auto rounded-lg border-2 transition-all ${
        isOver 
          ? 'border-blue-500 bg-gradient-to-br from-blue-50 to-blue-100' 
          : 'border-gray-300 bg-gradient-to-br from-gray-50 to-white'
      }`}
    >
      <div className="p-4">
        {/* Message d'aide si vide */}
        {isEmpty && (
          <div className="text-center py-6 mb-4 bg-blue-50 border-2 border-dashed border-blue-300 rounded-lg">
            <p className="text-blue-700 font-medium mb-1">
              🎯 Glissez un template dans une case pour créer une page
            </p>
            <p className="text-sm text-blue-600">
              Les cases sont numérotées pour organiser votre chemin de fer
            </p>
          </div>
        )}

        {/* Grille avec emplacements visibles */}
        <SortableContext
          items={pages.map((p) => p._id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {slots.map((slot: any) => {
              if (slot.isEmpty) {
                // Case vide
                return (
                  <div
                    key={`empty-${slot.ordre}`}
                    className={`relative bg-white rounded-lg border-2 border-dashed transition-all ${
                      isOver 
                        ? 'border-blue-400 bg-blue-50' 
                        : 'border-gray-300 hover:border-blue-300 hover:bg-blue-50/50'
                    }`}
                    style={{ minHeight: '240px' }}
                  >
                    {/* Numéro de l'emplacement */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-6xl font-bold text-gray-200 mb-2">
                          {slot.ordre}
                        </div>
                        <div className="text-xs text-gray-400 font-medium">
                          Emplacement libre
                        </div>
                      </div>
                    </div>
                  </div>
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
          </div>
        </SortableContext>
      </div>
    </div>
  );
}
