import {
  Clock3,
  FileSpreadsheet,
  HardDrive,
  BookOpen,
  Link2,
  Mail,
  Monitor,
  Printer,
  Search,
  Shield,
  Ticket,
  User,
  Users,
  Wrench,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getLatestTickets, getUploads } from '../../app/services/api';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { formatDataFileName } from '../../app/utils/fileDisplay';
import { storage } from '../../app/utils/storage';
import { getCachedWorkDataset, setCachedWorkDataset } from './workDatasetCache';

const LAST_ACTIVITY_KEY = 'westos.work.lastHubActivity';

const domainCards = [
  {
    title: 'Active Tickets',
    description: 'Card-based triage view with fast ticket inspection and panel details.',
    icon: FileSpreadsheet,
    href: '/app/work/active-tickets',
  },
  {
    title: 'Users',
    description: 'User identity, groups, and account actions.',
    icon: Users,
    href: '/app/work/users',
  },
  {
    title: 'Devices',
    description: 'Computer lookup, assignment checks, and operational context.',
    icon: Monitor,
    href: '/app/work/devices',
  },
  {
    title: 'Printers',
    description: 'Printer registration and group-driven assignment workflow.',
    icon: Printer,
    href: '/app/work/printers',
  },
  {
    title: 'Software',
    description: 'Application checks and deployment support actions.',
    icon: HardDrive,
    href: '/app/work/software',
  },
  {
    title: 'Hardware',
    description: 'Asset lookup and supporting investigation tooling.',
    icon: Shield,
    href: '/app/work/hardware',
  },
];

const quickActionChips = [
  { label: 'Register Printer', href: '/app/work/printers', icon: Printer },
  { label: 'Lookup User', href: '/app/work/users', icon: Users },
  { label: 'Lookup Device', href: '/app/work/groups', icon: Search },
  { label: 'Open KB', href: '/app/kb', icon: BookOpen },
  { label: 'Upload CSV', href: '/app/uploads', icon: FileSpreadsheet },
  { label: 'Run Script', href: '/app/work/users', icon: Wrench },
];

const externalLinks = [
  { label: 'ServiceNow', href: '/app/work/active-tickets' },
  { label: 'Graph Explorer', href: '/app/reference' },
  { label: 'Internal Dashboards', href: '/app/work/ai-metrics' },
];

function CollapsibleSection({ title, subtitle, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="work-hub-section">
      <header className="work-hub-section__header">
        <div>
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </div>
        <button
          type="button"
          className={open ? 'compact-toggle compact-toggle--active' : 'compact-toggle'}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? 'Collapse' : 'Expand'}
        </button>
      </header>
      {open ? <div className="work-hub-section__body">{children}</div> : null}
    </section>
  );
}

function DomainCard({ domain, onOpen }) {
  return (
    <Link
      className="ui-card work-domain-card work-domain-card--nav"
      to={domain.href}
      onClick={() => onOpen({ title: domain.title, href: domain.href })}
      state={{ from: '/app/work', label: 'Work Hub' }}
    >
      <div className="work-domain-card__head">
        <span className="work-domain-card__icon" aria-hidden="true">
          <domain.icon size={16} />
        </span>
        <div>
          <h3>{domain.title}</h3>
          <p>{domain.description}</p>
        </div>
      </div>
      <small className="work-domain-card__hint">Click to open</small>
    </Link>
  );
}

export function WorkHubPage() {
  const [lastActivity, setLastActivity] = useState(() => storage.get(LAST_ACTIVITY_KEY) || null);
  const [latestUpload, setLatestUpload] = useState('None');
  const cachedDataset = getCachedWorkDataset();

  useEffect(() => {
    if (cachedDataset?.rows?.length) {
      return;
    }

    let isMounted = true;
    async function warmActiveTicketCache() {
      try {
        const payload = await getLatestTickets();
        if (!isMounted) {
          return;
        }
        const latestTicketsPayload = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
        const columns = Array.isArray(latestTicketsPayload?.columns) ? latestTicketsPayload.columns : [];
        const rows = Array.isArray(latestTicketsPayload?.tickets) ? latestTicketsPayload.tickets : [];
        if (!rows.length) {
          return;
        }
        setCachedWorkDataset({
          fileName: String(latestTicketsPayload?.fileName || 'ActiveTicketsLAH.csv').trim() || 'ActiveTicketsLAH.csv',
          columns,
          rows,
        });
      } catch {
        // Warm-cache failures should never block hub UX.
      }
    }

    void warmActiveTicketCache();
    return () => {
      isMounted = false;
    };
  }, [cachedDataset?.rows?.length]);

  useEffect(() => {
    let isMounted = true;

    getUploads()
      .then((files) => {
        if (!isMounted) {
          return;
        }

        const items = Array.isArray(files) ? files : [];
        if (!items.length) {
          setLatestUpload('None');
          return;
        }

        const latest = [...items].sort((left, right) => {
          const leftTime = Date.parse(left.modifiedAt || '') || 0;
          const rightTime = Date.parse(right.modifiedAt || '') || 0;
          return rightTime - leftTime;
        })[0];

        setLatestUpload(formatDataFileName(latest?.filename) || 'Unknown file');
      })
      .catch(() => {
        if (isMounted) {
          setLatestUpload('Unavailable');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  function handleModuleOpen(module) {
    const next = {
      title: module.title,
      href: module.href,
      openedAt: new Date().toISOString(),
    };
    setLastActivity(next);
    storage.set(LAST_ACTIVITY_KEY, next);
  }

  return (
    <section className="module work-hub-cockpit">
      <SectionHeader
        tag="/app/work"
        title="Work Hub"
      />

      <CollapsibleSection
        title="Core Domains"
        subtitle="Primary operational domains grouped by responsibility."
      >
        <div className="work-domain-grid">
          {domainCards.map((domain) => (
            <DomainCard key={domain.title} domain={domain} onOpen={handleModuleOpen} />
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Quick Actions"
        subtitle="Run common actions immediately without navigating deeper."
      >
        <div className="work-chip-row" role="group" aria-label="Quick action chips">
          {quickActionChips.map((item) => (
            <Link
              key={item.label}
              className="work-action-chip"
              to={item.href}
              onClick={() => handleModuleOpen({ title: item.label, href: item.href })}
              state={{ from: '/app/work', label: 'Work Hub' }}
            >
              <item.icon size={13} />
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      </CollapsibleSection>

      <details className="work-links-panel">
        <summary>
          <Link2 size={14} />
          <span>Quick Links</span>
        </summary>
        <div className="work-links-panel__body">
          {externalLinks.map((item) => (
            <Link
              key={item.label}
              to={item.href}
              onClick={() => handleModuleOpen({ title: item.label, href: item.href })}
              state={{ from: '/app/work', label: 'Work Hub' }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </details>

      <div className="work-activity-strip">
        <span>
          <Clock3 size={14} />
          Last opened: {lastActivity?.title || 'None'}
        </span>
        <span>Recent ticket run: {formatDataFileName(cachedDataset?.fileName) || 'None'}</span>
        <span>
          <Mail size={14} />
          Last upload: {latestUpload}
        </span>
      </div>
    </section>
  );
}
