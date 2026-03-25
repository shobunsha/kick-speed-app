export const APP_COPY = {
  cameraHint: 'Safari / Chrome の最新版での利用を推奨します。',
};

export const COUNTDOWN_START = 3;
export const RECORDING_DURATION_MS = 3000;
export const ANALYSIS_FRAME_INTERVAL_MS = 80;
export const MOTION_THRESHOLD = 28;
export const DETECTION_AREA_LIMITS = {
  min: 100,
  max: 9000,
};
export const DETECTION_ROI = {
  left: 0.06,
  right: 0.94,
  top: 0.32,
  bottom: 0.97,
};
export const BALL_SHAPE_THRESHOLDS = {
  minCircularity: 0.38,
  minAspectRatio: 0.48,
  maxAspectRatio: 2,
  maxTrackDistancePx: 200,
};
export const MIN_DISPLACEMENT_PIXELS = 8;
export const ANALYSIS_SAMPLE_LIMITS = {
  minCandidateFrames: 2,
  minStableFrames: 2,
  maxFramesForSpeed: 5,
};
export const BALL_DIAMETER_METERS = 0.22;
export const DEFAULT_PIXELS_PER_METER = 280;
export const RESULT_SPEED_CLAMP = {
  min: 5,
  max: 140,
};

export const RANK_THRESHOLDS = [
  { label: 'S', minScore: 90 },
  { label: 'A', minScore: 75 },
  { label: 'B', minScore: 55 },
  { label: 'C', minScore: 35 },
  { label: 'D', minScore: 0 },
];

export const RANK_LABELS = RANK_THRESHOLDS.map((item) => item.label);
