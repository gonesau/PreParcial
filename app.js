// ===== Utilidades =====
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
const STORAGE_KEY = "taskflow.tasks.v1";
const THEME_KEY = "taskflow.theme.v1";

const uuid = () => `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
const fmtDate = (d) =>
  new Intl.DateTimeFormat("es-SV", { dateStyle: "medium", timeStyle: "short" }).format(d);

// ===== Estado =====
let tasks = []; // {id, text, completed, createdAt, dueAt|null, notified:boolean}
let view = {
  filter: "all",            // all | active | completed
  sort: "created_desc"      // created_asc|created_desc|alpha_asc|alpha_desc|due_asc|due_desc
};

// ===== Carga inicial =====
document.addEventListener("DOMContentLoaded", () => {
  // Tema
  const savedTheme = localStorage.getItem(THEME_KEY) || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  $("#themeToggle").setAttribute("aria-pressed", String(savedTheme === "dark"));

  // Tareas
  tasks = loadTasks();
  bindEvents();
  render();
  requestNotificationPermission();
  startDueCheckTimer();
});

// ===== Persistencia =====
function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}
function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ===== Eventos UI =====
function bindEvents() {
  // Form alta
  $("#taskForm").addEventListener("submit", onAddTask);

  // Filtros
  $$(".filters .chip").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".filters .chip").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      view.filter = btn.dataset.filter;
      render();
    });
  });

  // Orden
  $("#sortSelect").addEventListener("change", (e) => {
    view.sort = e.target.value;
    render();
  });

  // Tema
  $("#themeToggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    $("#themeToggle").setAttribute("aria-pressed", String(next === "dark"));
    localStorage.setItem(THEME_KEY, next);
  });
}

// ===== Handlers =====
function onAddTask(e) {
  e.preventDefault();
  const input = $("#taskInput");
  const dueInput = $("#dueInput");
  const error = $("#formError");
  error.textContent = "";

  const text = input.value.trim();
  if (!text) {
    error.textContent = "El campo no puede estar vacío.";
    input.focus();
    return;
  }

  const dueVal = dueInput.value ? new Date(dueInput.value).toISOString() : null;

  const task = {
    id: uuid(),
    text,
    completed: false,
    createdAt: new Date().toISOString(),
    dueAt: dueVal,
    notified: false
  };
  tasks.unshift(task);
  saveTasks();
  input.value = "";
  dueInput.value = "";
  render();
}

function onToggleTask(id, checked) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  t.completed = checked;
  saveTasks();
  updateCounter();
  renderListOnly(); // mantener filtro/orden
}

function onDeleteTask(id, liEl) {
  // animación antes de eliminar
  liEl.classList.add("removing");
  setTimeout(() => {
    tasks = tasks.filter(t => t.id !== id);
    saveTasks();
    render();
  }, 180);
}

function onEditTask(id, titleEl) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;

  // Cambiar a modo edición
  const prev = t.text;
  titleEl.contentEditable = "true";
  titleEl.focus();
  selectAllText(titleEl);

  const commit = () => {
    titleEl.contentEditable = "false";
    const newText = titleEl.textContent.trim();
    if (!newText) {
      titleEl.textContent = prev;
      return;
    }
    t.text = newText;
    saveTasks();
    renderListOnly();
  };
  const cancel = () => {
    titleEl.contentEditable = "false";
    titleEl.textContent = prev;
  };

  const handleKey = (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); commit(); cleanup(); }
    else if (ev.key === "Escape") { ev.preventDefault(); cancel(); cleanup(); }
  };
  const handleBlur = () => { commit(); cleanup(); };

  titleEl.addEventListener("keydown", handleKey);
  titleEl.addEventListener("blur", handleBlur, { once: true });

  function cleanup() {
    titleEl.removeEventListener("keydown", handleKey);
  }
}

function selectAllText(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ===== Render =====
function render() {
  renderListOnly();
  updateCounter();
  $("#emptyState").style.display = tasks.length ? "none" : "block";
}

function renderListOnly() {
  const list = $("#taskList");
  list.innerHTML = "";

  const filtered = tasks.filter(t => {
    if (view.filter === "active") return !t.completed;
    if (view.filter === "completed") return t.completed;
    return true;
  });

  const sorted = sortTasks(filtered, view.sort);

  for (const t of sorted) {
    const li = renderTaskItem(t);
    list.appendChild(li);
  }
}

function renderTaskItem(t) {
  const tpl = $("#taskItemTemplate");
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = t.id;
  if (t.completed) node.classList.add("completed");

  const toggle = $(".task-toggle", node);
  toggle.checked = t.completed;
  toggle.addEventListener("change", (e) => onToggleTask(t.id, e.target.checked));

  const title = $(".task-title", node);
  title.textContent = t.text;
  title.addEventListener("dblclick", () => onEditTask(t.id, title));
  // Accesible: Enter inicia edición
  title.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !title.isContentEditable) {
      ev.preventDefault();
      onEditTask(t.id, title);
    }
  });

  const created = $(".task-created", node);
  created.dateTime = t.createdAt;
  created.textContent = `Creada: ${fmtDate(new Date(t.createdAt))}`;

  const due = $(".task-due", node);
  if (t.dueAt) {
    const dueDate = new Date(t.dueAt);
    due.textContent = `Límite: ${fmtDate(dueDate)}`;
    const status = dueStatus(dueDate, t.completed);
    if (status === "soon") due.classList.add("soon");
    if (status === "overdue") due.classList.add("overdue");
  } else {
    due.textContent = "Sin fecha límite";
  }

  $(".edit-btn", node).addEventListener("click", () => onEditTask(t.id, title));

  const delBtn = $(".delete-btn", node);
  delBtn.addEventListener("click", () => onDeleteTask(t.id, node));
  delBtn.addEventListener("mouseenter", () => node.style.transform = "translateY(-1px)");
  delBtn.addEventListener("mouseleave", () => node.style.transform = "translateY(0)");

  return node;
}

function updateCounter() {
  const count = tasks.filter(t => !t.completed).length;
  $("#pendingCount").textContent = String(count);
}

function sortTasks(arr, sortKey) {
  const copy = [...arr];
  const cmp = {
    created_asc: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    created_desc: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    alpha_asc: (a, b) => a.text.localeCompare(b.text, "es", { sensitivity: "base" }),
    alpha_desc: (a, b) => b.text.localeCompare(a.text, "es", { sensitivity: "base" }),
    due_asc: (a, b) => (a.dueAt ? new Date(a.dueAt) : Infinity) - (b.dueAt ? new Date(b.dueAt) : Infinity),
    due_desc: (a, b) => (b.dueAt ? new Date(b.dueAt) : -Infinity) - (a.dueAt ? new Date(a.dueAt) : -Infinity),
  }[sortKey] || ((a, b) => 0);

  return copy.sort(cmp);
}

// ===== Notificaciones por fecha límite =====
function dueStatus(dueDate, completed) {
  if (completed) return "ok";
  const now = new Date();
  const diffMs = dueDate - now;
  if (diffMs < 0) return "overdue";
  const hours = diffMs / 36e5; // ms a horas
  if (hours <= 24) return "soon";
  return "future";
}

function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    // pedir permiso con un pequeño delay para no ser agresivos
    setTimeout(() => Notification.requestPermission().catch(() => {}), 800);
  }
}

function startDueCheckTimer() {
  // chequeo inicial y luego cada 60s
  checkDueTasks();
  setInterval(checkDueTasks, 60 * 1000);
}

function checkDueTasks() {
  const now = new Date();
  tasks.forEach(t => {
    if (!t.dueAt || t.completed) return;
    const due = new Date(t.dueAt);
    const status = dueStatus(due, false);
    if ((status === "soon" || status === "overdue") && !t.notified) {
      t.notified = true;
      saveTasks();
      notify(`"${t.text}" vence ${status === "overdue" ? "📛 ATRASADA" : "en menos de 24h"} (${fmtDate(due)})`);
    }
  });
}

function notify(message) {
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("Recordatorio de tarea", { body: message });
      return;
    } catch { /* fallback abajo */ }
  }
  // Fallback toast
  pushToast(message);
}

function pushToast(msg, timeout = 6000) {
  const container = $("#toastRegion");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;

  const close = document.createElement("button");
  close.type = "button";
  close.ariaLabel = "Cerrar notificación";
  close.textContent = "Cerrar";
  close.addEventListener("click", () => container.removeChild(el));

  el.appendChild(close);
  container.appendChild(el);
  setTimeout(() => container.contains(el) && container.removeChild(el), timeout);
}


document.getElementById('openCalendarBtn').addEventListener('click', () => {
  const input = document.getElementById('dueInput');
  if (input.showPicker) {
    input.showPicker(); // Soporta Chrome, Edge, Opera
  } else {
    input.focus(); // Fallback para navegadores sin showPicker
  }
});


// ===== Bonus: helpers de import/export (por si las moscas) =====
// Si quisieras mover datos entre navegadores: descomenta y conéctalo a la UI.
// function exportTasks() { return btoa(unescape(encodeURIComponent(JSON.stringify(tasks)))); }
// function importTasks(b64) { tasks = JSON.parse(decodeURIComponent(escape(atob(b64)))); saveTasks(); render(); }
