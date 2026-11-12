# Rebuilds preview-harness.html from the Design System artifact files: tokens :root block, bundle.css, React 18.3.1, bundle.js.
# Usage: python scripts/build-preview-harness.py <folder holding project/ read from the artifact> preview-harness.html
import json, sys
ds, out = sys.argv[1], sys.argv[2]
tok = json.load(open(ds + '/project/tokens.json', encoding='utf-8'))
vals = {t['name']: t['value'] for t in tok['color']['tokens']}
def res(v): return 'var(--' + v[1:-1] + ')' if isinstance(v, str) and v.startswith('{') else v
lines = ['--%s:%s;' % (n, res(v)) for n, v in vals.items()]
for fam in ('spacing', 'radius', 'size', 'shadow'):
    lines += ['--%s:%s;' % (t['name'], t['value']) for t in tok[fam]['tokens']]
lines.append('--font-sans:%s;' % tok['type']['families']['sans'])
css = open(ds + '/project/components/bundle.css', encoding='utf-8').read().rstrip('\n')
js = open(ds + '/project/components/bundle.js', encoding='utf-8').read().rstrip('\n')
html = ('<!doctype html><html data-theme="light"><head><meta charset="utf-8"><title>Smart EMS preview</title><style>:root{' + ''.join(lines) + '}</style><style>' + css + '\n</style>\n'
  '<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>\n'
  '<script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>\n'
  '<script>' + js + '\n</script></head><body><div id="root"></div><script>\n'
  "var s = (location.hash || '#Intake').slice(1), E = window.EMS;\n"
  'ReactDOM.createRoot(document.getElementById(\'root\')).render(React.createElement(E.Screens[s]));\n'
  '</script></body></html>\n')
open(out, 'w', encoding='utf-8', newline='\n').write(html)
print('wrote', out, len(html))
