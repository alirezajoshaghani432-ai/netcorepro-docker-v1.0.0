#!/usr/bin/env python3
"""F2f — migrate <img> call sites to the responsive helper (idempotent)."""
import io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PAGES = os.path.join(ROOT, 'dist', 'views', 'site', 'pages.js')
LAYOUT = os.path.join(ROOT, 'dist', 'views', 'shared', 'layout.js')

def read(p):
    with io.open(p, encoding='utf-8') as f: return f.read()

def write(p, s):
    with io.open(p, 'w', encoding='utf-8') as f: f.write(s)

changed = []

def sub(src, old, new, label, required=True):
    """Exact single replacement, skipped when already applied."""
    global changed
    if new in src and old not in src:
        print('  = %-28s already applied' % label); return src
    n = src.count(old)
    if n == 0:
        if required: raise SystemExit('!! anchor NOT FOUND: %s' % label)
        print('  ~ %-28s anchor absent (skipped)' % label); return src
    if n != 1:
        raise SystemExit('!! anchor ambiguous (%d): %s' % (n, label))
    changed.append(label)
    print('  + %-28s patched' % label)
    return src.replace(old, new, 1)

# ---------------------------------------------------------------- pages.js
s = read(PAGES)

# 1) import + shared `sizes` presets
s = sub(s,
    "import { getChannels, primaryChannel } from '../../utils/contact.js';",
    "import { getChannels, primaryChannel } from '../../utils/contact.js';\n"
    "import { ncImg, imgPreload, bestUrl } from '../../utils/img.js';\n"
    "// F2f — `sizes` presets: tell the browser the real rendered width so it\n"
    "// never downloads a 1600px file for a 160px card.\n"
    "const SZ_PROD = '(max-width:520px) 150px, (max-width:980px) 200px, 240px';\n"
    "const SZ_HERO = '(max-width:980px) 100vw, 66vw';\n"
    "const SZ_PDP  = '(max-width:700px) 92vw, 308px';",
    'import img helper')

# 2) product card
s = sub(s,
    '      <img loading="lazy" decoding="async" src="${esc(p.image || \'/static/images/p1.svg\')}" alt="${esc(p.name)}">',
    "      ${ncImg(p.image || '/static/images/p1.svg', { alt: p.name, sizes: SZ_PROD, ratio: false })}",
    'product card img')

# 3) hero slider -> real <img> (LCP element; a CSS background can never be
#    preloaded, srcset-ed or prioritised, which is why LCP was 6.2s)
s = sub(s,
    """            <div class="nc-slide${i === 0 ? ' active' : ''}" style="background-image:url('${esc(s.img)}')">
              <div class="nc-slide-overlay"></div>""",
    """            <div class="nc-slide${i === 0 ? ' active' : ''}">
              ${ncImg(s.img, { cls: 'nc-slide-bg', alt: s.title || '', sizes: SZ_HERO, lcp: i === 0, loading: i === 0 ? 'eager' : 'lazy', ratio: false })}
              <div class="nc-slide-overlay"></div>""",
    'hero slide -> <img>')

# 4) side banners (CSS background: at least serve a right-sized WebP)
s = sub(s,
    """${s.img ? ` style="background-image:linear-gradient(135deg,rgba(29,110,245,.78),rgba(44,26,138,.82)),url('${esc(s.img)}')"` : ''}""",
    """${s.img ? ` style="background-image:linear-gradient(135deg,rgba(29,110,245,.78),rgba(44,26,138,.82)),url('${esc(bestUrl(s.img, 640))}')"` : ''}""",
    'side banner bg')

# 5) mid banners
s = sub(s,
    """${m.img ? ` style="background-image:linear-gradient(120deg,rgba(58,42,158,.78),rgba(29,110,245,.80)),url('${esc(m.img)}')"` : ''}""",
    """${m.img ? ` style="background-image:linear-gradient(120deg,rgba(58,42,158,.78),rgba(29,110,245,.80)),url('${esc(bestUrl(m.img, 960))}')"` : ''}""",
    'mid banner bg')

# 6) category circle icon
s = sub(s,
    """`<img src="${esc(c.image)}" alt="${esc(c.name)}" class="nc-cat-img" loading="lazy">`""",
    """ncImg(c.image, { alt: c.name, cls: 'nc-cat-img', sizes: '54px', ratio: false })""",
    'category icon img')

