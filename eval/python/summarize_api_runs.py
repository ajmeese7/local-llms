import csv,statistics,sys
from pathlib import Path
rows=list(csv.DictReader(Path(sys.argv[1]).open(encoding='utf-8'),delimiter='\t'))
if not rows: raise SystemExit('no API benchmark rows found')
ok=[r for r in rows if r['http_code']=='200']
def avgf(k):
 v=[float(r[k]) for r in ok if r[k]]; return statistics.mean(v) if v else None
def avgi(k):
 v=[int(float(r[k])) for r in ok if r[k]]; return statistics.mean(v) if v else None
lines=[f"runs: {len(rows)}",f"successful_runs: {len(ok)}"]
if ok:
 for k,n,f in [('time_total','avg_time_total_sec','{:.3f}'),('time_starttransfer','avg_ttft_sec','{:.3f}'),('prompt_tokens','avg_prompt_tokens','{:.1f}'),('completion_tokens','avg_completion_tokens','{:.1f}'),('total_tokens','avg_total_tokens','{:.1f}')]:
  v=avgf(k) if 'time' in k else avgi(k)
  if v is not None: lines.append(f"{n}: "+f.format(v))
 v=avgf('tokens_per_sec')
 if v is not None: lines.append(f"avg_completion_tokens_per_sec: {v:.3f}")
Path(sys.argv[2]).write_text('\n'.join(lines)+'\n',encoding='utf-8')
