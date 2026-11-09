# 公式サイトと商品データを照らし合わせて更新する（2週間〜1か月に1回の定期作業用）
#   python3 -I scripts/import/sync_catalog.py            … data/products.csv を更新し、報告書を docs/catalog-updates/ に書き出す
#   python3 -I scripts/import/sync_catalog.py --dry-run  … 変更点の報告だけ（ファイルは変えない）
# ルール
#   ・公式サイトにある商品：価格・名前・容量・説明・使い方・成分・写真の元URLを最新に。「公開」「ラベル」はサロンの設定を残す
#   ・新しく見つかった商品：追加（公開＝オン、ラベル＝NEW）。写真もダウンロード
#   ・公式サイトから消えた／メーカー在庫終了の商品：公開をオフ（行は残す）
#   ・公式URLが空の行（サロンが手で追加した商品）は触らない
import csv, datetime, io, json, os, re, ssl, subprocess, sys, tempfile, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import parse_biolab, parse_adjuvant  # noqa: E402

DRY = '--dry-run' in sys.argv
CTX = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE') or (('/root/.ccr/ca-bundle.crt') if os.path.exists('/root/.ccr/ca-bundle.crt') else None))
UA = {'User-Agent': 'salon-ito-catalog-sync/1.0'}

def fetch(url):
    req = urllib.request.Request(urllib.parse.quote(url, safe=':/%?=&'), headers=UA)
    return urllib.request.urlopen(req, timeout=60, context=CTX).read()

def save(tmp, name, url):
    path = os.path.join(tmp, name)
    with open(path, 'wb') as f: f.write(fetch(url))
    return path

