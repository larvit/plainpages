// The `page_token` of a `Link` header's `rel="next"` entry (Kratos and Hydra paginate with it), or
// null when there is none. The href is relative, so it is resolved against a throwaway base.
export function nextPageToken(link: string | null): string | null {
  const href = link?.match(/<([^>]+)>\s*;\s*rel="next"/)?.[1];
  return href ? new URL(href, "http://link-header.invalid").searchParams.get("page_token") : null;
}
