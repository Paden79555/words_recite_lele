const WORDS = window.WORDS || [];
const WORD_PACKS = window.WORD_PACKS || [{ id: "full-sample", name: "教材完整库", subtitle: "已导入词库", maxIndex: 9999, source: "内置词库" }];
const STORAGE_KEY = "shenzhen-vocab-quest-state-v3";
const TARGET_TOTAL_WORDS = WORDS.length;
const EXAM_DATE = "2026-06-20";
const ADMIN_USER = "panzeng";
const ADMIN_PASS = "1241118913";
const todayKey = new Date().toISOString().slice(0, 10);
const intervals = [1, 2, 4, 7, 15];
const rankTiers = [
  { name: "倔强青铜", min: 0, max: 199 },
  { name: "秩序白银", min: 200, max: 399 },
  { name: "荣耀黄金", min: 400, max: 699 },
  { name: "尊贵铂金", min: 700, max: 999 },
  { name: "永恒钻石", min: 1000, max: 1299 },
  { name: "至尊星耀", min: 1300, max: 1599 },
  { name: "最强王者", min: 1600, max: 1899 },
  { name: "荣耀王者", min: 1300, max: 9999 }
];
const el = (id) => document.getElementById(id);
let state = loadState();
let queue = buildQueue();
let currentWordId = null;
let answerVisible = false;
let peakSession = null;
let toastTimer;
let selectedReviewUnit = "";
let sessionStartedAt = Date.now();
let lastDurationSync = Date.now();

function loadState() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem("shenzhen-vocab-quest-state-v2") || "null");
  if (saved && saved.words && saved.words.length === WORDS.length) return upgradeState(saved);

  return upgradeState({
    coins: 0,
    streak: 1,
    mode: "balanced",
    packId: "starter",
    peakScore: 1200,
    peakRecords: [],
    lastStudyDate: todayKey,
    daily: seedDaily(),
    words: WORDS.map((_, index) => ({
      id: index,
      score: 0,
      correct: 0,
      wrong: 0,
      intervalIndex: 0,
      nextReview: todayKey,
      reviewedToday: false,
      learned: false,
      firstSeen: "",
      history: []
    }))
  });
}

function upgradeState(saved) {
  saved.mode ||= "balanced";
  saved.packId ||= "starter";
  saved.coins ??= 0;
  saved.streak ||= 1;
  saved.daily ||= seedDaily();
  saved.loginRecords ||= [];
  saved.peakScore ??= 1200;
  saved.peakRecords ||= [];
  Object.values(saved.daily).forEach((day) => {
    day.studySeconds ??= 0;
    day.loginCount ??= 0;
    day.firstLogin ||= "";
    day.lastLogin ||= "";
  });
  saved.words.forEach((word) => {
    word.history ||= [];
    word.correct ??= 0;
    word.wrong ??= 0;
    word.score ??= 0;
    word.intervalIndex ??= 0;
    word.nextReview ||= todayKey;
    word.reviewedToday ??= false;
    word.learned ??= word.correct > 0 || word.score > 0;
    word.firstSeen ||= "";
  });
  return saved;
}

function dailyRecord(done = 0, wrong = 0, target = 12) {
  return { done, wrong, target, studySeconds: 0, loginCount: 0, firstLogin: "", lastLogin: "" };
}

