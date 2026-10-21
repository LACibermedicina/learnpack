/* Assistente de instalação: navegação por etapas, agentes de IA com contingência, teste de cada agente e resumo. */
'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const W = $('#wiz'), CSRF = W.dataset.csrf, N = 5;
  const el = (t, a = {}, ...k) => { const e = document.createElement(t); for (const [n, v] of Object.entries(a)) { if (v == null || v === false) continue; if (n === 'class') e.className = v; else if (n.startsWith('on')) e.addEventListener(n.slice(2), v); else e.setAttribute(n, v === true ? '' : v); } for (const c of k.flat(9)) e.append(c && c.nodeType ? c : document.createTextNode(c ?? '')); return e; };
  const TYPES = { anthropic: 'Anthropic (Claude)', openai: 'Compatível com OpenAI (OpenAI, OpenRouter, Groq, Ollama…)', gemini: 'Google Gemini' };
  const ROLES = [['qualquer', 'Qualquer etapa'], ['planejador', 'Planejador (monta o plano e a bibliografia)'], ['redator', 'Redator (escreve cada assunto)']];
  const PRE = [['➕ Claude', { type: 'anthropic', label: 'Claude', model: 'claude-sonnet-5-5', search: true }], ['➕ OpenAI', { type: 'openai', label: 'OpenAI', model: 'gpt-4o-mini', stt: true }], ['➕ Gemini', { type: 'gemini', label: 'Gemini', model: 'gemini-flash-latest', search: true, stt: true }],
    ['➕ OpenRouter', { type: 'openai', label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct' }], ['➕ Modelo local (Ollama)', { type: 'openai', label: 'Modelo local (Ollama)', base_url: 'http://localhost:11434/v1', model: 'llama3.1' }]];
  let A = []; try { A = JSON.parse(W.dataset.agents || '[]'); } catch { A = []; }
  let step = 1;

  function show(n) {
    step = n; $$('.step').forEach((s) => s.classList.toggle('on', +s.dataset.step === n));
    $$('.stepper li').forEach((li, i) => { li.firstElementChild.textContent = i + 1 < n ? '✓' : String(i + 1); li.classList.toggle('on', i + 1 === n); li.classList.toggle('done', i + 1 < n); if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
    $('#wbar').style.width = ((n - 1) / (N - 1) * 100) + '%'; $('#prev').hidden = n === 1; $('#next').hidden = n === N; $('#go').hidden = n !== N;
    if (n === N) summary(); const h = $('.step.on h2'); if (h) h.focus(); window.scrollTo(0, 0);
  }
  function valid() {
    if (step === 2) { const a = $('#p'), b = $('#p2'); b.setCustomValidity(a.value === b.value ? '' : 'As senhas não conferem.'); }
    return $$('input,select,textarea', $('.step.on')).every((i) => i.reportValidity());
  }
  $('#next').addEventListener('click', () => { if (valid()) show(step + 1); });
  $('#prev').addEventListener('click', () => show(step - 1));
  $('#wf').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input') && step < N) { e.preventDefault(); if (valid()) show(step + 1); } });
  $('#wf').addEventListener('submit', () => { $('#agentsjson').value = JSON.stringify(A); });

  /* ----- agentes ----- */
  const bindv = (f, i, k, box) => { const c = $('input,select', f); c.addEventListener('input', () => { A[i][k] = box ? c.checked : c.value; if (k === 'label' || k === 'enabled' || k === 'role') chain(); }); return f; };
  const field = (label, type, val, ph) => el('div', { class: 'f' }, el('label', {}, label), el('input', { type, value: val || '', placeholder: ph || '', autocomplete: 'off' }));
  const sel = (label, opts, cur) => el('div', { class: 'f' }, el('label', {}, label), el('select', {}, opts.map(([v, t]) => el('option', { value: v, selected: v === cur }, t))));
  const chk = (label, on) => el('div', { class: 'f' }, el('label', {}, el('input', { type: 'checkbox', checked: !!on }), ' ' + label));
  async function test(a, out) {
    out.className = 'res'; out.textContent = 'Testando…';
    try {
      const r = await fetch('install.php?do=test', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': CSRF }, body: JSON.stringify({ agent: a, key: ($('#ikey') || {}).value || '' }) }), j = await r.json();
      if (j.ok) { out.className = 'res ok'; out.textContent = '✅ Respondeu: ' + j.resp; } else { out.className = 'res bad'; out.textContent = '❌ ' + j.error; }
    } catch (e) { out.className = 'res bad'; out.textContent = '❌ Não foi possível testar: ' + e.message; }
  }
  function paint() {
    const box = $('#agents'); box.replaceChildren(...A.map((a, i) => {
      const out = el('span', { class: 'res', role: 'status' });
      return el('details', { class: 'agent', open: a._open || (!a.model && !a.key), ontoggle: (e) => { a._open = e.target.open; } }, el('summary', {}, (a.enabled ? '🟢 ' : '⚪ ') + (i + 1) + '. ' + (a.label || TYPES[a.type])),
        el('div', {}, el('div', { class: 'row2' },
          bindv(sel('Tipo', Object.entries(TYPES), a.type), i, 'type'), bindv(field('Nome', 'text', a.label), i, 'label'), bindv(field('Chave da API (fica só no servidor)', 'password', a.key, a.preset ? 'pré-configurada ' + (a.hint || '') + ': deixe em branco para manter' : ''), i, 'key'),
          bindv(field('Modelo (vazio = padrão do tipo)', 'text', a.model), i, 'model'), bindv(field('Endereço base (opcional)', 'url', a.base_url, 'ex.: http://localhost:11434/v1'), i, 'base_url'), bindv(sel('Papel na criação da trilha', ROLES, a.role || 'qualquer'), i, 'role')),
          bindv(chk('Pesquisa na web (Claude com busca, Gemini com Google Search)', a.search), i, 'search', true), bindv(chk('Transcreve áudio e vídeo de aulas (reconhecimento de fala)', a.stt), i, 'stt', true), bindv(chk('Ativo', a.enabled), i, 'enabled', true),
          el('div', { class: 'acts' }, el('button', { type: 'button', class: 'alt', onclick: () => { if (i) { [A[i - 1], A[i]] = [A[i], A[i - 1]]; paint(); } } }, '⬆️ Subir prioridade'), el('button', { type: 'button', class: 'alt', onclick: () => { A.splice(i, 1); paint(); } }, 'Remover'),
            el('button', { type: 'button', onclick: () => test(a, out) }, '🧪 Testar agora'), out)));
    }));
    if (!A.length) box.append(el('p', {}, 'Nenhum agente por enquanto: a IA ficará em modo agente (você copia o pedido para qualquer IA e cola a resposta). Dá para adicionar depois.'));
    chain();
  }
  function chain() {
    const on = A.filter((a) => a.enabled), c = $('#chain');
    c.replaceChildren(...on.flatMap((a, i) => [el('span', { class: 'node' }, (i + 1) + '. ' + (a.label || TYPES[a.type]) + (a.role && a.role !== 'qualquer' ? ' (' + a.role + ')' : '')), el('span', { class: 'arrow', 'aria-hidden': 'true' }, '→')]),
      el('span', { class: 'node man' }, '🛟 Modo agente (você cola a resposta)'), el('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'), el('span', { class: 'node sk' }, '📝 Esqueleto sem IA'));
  }
  $('#presets').append(...PRE.map(([t, p]) => el('button', { type: 'button', class: 'alt', onclick: () => { A.push({ enabled: true, role: 'qualquer', key: '', model: '', base_url: '', search: false, ...p }); paint(); } }, t)), el('button', { type: 'button', class: 'alt', onclick: () => { A.push({ type: 'openai', label: '', enabled: true, role: 'qualquer', key: '', model: '', base_url: '', search: false }); paint(); } }, '➕ Outro compatível'));

  function summary() {
    const v = (n) => ($('[name=' + n + ']') || {}).value || '', ed = ($('[name=editions]:checked') || {}).value, EN = { ambas: 'As duas (cada pessoa escolhe)', portal: 'Só o portal', acessivel: 'Só o mobile acessível' };
    const on = A.filter((a) => a.enabled);
    $('#summary').replaceChildren(...[['Plataforma', v('site') || 'LearnPack'], ['Administrador', v('name') + ' (' + v('email') + ')'], ['Versões', EN[ed]], ['IA', $('#ia_on').value === '1' && on.length ? on.length + ' agente(s): ' + on.map((a) => a.label || TYPES[a.type]).join(' → ') + ' → modo agente → esqueleto' : 'Só modo agente (sem IA automática)'], ['Pacote de exemplo', $('[name=seed]').checked ? 'Direito Administrativo' : 'nenhum']].flatMap(([k, x]) => [el('dt', {}, k), el('dd', {}, x)]));
  }
  paint(); show(1);
})();
