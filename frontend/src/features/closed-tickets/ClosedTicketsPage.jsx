import { useEffect, useMemo, useState } from 'react';
import {
  FileSpreadsheet,
  Loader2,
  Search,
  Settings,
  Upload,
} from 'lucide-react';
import { getUploadFile, getUploads, uploadDataFile } from '../../app/services/api';
import { useCurrentUser } from '../../app/hooks/useCurrentUser';
import { Card, CardHeader } from '../../app/ui/Card';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { parseCsvText } from '../../app/utils/csvDataset';
import { formatDataFileName } from '../../app/utils/fileDisplay';
import { isCsvFile } from '../../app/utils/documentFiles';

const STATUS_COLUMN_HINTS = ['state', 'status', 'incident_state', 'ticket_state', 'task_state'];
const ASSIGNEE_COLUMN_HINTS = ['assigned_to', 'assignee', 'owner', 'technician', 'tech', 'resolver', 'resolved_by', 'closed_by'];
const DATE_COLUMN_HINTS = [
  'closed_at',
  'closed',
  'date_closed',
  'closed_date',
  'resolved_at',
  'resolved',
  'date_resolved',
  'resolved_date',
  'resolution_date',
  'updated_at',
  'sys_updated_on',
  'updated',
];
const TICKET_ID_HINTS = ['ticket', 'number', 'ticket_number', 'incident', 'request', 'id'];
const SUMMARY_HINTS = ['short_description', 'description', 'summary', 'title', 'subject'];
const ALLOWED_CLOSED_STATUSES = new Set(['closed', 'closed complete', 'resolved']);
const SAVED_CLOSED_TICKETS_FILE = 'TicketsLAH.csv';
const SAVED_CLOSED_TICKETS_KEY = 'ticketslah';

function getColumnScore(column, hints) {
  const normalized = String(column || '').toLowerCase();
  const exactIndex = hints.findIndex((hint) => normalized === hint);
  if (exactIndex >= 0) {
    return 100 - exactIndex;
  }

  const partialIndex = hints.findIndex((hint) => normalized.includes(hint) || hint.includes(normalized));
  return partialIndex >= 0 ? 60 - partialIndex : 0;
}

