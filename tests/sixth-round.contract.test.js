/*
 * Sixth-round release contracts.
 *
 * These tests intentionally use a small ZIP reader of their own.  A ZIP file
 * which can be parsed by the same code that created it is not enough evidence
 * that Windows Explorer / Expand-Archive will accept it.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const Checker = require('../assets/app.js');
const Templates = require('../assets/script-template.js');

const SCRIPT_NAMES = ['JavaCheck.bat', 'JavaCheck.ps1', 'JavaRepair.bat', 'JavaRepair.ps1'];
const ZIP_NAMES = [...SCRIPT_NAMES, 'README_FIRST.txt'];
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function need(object, name) {
  assert.equal(typeof object[name], 'function', `第六轮需要导出 ${name}()`);
  return object[name];
}

function bytes(value) {
  if (Buffer.isBuffer(value)) return Promise.resolve(Buffer.from(value));
  if (value instanceof Uint8Array) return Promise.resolve(Buffer.from(value));
  if (value instanceof ArrayBuffer) return Promise.resolve(Buffer.from(value));
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.arrayBuffer().then(buffer => Buffer.from(buffer));
  throw new TypeError('ZIP 生成器没有返回 Uint8Array、ArrayBuffer、Buffer 或 Blob。');
}

function withBom(text) {
  const content = Buffer.from(String(text), 'utf8');
  return content.subarray(0, 3).equals(UTF8_BOM) ? content : Buffer.concat([UTF8_BOM, content]);
}

function makeEntries(domains) {
  const entries = need(Checker, 'packageEntries')(domains);
  assert.ok(Array.isArray(entries), 'packageEntries() 必须返回 ZIP 条目数组');
  return entries.map(entry => ({ name: entry.name, data: Buffer.from(entry.data) }));
}

async function makeZip(entries = makeEntries()) {
  return bytes(await need(Checker, 'createZip')(entries));
}

function crc32(input) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function findEocd(buffer) {
  const first = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= first; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('没有找到 ZIP 结束目录（EOCD）。');
}

// Independent central-directory parser for Store ZIP files.
function parseZipIndependently(input) {
  const buffer = Buffer.from(input);
  const eocd = findEocd(buffer);
  const entriesCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  assert.equal(centralOffset + centralSize, eocd, '中央目录长度或偏移与 EOCD 不一致');
  const entries = [];
  let offset = centralOffset;
  for (let i = 0; i < entriesCount; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, '中央目录文件头签名错误');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const versionNeeded = buffer.readUInt16LE(offset + 6);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength);
    const name = nameBytes.toString((flags & 0x0800) ? 'utf8' : 'binary');

    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, `本地文件头签名错误：${name}`);
    const localVersionNeeded = buffer.readUInt16LE(localOffset + 4);
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCrc = buffer.readUInt32LE(localOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString((localFlags & 0x0800) ? 'utf8' : 'binary');
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    assert.equal(localVersionNeeded, versionNeeded, `本地/中央 version needed 不一致：${name}`);
    assert.equal(localFlags, flags, `本地/中央 UTF-8 flag 不一致：${name}`);
    assert.equal(localMethod, method, `本地/中央压缩方法不一致：${name}`);
    assert.equal(localCrc, crc, `本地/中央 CRC 不一致：${name}`);
    assert.equal(localCompressedSize, compressedSize, `本地/中央压缩大小不一致：${name}`);
    assert.equal(localUncompressedSize, uncompressedSize, `本地/中央原始大小不一致：${name}`);
    assert.equal(localName, name, `本地/中央文件名不一致：${name}`);
    assert.equal(data.length, uncompressedSize, `Store ZIP 大小错误：${name}`);
    assert.equal(crc32(data), crc, `CRC-32 校验失败：${name}`);
    entries.push({ name, flags, method, versionNeeded, externalAttributes, data: Buffer.from(data) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, centralOffset + centralSize, '中央目录条目长度计算错误');
  return entries;
}

function getCard(analysis, part) {
  const card = analysis.cards.find(item => item.name.includes(part));
  assert.ok(card, `没有找到结果卡：${part}`);
  return card;
}

function analysisFromManual(text) {
  const parsed = need(Checker, 'parseManualResult')(text);
  return parsed && Array.isArray(parsed.cards) ? parsed : Checker.analyze(parsed && parsed.data ? parsed.data : parsed);
}

function powershellAstCommandNames(scriptText) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'java-check-ast-'));
  const source = path.join(directory, 'script.ps1');
  try {
    fs.writeFileSync(source, withBom(scriptText));
    const escaped = source.replace(/'/g, "''");
    const command = "$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile('" + escaped + "',[ref]$tokens,[ref]$errors);if($errors.Count){$errors|ForEach-Object{$_.ToString()};exit 1};$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.CommandAst]},$true)|ForEach-Object{if($_.CommandElements.Count){$_.CommandElements[0].Extent.Text}}";
    const result = cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr + (result.error || ''));
    return result.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('N27: BAT 纯 ASCII、无 Base64，并只通过同目录 ASCII 文件名调用 PS1', () => {
  const checkerBat = need(Templates, 'buildCheckerBat')();
  const repairBat = need(Templates, 'buildRepairBat')();
  const checkerPs1 = need(Templates, 'buildCheckerPs1')(Checker.EDU_DOMAIN_WHITELIST);
  const repairPs1 = need(Templates, 'buildRepairPs1')();
  for (const [name, bat] of [['JavaCheck.bat', checkerBat], ['JavaRepair.bat', repairBat]]) {
    assert.doesNotMatch(bat, /[^\x00-\x7f]/, `${name} 不能包含中文或其他非 ASCII 字符`);
    assert.doesNotMatch(bat, /[A-Za-z0-9+/]{201,}={0,2}/, `${name} 不能内嵌 Base64 载荷`);
    assert.doesNotMatch(bat, /(?:-EncodedCommand|PAYLOAD_BEGIN|FromBase64String|set\s+"SELF=)/i, `${name} 不能残留旧 Base64 启动器`);
    assert.match(bat, /%~dp0/i, `${name} 必须从自身目录定位脚本`);
  }
  assert.deepEqual(checkerBat.trim().split(/\r?\n/), [
    '@echo off & title Java Environment Checker',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0JavaCheck.ps1"',
    'pause'
  ], 'JavaCheck.bat 必须是三行、可审阅的 ASCII 启动器');
  assert.match(repairBat, /if not exist "%~dp0JavaCheck\.ps1"/i);
  assert.match(repairBat, /JavaRepair\.ps1"\s+-MissingChecker/i);
  assert.match(repairBat, /JavaRepair\.ps1"/i);
  for (const [name, script] of [['JavaCheck.ps1', checkerPs1], ['JavaRepair.ps1', repairPs1]]) {
    assert.match(script, /\$PSScriptRoot\b/, `${name} 必须将输出、日志和同目录文件定位到 $PSScriptRoot`);
    assert.doesNotMatch(script, /\$(?:PSCommandPath|MyInvocation\.(?:MyCommand\.)?Path)\b/i, `${name} 不应依赖调用方式推断脚本目录`);
  }
});

test('N27: 缺少检测脚本时由可读的 Repair PS1 输出中文说明', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'java-check-missing-'));
  const directory = path.join(root, '中文 空格目录');
  fs.mkdirSync(directory);
  try {
    const repairBat = need(Templates, 'buildRepairBat')();
    const repairPs1 = withBom(need(Templates, 'buildRepairPs1')());
    fs.writeFileSync(path.join(directory, 'JavaRepair.bat'), repairBat, 'ascii');
    fs.writeFileSync(path.join(directory, 'JavaRepair.ps1'), repairPs1);
    const command = 'chcp 65001>nul & echo.|call JavaRepair.bat';
    const result = cp.spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', command], { cwd: directory, encoding: 'utf8', timeout: 30000 });
    assert.notEqual(result.status, null, '修复 BAT 不能在缺少检测脚本时卡死');
    assert.match(result.stdout + result.stderr, /请把本文件和检测脚本放在同一个文件夹里/);
    assert.match(result.stdout + result.stderr, /按任意键|Press any key/i, 'BAT 缺文件后仍应 pause，避免窗口一闪而过');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('N28/Q19: Store ZIP 的 UTF-8 标志、CRC、偏移和五个文件均可独立验证', async () => {
  const original = makeEntries();
  const zip = await makeZip(original);
  const parsed = parseZipIndependently(zip);
  assert.deepEqual(parsed.map(entry => entry.name), ZIP_NAMES, 'ZIP 应只含四个脚本和 README_FIRST.txt');
  assert.ok(parsed.every(entry => /^[\x20-\x7e]+$/.test(entry.name)), 'ZIP 内五个固定文件名必须全部是 ASCII');
  for (const entry of parsed) {
    assert.equal(entry.flags & 0x0800, 0x0800, `${entry.name} 必须设置 ZIP UTF-8 文件名标志 bit 11`);
    assert.equal(entry.method, 0, `${entry.name} 必须使用透明的 Store（不压缩）模式`);
    assert.equal(entry.versionNeeded, 20, `${entry.name} 必须填写合理的 version needed to extract`);
    assert.notEqual(entry.externalAttributes, 0, `${entry.name} 必须填写合理的外部属性`);
    const source = original.find(item => item.name === entry.name);
    assert.deepEqual(entry.data, Buffer.from(source.data), `${entry.name} 解压字节必须与生成前完全一致`);
  }
  assert.deepEqual(parsed.filter(entry => /\.ps1$/i.test(entry.name)).map(entry => entry.data.subarray(0, 3)), [UTF8_BOM, UTF8_BOM], '两个 PS1 必须为 UTF-8 BOM');
  const first = parsed.find(entry => entry.name === 'README_FIRST.txt').data;
  assert.ok(first.subarray(0, 3).equals(UTF8_BOM), 'README_FIRST.txt 必须为 UTF-8 BOM，供记事本正确显示中文');
  const readme = first.subarray(3).toString('utf8');
  assert.match(readme, /先双击\s*JavaCheck\.bat/);
  assert.match(readme, /只有网页提示需要修复时.*JavaRepair\.bat/s);
  assert.match(readme, /不要.*管理员/);
  assert.match(readme, /安全软件/);

  const fromProductParser = need(Checker, 'parseZip')(zip);
  assert.deepEqual(fromProductParser.map(entry => entry.name), ZIP_NAMES, '产品 ZIP 解析器必须保留条目顺序和文件名');
  for (const entry of fromProductParser) {
    assert.equal(entry.flags & 0x0800, 0x0800, `产品 ZIP 解析器没有报告 UTF-8 flag：${entry.name}`);
    const independent = parsed.find(item => item.name === entry.name);
    assert.deepEqual(Buffer.from(entry.data), independent.data, `产品 ZIP 解析器数据错误：${entry.name}`);
  }
});

test('N28: ZIP 写入器正确处理 UTF-8 中文文件名和 / 路径分隔符', async () => {
  const source = [{ name: '说明/中文 测试.txt', data: Buffer.from('\\ufeff中文内容\\r\\n', 'utf8') }];
  const parsed = parseZipIndependently(await makeZip(source));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, source[0].name);
  assert.equal(parsed[0].flags & 0x0800, 0x0800);
  assert.equal(parsed[0].name.includes('\\'), false, 'ZIP 内路径一律使用 /');
  assert.deepEqual(parsed[0].data, source[0].data);
});

test('N28: PowerShell Expand-Archive 能解压并字节级还原五个文件', { skip: process.platform !== 'win32' }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'java-check-expand-'));
  try {
    const original = makeEntries();
    const archive = path.join(directory, 'JavaIDEA自检工具.zip');
    const destination = path.join(directory, 'out');
    fs.writeFileSync(archive, await makeZip(original));
    const escapedArchive = archive.replace(/'/g, "''");
    const escapedDestination = destination.replace(/'/g, "''");
    const command = "Expand-Archive -LiteralPath '" + escapedArchive + "' -DestinationPath '" + escapedDestination + "' -Force";
    const result = cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr + (result.error || ''));
    for (const entry of original) assert.deepEqual(fs.readFileSync(path.join(destination, entry.name)), Buffer.from(entry.data), `Expand-Archive 内容不一致：${entry.name}`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('N30/Q21: 免下载路径的中文版本输出只覆盖 Java，B 区恒为人工确认', () => {
  const text = [
    'JAVA_HOME=C:\\Java\\jdk-25',
    'openjdk 版本 "25.0.1" 2025-10-15',
    'javac 25.0.1',
    'C:\\Java\\jdk-25\\bin\\javac.exe'
  ].join('\r\n');
  const analysis = analysisFromManual(text);
  assert.equal(getCard(analysis, '简化 Java 环境检查').status, 'PASS');
  const bCards = analysis.cards.filter(card => card.area === 'B');
  assert.ok(bCards.length > 0, '免下载结果仍必须展示学生认证人工步骤');
  assert.ok(bCards.every(card => card.status === 'MANUAL'), '免下载路径不得给学生认证任何通过结论');
  const bText = bCards.map(card => card.name + '\\n' + card.advice).join('\\n');
  assert.match(bText, /这是简化检查，只覆盖 Java 环境/);
  assert.match(bText, /Manage Subscriptions/);
  assert.match(bText, /Refresh license list/);
  assert.match(bText, /Activate/);
  assert.doesNotMatch(bText, /认证成功|认证正常/);
});

test('Q21: 免下载路径缺少 javac.exe 必须是专项 FAIL，并给出具体原因', () => {
  const text = [
    'JAVA_HOME=C:\\Java\\jre-8',
    'java version "1.8.0_431"',
    "'javac' 不是内部或外部命令，也不是可运行的程序或批处理文件。",
    'JAVAC_PATH='
  ].join('\r\n');
  const analysis = analysisFromManual(text);
  const compiler = getCard(analysis, '简化 Java 环境检查');
  assert.equal(compiler.status, 'FAIL');
  assert.match(compiler.advice, /没有找到编译器 javac\.exe|不能编译|安装 JDK/);
});

test('N31: PowerShell 3 兼容静态契约禁止高风险/高版本未降级语法', { skip: process.platform !== 'win32' }, () => {
  const scripts = [need(Templates, 'buildCheckerPs1')(Checker.EDU_DOMAIN_WHITELIST), need(Templates, 'buildRepairPs1')()];
  for (const script of scripts) {
    const commands = powershellAstCommandNames(script).map(command => command.toLowerCase());
    for (const forbidden of ['invoke-expression', 'iex', 'downloadstring', 'get-filehash']) assert.equal(commands.includes(forbidden), false, `禁止命令仍出现：${forbidden}`);
    assert.doesNotMatch(script, /\b(?:-EncodedCommand|FromBase64String|PAYLOAD_BEGIN|set\s+"SELF=)\b/i, '第五轮已废止 Base64 自解码机制');
    assert.doesNotMatch(script, /\bGet-ChildItem\b[^\r\n]*\s-Depth\b/i, 'PS 4+ Get-ChildItem -Depth 必须降级实现');
    assert.doesNotMatch(script, /\bWhere-Object\s+(?!\{|(?:-FilterScript\b))/i, 'Where-Object 必须使用 PS 3 兼容脚本块语法');
    if (commands.includes('set-clipboard') || commands.includes('get-clipboard')) {
      assert.match(script, /Get-Command\s+(?:-Name\s+)?['"]?Set-Clipboard/i, 'Set-Clipboard 使用前必须 Get-Command 探测');
      assert.match(script, /Get-Command\s+(?:-Name\s+)?['"]?Get-Clipboard/i, 'Get-Clipboard 使用前必须 Get-Command 探测');
      assert.match(script, /clip\.exe/i, '剪贴板 cmdlet 缺失时必须有 clip.exe 兜底');
    }
    assert.match(script, /PSVersionTable\.PSVersion\.Major[\s\S]{0,120}(?:-lt|<)\s*3/i, '必须有 PS 3.0 最低版本 guard');
  }
});

test('N31: 模拟没有剪贴板 cmdlet 的环境仍将 result.txt 落盘', { skip: process.platform !== 'win32' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'java-check-ps3-'));
  try {
    const checker = path.join(directory, 'JavaCheck.ps1');
    fs.writeFileSync(checker, withBom(need(Templates, 'buildCheckerPs1')(Checker.EDU_DOMAIN_WHITELIST)));
    // Force the fallback path to fail quickly without touching the real clipboard.
    // A copied cmd.exe can consume JSON as batch input and hang on hosted runners.
    fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', 'where.exe'), path.join(directory, 'clip.exe'));
    const escapedChecker = checker.replace(/'/g, "''");
    const escapedDirectory = directory.replace(/'/g, "''");
    const command = "$original=Microsoft.PowerShell.Core\\Get-Command;function Get-Command {param([Parameter(Position=0)]$Name,[Parameter(ValueFromRemainingArguments=$true)]$Rest) if([string]$Name -match '^(Set|Get)-Clipboard$'){return $null}; & $original $Name @Rest};$env:Path='" + escapedDirectory.replace(/'/g, "''") + ";'+$env:Path;& '" + escapedChecker + "' -OutputDirectory '" + escapedDirectory + "'";
    const result = cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, result.stdout + result.stderr + (result.error || ''));
    const report = path.join(directory, 'result.txt');
    assert.ok(fs.existsSync(report), '没有剪贴板 cmdlet 时仍必须写入 result.txt');
    const json = JSON.parse(fs.readFileSync(report, 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(json.schemaVersion, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Q22/N29: 新页面只保留 ZIP 下载入口，离线版有 file:// 哈希降级提示', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /下载一个压缩包，解压后双击检测脚本/);
  assert.doesNotMatch(html, /只需下载一个文件|再次下载检测 BAT|一键检测\.bat/);
  assert.equal((html.match(/id=["']generate["']/g) || []).length, 1, '页面应只有一个主下载入口');
  assert.doesNotMatch(html, /id=["']download["']/i, '不得保留独立再次下载 BAT 按钮');
  const offline = path.join(__dirname, '..', 'dist', 'JavaIDEA自检工具-离线版.html');
  assert.ok(fs.existsSync(offline), '必须提供 file:// 可打开的离线版 HTML');
  const offlineHtml = fs.readFileSync(offline, 'utf8');
  assert.match(offlineHtml, /(?:window|root)\.crypto\s*&&\s*(?:window|root)\.crypto\.subtle/);
  assert.match(offlineHtml, /离线版无法自动计算哈希，请以 GitHub Release 页面公布的 SHA-256 为准/);
  assert.doesNotMatch(offlineHtml, /<script[^>]+https?:\/\//i, '离线版不能加载外部脚本');
  assert.doesNotMatch(offlineHtml, /\b(?:fetch|XMLHttpRequest)\s*\(/, '离线版不能发起网络请求');
});
