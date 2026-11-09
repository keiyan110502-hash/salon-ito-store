/**
 * salon ito — 管理用スプレッドシート（Google Apps Script）
 *
 * 1つのスプレッドシートで、次のすべてを管理します。
 *   ・「商品」シート … 商品の追加・価格変更・売り切れ。メニュー「サイトに反映する」で公開サイトに反映
 *   ・「お知らせ」シート … トップページのお知らせ
 *   ・「注文一覧」シート … 決済が完了した注文が自動で追記される（同時に購入完了メールを送信）
 *   ・「月別集計」シート … 月ごとの売上・商品別の販売数
 * メニュー「salon ito」から、サイトへの反映と発送完了メールの送信ができます。
 *
 * 設置手順（詳しくは docs/operations-kit.md）
 *  1. このスプレッドシートで「拡張機能 > Apps Script」を開き、このファイルの内容を貼り付けて保存
 *  2. 「プロジェクトの設定 > スクリプト プロパティ」に以下を追加
 *       SHARED_SECRET       : Netlify の GAS_SHARED_SECRET と同じ長いランダム文字列
 *       SALON_EMAIL         : 注文通知を受け取るサロンのメールアドレス
 *       NETLIFY_BUILD_HOOK  : Netlify の Build hook の URL（「サイトに反映する」で使用）
 *  3. 関数 setup を1回実行（シート作成と権限の承認）
 *  4. 「デプロイ > 新しいデプロイ > 種類: ウェブアプリ」
 *       次のユーザーとして実行: 自分 ／ アクセスできるユーザー: 全員 → URL を Netlify の GAS_WEBAPP_URL に登録
 *  5. 「商品」「お知らせ」シートをそれぞれ「ファイル > 共有 > ウェブに公開 > CSV」で公開し、
 *     URL を Netlify の PRODUCTS_CSV_URL / NEWS_CSV_URL に登録
 */

const SHOP_NAME = 'salon ito';
const SHEET = { products: '商品', news: 'お知らせ', orders: '注文一覧', summary: '月別集計' };
// 決済手数料率（入金見込みの計算用）。Stripe の料金ページ・契約内容で確認して更新してください。
const FEE_RATES = { card: 0.036, apple_pay: 0.036, google_pay: 0.036, paypay: 0.036, konbini: 0.036 };

const PRODUCT_HEADERS = ['商品ID', 'ブランド', 'シリーズ', 'カテゴリ', '商品名', '容量', '価格(税込)', '公開', '仮データ', '画像', 'ラベル',
  '医薬部外品', '売り切れ', '商品説明', '使い方', '全成分', '公式URL'];
const PRODUCT_CHECKBOX_COLS = [8, 9, 12, 13]; // 公開・仮データ・医薬部外品・売り切れ
const NEWS_HEADERS = ['日付', '本文', '公開'];
const ORDER_HEADERS = ['注文日時', '注文番号', '購入者', 'メール', '電話', '郵便番号', '住所', '商品ID', '商品名', '単価', '数量', '小計',
  '送料', '注文合計', '支払方法', '決済手数料(見込)', '入金見込み', 'ステータス', 'Stripe Session ID', '発送日・準備完了日', '配送会社・追跡番号', '受取方法'];
const COL = { orderNo: 2, name: 3, email: 4, status: 18, shippedAt: 20, tracking: 21, fulfillment: 22 };
const PICKUP_LABEL = 'サロンで受け取り';

/* ───────── メニュー ───────── */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('salon ito')
    .addItem('サイトに反映する（商品・お知らせ）', 'publishToSite')
    .addItem('商品データをチェックする', 'checkProductsMenu')
    .addSeparator()
    .addItem('選択中の注文を「発送済み／ご用意完了」にしてメールを送る', 'markShipped')
    .addItem('選択中の注文を「受け渡し済み」にする（サロンで受け取り）', 'markHandedOver')
    .addSeparator()
    .addItem('テスト注文を1件記録する', 'testOrder')
    .addToUi();
}

