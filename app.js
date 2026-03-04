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

// --- 位置情報 ---
async function getLocation() {
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
    });
    const { latitude, longitude } = pos.coords;
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=ja`, {
      headers: { 'User-Agent': 'GingyouMachine/1.0' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name || null;
  } catch {
    return null;
  }
}

// --- 撮影日時（EXIF） ---
function getPhotoDateTime(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const view = new DataView(reader.result);
        if (view.getUint16(0) !== 0xFFD8) { resolve(null); return; }
        let offset = 2;
        while (offset < view.byteLength - 1) {
          const marker = view.getUint16(offset);
          if (marker === 0xFFE1) { // APP1
            const length = view.getUint16(offset + 2);
            const exif = parseExifDate(view, offset + 4, length);
            resolve(exif);
            return;
          }
          if ((marker & 0xFF00) !== 0xFF00) break;
          offset += 2 + view.getUint16(offset + 2);
        }
        resolve(null);
      } catch { resolve(null); }
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

function parseExifDate(view, start, length) {
  const exifStr = String.fromCharCode(view.getUint8(start), view.getUint8(start+1), view.getUint8(start+2), view.getUint8(start+3));
  if (exifStr !== 'Exif') return null;
  const tiffStart = start + 6;
  const le = view.getUint16(tiffStart) === 0x4949;
  const g16 = (o) => view.getUint16(o, le);
  const g32 = (o) => view.getUint32(o, le);

  function findTag(ifdOffset, tag) {
    const count = g16(ifdOffset);
    for (let i = 0; i < count; i++) {
      const entry = ifdOffset + 2 + i * 12;
      if (g16(entry) === tag) return entry;
    }
    return null;
  }

  function readString(offset, len) {
    let s = '';
    for (let i = 0; i < len - 1; i++) s += String.fromCharCode(view.getUint8(offset + i));
    return s;
  }

  const ifd0 = tiffStart + g32(tiffStart + 4);
  const exifEntry = findTag(ifd0, 0x8769); // ExifIFD pointer
  if (!exifEntry) return null;
  const exifIfd = tiffStart + g32(exifEntry + 8);
  const dtEntry = findTag(exifIfd, 0x9003); // DateTimeOriginal
  if (!dtEntry) return null;
  const dtOffset = tiffStart + g32(dtEntry + 8);
  const raw = readString(dtOffset, 20); // "YYYY:MM:DD HH:MM:SS"
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日 ${m[4]}時${m[5]}分`;
}

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
    const [base64, location, dateTime] = await Promise.all([resizeAndEncode(file), getLocation(), getPhotoDateTime(file)]);
    const haiku = await generateHaiku(base64, location, dateTime);
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
async function generateHaiku(base64, location, dateTime) {
  const apiKey = localStorage.getItem('gemini_api_key');
  if (!apiKey) throw new Error('APIキーが設定されていません');

  let context = '';
  if (location) context += `この写真は「${location}」で撮影されました。`;
  if (dateTime) context += `撮影日時は${dateTime}です。`;
  const prompt = context
    ? `${context}この情報と写真の内容を踏まえて、季語を含む俳句を一句詠んでください。五七五の形式で、俳句のみを出力してください。余計な説明は不要です。`
    : 'この写真を見て、季語を含む俳句を一句詠んでください。五七五の形式で、俳句のみを出力してください。余計な説明は不要です。';

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64 } },
          { text: prompt }
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
      const printable = chars.filter(c => c !== '\n').length;
      const padding = img.height * 0.08;
      const availableH = img.height - padding * 2;
      const lineHeight = availableH / printable;
      const fontSize = Math.min(Math.max(16, Math.floor(lineHeight / 1.3)), Math.round(img.height / 12));
      ctx.font = `${fontSize}px "Hiragino Mincho ProN", "Yu Mincho", serif`;

      // 半透明帯（右側）
      const bandW = fontSize * 2.5;
      const bandX = img.width - bandW - fontSize * 0.5;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(bandX, 0, bandW, img.height);

      // 縦書きテキスト
      ctx.fillStyle = '#2d1b14';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const x = bandX + bandW / 2;
      const totalH = (printable - 1) * fontSize * 1.3;
      const startY = (img.height - totalH) / 2;

      chars.forEach((ch, i) => {
        if (ch === '\n') return;
        const idx = chars.slice(0, i).filter(c => c !== '\n').length;
        ctx.fillText(ch, x, startY + idx * fontSize * 1.3);
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
