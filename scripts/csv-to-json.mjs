// 商品・お知らせの CSV → public/data/products.json / news.json
// 見出しは日本語（スプレッドシートの「商品」シートと同じ）でも英語キーでも読めます。
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export function parseCSV(text) {
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

const KEYS = {
  "商品ID": "id", "グループID": "group", "商品名（カナ）": "name_kana", "おすすめの肌悩み": "concerns", "キャッチコピー": "catch",
  "画像の元URL": "image_source", "ブランド": "brand", "シリーズ": "line", "カテゴリ": "category", "商品名": "name", "容量": "volume",
  "価格(税込)": "price", "価格（税込）": "price", "価格": "price", "公開": "visible", "仮データ": "draft", "画像": "image",
  "ラベル": "tag", "医薬部外品": "quasi_drug", "売り切れ": "soldout", "商品説明": "description", "使い方": "how_to_use",
  "全成分": "ingredients", "公式URL": "official_url", "日付": "date", "本文": "text",
};
const truthy = v => /^(true|1|yes|○|はい|✓)$/i.test(String(v).trim());
const isFalse = v => /^(false|0|no|×|いいえ)$/i.test(String(v).trim());

function table(path) {
  const [head, ...rows] = parseCSV(readFileSync(path, "utf8"));
  const keys = head.map(h => KEYS[h.trim()] || h.trim());
  return rows.map((r, n) => ({ line: n + 2, o: Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])) }));
}

export function convert({ productsCsv = "data/products.csv", newsCsv = "data/news.csv", out = "public/data" } = {}) {
  const ids = new Set(), errors = [];
  const products = [];
  for (const { line, o } of table(productsCsv)) {
    if (!o.id && !o.name) continue;
    if (isFalse(o.visible)) continue; // 公開=FALSE は載せない
    if (!/^[a-z0-9-]+$/.test(o.id)) errors.push(`${line}行目: 商品ID は半角英小文字・数字・ハイフンのみ（「${o.id}」）`);
    if (ids.has(o.id)) errors.push(`${line}行目: 商品ID が重複しています（${o.id}）`);
    ids.add(o.id);
    const price = Number(String(o.price).replace(/[¥￥,円\s]/g, ""));
    if (!Number.isInteger(price) || price <= 0) errors.push(`${line}行目: 価格(税込) は数字で入力してください（「${o.price}」）`);
    if (!o.name) errors.push(`${line}行目: 商品名 が空です`);
    products.push({
      id: o.id, group: o.group || o.id, nameKana: o.name_kana || "", catch: o.catch || "",
      concerns: (o.concerns || "").split(/[、,／\/]/).map(x => x.trim()).filter(Boolean),
      brand: o.brand, line: o.line, category: o.category, name: o.name, volume: o.volume, price,
      draft: truthy(o.draft), image: o.image, tag: o.tag, quasiDrug: truthy(o.quasi_drug), soldout: truthy(o.soldout),
      description: o.description, howTo: o.how_to_use, ingredients: o.ingredients, officialUrl: o.official_url,
    });
  }
  if (errors.length) throw new Error("商品データにエラーがあります:\n" + errors.join("\n"));
  writeFileSync(`${out}/products.json`, JSON.stringify(products, null, 2) + "\n");

  let news = [];
  if (existsSync(newsCsv)) news = table(newsCsv).map(({ o }) => o).filter(o => o.text && !isFalse(o.visible)).map(o => ({ date: o.date, text: o.text }));
  writeFileSync(`${out}/news.json`, JSON.stringify(news, null, 2) + "\n");
  return { products: products.length, news: news.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const r = convert();
    console.log(`商品 ${r.products}件 / お知らせ ${r.news}件 を書き出しました`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
