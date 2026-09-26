(function (root) {
  'use strict';

  const SCHEMA = 2;
  const PAGE_VERSION = '1.3.0';
  // 换学校时只改这一处；生成的 JavaCheck.ps1 会从这里接收同一份白名单。
  const EDU_DOMAIN_WHITELIST = Object.freeze(['dnui.edu.cn']);
  const RELEASE_URL = 'https://github.com/765785/java-idea-checker/releases';
  const FIXED_ZIP_TIMESTAMP = new Date(1980, 0, 1, 0, 0, 0);
  const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
  const encoder = typeof TextEncoder === 'undefined' ? null : new TextEncoder();
  const decoder = typeof TextDecoder === 'undefined' ? null : new TextDecoder('utf-8');
  let crcTable;

  const pathKey = value => String(value || '').trim().replace(/^"|"$/g, '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const mask = text => String(text == null ? '' : text).replace(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (all, domain) => all[0] + '***@' + domain);
  function normalizeEmail(value) {
    const source = String(value || '').trim().toLowerCase();
    const at = source.lastIndexOf('@');
    if (at <= 0 || at === source.length - 1) return '';
    const local = source.slice(0, at).replace(/\+.*/, '');
    const domain = source.slice(at + 1).replace(/\.+$/, '');
    return local && domain ? local + '@' + domain : '';
  }
  function emailDomain(value) {
    const normalized = normalizeEmail(value);
    return normalized ? normalized.slice(normalized.lastIndexOf('@') + 1) : '';
  }
  function isEduDomain(domain) {
    return EDU_DOMAIN_WHITELIST.indexOf(String(domain || '').trim().toLowerCase().replace(/\.+$/, '')) >= 0;
  }

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
    const stamp = dosStamp(timestamp || FIXED_ZIP_TIMESTAMP);
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

  function jsonCandidates(text) {
    const source = String(text).replace(/^\uFEFF/, '').trim();
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
    return { source, candidates, hasUnclosedObject: start >= 0 };
  }
  function parsedTopLevelJson(text) {
    const source = String(text).replace(/^\uFEFF/, '').trim();
    try {
      const data = JSON.parse(source);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    } catch (_) { return null; }
  }
  function hasDetectionFields(data) {
    return Boolean(data && typeof data === 'object' && ['meta', 'env', 'exec', 'javaProbe', 'idea'].filter(key => Object.prototype.hasOwnProperty.call(data, key)).length >= 2);
  }
  function resultInputRecognition(text) {
    const extracted = jsonCandidates(text);
    const topLevel = parsedTopLevelJson(extracted.source);
    const schemaJson = Boolean(topLevel && Object.prototype.hasOwnProperty.call(topLevel, 'schemaVersion'));
    const fields = hasDetectionFields(topLevel) || extracted.candidates.some(candidate => hasDetectionFields(parsedTopLevelJson(candidate)));
    const manual = /(?:^|\r?\n)\s*JAVA_HOME\s*=|(?:^|\r?\n)\s*(?:openjdk|java)(?:\s+java)?\s+(?:version|版本)\b/im.test(extracted.source);
    const balancedJsonAtStart = /^\s*\{/.test(extracted.source) && extracted.candidates.slice(1).some(candidate => Boolean(parsedTopLevelJson(candidate)));
    return { recognized: schemaJson || fields || manual || balancedJsonAtStart, schemaJson, fields, manual, balancedJsonAtStart };
  }
  function parseResult(text) {
    const source = String(text).replace(/^\uFEFF/, '').trim();
    if (!source) throw Error('还没有检测结果。请粘贴内容、拖入 result.txt，或使用下方免下载检查命令。');
    if (source.length > 8 * 1024 * 1024) throw Error('结果超过 8 MB，请重新运行检测脚本。');
    const extracted = jsonCandidates(source);
    let data;
    extracted.candidates.forEach(candidate => {
      if (data) return;
      try {
        const result = JSON.parse(candidate);
        if (result && typeof result === 'object' && !Array.isArray(result) && (Object.prototype.hasOwnProperty.call(result, 'schemaVersion') || hasDetectionFields(result))) data = result;
      } catch (_) { /* Search the next complete JSON block. */ }
    });
    if (!data) throw Error(extracted.hasUnclosedObject ? 'JSON 没有复制完整，缺少结尾。请重新复制，或拖入完整 result.txt。' : '没有找到有效的检测 JSON。若你使用了免下载命令，请完整复制 PowerShell 输出。');
    if (Object.prototype.hasOwnProperty.call(data, 'schemaVersion') && data.schemaVersion !== SCHEMA) throw Error('你的检测脚本版本较旧，请重新下载最新版 ZIP 并再运行一次。');
    if (!Object.prototype.hasOwnProperty.call(data, 'schemaVersion')) data.schemaVersionMissing = true;
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
      idea: { installations: [] }, jetbrainsDirs: [], jetbraTrace: [], emailScan: { status: 'UNKNOWN', domains: EDU_DOMAIN_WHITELIST.slice(), domainEvidence: [], emailEvidence: [], xmlEvidence: [], credentialManager: { status: 'UNKNOWN', entries: [], errors: [] }, credentialFiles: [], configPresent: false, scanned: 0, truncated: false, errors: ['免下载路径不采集 IDEA 学生认证证据'] }
    };
  }
  function parseAnyResult(text) {
    try { return parseResult(text); } catch (jsonError) {
      const recognition = resultInputRecognition(text);
      if (recognition.manual && !/^\s*\{/.test(String(text))) return parseManualResult(text);
      throw jsonError;
    }
  }
  function crossPasteIssue(text, target) {
    const source = String(text || '').trim();
    if (!source) return null;
    // 框 1 只由 resultInputRecognition 的正向特征决定；这里绝不以网页词反向猜测。
    if (target === 'result') return null;
    const schemaJson = parsedTopLevelJson(source);
    const isDetectionJson = Boolean(schemaJson && Object.prototype.hasOwnProperty.call(schemaJson, 'schemaVersion'));
    const hasSchemaAndHome = /schemaVersion/i.test(source) && /JAVA_HOME/i.test(source);
    if (target === 'portal' && (isDetectionJson || hasSchemaAndHome)) {
      return { target: 'paste-detection', message: '这是检测结果 JSON，请把它粘到 A3 的本机框里，再开始分析。' };
    }
    return null;
  }

  function card(cards, area, name, status, value, advice) {
    let output;
    try { output = typeof value === 'string' ? value : JSON.stringify(value, null, 2); } catch (_) { output = String(value); }
    cards.push({ area, name, status, value: mask(output), advice });
  }
  function commandWorks(command) { return Boolean(command && command.exitCode === 0 && /(?:version\s+"?\d|版本\s+"?\d|javac\s+\d|openjdk\s+\d)/i.test(command.output || '')); }

  function analyzeManual(data, witness, portal) {
    const cards = [];
    const javaOK = commandWorks(data.exec.java);
    const javacPath = data.javaProbe.manualJavacPath || '';
    const javacOK = commandWorks(data.exec.javac) && Boolean(javacPath);
    card(cards, 'A', '简化 Java 环境检查', javaOK && javacOK ? 'PASS' : 'FAIL', { JAVA_HOME: data.env.effectiveJavaHome || '未设置', java: data.exec.java.output, javac: data.exec.javac.output, javacPath: javacPath || '未找到' }, javaOK && javacOK ? 'java 与 javac 均已找到。此路径只核对核心 Java 环境，完整路径一致性请运行 ZIP 内的 JavaCheck.bat。' : !javacPath ? '没有找到编译器 javac.exe。你可能只安装了 JRE，或 javac 没有加入 Path；请安装完整 JDK 或运行完整检测。' : '请确认 JAVA_HOME、Path、java 和 javac 输出后重新检查。');
    card(cards, 'A', 'JAVA_HOME（简化信息）', data.env.effectiveJavaHome ? 'MANUAL' : 'FAIL', data.env.effectiveJavaHome || '未设置', data.env.effectiveJavaHome ? '免下载检查无法访问磁盘验证该目录；完整检测可检查 bin\\javac.exe。' : '未看到 JAVA_HOME。完整检测或 ZIP 内的 JavaRepair.bat 可以给出更准确建议。');
    const boundary = '这是简化检查，只覆盖 Java 环境。学生认证仍需运行完整检测脚本，或按下面的三步手动确认。';
    const student = resolveStudentEvidence(data, witness, portal);
    card(cards, 'B', '机器认证证据', 'MANUAL', '免下载路径不会扫描 IDEA、Toolbox 或教育邮箱。', boundary);
    card(cards, 'B', '人证：IDEA 当前登录账户', 'MANUAL', { email: student.witnessMasked || '未填写', participates: '免下载路径不参与自动升档' }, '免下载路径无法确认 IDEA 是否安装或启动，请在完整检测后再填写 IDEA 当前账户人证。');
    card(cards, 'B', '官网登录回传', student.official.kind === 'WHITELIST' ? 'PASS' : student.official.kind === 'OTHER' ? 'WARN' : 'MANUAL', { loginStatus: student.official.state, emailEvidence: student.official.emails }, student.official.message);
    card(cards, 'B', '最终动作', 'MANUAL', { tier: 'MANUAL', portalLoginStatus: student.official.state }, boundary + ' 回到 IDEA，按 B4 的四步确认自己的 edu 邮箱即可。');
    const failed = cards.some(item => item.area === 'A' && item.status === 'FAIL');
    return { cards, summary: failed ? 'Java 环境的简化检查发现问题，需要安装或配置完整 JDK。' : 'Java 核心命令可以运行；学生认证尚未检查。', status: failed ? 'FAIL' : 'MANUAL', repair: failed, repairLabel: '运行 ZIP 内的 JavaRepair.bat', data, student, manual: true, manualNotice: boundary };
  }

  function machineEvidence(scan, data) {
    const value = scan && typeof scan === 'object' ? scan : {};
    const domainEvidence = Array.isArray(value.domainEvidence) ? value.domainEvidence : [];
    const emailEvidence = Array.isArray(value.emailEvidence) ? value.emailEvidence : [];
    const credentialEntries = value.credentialManager && Array.isArray(value.credentialManager.entries) ? value.credentialManager.entries : [];
    const credentialFiles = Array.isArray(value.credentialFiles) ? value.credentialFiles : [];
    const configPresent = value.configPresent === true || Boolean((data.jetbrainsDirs || []).some(item => item && item.exists && Array.isArray(item.children) && item.children.length));
    const whitelistEvidence = domainEvidence.concat(emailEvidence.filter(item => item && item.kind === 'WHITELIST_EMAIL'));
    const accountOthers = emailEvidence.filter(item => item && item.kind === 'OTHER_EMAIL' && item.accountRelated === true);
    const referenceOthers = emailEvidence.filter(item => item && item.kind === 'OTHER_EMAIL' && item.accountRelated !== true);
    return {
      status: value.status === 'UNKNOWN' ? 'UNKNOWN' : 'OK',
      domainEvidence, emailEvidence, credentialEntries, credentialFiles, configPresent,
      whitelistEvidence, accountOthers, referenceOthers,
      errors: Array.isArray(value.errors) ? value.errors : []
    };
  }
  function extractEmails(text) {
    const found = String(text || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
    return Array.from(new Set(found.map(normalizeEmail).filter(Boolean)));
  }
  function analyzePortalReturn(portal) {
    const text = String(portal && portal.text || '').trim();
    const loginConfirmed = Boolean(portal && portal.loginConfirmed);
    const emails = extractEmails(text);
    const whitelistLiteral = EDU_DOMAIN_WHITELIST.some(domain => new RegExp('(^|[^A-Za-z0-9.-])' + domain.replace(/\./g, '\\.') + '(?=$|[^A-Za-z0-9.-])', 'i').test(text));
    const accountContext = /educational|education|license|licen[cs]e|subscription|account|账户|订阅|教育/i.test(text);
    const loginEntry = /sign\s*in|log\s*in|登录|注册|create\s+account/i.test(text);
    const base = { loginConfirmed, length: text.length, emails: emails.map(mask), whitelistLiteral, rawState: 'NOT_STARTED' };
    if (!loginConfirmed) return Object.assign(base, { state: 'NOT_STARTED', kind: 'NONE', message: '请先在 JetBrains 官方网站完成登录，再点击“我已登录好，下一步”。' });
    if (!text) return Object.assign(base, { state: 'WAITING', kind: 'NONE', message: '请打开订阅管理页，确认右上角为你的教育邮箱后，全选页面文本并粘贴回来。' });
    if (text.length < 200 || (loginEntry && !whitelistLiteral && emails.length === 0) || (!whitelistLiteral && emails.length === 0)) {
      return Object.assign(base, { state: 'NOT_LOGGED_IN', kind: 'NONE', message: '你复制的看起来是未登录的页面，请先回到第一步登录，登录成功后再复制。' });
    }
    if (whitelistLiteral && accountContext) return Object.assign(base, { state: 'LOGGED_IN', kind: 'WHITELIST', message: '官网回传已读到本校教育邮箱域名和订阅页面信息。' });
    if (emails.some(email => isEduDomain(emailDomain(email)))) return Object.assign(base, { state: 'LOGGED_IN', kind: 'WHITELIST', message: '官网回传已读到本校教育邮箱。' });
    if (emails.length) return Object.assign(base, { state: 'LOGGED_IN', kind: 'OTHER', message: '官网回传显示的账户不是本校教育邮箱。请换回 @dnui.edu.cn 账户登录。' });
    return Object.assign(base, { state: 'LOGGED_IN', kind: 'UNKNOWN', message: '已复制页面，但没有读到可核验的账户邮箱；请确认复制的是登录后的订阅管理页。' });
  }
  function resolveStudentEvidence(data, witness, portal) {
    const machine = machineEvidence(data.emailScan, data);
    const installed = Array.isArray(data.idea.installations) && data.idea.installations.length > 0;
    const rawWitness = witness && witness.email ? String(witness.email) : '';
    const normalizedWitness = normalizeEmail(rawWitness);
    const witnessMasked = normalizedWitness ? mask(normalizedWitness) : '';
    const witnessDomain = emailDomain(rawWitness);
    const witnessProvided = Boolean(rawWitness.trim());
    const witnessEligible = witnessProvided && installed && machine.configPresent;
    const witnessKind = !witnessProvided ? 'NONE' : isEduDomain(witnessDomain) ? 'WHITELIST' : witnessDomain ? 'OTHER' : 'INVALID';
    const machineHigh = machine.whitelistEvidence.length > 0;
    const machineMismatch = machine.accountOthers.length > 0;
    const supportingEvidence = machine.credentialEntries.length > 0 || machine.credentialFiles.length > 0;
    const official = analyzePortalReturn(portal);
    let tier = 'MANUAL';
    let source = 'machine';
    if (official.kind === 'WHITELIST') { tier = 'HIGH'; source = 'portal'; }
    else if (official.kind === 'OTHER') { tier = 'MISMATCH'; source = 'portal'; }
    else if (witnessEligible && witnessKind === 'WHITELIST') { tier = 'HIGH'; source = 'witness'; }
    else if (machineHigh) tier = 'HIGH';
    else if (witnessEligible && witnessKind === 'OTHER') { tier = 'MISMATCH'; source = 'witness'; }
    else if (machineMismatch) tier = 'MISMATCH';
    else if (supportingEvidence) { tier = 'MEDIUM'; source = 'machine'; }
    const conflicts = [];
    if (official.kind === 'WHITELIST') {
      if (witnessEligible && witnessKind === 'OTHER') conflicts.push({ source: '人证', email: witnessMasked || '其他邮箱' });
      conflicts.push(...machine.accountOthers);
    } else if (official.kind === 'OTHER') {
      if (witnessEligible && witnessKind === 'WHITELIST') conflicts.push({ source: '人证', email: witnessMasked });
      conflicts.push(...machine.whitelistEvidence);
    } else {
      if (witnessEligible && witnessKind === 'WHITELIST' && machine.accountOthers.length) conflicts.push(...machine.accountOthers);
      if (witnessEligible && witnessKind === 'OTHER' && machineHigh) conflicts.push(...machine.whitelistEvidence);
    }
    return {
      tier, source, machine, installed, witnessProvided, witnessEligible, witnessKind, official,
      witnessEmail: normalizedWitness, witnessMasked,
      witnessConfirmed: Boolean(witness && witness.confirmed), conflicts
    };
  }
  function studentTierCopy(result) {
    if (result.tier === 'HIGH') return ['PASS', result.source === 'portal' ? '高可信：官网登录回传显示本校教育邮箱。' : result.source === 'witness' ? '高可信：IDEA 当前账户人证是本校教育邮箱。' : '高可信：个人电脑的机器证据命中本校教育邮箱域名。'];
    if (result.tier === 'MEDIUM') return ['WARN', '中可信：检测到这台机器登录过 JetBrains 账户的辅助证据，但没读到本校邮箱域名。'];
    if (result.tier === 'MISMATCH') return ['WARN', '明显不符：检测到的当前或账户相关邮箱不是本校教育邮箱。你可能登录错账号了，请换回本校邮箱登录。'];
    if (result.machine.status === 'UNKNOWN') return ['MANUAL', '这项没能检查，可以重跑一次；没找到证据不等于认证失败。'];
    return ['MANUAL', '没找到证据 ≠ 认证失败。请按下方三步在 IDEA 中人工确认。'];
  }
  function analyze(data, witness, portal) {
    if (data && data.manualOnly) return analyzeManual(data, witness, portal);
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
    const student = resolveStudentEvidence(data, witness, portal);
    const machineStatus = student.machine.status === 'UNKNOWN' ? 'MANUAL' : student.machine.whitelistEvidence.length ? 'PASS' : (student.machine.credentialEntries.length || student.machine.credentialFiles.length) ? 'WARN' : 'MANUAL';
    card(cards, 'B', '机器认证证据', machineStatus, {
      ideaInstallations: installs,
      configDirectories: data.jetbrainsDirs || [],
      configPresent: student.machine.configPresent,
      status: student.machine.status,
      domainEvidence: student.machine.domainEvidence,
      emailEvidence: student.machine.emailEvidence,
      credentialEntries: student.machine.credentialEntries,
      credentialFiles: student.machine.credentialFiles,
      xmlEvidence: (data.emailScan && data.emailScan.xmlEvidence) || [],
      errors: student.machine.errors
    }, !installs.length ? '未检测到 IDEA，请先安装并至少启动一次。这不影响 Java 环境结论。' : student.machine.status === 'UNKNOWN' ? '这项没能检查，可以重跑一次。' : student.machine.whitelistEvidence.length ? '个人电脑的账户/配置证据命中本校教育邮箱域名，作为高可信机器证据。' : (student.machine.credentialEntries.length || student.machine.credentialFiles.length) ? '检测到 JetBrains 账户或凭据库辅助证据，但没有读到本校邮箱域名。' : '没有读到自动比对证据；这不等于认证失败。');
    const witnessStatus = !student.witnessProvided ? 'MANUAL' : !student.installed ? 'MANUAL' : !student.machine.configPresent ? 'MANUAL' : student.witnessKind === 'WHITELIST' ? 'PASS' : student.witnessKind === 'OTHER' ? 'WARN' : 'MANUAL';
    const witnessAdvice = !student.witnessProvided
      ? '打开 IDEA → 右上角头像或 Help | Register → Manage Subscriptions，把左下角显示的当前账户邮箱粘贴到本页人证框。'
      : !student.installed
        ? '还没检测到 IDEA，请先安装并启动一次，再来做这一步。'
        : !student.machine.configPresent
          ? '请先启动一次 IDEA 再回来；当前没有检测到配置目录。'
          : student.witnessKind === 'WHITELIST'
            ? '人证为本校教育邮箱，优先于文件扫描证据。'
            : '当前人证不是 @dnui.edu.cn。请在 IDEA 中换回本校教育邮箱登录。';
    card(cards, 'B', '人证：IDEA 当前登录账户', witnessStatus, { email: student.witnessMasked || '未填写', confirmed: student.witnessConfirmed ? '已确认' : '未勾选', participates: student.witnessEligible ? '参与判定' : '暂不参与判定' }, witnessAdvice);
    const portalStatus = student.official.kind === 'WHITELIST' ? 'PASS' : student.official.kind === 'OTHER' ? 'WARN' : 'MANUAL';
    card(cards, 'B', '官网登录回传', portalStatus, { loginStatus: student.official.state, emailEvidence: student.official.emails, textLength: student.official.length, domainLiteral: student.official.whitelistLiteral ? '检测到' : '未检测到' }, student.official.message);
    const label = studentTierCopy(student);
    const conflictNote = student.conflicts.length ? ' 还发现了不同的脱敏邮箱；请以官网登录回传或 IDEA 左下角当前显示的账户为准。' : '';
    card(cards, 'B', '最终动作', label[0], { tier: student.tier, prioritySource: student.source, witness: student.witnessMasked || '未填写', portalLoginStatus: student.official.state, portalEmailEvidence: student.official.emails, machineStatus: student.machine.status, conflicts: student.conflicts }, label[1] + conflictNote + ' 回到 IDEA，按 B4 的四步确认自己的 edu 邮箱即可。教育包是否真的能用，以你在 IDEA 里看到的状态为准。');
    const failures = cards.filter(item => item.area === 'A' && item.status === 'FAIL');
    const summary = !complete ? jreOnly ? '你当前只有 Java 运行能力，不能编译代码，需要安装完整 JDK。' : '你的电脑未找到可用 Java 开发工具（JDK），需要先安装。' : failures.length ? consistency === 'FAIL' ? 'JDK 已安装，但实际运行的版本与配置不一致。' : 'JDK 装好了，但环境变量没配对。' : newer ? '当前 JDK 可以使用，本机另有更新版本，请按课程要求选择。' : 'Java 核心检查通过，可以开始使用；请留意下方提示。';
    const repairLabel = !complete
      ? (jreOnly ? '安装 JDK（当前只有运行环境）' : '下载并安装 JDK')
      : '一键修复环境变量（运行 ZIP 内的 JavaRepair.bat）';
    return { cards, summary, status: failures.length ? 'FAIL' : cards.some(item => item.area === 'A' && item.status === 'MANUAL') ? 'MANUAL' : cards.some(item => item.area === 'A' && item.status === 'WARN') ? 'WARN' : 'PASS', repair: failures.length > 0, repairLabel, data, student, manual: false };
  }

  function packageEntries(domains) {
    const whitelist = Array.isArray(domains) ? domains : EDU_DOMAIN_WHITELIST;
    return [
      { name: 'JavaCheck.bat', data: root.ScriptTemplates.buildCheckerBat() },
      { name: 'JavaCheck.ps1', data: bomText(root.ScriptTemplates.buildCheckerPs1(whitelist)) },
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
    const student = analysis.student || null;
    const machine = student && student.machine;
    const official = student && student.official;
    const machineCard = analysis.cards.find(item => item.area === 'B' && item.name === '机器认证证据');
    const lines = ['Java / IDEA 自检报告', '====================', '一句话结论：' + analysis.summary, '总体状态：' + analysis.status, '采集时间：' + (data.meta.collectedAt || '手动检查时间'), '用户：' + mask(data.meta.user || '未提供'), '', '学生认证证据：', '学生认证结论档位：' + (student ? student.tier : 'MANUAL'), '证据优先来源：' + (student ? student.source : '未采集'), '机器证据档位：' + (machineCard ? machineCard.status : '未采集'), '机器采集状态：' + (machine ? machine.status : '未采集'), '命中文件：' + (machine ? mask(JSON.stringify(machine.whitelistEvidence.concat(machine.accountOthers))) : '未采集'), '凭据管理器条目：' + (machine ? mask(JSON.stringify(machine.credentialEntries)) : '未采集'), '疑似凭据库文件：' + (machine ? mask(JSON.stringify(machine.credentialFiles)) : '未采集'), '人证邮箱：' + (student ? student.witnessMasked || '未填写' : '未填写'), '学生确认：' + (student && student.witnessConfirmed ? '已勾选' : '未勾选'), '官网登录回传登录态：' + (official ? official.state : '未进行'), '官网回传邮箱证据：' + (official ? mask(JSON.stringify(official.emails)) : '未进行'), '官网回传文本不会写入报告：是', '采集异常：' + (machine ? mask(JSON.stringify(machine.errors)) : '未采集'), '', '逐项结果：'];
    analysis.cards.forEach(item => { lines.push('[' + item.area + '] ' + item.name + '：' + item.status, '实际值：' + item.value, '建议：' + item.advice, ''); });
    lines.push('说明：学生认证最终仍需在 IDEA 的订阅管理中人工确认。', '--- 以下为网页解析 JSON，请勿修改 ---', JSON.stringify(data, null, 2));
    return '\uFEFF' + mask(lines.join('\r\n'));
  }

  const api = { SCHEMA, PAGE_VERSION, EDU_DOMAIN_WHITELIST, RELEASE_URL, pathKey, mask, normalizeEmail, emailDomain, isEduDomain, machineEvidence, extractEmails, analyzePortalReturn, resolveStudentEvidence, resultInputRecognition, crossPasteIssue, crc32, createZip, parseZip, parseResult, parseManualResult, parseAnyResult, analyze, packageEntries, sha256, buildHumanReport };
  root.Checker = api;
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  let analysis;
  let portalLoginConfirmed = false;
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
  function updateDeviceWarning() {
    const warning = $('device-warning'); if (!warning) return;
    warning.hidden = /Windows/i.test(navigator.userAgent || '') && window.innerWidth >= 720;
  }
  function updateRefreshNotice() {
    const notice = $('refresh-notice'); if (!notice) return;
    const script = document.querySelector('script[src*="assets/app.js"]');
    let resourceVersion = '';
    try { resourceVersion = script ? new URL(script.src, window.location.href).searchParams.get('v') || '' : ''; } catch (_) { /* Keep the notice hidden when the URL is unavailable. */ }
    notice.hidden = !resourceVersion || resourceVersion === PAGE_VERSION;
  }
  function currentWitness() {
    const email = $('idea-account-email');
    const confirmed = $('idea-account-confirmed');
    return { email: email ? email.value : '', confirmed: Boolean(confirmed && confirmed.checked) };
  }
  function currentPortal() {
    const text = $('paste-licenses');
    const value = text ? text.value : '';
    // B3 可独立粘贴；只要有文本就按登录态规则判断，而不是要求先点确认按钮。
    return { text: value, loginConfirmed: portalLoginConfirmed || Boolean(value.trim()) };
  }
  function setPasteState(id, text, state) {
    const node = $(id); if (!node) return;
    node.textContent = text;
    node.dataset.state = state || 'empty';
  }
  function focusOrExplain(id, message, fallbackId) {
    const node = $(id);
    if (!node) {
      notify(message || '这一步还没准备好，请先完成上一步');
      const fallback = $(fallbackId) || $('paste-detection');
      if (fallback) {
        fallback.scrollIntoView({ behavior: 'smooth', block: 'center' });
        fallback.classList.add('paste-target');
        fallback.focus({ preventScroll: true });
        setTimeout(() => fallback.classList.remove('paste-target'), 1800);
      }
      return false;
    }
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.add('paste-target');
    node.focus({ preventScroll: true });
    setTimeout(() => node.classList.remove('paste-target'), 1800);
    return true;
  }
  function showPasteGuidance(id, issue) {
    const node = $(id); if (!node) return;
    node.replaceChildren();
    if (!issue) return;
    const text = document.createElement('p'); text.textContent = issue.message;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '带我去正确的框';
    button.addEventListener('click', () => focusOrExplain(issue.target, '这一步还没准备好，请先完成上一步', 'paste-detection'));
    node.append(text, button);
  }
  function showInputFailure(message, downloadLink) {
    const node = $('input-guidance'); if (!node) return;
    node.replaceChildren();
    const text = document.createElement('p'); text.textContent = message;
    node.append(text);
    if (downloadLink) {
      const link = document.createElement('a'); link.href = RELEASE_URL; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '下载最新版 ZIP';
      node.append(link);
    }
  }
  function setResultUnlock(unlocked) {
    const hint = $('unlock-hint'); const resultStep = $('result-step'); const recheckStep = $('recheck-step');
    if (hint) hint.hidden = unlocked;
    if (resultStep) resultStep.hidden = !unlocked;
    if (recheckStep) recheckStep.hidden = !unlocked;
  }
  function badgeText(status) {
    return { PASS: 'PASS · 通过', FAIL: 'FAIL · 未通过', WARN: 'WARN · 提示', MANUAL: '需人工确认' }[status] || '需人工确认';
  }
  function setAuthBlock(prefix, item) {
    const badge = $('auth-' + prefix + '-badge');
    const evidence = $('auth-' + prefix + '-evidence');
    const value = $('auth-' + prefix + '-value');
    if (badge) { badge.className = 'badge ' + item.status; badge.textContent = badgeText(item.status); }
    if (evidence) evidence.textContent = item.advice;
    if (value) value.textContent = item.value;
  }
  function renderAuth(analysisResult) {
    const student = analysisResult.student;
    const bCards = name => analysisResult.cards.find(item => item.area === 'B' && item.name === name);
    const machine = bCards('机器认证证据');
    const witness = bCards('人证：IDEA 当前登录账户');
    const portal = bCards('官网登录回传');
    const finalAction = bCards('最终动作');
    if (!student || !machine || !witness || !portal || !finalAction) return;
    setAuthBlock('machine', machine);
    setAuthBlock('witness', witness);
    setAuthBlock('portal', portal);
    setAuthBlock('final', finalAction);
    const summary = $('auth-summary');
    if (summary) summary.textContent = studentTierCopy(student)[1] + ' 证据优先级：官网登录回传 → IDEA 人证邮箱 → 机器证据。';
    const copyStep = $('portal-copy-step');
    if (copyStep) copyStep.hidden = false;
    const back = $('portal-back-login');
    if (back) back.hidden = student.official.state !== 'NOT_LOGGED_IN';
    const finish = $('portal-finish');
    if (finish) finish.hidden = student.official.state !== 'LOGGED_IN';
    if (student.official.state === 'LOGGED_IN') {
      const evidence = student.official.emails.length ? student.official.emails.join('、') : student.official.whitelistLiteral ? 'dnui.edu.cn' : '未读到邮箱';
      setPasteState('portal-paste-state', '已粘贴：检测到域名/邮箱证据 ' + evidence + '。');
    } else if (student.official.state === 'NOT_LOGGED_IN') setPasteState('portal-paste-state', '已粘贴，但看起来仍是未登录页面。');
    else setPasteState('portal-paste-state', $('paste-licenses').value.trim() ? '已粘贴，等待判断。' : '未粘贴官网页面文本');
  }
  function renderStandaloneAuth() {
    const witness = currentWitness();
    const portal = analyzePortalReturn(currentPortal());
    setAuthBlock('machine', { status: 'MANUAL', value: '尚未导入 A 部分检测结果。', advice: '这部分需要 A 部分的检测结果。你可以先做 B2、B3、B4。' });
    setAuthBlock('witness', {
      status: witness.email && witness.confirmed ? 'MANUAL' : 'MANUAL',
      value: witness.email && witness.confirmed ? { email: mask(witness.email), state: '已填写，等待与 A 部分机器证据合并判断' } : '尚未填写',
      advice: witness.email && witness.confirmed ? '已记录脱敏人证邮箱。无需等待 A 部分即可继续 B3、B4；A 部分结果回来后会合并判断。' : '你可以现在独立填写 IDEA 当前账户邮箱，再继续 B3、B4。'
    });
    const portalStatus = portal.kind === 'WHITELIST' ? 'PASS' : portal.kind === 'OTHER' ? 'WARN' : 'MANUAL';
    setAuthBlock('portal', { status: portalStatus, value: portal.emails.length ? { emailEvidence: portal.emails.map(mask) } : '未粘贴官网文本', advice: portal.message });
    setAuthBlock('final', { status: 'MANUAL', value: '仍需在 IDEA 中本人确认', advice: '回到 IDEA，按 B4 的四步确认自己的 edu 邮箱即可。' });
    const summary = $('auth-summary');
    if (summary) summary.textContent = '建议先完成 A 部分，但 B 部分可以独立进行。证据优先级：官网登录回传 → IDEA 人证邮箱 → 机器证据。';
    const finish = $('portal-finish'); if (finish) finish.hidden = portal.state !== 'LOGGED_IN';
    if (portal.state === 'LOGGED_IN') {
      const evidence = portal.emails.length ? portal.emails.map(mask).join('、') : portal.whitelistLiteral ? 'dnui.edu.cn' : '未读到邮箱';
      setPasteState('portal-paste-state', '已粘贴：检测到域名/邮箱证据 ' + evidence + '。', 'filled');
    } else if (portal.state === 'NOT_LOGGED_IN') setPasteState('portal-paste-state', '已粘贴，但看起来仍是未登录页面。');
    else setPasteState('portal-paste-state', $('paste-licenses').value.trim() ? '已粘贴，等待判断。' : '未粘贴官网页面文本');
  }
  function render() {
    try {
      const source = $('paste-detection').value;
      const recognition = resultInputRecognition(source);
      if (!recognition.recognized) {
        const message = '没能识别出这是检测结果。请确认你复制的是运行 JavaCheck.bat 后生成的完整内容，或把同目录的 result.txt 拖进这个框。如果还是不行，重新运行一次检测脚本。';
        showInputFailure(message); setPasteState('input-state', '未识别到检测结果。'); setResultUnlock(false); renderStandaloneAuth(); notify(message); return;
      }
      showPasteGuidance('input-guidance', null);
      const data = parseAnyResult(source); analysis = analyze(data, currentWitness(), currentPortal()); const host = $('cards'); host.replaceChildren();
      $('summary').textContent = analysis.summary; $('overall').textContent = { FAIL: '环境配置未通过', PASS: '环境配置通过', WARN: '核心环境可用，请留意提示', MANUAL: '部分信息需要人工确认' }[analysis.status]; $('overall').className = 'badge ' + analysis.status;
      const age = Math.floor((Date.now() - Date.parse(data.meta.collectedAt)) / 60000);
      $('meta').textContent = '采集时间：' + data.meta.collectedAt + ' · 用户：' + mask(data.meta.user) + '。请确认这是你自己的最新结果。' + (data.schemaVersionMissing ? ' 未识别到版本号。' : '') + (age > 30 ? ' 这是 ' + age + ' 分钟前的结果，建议重新检测。' : age < -5 ? ' 采集时间晚于当前时间，请核对电脑时钟。' : '');
      setPasteState('input-state', '已粘贴：检测到采集时间 ' + data.meta.collectedAt + '，用户：' + mask(data.meta.user || '未提供') + '。');
      if ($('manual-boundary')) { $('manual-boundary').hidden = !analysis.manual; $('manual-boundary').textContent = analysis.manual ? analysis.manualNotice : ''; }
      const heading = document.createElement('h3'); heading.textContent = 'A. Java 环境配置'; host.append(heading);
      analysis.cards.filter(item => item.area === 'A').forEach(item => {
        const row = document.createElement('article'); row.className = 'result ' + item.status;
        const title = document.createElement('h4'); title.textContent = item.name;
        const badge = document.createElement('span'); badge.className = 'badge ' + item.status; badge.textContent = badgeText(item.status);
        const actual = document.createElement('pre'); actual.textContent = item.value;
        const advice = document.createElement('p'); advice.textContent = item.advice;
        row.append(title, badge, actual, advice); host.append(row);
      });
      const hasAFail = analysis.cards.some(item => item.area === 'A' && item.status === 'FAIL');
      $('repair').hidden = !analysis.repair || !hasAFail; $('repair').textContent = analysis.repairLabel;
      const repairState = $('repair-state'); if (repairState) { repairState.hidden = hasAFail; repairState.textContent = hasAFail ? '' : '环境正常，无需修复'; }
      $('export').disabled = false; setResultUnlock(true);
      renderAuth(analysis);
      notify('已在浏览器本地完成分析，没有上传任何数据。');
    } catch (error) {
      analysis = null; $('repair').hidden = true; const repairState = $('repair-state'); if (repairState) repairState.hidden = true; $('export').disabled = true; $('cards').replaceChildren(); $('summary').textContent = '请重新导入完整结果'; $('overall').textContent = ''; setResultUnlock(false);
      if ($('manual-boundary')) $('manual-boundary').hidden = true; notify(error.message);
      showInputFailure(error.message, /重新下载最新版 ZIP/.test(error.message));
      renderStandaloneAuth();
    }
  }
  async function copyManual() {
    const command = 'Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; "JAVA_HOME=" + $env:JAVA_HOME; java -version 2>&1; javac -version 2>&1; (Get-Command javac -ErrorAction SilentlyContinue).Source';
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(command);
      else { const helper = document.createElement('textarea'); helper.value = command; document.body.append(helper); helper.select(); document.execCommand('copy'); helper.remove(); }
      notify('检查命令已复制。按 Win+X 打开 Windows PowerShell，粘贴并回车后，把完整输出复制到 A3。');
    } catch (_) { notify('浏览器没有允许复制。请手动复制页面显示的检查命令。'); }
  }
  function buildPackage() {
    const zip = createZip(packageEntries()); download(zip, 'JavaIDEA自检工具.zip', 'application/zip'); setHash(zip);
    notify('已生成 JavaIDEA自检工具.zip。先右键 ZIP → 属性 → 解除锁定，再解压；确认有 4 个脚本文件和 1 个说明 txt 后，双击 JavaCheck.bat。');
  }
  async function importFile(file) {
    if (!file) return; if (file.size > 8 * 1024 * 1024) { notify('文件超过 8 MB，请选择检测生成的 result.txt。'); return; }
    $('paste-detection').value = await file.text(); render();
  }
  updateDeviceWarning(); updateRefreshNotice(); window.addEventListener('resize', updateDeviceWarning);
  $('generate').addEventListener('click', buildPackage); $('analyze').addEventListener('click', render); $('manual-copy').addEventListener('click', copyManual);
  $('clear').addEventListener('click', () => { const email = $('idea-account-email'); const confirmed = $('idea-account-confirmed'); const portal = $('paste-licenses'); if (email) email.value = ''; if (confirmed) confirmed.checked = false; if (portal) portal.value = ''; portalLoginConfirmed = false; showPasteGuidance('portal-guidance', null); setPasteState('portal-paste-state', '未粘贴官网页面文本'); if (analysis) render(); else renderStandaloneAuth(); notify('已清空本页认证输入；页面不会保存邮箱或官网页面文本。'); });
  ['idea-account-email', 'idea-account-confirmed'].forEach(id => { const element = $(id); if (element) element.addEventListener(id === 'idea-account-confirmed' ? 'change' : 'input', () => { if (analysis) render(); else renderStandaloneAuth(); }); });
  $('paste-licenses').addEventListener('input', () => { const issue = crossPasteIssue($('paste-licenses').value, 'portal'); showPasteGuidance('portal-guidance', issue); if (issue) { notify(issue.message); return; } if (analysis) render(); else renderStandaloneAuth(); });
  $('portal-login-done').addEventListener('click', () => { portalLoginConfirmed = true; if (analysis) render(); else renderStandaloneAuth(); notify('请打开订阅管理页并复制登录后的页面文本，再粘贴到 B3 框。'); });
  $('portal-back-login').addEventListener('click', () => { portalLoginConfirmed = false; const portal = $('paste-licenses'); if (portal) portal.value = ''; showPasteGuidance('portal-guidance', null); setPasteState('portal-paste-state', '未粘贴官网页面文本'); if (analysis) render(); else renderStandaloneAuth(); notify('已回到官网登录引导。请先在 JetBrains 官方网站登录。'); });
  $('repair').addEventListener('click', () => notify('请关闭当前黑色窗口，回到刚才解压的同一个文件夹，双击 JavaRepair.bat。修复结束后，再双击 JavaCheck.bat 重新检测。'));
  $('export').addEventListener('click', () => { if (analysis) download(encode(buildHumanReport(analysis)), 'java-idea-check-result.txt', 'text/plain;charset=utf-8'); });
  $('file').addEventListener('change', event => importFile(event.target.files[0]).catch(error => notify(error.message)));
  $('paste-detection').addEventListener('input', () => { showPasteGuidance('input-guidance', null); setPasteState('input-state', $('paste-detection').value.trim() ? '已粘贴检测结果：点击“开始分析”查看结论。' : '未粘贴检测结果'); });
  $('paste-detection').addEventListener('dragover', event => event.preventDefault());
  $('paste-detection').addEventListener('drop', event => { event.preventDefault(); importFile(event.dataTransfer.files[0]).catch(error => notify(error.message)); });
  renderStandaloneAuth();
  const dismissRefresh = $('refresh-notice-dismiss'); if (dismissRefresh) dismissRefresh.addEventListener('click', () => { const notice = $('refresh-notice'); if (notice) notice.hidden = true; });
})(typeof globalThis !== 'undefined' ? globalThis : window);
