import type { Grade } from '../lib/types';

const reviewGradeShortcuts: Record<string, Grade> = {
  KeyA: 'instant',
  KeyS: 'mastered',
  KeyD: 'fuzzy',
  KeyF: 'forgotten',
};

const interactiveShortcutSelector = [
  'input',
  'textarea',
  'select',
  'button',
  'a',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');

type ShortcutTarget = EventTarget & {
  closest?: (selector: string) => Element | object | null;
};

export function shouldToggleCountdownPause({
  key,
  code,
  target,
  countdownEnabled,
  hasCurrentWord,
}: {
  key: string;
  code: string;
  target: EventTarget | null;
  countdownEnabled: boolean;
  hasCurrentWord: boolean;
}) {
  if (!countdownEnabled || !hasCurrentWord) return false;
  if (code !== 'Space' && key !== ' ') return false;
  return !isInteractiveShortcutTarget(target);
}

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

export function releaseReviewActionFocus(target: { blur: () => void }) {
  target.blur();
}

function isInteractiveShortcutTarget(target: EventTarget | null) {
  if (!target) return false;
  const maybeElement = target as ShortcutTarget;
  if (typeof maybeElement.closest !== 'function') return false;
  return Boolean(maybeElement.closest(interactiveShortcutSelector));
}
