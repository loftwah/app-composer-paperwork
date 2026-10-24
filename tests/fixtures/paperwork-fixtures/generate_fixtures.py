#!/usr/bin/env python3
"""Generate deterministic, fictional Paperwork acceptance fixtures.
Requires reportlab, pypdf and pillow. No external network access.
Usage: python generate_fixtures.py
"""
from pathlib import Path
import json, hashlib, io, math
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape, letter
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ORANGE = colors.HexColor('#FC5B05')
INK = colors.HexColor('#15283D')
MUTED = colors.HexColor('#586B7B')
PALE = colors.HexColor('#FFF2E9')
LINE = colors.HexColor('#BAC8CF')


def text(c, x, y, content, size=10, color=INK, font='Helvetica'):
    c.setFillColor(color); c.setFont(font,size); c.drawString(x,y,content)

def rounded(c,x,y,w,h, r=6, fill=None, stroke=LINE):
    c.setStrokeColor(stroke); c.setLineWidth(0.9)
    if fill: c.setFillColor(fill)
    c.roundRect(x,y,w,h,r,fill=bool(fill),stroke=1)

def header(c, w, h, section, page):
    c.setFillColor(INK); c.rect(0,h-72,w,72,stroke=0,fill=1)
    c.setFillColor(ORANGE); c.roundRect(38,h-52,7,25,3,stroke=0,fill=1)
    text(c,56,h-34,'PAPERWORK / LAB',17,colors.white,'Helvetica-Bold')
    text(c,56,h-54,section,10,colors.HexColor('#E5EDF4'))
    text(c,38,24,'SYNTHETIC TEST DOCUMENT  |  NOT VALID FOR ANY REAL APPLICATION',8,MUTED)
    text(c,w-93,24,f'PAGE {page}',8,MUTED)

def label(c,x,y,s): text(c,x,y,s,9,INK,'Helvetica-Bold')

def make_demo_signature():
    W,H=900,260
    im=Image.new('RGBA',(W,H),(0,0,0,0))
    d=ImageDraw.Draw(im)
    font_path='/usr/share/fonts/opentype/urw-base35/Z003-MediumItalic.otf'
    font=ImageFont.truetype(font_path,155) if Path(font_path).exists() else ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf',110)
    d.text((46,0),'Alex Example',font=font,fill=(20,38,66,240),stroke_width=0)
    d.arc((42,140,860,226),0,165,fill=(20,38,66,205),width=5)
    # Small, visible provenance baked into this fictional signature itself.
    demo=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',24)
    d.text((600,218),'DEMO SIGNATURE',font=demo,fill=(245,92,21,205))
    im.save(HERE/'demo-signature-transparent.png')
    return im

def field(c, name, tooltip, x,y,w=210,h=26,value='',flags='',maxlen=140):
    c.acroForm.textfield(name=name,tooltip=tooltip,x=x,y=y,width=w,height=h,
        fontName='Helvetica',fontSize=11,fillColor=colors.white,
        textColor=INK,borderColor=LINE,borderWidth=1,
        value=value,fieldFlags=flags,maxlen=maxlen)


