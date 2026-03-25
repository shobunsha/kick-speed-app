'use client';

import { useEffect, useState } from 'react';
import type { OpenCvModule } from '@/lib/types';

const OPEN_CV_SCRIPT_SELECTOR = 'script[data-opencv-script="true"]';
const OPEN_CV_ERROR_MESSAGE = 'OpenCVの読み込みに失敗しました。再読み込みしてください';
const OPEN_CV_SRC = '/vendor/opencv.js';
const OPEN_CV_TIMEOUT_MS = 15000;
const OPEN_CV_POLL_INTERVAL_MS = 100;

let openCvModuleCache: OpenCvModule | null = null;
let openCvPromise: Promise<OpenCvModule> | null = null;

export type OpenCvStatus = 'loading' | 'ready' | 'error';

type UseOpenCvResult = {
  cv: OpenCvModule | null;
  status: OpenCvStatus;
  isReady: boolean;
  error: string | null;
};

export function useOpenCv(): UseOpenCvResult {
  const [cv, setCv] = useState<OpenCvModule | null>(null);
  const [status, setStatus] = useState<OpenCvStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      console.info('[useOpenCv] OpenCV.js 読み込み開始');
      setStatus('loading');
      setError(null);

      try {
        const loadedCv = await loadOpenCv();

        if (!mounted) {
          return;
        }

        console.info('[useOpenCv] OpenCV.js 読み込み成功');
        setCv(loadedCv);
        setStatus('ready');
      } catch (loadError) {
        console.error('[useOpenCv] OpenCV.js 読み込み失敗', loadError);

        if (mounted) {
          setCv(null);
          setStatus('error');
          setError(OPEN_CV_ERROR_MESSAGE);
        }
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, []);

  return {
    cv,
    status,
    isReady: Boolean(cv),
    error,
  };
}

function loadOpenCv(): Promise<OpenCvModule> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('ブラウザ環境でのみ OpenCV.js を読み込めます。'));
  }

  if (openCvModuleCache) {
    console.info('[useOpenCv] キャッシュ済みの OpenCV モジュールを再利用');
    return Promise.resolve(openCvModuleCache);
  }

  if (isReadyModule(window.cv)) {
    console.info('[useOpenCv] window.cv から OpenCV モジュールを再利用');
    openCvModuleCache = window.cv;
    return Promise.resolve(window.cv);
  }

  if (openCvPromise) {
    console.info('[useOpenCv] 進行中の OpenCV 読み込みを待機');
    return openCvPromise;
  }

  openCvPromise = new Promise<OpenCvModule>((resolve, reject) => {
    const script = ensureOpenCvScript();
    let settled = false;

    const timeoutId = window.setTimeout(() => {
      finalizeError(new Error('OpenCV.js の初期化がタイムアウトしました。'));
    }, OPEN_CV_TIMEOUT_MS);

    const intervalId = window.setInterval(() => {
      void resolveFromWindowCv();
    }, OPEN_CV_POLL_INTERVAL_MS);

    function cleanup() {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    }

    function finalizeSuccess(module: OpenCvModule) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      openCvModuleCache = module;
      resolve(module);
    }

    function finalizeError(error: Error) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    }

    async function resolveFromWindowCv() {
      if (settled || typeof window === 'undefined' || !window.cv) {
        return;
      }

      try {
        const resolvedValue = await Promise.resolve(window.cv);

        if (!isReadyModule(resolvedValue)) {
          return;
        }

        console.info('[useOpenCv] window.cv の初期化完了を確認');
        finalizeSuccess(resolvedValue);
      } catch (error) {
        finalizeError(
          error instanceof Error ? error : new Error('OpenCV.js の初期化に失敗しました。')
        );
      }
    }

    function handleLoad() {
      console.info('[useOpenCv] /vendor/opencv.js の script load 完了');
      script.dataset.loaded = 'true';
      void resolveFromWindowCv();
    }

    function handleError() {
      console.error('[useOpenCv] /vendor/opencv.js の script load に失敗');
      finalizeError(new Error('OpenCV.js の script 読み込みに失敗しました。'));
    }

    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);

    if (script.dataset.loaded === 'true') {
      console.info('[useOpenCv] 読み込み済み script を検出');
      void resolveFromWindowCv();
      return;
    }

    if (window.cv) {
      console.info('[useOpenCv] script load 前に window.cv を検出');
      void resolveFromWindowCv();
    }
  }).catch((error) => {
    openCvPromise = null;
    openCvModuleCache = null;
    throw error;
  });

  return openCvPromise;
}

function ensureOpenCvScript() {
  const existingScript = document.querySelector<HTMLScriptElement>(OPEN_CV_SCRIPT_SELECTOR);

  if (existingScript) {
    console.info('[useOpenCv] 既存の OpenCV script タグを再利用');
    return existingScript;
  }

  const script = document.createElement('script');
  script.src = OPEN_CV_SRC;
  script.async = true;
  script.defer = true;
  script.dataset.opencvScript = 'true';
  console.info('[useOpenCv] /vendor/opencv.js を追加して読み込み');
  document.body.appendChild(script);
  return script;
}

function isReadyModule(value: unknown): value is OpenCvModule {
  return typeof value === 'object' && value !== null && 'Mat' in value;
}

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return typeof value === 'object' && value !== null && 'then' in value;
}
