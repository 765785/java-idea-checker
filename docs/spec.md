# Windows 桌面自检网页：完整规格与规则索引

## 交付边界与优先级

本项目是独立的新网页，位于 windows-checker/。父目录的旧网页、安装器和部署配置均不修改。目标仓库为 765785/java-idea-checker，公开入口为 https://765785.github.io/java-idea-checker/；所有改动只属于该独立新站。

仅支持 Windows 桌面端。页面本身可在 file:// 与 GitHub Pages 打开；不依赖后端、CDN、第三方库、远程字体、遥测或网络请求。桌面优先；疑似非 Windows 或窄屏时显示劝返提示，但不隐藏下载入口。

规则优先级为：第六轮 N27–N31 / Q19–Q22 优先于第五轮同主题表述；第五轮 N17–N26 / Q10–Q18 优先于前四轮；未被明确作废的早期规则继续有效。第六轮不改变“ZIP 唯一下载入口、四脚本结构、免下载 A/B、离线 HTML、杀软折叠区、教育邮箱防呆、四步流程、PowerShell 版本 guard”的第五轮决策。

明确作废项：

- N11 的单文件检测 BAT 已由 N17 作废。
- M3 / P1 的 UTF-16LE + Base64 + EncodedCommand 封装已由 N17 作废。
- N15 的 SELF / EncodedCommand 定位机制只适用于已作废封装；当前使用 BAT 的 %~dp0 与 PS1 的 PSScriptRoot。
- 旧的“只下载一个 BAT”“再次下载检测 BAT”文案不得保留。

## 用户流程、交付物与数据边界

网页生成并下载唯一的 JavaIDEA自检工具.zip。ZIP 是无压缩 Store 格式，不引入第三方 ZIP 库，包含以下五个同级条目：

| ZIP 条目 | 格式与用途 |
| --- | --- |
| JavaCheck.bat | 纯 ASCII 启动器；只设置英文标题、用 %~dp0 调用同级 JavaCheck.ps1、pause |
| JavaCheck.ps1 | UTF-8 BOM 可读采集脚本；生成时烧录教育邮箱默认值 |
| JavaRepair.bat | 纯 ASCII 启动器；用 %~dp0 调用 JavaRepair.ps1，缺少 JavaCheck.ps1 时传入 MissingChecker |
| JavaRepair.ps1 | UTF-8 BOM 可读修复脚本；通用逻辑，不接受网页报告中的命令或路径 |
| README_FIRST.txt | UTF-8 BOM + CRLF 中文说明：先检测、仅网页提示时修复、检测不以管理员运行、拦截时回网页说明 |

ZIP 外层文件名可以是中文；ZIP 内条目名必须全部 ASCII。两个 BAT 不包含任何非 ASCII 字符、Base64 长串、EncodedCommand、临时解码、自读 BAT 标记或 SELF 定位逻辑。所有中文提示、进度、错误和缺文件说明均由 PS1 输出。PS1 顶部必须含项目、仓库地址、MIT 许可证、会做什么、不会做什么和“无法保证不被安全软件拦截”的可读说明。

ZIP writer 的每个条目必须使用 UTF-8 flag 0x0800、正斜杠路径、Store 方法、正确 CRC-32、本地头/中央目录一致的长度和偏移、合理 DOS 时间、version needed 与外部属性。README_FIRST.txt 的字节开头为 UTF-8 BOM。生成时浏览器计算 CRC，且在安全上下文允许时计算 ZIP SHA-256。

标准流程：

1. 在目标 Windows 电脑填写教育邮箱，下载 JavaIDEA自检工具.zip。
2. 右键 ZIP 属性解除锁定后解压，确认 4 个脚本 + 1 个说明 txt 齐全，普通双击 JavaCheck.bat。
3. 回网页第 2 步 Ctrl+V 粘贴 JSON，或拖入 result.txt；浏览器仅将导入内容作为纯文本数据处理。
4. 仅 A 区存在真实 FAIL 时，在同一文件夹运行 JavaRepair.bat；关闭当前黑色窗口后重新双击 JavaCheck.bat 复检。

