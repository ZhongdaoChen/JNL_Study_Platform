import { useEffect, useRef } from 'react';
import {
  lockBodyScroll,
  restoreBodyScroll,
  shouldUseCurrentIOSStandaloneKeyboardFix,
  type BodyScrollLock,
} from '../lib/iosStandalone';

export function useIOSStandaloneKeyboardFix<T extends HTMLElement>() {
  const targetRef = useRef<T | null>(null);

  useEffect(() => {
    const target = targetRef.current;
    if (!target || !shouldUseCurrentIOSStandaloneKeyboardFix()) return;

    let lock: BodyScrollLock | null = null;

    const lockScroll = () => {
      if (lock) return;
      lock = lockBodyScroll(document.body, window.scrollY);
    };

    const restoreScroll = () => {
      if (!lock) return;
      const activeLock = lock;
      lock = null;
      restoreBodyScroll(document.body, window, activeLock);
    };

    target.addEventListener('touchstart', lockScroll, { passive: true });
    target.addEventListener('pointerdown', lockScroll);
    target.addEventListener('focus', lockScroll);
    target.addEventListener('blur', restoreScroll);

    return () => {
      target.removeEventListener('touchstart', lockScroll);
      target.removeEventListener('pointerdown', lockScroll);
      target.removeEventListener('focus', lockScroll);
      target.removeEventListener('blur', restoreScroll);
      restoreScroll();
    };
  }, []);

  return targetRef;
}
