<?php
/**
 * Autoinstalador em assistente (5 etapas): servidor, administrador, versões, agentes de IA com contingência e conteúdo.
 * Roda sozinho no primeiro acesso e se tranca ao terminar.
 */
declare(strict_types=1);
require_once __DIR__ . '/inc/lib.php';
require_once __DIR__ . '/inc/trilhas.php';
require_once __DIR__ . '/inc/ia.php';
require_once __DIR__ . '/inc/aulas.php';
if (installed()) { header('Location: ' . base()); exit; }
boot_session();

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
/* escolhe onde guardar o banco: fora da pasta pública, se possível */
function data_dir(): string {
    $outside = dirname(ROOT) . '/' . basename(ROOT) . '_dados';
    if ((is_dir($outside) && is_writable($outside)) || (is_writable(dirname(ROOT)) && @mkdir($outside, 0750))) return $outside;
    return ROOT . '/data';
}
function preset_agents(): array { $f = __DIR__ . '/inc/preconfig.php'; $a = is_file($f) ? (require $f) : []; return is_array($a) ? (array)($a['agents'] ?? []) : []; }
function preset_key(string $id): string { foreach (preset_agents() as $p) if (($p['id'] ?? '') === $id) return (string)$p['key']; return ''; }
function clean_agents($raw): array {
    $o = [];
    foreach (array_slice((array)(is_string($raw) ? json_decode($raw, true) : $raw), 0, 8) as $a) {
        if (!is_array($a)) continue; $type = isset(IA_TYPES[$a['type'] ?? '']) ? $a['type'] : 'openai';
        $o[] = ['id' => 'p' . (count($o) + 1), 'type' => $type, 'label' => substr(trim((string)($a['label'] ?? '')) ?: IA_TYPES[$type], 0, 60), 'key' => (trim((string)($a['key'] ?? '')) ?: (!empty($a['preset']) ? preset_key((string)$a['preset']) : '')), 'model' => substr(trim((string)($a['model'] ?? '')), 0, 80),
            'base_url' => substr(trim((string)($a['base_url'] ?? '')), 0, 200), 'search' => !empty($a['search']), 'enabled' => !empty($a['enabled']), 'role' => in_array($a['role'] ?? '', ['planejador', 'redator'], true) ? $a['role'] : 'qualquer', 'stt' => !empty($a['stt'])];
    }
    return $o;
}
$checks = [['PHP 8.1 ou superior (atual: ' . PHP_VERSION . ')', PHP_VERSION_ID >= 80100], ['Extensão pdo_sqlite (banco de dados)', extension_loaded('pdo_sqlite')], ['Extensão json', function_exists('json_encode')], ['Pasta do sistema com permissão de escrita', is_writable(ROOT)]];
$ready = !in_array(false, array_column($checks, 1), true);
$curl = function_exists('curl_init');
$keyFile = ROOT . '/install.key'; $needKey = is_file($keyFile);

/* teste de um agente (chamado pelo assistente, antes de instalar) */
if (($_GET['do'] ?? '') === 'test') {
    header('Content-Type: application/json; charset=utf-8'); $in = json_decode((string)file_get_contents('php://input'), true) ?: [];
    if (!hash_equals(csrf(), (string)($_SERVER['HTTP_X_CSRF'] ?? ''))) { echo json_encode(['error' => 'Sessão expirada. Recarregue a página.']); exit; }
    if ($needKey && !hash_equals(trim((string)file_get_contents($keyFile)), trim((string)($in['key'] ?? '')))) { echo json_encode(['error' => 'Informe a chave de instalação (etapa 2) antes de testar.']); exit; }
    $p = (array)($in['agent'] ?? []); $p['type'] = isset(IA_TYPES[$p['type'] ?? '']) ? $p['type'] : 'openai'; $p += ['key' => '', 'model' => '', 'base_url' => '', 'search' => false]; if ($p['key'] === '' && !empty($p['preset'])) $p['key'] = preset_key((string)$p['preset']);
    try { $x = ia_call($p, ['system' => 'Responda curto.', 'user' => 'Responda apenas: ok', 'max_tokens' => 20]); echo json_encode(['ok' => 1, 'resp' => substr($x['text'], 0, 60)]); }
    catch (Throwable $e) { echo json_encode(['error' => $e->getMessage()]); }
    exit;
}

