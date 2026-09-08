import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gradeForPronunciationAttempt,
  isSingleHanCharacter,
  normalizeRecognizedChinese,
  pronunciationPlaybackItems,
  sanitizePronunciationExamples,
} from '../src/lib/pronunciationRules.ts';

test('detects single Han characters', () => {
  assert.equal(isSingleHanCharacter('中'), true);
  assert.equal(isSingleHanCharacter('中国'), false);
});

test('normalizes recognized Chinese text', () => {
  assert.equal(normalizeRecognizedChinese(' 中 国。 '), '中国');
});

test('grades only first pronunciation attempt', () => {
  assert.equal(gradeForPronunciationAttempt(true, true), 'mastered');
  assert.equal(gradeForPronunciationAttempt(true, false), 'forgotten');
  assert.equal(gradeForPronunciationAttempt(false, true), null);
});

test('sanitizes pronunciation examples', () => {
  assert.deepEqual(
    sanitizePronunciationExamples('中', ['中国', '中午', '中国', '中心', '无关']),
    ['中国', '中午', '中心'],
  );
  assert.deepEqual(
    sanitizePronunciationExamples('中', ['中a', '中。', '中 国', '中午']),
    ['中午'],
  );
});

test('builds pronunciation playback items', () => {
  assert.deepEqual(
    pronunciationPlaybackItems('中', ['中国', '中午', '中间']),
    ['中', '中国', '中午', '中间'],
  );
  assert.deepEqual(pronunciationPlaybackItems('中国', []), ['中国']);
});
