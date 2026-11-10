// app.js - Model Prices Controller with Master Mode Switch, Scope support & Full i18n/White-border Fix
(async () => {
  const $ = (id) => document.getElementById(id);
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

  // Load models data and options
  const rawModels = window.__MAGPIE_MODELS_DATA__ || [];
  let pluginOptions = {};
  let customPrices = {};
  let globalMode = "all-equivalent"; // "all-equivalent" or "api-only"
  let filter = "all";
  let search = "";
  let editingModel = null;
  let selectedScope = "specific";

  // 1. 初始化 Magpie 宿主与插件通信规范 (Host PostMessage Handshake & Theme/Locale Sync)
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

  function getModelPrice(item) {
    if (globalMode === "api-only" && item.providerKind === "subscription") {
      const specificCustom = customPrices[item.model];
      if (specificCustom) {
        return {
          type: "custom",
          scope: "specific",
          input: specificCustom.input,
          output: specificCustom.output,
          cache_read: specificCustom.cache_read,
          cache_write: specificCustom.cache_write
        };
      }
      return null;
    }

    const specificCustom = customPrices[item.model];
    if (specificCustom) {
      return {
        type: "custom",
        scope: "specific",
        input: specificCustom.input,
        output: specificCustom.output,
        cache_read: specificCustom.cache_read,
        cache_write: specificCustom.cache_write
      };
    }

    const bare = getBareModel(item.model);
    const wildcardCustom = customPrices["*/" + bare];
    if (wildcardCustom) {
      return {
        type: "custom",
        scope: "wildcard",
        input: wildcardCustom.input,
        output: wildcardCustom.output,
        cache_read: wildcardCustom.cache_read,
        cache_write: wildcardCustom.cache_write
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
    if (globalMode === "api-only") {
      $("mode-btn-api").setAttribute("aria-selected", "true");
      $("mode-btn-all").removeAttribute("aria-selected");
      $("mode-desc-text").innerHTML = t("mode_desc_api");
    } else {
      $("mode-btn-all").setAttribute("aria-selected", "true");
      $("mode-btn-api").removeAttribute("aria-selected");
      $("mode-desc-text").innerHTML = t("mode_desc_all");
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

      const infoDiv = document.createElement("div");
      infoDiv.className = "item-info";
      infoDiv.innerHTML =
        '<div class="m-name">' +
        escapeHtml(item.model) +
        kindBadge +
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

      if (current && current.type === "custom") {
        const scopeBadge =
          current.scope === "wildcard"
            ? `<span class="badge-tag badge-custom" title="${escapeHtml(t("scope_wildcard_badge_title"))}">${escapeHtml(t("scope_wildcard_badge"))}</span>`
            : `<span class="badge-tag badge-custom" title="${escapeHtml(t("scope_specific_badge_title"))}">${escapeHtml(t("scope_specific_badge"))}</span>`;

        priceCol.innerHTML =
          '<span class="rate">$' +
          current.input +
          " / $" +
          current.output +
          "</span>" +
          scopeBadge +
          `<span class="cache">${escapeHtml(t("cache_label"))} $${current.cache_read}/$${current.cache_write}</span>`;
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

  // Edit Modal logic
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
    if (current && current.type === "custom") {
      $("input-cost").value = current.input;
      $("output-cost").value = current.output;
      $("cache-read-cost").value = current.cache_read;
      $("cache-write-cost").value = current.cache_write;
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

    const priceObj = {
      input: parseFloat($("input-cost").value) || 0,
      output: parseFloat($("output-cost").value) || 0,
      cache_read: parseFloat($("cache-read-cost").value) || 0,
      cache_write: parseFloat($("cache-write-cost").value) || 0
    };

    customPrices[targetKey] = priceObj;

    if (selectedScope === "wildcard" && customPrices[editingModel.model]) {
      delete customPrices[editingModel.model];
    }

    await persistOptions();
    closeEditModal();
    renderStats();
    renderList();
    showToast(t("toast_rate_saved", { key: targetKey }));
  }

  async function resetModelPrice(model) {
    const bare = getBareModel(model);
    delete customPrices[model];
    delete customPrices["*/" + bare];

    await persistOptions();
    renderStats();
    renderList();
    showToast(t("toast_rate_reset", { model }));
  }

  async function setGlobalMode(mode) {
    globalMode = mode;
    renderModeUI();
    await persistOptions();
    renderStats();
    renderList();
    showToast(mode === "api-only" ? t("toast_mode_api") : t("toast_mode_all"));
  }

  async function persistOptions() {
    if (globalThis.magpie && magpie.options) {
      try {
        pluginOptions = await magpie.options.set({
          ...pluginOptions,
          mode: globalMode,
          customPrices
        });
      } catch (e) {
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
    renderStats();
    renderList();
    showToast(t("toast_sync_all", { count }));
  }

  // Event handlers
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

  $("mode-btn-all").addEventListener("click", () => setGlobalMode("all-equivalent"));
  $("mode-btn-api").addEventListener("click", () => setGlobalMode("api-only"));

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

  // 当语言切换时，触发全量 UI 重新渲染
  onLocaleChange(() => {
    renderModeUI();
    renderStats();
    renderList();
    if (editingModel && !$("edit-modal").hidden) {
      $("modal-model-title").textContent = t("modal_title_set", { model: editingModel.model });
      $("modal-model-sub").textContent = editingModel.name
        ? t("modal_sub_official", { name: editingModel.name })
        : t("modal_sub_default");
      setScope(selectedScope);
    }
  });

  // 初始渲染
  renderModeUI();
  renderStats();
  renderList();
})();
