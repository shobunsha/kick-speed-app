'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PrimaryButton } from '@/components/PrimaryButton';
import { COUNTDOWN_START, DETECTION_ROI } from '@/settings/constants';

type CameraRecorderProps = {
  durationMs: number;
  onRecorded: (videoBlob: Blob) => Promise<void>;
  onCancel: () => void;
};

type RecorderState = 'idle' | 'preparing' | 'countdown' | 'recording' | 'processing' | 'error';

export function CameraRecorder({ durationMs, onRecorded, onCancel }: CameraRecorderProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const countdownTimerRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const [state, setState] = useState<RecorderState>('idle');
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  const [error, setError] = useState<string | null>(null);

  const statusText = useMemo(() => {
    switch (state) {
      case 'preparing':
        return '準備中です。ガイド枠にボールを合わせてください';
      case 'countdown':
        return `まもなく開始です。開始まで ${countdown}`;
      case 'recording':
        return '今蹴ってください';
      case 'processing':
        return '解析用の動画をまとめています';
      case 'error':
        return '撮影を開始できませんでした';
      default:
        return 'ガイド枠の中でボールを蹴る準備をしてください';
    }
  }, [countdown, state]);

  const supportText = useMemo(() => {
    switch (state) {
      case 'preparing':
        return '背面カメラを起動しています。少しお待ちください。';
      case 'countdown':
        return '位置を固定したまま待ち、表示が「今蹴ってください」に変わったらキックしてください。';
      case 'recording':
        return 'ボールがガイド中央を横切るように、今すぐキックしてください。';
      case 'processing':
        return '録画後に自動で解析へ進みます。';
      default:
        return `ボールと蹴り出し方向がガイド中央に入る位置にスマホを固定してください。録画時間は約${durationMs / 1000}秒です。`;
    }
  }, [durationMs, state]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.autoplay = true;
      videoRef.current.playsInline = true;
      videoRef.current.setAttribute('playsinline', 'true');
      videoRef.current.setAttribute('webkit-playsinline', 'true');
    }

    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    if (stopTimerRef.current) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const prepareCamera = async () => {
    cleanup();
    setError(null);
    setState('preparing');

    try {
      console.info('[CameraRecorder] device info', getClientDeviceInfo());

      const unsupportedMessage = getCameraUnavailableMessage();

      if (unsupportedMessage) {
        setError(unsupportedMessage);
        setState('error');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.muted = true;
        videoRef.current.autoplay = true;
        videoRef.current.playsInline = true;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setState('countdown');
      setCountdown(COUNTDOWN_START);
      startCountdown();
    } catch (cameraError) {
      setError(
        buildCameraErrorMessage(cameraError)
      );
      setState('error');
    }
  };

  const startCountdown = () => {
    countdownTimerRef.current = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          if (countdownTimerRef.current) {
            window.clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          void startRecording();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  };

  const startRecording = async () => {
    const stream = streamRef.current;
    if (!stream) {
      setError('カメラストリームが取得できませんでした。');
      setState('error');
      return;
    }

    setState('recording');
    chunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 4_000_000,
    });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onerror = () => {
      setError('録画中にエラーが発生しました。');
      setState('error');
    };

    recorder.onstop = async () => {
      setState('processing');
      try {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        await logRecordedVideoMetadata(blob);
        await onRecorded(blob);
      } catch (processingError) {
        setError(
          processingError instanceof Error
            ? processingError.message
            : '録画データの処理に失敗しました。'
        );
        setState('error');
      } finally {
        cleanup();
      }
    };

    recorder.start(200);
    stopTimerRef.current = window.setTimeout(() => {
      recorder.stop();
    }, durationMs + 350);
  };

  return (
    <section className="cameraCard">
      <div className="videoShell">
        <video ref={videoRef} className="cameraVideo" playsInline muted autoPlay />
        <div
          className="roiGuide"
          aria-hidden="true"
          style={{
            left: `${DETECTION_ROI.left * 100}%`,
            top: `${DETECTION_ROI.top * 100}%`,
            width: `${(DETECTION_ROI.right - DETECTION_ROI.left) * 100}%`,
            height: `${(DETECTION_ROI.bottom - DETECTION_ROI.top) * 100}%`,
          }}
        >
          <span className="roiGuideLabel">ガイド中央を通す</span>
        </div>
        {state === 'countdown' && <div className="countdownOverlay">{countdown}</div>}
        {state === 'recording' && <div className="shootNowOverlay">今蹴ってください</div>}
        {state === 'idle' && <div className="cameraOverlay">背面カメラを使います</div>}
      </div>

      <p className="statusText">{statusText}</p>
      <p className="supportText">{supportText}</p>

      {error && <p className="errorText">{error}</p>}

      <div className="ctaStack">
        <PrimaryButton
          onClick={() => void prepareCamera()}
          disabled={state === 'preparing' || state === 'countdown' || state === 'recording'}
        >
          {state === 'idle' || state === 'error' ? '撮影を開始' : '準備中'}
        </PrimaryButton>
        <PrimaryButton
          variant="secondary"
          onClick={onCancel}
          disabled={state === 'recording' || state === 'processing'}
        >
          キャンセル
        </PrimaryButton>
      </div>
    </section>
  );
}

