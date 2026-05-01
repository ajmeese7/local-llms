import json,sys
mode,model,prompt,max_tokens,temperature=sys.argv[1:]
payload={"model":model,"max_tokens":int(max_tokens),"temperature":float(temperature)}
if mode=='chat': payload['messages']=[{"role":"user","content":prompt}]
elif mode=='completions': payload['prompt']=prompt
else: raise SystemExit(f"unsupported mode: {mode}")
print(json.dumps(payload))
