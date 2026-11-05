import json,sys,numpy as np,base64
src,out,K=sys.argv[1],sys.argv[2],int(sys.argv[3])
S=json.load(open(src))["samples"]
by={}
for s in S: by.setdefault(s["c"],[]).append(s["v"])
rng=np.random.default_rng(0); protos=[]
for c,vs in sorted(by.items()):
    X=np.array(vs,dtype=np.float32); k=min(K,len(X))
    C=X[rng.choice(len(X),k,replace=False)]
    for it in range(15):
        d=((X[:,None,:]-C[None,:,:])**2).sum(-1); a=d.argmin(1)
        for j in range(k):
            m=X[a==j]
            if len(m): C[j]=m.mean(0)
    cnt=np.bincount(a,minlength=k)
    for j in range(k):
        if cnt[j]: protos.append((c,C[j]))
dim=len(protos[0][1]); q=np.clip(np.round(np.array([p[1] for p in protos])*100),0,255).astype(np.uint8)
json.dump({"version":1,"source":"synthetic","grid":16,"dim":dim,"scale":100,"labels":"".join(p[0] for p in protos),"data":base64.b64encode(q.tobytes()).decode()},open(out,"w"))
print(len(protos),dim)
