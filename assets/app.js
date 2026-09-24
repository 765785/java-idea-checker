(function (root) {
  'use strict';
  const SCHEMA = 1;
  const pathKey = value => String(value || '').trim().replace(/^"|"$/g, '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const mask = text => String(text == null ? '' : text).replace(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (all, domain) => all[0] + '***@' + domain);
  function parseResult(text) {
    text = String(text).replace(/^\uFEFF/, '').trim();
    if (!text) throw Error('还没有检测结果。请粘贴内容或拖入 result.txt。');
    if (text.length > 8 * 1024 * 1024) throw Error('结果超过 8 MB，请重新运行检测脚本。');
    const candidates = [text];
    let start = -1, depth = 0, quoted = false, escaped = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (start < 0) { if (c === '{') { start = i; depth = 1; } continue; }
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { candidates.push(text.slice(start, i + 1)); start = -1; }
    }
    let data;
    for (const candidate of candidates) { try { const x = JSON.parse(candidate); if (x && typeof x === 'object' && 'schemaVersion' in x) { data = x; break; } } catch (_) { /* next balanced block */ } }
    if (!data) throw Error(start >= 0 ? 'JSON 没有复制完整，缺少结尾。请重新复制，或拖入完整 result.txt。' : '没有找到有效的检测 JSON，可能混入乱码或不是检测文件。请重新复制一次。');
    if (data.schemaVersion !== SCHEMA) throw Error('检测脚本版本过旧或不兼容，请重新生成脚本。');
    for (const k of ['meta', 'env', 'exec', 'javaProbe', 'idea', 'emailScan']) if (!data[k] || typeof data[k] !== 'object' || Array.isArray(data[k])) throw Error('检测结果缺少或损坏字段：' + k + '。请重新检测。');
    if (!Array.isArray(data.javaProbe.candidates) || !Array.isArray(data.idea.installations)) throw Error('候选目录或 IDEA 列表格式不正确，请重新检测。');
    for (const list of [data.javaProbe.candidates, data.idea.installations, data.jetbrainsDirs || [], data.jetbraTrace || []]) if (!Array.isArray(list) || list.some(x => !x || typeof x !== 'object')) throw Error('检测列表包含损坏的条目，请重新检测。');
    if (!Number.isFinite(Date.parse(data.meta.collectedAt))) throw Error('采集时间字段无效，请重新检测。');
    return data;
  }
  function analyze(d) {
    const cards = [], add = (area, name, status, value, advice) => cards.push({ area, name, status, value: mask(typeof value === 'string' ? value : JSON.stringify(value, null, 2)), advice });
    const p = d.javaProbe, candidates = p.candidates.filter(x => x.valid === true), home = p.home || {}, ok = x => x && x.exitCode === 0 && /(?:version\s+"?\d|javac\s+\d|openjdk\s+\d)/i.test(x.output || '');
    const javaOK = ok(d.exec.java), javacOK = ok(d.exec.javac), complete = candidates.length > 0;
    const jreOnly = javaOK && !javacOK && !complete;
    add('A', '是否为完整 JDK（含编译器）', complete ? 'PASS' : 'FAIL', candidates.map(x => x.path + ' · JDK ' + x.major).join('\n') || '未找到可运行的完整 JDK', jreOnly ? '当前只有 Java 运行能力（可能是 JRE 或文件不完整），不能编译 Java 程序。请安装 JDK（Java 开发工具包）。' : complete ? '可复用已有 JDK，无需重复下载。' : '请安装 JDK；绿色解压版同样可以使用。');
    add('A', 'JAVA_HOME', home.valid === true ? 'PASS' : home.error ? 'MANUAL' : 'FAIL', { raw: d.env.effectiveJavaHome, normalized: home.path }, home.valid ? '目录检查通过；带引号、末尾斜杠或 bin 的写法可在修复时规范化。' : p.diskUnavailable ? '路径指向的磁盘现在不可用，请接回磁盘或选择本机 JDK。' : /[\\/]jre[\\/]?$/i.test(d.env.effectiveJavaHome || '') ? '你指向了 jre 子目录，应选择完整 JDK 的根目录。' : 'JAVA_HOME 应指向包含 bin\\javac.exe 的 JDK 根目录。');
    add('A', 'Path 中的 JDK', p.pathIncludesHome === true ? 'PASS' : p.pathIncludesHome == null ? 'MANUAL' : 'FAIL', d.env.path, '接受可展开的 %JAVA_HOME%\\bin 或等价绝对路径。修复只修改你的用户 Path。');
    add('A', 'java / javac 实际执行', javaOK && javacOK ? 'PASS' : 'FAIL', 'java:\n' + (d.exec.java?.output || '无输出') + '\njavac:\n' + (d.exec.javac?.output || '无输出'), javaOK && javacOK ? '两条命令均成功，这是可用性的黄金标准。' : '需同时能运行 java 与 javac；仅有 java 不能编译。');
    const consistency = p.runtimeMatchesHome === false || p.compilerMatchesHome === false || (p.runtimeMajor && p.compilerMajor && p.runtimeMajor !== p.compilerMajor) ? 'FAIL' : p.runtimeMatchesHome === true && p.compilerMatchesHome === true ? 'PASS' : 'WARN';
    add('A', '实际 JDK 与配置是否一致', consistency, { JAVA_HOME: home.path, javaHome: p.runtimeHome, java: p.whereJava, javac: p.whereJavac }, consistency === 'FAIL' ? '你配置的是 ' + home.path + '，但实际运行来源不同。请查看下面的路径与转发器；若系统 Path 中旧 Java 排在前面，需要管理员处理。' : consistency === 'PASS' ? '实际运行来源与 JAVA_HOME 一致。' : '运行来源证据不足，不能仅凭转发器路径判断版本不一致。');
    if (p.forwarders?.length) add('A', 'Java 转发器', consistency === 'FAIL' ? 'WARN' : consistency, p.forwarders, '检测到系统搜索路径中存在 Java 转发器（如 javapath / WindowsApps）。它可能改变实际版本；以 JVM 的 java.home 为依据。');
    const newer = candidates.filter(x => x.major > (p.runtimeMajor || 0)).sort((a, b) => b.major - a.major)[0];
    if (newer && p.runtimeMajor) add('A', '本机其他 JDK 版本', 'WARN', '当前 ' + p.runtimeMajor + '；另有 ' + newer.major, '当前生效的是 JDK ' + p.runtimeMajor + '，本机还检测到 JDK ' + newer.major + '。课程若要求 ' + newer.major + '，可在 IDEA 的 Project SDK 里单独选择；本工具不会擅自替你切换。');
    if (p.archWarning) add('A', 'JDK 架构', 'WARN', p.archWarning, '如果能够正常执行，一般不影响入门；安装新 JDK 时选择与 Windows 匹配的架构。');
    add('A', 'CLASSPATH', /%JAVA_HOME%[\\/]lib/i.test(d.env.classpath || '') ? 'PASS' : 'WARN', d.env.classpath || '未设置', '现代 Java 通常不需要全局 CLASSPATH；这是非致命提示，一键修复不会修改它。');
    add('A', '旧版 JRE 子目录', p.jreBinExists ? 'PASS' : 'WARN', p.jreBinExists ? '存在' : '未发现独立 jre\\bin', 'JDK 9 及以后通常没有独立 jre 目录，不需要为此安装或修复。');
    add('A', 'jetbra / pojie 残留变量', d.jetbraTrace?.some(x => x.matched) ? 'WARN' : 'PASS', d.jetbraTrace || [], '仅报告变量名，不自动清理变量、文件或 IDEA 配置。请联系助教核对后再处理。');
    const installs = d.idea.installations;
    add('B', 'IDEA 安装与版本', installs.length ? 'PASS' : 'MANUAL', installs.length ? installs : '未检测到 IDEA', installs.length ? '展示所有版本，最新版本排在前面。' : '未检测到 IDEA，请先安装 IDEA 再做学生认证。这不影响 Java 环境结论。');
    add('B', 'JetBrains / Toolbox 配置', d.jetbrainsDirs?.some(x => x.exists && x.children?.length) ? 'PASS' : 'MANUAL', d.jetbrainsDirs || [], 'IDEA 已安装但还没有启动记录时，请先启动一次再检测。Toolbox 登录后，IDEA 通常可沿用账号信息。');
    const tier = d.emailScan.tier, label = { EMAIL_EXACT: ['PASS', '高可信（邮箱级证据）'], DOMAIN_ONLY: ['WARN', '中可信（域名级证据）'], OTHER_EMAIL: ['WARN', '可能登录了另一个账号，需人工确认'], NOT_FOUND: ['MANUAL', '配置里没找到字符串证据，不等于认证失败，只说明本机未留下可自动比对的痕迹'] }[tier] || ['MANUAL', '未输入邮箱或没有足够证据'];
    add('B', '教育邮箱反查', label[0], { tier, evidence: d.emailScan.evidence, scanned: d.emailScan.scanned, truncated: d.emailScan.truncated }, label[1] + '。文件可能包含旧账号或插件作者邮箱；字符串证据不证明当前登录账号，也不证明许可证已激活。');
    const failures = cards.filter(x => x.area === 'A' && x.status === 'FAIL');
    const summary = !complete ? jreOnly ? '你当前只有 Java 运行能力，不能编译代码，需要安装完整 JDK。' : '你的电脑未找到可用 Java 开发工具（JDK），需要先安装。' : failures.length ? consistency === 'FAIL' ? 'JDK 已安装，但实际运行的版本与配置不一致。' : 'JDK 装好了，但环境变量没配对。' : newer ? '当前 JDK 可以使用，本机另有更新版本，请按课程要求选择。' : 'Java 核心检查通过，可以开始使用；请留意下方提示。';
    return { cards, summary, status: failures.length ? 'FAIL' : cards.some(x => x.area === 'A' && x.status === 'MANUAL') ? 'MANUAL' : cards.some(x => x.area === 'A' && x.status === 'WARN') ? 'WARN' : 'PASS', repair: failures.length > 0, repairLabel: !complete ? jreOnly ? '安装 JDK（当前只有运行环境）' : '下载并安装 JDK' : '一键修复环境变量', data: d };
  }
  const api = { parseResult, analyze, mask, pathKey, SCHEMA };
  root.Checker = api;
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof document === 'undefined') return;
  const $ = id => document.getElementById(id);
  let analysis, batUrl;
  const notify = text => { $('notice').textContent = text; };
  try { $('email').value = localStorage.getItem('java-check-email') || ''; } catch (_) { notify('浏览器不允许本地保存邮箱，其余功能仍可使用。'); }
  function download(content, name, type = 'text/plain;charset=utf-8') { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  $('generate').addEventListener('click', () => { const email = $('email').value.trim(); if (email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) return notify('请输入完整邮箱，例如 li@school.edu.cn；也可留空后在脚本中输入。'); try { localStorage.setItem('java-check-email', email); } catch (_) {} if (batUrl) URL.revokeObjectURL(batUrl); batUrl = URL.createObjectURL(new Blob([root.ScriptTemplates.buildCheckerBat(email)], { type: 'application/octet-stream' })); $('download').href = batUrl; $('download').hidden = false; $('download').click(); notify('已生成一键检测.bat。下载后双击即可，脚本内含你输入的邮箱，请不要转发给他人。'); });
  $('clear').addEventListener('click', () => { try { localStorage.removeItem('java-check-email'); } catch (_) {} $('email').value = ''; if (batUrl) URL.revokeObjectURL(batUrl); $('download').hidden = true; notify('已清空网页保存的邮箱。已下载脚本中的邮箱需自行删除文件。'); });
  function render() { try { const d = parseResult($('input').value); analysis = analyze(d); const host = $('cards'); host.replaceChildren(); $('summary').textContent = analysis.summary; $('overall').textContent = { FAIL: '环境配置未通过', PASS: '环境配置通过', WARN: '核心环境可用，请留意提示', MANUAL: '部分信息需要人工确认' }[analysis.status]; $('overall').className = 'badge ' + analysis.status; const age = Math.floor((Date.now() - Date.parse(d.meta.collectedAt)) / 60000); $('meta').textContent = '采集时间：' + d.meta.collectedAt + ' · 用户：' + mask(d.meta.user) + '。请确认这是你自己的最新结果。' + (age > 30 ? '这是 ' + age + ' 分钟前的结果，建议重新检测。' : age < -5 ? '采集时间晚于当前时间，请核对电脑时钟。' : ''); for (const area of ['A', 'B']) { const h = document.createElement('h3'); h.textContent = area === 'A' ? 'A. Java 环境配置' : 'B. IDEA 学生认证'; host.append(h); for (const card of analysis.cards.filter(x => x.area === area)) { const el = document.createElement('article'); el.className = 'result ' + card.status; const title = document.createElement('h4'); title.textContent = card.name; const badge = document.createElement('span'); badge.className = 'badge ' + card.status; badge.textContent = { PASS: 'PASS · 通过', FAIL: 'FAIL · 未通过', WARN: 'WARN · 提示', MANUAL: '需人工确认' }[card.status]; const pre = document.createElement('pre'); pre.textContent = card.value; const advice = document.createElement('p'); advice.textContent = card.advice; el.append(title, badge, pre, advice); host.append(el); } } $('repair').hidden = !analysis.repair; $('repair').textContent = analysis.repairLabel; $('export').disabled = false; $('confirmation').hidden = false; notify('已在浏览器本地完成分析，没有上传任何数据。'); } catch (e) { analysis = null; $('repair').hidden = true; $('export').disabled = true; $('cards').replaceChildren(); $('summary').textContent = '请重新导入完整结果'; $('overall').textContent = ''; $('confirmation').hidden = true; notify(e.message); } }
  $('analyze').addEventListener('click', render);
  async function fileInput(file) { if (!file) return; if (file.size > 8 * 1024 * 1024) return notify('文件超过 8 MB，请选择检测生成的 result.txt。'); $('input').value = await file.text(); render(); }
  $('file').addEventListener('change', e => fileInput(e.target.files[0]).catch(e => notify(e.message)));
  $('input').addEventListener('dragover', e => { e.preventDefault(); });
  $('input').addEventListener('drop', e => { e.preventDefault(); fileInput(e.dataTransfer.files[0]).catch(e => notify(e.message)); });
  $('repair').addEventListener('click', () => { if (analysis) { download(root.ScriptTemplates.buildRepairBat(analysis), '一键修复.bat', 'application/octet-stream'); notify('请双击下载的修复 BAT。完成后关闭窗口，重新运行一键检测.bat，再粘贴新结果。'); } });
  $('export').addEventListener('click', () => { if (analysis) download('\uFEFF' + mask(analysis.summary + '\n' + analysis.cards.map(c => c.area + ' ' + c.name + ' ' + c.status + '\n' + c.value + '\n' + c.advice).join('\n\n') + '\n\n' + JSON.stringify(analysis.data, null, 2)), 'java-idea-check-result.txt'); });
})(typeof globalThis !== 'undefined' ? globalThis : window);
