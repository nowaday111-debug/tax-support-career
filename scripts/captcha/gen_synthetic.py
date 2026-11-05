import random, sys, os, json
# Sinh captcha TỔNG HỢP giống captcha dichvucong (150x38, nền chuyển màu, 5 ký tự a-z0-9 đậm, nhiễu chải)
# để tạo mẫu khởi tạo cho dvc/captcha/model.json. Dùng: python3 gen_synthetic.py <số ảnh> <thư mục ra> <seed>
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
import numpy as np
FONTS=["/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf","/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf",
"/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf","/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf",
"/usr/share/fonts/truetype/freefont/FreeSansBold.ttf","/usr/share/fonts/truetype/freefont/FreeSansBoldOblique.ttf",
"/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf","/usr/share/fonts/truetype/crosextra/Carlito-BoldItalic.ttf",
"/usr/share/fonts/opentype/inter/Inter-Bold.otf","/usr/share/fonts/opentype/inter/Inter-BoldItalic.otf"]
CS="abcdefghijklmnopqrstuvwxyz0123456789"
def glyph(ch,font,rng,sz):
    f=ImageFont.truetype(font,sz)
    im=Image.new("L",(60,60),0); d=ImageDraw.Draw(im)
    d.text((14,42),ch,font=f,fill=255,anchor="ls")
    # nhiễu chải: các vạch mảnh màu nền xuyên qua nét chữ
    if rng.random()<0.5: im=im.filter(ImageFilter.MaxFilter(3))
    a=np.array(im).astype(float)/255
    tex=Image.new("L",(60,60),255); td=ImageDraw.Draw(tex)
    for _ in range(rng.randint(40,110)):
        x=rng.uniform(0,60); y=rng.uniform(0,60); ang=rng.uniform(0,np.pi); L=rng.uniform(3,9)
        td.line([(x,y),(x+L*np.cos(ang),y+L*np.sin(ang))],fill=rng.randint(60,220),width=1)
    a=a*(np.array(tex)/255.0)**rng.uniform(0.5,1.2)
    im=Image.fromarray((a*255).astype(np.uint8)).rotate(rng.uniform(-10,10),resample=Image.BILINEAR,center=(22,36))
    sx=rng.uniform(0.95,1.25)
    im=im.resize((int(60*sx),60),Image.BILINEAR)
    return im
def captcha(text,rng):
    W,H=150,38
    lo,hi=rng.uniform(185,205),rng.uniform(240,252)
    if rng.random()<0.2: lo,hi=hi,lo
    bg=np.tile(np.linspace(lo,hi,W),(H,1))
    ink=Image.new("L",(W,H),0)
    x=rng.randint(30,42); sz=rng.randint(28,32); base=rng.randint(26,30); font=rng.choice(FONTS)
    for ch in text:
        if rng.random()<0.3: font=rng.choice(FONTS)
        g=glyph(ch,font,rng,sz+rng.randint(-1,1))
        bb=g.getbbox()
        if not bb: continue
        gw=bb[2]-bb[0]
        y=base-42+rng.randint(-1,1)
        ink=ImageChops.lighter(ink, Image.new("L",(W,H),0)) 
        tmp=Image.new("L",(W,H),0); tmp.paste(g,(x-bb[0],y)); ink=ImageChops.lighter(ink,tmp)
        x+=gw+rng.randint(1,5)
    ink=ink.filter(ImageFilter.GaussianBlur(rng.uniform(0.3,0.8)))
    a=np.array(ink)/255.0
    out=bg*(1-a)+rng.uniform(0,30)*a
    out=np.clip(out+np.random.default_rng(rng.randint(0,1<<30)).normal(0,2,out.shape),0,255).astype(np.uint8)
    out[0,:]=out[-1,:]=0; out[:,0]=out[:,-1]=0
    return Image.fromarray(out).convert("RGB")
n=int(sys.argv[1]); outd=sys.argv[2]; seed=int(sys.argv[3]); os.makedirs(outd,exist_ok=True)
rng=random.Random(seed); lab={}
for i in range(n):
    t="".join(rng.choice(CS) for _ in range(5))
    im=captcha(t,rng); fn=f"s{seed}_{i}"; im.save(f"{outd}/{fn}.png"); lab[fn]=t
json.dump(lab,open(f"{outd}/labels.json","w"))
