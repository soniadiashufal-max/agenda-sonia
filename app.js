// ============================================================
// AGENDA SÓNIA — APP STANDALONE
// Vanilla JS. Sem frameworks. Sem build step.
// ============================================================

// ============================================================
// CONFIGURAÇÃO — editada directamente aqui, um único ficheiro
// ============================================================
const CONFIG = {
  GOOGLE_CLIENT_ID: "161526450221-4hi5ucppv9773drvvu73jvkrr0th4rga.apps.googleusercontent.com",
  GOOGLE_SHEET_ID: "17fz0b_fFU7GWtb4hPzXNTCdQM1qyeemwXqjyIlkObRg",
  ANTHROPIC_API_KEY: "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",
  GOOGLE_SCOPES: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/spreadsheets",
  TIMEZONE: "Europe/Lisbon",
};

const TEAL_HEX = { BNI: "#d4001a", HUFAL: "#035e5f", "Reunião": "#c97d1a", Pessoal: "#7c6daa", Outro: "#6b7280" };
const TASK_TYPES = [
  { value: "Orçamento", icon: "📋", color: "#3b6fd4" },
  { value: "Produção", icon: "🗂️", color: "#7c6daa" },
  { value: "Encomenda", icon: "📦", color: "#c97d1a" },
  { value: "Contacto", icon: "📞", color: "#035e5f" },
  { value: "Outro", icon: "📌", color: "#6b7280" },
];
const PT_MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const PT_DAYS_SHORT = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const PT_DAYS_LONG = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
const WORK_TYPES = ["Instalação", "Retificação de medidas", "Manutenção/Assistência", "Medição"];

// ---- STATE ----
let state = {
  accessToken: null,
  activeTab: "agenda",
  calView: "semanal",
  hufalCalView: "semanal",
  mode: "chat",
  messages: [{ role: "ai", text: "Olá, Sónia! Dita o que precisas de fazer com hora e dia." }],
  events: [],          // { id, title, date, startTime, endTime, notes, category, gcalEventId }
  tasks: [],           // { id, title, type, done, obs, createdAt, rowIndex }
  works: [],            // { id, title, date, startTime, endTime, client, address, workType, team, techNotes, createdAt, rowIndex } — quadro HUFAL, independente do Google Calendar
  hufalEditingWork: null,
  hufalMode: "chat",
  hufalMessages: [{ role: "ai", text: "Dita uma obra: título, dia, hora, cliente, morada. Fica registado no quadro HUFAL, não no Google Calendar." }],
  hufalLoading: false,
  selectedDate: todayStr(),
  viewAnchor: todayStr(),
  taskFilter: "Todos",
  taskType: "Orçamento",
  expandedObs: null,
  editingTask: null,
  editingEvent: null,
  syncing: false,
  scheduleModal: null,
  loading: false,
  taskLoading: false,
};

function todayStr() { return new Date().toISOString().split("T")[0]; }
function addDays(d, n) { const dt = new Date(d + "T12:00:00"); dt.setDate(dt.getDate() + n); return dt.toISOString().split("T")[0]; }
function formatDueLabel(dateStr) {
  if (!dateStr) return "";
  if (dateStr === todayStr()) return "Hoje";
  if (dateStr === addDays(todayStr(), 1)) return "Amanhã";
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getDate()} ${PT_MONTHS[d.getMonth()].slice(0,3)}`;
}
function weekStart(d) { const dt = new Date(d + "T12:00:00"); dt.setDate(dt.getDate() - dt.getDay()); return dt.toISOString().split("T")[0]; }
function esc(s) { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }
function showToast(msg, duration) {
  const root = document.getElementById("toast-root");
  root.innerHTML = `<div class="toast">${esc(msg)}</div>`;
  setTimeout(() => { root.innerHTML = ""; }, duration || 3000);
}

// ============================================================
// CONFIG CHECK
// ============================================================
function checkConfig() {
  const missing = [];
  if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID.includes("COLOCA_AQUI")) missing.push("GOOGLE_CLIENT_ID");
  if (!CONFIG.GOOGLE_SHEET_ID || CONFIG.GOOGLE_SHEET_ID.includes("COLOCA_AQUI")) missing.push("GOOGLE_SHEET_ID");
  if (!CONFIG.ANTHROPIC_API_KEY || CONFIG.ANTHROPIC_API_KEY.includes("COLOCA_AQUI")) missing.push("ANTHROPIC_API_KEY");
  return missing;
}

// ============================================================
// GOOGLE OAUTH
// ============================================================
let tokenClient;

function initGoogleAuth() {
  const missing = checkConfig();
  if (missing.length) {
    document.getElementById("login-error").textContent =
      `Falta configurar: ${missing.join(", ")}. Edita config.js antes de usar a app.`;
    document.getElementById("google-signin-btn").style.opacity = "0.5";
    document.getElementById("google-signin-btn").style.pointerEvents = "none";
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: CONFIG.GOOGLE_SCOPES,
    callback: (resp) => {
      if (resp.error) {
        document.getElementById("login-error").textContent = "Não foi possível iniciar sessão. Tenta novamente.";
        return;
      }
      state.accessToken = resp.access_token;
      sessionStorage.setItem("agenda_token", resp.access_token);
      onLoginSuccess();
    },
  });
  document.getElementById("google-signin-btn").onclick = () => tokenClient.requestAccessToken();

  // Tenta restaurar sessão
  const saved = sessionStorage.getItem("agenda_token");
  if (saved) {
    state.accessToken = saved;
    onLoginSuccess();
  }
}

async function onLoginSuccess() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("main-app").style.display = "block";
  await loadTasksFromSheet();
  await loadEventsFromCalendar();
  await loadWorksFromSheet();
  render();
  checkUpcomingEvents();
}

function checkUpcomingEvents() {
  const now = new Date();
  const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const upcoming = state.events.filter(e => {
    if (!e.startTime || e.date !== todayStr()) return false;
    const evDateTime = new Date(`${e.date}T${e.startTime}:00`);
    return evDateTime >= now && evDateTime <= in2h;
  });
  if (upcoming.length) {
    const list = upcoming.map(e => `${e.startTime} · ${e.title}`).join("  /  ");
    showToast(`Próximas 2h: ${list}`, 8000);
  }
}

// ============================================================
// GOOGLE CALENDAR API
// ============================================================
async function gcalRequest(method, path, body) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${state.accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    sessionStorage.removeItem("agenda_token");
    showToast("Sessão expirada. Faz login novamente.");
    location.reload();
    return null;
  }
  return res.json();
}

async function loadEventsFromCalendar() {
  const timeMin = addDays(todayStr(), -45) + "T00:00:00Z";
  const timeMax = addDays(todayStr(), 90) + "T00:00:00Z";
  const data = await gcalRequest("GET", `/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=250`);
  if (!data || !data.items) return;
  state.events = data.items.map(ev => {
    const startDateTime = ev.start?.dateTime;
    const startDate = ev.start?.date;
    const endDateTime = ev.end?.dateTime;
    const endDate = ev.end?.date;
    const meetLink = ev.hangoutLink
      || ev.conferenceData?.entryPoints?.find(p => p.entryPointType === "video")?.uri
      || "";
    return {
      id: ev.id,
      gcalEventId: ev.id,
      title: ev.summary || "(Sem título)",
      date: startDateTime ? startDateTime.split("T")[0] : startDate,
      startTime: startDateTime ? startDateTime.split("T")[1].slice(0,5) : "",
      endTime: endDateTime ? endDateTime.split("T")[1].slice(0,5) : "",
      notes: ev.description || "",
      location: ev.location || "",
      meetLink,
      category: guessCategory(ev.summary, ev.description),
      gcal: true, pending: false,
    };
  });
}

function guessCategory(title, notes) {
  const t = ((title || "") + " " + (notes || "")).toLowerCase();
  if (t.includes("bni")) return "BNI";
  if (t.includes("hufal") || t.includes("cliente") || t.includes("orçamento") || t.includes("obra")) return "HUFAL";
  if (t.includes("reunião") || t.includes("reuniao") || t.includes("meeting")) return "Reunião";
  return "Outro";
}

const DEFAULT_REMINDERS = { useDefault: false, overrides: [{ method: "popup", minutes: 30 }, { method: "popup", minutes: 24 * 60 }] };

async function createCalendarEvent(ev) {
  const body = {
    summary: ev.title,
    description: ev.notes || "",
    location: ev.location || "",
    start: ev.startTime ? { dateTime: `${ev.date}T${ev.startTime}:00`, timeZone: CONFIG.TIMEZONE } : { date: ev.date },
    end: ev.endTime ? { dateTime: `${ev.date}T${ev.endTime}:00`, timeZone: CONFIG.TIMEZONE }
       : ev.startTime ? { dateTime: `${ev.date}T${ev.startTime}:00`, timeZone: CONFIG.TIMEZONE }
       : { date: ev.date },
    reminders: DEFAULT_REMINDERS,
  };
  const res = await gcalRequest("POST", "/calendars/primary/events", body);
  return res && res.id ? res.id : null;
}

async function updateCalendarEvent(ev) {
  if (!ev.gcalEventId) return false;
  const body = {
    summary: ev.title,
    description: ev.notes || "",
    location: ev.location || "",
    start: ev.startTime ? { dateTime: `${ev.date}T${ev.startTime}:00`, timeZone: CONFIG.TIMEZONE } : { date: ev.date },
    end: ev.endTime ? { dateTime: `${ev.date}T${ev.endTime}:00`, timeZone: CONFIG.TIMEZONE }
       : ev.startTime ? { dateTime: `${ev.date}T${ev.startTime}:00`, timeZone: CONFIG.TIMEZONE }
       : { date: ev.date },
    reminders: DEFAULT_REMINDERS,
  };
  const res = await gcalRequest("PATCH", `/calendars/primary/events/${ev.gcalEventId}`, body);
  return !!(res && res.id);
}

async function deleteCalendarEvent(gcalEventId) {
  if (!gcalEventId) return;
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${gcalEventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${state.accessToken}` },
  });
}

