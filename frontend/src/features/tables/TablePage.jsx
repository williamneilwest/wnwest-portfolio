import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clock3, FileSpreadsheet, History, TableProperties, Upload, X } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { getRecentCsvAnalyses, getRecentCsvAnalysisFile, getUploadFile, getUploads } from '../../app/services/api';
import { useBackNavigation } from '../../app/hooks/useBackNavigation';
import { formatDataFileName } from '../../app/utils/fileDisplay';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { DataTable } from './components/DataTable';
import {
  TABLE_PAGE_SIZE,
  compareValues,
  formatColumnLabel,
  getCellText,
  getStoredVisibleColumns,
  inferColumnType,
  setStoredVisibleColumns,
} from './tableUtils';
import { getCachedWorkDataset, parseCsvText, setCachedWorkDataset } from '../work/workDatasetCache';
import { dedupeNotes, getTicketColumns, getTicketId, isSuppressedTicketColumn } from '../work/utils/aiAnalysis';

const DATASET_COLUMN_PREFERENCE_KEY = 'westos.work.datasetColumns';

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
  const noteColumns = getTicketColumns(columns).noteColumns;
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

  const notes = dedupeNotes(
    noteColumns
      .flatMap((column) =>
        splitNoteEntries(row[column]).map((entry, index) => ({
          id: `${column}-${index}`,
          label: column,
          value: entry,
        }))
      )
      .reverse()
  );

  return {
    primary: primaryColumns.map((column) => ({ label: column, value: getCellText(row, column).trim() })).filter((item) => item.value),
    description: descriptionColumn ? getCellText(row, descriptionColumn).trim() : '',
    descriptionLabel: descriptionColumn,
    metadataGroups,
    notes,
  };
}

function buildDatasetPayload({ fileName, rows, columns, sourceUrl }) {
  return {
    fileName,
    rows,
    columns,
    sourceUrl,
  };
}

