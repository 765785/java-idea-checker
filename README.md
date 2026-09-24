# Java 环境与 IDEA 学生认证自检（Windows 桌面版）

浏览器出于安全限制无法读取别人电脑的环境变量，所以采用「本地脚本采集 + 网页判定渲染」的方式；所有数据只在用户自己电脑上流转，网页不发往任何服务器。

这是独立的新网页，位于 `windows-checker/`。仓库根目录的原安装网页、安装器和部署配置保持不变。本项目仅面向 Windows 10/11 桌面端，不做手机端适配。

## 使用流程

1. 打开本目录的 `index.html`，输入自己的教育邮箱，点击“生成并下载一键检测.bat”。留空也可以在运行时输入。
2. 普通双击下载的 BAT，等待采集完成。仅需这一个文件，不要单独双击 PS1（Windows 可能用记事本打开它）。
3. 回到网页粘贴剪贴板内容，或拖入 BAT 同文件夹的 `result.txt`。控制台原文也可直接粘贴。
4. 根据结果修复；修复完成后关闭窗口，普通双击检测 BAT复检，再粘贴新结果。IDEA 教育包仍须本人到管理订阅中确认。

网页可通过 `file://` 直接使用，无需 Python、本地服务、npm 或任何安装。浏览器生成 BAT 时不会下载远程脚本。邮箱在点击生成后仅保存到此浏览器的 localStorage；“清空本机保存的邮箱”会清除网页记录，但已下载脚本里的邮箱需要删除文件才能清除。

## 一键修复做了什么 / 没做什么

- 优先复用完整 JDK：有效 JAVA_HOME → 当前非转发器 javac 所属 JDK → `.jdks` 中最新稳定版本 → 其他发现的 JDK。
- 已有可用 JDK时仅修**用户级** JAVA_HOME 和 Path，不联网、不申请管理员权限。其他 Windows 账户不受影响。
- 修改前在修复 BAT同目录的 `backup-时间戳-随机后缀/` 分别保存两级 JAVA_HOME/Path，记录值是否存在、原值和注册表类型；先回读确认备份完整，再修改。
- 备份含原始本机路径，留在电脑上供精确恢复，**不要把备份公开上传**。`repair.log` 为脱敏错误日志。失败时只回滚本次修改过的用户值，不覆盖系统环境。
- 原用户 Path 为 `REG_EXPAND_SZ` 时保留类型，使用 `%JAVA_HOME%\bin`；原为 `REG_SZ` 时保留类型，使用绝对 bin 路径；新建 Path为 `REG_EXPAND_SZ`。异常类型交由管理员处理。
- 修改后重新读取注册表，按“系统 Path + 用户 Path”重建当前进程环境，广播 `WM_SETTINGCHANGE`，执行真实版本与路径验证。
- 系统 Path 中旧 Java排在前面时，用户 Path无法覆盖它。此时保留失败结论、回滚本次修改并指引管理员处理，不为此提权。
- 只有找不到完整 JDK时才通过 winget尝试安装 Temurin 25 JDK，可能需要联网及 UAC。跨账户提权由 SID检测并阻止。拒绝 UAC后重新扫描；仍无 JDK则不写变量，也不声称成功。
- winget使用显式绝对路径，先 machine scope，只有 scope相关错误才去掉 scope重试。包不可确定或安装失败时给手动安装指引。
- 不修改 CLASSPATH，不删除 jetbra/pojie变量或文件，不改 IDEA登录与许可证，不自动升级已有可用 JDK。
- 拟生效 Path达到 2048 字符即停止，这是本工具的保守限制，不是 Windows所有环境变量的统一上限。

如需手动还原，打开备份文件，按 `exists`、`kind`、`value` 恢复用户环境变量；`exists:false` 表示此前没有该变量，应删除本工具新增的变量。不要用损坏、空白或来自其他电脑的备份覆盖当前环境。系统级备份仅供核对；本工具默认不写系统变量。

## 结果怎么看

Java和 javac都能成功执行是黄金标准；还要核对 JAVA_HOME、Path和实际来源。Oracle javapath、WindowsApps 等路径可能只是转发器，以 JVM `java.home` 为实际运行来源依据。短路径、大写小写、尾斜杠不应导致虚假不一致。JDK 8的内部 `jre` 目录会在父目录确为完整 JDK时映射到 JDK根目录。

JDK 8正常使用但本机另有25时仅 WARN，不出现“升级修复”按钮。请按课程要求在 IDEA Project SDK选择版本。`.jdks` 里的 JDK可以离线复用；**请不要在 IDEA里删除已经用于系统环境的这个 JDK，否则 Java环境会一起失效**。

教育邮箱四档仅反映本机字符串证据：完整邮箱、同域名、其他邮箱、未发现。旧配置与插件作者邮箱也可能被扫描到，不代表当前登录账号。配置里没找到字符串证据，不等于认证失败，只说明本机未留下可自动比对的痕迹。

