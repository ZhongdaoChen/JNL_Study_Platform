# Comma-separated Learning Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change learning input so English and Chinese entries are split only by English comma `,` or Chinese comma `，`, allowing words, phrases, and short text chunks to be recorded as one review item.

**Architecture:** Keep entry splitting in `src/lib/tokenizer.ts` so the learning preview and `wordService.addLearning(...)` fallback stay consistent. Add a small pure preview helper for `LearnInput.tsx` so the empty-comma edge case can be tested without adding React test tooling. Remove English capitalization from repository read mapping so newly stored phrases display exactly as the user entered them.

**Tech Stack:** React 19, TypeScript, Vite, Node built-in test runner with `--experimental-strip-types`, existing ESLint and build scripts.

## Global Constraints

- No new dependencies.
- English and Chinese learning input both use comma-separated entries.
- Both English comma `,` and Chinese comma `，` split entries.
- Spaces inside an entry are preserved.
- User casing and punctuation inside entries are preserved.
- Each split entry is trimmed at the beginning and end.
- Empty comma segments are ignored.
- Exact duplicate entries in the same input are shown once.
- Existing learned data is not migrated.
- Do not change SM-2 scheduling, review queues, retry behavior, AI example generation, settings, Supabase schema, or repository interfaces.

---

## File Structure

- Create `tests/tokenizer.test.ts`: Node tests for comma-separated tokenization, Chinese comma support, mixed comma support, empty segments, exact duplicate removal, and casing/internal-space preservation.
- Modify `src/lib/tokenizer.ts`: replace whitespace/character tokenization with comma-separated entry tokenization while keeping the existing `tokenize(...)`, `tokenizeZh(...)`, and `tokenizeByLang(...)` exports.
- Modify `src/lib/localRepo.ts`: stop capitalizing English `Word.text` on read so stored entries display unchanged.
- Modify `src/lib/supabaseRepo.ts`: stop capitalizing English `Word.text` on read so cloud entries display unchanged.
- Modify `src/lib/types.ts`: update comments so `Word.text` and `Lang` no longer claim English is always a single normalized word or Chinese is always a single character.
- Create `src/components/learnInputPreview.ts`: pure preview helper that returns comma-separated entries and a clear no-entry error string.
- Create `tests/learnInputPreview.test.ts`: Node tests for the no-entry preview error and normal preview behavior.
- Modify `src/components/LearnInput.tsx`: use `buildLearningPreview(...)`, update input hints to mention comma-separated words or phrases, and render the no-entry message while keeping save disabled.
- Modify `README.md`: update feature and core-directory descriptions to document comma-separated entry input.
- Modify `PROJECT_STATUS.md`: update project context lines that describe learning granularity and tokenizer behavior.

---

### Task 1: Comma-separated tokenizer and casing preservation

**Files:**
- Create: `tests/tokenizer.test.ts`
- Modify: `src/lib/tokenizer.ts`
- Modify: `src/lib/localRepo.ts`
- Modify: `src/lib/supabaseRepo.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Consumes: existing imports of `tokenizeByLang(text: string, lang: 'en' | 'zh'): string[]` from `LearnInput.tsx` and `wordService.ts`.
- Produces:
  ```ts
  export function tokenizeEntries(text: string): string[]
  export function tokenize(sentence: string): string[]
  export function tokenizeZh(sentence: string): string[]
  export function tokenizeByLang(text: string, _lang: 'en' | 'zh'): string[]
  ```

- [ ] **Step 1: Write failing tokenizer tests**

Create `tests/tokenizer.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run tokenizer tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test tests/tokenizer.test.ts
```

Expected: FAIL. At least the first test should show actual English output split by spaces, such as `['Come', 'On', 'Good', 'Morning']`, instead of `['come on', 'good morning']`.

- [ ] **Step 3: Replace tokenizer implementation**

Replace all contents of `src/lib/tokenizer.ts` with:

```ts
// 拆分引擎：把录入内容拆成规范化的学习条目列表。
//
// 录入页支持单词、词组或中文短内容。英文和中文统一按英文逗号/中文逗号拆分；
// 逗号之间的内容作为一个条目保存，内部空格、大小写和标点保持用户输入原样。

