import { RANK_THRESHOLDS } from '@/settings/constants';

export function buildKickScore(speedKmh: number): number {
  const normalized = Math.max(0, Math.min(1, (speedKmh - 8) / (82 - 8)));
  const curved = Math.pow(normalized, 0.82);
  return Math.max(1, Math.min(100, Math.round(curved * 100)));
}

export function buildRank(score: number): string {
  const matched = RANK_THRESHOLDS.find((item) => score >= item.minScore);
  return matched?.label ?? 'D';
}
