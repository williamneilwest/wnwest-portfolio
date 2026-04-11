import {
  Activity,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { modules } from './modules';

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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

  if (pathname.startsWith('/app/work/user-group-association')) {
    return 'Work / User-Group Association';
  }

  if (pathname.startsWith('/app/work/table')) {
    return 'Work / Table';
  }

  if (pathname.startsWith('/app/work')) {
    return 'Work';
  }

  if (pathname.startsWith('/app/data')) {
    return 'Data';
  }

  if (pathname.startsWith('/app/admin')) {
    return 'Admin';
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
    return 'Console';
  }

  if (pathname.startsWith('/app/life')) {
    return 'Life';
  }

  if (pathname.startsWith('/readme')) {
    return 'Readme';
  }

  return 'westOS';
}

function renderModuleLink(module) {
  if (module.external) {
    return (
      <a className="shell__nav-link" href={module.href} rel="noreferrer">
        <span className="shell__nav-icon">
          <module.icon size={18} />
        </span>
        <span className="shell__nav-copy">
          <strong>{module.label}</strong>
          <span>{module.summary}</span>
        </span>
      </a>
    );
  }

  return (
    <NavLink
      to={module.href}
      className={({ isActive }) => (isActive ? 'shell__nav-link shell__nav-link--active' : 'shell__nav-link')}
    >
      <span className="shell__nav-icon">
        <module.icon size={18} />
      </span>
      <span className="shell__nav-copy">
        <strong>{module.label}</strong>
        <span>{module.summary}</span>
      </span>
    </NavLink>
  );
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const contextTitle = getContextTitle(location.pathname);
  const [expanded, setExpanded] = useState(false);
  const currentModule = modules.find((m) => location.pathname.startsWith(m.href));

  function onMobileNavChange(e) {
    const value = e.target.value;
    if (value) navigate(value);
  }

  useEffect(() => {
    const saved = window.localStorage.getItem('hero-expanded');
    if (saved !== null) {
      setExpanded(saved === 'true');
      return;
    }

    const isSmallScreen = window.matchMedia('(max-width: 720px)').matches;
    setExpanded(isSmallScreen);
  }, []);

  useEffect(() => {
    window.localStorage.setItem('hero-expanded', String(expanded));
  }, [expanded]);

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
                <h1>Platform Control Surface</h1>
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
            <p>One frontend, four modules, clean service boundaries.</p>
            <div className="shell__brand-visual" aria-hidden="true" />
            <nav className="shell__brand-mobile-nav" aria-label="Primary mobile">
              {modules.map((module) => (
                <div className="shell__nav-row" key={`mobile-${module.href}`}>
                  {renderModuleLink(module)}
                </div>
              ))}
            </nav>
          </div>
        </div>

        <nav className="shell__nav" aria-label="Primary">
          {modules.map((module) => (
            <div className="shell__nav-row" key={module.href}>
              {renderModuleLink(module)}
            </div>
          ))}
        </nav>

        <div className="shell__sidebar-footer">
          <div className="shell__status-chip">
            <Activity size={14} />
            <span>Dev environment online</span>
          </div>
        </div>
      </aside>

      <main className="shell__content">
        <header className="shell__topbar">
          <NavLink to="/" className="shell__home-back" aria-label="Back to home">
            <ArrowLeft size={14} />
          </NavLink>
          <h2 className="shell__context-title">{contextTitle}</h2>
          <div className="shell__mobile-topbar" role="navigation" aria-label="Mobile page selector">
            <select
              className="shell__mobile-select"
              value={currentModule?.href || ''}
              onChange={onMobileNavChange}
              aria-label="Select page"
            >
              {!currentModule && (
                <option value="" disabled>
                  {contextTitle}
                </option>
              )}
              {modules.map((m) => (
                <option key={m.href} value={m.href}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </header>

        <div className="shell__viewport">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
