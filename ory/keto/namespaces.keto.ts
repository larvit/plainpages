// Ory Permission Language (OPL) — the authorization model Keto enforces. Keto parses
// this file (referenced by keto.yml `namespaces.location`); the `@ory/keto-namespace-types`
// import is for the author's editor only and is ignored at load. Subject ids are Kratos
// identity ids (== the JWT `sub`).
import { Context, Namespace, SubjectSet } from "@ory/keto-namespace-types"

// A person. Ory calls this an "identity" (Kratos owns the record); Plainpages says "user"
// throughout. Subjects are written as `user:<kratos-identity-id>`.
class User implements Namespace {}

// A named set of users (and nested groups), resolved transitively. The admin "Groups"
// screen manages membership; checks expand it automatically.
class Group implements Namespace {
  related: {
    members: (User | SubjectSet<Group, "members">)[]
  }
}

// A coarse permission — an operation a route or menu item gates on, and the source of truth
// for the JWT `permissions` claim. At login the app reads `Permission:<name>#granted@user:<id>`
// from Keto and projects the result into the token (README: Login → session JWT). A group can
// hold a permission, so grants go to a user or to a whole group.
class Permission implements Namespace {
  related: {
    granted: (User | SubjectSet<Group, "members">)[]
  }
}

// A fine-grained, relationship-checked resource — README's third "may I?" tier, the rare
// live Keto check (e.g. sharing/delegation). Permits nest: owner ⊇ editor ⊇ viewer.
// Grants accept a user directly or any member of a group.
class Resource implements Namespace {
  related: {
    owners: (User | SubjectSet<Group, "members">)[]
    editors: (User | SubjectSet<Group, "members">)[]
    viewers: (User | SubjectSet<Group, "members">)[]
  }

  permits = {
    view: (ctx: Context): boolean =>
      this.related.viewers.includes(ctx.subject) ||
      this.related.editors.includes(ctx.subject) ||
      this.related.owners.includes(ctx.subject),
    edit: (ctx: Context): boolean =>
      this.related.editors.includes(ctx.subject) ||
      this.related.owners.includes(ctx.subject),
    delete: (ctx: Context): boolean => this.related.owners.includes(ctx.subject),
  }
}
