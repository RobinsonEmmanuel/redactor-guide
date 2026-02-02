'use client';

import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import GuidesList from '@/components/GuidesList';
import GuideForm from '@/components/GuideForm';

export default function Home() {
  const [selectedGuide, setSelectedGuide] = useState<any>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const handleCreateGuide = () => {
    setSelectedGuide(null);
    setIsFormOpen(true);
  };

  const handleEditGuide = (guide: any) => {
    setSelectedGuide(guide);
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setSelectedGuide(null);
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      
      <main className="flex-1 overflow-auto">
        {isFormOpen ? (
          <GuideForm 
            guide={selectedGuide} 
            onClose={handleCloseForm}
          />
        ) : (
          <GuidesList 
            onCreateGuide={handleCreateGuide}
            onEditGuide={handleEditGuide}
          />
        )}
      </main>
    </div>
  );
}
