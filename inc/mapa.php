<?php
declare(strict_types=1);
/* Mapa de conhecimento (grafo), aprofundamento por tópico e jogo bônus: configurações do administrador e regras no servidor. */
function clean_game(array $g): array {
    $games = array_values(array_intersect(['snake', 'car', 'tetris'], (array)($g['games'] ?? [])));
    return ['on' => !empty($g['on']), 'streak' => max(1, min(10, (int)($g['streak'] ?? 3))), 'seconds' => max(15, min(180, (int)($g['seconds'] ?? 60))), 'games' => $games ?: ['snake'], 'random' => !empty($g['random']), 'speed' => max(1, min(3, (int)($g['speed'] ?? 2))),
        'palette' => in_array($g['palette'] ?? '', ['arcade', 'gameboy', 'neon', 'doce'], true) ? $g['palette'] : 'arcade', 'max_xp' => max(0, min(100, (int)($g['max_xp'] ?? 30))), 'daily' => max(1, min(30, (int)($g['daily'] ?? 5)))];
}
function game_cfg(): array { $d = ['on' => true, 'streak' => 3, 'seconds' => 60, 'games' => ['snake', 'car', 'tetris'], 'random' => true, 'speed' => 2, 'palette' => 'arcade', 'max_xp' => 30, 'daily' => 5]; return clean_game(array_merge($d, jd(setting('game_cfg', '')))); }
function clean_graph(array $g): array { return ['on' => !empty($g['on']), 'level' => max(1, min(4, (int)($g['level'] ?? 2))), 'mode' => ($g['mode'] ?? '3d') === 'fluxo' ? 'fluxo' : '3d', 'auto' => !empty($g['auto']), 'max_nodes' => max(30, min(400, (int)($g['max_nodes'] ?? 160)))]; }
function graph_cfg(): array { return clean_graph(array_merge(['on' => true, 'level' => 2, 'mode' => '3d', 'auto' => true, 'max_nodes' => 160], jd(setting('graph_cfg', '')))); }

