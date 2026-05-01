import json,sys
try: payload=json.load(sys.stdin)
except json.JSONDecodeError as exc: raise SystemExit(f"could not parse /v1/models response as JSON: {exc}")
ids=[i.get('id') for i in payload.get('data',[]) if isinstance(i,dict) and i.get('id')]
if not ids: raise SystemExit('no model ids found in /v1/models response')
print('\n'.join(ids))
