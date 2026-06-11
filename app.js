const WORDS = window.WORDS || [];
const WORD_PACKS = window.WORD_PACKS || [{ id: "full-sample", name: "样例全量", subtitle: "当前词库", maxIndex: 9999, source: "内置样例" }];
const STORAGE_KEY = "shenzhen-vocab-quest-state-v2";
const todayKey = new Date().toISOString().slice(0, 10);
const intervals = [1, 2, 4, 7, 15];
const el = (id) => document.getElementById(id);
let state = loadState();
let queue = buildQueue();
let currentWordId = null;
let answerVisible = false;
let toastTimer;

function loadState() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  if (saved && saved.words && saved.words.length === WORDS.length) {
    saved.mode ||= "balanced";
    saved.packId ||= "starter";
    saved.coins ??= 0;
    return saved;
  }

  return {
    coins: 0,
    streak: 1,
    mode: "balanced",
    packId: "starter",
    lastStudyDate: todayKey,
    daily: seedDaily(),
    words: WORDS.map((_, index) => ({
      id: index,
      score: index % 7 === 0 ? 70 : index % 5 === 0 ? 45 : 0,
      correct: 0,
      wrong: index % 6 === 0 ? 1 : 0,
      intervalIndex: 0,
      nextReview: index % 6 === 0 ? offsetDate(-1) : todayKey,
      reviewedToday: false,
      history: []
    }))
  };
}

function seedDaily() {
  const daily = { [todayKey]: { done: 0, wrong: 0, target: 12 } };
  for (let i = 1; i <= 6; i += 1) {
    daily[offsetDate(-i)] = { done: Math.max(0, 10 - i), wrong: Math.max(0, Math.floor(i / 2)), target: 12 };
  }
  return daily;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function offsetDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function ensureToday() {
  if (!state.daily[todayKey]) state.daily[todayKey] = { done: 0, wrong: 0, target: 12 };
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
  el("wordLevel").textContent = word.level;
  el("wordStatus").textContent = `掌握 ${progress.score}% · 错 ${progress.wrong} 次`;
  el("wordText").textContent = word.word;
  el("wordPhonetic").textContent = word.phonetic;
  el("wordMeaning").textContent = "先遮住中文，在心里回忆 3 秒。";
  el("wordExample").textContent = "想不起也没关系，点“看答案”后诚实选择。";
  el("todayAdvice").textContent = progress.wrong > 0 ? "这张是薄弱词，今天优先补上。" : "先回忆，再确认答案。";
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

  if (known) {
    progress.correct += 1;
    progress.score = Math.min(100, progress.score + (answerVisible ? 20 : 12));
    progress.intervalIndex = Math.min(intervals.length - 1, progress.intervalIndex + 1);
    state.coins += 3;
    showToast("认识，金币 +3");
  } else {
    progress.wrong += 1;
    progress.score = Math.max(0, progress.score - 18);
    progress.intervalIndex = 0;
    state.daily[todayKey].wrong += 1;
    state.coins = Math.max(0, state.coins - 1);
    showToast("已加入错词优先复习");
  }

  state.daily[todayKey].done += 1;
  progress.nextReview = offsetDate(intervals[progress.intervalIndex]);
  saveState();
  showNextWord();
}

function renderAll() {
  renderProgress();
  renderPackLadder();
  renderQuestMap();
  renderCurve();
  renderAdmin();
  renderSettings();
}

function renderProgress() {
  const pack = activePack();
  const total = activeWordProgress().length;
  const mastered = masteredWords();
  const dailyTarget = state.daily[todayKey].target;
  const dailyDone = Math.min(currentDailyDone(), dailyTarget);
  const masteryRate = Math.round((mastered / total) * 100);

  el("masteryPercent").textContent = `${masteryRate}%`;
  el("masteryRing").style.setProperty("--value", `${masteryRate * 3.6}deg`);
  el("totalWordsCount").textContent = total;
  el("dueWordsCount").textContent = buildQueue().length;
  el("streakPill").textContent = state.streak;
  el("dailyProgressText").textContent = `${dailyDone} / ${dailyTarget}`;
  el("dailyProgressBar").style.width = `${Math.min(100, dailyDone / dailyTarget * 100)}%`;
  el("coinCount").textContent = `${state.coins} 金币`;
  el("activePackName").textContent = `${pack.name} · ${pack.subtitle}`;
  el("packSourcePill").textContent = pack.id === "full-sample" ? "非官方样例" : "分级样例";
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

function renderAdmin() {
  const progress = activeWordProgress();
  const total = progress.length;
  const mastered = masteredWords();
  const dailyTarget = state.daily[todayKey].target;
  const dailyDone = Math.min(currentDailyDone(), dailyTarget);
  const riskWords = progress.filter((word) => riskScore(word) >= 92);

  el("adminTotalRate").textContent = `${Math.round(mastered / total * 100)}%`;
  el("adminRiskCount").textContent = riskWords.length;
  el("adminDailyRate").textContent = `${Math.round(dailyDone / dailyTarget * 100)}%`;
  el("adminCoins").textContent = state.coins;

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
  renderRecommendations(riskWords.length, dailyDone, dailyTarget);
}

function renderTrend() {
  const days = Array.from({ length: 7 }, (_, index) => offsetDate(index - 6));
  el("trendChart").innerHTML = days.map((day) => {
    const data = state.daily[day] || { done: 0, wrong: 0, target: 12 };
    return `<div class="trend-bar-wrap"><span class="trend-bar done" style="height:${Math.max(8, data.done * 8)}px"></span><span class="trend-bar wrong" style="height:${Math.max(4, data.wrong * 12)}px"></span><small>${day.slice(5)}</small></div>`;
  }).join("");
}

function renderRecommendations(riskCount, dailyDone, dailyTarget) {
  const items = [
    riskCount > 8 ? "明天不要加新词，先把高风险词复习两轮。" : "风险词数量可控，按今日任务继续即可。",
    dailyDone < dailyTarget ? "今天还没完成，建议拆成两次各 8 分钟。" : "今日任务完成，睡前只扫薄弱词。",
    "家长每周只看总掌握、连续天数和高风险词数量。",
    "上线前需导入完整深圳中考词库，当前为高频样例词库。"
  ];
  el("recommendations").innerHTML = items.map((item) => `<li>${item}</li>`).join("");
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

ensureToday();
saveState();
renderAll();