/* ───────── 初期設定 ───────── */
function setup() {
  const ss = SpreadsheetApp.getActive();
  const ensure = (name, headers, index) => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name, index);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#F5F4F2');
    sh.setFrozenRows(1);
    return sh;
  };
  const products = ensure(SHEET.products, PRODUCT_HEADERS, 0);
  const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  PRODUCT_CHECKBOX_COLS.forEach(c => products.getRange(2, c, 999, 1).setDataValidation(rule));
  products.getRange('G:G').setNumberFormat('#,##0');
  products.getRange('N:P').setWrap(true);
  products.setColumnWidth(5, 240); products.setColumnWidth(14, 320);

  const news = ensure(SHEET.news, NEWS_HEADERS, 1);
  news.getRange(2, 3, 999, 1).setDataValidation(rule);
  news.setColumnWidth(2, 420);

  const orders = ensure(SHEET.orders, ORDER_HEADERS, 2);
  orders.getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm');
  orders.getRange('T:T').setNumberFormat('yyyy/mm/dd');
  orders.getRange('J:Q').setNumberFormat('#,##0');

  const sum = ss.getSheetByName(SHEET.summary) || ss.insertSheet(SHEET.summary, 3);
  sum.clear();
  sum.getRange('A1').setValue('月別の売上（決済完了分）').setFontWeight('bold');
  sum.getRange('A3').setFormula(
    `=QUERY('${SHEET.orders}'!A2:Q, "select year(A), month(A)+1, count(N), sum(N), sum(M), sum(Q) where N is not null group by year(A), month(A)+1 order by year(A) desc, month(A)+1 desc label year(A) '年', month(A)+1 '月', count(N) '注文件数', sum(N) '売上(税込)', sum(M) 'うち送料', sum(Q) '入金見込み'", 0)`);
  sum.getRange('I1').setValue('商品別の販売数').setFontWeight('bold');
  sum.getRange('I3').setFormula(
    `=QUERY('${SHEET.orders}'!H2:L, "select H, I, sum(K), sum(L) where H is not null group by H, I order by sum(L) desc label H '商品ID', I '商品名', sum(K) '数量', sum(L) '売上'", 0)`);
  MailApp.getRemainingDailyQuota(); // メール送信の権限承認のため
}