$err = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $ready) {
    try {
        if (!hash_equals(csrf(), (string)($_POST['c'] ?? ''))) throw new RuntimeException('Sessão expirada. Recarregue a página.');
        if ($needKey && !hash_equals(trim((string)file_get_contents($keyFile)), trim((string)($_POST['key'] ?? '')))) throw new RuntimeException('Chave de instalação incorreta.');
        $name = trim((string)$_POST['site']) ?: 'Estudo Claro'; $an = trim((string)$_POST['name']); $ae = strtolower(trim((string)$_POST['email'])); $ap = (string)$_POST['pass'];
        if ($an === '' || !filter_var($ae, FILTER_VALIDATE_EMAIL)) throw new RuntimeException('Informe nome e e-mail válidos.');
        if (strlen($ap) < 8) throw new RuntimeException('A senha precisa ter 8 ou mais caracteres.');
        if ($ap !== (string)$_POST['pass2']) throw new RuntimeException('As senhas não conferem.');
        $dir = data_dir();
        if (!is_dir($dir) && !@mkdir($dir, 0750, true)) throw new RuntimeException('Não foi possível criar a pasta de dados.');
        @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
        @file_put_contents($dir . '/web.config', '<?xml version="1.0"?><configuration><system.webServer><authorization><deny users="*"/></authorization></system.webServer></configuration>');
        @file_put_contents($dir . '/index.html', '');
        $d = db($dir . '/app.sqlite'); $d->beginTransaction(); schema($d);
        if (!empty($_POST['seed'])) seed($d);
        $d->prepare('INSERT INTO users(name,email,pass,role,prefs,created) VALUES(?,?,?,?,?,?)')->execute([$an, $ae, password_hash($ap, PASSWORD_DEFAULT), 'admin', '{}', time()]);
        set_setting('editions', in_array($_POST['editions'] ?? '', ['ambas', 'portal', 'acessivel'], true) ? $_POST['editions'] : 'ambas');
        $ag = clean_agents($_POST['agents'] ?? '[]'); set_setting('ia_providers', json_encode($ag, JSON_UNESCAPED_UNICODE)); set_setting('ia_enabled', ($_POST['ia_on'] ?? '1') === '1' ? '1' : '0'); set_setting('ia_limit', (string)max(1, min(50, (int)($_POST['ia_limit'] ?? 3)))); set_setting('ia_health', '{}'); set_setting('media_max_mb', (string)max(10, min(4000, (int)($_POST['media_max_mb'] ?? 500))));
        $d->commit();
        $fh = @fopen(ROOT . '/config.php', 'x');           // 'x' falha se já existir: evita instalação dupla
        if (!$fh) throw new RuntimeException('Não foi possível gravar config.php (ou o sistema já foi instalado).');
        fwrite($fh, "<?php\nreturn " . var_export(['data' => $dir, 'name' => $name, 'installed' => date('c')], true) . ";\n"); fclose($fh);
        if ($needKey) @unlink($keyFile);
        @unlink(__DIR__ . '/inc/preconfig.php');            // as chaves já estão no banco: apaga o arquivo secreto
        header('Location: ' . base()); exit;
    } catch (Throwable $e) {
        if (isset($d) && $d->inTransaction()) $d->rollBack();
        if (isset($dir) && isset($d) && !is_file(ROOT . '/config.php')) { $d = null; @unlink($dir . '/app.sqlite'); @unlink($dir . '/app.sqlite-wal'); @unlink($dir . '/app.sqlite-shm'); }
        $err = $e->getMessage();
    }
}
$v = fn(string $k, string $d = '') => h((string)($_POST[$k] ?? $d));
$preset = array_map(fn($a) => ['preset' => $a['id'], 'hint' => $a['key'] !== '' ? '…' . substr($a['key'], -4) : '', 'type' => $a['type'], 'label' => $a['label'], 'role' => $a['role'] ?? 'qualquer', 'model' => $a['model'] ?? '', 'base_url' => $a['base_url'] ?? '', 'search' => !empty($a['search']), 'enabled' => !empty($a['enabled']), 'stt' => !empty($a['stt']), 'key' => ''], preset_agents());
$agentsData = isset($_POST['agents']) ? (string)$_POST['agents'] : json_encode($preset, JSON_UNESCAPED_UNICODE);
$ed = (string)($_POST['editions'] ?? 'ambas');
?><!doctype html>
<html lang="pt-BR" data-theme="claro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Instalação · Estudo Claro</title><meta name="theme-color" content="#2f8f7b"><link rel="icon" href="assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/app.css"><link rel="stylesheet" href="assets/install.css"><script src="assets/theme.js"></script></head>
<body class="inst">
<main class="wiz" id="wiz" data-csrf="<?= h(csrf()) ?>" data-needkey="<?= $needKey ? '1' : '0' ?>" data-agents="<?= h($agentsData) ?>">
<header class="wiz-head"><img class="logo-big" src="assets/mark.svg" alt=""><div><h1 id="title" tabindex="-1">Instalação do Estudo Claro</h1><p>Este é o primeiro acesso neste servidor. Em 5 passos o sistema cria o banco de dados, o administrador, as versões e os agentes de IA, e depois se tranca.</p></div></header>
<ol class="stepper" aria-label="Etapas da instalação"><li class="on"><span>1</span> Servidor</li><li><span>2</span> Administrador</li><li><span>3</span> Versões</li><li><span>4</span> Agentes de IA</li><li><span>5</span> Concluir</li></ol>
<div class="bar" aria-hidden="true"><i id="wbar"></i></div>
<?php if ($err): ?><div class="msg" role="alert"><?= h($err) ?></div><?php endif; ?>
<form method="post" id="wf" autocomplete="off"><input type="hidden" name="c" value="<?= h(csrf()) ?>"><input type="hidden" name="agents" id="agentsjson" value="[]">

