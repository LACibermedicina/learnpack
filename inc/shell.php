<?php
declare(strict_types=1);
/** Casca HTML única para as duas versões: 'acessivel' (alto contraste, letras grandes) e 'portal' (comunidade de estudo). */
function render_page(string $edition): void {
    if (!installed()) { require dirname(__DIR__) . '/install.php'; exit; }
    require_once __DIR__ . '/trilhas.php'; ensure_schema();
    $allowed = (string)setting('editions', 'ambas');          // o administrador pode oferecer só uma das versões
    if ($allowed !== 'ambas' && $edition !== $allowed) { header('Location: ' . $allowed . '.php'); exit; }
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: same-origin'); header('X-Frame-Options: DENY');
    if (is_https()) header('Strict-Transport-Security: max-age=31536000');
    $name = htmlspecialchars((string)(cfg('name') ?: 'LearnPack'), ENT_QUOTES, 'UTF-8'); $cls = ['portal' => 'portal', 'acessivel' => 'acc'][$edition] ?? '';
    ?><!doctype html>
<html lang="pt-BR" data-theme="claro">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title><?= $name ?></title><meta name="description" content="Estudo e revisão com trilhas de aprendizagem, comunidade e IA.">
<meta name="theme-color" content="#2f8f7b"><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="assets/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="assets/icon.svg">
<link rel="stylesheet" href="assets/app.css"><link rel="stylesheet" href="assets/portal.css"><link rel="stylesheet" href="assets/std.css"><script src="assets/theme.js"></script></head>
<body class="<?= $cls ?>">
<a class="skip" href="#c">Pular para o conteúdo</a>
<header><div class="in">
 <a class="brandlink" href="#/" aria-label="<?= $name ?>, início"><img class="logo" src="assets/mark.svg" alt="" width="46" height="37"><strong class="brand"><?= $name ?></strong></a>
 <form id="search" role="search"><input id="q" type="search" placeholder="Buscar trilhas, temas e técnicas…" aria-label="Buscar na comunidade"><button type="submit" aria-label="Buscar">🔍</button></form>
 <button id="a11ytoggle" class="alt" type="button" aria-expanded="true" aria-controls="a11y">♿ Acessibilidade</button>
 <div class="tools" id="a11y" role="group" aria-label="Ajustes de leitura">
  <button class="alt" type="button" data-act="fs-" aria-label="Diminuir letra">A−</button>
  <button class="alt" type="button" data-act="fs+" aria-label="Aumentar letra">A+</button>
  <button class="alt" type="button" data-act="theme" aria-label="Trocar contraste">Contraste</button>
  <button class="alt" type="button" data-act="read" aria-label="Ouvir esta página">Ouvir</button>
  <button class="alt" type="button" data-act="pause" aria-label="Pausar a leitura" aria-pressed="false" disabled>⏸ Pausar</button>
  <button class="alt" type="button" data-act="stop" aria-label="Parar leitura">Parar</button>
  <button class="alt" type="button" data-act="auto" aria-pressed="false" aria-label="Ler cada item ao focar">Ler ao focar</button>
 </div>
 <div id="hud" aria-label="Pontos e nível"></div>
</div></header>
<div class="shell"><nav id="nav" aria-label="Principal"></nav>
<main id="c" tabindex="-1"><div id="live" role="status" aria-live="polite"></div><div id="view"><p>Carregando…</p></div></main></div>
<noscript><p>Esta plataforma precisa de JavaScript ativado.</p></noscript>
<script type="module" src="assets/app.js"></script>
</body></html>
<?php
}
