import test from 'node:test';
import assert from 'node:assert/strict';
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

async function withServerEnvironment(
  fetchImplementation: typeof fetch,
  run: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.QWEN_API_KEY;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const originalRateSecret = process.env.PRONUNCIATION_RATE_LIMIT_SECRET;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === 'https://project.supabase.co/auth/v1/user') {
      return jsonResponse({ id: 'user-1' });
    }
    if (url === 'https://project.supabase.co/rest/v1/rpc/acquire_pronunciation_request') {
      return jsonResponse({
        allowed: true,
        lease_id: '11111111-1111-4111-8111-111111111111',
        retry_after_seconds: 0,
      });
    }
    if (url === 'https://project.supabase.co/rest/v1/rpc/release_pronunciation_request') {
      return jsonResponse(null);
    }
    return fetchImplementation(input, init);
  }) as typeof fetch;
  process.env.QWEN_API_KEY = 'server-test-key';
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.PRONUNCIATION_RATE_LIMIT_SECRET = 'rate-limit-secret';

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = originalApiKey;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = originalSupabaseAnonKey;
    if (originalRateSecret === undefined) delete process.env.PRONUNCIATION_RATE_LIMIT_SECRET;
    else process.env.PRONUNCIATION_RATE_LIMIT_SECRET = originalRateSecret;
  }
}

test('parseJsonObject parses plain and fenced JSON objects', () => {
  assert.deepEqual(parseJsonObject('{"status":"correct"}'), { status: 'correct' });
  assert.deepEqual(
    parseJsonObject('  ```json\n{"examples":["中国","中午","中间"]}\n```  '),
    { examples: ['中国', '中午', '中间'] },
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
      audioBase64: 'AQ==',
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
      validateAudioRequest({ target: ' 中国。 ', mimeType, audioBase64: 'AQ==' }),
      { target: '中国。', mimeType, audioBase64: 'AQ==' },
    );
  }
});

test('browser MIME types map to the documented Qwen Audio ASR format values', () => {
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

test('assessment uses the documented Qwen Audio ASR contract and a bounded polyphonic judgment', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];

  await withServerEnvironment((async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === DASH_SCOPE_MULTIMODAL_URL) {
      return jsonResponse({
        output: {
          sentence: {
            sentence_end: true,
            text: '中',
            words: [{ text: '中', punctuation: '', fixed: true }],
          },
          text: '中',
        },
        usage: { duration: 1 },
        request_id: 'asr-request-id',
      });
    }
    if (url === DASH_SCOPE_CHAT_COMPLETIONS_URL) {
      return jsonResponse({
        choices: [{
          message: {
            content: '{"status":"correct","acceptedReading":"zhòng"}',
          },
        }],
      });
    }
    return jsonResponse({}, 404);
  }) as typeof fetch, async () => {
    const result = await invokeHandler(assessPronunciation, {
      method: 'POST',
      body: { target: '中', mimeType: 'audio/webm', audioBase64: 'AQ==' },
    });

    assert.deepEqual(result, {
      status: 200,
      body: { correct: true, recognizedText: '中', acceptedReading: 'zhòng' },
    });
    assert.equal(requests.length, 2);

    const asrRequest = requests[0];
    assert.equal(asrRequest.url, DASH_SCOPE_MULTIMODAL_URL);
    assert.equal(asrRequest.init?.method, 'POST');
    assert.equal(
      (asrRequest.init?.headers as Record<string, string>).Authorization,
      'Bearer server-test-key',
    );
    assert.equal(
      (asrRequest.init?.headers as Record<string, string>)['X-DashScope-SSE'],
      'disable',
    );
    assert.deepEqual(JSON.parse(String(asrRequest.init?.body)), {
      model: 'qwen-audio-3.0-asr-flash',
      input: {
        messages: [{
          role: 'user',
          content: [{
            type: 'input_audio',
            input_audio: { data: 'data:audio/webm;base64,AQ==' },
          }],
        }],
      },
      parameters: {
        format: 'webm',
        language_hints: ['zh'],
      },
    });

    const judgmentRequest = requests[1];
    assert.equal(judgmentRequest.url, DASH_SCOPE_CHAT_COMPLETIONS_URL);
    const judgmentBody = JSON.parse(String(judgmentRequest.init?.body));
    assert.equal(judgmentBody.model, 'qwen3.8-flash');
    assert.equal(judgmentBody.response_format.type, 'json_schema');
    assert.equal(judgmentBody.response_format.json_schema.strict, true);
    assert.deepEqual(
      judgmentBody.response_format.json_schema.schema.required,
      ['status', 'acceptedReading'],
    );
    assert.equal(
      judgmentBody.response_format.json_schema.schema.additionalProperties,
      false,
    );
    assert.match(judgmentBody.messages[1].content, /"target":"中"/);
    assert.match(judgmentBody.messages[1].content, /"recognizedText":"中"/);
  });
});