检测 JSON 的 schemaVersion 为 1，含 meta、env、exec、javaProbe、idea、jetbrainsDirs、jetbraTrace、emailScan、errors 等字段。页面限长、提取 JSON、验证结构；超过 30 分钟提示结果陈旧，旧 schema 或截断/乱码给具体中文原因。路径在本机完成比较、再替换用户目录前缀；邮箱输出首字符***@域名；网页只用 textContent 纯文本渲染。邮箱只存当前浏览器 localStorage，不上传。

检测脚本将报告写入脚本同目录 result.txt，尝试写入剪贴板，且逐节显示：

1. 正在检查 JAVA_HOME；
2. 正在检查 Java 与 javac；
3. 正在扫描 IDEA 配置；
4. 完成。

最终屏幕提示固定为：“请回到浏览器，在第 2 步的框里按 Ctrl+V，然后点解析。”失败时仅显示中文原因与下一步；完整异常写到脱敏日志或 errors，不能向学生直接输出英文堆栈。

## Java、修复与认证行为

完整 JDK 必须同时具有可运行 java 与 javac，且执行成功、主版本一致。候选选择顺序固定为：有效 JAVA_HOME → 排除转发器后的 javac 所属完整 JDK → .jdks 中最高稳定版本 → 其他最高稳定版本。绿色 JDK 不要求注册表记录；JRE-only、损坏 JDK、不可用盘符、变量缺失、用户覆盖、真实版本遮蔽分别给专项结论和中文动作。

采集完整有序的 where java、where javac、java -XshowSettings:properties -version 输出与 java.home。java.home 是运行时首选证据；取不到时才使用首个非转发器 javac 作为降级证据并标低可信。Oracle javapath、System32、SysWOW64、WindowsApps 为转发器黑名单：命中要单列说明，不能自动 FAIL；同目标 PASS、不同目标 FAIL、目标无法确认 WARN。路径比较须由 PowerShell 归一化引号、变量、分隔符、绝对/长路径、尾斜杠、大小写和误加 bin。JDK 8 的 java.home 仅在父目录确为完整 JDK 时从 jre 映射到根目录。

JDK 8 已正常生效而另有完整 JDK 25 时是 WARN，固定提示：

> 当前生效的是 JDK 8，本机还检测到 JDK 25。课程若要求 25，可在 IDEA 的 Project SDK 里单独选择；本工具不会擅自替你切换。

这一条单独存在时不得显示修复按钮；若叠加真实故障，仍显示相应修复。中文或空格路径本身不是失败；复用 .jdks 时提示不要从 IDEA 删除它。

已有完整 JDK 时，默认路径只修改当前用户 JAVA_HOME 与用户 Path，不联网、不请求 UAC。先读用户/系统两级原始值、存在标志和值类型，预检用户写权限与拟生效 Path；达到 2048 字符或类型异常即停止。备份写在脚本目录 backup-时间戳-随机后缀，须回读验证；失败只恢复本次改动的用户变量，保留原类型和合法空/缺失状态。

Path 类型规则：

- 原为 REG_EXPAND_SZ：保留类型，前置 %JAVA_HOME%\bin。
- 原为 REG_SZ：保留类型，前置已解析的绝对 JDK bin 路径，不能写未展开占位符。
- 原不存在：新建 REG_EXPAND_SZ，前置 %JAVA_HOME%\bin。
- 异常非字符串类型：零写入并给人工指引。

写后重读注册表，以系统 Path + 用户 Path 真实顺序重建当前进程、广播 WM_SETTINGCHANGE，并用转发器感知的一致性验证。系统 Path 真正遮蔽时保留 FAIL、回滚本次用户改动，不为此提权。成功提示仅对当前 Windows 账户生效，并要求普通权限重新运行检测 BAT。

只有找不到完整 JDK 才允许联网安装。父进程保留普通用户身份与输出目录；UAC 子进程比对 SID，跨账户立即停止、不调 winget、不写环境。winget 依次探测用户 WindowsApps、DesktopAppInstaller 目录、Get-Command，绝对路径调用。Temurin 25 先带 scope machine；仅 scope 相关失败才去掉 scope 重试。包 ID 无效时将中文搜索输出设定编码、用正则抽取候选、不按表格列切分，并用 show exact 验证官方 JDK 25；安装成功后重新发现真实目录。UAC 拒绝后重新扫描；仍无 JDK 则不写变量、明确未完成。

