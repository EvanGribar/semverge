// All interpolated values are escaped. Only this module's templates produce markup.
const safe = (html) => ({ html });
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const renderValue = (value) =>
  Array.isArray(value)
    ? value.map(renderValue).join("")
    : value && typeof value === "object" && "html" in value
      ? value.html
      : escape(value);
const html = (parts, ...values) =>
  safe(
    parts.reduce(
      (result, part, index) =>
        result +
        part +
        (index < values.length ? renderValue(values[index]) : ""),
      "",
    ),
  );
const paths = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  releases: "M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5",
  monitoring: "M2 12h4l3-8 6 16 3-8h4",
  incidents:
    "M12 8v5m0 4v.1M10.3 3.9 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  refresh: "M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2",
  github:
    "M9 19c-4 1-4-2-6-2m12 4v-4a3.5 3.5 0 0 0-1-2.7c3.3-.4 6.7-1.6 6.7-7.3A5.7 5.7 0 0 0 19.2 3c.1-1.1-.1-2.2-.6-3-1.1-.1-3.2 1.2-3.2 1.2a11 11 0 0 0-5.8 0S7.5-.1 6.4 0c-.5.8-.7 1.9-.6 3a5.7 5.7 0 0 0-1.5 4c0 5.7 3.4 6.9 6.7 7.3a3.5 3.5 0 0 0-1 2.7v4",
  book: "M4 3h6a3 3 0 0 1 3 3v15a4 4 0 0 0-4-3H4V3Zm9 3a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 3",
  logout: "M9 4H4v16h5m5-12 4 4-4 4m-5-4h12",
  back: "M19 12H5m6-6-6 6 6 6",
  check: "m5 12 4 4L19 6",
  clock: "M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  service: "M3 5h18v6H3zm0 10h18v6H3zM7 8h.1M7 18h.1",
};
const icon = (name) =>
  html`<svg
    class="icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="${paths[name] ?? paths.service}"></path>
  </svg>`;
const root = document.querySelector("#app"),
  notice = document.querySelector("#notice");
const pages = {
  overview: "Overview",
  releases: "Releases",
  monitoring: "Monitoring",
  incidents: "Incidents",
};
let state = null,
  authenticated = false,
  form = null,
  environment = "",
  query = "",
  incidentFilter = "active",
  busy = false,
  details = {},
  expandedHistories = new Set(),
  lastRefreshed = null,
  error = "";
