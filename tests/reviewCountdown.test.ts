import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countdownSecForWord,
  entryWordCount,
  PHRASE_MIN_WORDS,
} from '../src/lib/reviewCountdown.ts';

test('single word and two-word entries keep the configured countdown', () => {
  assert.equal(countdownSecForWord(10, 'cat'), 10);
  assert.equal(countdownSecForWord(10, 'ice cream'), 10);
});

test('phrase with three or more words doubles the countdown', () => {
  assert.equal(countdownSecForWord(10, 'setting it up'), 20);
  assert.equal(countdownSecForWord(10, 'once upon a time'), 20);
  assert.equal(countdownSecForWord(15, 'a b c'), 30);
});

test('countdown disabled stays disabled for phrases', () => {
  assert.equal(countdownSecForWord(0, 'setting it up'), 0);
});

test('word count ignores leading, trailing and repeated whitespace', () => {
  assert.equal(entryWordCount('  setting   it up  '), 3);
  assert.equal(entryWordCount('cat'), 1);
  assert.equal(entryWordCount(''), 0);
});

test('chinese single-character entries count as one word', () => {
  assert.equal(entryWordCount('猫'), 1);
  assert.equal(countdownSecForWord(10, '猫'), 10);
});

test('phrase threshold is three words', () => {
  assert.equal(PHRASE_MIN_WORDS, 3);
});
