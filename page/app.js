
// Model Prices Controller with Master Mode Switch & Scope support
(async () => {
  const $ = (id) => document.getElementById(id);
  const MM = globalThis.MagpieMyModels;

  let toastTimer = null;
  function showToast(msg) {
    const t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.hidden = true;
    }, 2500);
  }

  // Initialize theme and options from Magpie bridge if available
  let lang = "zh";
  let pluginOptions = {};

  if (globalThis.magpie) {
    try {
      const theme = await magpie.ready;
      if (theme && theme.lang) lang = theme.lang;
      magpie.onTheme((t) => {
        document.documentElement.dataset.theme = t.dark ? "dark" : "light";
      });
      pluginOptions = (await magpie.options.get()) || {};
    } catch (e) {
      console.warn("Magpie bridge ready warning:", e);
    }
  }

  // Load models data
  const rawModels = window.__MAGPIE_MODELS_DATA__ || [];
  let customPrices = pluginOptions.customPrices || {};
  let globalMode = pluginOptions.mode || "all-equivalent"; // "all-equivalent" or "api-only"
  let filter = "all";
  let search = "";
  let editingModel = null;
  let selectedScope = "specific";

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

  function getBareModel(fullName) {
    return fullName.includes('/') ? fullName.split('/')[1] : fullName;
  }

  function getModelPrice(item) {
    // If in API-only mode and provider is a subscription/free account without custom override:
    // It is unpriced or 0
    if (globalMode === 'api-only' && item.providerKind === 'subscription') {
      const specificCustom = customPrices[item.model];
      if (specificCustom) {
        return {
          type: 'custom',
          scope: 'specific',
          input: specificCustom.input,
          output: specificCustom.output,
          cache_read: specificCustom.cache_read,
          cache_write: specificCustom.cache_write
        };
      }
      return null; // Not billed in API-only mode
    }

    // 1. Direct specific custom price
    const specificCustom = customPrices[item.model];
    if (specificCustom) {
      return {
        type: 'custom',
        scope: 'specific',
        input: specificCustom.input,
        output: specificCustom.output,
        cache_read: specificCustom.cache_read,
        cache_write: specificCustom.cache_write
      };
    }

    // 2. Wildcard custom price
    const bare = getBareModel(item.model);
    const wildcardCustom = customPrices['*/' + bare];
    if (wildcardCustom) {
      return {
        type: 'custom',
        scope: 'wildcard',
        input: wildcardCustom.input,
        output: wildcardCustom.output,
        cache_read: wildcardCustom.cache_read,
        cache_write: wildcardCustom.cache_write
      };
    }

    // 3. Current active price from settings/list
    if (item.currentPrice && !item.isUnpriced) {
      return {
        type: 'current',
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
    if (globalMode === 'api-only') {
      $("mode-desc-text").innerHTML = '【当前：<strong>只记录 API 真实花费模式</strong>】仅对真实通过付费 API Key 按量计费的渠道记账；包月会员、免费账号及额度渠道（如 Trae, WorkBuddy, Antigravity 等）计价为 $0.00，不会在托盘与用量统计中产生虚拟金额。';
    } else {
      $("mode-desc-text").innerHTML = '【当前：<strong>所有提供商等值公价模式</strong>】对所有渠道（包含 Trae、WorkBuddy、Antigravity 等包月/免费渠道）均按 models.dev 市场公价换算其消耗的等值市值。';
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
        if (p.type === 'custom') customCount++;
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
        "。重新生成 models-data.js 后即可显示。");
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
      list = list.filter(m => {
        const p = getModelPrice(m);
        return p && p.type === 'custom';
      });
    } else if (filter === "unpriced") {
      list = list.filter(m => !getModelPrice(m));
    } else if (filter === "matched") {
      list = list.filter(m => !!m.matched);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(m => 
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

      // Item top: model name + actions
      const topDiv = document.createElement("div");
      topDiv.className = "item-top";

      const isSub = item.providerKind === 'subscription';
      const kindBadge = isSub 
        ? '<span style="font-size: 10px; color: var(--muted); border: 1px solid var(--line); border-radius: 3px; padding: 0 4px; margin-left: 5px;">包月/账号</span>'
        : '<span style="font-size: 10px; color: var(--accent); border: 1px solid var(--accent); border-radius: 3px; padding: 0 4px; margin-left: 5px;">付费API</span>';

      const infoDiv = document.createElement("div");
      infoDiv.className = "item-info";
      infoDiv.innerHTML = '<div class="m-name">' + escapeHtml(item.model) + kindBadge + '</div>' +
        '<div class="m-sub">' + escapeHtml(item.name || '') + '</div>';

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "item-actions";

      const btnEdit = document.createElement("button");
      btnEdit.type = "button";
      btnEdit.className = "btn btn-small";
      btnEdit.textContent = "修改定价";
      btnEdit.addEventListener("click", () => openEditModal(item));
      actionsDiv.append(btnEdit);

      const current = getModelPrice(item);
      const bare = getBareModel(item.model);
      const hasCustom = !!(customPrices[item.model] || customPrices['*/' + bare]);

      if (hasCustom) {
        const btnReset = document.createElement("button");
        btnReset.type = "button";
        btnReset.className = "btn btn-small";
        btnReset.style.color = "var(--red)";
        btnReset.textContent = "重置";
        btnReset.addEventListener("click", () => resetModelPrice(item.model));
        actionsDiv.append(btnReset);
      }

      topDiv.append(infoDiv, actionsDiv);

      // Item bottom: current price tag + models.dev reference
      const bottomDiv = document.createElement("div");
      bottomDiv.className = "item-bottom";

      const priceCol = document.createElement("div");
      priceCol.className = "price-col";

      if (current && current.type === 'custom') {
        const scopeBadge = current.scope === 'wildcard' 
          ? '<span class="badge-tag badge-custom" title="通配生效于所有提供此模型的渠道及历史记录">任何渠道 (*)</span>' 
          : '<span class="badge-tag badge-custom" title="仅此特定渠道生效">专有渠道</span>';

        priceCol.innerHTML = '<span class="rate">$' + current.input + ' / $' + current.output + '</span>' +
          scopeBadge +
          '<span class="cache">缓存: $' + current.cache_read + '/$' + current.cache_write + '</span>';
      } else if (current && current.type === 'current') {
        priceCol.innerHTML = '<span class="rate" style="color: var(--green);">' + escapeHtml(current.text) + '</span>' +
          '<span class="badge-tag badge-modelsdev">已生效</span>';
      } else {
        if (globalMode === 'api-only' && isSub) {
          priceCol.innerHTML = '<span class="badge-tag" style="background: var(--card); color: var(--muted);">免记账 (包月/账号)</span>';
        } else {
          priceCol.innerHTML = '<span class="badge-tag badge-unpriced">未定价 (Unpriced)</span>';
        }
      }

      const refCol = document.createElement("div");
      refCol.className = "ref-col";
      if (item.matched) {
        const c = item.matched.cost;
        refCol.innerHTML = '<span>公价参考:</span> <span class="ref-price">$' + c.input + ' / $' + c.output + '</span>';
      } else {
        refCol.innerHTML = '<span>无公价参考</span>';
      }

      bottomDiv.append(priceCol, refCol);

      li.append(topDiv, bottomDiv);
      listContainer.append(li);
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Edit Modal logic
  function openEditModal(item) {
    editingModel = item;
    const bare = getBareModel(item.model);

    $("modal-model-title").textContent = "设置 " + item.model + " 价格";
    $("modal-model-sub").textContent = item.name ? "官方名称: " + item.name : "配置每次请求与缓存单价";
    $("scope-model-label").textContent = item.model;
    $("scope-wild-label").textContent = bare;

    if (customPrices['*/' + bare] && !customPrices[item.model]) {
      setScope('wildcard');
    } else {
      setScope('specific');
    }

    const current = getModelPrice(item);
    if (current && current.type === 'custom') {
      $("input-cost").value = current.input;
      $("output-cost").value = current.output;
      $("cache-read-cost").value = current.cache_read;
      $("cache-write-cost").value = current.cache_write;
    } else if (MM) {
      const applied = MM.parseCurrentPrice(item.currentPrice);
      if (applied) {
        $("input-cost").value = applied.input == null ? "" : applied.input;
        $("output-cost").value = applied.output == null ? "" : applied.output;
        $("cache-read-cost").value = applied.cache_read == null ? "" : applied.cache_read;
        $("cache-write-cost").value = applied.cache_write == null ? "" : applied.cache_write;
      } else if (item.matched) {
        $("input-cost").value = item.matched.cost.input;
        $("output-cost").value = item.matched.cost.output;
        $("cache-read-cost").value = item.matched.cost.cache_read;
        $("cache-write-cost").value = item.matched.cost.cache_write;
      } else {
        $("input-cost").value = "0";
        $("output-cost").value = "0";
        $("cache-read-cost").value = "0";
        $("cache-write-cost").value = "0";
      }
    } else if (item.matched) {
      $("input-cost").value = item.matched.cost.input;
      $("output-cost").value = item.matched.cost.output;
      $("cache-read-cost").value = item.matched.cost.cache_read;
      $("cache-write-cost").value = item.matched.cost.cache_write;
    } else {
      $("input-cost").value = "0";
      $("output-cost").value = "0";
      $("cache-read-cost").value = "0";
      $("cache-write-cost").value = "0";
    }

    $("edit-modal").hidden = false;
    $("input-cost").focus();
  }

  function setScope(scope) {
    selectedScope = scope;
    if (scope === 'wildcard') {
      $("scope-wildcard").setAttribute("aria-selected", "true");
      $("scope-specific").removeAttribute("aria-selected");
      $("scope-hint").textContent = "【任何供应商模式】：价格将写入 */" + getBareModel(editingModel?.model || '') + "，所有提供此模型的渠道统一以此价格核算！";
    } else {
      $("scope-specific").setAttribute("aria-selected", "true");
      $("scope-wildcard").removeAttribute("aria-selected");
      $("scope-hint").textContent = "【仅当前渠道模式】：价格仅对当前所选的 " + (editingModel?.model || '') + " 生效，其他渠道该模型不受影响。";
    }
  }

  function closeEditModal() {
    $("edit-modal").hidden = true;
    editingModel = null;
  }

  async function saveModelPrice() {
    if (!editingModel) return;
    const bare = getBareModel(editingModel.model);
    const targetKey = selectedScope === 'wildcard' ? ('*/' + bare) : editingModel.model;

    const priceObj = {
      input: parseFloat($("input-cost").value) || 0,
      output: parseFloat($("output-cost").value) || 0,
      cache_read: parseFloat($("cache-read-cost").value) || 0,
      cache_write: parseFloat($("cache-write-cost").value) || 0
    };

    customPrices[targetKey] = priceObj;

    if (selectedScope === 'wildcard' && customPrices[editingModel.model]) {
      delete customPrices[editingModel.model];
    }

    await persistOptions();
    closeEditModal();
    rebuildMyModelRows();
    renderStats();
    renderList();
    renderMyModels();
    showToast("已设置 " + targetKey + " 单价并生效");
  }

  async function resetModelPrice(model) {
    const bare = getBareModel(model);
    delete customPrices[model];
    delete customPrices['*/' + bare];

    await persistOptions();
    rebuildMyModelRows();
    renderStats();
    renderList();
    renderMyModels();
    showToast("已重置 " + model + " 定价");
  }

  async function setGlobalMode(mode) {
    globalMode = mode;
    renderModeUI();
    rebuildMyModelRows();
    await persistOptions();
    renderStats();
    renderList();
    renderMyModels();
    showToast(mode === 'api-only' ? "已切换为：仅计费真实付费 API" : "已切换为：显示所有渠道等值公价");
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
    for (const m of rawModels) {
      if (m.matched) {
        customPrices[m.model] = {
          input: m.matched.cost.input,
          output: m.matched.cost.output,
          cache_read: m.matched.cost.cache_read,
          cache_write: m.matched.cost.cache_write
        };
        count++;
      }
    }
    await persistOptions();
    rebuildMyModelRows();
    renderStats();
    renderList();
    renderMyModels();
    showToast("已应用 " + count + " 个匹配模型公价");
  }

  // Event handlers
  $("view-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-view]");
    if (btn) setView(btn.dataset.view);
  });

  $("filter-seg").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    $("filter-seg").querySelectorAll("button").forEach(b => b.removeAttribute("aria-selected"));
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
      await loadMyModels();
      showToast("已重新读取 Magpie 渠道与本地配置");
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
      $("input-cost").value = editingModel.matched.cost.input;
      $("output-cost").value = editingModel.matched.cost.output;
      $("cache-read-cost").value = editingModel.matched.cost.cache_read;
      $("cache-write-cost").value = editingModel.matched.cost.cache_write;
    }
  });

  loadMyModelPrefs();
  setView("mine");
  renderModeUI();
  renderStats();
  renderList();
  await loadMyModels();
})();
