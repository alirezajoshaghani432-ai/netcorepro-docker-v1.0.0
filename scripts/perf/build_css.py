#!/usr/bin/env python3
"""NetCore Pro — storefront CSS bundler (F2 performance).

Emits ONE render-blocking stylesheet:  public/static/css/nc-site.min.css
      = fonts(@font-face)  +  FontAwesome subset  +  purged Tailwind  +  app.css

The legacy files (vazirmatn.css / fontawesome.min.css / tailwind.min.css /
app.css) stay untouched because /admin/* still links them.

Run:  python3 scripts/perf/build_css.py
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CSS = os.path.join(ROOT, 'public/static/css')
PERF = os.path.join(ROOT, 'scripts/perf')
R = json.load(open(os.path.join(PERF, 'ranges.json')))
USED = json.load(open(os.path.join(PERF, 'used_icons.json')))
USED_NAMES = set(USED.keys())


# ───────────────────────────────────────────────────────── helpers
def split_rules(css):
    """Yield top-level chunks (rules / at-rules) of a stylesheet."""
    out, depth, buf, i, n = [], 0, [], 0, len(css)
    while i < n:
        ch = css[i]
        if ch in '"\'':
            q = ch
            buf.append(ch)
            i += 1
            while i < n:
                buf.append(css[i])
                if css[i] == '\\':
                    i += 1
                    if i < n:
                        buf.append(css[i])
                elif css[i] == q:
                    i += 1
                    break
                i += 1
            continue
        if css.startswith('/*', i):
            j = css.find('*/', i + 2)
            i = (j + 2) if j != -1 else n
            continue
        buf.append(ch)
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                out.append(''.join(buf).strip())
                buf = []
        elif ch == ';' and depth == 0:
            out.append(''.join(buf).strip())
            buf = []
        i += 1
    tail = ''.join(buf).strip()
    if tail:
        out.append(tail)
    return out


def minify(css):
    """Whitespace/comment minifier that is safe for strings, data-URIs and
    math functions (inside `calc()` the spaces around +/- are significant)."""
    out, i, n, paren = [], 0, len(css), 0
    while i < n:
        ch = css[i]
        if ch in '"\'':
            q = ch
            out.append(ch)
            i += 1
            while i < n:
                out.append(css[i])
                if css[i] == '\\':
                    i += 1
                    if i < n:
                        out.append(css[i])
                elif css[i] == q:
                    i += 1
                    break
                i += 1
            continue
        if css.startswith('/*', i):
            j = css.find('*/', i + 2)
            i = (j + 2) if j != -1 else n
            continue
        if ch in ' \t\r\n':
            j = i
            while j < n and css[j] in ' \t\r\n':
                j += 1
            prev = out[-1] if out else ''
            nxt = css[j] if j < n else ''
            if prev and nxt:
                if paren > 0:
                    # inside (...) only drop space next to a delimiter
                    if prev not in '(,' and nxt not in '),':
                        out.append(' ')
                elif prev not in '{};:,>~+(' and nxt not in '{};:,>~+)!':
                    out.append(' ')
            i = j
            continue
        if ch == '(':
            paren += 1
        elif ch == ')':
            paren = max(0, paren - 1)
        out.append(ch)
        i += 1
    s = ''.join(out)
    s = re.sub(r';\s*}', '}', s)
    return s.strip()


# ─────────────────────────────────────────────── 1. Vazirmatn @font-face
FACES = [
    ('Vazirmatn-Regular', '100 400'),
    ('Vazirmatn-Medium', '500 600'),
    ('Vazirmatn-Bold', '700'),
    ('Vazirmatn-ExtraBold', '800 900'),
]


VAR_FILE = os.path.join(ROOT, 'public/static/fonts/vazirmatn/Vazirmatn-var.sub.woff2')


def build_fonts_css(v):
    out = ["/* Vazirmatn — same typeface, subsetted. Full file kept as an\n"
           "   out-of-range fallback so nothing can ever render as tofu. */"]

    # Preferred path: ONE variable file for the whole 400-900 axis.
    if os.path.exists(VAR_FILE):
        # full static files still cover the un-subsetted ranges (tofu guard)
        for name, weight in FACES:
            out.append(
                "@font-face{font-family:'Vazirmatn';font-style:normal;font-weight:%s;"
                "font-display:swap;src:url('/static/fonts/vazirmatn/%s.woff2?v=%s') format('woff2');"
                "unicode-range:%s}" % (weight, name, v, R['vz_fallback_range']))
        out.append(
            "@font-face{font-family:'Vazirmatn';font-style:normal;font-weight:400 900;"
            "font-display:swap;"
            "src:url('/static/fonts/vazirmatn/Vazirmatn-var.sub.woff2?v=%s') format('woff2-variations'),"
            "url('/static/fonts/vazirmatn/Vazirmatn-var.sub.woff2?v=%s') format('woff2');"
            "unicode-range:%s}" % (v, v, R['vz_ranges']))
        return '\n'.join(out)

    for name, weight in FACES:
        # 1) full font, restricted to ranges we did NOT subset (rarely fetched)
        out.append(
            "@font-face{font-family:'Vazirmatn';font-style:normal;font-weight:%s;"
            "font-display:swap;src:url('/static/fonts/vazirmatn/%s.woff2?v=%s') format('woff2');"
            "unicode-range:%s}" % (weight, name, v, R['vz_fallback_range']))
        # 2) subset — declared last so it wins for every glyph the site uses
        out.append(
            "@font-face{font-family:'Vazirmatn';font-style:normal;font-weight:%s;"
            "font-display:swap;src:url('/static/fonts/vazirmatn/%s.sub.woff2?v=%s') format('woff2');"
            "unicode-range:%s}" % (weight, name, v, R['vz_ranges']))
    return '\n'.join(out)


# ────────────────────────────────────────── 2. FontAwesome subset stylesheet
ICON_RULE = re.compile(r'^\.fa-([a-z0-9-]+)::?before$')


def build_fa_css(v):
    src = open(os.path.join(CSS, 'fontawesome.min.css'), encoding='utf-8').read()
    kept, dropped = [], 0
    for rule in split_rules(src):
        if rule.startswith('@font-face'):
            continue                       # we emit our own
        if rule.startswith('@'):
            kept.append(rule)
            continue
        sel = rule.split('{', 1)[0].strip()
        parts = [p.strip() for p in sel.split(',') if p.strip()]
        icon_sels = [ICON_RULE.match(p) for p in parts]
        if parts and all(icon_sels):
            names = {m.group(1) for m in icon_sels}
            if not (names & USED_NAMES):
                dropped += 1
                continue
        kept.append(rule)
    faces = []
    for fam, fname, weight in [
        ('Font Awesome 6 Free', 'fa-solid-900', '900'),
        ('Font Awesome 6 Free', 'fa-regular-400', '400'),
        ('Font Awesome 6 Brands', 'fa-brands-400', '400'),
    ]:
        faces.append(
            "@font-face{font-family:'%s';font-style:normal;font-weight:%s;font-display:swap;"
            "src:url('/static/webfonts/%s.woff2?v=%s') format('woff2')}" % (fam, weight, fname, v))
        faces.append(
            "@font-face{font-family:'%s';font-style:normal;font-weight:%s;font-display:swap;"
            "src:url('/static/webfonts/%s.sub.woff2?v=%s') format('woff2');unicode-range:%s}"
            % (fam, weight, fname, v, R['fa_range']))
    print(f'  FontAwesome: dropped {dropped} unused icon rules, kept {len(kept)}')
    return '/* FontAwesome 6.4 Free — subset build */\n' + '\n'.join(faces + kept)


# ───────────────────────────────────────────── 3. Tailwind (storefront scope)
def build_tailwind():
    out = '/tmp/nc-tw-site.css'
    subprocess.run(['npx', 'tailwindcss', '-c', 'scripts/perf/tailwind.site.cjs',
                    '-i', 'tailwind.input.css', '-o', out, '--minify'],
                   cwd=ROOT, check=True, capture_output=True)
    return open(out, encoding='utf-8').read()


# ─────────────────────────────────────────────────────────────── main
def main():
    v = sys.argv[1] if len(sys.argv) > 1 else 'dev'
    fonts = build_fonts_css(v)
    fa = build_fa_css(v)
    tw = build_tailwind()
    app = open(os.path.join(CSS, 'app.css'), encoding='utf-8').read()

    bundle = minify('\n'.join([fonts, fa, tw, app]))
    dest = os.path.join(CSS, 'nc-site.min.css')
    open(dest, 'w', encoding='utf-8').write(bundle)

    before = sum(os.path.getsize(os.path.join(CSS, f)) for f in
                 ['vazirmatn.css', 'fontawesome.min.css', 'tailwind.min.css', 'app.css'])
    print(f'\n  legacy 4 files : {before:,} B')
    print(f'  nc-site.min.css: {len(bundle.encode()):,} B  '
          f'({100 - len(bundle.encode()) * 100 // before}% smaller)')
    import gzip
    print(f'  gzipped        : {len(gzip.compress(bundle.encode(), 9)):,} B')


if __name__ == '__main__':
    main()
