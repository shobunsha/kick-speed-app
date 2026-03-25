import {
  ANALYSIS_FRAME_INTERVAL_MS,
  ANALYSIS_SAMPLE_LIMITS,
  BALL_DIAMETER_METERS,
  BALL_SHAPE_THRESHOLDS,
  DEFAULT_PIXELS_PER_METER,
  DETECTION_AREA_LIMITS,
  DETECTION_ROI,
  FALLBACK_BALL_SHAPE_THRESHOLDS,
  IOS_SAFARI_RELAXED_LIMITS,
  MIN_DISPLACEMENT_PIXELS,
  MOTION_THRESHOLD,
  RESULT_SPEED_CLAMP,
  SPEED_ESTIMATION,
} from '@/settings/constants';
import type {
  AnalysisResult,
  AnalysisSample,
  AnalyzeKickVideoParams,
  OpenCvContourVector,
  OpenCvModule,
} from '@/lib/types';

type DetectionResult = {
  sample: AnalysisSample | null;
  roiCandidateCount: number;
  acceptedCandidateCount: number;
  normalAcceptedCount: number;
  fallbackAcceptedCount: number;
  mode: 'none' | 'normal' | 'fallback';
};

export async function analyzeKickVideo({
  cv,
  videoBlob,
}: AnalyzeKickVideoParams): Promise<AnalysisResult> {
  const device = detectClientDevice();
  const videoUrl = URL.createObjectURL(videoBlob);
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;

  try {
    await waitForLoadedMetadata(video);
    await ensurePlayableVideo(video);

    console.info('[analyzeKickVideo] 動画メタデータ', {
      device,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      blobSize: videoBlob.size,
      estimatedFps: Math.round((1000 / ANALYSIS_FRAME_INTERVAL_MS) * 10) / 10,
    });

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) {
      throw new Error('解析用キャンバスを初期化できませんでした。');
    }

    const samples: AnalysisSample[] = [];
    let previousGray: InstanceType<OpenCvModule['Mat']> | null = null;
    let previousTrackedSample: AnalysisSample | null = null;
    let roiCandidateCount = 0;
    let acceptedCandidateCount = 0;
    let normalAcceptedCount = 0;
    let fallbackAcceptedCount = 0;
    let detectedModes: Array<'normal' | 'fallback'> = [];
    const frameCandidateCounts: number[] = [];
    const frameAcceptedCounts: number[] = [];
    const frameModes: string[] = [];

    for (
      let currentTime = 0;
      currentTime < video.duration;
      currentTime += ANALYSIS_FRAME_INTERVAL_MS / 1000
    ) {
      await seekVideo(video, currentTime);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const detection = detectMotionSample(
        cv,
        imageData,
        previousGray,
        previousTrackedSample,
        currentTime,
        device
      );
      const sample = detection.sample;
      roiCandidateCount += detection.roiCandidateCount;
      acceptedCandidateCount += detection.acceptedCandidateCount;
      normalAcceptedCount += detection.normalAcceptedCount;
      fallbackAcceptedCount += detection.fallbackAcceptedCount;
      frameCandidateCounts.push(detection.roiCandidateCount);
      frameAcceptedCounts.push(detection.acceptedCandidateCount);
      frameModes.push(detection.mode);

      if (sample) {
        samples.push(sample);
        if (detection.mode !== 'none') {
          detectedModes.push(detection.mode);
        }
        if (sample.area > 0) {
          previousTrackedSample = sample;
        }
      }

      if (previousGray) {
        previousGray.delete();
      }
      previousGray = sample?.grayFrame ?? createGrayFrame(cv, imageData);
    }

    if (previousGray) {
      previousGray.delete();
    }

    const candidateSamples = samples.filter((sample) => sample.area > 0);
    const filteredSamples = filterStableSamples(candidateSamples);
    const modeLabel = detectedModes.includes('normal')
      ? '通常判定'
      : detectedModes.includes('fallback')
        ? 'fallback判定'
        : '未採用';
    const analysisSummary = {
      roi: DETECTION_ROI,
      device,
      extractedFrames: samples.length,
      candidateFrames: candidateSamples.length,
      adoptedFrames: filteredSamples.length,
      roiCandidateCount,
      acceptedCandidateCount,
      normalAcceptedCount,
      fallbackAcceptedCount,
      frameCandidateCounts,
      frameAcceptedCounts,
      frameModes,
      mode: modeLabel,
    };

    if (candidateSamples.length < 2) {
      logAnalysisFailure({
        ...analysisSummary,
        reason: '速度計算に必要なフレーム不足',
      });
      const fallbackResult = buildMotionFallbackResult(candidateSamples, device);
      if (fallbackResult) {
        console.info('[analyzeKickVideo] 簡易動体 fallback で結果化', fallbackResult);
        return fallbackResult;
      }
      throw new Error(
        buildRetryMessage(device)
      );
    }

    if (candidateSamples.length < getMinCandidateFrames(device)) {
      logAnalysisFailure({
        ...analysisSummary,
        reason: '候補フレーム不足',
      });
      const fallbackResult = buildMotionFallbackResult(candidateSamples, device);
      if (fallbackResult) {
        console.info('[analyzeKickVideo] 簡易動体 fallback で結果化', fallbackResult);
        return fallbackResult;
      }
      throw new Error(
        buildRetryMessage(device)
      );
    }

    if (filteredSamples.length < getMinStableFrames(device)) {
      logAnalysisFailure({
        ...analysisSummary,
        reason: '採用フレーム不足',
      });
      const fallbackResult = buildMotionFallbackResult(candidateSamples, device);
      if (fallbackResult) {
        console.info('[analyzeKickVideo] 簡易動体 fallback で結果化', fallbackResult);
        return fallbackResult;
      }
      throw new Error(
        buildRetryMessage(device)
      );
    }

    console.info('[analyzeKickVideo] 解析成功', analysisSummary);

    const estimatedSpeedKmh = estimateInitialSpeedKmh(filteredSamples);

    return {
      estimatedSpeedKmh,
      detectionFrames: filteredSamples.length,
      samples: filteredSamples.map(({ grayFrame: _grayFrame, ...sample }) => sample),
    };
  } finally {
    URL.revokeObjectURL(videoUrl);
  }
}

function waitForLoadedMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('動画メタデータの読み込みに失敗しました。'));
  });
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    video.currentTime = Math.min(time, Math.max(video.duration - 0.01, 0));
    video.onseeked = () => resolve();
    video.onerror = () => reject(new Error('動画フレームの読み込みに失敗しました。'));
  });
}

function createGrayFrame(cv: OpenCvModule, imageData: ImageData) {
  const source = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
  source.delete();
  return gray;
}

function detectMotionSample(
  cv: OpenCvModule,
  imageData: ImageData,
  previousGray: InstanceType<OpenCvModule['Mat']> | null,
  previousTrackedSample: AnalysisSample | null,
  time: number,
  device: ReturnType<typeof detectClientDevice>
): DetectionResult {
  const source = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  const diff = new cv.Mat();
  const threshold = new cv.Mat();
  const contours = new cv.MatVector() as OpenCvContourVector;
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

    if (!previousGray) {
      return {
        sample: {
          time,
          centerX: 0,
          centerY: 0,
          area: 0,
          radiusPx: 0,
          grayFrame: gray,
        },
        roiCandidateCount: 0,
        acceptedCandidateCount: 0,
        normalAcceptedCount: 0,
        fallbackAcceptedCount: 0,
        mode: 'none',
      };
    }

    cv.absdiff(gray, previousGray, diff);
    cv.threshold(diff, threshold, MOTION_THRESHOLD, 255, cv.THRESH_BINARY);

    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.morphologyEx(threshold, threshold, cv.MORPH_OPEN, kernel);
    cv.morphologyEx(threshold, threshold, cv.MORPH_DILATE, kernel);
    kernel.delete();

    cv.findContours(threshold, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let bestSample: AnalysisSample | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let roiCandidates = 0;
    let acceptedCandidates = 0;
    let normalAccepted = 0;
    let fallbackAccepted = 0;
    let bestMode: DetectionResult['mode'] = 'none';

    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const area = cv.contourArea(contour);

      if (area < getDetectionAreaMin(device) || area > DETECTION_AREA_LIMITS.max) {
        contour.delete();
        continue;
      }

      const rect = cv.boundingRect(contour);
      const circle = cv.minEnclosingCircle(contour);
      const perimeter = cv.arcLength(contour, true);
      const aspectRatio = rect.height > 0 ? rect.width / rect.height : 0;
      const circularity =
        perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
      const centerX = circle.center.x;
      const centerY = circle.center.y;

      if (!isInsideDetectionRoi(centerX, centerY, imageData.width, imageData.height)) {
        contour.delete();
        continue;
      }

      roiCandidates += 1;

      const trackDistance = previousTrackedSample
        ? Math.hypot(
            centerX - previousTrackedSample.centerX,
            centerY - previousTrackedSample.centerY
          )
        : FALLBACK_BALL_SHAPE_THRESHOLDS.minDisplacementPx;
      const normalQualified =
        circularity >= BALL_SHAPE_THRESHOLDS.minCircularity &&
        aspectRatio >= BALL_SHAPE_THRESHOLDS.minAspectRatio &&
        aspectRatio <= BALL_SHAPE_THRESHOLDS.maxAspectRatio;
      const fallbackQualified =
        area >= getFallbackMinArea(device) &&
        circularity >= FALLBACK_BALL_SHAPE_THRESHOLDS.minCircularity &&
        aspectRatio >= FALLBACK_BALL_SHAPE_THRESHOLDS.minAspectRatio &&
        aspectRatio <= FALLBACK_BALL_SHAPE_THRESHOLDS.maxAspectRatio &&
        trackDistance >= getFallbackMinDisplacement(device);

      if (!normalQualified && !fallbackQualified) {
        contour.delete();
        continue;
      }

      acceptedCandidates += 1;
      if (normalQualified) {
        normalAccepted += 1;
      } else {
        fallbackAccepted += 1;
      }

      const trackingPenalty =
        previousTrackedSample && trackDistance > getMaxTrackDistancePx(device)
          ? -2.2
          : 0;
      const proximityScore = previousTrackedSample
        ? Math.max(0, 1 - trackDistance / getMaxTrackDistancePx(device))
        : 0.45;
      const areaScore = Math.min(area / 1100, 1.25);
      const circularityScore = circularity * (normalQualified ? 1.8 : 0.9);
      const aspectScore = 1 - Math.min(Math.abs(1 - aspectRatio), 1);
      const fallbackBoost = fallbackQualified && !normalQualified ? 0.7 : 0;
      const candidateScore =
        areaScore +
        circularityScore +
        aspectScore +
        proximityScore * 2.2 +
        fallbackBoost +
        trackingPenalty;

      const candidate: AnalysisSample = {
        time,
        centerX,
        centerY,
        area,
        radiusPx: circle.radius,
        grayFrame: gray,
      };

      if (!bestSample || candidateScore > bestScore) {
        bestSample = candidate;
        bestScore = candidateScore;
        bestMode = normalQualified ? 'normal' : 'fallback';
      }

      contour.delete();
    }

    if (!bestSample) {
      gray.delete();
    }

    return {
      sample: bestSample,
      roiCandidateCount: roiCandidates,
      acceptedCandidateCount: acceptedCandidates,
      normalAcceptedCount: normalAccepted,
      fallbackAcceptedCount: fallbackAccepted,
      mode: bestMode,
    };
  } finally {
    source.delete();
    diff.delete();
    threshold.delete();
    contours.delete();
    hierarchy.delete();
  }
}

