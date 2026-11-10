import json, numpy as np
d = json.load(open('landmarks.json'))
STABLE = [33,133,362,263,168,6,197,195,5,4,1,98,327,234,454,127,356,70,300,105,334]
rows = []
for i,o in enumerate(d):
    if not o['ok'] or i < 20 or i > 480: continue
    P = np.array(o['pts'])
    iod = np.linalg.norm(P[33]-P[263])
    openv = np.linalg.norm(P[13]-P[14]) / iod
    width = np.linalg.norm(P[61]-P[291]) / iod
    yaw = (P[1][0] - (P[234][0]+P[454][0])/2) / iod
    rows.append(dict(i=i, open=openv, width=width, yaw=yaw, blink=(o['bs']['eyeBlinkLeft']+o['bs']['eyeBlinkRight'])/2,
      smile=(o['bs']['mouthSmileLeft']+o['bs']['mouthSmileRight'])/2, pucker=o['bs']['mouthPucker'], funnel=o['bs']['mouthFunnel']))
json.dump(rows, open('metrics.json','w'))
a = lambda k: np.array([r[k] for r in rows])
for k in ['open','width','yaw','blink']: print(k, np.percentile(a(k),[0,10,50,90,100]).round(3))
# candidate base: closed mouth, eyes open, frontal
c = sorted(rows, key=lambda r: r['open']*5 + abs(r['yaw'])*2 + r['blink'] + abs(r['width']-np.median(a('width'))))[:5]
print([ (r['i'], round(r['open'],3), round(r['yaw'],3), round(r['blink'],2)) for r in c])
