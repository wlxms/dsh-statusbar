# dsh-statusbar

独立的底部状态栏插件。Host 半负责命令/终端进程和日志输出，浏览器半负责右侧通道栏、进度条、“新建”菜单和终端输入。

浏览器半在 `ctx.reflect.provide('statusbar', …)` 上暴露扩展服务，其他 client plugin 可以通过 `ctx.get('statusbar')` 注册通道和“新建”菜单项，不需要依赖 `dsh-semantic`。

## 注册通道

通道显示在底部栏右侧导航中。选中后，底部栏会轮询 `read()`，把 `text` 渲染到可选择复制的日志框，并从文本里的 `[NN%]` 解析进度条。

```js
const statusbar = ctx.get('statusbar')
const dispose = statusbar.registerChannel({
  id: 'my-task',
  title: '我的任务',
  description: '可选副标题',
  order: 100,
  async read() {
    return {
      text: '正在执行\n[35%] 编译\n[100%] 完成',
      placeholder: '输入命令，Enter 发送',
    }
  },
  async write(value) {
    // 输入框提交时调用；返回下一次 read 的快照
    return { text: `收到：${value}\n` }
  },
})
```

返回值是取消注册函数。

## 注册“新建”菜单项

```js
const dispose = ctx.get('statusbar').registerMenuItem(
  '任务/构建',
  async () => {
    // 执行 VS Code task / 自定义任务
  },
)
```

也支持对象形式：

```js
ctx.get('statusbar').registerMenuItem({
  path: '任务/构建',
  label: '构建',
  order: 10,
  run: async () => {},
})
```

`path` 用 `/` 分隔，底部栏会把它渲染成“任务 › 构建”的分组菜单。`MenuItem('folder/item1')` 形式的 helper 也可用：

```js
const { MenuItem } = ctx.get('statusbar')
ctx.get('statusbar').registerMenuItem(MenuItem('任务/构建', run))
```

`read()` 返回 `{ text, percent?, status?, placeholder?, actions? }`。底部栏负责渲染日志、进度条、输入框和动作按钮，通道实现者只负责输入/输出。

## 内置终端

- `dsh-statusbar` 自带 shell/命令终端，通过 `+ 新建` 创建；
- 终端通道右侧的 `×` 会结束整个进程树；
- Host 路由在 `/statusbar/…`，不再占用 `/semantic` 命名空间。

## LSP 通道

`C# LSP` 不是状态栏内置通道，而是 `dsh-semantic` 在启动时通过 `statusbar.registerChannel(...)` 注册的普通扩展通道。状态栏本身不依赖语义插件；没有注册者时只显示终端的 `+ 新建`。

未来的 VS Code task、构建任务等只需要注册 channel 和 menu item，不需要修改状态栏本身。
