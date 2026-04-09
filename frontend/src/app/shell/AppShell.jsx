import {
  Activity,
  ArrowUpRight,
  Blocks,
  BrainCircuit,
  HeartPulse,
  LayoutDashboard,
  Sparkles,
  TerminalSquare
} from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

const modules = [
  { href: '/app/life', label: 'Life', summary: 'Personal systems', icon: HeartPulse },
  { href: '/csv', label: 'CSV', summary: 'Operational file tools', icon: Blocks },
  { href: '/ai', label: 'AI', summary: 'Gateway and automation', icon: BrainCircuit },
  { href: '/app/console', label: 'Console', summary: 'Service status', icon: TerminalSquare }
];

export function AppShell() {
  const location = useLocation();
  const activeModule = modules.find((module) => location.pathname.startsWith(module.href)) || modules[0];

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
          {modules.map((module) => (
            <NavLink
              key={module.href}
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
          <div>
            <p className="shell__topbar-label">Active module</p>
            <div className="shell__topbar-title">
              <LayoutDashboard size={18} />
              <h2>{activeModule.label}</h2>
            </div>
          </div>

          <div className="shell__topbar-actions">
            <a
              className="ui-button ui-button--secondary shell__link-button"
              href="/health"
              rel="noreferrer"
              target="_blank"
            >
              Backend
              <ArrowUpRight size={15} />
            </a>
            <a
              className="ui-button ui-button--secondary shell__link-button"
              href="/ai/health"
              rel="noreferrer"
              target="_blank"
            >
              AI Gateway
              <ArrowUpRight size={15} />
            </a>
          </div>
        </header>

        <div className="shell__viewport">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
