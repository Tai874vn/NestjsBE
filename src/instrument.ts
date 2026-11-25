import * as Sentry from '@sentry/nestjs';
import type {
  Breadcrumb,
  ErrorEvent,
  Event,
  NodeOptions,
  RequestEventData,
} from '@sentry/nestjs';

export type SentryTransactionEvent = Parameters<
  NonNullable<NodeOptions['beforeSendTransaction']>
>[0];
export type SentryStreamedSpan = Parameters<
  NonNullable<NodeOptions['beforeSendSpan']>
>[0];
type IgnoreSpanEntry = NonNullable<NodeOptions['ignoreSpans']>[number];

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-csrf-token',
  'set-cookie',
]);

// Paths whose query strings may carry OAuth codes, auth tokens, or signed VNPay params.
const SENSITIVE_QUERY_PATH_PATTERN =
  /(?:^|\/)(?:api\/)?auth(?:\/|$)|\/vnpay(?:\/|-|$)|vnpay-return/i;

// Individual query parameter names that may carry tokens, secrets, or VNPay signatures.
const SENSITIVE_QUERY_PARAM_PATTERN =
  /^(?:vnp_.*|token|access_?token|refresh_?token|id_?token|code|state|ticket|secret|signature|hash|auth)$/i;

// Keys that must never leave the server in extra/context/breadcrumb bags
// (auth secrets, cookies, bodies, CV/resume data, and chat messages).
const SENSITIVE_DATA_KEY_PATTERN =
  /^(?:authorization|cookie|cookies|set-cookie|x-csrf-token|password|passwd|secret|token|access_?token|refresh_?token|id_?token|vnp_.*|resume|resume_?data|resume_?text|cv|cv_?text|chat|chat_?message|chat_?messages|messages|message_?content|body|request_?body|response_?body)$/i;

const HEALTH_CHECK_PATTERN = /(?:^|[\s/])(?:api\/)?health(?:\/|\?|$)/i;
const SOCKET_IO_PATTERN = /(?:^|[\s/])socket\.io(?:\/|\?|$)/i;
const SOCKET_IO_POLLING_PATTERN = /transport=polling/i;

// Sentry system contexts that should not be recursively stripped by key name.
const SYSTEM_CONTEXT_KEYS = new Set([
  'app',
  'cloud_resource',
  'culture',
  'device',
  'os',
  'otel',
  'runtime',
  'trace',
]);

// Patterns passed to Sentry's ignoreSpans (works with both streaming and static tracing).
export const IGNORED_SPAN_PATTERNS: IgnoreSpanEntry[] = [
  /\/(?:api\/)?health(?:\/|\?|$)/i,
  /\/socket\.io(?:\/|\?|$)/i,
  { attributes: { 'url.path': /\/(?:api\/)?health(?:\/|$)/i } },
  { attributes: { 'url.path': /\/socket\.io(?:\/|$)/i } },
  { attributes: { 'http.route': /\/(?:api\/)?health(?:\/|$)/i } },
  { attributes: { 'url.query': /transport=polling/i } },
];

/**
 * Picks the trace sample rate from SENTRY_TRACES_SAMPLE_RATE (0 to 1).
 * Defaults to 1.0 in production and 0 everywhere else.
 */
export function resolveTracesSampleRate(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.SENTRY_TRACES_SAMPLE_RATE?.trim();
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }
  return env.NODE_ENV === 'production' ? 1.0 : 0;
}

/**
 * Removes sensitive query strings (auth routes, VNPay return/IPN, and token params) from a URL.
 */
export function scrubUrl(rawUrl: string): string {
  const hashIndex = rawUrl.indexOf('#');
  const withoutHash = hashIndex >= 0 ? rawUrl.slice(0, hashIndex) : rawUrl;
  const queryIndex = withoutHash.indexOf('?');
  const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;

  if (queryIndex < 0) {
    return base;
  }

  if (SENSITIVE_QUERY_PATH_PATTERN.test(base)) {
    return base;
  }

  const query = withoutHash.slice(queryIndex + 1);
  const params = new URLSearchParams(query);
  let changed = false;

  for (const key of Array.from(params.keys())) {
    if (SENSITIVE_QUERY_PARAM_PATTERN.test(key)) {
      params.delete(key);
      changed = true;
    }
  }

  if (!changed) {
    return withoutHash;
  }

  const cleaned = params.toString();
  return cleaned ? `${base}?${cleaned}` : base;
}

