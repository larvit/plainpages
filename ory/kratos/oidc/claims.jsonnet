// OIDC claims → identity traits mapper (Kratos exposes the provider's claims as
// `claims`). Shared by every social provider (Google, Microsoft, OIDC/SAML bridges):
// they all expose email + given_name/family_name. Email is required by the schema.
local claims = std.extVar('claims');

{
  identity: {
    traits: {
      email: claims.email,
      name: {
        first: if std.objectHas(claims, 'given_name') then claims.given_name else '',
        last: if std.objectHas(claims, 'family_name') then claims.family_name else '',
      },
    },
  },
}
