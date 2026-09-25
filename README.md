# Java 环境与 IDEA 学生认证自检（Windows 桌面版）

浏览器出于安全限制无法读取别人电脑的环境变量，所以采用“本地脚本采集 + 网页判定渲染”的方式；所有数据只在用户自己电脑上流转，网页不发往任何服务器。

这是独立的新网页，只面向 **Windows 桌面端**；本仓库就是它的发布源。旧 `java-idea-installer` 项目中的安装网页、安装器和部署配置不受影响。请在你要检测的 Windows 电脑上打开网页，而不是在手机上打开后再到另一台电脑运行脚本。

> 本工具尽量降低安全软件误报，但不存在“保证不被任何杀软拦截”的方案。修复环境变量、申请 UAC、安装 JDK 都与恶意软件常见行为相似；请只从公开仓库或 GitHub Release 获取文件，并核对来源和哈希。

## 使用流程

1. 下载唯一的 **JavaIDEA自检工具.zip**。ZIP 不含个人邮箱，所有学生下载到的 ZIP 字节一致；教育邮箱会在检测结果出来后，由机器证据和 IDEA 当前账户人证共同确认。
2. 右键 ZIP → **属性** → 如有“解除锁定”则勾选 → 解压。请确认文件夹中恰好有 4 个脚本文件和 1 个说明 txt：**JavaCheck.bat**、**JavaCheck.ps1**、**JavaRepair.bat**、**JavaRepair.ps1**、**README_FIRST.txt**。数量不对通常是安全软件删除了文件，请到隔离区/恢复区找回后再添加这一个已核对项目到信任区；不要关闭杀软，也不要添加全局排除项。
3. 普通双击 **JavaCheck.bat**，**不要以管理员身份运行检测**。黑色窗口结束时会提示你回到浏览器，在第 2 步框中按 Ctrl+V 再点“解析”。也可以拖入同文件夹的 result.txt。
4. 只有网页 A 区显示 FAIL 时，才在**同一个解压文件夹**普通双击 **JavaRepair.bat**。备份目录、repair.log 和 result.txt 都写在脚本所在目录。完成后关闭当前黑色窗口，重新双击 JavaCheck.bat，再粘贴新的结果复检。

网页可通过 file:// 直接打开，也可由 GitHub Pages 托管；不需要 Python、本地服务、npm、CDN 或第三方库。下载过程不收集或保存邮箱；结果页的人证邮箱只在当前页面内存中使用，展示与导出均会脱敏，刷新或点击“清空本页人证输入”后即消失。

## 下载被拦截怎么办

安全软件或浏览器拦截不代表文件一定有问题，也不代表一定是误报。先确认链接来自项目公开仓库，再按下列顺序处理：

1. 浏览器若问“要保留此文件吗？”可在确认来源后点“保留”；若显示“已阻止不安全的下载”，到下载页选择“仍要保留”或恢复下载。下载后点“打开文件夹”，默认通常在 C:\Users\你的名字\Downloads。
2. 对 ZIP 执行“属性 → 解除锁定”后再解压。Windows 新版本可能把网络来源标记传给解压后的文件，**解压不等于一定不会再被拦截**。
3. 360 等安全软件已隔离文件时，在隔离区/恢复区核对文件来源后选择恢复并仅为这个项目添加信任；仍无法恢复时，使用下方免下载方式，或请学校管理员审核。不要关闭杀软或设置全局排除。

脚本是可读的 UTF-8 BOM PowerShell 文本，不含 Base64 内嵌载荷、-EncodedCommand、自解码临时脚本、Invoke-Expression、iex 或 DownloadString。PS1 顶部会说明项目地址、MIT 许可证、会做什么和不会做什么；这能帮助管理员审核，但不能保证任何产品的判定结果。

### 免下载路径 A：只检查 Java 环境

如果下载始终被拦截，可使用网页“复制检查命令”按钮，按 Win+X → Windows PowerShell → 粘贴 → 回车，再把整个输出复制回网页。该命令只在当前 PowerShell 窗口临时使用 -Scope Process，关窗即失效。

> 这是简化检查，只覆盖 Java 环境。学生认证仍需运行完整检测脚本，或按下面的三步手动确认。

免下载路径 A 的 B 区始终是“需人工确认”，不会显示任何认证成功结论：

1. 在 IDEA 中打开 **Manage Subscriptions**；
2. 找不到教育包时点击 **Refresh license list**；
3. 选择教育包并点击 **Activate**。

### 免下载路径 B：手动配置环境变量

1. 打开“系统属性 → 高级 → 环境变量”。
2. 在**用户变量**中新建或修改 JAVA_HOME，填完整 JDK 根目录，例如 C:\Program Files\Java\jdk-25；不要填 bin、jre 或 IDEA 安装目录。
3. 在用户 Path 新增 %JAVA_HOME%\bin。若课程或旧工具要求 JRE 条目，可额外查看提示；现代 JDK 通常没有独立 jre\bin。
4. 关闭旧终端，新开 cmd，分别运行 java -version 和 javac -version。两者都有版本输出才算 Java 环境可用。