function scrubQueryString(
  queryString: RequestEventData['query_string'],
  url?: string,
): RequestEventData['query_string'] | undefined {
  if (queryString === undefined) {
    return undefined;
  }

  const urlBase = url ? url.split(/[?#]/, 1)[0] : '';
  if (urlBase && SENSITIVE_QUERY_PATH_PATTERN.test(urlBase)) {
    return undefined;
  }

  if (typeof queryString === 'string') {
    const params = new URLSearchParams(
      queryString.startsWith('?') ? queryString.slice(1) : queryString,
    );
    for (const key of Array.from(params.keys())) {
      if (SENSITIVE_QUERY_PARAM_PATTERN.test(key)) {
        params.delete(key);
      }
    }
    const cleaned = params.toString();
    return cleaned || undefined;
  }

  if (Array.isArray(queryString)) {
    const filtered = queryString.filter(
      ([key]) => !SENSITIVE_QUERY_PARAM_PATTERN.test(key),
    );
    return filtered.length > 0 ? filtered : undefined;
  }

  if (queryString && typeof queryString === 'object') {
    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(queryString)) {
      if (!SENSITIVE_QUERY_PARAM_PATTERN.test(key)) {
        cleaned[key] = value;
      }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }

  return undefined;
}

function scrubHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!SENSITIVE_HEADERS.has(key.toLowerCase())) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function scrubRecord(value: unknown, seen = new WeakSet<object>()): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => scrubRecord(item, seen));
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_DATA_KEY_PATTERN.test(key)) {
      continue;
    }
    if (key.toLowerCase() === 'url' && typeof entry === 'string') {
      cleaned[key] = scrubUrl(entry);
      continue;
    }
    if (
      key.toLowerCase() === 'headers' &&
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry)
    ) {
      cleaned[key] = scrubHeaders(entry as Record<string, string>);
      continue;
    }
    cleaned[key] = scrubRecord(entry, seen);
  }
  return cleaned;
}

