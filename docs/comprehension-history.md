# Comprehension history

## 2026-10-31T00:16:02Z, PR #181 at 56ff987, against eed1050

Ruling: better

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Mid A | same | better | same | better | better |
| Inherited architect | same | better | same | better | better |

Mid A, decided by:

- Self-sufficiency, Locality: `public/css/styles.css:24` `:root`: the comment above the hex palette says why a colour must not be oklch(), where a colour is edited
- Locality: `src/ui/stylesheet-floor.test.ts:11` `declares no oklch() colour`: a colour edit that breaks the browser floor fails a test instead of an old engine

Inherited architect, decided by:

- Self-sufficiency, Locality: `public/css/styles.css:24` `:root`: the comment above the hex palette says why a colour must not be oklch(), where a colour is edited
- Locality: `src/ui/stylesheet-floor.test.ts:11` `declares no oklch() colour`: a red gate explains the symptom in the file it lands on
- Self-sufficiency: `README.md:1027` "Two browser floors": the colour rule now sits beside the floor rule
