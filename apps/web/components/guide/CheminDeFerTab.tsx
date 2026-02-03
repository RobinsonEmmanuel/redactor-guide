'use client';

import { useState, useEffect } from 'react';
import { DndContext, closestCenter, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { PlusIcon } from '@heroicons/react/24/outline';
import PageCard from './PageCard';
import PageModal from './PageModal';

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
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPage, setEditingPage] = useState<Page | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    if (cheminDeFer) {
      loadPages();
    } else {
      setLoading(false);
    }
  }, [cheminDeFer]);

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

    if (over && active.id !== over.id) {
      const oldIndex = pages.findIndex((p) => p._id === active.id);
      const newIndex = pages.findIndex((p) => p._id === over.id);
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
        // Recharger en cas d'erreur
        loadPages();
      }
    }
  };

  const handleAddPage = () => {
    setEditingPage(null);
    setShowModal(true);
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
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Chemin de fer</h2>
          <p className="text-sm text-gray-600 mt-1">
            {pages.length} page{pages.length > 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={handleAddPage}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <PlusIcon className="h-5 w-5" />
          Ajouter une page
        </button>
      </div>

      {/* Grille de pages */}
      {pages.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <p className="text-gray-500 mb-4">Aucune page dans le chemin de fer</p>
          <button
            onClick={handleAddPage}
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Créer la première page
          </button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={pages.map((p) => p._id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {pages.map((page) => (
                <PageCard
                  key={page._id}
                  page={page}
                  onEdit={() => handleEditPage(page)}
                  onDelete={() => handleDeletePage(page._id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Modal */}
      {showModal && (
        <PageModal
          page={editingPage}
          onClose={() => setShowModal(false)}
          onSave={handleSavePage}
          apiUrl={apiUrl}
        />
      )}
    </div>
  );
}