// ============================================================
// GOOGLE SHEETS API (tarefas)
// ============================================================
const SHEET_RANGE = "Tarefas!A2:H1000";
const SHEET_HEADER_RANGE = "Tarefas!A1:H1";

async function ensureSheetHeader() {
  const data = await sheetsRequest("GET", `/values/${SHEET_HEADER_RANGE}`);
  if (data && data.values && data.values.length) return;
  await sheetsRequest("PUT", `/values/${SHEET_HEADER_RANGE}?valueInputOption=RAW`, {
    values: [["ID", "Título", "Tipo", "Concluída", "Observações", "Criada em", "Data limite", "Hora limite"]],
  });
}

async function sheetsRequest(method, path, body) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.GOOGLE_SHEET_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${state.accessToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    sessionStorage.removeItem("agenda_token");
    showToast("Sessão expirada. Faz login novamente.");
    location.reload();
    return null;
  }
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Erro ${res.status} no Google Sheets`;
    throw new Error(msg);
  }
  return data;
}

async function loadTasksFromSheet() {
  try {
    await ensureSheetHeader();
    const data = await sheetsRequest("GET", `/values/${SHEET_RANGE}`);
    state.tasks = (data && data.values ? data.values : []).map((row, i) => ({
      id: row[0] || String(i),
      title: row[1] || "",
      type: row[2] || "Outro",
      done: row[3] === "TRUE" || row[3] === true,
      obs: row[4] || "",
      createdAt: row[5] || "",
      dueDate: row[6] || "",
      dueTime: row[7] || "",
      rowIndex: i + 2,
    })).reverse();
  } catch (e) {
    // Não apaga as tarefas já visíveis; só avisa que não conseguiu atualizar.
    showToast(`Não foi possível carregar as tarefas do Sheet (${e.message || "erro"})`, 9000);
  }
}

async function appendTaskToSheet(task) {
  const res = await sheetsRequest("POST", `/values/${SHEET_RANGE.split("!")[0]}!A:H:append?valueInputOption=RAW`, {
    values: [[task.id, task.title, task.type, task.done ? "TRUE" : "FALSE", task.obs, task.createdAt, task.dueDate || "", task.dueTime || ""]],
  });
  const range = res?.updates?.updatedRange || "";
  const match = range.match(/![A-Z]+(\d+):/);
  if (match) task.rowIndex = parseInt(match[1], 10);
}

async function updateTaskRow(task) {
  if (!task.rowIndex) return;
  await sheetsRequest("PUT", `/values/Tarefas!A${task.rowIndex}:H${task.rowIndex}?valueInputOption=RAW`, {
    values: [[task.id, task.title, task.type, task.done ? "TRUE" : "FALSE", task.obs, task.createdAt, task.dueDate || "", task.dueTime || ""]],
  });
}

async function deleteTaskRow(task) {
  if (!task.rowIndex) return;
  // Limpa a linha (mantém a estrutura simples; reescreve tudo)
  state.tasks = state.tasks.filter(t => t.id !== task.id);
  await rewriteAllTasks();
}

async function rewriteAllTasks() {
  const ordered = [...state.tasks].reverse();
  const values = ordered.map(t => [t.id, t.title, t.type, t.done ? "TRUE" : "FALSE", t.obs, t.createdAt, t.dueDate || "", t.dueTime || ""]);
  await sheetsRequest("PUT", `/values/${SHEET_RANGE}?valueInputOption=RAW`, { values: values.length ? values : [["", "", "", "", "", "", "", ""]] });
  // Reatribui rowIndex
  ordered.forEach((t, i) => { t.rowIndex = i + 2; });
}

// ============================================================
// GOOGLE SHEETS API (quadro HUFAL — independente do Google Calendar)
// ============================================================
const WORKS_SHEET_NAME = "Obras";
const WORKS_RANGE = `${WORKS_SHEET_NAME}!A2:K1000`;
const WORKS_HEADER_RANGE = `${WORKS_SHEET_NAME}!A1:K1`;
const WORKS_HEADER = ["ID", "Título", "Data", "Início", "Fim", "Cliente", "Morada", "Tipo de trabalho", "Equipa/Responsável", "Notas técnicas", "Criada em"];

async function ensureWorksSheetExists() {
  try {
    const meta = await sheetsRequest("GET", "");
    const exists = meta?.sheets?.some(s => s.properties?.title === WORKS_SHEET_NAME);
    if (!exists) {
      await sheetsRequest("POST", ":batchUpdate", {
        requests: [{ addSheet: { properties: { title: WORKS_SHEET_NAME } } }],
      });
    }
    await sheetsRequest("PUT", `/values/${WORKS_HEADER_RANGE}?valueInputOption=RAW`, { values: [WORKS_HEADER] });
  } catch {}
}

function workToRow(w) {
  return [w.id, w.title, w.date, w.startTime || "", w.endTime || "", w.client || "", w.address || "", w.workType || "", w.team || "", w.techNotes || "", w.createdAt || ""];
}

async function loadWorksFromSheet() {
  try {
    await ensureWorksSheetExists();
    const data = await sheetsRequest("GET", `/values/${WORKS_RANGE}`);
    state.works = (data && data.values ? data.values : []).filter(r => r[0]).map((row, i) => ({
      id: row[0],
      title: row[1] || "",
      date: row[2] || "",
      startTime: row[3] || "",
      endTime: row[4] || "",
      client: row[5] || "",
      address: row[6] || "",
      workType: row[7] || "",
      team: row[8] || "",
      techNotes: row[9] || "",
      createdAt: row[10] || "",
      category: "HUFAL",
      rowIndex: i + 2,
    }));
  } catch (e) {
    showToast(`Não foi possível carregar o quadro HUFAL (${e.message || "erro"})`, 9000);
  }
}

async function appendWorkToSheet(w) {
  const res = await sheetsRequest("POST", `/values/${WORKS_SHEET_NAME}!A:K:append?valueInputOption=RAW`, { values: [workToRow(w)] });
  const range = res?.updates?.updatedRange || "";
  const match = range.match(/![A-Z]+(\d+):/);
  if (match) w.rowIndex = parseInt(match[1], 10);
}

async function updateWorkRow(w) {
  if (!w.rowIndex) return;
  await sheetsRequest("PUT", `/values/${WORKS_SHEET_NAME}!A${w.rowIndex}:K${w.rowIndex}?valueInputOption=RAW`, { values: [workToRow(w)] });
}

async function deleteWorkRow(w) {
  state.works = state.works.filter(x => x.id !== w.id);
  await rewriteAllWorks();
}

async function rewriteAllWorks() {
  const values = state.works.map(workToRow);
  await sheetsRequest("PUT", `/values/${WORKS_RANGE}?valueInputOption=RAW`, { values: values.length ? values : [["","","","","","","","","","",""]] });
  state.works.forEach((w, i) => { w.rowIndex = i + 2; });
}

// ============================================================
// ANTHROPIC API (interpretação de linguagem natural)
// ============================================================
async function callClaude(systemPrompt, userText, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CONFIG.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens || 600,
      system: systemPrompt,
      messages: [{ role: "user", content: userText }],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Erro ${res.status} na API Anthropic`;
    throw new Error(msg);
  }
  const raw = data.content?.find(b => b.type === "text")?.text || "";
  if (!raw) throw new Error("A IA não devolveu resposta de texto.");
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    throw new Error("Resposta da IA não veio em formato JSON válido: " + raw.slice(0, 120));
  }
}

