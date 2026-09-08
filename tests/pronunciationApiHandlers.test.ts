import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DASH_SCOPE_CHAT_COMPLETIONS_URL,
  DASH_SCOPE_MULTIMODAL_URL,
  audioFormatForMimeType,
  parseJsonObject,
  validateAudioRequest,
  validateExampleRequest,
  validateSynthesisRequest,
} from '../api/pronunciationShared.ts';
import assessPronunciation from '../api/assess-pronunciation.ts';
import generatePronunciationExamples from '../api/generate-pronunciation-examples.ts';
import synthesizePronunciation from '../api/synthesize-pronunciation.ts';

interface HandlerRequest {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

interface HandlerResponse {
  status(code: number): HandlerResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string | number): void;
}

type Handler = (req: HandlerRequest, res: HandlerResponse) => Promise<void>;

interface HandlerResult {
  status: number;
  body: unknown;
}

interface ServerEnvironmentState {
  releaseCalls: number;
  acquireBodies: Record<string, unknown>[];
}

const MIN_AUDIO_BYTES = 256;
const VALID_AUDIO_BASE64 = Buffer.alloc(MIN_AUDIO_BYTES, 1).toString('base64');

test('Vercel pronunciation functions keep runtime imports inside the api directory', () => {
  const serverFiles = [
    'api/assess-pronunciation.ts',
    'api/generate-pronunciation-examples.ts',
    'api/pronunciationShared.ts',
    'api/synthesize-pronunciation.ts',
  ];

  for (const path of serverFiles) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /from ['"]\.\.\/src\//);
  }
});

test('Vercel includes TypeScript API helpers in serverless function bundles', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    functions?: Record<string, { includeFiles?: string; maxDuration?: number }>;
    regions?: string[];
  };

  assert.equal(config.functions?.['api/*.ts']?.includeFiles, 'api/*.ts');
  assert.ok((config.functions?.['api/*.ts']?.maxDuration ?? 0) >= 60);
  // 函数必须跑在离 DashScope（北京）和用户都近的新加坡区域，
  // 默认美东会让音频上传和上游调用横跨太平洋，频繁撞超时。
  assert.deepEqual(config.regions, ['sin1']);
});

test('api functions import local modules with .js specifiers so Vercel builds resolve them', () => {
  const serverFiles = [
    'api/assess-pronunciation.ts',
    'api/generate-pronunciation-examples.ts',
    'api/synthesize-pronunciation.ts',
    'api/pronunciationShared.ts',
    'api/pronunciationSecurity.ts',
    'api/pronunciationRules.ts',
  ];

  for (const path of serverFiles) {
    const source = readFileSync(path, 'utf8');
    const relativeImports = [...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)]
      .map((match) => match[1]);
    for (const specifier of relativeImports) {
      assert.ok(
        specifier.endsWith('.js'),
        `${path} imports '${specifier}': Vercel compiles each api/*.ts per file, so relative specifiers must end with .js (never .ts), otherwise the deployed function crashes with ERR_MODULE_NOT_FOUND`,
      );
    }
  }
});

