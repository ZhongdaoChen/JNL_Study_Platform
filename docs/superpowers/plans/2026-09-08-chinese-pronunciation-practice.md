# Chinese Pronunciation Practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-platform microphone-based pronunciation assessment to Chinese reading review, with first-attempt automatic grading, three persistent helper words for single characters, correct-pronunciation playback, and a child-friendly success animation.

**Architecture:** Keep browser recording and playback behind focused frontend modules, keep review scheduling inside `ReviewSession`, and place all DashScope calls behind Vercel serverless endpoints. Persist only the three helper words on `Word`; recordings and synthesized audio remain ephemeral.

**Tech Stack:** React 19, TypeScript 6, Vite 8, MediaRecorder, Web Audio API, Vercel Serverless Functions, Supabase Postgres, DashScope `qwen-omni-turbo`, `qwen-turbo`, and `qwen3-tts-flash`, Node built-in test runner.

## Global Constraints

- No application-level permission confirmation dialog; the browser's first `getUserMedia` permission prompt is unavoidable.
- Reuse one authorized `MediaStream` for the mounted Chinese-reading session and release it on unmount.
- Support manual stop, 800ms post-speech silence stop, and a 6-second hard limit.
- Only the first microphone attempt for a word can submit a grade.
- First-attempt correct submits `mastered` after a 1.2-second success animation and advances.
- First-attempt incorrect submits `forgotten` immediately without advancing.
- Retry attempts never submit another grade.
- Chinese reading has no countdown; all other review-mode countdown behavior remains unchanged.
- Single Chinese characters show three persisted helper words; multi-character entries do not.
- Audio is never stored in localStorage, Supabase, or logs.
- Technical failures never submit a review grade.
- No animation library or speech SDK dependency; use browser APIs and `fetch`.

---

## File Structure

- Modify `src/lib/reviewMode.ts`, `tests/reviewMode.test.ts`: disable countdown for Chinese reading.
- Modify `src/lib/types.ts`, `src/lib/wordService.ts`, `src/lib/localRepo.ts`, `src/lib/supabaseRepo.ts`, `supabase/schema.sql`, and related tests: persist `pronunciationExamples`.
- Create `src/lib/pronunciationRules.ts`, `tests/pronunciationRules.test.ts`: pure text, example, grading, and playback policies.
- Create `src/lib/pronunciationApi.ts`, `tests/pronunciationApi.test.ts`: frontend API contracts, timeout handling, and audio conversion.
- Create `api/pronunciationShared.ts`, `api/assess-pronunciation.ts`, `api/generate-pronunciation-examples.ts`, `api/synthesize-pronunciation.ts`, and `tests/pronunciationApiHandlers.test.ts`: validated DashScope adapters.
- Create `src/lib/speechRecorder.ts`, `tests/speechRecorder.test.ts`: reusable microphone session and silence detection.
- Create `src/components/PronunciationPractice.tsx`, `src/components/pronunciationSession.ts`, `tests/pronunciationSession.test.ts`: UI state and first-attempt grading lock.
- Modify `src/components/ReviewSession.tsx`, `src/App.css`, `README.md`, `.env.example`, and `src/lib/changelog.ts`: integrate and document the feature.

---

### Task 1: Disable Countdown for Chinese Reading

**Files:**
- Modify: `tests/reviewMode.test.ts`
- Modify: `src/lib/reviewMode.ts`

**Interfaces:**
- Consumes: `countdownForReviewMode(configuredCountdownSec, reviewMode)`.
- Produces: `0` for `en-spell` and `zh-read`; configured seconds for `en-read` and `zh-write`.

- [ ] **Step 1: Change the tests first**

Replace the two tests with:

```ts
test('speech-driven and spelling review modes disable countdown', () => {
  assert.equal(countdownForReviewMode(12, 'en-spell'), 0);
  assert.equal(countdownForReviewMode(12, 'zh-read'), 0);
});

test('remaining review modes keep the configured countdown', () => {
  assert.equal(countdownForReviewMode(12, 'en-read'), 12);
  assert.equal(countdownForReviewMode(12, 'zh-write'), 12);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --experimental-strip-types --test tests/reviewMode.test.ts
```

