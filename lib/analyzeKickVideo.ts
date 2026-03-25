import {
  ANALYSIS_FRAME_INTERVAL_MS,
  BALL_DIAMETER_METERS,
  BALL_SHAPE_THRESHOLDS,
  DEFAULT_PIXELS_PER_METER,
  DETECTION_AREA_LIMITS,
  DETECTION_ROI,
  MIN_DISPLACEMENT_PIXELS,
  MOTION_THRESHOLD,
  RESULT_SPEED_CLAMP,
} from '@/settings/constants';
import type {
  AnalysisResult,
  AnalysisSample,
  AnalyzeKickVideoParams,
  OpenCvContourVector,
  OpenCvModule,
} from '@/lib/types';

export async function analyzeKickVideo({
  cv,
  videoBlob,
}: AnalyzeKickVideoParams): Promise<AnalysisResult> {
  const videoUrl = URL.createObjectURL(videoBlob);
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;

  try {
    await waitForLoadedMetadata(video);

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

    for (
      let currentTime = 0;
      currentTime < video.duration;
      currentTime += ANALYSIS_FRAME_INTERVAL_MS / 1000
    ) {
      await seekVideo(video, currentTime);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const sample = detectMotionSample(
        cv,
        imageData,
        previousGray,
        previousTrackedSample,
        currentTime
      );

      if (sample) {
        samples.push(sample);
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

    if (samples.length < 2) {
      throw new Error('ボールの動きを十分に検出できませんでした。撮影位置を調整して再挑戦してください。');
    }

    const filteredSamples = filterStableSamples(samples);
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
  time: number
): AnalysisSample | null {
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
        time,
        centerX: 0,
        centerY: 0,
        area: 0,
        radiusPx: 0,
        grayFrame: gray,
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

    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const area = cv.contourArea(contour);

      if (area < DETECTION_AREA_LIMITS.min || area > DETECTION_AREA_LIMITS.max) {
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

      if (
        circularity < BALL_SHAPE_THRESHOLDS.minCircularity ||
        aspectRatio < BALL_SHAPE_THRESHOLDS.minAspectRatio ||
        aspectRatio > BALL_SHAPE_THRESHOLDS.maxAspectRatio
      ) {
        contour.delete();
        continue;
      }

      const trackDistance = previousTrackedSample
        ? Math.hypot(
            centerX - previousTrackedSample.centerX,
            centerY - previousTrackedSample.centerY
          )
        : 0;
      const trackingPenalty =
        previousTrackedSample && trackDistance > BALL_SHAPE_THRESHOLDS.maxTrackDistancePx
          ? -4
          : 0;
      const proximityScore = previousTrackedSample
        ? Math.max(0, 1 - trackDistance / BALL_SHAPE_THRESHOLDS.maxTrackDistancePx)
        : 0.35;
      const areaScore = Math.min(area / 1200, 1.2);
      const circularityScore = circularity * 1.8;
      const aspectScore = 1 - Math.min(Math.abs(1 - aspectRatio), 1);
      const candidateScore =
        areaScore + circularityScore + aspectScore + proximityScore * 2.4 + trackingPenalty;

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
      }

      contour.delete();
    }

    if (!bestSample) {
      gray.delete();
    }

    return bestSample;
  } finally {
    source.delete();
    diff.delete();
    threshold.delete();
    contours.delete();
    hierarchy.delete();
  }
}

function filterStableSamples(samples: AnalysisSample[]): AnalysisSample[] {
  const valid = samples.filter((sample) => sample.area > 0);

  if (valid.length < 2) {
    return valid;
  }

  const filtered = [valid[0]];

  for (let index = 1; index < valid.length; index += 1) {
    const previous = filtered[filtered.length - 1];
    const current = valid[index];
    const displacement = Math.hypot(current.centerX - previous.centerX, current.centerY - previous.centerY);

    if (displacement >= MIN_DISPLACEMENT_PIXELS) {
      filtered.push(current);
    }

    if (filtered.length >= 4) {
      break;
    }
  }

  return filtered;
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

  if (!velocities.length) {
    throw new Error('速度推定に必要な移動量が不足しています。');
  }

  const topVelocity = Math.max(...velocities);
  return clamp(topVelocity, RESULT_SPEED_CLAMP.min, RESULT_SPEED_CLAMP.max);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