async function invokeHandler(handler: Handler, req: HandlerRequest): Promise<HandlerResult> {
  const result: HandlerResult = { status: 200, body: undefined };
  const res: HandlerResponse = {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
    },
    setHeader() {},
  };
  const request = Object.hasOwn(req, 'headers')
    ? req
    : {
        ...req,
        headers: {
          authorization: 'Bearer valid-session-token',
          'x-forwarded-for': '203.0.113.10',
        },
      };
  await handler(request, res);
  return result;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(contentChunks: string[], status = 200): Response {
  const body = [
    ...contentChunks.map((content) => `data: ${JSON.stringify({
      choices: [{ delta: { content } }],
    })}\n\n`),
    'data: [DONE]\n\n',
  ].join('');
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function hangsUntilAborted(
  init: RequestInit | undefined,
  onAbort: () => void,
): Promise<Response> {
  return new Promise((_, reject) => {
    const failsafe = setTimeout(
      () => reject(new Error('test provider fetch was not aborted')),
      200,
    );
    init?.signal?.addEventListener('abort', () => {
      clearTimeout(failsafe);
      onAbort();
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }, { once: true });
  });
}

async function withServerEnvironment(
  fetchImplementation: typeof fetch,
  run: (state: ServerEnvironmentState) => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.QWEN_API_KEY;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const originalSupabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalRateSecret = process.env.PRONUNCIATION_RATE_LIMIT_SECRET;
  const originalSecurityTimeout = process.env.PRONUNCIATION_SECURITY_TIMEOUT_MS;
  const originalUpstreamTimeout = process.env.PRONUNCIATION_UPSTREAM_TIMEOUT_MS;
  const state: ServerEnvironmentState = { releaseCalls: 0, acquireBodies: [] };
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === 'https://project.supabase.co/auth/v1/user') {
      return jsonResponse({ id: 'user-1' });
    }
    if (url === 'https://project.supabase.co/rest/v1/rpc/acquire_pronunciation_request') {
      state.acquireBodies.push(JSON.parse(String(init?.body)));
      const grantedAt = Date.now();
      return jsonResponse({
        allowed: true,
        lease_id: '11111111-1111-4111-8111-111111111111',
        granted_at: new Date(grantedAt).toISOString(),
        expires_at: new Date(grantedAt + 60_000).toISOString(),
        retry_after_seconds: 0,
      });
    }
    if (url === 'https://project.supabase.co/rest/v1/rpc/release_pronunciation_request') {
      state.releaseCalls += 1;
      return jsonResponse(null);
    }
    return fetchImplementation(input, init);
  }) as typeof fetch;
  process.env.QWEN_API_KEY = 'server-test-key';
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  process.env.PRONUNCIATION_RATE_LIMIT_SECRET = 'rate-limit-secret';
  process.env.PRONUNCIATION_SECURITY_TIMEOUT_MS = '20';
  process.env.PRONUNCIATION_UPSTREAM_TIMEOUT_MS = '25';

  try {
    await run(state);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = originalApiKey;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = originalSupabaseAnonKey;
    if (originalSupabaseServiceRoleKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseServiceRoleKey;
    }
    if (originalRateSecret === undefined) delete process.env.PRONUNCIATION_RATE_LIMIT_SECRET;
    else process.env.PRONUNCIATION_RATE_LIMIT_SECRET = originalRateSecret;
    if (originalSecurityTimeout === undefined) delete process.env.PRONUNCIATION_SECURITY_TIMEOUT_MS;
    else process.env.PRONUNCIATION_SECURITY_TIMEOUT_MS = originalSecurityTimeout;
    if (originalUpstreamTimeout === undefined) delete process.env.PRONUNCIATION_UPSTREAM_TIMEOUT_MS;
    else process.env.PRONUNCIATION_UPSTREAM_TIMEOUT_MS = originalUpstreamTimeout;
  }
}

test('every protected DashScope fetch aborts before lease expiry and releases its lease', { timeout: 2_000 }, async () => {
  const cases: {
    name: string;
    handler: Handler;
    body: Record<string, unknown>;
    expectedError: string;
    fetchImplementation: typeof fetch;
  }[] = [
    {
      name: 'assessment',
      handler: assessPronunciation,
      body: { target: '中', mimeType: 'audio/wav', audioBase64: VALID_AUDIO_BASE64 },
      expectedError: '发音评估超时，请稍后重试',
      fetchImplementation: (async (_input, init) => hangsUntilAborted(init, () => {})) as typeof fetch,
    },
    {
      name: 'helper examples',
      handler: generatePronunciationExamples,
      body: { character: '中' },
      expectedError: '辅助词生成超时，请稍后重试',
      fetchImplementation: (async (_input, init) => hangsUntilAborted(init, () => {})) as typeof fetch,
    },
    {
      name: 'synthesis',
      handler: synthesizePronunciation,
      body: { text: '中' },
      expectedError: '语音合成超时，请稍后重试',
      fetchImplementation: (async (_input, init) => hangsUntilAborted(init, () => {})) as typeof fetch,
    },
  ];

  for (const testCase of cases) {
    let aborted = false;
    await withServerEnvironment((async (input, init) => {
      try {
        return await testCase.fetchImplementation(input, init);
      } finally {
        if (init?.signal?.aborted) aborted = true;
      }
    }) as typeof fetch, async (state) => {
      const startedAt = Date.now();
      const result = await invokeHandler(testCase.handler, {
        method: 'POST',
        body: testCase.body,
      });

      assert.deepEqual(
        result,
        { status: 504, body: { error: testCase.expectedError } },
        testCase.name,
      );
      assert.equal(aborted, true, testCase.name);
      assert.equal(state.releaseCalls, 1, testCase.name);
      assert.ok(Date.now() - startedAt < 1_000, testCase.name);
    });
  }
});

