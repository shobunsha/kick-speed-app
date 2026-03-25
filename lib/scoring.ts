import { POWER_SCORE_FLOOR, RANK_THRESHOLDS } from '@/settings/constants';
import type { AnalysisResult } from '@/lib/types';

export function buildKickScore(result: AnalysisResult): number {
  const speedKmh = result.estimatedSpeedKmh;
  const totalDisplacement = result.samples.reduce((sum, sample, index, array) => {
    if (index === 0) {
      return 0;
    }

    const previous = array[index - 1];
    return sum + Math.hypot(sample.centerX - previous.centerX, sample.centerY - previous.centerY);
  }, 0);
  const segmentDisplacements = result.samples.slice(1).map((sample, index) => {
    const previous = result.samples[index];
    return Math.hypot(sample.centerX - previous.centerX, sample.centerY - previous.centerY);
  });
  const averageDisplacement =
    segmentDisplacements.length > 0
      ? segmentDisplacements.reduce((sum, value) => sum + value, 0) / segmentDisplacements.length
      : 0;
  const displacementSpread =
    segmentDisplacements.length > 0
      ? Math.max(...segmentDisplacements) - Math.min(...segmentDisplacements)
      : 0;
  const normalized = Math.max(0, Math.min(1, (speedKmh - 8) / (82 - 8)));
  const speedScore = Math.pow(normalized, 0.82) * 58;
  const movementScore = Math.min(totalDisplacement / 140, 1) * 24;
  const continuityScore = Math.min(result.detectionFrames / 4, 1) * 12;
  const stabilityScore = Math.max(0, 1 - displacementSpread / Math.max(averageDisplacement * 2.2, 1)) * 6;
  let score = Math.round(speedScore + movementScore + continuityScore + stabilityScore);

  if (totalDisplacement >= 80) {
    score = Math.max(score, POWER_SCORE_FLOOR.strongMotion);
  } else if (totalDisplacement >= 36) {
    score = Math.max(score, POWER_SCORE_FLOOR.mediumMotion);
  }

  return Math.max(1, Math.min(100, score));
}

export function buildRank(score: number): string {
  const matched = RANK_THRESHOLDS.find((item) => score >= item.minScore);
  return matched?.label ?? 'D';
}
