import {
  ANALYSIS_FRAME_INTERVAL_MS,
  ANALYSIS_SAMPLE_LIMITS,
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

type DetectionResult = {
  sample: AnalysisSample | null;
  roiCandidateCount: number;
  acceptedCandidateCount: number;
};

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
    let roiCandidateCount = 0;
    let acceptedCandidateCount = 0;

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
        currentTime
      );
      const sample = detection.sample;
      roiCandidateCount += detection.roiCandidateCount;
      acceptedCandidateCount += detection.acceptedCandidateCount;

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

    const candidateSamples = samples.filter((sample) => sample.area > 0);
    const filteredSamples = filterStableSamples(candidateSamples);

    if (candidateSamples.length < ANALYSIS_SAMPLE_LIMITS.minCandidateFrames) {
      logAnalysisFailure({
        roiCandidateCount,
        acceptedCandidateCount,
        adoptedFrames: filteredSamples.length,
        reason: '候補フレーム不足',
      });
      throw new Error(
        'ボールがガイド範囲外か、動きの検出フレームが不足しました。カメラ位置を少し近づけて再挑戦してください。'
      );
    }

    if (filteredSamples.length < ANALYSIS_SAMPLE_LIMITS.minStableFrames) {
      logAnalysisFailure({
        roiCandidateCount,
        acceptedCandidateCount,
        adoptedFrames: filteredSamples.length,
        reason: '採用フレーム不足',
      });
      throw new Error(
        'ボールがガイド範囲外か、動きの検出フレームが不足しました。カメラ位置を少し近づけて再挑戦してください。'
      );
    }

    console.info('[analyzeKickVideo] 解析成功', {
      roi: DETECTION_ROI,
      roiCandidateCount,
      acceptedCandidateCount,
      adoptedFrames: filteredSamples.length,
    });

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

      roiCandidates += 1;

      if (
        circularity < BALL_SHAPE_THRESHOLDS.minCircularity ||
        aspectRatio < BALL_SHAPE_THRESHOLDS.minAspectRatio ||
        aspectRatio > BALL_SHAPE_THRESHOLDS.maxAspectRatio
      ) {
        contour.delete();
        continue;
      }

      acceptedCandidates += 1;

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

    return {
      sample: bestSample,
      roiCandidateCount: roiCandidates,
      acceptedCandidateCount: acceptedCandidates,
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

  return samples.slice(0, Math.min(samples.length, ANALYSIS_SAMPLE_LIMITS.minStableFrames));
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

function logAnalysisFailure({
  roiCandidateCount,
  acceptedCandidateCount,
  adoptedFrames,
  reason,
}: {
  roiCandidateCount: number;
  acceptedCandidateCount: number;
  adoptedFrames: number;
  reason: string;
}) {
  console.warn('[analyzeKickVideo] 解析失敗', {
    roi: DETECTION_ROI,
    roiCandidateCount,
    acceptedCandidateCount,
    adoptedFrames,
    reason,
  });
}
