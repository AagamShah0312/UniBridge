import { useEffect, useMemo, useState } from 'react'

export type SortDir = 'asc' | 'desc'

// Read a value by dot-path so headers can sort on nested fields like "subject.code".
function getVal(row: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), row)
}

export interface UseTableSortOptions {
  initial?: { key: string; dir?: SortDir }
  /**
   * Enable client-side pagination on top of the sort. Pass the page size and give
   * the hook the FULL dataset (fetch every row, e.g. `limit: 10000`) — it sorts
   * across everything, then slices the current page. This is what makes sorting
   * span the whole table instead of just the rows already on screen.
   */
  pageSize?: number
}

/**
 * Sorts rows client-side (click a header for asc, again for desc; numbers sort
 * numerically, text naturally, empty values sink). Numbers/computed columns work
 * because the rows already carry those fields.
 *
 * With `pageSize`, it also paginates: sort spans the ENTIRE dataset first, then the
 * page is sliced from the sorted result — so feed it the full set, not a server page.
 */
export function useTableSort<T>(rows: T[], opts?: UseTableSortOptions) {
  const [sortKey, setSortKey] = useState<string | null>(opts?.initial?.key ?? null)
  const [sortDir, setSortDir] = useState<SortDir>(opts?.initial?.dir ?? 'asc')
  const [page, setPage] = useState(1)

  function onSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(1) // a new sort order starts from the first page
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = getVal(a as Record<string, unknown>, sortKey)
      const bv = getVal(b as Record<string, unknown>, sortKey)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, sortKey, sortDir])

  // New filter/search → new data array (react-query keeps a stable ref otherwise),
  // so jump back to page 1 when the underlying rows actually change.
  useEffect(() => { setPage(1) }, [rows])

  const pageSize = opts?.pageSize
  const total = sorted.length
  const totalPages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1
  const safePage = Math.min(page, totalPages)
  const pageRows = pageSize ? sorted.slice((safePage - 1) * pageSize, safePage * pageSize) : sorted

  return {
    rows: pageRows,
    sortKey,
    sortDir,
    onSort,
    page: safePage,
    setPage,
    total,
    totalPages,
    limit: pageSize ?? total,
    // Spreadable straight onto <Pagination {...sort.pagination} />.
    pagination: { page: safePage, totalPages, total, limit: pageSize ?? total, onPage: setPage },
  }
}
