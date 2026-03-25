# AIキック初速チャレンジ

産業フェスタ向けのスマホ体験用 Web アプリです。サッカーボールを蹴った直後の短い動画を端末内で解析し、推定初速の参考値、キックパワー点数、ランクを表示します。

## 特徴

- Next.js + TypeScript + App Router
- 日本語 UI のスマホ向けレイアウト
- `MediaRecorder` による数秒録画
- OpenCV.js による簡易動体検出
- サーバー不要、ローカル完結
- Vercel へデプロイしやすい静的構成

## 画面

- ホーム画面
- 撮影画面
- 解析中画面
- 結果画面

## ディレクトリ構成

```text
app/         App Router の画面とグローバルスタイル
components/  UI コンポーネント
hooks/       OpenCV.js 読み込みなどのフック
lib/         解析ロジック、スコア計算、型定義
settings/    定数
public/      OpenCV.js のローカル配信用アセット
```

## セットアップ

1. Node.js 22 系を用意します。
2. 依存関係をインストールします。

```bash
npm install
```

`postinstall` により `public/vendor/opencv.js` が自動生成されます。

## 起動方法

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開き、スマホ実機または HTTPS 対応のローカル環境でカメラ権限を許可してください。

## ビルド確認

```bash
npm run typecheck
npm run build
```

## 実装メモ

- 解析は連続フレーム差分から最も大きい動体を抽出し、初動数フレームの重心移動量を速度へ換算します。
- ボール径の推定と既定のスケールを併用し、イベント用途として一貫した結果を返す構成です。
- 表示される速度は精密な公式球速ではなく、あくまで参考値です。

## Vercel デプロイ

1. このプロジェクトを Git リポジトリへ push します。
2. Vercel で対象リポジトリを Import します。
3. Framework Preset は `Next.js` を選択します。
4. Build Command は既定値のままで構いません。
5. Deploy を実行します。

補足:

- カメラ利用には HTTPS が必要です。Vercel 本番 URL ならそのまま利用できます。
- `npm install` 時に `postinstall` が走るため、OpenCV.js は自動で `public/vendor` に配置されます。

## 今後の改善候補

- キック方向を固定するためのガイド枠や AR 風オーバーレイ追加
- 検出対象を色相や円形度でも絞り、ボール追跡精度を改善
- 端末ごとの画角差を補正する簡易キャリブレーション
- 結果履歴の保存やランキング演出の追加
- Web Worker への解析分離による体感速度改善
