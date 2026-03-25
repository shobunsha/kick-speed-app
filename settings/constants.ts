export const APP_COPY = {
  cameraHint: 'Safari / Chrome の最新版での利用を推奨します。',
};

export const COUNTDOWN_START = 3;
export const RECORDING_DURATION_MS = 3000;
export const ANALYSIS_FRAME_INTERVAL_MS = 80;
export const MOTION_THRESHOLD = 28;
export const DETECTION_AREA_LIMITS = {
  min: 72,
  max: 9000,
};
export const DETECTION_ROI = {
  left: 0.04,
  right: 0.96,
  top: 0.28,
  bottom: 0.84,
};
export const POWER_SCORE_FLOOR = {
  mediumMotion: 22,
  strongMotion: 40,
};
export const BALL_SHAPE_THRESHOLDS = {
  minCircularity: 0.38,
  minAspectRatio: 0.48,
  maxAspectRatio: 2,
  maxTrackDistancePx: 280,
};
export const MIN_DISPLACEMENT_PIXELS = 8;
export const ANALYSIS_SAMPLE_LIMITS = {
  minCandidateFrames: 1,
  minStableFrames: 1,
  maxFramesForSpeed: 5,
};
export const FALLBACK_BALL_SHAPE_THRESHOLDS = {
  minCircularity: 0.18,
  minAspectRatio: 0.35,
  maxAspectRatio: 2.6,
  minArea: 110,
  minDisplacementPx: 18,
};
export const IOS_SAFARI_RELAXED_LIMITS = {
  detectionAreaMin: 56,
  maxTrackDistancePx: 360,
  fallbackMinArea: 84,
  fallbackMinDisplacementPx: 14,
  minStableFrames: 1,
  minCandidateFrames: 1,
};
export const BALL_DIAMETER_METERS = 0.22;
export const DEFAULT_PIXELS_PER_METER = 280;
export const RESULT_SPEED_CLAMP = {
  min: 8,
  max: 82,
};
export const SPEED_ESTIMATION = {
  roundStepKmh: 2,
  fallbackScale: 0.62,
  fallbackMaxKmh: 56,
  outlierHighMultiplier: 1.55,
  outlierLowMultiplier: 0.55,
  minimumTrustedSpeedKmh: 8,
};

export const RANK_THRESHOLDS = [
  { label: 'S', minScore: 90 },
  { label: 'A', minScore: 75 },
  { label: 'B', minScore: 55 },
  { label: 'C', minScore: 35 },
  { label: 'D', minScore: 0 },
];

export const RANK_LABELS = RANK_THRESHOLDS.map((item) => item.label);