const ENTRY_SEPARATOR_RE = /[,，]/;

export function tokenizeEntries(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawEntry of text.split(ENTRY_SEPARATOR_RE)) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }

  return result;
}

// 英文：按逗号拆分条目，允许单词、词组和短句作为一个复习单位。
export function tokenize(sentence: string): string[] {
  return tokenizeEntries(sentence);
}

// 中文：按逗号拆分条目，允许词语或短句作为一个复习单位。
export function tokenizeZh(sentence: string): string[] {
  return tokenizeEntries(sentence);
}

// 按语言选择拆分器。当前两种语言共享逗号拆分规则，保留 lang 参数以维持调用接口稳定。
export function tokenizeByLang(text: string, _lang: 'en' | 'zh'): string[] {
  return tokenizeEntries(text);
}
```

- [ ] **Step 4: Preserve stored text in LocalRepo**

In `src/lib/localRepo.ts`, delete this import:

```ts
import { capitalizeWord } from './tokenizer';
```

In `getWords(...)`, replace:

```ts
        text: (w.lang ?? 'en') === 'en' ? capitalizeWord(w.text) : w.text,
```

with:

```ts
        text: w.text,
```

- [ ] **Step 5: Preserve stored text in SupabaseRepo**

In `src/lib/supabaseRepo.ts`, delete this import:

```ts
import { capitalizeWord } from './tokenizer';
```

In `rowToWord(...)`, replace:

```ts
    text: (r.lang ?? 'en') === 'en' ? capitalizeWord(r.text) : r.text,
```

with:

```ts
    text: r.text,
```

- [ ] **Step 6: Update type comments**

In `src/lib/types.ts`, replace:

```ts
// 学习语言：英文单词 / 中文单字。两类分开记录、分开复习。
```

with:

```ts
// 学习语言：英文 / 中文。两类分开记录、分开复习。
```

Replace:

```ts
// 去重后的单词，附带 SM-2 记忆状态
```

with:

```ts
// 去重后的学习条目，附带 SM-2 记忆状态
```

Replace:

```ts
  text: string; // 英文：规范化后的小写词；中文：单个汉字
```

with:

```ts
  text: string; // 用户录入并经逗号拆分后的条目，保留大小写与内部空格
```

Replace:

```ts
  // 学习语言。en=英文单词，zh=中文单字。决定拆分方式与复习分组。
```

with:

```ts
  // 学习语言。en=英文条目，zh=中文条目。决定复习分组。
```

- [ ] **Step 7: Run tokenizer tests to verify they pass**

Run:

```bash
node --experimental-strip-types --test tests/tokenizer.test.ts
```

Expected: PASS with all 7 tokenizer tests passing.

- [ ] **Step 8: Run build to verify TypeScript and bundling**

Run:

```bash
npm run build
```

Expected: PASS. The TypeScript step must not report unused imports from `capitalizeWord`.

- [ ] **Step 9: Commit tokenizer changes**

Run:

```bash
git add tests/tokenizer.test.ts src/lib/tokenizer.ts src/lib/localRepo.ts src/lib/supabaseRepo.ts src/lib/types.ts
git commit -m "feat: support comma-separated learning entries" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Learning input preview message and copy

**Files:**
- Create: `src/components/learnInputPreview.ts`
- Create: `tests/learnInputPreview.test.ts`
- Modify: `src/components/LearnInput.tsx`

**Interfaces:**
- Consumes:
  ```ts
  export function tokenizeByLang(text: string, _lang: 'en' | 'zh'): string[]
  ```
- Produces:
  ```ts
  export interface LearningPreview {
    entries: string[];
    error: string | null;
  }

  export function buildLearningPreview(text: string, lang: Lang): LearningPreview
  ```

- [ ] **Step 1: Write failing preview helper tests**