function filterStableSamples(samples: AnalysisSample[]): AnalysisSample[] {
  if (samples.length < ANALYSIS_SAMPLE_LIMITS.minCandidateFrames) {
    return samples;
  }

  if (samples.length <= 2) {
    return samples;
  }

  const filtered = [samples[0]];

  for (let index = 1; index < samples.length; index += 1) {
    const previous = filtered[filtered.length - 1];
    const current = samples[index];
    const displacement = Math.hypot(current.centerX - previous.centerX, current.centerY - previous.centerY);

    if (displacement >= MIN_DISPLACEMENT_PIXELS) {
      filtered.push(current);
    }

    if (filtered.length >= ANALYSIS_SAMPLE_LIMITS.maxFramesForSpeed) {
      break;
    }
  }

  if (filtered.length >= ANALYSIS_SAMPLE_LIMITS.minStableFrames) {
    return filtered;
  }

  return samples.slice(0, Math.min(samples.length, 3));
}

function isInsideDetectionRoi(
  centerX: number,
  centerY: number,
  width: number,
  height: number
) {
  const left = width * DETECTION_ROI.left;
  const right = width * DETECTION_ROI.right;
  const top = height * DETECTION_ROI.top;
  const bottom = height * DETECTION_ROI.bottom;

  return centerX >= left && centerX <= right && centerY >= top && centerY <= bottom;
}

