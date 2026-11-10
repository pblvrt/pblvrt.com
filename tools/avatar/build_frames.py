# Real-footage avatar: stabilise every frame to one head pose, measure its mouth,
# and pack the frames into sprite sheets the browser picks from while speaking.
import json, math, numpy as np
from PIL import Image
d = json.load(open('landmarks.json'))
STABLE = [33,133,362,263,168,6,197,195,5,4,1,98,327,234,454,127,356,70,300,105,334]
FIRST, LAST = 20, 480
W, H, COLS, PER, Z = 480, 640, 6, 36, 1.1          # output frame size, sheet layout
src = [i for i in range(FIRST, LAST + 1) if d[i]['ok']]
P = {i: np.array(d[i]['pts']) for i in src}
ref = np.median(np.stack([P[i][STABLE] for i in src]), axis=0)

def sim(a, b):  # similarity transform mapping points a onto b
    ma, mb = a.mean(0), b.mean(0); A, B = a - ma, b - mb
    u, s, vt = np.linalg.svd(A.T @ B); r = (u @ vt).T
    if np.linalg.det(r) < 0: vt[-1] *= -1; r = (u @ vt).T
    sc = s.sum() / (A ** 2).sum(); t = mb - sc * r @ ma
    return sc, r, t

feats, sheets, cur = [], [], None
img0 = Image.open(d[src[0]]['f']); SW, SH = img0.size; k = W / SW
for n, i in enumerate(src):
    p = P[i]; sc, r, t = sim(p[STABLE], ref)
    # inverse affine for PIL (output -> input), with the final downscale folded in
    M = np.eye(3); M[:2, :2] = sc * r; M[:2, 2] = t
    S = np.array([[k * Z, 0, -(Z - 1) * W / 2], [0, k * Z, -(Z - 1) * H / 2], [0, 0, 1]]); inv = np.linalg.inv(S @ M)  # zoom hides edges
    im = Image.open(d[i]['f']).convert('RGB').transform((W, H), Image.AFFINE, inv[:2].ravel().tolist(), Image.BICUBIC)
    q = (np.c_[p, np.ones(len(p))] @ (S @ M).T)[:, :2]
    iod = np.linalg.norm(q[33] - q[263]); bs = d[i]['bs']
    feats.append([round(float(np.linalg.norm(q[13] - q[14]) / iod), 4), round(float(np.linalg.norm(q[61] - q[291]) / iod), 4),
                  round((bs['eyeBlinkLeft'] + bs['eyeBlinkRight']) / 2, 3),
                  round(float(t[0]), 1), round(float(t[1]), 1), round(float(math.degrees(math.atan2(r[1, 0], r[0, 0]))), 2)])
    if n % PER == 0:
        cur = Image.new('RGB', (W * COLS, H * math.ceil(PER / COLS))); sheets.append(cur)
    j = n % PER; cur.paste(im, ((j % COLS) * W, (j // COLS) * H))
names = []
for s, im in enumerate(sheets):
    name = f'frames-{s:02d}.webp'; im.save(f'v2/out/{name}', 'WEBP', quality=70, method=6); names.append(name)
json.dump({'size': [W, H], 'cols': COLS, 'per': PER, 'fps': 25, 'sheets': names, 'src': src,
           'f': feats, 'keys': ['open', 'width', 'blink', 'dx', 'dy', 'rot']}, open('v2/out/avatar.json', 'w'))
print(len(src), 'frames', len(sheets), 'sheets')
