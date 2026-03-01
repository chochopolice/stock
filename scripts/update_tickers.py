import json
import os
from datetime import datetime
import requests
import pandas as pd

# JPX「東証上場銘柄一覧」Excel（現時点での直リンク例）
# ※JPX側でURLが変わる可能性はあるので、その場合はJPXページから差し替え :contentReference[oaicite:4]{index=4}
JPX_XLS_URL = "https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls"

OUT_PATH = os.path.join("docs", "tickers_jp.json")

def download_xls(url: str) -> bytes:
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.content

def build_aliases(name: str) -> list[str]:
    # 最低限の別名（必要なら後で強化）
    aliases = []
    if isinstance(name, str):
        aliases.append(name)
        # 会社名の揺れ
        aliases.append(name.replace("ホールディングス", "HD"))
        aliases.append(name.replace("ホールディングス", "HLDGS"))
        aliases.append(name.replace("グループ", "G"))
        aliases.append(name.replace("株式会社", "").replace("(株)", "").replace("（株）", ""))
    # 重複削除
    seen = set()
    out = []
    for a in aliases:
        a2 = a.strip()
        if a2 and a2 not in seen:
            seen.add(a2)
            out.append(a2)
    return out

def main():
    xls_bytes = download_xls(JPX_XLS_URL)

    # .xls のため xlrd を利用（pandas + xlrd）
    # JPXのファイルはシート名が "Sheet1" のことが多い（変わる場合あり）
    df = pd.read_excel(xls_bytes, sheet_name=0, engine="xlrd")

    # JPXの列名は日本語。代表的には「コード」「銘柄名」「市場・商品区分」「33業種区分」等が入る。
    # 列名が変わっても動くように、候補で吸収する。
    def pick_col(candidates):
        for c in candidates:
            if c in df.columns:
                return c
        return None

    col_code = pick_col(["コード", "銘柄コード", "Code"])
    col_name = pick_col(["銘柄名", "銘柄名（漢字）", "Name"])
    col_market = pick_col(["市場・商品区分", "市場区分", "市場", "Market"])
    col_sector33 = pick_col(["33業種区分", "33業種", "Sector33"])
    col_sector17 = pick_col(["17業種区分", "17業種", "Sector17"])

    if not col_code or not col_name:
        raise RuntimeError(f"必要列が見つかりません。columns={list(df.columns)}")

    out = []
    for _, row in df.iterrows():
        code = str(row[col_code]).strip()
        name = str(row[col_name]).strip()

        # 4桁以外や欠損を除外
        if not code.isdigit():
            continue
        if len(code) < 4:
            continue
        code = code.zfill(4)

        item = {
            "code": code,
            "name": name,
            "kana": "",  # JPX一覧にかなが無いので空。必要なら別ソースで補完
            "market": str(row[col_market]).strip() if col_market else "",
            "sector33": str(row[col_sector33]).strip() if col_sector33 else "",
            "sector17": str(row[col_sector17]).strip() if col_sector17 else "",
            "aliases": build_aliases(name),
        }
        out.append(item)

    # コード順で安定化（diffが見やすい）
    out.sort(key=lambda x: x["code"])

    payload = {
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "source": "JPX TSE listed issues (Excel)",
        "data": out,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"Wrote: {OUT_PATH} ({len(out)} tickers)")

if __name__ == "__main__":
    main()
