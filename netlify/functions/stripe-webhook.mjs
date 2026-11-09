// POST /api/stripe-webhook  Stripe からの通知を受け取り、「決済が完了した注文だけ」を
// Google Apps Script（スプレッドシート記録＋メール送信）へ渡す
import { stripe, retrieveSession, toOrder, json } from "../lib/shop.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  const payload = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(payload, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("webhook signature error", e.message);
    return json({ error: "invalid signature" }, 400);
  }

  const paidNow =
    (event.type === "checkout.session.completed" && event.data.object.payment_status === "paid") ||
    event.type === "checkout.session.async_payment_succeeded"; // コンビニ払いの入金確認
  if (!paidNow) return json({ received: true, skipped: event.type });

  const order = toOrder(await retrieveSession(event.data.object.id));
  order.status = "paid";

  const r = await fetch(process.env.GAS_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: process.env.GAS_SHARED_SECRET, order }),
    redirect: "follow",
  });
  const text = await r.text();
  let res = {};
  try { res = JSON.parse(text); } catch {}
  if (!r.ok || !res.ok) {
    console.error("GAS error", r.status, text.slice(0, 300));
    return json({ error: "record failed" }, 500); // 500 を返すと Stripe が自動で再送する（GAS側で重複は除外）
  }
  return json({ received: true, orderNo: order.orderNo, duplicate: !!res.duplicate });
};

export const config = { path: "/api/stripe-webhook" };
