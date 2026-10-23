<#
.SYNOPSIS
    Instala o LeadsCaps na VPS, do começo ao fim, a partir do Windows.

.DESCRIPTION
    Confere o DNS, testa o SSH, roda o instalador na VPS (Docker, código,
    .env com segredos gerados, containers, verificação) e cria o usuário
    administrador. Pode ser executado mais de uma vez com segurança:
    segredos já preenchidos não são trocados.

.EXAMPLE
    .\instalar.ps1
#>

param(
    [string]$Servidor = "root@177.153.38.233",
    [string]$Caminho  = "/opt/leadscaps-v01",
    [string]$Dominio  = "leads-api.synapseia.com.br",
    [string]$Repo     = "https://github.com/car2019sjc/leadscaps-v01.git"
)

$ErrorActionPreference = "Stop"

function Escrever([string]$t, [string]$c = "White") { Write-Host $t -ForegroundColor $c }
function Titulo([string]$t) { Escrever ""; Escrever "  $t" "Cyan" }

function RodarNaVps([string]$bash) {
    # base64 evita qualquer problema de aspas entre PowerShell, SSH e o shell remoto
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($bash))
    ssh $Servidor "echo $b64 | base64 -d | bash"
    return $LASTEXITCODE
}

Escrever ""
Escrever "  ╭────────────────────────────────────────╮" "Cyan"
Escrever "  │  LeadsCaps · instalacao automatica     │" "Cyan"
Escrever "  ╰────────────────────────────────────────╯" "Cyan"
Escrever "  Servidor: $Servidor" "DarkGray"
Escrever "  Dominio : $Dominio" "DarkGray"

# ─── 1. DNS ──────────────────────────────────────────────────
Titulo "1/4  Conferindo o DNS"
try {
    $ip = (Resolve-DnsName $Dominio -Type A -ErrorAction Stop |
           Where-Object { $_.IPAddress } | Select-Object -First 1).IPAddress
    $ipVps = ($Servidor -split '@')[-1]
    if ($ip -eq $ipVps) {
        Escrever "  OK  $Dominio aponta para $ip" "Green"
    } else {
        Escrever "  !   $Dominio aponta para $ip, mas a VPS e $ipVps" "Yellow"
        Escrever "      O certificado HTTPS so sera emitido quando apontar para a VPS." "Yellow"
        $c = Read-Host "      Continuar mesmo assim? (s/N)"
        if ($c -ne "s" -and $c -ne "S") { exit 0 }
    }
} catch {
    Escrever "  !   $Dominio ainda nao resolve." "Yellow"
    Escrever "      Crie um registro A apontando para $(($Servidor -split '@')[-1])." "Yellow"
    $c = Read-Host "      Continuar mesmo assim? (s/N)"
    if ($c -ne "s" -and $c -ne "S") { exit 0 }
}

# ─── 2. SSH ──────────────────────────────────────────────────
Titulo "2/4  Testando o acesso SSH"
Escrever "  Se pedir senha, digite — ela nao aparece na tela." "DarkGray"
ssh -o ConnectTimeout=15 $Servidor "echo conectado" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Escrever "  X   Nao consegui conectar em $Servidor" "Red"
    Escrever "      Confira se a VPS esta no ar e se o endereco esta correto." "Yellow"
    exit 1
}
Escrever "  OK  conexao estabelecida" "Green"

# ─── 3. instalação ───────────────────────────────────────────
Titulo "3/4  Instalando na VPS"
Escrever "  Docker, codigo, .env, containers. Leva alguns minutos." "DarkGray"
Escrever ""

$bash = @"
set -e
command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git; }
if [ -d "$Caminho/.git" ]; then
  git -C "$Caminho" pull --ff-only || true
else
  git clone -q "$Repo" "$Caminho"
fi
bash "$Caminho/scripts/instalar.sh" --dir "$Caminho"
"@

$codigo = RodarNaVps $bash
if ($codigo -ne 0) {
    Escrever ""
    Escrever "  X   A instalacao falhou (codigo $codigo)." "Red"
    Escrever "      Veja o que houve:" "Yellow"
    Escrever "      ssh $Servidor 'cd $Caminho/infra && docker compose logs api --tail 40'" "DarkGray"
    exit 1
}

# ─── 4. usuário ──────────────────────────────────────────────
Titulo "4/4  Usuario administrador"

$temUsuario = ssh $Servidor "cd $Caminho/infra && docker compose --env-file ../.env exec -T db psql -U leadscaps -d leadscaps -tAc 'SELECT count(*) FROM usuario' 2>/dev/null || echo 0"
if ($temUsuario -match '^\s*[1-9]') {
    Escrever "  OK  ja existe usuario cadastrado — nada a fazer" "Green"
} else {
    $email = Read-Host "  E-mail"
    $nome  = Read-Host "  Nome completo"
    $s1 = Read-Host "  Senha (minimo 12 caracteres)" -AsSecureString
    $s2 = Read-Host "  Repita a senha" -AsSecureString

    $p1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
    $p2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))

    if ($p1 -ne $p2)        { Escrever "  X   As senhas nao conferem." "Red"; exit 1 }
    if ($p1.Length -lt 12)  { Escrever "  X   Senha curta demais." "Red"; exit 1 }
    if ($p1.Contains("'"))  { Escrever "  X   Nao use aspas simples na senha." "Red"; exit 1 }

    # a senha vai pelo stdin, nunca como argumento: argumento apareceria
    # no historico do shell e na lista de processos da VPS
    $criar = @"
cd $Caminho/infra
printf '%s\n' '$p1' | docker compose --env-file ../.env exec -T api \
  node src/criar-usuario.js --email '$email' --nome '$nome' --papel admin
"@
    if ((RodarNaVps $criar) -eq 0) { Escrever "  OK  usuario criado" "Green" }
    else { Escrever "  !   nao consegui criar o usuario; crie manualmente na VPS" "Yellow" }
}

# ─── fim ─────────────────────────────────────────────────────
Escrever ""
Escrever "  Verificando o endereco publico..." "DarkGray"
try {
    $r = Invoke-RestMethod -Uri "https://$Dominio/api/saude" -TimeoutSec 20
    Escrever ""
    Escrever "  PRONTO — API no ar em https://$Dominio/api" "Green"
    Escrever "  status: $($r.status) | banco: $($r.banco) | versao: $($r.versao)" "Green"
} catch {
    Escrever ""
    Escrever "  A API subiu, mas o HTTPS ainda nao responde." "Yellow"
    Escrever "  O Caddy pode estar emitindo o certificado — aguarde 2 minutos e rode:" "Yellow"
    Escrever "    curl https://$Dominio/api/saude" "DarkGray"
}
Escrever ""
Escrever "  Comandos uteis:" "White"
Escrever "    ssh $Servidor 'cd $Caminho/infra && docker compose ps'" "DarkGray"
Escrever "    ssh $Servidor 'cd $Caminho/infra && docker compose logs -f api'" "DarkGray"
Escrever ""
