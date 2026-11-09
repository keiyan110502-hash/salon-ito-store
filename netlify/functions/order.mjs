// GET /api/order?session_id=cs_...  完了画面に表示する注文内容を返す
import { retrieveSession, toOrder, json } from "../lib/shop.mjs";

export default async (req) => {
  const id = new URL(req.url).searchParams.get("session_id") || "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json({ error: "not found" }, 404);
  try {
    const session = await retrieveSession(id);
    if (session.status !== "complete") return json({ error: "not completed" }, 404);
    return json(toOrder(session));
  } catch (e) {
    console.error("order lookup error", e?.message);
    return json({ error: "not found" }, 404);
  }
};

export const config = { path: "/api/order" };
