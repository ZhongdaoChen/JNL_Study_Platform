import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DASH_SCOPE_MULTIMODAL_URL,
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
}

interface HandlerResponse {
  status(code: number): HandlerResponse;
  json(body: unknown): void;
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
  };
  await handler(req, res);
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
  globalThis.fetch = fetchImplementation;
  process.env.QWEN_API_KEY = 'server-test-key';

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = originalApiKey;
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

test('assessment sends the exact multimodal request and maps correct output', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;

  await withServerEnvironment((async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return jsonResponse({
      output: {
        choices: [{
          message: {
            content: [{
              text: '```json\n{"status":"correct","recognizedText":"中","acceptedReading":"zhòng"}\n```',
            }],
          },
        }],
      },
    });
  }) as typeof fetch, async () => {
    const result = await invokeHandler(assessPronunciation, {
      method: 'POST',
      body: { target: '中', mimeType: 'audio/webm', audioBase64: 'AQ==' },
    });

    assert.deepEqual(result, {
      status: 200,
      body: { correct: true, recognizedText: '中', acceptedReading: 'zhòng' },
    });
    assert.equal(requestUrl, DASH_SCOPE_MULTIMODAL_URL);
    assert.equal(requestInit?.method, 'POST');
    assert.equal(
      (requestInit?.headers as Record<string, string>).Authorization,
      'Bearer server-test-key',
    );

    const upstreamBody = JSON.parse(String(requestInit?.body));
    assert.equal(upstreamBody.model, 'qwen-omni-turbo');
    assert.deepEqual(upstreamBody.parameters, { result_format: 'message' });
    assert.deepEqual(
      upstreamBody.input.messages[0].content[0],
      { audio: 'data:audio/webm;base64,AQ==' },
    );
    assert.match(
      upstreamBody.input.messages[0].content[1].text,
      /单个多音字.*任何常见读音/s,
    );
    assert.match(
      upstreamBody.input.messages[0].content[1].text,
      /多字目标.*完整.*标准化/s,
    );
    assert.match(upstreamBody.input.messages[0].content[1].text, /JSON/);
  });
});

test('assessment maps unclear output with no recognized text to 422', async () => {
  await withServerEnvironment((async () => jsonResponse({
    output: {
      choices: [{
        message: {
          content: [{
            text: '{"status":"unclear","recognizedText":"","acceptedReading":null}',
          }],
        },
      }],
    },
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

test('assessment maps invalid and failed upstream responses to safe 502 errors', async () => {
  for (const response of [
    jsonResponse({ secret: 'upstream-secret' }, 401),
    jsonResponse({
      output: {
        choices: [{
          message: {
            content: [{ text: '{"status":"maybe","recognizedText":"","acceptedReading":null}' }],
          },
        }],
      },
    }),
  ]) {
    await withServerEnvironment((async () => response) as typeof fetch, async () => {
      const result = await invokeHandler(assessPronunciation, {
        method: 'POST',
        body: { target: '中', mimeType: 'audio/webm', audioBase64: 'AQ==' },
      });

      assert.equal(result.status, 502);
      assert.doesNotMatch(JSON.stringify(result.body), /upstream-secret|server-test-key|maybe/);
    });
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
