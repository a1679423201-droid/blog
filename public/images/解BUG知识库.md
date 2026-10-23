# 座舱 Bug 排查知识库（AI 参考）

> 来源：`D:\work\BUG汇总\` 下 **90 份分析报告**提炼（2026-10-13 整理）
> 用途：换新机器后，让 AI 快速获得"怎么解这个仓的 Bug"的领域知识，无需重读原始报告。
> 适用项目：`D:\Launcher`、`D:\SystemUI`、`D:\CarLink`、`D:\CarLife`、`D:\MyPlayer`（座舱 BU，广汽/五菱车系）

**怎么用这份文档**
先读第 0 节的铁律和第 1 节的分流树 —— 90% 的 Bug 能靠这两节定位到方向。
然后按模块跳到对应分册：连接类看 `解BUG知识库-CarLink连接.md`，音频显示看 `解BUG知识库-音视频投屏.md`，桌面系统 UI 看 `解BUG知识库-桌面与SystemUI.md`。

---

## 0. 铁律（先记住这些，能省掉一半弯路）

### 0.1 日志时间不可信，必须读行内时间戳
- **APLog 目录名会骗人**：RTC 未同步时，会话目录名用错误时间（`APLog_151_2025_0618_001617` 内部实为 2026 年；`APLog_132_2025_0622` 实为 2026-09-24）。
- **btsnoop 文件名是记录起始时间**，不是结束时间 —— 容易误判"日志没覆盖复现点"。
- **手机与车机时钟可能差数十秒**（实测 +12.322s、31 分钟）。
- 正确做法：一律用 `main_log` **首尾行的时间戳**判定时间窗；跨端对齐用 RTSP `date:` 头、心跳、`Client info name` 锚点。

### 0.2 日志文件本身的完整性要先验
- `.curf` 是**纯文本**可直接 grep；`main_log_N_<时间>.gz` 是轮转件、`main_log_<时间>.curf` 是当前件 —— **必须合并看**才是完整时间线。
- **附件截断是高频现象**（缺 ZIP 中央目录，案例：427478/429635/416993/427131/030_042/030_049/040_019）。分析前先验完整性，坏了就要求重传或流式恢复。
- `crash_log` 里的崩溃**未必与本 Bug 相关**（factoryapp、USB 测试常崩），先做相关性判断。

### 0.3 先证明"这份日志是这一单的"
提单/分析前必做三项核验：
1. **md5 去重** —— 同一批目录里唯一，防止一个日志包被贴到多个单；
2. **版本号一致** —— 附件版本 ↔ 标题版本 ↔ 日志内版本串（如 SDK aar md5 `67a853fca8903c9c98cf1651cc42c501` + 版本串 `v2.1.0-202508201719-70693e68` 必须逐字一致）；
3. **时间窗覆盖复现点**，且**视频时段与日志时段重叠**（曾出现视频文件名时间晚于日志包导出时间的坑 → 必须"先复现后导出"）。

**旧日志不能当根因依据**：429353 附件是 15 个月前的旧包，根本不覆盖复现时间。

### 0.4 不要用文档/目录名判版本
- AAR 文档记 `WallpagerLib 1.0.5`，工程实际是 `1.2.0-SNAPSHOT`。
- 用**日志行号反推源码**、`dumpsys` 查 APK 版本、做**行号偏移校验**（CarLink 日志行号 = 源码行号 − 3）。

### 0.5 代码行号必须回读源码确认
本仓代码迭代快，报告里的行号会漂移。**引用任何 `文件:行号` 前，先 grep 回读当前源码**。
CarLink 已知偏移：`ConnectionManager.java` 偏移 0；`CarLinkInitService.java` ±11~27。

### 0.6 区分"配置问题"还是"代码问题"
界面元素**缺失/多出/该显示没显示**，先怀疑**配置字绑定错位**，再查代码。常读配置字：
`getCarImg CAR_MODE`、`STEERING_WHEEL_CUSTOM_BUTTON`、`PHOTOS_VIDEOS(139)`；
常量见 `android.car.settings.CarConfigUtil`。
案例：419005 把配置 1 读成另一个 byte。

### 0.7 环境坑（本机 Windows）
- Bash 里调 Windows 原生 python/ffmpeg，路径**不能写 `/d/...`**（会被展开成 `D:\d\...`），统一用 `D:/...`。
- Git Bash 缺 coreutils 时（`ls`/`date` 报 command not found）加：
  `export PATH="/c/Users/yangmeiduan/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:$PATH"`
- 多行 python **别用 heredoc**（易丢内容），先 Write 落 `.py` 再执行。
- Bug 目录名含**中文全角括号**，脚本里路径务必加双引号。

---

## 1. 分流树：拿到一个 Bug 先走这里

### 1.1 通用四步

```
① 验日志（0.2/0.3）→ 不合格就要求重传，别硬分析
② 定位"主角进程/模块" → 看是该进程崩溃、无响应，还是数据没到
③ 找"成功轮 vs 失败轮"的差异 → 2×2 交叉表，唯一变量即根因
④ 反证排他 → 把疑似根因的现象在成功轮里找一遍，出现即排除
```

**第③步是本仓最高效的定责手段**（贯穿所有报告）：同一份日志里找一次成功、一次失败，比对**唯一变量**（广播类型、STA 是否在位、是否请求加密、PIN 是否上屏）。分离度 ≥1/1 即坐实。

**第④步同样关键**：`not resolved`、`LE Enable 0x0C`、`reason 0x13` 这些看着像根因的现象，**在成功轮里也出现** → 只是伴随现象，不是根因。

### 1.2 按现象分流

| 现象 | 主责方向 | 先查什么 | 详见 |
|------|---------|---------|------|
| 无线连接失败 / 报 10003 | 车机↔手机↔SDK 三分 | **失败前最后一条 `UCar_` 报错**（10003 是统一出口，不是根因） | 连接分册 §1 |
| 回连失败 / 反复弹 PIN | 密钥协商 or 广播类型 | `UCar_ServerKeyNegotiator` quick vs normal | 连接分册 §2 |
| 首次/非首次连接耗时超标 | 分段计时 | `setConnectPhase` / `onConnectingProgress` 逐段切 | 连接分册 §3 |
| FM/音乐不压低、铃声无声音 | 手机侧零发送 | 窗口内 `STREAM_*` 事件计数是否为 0 | 音视频分册 §1 |
| 全屏/小窗残留、黑屏、花屏 | SDK 视频管线 | `startCast width` 不一致、`signalError -22` | 音视频分册 §2 |
| 各类时延超时（050/030） | 手机编码管线 | 控制面(~30ms,达标) vs 媒体面 | 音视频分册 §3 |
| 桌面控件状态不对（恒 OFF 等） | Launcher 消费逻辑 | 先 grep 状态管理器 TAG，确认数据到了没 | 桌面分册 §1 |
| 状态栏/DockBar 消失又出现 | SystemUI 崩溃 | `crash_log` + `main_log.boot` 启动时序 | 桌面分册 §2 |
| 蓝牙"已连接"但本地音乐说未连接 | A2DP 偏好被污染 | `mediaSyncEnabled` + 全局 key | 桌面分册 §3 |
| 点了没反应 / 弹窗不消失 | 生命周期 / 热区 / 防抖 | onPause vs onStop、View 热区尺寸 | 桌面分册 §4 |

### 1.3 责任方区分口诀

- **车机可控**：起 SoftAP/AP 重启、应用列表串行、UI 拉起时机、看门狗时长、广播回退策略、PIN 上屏链路、浮窗生命周期、cardbinding 状态源。
- **手机可控**：确认→BLE 写 1.5~1.9s、会话收尾等心跳、回连延迟、停心跳、删配对后走 normal、退避不重试、编码管线。
- **联盟 SDK**：密钥协商 quick/normal 选择与拒绝、`mustBeShow` 契约、删密钥策略、心跳超时阈值、P2P/AP 选路、解码器竞态与 error 自愈。
- **平台/芯片**：LE 链路在位拒广播（0x0C）、RPA/LTK 身份记录（native 蓝牙栈）、USB Host 枚举、音频 focus 策略。

> **判责手机侧前必须闭环手机日志**（如"手机log 274870"、"OLC1547554330485145600"）。
> 缺手机日志时只能证明"协议层双方已进入 X 状态"，**不能定手机内部原因**，别把推断写成实测。

---

## 2. 举证与提单口径

### 2.1 硬证据强度排序
1. **HCI 原始抓包（btsnoop_hci_*.log）** —— 链路层唯一权威。能给出方向 + 毫秒时序（`LE Enhanced Connection Complete`、`LTK Request/Negative Reply`、`Disconnection Complete reason`、`LE Set Advertising Parameters status`）。要求：有方向标注 + 与框架日志毫秒级对齐（<1s 可接受）。
2. **主日志完整时间线** —— 覆盖失败点前后各 ≥2min。
3. **手机侧日志** —— 判责手机前必须闭环。

**对照组比单次失败日志更有说服力**：同包成功轮 vs 失败轮；另一机型复测包（OPPO 33 轮 0 失败 vs vivo 4/4 失败）。

### 2.2 可复现脚本能显著提升说服力
报告里充分使用的做法：写**只读判定脚本**（`replay_bug_417358.ps1`、`bug-418782-lifecycle-check.ps1`、`oppo_rounds.py`），输出 `[PASS]/[RED]` 签名，提单时附脚本 + EXIT_CODE。

### 2.3 报告结构（沿用现有《分析报告.md》格式）
1. **一句话根因**（标题下方，最重要的东西）
2. 现象 + 复现步骤 + 环境（车型/版本/手机/连接方式）
3. 证据链（日志行 + 时间戳 + 计数）
4. 根因分析（代码定位，注明文件:行号）
5. 修复方向 / 已落地补丁
6. **明确列出"不修项"与"证据缺口"**

第 6 点很关键：把伴随现象（`LE 0x0C`、`reason 0x13`、`addInterface failed:5`、`Remove group BUSY`）逐条声明**无因果**；把"缺手机日志/无 HCI"作为缺口列出并给补抓清单 —— **避免被反问**。

### 2.4 校验/回归验收模板（连接类）
- A/B 交替 30 次成功率 100%
- 需恢复加密的轮次全部 `RPA resolved + smp state=2 + key size=16`
- 定向广播成功后 2s 内应出现 `onServerConnectionState(newState=2)` + MTU + Client info
- 首次短连失败须在 UI 10s 超时前自恢复，**不得静默停在 0%**

---

## 3. 项目结构与横展规律

### 3.1 仓库与模块映射

| 仓库 | 模块划分 | 备注 |
|------|---------|------|
| `D:\Launcher` | `common-core/`（公共）+ `core-launcher-<车型>/`（A21/A29/A29-Y3/S58/T08/T55/T60/T79-G2/T88） | 多车型 flavor |
| `D:\SystemUI` | `app-systemui/src/main/`（公共）+ `src/SystemUI<车型>/`（覆层）；另有 `app/`（早期渠道，部分重复）、`ViewsLib/`、`MobileConnectLib/` | 同名类覆层优先 |
| `D:\CarLink` | `app-carlink`（**8 寸**，Kotlin）+ `app-carlink-a29-y3-146`（**14.6 寸**，Java）+ `library-aidl` | 见下 |
| `D:\CarLife` / `D:\MyPlayer` | — | 各自独立 |

> ⚠️ **CarLink 模块判别（易混，务必先判）**：
> ① 日志 tag `CarLinkInitService.kt` = `app-carlink`；`CarLinkInitService.java` 需再按行号比对两模块。
> ② 日志 versionName 的 `Platform:` 字段（A29-Y1=8 寸）。
> ③ **同为 A29 车系，8 寸与 14.6 寸现场不同，勿互相套用结论。**
> 已验证：430154/429408(8寸)=app-carlink；418749(14.6寸)=a29-y3-146；428150/428137 按行号判定为 a29-y3-146。

### 3.2 横展判据（怎么判断要不要横展到其他车型）

1. **代码是否"同源复制"** —— 某车型由另一车型 follow 而来（注释里的 `followT55`、commit `f1e15a8`），缺陷极可能同源共存。查 `git log` / blob hash / 文件逐字节 diff。
2. **公共代码 vs flavor 覆层** —— `main/` 里的缺陷天然全车型；**flavor 里缺某段 = 单个车型漏改**。
3. **共用 Manager/Key 类** —— `BlueScanAndSyncDeviceManager`、`BlueDisconnectWaitManager`、`CardEditDragAdapter`、`SimpleItemTouchHelperCallback` 等共用类，缺陷必然共用。
4. **有没有人恰好触发** —— 共性缺陷常"先在某个车型撞到"。例：439783 的 A21/T55/T79G2 同写法，只是先在 T79-G2 撞到。

### 3.3 已知待横展清单（改一处要想到这些）

| 模式 | 已修 | 待横展 |
|------|------|--------|
| 屏保/关屏互斥 | A21(参考实现)、T79G2 | T60/T88/A29G2/A29Y3/T55/S58/T08/A79G（A29Y3 只有 `ClickDebouncer`、S58 只有 `isClickOpenFullScreen`，**均非跨动作互斥**） |
| 蓝牙 A2DP 偏好兜底 | 待改 | `isA2dpSyncEnabled*()`：T79G2:2044 / A21:2166 / T55:2082 同构 |
| 卡片拖拽 `onChildDraw` 钳制 | T55(有) | T79G2(缺)；同查 a21/t60/t88/s58 |
| DockBar 构造同步取 Car 服务 | T79G2 | SystemUIT55（同源未调 `getDriveModeSwitch`）、SystemUIT88 |
| 浅色壁纸适配 `98e7f7da` | T55 | T79G2（已移植待验）、A21 |
| VR 键短按拉投屏 | — | `app-carlink`(Kotlin) 与 `app-carlink-a29-y3-146`(Java) 同构 |

### 3.4 移植注意事项
- 各车型 `viewBinding` 里**按键 id 名可能不同**；移植后用 blob hash 逐字节比对确认完整（如 433546 移植后与 T55 blob 一致）。
- **确认原修复是否只接了部分入口**：如"取消→deInit SDK"只接了设备历史页，漏了 PIN 引导页 `tv_quit` 和返回键（429978）；`cf3d0a43` 只加回调没注册 A21 车速 ID（407428/413967）。
- **确认分支**：修复可能只在某版本线（`9fbe9ec` 只在 certification 分支，main/A21 线无）（431808）。

---

## 4. 项目约定

### 4.1 代码规范
- **Car 服务获取**：**禁止在构造函数里同步取** `CarCanManager.getCar()` / `car.getCarManager(...)`。
  正确范式 = `manager/AudioManager.java` 的 `init()`：`addOnCarServiceConnectStateListener` 里连上才赋值、断开置 null。
- **状态收敛**：同一控件不要两套互不约束的状态源（415029 的 alpha + 背景冲突）。状态源语义要单一。
- **两个 key 不可互兜底**：`blueDeviceA2dpSyncStatus_<MAC>` = 用户偏好；`lastBlueDeviceA2dpConnectStatus` = 链路快照。
- **加载态**：数据就绪即隐藏 loading；不要把"隐藏 loading"绑死到异步兜底定时器；缓存命中不应显示 loading。
- **浮窗**：跨应用 `TYPE_APPLICATION_OVERLAY` 浮窗应在 **`onPause`** 而非 `onStop` 关闭；`cancel()` 要幂等；不要吞异常。
- **防抖**：入口点击加 `ClickUtils.isFastClick()`；防抖要**按 View 记录**而非全局静态时间戳（417091 全局 `isFastClick` 污染其他按钮）。
- **可观测性**：关键分支补中文日志（null 时告警、记录车型/能力/visibility、`cancel(reason)`）。

### 4.2 文案/资源规范
- 灰态用 selector / 显式禁用资源，**不要只用 `setAlpha(0.4f)`**（416917 与设计不符）。
- 文案不能硬编码车型不一致（RACE vs Sport+）；兜底资源语义要与产品定义对齐（**默认壁纸 ≠ 车模图**）。
- 引导页「取消」按钮不应通栏大热区。

### 4.3 提交规范
```
fix(<模块>):【<车型/用例>】<描述>
```
例：`fix(Launcher): 【A29-Y3-146】bug号 bug标题`
完整模板见 `D:\个人手顺\git提交模板.txt`；Gerrit 流程见 skill `gerrit-changeid-fix`。

### 4.4 编译验证（改完必须做）
```powershell
$env:JAVA_HOME='C:\Program Files\java\jdk\jdk11'   # 注意 java 小写父目录
$env:Path="$env:JAVA_HOME\bin;$env:Path"
cd D:\SystemUI
.\gradlew.bat --no-daemon :app-systemui:compileSystemUIT79G2DebugJavaWithJavac
```
- Launcher 单模块：`:\core-launcher-t79-g2:compileDebugJavaWithJavac`（约 50s，比整包快得多）
- CarLink：任务名必须是 **flavor 全名** `compileCarLinkA29Y3DebugJavaWithJavac`；构建前 `unset JAVA_HOME`
- ⚠️ **javac 报 `UP-TO-DATE` 不能证明产物是旧的**（出现过刚改完源码却报 UP-TO-DATE 的 Gradle VFS 误判）。
  客观收口：`grep -ac '<本次新增方法名>' <class文件>` + 比对 class mtime > src mtime；必要时 `--rerun-tasks`。

### 4.5 分析流程（禅道 → 报告）
```
fetch_zentao_bugs.py 抓取 → _extracted_logs 解压 → 日志覆盖性判断
→ 代码定位（grep 类名/方法名）→ 在 Bug 目录生成 分析报告.md
```
- Bug 目录**扁平结构**：`D:\work\BUG汇总\<Bug完整标题>\`，禁止再建分类父目录。
- 详见 skill `zentao-bug-analysis`（含 `project-paths.json` 路径映射）。

---

## 5. 分册索引

| 分册 | 覆盖内容 | 主要来源 |
|------|---------|---------|
| `解BUG知识库-CarLink连接.md` | 广播/回连/PIN/密钥协商/耗时/P2P 共 12 个根因模式 | 40+ 份连接类报告 |
| `解BUG知识库-音视频投屏.md` | 音频焦点/duck/音画同步/解码器/时延卡顿 共 13 个模式 | 20+ 份音视频报告 |
| `解BUG知识库-桌面与SystemUI.md` | Launcher/SystemUI/蓝牙/空调/壁纸/卡片 共 11 个模式 | 20+ 份桌面类报告 |

### 关键代码地图（各仓根目录）
- `D:\Launcher\project.md`（31K）
- `D:\SystemUI\project.md`（7K，含 flavor↔车型表、日志 TAG↔模块）
- `D:\CarLink\project.md`（72K，最详尽，含屏幕尺寸↔模块映射、Bug 分析沉淀）

> 这三份 `project.md` 由 Bug 分析流程持续维护，**是比本知识库更细的代码地图**，
> 换机器时建议一并带走（在 `project.md` 所在仓库根目录）。