Expected: FAIL because `zh-read` still returns `12`.

- [ ] **Step 3: Implement the mode rule**

Replace the function body with:

```ts
export function countdownForReviewMode(configuredCountdownSec: number, reviewMode: ReviewMode) {
  return reviewMode === 'en-spell' || reviewMode === 'zh-read'
    ? 0
    : configuredCountdownSec;
}
```

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
node --experimental-strip-types --test tests/reviewMode.test.ts
git add src/lib/reviewMode.ts tests/reviewMode.test.ts
git commit -m "feat: disable countdown for Chinese reading" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: 2 tests pass.

---

### Task 2: Persist Three Pronunciation Helper Words

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/wordService.ts`
- Modify: `src/lib/localRepo.ts`
- Modify: `src/lib/supabaseRepo.ts`
- Modify: `supabase/schema.sql`
- Modify: `tests/supabaseRepo.test.ts`
- Modify: `tests/wordService.test.ts`
- Modify: `tests/reviewQueue.test.ts`

**Interfaces:**
- Produces: `Word.pronunciationExamples: string[]`.
- Storage: `words.pronunciation_examples text[] not null default '{}'`.

- [ ] **Step 1: Add failing repository compatibility tests**

Add `pronunciation_examples: ['中国', '中午', '中间']` to one fake Supabase row and assert:

```ts
assert.deepEqual(result[0].pronunciationExamples, ['中国', '中午', '中间']);
```

Add a second assertion for a row without the column:

```ts
assert.deepEqual(result[1].pronunciationExamples, []);
```

Run:

```bash
node --experimental-strip-types --test tests/supabaseRepo.test.ts
```

Expected: FAIL because `rowToWord` does not map the field.

- [ ] **Step 2: Add the application field and defaults**

In `Word`, immediately after `exampleSentence`, add:

```ts
pronunciationExamples: string[];
```

In new-word construction in `wordService.ts`, add:

```ts
pronunciationExamples: [],
```

In `LocalRepo.getWords`, add the old-data fallback:

```ts
pronunciationExamples: w.pronunciationExamples ?? [],
```

Add `pronunciationExamples: []` to every `Word` test fixture in `tests/wordService.test.ts` and `tests/reviewQueue.test.ts`.

- [ ] **Step 3: Map the Supabase column**

In `rowToWord` add:

```ts
pronunciationExamples: Array.isArray(r.pronunciation_examples)
  ? r.pronunciation_examples.filter((item: unknown): item is string => typeof item === 'string')
  : [],
```

In `upsertWord` add:

```ts
pronunciation_examples: word.pronunciationExamples,
```

- [ ] **Step 4: Add the idempotent schema migration**

Add the column to the create-table definition and compatibility block:

```sql
pronunciation_examples text[] not null default '{}',
```

```sql
alter table words
  add column if not exists pronunciation_examples text[] not null default '{}';
```

Update the data-sharing RPC insert column/value lists with:

```sql
pronunciation_examples
```

and:

```sql
src_word.pronunciation_examples
```

Update the merge branch with:

```sql
pronunciation_examples =
  case
    when cardinality(existing_word.pronunciation_examples) > 0
      then existing_word.pronunciation_examples
    else src_word.pronunciation_examples
  end,
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --experimental-strip-types --test tests/supabaseRepo.test.ts tests/wordService.test.ts tests/reviewQueue.test.ts
npm run build
git add src/lib/types.ts src/lib/wordService.ts src/lib/localRepo.ts src/lib/supabaseRepo.ts supabase/schema.sql tests/supabaseRepo.test.ts tests/wordService.test.ts tests/reviewQueue.test.ts
git commit -m "feat: persist pronunciation helper words" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: tests and build pass.

---

### Task 3: Add Pure Pronunciation Policies

**Files:**
- Create: `src/lib/pronunciationRules.ts`
- Create: `tests/pronunciationRules.test.ts`

**Interfaces:**

```ts
export function isSingleHanCharacter(text: string): boolean
export function normalizeRecognizedChinese(text: string): string
export function gradeForPronunciationAttempt(
  isFirstAttempt: boolean,
  correct: boolean,
): Grade | null
export function sanitizePronunciationExamples(character: string, values: unknown): string[]
export function pronunciationPlaybackItems(target: string, examples: string[]): string[]
```

