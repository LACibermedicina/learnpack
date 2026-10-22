'use strict';
/* LearnPack — SPA em JavaScript puro (sem framework, sem CDN). Todo texto entra via textContent. */
const $ = (s, r = document) => r.querySelector(s);
const el = (t, a = {}, ...k) => {
  const e = document.createElement(t);
  for (const [n, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (n === 'class') e.className = v;
    else if (n.startsWith('on')) e.addEventListener(n.slice(2), v);
    else e.setAttribute(n, v === true ? '' : v);
  }
  for (const c of k.flat(9)) e.append(c && c.nodeType ? c : document.createTextNode(c ?? ''));
  return e;
};
const S = { user: null, csrf: '', name: 'LearnPack', prefs: { theme: 'claro', fs: 22, lh: 1.7, ls: 0.02, tts: 0, rate: 1, a11y: 1 } };
let cleanup = null, uid = 0;
const view = $('#view'), live = $('#live');

/* ---------- rede ---------- */
async function api(r, { body, qs } = {}) {
  const o = { credentials: 'same-origin', headers: { 'X-CSRF': S.csrf } };
  if (body !== undefined) { o.method = 'POST'; o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
  const res = await fetch('api.php?r=' + r + (qs ? '&' + new URLSearchParams(qs) : ''), o);
  const j = await res.json().catch(() => ({ error: 'Resposta inválida do servidor.' }));
  if (!res.ok) throw Object.assign(new Error(j.error || 'Erro'), { status: res.status });
  return j;
}
async function apiRaw(r, qs, blob) {
  const res = await fetch('api.php?r=' + r + '&' + new URLSearchParams(qs), { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF': S.csrf, 'Content-Type': 'application/octet-stream' }, body: blob });
  const j = await res.json().catch(() => ({ error: 'Resposta inválida do servidor.' })); if (!res.ok) throw new Error(j.error || 'Erro no envio'); return j;
}
const notify = (t) => { live.replaceChildren(t ? el('div', { class: 'msg' }, t) : ''); };

/* ---------- preferências de leitura ---------- */
function applyPrefs() {
  const p = S.prefs, r = document.documentElement;
  r.dataset.theme = p.theme; r.style.setProperty('--fs', p.fs + 'px'); r.style.setProperty('--lh', p.lh); r.style.setProperty('--ls', p.ls + 'em');
  localStorage.setItem('ec', JSON.stringify(p));
}
let saveT;
function setPref(k, v, save = true) {
  S.prefs[k] = v; applyPrefs();
  if (S.user && save) { clearTimeout(saveT); saveT = setTimeout(() => api('prefs', { body: S.prefs }).catch(() => {}), 400); }
}
const TTS = { text: '', idx: 0, emu: false };
function ttsOn() { const w = 'speechSynthesis' in window; return { speaking: w && (speechSynthesis.speaking || speechSynthesis.pending), paused: TTS.emu || (w && speechSynthesis.paused) }; }
function ttsSync() { const on = ttsOn(); document.querySelectorAll('[data-act="pause"]').forEach((b) => { b.textContent = on.paused ? '▶ Continuar' : '⏸ Pausar'; b.setAttribute('aria-pressed', String(on.paused)); b.setAttribute('aria-label', on.paused ? 'Continuar a leitura' : 'Pausar a leitura'); b.disabled = !on.speaking && !on.paused; }); }
function say(t, from = 0) {
  if (!('speechSynthesis' in window) || !t) return;
  TTS.emu = false; speechSynthesis.cancel(); speechSynthesis.resume(); TTS.text = t; TTS.idx = from;
  const u = new SpeechSynthesisUtterance(t.slice(from)); u.lang = 'pt-BR'; u.rate = S.prefs.rate;
  u.onboundary = (e) => { TTS.idx = from + e.charIndex; }; u.onstart = ttsSync; u.onend = u.onerror = () => { if (!TTS.emu) ttsSync(); };
  speechSynthesis.speak(u); setTimeout(ttsSync, 80);
}
function ttsPause() {
  if (!('speechSynthesis' in window)) return;
  if (TTS.emu) { TTS.emu = false; say(TTS.text, TTS.idx || 0); return; }
  if (speechSynthesis.paused) { speechSynthesis.resume(); ttsSync(); return; }
  if (!speechSynthesis.speaking) return;
  speechSynthesis.pause();
  setTimeout(() => { if (!speechSynthesis.paused) { const i = TTS.idx || 0; speechSynthesis.cancel(); TTS.emu = true; TTS.idx = i; } ttsSync(); }, 200);  // navegadores sem pausa real: guarda a posição e retoma dali
  ttsSync();
}
function ttsStop() { TTS.emu = false; if ('speechSynthesis' in window) { speechSynthesis.cancel(); speechSynthesis.resume(); } ttsSync(); }
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act],[data-speak]'); if (!b) return;
  if (b.dataset.speak) { say(b.dataset.speak.startsWith('#') ? $(b.dataset.speak)?.innerText : b.dataset.speak); return; }
  const a = b.dataset.act;
  if (a === 'fs+') setPref('fs', Math.min(48, S.prefs.fs + 2));
  if (a === 'fs-') setPref('fs', Math.max(16, S.prefs.fs - 2));
  if (a === 'theme') setPref('theme', { claro: 'noite', noite: 'azul', azul: 'claro' }[S.prefs.theme] || 'claro');
  if (a === 'read') say($('#view').innerText);
  if (a === 'stop') ttsStop();
  if (a === 'pause') ttsPause();
  if (a === 'auto') { autoRead = !autoRead; localStorage.setItem('ecr', autoRead ? '1' : '0'); b.setAttribute('aria-pressed', String(autoRead)); say(autoRead ? 'Leitura ao focar ligada.' : 'Leitura ao focar desligada.'); }
});

/* Links internos (#/...) tratados aqui: sem recarregar a página e sem abrir o app dentro de si mesmo quando embutido em moldura/iframe. */
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey) return;
  const h = a.getAttribute('href'); e.preventDefault();
  if (h.startsWith('#/')) { if (location.hash === h) render(); else location.hash = h; }
  else { const t = document.getElementById(h.slice(1)); if (t) { t.focus(); t.scrollIntoView(); } }
});
/* Ler ao focar: fala o texto do item que recebe o foco (teclado ou toque) */
let autoRead = localStorage.getItem('ecr') === '1';
document.querySelector('[data-act=auto]')?.setAttribute('aria-pressed', String(autoRead));
document.addEventListener('focusin', (e) => { if (!autoRead) return; const t = e.target; if (!t.matches || t.matches('input,textarea,select')) return; const x = t.getAttribute('aria-label') || t.innerText; if (x) say(x.trim().slice(0, 300)); });

const ED = () => (document.body.classList.contains('portal') ? 'portal' : document.body.classList.contains('acc') ? 'acessivel' : '');
function choose(ed) {
  try { localStorage.setItem('ec_ed', ed); document.cookie = 'ed=' + ed + ';max-age=31536000;path=' + location.pathname.replace(/[^/]*$/, '') + ';samesite=lax'; } catch { /* sem armazenamento */ }
  if (window.PREVIEW) { document.body.classList.remove('portal', 'acc'); document.body.classList.add(ed === 'portal' ? 'portal' : 'acc'); buildNav(); location.hash = '#/'; render(); }
  else location.href = ed === 'portal' ? 'portal.php' : 'acessivel.php';
}
const LOGO = window.LOGO_SRC || 'assets/mark.svg';
const toolsOn = () => { const v = localStorage.getItem('ec_tools'); if (v !== null) return v === '1'; return !(S.prefs && S.prefs.a11y === 0); };   // padrão: acessibilidade LIGADA
function applyTools() {
  const on = toolsOn(); document.body.classList.toggle('tools-off', !on); document.documentElement.classList.toggle('std', !on); const t = $('#a11ytoggle');
  if (t) { t.setAttribute('aria-expanded', String(on)); t.textContent = on ? '♿ Ocultar acessibilidade' : '♿ Mostrar acessibilidade'; }
}
function toggleTools() { const next = !toolsOn(); localStorage.setItem('ec_tools', next ? '1' : '0'); S.prefs.a11y = next ? 1 : 0; if (S.user) setPref('a11y', next ? 1 : 0); applyTools(); }
$('#a11ytoggle')?.addEventListener('click', () => { toggleTools(); render(true); });
document.addEventListener('pointerdown', (e) => {   // ondinha de toque nos botões
  const b = e.target.closest && e.target.closest('button,.btn'); if (!b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = b.getBoundingClientRect(), s = el('span', { class: 'rip', 'aria-hidden': 'true' }); s.style.left = (e.clientX - r.left) + 'px'; s.style.top = (e.clientY - r.top) + 'px'; b.append(s); setTimeout(() => s.remove(), 650);
});
async function logout() { await api('logout', { body: {} }); localStorage.removeItem('ecu'); await boot(); location.hash = '#/'; render(); }
const b64file = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(f); });
document.getElementById('search')?.addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/explorar?q=' + encodeURIComponent($('#q').value); });

