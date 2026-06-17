// Session→JWT claims mapper for the `plainpages` tokenizer (§4). Kratos exposes the
// session as `session`; `sub` is set from the identity id (subject_source: id) and
// can't be overridden here. roles come from metadata_admin — the per-login projection
// of Keto roles the app refreshes at login; absent on a fresh identity ⇒ empty list.
local session = std.extVar('session');
local meta =
  if std.objectHas(session.identity, 'metadata_admin') && session.identity.metadata_admin != null
  then session.identity.metadata_admin
  else {};

{
  claims: {
    email: session.identity.traits.email,
    roles: if std.objectHas(meta, 'roles') then meta.roles else [],
  },
}