test('assessment compares multi-character transcripts without an invented ASR verdict', async () => {
  let fetchCount = 0;
  await withServerEnvironment((async () => {
    fetchCount += 1;
    return jsonResponse({
      output: {
        sentence: { sentence_end: true, text: '中 国。' },
        text: '中 国。',
      },
      usage: { duration: 1 },
      request_id: 'asr-request-id',
    });
  }) as typeof fetch, async () => {
    const result = await invokeHandler(assessPronunciation, {
      method: 'POST',
      body: { target: '中国', mimeType: 'audio/wav', audioBase64: 'AQ==' },
    });

    assert.deepEqual(result, {
      status: 200,
      body: { correct: true, recognizedText: '中 国。', acceptedReading: null },
    });
    assert.equal(fetchCount, 1);
  });
});

test('assessment maps an empty official ASR transcript to 422', async () => {
  await withServerEnvironment((async () => jsonResponse({
    output: {
      sentence: { sentence_end: true, text: '' },
      text: '',
    },
    usage: { duration: 1 },
    request_id: 'asr-request-id',
  })) as typeof fetch, async () => {
    const result = await invokeHandler(assessPronunciation, {
      method: 'POST',
      body: { target: '中国', mimeType: 'audio/wav', audioBase64: 'AQ==' },
    });

    assert.deepEqual(result, {
      status: 422,
      body: { error: '没有听清，请再试一次' },
    });
  });
});

test('assessment maps invalid and failed ASR responses to safe 502 errors', async () => {
  for (const response of [
    jsonResponse({ secret: 'upstream-secret' }, 401),
    jsonResponse({ output: { choices: [] } }),
  ]) {
    await withServerEnvironment((async () => response) as typeof fetch, async () => {
      const result = await invokeHandler(assessPronunciation, {
        method: 'POST',
        body: { target: '中国', mimeType: 'audio/webm', audioBase64: 'AQ==' },
      });

      assert.equal(result.status, 502);
      assert.doesNotMatch(JSON.stringify(result.body), /upstream-secret|server-test-key/);
    });
  }
});

test('assessment rejects a polyphonic judgment with an invalid reading value', async () => {
  await withServerEnvironment((async (input) => {
    if (String(input) === DASH_SCOPE_MULTIMODAL_URL) {
      return jsonResponse({
        output: {
          sentence: { sentence_end: true, text: '中' },
          text: '中',
        },
        usage: { duration: 1 },
        request_id: 'asr-request-id',
      });
    }
    return jsonResponse({
      choices: [{
        message: {
          content: '{"status":"correct","acceptedReading":"<script>"}',
        },
      }],
    });
  }) as typeof fetch, async () => {
    const result = await invokeHandler(assessPronunciation, {
      method: 'POST',
      body: { target: '中', mimeType: 'audio/webm', audioBase64: 'AQ==' },
    });

    assert.deepEqual(result, {
      status: 502,
      body: { error: '发音评估结果无效' },
    });
  });
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

test('synthesis uses default model and voice and returns an HTTPS audio URL', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;

  await withServerEnvironment((async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return jsonResponse({
      output: { audio: { url: 'https://cdn.example.com/pronunciation.wav' } },
    });
  }) as typeof fetch, async () => {
    const result = await invokeHandler(synthesizePronunciation, {
      method: 'POST',
      body: { text: '中国' },
    });

    assert.deepEqual(result, {
      status: 200,
      body: { audioUrl: 'https://cdn.example.com/pronunciation.wav' },
    });
    assert.equal(requestUrl, DASH_SCOPE_MULTIMODAL_URL);
    const upstreamBody = JSON.parse(String(requestInit?.body));
    assert.deepEqual(upstreamBody, {
      model: 'qwen3-tts-flash',
      input: {
        text: '中国',
        voice: 'Cherry',
        language_type: 'Chinese',
      },
    });
  });
});

test('synthesis rejects non-HTTPS upstream URLs without leaking them', async () => {
  await withServerEnvironment((async () => jsonResponse({
    output: { audio: { url: 'http://upstream-secret.example/audio.wav' } },
  })) as typeof fetch, async () => {
    const result = await invokeHandler(synthesizePronunciation, {
      method: 'POST',
      body: { text: '中国' },
    });

    assert.equal(result.status, 502);
    assert.doesNotMatch(JSON.stringify(result.body), /upstream-secret/);
  });
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
        body: { target: '中', character: '中', text: '中', mimeType: 'audio/wav', audioBase64: 'AQ==' },
      });
      assert.equal(result.status, 401);
      assert.deepEqual(result.body, { error: '请先登录后使用语音服务' });
    }
  });
  assert.equal(fetchCalled, false);
});