/* ---------- auxiliares de interface ---------- */
const btn = (label, onclick, cls = '') => el('button', { type: 'button', class: cls, onclick }, label);
const link = (label, href, cls = 'alt') => el('a', { class: 'btn ' + cls, href }, label);
const speak = (label, target) => el('button', { type: 'button', class: 'alt', 'data-speak': target }, label);
const pausa = () => el('button', { type: 'button', class: 'alt pausa', 'data-act': 'pause', 'aria-label': 'Pausar a leitura', 'aria-pressed': 'false', disabled: true }, '⏸ Pausar');
const ouvir = (t, who = '') => el('button', { type: 'button', class: 'alt ouvir', 'data-speak': t, 'aria-label': 'Ouvir ' + (who || t.slice(0, 50)) }, '🔊');
function field(label, name, o = {}) {
  const i = 'f' + (++uid), ta = o.tag === 'textarea';
  const inp = el(o.tag || 'input', { id: i, name, type: ta ? null : (o.type || 'text'), required: o.req, autocomplete: o.ac, minlength: o.min, placeholder: o.ph, rows: o.rows, value: ta ? null : o.value, class: o.cls }, ta ? (o.value || '') : []);
  return el('div', { class: 'f' }, el('label', { for: i }, label), inp);
}
function select(label, name, opts, cur) {
  const i = 'f' + (++uid);
  return el('div', { class: 'f' }, el('label', { for: i }, label), el('select', { id: i, name }, opts.map(([v, t]) => el('option', { value: v, selected: String(v) === String(cur) }, t))));
}
function form(children, onsubmit, reset = false) {
  return el('form', {
    onsubmit: async (e) => {
      e.preventDefault(); const f = e.target, b = $('button[type=submit]', f); if (b) b.disabled = true;
      try { await onsubmit(Object.fromEntries(new FormData(f)), f); if (reset) f.reset(); } catch (x) { notify(x.message); }
      if (b) b.disabled = false;
    }
  }, children);
}
const submit = (t, cls = '') => el('button', { type: 'submit', class: cls }, t);
const bar = (pc, label) => { const i = el('i'); i.style.width = pc + '%'; return el('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pc, 'aria-label': label }, i); };   // style via CSSOM (a CSP bloqueia style inline)

/* ---------- ajuste offline: notas pendentes ---------- */
const pend = () => { try { return JSON.parse(localStorage.getItem('ecp') || '[]'); } catch { return []; } };
async function flush() {
  const p = pend(); if (!p.length || !S.user) return;
  try { await api('grades', { body: { grades: p } }); localStorage.removeItem('ecp'); } catch { /* tenta de novo depois */ }
}
function queueGrade(card, grade) { localStorage.setItem('ecp', JSON.stringify([...pend(), { card, grade, ts: Math.floor(Date.now() / 1000) }])); flush(); }
addEventListener('online', flush);

/* ---------- autenticação ---------- */
async function boot() {
  try {
    const b = await api('boot'); S.csrf = b.csrf; S.name = b.name; S.user = b.user; S.editions = b.editions; S.game = b.game; S.graph = b.graph;
    if (b.user) { S.prefs = b.user.prefs; localStorage.setItem('ecu', JSON.stringify(b.user)); } else localStorage.removeItem('ecu');
  } catch (e) {
    const u = localStorage.getItem('ecu'); if (u && !e.status) { S.user = JSON.parse(u); S.offline = true; }   // sem rede: usa o último usuário conhecido
    else throw e;
  }
  applyPrefs(); buildNav(); flush();
}
async function enter(fn) { await fn(); notify(''); await boot(); location.hash = '#/'; render(); }

const NAVM = ['full', 'icons', 'hidden'], NAVL = { full: 'Menu com texto', icons: 'Menu só ícones', hidden: 'Menu oculto' };
const navGet = () => { let m = null; try { m = localStorage.getItem('ec_nav'); } catch (e) {} return NAVM.includes(m) ? m : 'full'; };
function navApply() { const m = navGet(), c = document.body.classList; c.toggle('nav-icons', m === 'icons'); c.toggle('nav-hidden', m === 'hidden'); const b = $('#navtoggle'); if (b) { b.textContent = '☰ ' + NAVL[m]; b.setAttribute('aria-label', NAVL[m] + '. Alternar entre texto, ícones e oculto'); b.setAttribute('aria-expanded', String(m !== 'hidden')); } }
function navCycle() { const n = NAVM[(NAVM.indexOf(navGet()) + 1) % 3]; try { localStorage.setItem('ec_nav', n); } catch (e) {} navApply(); notify(NAVL[n]); }
function buildNav() {
  const n = $('#nav'); n.replaceChildren(); hud(); applyTools(); document.body.classList.add('nonav'); document.body.classList.toggle('auth', !S.user);
  if (!S.user || !ED()) return;
  document.body.classList.remove('nonav');
  const it = (e, t, h) => el('a', { class: 'btn alt', href: h, title: t }, el('span', { class: 'ni', 'aria-hidden': 'true' }, e), el('span', { class: 'nl' }, t));
  if (ED() === 'acessivel') { n.append(it('🗺️', 'Trilha', '#/'), it('🃏', 'Revisar', '#/revisar/due'), it('📚', 'Resumos', '#/resumos'), it('🧭', 'Trilhas', '#/trilhas'), it('☰', 'Mais', '#/mais')); return; }
  if (ED() === 'portal') { if (!$('#navtoggle')) $('header .in').prepend(el('button', { id: 'navtoggle', class: 'alt', type: 'button', 'aria-controls': 'nav', onclick: navCycle })); navApply(); }
  n.append(it('🏠', 'Início', '#/'), it('🧭', 'Explorar', '#/explorar'), it('🃏', 'Revisar', '#/revisar/due'), it('🗺️', 'Minhas trilhas', '#/trilhas'), it('👥', 'Grupos', '#/grupos'), it('🗂️', 'Materiais', '#/materiais'), it('🎙️', 'Aulas', '#/aulas'), it('🕸️', 'Mapa', '#/grafo/0'), it('⚔️', 'Aventura', '#/aventura'), it('📚', 'Resumos', '#/resumos'), it('🏆', 'Conquistas', '#/conquistas'), it('⚙️', 'Ajustes', '#/ajustes'));
  if (S.user.role === 'admin') n.append(it('🛠️', 'Administração', '#/admin/users'));
  n.append(it('🔀', 'Trocar de versão', '#/versao'), el('button', { type: 'button', class: 'alt', onclick: logout }, el('span', { class: 'ni', 'aria-hidden': 'true' }, '🚪'), el('span', { class: 'nl' }, 'Sair (' + S.user.name + ')')));
}

/* ---------- telas ---------- */
function vHome(mode = '') {
  // tela de acesso: somente login (animado); “Sou novo usuário” leva às opções (tenho token / solicitar token)
  const back = (to, t) => el('p', {}, link(t, to));
  const panel = (id, t, ...c) => el('section', { class: 'box create-panel', id, 'aria-labelledby': id + '-t' }, el('h2', { id: id + '-t', tabindex: '-1' }, t), c);
  let body;
  if (mode === 'criar') body = panel('criar', 'Sou novo usuário', el('p', {}, 'Escolha como quer continuar:'), el('div', { class: 'choices' },
    el('a', { class: 'choice', href: '#/token' }, el('span', { class: 'ic', 'aria-hidden': 'true' }, '🔑'), el('strong', {}, 'Tenho um token'), el('span', { class: 'd' }, 'Recebi um código de convite e quero criar a conta agora.')),
    el('a', { class: 'choice', href: '#/pedir' }, el('span', { class: 'ic', 'aria-hidden': 'true' }, '✉️'), el('strong', {}, 'Solicitar token de acesso'), el('span', { class: 'd' }, 'Ainda não tenho token: peço ao administrador.'))), back('#/entrar', '← Voltar ao login'));
  else if (mode === 'token') body = panel('token', 'Criar conta com token', el('p', {}, 'Digite o token recebido para liberar o seu cadastro.'),
    form([field('Token de acesso', 'token', { req: true, ac: 'off', ph: 'XXXX-XXXX', cls: 'tok' }), field('Seu nome', 'name', { req: true, ac: 'name' }), field('E-mail', 'email', { type: 'email', req: true, ac: 'email' }), field('Crie uma senha (mínimo 8 caracteres)', 'pass', { type: 'password', req: true, min: 8, ac: 'new-password' }), el('p', {}, submit('Cadastrar com token'))], (d) => enter(() => api('register', { body: d }))), back('#/criar', '← Voltar às opções'));
  else if (mode === 'pedir') body = panel('pedir', 'Solicitar token de acesso', el('p', {}, 'Conte quem você é. Quando o administrador aprovar, ele envia um token para o seu e-mail.'),
    form([field('Seu nome', 'name', { req: true, ac: 'name' }), field('E-mail', 'email', { type: 'email', req: true, ac: 'email' }), field('Mensagem (opcional)', 'msg', { tag: 'textarea', rows: 3 }), el('p', {}, submit('Enviar pedido'))],
      async (d, f) => { await api('request', { body: d }); f.reset(); notify('Pedido enviado. Quando for aprovado, o administrador enviará um token para o seu e-mail.'); }), back('#/criar', '← Voltar às opções'));
  else body = [el('section', { class: 'box login-card', id: 'entrar', 'aria-labelledby': 'entrar-t' }, el('h2', { id: 'entrar-t' }, 'Entrar'),
      form([field('E-mail', 'email', { type: 'email', req: true, ac: 'username' }), field('Senha', 'pass', { type: 'password', req: true, ac: 'current-password' }), el('p', {}, submit('Entrar'))], (d) => enter(() => api('login', { body: d })))),
    el('div', { class: 'cta-wrap' }, el('a', { class: 'cta-create', href: '#/criar', 'aria-expanded': 'false', 'aria-controls': 'criar' }, el('span', { class: 'spark', 'aria-hidden': 'true' }, '✨'), el('span', {}, 'Sou novo usuário')))];
  const fl = el('div', { class: 'floaty', 'aria-hidden': 'true' }, ['📖', '🃏', '⭐', '🗺️', '🎓', '✨', '🧩', '📜', '🏆', '💡'].map((e, k) => { const x = el('span', {}, e); x.style.setProperty('--x', (k * 10 + 3) + '%'); x.style.setProperty('--d', (7 + (k % 4) * 2) + 's'); x.style.setProperty('--w', (k * 0.9) + 's'); return x; }));
  return el('div', { class: 'auth' }, fl, el('div', { class: 'auth-head' }, el('span', { class: 'hero-emoji', 'aria-hidden': 'true' }, '🧙‍♀️'), el('h1', {}, S.name)), body,
    el('p', { class: 'auth-about' }, 'Trilhas de estudo com revisão ativa, IA e aventura: letras grandes, contraste alto e leitura em voz alta.'));
}

async function vDash() {
  const s = await api('stats'); S.user.xp = s.xp; hud(); checkAch(s, true);
  const L = lvInfo(s.xp), open = s.topics.map((t, i) => i === 0 || s.topics[i - 1].stars >= 1), cur = s.topics[Math.max(0, open.lastIndexOf(true))];
  return el('div', {},
    s.plan && s.plan.status !== 'ativa' ? el('div', { class: 'msg' }, '⏸️ Esta trilha está desativada: você pode ver o mapa e o conteúdo, mas não estudar até reativar. O tempo e as metas estão congelados.') : '',
    el('section', { class: 'box hero' }, el('h1', {}, ico('👋', 'wave'), ' Olá, ' + S.user.name),
      s.pkg ? el('p', {}, ico(s.pkg.emoji, 'bob'), ' Objetivo: ', el('b', {}, s.pkg.goal)) : '',
      el('p', {}, ico('🏆'), ' Nível ', el('b', {}, L.l + ' · ' + L.name), ' · ', ico('🔥', 'flame'), ' ', el('b', {}, s.streak), ' dias seguidos · ', ico('⭐'), ' ', el('b', {}, s.xp + ' XP')),
      bar(L.pc, 'Progresso para o próximo nível'), el('p', {}, 'Faltam ' + L.next + ' XP para o nível ' + (L.l + 1) + '. ', ouvir('Nível ' + L.l + ', ' + L.name + '. ' + s.xp + ' pontos. Faltam ' + L.next + ' pontos para o próximo nível. ' + s.streak + ' dias seguidos.')),
      el('div', { class: 'tools' }, cur ? link('▶️ Continuar: ' + cur.title, '#/topico/' + cur.id, 'big') : '', link('🃏 Revisar agora (' + s.due + ')', '#/revisar/due', 'alt big'), btn('📍 Onde parei', () => { const c = $('.node.cur'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 'alt big'), s.pkg ? link('📊 Painel e metas', '#/trilha/' + s.pkg.id, 'alt big') : '', link('🕸️ Mapa', '#/grafo/0', 'alt big'))),
    el('h2', {}, ico('🗺️'), ' Sua trilha até a aprovação'), trail(s.topics, s.weak, !!(s.plan && s.plan.status !== 'ativa')), weakBox(s), (ED() === 'portal' ? await communityStrip() : ''));
}
async function vTopics() {
  const t = await api('topics');
  return el('div', {}, el('h1', {}, 'Conteúdo'), el('p', {}, 'Leia o resumo em blocos curtos e depois teste a memória. Ler e testar juntos fixa mais do que reler.'),
    el('div', { class: 'grid' }, t.map((x) => el('div', { class: 'box' }, el('b', {}, el('a', { href: '#/topico/' + x.id }, x.title)), el('br'), x.law, el('br'), x.n + ' cartões', el('div', {}, ouvir(x.title + '. ' + x.law))))));
}

async function vTopic(id) {
  const t = await api('topic', { qs: { id } });
  return el('div', {}, el('h1', {}, ico(t.emoji || '📖', 'wig'), ' ', t.title), el('p', {}, el('b', {}, 'Base: '), t.law),
    t.chunks.map((c, i) => el('section', { class: 'box', 'aria-label': 'Bloco ' + (i + 1) }, el('p', { id: 'b' + i }, c), speak('Ouvir bloco', '#b' + i))),
    t.mnemonic ? el('section', { class: 'box mn' }, el('h2', {}, 'Para lembrar'), el('p', { id: 'mn' }, t.mnemonic), speak('Ouvir', '#mn')) : '',
    el('div', { class: 'tools' }, link('🃏 Testar minha memória neste assunto', '#/revisar/topic/' + id, 'big'), t.nv ? link('📚 Resumo visual', '#/resumo/' + id, 'big') : '', t.can_edit ? btn('✨ Gerar mais cartões (IA)', () => expandTopic(id).catch((e) => notify(e.message)), 'alt big') : '', link('Voltar', '#/topicos', 'alt big')));
}

function vStudy(mode, id) {
  const key = 'ecq:' + mode + ':' + (id || 0), G = S.game || {};
  let Q = [], i = 0, hit = 0, shown = false, streak = 0, offered = false;
  const qh = el('h2', { class: 'qz', tabindex: -1 }, ''), qt = el('p', { class: 'qz', id: 'qtxt' }), prog = el('p', { 'aria-live': 'polite' }), strk = el('span', { class: 'streak', 'aria-live': 'polite' });
  const topic = el('button', { type: 'button', class: 'alt topicbtn', onclick: () => toggleDeep() }, '');
  const ansP = el('p', { class: 'qz', id: 'a', tabindex: -1 }), ans = el('section', { class: 'box ans waiting' }, el('h2', {}, 'Resposta'), ansP, speak('Ouvir resposta', '#a'), pausa());
  const reveal = btn('Mostrar resposta (Espaço)', () => showAns(), 'big');
  const grades = el('div', { class: 'box', hidden: true }, el('p', {}, el('b', {}, 'Como foi? '), '(teclas 1 a 4)'),
    el('div', { class: 'grades' }, [['1 · Errei', 0, 'g0'], ['2 · Difícil', 1, 'g1'], ['3 · Bom', 2, 'g2'], ['4 · Fácil', 3, 'g3']].map(([t, g, c]) => btn(t, () => grade(g), c))));
  const bonus = el('div', { class: 'msg bonus', hidden: true }, el('b', {}, '🎮 Jogo bônus liberado! '), btn('Jogar agora (1 minuto)', () => playNow(), 'big'));
  const deepHost = el('div', { class: 'deephost' });
  const left = el('section', { class: 'box cardq' }, topic, qh, qt, speak('Ouvir pergunta', '#qtxt'), pausa(), el('p', {}, 'Tente responder em voz alta ou de cabeça antes de ver a resposta.'), reveal);
  const right = el('div', { class: 'sidecol' }, ans, grades, deepHost);
  const pb = el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i')), sess = el('div', { hidden: true }, el('div', { class: 'tools' }, link('Sair da revisão', '#/', 'alt'), prog, strk), pb, el('div', { class: 'study' }, left, right));
  const sum = el('h2', { tabindex: -1 }), free = el('div', {}, field('Recordação livre: escreva ou diga em voz alta tudo o que lembra deste bloco. Não é salvo.', 'free', { tag: 'textarea', rows: 4 }), el('p', {}, 'Se puder, faça uma pausa de 2 minutos antes de seguir.'));
  const end = el('section', { class: 'box party', hidden: true }, sum, free, btn('Próximo bloco', () => load(), 'big'), ' ', link('Voltar ao início', '#/', 'alt big'));
  const root = el('div', {}, el('h1', {}, 'Revisão ativa'), bonus, sess, end);
  const placeholder = 'A resposta aparece aqui depois que você tentar responder.';
  function updStreak() {
    const need = G.streak || 3; strk.textContent = G.on === false ? '' : '🔥 Acertos seguidos: ' + Math.min(streak, need) + '/' + need;
    if (G.on !== false && streak >= need) { bonus.hidden = false; if (!offered) { offered = true; toast('🎮 Jogo bônus liberado!'); burst(); } }
  }
  function playNow() {
    playBonus(G, async (res) => {
      streak = 0; offered = false; bonus.hidden = true; updStreak();
      try { const r = await api('game_result', { body: { game: res.game, score: res.score } }); if (r.xp) { S.user.xp = (S.user.xp || 0) + r.xp; hud(); toast('🎮 +' + r.xp + ' XP do jogo bônus!'); } else if (r.note) toast('ℹ️ ' + r.note); } catch { /* sem rede: o jogo é só diversão */ }
    });
  }
  function toggleDeep() {
    if (deepHost.firstChild) { deepHost.replaceChildren(); return; } const c = Q[i]; if (!c || !c.topic_id) return;
    deepHost.append(deepBox({ topic_id: c.topic_id, package_id: c.package_id, card_id: c.id, title: c.title }));
  }
  function show() {
    const c = Q[i]; shown = false; sess.hidden = false; end.hidden = true; deepHost.replaceChildren();
    prog.textContent = `Cartão ${i + 1} de ${Q.length}`; pb.firstChild.style.width = (i / Q.length * 100) + '%'; topic.textContent = '🔎 ' + c.title + ' · aprofundar'; topic.setAttribute('aria-label', 'Aprofundar o tópico ' + c.title); topic.hidden = !c.topic_id;
    qh.textContent = 'Pergunta'; qt.textContent = c.q; ansP.textContent = placeholder; ans.classList.add('waiting'); grades.hidden = true; reveal.hidden = false; qh.focus(); updStreak();
    if (S.prefs.tts) say(c.q);
  }
  function showAns() { if (shown) return; shown = true; ansP.textContent = Q[i].a; ans.classList.remove('waiting', 'pop'); void ans.offsetWidth; ans.classList.add('pop'); grades.hidden = false; reveal.hidden = true; ansP.focus(); if (S.prefs.tts) say('Resposta: ' + Q[i].a); }
  function grade(g) { if (!shown) return; queueGrade(Q[i].id, g); gain(g); if (g >= 2) { hit++; streak++; } else streak = 0; updStreak(); i++; i < Q.length ? show() : finish(); }
  function finish() {
    sess.hidden = true; end.hidden = false; free.hidden = !Q.length; $('textarea', free) && ($('textarea', free).value = '');
    sum.textContent = Q.length ? `Você acertou ${hit} de ${Q.length}. Antes de seguir, faça a recordação livre.` : 'Não há cartões pendentes agora. Volte mais tarde: o intervalo entre revisões é o que fixa a memória.';
    sum.focus(); if (Q.length) api('stats').then((s) => checkAch(s)).catch(() => {});
  }
  async function load() {
    await flush(); i = 0; hit = 0;
    try { Q = await api('queue', { qs: { mode, id: id || 0 } }); localStorage.setItem(key, JSON.stringify(Q)); }
    catch (e) { Q = e.status === 423 ? [] : JSON.parse(localStorage.getItem(key) || '[]'); if (e.status === 423) notify(e.message); else if (Q.length) notify('Sem conexão: usando os últimos cartões salvos. Suas notas serão enviadas quando a rede voltar.'); }
    Q.length ? show() : finish();
  }
  const keys = (e) => {
    if (e.target.matches('textarea,input') || sess.hidden || document.body.classList.contains('gaming')) return;
    if (e.key === ' ' && !shown) { e.preventDefault(); showAns(); }
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); ttsPause(); }
    if (['1', '2', '3', '4'].includes(e.key)) grade(+e.key - 1);
  };
  document.body.classList.add('immersive'); document.addEventListener('keydown', keys); cleanup = () => { document.removeEventListener('keydown', keys); document.body.classList.remove('immersive'); };
  load(); return root;
}

function vSettings() {
  const p = S.prefs;
  const rng = (label, k, min, max, step) => { const i = 'f' + (++uid); return el('div', { class: 'f' }, el('label', { for: i }, label), el('input', { id: i, type: 'range', min, max, step, value: p[k], oninput: (e) => setPref(k, +e.target.value) })); };
  return el('div', {}, el('h1', {}, 'Ajustes de leitura'), el('p', {}, 'As mudanças valem na hora e ficam salvas na sua conta.'),
    el('div', { class: 'box' },
      select('Contraste', 'theme', [['claro', 'Sol: azul-marinho sobre fundo claro e alegre'], ['noite', 'Noite: amarelo sobre preto'], ['azul', 'Mar: branco sobre azul-escuro']], p.theme),
      rng('Tamanho da letra', 'fs', 16, 48, 2), rng('Espaço entre linhas', 'lh', 1.4, 2.4, 0.1), rng('Espaço entre letras', 'ls', 0, 0.2, 0.02), rng('Velocidade da voz', 'rate', 0.6, 1.6, 0.1),
      select('Ler cartões em voz alta automaticamente', 'tts', [[0, 'Não'], [1, 'Sim']], p.tts)));
}
function afterSettings() { const t = $('select[name=theme]'), s = $('select[name=tts]'); t && t.addEventListener('change', () => setPref('theme', t.value)); s && s.addEventListener('change', () => setPref('tts', +s.value)); }

function vAccount() {
  const on = toolsOn();
  return el('div', {}, el('section', { class: 'box' }, el('h2', {}, ico('🎛️'), ' Aparência e acessibilidade'),
      el('p', {}, on ? 'O modo de acessibilidade está LIGADO: letras grandes, contraste alto e menu de leitura.' : 'O modo de acessibilidade está DESLIGADO: desenho padrão, compacto, com letras menores e outras cores.'),
      btn(on ? '♿ Ocultar acessibilidade (desenho padrão)' : '♿ Mostrar acessibilidade', () => { toggleTools(); render(true); }, 'big')),
    el('section', { class: 'box' }, el('h2', {}, ico('🔑'), ' Minha conta'), el('p', {}, 'Conectado como ', el('b', {}, S.user.name), ' (' + S.user.email + ').'),
      form([field('Senha atual', 'current', { type: 'password', req: true, ac: 'current-password' }), field('Nova senha (mínimo 8 caracteres)', 'new', { type: 'password', req: true, min: 8, ac: 'new-password' }), field('Repita a nova senha', 'again', { type: 'password', req: true, min: 8, ac: 'new-password' }), el('p', {}, submit('Trocar minha senha'))],
        async (d, f) => { if (d.new !== d.again) throw new Error('As senhas novas não conferem.'); await api('pwd_change', { body: { current: d.current, new: d.new } }); f.reset(); notify('✅ Senha alterada com sucesso.'); toast('🔑 Senha alterada!'); })));
}
function vSources() {
  const box = (t, items, cls = '') => el('section', { class: 'box ' + cls }, el('h2', {}, t), el('ul', {}, items.map((x) => el('li', {}, x, ' ', ouvir(x)))));
  return el('div', {}, el('h1', {}, 'Fontes de estudo'), el('p', {}, 'Os resumos e cartões são textos de apoio escritos para revisão. Para a prova, confirme sempre na bibliografia e na lei.'),
    box('Material institucional', ['Livro didático de Direito Administrativo (Estácio), na plataforma SIA / SAVA.']),
    box('Bibliografia básica (Biblioteca Virtual)', ['DI PIETRO, Maria Sylvia Zanella. Direito Administrativo. Forense.', 'MEIRELLES, Hely Lopes. Direito Administrativo Brasileiro. Malheiros / JusPodivm.', 'CARVALHO FILHO, José dos Santos. Manual de Direito Administrativo. Atlas.', 'MAZZILLI, Marcelo. Direito Administrativo Descomplicado, ou obra equivalente do acervo.']),
    box('Legislação essencial', ['Constituição Federal de 1988, arts. 37 a 41.', 'Lei 14.133/2021 (licitações e contratos).', 'Lei 9.784/1999 (processo administrativo federal).', 'Lei 8.429/1992, com a Lei 14.230/2021 (improbidade).', 'Lei 8.987/1995 (concessões e permissões).']),
    box('Como estudar aqui', ['Recuperação ativa: responda antes de ver a resposta.', 'Repetição espaçada: cada cartão volta conforme a sua nota.', 'Blocos curtos: 8 cartões, recordação livre e pausa.', 'Intercalação: a revisão mista alterna assuntos.', 'Duas vias: leia e ouça o mesmo conteúdo.'], 'mn'));
}

/* ---------- gamificação ---------- */
const ico = (e, c = '') => el('span', { class: 'ico ' + c, 'aria-hidden': 'true' }, e);
const LV = ['Calouro 🐣', 'Estagiário 📎', 'Bacharel 🎓', 'Advogado ⚖️', 'Procurador 🏛️', 'Ministro 👑'];
const lvInfo = (xp) => { const l = Math.floor(Math.sqrt(xp / 30)) + 1, a = 30 * (l - 1) ** 2, b = 30 * l ** 2; return { l, name: LV[Math.min(l - 1, 5)], pc: Math.round(100 * (xp - a) / (b - a)), next: b - xp }; };
const GX = [2, 6, 10, 12];
const ACH = {
  primeiro: ['👣', 'Primeiros passos', 'Responda o seu primeiro cartão.'], cartoes50: ['🃏', 'Colecionador', '50 cartões respondidos.'], cartoes200: ['🏅', 'Maratonista', '200 cartões respondidos.'],
  seq3: ['🔥', 'Pegando fogo', '3 dias seguidos estudando.'], seq7: ['🌋', 'Imparável', '7 dias seguidos estudando.'], estrela: ['⭐', 'Primeira estrela', 'Ganhe uma estrela em qualquer assunto.'],
  tres: ['🌟', 'Mestre do assunto', '3 estrelas em um assunto.'], mapa: ['🗺️', 'Explorador do mapa', 'Ao menos 1 estrela em todos os assuntos.'], nivel5: ['👑', 'Nível 5', 'Chegue ao nível 5.'], aprovado: ['🎓', 'Aprovação!', '3 estrelas em todos os assuntos do pacote.']
};
function hud() {
  const h = $('#hud'); if (!h) return; h.replaceChildren(); if (!S.user) return;
  const x = S.user.xp || 0, l = lvInfo(x); h.append(ico('⭐'), el('b', {}, x + ' XP'), ' · Nv ' + l.l + ' ' + l.name);
}
function toast(t) { const e = el('div', { class: 'toast', role: 'status' }, t); document.body.append(e); setTimeout(() => e.remove(), 4500); }
function xpPop(t) { const e = el('div', { class: 'xppop', 'aria-hidden': 'true' }, t); document.body.append(e); setTimeout(() => e.remove(), 1000); }
function burst() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const b = el('div', { class: 'burst', 'aria-hidden': 'true' }), E = ['🎉', '✨', '⭐', '🎊', '🌟'];
  for (let k = 0; k < 16; k++) { const s = el('span', {}, E[k % 5]); s.style.left = Math.round(Math.random() * 94) + '%'; s.style.animationDelay = (Math.random() * 0.8).toFixed(2) + 's'; b.append(s); }
  document.body.append(b); setTimeout(() => b.remove(), 3500);
}
function gain(g) {
  const u = S.user, a = lvInfo(u.xp || 0).l; u.xp = (u.xp || 0) + GX[g]; hud(); xpPop('+' + GX[g] + ' XP ✨');
  const n = lvInfo(u.xp); if (n.l > a) { toast('🎉 Você subiu para o nível ' + n.l + ': ' + n.name); burst(); }
}
function checkAch(s, init) {
  const k = 'eca' + S.user.id; let known = null; try { known = JSON.parse(localStorage.getItem(k)); } catch { /* ignora */ }
  if (known === null && init) { localStorage.setItem(k, JSON.stringify(s.ach)); return; }
  const fresh = s.ach.filter((c) => !(known || []).includes(c)); localStorage.setItem(k, JSON.stringify(s.ach));
  if (fresh.length) { toast('🏆 Conquista: ' + fresh.map((c) => ACH[c][0] + ' ' + ACH[c][1]).join(', ')); burst(); }
}

/* ---------- mapa da trilha (estilo mapa de jogo) ---------- */
const NS = 'http://www.w3.org/2000/svg';
const sv = (t, a = {}, ...k) => { const e = document.createElementNS(NS, t); for (const [n, v] of Object.entries(a)) if (v != null) e.setAttribute(n, v); for (const c of k.flat(9)) e.append(c && c.nodeType ? c : document.createTextNode(c ?? '')); return e; };
function wrap(t, n = 17) { const L = []; let c = ''; for (const x of t.split(' ')) { if ((c + ' ' + x).trim().length > n && c) { L.push(c); c = x; } else c = (c + ' ' + x).trim(); } if (c) L.push(c); return L.slice(0, 2).map((x, i, a) => (i === 1 && L.length > 2 ? x + '…' : x)); }
function trail(topics, weak, paused = false) {
  const step = 150, top = 90, n = topics.length, H = top + step * n + 190;
  const P = topics.map((t, i) => ({ x: Math.round(180 + 100 * Math.sin(i * 1.3)), y: top + i * step })), end = { x: 180, y: top + n * step + 30 };
  const open = topics.map((t, i) => i === 0 || topics[i - 1].stars >= 1), cur = Math.max(0, open.lastIndexOf(true));
  const all2 = topics.every((t) => t.stars >= 2), all3 = topics.every((t) => t.stars >= 3), pts = [...P, end];
  const seg = (i) => `C${pts[i - 1].x} ${pts[i - 1].y + step / 2} ${pts[i].x} ${pts[i].y - step / 2} ${pts[i].x} ${pts[i].y}`;
  let d = `M${pts[0].x} ${pts[0].y}`, dd = d; for (let i = 1; i < pts.length; i++) { d += ' ' + seg(i); if (i <= cur) dd += ' ' + seg(i); }
  const deco = ['🌳', '🌲', '🌼', '🍄', '🌴'], wrapEl = el('div', { class: 'trailwrap' }), tip = el('div', { class: 'tip', role: 'status', hidden: true });
  const av = sv('g', { class: 'avatar', 'aria-hidden': 'true', transform: `translate(${P[cur].x} ${P[cur].y})` }, sv('text', { x: -50, y: -22, class: 'sc av' }, '🧑‍🎓'));
  const svg = sv('svg', { viewBox: `0 0 360 ${H}`, class: 'trail' + (paused ? ' paused' : ''), role: 'group', 'aria-label': 'Mapa da trilha de aprendizado' },
    sv('defs', {}, sv('linearGradient', { id: 'sg', x1: 0, y1: 0, x2: 0, y2: 1 }, sv('stop', { offset: 0, 'stop-color': '#bfe9ff' }), sv('stop', { offset: 0.5, 'stop-color': '#e3f7c6' }), sv('stop', { offset: 1, 'stop-color': '#c9f0a8' }))),
    sv('rect', { class: 'sky', width: 360, height: H, rx: 24, fill: 'url(#sg)' }), sv('text', { x: 304, y: 48, class: 'sc sun', 'aria-hidden': 'true' }, '☀️'),
    topics.map((t, i) => [sv('text', { x: P[i].x > 180 ? 40 : 320, y: P[i].y + 20, class: 'sc', 'aria-hidden': 'true' }, deco[i % 5]), i % 2 === 0 ? sv('text', { x: i % 4 === 0 ? 70 : 290, y: P[i].y - 55, class: 'sc cloud', 'aria-hidden': 'true' }, '☁️') : '']),
    sv('path', { d, class: 'road-b' }), sv('path', { d, class: 'road' }), sv('path', { d: dd, class: 'road-done', pathLength: 1 }), sv('text', { x: P[0].x - 62, y: P[0].y, class: 'sc', 'aria-hidden': 'true' }, '🚩'));
  const showTip = (txt, x, y) => { tip.hidden = false; tip.textContent = txt; tip.style.left = (x / 360 * 100) + '%'; tip.style.top = (y / H * 100) + '%'; };
  const node = (p, st, emoji, title, sub, href, label, tipText, lockMsg, r = 40, extra = [], isCur = false) => {
    const g = sv('g', { class: 'node ' + st + (isCur ? ' cur' : '') }, sv('circle', { cx: p.x, cy: p.y, r, class: 'nc' }), sv('text', { x: p.x, y: p.y, class: 'ne' }, st === 'lock' ? '🔒' : emoji), extra,
      wrap(title).map((l, k) => sv('text', { x: p.x, y: p.y + r + 40 + k * 19, class: 'lb' }, l)));
    if (sub) g.append(sub);
    const outer = href ? sv('a', { href, 'aria-label': label, class: 'nodeg' }) : sv('g', { role: 'button', tabindex: 0, 'aria-label': label, class: 'nodeg lockg' }); outer.append(g);
    const on = () => showTip(tipText, p.x, p.y), off = () => { tip.hidden = true; };
    outer.addEventListener('mouseenter', on); outer.addEventListener('focusin', on); outer.addEventListener('mouseleave', off); outer.addEventListener('focusout', off);
    if (!href) { const act = () => { g.classList.remove('shake'); void g.getBoundingClientRect(); g.classList.add('shake'); toast(lockMsg); }; outer.addEventListener('click', act); outer.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } }); }
    return outer;
  };
  topics.forEach((t, i) => {
    const p = P[i], st = open[i] ? (t.stars >= 3 ? 'done' : 'open') : 'lock', isW = weak.includes(t.id), isCur = i === cur;
    const stars = sv('g', {}, [0, 1, 2].map((k) => sv('text', { x: p.x - 24 + k * 24, y: p.y + 58, class: 'star ' + (k < t.stars ? 'on' : 'off') }, '★')));
    const ex = [isW ? sv('g', { class: 'wk' }, sv('circle', { cx: p.x + 32, cy: p.y - 32, r: 15 }), sv('text', { x: p.x + 32, y: p.y - 32, class: 'sc', style: 'font-size:17px' }, '🔥')) : ''];
    const label = `Fase ${i + 1}: ${t.title}. ${t.stars} de 3 estrelas. ${st === 'lock' ? 'Bloqueada: ganhe uma estrela na fase anterior.' : isW ? 'Reforço recomendado.' : 'Liberada.'}`;
    const tipText = `Fase ${i + 1}: ${t.title} · ${'★'.repeat(t.stars)}${'☆'.repeat(3 - t.stars)} · ${st === 'lock' ? 'bloqueada' : isCur ? 'você está aqui' : 'liberada'}`;
    const href = st === 'lock' || paused ? null : '#/topico/' + t.id, lockMsg = paused ? '⏸️ Trilha desativada: reative para estudar.' : '🔒 Ganhe 1 estrela em «' + (topics[i - 1] ? topics[i - 1].title : '') + '» para liberar esta fase.';
    svg.append(node(p, st, t.emoji || '📖', t.title + (isW ? ' (reforçar)' : ''), stars, href, label, tipText, lockMsg, 40, ex, isCur));
  });
  const es = all3 ? 'done' : all2 ? 'open' : 'lock', castleOpen = all2 && !paused;
  svg.append(node(end, es, all3 ? '🎓' : '🏰', 'Aprovação: prova final', null, castleOpen ? '#/revisar/exam/0' : null, all2 ? 'Castelo da aprovação: fazer o simulado final.' : 'Castelo da aprovação, bloqueado: ganhe 2 estrelas em todas as fases.', 'Castelo da aprovação' + (all2 ? ': simulado final' : ' · bloqueado'),
    paused ? '⏸️ Trilha desativada: reative para estudar.' : '🔒 Ganhe 2 estrelas em todas as fases para liberar a prova final.', 48, all3 ? [sv('text', { x: end.x - 62, y: end.y - 40, class: 'sc spark' }, '🎆'), sv('text', { x: end.x + 62, y: end.y - 40, class: 'sc spark' }, '🎇')] : []));
  svg.append(av);
  /* o personagem caminha pelo caminho até a fase atual */
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, setAv = (x, y) => av.setAttribute('transform', `translate(${x} ${y})`);
  if (!reduce && cur > 0) {
    setAv(P[0].x, P[0].y); const dur = Math.min(3600, 700 + cur * 450); let t0 = null, tries = 0;
    const bez = (a, b, c, e, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * e; };
    const frame = (ts) => {
      if (!svg.isConnected) { if (tries++ < 60) requestAnimationFrame(frame); else setAv(P[cur].x, P[cur].y); return; }
      if (t0 === null) t0 = ts; const p = Math.min(1, (ts - t0) / dur), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2, f = e * cur, i = Math.min(cur, Math.floor(f) + 1), t = Math.max(0, Math.min(1, f - (i - 1)));
      setAv(bez(pts[i - 1].x, pts[i - 1].x, pts[i].x, pts[i].x, t), bez(pts[i - 1].y, pts[i - 1].y + step / 2, pts[i].y - step / 2, pts[i].y, t));
      if (p < 1) requestAnimationFrame(frame); else setAv(P[cur].x, P[cur].y);
    };
    requestAnimationFrame(frame); setTimeout(() => setAv(P[cur].x, P[cur].y), dur + 6000);
  }
  wrapEl.append(svg, tip);
  const legend = el('p', { class: 'legend' }, '🧑‍🎓 você está aqui · 🔒 bloqueada · ★ estrelas · 🔥 reforçar · toque ou passe o mouse numa fase para ver os detalhes.');
  const list = el('details', { class: 'box' }, el('summary', { class: 'btn alt', role: 'button' }, 'Ver a trilha em lista'),
    el('ol', {}, topics.map((t, i) => el('li', {}, open[i] ? el('a', { href: '#/topico/' + t.id }, t.title) : t.title, ' — ' + t.stars + ' de 3 estrelas' + (open[i] ? '' : ' (bloqueada)') + (weak.includes(t.id) ? ' (reforçar)' : ''), ' ', ouvir('Fase ' + (i + 1) + ': ' + t.title + '. ' + t.stars + ' de 3 estrelas.' + (open[i] ? '' : ' Bloqueada.')))),
      el('li', {}, all2 ? el('a', { href: '#/revisar/exam/0' }, 'Prova final (simulado)') : 'Prova final (bloqueada: 2 estrelas em todas as fases)')));
  return el('div', {}, wrapEl, legend, el('p', {}, 'Cada fase dá até 3 estrelas conforme você domina os cartões. 1 estrela libera a fase seguinte; 2 estrelas em todas libera o simulado final.'), list);
}
function weakBox(s) {
  const w = s.weak.map((id) => s.topics.find((t) => t.id === id)).filter(Boolean);
  return el('section', { class: 'box' }, el('h2', {}, ico('🔥', 'flame'), ' Reforço recomendado'),
    w.length ? [el('p', {}, 'Assuntos com mais erros nos seus cartões. Aprofunde com os resumos visuais e depois pratique.'),
      el('div', { class: 'grid' }, w.map((t) => el('div', { class: 'box' }, el('b', {}, ico(t.emoji), ' ', t.title), el('br'), 'Acertos: ' + t.acc + '%', el('div', { class: 'tools' }, link('📚 Resumo visual', '#/resumo/' + t.id, ''), link('🃏 Praticar', '#/revisar/topic/' + t.id, 'alt'), ouvir(t.title + '. Acertos ' + t.acc + ' por cento. Reforço recomendado.')))))]
      : el('p', {}, 'Ainda sem pontos fracos. Quando um assunto tiver acertos abaixo de 75%, ele aparece aqui com um resumo visual para aprofundar.'));
}