## 一键修复做了什么 / 没做什么

- 优先复用完整 JDK：有效 JAVA_HOME → 当前非转发器 javac 所属 JDK → .jdks 中最新稳定版本 → 其他发现的 JDK。
- 已有可用 JDK 时仅修**当前用户**的 JAVA_HOME 和 Path：不联网、不申请管理员权限，其他 Windows 账户不受影响。
- 修改前在 JavaRepair.bat 同目录的 backup-时间戳-随机后缀/ 分别保存用户级和系统级 JAVA_HOME/Path，记录值是否存在、原值和注册表类型；备份回读通过后才会修改。
- 原用户 Path 为 REG_EXPAND_SZ 时保留类型并前置 %JAVA_HOME%\bin；原为 REG_SZ 时保留类型并前置绝对 JDK bin 路径；缺失时新建 REG_EXPAND_SZ。异常类型、不可写注册表和拟生效 Path 达 2048 字符时会停止并给出中文人工指引。
- 修改后重新读取注册表，按“系统 Path + 用户 Path”重建当前进程环境，广播 WM_SETTINGCHANGE，再验证 Java、javac 与实际路径。系统 Path 的旧 Java 真正排在前面时，用户修复无法覆盖它；工具会回滚本次用户修改并指引管理员处理，不为此提权。
- 找不到完整 JDK 才会尝试通过 winget 安装 Temurin 25 JDK，可能联网并请求 UAC。跨账户提权会被 SID 检查阻止；UAC 被拒后仍无 JDK时，不写环境变量，也不会宣称修复成功。
- 不修改 CLASSPATH，不删除 jetbra/pojie 变量或文件，不修改 IDEA 登录、订阅或许可证，也不擅自把已经可用的 JDK 升级到更高版本。

备份含原始本机路径，供精确恢复，**不要公开上传**。repair.log 为脱敏故障日志；失败时只回滚本次写入的用户值，不覆盖系统环境。.jdks 中的 JDK 可离线复用，但请不要在 IDEA 中删除已被系统环境引用的那一个，否则 Java 环境也会失效。

## 结果怎么看

Java 与 javac 都能成功执行是黄金标准；同时会核对 JAVA_HOME、Path 与实际来源。Oracle javapath、WindowsApps、System32 等可能只是转发器：JVM 的 java.home 才是运行时首选证据。短路径、大小写、尾斜杠、引号和误加的 bin 经本机规范化后不应造成虚假不一致。JDK 8 的 java.home=...\jre 只会在父目录确为完整 JDK 时映射回 JDK 根目录。

JDK 8 正常生效而本机另有 JDK 25 时只显示 WARN：课程若要求 25，可在 IDEA 的 Project SDK 中单独选择；工具不会擅自切换。中文或带空格的路径本身不是错误。

### 学生认证准确率说明

学校教育邮箱域名固定为 “dnui.edu.cn”，邮箱名前缀每人不同，工具不会猜测、校验或补全前缀。B 区按三层证据给出四档可信度：

- **高可信**：IDEA 当前账户人证为 @dnui.edu.cn，或机器证据命中本校域名字面量/本校邮箱。
- **中可信**：发现 JetBrains 凭据管理器条目，或发现 IDEA 配置目录中的疑似凭据库文件，但未读到本校域名。
- **需人工确认**：仅存在配置目录、没有自动证据，或采集发生权限/占用异常。没找到证据 ≠ 认证失败。
- **明显不符**：人证为其他域名，或只在账户/许可证主文件中发现其他邮箱且没有更高可信本校证据。

脚本会扫描 IntelliJ、旧版配置和 Toolbox；只读取允许的文本文件，凭据库仅记录文件名，cmdkey 仅记录 JetBrains 条目名，绝不读取密码。无关文件中的 QQ/163 等邮箱只是参考，不会单独判定登录错账号。人证与机器证据冲突时，以 IDEA 左下角当前显示的账户为准。

这不能做到 100% 自动判定：许可证可能加密存储，JetBrains 没有供本工具使用的官方账户核验 API。任何档位都**不等于教育包已激活**。最终始终由本人在 IDEA 中完成：**Manage Subscriptions → 找不到教育包时 Refresh license list → 选择教育包并 Activate**。未安装或未启动 IDEA 显示“需人工确认”，不影响 Java 环境结论。

部分机房电脑重启后会还原系统。如果明天发现又不行了，可能是还原策略，重新运行一次修复即可；持续发生请联系机房管理员。

## 系统要求与手动安装

最低要求：Windows 7 SP1+ 且 PowerShell 3.0+；推荐 Windows 10/11。脚本启动时低于 PowerShell 3.0 会显示中文提示并停止，而不会直接抛出英文堆栈。Set-Clipboard/Get-Clipboard 仅在存在时使用；缺失时会尝试 clip.exe，无论剪贴板是否可用都会优先写出 result.txt。

