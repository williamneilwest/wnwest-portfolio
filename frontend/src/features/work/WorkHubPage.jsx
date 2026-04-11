import { BarChart3, FileSpreadsheet, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardHeader } from '../../app/ui/Card';
import { SectionHeader } from '../../app/ui/SectionHeader';

const workModules = [
  {
    title: 'Active Tickets',
    description: 'Open the full ticket CSV workspace with upload, recent runs, ticket cards, table view, and ticket drill-down.',
    href: '/app/work/active-tickets',
    icon: FileSpreadsheet,
    cta: 'Open Active Tickets',
  },
  {
    title: 'AI Metrics',
    description: 'Review the computed ticket metrics and generate the AI summary built from the currently cached active dataset.',
    href: '/app/work/ai-metrics',
    icon: BarChart3,
    cta: 'Open AI Metrics',
  },
  {
    title: 'Email Uploads',
    description: 'Browse files saved from inbound email intake and verify archived attachments delivered through SendGrid.',
    href: '/app/uploads',
    icon: Mail,
    cta: 'Open Uploads',
  },
];

export function WorkHubPage() {
  return (
    <section className="module">
      <SectionHeader
        tag="/app/work"
        title="Work Hub"
        description="Central routing for work-related tools. Open the ticket workspace, inspect AI metrics, or review archived inbound uploads."
      />

      <div className="card-grid">
        {workModules.map((module) => (
          <Card className="landing__card" key={module.href}>
            <CardHeader
              eyebrow="Work Module"
              title={module.title}
              description={module.description}
            />
            <div className="landing__actions">
              <span className="icon-badge">
                <module.icon size={18} />
              </span>
              <Link className="ui-button ui-button--secondary" to={module.href}>
                {module.cta}
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
