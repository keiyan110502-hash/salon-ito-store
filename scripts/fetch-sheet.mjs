// Netlify のビルド時に、Googleスプレッドシート（「ウェブに公開」した CSV）から商品とお知らせを取り込みます。
// 環境変数 PRODUCTS_CSV_URL / NEWS_CSV_URL が無い場合は、リポジトリ内の data/*.csv をそのまま使います。
// 「画像」列に Google ドライブの共有リンクがあれば、画像をダウンロードしてサイトに同梱します。
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { parseCSV } from "./csv-to-json.mjs";

async function getCSV(url, dest) {
  const r = await fetch(url, { redirect: "follow" });
  const text = await r.text();
  if (!r.ok || /^\s*</.test(text)) throw new Error(`${dest} を取得できませんでした（${r.status}）。スプレッドシートの「ウェブに公開」を確認してください。`);
  writeFileSync(dest, text);
  console.log(`取得: ${dest}`);
  return text;
}

const driveId = s => (s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/) || [])[1];

async function main() {
  const { PRODUCTS_CSV_URL, NEWS_CSV_URL } = process.env;
  if (NEWS_CSV_URL) await getCSV(NEWS_CSV_URL, "data/news.csv");
  if (!PRODUCTS_CSV_URL) { console.log("PRODUCTS_CSV_URL 未設定のため data/products.csv を使用します"); return; }

  const text = await getCSV(PRODUCTS_CSV_URL, "data/products.csv");
  const [head, ...rows] = parseCSV(text);
  const iId = head.findIndex(h => ["商品ID", "id"].includes(h.trim()));
  const iImg = head.findIndex(h => ["画像", "image"].includes(h.trim()));
  if (iId < 0 || iImg < 0) return;

  mkdirSync("public/images/products", { recursive: true });
  let changed = false;
  for (const r of rows) {
    const id = (r[iId] || "").trim(), src = (r[iImg] || "").trim(), fid = driveId(src);
    if (!id || !fid) continue;
    const file = `images/products/${id}.jpg`;
    try {
      const res = await fetch(`https://drive.google.com/uc?export=download&id=${fid}`, { redirect: "follow" });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.startsWith("image/")) throw new Error(`共有設定を「リンクを知っている全員」にしてください（${type || res.status}）`);
      writeFileSync(`public/${file}`, Buffer.from(await res.arrayBuffer()));
      r[iImg] = file; changed = true;
      console.log(`画像: ${id}`);
    } catch (e) {
      console.warn(`⚠ 画像を取得できませんでした（${id}）: ${e.message}`);
      r[iImg] = existsSync(`public/${file}`) ? file : "";
      changed = true;
    }
  }
  if (changed) {
    const esc = v => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    writeFileSync("data/products.csv", [head, ...rows].map(r => r.map(v => esc(v ?? "")).join(",")).join("\n") + "\n");
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