PS1 首先判断 Windows 与 PowerShell 版本。非 Windows 或低于 PowerShell 3.0 必须显示中文说明后以非零退出，不能崩溃。PowerShell 3.0+ 可直接使用显式兼容语法；必须满足：

- Set-Clipboard、Get-Clipboard 或其他 Clipboard cmdlet 仅能在 Get-Command 探测后调用，缺失时使用 clip.exe，结果文件优先落地。
- 不使用 Get-FileHash、Get-ChildItem -Depth 或 PowerShell 4+ 的简化 Where-Object 语法。
- 始终禁止 Invoke-Expression、iex、DownloadString、动态拼接命令、变量名随机化、字符串反转和其他混淆。
- 外部命令通过统一捕获函数执行：合并 stderr、保留退出码、尝试设置并 finally 恢复编码；编码设置失败只记 errors。

B 区只允许一条固定链：IDEA 安装/版本 → JetBrains/Toolbox 配置目录 → EMAIL_EXACT、DOMAIN_ONLY、OTHER_EMAIL、NOT_FOUND 四档邮箱证据 → Manage Subscriptions → Refresh license list → Activate。未安装或未启动是 MANUAL，不影响 A 区。所有档位均不得说认证成功或教育包已激活。扫描新版、旧版与 Toolbox，跳过缓存/日志/重解析点，限制扩展名、单文件 5MB、总文件 3000；证据统一脱敏。

免下载路径 A 只采集 JAVA_HOME、java/javac 版本及 javac 路径。纯文本解析兼容 java version、openjdk version、java 版本、openjdk 版本及 JDK 9+ 单行版本；javac 路径为空必为 FAIL，并给具体中文原因。路径 A 结果固定说明“这是简化检查，只覆盖 Java 环境。学生认证仍需运行完整检测脚本，或按下面的三步手动确认。”B 区固定 MANUAL，直接显示三步人工确认，不显示邮箱命中或认证正常。路径 B 仅提供图文手工配置步骤。

## 规则索引

验收编号 S01–S35 是机器场景；F01–F07 是第四轮专项；G01–G18 为第五轮自动/人工验收；H01–H12 为第六轮追加验收。T 表示自动契约，V 表示真实 Windows、VM 或人工验收。第二轮没有独立原文；N1–N5、P1–P6 仅登记对话明确引用的含义，不补造缺失规则。

