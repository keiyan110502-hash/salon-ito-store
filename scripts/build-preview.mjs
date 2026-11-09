// 本番と同じ HTML/CSS/JS から、1ファイルで動くデザイン確認用プレビュー（デモモード）を作ります。
// 出力: preview/salon-ito-preview.html （決済・メール・スプレッドシートを画面上で再現）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const html = readFileSync("public/index.html", "utf8");
const css = readFileSync("public/assets/style.css", "utf8");
const js = readFileSync("public/assets/app.js", "utf8");
const data = { products: JSON.parse(readFileSync("public/data/products.json", "utf8")), shop: JSON.parse(readFileSync("public/data/shop.json", "utf8")), news: JSON.parse(readFileSync("public/data/news.json", "utf8")) };

// プレビューは1ファイルで動かすため、商品写真を data URI にして埋め込む
import { existsSync } from "node:fs";
const img = {};
for (const p of data.products) if (p.image && !img[p.image] && existsSync("public/" + p.image))
  img[p.image] = "data:image/jpeg;base64," + readFileSync("public/" + p.image).toString("base64");

const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, "").replace(/<meta name="viewport"[^>]*>\s*/, "")
  .replace(/<link rel="stylesheet" href="assets\/style.css">/, `<style>\n${css}\n</style>`);
const bar = `<div class="pbar"><div class="wrap"><span>デザイン確認用プレビュー｜商品名・価格は仮データ、決済とメールは画面上の再現です</span><a href="#sheet">管理側：スプレッドシートのイメージ</a></div></div>`;
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
  .replace("<!--PREVIEW_BAR-->", bar)
  .replace(/<script src="assets\/app.js"><\/script>/, () => `<script>window.ITO_DEMO=true;window.__ITO_DATA__=${JSON.stringify(data).replace(/</g, "\\u003c")};window.__ITO_IMG__=${JSON.stringify(img)};</script>\n<script>\n${js}\n</script>`);

mkdirSync("preview", { recursive: true });
writeFileSync("preview/salon-ito-preview.html", head.trim() + "\n" + body.trim() + "\n");
console.log("preview/salon-ito-preview.html を作成しました");
