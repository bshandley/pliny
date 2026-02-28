import { User } from '../types';
import AppBar from './AppBar';
import UserManagement from './UserManagement';
import OidcSettings from './OidcSettings';
import TemplateGallery from './TemplateGallery';
import GeneralSettings from './GeneralSettings';
import SharedBoards from './SharedBoards';

interface AdminPageProps {
  onBack: () => void;
  currentUser: User;
  subRoute: string | null;
  onNavigate: (sub: string | null) => void;
}

type AdminTab = 'members' | 'templates' | 'sso' | 'general' | 'sharing';

function getActiveTab(subRoute: string | null): AdminTab {
  if (!subRoute) return 'members';
  if (subRoute === 'templates') return 'templates';
  if (subRoute === 'sso') return 'sso';
  if (subRoute === 'general') return 'general';
  if (subRoute === 'sharing') return 'sharing';
  return 'members';
}

const TAB_ICONS: Record<AdminTab, JSX.Element> = {
  members: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  templates: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  sso: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  general: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  sharing: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
};

const TABS: { key: AdminTab; label: string; route: string | null }[] = [
  { key: 'members', label: 'Members', route: null },
  { key: 'templates', label: 'Templates', route: 'templates' },
  { key: 'sso', label: 'SSO', route: 'sso' },
  { key: 'general', label: 'General', route: 'general' },
  { key: 'sharing', label: 'Sharing', route: 'sharing' },
];

export default function AdminPage({ onBack, currentUser, subRoute, onNavigate }: AdminPageProps) {
  const activeTab = getActiveTab(subRoute);
  const memberSubRoute = activeTab === 'members' ? subRoute : null;

  return (
    <div className="admin-page">
      <AppBar title="Admin" onBack={onBack} />
      <div className="admin-layout">
        <nav className="admin-sidebar">
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`admin-tab${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => onNavigate(tab.route)}
            >
              <span className="admin-tab-icon">{TAB_ICONS[tab.key]}</span>
              <span className="admin-tab-label">{tab.label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-content">
          {activeTab === 'members' && (
            <UserManagement
              currentUser={currentUser}
              subRoute={memberSubRoute}
              onNavigate={onNavigate}
            />
          )}
          {activeTab === 'templates' && (
            <TemplateGallery />
          )}
          {activeTab === 'sso' && (
            <OidcSettings />
          )}
          {activeTab === 'general' && (
            <GeneralSettings />
          )}
          {activeTab === 'sharing' && (
            <SharedBoards />
          )}
        </div>
      </div>
    </div>
  );
}