没有 JDK 或 winget 不可用时，可主动打开 [Adoptium 官方下载页](https://adoptium.net/temurin/releases/?version=25)，选择 Windows、JDK 和正确架构；无管理员权限可下载 ZIP，解压到可写目录，确认同时存在 bin\java.exe 与 bin\javac.exe。个人 %USERPROFILE%\.jdks\jdk-25 也可被检测脚本发现。

IDEA 未安装时可主动打开 [IntelliJ IDEA 官方下载页](https://www.jetbrains.com/idea/download/)；安装并至少启动一次后，再回来检查学生认证。链接仅在用户点击时访问。

## 校验、发布信誉与 Pages

网页每次生成的 JavaIDEA自检工具.zip 都是固定字节内容，显示的 SHA-256 应与同版本 GitHub Release 一致（若浏览器安全上下文不支持计算，会明确提示）。学生可用该值确认 ZIP 未被篡改；固定文件也便于安全软件信誉和白名单积累。

网页生成时的外层 ZIP 名始终是 **JavaIDEA自检工具.zip**。为避免 Release 上传链路的文件名编码差异，固定发布资产使用清晰的 ASCII 别名；它与网页生成的工具包内容完全一致，不含任何个人邮箱。

| 文件 | SHA-256 | 版本 | 日期 |
| --- | --- | --- | --- |
| Release: JavaIDEA-checker.zip | `f5aea985893aa1c348223d210f2753bfa9ca6200cfe4b90fb9e28787d99fd318` | v1.1.0 | 2026-09-25 |
| Release: JavaIDEA-checker-offline.html | `7b717f03ca887d0292264b1088d2bf3efdc8438d7b76ff2bfbaacd9d26e388e7` | v1.1.0 | 2026-09-25 |

核对命令：Get-FileHash -LiteralPath "C:\路径\JavaIDEA自检工具.zip" -Algorithm SHA256

离线版在 dist/JavaIDEA自检工具-离线版.html。它把页面 CSS、JS 和生成脚本逻辑内联，可在断网、file:// 下使用，不依赖 CDN。某些浏览器在 file:// 不是安全上下文，无法使用 crypto.subtle；此时离线版必须显示“离线版无法自动计算哈希，请以 GitHub Release 页面公布的 SHA-256 为准”，而不是留空或报错。

长期信誉建议：公开源码、固定 GitHub Release、提交误报样本给安全厂商或 VirusTotal。360 误报可通过其 [公开申诉入口](http://open.soft.360.cn/report.php) 处理；符合条件的 OSI 开源项目可研究 SignPath Foundation 的免费开源代码签名。其私钥由服务方 HSM 保管，签名主体不是个人；.ps1 可做 Authenticode 签名，.bat 不能。签名也不保证新文件不会被 SmartScreen 或安全软件拦截，信誉仍需要靠可追溯发布和时间积累。

独立部署时，将本目录内容放到新仓库根目录，例如 765785/java-idea-checker；Settings → Pages 中选择 main / / (root)，或使用本目录 .github/workflows/pages.yml。现有公开地址为 [https://765785.github.io/java-idea-checker/](https://765785.github.io/java-idea-checker/)，固定资产应在 [GitHub Release 页面](https://github.com/765785/java-idea-checker/releases) 发布。父仓库旧网页不应被替换。自定义域名配置 DNS 后再启用 HTTPS；不要在页面加入 CDN、统计或分析脚本。

## 助教速查

| 情况 | 建议动作 |
| --- | --- |
| 无 Java、无候选 | 安装完整 JDK；winget 不可用则手动下载 |
| java 有版本、javac 没有 | 只装了 JRE 或 JDK 损坏，安装 JDK |
| .jdks 有完整 JDK | 可离线复用，提醒学生不要在 IDEA 删除它 |
| 用户 JAVA_HOME 覆盖系统正确值 | 运行 ZIP 内修复脚本，修当前用户变量 |
| 系统旧 Java 或转发器指向旧版 | 真正不一致才 FAIL；系统 Path 请管理员处理 |
| JDK 8 可用，本机另有 25 | WARN，按课程要求在 Project SDK 选择，不自动切换 |
| 机房拒写或 Path 过长 | 不写值，给管理员手动处理 |
| IDEA 未装或未启动 | B 区人工确认，A 区独立 |
| 邮箱没命中 | 不是认证失败，到订阅页确认 |
| 下载/解压后缺文件 | 查隔离区/恢复区，核对 4 脚本 + 1 txt |

## 开发与验收

用户不需要 Node。维护者可在本目录运行 node --test tests/*.test.js；可选 node tests/smoke-bat.js 仅对当前机器做只读采集，会写 .cache 并暂用剪贴板。修复真实写入应在 Hyper-V/VMware 快照中验证，不要在宿主机冒险测试。

完整规则和场景见 [docs/spec.md](docs/spec.md)，真实执行记录见 [TESTING.md](TESTING.md)。没有实际运行过的 Explorer 解压、杀软、UAC、受控机房、普通 VM 安装或公开 Release/Pages 校验，必须保留“未实测”状态，不能以模拟测试替代。
