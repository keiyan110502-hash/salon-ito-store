// サーバー側（Netlify Functions）で使う共通処理。
// 価格は必ずサーバー側の products.json から計算する（ブラウザから送られた金額は信用しない）。
import Stripe from "stripe";
import products from "../../public/data/products.json" with { type: "json" };
import shop from "../../public/data/shop.json" with { type: "json" };

export const PRODUCTS = products;
export const SHOP = shop;
export const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY);

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

// 注文番号は Checkout Session から一意に決める（Webhook・完了画面・スプレッドシートで同じ番号になる）
export function orderNo(session) {
  const d = new Date((session.created + 9 * 3600) * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  return `ITO-${d}-${session.id.slice(-6).toUpperCase()}`;
}

const PM_LABEL = { card: "クレジットカード", paypay: "PayPay", konbini: "コンビニ払い", apple_pay: "Apple Pay", google_pay: "Google Pay" };

// Stripe の Checkout Session（line_items と payment_intent.payment_method を expand 済み）を注文データに変換
export function toOrder(session) {
  const pm = session.payment_intent?.payment_method;
  let type = pm?.type || session.payment_method_types?.[0] || "card";
  const wallet = pm?.card?.wallet?.type;
  if (type === "card" && (wallet === "apple_pay" || wallet === "google_pay")) type = wallet;
  const ship = session.collected_information?.shipping_details || session.shipping_details || {};
  const addr = ship.address || session.customer_details?.address || {};
  return {
    orderNo: orderNo(session),
    sessionId: session.id,
    createdAt: new Date(session.created * 1000).toISOString(),
    customer: {
      name: ship.name || session.customer_details?.name || "",
      email: session.customer_details?.email || "",
      phone: session.customer_details?.phone || "",
      postal: addr.postal_code || "",
      address: [addr.state, addr.city, addr.line1, addr.line2].filter(Boolean).join(" "),
    },
    items: (session.line_items?.data || []).map(li => ({
      id: li.price?.product?.metadata?.product_id || "",
      name: li.description,
      volume: li.price?.product?.metadata?.volume || "",
      price: li.price?.unit_amount ?? Math.round(li.amount_total / li.quantity),
      qty: li.quantity,
    })),
    subtotal: session.amount_subtotal,
    shipping: session.total_details?.amount_shipping || 0,
    total: session.amount_total,
    paymentType: type,
    paymentMethod: PM_LABEL[type] || type,
    status: session.payment_status === "paid" ? "paid" : "unpaid",
  };
}

export async function retrieveSession(id) {
  return stripe().checkout.sessions.retrieve(id, {
    expand: ["line_items.data.price.product", "payment_intent.payment_method"],
  });
}
