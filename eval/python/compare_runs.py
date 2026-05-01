import csv,statistics,sys
from pathlib import Path
output=sys.argv[1]; run_dirs=[Path(p) for p in sys.argv[2:]]
def parse_request(path):
 d={}
 if not path.exists(): return d
 for line in path.read_text(encoding='utf-8').splitlines():
  if '=' in line:
   k,v=line.split('=',1); d[k.strip()]=v.strip()
 return d
rows=[]
for rd in run_dirs:
 st=rd/'summary.tsv'
 if not st.exists(): raise SystemExit(f"run directory is missing summary.tsv: {rd}")
 req=parse_request(rd/'request.txt')
 data=list(csv.DictReader(st.open(encoding='utf-8'),delimiter='\t'))
 ok=[r for r in data if r.get('http_code')=='200']
 tt=[float(r['time_total']) for r in ok if r.get('time_total')]
 tps=[float(r['tokens_per_sec']) for r in ok if r.get('tokens_per_sec')]
 rows.append({'run_dir':str(rd),'model':req.get('model',''),'avg_time_total_sec':f"{statistics.mean(tt):.3f}" if tt else '','avg_completion_tokens_per_sec':f"{statistics.mean(tps):.3f}" if tps else ''})
fields=['run_dir','model','avg_time_total_sec','avg_completion_tokens_per_sec']
out=sys.stdout if output in ('','-') else open(output,'w',encoding='utf-8',newline='')
w=csv.DictWriter(out,fieldnames=fields); w.writeheader(); w.writerows(rows)
if out is not sys.stdout: out.close()
