import json, cv2, os
S = 0.75; dst = '/home/maus/projects/pblvrt.com/public/avatar/'
a = json.load(open('out/atlas.json'))
sc = lambda v: int(round(v*S))
def rs(img, w, h): return cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
W, H = a['size']; base = cv2.imread('out/base.jpg')
cv2.imwrite(dst+'face.jpg', rs(base, sc(W), sc(H)), [cv2.IMWRITE_JPEG_QUALITY, 86])
m = a['mouth']; x,y,w,h = m['box']; n = len(m['items']); cols = m['cols']; rows = (n+cols-1)//cols
sh = cv2.imread('out/mouths.png', cv2.IMREAD_UNCHANGED)
nw, nh = sc(w), sc(h)
import numpy as np
out = np.zeros((rows*nh, cols*nw, 4), np.uint8)
for k in range(n):
    r,c = divmod(k, cols); out[r*nh:(r+1)*nh, c*nw:(c+1)*nw] = rs(sh[r*h:(r+1)*h, c*w:(c+1)*w], nw, nh)
cv2.imwrite(dst+'mouths.webp', out, [cv2.IMWRITE_WEBP_QUALITY, 82])
e = a['eyes']; ex,ey,ew,eh = e['box']; es = cv2.imread('out/eyes.png', cv2.IMREAD_UNCHANGED)
cv2.imwrite(dst+'eyes.webp', rs(es, sc(ew)*2, sc(eh)), [cv2.IMWRITE_WEBP_QUALITY, 82])
json.dump(dict(face='/avatar/face.jpg', size=[sc(W), sc(H)],
  mouth=dict(src='/avatar/mouths.webp', box=[sc(x),sc(y),nw,nh], cols=cols, items=[dict(open=i['open'], width=i['width']) for i in m['items']]),
  eyes=dict(src='/avatar/eyes.webp', box=[sc(ex),sc(ey),sc(ew),sc(eh)], items=e['items'])),
  open(dst+'lipsync.json','w'), separators=(',',':'))
for f in ('face.jpg','mouths.webp','eyes.webp','lipsync.json'): print(f, os.path.getsize(dst+f))
