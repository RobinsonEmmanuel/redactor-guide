'use client';

import { 
  BookOpenIcon, 
  Cog6ToothIcon,
  ChartBarIcon,
  DocumentTextIcon,
  CloudArrowUpIcon,
} from '@heroicons/react/24/outline';

const menuItems = [
  { name: 'Guides', icon: BookOpenIcon, active: true },
  { name: 'Destinations', icon: DocumentTextIcon, active: false },
  { name: 'Exports', icon: CloudArrowUpIcon, active: false },
  { name: 'Statistiques', icon: ChartBarIcon, active: false },
  { name: 'Paramètres', icon: Cog6ToothIcon, active: false },
];

export default function Sidebar() {
  return (
    <aside className="w-52 bg-[#1e293b] text-white flex flex-col">
      {/* Logo/Header */}
      <div className="p-6 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-orange-500 rounded-full flex items-center justify-center font-bold text-lg">
            R
          </div>
          <div>
            <h1 className="font-semibold text-sm">Redactor Guide</h1>
            <p className="text-xs text-slate-400">Administration</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.name}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                item.active
                  ? 'bg-orange-500 text-white'
                  : 'text-slate-300 hover:bg-slate-700/50'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-sm font-medium">{item.name}</span>
            </button>
          );
        })}
      </nav>

      {/* User info */}
      <div className="p-4 border-t border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-slate-600 rounded-full flex items-center justify-center text-xs font-semibold">
            ER
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">Emmanuel R.</p>
            <p className="text-xs text-slate-400">Administrateur</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
