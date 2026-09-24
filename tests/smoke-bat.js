// Opt-in host read-only collection. Writes a report in a test directory and temporarily uses clipboard.
const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');const assert=require('node:assert/strict');
const t=require('../assets/script-template.js');const a=require('../assets/app.js');
const dir=path.resolve(__dirname,'..','.cache','中文 检测 smoke');fs.mkdirSync(dir,{recursive:true});const bat=path.join(dir,'一键检测.bat');fs.writeFileSync(bat,t.buildCheckerBat('test@example.edu.cn'),'ascii');
const command="$before=Get-Clipboard -Raw -ErrorAction SilentlyContinue; try { & $env:ComSpec /d /c '\""+bat.replace(/'/g,"''")+"\"' } finally { if($null -ne $before){Set-Clipboard -Value $before} }";
const r=cp.spawnSync('powershell.exe',['-NoProfile','-Command',command],{cwd:process.env.SystemRoot+'\\System32',input:'\r\n',encoding:'utf8',timeout:180000});
fs.writeFileSync(path.join(dir,'console.txt'),r.stdout+'\n'+r.stderr,'utf8');assert.equal(r.status,0,r.stderr||String(r.error));const d=a.parseResult(fs.readFileSync(path.join(dir,'result.txt'),'utf8'));assert.equal(d.schemaVersion,1);assert.ok(!JSON.stringify(d).includes('test@example.edu.cn'));console.log(JSON.stringify({report:path.join(dir,'result.txt'),status:a.analyze(d).status,errors:d.errors},null,2));
