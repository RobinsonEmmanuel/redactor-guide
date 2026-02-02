'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, storeTokens } from '@/lib/auth';
import Sidebar from '@/components/Sidebar';
import GuidesList from '@/components/GuidesList';
import GuideForm from '@/components/GuideForm';

export default function Home() {
  const router = useRouter();
  const [selectedGuide, setSelectedGuide] = useState<any>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    // Vérifier l'authentification côté client
    if (!isAuthenticated()) {
      router.push('/login');
    }
    
    // Synchroniser le token avec les cookies pour le middleware
    const token = localStorage.getItem('accessToken');
    if (token) {
      document.cookie = `accessToken=${token}; path=/; max-age=86400`;
    }
  }, [router]);

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

  if (!mounted) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Chargement...</div>
      </div>
    );
  }

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
