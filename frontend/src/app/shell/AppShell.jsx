import {
  Activity,
  Blocks,
  BrainCircuit,
  ChevronDown,
  HeartPulse,
  Info,
  LayoutDashboard,
  LibraryBig,
  Mail,
  Sparkles,
  TerminalSquare
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

const modules = [
  { href: '/app/life', label: 'Life', summary: 'Personal systems', icon: HeartPulse, readmeHref: '/readme#life' },
  { href: '/work', label: 'Work', summary: 'Operational file tools', icon: Blocks, readmeHref: '/readme#work' },
  { href: '/app/uploads', label: 'Uploads', summary: 'Email CSV inbox', icon: Mail, readmeHref: '/readme' },
  { href: 'https://webui.westos.dev', label: 'AI', summary: 'Open WebUI workspace', icon: BrainCircuit, external: true, readmeHref: '/readme#ai' },
  { href: '/app/console', label: 'Console', summary: 'Service status', icon: TerminalSquare, readmeHref: '/readme#console' }
];

const docsModule = {
  href: '/readme',
  label: 'Readme',
  summary: 'Project encyclopedia',
  icon: LibraryBig,
  readmeHref: '/readme'
};

export function AppShell() {
  const location = useLocation();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const shellPath = location.pathname.startsWith('/tickets') ? '/work' : location.pathname;
  const activeModule =
    (shellPath.startsWith('/readme') && docsModule) ||
    modules.find((module) => !module.external && shellPath.startsWith(module.href)) ||
    modules[0];

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <div className="shell__brand-wrap">
          <div className="shell__brand-mark">
            <Sparkles size={18} />
          </div>
          <div className="shell__brand">
            <span className="shell__eyebrow">westOS</span>
            <h1>Platform Control Surface</h1>
            <p>One frontend, four modules, clean service boundaries.</p>
          </div>
        </div>

        <nav className="shell__nav" aria-label="Primary">
          {modules.map((module) =>
            module.external ? (
              <div className="shell__nav-row" key={module.href}>
                <a className="shell__nav-link" href={module.href} rel="noreferrer">
                  <span className="shell__nav-icon">
                    <module.icon size={18} />
                  </span>
                  <span className="shell__nav-copy">
                    <strong>{module.label}</strong>
                    <span>{module.summary}</span>
                  </span>
                </a>
                <Link aria-label={`${module.label} info`} className="shell__info-link" to={module.readmeHref}>
                  <Info size={15} />
                </Link>
              </div>
            ) : (
              <div className="shell__nav-row" key={module.href}>
                <NavLink
                  to={module.href}
                  className={({ isActive }) =>
                    isActive ? 'shell__nav-link shell__nav-link--active' : 'shell__nav-link'
                  }
                >
                  <span className="shell__nav-icon">
                    <module.icon size={18} />
                  </span>
                  <span className="shell__nav-copy">
                    <strong>{module.label}</strong>
                    <span>{module.summary}</span>
                  </span>
                </NavLink>
                <Link aria-label={`${module.label} info`} className="shell__info-link" to={module.readmeHref}>
                  <Info size={15} />
                </Link>
              </div>
            )
          )}
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
          <div className="shell__topbar-summary">
            <p className="shell__topbar-label">Active module</p>
            <div className="shell__topbar-title">
              <LayoutDashboard size={18} />
              <h2>{activeModule.label}</h2>
            </div>
          </div>

          <div className="shell__topbar-actions">
            <button
              aria-expanded={isMobileNavOpen}
              className="compact-toggle shell__mobile-nav-toggle"
              onClick={() => setIsMobileNavOpen((current) => !current)}
              type="button"
            >
              Pages
              <ChevronDown
                aria-hidden="true"
                className={isMobileNavOpen ? 'compact-toggle__icon compact-toggle__icon--open' : 'compact-toggle__icon'}
                size={15}
              />
            </button>
            <Link className="ui-button ui-button--secondary shell__link-button" to={activeModule.readmeHref}>
              <Info size={15} />
              Info
            </Link>
          </div>

          <nav
            className={isMobileNavOpen ? 'shell__mobile-nav shell__mobile-nav--open' : 'shell__mobile-nav'}
            aria-label="Primary"
          >
            {modules.map((module) =>
              module.external ? (
                <a className="shell__mobile-nav-link" href={module.href} key={module.href} rel="noreferrer">
                  <span className="shell__mobile-nav-icon">
                    <module.icon size={16} />
                  </span>
                  <span>{module.label}</span>
                </a>
              ) : (
                <NavLink
                  key={module.href}
                  to={module.href}
                  className={({ isActive }) =>
                    isActive ? 'shell__mobile-nav-link shell__mobile-nav-link--active' : 'shell__mobile-nav-link'
                  }
                >
                  <span className="shell__mobile-nav-icon">
                    <module.icon size={16} />
                  </span>
                  <span>{module.label}</span>
                </NavLink>
              )
            )}
          </nav>
        </header>

        <div className="shell__viewport">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
