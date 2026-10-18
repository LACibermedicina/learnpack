<?php
declare(strict_types=1);
/* Porta de entrada: antes de começar, a pessoa escolhe entre o PORTAL (comunidade) e o MOBILE ACESSÍVEL.
   A escolha fica guardada (cookie) e as próximas visitas vão direto à versão escolhida. ?trocar=1 mostra a escolha de novo. */
require __DIR__ . '/inc/lib.php';
require __DIR__ . '/inc/shell.php';
if (installed()) {
    require_once __DIR__ . '/inc/trilhas.php'; ensure_schema();
    $v = isset($_GET['trocar']) ? '' : (string)($_GET['v'] ?? ($_COOKIE['ed'] ?? ''));
    if (in_array($v, ['portal', 'acessivel'], true)) {
        if (isset($_GET['v'])) setcookie('ed', $v, ['expires' => time() + 31536000, 'path' => base(), 'samesite' => 'Lax']);
        header('Location: ' . $v . '.php'); exit;
    }
}
render_page('escolha');
