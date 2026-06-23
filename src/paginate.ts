// paginate: pagination math → the model pagination.ejs renders. Pure and
// URL-free (README signature `paginate(total, page, pageSize)`); the caller maps each
// page number to an href. Inputs are clamped/guarded so it never produces a broken model:
// page is pinned to [1, pageCount], total/pageSize coerced to sane integers.

export interface PageItem {
  current: boolean;
  ellipsis: boolean; // a gap; `page` is null
  page: number | null;
}

export interface PageModel {
  from: number; // 1-based index of the first row on this page (0 when empty)
  next: number | null; // next page, or null on the last page
  page: number; // clamped current page (≥ 1)
  pageCount: number; // total pages (≥ 1)
  pageSize: number; // effective page size (≥ 1)
  pages: PageItem[]; // page-number sequence with ellipsis gaps
  prev: number | null; // previous page, or null on the first page
  to: number; // 1-based index of the last row on this page (0 when empty)
  total: number; // effective total rows (≥ 0)
}

export interface PaginateOptions {
  boundaries?: number; // pages always shown at each end (default 1)
  siblings?: number; // pages shown each side of the current page (default 1)
}

export function paginate(total: number, page: number, pageSize: number, options: PaginateOptions = {}): PageModel {
  const t = Math.max(0, Math.floor(total) || 0);
  const size = Math.max(1, Math.floor(pageSize) || 0);
  const pageCount = Math.max(1, Math.ceil(t / size));
  const reqPage = Number.isFinite(page) ? Math.floor(page) : 1;
  const current = Math.min(Math.max(reqPage, 1), pageCount);
  return {
    from: t === 0 ? 0 : (current - 1) * size + 1,
    next: current < pageCount ? current + 1 : null,
    page: current,
    pageCount,
    pageSize: size,
    pages: pageItems(current, pageCount, options.siblings ?? 1, options.boundaries ?? 1),
    prev: current > 1 ? current - 1 : null,
    to: Math.min(current * size, t),
    total: t,
  };
}

const item = (page: number, current = false): PageItem => ({ current, ellipsis: false, page });
const gap = (): PageItem => ({ current: false, ellipsis: true, page: null });

// First/last `boundaries` pages + a `siblings`-wide window around current, deduped and sorted;
// gaps wider than one page become an ellipsis, a lone missing page is shown instead.
function pageItems(current: number, pageCount: number, siblings: number, boundaries: number): PageItem[] {
  const show = new Set<number>();
  const add = (n: number): void => { if (n >= 1 && n <= pageCount) show.add(n); };
  for (let i = 1; i <= boundaries; i++) { add(i); add(pageCount - i + 1); }
  for (let n = current - siblings; n <= current + siblings; n++) add(n);

  const items: PageItem[] = [];
  let prev = 0;
  for (const n of [...show].sort((a, b) => a - b)) {
    if (prev) {
      if (n - prev === 2) items.push(item(prev + 1)); // single hole → show the page
      else if (n - prev > 2) items.push(gap());
    }
    items.push(item(n, n === current));
    prev = n;
  }
  return items;
}
