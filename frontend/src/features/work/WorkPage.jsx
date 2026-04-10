import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  Clock3,
  FileSpreadsheet,
  History,
  MessageSquareText,
  RotateCcw,
  TableProperties,
  Upload,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  analyzeCsvFile,
  getLatestTickets,
  getRecentCsvAnalyses,
  getRecentCsvAnalysisFile,
  sendAiChat,
  updateTicketAssignee,
} from '../../app/services/api';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { TicketCard } from './components/TicketCard';
import { getCachedWorkDataset, parseCsvText, setCachedWorkDataset } from './workDatasetCache';
import { buildInsights, buildInsightsSummaryPrompt } from './workInsightsMetrics';
import { dedupeNotes, getTicketAssignee, getTicketColumns, getTicketId, isActiveTicket, isSuppressedTicketColumn } from './utils/aiAnalysis';

const DEFAULT_CARD_ASSIGNEE = 'William West';
const VIEW_STORAGE_KEY = 'westos.work.ticketView';

function inferColumnType(rows, column) {
  const values = rows
    .map((row) => String(row[column] ?? '').trim())
    .filter(Boolean)
    .slice(0, 25);

  if (!values.length) {
    return 'text';
  }

  const numberLike = values.every((value) => !Number.isNaN(Number(value)));
  if (numberLike) {
    return 'number';
  }

  const dateLike = values.every((value) => !Number.isNaN(Date.parse(value)));
  if (dateLike) {
    return 'date';
  }

  return 'text';
}

function parseAiSections(aiAnalysis) {
  const template = {
    summary: '',
    keyInsights: [],
    anomalies: [],
    recommendations: [],
  };

  if (!aiAnalysis) {
    return template;
  }

  const lines = aiAnalysis
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let currentSection = 'summary';
  const sectionMap = {
    '1': 'summary',
    '2': 'keyInsights',
    '3': 'anomalies',
    '4': 'recommendations',
    summary: 'summary',
    'key insights': 'keyInsights',
    anomalies: 'anomalies',
    recommendations: 'recommendations',
  };

  for (const line of lines) {
    const normalized = line
      .replace(/^[#*\-\s]+/, '')
      .replace(/[:]+$/, '')
      .replace(/^\d+\.\s*/, '')
      .toLowerCase();

    const nextSection = sectionMap[normalized];
    if (nextSection) {
      currentSection = nextSection;
      continue;
    }

    const content = line.replace(/^[-*]\s*/, '').trim();
    if (!content) {
      continue;
    }

    if (currentSection === 'summary') {
      template.summary = template.summary ? `${template.summary} ${content}` : content;
    } else {
      template[currentSection].push(content);
    }
  }

  return template;
}

function buildAiSampleRows(rows) {
  return rows.slice(0, 12).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => {
        const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
        return [key, normalized.slice(0, 120)];
      })
    )
  );
}

