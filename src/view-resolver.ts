// Per-plugin view resolver (todo §2): render plugins/<id>/views/<view>.ejs and let a plugin view
// reuse the core building-block partials. EJS resolves an include() relative to the current file
// first, then against the `views` roots — so passing [plugin views, core views] makes both the
// plugin's own partials/subfolders and every core partial reachable (the plugin root first, so a
// plugin may deliberately shadow a core partial). The §2 router calls this for a `view` RouteResult.

import { isAbsolute, join, relative } from "node:path";
import * as ejs from "ejs";

const CONTROL_CHARS = /[\x00-\x1f]/;

// Resolve a view name → absolute .ejs path within plugins/<id>/views, or null if it escapes that
// dir (traversal) or carries a control char. Names may be nested ("shifts/edit"); a missing
// extension defaults to .ejs.
export function resolveViewPath(pluginsDir: string, pluginId: string, view: string): string | null {
  if (CONTROL_CHARS.test(view)) return null;
  const viewsDir = join(pluginsDir, pluginId, "views");
  const file = join(viewsDir, view.endsWith(".ejs") ? view : `${view}.ejs`);
  const rel = relative(viewsDir, file);
  return rel.startsWith("..") || isAbsolute(rel) ? null : file;
}

export interface PluginViewOptions {
  cache: boolean;
  coreViewsDir: string; // core views/ root — its partials become include() roots for plugin views
  pluginsDir: string;
}

// Bind the dirs/cache once; the returned fn renders a named view for a given plugin id. Rejects on
// an out-of-bounds view name (developer error — fail loud, like the rest of the host).
export function renderPluginView(options: PluginViewOptions) {
  return async (pluginId: string, view: string, data: Record<string, unknown>): Promise<string> => {
    const file = resolveViewPath(options.pluginsDir, pluginId, view);
    if (file === null) throw new Error(`invalid view name "${view}" for plugin "${pluginId}"`);
    const views = [join(options.pluginsDir, pluginId, "views"), options.coreViewsDir];
    return ejs.renderFile(file, data, { cache: options.cache, views });
  };
}
