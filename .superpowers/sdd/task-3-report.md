# Task 3 Report

- **Status:** done
- **Commit:** c48e3b7 (`feat: add pronunciation policy helpers`)
- **Tests:** `node --experimental-strip-types --test tests/pronunciationRules.test.ts`
- **Concerns:** `package-lock.json` is modified in the worktree but was not touched by this task.

## Important Task 3 review fix

- **Status:** fixed
- **Finding addressed:** `sanitizePronunciationExamples` now rejects non-Chinese candidates like `中a`, `中。`, and `中 国`.
- **Test-first change:** added a failing assertion in `tests/pronunciationRules.test.ts` proving only 2-4-character Han-only examples are accepted.
- **Code change:** replaced the loose length check with `^\p{Script=Han}{2,4}$` so examples must consist entirely of 2-4 Han characters.
- **Files changed:** `src/lib/pronunciationRules.ts`, `tests/pronunciationRules.test.ts`
- **Package lock:** not modified by this fix.

### Exact test output

```text
✔ detects single Han characters (0.636ms)
✔ normalizes recognized Chinese text (0.088875ms)
✔ grades only first pronunciation attempt (0.040833ms)
✖ sanitizes pronunciation examples (1.496333ms)
✔ builds pronunciation playback items (0.051959ms)
ℹ tests 5
ℹ suites 0
ℹ pass 4
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 108.352917

✖ failing tests:

test at tests/pronunciationRules.test.ts:26:1
✖ sanitizes pronunciation examples (1.496333ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

    [
  +   '中a',
  +   '中。',
  +   '中 国'
  -   '中午'
    ]

      at TestContext.<anonymous> (file:///Users/chenpet/PeterChen/xiaorenwu/.worktrees/chinese-pronunciation-practice/tests/pronunciationRules.test.ts:31:10)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [ '中a', '中。', '中 国' ],
    expected: [ '中午' ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

### Verification after fix

```text
✔ detects single Han characters (0.636ms)
✔ normalizes recognized Chinese text (0.088875ms)
✔ grades only first pronunciation attempt (0.040833ms)
✔ sanitizes pronunciation examples (1.314792ms)
✔ builds pronunciation playback items (0.053333ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 105.139959
```