test('a hanging DashScope response body maps to 504 and still releases the lease', { timeout: 1_000 }, async () => {
  let bodyAborted = false;
  await withServerEnvironment((async (_input, init) => ({
    ok: true,
    json() {
      return new Promise((_, reject) => {
        const failsafe = setTimeout(
          () => reject(new Error('test response body was not aborted')),
          200,
        );
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(failsafe);
          bodyAborted = true;
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, { once: true });
      });
    },
  } as Response)) as typeof fetch, async (state) => {
    const result = await invokeHandler(synthesizePronunciation, {
      method: 'POST',
      body: { text: '中' },
    });

    assert.deepEqual(result, {
      status: 504,
      body: { error: '语音合成超时，请稍后重试' },
    });
    assert.equal(bodyAborted, true);
    assert.equal(state.releaseCalls, 1);
  });
});

test('parseJsonObject parses plain and fenced JSON objects', () => {
  assert.deepEqual(parseJsonObject('{"status":"correct"}'), { status: 'correct' });
  assert.deepEqual(
    parseJsonObject('  ```json\n{"examples":["中国","中午","中间"]}\n```  '),
    { examples: ['中国', '中午', '中间'] },
  );
});

test('parseJsonObject tolerates the lone trailing fence qwen3.5-omni-flash emits', () => {
  // 实测回归：模型会在合法 JSON 之后追加一行孤立的 ```（没有开头围栏）。
  assert.deepEqual(
    parseJsonObject('{"recognizedText":"中","status":"correct"}\n```'),
    { recognizedText: '中', status: 'correct' },
  );
  assert.deepEqual(
    parseJsonObject('好的：\n{"status":"correct"}\n```\n'),
    { status: 'correct' },
  );
});

test('parseJsonObject rejects empty, invalid, array, and primitive JSON', () => {
  assert.equal(parseJsonObject(''), null);
  assert.equal(parseJsonObject('```json\nnot-json\n```'), null);
  assert.equal(parseJsonObject('[]'), null);
  assert.equal(parseJsonObject('"secret"'), null);
});

test('validateAudioRequest rejects missing or non-Chinese targets', () => {
  assert.throws(
    () => validateAudioRequest({ mimeType: 'audio/webm', audioBase64: 'AQ==' }),
    /target/,
  );
  assert.throws(
    () => validateAudioRequest({
      target: 'hello',
      mimeType: 'audio/webm',
      audioBase64: 'AQ==',
    }),
    /target/,
  );
});

test('validateAudioRequest rejects unsupported MIME types and invalid base64', () => {
  assert.throws(
    () => validateAudioRequest({
      target: '中',
      mimeType: 'audio/mpeg',
      audioBase64: VALID_AUDIO_BASE64,
    }),
    /音频格式/,
  );
  assert.throws(
    () => validateAudioRequest({
      target: '中',
      mimeType: 'audio/webm',
      audioBase64: 'not base64!',
    }),
    /音频数据/,
  );
});

test('validateAudioRequest rejects decoded audio below the conservative minimum', () => {
  assert.throws(
    () => validateAudioRequest({
      target: '中',
      mimeType: 'audio/webm',
      audioBase64: Buffer.alloc(MIN_AUDIO_BYTES - 1).toString('base64'),
    }),
    /音频太短/,
  );
});

