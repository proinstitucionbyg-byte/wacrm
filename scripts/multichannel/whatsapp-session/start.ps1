param([switch]$RecoverStaleLock)
$ErrorActionPreference='Stop'
$taskRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$privateRoot=Join-Path $taskRoot 'output/multichannel-private/whatsapp-session'
$config=Get-Content -LiteralPath (Join-Path $privateRoot 'worker-config.json') -Raw | ConvertFrom-Json
$nodePath=(Get-Command node -ErrorAction Stop).Source
Push-Location $taskRoot
try {
  $taskScope=(& $nodePath --input-type=module -e 'import{sessionScope}from"./scripts/multichannel/whatsapp-session/store.mjs";console.log(sessionScope(process.argv[1],process.argv[2]));' $config.accountId $config.lineKey).Trim()
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
      if($status.accountId -eq $config.accountId -and $status.lineKey -eq $config.lineKey){Write-Output 'El ejecutor local ya está activo.';exit 0}
    }catch{ }
    $previousPid=[int]$panel.pid
    # If Windows reused the old worker PID for this PowerShell recovery process,
    # Get-Process would match this script itself. The profile-specific browser
    # check below remains mandatory before releasing the lock.
    if($previousPid -ne $PID -and (Get-Process -Id $previousPid -ErrorAction SilentlyContinue)){throw 'El proceso anterior todavía existe. Comprueba su estado antes de iniciar otra copia.'}
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
  $arguments='"'+$cliPath+'" connect'
  $worker=Start-Process -FilePath $nodePath -ArgumentList $arguments -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $scopeDir 'worker.stdout.log') -RedirectStandardError (Join-Path $scopeDir 'worker.stderr.log') -PassThru
  Write-Output ('Ejecutor local iniciado. PID: '+$worker.Id+'. Envios desactivados.')
} finally {Pop-Location}
