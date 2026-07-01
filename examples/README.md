# examples/

Copy-in reference material. Each subfolder mirrors a **drop-in mount dir** at the repo root — copy it
across (or bind-mount your own) and restart.

| Path | Copy into | Example of |
| --- | --- | --- |
| [`plugins/scheduling/`](plugins/scheduling/) | `plugins/scheduling/` | The reference plugin: a list page over an upstream REST service, a CSRF-guarded form that forwards a write, and permission-gated nav — built from the core building blocks, holding no state. Imports the host surface as `#plugin-api`. See its [README](plugins/scheduling/README.md) and the [plugin contract](../README.md#building-plugins). |
| [`config/menu.ts`](config/menu.ts) | `config/menu.ts` | The central menu override + branding template (rename/group/order/hide nav, set app name/logo/theme). Imports its typed builder as `#menu-config`; `config/` ships empty, so defaults apply until you copy this in. See [The menu system](../README.md#the-menu-system). |
| [`shifts-upstream/`](shifts-upstream/) | — (dev service) | A throwaway mock backend the reference plugin reads/writes — stdlib-only, in-memory, no auth. Stands in for your real service so `docker compose up` shows the plugin working out of the box; in production you point `SCHEDULING_UPSTREAM` at the real thing instead. |
