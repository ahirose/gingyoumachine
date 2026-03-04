// --- DOM ---
const $ = id => document.getElementById(id);
const mainScreen = $('mainScreen');
const loadingScreen = $('loadingScreen');
const resultScreen = $('resultScreen');
const settingsScreen = $('settingsScreen');
const cameraInput = $('cameraInput');
const resultCanvas = $('resultCanvas');
const haikuText = $('haikuText');
const apiKeyInput = $('apiKeyInput');
const historyEl = $('history');

// --- 画面切替 ---
function showScreen(screen) {
  [loadingScreen, resultScreen, settingsScreen].forEach(s => s.hidden = true);
  mainScreen.style.display = screen === mainScreen ? '' : 'none';
  if (screen !== mainScreen) screen.hidden = false;
}

// --- 設定 ---
$('settingsBtn').onclick = () => {
  apiKeyInput.value = localStorage.getItem('gemini_api_key') || '';
  showScreen(settingsScreen);
};

$('saveKeyBtn').onclick = () => {
  const key = apiKeyInput.value.trim();
  if (key) localStorage.setItem('gemini_api_key', key);
  showScreen(mainScreen);
};

$('closeSettingsBtn').onclick = () => showScreen(mainScreen);

// --- カメラ ---
$('captureBtn').onclick = () => {
  if (!localStorage.getItem('gemini_api_key')) {
    alert('先にAPIキーを設定してください');
    showScreen(settingsScreen);
    return;
  }
  cameraInput.click();
};

cameraInput.onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  cameraInput.value = '';
  showScreen(loadingScreen);

  try {
    const base64 = await resizeAndEncode(file);
    const haiku = await generateHaiku(base64);
    await compositeImage(base64, haiku);
    haikuText.textContent = haiku;
    showScreen(resultScreen);
    saveToHistory();
  } catch (err) {
    alert('エラー: ' + err.message);
    showScreen(mainScreen);
  }
};

// --- 画像リサイズ・Base64変換 ---
function resizeAndEncode(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1024;
      let { width: w, height: h } = img;
      if (w > MAX || h > MAX) {
        const ratio = Math.min(MAX / w, MAX / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = URL.createObjectURL(file);
  });
}

// --- Gemini API ---
async function generateHaiku(base64) {
  const apiKey = localStorage.getItem('gemini_api_key');
  if (!apiKey) throw new Error('APIキーが設定されていません');

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64 } },
          { text: 'この写真を見て、季語を含む俳句を一句詠んでください。五七五の形式で、俳句のみを出力してください。余計な説明は不要です。' }
        ]
      }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API Error ${res.status}`);
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text.trim();
}

// --- 合成 ---
let currentBlob = null;

function compositeImage(base64, haiku) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = resultCanvas;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');

      // 写真描画
      ctx.drawImage(img, 0, 0);

      // 縦書き俳句の配置計算
      const chars = haiku.replace(/\s+/g, '\n').split('');
      const fontSize = Math.max(24, Math.round(img.height / 16));
      ctx.font = `${fontSize}px "Hiragino Mincho ProN", "Yu Mincho", serif`;

      // 半透明帯（右側）
      const bandW = fontSize * 2.5;
      const bandX = img.width - bandW - fontSize;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(bandX, 0, bandW, img.height);

      // 縦書きテキスト
      ctx.fillStyle = '#2d1b14';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const x = bandX + bandW / 2;
      const startY = fontSize * 1.5;
      const lineHeight = fontSize * 1.3;

      chars.forEach((ch, i) => {
        if (ch === '\n') return;
        // 改行前の文字数を数えて位置調整
        const idx = chars.slice(0, i).filter(c => c !== '\n').length;
        ctx.fillText(ch, x, startY + idx * lineHeight);
      });

      canvas.toBlob(blob => {
        currentBlob = blob;
        resolve();
      }, 'image/png');
    };
    img.src = 'data:image/jpeg;base64,' + base64;
  });
}

// --- 保存 ---
$('saveBtn').onclick = () => {
  if (!currentBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(currentBlob);
  a.download = `gingyou_${Date.now()}.png`;
  a.click();
  URL.revokeObjectURL(a.href);
};

// --- 共有 ---
if (navigator.share) {
  $('shareBtn').hidden = false;
  $('shareBtn').onclick = async () => {
    if (!currentBlob) return;
    const file = new File([currentBlob], 'gingyou.png', { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: '吟行マシン' });
    } catch {}
  };
}

// --- やり直し ---
$('retryBtn').onclick = () => showScreen(mainScreen);

// --- 履歴 ---
function saveToHistory() {
  if (!currentBlob) return;
  const reader = new FileReader();
  reader.onload = () => {
    const items = JSON.parse(localStorage.getItem('gingyou_history') || '[]');
    items.unshift({ img: reader.result, date: Date.now() });
    if (items.length > 12) items.length = 12;
    try { localStorage.setItem('gingyou_history', JSON.stringify(items)); } catch {}
    renderHistory();
  };
  reader.readAsDataURL(currentBlob);
}

function renderHistory() {
  const items = JSON.parse(localStorage.getItem('gingyou_history') || '[]');
  if (!items.length) { historyEl.innerHTML = ''; return; }
  historyEl.innerHTML = '<h3>最近の作品</h3><div class="history-grid"></div>';
  const grid = historyEl.querySelector('.history-grid');
  items.forEach(item => {
    const img = document.createElement('img');
    img.src = item.img;
    img.alt = '作品';
    img.onclick = () => {
      window.open(item.img, '_blank');
    };
    grid.appendChild(img);
  });
}

// --- 初期化 ---
renderHistory();

// --- Service Worker登録 ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}
