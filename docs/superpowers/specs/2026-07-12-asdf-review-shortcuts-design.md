# ASDF Review Shortcuts Design

## Goal

Daily review shows four grading choices for each word. Add keyboard shortcuts so users can press `A`, `S`, `D`, or `F` to choose the four visible grading buttons from left to right.

## Relevant Code

- `src/components/ReviewSession.tsx` renders the daily review card, countdown controls, word navigation, example prompt, and four grading buttons.
- `src/components/reviewKeyboard.ts` owns keyboard shortcut guard logic for the review page.
- `tests/reviewKeyboard.test.ts` tests review keyboard behavior.

## Approach

Use the existing review keyboard helper module as the single place for shortcut rules. Add a pure helper that maps `A/S/D/F` to the four `Grade` values and rejects shortcuts when:

- there is no current review word;
- focus is inside an interactive element such as an input, button, link, select, or contenteditable element;
- the keydown event is an auto-repeat from holding the key.

`ReviewSession.tsx` will call this helper from the existing `keydown` listener. If the helper returns a grade, the component prevents the browser default and calls `gradeRef.current(grade)`. The existing space shortcut for pausing/resuming the countdown remains unchanged.

## Shortcut Mapping

| Key | Grade | Visible label |
| --- | --- | --- |
| `A` | `instant` | 秒读 / 秒拼 / 秒写 |
| `S` | `mastered` | 熟练 |
| `D` | `fuzzy` | 略陌生 |
| `F` | `forgotten` | 彻底陌生 |

The mapping follows the four grading buttons from left to right.

## UI

Each grading button will include its shortcut letter in the label so users can discover the keyboard controls without separate documentation. Existing button classes and click behavior stay the same.

## Testing

Extend `tests/reviewKeyboard.test.ts` to cover:

- `A/S/D/F` map to the expected grades;
- shortcut keys are ignored from interactive elements;
- shortcuts are ignored when no current word exists;
- repeated keydown events are ignored.

Run the existing targeted keyboard test and a production build after implementation.