# 7) brand marquee logo
s = sub(s,
    """${b.logo ? `<img loading="lazy" decoding="async" src="${esc(b.logo)}" alt="${esc(b.name)}">` : `<span class="nc-brand-name">${esc(b.name)}</span>`}""",
    """${b.logo ? ncImg(b.logo, { alt: b.name, sizes: '178px', ratio: false }) : `<span class="nc-brand-name">${esc(b.name)}</span>`}""",
    'brand marquee logo')

# 8) PDP brand logo
s = sub(s,
    """<img loading="lazy" src="${esc(p.brand_logo)}" alt="${esc(p.brand_name || '')}"></a>""",
    """${ncImg(p.brand_logo, { alt: p.brand_name || '', sizes: '82px', ratio: false })}</a>""",
    'pdp brand logo')

# 9) PDP main image (LCP of the product page)
s = sub(s,
    """          <img id="pdp-main-img" decoding="async" src="${esc(allImages[0])}" alt="${esc(p.name)}">""",
    """          ${ncImg(allImages[0], { id: 'pdp-main-img', alt: p.name, sizes: SZ_PDP, lcp: true, ratio: false })}""",
    'pdp main img')

# 10) PDP thumbnails
s = sub(s,
    """<button class="nc-pdp-thumb${i === 0 ? ' active' : ''}" data-src="${esc(g)}" aria-label="تصویر ${i + 1}"><img loading="lazy" src="${esc(g)}" alt=""></button>""",
    """<button class="nc-pdp-thumb${i === 0 ? ' active' : ''}" data-src="${esc(g)}" aria-label="تصویر ${i + 1}">${ncImg(g, { alt: '', sizes: '58px', ratio: false })}</button>""",
    'pdp thumbs')

# 11) thumb click must clear srcset, otherwise the responsive candidate wins
#     over the newly-assigned .src and the picture never changes.
s = sub(s,
    """          document.getElementById('pdp-main-img').src = t.dataset.src;""",
    """          var __m = document.getElementById('pdp-main-img');
          __m.removeAttribute('srcset'); __m.removeAttribute('sizes');
          __m.src = t.dataset.src;""",
    'pdp thumb srcset reset')

# 12) PDP promo banner
s = sub(s,
    """            <img loading="lazy" src="${esc(promoBanner.image)}" alt="${esc(promoBanner.title)}">""",
    """            ${ncImg(promoBanner.image, { alt: promoBanner.title, sizes: SZ_PDP, ratio: false })}""",
    'pdp promo banner')

# 13) preload the home hero (LCP) + the PDP main image
s = sub(s,
    """    return siteLayout({ title: 'صفحه اصلی', currentPath: '/' }, content);""",
    """    return siteLayout({\n"""
    """        title: 'صفحه اصلی', currentPath: '/',\n"""
    """        // F2f: start the LCP download during HTML parsing, not after CSS/JS.\n"""
    """        extraHead: slides.length ? imgPreload(slides[0].img, SZ_HERO) : ''\n"""
    """    }, content);""",
    'home LCP preload')

write(PAGES, s)

# ---------------------------------------------------------------- layout.js
t = read(LAYOUT)
t = sub(t,
    "import { escapeHtml, escapeAttr }",
    "import { ncImg } from '../../utils/img.js';\nimport { escapeHtml, escapeAttr }",
    'layout import', required=False)
if "import { ncImg }" not in t:
    # fall back: insert after the first import line
    first_nl = t.index('\n', t.index('import ')) + 1
    t = t[:first_nl] + "import { ncImg } from '../../utils/img.js';\n" + t[first_nl:]
    changed.append('layout import (fallback)')
    print('  + %-28s patched (fallback)' % 'layout import')

t = sub(t,
    """<img src="${escapeAttr(settings.site_logo)}" alt="${escapeAttr(siteName)}" class="nc-logo-img">""",
    """${ncImg(settings.site_logo, { alt: siteName, cls: 'nc-logo-img', sizes: '170px', ratio: false, loading: 'eager', fetchpriority: 'high' })}""",
    'header logo')

t = sub(t,
    """<img loading="lazy" src="${escapeAttr(b.logo)}" alt="${escapeAttr(b.name)}">""",
    """${ncImg(b.logo, { alt: b.name, sizes: '120px', ratio: false })}""",
    'megamenu brand logo')

write(LAYOUT, t)

print('\n%d edit(s) applied' % len(changed))
