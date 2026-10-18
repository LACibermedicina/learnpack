<?php
declare(strict_types=1);
/* IA com contingência: vários provedores (Anthropic, compatíveis com OpenAI, Gemini), disjuntor, normalização do formato
   de dados e modo manual (qualquer agente externo). Se tudo falhar, o usuário nunca fica sem caminho. */
const IA_TYPES = ['anthropic' => 'Anthropic (Claude)', 'openai' => 'Compatível com OpenAI (OpenAI, OpenRouter, Groq, Ollama…)', 'gemini' => 'Google Gemini'];
class IaHttp extends RuntimeException { public int $http; public function __construct(int $c, string $m) { parent::__construct("HTTP $c: $m"); $this->http = $c; } }

function ia_providers(): array {
    $l = json_decode((string)setting('ia_providers', ''), true);
    if (!is_array($l)) { $l = []; $k = (string)setting('ia_key', ''); if ($k !== '') $l[] = ['id' => 'p1', 'type' => 'anthropic', 'label' => 'Claude', 'key' => $k, 'model' => (string)setting('ia_model', 'claude-sonnet-5-5'), 'base_url' => '', 'search' => true, 'enabled' => true]; }
    return $l;
}
function ia_active(string $role = ''): array {
    $h = jd(setting('ia_health', '')); $now = time(); $l = array_values(array_filter(ia_providers(), fn($p) => !empty($p['enabled'])));
    $ok = array_values(array_filter($l, fn($p) => ((int)($h[$p['id']]['until'] ?? 0)) <= $now)); $l = $ok ?: $l;   // disjuntor: se todos estão em pausa, tenta mesmo assim
    $rank = fn($p) => ($role !== '' && ($p['role'] ?? 'qualquer') === $role) ? 0 : (($p['role'] ?? 'qualquer') === 'qualquer' ? 1 : 2);
    usort($l, fn($a, $b) => $rank($a) <=> $rank($b));     // o agente com o papel da etapa vai primeiro; os demais ficam como reserva
    return $l;
}
function ia_mark(string $id, bool $ok): void {
    $h = jd(setting('ia_health', '')); if ($ok) unset($h[$id]); else { $f = ((int)($h[$id]['fails'] ?? 0)) + 1; $h[$id] = ['fails' => $f, 'until' => $f >= 2 ? time() + 600 : 0]; }
    set_setting('ia_health', json_encode($h));
}
function ia_info(array $u): array {
    $n = count(array_filter(ia_providers(), fn($p) => !empty($p['enabled'])));
    $used = (int)q('SELECT COUNT(*) FROM jobs WHERE user_id=? AND created>?', [$u['id'], time() - 86400])->fetchColumn();
    return ['enabled' => $n > 0 && setting('ia_enabled', '1') === '1', 'providers' => $n, 'manual' => true, 'limit' => (int)setting('ia_limit', '3'), 'used' => $used, 'admin' => ($u['role'] ?? '') === 'admin'];
}
function http_do(string $url, array $headers = [], ?string $body = null, int $timeout = 30): array {
    if (!function_exists('curl_init')) throw new RuntimeException('A extensão cURL do PHP é necessária para usar a IA.');
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 4, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_HTTPHEADER => $headers, CURLOPT_USERAGENT => 'Mozilla/5.0 (EstudoClaro)', CURLOPT_ENCODING => '']);
    if ($body !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, $body); }
    $out = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
    if ($out === false) throw new RuntimeException('Falha de rede: ' . $err);
    return [$code, (string)$out];
}
/** Adaptador único: traduz o pedido padrão para cada tipo de provedor. Retorna ['text'=>..., 'search'=>bool]. */
function ia_call(array $p, array $req): array {
    $t = (string)($p['type'] ?? ''); $model = ($p['model'] ?? '') ?: ['anthropic' => 'claude-sonnet-5-5', 'openai' => 'gpt-4o-mini', 'gemini' => 'gemini-2.5-flash'][$t] ?? '';
    $search = !empty($p['search']) && !empty($req['search']); $sys = (string)($req['system'] ?? ''); $docs = (array)($req['docs'] ?? []); $max = (int)($req['max_tokens'] ?? 12000);
    $user = is_callable($req['user']) ? ($req['user'])($search) : (string)$req['user'];
    if ($t === 'anthropic') {
        $content = []; foreach ($docs as $d) $content[] = ['type' => 'document', 'source' => ['type' => 'base64', 'media_type' => 'application/pdf', 'data' => $d['data']], 'title' => $d['title']]; $content[] = ['type' => 'text', 'text' => $user];
        $msgs = [['role' => 'user', 'content' => $content]]; $txt = '';
        for ($i = 0; $i < 4; $i++) {
            $body = ['model' => $model, 'max_tokens' => $max, 'system' => $sys, 'messages' => $msgs]; if ($search) $body['tools'] = [['type' => 'web_search_20250305', 'name' => 'web_search', 'max_uses' => 8]];
            [$c, $o] = http_do(rtrim($p['base_url'] ?: 'https://api.anthropic.com', '/') . '/v1/messages', ['x-api-key: ' . $p['key'], 'anthropic-version: 2023-06-01', 'content-type: application/json'], json_encode($body, JSON_UNESCAPED_UNICODE), 900);
            $j = json_decode($o, true); if ($c >= 400 || !is_array($j)) throw new IaHttp($c, $j['error']['message'] ?? substr($o, 0, 200));
            $txt = ''; foreach ((array)$j['content'] as $b) if (($b['type'] ?? '') === 'text') $txt .= $b['text'];
            if (($j['stop_reason'] ?? '') !== 'pause_turn') break; $msgs[] = ['role' => 'assistant', 'content' => $j['content']];
        }
        return ['text' => $txt, 'search' => $search];
    }
    if ($t === 'openai') {
        $h = ['content-type: application/json']; if (!empty($p['key'])) $h[] = 'Authorization: Bearer ' . $p['key'];
        if ($docs) $user .= "\n\n(Há PDFs anexados que este provedor não consegue ler; use apenas o texto acima.)";
        $url = rtrim($p['base_url'] ?: 'https://api.openai.com/v1', '/') . '/chat/completions'; $lim = 'max_tokens';
        for ($try = 0; $try < 2; $try++) {
            [$c, $o] = http_do($url, $h, json_encode(['model' => $model, $lim => $max, 'messages' => [['role' => 'system', 'content' => $sys], ['role' => 'user', 'content' => $user]]], JSON_UNESCAPED_UNICODE), 900); $j = json_decode($o, true);
            if ($c === 400 && $try === 0 && stripos((string)($j['error']['message'] ?? ''), 'max_tokens') !== false) { $lim = 'max_completion_tokens'; continue; }   // modelos novos usam outro nome
            if ($c >= 400 || !is_array($j)) throw new IaHttp($c, $j['error']['message'] ?? substr($o, 0, 200));
            return ['text' => (string)($j['choices'][0]['message']['content'] ?? ''), 'search' => false];
        }
    }
    if ($t === 'gemini') {
        $parts = [['text' => $user]]; foreach ($docs as $d) $parts[] = ['inline_data' => ['mime_type' => 'application/pdf', 'data' => $d['data']]];
        $body = ['systemInstruction' => ['parts' => [['text' => $sys]]], 'contents' => [['role' => 'user', 'parts' => $parts]], 'generationConfig' => ['maxOutputTokens' => $max]]; if ($search) $body['tools'] = [['google_search' => new stdClass()]];
        [$c, $o] = http_do(rtrim($p['base_url'] ?: 'https://generativelanguage.googleapis.com/v1beta', '/') . '/models/' . $model . ':generateContent', ['content-type: application/json', 'x-goog-api-key: ' . $p['key']], json_encode($body, JSON_UNESCAPED_UNICODE), 900); $j = json_decode($o, true);
        if ($c >= 400 || !is_array($j)) throw new IaHttp($c, $j['error']['message'] ?? substr($o, 0, 200));
        $txt = ''; foreach ((array)($j['candidates'][0]['content']['parts'] ?? []) as $pt) $txt .= $pt['text'] ?? ''; return ['text' => $txt, 'search' => $search];
    }
    throw new RuntimeException('Tipo de provedor desconhecido.');
}
/** Tenta cada provedor em ordem de prioridade (2 tentativas se a falha for passageira). $accept valida e normaliza a resposta; se o formato vier errado, passa ao próximo provedor. */
function ai_complete(array $req, callable $accept, string $role = ''): array {
    $errs = [];
    foreach (ia_active($role) as $p) {
        for ($try = 0; $try < 2; $try++) {
            try {
                $r = ia_call($p, $req); $v = $accept($r['text']); ia_mark((string)$p['id'], true);
                return ['result' => $v, 'provider' => (string)($p['label'] ?: $p['type']), 'model' => (string)($p['model'] ?? ''), 'search' => $r['search']];
            } catch (Throwable $e) {
                $errs[] = ($p['label'] ?: $p['type']) . ': ' . $e->getMessage();
                if ($e instanceof IaHttp && in_array($e->http, [400, 403, 404], true) && !empty($p['search']) && $try === 0) { $p['search'] = false; continue; }   // a conta pode não ter a ferramenta de busca: tenta sem ela
                $transient = $e instanceof IaHttp ? ($e->http === 429 || $e->http >= 500) : !($e instanceof InvalidArgumentException);
                if (!$transient || $try === 1) { ia_mark((string)$p['id'], false); break; }
                sleep(3);
            }
        }
    }
    throw new RuntimeException($errs ? 'Nenhum provedor de IA respondeu (' . implode(' | ', array_slice($errs, -4)) . ').' : 'Nenhum provedor de IA está ativo.');
}

