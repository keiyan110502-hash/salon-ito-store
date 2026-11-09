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
  data/shop.json        … 送料、お知らせ、特商法表記の事業者情報
  images/products/      … 商品画像（正方形・800×800px 以上を推奨）
netlify/functions/      … サーバー処理
  checkout.mjs          … Stripe の決済画面を作る（金額はサーバー側で計算）
  stripe-webhook.mjs    … 決済完了の通知を受けて、GAS に記録とメール送信を依頼
  order.mjs             … 完了画面に注文内容を表示
gas/Code.gs             … スプレッドシートへの記録とメール送信（Google Apps Script）
data/products.csv       … 商品の元データ（スプレッドシートで編集して CSV で保存）
scripts/                … 商品の CSV→JSON 変換と、デザイン確認用プレビューの作成
docs/launch-guide.md    … 決済の申請、法対応、公開前チェックリスト
```

## 商品データの更新

1. `data/products.csv` を Googleスプレッドシートで開き、1行に1商品を入力します。
   - `id`：半角英小文字・数字・ハイフンのみ（例 `adj-fogsui`）
   - `price`：税込の整数
   - `draft`：TRUE の間は「仮データ」の注記が出ます
   - `quasi_drug`：医薬部外品なら TRUE
   - `soldout`：TRUE で SOLD OUT 表示になり、購入できなくなります
   - `description` / `how_to_use` / `ingredients`：メーカー公式の文章をそのまま貼り付けます（セル内の改行も使えます）
2. 「ファイル > ダウンロード > CSV」で `data/products.csv` に上書き保存します。
3. 商品画像は `public/images/products/商品id.jpg` に置き、CSV の `image` 列に `images/products/商品id.jpg` と書きます。
4. `npm run products` で JSON に変換されます。Netlify では公開のたびに自動で変換されます。

## 公開までの手順

### 1. Netlify にサイトを作る
1. このフォルダを GitHub のリポジトリにプッシュします。
2. Netlify で「Add new site > Import an existing project」からそのリポジトリを選びます。ビルド設定は `netlify.toml` から自動で読み込まれます。
3. 「Site configuration > Environment variables」に、`.env.example` にある4つの値を登録します。

### 2. Stripe（まずはテストモード）
1. Stripe でアカウントを作り、テストモードの「シークレットキー（`sk_test_`）」を `STRIPE_SECRET_KEY` に登録します。
2. 「開発者 > Webhook」でエンドポイント `https://（サイトのURL）/api/stripe-webhook` を追加し、次の2つのイベントを選びます。
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
3. 表示された署名シークレット `whsec_...` を `STRIPE_WEBHOOK_SECRET` に登録します。
4. 「設定 > 決済手段」で、使う支払い方法を ON にします。
5. テスト用カード `4242 4242 4242 4242`（有効期限は未来の日付、セキュリティコードは任意）で、購入を最後まで試します。

### 3. スプレッドシート連携（GAS）
1. `gas/Code.gs` の先頭にある手順どおりに設定します。
2. 発行されたウェブアプリの URL を `GAS_WEBAPP_URL` に登録します。
3. 同じランダム文字列を、`GAS_SHARED_SECRET` と GAS のスクリプトプロパティ `SHARED_SECRET` の両方に設定します。
4. GAS エディタで `testOrder` を実行すると、テスト行が1件記録され、メールが届くことを確認できます。

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
