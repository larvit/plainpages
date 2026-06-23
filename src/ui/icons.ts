import { readFileSync } from "node:fs";
import { join } from "node:path";

// Sprite id → lucide-static icon, the icons the UI actually references (alphabetical by id).
// Inlined as <symbol> so pages stay zero-JS: <svg><use href="#i-search"/></svg>.
export const ICON_NAMES: Record<string, string> = {
  "i-alert": "circle-alert",
  "i-arrow-left": "arrow-left",
  "i-bell": "bell",
  "i-box": "box",
  "i-cal": "calendar",
  "i-chart": "chart-no-axes-column",
  "i-check-circle": "circle-check",
  "i-chev": "chevron-right",
  "i-cols": "columns-3",
  "i-copy": "copy",
  "i-download": "download",
  "i-edit": "pencil",
  "i-gear": "settings",
  "i-globe": "globe",
  "i-grid": "layout-grid",
  "i-kebab": "ellipsis-vertical",
  "i-layers": "layers",
  "i-lock": "lock",
  "i-logout": "log-out",
  "i-mail": "mail",
  "i-menu": "menu",
  "i-plus": "plus",
  "i-search": "search",
  "i-shield": "shield",
  "i-sliders": "sliders-horizontal",
  "i-sort": "chevrons-up-down",
  "i-trash": "trash-2",
  "i-up": "chevron-up",
  "i-user": "user",
  "i-users": "users",
  "i-x": "x",
};

// Drop lucide's license comment + <svg> wrapper, keep the drawing children (compacted).
function inner(svg: string): string {
  const open = svg.indexOf(">", svg.indexOf("<svg"));
  return svg.slice(open + 1, svg.lastIndexOf("</svg>")).replace(/\s*\n\s*/g, "").trim();
}

// Hidden <symbol> sprite for the used icons, sourced from the pinned lucide-static.
// Regenerates views/partials/icons.ejs; icons.test.ts asserts the committed file matches.
export function buildIconSprite(iconsDir: string): string {
  const symbols = Object.entries(ICON_NAMES).map(
    ([id, name]) => `  <symbol id="${id}" viewBox="0 0 24 24">${inner(readFileSync(join(iconsDir, `${name}.svg`), "utf8"))}</symbol>`,
  );
  return [
    "<%# Generated from lucide-static by src/ui/icons.ts — regenerate on dep bump (guarded by icons.test.ts). %>",
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">',
    ...symbols,
    "</svg>",
    "",
  ].join("\n");
}
