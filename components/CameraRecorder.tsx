'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PrimaryButton } from '@/components/PrimaryButton';
import { COUNTDOWN_START } from '@/settings/constants';

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
        return 'カメラを起動しています';
      case 'countdown':
        return `まもなく開始 ${countdown}`;
      case 'recording':
        return '録画中です。キックしてください';
      case 'processing':
        return '録画を処理しています';
      case 'error':
        return 'カメラの利用に失敗しました';
      default:
        return '準備ができたらスタートします';
    }
  }, [countdown, state]);

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
    }, durationMs);
  };

  return (
    <section className="cameraCard">
      <div className="videoShell">
        <video ref={videoRef} className="cameraVideo" playsInline muted autoPlay />
        {state === 'countdown' && <div className="countdownOverlay">{countdown}</div>}
        {state === 'idle' && <div className="cameraOverlay">背面カメラを使います</div>}
      </div>

      <p className="statusText">{statusText}</p>
      <p className="supportText">
        ボールと蹴り出し方向が見える位置にスマホを固定してください。録画時間は約
        {durationMs / 1000}秒です。
      </p>

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
