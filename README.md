# salon ito オンラインストア

QRコードから開くオンラインストアです。

- 決済：Stripe Checkout（カード / Apple Pay / Google Pay / PayPay / コンビニ払い）
- 注文の記録：Googleスプレッドシート（決済が完了した注文だけを記録）
- 購入完了メール：お客様とサロンの両方に送信

## 構成

```
public/                 … 公開されるサイト（Netlify の公開フォルダ）
  index.html
  assets/style.css      … デザイン（白地・明朝体・赤い糸のモチーフ）
  assets/app.js         … 画面（商品一覧・詳細・カート・確認・完了・マイページ・特商法・プライバシー・ご利用ガイド）
  data/products.json    … 商品データ（data/products.csv から自動生成）
  data/shop.json        … 送料、特商法表記の事業者情報
  images/products/      … 商品画像（正方形・800×800px 以上を推奨）
netlify/functions/      … サーバー処理
  checkout.mjs          … Stripe の決済画面を作る（金額はサーバー側で計算）
  stripe-webhook.mjs    … 決済完了の通知を受けて、GAS に記録とメール送信を依頼
  order.mjs             … 完了画面に注文内容を表示
gas/Code.gs             … スプレッドシートへの記録とメール送信（Google Apps Script）
data/products.csv       … 商品の初期データ（運用時は管理スプレッドシートから自動取得）
data/news.csv           … お知らせの初期データ
scripts/                … シートの取り込み、CSV→JSON 変換、デザイン確認用プレビューの作成
docs/launch-guide.md    … 決済の申請、法対応、公開前チェックリスト
（妹尾さん向けの運用マニュアルは Claude Docs の「salon ito オンラインストア 運用マニュアル」、PDF 版は docs/salon-ito-manual.pdf）
```

## 商品データの更新（運用時）

商品とお知らせは、**管理スプレッドシート**の「商品」「お知らせ」シートで編集します。編集したら、メニュー「salon ito > サイトに反映する」を押します。

1. GAS が Netlify の Build hook を呼びます。
2. Netlify がビルド時に、「ウェブに公開」した CSV（`PRODUCTS_CSV_URL` / `NEWS_CSV_URL`）を取り込みます（`scripts/fetch-sheet.mjs`）。
3. `data/*.csv` から `public/data/*.json` を作ります（`scripts/csv-to-json.mjs`）。
4. サイトが更新されます。

補足：
- 「画像」列に Google ドライブの共有リンクがあれば、ビルド時に画像をダウンロードして `public/images/products/商品ID.jpg` として同梱します。ダウンロードに失敗しても、ビルドは止めずに仮の画像で表示します。
- 2つの CSV URL が未設定のときは、リポジトリ内の `data/products.csv` と `data/news.csv` を使います（初期データ兼バックアップ）。
- 列の見出しは日本語です（商品ID・ブランド・シリーズ・カテゴリ・商品名・容量・価格(税込)・公開・仮データ・画像・ラベル・医薬部外品・売り切れ・商品説明・使い方・全成分・公式URL）。
- アジュバン商品は、メーカー希望小売価格（定価）で入力します。

## 公開までの手順

### 1. Netlify にサイトを作る
1. このフォルダを GitHub のリポジトリにプッシュします。
2. Netlify で「Add new site > Import an existing project」からそのリポジトリを選びます。ビルド設定は `netlify.toml` から自動で読み込まれます。
3. 「Site configuration > Environment variables」に、`.env.example` にある6つの値を登録します。

### 2. Stripe（まずはテストモード）
1. Stripe でアカウントを作り、テストモードの「シークレットキー（`sk_test_`）」を `STRIPE_SECRET_KEY` に登録します。
2. 「開発者 > Webhook」でエンドポイント `https://（サイトのURL）/api/stripe-webhook` を追加し、次の2つのイベントを選びます。
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
3. 表示された署名シークレット `whsec_...` を `STRIPE_WEBHOOK_SECRET` に登録します。
4. 「設定 > 決済手段」で、使う支払い方法を ON にします。
5. テスト用カード `4242 4242 4242 4242`（有効期限は未来の日付、セキュリティコードは任意）で、購入を最後まで試します。

### 3. 管理スプレッドシート（GAS）
1. サロンの Google アカウントでスプレッドシートを作ります。
2. `gas/Code.gs` の先頭にある手順どおりに設定します。
   - スクリプトプロパティ：`SHARED_SECRET` / `SALON_EMAIL` / `NETLIFY_BUILD_HOOK`
   - 関数 `setup` を実行
   - ウェブアプリとしてデプロイ
3. `data/products.csv` を「商品」シートに、`data/news.csv` を「お知らせ」シートにインポートします。
4. 「商品」「お知らせ」シートをそれぞれ「ウェブに公開（CSV）」し、URL を Netlify の `PRODUCTS_CSV_URL` / `NEWS_CSV_URL` に登録します。
5. Netlify の「Build hooks」で URL を作り、スクリプトプロパティ `NETLIFY_BUILD_HOOK` に登録します。
6. 発行されたウェブアプリの URL を `GAS_WEBAPP_URL` に登録します。
7. 同じランダム文字列を、`GAS_SHARED_SECRET` と GAS のスクリプトプロパティ `SHARED_SECRET` の両方に設定します。
8. GAS エディタで `testOrder` を実行すると、テスト行が1件記録され、メールが届くことを確認できます。

### 4. 本番に切り替える
Stripe の本番審査が通ったら、次の2つを本番用の値に差し替えます。
- `STRIPE_SECRET_KEY` を `sk_live_` で始まる本番キーに
- Webhook を本番モードで作り直し、その署名シークレットを `STRIPE_WEBHOOK_SECRET` に

### 5. QRコード
本番の URL（独自ドメインを推奨）から QR コードを作り、店頭の POP やショップカードに載せます。

## ローカルでの確認

```bash
npm install
```

```bash
npm run preview
```

`npm run preview` で `preview/salon-ito-preview.html` ができます。決済とメールを画面上で再現する、デザイン確認用の1ファイル版です。Stripe や GAS につないだ状態で確認するときは、`npx netlify dev` を使い、`.env` に値を設定します。

## 仕組みのポイント

- 金額はすべてサーバー側の商品データから計算します。ブラウザで金額を書き換えられても、その金額では決済されません。
- カード情報は Stripe の画面で入力されるため、サロンのサーバーには一切残りません。
- スプレッドシートには、決済が完了した注文だけが記録されます。コンビニ払いは入金が確認された時点で記録されます。Stripe が同じ通知を再送しても、二重には記録されません。
- マイページの注文履歴は、注文したお客様の端末に保存されます。会員ログイン機能は、必要になった段階で追加できます。

## 運用マニュアル（PDF）の作り直し

`docs/manual/manual.html` を編集し、Playwright で A4 の PDF に書き出します（ガントチャートとフロー図は横向きのページ）。

## 公式サイトからの商品取り込み（初回登録用）

`scripts/import/` に、アジュバン・バイオラブの公式サイトから商品データを作るスクリプトがあります。

- `parse_biolab.py`：www.biolab.jp/products/<id>/ の HTML → JSON
- `parse_adjuvant.py`：www.adjuvant.co.jp/brandlist/<brand>/ の HTML → JSON（業務用・価格なしは除外）
- `build_catalog.py`：2つの JSON → `data/products.csv`（1サイズ1行。サイズ違いは「グループID」でまとめる）

取り込んだ元データは `data/source/`、商品写真（正方形 720px）は `public/images/products/<グループID>.jpg` にあります。運用開始後は、管理スプレッドシートの「商品」シートが正です。