/* ---------- biblioteca de resumos visuais ---------- */
async function vLibrary() {
  const [s, ts] = await Promise.all([api('stats'), api('topics')]), acc = Object.fromEntries(s.topics.map((t) => [t.id, t.acc]));
  const tile = (t) => el('div', { class: 'box' }, el('b', {}, ico(t.emoji), ' ', el('a', { href: '#/resumo/' + t.id }, t.title)), el('br'), t.nv + (t.nv === 1 ? ' resumo visual' : ' resumos visuais'), acc[t.id] != null ? el('br') : '', acc[t.id] != null ? 'Acertos: ' + acc[t.id] + '%' : '', el('div', {}, ouvir(t.title + '. ' + t.nv + ' resumos visuais' + (acc[t.id] != null ? '. Acertos ' + acc[t.id] + ' por cento.' : ''))));
  const w = s.weak.map((id) => ts.find((t) => t.id === id)).filter(Boolean);
  return el('div', {}, el('h1', {}, ico('📚', 'bob'), ' Biblioteca de resumos visuais'), el('p', {}, 'Cartões de aprofundamento para estudar um tema com calma. Os assuntos de pior desempenho aparecem primeiro.'),
    w.length ? [el('h2', {}, ico('🔥', 'flame'), ' Recomendados para você'), el('div', { class: 'grid' }, w.map(tile))] : '',
    el('h2', {}, 'Todos os assuntos'), el('div', { class: 'grid' }, ts.map(tile)), el('p', {}, link('📖 Ver textos de apoio por assunto', '#/topicos', 'alt')));
}
async function vDeck(id) {
  const [t, vs] = await Promise.all([api('topic', { qs: { id } }), api('visuals', { qs: { id } })]);
  const root = el('div', {}, el('h1', {}, ico(t.emoji || '📚'), ' ', t.title));
  if (!vs.length) { root.append(el('p', {}, 'Este assunto ainda não tem resumo visual.'), link('📖 Ler o texto de apoio', '#/topico/' + id, 'big')); return root; }
  let i = 0; const stage = el('section', { class: 'box vcard', 'aria-live': 'polite' }), dots = el('p', { 'aria-hidden': 'true', class: 'dots' }), count = el('p', {});
  const prev = btn('◀ Anterior', () => go(i - 1), 'alt big'), next = btn('Próximo ▶', () => go(i + 1), 'big'), last = link('🃏 Praticar este assunto', '#/revisar/topic/' + id, 'big');
  function paint() {
    const v = vs[i];
    stage.replaceChildren(el('div', { class: 'bigico' }, ico(v.emoji, 'wig')), el('h2', { tabindex: -1 }, v.title), el('ul', { class: 'chips' }, v.points.map((p) => el('li', {}, el('span', {}, p), ouvir(p)))),
      v.pitfall ? el('p', { class: 'warn' }, ico('⚠️'), ' ', el('b', {}, 'Cuidado: '), v.pitfall, ' ', ouvir('Cuidado: ' + v.pitfall)) : '', v.example ? el('p', { class: 'tip' }, ico('💡'), ' ', el('b', {}, 'Exemplo: '), v.example, ' ', ouvir('Exemplo: ' + v.example)) : '',
      speak('🔊 Ouvir este cartão', [v.title, ...v.points, v.pitfall, v.example].filter(Boolean).join('. ')));
    count.textContent = `Cartão ${i + 1} de ${vs.length}`; dots.textContent = vs.map((_, k) => (k === i ? '●' : '○')).join(' ');
    prev.disabled = i === 0; next.hidden = i === vs.length - 1; last.hidden = i !== vs.length - 1;
  }
  function go(k) { if (k < 0 || k >= vs.length) return; i = k; paint(); $('h2', stage).focus(); }
  const keys = (e) => { if (e.target.matches('input,textarea')) return; if (e.key === 'ArrowRight') go(i + 1); if (e.key === 'ArrowLeft') go(i - 1); };
  document.body.classList.add('immersive'); document.addEventListener('keydown', keys); cleanup = () => { document.removeEventListener('keydown', keys); document.body.classList.remove('immersive'); };
  paint(); root.append(count, stage, dots, el('div', { class: 'tools' }, prev, next, last, link('Voltar aos resumos', '#/resumos', 'alt')));
  return root;
}
async function vAch() {
  const s = await api('stats'), L = lvInfo(s.xp);
  return el('div', {}, el('h1', {}, ico('🏆', 'bob'), ' Conquistas'),
    el('section', { class: 'box hero' }, el('p', {}, ico('⭐'), ' ', el('b', {}, s.xp + ' XP'), ' · Nível ', el('b', {}, L.l + ' · ' + L.name)), bar(L.pc, 'Progresso no nível'), el('p', {}, s.reviews + ' cartões respondidos · ' + s.streak + ' dias seguidos')),
    el('div', { class: 'grid' }, Object.entries(ACH).map(([c, [e, n, d]]) => { const on = s.ach.includes(c); return el('div', { class: 'box badge ' + (on ? 'on' : 'off') }, el('div', { class: 'bigico' }, ico(on ? e : '🔒', on ? 'wig' : '')), el('b', {}, n), el('br'), d, el('br'), el('b', {}, on ? '✅ Conquistada' : 'Ainda bloqueada'), el('div', {}, ouvir(n + '. ' + d + ' ' + (on ? 'Conquistada.' : 'Ainda bloqueada.')))); })),
    el('h2', {}, 'Como ganhar XP'), el('p', {}, 'Cada cartão vale pontos pela sua nota: Errei +2, Difícil +6, Bom +10, Fácil +12. As estrelas do mapa vêm do domínio dos cartões de cada assunto.'));
}
async function vPkgs() {
  const s = await api('stats');
  return el('div', {}, el('h1', {}, ico('📦', 'bob'), ' Pacotes de estudo'), el('p', {}, 'Cada pacote tem um objetivo, uma trilha, cartões e resumos visuais. Pacotes novos são instalados pelo administrador.'),
    el('div', { class: 'grid' }, s.pkgs.map((p) => el('div', { class: 'box' }, el('div', { class: 'bigico' }, ico(p.emoji, 'bob')), el('b', {}, p.name), el('br'), 'Objetivo: ' + p.goal, el('div', {}, ouvir(p.name + '. Objetivo: ' + p.goal)),
      el('div', { class: 'tools' }, s.pkg && s.pkg.id === p.id ? el('b', {}, '✅ Pacote ativo') : btn('Usar este pacote', async () => { await api('pkg_set', { body: { id: p.id } }); notify('Pacote alterado.'); location.hash = '#/'; render(); }, ''))))),
    el('p', {}, link('📖 Fontes de estudo', '#/fontes', 'alt')));
}

/* ---------- trilhas: criar com IA, importar/exportar, prazo, metas e painel ---------- */
const KIND = { sistema: '📘 Do sistema', ia: '✨ Criada com IA', material: '📎 Com meus materiais', video: '🎬 A partir de vídeos', importada: '📥 Importada' };
const STATUS = { concluida: '🏁 Concluída', sem_prazo: '🧭 Sem prazo definido', no_prazo: '✅ No prazo', atencao: '⚠️ Atenção: o ritmo está abaixo do necessário', atrasado: '🚨 Atrasado: ajuste o prazo ou a carga semanal' };
const PACE = { 1: 40, 2: 32, 3: 24, 4: 18, 5: 12 };   // cartões por hora na 1ª passada, por dificuldade (1 fácil a 5 difícil)
const fmtMin = (m) => (m >= 60 ? Math.floor(m / 60) + ' h ' + Math.round(m % 60) + ' min' : Math.round(m) + ' min');
const fmtDate = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('pt-BR') : '—');
function analyze(d) {
  const pl = d.plan, ref = pl.paused_at || d.now, T = d.topics, cl = (v, a, b) => Math.max(a, Math.min(b, v)), base = (t) => 60 / PACE[t.difficulty || 3];
  const A = T.reduce((s, t) => s + t.tries, 0), ok = T.reduce((s, t) => s + t.ok, 0), acc = A ? Math.round(100 * ok / A) : null;
  const exp = A ? T.reduce((s, t) => s + t.tries * base(t), 0) / A : 1, obs = A ? d.studied_min / A : 1, w = Math.min(A, 60) / 60;
  const f = 1 + w * (cl(obs / exp, 0.6, 2) - 1), g = acc == null ? 1 : acc < 60 ? 1.25 : acc >= 85 ? 0.9 : 1;      // ritmo real do aluno e acertos ajustam a estimativa
  const est = T.map((t) => { const e = t.chunks * 3 + t.nv * 4 + t.n * base(t) * 3 * f * g, p = t.n ? t.k / t.n : 0; return { ...t, est: e, rem: e * (1 - p), pct: Math.round(100 * p) }; });
  const total = est.reduce((s, t) => s + t.est, 0), rem = est.reduce((s, t) => s + t.rem, 0), n = T.reduce((s, t) => s + t.n, 0), k = T.reduce((s, t) => s + t.k, 0);
  const content = n ? Math.round(100 * k / n) : 0, hpw = pl.hpw || 5, weekGoal = hpw * 60, weekDone = d.week.reduce((s, x) => s + x.min, 0), weekPct = Math.min(100, Math.round(100 * weekDone / weekGoal));
  const dl = pl.deadline, timePct = dl ? Math.round(cl(100 * (ref - pl.start_ts) / Math.max(1, dl - pl.start_ts), 0, 100)) : null, daysLeft = dl ? Math.max(0, Math.ceil((dl - ref) / 86400)) : null;
  const finish = ref + (rem / weekGoal) * 7 * 86400, slack = dl ? (dl - finish) / 86400 : null, pace = timePct ? Math.min(150, Math.round(100 * content / timePct)) : 100;
  const status = rem < 1 ? 'concluida' : !dl ? 'sem_prazo' : slack >= 0 ? 'no_prazo' : slack > -7 ? 'atencao' : 'atrasado', daily = dl ? rem / Math.max(1, daysLeft) : null;
  const sched = []; let cap = weekGoal, wk = { n: 1, items: [] };
  for (const t of est) { let r = t.rem; while (r > 0.5 && sched.length < 52) { const put = Math.min(r, cap); wk.items.push({ title: t.title, min: put }); r -= put; cap -= put; if (cap < 0.5) { sched.push(wk); wk = { n: wk.n + 1, items: [] }; cap = weekGoal; } } }
  if (wk.items.length) sched.push(wk);
  return { est, total, rem, content, acc, A, weekGoal, weekDone, weekPct, timePct, daysLeft, finish, slack, pace, status, daily, sched, ref, frozen: !!pl.paused_at };
}
function gauge(p, label, hint) { const g = el('div', { class: 'gauge', role: 'img', 'aria-label': label + ': ' + p + '%' }, el('span', {}, p + '%')); g.style.setProperty('--p', Math.max(0, Math.min(100, p))); return el('div', { class: 'gbox' }, g, el('b', {}, label), el('small', {}, hint)); }
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

async function exportRoute(id, name) {
  const x = await api('route_export', { qs: { id } }), txt = JSON.stringify(x, null, 1), file = (name || 'trilha').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-') + '.trilha.json';
  const a = el('a', { href: URL.createObjectURL(new Blob([txt], { type: 'application/json' })), download: file, class: 'btn big' }, '⬇️ Baixar ' + file);
  notify(''); live.append(el('div', { class: 'box' }, el('h2', {}, ico('📤'), ' Trilha exportada'), el('p', {}, 'Guarde o arquivo: ele restaura conteúdo, bibliografia, estratégia, progresso, prazo e metas.'), a, ' ', btn('📋 Copiar', () => navigator.clipboard.writeText(txt).then(() => toast('Copiado!')).catch(() => {}), 'alt'), el('textarea', { rows: 5, readonly: true, 'aria-label': 'Conteúdo da trilha exportada' }, txt)));
  a.click();
}

async function vRoutes() {
  const s = await api('routes');
  const card = (r) => {
    const pc = r.n ? Math.round(100 * r.k / r.n) : 0, paused = r.status !== 'ativa', cur = r.id === s.current;
    return el('div', { class: 'box' + (paused ? ' paused' : '') + (cur ? ' curr' : '') }, el('div', { class: 'bigico' }, ico(r.emoji, paused ? '' : 'bob')), el('b', {}, r.name), el('br'), KIND[r.kind] || r.kind, ' · ' + ({ privada: '🔒 Privada', grupos: '👥 Grupos', publica: '🌐 Pública' }[r.visibility] || ''), el('br'), r.goal,
      bar(pc, 'Domínio de ' + r.name), pc + '% dominado' + (r.deadline ? ' · prazo ' + fmtDate(r.deadline) : ''), el('br'), paused ? el('b', {}, '⏸️ Desativada: só visualização') : cur ? el('b', {}, '✅ Trilha em uso') : '',
      el('div', { class: 'tools' }, link('📊 Painel', '#/trilha/' + r.id, ''),
        el('button', { type: 'button', class: 'alt', disabled: paused || cur, onclick: async () => { await api('pkg_set', { body: { id: r.id } }); location.hash = '#/'; } }, '▶️ Usar'),
        act('route_state', { id: r.id, act: paused ? 'resume' : 'pause' }, null, paused ? '▶️ Reativar' : '⏸️ Desativar', 'alt'), btn('📤 Exportar', () => exportRoute(r.id, r.name), 'alt'),
        r.mine ? act('route_state', { id: r.id, act: 'delete' }, null, '🗑️ Excluir', 'alt', 'Excluir esta trilha? Ela some da sua lista e o tempo fica congelado. A exclusão definitiva depende da aprovação do administrador, que também pode restaurá-la.') : '', ouvir(r.name + '. ' + r.goal + '. ' + pc + ' por cento dominado.')));
  };
  return el('div', {}, el('h1', {}, ico('🧭', 'bob'), ' Trilhas de aprendizagem'), el('p', {}, 'Cada trilha tem objetivo, mapa, cartões, resumos visuais, prazo e metas. Crie novas com IA, importe uma trilha salva ou volte a uma anterior.'),
    el('div', { class: 'tools' }, link('✨ Nova trilha com IA', '#/trilhas/nova', 'big'), link('📥 Importar trilha', '#/trilhas/importar', 'alt big')), el('div', { class: 'grid' }, s.routes.map(card)), el('p', {}, link('📖 Fontes de estudo', '#/fontes', 'alt')));
}

function vImport() {
  const ta = field('Cole o conteúdo do arquivo .trilha.json', 'json', { tag: 'textarea', rows: 8 });
  const file = el('input', { id: 'tf', type: 'file', accept: '.json,application/json', onchange: async (e) => { const f = e.target.files[0]; if (f) $('textarea', ta).value = await f.text(); } });
  return el('div', {}, el('h1', {}, ico('📥'), ' Importar trilha'), el('p', {}, 'Restaura a trilha com conteúdos, bibliografia, estratégia, progresso, prazo e metas como foram exportados.'),
    form([ta, el('div', { class: 'f' }, el('label', { for: 'tf' }, 'Ou envie o arquivo'), file), el('p', {}, submit('Importar', 'big'))], async (d) => {
      const r = await api('route_import', { body: { json: d.json } }); await api('pkg_set', { body: { id: r.id } }); if (r.warning) toast('⚠️ ' + r.warning); location.hash = '#/trilha/' + r.id;
    }));
}

function paintSteps(box, pr) {
  if (!pr || !pr.steps) return; let ol = $('.steps', box); if (!ol) { ol = el('ol', { class: 'steps' }); box.append(ol); }
  const ic = { ok: '✅', andamento: '⏳', espera: '⚪', parcial: '⚠️' }, done = pr.steps.filter((s) => s.s === 'ok' || s.s === 'parcial').length, w = pr.steps.find((s) => s.k === 'escrever'), m = w && w.d ? /Assunto (\d+) de (\d+)/.exec(w.d) : null, frac = m && w.s === 'andamento' ? (m[1] - 1) / m[2] : 0;
  ol.replaceChildren(...pr.steps.map((s) => el('li', { class: 'st-' + s.s }, el('span', { class: 'sic', 'aria-hidden': 'true' }, ic[s.s] || '⚪'), el('span', {}, el('b', {}, s.t), s.d ? el('br') : '', s.d || '', pr.agentes && pr.agentes[s.k] ? el('small', {}, ' · agente: ' + pr.agentes[s.k]) : ''))));
  const old = $('.bar', box); const nb = bar(Math.round(100 * (done + frac) / pr.steps.length), 'Progresso da criação'); if (old) old.replaceWith(nb); else box.insertBefore(nb, ol);
}
async function pollJob(job) {
  const start = location.hash, box = el('section', { class: 'box hero' }, el('h2', {}, ico('🔎', 'bob'), ' Montando a sua trilha…'), el('p', { id: 'jm' }, 'Iniciando…'),
    el('p', {}, 'O orquestrador planeja a trilha, pesquisa a bibliografia e escreve um assunto de cada vez; se um agente falhar, outro assume. Pode levar alguns minutos. Se sair desta tela, a trilha aparece em "Trilhas" quando ficar pronta.'));
  view.replaceChildren(el('h1', {}, 'Criando trilha'), box);
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setTimeout(r, 3000)); if (location.hash !== start) return;
    let j; try { j = await api('route_job', { qs: { id: job } }); } catch { continue; }
    $('#jm', box).textContent = j.msg; paintSteps(box, j.progress);
    if (j.status === 'pronto') { await api('pkg_set', { body: { id: j.route_id } }); toast('🎉 Trilha pronta!'); burst(); location.hash = '#/trilha/' + j.route_id; return; }
    if (j.status === 'manual') { manualPanel(job, j, box); return; }
    if (j.status === 'erro') { notify(j.msg); box.append(link('Tentar de novo', '#/trilhas/nova', 'big')); return; }
  }
}

async function vNewRoute(Q) {
  const info = await api('ia_status'), lib = (await api('materials')).materials, pre = (Q && Q.get('aula')) ? await api('media_get', { qs: { id: Q.get('aula') } }).catch(() => null) : null, root = el('div', {}, el('h1', {}, ico('✨', 'wig'), ' Nova trilha com IA'));
  if (!info.enabled) root.append(el('div', { class: 'msg' }, '🛟 A IA automática não está configurada. Você ainda pode criar a trilha: o sistema monta o pedido e você usa qualquer IA ou agente de sua preferência (modo agente), ou cria um esqueleto. ', S.user.role === 'admin' ? link('Configurar a IA', '#/admin/ia', '') : ''));
  const st = { mode: pre ? 'material' : 'tema', mats: [], vids: [], ids: pre ? pre.material_ids.slice() : [] }, mb = el('div', { class: 'tools', role: 'group', 'aria-label': 'Como montar a trilha' }), matBox = el('div'), vidBox = el('div');
  const bind = (f, o, k) => { const i = $('input,textarea', f); i.addEventListener('input', () => { o[k] = i.value; }); return f; };
  const b64 = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(f); });
  const clean = (t) => t.replace(/WEBVTT/g, '').replace(/^\d+\s*$/gm, '').replace(/\d{2}:\d{2}:\d{2}[.,]\d{3} --> .*/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const pick = (accept, onfile) => el('input', { type: 'file', accept, 'aria-label': 'Escolher arquivo', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 5e6) { notify('Arquivo grande demais (máximo 5 MB).'); return; } await onfile(f); paint(); } });
  function paint() {
    mb.replaceChildren(...[['tema', '💡 Por tema e objetivo'], ['material', '📎 Com meus materiais'], ['video', '🎬 A partir de vídeos']].map(([k, t]) => el('button', { type: 'button', class: st.mode === k ? 'on' : 'alt', 'aria-pressed': String(st.mode === k), onclick: () => { st.mode = k; paint(); } }, t)));
    matBox.replaceChildren(el('h2', {}, ico('📎'), ' Meus materiais bibliográficos ', st.mode === 'material' ? '(obrigatório: ao menos um)' : '(opcional)'), el('p', {}, 'Textos e anotações (.txt, .md) ou PDFs de até 5 MB. A IA prioriza o que você enviar e cita como material próprio.'),
      ...st.mats.map((m, i) => el('div', { class: 'box' }, bind(field('Título', 'mt', { value: m.title }), m, 'title'), bind(field('Autor e ano', 'ma', { value: m.author }), m, 'author'), bind(field('Texto (cole aqui) ou use o arquivo', 'mx', { tag: 'textarea', rows: 4, value: m.text }), m, 'text'),
        pick('.txt,.md,.html,.pdf,text/plain,application/pdf', async (f) => { if (/\.pdf$/i.test(f.name)) m.pdf = await b64(f); else m.text = await f.text(); if (!m.title) m.title = f.name; }), m.pdf ? el('p', {}, '📄 PDF anexado') : '', btn('Remover', () => { st.mats.splice(i, 1); paint(); }, 'alt'))),
      btn('➕ Adicionar material', () => { st.mats.push({ title: '', author: '', text: '', pdf: '' }); paint(); }, 'alt'));
    vidBox.replaceChildren(el('h2', {}, ico('🎬'), ' Vídeos ', st.mode === 'video' ? '(obrigatório: ao menos um)' : '(opcional)'), el('p', {}, 'Cole o link. A trilha usa a fala do vídeo (a transcrição) como contexto do argumento. Em branco, o servidor tenta obter as legendas do YouTube; se não conseguir, cole a transcrição ou envie um .txt/.srt/.vtt.'),
      ...st.vids.map((v, i) => el('div', { class: 'box' }, bind(field('Link do vídeo', 'vu', { type: 'url', value: v.url }), v, 'url'), bind(field('Transcrição (opcional)', 'vt', { tag: 'textarea', rows: 3, value: v.transcript }), v, 'transcript'),
        pick('.txt,.srt,.vtt,text/plain', async (f) => { v.transcript = clean(await f.text()); }), btn('Remover', () => { st.vids.splice(i, 1); paint(); }, 'alt'))),
      btn('➕ Adicionar vídeo', () => { st.vids.push({ url: '', transcript: '' }); paint(); }, 'alt'));
  }
  paint();
  const libBox = el('div', {}, lib.length ? [el('h2', {}, ico('🗂️'), ' Da minha biblioteca de materiais'), ...lib.map((m) => el('div', { class: 'f' }, el('label', {}, el('input', { type: 'checkbox', checked: st.ids.includes(m.id), onchange: (e) => { st.ids = e.target.checked ? [...st.ids, m.id] : st.ids.filter((x) => x !== m.id); } }), ' ' + m.title)))] : '', el('p', {}, link('🎙️ Importar uma aula em áudio ou vídeo', '#/aulas', 'alt')));
  if (pre) root.append(el('div', { class: 'msg' }, '🎙️ Trilha baseada na aula «' + pre.title + '»: a transcrição, o resumo, a bibliografia e o aprofundamento dela já estão marcados como material base.'));
  root.append(el('p', {}, 'Conte o que quer aprender e aonde quer chegar. A IA pesquisa a bibliografia atual, propõe a estratégia de estudos e escreve a trilha completa (assuntos, cartões e resumos visuais).' + (info.admin ? '' : ' Você gerou ' + info.used + ' de ' + info.limit + ' trilhas nas últimas 24 h.')),
    form([el('h2', {}, ico('🧬'), ' Dados base da trilha'), el('p', {}, 'A IA usa estes dados para planejar, pesquisar e escrever a sua trilha, etapa por etapa.'), el('h2', {}, 'Como quer montar?'), mb, field('Tema ou descrição do que quer estudar', 'theme', { tag: 'textarea', rows: 3, value: pre && pre.structure ? pre.structure.title + '. ' + (pre.structure.summary || '').slice(0, 300) : '' }), field('Objetivo final da trilha (ex.: passar na prova X, explicar o assunto Y)', 'objective', { req: true, value: pre ? 'Dominar o conteúdo da aula “' + ((pre.structure && pre.structure.title) || pre.title) + '” e a bibliografia associada' : '' }),
      select('Seu nível hoje', 'level', [['iniciante', 'Iniciante'], ['intermediário', 'Intermediário'], ['avançado', 'Avançado']], 'iniciante'), select('Como você aprende melhor', 'style', [['misto', 'Um pouco de tudo'], ['leitura', 'Lendo textos curtos'], ['audio', 'Ouvindo'], ['pratica', 'Praticando com perguntas'], ['visual', 'Com esquemas e imagens']], 'misto'), field('Minutos por sessão de estudo', 'session', { type: 'number', value: 25 }), field('Temas e conteúdos que quer cobrir (um por linha, opcional)', 'themes', { tag: 'textarea', rows: 4 }),
      libBox, matBox, vidBox, el('h2', {}, ico('⏱️'), ' Prazo e carga'), field('Prazo final (opcional)', 'deadline', { type: 'date' }), field('Horas de estudo por semana', 'hpw', { type: 'number', value: 5 }),
      el('p', {}, 'O sistema estima o tempo de conclusão pela dificuldade de cada assunto e pelo seu ritmo, e mostra no painel se você está no prazo.'), el('p', {}, submit('✨ Gerar trilha com IA', 'big'))],
      async (d) => {
        const mats = st.mats.filter((m) => m.title || m.text || m.pdf), vids = st.vids.filter((v) => v.url);
        if (st.mode === 'tema' && !d.theme.trim()) throw new Error('Descreva o tema que quer estudar.');
        if (st.mode === 'material' && !mats.length && !st.ids.length) throw new Error('Adicione ao menos um material.');
        if (st.mode === 'video' && !vids.length) throw new Error('Adicione ao menos um vídeo.');
        const j = await api('route_create', { body: { mode: st.mode, theme: d.theme, objective: d.objective, level: d.level, style: d.style, session: d.session, themes: d.themes, deadline: d.deadline, hpw: d.hpw, materials: mats, videos: vids, material_ids: st.ids } });
        pollJob(j.job);
      }));
  return root;
}

