"""Focused independent checks supplementing the supplied verifier, using synthetic data only."""
import json,sys,hashlib
from pathlib import Path
import fitz
import numpy as np
from PIL import Image
base=Path('tests/fixtures/paperwork-fixtures')
output=Path(sys.argv[1])
src=fitz.open(base/'paperwork-lab-interactive-mixed.pdf');dst=fitz.open(output)
checks={}
for i,(a,b) in enumerate(zip(src,dst)):
 checks[f'page_{i+1}_geometry']=a.mediabox==b.mediabox and a.cropbox==b.cropbox and a.rotation==b.rotation
 # All original vector text must remain, except native field appearances which readers expose differently.
 if i<3:
  for label in ['PAPERWORK / LAB','SYNTHETIC TEST DOCUMENT']:
   checks[f'page_{i+1}_original_{label.split()[0]}']=label in b.get_text()
# The original scanned artwork must survive byte-for-byte as decoded RGB pixels.
a=src[3].get_images(full=True)[0];b=dst[3].get_images(full=True)[0]
checks['original_scan_preserved']=hashlib.sha256(fitz.Pixmap(src,a[0]).samples).digest()==hashlib.sha256(fitz.Pixmap(dst,b[0]).samples).digest()
# pdf-lib must embed the actual transparent source PNG, not a white-backed approximation.
image=Image.open(base/'demo-signature-transparent.png');alpha=np.asarray(image)[:,:,3]
images=dst[1].get_images(full=True)
checks['signature_soft_mask_present']=any(info[1] for info in images)
checks['signature_alpha_exact']=any(info[1] and fitz.Pixmap(dst,info[1]).width==image.width and fitz.Pixmap(dst,info[1]).height==image.height and np.array_equal(np.frombuffer(fitz.Pixmap(dst,info[1]).samples,dtype=np.uint8).reshape(image.height,image.width),alpha) for info in images)
checks['signature_inside_target']=any(fitz.Rect(38, dst[1].rect.height-265,553,dst[1].rect.height-132).contains(rect) for info in images for rect in dst[1].get_image_rects(info[0]))
# Exact displayed positions on the rotated page, independently obtained from saved PDF text.
positions=[]
for word in dst[2].get_text('dict')['blocks']:
 for line in word.get('lines',[]):
  for span in line['spans']:
   if span['text']=='Rotation target':
    point=fitz.Point(span['origin'])*dst[2].rotation_matrix
    positions.append([round(point.x,2),round(point.y,2)])
checks['three_rotated_text_targets']=len(positions)==3 and all(abs(p[0]-287)<1 for p in positions) and all(any(abs(p[1]-y)<1 for p in positions) for y in [182,467,734])
checks['scan_overlay_text']='Alex Example' in dst[3].get_text()
for i,page in enumerate(dst):
 page.get_pixmap(matrix=fitz.Matrix(1,1),alpha=False,annots=True).save(output.parent/f'independent-page-{i+1}.png')
result={'implementation':'PyMuPDF '+fitz.VersionBind,'checks':checks,'rotated_text_origins':positions,'pass':all(checks.values())}
(output.parent/'independent-inspection.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2));sys.exit(0 if result['pass'] else 1)
