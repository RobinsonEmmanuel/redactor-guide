'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { 
  BookOpenIcon, 
  Cog6ToothIcon,
  ChartBarIcon,
  DocumentTextIcon,
  CloudArrowUpIcon,
  Square3Stack3DIcon,
  SparklesIcon,
  ChevronRightIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';

const menuItems = [
  { name: 'Guides', icon: BookOpenIcon, href: '/guides' },
  { 
    name: 'Templates', 
    icon: Square3Stack3DIcon, 
    href: '/templates',
    subItems: [
      { name: 'Pages', href: '/templates' },
      { name: 'Guides', href: '/guide-templates' },
      { name: 'Services', href: '/services' },
    ]
  },
  { name: 'Prompts', icon: SparklesIcon, href: '/prompts' },
  { name: 'Destinations', icon: DocumentTextIcon, href: '#' },
  { name: 'Exports', icon: CloudArrowUpIcon, href: '#' },
  { name: 'Statistiques', icon: ChartBarIcon, href: '#' },
  { name: 'Paramètres', icon: Cog6ToothIcon, href: '#' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(['Templates']));

  const toggleExpand = (itemName: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemName)) {
        newSet.delete(itemName);
      } else {
        newSet.add(itemName);
      }
      return newSet;
    });
  };

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
          const isExpanded = expandedItems.has(item.name);
          const hasSubItems = item.subItems && item.subItems.length > 0;
          const isActive = pathname.startsWith(item.href) && item.href !== '#';
          const isSubItemActive = hasSubItems && item.subItems.some(sub => pathname === sub.href);

          return (
            <div key={item.name}>
              <button
                onClick={() => {
                  if (hasSubItems) {
                    toggleExpand(item.name);
                  } else if (item.href !== '#') {
                    router.push(item.href);
                  }
                }}
                disabled={item.href === '#' && !hasSubItems}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive || isSubItemActive
                    ? 'bg-orange-500 text-white'
                    : item.href === '#' && !hasSubItems
                    ? 'text-slate-500 cursor-not-allowed'
                    : 'text-slate-300 hover:bg-slate-700/50'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-sm font-medium flex-1 text-left">{item.name}</span>
                {hasSubItems && (
                  isExpanded ? (
                    <ChevronDownIcon className="w-4 h-4" />
                  ) : (
                    <ChevronRightIcon className="w-4 h-4" />
                  )
                )}
              </button>

              {/* Sub-items */}
              {hasSubItems && isExpanded && (
                <div className="ml-4 mt-1 space-y-1">
                  {item.subItems.map((subItem) => {
                    const isSubActive = pathname === subItem.href;
                    return (
                      <button
                        key={subItem.name}
                        onClick={() => router.push(subItem.href)}
                        className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                          isSubActive
                            ? 'bg-orange-400 text-white'
                            : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                        }`}
                      >
                        <span className="text-xs">•</span>
                        <span>{subItem.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User info */}
      <div className="p-4 border-t border-slate-700">
        <UserInfo />
      </div>
    </aside>
  );
}

function UserInfo() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const { getCurrentUser, logout } = require('@/lib/auth');
      const currentUser = getCurrentUser();
      setUser(currentUser);
    }
  }, []);

  const handleLogout = () => {
    const { logout } = require('@/lib/auth');
    logout();
  };

  if (!user) return null;

  const initials = user.email
    ?.split('@')[0]
    ?.substring(0, 2)
    ?.toUpperCase() || 'ER';

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 bg-slate-600 rounded-full flex items-center justify-center text-xs font-semibold">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{user.email}</p>
          <p className="text-xs text-slate-400 capitalize">{user.role}</p>
        </div>
      </div>
      <button
        onClick={handleLogout}
        className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/50 rounded-lg transition-colors"
      >
        Déconnexion
      </button>
    </div>
  );
}
