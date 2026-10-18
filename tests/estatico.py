#!/usr/bin/env python3
"""Verificação estática do PHP do LearnPack (não precisa de PHP instalado).
Uso:  python3 tests/estatico.py        (a partir da pasta do projeto)
Faz: (1) funções duplicadas entre arquivos incluídos juntos; (2) chamadas com número de argumentos
incompatível com a definição; (3) variáveis possivelmente usadas sem definição (revisão manual:
desestruturação [$a,$b] = … e parâmetros por referência, como preg_match, podem aparecer como falso positivo)."""
import os, re, glob, sys, collections
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
files=['api.php','install.php','index.php','portal.php','acessivel.php']+glob.glob('inc/*.php')
def strip(src):
    """troca strings e comentários por marcadores, preservando estrutura; devolve texto limpo"""
    out=[];i=0;n=len(src)
    while i<n:
        c=src[i]
        if src.startswith('//',i) or c=='#' and not src.startswith('#[',i):
            j=src.find('\n',i); j=n if j<0 else j; i=j; continue
        if src.startswith('/*',i):
            j=src.find('*/',i+2); i=(n if j<0 else j+2); continue
        if c in '\'"':
            q=c;j=i+1
            while j<n and src[j]!=q:
                j+=2 if src[j]=='\\' else 1
            out.append('S'); 
            # strings "..." com {$x} interpolado: ignora (raro)
            i=j+1; continue
        out.append(c); i+=1
    return ''.join(out)
defs={}
srcs={}
for f in files:
    s=open(f,encoding='utf-8',errors='replace').read(); t=strip(s); srcs[f]=t
    for m in re.finditer(r'\bfunction\s+([A-Za-z_]\w*)\s*\(',t):
        k=m.end(); d=1; j=k
        while d and j<len(t):
            d+= (t[j]=='(')-(t[j]==')'); j+=1
        params=t[k:j-1]; parts=[];dd=0;cur=''
        for ch in params:
            if ch in '([{': dd+=1
            if ch in ')]}': dd-=1
            if ch==',' and dd==0: parts.append(cur); cur=''
            else: cur+=ch
        if cur.strip(): parts.append(cur)
        req=sum(1 for p in parts if '=' not in p and '...' not in p); var=any('...' in p for p in parts)
        defs.setdefault(m.group(1),[]).append((f,req,len(parts),var))
bad=0
for f,t in srcs.items():
    for m in re.finditer(r'(?<![>\w$:\\])([A-Za-z_]\w*)\s*\(',t):
        n=m.group(1)
        if n not in defs or n in('function','fn','if','for','foreach','while','switch','catch','array','list','isset','empty','unset','match'): continue
        pre=t[max(0,m.start()-9):m.start()]
        if re.search(r'function\s*&?\s*$',pre): continue
        k=m.end(); d=1; j=k
        while d and j<len(t):
            d+= (t[j] in '([{')-(t[j] in ')]}'); j+=1
        inner=t[k:j-1]
        if not inner.strip(): cnt=0
        else:
            cnt=1;dd=0
            for ch in inner:
                if ch in '([{': dd+=1
                elif ch in ')]}': dd-=1
                elif ch==',' and dd==0: cnt+=1
            if inner.rstrip().endswith(','): cnt-=1
        if '...' in inner or re.search(r'(^|,)\s*\w+\s*:(?!:)',inner): continue
        _,req,tot,var=defs[n][0]
        if cnt<req or (cnt>tot and not var):
            line=t[:m.start()].count('\n')+1; bad+=1; print('%s:%d  %s() chamada com %d arg(s); espera %d..%d'%(f,line,n,cnt,req,tot))
print('\nFunções do projeto:',len(defs),'| chamadas com aridade suspeita:',bad)

_d=collections.defaultdict(list)
for f in files:
    for m in re.finditer(r'^\s*function\s+([A-Za-z_0-9]+)',open(f,encoding='utf-8').read(),re.M): _d[m.group(1)].append(f)
dups={k:v for k,v in _d.items() if len(v)>1}
print('Funções duplicadas:',dups or 'nenhuma')
SUPER={'this','_GET','_POST','_SERVER','_SESSION','_COOKIE','_FILES','GLOBALS','argv','_ENV','_REQUEST'}
res=[]
for f in files:
    t=strip(open(f,encoding='utf-8',errors='replace').read())
    for m in re.finditer(r'\bfunction\s+([A-Za-z_]\w*)\s*\(',t):
        j=t.find('{',m.end()); 
        if j<0: continue
        # parâmetros
        k=m.end(); d=1; p=k
        while d and p<len(t): d+=(t[p]=='(')-(t[p]==')'); p+=1
        params=set(re.findall(r'\$(\w+)',t[k:p-1]))
        # corpo
        d=0;e=j
        while e<len(t):
            d+=(t[e]=='{')-(t[e]=='}'); e+=1
            if d==0: break
        body=t[j:e]
        defined=set(params)|set(re.findall(r'\$(\w+)\s*(?:=|\.=|\+=|-=|\?\?=|\+\+|--|\[[^\]]*\]\s*=)',body))
        defined|=set(re.findall(r'\bas\s+(?:\$\w+\s*=>\s*)?&?\$(\w+)',body))|set(re.findall(r'=>\s*&?\$(\w+)\s*\)',body))
        for g in re.findall(r'\blist\s*\(([^)]*)\)|\[([^\]=]*)\]\s*=(?!=)',body):
            for x in g: defined|=set(re.findall(r'\$(\w+)',x))
        defined|=set(re.findall(r'catch\s*\([^)]*\$(\w+)\)',body))|set(re.findall(r'\buse\s*\(([^)]*)\)',body) and re.findall(r'\$(\w+)',' '.join(re.findall(r'\buse\s*\(([^)]*)\)',body))))
        defined|=set(re.findall(r'(?:global|static)\s+\$(\w+)',body))
        # parâmetros de closures/fn dentro do corpo
        for c in re.finditer(r'\b(?:function|fn)\s*\(([^)]*)\)',body): defined|=set(re.findall(r'\$(\w+)',c.group(1)))
        used=set(re.findall(r'\$(\w+)',body))
        und=sorted(u for u in used-defined if u not in SUPER)
        if und: res.append((f,m.group(1),t[:m.start()].count('\n')+1,und))
print('\nVariáveis possivelmente indefinidas (revisar):')
for r in res: print('%s:%d %s() -> %s'%(r[0],r[2],r[1],', '.join('$'+x for x in r[3][:8])))
print(len(res),'funções com possíveis variáveis não definidas')

sys.exit(1 if dups or bad else 0)
