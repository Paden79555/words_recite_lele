const WORDS = [
  { word: "achieve", phonetic: "/əˈtʃiːv/", meaning: "实现；达到", example: "You can achieve your goal if you practise every day.", level: "核心动词" },
  { word: "although", phonetic: "/ɔːlˈðəʊ/", meaning: "虽然；尽管", example: "Although English is hard, I will not give up.", level: "高频连词" },
  { word: "environment", phonetic: "/ɪnˈvaɪrənmənt/", meaning: "环境", example: "Everyone should protect the environment in Shenzhen.", level: "话题词" },
  { word: "improve", phonetic: "/ɪmˈpruːv/", meaning: "提高；改善", example: "Reading aloud can improve your English.", level: "核心动词" },
  { word: "knowledge", phonetic: "/ˈnɒlɪdʒ/", meaning: "知识", example: "Books give us useful knowledge.", level: "抽象名词" },
  { word: "practice", phonetic: "/ˈpræktɪs/", meaning: "练习；实践", example: "Daily practice makes vocabulary easier.", level: "学习词" },
  { word: "necessary", phonetic: "/ˈnesəsəri/", meaning: "必要的", example: "It is necessary to review old words.", level: "核心形容词" },
  { word: "succeed", phonetic: "/səkˈsiːd/", meaning: "成功", example: "Students succeed by working steadily.", level: "核心动词" },
  { word: "valuable", phonetic: "/ˈvæljuəbl/", meaning: "有价值的", example: "Time before the exam is valuable.", level: "核心形容词" },
  { word: "challenge", phonetic: "/ˈtʃælɪndʒ/", meaning: "挑战", example: "The exam is a challenge, not a wall.", level: "情绪词" },
  { word: "confidence", phonetic: "/ˈkɒnfɪdəns/", meaning: "信心", example: "Every correct answer builds confidence.", level: "抽象名词" },
  { word: "grammar", phonetic: "/ˈɡræmə/", meaning: "语法", example: "Vocabulary helps you understand grammar questions.", level: "学习词" },
  { word: "habit", phonetic: "/ˈhæbɪt/", meaning: "习惯", example: "A small habit can change your score.", level: "生活词" },
  { word: "important", phonetic: "/ɪmˈpɔːtnt/", meaning: "重要的", example: "Review is as important as learning new words.", level: "核心形容词" },
  { word: "mistake", phonetic: "/mɪˈsteɪk/", meaning: "错误", example: "A mistake tells you what to review next.", level: "学习词" },
  { word: "prepare", phonetic: "/prɪˈpeə/", meaning: "准备", example: "We prepare for the exam step by step.", level: "核心动词" },
  { word: "reason", phonetic: "/ˈriːzn/", meaning: "原因；理由", example: "Find the reason why you forgot the word.", level: "核心名词" },
  { word: "review", phonetic: "/rɪˈvjuː/", meaning: "复习；回顾", example: "Review the word before it disappears.", level: "学习词" },
  { word: "sentence", phonetic: "/ˈsentəns/", meaning: "句子", example: "Put every new word into a sentence.", level: "学习词" },
  { word: "understand", phonetic: "/ˌʌndəˈstænd/", meaning: "理解", example: "Examples help you understand the meaning.", level: "核心动词" },
  { word: "activity", phonetic: "/ækˈtɪvəti/", meaning: "活动", example: "School activities often appear in reading tests.", level: "校园词" },
  { word: "carefully", phonetic: "/ˈkeəfəli/", meaning: "仔细地", example: "Read the question carefully before answering.", level: "副词" },
  { word: "decision", phonetic: "/dɪˈsɪʒn/", meaning: "决定", example: "Making a study plan is a good decision.", level: "抽象名词" },
  { word: "healthy", phonetic: "/ˈhelθi/", meaning: "健康的", example: "A healthy body supports better learning.", level: "生活词" }
];

const STORAGE_KEY = "shenzhen-vocab-quest-state";
const todayKey = new Date().toISOString().slice(0, 10);
const intervals = [1, 2, 4, 7, 15];
let state = loadState();
let queue = buildQueue();
let currentWordId = null;
let answerVisible = false;

const el = (id) => document.getElementById(id);

function loadState() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  if (saved && saved.words && saved.words.length === WORDS.length) {
    saved.mode ||= "balanced";
    return saved;
  }

  return {
    coins: 18,
    streak: 3,
    mode: "balanced",
    lastStudyDate: todayKey,
    daily: { [todayKey]: { done: 0, wrong: 0, target: 12 } },
    words: WORDS.map((item, index) => ({
      id: index,
      score: index % 5 === 0 ? 80 : index % 4 === 0 ? 55 : index % 3 === 0 ? 35 : 10,
      correct: index % 4,
      wrong: index % 5 === 0 ? 0 : index % 3,
      intervalIndex: Math.min(index % intervals.length, 2),
      nextReview: offsetDate(index % 6 === 0 ? -1 : index % 4),
      reviewedToday: false,
      history: []
    }))
  };
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

