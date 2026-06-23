// Session→JWT claims mapper for the `plainpages` tokenizer. Kratos exposes the
// session as `session`; `sub` is set from the identity id (subject_source: id) and
// can't be overridden here. roles come from metadata_public — the per-login projection
// of Keto roles the app refreshes at login (metadata_admin is NOT carried in the session
// the tokenizer sees; metadata_public is). Absent on a fresh identity ⇒ empty list.
local session = std.extVar('session');
local meta =
  if std.objectHas(session.identity, 'metadata_public') && session.identity.metadata_public != null
  then session.identity.metadata_public
  else {};

{
  claims: {
    email: session.identity.traits.email,
    roles: if std.objectHas(meta, 'roles') then meta.roles else [],
  },
}