const route = () => {
  const [page, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { page: pages[page] ? page : "overview", id };
};
const date = (value) =>
  new Date(value).toLocaleString(undefined, {
    year:
      new Date(value).getFullYear() === new Date().getFullYear()
        ? undefined
        : "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const observationDate = (value) =>
  new Date(value).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
const name = (collection, id) =>
  state[collection].find((item) => item.id === id)?.name ?? "Unknown";
const context = (item) =>
  `${name("services", item.serviceId)} / ${name("environments", item.environmentId)}`;
const matches = (item) => !environment || item.environmentId === environment;
const statusLabel = {
  up: "Passing",
  down: "Failing",
  unknown: "No recent check",
  paused: "Paused",
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  complete: "Recorded complete",
  pending: "In progress",
  failed: "Recorded failure",
};
const badge = (value, label = statusLabel[value] ?? value) =>
  html`<span class="status status-${value}"
    ><span aria-hidden="true"></span>${label}</span
  >`;
const releaseStatus = (release) =>
  release.failed
    ? "failed"
    : release.phase === "completed" && release.ready && release.published
      ? "complete"
      : "pending";
const monitorStatus = (monitor) =>
  state.statuses.find((item) => item.monitorId === monitor.id)?.status ??
  "unknown";
const button = (label, action, options = {}) =>
  html`<button
    class="${options.primary ? "button primary" : "button"}"
    type="button"
    data-action="${action}"
    ${options.id ? html`data-id="${options.id}"` : ""}
    ${busy ? html`disabled` : ""}
  >
    ${options.icon ? icon(options.icon) : ""}${label}
  </button>`;
const empty = (title, copy, label, action, glyph = "service", actionId = "") =>
  html`<div class="empty">
    ${icon(glyph)}
    <h3>${title}</h3>
    <p>${copy}</p>
    ${label
      ? button(label, action, {
          primary: true,
          icon: action === "incident-filter" ? "" : "plus",
          ...(actionId ? { id: actionId } : {}),
        })
      : ""}
  </div>`;
const options = (items, selected = "") =>
  items.map(
    (item) =>
      html`<option
        value="${item.id}"
        ${item.id === selected ? html`selected` : ""}
      >
        ${item.name}
      </option>`,
  );
const field = (label, input) => html`<label>${label}${input}</label>`;
const input = (label, key, type = "text", extra = "") =>
  field(label, html`<input name="${key}" type="${type}" ${extra} required />`);
const select = (label, key, items) =>
  field(
    label,
    html`<select name="${key}" required>
      <option value="">Choose ${label.toLowerCase()}</option>
      ${options(items)}
    </select>`,
  );

async function api(path, body, method = body === undefined ? "GET" : "POST") {
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (failure) {
    if (failure instanceof TypeError)
      throw new Error(
        "Could not reach the Semverge server. Check that it is running, then try again.",
      );
    throw failure;
  }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) authenticated = false;
    const failure = new Error(data.error ?? "Request failed. Try again.");
    failure.status = response.status;
    throw failure;
  }
  return data;
}
function notify(message, failure = false) {
  notice.textContent = message;
  notice.classList.toggle("notice-error", failure);
  notice.hidden = false;
  notice.setAttribute("role", failure ? "alert" : "status");
  clearTimeout(notify.timer);
  if (!failure)
    notify.timer = setTimeout(() => {
      notice.hidden = true;
    }, 5000);
}
function clearFailureNotice() {
  if (!notice.classList.contains("notice-error")) return;
  clearTimeout(notify.timer);
  notice.textContent = "";
  notice.classList.remove("notice-error");
  notice.hidden = true;
  notice.setAttribute("role", "status");
}
async function load(quiet = false) {
  const interactionAtStart = lastInteractionAt;
  try {
    state = await api("state");
    authenticated = true;
    lastRefreshed = Date.now();
    error = "";
    clearFailureNotice();
    const { page, id } = route();
    if (id && page === "monitoring")
      details[id] = await api(`monitors/${id}/checks`);
    if (id && page === "incidents")
      details[id] = await api(`incidents/${id}/timeline`);
    if (!quiet || interactionAtStart === lastInteractionAt)
      render({ preserveFocus: true });
  } catch (failure) {
    error = failure.status === 401 ? "" : failure.message;
    if (!quiet || interactionAtStart === lastInteractionAt)
      render({ preserveFocus: true });
    if (quiet && authenticated) notify(error, true);
  }
}
function login() {
  return html`<main id="content" class="login-layout">
    <section class="login-story">
      <a class="brand" href="#/overview"
        ><img src="/mark.svg" alt="" width="34" height="34" />semverge</a
      >
      <div class="login-thesis">
        <h1>From what shipped.<br />To what happens next.</h1>
        <p>
          Release evidence, service monitoring, and incident response. One
          connected workspace for the software you operate.
        </p>
        <div class="brand-study" aria-hidden="true">
          <img src="/signal.svg" alt="" width="720" height="200" />
        </div>
        <div class="login-path">
          <span>${icon("releases")}Release</span
          ><span>${icon("monitoring")}Observe</span
          ><span>${icon("incidents")}Respond</span>
        </div>
      </div>
      <p class="login-footer">Open source. Self hosted. Yours to operate.</p>
    </section>
    <section class="login-form">
      <form data-form="login">
        <img src="/mark.svg" alt="" width="42" height="42" />
        <h2>Open your workspace</h2>
        <p>Sign in with the operator token configured on your server.</p>
        ${field(
          "Operator token",
          html`<input
            name="token"
            type="password"
            autocomplete="current-password"
            minlength="32"
            required
            autofocus
          />`,
        )}
        ${error ? html`<p class="inline-error" role="alert">${error}</p>` : ""}
        <button
          class="button primary"
          type="submit"
          ${busy ? html`disabled` : ""}
        >
          ${busy ? "Signing in…" : "Sign in"}${icon("arrow")}
        </button>
        <p class="form-help">
          A single-operator workspace. Your token stays on this origin; it is
          never sent to a third-party service.
        </p>
        <a
          class="text-link"
          href="https://github.com/EvanGribar/semverge/blob/main/platform/README.md"
          target="_blank"
          rel="noreferrer"
          >Setup documentation ${icon("arrow")}</a
        >
      </form>
    </section>
  </main>`;
}
function shell(content) {
  const { page } = route();
  const activeCount = state.incidents.filter(
    (item) => item.status !== "resolved",
  ).length;
  return html`<div class="workspace">
    <aside class="sidebar">
      <a class="brand" href="#/overview"
        ><img src="/mark.svg" alt="" width="30" height="30" />semverge</a
      >
      <div class="workspace-label">
        <span class="workspace-avatar">W</span>
        <div>My workspace<small>Self-hosted foundation</small></div>
      </div>
      <nav aria-label="Main navigation">
        ${Object.entries(pages).map(
          ([key, label]) =>
            html`<a
              href="#/${key}"
              ${key === page ? html`aria-current="page"` : ""}
              >${icon(key)}<span>${label}</span>${key === "incidents" &&
              activeCount
                ? html`<span class="nav-count">${activeCount}</span>`
                : ""}</a
            >`,
        )}
      </nav>
      <div class="sidebar-bottom">
        <a
          href="https://github.com/EvanGribar/semverge/blob/main/platform/README.md"
          target="_blank"
          rel="noreferrer"
          >${icon("book")}Documentation</a
        ><a
          href="https://github.com/EvanGribar/semverge"
          target="_blank"
          rel="noreferrer"
          >${icon("github")}GitHub</a
        ><button type="button" data-action="logout">
          ${icon("logout")}Sign out
        </button>
        <div class="operator">
          <span class="operator-avatar">O</span>
          <div>Workspace operator<small>Single operator access</small></div>
        </div>
      </div>
    </aside>
    <div class="main-column">
      <header class="context-bar">
        <span
          >Workspace <span class="slash">/</span>
          <strong>${pages[page]}</strong></span
        ><span class="runtime-label">Self hosted</span>
      </header>
      <main id="content" tabindex="-1">
        ${error
          ? html`<div class="error-banner" role="alert">
              ${error} ${button("Try again", "refresh")}
            </div>`
          : ""}${content}
      </main>
      <footer class="workspace-footer">
        <span
          >${lastRefreshed
            ? `Updated ${new Date(lastRefreshed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
            : "Waiting for observations"}
          · Refreshes every 10s</span
        ><span>One workspace · 30-day check retention</span>
      </footer>
    </div>
  </div>`;
}
function pageHead(title, copy, action, label) {
  return html`<div class="page-heading">
    <div>
      <h1 tabindex="-1">${title}</h1>
      <p>${copy}</p>
    </div>
    <div class="heading-actions">
      ${action
        ? button(label, action, { primary: true, icon: "plus" })
        : ""}${button("Refresh", "refresh", { icon: "refresh" })}
    </div>
  </div>`;
}
function scopeBar(searchLabel) {
  return html`<div class="scope-bar">
    ${field(
      "Environment",
      html`<select id="environment-scope">
        <option value="">All environments</option>
        ${options(state.environments, environment)}
      </select>`,
    )}${searchLabel
      ? field(
          searchLabel,
          html`<input
            id="search"
            type="search"
            placeholder="Search"
            value="${query}"
          />`,
        )
      : ""}<span class="scope-note"
      >${state.worker.lastTickAt && Date.now() - state.worker.lastTickAt < 10000
        ? "Worker active"
        : "Worker not observed recently"}</span
    >
  </div>`;
}
function formPanel() {
  if (!form) return "";
  const titles = {
    application: "New application",
    service: "New service",
    environment: "New environment",
    monitor: "New monitor",
    release: "Import release",
    incident: "Report incident",
  };
  const prerequisite =
    ["service", "monitor", "release", "incident"].includes(form) &&
    !state.applications.length
      ? ["Create an application first.", "application"]
      : ["monitor", "release", "incident"].includes(form) &&
          !state.services.length
        ? ["Create a service first.", "service"]
        : ["monitor", "release", "incident"].includes(form) &&
            !state.environments.length
          ? ["Create an environment first.", "environment"]
          : null;
  let fields = "";
  if (form === "application") fields = input("Application name", "name");
  if (form === "environment") fields = input("Environment name", "name");
  if (form === "service")
    fields = html`${select(
      "Application",
      "applicationId",
      state.applications,
    )}${input("Service name", "name")}`;
  const contextFields = html`${select(
    "Service",
    "serviceId",
    state.services.map((service) => ({
      ...service,
      name: `${name("applications", service.applicationId)} / ${service.name}`,
    })),
  )}${select("Environment", "environmentId", state.environments)}`;
  if (form === "monitor")
    fields = html`${input("Monitor name", "name")}${contextFields}${field(
        "Endpoint URL",
        html`<input
            name="url"
            type="url"
            placeholder="https://your-service.com/health"
            required
          /><small
            >Public HTTPS, no credentials or query
            strings.${state.localMonitoringEnabled
              ? " Local HTTP checks are explicitly enabled for 127.0.0.1."
              : ""}</small
          >`,
      )}
      <div class="form-grid">
        ${field(
          "Interval (seconds)",
          html`<input
            name="intervalSeconds"
            type="number"
            min="30"
            max="86400"
            value="60"
            required
          />`,
        )}${field(
          "Expected HTTP status",
          html`<input
            name="expectedStatus"
            type="number"
            min="200"
            max="299"
            value="200"
            required
          />`,
        )}
      </div>
      <p class="form-help">
        Checks run from this server. Two consecutive failures open an incident;
        the next passing check records recovery.
      </p>`;
  if (form === "release")
    fields = html`${contextFields}${field(
        "Transaction JSON file (optional)",
        html`<input
          type="file"
          name="releaseFile"
          accept="application/json,.json"
        />`,
      )}${field(
        "Transaction JSON",
        html`<textarea
          name="transaction"
          rows="8"
          placeholder="Paste the transaction object from the Action output or semverge-progress marker"
          required
          spellcheck="false"
        ></textarea>`,
      )}
      <p class="form-help">
        Imports recorded release evidence. Service and environment are your
        associations; importing does not publish or verify a deployment.
        Free-form error text and event targets are omitted.
      </p>`;
  if (form === "incident")
    fields = html`${input("Incident title", "title")}${contextFields}
      <p class="form-help">
        Report an operational problem. You can acknowledge it, add investigation
        notes and explicitly link release evidence after creation.
      </p>`;
  return html`<section class="form-panel" aria-labelledby="form-title">
    <div class="panel-title">
      <h2 id="form-title" tabindex="-1">${titles[form]}</h2>
      ${button("Cancel", "cancel")}
    </div>
    ${prerequisite
      ? html`<p>${prerequisite[0]}</p>
          ${button("Continue setup", prerequisite[1], { primary: true })}`
      : html`<form data-form="${form}">
          ${fields}
          <div class="form-actions">
            <button
              class="button primary"
              type="submit"
              ${busy ? html`disabled` : ""}
            >
              ${busy
                ? "Saving…"
                : form === "release"
                  ? "Import release"
                  : form === "incident"
                    ? "Report incident"
                    : `Create ${form}`}${icon("arrow")}
            </button>
          </div>
        </form>`}
  </section>`;
}
function releaseRows(releases, compact = false) {
  return releases.map(
    (release) =>
      html`<a class="record-row" href="#/releases/${release.id}"
        ><span class="row-symbol">${icon("releases")}</span
        ><span class="record-main"
          ><strong>${release.version}</strong
          ><small>${context(release)}</small></span
        >${compact ? "" : html`<span class="release-row-evidence"><small>Recorded phase</small><strong>${release.phase}</strong><small>Commit ${release.sourceCommit.slice(0, 7)}</small></span>`}
        <span class="record-end"
          >${badge(releaseStatus(release))}${compact
            ? ""
            : html`<small>${date(release.sourceUpdatedAt)}</small>`}</span
        >${icon("arrow")}</a
      >`,
  );
}
function incidentRows(incidents) {
  return incidents.map((incident) => {
    const linkedRelease = state.releases.find((release) => release.id === incident.releaseId);
    const incidentTime =
      incident.status === "resolved" && incident.resolvedAt
        ? incident.resolvedAt
        : incident.createdAt;
    const incidentTimeLabel =
      incident.status === "resolved" && incident.resolvedAt
        ? "Resolved at"
        : "Opened at";
    const incidentTimeText =
      incident.status === "resolved" && incident.resolvedAt
        ? date(incidentTime)
        : `Opened ${date(incidentTime)}`;
    return html`<a class="record-row" href="#/incidents/${incident.id}"
        ><span class="row-symbol incident-symbol">${icon("incidents")}</span
        ><span class="record-main"
          ><strong>${incident.title}</strong
          ><small
            >${context(incident)} · ${incident.owner ?? "Unassigned"}${linkedRelease ? ` · Linked release ${linkedRelease.version}` : ""}</small
          ></span
        ><span class="record-end"
          >${badge(incident.status)}<small
            aria-label="${incidentTimeLabel} ${date(incidentTime)}"
            >${incidentTimeText}</small
          ></span
        >${icon("arrow")}</a
      >`;
  });
}
function overview() {
  const monitors = state.monitors.filter(matches),
    statuses = monitors.map(monitorStatus),
    failures = statuses.filter((item) => item === "down").length,
    unknown = statuses.filter((item) => item === "unknown").length;
  const incidents = state.incidents
      .filter(matches)
      .filter((item) => item.status !== "resolved"),
    releases = state.releases.filter(matches);
  const catalog = state.applications.map((application) => {
    const services = state.services.filter(
      (service) =>
        service.applicationId === application.id &&
        service.name.toLowerCase().includes(query.toLowerCase()),
    );
    return html`<section class="application-group">
      <div class="application-title">
        <span class="app-monogram"
          >${application.name.charAt(0).toUpperCase()}</span
        >
        <h3>${application.name}</h3>
        <span
          >${services.length}
          ${services.length === 1 ? "service" : "services"}</span
        >
      </div>
      ${services.length
        ? html`<div class="service-ledger">

                ${services.flatMap((service) => {
                  const environmentIds = [
                    ...new Set(
                      [...state.monitors, ...state.releases, ...state.incidents]
                        .filter(
                          (item) =>
                            item.serviceId === service.id && matches(item),
                        )
                        .map((item) => item.environmentId),
                    ),
                  ];
                  if (!environmentIds.length)
                    return html`<article class="service-ledger-row">
                      <div data-label="Service">
                        <strong>${service.name}</strong>
                      </div>
                      <div class="muted" data-label="Context">
                        ${environment
                          ? "No records in this environment"
                          : "No environment linked yet"}
                      </div>
                      <div data-label="Monitoring">
                        ${button("Add monitor", "monitor")}
                      </div>
                    </article>`;
                  return environmentIds.map((environmentId) => {
                    const checks = monitors.filter(
                      (monitor) =>
                        monitor.serviceId === service.id &&
                        monitor.environmentId === environmentId,
                    );
                    const states = checks.map(monitorStatus),
                      status = states.includes("down")
                        ? "down"
                        : states.includes("unknown")
                          ? "unknown"
                          : states.includes("paused")
                            ? "paused"
                            : states.length
                              ? "up"
                              : "unknown";
                    const representativeCheck = checks.find((monitor) => monitorStatus(monitor) === status) ?? checks[0];
                    const release = releases.find(
                        (item) =>
                          item.serviceId === service.id &&
                          item.environmentId === environmentId,
                      ),
                      active = incidents.filter(
                        (item) =>
                          item.serviceId === service.id &&
                          item.environmentId === environmentId,
                      );
                    return html`<article class="service-ledger-row">
                      <div data-label="Service">
                        <strong>${service.name}</strong
                        ><small
                          >${checks.length}
                          ${checks.length === 1 ? "monitor" : "monitors"}</small
                        >
                      </div>
                      <div data-label="Environment">
                        ${name("environments", environmentId)}
                      </div>
                      <div data-label="Endpoint status">
                        ${representativeCheck
                          ? html`<a
                              class="plain-link"
                              href="#/monitoring/${representativeCheck.id}"
                              >${badge(status)}</a
                            >`
                          : badge("unknown", "No monitor")}
                      </div>
                      <div data-label="Latest release">
                        ${release
                          ? html`<a
                              class="version-link"
                              href="#/releases/${release.id}"
                              >${release.version}</a
                            >`
                          : html`<span class="muted"
                              >No release imported</span
                            >`}
                      </div>
                      <div data-label="Incidents">
                        ${active[0]
                          ? html`<a
                              class="incident-link"
                              href="#/incidents/${active[0].id}"
                              >${active.length} active</a
                            >`
                          : html`<span class="muted">None open</span>`}
                      </div>
                    </article>`;
                  });
                })}
          </div>`
        : html`<div class="group-empty">
            <p>
              ${query
                ? "No matching services in this application."
                : "Add a service to start connecting releases and observations."}
            </p>
            ${button("Add service", "service", { icon: "plus" })}
          </div>`}
    </section>`;
  });
  return html`${pageHead(
      "Overview",
      "The software you ship. The services you operate.",
      "application",
      "New application",
    )}${scopeBar("Find a service")}${formPanel()}
    <section class="observation-summary">
      <span class="summary-icon ${failures ? "attention" : ""}"
        >${icon(failures ? "incidents" : "monitoring")}</span
      >
      <div>
        <h2>
          ${!monitors.length
            ? "Start observing your services"
            : failures
              ? `${failures} ${failures === 1 ? "monitor needs" : "monitors need"} attention`
              : unknown
                ? "Some services need a recent observation"
                : statuses.every((status) => status === "paused")
                  ? "Monitoring is paused"
                  : "No failing checks in the current observations"}
        </h2>
        <p>
          ${!monitors.length
            ? "Add an endpoint to collect real checks and build operational history."
            : `${monitors.length} ${monitors.length === 1 ? "monitor" : "monitors"} · ${statuses.filter((status) => status === "up").length} passing · ${unknown} without a recent check · ${statuses.filter((status) => status === "paused").length} paused · ${incidents.length} active ${incidents.length === 1 ? "incident" : "incidents"}`}
        </p>
      </div>
      ${button(
        monitors.length ? "View monitoring" : "Add a monitor",
        monitors.length ? "goto-monitoring" : "monitor",
        { icon: "arrow" },
      )}
    </section>
    ${incidents.length
      ? html`<section class="overview-attention" aria-labelledby="attention-heading">
          <div class="section-heading"><h2 id="attention-heading">Needs attention</h2><a class="text-link" href="#/incidents">All incidents ${icon("arrow")}</a></div>
          ${incidentRows(incidents.slice(0, 3))}
        </section>`
      : ""}
    <div class="section-heading">
      <h2>Applications</h2>
      <div class="section-actions">
        ${button("Add service", "service", { icon: "plus" })}${button(
          "Add environment",
          "environment",
          { icon: "plus" },
        )}
      </div>
    </div>
    ${catalog.length
      ? html`<div class="catalog">${catalog}</div>`
      : empty(
          "Start with an application",
          "Group the services you operate. Then connect an environment, a monitor and the releases behind it.",
          "Create application",
          "application",
        )}
    <div class="overview-bottom">
      <section class="record-section">
        <div class="section-heading">
          <h2>Recent releases</h2>
          <a class="text-link" href="#/releases">View all ${icon("arrow")}</a>
        </div>
        ${releases.length
          ? releaseRows(releases.slice(0, 4), true)
          : html`<div class="quiet-empty">
              <h3>Bring your release history into view</h3>
              <p>
                Import a Semverge transaction to connect its source commit and
                progress to a service.
              </p>
              ${button("Import release", "release")}
            </div>`}
      </section>
      ${!incidents.length ? html`      <section class="record-section">
        <div class="section-heading">
          <h2>Active incidents</h2>
          <a class="text-link" href="#/incidents">View all ${icon("arrow")}</a>
        </div>
        ${incidents.length
          ? incidentRows(incidents.slice(0, 3))
          : html`<div class="quiet-empty">
              <h3>No open incidents</h3>
              <p>
                Monitor failures and manually reported problems appear here. No
                incident is created until there is an observation or a report.
              </p>
              ${button("Report incident", "incident")}
            </div>`}
      </section>` : ""}
    </div>`;
}
function releasesPage(id) {
  if (id) {
    const release = state.releases.find((item) => item.id === id);
    if (!release)
      return empty(
        "Release not found",
        "Return to the release list or import its transaction record.",
        "View releases",
        "goto-releases",
      );
    const phases = [
        "planned",
        "approved",
        "prepared",
        "built",
        "published",
        "verified",
        "completed",
      ],
      current = phases.indexOf(release.phase),
      events = JSON.parse(release.events);
    return html`<a class="back-link" href="#/releases"
        >${icon("back")}All releases</a
      >${pageHead(release.version, context(release))}
      <div class="detail-status">
        ${badge(releaseStatus(release))}<span
          >Imported transaction evidence</span
        >
      </div>
      <div class="release-evidence" aria-label="Imported transaction flags">
        <div><span>Readiness</span><strong>${release.ready ? "Recorded ready" : "Not recorded ready"}</strong></div>
        <div><span>Publication</span><strong>${release.published ? "Recorded published" : "Not recorded published"}</strong></div>
        <div><span>Failure</span><strong>${release.failed ? "Recorded failure" : "No failure recorded"}</strong></div>
      </div>
      <div class="detail-grid">
        <section class="detail-main">
          <div class="section-heading">
            <h2>Recorded progress</h2>
            <span class="muted">${release.phase}</span>
          </div>
          <p class="form-help phase-inference">
            Earlier phase markers are inferred from the recorded phase; event details below are imported as-is.
          </p>
          <ol class="phase-list">
            ${phases.map(
              (phase, index) =>
                html`<li
                  class="${index < current
                    ? "phase-past"
                    : index === current
                      ? "phase-current"
                      : ""}"
                >
                  <span>${index < current ? "—" : index + 1}</span>${phase}
                </li>`,
            )}
          </ol>
          <div class="section-heading">
            <h2>Transaction events</h2>
            <span class="muted">${events.length} recorded</span>
          </div>
          ${events.length
            ? html`<ol class="event-list">
                ${events.map(
                  (event) =>
                    html`<li>
                      <span
                        class="event-node ${event.status === "failed"
                          ? "node-failed"
                          : ""}"
                      ></span>
                      <div>
                        <strong>${event.kind.replaceAll("-", " ")}</strong>
                        <p>
                          ${event.phase} · ${event.status} · attempt
                          ${event.attempt}
                        </p>
                      </div>
                      <time>${date(event.at)}</time>
                    </li>`,
                )}
              </ol>`
            : html`<p class="quiet-empty">
                No transaction events were recorded in this import.
              </p>`}
        </section>
        <aside class="detail-aside">
          <h2>Release context</h2>
          <dl>
            <dt>Service</dt>
            <dd>${name("services", release.serviceId)}</dd>
            <dt>Environment association</dt>
            <dd>${name("environments", release.environmentId)}</dd>
            <dt>Source commit</dt>
            <dd><code>${release.sourceCommit}</code></dd>
            <dt>Transaction</dt>
            <dd><code>${release.transactionId}</code></dd>
            <dt>Source updated</dt>
            <dd>${date(release.sourceUpdatedAt)}</dd>
            <dt>Imported</dt>
            <dd>${date(release.importedAt)}</dd>
          </dl>
          ${state.incidents.some((incident) => incident.releaseId === release.id)
            ? html`<div class="context-note"><h3>Linked investigations</h3>
                ${incidentRows(state.incidents.filter((incident) => incident.releaseId === release.id))}
                <p>These links record associations, not verified causes.</p></div>`
            : ""}
          <div class="context-note">
            <h3>Keep the release engine in control</h3>
            <p>
              Use the existing CLI and GitHub Action for plans, readiness,
              publication, verification and recovery. This view reports imported
              state; it does not establish a deployment or current provider
              health.
            </p>
            <a
              class="text-link"
              href="https://github.com/EvanGribar/semverge#local-cli"
              target="_blank"
              rel="noreferrer"
              >CLI documentation ${icon("arrow")}</a
            >
          </div>
        </aside>
      </div>`;
  }
  const records = state.releases
    .filter(matches)
    .filter((item) =>
      `${item.version} ${context(item)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  return html`${pageHead(
      "Releases",
      "What shipped, the commit behind it, and the evidence recorded along the way.",
      "release",
      "Import release",
    )}${scopeBar("Find a release")}${formPanel()}
    <div class="list-caption">
      Imported transaction records
      <span>${records.length} shown · latest 1,000 available</span>
    </div>
    ${records.length
      ? html`<div class="record-list">${releaseRows(records)}</div>`
      : empty(
          "Connect your first release",
          "Import an existing Semverge transaction. Versioning, readiness and publication stay with your existing release workflow.",
          "Import release",
          "release",
          "releases",
        )}`;
}
function monitoringPage(id) {
  if (id) {
    const monitor = state.monitors.find((item) => item.id === id);
    if (!monitor)
      return empty(
        "Monitor not found",
        "Choose a monitor from the list.",
        "View monitoring",
        "goto-monitoring",
      );
    const checks = details[id] ?? [],
      historyExpanded = expandedHistories.has(id),
      visibleChecks = historyExpanded ? checks : checks.slice(0, 10),
      latest = checks[0],
      chronological = [...checks].reverse(),
      maxLatency = Math.max(1, ...checks.map((check) => check.latencyMs ?? 0)),
      observationMarks = chronological.flatMap((check, index) => {
        const previous = chronological[index - 1];
        const elapsed = previous
          ? new Date(check.checkedAt).getTime() - new Date(previous.checkedAt).getTime()
          : 0;
        // A gap indicates an interval without a retained observation; it does not
        // assert why checks are missing or invent the number that were missed.
        const gap = elapsed > monitor.intervalSeconds * 1500;
        return [
          ...(gap ? [html`<span class="observation-gap" title="Unobserved interval between retained checks" aria-label="Unobserved interval"></span>`] : []),
          html`<span class="observation-bar observation-${check.outcome} height-${Math.max(1, Math.ceil(((check.latencyMs ?? 0) / maxLatency) * 20))}"
            title="${observationDate(check.checkedAt)} · ${check.outcome} · ${check.latencyMs ?? "unknown"} ms · HTTP ${check.statusCode ?? "unavailable"}"
            aria-label="${observationDate(check.checkedAt)}: ${check.outcome}, ${check.latencyMs ?? "unknown"} milliseconds"></span>`,
        ];
      });
    return html`<a class="back-link" href="#/monitoring"
        >${icon("back")}All monitors</a
      >${pageHead(monitor.name, context(monitor))}
      <div class="detail-status">
        ${badge(monitorStatus(monitor))}<span>${monitor.url}</span>
      </div>
      <div class="detail-toolbar">
        ${button("Run check", "run-check", {
          primary: true,
          id,
          icon: "refresh",
        })}${button(
          monitor.paused ? "Resume monitor" : "Pause monitor",
          "pause-monitor",
          { id },
        )}<span class="muted"
          >Checks every ${monitor.intervalSeconds}s · expected HTTP
          ${monitor.expectedStatus}</span
        >
      </div>
      ${state.incidents.some((incident) => incident.monitorId === id)
        ? html`<section class="record-section">
            <div class="section-heading"><h2>Connected incidents</h2></div>
            ${incidentRows(
              state.incidents.filter((incident) => incident.monitorId === id),
            )}
          </section>`
        : ""}
      <section class="observation-panel">
        <div class="section-heading">
          <h2>Recent observations</h2>
          <span class="muted">Showing ${visibleChecks.length} of ${checks.length} retained observations</span>
        </div>
        ${checks.length
          ? html`<div class="observation-chart" role="img" aria-label="Response durations for retained checks, oldest to newest. Hatched marks indicate unobserved intervals.">
                ${observationMarks}
              </div>
              <div class="history-caption">
                <span>Oldest: ${observationDate(checks.at(-1).checkedAt)} · Latest: ${observationDate(latest.checkedAt)}</span>
                <span>Scale: 0–${maxLatency} ms</span>
              </div>
              <p class="chart-legend">Bar height shows recorded response duration · failure is marked in red · hatching marks gaps over 1.5 times the configured interval · spacing is not proportional to elapsed time</p>`
          : html`<p class="quiet-empty">
              No observations yet. Run a check now or wait for the worker.
            </p>`}
        <p class="form-help">
          Actual observations from this server, not an uptime percentage. Missed
          checks are not backfilled; response bodies are not stored.
        </p>
      </section>
      ${checks.length > 10
        ? html`<div class="history-controls">
            <span class="form-help">${historyExpanded ? "All retained observations are visible." : "Showing the 10 most recent observations."}</span>
            ${button(
              historyExpanded ? "Show latest 10" : `Show all ${checks.length} observations`,
              "toggle-history",
              { id },
            )}
          </div>`
        : ""}
      <div class="table-wrap">
        <table class="monitor-history">
          <thead>
            <tr>
              <th>Checked at</th>
              <th>Outcome</th>
              <th>HTTP</th>
              <th>Duration</th>
              <th>Observation</th>
            </tr>
          </thead>
          <tbody>
            ${visibleChecks.map(
              (check) =>
                html`<tr>
                  <td data-label="Checked at">${observationDate(check.checkedAt)}</td>
                  <td data-label="Outcome">${badge(check.outcome)}</td>
                  <td class="numeric" data-label="HTTP">${check.statusCode ?? "—"}</td>
                  <td class="numeric" data-label="Duration">${check.latencyMs} ms</td>
                  <td data-label="Observation">${check.reason}</td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
      `;
  }
  const monitors = state.monitors
    .filter(matches)
    .filter((item) =>
      `${item.name} ${context(item)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  return html`${pageHead(
      "Monitoring",
      "Real endpoint checks. Recorded results. A clear path when something fails.",
      "monitor",
      "New monitor",
    )}${scopeBar("Find a monitor")}${formPanel()}
    <div class="list-caption">
      Endpoint monitors
      <span>${monitors.length} monitors · one check location</span>
    </div>
    ${monitors.length
      ? html`<div class="record-list">
          ${monitors.map((monitor) => {
            const check = state.observations.find(
              (item) => item.monitorId === monitor.id,
            );
            return html`<a
              class="record-row monitor-row"
              href="#/monitoring/${monitor.id}"
              ><span class="row-symbol">${icon("monitoring")}</span
              ><span class="record-main"
                ><strong>${monitor.name}</strong
                ><small>${context(monitor)}</small
                ><small class="endpoint">${monitor.url}</small></span
              ><span class="monitor-timing"
                >${check
                  ? html`<strong class="numeric">${check.latencyMs} ms</strong
                      ><small>${observationDate(check.checkedAt)}</small>`
                  : html`<small>Awaiting first check</small>`}</span
              ><span class="record-end"
                >${badge(monitorStatus(monitor))}<small
                  >Every ${monitor.intervalSeconds}s</small
                ></span
              >${icon("arrow")}</a
            >`;
          })}
        </div>`
      : empty(
          "Add your first endpoint monitor",
          "Add a public HTTPS endpoint. Every check records a real result; repeated failures create a connected incident.",
          "Add a monitor",
          "monitor",
          "monitoring",
        )}`;
}
function incidentsPage(id) {
  if (id) {
    const incident = state.incidents.find((item) => item.id === id);
    if (!incident)
      return empty(
        "Incident not found",
        "Return to the incident list.",
        "View incidents",
        "goto-incidents",
      );
    const timeline = details[id] ?? [],
      releases = state.releases.filter(
        (release) =>
          release.serviceId === incident.serviceId &&
          release.environmentId === incident.environmentId,
      ),
      linked = state.releases.find(
        (release) => release.id === incident.releaseId,
      );
    return html`<a class="back-link" href="#/incidents"
        >${icon("back")}All incidents</a
      >${pageHead(incident.title, context(incident))}
      <div class="detail-status">
        ${badge(incident.status)}<span
          >Opened
          ${date(incident.createdAt)}${incident.resolvedAt
            ? ` · Resolved ${date(incident.resolvedAt)}`
            : ""}</span
        >
      </div>
      <div class="detail-grid">
        <section class="detail-main">
          <div class="section-heading">
            <h2>Incident timeline</h2>
            <span class="muted">${timeline.length} entries</span>
          </div>
          <ol class="event-list incident-timeline">
            ${timeline.map(
              (entry) =>
                html`<li>
                  <span
                    class="event-node ${entry.kind === "recovered" ||
                    entry.kind === "resolved"
                      ? "node-resolved"
                      : ""}"
                  ></span>
                  <div>
                    <strong>${entry.kind.replaceAll("-", " ")}</strong>
                    <p>${entry.message}</p>
                  </div>
                  <time>${date(entry.createdAt)}</time>
                </li>`,
            )}
          </ol>
          <form class="inline-form note-form" data-form="note" data-id="${id}">
            ${field(
              "Add investigation note",
              html`<textarea
                name="message"
                rows="3"
                maxlength="2000"
                required
                placeholder="What have you observed? What will you check next?"
              ></textarea>`,
            )}<button
              class="button"
              type="submit"
              ${busy ? html`disabled` : ""}
            >
              Add note
            </button>
          </form>
        </section>
        <aside class="detail-aside">
          <h2>Response</h2>
          <dl>
            <dt>Owner</dt>
            <dd>${incident.owner ?? "Unassigned"}</dd>
            <dt>Service</dt>
            <dd>${name("services", incident.serviceId)}</dd>
            <dt>Environment</dt>
            <dd>${name("environments", incident.environmentId)}</dd>
            <dt>Detection</dt>
            <dd>
              ${incident.monitorId
                ? html`<a
                    class="text-link"
                    href="#/monitoring/${incident.monitorId}"
                    >View monitor ${icon("arrow")}</a
                  >`
                : "Manually reported"}
            </dd>
            <dt>Release association</dt>
            <dd>
              ${linked
                ? html`<a class="version-link" href="#/releases/${linked.id}"
                    >${linked.version}</a
                  >`
                : "No release linked"}
            </dd>
          </dl>
          ${incident.status !== "resolved"
            ? html`<form
                  class="inline-form"
                  data-form="acknowledge"
                  data-id="${id}"
                >
                  ${field(
                    "Assign and acknowledge",
                    html`<input
                      name="owner"
                      value="${incident.owner ?? ""}"
                      placeholder="Your name"
                      maxlength="100"
                      required
                    />`,
                  )}<button
                    class="button"
                    type="submit"
                    ${busy ? html`disabled` : ""}
                  >
                    Acknowledge
                  </button>
                </form>
                <form class="inline-form" data-form="resolve" data-id="${id}">
                  ${field(
                    "Resolution note",
                    html`<textarea
                      name="message"
                      rows="3"
                      maxlength="2000"
                      placeholder="What changed, and how did you verify it?"
                      required
                    ></textarea>`,
                  )}<button
                    class="button"
                    type="submit"
                    ${busy ? html`disabled` : ""}
                  >
                    Resolve incident
                  </button>
                </form>`
            : html`<div class="context-note">
                <h3>Resolution is recorded</h3>
                <p>
                  The timeline distinguishes an operator resolution from a
                  passing monitor observation.
                </p>
              </div>`}${releases.length
            ? html`<form
                class="inline-form"
                data-form="link-release"
                data-id="${id}"
              >
                ${field(
                  "Associate release evidence",
                  html`<select name="releaseId" required>
                    <option value="">Choose a release</option>
                    ${releases.map(
                      (release) =>
                        html`<option value="${release.id}">
                          ${release.version} ·
                          ${release.sourceCommit.slice(0, 7)}
                        </option>`,
                    )}
                  </select>`,
                )}<button
                  class="button"
                  type="submit"
                  ${busy ? html`disabled` : ""}
                >
                  Link release
                </button>
                <p class="form-help">
                  Association records your investigation context. It does not
                  establish the cause.
                </p>
              </form>`
            : ""}
        </aside>
      </div>`;
  }
  const incidents = state.incidents
    .filter(matches)
    .filter((item) =>
      incidentFilter === "all" || incidentFilter === "resolved"
        ? incidentFilter === "all" || item.status === "resolved"
        : item.status !== "resolved",
    )
    .filter((item) =>
      `${item.title} ${context(item)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  const matchingResolvedCount = state.incidents
    .filter(matches)
    .filter((item) => item.status === "resolved")
    .filter((item) =>
      `${item.title} ${context(item)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ).length;
  const emptyTitle =
    incidentFilter === "active"
      ? "No active incidents"
      : incidentFilter === "resolved"
        ? "No resolved incidents"
        : "No incidents to show";
  const showResolvedAction =
    incidentFilter === "active" && matchingResolvedCount > 0;
  const resolvedSummary = `${matchingResolvedCount} resolved ${matchingResolvedCount === 1 ? "incident matches" : "incidents match"} the current filters.`;
  return html`${pageHead(
      "Incidents",
      "From the first signal to a recorded resolution.",
      "incident",
      "Report incident",
    )}${scopeBar("Find an incident")}${formPanel()}
    <div class="list-caption">
      <div class="segments" aria-label="Filter incidents">
        ${["active", "resolved", "all"].map(
          (filter) =>
            html`<button
              type="button"
              data-action="incident-filter"
              data-id="${filter}"
              aria-pressed="${filter === incidentFilter}"
            >
              ${filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>`,
        )}
      </div>
      <span>${incidents.length} shown · latest 1,000 available</span>
    </div>
    ${incidents.length
      ? html`<div class="record-list">${incidentRows(incidents)}</div>`
      : empty(
          emptyTitle,
          showResolvedAction
            ? resolvedSummary
            : incidentFilter === "active"
              ? "Repeated monitor failures open incidents automatically. You can also report a problem and keep the investigation in one timeline."
              : "No incidents match this search. You can report a problem and keep the investigation in one timeline.",
          showResolvedAction
            ? `View ${matchingResolvedCount} resolved ${matchingResolvedCount === 1 ? "incident" : "incidents"}`
            : "Report incident",
          showResolvedAction ? "incident-filter" : "incident",
          "incidents",
          showResolvedAction ? "resolved" : "",
        )}`;
}
function focusedControl() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active)) return null;
  return {
    id: active.id,
    action: active.dataset.action ?? "",
    actionId: active.dataset.id ?? "",
    href: active.getAttribute("href") ?? "",
    name: active.getAttribute("name") ?? "",
    label: active.getAttribute("aria-label") ?? "",
    text: active.textContent.trim(),
    tagName: active.tagName,
    selectionStart: "selectionStart" in active ? active.selectionStart : null,
    selectionEnd: "selectionEnd" in active ? active.selectionEnd : null,
  };
}
function restoreFocusedControl(snapshot) {
  if (!snapshot) return;
  const target = [...root.querySelectorAll("a,button,input,select,textarea,[tabindex]")].find(
    (control) =>
      (snapshot.id && control.id === snapshot.id) ||
      (snapshot.action &&
        control.dataset.action === snapshot.action &&
        (control.dataset.id ?? "") === snapshot.actionId) ||
      (snapshot.href &&
        control.tagName === snapshot.tagName &&
        control.getAttribute("href") === snapshot.href &&
        control.textContent.trim() === snapshot.text) ||
      (snapshot.name &&
        control.tagName === snapshot.tagName &&
        control.getAttribute("name") === snapshot.name) ||
      (snapshot.label &&
        control.getAttribute("aria-label") === snapshot.label) ||
      (!snapshot.id &&
        !snapshot.action &&
        !snapshot.href &&
        !snapshot.name &&
        !snapshot.label &&
        control.tagName === snapshot.tagName &&
        control.textContent.trim() === snapshot.text),
  );
  if (!target) return;
  target.focus({ preventScroll: true });
  if (snapshot.selectionStart !== null && "setSelectionRange" in target) {
    try {
      target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    } catch {}
  }
}
function render({ preserveFocus = false } = {}) {
  const focused = preserveFocus ? focusedControl() : null;
  if (!authenticated || !state) root.innerHTML = login().html;
  else {
    const { page, id } = route();
    root.innerHTML = shell(
      page === "overview"
        ? overview()
        : page === "releases"
          ? releasesPage(id)
          : page === "monitoring"
            ? monitoringPage(id)
            : incidentsPage(id),
    ).html;
  }
  restoreFocusedControl(focused);
  document.title = `${authenticated ? pages[route().page] : "Sign in"} · semverge`;
}

root.addEventListener("click", async (event) => {
  const control = event.target.closest("[data-action]");
  if (!control || busy) return;
  const action = control.dataset.action,
    id = control.dataset.id;
  if (
    [
      "application",
      "service",
      "environment",
      "monitor",
      "release",
      "incident",
    ].includes(action)
  ) {
    form = action;
    render();
    document.querySelector("#form-title")?.focus();
    return;
  }
  if (action === "cancel") {
    form = null;
    render();
    return;
  }
  if (action.startsWith("goto-")) {
    location.hash = `/${action.slice(5)}`;
    return;
  }
  if (action === "incident-filter") {
    incidentFilter = id;
    render({ preserveFocus: true });
    return;
  }
  if (action === "toggle-history") {
    if (expandedHistories.has(id)) expandedHistories.delete(id);
    else expandedHistories.add(id);
    render({ preserveFocus: true });
    return;
  }
  try {
    busy = true;
    control.disabled = true;
    if (action === "refresh") await load();
    if (action === "logout") {
      await api("logout", {});
      authenticated = false;
      state = null;
      form = null;
      notice.hidden = true;
      busy = false;
      render();
    }
    if (action === "run-check") {
      control.textContent = "Checking…";
      await api(`monitors/${id}/checks`, {});
      await load();
      notify("Check recorded");
    }
    if (action === "pause-monitor") {
      const monitor = state.monitors.find((item) => item.id === id);
      await api(`monitors/${id}`, { paused: !monitor.paused }, "PATCH");
      await load();
      notify(monitor.paused ? "Monitor resumed" : "Monitor paused");
    }
  } catch (failure) {
    notify(failure.message, true);
    if (!authenticated) render();
  } finally {
    busy = false;
    document.querySelectorAll("button:disabled").forEach((button) => {
      button.disabled = false;
    });
  }
});
root.addEventListener("submit", async (event) => {
  const element = event.target.closest("[data-form]");
  if (!element) return;
  event.preventDefault();
  if (busy) return;
  const kind = element.dataset.form,
    data = Object.fromEntries(new FormData(element));
  const submit = element.querySelector("button[type=submit]");
  busy = true;
  submit.disabled = true;
  const original = submit.textContent;
  submit.textContent = kind === "login" ? "Signing in…" : "Saving…";
  try {
    if (kind === "login") {
      await api("login", { token: data.token });
      error = "";
      await load();
    } else if (
      ["note", "acknowledge", "resolve", "link-release"].includes(kind)
    ) {
      await api(
        `incidents/${element.dataset.id}`,
        { ...data, action: kind },
        "PATCH",
      );
      await load();
      notify("Incident updated");
    } else {
      let result;
      if (kind === "monitor")
        result = await api("monitors", {
          ...data,
          intervalSeconds: Number(data.intervalSeconds),
          expectedStatus: Number(data.expectedStatus),
        });
      else if (kind === "release") {
        let transaction;
        try {
          transaction = JSON.parse(data.transaction);
        } catch {
          throw new Error(
            "Transaction JSON is invalid. Paste the complete transaction object.",
          );
        }
        result = await api("releases", {
          serviceId: data.serviceId,
          environmentId: data.environmentId,
          transaction,
        });
      } else
        result = await api(
          {
            application: "applications",
            service: "services",
            environment: "environments",
            incident: "incidents",
          }[kind],
          data,
        );
      form = null;
      if (kind === "monitor") location.hash = `/monitoring/${result.id}`;
      if (kind === "release") location.hash = `/releases/${result.id}`;
      if (kind === "incident") location.hash = `/incidents/${result.id}`;
      await load();
      notify(
        kind === "release"
          ? "Release evidence imported"
          : `${kind.charAt(0).toUpperCase() + kind.slice(1)} created.`,
      );
    }
  } catch (failure) {
    error = kind === "login" ? failure.message : error;
    if (kind === "login") render();
    else notify(failure.message, true);
  } finally {
    busy = false;
    if (submit.isConnected) {
      submit.disabled = false;
      submit.textContent = original;
    }
    document.querySelectorAll("button:disabled").forEach((button) => {
      button.disabled = false;
    });
  }
});
root.addEventListener("change", async (event) => {
  if (event.target.id === "environment-scope") {
    environment = event.target.value;
    render({ preserveFocus: true });
  }
  if (event.target.name === "releaseFile") {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      notify("Choose a transaction file smaller than 500 KiB.", true);
      return;
    }
    try {
      event.target.form.elements.transaction.value = await file.text();
    } catch {
      notify(
        "The file could not be read. Paste its transaction JSON instead.",
        true,
      );
    }
  }
});
root.addEventListener("input", (event) => {
  if (event.target.id !== "search") return;
  const position = event.target.selectionStart;
  query = event.target.value;
  render({ preserveFocus: true });
  const search = document.querySelector("#search");
  search.focus();
  try {
    search.setSelectionRange(position, position);
  } catch {}
});
window.addEventListener("hashchange", () => {
  form = null;
  query = "";
  void load().then(() => document.querySelector("main h1")?.focus());
});
let lastInteractionAt = 0;
const recordInteraction = () => {
  lastInteractionAt = Date.now();
};
document.addEventListener("pointerdown", recordInteraction, true);
document.addEventListener("keydown", recordInteraction, true);
setInterval(() => {
  if (
    authenticated &&
    !busy &&
    !form &&
    Date.now() - lastInteractionAt > 1500 &&
    !document.activeElement?.matches("input,textarea,select")
  )
    void load(true);
}, 10000);
void load();
