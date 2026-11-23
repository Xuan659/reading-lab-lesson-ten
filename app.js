const GROUPS = [1, 2, 3, 4, 5, 6, 7];
const WORKSHEETS = {
  meaning: {
    type: "meaning",
    kicker: "第一階段・小組討論",
    title: "意義段和自然段",
    intro: "依照學習單，先填自然段範圍，再完成每一列的歸納原因。",
    rows: 5
  },
  story: {
    type: "story",
    kicker: "第二階段・第二堂課・小組討論",
    title: "課文大意｜故事結構",
    intro: "請根據課文，整理故事重點。讀提示、找證據，再把相近或重複的內容合起來，用自己的話寫。",
    guidance: [
      "讀提示：確認這部分要整理什麼。",
      "找證據：在課文中找出相關的重要語句。",
      "合併說：把相近、重複的內容合起來，用自己的話寫。"
    ],
    reminder: [
      "不必抄下每個人的對話或每個動作。",
      "保留重要事件，以及影響故事發展的想法或情感轉變。"
    ],
    sections: [
      { id: "background", label: "故事背景", prompts: ["故事發生在什麼時候？", "故事發生在哪裡？", "誰是主角？"] },
      { id: "development", label: "問題發展", prompts: ["那時（裡）有什麼特別的事情使故事發生？", "主角對那件事的感覺或想法是什麼？"] },
      { id: "solution", label: "問題解決", prompts: ["主角的態度有沒有什麼轉變？", "接著，她們做了什麼或決定了什麼？", "母親回家後，發生哪些重要的事？"] },
      { id: "climax", label: "情感高潮", prompts: ["讀完父親的信，姐妹們的想法有什麼改變？"] },
      { id: "ending", label: "故事結尾", prompts: ["故事最後，家人一起做了什麼？"] }
    ]
  }
};

const DEMO_KEY = "reading-lab-lesson-ten-v2";
const params = new URLSearchParams(location.search);
let selectedGroup = Number(sessionStorage.getItem("reading-lab-group")) || null;
let activeStage = "meaning";
let teacherStage = "meaning";
let state = { submissions: {}, drafts: {}, storyOpen: false };
let saveTimer;
let useApi = true;
let teacherAuthenticated = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadDemo() {
  try { state = JSON.parse(localStorage.getItem(DEMO_KEY)) || state; } catch { /* use empty state */ }
}
function saveDemo() { localStorage.setItem(DEMO_KEY, JSON.stringify(state)); }
async function api(path, options = {}) {
  if (!useApi) throw new Error("offline preview");
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  if (!response.ok) { const error = new Error("API unavailable"); error.status = response.status; throw error; }
  return response.json();
}
async function refreshState() {
  useApi = true;
  try {
    const query = teacherAuthenticated ? "?teacher=1" : selectedGroup ? `?group=${selectedGroup}` : "";
    state = await api(`/api/state${query}`);
    saveDemo();
  } catch {
    useApi = false;
    loadDemo();
  }
  paint();
}
async function persist(path, body) {
  saveDemo();
  setSaveStatus("儲存中…");
  try {
    await api(path, { method: "POST", body: JSON.stringify(body) });
    useApi = true;
    setSaveStatus("已同步");
    await refreshState();
  } catch {
    setSaveStatus("已儲存在此裝置");
  }
}
function setSaveStatus(message) {
  const node = $("#saveStatus");
  if (node) node.innerHTML = `<span></span>${message}`;
}
function key(group, stage) { return `${group}:${stage}`; }
function getAnswer(group, stage) { return state.submissions[key(group, stage)]?.answers || state.drafts[key(group, stage)] || {}; }
function setGroup(group) { selectedGroup = group; sessionStorage.setItem("reading-lab-group", String(group)); }

