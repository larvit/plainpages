// Kratos and Hydra both paginate with an RFC 8288 `Link` header. Returns the `page_token` of its
// `rel="next"` entry, or null on the last page. The href is a relative path, so it is resolved
// against a throwaway base just to read the query parameter.
export function nextPageToken(link: string | null): string | null {
  const href = link?.match(/<([^>]+)>\s*;\s*rel="next"/)?.[1];
  return href ? new URL(href, "http://link-header.invalid").searchParams.get("page_token") : null;
}
