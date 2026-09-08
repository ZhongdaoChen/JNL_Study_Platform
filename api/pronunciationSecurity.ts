export type PronunciationEndpoint = 'assessment' | 'examples' | 'synthesis';

export interface PronunciationSecurityRequest {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null };
}

export interface PronunciationSecurityResponse {
  status(code: number): PronunciationSecurityResponse;
  json(body: unknown): void;
  setHeader?(name: string, value: string | number): void;
}

interface SecurityConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  rateLimitSecret: string;
  securityTimeoutMs: number;
  upstreamTimeoutMs: number;
}

interface PronunciationLease {
  id: string;
  owner: string;
  providerTimeoutMs: number;
  config: SecurityConfig;
}

interface AcquireResult {
  allowed: boolean;
  lease_id?: string;
  granted_at?: string;
  expires_at?: string;
  reason?: 'rate_limit' | 'global_rate_limit' | 'concurrency_limit';
  retry_after_seconds?: number;
}

interface ProviderDeadlineInput {
  grantedAt: string;
  expiresAt: string;
  acquireStartedAtMs: number;
  responseReceivedAtMs: number;
  configuredTimeoutMs: number;
}

const LEASE_DEADLINE_SAFETY_MS = 1_000;
const MIN_PROVIDER_DEADLINE_MS = 250;

export interface PronunciationSecurityContext {
  signal: AbortSignal;
  fetchJson(
    input: RequestInfo | URL,
    init: RequestInit,
  ): Promise<{ response: Response; data: unknown }>;
}

export class PronunciationTimeoutError extends Error {}

class SecurityError extends Error {
  readonly statusCode: number;
  readonly retryAfterSeconds?: number;