/* ───────── 商品データのチェックとサイトへの反映 ───────── */
function checkProducts_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET.products);
  const values = sh.getDataRange().getValues();
  const errors = [], ids = {};
  for (let r = 1; r < values.length; r++) {
    const row = values[r], line = r + 1;
    const [id, , , , name, , price, visible] = row;
    if (!id && !name) continue;
    if (visible === false) continue;
    if (!/^[a-z0-9-]+$/.test(String(id))) errors.push(`${line}行目：商品ID は半角英小文字・数字・ハイフンのみ（「${id}」）`);
    if (ids[id]) errors.push(`${line}行目：商品ID「${id}」が ${ids[id]}行目と重複しています`);
    ids[id] = line;
    if (!name) errors.push(`${line}行目：商品名が空です`);
    if (!(Number(price) > 0) || Math.floor(Number(price)) !== Number(price)) errors.push(`${line}行目：価格(税込) は数字で入力してください（「${price}」）`);
  }
  return errors;
}
function checkProductsMenu() {
  const e = checkProducts_();
  SpreadsheetApp.getUi().alert(e.length ? '直してほしい箇所があります\n\n' + e.join('\n') : '問題はありません。「サイトに反映する」を押してください。');
}
function publishToSite() {
  const ui = SpreadsheetApp.getUi();
  const errors = checkProducts_();
  if (errors.length) { ui.alert('反映を中止しました。次の箇所を直してください。\n\n' + errors.join('\n')); return; }
  const hook = PropertiesService.getScriptProperties().getProperty('NETLIFY_BUILD_HOOK');
  if (!hook) { ui.alert('NETLIFY_BUILD_HOOK が設定されていません。管理者に連絡してください。'); return; }
  if (ui.alert('サイトに反映します', '「商品」「お知らせ」シートの内容を公開サイトに反映します。よろしいですか？\n（ウェブに公開した CSV が更新されるまで数分かかることがあります）', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const res = UrlFetchApp.fetch(hook, { method: 'post', muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) { ui.alert('反映を開始できませんでした（' + res.getResponseCode() + '）。管理者に連絡してください。'); return; }
  SpreadsheetApp.getActive().toast('反映を開始しました。2〜3分ほどでサイトに表示されます。', SHOP_NAME, 8);
}

/* ───────── 注文の受付（Netlify の Webhook から呼ばれる） ───────── */
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad json' }); }
  const props = PropertiesService.getScriptProperties();
  if (!body || body.secret !== props.getProperty('SHARED_SECRET')) return out({ ok: false, error: 'unauthorized' });
  const o = body.order;
  if (!o || !o.orderNo || !Array.isArray(o.items)) return out({ ok: false, error: 'bad order' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(SHEET.orders);
    if (!sh) return out({ ok: false, error: 'run setup() first' });
    if (findOrderRows_(sh, o.orderNo).length) return out({ ok: true, duplicate: true }); // Stripe の再送による二重記録を防ぐ
    const rate = FEE_RATES[o.paymentType] != null ? FEE_RATES[o.paymentType] : 0.036;
    const fee = Math.round(o.total * rate);
    const c = o.customer || {};
    const rows = o.items.map((it, i) => [
      new Date(o.createdAt), o.orderNo, c.name, c.email, c.phone, c.postal, c.address,
      it.id, it.name, it.price, it.qty, it.price * it.qty,
      i === 0 ? o.shipping : '', i === 0 ? o.total : '', o.paymentMethod,
      i === 0 ? fee : '', i === 0 ? o.total - fee : '', '決済完了', o.sessionId, '', '',
      o.fulfillment === 'pickup' ? PICKUP_LABEL : '郵送',
    ]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, ORDER_HEADERS.length).setValues(rows);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  sendOrderMails_(o, props.getProperty('SALON_EMAIL'));
  return out({ ok: true });
}

function findOrderRows_(sh, orderNo) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, COL.orderNo, last - 1, 1).createTextFinder(orderNo).matchEntireCell(true).findAll().map(r => r.getRow());
}

const yen_ = n => '¥' + Number(n).toLocaleString('ja-JP');

function sendOrderMails_(o, salonEmail) {
  const d = Utilities.formatDate(new Date(o.createdAt), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  const c = o.customer || {};
  const lines = o.items.map(i => `・${i.name} × ${i.qty}　${yen_(i.price * i.qty)}`).join('\n');
  const pickup = o.fulfillment === 'pickup';
  const money = `小計　${yen_(o.subtotal)}\n${pickup ? '受け取り　サロンで受け取り（無料）' : `送料　${o.shipping ? yen_(o.shipping) : '無料'}`}\n合計　${yen_(o.total)}（税込）`;
  const where = pickup
    ? '■ 受け取り方法\nサロンで受け取り\n商品のご用意ができましたら、改めてメールでお知らせします。'
    : `■ お届け先\n〒${c.postal}　${c.address}\n${c.name} 様\n\n発送の準備が整いましたら、改めてご連絡いたします。`;
  if (c.email) {
    MailApp.sendEmail({
      to: c.email, replyTo: salonEmail || undefined, name: SHOP_NAME,
      subject: `【${SHOP_NAME}】ご注文ありがとうございます（${o.orderNo}）`,
      body: `${c.name} 様\n\nこのたびは ${SHOP_NAME} オンラインストアをご利用いただき、誠にありがとうございます。\n以下の内容でご注文を承りました。\n\n■ 注文番号　${o.orderNo}\n■ ご注文日時　${d}\n■ お支払い方法　${o.paymentMethod}\n\n${lines}\n\n${money}\n\n${where}\nご不明な点は、このメールにご返信ください。\n\n${SHOP_NAME}`,
    });
  }
  if (salonEmail) {
    MailApp.sendEmail({
      to: salonEmail, name: `${SHOP_NAME} 注文通知`,
      subject: `【新規注文】${c.name} 様　${yen_(o.total)}（${o.orderNo}）`,
      body: `新しいご注文が入りました（決済完了）。\n\n注文番号：${o.orderNo}\n日時：${d}\nお客様：${c.name}（${c.email}）\n電話：${c.phone || '-'}\n受け取り：${pickup ? '【サロンで受け取り】' : `郵送　〒${c.postal} ${c.address}`}\n支払い：${o.paymentMethod}\n\n${lines}\n\n${money}\n\n${pickup ? '商品を用意したら' : '発送したら'}、スプレッドシートでこの注文の行を選び、メニュー「salon ito > 選択中の注文を「発送済み／ご用意完了」にしてメールを送る」を押してください。\n${SpreadsheetApp.getActive().getUrl()}`,
    });
  }
}

/* ───────── 発送完了の連絡 ───────── */
function markShipped() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEET.orders) { ui.alert('「注文一覧」シートで、発送した注文の行を選んでから実行してください。'); return; }
  const row = sh.getActiveRange().getRow();
  if (row < 2) { ui.alert('注文の行（2行目以降）を選んでください。'); return; }
  const orderNo = sh.getRange(row, COL.orderNo).getValue();
  const rows = findOrderRows_(sh, orderNo);
  const name = sh.getRange(row, COL.name).getValue(), email = sh.getRange(row, COL.email).getValue();
  if (sh.getRange(row, COL.status).getValue() === '発送済み' &&
      ui.alert('この注文はすでに「発送済み」です。もう一度メールを送りますか？', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const items = rows.map(r => `・${sh.getRange(r, 9).getValue()} × ${sh.getRange(r, 11).getValue()}`).join('\n');
  if (sh.getRange(row, COL.fulfillment).getValue() === PICKUP_LABEL) {
    if (ui.alert(`${orderNo}（${name} 様）`, '「サロンで受け取り」の注文です。お客様に「ご用意ができました」メールを送りますか？', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
    rows.forEach(r => { sh.getRange(r, COL.status).setValue('受取待ち'); sh.getRange(r, COL.shippedAt).setValue(new Date()); });
    if (email) {
      MailApp.sendEmail({
        to: email, name: SHOP_NAME,
        replyTo: PropertiesService.getScriptProperties().getProperty('SALON_EMAIL') || undefined,
        subject: `【${SHOP_NAME}】商品のご用意ができました（${orderNo}）`,
        body: `${name} 様\n\n${SHOP_NAME} オンラインストアをご利用いただき、ありがとうございます。\nご注文の商品のご用意ができました。\n\n■ 注文番号　${orderNo}\n${items}\n\nサロンの営業時間内にお越しいただき、注文番号をお伝えください。\nご来店日時のご希望があれば、このメールにご返信ください。\n\n${SHOP_NAME}`,
      });
    }
    SpreadsheetApp.getActive().toast(`${name} 様に「ご用意ができました」メールを送りました。`, SHOP_NAME, 6);
    return;
  }
  const p = ui.prompt(`${orderNo}（${name} 様）`, '配送会社と追跡番号を入力してください（例：ヤマト運輸 1234-5678-9012）。\n無い場合は空欄のまま OK を押してください。', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  const tracking = p.getResponseText().trim();
  const today = new Date();
  rows.forEach(r => {
    sh.getRange(r, COL.status).setValue('発送済み');
    sh.getRange(r, COL.shippedAt).setValue(today);
    sh.getRange(r, COL.tracking).setValue(tracking);
  });
  if (email) {
    MailApp.sendEmail({
      to: email, name: SHOP_NAME,
      replyTo: PropertiesService.getScriptProperties().getProperty('SALON_EMAIL') || undefined,
      subject: `【${SHOP_NAME}】商品を発送しました（${orderNo}）`,
      body: `${name} 様\n\n${SHOP_NAME} オンラインストアをご利用いただき、ありがとうございます。\nご注文の商品を本日発送いたしました。\n\n■ 注文番号　${orderNo}\n${items}\n${tracking ? `\n■ 配送会社・追跡番号　${tracking}\n` : ''}\nお届けまで今しばらくお待ちください。\nご不明な点は、このメールにご返信ください。\n\n${SHOP_NAME}`,
    });
  }
  SpreadsheetApp.getActive().toast(`${name} 様に発送完了メールを送りました。`, SHOP_NAME, 6);
}

function markHandedOver() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEET.orders) { ui.alert('「注文一覧」シートで、お渡しした注文の行を選んでから実行してください。'); return; }
  const row = sh.getActiveRange().getRow();
  if (row < 2) { ui.alert('注文の行（2行目以降）を選んでください。'); return; }
  const orderNo = sh.getRange(row, COL.orderNo).getValue();
  findOrderRows_(sh, orderNo).forEach(r => sh.getRange(r, COL.status).setValue('受け渡し済み'));
  SpreadsheetApp.getActive().toast(`${orderNo} を「受け渡し済み」にしました。`, SHOP_NAME, 6);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 動作確認用：テスト注文を1件記録し、サロンのアドレスにメールを送ります（確認後、行は削除してください） */
function testOrder() {
  const props = PropertiesService.getScriptProperties();
  const order = {
    orderNo: 'ITO-TEST-' + Date.now().toString().slice(-6), sessionId: 'cs_test_dummy', createdAt: new Date().toISOString(),
    customer: { name: 'テスト 花子', email: props.getProperty('SALON_EMAIL'), phone: '090-0000-0000', postal: '0000000', address: 'テスト住所' },
    items: [{ id: 'adj-fogsui', name: 'フォグスイ', price: 3190, qty: 2 }],
    subtotal: 6380, shipping: 770, total: 7150, paymentType: 'card', paymentMethod: 'クレジットカード', status: 'paid',
  };
  const res = doPost({ postData: { contents: JSON.stringify({ secret: props.getProperty('SHARED_SECRET'), order }) } });
  Logger.log(res.getContent());
  try { SpreadsheetApp.getActive().toast('テスト注文を記録しました：' + res.getContent(), SHOP_NAME, 6); } catch (e) {}
}
