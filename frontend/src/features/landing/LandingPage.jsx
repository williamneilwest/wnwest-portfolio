import { ArrowRight, Blocks, BrainCircuit, HeartPulse, ShieldCheck } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { modules } from '../../app/shell/modules';

const entrypoints = [
  {
    href: '/app/life',
    title: 'LifeOS',
    description: 'Focused operational space for personal systems and recurring loops.',
    icon: HeartPulse
  },
  {
    href: '/csv',
    title: 'CSV Tools',
    description: 'Turn exported operational files into a fast summary instead of a manual review.',
    icon: Blocks
  },
  {
    href: 'https://webui.westos.dev',
    title: 'AI Workspace',
    description: 'Open WebUI runs on its own host while the gateway stays behind the app API boundary.',
    icon: BrainCircuit,
    external: true
  }
];

export function LandingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentModule = modules.find((m) => location.pathname.startsWith(m.href));

  function onMobileNavChange(e) {
    const value = e.target.value;
    if (value) navigate(value);
  }

  return (
    <section className="landing">
      {/* Mobile-only compact top bar with dropdown navigation (shown on all pages) */}
      <div className="shell__mobile-topbar" role="navigation" aria-label="Mobile page selector">
        <select
          className="shell__mobile-select"
          value={currentModule?.href || ''}
          onChange={onMobileNavChange}
          aria-label="Select page"
        >
          {!currentModule && (
            <option value="" disabled>
              westOS
            </option>
          )}
          {modules.map((m) => (
            <option key={m.href} value={m.href}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="landing__hero">
        <span className="shell__eyebrow">westos.dev</span>
        <h1>WestOS</h1>
        <p>
          One control surface for the homelab stack. The frontend, backend, and AI gateway stay behind a single
          domain with clean path-based routing!!
        </p>

        <div className="landing__actions">
          <Link className="ui-button ui-button--primary" to="/app/life">
            Open App
            <ArrowRight size={15} />
          </Link>
          <Link className="ui-button ui-button--secondary" to="/csv">
            Open CSV Tools
          </Link>
        </div>
      </div>

      <div className="landing__grid">
        {entrypoints.map((entrypoint) =>
          entrypoint.external ? (
            <a className="ui-card landing__card" href={entrypoint.href} key={entrypoint.href} rel="noreferrer">
              <div className="icon-badge">
                <entrypoint.icon size={18} />
              </div>
              <h2>{entrypoint.title}</h2>
              <p>{entrypoint.description}</p>
            </a>
          ) : (
            <Link className="ui-card landing__card" key={entrypoint.href} to={entrypoint.href}>
              <div className="icon-badge">
                <entrypoint.icon size={18} />
              </div>
              <h2>{entrypoint.title}</h2>
              <p>{entrypoint.description}</p>
            </Link>
          )
        )}
      </div>

      <div className="ui-card landing__footer">
        <div className="signal-panel__item">
          <span className="icon-badge">
            <ShieldCheck size={16} />
          </span>
          <div>
            <strong>Single-domain development</strong>
            <p>All browser traffic resolves through `westos.dev`, which keeps TLS and CORS simple during iteration.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
