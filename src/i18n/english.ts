// The shipped en-US catalog, ready to use without loading anything from disk. This is what the
// host falls back to wherever the loaded catalogs haven't been wired — a context built ad hoc, a
// view model built outside a request, an app created without `i18n` — so an unwired path renders
// real English rather than bare keys. server.ts replaces it with the discovered catalogs at boot.

import { DEFAULT_LOCALE } from "./catalog.ts";
import enUS from "./locales/en-US.ts";
import { createI18n, type I18n } from "./runtime.ts";
import { createTranslator, type Translate } from "./translate.ts";

export const ENGLISH: Translate = createTranslator({ catalogs: [enUS], locale: DEFAULT_LOCALE });

export const ENGLISH_I18N: I18n = createI18n({
  available: [DEFAULT_LOCALE],
  core: new Map([[DEFAULT_LOCALE, enUS]]),
  plugins: new Map(),
});