function buildGroupPicker() {
  const picker = $("#groupPicker");
  picker.innerHTML = "";
  GROUPS.forEach(group => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-choice";
    button.innerHTML = `<span>第 ${group} 組</span><small>${group === 7 ? "3 位小作家" : "4 位小作家"}</small><b>進入小組 ↗</b>`;
    button.onclick = () => { setGroup(group); enterGroup(); };
    picker.append(button);
  });
}
function enterGroup() {
  if (!selectedGroup) return;
  $("#homePanel").classList.add("hidden");
  $("#stagePanel").classList.add("hidden");
  $("#groupPanel").classList.add("hidden");
  $("#worksheetPanel").classList.remove("hidden");
  renderWorksheet();
}
function renderWorksheet() {
  const sheet = WORKSHEETS[activeStage];
  const answer = getAnswer(selectedGroup, activeStage);
  $("#workKicker").textContent = `第 ${selectedGroup} 組・${sheet.kicker}`;
  $("#workPageTitle").textContent = sheet.title;
  $("#stageTitle").textContent = sheet.title;
  $("#stageKicker").textContent = sheet.kicker;
  $("#stageMessage").innerHTML = `<span class="message-icon">✦</span><span>${sheet.intro}</span>`;
  $$(".stage-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.stage === activeStage);
    tab.classList.toggle("locked", tab.dataset.stage === "story" && !state.storyOpen);
  });
  $("#questions").innerHTML = sheet.type === "meaning" ? renderMeaningSheet(sheet, answer) : renderStorySheet(sheet, answer);
  $$("#questions textarea").forEach(autoResizeTextarea);
  const submitted = !!state.submissions[key(selectedGroup, activeStage)];
  $("#completionBadge").textContent = submitted ? "已送出" : "尚未完成";
  $("#completionBadge").classList.toggle("done", submitted);
  $("#questions").oninput = event => {
    if (!event.target.matches(".answer-input")) return;
    if (event.target instanceof HTMLTextAreaElement) autoResizeTextarea(event.target);
    const answers = readForm();
    const answerKey = key(selectedGroup, activeStage);
    state.drafts[answerKey] = answers;
    if (state.submissions[answerKey]) {
      delete state.submissions[answerKey];
      $("#completionBadge").textContent = "修改中・尚未重新送出";
      $("#completionBadge").classList.remove("done");
    }
    saveDemo();
    setSaveStatus("自動儲存中…");
    if (activeStage === "meaning") updateMeaningPreview(event.target);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist("/api/draft", { group: selectedGroup, stage: activeStage, answers }), 650);
  };
  const addMeaningRowButton = $("#addMeaningRow");
  if (addMeaningRowButton) addMeaningRowButton.onclick = addMeaningRow;
}
function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.max(textarea.scrollHeight, parseFloat(getComputedStyle(textarea).minHeight) || 0) + "px";
}
function updateMeaningPreview(input) {
  const match = input.name.match(/^m(\d+)_(from|to)$/);
  if (!match) return;
  const target = $(`[data-fill="m${match[1]}_${match[2]}"]`);
  if (target) target.textContent = input.value.trim() || "＿＿";
}
function renderMeaningSheet(sheet, answer) {
  const rowCount = Math.max(sheet.rows, Number(answer._rowCount) || sheet.rows);
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const n = index + 1;
    const value = id => escapeHtml(answer[id] || "");
    return `<article class="meaning-row">
      <div class="meaning-index"><span>意義段</span><strong>${n}</strong></div>
      <div class="meaning-body">
        <div class="meaning-natural"><span class="column-label">自然段</span><span>第</span>
          <input class="answer-input inline-blank number-blank" name="m${n}_from" inputmode="numeric" aria-label="意義段${n}起始自然段" value="${value(`m${n}_from`)}" placeholder="　" />
          <span>至第</span><input class="answer-input inline-blank number-blank" name="m${n}_to" inputmode="numeric" aria-label="意義段${n}結束自然段" value="${value(`m${n}_to`)}" placeholder="　" /><span>段</span>
        </div>
        <div class="meaning-reason"><span class="column-label">歸納原因</span>
          <div class="sentence-fill">我把第 <span class="filled-value" data-fill="m${n}_from">${value(`m${n}_from`) || "＿＿"}</span> 至第 <span class="filled-value" data-fill="m${n}_to">${value(`m${n}_to`) || "＿＿"}</span> 段放在一起，因為它們都在寫
            <textarea class="answer-input inline-blank phrase-blank" name="m${n}_together" rows="1" aria-label="意義段${n}共同內容" placeholder="輸入共同重點">${value(`m${n}_together`)}</textarea>。而下一段則在寫
            <textarea class="answer-input inline-blank phrase-blank" name="m${n}_next" rows="1" aria-label="意義段${n}下一段內容" placeholder="輸入下一段重點">${value(`m${n}_next`)}</textarea>，所以我在這裡分段。
          </div>
        </div>
      </div>
    </article>`;
  }).join("");
  return `<div class="worksheet-instructions"><b>L10 意義段和自然段</b><span>照著學習單的句型，把答案填進空格。</span></div>
    <div class="meaning-sheet"><div class="meaning-head"><span>意義段</span><span>自然段與歸納原因</span></div>${rows}</div>
    <input type="hidden" class="answer-input" name="_rowCount" value="${rowCount}" />
    <button id="addMeaningRow" class="add-row-button" type="button">＋ 新增意義段欄位</button>`;
}
async function addMeaningRow() {
  const answerKey = key(selectedGroup, "meaning");
  const answers = readForm();
  const nextCount = Math.max(WORKSHEETS.meaning.rows, Number(answers._rowCount) || WORKSHEETS.meaning.rows) + 1;
  answers._rowCount = String(nextCount);
  delete state.submissions[answerKey];
  state.drafts[answerKey] = answers;
  saveDemo();
  renderWorksheet();
  await persist("/api/draft", { group: selectedGroup, stage: "meaning", answers });
}
function renderStorySheet(sheet, answer) {
  const rows = sheet.sections.map(section => `<article class="story-row">
    <div class="story-element"><span>元素</span><b>${section.label}</b></div>
    <div class="story-focus"><span class="column-label">重點說明</span><ul>${section.prompts.map(prompt => `<li>${prompt}</li>`).join("")}</ul></div>
    <div class="story-evidence"><span class="column-label">摘錄文本重點</span><p>從課文找出支持上方整理的語句或線索。</p>
      <textarea class="answer-input story-answer" name="${section.id}_evidence" rows="3" aria-label="${section.label}摘錄文本重點" placeholder="輸入課文中的重要語句或關鍵線索……">${escapeHtml(answer[`${section.id}_evidence`] || "")}</textarea></div>
  </article>`).join("");
  return `<div class="story-guide"><p class="story-sheet-name">課文大意 ✿　六上第 10 課｜耶誕節</p><p class="story-task">請根據課文，整理故事重點。</p>
    <div class="guide-steps">${sheet.guidance.map((item, i) => `<div><span>0${i + 1}</span>${item}</div>`).join("")}</div>
    <div class="guide-reminder"><b>提醒</b>${sheet.reminder.map(item => `<span>• ${item}</span>`).join("")}</div></div>
    <div class="story-table-head"><span>元素與提示</span><span>重點說明</span><span>摘錄文本重點</span></div><div class="story-sheet">${rows}</div>`;
}
function readForm() { return Object.fromEntries($$(".answer-input").map(input => [input.name, input.value])); }
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character]));
}
async function teacherMode(on) {
  $("#studentView").classList.toggle("hidden", on);
  $("#teacherView").classList.toggle("hidden", !on);
  if (!on) return;
  if (useApi) {
    try {
      const result = await api("/api/teacher/session");
      teacherAuthenticated = !!result.authenticated;
      if (!result.configured) $("#loginError").textContent = "教師入口尚未完成設定。";
    } catch {
      useApi = false;
      $("#teacherPreview").classList.remove("hidden");
    }
  } else {
    $("#teacherPreview").classList.remove("hidden");
  }
  $("#teacherLoginPanel").classList.toggle("hidden", teacherAuthenticated);
  $("#teacherDashboard").classList.toggle("hidden", !teacherAuthenticated);
  if (teacherAuthenticated) renderTeacher();
}
function submitted(group, stage) { return state.submissions[key(group, stage)] || null; }
function flattenAnswer(answers) {
  if (teacherStage === "meaning") {
    return Array.from({ length: Math.max(WORKSHEETS.meaning.rows, Number(answers._rowCount) || WORKSHEETS.meaning.rows) }, (_, index) => {
      const n = index + 1;
      const from = answers[`m${n}_from`] || "＿";
      const to = answers[`m${n}_to`] || "＿";
      const shared = answers[`m${n}_together`] || "尚未填寫";
      const following = answers[`m${n}_next`] || "尚未填寫";
      return `${n}. 第 ${from} 至第 ${to} 段｜共同重點：${shared}；下一段：${following}`;
    }).join("\n");
  }
  return WORKSHEETS.story.sections.map(section => {
    const evidence = answers[`${section.id}_evidence`];
    return evidence ? `${section.label}：${evidence}` : "";
  }).filter(Boolean).join("\n");
}
function renderTeacher() {
  $$("[data-teacher-stage]").forEach(button => button.classList.toggle("active", button.dataset.teacherStage === teacherStage));
  const control = $("#stageControl");
  if (control) {
    control.textContent = state.storyOpen ? "關閉第二階段" : "開放第二階段";
    control.classList.toggle("closed", !!state.storyOpen);
  }
  const grid = $("#teacherGrid");
  grid.innerHTML = "";
  GROUPS.forEach(group => {
    const answer = submitted(group, teacherStage);
    const card = document.createElement("article");
    card.className = "team-card" + (answer ? "" : " empty");
    card.innerHTML = `<div class="team-card-top"><h3>第 ${group} 組</h3><span class="state ${answer ? "done" : ""}">${answer ? "已送出" : "等待作答"}</span></div><div class="team-preview">${answer ? escapeHtml(flattenAnswer(answer.answers) || "已送出，尚未填寫內容") : "小組答案會顯示在這裡"}</div>`;
    card.onclick = () => openAnswer(group, answer);
    grid.append(card);
  });
}
function paint() {
  const studentHasFocus = $("#worksheetPanel").contains(document.activeElement);
  if (!$("#studentView").classList.contains("hidden") && selectedGroup && !studentHasFocus) renderWorksheet();
  const lock = $("#stageLockLabel");
  if (lock) lock.classList.toggle("hidden", !!state.storyOpen);
  if (!$("#teacherView").classList.contains("hidden") && teacherAuthenticated) renderTeacher();
}
function openAnswer(group, submission) {
  const sheet = WORKSHEETS[teacherStage];
  const answers = submission?.answers || {};
  let items;
  if (sheet.type === "meaning") {
    items = Array.from({ length: Math.max(sheet.rows, Number(answers._rowCount) || sheet.rows) }, (_, index) => {
      const n = index + 1;
      const from = answers[`m${n}_from`] || "＿＿";
      const to = answers[`m${n}_to`] || "＿＿";
      const together = answers[`m${n}_together`] || "＿＿＿＿";
      const next = answers[`m${n}_next`] || "＿＿＿＿";
      return `<div class="answer-item meaning-answer meaning-color-${((n - 1) % 6) + 1}"><b>意義段 ${n}｜第 ${escapeHtml(from)} 至第 ${escapeHtml(to)} 段</b><p>我把第 ${escapeHtml(from)} 至第 ${escapeHtml(to)} 段放在一起，因為它們都在寫 ${escapeHtml(together)}。而下一段則在寫 ${escapeHtml(next)}，所以我在這裡分段。</p></div>`;
    }).join("");
  } else {
    items = sheet.sections.map(section => `<div class="answer-item story-answer-card story-${section.id}"><b>${section.label}｜${section.prompts.join(" ")}</b><p><strong>摘錄文本重點：</strong> ${escapeHtml(answers[`${section.id}_evidence`] || "尚未填寫")}</p></div>`).join("");
  }
  $("#modalContent").innerHTML = `<div class="modal-team">${teacherStage === "meaning" ? "第一階段" : "第二階段"}　·　${submission ? "小組已送出" : "尚未送出"}</div><h2 id="modalTitle">第 ${group} 組｜${sheet.title}</h2>${items}`;
  $("#answerModal").classList.remove("hidden");
  $("#modalBackdrop").classList.remove("hidden");
}
function closeAnswer() {
  $("#answerModal").classList.add("hidden");
  $("#modalBackdrop").classList.add("hidden");
}
function bind() {
  buildGroupPicker();
  $("#beginButton").onclick = () => $("#stagePanel").scrollIntoView({ behavior: "smooth", block: "start" });
  $$("[data-stage-select]").forEach(button => button.onclick = () => {
    const stage = button.dataset.stageSelect;
    if (stage === "story" && !state.storyOpen) return;
    activeStage = stage;
    $("#selectedStageKicker").textContent = stage === "meaning" ? "第一階段・小組共作" : "第二階段・第二堂課・小組共作";
    $("#homePanel").classList.add("hidden");
    $("#stagePanel").classList.add("hidden");
    $("#worksheetPanel").classList.add("hidden");
    $("#groupPanel").classList.remove("hidden");
    buildGroupPicker();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#backToStages").onclick = () => {
    $("#groupPanel").classList.add("hidden");
    $("#homePanel").classList.remove("hidden");
    $("#stagePanel").classList.remove("hidden");
    $("#stagePanel").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  $("#changeGroup").onclick = () => {
    $("#worksheetPanel").classList.add("hidden");
    $("#groupPanel").classList.remove("hidden");
    buildGroupPicker();
  };
  $("#worksheetForm").onsubmit = async event => {
    event.preventDefault();
    const answers = readForm();
    state.submissions[key(selectedGroup, activeStage)] = { answers, submittedAt: new Date().toISOString() };
    delete state.drafts[key(selectedGroup, activeStage)];
    await persist("/api/submit", { group: selectedGroup, stage: activeStage, answers });
    $("#completionBadge").textContent = "已送出";
    $("#completionBadge").classList.add("done");
    if (activeStage === "meaning") {
      $("#completionModal").classList.remove("hidden");
      $("#completionBackdrop").classList.remove("hidden");
    }
  };
  $$(".stage-tab").forEach(tab => tab.onclick = () => {
    if (tab.dataset.stage === "story" && !state.storyOpen) { setSaveStatus("第二階段尚未開放"); return; }
    activeStage = tab.dataset.stage;
    renderWorksheet();
  });
  $("#teacherEntry").onclick = () => teacherMode(true);
  $("#studentEntry").onclick = () => teacherMode(false);
  $("#teacherLoginForm").onsubmit = async event => {
    event.preventDefault();
    $("#loginError").textContent = "";
    try {
      await api("/api/teacher/login", { method: "POST", body: JSON.stringify({ password: $("#teacherPassword").value }) });
      useApi = true;
      teacherAuthenticated = true;
      $("#teacherPassword").value = "";
      $("#teacherPreview").classList.add("hidden");
      $("#teacherLoginPanel").classList.add("hidden");
      $("#teacherDashboard").classList.remove("hidden");
      await refreshState();
    } catch (error) {
      $("#loginError").textContent = useApi ? "密碼不正確，請再試一次。" : "本機預覽沒有教師密碼；可選擇下方預覽按鈕。";
      if (error.status === 503) $("#loginError").textContent = "教師入口尚未完成設定，請先設定 Cloudflare 密碼。";
      if (!useApi) $("#teacherPreview").classList.remove("hidden");
    }
  };
  $("#teacherPreview").onclick = () => {
    teacherAuthenticated = true;
    $("#teacherLoginPanel").classList.add("hidden");
    $("#teacherDashboard").classList.remove("hidden");
    renderTeacher();
  };
  $("#teacherLogout").onclick = async () => {
    try { await api("/api/teacher/logout", { method: "POST", body: "{}" }); } catch { /* local preview */ }
    teacherAuthenticated = false;
    $("#teacherDashboard").classList.add("hidden");
    $("#teacherLoginPanel").classList.remove("hidden");
  };
  $("#teacherHome").onclick = () => {
    teacherMode(false);
    $("#teacherDashboard").classList.add("hidden");
    $("#teacherLoginPanel").classList.add("hidden");
    $("#homePanel").classList.remove("hidden");
    $("#stagePanel").classList.remove("hidden");
    $("#groupPanel").classList.add("hidden");
    $("#worksheetPanel").classList.add("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  $$ ("[data-teacher-stage]").forEach(button => button.onclick = () => { teacherStage = button.dataset.teacherStage; renderTeacher(); });
  $("#stageControl").onclick = async () => {
    state.storyOpen = !state.storyOpen;
    saveDemo();
    try { await api("/api/stage", { method: "POST", body: JSON.stringify({ storyOpen: state.storyOpen }) }); useApi = true; } catch { /* local preview */ }
    renderTeacher();
  };
  $("#closeModal").onclick = closeAnswer;
  $("#modalBackdrop").onclick = closeAnswer;
  $("#closeCompletion").onclick = () => {
    $("#completionModal").classList.add("hidden");
    $("#completionBackdrop").classList.add("hidden");
  };
  $("#completionBackdrop").onclick = () => {
    $("#completionModal").classList.add("hidden");
    $("#completionBackdrop").classList.add("hidden");
  };
  $("#resetButton").onclick = async () => {
    if (!confirm("確定清除兩階段所有小組答案？此操作無法復原。")) return;
    state = { submissions: {}, drafts: {}, storyOpen: false };
    saveDemo();
    try { await api("/api/reset", { method: "POST", body: "{}" }); } catch { /* local preview */ }
    renderTeacher();
  };
}

loadDemo();
bind();
if (params.has("teacher")) teacherMode(true);
else if (selectedGroup) enterGroup();
refreshState();
setInterval(refreshState, 2500);
