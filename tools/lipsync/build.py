import json, numpy as np, cv2
d = json.load(open('landmarks.json')); M = json.load(open('metrics.json'))
BASE = 382
STABLE = [33,133,362,263,168,6,197,195,98,327,234,454,127,356,70,300,105,334,10,151]
bp = np.array(d[BASE]['pts']); base = cv2.imread(d[BASE]['f'])
H, W = base.shape[:2]
iod = np.linalg.norm(bp[33]-bp[263])
def align(i):
    p = np.array(d[i]['pts'])
    A, inl = cv2.estimateAffinePartial2D(p[STABLE], bp[STABLE], method=cv2.LMEDS)
    w = cv2.warpAffine(cv2.imread(d[i]['f']), A, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    q = (np.c_[p, np.ones(len(p))] @ A.T)
    err = np.linalg.norm(q[STABLE]-bp[STABLE], axis=1).mean()
    return w, q, err
def soft_mask(box, poly_pts, feather):
    x0,y0,x1,y1 = box
    m = np.zeros((y1-y0, x1-x0), np.float32)
    cv2.fillPoly(m, [np.int32(poly_pts - [x0,y0])], 1.0)
    k = int(feather)|1
    m = cv2.GaussianBlur(m, (k*2+1, k*2+1), feather/2)
    return m
# mouth region (in base coords): from under the nose to below the chin
mx0 = int(bp[61][0] - 0.75*iod); mx1 = int(bp[291][0] + 0.75*iod)
my0 = int(bp[2][1] - 0.08*iod); my1 = int(bp[152][1] + 0.55*iod)
mbox = (mx0, my0, mx1, my1)
cx, cy = (mx0+mx1)/2, (my0+my1)/2
ell = cv2.ellipse2Poly((int(cx), int(cy)), (int((mx1-mx0)/2*0.88), int((my1-my0)/2*0.88)), 0, 0, 360, 5)
mmask = soft_mask(mbox, ell, 0.12*iod)
# eye region
ex0 = int(bp[33][0] - 0.35*iod); ex1 = int(bp[263][0] + 0.35*iod)
ey0 = int(min(bp[105][1], bp[334][1]) - 0.05*iod); ey1 = int(bp[6][1] + 0.18*iod)
ebox = (ex0, ey0, ex1, ey1)
eyes = []
for L in ([33,160,159,158,133,153,145,144], [362,385,386,387,263,373,374,380]):
    c = bp[L].mean(0); eyes.append(cv2.ellipse2Poly((int(c[0]), int(c[1]-0.04*iod)), (int(0.42*iod), int(0.26*iod)), 0, 0, 360, 5))
emask = np.zeros((ey1-ey0, ex1-ex0), np.float32)
for e in eyes: emask = np.maximum(emask, soft_mask(ebox, e, 0.09*iod))
def cut(img, box, mask):
    x0,y0,x1,y1 = box
    patch = img[y0:y1, x0:x1].astype(np.float32)
    bpatch = base[y0:y1, x0:x1].astype(np.float32)
    ring = (mask > 0.05) & (mask < 0.6)
    gain = (bpatch[ring].mean(0)+1) / (patch[ring].mean(0)+1)
    patch = np.clip(patch * gain, 0, 255)
    return np.dstack([patch, mask*255]).astype(np.uint8)
# bin mouth frames
opens = [0.0, 0.025, 0.05, 0.08, 0.11, 0.14, 0.18, 0.23]
good = [r for r in M if r['blink'] < 0.45 and abs(r['yaw']) < 0.04]
cands = {}
for r in good:
    oi = int(np.argmin([abs(r['open']-o) for o in opens]))
    cands.setdefault(oi, []).append(r)
sprites = []; meta = []
for oi in sorted(cands):
    rs = cands[oi]
    ws = np.array([r['width'] for r in rs])
    lo, hi = np.percentile(ws, 20), np.percentile(ws, 80)
    for shape, sel in (('round', [r for r in rs if r['width'] <= lo]), ('mid', rs), ('wide', [r for r in rs if r['width'] >= hi])):
        if not sel: continue
        best = None
        for r in sorted(sel, key=lambda r: abs(r['open']-opens[oi]))[:12]:
            w, q, err = align(r['i'])
            if best is None or err < best[2]: best = (r, w, err)
        r, w, err = best
        key = (oi, shape, r['i'])
        if any(m['frame']==r['i'] for m in meta): continue
        sprites.append(cut(w, mbox, mmask))
        meta.append(dict(open=round(r['open'],4), width=round(r['width'],4), shape=shape, frame=r['i'], err=round(err,2)))
# blink frames
bl = sorted([r for r in M if abs(r['yaw'])<0.04], key=lambda r: -r['blink'])
blinks = []
for target in (0.75, 0.4):
    r = min(bl[:80], key=lambda r: abs(r['blink']-target))
    w,_,_ = align(r['i']); blinks.append(cut(w, ebox, emask))
# sheet
pw, ph = mx1-mx0, my1-my0
cols = 6; rows = (len(sprites)+cols-1)//cols
sheet = np.zeros((rows*ph, cols*pw, 4), np.uint8)
for k,s in enumerate(sprites):
    r_, c_ = divmod(k, cols); sheet[r_*ph:(r_+1)*ph, c_*pw:(c_+1)*pw] = s
cv2.imwrite('out/mouths.png', sheet)
ew, eh = ex1-ex0, ey1-ey0
esheet = np.zeros((eh, ew*2, 4), np.uint8)
for k,s in enumerate(blinks): esheet[:, k*ew:(k+1)*ew] = s
cv2.imwrite('out/eyes.png', esheet)
cv2.imwrite('out/base.jpg', base, [cv2.IMWRITE_JPEG_QUALITY, 88])
json.dump(dict(size=[W,H], mouth=dict(box=[mx0,my0,pw,ph], cols=cols, items=meta), eyes=dict(box=[ex0,ey0,ew,eh], items=['closed','half'])), open('out/atlas.json','w'), indent=1)
print(len(meta), 'mouth sprites', [ (m['shape'], m['open'], m['err']) for m in meta])
