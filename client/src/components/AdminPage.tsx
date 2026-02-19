import { User } from '../types';
import AppBar from './AppBar';
import UserManagement from './UserManagement';
import OidcSettings from './OidcSettings';
import TemplateGallery from './TemplateGallery';
import GeneralSettings from './GeneralSettings';

interface AdminPageProps {
  onBack: () => void;
  currentUser: User;
  subRoute: string | null;
  onNavigate: (sub: string | null) => void;
}

type AdminTab = 'members' | 'templates' | 'sso' | 'general';

function getActiveTab(subRoute: string | null): AdminTab {
  if (!subRoute) return 'members';
  if (subRoute === 'templates') return 'templates';
  if (subRoute === 'sso') return 'sso';
  if (subRoute === 'general') return 'general';
  // sub-routes like 'new', username belong to members tab
  return 'members';
}

const TABS: { key: AdminTab; label: string; route: string | null }[] = [
  { key: 'members', label: 'Members', route: null },
  { key: 'templates', label: 'Templates', route: 'templates' },
  { key: 'sso', label: 'SSO', route: 'sso' },
  { key: 'general', label: 'General', route: 'general' },
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
              {tab.label}
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
        </div>
      </div>
    </div>
  );
}
