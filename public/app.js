const $ = (s) => document.querySelector(s);
const main = $("#main");
const alertBox = $("#alert");
const escaped = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const attr = escaped;
const code = encodeURIComponent;
const labels = ["A", "B", "C", "D", "E", "F"];
const defaultSubjects = [
  ["ps", "Problem Solving & Analytical Skills", 20],
  ["prog", "Programming", 10],
  ["dsa", "Data Structures & Algorithms", 10],
  ["db", "Database Systems", 10],
  ["se", "Software Engineering", 10],
  ["web", "Web Development", 10],
  ["net", "Computer Networks & Cloud Computing", 10],
  ["ai", "AI, Machine Learning & Data Analytics", 10],
  ["os", "Operating Systems", 5],
  ["cyber", "Cyber Security", 5],
].map(([id, name, weight]) => ({ id, name, weight }));
let subjects = defaultSubjects;
let user = null;
let authReady = false;
let activeAttempt = null;
let activeQuestion = 0;
let adminData = null;
let busy = false;
let revision = 0;
let pendingEmail = "";
let reviewFilter = "all";
let adminPage = 0;
const subjectName = (id) => subjects.find((s) => s.id === id)?.name || id;
const stamp = (iso) =>
  iso
    ? new Intl.DateTimeFormat("en-PK", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso))
    : "No activity recorded";
