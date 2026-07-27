import test from 'node:test';
import assert from 'node:assert/strict';
import { countdownForReviewMode } from '../src/lib/reviewMode.ts';

test('english spelling review disables countdown', () => {
  assert.equal(countdownForReviewMode(12, 'en-spell'), 0);
});

test('other review modes keep the configured countdown', () => {
  assert.equal(countdownForReviewMode(12, 'en-read'), 12);
  assert.equal(countdownForReviewMode(12, 'zh-read'), 12);
  assert.equal(countdownForReviewMode(12, 'zh-write'), 12);
});