- [ ] **Step 1: Write failing policy tests**

Create tests covering:

```ts
assert.equal(isSingleHanCharacter('中'), true);
assert.equal(isSingleHanCharacter('中国'), false);
assert.equal(normalizeRecognizedChinese(' 中 国。 '), '中国');
assert.equal(gradeForPronunciationAttempt(true, true), 'mastered');
assert.equal(gradeForPronunciationAttempt(true, false), 'forgotten');
assert.equal(gradeForPronunciationAttempt(false, true), null);
assert.deepEqual(
  sanitizePronunciationExamples('中', ['中国', '中午', '中国', '中心', '无关']),
  ['中国', '中午', '中心'],
);
assert.deepEqual(
  pronunciationPlaybackItems('中', ['中国', '中午', '中间']),
  ['中', '中国', '中午', '中间'],
);
assert.deepEqual(pronunciationPlaybackItems('中国', []), ['中国']);
```

Run:

```bash
node --experimental-strip-types --test tests/pronunciationRules.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the pure helpers**

Create `src/lib/pronunciationRules.ts`:

```ts
import type { Grade } from './types';

const HAN_CHARACTER_RE = /^\p{Script=Han}$/u;
const CHINESE_IGNORED_RE = /[\s，。！？、,.!?；;：“”"'（）()[\]【】]/gu;

export function isSingleHanCharacter(text: string): boolean {
  return HAN_CHARACTER_RE.test(text.trim());
}

export function normalizeRecognizedChinese(text: string): string {
  return text.normalize('NFKC').replace(CHINESE_IGNORED_RE, '');
}

export function gradeForPronunciationAttempt(
  isFirstAttempt: boolean,
  correct: boolean,
): Grade | null {
  if (!isFirstAttempt) return null;
  return correct ? 'mastered' : 'forgotten';
}

export function sanitizePronunciationExamples(character: string, values: unknown): string[] {
  if (!isSingleHanCharacter(character) || !Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const word = value.trim();
    if (word.length < 2 || word.length > 4 || !word.includes(character) || seen.has(word)) continue;
    seen.add(word);
    result.push(word);
    if (result.length === 3) break;
  }
  return result;
}

export function pronunciationPlaybackItems(target: string, examples: string[]): string[] {
  return isSingleHanCharacter(target) ? [target, ...examples.slice(0, 3)] : [target];
}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
node --experimental-strip-types --test tests/pronunciationRules.test.ts
git add src/lib/pronunciationRules.ts tests/pronunciationRules.test.ts
git commit -m "feat: add pronunciation practice policies" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: all pronunciation policy tests pass.

---

### Task 4: Add Frontend Pronunciation API Client

**Files:**
- Create: `src/lib/pronunciationApi.ts`
- Create: `tests/pronunciationApi.test.ts`

**Interfaces:**

```ts
export interface PronunciationAssessment {
  correct: boolean;
  recognizedText: string;
  acceptedReading: string | null;
}

export async function assessPronunciation(
  target: string,
  audio: Blob,
  options?: { timeoutMs?: number },
): Promise<PronunciationAssessment>

export async function generatePronunciationExamples(
  character: string,
  options?: { timeoutMs?: number },
): Promise<string[]>

export async function synthesizePronunciation(
  text: string,
  options?: { timeoutMs?: number },
): Promise<string>
```

- [ ] **Step 1: Write failing client tests**

Mock `globalThis.fetch` and test:

- assessment sends `target`, `mimeType`, and base64 audio;
- malformed assessment JSON throws `语音识别结果无效`;
- example response is sanitized to three values;
- synthesis requires a non-empty `audioUrl`;
- a 10ms hanging request rejects with the endpoint-specific timeout message.

Use a one-byte Blob:

```ts
const audio = new Blob([new Uint8Array([1])], { type: 'audio/webm' });
```

Run:

```bash
node --experimental-strip-types --test tests/pronunciationApi.test.ts
```

Expected: FAIL because `src/lib/pronunciationApi.ts` does not exist.

- [ ] **Step 2: Implement the client**

Use JSON requests so Vercel body parsing remains consistent:

```ts
const ASSESS_TIMEOUT_MS = 12_000;
const CONTENT_TIMEOUT_MS = 15_000;
const TTS_TIMEOUT_MS = 15_000;

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
```

Send assessment body:

```ts
{
  target,
  mimeType: audio.type,
  audioBase64: await blobToBase64(audio),
}
```

Reuse one local `fetchJsonWithTimeout` helper that aborts, parses `{ error }`, and throws the Chinese timeout/error text. Validate every successful response before returning it; call `sanitizePronunciationExamples` on example responses.

- [ ] **Step 3: Verify and commit**

Run:

```bash
node --experimental-strip-types --test tests/pronunciationApi.test.ts
git add src/lib/pronunciationApi.ts tests/pronunciationApi.test.ts
git commit -m "feat: add pronunciation API client" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: all client tests pass.

---

### Task 5: Add Validated DashScope Server Endpoints

**Files:**
- Create: `api/pronunciationShared.ts`
- Create: `api/assess-pronunciation.ts`
- Create: `api/generate-pronunciation-examples.ts`
- Create: `api/synthesize-pronunciation.ts`
- Create: `tests/pronunciationApiHandlers.test.ts`

**Interfaces:**

```ts
export const DASH_SCOPE_MULTIMODAL_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

export function parseJsonObject(text: string): Record<string, unknown> | null
export function validateAudioRequest(body: unknown): {
  target: string;
  mimeType: string;
  audioBase64: string;
}
```

Server defaults:

```ts
const ASSESS_MODEL = process.env.QWEN_PRONUNCIATION_MODEL ?? 'qwen-omni-turbo';
const TTS_MODEL = process.env.QWEN_TTS_MODEL ?? 'qwen3-tts-flash';
const TTS_VOICE = process.env.QWEN_TTS_VOICE ?? 'Cherry';
```

- [ ] **Step 1: Write failing handler-helper tests**

Test:

- fenced JSON is parsed;
- empty/invalid JSON returns `null`;
- audio request rejects missing target, non-Chinese target, unsupported MIME, invalid base64, and decoded audio over 1 MB;
- valid `audio/webm`, `audio/mp4`, `audio/ogg`, and `audio/wav` payloads are accepted;
- example validation rejects non-single-character targets;
- synthesis validation rejects empty or over-40-character text.

Run:

```bash
node --experimental-strip-types --test tests/pronunciationApiHandlers.test.ts
```

Expected: FAIL because the shared module does not exist.

- [ ] **Step 2: Implement shared validation**

Use explicit request/response interfaces matching existing API handlers. Validate Chinese text with:

```ts
const HAN_TEXT_RE = /^[\p{Script=Han}\s，。！？、,.!?；;：“”"'（）()]+$/u;
const AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/wav',
]);
const MAX_AUDIO_BYTES = 1_000_000;
```

Strip optional Markdown fences before `JSON.parse`, and use `Buffer.from(audioBase64, 'base64')` to enforce decoded size.

- [ ] **Step 3: Implement pronunciation assessment**

POST to `DASH_SCOPE_MULTIMODAL_URL` with:

```ts
{
  model: ASSESS_MODEL,
  input: {
    messages: [{
      role: 'user',
      content: [
        { audio: `data:${mimeType};base64,${audioBase64}` },
        { text: assessmentPrompt(target) },
      ],
    }],
  },
  parameters: { result_format: 'message' },
}
```

The prompt must require JSON only:

```json
{"status":"correct|incorrect|unclear","recognizedText":"...","acceptedReading":"... or null"}
```

It must state that any common reading of a single polyphonic character is accepted, while multi-character targets require the complete normalized content. Map `unclear` to HTTP `422` with `没有听清，请再试一次`; map upstream errors to `502`; never return the raw authorization header or full upstream body.

- [ ] **Step 4: Implement helper-word generation**

Call `qwen-turbo` through the existing compatible chat-completions endpoint. Require JSON:

```json
{"examples":["中国","中午","中间"]}
```

The prompt requires exactly three distinct, common, child-friendly words of 2–4 Chinese characters containing the target character. Sanitize with `sanitizePronunciationExamples`; return `502` unless exactly three remain.

- [ ] **Step 5: Implement speech synthesis**

POST to `DASH_SCOPE_MULTIMODAL_URL`:

```ts
{
  model: TTS_MODEL,
  input: {
    text,
    voice: TTS_VOICE,
    language_type: 'Chinese',
  },
}
```

Read `output.audio.url`, require HTTPS, and return `{ audioUrl }`. The URL is temporary and is not stored.

- [ ] **Step 6: Verify and commit**

Run:

```bash
node --experimental-strip-types --test tests/pronunciationApiHandlers.test.ts
npm run build
git add api/pronunciationShared.ts api/assess-pronunciation.ts api/generate-pronunciation-examples.ts api/synthesize-pronunciation.ts tests/pronunciationApiHandlers.test.ts
git commit -m "feat: add pronunciation service endpoints" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: handler tests and build pass.