async function parseAgendaText(text) {
  const today = todayStr();
  const tomorrow = addDays(today, 1);
  return callClaude(
    `És um assistente de agenda para Sónia, profissional portuguesa (HUFAL caixilharia, BNI).
Hoje é ${today} (formato YYYY-MM-DD). Amanhã é ${tomorrow}.

A tua tarefa: extrair de uma frase ditada em português os campos de um evento de calendário.

REGRAS OBRIGATÓRIAS:
1. O campo "title" NUNCA deve conter palavras de data/hora como "amanhã", "hoje", "sexta", "às 16h30", etc. Remove sempre essas palavras do título, deixando só a ação/assunto.
2. Interpreta expressões de data relativas ("amanhã", "hoje", "sexta-feira", "para a próxima semana") e converte sempre para uma data exata no formato YYYY-MM-DD, usando hoje (${today}) como referência.
3. Interpreta horas em qualquer formato ("16h30", "4 da tarde", "às 9") e converte sempre para HH:MM em 24 horas.
4. Se não houver hora nenhuma mencionada, deixa startTime e endTime como "".
5. Se não houver dia mencionado, usa ${today}.

Responde APENAS com JSON válido, sem texto antes ou depois, sem markdown:
{"title":"...","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","notes":"...","category":"BNI|HUFAL|Reunião|Pessoal|Outro","reply":"confirmação curta e elegante em português de Portugal"}

Exemplo:
Frase: "Amanhã o orçamento para o cliente do Fundão Nuno às 16h30"
Resposta: {"title":"Orçamento para o cliente do Fundão Nuno","date":"${tomorrow}","startTime":"16:30","endTime":"","notes":"","category":"HUFAL","reply":"Marquei o orçamento para o cliente do Fundão Nuno amanhã às 16h30."}`,
    text, 700
  );
}

async function parseTaskText(text, type) {
  return callClaude(
    `Task assistant for Sónia (HUFAL caixilharia alumínio/PVC, BNI). Reply ONLY JSON: {"title":"clear concise title","reply":"short elegant confirmation in European Portuguese"}`,
    `Tipo: ${type}. Tarefa: ${text}`, 300
  );
}

async function parseWorkText(text) {
  const today = todayStr();
  const tomorrow = addDays(today, 1);
  return callClaude(
    `És um assistente para Sónia, da HUFAL (caixilharia de alumínio e PVC), a registar obras num quadro de planeamento.
Hoje é ${today}. Amanhã é ${tomorrow}.
Extrai os dados de uma obra a partir do texto ditado. Responde APENAS com JSON válido, sem texto antes ou depois, sem backticks:
{"title":"título curto da obra","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","client":"nome do cliente, se mencionado, senão vazio","address":"morada, se mencionada, senão vazio","workType":"Instalação|Retificação de medidas|Manutenção/Assistência|Medição|","team":"equipa ou responsável, se mencionado, senão vazio","reply":"confirmação curta e elegante em português de Portugal"}
Regras:
- O título nunca deve conter palavras de data ou hora.
- Interpreta datas relativas (amanhã, sexta-feira, etc) e converte sempre para YYYY-MM-DD.
- Se não houver hora mencionada, usa "". Se não houver dia mencionado, usa ${today}.
- Só preenche "workType" se corresponder claramente a um dos quatro tipos listados; caso contrário deixa "".`,
    text, 700
  );
}

// ============================================================
// HANDLERS — AGENDA
// ============================================================
async function handleSendChat() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text || state.loading) return;
  input.value = "";
  state.messages.push({ role: "user", text });
  state.loading = true;
  render();

  try {
    const p = await parseAgendaText(text);
    const ev = {
      id: "tmp_" + Date.now(), title: p.title || text, date: p.date || todayStr(),
      startTime: p.startTime || "", endTime: p.endTime || "", notes: p.notes || "",
      category: p.category || "Outro", gcal: false, pending: true,
    };
    state.events.push(ev);
    state.messages.push({ role: "ai", text: p.reply || `Adicionei: ${p.title}` });
    state.selectedDate = ev.date; state.viewAnchor = ev.date;
    render();

    const gcalId = await createCalendarEvent(ev);
    if (gcalId) {
      ev.gcalEventId = gcalId; ev.gcal = true; ev.pending = false;
      state.messages.push({ role: "ai", text: "✓ Adicionado ao Google Calendar." });
      showToast("Evento criado no Google Calendar");
    } else {
      ev.pending = false;
      state.messages.push({ role: "ai", text: "Não consegui sincronizar com o Google Calendar agora." });
    }
  } catch (e) {
    state.messages.push({ role: "ai", text: `Não consegui interpretar (${e.message || "erro desconhecido"}). Reformula ou usa o formulário?` });
  }
  state.loading = false;
  render();
}

async function handleFormAdd() {
  const title = document.getElementById("form-title").value.trim();
  if (!title) return;
  const ev = {
    id: "tmp_" + Date.now(), title,
    date: document.getElementById("form-date").value,
    startTime: document.getElementById("form-start").value,
    endTime: document.getElementById("form-end").value,
    notes: document.getElementById("form-notes").value,
    location: document.getElementById("form-location")?.value || "",
    category: document.getElementById("form-category").value,
    gcal: false, pending: true,
  };
  state.events.push(ev);
  state.selectedDate = ev.date; state.viewAnchor = ev.date;
  render();

  const gcalId = await createCalendarEvent(ev);
  if (gcalId) { ev.gcalEventId = gcalId; ev.gcal = true; }
  ev.pending = false;
  showToast(gcalId ? "Adicionado ao Google Calendar" : "Guardado localmente");
  render();
}

async function handleDeleteEvent(id) {
  const ev = state.events.find(e => e.id === id);
  if (!ev) return;
  state.events = state.events.filter(e => e.id !== id);
  render();
  if (ev.gcalEventId) await deleteCalendarEvent(ev.gcalEventId);
}

function openEditEvent(id) {
  state.editingEvent = id;
  render();
  setTimeout(() => {
    const el = document.getElementById("evedit-title-input");
    if (el) el.focus();
  }, 0);
}

function cancelEditEvent() {
  state.editingEvent = null;
  render();
}

async function saveEditEvent(id) {
  const ev = state.events.find(e => e.id === id);
  if (!ev) return;
  const title = document.getElementById("evedit-title-input")?.value.trim();
  if (!title) { showToast("O título não pode ficar vazio"); return; }
  ev.title = title;
  ev.date = document.getElementById("evedit-date-input")?.value || ev.date;
  ev.startTime = document.getElementById("evedit-start-input")?.value || "";
  ev.endTime = document.getElementById("evedit-end-input")?.value || "";
  ev.notes = document.getElementById("evedit-notes-input")?.value || "";
  ev.location = document.getElementById("evedit-location-input")?.value || "";
  ev.category = document.getElementById("evedit-category-select")?.value || ev.category;
  state.editingEvent = null;
  state.selectedDate = ev.date; state.viewAnchor = ev.date;
  render();

  if (ev.gcalEventId) {
    const ok = await updateCalendarEvent(ev);
    showToast(ok ? "Evento atualizado no Google Calendar" : "Atualizado localmente, falhou sincronizar");
  } else {
    showToast("Evento atualizado");
  }
  render();
}

// ============================================================
// HANDLERS — TAREFAS
// ============================================================
async function handleAddTask() {
  const input = document.getElementById("task-input");
  const text = input.value.trim();
  if (!text || state.taskLoading) return;
  input.value = "";
  state.taskLoading = true;
  render();

  let title = text;
  let reply = "Tarefa adicionada";
  try {
    const p = await parseTaskText(text, state.taskType);
    title = p.title || text;
    reply = p.reply || reply;
  } catch {}

  const task = {
    id: "t_" + Date.now(), title, type: state.taskType, done: false, obs: "",
    createdAt: new Date().toLocaleDateString("pt-PT"), dueDate: "", dueTime: "",
  };
  state.tasks.unshift(task);
  state.taskLoading = false;
  render();
  showToast(reply);

  try {
    await appendTaskToSheet(task);
  } catch (e) {
    showToast(`Guardada só neste dispositivo por agora (${e.message || "erro de ligação"})`);
  }
  render();
}

async function toggleTaskDone(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  task.done = !task.done;
  render();
  try { await updateTaskRow(task); } catch (e) { showToast(`Não sincronizou (${e.message || "erro"})`); }
}

function openObs(id) {
  const task = state.tasks.find(t => t.id === id);
  state.expandedObs = id;
  state.editingTask = null;
  render();
  setTimeout(() => {
    const el = document.getElementById("obs-textarea");
    if (el) el.value = task.obs || "";
  }, 0);
}

async function saveObs(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const el = document.getElementById("obs-textarea");
  task.obs = el ? el.value : task.obs;
  state.expandedObs = null;
  render();
  try { await updateTaskRow(task); showToast("Observação guardada"); }
  catch (e) { showToast(`Não sincronizou (${e.message || "erro"})`); }
}

function openEditTask(id) {
  state.editingTask = id;
  state.expandedObs = null;
  render();
  setTimeout(() => {
    const el = document.getElementById("edit-title-input");
    if (el) el.focus();
  }, 0);
}

