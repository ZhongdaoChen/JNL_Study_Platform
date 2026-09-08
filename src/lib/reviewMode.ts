import type { Lang } from './types';

export type ReviewMode = 'en-read' | 'en-spell' | 'zh-read' | 'zh-write';

export const REVIEW_MODES: { key: ReviewMode; label: string; lang: Lang; spellingOnly: boolean }[] = [
  { key: 'en-read', label: '英文读', lang: 'en', spellingOnly: false },
  { key: 'en-spell', label: '英文拼', lang: 'en', spellingOnly: true },
  { key: 'zh-read', label: '中文读', lang: 'zh', spellingOnly: false },
  { key: 'zh-write', label: '中文写', lang: 'zh', spellingOnly: true },
];

export function countdownForReviewMode(configuredCountdownSec: number, reviewMode: ReviewMode) {
  return reviewMode === 'en-spell' || reviewMode === 'zh-read'
    ? 0
    : configuredCountdownSec;
}
