<?php
declare(strict_types=1);
/* Trilhas por usuário: plano (prazo, carga semanal, estado), dados do painel, exportação e importação. */
function setting(string $k, ?string $def = null): ?string { $v = q('SELECT v FROM settings WHERE k=?', [$k])->fetchColumn(); return $v === false ? $def : (string)$v; }
function set_setting(string $k, string $v): void { q('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', [$k, $v]); }
function jd($s): array { $x = json_decode((string)$s, true); return is_array($x) ? $x : []; }
function plan_get(int $uid, int $pid): array {
    $f = fn() => q('SELECT * FROM plans WHERE user_id=? AND package_id=?', [$uid, $pid])->fetch();
    $p = $f(); if (!$p) { q('INSERT OR IGNORE INTO plans(user_id,package_id,hpw,start_ts) VALUES(?,?,5,?)', [$uid, $pid, time()]); $p = $f(); }
    return $p;
}
function can_view(int $uid, int $pid): bool {
    return (bool)q("SELECT 1 FROM packages p WHERE p.id=? AND (p.owner_id IS NULL OR p.owner_id=?
        OR (p.visibility='publica' AND NOT EXISTS(SELECT 1 FROM plans o WHERE o.package_id=p.id AND o.user_id=p.owner_id AND o.status='excluida'))
        OR (p.visibility='grupos' AND EXISTS(SELECT 1 FROM route_shares s JOIN group_members m ON m.group_id=s.group_id WHERE s.package_id=p.id AND m.user_id=?)))", [$pid, $uid, $uid])->fetch();
}
function visible_pkg(int $uid, int $pid): bool {
    return can_view($uid, $pid) && (bool)q("SELECT 1 FROM packages p LEFT JOIN plans pl ON pl.package_id=p.id AND pl.user_id=? WHERE p.id=? AND IFNULL(pl.status,'ativa')!='excluida'", [$uid, $pid])->fetch();
}
function route_array(int $pid): array {
    $pk = q('SELECT * FROM packages WHERE id=?', [$pid])->fetch(); $topics = [];
    foreach (q('SELECT * FROM topics WHERE package_id=? ORDER BY pos', [$pid])->fetchAll() as $t) {
        $cards = q('SELECT q,a FROM cards WHERE topic_id=? ORDER BY id', [$t['id']])->fetchAll();
        $vis = q('SELECT emoji,title,points,pitfall,example FROM visuals WHERE topic_id=? ORDER BY pos,id', [$t['id']])->fetchAll();
        foreach ($vis as &$v) $v['points'] = jd($v['points']);
        unset($v);
        $topics[] = ['title' => $t['title'], 'emoji' => $t['emoji'], 'law' => $t['law'], 'difficulty' => (int)$t['difficulty'], 'summary' => array_values(array_filter(explode("\n", (string)$t['summary']))), 'mnemonic' => $t['mnemonic'], 'refs' => jd($t['refs']), 'cards' => array_map(fn($c) => [$c['q'], $c['a']], $cards), 'visuals' => $vis];
    }
    return ['name' => $pk['name'], 'emoji' => $pk['emoji'], 'goal' => $pk['goal'], 'objective' => $pk['objective'], 'kind' => $pk['kind'], 'tags' => jd($pk['tags']), 'strategy' => jd($pk['strategy']), 'biblio' => jd($pk['biblio']), 'sources' => jd($pk['sources']), 'topics' => $topics];
}
/** Copia uma trilha pública/compartilhada para a conta do usuário (sem o progresso de ninguém). */
function clone_route(int $uid, int $pid): int {
    $r = route_array($pid); $r['slug'] = ''; $r['origin_id'] = $pid;
    $src = q('SELECT p.name, u.name author FROM packages p LEFT JOIN users u ON u.id=p.owner_id WHERE p.id=?', [$pid])->fetch();
    $r['sources'] = array_merge((array)$r['sources'], ['copiada_de' => ['id' => $pid, 'trilha' => $src['name'], 'autor' => $src['author'] ?: 'Sistema']]);
    $new = install_package($r, $uid, 'importada');
    q('INSERT OR IGNORE INTO plans(user_id,package_id,hpw,start_ts) VALUES(?,?,5,?)', [$uid, $new, time()]);
    return $new;
}
function topic_pkg(int $tid): int { return (int)q('SELECT package_id FROM topics WHERE id=?', [$tid])->fetchColumn(); }
/** Reativa: o tempo parado é somado ao início e ao prazo, então o relógio continua de onde parou. */
function resume_plan(array $pl): void {
    $d = max(0, time() - (int)$pl['paused_at']);
    q("UPDATE plans SET status='ativa', paused_at=NULL, paused_total=paused_total+?, start_ts=start_ts+?, deadline=CASE WHEN deadline IS NULL THEN NULL ELSE deadline+? END WHERE id=?", [$d, $d, $d, $pl['id']]);
}
function route_data(int $uid, int $pid): array {
    $pk = q('SELECT id,name,emoji,goal,kind,owner_id,objective,strategy,biblio,sources,visibility,tags FROM packages WHERE id=?', [$pid])->fetch();
    $pl = plan_get($uid, $pid);
    $topics = q('SELECT t.id,t.title,t.emoji,t.difficulty,t.refs,(LENGTH(t.summary)-LENGTH(REPLACE(t.summary,char(10),\'\'))+1) chunks,
        (SELECT COUNT(*) FROM cards c WHERE c.topic_id=t.id) n,
        (SELECT COUNT(*) FROM progress p JOIN cards c ON c.id=p.card_id WHERE c.topic_id=t.id AND p.user_id=? AND p.reps>=2) k,
        (SELECT COUNT(*) FROM visuals v WHERE v.topic_id=t.id) nv,
        (SELECT COUNT(*) FROM logs l JOIN cards c ON c.id=l.card_id WHERE c.topic_id=t.id AND l.user_id=?) tries,
        (SELECT COUNT(*) FROM logs l JOIN cards c ON c.id=l.card_id WHERE c.topic_id=t.id AND l.user_id=? AND l.grade>=2) ok
        FROM topics t WHERE t.package_id=? ORDER BY t.pos', [$uid, $uid, $uid, $pid])->fetchAll();
    foreach ($topics as &$t) $t['refs'] = jd($t['refs']);
    unset($t);
    $ts = q('SELECT l.ts FROM logs l JOIN cards c ON c.id=l.card_id JOIN topics t ON t.id=c.topic_id WHERE l.user_id=? AND t.package_id=? ORDER BY l.ts', [$uid, $pid])->fetchAll(PDO::FETCH_COLUMN);
    $tot = 0; $by = []; $prev = null;   // minutos estudados: soma dos intervalos entre respostas (até 5 min); resposta isolada vale 1 min
    foreach ($ts as $t) { $t = (int)$t; $gap = ($prev === null || $t - $prev > 300) ? 60 : max(0, $t - $prev); $tot += $gap; $dy = gmdate('Y-m-d', $t); $by[$dy] = ($by[$dy] ?? 0) + $gap; $prev = $t; }
    $week = []; for ($i = 6; $i >= 0; $i--) { $dy = gmdate('Y-m-d', time() - $i * 86400); $week[] = ['d' => $dy, 'min' => round(($by[$dy] ?? 0) / 60, 1)]; }
    $pk['strategy'] = jd($pk['strategy']); $pk['biblio'] = jd($pk['biblio']); $pk['sources'] = jd($pk['sources']); $pk['tags'] = jd($pk['tags']);
    return ['route' => $pk, 'mine' => (int)$pk['owner_id'] === $uid, 'plan' => $pl, 'now' => time(), 'topics' => $topics, 'studied_min' => round($tot / 60, 1), 'week' => $week, 'shares' => array_map('intval', q('SELECT group_id FROM route_shares WHERE package_id=?', [$pid])->fetchAll(PDO::FETCH_COLUMN))];
}
function export_route(int $uid, int $pid): array {
    $pk = q('SELECT * FROM packages WHERE id=?', [$pid])->fetch(); $pl = plan_get($uid, $pid);
    $topics = []; $prog = [];
    foreach (q('SELECT * FROM topics WHERE package_id=? ORDER BY pos', [$pid])->fetchAll() as $t) {
        $cards = q('SELECT id,q,a FROM cards WHERE topic_id=? ORDER BY id', [$t['id']])->fetchAll(); $pr = [];
        foreach ($cards as $c) { $x = q('SELECT ease,ivl,reps,lapses,due FROM progress WHERE user_id=? AND card_id=?', [$uid, $c['id']])->fetch(); $pr[] = $x ? [(float)$x['ease'], (int)$x['ivl'], (int)$x['reps'], (int)$x['lapses'], (int)$x['due']] : null; }
        $vis = q('SELECT emoji,title,points,pitfall,example FROM visuals WHERE topic_id=? ORDER BY pos,id', [$t['id']])->fetchAll();
        foreach ($vis as &$v) $v['points'] = jd($v['points']);
        unset($v);
        $topics[] = ['title' => $t['title'], 'emoji' => $t['emoji'], 'law' => $t['law'], 'difficulty' => (int)$t['difficulty'], 'summary' => array_values(array_filter(explode("\n", (string)$t['summary']))), 'mnemonic' => $t['mnemonic'], 'refs' => jd($t['refs']), 'cards' => array_map(fn($c) => [$c['q'], $c['a']], $cards), 'visuals' => $vis];
        $prog[] = $pr;
    }
    $route = ['name' => $pk['name'], 'emoji' => $pk['emoji'], 'goal' => $pk['goal'], 'objective' => $pk['objective'], 'kind' => $pk['kind'], 'strategy' => jd($pk['strategy']), 'biblio' => jd($pk['biblio']), 'sources' => jd($pk['sources']), 'topics' => $topics];
    $ref = (int)($pl['paused_at'] ?: time());
    return ['format' => 'estudo-claro-trilha', 'version' => 1, 'exported_at' => date('c'), 'route' => $route,
        'plan' => ['deadline' => $pl['deadline'] ? gmdate('Y-m-d', (int)$pl['deadline']) : null, 'hpw' => (float)$pl['hpw'], 'elapsed_s' => max(0, $ref - (int)$pl['start_ts']), 'remaining_s' => $pl['deadline'] ? max(0, (int)$pl['deadline'] - $ref) : null, 'status' => $pl['status']],
        'progress' => $prog, 'integrity' => hash('sha256', json_encode($route, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES))];
}
function import_route(int $uid, array $x): array {
    $warn = null;
    if (($x['format'] ?? '') === 'estudo-claro-trilha') {
        $r = $x['route'] ?? null; if (!is_array($r)) throw new RuntimeException('Arquivo de trilha sem o campo "route".');
        if (!empty($x['integrity']) && !hash_equals((string)$x['integrity'], hash('sha256', json_encode($r, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)))) $warn = 'O conteúdo parece ter sido editado depois da exportação. A trilha foi importada mesmo assim.';
    } else $r = $x;                                   // aceita também o formato simples de pacote
    $r['slug'] = '';
    $pid = install_package($r, $uid, 'importada');
    $tids = q('SELECT id FROM topics WHERE package_id=? ORDER BY pos', [$pid])->fetchAll(PDO::FETCH_COLUMN);
    foreach ((array)($x['progress'] ?? []) as $ti => $row) {
        if (!isset($tids[$ti])) continue;
        $cids = q('SELECT id FROM cards WHERE topic_id=? ORDER BY id', [$tids[$ti]])->fetchAll(PDO::FETCH_COLUMN);
        foreach ((array)$row as $ci => $p) if (is_array($p) && count($p) >= 5 && isset($cids[$ci])) q('INSERT OR IGNORE INTO progress(user_id,card_id,ease,ivl,reps,lapses,due) VALUES(?,?,?,?,?,?,?)', [$uid, $cids[$ci], (float)$p[0], (int)$p[1], (int)$p[2], (int)$p[3], (int)$p[4]]);
    }
    $pl = (array)($x['plan'] ?? []); $now = time();
    $dl = isset($pl['remaining_s']) ? $now + (int)$pl['remaining_s'] : (!empty($pl['deadline']) ? (strtotime($pl['deadline'] . ' 23:59:59 UTC') ?: null) : null);
    q('INSERT OR IGNORE INTO plans(user_id,package_id,deadline,hpw,start_ts) VALUES(?,?,?,?,?)', [$uid, $pid, $dl, max(0.5, min(80, (float)($pl['hpw'] ?? 5))), $now - max(0, (int)($pl['elapsed_s'] ?? 0))]);
    return ['id' => $pid, 'warning' => $warn];
}