/* ---- enquadramento do formato: aceita as variações de modelos e agentes diferentes ---- */
function extract_json(string $t): ?array {
    $t = preg_replace('/```(?:json)?/i', '', $t); $a = strpos($t, '{'); if ($a === false) return null;
    $d = 0; $in = false; $esc = false; $end = null;
    for ($i = $a, $n = strlen($t); $i < $n; $i++) { $c = $t[$i]; if ($in) { if ($esc) $esc = false; elseif ($c === '\\') $esc = true; elseif ($c === '"') $in = false; continue; } if ($c === '"') $in = true; elseif ($c === '{') $d++; elseif ($c === '}' && --$d === 0) { $end = $i; break; } }
    if ($end === null) return null; $s = substr($t, $a, $end - $a + 1);
    $j = json_decode($s, true) ?? json_decode(preg_replace('/,\s*([}\]])/', '$1', $s), true); return is_array($j) ? $j : null;
}
function first(array $a, array $keys, $d = null) { foreach ($keys as $k) if (isset($a[$k]) && $a[$k] !== '' && $a[$k] !== []) return $a[$k]; return $d; }
function as_list($v): array { if (is_string($v)) $v = preg_split('/\R+/', trim($v)); if (!is_array($v)) return []; $o = []; foreach ($v as $x) if (is_scalar($x) && trim((string)$x) !== '') $o[] = trim((string)$x); return $o; }
function norm_card($c): ?array {
    if (!is_array($c)) return null; if (isset($c[0], $c[1]) && is_scalar($c[0]) && is_scalar($c[1])) return [trim((string)$c[0]), trim((string)$c[1])];
    $q = first($c, ['q', 'pergunta', 'question', 'frente', 'front', 'prompt']); $a = first($c, ['a', 'resposta', 'answer', 'verso', 'back', 'response']);
    return ($q !== null && $a !== null && is_scalar($q) && is_scalar($a)) ? [trim((string)$q), trim((string)$a)] : null;
}
function norm_visuals(array $list, string $fallback): array {
    $out = [];
    foreach ($list as $v) { if (!is_array($v)) continue; $pts = as_list(first($v, ['points', 'pontos', 'itens', 'topicos'], [])); $vt = trim((string)first($v, ['title', 'titulo', 'título'], ''));
        if ($vt === '' && !$pts) continue;
        $out[] = ['emoji' => mb_substr((string)first($v, ['emoji', 'icone', 'ícone'], '💡'), 0, 8), 'title' => $vt ?: $fallback, 'points' => array_slice($pts, 0, 6), 'pitfall' => (string)first($v, ['pitfall', 'cuidado', 'erro_comum', 'atencao', 'atenção'], ''), 'example' => (string)first($v, ['example', 'exemplo'], '')]; }
    return $out;
}
function norm_route(array $r, array $in = []): array {
    $T = first($r, ['topics', 'assuntos', 'topicos', 'tópicos', 'modules', 'modulos', 'módulos', 'units', 'unidades', 'chapters', 'capitulos', 'lessons']);
    if (!is_array($T) || !$T) throw new InvalidArgumentException('A resposta não contém assuntos (topics).');
    $topics = [];
    foreach (array_slice(array_values($T), 0, 12) as $i => $t) {
        if (is_string($t)) $t = ['title' => $t]; if (!is_array($t)) continue;
        $title = trim((string)first($t, ['title', 'titulo', 'título', 'nome', 'name'], 'Assunto ' . ($i + 1)));
        $sum = as_list(first($t, ['summary', 'resumo', 'conteudo', 'conteúdo', 'content', 'texto', 'blocos'], []));
        $cards = []; foreach ((array)first($t, ['cards', 'cartoes', 'cartões', 'flashcards', 'perguntas', 'questions'], []) as $c) if (($n = norm_card($c)) && $n[0] !== '' && $n[1] !== '') $cards[] = $n;
        if (!$sum) $sum = ['Resumo do assunto ' . $title . '.']; if (!$cards) $cards[] = ['O que é ' . $title . '?', $sum[0]];
        $dif = first($t, ['difficulty', 'dificuldade', 'nivel', 'nível'], 3); if (is_string($dif) && !is_numeric($dif)) $dif = ['facil' => 1, 'fácil' => 1, 'medio' => 3, 'médio' => 3, 'dificil' => 5, 'difícil' => 5][mb_strtolower($dif)] ?? 3;
        $topics[] = ['title' => mb_substr($title, 0, 200), 'emoji' => mb_substr((string)first($t, ['emoji', 'icone', 'ícone'], '📖'), 0, 8), 'difficulty' => max(1, min(5, (int)$dif)), 'law' => (string)first($t, ['law', 'referencias_curtas', 'fontes', 'base'], ''), 'summary' => array_slice($sum, 0, 8),
            'mnemonic' => (string)first($t, ['mnemonic', 'mnemonico', 'mnemônico', 'dica'], ''), 'refs' => as_list(first($t, ['refs', 'referencias', 'referências', 'references'], [])), 'cards' => array_slice($cards, 0, 12), 'visuals' => array_slice(norm_visuals((array)first($t, ['visuals', 'visuais', 'resumos_visuais', 'resumos'], []), $title), 0, 3)];
    }
    $strategy = []; foreach ((array)first($r, ['strategy', 'estrategia', 'estratégia', 'estrategias', 'plano_de_estudo'], []) as $s) {
        if (is_string($s)) $strategy[] = ['tecnica' => 'Estratégia', 'como' => $s, 'frequencia' => ''];
        elseif (is_array($s)) $strategy[] = ['tecnica' => (string)first($s, ['tecnica', 'técnica', 'nome', 'name', 'title'], 'Estratégia'), 'como' => (string)first($s, ['como', 'descricao', 'descrição', 'description', 'how'], ''), 'frequencia' => (string)first($s, ['frequencia', 'frequência', 'frequency'], '')]; }
    $biblio = []; foreach ((array)first($r, ['biblio', 'bibliografia', 'bibliography', 'referencias', 'referências', 'references'], []) as $b) {
        if (is_string($b)) $b = ['titulo' => $b, 'verificada' => false]; if (!is_array($b)) continue; $au = first($b, ['autores', 'autor', 'authors', 'author'], '');
        $biblio[] = ['tipo' => (string)first($b, ['tipo', 'type'], ''), 'titulo' => (string)first($b, ['titulo', 'título', 'title', 'nome'], ''), 'autores' => is_array($au) ? implode(', ', $au) : (string)$au, 'ano' => first($b, ['ano', 'year'], ''), 'url' => (string)first($b, ['url', 'link'], ''), 'por_que' => (string)first($b, ['por_que', 'porque', 'motivo', 'why'], ''), 'verificada' => array_key_exists('verificada', $b) ? (bool)$b['verificada'] : false]; }
    $tags = first($r, ['tags', 'etiquetas', 'palavras_chave', 'keywords'], []); $tags = is_string($tags) ? preg_split('/\s*[,;]\s*/', $tags) : (array)$tags;
    return ['name' => mb_substr(trim((string)first($r, ['name', 'nome', 'title', 'titulo', 'título'], $in['objective'] ?? 'Nova trilha')), 0, 120), 'emoji' => mb_substr((string)first($r, ['emoji'], '✨'), 0, 8), 'goal' => mb_substr((string)first($r, ['goal', 'meta', 'objetivo_curto'], $in['objective'] ?? ''), 0, 200),
        'objective' => (string)first($r, ['objective', 'objetivo', 'objetivo_final'], $in['objective'] ?? ''), 'strategy' => $strategy, 'biblio' => $biblio, 'tags' => array_slice(array_values(array_filter(array_map(fn($x) => mb_substr(trim((string)$x), 0, 30), $tags))), 0, 8), 'topics' => $topics];
}
function norm_expand(?array $j, string $title): array {
    if (!$j) throw new InvalidArgumentException('Resposta sem JSON válido.');
    $cards = []; foreach ((array)first($j, ['cards', 'cartoes', 'cartões', 'flashcards'], []) as $c) if (($n = norm_card($c)) && $n[0] !== '' && $n[1] !== '') $cards[] = $n;
    $vis = norm_visuals((array)first($j, ['visuals', 'visuais', 'resumos_visuais'], []), $title);
    if (!$cards && !$vis) throw new InvalidArgumentException('A resposta não trouxe cartões nem resumos.');
    return ['cards' => array_slice($cards, 0, 10), 'visuals' => array_slice($vis, 0, 2)];
}
function apply_expand(int $tid, array $x): int {
    $n = 0; $have = q('SELECT q FROM cards WHERE topic_id=?', [$tid])->fetchAll(PDO::FETCH_COLUMN);
    foreach ($x['cards'] as $c) if (!in_array($c[0], $have, true)) { q('INSERT INTO cards(topic_id,q,a) VALUES(?,?,?)', [$tid, $c[0], $c[1]]); $n++; }
    $pos = (int)q('SELECT IFNULL(MAX(pos),-1)+1 FROM visuals WHERE topic_id=?', [$tid])->fetchColumn();
    foreach ($x['visuals'] as $v) { q('INSERT INTO visuals(topic_id,emoji,title,points,pitfall,example,pos) VALUES(?,?,?,?,?,?,?)', [$tid, $v['emoji'], $v['title'], json_encode($v['points'], JSON_UNESCAPED_UNICODE), $v['pitfall'], $v['example'], $pos++]); $n++; }
    return $n;
}