---

### Task 6: Build the Reusable Microphone Session

**Files:**
- Create: `src/lib/speechRecorder.ts`
- Create: `tests/speechRecorder.test.ts`

**Interfaces:**

```ts
export interface RecordedSpeech {
  blob: Blob;
  mimeType: string;
}

export interface SpeechRecorderSession {
  start(onAutoStop: () => void): Promise<void>;
  stop(): Promise<RecordedSpeech>;
  dispose(): void;
  readonly isRecording: boolean;
}

export function createSpeechRecorderSession(): SpeechRecorderSession
export function selectRecordingMimeType(isSupported: (mime: string) => boolean): string
export function updateSilenceState(...): SilenceState
```

- [ ] **Step 1: Write failing recorder-policy tests**

Test MIME preference order:

```ts
['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']
```

Test silence state:

- silence before speech does not stop;
- signal over threshold marks speech as started;
- 799ms silence after speech does not stop;
- 800ms silence after speech requests stop;
- 6 seconds requests stop regardless of signal.

Run:

```bash
node --experimental-strip-types --test tests/speechRecorder.test.ts
```

Expected: FAIL because the recorder module does not exist.

- [ ] **Step 2: Implement recorder policy and browser adapter**

Use constants:

```ts
const SILENCE_MS = 800;
const MAX_RECORDING_MS = 6_000;
const SPEECH_RMS_THRESHOLD = 0.035;
```