function seedDaily() {
  const daily = { [todayKey]: dailyRecord(0, 0, 12) };
  for (let i = 1; i <= 6; i += 1) {
    daily[offsetDate(-i)] = dailyRecord(Math.max(0, 10 - i), Math.max(0, Math.floor(i / 2)), 12);
  }
  return daily;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function timeLabel(date = new Date()) {
  return date.toTimeString().slice(0, 5);
}

function clientRegion(role = "student") {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  const language = navigator.language || "unknown";
  const region = role === "admin" ? "北京管理员端" : "深圳学生端";
  return { region, timezone, language };
}

function recordLogin(role = "student") {
  ensureToday();
  const today = state.daily[todayKey];
  const now = timeLabel();
  const regionInfo = clientRegion(role);
  today.loginCount += 1;
  today.firstLogin ||= now;
  today.lastLogin = now;
  state.loginRecords.unshift({ date: todayKey, time: now, role, ...regionInfo });
  state.loginRecords = state.loginRecords.slice(0, 60);
  saveState();
}

function syncStudyDuration(force = false) {
  ensureToday();
  const now = Date.now();
  const delta = Math.max(0, Math.floor((now - lastDurationSync) / 1000));
  if (!force && delta < 15) return;
  state.daily[todayKey].studySeconds += Math.min(delta, 300);
  lastDurationSync = now;
  saveState();
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `${seconds}秒`;
  return `${minutes}分`;
}

function offsetDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function ensureToday() {
  if (!state.daily[todayKey]) state.daily[todayKey] = dailyRecord(0, 0, 12);
  if (state.lastStudyDate !== todayKey) {
    const yesterday = offsetDate(-1);
    state.streak = state.lastStudyDate === yesterday ? state.streak + 1 : 1;
    state.lastStudyDate = todayKey;
    state.words.forEach((word) => { word.reviewedToday = false; });
  }
}

function activePack() {
  return WORD_PACKS.find((pack) => pack.id === state.packId) || WORD_PACKS[0];
}

function activeWordProgress() {
  const pack = activePack();
  return state.words.filter((word) => word.id < Math.min(pack.maxIndex, WORDS.length));
}

function buildQueue() {
  ensureToday();
  const candidates = activeWordProgress().filter((word) => {
    if (state.mode === "weak") return word.nextReview <= todayKey || word.score < 60 || word.wrong > 0;
    if (state.mode === "new") return !word.reviewedToday || word.nextReview <= todayKey;
    return word.nextReview <= todayKey || word.score < 70 || !word.reviewedToday;
  });

  return candidates
    .sort((a, b) => queueScore(b) - queueScore(a))
    .slice(0, state.daily[todayKey].target)
    .map((word) => word.id);
}

function riskScore(word) {
  const overdue = word.nextReview < todayKey ? 35 : word.nextReview === todayKey ? 20 : 0;
  return (100 - word.score) + word.wrong * 14 + overdue;
}

function queueScore(word) {
  if (state.mode === "new") return word.reviewedToday ? riskScore(word) : riskScore(word) + 24;
  if (state.mode === "weak") return riskScore(word) + word.wrong * 20;
  return riskScore(word);
}

function currentDailyDone() {
  return activeWordProgress().filter((word) => word.reviewedToday).length;
}

function masteredWords() {
  return activeWordProgress().filter((word) => word.score >= 85).length;
}

function globalMasteredWords() {
  return state.words.filter((word) => word.score >= 85).length;
}

function rankInfo() {
  const mastered = globalMasteredWords();
  const accuracyBase = state.words.reduce((sum, word) => sum + word.correct + word.wrong, 0);
  const correct = state.words.reduce((sum, word) => sum + word.correct, 0);
  const accuracy = accuracyBase ? Math.round(correct / accuracyBase * 100) : 0;
  const adjusted = Math.min(TARGET_TOTAL_WORDS, mastered + Math.floor(Math.max(0, accuracy - 70) / 5) * 10 + Math.min(60, state.streak * 3));
  const tier = rankTiers.find((item) => adjusted >= item.min && adjusted <= item.max) || rankTiers[rankTiers.length - 1];
  const span = tier.max - tier.min + 1;
  const progress = Math.min(100, Math.max(0, Math.round((adjusted - tier.min) / span * 100)));
  const stars = Math.min(5, Math.max(1, Math.ceil(progress / 20)));
  return { mastered, adjusted, accuracy, tier, progress, stars };
}

function examDaysLeft() {
  const target = new Date(`${EXAM_DATE}T00:00:00`);
  const today = new Date(`${todayKey}T00:00:00`);
  return Math.max(0, Math.ceil((target - today) / 86400000));
}

function showNextWord() {
  queue = buildQueue();
  const nextId = queue.find((id) => !state.words[id].reviewedToday) ?? queue[0];
  currentWordId = nextId;
  answerVisible = false;

  if (currentWordId === undefined) {
    el("wordText").textContent = "今日完成";
    el("wordPhonetic").textContent = "明天继续";
    el("wordMeaning").textContent = "今天的词已经全部完成。";
    el("wordExample").textContent = "睡前可以打开看板，只扫一遍高风险词。";
    el("wordStatus").textContent = "已完成";
    el("todayAdvice").textContent = "今日任务完成，保持连续学习。";
    renderAll();
    return;
  }

  const word = WORDS[currentWordId];
  const progress = state.words[currentWordId];
  const isNewWord = !progress.learned;
  el("wordLevel").textContent = word.level;
  el("wordStatus").textContent = isNewWord ? "新词 · 先学习" : `复习 · 掌握 ${progress.score}% · 错 ${progress.wrong} 次`;
  el("wordText").textContent = word.word;
  el("wordPhonetic").textContent = word.phonetic || "音标未提供";
  el("wordMeaning").textContent = isNewWord ? word.meaning : "先遮住中文，在心里回忆 3 秒。";
  el("wordExample").textContent = isNewWord ? word.example : "想不起也没关系，点“看答案”后诚实选择。";
  el("showAnswerButton").textContent = isNewWord ? "查看例句" : "看答案";
  el("knownButton").textContent = isNewWord ? "学会了" : "认识";
  el("forgotButton").textContent = isNewWord ? "还要再看" : "忘了";
  el("todayAdvice").textContent = isNewWord ? "这是新词，先看意思和例句，再点“学会了”。" : progress.wrong > 0 ? "这张是薄弱词，今天优先补上。" : "复习词先回忆，再确认答案。";
  renderAll();
}

function showAnswer() {
  if (currentWordId === null || currentWordId === undefined) {
    showNextWord();
    return;
  }
  const word = WORDS[currentWordId];
  answerVisible = true;
  el("wordMeaning").textContent = word.meaning;
  el("wordExample").textContent = word.example;
}

function gradeCurrent(known) {
  if (currentWordId === null || currentWordId === undefined) {
    showNextWord();
    return;
  }
  const progress = state.words[currentWordId];
  progress.reviewedToday = true;
  progress.history.push({ date: todayKey, known });

  const wasNewWord = !progress.learned;
  progress.learned = true;
  progress.firstSeen ||= todayKey;

  if (known) {
    progress.correct += 1;
    progress.score = Math.min(100, progress.score + (wasNewWord ? 35 : answerVisible ? 20 : 12));
    progress.intervalIndex = Math.min(intervals.length - 1, progress.intervalIndex + 1);
    state.coins += wasNewWord ? 2 : 3;
    showToast(wasNewWord ? "新词已学会，明天复习" : "认识，金币 +3");
  } else if (wasNewWord) {
    progress.score = Math.max(10, progress.score);
    progress.intervalIndex = 0;
    progress.nextReview = todayKey;
    showToast("新词保留，稍后再看一遍");
  } else {
    progress.wrong += 1;
    progress.score = Math.max(0, progress.score - 18);
    progress.intervalIndex = 0;
    state.daily[todayKey].wrong += 1;
    state.coins = Math.max(0, state.coins - 1);
    showToast("已加入错词优先复习");
  }

  state.daily[todayKey].done += 1;
  syncStudyDuration(true);
  if (!(wasNewWord && !known)) progress.nextReview = offsetDate(intervals[progress.intervalIndex]);
  saveState();
  showNextWord();
}

function renderAll() {
  renderProgress();
  renderRank();
  renderExam();
  renderPackLadder();
  renderQuestMap();
  renderCurve();
  renderPeak();
  renderReview();
  renderAdmin();
  renderSettings();
}

function renderProgress() {
  const pack = activePack();
  const total = activeWordProgress().length;
  const mastered = masteredWords();
  const dailyTarget = state.daily[todayKey].target;
  const dailyDone = Math.min(currentDailyDone(), dailyTarget);
  const masteryRate = total ? Math.round((mastered / total) * 100) : 0;

  el("masteryPercent").textContent = `${masteryRate}%`;
  el("masteryRing").style.setProperty("--value", `${masteryRate * 3.6}deg`);
  el("totalWordsCount").textContent = total;
  el("dueWordsCount").textContent = buildQueue().length;
  el("streakPill").textContent = state.streak;
  el("dailyProgressText").textContent = `${dailyDone} / ${dailyTarget}`;
  el("dailyProgressBar").style.width = `${Math.min(100, dailyDone / dailyTarget * 100)}%`;
  el("coinCount").textContent = `${state.coins} 金币`;
  el("activePackName").textContent = `${pack.name} · ${pack.subtitle}`;
  el("packSourcePill").textContent = pack.id === "full-sample" ? "教材完整库" : "分级词库";
  el("sourceMini").textContent = `教材词表已导入 ${WORDS.length} 词/短语 · 来源：用户提供深圳中考初中词表`;
}

function renderRank() {
  const info = rankInfo();
  el("rankName").textContent = info.tier.name;
  el("rankHint").textContent = `掌握 ${info.mastered} / ${TARGET_TOTAL_WORDS} 词 · 准确率 ${info.accuracy}%`;
  el("rankStars").innerHTML = Array.from({ length: 5 }, (_, index) => `<span class="${index < info.stars ? "is-lit" : ""}">★</span>`).join("");
  el("rankProgressBar").style.width = `${info.progress}%`;
}

function renderExam() {
  const days = examDaysLeft();
  const imported = WORDS.length;
  el("examDaysLeft").textContent = `${days}天`;
  el("examPressureText").textContent = days <= 30
    ? `冲刺期：先保七上/高频核心，已导入 ${imported} 个教材词/短语`
    : `距 2026 深圳中考约 ${days} 天，时间以官方公布为准`;
}

function renderPackLadder() {
  el("packLadder").innerHTML = WORD_PACKS.map((pack, index) => {
    const words = state.words.filter((word) => word.id < Math.min(pack.maxIndex, WORDS.length));
    const mastered = words.filter((word) => word.score >= 85).length;
    const rate = words.length ? Math.round(mastered / words.length * 100) : 0;
    const active = pack.id === state.packId ? "is-active" : "";
    return `<button class="pack-card ${active}" data-pack-id="${pack.id}"><span>第${index + 1}关</span><strong>${pack.name}</strong><small>${pack.subtitle} · ${words.length}词 · ${rate}%</small></button>`;
  }).join("");
  document.querySelectorAll("[data-pack-id]").forEach((button) => button.addEventListener("click", () => changePack(button.dataset.packId)));
}

function changePack(packId) {
  state.packId = packId;
  queue = buildQueue();
  currentWordId = null;
  saveState();
  renderAll();
  showToast(`已切换到${activePack().name}`);
}

function renderQuestMap() {
  const dailyTarget = state.daily[todayKey].target;
  const dailyDone = Math.min(currentDailyDone(), dailyTarget);
  el("questMap").innerHTML = Array.from({ length: dailyTarget }, (_, index) => {
    const className = index < dailyDone ? "done" : index === dailyDone ? "current" : "";
    return `<div class="quest-node ${className}">${index + 1}</div>`;
  }).join("");
}

function renderCurve() {
  const progress = activeWordProgress();
  const dueBuckets = intervals.map((days) => {
    const date = offsetDate(days);
    return progress.filter((word) => word.nextReview <= date).length;
  });
  const max = Math.max(...dueBuckets, 1);
  el("curveChart").innerHTML = dueBuckets.map((count, index) => `
    <div class="curve-bar"><span style="height:${Math.max(12, count / max * 104)}px"></span><small>${intervals[index]}天<br>${count}词</small></div>
  `).join("");
}

function unitNameFromLevel(level) {
  const match = String(level || "").match(/(\d[A-B] Unit \d+)/);
  return match ? match[1] : "未分单元";
}

function reviewGroups() {
  const groups = new Map();
  WORDS.forEach((word, index) => {
    const unit = unitNameFromLevel(word.level);
    if (!groups.has(unit)) groups.set(unit, []);
    groups.get(unit).push({ word, progress: state.words[index], index });
  });
  return [...groups.entries()];
}

function renderReview() {
  const groups = reviewGroups();
  selectedReviewUnit ||= groups[0]?.[0] || "";
  el("unitReview").innerHTML = groups.map(([unit, items]) => {
    const learned = items.filter((item) => item.progress.learned).length;
    const mastered = items.filter((item) => item.progress.score >= 85).length;
    const weak = items.filter((item) => item.progress.wrong > 0 || (item.progress.learned && item.progress.score < 60)).length;
    const active = unit === selectedReviewUnit ? "is-active" : "";
    return `<button class="unit-card ${active}" data-unit="${unit}"><strong>${unit}</strong><span>${learned}/${items.length} 已背 · ${mastered} 掌握 · ${weak} 薄弱</span></button>`;
  }).join("");
  document.querySelectorAll("[data-unit]").forEach((button) => button.addEventListener("click", () => {
    selectedReviewUnit = button.dataset.unit;
    renderReview();
  }));
  renderReviewWords(groups);
}

function renderReviewWords(groups = reviewGroups()) {
  const items = groups.find(([unit]) => unit === selectedReviewUnit)?.[1] || [];
  el("reviewUnitPill").textContent = selectedReviewUnit || "选择单元";
  el("reviewWordTable").innerHTML = items.map(({ word, progress }) => {
    const status = progress.score >= 85 ? "已掌握" : progress.learned ? "已背" : "未背";
    const cls = progress.score >= 85 ? "mastered" : progress.learned ? "learned" : "new";
    return `<div class="word-row review-row ${cls}"><strong>${word.word}</strong><span>${status}</span><span>${progress.score}%</span><small>${word.meaning}</small></div>`;
  }).join("") || "<p class='recommendations'>暂无词条。</p>";
}

function renderAdmin() {
  const unlocked = sessionStorage.getItem("vocab-admin-ok") === "1";
  el("adminLoginPanel").style.display = unlocked ? "none" : "grid";
  el("adminDashboardPanel").style.display = unlocked ? "grid" : "none";
  if (!unlocked) return;

  const progress = activeWordProgress();
  const total = progress.length;
  const mastered = masteredWords();
  const dailyTarget = state.daily[todayKey].target;
  const dailyDone = Math.min(currentDailyDone(), dailyTarget);
  const riskWords = progress.filter((word) => riskScore(word) >= 92);
  const info = rankInfo();
  const bestPeak = Math.max(state.peakScore, ...state.peakRecords.map((record) => record.score));

  el("adminTotalRate").textContent = `${Math.round(globalMasteredWords() / TARGET_TOTAL_WORDS * 100)}%`;
  el("adminRiskCount").textContent = riskWords.length;
  el("adminDailyRate").textContent = `${Math.round(dailyDone / dailyTarget * 100)}%`;
  el("adminPeakBest").textContent = bestPeak;
  el("adminTodayWords").textContent = state.daily[todayKey].done;
  el("adminStudyMinutes").textContent = formatDuration(state.daily[todayKey].studySeconds);
  el("adminLoginCount").textContent = state.daily[todayKey].loginCount;
  el("adminLastLogin").textContent = state.daily[todayKey].lastLogin || "--";
  el("adminRankName").textContent = info.tier.name;
  el("adminRankGrid").innerHTML = [
    ["已掌握", `${info.mastered}/${TARGET_TOTAL_WORDS}`],
    ["排位战力", info.adjusted],
    ["综合准确率", `${info.accuracy}%`],
    ["连续学习", `${state.streak} 天`],
    ["距考试", `${examDaysLeft()} 天`],
    ["当前导入", `${WORDS.length} 词`]
  ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");

  const groups = [
    ["已掌握", progress.filter((word) => word.score >= 85).length],
    ["较熟", progress.filter((word) => word.score >= 60 && word.score < 85).length],
    ["待补", progress.filter((word) => word.score >= 30 && word.score < 60).length],
    ["高危", progress.filter((word) => word.score < 30).length]
  ];

  el("masteryDistribution").innerHTML = groups.map(([label, count]) => `
    <div class="dist-row"><strong>${label}</strong><div class="dist-track"><div style="width:${count / total * 100}%"></div></div><span>${count}</span></div>
  `).join("");

  el("riskWordTable").innerHTML = riskWords
    .sort((a, b) => riskScore(b) - riskScore(a))
    .slice(0, 10)
    .map((item) => `<div class="word-row"><strong>${WORDS[item.id].word}</strong><span>${item.score}%</span><span>错 ${item.wrong}</span></div>`)
    .join("") || "<p class='recommendations'>当前没有高风险词，保持节奏。</p>";

  renderTrend();
  renderRegionLogins();
  renderAdminPeakRecords();
  renderSourceStatus();
  renderImportGuide();
  renderRecommendations(riskWords.length, dailyDone, dailyTarget);
}

function renderRegionLogins() {
  const records = state.loginRecords || [];
  const studentCount = records.filter((record) => record.role === "student").length;
  const adminCount = records.filter((record) => record.role === "admin").length;
  const latest = records[0];
  el("regionLoginTable").innerHTML = [
    `<div class="word-row"><strong>深圳学生端</strong><span>${studentCount}次</span><span>手动角色</span></div>`,
    `<div class="word-row"><strong>北京管理员端</strong><span>${adminCount}次</span><span>登录后记录</span></div>`,
    latest ? `<div class="word-row"><strong>最近</strong><span>${latest.region}</span><span>${latest.time}</span><small>${latest.timezone} · ${latest.language}</small></div>` : ""
  ].join("") + "<p class='security-note'>纯静态网页不稳定获取 IP；这里采用角色、浏览器时区和语言做隐私友好判断。</p>";
}

function renderAdminPeakRecords() {
  el("adminPeakRecords").innerHTML = state.peakRecords.slice(0, 8).map((record) => `<div class="word-row"><strong>${record.date}</strong><span>${record.score}分</span><span>${record.correct}/10</span></div>`).join("") || "<p class='recommendations'>暂无巅峰赛记录。</p>";
}

function renderSourceStatus() {
  el("sourceStatus").innerHTML = `<strong>已导入 ${WORDS.length} 个教材词/短语</strong><p>来源为用户提供的《深圳中考英语初中单词汇总(含音标)》文本；已按七上到九下、Unit 分组导入。音标缺失不影响背诵，后续可继续校对释义和补充例句。</p>`;
}

function renderImportGuide() {
  el("importFormat").innerHTML = [
    "字段：word / phonetic / meaning / example / level",
    "来源：学校清单、教材目录、考试说明或明确授权词库",
    "方法：整理后替换 words.js 中的 window.WORDS，并同步 WORD_PACKS 分段"
  ].map((item) => `<span>${item}</span>`).join("");
}

function copyImportTemplate() {
  const template = `{ word: "example", phonetic: "/ɪɡˈzɑːmpəl/", meaning: "例子", example: "This is an example.", level: "来源：学校核验" },`;
  navigator.clipboard?.writeText(template);
  showToast("已复制 words.js 单词模板");
}

function renderTrend() {
  const days = Array.from({ length: 7 }, (_, index) => offsetDate(index - 6));
  el("trendChart").innerHTML = days.map((day) => {
    const data = state.daily[day] || dailyRecord(0, 0, 12);
    return `<div class="trend-bar-wrap"><span class="trend-bar done" style="height:${Math.max(8, data.done * 8)}px"></span><span class="trend-bar wrong" style="height:${Math.max(4, data.wrong * 12)}px"></span><small>${day.slice(5)}</small></div>`;
  }).join("");
}

function renderRecommendations(riskCount, dailyDone, dailyTarget) {
  const days = examDaysLeft();
  const info = rankInfo();
  const items = [
    riskCount > 8 ? "明天不要加新词，先把高风险词复习两轮。" : "风险词数量可控，按今日任务继续即可。",
    dailyDone < dailyTarget ? "今天还没完成，建议拆成两次各 8 分钟。" : "今日任务完成，睡前只扫薄弱词。",
    days <= 30 ? "已进入考前压力区，优先保证高频词正确率，不盲目扩词。" : "每周至少完成 2 次巅峰赛，检查是否只是眼熟。",
    `当前段位 ${info.tier.name}，本教材词表还剩 ${Math.max(0, TARGET_TOTAL_WORDS - info.mastered)} 词/短语未掌握。`,
    "词库已按用户提供的深圳中考初中词表导入，建议后续逐单元校对音标和例句。"
  ];
  el("recommendations").innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function renderPeak() {
  el("peakScorePill").textContent = `${state.peakScore} 分`;
  if (peakSession) {
    const word = WORDS[peakSession.ids[peakSession.index]];
    el("peakWordBox").textContent = `第 ${peakSession.index + 1}/10 题：${word.word} ${word.phonetic || ""}`;
  } else {
    const latest = state.peakRecords[0];
    el("peakWordBox").textContent = latest ? `上局 ${latest.score} 分 · 正确 ${latest.correct}/10` : "完成今日任务后建议挑战一次";
  }
  el("peakHistory").innerHTML = state.peakRecords.slice(0, 3).map((record) => `<span>${record.date} · ${record.score} · ${record.correct}/10</span>`).join("") || "<span>暂无挑战记录</span>";
}

function startPeakChallenge() {
  const pool = activeWordProgress().map((word) => word.id);
  const ids = pool.sort(() => Math.random() - 0.5).slice(0, Math.min(10, pool.length));
  if (!ids.length) return showToast("当前词库为空");
  peakSession = { ids, index: 0, correct: 0, wrong: 0, streak: 0, delta: 0 };
  renderPeak();
  showToast("巅峰赛开始，按真实情况作答");
}

function gradePeak(known) {
  if (!peakSession) {
    startPeakChallenge();
    return;
  }
  const wordState = state.words[peakSession.ids[peakSession.index]];
  if (known) {
    peakSession.correct += 1;
    peakSession.streak += 1;
    peakSession.delta += 10 + Math.min(6, peakSession.streak * 2);
    wordState.score = Math.min(100, wordState.score + 6);
  } else {
    peakSession.wrong += 1;
    peakSession.streak = 0;
    peakSession.delta -= 8;
    wordState.wrong += 1;
    wordState.score = Math.max(0, wordState.score - 10);
    wordState.nextReview = todayKey;
  }
  peakSession.index += 1;
  if (peakSession.index >= peakSession.ids.length) finishPeakChallenge();
  saveState();
  renderAll();
}

function finishPeakChallenge() {
  const score = Math.max(800, state.peakScore + peakSession.delta);
  state.peakScore = score;
  state.peakRecords.unshift({ date: todayKey, score, correct: peakSession.correct, wrong: peakSession.wrong, delta: peakSession.delta });
  state.peakRecords = state.peakRecords.slice(0, 30);
  peakSession = null;
  showToast(`巅峰赛结算 ${score} 分`);
}

function renderSettings() {
  el("wordPackSelect").value = state.packId;
  el("dailyTargetSelect").value = String(state.daily[todayKey].target);
  el("studyModeSelect").value = state.mode;
}

function saveSettings() {
  state.packId = el("wordPackSelect").value;
  state.daily[todayKey].target = Number(el("dailyTargetSelect").value);
  state.mode = el("studyModeSelect").value;
  queue = buildQueue();
  saveState();
  renderAll();
  showToast("学习设置已保存");
}

function skipCurrent() {
  if (currentWordId === null || currentWordId === undefined) {
    showNextWord();
    return;
  }
  const progress = state.words[currentWordId];
  progress.nextReview = todayKey;
  showNextWord();
  showToast("稍后会再出现");
}

function speakCurrent() {
  if (currentWordId === null || currentWordId === undefined) showNextWord();
  if (currentWordId === null || currentWordId === undefined || !window.speechSynthesis) {
    showToast("当前浏览器不支持读音");
    return;
  }
  const utterance = new SpeechSynthesisUtterance(WORDS[currentWordId].word);
  utterance.lang = "en-US";
  utterance.rate = 0.82;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function exportReport() {
  const report = {
    date: todayKey,
    pack: activePack().name,
    totalWords: activeWordProgress().length,
    mastered: masteredWords(),
    daily: state.daily[todayKey],
    riskWords: activeWordProgress()
      .filter((word) => riskScore(word) >= 92)
      .map((word) => ({ word: WORDS[word.id].word, score: word.score, wrong: word.wrong, nextReview: word.nextReview }))
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `vocab-report-${todayKey}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("学习报告已导出");
}

function showToast(message) {
  const toast = el("toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1800);
}

function switchView(view) {
  document.querySelectorAll(".bottom-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  document.querySelectorAll(".view").forEach((panel) => panel.classList.remove("is-visible"));
  el(`${view}View`).classList.add("is-visible");
  renderAll();
}

function loginAdmin() {
  const username = el("adminUsername").value.trim();
  const password = el("adminPassword").value;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    sessionStorage.setItem("vocab-admin-ok", "1");
    recordLogin("admin");
    renderAll();
    showToast("管理员已登录");
    return;
  }
  showToast("账号或密码错误");
}

function resetDemo() {
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  queue = buildQueue();
  currentWordId = null;
  saveState();
  showNextWord();
}

document.querySelectorAll(".bottom-tab").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
el("startSessionButton").addEventListener("click", showNextWord);
el("showAnswerButton").addEventListener("click", showAnswer);
el("knownButton").addEventListener("click", () => gradeCurrent(true));
el("forgotButton").addEventListener("click", () => gradeCurrent(false));
el("skipButton").addEventListener("click", skipCurrent);
el("speakButton").addEventListener("click", speakCurrent);
el("saveSettingsButton").addEventListener("click", saveSettings);
el("exportReportButton").addEventListener("click", exportReport);
el("resetDemoButton").addEventListener("click", resetDemo);
el("startPeakButton").addEventListener("click", startPeakChallenge);
el("peakKnownButton").addEventListener("click", () => gradePeak(true));
el("peakWrongButton").addEventListener("click", () => gradePeak(false));
el("adminLoginButton").addEventListener("click", loginAdmin);
el("copyTemplateButton").addEventListener("click", copyImportTemplate);
window.addEventListener("beforeunload", () => syncStudyDuration(true));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) syncStudyDuration(true);
  else lastDurationSync = Date.now();
});
setInterval(() => syncStudyDuration(), 30000);

ensureToday();
recordLogin();
renderAll();
