# ASDF Review Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `A/S/D/F` keyboard shortcuts that choose the four daily-review grading buttons from left to right.

**Architecture:** Keep all shortcut policy in `src/components/reviewKeyboard.ts` as pure, unit-tested helpers. `ReviewSession.tsx` will consume those helpers from its existing `keydown` listener and keep grading behavior centralized through the existing `gradeRef.current(...)` path.

**Tech Stack:** React 19, TypeScript, Vite, Node built-in test runner with `--experimental-strip-types`, existing ESLint and build scripts.

## Global Constraints

- No new dependencies.
- Do not change SM-2 scheduling, persistence, queue loading, retry behavior, AI example generation, or countdown timing.
- `A/S/D/F` map left-to-right to `instant/mastered/fuzzy/forgotten`.
- Shortcuts only work when there is a current review word.
- Shortcuts must not fire from interactive targets: `input`, `textarea`, `select`, `button`, `a`, or enabled `contenteditable`.
- Repeated keydown events from holding a shortcut key must be ignored.
- Existing space shortcut for countdown pause/resume must keep working.

---

## File Structure

- Modify `src/components/reviewKeyboard.ts`: owns reusable keyboard guard logic. Add the `reviewGradeFromShortcut(...)` helper here so keyboard behavior remains testable without React.
- Modify `tests/reviewKeyboard.test.ts`: extend existing Node tests for ASDF mapping, ignored targets, missing current word, repeated keydown events, and non-shortcut keys.
- Modify `src/components/ReviewSession.tsx`: import the new helper, call it from the existing `keydown` listener before the space-toggle branch, and add visible shortcut letters to the four grading buttons.

---

### Task 1: Add Tested ASDF Shortcut Mapping

**Files:**
- Modify: `tests/reviewKeyboard.test.ts`
- Modify: `src/components/reviewKeyboard.ts`

**Interfaces:**
- Consumes: `Grade` type from `src/lib/types.ts`.
- Produces:
  ```ts
  export function reviewGradeFromShortcut({
    key,
    code,
    target,
    repeat,
    hasCurrentWord,
  }: {
    key: string;
    code: string;
    target: EventTarget | null;
    repeat: boolean;
    hasCurrentWord: boolean;
  }): Grade | null
  ```

- [ ] **Step 1: Write failing shortcut helper tests**

Replace the import block in `tests/reviewKeyboard.test.ts` with:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  releaseReviewActionFocus,
  reviewGradeFromShortcut,
  shouldToggleCountdownPause,
} from '../src/components/reviewKeyboard.ts';
```

Append these tests after the existing `space does not toggle countdown pause when countdown is disabled` test and before `review action buttons release focus after click`:

```ts
test('asdf keys map to review grades from left to right', () => {
  assert.equal(
    reviewGradeFromShortcut({
      key: 'a',
      code: 'KeyA',
      target: target(false),
      repeat: false,
      hasCurrentWord: true,
    }),
    'instant',
  );
  assert.equal(
    reviewGradeFromShortcut({
      key: 'S',
      code: 'KeyS',
      target: target(false),
      repeat: false,
      hasCurrentWord: true,
    }),
    'mastered',
  );
  assert.equal(
    reviewGradeFromShortcut({
      key: 'd',
      code: 'KeyD',
      target: target(false),
      repeat: false,
      hasCurrentWord: true,
    }),
    'fuzzy',
  );
  assert.equal(
    reviewGradeFromShortcut({
      key: 'F',
      code: 'KeyF',
      target: target(false),
      repeat: false,
      hasCurrentWord: true,
    }),
    'forgotten',
  );
});

test('asdf shortcuts do not grade from interactive elements', () => {
  assert.equal(
    reviewGradeFromShortcut({
      key: 'a',
      code: 'KeyA',
      target: target(true),
      repeat: false,
      hasCurrentWord: true,
    }),
    null,
  );
});

test('asdf shortcuts do not grade when no current word is visible', () => {
  assert.equal(
    reviewGradeFromShortcut({
      key: 'a',
      code: 'KeyA',
      target: target(false),
      repeat: false,
      hasCurrentWord: false,
    }),
    null,
  );
});

test('asdf shortcuts ignore repeated keydown events', () => {
  assert.equal(
    reviewGradeFromShortcut({
      key: 'a',
      code: 'KeyA',
      target: target(false),
      repeat: true,
      hasCurrentWord: true,
    }),
    null,
  );
});

test('non-asdf keys do not map to review grades', () => {
  assert.equal(
    reviewGradeFromShortcut({
      key: ' ',
      code: 'Space',
      target: target(false),
      repeat: false,
      hasCurrentWord: true,
    }),
    null,
  );
});
```

- [ ] **Step 2: Run the focused test and confirm it fails for the missing helper**

Run:

```bash
node --experimental-strip-types --test tests/reviewKeyboard.test.ts
```

Expected: FAIL with an import error stating that `reviewGradeFromShortcut` is not exported from `src/components/reviewKeyboard.ts`.

- [ ] **Step 3: Implement the shortcut helper**

At the top of `src/components/reviewKeyboard.ts`, add the type import and shortcut map before `const interactiveShortcutSelector`:

```ts
import type { Grade } from '../lib/types';

