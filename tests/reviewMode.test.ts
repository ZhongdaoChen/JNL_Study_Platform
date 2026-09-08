import test from 'node:test';
import assert from 'node:assert/strict';
import { countdownForReviewMode } from '../src/lib/reviewMode.ts';

test('speech-driven and spelling review modes disable countdown', () => {
  assert.equal(countdownForReviewMode(12, 'en-spell'), 0);
  assert.equal(countdownForReviewMode(12, 'zh-read'), 0);
});

test('remaining review modes keep the configured countdown', () => {
  assert.equal(countdownForReviewMode(12, 'en-read'), 12);
  assert.equal(countdownForReviewMode(12, 'zh-write'), 12);
});
