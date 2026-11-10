import glob, json, sys
import mediapipe as mp, numpy as np
from mediapipe.tasks.python import vision, BaseOptions
opts = vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path='face_landmarker.task'),
    output_face_blendshapes=True, num_faces=1)
lm = vision.FaceLandmarker.create_from_options(opts)
out = []
for f in sorted(glob.glob('frames/*.jpg')):
    img = mp.Image.create_from_file(f)
    r = lm.detect(img)
    if not r.face_landmarks:
        out.append({'f': f, 'ok': False}); continue
    pts = [[p.x*img.width, p.y*img.height] for p in r.face_landmarks[0]]
    bs = {b.category_name: round(b.score, 4) for b in r.face_blendshapes[0]}
    out.append({'f': f, 'ok': True, 'pts': pts, 'bs': bs})
json.dump(out, open('landmarks.json', 'w'))
print(len(out), sum(o['ok'] for o in out))
