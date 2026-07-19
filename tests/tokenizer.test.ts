import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, tokenizeByLang, tokenizeZh } from '../src/lib/tokenizer.ts';

test('english learning input splits only on commas', () => {
  assert.deepEqual(
    tokenizeByLang('come on,good morning', 'en'),
    ['come on', 'good morning'],
  );
});

test('spaces inside entries are preserved', () => {
  assert.deepEqual(
    tokenize('Come  On,Good Morning'),
    ['Come  On', 'Good Morning'],
  );
});

test('chinese learning input splits on chinese comma instead of characters', () => {
  assert.deepEqual(
    tokenizeByLang('小猫，在床上睡觉', 'zh'),
    ['小猫', '在床上睡觉'],
  );
});

test('mixed comma styles split entries in one input', () => {
  assert.deepEqual(
    tokenizeZh('小猫,在床上睡觉，晚安'),
    ['小猫', '在床上睡觉', '晚安'],
  );
});

test('empty comma segments are ignored', () => {
  assert.deepEqual(
    tokenizeByLang('come on,,  ，good morning，', 'en'),
    ['come on', 'good morning'],
  );
});

test('exact duplicate entries are deduplicated after trimming', () => {
  assert.deepEqual(
    tokenizeByLang('come on, come on, Come on', 'en'),
    ['come on', 'Come on'],
  );
});

test('input with only commas produces no entries', () => {
  assert.deepEqual(tokenizeByLang(' , ， ,, ', 'zh'), []);
});
