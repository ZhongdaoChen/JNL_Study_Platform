import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRONUNCIATION_REQUEST_TIMEOUTS,
  assessPronunciation,
  generatePronunciationExamples,
  synthesizePronunciation,
} from '../src/lib/pronunciationApi.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withMockedFetch(implementation: typeof fetch) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = implementation;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('assessment timeout allows the two-stage server evaluation to finish', () => {
  assert.equal(PRONUNCIATION_REQUEST_TIMEOUTS.assessment, 30_000);
});

test('assessment sends target, mimeType, and base64 audio', async () => {
  const audioBytes = new Uint8Array(256).fill(1);
  const audio = new Blob([audioBytes], { type: 'audio/webm' });
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const restore = withMockedFetch((async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return jsonResponse({
      correct: true,
      recognizedText: '中',
      acceptedReading: null,
      confidence: 0.98,
    });
  }) as typeof fetch);

  try {
    const result = await assessPronunciation('中', audio, { accessToken: 'session-token' });
    assert.deepEqual(result, {
      correct: true,
      recognizedText: '中',
      acceptedReading: null,
      confidence: 0.98,
    });
    assert.equal(requestUrl, '/api/assess-pronunciation');
    assert.equal(requestInit?.method, 'POST');
    assert.equal(
      (requestInit?.headers as Record<string, string>)['Content-Type'],
      'application/json',
    );
    assert.equal(
      (requestInit?.headers as Record<string, string>).Authorization,
      'Bearer session-token',
    );
    assert.equal(
      requestInit?.body,
      JSON.stringify({
        target: '中',
        mimeType: 'audio/webm',
        audioBase64: Buffer.from(audioBytes).toString('base64'),
      }),
    );
  } finally {
    restore();
  }
});

test('malformed assessment JSON throws 语音识别结果无效', async () => {
  const audio = new Blob([new Uint8Array(256)], { type: 'audio/webm' });
  const restore = withMockedFetch((async () => jsonResponse({ correct: 'yes' })) as typeof fetch);

  try {
    await assert.rejects(
      () => assessPronunciation('中', audio, { accessToken: 'session-token' }),
      /语音识别结果无效/,
    );
  } finally {
    restore();
  }
});

test('example response is sanitized to three values', async () => {
  const restore = withMockedFetch((async () => jsonResponse({
    examples: ['中国', '中国', '中午', '中心', '中', 'abc', '无关'],
  })) as typeof fetch);

  try {
    const result = await generatePronunciationExamples('中', { accessToken: 'session-token' });
    assert.deepEqual(result, ['中国', '中午', '中心']);
  } finally {
    restore();
  }
});

test('synthesis requires a non-empty audioUrl', async () => {
  const restore = withMockedFetch((async () => jsonResponse({ audioUrl: '  ' })) as typeof fetch);

  try {
    await assert.rejects(
      () => synthesizePronunciation('中国', { accessToken: 'session-token' }),
      /语音合成结果无效/,
    );
  } finally {
    restore();
  }
});

test('synthesis forwards cancellation to the active pronunciation request', { timeout: 1_000 }, async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | null = null;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const restore = withMockedFetch(((input, init) => {
    assert.equal(String(input), '/api/synthesize-pronunciation');
    requestSignal = init?.signal ?? null;
    markStarted?.();
    return new Promise((_, reject) => {
      const failsafe = setTimeout(
        () => reject(new Error('test request was not canceled')),
        200,
      );
      requestSignal?.addEventListener('abort', () => {
        clearTimeout(failsafe);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
    });
  }) as typeof fetch);

  try {
    const requestPromise = synthesizePronunciation('中', {
      accessToken: 'session-token',
      signal: controller.signal,
      timeoutMs: 500,
    });
    await started;
    controller.abort();

    await assert.rejects(
      requestPromise,
      (error: unknown) => error instanceof Error && error.name === 'AbortError',
    );
    assert.equal(requestSignal?.aborted, true);
  } finally {
    restore();
  }
});

test('a hanging assessment request rejects with the assessment timeout message', { timeout: 100 }, async () => {
  const restore = withMockedFetch((() => new Promise(() => {})) as typeof fetch);

  try {
    await assert.rejects(
      () => assessPronunciation(
        '中',
        new Blob([new Uint8Array(256)], { type: 'audio/webm' }),
        { timeoutMs: 10, accessToken: 'session-token' },
      ),
      /发音评估超时，请稍后重试/,
    );
  } finally {
    restore();
  }
});

test('assessment returns the timeout message when json hangs until abort', { timeout: 100 }, async () => {
  const restore = withMockedFetch((async (_input, init) => {
    const signal = init?.signal;
    assert.ok(signal instanceof AbortSignal);

    return {
      ok: true,
      json() {
        return new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          );
        });
      },
    } as Response;
  }) as typeof fetch);

  try {
    await assert.rejects(
      () => assessPronunciation(
        '中',
        new Blob([new Uint8Array(256)], { type: 'audio/webm' }),
        { timeoutMs: 10, accessToken: 'session-token' },
      ),
      /发音评估超时，请稍后重试/,
    );
  } finally {
    restore();
  }
});

test('local mode fails explicitly before calling a paid pronunciation endpoint', async () => {
  let fetchCalled = false;
  const restore = withMockedFetch((async () => {
    fetchCalled = true;
    return jsonResponse({});
  }) as typeof fetch);

  try {
    await assert.rejects(
      () => generatePronunciationExamples('中'),
      /语音服务仅在云端登录模式可用/,
    );
    assert.equal(fetchCalled, false);
  } finally {
    restore();
  }
});