`start()` must:

1. Reuse an existing live stream or call `getUserMedia({ audio: true })`.
2. Create one `MediaRecorder` using the selected MIME type.
3. Create an `AudioContext`, analyser, and `requestAnimationFrame` loop.
4. Collect non-empty `dataavailable` chunks.
5. Call `onAutoStop` once when silence or hard timeout is reached.

`stop()` must stop only the current recorder and analyser loop, resolve after the recorder's `stop` event, and reject empty recordings. `dispose()` must stop the recorder, cancel animation frames, close the audio context, and stop every stream track.

- [ ] **Step 3: Verify and commit**

Run:

```bash
node --experimental-strip-types --test tests/speechRecorder.test.ts
git add src/lib/speechRecorder.ts tests/speechRecorder.test.ts
git commit -m "feat: add reusable speech recorder" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: recorder policy tests pass.

---

### Task 7: Add Pronunciation Session State and UI

**Files:**
- Create: `src/components/pronunciationSession.ts`
- Create: `tests/pronunciationSession.test.ts`
- Create: `src/components/PronunciationPractice.tsx`
- Modify: `src/components/ReviewSession.tsx`
- Modify: `src/App.css`

**Interfaces:**

```ts
type PronunciationStatus =
  | 'idle'
  | 'requesting-permission'
  | 'listening'
  | 'assessing'
  | 'correct'
  | 'incorrect'
  | 'error';

