export type IOSStandaloneKeyboardFixEnv = {
  userAgent: string;
  standalone: boolean;
  platform?: string;
  maxTouchPoints?: number;
};

type ScrollLockStyle = {
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  overflow: string;
};

type BodyScrollLockTarget = {
  style: ScrollLockStyle;
};

export type BodyScrollLock = {
  scrollY: number;
  previousStyle: ScrollLockStyle;
};

export function shouldUseIOSStandaloneKeyboardFix({
  userAgent,
  standalone,
  platform = '',
  maxTouchPoints = 0,
}: IOSStandaloneKeyboardFixEnv) {
  if (!standalone) return false;

  const isiPhoneOrIPad = /iPad|iPhone|iPod/.test(userAgent);
  const isDesktopClassIPad = platform === 'MacIntel' && maxTouchPoints > 1;

  return isiPhoneOrIPad || isDesktopClassIPad;
}

export function lockBodyScroll(body: BodyScrollLockTarget, scrollY: number): BodyScrollLock {
  const previousStyle = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
  };

  body.style.position = 'fixed';
  body.style.top = `-${scrollY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  body.style.overflow = 'hidden';

  return { scrollY, previousStyle };
}

export function restoreBodyScroll(
  body: BodyScrollLockTarget,
  win: { scrollTo: (x: number, y: number) => void },
  lock: BodyScrollLock,
) {
  body.style.position = lock.previousStyle.position;
  body.style.top = lock.previousStyle.top;
  body.style.left = lock.previousStyle.left;
  body.style.right = lock.previousStyle.right;
  body.style.width = lock.previousStyle.width;
  body.style.overflow = lock.previousStyle.overflow;
  win.scrollTo(0, lock.scrollY);
}

export function shouldUseCurrentIOSStandaloneKeyboardFix() {
  return shouldUseIOSStandaloneKeyboardFix({
    userAgent: navigator.userAgent,
    standalone: Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}
