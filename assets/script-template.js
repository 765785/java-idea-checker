(function (root) {
  'use strict';
  const common = String.raw`
$script:Issues = New-Object 'System.Collections.Generic.List[object]'
function Protect-Text([string]$Text) {
  if ($env:USERPROFILE) { $Text = [regex]::Replace($Text, [regex]::Escape($env:USERPROFILE), '%USERPROFILE%', 'IgnoreCase') }
  return [regex]::Replace($Text, '[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})', { param($m) $m.Value.Substring(0,1) + '***@' + $m.Groups[1].Value })
}
function Record-Issue([string]$Field, $Problem) {
  $message = Protect-Text ([string]$Problem)
  $script:Issues.Add([pscustomobject]@{ field=$Field; error=$message })
  if ($script:LogFile) { try { Add-Content -LiteralPath $script:LogFile -Value ($Field + ': ' + $message) -Encoding UTF8 -ErrorAction Stop } catch {} }
}
function Invoke-Section([string]$Field,[scriptblock]$Action,$Fallback) {
  try { return & $Action } catch { Record-Issue $Field $_; return $Fallback }
}
function Invoke-Captured([string]$File, [string[]]$Arguments) {
  $oldEncoding = $null; $oldOutput = $OutputEncoding; $oldPreference = $ErrorActionPreference
  try {
    try { $oldEncoding = [Console]::OutputEncoding; [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); $OutputEncoding = [Console]::OutputEncoding } catch { Record-Issue 'encoding' $_ }
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = $null
    $lines = @(& $File @Arguments 2>&1)
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = -1 }
    return [pscustomobject]@{ output=(($lines | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine); exitCode=$code }
  } catch { Record-Issue $File $_; return [pscustomobject]@{ output=[string]$_; exitCode=-1 } }
  finally { $ErrorActionPreference=$oldPreference; $OutputEncoding=$oldOutput; if ($oldEncoding) { try { [Console]::OutputEncoding=$oldEncoding } catch { Record-Issue 'encoding.restore' $_ } } }
}
function Initialize-Native {
  if ('JavaCheckNative' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class JavaCheckNative {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern uint GetLongPathName(string path, StringBuilder buffer, uint size);
 [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, UIntPtr wp, string lp, uint flags, uint timeout, out UIntPtr result);
}
'@ -ErrorAction Stop
}
function Normalize-Directory([string]$Value, [switch]$StripBin) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  try {
    $v=$Value.Trim(); if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) { $v=$v.Substring(1,$v.Length-2) }
    $v=[Environment]::ExpandEnvironmentVariables($v.Replace('/','\'))
    if ($v -notmatch '^(?:[a-zA-Z]:\\|\\\\)') { throw '路径不是绝对目录' }
    $v=[IO.Path]::GetFullPath($v)
    if ($StripBin) { $v=$v.TrimEnd('\'); if ($v -match '\\bin$') { $v=Split-Path -Parent $v } }
    if (Test-Path -LiteralPath $v) {
      Initialize-Native
      $buffer=New-Object Text.StringBuilder 32768
      $length=[JavaCheckNative]::GetLongPathName($v,$buffer,32768)
      if ($length -eq 0 -or $length -ge 32768) { throw '无法确认目录的长路径，不能比较短名' }
      $v=$buffer.ToString()
    }
    if ($v.Length -gt ([IO.Path]::GetPathRoot($v)).Length) { $v=$v.TrimEnd('\') }
    return $v.ToLowerInvariant()
  } catch { Record-Issue 'path.normalize' $_; return $null }
}
function Is-Forwarder([string]$Path) { return $Path -match '(?i)\\(?:System32|SysWOW64|WindowsApps)(?:\\|$)|\\Common Files\\Oracle\\Java\\javapath(?:\\|$)' }
function Get-Major([string]$Text) { if ($Text -match '(?:version\s+"?|javac\s+|openjdk\s+)(1\.)?(\d+)') { return [int]$Matches[2] }; return 0 }
function Read-EnvironmentValue([string]$Scope,[string]$Name) {
  $key=$null
  try {
    if ($Scope -eq 'User') { $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment') } else { $key=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Control\Session Manager\Environment') }
    $exists=$key -and ($key.GetValueNames() -contains $Name)
    if (!$exists) { return [pscustomobject]@{ exists=$false; value=$null; kind=$null; error=$null } }
    return [pscustomobject]@{ exists=$true; value=$key.GetValue($Name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); kind=$key.GetValueKind($Name).ToString(); error=$null }
  } catch { Record-Issue ('registry.'+$Scope+'.'+$Name) $_; return [pscustomobject]@{ exists=$null; value=$null; kind=$null; error=[string]$_ } }
  finally { if ($key) { $key.Dispose() } }
}
function Get-EnvironmentSnapshot {
  return [pscustomobject]@{ user=[pscustomobject]@{ JAVA_HOME=(Read-EnvironmentValue User JAVA_HOME); Path=(Read-EnvironmentValue User Path) }; machine=[pscustomobject]@{ JAVA_HOME=(Read-EnvironmentValue Machine JAVA_HOME); Path=(Read-EnvironmentValue Machine Path) } }
}
function Get-EffectiveHome($Snapshot) { if (![string]::IsNullOrWhiteSpace($Snapshot.user.JAVA_HOME.value)) { return [string]$Snapshot.user.JAVA_HOME.value }; return [string]$Snapshot.machine.JAVA_HOME.value }
function Get-Where([string]$Name) { $r=Invoke-Captured (Join-Path $env:SystemRoot 'System32\where.exe') @($Name); if ($r.exitCode -eq 0) { return @($r.output -split '\r?\n' | Where-Object { $_ -match '^[a-zA-Z]:\\' }) }; return @() }
function Probe-Jdk([string]$Directory,[string]$Source) {
  $path=Normalize-Directory $Directory -StripBin
  $result=[ordered]@{ path=$path; source=$Source; valid=$false; major=0; version=''; error=$null }
  if (!$path) { if (![string]::IsNullOrWhiteSpace($Directory)) { $result.error='目录无法归一化' }; return [pscustomobject]$result }
  try {
    if (!(Test-Path -LiteralPath (Join-Path $path 'bin\java.exe')) -or !(Test-Path -LiteralPath (Join-Path $path 'bin\javac.exe'))) { return [pscustomobject]$result }
    $j=Invoke-Captured (Join-Path $path 'bin\java.exe') @('-version'); $c=Invoke-Captured (Join-Path $path 'bin\javac.exe') @('-version')
    $result.major=Get-Major $c.output; $result.version=$c.output
    $result.valid=$j.exitCode -eq 0 -and $c.exitCode -eq 0 -and $result.major -gt 0 -and (Get-Major $j.output) -eq $result.major
  } catch { $result.error=[string]$_; Record-Issue 'jdk.probe' $_ }
  return [pscustomobject]$result
}
function Get-UninstallEntries {
  foreach ($rootKey in @('HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    try { if (Test-Path $rootKey) { Get-ItemProperty ($rootKey+'\*') -ErrorAction Stop | Where-Object { $_.DisplayName -match 'Java|JDK|Temurin|IntelliJ|JetBrains' } } } catch { Record-Issue 'uninstall' $_ }
  }
}
function Find-Jdks($Snapshot,$WhereJavac) {
  $locations=New-Object 'System.Collections.Generic.List[object]'
  $effective=Get-EffectiveHome $Snapshot
  if ($effective) { $locations.Add(@{path=$effective;source='JAVA_HOME'}) }
  foreach ($value in @($Snapshot.user.JAVA_HOME.value,$Snapshot.machine.JAVA_HOME.value)) { if ($value) { $locations.Add(@{path=$value;source='registry-home'}); if ($value -match '\\jre[\\/]?$') { $locations.Add(@{path=(Split-Path -Parent $value.TrimEnd('\'));source='JAVA_HOME.parent'}) } } }
  foreach ($item in $WhereJavac) { if (!(Is-Forwarder $item)) { $locations.Add(@{path=(Split-Path -Parent (Split-Path -Parent $item));source='where'}) } }
  foreach ($entry in @(Get-UninstallEntries)) { if ($entry.DisplayName -match 'JDK|Java.*Development' -and $entry.InstallLocation) { $locations.Add(@{path=$entry.InstallLocation;source='registry'}) } }
  foreach ($base in @((Join-Path $env:USERPROFILE '.jdks'),(Join-Path $env:ProgramFiles 'Java'),(Join-Path $env:ProgramFiles 'Eclipse Adoptium'),(Join-Path $env:ProgramFiles 'Microsoft'), 'C:\Java','D:\Java','C:\JavaDev','D:\JavaDev')) {
    try { if (Test-Path -LiteralPath $base) { foreach ($dir in @(Get-ChildItem -LiteralPath $base -Directory -ErrorAction Stop)) { $source='directory'; if ($base -like '*.jdks') { $source='.jdks' }; $locations.Add(@{path=$dir.FullName;source=$source}) } } } catch { Record-Issue 'jdk.directories' $_ }
  }
  $seen=@{}; $found=@()
  foreach ($location in $locations) { $key=Normalize-Directory $location.path -StripBin; if ($key -and !$seen.ContainsKey($key)) { $seen[$key]=$true; $found+=Probe-Jdk $key $location.source } }
  return @($found)
}
function Select-Jdk($Candidates) {
  $valid=@($Candidates | Where-Object { $_.valid })
  foreach ($source in @('JAVA_HOME','where','.jdks')) { $items=@($valid | Where-Object { $_.source -eq $source } | Sort-Object @{Expression='major';Descending=$true},path); if ($items.Count) { return $items[0] } }
  return $valid | Sort-Object @{Expression='major';Descending=$true},path | Select-Object -First 1
}
function Runtime-Evidence($Settings,$WhereJavac) {
  $runtime=$null; $compiler=$null
  if ($Settings.output -match '(?m)^\s*java\.home\s*=\s*(.+)$') {
    $runtime=Normalize-Directory $Matches[1].Trim()
    if ($runtime -match '\\jre$') { $parent=Probe-Jdk (Split-Path -Parent $runtime) 'runtime'; if ($parent.valid) { $runtime=$parent.path } }
  }
  foreach ($path in $WhereJavac) { if (!(Is-Forwarder $path)) { $compiler=Normalize-Directory (Split-Path -Parent (Split-Path -Parent $path)); break } }
  return [pscustomobject]@{ runtime=$runtime; compiler=$compiler }
}
function Compare-Path($A,$B) { if (!$A -or !$B) { return $null }; return $A -eq $B }
`;
  const collector = String.raw`
function Get-EmailEvidence([string]$Email) {
  $roots=New-Object 'System.Collections.Generic.List[string]'
  foreach ($base in @((Join-Path $env:APPDATA 'JetBrains'),$env:USERPROFILE)) {
    try { if (Test-Path -LiteralPath $base) { foreach ($d in @(Get-ChildItem -LiteralPath $base -Directory -ErrorAction Stop | Where-Object { $_.Name -match '^\.?IntelliJIdea|^IdeaIC' })) { $roots.Add($d.FullName) } } } catch { Record-Issue 'email.roots' $_ }
  }
  $toolbox=Join-Path $env:LOCALAPPDATA 'JetBrains\Toolbox'; if (Test-Path -LiteralPath $toolbox) { $roots.Add($toolbox) }
  $evidence=New-Object 'System.Collections.Generic.List[object]'; $seen=@{}; $count=0; $truncated=$false; $exact=$false; $domainHit=$false; $other=$false
  $domain=''; if ($Email -match '@(.+)$') { $domain=$Matches[1].ToLowerInvariant() }
  foreach ($scanRoot in @($roots | Select-Object -Unique)) {
    $stack=New-Object 'System.Collections.Generic.Stack[string]'; $stack.Push($scanRoot)
    while ($stack.Count -gt 0) {
      $dir=$stack.Pop()
      try { $items=@(Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop | Sort-Object @{Expression={ if ($_.Name -eq 'other.xml') {0} elseif ($_.Name -eq 'options') {1} else {2} }},Name) } catch { Record-Issue 'email.readDirectory' $_; continue }
      foreach ($file in $items) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        if ($file.PSIsContainer) { if ($file.Name -notmatch '^(log|logs|cache|caches|index|tmp)$') { $stack.Push($file.FullName) }; continue }
        if ($file.Extension -notmatch '^\.(xml|txt|json|properties)$' -or $file.Length -gt 5MB -or $seen.ContainsKey($file.FullName)) { continue }
        if ($count -ge 3000) { $truncated=$true; break }
        $seen[$file.FullName]=$true; $count++
        try { $body=Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 -ErrorAction Stop } catch { Record-Issue 'email.readFile' $_; continue }
        if ([string]::IsNullOrEmpty($body)) { continue }
        foreach ($match in [regex]::Matches([string]$body,'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')) {
          $tier='OTHER_EMAIL'; $other=$true
          if ($Email -and $match.Value -ieq $Email) { $tier='EMAIL_EXACT'; $exact=$true } elseif ($domain -and $match.Value.Split('@')[-1] -ieq $domain) { $tier='DOMAIN_ONLY'; $domainHit=$true }
          $evidence.Add([pscustomobject]@{ tier=$tier; file=($scanRoot.Split('\')[-1]+'\'+$file.FullName.Substring($scanRoot.Length).TrimStart('\')); email=(Protect-Text $match.Value) })
        }
        if ($domain -and $body -match ('(?i)(?<![\w.-])'+[regex]::Escape($domain)+'(?![\w.-])')) { $domainHit=$true; if ($evidence.Count -eq 0) { $evidence.Add([pscustomobject]@{ tier='DOMAIN_ONLY';file=($scanRoot.Split('\')[-1]+'\'+$file.FullName.Substring($scanRoot.Length).TrimStart('\'));email=('***@'+$domain) }) } }
      }
      if ($truncated) { break }
    }
    if ($truncated) { break }
  }
  $tier='NOT_FOUND'; if ($Email) { if ($exact) {$tier='EMAIL_EXACT'} elseif ($domainHit) {$tier='DOMAIN_ONLY'} elseif ($other) {$tier='OTHER_EMAIL'} }
  return [pscustomobject]@{ tier=$tier; target=(Protect-Text $Email); evidence=@($evidence | Sort-Object file,email -Unique); scanned=$count; truncated=$truncated }
}
function Get-DirectoryEvidence {
  foreach ($dir in @((Join-Path $env:APPDATA 'JetBrains'),(Join-Path $env:LOCALAPPDATA 'JetBrains'),(Join-Path $env:USERPROFILE '.jdks'),(Join-Path $env:LOCALAPPDATA 'JetBrains\Toolbox'))) {
    try { $exists=Test-Path -LiteralPath $dir; $children=@(); if ($exists) { $children=@(Get-ChildItem -LiteralPath $dir -Directory -ErrorAction Stop | ForEach-Object { [pscustomobject]@{ name=$_.Name; modified=$_.LastWriteTimeUtc.ToString('o') } }) }; [pscustomobject]@{ path=$dir; exists=$exists; children=$children } } catch { Record-Issue 'directories' $_; [pscustomobject]@{path=$dir;exists=$null;children=@()} }
  }
}
function Get-Idea {
  $found=@(); $paths=@('C:\idea\IntelliJ IDEA 2026.2.2'); $seen=@{}
  foreach ($e in @(Get-UninstallEntries | Where-Object { $_.DisplayName -match 'IntelliJ' })) { if ($e.InstallLocation) { $paths+=$e.InstallLocation; if (Test-Path -LiteralPath (Join-Path $e.InstallLocation 'bin\idea64.exe')) { $found+=[pscustomobject]@{path=$e.InstallLocation;version=$e.DisplayVersion;name=$e.DisplayName}; $seen[$e.InstallLocation.TrimEnd('\').ToLowerInvariant()]=$true } } }
  foreach ($base in @((Join-Path $env:ProgramFiles 'JetBrains'),'C:\idea',(Join-Path $env:LOCALAPPDATA 'Programs'),(Join-Path $env:LOCALAPPDATA 'JetBrains\Toolbox\apps'))) {
    try { if (Test-Path -LiteralPath $base) { $queue=New-Object 'System.Collections.Generic.Queue[object]'; $queue.Enqueue(@{path=$base;depth=0}); while ($queue.Count) { $node=$queue.Dequeue(); $paths+=$node.path; if ($node.depth -lt 4) { foreach ($child in @(Get-ChildItem -LiteralPath $node.path -Directory -ErrorAction Stop)) { if (!($child.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $queue.Enqueue(@{path=$child.FullName;depth=($node.depth+1)}) } } } } } } catch { Record-Issue 'idea.directories' $_ }
  }
  foreach ($dir in $paths) { try { $key=$dir.TrimEnd('\').ToLowerInvariant(); $exe=Join-Path $dir 'bin\idea64.exe'; if (!$seen[$key] -and (Test-Path -LiteralPath $exe)) { $seen[$key]=$true; $version=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion; $info=Join-Path $dir 'product-info.json'; if (Test-Path -LiteralPath $info) { $version=(Get-Content -LiteralPath $info -Raw -Encoding UTF8 | ConvertFrom-Json).version }; $found+=[pscustomobject]@{path=$dir;version=$version;name='IntelliJ IDEA'} } } catch { Record-Issue 'idea.probe' $_ } }
  return [pscustomobject]@{ installations=@($found | Sort-Object @{Expression={ try { [version]([regex]::Match([string]$_.version,'\d+(?:\.\d+){0,3}').Value) } catch { [version]'0.0' } };Descending=$true}) }
}
function Get-Trace {
  foreach ($scope in @('User','Machine')) { try { $all=[Environment]::GetEnvironmentVariables($scope); foreach ($name in $all.Keys) { if ($name -match 'jetbra|pojie|_VM_OPTIONS$') { [pscustomobject]@{scope=$scope;name=$name;matched=($name -match 'jetbra|pojie' -or [string]$all[$name] -match 'jetbra|pojie')} } } } catch { Record-Issue 'trace' $_ } }
}
function Collect-Result([string]$Email) {
  $snapshot=Get-EnvironmentSnapshot; $effective=Get-EffectiveHome $snapshot
  $whereJava=@(Get-Where java); $whereJavac=@(Get-Where javac)
  $j=Invoke-Captured java @('-version'); $c=Invoke-Captured javac @('-version'); $settings=Invoke-Captured java @('-XshowSettings:properties','-version')
  $candidates=@(Find-Jdks $snapshot $whereJavac); $probe=Probe-Jdk $effective 'JAVA_HOME'; $evidence=Runtime-Evidence $settings $whereJavac
  $includes=$false; $rawPaths=@(); foreach ($value in @($snapshot.machine.Path.value,$snapshot.user.Path.value,$env:Path)) { foreach ($entry in ([string]$value -split ';')) { if ($entry -match 'java|jdk|jetbrains') { $rawPaths+=$entry }; $expanded=$entry -replace '(?i)%JAVA_HOME%',([string]$probe.path).Replace('$','$$'); if ($probe.path -and (Normalize-Directory $expanded) -eq ($probe.path+'\bin')) { $includes=$true } } }
  $diskUnavailable=$false; if ($effective -match '^([a-zA-Z]:)') { $diskUnavailable=!(Test-Path ($Matches[1]+'\')) }
  $dirs=@(Invoke-Section 'directories' {Get-DirectoryEvidence} @()); $idea=Invoke-Section 'idea' {Get-Idea} ([pscustomobject]@{installations=@();error='采集失败'}); $emailScan=Invoke-Section 'emailScan' {Get-EmailEvidence $Email} ([pscustomobject]@{tier='NOT_FOUND';evidence=@();scanned=0;truncated=$true}); $trace=@(Invoke-Section 'trace' {Get-Trace} @())
  $class=@((Read-EnvironmentValue User CLASSPATH).value,(Read-EnvironmentValue Machine CLASSPATH).value) -join ';'
  $username=[Environment]::UserName; if ($username.Length) { $username=$username.Substring(0,1)+'***' }
  return [pscustomobject]@{ schemaVersion=1; meta=@{scriptVersion='1.0.0';collectedAt=[DateTime]::UtcNow.ToString('o');windows=[Environment]::OSVersion.VersionString;user=$username;powershell=$PSVersionTable.PSVersion.ToString()}; env=@{user=$snapshot.user;machine=$snapshot.machine;effectiveJavaHome=$effective;classpath=$class;path=($rawPaths -join ';')}; exec=@{java=$j;javac=$c;settings=$settings}; javaProbe=@{home=$probe;candidates=$candidates;whereJava=$whereJava;whereJavac=$whereJavac;runtimeHome=$evidence.runtime;runtimeMatchesHome=(Compare-Path $evidence.runtime $probe.path);compilerMatchesHome=(Compare-Path $evidence.compiler $probe.path);runtimeMajor=(Get-Major $j.output);compilerMajor=(Get-Major $c.output);forwarders=@(@($whereJava+$whereJavac) | Where-Object { Is-Forwarder $_ } | Select-Object -Unique);pathIncludesHome=$includes;diskUnavailable=$diskUnavailable;jreBinExists=($probe.path -and (Test-Path -LiteralPath ($probe.path+'\jre\bin')));archWarning=$(if ($settings.output -match '(?m)^\s*os.arch\s*=\s*(x86|i386)\s*$' -and [Environment]::Is64BitOperatingSystem) {'当前 Java 为 32 位，Windows 为 64 位'} else {$null})}; idea=$idea;jetbrainsDirs=$dirs;jetbraTrace=$trace;emailScan=$emailScan;errors=@() }
}
function Convert-SafeJson($Data) {
  # Never export unfiltered raw Path values from the registry snapshots.
  foreach ($scope in @('user','machine')) { if ($Data.env.$scope.Path.value) { $Data.env.$scope.Path.value=(@([string]$Data.env.$scope.Path.value -split ';' | Where-Object { $_ -match 'java|jdk|jetbrains' }) -join ';') } }
  if ($Data.exec -and $Data.exec.settings) { $Data.exec.settings.output=(@($Data.exec.settings.output -split '\r?\n' | Where-Object { $_ -match '^\s*(java\.home|java\.version|java\.vendor|os\.arch)\s*=' }) -join [Environment]::NewLine) }
  $Data.errors=@($script:Issues.ToArray())
  $json=$Data | ConvertTo-Json -Depth 6 -Compress
  # JSON escapes backslashes: redact the serialized profile prefix as well.
  $profileJson=ConvertTo-Json ([string]$env:USERPROFILE) -Compress
  if ($profileJson.Length -gt 2) { $json=[regex]::Replace($json,[regex]::Escape($profileJson.Substring(1,$profileJson.Length-2)),'%USERPROFILE%','IgnoreCase') }
  return Protect-Text $json
}
function Copy-ClipboardFallback([string]$Json) {
  $old=$OutputEncoding
  try { $OutputEncoding=New-Object Text.UTF8Encoding($false); $Json | & (Join-Path $env:SystemRoot 'System32\cmd.exe') /d /c 'chcp 65001>nul & clip.exe'; if ($LASTEXITCODE -ne 0 -or (Get-Clipboard -Raw -ErrorAction Stop).TrimEnd([char]13,[char]10) -ne $Json) { throw '备用剪贴板复制或回读失败' } } finally { $OutputEncoding=$old }
}
function Save-Result($Data,[string]$Directory) {
  $destination=Join-Path $Directory 'result.txt'; $json=Convert-SafeJson $Data
  try { [IO.File]::WriteAllText($destination,$json,(New-Object Text.UTF8Encoding($true))) } catch { Record-Issue 'result.write' $_ }
  try { Set-Clipboard -Value $json -ErrorAction Stop; if ((Get-Clipboard -Raw -ErrorAction Stop).TrimEnd([char]13,[char]10) -ne $json) { throw '剪贴板回读不一致' } }
  catch {
    Record-Issue 'clipboard.primary' $_; $json=Convert-SafeJson $Data
    try { Copy-ClipboardFallback $json } catch { Record-Issue 'clipboard.fallback' $_ }
  }
  $json=Convert-SafeJson $Data
  try { [IO.File]::WriteAllText($destination,$json,(New-Object Text.UTF8Encoding($true))) } catch { Record-Issue 'result.write.final' $_; Write-Host '结果文件无法保存，请复制下面的 JSON。' }
  Write-Host '采集完成。请返回网页粘贴；也可拖入本文件夹中的 result.txt。'
  Write-Host ('发现完整 JDK：'+@($Data.javaProbe.candidates | Where-Object {$_.valid}).Count+'；IDEA 安装：'+$Data.idea.installations.Count)
  Write-Host '---JAVA_CHECK_JSON_BEGIN---'; Write-Host $json; Write-Host '---JAVA_CHECK_JSON_END---'
}
`;
  const repair = String.raw`
function Write-UserValue([string]$Name,$Value,[string]$Kind,[bool]$Exists=$true) {
  $key=$null
  try { $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$true); if (!$key) { throw '无法写入用户环境变量' }; if ($Exists) { $key.SetValue($Name,$Value,[Microsoft.Win32.RegistryValueKind]::$Kind) } else { $key.DeleteValue($Name,$false) } }
  catch { Record-Issue ('registry.write.'+$Name) $_; throw } finally { if ($key) {$key.Dispose()} }
}
function Broadcast-Environment {
  try { Initialize-Native; $result=[UIntPtr]::Zero; $sent=[JavaCheckNative]::SendMessageTimeout([IntPtr]0xffff,0x1a,[UIntPtr]::Zero,'Environment',2,1000,[ref]$result); if ($sent -eq [IntPtr]::Zero) { Record-Issue 'broadcast' '部分窗口未响应，请从开始菜单重新打开终端，必要时注销后登录。' } } catch { Record-Issue 'broadcast' $_ }
}
function Rebuild-Environment($Snapshot) {
  $env:JAVA_HOME=Get-EffectiveHome $Snapshot
  $parts=@(); foreach ($entry in @($Snapshot.machine.Path,$Snapshot.user.Path)) { $v=[string]$entry.value; if ($entry.kind -eq 'ExpandString') {$v=[Environment]::ExpandEnvironmentVariables($v)}; if ($v) {$parts+=$v} }
  $env:Path=$parts -join ';'
}
function New-RepairPlan($Snapshot,$Target) {
  foreach ($scope in @('user','machine')) { foreach ($name in @('JAVA_HOME','Path')) { $v=$Snapshot.$scope.$name; if ($v.error -or $null -eq $v.exists) { throw '环境变量读取失败，不能安全备份或修改。' }; if ($v.exists -and $v.kind -notin @('String','ExpandString')) { throw '环境变量的注册表类型异常，请联系管理员。' } } }
  if (!$Target.valid) { throw '没有经过执行验证的完整 JDK。' }
  $kind='ExpandString'; if ($Snapshot.user.Path.exists) {$kind=$Snapshot.user.Path.kind}
  $bin=$Target.path+'\bin'; $prefix='%JAVA_HOME%\bin'; if ($kind -eq 'String') {$prefix=$bin}
  $entries=@(); foreach ($item in ([string]$Snapshot.user.Path.value -split ';')) { if (!$item) {continue}; $expanded=$item -replace '(?i)%JAVA_HOME%', $Target.path.Replace('$','$$'); if ((Normalize-Directory $expanded) -ne $bin) {$entries+=$item} }
  $newPath=(@($prefix)+$entries) -join ';'
  $length=([string]$Snapshot.machine.Path.value+';'+$newPath).Length
  $prospective=([string]$Snapshot.machine.Path.value+';'+$newPath) -replace '(?i)%JAVA_HOME%', $Target.path.Replace('$','$$')
  $expandedLength=([Environment]::ExpandEnvironmentVariables($prospective)).Length
  if ([Math]::Max($length,$expandedLength) -ge 2048) { throw '拟生效 Path 已达到 2048 字符。为避免截断，未修改任何变量，请联系助教整理 Path。' }
  $homeKind='String'; if ($Snapshot.user.JAVA_HOME.exists) {$homeKind=$Snapshot.user.JAVA_HOME.kind}
  return [pscustomobject]@{home=$Target.path;homeKind=$homeKind;path=$newPath;pathKind=$kind}
}
function Save-Backups($Snapshot,[string]$Directory) {
  $folder=Join-Path $Directory ('backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,6))
  [IO.Directory]::CreateDirectory($folder) | Out-Null
  foreach ($scope in @('user','machine')) { $file=Join-Path $folder ('backup-'+$scope+'-JAVA_HOME-and-Path.txt'); $json=$Snapshot.$scope | ConvertTo-Json -Depth 6; [IO.File]::WriteAllText($file,$json,(New-Object Text.UTF8Encoding($true))); $read=[IO.File]::ReadAllText($file); if (!$read -or $read -cne $json) {throw '备份回读验证失败，未修改环境变量。'}; $null=$read | ConvertFrom-Json }
  Write-Host ('原值已备份到 '+$folder+'，可手动还原。备份含本机原始路径，请勿公开上传。')
  return $folder
}
function Resolve-Winget {
  $paths=@((Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\winget.exe'))
  try { $paths+=@(Get-ChildItem -LiteralPath (Join-Path $env:ProgramFiles 'WindowsApps') -Directory -ErrorAction Stop | Where-Object {$_.Name -like 'Microsoft.DesktopAppInstaller_*'} | Sort-Object @{Expression={try {[version]($_.Name.Split('_')[1])} catch {[version]'0.0'}};Descending=$true} | ForEach-Object {Join-Path $_.FullName 'winget.exe'}) } catch {Record-Issue 'winget.paths' $_}
  $command=Get-Command winget.exe -ErrorAction SilentlyContinue; if ($command) {$paths+=$command.Source}
  foreach ($file in $paths) {if (Test-Path -LiteralPath $file) { $r=Invoke-Captured $file @('--version'); if ($r.exitCode -eq 0) {return $file} }}
  return $null
}
function Get-WingetIds([string]$Text) { return @([regex]::Matches($Text,'EclipseAdoptium\.Temurin[\.\w]*|Temurin[\.\w]*JDK') | ForEach-Object {$_.Value} | Where-Object {$_ -match '^(?:EclipseAdoptium\.)?Temurin(?:\.[A-Za-z0-9_]+)*\.25(?:\.[A-Za-z0-9_]+)*\.JDK$'} | Select-Object -Unique) }
function Install-Jdk {
  $winget=Resolve-Winget; if (!$winget) {throw 'winget 不可用：请在 Microsoft Store 搜索“应用安装程序”并更新，或到 https://adoptium.net/installation 下载 JDK。'}
  $id='EclipseAdoptium.Temurin.25.JDK'; $show=Invoke-Captured $winget @('show','--exact','--id',$id,'--source','winget','--accept-source-agreements')
  if ($show.exitCode -ne 0) {
    $search=Invoke-Captured $winget @('search','Temurin','--source','winget','--accept-source-agreements'); $id=$null
    foreach ($candidate in @(Get-WingetIds $search.output)) { $test=Invoke-Captured $winget @('show','--exact','--id',$candidate,'--source','winget','--accept-source-agreements'); if ($test.exitCode -eq 0 -and $test.output -match 'Eclipse Adoptium|adoptium\.net|github\.com/adoptium/' -and $test.output -match '25') {$id=$candidate;break} }
    if (!$id) {throw '没有找到可明确验证的 Temurin 25 JDK，请到 https://adoptium.net/installation 手动安装。'}
  }
  $arguments=@('install','--exact','--id',$id,'--source','winget','--silent','--accept-package-agreements','--accept-source-agreements')
  $r=Invoke-Captured $winget ($arguments+@('--scope','machine'))
  if ($r.exitCode -ne 0 -and $r.output -match '(?i)scope|适用.*安装|applicable installer|范围|0x8A150010') { $r=Invoke-Captured $winget $arguments }
  if ($r.exitCode -ne 0) {Record-Issue 'winget.install' $r.output; throw 'JDK 安装未完成，未配置环境变量。请检查网络或联系管理员，也可手动下载绿色版 JDK。'}
}
function Repair-UserEnvironment($Snapshot,$Target,[string]$Directory) {
  $plan=New-RepairPlan $Snapshot $Target
  $key=$null; try { $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$true); if (!$key) {throw [UnauthorizedAccessException]::new('无法写入 HKCU Environment')} } finally {if ($key) {$key.Dispose()}}
  $backup=Save-Backups $Snapshot $Directory
  $changed=New-Object 'System.Collections.Generic.List[string]'
  try {
    $changed.Add('JAVA_HOME'); Write-UserValue JAVA_HOME $plan.home $plan.homeKind
    $changed.Add('Path'); Write-UserValue Path $plan.path $plan.pathKind
    $fresh=Get-EnvironmentSnapshot; Rebuild-Environment $fresh; Broadcast-Environment
    $j=Invoke-Captured java @('-version'); $c=Invoke-Captured javac @('-version'); $settings=Invoke-Captured java @('-XshowSettings:properties','-version'); $evidence=Runtime-Evidence $settings @(Get-Where javac)
    Write-Host $j.output; Write-Host $c.output
    if ($j.exitCode -ne 0 -or $c.exitCode -ne 0 -or $evidence.runtime -ne $Target.path -or $evidence.compiler -ne $Target.path -or (Get-Major $j.output) -ne (Get-Major $c.output)) {throw '真实命令仍与选定 JDK 不一致，可能被系统 Path 中的旧 Java 或转发器遮蔽。请联系管理员调整系统 Path；本工具不会为此提权。'}
    Write-Host '已修复，仅对你这个 Windows 账户生效，其他账户不受影响。'
    if ($Target.path -match '\\\.jdks\\') {Write-Host '已复用 IDEA 自己下载的 JDK（位于 .jdks）。请不要在 IDEA 里删除它，否则本机 Java 环境会一起失效。'}
  } catch {
    Record-Issue 'repair' $_
    foreach ($name in $changed) {try {$old=$Snapshot.user.$name; Write-UserValue $name $old.value $old.kind ([bool]$old.exists)} catch {Record-Issue 'rollback' $_; Write-Host ('还原失败，请使用备份联系管理员：'+$backup)}}
    Rebuild-Environment (Get-EnvironmentSnapshot); Broadcast-Environment; throw
  }
}
function Start-Repair([string]$Directory) {
  $script:LogFile=Join-Path $Directory 'repair.log'
  try {
    Add-Content -LiteralPath $script:LogFile -Value ('开始修复 '+[DateTime]::UtcNow.ToString('o')) -Encoding UTF8 -ErrorAction Stop
    $snapshot=Get-EnvironmentSnapshot; $target=Select-Jdk @(Find-Jdks $snapshot @(Get-Where javac))
    if (!$target) {
      $null=Save-Backups $snapshot $Directory
      $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      $helper=Join-Path ([IO.Path]::GetTempPath()) ('java-install-'+[Guid]::NewGuid().ToString('N')+'.ps1')
      $tail="\r\n" # replaced below with Environment.NewLine
      $tail=[Environment]::NewLine+"if ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne '"+$sid+"') { Write-Host '跨账户提权已停止：请使用自己的账户或联系管理员。'; exit 3 }; try { Install-Jdk; exit 0 } catch { Write-Host ([string]"+'$_'+"); exit 1 }"
      try {
        [IO.File]::WriteAllText($helper,$script:Library+$tail,[Text.Encoding]::Unicode)
        try { $process=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Verb RunAs -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "'+$helper+'"') -Wait -PassThru -ErrorAction Stop; if ($process.ExitCode -eq 3) {throw '跨账户提权被阻止，未运行安装。'}; if ($process.ExitCode -ne 0) {Record-Issue 'installation' ('安装进程退出码 '+$process.ExitCode)} } catch {Record-Issue 'elevation' $_; Write-Host '安装没有完成，将重新检查本机是否已有可复用 JDK。'}
      } finally {if (Test-Path -LiteralPath $helper) {Remove-Item -LiteralPath $helper -ErrorAction SilentlyContinue}}
      $snapshot=Get-EnvironmentSnapshot; $target=Select-Jdk @(Find-Jdks $snapshot @(Get-Where javac))
      if (!$target) {throw '本机仍没有可用 JDK，未修改环境变量。请到 https://adoptium.net/installation 下载 JDK，解压到可写目录，设置或在 IDEA 中选择该 JDK，然后重新检测。'}
    }
    Repair-UserEnvironment $snapshot $target $Directory
  } catch {
    Record-Issue 'repair.final' $_
    if ($_.Exception -is [UnauthorizedAccessException] -or [string]$_ -match 'denied|拒绝|权限') {Write-Host '这台电脑的环境变量或目录被管理员锁定，无法自动修改。请联系机房管理员，或使用绿色版 JDK 解压到可写目录后请管理员协助配置。'} else {Write-Host ([string]$_)}
  }
  Write-Host '请关闭本窗口，以普通权限重新双击“一键检测.bat”，再把新结果粘贴到网页。'
}
`;
  function base64Unicode(text, bom) {
    let binary = bom ? '\xff\xfe' : '';
    for (let i = 0; i < text.length; i++) { const n = text.charCodeAt(i); binary += String.fromCharCode(n & 255, n >>> 8); }
    return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  }
  function wrapBat(script) {
    const loader = String.raw`$ErrorActionPreference='Stop'; $temp=$null; try { $source=$env:SELF; if (!$source -or !(Test-Path -LiteralPath $source)) { throw 'Cannot locate BAT file' }; $text=Get-Content -LiteralPath $source -Raw; $m=[regex]::Match($text,'(?s)\r?\n:PAYLOAD_BEGIN\r?\n([A-Za-z0-9+/=]+)\r?\n:PAYLOAD_END'); if (!$m.Success) { throw 'Invalid BAT payload; download again' }; $temp=Join-Path ([IO.Path]::GetTempPath()) ('java-check-'+[Guid]::NewGuid().ToString('N')+'.ps1'); [IO.File]::WriteAllBytes($temp,[Convert]::FromBase64String($m.Groups[1].Value)); & (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -ExecutionPolicy Bypass -File $temp -OutputDirectory (Split-Path -Parent $source) } catch { Write-Host $_ } finally { if ($temp -and (Test-Path -LiteralPath $temp)) { Remove-Item -LiteralPath $temp -ErrorAction SilentlyContinue } }`;
    return '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "SELF=%~f0"\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + base64Unicode(loader, false) + '\r\npause\r\nexit /b\r\n:PAYLOAD_BEGIN\r\n' + base64Unicode(script, true) + '\r\n:PAYLOAD_END\r\n';
  }
  function buildCheckerPs1(email = '') {
    const literal = String(email).replace(/'/g, "''");
    return "param([string]$EduEmail = '" + literal + "', [string]$OutputDirectory)\r\n" + common + collector + String.raw`
try {
  if (!$OutputDirectory) { throw '请通过下载的一键检测 BAT 运行。' }
  if (!$EduEmail) { $EduEmail=Read-Host '请输入教育邮箱（可留空）' }
  $data=Collect-Result $EduEmail
  Save-Result $data $OutputDirectory
} catch { Record-Issue 'collector.final' $_; Write-Host ('采集未能完成，请联系助教：'+(Protect-Text ([string]$_))) }
`;
  }
  function buildRepairBat() {
    const library = common + repair;
    return wrapBat('param([string]$OutputDirectory)\r\n' + library + "\r\n$script:Library=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('" + base64Unicode(library, false) + "'))\r\nStart-Repair $OutputDirectory\r\n");
  }
  const api = { buildCheckerPs1, buildCheckerBat: email => wrapBat(buildCheckerPs1(email)), buildRepairBat, wrapBat, common, collector, repair };
  root.ScriptTemplates = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
