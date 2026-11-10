import json, cv2, numpy as np, sys
a = json.load(open('out/atlas.json')); base = cv2.imread('out/base.jpg').astype(np.float32)
sheet = cv2.imread('out/mouths.png', cv2.IMREAD_UNCHANGED); x,y,w,h = a['mouth']['box']; cols=a['mouth']['cols']
def comp(k):
    r,c = divmod(k, cols); s = sheet[r*h:(r+1)*h, c*w:(c+1)*w].astype(np.float32)
    out = base.copy(); al = s[...,3:]/255
    out[y:y+h, x:x+w] = s[...,:3]*al + out[y:y+h, x:x+w]*(1-al)
    return out[200:900, 150:660]
ks = [int(k) for k in sys.argv[1:]]
img = np.hstack([comp(k) for k in ks]); cv2.imwrite('/tmp/prev.jpg', cv2.resize(img, None, fx=0.6, fy=0.6), [cv2.IMWRITE_JPEG_QUALITY, 85])
