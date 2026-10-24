// Generated from src/browser/launcher.ts; edit that source. MIT.
"use strict";
// MIT. Maintained launcher controller for Composer and its independent apps.
// Generated copies live at public/brand/launcher.js. Destinations and themes
// remain app-owned. See docs/source-maintenance.md for the markup contract.
(() => {
    const dialog = document.querySelector("#app-navigation");
    const trigger = document.querySelector("[data-open-apps]");
    if (!dialog || !trigger)
        return;
    const search = dialog.querySelector('input[type="search"]');
    const closeButton = dialog.querySelector("[data-close-apps]");
    const status = dialog.querySelector('[role="status"]');
    const list = dialog.querySelector("ul");
    const script = document.currentScript;
    const assetBase = script instanceof HTMLScriptElement ? new URL(".", script.src) : new URL("/brand/", location.href);
    const composerHome = new URL(dialog.dataset.composerHome ?? "https://composer.loftwah.com/", location.href);
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    trigger.setAttribute("aria-keyshortcuts", "Meta+K Control+K");
    const shortcut = trigger.querySelector("kbd");
    if (shortcut)
        shortcut.textContent = isMac ? "⌘ K" : "Ctrl K";
    function icon(paths) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "1.75", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }))
            svg.setAttribute(name, value);
        for (const d of paths) {
            const path = document.createElementNS(svg.namespaceURI, "path");
            path.setAttribute("d", d);
            svg.append(path);
        }
        return svg;
    }
    // The same local controller builds the Composer frame in every independent
    // shell. App-owned hrefs and mount prefixes remain the navigation authority.
    const heading = dialog.querySelector(".dialog-heading");
    const title = dialog.querySelector("h2");
    if (heading && title) {
        const brand = document.createElement("a");
        brand.className = "launcher-brand";
        brand.href = composerHome.href;
        brand.setAttribute("aria-label", "App Composer home");
        const image = document.createElement("img");
        image.src = new URL("composer-icon-20261022b-96.png", assetBase).href;
        image.alt = "";
        image.width = image.height = 40;
        const wordmark = document.createElement("span");
        wordmark.textContent = "App Composer";
        brand.append(image, wordmark);
        const identity = document.createElement("div");
        identity.className = "launcher-identity";
        identity.append(brand, title);
        heading.prepend(identity);
    }
    if (closeButton) {
        closeButton.replaceChildren(icon(["M6 6l12 12M6 18L18 6"]));
        closeButton.setAttribute("aria-label", "Close menu");
        closeButton.title = "Close menu (Esc)";
    }
    const apps = [
        { name: "Linkarooie", href: "https://showcase.loftwah.com/", image: "apps/linkarooie-small-20261018.webp", description: "Links and collections", keywords: "profile curate collection favourites favorites showcase links" },
        { name: "Here / there", href: "https://guestbook.loftwah.com/", image: "apps/herethere-small-20261018.webp", description: "Photos and postcards", keywords: "photo photos guestbook contribute postcard approve moderation gallery" },
        { name: "Link Check", href: "https://share.loftwah.com/", image: "apps/linkcheck-small-20261018.webp", description: "Website and sharing checks", keywords: "inspect website seo metadata social preview report icons" },
        { name: "Hello World", href: "https://ready.loftwah.com/", image: "apps/hello-small-20261018.webp", description: "Your first deployment", keywords: "hello deploy deployment reference first app" },
        { name: "Carry / forward", href: "https://ai.loftwah.com/", image: "apps/carryforward-small-20261018.webp", description: "Portable assistant memory", keywords: "carry forward ai fictional memory encrypted vault" },
        { name: "Launch Kit", href: "https://composer-launch-kit.loftwah.workers.dev/", image: "apps/launch-kit-20261023-32.png", standaloneOnly: true, explainer: "/launch-kit", description: "Profile cards, icons and launch assets", keywords: "profile card branding icon social image png artwork design" },
        { name: "Paperwork", href: "https://composer-paperwork.loftwah.workers.dev/", image: "apps/paperwork-icon-20261024.svg", standaloneOnly: true, explainer: "/paperwork", description: "Fill, draw, sign and print a PDF locally", keywords: "pdf form paperwork document signature ink pen fill print" },
    ];
    const taskIcons = {
        terminal: ["M4 5h16v14H4z", "M8 9l3 3-3 3M13 15h3"],
        book: ["M12 6v14M3 4h5l4 2 4-2h5v14h-5l-4 2-4-2H3z"],
        settings: ["M5 4v16M12 4v16M19 4v16M2 8h6M9 15h6M16 9h6"],
        stacks: ["M3 4h7v7H3zM14 4h7v7h-7zM3 15h7v5H3zM14 15h7v5h-7z"],
        review: ["M14 3H5v18h14V8zM14 3v5h5M8 14l2 2 5-5"],
        chart: ["M4 3v18h17M9 16v-4M14 16V8M19 16V5"],
    };
    // Studio routes share the explicitly selected Composer home. They navigate
    // normally and retain the destination's own authentication boundary.
    const tasks = [
        { name: "Explore App Composer", path: "/discover", description: "Working tools and recent releases", keywords: "new latest shipped features work discover", icon: "stacks" },
        { name: "My profile / My apps", path: "/me", description: "Open your invited profile and app tools", keywords: "member account login sign in profile publish", icon: "settings" },
        { name: "Team application films", path: "/platform/demo", description: "Watch the overview and technical walkthrough", keywords: "video demo movie team platform request", icon: "book" },
        { name: "Platform Teams", path: "/platform", description: "Understand team application requests and policies", keywords: "enterprise team permissions request policy", icon: "stacks" },
        { name: "Your app, your admin", path: "/manage", description: "Follow the owner workflow", keywords: "owner admin enquiries moderation", icon: "settings" },
        { name: "People & access", path: "/people", description: "Manage invitations and app permissions", keywords: "team invite access member grants permissions", icon: "settings" },
        { name: "Build story", path: "/building", description: "Follow a brief into working software", keywords: "build story implementation behind scenes", icon: "book" },
        { name: "Your creator stacks", path: "/_emdash/admin/plugins/composer-stacks/stacks", description: "Open the invited creator studio", keywords: "workspace saved stacks edit owner publish", icon: "stacks" },
        { name: "Init", path: "/init", description: "Shape a new app", keywords: "build create app configuration start", icon: "settings" },
        { name: "Get Ready", path: "/ready", description: "Prepare your development environment", keywords: "setup tools deploy check readiness", icon: "terminal" },
        { name: "Set up your project", path: "/setup", description: "Take a complete portable project guide", keywords: "setup existing new resume markdown instructions", icon: "terminal" },
        { name: "Prompt library", path: "/prompts", description: "Choose a job and copy the complete prompt", keywords: "tldr prompts copy change build branding content", icon: "book" },
        { name: "Runbooks & resources", path: "/resources", description: "Take the operating kit and working examples", keywords: "resources runbooks incident pipeline hooks cheatsheet download kit", icon: "book" },
        { name: "Follow-along tutorial", path: "/learn", description: "Learn by making something", keywords: "help learn start tutorial", icon: "book" },
        { name: "Content and form builder", path: "/init/content", description: "Design your own content model", keywords: "build fields form cms collection", icon: "settings" },
        { name: "Get Ready library and CLI", path: "/docs#standalone-get-ready", description: "Use the standalone tools", keywords: "package command terminal mcp", icon: "terminal" },
        { name: "The whole platform", path: "/architecture", description: "See how the pieces connect", keywords: "architecture system", icon: "stacks" },
        { name: "CMS, cloud, commerce and email guide", path: "/guide", description: "Choose the services your app needs", keywords: "cloudflare emdash shop mail", icon: "book" },
        { name: "Manage mini-apps", path: "/_emdash/admin/plugins/composer-miniapps/apps", description: "Open the invited owner studio", keywords: "admin edit moderation approve profile", icon: "settings" },
        { name: "Decision Explorer", path: "/explore", description: "Explore how your app could work", keywords: "decisions options", icon: "stacks" },
        { name: "Review share report", path: "/review", description: "Read a saved Link Check report", keywords: "seo inspect metadata social preview report", icon: "review" },
        { name: "Analytics & reports", path: "/activity", description: "Inspect recorded actions and share a finding", keywords: "analytics counts visits report story share", icon: "chart" },
        { name: "Documentation", path: "/docs", description: "Read the product and source guides", keywords: "docs help reference", icon: "book" },
    ];
    const retainedApps = new Set();
    for (const entry of dialog.querySelectorAll("[data-destination]")) {
        const link = entry.querySelector("a");
        const name = (link?.querySelector("span:not(.task-icon)")?.firstChild?.textContent ?? link?.firstChild?.textContent ?? "").trim();
        if (name === "App Composer")
            continue;
        if (!apps.some(app => app.name === name) || retainedApps.has(name))
            entry.remove();
        else
            retainedApps.add(name);
    }
    // Older shells only author the original five apps. Complete the app section
    // here so each local controller exposes the entire current catalogue once.
    for (const app of apps) {
        const exists = [...dialog.querySelectorAll("[data-destination]")].some(entry => {
            const link = entry.querySelector("a");
            return (link?.querySelector("span:not(.task-icon)")?.firstChild?.textContent ?? link?.firstChild?.textContent ?? "").trim() === app.name;
        });
        if (exists)
            continue;
        const entry = document.createElement("li");
        entry.setAttribute("data-destination", "");
        const link = document.createElement("a");
        link.href = app.href;
        const copy = document.createElement("span");
        copy.append(document.createTextNode(app.name), document.createElement("small"));
        link.append(copy);
        entry.append(link);
        list?.append(entry);
    }
    for (const task of tasks) {
        const entry = document.createElement("li");
        entry.setAttribute("data-destination", "");
        entry.dataset.keywords = task.keywords;
        const link = document.createElement("a");
        link.href = new URL(task.path, composerHome).href;
        const symbol = document.createElement("span");
        symbol.className = "task-icon";
        symbol.append(icon(taskIcons[task.icon]));
        const copy = document.createElement("span");
        const description = document.createElement("small");
        description.textContent = task.description;
        copy.append(document.createTextNode(task.name), description);
        link.append(symbol, copy);
        entry.append(link);
        list?.append(entry);
    }
    const originalEntries = [...dialog.querySelectorAll("[data-destination]")];
    for (const entry of originalEntries) {
        const link = entry.querySelector("a");
        if (!link)
            continue;
        const name = (link.querySelector("span:not(.task-icon)")?.firstChild?.textContent ?? link.firstChild?.textContent ?? "").trim();
        // Home is always reachable through the branded header; keep one result.
        if (name === "App Composer") {
            entry.remove();
            continue;
        }
        const app = apps.find(item => item.name === name);
        entry.dataset.launcherGroup = app ? "apps" : "studio";
        if (app) {
            entry.dataset.keywords = app.keywords;
            // Guestbook/Linkarooie retain their authored mounted destinations. The
            // two standalone editors open their applications, not Composer explainers.
            if (app.standaloneOnly && link.origin === composerHome.origin && link.pathname.replace(/\/$/, "") === app.explainer)
                link.href = app.href;
            let image = link.querySelector("img");
            if (!image) {
                image = document.createElement("img");
                image.src = new URL(app.image, assetBase).href;
                image.width = image.height = 40;
                image.alt = "";
                link.prepend(image);
            }
            const small = link.querySelector("small");
            if (small)
                small.textContent = app.description;
        }
        // Older independent shells use direct text + small for task links.
        if (!link.querySelector("span:not(.task-icon)")) {
            const copy = document.createElement("span");
            copy.append(...[...link.childNodes].filter(node => node.nodeType === Node.TEXT_NODE || node instanceof HTMLElement && node.tagName === "SMALL"));
            link.append(copy);
        }
        if (!link.querySelector("img, .task-icon, svg")) {
            const symbol = document.createElement("span");
            symbol.className = "task-icon";
            symbol.append(icon(["M4 5h16v14H4z", "M8 9l3 3-3 3M13 15h3"]));
            link.prepend(symbol);
        }
        link.append(icon(["M5 12h14M14 7l5 5-5 5"]));
        link.lastElementChild?.classList.add("launcher-go");
    }
    const entries = originalEntries.filter(entry => entry.isConnected);
    const appEntries = entries.filter(entry => entry.dataset.launcherGroup === "apps").sort((a, b) => apps.findIndex(app => a.dataset.keywords === app.keywords) - apps.findIndex(app => b.dataset.keywords === app.keywords));
    const studioEntries = entries.filter(entry => entry.dataset.launcherGroup === "studio");
    const sections = [];
    for (const [name, group] of [["Apps", appEntries], ["Studio shortcuts", studioEntries]]) {
        if (!group.length || !list)
            continue;
        const section = document.createElement("li");
        section.className = "launcher-section";
        section.textContent = name;
        section.setAttribute("role", "presentation");
        list.append(section, ...group);
        sections.push({ heading: section, entries: [...group] });
    }
    // Keep actual result order aligned with the visible keyboard order.
    entries.splice(0, entries.length, ...appEntries, ...studioEntries);
    let activeEntry = null;
    const footer = document.createElement("div");
    footer.className = "launcher-footer";
    const keys = document.createElement("p");
    keys.id = "launcher-keys";
    keys.className = "launcher-keys";
    for (const [key, label] of [["↑ ↓", "Navigate"], ["↵", "Open"], ["Esc", "Close"]]) {
        const hint = document.createElement("span");
        const keycap = document.createElement("kbd");
        keycap.textContent = key;
        hint.append(keycap, document.createTextNode(label));
        keys.append(hint);
    }
    const all = dialog.querySelector(".launcher-all") ?? document.createElement("a");
    all.className = "launcher-all";
    all.href = new URL("apps", composerHome).href;
    all.replaceChildren(document.createTextNode("All apps"), icon(["M7 17L17 7M7 7h10v10"]));
    footer.append(keys, all);
    dialog.append(footer);
    if (search) {
        search.placeholder = "Search apps, photos, SEO, build…";
        search.spellcheck = false;
        search.setAttribute("aria-describedby", keys.id);
    }
    let lastFocus = null;
    let scrollPosition = { x: 0, y: 0 };
    const bodyProperties = ["position", "top", "right", "bottom", "left", "width"];
    let bodyStyle = [];
    // Both native initial focus and explicit focus must choose a non-editable
    // control. Otherwise showModal alone can still summon a software keyboard.
    closeButton?.setAttribute("autofocus", "");
    search?.removeAttribute("autofocus");
    trigger.setAttribute("aria-controls", dialog.id);
    trigger.setAttribute("aria-expanded", "false");
    function fit() {
        if (!dialog)
            return;
        const viewport = window.visualViewport;
        const height = viewport?.height ?? window.innerHeight;
        const width = viewport?.width ?? window.innerWidth;
        const inset = 12;
        const usableHeight = Math.max(0, Math.min(700, height - inset * 2));
        dialog.style.setProperty("--launcher-height", `${usableHeight}px`);
        dialog.style.setProperty("--launcher-width", `${Math.max(0, width - inset * 2)}px`);
        dialog.style.setProperty("--launcher-top", `${(viewport?.offsetTop ?? 0) + Math.max(inset, (height - usableHeight) / 2)}px`);
        dialog.style.setProperty("--launcher-left", `${(viewport?.offsetLeft ?? 0) + width / 2}px`);
    }
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    const searchable = (value) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en");
    function select(entry, focus = false) {
        if (activeEntry)
            delete activeEntry.dataset.active;
        activeEntry = entry;
        if (!entry)
            return;
        entry.dataset.active = "true";
        if (focus)
            entry.querySelector("a")?.focus({ preventScroll: true });
        entry.scrollIntoView({ block: "nearest" });
    }
    function filter() {
        const words = searchable(search?.value ?? "").trim().split(/\s+/).filter(Boolean);
        let count = 0;
        for (const entry of entries) {
            const haystack = searchable((entry.textContent ?? "") + " " + (entry.dataset.keywords ?? ""));
            entry.hidden = !words.every(word => haystack.includes(word));
            if (!entry.hidden)
                count++;
        }
        for (const section of sections)
            section.heading.hidden = !section.entries.some(entry => !entry.hidden);
        select(entries.find(entry => !entry.hidden) ?? null);
        if (status)
            status.textContent = count
                ? `${count} ${count === 1 ? "destination" : "destinations"}`
                : "No matches. Try an app or task name.";
        if (dialog)
            dialog.dataset.empty = String(count === 0);
        if (list)
            list.scrollTop = 0;
    }
    function markCurrent() {
        if (dialog?.querySelector('[aria-current="page"]'))
            return;
        const path = (value) => value.replace(/\/$/, "") || "/";
        const here = new URL(location.href);
        for (const entry of entries) {
            const link = entry.querySelector("a");
            if (!link)
                continue;
            const target = new URL(link.href, location.href);
            if (target.origin === here.origin && path(target.pathname) === path(here.pathname)) {
                link.setAttribute("aria-current", "page");
                break;
            }
        }
    }
    function lockPage() {
        scrollPosition = { x: window.scrollX, y: window.scrollY };
        bodyStyle = bodyProperties.map(name => ({ name, value: document.body.style.getPropertyValue(name), priority: document.body.style.getPropertyPriority(name) }));
        // A fixed body also prevents the underlying page moving in iOS Safari.
        // The scrollbar gutter keeps the content width stable on desktop.
        document.documentElement.classList.add("launcher-open");
        document.body.style.position = "fixed";
        document.body.style.top = `${-scrollPosition.y}px`;
        document.body.style.right = "0";
        document.body.style.bottom = "auto";
        document.body.style.left = `${-scrollPosition.x}px`;
        document.body.style.width = "100%";
    }
    function unlockPage() {
        // Restore through individual CSSOM properties: setAttribute(style) is
        // blocked by the strict style-src policy used by Hello and Carry / forward.
        for (const { name, value, priority } of bodyStyle) {
            if (value)
                document.body.style.setProperty(name, value, priority);
            else
                document.body.style.removeProperty(name);
        }
        document.documentElement.classList.remove("launcher-open");
        window.scrollTo({ left: scrollPosition.x, top: scrollPosition.y, behavior: "instant" });
    }
    function open(focusSearch = false, returnFocus = null) {
        if (!dialog || dialog.open)
            return;
        // Safari does not focus buttons on pointer activation. Remember the
        // actual trigger for click opening; shortcut opening retains the prior field.
        lastFocus = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : trigger);
        lockPage();
        fit();
        if (search)
            search.value = "";
        filter();
        markCurrent();
        dialog.showModal();
        trigger?.setAttribute("aria-expanded", "true");
        (focusSearch ? search : closeButton)?.focus({ preventScroll: true });
    }
    function close() {
        if (dialog?.open)
            dialog.close();
    }
    trigger.addEventListener("click", () => open(false, trigger));
    closeButton?.addEventListener("click", close);
    dialog.addEventListener("close", () => {
        unlockPage();
        trigger.setAttribute("aria-expanded", "false");
        (lastFocus?.isConnected ? lastFocus : trigger).focus({ preventScroll: true });
        lastFocus = null;
    });
    dialog.addEventListener("click", event => {
        if (event.target !== dialog)
            return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom)
            close();
    });
    // Safari can omit links from sequential keyboard focus when Full Keyboard
    // Access is disabled. Keep Tab within the menu with the same visible controls.
    dialog.addEventListener("keydown", event => {
        if (event.isComposing || event.keyCode === 229 || event.altKey || event.metaKey || event.ctrlKey)
            return;
        // Search inputs consume Escape to clear text in some engines. Closing the
        // command menu must work on the first press, including a nonempty query.
        if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
            if ((event.key === "Home" || event.key === "End") && event.target === search)
                return;
            const visible = entries.filter(entry => !entry.hidden);
            if (!visible.length)
                return;
            const current = visible.findIndex(entry => entry.contains(document.activeElement));
            const index = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : event.key === "ArrowDown" ? (current + 1) % visible.length : (current <= 0 ? visible.length - 1 : current - 1);
            event.preventDefault();
            select(visible[index], true);
            return;
        }
        if (event.target !== search && document.activeElement?.closest("[data-destination]")) {
            if (event.key.length === 1 || event.key === "Backspace") {
                event.preventDefault();
                if (search) {
                    search.value = event.key === "Backspace" ? Array.from(search.value).slice(0, -1).join("") : search.value + event.key;
                    search.focus({ preventScroll: true });
                    filter();
                }
                return;
            }
        }
        if (event.key !== "Tab")
            return;
        const controls = [...dialog.querySelectorAll('a[href], button, input, select, textarea, [tabindex="0"]')].filter(control => !control.matches(":disabled, [hidden]") && control.getClientRects().length > 0);
        if (!controls.length)
            return;
        const index = controls.indexOf(document.activeElement);
        const next = event.shiftKey
            ? (index <= 0 ? controls.length - 1 : index - 1)
            : (index + 1) % controls.length;
        event.preventDefault();
        controls[next].focus();
    });
    // The shortcut enters search from any ordinary page control.
    document.addEventListener("keydown", event => {
        if (event.isComposing || event.keyCode === 229)
            return;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
            event.preventDefault();
            if (!dialog.open)
                open(true);
            else
                search?.focus({ preventScroll: true });
        }
    });
    search?.addEventListener("input", filter);
    search?.addEventListener("keydown", event => {
        if (event.key !== "Enter" || event.isComposing || event.keyCode === 229)
            return;
        const first = (activeEntry ?? entries.find(entry => !entry.hidden))?.querySelector("a");
        if (first) {
            event.preventDefault();
            first.click();
        }
    });
    for (const entry of entries) {
        entry.addEventListener("pointermove", event => { if (event.pointerType === "mouse")
            select(entry); });
        entry.querySelector("a")?.addEventListener("focus", () => select(entry));
    }
    for (const link of dialog.querySelectorAll("a"))
        link.addEventListener("click", close);
    // Navigation restored from the browser's page cache must not keep a modal or
    // stale fixed-body lock over the page, including modified/new-tab clicks.
    window.addEventListener("pageshow", event => { if (event.persisted && dialog.open)
        close(); });
    for (const image of dialog.querySelectorAll("li img")) {
        const missing = () => image.setAttribute("data-launcher-missing", "");
        image.addEventListener("error", missing);
        image.addEventListener("load", () => image.removeAttribute("data-launcher-missing"));
        if (image.complete && image.naturalWidth === 0)
            missing();
    }
    filter();
})();
