(function () {
  var STORAGE_KEY = "panes-landing-locale";
  var DEFAULT_LOCALE = "en";
  var SUPPORTED_LOCALES = ["en", "pt-BR"];
  var initialized = false;

  var TRANSLATIONS = {
    en: {
      meta: {
        title: "Panes | The Agent Development Environment",
        description:
          "Your agents write the code. You need a cockpit. Chat, terminal, git, and approvals in one native window. Engine-agnostic, open-source, built with Rust.",
      },
      common: {
        skipToContent: "Skip to main content",
        languageSelector: "Language selector",
        toggleMenu: "Toggle navigation menu",
        downloadMac: "Download for macOS",
        downloadWindows: "Download for Windows",
        downloadLinux: "Download for Linux",
        features: "Features",
        integrations: "Integrations",
        download: "Download",
        product: "Product",
        community: "Community",
        issues: "Issues",
        discussions: "Discussions",
        decrease: "Decrease",
        increase: "Increase",
        chat: "Chat",
        split: "Split",
        terminal: "Terminal",
        editor: "Editor",
        attach: "Attach",
        planMode: "Plan mode",
        model: "Model",
        permissions: "Permissions",
        send: "Send",
      },
      hero: {
        ariaLabel: "Introduction",
        titleHtml:
          "Your agents write the code.<br><span class=\"hero-title-dim\">You need a cockpit.</span>",
        subtitleHtml:
          "Chat, terminal, git, and approvals in one native window.<br>Engine-agnostic, open-source, built for the agent era.",
      },
      mock: {
        projects: "Projects",
        primaryThread: "Refactor git integration",
        secondaryThread: "Add dark mode tokens",
        heroPrompt: "Add error handling to the git push command with retry logic.",
        followUpHtml:
          "Ask for follow-up changes<span class=\"input-cursor\"></span>",
        unstaged: "Unstaged (2)",
        staged: "Staged (1)",
        commitPlaceholder: "Commit message...",
        commit: "Commit",
        reposLabel: "Projects",
        broadcastTitle: "Multi-launch",
        broadcastInput: "Broadcast input",
        broadcastInputDescription: "Type once, send to all panes",
        gitWorktrees: "Git worktrees",
        gitWorktreesDescription: "Each agent gets its own branch",
        launchThree: "Launch 3",
        startupPreset: "Startup preset",
        startupSubtitle: "Configure what happens when you open this workspace",
        defaultView: "Default view",
        twoPanes: "2 panes",
        onePane: "1 pane",
        broadcast: "broadcast",
      },
      integrations: {
        ariaLabel: "Supported integrations",
        label: "Works with your favorite agents",
      },
      story: {
        anyAgentTitle: "Talk to any agent.",
        anyAgentBody:
          "Native chat for Codex and Claude through their SDKs. Built-in terminal harness for CLI agents like Gemini CLI, Factory Droid, OpenCode, and more. Pick the right engine for the task and go.",
        gitTitle: "Git without the alt-tab.",
        gitBody:
          "Review diffs, stage changes, and commit directly from the agent's output. Agents branch, stash, and push. You approve with full context.",
        workspaceTitle: "Every repo, one workspace.",
        workspaceBody:
          "Open any folder, auto-detect nested git repos. Manage monorepos and multi-service architectures with context-aware chat threads per repo.",
        raceTitle: "Race agents side by side.",
        raceBody:
          "Launch multiple CLI agents into split panes. Broadcast the same prompt to all of them at once. Optionally give each agent its own git worktree so they never collide.",
        startupTitle: "Your workspace, ready on open.",
        startupBody:
          "Configure startup presets: default view, terminal groups, agent assignments, split layouts, and broadcast mode. Open a project and everything is already set up.",
      },
      manifesto: {
        ariaLabel: "Product philosophy",
        textHtml:
          "IDEs were designed for writing code. But you barely write code anymore. You orchestrate, review, and approve. <strong>Panes is the cockpit for that workflow.</strong>",
        orchestrate: "orchestrate",
        review: "review",
        approve: "approve",
        approvalPrompt: "claude wants to run:",
        allow: "Allow",
        deny: "Deny",
      },
      cta: {
        ariaLabel: "Download",
        title: "Ready to start?",
        subtitleHtml:
          "Download, open a folder, start chatting.<br>Free and open-source.",
      },
      footer: {
        tagline: "The open-source Agent Development Environment.",
        copyright: "&copy; 2026 Panes. MIT License.",
      },
    },
    "pt-BR": {
      meta: {
        title: "Panes | O Agent Development Environment",
        description:
          "Os agentes escrevem o código. Você precisa de um cockpit. Chat, terminal, git e aprovações numa janela nativa. Funciona com qualquer engine, open source, feito em Rust.",
      },
      common: {
        skipToContent: "Ir para o conteúdo principal",
        languageSelector: "Seletor de idioma",
        toggleMenu: "Abrir menu",
        downloadMac: "Baixar para macOS",
        downloadWindows: "Baixar para Windows",
        downloadLinux: "Baixar para Linux",
        features: "Produto",
        integrations: "Integrações",
        download: "Baixar",
        product: "Produto",
        community: "Comunidade",
        issues: "Issues",
        discussions: "Discussões",
        decrease: "Diminuir",
        increase: "Aumentar",
        chat: "Chat",
        split: "Split",
        terminal: "Terminal",
        editor: "Editor",
        attach: "Anexar",
        planMode: "Modo plano",
        model: "Modelo",
        permissions: "Permissões",
        send: "Enviar",
      },
      hero: {
        ariaLabel: "Introdução",
        titleHtml:
          "Os agentes escrevem o código.<br><span class=\"hero-title-dim\">Você precisa de um cockpit.</span>",
        subtitleHtml:
          "Chat, terminal, git e aprovações numa janela nativa.<br>Qualquer engine, open source, feito pra era dos agentes.",
      },
      mock: {
        projects: "Projetos",
        primaryThread: "Refatorar integração Git",
        secondaryThread: "Adicionar tokens de dark mode",
        heroPrompt: "Adiciona tratamento de erro no git push com lógica de retry.",
        followUpHtml:
          "Peça mais mudanças<span class=\"input-cursor\"></span>",
        unstaged: "Unstaged (2)",
        staged: "Staged (1)",
        commitPlaceholder: "Mensagem de commit...",
        commit: "Commit",
        reposLabel: "Projetos",
        broadcastTitle: "Multi-launch",
        broadcastInput: "Broadcast input",
        broadcastInputDescription: "Digita uma vez, manda pra todos",
        gitWorktrees: "Git worktrees",
        gitWorktreesDescription: "Cada agente na sua própria branch",
        launchThree: "Abrir 3",
        startupPreset: "Preset de startup",
        startupSubtitle: "Configure o que acontece ao abrir esse workspace",
        defaultView: "View padrão",
        twoPanes: "2 painéis",
        onePane: "1 painel",
        broadcast: "broadcast",
      },
      integrations: {
        ariaLabel: "Integrações suportadas",
        label: "Funciona com seus agentes preferidos",
      },
      story: {
        anyAgentTitle: "Fale com qualquer agente.",
        anyAgentBody:
          "Chat nativo pra Codex e Claude via SDK. Terminal integrado pra agentes de CLI como Gemini CLI, Factory Droid, OpenCode e outros. Escolhe a engine certa e vai.",
        gitTitle: "Git sem alt-tab.",
        gitBody:
          "Revise diffs, stage mudanças e commite direto do output do agente. Agentes criam branch, stash e push. Você aprova com contexto completo.",
        workspaceTitle: "Todo repo, um workspace.",
        workspaceBody:
          "Abre qualquer pasta, detecta repos Git automaticamente. Monorepos, multi-serviço — cada repo tem sua thread de chat com contexto próprio.",
        raceTitle: "Rode agentes lado a lado.",
        raceBody:
          "Abre vários agentes de CLI em split panes. Manda o mesmo prompt pra todos de uma vez. Cada agente pode ter sua própria worktree pra não ter conflito.",
        startupTitle: "Workspace pronto ao abrir.",
        startupBody:
          "Configure presets de startup: view padrão, grupos de terminal, agentes, layouts e broadcast. Abriu o projeto, tá tudo pronto.",
      },
      manifesto: {
        ariaLabel: "Filosofia do produto",
        textHtml:
          "IDEs foram feitas pra escrever código. Mas hoje você quase não escreve mais. Você orquestra, revisa e aprova. <strong>Panes é o cockpit desse fluxo.</strong>",
        orchestrate: "orquestrar",
        review: "revisar",
        approve: "aprovar",
        approvalPrompt: "claude quer executar:",
        allow: "Permitir",
        deny: "Negar",
      },
      cta: {
        ariaLabel: "Baixar",
        title: "Pronto pra começar?",
        subtitleHtml:
          "Baixa, abre uma pasta e começa a usar.<br>Grátis e open source.",
      },
      footer: {
        tagline: "O Agent Development Environment open source.",
        copyright: "&copy; 2026 Panes. Licença MIT.",
      },
    },
  };

  function resolveLocale(input) {
    if (!input) {
      return DEFAULT_LOCALE;
    }

    var normalized = String(input).trim();
    if (!normalized) {
      return DEFAULT_LOCALE;
    }

    if (normalized === "pt" || normalized.toLowerCase().startsWith("pt-")) {
      return "pt-BR";
    }

    if (normalized === "en" || normalized.toLowerCase().startsWith("en-")) {
      return "en";
    }

    return DEFAULT_LOCALE;
  }

  function getValue(locale, path) {
    var parts = path.split(".");
    var current = TRANSLATIONS[locale];
    for (var i = 0; i < parts.length; i += 1) {
      if (!current || typeof current !== "object") {
        return "";
      }
      current = current[parts[i]];
    }
    return typeof current === "string" ? current : "";
  }

  function setText(selector, value) {
    var element = document.querySelector(selector);
    if (element) {
      element.textContent = value;
    }
  }

  function setHtml(selector, value) {
    var element = document.querySelector(selector);
    if (element) {
      element.innerHTML = value;
    }
  }

  function setAttr(selector, attr, value) {
    var element = document.querySelector(selector);
    if (element) {
      element.setAttribute(attr, value);
    }
  }

  function setTextAll(selector, values) {
    var elements = Array.prototype.slice.call(document.querySelectorAll(selector));
    if (Array.isArray(values)) {
      values.forEach(function (value, index) {
        if (elements[index]) {
          elements[index].textContent = value;
        }
      });
      return;
    }

    elements.forEach(function (element) {
      element.textContent = values;
    });
  }

  function setAttrAll(selector, attr, values) {
    var elements = Array.prototype.slice.call(document.querySelectorAll(selector));
    if (Array.isArray(values)) {
      values.forEach(function (value, index) {
        if (elements[index]) {
          elements[index].setAttribute(attr, value);
        }
      });
      return;
    }

    elements.forEach(function (element) {
      element.setAttribute(attr, values);
    });
  }

  function detectOS() {
    var platform = navigator.platform.toLowerCase();
    if (platform.includes("win")) return "windows";
    if (platform.includes("linux")) return "linux";
    return "mac";
  }

  function updateDownloadLabels(locale) {
    var os = detectOS();
    var key = os === "windows" ? "common.downloadWindows" : os === "linux" ? "common.downloadLinux" : "common.downloadMac";
    var label = getValue(locale, key);
    document.querySelectorAll("#hero-download span, #cta-download span").forEach(function (element) {
      element.textContent = label;
    });
    setText("#nav-download span", getValue(locale, "common.download"));
  }

  function updateSwitcher(locale) {
    document.querySelectorAll("[data-set-locale]").forEach(function (button) {
      var active = button.getAttribute("data-set-locale") === locale;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", active ? "true" : "false");
    });
  }

  function applyLocale(locale, skipFade) {
    var nextLocale = resolveLocale(locale);

    if (!skipFade && initialized) {
      document.body.classList.add("locale-fading");
      setTimeout(function () {
        doApplyLocale(nextLocale);
        requestAnimationFrame(function () {
          document.body.classList.remove("locale-fading");
        });
      }, 150);
      return;
    }

    doApplyLocale(nextLocale);
  }

  function doApplyLocale(nextLocale) {
    document.documentElement.lang = nextLocale;

    setText("title", getValue(nextLocale, "meta.title"));
    setAttr('meta[name="description"]', "content", getValue(nextLocale, "meta.description"));
    setAttr('meta[property="og:title"]', "content", getValue(nextLocale, "meta.title"));
    setAttr('meta[property="og:description"]', "content", getValue(nextLocale, "meta.description"));
    setAttr('meta[name="twitter:title"]', "content", getValue(nextLocale, "meta.title"));
    setAttr('meta[name="twitter:description"]', "content", getValue(nextLocale, "meta.description"));

    setText(".skip-link", getValue(nextLocale, "common.skipToContent"));
    setAttr("#nav", "aria-label", nextLocale === "pt-BR" ? "Navegação principal" : "Main navigation");
    setAttr("#lang-switcher", "aria-label", getValue(nextLocale, "common.languageSelector"));
    setAttr("#nav-hamburger", "aria-label", getValue(nextLocale, "common.toggleMenu"));

    setText('.nav-links a[href="#integrations"]', getValue(nextLocale, "common.integrations"));
    setText('.nav-links a[href="#product"]', getValue(nextLocale, "common.features"));

    setAttr(".hero", "aria-label", getValue(nextLocale, "hero.ariaLabel"));
    setHtml(".hero-title", getValue(nextLocale, "hero.titleHtml"));
    setHtml(".hero-subtitle", getValue(nextLocale, "hero.subtitleHtml"));
    updateDownloadLabels(nextLocale);

    setText(".sb-section", getValue(nextLocale, "mock.projects"));
    setText(".sb-thread.active span", getValue(nextLocale, "mock.primaryThread"));
    setText(".sb-thread:not(.active) span", getValue(nextLocale, "mock.secondaryThread"));
    setText(".msg-row.user .msg-bubble", getValue(nextLocale, "mock.heroPrompt"));
    setHtml(".input-placeholder", getValue(nextLocale, "mock.followUpHtml"));
    setTextAll(".git-section-label", [getValue(nextLocale, "mock.unstaged"), getValue(nextLocale, "mock.staged")]);
    setAttr(".git-commit-input", "placeholder", getValue(nextLocale, "mock.commitPlaceholder"));
    setText(".git-commit-btn", getValue(nextLocale, "mock.commit"));

    setAttr("#integrations", "aria-label", getValue(nextLocale, "integrations.ariaLabel"));
    setText(".strip-label", getValue(nextLocale, "integrations.label"));

    setText("#product .story-scene:nth-of-type(1) .story-text h2", getValue(nextLocale, "story.anyAgentTitle"));
    setText("#product .story-scene:nth-of-type(1) .story-text p", getValue(nextLocale, "story.anyAgentBody"));
    setText("#product .story-scene:nth-of-type(2) .story-text h2", getValue(nextLocale, "story.gitTitle"));
    setText("#product .story-scene:nth-of-type(2) .story-text p", getValue(nextLocale, "story.gitBody"));
    setText("#product .story-scene:nth-of-type(3) .story-text h2", getValue(nextLocale, "story.workspaceTitle"));
    setText("#product .story-scene:nth-of-type(3) .story-text p", getValue(nextLocale, "story.workspaceBody"));
    setText("#product .story-scene:nth-of-type(4) .story-text h2", getValue(nextLocale, "story.raceTitle"));
    setText("#product .story-scene:nth-of-type(4) .story-text p", getValue(nextLocale, "story.raceBody"));
    setText("#product .story-scene:nth-of-type(5) .story-text h2", getValue(nextLocale, "story.startupTitle"));
    setText("#product .story-scene:nth-of-type(5) .story-text p", getValue(nextLocale, "story.startupBody"));

    setAttrAll("#product .story-scene:nth-of-type(1) .v-layout-btn", "aria-label", [
      getValue(nextLocale, "common.chat"),
      getValue(nextLocale, "common.split"),
      getValue(nextLocale, "common.terminal"),
      getValue(nextLocale, "common.editor"),
    ]);
    setText("#product .story-scene:nth-of-type(1) .v-input-text", nextLocale === "pt-BR" ? "Peça ajustes adicionais" : "Ask for follow-up changes");
    setAttr('#product .story-scene:nth-of-type(1) .v-toolbar-btn[aria-label="Attach"]', "aria-label", getValue(nextLocale, "common.attach"));
    setAttr('#product .story-scene:nth-of-type(1) .v-toolbar-btn[aria-label="Plan mode"]', "aria-label", getValue(nextLocale, "common.planMode"));
    setAttr('#product .story-scene:nth-of-type(1) .v-model-picker', "aria-label", getValue(nextLocale, "common.model"));
    setAttr('#product .story-scene:nth-of-type(1) .v-toolbar-btn[aria-label="Permissions"]', "aria-label", getValue(nextLocale, "common.permissions"));
    setAttr('#product .story-scene:nth-of-type(1) .v-send-btn', "aria-label", getValue(nextLocale, "common.send"));
    setTextAll("#product .story-scene:nth-of-type(2) .v-git-label", [getValue(nextLocale, "mock.unstaged"), getValue(nextLocale, "mock.staged")]);
    setText("#product .story-scene:nth-of-type(2) .v-git-commit-btn", getValue(nextLocale, "mock.commit"));
    setText("#product .story-scene:nth-of-type(3) .v-repos-label", getValue(nextLocale, "mock.reposLabel"));
    setText("#product .story-scene:nth-of-type(4) .v-broadcast-title", getValue(nextLocale, "mock.broadcastTitle"));
    setTextAll("#product .story-scene:nth-of-type(4) .v-option-title", [
      getValue(nextLocale, "mock.broadcastInput"),
      getValue(nextLocale, "mock.gitWorktrees"),
    ]);
    setTextAll("#product .story-scene:nth-of-type(4) .v-option-desc", [
      getValue(nextLocale, "mock.broadcastInputDescription"),
      getValue(nextLocale, "mock.gitWorktreesDescription"),
    ]);
    setAttrAll('#product .story-scene:nth-of-type(4) .v-stepper-btn[aria-label="Decrease"]', "aria-label", getValue(nextLocale, "common.decrease"));
    setAttrAll('#product .story-scene:nth-of-type(4) .v-stepper-btn[aria-label="Increase"]', "aria-label", getValue(nextLocale, "common.increase"));
    setText("#product .story-scene:nth-of-type(4) .v-launch-btn", getValue(nextLocale, "mock.launchThree"));
    setText("#product .story-scene:nth-of-type(5) .v-startup-title", getValue(nextLocale, "mock.startupPreset"));
    setText("#product .story-scene:nth-of-type(5) .v-startup-subtitle", getValue(nextLocale, "mock.startupSubtitle"));
    setText("#product .story-scene:nth-of-type(5) .v-startup-label", getValue(nextLocale, "mock.defaultView"));
    setTextAll("#product .story-scene:nth-of-type(5) .v-startup-pill", [
      getValue(nextLocale, "common.chat"),
      getValue(nextLocale, "common.split"),
      getValue(nextLocale, "common.terminal"),
      getValue(nextLocale, "common.editor"),
    ]);
    setTextAll("#product .story-scene:nth-of-type(5) .v-startup-badges .v-startup-badge", [
      getValue(nextLocale, "mock.twoPanes"),
      getValue(nextLocale, "mock.broadcast"),
      getValue(nextLocale, "mock.onePane"),
    ]);

    setAttr(".manifesto", "aria-label", getValue(nextLocale, "manifesto.ariaLabel"));
    setHtml(".manifesto-text", getValue(nextLocale, "manifesto.textHtml"));
    setTextAll(".m-pane-label", [
      getValue(nextLocale, "manifesto.orchestrate"),
      getValue(nextLocale, "manifesto.review"),
      getValue(nextLocale, "manifesto.approve"),
    ]);
    setText(".m-approve-prompt", getValue(nextLocale, "manifesto.approvalPrompt"));
    setTextAll(".m-approve-btn", [getValue(nextLocale, "manifesto.allow"), getValue(nextLocale, "manifesto.deny")]);

    setAttr(".cta", "aria-label", getValue(nextLocale, "cta.ariaLabel"));
    setText(".cta-title", getValue(nextLocale, "cta.title"));
    setHtml(".cta-subtitle", getValue(nextLocale, "cta.subtitleHtml"));

    setHtml(".footer-copy", getValue(nextLocale, "footer.copyright"));

    updateSwitcher(nextLocale);

    try {
      localStorage.setItem(STORAGE_KEY, nextLocale);
    } catch (_error) {
      // ignore storage issues
    }
  }

  function detectInitialLocale() {
    try {
      var params = new URLSearchParams(window.location.search);
      var urlLang = params.get("lang");
      if (urlLang) {
        return resolveLocale(urlLang);
      }
    } catch (_error) {
      // ignore URL parsing issues
    }

    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return resolveLocale(saved);
      }
    } catch (_error) {
      // ignore storage issues
    }

    return resolveLocale(navigator.language);
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;

    document.querySelectorAll("[data-set-locale]").forEach(function (button) {
      button.addEventListener("click", function () {
        applyLocale(button.getAttribute("data-set-locale"));
      });
    });

    applyLocale(detectInitialLocale(), true);
  }

  window.panesLandingI18n = {
    init: init,
    applyLocale: applyLocale,
    resolveLocale: resolveLocale,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
}());
