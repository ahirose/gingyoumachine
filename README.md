# 吟行マシン / Gingyou Machine

写真を撮ると、AIが俳句を詠んでくれるPWAアプリです。

A PWA app that generates haiku poems from your photos using AI.

## 機能 / Features

- 📷 写真撮影 → AIが俳句を自動生成 / Take a photo → AI generates a haiku
- 🖌️ 写真に俳句を縦書きで合成 / Composites haiku vertically onto the photo
- 💾 合成画像の保存・共有 / Save and share the composited image
- 📱 PWA対応（ホーム画面に追加可能） / PWA support (installable)
- 🔒 APIキーはローカル保存、バックエンド不要 / API key stored locally, no backend needed

## 使い方 / How to Use

1. ⚙ 設定画面で [Gemini APIキー](https://aistudio.google.com/apikey) を入力
2. 📷 「写真を撮る」ボタンで撮影
3. 🤖 AIが写真を読み取り、季語を含む俳句を生成
4. 🖼️ 写真に俳句が合成された画像を保存・共有

---

1. ⚙ Enter your [Gemini API key](https://aistudio.google.com/apikey) in Settings
2. 📷 Tap "Take Photo" to capture
3. 🤖 AI reads the photo and generates a haiku with a seasonal word
4. 🖼️ Save or share the composited image

## 技術スタック / Tech Stack

- HTML / CSS / JavaScript（フレームワーク不使用 / no frameworks）
- [Gemini API](https://ai.google.dev/)（gemini-2.0-flash） — 画像認識 + 俳句生成 / image recognition + haiku generation
- Canvas API — 画像合成・縦書き描画 / image compositing & vertical text
- Service Worker — オフラインキャッシュ / offline caching
- Web Share API — 共有機能 / sharing

## ローカル実行 / Run Locally

```bash
npx serve .
```

## ライセンス / License

MIT