async function vRoute(id) {
  const d = await api('route_data', { qs: { id } }), a = analyze(d), r = d.route, pl = d.plan, paused = pl.status !== 'ativa', n = d.topics.reduce((s, t) => s + t.n, 0), k = d.topics.reduce((s, t) => s + t.k, 0);
  const dlReal = pl.deadline ? pl.deadline + (pl.paused_at ? d.now - pl.paused_at : 0) : null, dlIn = dlReal ? new Date(dlReal * 1000).toISOString().slice(0, 10) : '';
  const ex = a.status === 'concluida' ? 'Você dominou todos os cartões desta trilha.' : `Faltam cerca de ${fmtMin(a.rem)} de estudo. Com ${pl.hpw} h por semana, a previsão de conclusão é ${fmtDate(a.finish)}` + (dlReal ? `; o prazo é ${fmtDate(dlReal)} (${a.daysLeft} dias). Para cumprir, estude cerca de ${fmtMin(a.daily)} por dia.` : '. Defina um prazo para ver o plano.') + (a.frozen ? ' O tempo está congelado enquanto a trilha estiver desativada.' : '');
  const mx = Math.max(10, ...d.week.map((x) => x.min));
  const url = (b) => (safeUrl(b.url) ? [' ', el('a', { href: b.url, target: '_blank', rel: 'noopener noreferrer' }, 'abrir fonte')] : '');
  return el('div', { class: paused ? 'paused' : '' }, el('h1', {}, ico(r.emoji, 'bob'), ' ', r.name), el('p', {}, el('b', {}, 'Objetivo: '), r.objective || r.goal), el('p', {}, KIND[r.kind] || r.kind, paused ? ' · ⏸️ Desativada: só visualização; tempo e metas congelados.' : ''),
    el('div', { class: 'tools' }, el('button', { type: 'button', class: 'big', disabled: paused, onclick: async () => { await api('pkg_set', { body: { id } }); location.hash = '#/'; } }, '▶️ Estudar esta trilha'),
      act('route_state', { id, act: paused ? 'resume' : 'pause' }, null, paused ? '▶️ Reativar' : '⏸️ Desativar', 'alt'), btn('📤 Exportar', () => exportRoute(id, r.name), 'alt'),
      d.mine ? act('route_state', { id, act: 'delete' }, () => { location.hash = '#/trilhas'; }, '🗑️ Excluir', 'alt', 'Excluir esta trilha? Ela some da sua lista e o tempo fica congelado. A exclusão definitiva depende da aprovação do administrador, que também pode restaurá-la.') : '', link('🕸️ Mapa de conhecimento', '#/grafo/' + id, 'alt'), link('🔎 Biblioteca de aprofundamento', '#/aprofundamento/' + id, 'alt'), link('Todas as trilhas', '#/trilhas', 'alt')),
    el('section', { class: 'box hero' }, el('h2', {}, STATUS[a.status]), el('p', {}, ex, ' ', ouvir(STATUS[a.status] + '. ' + ex))),
    el('h2', {}, ico('📊'), ' Indicadores'),
    el('div', { class: 'grid' }, gauge(a.content, 'Conteúdo dominado', k + ' de ' + n + ' cartões'), gauge(a.timePct ?? 0, 'Prazo decorrido', dlReal ? a.daysLeft + ' dias restantes' : 'sem prazo'), gauge(Math.min(100, a.pace), 'Ritmo frente ao plano', 'índice ' + a.pace + '%'), gauge(a.weekPct, 'Meta da semana', fmtMin(a.weekDone) + ' de ' + fmtMin(a.weekGoal)), gauge(a.acc ?? 0, 'Acertos', a.A + ' respostas')),
    el('h2', {}, 'Estudo nos últimos 7 dias'),
    el('div', { class: 'wk-chart', role: 'img', 'aria-label': 'Minutos estudados por dia: ' + d.week.map((x) => x.d.slice(8) + '/' + x.d.slice(5, 7) + ' ' + Math.round(x.min) + ' min').join(', ') },
      d.week.map((x) => { const b = el('i'); b.style.height = Math.round(100 * x.min / mx) + '%'; return el('div', { class: 'col' }, el('span', {}, Math.round(x.min) + ''), el('div', { class: 'barv' }, b), el('small', {}, x.d.slice(8) + '/' + x.d.slice(5, 7))); })),
    el('h2', {}, 'Prazo e carga semanal'),
    el('section', { class: 'box' }, form([field('Prazo final para concluir', 'deadline', { type: 'date', value: dlIn }), field('Horas de estudo por semana', 'hpw', { type: 'number', value: pl.hpw }), el('p', {}, submit('Salvar e recalcular'))],
      async (f) => { await api('route_plan', { body: { id, deadline: f.deadline, hpw: f.hpw } }); notify('Plano atualizado.'); await render(true); })),
    d.mine ? await shareBox(id, d) : '',
    el('h2', {}, 'Assuntos: dificuldade e tempo estimado'),
    a.est.map((t) => el('div', { class: 'row' }, el('div', { class: 'grow' }, ico(t.emoji), ' ', el('b', {}, t.title), el('br'), 'Dificuldade ' + '●'.repeat(t.difficulty || 3) + '○'.repeat(5 - (t.difficulty || 3)) + ' · estimado ' + fmtMin(t.est) + ' · ' + t.pct + '% dominado', bar(t.pct, 'Domínio de ' + t.title)))),
    el('h2', {}, 'Cronograma sugerido'),
    a.sched.length ? el('ol', {}, a.sched.slice(0, 10).map((w) => el('li', {}, 'Semana ' + w.n + ' (a partir de ' + fmtDate(a.ref + (w.n - 1) * 7 * 86400) + '): ' + w.items.map((i) => i.title + ' (' + fmtMin(i.min) + ')').join('; ')))) : el('p', {}, 'Nada pendente: trilha concluída.'),
    r.strategy.length ? [el('h2', {}, ico('🧠'), ' Estratégia de estudos'), el('ul', {}, r.strategy.map((s) => el('li', {}, el('b', {}, s.tecnica), ': ', s.como, s.frequencia ? ' (' + s.frequencia + ')' : '', ' ', ouvir(s.tecnica + '. ' + s.como))))] : '',
    r.biblio.length ? [el('h2', {}, ico('📚'), ' Bibliografia'), el('ul', {}, r.biblio.map((b) => el('li', {}, el('b', {}, b.titulo), [b.autores, b.ano].filter(Boolean).length ? ' (' + [b.autores, b.ano].filter(Boolean).join(', ') + ')' : '', b.tipo ? ' · ' + b.tipo : '', b.por_que ? el('span', {}, el('br'), b.por_que) : '', b.verificada === false ? el('span', {}, el('br'), '⚠️ Confirme esta referência antes de usar.') : '', url(b), ' ', ouvir(b.titulo + '. ' + (b.por_que || '')))))] : '',
    (r.sources.videos || []).length ? [el('h2', {}, ico('🎬'), ' Vídeos usados'), el('ul', {}, r.sources.videos.map((v) => el('li', {}, v.titulo || v.url, ' ', v.transcricao ? '(transcrição usada)' : '(sem transcrição)')))] : '');
}

/* ---------- comunidade: explorar, trilha pública, grupos, materiais; contingência de IA ---------- */
const VIS = { privada: '🔒 Privada', grupos: '👥 Grupos', publica: '🌐 Pública' };
const likeBtn = (t) => btn((t.liked ? '💖 ' : '🤍 ') + (t.likes || 0), async () => { await api('route_like', { body: { id: t.id } }); await render(true); }, 'alt');
const pubCard = (t) => el('article', { class: 'box pub' }, el('div', { class: 'pub-top' }, el('span', { class: 'avatar', 'aria-hidden': 'true' }, (t.author || 'S')[0].toUpperCase()), el('span', {}, el('b', {}, t.author || 'Sistema'), el('br'), KIND[t.kind] || t.kind)),
  el('div', { class: 'bigico' }, ico(t.emoji, 'bob')), el('h3', {}, el('a', { href: '#/comunidade/' + t.id }, t.name)), el('p', {}, t.goal),
  el('div', { class: 'chips2' }, (t.tags || []).slice(0, 4).map((x) => el('a', { href: '#/explorar?q=' + encodeURIComponent(x) }, '#' + x))),
  el('p', { class: 'stats' }, '❤️ ' + (t.likes || 0) + ' · 👥 ' + (t.followers || 0) + ' · 📥 ' + (t.clones || 0) + (t.ntopics ? ' · 📚 ' + t.ntopics : '')),
  el('div', { class: 'tools' }, link('Ver trilha', '#/comunidade/' + t.id, ''), t.likes != null ? likeBtn(t) : '', ouvir(t.name + '. ' + t.goal)));
async function communityStrip() {
  let x; try { x = (await api('explore', { qs: { sort: 'populares', limit: 4 } })).routes.filter((r) => !r.mine).slice(0, 3); } catch { return ''; }
  return x.length ? el('section', { class: 'box' }, el('h2', {}, ico('🌐'), ' Em alta na comunidade'), el('div', { class: 'grid' }, x.map(pubCard)), el('div', { class: 'tools' }, link('Explorar tudo', '#/explorar', 'alt'))) : '';
}
async function vExplore(Q) {
  const q = Q.get('q') || '', kind = Q.get('kind') || '', sort = Q.get('sort') || 'populares', x = await api('explore', { qs: { q, kind, sort } });
  const go = (d) => { const h = '#/explorar?' + new URLSearchParams(Object.fromEntries(Object.entries(d).filter(([, v]) => v))).toString(); if (location.hash === h) render(); else location.hash = h; };
  return el('div', {}, el('h1', {}, ico('🧭', 'bob'), ' Explorar trilhas'), el('p', {}, 'Cursos e rotas de estudo criados pela comunidade, para objetivos específicos. Estude uma trilha, copie para a sua conta ou compartilhe as suas.'),
    el('section', { class: 'box' }, form([field('Buscar por tema, técnica ou objetivo', 'q', { value: q }), el('div', { class: 'grid' }, select('Tipo', 'kind', [['', 'Todos'], ...Object.entries(KIND)], kind), select('Ordem', 'sort', [['populares', 'Mais populares'], ['recentes', 'Mais recentes']], sort)), el('p', {}, submit('🔍 Buscar'))], async (d) => go(d))),
    x.routes.length ? el('div', { class: 'grid' }, x.routes.map(pubCard)) : el('p', {}, 'Nenhuma trilha encontrada. Que tal criar a primeira sobre esse tema?'), el('div', { class: 'tools' }, link('✨ Criar minha trilha', '#/trilhas/nova', 'big')));
}
async function vPublic(id) {
  const t = await api('route_public', { qs: { id } }), reload = () => render(true), sys = !t.owner_id, url = (b) => (safeUrl(b.url) ? [' ', el('a', { href: b.url, target: '_blank', rel: 'noopener noreferrer' }, 'abrir fonte')] : '');
  return el('div', {}, el('article', { class: 'box hero pubhead' }, el('div', { class: 'pub-top' }, el('span', { class: 'avatar', 'aria-hidden': 'true' }, (t.author || 'S')[0].toUpperCase()), el('span', {}, el('b', {}, t.author || 'Sistema'), el('br'), (KIND[t.kind] || t.kind) + ' · ' + (VIS[t.visibility] || '🌐 Pública') + (t.groups.length ? ' (' + t.groups.join(', ') + ')' : ''))),
      el('h1', {}, ico(t.emoji, 'bob'), ' ', t.name), el('p', {}, t.objective || t.goal), el('div', { class: 'chips2' }, t.tags.map((x) => el('a', { href: '#/explorar?q=' + encodeURIComponent(x) }, '#' + x))),
      el('p', { class: 'stats' }, '❤️ ' + t.likes + ' · 👥 ' + t.followers + ' estudando · 📥 ' + t.clones + ' cópias · 📚 ' + t.topics.length + ' assuntos'),
      el('div', { class: 'tools' }, t.mine || t.following ? link('📊 Abrir painel', '#/trilha/' + id, 'big') : btn('▶️ Estudar esta trilha', async () => { await api('route_follow', { body: { id } }); location.hash = '#/trilha/' + id; }, 'big'),
        !t.mine ? btn('📥 Copiar para minha conta', async () => { const r = await api('route_clone', { body: { id } }); toast('📥 Trilha copiada!'); burst(); location.hash = '#/trilha/' + r.id; }, 'alt big') : '', likeBtn(t),
        t.following && !t.mine && !sys ? act('route_unfollow', { id }, null, 'Deixar de seguir', 'alt') : '', t.is_admin && !t.mine && t.visibility !== 'privada' ? act('route_visibility', { id, visibility: 'privada', tags: t.tags.join(','), groups: [] }, null, '🚫 Despublicar (moderação)', 'alt', 'Despublicar esta trilha?') : '', ouvir(t.name + '. ' + (t.objective || t.goal)))),
    t.strategy.length ? [el('h2', {}, ico('🧠'), ' Estratégia de estudos'), el('ul', {}, t.strategy.map((s) => el('li', {}, el('b', {}, s.tecnica), ': ', s.como, s.frequencia ? ' (' + s.frequencia + ')' : '')))] : '',
    t.biblio.length ? [el('h2', {}, ico('📚'), ' Bibliografia'), el('ul', {}, t.biblio.map((b) => el('li', {}, el('b', {}, b.titulo), [b.autores, b.ano].filter(Boolean).length ? ' (' + [b.autores, b.ano].filter(Boolean).join(', ') + ')' : '', b.por_que ? el('span', {}, el('br'), b.por_que) : '', b.verificada === false ? el('span', {}, el('br'), '⚠️ Confirme esta referência.') : '', url(b))))] : '',
    el('h2', {}, 'Assuntos da trilha'), el('div', { class: 'grid' }, t.topics.map((x) => el('div', { class: 'box' }, ico(x.emoji), ' ', el('b', {}, x.title), el('br'), 'Dificuldade ' + '●'.repeat(x.difficulty || 3) + '○'.repeat(5 - (x.difficulty || 3)) + ' · ' + x.n + ' cartões'))),
    el('h2', {}, ico('💬'), ' Comentários (' + t.comments.length + ')'), form([field('Escreva um comentário', 'text', { req: true }), el('p', {}, submit('Comentar'))], async (d, f) => { await api('route_comment', { body: { id, text: d.text } }); f.reset(); await reload(); }),
    t.comments.map((c) => el('div', { class: 'row' }, el('div', {}, el('b', {}, c.uname), ' · ' + fmtDate(c.created), el('br'), c.text), c.mine || t.mine || t.is_admin ? act('comment_del', { id: c.id }, null, 'Apagar', 'alt') : '')));
}
async function vGroups() {
  const s = await api('groups');
  return el('div', {}, el('h1', {}, ico('👥', 'bob'), ' Grupos de estudo'), el('p', {}, 'Compartilhe trilhas só com quem você escolher. Para entrar num grupo, use o código de convite.'),
    el('div', { class: 'grid' }, s.groups.map((g) => el('div', { class: 'box' }, el('b', {}, el('a', { href: '#/grupo/' + g.id }, g.name)), el('br'), g.descr, el('br'), g.members + ' membros · ' + g.trails + ' trilhas' + (g.owner ? ' · você é o dono' : ''), g.code ? el('p', {}, 'Código: ', el('span', { class: 'tok' }, g.code)) : '', ouvir(g.name + '. ' + g.members + ' membros.')))),
    el('div', { class: 'grid' }, el('section', { class: 'box' }, el('h2', {}, 'Criar grupo'), form([field('Nome', 'name', { req: true }), field('Descrição', 'descr'), el('p', {}, submit('Criar grupo'))], async (d) => { await api('group_create', { body: d }); notify('Grupo criado.'); await render(true); })),
      el('section', { class: 'box' }, el('h2', {}, 'Entrar com código'), form([field('Código do convite', 'code', { req: true, cls: 'tok' }), el('p', {}, submit('Entrar'))], async (d) => { await api('group_join', { body: d }); notify('Você entrou no grupo.'); await render(true); }))));
}
async function vGroup(id) {
  const g = await api('group_data', { qs: { id } });
  return el('div', {}, el('h1', {}, ico('👥'), ' ', g.name), el('p', {}, g.descr), g.code ? el('p', {}, 'Código de convite: ', el('span', { class: 'tok' }, g.code)) : '',
    el('h2', {}, 'Trilhas compartilhadas'), g.trails.length ? el('div', { class: 'grid' }, g.trails.map(pubCard)) : el('p', {}, 'Nenhuma trilha compartilhada ainda. O autor escolhe os grupos no painel da trilha.'),
    el('h2', {}, 'Membros (' + g.members.length + ')'), el('ul', {}, g.members.map((m) => el('li', {}, m.name + (m.role === 'dono' ? ' (dono)' : '')))),
    g.owner || g.is_admin ? act('group_del', { id }, () => { location.hash = '#/grupos'; }, '🗑️ Excluir grupo', 'alt', 'Excluir o grupo? As trilhas deixam de ser compartilhadas com ele.') : act('group_leave', { id }, () => { location.hash = '#/grupos'; }, 'Sair do grupo', 'alt'));
}
async function vMaterials() {
  const s = await api('materials'), KINDS = [['texto', '📝 Texto e anotações'], ['link', '🔗 Link ou artigo'], ['video', '🎬 Vídeo'], ['pdf', '📄 PDF'], ['aula', '🎙️ Aula (áudio/vídeo)']];
  const matForm = (m) => {
    const st = { pdf: '' };
    const f = form([field('Título', 'title', { req: true, value: m.title }), field('Autor e ano', 'author', { value: m.author }), select('Tipo', 'kind', KINDS, m.kind || 'texto'), field('Link (opcional)', 'url', { type: 'url', value: m.url }), field('Texto (cole aqui)', 'text', { tag: 'textarea', rows: 5, value: m.text }), field('Etiquetas (separadas por vírgula)', 'tags', { value: (m.tags || []).join(', ') }),
      el('div', { class: 'f' }, el('label', {}, 'Arquivo (.txt, .md ou .pdf até 4 MB)'), el('input', { type: 'file', accept: '.txt,.md,.pdf,text/plain,application/pdf', onchange: async (e) => { const fl = e.target.files[0]; if (!fl) return; if (fl.size > 4e6) { notify('Arquivo grande demais.'); return; } if (/\.pdf$/i.test(fl.name)) st.pdf = await b64file(fl); else $('textarea', f).value = await fl.text(); } })), el('p', {}, submit('Salvar material'))],
      async (d) => { await api('material_save', { body: { id: m.id || 0, ...d, pdf: st.pdf } }); notify('Material salvo.'); await render(true); });
    return f;
  };
  return el('div', {}, el('h1', {}, ico('🗂️', 'bob'), ' Meus materiais'), el('p', {}, 'Guarde textos, anotações, links e PDFs. Ao criar uma trilha com IA, escolha quais materiais ela deve usar e citar.'),
    el('details', { class: 'box' }, el('summary', { class: 'btn' }, '➕ Novo material'), matForm({})),
    el('div', { class: 'grid' }, s.materials.map((m) => { const box = el('div', { class: 'box' }, el('b', {}, m.title), el('br'), (KINDS.find((k) => k[0] === m.kind) || [0, ''])[1] + (m.has_pdf ? ' · PDF anexado' : ''), el('p', {}, m.excerpt), el('div', { class: 'chips2' }, (m.tags || []).map((x) => el('span', {}, '#' + x))));
      box.append(el('div', { class: 'tools' }, btn('✏️ Editar', async () => { const full = await api('material_get', { qs: { id: m.id } }); box.replaceChildren(matForm(full)); }, 'alt'), act('material_del', { id: m.id }, null, '🗑️ Excluir', 'alt', 'Excluir este material?'), ouvir(m.title + '. ' + m.excerpt))); return box; })));
}
async function shareBox(id, d) {
  const gs = (await api('groups')).groups, vs = [['privada', '🔒 Privada (só eu)'], ['grupos', '👥 Só os grupos que eu escolher'], ['publica', '🌐 Pública (todos podem ver)']];
  return el('section', { class: 'box' }, el('h2', {}, ico('🌐'), ' Compartilhamento'), el('p', {}, 'Torne a trilha pública para a comunidade ou compartilhe só com grupos. Outros usuários podem estudar e copiar; o progresso e o painel de cada um continuam só dele.'),
    form([select('Quem pode ver', 'visibility', vs, d.route.visibility || 'privada'), field('Etiquetas (separadas por vírgula)', 'tags', { value: (d.route.tags || []).join(', ') }),
      gs.length ? el('div', {}, el('b', {}, 'Grupos com acesso (vale quando a opção for "grupos"):'), gs.map((g) => el('div', { class: 'f' }, el('label', {}, el('input', { type: 'checkbox', name: 'g' + g.id, checked: d.shares.includes(g.id) }), ' ' + g.name)))) : el('p', {}, 'Você ainda não tem grupos. ', link('Criar um grupo', '#/grupos', 'alt')),
      el('p', {}, submit('Salvar compartilhamento'))], async (f, fe) => { const groups = gs.filter((g) => fe.elements['g' + g.id] && fe.elements['g' + g.id].checked).map((g) => g.id); await api('route_visibility', { body: { id, visibility: f.visibility, tags: f.tags, groups } }); notify('Compartilhamento atualizado.'); await render(true); }));
}
function manualPanel(job, j, box) {
  const m = j.manual || {}, ta = field('Cole aqui a resposta da IA (o JSON)', 'text', { tag: 'textarea', rows: 8 });
  box.replaceChildren(el('h2', {}, ico('🛟', 'bob'), ' Modo agente: a IA automática não está disponível'), el('p', {}, j.msg),
    el('p', {}, '1) Copie o pedido abaixo e cole em qualquer IA ou agente (ChatGPT, Gemini, Claude, Copilot, um modelo local…). 2) Cole a resposta aqui. O sistema ajusta o formato sozinho.'),
    el('textarea', { rows: 6, readonly: true, 'aria-label': 'Pedido para a IA' }, m.prompt || ''), btn('📋 Copiar pedido', () => navigator.clipboard.writeText(m.prompt || '').then(() => toast('Pedido copiado!')).catch(() => {}), 'alt'),
    form([ta, el('p', {}, submit('Montar a trilha com a resposta', 'big'))], async (d) => { const r = await api('route_manual', { body: { job, text: d.text } }); await api('pkg_set', { body: { id: r.id } }); toast('🎉 Trilha criada!'); burst(); location.hash = '#/trilha/' + r.id; }),
    el('div', { class: 'tools' }, btn('🔄 Tentar a IA de novo', async () => { await api('route_retry', { body: { job } }); pollJob(job); }, 'alt'),
      btn('📝 Criar esqueleto agora (sem IA)', async () => { const r = await api('route_skeleton', { body: { job } }); await api('pkg_set', { body: { id: r.id } }); location.hash = '#/trilha/' + r.id; }, 'alt')));
}
async function expandTopic(id) {
  notify('✨ Gerando mais cartões… pode levar um minuto.');
  const r = await api('topic_expand', { body: { id } });
  if (!r.manual) { toast('✨ ' + r.added + ' itens novos' + (r.provider ? ' (' + r.provider + ')' : '')); await render(true); return; }
  const ta = field('Cole aqui a resposta da IA (JSON)', 'text', { tag: 'textarea', rows: 6 });
  notify(''); live.append(el('section', { class: 'box' }, el('h2', {}, ico('🛟'), ' Modo agente'), el('p', {}, 'A IA automática não respondeu: ' + r.manual.error), el('p', {}, 'Copie o pedido, cole em qualquer IA ou agente e traga a resposta de volta.'),
    el('textarea', { rows: 5, readonly: true, 'aria-label': 'Pedido para a IA' }, r.manual.prompt), btn('📋 Copiar pedido', () => navigator.clipboard.writeText(r.manual.prompt).then(() => toast('Copiado!')).catch(() => {}), 'alt'),
    form([ta, el('p', {}, submit('Aplicar resposta'))], async (d) => { const x = await api('topic_expand_apply', { body: { id, text: d.text } }); toast('✨ ' + x.added + ' itens novos'); await render(true); })));
}

