import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lockBodyScroll,
  restoreBodyScroll,
  shouldUseIOSStandaloneKeyboardFix,
} from '../src/lib/iosStandalone.ts';

test('keyboard fix is enabled for iPad Home Screen standalone mode', () => {
  assert.equal(
    shouldUseIOSStandaloneKeyboardFix({
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      standalone: true,
    }),
    true,
  );
});

test('keyboard fix is disabled for normal iPad browser mode', () => {
  assert.equal(
    shouldUseIOSStandaloneKeyboardFix({
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      standalone: false,
    }),
    false,
  );
});

test('keyboard fix recognizes desktop-class iPad user agents in standalone mode', () => {
  assert.equal(
    shouldUseIOSStandaloneKeyboardFix({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15',
      standalone: true,
      platform: 'MacIntel',
      maxTouchPoints: 5,
    }),
    true,
  );
});

test('keyboard fix is disabled for non-iOS standalone mode', () => {
  assert.equal(
    shouldUseIOSStandaloneKeyboardFix({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15',
      standalone: true,
    }),
    false,
  );
});

test('locking body scroll fixes the body at the current scroll position', () => {
  const body = {
    style: {
      position: '',
      top: '',
      left: '',
      right: '',
      width: '',
      overflow: '',
    },
  };

  const lock = lockBodyScroll(body, 348);

  assert.deepEqual(lock.previousStyle, {
    position: '',
    top: '',
    left: '',
    right: '',
    width: '',
    overflow: '',
  });
  assert.equal(lock.scrollY, 348);
  assert.equal(body.style.position, 'fixed');
  assert.equal(body.style.top, '-348px');
  assert.equal(body.style.left, '0');
  assert.equal(body.style.right, '0');
  assert.equal(body.style.width, '100%');
  assert.equal(body.style.overflow, 'hidden');
});

test('restoring body scroll puts styles back and scrolls to original position', () => {
  const body = {
    style: {
      position: 'fixed',
      top: '-348px',
      left: '0',
      right: '0',
      width: '100%',
      overflow: 'hidden',
    },
  };
  const calls: Array<[number, number]> = [];

  restoreBodyScroll(
    body,
    {
      scrollTo: (x, y) => {
        calls.push([x, y]);
      },
    },
    {
      scrollY: 348,
      previousStyle: {
        position: 'relative',
        top: '1px',
        left: '2px',
        right: '3px',
        width: 'auto',
        overflow: 'visible',
      },
    },
  );

  assert.deepEqual(body.style, {
    position: 'relative',
    top: '1px',
    left: '2px',
    right: '3px',
    width: 'auto',
    overflow: 'visible',
  });
  assert.deepEqual(calls, [[0, 348]]);
});
