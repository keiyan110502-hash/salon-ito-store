/* salon ito Online Store — front-end (no build step)
 * 本番: data/*.json を読み込み、決済は /api/checkout（Stripe Checkout）へ。
 * プレビュー: scripts/build-preview.mjs が window.ITO_DEMO / window.__ITO_DATA__ を埋め込み、決済とメールを画面上で再現する。
 */
(async function () {
  const DEMO = !!window.ITO_DEMO;
  const app = document.getElementById("app");

  /* ---------- data ---------- */
  let PRODUCTS = [], SHOP = {}, NEWS = [];
  try {
    if (window.__ITO_DATA__) ({ products: PRODUCTS, shop: SHOP, news: NEWS } = window.__ITO_DATA__);
    else {
      const [p, s, n] = await Promise.all([fetch("data/products.json"), fetch("data/shop.json"), fetch("data/news.json").catch(() => null)]);
      PRODUCTS = await p.json(); SHOP = await s.json(); NEWS = n && n.ok ? await n.json() : [];
    }
  } catch (e) {
    app.innerHTML = `<div class="wrap empty">商品情報を読み込めませんでした。時間をおいて再度お試しください。</div>`;
    return;
  }

  const GROUPS = {
    "スキンケア": ["クレンジング", "洗顔", "化粧水", "美容液", "乳液", "クリーム", "UV・下地", "パック", "スキンケア"],
    "ボディ": ["ボディ"],
    "ヘアケア": ["シャンプー", "トリートメント", "ヘアケア", "スタイリング"],
  };
  const groupOf = c => Object.keys(GROUPS).find(g => GROUPS[g].includes(c)) || "その他";
  const PAYMENTS = [
    { key: "card", label: "クレジットカード", sub: "Visa / Mastercard / JCB / American Express / Diners Club" },
    { key: "wallet", label: "Apple Pay / Google Pay", sub: "対応端末でワンタップ決済" },
    { key: "paypay", label: "PayPay", sub: "PayPayアプリで支払い" },
    { key: "konbini", label: "コンビニ払い", sub: "払込票番号をメールでお送りします（3日以内にお支払い）" },
  ];
  const MAXQ = SHOP.maxQtyPerItem || 10;
  const P = id => PRODUCTS.find(p => p.id === id);
  const yen = n => "¥" + Number(n).toLocaleString("ja-JP");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- storage (best effort) ---------- */
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  let cart = load("ito-cart", []).filter(i => P(i.id) && !P(i.id).soldout);
  let history = load("ito-orders", []);
  let demoOrders = DEMO ? load("ito-demo-orders", null) : null;
  let filter = "すべて", detailQty = 1, mpTab = "orders", lastOrder = null;
  let fulfillment = load("ito-fulfillment", "ship"); // "ship"（郵送） | "pickup"（サロンで受け取り）
  const PICKUP = !!SHOP.pickup?.enabled;
  if (!PICKUP) fulfillment = "ship";
  const FUL_LABEL = { ship: "郵送", pickup: "サロンで受け取り" };

  function totals(items, ful = fulfillment) {
    const subtotal = items.reduce((s, i) => s + P(i.id).price * i.q, 0);
    const shipping = ful === "pickup" || subtotal === 0 || subtotal >= SHOP.freeShippingOver ? 0 : SHOP.shippingFee;
    return { subtotal, shipping, total: subtotal + shipping };
  }
  function setCart(next) { cart = next; save("ito-cart", cart); badge(); }
  function badge() { const n = cart.reduce((s, i) => s + i.q, 0), b = document.getElementById("badge"); b.textContent = n; b.hidden = !n; }
  function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200); }

  /* ---------- placeholder art (used until real photos are added) ---------- */
  function art(p) {
    if (p.image) return `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" width="800" height="800">`;
    const cap = "#3A3633", body = "#FFFFFF", edge = "#E2DED9";
    const c = p.category;
    const shape =
      ["美容液"].includes(c) ? "dropper" :
      ["クレンジング", "洗顔", "UV・下地", "クリーム"].includes(c) ? "tube" :
      ["シャンプー", "トリートメント"].includes(c) ? "pump" :
      ["ボディ"].includes(c) ? "mist" : "bottle";
    const S = {
      bottle: `<rect x="186" y="104" width="28" height="16" fill="${cap}"/><rect x="176" y="118" width="48" height="26" rx="3" fill="${cap}"/><rect x="154" y="142" width="92" height="164" rx="10" fill="${body}" stroke="${edge}"/>`,
      dropper: `<ellipse cx="200" cy="112" rx="11" ry="17" fill="${cap}"/><rect x="186" y="126" width="28" height="26" fill="${cap}"/><rect x="164" y="150" width="72" height="156" rx="8" fill="${body}" stroke="${edge}"/>`,
      tube: `<path d="M162 96h76l-8 168h-60z" fill="${body}" stroke="${edge}"/><rect x="176" y="262" width="48" height="44" rx="3" fill="${cap}"/>`,
      pump: `<path d="M196 86h40v7h-30v20h-10z" fill="${cap}"/><rect x="190" y="112" width="20" height="30" fill="${cap}"/><rect x="158" y="140" width="84" height="166" rx="6" fill="${body}" stroke="${edge}"/>`,
      mist: `<rect x="192" y="96" width="16" height="12" fill="${cap}"/><rect x="182" y="106" width="36" height="34" rx="4" fill="${cap}"/><rect x="164" y="138" width="72" height="168" rx="20" fill="${body}" stroke="${edge}"/>`,
    }[shape];
    const ly = shape === "tube" ? 180 : 230;
    return `<svg viewBox="0 0 400 400" role="img" aria-label="${esc(p.name)}（商品画像準備中）"><rect width="400" height="400" fill="#F5F4F2"/><ellipse cx="200" cy="310" rx="70" ry="6" fill="rgba(0,0,0,.05)"/>${S}<text x="200" y="${ly}" text-anchor="middle" font-family="Cormorant Garamond, serif" font-size="12" letter-spacing="2" fill="#6E6A66">${esc(p.brand)}</text><line x1="186" x2="214" y1="${ly + 10}" y2="${ly + 10}" stroke="#B4232C" stroke-width=".8"/></svg>`;
  }

  /* ---------- red thread ---------- */
  const T1 = "M312 -6 C250 60 190 110 200 200 C208 270 260 300 236 350 C214 396 150 380 158 330 C166 282 236 296 232 368 C228 450 140 520 170 620 C196 706 286 760 312 900";
  const T2 = "M312 -6 C244 66 180 120 192 210 C202 282 258 306 232 356 C208 402 146 384 154 334 C162 286 232 300 228 372 C222 456 150 530 182 628 C210 712 290 768 312 900";
  const threadSVG = () => `
    <svg class="thread" viewBox="0 0 312 900" preserveAspectRatio="xMaxYMin meet" aria-hidden="true">
      <path class="t1" d="${T1}"><animate attributeName="d" dur="11s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" values="${T1};${T2};${T1}"/></path>
      <path class="t2" d="${T2}" transform="translate(-16 26)"><animate attributeName="d" dur="13s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" values="${T2};${T1};${T2}"/></path>
    </svg>`;
  function drawThread() {
    const svg = app.querySelector(".thread");
    if (!svg || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      svg?.querySelectorAll("animate").forEach(a => a.remove());
      return;
    }
    svg.querySelectorAll("path").forEach(p => {
      const L = Math.ceil(p.getTotalLength() * 1.3);
      p.style.strokeDasharray = `${L} ${L}`;
      p.style.setProperty("--len", L);
    });
    svg.classList.add("draw");
  }
  const curl = `<svg class="curl" viewBox="0 0 40 14" aria-hidden="true"><path d="M0 9 C8 9 12 3 20 4 C26 5 26 12 21 11 C16 10 19 3 26 4 C32 5 35 8 40 8"/></svg>`;

  /* ---------- views ---------- */
  function card(p) {
    return `<a class="card" href="#item-${p.id}">
      <div class="sq">${art(p)}${p.tag && !p.soldout ? `<span class="flag">${esc(p.tag)}</span>` : ""}</div>
      <div class="card-meta">
        <span class="brand">${esc(p.brand)}</span>
        <span class="name">${esc(p.name)}${p.volume ? `　${esc(p.volume)}` : ""}</span>
        ${p.soldout ? `<span class="soldout">SOLD OUT</span>` : `<span class="price">${yen(p.price)}<small>税込</small></span>`}
      </div></a>`;
  }

  function viewShop(scrollToItems) {
    const brands = [...new Set(PRODUCTS.map(p => p.brand))];
    const tabs = ["すべて", ...Object.keys(GROUPS).filter(g => PRODUCTS.some(p => groupOf(p.category) === g)), ...brands];
    const list = PRODUCTS.filter(p => filter === "すべて" || groupOf(p.category) === filter || p.brand === filter);
    app.innerHTML = `
    <section class="hero">
      ${threadSVG()}
      <div class="wrap hero-in">
        <div class="hero-lead">
          <h1 class="hero-mark">salon ito<span>Online Store</span></h1>
          <p class="hero-text">サロンで実際に使っているスキンケアとヘアケアを、ご自宅でも。<br>施術のあとも続く心地よさを、一本の糸のようにつないでいきます。</p>
          <a class="textlink" href="#items">商品を見る</a>
        </div>
        <p class="tate">サロンの手ざわりを、<br>毎日の<em>暮らし</em>へ。</p>
      </div>
    </section>

    ${NEWS && NEWS.length ? "" : "<!--"}<section class="sec"><div class="wrap sec-row">
      <h2 class="vlabel">お知らせ</h2>
      <ul class="news">${(NEWS || []).map(n => `<li><time>${esc(n.date)}</time><span>${esc(n.text)}</span></li>`).join("")}</ul>
    </div></section>${NEWS && NEWS.length ? "" : "-->"}

    <section class="sec" id="items"><div class="wrap">
      <div class="heading">
        <h2><small>Items ${curl}</small>商品一覧</h2>
        <span class="count">${list.length} items</span>
      </div>
      <div class="filters" role="toolbar" aria-label="絞り込み">
        ${tabs.map(t => `<button data-f="${esc(t)}" aria-pressed="${t === filter}">${esc(t)}</button>`).join("")}
      </div>
      <div class="grid">${list.map(card).join("") || `<p class="empty" style="grid-column:1/-1">該当する商品がありません。</p>`}</div>
    </div></section>`;
    app.querySelectorAll("[data-f]").forEach(b => (b.onclick = () => {
      filter = b.dataset.f;
      const y = scrollY; viewShop(); scrollTo(0, y);
    }));
    drawThread();
    if (scrollToItems) document.getElementById("items").scrollIntoView();
  }

  function viewItem(id) {
    const p = P(id);
    if (!p) return viewShop();
    detailQty = 1;
    const chips = [p.line && `${p.line} シリーズ`, p.category, p.quasiDrug && "医薬部外品"].filter(Boolean);
    const buyControls = (cls) => p.soldout
      ? `<button class="btn block" disabled>SOLD OUT</button>`
      : `<div class="qty" aria-label="個数"><button class="minus" aria-label="1つ減らす">−</button><span class="qv">1</span><button class="plus" aria-label="1つ増やす">＋</button></div>
         <button class="btn ${cls} add">カートに入れる</button>`;
    app.innerHTML = `<div class="wrap">
      <p class="crumb"><a href="#shop">トップ</a>　/　<a href="#items">商品一覧</a>　/　${esc(p.name)}</p>
      <div class="detail">
        <div class="sq">${art(p)}</div>
        <div>
          <span class="brand">${esc(p.brand)}</span>
          <h1>${esc(p.name)}</h1>
          ${p.soldout ? `<p class="soldout">SOLD OUT</p>` : `<p class="price">${yen(p.price)}<small>税込</small></p>`}
          ${p.draft ? `<p class="draftnote">※ 仮データです。商品名・容量・価格は公式情報で確認のうえ確定してください。</p>` : ""}
          <ul class="chips">${chips.map((c, i) => `<li class="${i === 2 ? "red" : ""}">${esc(c)}</li>`).join("")}</ul>
          ${p.description ? `<p class="official">${esc(p.description)}</p>` : `<p class="placeholder">商品説明（メーカー公式の文章をそのまま掲載します）</p>`}
          <div class="buy">${buyControls("red")}</div>
          <dl class="spec">
            ${p.volume ? `<dt>容量</dt><dd>${esc(p.volume)}</dd>` : ""}
            <dt>使い方</dt><dd>${p.howTo ? esc(p.howTo) : `<span style="color:var(--muted)">公式の使用方法を掲載</span>`}</dd>
            <dt>全成分</dt><dd>${p.ingredients ? esc(p.ingredients) : `<span style="color:var(--muted)">公式の全成分表示を掲載</span>`}</dd>
            <dt>ブランド</dt><dd>${esc(p.brand)}</dd>
            ${p.officialUrl ? `<dt>公式情報</dt><dd><a href="${esc(p.officialUrl)}" target="_blank" rel="noopener">メーカーサイトで見る</a></dd>` : ""}
          </dl>
        </div>
      </div>
      <div class="mbar">${buyControls("red")}</div>
    </div>`;
    document.body.classList.add("with-mbar");
    const qvs = app.querySelectorAll(".qv");
    const setQ = q => { detailQty = Math.max(1, Math.min(MAXQ, q)); qvs.forEach(s => (s.textContent = detailQty)); };
    app.querySelectorAll(".minus").forEach(b => (b.onclick = () => setQ(detailQty - 1)));
    app.querySelectorAll(".plus").forEach(b => (b.onclick = () => setQ(detailQty + 1)));
    app.querySelectorAll(".add").forEach(b => (b.onclick = () => {
      const next = cart.map(i => ({ ...i }));
      const ex = next.find(i => i.id === p.id);
      if (ex) ex.q = Math.min(MAXQ, ex.q + detailQty); else next.push({ id: p.id, q: detailQty });
      setCart(next); toast(`カートに${detailQty}点追加しました`); setQ(1);
    }));
  }

  function sumBlock(items) {
    const t = totals(items), rest = SHOP.freeShippingOver - t.subtotal;
    return `<div class="sum">
      <span>小計</span><span class="v">${yen(t.subtotal)}</span>
      <span>${fulfillment === "pickup" ? "受け取り" : "送料"}</span><span class="v">${fulfillment === "pickup" ? "サロンで受け取り（無料）" : t.shipping ? yen(t.shipping) : "無料"}</span>
      <span class="t">合計（税込）</span><span class="t v">${yen(t.total)}</span>
      ${fulfillment !== "pickup" && t.subtotal > 0 && rest > 0 ? `<span class="note">あと${yen(rest)}で送料無料になります</span>` : ""}
    </div>`;
  }

  function viewCart() {
    if (!cart.length) {
      app.innerHTML = `<div class="wrap"><h1 class="ptitle">カート</h1><div class="empty"><p>カートに商品は入っていません。</p><a class="btn line" href="#items">商品一覧へ</a></div></div>`;
      return;
    }
    app.innerHTML = `<div class="wrap">
      <h1 class="ptitle">カート</h1>
      <ol class="steps"><li class="on">カート</li><li>ご注文内容の確認</li><li>お支払い</li><li>完了</li></ol>
      <div class="two">
        <div class="box"><h3>商品</h3>${cart.map(i => { const p = P(i.id); return `
          <div class="li">
            <a class="sq" href="#item-${p.id}">${art(p)}</a>
            <div><div class="n">${esc(p.name)}</div><div class="s">${esc(p.brand)}${p.volume ? "｜" + esc(p.volume) : ""}｜${yen(p.price)}</div></div>
            <div class="r">
              <div class="qty"><button data-d="-1" data-id="${p.id}" aria-label="減らす">−</button><span>${i.q}</span><button data-d="1" data-id="${p.id}" aria-label="増やす">＋</button></div>
              <span class="price">${yen(p.price * i.q)}</span>
              <button class="ulink" data-rm="${p.id}">削除</button>
            </div>
          </div>`; }).join("")}
        </div>
        <div class="box"><h3>ご注文金額</h3>${sumBlock(cart)}
          <div style="display:grid;gap:10px;margin-top:24px"><a class="btn block" href="#checkout">ご購入手続きへ</a><a class="btn line block" href="#items">買い物を続ける</a></div>
        </div>
      </div></div>`;
    app.querySelectorAll("[data-d]").forEach(b => (b.onclick = () => {
      setCart(cart.map(i => i.id === b.dataset.id ? { ...i, q: Math.max(1, Math.min(MAXQ, i.q + +b.dataset.d)) } : i)); viewCart();
    }));
    app.querySelectorAll("[data-rm]").forEach(b => (b.onclick = () => { setCart(cart.filter(i => i.id !== b.dataset.rm)); viewCart(); }));
  }

  // 特定商取引法の「最終確認画面」で表示が必要な事項（分量・価格・支払時期/方法・引渡時期・解除）をここで表示する
  function viewCheckout() {
    if (!cart.length) { location.hash = "cart"; return; }
    const t = totals(cart);
    app.innerHTML = `<div class="wrap">
      <h1 class="ptitle">ご注文内容の確認</h1>
      <ol class="steps"><li>カート</li><li class="on">ご注文内容の確認</li><li>お支払い</li><li>完了</li></ol>
      <div class="two">
        <div class="box"><h3>ご注文商品</h3>
          ${cart.map(i => { const p = P(i.id); return `<div class="sum" style="margin-bottom:8px"><span>${esc(p.name)}${p.volume ? `（${esc(p.volume)}）` : ""} × ${i.q}</span><span class="v">${yen(p.price * i.q)}</span></div>`; }).join("")}
          ${PICKUP ? `<h3 style="margin-top:32px">受け取り方法</h3>
          <div class="ful" role="radiogroup" aria-label="受け取り方法">
            <label><input type="radio" name="ful" id="ful-ship" value="ship" ${fulfillment === "ship" ? "checked" : ""}><span><b>郵送でお届け</b><small>送料 ${yen(SHOP.shippingFee)}（${yen(SHOP.freeShippingOver)}以上で無料）</small></span></label>
            <label><input type="radio" name="ful" id="ful-pickup" value="pickup" ${fulfillment === "pickup" ? "checked" : ""}><span><b>サロンで受け取り</b><small>送料無料｜${esc(SHOP.pickup.note)}</small></span></label>
          </div>` : ""}
          <div style="margin-top:18px" id="sumbox">${sumBlock(cart)}</div>
          <h3 style="margin-top:36px">ご利用いただけるお支払い方法</h3>
          <ul class="paylist">${PAYMENTS.map(m => `<li><i></i><span><b>${m.label}</b><small>${m.sub}</small></span></li>`).join("")}</ul>
        </div>
        <div class="box"><h3>ご確認ください</h3>
          <dl class="final">
            <dt>お支払い時期</dt><dd>カード・Apple Pay・Google Pay・PayPayはご注文時。コンビニ払いはご注文から3日以内。</dd>
            <dt id="ful-dt">${fulfillment === "pickup" ? "お受け取り" : "お届け時期"}</dt><dd id="ful-dd">${esc(fulfillment === "pickup" ? SHOP.pickup.note : SHOP.deliveryNote)}</dd>
            <dt>返品・キャンセル</dt><dd>お客様都合による返品はお受けしていません。不良品・誤配送の場合は到着後7日以内にご連絡ください。詳しくは<a href="#tokushoho">特定商取引法に基づく表記</a>をご覧ください。</dd>
          </dl>
          <label class="agree"><input type="checkbox" id="agree"><span><a href="#guide">ご利用ガイド</a>・<a href="#tokushoho">特定商取引法に基づく表記</a>・<a href="#privacy">プライバシーポリシー</a>に同意します</span></label>
          <button class="btn red block" id="go" disabled>お支払いへ進む（<span id="go-total">${yen(t.total)}</span>）</button>
          <p class="err" id="err" hidden></p>
          <p class="small-note">次の画面で、お届け先とお支払い方法を入力します。決済は Stripe の安全な画面で行われ、カード情報は当店に保存されません。</p>
        </div>
      </div></div>`;
    const agree = document.getElementById("agree"), go = document.getElementById("go"), err = document.getElementById("err");
    agree.onchange = () => (go.disabled = !agree.checked);
    app.querySelectorAll("[name=ful]").forEach(r => (r.onchange = () => {
      fulfillment = r.value; save("ito-fulfillment", fulfillment);
      document.getElementById("sumbox").innerHTML = sumBlock(cart);
      document.getElementById("go-total").textContent = yen(totals(cart).total);
      document.getElementById("ful-dt").textContent = fulfillment === "pickup" ? "お受け取り" : "お届け時期";
      document.getElementById("ful-dd").textContent = fulfillment === "pickup" ? SHOP.pickup.note : SHOP.deliveryNote;
    }));
    go.onclick = async () => {
      if (DEMO) { location.hash = "pay-demo"; return; }
      go.disabled = true; go.textContent = "決済画面へ移動しています…"; err.hidden = true;
      try {
        const r = await fetch("api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: cart, fulfillment }) });
        const d = await r.json();
        if (!r.ok || !d.url) throw new Error(d.error || "決済画面を開けませんでした");
        location.href = d.url;
      } catch (e) {
        err.textContent = e.message + "。時間をおいてもう一度お試しください。"; err.hidden = false;
        go.disabled = false; go.innerHTML = `お支払いへ進む（<span id="go-total">${yen(totals(cart).total)}</span>）`;
      }
    };
  }

  /* demo only: stands in for the Stripe-hosted payment page */
  function viewPayDemo() {
    if (!cart.length) { location.hash = "cart"; return; }
    const t = totals(cart);
    app.innerHTML = `<div class="wrap">
      <h1 class="ptitle">お支払い</h1>
      <ol class="steps"><li>カート</li><li>ご注文内容の確認</li><li class="on">お支払い</li><li>完了</li></ol>
      <div class="two">
        <form class="box" id="pf">
          <p class="draftnote">デモ画面です。本番ではここが Stripe の決済画面になり、お客様がお届け先と支払い方法を入力します。</p>
          <div class="fgrid">
            <label class="f">お名前<input id="d-name" value="山田 花子" required></label>
            <label class="f">メールアドレス<input id="d-email" type="email" value="hanako@example.com" required></label>
            <label class="f">電話番号<input id="d-tel" value="090-0000-0000"></label>
            ${fulfillment === "pickup" ? "" : `<label class="f">郵便番号<input id="d-zip" value="000-0000"></label>
            <label class="f">住所<input id="d-addr" value="○○県○○市○○ 1-2-3"></label>`}
          </div>
          <h3 style="margin-top:32px">お支払い方法</h3>
          <ul class="paylist">${PAYMENTS.map((m, i) => `<li><input type="radio" name="pm" id="pm-${m.key}" value="${m.key}" ${i ? "" : "checked"} style="accent-color:var(--red)"><label for="pm-${m.key}"><b>${m.label}</b><small>${m.sub}</small></label></li>`).join("")}</ul>
          <button class="btn red block" type="submit">${yen(t.total)} を支払う（デモ）</button>
        </form>
        <div class="box"><h3>ご注文金額</h3>${sumBlock(cart)}</div>
      </div></div>`;
    document.getElementById("pf").onsubmit = e => {
      e.preventDefault();
      const v = id => document.getElementById(id)?.value.trim() || "";
      const pm = document.querySelector("[name=pm]:checked").value;
      const now = new Date(), pad = n => String(n).padStart(2, "0");
      const order = {
        orderNo: `ITO-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        createdAt: now.toISOString(),
        customer: { name: v("d-name"), email: v("d-email"), phone: v("d-tel"), postal: v("d-zip"), address: v("d-addr") },
        items: cart.map(i => { const p = P(i.id); return { id: p.id, name: p.name, volume: p.volume, price: p.price, qty: i.q }; }),
        ...totals(cart),
        fulfillment,
        paymentType: pm, paymentMethod: PAYMENTS.find(m => m.key === pm).label,
        status: pm === "konbini" ? "unpaid" : "paid",
      };
      demoOrders = [...(demoOrders || []), order]; save("ito-demo-orders", demoOrders);
      finishOrder(order);
      location.hash = "done";
    };
  }

  function finishOrder(order) {
    lastOrder = order;
    if (!history.some(o => o.orderNo === order.orderNo)) { history = [order, ...history].slice(0, 30); save("ito-orders", history); }
    save("ito-customer", order.customer);
    setCart([]);
  }

  const fmtDate = iso => { const d = new Date(iso), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  // GAS（gas/Code.gs）のメール本文と同じ構成
  function mailTexts(o) {
    const pickup = o.fulfillment === "pickup";
    const lines = o.items.map(i => `・${i.name}${i.volume ? `（${i.volume}）` : ""} × ${i.qty}　${yen(i.price * i.qty)}`).join("\n");
    const money = `小計　${yen(o.subtotal)}\n${pickup ? "受け取り　サロンで受け取り（無料）" : `送料　${o.shipping ? yen(o.shipping) : "無料"}`}\n合計　${yen(o.total)}（税込）`;
    const pay = o.status === "unpaid" ? `\n※コンビニ払いのお客様は、別途届くメールの払込番号で3日以内にお支払いください。お支払い確認後に${pickup ? "ご用意" : "発送"}します。\n` : "";
    const where = pickup
      ? `■ 受け取り方法\nサロンで受け取り\n${SHOP.pickup?.note || ""}`
      : `■ お届け先\n〒${o.customer.postal}　${o.customer.address}\n${o.customer.name} 様\n\n${SHOP.deliveryNote}`;
    return {
      customer: `${o.customer.name} 様\n\nこのたびは salon ito オンラインストアをご利用いただき、誠にありがとうございます。\n以下の内容でご注文を承りました。\n\n■ 注文番号　${o.orderNo}\n■ ご注文日時　${fmtDate(o.createdAt)}\n■ お支払い方法　${o.paymentMethod}\n\n${lines}\n\n${money}\n${pay}\n${where}\nご不明な点は、このメールにご返信ください。\n\nsalon ito`,
      salon: `新しいご注文が入りました。\n\n注文番号：${o.orderNo}\n日時：${fmtDate(o.createdAt)}\nお客様：${o.customer.name}（${o.customer.email}）\n電話：${o.customer.phone || "-"}\n受け取り：${pickup ? "【サロンで受け取り】" : `郵送　〒${o.customer.postal} ${o.customer.address}`}\n支払い：${o.paymentMethod}${o.status === "unpaid" ? "（入金待ち）" : ""}\n\n${lines}\n\n${money}\n\nスプレッドシート「注文一覧」に記録済みです。`,
    };
  }

  async function viewDone() {
    let o = lastOrder;
    const sid = new URLSearchParams(location.search).get("session_id");
    if (!o && sid && !DEMO) {
      app.innerHTML = `<div class="wrap empty">ご注文内容を確認しています…</div>`;
      try {
        const r = await fetch("api/order?session_id=" + encodeURIComponent(sid));
        if (r.ok) { o = await r.json(); finishOrder(o); }
      } catch {}
      try { window.history.replaceState(null, "", location.pathname + "#done"); } catch {}
    }
    if (!o) o = history[0];
    if (!o) { location.hash = "shop"; return; }
    const m = mailTexts(o);
    const done = `<svg viewBox="0 0 120 40" aria-hidden="true"><path d="M0 26 C20 26 34 10 54 12 C68 14 70 32 58 31 C46 30 50 10 66 11 C86 12 100 22 120 20"/></svg>`;
    app.innerHTML = `<div class="wrap">
      <div class="done">${done}
        <h1>ご注文ありがとうございました</h1>
        <p>注文番号　<span class="no">${esc(o.orderNo)}</span></p>
        <p>${o.status === "unpaid" ? `コンビニでのお支払い確認後に${o.fulfillment === "pickup" ? "ご用意" : "発送"}いたします。` : o.fulfillment === "pickup" ? "ご用意ができましたらメールでお知らせします。" : "ご注文を承りました。"}確認メールを ${esc(o.customer.email)} にお送りしました。</p>
        <div class="row-btns"><a class="btn" href="#mypage">注文履歴を見る</a><a class="btn line" href="#shop">トップへ戻る</a></div>
      </div>
      ${DEMO ? `<p class="tagline" style="margin:24px 0 12px">送信されるメールのイメージ（デモ）</p>
      <div class="mails">
        <article class="mail"><header><span class="tagline">お客様宛</span><b>【salon ito】ご注文ありがとうございます（${esc(o.orderNo)}）</b><span>To: ${esc(o.customer.email)}</span></header><pre>${esc(m.customer)}</pre></article>
        <article class="mail"><header><span class="tagline">サロン宛</span><b>【新規注文】${esc(o.customer.name)} 様　${yen(o.total)}</b><span>To: サロンの受信用アドレス</span></header><pre>${esc(m.salon)}</pre></article>
      </div>` : `<div style="height:48px"></div>`}
    </div>`;
  }

  function viewMypage() {
    const me = load("ito-customer", null);
    const body = mpTab === "orders"
      ? (history.length ? history.map(o => `
        <div class="order">
          <div class="oh"><span>${fmtDate(o.createdAt)}</span><span class="badge ${o.status === "unpaid" ? "wait" : ""}">${o.status === "unpaid" ? "お支払い待ち" : "ご注文受付済み"}</span></div>
          <span class="no">${esc(o.orderNo)}</span>
          <div style="font-size:13px">${o.items.map(i => `${esc(i.name)} × ${i.qty}`).join("、")}</div>
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--muted)"><span>${esc(o.paymentMethod)}｜${FUL_LABEL[o.fulfillment || "ship"]}</span><span class="price" style="color:var(--ink)">${yen(o.total)}</span></div>
          <div><button class="ulink" data-again="${esc(o.orderNo)}">同じ商品をもう一度カートに入れる</button></div>
        </div>`).join("") : `<p class="empty">まだご注文はありません。</p>`)
      : (me ? `<dl class="spec" style="border:0;padding:0">
          <dt>お名前</dt><dd>${esc(me.name)}</dd><dt>メール</dt><dd>${esc(me.email)}</dd><dt>電話番号</dt><dd>${esc(me.phone || "-")}</dd><dt>お届け先</dt><dd>〒${esc(me.postal)}<br>${esc(me.address)}</dd>
        </dl>` : `<p class="empty">ご注文後に、最後にご入力いただいた情報が表示されます。</p>`);
    app.innerHTML = `<div class="wrap">
      <h1 class="ptitle">マイページ</h1>
      <p style="color:var(--muted);font-size:12px;margin:0 0 32px">${me ? esc(me.name) + " 様" : "ようこそ"}</p>
      <div class="mp">
        <nav class="mp-nav"><button data-tab="orders" aria-current="${mpTab === "orders"}">注文履歴</button><button data-tab="profile" aria-current="${mpTab === "profile"}">ご登録情報</button></nav>
        <div class="box"><h3>${mpTab === "orders" ? "注文履歴" : "ご登録情報"}</h3>${body}
          <p class="small-note">注文履歴はこの端末のブラウザに保存されています。ほかの端末では表示されません。ご注文内容は確認メールでもご確認いただけます。お問い合わせは ${esc(SHOP.legal?.email || "")} まで。</p>
        </div>
      </div></div>`;
    app.querySelectorAll("[data-tab]").forEach(b => (b.onclick = () => { mpTab = b.dataset.tab; viewMypage(); }));
    app.querySelectorAll("[data-again]").forEach(b => (b.onclick = () => {
      const o = history.find(x => x.orderNo === b.dataset.again), next = cart.map(i => ({ ...i }));
      o.items.forEach(it => { const p = P(it.id); if (!p || p.soldout) return; const ex = next.find(c => c.id === it.id); if (ex) ex.q = Math.min(MAXQ, ex.q + it.qty); else next.push({ id: it.id, q: it.qty }); });
      setCart(next); location.hash = "cart";
    }));
  }

  /* ---------- legal pages (fill 【要入力】 in data/shop.json) ---------- */
  const todo = s => esc(s).replace(/【要入力】/g, `<span class="todo">【要入力】</span>`);
  function viewTokushoho() {
    const L = SHOP.legal || {};
    const rows = [
      ["販売業者", L.seller], ["運営統括責任者", L.manager], ["所在地", L.address], ["電話番号", L.tel], ["メールアドレス", L.email], ["ホームページ", L.url],
      ["販売価格", "各商品ページに記載の価格（消費税込み）"],
      ["商品代金以外の必要料金", `送料 ${yen(SHOP.shippingFee)}（${yen(SHOP.freeShippingOver)}以上のご注文で無料）。コンビニ払いの支払手数料は当店が負担します。`],
      ["お支払い方法", PAYMENTS.map(m => m.label).join("、")],
      ["お支払い時期", "クレジットカード・Apple Pay・Google Pay・PayPay：ご注文時にお支払いが確定します。\nコンビニ払い：ご注文から3日以内にお支払いください。期限を過ぎるとご注文は自動的にキャンセルされます。"],
      ["商品の引渡時期", `郵送：${SHOP.deliveryNote}` + (PICKUP ? `\nサロンで受け取り：${SHOP.pickup.note}` : "")],
      ["返品・交換について", "商品の性質上、お客様都合による返品・交換はお受けしておりません。\n商品の破損・不良・誤配送の場合は、商品到着後7日以内にご連絡ください。送料当店負担で交換または返金いたします。"],
      ["申込みの撤回・解除", "ご注文確定後のキャンセルは、発送前に限りご連絡いただいた場合に承ります。"],
    ];
    app.innerHTML = `<div class="wrap doc"><h1 class="ptitle">特定商取引法に基づく表記</h1>
      <table><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td style="white-space:pre-wrap">${todo(v)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function viewPrivacy() {
    const L = SHOP.legal || {};
    app.innerHTML = `<div class="wrap doc"><h1 class="ptitle">プライバシーポリシー</h1>
      <p>${todo(L.seller)}（以下「当店」）は、オンラインストアのご利用にあたりお預かりする個人情報を、以下のとおり取り扱います。</p>
      <h2>1. 取得する情報</h2><p>お名前、ご住所、電話番号、メールアドレス、ご注文内容、お支払いに関する情報（決済の結果のみ。カード番号は当店では取得・保存しません）。</p>
      <h2>2. 利用目的</h2><ul><li>ご注文商品の発送、ご注文・お支払いに関するご連絡</li><li>お問い合わせへの対応</li><li>サロンからのお知らせのご案内（ご希望の方のみ）</li><li>売上の集計など、サービス改善のための統計（個人を特定しない形）</li></ul>
      <h2>3. 業務の委託</h2><p>利用目的の達成に必要な範囲で、次の事業者に個人情報の取扱いを委託します。決済：Stripe（米国の事業者を含む）／注文記録・メール送信：Google（Google Workspace等）／配送：配送業者。これらの事業者には適切な管理を求めます。</p>
      <h2>4. 第三者提供</h2><p>法令に基づく場合を除き、ご本人の同意なく第三者に提供しません。</p>
      <h2>5. 外国にある事業者への提供について</h2><p>決済・データ保管のため、米国等の事業者のサーバーで情報が取り扱われる場合があります。各国の個人情報保護制度については、個人情報保護委員会のウェブサイトをご確認ください。</p>
      <h2>6. 安全管理</h2><p>個人情報への不正アクセス、紛失、漏えい等を防ぐため、アクセスできる者を限定するなど必要な措置を講じます。</p>
      <h2>7. 開示・訂正・削除のご請求</h2><p>ご本人からのご請求があった場合、本人確認のうえ速やかに対応します。下記窓口までご連絡ください。</p>
      <h2>8. お問い合わせ窓口</h2><p>${todo(L.seller)}<br>${todo(L.address)}<br>${todo(L.email)}</p>
      <h2>9. 改定</h2><p>本ポリシーは必要に応じて改定し、本ページに掲載します。</p>
      <p style="color:var(--muted)">制定日：<span class="todo">【要入力】</span>2026年○月○日</p></div>`;
  }
  function viewGuide() {
    app.innerHTML = `<div class="wrap doc"><h1 class="ptitle">ご利用ガイド</h1>
      <h2>ご注文の流れ</h2><p>商品ページで個数を選んでカートへ → ご注文内容の確認 → お支払い画面でお届け先とお支払い方法を入力 → ご注文完了。完了後に確認メールをお送りします。</p>
      <h2>送料</h2><p>全国一律 ${yen(SHOP.shippingFee)}（税込）。${yen(SHOP.freeShippingOver)}（税込）以上のご注文で送料無料です。</p>
      <h2>お支払い方法</h2><ul>${PAYMENTS.map(m => `<li>${m.label}：${m.sub}</li>`).join("")}</ul>
      <h2>お届け</h2><p>${esc(SHOP.deliveryNote)}</p>
      ${PICKUP ? `<h2>サロンで受け取り</h2><p>ご注文時に「サロンで受け取り」を選ぶと送料はかかりません。${esc(SHOP.pickup.note)}</p>` : ""}
      <h2>返品・交換</h2><p>お客様都合による返品はお受けしておりません。不良品・誤配送の場合は到着後7日以内にご連絡ください。</p>
      <h2>肌に合わない場合</h2><p>ご使用中、またはご使用後に赤み・かゆみ等の異常があらわれた場合は使用を中止し、皮膚科専門医等にご相談ください。</p></div>`;
  }

  /* demo only: what the Google Sheet will look like */
  function viewSheet() {
    const orders = demoOrders || [];
    const RATE = { card: .036, wallet: .036, paypay: .036, konbini: .036 };
    const rows = [];
    orders.forEach(o => o.items.forEach((i, k) => rows.push({ o, i, first: k === 0 })));
    const paid = orders.filter(o => o.status === "paid");
    const total = paid.reduce((s, o) => s + o.total, 0);
    const net = paid.reduce((s, o) => s + Math.round(o.total * (1 - (RATE[o.paymentType] || .036))), 0);
    app.innerHTML = `<div class="wrap" style="padding-bottom:72px">
      <h1 class="ptitle">注文一覧（スプレッドシート連携イメージ）</h1>
      <p style="color:var(--muted);font-size:12px;max-width:46em">決済が完了した注文だけが、Googleスプレッドシートに1商品1行で追記されます。デモで注文するとここに行が増えます。手数料率は仮の値（3.6%）で、Stripeの料金表で確認のうえ設定します。</p>
      <div class="kpis">
        <div class="kpi"><small>決済完了の注文</small><b>${paid.length}件</b></div>
        <div class="kpi"><small>売上（税込）</small><b>${yen(total)}</b></div>
        <div class="kpi"><small>手数料控除後の入金見込み</small><b>${yen(net)}</b></div>
        <div class="kpi"><small>平均客単価</small><b>${yen(Math.round(total / Math.max(1, paid.length)))}</b></div>
      </div>
      ${rows.length ? `<div class="sheet-wrap"><table class="sheet">
        <thead><tr><th class="rn"></th><th>注文日時</th><th>注文番号</th><th>購入者</th><th>メール</th><th>商品ID</th><th>商品名</th><th>単価</th><th>数量</th><th>小計</th><th>送料</th><th>注文合計</th><th>支払方法</th><th>入金見込み</th><th>ステータス</th><th>受取方法</th></tr></thead>
        <tbody>${rows.map((r, ix) => `<tr><td class="rn">${ix + 2}</td><td>${fmtDate(r.o.createdAt)}</td><td>${esc(r.o.orderNo)}</td><td>${esc(r.o.customer.name)}</td><td>${esc(r.o.customer.email)}</td><td>${esc(r.i.id)}</td><td>${esc(r.i.name)}</td><td class="num">${r.i.price.toLocaleString()}</td><td class="num">${r.i.qty}</td><td class="num">${(r.i.price * r.i.qty).toLocaleString()}</td><td class="num">${r.first ? r.o.shipping.toLocaleString() : ""}</td><td class="num">${r.first ? r.o.total.toLocaleString() : ""}</td><td>${esc(r.o.paymentMethod)}</td><td class="num">${r.first ? Math.round(r.o.total * (1 - (RATE[r.o.paymentType] || .036))).toLocaleString() : ""}</td><td>${r.o.status === "paid" ? "決済完了" : "入金待ち"}</td><td>${FUL_LABEL[r.o.fulfillment || "ship"]}</td></tr>`).join("")}</tbody>
      </table></div>` : `<p class="empty">まだ注文がありません。商品をカートに入れて、デモの購入を最後まで進めてみてください。</p>`}
      <p class="small-note">※ コンビニ払いは、入金が確認された時点で記録されます（デモでは「入金待ち」として表示）。　<button class="ulink" id="reset">デモの注文データを消去</button></p>
    </div>`;
    document.getElementById("reset").onclick = () => { demoOrders = []; history = []; save("ito-demo-orders", []); save("ito-orders", []); viewSheet(); };
  }

  /* ---------- router ---------- */
  function route() {
    const h = location.hash.slice(1) || "shop";
    document.body.classList.remove("with-mbar");
    if (h.startsWith("item-")) viewItem(h.slice(5));
    else if (h === "cart") viewCart();
    else if (h === "checkout") viewCheckout();
    else if (h === "pay-demo" && DEMO) viewPayDemo();
    else if (h === "done") viewDone();
    else if (h === "mypage") viewMypage();
    else if (h === "tokushoho") viewTokushoho();
    else if (h === "privacy") viewPrivacy();
    else if (h === "guide") viewGuide();
    else if (h === "sheet" && DEMO) viewSheet();
    else { viewShop(h === "items"); return; }
    window.scrollTo(0, 0);
  }
  addEventListener("hashchange", route);
  badge();
  if (new URLSearchParams(location.search).get("session_id") && location.hash !== "#done") location.hash = "done";
  else route();
})();
