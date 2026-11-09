# 公式サイトから取り込んだ JSON（BIOLAB / ADJUVANT）→ data/products.csv（管理スプレッドシートと同じ列）
#   python3 build_catalog.py bio.json adj_all.json data/products.csv
# 1サイズ＝1行（商品ID）。同じ商品のサイズ違いは「グループID」でまとめ、商品ページでサイズを選べるようにする。
import json, re, sys, csv, unicodedata

HEAD = ['商品ID', 'グループID', 'ブランド', 'シリーズ', 'カテゴリ', '商品名', '商品名（カナ）', '容量', '価格(税込)', '公開', '仮データ',
        '画像', 'ラベル', 'おすすめの肌悩み', '医薬部外品', '売り切れ', 'キャッチコピー', '商品説明', '使い方', '全成分', '公式URL', '画像の元URL']

def slug(s):
    s = unicodedata.normalize('NFKC', s).lower().replace('&', ' and ').replace('>>>', ' ').replace('+', ' plus ')
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s[:48] or 'item'

def tf(b): return 'TRUE' if b else 'FALSE'

rows, seen, used = [], set(), set()
bio = json.load(open(sys.argv[1]))
for p in bio:
    gid = p['id']
    desc = p['description']
    catch = desc.splitlines()[0] if desc else ''
    rest = '\n'.join(desc.splitlines()[1:])
    if p.get('herbs'):
        rest += ('\n\n' if rest else '') + '【配合植物成分】' + '、'.join(p['herbs'])
    rows.append([gid, gid, 'BIOLAB', 'フィトバイタルライン' if p['category'] not in ('エッセンシャルオイル', 'トライアルキット') else '', p['category'],
                 p['name'], '', p['volume'], p['price'], 'TRUE', 'FALSE', '', '', '、'.join(p['concerns']),
                 tf(p['quasiDrug'] or p['name'].startswith('薬用')), 'FALSE', catch, rest, p['howTo'], p['ingredients'],
                 p['officialUrl'], p['imageUrl']])

SERIES = {'ae_rich': 'AE Rich', 'all_enrich': 'All Enrich', 'basic': 'BASIC', 'body_care': 'BODY CARE', 'clear_gel': 'CLEAR GEL',
          'diamond_j': 'DIAMOND J', 'hair_deco': 'HAIR DECO', 'hand-cream-neco': 'HAND CREAM Neco', 'inchloss': 'INCHLOSS',
          'kasui': 'KASUI', 'melect': 'MELECT', 'muts-hairtouch': 'muts', 'nicowa': 'nicowa', 'nyu-by-adjuvant': 'nyu',
          'other': 'その他', 'polish': 'Polish', 'prinshell': 'PRINSHELL', 'q_and_n': 'Q&N for Homme', 'rafuna': 'rafuna',
          're': 'Re:>>> & Class S', 'touqu-to-tone': 'TOUQU to tone', 'balinese_oil': 'Balinese Oil', 'beauty_lusso2': 'Beauty Lusso'}
adj = json.load(open(sys.argv[2]))
for p in adj:
    if not p['variants'] or p['brandPage'] not in SERIES: continue
    title = re.sub(r'\s+', ' ', p['title']).strip()
    if title in seen: continue          # 複数ブランドページに載っている共通品（ブラシ・カートリッジ）
    seen.add(title)
    gid = 'adj-' + slug(title)
    if gid in used:  # 日本語名などで重なる場合は連番を付ける
        gid = f"{gid}-{len(used) + 1}"
    used.add(gid)
    feat = p['feature'].splitlines()
    catch, rest = (feat[0], '\n'.join(feat[1:])) if feat else ('', '')
    extra = '\n'.join(f'【{k}】{v}' for k, v in p['extra'].items() if v)
    notes = '\n'.join(p['priceNotes'])
    desc = '\n\n'.join(x for x in [rest, extra, notes] if x)
    how = p['howTo'] + (f"\n【ご使用の目安】{p['amount']}" if p['amount'] else '')
    cat = p['category'].split('/')[0].strip()
    # カナ名に付いている販売状況の注記を、ラベル・売り切れに振り分ける
    kana = p['kana'].replace('\n', ' ')
    status = ' '.join(re.findall(r'[［【\[](.*?)[］】\]]', kana))
    kana = re.sub(r'\s*[［【\[].*?[］】\]]\s*', '', kana).strip()
    ended = 'メーカー在庫終了' in status or '販売終了' in status
    label = '在庫限り' if ('次第終了' in status and not ended) else ''
    quasi = '医薬部外品' in p['category']
    for k, v in enumerate(p['variants']):
        vol = re.sub(r'\s*各\s*$', '', re.sub(r'\s+', ' ', v['volume'])).strip(' /')
        rows.append([f'{gid}-{k + 1}' if len(p['variants']) > 1 else gid, gid, 'ADJUVANT', SERIES[p['brandPage']], cat,
                     title, kana, vol, v['price'], tf(not ended), 'FALSE', '', label, '', tf(quasi), tf(ended),
                     catch, desc, how.strip(), p['ingredients'], p['officialUrl'], p['imageUrl']])

import os
for r in rows:  # 取り込んだ写真（public/images/products/<グループID>.jpg）を画像列に入れる
    if os.path.exists(f'public/images/products/{r[1]}.jpg'): r[11] = f'images/products/{r[1]}.jpg'
ids = [r[0] for r in rows]
assert len(ids) == len(set(ids)), [i for i in ids if ids.count(i) > 1]
with open(sys.argv[3], 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(HEAD); w.writerows(rows)
print(len(rows), 'rows,', len(set(r[1] for r in rows)), 'products')
