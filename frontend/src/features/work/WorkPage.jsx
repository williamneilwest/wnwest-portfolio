import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet,
  MessageSquareText,
  Tag,
  X,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  analyzeCsvFile,
  getKnowledgeBase,
  getLatestTickets,
  getRecentCsvAnalyses,
  getRecentCsvAnalysisFile,
  getUploadFile,
  getUploads,
} from '../../app/services/api';
import { chatAI, getFeatureAgentId } from '../../app/services/aiClient';
import { STORAGE_KEYS } from '../../app/constants/storageKeys';
import { formatDataFileName } from '../../app/utils/fileDisplay';
import { storage } from '../../app/utils/storage';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { ErrorBoundary } from '../../app/ui/ErrorBoundary';
import { getStoredVisibleColumns, setStoredVisibleColumns } from '../tables/tableUtils';
import { DataTable } from '../../components/dataset/DataTable';
import { DataCardList } from '../../components/dataset/DataCardList';
import {
  compareValues,
  detectTicketColumn,
  filterRowsByGlobalSearch,
  formatColumnLabel,
  getCellText,
  inferColumnType,
  normalizeColumns,
  rowMatchesGlobalSearch,
} from '../../components/dataset/utils';
import { DatasetPage } from '../../pages/dataset/DatasetPage';
import { useCurrentUser } from '../../app/hooks/useCurrentUser';
import { getCachedWorkDataset, parseCsvText, setCachedWorkDataset } from './workDatasetCache';
import { dedupeNotes, getTicketAssignee, getTicketColumns, getTicketId, isSuppressedTicketColumn } from './utils/aiAnalysis';
import { buildTicketRuleText, collectKbTagWordsFromKnowledgeBase, matchTicketRules } from './utils/ticketRules';

const DEFAULT_CARD_ASSIGNEE = 'William West';
const VIEW_STORAGE_KEY = STORAGE_KEYS.TICKET_VIEW;
const TABLE_PAGE_SIZE = 50;
const PREVIEW_COLUMN_PREFERENCE_KEY = 'westos.work.previewColumns';
const DATASET_COLUMN_PREFERENCE_KEY = 'westos.work.datasetColumns';
const ACTIVE_TICKETS_FIXED_FILE = 'ActiveTicketsLAH.csv';

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

