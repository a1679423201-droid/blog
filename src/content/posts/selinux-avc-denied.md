---
title: "看懂 SELinux avc denied：从一条报错到根因"
published: 2026-10-12
description: "日志里刷屏的 avc: denied 到底在说什么？这篇用一条真实报错走一遍完整的排查路径。"
image: "/images/selinux-avc-denied-cover.jpg"
tags: ["Android", "SELinux", "排查"]
category: "技术"
draft: false
lang: "zh_CN"
---


刚接触系统层的时候，最怕的就是 `logcat` 里刷屏的这行：

```
avc: denied { read } for pid=1234 comm="system_server" name="u:object_r:foo_prop:s0" dev="tmpfs" ino=5678 scontext=u:r:system_server:s0 tcontext=u:object_r:foo_prop:s0 tclass=file permissive=0
```

## 怎么读这条日志

拆开看其实是五个问题：

1. **谁**在访问 —— `scontext=u:r:system_server:s0`
2. **想干什么** —— `denied { read }`
3. **访问什么** —— `tcontext=u:object_r:foo_prop:s0`，`tclass=file`
4. **是否拦截** —— `permissive=0` 表示真的拦了
5. **哪个进程** —— `pid=1234 comm="system_server"`

把这五个凑起来就是 policy 里缺的一行：

```
allow system_server foo_prop:file read;
```

## 别急着加 allow

九十的坑在于，加了 `allow` 反而把问题藏起来。先问三个问题：

> - 这个文件本来就该 system_server 读吗？
> - 是不是该用 `foo_prop` 这个类型，还是说它本来应该是一个 `vendor_` 前缀的类型？
> - 有没有现成的 `neverallow` 规则已经禁止这种写法？

`neverallow` 是编译期检查，如果加完 `allow` 编译直接报错，说明设计上就不允许这么干，得改的是标签归属，不是 policy。

## 定位标签归属

想知道某个文件被打上了什么标签：

```bash
adb shell ls -Z /system/etc/foo.conf
# u:object_r:system_file:s0 /system/etc/foo.conf
```

想看某个类型在哪些地方被使用：

```bash
grep -rn "foo_prop" system/sepolicy/
```

## 临时验证用 permissive

实在不确定是不是 SELinux 的问题，可以先把它设成 permissive 验证现象是否消失：

```bash
adb shell setenforce 0
# 复现问题
adb shell setenforce 1
```

只用来验证假设，绝对不能带着这个状态出货。

## 小结

`avc: denied` 不可怕，怕的是不看上下文直接 `allow`。记住 `scontext / tcontext / tclass / permission` 四件套，再回头确认「这个访问本身合不合理」，大部分问题都能收敛。
