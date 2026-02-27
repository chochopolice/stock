// ============================
// 設定
// ============================

// ★ここをあなたのAPI Gatewayエンドポイントに差し替えてください
// 例: "https://xxxx.execute-api.ap-northeast-1.amazonaws.com"
const API_BASE_URL = ""; // 未設定なら空のまま（その場合は送信時にエラー表示）

const TICKER_DICT_PATH = "./tickers_jp.json";

// Fuse検索設定（ゆるさはここで調整）
const FUSE_OPTIONS = {
  includeScore: true,
  threshold: 0.35, // 小さいほど厳密。0.2-0.4あたりが使いやすい
  ignoreLocation: true,
  keys: [
    { name: "code", weight: 0.5 },
    { name: "name", weight: 1.0 },
    { name: "kana", weight: 0.7 },
    { name: "aliases", weight: 0.9 }
  ]
};

// ============================
// DOM
// ============================
const $input = document.getElementById("tickerInput");
const $btnResolve = document.getElementById("btnResolve");
const $btnAnalyze = document.getElementById("btnAnalyze");
const $candidates = document.getElementById("candidates");
const $resolvedText = document.getElementById("resolvedText");
const $dictStatus = document.getElementById("dictStatus");
const $result = document.getElementById("result");
const $asOf = document.getElementById("asOf");
const $mode = document.getElementById("mode");

// ============================
// 状態
// ============================
let tickerDict = [];
let fuse = null;
let resolved = null;

// ============================
// ユーティリティ
// ============================
function setResult(objOrText, isError = false) {
  if (typeof objOrText === "string") {
    $result.textContent = objOrText;
  } else {
    $result.textContent = JSON.stringify(objOrText, null, 2);
  }
  $result.classList.toggle("error", isError);
}

function normalizeQuery(q) {
  if (!q) return "";
  let s = q.trim();

  // 全角英数字→半角（簡易）
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );

  // よくある法人表記を削除
  s = s.replace(/株式会社/g, "");
  s = s.replace(/\(株\)/g, "");
  s = s.replace(/（株）/g, "");

  // 記号類・空白を圧縮
  s = s.replace(/[・\s\-_/]/g, "");

  return s;
}

function isLikelyCode(q) {
  // 4桁コードを主に想定（ETF等は例外あるがMVPは4桁）
  return /^[0-9]{4}$/.test(q);
}

function renderCandidates(items) {
  $candidates.innerHTML = "";

  if (!items || items.length === 0) {
    const div = document.createElement("div");
    div.className = "hint";
    div.textContent = "候補が見つかりませんでした。別の入力を試してください。";
    $candidates.appendChild(div);
    return;
  }

  for (const item of items) {
    const div = document.createElement("div");
    div.className = "candidate";
    div.innerHTML = `
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span class="code">(${escapeHtml(item.code)})</span>
      </div>
      <div class="code">選択</div>
    `;
    div.addEventListener("click", () => {
      resolved = { code: item.code, name: item.name };
      $resolvedText.textContent = `${item.code} ${item.name}`;
      setResult("(確定しました。送信を押すとAPIに投げます)");
    });
    $candidates.appendChild(div);
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resolveTicker(queryRaw) {
  const qNorm = normalizeQuery(queryRaw);

  if (!qNorm) return { resolved: null, candidates: [] };

  // コードっぽい場合は、まずコード完全一致
  if (isLikelyCode(qNorm)) {
    const exact = tickerDict.find((t) => t.code === qNorm);
    if (exact) return { resolved: exact, candidates: [exact] };

    // コードでFuse
    const r = fuse.search(qNorm).slice(0, 8).map((x) => x.item);
    return { resolved: r[0] ?? null, candidates: r };
  }

  // まずは完全一致（name/aliases）
  const exactByName = tickerDict.find((t) => normalizeQuery(t.name) === qNorm);
  if (exactByName) return { resolved: exactByName, candidates: [exactByName] };

  const exactByAlias = tickerDict.find((t) =>
    (t.aliases || []).some((a) => normalizeQuery(a) === qNorm)
  );
  if (exactByAlias) return { resolved: exactByAlias, candidates: [exactByAlias] };

  // Fuse検索
  const results = fuse.search(queryRaw).slice(0, 8);
  const candidates = results.map((r) => r.item);
  return { resolved: candidates[0] ?? null, candidates };
}

async function callAnalyzeApi(payload) {
  if (!API_BASE_URL) {
    throw new Error("API_BASE_URL が未設定です。app.js の先頭でAPI GatewayのURLを設定してください。");
  }

  const url = `${API_BASE_URL.replace(/\/$/, "")}/analyze`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.message || `HTTP ${res.status}`;
    throw new Error(`APIエラー: ${msg}`);
  }
  return data;
}

// ============================
// 初期化
// ============================
async function init() {
  try {
    $dictStatus.textContent = "銘柄辞書: 読み込み中…";
    const res = await fetch(TICKER_DICT_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error(`辞書の読み込みに失敗: HTTP ${res.status}`);
    tickerDict = await res.json();

    if (!Array.isArray(tickerDict)) throw new Error("tickers_jp.json が配列ではありません。");

    fuse = new Fuse(tickerDict, FUSE_OPTIONS);
    $dictStatus.textContent = `銘柄辞書: 読み込み完了（${tickerDict.length}件）`;

    // 評価日デフォルト：今日
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    $asOf.value = `${yyyy}-${mm}-${dd}`;

    setResult("(準備OK。銘柄を入力してください)");
  } catch (e) {
    $dictStatus.textContent = "銘柄辞書: 読み込み失敗";
    setResult(String(e?.message || e), true);
    $btnResolve.disabled = true;
    $btnAnalyze.disabled = true;
  }
}

// ============================
// イベント
// ============================
$btnResolve.addEventListener("click", () => {
  const q = $input.value;
  const { resolved: r, candidates } = resolveTicker(q);

  renderCandidates(candidates);

  if (r) {
    resolved = { code: r.code, name: r.name };
    $resolvedText.textContent = `${r.code} ${r.name}`;
    setResult("(候補を表示しました。必要なら候補をクリックして変更できます)");
  } else {
    resolved = null;
    $resolvedText.textContent = "未選択";
    setResult("候補が見つかりませんでした。入力を変えて試してください。", true);
  }
});

$btnAnalyze.addEventListener("click", async () => {
  try {
    const q = $input.value;
    if (!q || !q.trim()) {
      setResult("銘柄が未入力です。", true);
      return;
    }
    if (!fuse) {
      setResult("辞書が未初期化です。ページを再読み込みしてください。", true);
      return;
    }

    // 未確定なら自動resolve
    if (!resolved) {
      const { resolved: r, candidates } = resolveTicker(q);
      renderCandidates(candidates);
      if (!r) {
        setResult("候補が見つからないため送信できません。", true);
        return;
      }
      resolved = { code: r.code, name: r.name };
      $resolvedText.textContent = `${r.code} ${r.name}`;
    }

    const payload = {
      query: q,
      resolved: { ...resolved },
      asOf: $asOf.value || null,
      options: { mode: $mode.value || "B" }
    };

    setResult("APIに送信中…");

    const data = await callAnalyzeApi(payload);
    setResult(data, false);
  } catch (e) {
    setResult(String(e?.message || e), true);
  }
});

// Enterキーで候補検索
$input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") $btnResolve.click();
});

// 起動
init();
