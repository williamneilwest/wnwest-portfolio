import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Menu,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getSystemStatus } from '../services/api';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { isWorkDomainHost } from '../constants/domain';
import { storage } from '../utils/storage';
import { modules } from './modules';
import { AssistantPopover } from '../../features/ai/components/AssistantPopover';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { UserPanel } from '../../features/auth/UserPanel';
import { AuthHeaderControl } from '../../features/auth/AuthHeaderControl';
import { LoginModal } from '../../features/auth/LoginModal';

const NAV_LAST_USED_KEY = 'westos.nav.lastUsed';
const NAV_LAST_USED_MAP_KEY = 'westos.nav.lastUsedMap';
const NAV_GROUPS = [
  { label: 'Workspace', hrefs: ['/app/life', '/app/work', '/app/data'] },
  { label: 'Intelligence', hrefs: ['/app/ai', '/app/kb'] },
  { label: 'System', hrefs: ['/app/system', '/app/console', '/app/settings'] },
];

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function formatRelativeTime(isoTimestamp) {
  if (!isoTimestamp) {
    return '';
  }

  const timestamp = Date.parse(isoTimestamp);
  if (Number.isNaN(timestamp)) {
    return '';
  }

  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getContextTitle(pathname) {
  if (pathname.startsWith('/tickets/')) {
    const ticketId = safeDecodeURIComponent(pathname.split('/').filter(Boolean).at(-1) || '');
    return ticketId ? `Tickets / ${ticketId}` : 'Tickets';
  }

  if (pathname.startsWith('/tickets')) {
    return 'Tickets';
  }

  if (pathname.startsWith('/app/work/active-tickets')) {
    return 'Work / Active Tickets';
  }

  if (pathname.startsWith('/app/work/ai-metrics')) {
    return 'Work / AI Metrics';
  }

  if (pathname.startsWith('/app/work/group-search')) {
    return 'Work / Group Search';
  }

  if (pathname.startsWith('/app/work/get-user-groups')) {
    return 'Work / Get User Groups';
  }

  if (pathname.startsWith('/app/work/user-group-association')) {
    return 'Work / User-Group Association';
  }

  if (pathname.startsWith('/app/work/table')) {
    return 'Work / Table';
  }

  if (pathname.startsWith('/app/document')) {
    return 'Document Viewer';
  }

  if (pathname.startsWith('/app/kb/processed')) {
    return 'Knowledge Base / Processed KB';
  }

  if (pathname.startsWith('/app/kb')) {
    return 'Knowledge Base';
  }

  if (pathname.startsWith('/app/ai/documents')) {
    return 'AI / Documents';
  }

  if (pathname.startsWith('/app/system')) {
    return 'System Viewer';
  }

  if (pathname.startsWith('/app/work')) {
    return 'Work';
  }

  if (pathname.startsWith('/app/data')) {
    return 'Data Hub';
  }

  if (pathname.startsWith('/app/uploads')) {
    return 'Uploads';
  }

  if (pathname.startsWith('/app/ai')) {
    return 'AI';
  }

  if (pathname.startsWith('/app/settings')) {
    return 'Settings';
  }

  if (pathname.startsWith('/app/console')) {
    return 'System Status';
  }

  if (pathname.startsWith('/app/life')) {
    return 'Life';
  }

  if (pathname.startsWith('/readme')) {
    return 'Readme';
  }

  return 'westOS';
}

function getBackTarget(pathname) {
  if (pathname === '/app') {
    return '/';
  }

  if (pathname === '/app/life' || pathname === '/app/work' || pathname === '/app/data') {
    return '/app';
  }

  if (pathname === '/app/ai' || pathname === '/app/kb' || pathname === '/app/system' || pathname === '/app/console' || pathname === '/app/settings') {
    return '/app';
  }

  if (pathname === '/app/uploads' || pathname === '/app/reference') {
    return '/app/work';
  }

  if (pathname.startsWith('/tickets/')) {
    return '/app/work/active-tickets';
  }

  if (pathname.startsWith('/app/work/table')) {
    return '/app/work';
  }

  if (pathname.startsWith('/app/document')) {
    return '/app/uploads';
  }

  if (pathname.startsWith('/app/kb/processed')) {
    return '/app/kb';
  }

  if (pathname.startsWith('/app/kb')) {
    return '/app/kb';
  }

  if (pathname.startsWith('/app/ai/documents')) {
    return '/app/ai';
  }

  if (pathname.startsWith('/app/console/endpoints')) {
    return '/app/console';
  }

  if (pathname.startsWith('/app/')) {
    return '/app/work';
  }

  if (pathname.startsWith('/readme')) {
    return '/';
  }

  return '/';
}

function renderModuleLink(module, { recommendedHref = '', lastOpenedByModule = {}, onNavigate } = {}) {
  const lastOpened = lastOpenedByModule[module.href];
  const lastOpenedLabel = formatRelativeTime(lastOpened);
  const isRecommended = recommendedHref === module.href;

  if (module.external) {
    return (
      <a className="shell__nav-link" href={module.href} rel="noreferrer" onClick={onNavigate}>
        <span className="shell__nav-icon">
          <module.icon size={18} />
        </span>
        <span className="shell__nav-copy">
          <strong>{module.label}</strong>
          <span>{module.summary}</span>
          {lastOpenedLabel ? <small>{`Last opened ${lastOpenedLabel}`}</small> : null}
        </span>
      </a>
    );
  }

  return (
    <NavLink
      to={module.href}
      onClick={onNavigate}
      className={({ isActive }) => {
        const classes = ['shell__nav-link'];
        if (isActive) {
          classes.push('shell__nav-link--active');
        }
        if (isRecommended) {
          classes.push('shell__nav-link--recommended');
        }
        return classes.join(' ');
      }}
    >
      <span className="shell__nav-icon">
        <module.icon size={18} />
      </span>
      <span className="shell__nav-copy">
        <strong>{module.label}</strong>
        <span>{module.summary}</span>
        {lastOpenedLabel ? <small>{`Last opened ${lastOpenedLabel}`}</small> : null}
      </span>
    </NavLink>
  );
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isWorkDomain = isWorkDomainHost();
  const contextTitle = getContextTitle(location.pathname);
  const backTarget = getBackTarget(location.pathname);
  const [expanded, setExpanded] = useState(false);
  const [lastUsedModule, setLastUsedModule] = useState(() => storage.get(NAV_LAST_USED_KEY) || null);
  const [lastOpenedByModule, setLastOpenedByModule] = useState(() => storage.get(NAV_LAST_USED_MAP_KEY) || {});
  const [systemHealth, setSystemHealth] = useState({ level: 'ok', text: 'All systems operational' });
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  );
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const { authenticated, isAdmin } = useCurrentUser();
  const visibleModules = useMemo(() => {
    if (!isWorkDomain) {
      const roleFiltered = modules.filter((module) => {
        if (module.href === '/app/system' || module.href === '/app/console') {
          return isAdmin;
        }
        return true;
      });
      return roleFiltered;
    }
    return modules.filter((module) => module.href === '/app/work');
  }, [isAdmin, isWorkDomain]);

  const currentModule = visibleModules.find((m) => location.pathname.startsWith(m.href));

  const groupedModules = useMemo(() => {
    return NAV_GROUPS.map((group) => ({
      label: group.label,
      items: group.hrefs
        .map((href) => visibleModules.find((module) => module.href === href))
        .filter(Boolean),
    }));
  }, [visibleModules]);

  const quickActionGroups = useMemo(
    () => {
      if (isWorkDomain) {
        return [
          {
            label: 'Work actions',
            actions: [{ href: '/app/work/active-tickets', label: 'Active Tickets' }],
          },
        ];
      }

      return [
        {
          label: 'Work actions',
          actions: [
            { href: '/app/work/active-tickets', label: 'Active Tickets' },
            { href: '/app/uploads', label: 'Upload File' },
          ],
        },
        ...(isAdmin ? [{
          label: 'System actions',
          actions: [{ href: '/app/console', label: 'View Logs' }],
        }] : []),
      ];
    },
    [isAdmin, isWorkDomain]
  );

  const recommendedHref = lastUsedModule?.href || '/app/work';

  useEffect(() => {
    if (!isWorkDomain) {
      return;
    }

    const workAllowedPaths = ['/app/work', '/work', '/tickets', '/document', '/app/document'];
    const isAllowed = workAllowedPaths.some((pathPrefix) => location.pathname.startsWith(pathPrefix));
    if (!isAllowed) {
      navigate('/app/work', { replace: true });
    }
  }, [isWorkDomain, location.pathname, navigate]);

  function onTopbarBack() {
    if (typeof window !== 'undefined' && window.history?.state?.idx > 0) {
      navigate(-1);
      return;
    }

    navigate(backTarget);
  }

  useEffect(() => {
    const saved = storage.get(STORAGE_KEYS.HERO_EXPANDED);
    if (saved !== null) {
      setExpanded(saved === true || saved === 'true');
      return;
    }

    const isSmallScreen = window.matchMedia('(max-width: 767px)').matches;
    setExpanded(isSmallScreen);
  }, []);

  useEffect(() => {
    storage.set(STORAGE_KEYS.HERO_EXPANDED, expanded);
  }, [expanded]);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobileNavOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsMobileNavOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMobileNavOpen]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const sync = (event) => {
      setIsMobileViewport(event.matches);
    };

    setIsMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener('change', sync);

    return () => {
      mediaQuery.removeEventListener('change', sync);
    };
  }, []);

  useEffect(() => {
    const onAuthRequired = () => setIsLoginModalOpen(true);
    window.addEventListener('westos:auth-required', onAuthRequired);
    return () => window.removeEventListener('westos:auth-required', onAuthRequired);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileNavOpen(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    if (!currentModule?.href) {
      return;
    }

    const openedAt = new Date().toISOString();
    const nextUsed = { href: currentModule.href, label: currentModule.label, openedAt };
    const nextMap = { ...lastOpenedByModule, [currentModule.href]: openedAt };

    setLastUsedModule(nextUsed);
    setLastOpenedByModule(nextMap);
    storage.set(NAV_LAST_USED_KEY, nextUsed);
    storage.set(NAV_LAST_USED_MAP_KEY, nextMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentModule?.href]);

  useEffect(() => {
    if (isWorkDomain || !authenticated) {
      setSystemHealth({
        level: 'warning',
        text: isWorkDomain ? 'Public work access' : 'Sign in to view status',
      });
      return undefined;
    }

    let isMounted = true;

    async function loadStatus() {
      try {
        const result = await getSystemStatus();
        if (!isMounted) {
          return;
        }

        const status = result?.data || {};
        const values = [status.backend, status.ai_gateway, status.frontend].map((value) => String(value || '').toLowerCase());
        const downCount = values.filter((value) => value === 'down').length;
        const degradedCount = values.filter((value) => value === 'degraded' || value === 'misconfigured').length;

        if (downCount > 0) {
          setSystemHealth({
            level: 'down',
            text: `${downCount} service${downCount === 1 ? '' : 's'} down`,
          });
          return;
        }

        if (degradedCount > 0) {
          setSystemHealth({
            level: 'warning',
            text: `${degradedCount} service${degradedCount === 1 ? '' : 's'} degraded`,
          });
          return;
        }

        setSystemHealth({ level: 'ok', text: 'All systems operational' });
      } catch {
        if (isMounted) {
          setSystemHealth({ level: 'warning', text: 'Status unavailable' });
        }
      }
    }

    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(), 60000);

    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, [authenticated, isWorkDomain]);

  const showDesktopTopbarExtras = !isMobileViewport;

  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <div
          className={
            expanded ? 'shell__brand-wrap shell__brand-wrap--expanded' : 'shell__brand-wrap shell__brand-wrap--collapsed'
          }
        >
          <div className="shell__brand-bar">
            <div className="shell__brand-identity">
              <div className="shell__brand-mark">
                <Sparkles size={18} />
              </div>
              <div className="shell__brand">
                <span className="shell__eyebrow">westOS</span>
                <h1>Control Center</h1>
              </div>
            </div>

            <button
              type="button"
              className="shell__brand-toggle"
              onClick={() => setExpanded((prev) => !prev)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse hero header' : 'Expand hero header'}
            >
              {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          </div>

          <div className={expanded ? 'shell__brand-panel shell__brand-panel--visible' : 'shell__brand-panel'}>
            <p>{`Last session: ${lastUsedModule?.label || 'Work Hub'}`}</p>
            <div className={`shell__hero-status shell__hero-status--${systemHealth.level}`}>
              <span>{systemHealth.text}</span>
            </div>
            {isAdmin ? (
              <NavLink className="ui-button ui-button--secondary shell__hero-action" to="/app/console">
                Open Console
              </NavLink>
            ) : null}

            <div className="shell__quick-actions" role="navigation" aria-label="Quick actions">
              {quickActionGroups.map((group) => (
                <div key={`quick-group-${group.label}`} className="shell__quick-action-group">
                  <span className="shell__nav-group-label">{group.label}</span>
                  <div className="shell__quick-action-items">
                    {group.actions.map((action) => (
                      <NavLink key={`quick-${action.href}`} to={action.href} className="shell__quick-chip">
                        {action.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <nav className="shell__brand-mobile-nav" aria-label="Primary mobile">
              {groupedModules.map((group) => (
                <div key={`mobile-group-${group.label}`} className="shell__nav-group">
                  <span className="shell__nav-group-label">{group.label}</span>
                  {group.items.map((module) => (
                    <div className="shell__nav-row" key={`mobile-${module.href}`}>
                      {renderModuleLink(module, { recommendedHref, lastOpenedByModule, onNavigate: () => setIsMobileNavOpen(false) })}
                    </div>
                  ))}
                </div>
              ))}
            </nav>
          </div>
        </div>

        <nav className="shell__nav" aria-label="Primary">
          {groupedModules.map((group) => (
            <div key={`group-${group.label}`} className="shell__nav-group">
              <span className="shell__nav-group-label">{group.label}</span>
              {group.items.map((module) => (
                <div className="shell__nav-row" key={module.href}>
                  {renderModuleLink(module, { recommendedHref, lastOpenedByModule })}
                </div>
              ))}
            </div>
          ))}
        </nav>

        <div className="shell__sidebar-footer">
          <UserPanel />
        </div>
      </aside>

      <main className="shell__content">
        <header className="shell__topbar">
          <div className="shell__topbar-left">
            <button className="shell__home-back" aria-label="Go back" type="button" onClick={onTopbarBack}>
              <ArrowLeft size={14} />
            </button>
            <h2 className="shell__context-title">{contextTitle}</h2>
          </div>
          <div className="shell__topbar-right">
            {isMobileViewport ? (
              <button
                type="button"
                className="compact-toggle shell__mobile-menu-toggle"
                onClick={() => setIsMobileNavOpen((current) => !current)}
                aria-expanded={isMobileNavOpen}
                aria-label={isMobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
              >
                {isMobileNavOpen ? <X size={15} /> : <Menu size={15} />}
              </button>
            ) : null}
            <div className="shell__topbar-actions">
              {showDesktopTopbarExtras ? <AuthHeaderControl onOpenLogin={() => setIsLoginModalOpen(true)} /> : null}
              {showDesktopTopbarExtras && location.pathname.startsWith('/app/ai') ? (
                <NavLink
                  to={location.pathname.startsWith('/app/ai/documents') ? '/app/ai' : '/app/ai/documents'}
                  className={({ isActive }) => (isActive ? 'compact-toggle compact-toggle--active' : 'compact-toggle')}
                >
                  {location.pathname.startsWith('/app/ai/documents') ? 'AI Settings' : 'AI Documents'}
                </NavLink>
              ) : null}
              {showDesktopTopbarExtras && location.pathname.startsWith('/app/kb') ? (
                <NavLink
                  to={location.pathname.startsWith('/app/kb/processed') ? '/app/kb' : '/app/kb/processed'}
                  className={({ isActive }) => (isActive ? 'compact-toggle compact-toggle--active' : 'compact-toggle')}
                >
                  {location.pathname.startsWith('/app/kb/processed') ? 'Knowledge Base' : 'Processed KB'}
                </NavLink>
              ) : null}
              {isWorkDomain || !authenticated ? null : <AssistantPopover />}
            </div>
          </div>
        </header>

        {isMobileNavOpen ? (
          <button
            type="button"
            className="shell__mobile-drawer-backdrop"
            aria-label="Close navigation drawer"
            onClick={() => setIsMobileNavOpen(false)}
          />
        ) : null}
        <aside className={isMobileNavOpen ? 'shell__mobile-drawer shell__mobile-drawer--open' : 'shell__mobile-drawer'}>
          <div className="shell__mobile-drawer-head">
            <strong>Navigation</strong>
            <button
              type="button"
              className="compact-toggle compact-toggle--icon"
              onClick={() => setIsMobileNavOpen(false)}
              aria-label="Close navigation drawer"
            >
              <X size={14} />
            </button>
          </div>
          <nav className="shell__mobile-drawer-nav" aria-label="Mobile primary navigation">
            {groupedModules.map((group) => (
              <div key={`drawer-group-${group.label}`} className="shell__nav-group">
                <span className="shell__nav-group-label">{group.label}</span>
                {group.items.map((module) => (
                  <div className="shell__nav-row" key={`drawer-${module.href}`}>
                    {renderModuleLink(module, {
                      recommendedHref,
                      lastOpenedByModule,
                      onNavigate: () => setIsMobileNavOpen(false),
                    })}
                  </div>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <div className="shell__viewport">
          <Outlet />
        </div>
      </main>
      <LoginModal open={isLoginModalOpen} onClose={() => setIsLoginModalOpen(false)} />
    </div>
  );
}
