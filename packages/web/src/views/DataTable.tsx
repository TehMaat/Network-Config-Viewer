import { Box, CloseButton, Group, Table, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconFilter } from '@tabler/icons-react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type FilterFn,
  type Row,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface DataTableProps<T> {
  /** Name used for the test ids ("table-<name>", "row-<name>"). */
  name: string;
  data: T[];
  columns: ColumnDef<T, unknown>[];
  getRowId(row: T): string;
  selectedId?: string | null;
  onRowClick?(row: T): void;
  /** Extra attributes of a row, for example to dim it or mark it as matching a search. */
  rowState?(row: T): 'dim' | 'match' | null;
  /** Height of the scrolling area; the rows are virtualized, so only the visible ones exist. */
  height?: number | string;
  filter?: boolean;
  toolbar?: ReactNode;
  empty?: ReactNode;
}

const ROW_HEIGHT = 32;

/** The text of every cell, for the filter: the values that the columns show. */
const textFilter: FilterFn<unknown> = (row, columnId, value: string) => {
  const cell = row.getValue(columnId);
  if (cell === undefined || cell === null) return false;
  const text = Array.isArray(cell) ? cell.join(' ') : String(cell);
  return text.toLowerCase().includes(value.toLowerCase());
};

/** Sortable, filterable table with virtualized rows, used by every view. */
export function DataTable<T>({
  name,
  data,
  columns,
  getRowId,
  selectedId,
  onRowClick,
  rowState,
  height = 420,
  filter = true,
  toolbar,
  empty,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [query, setQuery] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  // The project does not use the React Compiler: TanStack keeps its own memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<T>({
    data,
    columns,
    state: { sorting, globalFilter: query },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQuery,
    globalFilterFn: textFilter as FilterFn<T>,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const paddingTop = items.length > 0 ? items[0]!.start : 0;
  const paddingBottom = items.length > 0 ? virtualizer.getTotalSize() - items.at(-1)!.end : 0;
  const columnCount = table.getVisibleLeafColumns().length;

  const renderRow = (row: Row<T>, index: number) => {
    const state = rowState?.(row.original) ?? null;
    return (
      <Table.Tr
        key={row.id}
        data-index={index}
        ref={virtualizer.measureElement}
        data-testid={`row-${name}`}
        data-id={row.id}
        data-state={state ?? undefined}
        data-selected={row.id === selectedId || undefined}
        className="ncv-row"
        onClick={onRowClick ? () => onRowClick(row.original) : undefined}
        style={onRowClick ? { cursor: 'pointer' } : undefined}
      >
        {row.getVisibleCells().map((cell) => (
          <Table.Td key={cell.id}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </Table.Td>
        ))}
      </Table.Tr>
    );
  };

  const header = useMemo(
    () =>
      table.getHeaderGroups().map((group) => (
        <Table.Tr key={group.id}>
          {group.headers.map((h) => {
            const sorted = h.column.getIsSorted();
            const label = h.isPlaceholder
              ? null
              : flexRender(h.column.columnDef.header, h.getContext());
            return (
              <Table.Th key={h.id} style={{ whiteSpace: 'nowrap' }}>
                {h.column.getCanSort() ? (
                  <UnstyledButton onClick={h.column.getToggleSortingHandler()} className="ncv-sort">
                    <Group gap={4} wrap="nowrap">
                      <span>{label}</span>
                      {sorted === 'asc' && <IconArrowUp size={14} />}
                      {sorted === 'desc' && <IconArrowDown size={14} />}
                    </Group>
                  </UnstyledButton>
                ) : (
                  label
                )}
              </Table.Th>
            );
          })}
        </Table.Tr>
      )),
    // The header changes only with the columns and the sorting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, sorting, columns, t],
  );

  return (
    <Box data-testid={`table-${name}`} data-rows={rows.length} className="ncv-table">
      {(filter || toolbar) && (
        <Group gap="xs" mb="xs" wrap="wrap">
          {filter && (
            <TextInput
              size="xs"
              w={240}
              leftSection={<IconFilter size={14} />}
              placeholder={t('table.filter')}
              aria-label={t('table.filter')}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              rightSection={
                query ? (
                  <CloseButton
                    size="xs"
                    aria-label={t('viewer.clearFilter')}
                    onClick={() => setQuery('')}
                  />
                ) : null
              }
              data-testid={`filter-${name}`}
            />
          )}
          {toolbar}
          <Text size="xs" c="dimmed">
            {query
              ? t('table.countFiltered', { count: rows.length, total: data.length })
              : t('table.count', { count: data.length })}
          </Text>
        </Group>
      )}
      <Box ref={scroller} className="ncv-table-scroll" style={{ maxHeight: height }}>
        <Table
          striped={false}
          highlightOnHover
          stickyHeader
          withTableBorder
          fz="sm"
          verticalSpacing={4}
        >
          <Table.Thead>{header}</Table.Thead>
          <Table.Tbody>
            {paddingTop > 0 && (
              <tr>
                <td colSpan={columnCount} style={{ height: paddingTop, padding: 0, border: 0 }} />
              </tr>
            )}
            {items.map((item) => renderRow(rows[item.index]!, item.index))}
            {paddingBottom > 0 && (
              <tr>
                <td
                  colSpan={columnCount}
                  style={{ height: paddingBottom, padding: 0, border: 0 }}
                />
              </tr>
            )}
            {rows.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={columnCount}>
                  <Text size="sm" c="dimmed" py="xs">
                    {query ? t('table.noMatch') : (empty ?? t('table.empty'))}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Box>
    </Box>
  );
}