| 编号 | 一句话结论 | 验收 |
| --- | --- | --- |
| M1 | 两级备份并处理用户覆盖；实际默认写入范围由 N6 收窄为用户级 | S12、T |
| M2 | winget 依次探测 WindowsApps、安装目录、命令解析并绝对路径调用 | S19、V |
| M3 | Base64/EncodedCommand 封装已由 N17 作废 | G01、H01 |
| M4 | 修改与回滚后广播 WM_SETTINGCHANGE | S16、V |
| M5 | 重读注册表并重建真实进程环境后验证 | S07、T/V |
| R1 | Clipboard cmdlet 失败后试 clip，result.txt 独立落地 | N26、H09 |
| R2 | 安装后重新发现并验证真实完整 JDK | S19、V |
| R3 | 归一化引号、尾斜杠、误加 bin，不丢原始值 | S11–S12、T |
| R4 | 扫描 Toolbox；未命中不等于认证失败 | S24、T |
| R5 | 修复后必须普通权限重新检测 | S16、N26 |
| R6 | Path 达 2048 停止，备份可验证，异常记录 | S14、T |
| N1 | 输出、备份、日志以原脚本目录为准 | S30、G04 |
| N2 | UAC 子进程 SID 不同立即停止，不调 winget | S20、V |
| N3 | SELF 机制已随 EncodedCommand 作废；新方案用 %~dp0 | N17、H01 |
| N4 | 中文 winget 搜索不按列解析 | F07、T |
| N5 | 未提供独立原文，不虚构 | 待来源 |
| P1 | Base64 包装已由 N17 作废 | G01、H01 |
| P2 | Toolbox 安装与配置纳入识别和扫描 | S24–S25、T/V |
| P3 | 仲裁优先保持有效现状，再按固定候选顺序 | S03–S07、T |
| P4 | 未提供独立原文，不虚构 | 待来源 |
| P5 | 管理订阅 → Refresh license list → Activate | B 区文案 |
| P6 | 未提供独立原文，不虚构 | 待来源 |
| N6 | 已有 JDK 时只修用户环境，不联网、不提权 | S16、T/V |
| N7 | UAC 拒绝后重扫；只有找到完整 JDK 才可降级修复 | S17、T/V |
| N8 | 比较真实来源与 JAVA_HOME；系统遮蔽不假修复 | S07、F01 |
| N9 | JRE-only/不完整 JDK 专项失败，绝不选作目标 | S02、S08、T |
| N10 | 受控环境写入失败给中文管理员指引 | S18、T/V |
| N11 | 单文件 BAT 已由 N17 作废，ZIP 交付四脚本 | G03、H03 |
| Q1 | 顶部显示“你现在的情况”大白话总结 | S01–S08、T |
| Q2 | 安装/修复按钮随场景变化 | S01–S04、T |
| Q3 | IDEA 未安装显示主动点击官方下载链接 | S22 |
| Q4 | 显示采集时间与脱敏用户名 | S31–S32 |
| Q5 | README 提供助教速查表 | 文档 |
| N12 | java.home 优先；转发器本身不导致失败 | F01、T |
| N13 | 本机规范路径后再比较；未知不猜 | F02、T/V |
| N14 | 保留合法注册表类型；REG_SZ 用绝对 bin，新 Path 用 ExpandString | F03–F04、T |
| N15 | SELF 定位已随 N17 作废；%~dp0 定位同级 PS1 | G03、H02 |
| N16 | JDK 8 正常且另有 25 为 WARN，无单独修复 | F06、T |
| Q6 | 正则抽 winget 候选，show 验证官方 JDK 25 | F07、T |
| Q7 | 复用 .jdks 时提示不能在 IDEA 删除 | S04 |
| Q8 | 外部命令编码设置/恢复失败仅记错误 | T/V |
| Q9 | winget 真实安装只以普通 VM 证据验收 | V |
| N17 | 作废 Base64/EncodedCommand，改 ASCII BAT + 可读 UTF-8 BOM PS1 | G01–G04、H01 |
| N18 | 唯一 ZIP 下载入口，解除锁定后解压，不承诺避开 MotW | G03、H03–H05 |
| N19 | 折叠杀软说明、来源核对、隔离恢复、哈希边界；不教关闭/全局排除 | S21、G09 |
| N20 | 免下载 A 解析 Java 文本，B 提供图文手工配置 | G05–G08、H07、H11 |
| N21 | 非 Windows/窄屏劝返，按钮仍可见 | G10 |
| N22 | 脚本分节进度、Ctrl+V 结尾、网页有明确下一步 | G11 |
| N23 | 说明浏览器保留/恢复下载/打开文件夹步骤 | 文案走查 |
| N24 | 修复与检测同目录；缺检测 PS1 时中文提示且 pause | G12、H02 |
| N25 | 导出 txt 前置中文可读报告，末尾可附 JSON | G13 |
| N26 | Win7 SP1+/PS3+；低版本 guard，clipboard 探测/clip 降级 | G14、H08–H09 |
| Q10 | Release 固定资产公布 SHA-256 与核对命令 | G08、文档 |
| Q11 | README 记录误报申诉、信誉、签名限制与 VirusTotal 边界 | 文档 |
| Q12 | 禁止混淆与动态执行；脚本头部可读 | H08 |
| Q13 | 发布可离线打开的内联 dist HTML | G15、H06 |
| Q14 | 教育邮箱输入防呆，非教育域名只提醒不阻断 | G16 |
| Q15 | 机房重启还原提示 | 文案走查 |
| Q16 | 黑窗口标题、中文错误和“按任意键关闭” | G11 |
| Q17 | 页面四步分开检测、解析、修复、复检；修复只在 FAIL | 文案走查 |
| Q18 | 修复后关闭旧窗口、重新双击检测 | S16、文案走查 |
| N27 | ZIP 内五个文件名均 ASCII；中文全由 PS1 / txt 输出 | H01–H03 |
| N28 | ZIP Store 设置 UTF-8 flag、正确 CRC/偏移/路径和元数据 | H04–H05 |
| N29 | file:// 无 crypto.subtle 时显示哈希降级说明和 Release 链接 | H06 |
| N30 | 路径 A 不含学生认证；B 区永远 MANUAL + 三步人工确认 | H07 |
| N31 | PS3 兼容清单和禁用项静态扫描必须通过 | H08–H09 |
| Q19 | ZIP 含 README_FIRST.txt，先检测后按网页提示修复 | H10 |
| Q20 | 页面提示解压后核对 4 脚本 + 1 txt | 文案走查 |
| Q21 | 路径 A 兼容中文 locale；javac 缺失为 FAIL | H11 |
| Q22 | 全站只保留唯一 ZIP 下载入口，清除旧 BAT 文案 | H12 |

