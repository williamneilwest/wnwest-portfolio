import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileSpreadsheet, X } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { getRecentCsvAnalyses, getRecentCsvAnalysisFile, getUploadFile, getUploads } from '../../app/services/api';
import { useBackNavigation } from '../../app/hooks/useBackNavigation';
import { formatDataFileName } from '../../app/utils/fileDisplay';
import { storage } from '../../app/utils/storage';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { DataTable } from '../../components/dataset/DataTable';
import { DataCardList } from '../../components/dataset/DataCardList';
import { filterRowsByGlobalSearch } from '../../components/dataset/utils';
import { DatasetPage } from '../../pages/dataset/DatasetPage';
import {
  TABLE_PAGE_SIZE,
  compareValues,
  getCellText,
  getStoredVisibleColumns,
  inferColumnType,
  setStoredVisibleColumns,
} from './tableUtils';
import { getCachedWorkDataset, parseCsvText, setCachedWorkDataset } from '../work/workDatasetCache';
import { dedupeNotes, getTicketColumns, getTicketId, isSuppressedTicketColumn } from '../work/utils/aiAnalysis';

const DATASET_COLUMN_PREFERENCE_KEY = 'westos.work.datasetColumns';
const DATASET_VIEW_STORAGE_KEY = 'westos.dataset.view';

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