export function TablePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useBackNavigation('/app/work/active-tickets');
  const backLabel = location.state?.label || 'Work';
  const fileInputRef = useRef(null);
  const [searchParams] = useSearchParams();
  const sourceUrl = searchParams.get('url') || '';
  const sourceFileName = searchParams.get('fileName') || '';
  const initialDataset = getCachedWorkDataset();
  const shouldUseCachedDataset = !sourceUrl;
  const [dataset, setDataset] = useState(() =>
    shouldUseCachedDataset && initialDataset ? initialDataset : { fileName: sourceFileName, columns: [], rows: [] }
  );
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(Boolean(sourceUrl));
  const [globalSearch, setGlobalSearch] = useState('');
  const [page, setPage] = useState(0);
  const [sortConfig, setSortConfig] = useState({ column: '', direction: 'asc' });
  const [visibleColumns, setVisibleColumns] = useState(() =>
    getStoredVisibleColumns(DATASET_COLUMN_PREFERENCE_KEY, initialDataset?.columns || [])
  );
  const [selectedRow, setSelectedRow] = useState(null);
  const [isDatasetInfoOpen, setIsDatasetInfoOpen] = useState(false);
  const [recentAnalyses, setRecentAnalyses] = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(true);
  const [isLoadingUploads, setIsLoadingUploads] = useState(true);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [isUploadsExpanded, setIsUploadsExpanded] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadDataset() {
      if (!sourceUrl) {
        if (!shouldUseCachedDataset) {
          return;
        }

        setDataset(getCachedWorkDataset() || { fileName: '', columns: [], rows: [] });
        setIsLoading(false);
        return;
      }

      setError('');
      setIsLoading(true);

      try {
        const csvText = await getUploadFile(sourceUrl);
        const parsedDataset = parseCsvText(csvText);
        const cachedDataset = getCachedWorkDataset();
        const nextDataset = buildDatasetPayload({
          fileName: sourceFileName || cachedDataset?.fileName || 'Uploaded CSV',
          rows: parsedDataset.rows,
          columns: parsedDataset.columns,
          sourceUrl,
        });

        if (!isMounted) {
          return;
        }

        setDataset(nextDataset);
        setCachedWorkDataset(nextDataset);
      } catch (requestError) {
        if (!isMounted) {
          return;
        }

        setDataset({ fileName: sourceFileName, columns: [], rows: [] });
        setError(requestError.message || 'CSV file could not be loaded.');
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadDataset();

    return () => {
      isMounted = false;
    };
  }, [shouldUseCachedDataset, sourceFileName, sourceUrl]);

  useEffect(() => {
    let isMounted = true;

    async function loadRecentAnalyses() {
      try {
        const result = await getRecentCsvAnalyses();

        if (isMounted) {
          setRecentAnalyses(result.data || []);
        }
      } catch {
        if (isMounted) {
          setRecentAnalyses([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingRecent(false);
        }
      }
    }

    void loadRecentAnalyses();

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
    setVisibleColumns((current) => {
      const next = current.filter((column) => dataset.columns?.includes(column));
      return next.length ? next : getStoredVisibleColumns(DATASET_COLUMN_PREFERENCE_KEY, dataset.columns || []);
    });
    setSelectedRow(null);
    setGlobalSearch('');
    setPage(0);
    setSortConfig({ column: '', direction: 'asc' });
  }, [dataset.columns, dataset.fileName]);

  useEffect(() => {
    setStoredVisibleColumns(DATASET_COLUMN_PREFERENCE_KEY, visibleColumns);
  }, [visibleColumns]);

  const columnTypeMap = useMemo(
    () => Object.fromEntries(visibleColumns.map((column) => [column, inferColumnType(dataset.rows || [], column)])),
    [dataset.rows, visibleColumns]
  );

  const filteredRows = useMemo(() => {
    const rows = dataset.rows || [];
    if (!rows.length) {
      return [];
    }

    const searchQuery = globalSearch.trim().toLowerCase();
    const matchingRows = rows.filter((row) => {
      if (!searchQuery) {
        return true;
      }

      return visibleColumns.some((column) => getCellText(row, column).toLowerCase().includes(searchQuery));
    });

    if (!sortConfig.column) {
      return matchingRows;
    }

    const sortDirection = sortConfig.direction === 'asc' ? 1 : -1;
    const columnType = columnTypeMap[sortConfig.column] || 'text';

    return [...matchingRows].sort(
      (leftRow, rightRow) => compareValues(leftRow[sortConfig.column], rightRow[sortConfig.column], columnType) * sortDirection
    );
  }, [columnTypeMap, dataset.rows, globalSearch, sortConfig, visibleColumns]);

  const paginatedRows = useMemo(() => {
    const start = page * TABLE_PAGE_SIZE;
    return filteredRows.slice(start, start + TABLE_PAGE_SIZE);
  }, [filteredRows, page]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(filteredRows.length / TABLE_PAGE_SIZE) - 1);
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [filteredRows.length, page]);

  const rowDetail = useMemo(
    () => (selectedRow && dataset.columns?.length ? buildRowDetail(selectedRow, dataset.columns) : null),
    [dataset.columns, selectedRow]
  );

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

  function handleRowSelect(row) {
    const ticketId = getTicketId(row, dataset.columns || []);

    if (ticketId && ticketId !== 'Untitled ticket') {
      navigate(`/tickets/${encodeURIComponent(ticketId)}`, {
        state: {
          from: `${location.pathname}${location.search || ''}`,
          label: location.state?.label || 'Table Viewer',
        },
      });
      return;
    }

    setSelectedRow(row);
  }

  async function handleLocalFileSelection(file) {
    if (!file) {
      return;
    }

    setError('');
    setIsDatasetInfoOpen(false);
    setIsHistoryExpanded(false);
    setIsUploadsExpanded(false);

    try {
      const parsedDataset = parseCsvText(await file.text());
      const nextDataset = buildDatasetPayload({
        fileName: file.name,
        rows: parsedDataset.rows,
        columns: parsedDataset.columns,
        sourceUrl: '',
      });

      setDataset(nextDataset);
      setCachedWorkDataset(nextDataset);
    } catch (requestError) {
      setError(requestError.message || 'CSV file could not be loaded.');
    }
  }

  async function handleUploadedFileSelection(file) {
    if (!file?.url) {
      return;
    }

    setError('');
    setIsDatasetInfoOpen(false);
    setIsHistoryExpanded(false);
    setIsUploadsExpanded(false);
    setIsLoading(true);

    try {
      const csvText = await getUploadFile(file.url);
      const parsedDataset = parseCsvText(csvText);
      const nextDataset = buildDatasetPayload({
        fileName: file.filename,
        rows: parsedDataset.rows,
        columns: parsedDataset.columns,
        sourceUrl: file.url,
      });

      setDataset(nextDataset);
      setCachedWorkDataset(nextDataset);
    } catch (requestError) {
      setError(requestError.message || 'Uploaded file could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRecentRunSelection(entry) {
    if (!entry?.id) {
      return;
    }

    setError('');
    setIsDatasetInfoOpen(false);
    setIsHistoryExpanded(false);
    setIsUploadsExpanded(false);
    setIsLoading(true);

    try {
      const csvText = await getRecentCsvAnalysisFile(entry.id);
      const parsedDataset = parseCsvText(csvText);
      const nextDataset = buildDatasetPayload({
        fileName: entry.fileName,
        rows: parsedDataset.rows,
        columns: parsedDataset.columns,
        sourceUrl: '',
      });

      setDataset(nextDataset);
      setCachedWorkDataset(nextDataset);
    } catch (requestError) {
      setError(requestError.message || 'Saved CSV data could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="module">
      {error ? <p className="status-text status-text--error">{error}</p> : null}

      {isDatasetInfoOpen ? (
        <div className="dataset-panel-backdrop" onClick={() => setIsDatasetInfoOpen(false)} role="presentation">
          <aside aria-label="Dataset information" className="dataset-panel" onClick={(event) => event.stopPropagation()}>
            <div className="dataset-panel__header">
              <div>
                <span className="ui-eyebrow">Table</span>
                <h3>Dataset panel</h3>
                <p>Switch files and control which columns render in the shared table view.</p>
              </div>
              <button className="compact-toggle compact-toggle--icon" onClick={() => setIsDatasetInfoOpen(false)} type="button">
                <X size={15} />
              </button>
            </div>

            <div className="dataset-panel__section">
              <div className="dataset-panel__section-header">
                <h4>Change File</h4>
                <p>Load a dataset from a new CSV, a recent analysis run, or an uploaded archive file.</p>
              </div>

              <div className="dataset-panel__action-grid">
                <button className="compact-toggle dataset-panel__action" onClick={() => fileInputRef.current?.click()} type="button">
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

            <div className="dataset-panel__section">
              <p>Total rows: {dataset.rows?.length || 0}</p>
              <p>Total columns: {dataset.columns?.length || 0}</p>
            </div>

            <div className="dataset-panel__section">
              <div className="dataset-panel__section-header">
                <h4>Data Columns</h4>
              </div>
              <div className="feature-list feature-list--compact">
                {dataset.columns?.map((column) => (
                  <label className="column-visibility-option dataset-panel__column-option" key={column}>
                    <input
                      checked={visibleColumns.includes(column)}
                      onChange={() =>
                        setVisibleColumns((current) =>
                          current.includes(column) ? current.filter((item) => item !== column) : [...current, column]
                        )
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>{formatColumnLabel(column)}</strong> · {inferColumnType(dataset.rows || [], column)}
                    </span>
                  </label>
                ))}
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
                        onClick={() => void handleRecentRunSelection(entry)}
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
                    description="Analyze a CSV once and recent datasets will appear here."
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
                    description="Uploaded CSV files will appear here when available."
                  />
                )}
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}

      <Card className="analysis-grid__wide">
        <input
          ref={fileInputRef}
          accept=".csv,text/csv"
          className="ticket-toolbar__file-input"
          onChange={(event) => void handleLocalFileSelection(event.target.files?.[0] || null)}
          type="file"
        />
        <CardHeader
          eyebrow="Table"
          title={formatDataFileName(dataset.fileName) || 'CSV table'}
          description="A shared renderer for uploaded CSV datasets and cached work datasets."
          action={
            <div className="table-actions">
              <button className="compact-toggle" onClick={() => setIsDatasetInfoOpen(true)} type="button">
                <TableProperties size={15} />
                Dataset Panel
              </button>
              <button className="compact-toggle" onClick={goBack} type="button">
                <ArrowLeft size={15} />
                {`Back to ${backLabel}`}
              </button>
            </div>
          }
        />

        <div className="ticket-source-banner ticket-source-banner--compact">
          <span>{filteredRows.length} {filteredRows.length === 1 ? 'row' : 'rows'}</span>
          <span>{visibleColumns.length} columns visible</span>
        </div>

        {isLoading ? (
          <p className="status-text">Loading table data...</p>
        ) : dataset.rows?.length ? (
          <DataTable
            fileName={dataset.fileName || 'table'}
            globalSearch={globalSearch}
            onGlobalSearchChange={setGlobalSearch}
            onNextPage={() => setPage((current) => current + 1)}
            onPreviousPage={() => setPage((current) => Math.max(0, current - 1))}
            onRowSelect={handleRowSelect}
            onSort={handleSort}
            page={page}
            rows={paginatedRows}
            selectedRow={selectedRow}
            sortConfig={sortConfig}
            visibleColumns={visibleColumns}
          />
        ) : (
          <EmptyState
            icon={<FileSpreadsheet size={20} />}
            title="No dataset loaded"
            description="Open a CSV from Uploads or load a dataset in Work before opening the table page."
          />
        )}
      </Card>

      {rowDetail ? (
        <div className="row-detail-backdrop" onClick={() => setSelectedRow(null)} role="presentation">
          <aside aria-label="Row details" className="row-detail-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="row-detail-drawer__header">
              <div className="row-detail-drawer__title">
                <span className="ui-eyebrow">Row Detail</span>
                <h3>{rowDetail.primary[0]?.value || 'Selected row'}</h3>
                <p>{rowDetail.primary[1]?.value || dataset.fileName}</p>
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
    </section>
  );
}
