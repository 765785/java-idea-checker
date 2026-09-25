const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const app = require('../assets/app.js');
const templates = require('../assets/script-template.js');

function fixture() {
  return {
    schemaVersion: 2,
    meta: { collectedAt: new Date().toISOString(), user: 'l***' },
    env: { effectiveJavaHome: 'C:\\Java\\jdk-25', path: '%JAVA_HOME%\\bin', classpath: '%JAVA_HOME%\\lib' },
    exec: { java: { exitCode: 0, output: 'openjdk version "25"' }, javac: { exitCode: 0, output: 'javac 25' } },
    javaProbe: { home: { path: 'c:\\java\\jdk-25', valid: true }, candidates: [{ path: 'c:\\java\\jdk-25', major: 25, valid: true }], runtimeMatchesHome: true, compilerMatchesHome: true, runtimeMajor: 25, compilerMajor: 25, pathIncludesHome: true, whereJava: ['c:\\java\\jdk-25\\bin\\java.exe'], whereJavac: ['c:\\java\\jdk-25\\bin\\javac.exe'], forwarders: [] },
    idea: { installations: [] },
    jetbrainsDirs: [],
    jetbraTrace: [],
    emailScan: { status: 'OK', domains: ['dnui.edu.cn'], domainEvidence: [], emailEvidence: [], xmlEvidence: [], credentialManager: { status: 'OK', entries: [], errors: [] }, credentialFiles: [], configPresent: false, scanned: 0, truncated: false, errors: [] }
  };
}
function bFixture() {
  const data = JSON.parse(JSON.stringify(fixture()));
  data.idea.installations = [{ name: 'IntelliJ IDEA', version: '2026.1', path: '%USERPROFILE%\\idea' }];
  data.jetbrainsDirs = [{ path: '%USERPROFILE%\\AppData\\Roaming\\JetBrains', exists: true, children: [{ name: 'IntelliJIdea2026.1' }] }];
  data.emailScan.configPresent = true;
  return data;
}
function studentCard(result) { return result.cards.find(item => item.name === '学生认证结论'); }
function hash(bytes) { return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex'); }

test('normal machine and missing IDEA do not create Java failure', () => {
  const result = app.analyze(fixture());
  assert.notEqual(result.status, 'FAIL');
  assert.equal(result.repair, false);
  assert.equal(result.cards.find(item => item.name === 'IDEA 安装与版本').status, 'MANUAL');
});
test('new machine needs JDK', () => {
  const data = fixture(); data.javaProbe.candidates = []; data.javaProbe.home = { valid: false }; data.exec = {};
  const result = app.analyze(data);
  assert.equal(result.status, 'FAIL');
  assert.match(result.repairLabel, /安装 JDK/);
});
test('JRE-only has dedicated compiler failure', () => {
  const data = fixture(); data.javaProbe.candidates = []; data.exec.javac = { exitCode: 1, output: '' };
  const result = app.analyze(data);
  assert.match(result.repairLabel, /运行环境/);
  assert.equal(result.cards[0].status, 'FAIL');
});
test('same-JDK forwarder does not fail', () => {
  const data = fixture(); data.javaProbe.forwarders = ['C:\\Program Files\\Common Files\\Oracle\\Java\\javapath\\java.exe'];
  assert.notEqual(app.analyze(data).status, 'FAIL');
});
test('different real target fails', () => {
  const data = fixture(); data.javaProbe.runtimeMatchesHome = false;
  assert.equal(app.analyze(data).status, 'FAIL');
});
test('unresolved target warns, never claims mismatch', () => {
  const data = fixture(); data.javaProbe.runtimeMatchesHome = null;
  assert.equal(app.analyze(data).cards.find(item => item.name.includes('是否一致')).status, 'WARN');
});
test('JDK 8 plus 25 warns without repair', () => {
  const data = fixture(); data.javaProbe.runtimeMajor = 8; data.javaProbe.compilerMajor = 8; data.javaProbe.candidates.push({ path: 'c:\\java\\jdk-25', major: 25, valid: true });
  const result = app.analyze(data);
  assert.equal(result.status, 'WARN');
  assert.equal(result.repair, false);
  assert.match(result.cards.find(item => item.name === '本机其他 JDK 版本').advice, /当前生效的是 JDK 8，本机还检测到 JDK 25/);
});
test('N32/N37: email normalization accepts spaces, case, plus addressing and trailing dot', () => {
  assert.equal(app.normalizeEmail(' A+tag@DNUI.edu.cn. '), 'a@dnui.edu.cn');
  assert.equal(app.emailDomain(' A+tag@DNUI.edu.cn. '), 'dnui.edu.cn');
  assert.equal(app.isEduDomain(app.emailDomain('a+tag@DNUI.edu.cn.')), true);
});
test('N36: machine domain literal gives high confidence without a witness', () => {
  const data = bFixture(); data.emailScan.domainEvidence = [{ kind: 'DOMAIN_LITERAL', email: '***@dnui.edu.cn', paths: ['IntelliJIdea\\options\\other.xml'], accountRelated: true }];
  const result = app.analyze(data);
  assert.equal(result.student.tier, 'HIGH');
  assert.equal(studentCard(result).status, 'PASS');
});
test('N41: unrelated QQ file cannot override account-related DNUI evidence', () => {
  const data = bFixture();
  data.emailScan.domainEvidence = [{ kind: 'DOMAIN_LITERAL', email: '***@dnui.edu.cn', paths: ['IntelliJIdea\\options\\other.xml'], accountRelated: true }];
  data.emailScan.emailEvidence = [{ kind: 'OTHER_EMAIL', email: 'q***@qq.com', paths: ['IntelliJIdea\\templates\\sample.txt'], accountRelated: false }];
  assert.equal(app.analyze(data).student.tier, 'HIGH');
});
test('N42: either credential source gives medium confidence', () => {
  const byCmdkey = bFixture(); byCmdkey.emailScan.credentialManager.entries = ['JetBrainsAccount:user=l***@dnui.edu.cn'];
  const byStore = bFixture(); byStore.emailScan.credentialFiles = ['IntelliJIdea\\options\\secure.kdbx'];
  assert.equal(app.analyze(byCmdkey).student.tier, 'MEDIUM');
  assert.equal(app.analyze(byStore).student.tier, 'MEDIUM');
});
test('N42: configuration alone remains manual confirmation', () => {
  const result = app.analyze(bFixture());
  assert.equal(result.student.tier, 'MANUAL');
  assert.match(studentCard(result).advice, /没找到证据/);
});
test('N37: collection unknown is not presented as not found', () => {
  const data = bFixture(); data.emailScan.status = 'UNKNOWN'; data.emailScan.errors = ['access denied'];
  const result = app.analyze(data);
  assert.equal(result.student.tier, 'MANUAL');
  assert.match(studentCard(result).advice, /没能检查/);
});
test('N35/Q27: witness needs installed and started IDEA before it can elevate', () => {
  const noIdea = fixture();
  const result = app.analyze(noIdea, { email: 'x@dnui.edu.cn', confirmed: true });
  assert.equal(result.student.tier, 'MANUAL');
  assert.equal(result.cards.find(item => item.name.includes('人证')).status, 'MANUAL');
});
test('N35/Q28: eligible DNUI witness is high confidence and wins conflicts', () => {
  const data = bFixture();
  data.emailScan.emailEvidence = [{ kind: 'OTHER_EMAIL', email: 'q***@qq.com', paths: ['IntelliJIdea\\options\\other.xml'], accountRelated: true }];
  const result = app.analyze(data, { email: 'Student+course@DNUI.edu.cn.', confirmed: true });
  assert.equal(result.student.tier, 'HIGH');
  assert.equal(result.student.witnessMasked, 's***@dnui.edu.cn');
  assert.match(studentCard(result).advice, /不同的邮箱/);
});
test('N36/Q28: both witness and account evidence at other domains are mismatch', () => {
  const data = bFixture();
  data.emailScan.emailEvidence = [{ kind: 'OTHER_EMAIL', email: 'q***@qq.com', paths: ['IntelliJIdea\\options\\other.xml'], accountRelated: true }];
  const result = app.analyze(data, { email: 'person@163.com', confirmed: true });
  assert.equal(result.student.tier, 'MISMATCH');
  assert.match(studentCard(result).advice, /换回本校邮箱/);
});
test('student evidence never claims activation', () => {
  const card = studentCard(app.analyze(fixture()));
  assert.doesNotMatch(card.advice, /认证成功|已激活/);
  assert.match(card.advice, /认证失败/);
});
test('N38: deterministic ZIP ignores prior email input paths', () => {
  const first = app.createZip(app.packageEntries());
  const second = app.createZip(app.packageEntries());
  assert.equal(hash(first), hash(second));
});
test('N38: committed fixed Release ZIP matches the browser package bytes', () => {
  const release = path.join(__dirname, '..', 'dist', 'JavaIDEA-checker.zip');
  assert.equal(fs.existsSync(release), true, '缺少固定 Release ZIP；请运行 node tools/build-release.js');
  assert.equal(hash(fs.readFileSync(release)), hash(app.createZip(app.packageEntries())));
});
test('N39: one whitelist source is injected into generated checker only', () => {
  const generated = Buffer.from(app.packageEntries(['example.edu'])[1].data).toString('utf8');
  assert.match(generated, /\$EduDomains=@\('example\.edu'\)/);
  assert.doesNotMatch(generated, /EduEmail|Read-Host '请输入教育邮箱/);
});
test('N40: reports mask credential entries and XML snippets', () => {
  const data = bFixture();
  data.emailScan.credentialManager.entries = ['LegacyGeneric:target=JetBrains:user=zhangsan@dnui.edu.cn'];
  data.emailScan.xmlEvidence = [{ snippet: 'email=zhangsan@dnui.edu.cn', path: 'IntelliJIdea\\options\\other.xml' }];
  const report = app.buildHumanReport(app.analyze(data));
  assert.doesNotMatch(report, /zhangsan@dnui\.edu\.cn/);
  assert.match(report, /z\*\*\*@dnui\.edu\.cn/);
});
test('console extraction respects quoted braces', () => {
  const data = fixture(); data.meta.note = 'a } { \\"';
  assert.equal(app.parseResult('prefix\n' + JSON.stringify(data) + '\nsuffix').schemaVersion, 2);
});
test('old schema rejected', () => {
  const data = fixture(); data.schemaVersion = 1;
  assert.throws(() => app.parseResult(JSON.stringify(data)), /版本过旧/);
});
test('truncated JSON explains next step', () => {
  assert.throws(() => app.parseResult('{"schemaVersion":2'), /没有复制完整/);
});
test('email masking is safe', () => assert.equal(app.mask('lisa@school.edu.cn'), 'l***@school.edu.cn'));
test('both BATs stay ASCII and generated PS1 remains readable UTF-8', () => {
  for (const bat of [templates.buildCheckerBat(), templates.buildRepairBat()]) {
    assert.doesNotMatch(bat, /[^\x00-\x7f]/);
    assert.doesNotMatch(bat, /(?:-EncodedCommand|PAYLOAD_BEGIN|FromBase64String)/i);
    assert.doesNotMatch(bat, /[A-Za-z0-9+/]{201,}={0,2}/);
  }
  const checker = templates.buildCheckerPs1(app.EDU_DOMAIN_WHITELIST);
  const repair = templates.buildRepairPs1();
  for (const script of [checker, repair]) {
    assert.equal(Buffer.from(script, 'utf8').subarray(0, 3).toString('hex'), 'efbbbf');
    assert.match(script, /function Normalize-Directory/);
    assert.match(script, /\$PSScriptRoot/);
    assert.doesNotMatch(script, /(?:-EncodedCommand|FromBase64String|PAYLOAD_BEGIN)/i);
  }
});
test('PowerShell 5.1 parses generated checker and repair', { skip: process.platform !== 'win32' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'java-ast-'));
  try {
    for (const [name, script] of [['checker', templates.buildCheckerPs1(app.EDU_DOMAIN_WHITELIST)], ['repair', templates.buildRepairPs1()]]) {
      const file = path.join(directory, name + '.ps1');
      fs.writeFileSync(file, Buffer.from(script, 'utf8'));
      const command = "$e=$null; $t=$null; [System.Management.Automation.Language.Parser]::ParseFile('" + file.replace(/'/g, "''") + "',[ref]$t,[ref]$e)|Out-Null; if($e.Count){$e|ForEach-Object{$_.ToString()};exit 1}";
      const result = cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

module.exports = { fixture, bFixture };
