// app.js - Model Prices Controller with Master Mode Switch, Scope, Time-of-Use Peak/Off-Peak Pricing & Full i18n
(async () => {
  const $ = (id) => document.getElementById(id);
  const MM = globalThis.MagpieMyModels;
  const { t, setLocale, onLocaleChange, getLocale } = window.I18N_MODULE || {
    t: (k) => k,
    setLocale: () => {},
    onLocaleChange: () => {},
    getLocale: () => "zh"
  };

  let toastTimer = null;
  function showToast(msg) {
    const tEl = $("toast");
    if (!tEl) return;
    tEl.textContent = msg;
    tEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      tEl.hidden = true;
    }, 2500);
  }

  // Load models data and options (bundled snapshot first; host may overwrite via models-live.js)
  let rawModels = window.__MAGPIE_MODELS_DATA__ || [];
  let pluginOptions = {};
  let customPrices = {};
  let globalMode = "all-equivalent"; // "all-equivalent" or "api-only"
  let filter = "all";
  let search = "";
  let editingModel = null;
  let selectedScope = "specific";

  function loadPageScript(src) {
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => { s.remove(); resolve(true); };
      s.onerror = () => { s.remove(); resolve(false); };
      document.head.appendChild(s);
    });
  }

  // The page cannot scan Magpie's cache itself (CSP connect-src none).
  // The host hook writes page/models-live.js; refresh reloads that file.
  async function reloadModelsSnapshot() {
    const ok = await loadPageScript("models-live.js?t=" + Date.now());
    if (!ok) return { live: false, count: rawModels.length };
    rawModels = window.__MAGPIE_MODELS_DATA__ || [];
    return {
      live: !!window.__MAGPIE_MODELS_DATA_LIVE__,
      count: rawModels.length,
      at: window.__MAGPIE_MODELS_DATA_AT__ || ""
    };
  }

  // ---- My Models state -------------------------------------------------
  const mm = {
    view: "mine",
    providers: null,          // [{id, name}] from providers:list, null when unavailable
    basis: "snapshot",        // "bridge" | "snapshot"
    rows: [],
    favorites: new Set(),
    query: "",
    providerQuery: "",
    loading: false,
    notice: "",
    missingProviders: [],
    staleFavorites: [],
    prefs: {
      providers: null,        // null = all configured; [] = none selected
      onlyFavorites: false,
      hideUnpriced: false,
      group: false,
      sort: { key: "provider", dir: "asc" }
    }
  };
  let mmPersistTimer = null;

  function loadMyModelPrefs() {
    const saved = pluginOptions.myModels || {};
    mm.favorites = new Set(Array.isArray(saved.favorites) ? saved.favorites : []);
    mm.prefs.providers = Array.isArray(saved.providers) ? saved.providers : null;
    mm.prefs.onlyFavorites = !!saved.onlyFavorites;
    mm.prefs.hideUnpriced = !!saved.hideUnpriced;
    mm.prefs.group = !!saved.group;
    if (saved.sort && typeof saved.sort.key === "string") {
      mm.prefs.sort = {
        key: ["provider", "model", "input", "output", "cache_read", "source"].includes(saved.sort.key)
          ? saved.sort.key : "provider",
        dir: saved.sort.dir === "desc" ? "desc" : "asc"
      };
    }
  }

  // 1. 初始化 Magpie 宿主通信规范 (Host PostMessage Handshake & Theme/Locale Sync)
  function initMagpieHostSync() {
    let callId = 1;
    const pendingCalls = new Map();

    window.addEventListener("message", (ev) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object" || msg.magpie !== 1) return;

      if (msg.id && pendingCalls.has(msg.id)) {
        const { resolve, reject } = pendingCalls.get(msg.id);
        pendingCalls.delete(msg.id);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.result);
        return;
      }

      if (msg.event === "theme" && msg.data) {
        applyHostTheme(msg.data);
      }
    });

    function callHost(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = "call-" + callId++;
        pendingCalls.set(id, { resolve, reject });
        window.parent.postMessage({ magpie: 1, id, method, params }, "*");
        setTimeout(() => {
          if (pendingCalls.has(id)) {
            pendingCalls.delete(id);
            reject(new Error("Host call timed out: " + method));
          }
        }, 3000);
      });
    }

    function applyHostTheme(data) {
      if (!data) return;
      const root = document.documentElement;
      if (data.dark !== undefined) {
        root.dataset.theme = data.dark ? "dark" : "light";
      }
      if (data.tokens) {
        for (const [k, v] of Object.entries(data.tokens)) {
          if (v) root.style.setProperty("--" + k, v);
        }
      }
      if (data.lang) {
        setLocale(data.lang);
      }
    }

    callHost("hello")
      .then((res) => {
        if (res) applyHostTheme(res);
      })
      .catch(() => {});
  }

  // 2. 初始化 Magpie bridge (如果存在)
  if (globalThis.magpie) {
    try {
      const theme = await magpie.ready;
      if (theme && theme.lang) {
        setLocale(theme.lang);
      }
      if (theme && theme.dark !== undefined) {
        document.documentElement.dataset.theme = theme.dark ? "dark" : "light";
      }
      magpie.onTheme?.((tTheme) => {
        if (tTheme.dark !== undefined) {
          document.documentElement.dataset.theme = tTheme.dark ? "dark" : "light";
        }
        if (tTheme.lang) {
          setLocale(tTheme.lang);
        }
      });
      pluginOptions = (await magpie.options.get()) || {};
      customPrices = pluginOptions.customPrices || {};
      globalMode = pluginOptions.mode || "all-equivalent";
    } catch (e) {
      console.warn("Magpie bridge ready warning:", e);
    }
  }

  initMagpieHostSync();

  function getBareModel(fullName) {
    return fullName.includes("/") ? fullName.split("/")[1] : fullName;
  }

  // 3. 峰谷分时时段计算 (Time-of-Use & DeepSeek Official Schedule)
  function getBeijingTime(date = new Date()) {
    const utc = date.getTime() + date.getTimezoneOffset() * 60000;
    return new Date(utc + 3600000 * 8);
  }

  function checkOffPeakStatus(date = new Date()) {
    const bj = getBeijingTime(date);
    const day = bj.getDay(); // 0 是周日, 6 是周六
    const hour = bj.getHours();
    const min = bj.getMinutes();
    const t = hour + min / 60;
    const timeStr = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

    // 周末全天均为低谷闲时 (立享 5 折)
    if (day === 0 || day === 6) {
      return {
        isOffPeak: true,
        discount: 0.5,
        hour,
        min,
        day,
        timeStr,
        reason: "weekend"
      };
    }

    // 工作日：高峰为 09:00-12:00 与 14:00-18:00；其余时段为低谷闲时
    const isPeak = (t >= 9 && t < 12) || (t >= 14 && t < 18);
    return {
      isOffPeak: !isPeak,
      discount: !isPeak ? 0.5 : 1.0,
      hour,
      min,
      day,
      timeStr,
      reason: isPeak ? "workday_peak" : t >= 12 && t < 14 ? "lunch" : "night"
    };
  }

  function updatePeakStatusBar() {
    const status = checkOffPeakStatus();
    const bar = $("peak-status-bar");
    const text = $("peak-text");
    const time = $("peak-time");
    if (!bar || !text) return;

    if (status.isOffPeak) {
      bar.className = "peak-status-bar is-offpeak";
      text.textContent = t("offpeak_badge_live");
    } else {
      bar.className = "peak-status-bar is-peak";
      text.textContent = t("peak_badge_live");
    }
    if (time) {
      time.textContent = `UTC+8 ${status.timeStr}`;
    }
  }

  // 4. 定价计算 (含实时峰谷切换)
  function getModelPrice(item) {
    const currentStatus = checkOffPeakStatus();
    const isSub = item.providerKind === "subscription";

    const specificCustom = customPrices[item.model];
    const bare = getBareModel(item.model);
    const wildcardCustom = customPrices["*/" + bare];
    const custom = specificCustom || wildcardCustom;
    const scope = specificCustom ? "specific" : wildcardCustom ? "wildcard" : null;

    if (globalMode === "api-only" && isSub && !specificCustom) {
      return null;
    }

    // 自定义定价
    if (custom) {
      const hasOffPeak = !!(custom.offpeak?.enabled || item.offPeakPreset?.supported);
      const peakIn = custom.input;
      const peakOut = custom.output;
      const offIn = custom.offpeak?.input ?? +(peakIn * 0.5).toFixed(5);
      const offOut = custom.offpeak?.output ?? +(peakOut * 0.5).toFixed(5);

      const effectiveIn = hasOffPeak && currentStatus.isOffPeak ? offIn : peakIn;
      const effectiveOut = hasOffPeak && currentStatus.isOffPeak ? offOut : peakOut;

      return {
        type: "custom",
        scope,
        input: effectiveIn,
        output: effectiveOut,
        cache_read: custom.cache_read,
        cache_write: custom.cache_write,
        hasOffPeak,
        isOffPeakActive: currentStatus.isOffPeak,
        peakInput: peakIn,
        peakOutput: peakOut,
        offPeakInput: offIn,
        offPeakOutput: offOut
      };
    }

    // 官方匹配公价 (若为 DeepSeek 等模型，自动计算峰谷)
    if (item.matched && item.matched.cost) {
      const c = item.matched.cost;
      const hasOffPeak = !!item.offPeakPreset?.supported;
      const peakIn = c.input;
      const peakOut = c.output;
      const offIn = +(peakIn * 0.5).toFixed(5);
      const offOut = +(peakOut * 0.5).toFixed(5);

      const effectiveIn = hasOffPeak && currentStatus.isOffPeak ? offIn : peakIn;
      const effectiveOut = hasOffPeak && currentStatus.isOffPeak ? offOut : peakOut;

      return {
        type: "matched",
        input: effectiveIn,
        output: effectiveOut,
        cache_read: c.cache_read,
        cache_write: c.cache_write,
        hasOffPeak,
        isOffPeakActive: currentStatus.isOffPeak,
        peakInput: peakIn,
        peakOutput: peakOut,
        offPeakInput: offIn,
        offPeakOutput: offOut
      };
    }

    if (item.currentPrice && !item.isUnpriced) {
      return {
        type: "current",
        text: item.currentPrice
      };
    }
    return null;
  }

  function renderModeUI() {
    const buttons = document.querySelectorAll("[data-mode]");
    buttons.forEach((btn) => {
      if (btn.dataset.mode === globalMode) btn.setAttribute("aria-selected", "true");
      else btn.removeAttribute("aria-selected");
    });
    const descEl = $("mode-desc-text");
    if (descEl) {
      descEl.innerHTML = globalMode === "api-only" ? t("mode_desc_api") : t("mode_desc_all");
    }
  }

  function renderStats() {
    const total = rawModels.length;
    let customCount = 0;
    let pricedCount = 0;
    let unpricedCount = 0;

    for (const m of rawModels) {
      const p = getModelPrice(m);
      if (p) {
        pricedCount++;
        if (p.type === "custom") customCount++;
      } else {
        unpricedCount++;
      }
    }

    $("stat-total").textContent = total;
    $("stat-priced").textContent = pricedCount;
    $("stat-custom").textContent = customCount;
    $("stat-unpriced").textContent = unpricedCount;
  }

  // ---- My Models -------------------------------------------------------

  function configuredProviderIds() {
    return (mm.providers || []).map((p) => p.id);
  }

  function selectedProviderIds() {
    const all = configuredProviderIds();
    if (mm.prefs.providers === null) return all;
    return all.filter((id) => mm.prefs.providers.includes(id));
  }

  function renderProviderList() {
    const box = $("mm-provider-list");
    if (!box) return;
    box.textContent = "";
    const selected = new Set(selectedProviderIds());
    const counts = new Map();
    for (const row of mm.rows) counts.set(row.provider, (counts.get(row.provider) || 0) + 1);

    const q = mm.providerQuery.trim().toLowerCase();
    const list = (mm.providers || []).filter((p) =>
      !q || p.id.toLowerCase().includes(q) || String(p.name || "").toLowerCase().includes(q));

    if (list.length === 0) {
      const empty = document.createElement("span");
      empty.className = "mm-filter-empty";
      empty.textContent = (mm.providers || []).length === 0 ? "Magpie 中还没有已配置的供应商" : "没有匹配的渠道";
      box.append(empty);
      return;
    }

    for (const p of list) {
      const label = document.createElement("label");
      label.className = "mm-provider-option";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = selected.has(p.id);
      input.value = p.id;
      input.addEventListener("change", () => setProviderSelected(p.id, input.checked));

      const name = document.createElement("span");
      name.className = "mm-provider-name";
      name.textContent = p.name || p.id;
      name.title = p.id;

      const count = document.createElement("span");
      count.className = "mm-provider-models";
      count.textContent = String(counts.get(p.id) || 0);

      label.append(input, name, count);
      box.append(label);
    }
  }

  function setProviderSelected(id, selected) {
    const all = configuredProviderIds();
    const current = new Set(selectedProviderIds());
    if (selected) current.add(id); else current.delete(id);
    mm.prefs.providers = all.filter((x) => current.has(x));
    scheduleMmPersist();
    renderMyModels();
  }

  function setAllProviders(selected) {
    mm.prefs.providers = selected ? configuredProviderIds() : [];
    scheduleMmPersist();
    renderMyModels();
    renderProviderList();
  }

  function mmPriceCell(row, key) {
    const td = document.createElement("td");
    td.className = "num mm-price";
    const p = row.price;
    if (!p || p[key] == null) {
      td.textContent = "—";
      td.classList.add("mm-dash");
      return td;
    }
    td.textContent = MM.formatPrice(p[key]);
    if (p.source === MM.SOURCE.REFERENCE) {
      td.classList.add("is-reference");
      td.title = "models.dev 参考价：尚未写入 Magpie 账单";
    }
    return td;
  }

  function mmRow(row, grouped) {
    const tr = document.createElement("tr");
    tr.className = "mm-row";
    if (row.price && (row.price.source === MM.SOURCE.CUSTOM || row.price.source === MM.SOURCE.WILDCARD)) {
      tr.classList.add("is-custom");
    }
    if (row.price && row.price.source === MM.SOURCE.REFERENCE) tr.classList.add("is-reference");
    if (!MM.hasPrice(row)) tr.classList.add("is-unknown");

    const provider = document.createElement("td");
    provider.className = "mm-provider-cell";
    const pName = document.createElement("div");
    pName.className = "mm-provider-name-main";
    pName.textContent = row.providerName;
    pName.title = row.provider;
    provider.append(pName);
    if (row.providerKind === "subscription") {
      const kind = document.createElement("span");
      kind.className = "mm-kind";
      kind.textContent = "订阅/账号";
      provider.append(kind);
    }

    const model = document.createElement("td");
    model.className = "mm-model-cell";

    const fav = document.createElement("button");
    fav.type = "button";
    fav.className = "star-btn";
    const isFav = mm.favorites.has(row.key);
    fav.textContent = isFav ? "★" : "☆";
    fav.setAttribute("aria-pressed", isFav ? "true" : "false");
    fav.setAttribute("aria-label", (isFav ? "取消收藏 " : "收藏 ") + row.model);
    fav.title = isFav ? "取消收藏" : "收藏（仅本面板，不影响 Magpie 路由）";
    fav.addEventListener("click", () => toggleFavorite(row.key));

    const modelText = document.createElement("div");
    modelText.className = "mm-model-text";
    const modelName = document.createElement("div");
    modelName.className = "mm-model-name";
    modelName.textContent = grouped ? row.name : row.model;
    modelName.title = row.model;
    const modelId = document.createElement("div");
    modelId.className = "mm-model-id";
    modelId.textContent = grouped ? row.bare : row.name;
    modelId.title = row.name;
    modelText.append(modelName, modelId);
    model.append(fav, modelText);

    const input = mmPriceCell(row, "input");
    const output = mmPriceCell(row, "output");
    const cacheRead = mmPriceCell(row, "cache_read");
    const cacheWrite = mmPriceCell(row, "cache_write");
    cacheRead.classList.add("mm-col-cache");
    cacheWrite.classList.add("mm-col-cache");

    const source = document.createElement("td");
    source.className = "mm-source-cell mm-col-source";
    const badge = document.createElement("span");
    const src = row.price ? row.price.source : MM.SOURCE.UNKNOWN;
    badge.className = "mm-source mm-source-" + src;
    badge.textContent = MM.sourceLabel(row);
    const refDiffers = row.reference && row.price &&
      (row.reference.input !== row.price.input || row.reference.output !== row.price.output);
    if (refDiffers) {
      const ref = document.createElement("span");
      ref.className = "mm-ref-note";
      ref.textContent = "公价 $" + MM.formatPrice(row.reference.input).slice(1) +
        " / $" + MM.formatPrice(row.reference.output).slice(1);
      ref.title = "models.dev 参考价（未直接计入当前价格）";
      source.append(badge, ref);
    } else {
      source.append(badge);
    }

    const actions = document.createElement("td");
    actions.className = "mm-actions-cell mm-col-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn btn-small";
    edit.textContent = row.applied ? "改价" : "应用公价";
    edit.addEventListener("click", () => openEditModal(row.item));
    actions.append(edit);

    tr.append(provider, model, input, output, cacheRead, cacheWrite, source, actions);
    return tr;
  }

  function renderMyModels() {
    const tbody = $("mm-tbody");
    if (!tbody) return;
    tbody.textContent = "";

    const allIds = configuredProviderIds();
    const selected = selectedProviderIds();

    $("mm-provider-count").textContent = selected.length === allIds.length
      ? String(allIds.length)
      : selected.length + "/" + allIds.length;
    $("mm-provider-btn").setAttribute("aria-expanded", $("mm-filter-panel").hidden ? "false" : "true");

    if (mm.loading) {
      $("mm-table-wrap").hidden = true;
      $("mm-empty").hidden = true;
      $("mm-summary").textContent = "正在读取 Magpie 配置…";
      return;
    }

    const favVisible = mm.rows.filter((r) => mm.favorites.has(r.key)).length;
    $("mm-fav-count").textContent = String(favVisible);
    $("mm-fav-btn").setAttribute("aria-pressed", mm.prefs.onlyFavorites ? "true" : "false");
    $("mm-hide-unpriced").setAttribute("aria-pressed", mm.prefs.hideUnpriced ? "true" : "false");
    $("mm-group-btn").setAttribute("aria-pressed", mm.prefs.group ? "true" : "false");
    $("mm-group-btn").disabled = !mm.prefs.group && MM.groupByModel(mm.rows).every((g) => !g.comparable);

    const rows = MM.filterRows(mm.rows, {
      providers: selected,
      favorites: mm.favorites,
      onlyFavorites: mm.prefs.onlyFavorites,
      hideUnpriced: mm.prefs.hideUnpriced,
      query: mm.query
    });
    const sorted = MM.sortRows(rows, mm.prefs.sort);

    document.querySelectorAll("#mm-table thead th[data-sort]").forEach((th) => {
      th.removeAttribute("aria-sort");
      if (th.dataset.sort === mm.prefs.sort.key) {
        th.setAttribute("aria-sort", mm.prefs.sort.dir === "desc" ? "descending" : "ascending");
      }
    });

    if (mm.prefs.group) {
      const groups = MM.groupByModel(sorted);
      for (const group of groups) {
        const tr = document.createElement("tr");
        tr.className = "mm-group-row";
        const td = document.createElement("td");
        td.colSpan = 8;
        const label = document.createElement("span");
        label.className = "mm-group-name";
        label.textContent = group.bare;
        const meta = document.createElement("span");
        meta.className = "mm-group-meta";
        meta.textContent = group.comparable
          ? "跨 " + group.providerCount + " 个渠道 · 可直接比较"
          : "仅 1 个渠道";
        td.append(label, meta);
        tr.append(td);
        tbody.append(tr);
        for (const row of group.rows) tbody.append(mmRow(row, true));
      }
    } else {
      for (const row of sorted) tbody.append(mmRow(row, false));
    }

    const empty = rows.length === 0;
    $("mm-table-wrap").hidden = empty;
    $("mm-empty").hidden = !empty;

    const priced = rows.filter((r) => MM.hasPrice(r)).length;
    $("mm-summary").textContent = rows.length + " 个模型 · " +
      selected.length + "/" + allIds.length + " 个渠道 · " +
      priced + " 个有明确价格 · USD / 1M tokens";

    const snapshotAt = window.__MAGPIE_MODELS_DATA_AT__;
    $("mm-snapshot").textContent = snapshotAt
      ? "模型快照 " + String(snapshotAt).slice(0, 10)
      : "模型快照时间未知";
    $("mm-basis").textContent = mm.basis === "bridge"
      ? "Magpie 已配置渠道 × 本地模型快照"
      : "本地模型快照（未连接 Magpie）";

    const notes = [];
    if (mm.basis !== "bridge") {
      notes.push("未能读取 Magpie 的渠道列表，当前按本地快照中的全部渠道展示。");
    }
    if (allIds.length === 0) notes.push("Magpie 中还没有已配置的供应商。");
    if (mm.missingProviders.length > 0) {
      const names = mm.missingProviders.slice(0, 3).map((p) => p.name || p.id);
      notes.push(mm.missingProviders.length + " 个已配置渠道不在本地模型快照中：" +
        names.join("、") + (mm.missingProviders.length > 3 ? " 等" : "") +
        "。宿主会自动扫描本机 Magpie 模型缓存；点「↻ 刷新配置」即可加载最新快照。");
    }
    if (mm.staleFavorites.length > 0) {
      notes.push(mm.staleFavorites.length + " 个收藏不在当前模型快照中，已保留，不会影响其他模型。");
    }
    if (mm.notice) notes.push(mm.notice);
    $("mm-notice").hidden = notes.length === 0;
    $("mm-notice").textContent = notes.join(" ");

    renderProviderList();
  }

  async function loadMyModels() {
    mm.loading = true;
    mm.notice = "";
    renderMyModels();

    let providers = null;
    let readError = null;
    if (globalThis.magpie && typeof magpie.read === "function") {
      try {
        providers = await magpie.read("providers:list");
      } catch (e) {
        readError = e;
      }
    }

    mm.basis = Array.isArray(providers) ? "bridge" : "snapshot";
    if (Array.isArray(providers)) {
      mm.providers = providers.map((p) => ({ id: String(p.id), name: p.name || String(p.id) }));
    } else {
      const ids = [];
      for (const m of rawModels) {
        if (m.provider && !ids.includes(m.provider)) ids.push(m.provider);
      }
      mm.providers = ids.map((id) => {
        const found = rawModels.find((m) => m.provider === id);
        return { id, name: (found && found.providerName) || id };
      });
    }

    const ids = configuredProviderIds();
    if (mm.prefs.providers !== null) {
      mm.prefs.providers = MM.reconcileProviders(ids, mm.prefs.providers);
    }
    mm.rows = MM.buildRows(rawModels, {
      providers: mm.providers,
      customPrices,
      mode: globalMode
    });
    mm.missingProviders = mm.providers.filter((p) => !mm.rows.some((r) => r.provider === p.id));
    const known = new Set(rawModels.map((m) => m.model));
    mm.staleFavorites = [...mm.favorites].filter((k) => !known.has(k));
    if (readError) mm.notice = "读取 Magpie 渠道失败：" + (readError.message || readError) + "。已回退到快照。";
    mm.loading = false;
    renderMyModels();
  }

  function toggleFavorite(key) {
    if (mm.favorites.has(key)) mm.favorites.delete(key);
    else mm.favorites.add(key);
    scheduleMmPersist();
    renderMyModels();
  }

  function mmPrefsPayload() {
    return {
      providers: mm.prefs.providers,
      favorites: [...mm.favorites],
      onlyFavorites: mm.prefs.onlyFavorites,
      hideUnpriced: mm.prefs.hideUnpriced,
      group: mm.prefs.group,
      sort: mm.prefs.sort
    };
  }

  function scheduleMmPersist() {
    clearTimeout(mmPersistTimer);
    mmPersistTimer = setTimeout(() => { persistOptions(); }, 450);
  }

  function rebuildMyModelRows() {
    mm.rows = MM.buildRows(rawModels, {
      providers: mm.providers,
      customPrices,
      mode: globalMode
    });
  }

  function resetMmFilters() {
    mm.prefs.providers = null;
    mm.prefs.onlyFavorites = false;
    mm.prefs.hideUnpriced = false;
    mm.prefs.group = false;
    mm.prefs.sort = { key: "provider", dir: "asc" };
    mm.query = "";
    mm.providerQuery = "";
    $("mm-search").value = "";
    $("mm-provider-search").value = "";
    scheduleMmPersist();
    renderMyModels();
    renderProviderList();
  }

  function setView(view) {
    mm.view = view === "all" ? "all" : "mine";
    $("view-mine").hidden = mm.view !== "mine";
    $("view-all").hidden = mm.view !== "all";
    $("view-desc").textContent = mm.view === "mine"
      ? "只看你在 Magpie 中配置的渠道与模型，按实际生效价格排列。参考价来自 models.dev。"
      : "基于 models.dev 与 Magpie 账单系统，自动匹配与自定义价格即时生效于每日用量及托盘花费。";
    $("view-tabs").querySelectorAll("button").forEach((b) => {
      if (b.dataset.view === mm.view) b.setAttribute("aria-selected", "true");
      else b.removeAttribute("aria-selected");
    });
  }

  function renderList() {
    let list = rawModels;

    if (filter === "custom") {
      list = list.filter((m) => {
        const p = getModelPrice(m);
        return p && p.type === "custom";
      });
    } else if (filter === "unpriced") {
      list = list.filter((m) => !getModelPrice(m));
    } else if (filter === "matched") {
      list = list.filter((m) => !!m.matched);
    } else if (filter === "offpeak") {
      list = list.filter((m) => {
        const p = getModelPrice(m);
        return (p && p.hasOffPeak) || (m.offPeakPreset && m.offPeakPreset.supported);
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.model.toLowerCase().includes(q) ||
          (m.name && m.name.toLowerCase().includes(q)) ||
          (m.matched && (m.matched.provider + "/" + m.matched.model).toLowerCase().includes(q))
      );
    }

    const listContainer = $("models-list");
    listContainer.innerHTML = "";

    if (list.length === 0) {
      $("empty-hint").hidden = false;
      return;
    }
    $("empty-hint").hidden = true;

    for (const item of list) {
      const li = document.createElement("li");
      li.className = "model-item";

      const topDiv = document.createElement("div");
      topDiv.className = "item-top";

      const isSub = item.providerKind === "subscription";
      const kindBadge = isSub
        ? `<span style="font-size: 10px; color: var(--muted); border: 1px solid var(--line); border-radius: 3px; padding: 0 4px; margin-left: 5px;">${escapeHtml(t("badge_subscription"))}</span>`
        : `<span style="font-size: 10px; color: var(--accent); border: 1px solid var(--accent); border-radius: 3px; padding: 0 4px; margin-left: 5px;">${escapeHtml(t("badge_paid_api"))}</span>`;

      const offPeakTag = item.offPeakPreset?.supported
        ? `<span style="font-size: 10px; color: var(--green); border: 1px solid rgba(48, 209, 88, 0.3); border-radius: 3px; padding: 0 4px; margin-left: 5px;" title="${escapeHtml(item.offPeakPreset.name)}">${escapeHtml(t("badge_offpeak_supported"))}</span>`
        : "";

      const infoDiv = document.createElement("div");
      infoDiv.className = "item-info";
      infoDiv.innerHTML =
        '<div class="m-name">' +
        escapeHtml(item.model) +
        kindBadge +
        offPeakTag +
        "</div>" +
        '<div class="m-sub">' +
        escapeHtml(item.name || "") +
        "</div>";

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "item-actions";

      const btnEdit = document.createElement("button");
      btnEdit.type = "button";
      btnEdit.className = "btn btn-small";
      btnEdit.textContent = t("btn_edit_price");
      btnEdit.addEventListener("click", () => openEditModal(item));
      actionsDiv.append(btnEdit);

      const current = getModelPrice(item);
      const bare = getBareModel(item.model);
      const hasCustom = !!(customPrices[item.model] || customPrices["*/" + bare]);

      if (hasCustom) {
        const btnReset = document.createElement("button");
        btnReset.type = "button";
        btnReset.className = "btn btn-small";
        btnReset.style.color = "var(--red)";
        btnReset.textContent = t("btn_reset");
        btnReset.addEventListener("click", () => resetModelPrice(item.model));
        actionsDiv.append(btnReset);
      }

      topDiv.append(infoDiv, actionsDiv);

      const bottomDiv = document.createElement("div");
      bottomDiv.className = "item-bottom";

      const priceCol = document.createElement("div");
      priceCol.className = "price-col";

      if (current && (current.type === "custom" || current.type === "matched")) {
        const scopeBadge =
          current.type === "custom"
            ? current.scope === "wildcard"
              ? `<span class="badge-tag badge-custom" title="${escapeHtml(t("scope_wildcard_badge_title"))}">${escapeHtml(t("scope_wildcard_badge"))}</span>`
              : `<span class="badge-tag badge-custom" title="${escapeHtml(t("scope_specific_badge_title"))}">${escapeHtml(t("scope_specific_badge"))}</span>`
            : "";

        if (current.hasOffPeak) {
          const peakLabel = t("peak_tag");
          const offpeakLabel = t("offpeak_tag");
          const statusBadge = current.isOffPeakActive
            ? `<span class="badge-tag badge-offpeak" title="当前时段按闲时 5 折计算">$${current.offPeakInput}/$${current.offPeakOutput} (${escapeHtml(t("badge_offpeak_active"))})</span>`
            : `<span class="badge-tag badge-peak" title="当前时段按高峰标准单价计算">$${current.peakInput}/$${current.peakOutput} (${escapeHtml(t("badge_peak_active"))})</span>`;

          priceCol.innerHTML =
            `<span class="rate">${peakLabel} $${current.peakInput}/$${current.peakOutput}</span>` +
            `<span class="rate-offpeak">${offpeakLabel} $${current.offPeakInput}/$${current.offPeakOutput} (50% OFF)</span>` +
            statusBadge +
            scopeBadge +
            `<span class="cache">${escapeHtml(t("cache_label"))} $${current.cache_read}/$${current.cache_write}</span>`;
        } else {
          priceCol.innerHTML =
            '<span class="rate">$' +
            current.input +
            " / $" +
            current.output +
            "</span>" +
            scopeBadge +
            `<span class="badge-tag badge-modelsdev">${escapeHtml(t("badge_active"))}</span>` +
            `<span class="cache">${escapeHtml(t("cache_label"))} $${current.cache_read}/$${current.cache_write}</span>`;
        }
      } else if (current && current.type === "current") {
        priceCol.innerHTML =
          '<span class="rate" style="color: var(--green);">' +
          escapeHtml(current.text) +
          "</span>" +
          `<span class="badge-tag badge-modelsdev">${escapeHtml(t("badge_active"))}</span>`;
      } else {
        if (globalMode === "api-only" && isSub) {
          priceCol.innerHTML = `<span class="badge-tag" style="background: var(--card); color: var(--muted);">${escapeHtml(t("badge_free_tier"))}</span>`;
        } else {
          priceCol.innerHTML = `<span class="badge-tag badge-unpriced">${escapeHtml(t("badge_unpriced"))}</span>`;
        }
      }

      const refCol = document.createElement("div");
      refCol.className = "ref-col";
      if (item.matched) {
        const c = item.matched.cost;
        refCol.innerHTML =
          `<span>${escapeHtml(t("market_ref_prefix"))}</span> ` +
          '<span class="ref-price">$' +
          c.input +
          " / $" +
          c.output +
          "</span>";
      } else {
        refCol.innerHTML = `<span>${escapeHtml(t("no_market_ref"))}</span>`;
      }

      bottomDiv.append(priceCol, refCol);
      li.append(topDiv, bottomDiv);
      listContainer.append(li);
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // 5. 编辑定价弹窗交互
  function openEditModal(item) {
    editingModel = item;
    const bare = getBareModel(item.model);

    $("modal-model-title").textContent = t("modal_title_set", { model: item.model });
    $("modal-model-sub").textContent = item.name
      ? t("modal_sub_official", { name: item.name })
      : t("modal_sub_default");
    $("scope-model-label").textContent = item.model;
    $("scope-wild-label").textContent = bare;

    if (customPrices["*/" + bare] && !customPrices[item.model]) {
      setScope("wildcard");
    } else {
      setScope("specific");
    }

    const current = getModelPrice(item);
    const specificCustom = customPrices[item.model];
    const wildcardCustom = customPrices["*/" + bare];
    const custom = specificCustom || wildcardCustom;

    if (custom) {
      $("input-cost").value = custom.input;
      $("output-cost").value = custom.output;
      $("cache-read-cost").value = custom.cache_read;
      $("cache-write-cost").value = custom.cache_write;

      const hasOffPeak = !!(custom.offpeak?.enabled || item.offPeakPreset?.supported);
      $("offpeak-enabled").checked = hasOffPeak;
      $("offpeak-details").hidden = !hasOffPeak;
      $("offpeak-input-cost").value = custom.offpeak?.input ?? +(custom.input * 0.5).toFixed(5);
      $("offpeak-output-cost").value = custom.offpeak?.output ?? +(custom.output * 0.5).toFixed(5);
    } else if (item.matched) {
      const c = item.matched.cost;
      $("input-cost").value = c.input;
      $("output-cost").value = c.output;
      $("cache-read-cost").value = c.cache_read;
      $("cache-write-cost").value = c.cache_write;

      const hasOffPeak = !!item.offPeakPreset?.supported;
      $("offpeak-enabled").checked = hasOffPeak;
      $("offpeak-details").hidden = !hasOffPeak;
      $("offpeak-input-cost").value = +(c.input * 0.5).toFixed(5);
      $("offpeak-output-cost").value = +(c.output * 0.5).toFixed(5);
    } else if (MM && item.currentPrice) {
      const applied = MM.parseCurrentPrice(item.currentPrice);
      if (applied) {
        $("input-cost").value = applied.input == null ? "" : applied.input;
        $("output-cost").value = applied.output == null ? "" : applied.output;
        $("cache-read-cost").value = applied.cache_read == null ? "" : applied.cache_read;
        $("cache-write-cost").value = applied.cache_write == null ? "" : applied.cache_write;
        $("offpeak-enabled").checked = false;
        $("offpeak-details").hidden = true;
        $("offpeak-input-cost").value = "0";
        $("offpeak-output-cost").value = "0";
      } else {
        $("input-cost").value = "0";
        $("output-cost").value = "0";
        $("cache-read-cost").value = "0";
        $("cache-write-cost").value = "0";
        $("offpeak-enabled").checked = false;
        $("offpeak-details").hidden = true;
        $("offpeak-input-cost").value = "0";
        $("offpeak-output-cost").value = "0";
      }
    } else {
      $("input-cost").value = "0";
      $("output-cost").value = "0";
      $("cache-read-cost").value = "0";
      $("cache-write-cost").value = "0";
      $("offpeak-enabled").checked = false;
      $("offpeak-details").hidden = true;
      $("offpeak-input-cost").value = "0";
      $("offpeak-output-cost").value = "0";
    }

    $("edit-modal").hidden = false;
    $("input-cost").focus();
  }

  function setScope(scope) {
    selectedScope = scope;
    if (scope === "wildcard") {
      $("scope-wildcard").setAttribute("aria-selected", "true");
      $("scope-specific").removeAttribute("aria-selected");
      $("scope-hint").textContent = t("scope_hint_wildcard", {
        model: getBareModel(editingModel?.model || "")
      });
    } else {
      $("scope-specific").setAttribute("aria-selected", "true");
      $("scope-wildcard").removeAttribute("aria-selected");
      $("scope-hint").textContent = t("scope_hint_specific", {
        model: editingModel?.model || ""
      });
    }
  }

  function closeEditModal() {
    $("edit-modal").hidden = true;
    editingModel = null;
  }

  async function saveModelPrice() {
    if (!editingModel) return;
    const bare = getBareModel(editingModel.model);
    const targetKey = selectedScope === "wildcard" ? "*/" + bare : editingModel.model;

    const inVal = parseFloat($("input-cost").value) || 0;
    const outVal = parseFloat($("output-cost").value) || 0;

    const priceObj = {
      input: inVal,
      output: outVal,
      cache_read: parseFloat($("cache-read-cost").value) || 0,
      cache_write: parseFloat($("cache-write-cost").value) || 0
    };

    if ($("offpeak-enabled").checked) {
      priceObj.offpeak = {
        enabled: true,
        rule: "deepseek",
        input: parseFloat($("offpeak-input-cost").value) || +(inVal * 0.5).toFixed(5),
        output: parseFloat($("offpeak-output-cost").value) || +(outVal * 0.5).toFixed(5)
      };
    }

    customPrices[targetKey] = priceObj;

    if (selectedScope === "wildcard" && customPrices[editingModel.model]) {
      delete customPrices[editingModel.model];
    }

    await persistOptions();
    closeEditModal();
    rebuildMyModelRows();
    renderStats();
    renderList();
    renderMyModels();
    showToast(t("toast_rate_saved", { key: targetKey }));
  }

  async function resetModelPrice(model) {
    const bare = getBareModel(model);
    delete customPrices[model];
    delete customPrices["*/" + bare];

    await persistOptions();
    rebuildMyModelRows();
    renderStats();
    renderList();
    renderMyModels();
    showToast(t("toast_rate_reset", { model }));
  }

  async function setGlobalMode(mode) {
    globalMode = mode;
    renderModeUI();
    rebuildMyModelRows();
    await persistOptions();
    renderStats();
    renderList();
    renderMyModels();
    showToast(mode === "api-only" ? t("toast_mode_api") : t("toast_mode_all"));
  }

  async function persistOptions() {
    if (globalThis.magpie && magpie.options) {
      const payload = {
        ...pluginOptions,
        mode: globalMode,
        customPrices,
        myModels: mmPrefsPayload()
      };
      try {
        pluginOptions = await magpie.options.set(payload);
      } catch (e) {
        if (/once a second|429|too many/i.test(String(e && e.message || e))) {
          await new Promise((resolve) => setTimeout(resolve, 1100));
          try {
            pluginOptions = await magpie.options.set(payload);
            return;
          } catch (retryError) {
            e = retryError;
          }
        }
        console.error("Failed to save options via magpie bridge:", e);
      }
    }
  }

  async function syncAllMatched() {
    let count = 0;
    const currentStatus = checkOffPeakStatus();
    for (const m of rawModels) {
      if (m.matched) {
        const hasOffPeak = !!m.offPeakPreset?.supported;
        const peakIn = m.matched.cost.input;
        const peakOut = m.matched.cost.output;
        const offIn = +(peakIn * 0.5).toFixed(5);
        const offOut = +(peakOut * 0.5).toFixed(5);

        customPrices[m.model] = {
          input: peakIn,
          output: peakOut,
          cache_read: m.matched.cost.cache_read,
          cache_write: m.matched.cost.cache_write,
          ...(hasOffPeak ? { offpeak: { enabled: true, rule: "deepseek", input: offIn, output: offOut } } : {})
        };
        count++;
      }
    }
    await persistOptions();
    rebuildMyModelRows();
    renderStats();
    renderList();
    renderMyModels();
    showToast(t("toast_sync_all", { count }));
  }

  // 6. 事件绑定
  $("view-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-view]");
    if (btn) setView(btn.dataset.view);
  });
  $("filter-seg").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    $("filter-seg")
      .querySelectorAll("button")
      .forEach((b) => b.removeAttribute("aria-selected"));
    btn.setAttribute("aria-selected", "true");
    filter = btn.dataset.filter;
    renderList();
  });

  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => setGlobalMode(btn.dataset.mode));
  });

  $("mm-search").addEventListener("input", (e) => {
    mm.query = e.target.value;
    renderMyModels();
  });

  $("mm-provider-btn").addEventListener("click", () => {
    const panel = $("mm-filter-panel");
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderProviderList();
    $("mm-provider-btn").setAttribute("aria-expanded", panel.hidden ? "false" : "true");
  });

  $("mm-provider-search").addEventListener("input", (e) => {
    mm.providerQuery = e.target.value;
    renderProviderList();
  });

  $("mm-provider-all").addEventListener("click", () => setAllProviders(true));
  $("mm-provider-none").addEventListener("click", () => setAllProviders(false));

  $("mm-fav-btn").addEventListener("click", () => {
    mm.prefs.onlyFavorites = !mm.prefs.onlyFavorites;
    scheduleMmPersist();
    renderMyModels();
  });

  $("mm-hide-unpriced").addEventListener("click", () => {
    mm.prefs.hideUnpriced = !mm.prefs.hideUnpriced;
    scheduleMmPersist();
    renderMyModels();
  });

  $("mm-group-btn").addEventListener("click", () => {
    mm.prefs.group = !mm.prefs.group;
    scheduleMmPersist();
    renderMyModels();
  });

  $("mm-reset").addEventListener("click", resetMmFilters);
  $("mm-empty-reset").addEventListener("click", resetMmFilters);

  $("mm-refresh").addEventListener("click", async () => {
    $("mm-refresh").disabled = true;
    try {
      if (globalThis.magpie && magpie.options) {
        pluginOptions = (await magpie.options.get()) || pluginOptions;
        customPrices = pluginOptions.customPrices || customPrices;
        globalMode = pluginOptions.mode || globalMode;
        loadMyModelPrefs();
        renderModeUI();
      }
      const snap = await reloadModelsSnapshot();
      await loadMyModels();
      renderStats();
      renderList();
      showToast(snap.live
        ? ("已更新模型快照（" + snap.count + " 个）与 Magpie 渠道配置")
        : "已重新读取 Magpie 渠道与本地配置（宿主快照尚未就绪，仍用随包快照）");
    } finally {
      $("mm-refresh").disabled = false;
    }
  });

  $("mm-table").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    const key = th.dataset.sort;
    if (mm.prefs.sort.key === key) {
      mm.prefs.sort.dir = mm.prefs.sort.dir === "asc" ? "desc" : "asc";
    } else {
      mm.prefs.sort = { key, dir: "asc" };
    }
    scheduleMmPersist();
    renderMyModels();
  });

  $("mm-table").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    e.preventDefault();
    th.click();
  });
  document.querySelectorAll("#mm-table thead th[data-sort]").forEach((th) => {
    th.tabIndex = 0;
    th.setAttribute("role", "button");
  });

  $("scope-specific").addEventListener("click", () => setScope("specific"));
  $("scope-wildcard").addEventListener("click", () => setScope("wildcard"));

  $("search-input").addEventListener("input", (e) => {
    search = e.target.value;
    renderList();
  });

  $("modal-btn-cancel").addEventListener("click", (e) => {
    e.stopPropagation();
    closeEditModal();
  });

  $("edit-modal").addEventListener("click", (e) => {
    if (e.target === $("edit-modal")) {
      closeEditModal();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("edit-modal").hidden) {
      closeEditModal();
    } else if (e.key === "Escape" && !$("mm-filter-panel").hidden) {
      $("mm-filter-panel").hidden = true;
      $("mm-provider-btn").setAttribute("aria-expanded", "false");
    }
  });

  $("modal-btn-save").addEventListener("click", saveModelPrice);
  $("btn-sync-all").addEventListener("click", syncAllMatched);

  $("modal-btn-match").addEventListener("click", () => {
    if (editingModel && editingModel.matched) {
      const c = editingModel.matched.cost;
      $("input-cost").value = c.input;
      $("output-cost").value = c.output;
      $("cache-read-cost").value = c.cache_read;
      $("cache-write-cost").value = c.cache_write;
      if ($("offpeak-enabled").checked) {
        $("offpeak-input-cost").value = +(c.input * 0.5).toFixed(5);
        $("offpeak-output-cost").value = +(c.output * 0.5).toFixed(5);
      }
    }
  });

  $("offpeak-enabled").addEventListener("change", (e) => {
    $("offpeak-details").hidden = !e.target.checked;
    if (e.target.checked) {
      const inVal = parseFloat($("input-cost").value) || 0;
      const outVal = parseFloat($("output-cost").value) || 0;
      if (!parseFloat($("offpeak-input-cost").value)) {
        $("offpeak-input-cost").value = +(inVal * 0.5).toFixed(5);
      }
      if (!parseFloat($("offpeak-output-cost").value)) {
        $("offpeak-output-cost").value = +(outVal * 0.5).toFixed(5);
      }
    }
  });

  $("input-cost").addEventListener("input", () => {
    if ($("offpeak-enabled").checked) {
      const inVal = parseFloat($("input-cost").value) || 0;
      $("offpeak-input-cost").value = +(inVal * 0.5).toFixed(5);
    }
  });

  $("output-cost").addEventListener("input", () => {
    if ($("offpeak-enabled").checked) {
      const outVal = parseFloat($("output-cost").value) || 0;
      $("offpeak-output-cost").value = +(outVal * 0.5).toFixed(5);
    }
  });

  // 当语言切换时，触发全量 UI 重新渲染
  onLocaleChange(() => {
    updatePeakStatusBar();
    renderModeUI();
    renderStats();
    renderList();
    renderMyModels();
    renderProviderList();
    const descEl = $("view-desc");
    if (descEl) {
      descEl.textContent = mm.view === "mine" ? t("view_desc_mine") : t("view_desc_all");
    }
    if (editingModel && !$("edit-modal").hidden) {
      $("modal-model-title").textContent = t("modal_title_set", { model: editingModel.model });
      $("modal-model-sub").textContent = editingModel.name
        ? t("modal_sub_official", { name: editingModel.name })
        : t("modal_sub_default");
      setScope(selectedScope);
    }
  });

  // 定时更新峰谷状态胶囊 (每 30 秒)
  setInterval(updatePeakStatusBar, 30000);

  loadMyModelPrefs();
  setView("mine");
  await reloadModelsSnapshot();
  updatePeakStatusBar();
  renderModeUI();
  renderStats();
  renderList();
  await loadMyModels();
})();
