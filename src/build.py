"""Bundle the Fullban SEQ-TRAK app into one self-contained HTML file.
Usage: python build.py [out.html]   (run in the app folder)"""
import base64, re, sys, os

here = os.path.dirname(os.path.abspath(__file__))
rd = lambda f: open(os.path.join(here, f), encoding='utf-8').read().replace('\r', '')
html = rd('index.html')
css = rd('style.css')
bg = os.path.join(here, 'seqtrak-bg.jpg')
if os.path.exists(bg):
    data = base64.b64encode(open(bg, 'rb').read()).decode()
    css = css.replace("url('seqtrak-bg.jpg')", "url('data:image/jpeg;base64,%s')" % data)
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')


def inline(m):
    return '<script>\n' + rd(m.group(1)) + '\n</script>'


html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'Fullban-SEQTRAK.html')
open(out, 'w', encoding='utf-8').write(html)
print('wrote', out, len(html), 'bytes')