function formatRelativeTimestamp(value) {
  if (!value) {
    return 'Unknown';
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) {
    return 'just now';
  }

  if (minutes === 1) {
    return '1 minute ago';
  }

  if (minutes < 60) {
    return `${minutes} minutes ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours === 1) {
    return '1 hour ago';
  }

  if (hours < 24) {
    return `${hours} hours ago`;
  }

  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function getDefaultVisibleColumns(analysis) {
  if (!analysis?.columns?.length) {
    return [];
  }

  const priorityColumns = [
    analysis.categoryColumn,
    ...analysis.columns.filter(
      (column) => !isSuppressedTicketColumn(column) && /id|name|title|status|date|created|updated|owner|email/i.test(column)
    ),
    ...analysis.columns,
  ].filter((column) => Boolean(column) && !isSuppressedTicketColumn(column));

  return Array.from(new Set(priorityColumns)).slice(0, Math.min(8, analysis.columns.length));
}

function getColumnFilterDefaults(columnType) {
  if (columnType === 'number') {
    return { min: '', max: '' };
  }

  if (columnType === 'date') {
    return { start: '', end: '' };
  }

  return { text: '' };
}

function getCellText(row, column) {
  return String(row[column] ?? '');
}

function getPrimaryColumns(columns = []) {
  const priorityPatterns = [
    /number|ticket|case|incident|request|task|id/i,
    /title|name|subject|short_description|summary/i,
    /state|status|priority|severity/i,
    /assigned_to|assignee|owner|agent/i,
  ];

  const selected = [];

  for (const pattern of priorityPatterns) {
    const match = columns.find((column) => pattern.test(column) && !selected.includes(column));
    if (match) {
      selected.push(match);
    }
  }

  return selected;
}

function getDescriptionColumn(columns = []) {
  return columns.find((column) => /description|details|body|text|problem|issue|summary/i.test(column)) || '';
}

function getNoteColumns(columns = []) {
  return getTicketColumns(columns).noteColumns;
}

function splitNoteEntries(value) {
  const text = String(value ?? '').trim();

  if (!text) {
    return [];
  }

  const chunks = text
    .split(/\n{2,}|(?:^|\n)[-*]\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return chunks.length ? chunks : [text];
}

function buildRowDetail(row, columns) {
  const primaryColumns = getPrimaryColumns(columns);
  const descriptionColumn = getDescriptionColumn(columns);
  const noteColumns = getNoteColumns(columns);
  const excluded = new Set([...primaryColumns, descriptionColumn, ...noteColumns].filter(Boolean));

  const metadataGroups = {
    Details: [],
    Assignment: [],
    Dates: [],
    Other: [],
  };

  for (const column of columns) {
    if (excluded.has(column) || isSuppressedTicketColumn(column)) {
      continue;
    }

    const value = getCellText(row, column).trim();
    if (!value) {
      continue;
    }

    if (/assigned|owner|agent|group/i.test(column)) {
      metadataGroups.Assignment.push({ label: column, value });
    } else if (/date|time|created|updated|opened|closed|resolved/i.test(column)) {
      metadataGroups.Dates.push({ label: column, value });
    } else if (/state|status|priority|severity|type|category/i.test(column)) {
      metadataGroups.Details.push({ label: column, value });
    } else {
      metadataGroups.Other.push({ label: column, value });
    }
  }

  const notes = dedupeNotes(noteColumns.flatMap((column) =>
    splitNoteEntries(row[column]).map((entry, index) => ({
      id: `${column}-${index}`,
      label: column,
      type: column,
      value: entry,
      content: entry,
    }))
  ).reverse());

  return {
    primary: primaryColumns.map((column) => ({ label: column, value: getCellText(row, column).trim() })).filter((item) => item.value),
    description: descriptionColumn ? getCellText(row, descriptionColumn).trim() : '',
    descriptionLabel: descriptionColumn,
    metadataGroups,
    notes,
  };
}

function compareValues(leftValue, rightValue, columnType) {
  if (columnType === 'number') {
    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);

    if (Number.isNaN(leftNumber) && Number.isNaN(rightNumber)) {
      return 0;
    }

    if (Number.isNaN(leftNumber)) {
      return 1;
    }

    if (Number.isNaN(rightNumber)) {
      return -1;
    }

    return leftNumber - rightNumber;
  }

  if (columnType === 'date') {
    const leftDate = Date.parse(leftValue);
    const rightDate = Date.parse(rightValue);

    if (Number.isNaN(leftDate) && Number.isNaN(rightDate)) {
      return 0;
    }

    if (Number.isNaN(leftDate)) {
      return 1;
    }

    if (Number.isNaN(rightDate)) {
      return -1;
    }

    return leftDate - rightDate;
  }

  return String(leftValue ?? '').localeCompare(String(rightValue ?? ''), undefined, { sensitivity: 'base' });
}

function matchesColumnFilter(value, columnType, filter = {}) {
  const cellText = String(value ?? '').trim();

  if (columnType === 'number') {
    const numberValue = Number(cellText);

    if (filter.min !== '' && (Number.isNaN(numberValue) || numberValue < Number(filter.min))) {
      return false;
    }

    if (filter.max !== '' && (Number.isNaN(numberValue) || numberValue > Number(filter.max))) {
      return false;
    }

    return true;
  }

  if (columnType === 'date') {
    const dateValue = Date.parse(cellText);

    if (filter.start && (Number.isNaN(dateValue) || dateValue < Date.parse(filter.start))) {
      return false;
    }

    if (filter.end) {
      const endDate = new Date(filter.end);
      endDate.setHours(23, 59, 59, 999);

      if (Number.isNaN(dateValue) || dateValue > endDate.getTime()) {
        return false;
      }
    }

    return true;
  }

  return !filter.text || cellText.toLowerCase().includes(filter.text.trim().toLowerCase());
}

const DataTable = memo(function DataTable({
  rows,
  visibleColumns,
  columnTypeMap,
  columnFilters,
  sortConfig,
  onColumnFilterChange,
  onSort,
  fileName,
  onRowSelect,
  selectedRow,
  assigneeColumn = '',
  assigneeDrafts = {},
  onAssigneeChange,
  onAssigneeCommit,
}) {
  if (!visibleColumns.length) {
    return (
      <EmptyState
        description="Select at least one column to render the preview table."
        icon={<TableProperties size={20} />}
        title="No visible columns"
      />
    );
  }

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {visibleColumns.map((column) => {
              const isSorted = sortConfig.column === column;

              return (
                <th key={column}>
                  <button className="data-table__sort" onClick={() => onSort(column)} type="button">
                    <span>{column}</span>
                    <span aria-hidden="true">{isSorted ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                  </button>
                </th>
              );
            })}
          </tr>
          <tr>
            {visibleColumns.map((column) => {
              const columnType = columnTypeMap[column] || 'text';
              const filter = columnFilters[column] || getColumnFilterDefaults(columnType);

              return (
                <th className="data-table__filter-cell" key={`${column}-filter`}>
                  {columnType === 'number' ? (
                    <div className="column-range-filter">
                      <input
                        aria-label={`${column} minimum`}
                        onChange={(event) => onColumnFilterChange(column, 'min', event.target.value)}
                        placeholder="Min"
                        type="number"
                        value={filter.min || ''}
                      />
                      <input
                        aria-label={`${column} maximum`}
                        onChange={(event) => onColumnFilterChange(column, 'max', event.target.value)}
                        placeholder="Max"
                        type="number"
                        value={filter.max || ''}
                      />
                    </div>
                  ) : columnType === 'date' ? (
                    <div className="column-range-filter">
                      <input
                        aria-label={`${column} start date`}
                        onChange={(event) => onColumnFilterChange(column, 'start', event.target.value)}
                        type="date"
                        value={filter.start || ''}
                      />
                      <input
                        aria-label={`${column} end date`}
                        onChange={(event) => onColumnFilterChange(column, 'end', event.target.value)}
                        type="date"
                        value={filter.end || ''}
                      />
                    </div>
                  ) : (
                    <input
                      aria-label={`Filter ${column}`}
                      onChange={(event) => onColumnFilterChange(column, 'text', event.target.value)}
                      placeholder="Filter..."
                      type="text"
                      value={filter.text || ''}
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, rowIndex) => (
              <tr
                className={selectedRow === row ? 'data-table__row data-table__row--selected' : 'data-table__row'}
                key={`${fileName}-${rowIndex}`}
                onClick={() => onRowSelect(row)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onRowSelect(row);
                  }
                }}
                tabIndex={0}
              >
                {visibleColumns.map((column) => {
                  return <td key={`${rowIndex}-${column}`}>{getCellText(row, column) || '—'}</td>;
                })}
              </tr>
            ))
          ) : (
            <tr>
              <td className="data-table__empty" colSpan={visibleColumns.length}>
                No preview rows match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
});

export function WorkPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [latestDataset, setLatestDataset] = useState({ columns: [], rows: [] });
  const [latestSource, setLatestSource] = useState('');
  const [latestUpdatedAt, setLatestUpdatedAt] = useState('');
  const [latestAnalysisId, setLatestAnalysisId] = useState('');
  const [latestFileName, setLatestFileName] = useState('');
  const [latestMessage, setLatestMessage] = useState('');
  const [isLoadingLatest, setIsLoadingLatest] = useState(true);
  const [ticketView, setTicketView] = useState(() => window.localStorage.getItem(VIEW_STORAGE_KEY) || 'card');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [assigneeDrafts, setAssigneeDrafts] = useState({});
  const [recentAnalyses, setRecentAnalyses] = useState([]);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingRecent, setIsLoadingRecent] = useState(true);
  const [visibleColumns, setVisibleColumns] = useState([]);
  const [latestColumnFilters, setLatestColumnFilters] = useState({});
  const [latestSortConfig, setLatestSortConfig] = useState({ column: '', direction: 'asc' });
  const [rowFilter, setRowFilter] = useState('');
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [aiError, setAiError] = useState('');
  const [loadingAI, setLoadingAI] = useState(false);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [isDatasetInfoOpen, setIsDatasetInfoOpen] = useState(false);
  const [isColumnPanelOpen, setIsColumnPanelOpen] = useState(false);
  const [columnFilters, setColumnFilters] = useState({});
  const [sortConfig, setSortConfig] = useState({ column: '', direction: 'asc' });
  const [debouncedRowFilter, setDebouncedRowFilter] = useState('');
  const [selectedRow, setSelectedRow] = useState(null);
  const [isLoadingSavedRun, setIsLoadingSavedRun] = useState(false);

  async function loadSavedAnalysisEntry(entry, { showLoading = true } = {}) {
    if (!entry?.id) {
      return;
    }

    setError('');
    setSelectedRow(null);
    setSelectedFile(null);

    if (showLoading) {
      setIsHistoryExpanded(false);
      setIsLoadingSavedRun(true);
    }

    try {
      const csvText = await getRecentCsvAnalysisFile(entry.id);
      const parsedDataset = parseCsvText(csvText);
      const nextAnalysis = {
        ...entry.analysis,
        analysisId: entry.id,
        fileName: entry.fileName,
        savedAt: entry.savedAt,
      };

      setAnalysis(nextAnalysis);
      setCachedWorkDataset({
        analysisId: entry.id,
        fileName: entry.fileName,
        columns: parsedDataset.columns,
        rows: parsedDataset.rows,
      });
    } catch (requestError) {
      setCachedWorkDataset(null);
      setError(requestError.message || 'Saved CSV data could not be loaded.');
    } finally {
      if (showLoading) {
        setIsLoadingSavedRun(false);
      }
    }
  }

  async function loadLatestDataset() {
    setIsLoadingLatest(true);

    try {
      const result = await getLatestTickets();
      const payload = result.data || {};
      const columns = payload.columns || Object.keys(payload.tickets?.[0] || {});
      const cachedRows = getCachedWorkDataset()?.rows || [];
      const cachedByTicketId = new Map(
        cachedRows.map((row) => [getTicketId(row, Object.keys(row || {})), row])
      );
      const rows = (payload.tickets || []).map((row) => {
        const cachedRow = cachedByTicketId.get(getTicketId(row, columns));

        if (!cachedRow?.ai_analysis) {
          return row;
        }

        return {
          ...row,
          ai_analysis: cachedRow.ai_analysis,
        };
      });
      const nextDataset = {
        columns,
        rows,
      };

      setLatestDataset(nextDataset);
      setLatestSource(payload.source || '');
      setLatestUpdatedAt(payload.last_updated || '');
      setLatestAnalysisId(payload.analysisId || '');
      setLatestFileName(payload.fileName || '');
      setLatestMessage(payload.message || '');
      setCachedWorkDataset(nextDataset);
      setAssigneeDrafts(
        Object.fromEntries(
          rows.map((row) => [getTicketId(row, columns), getTicketAssignee(row, columns)])
        )
      );
    } catch (requestError) {
      setLatestDataset({ columns: [], rows: [] });
      setLatestSource('');
      setLatestUpdatedAt('');
      setLatestAnalysisId('');
      setLatestFileName('');
      setLatestMessage(requestError.message || 'Latest tickets could not be loaded.');
    } finally {
      setIsLoadingLatest(false);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function loadRecentAnalyses() {
      try {
        const result = await getRecentCsvAnalyses();

        if (!isMounted) {
          return;
        }

        setRecentAnalyses(result.data || []);
      } catch {
        if (!isMounted) {
          return;
        }

        setRecentAnalyses([]);
      } finally {
        if (isMounted) {
          setIsLoadingRecent(false);
        }
      }
    }

    loadRecentAnalyses();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!recentAnalyses.length || isLoadingSavedRun) {
      return;
    }

    const activeEntry = recentAnalyses.find((entry) => entry.id === latestAnalysisId);

    if (activeEntry) {
      if (analysis?.analysisId === activeEntry.id) {
        return;
      }

      void loadSavedAnalysisEntry(activeEntry, { showLoading: false });
      return;
    }

    if (!latestAnalysisId && !analysis?.analysisId) {
      void loadSavedAnalysisEntry(recentAnalyses[0], { showLoading: false });
    }
  }, [analysis?.analysisId, isLoadingSavedRun, latestAnalysisId, recentAnalyses]);

  useEffect(() => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, ticketView);
  }, [ticketView]);

  useEffect(() => {
    let isMounted = true;

    void loadLatestDataset();
    const intervalId = window.setInterval(() => {
      if (isMounted) {
        void loadLatestDataset();
      }
    }, 30000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const previewRows = analysis?.previewRows || analysis?.sampleRows || [];

  useEffect(() => {
    const debounceTimer = window.setTimeout(() => {
      setDebouncedRowFilter(rowFilter);
    }, 180);

    return () => window.clearTimeout(debounceTimer);
  }, [rowFilter]);

  useEffect(() => {
    if (!analysis?.columns) {
      setVisibleColumns([]);
      setAiAnalysis('');
      setAiError('');
      setRowFilter('');
      setDebouncedRowFilter('');
      setColumnFilters({});
      setSortConfig({ column: '', direction: 'asc' });
      setIsDatasetInfoOpen(false);
      setIsColumnPanelOpen(false);
      setSelectedRow(null);
      return;
    }

    setVisibleColumns(getDefaultVisibleColumns(analysis));
    setAiAnalysis('');
    setAiError('');
    setRowFilter('');
    setDebouncedRowFilter('');
    setColumnFilters({});
    setSortConfig({ column: '', direction: 'asc' });
    setIsDatasetInfoOpen(false);
    setIsColumnPanelOpen(false);
    setSelectedRow(null);
  }, [analysis]);

  const columnSummaries = useMemo(() => {
    if (!analysis?.columns?.length) {
      return [];
    }

    return analysis.columns.map((column) => ({
      name: column,
      type: inferColumnType(previewRows, column),
    }));
  }, [analysis, previewRows]);

  const columnTypeMap = useMemo(
    () => Object.fromEntries(columnSummaries.map((column) => [column.name, column.type])),
    [columnSummaries]
  );

  const filteredPreviewRows = useMemo(() => {
    if (!previewRows.length) {
      return [];
    }

    const query = debouncedRowFilter.trim().toLowerCase();
    const filteredRows = previewRows.filter((row) => {
      const matchesGlobalSearch =
        !query || visibleColumns.some((column) => getCellText(row, column).toLowerCase().includes(query));

      if (!matchesGlobalSearch) {
        return false;
      }

      return visibleColumns.every((column) =>
        matchesColumnFilter(row[column], columnTypeMap[column] || 'text', columnFilters[column])
      );
    });

    if (!sortConfig.column) {
      return filteredRows;
    }

    const sortDirection = sortConfig.direction === 'asc' ? 1 : -1;
    const columnType = columnTypeMap[sortConfig.column] || 'text';

    return [...filteredRows].sort(
      (leftRow, rightRow) =>
        compareValues(leftRow[sortConfig.column], rightRow[sortConfig.column], columnType) * sortDirection
    );
  }, [columnFilters, columnTypeMap, debouncedRowFilter, previewRows, sortConfig, visibleColumns]);

  const aiSections = useMemo(() => parseAiSections(aiAnalysis), [aiAnalysis]);
  const rowDetail = useMemo(
    () => (selectedRow && analysis?.columns?.length ? buildRowDetail(selectedRow, analysis.columns) : null),
    [analysis, selectedRow]
  );
  const latestColumns = latestDataset.columns || [];
  const latestVisibleColumns = useMemo(() => {
    if (!latestColumns.length) {
      return [];
    }

    const fieldMap = getTicketColumns(latestColumns);
    return Array.from(
      new Set(
        [fieldMap.id, fieldMap.title, fieldMap.assignee, fieldMap.updated, fieldMap.status].filter(Boolean)
      )
    );
  }, [latestColumns]);
  const latestAssigneeColumn = useMemo(() => getTicketColumns(latestColumns).assignee, [latestColumns]);
  const latestTickets = useMemo(
    () =>
      (latestDataset.rows || []).filter((row) => {
        if (!isActiveTicket(row, latestColumns)) {
          return false;
        }

        if (!assigneeFilter.trim()) {
          return true;
        }

        return getTicketAssignee(row, latestColumns).trim().toLowerCase().includes(assigneeFilter.trim().toLowerCase());
      }),
    [assigneeFilter, latestColumns, latestDataset.rows]
  );
  const assigneeOptions = useMemo(() => {
    const uniqueAssignees = Array.from(
      new Set(
        ((latestDataset?.rows || []).filter((row) => isActiveTicket(row, latestColumns)))
          .map((row) => getTicketAssignee(row, latestColumns).trim())
          .filter(Boolean)
      )
    );

    uniqueAssignees.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
    return uniqueAssignees;
  }, [latestColumns, latestDataset?.rows]);

  useEffect(() => {
    if (assigneeFilter && !assigneeOptions.includes(assigneeFilter)) {
      setAssigneeFilter('');
    }
  }, [assigneeFilter, assigneeOptions]);
  const latestColumnTypeMap = useMemo(
    () => Object.fromEntries(latestVisibleColumns.map((column) => [column, inferColumnType(latestTickets, column)])),
    [latestTickets, latestVisibleColumns]
  );
  const filteredLatestRows = useMemo(() => {
    if (!latestTickets.length) {
      return [];
    }

    const filteredRows = latestTickets.filter((row) =>
      latestVisibleColumns.every((column) =>
        matchesColumnFilter(row[column], latestColumnTypeMap[column] || 'text', latestColumnFilters[column])
      )
    );

    if (!latestSortConfig.column) {
      return filteredRows;
    }

    const sortDirection = latestSortConfig.direction === 'asc' ? 1 : -1;
    const columnType = latestColumnTypeMap[latestSortConfig.column] || 'text';

    return [...filteredRows].sort(
      (leftRow, rightRow) =>
        compareValues(leftRow[latestSortConfig.column], rightRow[latestSortConfig.column], columnType) * sortDirection
    );
  }, [latestColumnFilters, latestColumnTypeMap, latestSortConfig, latestTickets, latestVisibleColumns]);
  const visibleLatestTickets = ticketView === 'card' ? latestTickets : filteredLatestRows;

  async function runAnalysis(file) {
    setError('');
    setIsSubmitting(true);

    try {
      const result = await analyzeCsvFile(file);
      setAnalysis(result.data);
      setSelectedRow(null);
      setRecentAnalyses((current) => {
        const next = [
          {
            id: result.data.analysisId,
            fileName: result.data.fileName,
            savedAt: result.data.savedAt,
            analysis: result.data,
          },
          ...current.filter((entry) => entry.id !== result.data.analysisId),
        ];

        return next.slice(0, 10);
      });

      file
        .text()
        .then((text) => {
          const parsedDataset = parseCsvText(text);

          setCachedWorkDataset({
            analysisId: result.data.analysisId,
            fileName: result.data.fileName,
            columns: parsedDataset.columns,
            rows: parsedDataset.rows,
          });
        })
        .catch(() => {
          setCachedWorkDataset(null);
        });

      await loadLatestDataset();

      return result.data;
    } catch (requestError) {
      setAnalysis(null);
      setError(requestError.message);
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFileSelection(file) {
    setSelectedFile(file);
    setIsHistoryExpanded(false);

    if (!file) {
      return;
    }

    await runAnalysis(file);
  }

  async function handleRecentRunSelection(entry) {
    await loadSavedAnalysisEntry(entry);
  }

  function handleAssigneeDraftChange(ticketId, value) {
    if (!latestAssigneeColumn) {
      return;
    }

    setAssigneeDrafts((current) => ({
      ...current,
      [ticketId]: value,
    }));
    setLatestDataset((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        getTicketId(row, current.columns) === ticketId
          ? {
              ...row,
              [latestAssigneeColumn]: value,
            }
          : row
      ),
    }));
  }

  async function handleAssigneeCommit(ticketId, assignee) {
    try {
      await updateTicketAssignee(ticketId, assignee);
      await loadLatestDataset();
    } catch (requestError) {
      setError(requestError.message || 'Assignee could not be updated.');
    }
  }

  function toggleColumn(column) {
    setVisibleColumns((current) =>
      current.includes(column) ? current.filter((item) => item !== column) : [...current, column]
    );
  }

  function updateColumnFilter(column, key, value) {
    setColumnFilters((current) => ({
      ...current,
      [column]: {
        ...getColumnFilterDefaults(columnTypeMap[column] || 'text'),
        ...current[column],
        [key]: value,
      },
    }));
  }

  function handleSort(column) {
    setSortConfig((current) => {
      if (current.column !== column) {
        return { column, direction: 'asc' };
      }

      if (current.direction === 'asc') {
        return { column, direction: 'desc' };
      }

      return { column: '', direction: 'asc' };
    });
  }

  function resetTableControls() {
    setRowFilter('');
    setDebouncedRowFilter('');
    setColumnFilters({});
    setSortConfig({ column: '', direction: 'asc' });
  }

  function handlePreviewRowSelect(row) {
    const ticketId = getTicketId(row, Object.keys(row || {}));

    if (!ticketId || ticketId === 'Untitled ticket') {
      setSelectedRow(row);
      return;
    }

    navigate(`/tickets/${encodeURIComponent(ticketId)}`);
  }

  async function handleAiAnalysis() {
    if (!analysis) {
      return;
    }

    setAiError('');
    setLoadingAI(true);
    const cachedDataset = getCachedWorkDataset();
    let prompt = [
      'Summarize in 2 sentences:',
      `Category column: ${analysis.categoryColumn || 'None'}`,
      `Top categories: ${analysis.topCategories.map((item) => `${item.label} (${item.count})`).join('; ') || 'None'}`,
      `Column completeness: ${analysis.columnCompleteness.map((item) => `${item.column}=${item.filled} filled`).join('; ') || 'None'}`,
      `Insights: ${analysis.insights.join('; ') || 'None'}`,
    ].join('\n');

    if (
      cachedDataset?.rows?.length &&
      ((cachedDataset.analysisId && cachedDataset.analysisId === analysis.analysisId) ||
        cachedDataset.fileName === analysis.fileName)
    ) {
      prompt = buildInsightsSummaryPrompt(cachedDataset, buildInsights(cachedDataset));
    }

    try {
      const result = await sendAiChat(prompt);
      setAiAnalysis(result.message || '');
    } catch (requestError) {
      setAiAnalysis('');
      setAiError(requestError.message);
    } finally {
      setLoadingAI(false);
    }
  }

  return (
    <section className="module">
      {error ? <p className="status-text status-text--error">{error}</p> : null}
      {aiError ? <p className="status-text status-text--error">{aiError}</p> : null}
      {isLoadingSavedRun ? <p className="status-text">Loading saved run dataset...</p> : null}

      {analysis ? (
        <>
          {isDatasetInfoOpen ? (
            <div className="dataset-panel-backdrop" onClick={() => setIsDatasetInfoOpen(false)} role="presentation">
              <aside
                aria-label="Dataset information"
                className="dataset-panel"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="dataset-panel__header">
                  <div>
                    <span className="ui-eyebrow">Summary</span>
                    <h3>Dataset overview</h3>
                    <p>A compact readout of structure and inferred field types from the parsed dataset.</p>
                  </div>
                  <button
                    className="compact-toggle compact-toggle--icon"
                    onClick={() => setIsDatasetInfoOpen(false)}
                    type="button"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="metric-grid">
                  <div className="metric-tile">
                    <span>Total rows</span>
                    <strong>{analysis.rowCount}</strong>
                  </div>
                  <div className="metric-tile">
                    <span>Total columns</span>
                    <strong>{analysis.columnCount}</strong>
                  </div>
                  <div className="metric-tile">
                    <span>Category field</span>
                    <strong>{analysis.categoryColumn || 'None'}</strong>
                  </div>
                </div>

                <div className="feature-list feature-list--compact">
                  {columnSummaries.map((column) => (
                    <div className="feature-list__item" key={column.name}>
                      <BarChart3 size={16} />
                      <span>
                        <strong>{column.name}</strong> · {column.type}
                      </span>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          ) : null}

          <section className="analysis-grid">
            <Card className="analysis-grid__wide">
              <div className="ticket-toolbar ticket-toolbar--compact">
                <div className="ticket-toolbar__header">
                  <span className="ui-eyebrow">Tickets</span>
                  <h3 className="ui-card__title">Active ticket queue</h3>
                  <span className="ticket-source-banner__pill">
                    {visibleLatestTickets.length} {visibleLatestTickets.length === 1 ? 'ticket' : 'tickets'}
                  </span>
                </div>

                <div className="ticket-toolbar__actions">
                  <input
                    ref={fileInputRef}
                    accept=".csv,text/csv"
                    className="ticket-toolbar__file-input"
                    onChange={(event) => handleFileSelection(event.target.files?.[0] || null)}
                    type="file"
                  />
                  <button
                    className="compact-toggle"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <Upload size={15} />
                    Upload
                  </button>
                  <button
                    className="ui-button ui-button--primary"
                    disabled={!analysis || loadingAI || isLoadingSavedRun}
                    onClick={handleAiAnalysis}
                    type="button"
                  >
                    <MessageSquareText size={16} />
                    {isSubmitting ? 'Analyzing...' : loadingAI ? 'AI...' : 'AI'}
                  </button>
                  <select
                    className="ticket-queue__filter"
                    onChange={(event) => setAssigneeFilter(event.target.value)}
                    value={assigneeFilter}
                  >
                    <option value="">All assignees</option>
                    {assigneeOptions.map((assignee) => (
                      <option key={assignee} value={assignee}>
                        {assignee}
                      </option>
                    ))}
                  </select>
                  <div className="ticket-view-toggle" role="tablist" aria-label="Ticket view">
                    <button
                      aria-pressed={ticketView === 'card'}
                      className={ticketView === 'card' ? 'compact-toggle compact-toggle--active' : 'compact-toggle'}
                      onClick={() => setTicketView('card')}
                      type="button"
                    >
                      Cards
                    </button>
                    <button
                      aria-pressed={ticketView === 'table'}
                      className={ticketView === 'table' ? 'compact-toggle compact-toggle--active' : 'compact-toggle'}
                      onClick={() => setTicketView('table')}
                      type="button"
                    >
                      Table
                    </button>
                  </div>
                  <button className="compact-toggle" onClick={() => void loadLatestDataset()} type="button">
                    <RotateCcw size={15} />
                    Refresh
                  </button>
                </div>
              </div>

              <div className="ticket-source-banner ticket-source-banner--compact">
                <span>Active File: {latestFileName || 'Unknown'}</span>
                <button
                  aria-expanded={isDatasetInfoOpen}
                  className="compact-toggle"
                  onClick={() => setIsDatasetInfoOpen((current) => !current)}
                  type="button"
                >
                  <TableProperties size={15} />
                  Dataset Info
                </button>
                <div className="history-dropdown">
                  <button
                    aria-expanded={isHistoryExpanded}
                    className="compact-toggle"
                    onClick={() => setIsHistoryExpanded((current) => !current)}
                    type="button"
                  >
                    <History size={15} />
                    Recent Runs
                    <ChevronDown
                      aria-hidden="true"
                      className={isHistoryExpanded ? 'compact-toggle__icon compact-toggle__icon--open' : 'compact-toggle__icon'}
                      size={15}
                    />
                  </button>

                  {isHistoryExpanded ? (
                    <div className="history-dropdown__menu">
                      {recentAnalyses.length ? (
                        <div className="stack-list">
                          {recentAnalyses.map((entry) => (
                            <button
                              key={entry.id}
                              className="stack-row stack-row--interactive"
                              onClick={() => handleRecentRunSelection(entry)}
                              type="button"
                            >
                              <span className="stack-row__label">
                                <History size={16} />
                                <span>
                                  <strong>{entry.fileName}</strong>
                                  <small>{new Date(entry.savedAt).toLocaleString()}</small>
                                </span>
                              </span>
                              <strong>{entry.analysis.rowCount} rows</strong>
                            </button>
                          ))}
                        </div>
                      ) : isLoadingRecent ? (
                        <div className="skeleton-stack">
                          <div className="skeleton-line" />
                          <div className="skeleton-line" />
                        </div>
                      ) : (
                        <EmptyState
                          icon={<Clock3 size={20} />}
                          title="No saved analyses yet"
                          description="Analyze a CSV once and the most recent 10 results will stay available here."
                        />
                      )}
                    </div>
                  ) : null}
                </div>
              </div>

              {latestMessage ? <p className="status-text">{latestMessage}</p> : null}
              {isLoadingLatest ? <p className="status-text">Refreshing latest tickets...</p> : null}

              {latestDataset?.rows?.length ? (
                latestTickets.length ? (
                  ticketView === 'card' ? (
                  <div className="ticket-card-grid">
                    {visibleLatestTickets.map((ticket) => (
                      <TicketCard
                        key={getTicketId(ticket, latestColumns)}
                        columns={latestColumns}
                        ticket={ticket}
                      />
                    ))}
                  </div>
                  ) : (
                    <DataTable
                      assigneeColumn={latestAssigneeColumn}
                      assigneeDrafts={assigneeDrafts}
                      columnFilters={latestColumnFilters}
                      columnTypeMap={latestColumnTypeMap}
                      fileName="latest"
                      onColumnFilterChange={(column, key, value) =>
                        setLatestColumnFilters((current) => ({
                          ...current,
                          [column]: {
                            ...getColumnFilterDefaults(latestColumnTypeMap[column] || 'text'),
                            ...current[column],
                            [key]: value,
                          },
                        }))
                      }
                      onRowSelect={handlePreviewRowSelect}
                      onSort={(column) =>
                        setLatestSortConfig((current) => {
                          if (current.column !== column) {
                            return { column, direction: 'asc' };
                          }

                          if (current.direction === 'asc') {
                            return { column, direction: 'desc' };
                          }

                          return { column: '', direction: 'asc' };
                        })
                      }
                      rows={filteredLatestRows}
                      selectedRow={null}
                      sortConfig={latestSortConfig}
                      visibleColumns={latestVisibleColumns}
                    />
                  )
                ) : (
        <EmptyState
          icon={<FileSpreadsheet size={20} />}
          title="No assigned active tickets found"
          description={
            assigneeFilter
              ? `The latest dataset does not contain any active tickets assigned to ${assigneeFilter}.`
              : 'The latest dataset does not contain any active assigned tickets.'
          }
        />
      )
              ) : (
                <EmptyState
                  icon={<FileSpreadsheet size={20} />}
                  title="No latest ticket dataset"
                  description="Upload a CSV manually or deliver one by email to populate the live ticket dataset."
                />
              )}
            </Card>
          </section>

          {rowDetail ? (
            <div className="row-detail-backdrop" onClick={() => setSelectedRow(null)} role="presentation">
              <aside
                aria-label="Row details"
                className="row-detail-drawer"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="row-detail-drawer__header">
                  <div className="row-detail-drawer__title">
                    <span className="ui-eyebrow">Row Detail</span>
                    <h3>{rowDetail.primary[0]?.value || 'Selected row'}</h3>
                    <p>{rowDetail.primary[1]?.value || analysis.fileName}</p>
                  </div>
                  <button className="compact-toggle compact-toggle--icon" onClick={() => setSelectedRow(null)} type="button">
                    <X size={15} />
                  </button>
                </div>

                <div className="row-detail-drawer__content">
                  <div className="row-detail-card">
                    <div className="row-detail-hero">
                      {rowDetail.primary.map((item) => (
                        <div className="row-detail-hero__item" key={item.label}>
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </div>
                      ))}
                    </div>

                    {rowDetail.description ? (
                      <section className="row-detail-section">
                        <span className="ui-eyebrow">{rowDetail.descriptionLabel || 'Description'}</span>
                        <p>{rowDetail.description}</p>
                      </section>
                    ) : null}

                    {Object.entries(rowDetail.metadataGroups).map(([groupLabel, entries]) =>
                      entries.length ? (
                        <section className="row-detail-section" key={groupLabel}>
                          <h4>{groupLabel}</h4>
                          <div className="row-detail-grid">
                            {entries.map((entry) => (
                              <div className="row-detail-grid__item" key={entry.label}>
                                <span>{entry.label}</span>
                                <strong>{entry.value}</strong>
                              </div>
                            ))}
                          </div>
                        </section>
                      ) : null
                    )}
                  </div>

                  <div className="row-notes-panel">
                    <div className="row-notes-panel__header">
                      <h4>Comments and Notes</h4>
                    </div>
                    {rowDetail.notes.length ? (
                      <div className="row-notes-timeline">
                        {rowDetail.notes.map((note) => (
                          <article className="row-note" key={note.id}>
                            <span>{note.label}</span>
                            <p>{note.value}</p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="row-notes-empty">No notes available</div>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          ) : null}

          <section className="analysis-grid">
            <Card className="analysis-grid__wide">
              <CardHeader
                eyebrow="AI Insights"
                title="Structured analysis"
                description="AI results are grouped into concise sections instead of a raw response block."
              />

              {aiAnalysis ? (
                <div className="analysis-grid">
                  <Card>
                    <CardHeader eyebrow="Section 1" title="Summary" />
                    <p>{aiSections.summary || 'No summary returned.'}</p>
                  </Card>

                  <Card>
                    <CardHeader eyebrow="Section 2" title="Key Insights" />
                    {aiSections.keyInsights.length ? (
                      <ul className="card__list">
                        {aiSections.keyInsights.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No key insights returned.</p>
                    )}
                  </Card>

                  <Card>
                    <CardHeader eyebrow="Section 3" title="Anomalies" />
                    {aiSections.anomalies.length ? (
                      <ul className="card__list">
                        {aiSections.anomalies.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No anomalies identified.</p>
                    )}
                  </Card>

                  <Card>
                    <CardHeader eyebrow="Section 4" title="Recommendations" />
                    {aiSections.recommendations.length ? (
                      <ul className="card__list">
                        {aiSections.recommendations.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No recommendations returned.</p>
                    )}
                  </Card>
                </div>
              ) : (
                <EmptyState
                  icon={<MessageSquareText size={20} />}
                  title="No AI analysis yet"
                  description="Analyze the CSV first, then run AI analysis to generate a structured review."
                />
              )}
            </Card>
          </section>
        </>
      ) : (
        <Card className="module__empty-card">
          <EmptyState
            icon={<FileSpreadsheet size={20} />}
            title="No dataset analyzed yet"
            description="Upload a CSV to see a structured summary, AI insights, and the data explorer."
          />
        </Card>
      )}
    </section>
  );
}
