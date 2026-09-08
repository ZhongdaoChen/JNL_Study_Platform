import test from 'node:test';
import assert from 'node:assert/strict';
import {
  withPronunciationSecurity,
  type PronunciationSecurityRequest,
  type PronunciationSecurityResponse,
} from '../api/pronunciationSecurity.ts';

interface ResponseResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
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
    PRONUNCIATION_RATE_LIMIT_SECRET: process.env.PRONUNCIATION_RATE_LIMIT_SECRET,
    PRONUNCIATION_SECURITY_TIMEOUT_MS: process.env.PRONUNCIATION_SECURITY_TIMEOUT_MS,
    PRONUNCIATION_UPSTREAM_TIMEOUT_MS: process.env.PRONUNCIATION_UPSTREAM_TIMEOUT_MS,
    PRONUNCIATION_LEASE_SECONDS: process.env.PRONUNCIATION_LEASE_SECONDS,
    QWEN_API_KEY: process.env.QWEN_API_KEY,
  };
  globalThis.fetch = fetchImplementation;
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.PRONUNCIATION_RATE_LIMIT_SECRET = 'rate-limit-secret';
  process.env.PRONUNCIATION_SECURITY_TIMEOUT_MS = '20';
  process.env.PRONUNCIATION_UPSTREAM_TIMEOUT_MS = '25';
  process.env.PRONUNCIATION_LEASE_SECONDS = '30';

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
  await withSecurityEnvironment((async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/acquire_pronunciation_request')) {
      return new Response(JSON.stringify({
        allowed: true,
        lease_id: '11111111-1111-4111-8111-111111111111',
        retry_after_seconds: 0,
      }), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/release_pronunciation_request')) {
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

test('distributed rate-limit denial returns 429 and Retry-After', async () => {
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

    const acquireBody = JSON.parse(String(calls[1].init?.body));
    assert.equal(acquireBody.p_scope, 'pronunciation');
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
        oneSecondStarts.length >= Number(body.p_global_per_second)
        || oneMinuteStarts.length >= Number(body.p_global_per_minute)
      ) {
        return new Response(JSON.stringify({
          allowed: false,
          reason: 'global_rate_limit',
          retry_after_seconds: 1,
        }), { status: 200 });
      }
      starts.push(nowMs);
      leaseSequence += 1;
      return new Response(JSON.stringify({
        allowed: true,
        lease_id: `lease-${leaseSequence}`,
        retry_after_seconds: 0,
      }), { status: 200 });
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
        {
          resourceKey: 'dashscope-tts',
          modelKey: 'qwen3-tts-flash',
          perSecond: 3,
          perMinute: 180,
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
      assert.equal(body.p_resource_key, 'dashscope-tts');
      assert.equal(body.p_model_key, 'qwen3-tts-flash');
      assert.equal(body.p_global_per_second, 3);
      assert.equal(body.p_global_per_minute, 180);
    }

    nowMs = 1_001;
    const recovered = await attempt(5);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.worked, true);
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
      return new Response(JSON.stringify({
        allowed: true,
        lease_id: '11111111-1111-4111-8111-111111111111',
        retry_after_seconds: 0,
      }), { status: 200 });
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

test('an empty dedicated hash secret falls back to the configured provider key', async () => {
  await withSecurityEnvironment((async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/acquire_pronunciation_request')) {
      return new Response(JSON.stringify({
        allowed: true,
        lease_id: '11111111-1111-4111-8111-111111111111',
        retry_after_seconds: 0,
      }), { status: 200 });
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
