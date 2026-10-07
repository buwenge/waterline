# waterline

[Claude Code](https://code.claude.com) 的一个侧栏 mod。平时收成输入框上方的一个小入口「◂ 模组」，点开是右边一栏，栏里只列模组名，点名字展开。第一个模组是**水位线**：上下文、5 小时额度、周额度像水位一样往上涨，涨到你画的那条线，就自动发一句你提前写好的话给 Claude。

A collapsible sidebar mod for Claude Code. Its first module, **水位线 (waterline)**, watches the context window and the 5-hour / weekly usage limits; when one rises past a line you set, it sends Claude a message you wrote in advance — inserted into the running turn if Claude is mid-work. The UI is in Chinese.

```
模组                                    收起 ›
──────────────────────────────────────────────
▾ 水位线               ✓ 已存 14:31  [ 保存 ] ● 开
  上下文                          322k / 1000k
  ━━━━━━━━━━━━━┃──────────────────────────────
  到 [ 350        ] k 时，发：      ✎ 大框里改
  ╭──────────────────────────────────────────╮
  │上下文到线了，写好交接就停下等我。        │
  ╰──────────────────────────────────────────╯

  额度  任一条到线就发              ✎ 大框里改
  5小时 ━━━━━━━━━━━━━━━━━┃  92% [ 95       ]
  周    ━━━━━━━━━━━━──────┃  63% [ 100      ]
  Fable ━━━━━━━━━━━┃──────  60% [ 60       ]
  Fable 那条只发给跑 Fable 的窗口
  ╭──────────────────────────────────────────╮
  │额度到线了，写好交接就停下等我。          │
  ╰──────────────────────────────────────────╯
```

粗线是已经用掉的，竖线是你画的线（方括号里填的数）。

## 水位线

适合人在电脑前偷懒、或者临时走开，让 Claude 自己干活的时候：到线了它会收到你提前写好的话，自己收尾。

- **几条线**：上下文（单位 k）、5 小时额度（%）、周额度（%），能读到的话还有 Fable 周额度（%），都可以留空不盯。上下文配一句话，额度配一句话（几条额度线哪条先到都发这句）。
- **怎么发**：Claude 正在干活，就插进当前这一轮，它下一步就能读到；Claude 闲着，就直接发一条，让它开始新的一轮。过线那一步正好是收尾的，不插，等这一轮结束发一次，不会重复。
- **发几次**：每条线只在读数从线下涨到线上的那一刻发一次。打开开关或改线时已经过线的不补发，免得一保存就打断正在干的活；读数降回线下（清了上下文、额度刷新）以后再过线，会再发。
- **发什么**：前面自动带一句哪条线、现在多少，比如「【到线提醒】上下文 352k，到了 350k 的线。」，后面接你写的话。话留空就只弹提示、不发。
- **读数从哪来**：上下文、5 小时、周额度来自 Claude Code 自己（跟状态栏是同一组数字），不需要额外的脚本或接口。订阅账号都能读到，普通登录、`claude setup-token` 的长期令牌都行。按量付费的 API 账号没有 5 小时 / 周额度，只有上下文那条线起作用。
- **Fable 周额度**：Claude Code 不把它交给插件（跑 Fable 的会话里也一样），所以另外拿：
  - 普通登录（`/login`）：自动问官方额度接口（Claude Code 的 `/usage` 背后那个），不花 token。只在开关开着且填了 Fable 线、或者打开侧栏时才问，每个窗口最多 5 分钟一次；被限流就按对方给的时间等。
  - 长期令牌（`setup-token`）：这个接口不认，会被拒或限流。有办法自己把 Fable 那条记进文件的，在设置里填「额度文件」，填了就优先读文件。
  - 这条线**只发给正在跑 Fable 的窗口**，别的模型的窗口显示这根条，但不会收到这句话。读数旧了会标「几小时前的数」。
  - 两条路都没有，Fable 那行就不出现。
- **几个窗口**：共用一份设置，在哪个窗口改都一样。上下文各窗口各算各的；额度是整个账号的，到线时正在干活的窗口都会收到。闲着的窗口没在用额度，读不到新数字，不会被叫醒。
- **只在交互窗口里起作用**：`claude -p` 这类非交互会话即使加载了插件，也不盯线、不发话。

## 安装

在 Claude Code 里输入：

```
/plugin install waterline --marketplace buwenge/waterline
```

问是否添加 marketplace 时选 `y`，再选安装范围。

想自己改代码，就从目录加载，改完已开的窗口会自动热加载：

```bash
git clone https://github.com/buwenge/waterline
claude --plugin-dir ./waterline
# 或者在启动脚本里：export CLAUDE_CODE_PLUGIN_DIRS=/path/to/waterline
```

在 Claude Code 2.1.292 上开发和测试。mod（function hooks 插件）还是 Claude Code 的早期功能，接口可能随版本变化。

## 用法

- 鼠标点「◂ 模组」，或输入 `/mods`，打开 / 收起侧栏；点「水位线」展开。
- 键盘：`ctrl+x` 再 `Tab` 进侧栏，`Tab` 在格子间移动，`Esc` 回到输入框。
- 填好以后点「保存」，或在格子里按回车。圆点是开关，点了立刻生效，不展开也能点。
- 侧栏里的输入框只显示一行（Claude Code 自带输入框的限制，光标走到后面也不跟着滚），放不下的后半句用灰字接着写在框下面。长句子点「✎ 大框里改」：这句话会放进最底下的主输入框，改完按回车就存回来，**不会发给 Claude**（开头那个〔到线提醒·…〕记号别删）。
- 输入框上方那行如果被点了 `[-]` 收起来了，按 `ctrl+x` 再按 `ctrl+a` 展开。

## 设置

`/config` 里有两项，也可以写进 `~/.claude/settings.json`：

| 项 | 说明 |
| --- | --- |
| 时区 `timeZone` | 「已存 HH:MM」用的时区，IANA 名，如 `Asia/Shanghai`。留空用机器的时区（服务器上通常是 UTC） |
| 不生效的目录 `ignoreDirs` | 在这些目录（及子目录）里开的会话不盯线、不发话 |
| 额度文件 `quotaFile` | 可选。Fable 周额度从这个 JSON 文件读（填了就不问官方接口），格式：`{"windows": {"seven_day_overage_included": {"utilization": 27, "at": <秒级时间戳>}}}` |

用 `--plugin-dir` / `CLAUDE_CODE_PLUGIN_DIRS` 加载时，`settings.json` 里这样写（注意要套一层 `options`）：

```json
{
  "pluginConfigs": {
    "waterline@inline": {
      "options": {
        "timeZone": "Asia/Shanghai",
        "ignoreDirs": ["/path/to/skip"],
        "quotaFile": ""
      }
    }
  }
}
```

## 往侧栏里加自己的模组

`hooks/register.tsx` 里的 `MODS` 清单加一行（名字），再在侧栏的渲染钩子里写它展开后的内容；要存的值在 `types/index.d.ts` 里声明。

## 开发

```bash
claude plugin validate .   # 检查清单和钩子
claude plugin test .       # 跑 tests/ 里的测试
```

用 `--plugin-dir` 加载过一次后，Claude Code 会在 `.claude-plugin/types/` 生成类型文件，`tsc -p .` 就能做类型检查。

测试工具里插件自己调用的 `$.session.append`（插进当前这一轮）没有底层实现，这条路只能在真的 Claude Code 里验；测试覆盖的是插不进去时退回排队、不丢话。

官方额度接口回包里 Fable 那条的格式，是按 2026 年 9 月以前普通登录时实测的写法解析的（`limits[]` 里 `kind: "weekly_scoped"` 的那项，也认顶层 `seven_day_overage_included`）；作者现在用长期令牌，普通登录这条路没法再实测。读不到时侧栏会写明原因，欢迎提 issue。

## License

MIT
