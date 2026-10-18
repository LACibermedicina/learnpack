#!/usr/bin/env bash
# Roteiro de fumaça contra um servidor PHP real.  Uso:
#   BASE=http://localhost:8080 ADMIN_EMAIL=admin@exemplo.com ADMIN_PASS='senha' bash tests/fumaca.sh
# (instale antes pelo assistente: php -S localhost:8080 -t .  e abra o endereço no navegador)
set -u
cd "$(dirname "$0")/.."
BASE="${BASE:-http://localhost:8080}"; CJ="$(mktemp)"; FAIL=0
ok(){ echo "  ok   $1"; }; bad(){ echo "  FALHA $1"; FAIL=1; }
echo "1) Sintaxe (php -l)"
for f in api.php install.php index.php portal.php acessivel.php inc/*.php; do
  php -l "$f" >/dev/null 2>&1 && ok "$f" || { bad "$f"; php -l "$f"; }
done
j(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)" 2>/dev/null; }
echo "2) API"
CSRF=$(curl -s -c "$CJ" -b "$CJ" "$BASE/api.php?r=boot" | j "['csrf']"); [ -n "$CSRF" ] && ok "boot devolve csrf" || bad "boot"
post(){ curl -s -c "$CJ" -b "$CJ" -H "X-CSRF: $CSRF" -H 'Content-Type: application/json' -d "$2" "$BASE/api.php?r=$1"; }
get(){ curl -s -c "$CJ" -b "$CJ" "$BASE/api.php?r=$1"; }
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST -d '{}' "$BASE/api.php?r=login")" = "419" ] && ok "POST sem CSRF dá 419" || bad "CSRF não exigido"
R=$(post login "{\"email\":\"${ADMIN_EMAIL:-}\",\"pass\":\"${ADMIN_PASS:-}\"}"); echo "$R" | grep -q '"user"' && ok "login do administrador" || bad "login: $R"
for r in stats routes topics queue a_users a_tokens a_ia a_game a_pkgs a_dels media_list materials groups explore; do
  C=$(curl -s -o /dev/null -w '%{http_code}' -c "$CJ" -b "$CJ" "$BASE/api.php?r=$r"); [ "$C" = "200" ] && ok "GET $r" || bad "GET $r -> $C"
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api.php?r=a_users")" = "401" ] && ok "rota admin sem sessão dá 401" || bad "a_users sem sessão"
post logout '{}' >/dev/null; rm -f "$CJ"
[ $FAIL = 0 ] && echo "TUDO OK" || { echo "HÁ FALHAS"; exit 1; }