function getCameraUnavailableMessage() {
  if (typeof window === 'undefined') {
    return 'この画面はブラウザで開いてください。';
  }

  const isLocalhost =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const isHttpsLike = window.location.protocol === 'https:' || isLocalhost;
  const mediaDevices = navigator.mediaDevices;

  if (!isHttpsLike && (!mediaDevices || !mediaDevices.getUserMedia)) {
    if (isIPhoneLike()) {
      return 'iPhoneではカメラ利用にHTTPS接続が必要です。ngrokや本番URLで開いてください。';
    }

    return 'この環境ではカメラ利用にHTTPS接続が必要です。HTTPSのURLで開き直してください。';
  }

  if (!mediaDevices || !mediaDevices.getUserMedia) {
    return 'このブラウザではカメラを利用できません。Safari / Chrome の最新版でお試しください。';
  }

  return null;
}

function buildCameraErrorMessage(error: unknown) {
  if (typeof window !== 'undefined' && isIPhoneLike() && !window.isSecureContext) {
    return 'iPhoneではカメラ利用にHTTPS接続が必要です。ngrokや本番URLで開いてください。';
  }

  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'カメラの使用が許可されていません。Safari の権限設定を確認してください。';
    }

    if (error.name === 'NotFoundError') {
      return '利用できるカメラが見つかりませんでした。';
    }

    if (error.name === 'NotReadableError') {
      return 'カメラがほかのアプリで使用中の可能性があります。';
    }
  }

  return error instanceof Error
    ? error.message
    : 'カメラ権限を確認してから再度お試しください。';
}

function isIPhoneLike() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function getClientDeviceInfo() {
  if (typeof navigator === 'undefined') {
    return { userAgent: 'server', isIPhone: false, isSafari: false };
  }

  const userAgent = navigator.userAgent;
  return {
    userAgent,
    isIPhone: /iPhone|iPad|iPod/i.test(userAgent),
    isSafari: /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent),
  };
}

async function logRecordedVideoMetadata(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.playsInline = true;
  video.muted = true;
  video.src = url;

  try {
    await new Promise<void>((resolve) => {
      const timeoutId = window.setTimeout(resolve, 1500);
      const done = () => {
        window.clearTimeout(timeoutId);
        resolve();
      };
      video.onloadedmetadata = done;
      video.onloadeddata = done;
      video.ondurationchange = done;
      video.onerror = done;
    });

    console.info('[CameraRecorder] recorded video metadata', {
      size: blob.size,
      type: blob.type,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      readyState: video.readyState,
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