test('validateAudioRequest accepts decoded audio at the conservative minimum', () => {
  assert.deepEqual(
    validateAudioRequest({
      target: '中',
      mimeType: 'audio/webm',
      audioBase64: VALID_AUDIO_BASE64,
    }),
    {
      target: '中',
      mimeType: 'audio/webm',
      audioBase64: VALID_AUDIO_BASE64,
    },
  );
});

test('validateAudioRequest rejects decoded audio larger than 1 MB', () => {
  assert.throws(
    () => validateAudioRequest({
      target: '中',
      mimeType: 'audio/webm',
      audioBase64: Buffer.alloc(1_000_001).toString('base64'),
    }),
    /1 MB/,
  );
});

test('validateAudioRequest accepts all supported browser audio types', () => {
  for (const mimeType of [
    'audio/webm',
    'audio/webm;codecs=opus',
    'audio/mp4',
    'audio/ogg',
    'audio/ogg;codecs=opus',
    'audio/wav',
  ]) {
    assert.deepEqual(
      validateAudioRequest({
        target: ' 中国。 ',
        mimeType,
        audioBase64: VALID_AUDIO_BASE64,
      }),
      { target: '中国。', mimeType, audioBase64: VALID_AUDIO_BASE64 },
    );
  }
});

test('browser MIME types map to the documented DashScope audio format values', () => {
  assert.equal(audioFormatForMimeType('audio/webm'), 'webm');
  assert.equal(audioFormatForMimeType('audio/webm;codecs=opus'), 'webm');
  assert.equal(audioFormatForMimeType('audio/mp4'), 'mp4');
  assert.equal(audioFormatForMimeType('audio/ogg'), 'ogg');
  assert.equal(audioFormatForMimeType('audio/ogg;codecs=opus'), 'ogg');
  assert.equal(audioFormatForMimeType('audio/wav'), 'wav');
});

test('example validation requires a single Han character', () => {
  assert.deepEqual(validateExampleRequest({ character: ' 中 ' }), { character: '中' });
  assert.throws(() => validateExampleRequest({ character: '中国' }), /character/);
  assert.throws(() => validateExampleRequest({ character: 'a' }), /character/);
});

test('synthesis validation requires 1 to 40 Chinese characters', () => {
  assert.deepEqual(validateSynthesisRequest({ text: ' 中国。 ' }), { text: '中国。' });
  assert.throws(() => validateSynthesisRequest({ text: '' }), /text/);
  assert.throws(() => validateSynthesisRequest({ text: '中'.repeat(41) }), /40/);
  assert.throws(() => validateSynthesisRequest({ text: 'hello' }), /text/);
});

test('invalid paid requests are rejected before acquiring provider capacity', async () => {
  let providerFetches = 0;
  await withServerEnvironment((async () => {
    providerFetches += 1;
    return jsonResponse({});
  }) as typeof fetch, async (state) => {
    const cases: Array<{ handler: Handler; body: unknown }> = [
      {
        handler: assessPronunciation,
        body: { target: 'hello', mimeType: 'audio/wav', audioBase64: 'AQ==' },
      },
      {
        handler: assessPronunciation,
        body: { target: '中', mimeType: 'audio/wav', audioBase64: 'AQ==' },
      },
      {
        handler: generatePronunciationExamples,
        body: { character: '中国' },
      },
      {
        handler: synthesizePronunciation,
        body: { text: 'hello' },
      },
    ];

    for (const testCase of cases) {
      const result = await invokeHandler(testCase.handler, {
        method: 'POST',
        body: testCase.body,
      });
      assert.equal(result.status, 400);
    }

    assert.equal(state.acquireBodies.length, 0);
    assert.equal(state.releaseCalls, 0);
    assert.equal(providerFetches, 0);
  });
});