## 35 场景验收矩阵

本表是验收目标，不代表全部已实测；真实结果必须记录在 TESTING.md。

| 编号 | 输入/触发 | 确定结果与动作 |
| --- | --- | --- |
| S01 | 无 JDK、无 IDEA | A FAIL 安装引导，B MANUAL |
| S02 | java 有、javac 无且无完整候选 | 完整 JDK 专项 FAIL；不选 JRE |
| S03 | JDK 存在、完全没配变量 | FAIL；用户级离线修复 |
| S04 | .jdks 中有完整 JDK | 离线复用，无需管理员；提示不要删除 |
| S05 | 中文/空格路径 | 有效即通过，不因字符失败 |
| S06 | 绿色 JDK 无卸载项 | 执行验证完整即可候选 |
| S07 | 多 JDK、真实来源不一致 | FAIL；系统遮蔽不提权 |
| S08 | JDK 缺 java 或 javac | FAIL，不作为修复候选 |
| S09 | x86 JDK、x64 Windows | 能运行 WARN，否则执行 FAIL |
| S10 | JAVA_HOME 指向 jre | 根目录失败，父 JDK 可作候选 |
| S11 | JAVA_HOME 末尾 bin | 归一化检查，命令独立验证 |
| S12 | 引号/尾斜杠/空值/用户覆盖 | 保存原值，规范目录或修用户变量 |
| S13 | 盘符不可用 | FAIL，说明磁盘不可用 |
| S14 | 拟生效 Path ≥ 2048 | 修改前停止，不截断 |
| S15 | 用户 Path 缺失/空 | 新建 ExpandString，不改系统 Path |
| S16 | 标准账户且已有 JDK | 无 UAC、用户级修复、普通权限复检 |
| S17 | 安装 UAC 拒绝 | 重扫；有 JDK 才修，无 JDK 未完成 |
| S18 | 用户注册表拒写 | 中文分类指引；预检失败零写入 |
| S19 | winget 不可用/离线 | 不写无效变量，手动安装指引 |
| S20 | 跨账户提权 | SID 检查立即停止，不调 winget |
| S21 | SmartScreen/杀软 | 页面给来源/解除锁定/免下载说明，不能保证先运行 |
| S22 | IDEA 未装 | B MANUAL，不影响 A，给下载链接 |
| S23 | IDEA 装了未启动 | 配置 MANUAL，提示先启动一次 |
| S24 | Toolbox 版 | 安装和配置识别，邮箱脱敏扫描 |
| S25 | IDEA 多版本 | 展示版本排序，扫描全部配置 |
| S26 | 自定义 IDEA 路径 | 注册表和常见 C:\idea 探测 |
| S27 | 旧版配置残留 | 纳入邮箱扫描，不当作当前账号保证 |
| S28 | 学生双击 PS1 | README_FIRST 与网页指引双击 JavaCheck.bat |
| S29 | 检测/修复分散目录 | JavaRepair 检查同级 JavaCheck.ps1，提示同目录 |
| S30 | 只下载 ZIP | 解压后五条目齐全，BAT 可在中文空格目录调用同级 PS1 |
| S31 | 粘贴旧结果 | 30 分钟阈值提示 |
| S32 | 粘贴他人结果 | 展示脱敏用户名并提醒核对 |
| S33 | 截断/乱码 | 具体解析错误与重新复制指引 |
| S34 | 旧 schema | 拒绝判定，重新生成 ZIP |
| S35 | PS7/ISE | 主体兼容，推荐 BAT 和脚本目录运行 |

## 第四轮与第五、六轮追加验收

