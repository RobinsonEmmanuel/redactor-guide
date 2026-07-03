'use client';

import Link from 'next/link';

interface GuideBookCardProps {
  guide: {
    _id: string;
    name: string;
    destination?: string;
    destinations?: string[];
    year: number;
    version?: string;
    status: string;
    image_principale?: string;
  };
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  in_progress: 'En cours',
  review: 'En revue',
  ready: 'Prêt',
  published: 'Publié',
  archived: 'Archivé',
};

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-white/50',
  in_progress: 'bg-blue-300',
  review: 'bg-yellow-300',
  ready: 'bg-green-300',
  published: 'bg-emerald-300',
  archived: 'bg-white/25',
};

export default function GuideBookCard({ guide }: GuideBookCardProps) {
  const statusLabel = STATUS_LABELS[guide.status] || guide.status;
  const statusDot = STATUS_DOT[guide.status] || STATUS_DOT.draft;
  const title = (guide.destinations ?? []).filter(Boolean).join(', ') || guide.destination || guide.name;
  const version = guide.version || '1.0.0';

  return (
    <Link href={`/guides/${guide._id}`} className="block" style={{ width: '200px' }}>
      <div className="group relative cursor-pointer select-none" style={{ width: '200px' }}>

        {/* Lift wrapper — book + page edges move together on hover */}
        <div
          className="relative transition-transform duration-300 ease-out group-hover:-translate-y-2"
        >
          {/* Page edges — right side, outside the cover */}
          <div
            className="absolute top-2 bottom-2 rounded-r-[2px] pointer-events-none"
            style={{
              right: '-3px',
              width: '3px',
              background: 'linear-gradient(to right, #c9cdd4, #dde1e6)',
            }}
          />
          <div
            className="absolute top-3 bottom-3 rounded-r-[1px] pointer-events-none"
            style={{
              right: '-6px',
              width: '2px',
              background: '#eaecf0',
            }}
          />

          {/* Cover */}
          <div
            className="relative overflow-hidden"
            style={{
              aspectRatio: '11 / 17',
              borderRadius: '2px 5px 5px 2px',
              boxShadow: '4px 6px 18px rgba(0,0,0,0.22), 1px 2px 5px rgba(0,0,0,0.12)',
              transition: 'box-shadow 0.3s ease-out',
            }}
          >
            {/* Background — image or fallback */}
            {guide.image_principale ? (
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${guide.image_principale})` }}
              />
            ) : (
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(160deg, #252d7e 0%, #191E55 40%, #0e1238 100%)',
                }}
              />
            )}

            {/* Gradient overlay for text legibility */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(to bottom, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.04) 38%, rgba(0,0,0,0.62) 100%)',
              }}
            />

            {/* Spine shadow — simulates binding fold on left edge */}
            <div
              className="absolute left-0 top-0 bottom-0 pointer-events-none"
              style={{
                width: '32px',
                background:
                  'linear-gradient(to right, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0.07) 60%, transparent 100%)',
              }}
            />

            {/* Right edge highlight */}
            <div
              className="absolute right-0 top-0 bottom-0 pointer-events-none"
              style={{ width: '1px', background: 'rgba(255,255,255,0.12)' }}
            />

            {/* Content */}
            <div className="relative z-10 h-full flex flex-col justify-between p-4">
              {/* Status badge */}
              <div className="flex justify-end">
                <div
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                  style={{
                    background: 'rgba(255,255,255,0.15)',
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                  }}
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
                  <span className="text-[11px] font-medium text-white leading-none">
                    {statusLabel}
                  </span>
                </div>
              </div>

              {/* Title block */}
              <div className="space-y-0.5">
                <p
                  className="text-[10px] font-semibold text-white/55 uppercase tracking-[0.14em] truncate"
                  style={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
                >
                  {guide.name}
                </p>
                <h3
                  className="font-bold text-[17px] text-white leading-tight"
                  style={{ textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}
                >
                  {title}
                </h3>
                <div className="flex items-end justify-between pt-1.5">
                  <span
                    className="text-sm font-semibold text-white/80"
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}
                  >
                    {guide.year}
                  </span>
                  <span className="text-[10px] text-white/45 font-mono tracking-wide">
                    v{version}
                  </span>
                </div>
              </div>
            </div>

            {/* Hover sheen */}
            <div
              className="absolute inset-0 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-300"
              style={{
                background:
                  'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 55%)',
              }}
            />
          </div>
        </div>

        {/* Ground shadow — stays in place while book lifts */}
        <div
          className="absolute left-3 right-6 opacity-20 group-hover:opacity-35 transition-opacity duration-300 pointer-events-none"
          style={{
            bottom: '-6px',
            height: '12px',
            background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.7) 0%, transparent 70%)',
            filter: 'blur(3px)',
          }}
        />
      </div>
    </Link>
  );
}
