// ============================
// 設定
// ============================

// ★ここをあなたのAPI Gatewayエンドポイントに差し替えてください
// 例: "https://xxxx.execute-api.ap-northeast-1.amazonaws.com"
const API_BASE_URL = "https://1v9ywaww4i.execute-api.us-east-1.amazonaws.com"; // 未設定なら空のまま（その場合は送信時にエラー表示）

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
//const $mode = document.getElementById("mode"); //モードは有料版などの時に開放

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
  $result.classList.toggle("error", isError);

  if (typeof objOrText === "string" || isError) {
    $result.innerHTML = "";
    $result.textContent = typeof objOrText === "string" ? objOrText : JSON.stringify(objOrText, null, 2);
    return;
  }

  const comment = objOrText?.comment;
  if (!comment) {
    $result.textContent = JSON.stringify(objOrText, null, 2);
    return;
  }

  const lines = comment.split("\n").map(l => l.trim()).filter(l => l);
  const get = (label) => {
    const line = lines.find(l => l.startsWith(label));
    return line ? line.replace(label, "").trim() : "—";
  };

  const scoreColor = (score, max) => {
    const ratio = score / max;
    if (ratio >= 0.7) return "#4caf50";
    if (ratio >= 0.4) return "#ff9800";
    return "#f44336";
  };

  const verdict = get("最終判定：");
  const verdictColor = verdict === "買い" ? "#4caf50" : verdict === "保留" ? "#ff9800" : "#f44336";
  const total = parseInt(get("総合スコア：")) || 0;
  const techScore = parseInt(get("テクニカル：")) || 0;
  const fundScore = parseInt(get("ファンダメンタル：")) || 0;
  const extScore = parseInt(get("外部要因：")) || 0;

  $result.innerHTML = `
    <div style="font-family:sans-serif; font-size:0.88em; line-height:1.5;">

      <div style="color:#9ca3af; font-size:0.85em; margin-bottom:2px;">${escapeHtml(get("評価日："))}</div>

      <div style="display:flex; align-items:baseline; gap:8px; margin-bottom:6px;">
        <span style="font-size:1.1em; font-weight:bold; color:#e5e7eb;">${escapeHtml(objOrText.ticker)}</span>
        <span style="font-size:1.1em; font-weight:bold; color:#60a5fa;">${escapeHtml(get("現在株価："))}</span>
      </div>

      <div style="margin-bottom:8px;">
        <span style="background:#1e3a5f; color:#60a5fa; padding:2px 8px; border-radius:10px; font-size:0.82em;">${escapeHtml(get("区分："))}</span>
      </div>

      <div style="margin-bottom:8px;">
        <div style="font-size:0.78em; color:#6b7280; margin-bottom:3px;">スコア内訳</div>
        ${[["テクニカル", techScore, 12], ["ファンダメンタル", fundScore, 12], ["外部要因", extScore, 6]].map(([label, score, max]) => `
          <div style="display:grid; grid-template-columns:80px 1fr 40px; align-items:center; gap:6px; margin-bottom:3px;">
            <div style="font-size:0.85em; color:#9ca3af; white-space:nowrap;">${label}</div>
            <div style="background:#1f2937; border-radius:3px; height:5px;">
              <div style="width:${Math.round(score / max * 100)}%; background:${scoreColor(score, max)}; height:5px; border-radius:3px;"></div>
            </div>
            <div style="font-size:0.82em; font-weight:bold; color:#e5e7eb; text-align:right;">${score}/${max}</div>
          </div>
        `).join("")}
        <div style="text-align:right; font-size:0.82em; color:#9ca3af; margin-top:2px;">
          総合：<strong style="color:${scoreColor(total, 30)};">${total}/30</strong>
        </div>
      </div>

      <div style="display:flex; align-items:center; justify-content:center; margin-bottom:8px;">
        <span style="background:${verdictColor}; color:#fff; padding:4px 20px; border-radius:16px; font-size:0.95em; font-weight:bold;">${escapeHtml(verdict)}</span>
      </div>

      <div style="background:#0f172a; border:1px solid #1f2937; border-radius:8px; padding:8px 10px; line-height:1.8;">
        <div>📌 本命買い：<strong style="color:#e5e7eb;">${escapeHtml(get("本命買い："))}</strong></div>
        <div>📊 分割買い：<strong style="color:#e5e7eb;">${escapeHtml(get("分割買い："))}</strong></div>
        <div>👀 様子見：<strong style="color:#e5e7eb;">${escapeHtml(get("様子見："))}</strong></div>
        <div>⚠️ 割高警戒：<strong style="color:#e5e7eb;">${escapeHtml(get("割高警戒："))}</strong></div>
      </div>
    </div>
  `;
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
      $btnAnalyze.disabled = false;
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

  const url = `${API_BASE_URL}/analyze`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticker: resolved.name,
      code: resolved.code,
      asOf: payload.asOf || null,
      //mode: payload.options?.mode || "B"//モードは有料版などの時に開放
    })
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
    const raw = await res.json();
    tickerDict = Array.isArray(raw) ? raw : (raw.data || []);
    
    if (!Array.isArray(tickerDict)) throw new Error("tickers_jp.json が配列ではありません。");

    fuse = new Fuse(tickerDict, FUSE_OPTIONS);
    $dictStatus.textContent = `銘柄辞書: 読み込み完了（${tickerDict.length}件）`;
    // 評価日デフォルト：今日
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    $asOf.value = `${yyyy}-${mm}-${dd}`;

    setResult("(銘柄を入力してください)");
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
$btnAnalyze.disabled = true;
$btnResolve.addEventListener("click", () => {
  const q = $input.value;
  const { resolved: r, candidates } = resolveTicker(q);
  renderCandidates(candidates);
  if (r) {
    // resolved = { code: r.code, name: r.name };
   // $resolvedText.textContent = `${r.code} ${r.name}`; //候補が1でもユーザに選択させる
    resolved = null;
    $resolvedText.textContent = "未選択";
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
    //  resolved = { code: r.code, name: r.name };         //候補が1でもユーザに選択させる
    //  $resolvedText.textContent = `${r.code} ${r.name}`; //候補が1でもユーザに選択させる
    }

    const payload = {
      query: q,
      resolved: { ...resolved },
      asOf: $asOf.value || null,
      //options: { mode: $mode.value || "B" } //モードは有料版などの時に開放
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