def build_pdf(sig):
    raw=HERE/'_draft.pdf'
    c=canvas.Canvas(str(raw),pagesize=A4,pageCompression=1)
    c.setTitle('Paperwork Lab - Synthetic Interactive and Flat PDF Acceptance')
    c.setAuthor('Paperwork synthetic fixtures - no personal information')
    w,h=A4
    header(c,w,h,'01 / Real form fields, current values and changes',1)
    text(c,38,h-105,'REAL INTERACTIVE FORM',16,INK,'Helvetica-Bold')
    text(c,38,h-123,'These controls are actual AcroForm widgets, not pictures of inputs.',9,MUTED)
    y=h-162
    label(c,38,y,'FULL NAME / edit the prefilled value')
    field(c,'full_name','Full name - change initial value',38,y-38,245,27,'Jordan Example')
    label(c,311,y,'REFERENCE / max. 12 characters')
    field(c,'reference_code','Reference code - maximum 12 characters',311,y-38,242,27,'LAB-0042',maxlen=12)
    y-=89
    label(c,38,y,'CONTACT EMAIL / fill from blank')
    field(c,'contact_email','Contact email',38,y-38,245,27)
    label(c,311,y,'READ-ONLY ID / must remain unchanged')
    field(c,'immutable_id','Read-only synthetic identifier',311,y-38,242,27,'SYNTH-LOCK-001',flags='readOnly')
    y-=92
    label(c,38,y,'MULTILINE COMMENTS / replace, add a second line')
    field(c,'comments','Multiline comments',38,y-103,515,86,'Replace this sample note.',flags='multiline',maxlen=500)
    y-=154
    label(c,38,y,'CHECKBOXES / toggle both ways')
    c.acroForm.checkbox(name='subscribe',tooltip='Subscribe to fictional notices',x=40,y=y-35,size=18,
         buttonStyle='check',borderColor=LINE,fillColor=colors.white,textColor=INK,fieldFlags='',checked=False)
    text(c,67,y-30,'Send fictional updates',10)
    c.acroForm.checkbox(name='terms_seen',tooltip='Saw the sample instructions',x=265,y=y-35,size=18,
         buttonStyle='check',borderColor=LINE,fillColor=colors.white,textColor=INK,fieldFlags='',checked=True)
    text(c,292,y-30,'Instructions acknowledged',10)
    y-=93
    label(c,38,y,'RADIO GROUP / change selection twice')
    for ix,(v,tx,selected) in enumerate([('Email','Email',True),('Post','Post',False),('InPerson','In person',False)]):
        xx=40+170*ix
        c.acroForm.radio(name='contact_method',tooltip='Contact method',value=v,selected=selected,
            x=xx,y=y-36,size=17,buttonStyle='circle',borderColor=LINE,fillColor=colors.white,textColor=INK,fieldFlags='radio')
        text(c,xx+26,y-30,tx,10)
    y-=89
    label(c,38,y,'DROPDOWN / choose a different option')
    c.acroForm.choice(name='delivery_window',tooltip='Delivery window',x=38,y=y-40,width=245,height=28,
       options=['Morning','Afternoon','Evening'],value='Afternoon',fieldFlags='combo',
       borderColor=LINE,fillColor=colors.white,textColor=INK,fontName='Helvetica',fontSize=11)
    label(c,311,y,'LIST / change and restore selection')
    c.acroForm.choice(name='document_type',tooltip='Document type list',x=311,y=y-70,width=242,height=58,
       options=['Request','Amendment','Follow-up','Other'],value='Request',fieldFlags='',
       borderColor=LINE,fillColor=colors.white,textColor=INK,fontName='Helvetica',fontSize=10)
    rounded(c,38,42,w-76,43,6,PALE,colors.HexColor('#F4CDAD'))
    text(c,51,69,'Pass condition:',10,INK,'Helvetica-Bold')
    text(c,51,52,'Save changes, reopen PDF, and confirm fields AND on-page appearances.',9,INK)
    c.showPage()

    header(c,w,h,'02 / Mixed native fields, flat targets, ink and signature',2)
    text(c,38,h-105,'MIXED FORM / NO MODE HOPPING',16,INK,'Helvetica-Bold')
    text(c,38,h-125,'Use native fields and place your own content on the SAME page.',10,MUTED)
    label(c,38,h-162,'ACTUAL NATIVE FIELD / must remain editable after Pen tool')
    field(c,'case_note','Native field on same page as drawings',38,h-202,515,27,'Editable even after drawing')
    text(c,38,h-232,'The remaining boxes are drawn page artwork: use overlay tools.',9,MUTED)
    # page2 explicit ROI coordinates, line and labels
    areas=[
     ('overlay_text',[38,425,245,95],'TEXT ANYWHERE','Add, edit, move and delete a text overlay.'),
     ('overlay_tick',[311,425,242,95],'TICK / CROSS','Add or remove marks, without moving the box.'),
     ('pen_zone',[38,291,245,109],'FREEHAND INK','Circle, underline, scribble. Undo, redo, erase.'),
     ('highlighter_zone',[311,291,242,109],'HIGHLIGHTER','Highlight the guide lines below.'),
     ('signature_zone',[38,132,515,133],'SIGNATURE / TRANSPARENT PNG','Place the DEMO signature, drag and resize.'),
    ]
    for key,(x,y0,ww,hh),title,desc in areas:
        rounded(c,x,y0,ww,hh,7,colors.white)
        text(c,x+12,y0+hh-23,title,10,INK,'Helvetica-Bold')
        text(c,x+12,y0+hh-41,desc,8,MUTED)
        if key=='overlay_tick':
            c.setLineWidth(1.2); c.setStrokeColor(MUTED)
            for tx in [x+28,x+108,x+188]: c.rect(tx,y0+13,17,17)
        if key=='pen_zone':
            c.setStrokeColor(LINE); c.line(x+13,y0+25,x+ww-13,y0+25)
            text(c,x+13,y0+13,'INK TARGET / DO NOT RASTERISE ORIGINAL PAGE',7,MUTED)
        if key=='highlighter_zone':
            text(c,x+14,y0+30,'HIGHLIGHT THIS SENTENCE',11,INK,'Helvetica-Bold')
            c.setStrokeColor(LINE); c.line(x+13,y0+13,x+ww-13,y0+13)
        if key=='signature_zone':
            c.setDash(2,3); c.setStrokeColor(LINE);c.line(x+20,y0+42,x+ww-20,y0+42);c.setDash()
            text(c,x+22,y0+23,'DEMO PERSON: Alex Example',9,MUTED)
    c.showPage()

    w3,h3=landscape(A4)
    c.setPageSize((w3,h3)); header(c,w3,h3,'03 / Wide page, rotation and coordinate handling',3)
    text(c,38,h3-108,'LANDSCAPE ARTWORK / ROTATED VIEW TEST',16,INK,'Helvetica-Bold')
    text(c,38,h3-129,'This source page is rotated 90 degrees after authoring. Check pointer-to-PDF coordinates.',10,MUTED)
    for x,word in [(45,'TOP-LEFT'),(w3/2-90,'CENTRE'),(w3-245,'BOTTOM-RIGHT')]:
        y=h3-330
        rounded(c,x,y,198,142,8,colors.white)
        text(c,x+13,y+107,word,12,INK,'Helvetica-Bold')
        text(c,x+13,y+84,'Draw an X and place text.',10,MUTED)
        c.setStrokeColor(LINE);c.line(x+15,y+28,x+182,y+28)
    text(c,38,70,'Original vector label: ROTATION-CHECK-731',11,INK,'Helvetica-Bold')
    c.showPage()

    # Simulated raster paper page (no AcroForm fields / no selectable source characters)
    w4,h4=letter; c.setPageSize(letter)
    S=1.6
    scan=Image.new('RGB',(int(w4*S),int(h4*S)),(247,246,241))
    d=ImageDraw.Draw(scan)
    path='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    f1=ImageFont.truetype(path,28);f2=ImageFont.truetype(path,17)
    def st(y,t,font=f2): d.text((58,int(y*S)),t,font=font,fill=(47,56,61))
    st(76,'SCANNED-STYLE SAMPLE  /  PRINTED BOXES',f1)
    st(120,'There are NO interactive PDF fields on this page.')
    st(163,'Name: __________________________________________')
    st(202,'Date: ______________   Reference: ______________')
    st(241,'Preferred response: [ ] Email    [ ] Post    [ ] Phone')
    st(293,'A. Please circle one of these marks:    A     B     C')
    st(334,'B. Please add a tick to this box:    [ ]')
    st(399,'Handwritten note:')
    for yy in [435,470,505]: d.line([(58,int(yy*S)),(int(w4*S)-62,int(yy*S))],fill=(154,154,149),width=2)
    st(569,'Signature: ____________________________________')
    st(638,'Expected: overlay text, tick, pen + PNG on a raster-only PDF page.')
    d.rectangle([(22,19),(scan.width-22,scan.height-24)],outline=(201,201,195),width=2)
    c.drawImage(ImageReader(scan),0,0,width=w4,height=h4)
    c.showPage();c.save()
    reader=PdfReader(str(raw)); writer=PdfWriter();writer.append(reader)
    # Page 3 can display 90-degree rotation while retaining original vector content.
    writer.pages[2].rotate(90)
    writer.add_metadata({'/Title':'Paperwork Lab - Synthetic Acceptance PDF', '/Author':'Synthetic Fixtures', '/Subject':'PDF form and overlay interoperability only'})
    with (HERE/'paperwork-lab-interactive-mixed.pdf').open('wb') as out:writer.write(out)
    raw.unlink()
    # negative: correct PDF, encrypted and impossible to edit without password
    neg=PdfWriter();neg.add_blank_page(width=595,height=842);neg.encrypt('paperwork-demo-only')
    with (HERE/'negative-password-protected.pdf').open('wb') as out:neg.write(out)
    # distinct broken container, tests graceful failure of decode path
    (HERE/'negative-truncated.pdf').write_bytes((HERE/'paperwork-lab-interactive-mixed.pdf').read_bytes()[:160])
    return areas

