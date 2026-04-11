import { memo } from 'react';
import { TableProperties } from 'lucide-react';
import { EmptyState } from '../../../app/ui/EmptyState';
import { TABLE_PAGE_SIZE, formatColumnLabel, getCellText } from '../tableUtils';

export const DataTable = memo(function DataTable({
  rows,
  visibleColumns,
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
        description="Select at least one column to render the table."
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
                {visibleColumns.map((column) => (
                  <td key={`${rowIndex}-${column}`}>{getCellText(row, column) || '—'}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td className="data-table__empty" colSpan={visibleColumns.length}>
                No rows match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="data-table__pagination">
        <span>Page {page + 1}</span>
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