function buildDatasetPayload({ fileName, rows, columns, sourceUrl, lastUpdated }) {
  return {
    fileName,
    rows,
    columns,
    sourceUrl,
    lastUpdated: lastUpdated || null,
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
  const sourceModifiedAt = searchParams.get('modifiedAt') || '';
  const initialDataset = getCachedWorkDataset();
  const shouldUseCachedDataset = !sourceUrl;
  const [dataset, setDataset] = useState(() =>
    shouldUseCachedDataset && initialDataset ? initialDataset : { fileName: sourceFileName, columns: [], rows: [], lastUpdated: null }
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
  const [datasetView, setDatasetView] = useState(() => {
    const stored = String(storage.get(DATASET_VIEW_STORAGE_KEY) || '').toLowerCase();
    if (stored === 'cards' || stored === 'table' || stored === 'metrics') {
      return stored;
    }
    return 'table';
  });
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

        setDataset(getCachedWorkDataset() || { fileName: '', columns: [], rows: [], lastUpdated: null });
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
          lastUpdated: sourceModifiedAt || cachedDataset?.lastUpdated || new Date().toISOString(),
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

        setDataset({ fileName: sourceFileName, columns: [], rows: [], lastUpdated: null });
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
  }, [shouldUseCachedDataset, sourceFileName, sourceModifiedAt, sourceUrl]);

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

  useEffect(() => {
    storage.set(DATASET_VIEW_STORAGE_KEY, datasetView);
  }, [datasetView]);

  const columnTypeMap = useMemo(
    () => Object.fromEntries(visibleColumns.map((column) => [column, inferColumnType(dataset.rows || [], column)])),
    [dataset.rows, visibleColumns]
  );

  const filteredRows = useMemo(() => {
    const rows = dataset.rows || [];
    if (!rows.length) {
      return [];
    }

    const matchingRows = filterRowsByGlobalSearch(rows, visibleColumns, globalSearch);

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

  const datasetState = useMemo(
    () => ({
      rawData: dataset.rows || [],
      columns: dataset.columns || [],
      visibleColumns,
      metadata: {
        rowCount: (dataset.rows || []).length,
        columnCount: (dataset.columns || []).length,
        inferredTypes: Object.fromEntries((dataset.columns || []).map((column) => [column, inferColumnType(dataset.rows || [], column)])),
        categoryField: '',
        fileName: formatDataFileName(dataset.fileName) || 'Unknown',
        lastUpdated: dataset.lastUpdated || null,
      },
      view: datasetView,
    }),
    [dataset.columns, dataset.fileName, dataset.lastUpdated, dataset.rows, datasetView, visibleColumns]
  );

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
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
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
    setIsHistoryExpanded(false);
    setIsUploadsExpanded(false);

    try {
      const parsedDataset = parseCsvText(await file.text());
      const nextDataset = buildDatasetPayload({
        fileName: file.name,
        rows: parsedDataset.rows,
        columns: parsedDataset.columns,
        sourceUrl: '',
        lastUpdated: new Date().toISOString(),
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
        lastUpdated: file.modifiedAt || new Date().toISOString(),
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
        lastUpdated: entry.savedAt || new Date().toISOString(),
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
    <section className="module module--dataset-surface table-page-neutral">
      {error ? <p className="status-text status-text--error">{error}</p> : null}
      <input
        ref={fileInputRef}
        accept=".csv,text/csv"
        className="ticket-toolbar__file-input"
        onChange={(event) => void handleLocalFileSelection(event.target.files?.[0] || null)}
        type="file"
      />

      <DatasetPage
        datasetState={datasetState}
        onVisibleColumnsChange={setVisibleColumns}
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
        onRecentRunSelect={(entry) => void handleRecentRunSelection(entry)}
        uploadedFiles={uploadedFiles.filter((file) => file.filename.toLowerCase().endsWith('.csv'))}
        isLoadingUploads={isLoadingUploads}
        onUploadSelect={(file) => void handleUploadedFileSelection(file)}
        changeDatasetCollapsible={false}
        leftControls={(
          <input
            aria-label="Search dataset rows"
            className="data-table__search"
            onChange={(event) => setGlobalSearch(event.target.value)}
            placeholder="Search..."
            type="text"
            value={globalSearch}
          />
        )}
        rightControls={(
          <>
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
            <button className="compact-toggle" onClick={goBack} type="button">
              <ArrowLeft size={15} />
              {`Back to ${backLabel}`}
            </button>
          </>
        )}
      >
        <Card className="analysis-grid__wide">
          <CardHeader
            eyebrow="Dataset"
            title={formatDataFileName(dataset.fileName) || 'Dataset table'}
            description="Universal renderer for uploaded and cached datasets."
          />

          <div className="ticket-source-banner ticket-source-banner--compact">
            <span>{visibleColumns.length} columns visible</span>
          </div>

          {isLoading ? (
            <p className="status-text">Loading table data...</p>
          ) : dataset.rows?.length ? (
            datasetView === 'cards' ? (
              <DataCardList
                rows={paginatedRows}
                visibleColumns={visibleColumns}
                onRowSelect={handleRowSelect}
                rowKey={(row, index) => row?.id || row?.sys_id || getTicketId(row, dataset.columns || []) || `row-${index}`}
                config={{
                  primaryField: getPrimaryColumns(dataset.columns || [])[0] || '',
                  secondaryField: getDescriptionColumn(dataset.columns || []),
                  badgeField: getPrimaryColumns(dataset.columns || [])[2] || '',
                }}
              />
            ) : datasetView === 'table' ? (
              <DataTable
                onRowSelect={handleRowSelect}
                onSort={handleSort}
                rows={paginatedRows}
                selectedRow={selectedRow}
                sortConfig={sortConfig}
                visibleColumns={visibleColumns}
              />
            ) : (
              <div className="dataset-metrics-grid">
                <div className="metric-tile"><span>Rows in view</span><strong>{filteredRows.length}</strong></div>
                <div className="metric-tile"><span>Total rows</span><strong>{(dataset.rows || []).length}</strong></div>
                <div className="metric-tile"><span>Visible columns</span><strong>{visibleColumns.length}</strong></div>
                <div className="metric-tile"><span>Current page</span><strong>{page + 1}</strong></div>
              </div>
            )
          ) : (
            <EmptyState
              icon={<FileSpreadsheet size={20} />}
              title="No dataset loaded"
              description="Open a CSV from Uploads or load a dataset in Work before opening this view."
            />
          )}

          {datasetView !== 'metrics' ? (
            <div className="data-table__pagination">
              <span>Page {page + 1}</span>
              <div className="data-table__pagination-actions">
                <button className="compact-toggle" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} type="button">
                  Previous
                </button>
                <button className="compact-toggle" disabled={(page + 1) * TABLE_PAGE_SIZE >= filteredRows.length} onClick={() => setPage((current) => current + 1)} type="button">
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </Card>
      </DatasetPage>

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