def generate_manifest(areas):
    field_expect = {
      'full_name': {'type':'/Tx','initial':'Jordan Example','test_value':'Alex Example'},
      'reference_code': {'type':'/Tx','initial':'LAB-0042','test_value':'LAB-0077','max_length':12},
      'contact_email': {'type':'/Tx','initial':'','test_value':'alex@example.invalid'},
      'immutable_id': {'type':'/Tx','initial':'SYNTH-LOCK-001','test_value':'SYNTH-LOCK-001','read_only':True},
      'comments': {'type':'/Tx','initial':'Replace this sample note.','test_value':'First line of a fictional note.\nSecond line after edit.'},
      'subscribe': {'type':'/Btn','initial':'/Off','test_value':'/Yes'},
      'terms_seen': {'type':'/Btn','initial':'/Yes','test_value':'/Off'},
      'contact_method': {'type':'/Btn','initial':'/Email','test_value':'/InPerson'},
      'delivery_window': {'type':'/Ch','initial':'Afternoon','test_value':'Evening'},
      'document_type': {'type':'/Ch','initial':'Request','test_value':'Follow-up'},
      'case_note': {'type':'/Tx','initial':'Editable even after drawing','test_value':'Still editable after pen and signature'},
    }
    tests=[
      {'id':'fields-roundtrip','page':1,'actions':'Edit all editable native fields, toggle checks twice, change radio, dropdown and list twice; export and reopen.','assert':'All expected AcroForm /V values AND appearances survive in PDF.js and independent viewer. Read-only ID unchanged.'},
      {'id':'mixed-edits','page':2,'actions':'Edit case_note, draw strokes, erase one, undo/redo, add/move text and tick, import demo-signature-transparent.png, resize and move.','assert':'No native value or overlay disappears on tool/page switches; exported appearance matches editor.'},
      {'id':'rotated-coordinates','page':3,'actions':'At rotated 90-degree page, place three X strokes and text at labelled targets, zoom, export.','assert':'All are at intended displayed locations with no mirrored or shifted stroke/signature geometry.'},
      {'id':'raster-overlays','page':4,'actions':'Fill apparent printed boxes using overlay tools; select/correct and export.','assert':'Raster background remains intact; additions survive independent PDF viewer.'},
      {'id':'privacy-network','page':'all','actions':'With browser Network recording, open sample, draw, import PNG, save and print.','assert':'No document/signature bytes transmitted or silently persisted. Host may load ordinary app assets.'},
      {'id':'negative-encrypted','file':'negative-password-protected.pdf','actions':'Open with no password.','assert':'Clear unsupported/password notice; no blank export falsely reported as complete.'},
      {'id':'negative-truncated','file':'negative-truncated.pdf','actions':'Open corrupted file.','assert':'Clear load error; existing unrelated unsaved document work preserved.'},
      {'id':'print-completed','page':'all','actions':'Print from editor after edits.','assert':'Print preview uses completed PDF. Saved or printed PDF agrees with independent viewer.'},
    ]
    manifest={'fixture_version':'1.0.0','synthetic_only':True,'fixture':'paperwork-lab-interactive-mixed.pdf','signature':'demo-signature-transparent.png',
     'pages':[{'page':1,'size':'A4 portrait','rotation':0,'kind':'AcroForm'},
              {'page':2,'size':'A4 portrait','rotation':0,'kind':'mixed interactive + flat'},
              {'page':3,'size':'A4 authored landscape','rotation':90,'kind':'rotated vector flat page'},
              {'page':4,'size':'US Letter portrait','rotation':0,'kind':'simulated raster scan'}],
     'fields':field_expect,'page2_overlay_targets':[{'id':k,'pdf_bbox':v} for k,v,*_ in areas],
     'test_cases':tests,'limits':['Not a genuine XFA fixture; genuine samples need separate vetted test documents.','Does not test live personal data or legally meaningful signatures.','Browser interaction success is not proof of PDF interoperability.']}
    (HERE/'fixture-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (HERE/'expected-fields-example.json').write_text(json.dumps({k:v['test_value'] for k,v in field_expect.items()},indent=2)+'\n')
    sha={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in HERE.iterdir() if p.is_file() and p.name.startswith(('paperwork-','negative-','demo-','fixture-','expected-'))}
    (HERE/'SHA256SUMS.json').write_text(json.dumps(sha,indent=2)+'\n')

def main():
    sig=make_demo_signature(); areas=build_pdf(sig);generate_manifest(areas)
    r=PdfReader(HERE/'paperwork-lab-interactive-mixed.pdf')
    assert len(r.pages)==4
    d=r.get_fields() or {}
    assert len(d)==11, [(k,v.get('/FT')) for k,v in d.items()]
    assert r.pages[2].get('/Rotate')==90
    assert r.pages[3].get('/Annots') is None
    print('Fixture generated:',len(r.pages),'pages,',len(d),'named fields')
    for k,v in d.items():print(' ',k,v.get('/FT'),v.get('/V'))

if __name__=='__main__':main()
