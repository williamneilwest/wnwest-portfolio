import { ArrowRight, Tag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../../app/ui/EmptyState';
import { formatColumnLabel, resolveField } from './utils';
import { linkifyText } from '../../utils/linkifyText';
import { isUsableUserValue, openUserRecord } from '../../features/work/utils/userLinks';

function pickMetaFields(columns = [], excluded = []) {
  return columns.filter((column) => !excluded.includes(column)).slice(0, 3);
}

const TICKET_FIELD_MAP = {
  ticket: ['number', 'ticket', 'u_task_1', 'u_task_1.number'],
  short_description: ['short_description', 'u_task_1.short_description'],
  assigned_to: ['assigned_to', 'u_task_1.assigned_to'],
  priority: ['priority', 'u_task_1.priority'],
  impacted_user: ['u_impacted_user', 'impacted_user', 'caller_id', 'u_task_1.u_impacted_user'],
  location: ['location', 'u_location', 'site', 'site_name', 'u_task_1.location'],
  device: ['cmdb_ci', 'device', 'configuration_item', 'u_task_1.cmdb_ci'],
  opened_at: ['opened_at', 'sys_created_on', 'created_on', 'opened', 'u_task_1.sys_created_on', 'u_task_1.opened_at'],
  updated_at: ['sys_updated_on', 'updated_at', 'last_updated', 'u_task_1.sys_updated_on'],
};

function resolveFromCandidates(row, candidates = [], fallbackColumns = []) {
  for (const candidate of candidates) {
    const value = row?.[candidate];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value);
    }
  }
  return resolveField(row, '', fallbackColumns);
}

function getPriorityTone(priority) {
  const normalized = String(priority || '').trim().toLowerCase();
  if (/^1$|p1|critical/.test(normalized)) return 'critical';
  if (/^2$|p2|high/.test(normalized)) return 'high';
  if (/^3$|p3|medium|moderate/.test(normalized)) return 'medium';
  if (/^4$|p4|low/.test(normalized)) return 'low';
  return 'low';
}

function getPriorityLabel(priority) {
  const raw = String(priority || '').trim();
  const normalized = raw.toLowerCase();
  if (/^1$|p1|critical/.test(normalized)) return 'P1';
  if (/^2$|p2|high/.test(normalized)) return 'P2';
  if (/^3$|p3|medium|moderate/.test(normalized)) return 'P3';
  if (/^4$|p4|low/.test(normalized)) return 'P4';
  if (/^5$|p5/.test(normalized)) return 'P5';
  return raw || 'P?';
}

function formatRelativeAge(value) {
  const parsed = Date.parse(String(value || '').trim());
  if (Number.isNaN(parsed)) {
    return 'Age n/a';
  }

  const diffMs = Math.max(0, Date.now() - parsed);
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  if (days > 0) {
    return `Age ${days}d`;
  }
  if (totalHours > 0) {
    return `Age ${totalHours}h`;
  }
  const mins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
  return `Age ${mins}m`;
}

function formatUpdatedLabel(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 'Updated n/a';
  }

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    return text;
  }
  return new Date(parsed).toLocaleString();
}

function formatCreatedLabel(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 'Created n/a';
  }

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    return text;
  }

  return `Created ${new Date(parsed).toLocaleDateString()}`;
}

function toTitleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function parseAssigneeName(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase() === 'unassigned') {
    return { first: '', lastInitial: '' };
  }

  if (raw.includes(',')) {
    const [lastPart, firstPart] = raw.split(',').map((item) => item.trim()).filter(Boolean);
    const firstToken = String(firstPart || '').split(/\s+/).find(Boolean) || '';
    const lastToken = String(lastPart || '').split(/\s+/).find(Boolean) || '';
    return {
      first: toTitleCase(firstToken),
      lastInitial: lastToken ? toTitleCase(lastToken[0]) : '',
    };
  }

  const source = raw.includes('@') ? raw.split('@')[0] : raw;
  const tokens = source
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  const firstToken = tokens[0] || '';
  const lastToken = tokens.length > 1 ? tokens[tokens.length - 1] : '';

  return {
    first: toTitleCase(firstToken),
    lastInitial: lastToken ? toTitleCase(lastToken[0]) : '',
  };
}

function formatAssigneeDisplay(value, duplicateFirstNames) {
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase() === 'unassigned') {
    return 'Unassigned';
  }

  const parsed = parseAssigneeName(raw);
  const first = parsed.first;
  if (!first) {
    return raw;
  }

  const firstKey = first.toLowerCase();
  if (!duplicateFirstNames.has(firstKey)) {
    return first;
  }

  if (parsed.lastInitial) {
    return `${first} ${parsed.lastInitial}`;
  }

  return first;
}

