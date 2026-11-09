// POST /api/checkout  { items: [{ id, q }] } → { url }  Stripe Checkout の決済画面URLを返す
import { PRODUCTS, SHOP, stripe, json } from "../lib/shop.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "リクエストの形式が正しくありません" }, 400); }

  const items = Array.isArray(body?.items) ? body.items.slice(0, 50) : [];
  const line_items = [];
  let subtotal = 0;
  for (const it of items) {
    const p = PRODUCTS.find(x => x.id === it?.id);
    const q = Number(it?.q);
    if (!p || p.soldout) return json({ error: "販売を終了した商品がカートに含まれています" }, 400);
    if (!Number.isInteger(q) || q < 1 || q > (SHOP.maxQtyPerItem || 10)) return json({ error: "個数を確認してください" }, 400);
    subtotal += p.price * q;
    line_items.push({
      quantity: q,
      price_data: {
        currency: "jpy",
        unit_amount: p.price, // 税込価格
        product_data: {
          name: p.volume ? `${p.name}（${p.volume}）` : p.name,
          metadata: { product_id: p.id, volume: p.volume || "" },
          ...(p.image && process.env.URL ? { images: [new URL(p.image, process.env.URL).href] } : {}),
        },
      },
    });
  }
  if (!line_items.length) return json({ error: "カートが空です" }, 400);

  const pickup = body?.fulfillment === "pickup" && !!SHOP.pickup?.enabled;
  const shippingFee = pickup || subtotal >= SHOP.freeShippingOver ? 0 : SHOP.shippingFee;
  const origin = process.env.URL || new URL(req.url).origin;

  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      locale: "ja",
      line_items,
      // 支払い方法（カード / Apple Pay / Google Pay / PayPay / コンビニ）は Stripe ダッシュボードの
      // 「設定 > 決済手段」で ON/OFF する（コードの変更は不要）
      billing_address_collection: "auto",
      // 郵送のときだけお届け先を入力してもらう（サロンで受け取りの場合は不要）
      ...(pickup ? {} : { shipping_address_collection: { allowed_countries: ["JP"] } }),
      phone_number_collection: { enabled: true },
      shipping_options: [{
        shipping_rate_data: pickup
          ? { type: "fixed_amount", display_name: "サロンで受け取り（送料無料）", fixed_amount: { amount: 0, currency: "jpy" } }
          : {
              type: "fixed_amount",
              display_name: shippingFee ? "通常配送" : "通常配送（送料無料）",
              fixed_amount: { amount: shippingFee, currency: "jpy" },
              delivery_estimate: { minimum: { unit: "business_day", value: 2 }, maximum: { unit: "business_day", value: 6 } },
            },
      }],
      metadata: { fulfillment: pickup ? "pickup" : "ship" },
      payment_method_options: { konbini: { expires_after_days: 3 } },
      // 色のご指定などを書いてもらう欄（任意）
      custom_fields: [{ key: "note", label: { type: "custom", custom: "ご要望（色のご指定など）" }, type: "text", optional: true, text: { maximum_length: 200 } }],
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}#done`,
      cancel_url: `${origin}/#cart`,
    });
    return json({ url: session.url });
  } catch (e) {
    console.error("checkout error", e);
    return json({ error: "決済画面を作成できませんでした" }, 500);
  }
};

export const config = { path: "/api/checkout" };
