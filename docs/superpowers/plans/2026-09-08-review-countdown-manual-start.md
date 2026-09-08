# Review Countdown Manual Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require one manual “继续倒计时” action each time a countdown-enabled review module is entered, then automatically start the countdown for subsequent words in that module session.

**Architecture:** Keep the session-unlock state local to `ReviewSession`, because the component is remounted when the review mode changes and reloads its queue when the child or review context changes. Add one pure helper in `reviewCountdown.ts` for deciding whether a newly displayed word starts paused, then reuse the existing timer, pause button, keyboard shortcut, timeout grading, and phrase-duration logic.

**Tech Stack:** React 19, TypeScript, Vite, Node built-in test runner with `--experimental-strip-types`, existing ESLint and build scripts.

## Global Constraints

- No new dependencies.
- The first countdown in each review-module entry must require a click on “继续倒计时” or the existing space shortcut.
- Before that manual action, grading or navigating to another word must not unlock automatic countdown.
- After that manual action, every subsequently displayed word starts its full countdown automatically.
- Leaving and re-entering a review module, switching review modes, switching children, or reloading the review queue resets the manual-start requirement.
- English spelling remains countdown-disabled.
- Preserve timeout grading, phrase-duration doubling, manual pause/resume, review scheduling, retry queue behavior, and persistence behavior.

---

## File Structure

- Modify `src/lib/reviewCountdown.ts`: add the pure policy helper that decides whether a newly displayed word starts paused.
- Modify `tests/reviewCountdown.test.ts`: unit-test the new first-manual-start policy alongside existing duration rules.
- Modify `src/components/ReviewSession.tsx`: store the module-session unlock state, reset it with queue loading, apply the helper on each displayed word, and route both button and space controls through one memoized toggle function.
- Modify `README.md`: describe the first-manual-start behavior in the review feedback feature.
- Modify `src/lib/changelog.ts`: add the behavior change to the current release notes.

---

### Task 1: Add the Countdown Start Policy

**Files:**
- Modify: `tests/reviewCountdown.test.ts`
- Modify: `src/lib/reviewCountdown.ts`

**Interfaces:**
- Consumes: two booleans describing whether countdown is enabled and whether this module session has been manually started.
- Produces:
  ```ts
  export function shouldPauseNewReviewCountdown(
    countdownEnabled: boolean,
    hasManuallyStarted: boolean,
  ): boolean
  ```

- [ ] **Step 1: Write failing policy tests**

Update the import in `tests/reviewCountdown.test.ts` to include the new helper:

```ts
import {
  countdownSecForWord,
  entryWordCount,
  PHRASE_MIN_WORDS,
  shouldPauseNewReviewCountdown,
} from '../src/lib/reviewCountdown.ts';
```

Append these tests:

```ts
test('countdown-enabled words stay paused until the session is manually started', () => {
  assert.equal(shouldPauseNewReviewCountdown(true, false), true);
});

test('new words auto-start after the session countdown has been manually started', () => {
  assert.equal(shouldPauseNewReviewCountdown(true, true), false);
});

test('countdown-disabled words do not enter a paused countdown state', () => {
  assert.equal(shouldPauseNewReviewCountdown(false, false), false);
  assert.equal(shouldPauseNewReviewCountdown(false, true), false);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
node --experimental-strip-types --test tests/reviewCountdown.test.ts
```

Expected: FAIL because `shouldPauseNewReviewCountdown` is not exported from `src/lib/reviewCountdown.ts`.

- [ ] **Step 3: Implement the minimal policy helper**

Append this function to `src/lib/reviewCountdown.ts`:

```ts
// 新词仅在倒计时启用且本次模块会话尚未手动启动时保持暂停。
export function shouldPauseNewReviewCountdown(
  countdownEnabled: boolean,
  hasManuallyStarted: boolean,
): boolean {
  return countdownEnabled && !hasManuallyStarted;
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
node --experimental-strip-types --test tests/reviewCountdown.test.ts
```

Expected: PASS with 9 passing tests.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/lib/reviewCountdown.ts tests/reviewCountdown.test.ts
git commit -m "test: define review countdown start policy" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Apply Manual Start to Every Countdown-Enabled Review Module

**Files:**
- Modify: `src/components/ReviewSession.tsx:1-103`
- Modify: `src/components/ReviewSession.tsx:250-295`
- Modify: `README.md:7-9`
- Modify: `src/lib/changelog.ts:9-17`

**Interfaces:**
- Consumes:
  ```ts
  shouldPauseNewReviewCountdown(
    countdownEnabled: boolean,
    hasManuallyStarted: boolean,
  ): boolean
  ```
