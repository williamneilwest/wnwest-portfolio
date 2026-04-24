import {
  Barcode,
  CheckCircle2,
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
  Upload,
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

const groupedSections = [
  {
    title: 'Tickets',
    description: 'Open ticket workspaces for active and closed ticket review.',
    items: [
      {
        title: 'Active Tickets',
        description: 'Card-based triage view with fast ticket inspection and panel details.',
        icon: FileSpreadsheet,
        href: '/app/work/active-tickets',
      },
      {
        title: 'Closed Tickets',
        description: 'Separate closed and resolved ticket review with assignee and timeframe filters.',
        icon: CheckCircle2,
        href: '/app/work/closed-tickets',
      },
    ],
  },
  {
    title: 'Hardware',
    description: 'Lookup and operational pages for endpoints, assets, and printers.',
    items: [
      {
        title: 'Devices',
        description: 'Computer lookup, assignment checks, and operational context.',
        icon: Monitor,
        href: '/app/work/devices',
      },
      {
        title: 'Hardware',
        description: 'Asset lookup and supporting investigation tooling.',
        icon: Shield,
        href: '/app/work/hardware',
      },
      {
        title: 'Printers',
        description: 'Printer registration and group-driven assignment workflow.',
        icon: Printer,
        href: '/app/work/printers',
      },
    ],
  },
  {
    title: 'Users & Groups',
    description: 'Identity, group lookup, and user-centered work actions.',
    items: [
      {
        title: 'Users',
        description: 'User identity, groups, and account actions.',
        icon: Users,
        href: '/app/work/users',
      },
      {
        title: 'Lookup User',
        description: 'Open user search and group membership context.',
        icon: Search,
        href: '/app/work/users',
      },
      {
        title: 'Lookup Device',
        description: 'Jump into device lookup when working from user context.',
        icon: Monitor,
        href: '/app/work/devices',
      },
    ],
  },
  {
    title: 'Software',
    description: 'Application checks and deployment support actions.',
    items: [
      {
        title: 'Software',
        description: 'Open the software workspace and registry tools.',
        icon: HardDrive,
        href: '/app/work/software',
      },
    ],
  },
  {
    title: 'Other Tools',
    description: 'Utilities, uploads, scripts, codes, and knowledge resources.',
    items: [
      {
        title: 'Codes',
        description: 'Create and store QR/barcodes from text or uploads.',
        icon: Barcode,
        href: '/app/work/codes',
      },
      {
        title: 'Upload CSV',
        description: 'Open uploads and manage CSV inputs for work tools.',
        icon: Upload,
        href: '/app/uploads',
      },
      {
        title: 'Run Script',
        description: 'Open the existing script-related workflow entry point.',
        icon: Wrench,
        href: '/app/work/users',
      },
      {
        title: 'Open KB',
        description: 'Jump into the knowledge base and reference content.',
        icon: BookOpen,
        href: '/app/kb',
      },
    ],
  },
];

const quickActionChips = [
  { label: 'Active Tickets', href: '/app/work/active-tickets', icon: FileSpreadsheet },
  { label: 'Closed Tickets', href: '/app/work/closed-tickets', icon: CheckCircle2 },
  { label: 'Hardware', href: '/app/work/hardware', icon: Shield },
  { label: 'Register Printer', href: '/app/work/printers', icon: Printer },
  { label: 'Lookup User', href: '/app/work/users', icon: Users },
  { label: 'Lookup Device', href: '/app/work/devices', icon: Search },
  { label: 'Open KB', href: '/app/kb', icon: BookOpen },
  { label: 'Software', href: '/app/work/software', icon: HardDrive },
  { label: 'Codes', href: '/app/work/codes', icon: Barcode },
  { label: 'Upload CSV', href: '/app/uploads', icon: Upload },
  { label: 'Run Script', href: '/app/work/users', icon: Wrench },
];

const externalLinks = [
  { label: 'ServiceNow', href: '/app/work/active-tickets' },
  { label: 'Graph Explorer', href: '/app/reference' },
  { label: 'Internal Dashboards', href: '/app/work/ai-metrics' },
];

function DomainSection({ title, description, children }) {
  return (
    <section className="work-hub-domain-section">
      <header className="work-hub-domain-section__header">
        <div>
          <strong>{title}</strong>
          {description ? <small>{description}</small> : null}
        </div>
      </header>
      <div className="work-hub-domain-section__body">{children}</div>
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

      <section className="work-hub-section">
        <header className="work-hub-section__header">
          <div>
            <strong>Quick Actions</strong>
            <small>Run common actions immediately without navigating deeper.</small>
          </div>
        </header>
        <div className="work-hub-section__body">
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
        </div>
      </section>

      <div className="work-hub-domain-sections">
        {groupedSections.map((section) => (
          <DomainSection
            key={section.title}
            title={section.title}
            description={section.description}
          >
            <div className="work-domain-grid">
              {section.items.map((domain) => (
                <DomainCard key={`${section.title}-${domain.title}`} domain={domain} onOpen={handleModuleOpen} />
              ))}
            </div>
          </DomainSection>
        ))}
      </div>

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
