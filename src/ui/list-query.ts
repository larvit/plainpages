// parseListQuery: read a list-page URL into the state the building blocks render
// from — search, filters, sort, pagination. The URL is the only list state (README
// "Interactivity"), so this is the inverse of the filter-bar GET form, the sort links and the
// pagination links: bookmarkable, shareable, reproducible. Pure; never throws.

export interface ListSort {
  dir: "asc" | "desc";
  field: string;
}

export interface ListQuery {
  filters: Record<string, string[]>; // every non-reserved param; multi-value kept, empties dropped
  page: number; // ≥ 1
  pageSize: number; // clamped to [1, maxPageSize]
  q: string; // trimmed search text, "" when absent
  sort: ListSort | null; // "field" ⇒ asc, "-field" ⇒ desc
}

export interface ListQueryOptions {
  defaultPageSize?: number; // used when pageSize is absent/invalid (default 25)
  maxPageSize?: number; // upper clamp (default 100)
  pageParam?: string; // default "page"
  pageSizeParam?: string; // default "pageSize"
  qParam?: string; // default "q"
  sortParam?: string; // default "sort"
}

export function parseListQuery(url: URL | URLSearchParams | string, options: ListQueryOptions = {}): ListQuery {
  const params = toParams(url);
  const qParam = options.qParam ?? "q";
  const sortParam = options.sortParam ?? "sort";
  const pageParam = options.pageParam ?? "page";
  const pageSizeParam = options.pageSizeParam ?? "pageSize";
  const reserved = new Set([pageParam, pageSizeParam, qParam, sortParam]);

  const filters: Record<string, string[]> = {};
  for (const key of new Set(params.keys())) {
    if (reserved.has(key)) continue;
    const values = params.getAll(key).filter((v) => v !== "");
    if (values.length) filters[key] = values;
  }

  return {
    filters,
    page: positiveInt(params.get(pageParam)) ?? 1,
    pageSize: Math.min(positiveInt(params.get(pageSizeParam)) ?? (options.defaultPageSize ?? 25), options.maxPageSize ?? 100),
    q: (params.get(qParam) ?? "").trim(),
    sort: parseSort(params.get(sortParam)),
  };
}

function toParams(url: URL | URLSearchParams | string): URLSearchParams {
  if (typeof url === "string") {
    const i = url.indexOf("?");
    return new URLSearchParams(i >= 0 ? url.slice(i + 1) : url);
  }
  return url instanceof URL ? url.searchParams : url;
}

// A strictly positive integer, else null so the caller falls back to a default.
function positiveInt(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function parseSort(raw: string | null): ListSort | null {
  if (raw == null) return null;
  const desc = raw.startsWith("-");
  const field = (desc ? raw.slice(1) : raw).trim();
  return field ? { dir: desc ? "desc" : "asc", field } : null;
}
