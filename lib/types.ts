import type cvModule from '@techstark/opencv-js';

export type OpenCvModule = typeof cvModule & {
  onRuntimeInitialized?: () => void;
};

export type OpenCvContour = InstanceType<OpenCvModule['Mat']>;

export type OpenCvContourVector = InstanceType<OpenCvModule['MatVector']>;

export type AnalysisSample = {
  time: number;
  centerX: number;
  centerY: number;
  area: number;
  radiusPx: number;
  grayFrame?: InstanceType<OpenCvModule['Mat']>;
};

export type AnalysisResult = {
  estimatedSpeedKmh: number;
  detectionFrames: number;
  samples: Omit<AnalysisSample, 'grayFrame'>[];
};

export type AnalyzeKickVideoParams = {
  cv: OpenCvModule;
  videoBlob: Blob;
};

declare global {
  interface Window {
    cv?: OpenCvModule;
  }
}
