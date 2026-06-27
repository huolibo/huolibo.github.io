---
title: Git 实用技巧
description: 日常开发中高频用到的 Git 命令与技巧。
---

# Git 实用技巧

> 一篇示例笔记，演示代码块、提示框等排版效果。把它替换成你自己的内容即可。

## 撤销与回退

撤销工作区的修改（未 add）：

```bash
git restore <file>          # 丢弃单个文件的改动
git restore .               # 丢弃所有改动
```

撤销 `git add`（取消暂存，保留改动）：

```bash
git restore --staged <file>
```

回退最近一次提交但保留改动：

```bash
git reset --soft HEAD~1
```

## 查看与对比

```bash
git log --oneline --graph --decorate --all   # 图形化提交历史
git diff main...feature                       # 两分支的差异
```

## 临时保存现场

```bash
git stash push -m "wip: 调试登录"   # 暂存当前改动
git stash list                       # 查看 stash 列表
git stash pop                        # 恢复并移除最近一条
```

::: tip 小贴士
给 `git stash` 加上 `-m` 描述信息，之后 `git stash list` 才看得懂当时存了什么。
:::

::: warning 注意
`git reset --hard` 会**丢弃**工作区改动且难以恢复，执行前确认没有未保存的工作。
:::
