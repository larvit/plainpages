// Plugin settings admin screen: what each installed plugin declares it can be configured with, the
// variable that sets it, and how each key resolved. Read-only — the host reads settings from the
// environment at boot, so changing one is a deploy, not a form.

import { type PageChrome, type PluginSettings, type RouteHandler, type SettingSummary, type Translate } from "@plainpages/plugin-api";
import { ADMIN_EN, requirePermission } from "./admin-shared.ts";

interface SettingsGroup {
  emptyText: string;
  pluginId: string;
  table: {
    actionsId: string;
    caption: string;
    columns: { label: string }[];
    rows: { cells: (string | { rowHeader: { text: string } })[]; name: string }[];
  };
}

// One group per installed plugin, including those declaring nothing — an operator who cannot find
// their plugin here has not installed it, which is the other half of what this screen answers.
export function buildPluginSettingsModel(opts: { chrome: PageChrome; settings: readonly PluginSettings[]; t?: Translate }) {
  const t = opts.t ?? ADMIN_EN;
  return {
    breadcrumbs: [{ label: t("admin.pluginSettings.title") }],
    chrome: opts.chrome,
    groups: opts.settings.map((plugin): SettingsGroup => ({
      emptyText: t("admin.pluginSettings.none"),
      pluginId: plugin.pluginId,
      table: {
        actionsId: `settings-${plugin.pluginId}`, // two tables share this page, so the stem must differ
        caption: t("admin.pluginSettings.caption", { plugin: plugin.pluginId }),
        columns: [
          { label: t("admin.pluginSettings.column.key") },
          { label: t("admin.pluginSettings.column.description") },
          { label: t("admin.pluginSettings.column.type") },
          { label: t("admin.pluginSettings.column.required") },
          { label: t("admin.pluginSettings.column.variable") },
          { label: t("admin.pluginSettings.column.source") },
          { label: t("admin.pluginSettings.column.value") },
        ],
        rows: plugin.settings.map((setting) => ({
          cells: [
            { rowHeader: { text: setting.key } },
            setting.description ?? "",
            typeLabel(setting),
            t(setting.required ? "admin.pluginSettings.yes" : "admin.pluginSettings.no"),
            setting.envName,
            t(`admin.pluginSettings.source.${setting.source}`),
            valueLabel(setting, t),
          ],
          name: setting.key,
        })),
      },
    })),
    title: t("admin.pluginSettings.title"),
  };
}

// An enum's choices are the useful half of its type — they are what the operator must pick from.
function typeLabel(setting: SettingSummary): string {
  return setting.type === "enum" && setting.values ? `${setting.type} (${setting.values.join(", ")})` : setting.type;
}

// A secret never renders its value — not the value, not a mask of it, not its length. Whether it
// resolved and from where is what an operator needs, and the source column already says the rest.
function valueLabel(setting: SettingSummary, t: Translate): string {
  if (setting.secret) return t(setting.source === "unset" ? "admin.pluginSettings.secretUnset" : "admin.pluginSettings.secretSet");
  return setting.value ?? t("admin.pluginSettings.unset");
}

// GET /admin/plugin-settings
export const pluginSettingsList: RouteHandler = (ctx) => {
  requirePermission(ctx, "plugin-settings");
  return { data: { chrome: ctx.chrome, model: buildPluginSettingsModel({ chrome: ctx.chrome, settings: ctx.declaredSettings, t: ctx.t }) }, view: "plugin-settings" };
};