def main():
    tmp = tempfile.mkdtemp(prefix='catalog-')
    # ---- BIOLAB：一覧ページ（2ページ目以降も）から商品IDを集める
    ids, page = [], 1
    while True:
        url = 'https://www.biolab.jp/products/' + (f'page/{page}/' if page > 1 else '')
        try: html = fetch(url).decode('utf-8', 'ignore')
        except Exception: break
        found = re.findall(r'https://www\.biolab\.jp/products/(\d+)/', html)
        new = [i for i in dict.fromkeys(found) if i not in ids]
        if not new: break
        ids += new; page += 1
    bio = []
    for i in ids:
        bio.append(parse_biolab.parse(save(tmp, f'bio-{i}.html', f'https://www.biolab.jp/products/{i}/'), i))
    # ---- ADJUVANT：ブランド一覧からブランドページを集める
    html = fetch('https://www.adjuvant.co.jp/brandlist/').decode('utf-8', 'ignore')
    slugs = sorted(set(re.findall(r'/brandlist/([a-z0-9_\-]+)/', html)) - {'feed'})
    adj = []
    for sl in slugs:
        try: adj += parse_adjuvant.parse_page(save(tmp, f'{sl}.html', f'https://www.adjuvant.co.jp/brandlist/{sl}/'), sl)
        except Exception as e: print('skip', sl, e)
    os.makedirs(os.path.join(ROOT, 'data/source'), exist_ok=True)
    bj, aj = os.path.join(tmp, 'biolab.json'), os.path.join(tmp, 'adjuvant.json')
    json.dump(bio, open(bj, 'w'), ensure_ascii=False, indent=1)
    json.dump(adj, open(aj, 'w'), ensure_ascii=False, indent=1)
    if len(bio) < 5 or len(adj) < 30:
        sys.exit(f'公式サイトの読み取り件数が少なすぎます（BIOLAB {len(bio)}件 / ADJUVANT {len(adj)}件）。サイトの構造が変わった可能性があるため、更新を中止しました。')

    # ---- 公式サイトの最新状態で一時 CSV を作る
    fresh_csv = os.path.join(tmp, 'fresh.csv')
    subprocess.run([sys.executable, '-I', os.path.join(HERE, 'build_catalog.py'), bj, aj, fresh_csv], check=True, cwd=ROOT)
    fresh = {r['商品ID']: r for r in csv.DictReader(open(fresh_csv, encoding='utf-8'))}
    cur_path = os.path.join(ROOT, 'data/products.csv')
    cur_rows = list(csv.DictReader(open(cur_path, encoding='utf-8')))
    head = list(fresh[next(iter(fresh))].keys())

    SYNC = ['ブランド', 'シリーズ', 'カテゴリ', '商品名', '商品名（カナ）', '容量', '価格(税込)', 'おすすめの肌悩み', '医薬部外品', '売り切れ',
            'キャッチコピー', '商品説明', '使い方', '全成分', '公式URL', '画像の元URL', 'グループID']
    added, hidden, price, renamed, ended = [], [], [], [], []
    out, seen = [], set()
    for r in cur_rows:
        pid = r['商品ID']; seen.add(pid)
        if not r.get('公式URL'):           # 手で追加した商品
            out.append(r); continue
        f = fresh.get(pid)
        if not f:
            if r['公開'] == 'TRUE': hidden.append(r)
            r['公開'] = 'FALSE'; out.append(r); continue
        if r['価格(税込)'] != f['価格(税込)']: price.append((r, r['価格(税込)'], f['価格(税込)']))
        if r['商品名'] != f['商品名'] or r['容量'] != f['容量']: renamed.append((r['商品名'] + ' ' + r['容量'], f['商品名'] + ' ' + f['容量']))
        if f['公開'] == 'FALSE' and r['公開'] == 'TRUE': ended.append(r); r['公開'] = 'FALSE'
        for k in SYNC: r[k] = f[k]
        if f['ラベル'] and not r['ラベル']: r['ラベル'] = f['ラベル']
        out.append(r)
    for pid, f in fresh.items():
        if pid in seen: continue
        if f['公開'] == 'TRUE':
            f['ラベル'] = f['ラベル'] or 'NEW'
            added.append(f)
        out.append(f)

    # ---- 新しい商品・写真が変わった商品の画像をダウンロード
    from PIL import Image
    need = {}
    for r in out:
        if r.get('画像の元URL') and r['公式URL']:
            p = os.path.join(ROOT, 'public/images/products', r['グループID'] + '.jpg')
            if not os.path.exists(p): need[r['グループID']] = r['画像の元URL']
    if not DRY:
        for gid, url in need.items():
            try:
                im = Image.open(io.BytesIO(fetch(url))).convert('RGBA')
                base = Image.new('RGBA', im.size, (245, 244, 242, 255)); base.alpha_composite(im); im = base.convert('RGB')
                w, h = im.size; side = max(w, h); c = Image.new('RGB', (side, side), im.getpixel((2, 2)))
                c.paste(im, ((side - w) // 2, (side - h) // 2)); c.resize((720, 720), Image.LANCZOS).save(
                    os.path.join(ROOT, 'public/images/products', gid + '.jpg'), 'JPEG', quality=82, optimize=True, progressive=True)
            except Exception as e:
                print('画像を取得できませんでした', gid, e)
        for r in out:
            if os.path.exists(os.path.join(ROOT, 'public/images/products', r['グループID'] + '.jpg')):
                r['画像'] = f"images/products/{r['グループID']}.jpg"

    # ---- 報告書
    today = datetime.date.today().isoformat()
    L = [f'# 商品データの定期更新 {today}', '',
         f'公式サイトの読み取り：BIOLAB {len(bio)}商品 / ADJUVANT {len(adj)}商品（業務用を含む）', '',
         f'| 変更 | 件数 |', '| --- | --- |',
         f'| 新しく追加（公開・NEW ラベル） | {len(added)} |', f'| 価格の変更 | {len(price)} |',
         f'| 名前・容量の変更 | {len(renamed)} |', f'| メーカー在庫終了で非公開 | {len(ended)} |',
         f'| 公式サイトから消えたため非公開 | {len(hidden)} |', '']
    if added: L += ['## 追加した商品', ''] + [f"- {r['ブランド']}｜{r['商品名']} {r['容量']}｜¥{int(r['価格(税込)']):,}" for r in added] + ['']
    if price: L += ['## 価格の変更', ''] + [f"- {r['商品名']} {r['容量']}：¥{int(a):,} → ¥{int(b):,}" for r, a, b in price] + ['']
    if renamed: L += ['## 名前・容量の変更', ''] + [f'- {a} → {b}' for a, b in renamed] + ['']
    if ended: L += ['## メーカー在庫終了のため非公開にした商品', ''] + [f"- {r['商品名']} {r['容量']}" for r in ended] + ['']
    if hidden: L += ['## 公式サイトに見当たらないため非公開にした商品', ''] + [f"- {r['商品名']} {r['容量']}" for r in hidden] + ['']
    if not (added or price or renamed or ended or hidden): L += ['変更はありませんでした。', '']
    report = '\n'.join(L)
    print(report)
    if DRY: return
    with open(cur_path, 'w', newline='', encoding='utf-8') as fp:
        w = csv.DictWriter(fp, fieldnames=head); w.writeheader(); w.writerows({k: r.get(k, '') for k in head} for r in out)
    os.replace(bj, os.path.join(ROOT, 'data/source/biolab.json')); os.replace(aj, os.path.join(ROOT, 'data/source/adjuvant.json'))
    os.makedirs(os.path.join(ROOT, 'docs/catalog-updates'), exist_ok=True)
    open(os.path.join(ROOT, f'docs/catalog-updates/{today}.md'), 'w').write(report)
    subprocess.run(['node', 'scripts/csv-to-json.mjs'], check=True, cwd=ROOT)

if __name__ == '__main__':
    main()
