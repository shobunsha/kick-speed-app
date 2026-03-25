'use client';

import { useMemo, useState } from 'react';
import { CameraRecorder } from '@/components/CameraRecorder';
import { ErrorBanner } from '@/components/ErrorBanner';
import { MetricCard } from '@/components/MetricCard';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { APP_COPY, RANK_LABELS, RECORDING_DURATION_MS } from '@/settings/constants';
import { useOpenCv } from '@/hooks/useOpenCv';
import { analyzeKickVideo } from '@/lib/analyzeKickVideo';
import { buildKickScore, buildRank } from '@/lib/scoring';
import type { AnalysisResult } from '@/lib/types';

type ViewStep = 'home' | 'camera' | 'analyzing' | 'result';

export default function HomePage() {
  const { cv, isReady: isOpenCvReady, status: openCvStatus, error: openCvError } = useOpenCv();
  const [step, setStep] = useState<ViewStep>('home');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const summary = useMemo(() => {
    if (!analysisResult) {
      return null;
    }

    const score = buildKickScore(analysisResult.estimatedSpeedKmh);
    const rank = buildRank(score);

    return {
      score,
      rank,
    };
  }, [analysisResult]);

  const handleStart = () => {
    setErrorMessage(null);
    setAnalysisResult(null);
    setStep('camera');
  };

  const handleRetry = () => {
    setErrorMessage(null);
    setAnalysisResult(null);
    setStep('camera');
  };

  const handleBackHome = () => {
    setErrorMessage(null);
    setAnalysisResult(null);
    setStep('home');
  };

  const handleRecorded = async (videoBlob: Blob) => {
    if (!cv) {
      setErrorMessage('OpenCV.js の初期化が完了していません。数秒待ってから再度お試しください。');
      setStep('camera');
      return;
    }

    setErrorMessage(null);
    setStep('analyzing');

    try {
      const result = await analyzeKickVideo({
        cv,
        videoBlob,
      });
      setAnalysisResult(result);
      setStep('result');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : '解析に失敗しました。撮影し直してください。'
      );
      setStep('camera');
    }
  };

  return (
    <main>
      {step === 'home' && (
        <ScreenContainer
          eyebrow="AI x Soccer"
          title="AIキック初速チャレンジ"
          description="ボールを蹴った直後の映像から、推定初速をその場で表示します。イベント向けの参考値としてお楽しみください。"
          footer="産業フェスタ向けの体験アプリ"
        >
          <section className="heroCard">
            <div className="heroBadge">推定初速は参考値です</div>
            <h2>蹴って、撮って、すぐ結果</h2>
            <p>
              数秒の動画を解析し、推定初速・キックパワー点数・ランクを表示します。精密計測ではなく、体験の分かりやすさを重視した判定です。
            </p>
            <ul className="featureList">
              <li>スマホカメラでそのまま撮影</li>
              <li>{RECORDING_DURATION_MS / 1000}秒録画して自動解析</li>
              <li>結果はローカルだけで完結</li>
            </ul>
          </section>

          <div className="ctaStack">
            <PrimaryButton onClick={handleStart} disabled={!isOpenCvReady}>
              {isOpenCvReady
                ? 'チャレンジを始める'
                : openCvStatus === 'error'
                  ? 'OpenCV読込失敗'
                  : '解析準備中...'}
            </PrimaryButton>
            <p className="supportText">
              {openCvError
                ? 'OpenCVの読み込みに失敗しました。再読み込みしてください'
                : openCvStatus === 'ready'
                  ? 'OpenCVの読み込みが完了しました。スタートできます。'
                  : 'OpenCVを読み込んでいます。数秒お待ちください。'}
            </p>
          </div>

          {(errorMessage || openCvError) && (
            <ErrorBanner message={errorMessage ?? openCvError ?? 'エラーが発生しました。'} />
          )}
        </ScreenContainer>
      )}

      {step === 'camera' && (
        <ScreenContainer
          eyebrow="撮影画面"
          title="キックを撮影"
          description="ボール全体が入る位置でカメラを固定し、スタート後にキックしてください。"
          footer="録画後に自動で解析します"
        >
          <CameraRecorder
            durationMs={RECORDING_DURATION_MS}
            onRecorded={handleRecorded}
            onCancel={handleBackHome}
          />
          {errorMessage && <ErrorBanner message={errorMessage} />}
        </ScreenContainer>
      )}

      {step === 'analyzing' && (
        <ScreenContainer
          eyebrow="解析中"
          title="映像を解析しています"
          description="ボールの移動量から推定初速を算出しています。端末内のみで処理しています。"
          footer="しばらくお待ちください"
        >
          <section className="analyzingCard">
            <div className="spinner" aria-hidden="true" />
            <p>フレームをチェックして、最初の加速を抽出しています。</p>
            <p className="supportText">精密な公式球速ではなく、イベント向けの参考値です。</p>
          </section>
        </ScreenContainer>
      )}

      {step === 'result' && analysisResult && summary && (
        <ScreenContainer
          eyebrow="結果"
          title="推定初速の結果"
          description="キック直後の動きから算出した参考値です。イベント体験用の表示としてご利用ください。"
          footer={`ランク一覧: ${RANK_LABELS.join(' / ')}`}
        >
          <section className="resultHero">
            <p className="resultLabel">推定初速（参考値）</p>
            <p className="resultSpeed">{analysisResult.estimatedSpeedKmh.toFixed(1)}</p>
            <p className="resultUnit">km/h</p>
          </section>

          <section className="metricGrid">
            <MetricCard label="キックパワー" value={`${summary.score}`} subValue="/ 100 pt" />
            <MetricCard label="ランク" value={summary.rank} subValue="イベント判定" />
            <MetricCard
              label="移動追跡"
              value={`${analysisResult.detectionFrames}`}
              subValue="フレーム"
            />
          </section>

          <section className="noteCard">
            <h2>判定メモ</h2>
            <p>初動フレームの移動量を基に、ボール径の推定値を使って初速へ換算しています。</p>
            <p>ブースでの一貫した体験を優先した簡易ロジックのため、表示値は参考値です。</p>
          </section>

          <div className="ctaStack">
            <PrimaryButton onClick={handleRetry}>もう一度チャレンジ</PrimaryButton>
            <PrimaryButton variant="secondary" onClick={handleBackHome}>
              ホームに戻る
            </PrimaryButton>
          </div>
        </ScreenContainer>
      )}
    </main>
  );
}
