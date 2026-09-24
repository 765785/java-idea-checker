# 验收记录

## 已执行（2026-09-24）

- `node --test tests/*.test.js`：19项通过（迁移到独立目录后已重跑）。
- JavaScript判定：空机器、JRE-only、转发器同源/不同源/未知、8+25版本警告、真实故障仍可修复、磁盘不可用、四档邮箱、旧schema、截断JSON。
- Windows PowerShell5.1：两种BAT载荷AST解析成功；注册表修复计划String/ExpandString/新建/空值/超长/异常类型、中文winget候选提取、Toolbox四档匹配和脱敏。
- 剪贴板两种渠道模拟失败时，result.txt仍包含两个错误记录。
- 实机只读BAT试跑：中文+空格目录，启动工作目录System32，PowerShell5.1生成result.txt；该次报告errors为0。未修改主机环境变量或安装软件。

## 未实测 / 不能据此宣布通过

- 浏览器交互和视觉：浏览器工具安全策略拒绝本地file URL，未绕过限制；未完成下载按钮、拖拽、桌面截图等真实浏览器验收。
- 普通虚拟机中的winget真实安装、scope重试、UAC拒绝、跨账户提权、标准用户注册表写入、Explorer新开cmd广播验证。
- 真实8.3短路径fixture、受控机房和杀软拦截、PS7/ISE执行。
- GitHub Pages公开部署与线上访问：未推送、未发布。

## 运行方法

在本目录执行 `node --test tests/*.test.js`。可选执行 `node tests/smoke-bat.js` 进行当前机器只读采集，会临时使用剪贴板并写`.cache`。

修复的真实写入必须在Hyper-V/VMware快照中测试。Sandbox可能没有winget，不能用来证明安装路径已实测。完整35场景及F01–F07目标见docs/spec.md，每项实施时保留输入、实际输出和通过/失败证据。