/* ---------- escolha da versão (antes de começar) e menu "Mais" ---------- */
function vChooser() {
  const al = S.editions || 'ambas';
  const O = [['portal', '🌐', 'Portal', 'Comunidade de estudo para computador e tablet.', ['Explore e copie trilhas da comunidade', 'Grupos, comentários e curtidas', 'Biblioteca de materiais e cursos para objetivos específicos', 'Visual colorido, animado e cheio de conquistas']],
    ['acessivel', '📱', 'Mobile acessível', 'Feito para o celular e para quem enxerga pouco.', ['Letras grandes e alto contraste', 'Leitura em voz alta de cada item', 'Menu inferior simples, com 5 botões grandes', 'Revisões curtas e mapa da trilha']]].filter((o) => al === 'ambas' || al === o[0]);
  if (O.length === 1) { setTimeout(() => choose(O[0][0]), 0); return el('p', {}, 'Abrindo…'); }
  const txt = (o, i) => 'Opção ' + (i + 1) + ': ' + o[2] + '. ' + o[3] + ' ' + o[4].join('. ') + '.';
  const keys = (e) => { if (e.target.matches('input,textarea')) return; const o = O[+e.key - 1]; if (o) choose(o[0]); };
  document.addEventListener('keydown', keys); cleanup = () => document.removeEventListener('keydown', keys);
  return el('div', {}, el('div', { class: 'hero-logo' }, el('img', { class: 'logo-big', src: LOGO, alt: '' })), el('h1', {}, ico('✨', 'wig'), ' Como você quer usar o LearnPack?'),
    el('p', {}, 'Escolha a versão que combina com você. Dá para trocar depois em Mais → Trocar de versão. As teclas ', el('b', {}, '1'), ' e ', el('b', {}, '2'), ' também escolhem.'),
    el('div', { class: 'tools' }, btn('🔊 Ouvir as opções', () => say(O.map(txt).join(' ')), 'alt big'), pausa(), btn('Parar', () => ttsStop(), 'alt')),
    el('div', { class: 'opts' }, O.map((o, i) => el('section', { class: 'box opt', 'aria-labelledby': 'o' + i }, el('div', { class: 'bigico' }, ico(o[1], 'bob')), el('h2', { id: 'o' + i }, o[2]), el('p', {}, o[3]), el('ul', {}, o[4].map((x) => el('li', {}, x))),
      el('div', { class: 'tools' }, btn((i + 1) + ' · Usar ' + o[2], () => choose(o[0]), 'big'), ouvir(txt(o, i)))))),
    el('p', {}, '💡 Se você tem dificuldade para ler a tela, escolha ', el('b', {}, 'Mobile acessível'), '.'));
}
function vMore() {
  const L = [['🧭', 'Explorar a comunidade', '#/explorar'], ['👥', 'Grupos', '#/grupos'], ['🗂️', 'Meus materiais', '#/materiais'], ['🎙️', 'Aulas em áudio e vídeo', '#/aulas'], ['🕸️', 'Mapa de conhecimento', '#/grafo/0'], ['🔎', 'Biblioteca de aprofundamento', '#/aprofundamento/0'], ['🏆', 'Conquistas', '#/conquistas'], ['⚙️', 'Ajustes de leitura', '#/ajustes'], ['📖', 'Fontes de estudo', '#/fontes']];
  if (S.user.role === 'admin') L.push(['🛠️', 'Administração', '#/admin/users']);
  L.push(['🔀', 'Trocar de versão', '#/versao']);
  return el('div', {}, el('h1', {}, ico('☰'), ' Mais opções'), el('div', { class: 'grid' }, L.map(([e, t, h]) => link(e + ' ' + t, h, 'alt big'))), el('p', {}, btn('🚪 Sair da conta (' + S.user.name + ')', logout, 'big')));
}

