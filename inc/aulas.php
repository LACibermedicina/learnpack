<?php
declare(strict_types=1);
/* Aulas em áudio/vídeo: envio em partes, transcrição automática (agentes com STT, em contingência), estruturação,
   bibliografia detalhada e material de aprofundamento, tudo guardado na biblioteca para alimentar as trilhas. */
const MEDIA_EXT = ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'opus', 'flac', 'aac', 'webm', 'mp4', 'mov', 'mkv', 'avi', 'mpeg', 'mpg', '3gp', 'wma', 'wmv'];
function mime_of(string $name, string $given = ''): string {
    $m = ['mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4', 'wav' => 'audio/wav', 'ogg' => 'audio/ogg', 'oga' => 'audio/ogg', 'opus' => 'audio/ogg', 'flac' => 'audio/flac', 'aac' => 'audio/aac', 'webm' => 'video/webm', 'mp4' => 'video/mp4', 'mov' => 'video/quicktime', 'mkv' => 'video/x-matroska', 'avi' => 'video/x-msvideo', 'mpeg' => 'video/mpeg', 'mpg' => 'video/mpeg', '3gp' => 'video/3gpp', 'wma' => 'audio/x-ms-wma', 'wmv' => 'video/x-ms-wmv'];
    return $m[strtolower(pathinfo($name, PATHINFO_EXTENSION))] ?? ($given ?: 'application/octet-stream');
}
function fmt_ts(int $s): string { return $s >= 3600 ? sprintf('%d:%02d:%02d', intdiv($s, 3600), intdiv($s % 3600, 60), $s % 60) : sprintf('%02d:%02d', intdiv($s, 60), $s % 60); }
function ffmpeg_path(): ?string {
    static $p = false; if ($p !== false) return $p; $p = null; $dis = array_map('trim', explode(',', (string)ini_get('disable_functions')));
    if (!function_exists('shell_exec') || in_array('shell_exec', $dis, true)) return $p;
    $o = trim((string)@shell_exec('command -v ffmpeg 2>/dev/null')); if ($o !== '') $p = $o; return $p;
}
function media_dir(int $id = 0): string { $d = rtrim((string)cfg('data'), '/') . '/uploads' . ($id ? '/' . $id : ''); if (!is_dir($d)) @mkdir($d, 0750, true); return $d; }
/** Com ffmpeg: extrai só o áudio, mono, 16 kHz (arquivo muito menor). Sem ffmpeg: usa o arquivo como veio. */
function audio_prepare(string $path, string $dir): array {
    $ff = ffmpeg_path(); if (!$ff) return [$path, null]; $out = $dir . '/audio.mp3';
    @shell_exec(escapeshellarg($ff) . ' -y -i ' . escapeshellarg($path) . ' -vn -ac 1 -ar 16000 -b:a 48k ' . escapeshellarg($out) . ' 2>&1');
    return (is_file($out) && filesize($out) > 1000) ? [$out, 'audio/mpeg'] : [$path, null];
}
function http_post_h(string $url, array $headers, string $body): array {      // [código, cabeçalhos, corpo]
    $ch = curl_init($url); curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CONNECTTIMEOUT => 20]);
    $out = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $hs = (int)curl_getinfo($ch, CURLINFO_HEADER_SIZE); $err = curl_error($ch); curl_close($ch);
    if ($out === false) throw new RuntimeException('Falha de rede: ' . $err);
    $h = []; foreach (explode("\r\n", substr((string)$out, 0, $hs)) as $l) if (strpos($l, ':') !== false) { [$k, $v] = explode(':', $l, 2); $h[strtolower(trim($k))] = trim($v); }
    return [$code, $h, substr((string)$out, $hs)];
}
function http_upload_file(string $url, array $headers, string $path): array {   // envia o arquivo em fluxo (sem carregar tudo na memória)
    $fh = fopen($path, 'rb'); $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_UPLOAD => true, CURLOPT_CUSTOMREQUEST => 'POST', CURLOPT_INFILE => $fh, CURLOPT_INFILESIZE => filesize($path), CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 3600, CURLOPT_CONNECTTIMEOUT => 20]);
    $out = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch); fclose($fh);
    if ($out === false) throw new RuntimeException('Falha de rede no envio: ' . $err);
    return [$code, (string)$out];
}
function gem_base(array $p): string { return preg_replace('~/v1beta/?$~', '', rtrim($p['base_url'] ?: 'https://generativelanguage.googleapis.com', '/')); }
function gemini_upload(array $p, string $path, string $mime, string $name): array {
    $base = gem_base($p); $size = filesize($path); $key = 'x-goog-api-key: ' . $p['key'];
    [$c, $h, $b] = http_post_h($base . '/upload/v1beta/files', [$key, 'X-Goog-Upload-Protocol: resumable', 'X-Goog-Upload-Command: start', 'X-Goog-Upload-Header-Content-Length: ' . $size, 'X-Goog-Upload-Header-Content-Type: ' . $mime, 'Content-Type: application/json'], json_encode(['file' => ['display_name' => $name]]));
    $up = $h['x-goog-upload-url'] ?? ''; if ($c >= 400 || $up === '') throw new IaHttp($c, 'Não foi possível iniciar o envio ao Gemini: ' . substr($b, 0, 160));
    [$c2, $b2] = http_upload_file($up, [$key, 'X-Goog-Upload-Offset: 0', 'X-Goog-Upload-Command: upload, finalize', 'Content-Length: ' . $size], $path);
    $j = json_decode($b2, true); if ($c2 >= 400 || empty($j['file']['uri'])) throw new IaHttp($c2, 'Envio ao Gemini falhou: ' . substr($b2, 0, 160));
    $f = $j['file'];
    for ($i = 0; $i < 90 && ($f['state'] ?? 'ACTIVE') === 'PROCESSING'; $i++) { sleep(4); [, $b3] = http_do($base . '/v1beta/' . $f['name'], [$key], null, 30); $f = json_decode($b3, true) ?: $f; }
    if (($f['state'] ?? 'ACTIVE') !== 'ACTIVE') throw new RuntimeException('O Gemini não conseguiu processar o arquivo.');
    return ['uri' => $f['uri'], 'mime' => $f['mimeType'] ?? $mime];
}
function stt_gemini(array $p, string $path, string $mime, string $lang, string $name): string {
    $model = ($p['model'] ?? '') ?: 'gemini-flash-latest'; $base = gem_base($p);
    if (filesize($path) <= 14 * 1048576) $part = ['inline_data' => ['mime_type' => $mime, 'data' => base64_encode((string)file_get_contents($path))]];
    else { $f = gemini_upload($p, $path, $mime, $name); $part = ['file_data' => ['mime_type' => $f['mime'], 'file_uri' => $f['uri']]]; }
    $prompt = "Transcreva FIELMENTE a fala deste áudio (idioma principal: $lang). Formato: um parágrafo por trecho, cada um começando com o tempo no formato [mm:ss] (ou [h:mm:ss]); quando houver mais de uma pessoa falando, indique 'Falante 1:', 'Falante 2:'. Não resuma, não traduza, não invente; marque trechos ininteligíveis com [inaudível]. Responda só com a transcrição.";
    $text = '';
    for ($i = 0; $i < 6; $i++) {                         // aulas longas: continua de onde parou se a resposta for cortada
        $parts = [$part, ['text' => $i === 0 ? $prompt : $prompt . "\n\nA transcrição já feita termina assim:\n" . substr($text, -600) . "\n\nCONTINUE exatamente de onde parou, sem repetir."]];
        [$c, $o] = http_do($base . '/v1beta/models/' . $model . ':generateContent', ['content-type: application/json', 'x-goog-api-key: ' . $p['key']], json_encode(['contents' => [['role' => 'user', 'parts' => $parts]], 'generationConfig' => ['temperature' => 0, 'maxOutputTokens' => 60000]], JSON_UNESCAPED_UNICODE), 3600);
        $j = json_decode($o, true); if ($c >= 400 || !is_array($j)) throw new IaHttp($c, $j['error']['message'] ?? substr($o, 0, 200));
        $chunk = ''; foreach ((array)($j['candidates'][0]['content']['parts'] ?? []) as $pt) $chunk .= $pt['text'] ?? '';
        $text .= ($text !== '' ? "\n" : '') . trim($chunk);
        if (($j['candidates'][0]['finishReason'] ?? 'STOP') !== 'MAX_TOKENS') break;
    }
    return trim($text);
}
function stt_openai(array $p, string $path, string $mime, string $lang, string $name, string $dir): string {
    $base = rtrim($p['base_url'] ?: 'https://api.openai.com/v1', '/'); $files = [[$path, 0]];
    if (filesize($path) > 24 * 1048576) {
        $ff = ffmpeg_path(); if (!$ff) throw new RuntimeException('Arquivo maior que 25 MB: este agente precisa do ffmpeg no servidor para dividir o áudio.');
        foreach (glob($dir . '/seg*.mp3') ?: [] as $old) @unlink($old);
        @shell_exec(escapeshellarg($ff) . ' -y -i ' . escapeshellarg($path) . ' -vn -ac 1 -ar 16000 -b:a 32k -f segment -segment_time 600 ' . escapeshellarg($dir . '/seg%03d.mp3') . ' 2>&1');
        $segs = glob($dir . '/seg*.mp3') ?: []; sort($segs); if (!$segs) throw new RuntimeException('Não foi possível dividir o áudio.'); $files = []; foreach ($segs as $k => $s) $files[] = [$s, $k * 600];
    }
    $out = [];
    foreach ($files as [$f, $off]) {
        $post = ['file' => new CURLFile($f, mime_of($f, $mime), basename($f)), 'model' => ($p['model'] && stripos((string)$p['model'], 'whisper') !== false) ? $p['model'] : 'whisper-1', 'response_format' => 'verbose_json']; if ($lang) $post['language'] = substr($lang, 0, 2);
        $ch = curl_init($base . '/audio/transcriptions'); curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $post, CURLOPT_HTTPHEADER => !empty($p['key']) ? ['Authorization: Bearer ' . $p['key']] : [], CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 3600, CURLOPT_CONNECTTIMEOUT => 20]);
        $o = curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $er = curl_error($ch); curl_close($ch);
        if ($o === false) throw new RuntimeException('Falha de rede: ' . $er); $j = json_decode((string)$o, true); if ($c >= 400 || !is_array($j)) throw new IaHttp($c, $j['error']['message'] ?? substr((string)$o, 0, 200));
        if (!empty($j['segments'])) foreach ($j['segments'] as $sg) $out[] = '[' . fmt_ts((int)($sg['start'] ?? 0) + $off) . '] ' . trim((string)$sg['text']); else $out[] = '[' . fmt_ts($off) . '] ' . trim((string)($j['text'] ?? ''));
    }
    return implode("\n", $out);
}
function ia_stt_active(): array {
    $h = jd(setting('ia_health', '')); $now = time();
    $l = array_values(array_filter(ia_providers(), fn($p) => !empty($p['enabled']) && !empty($p['stt']) && in_array($p['type'] ?? '', ['gemini', 'openai'], true)));
    $ok = array_values(array_filter($l, fn($p) => ((int)($h[$p['id'] . '_stt']['until'] ?? 0)) <= $now)); return $ok ?: $l;
}
/** Tenta cada agente com reconhecimento de fala, em ordem de prioridade. */
function stt_transcribe(string $path, string $mime, string $lang, string $name, string $dir): array {
    $errs = [];
    foreach (ia_stt_active() as $p) {
        try {
            $t = $p['type'] === 'gemini' ? stt_gemini($p, $path, $mime, $lang, $name) : stt_openai($p, $path, $mime, $lang, $name, $dir);
            if (strlen(trim($t)) < 20) throw new RuntimeException('Transcrição vazia.');
            ia_mark($p['id'] . '_stt', true); return ['text' => $t, 'provider' => (string)($p['label'] ?: $p['type'])];
        } catch (Throwable $e) { $errs[] = ($p['label'] ?: $p['type']) . ': ' . $e->getMessage(); ia_mark($p['id'] . '_stt', false); }
    }
    throw new RuntimeException($errs ? 'Nenhum agente conseguiu transcrever (' . implode(' | ', array_slice($errs, -4)) . ').' : 'Nenhum agente com transcrição de áudio está ativo (ligue "Transcreve áudio" em Administração → IA).');
}

