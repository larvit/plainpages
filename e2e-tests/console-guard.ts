import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";

// The `test` every spec imports: it fails a test whose browser logged a console error or warning,
// or threw, at any step — in whichever engine ran it. A zero-JS app has nothing to say in the
// console, so anything there is a defect (a broken sub-resource, a rejected attribute, an engine
// refusing a feature) that no assertion looks for.
//
// One module-level buffer is enough: a Playwright worker runs one test at a time, so the reset at
// setup and the assertion at teardown bracket exactly the test in between.
const problems: string[] = [];
const allowed: RegExp[] = [];

// The one message the stack itself provokes: the runner reaches `web`/`proxy` by container name over
// plain http, and only a `localhost` origin is trustworthy without TLS — so Chromium drops the COOP
// header the app sends and says so on every page. Over https, where a deployment serves, it applies.
const EXPECTED = [/^console\.error: The Cross-Origin-Opener-Policy header has been ignored/];

// Allow a message for the current test only, when the page under test provokes it on purpose.
export function allowConsole(...patterns: RegExp[]): void {
  allowed.push(...patterns);
}

function watch(page: Page): void {
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") problems.push(`console.${type}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
}

// Every page of the context, however it is opened — `context.newPage()` fires this event too, so
// watching the context is the whole job and a page must never be watched a second time on top.
function watchContext(context: BrowserContext): BrowserContext {
  context.on("page", watch);
  return context;
}

// A spec that opens its own context — a page shared across a serial describe — goes through this.
export function watchedPage(context: BrowserContext): Promise<Page> {
  return watchContext(context).newPage();
}

export const test = base.extend<{ consoleGuard: void }>({
  context: async ({ context }, use) => { await use(watchContext(context)); },
  consoleGuard: [async ({}, use) => {
    problems.length = 0;
    allowed.length = 0;
    await use();
    const unexpected = problems.filter((p) => ![...EXPECTED, ...allowed].some((re) => re.test(p)));
    expect(unexpected, "the browser logged nothing while this test ran").toEqual([]);
  }, { auto: true }],
});

export { expect };
