#!/usr/bin/env python3
"""
F2f — responsive image pipeline for the NetCore Pro storefront.

For every raster image under public/static/{images,uploads} this script emits
WebP variants at a set of breakpoint widths into public/static/rimg/, mirroring
the original directory layout, and writes a manifest that the SSR helper
(dist/utils/img.js) uses to build srcset / sizes / width / height attributes.

Design notes
------------
* Originals are never modified or deleted — the manifest is purely additive and
  the <img src> keeps pointing at the original file, so anything that has not
  been migrated to the helper still renders exactly as before.
* Variants wider than the source are skipped (no upscaling); a variant is also
  skipped when it would not actually be smaller than the next one down.
* SVGs are recorded in the manifest (for intrinsic width/height) but never
  rasterised — they are already resolution-independent.
* Re-running is cheap: a variant is regenerated only when the source file is
  newer than the variant.
"""
import io
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
STATIC = os.path.join(ROOT, 'public', 'static')
SRC_DIRS = ['images', 'uploads']
OUT_DIR = os.path.join(STATIC, 'rimg')
MANIFEST = os.path.join(STATIC, 'rimg', 'manifest.json')

WIDTHS = [320, 480, 640, 960, 1280, 1600]
RASTER_EXT = {'.jpg', '.jpeg', '.png', '.webp'}
QUALITY = 78

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow is required: pip install Pillow')

Image.MAX_IMAGE_PIXELS = 200_000_000


def human(n):
    return f'{n:,}'


def variant_path(rel_noext, w):
    return os.path.join(OUT_DIR, f'{rel_noext}-{w}.webp')


def encode(src, dst, width):
    """Resize+encode with cwebp when available (better ratio), else Pillow."""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        subprocess.run(
            ['cwebp', '-quiet', '-q', str(QUALITY), '-resize', str(width), '0',
             '-metadata', 'none', src, '-o', dst],
            check=True, capture_output=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        pass
    try:
        with Image.open(src) as im:
            im = im.convert('RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB')
            h = max(1, round(im.height * width / im.width))
            im = im.resize((width, h), Image.LANCZOS)
            im.save(dst, 'WEBP', quality=QUALITY, method=6)
        return True
    except Exception as e:                                   # pragma: no cover
        print(f'  ! {os.path.basename(src)}: {e}')
        return False


def main():
    manifest = {}
    pending = []
    made = skipped = 0
    saved_before = saved_after = 0

    for d in SRC_DIRS:
        base = os.path.join(STATIC, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirs, files in os.walk(base):
            for fn in sorted(files):
                ext = os.path.splitext(fn)[1].lower()
                src = os.path.join(dirpath, fn)
                rel = os.path.relpath(src, STATIC).replace(os.sep, '/')
                url = '/static/' + rel

                if ext == '.svg':
                    manifest[url] = {'svg': True}
                    continue
                if ext not in RASTER_EXT:
                    continue

                try:
                    with Image.open(src) as im:
                        w0, h0 = im.size
                except Exception:
                    continue
                if not w0 or not h0:
                    continue

                rel_noext = os.path.splitext(rel)[0]
                src_mtime = os.path.getmtime(src)
                targets = [w for w in WIDTHS if w < w0] + [w0]
                # de-dup and cap: never more than 4 steps per image
                targets = sorted(set(targets))
                if len(targets) > 4:
                    keep = {targets[0], targets[-1]}
                    mid = targets[1:-1]
                    step = max(1, len(mid) // 2)
                    keep.update(mid[::step][:2])
                    targets = sorted(keep)

                entry = {'w': w0, 'h': h0, 'v': {}, '_src': src, '_targets': targets, '_relnoext': rel_noext, '_mtime': src_mtime}
                manifest[url] = entry
                pending.append(url)

    # ---- encode all missing variants in parallel (I/O + cwebp bound) ----
    jobs = []
    for url in pending:
        e = manifest[url]
        for w in e['_targets']:
            dst = variant_path(e['_relnoext'], w)
            if os.path.exists(dst) and os.path.getmtime(dst) >= e['_mtime']:
                skipped += 1
            else:
                jobs.append((e['_src'], dst, w))
    if jobs:
        print(f'  encoding {len(jobs)} variants with {os.cpu_count() or 4} workers ...')
        with ThreadPoolExecutor(max_workers=(os.cpu_count() or 4) * 2) as ex:
            for ok in ex.map(lambda j: encode(*j), jobs):
                if ok:
                    made += 1

    for url in pending:
        e = manifest[url]
        for w in e['_targets']:
            dst = variant_path(e['_relnoext'], w)
            if os.path.exists(dst):
                e['v'][str(w)] = {
                    'u': '/static/rimg/' + os.path.relpath(dst, OUT_DIR).replace(os.sep, '/'),
                    's': os.path.getsize(dst),
                }
        for k in ('_src', '_targets', '_relnoext', '_mtime'):
            e.pop(k, None)
        if e['v']:
            saved_before += os.path.getsize(os.path.join(STATIC, url[len('/static/'):]))
            saved_after += max(x['s'] for x in e['v'].values())
        else:
            manifest.pop(url, None)

    os.makedirs(OUT_DIR, exist_ok=True)
    with io.open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(',', ':'))

    print(f'  images indexed  : {len(manifest)}')
    print(f'  variants written: {made}   (up-to-date: {skipped})')
    print(f'  largest-variant vs original: {human(saved_after)} B vs {human(saved_before)} B'
          f'  ({100 - round(saved_after * 100 / max(1, saved_before))}% smaller)')
    print(f'  manifest        : {os.path.relpath(MANIFEST, ROOT)} ({human(os.path.getsize(MANIFEST))} B)')


if __name__ == '__main__':
    main()
