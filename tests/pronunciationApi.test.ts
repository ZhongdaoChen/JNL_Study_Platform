import test from 'node:test';
import assert from 'node:assert/strict';
import {
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

test('assessment sends target, mimeType, and base64 audio', async () => {
  const audio = new Blob([new Uint8Array([1])], { type: 'audio/webm' });
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const restore = withMockedFetch((async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return jsonResponse({
      correct: true,
      recognizedText: '中',
      acceptedReading: null,
    });
  }) as typeof fetch);

  try {
    const result = await assessPronunciation('中', audio);
    assert.deepEqual(result, {
      correct: true,
      recognizedText: '中',
      acceptedReading: null,
    });
    assert.equal(requestUrl, '/api/assess-pronunciation');
    assert.equal(requestInit?.method, 'POST');
    assert.equal(
      (requestInit?.headers as Record<string, string>)['Content-Type'],
      'application/json',
    );
    assert.equal(
      requestInit?.body,
      JSON.stringify({
        target: '中',
        mimeType: 'audio/webm',
        audioBase64: 'AQ==',
      }),
    );
  } finally {
    restore();
  }
});

test('malformed assessment JSON throws 语音识别结果无效', async () => {
  const audio = new Blob([new Uint8Array([1])], { type: 'audio/webm' });
  const restore = withMockedFetch((async () => jsonResponse({ correct: 'yes' })) as typeof fetch);

  try {
    await assert.rejects(
      () => assessPronunciation('中', audio),
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
    const result = await generatePronunciationExamples('中');
    assert.deepEqual(result, ['中国', '中午', '中心']);
  } finally {
    restore();
  }
});

test('synthesis requires a non-empty audioUrl', async () => {
  const restore = withMockedFetch((async () => jsonResponse({ audioUrl: '  ' })) as typeof fetch);

  try {
    await assert.rejects(
      () => synthesizePronunciation('中国'),
      /语音合成结果无效/,
    );
  } finally {
    restore();
  }
});

test('a hanging assessment request rejects with the assessment timeout message', { timeout: 100 }, async () => {
  const restore = withMockedFetch((() => new Promise(() => {})) as typeof fetch);

  try {
    await assert.rejects(
      () => assessPronunciation('中', new Blob([new Uint8Array([1])], { type: 'audio/webm' }), { timeoutMs: 10 }),
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
      () => assessPronunciation('中', new Blob([new Uint8Array([1])], { type: 'audio/webm' }), { timeoutMs: 10 }),
      /发音评估超时，请稍后重试/,
    );
  } finally {
    restore();
  }
});