function cancelEditTask() {
  state.editingTask = null;
  render();
}

async function saveEditTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const titleEl = document.getElementById("edit-title-input");
  const typeEl = document.getElementById("edit-type-select");
  const dateEl = document.getElementById("edit-date-input");
  const timeEl = document.getElementById("edit-time-input");
  const newTitle = titleEl ? titleEl.value.trim() : task.title;
  if (!newTitle) { showToast("O título não pode ficar vazio"); return; }
  task.title = newTitle;
  task.type = typeEl ? typeEl.value : task.type;
  task.dueDate = dateEl ? dateEl.value : task.dueDate;
  task.dueTime = timeEl ? timeEl.value : task.dueTime;
  state.editingTask = null;
  render();
  try { await updateTaskRow(task); showToast("Tarefa atualizada"); }
  catch (e) { showToast(`Não sincronizou (${e.message || "erro"})`); }
}

async function handleDeleteTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  try { await deleteTaskRow(task); } catch (e) { showToast(`Não sincronizou (${e.message || "erro"})`); }
  render();
}

function openScheduleModal(id) {
  const task = state.tasks.find(t => t.id === id);
  state.scheduleModal = { task, date: todayStr(), startTime: "", endTime: "" };
  render();
}

async function confirmScheduleTask() {
  const m = state.scheduleModal;
  if (!m) return;
  const date = document.getElementById("sched-date").value;
  const startTime = document.getElementById("sched-start").value;
  const endTime = document.getElementById("sched-end").value;
  const ev = {
    id: "tmp_" + Date.now(), title: m.task.title, date, startTime, endTime,
    notes: m.task.obs || "", category: "HUFAL", gcal: false, pending: true,
  };
  state.events.push(ev);
  state.scheduleModal = null;
  state.activeTab = "agenda";
  state.selectedDate = date; state.viewAnchor = date;
  render();

  const gcalId = await createCalendarEvent(ev);
  if (gcalId) { ev.gcalEventId = gcalId; ev.gcal = true; }
  ev.pending = false;
  showToast(gcalId ? "Adicionado à agenda e ao Google Calendar" : "Adicionado à agenda local");
  render();
}

function eventsForDate(d, list) {
  const source = list || state.events;
  return source.filter(e => e.date === d).sort((a, b) => (a.startTime || "99").localeCompare(b.startTime || "99"));
}

function itemClick(scope, id) {
  return scope === "hufal" ? `openHufalEdit('${id}')` : `openEditEvent('${id}')`;
}

// ============================================================
// NAVIGATION
// ============================================================
async function handleManualSync() {
  if (state.syncing) return;
  state.syncing = true;
  render();
  try {
    await loadEventsFromCalendar();
    await loadTasksFromSheet();
    await loadWorksFromSheet();
    showToast("Agenda, tarefas e obras atualizadas");
  } catch {
    showToast("Não foi possível sincronizar agora");
  }
  state.syncing = false;
  render();
}

function switchTab(tab) { state.activeTab = tab; render(); }
function setCalView(scope, v) { if (scope === "hufal") state.hufalCalView = v; else state.calView = v; render(); }
function setMode(m) { state.mode = m; render(); }
function navMonth(dir) { const d = new Date(state.viewAnchor + "T12:00:00"); d.setDate(1); d.setMonth(d.getMonth() + dir); state.viewAnchor = d.toISOString().split("T")[0]; render(); }
function navWeek(dir) { state.viewAnchor = addDays(state.viewAnchor, dir * 7); render(); }
function navDay(dir) { const nd = addDays(state.selectedDate, dir); state.selectedDate = nd; state.viewAnchor = nd; render(); }
function selectDay(d, scope) { state.selectedDate = d; if (scope === "hufal") state.hufalCalView = "diária"; else state.calView = "diária"; render(); }
function setTaskFilter(f) { state.taskFilter = f; render(); }
function setTaskType(t) { state.taskType = t; render(); }

// ============================================================
// RENDER
// ============================================================
function render() {
  document.getElementById("pending-badge").style.display = state.tasks.filter(t => !t.done).length ? "inline-block" : "none";
  document.getElementById("pending-badge").textContent = state.tasks.filter(t => !t.done).length;
  document.getElementById("tab-agenda").classList.toggle("active", state.activeTab === "agenda");
  document.getElementById("tab-tarefas").classList.toggle("active", state.activeTab === "tarefas");
  document.getElementById("tab-hufal").classList.toggle("active", state.activeTab === "hufal");

  const main = document.getElementById("main-content");
  main.classList.toggle("tab-bg-agenda", state.activeTab === "agenda");
  main.classList.toggle("tab-bg-tarefas", state.activeTab === "tarefas");
  main.classList.toggle("tab-bg-hufal", state.activeTab === "hufal");
  main.innerHTML = state.activeTab === "agenda" ? renderAgendaTab() : state.activeTab === "tarefas" ? renderTasksTab() : renderHufalTab();
  attachAgendaListeners();
  renderModal();
}

function renderViewPills(scope) {
  const cv = scope === "hufal" ? state.hufalCalView : state.calView;
  const accent = scope === "hufal" ? "var(--tab-hufal)" : "var(--tab-agenda)";
  return `<div style="display:flex;align-items:center;gap:8px;">
    <div class="view-pills">
      ${["mensal","semanal","diária"].map(v => `<button class="view-pill ${cv===v?'active':''}" style="${cv===v?`background:${accent};`:''}" onclick="setCalView('${scope}','${v}')">${v[0].toUpperCase()+v.slice(1)}</button>`).join("")}
    </div>
    <button class="nav-btn" onclick="handleManualSync()" title="Sincronizar com o Google Calendar" ${state.syncing?'disabled':''}>${state.syncing?'⏳':'🔄'}</button>
  </div>`;
}

function renderAgendaTab() {
  let body = "";
  if (state.calView === "mensal") body = renderMonthly("agenda", state.events);
  else if (state.calView === "semanal") body = renderWeekly("agenda", state.events);
  else body = renderDaily("agenda", state.events);
  return body + renderAddSection();
}

function renderMonthly(scope, eventsList) {
  scope = scope || "agenda";
  const cv = scope === "hufal" ? state.hufalCalView : state.calView;
  const anchor = new Date(state.viewAnchor + "T12:00:00");
  const year = anchor.getFullYear(), month = anchor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) { const d = new Date(year, month, -firstDay + i + 1); cells.push({ date: d.toISOString().split("T")[0], other: true, n: d.getDate() }); }
  for (let i = 1; i <= daysInMonth; i++) { const d = new Date(year, month, i); cells.push({ date: d.toISOString().split("T")[0], other: false, n: i }); }
  while (cells.length % 7 !== 0) { const d = new Date(year, month + 1, cells.length - firstDay - daysInMonth + 1); cells.push({ date: d.toISOString().split("T")[0], other: true, n: d.getDate() }); }

  const cellsHtml = cells.map(c => {
    const evs = eventsForDate(c.date, eventsList);
    const isToday = c.date === todayStr();
    const isSel = c.date === state.selectedDate;
    return `<div class="cal-cell ${c.other?'other-month':''} ${isToday?'is-today':''} ${isSel&&!isToday?'selected':''}" onclick="selectDay('${c.date}','${scope}')">
      <div class="cal-day">${c.n}</div>
      ${evs.slice(0,2).map(e => `<div class="cal-ev-pill" style="background:${TEAL_HEX[e.category]||'#6b7280'}">${e.startTime?esc(e.startTime)+' ':''}${esc(e.title)}</div>`).join("")}
      ${evs.length>2?`<div style="font-size:9px;color:#6b7280;">+${evs.length-2} mais</div>`:""}
    </div>`;
  }).join("");

  return `
    <div class="view-switch">
      <div class="nav-row">
        <button class="nav-btn" onclick="navMonth(-1)">‹</button>
        <span class="nav-label">${PT_MONTHS[month]} ${year}</span>
        <button class="nav-btn" onclick="navMonth(1)">›</button>
      </div>
      ${renderViewPills(scope)}
    </div>
    <div class="cal-grid">
      <div class="cal-head">${PT_DAYS_SHORT.map(d=>`<div class="cal-head-cell">${d}</div>`).join("")}</div>
      <div class="cal-body">${cellsHtml}</div>
    </div>`;
}

