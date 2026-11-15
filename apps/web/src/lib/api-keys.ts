export type ApiKeyEndpoint = {
  method: string;
  path: string;
  summary: string;
};

export type ApiKeyScope = {
  id: string;
  name: string;
  description: string;
  endpoints: ApiKeyEndpoint[];
};

export type ApiKeyIdentityPolicy = {
  id: string;
  name: string;
  enabled: boolean;
  scopes: string[];
};

export type ApiKeyIdentity = {
  id: string;
  name: string;
  scopes: string[];
};

export type ApiKeyPolicy = {
  enabled: boolean;
  allowed_scopes: string[];
  max_lifetime_days: number;
  identities: ApiKeyIdentityPolicy[];
};

export type ApiKeyItem = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  identity_id: string | null;
  identity_name: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type AccountApiKeysResponse = {
  items: ApiKeyItem[];
  total: number;
  page: number;
  policy: ApiKeyPolicy;
  scopes: ApiKeyScope[];
  identities: ApiKeyIdentity[];
  limit: number;
};

export type ApiKeyInput = {
  name: string;
  expires_at: string;
} & (
  | { identity_id: string; scopes?: never }
  | { scopes: string[]; identity_id?: never }
);

export type ApiKeyCreatedResponse = { item: ApiKeyItem; key: string };
export type ApiKeyUpdatedResponse = { item: ApiKeyItem };
export type ApiKeyPolicyResponse = {
  policy: ApiKeyPolicy;
  scopes: ApiKeyScope[];
};
export type ApiKeyCatalogResponse = {
  enabled: boolean;
  scopes: ApiKeyScope[];
  identities: ApiKeyIdentity[];
};

export const API_KEY_PAGE_SIZE = 24;

export function apiKeyScopeMatches(scope: ApiKeyScope, search: string) {
  const query = search.trim().toLocaleLowerCase();
  return (
    !query ||
    [scope.id, scope.name, scope.description].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ) ||
    scope.endpoints.some((endpoint) => apiKeyEndpointMatches(endpoint, query))
  );
}

export function apiKeyEndpointMatches(
  endpoint: ApiKeyEndpoint,
  search: string,
) {
  const query = search.trim().toLocaleLowerCase();
  return [endpoint.method, endpoint.path, endpoint.summary].some((value) =>
    value.toLocaleLowerCase().includes(query),
  );
}

const apiKeyDate = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
  hour12: false,
});

export function formatApiKeyTime(value: string | null) {
  return value ? apiKeyDate.format(new Date(value)) : "从未使用";
}

export function apiKeyLocalDate(value: string | number) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