function detectColumn(columns, hints, { fallbackFirst = false } = {}) {
  return [...columns]
    .map((column) => ({ column, score: getColumnScore(column, hints) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.column || (fallbackFirst ? columns[0] || '' : '');
}

function getUploadTitle(file) {
  return String(file?.originalName || file?.filename || '')
    .trim()
    .replace(/\.csv$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function findSavedClosedTicketsUpload(files) {
  return (Array.isArray(files) ? files : [])
    .filter((file) => getUploadTitle(file) === SAVED_CLOSED_TICKETS_KEY)
    .sort((left, right) => {
      const leftTime = Date.parse(left?.modifiedAt || '') || 0;
      const rightTime = Date.parse(right?.modifiedAt || '') || 0;
      return rightTime - leftTime;
    })[0] || null;
}

function getCell(row, column) {
  return String(row?.[column] ?? '').trim();
}

function normalizeStatusValue(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\d+\s*[-:.)]\s*/, '')
    .replace(/\s+/g, ' ');
}

function isAllowedClosedStatus(value) {
  return ALLOWED_CLOSED_STATUSES.has(normalizeStatusValue(value));
}

function parseDateValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 25569 && numeric < 80000) {
    const excelTime = Math.round((numeric - 25569) * 86400 * 1000);
    const excelDate = new Date(excelTime);
    return Number.isNaN(excelDate.getTime()) ? null : excelDate;
  }

  const dateInputMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dateInputMatch) {
    const [, year, month, day] = dateInputMatch;
    const parsedDate = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  const serviceNowMatch = raw.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );
  if (serviceNowMatch) {
    const [, month, day, year, hour = '0', minute = '0', second = '0', meridiem = ''] = serviceNowMatch;
    const fullYear = year.length === 2 ? (Number(year) > 70 ? 1900 + Number(year) : 2000 + Number(year)) : Number(year);
    let parsedHour = Number(hour);
    const normalizedMeridiem = meridiem.toUpperCase();
    if (normalizedMeridiem === 'PM' && parsedHour < 12) {
      parsedHour += 12;
    }
    if (normalizedMeridiem === 'AM' && parsedHour === 12) {
      parsedHour = 0;
    }
    const parsedDate = new Date(fullYear, Number(month) - 1, Number(day), parsedHour, Number(minute), Number(second));
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  const normalized = raw
    .replace(/\s+UTC$/i, 'Z')
    .replace(/^(\d{1,2})\/(\d{1,2})\/(\d{2})(\s|$)/, (_match, month, day, year, tail) => {
      const fullYear = Number(year) > 70 ? `19${year}` : `20${year}`;
      return `${month}/${day}/${fullYear}${tail}`;
    });
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateInputValue(date) {
  if (!date || Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function getWeekStart(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - day);
  return copy;
}

function isWithinTimeframe(date, timeframe, anchorValue) {
  if (!date) {
    return false;
  }

  const anchor = parseDateValue(anchorValue);
  if (!anchor) {
    return true;
  }

  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  const selected = new Date(anchor);
  selected.setHours(0, 0, 0, 0);

  if (timeframe === 'day') {
    return value.getTime() === selected.getTime();
  }

  if (timeframe === 'week') {
    const start = getWeekStart(selected);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return value >= start && value < end;
  }

  if (timeframe === 'month') {
    return value.getFullYear() === selected.getFullYear() && value.getMonth() === selected.getMonth();
  }

  return value.getFullYear() === selected.getFullYear();
}

function formatDateTime(date) {
  if (!date) {
    return 'No close date';
  }

  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function normalizeTicketRows(rows, columns, selectedColumns) {
  const assigneeColumn = selectedColumns.assigneeColumn;
  const statusColumn = selectedColumns.statusColumn;
  const dateColumn = selectedColumns.dateColumn;
  const ticketIdColumn = selectedColumns.ticketIdColumn;
  const summaryColumn = selectedColumns.summaryColumn;

  return rows
    .map((row, index) => {
      const status = getCell(row, statusColumn);
      const closedDate = parseDateValue(getCell(row, dateColumn));
      const fallbackClosedDate = DATE_COLUMN_HINTS.map((hint) => columns.find((column) => column.toLowerCase() === hint))
        .filter(Boolean)
        .map((column) => parseDateValue(getCell(row, column)))
        .find(Boolean);
      const isClosedResolved = isAllowedClosedStatus(status);

      return {
        id: getCell(row, ticketIdColumn) || `Row ${index + 1}`,
        assignee: getCell(row, assigneeColumn) || 'Unassigned',
        status: status || 'Closed or resolved',
        closedAt: closedDate || fallbackClosedDate || null,
        summary: getCell(row, summaryColumn),
        row,
        isClosedResolved,
      };
    })
    .filter((ticket) => ticket.isClosedResolved);
}

function getTimeframeLabel(timeframe, anchorValue) {
  const anchor = parseDateValue(anchorValue);
  if (!anchor) {
    return 'selected range';
  }

  if (timeframe === 'day') {
    return anchor.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  if (timeframe === 'week') {
    const start = getWeekStart(anchor);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`;
  }

  if (timeframe === 'month') {
    return anchor.toLocaleDateString([], { month: 'long', year: 'numeric' });
  }

  return anchor.toLocaleDateString([], { year: 'numeric' });
}

export function ClosedTicketsPage() {
  const { isAdmin } = useCurrentUser();
  const [uploads, setUploads] = useState([]);
  const [dataset, setDataset] = useState({ fileName: '', columns: [], rows: [] });
  const [savedUploadUrl, setSavedUploadUrl] = useState('');
  const [loadingUploads, setLoadingUploads] = useState(true);
  const [loadingDataset, setLoadingDataset] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [timeframe, setTimeframe] = useState('day');
  const [anchorDate, setAnchorDate] = useState(toDateInputValue(new Date()));
  const [selectedTech, setSelectedTech] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [columnSelection, setColumnSelection] = useState({
    assigneeColumn: '',
    statusColumn: '',
    dateColumn: '',
    ticketIdColumn: '',
    summaryColumn: '',
  });
  const savedUpload = useMemo(() => findSavedClosedTicketsUpload(uploads), [uploads]);

  useEffect(() => {
    let isMounted = true;
    getUploads()
      .then((items) => {
        if (!isMounted) {
          return;
        }
        setUploads((Array.isArray(items) ? items : []).filter((file) => isCsvFile(file.filename, file.mimeType)));
      })
      .catch((requestError) => {
        if (isMounted) {
          setError(requestError.message || 'Uploaded CSV files could not be loaded.');
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoadingUploads(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (loadingUploads) {
      return;
    }

    if (!savedUpload) {
      setSavedUploadUrl('');
      setDataset({ fileName: '', columns: [], rows: [] });
      setMessage(`${SAVED_CLOSED_TICKETS_FILE} has not been uploaded yet.`);
      return;
    }

    let isMounted = true;
    async function loadSavedUpload() {
      setLoadingDataset(true);
      setError('');
      setMessage('');
      try {
        const csvText = await getUploadFile(savedUpload.url);
        if (!isMounted) {
          return;
        }
        await loadCsvText(savedUpload.filename || SAVED_CLOSED_TICKETS_FILE, csvText);
        setSavedUploadUrl(savedUpload.url || '');
        setMessage(`${formatDataFileName(savedUpload.filename || SAVED_CLOSED_TICKETS_FILE)} loaded.`);
      } catch (requestError) {
        if (isMounted) {
          setError(requestError.message || `${SAVED_CLOSED_TICKETS_FILE} could not be loaded.`);
        }
      } finally {
        if (isMounted) {
          setLoadingDataset(false);
        }
      }
    }

    void loadSavedUpload();
    return () => {
      isMounted = false;
    };
  }, [loadingUploads, savedUpload?.filename, savedUpload?.url]);

  useEffect(() => {
    if (!dataset.columns.length) {
      return;
    }

    setColumnSelection((current) => ({
      assigneeColumn: current.assigneeColumn || detectColumn(dataset.columns, ASSIGNEE_COLUMN_HINTS, { fallbackFirst: true }),
      statusColumn: current.statusColumn || detectColumn(dataset.columns, STATUS_COLUMN_HINTS),
      dateColumn: current.dateColumn || detectColumn(dataset.columns, DATE_COLUMN_HINTS),
      ticketIdColumn: current.ticketIdColumn || detectColumn(dataset.columns, TICKET_ID_HINTS, { fallbackFirst: true }),
      summaryColumn: current.summaryColumn || detectColumn(dataset.columns, SUMMARY_HINTS, { fallbackFirst: true }),
    }));
  }, [dataset.columns]);

  const normalizedTickets = useMemo(() => {
    if (!dataset.rows.length || !dataset.columns.length || !columnSelection.assigneeColumn) {
      return [];
    }

    return normalizeTicketRows(dataset.rows, dataset.columns, columnSelection);
  }, [columnSelection, dataset.columns, dataset.rows]);

  useEffect(() => {
    if (!normalizedTickets.length) {
      return;
    }

    const latestClosedDate = normalizedTickets
      .map((ticket) => ticket.closedAt)
      .filter(Boolean)
      .sort((left, right) => right.getTime() - left.getTime())[0];
    if (latestClosedDate) {
      setAnchorDate(toDateInputValue(latestClosedDate));
    }
  }, [dataset.fileName, normalizedTickets]);

  const timeframeTickets = useMemo(() => {
    return normalizedTickets.filter((ticket) => isWithinTimeframe(ticket.closedAt, timeframe, anchorDate));
  }, [anchorDate, normalizedTickets, timeframe]);

  const assigneeCounts = useMemo(() => {
    const counts = new Map();
    for (const ticket of timeframeTickets) {
      counts.set(ticket.assignee, (counts.get(ticket.assignee) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([assignee, count]) => ({ assignee, count }))
      .sort((left, right) => {
        const leftUnassigned = left.assignee.toLowerCase() === 'unassigned';
        const rightUnassigned = right.assignee.toLowerCase() === 'unassigned';
        if (leftUnassigned !== rightUnassigned) {
          return leftUnassigned ? 1 : -1;
        }
        return right.count - left.count || left.assignee.localeCompare(right.assignee);
      });
  }, [timeframeTickets]);

  const techOptions = useMemo(() => {
    const names = new Set(normalizedTickets.map((ticket) => ticket.assignee).filter(Boolean));
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [normalizedTickets]);

  const visibleTickets = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return timeframeTickets
      .filter((ticket) => selectedTech === 'all' || ticket.assignee === selectedTech)
      .filter((ticket) => {
        if (!normalizedSearch) {
          return true;
        }
        return `${ticket.id} ${ticket.assignee} ${ticket.status} ${ticket.summary}`.toLowerCase().includes(normalizedSearch);
      })
      .sort((left, right) => (right.closedAt?.getTime() || 0) - (left.closedAt?.getTime() || 0));
  }, [searchTerm, selectedTech, timeframeTickets]);

  const fallbackVisibleTickets = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return normalizedTickets
      .filter((ticket) => selectedTech === 'all' || ticket.assignee === selectedTech)
      .filter((ticket) => {
        if (!normalizedSearch) {
          return true;
        }
        return `${ticket.id} ${ticket.assignee} ${ticket.status} ${ticket.summary}`.toLowerCase().includes(normalizedSearch);
      })
      .sort((left, right) => (right.closedAt?.getTime() || 0) - (left.closedAt?.getTime() || 0));
  }, [normalizedTickets, searchTerm, selectedTech]);

  const displayedTickets = visibleTickets.length ? visibleTickets : fallbackVisibleTickets;
  const showingFallbackTickets = !visibleTickets.length && fallbackVisibleTickets.length > 0;

  async function loadCsvText(fileName, text) {
    const parsed = parseCsvText(text);
    if (!parsed.columns.length) {
      setError('That CSV did not include a readable header row.');
      setDataset({ fileName: '', columns: [], rows: [] });
      return;
    }

    setColumnSelection({
      assigneeColumn: detectColumn(parsed.columns, ASSIGNEE_COLUMN_HINTS, { fallbackFirst: true }),
      statusColumn: detectColumn(parsed.columns, STATUS_COLUMN_HINTS),
      dateColumn: detectColumn(parsed.columns, DATE_COLUMN_HINTS),
      ticketIdColumn: detectColumn(parsed.columns, TICKET_ID_HINTS, { fallbackFirst: true }),
      summaryColumn: detectColumn(parsed.columns, SUMMARY_HINTS, { fallbackFirst: true }),
    });
    setDataset({ fileName, columns: parsed.columns, rows: parsed.rows });
    setSelectedTech('all');
    setSearchTerm('');
    setError('');
  }

  async function handleLocalFile(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!isAdmin) {
      setError('Only admins can replace the saved closed tickets CSV.');
      return;
    }

    setLoadingDataset(true);
    setError('');
    setMessage('');
    try {
      const csvText = await file.text();
      await loadCsvText(SAVED_CLOSED_TICKETS_FILE, csvText);

      try {
        const fixedFile = new File([csvText], SAVED_CLOSED_TICKETS_FILE, { type: file.type || 'text/csv' });
        const uploaded = await uploadDataFile(fixedFile);
        const uploadedUrl = uploaded?.fileUrl || '';
        if (uploadedUrl) {
          const nextUpload = {
            filename: uploaded.fileName || SAVED_CLOSED_TICKETS_FILE,
            url: uploadedUrl,
            mimeType: file.type || 'text/csv',
            modifiedAt: new Date().toISOString(),
            source: 'manual',
          };
          setUploads((current) => [nextUpload, ...current.filter((item) => item.url !== uploadedUrl)]);
          setSavedUploadUrl(uploadedUrl);
          setMessage(`${formatDataFileName(nextUpload.filename)} replaced and loaded.`);
        } else {
          setMessage(`${formatDataFileName(SAVED_CLOSED_TICKETS_FILE)} loaded locally.`);
        }
      } catch (uploadError) {
        setMessage(`${formatDataFileName(SAVED_CLOSED_TICKETS_FILE)} loaded locally. Upload save failed: ${uploadError.message || 'Unknown error'}`);
      }
    } catch (requestError) {
      setError(requestError.message || 'CSV file could not be read.');
    } finally {
      setLoadingDataset(false);
    }
  }

  function updateColumnSelection(key, value) {
    setColumnSelection((current) => ({ ...current, [key]: value }));
  }

  const topCount = assigneeCounts[0]?.count || 0;
  const selectedRangeLabel = getTimeframeLabel(timeframe, anchorDate);

  return (
    <section className="module closed-tickets-page">
      <SectionHeader
        tag="/ClosedTickets"
        title="Closed Tickets"
        description="Review tickets whose State or Status is Closed, Closed Complete, or Resolved."
        actions={(
          <button
            className={settingsOpen ? 'compact-toggle compact-toggle--active' : 'compact-toggle'}
            type="button"
            onClick={() => setSettingsOpen((current) => !current)}
          >
            <Settings size={14} />
            Settings
          </button>
        )}
      />

      <Card className="closed-tickets-toolbar-card">
        <details className="closed-tickets-toolbar-details">
          <summary className="compact-toggle">
            Quick Filters
          </summary>
          <div className="closed-tickets-toolbar-details__content">
            <p className="status-text">Day view is the default. Expand this section to adjust filters.</p>
            <div className="closed-tickets-filter-grid">
              <label className="closed-tickets-field">
                <span>Timeframe</span>
                <select value={timeframe} onChange={(event) => setTimeframe(event.target.value)}>
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                  <option value="year">Year</option>
                </select>
              </label>
              <label className="closed-tickets-field">
                <span>Selected date</span>
                <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />
              </label>
              <label className="closed-tickets-field">
                <span>Technician</span>
                <select value={selectedTech} onChange={(event) => setSelectedTech(event.target.value)}>
                  <option value="all">All technicians</option>
                  {techOptions.map((tech) => (
                    <option key={tech} value={tech}>
                      {tech}
                    </option>
                  ))}
                </select>
              </label>
              <label className="closed-tickets-field">
                <span>Search tickets</span>
                <span className="closed-tickets-search">
                  <Search size={14} />
                  <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Ticket, status, summary" />
                </span>
              </label>
            </div>
          </div>
        </details>
      </Card>

      {settingsOpen ? (
        <Card className="closed-tickets-settings-card">
          <CardHeader
            eyebrow="Settings"
            title="Saved CSV and field mapping"
            description={
              isAdmin
                ? 'Replace the saved CSV or tune detected columns.'
                : 'Review the saved CSV and detected columns.'
            }
          />
          <div className="closed-tickets-source-grid">
            <p className="closed-tickets-saved-source">
              <FileSpreadsheet size={16} />
              <span>
                <strong>{formatDataFileName(SAVED_CLOSED_TICKETS_FILE)}</strong>
                <small>{savedUploadUrl ? 'Saved upload found' : loadingUploads ? 'Looking for saved upload...' : 'Saved upload not found'}</small>
              </span>
            </p>

            {isAdmin ? (
              <label className="closed-tickets-file-input">
                <Upload size={16} />
                <span>Replace saved CSV</span>
                <input accept=".csv,text/csv" type="file" onChange={handleLocalFile} />
              </label>
            ) : null}
          </div>

          {dataset.fileName ? (
            <p className="closed-tickets-loaded">
              <FileSpreadsheet size={14} />
              {`${formatDataFileName(dataset.fileName)} · ${dataset.rows.length.toLocaleString()} rows`}
            </p>
          ) : null}
          {message ? <p className="status-text">{message}</p> : null}
          {error ? <p className="status-text status-text--error">{error}</p> : null}

          {dataset.columns.length ? (
            <div className="closed-tickets-column-grid">
              {[
                ['assigneeColumn', 'Assignee'],
                ['statusColumn', 'State / Status'],
                ['dateColumn', 'Closed or resolved date'],
                ['ticketIdColumn', 'Ticket ID'],
                ['summaryColumn', 'Summary'],
              ].map(([key, label]) => (
                <label className="closed-tickets-field" key={key}>
                  <span>{label}</span>
                  <select value={columnSelection[key]} onChange={(event) => updateColumnSelection(key, event.target.value)}>
                    <option value="">No column selected</option>
                    {dataset.columns.map((column) => (
                      <option key={`${key}-${column}`} value={column}>
                        {column}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="closed-tickets-results-grid">
        <Card className="closed-tickets-leaderboard-card">
          <CardHeader
            eyebrow="Assignee totals"
            title="Closed and resolved by technician"
            description="Select a technician to inspect their ticket list."
          />
          {loadingDataset ? (
            <p className="closed-tickets-loading">
              <Loader2 className="spin" size={16} />
              Loading ticket export...
            </p>
          ) : assigneeCounts.length ? (
            <div className="closed-tickets-leaderboard">
              {assigneeCounts.map((item) => (
                <button
                  className={selectedTech === item.assignee ? 'closed-tickets-assignee closed-tickets-assignee--active' : 'closed-tickets-assignee'}
                  key={item.assignee}
                  onClick={() => setSelectedTech(item.assignee)}
                  type="button"
                >
                  <span>
                    <strong>{item.assignee}</strong>
                    <small>{`${item.count.toLocaleString()} ticket${item.count === 1 ? '' : 's'}`}</small>
                  </span>
                  <span className="closed-tickets-assignee__bar" aria-hidden="true">
                    <span style={{ width: `${topCount ? Math.max(8, (item.count / topCount) * 100) : 0}%` }} />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="closed-tickets-empty">Load a CSV with closed or resolved ticket records to see assignee totals.</p>
          )}
        </Card>

        <Card className="closed-tickets-table-card">
          <CardHeader
            eyebrow="Ticket detail"
            title={selectedTech === 'all' ? 'Closed ticket list' : `${selectedTech} closed tickets`}
            description="Rows are filtered to the selected timeframe and technician."
            action={selectedTech === 'all' ? null : (
              <button className="compact-toggle" type="button" onClick={() => setSelectedTech('all')}>
                Show All
              </button>
            )}
          />
          {showingFallbackTickets ? (
            <p className="status-text">
              No tickets matched the selected timeframe, so all matching closed tickets are shown below.
            </p>
          ) : null}
          {displayedTickets.length ? (
            <>
              <div className="closed-tickets-mobile-list" aria-label="Closed ticket cards">
                {displayedTickets.map((ticket, index) => (
                  <article className="closed-ticket-mobile-card" key={`mobile-${ticket.id}-${index}`}>
                    <div className="closed-ticket-mobile-card__head">
                      <strong>{ticket.id}</strong>
                      <span>{ticket.status}</span>
                    </div>
                    <div className="closed-ticket-mobile-card__meta">
                      <span>{ticket.assignee}</span>
                      <span>{formatDateTime(ticket.closedAt)}</span>
                    </div>
                    <p>{ticket.summary || 'No summary'}</p>
                  </article>
                ))}
              </div>
              <div className="closed-tickets-table-wrap">
                <table className="closed-tickets-table">
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Technician</th>
                      <th>Status</th>
                      <th>Closed</th>
                      <th>Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedTickets.map((ticket, index) => (
                      <tr key={`${ticket.id}-${index}`}>
                        <td>{ticket.id}</td>
                        <td>{ticket.assignee}</td>
                        <td>{ticket.status}</td>
                        <td>{formatDateTime(ticket.closedAt)}</td>
                        <td>{ticket.summary || 'No summary'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="closed-tickets-empty">No ticket rows match the selected filters.</p>
          )}
        </Card>
      </div>
    </section>
  );
}
