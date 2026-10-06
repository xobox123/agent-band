import { useMemo, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Presence makes the column sortable. */
  sortValue?: (row: T) => string | number;
  width?: number;
}

interface Props<T> {
  label: string;
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  selectedId?: string | null;
  onSelect?: (row: T) => void;
  /** Enter on a focused row. Falls back to onSelect. */
  onOpen?: (row: T) => void;
  defaultSort?: { columnId: string; direction: 'asc' | 'desc' };
}

export function Table<T>({
  label,
  columns,
  rows,
  getRowId,
  selectedId,
  onSelect,
  onOpen,
  defaultSort,
}: Props<T>) {
  const [sort, setSort] = useState(defaultSort ?? null);

  const sorted = useMemo(() => {
    const column = sort ? columns.find((c) => c.id === sort.columnId) : undefined;
    if (!sort || !column?.sortValue) return rows;
    const get = column.sortValue;
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return cmp !== 0 ? cmp * dir : getRowId(a).localeCompare(getRowId(b));
    });
  }, [rows, columns, sort, getRowId]);

  const toggle = (id: string) => {
    setSort((current) =>
      current?.columnId === id
        ? { columnId: id, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { columnId: id, direction: 'asc' },
    );
  };

  const onKeyDown = (event: KeyboardEvent, row: T) => {
    if (event.key === 'Enter') (onOpen ?? onSelect)?.(row);
  };

  return (
    <div className="table-wrap">
      <table className="table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.columnId === c.id;
              const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
              return (
                <th
                  key={c.id}
                  scope="col"
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={c.sortValue ? ariaSort : undefined}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      className="th-sort"
                      onClick={() => {
                        toggle(c.id);
                      }}
                    >
                      {c.header}
                      <span aria-hidden="true">{active ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const id = getRowId(row);
            return (
              <tr
                key={id}
                tabIndex={0}
                aria-selected={selectedId === id}
                className={selectedId === id ? 'is-selected' : undefined}
                onClick={() => {
                  onSelect?.(row);
                }}
                onKeyDown={(e) => {
                  onKeyDown(e, row);
                }}
              >
                {columns.map((c) => (
                  <td key={c.id}>{c.cell(row)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