/* ---------- aulas em áudio e vídeo: transcrição automática, estrutura, bibliografia e aprofundamento ---------- */
const MEDIA_ACCEPT = 'audio/*,video/*,.mp3,.m4a,.wav,.ogg,.opus,.flac,.aac,.webm,.mp4,.mov,.mkv,.avi,.mpeg,.mpg,.3gp,.wma,.wmv';
const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const MSTATUS = { enviando: '⬆️ Enviando', processando: '⚙️ Processando', manual: '✍️ Aguardando a transcrição', pronto: '✅ Pronta', erro: '❌ Erro' };
const cleanSubs = (t) => t.replace(/WEBVTT/g, '').replace(/^\d+\s*$/gm, '').replace(/\d{2}:\d{2}:\d{2}[.,]\d{3} --> .*/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
async function uploadMedia(file, o, onp) {
  const init = await api('media_init', { body: { name: file.name, size: file.size, mime: file.type, title: o.title, lang: o.lang, deep: o.deep, biblio: o.biblio } });
  const C = init.chunk, n = Math.max(1, Math.ceil(file.size / C));
  for (let i = 0; i < n; i++) {
    let ok = false, err; for (let t = 0; t < 3 && !ok; t++) { try { await apiRaw('media_chunk', { id: init.id, n: i }, file.slice(i * C, (i + 1) * C)); ok = true; } catch (e) { err = e; await new Promise((r) => setTimeout(r, 800 * (t + 1))); } }
    if (!ok) throw err; onp(Math.round(100 * (i + 1) / n));
  }
  await api('media_done', { body: { id: init.id } }); return init.id;
}
async function trackMedia(id, box) {
  const start = location.hash;
  for (let i = 0; i < 1500; i++) {
    let j; try { j = await api('media_job', { qs: { id } }); } catch { await new Promise((r) => setTimeout(r, 3000)); continue; }
    if (location.hash !== start) return;
    const st = $('.mstat', box); if (st) st.textContent = j.msg || ''; paintSteps(box, j.progress);
    if (j.status === 'pronto') { toast('🎙️ Aula pronta!'); burst(); location.hash = '#/aula/' + id; return; }
    if (j.status === 'erro') { notify(j.msg); return; }
    if (j.status === 'manual') { manualTranscript(id, j, box); return; }
    await new Promise((r) => setTimeout(r, 2500));
  }
}
function manualTranscript(id, j, box) {
  const ta = field('Cole aqui a transcrição da aula', 'text', { tag: 'textarea', rows: 8 });
  const fi = el('input', { type: 'file', accept: '.txt,.srt,.vtt,.md,text/plain', 'aria-label': 'Enviar arquivo de legendas', onchange: async (e) => { const f = e.target.files[0]; if (f) $('textarea', ta).value = cleanSubs(await f.text()); } });
  box.append(el('div', { class: 'msg' }, '🛟 ' + j.msg), form([ta, el('div', { class: 'f' }, el('label', {}, 'Ou envie um arquivo .txt, .srt ou .vtt'), fi), el('p', {}, submit('Continuar com este texto', 'big'))],
    async (d) => { await api('media_text', { body: { id, text: d.text } }); const nb = el('section', { class: 'box hero' }, el('h2', {}, ico('⚙️', 'bob'), ' Continuando…'), el('p', { class: 'mstat' }, '')); view.append(nb); trackMedia(id, nb); }));
}
async function vLessons() {
  const s = await api('media_list'), st = { file: null }, out = el('div');
  const upload = form([el('div', { class: 'f' }, el('label', { for: 'mf' }, 'Arquivo de áudio ou vídeo (até ' + s.max_mb + ' MB)'), el('input', { id: 'mf', type: 'file', accept: MEDIA_ACCEPT, onchange: (e) => { st.file = e.target.files[0] || null; } })),
    field('Título da aula (opcional: se vazio, a IA sugere)', 'title'), select('Idioma da fala', 'lang', [['pt-BR', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol']], 'pt-BR'),
    el('div', { class: 'f' }, el('label', {}, el('input', { type: 'checkbox', name: 'biblio', checked: true }), ' Encontrar e detalhar a bibliografia (com busca na web)')),
    el('div', { class: 'f' }, el('label', {}, el('input', { type: 'checkbox', name: 'deep', checked: true }), ' Criar material de aprofundamento')), el('p', {}, submit('⬆️ Enviar e processar', 'big'))],
    async (d) => {
      if (!st.file) throw new Error('Escolha um arquivo de áudio ou vídeo.');
      const box = el('section', { class: 'box hero' }, el('h2', {}, ico('⬆️', 'bob'), ' Enviando a aula…'), el('p', { class: 'mstat' }, '0%')); out.replaceChildren(box);
      const id = await uploadMedia(st.file, { title: d.title, lang: d.lang, deep: !!d.deep, biblio: !!d.biblio }, (p) => { $('.mstat', box).textContent = 'Enviando… ' + p + '%'; });
      $('h2', box).textContent = '⚙️ Processando a aula…'; $('.mstat', box).textContent = 'Recebida. Iniciando…'; trackMedia(id, box);
    });
  const items = s.media.map((m) => el('div', { class: 'row' }, el('div', {}, el('b', {}, m.title), el('br'), (MSTATUS[m.status] || m.status) + ' · ' + fmtSize(m.size) + ' · ' + fmtDate(m.created), m.status !== 'pronto' && m.msg ? el('br') : '', m.status !== 'pronto' ? m.msg : ''),
    el('div', { class: 'tools' }, m.status === 'pronto' ? link('📖 Abrir', '#/aula/' + m.id, '') : (m.status === 'processando' || m.status === 'manual') ? btn('👀 Acompanhar', () => { const box = el('section', { class: 'box hero' }, el('h2', {}, ico('⚙️', 'bob'), ' ' + m.title), el('p', { class: 'mstat' }, m.msg || '')); out.replaceChildren(box); trackMedia(m.id, box); }, 'alt') : btn('🔄 Tentar de novo', async () => { await api('media_retry', { body: { id: m.id } }); await render(true); }, 'alt'),
      act('media_del', { id: m.id }, null, '🗑️ Excluir', 'alt', 'Excluir esta aula? Os materiais já guardados na biblioteca continuam lá.'))));
  return el('div', {}, el('h1', {}, ico('🎙️', 'bob'), ' Aulas em áudio e vídeo'), el('p', {}, 'Envie o áudio ou o vídeo de uma aula. O sistema converte a fala em texto, estrutura a aula (capítulos, conceitos e fontes citadas), encontra e detalha a bibliografia, cria um material de aprofundamento e guarda tudo na sua biblioteca, pronto para virar trilha.'),
    s.stt ? '' : el('div', { class: 'msg' }, '🛟 Nenhum agente de IA com reconhecimento de fala está ativo. Você ainda pode enviar a aula e colar a transcrição quando o sistema pedir.'),
    el('section', { class: 'box' }, el('h2', {}, 'Nova aula'), upload), out, el('h2', {}, 'Minhas aulas'), items.length ? items : el('p', {}, 'Nenhuma aula ainda.'), el('p', {}, link('🗂️ Ver a biblioteca de materiais', '#/materiais', 'alt')));
}
async function vLesson(id) {
  const m = await api('media_get', { qs: { id } }), L = m.structure || {}, B = (m.bib && m.bib.biblio) || [], D = m.deep, av = (m.progress && m.progress.avisos) || [];
  const sect = (t, ...c) => el('section', { class: 'box' }, el('h2', {}, t), c);
  const dl = () => { const a = el('a', { href: URL.createObjectURL(new Blob([m.transcript], { type: 'text/plain' })), download: m.title.replace(/[^a-z0-9]+/gi, '-') + '-transcricao.txt' }); a.click(); };
  const url = (b) => (safeUrl(b.url) ? [' ', el('a', { href: b.url, target: '_blank', rel: 'noopener noreferrer' }, 'abrir fonte')] : '');
  return el('div', {}, el('h1', {}, ico('🎙️', 'bob'), ' ', L.title || m.title), el('p', {}, (MSTATUS[m.status] || m.status) + ' · ' + m.filename + ' · ' + fmtSize(m.size)),
    el('div', { class: 'tools' }, link('🧭 Criar trilha com esta aula', '#/trilhas/nova?aula=' + id, 'big'), link('🗂️ Ver na biblioteca', '#/materiais', 'alt big'), btn('⬇️ Baixar transcrição', dl, 'alt'), act('media_del', { id }, () => { location.hash = '#/aulas'; }, '🗑️ Excluir', 'alt', 'Excluir esta aula?'), link('Todas as aulas', '#/aulas', 'alt')),
    m.status !== 'pronto' ? el('div', { class: 'msg' }, m.msg) : '', av.length ? el('div', { class: 'msg' }, '⚠️ ' + av.join(' ')) : '',
    L.summary ? sect([ico('📝'), ' Resumo'], el('p', { id: 'ls' }, L.summary), speak('🔊 Ouvir o resumo', '#ls')) : '',
    (L.chapters || []).length ? sect('🧭 Capítulos', el('ol', {}, L.chapters.map((c) => el('li', {}, el('b', {}, '[' + c.t + '] ' + c.title), c.summary ? ': ' + c.summary : '', ' ', ouvir(c.title + '. ' + c.summary))))) : '',
    (L.key_concepts || []).length ? sect('💡 Conceitos-chave', el('ul', {}, L.key_concepts.map((c) => el('li', {}, el('b', {}, c.term), ': ', c.definition, ' ', ouvir(c.term + '. ' + c.definition))))) : '',
    (L.references_mentioned || []).length ? sect('🗣️ Fontes citadas pelo professor', el('ul', {}, L.references_mentioned.map((r) => el('li', {}, el('b', {}, r.name), r.t ? ' [' + r.t + ']' : '', r.context ? ': ' + r.context : '')))) : '',
    B.length ? sect('📚 Bibliografia detalhada', el('ul', {}, B.map((b) => el('li', {}, el('b', {}, b.titulo), [b.autores, b.ano].filter(Boolean).length ? ' (' + [b.autores, b.ano].filter(Boolean).join(', ') + ')' : '', b.tipo ? ' · ' + b.tipo : '', b.citada_na_aula ? el('span', { class: 'tagc' }, ' 📌 citada na aula' + (b.trecho ? ' [' + b.trecho + ']' : '')) : '', b.verificada === false ? el('span', { class: 'tagc' }, ' ⚠️ confirme') : '', b.por_que ? el('span', {}, el('br'), b.por_que) : '', url(b), ' ', ouvir(b.titulo + '. ' + (b.por_que || ''))))), m.bib && m.bib.sota ? el('p', {}, el('b', {}, 'Estado da arte: '), m.bib.sota) : '') : '',
    D ? sect('🔎 ' + D.title, D.sections.map((s) => el('div', {}, el('h3', {}, s.title), el('p', {}, s.text, ' ', ouvir(s.title + '. ' + s.text)), s.refs && s.refs.length ? el('small', {}, 'Fontes: ' + s.refs.join('; ')) : '')), D.questions.length ? el('div', {}, el('h3', {}, 'Para refletir'), el('ul', {}, D.questions.map((q) => el('li', {}, q)))) : '', D.next_steps.length ? el('div', {}, el('h3', {}, 'Próximos passos'), el('ul', {}, D.next_steps.map((q) => el('li', {}, q)))) : '') : '',
    (L.questions || []).length ? sect('❓ Perguntas de revisão', el('ul', {}, L.questions.map((q) => el('li', {}, q, ' ', ouvir(q))))) : '',
    m.transcript ? el('details', { class: 'box' }, el('summary', { class: 'btn alt', role: 'button' }, '📜 Ver a transcrição completa'), el('pre', { class: 'transc' }, m.transcript)) : '');
}

/* ---------- aprofundar um tópico (card ou tema), mapa de conhecimento (grafo 3D e fluxograma) e jogo bônus ---------- */
const deepItem = (x) => (x.kind === 'card'
  ? el('div', { class: 'box' }, el('b', {}, '🃏 ' + x.q), el('p', {}, x.a), (x.refs || []).length ? el('small', {}, 'Fontes: ' + x.refs.join('; ')) : '', ' ', ouvir(x.q + '. ' + x.a))
  : el('div', { class: 'box' }, el('b', {}, '📘 ' + x.title), el('p', {}, x.summary), (x.points || []).length ? el('ul', {}, x.points.map((p) => el('li', {}, p))) : '', (x.refs || []).length ? el('small', {}, 'Fontes: ' + x.refs.join('; ')) : '', ' ', ouvir(x.title + '. ' + x.summary)));
function deepBox(c, preset) {
  const out = el('div', { class: 'deepout', 'aria-live': 'polite' }), focus = el('input', { type: 'text', placeholder: 'ex.: como cai na prova', 'aria-label': 'Foco do aprofundamento' });
  const saved = (items, prov) => { c.onSaved && c.onSaved(items); out.replaceChildren(el('div', { class: 'msg' }, '✅ Salvo no mapa e na biblioteca de aprofundamento' + (prov ? ' (' + prov + ')' : '') + '.'), ...items.map(deepItem),
    el('div', { class: 'tools' }, link('🕸️ Ver no mapa', '#/grafo/' + c.package_id + '?topico=' + c.topic_id + '&nivel=3', 'alt'), link('🔎 Biblioteca de aprofundamento', '#/aprofundamento/' + c.package_id, 'alt'))); };
  const manual = (kind, m) => {
    const ta = field('Cole aqui a resposta da IA (JSON)', 'text', { tag: 'textarea', rows: 5 });
    out.replaceChildren(el('div', { class: 'msg' }, '🛟 ' + m.error + ' Copie o pedido, use qualquer IA ou agente e cole a resposta.'), el('textarea', { rows: 4, readonly: true, 'aria-label': 'Pedido para a IA' }, m.prompt), btn('📋 Copiar pedido', () => navigator.clipboard.writeText(m.prompt).then(() => toast('Copiado!')).catch(() => {}), 'alt'),
      form([ta, el('p', {}, submit('Salvar resposta'))], async (d) => { const r = await api('deep_apply', { body: { topic_id: c.topic_id, card_id: c.card_id || 0, parent: c.parent || 0, expand: c.expand ? 1 : 0, kind, text: d.text } }); saved(r.items); }));
  };
  const run = async (kind) => {
    out.replaceChildren(el('p', {}, '✨ Gerando… pode levar alguns segundos.'));
    try { const r = await api('deep_generate', { body: { topic_id: c.topic_id, card_id: c.card_id || 0, parent: c.parent || 0, expand: c.expand ? 1 : 0, kind, focus: focus.value } }); if (r.manual) manual(kind, r.manual); else saved(r.items, r.provider); } catch (e) { out.replaceChildren(el('div', { class: 'msg' }, e.message)); }
  };
  const box = el('section', { class: 'box deep' }, el('h2', {}, ico('🔎'), ' Aprofundar: ' + c.title), el('p', {}, 'Gera um card ou um tema de aprofundamento, fundamentado na bibliografia principal e alinhado ao objetivo da trilha. Fica salvo no mapa e na biblioteca de aprofundamento.'),
    el('div', { class: 'f' }, el('label', {}, 'Foco (opcional)'), focus), el('div', { class: 'tools' }, btn('🃏 Gerar card relacionado', () => run('card'), 'alt'), btn('📘 Gerar tema de aprofundamento', () => run('tema'), '')), out);
  if (preset) manual('card', preset);
  return box;
}
async function vDeepLib(id) {
  const r = await api('deep_list', { qs: { id } }), by = {}; r.items.forEach((x) => { (by[x.topic] = by[x.topic] || []).push(x); });
  return el('div', {}, el('h1', {}, ico('🔎', 'bob'), ' Biblioteca de aprofundamento'), el('p', {}, ico(r.pkg.emoji), ' ', el('b', {}, r.pkg.name), '. Cards e temas gerados por você durante a revisão ou no mapa, fundamentados na bibliografia da trilha.'),
    el('div', { class: 'tools' }, link('🕸️ Ver no mapa', '#/grafo/' + r.pkg.id + '?nivel=3', 'big'), link('🗂️ Biblioteca de materiais', '#/materiais', 'alt big'), link('🃏 Continuar revisando', '#/revisar/due', 'alt big')),
    r.items.length ? Object.entries(by).map(([tp, xs]) => el('section', { class: 'box' }, el('h2', {}, ico(xs[0].emoji || '📖'), ' ', tp), xs.map((x) => el('div', {}, deepItem(x), act('deep_del', { id: x.id }, null, '🗑️ Excluir', 'alt', 'Excluir este item?'))))) : el('div', { class: 'msg' }, 'Ainda não há aprofundamentos. Na revisão, toque no nome do tópico e gere um card ou um tema.'));
}
const NORM = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const DEEPC = ['#ff9ec7', '#ff7fb4', '#ff5fa2', '#e63f8a', '#c42672'];
const deepNode = (x) => ({ id: 'd' + x.id, type: 'deep', label: x.title, emoji: x.kind === 'tema' ? '📘' : '🔎', r: Math.max(6, 12 - (x.depth || 1)), color: DEEPC[Math.min(4, (x.depth || 1) - 1)], depth: x.depth || 1, data: x });
const deepParent = (x, has) => (x.parent_id && has('d' + x.parent_id)) ? 'd' + x.parent_id : (x.card_id && has('c' + x.card_id)) ? 'c' + x.card_id : has('t' + x.topic_id) ? 't' + x.topic_id : null;
function buildGraph(d, st, max) {
  const nodes = [], edges = [], ids = new Set(); let cut = false;
  const N = (n) => { if (nodes.length >= max) { cut = true; return null; } nodes.push(n); ids.add(n.id); return n; }, E = (a, b, len, kind) => { if (ids.has(a) && ids.has(b)) edges.push({ a, b, len, kind }); };
  N({ id: 'root', type: 'trail', label: d.route.name, emoji: d.route.emoji || '🧭', r: 26, color: '#2f8f7b', data: d.route });
  const T = d.topics.filter((t) => st.topics.has(t.id) && (!st.only || t.review)), SC = ['#cfe3ff', '#a8e6cf', '#ffe08a', '#ffc233'];
  T.forEach((t, i) => { if (N({ id: 't' + t.id, type: 'topic', label: t.title, emoji: t.emoji || '📖', r: 19, color: SC[t.stars], weak: t.weak, data: t })) E(i ? 't' + T[i - 1].id : 'root', 't' + t.id, 80, 'seq'); });
  if (st.level >= 2) T.forEach((t) => d.cards.filter((c) => c.topic_id === t.id).sort((a, b) => b.due - a.due).slice(0, 6).forEach((c) => { if (N({ id: 'c' + c.id, type: 'card', label: c.q, emoji: '🃏', r: 8, color: '#b79cff', data: c })) E('t' + t.id, 'c' + c.id, 50, 'card'); }));
  d.deep.filter((x) => st.topics.has(x.topic_id)).slice().sort((a, b) => a.id - b.id).forEach((x) => { const pa = deepParent(x, (i) => ids.has(i)); if (pa && N(deepNode(x))) E(pa, 'd' + x.id, 55, 'deep'); });   // aprofundamentos: aparecem sob o item que foi expandido
  if (st.level >= 3) {
    d.biblio.forEach((b, i) => { if (!b.titulo) return; const n = N({ id: 'b' + i, type: 'biblio', label: b.titulo, emoji: '📚', r: 12, color: '#7ddc9a', data: b }); if (!n) return; let any = false; T.forEach((t) => { if ((t.refs || []).some((x) => NORM(x).includes(NORM(b.titulo)) || NORM(b.titulo).includes(NORM(x)))) { E('t' + t.id, 'b' + i, 95, 'ref'); any = true; } }); if (!any) E('root', 'b' + i, 120, 'ref'); });
  }
  if (st.level >= 4) d.related.forEach((r) => { if (!N({ id: 'r' + r.id, type: 'other', label: r.name, emoji: r.emoji || '🧭', r: 16, color: '#ffb347', data: r })) return; E('root', 'r' + r.id, 140, 'rel'); d.biblio.forEach((b, i) => { if (r.shared.includes(NORM(b.titulo)) || r.shared.includes(String(b.titulo || '').toLowerCase().trim())) E('r' + r.id, 'b' + i, 100, 'rel'); }); });
  return { nodes, edges, cut };
}
function Graph3D(canvas, nodes, edges, o = {}) {
  const ctx = canvas.getContext('2d'), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, F = 520, pts = new Map();
  let W = 0, H = 0, dpr = 1, ay = 0.7, ax = 0.35, zoom = 1, auto = !!o.auto && !reduce, sel = null, hov = null, down = null, dead = false, miss = 0, last = performance.now(), pinch = 0, tick = 0, css = null;
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  nodes.forEach((n, i) => { const a = i * 2.399963, y = 1 - (i + 0.5) / nodes.length * 2, r = Math.sqrt(Math.max(0, 1 - y * y)); n.x = Math.cos(a) * r * 170 + (Math.random() - 0.5) * 24; n.y = y * 170 + (Math.random() - 0.5) * 24; n.z = Math.sin(a) * r * 170 + (Math.random() - 0.5) * 24; n.vx = n.vy = n.vz = 0; });
  const E = edges.map((e) => [idx.get(e.a), idx.get(e.b), e.len || 90]).filter((e) => e[0] !== undefined && e[1] !== undefined);
  const phys = () => {
    for (let i = 0; i < nodes.length; i++) { const a = nodes[i]; for (let j = i + 1; j < nodes.length; j++) { const b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; const d2 = dx * dx + dy * dy + dz * dz + 0.5, d = Math.sqrt(d2), f = 2800 / d2; dx = dx / d * f; dy = dy / d * f; dz = dz / d * f; a.vx += dx; a.vy += dy; a.vz += dz; b.vx -= dx; b.vy -= dy; b.vz -= dz; } }
    for (const [i, j, L] of E) { const a = nodes[i], b = nodes[j]; let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z; const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, f = (d - L) * 0.025; dx = dx / d * f; dy = dy / d * f; dz = dz / d * f; a.vx += dx; a.vy += dy; a.vz += dz; b.vx -= dx; b.vy -= dy; b.vz -= dz; }
    for (const n of nodes) { n.vx -= n.x * 0.006; n.vy -= n.y * 0.006; n.vz -= n.z * 0.006; n.vx *= 0.8; n.vy *= 0.8; n.vz *= 0.8; n.x += n.vx; n.y += n.vy; n.z += n.vz; }
  };
  for (let k = 0; k < 280; k++) phys();
  const Zs = () => Math.min(W, H) / 320 * zoom;
  function proj() { const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax), Z = Zs(); for (const n of nodes) { const x1 = n.x * cy - n.z * sy, z1 = n.x * sy + n.z * cy, y1 = n.y * cx - z1 * sx, z2 = n.y * sx + z1 * cx, s = F / (F + z2 + 260); n.pz = z2; n.ps = s * Z; n.px = W / 2 + x1 * n.ps; n.py = H / 2 + y1 * n.ps; } }
  function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; if (w && h && (w !== W || h !== H)) { W = w; H = h; dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); } }
  function draw(t) {
    if (!css || tick++ % 90 === 0) { const b = getComputedStyle(document.body); css = { fg: b.getPropertyValue('--fg').trim() || '#10131a', card: b.getPropertyValue('--card').trim() || '#fff', ac: b.getPropertyValue('--ac').trim() || '#5428d8' }; }
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = css.card; ctx.fillRect(0, 0, W, H); const gr = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, Math.max(W, H) * 0.7); gr.addColorStop(0, 'rgba(120,200,190,.22)'); gr.addColorStop(1, 'rgba(120,120,200,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    proj(); const order = nodes.slice().sort((a, b) => b.pz - a.pz), Z = Zs();
    for (const [i, j] of E) { const a = nodes[i], b = nodes[j], on = sel && (a === sel || b === sel); ctx.globalAlpha = on ? 0.95 : 0.32; ctx.strokeStyle = on ? css.ac : css.fg; ctx.lineWidth = on ? 2.6 : 1; ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke(); }
    for (const n of order) {
      const r = Math.max(4, n.r * n.ps); ctx.globalAlpha = Math.min(1, 0.4 + n.ps / Z * 0.6); ctx.fillStyle = n.color; ctx.beginPath(); ctx.arc(n.px, n.py, r, 0, 7); ctx.fill();
      ctx.lineWidth = n === sel ? 3.5 : 1.6; ctx.strokeStyle = n === sel ? css.ac : n.weak ? '#e0334f' : css.fg; if (n.weak) ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
      if (n === sel && !reduce) { ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(n.px, n.py, r + 4 + Math.sin(t / 220) * 3, 0, 7); ctx.stroke(); }
      if (n.born && t - n.born < 1600 && !reduce) { ctx.globalAlpha = 1 - (t - n.born) / 1600; ctx.lineWidth = 3; ctx.strokeStyle = '#e63f8a'; ctx.beginPath(); ctx.arc(n.px, n.py, r + (t - n.born) / 70, 0, 7); ctx.stroke(); }
      ctx.globalAlpha = Math.min(1, 0.5 + n.ps / Z * 0.5); ctx.font = Math.max(8, Math.round(r * 1.1)) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#10131a'; ctx.fillText(n.emoji, n.px, n.py + 1);
      if (n.type === 'trail' || n.type === 'topic' || n === sel || n === hov) { const lab = n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label; ctx.globalAlpha = 1; ctx.font = '700 ' + Math.max(11, Math.round(12.5 * Math.min(1.5, n.ps / Z + 0.3))) + 'px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = css.card; ctx.strokeText(lab, n.px, n.py + r + 11); ctx.fillStyle = css.fg; ctx.fillText(lab, n.px, n.py + r + 11); }
      n.bx = null;   // botão “+”: expande um nível de profundidade a partir deste item
      if (o.canExpand && (n.type !== 'card' || n === sel || n === hov) && o.canExpand(n)) {
        const br = Math.max(8, Math.min(13, r * 0.62)); n.bx = n.px + r * 0.8; n.by = n.py - r * 0.8; n.br = br; ctx.globalAlpha = 1;
        ctx.fillStyle = '#5b21b6'; ctx.beginPath(); ctx.arc(n.bx, n.by, br, 0, 7); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.lineWidth = 2.2;
        if (n.busy) { ctx.beginPath(); ctx.arc(n.bx, n.by, br * 0.55, t / 160, t / 160 + 4.2); ctx.stroke(); }
        else { const k = br * 0.5; ctx.beginPath(); ctx.moveTo(n.bx - k, n.by); ctx.lineTo(n.bx + k, n.by); ctx.moveTo(n.bx, n.by - k); ctx.lineTo(n.bx, n.by + k); ctx.stroke(); }
      }
    }
    ctx.globalAlpha = 1;
  }
  const hit = (x, y) => { let best = null; for (const n of nodes.slice().sort((a, b) => a.pz - b.pz)) { const r = Math.max(8, n.r * n.ps) + 4; if ((n.px - x) ** 2 + (n.py - y) ** 2 <= r * r) { best = n; break; } } return best; };
  const hitBadge = (x, y) => { let best = null, bd = 1e9; for (const n of nodes) { if (n.bx == null) continue; const d2 = (n.bx - x) ** 2 + (n.by - y) ** 2; if (d2 <= (n.br + 6) ** 2 && (d2 < bd - 1 || (Math.abs(d2 - bd) <= 1 && best && n.pz < best.pz))) { best = n; bd = d2; } } return best; };   // o + mais próximo do ponto tocado (desempata pelo mais perto da câmera)
  const pos = (e) => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, pos(e)); down = { x: e.clientX, y: e.clientY, moved: 0, badge: hitBadge(...pos(e)) }; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e); if (pts.has(e.pointerId)) { const q = pts.get(e.pointerId); pts.set(e.pointerId, p);
      if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) zoom = Math.max(0.5, Math.min(2.8, zoom * d / pinch)); pinch = d; }
      else if (down) { const dx = p[0] - q[0], dy = p[1] - q[1]; down.moved += Math.abs(dx) + Math.abs(dy); ay += dx * 0.008; ax = Math.max(-1.4, Math.min(1.4, ax + dy * 0.008)); } }
    else { const h = hit(p[0], p[1]), bb = hitBadge(p[0], p[1]); if (h !== hov) hov = h; canvas.style.cursor = (bb || h) ? 'pointer' : 'grab'; }
  });
  const up = (e) => { const p = pos(e); if (down && down.moved < 6 && pts.size <= 1) { if (down.badge && o.onExpand) o.onExpand(down.badge); else { const h = hit(p[0], p[1]); api2.select(h); } } pts.delete(e.pointerId); if (!pts.size) { down = null; pinch = 0; } };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); down = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.5, Math.min(2.8, zoom * Math.exp(-e.deltaY * 0.001))); }, { passive: false });
  canvas.addEventListener('keydown', (e) => { const k = e.key; if (k === 'ArrowLeft') ay -= 0.12; else if (k === 'ArrowRight') ay += 0.12; else if (k === 'ArrowUp') ax = Math.max(-1.4, ax - 0.12); else if (k === 'ArrowDown') ax = Math.min(1.4, ax + 0.12); else if (k === '+' || k === '=') zoom = Math.min(2.8, zoom * 1.12); else if (k === '-') zoom = Math.max(0.5, zoom / 1.12); else if (k === ' ') auto = !auto; else if ((k === 'e' || k === 'E') && sel && o.onExpand && o.canExpand && o.canExpand(sel)) o.onExpand(sel); else return; e.preventDefault(); });
  function loop(t) { if (dead) return; if (!canvas.isConnected) { if (++miss > 150) return; } else { miss = 0; resize(); if (W && H) { if (auto && !down) ay += 0.0035 * Math.min(3, (t - last) / 16); draw(t); } } last = t; requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
  const api2 = { nodes, has: (id) => idx.has(id), size: () => ({ n: nodes.length, e: E.length }), setBusy(id, v) { const n = nodes[idx.get(id)]; if (n) n.busy = !!v; },
    addNodes(nn, ee) { nn.forEach((n) => { const pe = ee.find((e) => e.b === n.id), pn = pe && nodes[idx.get(pe.a)]; n.x = (pn ? pn.x : 0) + (Math.random() - 0.5) * 40; n.y = (pn ? pn.y : 0) + (Math.random() - 0.5) * 40; n.z = (pn ? pn.z : 0) + (Math.random() - 0.5) * 40; n.vx = n.vy = n.vz = 0; n.born = performance.now(); idx.set(n.id, nodes.length); nodes.push(n); });
      ee.forEach((e) => { const a = idx.get(e.a), b = idx.get(e.b); if (a !== undefined && b !== undefined) E.push([a, b, e.len || 90]); }); for (let k = 0; k < 90; k++) phys(); },
    select(n) { sel = n; if (o.onSelect) o.onSelect(n); }, setAuto(v) { auto = !!v && !reduce; }, reset() { ay = 0.7; ax = 0.35; zoom = 1; }, zoomBy(f) { zoom = Math.max(0.5, Math.min(2.8, zoom * f)); }, destroy() { dead = true; } };
  canvas.__g3 = api2; return api2;
}
function flowchart(d, st, onPick, X) {
  const T = d.topics.filter((t) => st.topics.has(t.id) && (!st.only || t.review)), root = el('div', { class: 'flow' });
  root.append(el('button', { type: 'button', class: 'fl-root', onclick: () => onPick({ type: 'trail', data: d.route }) }, ico(d.route.emoji || '🧭'), ' ', el('b', {}, d.route.name), el('br'), el('small', {}, d.route.objective || d.route.goal || '')));
  if (!T.length) root.append(el('p', { class: 'msg' }, 'Nenhum tópico para mostrar com este filtro.'));
  const cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  const plus = (type, x, label) => {   // botão +: expande um nível de profundidade
    if (!X) return ''; const c = X.canX(type, x), b = X.busy.has(X.key(type, x));
    return el('button', { type: 'button', class: 'fl-plus', 'aria-label': 'Expandir um nível de profundidade: ' + cut(label, 60), title: c.ok ? 'Expandir um nível mais fundo' : c.why, disabled: !c.ok, 'aria-disabled': String(b), 'aria-busy': String(b), onclick: () => X.expand(type, x) }, b ? '⏳' : '+');
  };
  const item = (type, x) => {
    const chip = type === 'card' ? el('button', { type: 'button', class: 'alt fl-card' + (x.due ? ' due' : ''), onclick: () => onPick({ type: 'card', data: x }) }, '🃏 ' + cut(x.q, 46))
      : el('button', { type: 'button', class: 'alt fl-card deep d' + (x.depth || 1), onclick: () => onPick({ type: 'deep', data: x }) }, (x.kind === 'tema' ? '📘 ' : '🔎 ') + cut(x.title, 40), el('span', { class: 'lvl' }, 'Nível ' + (x.depth || 1)));
    const kids = X ? X.kidsOf(type, x) : [];
    return el('div', { class: 'fl-item' + (type === 'deep' && X && X.fresh.has(x.id) ? ' fresh' : '') }, el('div', { class: 'fl-line' }, chip, plus(type, x, type === 'card' ? x.q : x.title)),
      kids.length ? el('div', { class: 'fl-kids', role: 'group', 'aria-label': 'Aprofundamentos de ' + cut(type === 'card' ? x.q : x.title, 40) }, kids.map((k) => item('deep', k))) : '');
  };
  T.forEach((t) => {
    const cs = d.cards.filter((c) => c.topic_id === t.id).sort((a, b) => b.due - a.due).slice(0, 8), dp = X ? X.kidsOf('topic', t) : d.deep.filter((x) => x.topic_id === t.id);
    root.append(el('div', { class: 'fl-arrow', 'aria-hidden': 'true' }, '↓'), el('div', { class: 'fl-row' },
      el('div', { class: 'fl-topicwrap' }, el('button', { type: 'button', class: 'fl-topic' + (t.weak ? ' weak' : ''), onclick: () => onPick({ type: 'topic', data: t }) }, ico(t.emoji || '📖'), ' ', el('b', {}, t.title), el('br'), el('small', {}, '★'.repeat(t.stars) + '☆'.repeat(3 - t.stars) + ' · ' + t.k + '/' + t.n + ' dominados' + (t.due ? ' · ' + t.due + ' p/ revisar' : '') + (t.weak ? ' · reforçar' : ''))), plus('topic', t, t.title)),
      el('div', { class: 'fl-cards' }, cs.map((c) => item('card', c)), dp.map((x) => item('deep', x)))));
  });
  return root;
}
async function vGraph(id, Q) {
  const G = S.graph || {};
  if (G.on === false) return el('div', {}, el('h1', {}, 'Mapa de conhecimento'), el('div', { class: 'msg' }, 'O mapa está desligado pelo administrador.'));
  const d = await api('graph_data', { qs: { id } }), foco = Q && Q.get('topico') ? +Q.get('topico') : 0;
  const st = { level: +(Q && Q.get('nivel')) || G.level || 2, mode: (Q && Q.get('modo')) || G.mode || '3d', only: Q && Q.get('rev') === '1', topics: new Set(foco ? [foco] : d.topics.map((t) => t.id)) };
  const LV = ['1 · Essencial: trilha e tópicos (e as expansões que você fez)', '2 · Com cartões', '3 · Com bibliografia e aprofundamentos', '4 · Rede completa: outras trilhas vinculadas'];
  const stage = el('div', { class: 'stage' }), panel = el('aside', { class: 'box gpanel', 'aria-live': 'polite' }), chips = el('div', { class: 'chips2 tchips', role: 'group', 'aria-label': 'Tópicos incluídos' }), count = el('p', { class: 'gcount' }), list = el('details', { class: 'box' }); let g3 = null, curM = null, curSel = null;
  const FLOWTXT = 'Fluxograma simples: a trilha, os tópicos em ordem e os cartões de cada um. Cartões com borda forte estão para revisar. Use o botão + de um item para ir um nível mais fundo.';
  const maxD = G.max_depth || 3, busy = new Set(), fresh = new Set(), keyOf = (type, x) => (type === 'topic' ? 't' : type === 'card' ? 'c' : 'd') + x.id;
  const kidsOf = (type, x) => d.deep.filter((y) => type === 'topic' ? (y.topic_id === x.id && !y.card_id && !y.parent_id) : type === 'card' ? (y.card_id === x.id && !y.parent_id) : y.parent_id === x.id);
  const canX = (type, x) => type === 'deep' && (x.depth || 1) >= maxD ? { ok: false, why: 'Nível máximo de profundidade (' + maxD + ') atingido.' } : kidsOf(type, x).length >= 9 ? { ok: false, why: 'Limite de 9 itens nesta ramificação.' } : { ok: true };
  const flowView = () => flowchart(d, st, select, { kidsOf, canX, busy, fresh, key: keyOf, expand });
  const redrawFlow = () => { const y = scrollY, ae = document.activeElement, lab = ae && ae.classList && ae.classList.contains('fl-plus') ? ae.getAttribute('aria-label') : null; stage.replaceChildren(flowView(), el('p', { class: 'legend' }, FLOWTXT)); scrollTo(0, y); if (lab) { const nb = [...stage.querySelectorAll('.fl-plus')].find((b) => b.getAttribute('aria-label') === lab); if (nb) nb.focus(); } setTimeout(() => fresh.clear(), 800); };
  const sizeTxt = () => { if (g3) { const z = g3.size(); count.textContent = z.n + ' itens · ' + z.e + ' ligações'; } };
  function ingest(items) {   // coloca os itens recém-criados no grafo ou no fluxograma sem recarregar a tela
    const add = (items || []).filter((it) => !d.deep.some((y) => y.id === it.id)); if (!add.length) return;
    add.sort((a, b) => a.id - b.id).forEach((it) => { d.deep.push(it); fresh.add(it.id); });
    if (g3) { const nn = [], ee = []; add.forEach((it) => { if (!st.topics.has(it.topic_id)) return; const pa = deepParent(it, (i) => g3.has(i)); if (!pa) return; const n = deepNode(it); nn.push(n); ee.push({ a: pa, b: n.id, len: 55 }); }); if (nn.length) { g3.addNodes(nn, ee); sizeTxt(); paintList(curM); } }
    else redrawFlow();
  }
  function openManual(type, x, m) {   // IA fora do ar: pedido para copiar e resposta para colar, já ligados a este ramo
    const ctx = { topic_id: type === 'topic' ? x.id : x.topic_id, package_id: d.route.id, card_id: type === 'card' ? x.id : type === 'deep' ? (x.card_id || 0) : 0, parent: type === 'deep' ? x.id : 0, expand: true, title: x.title || x.q || 'item', onSaved: ingest };
    panel.replaceChildren(el('h2', {}, '➕ Expandir nível'), deepBox(ctx, m)); if (panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest' });
  }
  async function expand(type, x) {   // botão +: gera o próximo nível de profundidade sob este item
    const key = keyOf(type, x), c = canX(type, x); if (busy.has(key)) return; if (!c.ok) { toast(c.why); return; }
    busy.add(key); if (g3) g3.setBusy(key, true); else redrawFlow(); notify('Gerando o próximo nível de profundidade…'); let man = false;
    try {
      const body = type === 'topic' ? { topic_id: x.id } : type === 'card' ? { topic_id: x.topic_id, card_id: x.id } : { parent: x.id, topic_id: x.topic_id };
      const r = await api('deep_generate', { body: { ...body, kind: 'card', expand: 1 } });
      if (r.manual) { man = true; openManual(type, x, r.manual); return; }
      ingest(r.items); const lv = r.items[0] ? (r.items[0].depth || 1) : 1; toast('➕ ' + r.items.length + (r.items.length === 1 ? ' item novo' : ' itens novos') + ' no nível ' + lv + (r.provider ? ' · ' + r.provider : ''));
    } catch (e) { toast(e.message); }
    finally { busy.delete(key); if (g3) g3.setBusy(key, false); else redrawFlow(); if (!man && curSel && curSel.data === x) select(curSel); }
  }
  const expBtn = (type, x) => { const c = canX(type, x), n = kidsOf(type, x).length, lv = type === 'deep' ? (x.depth || 1) + 1 : 1, b = btn('➕ Expandir nível ' + lv, () => expand(type, x), 'alt'); b.disabled = !c.ok || busy.has(keyOf(type, x)); if (!c.ok) b.title = c.why;
    return el('span', { class: 'expwrap' }, b, n ? el('small', {}, n + (n === 1 ? ' item' : ' itens') + ' neste ramo') : '', c.ok ? '' : el('small', {}, c.why)); };
  const info = (txt) => panel.replaceChildren(el('h2', {}, 'Detalhes'), el('p', {}, txt));
  function select(n) {
    curSel = n || null; if (!n) return info('Toque ou clique em um item para ver os detalhes.'); const x = n.data, t = n.type, pid = d.route.id, btns = [];
    if (t === 'trail') panel.replaceChildren(el('h2', {}, ico(x.emoji || '🧭'), ' ', x.name), el('p', {}, x.objective || x.goal || ''), el('div', { class: 'tools' }, link('📊 Painel da trilha', '#/trilha/' + pid, 'alt'), link('🔎 Biblioteca de aprofundamento', '#/aprofundamento/' + pid, 'alt')));
    else if (t === 'topic') { const host = el('div'); panel.replaceChildren(el('h2', {}, ico(x.emoji || '📖'), ' ', x.title), el('p', {}, '★'.repeat(x.stars) + '☆'.repeat(3 - x.stars) + ' · ' + x.k + ' de ' + x.n + ' cartões dominados' + (x.acc != null ? ' · acertos ' + x.acc + '%' : '') + (x.weak ? ' · reforço recomendado' : '')), (x.refs || []).length ? el('p', {}, el('b', {}, 'Fontes: '), x.refs.join('; ')) : '',
      el('div', { class: 'tools' }, link('📖 Abrir assunto', '#/topico/' + x.id, 'alt'), link('🃏 Praticar', '#/revisar/topic/' + x.id, 'alt'), btn('🔎 Aprofundar', () => { host.replaceChildren(deepBox({ topic_id: x.id, package_id: pid, card_id: 0, title: x.title, onSaved: ingest })); }, ''), expBtn('topic', x)), host); }
    else if (t === 'card') { const tp = d.topics.find((y) => y.id === x.topic_id), host = el('div'), a = el('p', { hidden: true }, el('b', {}, 'Resposta: '), x.a); panel.replaceChildren(el('h2', {}, '🃏 Cartão'), el('p', { class: 'qz' }, x.q), a, el('div', { class: 'tools' }, btn('Mostrar resposta', () => { a.hidden = false; }, 'alt'), btn('🔎 Aprofundar', () => { host.replaceChildren(deepBox({ topic_id: x.topic_id, package_id: pid, card_id: x.id, title: tp ? tp.title : 'tópico', onSaved: ingest })); }, ''), ouvir(x.q + '. ' + x.a), pausa(), expBtn('card', x)), host); }
    else if (t === 'biblio') panel.replaceChildren(el('h2', {}, '📚 ', x.titulo), el('p', {}, [x.autores, x.ano].filter(Boolean).join(', ') + (x.tipo ? ' · ' + x.tipo : '')), x.por_que ? el('p', {}, x.por_que) : '', x.verificada === false ? el('p', {}, '⚠️ Confirme esta referência.') : '', safeUrl(x.url) ? el('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, 'abrir fonte') : '');
    else if (t === 'deep') panel.replaceChildren(el('h2', {}, '🔎 Aprofundamento · nível ' + (x.depth || 1)), deepItem(x), el('div', { class: 'tools' }, expBtn('deep', x), link('🔎 Biblioteca de aprofundamento', '#/aprofundamento/' + pid, 'alt')));
    else if (t === 'other') panel.replaceChildren(el('h2', {}, ico(x.emoji || '🧭'), ' ', x.name), el('p', {}, 'Trilha vinculada' + (x.common.length ? ' por etiquetas em comum: ' + x.common.join(', ') : '') + (x.shared.length ? ' · obras em comum: ' + x.shared.length : '') + (x.linked ? ' · mesma origem' : '') + '.'), el('div', { class: 'tools' }, link('🕸️ Abrir o mapa dela', '#/grafo/' + x.id, 'alt'), link('Ver a trilha', '#/comunidade/' + x.id, 'alt')));
  }
  const pick = (n) => { if (g3) g3.select(n); else select(n); };
  function paint() {
    if (g3) { g3.destroy(); g3 = null; } const M = curM = buildGraph(d, st, G.max_nodes || 160);
    count.textContent = M.nodes.length + ' itens · ' + M.edges.length + ' ligações' + (M.cut ? ' (limitado para ficar legível; reduza o nível ou escolha menos tópicos)' : '');
    if (st.mode === '3d') {
      const cv = el('canvas', { class: 'g3d', tabindex: 0, role: 'img', 'aria-label': 'Grafo 3D do conhecimento da trilha. Arraste para girar, use a roda ou as teclas + e - para aproximar e as setas para girar. A lista abaixo traz os mesmos itens.', 'data-nodes': M.nodes.length });
      const legend = el('p', { class: 'legend' }, '🌐 arraste para girar · roda ou pinça para aproximar · clique num item · botão roxo + (ou tecla E) aprofunda um nível. Cores: ', '🟦 tópico (estrelas mudam a cor) · 🟪 cartão · 🟩 bibliografia · 🟧 outra trilha · 🟥 borda tracejada: reforçar'), ctl = el('div', { class: 'tools' }, btn('⏯ Girar', () => { g3.setAuto(!(cv.dataset.auto === '1')); cv.dataset.auto = cv.dataset.auto === '1' ? '0' : '1'; }, 'alt'), btn('🎯 Centralizar', () => g3.reset(), 'alt'), btn('➕', () => g3.zoomBy(1.2), 'alt'), btn('➖', () => g3.zoomBy(1 / 1.2), 'alt'));
      cv.dataset.auto = G.auto === false ? '0' : '1'; stage.replaceChildren(cv, ctl, legend); g3 = Graph3D(cv, M.nodes, M.edges, { auto: G.auto !== false, onSelect: select, canExpand: (n) => ['topic', 'card', 'deep'].includes(n.type) && canX(n.type, n.data).ok, onExpand: (n) => { g3.select(n); expand(n.type, n.data); } });
    } else stage.replaceChildren(flowView(), el('p', { class: 'legend' }, FLOWTXT));
    paintList(M);
  }
  function paintList(M) {
    const groups = { topic: 'Tópicos', card: 'Cartões', biblio: 'Bibliografia', deep: 'Aprofundamentos', other: 'Outras trilhas' };
    list.replaceChildren(el('summary', { class: 'btn alt', role: 'button' }, 'Ver os itens como lista'), ...Object.entries(groups).map(([k, lb]) => { const xs = M.nodes.filter((n) => n.type === k); return xs.length ? el('div', {}, el('h3', {}, lb + ' (' + xs.length + ')'), el('ul', {}, xs.map((n) => el('li', {}, el('button', { type: 'button', class: 'alt', onclick: () => pick(n) }, n.emoji + ' ' + n.label))))) : ''; }));
  }
  const sel1 = (name, label, opts, cur, fn) => { const i = 'g' + (++uid); return el('div', { class: 'f' }, el('label', { for: i }, label), el('select', { id: i, name, onchange: (e) => fn(e.target.value) }, opts.map(([v, t]) => el('option', { value: v, selected: String(v) === String(cur) }, t)))); };
  function paintChips() { chips.replaceChildren(...d.topics.map((t) => { const on = st.topics.has(t.id); return el('button', { type: 'button', class: on ? 'on' : 'alt', 'aria-pressed': String(on), onclick: () => { if (on) st.topics.delete(t.id); else st.topics.add(t.id); paintChips(); paint(); } }, (t.emoji || '📖') + ' ' + t.title); })); }
  select(null); paintChips(); paint();
  return el('div', {}, el('h1', {}, ico('🕸️', 'bob'), ' Mapa de conhecimento'), el('p', {}, ico(d.route.emoji || '🧭'), ' ', el('b', {}, d.route.name), ': ligações entre tópicos, cartões, bibliografia, aprofundamentos e trilhas vinculadas.'),
    el('section', { class: 'box gctl' }, el('div', { class: 'grid' },
      sel1('nivel', 'Nível de complexidade', LV.map((t, i) => [i + 1, t]), st.level, (v) => { st.level = +v; paint(); }), sel1('modo', 'Visualização', [['3d', '🌐 Grafo 3D'], ['fluxo', '🧭 Fluxograma simples']], st.mode, (v) => { st.mode = v; paint(); })),
      el('div', { class: 'tools' }, btn('Todos os tópicos', () => { d.topics.forEach((t) => st.topics.add(t.id)); st.only = false; paintChips(); paint(); }, 'alt'), btn('Só os que preciso revisar', () => { st.only = true; d.topics.forEach((t) => st.topics.add(t.id)); paintChips(); paint(); }, 'alt')), el('p', {}, 'Tópicos incluídos:'), chips, count),
    el('div', { class: 'graphpage' }, stage, panel), list);
}
const PALS = {
  arcade: { bg: '#10102e', grid: '#171750', fruit: ['#ff4d4d', '#ffd23f', '#3ddc84', '#4dc3ff', '#c77dff'], snake: ['#3ddc84', '#2fb86b'], head: '#b8ff7a', road: '#3a3a5a', dash: '#f5f5f5', grass: '#1f8f4a', car: '#ff4d4d', car2: '#4dc3ff', coin: '#ffd23f', blocks: { I: '#4dc3ff', O: '#ffd23f', T: '#c77dff', S: '#3ddc84', Z: '#ff4d4d', J: '#4d6bff', L: '#ff9f1c' } },
  gameboy: { bg: '#9bbc0f', grid: '#8bac0f', fruit: ['#0f380f'], snake: ['#306230', '#0f380f'], head: '#0f380f', road: '#8bac0f', dash: '#0f380f', grass: '#9bbc0f', car: '#0f380f', car2: '#306230', coin: '#0f380f', blocks: { I: '#0f380f', O: '#306230', T: '#0f380f', S: '#306230', Z: '#0f380f', J: '#306230', L: '#0f380f' } },
  neon: { bg: '#07021a', grid: '#120838', fruit: ['#00ffd5', '#ff00aa', '#fffb00', '#7c4dff'], snake: ['#00ffd5', '#00b8a0'], head: '#ffffff', road: '#1a0b3d', dash: '#00ffd5', grass: '#0b0626', car: '#ff00aa', car2: '#00e1ff', coin: '#fffb00', blocks: { I: '#00e1ff', O: '#fffb00', T: '#c05cff', S: '#00ff9d', Z: '#ff2e63', J: '#4d6bff', L: '#ff9f1c' } },
  doce: { bg: '#fff0f6', grid: '#ffe0ee', fruit: ['#ff6fa5', '#ffb347', '#7ddc9a', '#6ec6ff', '#b79cff'], snake: ['#7ddc9a', '#4fc17b'], head: '#2f9e5f', road: '#c9b8e8', dash: '#ffffff', grass: '#b6efc8', car: '#ff6fa5', car2: '#6ec6ff', coin: '#ffb347', blocks: { I: '#6ec6ff', O: '#ffd166', T: '#b79cff', S: '#7ddc9a', Z: '#ff6fa5', J: '#7a8cff', L: '#ffb347' } }
};
const shade = (hex, a) => { const n = parseInt(hex.slice(1), 16), f = (v) => Math.max(0, Math.min(255, v + a)); return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join(''); };
const blk = (g, x, y, col, s = 8) => { g.fillStyle = col; g.fillRect(x, y, s, s); g.fillStyle = shade(col, 60); g.fillRect(x, y, s, 1); g.fillRect(x, y, 1, s); g.fillStyle = shade(col, -70); g.fillRect(x, y + s - 1, s, 1); g.fillRect(x + s - 1, y, 1, s); };
function gSnake(pal, lvl) {
  const N = 20, C = 8, step = [0.17, 0.12, 0.085][lvl - 1]; let sn, dir, nd, food, fc = 0, acc = 0, score = 0, flash = 0;
  const reset = () => { sn = [[10, 10], [9, 10], [8, 10]]; dir = nd = [1, 0]; }, spawn = () => { do { food = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)]; } while (sn.some((s) => s[0] === food[0] && s[1] === food[1])); fc = Math.floor(Math.random() * pal.fruit.length); }; reset(); spawn();
  return { w: N * C, h: N * C, name: 'Minhoquinha', help: 'Setas (ou botões): coma as frutas. Bateu em si mesma? Perde 5 pontos e recomeça.', get score() { return score; },
    key(k) { const m = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[k]; if (m && !(m[0] === -dir[0] && m[1] === -dir[1])) nd = m; },
    update(dt) { acc += dt; flash = Math.max(0, flash - dt); while (acc >= step) { acc -= step; dir = nd; const h = [(sn[0][0] + dir[0] + N) % N, (sn[0][1] + dir[1] + N) % N]; if (sn.some((s) => s[0] === h[0] && s[1] === h[1])) { score = Math.max(0, score - 5); flash = 0.4; reset(); continue; } sn.unshift(h); if (h[0] === food[0] && h[1] === food[1]) { score += 10; spawn(); } else sn.pop(); } },
    draw(g) { g.fillStyle = pal.bg; g.fillRect(0, 0, N * C, N * C); g.fillStyle = pal.grid; for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if ((x + y) % 2) g.fillRect(x * C, y * C, C, C); blk(g, food[0] * C, food[1] * C, pal.fruit[fc]); sn.forEach((s, i) => blk(g, s[0] * C, s[1] * C, i ? pal.snake[i % pal.snake.length] : pal.head)); g.fillStyle = '#000'; g.fillRect(sn[0][0] * C + 2, sn[0][1] * C + 2, 1, 2); g.fillRect(sn[0][0] * C + 5, sn[0][1] * C + 2, 1, 2); if (flash > 0) { g.fillStyle = 'rgba(255,40,40,.4)'; g.fillRect(0, 0, N * C, N * C); } } };
}
function gCar(pal, lvl) {
  const W = 96, H = 144, lx = [8, 40, 72], base = [46, 62, 80][lvl - 1]; let lane = 1, items = [], sp = 0, inv = 0, scroll = 0, score = 0, surv = 0, el2 = 0;
  const px = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
  const car = (g, x, y, body, wind) => { px(g, x, y + 2, 16, 20, body); px(g, x + 2, y, 12, 24, body); px(g, x + 3, y + 5, 10, 6, wind); px(g, x + 3, y + 15, 10, 4, wind); px(g, x - 1, y + 3, 2, 6, '#111'); px(g, x + 15, y + 3, 2, 6, '#111'); px(g, x - 1, y + 16, 2, 6, '#111'); px(g, x + 15, y + 16, 2, 6, '#111'); px(g, x + 2, y + 1, 3, 2, '#fff7a8'); px(g, x + 11, y + 1, 3, 2, '#fff7a8'); };
  return { w: W, h: H, name: 'Carrinho', help: 'Esquerda e direita (ou toque nos lados): pegue as moedas e desvie dos carros. Batida: −10 pontos.', get score() { return score; },
    key(k) { if (k === 'left') lane = Math.max(0, lane - 1); if (k === 'right') lane = Math.min(2, lane + 1); },
    update(dt) { el2 += dt; scroll = (scroll + (base + el2 * 0.6) * dt) % 16; inv = Math.max(0, inv - dt); sp -= dt; surv += dt; if (surv > 0.5) { surv = 0; score += 1; } const speed = base + el2 * 0.8;
      if (sp <= 0) { sp = 0.8 - Math.min(0.4, el2 / 120); const l = Math.floor(Math.random() * 3), coin = Math.random() < 0.38; items.push({ x: lx[l] + (coin ? 4 : 0), y: -26, coin, col: Math.random() < 0.5 ? pal.car : pal.car2 }); }
      const py = 114; items.forEach((o) => { o.y += speed * dt; const w = o.coin ? 8 : 16, h = o.coin ? 8 : 24; if (!o.dead && Math.abs(o.x + w / 2 - (lx[lane] + 8)) < (w + 16) / 2 && o.y + h > py && o.y < py + 24) { o.dead = true; if (o.coin) score += 10; else if (!inv) { score = Math.max(0, score - 10); inv = 1.2; } } }); items = items.filter((o) => !o.dead && o.y < H + 10); },
    draw(g) { g.fillStyle = pal.grass; g.fillRect(0, 0, W, H); g.fillStyle = pal.road; g.fillRect(4, 0, W - 8, H); g.fillStyle = pal.dash; for (let y = -16 + scroll; y < H; y += 16) { g.fillRect(34, y, 2, 8); g.fillRect(62, y, 2, 8); } g.fillStyle = '#000'; g.fillRect(4, 0, 2, H); g.fillRect(W - 6, 0, 2, H);
      items.forEach((o) => { if (o.coin) { px(g, o.x, o.y, 8, 8, pal.coin); px(g, o.x + 2, o.y + 2, 4, 4, shade(pal.coin, 70)); px(g, o.x, o.y, 8, 1, shade(pal.coin, -60)); } else car(g, o.x, o.y, o.col, '#bfe9ff'); });
      if (!(inv > 0 && Math.floor(inv * 10) % 2)) car(g, lx[lane], 114, '#ffd23f', '#6ec6ff'); } };
}
function gTetris(pal, lvl) {
  const CW = 10, CH = 16, C = 8, grav = [0.7, 0.5, 0.32][lvl - 1], SH = { I: [[0, 0], [1, 0], [2, 0], [3, 0]], O: [[0, 0], [1, 0], [0, 1], [1, 1]], T: [[0, 0], [1, 0], [2, 0], [1, 1]], S: [[1, 0], [2, 0], [0, 1], [1, 1]], Z: [[0, 0], [1, 0], [1, 1], [2, 1]], J: [[0, 0], [0, 1], [1, 1], [2, 1]], L: [[2, 0], [0, 1], [1, 1], [2, 1]] };
  let board = Array.from({ length: CH }, () => Array(CW).fill(0)), bag = [], cur, next, acc = 0, score = 0, flash = 0;
  const pick = () => { if (!bag.length) bag = Object.keys(SH).sort(() => Math.random() - 0.5); const k = bag.pop(); return { k, c: SH[k].map((p) => p.slice()), x: 3, y: 0 }; };
  const fits = (c, x, y) => c.every(([a, b]) => { const X = a + x, Y = b + y; return X >= 0 && X < CW && Y < CH && (Y < 0 || !board[Y][X]); });
  const spawn = () => { cur = next || pick(); next = pick(); cur.x = 3; cur.y = 0; if (!fits(cur.c, cur.x, cur.y)) { board = Array.from({ length: CH }, () => Array(CW).fill(0)); score = Math.max(0, score - 20); flash = 0.5; } };
  const lock = () => { cur.c.forEach(([a, b]) => { if (b + cur.y >= 0) board[b + cur.y][a + cur.x] = cur.k; }); let n = 0; for (let y = CH - 1; y >= 0; y--) if (board[y].every(Boolean)) { board.splice(y, 1); board.unshift(Array(CW).fill(0)); n++; y++; } score += [0, 100, 300, 500, 800][n] + 4; spawn(); };
  spawn();
  return { w: 120, h: 128, name: 'Tetris', help: 'Setas: ◀ ▶ movem, ▲ gira, ▼ desce, espaço (ou ⤓) derruba. Linhas completas dão pontos.', get score() { return score; },
    key(k) { if (k === 'left' && fits(cur.c, cur.x - 1, cur.y)) cur.x--; else if (k === 'right' && fits(cur.c, cur.x + 1, cur.y)) cur.x++; else if (k === 'down') { if (fits(cur.c, cur.x, cur.y + 1)) { cur.y++; score += 0; } else lock(); } else if (k === 'up') { const r = cur.c.map(([a, b]) => [-b, a]), mx = Math.min(...r.map((p) => p[0])), my = Math.min(...r.map((p) => p[1])), n = r.map(([a, b]) => [a - mx, b - my]); for (const dx of [0, -1, 1, -2, 2]) if (fits(n, cur.x + dx, cur.y)) { cur.c = n; cur.x += dx; break; } } else if (k === 'act') { while (fits(cur.c, cur.x, cur.y + 1)) cur.y++; lock(); } },
    update(dt) { flash = Math.max(0, flash - dt); acc += dt; if (acc >= grav) { acc = 0; if (fits(cur.c, cur.x, cur.y + 1)) cur.y++; else lock(); } },
    draw(g) { g.fillStyle = pal.bg; g.fillRect(0, 0, 120, 128); g.fillStyle = pal.grid; for (let x = 0; x < CW; x++) for (let y = 0; y < CH; y++) if ((x + y) % 2) g.fillRect(x * C, y * C, C, C); board.forEach((r, y) => r.forEach((v, x) => { if (v) blk(g, x * C, y * C, pal.blocks[v]); })); cur.c.forEach(([a, b]) => blk(g, (a + cur.x) * C, (b + cur.y) * C, pal.blocks[cur.k]));
      g.fillStyle = '#000'; g.fillRect(80, 0, 2, 128); g.fillStyle = pal.grid; g.fillRect(82, 0, 38, 128); g.fillStyle = pal.blocks.O; g.font = '8px monospace'; g.fillText('PROX', 86, 12); next.c.forEach(([a, b]) => blk(g, 88 + a * 6, 20 + b * 6, pal.blocks[next.k], 6)); if (flash > 0) { g.fillStyle = 'rgba(255,40,40,.35)'; g.fillRect(0, 0, 80, 128); } } };
}
const GAMES = { snake: gSnake, car: gCar, tetris: gTetris };
function playBonus(cfg, onEnd) {
  const list = (cfg.games && cfg.games.length ? cfg.games : ['snake']).filter((k) => GAMES[k]), kind = cfg.random === false ? list[0] : list[Math.floor(Math.random() * list.length)], secs = cfg.seconds || 60, pal = PALS[cfg.palette] || PALS.arcade, G = GAMES[kind](pal, cfg.speed || 2);
  document.body.classList.add('gaming');
  const cv = el('canvas', { class: 'pix', width: G.w, height: G.h, role: 'img', 'aria-label': 'Jogo bônus: ' + G.name }), g = cv.getContext('2d'); g.imageSmoothingEnabled = false; cv.style.aspectRatio = G.w + ' / ' + G.h;
  const timeEl = el('b', { class: 'ptime' }, String(secs)), scoreEl = el('b', { class: 'pscore' }, '0'), barI = el('i'), over = el('div', { class: 'pover', hidden: true }), closeB = el('button', { type: 'button', class: 'alt', 'aria-label': 'Fechar o jogo', onclick: () => end(true) }, '✖');
  const press = (k) => (e) => { e.preventDefault(); G.key(k); };
  const pad = el('div', { class: 'pad' }, [['left', '◀'], ['up', '▲'], ['down', '▼'], ['right', '▶'], ['act', '⤓']].map(([k, t]) => el('button', { type: 'button', class: 'alt', 'aria-label': { left: 'esquerda', up: 'cima ou girar', down: 'baixo', right: 'direita', act: 'derrubar' }[k], onpointerdown: press(k) }, t)));
  const wrap = el('div', { class: 'gamewrap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Jogo bônus: ' + G.name }, el('div', { class: 'gamebox' }, el('div', { class: 'ghead' }, el('b', {}, '🎮 BÔNUS: ' + G.name.toUpperCase()), closeB), el('div', { class: 'gstat' }, el('span', {}, '⏱ ', timeEl, 's'), el('span', {}, '⭐ ', scoreEl)), el('div', { class: 'gbar' }, barI), el('div', { class: 'screen' }, cv, over), pad, el('p', { class: 'ghelp' }, G.help)));
  document.body.append(wrap); wrap.querySelector('button').focus();
  let left = secs, run = true, paused = false, last = performance.now(), done = false, tx = 0, ty = 0;
  const km = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ' ': 'act', Enter: 'act' };
  const onKey = (e) => { if (e.key === 'Escape') { end(true); return; } if (e.key === 'p' || e.key === 'P') { paused = !paused; return; } const k = km[e.key]; if (k) { e.preventDefault(); G.key(k); } };
  document.addEventListener('keydown', onKey);
  cv.addEventListener('pointerdown', (e) => { tx = e.clientX; ty = e.clientY; }); cv.addEventListener('pointerup', (e) => { const dx = e.clientX - tx, dy = e.clientY - ty; if (Math.abs(dx) + Math.abs(dy) < 14) { const b = cv.getBoundingClientRect(); G.key(e.clientX < b.left + b.width / 2 ? 'left' : 'right'); return; } G.key(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')); });
  function end(early) {
    if (done) return; done = true; run = false; document.removeEventListener('keydown', onKey); const sc = Math.round(G.score);
    if (early && left > 0 && !wrap.isConnected) return;
    over.hidden = false; over.replaceChildren(el('p', { class: 'big' }, early ? 'ENCERRADO' : '⏰ TEMPO!'), el('p', {}, 'PONTOS: ' + sc), el('button', { type: 'button', onclick: () => { wrap.remove(); document.body.classList.remove('gaming'); onEnd({ game: kind, score: sc }); } }, 'Continuar')); over.querySelector('button').focus();
  }
  function frame(t) { if (!run) return; const dt = Math.min(0.1, (t - last) / 1000); last = t; if (!wrap.isConnected) { run = false; return; } if (!paused && !document.hidden) { G.update(dt); left -= dt; } timeEl.textContent = String(Math.max(0, Math.ceil(left))); scoreEl.textContent = String(Math.round(G.score)); barI.style.width = Math.max(0, left / secs * 100) + '%'; G.draw(g); if (paused) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, G.w, G.h); g.fillStyle = '#fff'; g.font = '10px monospace'; g.fillText('PAUSA (P)', G.w / 2 - 22, G.h / 2); } if (left <= 0) { end(false); return; } requestAnimationFrame(frame); }
  requestAnimationFrame(frame); return { kind };
}
window.__ec = { playBonus };

/* ---------- administração ---------- */
const act = (route, body, then, label, cls = 'alt', ask) => btn(label, async () => {
  if (ask && !confirm(ask)) return;
  try { const r = await api(route, { body }); if (then) then(r); await render(true); } catch (x) { notify(x.message); }
}, cls);
async function vAdmin(tab) {
  const tabs = el('nav', { 'aria-label': 'Administração' }, [['users', 'Usuários'], ['tokens', 'Tokens'], ['requests', 'Pedidos'], ['packages', 'Pacotes'], ['versoes', 'Versões'], ['jogo', 'Jogo e mapa'], ['ia', 'IA'], ['dels', 'Exclusões'], ['content', 'Conteúdo']].map(([k, t]) => link(t, '#/admin/' + k, tab === k ? 'on' : 'alt')));
  const root = el('div', {}, el('h1', {}, 'Administração'), tabs);
  if (tab === 'jogo') {
    const c = await api('a_game'), g = c.game, m = c.graph, GN = [['snake', '🐍 Minhoquinha'], ['car', '🚗 Carrinho'], ['tetris', '🧱 Tetris']];
    root.append(el('section', { class: 'box' }, el('h2', {}, '🎮 Jogo bônus'), el('p', {}, 'Libera um jogo retrô de pixel art depois de alguns acertos seguidos na revisão. Aqui você ajusta tudo.'),
      form([select('Jogo bônus', 'g_on', [[1, 'Ligado'], [0, 'Desligado']], g.on ? 1 : 0), field('Acertos seguidos para liberar o jogo', 'g_streak', { type: 'number', value: g.streak }), field('Duração do jogo (segundos, de 15 a 180)', 'g_seconds', { type: 'number', value: g.seconds }),
        el('div', { class: 'f' }, el('b', {}, 'Jogos permitidos'), GN.map(([k, t]) => el('div', { class: 'f' }, el('label', {}, el('input', { type: 'checkbox', name: 'games', value: k, checked: g.games.includes(k) }), ' ' + t)))),
        select('Como escolher o jogo', 'g_random', [[1, 'Sortear entre os permitidos'], [0, 'Sempre o primeiro permitido']], g.random ? 1 : 0), select('Velocidade', 'g_speed', [[1, 'Calma'], [2, 'Normal'], [3, 'Rápida']], g.speed),
        select('Paleta de cores', 'g_palette', [['arcade', 'Arcade (azul-noite e cores vivas)'], ['gameboy', 'Game Boy (tons de verde)'], ['neon', 'Neon'], ['doce', 'Doce (tons claros)']], g.palette),
        field('XP máximo por partida (0 a 100)', 'g_max', { type: 'number', value: g.max_xp }), field('Partidas por dia por usuário', 'g_daily', { type: 'number', value: g.daily }),
        el('h2', {}, '🕸️ Mapa de conhecimento'), select('Mapa', 'm_on', [[1, 'Ligado'], [0, 'Desligado']], m.on ? 1 : 0), select('Nível de complexidade inicial', 'm_level', [[1, '1 · Essencial'], [2, '2 · Com cartões'], [3, '3 · Com bibliografia'], [4, '4 · Rede completa']], m.level),
        select('Visualização inicial', 'm_mode', [['3d', 'Grafo 3D'], ['fluxo', 'Fluxograma simples']], m.mode), el('div', { class: 'f' }, el('label', {}, el('input', { type: 'checkbox', name: 'm_auto', checked: m.auto }), ' Girar o grafo sozinho')), field('Máximo de itens no mapa (30 a 400)', 'm_max', { type: 'number', value: m.max_nodes }), field('Profundidade máxima dos aprofundamentos (1 a 5 níveis)', 'm_depth', { type: 'number', value: m.max_depth || 3 }),
        el('p', {}, submit('Salvar', 'big'))],
        async (d, fe) => { const games = [...fe.querySelectorAll('input[name=games]:checked')].map((x) => x.value); await api('a_game_set', { body: { game: { on: +d.g_on === 1, streak: d.g_streak, seconds: d.g_seconds, games, random: +d.g_random === 1, speed: d.g_speed, palette: d.g_palette, max_xp: d.g_max, daily: d.g_daily }, graph: { on: +d.m_on === 1, level: d.m_level, mode: d.m_mode, auto: !!d.m_auto, max_nodes: d.m_max, max_depth: d.m_depth } } }); const b = await api('boot'); S.game = b.game; S.graph = b.graph; notify('Salvo.'); await render(true); })));
    return root;
  }
  if (tab === 'versoes') {
    const c = await api('a_cfg');
    root.append(el('section', { class: 'box' }, el('h2', {}, 'Versões oferecidas'), el('p', {}, 'Antes de começar, cada pessoa escolhe entre o portal (comunidade, computador e tablet) e o mobile acessível (celular e baixa visão). Você pode oferecer as duas ou só uma.'),
      form([select('Versões', 'editions', [['ambas', 'As duas: o usuário escolhe'], ['portal', 'Só o portal'], ['acessivel', 'Só o mobile acessível']], c.editions), el('p', {}, submit('Salvar'))], async (d) => { await api('a_cfg_set', { body: d }); notify('Salvo.'); await render(true); })));
    return root;
  }
  if (tab === 'ia') {
    const c = await api('a_ia'), P = c.providers.map((p) => ({ ...p, key: '' })), list = el('div');
    const bindv = (f, o, k) => { const i = $('input,textarea,select', f); i.addEventListener('input', () => { o[k] = i.value; }); return f; };
    const chk = (label, o, k) => el('div', { class: 'f' }, el('label', {}, el('input', { type: 'checkbox', checked: !!o[k], onchange: (e) => { o[k] = e.target.checked; } }), ' ' + label));
    const paintP = () => list.replaceChildren(...P.map((p, i) => el('details', { class: 'box' }, el('summary', { class: 'btn alt' }, (p.enabled ? '🟢 ' : '⚪ ') + (p.label || c.types[p.type]) + ' · prioridade ' + (i + 1) + (c.health[p.id] && c.health[p.id].until > Date.now() / 1000 ? ' · em pausa' : '')),
      bindv(select('Tipo', 't', Object.entries(c.types), p.type), p, 'type'), bindv(field('Nome', 'l', { value: p.label }), p, 'label'), bindv(select('Papel na criação da trilha', 'r', [['qualquer', 'Qualquer etapa'], ['planejador', 'Planejador (monta o plano e a bibliografia)'], ['redator', 'Redator (escreve cada assunto)']], p.role || 'qualquer'), p, 'role'),
      bindv(field('Chave da API' + (p.hint ? ' (atual ' + p.hint + '; deixe em branco para manter)' : ''), 'k', { type: 'password', ac: 'off' }), p, 'key'), bindv(field('Modelo (vazio = padrão do tipo)', 'm', { value: p.model }), p, 'model'),
      bindv(field('Endereço base (opcional; ex.: http://localhost:11434/v1 para um modelo local)', 'u', { value: p.base_url }), p, 'base_url'),
      chk('Pesquisa na web (Claude com busca, Gemini com Google Search)', p, 'search'), chk('Transcreve áudio e vídeo de aulas (reconhecimento de fala)', p, 'stt'), chk('Ativo', p, 'enabled'),
      el('div', { class: 'tools' }, btn('⬆️ Subir prioridade', () => { if (i) { [P[i - 1], P[i]] = [P[i], P[i - 1]]; paintP(); } }, 'alt'), btn('Remover', () => { P.splice(i, 1); paintP(); }, 'alt'),
        btn('Testar (salve antes)', async () => { try { const r = await api('a_ia_test', { body: { id: p.id } }); notify('✅ ' + (p.label || p.type) + ': ' + r.resp); } catch (x) { notify('❌ ' + x.message); } }, 'alt')))));
    paintP();
    root.append(el('section', { class: 'box' }, el('h2', {}, '🛟 Agentes de IA com contingência'), el('p', {}, 'A criação da trilha é orquestrada em etapas: um agente planejador monta o plano e a bibliografia e um agente redator escreve cada assunto (sem papel definido, qualquer agente serve). O sistema tenta os agentes na ordem da lista. Se um falhar ou responder fora do formato, passa ao próximo; um provedor que falha duas vezes fica 10 minutos em pausa. Se todos falharem, o usuário recebe o modo agente (copiar o pedido para qualquer IA e colar a resposta) ou um esqueleto sem IA. As chaves ficam no servidor e nunca vão ao navegador.'), list,
      btn('➕ Adicionar provedor', () => { P.push({ id: '', type: 'openai', label: '', key: '', model: '', base_url: '', search: false, enabled: true, hint: '' }); paintP(); }, 'alt'),
      form([select('IA automática ligada', 'enabled', [[1, 'Sim'], [0, 'Não (só modo agente)']], c.enabled ? 1 : 0), field('Limite de trilhas por usuário por dia', 'limit', { type: 'number', value: c.limit }), field('Tamanho máximo de cada aula em áudio/vídeo (MB)' + (c.ffmpeg ? ' · ffmpeg disponível' : ' · ffmpeg ausente: arquivos grandes só pelo Gemini'), 'media_max_mb', { type: 'number', value: c.media_max_mb || 500 }), el('p', {}, submit('Salvar provedores', 'big'))],
        async (d) => { await api('a_ia_save', { body: { providers: P, enabled: d.enabled, limit: d.limit, media_max_mb: d.media_max_mb } }); notify('Configuração salva.'); await render(true); })));
    return root;
  }
  if (tab === 'dels') {
    const l = await api('a_dels'); root.append(el('p', {}, 'Trilhas que usuários excluíram. Enquanto não houver decisão, ficam escondidas do usuário e com o tempo congelado.'));
    if (!l.length) root.append(el('p', {}, 'Nenhuma trilha aguardando decisão.'));
    for (const x of l) root.append(el('div', { class: 'row' }, el('div', {}, ico(x.emoji), ' ', el('b', {}, x.name), el('br'), 'Excluída por ' + x.uname + ' (' + x.email + ') em ' + fmtDate(x.deleted_at)),
      el('div', { class: 'tools' }, act('a_del', { id: x.id, act: 'restore' }, null, '♻️ Restaurar', ''), act('a_del', { id: x.id, act: 'approve' }, null, '🗑️ Apagar de vez', 'alt', 'Apagar definitivamente a trilha ' + x.name + '? Isso não pode ser desfeito.'))));
    return root;
  }
  if (tab === 'packages') {
    const ta = field('Cole o JSON do pacote ou escolha um arquivo', 'json', { tag: 'textarea', rows: 8 });
    const file = el('input', { id: 'pf', type: 'file', accept: '.json,application/json', onchange: async (e) => { const f = e.target.files[0]; if (f) $('textarea', ta).value = await f.text(); } });
    root.append(el('section', { class: 'box' }, el('h2', {}, 'Instalar novo pacote'),
      el('p', {}, 'Um pacote traz o objetivo e a trilha de um estudo: slug, name, emoji, goal e topics (title, law, emoji, summary[], mnemonic, cards [[pergunta, resposta]], visuals [{emoji, title, points[], pitfall, example}]). Veja o modelo em pacotes/direito-administrativo.json.'),
      form([ta, el('div', { class: 'f' }, el('label', { for: 'pf' }, 'Ou envie um arquivo .json'), file), el('p', {}, submit('Instalar pacote'))], async (d) => { await api('a_pkg_import', { body: { json: d.json } }); notify('Pacote instalado.'); await render(true); })));
    for (const p of await api('a_pkgs')) root.append(el('div', { class: 'row' }, el('div', {}, ico(p.emoji), ' ', el('b', {}, p.name), el('br'), p.goal, el('br'), p.topics + ' assuntos · ' + p.slug), act('a_pkg_del', { id: p.id }, null, 'Excluir', 'alt', 'Excluir o pacote ' + p.name + ' com assuntos, cartões e progresso?')));
    return root;
  }
  if (tab === 'users') {
    for (const u of await api('a_users')) {
      const mine = u.id === S.user.id;
      root.append(el('div', { class: 'row' }, el('div', {}, el('b', {}, u.name), el('br'), u.email, el('br'), u.role + ' · ' + u.status),
        el('div', { class: 'tools' }, mine ? '' : [act('a_user', { id: u.id, act: 'toggle' }, null, u.status === 'ativo' ? 'Bloquear' : 'Ativar'), act('a_user', { id: u.id, act: 'del' }, null, 'Excluir', 'alt', 'Excluir ' + u.name + ' e todo o progresso?')]),
        form([field('Nova senha', 'pass', { type: 'password', min: 8, ac: 'new-password' }), submit('Redefinir', 'alt')], async (d, f) => { await api('a_user', { body: { id: u.id, act: 'pwd', pass: d.pass } }); f.reset(); notify('Senha redefinida.'); })));
    }
  } else if (tab === 'tokens') {
    root.append(el('section', { class: 'box' }, el('h2', {}, 'Gerar tokens'),
      form([field('Quantidade', 'n', { type: 'number', value: 1 }), select('Perfil', 'role', [['aluno', 'Aluno'], ['admin', 'Administrador']], 'aluno'), field('Validade em dias (0 = sem prazo)', 'days', { type: 'number', value: 7 }), el('p', {}, submit('Gerar'))],
        async (d) => { await api('a_token', { body: { act: 'gen', ...d } }); notify('Tokens gerados.'); await render(true); })));
    for (const t of await api('a_tokens')) {
      const st = t.used_by ? 'usado' : (t.expires && t.expires < Date.now() / 1000 ? 'vencido' : 'disponível');
      root.append(el('div', { class: 'row' }, el('div', {}, el('span', { class: 'tok' }, t.token), ' · ' + t.role + ' · ' + st), t.used_by ? '' : act('a_token', { act: 'del', id: t.id }, null, 'Excluir')));
    }
  } else if (tab === 'requests') {
    const l = await api('a_reqs'); if (!l.length) root.append(el('p', {}, 'Nenhum pedido de acesso.'));
    for (const r of l) root.append(el('div', { class: 'row' }, el('div', {}, el('b', {}, r.name), el('br'), r.email, r.msg ? el('br') : '', r.msg, el('br'), 'Situação: ' + r.status, r.token ? [' · token ', el('span', { class: 'tok' }, r.token)] : ''),
      el('div', { class: 'tools' }, r.status === 'pendente' ? [act('a_req', { id: r.id, act: 'approve' }, (x) => notify('Aprovado. Envie o token ' + x.token + ' ao solicitante.'), 'Aprovar', ''), act('a_req', { id: r.id, act: 'refuse' }, null, 'Recusar')] : '', act('a_req', { id: r.id, act: 'del' }, null, 'Apagar'))));
  } else {
    root.append(el('details', { class: 'box' }, el('summary', { class: 'btn' }, 'Novo assunto'), topicForm({ id: 0, title: '', law: '', summary: '', mnemonic: '' })));
    for (const t of await api('a_content')) {
      root.append(el('details', { class: 'box' }, el('summary', { class: 'btn alt' }, t.title), topicForm(t),
        act('a_topic', { act: 'del', id: t.id }, null, 'Excluir assunto e cartões', 'alt', 'Excluir este assunto e todos os cartões?'),
        el('h2', {}, 'Cartões (' + t.cards.length + ')'),
        t.cards.map((c) => el('div', { class: 'row' }, el('div', {}, el('b', {}, c.q), el('br'), c.a), act('a_card', { act: 'del', id: c.id }, null, 'Excluir'))),
        form([field('Nova pergunta', 'q', { req: true }), field('Resposta', 'a', { req: true }), el('p', {}, submit('Adicionar cartão'))], async (d) => { await api('a_card', { body: { topic_id: t.id, ...d } }); await render(true); })));
    }
  }
  return root;
}
const topicForm = (t) => form([field('Título', 'title', { req: true, value: t.title }), field('Base legal ou bibliográfica', 'law', { value: t.law }), field('Resumo (um bloco curto por linha)', 'summary', { tag: 'textarea', rows: 6, value: t.summary }), field('Mnemônico', 'mnemonic', { value: t.mnemonic }), el('p', {}, submit('Salvar assunto'))],
  async (d) => { await api('a_topic', { body: { id: t.id, ...d } }); notify('Assunto salvo.'); await render(true); });

/* ---------- roteador ---------- */
async function render(keep) {
  cleanup && cleanup(); cleanup = null; if (!keep) notify('');
  const [path, qstr = ''] = location.hash.replace(/^#\/?/, '').split('?'), [r, a, b] = path.split('/'), Q = new URLSearchParams(qstr);
  let node, title = S.name;
  try {
    if (!ED() || r === 'versao') { node = vChooser(); title = 'Escolha a versão'; }
    else if (!S.user) { node = vHome(r); title = r === 'criar' ? 'Criar conta' : r === 'token' ? 'Criar conta com token' : r === 'pedir' ? 'Solicitar token' : 'Entrar'; }
    else if (r === 'topicos') { node = await vTopics(); title = 'Conteúdo'; }
    else if (r === 'resumos') { node = await vLibrary(); title = 'Resumos visuais'; }
    else if (r === 'resumo') { node = await vDeck(+a); title = 'Resumo visual'; }
    else if (r === 'conquistas') { node = await vAch(); title = 'Conquistas'; }
    else if (r === 'trilhas' && a === 'nova') { node = await vNewRoute(Q); title = 'Nova trilha'; }
    else if (r === 'trilhas' && a === 'importar') { node = vImport(); title = 'Importar trilha'; }
    else if (r === 'trilhas' || r === 'pacotes') { node = await vRoutes(); title = 'Trilhas'; }
    else if (r === 'trilha') { node = await vRoute(+a); title = 'Painel da trilha'; }
    else if (r === 'explorar') { node = await vExplore(Q); title = 'Explorar'; }
    else if (r === 'comunidade') { node = await vPublic(+a); title = 'Trilha da comunidade'; }
    else if (r === 'grupos') { node = await vGroups(); title = 'Grupos'; }
    else if (r === 'grupo') { node = await vGroup(+a); title = 'Grupo'; }
    else if (r === 'materiais') { node = await vMaterials(); title = 'Materiais'; }
    else if (r === 'mais') { node = vMore(); title = 'Mais'; }
    else if (r === 'aulas') { node = await vLessons(); title = 'Aulas'; }
    else if (r === 'aventura') { node = await vAdventure(); title = 'Aventura'; }
    else if (r === 'grafo') { node = await vGraph(+a, Q); title = 'Mapa de conhecimento'; }
    else if (r === 'aprofundamento') { node = await vDeepLib(+a); title = 'Aprofundamento'; }
    else if (r === 'aula') { node = await vLesson(+a); title = 'Aula'; }
    else if (r === 'topico') { node = await vTopic(+a); title = 'Assunto'; }
    else if (r === 'revisar') { node = vStudy(a || 'due', +b || 0); title = 'Revisão'; }
    else if (r === 'ajustes') { node = el('div', {}, vSettings(), vAccount()); title = 'Ajustes'; }
    else if (r === 'fontes') { node = vSources(); title = 'Fontes'; }
    else if (r === 'admin' && S.user.role === 'admin') { node = await vAdmin(a || 'users'); title = 'Administração'; }
    else { node = await vDash(); title = 'Início'; }
  } catch (e) {
    if (e.status === 401) { S.user = null; buildNav(); node = vHome(''); }
    else node = el('div', {}, el('h1', {}, 'Não foi possível carregar'), el('p', {}, S.offline || !navigator.onLine ? 'Você está sem conexão. Revisões já abertas continuam funcionando.' : e.message), btn('Tentar de novo', () => render(), 'big'));
  }
  const y = scrollY; view.replaceChildren(node); document.title = title + ' · ' + S.name;
  if (keep) scrollTo(0, y);
  else { const h = $('h1', view); if (h) { h.tabIndex = -1; h.focus(); } scrollTo(0, 0); }
  if (!S.user && ['criar', 'token', 'entrar', 'pedir'].includes(r)) { const s = $('#' + r); if (s) { s.scrollIntoView(); const f = $('input', s) || $('a.choice', s); f && f.focus(); } }
  if (r === 'ajustes') afterSettings();
  document.querySelectorAll('#nav a').forEach((x) => { const h = (x.getAttribute('href') || '').split('/')[1] || ''; x.classList.toggle('cur', h === (r || '')); });
}
addEventListener('hashchange', () => render());

/* ---------- início ---------- */
(async () => {
  try { await boot(); } catch (e) { view.replaceChildren(el('h1', {}, 'Sem conexão'), el('p', {}, 'Não foi possível falar com o servidor. Verifique a internet e tente de novo.'), btn('Tentar de novo', () => location.reload(), 'big')); return; }
  await render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

/* ---------- Aventura RPG ---------- */
const hash = (t) => [...String(t)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const palOf = (name, pow) => { const h = hash(name) % 360; return { hair: `hsl(${h},70%,45%)`, cloth: `hsl(${(h + 120) % 360},60%,50%)`, cape: `hsl(${(h + 200) % 360},65%,35%)`, aura: `hsl(${(h + 60) % 360},95%,60%)`, pow: pow || 0 }; };
function drawHero(c, x, y, s, p, back, t) {   // herói estilo anime (chibi), de frente ou de costas
  c.save(); c.translate(x, y + Math.sin(t / 250) * 2 * s); c.scale(s, s);
  if (p.pow) { c.globalAlpha = 0.28; c.fillStyle = p.aura; c.beginPath(); c.arc(0, -40, 34 + Math.min(30, p.pow / 30) + Math.sin(t / 300) * 2, 0, 7); c.fill(); c.globalAlpha = 1; }
  c.fillStyle = p.cape; c.beginPath(); c.moveTo(-18, -34); c.lineTo(18, -34); c.lineTo(26, 0); c.lineTo(-26, 0); c.fill();
  if (!back) { c.fillStyle = p.cloth; c.fillRect(-12, -34, 24, 26); }
  c.fillStyle = back ? p.hair : '#ffd9bf'; c.beginPath(); c.arc(0, -52, 16, 0, 7); c.fill();
  c.fillStyle = p.hair; c.beginPath(); c.arc(0, -56, 17.5, Math.PI, 0); c.fill(); c.beginPath(); for (const k of [-15, -7, 2, 10]) { c.moveTo(k, -64); c.lineTo(k + 5, -82); c.lineTo(k + 11, -64); } c.fill();
  if (back) { c.beginPath(); c.arc(0, -50, 17, 0, Math.PI); c.fill(); }
  else for (const k of [-7, 7]) { c.fillStyle = '#fff'; c.beginPath(); c.ellipse(k, -50, 5, 6.5, 0, 0, 7); c.fill(); c.fillStyle = p.aura; c.beginPath(); c.ellipse(k, -49, 3.2, 5, 0, 0, 7); c.fill(); c.fillStyle = '#111'; c.beginPath(); c.arc(k, -49, 1.8, 0, 7); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(k + 1.3, -51.5, 1.3, 0, 7); c.fill(); }
  c.restore();
}
function playRun(host, pal, onEnd) {   // corrida em terceira pessoa: câmera atrás do herói, colete cartas e desvie dos slimes
  const W = 360, H = 480, cv = el('canvas', { width: W, height: H, class: 'advcv', tabindex: 0, 'aria-label': 'Jogo: use as setas para mover o herói' }), c = cv.getContext('2d'); let px = 0, vx = 0, hp = 3, sc = 0, got = 0, tl = 40, last = 0, spawn = 0, O = [], pet = [];
  const key = {}; const kd = (e) => { key[e.key.toLowerCase()] = e.type === 'keydown'; if (e.key.startsWith('Arrow')) e.preventDefault(); }; document.addEventListener('keydown', kd); document.addEventListener('keyup', kd);
  const pad = el('div', { class: 'advpad' }, ['◀', '▶'].map((l, k) => { const b = el('button', { type: 'button', class: 'alt', 'aria-label': k ? 'Direita' : 'Esquerda' }, l); const on = (v) => (e) => { e.preventDefault(); key[k ? 'arrowright' : 'arrowleft'] = v; }; b.addEventListener('pointerdown', on(true)); b.addEventListener('pointerup', on(false)); b.addEventListener('pointerleave', on(false)); return b; }));
  host.replaceChildren(cv, pad); cv.focus(); const proj = (x, z) => ({ X: W / 2 + x * (40 + 150 * (1 - z)), Y: 150 + 270 * (1 - z) ** 1.6, S: 0.25 + 0.95 * (1 - z) });
  (function loop(t) {
    if (!cv.isConnected) { document.removeEventListener('keydown', kd); document.removeEventListener('keyup', kd); return; }
    const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t; tl -= dt; spawn -= dt; const sp = 0.55 + (40 - tl) * 0.012;
    vx = ((key.arrowright || key.d ? 1 : 0) - (key.arrowleft || key.a ? 1 : 0)) * 2.4; px = Math.max(-1.25, Math.min(1.25, px + vx * dt));
    if (spawn <= 0) { spawn = 0.55 + Math.random() * 0.5; O.push({ x: (Math.random() * 2.4 - 1.2), z: 1, bad: Math.random() < 0.38 }); }
    const g = c.createLinearGradient(0, 0, 0, 160); g.addColorStop(0, '#6ec6ff'); g.addColorStop(1, '#ffd6f0'); c.fillStyle = g; c.fillRect(0, 0, W, 170);
    c.fillStyle = '#6dd27a'; c.fillRect(0, 150, W, H); c.fillStyle = '#8b8fb8'; c.beginPath(); c.moveTo(W / 2 - 22, 150); c.lineTo(W / 2 + 22, 150); c.lineTo(W / 2 + 190, H); c.lineTo(W / 2 - 190, H); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 3; c.setLineDash([12, 16]); c.lineDashOffset = -t / 20; c.beginPath(); c.moveTo(W / 2, 150); c.lineTo(W / 2, H); c.stroke(); c.setLineDash([]);
    for (let k = 0; k < 6; k++) for (const sd of [-1, 1]) { const z = ((k / 6 + t / 3000 * sp) % 1), q = proj(sd * 1.8, 1 - z); c.font = `${Math.round(40 * q.S)}px serif`; c.textAlign = 'center'; c.fillText('🌸', q.X, q.Y); }
    O.forEach((o) => { o.z -= dt * sp; }); O.sort((a, b) => b.z - a.z);
    for (const o of O) { const q = proj(o.x, o.z); c.font = `${Math.round(54 * q.S)}px serif`; c.textAlign = 'center'; c.fillText(o.bad ? '👾' : '🃏', q.X, q.Y);
      if (o.z < 0.12 && !o.done && Math.abs(o.x - px) < 0.42) { o.done = true; if (o.bad) { hp--; navigator.vibrate && navigator.vibrate(60); } else { got++; sc += 10; pet.push({ x: q.X, y: q.Y, a: 1 }); } } }
    O = O.filter((o) => o.z > 0.02 && !o.done); pet.forEach((q) => { q.y -= 1.5; q.a -= 0.03; c.globalAlpha = Math.max(0, q.a); c.fillText('✨', q.X || q.x, q.y); c.globalAlpha = 1; }); pet = pet.filter((q) => q.a > 0);
    drawHero(c, W / 2 + px * 150, H - 30, 1.5, pal, true, t);
    c.fillStyle = '#1e1b4b'; c.font = '700 16px sans-serif'; c.textAlign = 'left'; c.fillText('❤'.repeat(Math.max(0, hp)) + '  🃏 ' + got + '  ⏱ ' + Math.max(0, Math.ceil(tl)) + 's', 10, 24);
    if (hp <= 0 || tl <= 0) { document.removeEventListener('keydown', kd); document.removeEventListener('keyup', kd); onEnd({ got, score: sc, win: hp > 0 }); return; }
    requestAnimationFrame(loop);
  })(0);
}
async function vAdventure() {
  const [st, tp, rt] = await Promise.all([api('stats'), api('topics'), api('routes')]);
  const T = Array.isArray(tp) ? tp : (tp.topics || []), RL = Array.isArray(rt) ? rt : (rt.routes || []), xp = S.user.xp || st.xp || 0, streak = st.streak || 0;
  let bagX = 0; try { bagX = +localStorage.getItem('ec_bag') || 0; } catch (e) {}
  const stars = T.reduce((a, t) => a + (t.stars || 0), 0), dom = T.reduce((a, t) => a + (t.k || 0), 0), best = Math.max(0, ...T.map((t) => t.stars || 0));
  const M = [['Primeiros passos', 'Ganhe 50 XP', xp, 50], ['Estudioso', 'Ganhe 300 XP', xp, 300], ['Chama acesa', 'Estude 3 dias seguidos', streak, 3], ['Estrela do saber', 'Conquiste 1 estrela', best, 1], ['Colecionador', 'Domine 10 cartões', dom, 10], ['Mestre do assunto', '3 estrelas em um assunto', best, 3]];
  const done = M.filter((m) => m[2] >= m[3]).length, pow = Math.floor(xp / 4) + 25 * stars + 8 * dom + 40 * done + 2 * bagX, lv = Math.floor(Math.sqrt(xp / 30)) + 1;
  const cur = RL.find((x) => x.id === S.user.pkg) || RL[0] || { name: 'Aventureiro', emoji: '🧙' }, pal = palOf(cur.name, pow);
  const hero = el('canvas', { width: 180, height: 190, class: 'herocv', role: 'img', 'aria-label': 'Seu herói: poder ' + pow }), hc = hero.getContext('2d'); const an = (t) => { if (!hero.isConnected) return; hc.clearRect(0, 0, 180, 190); drawHero(hc, 90, 170, 1.7, pal, false, t); requestAnimationFrame(an); }; requestAnimationFrame(an);
  const bar = (v, m) => el('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': Math.min(v, m), 'aria-valuemax': m }, el('i', { style: '' })); const mk = (v, m) => { const b = bar(v, m); b.firstChild.style.width = Math.min(100, v / m * 100) + '%'; return b; };
  const bag = T.filter((t) => t.k).map((t) => el('li', { class: 'it r' + Math.min(3, t.stars || 0) }, el('span', { 'aria-hidden': 'true' }, t.emoji || '🃏'), el('b', {}, t.title), el('small', {}, '×' + t.k + ' · ' + ['comum', 'rara', 'épica', 'lendária'][Math.min(3, t.stars || 0)])));
  if (bagX) bag.push(el('li', { class: 'it r1' }, el('span', { 'aria-hidden': 'true' }, '🌸'), el('b', {}, 'Cartas de aventura'), el('small', {}, '×' + bagX)));
  const arena = el('div', { class: 'advarena' }); const heroes = el('div', { class: 'heroes' }, RL.map((x) => { const b = el('button', { type: 'button', class: 'alt hbtn' + (x.id === cur.id ? ' cur' : ''), onclick: async () => { await api('pkg_set', { body: { id: x.id } }); S.user.pkg = x.id; render(); } }, el('span', { 'aria-hidden': 'true' }, x.emoji || '🧙'), ' ', x.name); return b; }));
  const start = () => { arena.hidden = false; arena.scrollIntoView({ block: 'center' }); playRun(arena, pal, (r) => { try { localStorage.setItem('ec_bag', String(bagX + r.got)); } catch (e) {} arena.replaceChildren(el('h2', {}, r.win ? '🏆 Missão cumprida!' : '💫 Quase lá!'), el('p', {}, r.got + ' cartas coletadas (+' + (2 * r.got) + ' de poder). Elas já estão na sua mochila.'), btn('Jogar de novo', start, ''), btn('Atualizar herói', () => render(), 'alt')); }); };
  return el('div', {}, el('h1', {}, '⚔️ Aventura'), el('p', {}, 'Cada trilha tem um herói. Estude, cumpra missões e colete cartas: seu poder cresce a cada passo.'), heroes,
    el('section', { class: 'box herobox' }, hero, el('div', {}, el('h2', {}, cur.name), el('p', {}, 'Nível ' + lv + ' · ', el('b', {}, '⚡ Poder ' + pow)), mk(xp - 30 * (lv - 1) ** 2, 30 * (lv ** 2 - (lv - 1) ** 2)), el('p', {}, '⭐ ' + stars + ' estrelas · 🃏 ' + dom + ' cartões dominados · 🔥 ' + streak + ' dias'), btn('▶ Iniciar aventura (terceira pessoa)', start, ''))), arena,
    el('div', { class: 'cols' }, el('section', { class: 'box' }, el('h2', {}, '📜 Missões (' + done + '/' + M.length + ')'), el('ul', { class: 'missions' }, M.map((m) => el('li', { class: m[2] >= m[3] ? 'ok' : '' }, el('b', {}, (m[2] >= m[3] ? '✅ ' : '⬜ ') + m[0]), el('small', {}, ' ' + m[1] + ' · ' + Math.min(m[2], m[3]) + '/' + m[3]), mk(m[2], m[3]))))),
      el('section', { class: 'box' }, el('h2', {}, '🎒 Mochila de itens'), bag.length ? el('ul', { class: 'bag' }, bag) : el('p', {}, 'Vazia por enquanto: domine cartões ou colete cartas na aventura.'))));
}
