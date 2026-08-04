// The core catalog: every string the host itself renders, and the baseline every other locale
// is checked against at boot (its keys and its plural/string kinds are the contract). Add a key
// here first, then to each sv-SE.ts et al — a locale that drifts stops the boot.
//
// Values are raw text; views escape them. A value carrying markup is rendered with <%- %> and must
// never interpolate untrusted data (see README → Translating).

const messages = {
  "auth.continue": "Continue",
  // Kratos labels its own form fields; these translate the ones the built-in identity schema uses,
  // keyed on the input name. A deployment's extra traits keep Kratos' label until a plugin covers them.
  "auth.field.email": "Email",
  "auth.field.identifier": "Email",
  "auth.field.password": "Password",
  "auth.field.traits.email": "Email",
  "auth.forgotPassword": "Forgot password?",
  "auth.login.altLabel": "Create one",
  "auth.login.altText": "Don't have an account?",
  "auth.login.sub": "Welcome back. Enter your details to continue.",
  "auth.login.title": "Sign in",
  "auth.recovery.altLabel": "Sign in",
  "auth.recovery.altText": "Remembered it?",
  "auth.recovery.back": "Back to sign in",
  "auth.recovery.sub": "Enter your email and we'll send you a recovery code.",
  "auth.recovery.title": "Reset password",
  "auth.registration.altLabel": "Sign in",
  "auth.registration.altText": "Already have an account?",
  "auth.registration.sub": "Get started — it only takes a minute.",
  "auth.registration.title": "Create account",
  "auth.settings.sub": "Update your account details.",
  "auth.settings.title": "Account settings",
  "auth.sso.divider": "or",
  "auth.sso.label": "Single sign-on options",
  "auth.verification.back": "Back to sign in",
  "auth.verification.sub": "Enter the code we sent you.",
  "auth.verification.title": "Verify your email",

  "brand.sub": "Console",

  // Generic UI verbs every screen needs. A plugin reuses these (the lookup falls through to core)
  // and keeps its own catalog for its domain words — see README → Languages.
  "common.add": "Add",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.new": "New",
  "common.remove": "Remove",

  "consent.allow": "Allow",
  "consent.deny": "Deny",
  "consent.notYou": "Not you?",
  "consent.scope.email": "Your email address",
  "consent.scope.offline_access": "Stay signed in (offline access)",
  "consent.scope.openid": "Verify your identity",
  "consent.scope.profile": "Your basic profile (name)",
  "consent.signedInAs": "Signed in as",
  "consent.sub": "{{client}} wants access to your account.",
  "consent.title": "Authorize {{client}}",

  "dashboard.starter.browse": "Browse the example plugin",
  "dashboard.starter.intro":
    "This is the built-in <code>/dashboard</code> — the gated home shown to a signed-in user. It's a placeholder so a fresh clone has something here; it holds no real data.",
  "dashboard.starter.reference":
    "See the plugin contract in <code>README.md</code> (Building plugins → the landing pages) and the <code>examples/plugins/scheduling/</code> reference.",
  "dashboard.starter.replace":
    "Replace it from a plugin: export a <code>dashboard</code> handler from your plugin's manifest and it owns this page, rendered against your own views with the native app shell (the same menu you see now) via <code>ctx.chrome</code>.",
  "dashboard.starter.title": "Starter dashboard",
  "dashboard.title": "Dashboard",

  "error.403.body": "You don't have permission to view that (403).",
  "error.403.docTitle": "Forbidden",
  "error.403.title": "Access denied",
  "error.404.body": "We couldn't find that page (404).",
  "error.404.docTitle": "Not found",
  "error.404.title": "Page not found",
  "error.500.body": "An unexpected error occurred on our end (500).",
  "error.500.docTitle": "Server error",
  "error.500.title": "Something went wrong",
  "error.503.body": "We can't reach the identity service right now (503). Please try again in a moment.",
  "error.503.docTitle": "Sign-in unavailable",
  "error.503.title": "Sign-in is temporarily unavailable",
  "error.backHome": "Back home",
  "error.backToSignIn": "Back to sign in",
  "error.flow.body": "We couldn't complete that sign-in step. It may have expired or been opened twice — please try again.",
  "error.flow.docTitle": "Sign-in error",
  "error.flow.title": "Something went wrong",
  "error.reference": "Reference: {{id}}",
  "error.tryAgain": "Try again",

  "field.optional": "Optional",

  "filter.applied": "Applied",
  "filter.appliedFilters": "Applied filters",
  "filter.apply": "Apply filters",
  "filter.clearAll": "Clear all",
  "filter.dateRange": "Date range",
  "filter.from": "From",
  "filter.label": "Filter",
  "filter.remove": "Remove {{label}} filter",
  "filter.reset": "Reset",
  "filter.search": "Search",
  "filter.to": "To",
  "filter.toSeparator": "to",

  // Kratos writes the auth flow's own text and returns it with a stable numeric id. A key here
  // replaces that text; anything unmapped renders Kratos' English as-is (README → Translating).
  // Ids not in this list are deliberate: 1070002 is Kratos' generic identity-trait label — it is
  // "Email" on the login form and "First name" on a registration form with that trait, so it can
  // only be translated per field (auth.field.* above), never per id.
  "kratos.1010022": "Sign in with password",
  "kratos.1040001": "Create account",
  "kratos.1060003":
    "An email containing a recovery code has been sent to the email address you provided. If you have not received an email, check the spelling of the address and make sure to use the address you registered with.",
  "kratos.1070008": "Resend code",
  "kratos.1070009": "Continue",
  "kratos.1070010": "Recovery code",
  "kratos.1070011": "Verification code",
  "kratos.1080003":
    "An email containing a verification code has been sent to the email address you provided. If you have not received an email, check the spelling of the address and make sure to use the address you registered with.",
  "kratos.4000002": "This field is required.",
  "kratos.4000006": "The credentials are invalid. Check for typos in your email address or password.",
  "kratos.4000007": "An account with that email address already exists.",
  "kratos.4060006": "That recovery code is invalid or has already been used. Please try again.",
  "kratos.4070006": "That verification code is invalid or has already been used. Please try again.",

  "landing.dashboard": "Go to your dashboard",
  "landing.lead":
    "{{brand}} is a self-hostable foundation for admin and operational UIs — sign-in, a config-driven menu, and a server-rendered, zero-JS design system. You add the domain-specific screens by dropping in plugin folders.",
  "landing.register": "Create account",
  "landing.signIn": "Sign in",
  "landing.title": "Operational web apps, without the boilerplate.",

  "locale.label": "Language",
  "locale.leavesPage": "Switching leaves this page",

  "nav.dashboard": "Dashboard",

  "oauth.consentExpired": "This authorization request has expired. Please start again from the application you were signing in to.",
  "oauth.loginExpired": "This sign-in request has expired. Please start again from the application you were signing in to.",
  "oauth.logoutExpired": "This sign-out request has expired. Please start again from the application you were signing out of.",

  "pagination.go": "Go",
  "pagination.label": "Pagination",
  "pagination.next": "Next page",
  "pagination.summary": "{{from}}–{{to}} of <b>{{total}}</b>",
  "pagination.previous": "Previous page",
  "pagination.rows": "Rows",

  "shell.breadcrumb": "Breadcrumb",
  "shell.closeMenu": "Close menu",
  "shell.guest": "Guest",
  "shell.mainNav": "Main navigation",
  "shell.openMenu": "Open menu",
  "shell.profile": "Profile",
  "shell.sidebar": "Primary",
  "shell.signedInAs": "Signed in as {{name}}",
  "shell.signIn": "Sign in",
  "shell.signOut": "Sign out",
  "shell.skipToContent": "Skip to content",
  "shell.toggleSection": "Toggle {{label}}",

  "table.actions": "Actions",
  "table.empty": "Nothing here yet.",
  "table.row": "row",
  "table.rowActions": "Row actions for {{name}}",
  "table.select": "Select {{name}}",
  "table.selectAll": "Select all rows",

  "theme.auto": "Auto",
  "theme.dark": "Dark",
  "theme.label": "Color theme",
  "theme.light": "Light",
};

// The shape every other core locale is written against: `const messages: CoreMessages = { … }` in
// sv-SE.ts et al, so a missing or misspelled key is a type error before the boot check ever runs.
export type CoreMessages = typeof messages;

export default messages;