test('assessment uses a single documented direct-audio Qwen Omni Flash JSON decision', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];

  await withServerEnvironment((async (input, init) => {
    requests.push({ url: String(input), init });
    return sseResponse([
      '{"recognizedText":"中","status":"correct","confidence":',
      '0.98,"acceptedReading":"zhòng"}',
    ]);
  }) as typeof fetch, async () => {
    const result = await invokeHandler(assessPronunciation, {
      method: 'POST',
      body: { target: '中', mimeType: 'audio/wav', audioBase64: VALID_AUDIO_BASE64 },
    });

    assert.deepEqual(result, {
      status: 200,
      body: {
        correct: true,
        recognizedText: '中',
        acceptedReading: 'zhòng',
        confidence: 0.98,
      },
    });
    assert.equal(requests.length, 1);

    const judgmentRequest = requests[0];
    assert.equal(judgmentRequest.url, DASH_SCOPE_CHAT_COMPLETIONS_URL);
    assert.equal(judgmentRequest.init?.method, 'POST');
    assert.equal(
      (judgmentRequest.init?.headers as Record<string, string>).Authorization,
      'Bearer server-test-key',
    );
    const judgmentBody = JSON.parse(String(judgmentRequest.init?.body));
    assert.equal(judgmentBody.model, 'qwen3.5-omni-flash');
    assert.equal(judgmentBody.stream, true);
    assert.deepEqual(judgmentBody.modalities, ['text']);
    assert.equal(judgmentBody.response_format.type, 'json_object');
    assert.equal(judgmentBody.temperature, 0);
    assert.deepEqual(
      judgmentBody.messages[1].content[0],
      {
        type: 'input_audio',
        input_audio: {
          data: `data:audio/wav;base64,${VALID_AUDIO_BASE64}`,
          format: 'wav',
        },
      },
    );
    assert.match(judgmentBody.messages[1].content[1].text, /"target":"中"/);
    assert.match(judgmentBody.messages[1].content[1].text, /recognizedText/);
    assert.match(judgmentBody.messages[1].content[1].text, /任一常见现代普通话读音/);
  });
});

test('multi-character mismatch uses original audio and can pass on a high-confidence direct decision', async () => {
  let fetchCount = 0;
  await withServerEnvironment((async () => {
    fetchCount += 1;
    return sseResponse([
      '{"recognizedText":"忠国","status":"correct","confidence":0.97,"acceptedReading":null}',
    ]);
  }) as typeof fetch, async () => {
    const result = await invokeHandler(assessPronunciation, {
      method: 'POST',
      body: { target: '中国', mimeType: 'audio/wav', audioBase64: VALID_AUDIO_BASE64 },
    });

    assert.deepEqual(result, {
      status: 200,
      body: {
        correct: true,
        recognizedText: '忠国',
        acceptedReading: null,
        confidence: 0.97,
      },
    });
    assert.equal(fetchCount, 1);
  });
});

test('assessment accepts a judgment followed by a stray trailing fence chunk', async () => {
  await withServerEnvironment((async () => sseResponse([
    '{"recognizedText":"中","status":"correct","confidence":1,"acceptedReading":"zhōng"}',
    '\n```',
  ])) as typeof fetch, async () => {
    const result = await invokeHandler(assessPronunciation, {
      method: 'POST',
      body: { target: '中', mimeType: 'audio/wav', audioBase64: VALID_AUDIO_BASE64 },
    });

    assert.deepEqual(result, {
      status: 200,
      body: {
        correct: true,
        recognizedText: '中',
        acceptedReading: 'zhōng',
        confidence: 1,
      },
    });
  });
});

test('multi-character mismatch stays ungraded when the direct decision is unclear or low confidence', async () => {
  for (const judgment of [
    '{"recognizedText":"忠国","status":"unclear","confidence":0.99,"acceptedReading":null}',
    '{"recognizedText":"忠国","status":"incorrect","confidence":0.89,"acceptedReading":null}',
  ]) {
    await withServerEnvironment((async () => sseResponse([judgment])) as typeof fetch, async () => {
      const result = await invokeHandler(assessPronunciation, {
        method: 'POST',
        body: {
          target: '中国',
          mimeType: 'audio/wav',
          audioBase64: VALID_AUDIO_BASE64,
        },
      });

      assert.deepEqual(result, {
        status: 422,
        body: { error: '没有听清，请再试一次' },
      });
    });
  }
});

