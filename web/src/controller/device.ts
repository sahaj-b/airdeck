export function isIPhone(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  return /iphone|ipod/i.test(ua) && !/ipad/i.test(ua);
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  const maxTouch =
    (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints ?? 0;
  return /macintosh/i.test(ua) && maxTouch > 1;
}

export function lacksNativeFullscreen(
  doc: Document | undefined = typeof document === 'undefined'
    ? undefined
    : document,
): boolean {
  return typeof doc?.documentElement.requestFullscreen !== 'function';
}

export function isIOSWithoutFullscreen(): boolean {
  if (typeof window === 'undefined') return false;
  return isIOS() && lacksNativeFullscreen();
}
