(function (root) {
  'use strict';

  const SCHEMA = 1;
  const RELEASE_URL = 'https://github.com/765785/java-idea-checker/releases';
  const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
  const encoder = typeof TextEncoder === 'undefined' ? null : new TextEncoder();
  const decoder = typeof TextDecoder === 'undefined' ? null : new TextDecoder('utf-8');
  let crcTable;

  const pathKey = value => String(value || '').trim().replace(/^"|"$/g, '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const mask = text => String(text == null ? '' : text).replace(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (all, domain) => all[0] + '***@' + domain);

  function encode(text) {
    if (encoder) return encoder.encode(String(text));
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(String(text), 'utf8'));
    throw Error('当前浏览器不支持文本编码，无法生成工具包。');
  }
  function decode(bytes) {
    if (decoder) return decoder.decode(bytes);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('utf8');
    throw Error('当前浏览器不支持文本解码。');
  }
  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return new Uint8Array(value);
    return encode(value);
  }
  function combine(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    parts.forEach(part => { output.set(part, offset); offset += part.length; });
    return output;
  }
  function bomText(text) {
    const bytes = toBytes(text);
    return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes : combine([BOM, bytes]);
  }

  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let index = 0; index < 256; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
        crcTable[index] = value >>> 0;
      }
    }
    let value = 0xffffffff;
    for (let index = 0; index < bytes.length; index++) value = (value >>> 8) ^ crcTable[(value ^ bytes[index]) & 0xff];
    return (value ^ 0xffffffff) >>> 0;
  }
  function write16(bytes, offset, value) { new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true); }
  function write32(bytes, offset, value) { new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value >>> 0, true); }
  function read16(bytes, offset) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true); }
  function read32(bytes, offset) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true); }
  function dosStamp(value) {
    const date = value instanceof Date && value.getFullYear() >= 1980 ? value : new Date(1980, 0, 1);
    return { time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | Math.floor(date.getSeconds() / 2), date: (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31) };
  }

  // Minimal ZIP Store writer. It writes all required headers itself and has no dependencies.
  function createZip(entries, timestamp) {
    if (!Array.isArray(entries) || !entries.length) throw Error('工具包中没有可写入的文件。');
    const stamp = dosStamp(timestamp || new Date());
    const localParts = [];
    const records = [];
    let offset = 0;
    entries.forEach(entry => {
      const name = String(entry.name || '').replace(/\\/g, '/');
      if (!name || name[0] === '/' || name.indexOf('..') >= 0) throw Error('ZIP 文件名不安全：' + name);
      const nameBytes = encode(name);
      const data = toBytes(entry.data);
      const crc = crc32(data);
      const local = new Uint8Array(30);
      write32(local, 0, 0x04034b50); write16(local, 4, 20); write16(local, 6, 0x0800); write16(local, 8, 0);
      write16(local, 10, stamp.time); write16(local, 12, stamp.date); write32(local, 14, crc);
      write32(local, 18, data.length); write32(local, 22, data.length); write16(local, 26, nameBytes.length); write16(local, 28, 0);
      localParts.push(local, nameBytes, data);
      records.push({ name, nameBytes, data, crc, offset });
      offset += local.length + nameBytes.length + data.length;
    });
    const centralOffset = offset;
    const centralParts = [];
    records.forEach(record => {
      const central = new Uint8Array(46);
      write32(central, 0, 0x02014b50); write16(central, 4, 0x0314); write16(central, 6, 20); write16(central, 8, 0x0800); write16(central, 10, 0);
      write16(central, 12, stamp.time); write16(central, 14, stamp.date); write32(central, 16, record.crc);
      write32(central, 20, record.data.length); write32(central, 24, record.data.length); write16(central, 28, record.nameBytes.length);
      write16(central, 30, 0); write16(central, 32, 0); write16(central, 34, 0); write16(central, 36, 0); write32(central, 38, 0x20); write32(central, 42, record.offset);
      centralParts.push(central, record.nameBytes);
      offset += central.length + record.nameBytes.length;
    });
    const end = new Uint8Array(22);
    write32(end, 0, 0x06054b50); write16(end, 4, 0); write16(end, 6, 0); write16(end, 8, records.length); write16(end, 10, records.length);
    write32(end, 12, offset - centralOffset); write32(end, 16, centralOffset); write16(end, 20, 0);
    return combine(localParts.concat(centralParts, [end]));
  }

  function parseZip(input) {
    const bytes = toBytes(input);
    let eocd = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
      if (read32(bytes, offset) === 0x06054b50) { eocd = offset; break; }
    }
    if (eocd < 0) throw Error('ZIP 缺少目录结尾。');
    const count = read16(bytes, eocd + 10);
    let cursor = read32(bytes, eocd + 16);
    const entries = [];
    for (let index = 0; index < count; index++) {
      if (read32(bytes, cursor) !== 0x02014b50) throw Error('ZIP 中央目录损坏。');
      const flags = read16(bytes, cursor + 8);
      const crc = read32(bytes, cursor + 16);
      const size = read32(bytes, cursor + 24);
      const nameLength = read16(bytes, cursor + 28);
      const extraLength = read16(bytes, cursor + 30);
      const commentLength = read16(bytes, cursor + 32);
      const localOffset = read32(bytes, cursor + 42);
      const name = decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
      if (read32(bytes, localOffset) !== 0x04034b50) throw Error('ZIP 本地文件头损坏：' + name);
      const localNameLength = read16(bytes, localOffset + 26);
      const localExtraLength = read16(bytes, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = bytes.slice(dataStart, dataStart + size);
      if (data.length !== size || crc32(data) !== crc) throw Error('ZIP CRC 校验失败：' + name);
      entries.push({ name, data, flags, crc, size, localOffset });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    entries.entries = entries;
    return entries;
  }

  function parseResult(text) {
    const source = String(text).replace(/^\uFEFF/, '').trim();
    if (!source) throw Error('还没有检测结果。请粘贴内容、拖入 result.txt，或使用下方免下载检查命令。');
    if (source.length > 8 * 1024 * 1024) throw Error('结果超过 8 MB，请重新运行检测脚本。');
    const candidates = [source];
    let start = -1; let depth = 0; let quoted = false; let escaped = false;
    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      if (start < 0) { if (char === '{') { start = index; depth = 1; } continue; }
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
      else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) { candidates.push(source.slice(start, index + 1)); start = -1; }
    }
    let data;
    candidates.forEach(candidate => {
      if (data) return;
      try { const result = JSON.parse(candidate); if (result && typeof result === 'object' && 'schemaVersion' in result) data = result; } catch (_) { /* Search the next complete JSON block. */ }
    });
    if (!data) throw Error(start >= 0 ? 'JSON 没有复制完整，缺少结尾。请重新复制，或拖入完整 result.txt。' : '没有找到有效的检测 JSON。若你使用了免下载命令，请完整复制 PowerShell 输出。');
    if (data.schemaVersion !== SCHEMA) throw Error('检测脚本版本过旧或不兼容，请重新生成工具包。');
    ['meta', 'env', 'exec', 'javaProbe', 'idea', 'emailScan'].forEach(key => {
      if (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key])) throw Error('检测结果缺少或损坏字段：' + key + '。请重新检测。');
    });
    if (!Array.isArray(data.javaProbe.candidates) || !Array.isArray(data.idea.installations)) throw Error('候选目录或 IDEA 列表格式不正确，请重新检测。');
    [data.javaProbe.candidates, data.idea.installations, data.jetbrainsDirs || [], data.jetbraTrace || []].forEach(list => {
      if (!Array.isArray(list) || list.some(item => !item || typeof item !== 'object')) throw Error('检测列表包含损坏的条目，请重新检测。');
    });
    if (!Number.isFinite(Date.parse(data.meta.collectedAt))) throw Error('采集时间字段无效，请重新检测。');
    return data;
  }

  function versionMajor(value) {
    const match = String(value || '').match(/(?:^|\s)(?:1\.)?(\d+)(?:[._+\-]|\s|$)/);
    return match ? Number(match[1]) : 0;
  }
  function findVersion(source, kind) {
    const patterns = kind === 'java'
      ? [/(?:^|\n)\s*(?:(?:openjdk|java)(?:\s+java)?)\s+(?:version|版本)\s+["']?([0-9][^"'\r\n\s]*)/im, /(?:^|\n)\s*openjdk\s+([0-9]+(?:\.[0-9]+)*(?:[+_\-][^\s]+)?)/im, /(?:^|\n)\s*java\s+([0-9]+(?:\.[0-9]+)*(?:[+_\-][^\s]+)?)/im]
      : [/(?:^|\n)\s*javac(?:\s+(?:version|版本))?\s+["']?([0-9][^"'\r\n\s]*)/im];
    for (let index = 0; index < patterns.length; index++) { const match = String(source).match(patterns[index]); if (match) return match[1]; }
    return '';
  }

  function parseManualResult(text) {
    const source = String(text).replace(/^\uFEFF/, '');
    const home = source.match(/(?:^|\r?\n)\s*JAVA_HOME\s*=\s*([^\r\n]*)/i);
    const javaVersion = findVersion(source, 'java');
    const javacVersion = findVersion(source, 'javac');
    const path = source.match(/(?:^|\r?\n)\s*([A-Za-z]:\\[^\r\n]*?\\javac\.exe)\s*(?=\r?$|\n)/im);
    const javacPath = path ? path[1].trim() : '';
    if (!home && !javaVersion && !javacVersion && !javacPath) throw Error('没有识别到 JAVA_HOME、java 或 javac 输出。请在 Windows PowerShell 中重新粘贴“复制检查命令”生成的整段内容。');
    const javaOK = Boolean(javaVersion);
    const javacOK = Boolean(javacVersion && javacPath);
    const javacOutput = javacVersion ? 'javac ' + javacVersion + (javacPath ? '\n' + javacPath : '\n未找到 javac.exe 路径') : '未找到 javac 版本或 javac.exe 路径';
    return {
      schemaVersion: SCHEMA, manualOnly: true,
      meta: { collectedAt: new Date().toISOString(), user: '手动检查（未采集）', source: 'manual-command' },
      env: { effectiveJavaHome: home ? home[1].trim() : '', path: '', classpath: '' },
      exec: { java: { exitCode: javaOK ? 0 : 1, output: javaVersion ? 'java version ' + javaVersion : '未找到 java 版本输出' }, javac: { exitCode: javacOK ? 0 : 1, output: javacOutput }, settings: { exitCode: -1, output: '' } },
      javaProbe: { home: { path: pathKey(home ? home[1] : ''), valid: false }, candidates: javaOK && javacOK ? [{ path: pathKey(home ? home[1] : javacPath.replace(/\\bin\\javac\.exe$/i, '')), major: versionMajor(javacVersion), valid: true, source: 'manual' }] : [], runtimeMatchesHome: null, compilerMatchesHome: null, runtimeMajor: versionMajor(javaVersion), compilerMajor: versionMajor(javacVersion), pathIncludesHome: null, whereJava: [], whereJavac: javacPath ? [javacPath] : [], forwarders: [], manualJavacPath: javacPath },
      idea: { installations: [] }, jetbrainsDirs: [], jetbraTrace: [], emailScan: { tier: 'NOT_FOUND', evidence: [], scanned: 0, truncated: false }
    };
  }
  function parseAnyResult(text) {
    try { return parseResult(text); } catch (jsonError) {
      if (/JAVA_HOME\s*=|(?:openjdk|java)(?:\s+java)?\s+(?:version|版本)|javac/i.test(String(text))) return parseManualResult(text);
      throw jsonError;
    }
  }

  function card(cards, area, name, status, value, advice) {
    let output;
    try { output = typeof value === 'string' ? value : JSON.stringify(value, null, 2); } catch (_) { output = String(value); }
    cards.push({ area, name, status, value: mask(output), advice });
  }
  function commandWorks(command) { return Boolean(command && command.exitCode === 0 && /(?:version\s+"?\d|版本\s+"?\d|javac\s+\d|openjdk\s+\d)/i.test(command.output || '')); }

  function analyzeManual(data) {
    const cards = [];
    const javaOK = commandWorks(data.exec.java);
    const javacPath = data.javaProbe.manualJavacPath || '';
    const javacOK = commandWorks(data.exec.javac) && Boolean(javacPath);
    card(cards, 'A', '简化 Java 环境检查', javaOK && javacOK ? 'PASS' : 'FAIL', { JAVA_HOME: data.env.effectiveJavaHome || '未设置', java: data.exec.java.output, javac: data.exec.javac.output, javacPath: javacPath || '未找到' }, javaOK && javacOK ? 'java 与 javac 均已找到。此路径只核对核心 Java 环境，完整路径一致性请运行 ZIP 内的 JavaCheck.bat。' : !javacPath ? '没有找到编译器 javac.exe。你可能只安装了 JRE，或 javac 没有加入 Path；请安装完整 JDK 或运行完整检测。' : '请确认 JAVA_HOME、Path、java 和 javac 输出后重新检查。');
    card(cards, 'A', 'JAVA_HOME（简化信息）', data.env.effectiveJavaHome ? 'MANUAL' : 'FAIL', data.env.effectiveJavaHome || '未设置', data.env.effectiveJavaHome ? '免下载检查无法访问磁盘验证该目录；完整检测可检查 bin\\javac.exe。' : '未看到 JAVA_HOME。完整检测或 ZIP 内的 JavaRepair.bat 可以给出更准确建议。');
    const boundary = '这是简化检查，只覆盖 Java 环境。学生认证仍需运行完整检测脚本，或按下面的三步手动确认。';
    card(cards, 'B', 'IDEA 学生认证', 'MANUAL', '免下载路径不会扫描 IDEA、Toolbox 或教育邮箱。', boundary + ' Manage Subscriptions → 找不到教育包时 Refresh license list → 选择教育包并 Activate。');
    const failed = cards.some(item => item.area === 'A' && item.status === 'FAIL');
    return { cards, summary: failed ? 'Java 环境的简化检查发现问题，需要安装或配置完整 JDK。' : 'Java 核心命令可以运行；学生认证尚未检查。', status: failed ? 'FAIL' : 'MANUAL', repair: failed, repairLabel: '运行 ZIP 内的 JavaRepair.bat', data, manual: true, manualNotice: boundary };
  }

  function analyze(data) {
    if (data && data.manualOnly) return analyzeManual(data);
    const cards = [];
    const probe = data.javaProbe;
    const candidates = probe.candidates.filter(item => item.valid === true);
    const home = probe.home || {};
    const javaOK = commandWorks(data.exec.java);
    const javacOK = commandWorks(data.exec.javac);
    const complete = candidates.length > 0;
    const jreOnly = javaOK && !javacOK && !complete;
    card(cards, 'A', '是否为完整 JDK（含编译器）', complete ? 'PASS' : 'FAIL', candidates.map(item => item.path + ' · JDK ' + item.major).join('\n') || '未找到可运行的完整 JDK', jreOnly ? '当前只有 Java 运行能力（可能是 JRE 或文件不完整），不能编译 Java 程序。请安装 JDK（Java 开发工具包）。' : complete ? '可复用已有 JDK，无需重复下载。' : '请安装 JDK；绿色解压版同样可以使用。');
    card(cards, 'A', 'JAVA_HOME', home.valid === true ? 'PASS' : home.error ? 'MANUAL' : 'FAIL', { raw: data.env.effectiveJavaHome, normalized: home.path }, home.valid ? '目录检查通过；带引号、末尾斜杠或 bin 的写法可在修复时规范化。' : probe.diskUnavailable ? '路径指向的磁盘现在不可用，请接回磁盘或选择本机 JDK。' : /[\\/]jre[\\/]?$/i.test(data.env.effectiveJavaHome || '') ? '你指向了 jre 子目录，应选择完整 JDK 的根目录。' : 'JAVA_HOME 应指向包含 bin\\javac.exe 的 JDK 根目录。');
    card(cards, 'A', 'Path 中的 JDK', probe.pathIncludesHome === true ? 'PASS' : probe.pathIncludesHome == null ? 'MANUAL' : 'FAIL', data.env.path, '接受可展开的 %JAVA_HOME%\\bin 或等价绝对路径。修复只修改你的用户 Path。');
    card(cards, 'A', 'java / javac 实际执行', javaOK && javacOK ? 'PASS' : 'FAIL', 'java:\n' + ((data.exec.java && data.exec.java.output) || '无输出') + '\njavac:\n' + ((data.exec.javac && data.exec.javac.output) || '无输出'), javaOK && javacOK ? '两条命令均成功，这是可用性的黄金标准。' : '需同时能运行 java 与 javac；仅有 java 不能编译。');
    const consistency = probe.runtimeMatchesHome === false || probe.compilerMatchesHome === false || (probe.runtimeMajor && probe.compilerMajor && probe.runtimeMajor !== probe.compilerMajor) ? 'FAIL' : probe.runtimeMatchesHome === true && probe.compilerMatchesHome === true ? 'PASS' : 'WARN';
    card(cards, 'A', '实际 JDK 与配置是否一致', consistency, { JAVA_HOME: home.path, javaHome: probe.runtimeHome, java: probe.whereJava, javac: probe.whereJavac }, consistency === 'FAIL' ? '你配置的是 ' + home.path + '，但实际运行来源不同。若系统 Path 中旧 Java 排在前面，需要管理员处理。' : consistency === 'PASS' ? '实际运行来源与 JAVA_HOME 一致。' : '运行来源证据不足，不能仅凭转发器路径判断版本不一致。');
    if (probe.forwarders && probe.forwarders.length) card(cards, 'A', 'Java 转发器', consistency === 'FAIL' ? 'WARN' : consistency, probe.forwarders, '检测到系统搜索路径中存在 Java 转发器（如 javapath / WindowsApps）。它可能改变实际版本；以 JVM 的 java.home 为依据。');
    const newer = candidates.filter(item => item.major > (probe.runtimeMajor || 0)).sort((a, b) => b.major - a.major)[0];
    if (newer && probe.runtimeMajor) card(cards, 'A', '本机其他 JDK 版本', 'WARN', '当前 ' + probe.runtimeMajor + '；另有 ' + newer.major, '当前生效的是 JDK ' + probe.runtimeMajor + '，本机还检测到 JDK ' + newer.major + '。课程若要求 ' + newer.major + '，可在 IDEA 的 Project SDK 里单独选择；本工具不会擅自替你切换。');
    if (probe.archWarning) card(cards, 'A', 'JDK 架构', 'WARN', probe.archWarning, '如果能够正常执行，一般不影响入门；安装新 JDK 时选择与 Windows 匹配的架构。');
    card(cards, 'A', 'CLASSPATH', /%JAVA_HOME%[\\/]lib/i.test(data.env.classpath || '') ? 'PASS' : 'WARN', data.env.classpath || '未设置', '现代 Java 通常不需要全局 CLASSPATH；这是非致命提示，一键修复不会修改它。');
    card(cards, 'A', '旧版 JRE 子目录', probe.jreBinExists ? 'PASS' : 'WARN', probe.jreBinExists ? '存在' : '未发现独立 jre\\bin', 'JDK 9 及以后通常没有独立 jre 目录，不需要为此安装或修复。');
    card(cards, 'A', 'jetbra / pojie 残留变量', data.jetbraTrace && data.jetbraTrace.some(item => item.matched) ? 'WARN' : 'PASS', data.jetbraTrace || [], '仅报告变量名，不自动清理变量、文件或 IDEA 配置。请联系助教核对后再处理。');
    const installs = data.idea.installations;
    card(cards, 'B', 'IDEA 安装与版本', installs.length ? 'PASS' : 'MANUAL', installs.length ? installs : '未检测到 IDEA', installs.length ? '展示所有版本，最新版本排在前面。' : '未检测到 IDEA，请先安装 IDEA 再做学生认证。这不影响 Java 环境结论。');
    card(cards, 'B', 'JetBrains / Toolbox 配置', data.jetbrainsDirs && data.jetbrainsDirs.some(item => item.exists && item.children && item.children.length) ? 'PASS' : 'MANUAL', data.jetbrainsDirs || [], 'IDEA 已安装但还没有启动记录时，请先启动一次再检测。Toolbox 登录后，IDEA 通常可沿用账号信息。');
    const labels = { EMAIL_EXACT: ['PASS', '高可信（邮箱级证据）'], DOMAIN_ONLY: ['WARN', '中可信（域名级证据）'], OTHER_EMAIL: ['WARN', '可能登录了另一个账号，需人工确认'], NOT_FOUND: ['MANUAL', '配置里没找到字符串证据，不等于认证失败，只说明本机未留下可自动比对的痕迹。你也可能填写的不是 IDEA 里登录的那个邮箱。'] };
    const label = labels[data.emailScan.tier] || ['MANUAL', '未输入邮箱或没有足够证据'];
    card(cards, 'B', '教育邮箱反查', label[0], { tier: data.emailScan.tier, evidence: data.emailScan.evidence, scanned: data.emailScan.scanned, truncated: data.emailScan.truncated }, label[1] + ' 文件可能包含旧账号或插件作者邮箱；字符串证据不证明当前登录账号，也不证明许可证已激活。');
    const failures = cards.filter(item => item.area === 'A' && item.status === 'FAIL');
    const summary = !complete ? jreOnly ? '你当前只有 Java 运行能力，不能编译代码，需要安装完整 JDK。' : '你的电脑未找到可用 Java 开发工具（JDK），需要先安装。' : failures.length ? consistency === 'FAIL' ? 'JDK 已安装，但实际运行的版本与配置不一致。' : 'JDK 装好了，但环境变量没配对。' : newer ? '当前 JDK 可以使用，本机另有更新版本，请按课程要求选择。' : 'Java 核心检查通过，可以开始使用；请留意下方提示。';
    const repairLabel = !complete
      ? (jreOnly ? '安装 JDK（当前只有运行环境）' : '下载并安装 JDK')
      : '一键修复环境变量（运行 ZIP 内的 JavaRepair.bat）';
    return { cards, summary, status: failures.length ? 'FAIL' : cards.some(item => item.area === 'A' && item.status === 'MANUAL') ? 'MANUAL' : cards.some(item => item.area === 'A' && item.status === 'WARN') ? 'WARN' : 'PASS', repair: failures.length > 0, repairLabel, data, manual: false };
  }

  function packageEntries(email) {
    return [
      { name: 'JavaCheck.bat', data: root.ScriptTemplates.buildCheckerBat() },
      { name: 'JavaCheck.ps1', data: bomText(root.ScriptTemplates.buildCheckerPs1(email)) },
      { name: 'JavaRepair.bat', data: root.ScriptTemplates.buildRepairBat() },
      { name: 'JavaRepair.ps1', data: bomText(root.ScriptTemplates.buildRepairPs1()) },
      { name: 'README_FIRST.txt', data: bomText(root.ScriptTemplates.buildReadmeFirst()) }
    ];
  }
  async function sha256(bytes) {
    if (!(root.crypto && root.crypto.subtle)) return { hash: '', notice: '离线版无法自动计算哈希，请以 GitHub Release 页面公布的 SHA-256 为准。' };
    try {
      const result = await root.crypto.subtle.digest('SHA-256', toBytes(bytes));
      return { hash: Array.from(new Uint8Array(result)).map(value => value.toString(16).padStart(2, '0')).join(''), notice: '' };
    } catch (_) { return { hash: '', notice: '离线版无法自动计算哈希，请以 GitHub Release 页面公布的 SHA-256 为准。' }; }
  }
  function buildHumanReport(analysis) {
    const data = analysis.data;
    const lines = ['Java / IDEA 自检报告', '====================', '一句话结论：' + analysis.summary, '总体状态：' + analysis.status, '采集时间：' + (data.meta.collectedAt || '手动检查时间'), '用户：' + mask(data.meta.user || '未提供'), '教育邮箱：' + mask((data.emailScan && data.emailScan.target) || '未提供'), '', '逐项结果：'];
    analysis.cards.forEach(item => { lines.push('[' + item.area + '] ' + item.name + '：' + item.status, '实际值：' + item.value, '建议：' + item.advice, ''); });
    lines.push('说明：学生认证最终仍需在 IDEA 的订阅管理中人工确认。', '--- 以下为网页解析 JSON，请勿修改 ---', JSON.stringify(data, null, 2));
    return '\uFEFF' + mask(lines.join('\r\n'));
  }

  const api = { SCHEMA, RELEASE_URL, pathKey, mask, crc32, createZip, parseZip, parseResult, parseManualResult, parseAnyResult, analyze, packageEntries, sha256, buildHumanReport };
  root.Checker = api;
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  let analysis;
  const notify = text => { const node = $('notice'); if (node) node.textContent = text; };
  function download(bytes, name, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function setHash(bytes) {
    const target = $('hash-status'); const link = $('release-link'); if (link) link.href = RELEASE_URL; if (!target) return;
    target.textContent = '正在计算本次 ZIP 的 SHA-256…';
    sha256(bytes).then(result => { target.textContent = result.hash ? '本次 ZIP SHA-256：' + result.hash : result.notice; });
  }
  function updateEmailHint() {
    const email = $('email').value.trim(); const hint = $('email-hint'); if (!hint) return;
    hint.textContent = /@(qq\.com|163\.com|126\.com|gmail\.com|outlook\.com|hotmail\.com)$/i.test(email) ? '这个邮箱看起来不是学校邮箱，可能查不到 IDEA 证据，但仍可继续检测 Java 环境。' : '请填写学校发给你的教育邮箱（通常在学校门户或企业微信“学生邮箱”里开通）。QQ 邮箱、163 邮箱不是教育邮箱，填了会查不到。';
  }
  function updateDeviceWarning() {
    const warning = $('device-warning'); if (!warning) return;
    warning.hidden = /Windows/i.test(navigator.userAgent || '') && window.innerWidth >= 720;
  }
  function render() {
    try {
      const data = parseAnyResult($('input').value); analysis = analyze(data); const host = $('cards'); host.replaceChildren();
      $('summary').textContent = analysis.summary; $('overall').textContent = { FAIL: '环境配置未通过', PASS: '环境配置通过', WARN: '核心环境可用，请留意提示', MANUAL: '部分信息需要人工确认' }[analysis.status]; $('overall').className = 'badge ' + analysis.status;
      const age = Math.floor((Date.now() - Date.parse(data.meta.collectedAt)) / 60000);
      $('meta').textContent = '采集时间：' + data.meta.collectedAt + ' · 用户：' + mask(data.meta.user) + '。请确认这是你自己的最新结果。' + (age > 30 ? ' 这是 ' + age + ' 分钟前的结果，建议重新检测。' : age < -5 ? ' 采集时间晚于当前时间，请核对电脑时钟。' : '');
      if ($('manual-boundary')) { $('manual-boundary').hidden = !analysis.manual; $('manual-boundary').textContent = analysis.manual ? analysis.manualNotice : ''; }
      ['A', 'B'].forEach(area => {
        const heading = document.createElement('h3'); heading.textContent = area === 'A' ? 'A. Java 环境配置' : 'B. IDEA 学生认证'; host.append(heading);
        analysis.cards.filter(item => item.area === area).forEach(item => {
          const row = document.createElement('article'); row.className = 'result ' + item.status;
          const title = document.createElement('h4'); title.textContent = item.name;
          const badge = document.createElement('span'); badge.className = 'badge ' + item.status; badge.textContent = { PASS: 'PASS · 通过', FAIL: 'FAIL · 未通过', WARN: 'WARN · 提示', MANUAL: '需人工确认' }[item.status];
          const actual = document.createElement('pre'); actual.textContent = item.value;
          const advice = document.createElement('p'); advice.textContent = item.advice;
          row.append(title, badge, actual, advice); host.append(row);
        });
      });
      $('repair').hidden = !analysis.repair; $('repair').textContent = analysis.repairLabel; $('export').disabled = false; $('confirmation').hidden = false;
      notify('已在浏览器本地完成分析，没有上传任何数据。');
    } catch (error) {
      analysis = null; $('repair').hidden = true; $('export').disabled = true; $('cards').replaceChildren(); $('summary').textContent = '请重新导入完整结果'; $('overall').textContent = ''; $('confirmation').hidden = true;
      if ($('manual-boundary')) $('manual-boundary').hidden = true; notify(error.message);
    }
  }
  async function copyManual() {
    const command = 'Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; "JAVA_HOME=" + $env:JAVA_HOME; java -version 2>&1; javac -version 2>&1; (Get-Command javac -ErrorAction SilentlyContinue).Source';
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(command);
      else { const helper = document.createElement('textarea'); helper.value = command; document.body.append(helper); helper.select(); document.execCommand('copy'); helper.remove(); }
      notify('检查命令已复制。按 Win+X 打开 Windows PowerShell，粘贴并回车后，把完整输出复制到第 2 步。');
    } catch (_) { notify('浏览器没有允许复制。请手动复制页面显示的检查命令。'); }
  }
  function buildPackage() {
    const email = $('email').value.trim();
    if (email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) { notify('请输入完整邮箱，例如 li@school.edu.cn；也可留空后在脚本中输入。'); return; }
    try { localStorage.setItem('java-check-email', email); } catch (_) { /* Browser storage is optional. */ }
    const zip = createZip(packageEntries(email)); download(zip, 'JavaIDEA自检工具.zip', 'application/zip'); setHash(zip);
    notify('已生成 JavaIDEA自检工具.zip。先右键 ZIP → 属性 → 解除锁定，再解压；确认有 4 个脚本文件和 1 个说明 txt 后，双击 JavaCheck.bat。');
  }
  async function importFile(file) {
    if (!file) return; if (file.size > 8 * 1024 * 1024) { notify('文件超过 8 MB，请选择检测生成的 result.txt。'); return; }
    $('input').value = await file.text(); render();
  }
  try { $('email').value = localStorage.getItem('java-check-email') || ''; } catch (_) { notify('浏览器不允许本地保存邮箱，其余功能仍可使用。'); }
  updateEmailHint(); updateDeviceWarning(); window.addEventListener('resize', updateDeviceWarning);
  $('email').addEventListener('input', updateEmailHint); $('generate').addEventListener('click', buildPackage); $('analyze').addEventListener('click', render); $('manual-copy').addEventListener('click', copyManual);
  $('clear').addEventListener('click', () => { try { localStorage.removeItem('java-check-email'); } catch (_) { /* Optional. */ } $('email').value = ''; updateEmailHint(); notify('已清空网页保存的邮箱。已下载 ZIP 中的邮箱需要删除对应文件才能清除。'); });
  $('repair').addEventListener('click', () => notify('请关闭当前黑色窗口，回到刚才解压的同一个文件夹，双击 JavaRepair.bat。修复结束后，再双击 JavaCheck.bat 重新检测。'));
  $('export').addEventListener('click', () => { if (analysis) download(encode(buildHumanReport(analysis)), 'java-idea-check-result.txt', 'text/plain;charset=utf-8'); });
  $('file').addEventListener('change', event => importFile(event.target.files[0]).catch(error => notify(error.message)));
  $('input').addEventListener('dragover', event => event.preventDefault());
  $('input').addEventListener('drop', event => { event.preventDefault(); importFile(event.dataTransfer.files[0]).catch(error => notify(error.message)); });
})(typeof globalThis !== 'undefined' ? globalThis : window);
