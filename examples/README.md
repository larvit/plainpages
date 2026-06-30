# examples/

| Folder | Example of |
| --- | --- |
| [`scheduling-plugin/`](scheduling-plugin/) | The reference plugin you copy into `plugins/`: a list page over an upstream REST service, a CSRF-guarded form that forwards a write, and permission-gated nav — built from the core building blocks, holding no state. See its [README](scheduling-plugin/README.md) and the [plugin contract](../README.md#building-plugins). |
| [`shifts-upstream/`](shifts-upstream/) | A throwaway mock backend the reference plugin reads/writes — stdlib-only, in-memory, no auth. Stands in for your real service so `docker compose up` shows the plugin working out of the box; in production you point `SCHEDULING_UPSTREAM` at the real thing instead. |