const reviewGradeShortcuts: Record<string, Grade> = {
  KeyA: 'instant',
  KeyS: 'mastered',
  KeyD: 'fuzzy',
  KeyF: 'forgotten',
};
```

After `shouldToggleCountdownPause(...)`, add:

```ts
export function reviewGradeFromShortcut({
  key,
  code,
  target,
  repeat,
  hasCurrentWord,
}: {
  key: string;
  code: string;
  target: EventTarget | null;
  repeat: boolean;
  hasCurrentWord: boolean;
}): Grade | null {
  if (!hasCurrentWord || repeat) return null;
  if (isInteractiveShortcutTarget(target)) return null;

  const grade = reviewGradeShortcuts[code];
  if (grade) return grade;

  switch (key.toLowerCase()) {
    case 'a':
      return 'instant';
    case 's':
      return 'mastered';
    case 'd':
      return 'fuzzy';
    case 'f':
      return 'forgotten';
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
node --experimental-strip-types --test tests/reviewKeyboard.test.ts
```

Expected: PASS with 9 passing tests.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/components/reviewKeyboard.ts tests/reviewKeyboard.test.ts
git commit -m "feat: add review shortcut mapping" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Wire Shortcuts into Daily Review UI

**Files:**
- Modify: `src/components/ReviewSession.tsx`

**Interfaces:**
- Consumes:
  ```ts
  reviewGradeFromShortcut(args: {
    key: string;
    code: string;
    target: EventTarget | null;
    repeat: boolean;
    hasCurrentWord: boolean;
  }): Grade | null
  ```
- Produces: Daily review users can press `A/S/D/F` to submit the matching grade through the existing `gradeRef.current(...)` flow.

- [ ] **Step 1: Update the import**

In `src/components/ReviewSession.tsx`, replace:

```ts
import { releaseReviewActionFocus, shouldToggleCountdownPause } from './reviewKeyboard';
```

with:

```ts
import { releaseReviewActionFocus, reviewGradeFromShortcut, shouldToggleCountdownPause } from './reviewKeyboard';
```

- [ ] **Step 2: Route ASDF keydown events to grading**

Replace the `handleKeyDown` function inside the `useEffect` that starts at `src/components/ReviewSession.tsx:241` with:

```ts
function handleKeyDown(event: KeyboardEvent) {
  const shortcutGrade = reviewGradeFromShortcut({
    key: event.key,
    code: event.code,
    target: event.target,
    repeat: event.repeat,
    hasCurrentWord: Boolean(current),
  });
  if (shortcutGrade) {
    event.preventDefault();
    gradeRef.current(shortcutGrade);
    return;
  }

  if (!shouldToggleCountdownPause({
    key: event.key,
    code: event.code,
    target: event.target,
    countdownEnabled: countdownSec > 0,
    hasCurrentWord: Boolean(current),
  })) {
    return;
  }
  event.preventDefault();
  setIsPaused((v) => !v);
}
```

- [ ] **Step 3: Add visible shortcut labels to the grading buttons**

Replace the four button bodies in the `.grade-buttons` block with:

```tsx
<button
  className="g-instant"
  onClick={(event) => gradeFromButton('instant', event.currentTarget)}
>
  A · {instantLabel}
</button>
<button
  className="g-mastered"
  onClick={(event) => gradeFromButton('mastered', event.currentTarget)}
>
  S · {GRADE_LABELS.mastered}
</button>
<button
  className="g-fuzzy"
  onClick={(event) => gradeFromButton('fuzzy', event.currentTarget)}
>
  D · {GRADE_LABELS.fuzzy}
</button>
<button
  className="g-forgotten"
  onClick={(event) => gradeFromButton('forgotten', event.currentTarget)}
>
  F · {GRADE_LABELS.forgotten}
</button>
```

- [ ] **Step 4: Run focused keyboard tests**

Run:

```bash
node --experimental-strip-types --test tests/reviewKeyboard.test.ts
```

Expected: PASS with 9 passing tests.

- [ ] **Step 5: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS with no ESLint errors.

- [ ] **Step 6: Run production build**

Run:

```bash
npm run build
```

Expected: PASS and Vite emits `dist/`.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/components/ReviewSession.tsx
git commit -m "feat: add asdf review shortcuts" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-Review Notes

- Spec coverage: Task 1 covers shortcut mapping and guard behavior; Task 2 covers React integration and visible UI labels; validation covers focused tests, lint, and build.
- Placeholder scan: no placeholder steps are present.
- Type consistency: `reviewGradeFromShortcut(...)` returns `Grade | null`, and Task 2 consumes that exact signature.
