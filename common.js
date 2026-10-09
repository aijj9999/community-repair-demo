'use strict';
// 三個頁面共用：主題切換、安全組 DOM 的小工具、LINE 登入、呼叫後端 API、照片縮圖。

// ---------- 主題（深／淺色） ----------

(function () {
  try {
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  } catch (e) { /* 瀏覽器禁用儲存空間時，就用系統預設主題 */ }
})();

function toggleTheme() {
  const root = document.documentElement;
  const current = root.getAttribute('data-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch (e) { /* 同上 */ }
}

// ---------- 安全組 DOM ----------
// 使用者輸入的文字（叫修描述、完工說明、姓名…）一律用 textContent 放進畫面，
// 不用字串拼接組 HTML，避免被當成 HTML 語法執行（XSS）。

function el(tag, opts, children) {
  opts = opts || {};
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined && opts.text !== null) node.textContent = opts.text;
  if (opts.value !== undefined) node.value = opts.value;
  if (opts.type) node.type = opts.type;
  if (opts.id) node.id = opts.id;
  if (opts.placeholder) node.placeholder = opts.placeholder;
  if (opts.href) node.href = opts.href;
  if (opts.external) { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
  if (opts.attrs) Object.keys(opts.attrs).forEach(function (k) { node.setAttribute(k, opts.attrs[k]); });
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  (children || opts.children || []).forEach(function (c) { if (c) node.appendChild(c); });
  return node;
}

function textNode(str) {
  return document.createTextNode(str === null || str === undefined ? '' : String(str));
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function renderList(container, nodes) {
  clearChildren(container);
  nodes.forEach(function (n) { container.appendChild(n); });
}

// 後端傳來的網址只允許 https，避免 javascript: 之類的網址被點擊執行
function safeUrl(u) {
  return /^https:\/\//i.test(String(u || '')) ? u : '';
}

function photoLink(label, url) {
  const safe = safeUrl(url);
  if (!safe) return null;
  const p = el('p');
  p.appendChild(el('a', { text: label, href: safe, external: true }));
  return p;
}

function phoneLink(label, phone) {
  const text = String(phone || '').trim();
  if (!text) return null;
  const p = el('p', { className: 'muted' });
  p.appendChild(textNode(label));
  if (/^[0-9+\-\s]{6,30}$/.test(text)) {
    p.appendChild(el('a', { text: text, href: 'tel:' + text.replace(/[^0-9+]/g, '') }));
  } else {
    p.appendChild(textNode(text));
  }
  return p;
}

function range(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

function selectOf(values) {
  const s = el('select');
  values.forEach(function (v) { s.appendChild(el('option', { text: v, value: v })); });
  return s;
}

function labeled(text, control) {
  return [el('label', { text: text }), control];
}

// ---------- 狀態名稱（與後端 Config.gs 的 CASE_STATUS、RESIDENT_STATUS 對應，改名時兩邊都要改） ----------

const CASE_STEPS = ['已指派', '工人接單', '施工中', '待審核', '已結案'];
const STATUS_BADGE = {
  '已指派': 'badge-assigned', '工人接單': 'badge-accepted', '施工中': 'badge-progress',
  '待審核': 'badge-review', '已結案': 'badge-closed',
  '待核准': 'badge-assigned', '已核准': 'badge-closed', '已停用': 'badge-disabled'
};
const RESIDENT_STATUS = { PENDING: '待核准', APPROVED: '已核准', DISABLED: '已停用' };

function addressText(a) {
  return a['棟號'] + '棟 ' + a['號'] + '號 ' + a['樓層'] + '樓-' + a['之幾'];
}

// ---------- 提示訊息與按鈕忙碌狀態 ----------

let toastTimer = null;
function toast(message, isError) {
  let box = document.getElementById('toast');
  if (!box) {
    box = el('div', { id: 'toast', className: 'toast' });
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { box.className = 'toast'; }, 4000);
}

async function runBusy(btn, fn) {
  btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
  }
}

// ---------- LINE 登入（LIFF） ----------

const LIFF_TIMEOUT_MS = 20000;
const ID_TOKEN_MIN_LEFT_SEC = 60;
let currentUserId = null;

function loginLiff() {
  return new Promise(function (resolve, reject) {
    const cfg = window.APP_CONFIG || {};
    if (!cfg.LIFF_ID || !cfg.API_URL) {
      reject(new Error('網站設定不完整（config.js 缺少 LIFF_ID 或 API_URL）'));
      return;
    }
    if (typeof liff === 'undefined') {
      reject(new Error('LINE 登入元件載入失敗，請檢查網路後重新開啟'));
      return;
    }
    const timer = setTimeout(function () {
      reject(new Error('LINE 登入逾時，請關閉頁面後重新開啟'));
    }, LIFF_TIMEOUT_MS);

    liff.init({ liffId: cfg.LIFF_ID }).then(function () {
      // ID Token 約 1 小時就過期，但在 LINE 以外的瀏覽器 isLoggedIn() 仍會是 true，所以要自己檢查到期時間
      const old = liff.isLoggedIn() ? liff.getDecodedIDToken() : null;
      // LINE App 內每次開啟都會拿到新的 token，而且不能 logout／login，只在外部瀏覽器處理
      if (old && !liff.isInClient() && old.exp - Date.now() / 1000 < ID_TOKEN_MIN_LEFT_SEC) {
        liff.logout();
      }
      if (!liff.isLoggedIn()) {
        // 沒帶 redirectUri 時，登入完會回到 Endpoint URL（首頁），首頁沒有載入 LIFF 而無法完成登入
        liff.login({ redirectUri: location.href });
        return;
      }
      const decoded = liff.getDecodedIDToken();
      if (!liff.getIDToken() || !decoded) {
        throw new Error('取不到登入憑證（LIFF 需要開啟 openid 權限）');
      }
      clearTimeout(timer);
      currentUserId = decoded.sub;
      resolve(decoded);
    }).catch(function (err) {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function boot(main) {
  loginLiff().then(main).catch(showFatal);
}

function showFatal(err) {
  const box = document.getElementById('loading');
  if (!box) return;
  box.style.display = 'block';
  clearChildren(box);
  box.appendChild(el('div', { text: (err && err.message) || '發生錯誤，請稍後再試' }));
  box.appendChild(el('div', { className: 'muted', text: '若一直發生，請關閉頁面後從 LINE 選單重新開啟。' }));
}

// ---------- 呼叫後端 API ----------
// 用 text/plain 送 JSON，瀏覽器不會先發 CORS 預檢請求（Apps Script 不支援預檢）。

const API_TIMEOUT_MS = 60000;

async function api(action, args) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, API_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(window.APP_CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, idToken: liff.getIDToken(), args: args || {} }),
      signal: controller.signal
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? '連線逾時，請稍後再試' : '網路連線失敗，請檢查網路後再試');
  } finally {
    clearTimeout(timer);
  }
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error('伺服器回應格式錯誤，請稍後再試');
  }
  if (!json.ok) {
    const err = new Error(json.error || '發生未知錯誤');
    err.code = json.code;
    throw err;
  }
  return json.data;
}

// ---------- 照片：縮圖後轉成 base64 ----------
// 手機拍的照片動輒 5～10MB，先縮到最長邊 1600px、JPEG 品質 0.8（約 300～500KB）再上傳。

function prepareImage(file) {
  const MAX_SIDE = 1600;
  const QUALITY = 0.8;
  return new Promise(function (resolve, reject) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ base64: canvas.toDataURL('image/jpeg', QUALITY).split(',')[1], mimeType: 'image/jpeg' });
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error('無法讀取這張照片，請換一張（支援 JPG、PNG）'));
    };
    img.src = url;
  });
}

// 有選照片就上傳並回傳網址，沒選就回傳空字串
async function uploadPhotoIfAny(fileInput) {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return '';
  const img = await prepareImage(file);
  return api('uploadPhoto', { base64: img.base64, mimeType: img.mimeType });
}
