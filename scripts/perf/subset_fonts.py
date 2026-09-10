#!/usr/bin/env python3
"""NetCore Pro — webfont subsetting (F2 performance).

Produces:
  public/static/webfonts/fa-{solid-900,regular-400,brands-400}.sub.woff2
  public/static/fonts/vazirmatn/Vazirmatn-{W}.sub.woff2

Design notes
------------
* Vazirmatn subsets keep Latin-1 + Persian/Arabic + the punctuation/symbol
  blocks the UI actually renders, in ONE file per weight (one request instead
  of two), because a Persian storefront always paints both scripts.
* The ORIGINAL full fonts stay on disk untouched and are declared as a
  lower-priority @font-face with a `unicode-range` covering the plausible
  *unsubsetted* ranges, so nothing ever renders tofu.
* The typeface itself is unchanged — this is byte reduction only.
"""
import json, os, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WF = os.path.join(ROOT, 'public/static/webfonts')
VZ = os.path.join(ROOT, 'public/static/fonts/vazirmatn')
PERF = os.path.join(ROOT, 'scripts/perf')

# ---------------------------------------------------------------- FontAwesome
used = json.load(open(os.path.join(PERF, 'used_icons.json')))
cps = sorted({int(v.lstrip('\\'), 16) for v in used.values()})
fa_uni = ','.join('U+%04X' % c for c in cps)
print('FA icon codepoints:', len(cps))

FA_SOURCES = {
    'fa-solid-900': 'ttf',    # woff2 ok, ttf safest
    'fa-regular-400': 'ttf',  # shipped .woff2 is corrupt (bad glyf table)
    'fa-brands-400': 'ttf',
}
for name, ext in FA_SOURCES.items():
    src = os.path.join(WF, f'{name}.{ext}')
    out = os.path.join(WF, f'{name}.sub.woff2')
    subprocess.run(['pyftsubset', src, '--unicodes=' + fa_uni, '--flavor=woff2',
                    '--layout-features=', '--no-hinting', '--desubroutinize',
                    '--output-file=' + out], check=True)
    print(f'  {name}: {os.path.getsize(src)} -> {os.path.getsize(out)}')

open(os.path.join(PERF, 'fa_unicode_range.txt'), 'w').write(fa_uni)

# ----------------------------------------------------------------- Vazirmatn
# Latin basic/supplement + Persian & Arabic (incl. presentation forms) +
# general punctuation, arrows, currency, math-ops the UI uses.
VZ_RANGES = (
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,'
    'U+0300-036F,'                      # combining marks
    'U+0600-06FF,U+0750-077F,U+08A0-08FF,'   # Arabic + supplements
    'U+FB50-FDFF,U+FE70-FEFF,'          # Arabic presentation forms A/B
    'U+200C-200F,U+2000-206F,'          # ZWNJ/RTL marks + general punctuation
    'U+2070-209F,U+20A0-20CF,'          # super/subscript + currency (incl. Rial)
    'U+2122,U+2190-2199,U+21A9-21AA,'   # trademark + arrows
    'U+2212,U+2215,U+2264-2265,U+00D7,'  # math ops
    'U+2022,U+2026,U+25A0-25FF,U+2605-2606,U+2713-2714,'  # bullets/geo/stars/checks
    'U+FEFF,U+FFFD'
)
# Ranges intentionally NOT subsetted -> served by the original full font.
VZ_FALLBACK_RANGE = (
    'U+0100-017F,U+0180-024F,U+0250-02AF,U+0370-03FF,U+0400-04FF,U+0530-058F,'
    'U+0590-05FF,U+2100-214F,U+2150-218F,U+2200-22FF,U+2300-23FF,U+2460-24FF,'
    'U+2600-27BF,U+2900-297F,U+2B00-2BFF'
)

VZ_FEATURES = ('ccmp,liga,rlig,mark,mkmk,init,medi,fina,'
               'isol,locl,calt,kern,dnom,numr,frac')

WEIGHTS = ['Vazirmatn-Regular', 'Vazirmatn-Medium', 'Vazirmatn-Bold', 'Vazirmatn-ExtraBold']
for f in WEIGHTS:
    src = os.path.join(VZ, f + '.woff2')
    out = os.path.join(VZ, f + '.sub.woff2')
    subprocess.run(['pyftsubset', src, '--unicodes=' + VZ_RANGES, '--flavor=woff2',
                    '--layout-features=' + VZ_FEATURES,
                    '--no-hinting', '--output-file=' + out], check=True)
    print(f'  {f}: {os.path.getsize(src)} -> {os.path.getsize(out)}')

# ------------------------------------------------ Vazirmatn VARIABLE (wght)
# The four static weights above cost 4 requests / ~140 KB and still only
# approximate 500/600/900. The official variable font carries the whole
# 400-900 axis in ONE file; after axis-clamping + subsetting it is ~58 KB.
# Same typeface, same designer data — strictly fewer bytes and better
# fidelity. Emitted only when the variable master is present, so the build
# never breaks on a checkout that lacks it.
VAR_SRC = os.path.join(VZ, 'Vazirmatn-Variable.ttf')
VAR_OUT = os.path.join(VZ, 'Vazirmatn-var.sub.woff2')
if os.path.exists(VAR_SRC):
    tmp = os.path.join(VZ, '.vz-clamped.ttf')
    subprocess.run(['python3', '-m', 'fontTools.varLib.instancer', VAR_SRC,
                    'wght=400:900', '-o', tmp], check=True)
    subprocess.run(['pyftsubset', tmp, '--unicodes=' + VZ_RANGES, '--flavor=woff2',
                    '--layout-features=' + VZ_FEATURES,
                    '--no-hinting', '--output-file=' + VAR_OUT], check=True)
    os.remove(tmp)
    total_static = sum(os.path.getsize(os.path.join(VZ, w + '.sub.woff2')) for w in WEIGHTS)
    print(f'  Vazirmatn-var: {os.path.getsize(VAR_SRC)} -> {os.path.getsize(VAR_OUT)}'
          f'  (replaces {total_static} B / 4 requests)')
else:
    print('  Vazirmatn-Variable.ttf missing -> keeping 4 static weights')

json.dump({'vz_ranges': VZ_RANGES, 'vz_fallback_range': VZ_FALLBACK_RANGE,
           'fa_range': fa_uni},
          open(os.path.join(PERF, 'ranges.json'), 'w'), indent=1)
print('ranges.json written')