即使 EMAIL_EXACT命中，也只证明 IDEA里曾留下该邮箱痕迹，不等于教育包已激活。最终步骤固定为：**Manage Subscriptions → 找不到教育包时 Refresh license list → 选择教育包并 Activate**。未安装或未启动 IDEA为“需人工确认”，不影响 Java环境结论。

## 手动安装三步

| 第一步：下载 | 第二步：安装/解压 | 第三步：检测 |
| --- | --- | --- |
| 打开 [Adoptium 官方下载](https://adoptium.net/temurin/releases/?version=25)，选 Windows、JDK和对应架构；无管理员权限可选 ZIP | 解压到可写目录，确认 `bin/java.exe` 与 `bin/javac.exe` 均存在。个人 `%USERPROFILE%\.jdks\jdk-25` 可被检测脚本发现 | 普通双击检测 BAT。选择网页的用户级修复；机房受限则联系管理员或在 IDEA Project SDK中选 JDK |

IDEA未安装时主动打开 [官方 IDEA下载页](https://www.jetbrains.com/idea/download/)，装完再回来确认教育包。该外链只在用户点击时访问。

## GitHub Pages 部署（独立新站）

推荐将 **本目录内容** 放入一个新的 GitHub仓库根目录，避免替换之前的网站。

1. 新建仓库，例如 `java-idea-checker`，推送本目录全部内容。
2. Settings → Pages → Build and deployment → Deploy from a branch。
3. 选择 `main` / `/ (root)`，保存后等待发布。
4. 访问 `https://<用户名>.github.io/java-idea-checker/`。

也可将 Pages Source设为 GitHub Actions，使用本目录附带的 `.github/workflows/pages.yml`。此工作流只有复制到新仓库后才生效，不会改动父仓库旧网页部署。自定义域名先配置 DNS与 Pages域名，然后启用 Enforce HTTPS；不要在页面加入 CDN或分析脚本。

## 常见问题

- **执行策略阻止运行**：BAT仅对子 PowerShell进程使用 `-ExecutionPolicy Bypass`，不修改永久策略。单位组策略不能由该参数绕过，应联系管理员。
- **SmartScreen/杀软拦截**：先核对来源和源码，再检查文件属性是否有“解除锁定”。仍被拦截请交管理员审核，不要关闭杀软。
- **java能运行但未通过**：可能仅装 JRE、缺 javac、JAVA_HOME指向 IDEA/jre、实际旧版或转发器遮蔽。带空格或中文路径本身不是错误；引号、尾斜杠、误加 bin会归一化检查。
- **新终端还是旧值**：已有终端不会自动重建环境。关闭旧终端，从开始菜单或资源管理器新开窗口，必要时注销后登录。
- **剪贴板为空**：直接拖入 `result.txt`；文件输出不依赖剪贴板成功。
- **找不到绿色 JDK**：脚本不全盘搜索。放入个人 `.jdks` 子目录或配置 JAVA_HOME后重新检测，亦可先在 IDEA中选择它。
- **PS7/ISE**：生成的 PowerShell主体兼容5.1及以后版本，但推荐双击 BAT，由系统 PowerShell执行。BAT会携带输出目录；脱离 BAT直接执行需要显式提供 `-OutputDirectory`。

## 助教速查

| 情况 | 结果/动作 |
| --- | --- |
| 无 Java，无候选 | 安装 JDK；winget失败给手动下载 |
| java可用、javac不可用 | JRE-only/不完整 JDK专项失败 |
| `.jdks` 有完整 JDK | 离线、无需管理员复用 |
| 用户 JAVA_HOME覆盖系统正确值 | 备份后修用户值 |
| 系统旧 Java/转发器指向旧版 | 真正不一致才 FAIL；管理员处理系统 Path |
| JDK 8正常，另有25 | WARN，按课程选 Project SDK，不自动切换 |
| 机房拒绝写入、Path过长 | 不写值，提供管理员指引 |
| IDEA未安装/未启动 | B区人工确认，A区独立 |
| 旧结果/旧脚本 | 核对时间和用户，重新生成检测 BAT |
| 邮箱没命中 | 不是认证失败，去管理订阅确认 |

## 开发与验收

用户不需要 Node；维护者可在此目录执行 `node --test tests/*.test.js`。Windows测试会调用系统 PowerShell5.1。`node tests/smoke-bat.js` 是可选本机只读采集试跑，会写 `.cache` 并临时使用剪贴板。修复实机测试应在独立虚拟机快照上进行，不能用宿主机冒险验证。

规则索引和35场景清单见 [docs/spec.md](docs/spec.md)，实际验收记录见 [TESTING.md](TESTING.md)。未实测项明确保留，不以模拟测试替代真实 winget安装、UAC或公开部署。