function buildQueue() {
  ensureToday();
  const candidates = state.words.filter((word) => {
    if (state.mode === "weak") return word.nextReview <= todayKey || word.score < 60 || word.wrong > 0;
    if (state.mode === "new") return !word.reviewedToday || word.nextReview <= todayKey;
    return word.nextReview <= todayKey || word.score < 60 || !word.reviewedToday;
  });

  return candidates
    .sort((a, b) => queueScore(b) - queueScore(a))
    .slice(0, state.daily[todayKey].target)
    .map((word) => word.id);
}

function riskScore(word) {
  const overdue = word.nextReview < todayKey ? 35 : word.nextReview === todayKey ? 20 : 0;
  return (100 - word.score) + word.wrong * 12 + overdue;
}

function queueScore(word) {
  if (state.mode === "new") return word.reviewedToday ? riskScore(word) : riskScore(word) + 24;
  if (state.mode === "weak") return riskScore(word) + word.wrong * 18;
  return riskScore(word);
}

function currentDailyDone() {
  return state.words.filter((word) => word.reviewedToday).length;
}

function masteredWords() {
  return state.words.filter((word) => word.score >= 80).length;
}

function showNextWord() {
  queue = buildQueue();
  const nextId = queue.find((id) => !state.words[id].reviewedToday) ?? queue[0];
  currentWordId = nextId;
  answerVisible = false;

  if (currentWordId === undefined) {
    el("wordText").textContent = "今日任务完成";
    el("wordPhonetic").textContent = "明天继续复习会更稳。";
    el("wordMeaning").textContent = "去管理员看板看看薄弱词和整体掌握率。";
    el("wordExample").textContent = "如果还有精力，可以重置演示数据或明天继续。";
    el("wordStatus").textContent = "已完成";
    renderAll();
    return;
  }

  const word = WORDS[currentWordId];
  const progress = state.words[currentWordId];
  el("wordLevel").textContent = word.level;
  el("wordStatus").textContent = `掌握度 ${progress.score}% · 错 ${progress.wrong} 次`;
  el("wordText").textContent = word.word;
  el("wordPhonetic").textContent = word.phonetic;
  el("wordMeaning").textContent = "先在心里说出中文释义，再点击显示释义。";
  el("wordExample").textContent = "回忆 3 秒后再看答案，效果比直接看释义更好。";
  renderAll();
}

function showAnswer() {
  if (currentWordId === null || currentWordId === undefined) return;
  const word = WORDS[currentWordId];
  answerVisible = true;
  el("wordMeaning").textContent = word.meaning;
  el("wordExample").textContent = word.example;
}

function gradeCurrent(known) {
  if (currentWordId === null || currentWordId === undefined) return;
  const progress = state.words[currentWordId];
  progress.reviewedToday = true;
  progress.history.push({ date: todayKey, known });

  if (known) {
    progress.correct += 1;
    progress.score = Math.min(100, progress.score + (answerVisible ? 18 : 12));
    progress.intervalIndex = Math.min(intervals.length - 1, progress.intervalIndex + 1);
    state.coins += 3;
    showToast("记住了，金币 +3");
  } else {
    progress.wrong += 1;
    progress.score = Math.max(0, progress.score - 16);
    progress.intervalIndex = 0;
    state.daily[todayKey].wrong += 1;
    state.coins = Math.max(0, state.coins - 1);
    showToast("已加入高频复习队列");
  }

  state.daily[todayKey].done += 1;
  progress.nextReview = offsetDate(intervals[progress.intervalIndex]);
  saveState();
  showNextWord();
}

function renderAll() {
  renderProgress();
  renderQuestMap();
  renderCurve();
  renderAdmin();
  renderSettings();
}

function renderProgress() {
  const total = WORDS.length;
  const mastered = masteredWords();
  const dailyTarget = state.daily[todayKey].target;
  const dailyDone = Math.min(currentDailyDone(), dailyTarget);
  const masteryRate = Math.round((mastered / total) * 100);

  el("masteryPercent").textContent = `${masteryRate}%`;
  el("masteryRing").style.setProperty("--value", `${masteryRate * 3.6}deg`);
  el("totalWordsCount").textContent = total;
  el("dueWordsCount").textContent = buildQueue().length;
  el("streakPill").textContent = `连续 ${state.streak} 天`;
  el("dailyProgressText").textContent = `${dailyDone} / ${dailyTarget}`;
  el("dailyProgressBar").style.width = `${Math.min(100, dailyDone / dailyTarget * 100)}%`;
  el("totalProgressText").textContent = `${mastered} / ${total}`;
  el("totalProgressBar").style.width = `${masteryRate}%`;
  el("coinCount").textContent = `${state.coins} 金币`;
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
  const dueBuckets = intervals.map((days) => {
    const date = offsetDate(days);
    return state.words.filter((word) => word.nextReview <= date).length;
  });
  const max = Math.max(...dueBuckets, 1);
  el("curveChart").innerHTML = dueBuckets.map((count, index) => `
    <div class="curve-bar"><span style="height:${Math.max(12, count / max * 130)}px"></span><small>${intervals[index]}天<br>${count}词</small></div>
  `).join("");
}