<section class="step on" data-step="1" aria-labelledby="s1"><h2 id="s1" tabindex="-1">1. Verificação do servidor</h2>
<ul class="checks"><?php foreach ($checks as $c): ?><li class="<?= $c[1] ? 'ok' : 'bad' ?>"><span aria-hidden="true"><?= $c[1] ? '✅' : '❌' ?></span> <?= h($c[0]) ?>: <b><?= $c[1] ? 'ok' : 'FALHOU' ?></b></li><?php endforeach; ?>
<li class="<?= ffmpeg_path() ? 'ok' : 'warn' ?>"><span aria-hidden="true"><?= ffmpeg_path() ? '✅' : '⚠️' ?></span> ffmpeg (opcional: reduz o tamanho das aulas em áudio/vídeo e permite arquivos grandes na transcrição): <b><?= ffmpeg_path() ? 'ok' : 'ausente' ?></b></li>
<li class="<?= $curl ? 'ok' : 'warn' ?>"><span aria-hidden="true"><?= $curl ? '✅' : '⚠️' ?></span> Extensão cURL (necessária para os agentes de IA e a leitura de vídeos): <b><?= $curl ? 'ok' : 'ausente' ?></b></li></ul>
<p>Os dados ficarão em: <code><?= h(data_dir()) ?></code></p>
<?php if (!$ready): ?><div class="msg" role="alert">Corrija os itens com ❌ (fale com a hospedagem, se preciso) e recarregue esta página.</div><?php endif; ?></section>

<section class="step" data-step="2" aria-labelledby="s2"><h2 id="s2" tabindex="-1">2. Administrador</h2>
<?php if ($needKey): ?><div class="f"><label for="ikey">Chave de instalação (conteúdo do arquivo install.key)</label><input id="ikey" name="key" required autocomplete="off"></div><?php endif; ?>
<div class="f"><label for="s">Nome da plataforma</label><input id="s" name="site" value="<?= $v('site', 'Estudo Claro') ?>"></div>
<div class="f"><label for="n">Nome do administrador</label><input id="n" name="name" required autocomplete="name" value="<?= $v('name') ?>"></div>
<div class="f"><label for="e">E-mail do administrador</label><input id="e" name="email" type="email" required autocomplete="email" value="<?= $v('email') ?>"></div>
<div class="f"><label for="p">Senha (mínimo 8 caracteres)</label><input id="p" name="pass" type="password" minlength="8" required autocomplete="new-password"></div>
<div class="f"><label for="p2">Repita a senha</label><input id="p2" name="pass2" type="password" minlength="8" required autocomplete="new-password"></div></section>

