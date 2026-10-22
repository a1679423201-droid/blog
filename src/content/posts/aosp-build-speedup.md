---
title: "AOSP 编译提速：ccache 到底值不值得开"
published: 2026-10-18
description: "从 42 分钟到 11 分钟，记录一次把 AOSP 增量编译压下来的过程，以及 ccache 命中率上不去的几个坑。"
image: "/images/aosp-build-speedup-cover.jpg"
tags: ["Android", "AOSP", "编译"]
category: "技术"
draft: false
lang: "zh_CN"
---


公司给配的编译机是 16 核 64G，第一次全量编译 `aosp` 花了 42 分钟。后来把 ccache 和 ninja 的参数调明白，日常改一个模块的增量编译稳定在 11 分钟左右。这篇记录一下过程。

## 先说结论

| 配置 | 全量编译 | 改一个 Java 文件 |
| --- | --- | --- |
| 默认 | 42 min | 6 min |
| 只开 ccache | 39 min | 3 min |
| ccache + ninja 调参 | 38 min | 1.5 min |

真正有效的是 **ninja 的并行策略**，ccache 主要在「切分支、clean 之后重编」这类场景下救命。

## ccache 的配置

环境变量写进 `~/.bashrc`，注意 `CCACHE_DIR` 要放在大容量盘上，编译产物动辄几十 G。

```bash
export USE_CCACHE=1
export CCACHE_DIR=/data/ccache
export CCACHE_EXEC=/usr/bin/ccache
export CCACHE_COMPRESS=1
export CCACHE_COMPRESSLEVEL=6
export CCACHE_MAXSIZE=80G
```

然后用 `ccache -s` 看命中率：

```bash
ccache -s
# cache hit (direct)                 48213
# cache hit (preprocessed)            1932
# cache miss                         12044
# hit rate                           80.17 %
```

命中率低于 60% 就基本白开了，常见原因是 `CCACHE_BASEDIR` 没设，`repo sync` 到新目录后路径全变，缓存直接失效：

```bash
export CCACHE_BASEDIR="$PWD"
export CCACHE_NOHASHDIR=true
```

## ninja 参数

`-j` 不是越大越好。16 核机器上 `-j16` 和 `-j32` 的差距很小，但内存峰值能差一倍，`d8` 阶段容易 OOM：

```bash
# 别用这个，16G 的机器会死
m -j32

# 留给 link 阶段一点内存
m -j16 dist
```

如果只是想快速验证一个模块能不能编过，别 `m` 全量，用 `mm` 或者直接指定模块名：

```bash
cd packages/apps/Launcher3
mm -j16
```

## 一个反直觉的发现

`--skip-ninja` 配合 `--skip-ld` 在 CI 上很香，本地千万别用。少了 link 阶段的产物，`system.img` 不完整，烧进设备直接起不来，排查一圈才发现是编译参数的问题。

## 小结

- ccache 值得开，但一定要配 `CCACHE_BASEDIR` 和 `CCACHE_NOHASHDIR`
- `-j` 开到核数就行，再大只会让 OOM 来得更快
- 日常改模块用 `mm`，别动不动 `m` 全量