function graph_data(int $uid, int $pid): array {
    $pk = q('SELECT id,name,emoji,goal,objective,kind,tags,origin_id,biblio FROM packages WHERE id=?', [$pid])->fetch(); $now = time();
    $topics = q('SELECT t.id,t.title,t.emoji,t.difficulty,t.refs,
        (SELECT COUNT(*) FROM cards c WHERE c.topic_id=t.id) n,
        (SELECT COUNT(*) FROM progress p JOIN cards c ON c.id=p.card_id WHERE c.topic_id=t.id AND p.user_id=? AND p.reps>=2) k,
        (SELECT COUNT(*) FROM cards c LEFT JOIN progress p ON p.card_id=c.id AND p.user_id=? WHERE c.topic_id=t.id AND (p.id IS NULL OR p.due<=?)) due,
        (SELECT COUNT(*) FROM logs l JOIN cards c ON c.id=l.card_id WHERE c.topic_id=t.id AND l.user_id=?) tries,
        (SELECT COUNT(*) FROM logs l JOIN cards c ON c.id=l.card_id WHERE c.topic_id=t.id AND l.user_id=? AND l.grade>=2) ok
        FROM topics t WHERE t.package_id=? ORDER BY t.pos', [$uid, $uid, $now, $uid, $uid, $pid])->fetchAll();
    foreach ($topics as &$t) {
        $pc = $t['n'] ? $t['k'] / $t['n'] : 0; $t['stars'] = $pc >= 1 ? 3 : ($pc >= 0.66 ? 2 : ($pc >= 0.33 ? 1 : 0)); $t['refs'] = jd($t['refs']);
        $t['acc'] = $t['tries'] ? (int)round(100 * $t['ok'] / $t['tries']) : null; $t['weak'] = $t['tries'] >= 3 && $t['acc'] < 75; $t['review'] = $t['weak'] || ($t['tries'] > 0 && (int)$t['due'] > 0);
    }
    unset($t);
    $cards = q('SELECT c.id,c.topic_id,c.q,c.a,(p.id IS NULL OR p.due<=?) due FROM cards c JOIN topics t ON t.id=c.topic_id LEFT JOIN progress p ON p.card_id=c.id AND p.user_id=? WHERE t.package_id=? ORDER BY c.id LIMIT 600', [$now, $uid, $pid])->fetchAll();
    foreach ($cards as &$c) $c['due'] = (bool)$c['due'];
    unset($c);
    $deep = q('SELECT id,topic_id,card_id,kind,title,q,a,summary FROM deepdives WHERE user_id=? AND package_id=? ORDER BY id', [$uid, $pid])->fetchAll();
    $tags = array_map('mb_strtolower', jd($pk['tags'])); $my = jd($pk['biblio']); $myT = array_map(fn($b) => mb_strtolower(trim((string)($b['titulo'] ?? ''))), $my); $rel = [];
    foreach (q('SELECT id,name,emoji,kind,tags,origin_id,biblio FROM packages WHERE id!=? ORDER BY id DESC LIMIT 120', [$pid])->fetchAll() as $o) {
        if (!can_view($uid, (int)$o['id'])) continue;
        $common = array_values(array_intersect($tags, array_map('mb_strtolower', jd($o['tags']))));
        $shared = array_values(array_filter(array_intersect($myT, array_map(fn($b) => mb_strtolower(trim((string)($b['titulo'] ?? ''))), jd($o['biblio'])))));
        $linked = (int)$o['origin_id'] === $pid || (int)$pk['origin_id'] === (int)$o['id'] || ($pk['origin_id'] && (int)$pk['origin_id'] === (int)$o['origin_id']); $score = count($common) * 2 + count($shared) * 3 + ($linked ? 5 : 0);
        if ($score > 0) $rel[] = ['id' => (int)$o['id'], 'name' => $o['name'], 'emoji' => $o['emoji'], 'kind' => $o['kind'], 'common' => $common, 'shared' => $shared, 'linked' => $linked, 'score' => $score];
    }
    usort($rel, fn($a, $b) => $b['score'] <=> $a['score']);
    return ['route' => ['id' => (int)$pk['id'], 'name' => $pk['name'], 'emoji' => $pk['emoji'], 'goal' => $pk['goal'], 'objective' => $pk['objective']], 'topics' => $topics, 'cards' => $cards, 'biblio' => $my, 'deep' => $deep, 'related' => array_slice($rel, 0, 8)];
}
function deep_prompt(array $pk, array $t, ?array $card, string $kind, string $focus, bool $search): string {
    $bib = implode("\n", array_slice(array_map(fn($b) => '- ' . trim(($b['titulo'] ?? '') . ' (' . trim(($b['autores'] ?? '') . ' ' . ($b['ano'] ?? '')) . ')') . (($b['por_que'] ?? '') ? ': ' . $b['por_que'] : ''), jd($pk['biblio'])), 0, 10));
    $p = 'Data de hoje: ' . date('d/m/Y') . ".\nTRILHA: {$pk['name']}\nOBJETIVO DA TRILHA: " . ($pk['objective'] ?: $pk['goal']) . "\nBIBLIOGRAFIA PRINCIPAL:\n" . ($bib ?: '(nenhuma cadastrada: use obras consagradas e marque o que precisa ser conferido)') . "\n\nTÓPICO: {$t['title']}\nRESUMO ATUAL DO TÓPICO:\n" . implode(' ', array_filter(explode("\n", (string)$t['summary']))) . "\n";
    if ($card) $p .= "CARTÃO EM ESTUDO: pergunta «{$card['q']}» / resposta «{$card['a']}»\n"; if ($focus !== '') $p .= "FOCO PEDIDO PELO ESTUDANTE: $focus\n";
    $rule = $search ? 'Se precisar confirmar algo, pesquise fontes atuais.' : 'Use seu conhecimento e sinalize o que precisa ser conferido.';
    if ($kind === 'card') return $p . "\nTAREFA: crie de 1 a 3 CARTÕES de aprofundamento (pergunta e resposta curta) relacionados a este tópico, alinhados ao objetivo da trilha e fundamentados na bibliografia principal. $rule Não invente fatos.\nResponda SOMENTE com JSON: {\"cards\":[[\"pergunta\",\"resposta curta\"]],\"refs\":[\"títulos da bibliografia usados\"]}";
    return $p . "\nTAREFA: escreva um TEMA DE APROFUNDAMENTO sobre este tópico: um título, um resumo de 5 a 8 frases fundamentado na bibliografia principal e alinhado ao objetivo da trilha, 3 a 5 pontos-chave e as fontes usadas (títulos da bibliografia). Textos claros e curtos, em português do Brasil. $rule Não invente fatos nem citações.\nResponda SOMENTE com JSON: {\"title\":\"\",\"summary\":\"\",\"points\":[\"\"],\"refs\":[\"\"]}";
}
function norm_deepdive(array $j, string $kind, string $title): array {
    $refs = as_list(first($j, ['refs', 'referencias', 'referências', 'fontes', 'sources'], []));
    if ($kind === 'card') {
        $cards = []; foreach ((array)first($j, ['cards', 'cartoes', 'cartões', 'flashcards'], []) as $c) if (($n = norm_card($c)) && $n[0] !== '' && $n[1] !== '') $cards[] = $n;
        if (!$cards) throw new InvalidArgumentException('A resposta não trouxe cartões.'); return ['cards' => array_slice($cards, 0, 3), 'refs' => $refs];
    }
    $sum = (string)first($j, ['summary', 'resumo', 'texto', 'text'], ''); if (mb_strlen($sum) < 40) throw new InvalidArgumentException('Resumo curto demais.');
    return ['title' => (string)first($j, ['title', 'titulo', 'título'], 'Aprofundamento: ' . $title), 'summary' => $sum, 'points' => as_list(first($j, ['points', 'pontos', 'pontos_chave', 'key_points'], [])), 'refs' => $refs];
}
/** Guarda o aprofundamento (biblioteca de aprofundamento da trilha, mapa e, para temas, a biblioteca de materiais). */
function deep_save(int $uid, array $pk, array $t, ?array $card, string $kind, array $x): array {
    $ids = []; $now = time(); $ins = 'INSERT INTO deepdives(user_id,package_id,topic_id,card_id,kind,title,q,a,summary,points,refs,material_id,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'; $refs = json_encode($x['refs'], JSON_UNESCAPED_UNICODE);
    if ($kind === 'card') { foreach ($x['cards'] as $c) { q($ins, [$uid, $pk['id'], $t['id'], $card['id'] ?? null, 'card', mb_substr($c[0], 0, 160), $c[0], $c[1], '', '[]', $refs, null, $now]); $ids[] = (int)db()->lastInsertId(); } }
    else {
        $txt = $x['summary'] . "\n\nPONTOS-CHAVE\n" . implode("\n", array_map(fn($p) => '- ' . $p, $x['points'])) . "\n\nFONTES\n" . implode("\n", array_map(fn($p) => '- ' . $p, $x['refs']));
        q('INSERT INTO materials(title,author,kind,url,text,tags,pdf,user_id,created) VALUES(?,?,?,?,?,?,?,?,?)', ['🔎 ' . $t['title'] . ': ' . $x['title'], 'Aprofundamento', 'texto', '', mb_substr($txt, 0, 120000), json_encode(['aprofundamento', $pk['name']], JSON_UNESCAPED_UNICODE), '', $uid, $now]); $mid = (int)db()->lastInsertId();
        q($ins, [$uid, $pk['id'], $t['id'], $card['id'] ?? null, 'tema', $x['title'], '', '', $x['summary'], json_encode($x['points'], JSON_UNESCAPED_UNICODE), $refs, $mid, $now]); $ids[] = (int)db()->lastInsertId();
    }
    $out = []; foreach ($ids as $id) { $r = q('SELECT id,topic_id,card_id,kind,title,q,a,summary,points,refs FROM deepdives WHERE id=?', [$id])->fetch(); $r['points'] = jd($r['points']); $r['refs'] = jd($r['refs']); $out[] = $r; }
    return $out;
}