| 编号 | 验收目标 |
| --- | --- |
| F01 | 转发同 JDK 通过、不同 JDK 失败、未知 WARN |
| F02 | 短名/大小写/尾斜杠等价路径不误报 |
| F03 | 原 ExpandString 保留，变量占位符可展开 |
| F04 | 原 Path 不存在时新建 ExpandString |
| F05 | 旧 EncodedCommand 载荷定位测试已作废；新方案由 G03/H02 覆盖 |
| F06 | JDK8+25 仅版本提示时无修复；叠加故障仍有修复 |
| F07 | 中文 winget 输出正则抽取，拒绝 JRE/不明来源 |
| G01 | 两 BAT ASCII 且无超过 200 字符 Base64；两 PS1 为 UTF-8 BOM |
| G02 | PS1 在代码页 936 与 65001 的中文显示 |
| G03 | ZIP 解压后 %~dp0 定位同级 PS1，中文/空格目录可运行 |
| G04 | 输出、日志、备份、result.txt 保留脚本目录 |
| G05 | 复制命令可在 PS5.1 运行并产出可解析文本 |
| G06 | 网页可解析路径 A 纯文本为 A 区 PASS/FAIL |
| G07 | 不下载任何文件时路径 A/B 均可走完 |
| G08 | README 发布 SHA-256 与固定实际资产一致 |
| G09 | 杀软/浏览器指引无关闭杀软或全局排除建议 |
| G10 | 移动 UA/窄屏警告且下载入口仍显示 |
| G11 | 进度、Ctrl+V 结尾、窗口友好提示完整 |
| G12 | 修复同目录缺检测 PS1 时中文提示并 pause |
| G13 | 导出 txt 前 20 行为中文人读报告，不含 JSON |
| G14 | PS2 guard 非零退出；无 clipboard cmdlet 时 clip 降级 |
| G15 | 断网 file:// 离线 HTML 可完成同等流程 |
| G16 | QQ 邮箱有非阻断提示，仍可继续 |
| G17 | 四步检测/解析/修复/复检文案无“然后呢” |
| G18 | 机房重启还原提示显示 |
| H01 | ZIP 内 BAT/PS1 名 ASCII；BAT 无 Base64/非 ASCII |
| H02 | 缺 JavaCheck.ps1 时 JavaRepair.ps1 输出中文并保留 pause |
| H03 | ZIP 内五条目和 %~dp0 路径正确 |
| H04 | 每条目 UTF-8 flag 0x0800；CRC、偏移、中央目录一致 |
| H05 | Expand-Archive 字节级比对通过；Explorer 解压另列人工证据 |
| H06 | file:// 无 crypto.subtle 时显示指定降级文案与 Release 链接 |
| H07 | 路径 A 固定“不含学生认证”，B 区恒为 MANUAL |
| H08 | AST/静态扫描禁止项；PS4/5 cmdlet 先探测 |
| H09 | 模拟 PS3 无 clipboard cmdlet 时仍落 result.txt |
| H10 | README_FIRST.txt 存在、中文正常、先检测后修复 |
| H11 | 中文 locale 版本解析正确；javac 缺失为 FAIL |
| H12 | 页面无“下载一个文件/再次下载 BAT”等旧文案，唯一 ZIP 入口 |

## 安全、离线与发布约束

检测只读系统与配置；唯一输出为脱敏报告、result.txt 和剪贴板。修复不接受网页导入的任意路径或命令；不会改 CLASSPATH、删除 jetbra/pojie、删除 IDEA 配置或操作许可证。UAC、联网与 winget 只在用户主动运行修复且机器没有完整 JDK 时发生。

离线资产为 dist/JavaIDEA自检工具-离线版.html，CSS、JS、脚本生成逻辑均内联，且 CSP 不允许网络连接。file:// 环境在 crypto.subtle 不可用时必须显示：

> 离线版无法自动计算哈希，请以 GitHub Release 页面公布的 SHA-256 为准。

该消息须附 Release 链接，不能显示 undefined、空白或异常。离线哈希不可用不阻止下载 ZIP。

固定发布资产通过 GitHub Release 提供，并公布文件、SHA-256、版本、日期。生成型 ZIP 的哈希因教育邮箱而不同，网页可显示当前 ZIP 的哈希，但不能把它冒充固定发行哈希。Pages 工作流在发布前运行自动测试并发布 dist；真实 Explorer 解压、杀软多引擎、普通 VM winget 安装、UAC/跨账户、受控机房与公开 Release/Pages 状态必须按 TESTING.md 如实标记，不能用 mock、Sandbox 或未执行的计划宣布通过。
