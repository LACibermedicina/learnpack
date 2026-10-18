try{var s=JSON.parse(localStorage.getItem('ec')||'null'),r=document.documentElement;if(s){r.dataset.theme=s.theme||'claro';r.style.setProperty('--fs',s.fs+'px');r.style.setProperty('--lh',s.lh);r.style.setProperty('--ls',s.ls+'em')}}catch(e){}
try{if(localStorage.getItem('ec_tools')==='0')document.documentElement.classList.add('std')}catch(e){}
