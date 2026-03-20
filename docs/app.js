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
//function setResult(objOrText, isError = false) {
//  if (typeof objOrText === "string") {
//    $result.textContent = objOrText;
//  } else {
//    $result.textContent = JSON.stringify(objOrText, null, 2);
//  }
//  $result.classList.toggle("error", isError);
//}

function setResult(objOrText, isError = false) {
  $result.classList.toggle("error", isError);

  // 文字列 or エラーはそのまま表示
  if (typeof objOrText === "string" || isError) {
    $result.innerHTML = escapeHtml(typeof objOrText === "string" ? objOrText : JSON.stringify(objOrText, null, 2));
    return;
  }

  // APIレスポンスのcommentを整形表示
  const comment = objOrText?.comment;
  if (!comment) {
    $result.textContent = JSON.stringify(objOrText, null, 2);
    return;
  }

  // comment文字列をパースして構造化
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

  const total = parseInt(get("総合スコア："));
  const techScore = parseInt(get("テクニカル："));
  const fundScore = parseInt(get("ファンダメンタル："));
  const extScore = parseInt(get("外部要因："));

  $result.innerHTML = `
    <div style="font-family:sans-serif; line-height:1.8; padding:4px 0;">

      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:12px;">
        <div>
          <span style="font-size:1.1em; font-weight:bold;">${escapeHtml(objOrText.ticker)}</span>
          <span style="margin-left:12px; color:#888; font-size:0.85em;">${escapeHtml(get("評価日："))}</span>
        </div>
        <div style="font-size:1.4em; font-weight:bold; color:#333;">${escapeHtml(get("現在株価："))}</div>
      </div>

      <div style="margin-bottom:12px;">
        <span style="background:#e3f2fd; color:#1565c0; padding:2px 10px; border-radius:12px; font-size:0.85em;">${escapeHtml(get("区分："))}</span>
      </div>

      <div style="margin-bottom:12px;">
        <div style="font-size:0.8em; color:#888; margin-bottom:4px;">スコア内訳</div>
        ${[
          ["テクニカル", techScore, 12],
          ["ファンダメンタル", fundScore, 12],
          ["外部要因", extScore, 6],
        ].map(([label, score, max]) => `
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <div style="width:100px; font-size:0.85em; color:#555;">${label}</div>
            <div style="flex:1; background:#eee; border-radius:4px; height:8px;">
              <div style="width:${Math.round(score/max*100)}%; background:${scoreColor(score,max)}; height:8px; border-radius:4px;"></div>
            </div>
            <div style="width:50px; text-align:right; font-size:0.85em; font-weight:bold;">${score} / ${max}</div>
          </div>
        `).join("")}
        <div style="text-align:right; font-size:0.9em; margin-top:6px;">
          総合スコア：<strong style="color:${scoreColor(total,30)}">${total} / 30</strong>
        </div>
      </div>

      <div style="text-align:center; margin-bottom:16px;">
        <span style="background:${verdictColor}; color:#fff; padding:6px 24px; border-radius:20px; font-size:1.1em; font-weight:bold;">
          ${escapeHtml(verdict)}
        </span>
      </div>

      <div style="background:#f9f9f9; border-radius:8px; padding:10px 14px; font-size:0.88em; line-height:2;">
        <div>📌 本命買い：<strong>${escapeHtml(get("本命買い："))}</strong></div>
        <div>📊 分割買い：<strong>${escapeHtml(get("分割買い："))}</strong></div>
        <div>👀 様子見：<strong>${escapeHtml(get("様子見："))}</strong></div>
        <div>⚠️ 割高警戒：<strong>${escapeHtml(get("割高警戒："))}</strong></div>
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
         asOf: payload.asOf || null,
         // mode: payload.options?.mode || "B"
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
