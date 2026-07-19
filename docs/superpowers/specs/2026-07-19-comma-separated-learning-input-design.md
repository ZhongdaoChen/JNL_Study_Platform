# Comma-separated learning input design

## Goal

Change the learning input flow so parents can record words or phrases as comma-separated entries. English and Chinese input should no longer split on spaces or individual Chinese characters. For example, `come on` stays as one learned entry, while `come on,good morning` becomes two entries.

## Current context

- `src/components/LearnInput.tsx` previews entries with `tokenizeByLang(...)`, lets users remove unwanted entries, then passes the approved list to `addLearning(...)`.
- `src/lib/wordService.ts` accepts selected preview tokens and falls back to `tokenizeByLang(...)` when no selected list is supplied.
- `src/lib/tokenizer.ts` currently splits English on whitespace and Chinese by individual character.
- Existing saved words and characters are stored as `Word.text` values and do not need migration.

## Recommended approach

Update the shared tokenizer path so both the UI preview and service fallback use the same comma-separated behavior. `tokenizeByLang(...)` will split input on either English comma `,` or Chinese comma `，`, trim each entry, drop empty entries, preserve the user's casing and internal spacing, and deduplicate exact entries within the same input.

This keeps the change small and avoids adding another UI mode. It also makes future direct service calls consistent with the preview path.

## User-facing behavior

- English and Chinese learning input both use comma-separated entries.
- Spaces inside an entry are preserved, so `come on` remains one entry.
- Full-width and half-width commas both act as separators.
- Empty segments are ignored, so `come on,,good morning，` produces `come on` and `good morning`.
- Exact duplicate entries in the same input are shown once.
- Existing learned data remains unchanged; the new rule applies only to future entries.

## Components and data flow

1. `LearnInput.tsx` calls `tokenizeByLang(trimmed, lang)` for preview, just as it does today.
2. The preview list shows comma-separated entries and allows removal before saving.
3. `handleConfirm()` passes the approved entries to `addLearning(...)`.
4. `addLearning(...)` stores the original full input as the sentence context and stores each approved comma-separated entry as a `Word.text` value.
5. Review, overview, statistics, and scheduling continue to operate on `Word.text`; no schema or repository changes are needed.

## Error handling and edge cases

- Blank input remains blocked by the existing `text.trim()` check.
- Inputs containing only commas or whitespace produce no preview entries; `LearnInput.tsx` should show a clear "no recognizable entry" message and keep saving disabled.
- The tokenizer does not silently lowercase, capitalize, or strip punctuation inside entries. This follows the requested behavior to preserve user input except for trimming the ends.

## Testing

Add or update tokenizer tests to cover:

- `come on,good morning` becomes `['come on', 'good morning']`.
- Chinese comma input splits with `，`.
- Mixed comma styles split in the same input.
- Empty comma segments are ignored.
- Exact repeated entries are deduplicated.
- Original casing and internal spaces are preserved.

Use the existing build/test tooling after implementation. At minimum, run the targeted tokenizer test if present, then run the project build because this is a TypeScript app.