test('only an explicit high-confidence incorrect direct decision returns correct false', async () => {
  await withServerEnvironment((async () => sseResponse([
    '{"recognizedText":"忠国","status":"incorrect","confidence":0.9,"acceptedReading":null}',
  ])) as typeof fetch, async () => {
    const result = await invokeHandler(assessPronunciation, {
      method: 'POST',
      body: {
        target: '中国',
        mimeType: 'audio/wav',
        audioBase64: VALID_AUDIO_BASE64,
      },
    });

    assert.deepEqual(result, {
      status: 200,
      body: {
        correct: false,
        recognizedText: '忠国',
        acceptedReading: null,
        confidence: 0.9,
      },
    });
  });
});

test('assessment maps an empty recognized transcript to 422', async () => {
  await withServerEnvironment((async () => sseResponse([
    '{"recognizedText":"","status":"correct","confidence":0.99,"acceptedReading":null}',
  ])) as typeof fetch, async () => {
    const result = await invokeHandler(assessPronunciation, {
      method: 'POST',
      body: { target: '中国', mimeType: 'audio/wav', audioBase64: VALID_AUDIO_BASE64 },
    });

    assert.deepEqual(result, {
      status: 422,
      body: { error: '没有听清，请再试一次' },
    });
  });
});

test('assessment maps invalid and failed upstream responses to safe 502 errors', async () => {
  for (const response of [
    jsonResponse({ secret: 'upstream-secret' }, 401),
    sseResponse(['not-json']),
  ]) {
    await withServerEnvironment((async () => response) as typeof fetch, async () => {
      const result = await invokeHandler(assessPronunciation, {
        method: 'POST',
        body: {
          target: '中国',
          mimeType: 'audio/webm',
          audioBase64: VALID_AUDIO_BASE64,
        },
      });

      assert.equal(result.status, 502);
      assert.doesNotMatch(JSON.stringify(result.body), /upstream-secret|server-test-key/);
    });
  }
});

test('assessment retries a transient upstream rejection once and can succeed', async () => {
  let fetchCount = 0;
  await withServerEnvironment((async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return jsonResponse({
        error: { code: 'Throttling.RateQuota', message: 'rate limit exceeded' },
      }, 429);
    }
    return sseResponse([
      '{"recognizedText":"中","status":"correct","confidence":0.98,"acceptedReading":"zhōng"}',
    ]);
  }) as typeof fetch, async () => {
    const result = await invokeHandler(assessPronunciation, {
      method: 'POST',
      body: { target: '中', mimeType: 'audio/wav', audioBase64: VALID_AUDIO_BASE64 },
    });

    assert.equal(result.status, 200);
    assert.equal(fetchCount, 2);
  });
});

test('assessment gives up after two transient upstream failures', async () => {
  let fetchCount = 0;
  await withServerEnvironment((async () => {
    fetchCount += 1;
    return jsonResponse({ error: { code: 'InternalError' } }, 503);
  }) as typeof fetch, async () => {
    const result = await invokeHandler(assessPronunciation, {
      method: 'POST',
      body: { target: '中', mimeType: 'audio/wav', audioBase64: VALID_AUDIO_BASE64 },
    });

    assert.deepEqual(result, {
      status: 502,
      body: { error: '发音评估服务暂时不可用' },
    });
    assert.equal(fetchCount, 2);
  });
});

test('assessment does not retry a non-transient upstream rejection', async () => {
  let fetchCount = 0;
  await withServerEnvironment((async () => {
    fetchCount += 1;
    return jsonResponse({ error: { code: 'InvalidParameter', message: 'bad audio' } }, 400);
  }) as typeof fetch, async () => {
    const result = await invokeHandler(assessPronunciation, {
      method: 'POST',
      body: { target: '中', mimeType: 'audio/wav', audioBase64: VALID_AUDIO_BASE64 },
    });

    assert.deepEqual(result, {
      status: 502,
      body: { error: '发音评估服务暂时不可用' },
    });
    assert.equal(fetchCount, 1);
    assert.doesNotMatch(JSON.stringify(result.body), /bad audio|InvalidParameter/);
  });
});

test('assessment rejects a polyphonic judgment with an invalid reading value', async () => {
  await withServerEnvironment((async () => sseResponse([
    '{"recognizedText":"中","status":"correct","confidence":0.99,"acceptedReading":"<script>"}',
  ])) as typeof fetch, async () => {
    const result = await invokeHandler(assessPronunciation, {
      method: 'POST',
      body: { target: '中', mimeType: 'audio/wav', audioBase64: VALID_AUDIO_BASE64 },
    });

    assert.deepEqual(result, {
      status: 502,
      body: { error: '发音评估结果无效' },
    });
  });
});

