import { ArrowRight, Blocks, BrainCircuit, BookText, HeartPulse, TerminalSquare, BriefcaseBusiness } from 'lucide-react';
import { Link } from 'react-router-dom';

const primaryAction = {
  href: '/app',
  label: 'Enter System'
};

const secondaryActions = [
  { href: '/app/data', label: 'Data Tools' },
  { href: '/app/ai', label: 'AI Workspace' },
  { href: '/app/work', label: 'Work Console' }
];

const systemModules = [
  {
    href: '/app/life',
    title: 'LifeOS',
    description: 'Personal systems, routines, and private operating loops.',
    icon: HeartPulse
  },
  {
    href: '/app/work',
    title: 'Work Console',
    description: 'Operational workflows, datasets, and ticket-driven tools.',
    icon: BriefcaseBusiness
  },
  {
    href: '/app/data',
    title: 'Data Tools',
    description: 'Upload files and run modular data tools by document type.',
    icon: Blocks
  },
  {
    href: '/app/ai',
    title: 'AI Control',
    description: 'Model access, AI runs, and interaction monitoring.',
    icon: BrainCircuit
  },
  {
    href: '/app/kb',
    title: 'Knowledge Base',
    description: 'Stored references, documents, and indexed context.',
    icon: BookText
  },
  {
    href: '/app/console',
    title: 'Logs',
    description: 'System health, runtime visibility, and service logs.',
    icon: TerminalSquare
  }
];

const systemStatus = [
  'Unified domain routing (westos.dev)',
  'AI gateway active',
  'CSV + email ingestion enabled',
  'Live AI analysis + token tracking',
  'Hybrid AI (local + external)'
];

export function LandingPage() {
  return (
    <section className="landing">
      <header className="ui-card landing__hero landing__panel">
        <div className="landing__hero-copy">
          <span className="shell__eyebrow">Public surface</span>
          <span className="landing__access">Access level: Public (temporary)</span>
          <h1>WESTOS.DEV</h1>
          <p>
            What you&rsquo;re about to access is not a typical app.
            <br />
            <br />
            This is a live control surface for systems, data, and AI-assisted workflows.
            <br />
            Some tools are personal. Some are experimental. All of them do something real.
          </p>
        </div>

        <div className="landing__actions">
          <Link className="ui-button ui-button--primary" to={primaryAction.href}>
            {primaryAction.label}
            <ArrowRight size={15} />
          </Link>
          {secondaryActions.map((action) => (
            <Link className="ui-button ui-button--secondary" key={action.href} to={action.href}>
              {action.label}
            </Link>
          ))}
        </div>
      </header>

      <section className="landing__section">
        <div className="landing__section-header">
          <span className="shell__eyebrow">Modules</span>
          <h2>System Modules</h2>
        </div>

        <div className="landing__module-grid">
          {systemModules.map((module) => (
            <Link className="ui-card landing__module-card" key={module.href} to={module.href}>
              <div className="landing__module-top">
                <span className="icon-badge landing__module-icon">
                  <module.icon size={18} />
                </span>
                <ArrowRight size={15} />
              </div>
              <div className="landing__module-copy">
                <h3>{module.title}</h3>
                <p>{module.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="ui-card landing__status-panel landing__panel">
        <div className="landing__section-header landing__section-header--compact">
          <span className="shell__eyebrow">Runtime</span>
          <h2>System Status</h2>
        </div>
        <ul className="landing__status-list">
          {systemStatus.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}
