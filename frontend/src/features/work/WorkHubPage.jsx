import { BarChart3, Clock3, FileSpreadsheet, Mail, Search, Users, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getUploads } from '../../app/services/api';
import { getLatestTickets } from '../../app/services/api';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { formatDataFileName } from '../../app/utils/fileDisplay';
import { storage } from '../../app/utils/storage';
import { getCachedWorkDataset } from './workDatasetCache';
import { setCachedWorkDataset } from './workDatasetCache';

const LAST_ACTIVITY_KEY = 'westos.work.lastHubActivity';

const coreModules = [
  {
    title: 'Active Tickets',
    description: 'Open the ticket workspace with cards, table view, and ticket drill-down.',
    href: '/app/work/active-tickets',
    icon: FileSpreadsheet,
    cta: 'Open',
    recommended: true,
  },
  {
    title: 'AI Metrics',
    description: 'Review computed metrics and generate AI summaries from your active dataset.',
    href: '/app/work/ai-metrics',
    icon: BarChart3,
    cta: 'Open',
  },
  {
    title: 'Email Uploads',
    description: 'Browse archived inbound files from the upload intake pipeline.',
    href: '/app/uploads',
    icon: Mail,
    cta: 'Open',
  },
];

const directoryModules = [
  {
    title: 'Group Search Tool',
    description: 'Run cache-first group search without leaving the work module.',
    href: '/app/work/group-search',
    icon: Search,
    cta: 'Open',
  },
  {
    title: 'Get User Groups',
    description: 'Resolve a user OPID to group memberships and cache results.',
    href: '/app/work/get-user-groups',
    icon: Users,
    cta: 'Open',
  },
  {
    title: 'User-Group Association',
    description: 'Select users, target groups, and generate an association script.',
    href: '/app/work/user-group-association',
    icon: UsersRound,
    cta: 'Open',
  },
];

function ToolCard({ module, compact = false, onOpen }) {
  return (
    <Link
      className={`ui-card work-tool-card${compact ? ' work-tool-card--compact' : ''}${module.recommended ? ' work-tool-card--recommended' : ''}`}
      onClick={() => onOpen?.(module)}
      state={{ from: '/app/work', label: 'Work Hub' }}
      to={module.href}
    >
      <div className="work-tool-card__top">
        <span className="work-tool-card__icon" aria-hidden="true">
          <module.icon size={16} />
        </span>
        <div className="work-tool-card__copy">
          <div className="work-tool-card__title-row">
            <h3>{module.title}</h3>
            {module.recommended ? <span className="ui-eyebrow">Recommended</span> : null}
          </div>
          <p title={module.description}>{module.description}</p>
        </div>
      </div>
      <span className="work-tool-card__cta">{module.cta}</span>
    </Link>
  );
}

export function WorkHubPage() {
  const [lastActivity, setLastActivity] = useState(() => storage.get(LAST_ACTIVITY_KEY) || null);
  const [latestUpload, setLatestUpload] = useState('None');
  const cachedDataset = getCachedWorkDataset();

  const quickActions = useMemo(() => coreModules.slice(0, 3), []);

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
    <section className="module">
      <SectionHeader
        tag="/app/work"
        title="Work Hub"
        description="Start with Active Tickets or review AI Metrics from your latest dataset."
      />

      <div className="work-quick-actions" role="group" aria-label="Quick actions">
        {quickActions.map((module, index) => (
          <Link
            key={module.href}
            className={`work-quick-action${index === 0 ? ' work-quick-action--primary' : ''}`}
            onClick={() => handleModuleOpen(module)}
            state={{ from: '/app/work', label: 'Work Hub' }}
            to={module.href}
          >
            <module.icon size={16} />
            <span>{module.title}</span>
          </Link>
        ))}
      </div>

      <div className="work-activity-strip">
        <span>
          <Clock3 size={14} />
          Last opened: {lastActivity?.title || 'None'}
        </span>
        <span>Last upload: {latestUpload}</span>
        <span>Recent ticket run: {formatDataFileName(cachedDataset?.fileName) || 'None'}</span>
      </div>

      <section className="work-section">
        <header className="work-section__header">
          <strong>Core Workflow</strong>
          <small>Primary launch points for ticket analysis</small>
        </header>
        <div className="work-tools-grid">
          {coreModules.map((module) => (
            <ToolCard key={module.href} module={module} onOpen={handleModuleOpen} />
          ))}
        </div>
      </section>

      <section className="work-section">
        <header className="work-section__header">
          <strong>User & Directory Tools</strong>
          <small>Directory automation and membership lookups</small>
        </header>
        <div className="work-tools-grid work-tools-grid--compact">
          {directoryModules.map((module) => (
            <ToolCard key={module.href} compact module={module} onOpen={handleModuleOpen} />
          ))}
        </div>
      </section>
    </section>
  );
}