function renderAdmin() {
  const total = WORDS.length;
  const mastered = masteredWords();
  const dailyTarget = state.daily[todayKey].target;
  const dailyDone = Math.min(currentDailyDone(), dailyTarget);
  const riskWords = state.words.filter((word) => riskScore(word) >= 78);

  el("adminTotalRate").textContent = `${Math.round(mastered / total * 100)}%`;
  el("adminRiskCount").textContent = riskWords.length;
  el("adminDailyRate").textContent = `${Math.round(dailyDone / dailyTarget * 100)}%`;
  el("adminCoins").textContent = state.coins;

  const groups = [
    ["已掌握", state.words.filter((word) => word.score >= 80).length],
    ["较熟悉", state.words.filter((word) => word.score >= 60 && word.score < 80).length],
    ["待加强", state.words.filter((word) => word.score >= 35 && word.score < 60).length],
    ["高风险", state.words.filter((word) => word.score < 35).length]
  ];

  el("masteryDistribution").innerHTML = groups.map(([label, count]) => `
    <div class="dist-row"><strong>${label}</strong><div class="dist-track"><div style="width:${count / total * 100}%"></div></div><span>${count}</span></div>
  `).join("");

  el("riskWordTable").innerHTML = riskWords
    .sort((a, b) => riskScore(b) - riskScore(a))
    .slice(0, 8)
    .map((item) => `<div class="word-row"><strong>${WORDS[item.id].word}</strong><span>${item.score}%</span><span>错 ${item.wrong} 次</span></div>`)
    .join("") || "<p class='hint'>当前没有高风险词，保持节奏。</p>";

  renderTrend();
  renderRecommendations(riskWords.length, dailyDone, dailyTarget);
}

function renderTrend() {
  const days = Array.from({ length: 7 }, (_, index) => offsetDate(index - 6));
  el("trendChart").innerHTML = days.map((day) => {
    const data = state.daily[day] || { done: Math.max(0, Math.round(Math.random() * 8)), wrong: Math.round(Math.random() * 3) };
    return `<div class="trend-bar-wrap"><span class="trend-bar done" style="height:${Math.max(8, data.done * 9)}px"></span><span class="trend-bar wrong" style="height:${Math.max(4, data.wrong * 12)}px"></span><small>${day.slice(5)}</small></div>`;
  }).join("");
}

function renderRecommendations(riskCount, dailyDone, dailyTarget) {
  const items = [
    riskCount > 5 ? "先暂停新增词，把高风险词集中复习 2 轮。" : "风险词数量可控，可以维持今日新增和复习节奏。",
    dailyDone < dailyTarget ? "今天还没完成任务，建议拆成 2 次各 10 分钟。" : "今日任务完成，睡前只需快速扫一遍错词。",
    "每周家长只看 3 个指标：总掌握率、连续天数、高风险词数量。",
    "考前 15 天减少新词比例，把重心切到错词和阅读高频词。"
  ];
  el("recommendations").innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function renderSettings() {
  el("dailyTargetSelect").value = String(state.daily[todayKey].target);
  el("studyModeSelect").value = state.mode;
}

function saveSettings() {
  state.daily[todayKey].target = Number(el("dailyTargetSelect").value);
  state.mode = el("studyModeSelect").value;
  queue = buildQueue();
  saveState();
  renderAll();
  showToast("学习设置已保存");
}

function skipCurrent() {
  if (currentWordId === null || currentWordId === undefined) return;
  const skipped = queue.shift();
  queue.push(skipped);
  currentWordId = queue.find((id) => !state.words[id].reviewedToday) ?? queue[0];
  showNextWord();
  showToast("已放到稍后复习");
}

function speakCurrent() {
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
    totalWords: WORDS.length,
    mastered: masteredWords(),
    daily: state.daily[todayKey],
    riskWords: state.words
      .filter((word) => riskScore(word) >= 78)
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

let toastTimer;
function showToast(message) {
  const toast = el("toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1800);
}

function switchView(view) {
  document.querySelectorAll(".tab-button, .bottom-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
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

document.querySelectorAll(".tab-button, .bottom-tab").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
document.querySelectorAll("[data-view-jump]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.viewJump)));
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