Create `tests/learnInputPreview.test.ts` with:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLearningPreview } from '../src/components/learnInputPreview.ts';

test('preview helper returns entries for comma-separated english phrases', () => {
  assert.deepEqual(
    buildLearningPreview('come on, good morning', 'en'),
    {
      entries: ['come on', 'good morning'],
      error: null,
    },
  );
});

test('preview helper returns entries for comma-separated chinese content', () => {
  assert.deepEqual(
    buildLearningPreview('小猫，在床上睡觉', 'zh'),
    {
      entries: ['小猫', '在床上睡觉'],
      error: null,
    },
  );
});

test('preview helper reports no recognizable content for comma-only input', () => {
  assert.deepEqual(
    buildLearningPreview(' , ， ,, ', 'en'),
    {
      entries: [],
      error: '没有可识别的内容。请用逗号分隔要录入的内容。',
    },
  );
});

test('preview helper does not show an error for blank input', () => {
  assert.deepEqual(
    buildLearningPreview('   ', 'zh'),
    {
      entries: [],
      error: null,
    },
  );
});
```

- [ ] **Step 2: Run preview tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test tests/learnInputPreview.test.ts
```

Expected: FAIL with an import error because `src/components/learnInputPreview.ts` does not exist.

- [ ] **Step 3: Add preview helper**

Create `src/components/learnInputPreview.ts` with:

```ts
import type { Lang } from '../lib/types';
import { tokenizeByLang } from '../lib/tokenizer';

export interface LearningPreview {
  entries: string[];
  error: string | null;
}

export function buildLearningPreview(text: string, lang: Lang): LearningPreview {
  const trimmed = text.trim();
  if (!trimmed) {
    return { entries: [], error: null };
  }

  const entries = tokenizeByLang(trimmed, lang);
  return {
    entries,
    error: entries.length === 0 ? '没有可识别的内容。请用逗号分隔要录入的内容。' : null,
  };
}
```

- [ ] **Step 4: Run preview tests to verify helper passes**

Run:

```bash
node --experimental-strip-types --test tests/learnInputPreview.test.ts
```

Expected: PASS with all 4 preview helper tests passing.

- [ ] **Step 5: Import the preview helper in LearnInput**

In `src/components/LearnInput.tsx`, replace:

```ts
import { tokenizeByLang } from '../lib/tokenizer';
```

with:

```ts
import { buildLearningPreview } from './learnInputPreview';
```

- [ ] **Step 6: Add preview error state**

In `src/components/LearnInput.tsx`, after:

```ts
  const [previewWords, setPreviewWords] = useState<string[] | null>(null);
```

add:

```ts
  const [previewError, setPreviewError] = useState<string | null>(null);
```

- [ ] **Step 7: Clear preview errors with draft resets**

In `resetDraft(...)`, replace:

```ts
    setPreviewWords(null);
    setResult(null);
```

with:

```ts
    setPreviewWords(null);
    setPreviewError(null);
    setResult(null);
```

- [ ] **Step 8: Use comma-separated preview helper**

Replace `handlePreview()` in `src/components/LearnInput.tsx` with:

```ts
  function handlePreview() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const preview = buildLearningPreview(trimmed, lang);
    setResult(null);
    setPreviewError(preview.error);
    setPreviewWords(preview.entries.length > 0 ? preview.entries : null);
  }
```

- [ ] **Step 9: Clear preview errors after successful save**

In `handleConfirm()`, replace:

```ts
      setPreviewWords(null);
      setText('');
```

with:

```ts
      setPreviewWords(null);
      setPreviewError(null);
      setText('');
```

- [ ] **Step 10: Clear preview errors while typing**

In the `textarea` `onChange` handler, replace:

```ts
            setPreviewWords(null);
            setResult(null);
```

with:

```ts
            setPreviewWords(null);
            setPreviewError(null);
            setResult(null);
```

- [ ] **Step 11: Update learning input hints**

In the hint paragraph, replace:

```tsx
        {lang === 'zh'
          ? '输入一句中文，应用会自动拆成单个汉字并开始跟踪记忆。'
          : '输入一句英文，应用会自动拆成单词并开始跟踪记忆。'}
```

with:

```tsx
        {lang === 'zh'
          ? '输入要学习的中文词语或短句，用逗号分隔；每一段会作为一个复习条目。'
          : '输入要学习的英文单词或词组，用逗号分隔；每一段会作为一个复习条目。'}
```

- [ ] **Step 12: Update textarea placeholders**

In the textarea `placeholder`, replace:

```tsx
          lang === 'zh' ? '例如：小猫在床上睡觉。' : '例如：The cat is sleeping on the bed.'
```

with:

```tsx
          lang === 'zh' ? '例如：小猫，在床上睡觉，晚安' : '例如：come on, good morning, take care'
```

- [ ] **Step 13: Use entry-oriented copy for learning preview**

In `src/components/LearnInput.tsx`, replace:

```ts
  const unit = lang === 'zh' ? '字' : '单词';
```

with:

```ts
  const unit = '条内容';
```

This intentionally updates the learning page copy only. Review, overview, and statistics can keep their existing labels until those surfaces receive a broader terminology pass.

- [ ] **Step 14: Render the no-entry preview error**

Replace the whole preview/result rendering block from `{!previewWords ? (` through the line before `{result && (` with:

```tsx
      {!previewWords ? (
        <button onClick={handlePreview} disabled={busy || !text.trim()}>
          {`先拆${unit}`}
        </button>
      ) : (
        <div className="learn-preview-area">
          <p className="hint">先确认要保留哪些{unit}，点右上角 × 可以删除。</p>
          <div className="learn-preview-grid">
            {previewWords.map((word) => (
              <div key={word} className="learn-preview-card">
                <button
                  type="button"
                  className="learn-preview-remove"
                  onClick={() => removePreviewWord(word)}
                  title={`删除${unit} ${word}`}
                >
                  ×
                </button>
                <span>{word}</span>
              </div>
            ))}
          </div>
          <div className="learn-preview-actions">
            <button className="learn-preview-confirm" onClick={handleConfirm} disabled={busy || previewWords.length === 0}>
              {busy ? '正在写入数据库…' : `确认写入 ${previewWords.length} ${unit}`}
            </button>
          </div>
          {busy && <p className="hint">正在写入数据库，请稍等…</p>}
        </div>
      )}

      {previewError && <p className="example-error">{previewError}</p>}
```

- [ ] **Step 15: Run targeted tests**

Run:

```bash
node --experimental-strip-types --test tests/tokenizer.test.ts tests/learnInputPreview.test.ts
```

Expected: PASS with all tokenizer and preview helper tests passing.

- [ ] **Step 16: Run build**

Run:

```bash
npm run build
```

Expected: PASS. TypeScript must not report an unused `tokenizeByLang` import in `LearnInput.tsx`.

- [ ] **Step 17: Commit learning input UI changes**

Run:

```bash
git add src/components/learnInputPreview.ts tests/learnInputPreview.test.ts src/components/LearnInput.tsx
git commit -m "feat: update learning input preview for comma entries" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Documentation updates and final verification

**Files:**
- Modify: `README.md`
- Modify: `PROJECT_STATUS.md`

**Interfaces:**
- Consumes: comma-separated behavior implemented in Tasks 1 and 2.
- Produces: repository documentation that no longer describes learning input as whitespace word splitting or single-character Chinese splitting.

- [ ] **Step 1: Update README feature description**

In `README.md`, replace:

```md
帮助家长陪孩子学习中英文：每日录入新句子 → 自动拆词 / 拆字 → 基于「儿童版 SM-2」间隔重复算法安排读、拼、写复习，并支持多设备云端同步、AI 例句提示、配置同步与数据共享。
```

with:

```md
帮助家长陪孩子学习中英文：每日录入逗号分隔的单词、词组或中文内容 → 基于「儿童版 SM-2」间隔重复算法安排读、拼、写复习，并支持多设备云端同步、AI 例句提示、配置同步与数据共享。
```

Replace:

```md
1. **录入新内容**：输入英文句子（按词拆分）或中文（按单字拆分），先预览并可删除不需要保留的词 / 字，再写入记忆库；可选学习日期，默认今天。
```

with:

```md
1. **录入新内容**：输入逗号分隔的英文单词 / 词组或中文内容，先预览并可删除不需要保留的条目，再写入记忆库；可选学习日期，默认今天。
```

Replace:

```md
- `src/lib/tokenizer.ts` — 拆词引擎（英文按词 / 中文按单字）
```

with:

```md
- `src/lib/tokenizer.ts` — 录入拆分引擎（英文 / 中文统一按英文逗号或中文逗号拆条目）
```

- [ ] **Step 2: Update PROJECT_STATUS context**

In `PROJECT_STATUS.md`, replace:

```md
- 家长每天录入新学的英文句子或中文句子 → 自动拆成英文单词 / 中文单字 → 跟踪每个词 / 字的记忆
```

with:

```md
- 家长每天录入逗号分隔的英文单词、词组或中文内容 → 跟踪每个学习条目的记忆
```

Replace:

```md
- 跟踪粒度：英文以**单词**为主，中文以**单字**为主，句子作为语境保留
```

with:

```md
- 跟踪粒度：英文 / 中文都以**逗号分隔的学习条目**为主，条目可以是单词、词组、词语或短句；完整录入文本作为语境保留
```

Replace:

```md
       tokenizer.ts   拆词: tokenize(英文按词) / tokenizeZh(中文按单字) / tokenizeByLang
```

with:

```md
       tokenizer.ts   录入拆分: tokenize/tokenizeZh/tokenizeByLang 均按英文逗号或中文逗号拆条目
```

Replace:

```md
- [x] 拆词正则: 只存英文单词, 排除 6/10、纯数字、cat/dog 等
```

with:

```md
- [x] 录入拆分: 英文 / 中文统一按英文逗号或中文逗号拆条目，可保存词组和中文短内容
```

- [ ] **Step 3: Run all Node tests**

Run:

```bash
node --experimental-strip-types --test tests/*.test.ts
```

Expected: PASS. Existing tests in `tests/reviewKeyboard.test.ts` and `tests/aiTimeout.test.ts` must keep passing, along with the new tokenizer and preview tests.

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS with no unused imports or TypeScript ESLint errors.

- [ ] **Step 5: Run production build**

Run:

```bash
npm run build
```

Expected: PASS with `tsc -b` and `vite build` completing successfully.

- [ ] **Step 6: Inspect final diff**

Run:

```bash
git --no-pager diff --stat
git --no-pager diff -- src/lib/tokenizer.ts src/components/LearnInput.tsx src/components/learnInputPreview.ts README.md PROJECT_STATUS.md
```

Expected: Diff only touches the planned tokenizer, repository text preservation, learning input preview, tests, and documentation files. There must be no Supabase schema changes and no SM-2 logic changes.

- [ ] **Step 7: Commit documentation and verification changes**

Run:

```bash
git add README.md PROJECT_STATUS.md
git commit -m "docs: update learning input comma behavior" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Plan Self-Review

- Spec coverage: Task 1 implements comma and Chinese comma splitting, preserves internal spaces and casing, ignores empty segments, deduplicates exact entries, keeps `tokenizeByLang(...)` as the shared UI/service path, and prevents repository reads from re-capitalizing stored English entries. Task 2 implements the clear no-entry learning preview message and updates learning-page copy. Task 3 updates directly related documentation and runs final verification.
- Placeholder scan: This plan contains exact file paths, commands, expected outcomes, and code snippets for each implementation step.
- Type consistency: `buildLearningPreview(text: string, lang: Lang): LearningPreview` consumes the existing `Lang` type and `tokenizeByLang(...)` signature. `tokenizeByLang(text: string, _lang: 'en' | 'zh'): string[]` preserves the existing call sites in `LearnInput.tsx` and `wordService.ts`.
