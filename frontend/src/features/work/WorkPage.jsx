import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Clock3,
  FileSpreadsheet,
  History,
  MessageSquareText,
  TableProperties,
  Upload,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  analyzeCsvFile,
  getRecentCsvAnalyses,
  getRecentCsvAnalysisFile,
  getUploadFile,
  getUploads,
  sendAiChat,
} from '../../app/services/api';
import { formatDataFileName } from '../../app/utils/fileDisplay';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { getStoredVisibleColumns, setStoredVisibleColumns } from '../tables/tableUtils';
import { TicketCard } from './components/TicketCard';
import { getCachedWorkDataset, parseCsvText, setCachedWorkDataset } from './workDatasetCache';
import { dedupeNotes, getTicketAssignee, getTicketColumns, getTicketId, isSuppressedTicketColumn } from './utils/aiAnalysis';

const DEFAULT_CARD_ASSIGNEE = 'William West';
const VIEW_STORAGE_KEY = 'westos.work.ticketView';
const TABLE_PAGE_SIZE = 50;
const PREVIEW_COLUMN_PREFERENCE_KEY = 'westos.work.previewColumns';
const DATASET_COLUMN_PREFERENCE_KEY = 'westos.work.datasetColumns';

function formatColumnLabel(column) {
  return String(column ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  return getStoredVisibleColumns(PREVIEW_COLUMN_PREFERENCE_KEY, analysis?.columns || []);
}

function findLatestActiveTicketsUpload(files = []) {
  return files.find((file) => file?.filename?.toLowerCase().endsWith('.csv') && file.filename.toLowerCase().includes('activetickets')) || null;
}

function buildLocalAnalysis(fileName, dataset) {
  const columns = dataset.columns || [];
  const rows = dataset.rows || [];
  const summaryCounts = columns.map((column) => {
    const filled = rows.reduce((count, row) => count + (String(row?.[column] ?? '').trim() ? 1 : 0), 0);
    return {
      column,
      filled,
      empty: Math.max(rows.length - filled, 0),
    };
  });

  const categoryColumn = ['category', 'type', 'status', 'department', 'team', 'group', 'owner'].find((name) =>
    columns.some((column) => column.toLowerCase() === name)
  ) || columns[0] || '';

  return {
    fileName,
    rowCount: rows.length,
    columnCount: columns.length,
    columns,
    categoryColumn,
    topCategories: [],
    columnCompleteness: summaryCounts.slice(0, 6),
    sampleRows: rows.slice(0, 3),
    previewRows: rows.slice(0, 25),
    previewRowCount: Math.min(rows.length, 25),
    insights: rows.length
      ? [`${rows.length} rows loaded across ${columns.length} columns.`]
      : ['Header row detected but no data rows were present.'],
  };
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
  globalSearch,
  page,
  sortConfig,
  onGlobalSearchChange,
  onNextPage,
  onPreviousPage,
  onSort,
  fileName,
  onRowSelect,
  selectedRow,
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
      <div className="data-table__toolbar">
        <input
          aria-label="Search table"
          className="data-table__search"
          onChange={(event) => onGlobalSearchChange(event.target.value)}
          placeholder="Search all visible columns..."
          type="text"
          value={globalSearch}
        />
      </div>
      <table className="data-table">
        <thead>
          <tr>
            {visibleColumns.map((column) => {
              const isSorted = sortConfig.column === column;

              return (
                <th key={column}>
                  <button className="data-table__sort" onClick={() => onSort(column)} type="button">
                    <span>{formatColumnLabel(column)}</span>
                    <span aria-hidden="true">{isSorted ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                  </button>
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
      <div className="data-table__pagination">
        <span>
          Page {page + 1}
        </span>
        <div className="data-table__pagination-actions">
          <button className="compact-toggle" disabled={page === 0} onClick={onPreviousPage} type="button">
            Previous
          </button>
          <button className="compact-toggle" disabled={rows.length < TABLE_PAGE_SIZE} onClick={onNextPage} type="button">
            Next
          </button>
        </div>
      </div>
    </div>
  );
});

export function WorkPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const hasAutoLoadedLatestUpload = useRef(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const initialDataset = getCachedWorkDataset();
  const [analysis, setAnalysis] = useState(() =>
    initialDataset ? buildLocalAnalysis(initialDataset.fileName || 'Cached dataset', initialDataset) : null
  );
  const [latestDataset, setLatestDataset] = useState(() =>
    initialDataset ? { columns: initialDataset.columns || [], rows: initialDataset.rows || [] } : { columns: [], rows: [] }
  );
  const [latestFileName, setLatestFileName] = useState(initialDataset?.fileName || '');
  const [latestMessage, setLatestMessage] = useState('');
  const [ticketView, setTicketView] = useState('card');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [recentAnalyses, setRecentAnalyses] = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingRecent, setIsLoadingRecent] = useState(true);
  const [isLoadingUploads, setIsLoadingUploads] = useState(true);
  const [visibleColumns, setVisibleColumns] = useState([]);
  const [datasetGlobalSearch, setDatasetGlobalSearch] = useState('');
  const [datasetPage, setDatasetPage] = useState(0);
  const [datasetSortConfig, setDatasetSortConfig] = useState({ column: '', direction: 'asc' });
  const [rowFilter, setRowFilter] = useState('');
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [aiError, setAiError] = useState('');
  const [loadingAI, setLoadingAI] = useState(false);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [isUploadsExpanded, setIsUploadsExpanded] = useState(false);
  const [isDatasetInfoOpen, setIsDatasetInfoOpen] = useState(false);
  const [isColumnPanelOpen, setIsColumnPanelOpen] = useState(false);
  const [datasetVisibleColumns, setDatasetVisibleColumns] = useState([]);
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
      const nextDataset = {
        analysisId: entry.id,
        fileName: entry.fileName,
        columns: parsedDataset.columns,
        rows: parsedDataset.rows,
      };
      setLatestDataset({ columns: parsedDataset.columns, rows: parsedDataset.rows });
      setLatestFileName(entry.fileName);
      setLatestMessage('');
      setCachedWorkDataset(nextDataset);
    } catch (requestError) {
      setCachedWorkDataset(null);
      setLatestDataset({ columns: [], rows: [] });
      setError(requestError.message || 'Saved CSV data could not be loaded.');
    } finally {
      if (showLoading) {
        setIsLoadingSavedRun(false);
      }
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
    let isMounted = true;

    async function loadUploadedFiles() {
      try {
        const files = await getUploads();
        if (isMounted) {
          setUploadedFiles(Array.isArray(files) ? files : []);
        }
      } catch {
        if (isMounted) {
          setUploadedFiles([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingUploads(false);
        }
      }
    }

    void loadUploadedFiles();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!recentAnalyses.length || isLoadingSavedRun || latestFileName || findLatestActiveTicketsUpload(uploadedFiles)) {
      return;
    }

    if (!analysis?.analysisId) {
      void loadSavedAnalysisEntry(recentAnalyses[0], { showLoading: false });
    }
  }, [analysis?.analysisId, isLoadingSavedRun, latestFileName, recentAnalyses, uploadedFiles]);

  useEffect(() => {
    if (isLoadingUploads || hasAutoLoadedLatestUpload.current) {
      return;
    }

    const latestActiveTicketsUpload = findLatestActiveTicketsUpload(uploadedFiles);
    if (!latestActiveTicketsUpload) {
      hasAutoLoadedLatestUpload.current = true;
      return;
    }

    hasAutoLoadedLatestUpload.current = true;
    void handleUploadedFileSelection(latestActiveTicketsUpload);
  }, [isLoadingUploads, uploadedFiles]);

  useEffect(() => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, ticketView);
  }, [ticketView]);

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
      setDatasetGlobalSearch('');
      setDatasetPage(0);
      setDatasetVisibleColumns([]);
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
    setDatasetGlobalSearch('');
    setDatasetPage(0);
    setDatasetVisibleColumns(getStoredVisibleColumns(DATASET_COLUMN_PREFERENCE_KEY, analysis.columns || []));
  }, [analysis]);

  useEffect(() => {
    setStoredVisibleColumns(PREVIEW_COLUMN_PREFERENCE_KEY, visibleColumns);
  }, [visibleColumns]);

  useEffect(() => {
    setStoredVisibleColumns(DATASET_COLUMN_PREFERENCE_KEY, datasetVisibleColumns);
  }, [datasetVisibleColumns]);

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
  const datasetColumns = latestDataset.columns || [];
  const datasetAssigneeColumn = useMemo(() => getTicketColumns(datasetColumns).assignee, [datasetColumns]);
  const datasetRows = useMemo(
    () =>
      (latestDataset.rows || []).filter((row) => {
        if (!assigneeFilter.trim()) {
          return true;
        }

        if (!datasetAssigneeColumn) {
          return true;
        }

        return getTicketAssignee(row, datasetColumns).trim().toLowerCase().includes(assigneeFilter.trim().toLowerCase());
      }),
    [assigneeFilter, datasetAssigneeColumn, datasetColumns, latestDataset.rows]
  );
  const assigneeOptions = useMemo(() => {
    if (!datasetAssigneeColumn) {
      return [];
    }

    const uniqueAssignees = Array.from(
      new Set(
        (latestDataset?.rows || [])
          .map((row) => getTicketAssignee(row, datasetColumns).trim())
          .filter(Boolean)
      )
    );

    uniqueAssignees.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
    return uniqueAssignees;
  }, [datasetAssigneeColumn, datasetColumns, latestDataset?.rows]);

  useEffect(() => {
    if (assigneeFilter && !assigneeOptions.includes(assigneeFilter)) {
      setAssigneeFilter('');
    }
  }, [assigneeFilter, assigneeOptions]);
  const datasetColumnTypeMap = useMemo(
    () => Object.fromEntries(datasetVisibleColumns.map((column) => [column, inferColumnType(datasetRows, column)])),
    [datasetRows, datasetVisibleColumns]
  );
  const filteredDatasetRows = useMemo(() => {
    if (!datasetRows.length) {
      return [];
    }

    const searchQuery = datasetGlobalSearch.trim().toLowerCase();
    const filteredRows = datasetRows.filter((row) => {
      if (!searchQuery) {
        return true;
      }

      return datasetVisibleColumns.some((column) => getCellText(row, column).toLowerCase().includes(searchQuery));
    });

    if (!datasetSortConfig.column) {
      return filteredRows;
    }

    const sortDirection = datasetSortConfig.direction === 'asc' ? 1 : -1;
    const columnType = datasetColumnTypeMap[datasetSortConfig.column] || 'text';

    return [...filteredRows].sort(
      (leftRow, rightRow) =>
        compareValues(leftRow[datasetSortConfig.column], rightRow[datasetSortConfig.column], columnType) * sortDirection
    );
  }, [datasetColumnTypeMap, datasetGlobalSearch, datasetSortConfig, datasetRows, datasetVisibleColumns]);
  const visibleDatasetRows = datasetRows;
  const paginatedDatasetRows = useMemo(() => {
    const start = datasetPage * TABLE_PAGE_SIZE;
    return filteredDatasetRows.slice(start, start + TABLE_PAGE_SIZE);
  }, [datasetPage, filteredDatasetRows]);

  useEffect(() => {
    setDatasetPage(0);
  }, [datasetGlobalSearch, datasetSortConfig, latestFileName]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(filteredDatasetRows.length / TABLE_PAGE_SIZE) - 1);
    if (datasetPage > maxPage) {
      setDatasetPage(maxPage);
    }
  }, [datasetPage, filteredDatasetRows.length]);

  useEffect(() => {
    if (!datasetColumns.length) {
      setDatasetVisibleColumns([]);
      return;
    }

    setDatasetVisibleColumns((current) => {
      const next = current.filter((column) => datasetColumns.includes(column));
      if (next.length) {
        return next;
      }

      return getStoredVisibleColumns(DATASET_COLUMN_PREFERENCE_KEY, datasetColumns);
    });
  }, [datasetColumns]);

  async function runAnalysis(file) {
    setError('');
    setIsSubmitting(true);

    try {
      const result = await analyzeCsvFile(file);
      setAnalysis(result.data);
      const parsedDataset = parseCsvText(await file.text());
      const nextDataset = {
        analysisId: result.data.analysisId,
        fileName: result.data.fileName,
        columns: parsedDataset.columns,
        rows: parsedDataset.rows,
      };
      setLatestDataset({ columns: parsedDataset.columns, rows: parsedDataset.rows });
      setLatestFileName(result.data.fileName);
      setLatestMessage('');
      setCachedWorkDataset(nextDataset);
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
    setIsDatasetInfoOpen(false);
    await loadSavedAnalysisEntry(entry);
  }

  async function handleUploadedFileSelection(file) {
    setError('');
    setIsUploadsExpanded(false);
    setIsDatasetInfoOpen(false);

    try {
      const csvText = await getUploadFile(file.url);
      const parsedDataset = parseCsvText(csvText);
      const nextAnalysis = buildLocalAnalysis(file.filename, parsedDataset);
      const nextDataset = {
        fileName: file.filename,
        columns: parsedDataset.columns,
        rows: parsedDataset.rows,
      };

      setAnalysis(nextAnalysis);
      setLatestDataset({ columns: parsedDataset.columns, rows: parsedDataset.rows });
      setLatestFileName(file.filename);
      setLatestMessage(parsedDataset.rows.length ? '' : 'The selected upload contains no data rows.');
      setCachedWorkDataset(nextDataset);
      setSelectedRow(null);
    } catch (requestError) {
      setError(requestError.message || 'Uploaded file could not be loaded.');
    }
  }

  function toggleDatasetColumn(column) {
    setDatasetVisibleColumns((current) =>
      current.includes(column) ? current.filter((item) => item !== column) : [...current, column]
    );
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
    const analysisDataset =
      cachedDataset?.rows?.length &&
      ((cachedDataset.analysisId && cachedDataset.analysisId === analysis.analysisId) ||
        cachedDataset.fileName === analysis.fileName)
        ? cachedDataset
        : latestDataset;

    try {
      const result = await sendAiChat({
        analysis_mode: 'preview',
        dataset: analysisDataset
          ? {
              fileName: analysisDataset.fileName || analysis.fileName,
              columns: analysisDataset.columns || analysis.columns,
              rows: analysisDataset.rows || [],
            }
          : {
              fileName: analysis.fileName,
              columns: analysis.columns || [],
              rows: analysis.previewRows || [],
            },
      });
      setAiAnalysis(result.message || result.summary || '');
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
                    <label className="column-visibility-option dataset-panel__column-option" key={column.name}>
                      <input
                        checked={datasetVisibleColumns.includes(column.name)}
                        onChange={() => toggleDatasetColumn(column.name)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{formatColumnLabel(column.name)}</strong> · {column.type}
                      </span>
                    </label>
                  ))}
                </div>

                <div className="dataset-panel__section">
                  <div className="dataset-panel__section-header">
                    <h4>Change File</h4>
                    <p>Load a dataset from a new CSV, a recent analysis run, or an uploaded archive file.</p>
                  </div>

                  <div className="dataset-panel__action-grid">
                    <button
                      className="compact-toggle dataset-panel__action"
                      onClick={() => fileInputRef.current?.click()}
                      type="button"
                    >
                      <Upload size={15} />
                      Upload New File
                    </button>
                    <button
                      className="compact-toggle dataset-panel__action"
                      onClick={() => {
                        setIsHistoryExpanded((current) => !current);
                        setIsUploadsExpanded(false);
                      }}
                      type="button"
                    >
                      <History size={15} />
                      Choose Recent Run
                    </button>
                    <button
                      className="compact-toggle dataset-panel__action"
                      onClick={() => {
                        setIsUploadsExpanded((current) => !current);
                        setIsHistoryExpanded(false);
                      }}
                      type="button"
                    >
                      <FileSpreadsheet size={15} />
                      Choose Upload
                    </button>
                  </div>
                </div>

                {isHistoryExpanded ? (
                  <div className="dataset-panel__section">
                    <div className="dataset-panel__section-header">
                      <h4>Recent Runs</h4>
                    </div>
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
                                <strong>{formatDataFileName(entry.fileName)}</strong>
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

                {isUploadsExpanded ? (
                  <div className="dataset-panel__section">
                    <div className="dataset-panel__section-header">
                      <h4>Uploaded CSV Files</h4>
                    </div>
                    {uploadedFiles.filter((file) => file.filename.toLowerCase().endsWith('.csv')).length ? (
                      <div className="stack-list">
                        {uploadedFiles
                          .filter((file) => file.filename.toLowerCase().endsWith('.csv'))
                          .map((file) => (
                            <button
                              key={file.filename}
                              className="stack-row stack-row--interactive"
                              onClick={() => void handleUploadedFileSelection(file)}
                              type="button"
                            >
                              <span className="stack-row__label">
                                <Upload size={16} />
                                <span>
                                  <strong>{formatDataFileName(file.filename)}</strong>
                                  <small>{file.url}</small>
                                </span>
                              </span>
                            </button>
                          ))}
                      </div>
                    ) : isLoadingUploads ? (
                      <div className="skeleton-stack">
                        <div className="skeleton-line" />
                        <div className="skeleton-line" />
                      </div>
                    ) : (
                      <EmptyState
                        icon={<Upload size={20} />}
                        title="No uploaded CSV files yet"
                        description="Email intake is archive-only now. Choose a saved CSV here when you want to load it into the table."
                      />
                    )}
                  </div>
                ) : null}
              </aside>
            </div>
          ) : null}

          <section className="analysis-grid">
            <Card className="analysis-grid__wide">
              <div className="ticket-toolbar ticket-toolbar--compact">
                <div className="ticket-toolbar__header">
                  <span className="ticket-source-banner__pill">
                    {visibleDatasetRows.length} {visibleDatasetRows.length === 1 ? 'row' : 'rows'}
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
                  <button className="compact-toggle" onClick={() => setIsDatasetInfoOpen(true)} type="button">
                    <TableProperties size={15} />
                    Dataset Panel
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
                  {datasetAssigneeColumn ? (
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
                  ) : null}
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
                      aria-pressed="false"
                      className="compact-toggle"
                      onClick={() => navigate('/app/work/table')}
                      type="button"
                    >
                      Table
                    </button>
                    <button
                      className="compact-toggle"
                      onClick={() => navigate('/app/work/ai-metrics')}
                      type="button"
                    >
                      <BarChart3 size={15} />
                      AI Metrics
                    </button>
                  </div>
                </div>
              </div>

              <div className="ticket-source-banner ticket-source-banner--compact">
                <span>Active File: {formatDataFileName(latestFileName) || 'Unknown'}</span>
                <span>{datasetVisibleColumns.length} columns visible</span>
              </div>

              {latestMessage ? <p className="status-text">{latestMessage}</p> : null}

              {latestDataset?.rows?.length ? (
                visibleDatasetRows.length ? (
                  <div className="ticket-card-grid">
                    {visibleDatasetRows.map((ticket, index) => (
                      <TicketCard
                        key={`${getTicketId(ticket, datasetColumns)}-${index}`}
                        columns={datasetColumns}
                        onOpen={handlePreviewRowSelect}
                        ticket={ticket}
                      />
                    ))}
                  </div>
                ) : (
        <EmptyState
          icon={<FileSpreadsheet size={20} />}
          title="No rows match the current view"
          description={
            assigneeFilter
              ? `The selected dataset does not contain any rows assigned to ${assigneeFilter}.`
              : 'The selected dataset does not contain any rows that match the current filters.'
          }
        />
      )
              ) : (
                <EmptyState
                  icon={<FileSpreadsheet size={20} />}
                  title="No dataset loaded"
                  description="Upload a CSV manually or choose one from Uploaded Files to render it in cards or table view."
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