function estimateInitialSpeedKmh(samples: AnalysisSample[]): number {
  if (samples.length < 2) {
    throw new Error('速度推定に必要な移動量が不足しています。');
  }

  const velocities: number[] = [];

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const elapsed = current.time - previous.time;

    if (elapsed <= 0) {
      continue;
    }

    const displacementPx = Math.hypot(current.centerX - previous.centerX, current.centerY - previous.centerY);
    const estimatedBallDiameterPx = Math.max((current.radiusPx + previous.radiusPx) / 2 * 2, 1);
    const pixelsPerMeter = Math.max(
      estimatedBallDiameterPx / BALL_DIAMETER_METERS,
      DEFAULT_PIXELS_PER_METER
    );

    const metersPerSecond = displacementPx / pixelsPerMeter / elapsed;
    velocities.push(metersPerSecond * 3.6);
  }

  if (!velocities.length && samples.length >= 2) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = last.time - first.time;
    const displacementPx = Math.hypot(last.centerX - first.centerX, last.centerY - first.centerY);

    if (elapsed > 0 && displacementPx >= FALLBACK_BALL_SHAPE_THRESHOLDS.minDisplacementPx) {
      const estimatedBallDiameterPx = Math.max((first.radiusPx + last.radiusPx) / 2 * 2, 1);
      const pixelsPerMeter = Math.max(
        estimatedBallDiameterPx / BALL_DIAMETER_METERS,
        DEFAULT_PIXELS_PER_METER
      );
      const metersPerSecond = displacementPx / pixelsPerMeter / elapsed;
      velocities.push(metersPerSecond * 3.6);
      console.info('[analyzeKickVideo] 速度計算を fallback 差分で実行', {
        displacementPx,
        elapsed,
      });
    }
  }

  if (!velocities.length) {
    throw new Error('速度推定に必要な移動量が不足しています。');
  }

  const stabilizedSpeed = stabilizeVelocities(velocities);
  console.info('[analyzeKickVideo] stabilized velocities', {
    raw: velocities,
    stabilizedSpeed,
  });
  return stabilizedSpeed;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function buildMotionFallbackResult(
  samples: AnalysisSample[],
  device: ReturnType<typeof detectClientDevice>
): AnalysisResult | null {
  if (samples.length < 2) {
    return null;
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const displacementPx = Math.hypot(last.centerX - first.centerX, last.centerY - first.centerY);
  const elapsed = Math.max(last.time - first.time, ANALYSIS_FRAME_INTERVAL_MS / 1000);

  if (displacementPx < getFallbackMinDisplacement(device)) {
    return null;
  }

  const estimatedBallDiameterPx = Math.max((first.radiusPx + last.radiusPx) / 2 * 2, 1);
  const pixelsPerMeter = Math.max(
    estimatedBallDiameterPx / BALL_DIAMETER_METERS,
    DEFAULT_PIXELS_PER_METER
  );
  const rawSpeedKmh = (displacementPx / pixelsPerMeter / elapsed) * 3.6;
  const estimatedSpeedKmh = roundToStep(
    clamp(
      Math.max(rawSpeedKmh * SPEED_ESTIMATION.fallbackScale, SPEED_ESTIMATION.minimumTrustedSpeedKmh),
      RESULT_SPEED_CLAMP.min,
      SPEED_ESTIMATION.fallbackMaxKmh
    ),
    SPEED_ESTIMATION.roundStepKmh
  );

  return {
    estimatedSpeedKmh,
    detectionFrames: samples.length,
    samples: samples.map(({ grayFrame: _grayFrame, ...sample }) => sample),
  };
}

function detectClientDevice() {
  if (typeof navigator === 'undefined') {
    return {
      isIPhone: false,
      isSafari: false,
      isIosSafari: false,
      userAgent: 'server',
    };
  }

  const userAgent = navigator.userAgent;
  const isIPhone = /iPhone|iPad|iPod/i.test(userAgent);
  const isSafari = /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent);

  return {
    isIPhone,
    isSafari,
    isIosSafari: isIPhone && isSafari,
    userAgent,
  };
}