function renderWeekly(scope, eventsList) {
  scope = scope || "agenda";
  const ws = weekStart(state.viewAnchor);
  const days = Array.from({length:7}, (_,i) => addDays(ws, i));
  const wsDate = new Date(ws + "T12:00:00");
  const weDate = new Date(addDays(ws,6) + "T12:00:00");
  const label = `${wsDate.getDate()} ${PT_MONTHS[wsDate.getMonth()].slice(0,3)} — ${weDate.getDate()} ${PT_MONTHS[weDate.getMonth()].slice(0,3)}`;

  const headHtml = days.map(d => {
    const dd = new Date(d + "T12:00:00");
    const isT = d === todayStr();
    return `<div class="week-head-cell ${isT?'is-today':''}" onclick="selectDay('${d}','${scope}')">
      <div class="week-day-name">${PT_DAYS_SHORT[dd.getDay()]}</div>
      <div class="week-day-num">${dd.getDate()}</div>
    </div>`;
  }).join("");

  // Eventos da semana, separados em "com hora" e "dia inteiro"
  const weekEvsByDay = days.map(d => eventsForDate(d, eventsList));
  const allDayByDay = weekEvsByDay.map(evs => evs.filter(e => !e.startTime));
  const timedByDay = weekEvsByDay.map(evs => evs.filter(e => e.startTime));

  // Intervalo de horas: 7h-19h por defeito, expande se houver eventos fora
  let minHour = 7, maxHour = 19;
  timedByDay.flat().forEach(e => {
    const sh = parseInt(e.startTime.slice(0,2), 10);
    const eh = e.endTime ? parseInt(e.endTime.slice(0,2), 10) : sh;
    if (sh < minHour) minHour = sh;
    if (eh > maxHour) maxHour = eh;
    if (!e.endTime && sh + 1 > maxHour) maxHour = sh + 1;
  });
  const hours = [];
  for (let h = minHour; h <= maxHour; h++) hours.push(h);

  const hasAllDay = allDayByDay.some(arr => arr.length > 0);
  const alldayRowHtml = hasAllDay ? `
    <div class="week-allday-row">
      <div class="week-allday-label">Dia inteiro</div>
      ${days.map((d,i) => `<div class="week-allday-col">
        ${allDayByDay[i].map(e=>`<div class="week-ev" style="background:${TEAL_HEX[e.category]||'#6b7280'};cursor:pointer;" onclick="${itemClick(scope, e.id)}">${esc(e.title)}</div>`).join("")}
      </div>`).join("")}
    </div>` : "";

  const gridRowsHtml = hours.map(h => {
    const hStr = String(h).padStart(2,"0") + ":";
    return `<div class="week-hour-row">
      <div class="week-hour-label">${hStr}</div>
      ${days.map((d,i) => {
        const hEvs = timedByDay[i].filter(e => parseInt(e.startTime.slice(0,2),10) === h);
        return `<div class="week-hour-col" onclick="selectDay('${d}','${scope}')">
          ${hEvs.map(e=>`<div class="week-ev" style="background:${TEAL_HEX[e.category]||'#6b7280'};cursor:pointer;" onclick="event.stopPropagation();${itemClick(scope, e.id)}">${esc(e.startTime)}${e.endTime?'–'+esc(e.endTime):''}<br>${esc(e.title)}</div>`).join("")}
        </div>`;
      }).join("")}
    </div>`;
  }).join("");

  return `
    <div class="view-switch">
      <div class="nav-row">
        <button class="nav-btn" onclick="navWeek(-1)">‹</button>
        <span class="nav-label" style="font-size:12px;">${label}</span>
        <button class="nav-btn" onclick="navWeek(1)">›</button>
      </div>
      ${renderViewPills(scope)}
    </div>
    <div class="week-grid">
      <div class="week-head" style="grid-template-columns:34px repeat(7,1fr);">
        <div></div>
        ${headHtml}
      </div>
      ${alldayRowHtml}
      <div class="week-hours-scroll">${gridRowsHtml}</div>
    </div>`;
}

function renderDaily(scope, eventsList) {
  scope = scope || "agenda";
  const cardRenderer = scope === "hufal" ? renderWorkCard : renderEventCard;
  const d = new Date(state.selectedDate + "T12:00:00");
  const dayEvs = eventsForDate(state.selectedDate, eventsList);
  const withTime = dayEvs.filter(e => e.startTime);
  const allDay = dayEvs.filter(e => !e.startTime);
  const hours = Array.from({length:14}, (_,i) => i + 7);

  const alldayHtml = allDay.length ? `<div class="day-allday"><div class="allday-label">Dia inteiro</div>${allDay.map(e=>`<div class="allday-ev" style="background:${TEAL_HEX[e.category]||'#6b7280'};cursor:pointer;" onclick="${itemClick(scope, e.id)}">${esc(e.title)}</div>`).join("")}</div>` : "";

  const hoursHtml = hours.map(h => {
    const hStr = String(h).padStart(2,"0") + ":";
    const hEvs = withTime.filter(e => e.startTime.startsWith(String(h).padStart(2,"0")));
    return `<div class="hour-row">
      <div class="hour-label">${hStr}</div>
      <div class="hour-line">${hEvs.map(e=>`<div class="hour-event" style="background:${TEAL_HEX[e.category]||'#6b7280'};cursor:pointer;" onclick="${itemClick(scope, e.id)}">${esc(e.startTime)}${e.endTime?' — '+esc(e.endTime):''} · ${esc(e.title)}</div>`).join("")}</div>
    </div>`;
  }).join("");

  const emptyHtml = dayEvs.length === 0 ? `<div class="empty-day"><div style="font-size:24px;margin-bottom:6px;">📅</div>Nenhum evento para este dia.${scope==='agenda'?'<br>Adiciona abaixo.':''}</div>` : "";

  const editableListHtml = dayEvs.length ? `
    <div style="font-family:'Playfair Display',serif;font-size:13.5px;margin:14px 0 8px;">Toca num evento para editar${scope==='hufal'?' os dados da obra':' ou apagar'}</div>
    ${dayEvs.map(e => cardRenderer(e)).join("")}` : "";

  return `
    <div class="view-switch">
      <div class="nav-row">
        <button class="nav-btn" onclick="navDay(-1)">‹</button>
        <span class="nav-label" style="font-size:12px;">${state.selectedDate===todayStr()?"Hoje · ":""}${PT_DAYS_LONG[d.getDay()]}, ${d.getDate()} ${PT_MONTHS[d.getMonth()]}</span>
        <button class="nav-btn" onclick="navDay(1)">›</button>
      </div>
      ${renderViewPills(scope)}
    </div>
    <div class="day-panel">${alldayHtml}<div class="day-timeline">${hoursHtml}</div></div>
    ${emptyHtml}
    ${editableListHtml}`;
}

function renderAddSection() {
  const chatHtml = state.messages.map(m => `
    <div class="msg ${m.role}">
      <div class="avatar ${m.role}">${m.role==='ai'?'✦':'S'}</div>
      <div class="msg-bubble">${esc(m.text)}</div>
    </div>`).join("") + (state.loading ? `<div class="msg ai"><div class="avatar ai">✦</div><div class="msg-bubble"><div class="loading-dots"><span></span><span></span><span></span></div></div></div>` : "");

  return `
    <div class="add-section">
      <div class="add-toggle-row">
        <button class="toggle-btn ${state.mode==='chat'?'active':''}" onclick="setMode('chat')">💬 Ditar</button>
        <button class="toggle-btn ${state.mode==='form'?'active':''}" onclick="setMode('form')">✏️ Formulário</button>
      </div>
      ${state.mode === 'chat' ? `
        <div class="chat-area" id="chat-area">${chatHtml}</div>
        <div class="input-area">
          <div class="input-row">
            <textarea class="text-input" id="chat-input" placeholder='Ex: "Reunião BNI sexta às 7h30"' rows="1"></textarea>
            <button class="send-btn" id="chat-send-btn" ${state.loading?'disabled':''}>➤</button>
          </div>
          <div class="gcal-status"><div class="dot"></div>Google Calendar · sincronização automática</div>
        </div>
      ` : `
        <div class="manual-form">
          <div class="form-grid">
            <div class="form-field full"><label class="form-label">Título</label><input class="form-input" id="form-title" placeholder="Ex: Reunião com cliente"></div>
            <div class="form-field"><label class="form-label">Data</label><input type="date" class="form-input" id="form-date" value="${state.selectedDate}"></div>
            <div class="form-field"><label class="form-label">Categoria</label>
              <select class="form-input" id="form-category">
                ${Object.keys(TEAL_HEX).map(k=>`<option>${k}</option>`).join("")}
              </select>
            </div>
            <div class="form-field"><label class="form-label">Início</label><input type="time" class="form-input" id="form-start"></div>
            <div class="form-field"><label class="form-label">Fim</label><input type="time" class="form-input" id="form-end"></div>
            <div class="form-field full"><label class="form-label">Local</label><input class="form-input" id="form-location" placeholder="Ex: Rua do Cliente, Fundão"></div>
            <div class="form-field full"><label class="form-label">Notas</label><input class="form-input" id="form-notes" placeholder="Opcional"></div>
          </div>
          <button class="add-btn" id="form-add-btn">Adicionar à agenda</button>
        </div>
      `}
    </div>
    ${renderListForSelected("agenda", state.events)}
  `;
}