test('assessment rejects non-strict direct decision objects', async () => {
  for (const judgment of [
    '{"status":"correct","acceptedReading":"zhōng"}',
    '{"recognizedText":"中","status":"correct","acceptedReading":"zhōng"}',
    '{"recognizedText":"中","status":"correct","confidence":0.99,"acceptedReading":"zhōng","extra":true}',
  ]) {
    await withServerEnvironment((async () => sseResponse([judgment])) as typeof fetch, async () => {
      const result = await invokeHandler(assessPronunciation, {
        method: 'POST',
        body: {
          target: '中',
          mimeType: 'audio/wav',
          audioBase64: VALID_AUDIO_BASE64,
        },
      });

      assert.deepEqual(result, {
        status: 502,
        body: { error: '发音评估结果无效' },
      });
    });
  }
});

test('TTS model is pinned in code and not configurable in active docs', () => {
  const legacyOverrideName = ['QWEN', 'TTS', 'MODEL'].join('_');
  const paths = [
    new URL('../api/synthesize-pronunciation.ts', import.meta.url),
    new URL('../.env.example', import.meta.url),
    new URL('../README.md', import.meta.url),
  ];

  for (const path of paths) {
    assert.equal(readFileSync(path, 'utf8').includes(legacyOverrideName), false);
  }
});

test('helper-word generation uses qwen-turbo and returns three sanitized examples', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;

  await withServerEnvironment((async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return jsonResponse({
      choices: [{
        message: {
          content: '```json\n{"examples":["中国","中国","中午","中a","中间"]}\n```',
        },
      }],
    });
  }) as typeof fetch, async () => {
    const result = await invokeHandler(generatePronunciationExamples, {
      method: 'POST',
      body: { character: '中' },
    });

    assert.deepEqual(result, {
      status: 200,
      body: { examples: ['中国', '中午', '中间'] },
    });
    assert.equal(
      requestUrl,
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    );
    const upstreamBody = JSON.parse(String(requestInit?.body));
    assert.equal(upstreamBody.model, 'qwen-turbo');
    assert.match(upstreamBody.messages[0].content, /恰好三个/);
    assert.match(upstreamBody.messages[0].content, /2\s*到\s*4/);
    assert.match(upstreamBody.messages[0].content, /儿童/);
  });
});

test('helper-word generation returns 502 unless exactly three valid examples remain', async () => {
  await withServerEnvironment((async () => jsonResponse({
    choices: [{
      message: {
        content: '{"examples":["中国","中国","abc","无关"]}',
      },
    }],
  })) as typeof fetch, async () => {
    const result = await invokeHandler(generatePronunciationExamples, {
      method: 'POST',
      body: { character: '中' },
    });

    assert.equal(result.status, 502);
  });
});

test('synthesis upgrades a documented signed DashScope OSS HTTP URL to HTTPS', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const signedHttpUrl =
    'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav'
    + '?Expires=1766113409&OSSAccessKeyId=test&Signature=abc%2Fdef%3D';
  const signedHttpsUrl =
    'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav'
    + '?Expires=1766113409&OSSAccessKeyId=test&Signature=abc%2Fdef%3D';

  await withServerEnvironment((async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return jsonResponse({
      output: { audio: { url: signedHttpUrl } },
    });
  }) as typeof fetch, async (state) => {
    const result = await invokeHandler(synthesizePronunciation, {
      method: 'POST',
      body: { text: '中国' },
    });

    assert.deepEqual(result, {
      status: 200,
      body: { audioUrl: signedHttpsUrl },
    });
    assert.equal(requestUrl, DASH_SCOPE_MULTIMODAL_URL);
    assert.equal(state.acquireBodies.length, 1);
    assert.deepEqual(Object.keys(state.acquireBodies[0]).sort(), [
      'p_ip_hash',
      'p_operation',
      'p_owner',
    ]);
    assert.equal(state.acquireBodies[0].p_operation, 'synthesis');
    const upstreamBody = JSON.parse(String(requestInit?.body));
    assert.deepEqual(upstreamBody, {
      model: 'qwen3-tts-instruct-flash',
      input: {
        text: '中国',
        voice: 'Cherry',
        language_type: 'Chinese',
        instructions:
          '用标准普通话朗读，发音清晰、自然、亲切，语速适中，适合儿童跟读模仿，不带任何方言口音。',
        optimize_instructions: false,
      },
    });
  });
});

