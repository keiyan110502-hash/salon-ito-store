// 商品データ（CSV）→ public/data/products.json に変換します。
// 使い方: Googleスプレッドシートで商品表を編集 →「ファイル > ダウンロード > CSV」で
//         data/products.csv に上書き保存 → `npm run products`
import { readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2] || "data/products.csv";
const out = process.argv[3] || "public/data/products.json";

function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ""));
}

const truthy = v => /^(true|1|yes|○|はい)$/i.test(String(v).trim());
const [head, ...rows] = parseCSV(readFileSync(src, "utf8"));
const ids = new Set();
const errors = [];
const products = rows.map((r, n) => {
  const o = Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()]));
  const line = n + 2;
  if (!/^[a-z0-9-]+$/.test(o.id)) errors.push(`${line}行目: id は半角英小文字・数字・ハイフンのみ（${o.id}）`);
  if (ids.has(o.id)) errors.push(`${line}行目: id が重複しています（${o.id}）`);
  ids.add(o.id);
  const price = Number(String(o.price).replace(/[¥,円\s]/g, ""));
  if (!Number.isInteger(price) || price <= 0) errors.push(`${line}行目: price は税込の整数で入力してください（${o.price}）`);
  if (!o.name) errors.push(`${line}行目: name が空です`);
  return {
    id: o.id, brand: o.brand, line: o.line, category: o.category, name: o.name,
    volume: o.volume, price, draft: truthy(o.draft), image: o.image, tag: o.tag,
    quasiDrug: truthy(o.quasi_drug), soldout: truthy(o.soldout),
    description: o.description, howTo: o.how_to_use, ingredients: o.ingredients, officialUrl: o.official_url,
  };
});
if (errors.length) { console.error("商品データにエラーがあります:\n" + errors.join("\n")); process.exit(1); }
writeFileSync(out, JSON.stringify(products, null, 2) + "\n");
console.log(`${products.length}件の商品を ${out} に書き出しました`);
