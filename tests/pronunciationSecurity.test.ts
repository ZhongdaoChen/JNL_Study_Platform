import test from 'node:test';
import assert from 'node:assert/strict';
import {
  withPronunciationSecurity,
  type PronunciationSecurityRequest,
  type PronunciationSecurityResponse,
} from '../api/pronunciationSecurity.ts';
import * as pronunciationSecurity from '../api/pronunciationSecurity.ts';

interface ResponseResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

function allowedLease(
  leaseId = '11111111-1111-4111-8111-111111111111',
  grantedAtMs = Date.now(),
  leaseMs = 30_000,
): Record<string, unknown> {
  return {
    allowed: true,
    lease_id: leaseId,
    granted_at: new Date(grantedAtMs).toISOString(),
    expires_at: new Date(grantedAtMs + leaseMs).toISOString(),
    retry_after_seconds: 0,
  };
}

function createResponse(): {
  response: PronunciationSecurityResponse;
  result: ResponseResult;
} {
  const result: ResponseResult = { status: 200, body: undefined, headers: {} };
  return {
    result,
    response: {
      status(code) {
        result.status = code;
        return this;
      },
      json(body) {
        result.body = body;
      },
      setHeader(name, value) {
        result.headers[name] = String(value);
      },
    },
  };
}

function request(
  token = 'valid-token',
  ip = '203.0.113.9',
): PronunciationSecurityRequest {
  return {
    headers: {
      authorization: `Bearer ${token}`,
      'x-forwarded-for': `${ip}, 10.0.0.1`,
    },
  };
}

function hangsUntilAborted(
  init: RequestInit | undefined,
  onAbort: () => void,
): Promise<Response> {
  return new Promise((_, reject) => {
    const failsafe = setTimeout(
      () => reject(new Error('test fetch was not aborted')),
      200,
    );
    init?.signal?.addEventListener('abort', () => {
      clearTimeout(failsafe);
      onAbort();
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }, { once: true });
  });
}

async function withSecurityEnvironment(
  fetchImplementation: typeof fetch,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originals = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    PRONUNCIATION_RATE_LIMIT_SECRET: process.env.PRONUNCIATION_RATE_LIMIT_SECRET,
    PRONUNCIATION_SECURITY_TIMEOUT_MS: process.env.PRONUNCIATION_SECURITY_TIMEOUT_MS,
    PRONUNCIATION_UPSTREAM_TIMEOUT_MS: process.env.PRONUNCIATION_UPSTREAM_TIMEOUT_MS,
    QWEN_API_KEY: process.env.QWEN_API_KEY,
  };
  globalThis.fetch = fetchImplementation;
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  process.env.PRONUNCIATION_RATE_LIMIT_SECRET = 'rate-limit-secret';
  process.env.PRONUNCIATION_SECURITY_TIMEOUT_MS = '20';
  process.env.PRONUNCIATION_UPSTREAM_TIMEOUT_MS = '25';

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('hanging Supabase authentication aborts before the lease duration', { timeout: 1_000 }, async () => {
  let aborted = false;
  await withSecurityEnvironment((async (input, init) => {
    assert.equal(String(input), 'https://project.supabase.co/auth/v1/user');
    return hangsUntilAborted(init, () => {
      aborted = true;
    });
  }) as typeof fetch, async () => {
    const { response, result } = createResponse();
    let protectedWorkCalled = false;
    const startedAt = Date.now();

    await withPronunciationSecurity(
      request(),
      response,
      'assessment',
      async () => {
        protectedWorkCalled = true;
      },
    );

    assert.equal(result.status, 504);
    assert.deepEqual(result.body, { error: '语音服务访问控制超时，请稍后重试' });
    assert.equal(aborted, true);
    assert.equal(protectedWorkCalled, false);
    assert.ok(Date.now() - startedAt < 1_000);
  });
});

