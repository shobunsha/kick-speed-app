export const APP_COPY = {
  cameraHint: 'Safari / Chrome の最新版での利用を推奨します。',
};

export const COUNTDOWN_START = 3;
export const RECORDING_DURATION_MS = 3000;
export const ANALYSIS_FRAME_INTERVAL_MS = 80;
export const MOTION_THRESHOLD = 28;
export const DETECTION_AREA_LIMITS = {
  min: 140,
  max: 9000,
};
export const DETECTION_ROI = {
  left: 0.1,
  right: 0.9,
  top: 0.45,
  bottom: 0.95,
};
export const BALL_SHAPE_THRESHOLDS = {
  minCircularity: 0.45,
  minAspectRatio: 0.55,
  maxAspectRatio: 1.8,
  maxTrackDistancePx: 140,
};
export const MIN_DISPLACEMENT_PIXELS = 8;
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
