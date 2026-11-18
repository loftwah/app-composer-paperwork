// Generated from src/browser/launcher.ts; edit that source. MIT.
"use strict";
// MIT. Maintained launcher controller for Composer and its independent apps.
// Generated copies live at public/brand/launcher.js. Destinations and themes
// remain app-owned. See docs/source-maintenance.md for the markup contract.
//
// This file is the one shared navigation registry. The public /apps catalogue
// in src/lib/apps.ts remains the app library; the app entries below name the
// catalogue id they mirror so the focused tests can reconcile both sources.
// A destination is listed only after its route exists: private routes are
// marked "invitation" and never appear in the anonymous menu. Do not add a
// disabled row or an invented availability state.
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
    const viewer = dialog.dataset.viewer === "member" ? "member" : "public";
    const recentsEndpoint = dialog.dataset.launcherRecents ?? "";
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
    const taskIcons = {
        terminal: ["M4 5h16v14H4z", "M8 9l3 3-3 3M13 15h3"],
        book: ["M12 6v14M3 4h5l4 2 4-2h5v14h-5l-4 2-4-2H3z"],
        settings: ["M5 4v16M12 4v16M19 4v16M2 8h6M9 15h6M16 9h6"],
        stacks: ["M3 4h7v7H3zM14 4h7v7h-7zM3 15h7v5H3zM14 15h7v5h-7z"],
        review: ["M14 3H5v18h14V8zM14 3v5h5M8 14l2 2 5-5"],
        chart: ["M4 3v18h17M9 16v-4M14 16V8M19 16V5"],
        spark: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", "M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"],
        compass: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M15.5 8.5l-2.1 4.9-4.9 2.1 2.1-4.9z"],
        tool: ["M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.2 2.2-2.5-2.5z"],
        recent: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
    };
    /* launcher-registry:start */
    const destinations = [
        // Make something: the anonymous first view leads with finished jobs.
        { name: "Create a site", description: "Choose a starting point and export a portable brief.", keywords: "create site website build start app project init new brief", aliases: ["create site", "new site", "new project", "start a project", "build a website", "init"], audience: "public", group: "make", path: "/init", icon: "spark" },
        { name: "Shape your content", description: "Design typed fields and a content model for your app.", keywords: "content model fields form cms collection builder schema", aliases: ["content model", "fields", "forms", "cms", "content builder", "content and form builder"], audience: "public", group: "make", path: "/init/content", icon: "settings" },
        { name: "Prepare launch artwork", description: "Launch Kit: make icons, PWA assets and social images from your artwork.", keywords: "icons icon favicon social image launch artwork branding pwa profile card", aliases: ["launch kit", "icons", "favicon", "site icon", "app icon", "make a favicon", "make an icon", "social images", "pwa", "brand assets"], audience: "public", group: "make", href: "https://composer-launch-kit.loftwah.workers.dev/", image: "apps/launch-kit-20261023-32.png", catalogue: "launch-kit" },
        // Continue exploring: what is working, and how to make a first change.
        { name: "See working apps", description: "Open a shipped app, try it standalone or take its source.", keywords: "apps examples library tools shipped working catalogue", aliases: ["apps", "examples", "tools", "library", "all apps"], audience: "public", group: "explore", path: "/apps", icon: "stacks" },
        { name: "Follow the tutorial", description: "Make a first change, step by step, with recovery help.", keywords: "learn tutorial help start guide first change", aliases: ["learn", "tutorial", "guide", "help", "getting started", "follow-along tutorial"], audience: "public", group: "explore", path: "/learn", icon: "book" },
        { name: "Browse by task", description: "Find the right tool or example for what you want to make.", keywords: "discover tasks jobs roles examples tools", aliases: ["discover", "jobs", "roles", "explore app composer"], audience: "public", group: "explore", path: "/discover", icon: "compass" },
        // Use a tool: real tools that work without an account where possible.
        { name: "Check a page before sharing", description: "Link Check: inspect icons, share images, metadata and headings.", keywords: "check link url page inspect seo metadata social preview report icons share", aliases: ["check a link", "link check", "seo", "metadata", "social preview"], audience: "public", group: "tool", href: "https://share.loftwah.com/", image: "apps/linkcheck-small-20261018.webp", catalogue: "linkcheck" },
        { name: "Fill or sign a PDF", description: "Paperwork: fill fields, draw and sign locally. Files stay in your browser.", keywords: "pdf form fill sign document signature print local paperwork", aliases: ["pdf", "form", "sign", "paperwork", "fill a pdf"], audience: "public", group: "tool", href: "https://composer-paperwork.loftwah.workers.dev/", image: "apps/paperwork-icon-20261024.svg", catalogue: "paperwork" },
        { name: "Review a saved check", description: "Read a saved Link Check report and prepare a bounded agent handoff.", keywords: "review report saved handoff link check findings", aliases: ["review", "report", "handoff", "link check report", "review share report"], audience: "public", group: "tool", path: "/review", icon: "review" },
        // Apps: the remaining shipped catalogue entries, each once.
        { name: "Media Studio", description: "Read how the studio works and set up your own.", memberDescription: "Open or set up your studio: images, video and sound.", keywords: "media studio images video sound edit project creative", aliases: ["edit media", "studio", "images", "video", "sound"], audience: "public", group: "apps", path: "/media-studio", memberPath: "/media-studio/studio", image: "apps/media-studio-launcher-20261118.webp", catalogue: "media-studio" },
        { name: "Edit images", description: "Media Studio Image Tools. Resize, crop and convert images on this device.", keywords: "image images workbench resize crop convert inspect photo jpeg png webp local browser", aliases: ["image workbench", "image editor", "edit images", "browser-local image", "image tools", "images", "resize image", "crop image", "convert image"], audience: "public", group: "apps", href: "https://media.loftwah.com/tools/images", icon: "tool" },
        { name: "LDraw", description: "Draw and save editable diagrams locally, then export PNG or SVG.", keywords: "draw drawing diagram excalidraw scene png svg local offline", aliases: ["draw", "diagram", "drawing"], audience: "public", group: "apps", href: "https://ldraw.loftwah.com/", image: "apps/ldraw-tile-fa7a2ab6171c-010cfbd2-r2-96.webp", catalogue: "ldraw" },
        { name: "Here / there", description: "Collect photos and messages, then choose what to publish.", keywords: "photo photos guestbook contribute postcard approve moderation gallery", aliases: ["guestbook", "photos", "postcards", "publish"], audience: "public", group: "apps", path: "/guestbook/", image: "apps/herethere-small-20261018.webp", catalogue: "guestbook" },
        { name: "Linkarooie", description: "Arrange your links and approved photos into a page you control.", keywords: "profile curate collection favourites favorites showcase links publish share", aliases: ["profile", "links", "publish", "share"], audience: "public", group: "apps", path: "/showcase/", image: "apps/linkarooie-small-20261018.webp", catalogue: "showcase" },
        { name: "Hello World", description: "Prove a small first application can build and deploy.", keywords: "hello deploy deployment reference first app", aliases: ["hello", "first app", "deploy"], audience: "public", group: "apps", href: "https://ready.loftwah.com/", image: "apps/hello-small-20261018.webp", catalogue: "hello" },
        { name: "Carry / forward", description: "Try a fictional portable assistant memory in an encrypted file.", keywords: "carry forward ai fictional memory encrypted vault", aliases: ["carry forward", "memory", "vault"], audience: "public", group: "apps", href: "https://ai.loftwah.com/", image: "apps/carryforward-small-20261018.webp", catalogue: "state" },
        // More shortcuts: advanced and operational routes, kept searchable and
        // collapsed in the first view instead of competing with the task groups.
        { name: "Get Ready", description: "Prepare and check your development environment.", keywords: "setup tools deploy check readiness environment", audience: "public", group: "more", path: "/ready", icon: "terminal" },
        { name: "Get Ready library and CLI", description: "Use the standalone Get Ready package and tools.", keywords: "package command terminal mcp standalone", audience: "public", group: "more", path: "/docs/how-it-works#standalone-get-ready", icon: "terminal" },
        { name: "Set up your project", description: "Take a complete portable project guide for an existing project.", keywords: "setup existing resume markdown instructions project guide", audience: "public", group: "more", path: "/setup", icon: "terminal" },
        { name: "Runbooks & resources", description: "Take the operating kit and working examples.", keywords: "resources runbooks incident pipeline hooks cheatsheet download kit", audience: "public", group: "more", path: "/resources", icon: "book" },
        { name: "Prompt library", description: "Choose a job and copy the complete prompt.", keywords: "tldr prompts copy change build branding content", audience: "public", group: "more", path: "/prompts", icon: "book" },
        { name: "Point your agent here", description: "Give your agent the machine-readable product entry point.", keywords: "agent llm markdown machine readable instructions", audience: "public", group: "more", path: "/agent", icon: "terminal" },
        { name: "Diagram atlas", description: "See the maintained diagrams and their sources.", keywords: "diagrams map architecture visual", audience: "public", group: "more", path: "/diagrams", icon: "book" },
        { name: "Browse Share", description: "Browse project artwork, open a full preview and share a piece.", keywords: "app composer share gallery design artwork covers images", aliases: ["app composer share"], audience: "public", group: "more", path: "/share", icon: "book" },
        { name: "Team application films", description: "Watch the overview and technical walkthrough.", keywords: "video demo movie team platform request", audience: "public", group: "more", path: "/platform/demo", icon: "book" },
        { name: "Platform Teams", description: "Understand team application requests and policies.", keywords: "enterprise team permissions request policy", audience: "public", group: "more", path: "/platform", icon: "stacks" },
        { name: "Build story", description: "Follow a brief into working software.", keywords: "build story implementation behind scenes", audience: "public", group: "more", path: "/building", icon: "book" },
        { name: "Your app, your admin", description: "Follow the owner workflow for an app you operate.", keywords: "owner admin enquiries moderation operate app", aliases: ["operate an app", "owner", "admin", "moderate"], audience: "public", group: "more", path: "/manage", icon: "settings" },
        { name: "The whole platform", description: "See how the pieces connect.", keywords: "architecture system platform", audience: "public", group: "more", path: "/architecture", icon: "stacks" },
        { name: "CMS, cloud, commerce and email guide", description: "Choose the services your app needs.", keywords: "cloudflare emdash shop mail guide services", audience: "public", group: "more", path: "/guide", icon: "book" },
        { name: "Decision Explorer", description: "Explore how your app could work before committing.", keywords: "decisions options explore path", audience: "public", group: "more", path: "/explore", icon: "stacks" },
        { name: "Analytics & reports", description: "Inspect recorded actions and share a finding.", keywords: "analytics counts visits report story share activity", audience: "public", group: "more", path: "/activity", icon: "chart" },
        { name: "Documentation", description: "Read the product, source and operator guides.", keywords: "docs help reference guides", audience: "public", group: "more", path: "/docs", icon: "book" },
        { name: "Agent role packs", description: "Choose a role and copy its complete instructions.", keywords: "roles agents job contracts prompts", audience: "public", group: "more", path: "/roles", icon: "book" },
        { name: "Creator stacks guide", description: "Explore working creator setups and what they keep.", keywords: "creator stacks studio setups explainer", audience: "public", group: "more", path: "/studio", icon: "stacks" },
        { name: "Release check demo", description: "Walk through a release check and its evidence.", keywords: "release effect check demo verification", audience: "public", group: "more", path: "/effect", icon: "review" },
        { name: "Cloudflare costs & operations", description: "Understand hosting costs and ongoing upkeep.", keywords: "cloudflare costs pricing operations hosting", audience: "public", group: "more", path: "/cloudflare", icon: "book" },
        // Invitation routes: omitted from the anonymous menu, never faked.
        { name: "My profile / My apps", description: "Open your invited profile and workspace app tools.", keywords: "member account login sign in profile publish apps", aliases: ["sign in", "my apps", "profile"], audience: "invitation", group: "more", path: "/me", icon: "settings" },
        { name: "People & access", description: "Manage workspace invitations and selected app permissions.", keywords: "team invite access member grants permissions people", aliases: ["invite people", "permissions", "access"], audience: "invitation", ownerOnly: true, group: "more", path: "/people", icon: "settings" },
        { name: "Your creator stacks", description: "Open your workspace projects and their saved revisions.", keywords: "workspace saved stacks edit owner publish projects", aliases: ["projects", "workspace projects", "studio projects"], audience: "invitation", ownerOnly: true, group: "more", path: "/_emdash/admin/plugins/composer-stacks/stacks", icon: "stacks" },
        { name: "Manage mini-apps", description: "Open the invited owner studio for catalogue apps.", keywords: "admin edit moderation approve profile mini apps", aliases: ["manage apps", "catalogue admin", "manage mini-apps (invited admin)"], audience: "invitation", ownerOnly: true, group: "more", path: "/_emdash/admin/plugins/composer-miniapps/apps", icon: "settings" },
    ];
    /* launcher-registry:end */
    const groupOrder = ["make", "explore", "tool", "apps", "more"];
    const groupLabels = { make: "Make something", explore: "Continue exploring", tool: "Use a tool", apps: "Apps", more: "More shortcuts" };
    const groupIcons = { make: "spark", explore: "compass", tool: "tool", apps: "stacks", more: "book" };
    /* launcher-logic:start */
    function searchable(value) {
        return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en");
    }
    function searchWords(value) {
        return searchable(value ?? "").trim().split(/\s+/).filter(Boolean);
    }
    /** Every query word must match. A name match outranks an alias, which
     * outranks descriptive copy, so "create site" chooses the job rather than a
     * page that merely mentions it. */
    function scoreText(name, description, keywords, aliases, words) {
        if (!words.length)
            return 0;
        const label = searchable(name);
        const alias = searchable(aliases);
        const text = searchable(description + " " + keywords);
        let score = 0;
        for (const word of words) {
            if (label === word)
                score += 120;
            else if (label.startsWith(word))
                score += 80;
            else if (label.split(/\s+/).some(part => part.startsWith(word)))
                score += 60;
            else if (label.includes(word))
                score += 40;
            else if (alias.includes(word))
                score += 25;
            else if (text.includes(word))
                score += 10;
            else
                return -1;
        }
        return score;
    }
    function scoreDestination(item, words) {
        return scoreText(item.name, item.description, item.keywords, (item.aliases ?? []).join(" "), words);
    }
    function visibleDestinations(items, audience) {
        return items.filter(item => audience === "member" || item.audience === "public");
    }
    const rows = [];
    let layout = "default";
    let recentsState = "anonymous";
    let recentsBusy = false;
    let recentsNote = null;
    let moreExpanded = false;
    function safePath(value) {
        return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : null;
    }
    function resolveHref(item) {
        const value = viewer === "member" && item.memberPath ? item.memberPath : item.path ?? item.href;
        if (!value)
            return composerHome.href;
        return new URL(value, composerHome).href;
    }
    function descriptionFor(item) {
        const base = viewer === "member" && item.memberDescription ? item.memberDescription : item.description;
        if (item.audience !== "invitation")
            return base;
        return base + (item.ownerOnly ? " Owner access required." : " Invitation required.");
    }
    function bindRow(entry) {
        entry.addEventListener("pointermove", event => { if (event.pointerType === "mouse")
            select(entry); });
        entry.querySelector("a")?.addEventListener("focus", () => select(entry));
    }
    function destinationRow(item) {
        const entry = document.createElement("li");
        entry.setAttribute("data-destination", "");
        entry.dataset.launcherGroup = item.group;
        entry.dataset.audience = item.audience;
        if (item.ownerOnly)
            entry.dataset.ownerOnly = "";
        if (item.catalogue)
            entry.dataset.catalogue = item.catalogue;
        entry.dataset.keywords = [item.keywords, ...(item.aliases ?? [])].join(" ");
        const link = document.createElement("a");
        link.href = resolveHref(item);
        const description = descriptionFor(item);
        if (item.image) {
            const image = document.createElement("img");
            image.src = new URL(item.image, assetBase).href;
            image.width = image.height = 40;
            image.alt = "";
            link.append(image);
        }
        else {
            const symbol = document.createElement("span");
            symbol.className = "task-icon";
            symbol.append(icon(taskIcons[item.icon ?? groupIcons[item.group]]));
            link.append(symbol);
        }
        const copy = document.createElement("span");
        const detail = document.createElement("small");
        detail.textContent = description;
        copy.append(document.createTextNode(item.name), detail);
        link.append(copy);
        const go = icon(["M5 12h14M14 7l5 5-5 5"]);
        go.classList.add("launcher-go");
        link.append(go);
        entry.append(link);
        rows.push({ entry, group: item.group, name: item.name, description, keywords: entry.dataset.keywords ?? "", aliases: (item.aliases ?? []).join(" "), order: rows.length, score: 0 });
        bindRow(entry);
        return entry;
    }
    // Older independent shells may author bare text + <small>. Give those rows
    // the same artwork, copy wrapper and arrow as registry rows without changing
    // the app-owned href or label.
    function normaliseAuthored(entry) {
        const link = entry.querySelector("a");
        if (!link)
            return;
        if (!link.querySelector("span:not(.task-icon)")) {
            const copy = document.createElement("span");
            copy.append(...[...link.childNodes].filter(node => node.nodeType === Node.TEXT_NODE || node instanceof HTMLElement && node.tagName === "SMALL"));
            link.append(copy);
        }
        if (!link.querySelector("img, .task-icon, svg")) {
            const symbol = document.createElement("span");
            symbol.className = "task-icon";
            symbol.append(icon(taskIcons.terminal));
            link.prepend(symbol);
        }
        if (!link.querySelector(".launcher-go")) {
            const go = icon(["M5 12h14M14 7l5 5-5 5"]);
            go.classList.add("launcher-go");
            link.append(go);
        }
    }
    function localRow(entry, group) {
        normaliseAuthored(entry);
        entry.dataset.launcherGroup = group;
        const text = (entry.textContent ?? "").replace(/\s+/g, " ").trim();
        rows.push({ entry, group, name: text, description: text, keywords: entry.dataset.keywords ?? "", aliases: "", order: rows.length, score: 0 });
        bindRow(entry);
    }
    // Authored destinations from independent shells are kept: their hrefs and
    // labels are app-owned. Composer no longer authors a duplicate list, so the
    // registry above is its only source. Legacy duplicates are removed.
    const authored = [...dialog.querySelectorAll("[data-destination]")];
    const localHrefs = new Set();
    for (const entry of authored) {
        const local = entry.dataset.localLauncherGroup;
        const pinned = entry.hasAttribute("data-launcher-pin");
        if (pinned) {
            const href = entry.querySelector("a")?.href;
            if (href)
                localHrefs.add(href);
            localRow(entry, "recents");
        }
        else if (local === "apps" || local === "studio" || local === "more" || local === "local") {
            const href = entry.querySelector("a")?.href;
            if (href)
                localHrefs.add(href);
            localRow(entry, local === "apps" ? "apps" : local === "local" ? "local" : "more");
        }
        else
            entry.remove();
    }
    if (list) {
        for (const item of visibleDestinations(destinations, viewer)) {
            if (localHrefs.has(resolveHref(item)))
                continue;
            destinationRow(item);
        }
    }
    function visibleEntries() {
        return [...(list?.querySelectorAll("li[data-destination]") ?? [])].filter(entry => !entry.hidden && entry.getClientRects().length > 0 && !entry.closest("details:not([open])"));
    }
    function rowsIn(group) {
        return rows.filter(row => row.group === group);
    }
    function headingRow(label, key) {
        const section = document.createElement("li");
        section.className = "launcher-section";
        if (key)
            section.dataset.section = key;
        const heading = document.createElement("h3");
        heading.textContent = label;
        section.append(heading);
        return section;
    }
    function noteRow(text) {
        const item = document.createElement("li");
        item.className = "launcher-recents-note";
        item.textContent = text;
        return item;
    }
    function moreSummaryCount() {
        return rowsIn("more").filter(row => !row.entry.hidden).length;
    }
    function renderDefaultLayout() {
        if (!list)
            return;
        layout = "default";
        list.replaceChildren();
        const recents = rowsIn("recents");
        if (recents.length || recentsNote) {
            list.append(headingRow("Recent projects", "recents"));
            if (recentsNote)
                list.append(noteRow(recentsNote));
            for (const row of recents)
                list.append(row.entry);
        }
        for (const group of groupOrder) {
            if (group === "more")
                continue;
            const groupRows = rowsIn(group);
            if (!groupRows.length)
                continue;
            list.append(headingRow(groupLabels[group], group));
            for (const row of groupRows)
                list.append(row.entry);
        }
        const local = rowsIn("local");
        if (local.length) {
            list.append(headingRow("This app", "local"));
            for (const row of local)
                list.append(row.entry);
        }
        const more = rowsIn("more");
        if (more.length) {
            const wrapper = document.createElement("li");
            wrapper.className = "launcher-more";
            const details = document.createElement("details");
            details.open = moreExpanded;
            details.addEventListener("toggle", () => { moreExpanded = details.open; });
            const summary = document.createElement("summary");
            summary.textContent = `More shortcuts (${moreSummaryCount()})`;
            const nested = document.createElement("ul");
            for (const row of more)
                nested.append(row.entry);
            details.append(summary, nested);
            wrapper.append(details);
            list.append(wrapper);
        }
    }
    function byScore(a, b) {
        const rank = (group) => group === "recents" ? -1 : group === "local" ? 5 : groupOrder.indexOf(group);
        return b.score - a.score || rank(a.group) - rank(b.group) || a.order - b.order;
    }
    function renderResultsLayout() {
        if (!list)
            return;
        layout = "results";
        list.replaceChildren(headingRow("Results", "results"));
        const matches = rows.filter(row => !row.entry.hidden).sort(byScore);
        for (const row of matches)
            list.append(row.entry);
    }
    function applyFilter() {
        const words = searchWords(search?.value ?? "");
        const query = words.length > 0;
        for (const row of rows) {
            row.score = query ? scoreText(row.name, row.description, row.keywords, row.aliases, words) : 0;
            row.entry.hidden = query && row.score < 0;
        }
        if (query && layout !== "results")
            renderResultsLayout();
        else if (query) {
            const matches = rows.filter(row => !row.entry.hidden).sort(byScore);
            for (const row of matches)
                list?.append(row.entry);
        }
        else if (layout !== "default")
            renderDefaultLayout();
        const summary = list?.querySelector(".launcher-more summary");
        if (summary)
            summary.textContent = `More shortcuts (${moreSummaryCount()})`;
        const count = rows.filter(row => !row.entry.hidden).length;
        const visible = visibleEntries();
        select(visible[0] ?? null);
        if (status)
            status.textContent = count
                ? query
                    ? `${count} ${count === 1 ? "result" : "results"}`
                    : `${count} ${count === 1 ? "destination" : "destinations"}`
                : "No matches. Try a task like “create site” or “check a link”.";
        if (dialog)
            dialog.dataset.empty = String(count === 0);
        if (list)
            list.scrollTop = 0;
    }
    function recentsRow(kind, label, description, href) {
        const path = safePath(href);
        if (!path)
            return null;
        const entry = document.createElement("li");
        entry.setAttribute("data-destination", "");
        entry.dataset.launcherPin = "";
        entry.dataset.recentKind = kind;
        entry.dataset.launcherGroup = "recents";
        entry.dataset.keywords = "recent project continue workspace published";
        const link = document.createElement("a");
        link.setAttribute("href", path);
        const symbol = document.createElement("span");
        symbol.className = "task-icon";
        symbol.append(icon(taskIcons[kind === "project" ? "recent" : kind === "published" ? "book" : "stacks"]));
        const copy = document.createElement("span");
        const detail = document.createElement("small");
        detail.textContent = description;
        copy.append(document.createTextNode(label), detail);
        const go = icon(["M5 12h14M14 7l5 5-5 5"]);
        go.classList.add("launcher-go");
        link.append(symbol, copy, go);
        entry.append(link);
        rows.push({ entry, group: "recents", name: label, description, keywords: entry.dataset.keywords ?? "", aliases: "", order: -1000 + rows.length, score: 0 });
        bindRow(entry);
        return entry;
    }
    function clearRecents() {
        for (const row of rowsIn("recents")) {
            if (!row.entry.hasAttribute("data-recent-kind"))
                continue;
            row.entry.remove();
        }
        for (let index = rows.length - 1; index >= 0; index -= 1) {
            if (rows[index].group === "recents" && rows[index].entry.hasAttribute("data-recent-kind"))
                rows.splice(index, 1);
        }
    }
    function showRecentsNote(text) {
        recentsNote = text;
        if (layout === "default")
            renderDefaultLayout();
    }
    function dateLabel(value) {
        const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
        if (!Number.isFinite(time))
            return "";
        return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(time));
    }
    function applyRecents(data) {
        clearRecents();
        const workspace = data && typeof data === "object" && data.workspace && typeof data.workspace.name === "string" ? data.workspace : null;
        const project = data && typeof data === "object" && data.project && typeof data.project.name === "string" ? data.project : null;
        let projectRow = false;
        if (project) {
            const action = typeof project.action === "string" ? project.action : "Continue editing";
            const label = action.startsWith("Finish") ? `${action}: ${project.name}` : `${action} ${project.name}`;
            const updated = dateLabel(project.updatedAt);
            const stateLabel = project.state === "published" ? "Published" : project.state === "draft" ? "Draft" : "Saved";
            const note = [stateLabel, updated ? `updated ${updated}` : ""].filter(Boolean).join(" · ");
            projectRow = Boolean(typeof project.href === "string" && recentsRow("project", label, note || "Saved project", project.href));
            if (typeof project.publishedHref === "string")
                recentsRow("published", "Open the published page", project.name, project.publishedHref);
        }
        if (workspace && typeof workspace.allHref === "string") {
            recentsRow("all", "All projects", `${workspace.name} workspace`, workspace.allHref);
            recentsState = projectRow ? "ready" : "empty";
            showRecentsNote(projectRow ? null : project ? "This saved project isn’t available. Open all projects instead." : `No saved projects in ${workspace.name} yet.`);
        }
        else if (!projectRow) {
            recentsState = "empty";
            showRecentsNote("No workspace yet.");
            recentsRow("apps", "Open My apps", "Join or create a workspace", "/me");
        }
        else {
            recentsState = "ready";
            showRecentsNote(null);
        }
        if (layout === "default")
            renderDefaultLayout();
        if (dialog)
            dialog.dataset.recents = recentsState;
        applyFilter();
    }
    async function loadRecents() {
        if (viewer !== "member" || !recentsEndpoint || recentsBusy)
            return;
        const target = new URL(recentsEndpoint, composerHome);
        if (target.origin !== composerHome.origin)
            return;
        recentsBusy = true;
        recentsState = "loading";
        if (dialog)
            dialog.dataset.recents = recentsState;
        if (!rowsIn("recents").length)
            showRecentsNote("Checking your recent projects…");
        try {
            const response = await fetch(target.href, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
            const data = response.ok ? await response.json() : null;
            if (!data || data.ok !== true)
                throw Error("unavailable");
            applyRecents(data);
        }
        catch {
            clearRecents();
            recentsState = "error";
            recentsNote = "Recent projects are unavailable.";
            recentsRow("all", "All projects", "Open your workspace projects", "/_emdash/admin/plugins/composer-stacks/stacks");
            if (layout === "default")
                renderDefaultLayout();
            if (dialog)
                dialog.dataset.recents = recentsState;
            applyFilter();
        }
        finally {
            recentsBusy = false;
        }
    }
    let activeEntry = null;
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
    function markCurrent() {
        if (dialog?.querySelector('[aria-current="page"]'))
            return;
        const path = (value) => value.replace(/\/$/, "") || "/";
        const here = new URL(location.href);
        for (const entry of dialog?.querySelectorAll("li[data-destination]") ?? []) {
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
        search.placeholder = "Create, edit, check, publish…";
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
        applyFilter();
        markCurrent();
        dialog.showModal();
        trigger?.setAttribute("aria-expanded", "true");
        (focusSearch ? search : closeButton)?.focus({ preventScroll: true });
        if (viewer === "member" && recentsEndpoint)
            void loadRecents();
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
            const visible = visibleEntries();
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
                    applyFilter();
                }
                return;
            }
        }
        if (event.key !== "Tab")
            return;
        const controls = [...dialog.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex="0"]')].filter(control => !control.matches(":disabled, [hidden]") && control.getClientRects().length > 0 && !control.closest("details:not([open])"));
        if (!controls.length)
            return;
        const index = controls.indexOf(document.activeElement);
        const next = event.shiftKey
            ? (index <= 0 ? controls.length - 1 : index - 1)
            : (index + 1) % controls.length;
        event.preventDefault();
        controls[next].focus();
    });
    // The shortcut enters search from an ordinary page control. It must not take
    // Cmd/Ctrl+K away from a form field, editor, another modal or a handler that
    // already consumed the key.
    document.addEventListener("keydown", event => {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
            return;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
            const target = event.target;
            const editable = target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
            if (editable && !dialog.open)
                return;
            if (!dialog.open) {
                const other = document.querySelector("dialog[open]");
                if (other && other !== dialog)
                    return;
                event.preventDefault();
                open(true);
            }
            else {
                event.preventDefault();
                search?.focus({ preventScroll: true });
            }
        }
    });
    search?.addEventListener("input", applyFilter);
    search?.addEventListener("keydown", event => {
        if (event.key !== "Enter" || event.isComposing || event.keyCode === 229)
            return;
        const first = (activeEntry ?? visibleEntries()[0])?.querySelector("a");
        if (first) {
            event.preventDefault();
            first.click();
        }
    });
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
    renderDefaultLayout();
    applyFilter();
    markCurrent();
    if (viewer === "member" && recentsEndpoint)
        recentsState = "idle";
    if (dialog)
        dialog.dataset.recents = recentsState;
})();