function scrubSpanAttributes(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  const urlHint =
    typeof attributes['url.full'] === 'string'
      ? attributes['url.full']
      : typeof attributes['url.path'] === 'string'
        ? attributes['url.path']
        : undefined;

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    const lower = key.toLowerCase();
    if (
      lower.startsWith('http.request.header.') ||
      lower.startsWith('http.response.header.')
    ) {
      const headerName = lower.split('.').slice(3).join('.');
      if (SENSITIVE_HEADERS.has(headerName)) {
        continue;
      }
    }
    if (
      lower === 'http.request.body' ||
      lower === 'http.response.body' ||
      lower.startsWith('db.query.parameter.')
    ) {
      continue;
    }
    if (lower === 'url.full' && typeof value === 'string') {
      cleaned[key] = scrubUrl(value);
      continue;
    }
    if (
      (lower === 'url.query' || lower === 'http.query') &&
      typeof value === 'string'
    ) {
      const scrubbed = scrubQueryString(value, urlHint);
      if (typeof scrubbed === 'string') {
        cleaned[key] = scrubbed;
      }
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

function scrubRequest(request: RequestEventData): RequestEventData {
  const cleaned: RequestEventData = { ...request };
  delete cleaned.cookies;
  delete cleaned.data;

  if (cleaned.headers) {
    cleaned.headers = scrubHeaders(cleaned.headers);
  }
  if (cleaned.url) {
    cleaned.url = scrubUrl(cleaned.url);
  }
  if (cleaned.query_string !== undefined) {
    const scrubbedQuery = scrubQueryString(cleaned.query_string, request.url);
    if (scrubbedQuery === undefined) {
      delete cleaned.query_string;
    } else {
      cleaned.query_string = scrubbedQuery;
    }
  }

  return cleaned;
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (!breadcrumb.data) {
    return breadcrumb;
  }
  return {
    ...breadcrumb,
    data: scrubRecord(breadcrumb.data) as Record<string, unknown>,
  };
}

/**
 * Strips cookies, request bodies, auth/CSRF headers, token query strings,
 * CV/resume fields, and chat messages from a Sentry event before sending.
 */
export function scrubSentryEvent<T extends Event>(event: T): T {
  const cleaned: T = { ...event };

  if (cleaned.request) {
    cleaned.request = scrubRequest(cleaned.request);
  }

  // Never send user email, username, or IP address.
  if (cleaned.user) {
    const { id } = cleaned.user;
    if (id !== undefined) {
      cleaned.user = { id };
    } else {
      delete cleaned.user;
    }
  }

  if (cleaned.extra) {
    cleaned.extra = scrubRecord(cleaned.extra) as Event['extra'];
  }

  if (cleaned.contexts) {
    const nextContexts: NonNullable<Event['contexts']> = {};
    for (const [name, ctx] of Object.entries(cleaned.contexts)) {
      if (!ctx) continue;
      if (name === 'trace' && ctx.data && typeof ctx.data === 'object') {
        nextContexts.trace = {
          ...(ctx as NonNullable<NonNullable<Event['contexts']>['trace']>),
          data: scrubSpanAttributes(ctx.data as Record<string, unknown>),
        };
      } else if (SYSTEM_CONTEXT_KEYS.has(name)) {
        nextContexts[name] = ctx;
      } else {
        nextContexts[name] = scrubRecord(ctx) as Record<string, unknown>;
      }
    }
    cleaned.contexts = nextContexts;
  }

  if (cleaned.breadcrumbs) {
    cleaned.breadcrumbs = cleaned.breadcrumbs.map(scrubBreadcrumb);
  }

  if (cleaned.spans) {
    cleaned.spans = cleaned.spans.map((span) => ({
      ...span,
      data: scrubSpanAttributes(
        (span.data ?? {}) as Record<string, unknown>,
      ) as typeof span.data,
    }));
  }

  return cleaned;
}

/**
 * Returns true for noisy health checks and Socket.IO polling transactions that should be dropped.
 */
export function shouldDropTransaction(event: SentryTransactionEvent): boolean {
  const traceData = event.contexts?.trace?.data as
    | Record<string, unknown>
    | undefined;
  const candidates = [
    event.transaction,
    event.request?.url,
    typeof traceData?.['url.path'] === 'string'
      ? traceData['url.path']
      : undefined,
    typeof traceData?.['url.full'] === 'string'
      ? traceData['url.full']
      : undefined,
    typeof traceData?.['http.route'] === 'string'
      ? traceData['http.route']
      : undefined,
    typeof traceData?.['url.query'] === 'string'
      ? traceData['url.query']
      : undefined,
  ].filter((item): item is string => Boolean(item));

  return candidates.some(
    (value) =>
      HEALTH_CHECK_PATTERN.test(value) ||
      SOCKET_IO_PATTERN.test(value) ||
      SOCKET_IO_POLLING_PATTERN.test(value),
  );
}

export function beforeSend(event: ErrorEvent): ErrorEvent {
  return scrubSentryEvent(event);
}

export function beforeSendTransaction(
  event: SentryTransactionEvent,
): SentryTransactionEvent | null {
  if (shouldDropTransaction(event)) {
    return null;
  }
  return scrubSentryEvent(event);
}

export function beforeSendSpan(span: SentryStreamedSpan): SentryStreamedSpan {
  return {
    ...span,
    attributes: scrubSpanAttributes(span.attributes) as typeof span.attributes,
  };
}

/**
 * Starts Sentry only when SENTRY_DSN is set.
 * When SENTRY_DSN is empty, Sentry stays off so local runs and tests send nothing.
 */
export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) {
    return false;
  }

  const environment = env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV;
  const release = env.SENTRY_RELEASE?.trim() || undefined;

  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: resolveTracesSampleRate(env),
    // In @sentry/nestjs v11, dataCollection replaces sendDefaultPii: false
    // and keeps user info, cookies, request bodies, sensitive headers, and DB query parameters off.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      httpHeaders: {
        request: {
          deny: ['authorization', 'cookie', 'x-csrf-token', 'set-cookie'],
        },
        response: {
          deny: ['set-cookie'],
        },
      },
      databaseQueryData: false,
    },
    ignoreSpans: IGNORED_SPAN_PATTERNS,
    beforeSend,
    beforeSendTransaction,
    beforeSendSpan,
  });

  return true;
}

initSentry();
