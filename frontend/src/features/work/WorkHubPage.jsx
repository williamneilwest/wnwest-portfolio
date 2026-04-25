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
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getLatestTickets, getUploads } from '../../app/services/api';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { formatDataFileName } from '../../app/utils/fileDisplay';
import { storage } from '../../app/utils/storage';
import { WorkCard } from './components/WorkCard';
import { WorkQuickActions } from './components/WorkQuickActions';
import { WorkSection } from './components/WorkSection';
import { getCachedWorkDataset, setCachedWorkDataset } from './workDatasetCache';

const LAST_ACTIVITY_KEY = 'westos.work.lastHubActivity';

const groupedSections = [
  {
    title: 'Core Work',
    description: 'The main ticket queues and review surfaces used throughout the day.',
    prominent: true,
    items: [
      {
        title: 'Active Tickets',
        description: 'Open the active triage workspace for ticket review, notes, and summary actions.',
        icon: FileSpreadsheet,
        href: '/app/work/active-tickets',
      },
      {
        title: 'Closed Tickets',
        description: 'Review resolved and closed work with filters for assignee, timing, and follow-up.',
        icon: CheckCircle2,
        href: '/app/work/closed-tickets',
      },
    ],
  },
  {
    title: 'Users & Access',
    description: 'Jump into user lookup, group context, and user-adjacent device checks.',
    items: [
      {
        title: 'Search User',
        description: 'Open user search and review identity, groups, and nearby account actions.',
        icon: Search,
        href: '/app/work/users',
      },
      {
        title: 'Groups',
        description: 'Inspect membership and access context when group-based troubleshooting is needed.',
        icon: Users,
        href: '/app/work/users',
      },
      {
        title: 'Devices',
        description: 'Move from user context into device lookup when endpoint ownership matters.',
        icon: Monitor,
        href: '/app/work/devices',
      },
    ],
  },
  {
    title: 'Hardware',
    description: 'Lookup and operational pages for endpoints, assets, and printer workflows.',
    items: [
      {
        title: 'Devices',
        description: 'Open the device workspace for computer lookup, assignment checks, and context.',
        icon: Monitor,
        href: '/app/work/devices',
      },
      {
        title: 'Hardware',
        description: 'Review asset data and supporting hardware investigation tools.',
        icon: Shield,
        href: '/app/work/hardware',
      },
      {
        title: 'Printers',
        description: 'Handle printer registration and assignment workflows from one place.',
        icon: Printer,
        href: '/app/work/printers',
      },
    ],
  },
  {
    title: 'Tools',
    description: 'Secondary utilities for software checks, codes, and knowledge reference.',
    compact: true,
    items: [
      {
        title: 'Software',
        description: 'Open the software workspace and registry tools.',
        icon: HardDrive,
        href: '/app/work/software',
      },
      {
        title: 'Codes',
        description: 'Create and store QR or barcode assets from text or file input.',
        icon: Barcode,
        href: '/app/work/codes',
      },
      {
        title: 'Knowledge Base',
        description: 'Jump into the knowledge base and reference content.',
        icon: BookOpen,
        href: '/app/kb',
      },
    ],
  },
];

const quickActionChips = [
  { label: 'Active Tickets', href: '/app/work/active-tickets', icon: FileSpreadsheet, primary: true },
  { label: 'Lookup User', href: '/app/work/users', icon: Search },
  { label: 'Upload CSV', href: '/app/uploads', icon: Upload },
];

const externalLinks = [
  { label: 'ServiceNow', href: '/app/work/active-tickets' },
  { label: 'Graph Explorer', href: '/app/reference' },
  { label: 'Internal Dashboards', href: '/app/work/ai-metrics' },
];

export function WorkHubPage() {
  const [lastActivity, setLastActivity] = useState(() => storage.get(LAST_ACTIVITY_KEY) || null);
  const [latestUpload, setLatestUpload] = useState('None');
  const [searchValue, setSearchValue] = useState('');
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

      <WorkQuickActions
        actions={quickActionChips}
        onOpen={handleModuleOpen}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
      />

      <div className="work-hub-domain-sections">
        {groupedSections.map((section) => (
          <WorkSection
            key={section.title}
            title={section.title}
            description={section.description}
            compact={section.compact}
            prominent={section.prominent}
          >
            <div className={`work-domain-grid${section.prominent ? ' work-domain-grid--core' : ''}`}>
              {section.items.map((item) => (
                <WorkCard
                  key={`${section.title}-${item.title}`}
                  item={item}
                  onOpen={handleModuleOpen}
                  featured={section.prominent}
                />
              ))}
            </div>
          </WorkSection>
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
