param([switch]$RecoverStaleLock,[switch]$PreferredSupport,[string]$LineKey,[switch]$OpenPanel)
$ErrorActionPreference='Stop'
$taskRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$privateRoot=Join-Path $taskRoot 'output/multichannel-private/whatsapp-session'
$config=Get-Content -LiteralPath (Join-Path $privateRoot 'worker-config.json') -Raw | ConvertFrom-Json
$effectiveLine=if($LineKey){$LineKey}else{$config.lineKey}
if($PreferredSupport){
  $routing=Get-Content -LiteralPath (Join-Path $privateRoot 'support-routing-order.json') -Raw | ConvertFrom-Json
  if($routing.accountId -ne $config.accountId -or !$routing.lineOrder -or $routing.lineOrder.Count -lt 1){throw 'No hay una línea de soporte confirmada para esta cuenta.'}
  $effectiveLine=$routing.lineOrder[0]
}
function Open-PrivatePanel($access){
  $localUri=[Uri]$access.url
  if($localUri.Scheme -ne 'http' -or $localUri.Host -ne '127.0.0.1' -or $localUri.Port -ne 8788){throw 'Panel local no reconocido.'}
  Start-Process -FilePath $access.url
}
$nodePath=(Get-Command node -ErrorAction Stop).Source
Push-Location $taskRoot
try {
  $taskScope=(& $nodePath --input-type=module -e 'import{sessionScope}from"./scripts/multichannel/whatsapp-session/store.mjs";console.log(sessionScope(process.argv[1],process.argv[2]));' $config.accountId $effectiveLine).Trim()
  if($LASTEXITCODE -ne 0 -or $taskScope -notmatch '^[a-f0-9]{64}$'){throw 'Cuenta o línea inválida.'}
  $scopeDir=Join-Path $privateRoot $taskScope
  $accessPath=Join-Path $scopeDir 'panel-access.json'
  $panel=$null
  if(Test-Path -LiteralPath $accessPath){
    $panel=Get-Content -LiteralPath $accessPath -Raw | ConvertFrom-Json
    $localUri=[Uri]$panel.origin
    if($localUri.Scheme -ne 'http' -or $localUri.Host -ne '127.0.0.1'){throw 'Dirección local inválida.'}
    try{
      $status=Invoke-RestMethod -Uri ($panel.origin+'/api/status') -Headers @{Authorization=('Bearer '+$panel.token)} -TimeoutSec 3
      if($status.accountId -eq $config.accountId -and $status.lineKey -eq $effectiveLine){if($OpenPanel){Open-PrivatePanel $panel};Write-Output 'El ejecutor local ya está activo.';exit 0}
    }catch{ }
    $previousPid=[int]$panel.pid
    $previousProcess=Get-CimInstance Win32_Process -Filter "ProcessId = $previousPid" -ErrorAction SilentlyContinue
    $cliPath=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'cli.mjs'))
    # Windows can reuse a stale PID for an unrelated Node process. Block only
    # when the live command line is this worker; the exact profile-browser
    # check below remains mandatory before releasing the lock.
    if($previousProcess -and $previousProcess.Name -ieq 'node.exe' -and
       $previousProcess.CommandLine -and $previousProcess.CommandLine.IndexOf($cliPath,[System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
       $previousProcess.CommandLine -match '(?i)\bconnect\b'){
      throw 'El proceso anterior todavía existe. Comprueba su estado antes de iniciar otra copia.'
    }
  }
  $lockPath=[System.IO.Path]::GetFullPath((Join-Path $scopeDir 'worker.lock'))
  if(Test-Path -LiteralPath $lockPath){
    if(!$RecoverStaleLock -or !$panel){throw 'El bloqueo anterior requiere revisión. No se ha borrado el perfil.'}
    $selected=Get-Content -LiteralPath (Join-Path $scopeDir 'profile-path.json') -Raw | ConvertFrom-Json
    if($selected.scope -ne $taskScope -or $selected.layout -notin @('short','legacy')){throw 'Perfil sin dueño confirmado.'}
    $profilePath=if($selected.layout -eq 'short'){Join-Path $privateRoot ('profiles/'+$taskScope.Substring(0,24))}else{Join-Path $scopeDir 'auth'}
    if((Get-Content -LiteralPath (Join-Path $profilePath 'scope.txt') -Raw) -ne $taskScope){throw 'Perfil de otra cuenta.'}
    $profileMatch=$profilePath.Replace('\','/').ToLowerInvariant()
    $activeBrowsers=Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -and $_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($profileMatch) }
    if($activeBrowsers){throw 'El navegador de esa sesión sigue abierto. Se conserva el bloqueo.'}
    $allowedRoot=[System.IO.Path]::GetFullPath($privateRoot).TrimEnd('\','/')+[System.IO.Path]::DirectorySeparatorChar
    if(!$lockPath.StartsWith($allowedRoot,[System.StringComparison]::OrdinalIgnoreCase)){throw 'Bloqueo fuera de la carpeta autorizada.'}
    Remove-Item -LiteralPath $lockPath
  }
  if(!(Test-Path -LiteralPath $scopeDir)){New-Item -ItemType Directory -Path $scopeDir -Force | Out-Null}
  $cliPath=Join-Path $PSScriptRoot 'cli.mjs'
  $arguments='"'+$cliPath+'" connect --account '+$config.accountId+' --line '+$effectiveLine
  $worker=Start-Process -FilePath $nodePath -ArgumentList $arguments -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $scopeDir 'worker.stdout.log') -RedirectStandardError (Join-Path $scopeDir 'worker.stderr.log') -PassThru
  Write-Output ('Ejecutor local iniciado. PID: '+$worker.Id+'. Consulta los permisos de envio en el panel.')
  if($OpenPanel){
    $opened=$false
    for($attempt=0;$attempt -lt 30;$attempt++){
      Start-Sleep -Milliseconds 500
      if(Test-Path -LiteralPath $accessPath){
        $next=Get-Content -LiteralPath $accessPath -Raw | ConvertFrom-Json
        if([int]$next.pid -eq $worker.Id){Open-PrivatePanel $next;$opened=$true;break}
      }
    }
    if(!$opened){Write-Output 'El panel aún está arrancando. Vuelve a abrir el acceso en unos segundos; no escanees ni borres el perfil.'}
  }
} finally {Pop-Location}