function renderListForSelected(scope, eventsList) {
  const cv = scope === "hufal" ? state.hufalCalView : state.calView;
  if (cv === "diária") return ""; // já mostrado na timeline
  const evs = eventsForDate(state.selectedDate, eventsList);
  if (!evs.length) return "";
  const d = new Date(state.selectedDate + "T12:00:00");
  const cardRenderer = scope === "hufal" ? renderWorkCard : renderEventCard;
  const noun = scope === "hufal" ? "obra" : "evento";
  return `
    <div style="font-family:'Playfair Display',serif;font-size:13.5px;margin-bottom:8px;">${PT_DAYS_LONG[d.getDay()]}, ${d.getDate()} ${PT_MONTHS[d.getMonth()]} · ${evs.length} ${noun}${evs.length!==1?'s':''}</div>
    ${evs.map(e => cardRenderer(e)).join("")}
  `;
}

function renderEventCard(e) {
  const editOpen = state.editingEvent === e.id;
  if (editOpen) {
    return `
      <div class="task-card" style="border-left:3px solid ${TEAL_HEX[e.category]||'#6b7280'};margin-bottom:7px;">
        <div class="task-obs-area" style="flex-direction:column;align-items:stretch;gap:8px;border-top:none;">
          <input class="form-input" id="evedit-title-input" value="${esc(e.title)}" placeholder="Título do evento">
          <div class="form-grid" style="margin-bottom:0;">
            <div class="form-field full"><label class="form-label">Data</label><input type="date" class="form-input" id="evedit-date-input" value="${e.date}"></div>
            <div class="form-field"><label class="form-label">Início</label><input type="time" class="form-input" id="evedit-start-input" value="${e.startTime||''}"></div>
            <div class="form-field"><label class="form-label">Fim</label><input type="time" class="form-input" id="evedit-end-input" value="${e.endTime||''}"></div>
            <div class="form-field full"><label class="form-label">Categoria</label>
              <select class="form-input" id="evedit-category-select">
                ${Object.keys(TEAL_HEX).map(k=>`<option value="${k}" ${k===e.category?'selected':''}>${k}</option>`).join("")}
              </select>
            </div>
            <div class="form-field full"><label class="form-label">Local</label><input class="form-input" id="evedit-location-input" value="${esc(e.location||'')}" placeholder="Ex: Rua do Cliente, Fundão"></div>
            <div class="form-field full"><label class="form-label">Notas</label><input class="form-input" id="evedit-notes-input" value="${esc(e.notes||'')}"></div>
          </div>
          <div style="display:flex;gap:7px;">
            <button class="modal-cancel" style="flex:1;" onclick="cancelEditEvent()">Cancelar</button>
            <button class="obs-save-btn" style="flex:1;" onclick="saveEditEvent('${e.id}')">Guardar</button>
          </div>
        </div>
      </div>`;
  }
  const mapsUrl = e.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}` : "";
  return `
    <div class="task-card" style="border-left:3px solid ${TEAL_HEX[e.category]||'#6b7280'};margin-bottom:7px;">
      <div class="task-main">
        <div style="font-size:11px;font-weight:600;color:#035e5f;min-width:36px;">${esc(e.startTime||'–')}</div>
        <div class="task-body" onclick="openEditEvent('${e.id}')" style="cursor:pointer;">
          <div class="task-title">${esc(e.title)}</div>
          ${e.notes?`<div class="task-meta">${esc(e.notes)}</div>`:""}
          ${e.location?`<div class="task-meta"><a href="${mapsUrl}" target="_blank" rel="noopener" style="color:#3b6fd4;text-decoration:none;" onclick="event.stopPropagation()">📍 ${esc(e.location)}</a></div>`:""}
          ${e.meetLink?`<div class="task-meta"><a href="${esc(e.meetLink)}" target="_blank" rel="noopener" style="color:#1a73e8;text-decoration:none;font-weight:500;" onclick="event.stopPropagation()">🎥 Entrar no Google Meet</a></div>`:""}
          <div class="task-meta">
            ${e.gcal?'<span style="color:#3b6fd4;">● Google Calendar</span>':''}
            ${e.pending?'<span style="color:#c97d1a;">A sincronizar…</span>':''}
          </div>
        </div>
        <div class="task-actions">
          <button class="icon-btn" onclick="openEditEvent('${e.id}')" title="Editar">✏️</button>
          <button class="icon-btn danger" onclick="handleDeleteEvent('${e.id}')">×</button>
        </div>
      </div>
    </div>`;
}

function renderTasksTab() {
  const total = state.tasks.length;
  const pending = state.tasks.filter(t=>!t.done).length;
  const done = state.tasks.filter(t=>t.done).length;
  const filters = ["Todos","Pendentes","Concluídas", ...TASK_TYPES.map(t=>t.value)];
  const filtered = state.taskFilter==="Todos"?state.tasks:state.taskFilter==="Pendentes"?state.tasks.filter(t=>!t.done):state.taskFilter==="Concluídas"?state.tasks.filter(t=>t.done):state.tasks.filter(t=>t.type===state.taskFilter);

  const tasksHtml = filtered.length === 0
    ? `<div class="empty-state"><div style="font-size:26px;margin-bottom:6px;">✅</div>Sem tarefas aqui.<br>Adiciona algo acima.</div>`
    : filtered.map(t => {
        const typeInfo = TASK_TYPES.find(tt=>tt.value===t.type) || TASK_TYPES[4];
        const obsOpen = state.expandedObs === t.id;
        const editOpen = state.editingTask === t.id;
        return `
        <div class="task-card ${t.done?'done':''}">
          <div class="task-main">
            <button class="task-checkbox ${t.done?'checked':''}" onclick="toggleTaskDone('${t.id}')">${t.done?'<span class="check-icon">✓</span>':''}</button>
            <div class="task-body" ${editOpen ? "" : `onclick="openEditTask('${t.id}')" style="cursor:pointer;"`}>
              ${editOpen ? "" : `<div class="task-title ${t.done?'done-text':''}">${esc(t.title)}</div>`}
              ${editOpen ? "" : `<div class="task-meta">
                <span style="color:${typeInfo.color};font-weight:500;">${typeInfo.icon} ${t.type}</span>
                <span>· ${esc(t.createdAt)}</span>
                ${t.obs?'<span style="color:#035e5f;">· 📝</span>':''}
                ${t.dueDate?`<span style="color:${(t.dueDate < todayStr() && !t.done) ? '#e57373' : '#c97d1a'};font-weight:500;">· ⏰ ${(t.dueDate < todayStr() && !t.done) ? 'Atrasada · ' : ''}${esc(formatDueLabel(t.dueDate))}${t.dueTime?' às '+esc(t.dueTime):''}</span>`:''}
              </div>`}
            </div>
            <div class="task-actions">
              ${editOpen ? "" : `<button class="icon-btn" onclick="openEditTask('${t.id}')" title="Editar">✏️</button>`}
              ${editOpen ? "" : `<button class="icon-btn" onclick="${obsOpen?`render()`:`openObs('${t.id}')`}" title="Observações">📝</button>`}
              ${editOpen ? "" : `<button class="icon-btn" onclick="openScheduleModal('${t.id}')" title="Agendar">📅</button>`}
              ${editOpen ? "" : `<button class="icon-btn danger" onclick="handleDeleteTask('${t.id}')">×</button>`}
            </div>
          </div>
          ${editOpen ? `
            <div class="task-obs-area" style="flex-direction:column;align-items:stretch;gap:8px;">
              <input class="form-input" id="edit-title-input" value="${esc(t.title)}" placeholder="Título da tarefa" onkeydown="if(event.key==='Enter'){event.preventDefault();saveEditTask('${t.id}');}">
              <select class="form-input" id="edit-type-select">
                ${TASK_TYPES.map(tt => `<option value="${tt.value}" ${tt.value===t.type?'selected':''}>${tt.icon} ${tt.value}</option>`).join("")}
              </select>
              <div class="form-grid" style="margin-bottom:0;">
                <div class="form-field"><label class="form-label">Data limite</label><input type="date" class="form-input" id="edit-date-input" value="${t.dueDate||''}"></div>
                <div class="form-field"><label class="form-label">Hora limite</label><input type="time" class="form-input" id="edit-time-input" value="${t.dueTime||''}"></div>
              </div>
              <div style="display:flex;gap:7px;">
                <button class="modal-cancel" style="flex:1;" onclick="cancelEditTask()">Cancelar</button>
                <button class="obs-save-btn" style="flex:1;" onclick="saveEditTask('${t.id}')">Guardar</button>
              </div>
            </div>` : ""}
          ${t.obs && !obsOpen && !editOpen ? `<div class="task-obs-display"><div class="obs-label">Observação</div>${esc(t.obs)}</div>` : ""}
          ${obsOpen ? `
            <div class="task-obs-area">
              <textarea class="obs-input" id="obs-textarea" placeholder="Notas, referências…" rows="2"></textarea>
              <button class="obs-save-btn" onclick="saveObs('${t.id}')">Guardar</button>
            </div>` : ""}
        </div>`;
      }).join("");

  return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <button class="nav-btn" onclick="handleManualSync()" title="Sincronizar com o Google Sheet" ${state.syncing?'disabled':''}>${state.syncing?'⏳ A sincronizar…':'🔄 Sincronizar'}</button>
    </div>
    <div class="task-stats">
      <div class="stat-box"><div class="stat-num">${total}</div><div class="stat-label">Total</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#e57373;">${pending}</div><div class="stat-label">Pendentes</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#4caf50;">${done}</div><div class="stat-label">Concluídas</div></div>
    </div>
    <div class="task-input-area">
      <div class="task-input-row">
        <textarea class="text-input" id="task-input" placeholder='Ex: "Orçamento janelas apartamento Fundão"' rows="1"></textarea>
        <button class="send-btn" id="task-add-btn" ${state.taskLoading?'disabled':''}>${state.taskLoading?'…':'+'}</button>
      </div>
      <div class="task-type-row">
        ${TASK_TYPES.map(t => `<button class="type-chip ${state.taskType===t.value?'selected':''}" style="${state.taskType===t.value?`background:${t.color}`:''}" onclick="setTaskType('${t.value}')">${t.icon} ${t.value}</button>`).join("")}
      </div>
    </div>
    <div class="filter-row">
      ${filters.map(f=>`<button class="filter-chip ${state.taskFilter===f?'active':''}" onclick="setTaskFilter('${f}')">${f}</button>`).join("")}
    </div>
    ${tasksHtml}
  `;
}