/* ---- vídeos: transcrição (legendas geradas a partir do áudio) ---- */
function yt_id(string $u): ?string { return preg_match('~(?:youtu\.be/|youtube\.com/(?:watch\?(?:[^#]*&)?v=|embed/|shorts/))([A-Za-z0-9_-]{11})~', $u, $m) ? $m[1] : null; }
function video_info(string $url): array {
    $info = ['title' => '', 'transcript' => null]; $id = yt_id($url); if (!$id) return $info;
    try {
        [$c, $o] = http_do('https://www.youtube.com/oembed?format=json&url=' . rawurlencode($url), [], null, 15); $j = json_decode($o, true); if ($c < 400 && is_array($j)) $info['title'] = trim(($j['title'] ?? '') . ' (' . ($j['author_name'] ?? '') . ')');
        [$c, $html] = http_do('https://www.youtube.com/watch?v=' . $id . '&hl=pt', ['Accept-Language: pt-BR,pt;q=0.9,en;q=0.8'], null, 25);
        if ($c < 400 && preg_match('/"captionTracks":(\[.*?\])/s', $html, $m) && ($tracks = json_decode($m[1], true))) {
            $pick = null; foreach (['pt', 'en'] as $lg) foreach ($tracks as $t) if (str_starts_with((string)($t['languageCode'] ?? ''), $lg)) { $pick = $t; break 2; }
            $pick ??= $tracks[0]; [$c2, $xml] = http_do((string)$pick['baseUrl'], [], null, 25);
            if ($c2 < 400 && preg_match_all('~<text[^>]*>(.*?)</text>~s', $xml, $mm)) { $txt = trim(preg_replace('/\s+/', ' ', html_entity_decode(implode(' ', $mm[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'))); if ($txt !== '') $info['transcript'] = $txt; }
        }
    } catch (Throwable) { /* melhor esforço: o usuário pode colar a transcrição */ }
    return $info;
}
function prep_videos(array $vids): array {
    $txt = ''; $src = []; $notes = [];
    foreach ($vids as $i => $v) { $inf = video_info($v['url']); $tr = $v['transcript'] !== '' ? $v['transcript'] : $inf['transcript']; if (!$tr) $notes[] = 'sem transcrição: ' . $v['url'];
        $txt .= 'VÍDEO ' . ($i + 1) . ': ' . ($inf['title'] ?: $v['url']) . ' | ' . $v['url'] . "\nTRANSCRIÇÃO: " . ($tr ? substr($tr, 0, 15000) : '(indisponível: use só o título e o link e avise isso na bibliografia)') . "\n\n";
        $src[] = ['url' => $v['url'], 'titulo' => $inf['title'], 'transcricao' => (bool)$tr]; }
    return [$txt, $src, $notes];
}
function prep_materials(array $mats): array {
    $txt = ''; $src = []; $docs = [];
    foreach ($mats as $m) { $txt .= '- ' . $m['title'] . ($m['author'] ? ' (' . $m['author'] . ')' : '') . ($m['text'] !== '' ? ":\n" . substr($m['text'], 0, 20000) : '') . "\n"; if (($m['pdf'] ?? '') !== '' && count($docs) < 3) $docs[] = ['data' => $m['pdf'], 'title' => $m['title']]; $src[] = ['titulo' => $m['title'], 'autor' => $m['author']]; }
    return [$txt, $src, $docs];
}

/* ---- pedidos (prompts) ---- */
function prompt_base(array $in, string $vtxt, string $mtxt, int $min, int $max): string {
    $p = 'Data de hoje: ' . date('d/m/Y') . ".\n\nVocê vai criar uma TRILHA DE APRENDIZAGEM em português do Brasil, para uma pessoa com baixa visão (textos curtos e claros).\n\n"
       . "DADOS BASE DA PESSOA:\nTEMA/DESCRIÇÃO: " . ($in['theme'] ?: '(a partir dos materiais e vídeos abaixo)') . "\nOBJETIVO FINAL: " . $in['objective'] . "\nNÍVEL ATUAL: " . $in['level'] . "\nCOMO APRENDE MELHOR: " . (($in['style'] ?? '') ?: 'misto') . '; sessões de ' . (($in['session'] ?? 0) ?: 25) . " minutos.\n";
    if ($in['themes'] !== '') $p .= "TEMAS E CONTEÚDOS DEFINIDOS PELO USUÁRIO (cubra todos, nesta ordem, e desenvolva cada um):\n" . $in['themes'] . "\n";
    $p .= "ORÇAMENTO: entre $min e $max assuntos, compatível com " . ($in['hpw'] ?: 5) . ' h/semana' . ($in['deadline'] ? ' até ' . $in['deadline'] : '') . ".\n";
    if ($mtxt !== '') $p .= "\nMATERIAIS BIBLIOGRÁFICOS DO USUÁRIO (priorize, cite como \"material próprio\" e use no conteúdo):\n$mtxt\n";
    if ($vtxt !== '') $p .= "\nVÍDEOS INDICADOS. A transcrição (baseada no áudio) dá o contexto específico do argumento; monte a rota para estudá-lo em profundidade, com a bibliografia e o estado da arte associados:\n$vtxt\n";
    return $p;
}
function search_rule(bool $search): string {
    return $search ? 'Use a busca na web para identificar a bibliografia e as referências MAIS ATUAIS (estado da arte): fontes primárias, revisões, livros-texto, normas e publicações recentes.' : 'Você NÃO tem acesso à web agora: use seu conhecimento, prefira obras e normas consagradas e marque verificada=false em toda referência de que não tiver certeza (o usuário vai conferir).';
}
/** Pedido único (modo agente manual): trilha completa de uma vez. */
function route_prompt(array $in, string $vtxt, string $mtxt, int $min, int $max, bool $search): string {
    $schema = '{"name":"título curto","emoji":"1 emoji","goal":"objetivo em uma frase","objective":"objetivo final detalhado","tags":["etiqueta"],"strategy":[{"tecnica":"","como":"","frequencia":""}],"biblio":[{"tipo":"livro|artigo|norma|site|video|material próprio","titulo":"","autores":"","ano":2025,"url":"","por_que":"","verificada":true}],"topics":[{"title":"","emoji":"","difficulty":3,"law":"referências curtas","summary":["bloco curto","bloco curto","bloco curto"],"mnemonic":"","refs":["títulos da bibliografia"],"cards":[["pergunta","resposta"]],"visuals":[{"emoji":"","title":"","points":["emoji + frase curta"],"pitfall":"","example":""}]}]}';
    return prompt_base($in, $vtxt, $mtxt, $min, $max) . "\nINSTRUÇÕES:\n1) " . search_rule($search) . "\n2) Só inclua URLs que você realmente conhece ou encontrou; na dúvida, deixe url vazio e verificada=false.\n3) Monte uma estratégia de estudo baseada em evidências (recuperação ativa, repetição espaçada, intercalação, codificação dupla, pausas), adequada ao objetivo, ao prazo e ao jeito de aprender da pessoa.\n4) Cada assunto: 3 a 5 blocos de resumo curtos, 4 a 6 cartões, 1 a 2 resumos visuais (3 a 5 pontos com emoji), mnemônico, difficulty de 1 a 5 e refs. Inclua 3 a 6 tags.\n5) Não invente fatos nem citações.\n6) Responda SOMENTE com JSON válido neste formato: $schema";
}
/** Etapa 1 da orquestração: só o plano (estratégia, bibliografia e lista de assuntos). */
function outline_prompt(array $in, string $vtxt, string $mtxt, int $min, int $max, bool $search): string {
    $schema = '{"name":"","emoji":"","goal":"","objective":"","tags":[""],"strategy":[{"tecnica":"","como":"","frequencia":""}],"biblio":[{"tipo":"","titulo":"","autores":"","ano":2025,"url":"","por_que":"","verificada":true}],"topics":[{"title":"","emoji":"","difficulty":3,"law":"referências curtas","focus":"o que este assunto deve cobrir, em uma frase"}]}';
    return prompt_base($in, $vtxt, $mtxt, $min, $max) . "\nETAPA 1 (PLANEJAMENTO): defina somente o PLANO da trilha, sem escrever o conteúdo dos assuntos.\n1) " . search_rule($search) . "\n2) Só inclua URLs que você realmente conhece ou encontrou; na dúvida, deixe url vazio e verificada=false.\n3) Estratégia de estudo baseada em evidências, adequada ao objetivo, ao prazo e ao jeito de aprender da pessoa.\n4) Entre $min e $max assuntos em ordem pedagógica (do básico ao avançado), cada um com título, emoji, difficulty (1 a 5) e foco. Inclua 3 a 6 tags.\n5) Não invente fatos nem citações.\n6) Responda SOMENTE com JSON válido neste formato: $schema";
}
/** Etapa 2: escreve um assunto por vez, com o contexto do plano. */
function topic_prompt(array $in, array $plan, array $t, int $i, bool $search, string $mtxt): string {
    $titles = implode('; ', array_map(fn($x) => $x['title'], $plan['topics']));
    $bib = implode('; ', array_slice(array_map(fn($b) => trim($b['titulo'] . ' (' . $b['autores'] . ' ' . $b['ano'] . ')'), $plan['biblio']), 0, 8));
    return 'Data de hoje: ' . date('d/m/Y') . ".\nTRILHA: {$plan['name']}. OBJETIVO: {$plan['objective']}. NÍVEL: {$in['level']}. COMO APRENDE: " . (($in['style'] ?? '') ?: 'misto') . ".\nASSUNTOS DA TRILHA (evite repetir os outros): $titles\nBIBLIOGRAFIA ESCOLHIDA: $bib\n" . ($mtxt !== '' ? "MATERIAIS DO USUÁRIO (use quando útil):\n" . substr($mtxt, 0, 6000) . "\n" : '')
        . "\nETAPA 2 (REDAÇÃO): escreva SOMENTE o assunto " . ($i + 1) . ": \"{$t['title']}\" (foco: " . ($t['focus'] ?? '') . ", dificuldade {$t['difficulty']}/5), em português do Brasil, textos curtos e claros para baixa visão.\n" . ($search ? 'Se precisar confirmar algo, pesquise fontes atuais.' : 'Use seu conhecimento e sinalize o que precisa ser conferido.')
        . "\nEntregue 3 a 5 blocos de resumo curtos, 4 a 6 cartões (pergunta e resposta), 1 a 2 resumos visuais (3 a 5 pontos com emoji), um mnemônico e refs (títulos da bibliografia usados). Não invente fatos.\nResponda SOMENTE com JSON: {\"summary\":[\"\"],\"mnemonic\":\"\",\"refs\":[\"\"],\"cards\":[[\"pergunta\",\"resposta\"]],\"visuals\":[{\"emoji\":\"\",\"title\":\"\",\"points\":[\"\"],\"pitfall\":\"\",\"example\":\"\"}]}";
}
function norm_outline(array $j, array $in): array {
    $r = norm_route($j, $in); $raw = array_values((array)first($j, ['topics', 'assuntos', 'topicos', 'tópicos', 'modules', 'modulos', 'módulos', 'units', 'unidades'], []));
    foreach ($r['topics'] as $i => &$t) $t['focus'] = is_array($raw[$i] ?? null) ? (string)first($raw[$i], ['focus', 'foco', 'descricao', 'descrição', 'objetivo'], '') : '';
    unset($t); return $r;
}
function norm_topic(array $j, string $title): array {
    $sum = as_list(first($j, ['summary', 'resumo', 'conteudo', 'conteúdo', 'texto'], [])); $cards = [];
    foreach ((array)first($j, ['cards', 'cartoes', 'cartões', 'flashcards'], []) as $c) if (($n = norm_card($c)) && $n[0] !== '' && $n[1] !== '') $cards[] = $n;
    if (!$sum && !$cards) throw new InvalidArgumentException('Resposta sem conteúdo do assunto.');
    return ['summary' => array_slice($sum ?: ['Resumo do assunto ' . $title . '.'], 0, 8), 'mnemonic' => (string)first($j, ['mnemonic', 'mnemonico', 'mnemônico', 'dica'], ''), 'refs' => as_list(first($j, ['refs', 'referencias', 'referências'], [])), 'cards' => array_slice($cards ?: [['O que é ' . $title . '?', $sum[0]]], 0, 12), 'visuals' => array_slice(norm_visuals((array)first($j, ['visuals', 'visuais', 'resumos_visuais'], []), $title), 0, 3)];
}

function expand_prompt(array $t, array $cards, string $focus, bool $search): string {
    $ex = implode("\n", array_map(fn($c) => '- ' . $c['q'], $cards));
    return 'Data de hoje: ' . date('d/m/Y') . ".\nAssunto: {$t['title']}\nResumo atual:\n{$t['summary']}\nCartões já existentes (não repita):\n$ex\n" . ($focus ? "Foco pedido: $focus\n" : '') . ($search ? 'Se precisar, pesquise fontes atuais.' : 'Responda com seu conhecimento e sinalize o que precisa ser conferido.')
        . "\nCrie 4 a 6 NOVOS cartões e 1 resumo visual, em português do Brasil. Responda SOMENTE com JSON: {\"cards\":[[\"pergunta\",\"resposta\"]],\"visuals\":[{\"emoji\":\"\",\"title\":\"\",\"points\":[\"emoji + frase curta\"],\"pitfall\":\"\",\"example\":\"\"}]}";
}
/** Último recurso sem IA: esqueleto editável a partir dos temas do usuário. */
function skeleton_topic(string $n, array $in, int $k = 0): array {
    $E = ['🧩', '🔬', '🛠️', '🌐', '🎯', '📚', '🧠', '🔭'];
    return ['title' => $n, 'emoji' => $E[$k % 8], 'difficulty' => min(5, 2 + intdiv($k, 2)), 'summary' => ['Escreva aqui, com as suas palavras, o essencial de "' . $n . '".', 'Conecte este assunto ao objetivo: ' . ($in['objective'] ?? '') . '.'], 'mnemonic' => '', 'refs' => [], 'cards' => [['O que é ' . $n . '?', 'Complete esta resposta.'], ['Por que ' . $n . ' importa para o seu objetivo?', 'Complete esta resposta.']], 'visuals' => []];
}
function skeleton_route(array $in): array {
    $th = trim((string)($in['theme'] ?: $in['objective'])); $L = array_values(array_filter(array_map('trim', preg_split('/\R/', (string)$in['themes']))));
    $names = $L ?: ['Fundamentos e vocabulário', 'Conceitos centrais', 'Métodos e aplicações', 'Debates atuais', 'Revisão integrada']; $topics = [];
    foreach (array_slice($names, 0, 8) as $k => $n) $topics[] = skeleton_topic($n, $in, $k);
    return ['name' => mb_substr($th ?: 'Nova trilha', 0, 60) . ' (rascunho)', 'emoji' => '📝', 'goal' => $in['objective'], 'objective' => $in['objective'], 'tags' => ['rascunho'],
        'strategy' => [['tecnica' => 'Recuperação ativa', 'como' => 'Responda os cartões antes de ver a resposta.', 'frequencia' => 'toda sessão'], ['tecnica' => 'Repetição espaçada', 'como' => 'Revise nos intervalos sugeridos pelo sistema.', 'frequencia' => 'diária']],
        'biblio' => array_map(fn($m) => ['tipo' => 'material próprio', 'titulo' => $m['title'], 'autores' => $m['author'], 'ano' => '', 'url' => '', 'por_que' => 'Enviado por você.', 'verificada' => true], (array)$in['materials']), 'topics' => $topics];
}

/* ---- criação da trilha ---- */
function finish_route(int $jid, int $uid, array $in, array $route, array $meta, string $msg): int {
    $route['slug'] = ''; $route['objective'] = $route['objective'] ?: ($in['objective'] ?? '');
    $route['sources'] = array_merge(['modo' => $in['mode'] ?? 'tema', 'videos' => $meta['videos'] ?? [], 'materiais' => $meta['materiais'] ?? [], 'avisos' => $meta['avisos'] ?? [], 'gerado_em' => date('c')], $meta['extra'] ?? []);
    $pid = install_package($route, $uid, ['tema' => 'ia', 'material' => 'material', 'video' => 'video'][$in['mode'] ?? 'tema'] ?? 'ia');
    q('INSERT OR IGNORE INTO plans(user_id,package_id,deadline,hpw,start_ts) VALUES(?,?,?,?,?)', [$uid, $pid, $in['deadline_ts'] ?? null, ($in['hpw'] ?? 0) ?: 5, time()]);
    q('UPDATE users SET pkg=? WHERE id=?', [$pid, $uid]);
    q('UPDATE jobs SET status=?,msg=?,route_id=? WHERE id=?', ['pronto', $msg, $pid, $jid]);
    return $pid;
}
function job_progress(int $jid, array $st): void { q('UPDATE jobs SET progress=? WHERE id=?', [json_encode($st, JSON_UNESCAPED_UNICODE), $jid]); }
/** Orquestrador: prepara, planeja (agente planejador), escreve assunto por assunto (agente redator), monta. Cada chamada tem contingência entre os agentes; um assunto que falhar vira rascunho em vez de derrubar a trilha. */
function run_route_job(int $jid, int $uid, array $in): void {
    $upd = fn(string $s, string $m, ?int $rid = null) => q('UPDATE jobs SET status=?,msg=?,route_id=? WHERE id=?', [$s, $m, $rid, $jid]);
    $st = ['steps' => [['k' => 'preparar', 't' => 'Preparar materiais e vídeos', 's' => 'andamento'], ['k' => 'planejar', 't' => 'Planejar a trilha e pesquisar a bibliografia', 's' => 'espera'], ['k' => 'escrever', 't' => 'Escrever os assuntos', 's' => 'espera'], ['k' => 'montar', 't' => 'Revisar e montar a trilha', 's' => 'espera']], 'agentes' => [], 'falhas' => []];
    $set = function (string $k, string $s, string $d = '') use (&$st, $jid) { foreach ($st['steps'] as &$x) if ($x['k'] === $k) { $x['s'] = $s; if ($d !== '') $x['d'] = $d; } unset($x); job_progress($jid, $st); };
    $meta = ['videos' => [], 'materiais' => [], 'avisos' => []]; $have = false; $sys = 'Você é pesquisador(a) e designer instrucional. Responda em português do Brasil e somente com JSON válido, sem texto fora do JSON.';
    try {
        $set('preparar', 'andamento'); $upd('gerando', 'Lendo materiais e vídeos…');
        [$vtxt, $meta['videos'], $meta['avisos']] = prep_videos($in['videos']); [$mtxt, $meta['materiais'], $docs] = prep_materials($in['materials']);
        $hours = $in['deadline_ts'] ? max(2, ($in['deadline_ts'] - time()) / 604800 * ($in['hpw'] ?: 5)) : 20; $max = max(4, min(10, (int)round($hours / 2.5))); $min = max(3, $max - 2);
        $save = $in; $save['materials'] = array_map(fn($m) => array_diff_key($m, ['pdf' => 1]), $in['materials']);
        q('UPDATE jobs SET payload=? WHERE id=?', [json_encode(['input' => $save, 'meta' => $meta, 'prompt' => route_prompt($in, $vtxt, $mtxt, $min, $max, false) . "\n\nSe você for um agente com navegação na web, use-a para atualizar as referências e marque verificada=true só para o que confirmar. Responda apenas com o JSON."], JSON_UNESCAPED_UNICODE), $jid]); $have = true;
        $set('preparar', 'ok');
        if (!ia_info(['id' => $uid, 'role' => 'aluno'])['enabled']) { $upd('manual', 'A IA automática não está configurada neste servidor. Use o modo agente ou crie um esqueleto.'); return; }
        $set('planejar', 'andamento'); $upd('gerando', 'Planejando a trilha e pesquisando a bibliografia…');
        $p1 = ai_complete(['system' => $sys, 'user' => fn(bool $s) => outline_prompt($in, $vtxt, $mtxt, $min, $max, $s), 'docs' => $docs, 'search' => true, 'max_tokens' => 8000],
            fn($t) => norm_outline(extract_json($t) ?? throw new InvalidArgumentException('Resposta sem JSON válido.'), $in), 'planejador');
        $plan = $p1['result']; $st['agentes']['planejar'] = $p1['provider'] . ($p1['search'] ? ' (com busca na web)' : ' (sem busca na web)'); $set('planejar', 'ok');
        $set('escrever', 'andamento'); $n = count($plan['topics']); $bad = [];
        foreach ($plan['topics'] as $i => &$t) {
            $set('escrever', 'andamento', 'Assunto ' . ($i + 1) . ' de ' . $n . ': ' . $t['title']); $upd('gerando', 'Escrevendo o assunto ' . ($i + 1) . ' de ' . $n . '…');
            try {
                $r = ai_complete(['system' => $sys, 'user' => fn(bool $s) => topic_prompt($in, $plan, $t, $i, $s, $mtxt), 'search' => true, 'max_tokens' => 6000],
                    fn($x) => norm_topic(extract_json($x) ?? throw new InvalidArgumentException('Resposta sem JSON válido.'), $t['title']), 'redator');
                $t = array_merge($t, $r['result']); $st['agentes']['escrever'] = $r['provider'];
            } catch (Throwable $e) { $bad[] = $t['title']; $st['falhas'][] = $t['title'] . ': ' . $e->getMessage(); $t = array_merge($t, array_diff_key(skeleton_topic($t['title'], $in, $i), ['title' => 1, 'emoji' => 1, 'difficulty' => 1])); }
        }
        unset($t);
        $set('escrever', $bad ? 'parcial' : 'ok', $bad ? count($bad) . ' assunto(s) ficaram como rascunho' : 'Todos os assuntos escritos');
        $set('montar', 'andamento'); $upd('gerando', 'Revisando e montando a trilha…');
        $note = 'Criada pelo orquestrador: plano por ' . ($st['agentes']['planejar'] ?? '?') . ', texto por ' . ($st['agentes']['escrever'] ?? 'esqueleto') . '.' . ($bad ? ' Rascunhos para completar com "Gerar mais cartões": ' . implode(', ', $bad) . '.' : '') . ($meta['avisos'] ? ' Avisos: ' . implode('; ', $meta['avisos']) : '');
        finish_route($jid, $uid, $in, $plan, $meta + ['extra' => ['agentes' => $st['agentes'], 'rascunhos' => $bad, 'orquestrado' => true]], $note);
        $set('montar', 'ok');
    } catch (Throwable $e) { if ($have) $upd('manual', 'Não foi possível concluir com a IA agora. ' . $e->getMessage()); else $upd('erro', $e->getMessage()); }
}
