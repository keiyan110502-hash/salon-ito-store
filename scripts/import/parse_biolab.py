# BIOLAB 公式サイト（www.biolab.jp/products/<id>/）の HTML から商品データを抜き出す
import re, html, json, sys, glob, os

def lines_of(path):
    s = open(path, encoding='utf-8', errors='ignore').read()
    body = s[s.find('<main'):]
    body = body[:body.find('関連した商品')] if '関連した商品' in body else body
    body = re.sub(r'<script.*?</script>|<style.*?</style>', '', body, flags=re.S)
    body = re.sub(r'<img[^>]*src="([^"]+)"[^>]*>', r'\n[IMG \1]\n', body)
    body = re.sub(r'<br\s*/?>', '\n', body)
    txt = html.unescape(re.sub(r'<[^>]+>', '\n', body))
    return [l.strip() for l in txt.splitlines() if l.strip()]

def after(ls, key):
    return ls[ls.index(key) + 1] if key in ls else ''

def section(ls, start, ends):
    if start not in ls: return []
    i = ls.index(start) + 1; out = []
    while i < len(ls) and ls[i] not in ends:
        out.append(ls[i]); i += 1
    return out

def parse(path, pid):
    ls = lines_of(path)
    i = ls.index('PRODUCTS')
    name, cat = ls[i + 1], ls[i + 2]
    img = next((l[5:-1] for l in ls if l.startswith('[IMG') and '/wp-content/uploads/' in l and 'emblem' not in l), '')
    end = ls.index('内容量')
    idx = [k for k, l in enumerate(ls[:end]) if l.startswith('[IMG') and '/assets/img/products/icon-' in l]
    if idx:
        # 朝・夜アイコンの後ろ：肌悩みタグ → 本文
        block = [l for l in ls[idx[-1] + 1:end] if not l.startswith('[IMG')]
        tags = []
        while block and len(block[0]) <= 12 and not block[0].endswith('。'):
            tags.append(block.pop(0))
    else:
        # アイコンが無いページ：最初の長い文から本文。直前の短い行がタグ
        pre = [l for l in ls[i + 3:end] if not l.startswith('[IMG')]
        first = next(k for k, l in enumerate(pre) if len(l) > 25)
        tags, k = [], first - 1
        while k >= 0 and len(pre[k]) <= 12 and not pre[k].startswith(('■', '・')) and pre[k] != name:
            tags.insert(0, pre[k]); k -= 1
        block = pre[first:]
    how = [l for l in section(ls, 'ご使用方法', {'配合植物成分', '全成分'}) if not l.startswith('[IMG')]
    how = '\n'.join(how).replace('使用量の目安：\n', '使用量の目安：').replace('\n夜', '／夜')
    herbs = [l for l in section(ls, '配合植物成分', {'もっと見る >', '全成分'}) if not l.startswith('[IMG')]
    herb_names = [h for h in herbs if not h.startswith('（')]
    price = re.sub(r'[^0-9]', '', after(ls, '価格'))
    return {
        'id': f'bio-{pid}', 'brand': 'BIOLAB', 'line': '', 'category': cat, 'name': name,
        'volume': after(ls, '内容量'), 'price': int(price) if price else 0,
        'concerns': tags, 'description': '\n'.join(block), 'howTo': how,
        'herbs': herb_names, 'ingredients': '\n'.join(ls[ls.index('全成分') + 1:]) if '全成分' in ls else '',
        'quasiDrug': '医薬部外品' in ' '.join(block + [name]), 'imageUrl': img,
        'officialUrl': f'https://www.biolab.jp/products/{pid}/',
    }

if __name__ == '__main__':
    out = []
    for p in sys.argv[1:]:
        pid = os.path.basename(p)[:-5]
        try: out.append(parse(p, pid))
        except Exception as e: print('ERR', p, e, file=sys.stderr)
    print(json.dumps(out, ensure_ascii=False, indent=1))
