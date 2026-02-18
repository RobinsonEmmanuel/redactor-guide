'use client';

import Link from 'next/link';

interface GuideBookCardProps {
  guide: {
    _id: string;
    name: string;
    destinations: string[];
    year: number;
    status: string;
    image_principale?: string;
  };
}

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-400' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  review: { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  ready: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  published: { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' },
  archived: { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-300' },
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  in_progress: 'En cours',
  review: 'En revue',
  ready: 'Prêt',
  published: 'Publié',
  archived: 'Archivé',
};

export default function GuideBookCard({ guide }: GuideBookCardProps) {
  const statusConfig = STATUS_COLORS[guide.status] || STATUS_COLORS.draft;
  const statusLabel = STATUS_LABELS[guide.status] || guide.status;

  return (
    <Link href={`/guides/${guide._id}`}>
      <div className="group relative cursor-pointer transition-all duration-300 hover:scale-105">
        {/* Ombre du livre (épaisseur) */}
        <div className="absolute inset-0 bg-gradient-to-r from-gray-400 to-gray-500 rounded-r-lg transform translate-x-1 translate-y-2 opacity-40 group-hover:opacity-60 transition-opacity" />
        
        {/* Tranche du livre */}
        <div className="absolute left-0 top-0 bottom-0 w-3 bg-gradient-to-r from-gray-300 to-gray-400 rounded-l-sm" />
        
        {/* Couverture du livre */}
        <div 
          className="relative bg-white rounded-lg overflow-hidden border-2 border-gray-200 group-hover:border-blue-400 transition-colors"
          style={{
            aspectRatio: '11/19', // Format livre
            width: '220px',
          }}
        >
          {/* Image de couverture */}
          {guide.image_principale ? (
            <div 
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${guide.image_principale})` }}
            >
              {/* Overlay gradient pour lisibilité */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/60" />
            </div>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600" />
          )}

          {/* Contenu de la couverture */}
          <div className="relative h-full flex flex-col justify-between p-4">
            {/* Badge statut en haut */}
            <div className="flex justify-end">
              <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full ${statusConfig.bg} backdrop-blur-sm`}>
                <div className={`w-2 h-2 rounded-full ${statusConfig.dot}`} />
                <span className={`text-xs font-medium ${statusConfig.text}`}>
                  {statusLabel}
                </span>
              </div>
            </div>

            {/* Titre du guide en bas */}
            <div className="space-y-2">
              <h3 className="font-bold text-xl text-white drop-shadow-lg leading-tight">
                {guide.destinations.join(', ')}
              </h3>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white/90 drop-shadow">
                  {guide.year}
                </span>
                <span className="text-xs text-white/80 bg-black/30 px-2 py-0.5 rounded backdrop-blur-sm">
                  v{guide.name.split('v')[1] || '1.0.0'}
                </span>
              </div>
            </div>
          </div>

          {/* Effet de surbrillance au hover */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/0 via-white/0 to-white/20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        </div>

        {/* Nombre de pages (petit badge) */}
        <div className="absolute -bottom-3 -right-2 bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-full shadow-lg z-10">
          📄 Guide
        </div>
      </div>
    </Link>
  );
}