// ============================================================
// SEPARADOR HUFAL — quadro de obras independente (não sincroniza com o Google Calendar)
// ============================================================
function setHufalMode(m) { state.hufalMode = m; render(); }

async function handleHufalSend() {
  const input = document.getElementById("hufal-chat-input");
  const text = input.value.trim();
  if (!text || state.hufalLoading) return;
  input.value = "";
  state.hufalMessages.push({ role: "user", text });
  state.hufalLoading = true;
  render();

  let w = null;
  try {
    const p = await parseWorkText(text);
    w = {
      id: "w_" + Date.now(), title: p.title || text, date: p.date || todayStr(),
      startTime: p.startTime || "", endTime: p.endTime || "",
      client: p.client || "", address: p.address || "",
      workType: WORK_TYPES.includes(p.workType) ? p.workType : "",
      team: p.team || "", techNotes: "", createdAt: new Date().toLocaleDateString("pt-PT"), category: "HUFAL",
    };
    state.works.push(w);
    state.hufalMessages.push({ role: "ai", text: p.reply || `Adicionei ao quadro: ${w.title}` });
    state.selectedDate = w.date; state.viewAnchor = w.date;
  } catch (e) {
    state.hufalMessages.push({ role: "ai", text: `Não consegui interpretar (${e.message || "erro"}). Tenta o formulário?` });
  }
  state.hufalLoading = false;
  render();

  if (w) {
    try {
      await appendWorkToSheet(w);
    } catch (e) {
      showToast(`Guardada só neste dispositivo por agora (${e.message || "erro de ligação"})`);
    }
    render();
  }
}

async function handleHufalFormAdd() {
  const title = document.getElementById("hufal-form-title")?.value.trim();
  if (!title) return;
  const w = {
    id: "w_" + Date.now(), title,
    date: document.getElementById("hufal-form-date")?.value || todayStr(),
    startTime: document.getElementById("hufal-form-start")?.value || "",
    endTime: document.getElementById("hufal-form-end")?.value || "",
    client: document.getElementById("hufal-form-client")?.value.trim() || "",
    address: document.getElementById("hufal-form-address")?.value.trim() || "",
    workType: document.getElementById("hufal-form-type")?.value || "",
    team: document.getElementById("hufal-form-team")?.value.trim() || "",
    techNotes: document.getElementById("hufal-form-technotes")?.value.trim() || "",
    createdAt: new Date().toLocaleDateString("pt-PT"), category: "HUFAL",
  };
  state.works.push(w);
  state.selectedDate = w.date; state.viewAnchor = w.date;
  render();
  try {
    await appendWorkToSheet(w);
    showToast("Obra adicionada ao quadro HUFAL");
  } catch (e) {
    showToast(`Guardada só neste dispositivo por agora (${e.message || "erro de ligação"})`);
  }
  render();
}

function openHufalEdit(id) {
  state.hufalEditingWork = id;
  render();
  setTimeout(() => { document.getElementById("hufal-edit-title")?.focus(); }, 0);
}

function cancelHufalEdit() {
  state.hufalEditingWork = null;
  render();
}

async function saveHufalWork(id) {
  const w = state.works.find(x => x.id === id);
  if (!w) return;
  const title = document.getElementById("hufal-edit-title")?.value.trim();
  if (!title) { showToast("O título não pode ficar vazio"); return; }
  w.title = title;
  w.date = document.getElementById("hufal-edit-date")?.value || w.date;
  w.startTime = document.getElementById("hufal-edit-start")?.value || "";
  w.endTime = document.getElementById("hufal-edit-end")?.value || "";
  w.client = document.getElementById("hufal-client-input")?.value.trim() || "";
  w.address = document.getElementById("hufal-address-input")?.value.trim() || "";
  w.workType = document.getElementById("hufal-type-select")?.value || "";
  w.team = document.getElementById("hufal-team-input")?.value.trim() || "";
  w.techNotes = document.getElementById("hufal-technotes-input")?.value.trim() || "";
  state.hufalEditingWork = null;
  state.selectedDate = w.date; state.viewAnchor = w.date;
  render();
  try { await updateWorkRow(w); showToast("Dados da obra guardados"); }
  catch (e) { showToast(`Não sincronizou (${e.message || "erro"})`); }
}

async function handleDeleteWork(id) {
  const w = state.works.find(x => x.id === id);
  if (!w) return;
  try { await deleteWorkRow(w); } catch (e) { showToast(`Não sincronizou (${e.message || "erro"})`); }
  render();
}

