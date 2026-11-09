/**
 * salon ito — 注文記録＋購入完了メール（Google Apps Script）
 *
 * 設置手順（README の「4. スプレッドシート連携」も参照）
 *  1. 新しい Googleスプレッドシートを作成 →「拡張機能 > Apps Script」を開き、このファイルの内容を貼り付けて保存
 *  2. 「プロジェクトの設定 > スクリプト プロパティ」に以下を追加
 *       SHARED_SECRET : Netlify の GAS_SHARED_SECRET と同じ長いランダム文字列
 *       SALON_EMAIL   : 注文通知を受け取るサロンのメールアドレス
 *  3. エディタで関数 setup を1回実行（シート作成と権限の承認）
 *  4. 「デプロイ > 新しいデプロイ > 種類: ウェブアプリ」
 *       次のユーザーとして実行: 自分 ／ アクセスできるユーザー: 全員 → 発行されたURLを Netlify の GAS_WEBAPP_URL に登録
 *
 * Webhook（Netlify Functions）から「決済が完了した注文」だけが届きます。同じ注文番号は二重に記録しません。
 */

const ORDERS_SHEET = '注文一覧';
const SUMMARY_SHEET = '月別集計';
const SHOP_NAME = 'salon ito';
// 決済手数料率（入金見込みの計算用）。Stripe の料金ページ・契約内容で確認して更新してください。
const FEE_RATES = { card: 0.036, apple_pay: 0.036, google_pay: 0.036, paypay: 0.036, konbini: 0.036 };
const HEADERS = ['注文日時', '注文番号', '購入者', 'メール', '電話', '郵便番号', '住所', '商品ID', '商品名', '単価', '数量', '小計',
  '送料', '注文合計', '支払方法', '決済手数料(見込)', '入金見込み', 'ステータス', 'Stripe Session ID'];

function setup() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(ORDERS_SHEET) || ss.insertSheet(ORDERS_SHEET, 0);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#F5F4F2');
  sh.setFrozenRows(1);
  sh.getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm');
  sh.getRange('J:Q').setNumberFormat('#,##0');

  let sum = ss.getSheetByName(SUMMARY_SHEET) || ss.insertSheet(SUMMARY_SHEET, 1);
  sum.clear();
  sum.getRange('A1').setValue('月別の売上（決済完了分）');
  sum.getRange('A3').setFormula(
    `=QUERY('${ORDERS_SHEET}'!A2:Q, "select year(A), month(A)+1, count(N), sum(N), sum(M), sum(Q) where N is not null group by year(A), month(A)+1 order by year(A) desc, month(A)+1 desc label year(A) '年', month(A)+1 '月', count(N) '注文件数', sum(N) '売上(税込)', sum(M) 'うち送料', sum(Q) '入金見込み'", 0)`);
  sum.getRange('H1').setValue('商品別の販売数');
  sum.getRange('H3').setFormula(
    `=QUERY('${ORDERS_SHEET}'!H2:L, "select H, I, sum(K), sum(L) where H is not null group by H, I order by sum(L) desc label H '商品ID', I '商品名', sum(K) '数量', sum(L) '売上'", 0)`);
  // 権限承認のためにメール送信サービスにも触れておく
  MailApp.getRemainingDailyQuota();
}

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
    const sh = SpreadsheetApp.getActive().getSheetByName(ORDERS_SHEET);
    if (!sh) return out({ ok: false, error: 'run setup() first' });
    const last = sh.getLastRow();
    if (last > 1) {
      const found = sh.getRange(2, 2, last - 1, 1).createTextFinder(o.orderNo).matchEntireCell(true).findNext();
      if (found) return out({ ok: true, duplicate: true }); // Stripe の再送による二重記録を防ぐ
    }
    const rate = FEE_RATES[o.paymentType] != null ? FEE_RATES[o.paymentType] : 0.036;
    const fee = Math.round(o.total * rate);
    const c = o.customer || {};
    const rows = o.items.map((it, i) => [
      new Date(o.createdAt), o.orderNo, c.name, c.email, c.phone, c.postal, c.address,
      it.id, it.name, it.price, it.qty, it.price * it.qty,
      i === 0 ? o.shipping : '', i === 0 ? o.total : '', o.paymentMethod,
      i === 0 ? fee : '', i === 0 ? o.total - fee : '', '決済完了', o.sessionId,
    ]);
    sh.getRange(last + 1, 1, rows.length, HEADERS.length).setValues(rows);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  sendMails(o, PropertiesService.getScriptProperties().getProperty('SALON_EMAIL'));
  return out({ ok: true });
}

function sendMails(o, salonEmail) {
  const yen = n => '¥' + Number(n).toLocaleString('ja-JP');
  const d = Utilities.formatDate(new Date(o.createdAt), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  const c = o.customer || {};
  const lines = o.items.map(i => `・${i.name} × ${i.qty}　${yen(i.price * i.qty)}`).join('\n');
  const money = `小計　${yen(o.subtotal)}\n送料　${o.shipping ? yen(o.shipping) : '無料'}\n合計　${yen(o.total)}（税込）`;

  if (c.email) {
    MailApp.sendEmail({
      to: c.email,
      replyTo: salonEmail || undefined,
      name: SHOP_NAME,
      subject: `【${SHOP_NAME}】ご注文ありがとうございます（${o.orderNo}）`,
      body: `${c.name} 様\n\nこのたびは ${SHOP_NAME} オンラインストアをご利用いただき、誠にありがとうございます。\n以下の内容でご注文を承りました。\n\n■ 注文番号　${o.orderNo}\n■ ご注文日時　${d}\n■ お支払い方法　${o.paymentMethod}\n\n${lines}\n\n${money}\n\n■ お届け先\n〒${c.postal}　${c.address}\n${c.name} 様\n\n発送の準備が整いましたら、改めてご連絡いたします。\nご不明な点は、このメールにご返信ください。\n\n${SHOP_NAME}`,
    });
  }
  if (salonEmail) {
    MailApp.sendEmail({
      to: salonEmail,
      name: `${SHOP_NAME} 注文通知`,
      subject: `【新規注文】${c.name} 様　${yen(o.total)}（${o.orderNo}）`,
      body: `新しいご注文が入りました（決済完了）。\n\n注文番号：${o.orderNo}\n日時：${d}\nお客様：${c.name}（${c.email}）\n電話：${c.phone || '-'}\nお届け先：〒${c.postal} ${c.address}\n支払い：${o.paymentMethod}\n\n${lines}\n\n${money}\n\nスプレッドシート：${SpreadsheetApp.getActive().getUrl()}`,
    });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 動作確認用：エディタから実行すると、テスト注文が1件記録され、メールが届きます */
function testOrder() {
  const order = {
    orderNo: 'ITO-TEST-' + Date.now().toString().slice(-6), sessionId: 'cs_test_dummy', createdAt: new Date().toISOString(),
    customer: { name: 'テスト 花子', email: PropertiesService.getScriptProperties().getProperty('SALON_EMAIL'), phone: '090-0000-0000', postal: '0000000', address: 'テスト住所' },
    items: [{ id: 'adj-fogsui', name: 'フォグスイ', price: 3190, qty: 2 }],
    subtotal: 6380, shipping: 770, total: 7150, paymentType: 'card', paymentMethod: 'クレジットカード', status: 'paid',
  };
  const res = doPost({ postData: { contents: JSON.stringify({ secret: PropertiesService.getScriptProperties().getProperty('SHARED_SECRET'), order }) } });
  Logger.log(res.getContent());
}
