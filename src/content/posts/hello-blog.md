---
title: "这个博客终于跑起来了"
published: 2026-10-22
description: "从一台闲置的云服务器到能自动发布的博客，记录一下这套东西是怎么搭起来的。"
tags: ["随笔", "建站"]
category: "生活"
draft: false
lang: "zh_CN"
---

折腾了一晚上，这个博客总算上线了。

## 它是怎么跑起来的

内容用 Markdown 写，[Astro](https://astro.build/) 构建成纯静态页面，放在一台 2 核 2G 的云服务器上，nginx 容器托管。

平常写文章不用碰终端：打开网页后台，填标题、选标签、传封面图，正文用可视化编辑器写，点保存之后一分钟左右网站就更新了。

后台保存的内容会提交到 GitHub，GitHub Actions 自动构建，服务器每分钟拉取一次最新的构建产物。整条链路没有任何需要手动维护的密钥。

## 后面打算写什么

- Android Framework 和 AOSP 编译、调试中踩的坑
- Launcher、SystemUI 相关的排查记录
- SELinux 权限问题的定位思路
- 偶尔写点生活

希望这次能坚持写下去。