interface PronunciationPracticeProps {
  word: Word;
  onExamplesChanged(updated: Word): void;
  onVoiceGrade(grade: 'mastered' | 'forgotten', advance: boolean): void;
}
```

- [ ] **Step 1: Write failing state-policy tests**

Create tests proving:

- an unseen word has a first attempt;
- committing an outcome adds its ID to a `Set<string>`;
- the first correct result returns `{ grade: 'mastered', advanceAfterMs: 1200 }`;
- the first incorrect result returns `{ grade: 'forgotten', advanceAfterMs: null }`;
- retry results return no grade;
- playback state advances through target plus three examples and stops at the end.

Run:

```bash
node --experimental-strip-types --test tests/pronunciationSession.test.ts
```

Expected: FAIL because the state module does not exist.

- [ ] **Step 2: Implement the pure session helpers**

Expose:

```ts
export function pronunciationOutcome(
  alreadyGraded: boolean,
  correct: boolean,
): {
  grade: 'mastered' | 'forgotten' | null;
  advanceAfterMs: number | null;
  message: string;
}
```

Return:

```ts
if (alreadyGraded) {
  return {
    grade: null,
    advanceAfterMs: null,
    message: correct ? '这次读对了' : '再试一次',
  };
}
return correct
  ? { grade: 'mastered', advanceAfterMs: 1200, message: '读对了' }
  : { grade: 'forgotten', advanceAfterMs: null, message: '再试一次' };
```

- [ ] **Step 3: Implement `PronunciationPractice`**

The component must:

- create one `SpeechRecorderSession` on mount and dispose it only on unmount;
- reset per-word UI, requests, audio, and delayed callbacks when `word.id` changes without disposing the shared stream;
- maintain `gradedWordIdsRef: Set<string>` across words;
- generate and persist three examples only when `isSingleHanCharacter(word.text)` and the saved array has fewer than three valid values;
- use request counters to ignore stale assessment, example, and TTS responses;
- on first correct, show the success state and call `onVoiceGrade('mastered', true)` after 1200ms;
- on first incorrect, call `onVoiceGrade('forgotten', false)` immediately;
- on retry, update the message only;
- prefetch synthesis URLs after an incorrect result;
- play `pronunciationPlaybackItems(...)` sequentially with `new Audio(url)`;
- highlight `playingIndex`;
- stop playback before recording starts.

Render helper words with target highlighting:

```tsx
function HighlightedExample({ text, target }: { text: string; target: string }) {
  const parts = text.split(target);
  return (
    <span>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>
          {index > 0 && <mark>{target}</mark>}
          {part}
        </span>
      ))}
    </span>
  );
}
```

- [ ] **Step 4: Integrate with `ReviewSession`**

Add:

```ts
const pronunciationEnabled = lang === 'zh' && !spellingOnly;
```

Render `PronunciationPractice` inside `.word-card` after the main word:

```tsx
{pronunciationEnabled && (
  <PronunciationPractice
    word={current}
    onExamplesChanged={(updated) => {
      setQueue((items) => items.map((item) => item.id === updated.id ? updated : item));
      void repo.upsertWord(updated).catch((error: unknown) => {
        setSaveError(`「${updated.text}」辅助词保存失败：${errorMessage(error, '请检查网络')}`);
      });
    }}
    onVoiceGrade={(voiceGrade, advance) => grade(voiceGrade, advance)}
  />
)}
```

Do not give the component a `key`; it must remain mounted while words change so the authorized microphone stream is reused.

- [ ] **Step 5: Add accessible styles and animation**

Add focused classes for:

- `.pronunciation-practice`;
- `.pronunciation-mic-btn` and listening pulse;
- `.pronunciation-feedback`;
- `.pronunciation-examples`;
- `.pronunciation-example mark`;
- `.pronunciation-example.playing`;
- `.pronunciation-fireworks` with 6–8 CSS particles;
- `@media (prefers-reduced-motion: reduce)` to remove particle movement while preserving “读对了” text.

Use the existing purple accent and green success color. Keep helper words at approximately `16px`, below the `44px` main Chinese character.

- [ ] **Step 6: Verify and commit**

Run:

```bash
node --experimental-strip-types --test tests/pronunciationSession.test.ts tests/pronunciationRules.test.ts tests/pronunciationApi.test.ts tests/speechRecorder.test.ts tests/reviewMode.test.ts
npm run build
git add src/components/pronunciationSession.ts tests/pronunciationSession.test.ts src/components/PronunciationPractice.tsx src/components/ReviewSession.tsx src/App.css
git commit -m "feat: add Chinese pronunciation practice UI" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: focused tests and build pass.

