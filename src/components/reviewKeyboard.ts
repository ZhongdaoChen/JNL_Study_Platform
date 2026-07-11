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

function isInteractiveShortcutTarget(target: EventTarget | null) {
  if (!target) return false;
  const maybeElement = target as ShortcutTarget;
  if (typeof maybeElement.closest !== 'function') return false;
  return Boolean(maybeElement.closest(interactiveShortcutSelector));
}
