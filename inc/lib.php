<?php
declare(strict_types=1);
define('ROOT', dirname(__DIR__));

function cfg(?string $k = null) {
    static $c = null;
    if ($c === null) { $f = ROOT . '/config.php'; $c = is_file($f) ? (require $f) : []; }
    return $k === null ? $c : ($c[$k] ?? null);
}
function installed(): bool { $d = cfg('data'); return is_string($d) && is_file($d . '/app.sqlite'); }
function is_https(): bool { return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'; }
function base(): string { return rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/') . '/'; }

function boot_session(): void {
    if (session_status() !== PHP_SESSION_NONE) return;
    session_name('ec');
    session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'secure' => is_https(), 'path' => base()]);
    session_start();
}
function csrf(): string { return $_SESSION['csrf'] ??= bin2hex(random_bytes(16)); }

function db(?string $file = null): PDO {
    static $p = null;
    if ($p) return $p;
    $p = new PDO('sqlite:' . ($file ?? cfg('data') . '/app.sqlite'), null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $p->exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');
    return $p;
}
function q(string $sql, array $a = []): PDOStatement { $s = db()->prepare($sql); $s->execute($a); return $s; }
function out($d, int $code = 200): never { http_response_code($code); echo json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); exit; }

const PREF0 = ['theme' => 'claro', 'fs' => 22, 'lh' => 1.7, 'ls' => 0.02, 'tts' => 0, 'rate' => 1.0, 'a11y' => 1];
function clean_prefs(array $in): array {
    $p = array_merge(PREF0, array_intersect_key($in, PREF0));
    $p['theme'] = in_array($p['theme'], ['claro', 'noite', 'azul'], true) ? $p['theme'] : 'claro';
    $p['fs'] = max(16, min(48, (float)$p['fs'])); $p['lh'] = max(1.4, min(2.4, (float)$p['lh']));
    $p['ls'] = max(0, min(0.2, (float)$p['ls'])); $p['rate'] = max(0.6, min(1.6, (float)$p['rate'])); $p['tts'] = (int)!!$p['tts']; $p['a11y'] = (int)!!$p['a11y'];
    return $p;
}
function me(): ?array {
    static $u = false;
    if ($u === false) {
        $u = null;
        if (!empty($_SESSION['uid'])) {
            $r = q("SELECT id,name,email,role,prefs,xp FROM users WHERE id=? AND status='ativo'", [$_SESSION['uid']])->fetch();
            if ($r) { $r['prefs'] = clean_prefs(json_decode($r['prefs'] ?: '{}', true) ?: []); $u = $r; }
        }
    }
    return $u;
}
function mktoken(): string { $t = strtoupper(bin2hex(random_bytes(4))); return substr($t, 0, 4) . '-' . substr($t, 4); }

/** Repetição espaçada (variante do SM-2). Notas: 0 errei, 1 difícil, 2 bom, 3 fácil. */
function review(int $uid, int $cid, int $g, int $ts): int {
    $p = q('SELECT * FROM progress WHERE user_id=? AND card_id=?', [$uid, $cid])->fetch() ?: ['ease' => 2.5, 'ivl' => 0, 'reps' => 0, 'lapses' => 0];
    $e = (float)$p['ease']; $iv = (int)$p['ivl']; $r = (int)$p['reps']; $l = (int)$p['lapses'];
    if ($g === 0) { $r = 0; $l++; $e = max(1.3, $e - 0.2); $iv = 0; }
    else {
        if ($g === 1) { $iv = max(1, (int)round(max(1, $iv) * 1.2)); $e = max(1.3, $e - 0.15); }
        elseif ($g === 2) { $iv = $r === 0 ? 1 : ($r === 1 ? 3 : (int)round($iv * $e)); }
        else { $iv = $r === 0 ? 3 : (int)round(max(3, $iv) * $e * 1.3); $e += 0.15; }
        $r++;
    }
    $due = $g === 0 ? $ts + 600 : $ts + $iv * 86400;
    q('INSERT INTO progress(user_id,card_id,ease,ivl,reps,lapses,due) VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(user_id,card_id) DO UPDATE SET ease=excluded.ease,ivl=excluded.ivl,reps=excluded.reps,lapses=excluded.lapses,due=excluded.due', [$uid, $cid, $e, $iv, $r, $l, $due]);
    q('INSERT INTO logs(user_id,card_id,grade,ts) VALUES(?,?,?,?)', [$uid, $cid, $g, $ts]);
    q('UPDATE users SET xp=xp+? WHERE id=?', [[2, 6, 10, 12][$g], $uid]);
    return $iv;
}