test('synthesis accepts dynamically assigned DashScope OSS result buckets', async () => {
  const trustedHosts = [
    'dashscope-result-wlcb.oss-cn-wulanchabu.aliyuncs.com',
    // 实测线上返回的动态桶名（2026-09），固定白名单曾把它误判为不可信。
    'dashscope-a717.oss-cn-beijing.aliyuncs.com',
  ];

  for (const host of trustedHosts) {
    const signedUrl = `https://${host}/audio.wav`
      + '?Expires=1766116806&OSSAccessKeyId=test&Signature=signed';

    await withServerEnvironment((async () => jsonResponse({
      output: { audio: { url: signedUrl } },
    })) as typeof fetch, async () => {
      assert.deepEqual(await invokeHandler(synthesizePronunciation, {
        method: 'POST',
        body: { text: '中国' },
      }), {
        status: 200,
        body: { audioUrl: signedUrl },
      }, host);
    });
  }
});

test('synthesis rejects untrusted or malformed result URLs without leaking them', async () => {
  const unsafeUrls = [
    'https://cdn.example.com/pronunciation.wav',
    'http://upstream-secret.example/audio.wav',
    'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.example/audio.wav',
    'https://dashscope-a717.oss-cn-beijing.aliyuncs.com.evil.example/audio.wav',
    'https://evil.oss-cn-beijing.aliyuncs.com/audio.wav',
    'https://notdashscope-a717.oss-cn-beijing.aliyuncs.com/audio.wav',
    'https://dashscopeevil.oss-cn-beijing.aliyuncs.com/audio.wav',
    'https://user:password@dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav',
    'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com:444/audio.wav',
    'ftp://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav',
  ];

  for (const unsafeUrl of unsafeUrls) {
    await withServerEnvironment((async () => jsonResponse({
      output: { audio: { url: unsafeUrl } },
    })) as typeof fetch, async () => {
      const result = await invokeHandler(synthesizePronunciation, {
        method: 'POST',
        body: { text: '中国' },
      });

      assert.equal(result.status, 502, unsafeUrl);
      assert.doesNotMatch(JSON.stringify(result.body), /upstream-secret|password/, unsafeUrl);
    });
  }
});

test('handlers reject non-POST requests before calling upstream', async () => {
  let fetchCalled = false;
  await withServerEnvironment((async () => {
    fetchCalled = true;
    return jsonResponse({});
  }) as typeof fetch, async () => {
    for (const handler of [
      assessPronunciation,
      generatePronunciationExamples,
      synthesizePronunciation,
    ]) {
      assert.deepEqual(await invokeHandler(handler, { method: 'GET' }), {
        status: 405,
        body: { error: '仅支持 POST' },
      });
    }
  });
  assert.equal(fetchCalled, false);
});

test('all paid pronunciation handlers reject missing authentication before upstream calls', async () => {
  let fetchCalled = false;
  await withServerEnvironment((async () => {
    fetchCalled = true;
    return jsonResponse({});
  }) as typeof fetch, async () => {
    for (const handler of [
      assessPronunciation,
      generatePronunciationExamples,
      synthesizePronunciation,
    ]) {
      const result = await invokeHandler(handler, {
        method: 'POST',
        headers: {},
        body: {
          target: '中',
          character: '中',
          text: '中',
          mimeType: 'audio/wav',
          audioBase64: VALID_AUDIO_BASE64,
        },
      });
      assert.equal(result.status, 401);
      assert.deepEqual(result.body, { error: '请先登录后使用语音服务' });
    }
  });
  assert.equal(fetchCalled, false);
});
