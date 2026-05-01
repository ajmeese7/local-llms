import json,sys
from pathlib import Path
p=Path(sys.argv[1]); run_id,http_code=sys.argv[2],sys.argv[3]
time_total=float(sys.argv[4]); ttft=float(sys.argv[5]); rp=Path(sys.argv[6]); mode=sys.argv[7]
pt=ct=tot=out=tps=""
if rp.exists():
  try:
    d=json.loads(rp.read_text()); u=d.get('usage') or {}
    pt=u.get('prompt_tokens',''); ct=u.get('completion_tokens',''); tot=u.get('total_tokens','')
    text=''; ch=d.get('choices') or []
    if ch:
      c=ch[0]
      if mode=='chat':
        msg=c.get('message') or {}; content=msg.get('content','')
        if isinstance(content,list): text=''.join(part.get('text','') for part in content if isinstance(part,dict))
        else: text=str(content)
      else: text=str(c.get('text',''))
    out=len(text)
    if ct not in ('',None) and time_total>0: tps=f"{float(ct)/time_total:.3f}"
  except Exception: pass
with p.open('a',encoding='utf-8') as f:
  f.write("\t".join([run_id,http_code,f"{time_total:.3f}",f"{ttft:.3f}",str(pt),str(ct),str(tot),str(out),str(tps)])+"\n")
