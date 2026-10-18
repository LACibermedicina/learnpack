<?php
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';
require __DIR__ . '/inc/trilhas.php';
require __DIR__ . '/inc/ia.php';
require __DIR__ . '/inc/aulas.php';
require __DIR__ . '/inc/mapa.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if (!installed()) out(['installing' => true, 'error' => 'Sistema ainda não instalado.'], 503);
boot_session();
ensure_schema();

$r = (string)($_GET['r'] ?? 'boot');
$post = $_SERVER['REQUEST_METHOD'] === 'POST';
$in = ($post && $r !== 'media_chunk') ? (json_decode((string)file_get_contents('php://input'), true) ?: []) : [];
if ($post && !hash_equals(csrf(), (string)($_SERVER['HTTP_X_CSRF'] ?? ''))) out(['error' => 'Sessão expirada. Recarregue a página.'], 419);

function user(): array { $u = me(); if (!$u) out(['error' => 'Entre para continuar.'], 401); return $u; }
function admin(): array { $u = user(); if ($u['role'] !== 'admin') out(['error' => 'Acesso restrito.'], 403); return $u; }
function str(array $a, string $k, int $max = 2000): string { return substr(trim((string)($a[$k] ?? '')), 0, $max); }
function login_as(int $id): void { session_regenerate_id(true); $_SESSION['uid'] = $id; }
function ip(): string { return substr($_SERVER['REMOTE_ADDR'] ?? '0', 0, 45); }
function pubuser(?array $u): ?array { return $u ? ['id' => (int)$u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role'], 'prefs' => $u['prefs'], 'xp' => (int)$u['xp']] : null; }
function curpkg(array $u): int {
    $uid = (int)$u['id']; $p = (int)q('SELECT pkg FROM users WHERE id=?', [$uid])->fetchColumn();
    if ($p && visible_pkg($uid, $p)) return $p;
    return (int)q("SELECT p.id FROM packages p LEFT JOIN plans pl ON pl.package_id=p.id AND pl.user_id=? WHERE (p.owner_id IS NULL OR p.owner_id=?) AND IFNULL(pl.status,'ativa')!='excluida' ORDER BY p.id LIMIT 1", [$uid, $uid])->fetchColumn();
}

function bg_start(array $payload, callable $fn): never {       // responde já e continua em segundo plano
    ignore_user_abort(true); set_time_limit(0); session_write_close();
    $body = json_encode($payload); while (ob_get_level()) ob_end_clean();
    header('Content-Length: ' . strlen($body)); header('Connection: close'); echo $body;
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request(); else flush();
    $fn(); exit;
}
switch ($r) {
    case 'boot':
        out(['user' => pubuser(me()), 'csrf' => csrf(), 'name' => cfg('name') ?: 'Estudo Claro', 'editions' => setting('editions', 'ambas'), 'game' => game_cfg(), 'graph' => graph_cfg()]);

    case 'login':
        $k = ip(); $now = time();
        q('DELETE FROM attempts WHERE ts<?', [$now - 3600]);
        if ((int)q('SELECT COUNT(*) FROM attempts WHERE k=? AND ts>?', [$k, $now - 600])->fetchColumn() >= 8) out(['error' => 'Muitas tentativas. Aguarde 10 minutos.'], 429);
        $u = q('SELECT * FROM users WHERE email=?', [strtolower(str($in, 'email', 200))])->fetch();
        if (!$u || $u['status'] !== 'ativo' || !password_verify((string)($in['pass'] ?? ''), $u['pass'])) {
            q('INSERT INTO attempts(k,ts) VALUES(?,?)', [$k, $now]); usleep(300000);
            out(['error' => 'E-mail ou senha incorretos, ou conta bloqueada.'], 401);
        }
        q('DELETE FROM attempts WHERE k=?', [$k]); login_as((int)$u['id']);
        out(['ok' => 1]);

    case 'register':
        $tk = strtoupper(str($in, 'token', 40)); $em = strtolower(str($in, 'email', 200)); $nm = str($in, 'name', 120); $pw = (string)($in['pass'] ?? '');
        $t = q('SELECT * FROM tokens WHERE token=? AND used_by IS NULL AND (expires IS NULL OR expires>?)', [$tk, time()])->fetch();
        if (!$t) out(['error' => 'Token inválido, já usado ou vencido.'], 400);
        if (!filter_var($em, FILTER_VALIDATE_EMAIL) || $nm === '' || strlen($pw) < 8) out(['error' => 'Preencha nome, e-mail válido e senha com 8 ou mais caracteres.'], 400);
        if (q('SELECT 1 FROM users WHERE email=?', [$em])->fetch()) out(['error' => 'Este e-mail já está cadastrado.'], 409);
        db()->beginTransaction();
        q('INSERT INTO users(name,email,pass,role,prefs,created) VALUES(?,?,?,?,?,?)', [$nm, $em, password_hash($pw, PASSWORD_DEFAULT), $t['role'], '{}', time()]);
        $id = (int)db()->lastInsertId(); q('UPDATE tokens SET used_by=? WHERE id=?', [$id, $t['id']]);
        db()->commit(); login_as($id); out(['ok' => 1]);

    case 'request':
        $em = strtolower(str($in, 'email', 200)); $nm = str($in, 'name', 120);
        if (!filter_var($em, FILTER_VALIDATE_EMAIL) || $nm === '') out(['error' => 'Informe nome e e-mail válidos.'], 400);
        if ((int)q("SELECT COUNT(*) FROM requests WHERE email=? AND status='pendente'", [$em])->fetchColumn() >= 2) out(['error' => 'Já existe um pedido pendente para este e-mail.'], 409);
        q('INSERT INTO requests(name,email,msg,created) VALUES(?,?,?,?)', [$nm, $em, str($in, 'msg', 500), time()]);
        out(['ok' => 1]);

    case 'pwd_change':                                  // qualquer usuário logado muda a PRÓPRIA senha
        $u = user(); $k = 'pwd' . $u['id']; $now = time(); $cur = (string)($in['current'] ?? ''); $new = (string)($in['new'] ?? '');
        q('DELETE FROM attempts WHERE ts<?', [$now - 3600]);
        if ((int)q('SELECT COUNT(*) FROM attempts WHERE k=? AND ts>?', [$k, $now - 600])->fetchColumn() >= 6) out(['error' => 'Muitas tentativas. Aguarde 10 minutos.'], 429);
        $row = q('SELECT pass FROM users WHERE id=?', [$u['id']])->fetch();
        if (!$row || !password_verify($cur, $row['pass'])) { q('INSERT INTO attempts(k,ts) VALUES(?,?)', [$k, $now]); usleep(400000); out(['error' => 'A senha atual está incorreta.'], 403); }
        if (strlen($new) < 8) out(['error' => 'A nova senha precisa ter 8 ou mais caracteres.'], 400);
        if ($new === $cur) out(['error' => 'Escolha uma senha diferente da atual.'], 400);
        q('UPDATE users SET pass=? WHERE id=?', [password_hash($new, PASSWORD_DEFAULT), $u['id']]); q('DELETE FROM attempts WHERE k=?', [$k]); session_regenerate_id(true);
        out(['ok' => 1]);
    case 'logout': $_SESSION = []; session_destroy(); out(['ok' => 1]);

    case 'prefs':
        $u = user(); $p = clean_prefs($in);
        q('UPDATE users SET prefs=? WHERE id=?', [json_encode($p), $u['id']]); out(['prefs' => $p]);

    case 'stats':
        $u = user(); $now = time(); $id = (int)$u['id']; $pk = curpkg($u);
        $pkg = q('SELECT id,name,goal,emoji FROM packages WHERE id=?', [$pk])->fetch() ?: null;
        $tot = (int)q('SELECT COUNT(*) FROM cards c JOIN topics t ON t.id=c.topic_id WHERE t.package_id=?', [$pk])->fetchColumn();
        $due = (int)q('SELECT COUNT(*) FROM cards c JOIN topics t ON t.id=c.topic_id LEFT JOIN progress p ON p.card_id=c.id AND p.user_id=? WHERE t.package_id=? AND (p.id IS NULL OR p.due<=?)', [$id, $pk, $now])->fetchColumn();
        $known = (int)q('SELECT COUNT(*) FROM progress p JOIN cards c ON c.id=p.card_id JOIN topics t ON t.id=c.topic_id WHERE p.user_id=? AND t.package_id=? AND p.reps>=2', [$id, $pk])->fetchColumn();
        $w = q('SELECT COUNT(*) n, IFNULL(SUM(grade>=2),0) ok FROM logs WHERE user_id=? AND ts>?', [$id, $now - 7 * 86400])->fetch();
        $rev = (int)q('SELECT COUNT(*) FROM logs WHERE user_id=?', [$id])->fetchColumn();
        $xp = (int)q('SELECT xp FROM users WHERE id=?', [$id])->fetchColumn();
        $days = q("SELECT DISTINCT date(ts,'unixepoch') d FROM logs WHERE user_id=? ORDER BY d DESC LIMIT 400", [$id])->fetchAll(PDO::FETCH_COLUMN);
        $streak = 0; $cur = new DateTimeImmutable('today', new DateTimeZone('UTC'));
        if ($days && $days[0] !== $cur->format('Y-m-d')) $cur = $cur->modify('-1 day');
        foreach ($days as $d) { if ($d === $cur->format('Y-m-d')) { $streak++; $cur = $cur->modify('-1 day'); } else break; }
        $topics = q('SELECT t.id,t.title,t.emoji,COUNT(c.id) n, IFNULL(SUM(CASE WHEN p.reps>=2 THEN 1 ELSE 0 END),0) k, (SELECT COUNT(*) FROM visuals v WHERE v.topic_id=t.id) nv FROM topics t LEFT JOIN cards c ON c.topic_id=t.id LEFT JOIN progress p ON p.card_id=c.id AND p.user_id=? WHERE t.package_id=? GROUP BY t.id ORDER BY t.pos', [$id, $pk])->fetchAll();
        $tr = [];
        foreach (q('SELECT c.topic_id tid, COUNT(*) n, SUM(l.grade>=2) ok FROM logs l JOIN cards c ON c.id=l.card_id WHERE l.user_id=? GROUP BY c.topic_id', [$id])->fetchAll() as $x) $tr[$x['tid']] = $x;
        $weak = [];
        foreach ($topics as &$t) {
            $pc = $t['n'] ? $t['k'] / $t['n'] : 0; $t['stars'] = $pc >= 1 ? 3 : ($pc >= 0.66 ? 2 : ($pc >= 0.33 ? 1 : 0));
            $x = $tr[$t['id']] ?? null; $t['tries'] = $x ? (int)$x['n'] : 0; $t['acc'] = $x ? (int)round(100 * $x['ok'] / $x['n']) : null;
            if ($t['tries'] >= 3 && $t['acc'] < 75) $weak[] = $t;
        }
        unset($t);
        usort($weak, fn($a, $b) => $a['acc'] <=> $b['acc']); $weak = array_map(fn($t) => (int)$t['id'], array_slice($weak, 0, 3));
        $st = array_column($topics, 'stars'); $lvl = (int)floor(sqrt($xp / 30)) + 1; $ach = [];
        foreach ([['primeiro', $rev >= 1], ['cartoes50', $rev >= 50], ['cartoes200', $rev >= 200], ['seq3', $streak >= 3], ['seq7', $streak >= 7], ['estrela', $st && max($st) >= 1], ['tres', $st && max($st) >= 3], ['mapa', $st && min($st) >= 1], ['nivel5', $lvl >= 5], ['aprovado', $st && min($st) >= 3]] as $c) if ($c[1]) $ach[] = $c[0];
        out(['pkg' => $pkg, 'plan' => plan_get($id, $pk), 'pkgs' => [], 'xp' => $xp, 'reviews' => $rev, 'ach' => $ach, 'weak' => $weak,
             'total' => $tot, 'due' => $due, 'known' => $known, 'acc' => $w['n'] ? (int)round(100 * $w['ok'] / $w['n']) : null, 'streak' => $streak, 'topics' => $topics]);

    case 'pkg_set':
        $u = user(); $pid = (int)($in['id'] ?? 0);
        if (!visible_pkg((int)$u['id'], $pid)) out(['error' => 'Trilha não encontrada.'], 404);
        q('UPDATE users SET pkg=? WHERE id=?', [$pid, $u['id']]); out(['ok' => 1]);

    case 'topics':
        $u = user(); out(q('SELECT t.id,t.title,t.law,t.emoji,COUNT(c.id) n,(SELECT COUNT(*) FROM visuals v WHERE v.topic_id=t.id) nv FROM topics t LEFT JOIN cards c ON c.topic_id=t.id WHERE t.package_id=? GROUP BY t.id ORDER BY t.pos', [curpkg($u)])->fetchAll());

    case 'topic':
        $u = user(); $t = q('SELECT * FROM topics WHERE id=?', [(int)($_GET['id'] ?? 0)])->fetch();
        if (!$t) out(['error' => 'Assunto não encontrado.'], 404);
        $t['chunks'] = array_values(array_filter(array_map('trim', explode("\n", (string)$t['summary']))));
        $t['nv'] = (int)q('SELECT COUNT(*) FROM visuals WHERE topic_id=?', [$t['id']])->fetchColumn();
        $t['can_edit'] = $u['role'] === 'admin' || (int)q('SELECT IFNULL(owner_id,0) FROM packages WHERE id=?', [$t['package_id']])->fetchColumn() === (int)$u['id'];
        unset($t['summary']); out($t);

    case 'visuals':
        user(); $rows = q('SELECT id,emoji,title,points,pitfall,example FROM visuals WHERE topic_id=? ORDER BY pos,id', [(int)($_GET['id'] ?? 0)])->fetchAll();
        foreach ($rows as &$x) $x['points'] = json_decode((string)$x['points'], true) ?: [];
        unset($x); out($rows);

    case 'queue':
        $u = user(); $mode = (string)($_GET['mode'] ?? 'due'); $tid = (int)($_GET['id'] ?? 0); $now = time(); $pk = curpkg($u);
        if (plan_get((int)$u['id'], $mode === 'topic' ? topic_pkg($tid) : $pk)['status'] !== 'ativa') out(['error' => 'Esta trilha está desativada: reative para estudar.'], 423);
        $b = 'SELECT c.id,c.q,c.a,c.topic_id,t.package_id,t.title FROM cards c JOIN topics t ON t.id=c.topic_id LEFT JOIN progress p ON p.card_id=c.id AND p.user_id=?';
        if ($mode === 'topic') $rows = q("$b WHERE c.topic_id=? ORDER BY RANDOM() LIMIT 8", [$u['id'], $tid])->fetchAll();
        elseif ($mode === 'exam') $rows = q("$b WHERE t.package_id=? ORDER BY RANDOM() LIMIT 10", [$u['id'], $pk])->fetchAll();
        elseif ($mode === 'mix') $rows = q("$b WHERE t.package_id=? AND (p.id IS NULL OR p.due<=?) ORDER BY RANDOM() LIMIT 8", [$u['id'], $pk, $now])->fetchAll();
        else $rows = q("$b WHERE t.package_id=? AND (p.id IS NULL OR p.due<=?) ORDER BY (p.id IS NULL), p.due, c.topic_id LIMIT 8", [$u['id'], $pk, $now])->fetchAll();
        out($rows);

    case 'grades':
        $u = user(); $n = 0;
        foreach (array_slice((array)($in['grades'] ?? []), 0, 200) as $g) {
            $cid = (int)($g['card'] ?? 0); $gr = max(0, min(3, (int)($g['grade'] ?? 0))); $ts = (int)($g['ts'] ?? time());
            if ($ts > time() + 300 || $ts < time() - 30 * 86400) $ts = time();
            $tp = (int)q('SELECT t.package_id FROM cards c JOIN topics t ON t.id=c.topic_id WHERE c.id=?', [$cid])->fetchColumn();
            if ($tp && plan_get((int)$u['id'], $tp)['status'] === 'ativa') { review((int)$u['id'], $cid, $gr, $ts); $n++; }
        }
        out(['saved' => $n]);

    /* ---------- administração ---------- */
    case 'a_users':
        admin(); out(q('SELECT id,name,email,role,status FROM users ORDER BY id')->fetchAll());
    case 'a_user':
        $me = admin(); $id = (int)($in['id'] ?? 0); $act = (string)($in['act'] ?? '');
        if ($id === (int)$me['id'] && $act !== 'pwd') out(['error' => 'Você não pode fazer isso com a própria conta.'], 400);
        if ($act === 'toggle') q("UPDATE users SET status=CASE status WHEN 'ativo' THEN 'bloqueado' ELSE 'ativo' END WHERE id=?", [$id]);
        elseif ($act === 'del') q('DELETE FROM users WHERE id=?', [$id]);
        elseif ($act === 'pwd') { $pw = (string)($in['pass'] ?? ''); if (strlen($pw) < 8) out(['error' => 'A senha precisa ter 8 ou mais caracteres.'], 400); q('UPDATE users SET pass=? WHERE id=?', [password_hash($pw, PASSWORD_DEFAULT), $id]); }
        out(['ok' => 1]);

    case 'a_tokens': admin(); out(q('SELECT * FROM tokens ORDER BY id DESC LIMIT 100')->fetchAll());
    case 'a_token':
        admin(); $act = (string)($in['act'] ?? '');
        if ($act === 'gen') {
            $n = max(1, min(50, (int)($in['n'] ?? 1))); $days = max(0, (int)($in['days'] ?? 7)); $role = ($in['role'] ?? '') === 'admin' ? 'admin' : 'aluno';
            for ($i = 0; $i < $n; $i++) q('INSERT INTO tokens(token,role,expires,created) VALUES(?,?,?,?)', [mktoken(), $role, $days ? time() + $days * 86400 : null, time()]);
        } elseif ($act === 'del') q('DELETE FROM tokens WHERE id=? AND used_by IS NULL', [(int)($in['id'] ?? 0)]);
        out(['ok' => 1]);

    case 'a_reqs': admin(); out(q('SELECT * FROM requests ORDER BY id DESC LIMIT 200')->fetchAll());
    case 'a_req':
        admin(); $id = (int)($in['id'] ?? 0); $act = (string)($in['act'] ?? ''); $tk = null;
        if ($act === 'approve') { $tk = mktoken(); q('INSERT INTO tokens(token,role,expires,created) VALUES(?,?,?,?)', [$tk, 'aluno', time() + 7 * 86400, time()]); q("UPDATE requests SET status='aprovado', token=? WHERE id=?", [$tk, $id]); }
        elseif ($act === 'refuse') q("UPDATE requests SET status='recusado' WHERE id=?", [$id]);
        elseif ($act === 'del') q('DELETE FROM requests WHERE id=?', [$id]);
        out(['ok' => 1, 'token' => $tk]);

    case 'a_content':
        $ad = admin(); $t = q('SELECT * FROM topics WHERE package_id=? ORDER BY pos', [curpkg($ad)])->fetchAll();
        foreach ($t as &$x) $x['cards'] = q('SELECT id,q,a FROM cards WHERE topic_id=? ORDER BY id', [$x['id']])->fetchAll();
        out($t);
    case 'a_topic':
        $ad = admin(); $id = (int)($in['id'] ?? 0); $act = (string)($in['act'] ?? 'save');
        if ($act === 'del') { q('DELETE FROM topics WHERE id=?', [$id]); out(['ok' => 1]); }
        $v = [str($in, 'title', 200), str($in, 'law', 300), str($in, 'summary', 8000), str($in, 'mnemonic', 400)];
        if ($v[0] === '') out(['error' => 'Informe o título.'], 400);
        if ($id) q('UPDATE topics SET title=?,law=?,summary=?,mnemonic=? WHERE id=?', [...$v, $id]);
        else q('INSERT INTO topics(title,law,summary,mnemonic,package_id,emoji,pos) VALUES(?,?,?,?,?,?,(SELECT IFNULL(MAX(pos),0)+1 FROM topics))', [...$v, curpkg($ad), '📖']);
        out(['ok' => 1]);
    case 'a_card':
        admin(); $id = (int)($in['id'] ?? 0); $act = (string)($in['act'] ?? 'save');
        if ($act === 'del') { q('DELETE FROM cards WHERE id=?', [$id]); out(['ok' => 1]); }
        $qq = str($in, 'q', 1000); $aa = str($in, 'a', 2000);
        if ($qq === '' || $aa === '') out(['error' => 'Preencha pergunta e resposta.'], 400);
        q('INSERT INTO cards(topic_id,q,a) VALUES(?,?,?)', [(int)($in['topic_id'] ?? 0), $qq, $aa]); out(['ok' => 1]);

    case 'a_pkgs': admin(); out(q('SELECT p.id,p.slug,p.name,p.emoji,p.goal,(SELECT COUNT(*) FROM topics t WHERE t.package_id=p.id) topics FROM packages p ORDER BY p.id')->fetchAll());
    case 'a_pkg_import':
        admin();
        try { $j = json_decode(substr(trim((string)($in['json'] ?? '')), 0, 3000000), true); if (!is_array($j)) throw new RuntimeException('JSON inválido.'); install_package($j); }
        catch (Throwable $e) { out(['error' => $e->getMessage()], 400); }
        out(['ok' => 1]);
    case 'a_pkg_del':
        admin(); if ((int)q('SELECT COUNT(*) FROM packages')->fetchColumn() <= 1) out(['error' => 'Mantenha ao menos um pacote instalado.'], 400);
        q('DELETE FROM packages WHERE id=?', [(int)($in['id'] ?? 0)]); out(['ok' => 1]);

    case 'routes':
        $u = user(); $id = (int)$u['id'];
        out(['routes' => q("SELECT p.id,p.name,p.emoji,p.goal,p.kind,p.visibility,(p.owner_id IS NOT NULL AND p.owner_id=?) mine, IFNULL(pl.status,'ativa') status, pl.deadline, IFNULL(pl.hpw,5) hpw,
              (SELECT COUNT(*) FROM cards c JOIN topics t ON t.id=c.topic_id WHERE t.package_id=p.id) n,
              (SELECT COUNT(*) FROM progress pr JOIN cards c ON c.id=pr.card_id JOIN topics t ON t.id=c.topic_id WHERE t.package_id=p.id AND pr.user_id=? AND pr.reps>=2) k
              FROM packages p LEFT JOIN plans pl ON pl.package_id=p.id AND pl.user_id=?
              WHERE (p.owner_id IS NULL OR p.owner_id=? OR (pl.id IS NOT NULL AND (p.visibility='publica' OR (p.visibility='grupos' AND EXISTS(SELECT 1 FROM route_shares s JOIN group_members m ON m.group_id=s.group_id WHERE s.package_id=p.id AND m.user_id=?)))))
                AND IFNULL(pl.status,'ativa')!='excluida' ORDER BY p.id", [$id, $id, $id, $id, $id])->fetchAll(), 'current' => curpkg($u), 'ia' => ia_info($u)]);
    case 'route_data':
        $u = user(); $pid = (int)($_GET['id'] ?? 0); if (!visible_pkg((int)$u['id'], $pid)) out(['error' => 'Trilha não encontrada.'], 404);
        out(route_data((int)$u['id'], $pid));
    case 'ia_status': out(ia_info(user()));
    case 'route_job':
        $u = user(); $j = q('SELECT status,msg,route_id,payload,progress FROM jobs WHERE id=? AND user_id=?', [(int)($_GET['id'] ?? 0), $u['id']])->fetch();
        if (!$j) out(['status' => 'erro', 'msg' => 'Tarefa não encontrada.']);
        if ($j['status'] === 'manual') $j['manual'] = ['prompt' => (string)(jd($j['payload'])['prompt'] ?? '')];
        $j['progress'] = $j['progress'] ? jd($j['progress']) : null; unset($j['payload']); out($j);
    case 'route_plan':
        $u = user(); $uid = (int)$u['id']; $pid = (int)($in['id'] ?? 0); if (!visible_pkg($uid, $pid)) out(['error' => 'Trilha não encontrada.'], 404);
        $pl = plan_get($uid, $pid); $dl = trim((string)($in['deadline'] ?? '')); $ts = $dl !== '' ? strtotime($dl . ' 23:59:59 UTC') : null;
        if ($dl !== '' && !$ts) out(['error' => 'Data inválida.'], 400);
        if ($ts && $pl['paused_at']) $ts = (int)$pl['paused_at'] + ($ts - time());   // trilha parada: o prazo é medido a partir do congelamento
        q('UPDATE plans SET deadline=?, hpw=? WHERE id=?', [$ts ?: null, max(0.5, min(80, (float)($in['hpw'] ?? 5))), $pl['id']]); out(['ok' => 1]);
    case 'route_state':
        $u = user(); $uid = (int)$u['id']; $pid = (int)($in['id'] ?? 0); $act = (string)($in['act'] ?? '');
        if (!visible_pkg($uid, $pid)) out(['error' => 'Trilha não encontrada.'], 404);
        $pl = plan_get($uid, $pid); $now = time();
        if ($act === 'pause' && $pl['status'] === 'ativa') q("UPDATE plans SET status='pausada', paused_at=? WHERE id=?", [$now, $pl['id']]);
        elseif ($act === 'resume' && $pl['status'] === 'pausada') resume_plan($pl);
        elseif ($act === 'delete') {
            if ((int)q('SELECT IFNULL(owner_id,0) FROM packages WHERE id=?', [$pid])->fetchColumn() !== $uid) out(['error' => 'Trilhas do sistema não podem ser excluídas: use Desativar.'], 400);
            q("UPDATE plans SET prev_status=status, status='excluida', deleted_at=?, paused_at=IFNULL(paused_at,?) WHERE id=?", [$now, $now, $pl['id']]);
            q('UPDATE users SET pkg=NULL WHERE id=? AND pkg=?', [$uid, $pid]);
        }
        out(['ok' => 1]);
    case 'route_export':
        $u = user(); $pid = (int)($_GET['id'] ?? 0); if (!visible_pkg((int)$u['id'], $pid)) out(['error' => 'Trilha não encontrada.'], 404);
        out(export_route((int)$u['id'], $pid));
    case 'route_import':
        $u = user();
        try { $j = json_decode(substr(trim((string)($in['json'] ?? '')), 0, 8000000), true); if (!is_array($j)) throw new RuntimeException('JSON inválido.'); out(import_route((int)$u['id'], $j)); }
        catch (Throwable $e) { out(['error' => $e->getMessage()], 400); }
    case 'route_create':
        $u = user(); $inf = ia_info($u);
        if (!$inf['admin'] && $inf['used'] >= $inf['limit']) out(['error' => 'Limite diário de ' . $inf['limit'] . ' trilhas atingido. Tente amanhã.'], 429);
        $dls = trim((string)($in['deadline'] ?? '')); $dts = $dls !== '' ? (strtotime($dls . ' 23:59:59 UTC') ?: null) : null;
        $mats = []; foreach (array_slice((array)($in['materials'] ?? []), 0, 6) as $m) { if (!is_array($m)) continue; $pdf = (string)($m['pdf'] ?? ''); if ($pdf !== '' && (strlen($pdf) > 7000000 || !preg_match('~^[A-Za-z0-9+/=]+$~', $pdf))) $pdf = '';
            $mats[] = ['title' => str($m, 'title', 200) ?: 'Material', 'author' => str($m, 'author', 200), 'text' => str($m, 'text', 60000), 'pdf' => $pdf]; }
        foreach (array_slice((array)($in['material_ids'] ?? []), 0, 6) as $mid) { $m = q('SELECT title,author,text,pdf FROM materials WHERE id=? AND user_id=?', [(int)$mid, $u['id']])->fetch(); if ($m) $mats[] = ['title' => $m['title'], 'author' => (string)$m['author'], 'text' => substr((string)$m['text'], 0, 60000), 'pdf' => (string)$m['pdf']]; }
        $vids = []; foreach (array_slice((array)($in['videos'] ?? []), 0, 6) as $v) { if (!is_array($v)) continue; $url = str($v, 'url', 500); if (!preg_match('~^https?://~i', $url)) continue; $vids[] = ['url' => $url, 'transcript' => str($v, 'transcript', 60000)]; }
        $inp = ['mode' => in_array($in['mode'] ?? '', ['tema', 'material', 'video'], true) ? $in['mode'] : 'tema', 'theme' => str($in, 'theme', 3000), 'objective' => str($in, 'objective', 500), 'level' => str($in, 'level', 40) ?: 'iniciante', 'themes' => str($in, 'themes', 3000), 'style' => str($in, 'style', 40), 'session' => max(5, min(180, (int)($in['session'] ?? 25))),
            'materials' => $mats, 'videos' => $vids, 'deadline' => $dls, 'deadline_ts' => $dts, 'hpw' => max(0.5, min(80, (float)($in['hpw'] ?? 5)))];
        if ($inp['objective'] === '' || ($inp['theme'] === '' && !$mats && !$vids)) out(['error' => 'Informe o objetivo final e o tema, ou inclua materiais ou vídeos.'], 400);
        q('INSERT INTO jobs(user_id,status,msg,created) VALUES(?,?,?,?)', [$u['id'], 'gerando', 'Iniciando…', time()]); $jid = (int)db()->lastInsertId();
        bg_start(['job' => $jid], fn() => run_route_job($jid, (int)$u['id'], $inp));
    case 'route_manual': case 'route_skeleton': case 'route_retry':
        $u = user(); $j = q('SELECT * FROM jobs WHERE id=? AND user_id=?', [(int)($in['job'] ?? 0), $u['id']])->fetch(); $pl = $j ? jd($j['payload']) : [];
        if (!$j || empty($pl['input'])) out(['error' => 'Tarefa não encontrada.'], 404);
        $inp = $pl['input']; $meta = $pl['meta'] ?? [];
        if ($r === 'route_retry') { q("UPDATE jobs SET status='gerando',msg='Tentando novamente…' WHERE id=?", [$j['id']]); bg_start(['ok' => 1], fn() => run_route_job((int)$j['id'], (int)$u['id'], $inp)); }
        try {
            if ($r === 'route_skeleton') $pid = finish_route((int)$j['id'], (int)$u['id'], $inp, skeleton_route($inp), $meta + ['extra' => ['rascunho' => true]], 'Esqueleto criado: complete os assuntos com "Gerar mais cartões".');
            else $pid = finish_route((int)$j['id'], (int)$u['id'], $inp, norm_route(extract_json((string)($in['text'] ?? '')) ?? throw new InvalidArgumentException('Não encontrei um JSON válido na resposta colada.'), $inp), $meta + ['extra' => ['origem' => 'agente externo']], 'Trilha criada a partir da resposta do agente.');
            out(['id' => $pid]);
        } catch (Throwable $e) { out(['error' => $e->getMessage()], 400); }
    case 'topic_expand': case 'topic_expand_apply':
        $u = user(); $tid = (int)($in['id'] ?? 0);
        $t = q('SELECT t.*, p.owner_id FROM topics t JOIN packages p ON p.id=t.package_id WHERE t.id=?', [$tid])->fetch();
        if (!$t) out(['error' => 'Assunto não encontrado.'], 404);
        if ($u['role'] !== 'admin' && (int)$t['owner_id'] !== (int)$u['id']) out(['error' => 'Só o autor da trilha pode ampliar os assuntos.'], 403);
        $cards = q('SELECT q FROM cards WHERE topic_id=?', [$tid])->fetchAll(); $focus = str($in, 'focus', 300); set_time_limit(0); session_write_close();
        if ($r === 'topic_expand_apply') { try { out(['ok' => 1, 'added' => apply_expand($tid, norm_expand(extract_json((string)($in['text'] ?? '')), $t['title']))]); } catch (Throwable $e) { out(['error' => $e->getMessage()], 400); } }
        try {
            if (!ia_info($u)['enabled']) throw new RuntimeException('A IA automática não está configurada.');
            $res = ai_complete(['system' => 'Você é designer instrucional. Responda em português do Brasil, somente com JSON válido.', 'user' => fn(bool $s) => expand_prompt($t, $cards, $focus, $s), 'search' => true, 'max_tokens' => 6000], fn($x) => norm_expand(extract_json($x), $t['title']));
            out(['ok' => 1, 'added' => apply_expand($tid, $res['result']), 'provider' => $res['provider']]);
        } catch (Throwable $e) { out(['manual' => ['prompt' => expand_prompt($t, $cards, $focus, false), 'error' => $e->getMessage()]]); }

    case 'graph_data':
        $u = user(); $pid = (int)($_GET['id'] ?? 0) ?: curpkg($u); if (!visible_pkg((int)$u['id'], $pid)) out(['error' => 'Trilha não encontrada.'], 404);
        out(graph_data((int)$u['id'], $pid));
    case 'deep_generate': case 'deep_apply':
        $u = user(); $uid = (int)$u['id']; $kind = ($in['kind'] ?? 'tema') === 'card' ? 'card' : 'tema'; $focus = str($in, 'focus', 300);
        $t = q('SELECT * FROM topics WHERE id=?', [(int)($in['topic_id'] ?? 0)])->fetch(); if (!$t || !visible_pkg($uid, (int)$t['package_id'])) out(['error' => 'Tópico não encontrado.'], 404);
        $pk = q('SELECT id,name,goal,objective,biblio FROM packages WHERE id=?', [$t['package_id']])->fetch(); $card = !empty($in['card_id']) ? (q('SELECT id,q,a FROM cards WHERE id=? AND topic_id=?', [(int)$in['card_id'], $t['id']])->fetch() ?: null) : null;
        set_time_limit(0); session_write_close();
        if ($r === 'deep_apply') { try { $x = norm_deepdive(extract_json((string)($in['text'] ?? '')) ?? throw new InvalidArgumentException('Não encontrei um JSON válido na resposta colada.'), $kind, $t['title']); out(['ok' => 1, 'items' => deep_save($uid, $pk, $t, $card, $kind, $x)]); } catch (Throwable $e) { out(['error' => $e->getMessage()], 400); } }
        try {
            if (!ia_info($u)['enabled']) throw new RuntimeException('A IA automática não está configurada.');
            $res = ai_complete(['system' => 'Você é professor(a) e pesquisador(a). Responda em português do Brasil e somente com JSON válido.', 'user' => fn(bool $s) => deep_prompt($pk, $t, $card, $kind, $focus, $s), 'search' => true, 'max_tokens' => 4000], fn($x) => norm_deepdive(extract_json($x) ?? throw new InvalidArgumentException('Resposta sem JSON válido.'), $kind, $t['title']), 'redator');
            out(['ok' => 1, 'items' => deep_save($uid, $pk, $t, $card, $kind, $res['result']), 'provider' => $res['provider']]);
        } catch (Throwable $e) { out(['manual' => ['prompt' => deep_prompt($pk, $t, $card, $kind, $focus, false), 'error' => $e->getMessage()]]); }
    case 'deep_list':
        $u = user(); $uid = (int)$u['id']; $pid = (int)($_GET['id'] ?? 0) ?: curpkg($u); if (!visible_pkg($uid, $pid)) out(['error' => 'Trilha não encontrada.'], 404);
        $rows = q('SELECT d.id,d.topic_id,d.card_id,d.kind,d.title,d.q,d.a,d.summary,d.points,d.refs,d.created,t.title topic,t.emoji FROM deepdives d JOIN topics t ON t.id=d.topic_id WHERE d.user_id=? AND d.package_id=? ORDER BY d.id DESC', [$uid, $pid])->fetchAll();
        foreach ($rows as &$x) { $x['points'] = jd($x['points']); $x['refs'] = jd($x['refs']); }
        unset($x); out(['pkg' => q('SELECT id,name,emoji,goal FROM packages WHERE id=?', [$pid])->fetch(), 'items' => $rows]);
    case 'deep_del':
        $u = user(); $d = q('SELECT material_id FROM deepdives WHERE id=? AND user_id=?', [(int)($in['id'] ?? 0), $u['id']])->fetch();
        if ($d) { q('DELETE FROM deepdives WHERE id=?', [(int)$in['id']]); if (!empty($in['with_material']) && $d['material_id']) q('DELETE FROM materials WHERE id=? AND user_id=?', [$d['material_id'], $u['id']]); } out(['ok' => 1]);
    case 'game_result':
        $u = user(); $uid = (int)$u['id']; $g = game_cfg(); if (!$g['on']) out(['xp' => 0]); $score = max(0, min(5000, (int)($in['score'] ?? 0))); $kind = in_array($in['game'] ?? '', ['snake', 'car', 'tetris'], true) ? $in['game'] : 'snake';
        $today = (int)q('SELECT COUNT(*) FROM game_log WHERE user_id=? AND ts>?', [$uid, time() - 86400])->fetchColumn(); $lastg = (int)q('SELECT IFNULL(MAX(ts),0) FROM game_log WHERE user_id=?', [$uid])->fetchColumn();
        $rows = q('SELECT grade,ts FROM logs WHERE user_id=? ORDER BY id DESC LIMIT ' . (int)$g['streak'], [$uid])->fetchAll();
        $streakOk = count($rows) >= $g['streak'] && !array_filter($rows, fn($x) => (int)$x['grade'] < 2 || (int)$x['ts'] <= $lastg);
        if ($today >= $g['daily'] || !$streakOk) out(['xp' => 0, 'note' => $today >= $g['daily'] ? 'Limite diário de jogos atingido.' : 'Faça ' . $g['streak'] . ' acertos seguidos para valer pontos.']);
        $xp = min($g['max_xp'], intdiv($score, 10)); q('INSERT INTO game_log(user_id,game,score,xp,ts) VALUES(?,?,?,?,?)', [$uid, $kind, $score, $xp, time()]); if ($xp > 0) q('UPDATE users SET xp=xp+? WHERE id=?', [$xp, $uid]); out(['xp' => $xp]);
    case 'a_game': admin(); out(['game' => game_cfg(), 'graph' => graph_cfg()]);
    case 'a_game_set':
        admin(); $g = (array)($in['game'] ?? []); $g['games'] = (array)($g['games'] ?? []); set_setting('game_cfg', json_encode(clean_game($g))); set_setting('graph_cfg', json_encode(clean_graph((array)($in['graph'] ?? [])))); out(['ok' => 1]);
    case 'media_init':
        $u = user(); $max = (int)setting('media_max_mb', '500') * 1048576; $size = (int)($in['size'] ?? 0); $name = basename(str($in, 'name', 200)); $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if (!in_array($ext, MEDIA_EXT, true)) out(['error' => 'Formato não aceito. Use áudio (mp3, m4a, wav, ogg, flac, aac) ou vídeo (mp4, mov, mkv, webm, avi).'], 400);
        if ($size <= 0 || $size > $max) out(['error' => 'Arquivo grande demais: o limite é ' . round($max / 1048576) . ' MB.'], 400);
        if ((int)q("SELECT COUNT(*) FROM media WHERE user_id=? AND status IN ('enviando','processando')", [$u['id']])->fetchColumn() >= 3) out(['error' => 'Você já tem 3 aulas em andamento. Aguarde terminar.'], 429);
        foreach (q("SELECT id FROM media WHERE status='enviando' AND created<?", [time() - 86400])->fetchAll(PDO::FETCH_COLUMN) as $old) { foreach (glob(media_dir((int)$old) . '/*') ?: [] as $f) @unlink($f); @rmdir(media_dir((int)$old)); q('DELETE FROM media WHERE id=?', [$old]); }
        $title = str($in, 'title', 200) ?: pathinfo($name, PATHINFO_FILENAME);
        q('INSERT INTO media(user_id,title,filename,mime,size,status,opts,created) VALUES(?,?,?,?,?,?,?,?)', [$u['id'], $title, $name, mime_of($name, str($in, 'mime', 80)), $size, 'enviando', json_encode(['lang' => str($in, 'lang', 10) ?: 'pt-BR', 'deep' => !empty($in['deep']), 'biblio' => !empty($in['biblio']), 'title_auto' => str($in, 'title', 200) === ''], JSON_UNESCAPED_UNICODE), time()]);
        out(['id' => (int)db()->lastInsertId(), 'chunk' => 4 * 1048576]);
    case 'media_chunk':
        $u = user(); $id = (int)($_GET['id'] ?? 0); $n = max(0, (int)($_GET['n'] ?? 0)); $m = q("SELECT * FROM media WHERE id=? AND user_id=? AND status='enviando'", [$id, $u['id']])->fetch(); if (!$m) out(['error' => 'Envio não encontrado.'], 404);
        $data = (string)file_get_contents('php://input'); if ($data === '' || strlen($data) > 5 * 1048576) out(['error' => 'Parte inválida.'], 400);
        file_put_contents(media_dir($id) . '/part' . sprintf('%05d', $n), $data); out(['ok' => 1]);
    case 'media_done':
        $u = user(); $id = (int)($in['id'] ?? 0); $m = q("SELECT * FROM media WHERE id=? AND user_id=? AND status='enviando'", [$id, $u['id']])->fetch(); if (!$m) out(['error' => 'Envio não encontrado.'], 404);
        $dir = media_dir($id); $stored = 'aula.' . strtolower(pathinfo((string)$m['filename'], PATHINFO_EXTENSION)); $parts = glob($dir . '/part*') ?: []; sort($parts); $fh = fopen($dir . '/' . $stored, 'wb');
        foreach ($parts as $p) { $ph = fopen($p, 'rb'); stream_copy_to_stream($ph, $fh); fclose($ph); @unlink($p); } fclose($fh);
        if (abs(filesize($dir . '/' . $stored) - (int)$m['size']) > 16) { @unlink($dir . '/' . $stored); out(['error' => 'O envio ficou incompleto. Tente de novo.'], 400); }
        q("UPDATE media SET stored=?, status='processando', msg='Na fila…' WHERE id=?", [$stored, $id]); bg_start(['ok' => 1], fn() => run_media_job($id));
    case 'media_job':
        $u = user(); $m = q('SELECT status,msg,progress FROM media WHERE id=? AND user_id=?', [(int)($_GET['id'] ?? 0), $u['id']])->fetch(); if (!$m) out(['status' => 'erro', 'msg' => 'Aula não encontrada.']);
        $m['progress'] = $m['progress'] ? jd($m['progress']) : null; out($m);
    case 'media_list':
        $u = user(); out(['media' => q('SELECT id,title,filename,size,status,msg,created FROM media WHERE user_id=? ORDER BY id DESC', [$u['id']])->fetchAll(), 'max_mb' => (int)setting('media_max_mb', '500'), 'stt' => count(ia_stt_active()) > 0]);
    case 'media_get':
        $u = user(); $m = q('SELECT * FROM media WHERE id=? AND user_id=?', [(int)($_GET['id'] ?? 0), $u['id']])->fetch(); if (!$m) out(['error' => 'Aula não encontrada.'], 404);
        out(['id' => (int)$m['id'], 'title' => $m['title'], 'filename' => $m['filename'], 'size' => (int)$m['size'], 'status' => $m['status'], 'msg' => $m['msg'], 'created' => (int)$m['created'], 'transcript' => mb_substr((string)$m['transcript'], 0, 300000), 'structure' => jd($m['structure']) ?: null, 'bib' => jd($m['biblio']) ?: null, 'deep' => jd($m['deep']) ?: null, 'material_ids' => array_map('intval', jd($m['material_ids'])), 'progress' => $m['progress'] ? jd($m['progress']) : null]);
    case 'media_text':
        $u = user(); $id = (int)($in['id'] ?? 0); $tx = trim((string)($in['text'] ?? '')); $m = q('SELECT id FROM media WHERE id=? AND user_id=?', [$id, $u['id']])->fetch();
        if (!$m || strlen($tx) < 30) out(['error' => 'Cole a transcrição da aula (pelo menos algumas frases).'], 400);
        q("UPDATE media SET transcript=?, status='processando', msg='Na fila…' WHERE id=?", [substr($tx, 0, 1500000), $id]); bg_start(['ok' => 1], fn() => run_media_job($id));
    case 'media_retry':
        $u = user(); $id = (int)($in['id'] ?? 0); $m = q('SELECT id FROM media WHERE id=? AND user_id=?', [$id, $u['id']])->fetch(); if (!$m) out(['error' => 'Aula não encontrada.'], 404);
        q("UPDATE media SET status='processando', msg='Tentando de novo…' WHERE id=?", [$id]); bg_start(['ok' => 1], fn() => run_media_job($id));
    case 'media_del':
        $u = user(); $id = (int)($in['id'] ?? 0); $m = q('SELECT material_ids FROM media WHERE id=? AND user_id=?', [$id, $u['id']])->fetch();
        if ($m) { if (!empty($in['with_materials'])) foreach (jd($m['material_ids']) as $mi) q('DELETE FROM materials WHERE id=? AND user_id=?', [(int)$mi, $u['id']]); foreach (glob(media_dir($id) . '/*') ?: [] as $f) @unlink($f); @rmdir(media_dir($id)); q('DELETE FROM media WHERE id=?', [$id]); }
        out(['ok' => 1]);
    case 'a_cfg': admin(); out(['editions' => setting('editions', 'ambas')]);
    case 'a_cfg_set': admin(); $e = (string)($in['editions'] ?? 'ambas'); set_setting('editions', in_array($e, ['ambas', 'portal', 'acessivel'], true) ? $e : 'ambas'); out(['ok' => 1]);
    case 'a_ia':
        admin(); $ps = array_map(fn($p) => ['id' => $p['id'], 'type' => $p['type'], 'label' => $p['label'] ?? '', 'role' => $p['role'] ?? 'qualquer', 'stt' => !empty($p['stt']), 'model' => $p['model'] ?? '', 'base_url' => $p['base_url'] ?? '', 'search' => !empty($p['search']), 'enabled' => !empty($p['enabled']), 'hint' => !empty($p['key']) ? '…' . substr((string)$p['key'], -4) : ''], ia_providers());
        out(['providers' => $ps, 'enabled' => setting('ia_enabled', '1') === '1', 'limit' => (int)setting('ia_limit', '3'), 'types' => IA_TYPES, 'health' => jd(setting('ia_health', '')), 'media_max_mb' => (int)setting('media_max_mb', '500'), 'ffmpeg' => ffmpeg_path() !== null]);
    case 'a_ia_save':
        admin(); $old = []; foreach (ia_providers() as $p) $old[$p['id']] = $p; $new = [];
        foreach (array_slice((array)($in['providers'] ?? []), 0, 8) as $p) {
            $pid = preg_replace('/[^a-z0-9]/', '', strtolower((string)($p['id'] ?? ''))) ?: 'p' . bin2hex(random_bytes(3)); $type = isset(IA_TYPES[$p['type'] ?? '']) ? $p['type'] : 'openai';
            $key = trim((string)($p['key'] ?? '')); if ($key === '' && isset($old[$pid])) $key = (string)$old[$pid]['key'];
            $new[] = ['id' => $pid, 'type' => $type, 'label' => substr(trim((string)($p['label'] ?? '')) ?: IA_TYPES[$type], 0, 60), 'key' => $key, 'model' => substr(trim((string)($p['model'] ?? '')), 0, 80), 'base_url' => substr(trim((string)($p['base_url'] ?? '')), 0, 200), 'search' => !empty($p['search']), 'enabled' => !empty($p['enabled']), 'role' => in_array($p['role'] ?? '', ['planejador', 'redator'], true) ? $p['role'] : 'qualquer', 'stt' => !empty($p['stt'])];
        }
        set_setting('media_max_mb', (string)max(10, min(4000, (int)($in['media_max_mb'] ?? 500))));
        set_setting('ia_providers', json_encode($new, JSON_UNESCAPED_UNICODE)); set_setting('ia_enabled', (string)($in['enabled'] ?? '1') === '1' ? '1' : '0'); set_setting('ia_limit', (string)max(1, min(50, (int)($in['limit'] ?? 3)))); set_setting('ia_health', '{}'); out(['ok' => 1]);
    case 'a_ia_test':
        admin(); $pid = (string)($in['id'] ?? '');
        foreach (ia_providers() as $p) if ($p['id'] === $pid) { try { $x = ia_call($p, ['system' => 'Responda curto.', 'user' => 'Responda apenas: ok', 'max_tokens' => 20]); out(['ok' => 1, 'resp' => substr($x['text'], 0, 60)]); } catch (Throwable $e) { out(['error' => $e->getMessage()], 400); } }
        out(['error' => 'Provedor não encontrado. Salve antes de testar.'], 404);
    case 'a_dels':
        admin(); out(q("SELECT pl.id,p.name,p.emoji,u.name uname,u.email,pl.deleted_at FROM plans pl JOIN packages p ON p.id=pl.package_id JOIN users u ON u.id=pl.user_id WHERE pl.status='excluida' ORDER BY pl.deleted_at DESC")->fetchAll());
    case 'a_del':
        admin(); $pl = q("SELECT * FROM plans WHERE id=? AND status='excluida'", [(int)($in['id'] ?? 0)])->fetch();
        if (!$pl) out(['error' => 'Exclusão não encontrada.'], 404);
        if (($in['act'] ?? '') === 'approve') q('DELETE FROM packages WHERE id=? AND owner_id IS NOT NULL', [$pl['package_id']]);
        else { if ($pl['prev_status'] === 'ativa') resume_plan($pl); else q("UPDATE plans SET status='pausada' WHERE id=?", [$pl['id']]); q('UPDATE plans SET deleted_at=NULL, prev_status=NULL WHERE id=?', [$pl['id']]); }
        out(['ok' => 1]);

    case 'explore':
        $u = user(); $id = (int)$u['id']; $qs = trim((string)($_GET['q'] ?? '')); $kind = (string)($_GET['kind'] ?? ''); $like = '%' . str_replace(['%', '_'], '', $qs) . '%'; $lim = min(60, max(1, (int)($_GET['limit'] ?? 60)));
        $order = ($_GET['sort'] ?? '') === 'recentes' ? 'p.id DESC' : '(likes*3+followers*2+clones*4) DESC, p.id DESC';
        $rows = q("SELECT p.id,p.name,p.emoji,p.goal,p.kind,p.tags,p.visibility,u.name author,(p.owner_id=?) mine,
            (SELECT COUNT(*) FROM likes l WHERE l.package_id=p.id) likes,(SELECT COUNT(*) FROM likes l WHERE l.package_id=p.id AND l.user_id=?) liked,
            (SELECT COUNT(*) FROM plans x WHERE x.package_id=p.id AND x.user_id!=IFNULL(p.owner_id,0) AND x.status!='excluida') followers,
            (SELECT COUNT(*) FROM packages c WHERE c.origin_id=p.id) clones,(SELECT COUNT(*) FROM topics t WHERE t.package_id=p.id) ntopics
            FROM packages p LEFT JOIN users u ON u.id=p.owner_id
            WHERE (p.owner_id IS NULL OR p.owner_id=? OR p.visibility='publica' OR (p.visibility='grupos' AND EXISTS(SELECT 1 FROM route_shares s JOIN group_members m ON m.group_id=s.group_id WHERE s.package_id=p.id AND m.user_id=?)))
              AND NOT EXISTS(SELECT 1 FROM plans o WHERE o.package_id=p.id AND o.user_id=p.owner_id AND o.status='excluida')
              AND (?='' OR p.name LIKE ? OR p.goal LIKE ? OR p.objective LIKE ? OR IFNULL(p.tags,'') LIKE ?) AND (?='' OR p.kind=?) ORDER BY $order LIMIT $lim",
            [$id, $id, $id, $id, $qs, $like, $like, $like, $like, $kind, $kind])->fetchAll();
        foreach ($rows as &$x) { $x['tags'] = jd($x['tags']); $x['mine'] = (bool)$x['mine']; $x['liked'] = (bool)$x['liked']; }
        unset($x); out(['routes' => $rows]);
    case 'route_public':
        $u = user(); $id = (int)$u['id']; $pid = (int)($_GET['id'] ?? 0); if (!can_view($id, $pid)) out(['error' => 'Trilha não encontrada.'], 404);
        $pk = q('SELECT p.id,p.name,p.emoji,p.goal,p.kind,p.objective,p.strategy,p.biblio,p.tags,p.visibility,p.owner_id,u.name author FROM packages p LEFT JOIN users u ON u.id=p.owner_id WHERE p.id=?', [$pid])->fetch();
        foreach (['strategy', 'biblio', 'tags'] as $k) $pk[$k] = jd($pk[$k]);
        $pk['likes'] = (int)q('SELECT COUNT(*) FROM likes WHERE package_id=?', [$pid])->fetchColumn(); $pk['liked'] = (bool)q('SELECT 1 FROM likes WHERE package_id=? AND user_id=?', [$pid, $id])->fetch();
        $pk['followers'] = (int)q("SELECT COUNT(*) FROM plans WHERE package_id=? AND user_id!=? AND status!='excluida'", [$pid, (int)$pk['owner_id']])->fetchColumn();
        $pk['clones'] = (int)q('SELECT COUNT(*) FROM packages WHERE origin_id=?', [$pid])->fetchColumn();
        $pk['following'] = !$pk['owner_id'] || (bool)q("SELECT 1 FROM plans WHERE package_id=? AND user_id=? AND status!='excluida'", [$pid, $id])->fetch();
        $pk['mine'] = (int)$pk['owner_id'] === $id; $pk['is_admin'] = $u['role'] === 'admin';
        $pk['topics'] = q('SELECT t.id,t.title,t.emoji,t.difficulty,(SELECT COUNT(*) FROM cards c WHERE c.topic_id=t.id) n FROM topics t WHERE t.package_id=? ORDER BY t.pos', [$pid])->fetchAll();
        $pk['comments'] = array_map(fn($c) => $c + ['mine' => (int)$c['uid'] === $id], q('SELECT c.id,c.text,c.created,c.user_id uid,u.name uname FROM comments c JOIN users u ON u.id=c.user_id WHERE c.package_id=? ORDER BY c.id DESC LIMIT 50', [$pid])->fetchAll());
        $pk['groups'] = q('SELECT g.name FROM route_shares s JOIN study_groups g ON g.id=s.group_id WHERE s.package_id=?', [$pid])->fetchAll(PDO::FETCH_COLUMN);
        out($pk);
    case 'route_like':
        $u = user(); $pid = (int)($in['id'] ?? 0); if (!can_view((int)$u['id'], $pid)) out(['error' => 'Trilha não encontrada.'], 404);
        if (q('SELECT 1 FROM likes WHERE package_id=? AND user_id=?', [$pid, $u['id']])->fetch()) q('DELETE FROM likes WHERE package_id=? AND user_id=?', [$pid, $u['id']]); else q('INSERT INTO likes(package_id,user_id) VALUES(?,?)', [$pid, $u['id']]);
        out(['ok' => 1]);
    case 'route_comment':
        $u = user(); $pid = (int)($in['id'] ?? 0); $tx = str($in, 'text', 500); if (!can_view((int)$u['id'], $pid) || $tx === '') out(['error' => 'Comentário inválido.'], 400);
        q('INSERT INTO comments(package_id,user_id,text,created) VALUES(?,?,?,?)', [$pid, $u['id'], $tx, time()]); out(['ok' => 1]);
    case 'comment_del':
        $u = user(); $c = q('SELECT c.*, p.owner_id FROM comments c JOIN packages p ON p.id=c.package_id WHERE c.id=?', [(int)($in['id'] ?? 0)])->fetch();
        if ($c && ($u['role'] === 'admin' || (int)$c['user_id'] === (int)$u['id'] || (int)$c['owner_id'] === (int)$u['id'])) q('DELETE FROM comments WHERE id=?', [$c['id']]);
        out(['ok' => 1]);
    case 'route_follow':
        $u = user(); $pid = (int)($in['id'] ?? 0); if (!can_view((int)$u['id'], $pid)) out(['error' => 'Trilha não encontrada.'], 404);
        $pl = plan_get((int)$u['id'], $pid); if ($pl['status'] === 'excluida') out(['error' => 'Trilha indisponível.'], 400);
        q('UPDATE users SET pkg=? WHERE id=?', [$pid, $u['id']]); out(['ok' => 1]);
    case 'route_unfollow':
        $u = user(); $pid = (int)($in['id'] ?? 0);
        q('DELETE FROM plans WHERE user_id=? AND package_id=? AND package_id IN (SELECT id FROM packages WHERE owner_id IS NOT NULL AND owner_id!=?)', [$u['id'], $pid, $u['id']]); q('UPDATE users SET pkg=NULL WHERE id=? AND pkg=?', [$u['id'], $pid]); out(['ok' => 1]);
    case 'route_clone':
        $u = user(); $pid = (int)($in['id'] ?? 0); if (!can_view((int)$u['id'], $pid)) out(['error' => 'Trilha não encontrada.'], 404);
        try { out(['id' => clone_route((int)$u['id'], $pid)]); } catch (Throwable $e) { out(['error' => $e->getMessage()], 400); }
    case 'route_visibility':
        $u = user(); $uid = (int)$u['id']; $pid = (int)($in['id'] ?? 0); $vis = (string)($in['visibility'] ?? 'privada'); $own = (int)q('SELECT IFNULL(owner_id,0) FROM packages WHERE id=?', [$pid])->fetchColumn();
        if (!in_array($vis, ['privada', 'grupos', 'publica'], true)) out(['error' => 'Visibilidade inválida.'], 400);
        if (!$own || ($own !== $uid && !($u['role'] === 'admin' && $vis === 'privada'))) out(['error' => 'Só o autor pode mudar o compartilhamento.'], 403);
        $tags = $in['tags'] ?? []; $tags = is_string($tags) ? preg_split('/\s*[,;]\s*/', $tags) : (array)$tags; $tags = array_slice(array_values(array_filter(array_map(fn($x) => mb_substr(trim((string)$x), 0, 30), $tags))), 0, 8);
        q('UPDATE packages SET visibility=?, tags=? WHERE id=?', [$vis, json_encode($tags, JSON_UNESCAPED_UNICODE), $pid]); q('DELETE FROM route_shares WHERE package_id=?', [$pid]);
        if ($vis === 'grupos') foreach ((array)($in['groups'] ?? []) as $g) if (q('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', [(int)$g, $own])->fetch()) q('INSERT OR IGNORE INTO route_shares(package_id,group_id) VALUES(?,?)', [$pid, (int)$g]);
        out(['ok' => 1]);
    case 'groups':
        $u = user(); $id = (int)$u['id'];
        out(['groups' => array_map(fn($g) => ['owner' => (int)$g['owner_id'] === $id, 'code' => (int)$g['owner_id'] === $id ? $g['code'] : null] + $g,
            q('SELECT g.id,g.name,g.descr,g.owner_id,g.code,(SELECT COUNT(*) FROM group_members x WHERE x.group_id=g.id) members,(SELECT COUNT(*) FROM route_shares s WHERE s.group_id=g.id) trails FROM study_groups g JOIN group_members m ON m.group_id=g.id WHERE m.user_id=? ORDER BY g.id', [$id])->fetchAll())]);
    case 'group_create':
        $u = user(); $nm = str($in, 'name', 80); if ($nm === '') out(['error' => 'Dê um nome ao grupo.'], 400);
        do { $code = strtoupper(bin2hex(random_bytes(3))); } while (q('SELECT 1 FROM study_groups WHERE code=?', [$code])->fetch());
        q('INSERT INTO study_groups(name,descr,owner_id,code,created) VALUES(?,?,?,?,?)', [$nm, str($in, 'descr', 300), $u['id'], $code, time()]); $gid = (int)db()->lastInsertId();
        q("INSERT INTO group_members(group_id,user_id,role,joined) VALUES(?,?,'dono',?)", [$gid, $u['id'], time()]); out(['id' => $gid, 'code' => $code]);
    case 'group_join':
        $u = user(); $g = q('SELECT id FROM study_groups WHERE code=?', [strtoupper(str($in, 'code', 20))])->fetch(); if (!$g) out(['error' => 'Código de convite inválido.'], 404);
        q('INSERT OR IGNORE INTO group_members(group_id,user_id,joined) VALUES(?,?,?)', [$g['id'], $u['id'], time()]); out(['id' => (int)$g['id']]);
    case 'group_data':
        $u = user(); $id = (int)$u['id']; $gid = (int)($_GET['id'] ?? 0); if (!q('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', [$gid, $id])->fetch() && $u['role'] !== 'admin') out(['error' => 'Grupo não encontrado.'], 404);
        $g = q('SELECT id,name,descr,owner_id,code FROM study_groups WHERE id=?', [$gid])->fetch(); if (!$g) out(['error' => 'Grupo não encontrado.'], 404);
        $g['owner'] = (int)$g['owner_id'] === $id; if (!$g['owner']) $g['code'] = null; $g['is_admin'] = $u['role'] === 'admin';
        $g['members'] = q('SELECT u.name,m.role FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY m.joined', [$gid])->fetchAll();
        $g['trails'] = q("SELECT p.id,p.name,p.emoji,p.goal,p.kind,p.tags,u.name author FROM route_shares s JOIN packages p ON p.id=s.package_id LEFT JOIN users u ON u.id=p.owner_id WHERE s.group_id=? AND p.visibility='grupos'", [$gid])->fetchAll();
        foreach ($g['trails'] as &$x) $x['tags'] = jd($x['tags']);
        unset($x); out($g);
    case 'group_leave':
        $u = user(); $gid = (int)($in['id'] ?? 0); q("DELETE FROM group_members WHERE group_id=? AND user_id=? AND role!='dono'", [$gid, $u['id']]); out(['ok' => 1]);
    case 'group_del':
        $u = user(); $gid = (int)($in['id'] ?? 0); q('DELETE FROM study_groups WHERE id=? AND (owner_id=? OR ?)', [$gid, $u['id'], $u['role'] === 'admin' ? 1 : 0]); out(['ok' => 1]);
    case 'materials':
        $u = user(); $rows = q("SELECT id,title,author,kind,url,tags,SUBSTR(IFNULL(text,''),1,160) excerpt,(IFNULL(pdf,'')!='') has_pdf,created FROM materials WHERE user_id=? ORDER BY id DESC", [$u['id']])->fetchAll();
        foreach ($rows as &$x) { $x['tags'] = jd($x['tags']); $x['has_pdf'] = (bool)$x['has_pdf']; }
        unset($x); out(['materials' => $rows]);
    case 'material_get':
        $u = user(); $m = q('SELECT id,title,author,kind,url,text,tags FROM materials WHERE id=? AND user_id=?', [(int)($_GET['id'] ?? 0), $u['id']])->fetch(); if (!$m) out(['error' => 'Material não encontrado.'], 404); $m['tags'] = jd($m['tags']); out($m);
    case 'material_save':
        $u = user(); $mid = (int)($in['id'] ?? 0); $tt = str($in, 'title', 200); if ($tt === '') out(['error' => 'Informe o título do material.'], 400);
        $kind = in_array($in['kind'] ?? '', ['texto', 'link', 'video', 'pdf', 'aula'], true) ? $in['kind'] : 'texto'; $tags = $in['tags'] ?? []; $tags = is_string($tags) ? preg_split('/\s*[,;]\s*/', $tags) : (array)$tags; $tags = array_slice(array_values(array_filter(array_map(fn($x) => mb_substr(trim((string)$x), 0, 30), $tags))), 0, 8);
        $pdf = (string)($in['pdf'] ?? ''); if ($pdf !== '' && (strlen($pdf) > 5600000 || !preg_match('~^[A-Za-z0-9+/=]+$~', $pdf))) out(['error' => 'PDF inválido ou grande demais (máximo 4 MB).'], 400);
        $vals = [$tt, str($in, 'author', 200), $kind, str($in, 'url', 500), str($in, 'text', 120000), json_encode($tags, JSON_UNESCAPED_UNICODE)];
        if ($mid && q('SELECT 1 FROM materials WHERE id=? AND user_id=?', [$mid, $u['id']])->fetch()) { q('UPDATE materials SET title=?,author=?,kind=?,url=?,text=?,tags=? WHERE id=?', [...$vals, $mid]); if ($pdf !== '') q('UPDATE materials SET pdf=? WHERE id=?', [$pdf, $mid]); }
        else q('INSERT INTO materials(title,author,kind,url,text,tags,pdf,user_id,created) VALUES(?,?,?,?,?,?,?,?,?)', [...$vals, $pdf, $u['id'], time()]);
        out(['ok' => 1]);
    case 'material_del':
        $u = user(); q('DELETE FROM materials WHERE id=? AND user_id=?', [(int)($in['id'] ?? 0), $u['id']]); out(['ok' => 1]);

    default: out(['error' => 'Rota desconhecida.'], 404);
}
