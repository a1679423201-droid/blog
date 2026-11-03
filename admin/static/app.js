/* ---------------------------------------------------------------
   写点东西 · 后台
   --------------------------------------------------------------- */
(function () {
  "use strict";

  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");

  const S = {
    me: null,
    view: "list",
    posts: [],
    filter: "all",
    query: "",
    current: null,
    slug: "",
    isNew: false,
    dirty: false,
    saving: false,
    deploy: null,
  };

  // ---------------- 基础工具 ----------------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

  const today = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  };

  let toastTimer = null;
  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.className = "toast" + (isErr ? " err" : "");
    }, 2600);
  }

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", "X-Requested-With": "blog-admin" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "请求失败 (" + res.status + ")");
      err.status = res.status;
      if (res.status === 401 && S.me && S.me.authed && !opts.noReload) {
        S.me.authed = false;
        renderLogin();
      }
      throw err;
    }
    return data;
  }

  function confirmDialog(title, message, okLabel, danger) {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "overlay";
      wrap.innerHTML =
        '<div class="dialog" role="dialog" aria-modal="true">' +
        "<h3>" + esc(title) + "</h3>" +
        "<p>" + esc(message) + "</p>" +
        '<div class="dialog-actions">' +
        '<button class="btn" data-act="no">取消</button>' +
        '<button class="btn ' + (danger ? "danger" : "primary") + '" data-act="yes">' +
        esc(okLabel || "确定") + "</button></div></div>";
      document.body.appendChild(wrap);
      const close = (v) => {
        wrap.remove();
        resolve(v);
      };
      wrap.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]");
        if (act) return close(act.dataset.act === "yes");
        if (e.target === wrap) close(false);
      });
      wrap.querySelector('[data-act="yes"]').focus();
    });
  }

  const ICON = {
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.4-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4Z"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  };

  // ---------------- 登录 ----------------
  function renderLogin() {
    app.className = "";
    app.innerHTML =
      '<div class="login-wrap"><div class="login-card">' +
      '<div class="login-mark">写</div>' +
      "<h1>写点东西</h1>" +
      "<p>输入管理员密钥，进入后台。</p>" +
      '<form id="login-form">' +
      "<label for=\"pwd\">管理员密钥</label>" +
      '<input id="pwd" type="password" autocomplete="current-password" placeholder="••••••••" autofocus />' +
      '<button type="submit" id="login-btn">进入</button>' +
      '<div class="login-err" id="login-err"></div>' +
      "</form>" +
      '<div class="login-foot">内容通过 GitHub 保存，提交后约 1～2 分钟自动上线。</div>' +
      "</div></div>";

    const form = $("#login-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#login-btn");
      const err = $("#login-err");
      err.textContent = "";
      btn.disabled = true;
      btn.textContent = "验证中…";
      try {
        await api("/api/login", { method: "POST", body: { password: $("#pwd").value } });
        await boot();
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
        btn.textContent = "进入";
        $("#pwd").select();
      }
    });
  }

  // ---------------- 框架 ----------------
  function renderShell() {
    app.className = "";
    app.innerHTML =
      '<div class="shell">' +
      '<aside class="sidebar">' +
      '<div class="brand"><div class="brand-mark">写</div>' +
      "<h1>极限盲子的博客</h1><span>WRITING DESK</span></div>" +
      '<div class="nav">' +
      '<div class="nav-label">内容</div>' +
      '<div class="nav-item" data-view="list">' + ICON.list + "文章<span class=\"count\" id=\"nav-count\"></span></div>" +
      '<div class="nav-item" data-view="new">' + ICON.pen + "写新的</div>" +
      '<div class="nav-label" style="padding-top:16px">站点</div>' +
      '<div class="nav-item" data-view="settings">' + ICON.gear + "站点设置</div>" +
      "</div>" +
      '<div class="side-foot">' +
      '<a class="nav-item" id="site-link" target="_blank" rel="noopener">' + ICON.out + "查看网站</a>" +
      '<div class="nav-item danger" id="logout">' + ICON.out + "退出登录</div>" +
      "</div>" +
      "</aside>" +
      '<main class="main" id="main"></main>' +
      '<nav class="mobile-nav">' +
      '<button data-view="list">' + ICON.list + "文章</button>" +
      '<button data-view="new">' + ICON.pen + "写</button>" +
      '<button data-view="settings">' + ICON.gear + "设置</button>" +
      "</nav>" +
      "</div>";

    $$("[data-view]").forEach((el) => {
      el.addEventListener("click", () => {
        const v = el.dataset.view;
        if (v === "new") {
          if (S.dirty && S.view === "edit") {
            confirmDialog("还有未保存的修改", "现在离开会丢掉刚才写的内容。", "放弃修改", true)
              .then((ok) => ok && newPost());
          } else newPost();
          return;
        }
        if (S.dirty && S.view === "edit" && v !== "edit") {
          confirmDialog("还有未保存的修改", "现在离开会丢掉刚才写的内容。", "放弃修改", true)
            .then((ok) => ok && showView(v));
          return;
        }
        showView(v);
      });
    });

    $("#site-link").href = (S.me && S.me.site) || location.protocol + "//" + location.hostname + "/";
    $("#logout").addEventListener("click", async () => {
      await api("/api/logout", { method: "POST", noReload: true }).catch(() => {});
      S.me.authed = false;
      renderLogin();
    });

    showView(S.view === "edit" ? "list" : S.view);
  }

  function markNav() {
    $$("[data-view]").forEach((el) => {
      el.classList.toggle("active", el.classList.contains("nav-item") && el.dataset.view === S.view);
      if (el.tagName === "BUTTON") el.classList.toggle("on", el.dataset.view === S.view);
    });
    const c = $("#nav-count");
    if (c) c.textContent = S.posts.length || "";
  }

  function showView(view) {
    S.view = view;
    markNav();
    const main = $("#main");
    if (!main) return;
    main.scrollTop = 0;
    if (view === "list") renderList();
    else if (view === "edit") renderEditor();
    else if (view === "settings") renderSettings();
  }

  // ---------------- 列表 ----------------
  async function loadPosts() {
    const data = await api("/api/posts");
    S.posts = data.posts || [];
    markNav();
  }

  function filtered() {
    const q = S.query.trim().toLowerCase();
    return S.posts.filter((p) => {
      if (S.filter === "live" && p.draft) return false;
      if (S.filter === "draft" && !p.draft) return false;
      if (!q) return true;
      const hay = [p.title, p.description, p.category].concat(p.tags || []).join(" ").toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function renderList() {
    const main = $("#main");
    const drafts = S.posts.filter((p) => p.draft).length;
    const tokenWarn = !S.me.token_set;
    const writeWarn = S.me.token_set && S.me.token_write === false;

    main.innerHTML =
      '<div class="topbar"><h2>文章</h2>' +
      '<span class="topbar-hint">' + S.posts.length + " 篇 · " + drafts + " 篇草稿</span>" +
      '<span class="spacer"></span>' +
      '<button class="btn primary" id="btn-new">' + ICON.plus + "写新的</button></div>" +
      '<div class="content">' +
      (tokenWarn
        ? '<div class="notice"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01" stroke-linecap="round"/></svg>' +
          '<span>还没有配置 GitHub 令牌，保存文章会失败。</span><span class="spacer"></span>' +
          '<button class="btn sm" data-view="settings">去配置</button></div>'
        : writeWarn
        ? '<div class="notice"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01" stroke-linecap="round"/></svg>' +
          '<span>令牌缺 Contents 写权限，保存会失败。</span><span class="spacer"></span>' +
          '<button class="btn sm" data-view="settings">去设置</button></div>'
        : "") +
      '<div class="list-tools">' +
      '<div class="search">' + ICON.search +
      '<input id="search" placeholder="搜索标题、摘要、标签…" value="' + esc(S.query) + '"></div>' +
      '<div class="tabs">' +
      '<button data-filter="all" class="' + (S.filter === "all" ? "on" : "") + '">全部</button>' +
      '<button data-filter="live" class="' + (S.filter === "live" ? "on" : "") + '">已发布</button>' +
      '<button data-filter="draft" class="' + (S.filter === "draft" ? "on" : "") + '">草稿</button>' +
      "</div></div>" +
      '<div class="table" id="table">' + tableHtml() + "</div>" +
      '<div class="list-foot"><span id="deploy-info"></span>' +
      '<button class="btn ghost sm" id="refresh">刷新</button></div>' +
      "</div>";

    $("#btn-new").addEventListener("click", newPost);

    const input = $("#search");
    input.addEventListener("input", () => {
      S.query = input.value;
      $("#table").innerHTML = tableHtml();
    });

    $$("[data-filter]").forEach((b) =>
      b.addEventListener("click", () => {
        S.filter = b.dataset.filter;
        $$("[data-filter]").forEach((x) => x.classList.toggle("on", x === b));
        $("#table").innerHTML = tableHtml();
      })
    );

    $("#table").addEventListener("click", (e) => {
      const del = e.target.closest("[data-act='del']");
      if (del) {
        e.stopPropagation();
        const name = del.closest(".row").dataset.name;
        const post = S.posts.find((p) => p.name === name);
        confirmDialog("删除这篇文章？", "《" + (post ? post.title : name) + "》会从仓库里删掉，网站上一分钟后消失。这个操作不能撤销。", "删除", true)
          .then(async (ok) => {
            if (!ok) return;
            try {
              await api("/api/post?name=" + encodeURIComponent(name), { method: "DELETE" });
              toast("已删除");
              await loadPosts();
              renderList();
            } catch (ex) {
              toast(ex.message, true);
            }
          });
        return;
      }
      const row = e.target.closest(".row");
      if (row) openPost(row.dataset.name);
    });

    $("#refresh").addEventListener("click", async () => {
      try {
        await loadPosts();
        renderList();
        toast("已刷新");
      } catch (ex) {
        toast(ex.message, true);
      }
    });

    loadDeploy();
  }

  function tableHtml() {
    const list = filtered();
    if (!list.length) {
      const empty = S.posts.length
        ? '<div class="empty"><h3>没有匹配的文章</h3><p>换个关键词试试。</p></div>'
        : '<div class="empty"><h3>还没有文章</h3><p>从这里写下第一篇。</p><button class="btn primary" data-empty-new>写第一篇</button></div>';
      const holder = document.createElement("div");
      holder.innerHTML = empty;
      const btn = holder.querySelector("[data-empty-new]");
      if (btn) btn.addEventListener("click", newPost);
      return holder.innerHTML;
    }
    return (
      '<div class="table-head"><div>标题</div><div>分类 / 标签</div><div>日期</div><div>状态</div><div></div></div>' +
      list
        .map((p) => {
          const tags = (p.tags || []).slice(0, 3);
          const more = (p.tags || []).length - tags.length;
          return (
            '<div class="row" data-name="' + esc(p.name) + '">' +
            '<div><div class="row-title">' + esc(p.title) + "</div>" +
            (p.description ? '<div class="row-desc">' + esc(p.description) + "</div>" : "") +
            "</div>" +
            '<div class="row-meta">' +
            (p.category ? '<span class="chip cat">' + esc(p.category) + "</span>" : "") +
            tags.map((t) => '<span class="chip">' + esc(t) + "</span>").join("") +
            (more > 0 ? '<span class="chip">+' + more + "</span>" : "") +
            "</div>" +
            '<div class="row-date">' + esc((p.published || "").slice(0, 10)) + "</div>" +
            "<div>" + (p.draft
              ? '<span class="badge draft"><span class="dot"></span>草稿</span>'
              : '<span class="badge live"><span class="dot"></span>已发布</span>') + "</div>" +
            '<div class="row-actions">' +
            '<button class="btn sm" data-act="edit">编辑</button>' +
            '<button class="btn sm danger" data-act="del">删除</button>' +
            "</div></div>"
          );
        })
        .join("")
    );
  }

  async function loadDeploy() {
    try {
      const d = await api("/api/deploy");
      const el = $("#deploy-info");
      if (!el) return;
      if (d.commit) {
        const t = d.time ? new Date(d.time).toLocaleString("zh-CN", { hour12: false }) : "";
        el.textContent = "最近一次提交：" + t + " · " + d.commit;
      } else {
        el.textContent = "";
      }
    } catch (e) {
      /* 忽略 */
    }
  }

  // ---------------- 编辑器 ----------------
  function newPost() {
    S.current = {
      name: null,
      sha: null,
      fm: {
        title: "",
        published: today(),
        description: "",
        image: "",
        tags: [],
        category: "技术",
        draft: true,
        lang: "zh_CN",
      },
      body: "",
    };
    S.slug = "";
    S.isNew = true;
    S.dirty = false;
    showView("edit");
    setTimeout(() => {
      const t = $(".field.title input");
      if (t) t.focus();
    }, 30);
  }

  async function openPost(name) {
    try {
      const d = await api("/api/post?name=" + encodeURIComponent(name));
      S.current = { name: d.name, sha: d.sha, fm: d.frontmatter, body: d.body };
      if (!Array.isArray(S.current.fm.tags)) S.current.fm.tags = [];
      S.slug = name.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
      S.isNew = false;
      S.dirty = false;
      showView("edit");
    } catch (ex) {
      toast(ex.message, true);
    }
  }

  function setDirty(v) {
    S.dirty = v;
    const el = $("#save-state");
    if (!el) return;
    el.className = "save-state " + (v ? "dirty" : "");
    el.innerHTML = '<span class="dot"></span>' + (v ? "有未保存的修改" : "已保存");
  }

  function renderEditor() {
    const c = S.current;
    if (!c) return renderList();
    const fm = c.fm;
    const main = $("#main");
    main.innerHTML =
      '<div class="topbar">' +
      '<button class="btn ghost sm" id="back">' + ICON.back + "文章</button>" +
      "<h2>" + (S.isNew ? "写新的" : "编辑") + "</h2>" +
      '<span class="spacer"></span>' +
      '<span class="save-state" id="save-state"><span class="dot"></span>已保存</span>' +
      '<button class="btn" id="save-draft">保存草稿</button>' +
      '<button class="btn primary" id="publish">' + (fm.draft ? "发布" : "更新发布") + "</button>" +
      "</div>" +
      '<div class="content"><div class="editor">' +
      '<div class="fields">' +
      '<div class="field title"><label>标题</label>' +
      '<input type="text" id="f-title" placeholder="给这篇文章起个名字" value="' + esc(fm.title) + '"></div>' +
      '<div class="field"><label>摘要 <span class="hint">列表里显示的一句话</span></label>' +
      '<textarea id="f-desc" rows="3" placeholder="用一两句话说说写了什么">' + esc(fm.description) + "</textarea></div>" +
      '<div class="field"><label>链接 <span class="hint">' +
      (S.isNew ? "英文，决定文章网址" : "文章已创建，网址固定") + "</span></label>" +
      '<input type="text" id="f-slug" value="' + esc(S.slug) + '" placeholder="例如 aosp-ccache"' +
      (S.isNew ? "" : " disabled") + ">" +
      '<div class="url-hint" id="slug-hint"></div></div>' +
      '<div class="field"><label>封面 <span class="hint">16:9 最好看</span></label>' +
      '<div class="cover" id="cover">' + coverInner(fm.image) + "</div>" +
      '<input type="file" id="cover-file" accept="image/*" hidden></div>' +
      '<div class="field"><label>发布日期</label>' +
      '<input type="date" id="f-date" value="' + esc((fm.published || "").slice(0, 10)) + '"></div>' +
      '<div class="field"><label>分类</label>' +
      '<input type="text" id="f-cat" value="' + esc(fm.category) + '" placeholder="技术 / 生活 / 随笔"></div>' +
      '<div class="field"><label>标签 <span class="hint">回车添加</span></label>' +
      '<div class="tags-box" id="tags-box">' +
      (fm.tags || []).map((t, i) =>
        '<span class="tag">' + esc(t) + '<button data-tag="' + i + '" aria-label="移除">×</button></span>'
      ).join("") +
      '<input id="tag-input" placeholder="' + ((fm.tags || []).length ? "" : "加个标签…") + '"></div></div>' +
      '<div class="field"><label>状态</label>' +
      "<div>" + (fm.draft
        ? '<span class="badge draft"><span class="dot"></span>草稿 · 只有你自己能看</span>'
        : '<span class="badge live"><span class="dot"></span>已发布 · 访客可见</span>') + "</div></div>" +
      "</div>" +
      '<div class="editor-main" data-mode="edit">' +
      '<div class="editor-tabs">' +
      '<button class="tab on" data-mode="edit">编辑</button>' +
      '<button class="tab" data-mode="preview">预览</button>' +
      '<span class="spacer"></span>' +
      '<span class="stats" id="stats"></span></div>' +
      '<div class="editor-body">' +
      '<textarea class="md-input" id="f-body" placeholder="在这里用 Markdown 写正文…&#10;&#10;支持 # 标题、**加粗**、- 列表、```代码块```，也可以直接把图片拖进来。">' +
      esc(c.body) + "</textarea>" +
      '<div class="md-preview" id="preview"></div>' +
      "</div></div>" +
      "</div></div>";

    bindEditor();
    updateStats();
  }

  function coverInner(image) {
    if (!image) {
      return '<div class="cover-empty" id="cover-drop"><b>点击选择封面</b>或把图片拖到这里</div>';
    }
    return (
      '<img class="cover-img" id="cover-drop" src="' + esc(image) + '" alt="封面">' +
      '<div class="cover-actions"><button class="btn" data-cover="remove">移除</button></div>'
    );
  }

  function bindEditor() {
    const c = S.current;
    const fm = c.fm;

    $("#back").addEventListener("click", () => {
      if (S.dirty) {
        confirmDialog("还有未保存的修改", "现在离开会丢掉刚才写的内容。", "放弃修改", true)
          .then((ok) => ok && goList());
      } else goList();
    });

    const title = $("#f-title");
    title.addEventListener("input", () => {
      fm.title = title.value;
      setDirty(true);
    });

    $("#f-desc").addEventListener("input", (e) => {
      fm.description = e.target.value;
      setDirty(true);
    });
    $("#f-date").addEventListener("change", (e) => {
      fm.published = e.target.value;
      setDirty(true);
    });
    $("#f-cat").addEventListener("input", (e) => {
      fm.category = e.target.value;
      setDirty(true);
    });

    // 链接别名
    const slugInput = $("#f-slug");
    const slugHint = () => {
      const date = ($("#f-date").value || today()).slice(0, 10);
      if (!S.isNew) {
        $("#slug-hint").textContent = "/posts/" + S.current.name.replace(/\.md$/, "") + "/";
        return;
      }
      const raw = slugInput.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      $("#slug-hint").textContent = raw
        ? "/posts/" + date + "-" + raw + "/"
        : "留空的话自动生成一个，建议填英文";
    };
    slugHint();
    slugInput.addEventListener("input", () => {
      S.slug = slugInput.value;
      slugHint();
      setDirty(true);
    });
    $("#f-date").addEventListener("change", slugHint);

    // 标签
    const tagInput = $("#tag-input");
    const commitTag = () => {
      const v = tagInput.value.trim().replace(/[,，]$/, "");
      if (!v) return;
      if (!fm.tags.includes(v)) {
        fm.tags.push(v);
        rerenderTags();
        setDirty(true);
      }
      tagInput.value = "";
    };
    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "," || e.key === "，") {
        e.preventDefault();
        commitTag();
      } else if (e.key === "Backspace" && !tagInput.value && fm.tags.length) {
        fm.tags.pop();
        rerenderTags();
        setDirty(true);
      }
    });
    tagInput.addEventListener("blur", commitTag);
    $("#tags-box").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tag]");
      if (b) {
        fm.tags.splice(Number(b.dataset.tag), 1);
        rerenderTags();
        setDirty(true);
      } else if (e.target.id === "tags-box") {
        tagInput.focus();
      }
    });

    // 正文
    const body = $("#f-body");
    body.addEventListener("input", () => {
      c.body = body.value;
      setDirty(true);
      updateStats();
    });
    body.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const s = body.selectionStart;
        body.value = body.value.slice(0, s) + "  " + body.value.slice(body.selectionEnd);
        body.selectionStart = body.selectionEnd = s + 2;
        c.body = body.value;
        setDirty(true);
      }
    });
    body.addEventListener("paste", () => setTimeout(updateStats, 0));
    body.addEventListener("drop", handleBodyDrop);

    // 编辑 / 预览
    $$(".editor-tabs .tab").forEach((t) =>
      t.addEventListener("click", () => {
        const mode = t.dataset.mode;
        $(".editor-main").dataset.mode = mode;
        $$(".editor-tabs .tab").forEach((x) => x.classList.toggle("on", x === t));
        if (mode === "preview") {
          $("#preview").innerHTML = marked.parse(c.body || "_还没有内容_");
        }
      })
    );

    // 封面
    const cover = $("#cover");
    const file = $("#cover-file");
    cover.addEventListener("click", (e) => {
      if (e.target.closest("[data-cover='remove']")) {
        fm.image = "";
        cover.innerHTML = coverInner("");
        setDirty(true);
        return;
      }
      file.click();
    });
    file.addEventListener("change", () => {
      if (file.files[0]) uploadImage(file.files[0], (url) => {
        fm.image = url;
        cover.innerHTML = coverInner(url);
        setDirty(true);
      });
      file.value = "";
    });
    ["dragenter", "dragover"].forEach((ev) =>
      cover.addEventListener(ev, (e) => {
        e.preventDefault();
        cover.classList.add("drag");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      cover.addEventListener(ev, (e) => {
        e.preventDefault();
        cover.classList.remove("drag");
      })
    );
    cover.addEventListener("drop", (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) uploadImage(f, (url) => {
        fm.image = url;
        cover.innerHTML = coverInner(url);
        setDirty(true);
      });
    });

    // 保存
    $("#save-draft").addEventListener("click", () => save(false));
    $("#publish").addEventListener("click", () => save(true));

    document.onkeydown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save(false);
      }
    };
  }

  function rerenderTags() {
    const fm = S.current.fm;
    const box = $("#tags-box");
    const input = $("#tag-input");
    const val = input.value;
    box.innerHTML =
      fm.tags
        .map((t, i) => '<span class="tag">' + esc(t) + '<button data-tag="' + i + '" aria-label="移除">×</button></span>')
        .join("") +
      '<input id="tag-input" placeholder="' + (fm.tags.length ? "" : "加个标签…") + '">';
    const ni = $("#tag-input");
    ni.value = val;
    ni.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "," || e.key === "，") {
        e.preventDefault();
        const v = ni.value.trim().replace(/[,，]$/, "");
        if (v && !fm.tags.includes(v)) {
          fm.tags.push(v);
          rerenderTags();
          setDirty(true);
        }
        ni.value = "";
      } else if (e.key === "Backspace" && !ni.value && fm.tags.length) {
        fm.tags.pop();
        rerenderTags();
        setDirty(true);
      }
    });
    ni.addEventListener("blur", () => {
      const v = ni.value.trim();
      if (v && !fm.tags.includes(v)) {
        fm.tags.push(v);
        rerenderTags();
        setDirty(true);
      }
    });
    ni.focus();
  }

  function updateStats() {
    const el = $("#stats");
    if (!el) return;
    const text = (S.current.body || "").replace(/\s/g, "");
    el.textContent = text.length + " 字";
  }

  function handleBodyDrop(e) {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !/^image\//.test(f.type)) return;
    e.preventDefault();
    uploadImage(f, (url) => {
      const body = $("#f-body");
      const pos = body.selectionStart;
      const ins = "![" + (f.name || "图片") + "](" + url + ")\n";
      body.value = body.value.slice(0, pos) + ins + body.value.slice(body.selectionEnd);
      body.selectionStart = body.selectionEnd = pos + ins.length;
      S.current.body = body.value;
      setDirty(true);
      updateStats();
    });
  }

  function uploadImage(file, done) {
    if (file.size > 6 * 1024 * 1024) return toast("图片太大了，6MB 以内", true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        toast("正在上传图片…");
        const r = await api("/api/upload", {
          method: "POST",
          body: { filename: file.name || "image.jpg", data: reader.result },
        });
        toast("图片已上传");
        done(r.url);
      } catch (ex) {
        toast(ex.message, true);
      }
    };
    reader.readAsDataURL(file);
  }

  async function save(publish) {
    const c = S.current;
    if (!c || S.saving) return;
    if (!c.fm.title.trim()) {
      toast("先给文章起个标题", true);
      $("#f-title").focus();
      return;
    }
    if (!c.fm.published) c.fm.published = today();

    const wasDraft = !!c.fm.draft;
    if (publish) {
      const ok = await confirmDialog(
        wasDraft ? "发布这篇文章？" : "更新已发布的文章？",
        "内容会提交到 GitHub，大约 1～2 分钟后网站上就能看到。",
        wasDraft ? "发布" : "更新"
      );
      if (!ok) return;
    }
    c.fm.draft = !publish;

    S.saving = true;
    const state = $("#save-state");
    if (state) {
      state.className = "save-state saving";
      state.innerHTML = '<span class="dot"></span>正在提交…';
    }
    const btns = [$("#save-draft"), $("#publish")];
    btns.forEach((b) => b && (b.disabled = true));

    try {
      let res;
      if (S.isNew || !c.name) {
        res = await api("/api/post", {
          method: "POST",
          body: { frontmatter: c.fm, body: c.body, slug: S.slug },
        });
        c.name = res.name;
        S.slug = res.name.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
        S.isNew = false;
        const fresh = await api("/api/post?name=" + encodeURIComponent(c.name));
        c.sha = fresh.sha;
        // 创建后表单变成"已存在"状态
        renderEditor();
        setDirty(false);
      } else {
        res = await api("/api/post", {
          method: "PUT",
          body: { name: c.name, sha: c.sha, frontmatter: c.fm, body: c.body },
        });
        c.sha = res.sha || c.sha;
      }
      setDirty(false);
      const p = $("#publish");
      if (p) p.textContent = c.fm.draft ? "发布" : "更新发布";
      toast(publish ? "已发布，稍等一分钟上线" : "草稿已保存");
      await loadPosts();
      if (S.view === "edit") markNav();
    } catch (ex) {
      toast(ex.message, true);
      setDirty(true);
    } finally {
      S.saving = false;
      btns.forEach((b) => b && (b.disabled = false));
      if (S.dirty) setDirty(true);
    }
  }

  function goList() {
    S.dirty = false;
    S.current = null;
    document.onkeydown = null;
    showView("list");
  }

  // ---------------- 设置 ----------------
  async function renderSettings() {
    const main = $("#main");
    main.innerHTML =
      '<div class="topbar"><h2>站点设置</h2><span class="spacer"></span>' +
      '<span class="topbar-hint">保存后约 1～2 分钟生效</span></div>' +
      '<div class="content"><div id="settings-body"><div class="empty">读取中…</div></div></div>';

    let data = null;
    try {
      data = await api("/api/settings");
    } catch (ex) {
      if (!/令牌/.test(ex.message)) {
        $("#settings-body").innerHTML = '<div class="empty"><h3>读取失败</h3><p>' + esc(ex.message) + "</p></div>";
        return;
      }
    }
    const s = (data && data.settings) || {};

    $("#settings-body").innerHTML =
      (data ?
      '<div class="settings-card"><h3>基本信息</h3>' +
      '<p class="sub">这些会显示在网站标题、侧边栏和关于链接里。</p>' +
      '<div class="settings-grid">' +
      field("网站标题", "s-title", s.title || "") +
      field("副标题", "s-subtitle", s.subtitle || "") +
      field("作者名", "s-author", s.authorName || "") +
      '<div class="field"><label>简介</label><textarea id="s-bio" rows="3">' + esc(s.authorBio || "") + "</textarea></div>" +
      field("头像地址", "s-avatar", s.avatar || "", "/images/avatar.jpg") +
      field("GitHub", "s-github", s.github || "", "https://github.com/...") +
      field("邮箱", "s-email", s.email || "", "you@example.com") +
      "</div>" +
      '<div class="settings-actions"><button class="btn primary" id="save-settings">保存设置</button></div></div>'
      : '<div class="settings-card"><h3>先填一个 GitHub 令牌</h3>' +
        '<p class="sub">后台通过 GitHub 接口读写文章，需要你授权一次。填好之后这个页面就能正常读取站点信息了。</p></div>') +
      '<div class="settings-card" style="margin-top:20px"><h3>GitHub 令牌</h3>' +
      '<p class="sub">' +
      (S.me.token_set
        ? (S.me.token_write === false
            ? "令牌已填，但缺 Contents 写权限，现在保存会失败。去 GitHub 编辑这个令牌，权限改成 Read and write 再回来粘贴一次。"
            : "已配置，写入正常。更换的话，粘贴新的令牌即可。")
        : "还没有配置。保存文章需要它。") +
      "</p>" +
      '<div class="field"><label>Fine-grained token <span class="hint">只需要这一个仓库的 Contents 读写</span></label>' +
      '<input type="password" id="gh-token" placeholder="github_pat_…" autocomplete="off"></div>' +
      '<div class="settings-actions"><button class="btn" id="save-token">保存令牌</button>' +
      '<a class="btn ghost" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">去创建一个</a></div>' +
      '<p class="sub" style="margin:16px 0 0">仓库：<code>' + esc(S.me.repo) + "</code> · 分支：<code>" + esc(S.me.branch) + "</code></p>" +
      "</div>";

    const saveBtn = $("#save-settings");
    if (saveBtn) saveBtn.addEventListener("click", async () => {
      const next = {
        title: $("#s-title").value,
        subtitle: $("#s-subtitle").value,
        authorName: $("#s-author").value,
        authorBio: $("#s-bio").value,
        avatar: $("#s-avatar").value,
        github: $("#s-github").value,
        email: $("#s-email").value,
      };
      try {
        toast("正在保存…");
        await api("/api/settings", { method: "PUT", body: { settings: next } });
        toast("设置已保存");
      } catch (ex) {
        toast(ex.message, true);
      }
    });

    $("#save-token").addEventListener("click", async () => {
      const t = $("#gh-token").value.trim();
      if (!t) return toast("先粘贴令牌", true);
      try {
        toast("正在验证…");
        await api("/api/token", { method: "POST", body: { token: t } });
        S.me.token_set = true;
        $("#gh-token").value = "";
        toast("令牌已保存");
        await loadPosts();
        goList();
      } catch (ex) {
        toast(ex.message, true);
      }
    });
  }

  function field(label, id, value, placeholder) {
    return (
      '<div class="field"><label for="' + id + '">' + esc(label) + "</label>" +
      '<input type="text" id="' + id + '" value="' + esc(value) + '" placeholder="' + esc(placeholder || "") + '"></div>'
    );
  }

  // ---------------- 启动 ----------------
  async function boot() {
    try {
      const me = await api("/api/me", { noReload: true });
      S.me = me;
      if (!me.authed) return renderLogin();
      let needsToken = false;
      try {
        await loadPosts();
      } catch (ex) {
        if (!/令牌/.test(ex.message)) throw ex;
        needsToken = true;
      }
      renderShell();
      if (needsToken) {
        S.view = "settings";
        markNav();
        renderSettings();
        toast("先在上面填一个 GitHub 令牌，后台才能读写文章", true);
      }
    } catch (ex) {
      app.innerHTML = '<div class="login-wrap"><div class="login-card"><h1>连不上后台</h1><p>' + esc(ex.message) + "</p></div></div>";
    }
  }

  window.addEventListener("beforeunload", (e) => {
    if (S.dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  boot();
})();