---

### Task 8: Document Configuration and Run Final Verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `src/lib/changelog.ts`

**Interfaces:**
- Documents the server-only model configuration and required Supabase migration.

- [ ] **Step 1: Document environment variables**

Append:

```dotenv
# 服务端语音功能；沿用 QWEN_API_KEY，可按需覆盖默认模型和音色。
QWEN_API_KEY=
QWEN_PRONUNCIATION_MODEL=qwen-omni-turbo
QWEN_TTS_MODEL=qwen3-tts-flash
QWEN_TTS_VOICE=Cherry
```

- [ ] **Step 2: Update README and changelog**

Document:

- Chinese reading microphone flow;
- first correct = `熟练`, first incorrect = `彻底陌生`;
- retries do not change the first score;
- three helper words for single characters;
- correct-pronunciation playback;
- Chinese reading countdown disabled;
- first browser microphone permission;
- `QWEN_API_KEY` and optional model variables;
- rerunning `supabase/schema.sql`.

Add one concise item to the current changelog entry covering the complete feature.

- [ ] **Step 3: Run complete verification**

Run:

```bash
node --experimental-strip-types --test tests/*.test.ts
npm run build
npx eslint \
  src/lib/reviewMode.ts \
  src/lib/types.ts \
  src/lib/wordService.ts \
  src/lib/localRepo.ts \
  src/lib/supabaseRepo.ts \
  src/lib/pronunciationRules.ts \
  src/lib/pronunciationApi.ts \
  src/lib/speechRecorder.ts \
  src/components/pronunciationSession.ts \
  src/components/PronunciationPractice.tsx \
  src/components/ReviewSession.tsx \
  api/pronunciationShared.ts \
  api/assess-pronunciation.ts \
  api/generate-pronunciation-examples.ts \
  api/synthesize-pronunciation.ts \
  tests/pronunciationRules.test.ts \
  tests/pronunciationApi.test.ts \
  tests/pronunciationApiHandlers.test.ts \
  tests/speechRecorder.test.ts \
  tests/pronunciationSession.test.ts
```

Expected: all tests and build pass; targeted lint has zero errors. Existing unrelated repository-wide lint failures are not part of this feature.

- [ ] **Step 4: Commit documentation**

Run:

```bash
git add .env.example README.md src/lib/changelog.ts
git commit -m "docs: document Chinese pronunciation practice" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Manual Acceptance Checklist

- [ ] On iOS Safari/PWA, Android Chrome, and desktop Chrome/Edge, the first microphone click shows only the browser permission prompt.
- [ ] Later words in the same Chinese-reading session reuse the microphone without another application prompt.
- [ ] A single character displays exactly three subtle helper words with the target character highlighted.
- [ ] A phrase or sentence does not display helper words.
- [ ] Manual stop, silence stop, and six-second stop all submit one recording.
- [ ] First correct pronunciation shows “读对了”, plays the reduced-size fireworks animation, and advances after about 1.2 seconds with grade `mastered`.
- [ ] First incorrect pronunciation records `forgotten`, stays on the item, and shows retry and correct-audio controls.
- [ ] Retrying after an incorrect first attempt never adds another review grade.
- [ ] Correct-audio playback highlights the character and then each helper word in sequence.
- [ ] Navigating away immediately stops recording/playback and prevents stale scoring.
- [ ] Permission, no-speech, timeout, and upstream errors never submit a grade.
- [ ] Chinese reading has no countdown; English reading and Chinese writing retain configured countdown behavior.
- [ ] Existing saved words without `pronunciation_examples` still load.
- [ ] Rerunning `supabase/schema.sql` succeeds without data loss.

## Self-Review Notes

- Spec coverage: all interaction, permission, persistence, scoring, playback, cleanup, accessibility, error, deployment, and cross-platform requirements map to Tasks 1–8.
- Placeholder scan: no deferred implementation or unspecified test step remains.
- Type consistency: `Word.pronunciationExamples`, pronunciation API response types, recorder interfaces, and component callback signatures are defined once and reused consistently.