/* ---- estruturação, bibliografia e aprofundamento ---- */
function lesson_prompt(string $title, string $tr, int $part, int $parts): string {
    $schema = '{"title":"","summary":"resumo em 5 a 8 frases","chapters":[{"t":"mm:ss","title":"","summary":"2 a 3 frases"}],"key_concepts":[{"term":"","definition":""}],"references_mentioned":[{"name":"","kind":"livro|artigo|norma|autor|site|outro","t":"mm:ss","context":"o que foi dito"}],"questions":["pergunta de revisão"]}';
    return 'Esta é a transcrição' . ($parts > 1 ? " (parte $part de $parts)" : '') . " da aula \"$title\".\nTRANSCRIÇÃO:\n$tr\n\nEstruture a aula em português do Brasil: título, resumo, capítulos com tempo (use os tempos [mm:ss] da transcrição), conceitos-chave com definição, TODAS as obras, autores, normas e fontes citados pelo professor (com o trecho) e 5 a 8 perguntas de revisão. Não invente nada que não esteja na aula. Responda SOMENTE com JSON: $schema";
}
function norm_lesson(array $j, string $title): array {
    $ch = []; foreach ((array)first($j, ['chapters', 'capitulos', 'capítulos', 'secoes', 'seções'], []) as $c) if (is_array($c)) $ch[] = ['t' => (string)first($c, ['t', 'tempo', 'time', 'inicio', 'início'], ''), 'title' => (string)first($c, ['title', 'titulo', 'título'], ''), 'summary' => (string)first($c, ['summary', 'resumo'], '')];
    $kc = []; foreach ((array)first($j, ['key_concepts', 'conceitos', 'conceitos_chave', 'conceitos-chave'], []) as $c) { if (is_array($c)) $kc[] = ['term' => (string)first($c, ['term', 'termo', 'conceito'], ''), 'definition' => (string)first($c, ['definition', 'definicao', 'definição'], '')]; elseif (is_string($c)) $kc[] = ['term' => $c, 'definition' => '']; }
    $rm = []; foreach ((array)first($j, ['references_mentioned', 'referencias_citadas', 'referências_citadas', 'referencias'], []) as $c) { if (is_array($c)) $rm[] = ['name' => (string)first($c, ['name', 'nome', 'titulo', 'título'], ''), 'kind' => (string)first($c, ['kind', 'tipo'], 'outro'), 't' => (string)first($c, ['t', 'tempo'], ''), 'context' => (string)first($c, ['context', 'contexto', 'trecho'], '')]; elseif (is_string($c)) $rm[] = ['name' => $c, 'kind' => 'outro', 't' => '', 'context' => '']; }
    $sum = (string)first($j, ['summary', 'resumo'], ''); if ($sum === '' && !$ch) throw new InvalidArgumentException('Estrutura da aula vazia.');
    return ['title' => (string)first($j, ['title', 'titulo', 'título'], $title), 'summary' => $sum, 'chapters' => $ch, 'key_concepts' => array_values(array_filter($kc, fn($x) => $x['term'] !== '')), 'references_mentioned' => array_values(array_filter($rm, fn($x) => $x['name'] !== '')), 'questions' => as_list(first($j, ['questions', 'perguntas'], []))];
}
function lesson_merge(array $parts): array {
    $L = $parts[0]; $L['summary'] = trim(implode(' ', array_map(fn($p) => $p['summary'], $parts)));
    foreach (array_slice($parts, 1) as $p) { $L['chapters'] = array_merge($L['chapters'], $p['chapters']); $L['questions'] = array_merge($L['questions'], $p['questions']); }
    foreach (['key_concepts' => 'term', 'references_mentioned' => 'name'] as $k => $key) { $seen = []; $o = []; foreach ($parts as $p) foreach ($p[$k] as $x) if (!isset($seen[mb_strtolower($x[$key])])) { $seen[mb_strtolower($x[$key])] = 1; $o[] = $x; } $L[$k] = $o; }
    $L['questions'] = array_slice($L['questions'], 0, 12); return $L;
}
function lesson_fallback(string $title, string $tr): array {      // sem IA: capítulos por blocos de linhas com tempo
    $lines = array_values(array_filter(preg_split('/\R/', $tr))); $ch = [];
    foreach (array_chunk($lines, 8) as $i => $b) { preg_match('/^\[([0-9:]+)\]/', $b[0], $m); $ch[] = ['t' => $m[1] ?? '', 'title' => 'Trecho ' . ($i + 1), 'summary' => mb_substr(trim(preg_replace('/\[[0-9:]+\]\s*/', '', implode(' ', $b))), 0, 220)]; }
    return ['title' => $title, 'summary' => mb_substr(trim(preg_replace('/\[[0-9:]+\]\s*/', '', $tr)), 0, 600), 'chapters' => array_slice($ch, 0, 40), 'key_concepts' => [], 'references_mentioned' => [], 'questions' => []];
}
function biblio_prompt(array $L, bool $search): string {
    $schema = '{"biblio":[{"tipo":"livro|artigo|norma|site|video","titulo":"","autores":"","ano":2025,"url":"","por_que":"","verificada":true,"citada_na_aula":true,"trecho":"mm:ss"}],"estado_da_arte":"parágrafo sobre o estado da arte do assunto"}';
    return 'Data de hoje: ' . date('d/m/Y') . ".\nAULA: {$L['title']}\nRESUMO: {$L['summary']}\nCONCEITOS: " . implode('; ', array_map(fn($c) => $c['term'], $L['key_concepts'])) . "\nFONTES CITADAS PELO PROFESSOR:\n" . implode("\n", array_map(fn($r) => '- ' . $r['name'] . ' (' . $r['kind'] . ($r['t'] ? ', ' . $r['t'] : '') . '): ' . $r['context'], $L['references_mentioned']))
        . "\n\nTAREFA: (1) " . search_rule($search) . " (2) RESOLVA e DETALHE cada fonte citada na aula (autores, título completo, ano, editora ou periódico, URL ou DOI); se não achar, mantenha com verificada=false. (3) ACRESCENTE de 5 a 10 obras, normas e artigos atuais que aprofundam o tema (estado da arte), cada um com por_que. (4) Escreva um parágrafo sobre o estado da arte. Não invente referências. Responda SOMENTE com JSON: $schema";
}
function norm_biblio_list($list): array {
    $o = [];
    foreach ((array)$list as $b) { if (is_string($b)) $b = ['titulo' => $b, 'verificada' => false]; if (!is_array($b)) continue; $t = (string)first($b, ['titulo', 'título', 'title', 'nome'], ''); if ($t === '') continue; $au = first($b, ['autores', 'autor', 'authors', 'author'], '');
        $o[] = ['tipo' => (string)first($b, ['tipo', 'type'], ''), 'titulo' => $t, 'autores' => is_array($au) ? implode(', ', $au) : (string)$au, 'ano' => first($b, ['ano', 'year'], ''), 'url' => (string)first($b, ['url', 'link'], ''), 'por_que' => (string)first($b, ['por_que', 'porque', 'motivo', 'why'], ''), 'verificada' => array_key_exists('verificada', $b) ? (bool)$b['verificada'] : false, 'citada_na_aula' => !empty($b['citada_na_aula']), 'trecho' => (string)first($b, ['trecho', 't', 'tempo'], '')]; }
    return $o;
}
function norm_bib_response(array $j): array {
    $b = norm_biblio_list(first($j, ['biblio', 'bibliografia', 'bibliography', 'referencias', 'referências', 'references'], [])); if (!$b) throw new InvalidArgumentException('Bibliografia vazia.');
    return ['biblio' => $b, 'sota' => (string)first($j, ['estado_da_arte', 'estado da arte', 'sota'], '')];
}
function lesson_deep_prompt(array $L, array $bib, string $sota): string {
    $b = implode('; ', array_slice(array_map(fn($x) => $x['titulo'] . ($x['autores'] ? ' (' . $x['autores'] . ')' : ''), $bib), 0, 12));
    return "AULA: {$L['title']}\nRESUMO: {$L['summary']}\nCAPÍTULOS: " . implode('; ', array_map(fn($c) => $c['title'], $L['chapters'])) . "\nCONCEITOS: " . implode('; ', array_map(fn($c) => $c['term'], $L['key_concepts'])) . "\nBIBLIOGRAFIA: $b\nESTADO DA ARTE: $sota\n\nEscreva um MATERIAL DE APROFUNDAMENTO em português do Brasil, em textos curtos e claros (baixa visão): 4 a 6 seções que expliquem em profundidade os conceitos principais, ligando cada seção às obras da bibliografia; depois perguntas para reflexão e próximos passos de estudo. Não invente referências. Responda SOMENTE com JSON: {\"title\":\"\",\"sections\":[{\"title\":\"\",\"text\":\"3 a 6 frases\",\"refs\":[\"títulos da bibliografia\"]}],\"questions\":[\"\"],\"next_steps\":[\"\"]}";
}
function norm_deep(array $j, string $title): array {
    $sec = []; foreach ((array)first($j, ['sections', 'secoes', 'seções'], []) as $s) if (is_array($s)) { $tx = (string)first($s, ['text', 'texto'], ''); if ($tx !== '') $sec[] = ['title' => (string)first($s, ['title', 'titulo', 'título'], ''), 'text' => $tx, 'refs' => as_list(first($s, ['refs', 'referencias'], []))]; }
    if (!$sec) throw new InvalidArgumentException('Aprofundamento vazio.');
    return ['title' => (string)first($j, ['title', 'titulo'], 'Aprofundamento: ' . $title), 'sections' => $sec, 'questions' => as_list(first($j, ['questions', 'perguntas'], [])), 'next_steps' => as_list(first($j, ['next_steps', 'proximos_passos', 'próximos_passos'], []))];
}
function lesson_text(array $L, array $bib, string $sota): string {
    $t = $L['title'] . "\n\nRESUMO\n" . $L['summary'] . "\n\nCAPÍTULOS\n"; foreach ($L['chapters'] as $c) $t .= '[' . $c['t'] . '] ' . $c['title'] . ': ' . $c['summary'] . "\n";
    $t .= "\nCONCEITOS-CHAVE\n"; foreach ($L['key_concepts'] as $c) $t .= '- ' . $c['term'] . ': ' . $c['definition'] . "\n";
    $t .= "\nFONTES CITADAS NA AULA\n"; foreach ($L['references_mentioned'] as $r) $t .= '- ' . $r['name'] . ($r['t'] ? ' [' . $r['t'] . ']' : '') . ': ' . $r['context'] . "\n";
    $t .= "\nBIBLIOGRAFIA\n"; foreach ($bib as $b) $t .= '- ' . $b['titulo'] . ($b['autores'] ? ' (' . $b['autores'] . ($b['ano'] ? ', ' . $b['ano'] : '') . ')' : '') . ($b['url'] ? ' ' . $b['url'] : '') . ($b['citada_na_aula'] ? ' [citada na aula]' : '') . ($b['verificada'] ? '' : ' [confirmar]') . ($b['por_que'] ? ': ' . $b['por_que'] : '') . "\n";
    if ($sota !== '') $t .= "\nESTADO DA ARTE\n" . $sota . "\n"; $t .= "\nPERGUNTAS DE REVISÃO\n"; foreach ($L['questions'] as $q) $t .= '- ' . $q . "\n"; return trim($t);
}
function deep_text(array $D): string {
    $t = $D['title'] . "\n"; foreach ($D['sections'] as $s) $t .= "\n" . $s['title'] . "\n" . $s['text'] . ($s['refs'] ? "\nFontes: " . implode('; ', $s['refs']) : '') . "\n";
    if ($D['questions']) { $t .= "\nPERGUNTAS PARA REFLEXÃO\n"; foreach ($D['questions'] as $q) $t .= '- ' . $q . "\n"; }
    if ($D['next_steps']) { $t .= "\nPRÓXIMOS PASSOS\n"; foreach ($D['next_steps'] as $q) $t .= '- ' . $q . "\n"; } return trim($t);
}
/** Pipeline completo de uma aula, em segundo plano. Cada etapa tem contingência; sem IA, usa estruturas simples. */
function run_media_job(int $mid): void {
    $m = q('SELECT * FROM media WHERE id=?', [$mid])->fetch(); if (!$m) return; $uid = (int)$m['user_id']; $o = jd($m['opts']); $dir = media_dir($mid); $title = (string)$m['title'];
    $st = ['steps' => [['k' => 'preparar', 't' => 'Preparar o áudio', 's' => 'andamento'], ['k' => 'transcrever', 't' => 'Transcrever a fala', 's' => 'espera'], ['k' => 'estruturar', 't' => 'Estruturar a aula (capítulos, conceitos e fontes citadas)', 's' => 'espera'], ['k' => 'bibliografia', 't' => 'Encontrar e detalhar a bibliografia', 's' => 'espera'], ['k' => 'aprofundar', 't' => 'Criar o material de aprofundamento', 's' => 'espera'], ['k' => 'biblioteca', 't' => 'Guardar na biblioteca', 's' => 'espera']], 'agentes' => [], 'avisos' => []];
    $set = function (string $k, string $s, string $d = '') use (&$st, $mid) { foreach ($st['steps'] as &$x) if ($x['k'] === $k) { $x['s'] = $s; if ($d !== '') $x['d'] = $d; } unset($x); q('UPDATE media SET progress=? WHERE id=?', [json_encode($st, JSON_UNESCAPED_UNICODE), $mid]); };
    $upd = fn(string $s, string $msg) => q('UPDATE media SET status=?,msg=? WHERE id=?', [$s, $msg, $mid]); $sys = 'Você é pesquisador(a) e professor(a). Responda em português do Brasil e somente com JSON válido, sem texto fora do JSON.';
    $ai = ia_info(['id' => $uid, 'role' => 'aluno'])['enabled']; $tr = (string)$m['transcript'];
    try {
        if ($tr === '') {
            $src = $dir . '/' . $m['stored']; if (!is_file($src)) throw new RuntimeException('O arquivo da aula não foi encontrado.');
            $set('preparar', 'andamento'); [$path, $mime2] = audio_prepare($src, $dir); $set('preparar', 'ok', $mime2 ? 'Áudio convertido (mono, 16 kHz)' : 'Arquivo usado como foi enviado');
            $set('transcrever', 'andamento'); $upd('processando', 'Transcrevendo a fala… aulas longas levam vários minutos.');
            try { $r = stt_transcribe($path, $mime2 ?: (string)$m['mime'], (string)($o['lang'] ?? 'pt-BR'), (string)$m['filename'], $dir); }
            catch (Throwable $e) { $set('transcrever', 'espera'); $upd('manual', 'Não foi possível transcrever automaticamente. ' . $e->getMessage() . ' Cole abaixo a transcrição (de legendas, de um app de transcrição ou de qualquer ferramenta) para continuar.'); return; }
            $tr = $r['text']; $st['agentes']['transcrever'] = $r['provider']; q('UPDATE media SET transcript=? WHERE id=?', [$tr, $mid]); $set('transcrever', 'ok');
        } else { $set('preparar', 'ok', 'Transcrição fornecida'); $set('transcrever', 'ok', 'Texto fornecido por você'); }
        $set('estruturar', 'andamento'); $upd('processando', 'Estruturando a aula…'); $L = null;
        if ($ai) try {
            $chunks = []; foreach (preg_split('/\R/', $tr) as $ln) { $i = count($chunks) - 1; if ($i < 0 || strlen($chunks[$i]) > 80000) { $chunks[] = $ln . "\n"; } else $chunks[$i] .= $ln . "\n"; }
            $ps = []; foreach ($chunks as $i => $c) { $r = ai_complete(['system' => $sys, 'user' => lesson_prompt($title, $c, $i + 1, count($chunks)), 'search' => false, 'max_tokens' => 8000], fn($t) => norm_lesson(extract_json($t) ?? throw new InvalidArgumentException('Resposta sem JSON válido.'), $title), 'redator'); $ps[] = $r['result']; $st['agentes']['estruturar'] = $r['provider']; }
            $L = lesson_merge($ps); $set('estruturar', 'ok');
        } catch (Throwable $e) { $st['avisos'][] = 'Estruturação por IA indisponível: ' . $e->getMessage(); }
        if (!$L) { $L = lesson_fallback($title, $tr); $set('estruturar', 'parcial', 'Estrutura simples (sem IA)'); }
        if (($o['title_auto'] ?? false) && $L['title'] !== '') { $title = $L['title']; q('UPDATE media SET title=? WHERE id=?', [$title, $mid]); }
        $set('bibliografia', 'andamento'); $upd('processando', 'Encontrando e detalhando a bibliografia…'); $bib = []; $sota = '';
        if ($ai && ($o['biblio'] ?? true)) try {
            $r = ai_complete(['system' => $sys, 'user' => fn(bool $s) => biblio_prompt($L, $s), 'search' => true, 'max_tokens' => 8000], fn($t) => norm_bib_response(extract_json($t) ?? throw new InvalidArgumentException('Resposta sem JSON válido.')), 'planejador');
            $bib = $r['result']['biblio']; $sota = $r['result']['sota']; $st['agentes']['bibliografia'] = $r['provider'] . ($r['search'] ? ' (com busca na web)' : ' (sem busca: confira as fontes)'); $set('bibliografia', 'ok');
        } catch (Throwable $e) { $st['avisos'][] = 'Bibliografia por IA indisponível: ' . $e->getMessage(); }
        if (!$bib) { $bib = array_map(fn($r) => ['tipo' => $r['kind'], 'titulo' => $r['name'], 'autores' => '', 'ano' => '', 'url' => '', 'por_que' => $r['context'], 'verificada' => false, 'citada_na_aula' => true, 'trecho' => $r['t']], $L['references_mentioned']); $set('bibliografia', 'parcial', $ai ? 'Só as fontes citadas, sem detalhes' : 'Sem IA: só as fontes citadas'); }
        $set('aprofundar', 'andamento'); $upd('processando', 'Criando o material de aprofundamento…'); $D = null;
        if ($ai && ($o['deep'] ?? true)) try {
            $r = ai_complete(['system' => $sys, 'user' => lesson_deep_prompt($L, $bib, $sota), 'search' => false, 'max_tokens' => 8000], fn($t) => norm_deep(extract_json($t) ?? throw new InvalidArgumentException('Resposta sem JSON válido.'), $title), 'redator');
            $D = $r['result']; $st['agentes']['aprofundar'] = $r['provider']; $set('aprofundar', 'ok');
        } catch (Throwable $e) { $st['avisos'][] = 'Aprofundamento por IA indisponível: ' . $e->getMessage(); }
        if (!$D) $set('aprofundar', 'parcial', 'Não gerado');
        $set('biblioteca', 'andamento'); $ids = []; $ins = function (string $ti, string $kind, string $tx, array $tags) use ($uid, &$ids) { q('INSERT INTO materials(title,author,kind,url,text,tags,pdf,user_id,created) VALUES(?,?,?,?,?,?,?,?,?)', [$ti, 'Aula importada', $kind, '', mb_substr($tx, 0, 120000), json_encode($tags, JSON_UNESCAPED_UNICODE), '', $uid, time()]); $ids[] = (int)db()->lastInsertId(); };
        $ins('🎙️ ' . $title . ': transcrição', 'aula', $tr, ['aula', 'transcrição']); $ins('📚 ' . $title . ': resumo, capítulos e bibliografia', 'aula', lesson_text($L, $bib, $sota), ['aula', 'bibliografia']); if ($D) $ins('🔎 ' . $title . ': aprofundamento', 'texto', deep_text($D), ['aula', 'aprofundamento']);
        $set('biblioteca', 'ok');
        q('UPDATE media SET status=?,msg=?,structure=?,biblio=?,deep=?,material_ids=?,progress=? WHERE id=?', ['pronto', 'Aula pronta: ' . count($ids) . ' materiais guardados na biblioteca.' . ($st['avisos'] ? ' Avisos: ' . implode(' ', $st['avisos']) : ''), json_encode($L, JSON_UNESCAPED_UNICODE), json_encode(['biblio' => $bib, 'sota' => $sota], JSON_UNESCAPED_UNICODE), $D ? json_encode($D, JSON_UNESCAPED_UNICODE) : null, json_encode($ids), json_encode($st, JSON_UNESCAPED_UNICODE), $mid]);
        foreach (glob($dir . '/*') ?: [] as $f) @unlink($f); @rmdir($dir);        // o áudio/vídeo original não fica guardado: só o texto
    } catch (Throwable $e) { $upd('erro', $e->getMessage()); }
}
