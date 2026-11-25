"""Bundle the Fullban SEQ-TRAK app into one self-contained HTML file.
Usage: python build.py [out.html]   (run in the app folder)"""
import base64, re, sys, os

here = os.path.dirname(os.path.abspath(__file__))
rd = lambda f: open(os.path.join(here, f), encoding='utf-8').read().replace('\r', '')
html = rd('index.html')
css = rd('style.css')
# inline every local image the stylesheet uses
for img in sorted(set(re.findall(r"url\('([\w.-]+\.(?:jpg|png|webp))'\)", css))):
    p = os.path.join(here, img)
    if os.path.exists(p):
        mime = {'png':'image/png','webp':'image/webp'}.get(img.rsplit('.',1)[1],'image/jpeg')
        css = css.replace("url('%s')" % img, "url('data:%s;base64,%s')" % (mime, base64.b64encode(open(p, 'rb').read()).decode()))
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')


def inline(m):
    return '<script>\n' + rd(m.group(1)) + '\n</script>'


html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'Fullban-SEQTRAK.html')
open(out, 'w', encoding='utf-8').write(html)
print('wrote', out, len(html), 'bytes')