const modeName = (mode) => (mode === "learn" ? "Learning mode" : "Exam mode");
const day = (iso) =>
  new Intl.DateTimeFormat("en-PK", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
const route = () => location.hash.replace(/^#\/?/, "").split("/");
const go = (path) => {
  location.hash = "/" + path;
};
function warn(text) {
  alertBox.textContent = text;
  alertBox.hidden = !text;
}
async function api(action, body = {}) {
  let response;
  try {
    response = await fetch("/api/" + action, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "Connection unavailable. Check your internet connection and try again.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error(
      data?.error ||
        "The portal service is unavailable. Please try again shortly.",
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
async function identity() {
  const data = await api("me");
  user = data.user;
  if (data.subjects?.length) subjects = data.subjects;
  authReady = true;
}
const navItem = (url, label, selected = false) =>
  `<a class="navlink" href="#/${url}" ${selected ? 'aria-current="page"' : ""}>${label}</a>`;
function navigation(page) {
  $("#nav").innerHTML = user
    ? [
        navItem("", "Dashboard", page === ""),
        '<a class="navlink" href="/about/">About Us</a>',
        navItem("history", "History", page === "history"),
        user.admin ? navItem("admin", "Admin", page.startsWith("admin")) : "",
        '<button class="linkbtn" data-do="logout">Sign out</button>',
      ].join("")
    : '<a class="navlink" href="/about/">About Us</a>';
}
const btn = (path, label, secondary = false) =>
  `<a class="btn${secondary ? " alt" : ""}" href="#/${attr(path)}">${escaped(label)}</a>`;
const eyebrow = (text) => `<div class="eyebrow">${escaped(text)}</div>`;
const heading = (title, desc = "", tag = "NSCT Preparation Portal") =>
  `<div class="heading">${eyebrow(tag)}<h1>${escaped(title)}</h1>${desc ? `<p>${escaped(desc)}</p>` : ""}</div>`;
function subjectTable() {
  return `<section class="section panel"><div class="bar"><div><div class="eyebrow">Syllabus</div><h2>Subject weights</h2></div><span class="small">Share of a combined paper</span></div><p class="syllabus-note">Practise with 2,500+ questions across ${subjects.length} subject modules. Choose one module or combine several. Each new paper draws and shuffles questions from your selection.</p><div class="subjectlist">${subjects.map((s) => `<div class="subjectrow"><span>${escaped(s.name)}</span><progress value="${Number(s.weight)}" max="100" aria-label="${attr(s.name)} weight"></progress><b>${Number(s.weight)}%</b></div>`).join("")}</div></section>`;
}
const targetDate = "2027-01-22T00:00:00+05:00";
let countdownInterval;
function startCountdown() {
  const timer = document.querySelector(".countdown");
  const digits = timer.querySelectorAll("b");
  function update() {
    const seconds = Math.max(0, Math.ceil((Date.parse(targetDate) - Date.now()) / 1000));
    const parts = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24,
      Math.floor(seconds / 60) % 60, seconds % 60];
    digits.forEach((digit, index) => { digit.textContent = String(parts[index]).padStart(2, "0"); });
    if (!seconds) clearInterval(countdownInterval);
  }
  clearInterval(countdownInterval);
  countdownInterval = setInterval(update, 1000);
  update();
}

function landing(page) {
  const field = (name, label, type, auto, more = "") =>
    `<label>${label}<input name="${name}" type="${type}" autocomplete="${auto}" required ${more}></label>`;
  const isRegister = page === "register",
    verify = page === "verify";
  const title = verify
    ? "Verify your email"
    : isRegister
      ? "Create your account"
      : "Student sign in";
  const desc = verify
    ? "Enter the six-digit code sent to your email."
    : isRegister
      ? "Register with your university details to save your progress."
      : "Use your email address to continue your preparation.";
  const email = field(
    "email",
    "Email address",
    "email",
    isRegister || verify ? "email" : "username",
    `maxlength="254" value="${attr(pendingEmail)}"`,
  );
  const pass = `<div class="field"><label for="account-password">Password</label>
    <div class="password-control">
      <input id="account-password" name="password" type="password" required maxlength="128"
        autocomplete="${isRegister ? "new-password" : "current-password"}" autocapitalize="none" spellcheck="false"
        ${isRegister ? 'minlength="12" title="Use at least 12 characters"' : ""}>
      <button type="button" data-do="password-visibility" aria-controls="account-password" aria-label="Show password" title="Show password">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>
          <path class="eye-slash" d="M3 3l18 18"/>
        </svg>
      </button>
    </div></div>`;
  const fields = verify
    ? email +
      field(
        "otp",
        "Verification code",
        "text",
        "one-time-code",
        'inputmode="numeric" pattern="[0-9]{6}" maxlength="6"',
      )
    : isRegister
      ? field("name", "Full name", "text", "name", 'maxlength="100"') +
        email +
        field("institution", "University/College", "text", "organization", 'maxlength="160"') +
        pass
      : email + pass;
  main.innerHTML = `<section class="landing"><div class="hero"><div>${eyebrow("Computer Science · 2027")}<h1>NSCT <em>Preparation</em> Portal</h1><p>Practise by subject or take a full Computer Science mock paper for the National Skills Competency Test.</p></div><div class="deadline"><div class="deadline-date">Preparation target <time datetime="${targetDate}">22 January 2027</time></div><div class="countdown" role="timer" aria-label="Time until the preparation target">${["Days", "Hours", "Minutes", "Seconds"].map(label => `<span><b>00</b>${label}</span>`).join("")}</div></div></div><div class="panel auth"><h2>${title}</h2><p>${desc}</p><form class="fields" data-form="${verify ? "verify" : isRegister ? "register" : "login"}">${fields}${isRegister ? '<span class="small">Use at least 12 characters for your password.</span>' : ""}<button class="btn" type="submit">${verify ? "Verify and continue" : isRegister ? "Create account" : "Sign in"}</button></form>${verify ? '<p class="switch"><button class="btn alt" data-do="resend">Resend code</button></p>' : ""}<p class="switch">${isRegister || verify ? '<a class="link" href="#/login">Back to sign in</a>' : 'New to the portal? <a class="link" href="#/register">Create an account</a>'}</p>${!verify && !isRegister ? '<a class="small" href="#/verify">Verify an existing registration</a>' : ""}</div></section>${subjectTable()}`;
  startCountdown();
}
function attemptItem(a) {
  const label = a.completed ? "View report" : "Resume";
  const detail = a.completed
    ? `${Number(a.score)} / ${Number(a.size)} correct`
    : `${Number(a.answered)} / ${Number(a.size)} answered`;
  return `<div class="item"><div><h3>${Number(a.size)}-question ${a.mode === "learn" ? "practice" : "exam"}</h3><div class="small">${escaped(day(a.createdAt))} · ${escaped(detail)}</div></div>${btn((a.completed ? "report/" : "attempt/") + code(a.id), label, true)}</div>`;
}
function dashboard(attempts) {
  const completed = attempts.filter((a) => a.completed),
    active = attempts.filter((a) => !a.completed);
  main.innerHTML = `<section class="summary">${eyebrow("Student dashboard · NSCT 2027")}<h1>Welcome, ${escaped(user.name.split(/\s+/)[0])}.</h1><p>Prepare for Computer Science with a weighted practice paper or a focused subject test.</p><div class="actions">${btn("setup", "Build a practice paper")}</div></section><div class="columns section"><section class="panel"><h2>In progress</h2>${active.length ? active.map(attemptItem).join("") : '<p class="empty">Your unfinished papers will appear here.</p>'}</section><section class="tinted"><h2>Your performance</h2><div class="metrics"><div><b class="metric">${completed.length}</b><span>Completed</span></div><div><b class="metric">${completed.length ? Math.round((100 * completed.reduce((sum, a) => sum + Number(a.score), 0)) / completed.reduce((sum, a) => sum + Number(a.size), 0)) + "%" : "–"}</b><span>Accuracy</span></div></div>${btn("history", "View history", true)}</section></div>${subjectTable()}`;
}
function historyPage(attempts) {
  main.innerHTML =
    heading(
      "My history",
      "Resume an unfinished paper or open a completed report.",
    ) +
    `<section class="panel"><div class="between"><h2>Practice papers</h2>${btn("setup", "New paper")}</div>${attempts.length ? attempts.map(attemptItem).join("") : '<p class="empty">You haven’t started a paper yet.</p>'}</section>`;
}
function pick(name, value, label, checked = false, type = "radio") {
  return `<label class="pick"><input type="${type}" name="${name}" value="${attr(value)}"${checked ? " checked" : ""}>${escaped(label)}</label>`;
}
function setup(preset) {
  main.innerHTML =
    heading(
      "Build a practice paper",
      "Choose the subjects, length and feedback style for this attempt.",
    ) +
    `<div class="columns"><form class="panel" data-form="start"><fieldset><legend>Subjects</legend><div class="choices">${pick("scope", "all", "Combined paper", !preset)}${pick("scope", "selected", "Choose subjects", !!preset)}</div><div class="choices subject-picks" id="subjects" ${preset ? "" : "hidden"}>${subjects.map((s) => pick("subject", s.id, s.name, s.id === preset, "checkbox")).join("")}</div></fieldset><fieldset><legend>Paper length</legend><div class="choices">${[20, 50, 100].map((n) => pick("size", n, n + " questions", n === 20)).join("")}</div></fieldset><fieldset><legend>Answer feedback</legend><div class="choices">${pick("mode", "learn", "Learning mode", true)}${pick("mode", "exam", "Exam mode")}</div><p class="hint" id="modeHint"></p></fieldset><p class="hint" id="capacity"></p><button class="btn" type="submit">Start paper</button></form><aside class="tinted"><div class="eyebrow">Paper blueprint</div><h2>Subject allocation</h2><p class="hint">Weights are scaled to the subjects in your paper.</p><div id="allocation"></div></aside></div>`;
  setupChange();
}
function setupChange() {
  const form = $("[data-form=start]");
  if (!form) return;
  const data = new FormData(form),
    all = data.get("scope") === "all",
    ids = data.getAll("subject");
  $("#subjects").hidden = all;
  const selected = subjects.filter((s) => all || ids.includes(s.id));
  const weight = selected.reduce((sum, s) => sum + s.weight, 0),
    size = Number(data.get("size"));
  const rows = selected.map((s) => ({
    subject: s,
    count: Math.floor((size * s.weight) / weight),
    remainder: (size * s.weight) % weight,
  }));
  const remaining = size - rows.reduce((sum, row) => sum + row.count, 0);
  for (const row of [...rows]
    .sort((a, b) => b.remainder - a.remainder)
    .slice(0, remaining))
    row.count++;
  $("#allocation").innerHTML =
    rows
      .map(
        ({ subject, count }) =>
          `<div class="item"><span>${escaped(subject.name)}</span><b>${count} MCQs</b></div>`,
      )
      .join("") || '<p class="empty">Select at least one subject.</p>';
  $("#modeHint").textContent =
    data.get("mode") === "learn"
      ? "Each selection locks immediately and reveals feedback for every option."
      : "Change your selections until you submit. Answers and explanations appear in your report.";
  const shortage = rows.find(
    ({ subject, count }) =>
      Number.isFinite(subject.count) && subject.count < count,
  );
  $("#capacity").textContent = shortage
    ? `${shortage.subject.name} has ${shortage.subject.count} available questions for its ${shortage.count}-question allocation. Choose a shorter paper or include more subjects.`
    : "";
  form.querySelector("[type=submit]").disabled =
    !selected.length || Boolean(shortage);
}
const qurl = (a, i) => `attempt/${code(a.id)}/${i + 1}`;
// Historical papers may store the worked solution in several answer slots.
function explanationNotes(q) {
  const reasons = (q.explanations || []).map(text => (text || "").trim());
  const normalize = text => text.toLowerCase().replace(/\s+/g, " ").trim();
  const main = reasons[q.correct] || "";
  const shared = normalize(main);
  const notes = main && !/^The source identifies /i.test(main) ? [[q.correct, main]] : [];
  const normalized = reasons.map(normalize);
  for (const [i, reason] of reasons.entries()) {
    const text = normalized[i];
    if (i === q.correct || !text || (shared && (shared.includes(text) || text.includes(shared)))) continue;
    if (normalized.indexOf(text) !== normalized.lastIndexOf(text)) continue;
    notes.push([i, reason]);
  }
  return notes;
}
function feedback(q) {
  if (!Number.isInteger(q.correct)) return "";
  const right = q.choice === q.correct;
  return `<div class="feedback"><span class="badge ${right ? "good" : "bad"}">${right ? "Correct answer" : "Incorrect answer"}</span><p><strong>Correct choice ${labels[q.correct]}.</strong> ${escaped(q.options[q.correct])}</p>${explanationNotes(q).map(([i, reason]) => i === q.correct ? `<p>${escaped(reason)}</p>` : `<p><strong>${labels[i]}. ${escaped(q.options[i])}</strong><br>${escaped(reason)}</p>`).join("")}</div>`;
}
function exam(a, index) {
  activeQuestion = index;
  const q = a.questions[index],
    locked = a.mode === "learn" && q.choice !== null;
  const answerStatus = locked
    ? "Answer saved and locked"
    : q.choice !== null
      ? "Answer saved · You can change your choice"
      : a.mode === "learn"
        ? "Select an option to lock your answer."
        : "Select an option. You can revise it before submitting.";
  main.innerHTML = `<div class="bar heading"><div>${eyebrow(modeName(a.mode))}<h1>Practice paper</h1></div>${btn("", "Save & return", true)}</div><div class="exam-grid"><section class="panel"><div class="between"><b>Question ${index + 1} of ${a.size}</b><span class="small">${escaped(subjectName(q.subject))}</span></div><h2 class="question">${escaped(q.stem)}</h2><p class="hint">${answerStatus}</p><div class="opts">${q.options
    .map((option, i) => {
      const cls =
        locked && q.correct === i
          ? "right"
          : locked && q.choice === i
            ? "wrong"
            : q.choice === i
              ? "selected"
              : "";
      return `<button class="option ${cls}" data-choice="${i}" ${locked ? "disabled" : ""} aria-pressed="${q.choice === i}"><span class="letter">${labels[i]}</span><span>${escaped(option)}</span></button>`;
    })
    .join(
      "",
    )}</div>${feedback(q)}<div class="actions examnav">${index > 0 ? btn(qurl(a, index - 1), "Previous", true) : ""}${index + 1 < a.size ? btn(qurl(a, index + 1), "Next question") : ""}${a.answered === a.size ? '<button class="btn" data-do="finish">Submit paper</button>' : ""}</div></section><aside class="tinted"><h2>Question map</h2><p class="hint">${Number(a.answered)} of ${Number(a.size)} answered</p><progress max="${a.size}" value="${a.answered}" aria-label="Questions answered"></progress><div class="map">${a.questions.map((item, i) => `<a href="#/${qurl(a, i)}" class="${item.choice !== null ? "done" : ""}" ${i === index ? 'aria-current="step"' : ""} aria-label="Question ${i + 1}, ${item.choice !== null ? "answered" : "unanswered"}">${i + 1}</a>`).join("")}</div>${a.answered < a.size ? '<p class="small">Answer every question to submit the paper.</p>' : ""}</aside></div>`;
}
function report(a, adminView = false) {
  const by = new Map();
  for (const q of a.questions) {
    const r = by.get(q.subject) || { right: 0, count: 0 };
    r.count++;
    r.right += Number(q.choice === q.correct);
    by.set(q.subject, r);
  }
  const sorted = [...by].sort(
    (a, b) => a[1].right / a[1].count - b[1].right / b[1].count,
  );
  const weak = sorted[0]?.[0];
  main.innerHTML = `<section class="summary">${eyebrow("Completed paper · " + day(a.completedAt || a.createdAt))}<h1>${adminView ? "Student result" : "Your result"}</h1><div class="metric">${Number(a.score)} / ${Number(a.size)}</div><p>${Math.round((100 * a.score) / a.size)}% correct · ${escaped(modeName(a.mode))} · ${escaped(adminView ? a.studentName : user.name)}</p>${adminView ? `<p>Started ${escaped(stamp(a.createdAt))} · Completed ${escaped(stamp(a.completedAt))}</p>` : ""}</section><div class="actions section noprint">${adminView ? btn("admin-student/" + code(a.studentId), "Back to student activity", true) : btn("setup", "New randomized paper")}<button class="btn alt" data-do="csv">Download CSV</button><button class="btn alt" data-do="print">Print / Save PDF</button></div><div class="report-grid section"><section class="panel"><h2>Subject performance</h2>${sorted.map(([id, r]) => `<div class="item"><span>${escaped(subjectName(id))}</span><strong>${r.right} / ${r.count}</strong></div>`).join("")}</section><aside class="tinted"><h2>${adminView ? "Performance summary" : "Study next"}</h2>${adminView ? `<p class="hint">${a.score === a.size ? "All questions were answered correctly." : `Lowest subject accuracy: ${escaped(subjectName(weak))}.`}</p>` : weak && a.score < a.size ? `<p class="hint">Your lowest accuracy in this paper was in ${escaped(subjectName(weak))}.</p>${btn("setup/" + code(weak), "Practice this subject", true)}` : '<p class="hint">You answered every question correctly. Try another paper for fresh practice.</p>'}</aside></div><section class="section panel"><div class="between"><h2>Answer review</h2><label class="small noprint">Show <select id="reviewFilter">${[
    ["all", "All questions"],
    ["incorrect", "Incorrect"],
    ["correct", "Correct"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${v === reviewFilter ? "selected" : ""}>${l}</option>`,
    )
    .join("")}</select></label></div><div id="reviewList"></div></section>`;
  reviewList(a);
}
function reviewList(a, print = false) {
  const html = a.questions
    .map((q, i) => {
      const right = q.choice === q.correct;
      if (
        !print &&
        ((reviewFilter === "correct" && !right) ||
          (reviewFilter === "incorrect" && right))
      )
        return "";
      return `<details class="reviewentry"${print ? " open" : ""}><summary>Q${i + 1} · <span class="badge ${right ? "good" : "bad"}">${right ? "Correct" : "Incorrect"}</span> ${escaped(q.stem)}</summary><div class="reviewbody"><p>${escaped(subjectName(q.subject))} · Your choice ${labels[q.choice] || "—"}</p>${feedback(q)}</div></details>`;
    })
    .join("");
  $("#reviewList").innerHTML =
    html || '<p class="empty">No answers match this filter.</p>';
}
function downloadCsv(a) {
  const lines = [
    [
      "Question",
      "Subject",
      "Question text",
      "Your answer",
      "Correct answer",
      "Result",
      "Option explanations",
    ],
  ];
  a.questions.forEach((q, i) =>
    lines.push([
      i + 1,
      subjectName(q.subject),
      q.stem,
      q.options[q.choice],
      q.options[q.correct],
      q.choice === q.correct ? "Correct" : "Incorrect",
      explanationNotes(q).map(([i, reason]) => `${q.options[i]} — ${reason}`).join("\n"),
    ]),
  );
  const cell = (v) => {
    const s = String(v ?? "");
    return (
      '"' +
      (/^\s*[=+\-@\t\r]/.test(s) ? "'" : "") +
      s.replaceAll('"', '""') +
      '"'
    );
  };
  const url = URL.createObjectURL(
    new Blob(
      ["\ufeff", lines.map((row) => row.map(cell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8;" },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `NSCT-result-${a.id}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function adminStudent({ student, attempts }) {
  const completed = attempts.filter((a) => a.completed);
  const title = escaped(student.name);
  main.innerHTML = `<div class="noprint">${btn("admin", "Back to administration", true)}</div><section class="summary section">${eyebrow("Student activity")}<h1>${title}</h1><p>${escaped(student.email)}${student.institution ? " · " + escaped(student.institution) : ""}</p><p>Last active ${escaped(stamp(student.lastActiveAt))}</p></section><section class="panel section"><h2>Practice history</h2><div class="metrics"><div><b class="metric">${attempts.length}</b><span>Papers started</span></div><div><b class="metric">${completed.length}</b><span>Completed</span></div></div>${attempts.map((a) => `<article class="item"><div><h3>${Number(a.size)}-question ${a.mode === "learn" ? "practice" : "exam"}</h3><p>${a.completed ? `${Number(a.score)} / ${Number(a.size)} correct` : `${Number(a.answered)} / ${Number(a.size)} answered`}</p><div class="small">Started ${escaped(stamp(a.createdAt))}<br>${a.completed ? "Completed" : "Updated"} ${escaped(stamp(a.completedAt || a.updatedAt))}</div></div>${btn("admin-attempt/" + code(a.id), a.completed ? "View result" : "View progress", true)}</article>`).join("") || '<p class="empty">This student has not started any papers.</p>'}</section>`;
}
function adminPaper(a) {
  if (a.completed) {
    report(a, true);
    return;
  }
  main.innerHTML = `<div class="noprint">${btn("admin-student/" + code(a.studentId), "Back to student activity", true)}</div><section class="summary section">${eyebrow("In-progress paper")}<h1>${escaped(a.studentName)}</h1><p>${escaped(modeName(a.mode))} · ${Number(a.answered)} of ${Number(a.size)} questions answered</p></section><section class="panel section"><h2>Attempt activity</h2><div class="item"><strong>Started</strong><span>${escaped(stamp(a.createdAt))}</span></div><div class="item"><strong>Last updated</strong><span>${escaped(stamp(a.updatedAt))}</span></div><div class="item"><strong>Subjects</strong><span>${a.subjects.map((s) => escaped(subjectName(s))).join(", ")}</span></div><div class="section"><h3>Question progress</h3>${a.questions.map((q, i) => `<details><summary>Q${i + 1} · ${q.choice === null ? "Unanswered" : "Answered"} · ${escaped(subjectName(q.subject))}</summary><p>${escaped(q.stem)}</p>${q.choice !== null ? `<p>Selected ${labels[q.choice]}. ${escaped(q.options[q.choice])}</p>` : ""}</details>`).join("")}</div></section>`;
}
function administrator(data) {
  adminData = data;
  adminPage = 0;
  main.innerHTML =
    heading(
      "Administration",
      "Review student activity and manage the questions available for new papers.",
    ) +
    `<section class="panel"><h2>Student activity</h2><div class="metrics"><div><b class="metric">${Number(data.totalStudents)}</b><span>Students</span></div><div><b class="metric">${Number(data.totalAttempts)}</b><span>Papers started</span></div></div><div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>University/College</th><th>Attempts</th><th>Last active</th></tr></thead><tbody>${data.students.map((s) => `<tr><td><a href="#/admin-student/${code(s.id)}">${escaped(s.name)}</a></td><td>${escaped(s.email)}</td><td>${escaped(s.institution || "Not provided")}</td><td>${Number(s.attempts)}</td><td>${escaped(stamp(s.lastActiveAt))}</td></tr>`).join("")}</tbody></table></div></section><section class="section panel"><h2>Question bank</h2><div class="choices section"><label class="field">Search questions<input id="bankSearch" type="search"></label><label class="field">Subject<select id="bankSubject"><option value="">All subjects</option>${subjects.map((s) => `<option value="${attr(s.id)}">${escaped(s.name)}</option>`).join("")}</select></label></div><div id="bankResults"></div></section>`;
  bankResults();
}
function bankResults() {
  const term = $("#bankSearch").value.trim().toLowerCase(),
    sub = $("#bankSubject").value;
  const rows = adminData.questions.filter(
    (q) =>
      (!sub || q.subject === sub) &&
      (!term ||
        q.stem.toLowerCase().includes(term) ||
        String(q.id).toLowerCase().includes(term)),
  );
  const count = Math.ceil(rows.length / 20);
  adminPage = Math.max(0, Math.min(adminPage, count - 1));
  $("#bankResults").innerHTML =
    `<p class="hint">${rows.length} matching questions</p>${rows
      .slice(adminPage * 20, adminPage * 20 + 20)
      .map(
        (q) =>
          `<div class="item"><div class="adminq"><span class="small">${escaped(subjectName(q.subject))} · ${q.disabled ? "Disabled" : "Available"}</span><p>${escaped(q.stem)}</p></div><button class="btn alt" data-toggle="${attr(q.id)}">${q.disabled ? "Enable" : "Disable"}</button></div>`,
      )
      .join(
        "",
      )}${count > 1 ? `<div class="actions section"><button class="btn alt" data-page="-1" ${adminPage === 0 ? "disabled" : ""}>Previous</button><span>Page ${adminPage + 1} of ${count}</span><button class="btn alt" data-page="1" ${adminPage + 1 === count ? "disabled" : ""}>Next</button></div>` : ""}`;
}
async function render() {
  clearInterval(countdownInterval);
  const turn = ++revision;
  const [page, id, n] = route();
  warn("");
  try {
    if (!authReady) await identity();
    if (turn !== revision) return;
    navigation(page);
    if (!user) {
      landing(page);
      return;
    }
    if (page !== "attempt" && page !== "report") activeAttempt = null;
    if (page === "setup") {
      setup(id);
      return;
    }
    if (
      ["admin", "admin-student", "admin-attempt"].includes(page) &&
      !user.admin
    ) {
      main.innerHTML =
        heading("Administrator access required") + btn("", "Back to dashboard");
      return;
    }
    if (page === "admin-student") {
      const data = await api("adminStudent", { id });
      if (turn === revision) adminStudent(data);
      return;
    }
    if (page === "admin-attempt") {
      const data = await api("adminAttempt", { id });
      if (turn === revision) {
        activeAttempt = data.attempt;
        adminPaper(activeAttempt);
      }
      return;
    }
    if (page === "admin" && user.admin) {
      const data = await api("admin");
      if (turn === revision) administrator(data);
      return;
    }
    if ((page === "attempt" || page === "report") && id) {
      const a =
        activeAttempt?.id === id && !activeAttempt.studentId
          ? activeAttempt
          : (await api("get", { id })).attempt;
      if (turn !== revision) return;
      activeAttempt = a;
      if (a.completed) {
        if (page !== "report")
          history.replaceState(null, "", "#/report/" + code(id));
        report(a);
      } else {
        const firstOpen = a.questions.findIndex((q) => q.choice === null),
          asked = Number(n);
        const i = Math.min(
          a.size - 1,
          Math.max(
            0,
            Number.isInteger(asked) && asked > 0 ? asked - 1 : firstOpen,
          ),
        );
        if (page !== "attempt" || !n)
          history.replaceState(null, "", "#/" + qurl(a, i));
        exam(a, i);
      }
      return;
    }
    const { attempts } = await api("list");
    if (turn !== revision) return;
    if (page === "history") historyPage(attempts);
    else {
      if (page) history.replaceState(null, "", "#/");
      navigation("");
      dashboard(attempts);
    }
  } catch (error) {
    if (turn !== revision) return;
    if (!user || error.status === 401) {
      user = null;
      activeAttempt = null;
      navigation(page);
      landing(page);
    } else {
      main.innerHTML = `<section class="panel"><h1>Unable to open this page</h1><div class="actions section"><button class="btn" data-do="retry">Try again</button>${btn("", "Dashboard", true)}</div></section>`;
    }
    warn(error.message);
  }
}
async function run(task, element) {
  if (busy) return;
  busy = true;
  warn("");
  if (element) element.disabled = true;
  try {
    await task();
  } catch (error) {
    if (error.status === 410 && route()[0] === "verify") {
      go("register");
      return;
    }
    warn(error.message);
    if (error.status === 401 && user) {
      user = null;
      activeAttempt = null;
      adminData = null;
      navigation("login");
      landing("login");
    }
  } finally {
    busy = false;
    if (element?.isConnected) element.disabled = false;
  }
}
document.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form),
    values = Object.fromEntries(data);
  const action = form.dataset.form;
  run(async () => {
    if (action === "start") {
      const result = await api("start", {
        size: Number(values.size),
        mode: values.mode,
        subjects:
          values.scope === "all"
            ? subjects.map((s) => s.id)
            : data.getAll("subject"),
      });
      activeAttempt = result.attempt;
      go(qurl(activeAttempt, 0));
      return;
    }
    await api(action, values);
    if (action === "register") {
      pendingEmail = values.email;
      go("verify");
      return;
    }
    await identity();
    pendingEmail = "";
    if (location.hash === "#/") await render();
    else go("");
  }, event.submitter);
});
document.addEventListener("click", (event) => {
  const el = event.target.closest("button");
  if (!el || el.disabled || (el.type === "submit" && el.form)) return;
  const { choice, toggle, page, do: action } = el.dataset;
  if (action === "password-visibility") {
    const input = el.form.elements.namedItem("password");
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    el.title = reveal ? "Hide password" : "Show password";
    el.setAttribute("aria-label", el.title);
    return;
  }
  if (page) {
    adminPage += Number(page);
    bankResults();
    return;
  }
  if (action === "print") {
    window.print();
    return;
  }
  if (action === "csv") {
    downloadCsv(activeAttempt);
    return;
  }
  if (action === "retry") {
    render();
    return;
  }
  run(async () => {
    if (choice !== undefined) {
      const i = activeQuestion,
        id = activeAttempt.id,
        turn = revision;
      const { attempt } = await api("answer", {
        id,
        index: i,
        choice: Number(choice),
      });
      if (activeAttempt?.id === id && !activeAttempt.studentId) activeAttempt = attempt;
      if (turn === revision) exam(attempt, i);
      else if (route()[0] === "attempt" && route()[1] === id) await render();
    } else if (toggle !== undefined) {
      const q = adminData.questions.find((q) => String(q.id) === toggle),
        disabled = !q.disabled;
      await api("toggle", { id: q.id, disabled });
      q.disabled = disabled;
      if ($("#bankResults")) bankResults();
    } else if (action === "logout") {
      await api("logout");
      user = null;
      activeAttempt = null;
      adminData = null;
      pendingEmail = "";
      authReady = false;
      if (location.hash === "#/login") await render();
      else go("login");
    } else if (action === "resend") {
      const email = $("input[name=email]");
      if (!email.reportValidity()) return;
      await api("resend", { email: email.value });
      pendingEmail = email.value;
      warn("Check your inbox for your verification code.");
    } else if (action === "finish") {
      if (!confirm("Submit this paper and see your final report?")) return;
      const { attempt } = await api("finish", { id: activeAttempt.id });
      activeAttempt = attempt;
      reviewFilter = "all";
      go("report/" + code(attempt.id));
    }
  }, el);
});
document.addEventListener("change", (event) => {
  if (event.target.closest("[data-form=start]")) setupChange();
  if (event.target.id === "reviewFilter") {
    reviewFilter = event.target.value;
    reviewList(activeAttempt);
  }
  if (event.target.id === "bankSubject") {
    adminPage = 0;
    bankResults();
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "bankSearch") {
    adminPage = 0;
    bankResults();
  }
});
window.addEventListener("keydown", (e) => {
  if (
    route()[0] !== "attempt" ||
    !activeAttempt ||
    busy ||
    e.altKey ||
    e.ctrlKey ||
    e.metaKey ||
    e.shiftKey
  )
    return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (/^[1-4]$/.test(e.key)) {
    const el = $(`[data-choice="${Number(e.key) - 1}"]`);
    if (el && !el.disabled) {
      e.preventDefault();
      el.click();
    }
  } else if (
    e.key === "ArrowRight" &&
    activeQuestion + 1 < activeAttempt.size
  ) {
    e.preventDefault();
    go(qurl(activeAttempt, activeQuestion + 1));
  } else if (e.key === "ArrowLeft" && activeQuestion > 0) {
    e.preventDefault();
    go(qurl(activeAttempt, activeQuestion - 1));
  }
});
window.addEventListener("beforeprint", () => {
  if ($("#reviewList")) reviewList(activeAttempt, true);
});
window.addEventListener("afterprint", () => {
  if ($("#reviewList")) reviewList(activeAttempt);
});
window.addEventListener("hashchange", async () => {
  await render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    authReady = false;
    activeAttempt = null;
    adminData = null;
    render();
  }
});
navigation("");
landing(route()[0]);
render();

document.querySelector(".skip").addEventListener("click", (event) => {
  event.preventDefault();
  main.focus();
});
