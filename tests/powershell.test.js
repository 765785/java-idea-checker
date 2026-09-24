const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const template=require('../assets/script-template.js');
function runPS(body){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'java-unit-'));try{const file=path.join(dir,'test.ps1');fs.writeFileSync(file,'\ufeff'+template.common+template.repair+template.collector+'\n'+body,'utf8');const r=cp.spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',file],{encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stdout+r.stderr+(r.error||''));return r.stdout}finally{fs.rmSync(dir,{recursive:true,force:true})}}
test('PS registry plan preserves types, handles empty values, and blocks long Path',{skip:process.platform!=='win32'},()=>{runPS(String.raw`
$ErrorActionPreference='Stop'
function Assert($condition,$message){if(!$condition){throw $message}}
function Value($v,$kind='String',$exists=$true){[pscustomobject]@{exists=$exists;value=$v;kind=$kind;error=$null}}
$s=[pscustomobject]@{user=[pscustomobject]@{JAVA_HOME=(Value 'D:\idea\');Path=(Value '' 'ExpandString')};machine=[pscustomobject]@{JAVA_HOME=(Value 'C:\Java\jdk-25');Path=(Value 'C:\Windows\System32' 'ExpandString')}}
$target=[pscustomobject]@{valid=$true;path='c:\java\jdk-25'}
$p=New-RepairPlan $s $target
Assert ($p.home -eq $target.path) 'invalid user override not corrected'
Assert ($p.pathKind -eq 'ExpandString' -and $p.path -eq '%JAVA_HOME%\bin') 'expand string lost'
$s.user.Path=Value '' 'String';$p=New-RepairPlan $s $target
Assert ($p.path -eq 'c:\java\jdk-25\bin' -and $p.pathKind -eq 'String') 'String must use absolute bin'
$s.user.Path=Value $null $null $false;$p=New-RepairPlan $s $target
Assert ($p.pathKind -eq 'ExpandString') 'new Path must expand'
$s.user.JAVA_HOME=Value '';Assert ((Get-EffectiveHome $s) -eq 'C:\Java\jdk-25') 'empty user fallback'
$s.user.Path=Value ('x'*2048) 'String'
$blocked=$false;try{New-RepairPlan $s $target|Out-Null}catch{$blocked=$true};Assert $blocked 'long Path allowed'
$s.user.Path=Value 'x' 'Binary';$blocked=$false;try{New-RepairPlan $s $target|Out-Null}catch{$blocked=$true};Assert $blocked 'binary Path allowed'
Assert (Is-Forwarder 'C:\Program Files\Common Files\Oracle\Java\javapath\java.exe') 'Oracle forwarder'
Assert (Is-Forwarder 'C:\Users\x\AppData\Local\Microsoft\WindowsApps\java.exe') 'alias forwarder'
$ids=@(Get-WingetIds '名称 标识符 版本 来源 EclipseAdoptium.Temurin.25.JDK 换行 Temurin.25.JRE')
Assert ($ids.Count -eq 1) 'localized id parsing'
$a=Normalize-Directory ($env:SystemRoot+'\System32\..');$b=Normalize-Directory $env:SystemRoot
Assert ($a -eq $b) 'full path normalization'
Write-Output 'contract passed'
`)});
test('Toolbox matching masks evidence; caches skipped',{skip:process.platform!=='win32'},()=>{runPS(String.raw`
$ErrorActionPreference='Stop'
$fixture=Join-Path $env:TEMP ('email-fixture-'+[Guid]::NewGuid().ToString('N'))
$oldApp=$env:APPDATA;$oldLocal=$env:LOCALAPPDATA;$oldProfile=$env:USERPROFILE
try{
 $env:APPDATA=Join-Path $fixture 'roaming';$env:LOCALAPPDATA=Join-Path $fixture 'local';$env:USERPROFILE=Join-Path $fixture 'user'
 $dir=Join-Path $env:LOCALAPPDATA 'JetBrains\Toolbox\accounts';[IO.Directory]::CreateDirectory($dir)|Out-Null
 [IO.File]::WriteAllText((Join-Path $dir 'account.json'),'li@school.edu.cn',[Text.Encoding]::UTF8)
 $r=Get-EmailEvidence 'li@school.edu.cn';if($r.tier -ne 'EMAIL_EXACT' -or $r.evidence[0].email -ne 'l***@school.edu.cn'){throw 'Toolbox exact failed'}
 $r=Get-EmailEvidence 'other@school.edu.cn';if($r.tier -ne 'DOMAIN_ONLY'){throw 'domain failed'}
 $r=Get-EmailEvidence 'other@else.edu.cn';if($r.tier -ne 'OTHER_EMAIL'){throw 'other failed'}
 $r=Get-EmailEvidence '';if($r.tier -ne 'NOT_FOUND'){throw 'empty failed'}
}finally{$env:APPDATA=$oldApp;$env:LOCALAPPDATA=$oldLocal;$env:USERPROFILE=$oldProfile;if(Test-Path -LiteralPath $fixture){Remove-Item -LiteralPath $fixture -Recurse -Force}}
`)});
test('both clipboard failures still write JSON errors',{skip:process.platform!=='win32'},()=>{runPS(String.raw`
$ErrorActionPreference='Stop'
function Set-Clipboard {throw 'simulated clipboard failure'}
function Get-Clipboard {throw 'simulated readback failure'}
function Copy-ClipboardFallback {throw 'simulated fallback failure'}
$folder=Join-Path $env:TEMP ('clip-fixture-'+[Guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($folder)|Out-Null
try{$d=[pscustomobject]@{env=@{user=@{Path=@{value=''}};machine=@{Path=@{value=''}}};errors=@();javaProbe=@{candidates=@()};idea=@{installations=@()}};Save-Result $d $folder;$read=Get-Content -LiteralPath (Join-Path $folder 'result.txt') -Raw -Encoding UTF8|ConvertFrom-Json;if(@($read.errors|Where-Object{$_.field -like 'clipboard.*'}).Count -ne 2){throw 'clipboard errors not saved'}}finally{Remove-Item -LiteralPath $folder -Recurse -Force}
`)});
