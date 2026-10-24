#!/usr/bin/env python3
"""Check the Paperwork Lab fixture and an editor-generated completed PDF.

Usage:
  python verify_output.py --fixture-only
  python verify_output.py --completed output-completed.pdf \
      --expected-values expected-fields-example.json \
      --report result.json

The output analyser checks structural values, independent renderability,
original vector labels and pixel changes in designated page 2 drawing zones.
It cannot prove browser ergonomics, visually correct appearance in every
reader, print-dialog behaviour or privacy/network isolation.
"""
import argparse, json, sys
from pathlib import Path
from pypdf import PdfReader
from PIL import Image
import fitz
import numpy as np

HERE=Path(__file__).resolve().parent
MAN=json.loads((HERE/'fixture-manifest.json').read_text())
BASE=HERE/MAN['fixture']

def field_value(v):
    if v is None:return ''
    return str(v)

def pdf_info(path):
    reader=PdfReader(str(path),strict=False)
    if reader.is_encrypted:raise ValueError('Encrypted PDF')
    fields=reader.get_fields() or {}
    return reader, {k:{'type':str(v.get('/FT')),'value':field_value(v.get('/V')),'flags':int(v.get('/Ff',0))} for k,v in fields.items()}

def independent_render_check(path):
    doc=fitz.open(str(path)); results=[]
    for i,page in enumerate(doc):
        pix=page.get_pixmap(matrix=fitz.Matrix(.75,.75),alpha=False,annots=True)
        assert pix.width>0 and pix.height>0
        results.append({'page':i+1,'width_px':pix.width,'height_px':pix.height,'rotation':page.rotation})
    doc.close()
    return results

def region_changed_pixels(base_doc, out_doc, page_num, box):
    pb=base_doc[page_num]; po=out_doc[page_num]
    height=pb.rect.height
    x,y,w,h=box
    rect=fitz.Rect(x,height-(y+h),x+w,height-y)
    if not pb.rect.contains(rect) or not po.rect.contains(rect): return None
    a=pb.get_pixmap(clip=rect,matrix=fitz.Matrix(1,1),alpha=False,annots=True)
    b=po.get_pixmap(clip=rect,matrix=fitz.Matrix(1,1),alpha=False,annots=True)
    if (a.width,a.height)!=(b.width,b.height):return None
    aa=np.frombuffer(a.samples,dtype=np.uint8).reshape(a.height,a.width,a.n)[:,:,:3]
    bb=np.frombuffer(b.samples,dtype=np.uint8).reshape(b.height,b.width,b.n)[:,:,:3]
    diff=np.max(np.abs(aa.astype(np.int16)-bb.astype(np.int16)),axis=2)
    return {'changed_px':int(np.count_nonzero(diff>35)),'fraction':round(float(np.mean(diff>35)),5),'total_px':int(diff.size)}

def verify(completed, expected_values):
    output={'fixture':str(BASE),'completed':str(completed) if completed else None,'checks':[], 'measurements':{},'automated_pass':True}
    def check(name,passes,actual=None,required=True):
        output['checks'].append({'name':name,'pass':bool(passes),'actual':actual,'required':required})
        if required and not passes:output['automated_pass']=False
    reader,fields=pdf_info(BASE)
    check('golden PDF contains four pages',len(reader.pages)==4,len(reader.pages))
    check('golden PDF has required AcroForm fields',set(MAN['fields'])==set(fields),sorted(fields))
    for key,e in MAN['fields'].items():
        if key in fields:
            check('fixture field type '+key,fields[key]['type']==e['type'],fields[key]['type'])
            check('fixture initial value '+key,fields[key]['value']==e['initial'],fields[key]['value'])
    check('source page three really rotated',int(reader.pages[2].get('/Rotate',0))==90,reader.pages[2].get('/Rotate'))
    check('raster page has no form widgets',not reader.pages[3].get('/Annots'),str(reader.pages[3].get('/Annots')))
    check('signature PNG retains transparency',Image.open(HERE/MAN['signature']).mode=='RGBA',Image.open(HERE/MAN['signature']).mode)
    output['measurements']['source_rendered']=independent_render_check(BASE)
    if completed:
        try:
            out_reader,out_fields=pdf_info(completed)
            check('completed pages preserved',len(out_reader.pages)==len(reader.pages),len(out_reader.pages))
            check('completed AcroForm names retained',set(fields).issubset(out_fields),sorted(out_fields))
            if expected_values:
                for key,wanted in expected_values.items():
                    actual=out_fields.get(key,{}).get('value')
                    check('completed value '+key,actual==str(wanted),actual)
            output['measurements']['completed_rendered']=independent_render_check(completed)
            src=fitz.open(BASE); dst=fitz.open(str(completed))
            for i,needle in enumerate(['REAL INTERACTIVE FORM','MIXED FORM / NO MODE HOPPING','ROTATION-CHECK-731']):
                actual=dst[i].get_text()
                check('preserved source vector text page '+str(i+1),needle in actual,needle)
            diffs={}
            for area in MAN['page2_overlay_targets']:
                measure=region_changed_pixels(src,dst,1,area['pdf_bbox'])
                diffs[area['id']]=measure
                check('visible user edit in '+area['id'],measure is not None and measure['changed_px']>25,measure)
            output['measurements']['page2_overlay_diffs']=diffs
            # Deliberate review action: a changed ROI says content changed, not that it was the *correct* ink/signature.
            src.close();dst.close()
        except Exception as e:
            check('completed PDF parse and inspect',False,str(e))
    else:
        output['note']='Fixture-only preflight: does NOT mean a Paperwork editor passed any user workflow.'
    output['manual_checks_still_required']=['Browser controls & tool switching, touch/pen/zoom and keyboard input',
      'Export visually matches editor in PDF.js AND second independent reader',
      'Printer preview uses exported result, not original',
      'Browser network/privacy inspection and no persistent signature storage',
      'Rotation/page 3 annotation geometry and scanned page 4 overlay placement',
      'Negative files fail safely without destroying unrelated unsaved work']
    return output

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--fixture-only',action='store_true');ap.add_argument('--completed');ap.add_argument('--expected-values');ap.add_argument('--report');args=ap.parse_args()
    ev=json.loads(Path(args.expected_values).read_text()) if args.expected_values else None
    result=verify(Path(args.completed) if args.completed else None,ev)
    data=json.dumps(result,indent=2,default=str)+'\n'
    if args.report:Path(args.report).write_text(data)
    print(data)
    sys.exit(0 if result['automated_pass'] else 1)
if __name__=='__main__':main()