export function DataCardList({
  rows = [],
  visibleColumns = [],
  config = {},
  onRowSelect,
  selectedRow,
  rowKey,
  emptyText = 'No rows available.',
  readOnly = false,
}) {
  void readOnly;
  const navigate = useNavigate();
  if (!rows.length) {
    return <EmptyState title="No rows" description={emptyText} />;
  }

  const primaryField = config.primaryField || visibleColumns[0] || '';
  const secondaryField = config.secondaryField || visibleColumns[1] || '';
  const badgeField = config.badgeField || '';
  const hideSubtitle = Boolean(config.hideSubtitle);
  const isTicketVariant = config.variant === 'ticket';
  const duplicateFirstNames = isTicketVariant
    ? (() => {
      const counts = new Map();
      for (const row of rows) {
        const assignedTo = resolveFromCandidates(row, TICKET_FIELD_MAP.assigned_to, visibleColumns);
        const first = parseAssigneeName(assignedTo).first.toLowerCase();
        if (!first) {
          continue;
        }
        counts.set(first, (counts.get(first) || 0) + 1);
      }
      return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([first]) => first));
    })()
    : new Set();

  return (
    <div className="dataset-card-list">
      {rows.map((row, index) => {
        const key = typeof rowKey === 'function' ? rowKey(row, index) : `card-${index}`;
        const title = resolveField(row, primaryField, visibleColumns) || 'Untitled row';
        const subtitle = resolveField(row, secondaryField, visibleColumns.filter((column) => column !== primaryField));
        const badge = badgeField ? resolveField(row, badgeField, []) : '';
        const metaFields = pickMetaFields(visibleColumns, [primaryField, secondaryField, badgeField]);
        const indicators = typeof config.getIndicators === 'function' ? config.getIndicators(row) : [];
        const isSelected = selectedRow === row;
        const ticketNumber = resolveFromCandidates(row, TICKET_FIELD_MAP.ticket, [primaryField]) || 'Untitled ticket';
        const shortDescription = resolveFromCandidates(row, TICKET_FIELD_MAP.short_description, [secondaryField]);
        const priorityRaw = resolveFromCandidates(row, TICKET_FIELD_MAP.priority, [badgeField]);
        const priorityLabel = getPriorityLabel(priorityRaw);
        const priorityTone = getPriorityTone(priorityRaw);
        const impactedUser = resolveFromCandidates(row, TICKET_FIELD_MAP.impacted_user, visibleColumns) || '—';
        const location = resolveFromCandidates(row, TICKET_FIELD_MAP.location, visibleColumns) || '—';
        const device = resolveFromCandidates(row, TICKET_FIELD_MAP.device, visibleColumns) || '—';
        const assignedToRaw = resolveFromCandidates(row, TICKET_FIELD_MAP.assigned_to, visibleColumns);
        const assignedTo = formatAssigneeDisplay(assignedToRaw, duplicateFirstNames);
        const openedAt = resolveFromCandidates(row, TICKET_FIELD_MAP.opened_at, visibleColumns);
        const ageLabel = formatRelativeAge(openedAt);
        const createdLabel = formatCreatedLabel(openedAt);
        return (
          <article
            key={key}
            className={isSelected ? 'dataset-card dataset-card--selected dataset-card--ticket-compact' : 'dataset-card dataset-card--ticket-compact'}
            onClick={() => onRowSelect?.(row)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onRowSelect?.(row);
              }
            }}
            role="button"
            tabIndex={0}
          >
            {isTicketVariant ? (
              <>
                <div className="dataset-card__header dataset-card__header--ticket">
                  <strong className="dataset-card__ticket-number" title={ticketNumber}>
                    {ticketNumber}
                  </strong>
                  <div className="dataset-card__header-right">
                    <span className={`dataset-card__badge dataset-card__badge--priority dataset-card__badge--${priorityTone}`}>
                      {priorityLabel}
                    </span>
                    <span className="dataset-card__age">{ageLabel}</span>
                  </div>
                </div>

                {!hideSubtitle ? (
                  <p className="dataset-card__subtitle dataset-card__subtitle--clamped dataset-card__subtitle--ticket-only" title={shortDescription || 'No short description available'}>
                    {linkifyText(shortDescription || 'No short description available')}
                  </p>
                ) : null}

                <div className="dataset-card__meta dataset-card__meta--ticket">
                  <span>
                    <small>User</small>
                    {isUsableUserValue(impactedUser) ? (
                      <button
                        className="user-record-link"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void openUserRecord(impactedUser, navigate);
                        }}
                        title={impactedUser}
                        type="button"
                      >
                        {impactedUser}
                      </button>
                    ) : (
                      <em title={impactedUser}>{impactedUser}</em>
                    )}
                  </span>
                  <span>
                    <small>Location</small>
                    <em title={location}>{linkifyText(location)}</em>
                  </span>
                  <span>
                    <small>Device</small>
                    <em title={device}>{linkifyText(device)}</em>
                  </span>
                </div>

                <div className="dataset-card__footer dataset-card__footer--ticket">
                  <div className="dataset-card__footer-meta">
                    <span title={assignedToRaw || assignedTo}>Assigned: {assignedTo}</span>
                    <span title={openedAt || createdLabel}>{createdLabel}</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="dataset-card__header">
                  <strong title={title}>{title}</strong>
                  {badge ? <span className="dataset-card__badge">{badge}</span> : null}
                </div>

                {subtitle ? <p className="dataset-card__subtitle" title={subtitle}>{subtitle}</p> : null}

                {indicators.length ? (
                  <div className="dataset-card__indicators">
                    {indicators.map((indicator) => (
                      <span
                        key={indicator.label}
                        className={indicator.tone ? `dataset-card__indicator dataset-card__indicator--${indicator.tone}` : 'dataset-card__indicator'}
                      >
                        {indicator.icon || <Tag size={12} />}
                        {indicator.label}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="dataset-card__meta">
                  {metaFields.map((column) => {
                    const value = resolveField(row, column, []) || '—';
                    return (
                      <span key={`${key}-${column}`}>
                        <small>{formatColumnLabel(column)}</small>
                        <em title={value}>{value}</em>
                      </span>
                    );
                  })}
                </div>

                <div className="dataset-card__action">
                  Action
                  <ArrowRight size={14} />
                </div>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}

export default DataCardList;
