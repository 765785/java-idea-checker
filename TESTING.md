# 验收记录与证据边界

本文件严格区分“历史基线已执行”“第六轮自动化已执行”和“真实 Windows 手工验收待执行”。没有证据的项目不得标记为通过。

完整场景、规则和验收编号在 docs/spec.md。第五、六轮改变了交付形态（从旧单 BAT 变为 ZIP 内的可读 PS1），因此旧测试即使通过，也**不能**证明新 ZIP 流程已经通过。

## 历史基线：已执行（2026-09-24，改为 ZIP 前）

- node --test tests/*.test.js：19 项通过。
- JavaScript 判定覆盖：空机器、JRE-only、转发器同源/不同源/未知、JDK 8 + 25 版本警告、独立真实故障仍可修复、磁盘不可用、四档邮箱、旧 schema、截断 JSON。
- Windows PowerShell 5.1 覆盖：旧 BAT 载荷 AST、注册表修复计划的 String/ExpandString/新建/空值/超长/异常类型、中文 winget 候选提取、Toolbox 四档匹配和脱敏。
- 剪贴板两个渠道模拟失败时，result.txt 仍记录失败。
- 实机只读采集试跑：中文和空格目录、启动工作目录 System32、PowerShell 5.1 能生成 result.txt；未修改主机环境变量，也未安装软件。
- 公开入口只读连通性：2026-09-24 请求 https://765785.github.io/java-idea-checker/ 返回 HTTP 200。该检查不验证第六轮页面内容、ZIP 下载或静态资源完整性。

这些记录只证明当时的旧实现基线。N17、N18、N27、N28 将 BAT 封装和 ZIP 机制替换后，相关用例必须重新执行。

## 第六轮与 B 区定稿自动化验收：已执行（2026-09-25，Windows 本机）

执行命令：`node --test tests/*.test.js`、`node tools/build-offline.js`、`node tools/build-offline.js --check`、`node tests/smoke-bat.js`。

结果：Node 22 / Windows PowerShell 5.1 下 50/50 自动化测试通过；固定 ZIP 与离线分发一致性检查通过；真实冒烟在“中文 检测 smoke”目录中由 `JavaCheck.bat` 调用可读的 `JavaCheck.ps1`，生成 result.txt，未改动环境变量、未安装软件。B 区新增的机器证据、人证优先、官网登录回传登录态、双粘贴框防呆、隐私脱敏和 schema 2 用例均为自动化夹具，不代表已经在真实 JetBrains 登录数据上验证。下表明确保留尚未做的 GUI、真实 PS3 和安全软件验收。

| 编号 | 需要的证据 | 状态 |
| --- | --- | --- |
| H01 | JavaCheck.bat / JavaRepair.bat 非 ASCII 数为 0，且无长度大于 200 的 Base64 串；两 PS1 首三字节为 EF BB BF | 自动化通过 |
| H02 | 缺 JavaCheck.ps1 时运行 JavaRepair.bat，PS1 输出中文同目录提示，BAT 保持 ASCII 且 pause | 自动化通过（真实 cmd） |
| H03 | ZIP 内 JavaCheck.bat、JavaCheck.ps1、JavaRepair.bat、JavaRepair.ps1、README_FIRST.txt 均存在、名称 ASCII，中文空格目录用 %~dp0 可定位 | 自动化通过；JavaCheck 中文空格目录冒烟通过 |
| H04 | ZIP 本地头与中央目录均有 UTF-8 flag 0x0800，CRC、长度、偏移、路径分隔符和 Store 元数据一致 | 自动化通过 |
| H05 | PowerShell Expand-Archive 解压后五条目齐全；每一项与 ZIP 生成前内容逐字节一致 | 自动化通过（真实 Expand-Archive） |
| H06 | file:// 下模拟或实际缺 crypto.subtle，哈希区显示指定中文降级文案和 Release 链接，无空白/undefined/异常 | 静态/逻辑契约通过；真实 file:// GUI 未实测 |
| H07 | 路径 A 结果出现“只覆盖 Java 环境”；B 区恒为 MANUAL 和三步人工确认，无认证成功措辞 | 自动化通过 |
| H08 | AST/静态扫描拒绝 Invoke-Expression、iex、DownloadString、混淆；PS4/5 特性均先探测 | 自动化通过 |
| H09 | 模拟 PS3 缺 Set-Clipboard/Get-Clipboard 时检测完成、clip 兜底可尝试、result.txt 仍落地 | 模拟通过；真实 PowerShell 3.0 未实测 |
| H10 | README_FIRST.txt 为 UTF-8 BOM + CRLF，中文正常，内容要求先检测、网页提示后才修复、检测非管理员 | 自动化通过 |
| H11 | 中文 locale java/openjdk 版本文本可解析；javac 路径缺失固定 FAIL | 自动化通过 |
| H12 | 页面全量静态文本无“下载一个文件”“再次下载检测 BAT”等旧流程；仅一个 ZIP 下载入口 | 自动化通过 |
| I01 | 固定 ZIP 不烧录个人邮箱；多次生成及不同旧输入路径下字节与 SHA-256 一致，并与 `dist/JavaIDEA-checker.zip` 一致 | 自动化通过 |
| I02 | 白名单仅由 app.js 提供，生成 JavaCheck.ps1 中同步注入 `$EduDomains` | 自动化通过 |
| I03 | cmdkey 条目、XML 行、日志和导出报告中的完整邮箱均脱敏；无关文件中的其他邮箱不触发错误账号结论 | 自动化通过（夹具） |
| I04 | 单独存在 JetBrains cmdkey 条目或疑似凭据库文件时为中可信；两者都没有时为需人工确认 | 自动化通过（夹具） |
| I05 | 人证仅在 IDEA 已安装且有启动配置时可升档；本校人证优先于机器其他邮箱；双方为其他域名时提示换账号 | 自动化通过（夹具） |
| I06 | schema 1 结果明确拒绝；B 区不产生教育包已激活的结论 | 自动化通过 |
| J01–J09 | 个人机账户证据、官网先登录后复制、未登录文本拦截、官网登录优先级、无 password 输入、四块顺序、三步进度和脱敏报告 | 自动化通过（夹具/静态契约） |
| J10–J15 | 本机/官网粘贴框结构分离、交叉粘贴预拦截、不同视觉状态、跳转高亮和脱敏摘要 | 自动化通过（静态/逻辑契约）；浏览器实际截图走查未实测 |

第五轮增量 G01–G18 也须随第六轮重新执行，尤其：

- G03/G04：脚本目录下的 result.txt、repair.log、备份路径和中文空格目录。
- G05–G07：完全无下载的路径 A 和路径 B。
- G10–G12：移动/窄屏劝返、进度与 Ctrl+V 收尾、同目录检查。
- G13：导出报告前 20 行是中文人读内容，不含 JSON。
- G14：PS2 guard 的中文非零退出和 PS3 兼容分支。
- G15：断网 file:// 离线 HTML 流程。
- G16–G18：教育邮箱防呆、四步流程、机房重启还原提示。

建议命令：

1. node --test tests/*.test.js
2. node tests/smoke-bat.js
3. 针对 ZIP 产物运行 PowerShell Expand-Archive，使用文件哈希或字节数组逐项比对。

smoke-bat 只可用于当前机器的只读采集。任何真实修复写入测试应在 Hyper-V 或 VMware 快照中运行，而不是宿主机。

## 真实 Windows 手工验收：待执行

下列项目不能由 JavaScript mock、Windows Sandbox 或静态扫描替代。需要将实际版本、系统、日期、截图或控制台摘要填回此处后才可以标记为通过。

| 项目 | 必须验证的结果 | 状态 |
| --- | --- | --- |
| Explorer ZIP 解压 | 双击 ZIP 用资源管理器解压，五条目齐全，README_FIRST.txt 中文正常，四脚本内容与生成前一致 | 未实测 |
| 普通 Windows 虚拟机安装 | Hyper-V/VMware 快照中 winget 找到/搜索/验证/安装 Temurin 25；scope 重试正确 | 未实测 |
| UAC 与跨账户 | 同账户 UAC、拒绝 UAC、输入其他管理员账户的 SID 拦截 | 未实测 |
| 用户级修复 | 标准账户已有 JDK 时无 UAC；用户覆盖、REG_EXPAND_SZ/REG_SZ、回滚、WM_SETTINGCHANGE、新 cmd 生效 | 未实测 |
| 系统遮蔽与转发器 | javapath 同目标 PASS、不同目标 FAIL、未知 WARN；不误修系统 Path | 未实测 |
| 受控机房 | 注册表写拒绝、Path 超长、重启还原提示和零写入 | 未实测 |
| PowerShell 兼容 | PS 3.0、5.1、7、ISE；代码页 936/65001 下中文和 clipboard 降级 | 未实测 |
| 安全软件 | 浏览器提示、MotW 传递、360 隔离/恢复、多个引擎误报情况 | 未实测 |
| 离线版 | 断网 file:// 双击，下载 ZIP、导入、分析、导出、无 crypto.subtle 降级 | 未实测 |
| Pages / Release | Pages 入口和静态资源 HTTP 200；Release 固定资产的 SHA-256 与 README 表一致 | 2026-09-25：v1.1.0 的 ZIP 与离线版已从 Release 下载并逐项核对 SHA-256；Pages 工作流 36081908856 成功，首页与 assets/app.js 均为 HTTP 200，后者已核对 schema 2、人证与白名单代码。 |

任何一项“未实测”都不能因为设计符合规格而改成“通过”。特别是：Explorer 解压、360 检测、UAC、受控机房、普通 VM winget 安装、真实 GitHub Release 与 Pages 发布必须保留真实证据。

## 记录模板

每次填写新证据时使用以下结构：

- 日期与操作者：
- Windows / PowerShell / 浏览器版本：
- ZIP 或 Release 版本及 SHA-256：
- 执行命令或手工步骤：
- 预期结果：
- 实际结果：
- 证据位置（截图、控制台摘要、日志脱敏片段）：
- 结论：通过 / 失败 / 阻塞：

报告、日志、备份和截图可能包含本机路径或邮箱痕迹；上传前应先脱敏。不要把原始备份、完整 result.txt 或带个人路径的 repair.log 直接公开。