function stabilizeVelocities(velocities: number[]) {
  const sorted = [...velocities].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const filtered = sorted.filter(
    (value) =>
      value >= median * SPEED_ESTIMATION.outlierLowMultiplier &&
      value <= median * SPEED_ESTIMATION.outlierHighMultiplier
  );
  const target = (filtered.length ? filtered : sorted).slice(-3);
  const average = target.reduce((sum, value) => sum + value, 0) / target.length;

  return roundToStep(
    clamp(
      Math.max(average, SPEED_ESTIMATION.minimumTrustedSpeedKmh),
      RESULT_SPEED_CLAMP.min,
      RESULT_SPEED_CLAMP.max
    ),
    SPEED_ESTIMATION.roundStepKmh
  );
}

function roundToStep(value: number, step: number) {
  return Math.round(value / step) * step;
}

function getDetectionAreaMin(device: ReturnType<typeof detectClientDevice>) {
  return device.isIosSafari ? IOS_SAFARI_RELAXED_LIMITS.detectionAreaMin : DETECTION_AREA_LIMITS.min;
}

function getMaxTrackDistancePx(device: ReturnType<typeof detectClientDevice>) {
  return device.isIosSafari
    ? IOS_SAFARI_RELAXED_LIMITS.maxTrackDistancePx
    : BALL_SHAPE_THRESHOLDS.maxTrackDistancePx;
}

function getFallbackMinArea(device: ReturnType<typeof detectClientDevice>) {
  return device.isIosSafari ? IOS_SAFARI_RELAXED_LIMITS.fallbackMinArea : FALLBACK_BALL_SHAPE_THRESHOLDS.minArea;
}

function getFallbackMinDisplacement(device: ReturnType<typeof detectClientDevice>) {
  return device.isIosSafari
    ? IOS_SAFARI_RELAXED_LIMITS.fallbackMinDisplacementPx
    : FALLBACK_BALL_SHAPE_THRESHOLDS.minDisplacementPx;
}

function getMinStableFrames(device: ReturnType<typeof detectClientDevice>) {
  return device.isIosSafari ? IOS_SAFARI_RELAXED_LIMITS.minStableFrames : ANALYSIS_SAMPLE_LIMITS.minStableFrames;
}

function getMinCandidateFrames(device: ReturnType<typeof detectClientDevice>) {
  return device.isIosSafari
    ? IOS_SAFARI_RELAXED_LIMITS.minCandidateFrames
    : ANALYSIS_SAMPLE_LIMITS.minCandidateFrames;
}

function buildRetryMessage(device: ReturnType<typeof detectClientDevice>) {
  if (device.isIosSafari) {
    return 'ボールがガイド範囲外か、動きの検出フレームが不足しました。ボールをガイド中央に置いて、まず軽く横に動かしてみてください。';
  }

  return 'ボールがガイド範囲外か、動きの検出フレームが不足しました。カメラ位置を少し近づけて再挑戦してください。';
}

function ensurePlayableVideo(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 1200);

    function cleanup() {
      window.clearTimeout(timeoutId);
      video.onloadeddata = null;
      video.ondurationchange = null;
    }

    const handleReady = () => {
      if (video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0) {
        cleanup();
        resolve();
      }
    };

    video.onloadeddata = handleReady;
    video.ondurationchange = handleReady;
  });
}

function logAnalysisFailure(payload: {
  roi: typeof DETECTION_ROI;
  device: ReturnType<typeof detectClientDevice>;
  extractedFrames: number;
  candidateFrames: number;
  adoptedFrames: number;
  roiCandidateCount: number;
  acceptedCandidateCount: number;
  normalAcceptedCount: number;
  fallbackAcceptedCount: number;
  frameCandidateCounts: number[];
  frameAcceptedCounts: number[];
  frameModes: string[];
  reason: string;
  mode: string;
}) {
  console.warn('[analyzeKickVideo] 解析失敗', {
    ...payload,
    thresholds: {
      area: DETECTION_AREA_LIMITS,
      normalShape: BALL_SHAPE_THRESHOLDS,
      fallbackShape: FALLBACK_BALL_SHAPE_THRESHOLDS,
      iosSafari: IOS_SAFARI_RELAXED_LIMITS,
    },
  });
}