function formatUploadTimestamp(value) {
  if (!value) {
    return 'Time unavailable';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Time unavailable';
  }

  return parsed.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatUploadSource(value) {
  return String(value || '').trim().toLowerCase() === 'email' ? 'Email upload' : 'Manual upload';
}

function getDefaultVisibleColumns(analysis) {
  return getStoredVisibleColumns(PREVIEW_COLUMN_PREFERENCE_KEY, analysis?.columns || []);
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

export function WorkPage() {
  const { authenticated } = useCurrentUser();
  const navigate = useNavigate();
  const location = useLocation();
  const isActiveTicketsRoute = location.pathname.startsWith('/app/work/active-tickets');
  const fileInputRef = useRef(null);
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
  const [datasetView, setDatasetView] = useState(() => {
    const stored = String(storage.get(VIEW_STORAGE_KEY) || '').toLowerCase();
    if (stored === 'cards' || stored === 'table' || stored === 'metrics') {
      return stored;
    }
    return 'cards';
  });
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [showOnlyFlaggedTickets, setShowOnlyFlaggedTickets] = useState(false);
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
  const [datasetVisibleColumns, setDatasetVisibleColumns] = useState([]);
  const [columnFilters, setColumnFilters] = useState({});
  const [sortConfig, setSortConfig] = useState({ column: '', direction: 'asc' });
  const [debouncedRowFilter, setDebouncedRowFilter] = useState('');
  const [selectedRow, setSelectedRow] = useState(null);
  const [isLoadingSavedRun, setIsLoadingSavedRun] = useState(false);
  const [kbTagWords, setKbTagWords] = useState([]);
  const csvUploads = useMemo(
    () =>
      uploadedFiles.filter((file) => {
        const filename = String(file?.filename || '').toLowerCase();
        const mime = String(file?.mimeType || '').toLowerCase();
        return filename.endsWith('.csv') || mime.includes('csv');
      }),
    [uploadedFiles]
  );

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
  }, [authenticated, isActiveTicketsRoute]);

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
  }, [authenticated, isActiveTicketsRoute]);

  useEffect(() => {
    let isMounted = true;

    async function loadKbTagWords() {
      try {
        const payload = await getKnowledgeBase();
        if (isMounted) {
          setKbTagWords(collectKbTagWordsFromKnowledgeBase(payload));
        }
      } catch {
        if (isMounted) {
          setKbTagWords([]);
        }
      }
    }

    void loadKbTagWords();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isActiveTicketsRoute) {
      return;
    }

    let isMounted = true;

    async function loadFixedActiveTicketsDataset() {
      setError('');
      setIsLoadingSavedRun(true);
      setSelectedFile(null);
      setSelectedRow(null);

      try {
        const payload = await getLatestTickets();
        const latestTicketsPayload = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
        if (!isMounted) {
          return;
        }

        const columns = Array.isArray(latestTicketsPayload?.columns) ? latestTicketsPayload.columns : [];
        const rows = Array.isArray(latestTicketsPayload?.tickets) ? latestTicketsPayload.tickets : [];
        const fileName = String(latestTicketsPayload?.fileName || ACTIVE_TICKETS_FIXED_FILE).trim() || ACTIVE_TICKETS_FIXED_FILE;
        const nextDataset = {
          fileName,
          columns,
          rows,
        };

        setAnalysis(buildLocalAnalysis(fileName, nextDataset));
        setLatestDataset({ columns, rows });
        setLatestFileName(fileName);
        setLatestMessage(String(latestTicketsPayload?.message || '').trim());
        setCachedWorkDataset(nextDataset);
      } catch (requestError) {
        if (!isMounted) {
          return;
        }
        setAnalysis(null);
        setLatestDataset({ columns: [], rows: [] });
        setLatestFileName(ACTIVE_TICKETS_FIXED_FILE);
        setError(requestError.message || 'Active Tickets dataset could not be loaded.');
      } finally {
        if (isMounted) {
          setIsLoadingSavedRun(false);
        }
      }
    }

    void loadFixedActiveTicketsDataset();

    return () => {
      isMounted = false;
    };
  }, [isActiveTicketsRoute]);

  useEffect(() => {
    if (!recentAnalyses.length || isLoadingSavedRun || latestFileName || csvUploads.length) {
      return;
    }

    if (isActiveTicketsRoute) {
      return;
    }

    if (!analysis?.analysisId) {
      void loadSavedAnalysisEntry(recentAnalyses[0], { showLoading: false });
    }
  }, [csvUploads.length, analysis?.analysisId, isActiveTicketsRoute, isLoadingSavedRun, latestFileName, recentAnalyses]);

  useEffect(() => {
    storage.set(VIEW_STORAGE_KEY, datasetView);
  }, [datasetView]);

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

    const filteredRows = previewRows.filter((row) => {
      const matchesGlobalSearch = rowMatchesGlobalSearch(row, visibleColumns, debouncedRowFilter);

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
  const ticketColumn = useMemo(() => detectTicketColumn(datasetColumns), [datasetColumns]);
  const datasetAssigneeColumn = useMemo(() => getTicketColumns(datasetColumns).assignee, [datasetColumns]);
  const datasetDescriptionColumn = useMemo(() => getDescriptionColumn(datasetColumns), [datasetColumns]);
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
  const normalizedTickets = useMemo(
    () =>
      (datasetRows || []).map((ticket) => ({
        ...(ticket || {}),
        notes: Array.isArray(ticket?.notes) ? ticket.notes : [],
        comments: typeof ticket?.comments === 'string' ? ticket.comments : '',
        work_notes: typeof ticket?.work_notes === 'string' ? ticket.work_notes : '',
      })),
    [datasetRows]
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
  const matchedDatasetTickets = useMemo(
    () =>
      normalizedTickets.map((ticket) => ({
        ticket,
        matchedRules: matchTicketRules(
          buildTicketRuleText(ticket, datasetColumns, datasetDescriptionColumn),
          { kbTagWords }
        ),
      })),
    [datasetColumns, datasetDescriptionColumn, normalizedTickets, kbTagWords]
  );
  const visibleTickets = useMemo(
    () =>
      matchedDatasetTickets.filter(({ matchedRules }) =>
        showOnlyFlaggedTickets ? matchedRules.length > 0 : true
      ),
    [matchedDatasetTickets, showOnlyFlaggedTickets]
  );
  const tableBaseRows = useMemo(
    () => visibleTickets.map(({ ticket }) => ticket),
    [visibleTickets]
  );
  const datasetColumnTypeMap = useMemo(
    () => Object.fromEntries(datasetVisibleColumns.map((column) => [column, inferColumnType(tableBaseRows, column)])),
    [tableBaseRows, datasetVisibleColumns]
  );
  const filteredDatasetRows = useMemo(() => {
    if (!tableBaseRows.length) {
      return [];
    }

    const filteredRows = filterRowsByGlobalSearch(tableBaseRows, datasetVisibleColumns, datasetGlobalSearch);

    if (!datasetSortConfig.column) {
      return filteredRows;
    }

    const sortDirection = datasetSortConfig.direction === 'asc' ? 1 : -1;
    const columnType = datasetColumnTypeMap[datasetSortConfig.column] || 'text';

    return [...filteredRows].sort(
      (leftRow, rightRow) =>
        compareValues(leftRow[datasetSortConfig.column], rightRow[datasetSortConfig.column], columnType) * sortDirection
    );
  }, [datasetColumnTypeMap, datasetGlobalSearch, datasetSortConfig, tableBaseRows, datasetVisibleColumns]);
  const paginatedDatasetRows = useMemo(() => {
    const start = datasetPage * TABLE_PAGE_SIZE;
    return filteredDatasetRows.slice(start, start + TABLE_PAGE_SIZE);
  }, [datasetPage, filteredDatasetRows]);
  const paginatedVisibleTickets = useMemo(() => {
    const start = datasetPage * TABLE_PAGE_SIZE;
    return visibleTickets.slice(start, start + TABLE_PAGE_SIZE);
  }, [datasetPage, visibleTickets]);

  useEffect(() => {
    setDatasetPage(0);
  }, [datasetGlobalSearch, datasetSortConfig, latestFileName]);

  useEffect(() => {
    const rowCount = datasetView === 'cards' ? visibleTickets.length : filteredDatasetRows.length;
    const maxPage = Math.max(0, Math.ceil(rowCount / TABLE_PAGE_SIZE) - 1);
    if (datasetPage > maxPage) {
      setDatasetPage(maxPage);
    }
  }, [datasetPage, datasetView, filteredDatasetRows.length, visibleTickets.length]);

  useEffect(() => {
    setDatasetPage(0);
  }, [assigneeFilter, datasetView, showOnlyFlaggedTickets]);

  useEffect(() => {
    if (!datasetColumns.length) {
      setDatasetVisibleColumns([]);
      return;
    }

    setDatasetVisibleColumns((current) => {
      const next = normalizeColumns(current.filter((column) => datasetColumns.includes(column)));
      if (next.length) {
        if (!ticketColumn) {
          return next;
        }
        return normalizeColumns(Array.from(new Set([ticketColumn, ...next])));
      }

      const storedColumns = normalizeColumns(getStoredVisibleColumns(DATASET_COLUMN_PREFERENCE_KEY, datasetColumns));
      if (!ticketColumn) {
        return storedColumns;
      }
      return normalizeColumns(Array.from(new Set([ticketColumn, ...storedColumns])));
    });
  }, [datasetColumns, ticketColumn]);

  function handleDatasetVisibleColumnsChange(nextColumns) {
    const normalizedNext = normalizeColumns(
      (Array.isArray(nextColumns) ? nextColumns : []).filter((column) => datasetColumns.includes(column))
    );

    if (!ticketColumn) {
      setDatasetVisibleColumns(normalizedNext);
      return;
    }

    setDatasetVisibleColumns(normalizeColumns(Array.from(new Set([ticketColumn, ...normalizedNext]))));
  }

  const datasetMetadata = useMemo(
    () => ({
      rowCount: latestDataset?.rows?.length || 0,
      columnCount: datasetColumns.length,
      inferredTypes: Object.fromEntries(datasetColumns.map((column) => [column, inferColumnType(latestDataset?.rows || [], column)])),
      categoryField: analysis?.categoryColumn || '',
      ticketColumn,
      fileName: formatDataFileName(latestFileName) || 'Unknown',
    }),
    [analysis?.categoryColumn, datasetColumns, latestDataset?.rows, latestFileName, ticketColumn]
  );

  const datasetState = useMemo(
    () => ({
      rawData: latestDataset?.rows || [],
      columns: datasetColumns,
      visibleColumns: datasetVisibleColumns,
      metadata: datasetMetadata,
      view: datasetView,
    }),
    [datasetColumns, datasetMetadata, datasetView, datasetVisibleColumns, latestDataset?.rows]
  );

  const cardRows = useMemo(
    () =>
      paginatedVisibleTickets.map(({ ticket, matchedRules }) => ({
        ...(ticket || {}),
        __westos: { matchedRules: matchedRules || [] },
      })),
    [paginatedVisibleTickets]
  );

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
    await loadSavedAnalysisEntry(entry);
  }

  async function handleUploadedFileSelection(file) {
    setError('');
    setIsUploadsExpanded(false);

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

    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    navigate(`/tickets/${encodeURIComponent(ticketId)}`, {
      state: {
        from: `${location.pathname}${location.search || ''}`,
        label: 'Active Tickets',
      },
    });
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
      const result = await chatAI({
        analysis_mode: 'preview',
        agent_id: getFeatureAgentId('ticket_analysis', 'ticket_analyzer'),
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
    <section className="module module--dataset-surface">
      {error ? <p className="status-text status-text--error">{error}</p> : null}
      {aiError ? <p className="status-text status-text--error">{aiError}</p> : null}
      {isLoadingSavedRun ? <p className="status-text">Loading saved run dataset...</p> : null}

      {analysis ? (
        <>
          <input
            ref={fileInputRef}
            accept=".csv,text/csv"
            className="ticket-toolbar__file-input"
            onChange={(event) => handleFileSelection(event.target.files?.[0] || null)}
            type="file"
          />

          <DatasetPage
            datasetState={datasetState}
            onVisibleColumnsChange={handleDatasetVisibleColumnsChange}
            onUploadClick={() => fileInputRef.current?.click()}
            onToggleHistory={() => {
              setIsHistoryExpanded((current) => !current);
              setIsUploadsExpanded(false);
            }}
            onToggleUploads={() => {
              setIsUploadsExpanded((current) => !current);
              setIsHistoryExpanded(false);
            }}
            isHistoryExpanded={isHistoryExpanded}
            isUploadsExpanded={isUploadsExpanded}
            recentAnalyses={recentAnalyses}
            isLoadingRecent={isLoadingRecent}
            onRecentRunSelect={handleRecentRunSelection}
            uploadedFiles={csvUploads}
            isLoadingUploads={isLoadingUploads}
            onUploadSelect={(file) => void handleUploadedFileSelection(file)}
            leftControls={(
              <input
                aria-label="Search dataset rows"
                className="data-table__search"
                onChange={(event) => setDatasetGlobalSearch(event.target.value)}
                placeholder="Search..."
                type="text"
                value={datasetGlobalSearch}
              />
            )}
            rightControls={(
              <>
                {datasetAssigneeColumn ? (
                  <select
                    className="ticket-queue__filter"
                    onChange={(event) => setAssigneeFilter(event.target.value)}
                    value={assigneeFilter}
                  >
                    <option value="">Assignee</option>
                    {assigneeOptions.map((assignee) => (
                      <option key={assignee} value={assignee}>{assignee}</option>
                    ))}
                  </select>
                ) : null}
                <button
                  aria-pressed={showOnlyFlaggedTickets}
                  className={showOnlyFlaggedTickets ? 'compact-toggle compact-toggle--active' : 'compact-toggle'}
                  onClick={() => setShowOnlyFlaggedTickets((current) => !current)}
                  type="button"
                >
                  Flagged
                </button>
                <button
                  className="compact-toggle"
                  disabled={!analysis || loadingAI || isLoadingSavedRun || !authenticated}
                  title={!authenticated ? 'Sign in to use this feature' : ''}
                  onClick={handleAiAnalysis}
                  type="button"
                >
                  <MessageSquareText size={14} />
                  {loadingAI ? 'AI...' : 'Run AI'}
                </button>
                <div className="ticket-view-toggle" role="tablist" aria-label="Dataset view">
                  <button
                    aria-pressed={datasetView === 'cards'}
                    className={datasetView === 'cards' ? 'compact-toggle compact-toggle--active' : 'compact-toggle'}
                    onClick={() => setDatasetView('cards')}
                    type="button"
                  >
                    Cards
                  </button>
                  <button
                    aria-pressed={datasetView === 'table'}
                    className={datasetView === 'table' ? 'compact-toggle compact-toggle--active' : 'compact-toggle'}
                    onClick={() => setDatasetView('table')}
                    type="button"
                  >
                    Table
                  </button>
                  <button
                    aria-pressed={datasetView === 'metrics'}
                    className={datasetView === 'metrics' ? 'compact-toggle compact-toggle--active' : 'compact-toggle'}
                    onClick={() => setDatasetView('metrics')}
                    type="button"
                  >
                    Metrics
                  </button>
                </div>
              </>
            )}
            uploadDisabled={!authenticated}
            uploadDisabledReason="Sign in to use this feature"
          >
            <section className="analysis-grid">
              <Card className="analysis-grid__wide">
                <div className="ticket-source-banner ticket-source-banner--compact">
                  <span>Active File: {formatDataFileName(latestFileName) || 'Unknown'}</span>
                  <span>{datasetVisibleColumns.length} columns visible</span>
                </div>

                {latestMessage ? <p className="status-text">{latestMessage}</p> : null}

                {latestDataset?.rows?.length ? (
                  visibleTickets.length ? (
                    datasetView === 'cards' ? (
                      <ErrorBoundary
                        fallback={
                          <EmptyState
                            icon={<FileSpreadsheet size={20} />}
                            title="Card view unavailable"
                            description="A rendering issue occurred in card mode."
                          />
                        }
                      >
                        <DataCardList
                          rows={cardRows}
                          visibleColumns={datasetVisibleColumns}
                          onRowSelect={handlePreviewRowSelect}
                          rowKey={(row, index) =>
                            row?.id
                            || row?.ticket_number
                            || row?.number
                            || row?.sys_id
                            || getTicketId(row, datasetColumns)
                            || `row-${index}`
                          }
                          config={{
                            variant: 'ticket',
                            primaryField: 'number',
                            secondaryField: datasetDescriptionColumn,
                            badgeField: 'state',
                            getIndicators: (row) => {
                              const rules = row?.__westos?.matchedRules || [];
                              const hasTag = rules.some((rule) => {
                                const id = String(rule?.id || '').toLowerCase();
                                return id === 'responder_group' || id.startsWith('kb_tag_');
                              });
                              return hasTag ? [{ label: 'Tagged', tone: 'info', icon: <Tag size={12} /> }] : [];
                            },
                          }}
                        />
                      </ErrorBoundary>
                    ) : datasetView === 'table' ? (
                      <DataTable
                        onRowSelect={handlePreviewRowSelect}
                        onSort={(column) =>
                          setDatasetSortConfig((current) => {
                            if (current.column !== column) return { column, direction: 'asc' };
                            if (current.direction === 'asc') return { column, direction: 'desc' };
                            return { column: '', direction: 'asc' };
                          })
                        }
                        rows={paginatedDatasetRows}
                        selectedRow={selectedRow}
                        sortConfig={datasetSortConfig}
                        visibleColumns={datasetVisibleColumns}
                      />
                    ) : (
                      <div className="dataset-metrics-grid">
                        <div className="metric-tile"><span>Rows in view</span><strong>{visibleTickets.length}</strong></div>
                        <div className="metric-tile"><span>Flagged rows</span><strong>{visibleTickets.filter((item) => (item.matchedRules || []).length > 0).length}</strong></div>
                        <div className="metric-tile"><span>Visible columns</span><strong>{datasetVisibleColumns.length}</strong></div>
                        <div className="metric-tile"><span>Current page</span><strong>{datasetPage + 1}</strong></div>
                      </div>
                    )
                  ) : (
                    <EmptyState
                      icon={<FileSpreadsheet size={20} />}
                      title="No rows match the current view"
                      description={
                        assigneeFilter
                          ? `No rows are assigned to ${assigneeFilter}.`
                          : showOnlyFlaggedTickets
                            ? 'No flagged rows match current filters.'
                            : 'No dataset rows match current filters.'
                      }
                    />
                  )
                ) : (
                  <EmptyState
                    icon={<FileSpreadsheet size={20} />}
                    title="No dataset loaded"
                    description="Upload a CSV or choose one from recent runs/uploads."
                  />
                )}

                {datasetView !== 'metrics' ? (
                  <div className="data-table__pagination">
                    <span>Page {datasetPage + 1}</span>
                    <div className="data-table__pagination-actions">
                      <button
                        className="compact-toggle"
                        disabled={datasetPage === 0}
                        onClick={() => setDatasetPage((current) => Math.max(0, current - 1))}
                        type="button"
                      >
                        Previous
                      </button>
                      <button
                        className="compact-toggle"
                        disabled={(datasetPage + 1) * TABLE_PAGE_SIZE >= (datasetView === 'cards' ? visibleTickets.length : filteredDatasetRows.length)}
                        onClick={() => setDatasetPage((current) => current + 1)}
                        type="button"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </Card>
            </section>
          </DatasetPage>

          {rowDetail ? (
            <div className="row-detail-backdrop" onClick={() => setSelectedRow(null)} role="presentation">
              <aside aria-label="Row details" className="row-detail-drawer" onClick={(event) => event.stopPropagation()}>
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
                    <div className="row-notes-panel__header"><h4>Comments and Notes</h4></div>
                    {rowDetail.notes?.length ? (
                      <div className="row-notes-timeline">
                        {(rowDetail.notes || []).map((note, index) => (
                          <article className="row-note" key={note?.id || `note-${index}`}>
                            <span>{note?.label || 'Note'}</span>
                            <p>{note?.value || ''}</p>
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
                <div className="card__scroll">
                  <div className="analysis-grid">
                    <Card>
                      <CardHeader eyebrow="Section 1" title="Summary" />
                      <p>{aiSections.summary || 'No summary returned.'}</p>
                    </Card>
                    <Card>
                      <CardHeader eyebrow="Section 2" title="Key Insights" />
                      {aiSections.keyInsights.length ? (
                        <ul className="card__list">{aiSections.keyInsights.map((item) => <li key={item}>{item}</li>)}</ul>
                      ) : (
                        <p>No key insights returned.</p>
                      )}
                    </Card>
                    <Card>
                      <CardHeader eyebrow="Section 3" title="Anomalies" />
                      {aiSections.anomalies.length ? (
                        <ul className="card__list">{aiSections.anomalies.map((item) => <li key={item}>{item}</li>)}</ul>
                      ) : (
                        <p>No anomalies identified.</p>
                      )}
                    </Card>
                    <Card>
                      <CardHeader eyebrow="Section 4" title="Recommendations" />
                      {aiSections.recommendations.length ? (
                        <ul className="card__list">{aiSections.recommendations.map((item) => <li key={item}>{item}</li>)}</ul>
                      ) : (
                        <p>No recommendations returned.</p>
                      )}
                    </Card>
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={<MessageSquareText size={20} />}
                  title="No AI analysis yet"
                  description="Run AI analysis to generate a structured review."
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
