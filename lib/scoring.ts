import { RANK_THRESHOLDS } from '@/settings/constants';

export function buildKickScore(speedKmh: number): number {
  const normalized = ((speedKmh - 15) / (120 - 15)) * 100;
  return Math.max(1, Math.min(100, Math.round(normalized)));
}

export function buildRank(score: number): string {
  const matched = RANK_THRESHOLDS.find((item) => score >= item.minScore);
  return matched?.label ?? 'D';
}
