import test from 'node:test';
import assert from 'node:assert/strict';
import { generateExampleSentence } from '../src/lib/ai.ts';

test('generateExampleSentence rejects when the sentence API does not return', { timeout: 100 }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;

  try {
    await assert.rejects(
      () => generateExampleSentence('cat', 'en', { timeoutMs: 10 }),
      /例句生成超时/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