test('hanging Supabase acquire RPC aborts before protected work starts', { timeout: 1_000 }, async () => {
  let aborted = false;
  await withSecurityEnvironment((async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/acquire_pronunciation_request')) {
      return hangsUntilAborted(init, () => {
        aborted = true;
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch, async () => {
    const { response, result } = createResponse();
    let protectedWorkCalled = false;

    await withPronunciationSecurity(
      request(),
      response,
      'examples',
      async () => {
        protectedWorkCalled = true;
      },
    );

    assert.equal(result.status, 504);
    assert.deepEqual(result.body, { error: '语音服务访问控制超时，请稍后重试' });
    assert.equal(aborted, true);
    assert.equal(protectedWorkCalled, false);
  });
});

test('hanging Supabase release RPC is aborted instead of extending the lease', { timeout: 1_000 }, async () => {
  let releaseAborted = false;
  let releaseInit: RequestInit | undefined;
  await withSecurityEnvironment((async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/acquire_pronunciation_request')) {
      return new Response(JSON.stringify(allowedLease()), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/release_pronunciation_request')) {
      releaseInit = init;
      return hangsUntilAborted(init, () => {
        releaseAborted = true;
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch, async () => {
    const { response, result } = createResponse();
    const startedAt = Date.now();

    await withPronunciationSecurity(
      request(),
      response,
      'assessment',
      async () => {},
    );

    assert.equal(result.status, 200);
    assert.equal(releaseAborted, true);
    const headers = releaseInit?.headers as Record<string, string>;
    assert.equal(headers.apikey, 'service-role-key');
    assert.equal(headers.Authorization, 'Bearer service-role-key');
    assert.deepEqual(JSON.parse(String(releaseInit?.body)), {
      p_owner: 'user-1',
      p_lease_id: '11111111-1111-4111-8111-111111111111',
    });
    assert.ok(Date.now() - startedAt < 1_000);
  });
});

test('missing bearer authentication is rejected before any network call', async () => {
  let fetchCalled = false;
  await withSecurityEnvironment((async () => {
    fetchCalled = true;
    return new Response();
  }) as typeof fetch, async () => {
    const { response, result } = createResponse();
    let protectedWorkCalled = false;

    await withPronunciationSecurity(
      { headers: {} },
      response,
      'assessment',
      async () => {
        protectedWorkCalled = true;
      },
    );

    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: '请先登录后使用语音服务' });
    assert.equal(fetchCalled, false);
    assert.equal(protectedWorkCalled, false);
  });
});

test('invalid Supabase bearer authentication is rejected server-side', async () => {
  await withSecurityEnvironment((async (input) => {
    assert.equal(String(input), 'https://project.supabase.co/auth/v1/user');
    return new Response(JSON.stringify({ message: 'invalid JWT' }), { status: 401 });
  }) as typeof fetch, async () => {
    const { response, result } = createResponse();
    let protectedWorkCalled = false;

    await withPronunciationSecurity(
      request('invalid-token'),
      response,
      'examples',
      async () => {
        protectedWorkCalled = true;
      },
    );

    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: '登录已失效，请重新登录' });
    assert.equal(protectedWorkCalled, false);
  });
});

test('distributed rate-limit denial uses service role and a minimal trusted payload', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  await withSecurityEnvironment((async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/acquire_pronunciation_request')) {
      return new Response(JSON.stringify({
        allowed: false,
        reason: 'rate_limit',
        retry_after_seconds: 17,
      }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch, async () => {
    const { response, result } = createResponse();
    let protectedWorkCalled = false;

    await withPronunciationSecurity(
      request(),
      response,
      'synthesis',
      async () => {
        protectedWorkCalled = true;
      },
    );

    assert.equal(result.status, 429);
    assert.equal(result.headers['Retry-After'], '17');
    assert.deepEqual(result.body, { error: '请求过于频繁，请稍后再试' });
    assert.equal(protectedWorkCalled, false);

    const authHeaders = calls[0].init?.headers as Record<string, string>;
    assert.equal(authHeaders.apikey, 'anon-key');
    assert.equal(authHeaders.Authorization, 'Bearer valid-token');

    const acquireHeaders = calls[1].init?.headers as Record<string, string>;
    assert.equal(acquireHeaders.apikey, 'service-role-key');
    assert.equal(acquireHeaders.Authorization, 'Bearer service-role-key');
    const acquireBody = JSON.parse(String(calls[1].init?.body));
    assert.deepEqual(Object.keys(acquireBody).sort(), [
      'p_ip_hash',
      'p_operation',
      'p_owner',
    ]);
    assert.equal(acquireBody.p_owner, 'user-1');
    assert.equal(acquireBody.p_operation, 'synthesis');
    assert.match(acquireBody.p_ip_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(acquireBody.p_ip_hash, '203.0.113.9');
  });
});

test('the fourth global TTS start in one second is rejected across principals and recovers', async () => {
  let nowMs = 0;
  const starts: number[] = [];
  const acquireBodies: Record<string, unknown>[] = [];
  let leaseSequence = 0;

  await withSecurityEnvironment((async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      const authorization = (init?.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ id: authorization.replace('Bearer ', '') }), {
        status: 200,
      });
    }
    if (url.endsWith('/rest/v1/rpc/acquire_pronunciation_request')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      acquireBodies.push(body);
      const oneSecondStarts = starts.filter((startedAt) => nowMs - startedAt < 1_000);
      const oneMinuteStarts = starts.filter((startedAt) => nowMs - startedAt < 60_000);
      if (
        oneSecondStarts.length >= 3
        || oneMinuteStarts.length >= 180
      ) {
        return new Response(JSON.stringify({
          allowed: false,
          reason: 'global_rate_limit',
          retry_after_seconds: 1,
        }), { status: 200 });
      }
      starts.push(nowMs);
      leaseSequence += 1;
      return new Response(JSON.stringify(allowedLease(`lease-${leaseSequence}`)), {
        status: 200,
      });
    }
    if (url.endsWith('/rest/v1/rpc/release_pronunciation_request')) {
      return new Response('null', { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch, async () => {
    async function attempt(index: number): Promise<ResponseResult & { worked: boolean }> {
      const { response, result } = createResponse();
      let worked = false;
      await withPronunciationSecurity(
        request(`user-${index}`, `203.0.113.${index}`),
        response,
        'synthesis',
        async () => {
          worked = true;
        },
      );
      return { ...result, worked };
    }

    for (let index = 1; index <= 3; index += 1) {
      const allowed = await attempt(index);
      assert.equal(allowed.status, 200);
      assert.equal(allowed.worked, true);
    }

    const denied = await attempt(4);
    assert.equal(denied.status, 429);
    assert.equal(denied.headers['Retry-After'], '1');
    assert.equal(denied.worked, false);

    for (const body of acquireBodies) {
      assert.deepEqual(Object.keys(body).sort(), [
        'p_ip_hash',
        'p_operation',
        'p_owner',
      ]);
      assert.equal(body.p_operation, 'synthesis');
    }

    nowMs = 1_001;
    const recovered = await attempt(5);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.worked, true);
  });
});

test('the second Omni assessment start in one second is rejected across principals and recovers', async () => {
  let nowMs = 0;
  const omniStarts: number[] = [];
  const acquireBodies: Record<string, unknown>[] = [];
  let leaseSequence = 0;

  await withSecurityEnvironment((async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      const authorization = (init?.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ id: authorization.replace('Bearer ', '') }), {
        status: 200,
      });
    }
    if (url.endsWith('/rest/v1/rpc/acquire_pronunciation_request')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      acquireBodies.push(body);
      if (body.p_operation === 'omni_assessment') {
        const oneSecondStarts = omniStarts.filter((startedAt) => nowMs - startedAt < 1_000);
        const oneMinuteStarts = omniStarts.filter((startedAt) => nowMs - startedAt < 60_000);
        if (oneSecondStarts.length >= 1 || oneMinuteStarts.length >= 60) {
          return new Response(JSON.stringify({
            allowed: false,
            reason: 'global_rate_limit',
            retry_after_seconds: 1,
          }), { status: 200 });
        }
        omniStarts.push(nowMs);
      }
      leaseSequence += 1;
      return new Response(JSON.stringify(allowedLease(`lease-${leaseSequence}`)), {
        status: 200,
      });
    }
    if (url.endsWith('/rest/v1/rpc/release_pronunciation_request')) {
      return new Response('null', { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch, async () => {
    async function attempt(index: number): Promise<ResponseResult & { worked: boolean }> {
      const { response, result } = createResponse();
      let worked = false;
      await withPronunciationSecurity(
        request(`user-${index}`, `203.0.113.${index}`),
        response,
        'assessment',
        async (context) => {
          await context.withProviderGate('omni_assessment', async () => {
            worked = true;
          });
        },
      );
      return { ...result, worked };
    }

    const first = await attempt(1);
    assert.equal(first.status, 200);
    assert.equal(first.worked, true);

    const denied = await attempt(2);
    assert.equal(denied.status, 429);
    assert.equal(denied.headers['Retry-After'], '1');
    assert.equal(denied.worked, false);

    nowMs = 1_001;
    const recovered = await attempt(3);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.worked, true);

    assert.deepEqual(
      acquireBodies.map((body) => body.p_operation),
      [
        'assessment',
        'omni_assessment',
        'assessment',
        'omni_assessment',
        'assessment',
        'omni_assessment',
      ],
    );
    for (const body of acquireBodies) {
      assert.deepEqual(Object.keys(body).sort(), [
        'p_ip_hash',
        'p_operation',
        'p_owner',
      ]);
    }
  });
});

test('an Omni gate with insufficient remaining lease time releases both leases before work starts', async () => {
  const releasedLeaseIds: string[] = [];
  await withSecurityEnvironment((async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/acquire_pronunciation_request')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.p_operation === 'omni_assessment') {
        return new Response(JSON.stringify(
          allowedLease('omni-lease', Date.now() - 29_500),
        ), { status: 200 });
      }
      return new Response(JSON.stringify(allowedLease('assessment-lease')), {
        status: 200,
      });
    }
    if (url.endsWith('/rest/v1/rpc/release_pronunciation_request')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      releasedLeaseIds.push(String(body.p_lease_id));
      return new Response('null', { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch, async () => {
    const { response, result } = createResponse();
    let omniWorkCalled = false;

    await withPronunciationSecurity(
      request(),
      response,
      'assessment',
      async (context) => {
        await context.withProviderGate('omni_assessment', async () => {
          omniWorkCalled = true;
        });
      },
    );

    assert.equal(result.status, 503);
    assert.deepEqual(result.body, {
      error: '语音服务访问控制租约不足，请稍后重试',
    });
    assert.equal(omniWorkCalled, false);
    assert.deepEqual(releasedLeaseIds, ['omni-lease', 'assessment-lease']);
  });
});

test('concurrency lease is released even when protected work throws', async () => {
  const rpcCalls: string[] = [];
  await withSecurityEnvironment((async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/acquire_pronunciation_request')) {
      rpcCalls.push('acquire');
      return new Response(JSON.stringify(allowedLease()), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/release_pronunciation_request')) {
      rpcCalls.push('release');
      return new Response('null', { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch, async () => {
    const { response } = createResponse();

    await assert.rejects(
      () => withPronunciationSecurity(
        request(),
        response,
        'assessment',
        async () => {
          throw new Error('provider failed');
        },
      ),
      /provider failed/,
    );

    assert.deepEqual(rpcCalls, ['acquire', 'release']);
  });
});

test('missing cloud configuration fails closed instead of enabling local anonymous access', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalViteUrl = process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  const { response, result } = createResponse();
  let protectedWorkCalled = false;

  try {
    await withPronunciationSecurity(
      request(),
      response,
      'assessment',
      async () => {
        protectedWorkCalled = true;
      },
    );
  } finally {
    if (originalUrl !== undefined) process.env.SUPABASE_URL = originalUrl;
    if (originalViteUrl !== undefined) process.env.VITE_SUPABASE_URL = originalViteUrl;
  }

  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: '云端语音服务未配置身份验证' });
  assert.equal(protectedWorkCalled, false);
});

test('missing service-role configuration fails closed before any network call', async () => {
  let fetchCalled = false;
  await withSecurityEnvironment((async () => {
    fetchCalled = true;
    return new Response();
  }) as typeof fetch, async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { response, result } = createResponse();
    let protectedWorkCalled = false;

    await withPronunciationSecurity(
      request(),
      response,
      'assessment',
      async () => {
        protectedWorkCalled = true;
      },
    );

    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: '云端语音服务未配置身份验证' });
    assert.equal(fetchCalled, false);
    assert.equal(protectedWorkCalled, false);
  });
});

test('provider deadline is derived from the conservative remaining lease time', () => {
  const helper = (
    pronunciationSecurity as typeof pronunciationSecurity & {
      calculateProviderDeadlineMs?: (input: {
        grantedAt: string;
        expiresAt: string;
        acquireStartedAtMs: number;
        responseReceivedAtMs: number;
        configuredTimeoutMs: number;
      }) => number | null;
    }
  ).calculateProviderDeadlineMs;

  assert.equal(typeof helper, 'function');
  assert.equal(helper?.({
    grantedAt: new Date(10_000).toISOString(),
    expiresAt: new Date(40_000).toISOString(),
    acquireStartedAtMs: 10_000,
    responseReceivedAtMs: 25_000,
    configuredTimeoutMs: 20_000,
  }), 14_000);
  assert.equal(helper?.({
    grantedAt: new Date(10_000).toISOString(),
    expiresAt: new Date(40_000).toISOString(),
    acquireStartedAtMs: 39_000,
    responseReceivedAtMs: 39_500,
    configuredTimeoutMs: 20_000,
  }), null);
});

test('an acquired lease with insufficient provider time is released before work starts', async () => {
  let releaseCalls = 0;
  await withSecurityEnvironment((async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/acquire_pronunciation_request')) {
      return new Response(JSON.stringify(
        allowedLease(
          '11111111-1111-4111-8111-111111111111',
          Date.now() - 29_500,
        ),
      ), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/release_pronunciation_request')) {
      releaseCalls += 1;
      return new Response('null', { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch, async () => {
    const { response, result } = createResponse();
    let protectedWorkCalled = false;

    await withPronunciationSecurity(
      request(),
      response,
      'assessment',
      async () => {
        protectedWorkCalled = true;
      },
    );

    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: '语音服务访问控制租约不足，请稍后重试' });
    assert.equal(protectedWorkCalled, false);
    assert.equal(releaseCalls, 1);
  });
});

test('an empty dedicated hash secret falls back to the configured provider key', async () => {
  await withSecurityEnvironment((async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/acquire_pronunciation_request')) {
      return new Response(JSON.stringify(allowedLease()), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/release_pronunciation_request')) {
      return new Response('null', { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch, async () => {
    process.env.PRONUNCIATION_RATE_LIMIT_SECRET = '';
    process.env.QWEN_API_KEY = 'provider-key-fallback';
    const { response, result } = createResponse();
    let protectedWorkCalled = false;

    await withPronunciationSecurity(
      request(),
      response,
      'assessment',
      async () => {
        protectedWorkCalled = true;
      },
    );

    assert.equal(result.status, 200);
    assert.equal(protectedWorkCalled, true);
  });
});
