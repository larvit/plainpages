// paginate: pagination math → a PageModel. Pure and URL-free (README signature
// `paginate(total, page, pageSize)`); buildPaginationModel maps it to pagination.ejs's model. Inputs
// are clamped/guarded so it never produces a broken model: page is pinned to [1, pageCount],
// total/pageSize coerced to sane integers.

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

export interface PaginationModelOptions {
  label?: string; // the nav's aria-label; the partial defaults it
  // The two query params, named as parseListQuery was given them; pageSizeParam names the rows field.
  pageParam?: string; // default "page"
  pageSizeParam?: string; // default "pageSize"
  pageSizes?: number[]; // the rows-per-page choices; omitted ⇒ no rows-per-page form
}

export interface PaginationModel {
  label?: string;
  next: { href?: string };
  pages: ({ ellipsis: true } | { current: true; label: string } | { href: string; label: string })[];
  prev: { href?: string };
  rows?: { hidden: { name: string; value: string }[]; name: string; options: number[]; value: number };
  summary: { from: number; to: number; total: number };
}

// `hrefFor(n)` is the list's URL on page n, carrying all its other state. The rows-per-page form is a
// GET, which replaces the whole query string, so its hidden inputs are read off that same URL: the
// form then carries exactly the state the links do. `locale` is left to the partial, which adds it.
export function buildPaginationModel(page: PageModel, hrefFor: (page: number) => string, options: PaginationModelOptions = {}): PaginationModel {
  const step = (n: number | null): { href?: string } => (n === null ? {} : { href: hrefFor(n) });
  const model: PaginationModel = {
    next: step(page.next),
    pages: page.pages.map((p) =>
      p.page === null ? { ellipsis: true as const }
        : p.current ? { current: true as const, label: String(p.page) }
          : { href: hrefFor(p.page), label: String(p.page) }),
    prev: step(page.prev),
    summary: { from: page.from, to: page.to, total: page.total },
  };
  if (options.label !== undefined) model.label = options.label;
  if (options.pageSizes) {
    const name = options.pageSizeParam ?? "pageSize";
    const omit = new Set([options.pageParam ?? "page", name, "locale"]);
    const hidden = [...new URL(hrefFor(page.page), "http://x").searchParams]
      .filter(([key]) => !omit.has(key))
      .map(([key, value]) => ({ name: key, value }));
    model.rows = { hidden, name, options: options.pageSizes, value: page.pageSize };
  }
  return model;
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