- Produces: A `ReviewSession` module session that waits for one explicit resume action, then auto-starts every later word until the component session or queue context resets.

- [ ] **Step 1: Import the countdown policy helper**

Replace the React and countdown imports in `src/components/ReviewSession.tsx`:

```ts
import { useEffect, useRef, useState } from 'react';
import { countdownSecForWord } from '../lib/reviewCountdown';
```

with:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  countdownSecForWord,
  shouldPauseNewReviewCountdown,
} from '../lib/reviewCountdown';
```

- [ ] **Step 2: Add module-session countdown state**

Immediately after the existing `isPaused` state, add:

```ts
const [hasManuallyStartedCountdown, setHasManuallyStartedCountdown] = useState(false);
```

- [ ] **Step 3: Reset manual-start state when the review queue context loads**

Inside the queue-loading effect, immediately after `setLoading(true);`, add:

```ts
setHasManuallyStartedCountdown(false);
```

Keep the existing dependency array unchanged. Update the effect comment to state that loading a different child, language, or review type resets the module session. Countdown configuration changes must not reload the queue or reset review progress.

- [ ] **Step 4: Make each displayed word obey the session policy**

Replace the countdown-reset effect with:

```ts
// 切换词或修改配置时重置倒计时。首次手动启动前，新词继续保持暂停。
useEffect(() => {
  const sec = current ? countdownSecForWord(countdownSec, current.text) : countdownSec;
  remainRef.current = current && sec > 0 ? sec * 1000 : 0;
  setRemainMs(remainRef.current);
  setIsPaused(
    shouldPauseNewReviewCountdown(
      Boolean(current) && countdownSec > 0,
      hasManuallyStartedCountdown,
    ),
  );
}, [current?.id, countdownSec, hasManuallyStartedCountdown]);
```

This dependency deliberately reruns once on the first manual start, resetting the still-unused first-word duration to its full value before the interval begins.

- [ ] **Step 5: Make the shared toggle unlock the session**

Replace `togglePause()` with a memoized callback:

```ts
const togglePause = useCallback(() => {
  if (countdownSec <= 0) return;
  if (!hasManuallyStartedCountdown) {
    setHasManuallyStartedCountdown(true);
    setIsPaused(false);
    return;
  }
  setIsPaused((paused) => !paused);
}, [countdownSec, hasManuallyStartedCountdown]);
```

- [ ] **Step 6: Route the space shortcut through the shared toggle**

In the keyboard effect, replace:

```ts
event.preventDefault();
setIsPaused((v) => !v);
```

with:

```ts
event.preventDefault();
togglePause();
```

Update the keyboard effect dependency array to:

```ts
}, [countdownSec, current, togglePause]);
```

This ensures button clicks and the space shortcut have identical first-start and later pause/resume behavior.

- [ ] **Step 7: Update user-facing documentation**

Replace README feature 3 with:

```md
3. **复习反馈**：四档评分（秒读 / 熟练 / 略陌生 / 彻底陌生）自动更新复习计划；彻底陌生会当天补做两遍（第一遍约在 10 个词之后，其余在队列末尾）。每次进入启用倒计时的复习模块时，需首次手动点击“继续倒计时”或按空格，后续单词才会自动倒计时；超时会自动判为彻底陌生，三个单词及以上的词组倒计时翻倍。
```

Append this item to the `v2.0.0` `items` array in `src/lib/changelog.ts`:

```ts
'每次进入启用倒计时的复习模块时，首个倒计时改为手动点击“继续倒计时”或按空格启动，启动后后续单词自动计时。',
```

- [ ] **Step 8: Run focused countdown and keyboard tests**

Run:

```bash
node --experimental-strip-types --test tests/reviewCountdown.test.ts tests/reviewKeyboard.test.ts
```

Expected: PASS with 18 passing tests.

- [ ] **Step 9: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS with no ESLint errors.

- [ ] **Step 10: Run the production build**

Run:

```bash
npm run build
```

Expected: PASS and Vite emits `dist/`.

- [ ] **Step 11: Commit Task 2**

Run:

```bash
git add src/components/ReviewSession.tsx README.md src/lib/changelog.ts
git commit -m "feat: require manual review countdown start" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-Review Notes

- Spec coverage: Task 1 defines and tests the pause policy; Task 2 covers session reset, first manual start, navigation before unlock, automatic starts after unlock, button/space parity, countdown-disabled modes, documentation, lint, and build.
- Placeholder scan: no placeholder steps are present.
- Type consistency: `shouldPauseNewReviewCountdown(boolean, boolean): boolean` is defined once in Task 1 and consumed with the same signature in Task 2.
