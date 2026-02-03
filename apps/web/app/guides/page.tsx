'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import GuidesList from '@/components/GuidesList';
import GuideForm from '@/components/GuideForm';

export default function GuidesPage() {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editingGuide, setEditingGuide] = useState<any>(null);

  const handleCreateGuide = () => {
    setEditingGuide(null);
    setShowForm(true);
  };

  const handleEditGuide = (guide: any) => {
    setEditingGuide(guide);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingGuide(null);
    // Recharger la liste
    window.location.reload();
  };

  return (
    <div className="flex h-screen">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        {showForm ? (
          <div className="p-8">
            <GuideForm guide={editingGuide} onClose={handleCloseForm} />
          </div>
        ) : (
          <GuidesList onCreateGuide={handleCreateGuide} onEditGuide={handleEditGuide} />
        )}
      </main>
    </div>
  );
}
