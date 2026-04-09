import { memo, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  Clock3,
  FileSearch,
  FileSpreadsheet,
  Filter,
  History,
  Layers3,
  MessageSquareText,
  RotateCcw,
  Sparkles,
  TableProperties,
  Upload,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { analyzeCsvFile, getRecentCsvAnalyses, sendAiChat } from '../../app/services/api';
import { Button } from '../../app/ui/Button';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { getCachedWorkDataset, parseCsvText, setCachedWorkDataset } from './workDatasetCache';
import { buildInsights, buildInsightsSummaryPrompt } from './workInsightsMetrics';

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

function getDefaultVisibleColumns(analysis) {
  if (!analysis?.columns?.length) {
    return [];
  }

  const priorityColumns = [
    analysis.categoryColumn,
    ...analysis.columns.filter((column) => /id|name|title|status|date|created|updated|owner|email/i.test(column)),
    ...analysis.columns,
  ].filter(Boolean);

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

function getTopCategory(analysis) {
  return analysis?.topCategories?.[0] || null;
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
  return columns.filter((column) => /comments?|work.?notes?|notes?|journal|activity|updates?|messages?|log/i.test(column));
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
    if (excluded.has(column)) {
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

  const notes = noteColumns.flatMap((column) =>
    splitNoteEntries(row[column]).map((entry, index) => ({
      id: `${column}-${index}`,
      label: column,
      value: entry,
    }))
  );

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
                {visibleColumns.map((column) => (
                  <td key={`${rowIndex}-${column}`}>{getCellText(row, column) || '—'}</td>
                ))}
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
  const [selectedFile, setSelectedFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [recentAnalyses, setRecentAnalyses] = useState([]);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingRecent, setIsLoadingRecent] = useState(true);
  const [visibleColumns, setVisibleColumns] = useState([]);
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
  const topCategory = useMemo(() => getTopCategory(analysis), [analysis]);
  const rowDetail = useMemo(
    () => (selectedRow && analysis?.columns?.length ? buildRowDetail(selectedRow, analysis.columns) : null),
    [analysis, selectedRow]
  );

  async function handleSubmit(event) {
    event.preventDefault();

    if (!selectedFile) {
      setError('Select a CSV file before running the analyzer.');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      const result = await analyzeCsvFile(selectedFile);
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

      selectedFile
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
    } catch (requestError) {
      setAnalysis(null);
      setError(requestError.message);
    } finally {
      setIsSubmitting(false);
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

  async function handleAiAnalysis() {
    if (!analysis) {
      return;
    }

    setAiError('');
    setLoadingAI(true);
    const cachedDataset = getCachedWorkDataset();
    let prompt = [
      'You are an operations analyst.',
      'Summarize these ticket metrics in 4 short bullet points.',
      'Use only the metrics provided.',
      'Focus on backlog risk, ownership, recent activity, and one practical next step.',
      'Do not mention raw rows or speculate beyond the metrics.',
      '',
      `File: ${analysis.fileName}`,
      `Rows: ${analysis.rowCount}`,
      `Columns: ${analysis.columnCount}`,
      `Category column: ${analysis.categoryColumn || 'None'}`,
      `Top categories: ${analysis.topCategories.map((item) => `${item.label} (${item.count})`).join('; ') || 'None'}`,
      `Column completeness: ${analysis.columnCompleteness.map((item) => `${item.column}=${item.filled} filled`).join('; ') || 'None'}`,
      `Insights: ${analysis.insights.join('; ') || 'None'}`,
    ].join('\n');

    if (cachedDataset?.fileName === analysis.fileName && cachedDataset.rows?.length) {
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
      <SectionHeader
        tag="/csv"
        title="Work"
        description="Use the CSV analyzer to turn operational exports into a quick read on volume, categories, and data quality."
        actions={
          <>
            <span className="module__action-pill">
              <Sparkles size={15} />
              Fast summary
            </span>
            <span className="module__action-pill">
              <Layers3 size={15} />
              Structured review
            </span>
          </>
        }
      />

      <form className="csv-control-bar" onSubmit={handleSubmit}>
        <label className="csv-control-bar__file">
          <span className="csv-control-bar__file-icon">
            <Upload size={15} />
          </span>
          <span className="csv-control-bar__file-copy">
            <strong>{selectedFile ? selectedFile.name : 'Choose a CSV file'}</strong>
            <small>Accepted format: `.csv`</small>
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              setSelectedFile(event.target.files?.[0] || null);
              setIsHistoryExpanded(false);
            }}
          />
        </label>

        <div className="csv-control-bar__actions">
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Analyzing...' : 'Analyze CSV'}
          </Button>
          <Button disabled={!analysis || loadingAI} onClick={handleAiAnalysis} type="button" variant="secondary">
            <MessageSquareText size={16} />
            {loadingAI ? 'Analyzing with AI...' : 'Analyze with AI'}
          </Button>
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
                        onClick={() => {
                          setAnalysis(entry.analysis);
                          setIsHistoryExpanded(false);
                          setSelectedRow(null);
                          setCachedWorkDataset(null);
                        }}
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
      </form>

      {error ? <p className="status-text status-text--error">{error}</p> : null}
      {aiError ? <p className="status-text status-text--error">{aiError}</p> : null}

      {analysis ? (
        <>
          <section className="analysis-grid analysis-grid--tight">
            <div className="insight-bar">
              <div className="insight-pill">
                <span>Rows</span>
                <strong>{analysis.rowCount}</strong>
              </div>
              <div className="insight-pill">
                <span>Columns</span>
                <strong>{analysis.columnCount}</strong>
              </div>
              <div className="insight-pill">
                <span>Top Category</span>
                <strong>{topCategory ? `${topCategory.label} (${topCategory.count})` : 'None'}</strong>
              </div>
              <Link className="insight-pill insight-pill--wide insight-pill--link" to="/work/insights">
                <span>Insight</span>
                <strong>{analysis.insights?.[0] || 'No insight available.'}</strong>
              </Link>
            </div>

            <div className="table-toolbar table-toolbar--compact table-toolbar--tool">
              <label className="table-filter table-filter--compact">
                <FileSearch size={15} />
                <input
                  onChange={(event) => setRowFilter(event.target.value)}
                  placeholder="Search visible columns..."
                  type="search"
                  value={rowFilter}
                />
              </label>

              <div className="table-actions">
                <button
                  aria-expanded={isColumnPanelOpen}
                  className="compact-toggle"
                  onClick={() => setIsColumnPanelOpen((current) => !current)}
                  type="button"
                >
                  <Filter size={15} />
                  Columns
                  <ChevronDown
                    aria-hidden="true"
                    className={isColumnPanelOpen ? 'compact-toggle__icon compact-toggle__icon--open' : 'compact-toggle__icon'}
                    size={15}
                  />
                </button>

                <button className="compact-toggle" onClick={resetTableControls} type="button">
                  <RotateCcw size={15} />
                  Reset Filters
                </button>

                <button
                  aria-expanded={isDatasetInfoOpen}
                  className="compact-toggle"
                  onClick={() => setIsDatasetInfoOpen((current) => !current)}
                  type="button"
                >
                  <TableProperties size={15} />
                  Dataset Info
                </button>
              </div>
            </div>

            {isColumnPanelOpen ? (
              <div className="column-visibility-panel column-visibility-panel--popover">
                {analysis.columns.map((column) => (
                  <label className="column-visibility-option" key={column}>
                    <input
                      checked={visibleColumns.includes(column)}
                      onChange={() => toggleColumn(column)}
                      type="checkbox"
                    />
                    <span>{column}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </section>

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

          <section className="analysis-grid analysis-grid--tight">
            <div className="analysis-grid__wide table-surface">
              <div className="table-surface__meta">
                <span>{filteredPreviewRows.length} visible</span>
                <span>{previewRows.length} preview rows</span>
              </div>
              <DataTable
                columnFilters={columnFilters}
                columnTypeMap={columnTypeMap}
                fileName={analysis.fileName}
                onColumnFilterChange={updateColumnFilter}
                onRowSelect={setSelectedRow}
                onSort={handleSort}
                rows={filteredPreviewRows}
                selectedRow={selectedRow}
                sortConfig={sortConfig}
                visibleColumns={visibleColumns}
              />
            </div>
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