function renderWorkCard(w) {
  const editOpen = state.hufalEditingWork === w.id;
  const d = new Date(w.date + "T12:00:00");
  const dateLabel = `${PT_DAYS_SHORT[d.getDay()]}, ${d.getDate()} ${PT_MONTHS[d.getMonth()].slice(0,3)}`;

  if (editOpen) {
    return `
      <div class="task-card" style="border-left:3px solid var(--tab-hufal);margin-bottom:8px;">
        <div class="task-obs-area" style="flex-direction:column;align-items:stretch;gap:8px;border-top:none;">
          <input class="form-input" id="hufal-edit-title" value="${esc(w.title)}" placeholder="Título da obra">
          <div class="form-grid" style="margin-bottom:0;">
            <div class="form-field full"><label class="form-label">Data</label><input type="date" class="form-input" id="hufal-edit-date" value="${w.date}"></div>
            <div class="form-field"><label class="form-label">Início</label><input type="time" class="form-input" id="hufal-edit-start" value="${w.startTime||''}"></div>
            <div class="form-field"><label class="form-label">Fim</label><input type="time" class="form-input" id="hufal-edit-end" value="${w.endTime||''}"></div>
            <div class="form-field full"><label class="form-label">Cliente</label><input class="form-input" id="hufal-client-input" value="${esc(w.client||'')}" placeholder="Nome do cliente"></div>
            <div class="form-field full"><label class="form-label">Morada</label><input class="form-input" id="hufal-address-input" value="${esc(w.address||'')}" placeholder="Morada da obra"></div>
            <div class="form-field full"><label class="form-label">Tipo de trabalho</label>
              <select class="form-input" id="hufal-type-select">
                <option value="">— Selecionar —</option>
                ${WORK_TYPES.map(t => `<option value="${t}" ${t===w.workType?'selected':''}>${t}</option>`).join("")}
              </select>
            </div>
            <div class="form-field full"><label class="form-label">Equipa / Responsável</label><input class="form-input" id="hufal-team-input" value="${esc(w.team||'')}" placeholder="Ex: Hugo, equipa externa…"></div>
            <div class="form-field full"><label class="form-label">Notas técnicas</label><input class="form-input" id="hufal-technotes-input" value="${esc(w.techNotes||'')}" placeholder="Medidas, materiais, observações…"></div>
          </div>
          <div style="display:flex;gap:7px;">
            <button class="modal-cancel" style="flex:1;" onclick="cancelHufalEdit()">Cancelar</button>
            <button class="obs-save-btn" style="flex:1;background:var(--tab-hufal);" onclick="saveHufalWork('${w.id}')">Guardar</button>
          </div>
        </div>
      </div>`;
  }

  const mapsUrl = w.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(w.address)}` : "";
  return `
    <div class="task-card" style="border-left:3px solid var(--tab-hufal);margin-bottom:8px;">
      <div class="task-main">
        <div style="font-size:11px;font-weight:600;color:var(--tab-hufal);min-width:62px;">${dateLabel}${w.startTime?'<br>'+esc(w.startTime):''}</div>
        <div class="task-body" onclick="openHufalEdit('${w.id}')" style="cursor:pointer;">
          <div class="task-title">${esc(w.title)}</div>
          ${w.workType?`<div class="task-meta"><span style="color:var(--tab-hufal);font-weight:500;">🔧 ${esc(w.workType)}</span></div>`:""}
          ${w.client?`<div class="task-meta">👤 ${esc(w.client)}</div>`:""}
          ${w.address?`<div class="task-meta"><a href="${mapsUrl}" target="_blank" rel="noopener" style="color:#3b6fd4;text-decoration:none;" onclick="event.stopPropagation()">📍 ${esc(w.address)}</a></div>`:""}
          ${w.team?`<div class="task-meta">🧑‍🔧 ${esc(w.team)}</div>`:""}
        </div>
        <div class="task-actions">
          <button class="icon-btn" onclick="openHufalEdit('${w.id}')" title="Editar">✏️</button>
          <button class="icon-btn danger" onclick="handleDeleteWork('${w.id}')">×</button>
        </div>
      </div>
    </div>`;
}

function renderHufalAddSection() {
  const chatHtml = state.hufalMessages.map(m => `
    <div class="msg ${m.role}">
      <div class="avatar ${m.role}" style="${m.role==='ai'?`background:color-mix(in srgb, var(--tab-hufal) 18%, white);color:var(--tab-hufal);`:`background:var(--tab-hufal);`}">${m.role==='ai'?'✦':'S'}</div>
      <div class="msg-bubble">${esc(m.text)}</div>
    </div>`).join("") + (state.hufalLoading ? `<div class="msg ai"><div class="avatar ai">✦</div><div class="msg-bubble"><div class="loading-dots"><span></span><span></span><span></span></div></div></div>` : "");

  return `
    <div class="add-section">
      <div class="add-toggle-row">
        <button class="toggle-btn ${state.hufalMode==='chat'?'active':''}" style="${state.hufalMode==='chat'?`background:var(--tab-hufal);border-color:var(--tab-hufal);`:''}" onclick="setHufalMode('chat')">💬 Ditar</button>
        <button class="toggle-btn ${state.hufalMode==='form'?'active':''}" style="${state.hufalMode==='form'?`background:var(--tab-hufal);border-color:var(--tab-hufal);`:''}" onclick="setHufalMode('form')">✏️ Formulário</button>
      </div>
      ${state.hufalMode === 'chat' ? `
        <div class="chat-area" id="hufal-chat-area">${chatHtml}</div>
        <div class="input-area">
          <div class="input-row">
            <textarea class="text-input" id="hufal-chat-input" placeholder='Ex: "Instalação cliente Fundão sexta às 9h"' rows="1"></textarea>
            <button class="send-btn" id="hufal-send-btn" style="background:var(--tab-hufal);" ${state.hufalLoading?'disabled':''}>➤</button>
          </div>
          <div class="gcal-status"><div class="dot"></div>Quadro HUFAL · guardado no Google Sheet, não sincroniza com o Google Calendar</div>
        </div>
      ` : `
        <div class="manual-form">
          <div class="form-grid">
            <div class="form-field full"><label class="form-label">Título</label><input class="form-input" id="hufal-form-title" placeholder="Ex: Instalação janelas — Cliente Fundão"></div>
            <div class="form-field"><label class="form-label">Data</label><input type="date" class="form-input" id="hufal-form-date" value="${state.selectedDate}"></div>
            <div class="form-field"><label class="form-label">Tipo de trabalho</label>
              <select class="form-input" id="hufal-form-type">
                <option value="">— Selecionar —</option>
                ${WORK_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}
              </select>
            </div>
            <div class="form-field"><label class="form-label">Início</label><input type="time" class="form-input" id="hufal-form-start"></div>
            <div class="form-field"><label class="form-label">Fim</label><input type="time" class="form-input" id="hufal-form-end"></div>
            <div class="form-field full"><label class="form-label">Cliente</label><input class="form-input" id="hufal-form-client" placeholder="Nome do cliente"></div>
            <div class="form-field full"><label class="form-label">Morada</label><input class="form-input" id="hufal-form-address" placeholder="Morada da obra"></div>
            <div class="form-field full"><label class="form-label">Equipa / Responsável</label><input class="form-input" id="hufal-form-team" placeholder="Ex: Hugo, equipa externa…"></div>
            <div class="form-field full"><label class="form-label">Notas técnicas</label><input class="form-input" id="hufal-form-technotes" placeholder="Medidas, materiais, observações…"></div>
          </div>
          <button class="add-btn" id="hufal-form-add-btn" style="background:var(--tab-hufal);">Adicionar ao quadro HUFAL</button>
        </div>
      `}
    </div>
  `;
}

function renderHufalTab() {
  const upcoming = state.works.filter(w => w.date >= todayStr());
  const past = state.works.filter(w => w.date < todayStr());

  let body = "";
  if (state.hufalCalView === "mensal") body = renderMonthly("hufal", state.works);
  else if (state.hufalCalView === "semanal") body = renderWeekly("hufal", state.works);
  else body = renderDaily("hufal", state.works);

  return `
    <div class="task-stats">
      <div class="stat-box"><div class="stat-num" style="color:var(--tab-hufal);">${state.works.length}</div><div class="stat-label">Total</div></div>
      <div class="stat-box"><div class="stat-num" style="color:#3b6fd4;">${upcoming.length}</div><div class="stat-label">Por vir</div></div>
      <div class="stat-box"><div class="stat-num" style="color:var(--gray);">${past.length}</div><div class="stat-label">Passadas</div></div>
    </div>
    <div style="font-size:11.5px;color:var(--gray);margin-bottom:12px;">Quadro de planeamento HUFAL. É indicativo, fica guardado no teu Google Sheet e não sincroniza com o Google Calendar.</div>
    ${body}
    ${renderListForSelected("hufal", state.works)}
    ${renderHufalAddSection()}
  `;
}

function renderModal() {
  const root = document.getElementById("modal-root");
  if (!state.scheduleModal) { root.innerHTML = ""; return; }
  const m = state.scheduleModal;
  root.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this){state.scheduleModal=null;render();}">
      <div class="modal" onclick="event.stopPropagation()">
        <h3>Agendar tarefa</h3>
        <p style="font-size:12.5px;color:#6b7280;margin-bottom:12px;">${esc(m.task.title)}</p>
        <div class="form-grid">
          <div class="form-field full"><label class="form-label">Data</label><input type="date" class="form-input" id="sched-date" value="${m.date}"></div>
          <div class="form-field"><label class="form-label">Início</label><input type="time" class="form-input" id="sched-start"></div>
          <div class="form-field"><label class="form-label">Fim</label><input type="time" class="form-input" id="sched-end"></div>
        </div>
        <div class="modal-actions">
          <button class="modal-cancel" onclick="state.scheduleModal=null;render();">Cancelar</button>
          <button class="modal-confirm" id="sched-confirm-btn">Adicionar à agenda</button>
        </div>
      </div>
    </div>`;
  const confirmBtn = document.getElementById("sched-confirm-btn");
  if (confirmBtn) confirmBtn.onclick = confirmScheduleTask;
}

function attachAgendaListeners() {
  const chatInput = document.getElementById("chat-input");
  if (chatInput) {
    chatInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); } });
  }
  const chatSend = document.getElementById("chat-send-btn");
  if (chatSend) chatSend.onclick = handleSendChat;

  const formAdd = document.getElementById("form-add-btn");
  if (formAdd) formAdd.onclick = handleFormAdd;

  const taskInput = document.getElementById("task-input");
  if (taskInput) taskInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddTask(); } });
  const taskAdd = document.getElementById("task-add-btn");
  if (taskAdd) taskAdd.onclick = handleAddTask;

  const chatArea = document.getElementById("chat-area");
  if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;

  const hufalChatInput = document.getElementById("hufal-chat-input");
  if (hufalChatInput) {
    hufalChatInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleHufalSend(); } });
  }
  const hufalSend = document.getElementById("hufal-send-btn");
  if (hufalSend) hufalSend.onclick = handleHufalSend;

  const hufalFormAdd = document.getElementById("hufal-form-add-btn");
  if (hufalFormAdd) hufalFormAdd.onclick = handleHufalFormAdd;

  const hufalChatArea = document.getElementById("hufal-chat-area");
  if (hufalChatArea) hufalChatArea.scrollTop = hufalChatArea.scrollHeight;
}

// ============================================================
// INIT
// ============================================================
window.addEventListener("load", () => {
  const missing = checkConfig();
  const warningEl = document.getElementById("setup-warning");
  if (missing.length) {
    warningEl.style.display = "block";
    warningEl.textContent = `Configuração incompleta: ${missing.join(", ")}. Edita config.js.`;
  }
  initGoogleAuth();
});