function schema(PDO $d): void {
    $d->exec("
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, pass TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'aluno', status TEXT NOT NULL DEFAULT 'ativo', prefs TEXT, created INTEGER, xp INTEGER NOT NULL DEFAULT 0, pkg INTEGER);
CREATE TABLE IF NOT EXISTS packages(id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, goal TEXT, emoji TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS tokens(id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, role TEXT NOT NULL DEFAULT 'aluno', used_by INTEGER, expires INTEGER, created INTEGER);
CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY, name TEXT, email TEXT, msg TEXT, status TEXT DEFAULT 'pendente', token TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS topics(id INTEGER PRIMARY KEY, package_id INTEGER REFERENCES packages(id) ON DELETE CASCADE, title TEXT NOT NULL, law TEXT, emoji TEXT, summary TEXT, mnemonic TEXT, pos INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS visuals(id INTEGER PRIMARY KEY, topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE, emoji TEXT, title TEXT NOT NULL, points TEXT, pitfall TEXT, example TEXT, pos INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS cards(id INTEGER PRIMARY KEY, topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE, q TEXT NOT NULL, a TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS progress(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE, ease REAL DEFAULT 2.5, ivl INTEGER DEFAULT 0, reps INTEGER DEFAULT 0, lapses INTEGER DEFAULT 0, due INTEGER DEFAULT 0, UNIQUE(user_id,card_id));
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY, user_id INTEGER, card_id INTEGER, grade INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY, k TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS plans(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE, deadline INTEGER, hpw REAL NOT NULL DEFAULT 5, start_ts INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ativa', prev_status TEXT, paused_at INTEGER, paused_total INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, UNIQUE(user_id,package_id));
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, msg TEXT, route_id INTEGER, created INTEGER);
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS study_groups(id INTEGER PRIMARY KEY, name TEXT NOT NULL, descr TEXT, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, code TEXT UNIQUE NOT NULL, created INTEGER);
CREATE TABLE IF NOT EXISTS group_members(group_id INTEGER NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT DEFAULT 'membro', joined INTEGER, PRIMARY KEY(group_id,user_id));
CREATE TABLE IF NOT EXISTS route_shares(package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE, group_id INTEGER NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE, PRIMARY KEY(package_id,group_id));
CREATE TABLE IF NOT EXISTS likes(package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(package_id,user_id));
CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY, package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, text TEXT NOT NULL, created INTEGER);
CREATE TABLE IF NOT EXISTS materials(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, author TEXT, kind TEXT DEFAULT 'texto', url TEXT, text TEXT, tags TEXT, pdf TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS media(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT, filename TEXT, mime TEXT, size INTEGER, stored TEXT, status TEXT DEFAULT 'enviando', msg TEXT, progress TEXT, opts TEXT, transcript TEXT, structure TEXT, biblio TEXT, deep TEXT, material_ids TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS deepdives(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE, topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE, card_id INTEGER, kind TEXT, title TEXT, q TEXT, a TEXT, summary TEXT, points TEXT, refs TEXT, material_id INTEGER, created INTEGER);
CREATE TABLE IF NOT EXISTS game_log(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, game TEXT, score INTEGER, xp INTEGER, ts INTEGER);
CREATE INDEX IF NOT EXISTS i_deep ON deepdives(user_id,package_id);
CREATE INDEX IF NOT EXISTS i_logs ON logs(user_id,ts);
CREATE INDEX IF NOT EXISTS i_prog ON progress(user_id,due);
CREATE INDEX IF NOT EXISTS i_att ON attempts(k,ts);");
    $add = ['packages' => ["owner_id INTEGER", "kind TEXT DEFAULT 'sistema'", 'objective TEXT', 'strategy TEXT', 'biblio TEXT', 'sources TEXT', "visibility TEXT DEFAULT 'privada'", 'tags TEXT', 'origin_id INTEGER'], 'jobs' => ['payload TEXT', 'progress TEXT'], 'topics' => ['difficulty INTEGER DEFAULT 3', 'refs TEXT'], 'deepdives' => ['depth INTEGER DEFAULT 1', 'parent_id INTEGER']];
    foreach ($add as $t => $cols) { $have = array_column($d->query("PRAGMA table_info($t)")->fetchAll(), 'name'); foreach ($cols as $c) if (!in_array(strtok($c, ' '), $have, true)) $d->exec("ALTER TABLE $t ADD COLUMN $c"); }
}

function ensure_schema(): void { static $done = false; if ($done) return; $done = true; schema(db()); }
/** Instala um pacote/trilha (objetivo + estratégia + bibliografia + assuntos + cartões + resumos visuais). */
function install_package(array $p, ?int $owner = null, string $kind = 'sistema'): int {
    $slug = preg_replace('/[^a-z0-9-]/', '', strtolower((string)($p['slug'] ?? '')));
    if ($slug === '' && $owner) $slug = 'u' . $owner . '-' . bin2hex(random_bytes(4));
    if ($slug === '' || trim((string)($p['name'] ?? '')) === '' || empty($p['topics']) || !is_array($p['topics'])) throw new RuntimeException('Pacote inválido: informe slug, name e topics.');
    if (q('SELECT 1 FROM packages WHERE slug=?', [$slug])->fetch()) { if ($owner) $slug .= '-' . bin2hex(random_bytes(3)); else throw new RuntimeException('Já existe um pacote com este identificador (slug).'); }
    $j = fn($v) => json_encode($v ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $d = db(); $own = !$d->inTransaction(); if ($own) $d->beginTransaction();
    try {
        q('INSERT INTO packages(slug,name,goal,emoji,created,owner_id,kind,objective,strategy,biblio,sources) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          [$slug, substr((string)$p['name'], 0, 120), substr((string)($p['goal'] ?? ''), 0, 200), substr((string)($p['emoji'] ?? '🎯'), 0, 16), time(), $owner, $kind, substr((string)($p['objective'] ?? ''), 0, 1000), $j($p['strategy'] ?? []), $j($p['biblio'] ?? ($p['bibliography'] ?? [])), $j($p['sources'] ?? [])]);
        $pid = (int)$d->lastInsertId();
        q('UPDATE packages SET tags=?,origin_id=? WHERE id=?', [$j(array_slice(array_map('strval', (array)($p['tags'] ?? [])), 0, 8)), isset($p['origin_id']) ? (int)$p['origin_id'] : null, $pid]);
        foreach ($p['topics'] as $i => $t) {
            if (!is_array($t) || trim((string)($t['title'] ?? '')) === '') throw new RuntimeException('Assunto sem título no pacote.');
            q('INSERT INTO topics(package_id,title,law,emoji,summary,mnemonic,pos,difficulty,refs) VALUES(?,?,?,?,?,?,?,?,?)',
              [$pid, substr((string)$t['title'], 0, 200), substr((string)($t['law'] ?? ''), 0, 300), substr((string)($t['emoji'] ?? '📖'), 0, 16), implode("\n", array_map('strval', (array)($t['summary'] ?? []))), substr((string)($t['mnemonic'] ?? ''), 0, 400), $i, max(1, min(5, (int)($t['difficulty'] ?? 3))), $j($t['refs'] ?? ($t['references'] ?? []))]);
            $tid = (int)$d->lastInsertId();
            foreach ((array)($t['cards'] ?? []) as $c) if (is_array($c) && count($c) >= 2) q('INSERT INTO cards(topic_id,q,a) VALUES(?,?,?)', [$tid, (string)$c[0], (string)$c[1]]);
            foreach ((array)($t['visuals'] ?? []) as $k => $v) q('INSERT INTO visuals(topic_id,emoji,title,points,pitfall,example,pos) VALUES(?,?,?,?,?,?,?)', [$tid, substr((string)($v['emoji'] ?? '💡'), 0, 16), (string)($v['title'] ?? ''), $j(array_map('strval', (array)($v['points'] ?? []))), (string)($v['pitfall'] ?? ''), (string)($v['example'] ?? ''), $k]);
        }
        if ($own) $d->commit();
        return $pid;
    } catch (Throwable $e) { if ($own && $d->inTransaction()) $d->rollBack(); throw $e; }
}
/** Instala os pacotes que acompanham o sistema (pasta pacotes/). */
function seed(PDO $d): void {
    foreach (glob(ROOT . '/pacotes/*.json') ?: [] as $f) { $j = json_decode((string)file_get_contents($f), true); if (is_array($j)) install_package($j); }
}
