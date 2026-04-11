import {
  Blocks,
  BrainCircuit,
  FileSpreadsheet,
  HeartPulse,
  Info,
  Network,
  ScanSearch,
  ServerCog,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';
import { Card, CardHeader } from '../../app/ui/Card';
import { SectionHeader } from '../../app/ui/SectionHeader';

const moduleSections = [
  {
    id: 'life',
    tag: 'Module',
    title: 'Life',
    icon: HeartPulse,
    description:
      'Personal systems stay separated from work operations so the app can hold private routines without leaking them into the operational surface.',
    points: [
      'Route: `/app/life`',
      'Purpose: a compact home for personal systems, commitments, and household workflows',
      'Current UI: lightweight cards that define the lane without overbuilding it',
    ],
  },
  {
    id: 'work',
    tag: 'Module',
    title: 'Work',
    icon: Blocks,
    description:
      'The operational workspace for the work hub, active ticket intake, metrics review, and recent analysis recall.',
    points: [
      'Hub route: `/app/work`',
      'Active tickets route: `/app/work/active-tickets`',
      'AI metrics route: `/app/work/ai-metrics`',
      'Flow: upload CSV -> parse rows -> normalize headers -> cache dataset -> render active tickets',
      'Detail view: `/tickets/:ticketId` with metadata, combined notes, and manual AI analysis',
    ],
  },
  {
    id: 'ai',
    tag: 'Module',
    title: 'AI',
    icon: BrainCircuit,
    description:
      'The external Open WebUI workspace remains available as a separate environment for direct model interaction outside the structured ticket flow.',
    points: [
      'Entry: `https://webui.westos.dev`',
      'Role: freeform model workspace separate from the app-specific AI workflow',
      'Current backend path: app AI requests now route through backend and can bypass the gateway',
    ],
  },
  {
    id: 'console',
    tag: 'Module',
    title: 'Console',
    icon: TerminalSquare,
    description:
      'A narrow runtime surface for health visibility across backend, AI path, and frontend services.',
    points: [
      'Route: `/app/console`',
      'Purpose: expose service health and environment signals without becoming a full admin panel',
      'Data source: backend system status endpoint',
    ],
  },
];

const architectureCards = [
  {
    title: 'Frontend',
    icon: Sparkles,
    body: 'React with React Router drives the shell, module pages, ticket detail route, and the in-browser dataset cache used for ticket navigation.',
  },
  {
    title: 'Backend',
    icon: ServerCog,
    body: 'Flask owns CSV analysis, system status, and AI routes. It now exposes `/api/ai/*` directly while preserving the same response contract used by the frontend.',
  },
  {
    title: 'AI Path',
    icon: ScanSearch,
    body: 'AI requests can use a feature toggle. With `USE_AI_GATEWAY=false`, the backend calls Ollama directly. With `true`, the gateway remains available as a fallback.',
  },
  {
    title: 'Data Shape',
    icon: FileSpreadsheet,
    body: 'CSV headers are normalized before rows are mapped, which keeps downstream ticket logic stable even when the source file uses ServiceNow-style prefixes.',
  },
];

const workflowSteps = [
  'Open the Work hub and launch Active Tickets.',
  'Backend analyzes the file and frontend caches the parsed dataset for interactive use.',
  'Only active tickets are surfaced as cards in the work module.',
  'Selecting a ticket opens `/tickets/:ticketId` for a full-page detail view.',
  'AI analysis runs only on button click and writes results back into `ticket.ai_analysis` in the cached dataset.',
];

const structureItems = [
  '`frontend/src/app` contains the shell, router, shared UI primitives, and API helpers.',
  '`frontend/src/features/*` contains module-specific pages and logic.',
  '`frontend/src/features/work` carries the CSV, ticket, note, and AI prompt logic for work operations.',
  '`backend/app/routes` exposes Flask endpoints while `backend/app/services` holds reusable processing logic.',
  '`caddy/Caddyfile` defines the public edge routing for frontend, backend APIs, and the WebUI domain.',
];

export function ReadmePage() {
  return (
    <section className="module readme-page">
      <SectionHeader
        tag="/readme"
        title="Project Readme"
        description="A structured guide to how the app is organized, what each module does, and how data moves through the system."
      />

      <Card className="readme-hero" tone="emerald">
        <CardHeader
          eyebrow="Overview"
          title="westOS at a glance"
          description="This app is a multi-module control surface. The frontend keeps module boundaries clear, the backend exposes operational APIs, and the AI path is modular enough to switch between direct Ollama and gateway-backed calls."
        />
        <div className="readme-hero__meta">
          <div className="readme-stat">
            <span>Frontend</span>
            <strong>React + Router</strong>
          </div>
          <div className="readme-stat">
            <span>Backend</span>
            <strong>Flask APIs</strong>
          </div>
          <div className="readme-stat">
            <span>AI</span>
            <strong>Ollama direct or gateway</strong>
          </div>
          <div className="readme-stat">
            <span>Primary work input</span>
            <strong>CSV ticket datasets</strong>
          </div>
        </div>
      </Card>

      <div className="readme-grid">
        {architectureCards.map((item) => (
          <Card className="readme-panel" key={item.title}>
            <div className="readme-panel__icon">
              <item.icon size={18} />
            </div>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </Card>
        ))}
      </div>

      <div className="readme-layout">
        <Card className="readme-toc">
          <CardHeader eyebrow="Navigate" title="Sections" description="Jump straight to the module or system area you want." />
          <nav className="readme-toc__links" aria-label="Readme sections">
            <a href="#architecture">Architecture</a>
            <a href="#structure">Project structure</a>
            <a href="#workflows">Primary workflows</a>
            {moduleSections.map((section) => (
              <a href={`#${section.id}`} key={section.id}>
                {section.title}
              </a>
            ))}
          </nav>
        </Card>

        <div className="readme-sections">
          <Card className="readme-section" id="architecture">
            <CardHeader
              eyebrow="System"
              title="Architecture"
              description="The app is intentionally split into clean layers so UI behavior, backend services, and AI processing can evolve without forcing a rewrite."
            />
            <div className="readme-callout">
              <Network size={18} />
              <p>
                Public requests enter through Caddy. The frontend renders module views, the backend owns operational routes, and the AI path can switch between backend-direct Ollama and the legacy gateway path with an environment toggle.
              </p>
            </div>
          </Card>

          <Card className="readme-section" id="structure">
            <CardHeader
              eyebrow="Codebase"
              title="Project structure"
              description="The repo is organized by responsibility rather than by one oversized application layer."
            />
            <ul className="readme-list">
              {structureItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Card>

          <Card className="readme-section" id="workflows">
            <CardHeader
              eyebrow="Behavior"
              title="Primary workflows"
              description="The most important operational path today is the ticket analysis flow in the Work module."
            />
            <ol className="readme-steps">
              {workflowSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </Card>

          {moduleSections.map((section) => (
            <Card className="readme-section" id={section.id} key={section.id}>
              <CardHeader
                eyebrow={section.tag}
                title={section.title}
                description={section.description}
                action={
                  <div className="readme-section__badge">
                    <section.icon size={16} />
                    <span>{section.title}</span>
                  </div>
                }
              />
              <ul className="readme-list">
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </Card>
          ))}

          <Card className="readme-section">
            <CardHeader
              eyebrow="Reference"
              title="Current design principles"
              description="A few rules shape the code and the product surface."
            />
            <div className="readme-principles">
              <div>
                <Info size={16} />
                <p>Preserve working flows and extend them instead of rewriting them.</p>
              </div>
              <div>
                <Blocks size={16} />
                <p>Keep ticket operations modular so parsing, note formatting, and AI analysis stay reusable.</p>
              </div>
              <div>
                <BrainCircuit size={16} />
                <p>Let AI stay optional and explicit. Ticket analysis is manual, cached, and visible to the user.</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
