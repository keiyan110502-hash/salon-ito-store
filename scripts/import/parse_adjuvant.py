# ADJUVANT 公式サイト（www.adjuvant.co.jp/brandlist/<brand>/）の「LINE UP」から商品データを抜き出す
import re, html, json, sys, os

def clean(x):
    x = re.sub(r'<br\s*/?>', '\n', x)
    x = html.unescape(re.sub(r'<[^>]+>', '', x))
    return '\n'.join(l.strip() for l in x.splitlines() if l.strip())

def parse_page(path, slug):
    s = open(path, encoding='utf-8', errors='ignore').read()
    out = []
    for blk in s.split('<div class="modalContent">')[1:]:
        g = lambda pat: (re.search(pat, blk, re.S) or [None, ''])[1]
        img = g(r'class="modalPhoto"><img src="([^"]+)"')
        brand = clean(g(r'class="modalBrand">(.*?)</p>'))
        title = clean(g(r'class="modalTitle">(.*?)</p>'))
        kana = clean(g(r'class="modalTitleJp">(.*?)</p>'))
        cat = clean(g(r'class="modalBunrui">(.*?)</div>')).strip('[]［］')
        cap = clean(g(r'class="modalCapPrice">(.*?)</div>'))
        dls = dict((clean(dt), clean(dd)) for dt, dd in re.findall(r'<dt>(.*?)</dt>\s*<dd>(.*?)</dd>', blk, re.S))
        variants, notes = [], []
        for line in cap.splitlines():
            line = line.strip().rstrip('/').strip()
            if '業務用' in line or 'サロン専用' in line or 'メーカー在庫終了' in line: continue
            m = re.match(r'(.*?)[\s/]*[¥￥]\s*各?\s*([0-9][0-9,]*)\s*[-ー－]?\s*(?:（税込）|\(税込\))?\s*$', line) \
                or re.match(r'(.*?)\s*([0-9][0-9,]*)\s*[¥￥]\s*[-ー－]?\s*$', line)
            if m:
                label = re.sub(r'[\s/]+$', '', m.group(1)).strip()
                variants.append({'volume': label, 'price': int(m.group(2).replace(',', ''))})
            elif line.startswith(('※', '＊', '*')):
                notes.append(line)
            elif variants and not re.search(r'[¥￥]', line):
                notes.append(line)
        out.append({'brandPage': slug, 'series': brand, 'title': title, 'kana': kana, 'category': cat,
                    'variants': variants, 'priceNotes': notes, 'capRaw': cap,
                    'feature': dls.get('商品特徴', ''), 'howTo': dls.get('使用方法', ''),
                    'amount': dls.get('ご使用の目安', ''), 'ingredients': dls.get('成分表示', dls.get('全成分', '')),
                    'extra': {k: v for k, v in dls.items() if k not in ('商品特徴', '使用方法', 'ご使用の目安', '成分表示', '全成分')},
                    'imageUrl': img, 'officialUrl': f'https://www.adjuvant.co.jp/brandlist/{slug}/'})
    return out

if __name__ == '__main__':
    allp = []
    for p in sys.argv[1:]:
        allp += parse_page(p, os.path.basename(p)[:-5])
    print(json.dumps(allp, ensure_ascii=False, indent=1))