<section class="step" data-step="3" aria-labelledby="s3"><h2 id="s3" tabindex="-1">3. Versões oferecidas</h2><p>Antes de começar, cada pessoa escolhe a versão que prefere. Você decide o que oferecer.</p>
<div class="opts">
<label class="opt-card"><input type="radio" name="editions" value="ambas" <?= $ed === 'ambas' ? 'checked' : '' ?>><span class="bigico" aria-hidden="true">🔀</span><b>As duas</b><span>Cada pessoa escolhe: portal ou mobile acessível.</span></label>
<label class="opt-card"><input type="radio" name="editions" value="portal" <?= $ed === 'portal' ? 'checked' : '' ?>><span class="bigico" aria-hidden="true">🌐</span><b>Só o portal</b><span>Comunidade de estudo, para computador e tablet.</span></label>
<label class="opt-card"><input type="radio" name="editions" value="acessivel" <?= $ed === 'acessivel' ? 'checked' : '' ?>><span class="bigico" aria-hidden="true">📱</span><b>Só o mobile acessível</b><span>Celular, letras grandes, alto contraste.</span></label></div></section>

<section class="step" data-step="4" aria-labelledby="s4"><h2 id="s4" tabindex="-1">4. Agentes de IA com contingência</h2>
<p>Adicione quantos agentes quiser, em ordem de prioridade. A criação da trilha tem etapas (planejar e escrever); cada agente pode ter um papel, e quando um falha o próximo assume. Você pode pular esta etapa e configurar depois em Administração.</p>
<?php if ($preset): ?><div class="msg" role="status">🔑 Encontrei <?= count($preset) ?> agentes pré-configurados (arquivo inc/preconfig.php). As chaves ficam só no servidor: não aparecem na tela e o arquivo é apagado ao concluir. Teste cada agente antes de instalar.</div><?php endif; ?>
<div class="presets" id="presets" role="group" aria-label="Adicionar agente"></div>
<div id="agents"></div>
<h3>Se um agente falhar, a ordem de socorro é:</h3><div class="chain" id="chain" aria-live="polite"></div>
<div class="grid"><div class="f"><label for="ia_on">IA automática</label><select id="ia_on" name="ia_on"><option value="1">Ligada (se houver agentes)</option><option value="0">Desligada: só modo agente</option></select></div>
<div class="f"><label for="ia_limit">Limite de trilhas por usuário por dia</label><input id="ia_limit" name="ia_limit" type="number" min="1" max="50" value="<?= $v('ia_limit', '3') ?>"></div>
<div class="f"><label for="mmax">Tamanho máximo de cada aula em áudio/vídeo (MB)</label><input id="mmax" name="media_max_mb" type="number" min="10" max="4000" value="<?= $v('media_max_mb', '500') ?>"></div></div></section>

<section class="step" data-step="5" aria-labelledby="s5"><h2 id="s5" tabindex="-1">5. Conteúdo e conclusão</h2>
<div class="f"><label><input type="checkbox" name="seed" value="1" checked> Incluir o pacote de exemplo: Direito Administrativo (11 assuntos, cartões e resumos visuais)</label></div>
<h3>Resumo</h3><dl class="sum" id="summary"></dl></section>

<div class="wiz-nav"><button type="button" id="prev" class="alt" hidden>◀ Voltar</button><button type="button" id="next" <?= $ready ? '' : 'disabled' ?>>Continuar ▶</button><button type="submit" id="go" class="big" hidden <?= $ready ? '' : 'disabled' ?>>🚀 Instalar agora</button></div>
</form></main>
<noscript><style>.wiz .step{display:block!important}.wiz-nav button[type=button]{display:none}.wiz #go{display:inline-flex!important}</style></noscript>
<script src="assets/install.js"></script>
</body></html>
