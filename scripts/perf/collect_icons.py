import os
import re, os, json, glob
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
srcs=[]
for pat in ['dist/views/**/*.js','dist/utils/*.js','public/static/js/*.js','dist/api/*.js','dist/server.js','public/static/css/app.css']:
    srcs += glob.glob(os.path.join(ROOT,pat), recursive=True)
text=''
for f in srcs:
    if 'axios.min' in f or 'chart.min' in f: continue
    text += open(f, encoding='utf-8', errors='ignore').read()
# also DB-stored icons (categories.icon etc.)
import sqlite3
try:
    c=sqlite3.connect(os.path.join(ROOT,'data/netcorepro.db'))
    for tbl,col in [('categories','icon')]:
        for (v,) in c.execute(f'select {col} from {tbl} where {col} is not null'):
            text += ' '+str(v)
except Exception as e: print('db',e)
names=set(re.findall(r'\bfa-([a-z0-9]+(?:-[a-z0-9]+)*)\b', text))
# drop style tokens
styles={'solid','solid-900','regular','regular-400','brands','brands-400','light','duotone','thin','fw','lg','xs','sm','2x','3x','spin','pulse','stack','1x','beat','fade','flip','border','pull-left','pull-right','inverse','li','ul','rotate-90','rotate-180','rotate-270','stack-1x','stack-2x'}
names={n for n in names if n not in styles}
css=open(os.path.join(ROOT,'public/static/css/fontawesome.min.css'),encoding='utf-8').read()
# map: .fa-xxx:before{content:"\fXXX"}  (may be grouped)
mapping={}
for m in re.finditer(r'((?:\.fa-[a-z0-9-]+(?::before)?\s*,?\s*)+)\{--fa:\s*"([^"]+)"[^}]*\}', css):
    sel, ch = m.group(1), m.group(2)
    for nm in re.findall(r'\.fa-([a-z0-9-]+)', sel):
        mapping[nm]=ch
if not mapping:
    for m in re.finditer(r'((?:\.fa-[a-z0-9-]+(?::before)?\s*,?\s*)+)\{content:\s*"([^"]+)"\}', css):
        sel, ch = m.group(1), m.group(2)
        for nm in re.findall(r'\.fa-([a-z0-9-]+)', sel):
            mapping[nm]=ch
used={}; missing=[]
for n in sorted(names):
    if n in mapping: used[n]=mapping[n]
    else: missing.append(n)
print('found icons:',len(used),'unmapped tokens:',len(missing))
print('unmapped sample:', missing[:40])
json.dump(used, open(os.path.join(ROOT,'scripts/perf/used_icons.json'),'w'), ensure_ascii=False, indent=0)