  constructor(
    statusCode: number,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function withPronunciationSecurity(
  req: PronunciationSecurityRequest,
  res: PronunciationSecurityResponse,
  endpoint: PronunciationEndpoint,
  work: (context: PronunciationSecurityContext) => Promise<void>,
): Promise<void> {
  let lease: PronunciationLease;
  try {
    lease = await acquirePronunciationLease(req, endpoint);
  } catch (error) {
    if (error instanceof PronunciationTimeoutError) {
      res.status(504).json({ error: error.message });
      return;
    }
    if (error instanceof SecurityError) {
      if (error.retryAfterSeconds !== undefined) {
        res.setHeader?.('Retry-After', error.retryAfterSeconds);
      }
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(503).json({ error: '语音服务访问控制暂时不可用' });
    return;
  }

  const deadline = createAbortableDeadline(
    lease.providerTimeoutMs,
    '语音服务上游请求超时，请稍后重试',
  );
  try {
    await work({
      signal: deadline.signal,
      fetchJson: (input, init) => deadline.run(async (signal) => {
        const response = await fetch(input, { ...init, signal });
        const data = response.ok ? await readJson(response) : null;
        return { response, data };
      }),
    });
  } catch (error) {
    if (error instanceof PronunciationTimeoutError) {
      res.status(504).json({ error: error.message });
      return;
    }
    throw error;
  } finally {
    deadline.dispose();
    await releasePronunciationLease(lease);
  }
}

async function acquirePronunciationLease(
  req: PronunciationSecurityRequest,
  endpoint: PronunciationEndpoint,
): Promise<PronunciationLease> {
  const config = readSecurityConfig();
  const accessToken = bearerToken(req);
  const { response: userResponse, data: user } = await fetchJsonWithDeadline(
    `${config.supabaseUrl}/auth/v1/user`,
    {
      method: 'GET',
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    },
    config.securityTimeoutMs,
    '语音服务访问控制超时，请稍后重试',
  );
  if (!userResponse.ok) {
    throw new SecurityError(401, '登录已失效，请重新登录');
  }

  if (!isRecord(user) || typeof user.id !== 'string' || !user.id.trim()) {
    throw new SecurityError(401, '登录已失效，请重新登录');
  }

  const ipHash = await hashClientIp(clientIp(req), config.rateLimitSecret);
  const acquireStartedAtMs = Date.now();
  const { response: acquireResponse, data: acquireData } = await fetchJsonWithDeadline(
    `${config.supabaseUrl}/rest/v1/rpc/acquire_pronunciation_request`,
    {
      method: 'POST',
      headers: {
        apikey: config.supabaseServiceRoleKey,
        Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_owner: user.id,
        p_operation: endpoint,
        p_ip_hash: ipHash,
      }),
    },
    config.securityTimeoutMs,
    '语音服务访问控制超时，请稍后重试',
  );
  if (!acquireResponse.ok) {
    throw new SecurityError(503, '语音服务访问控制暂时不可用');
  }

  const result = normalizeAcquireResult(acquireData);
  if (!result) {
    throw new SecurityError(503, '语音服务访问控制暂时不可用');
  }
  if (!result.allowed) {
    const retryAfter = positiveInteger(result.retry_after_seconds, 1, 300, 1);
    throw new SecurityError(
      429,
      result.reason === 'concurrency_limit'
        ? '已有语音请求正在处理，请稍后再试'
        : '请求过于频繁，请稍后再试',
      retryAfter,
    );
  }
  if (typeof result.lease_id !== 'string' || !result.lease_id.trim()) {
    throw new SecurityError(503, '语音服务访问控制暂时不可用');
  }
  const acquiredLease: PronunciationLease = {
    id: result.lease_id,
    owner: user.id,
    providerTimeoutMs: 0,
    config,
  };
  if (typeof result.granted_at !== 'string' || typeof result.expires_at !== 'string') {
    await releasePronunciationLease(acquiredLease);
    throw new SecurityError(503, '语音服务访问控制暂时不可用');
  }

  const providerTimeoutMs = calculateProviderDeadlineMs({
    grantedAt: result.granted_at,
    expiresAt: result.expires_at,
    acquireStartedAtMs,
    responseReceivedAtMs: Date.now(),
    configuredTimeoutMs: config.upstreamTimeoutMs,
  });
  if (providerTimeoutMs === null) {
    await releasePronunciationLease(acquiredLease);
    throw new SecurityError(503, '语音服务访问控制租约不足，请稍后重试');
  }

  return {
    ...acquiredLease,
    providerTimeoutMs,
  };
}

async function releasePronunciationLease(lease: PronunciationLease): Promise<void> {
  try {
    await fetchWithDeadline(
      `${lease.config.supabaseUrl}/rest/v1/rpc/release_pronunciation_request`,
      {
        method: 'POST',
        headers: {
          apikey: lease.config.supabaseServiceRoleKey,
          Authorization: `Bearer ${lease.config.supabaseServiceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_owner: lease.owner,
          p_lease_id: lease.id,
        }),
      },
      lease.config.securityTimeoutMs,
      '语音服务访问控制超时，请稍后重试',
    );
  } catch {
    // The database lease has a short expiry, so a failed cleanup cannot block forever.
  }
}

function readSecurityConfig(): SecurityConfig {
  const supabaseUrl = firstConfigured(
    process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_URL,
  ).replace(/\/+$/, '');
  const supabaseAnonKey = firstConfigured(
    process.env.SUPABASE_ANON_KEY,
    process.env.VITE_SUPABASE_ANON_KEY,
  );
  const supabaseServiceRoleKey = firstConfigured(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const rateLimitSecret = firstConfigured(
    process.env.PRONUNCIATION_RATE_LIMIT_SECRET,
    process.env.QWEN_API_KEY,
  );
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !rateLimitSecret) {
    throw new SecurityError(503, '云端语音服务未配置身份验证');
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    rateLimitSecret,
    securityTimeoutMs: envInteger(
      'PRONUNCIATION_SECURITY_TIMEOUT_MS',
      5_000,
      1,
      120_000,
    ),
    upstreamTimeoutMs: envInteger(
      'PRONUNCIATION_UPSTREAM_TIMEOUT_MS',
      20_000,
      1,
      120_000,
    ),
  };
}

function firstConfigured(...values: (string | undefined)[]): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function bearerToken(req: PronunciationSecurityRequest): string {
  const authorization = headerValue(req, 'authorization');
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw new SecurityError(401, '请先登录后使用语音服务');
  return match[1];
}

function clientIp(req: PronunciationSecurityRequest): string {
  const forwarded = (
    headerValue(req, 'x-vercel-forwarded-for')
    ?? headerValue(req, 'x-forwarded-for')
    ?? headerValue(req, 'x-real-ip')
    ?? req.socket?.remoteAddress
    ?? 'unknown'
  );
  return forwarded.split(',')[0].trim() || 'unknown';
}

function headerValue(
  req: PronunciationSecurityRequest,
  name: string,
): string | undefined {
  const entry = Object.entries(req.headers ?? {}).find(
    ([headerName]) => headerName.toLowerCase() === name,
  );
  if (!entry) return undefined;
  return Array.isArray(entry[1]) ? entry[1][0] : entry[1];
}

async function hashClientIp(ip: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(ip),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchJsonWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<{ response: Response; data: unknown }> {
  const deadline = createAbortableDeadline(timeoutMs, timeoutMessage);
  try {
    return await deadline.run(async (signal) => {
      const response = await fetch(input, { ...init, signal });
      const data = response.ok ? await readJson(response) : null;
      return { response, data };
    });
  } finally {
    deadline.dispose();
  }
}

async function fetchWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  const deadline = createAbortableDeadline(timeoutMs, timeoutMessage);
  try {
    return await deadline.run((signal) => fetch(input, { ...init, signal }));
  } finally {
    deadline.dispose();
  }
}

function createAbortableDeadline(timeoutMs: number, message: string): {
  signal: AbortSignal;
  run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
  dispose(): void;
} {
  const controller = new AbortController();
  let timeoutError: PronunciationTimeoutError | null = null;
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timeoutError = new PronunciationTimeoutError(message);
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  return {
    signal: controller.signal,
    async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
      try {
        return await Promise.race([operation(controller.signal), timeout]);
      } catch (error) {
        if (timeoutError) throw timeoutError;
        throw error;
      }
    },
    dispose() {
      clearTimeout(timeoutId);
    },
  };
}

function normalizeAcquireResult(value: unknown): AcquireResult | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!isRecord(candidate) || typeof candidate.allowed !== 'boolean') return null;
  return candidate as unknown as AcquireResult;
}

export function calculateProviderDeadlineMs({
  grantedAt,
  expiresAt,
  acquireStartedAtMs,
  responseReceivedAtMs,
  configuredTimeoutMs,
}: ProviderDeadlineInput): number | null {
  const grantedAtMs = Date.parse(grantedAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (
    !Number.isFinite(grantedAtMs)
    || !Number.isFinite(expiresAtMs)
    || !Number.isFinite(acquireStartedAtMs)
    || !Number.isFinite(responseReceivedAtMs)
    || !Number.isFinite(configuredTimeoutMs)
    || expiresAtMs <= grantedAtMs
    || responseReceivedAtMs < acquireStartedAtMs
    || configuredTimeoutMs <= 0
  ) {
    return null;
  }

  const leaseDurationMs = expiresAtMs - grantedAtMs;
  const acquireElapsedMs = responseReceivedAtMs - acquireStartedAtMs;
  const remainingLeaseMs = Math.min(
    expiresAtMs - responseReceivedAtMs,
    leaseDurationMs - acquireElapsedMs,
  );
  const safeRemainingMs = Math.floor(remainingLeaseMs - LEASE_DEADLINE_SAFETY_MS);
  if (safeRemainingMs < MIN_PROVIDER_DEADLINE_MS) return null;
  return Math.min(Math.floor(configuredTimeoutMs), safeRemainingMs);
}

function envInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return positiveInteger(parsed, minimum, maximum, fallback);
}

function positiveInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
