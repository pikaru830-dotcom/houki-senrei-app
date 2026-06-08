"use strict";

/* ==========================================================================
   参議院法規先例アプリ　メインスクリプト
   - フレームワーク不使用。素のJavaScriptで動作。
   - データはdata/フォルダ配下のJSONを読み込む。
   - 画面遷移は#screen-***の表示切替で実現（SPA方式）。
   ========================================================================== */

/* -----------------------------------------
   グローバルなアプリ状態
   ----------------------------------------- */
const App = {
  data: {
    laws: {},               // laws.json
    senreiroku: [],         // senreiroku.json
    senreiHyou: [],         // senrei_hyou.json
    iinkaiSenreiroku: [],   // iinkai_senreiroku.json
    iinkaiSenreiHyou: []    // iinkai_senrei_hyou.json
  },

  // 現在表示中の章・先例（詳細画面で使用）
  currentChapter: null,
  currentArticleIndex: -1,
  currentChapterFlatList: [],  // 「前」「次」ボタンのためのフラットなリスト

  // ブックマーク（先例IDの配列）
  bookmarks: [],

  // ナビゲーション履歴（戻るボタン用）
  history: [],

  // トップ画面の法規一覧（表示順）
  // file: data/laws/ 配下の JSON ファイル名（ASCII小文字＋アンダースコア）
  homeLawList: [
    { key: "日本国憲法",                  icon: "憲",   file: "kenpou.json" },
    { key: "国会法",                      icon: "国",   file: "kokkaihou.json" },
    { key: "参議院規則",                  icon: "規",   file: "kisoku.json" },
    { key: "両院協議会規程",              icon: "協規", file: "kyougikai.json" },
    { key: "常任委員会合同審査会規程",    icon: "合規", file: "goudou_shinsakai.json" },
    { key: "参議院憲法審査会規程",        icon: "憲規", file: "kenpou_shinsakai.json" },
    { key: "参議院情報監視審査会規程",    icon: "情規", file: "jouhou_shinsakai.json" },
    { key: "参議院政治倫理審査会規程",    icon: "倫規", file: "rinri_shinsakai.json" }
  ],

  // トップ画面の先例一覧
  // ※ 先例諸表（senreiHyou / iinkaiSenreiHyou）は実装保留のためトップ画面から非表示。
  //   データ層・検索・参照解決の対応は残してあるので、諸表を整備すれば項目を戻すだけで復活する。
  homeSenreiList: [
    { id: "senreiroku",        title: "令和５年版　参議院先例録",         icon: "本先" },
    { id: "iinkaiSenreiroku",  title: "令和５年版　参議院委員会先例録",   icon: "委先" }
  ]
};

/* -----------------------------------------
   localStorageキー
   ----------------------------------------- */
const BOOKMARK_KEY = "sangiin_bookmarks";


/* ==========================================================================
   起動処理
   ========================================================================== */
document.addEventListener("DOMContentLoaded", init);

async function init() {
  // ブックマークを復元
  loadBookmarks();

  // データを読み込む
  try {
    await loadAllData();
  } catch (err) {
    showError(
      "JSONファイルの読み込みに失敗しました。\n\n" +
      "・ローカル（file://）で開いている場合は、Live Server等の\n" +
      "　簡易サーバー経由でアクセスしてください。\n\n" +
      "・JSONファイルの構文が壊れている可能性もあります。\n\n" +
      "詳細: " + (err && err.message ? err.message : String(err))
    );
    return;
  }

  // 画面の初期描画
  renderHome();
  setupBottomNav();
  setupBackButton();
  setupSearch();

  // 最初の画面を表示
  showScreen("home");
}


/* ==========================================================================
   データ読み込み
   ========================================================================== */
async function loadAllData() {
  // 法規データは法令ごとに個別ファイル: data/laws/{file}
  // ファイルが無い／読めない法令はスキップ（その法令は本文表示で「未登録」扱い）
  const lawPromises = App.homeLawList.map(item =>
    fetchJSON("data/laws/" + item.file).catch(() => null)
  );

  // 先例データを並列ロード
  // 諸表（senrei_hyou / iinkai_senrei_hyou）は実装保留。ファイルが無くても落ちないよう
  // 読込失敗時は空配列にフォールバックする（トップ画面からも非表示）。
  const [sen, senH, isen, isenH, ...lawResults] = await Promise.all([
    fetchJSON("data/senreiroku.json"),
    fetchJSON("data/senrei_hyou.json").catch(() => []),
    fetchJSON("data/iinkai_senreiroku.json"),
    fetchJSON("data/iinkai_senrei_hyou.json").catch(() => []),
    ...lawPromises
  ]);

  App.data.senreiroku       = sen   || [];
  App.data.senreiHyou       = senH  || [];
  App.data.iinkaiSenreiroku = isen  || [];
  App.data.iinkaiSenreiHyou = isenH || [];

  // 法令データを「法令名 → データ」の辞書に組み立てる
  App.data.laws = {};
  App.homeLawList.forEach((item, i) => {
    if (lawResults[i]) App.data.laws[item.key] = lawResults[i];
  });
}

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(path + " : HTTP " + res.status);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(path + " のJSON構文エラー：" + e.message);
  }
}


/* ==========================================================================
   画面切り替え
   ========================================================================== */
const SCREEN_IDS = {
  home:       "screen-home",
  law:        "screen-law",
  lawArticle: "screen-law-article",
  toc:        "screen-toc",
  chapter:    "screen-chapter",
  detail:     "screen-detail",
  search:     "screen-search",
  bookmark:   "screen-bookmark"
};

/**
 * 指定スクリーンを表示する
 * @param {string} name SCREEN_IDSのキー名
 * @param {Object} options { pushHistory: true/false, topTitle, subTitle, showBack }
 */
function showScreen(name, options = {}) {
  // すべて隠す
  Object.values(SCREEN_IDS).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  // 対象を表示
  const targetId = SCREEN_IDS[name];
  const target = document.getElementById(targetId);
  if (target) target.style.display = "flex";

  // トップバータイトル
  const titleEl = document.getElementById("topbar-title");
  if (options.topTitle !== undefined) {
    titleEl.textContent = options.topTitle;
  } else {
    titleEl.textContent = "参議院法規先例アプリ";
  }

  // サブバー
  const subbar = document.getElementById("subbar");
  const subbarText = document.getElementById("subbar-text");
  if (options.subTitle) {
    subbar.style.display = "flex";
    subbarText.textContent = options.subTitle;
  } else {
    subbar.style.display = "none";
  }

  // 戻るボタン
  const backBtn = document.getElementById("btn-back");
  if (options.showBack) {
    backBtn.classList.add("visible");
  } else {
    backBtn.classList.remove("visible");
  }

  // ボトムナビのactive更新
  updateBottomNavActive(name);

  // スクロール位置を先頭に戻す
  document.getElementById("content").scrollTop = 0;
  if (target) target.scrollTop = 0;

  // 履歴記録（戻るボタン用）
  if (options.pushHistory !== false) {
    App.history.push({ name, options: Object.assign({}, options, { pushHistory: false }) });
    // 履歴が長くなりすぎないよう制限
    if (App.history.length > 50) App.history.shift();
  }
}

function setupBackButton() {
  document.getElementById("btn-back").addEventListener("click", () => {
    if (App.history.length <= 1) {
      // 履歴がなければホームへ
      App.history = [];
      showScreen("home");
      return;
    }
    // 現在の画面を履歴から取り除き、新しい末尾（ひとつ前）を表示する。
    // prev.options には pushHistory:false が入っているため、showScreen内で
    // 履歴へ積み直しは行われず、履歴と画面の整合が保たれる。
    App.history.pop();
    const prev = App.history[App.history.length - 1];
    if (prev) {
      // 動的画面（先例詳細・法規条文・章一覧等）は内容が共有DOMに再描画されるため、
      // 画面名だけでは前の内容に戻らない。restore があれば状態を復元して再描画する。
      if (prev.options && typeof prev.options.restore === "function") {
        prev.options.restore();
      } else {
        showScreen(prev.name, prev.options);
      }
    } else {
      showScreen("home");
    }
  });
}


/* ==========================================================================
   ボトムナビゲーション
   ========================================================================== */
function setupBottomNav() {
  document.querySelectorAll(".navbtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const nav = btn.dataset.nav;
      if (nav === "home") {
        App.history = [];
        showScreen("home");
      } else if (nav === "search") {
        showScreen("search", { topTitle: "全文検索", showBack: false });
        // フォーカスをセット
        setTimeout(() => document.getElementById("search-input").focus(), 50);
      } else if (nav === "bookmark") {
        renderBookmarks();
        showScreen("bookmark", { topTitle: "お気に入り", showBack: false });
      }
    });
  });
}

function updateBottomNavActive(name) {
  document.querySelectorAll(".navbtn").forEach(btn => {
    const nav = btn.dataset.nav;
    let active = false;
    if (nav === "home"     && name === "home")                                     active = true;
    if (nav === "search"   && name === "search")                                   active = true;
    if (nav === "bookmark" && name === "bookmark")                                 active = true;
    btn.classList.toggle("active", active);
  });
}


/* ==========================================================================
   トップ画面の描画
   ========================================================================== */
function renderHome() {
  const lawsBox = document.getElementById("home-laws");
  const senreiBox = document.getElementById("home-senrei");
  lawsBox.innerHTML = "";
  senreiBox.innerHTML = "";

  // 法規
  App.homeLawList.forEach(item => {
    const el = makeListItem({
      icon: item.icon || "法",
      iconClass: "law-icon",
      title: item.key,
      onClick: () => openLaw(item.key)
    });
    lawsBox.appendChild(el);
  });

  // 先例
  App.homeSenreiList.forEach(item => {
    const el = makeListItem({
      icon: item.icon || "先",
      iconClass: "senrei-icon",
      title: item.title,
      onClick: () => openSenreiTop(item.id)
    });
    senreiBox.appendChild(el);
  });
}

/**
 * 共通リストアイテムDOMを作成
 */
function makeListItem({ icon, iconClass, title, sub, onClick }) {
  const btn = document.createElement("button");
  btn.className = "list-item";
  btn.type = "button";

  const iconBox = document.createElement("div");
  iconBox.className = "icon-box " + (iconClass || "");
  iconBox.textContent = icon || "";
  btn.appendChild(iconBox);

  const main = document.createElement("div");
  main.className = "item-main";
  const t = document.createElement("div");
  t.className = "item-title";
  t.textContent = title || "";
  main.appendChild(t);
  if (sub) {
    const s = document.createElement("div");
    s.className = "item-sub";
    s.textContent = sub;
    main.appendChild(s);
  }
  btn.appendChild(main);

  const arrow = document.createElement("div");
  arrow.className = "item-arrow";
  arrow.textContent = "›";
  btn.appendChild(arrow);

  if (onClick) btn.addEventListener("click", onClick);
  return btn;
}


/* ==========================================================================
   法規閲覧
   ========================================================================== */
function openLaw(lawName, noPush) {
  const law = App.data.laws[lawName];
  const listBox = document.getElementById("law-list");
  listBox.innerHTML = "";

  // 法令メタ情報のバナー（公布・施行・最終改正日）— 法令単位で一度だけ
  if (law && (law.enacted || law.enforced || law.lastAmended)) {
    const meta = document.createElement("div");
    meta.className = "law-meta-banner";
    const parts = [];
    if (law.enacted)     parts.push("公布：" + formatJpDate(law.enacted));
    if (law.enforced)    parts.push("施行：" + formatJpDate(law.enforced));
    if (law.lastAmended) parts.push("最終改正：" + formatJpDate(law.lastAmended));
    meta.textContent = parts.join("　／　");
    listBox.appendChild(meta);
  }

  if (!law) {
    const empty = document.createElement("div");
    empty.className = "empty-message";
    empty.textContent = "この法令のデータはまだ登録されていません。";
    listBox.appendChild(empty);
  } else if (law.chapters && law.chapters.length > 0) {
    // 章構造あり: 章ごとに折り畳みグループで表示
    if (!App.lawChapterOpen) App.lawChapterOpen = {};
    if (!App.lawChapterOpen[lawName]) App.lawChapterOpen[lawName] = {};
    const openState = App.lawChapterOpen[lawName];

    law.chapters.forEach((chapter, chIdx) => {
      const chapterPath = "c" + chIdx;
      const group = document.createElement("div");
      group.className = "chapter-group";
      if (openState[chapterPath]) group.classList.add("open");

      const header = document.createElement("button");
      header.className = "chapter-group-header";
      header.type = "button";

      // 2行構成: タイトル＋（条範囲）
      const info = document.createElement("span");
      info.className = "chapter-group-info";

      const titleEl = document.createElement("span");
      titleEl.className = "chapter-group-title";
      titleEl.textContent = formatChapterTitle(chapter);
      info.appendChild(titleEl);

      // 章下の全条文キー（節・款をまたいで収集）から条範囲を出す
      const allKeys = collectArticleKeysInNode(chapter);
      // 数値章（"5"や"5-2"）のみ範囲表示。前文・附則 等の非数値章は出さない
      const isNumberedChapter = /^\d+(-\d+)?$/.test(String(chapter.num || ""));
      if (isNumberedChapter && allKeys.length > 0) {
        const range = document.createElement("span");
        range.className = "chapter-group-range";
        range.textContent = buildArticleRangeText(allKeys, law);
        info.appendChild(range);
      }
      header.appendChild(info);

      const caret = document.createElement("span");
      caret.className = "chapter-group-caret";
      caret.textContent = "›";
      header.appendChild(caret);

      // アニメーション用の外側ラッパー
      const bodyOuter = document.createElement("div");
      bodyOuter.className = "chapter-group-body-outer";
      const bodyEl = document.createElement("div");
      bodyEl.className = "chapter-group-body";
      // 章ノード以下を再帰的に描画（条 → 節グループ → 款グループ…）
      renderChapterBodyInto(chapter, bodyEl, law, lawName, openState, chapterPath);
      bodyOuter.appendChild(bodyEl);

      header.addEventListener("click", () => {
        const nowOpen = !group.classList.contains("open");
        group.classList.toggle("open", nowOpen);
        openState[chapterPath] = nowOpen;
      });

      group.appendChild(header);
      group.appendChild(bodyOuter);
      listBox.appendChild(group);
    });
  } else if (law.articles && Object.keys(law.articles).length > 0) {
    // 章なし: 番号順フラットリスト
    const keys = Object.keys(law.articles).sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (isNaN(na) || isNaN(nb)) return a.localeCompare(b);
      return na - nb;
    });
    keys.forEach(k => {
      const art = law.articles[k];
      const item = makeLawArticleItem(art, k, () => openLawArticle(lawName, k));
      listBox.appendChild(item);
    });
  } else {
    const empty = document.createElement("div");
    empty.className = "empty-message";
    empty.textContent = "この法令の条文データはまだ登録されていません。";
    listBox.appendChild(empty);
  }

  showScreen("law", {
    topTitle: lawName,
    subTitle: null,
    showBack: true,
    pushHistory: !noPush,
    restore: () => openLaw(lawName, true)
  });
}

/* ---- 法規表示用ヘルパー（新スキーマ対応） ---- */

// 内部ヘルパー: "N" → "第１章 タイトル"、"N-M" → "第１章の２ タイトル"、それ以外はそのまま
// 表示は常に全角数字に統一する
function formatNumberedTitle(num, title, kindKanji) {
  const s = String(num);
  // N-M（半角ハイフン区切りの枝番）
  const m = s.match(/^(\d+)-(\d+)$/);
  if (m) {
    return "第" + toFullWidthDigits(m[1]) + kindKanji + "の" + toFullWidthDigits(m[2]) + "　" + title;
  }
  // 半角数字のみ
  if (/^\d+$/.test(s)) {
    return "第" + toFullWidthDigits(s) + kindKanji + "　" + title;
  }
  // 全角数字のみ（既に全角）
  if (/^[０-９]+$/.test(s)) {
    return "第" + s + kindKanji + "　" + title;
  }
  // それ以外（前文・附則 等）
  return title || s;
}

// 章タイトル「第N章　タイトル」「第N章のM　タイトル」
function formatChapterTitle(chapter) {
  if (!chapter) return "";
  return formatNumberedTitle(chapter.num || "", chapter.title || "", "章");
}

// 節タイトル
function formatSectionTitle(node) {
  if (!node) return "";
  return formatNumberedTitle(node.num || "", node.title || "", "節");
}

// 款タイトル
function formatSubsectionTitle(node) {
  if (!node) return "";
  return formatNumberedTitle(node.num || "", node.title || "", "款");
}

// 整数を全角数字文字列に
function toFullWidthDigits(n) {
  return String(n).replace(/[0-9]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 48 + 0xFF10)
  );
}

/* ---- 先例表示用ヘルパー（〇号 表記） ---- */

// 漢数字（数字並べ表記）→半角アラビア数字。例: "二"→"2", "一一四"→"114", "二の三"→"2の3"
// 〇/零 もサポート。十/百/千は変換せずそのまま残す（先例録の表記は通常 並べ書き）。
const KANJI_DIGIT_MAP = {
  "〇":"0","零":"0",
  "一":"1","二":"2","三":"3","四":"4","五":"5",
  "六":"6","七":"7","八":"8","九":"9"
};
// 漢数字→算用数字。2系統を判別する:
//  ・位取り無し（先例番号・条番号。例「一〇六」=106、「八〇」=80。ゼロは〇で表す）→ 桁を連結
//  ・位取り表記（節・款番号。例「十一」=11、「十」=10、「二十」=20）→ 十百千で計算
// 「の」（枝番・枝条。例「三十の二」「八〇の八」）で分割し各部を変換する。
function _kanjiPartToArabic(s) {
  if (/[〇零]/.test(s)) {                       // 位取り無し（〇を含む）→ 桁連結
    return [...s].map(c => KANJI_DIGIT_MAP[c] !== undefined ? KANJI_DIGIT_MAP[c] : c).join("");
  }
  if (/[十百千]/.test(s)) {                     // 位取り表記
    let total = 0, cur = 0;
    for (const c of s) {
      if (c === "千") { total += (cur || 1) * 1000; cur = 0; }
      else if (c === "百") { total += (cur || 1) * 100; cur = 0; }
      else if (c === "十") { total += (cur || 1) * 10; cur = 0; }
      else if (KANJI_DIGIT_MAP[c] !== undefined) { cur = +KANJI_DIGIT_MAP[c]; }
      else { return s; }                        // 想定外文字 → そのまま
    }
    return String(total + cur);
  }
  return [...s].map(c => KANJI_DIGIT_MAP[c] !== undefined ? KANJI_DIGIT_MAP[c] : c).join("");
}
function kanjiDigitsToArabic(s) {
  return String(s || "").split("の").map(_kanjiPartToArabic).join("の");
}
function kanjiDigitsToFullWidthArabic(s) {
  return toFullWidthDigits(kanjiDigitsToArabic(s));
}

// 先例番号 + "号" の表示文字列（全角算用数字）。例: "二" → "２号"、"一一四" → "１１４号"
function formatPrecedentNumber(num) {
  const s = String(num || "").trim();
  if (!s) return "";
  // 諸表への参照（例「諸表一」）は「号」を付けない（諸表は号で数えないため）
  if (s.startsWith("諸表")) return kanjiDigitsToFullWidthArabic(s);
  return kanjiDigitsToFullWidthArabic(s) + "号";
}

// 任意の先例配列から「N号〜M号」範囲文字列を作る
function buildPrecedentRangeFromArticles(articles) {
  const nums = (articles || []).filter(a => a && a.number).map(a => a.number);
  if (nums.length === 0) return "";
  if (nums.length === 1) return formatPrecedentNumber(nums[0]);
  return formatPrecedentNumber(nums[0]) + "〜" + formatPrecedentNumber(nums[nums.length - 1]);
}

// 節下の全先例（直下 articles ＋ 款 subsections.articles）を集める
function collectArticlesInSenreiSection(sec) {
  const articles = [];
  (sec && sec.articles || []).forEach(a => articles.push(a));
  (sec && sec.subsections || []).forEach(ss => {
    (ss.articles || []).forEach(a => articles.push(a));
  });
  return articles;
}

// 章下の全先例（節・款を横断）
function collectArticlesInSenreiChapter(chapter) {
  const articles = [];
  (chapter && chapter.sections || []).forEach(sec => {
    collectArticlesInSenreiSection(sec).forEach(a => articles.push(a));
  });
  return articles;
}

// 章下の全先例の範囲
function buildPrecedentRangeText(chapter) {
  return buildPrecedentRangeFromArticles(collectArticlesInSenreiChapter(chapter));
}

// 先例章タイトル "第１章　国会の称呼"
function formatSenreiChapterTitle(chapter) {
  if (!chapter) return "";
  return "第" + toFullWidthDigits(chapter.chapter) + "章　" + (chapter.chapterTitle || "");
}

// 先例節見出し "第１節　召集"（節番号も全角算用数字に変換）
function formatSenreiSectionHeader(sec) {
  if (!sec) return "";
  if (!sec.section) return sec.sectionTitle || "";
  return "第" + kanjiDigitsToFullWidthArabic(sec.section) + "節　" + (sec.sectionTitle || "");
}

// 先例款見出し "第１款　議長及び副議長の選挙"
function formatSenreiSubsectionHeader(ss) {
  if (!ss) return "";
  if (!ss.subsection) return ss.subsectionTitle || "";
  return "第" + kanjiDigitsToFullWidthArabic(ss.subsection) + "款　" + (ss.subsectionTitle || "");
}

// 関連法規の条番号表示。漢数字 → 全角算用数字。"二の三" → "第２条の３"、"二" → "第２条"
function formatLawArticleForChip(article) {
  const s = String(article || "");
  if (!s) return "";
  const conv = kanjiDigitsToFullWidthArabic(s);
  if (conv.indexOf("の") !== -1) return "第" + conv.replace("の", "条の");
  return "第" + conv + "条";
}

// 漢数字の条番号を法規 articles キー形式（半角アラビア、枝条はハイフン）に変換。
// 例: "二"→"2", "五四"→"54", "二の三"→"2-3", "三十の二"→"30-2"
function kanjiArticleToLawKey(article) {
  if (!article) return "";
  return kanjiDigitsToArabic(String(article)).replace("の", "-");
}

// ISO日付("1946-11-03")→和暦表示。簡易実装、明治以降のみ対応。
function formatJpDate(iso) {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  const eras = [
    { name: "令和", start: 2019, startMo: 5,  startD: 1  },
    { name: "平成", start: 1989, startMo: 1,  startD: 8  },
    { name: "昭和", start: 1926, startMo: 12, startD: 25 },
    { name: "大正", start: 1912, startMo: 7,  startD: 30 },
    { name: "明治", start: 1868, startMo: 1,  startD: 25 }
  ];
  for (const era of eras) {
    if (y > era.start || (y === era.start &&
        (mo > era.startMo || (mo === era.startMo && d >= era.startD)))) {
      const yr = y - era.start + 1;
      const yrStr = (yr === 1) ? "元" : String(yr);
      return era.name + yrStr + "年" + mo + "月" + d + "日";
    }
  }
  return iso;
}

// 章・節・款を再帰的に辿って条文キーを掲載順に列挙
function getLawArticleKeysInOrder(law) {
  if (!law) return [];
  if (!law.chapters || law.chapters.length === 0) {
    if (!law.articles) return [];
    return Object.keys(law.articles).sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (isNaN(na) || isNaN(nb)) return a.localeCompare(b);
      return na - nb;
    });
  }
  const keys = [];
  function walk(node) {
    if (node.articleNums) node.articleNums.forEach(n => keys.push(n));
    if (node.sections) node.sections.forEach(walk);
    if (node.subsections) node.subsections.forEach(walk);
  }
  law.chapters.forEach(walk);
  return keys;
}

// 条が属する章・節・款を再帰検索
function findChapterContext(law, articleKey) {
  if (!law || !law.chapters) return null;
  function recurse(node, section, subsection) {
    if (node.articleNums && node.articleNums.indexOf(articleKey) !== -1) {
      return { section, subsection };
    }
    if (node.sections) {
      for (const s of node.sections) {
        const r = recurse(s, s, null);
        if (r) return r;
      }
    }
    if (node.subsections) {
      for (const s of node.subsections) {
        const r = recurse(s, section, s);
        if (r) return r;
      }
    }
    return null;
  }
  for (const ch of law.chapters) {
    const r = recurse(ch, null, null);
    if (r) return { chapter: ch, section: r.section, subsection: r.subsection };
  }
  return null;
}

// 法令名＋章＋節＋款を「　」連結したパンくず
function formatLawBreadcrumb(lawName, law, articleKey) {
  const ctx = findChapterContext(law, articleKey);
  if (!ctx) return lawName;
  const parts = [lawName, formatChapterTitle(ctx.chapter)];
  if (ctx.section)    parts.push(formatSectionTitle(ctx.section));
  if (ctx.subsection) parts.push(formatSubsectionTitle(ctx.subsection));
  return parts.join("　");
}

// 条のバッジ表示（"第１条" / "第１条の２" / "前文" / "附則"）— 数字は常に全角
function getLawArticleBadge(article, articleKey) {
  if (article && article.title) {
    // 「第N条」「第N条の M」の前半を抽出（titleは通常全角だが、念のため正規化）
    const m = article.title.match(/^(第[０-９0-9一二三四五六七八九十百千]+条(?:の[０-９0-9一二三四五六七八九十]+)?)/);
    if (m) return toFullWidthDigits(m[1]);
    return article.title;  // 前文 / 附則 / 主題のみのタイトル等
  }
  if (articleKey === "preamble") return "前文";
  if (articleKey === "fusoku")   return "附則";
  // フォールバック: "2-2" → "第２条の２", "1" → "第１条"
  const km = String(articleKey).match(/^(\d+)-(\d+)$/);
  if (km) return "第" + toFullWidthDigits(km[1]) + "条の" + toFullWidthDigits(km[2]);
  return "第" + toFullWidthDigits(String(articleKey)) + "条";
}

// 条の主題（新スキーマは article.subject、旧スキーマは title からパース）
function getLawArticleSubject(article) {
  if (!article) return "";
  if (article.subject !== undefined && article.subject !== null) return String(article.subject);
  if (article.title) {
    const m = article.title.match(/^第[０-９0-9一二三四五六七八九十百千]+条(?:の[０-９0-9一二三四五六七八九十]+)?[\s　]*[（(](.+?)[）)][\s　]*$/);
    if (m) return m[1].trim();
  }
  return "";
}

// 本文プレビュー（先頭行の冒頭）
function getLawArticlePreview(article, maxLen) {
  const n = maxLen || 38;
  if (!article) return "";
  // 新スキーマ
  if (article.kou && article.kou.length > 0) {
    const firstLine = (article.kou[0].text || "").split("\n")[0];
    return firstLine.length > n ? firstLine.slice(0, n) + "…" : firstLine;
  }
  // 旧スキーマ
  if (article.text) {
    const firstLine = article.text.split("\n")[0];
    return firstLine.length > n ? firstLine.slice(0, n) + "…" : firstLine;
  }
  return "";
}

// 法規条文用ブックマークID
function lawArticleBookmarkId(lawName, articleKey) {
  return "law:" + lawName + ":" + articleKey;
}

// 条文本文を構造化レンダリング（新旧スキーマ両対応）
function renderLawArticleBody(article, container) {
  const card = document.createElement("div");
  card.className = "detail-text";

  if (article && article.kou && article.kou.length > 0) {
    article.kou.forEach(k => {
      const kouEl = document.createElement("div");
      kouEl.className = "kou";
      if (k.num && k.num >= 2) {
        kouEl.classList.add("kou-numbered");
        const numEl = document.createElement("span");
        numEl.className = "kou-num";
        numEl.textContent = toFullWidthDigits(k.num);
        kouEl.appendChild(numEl);
      }
      const textEl = document.createElement("span");
      textEl.className = "kou-text";
      textEl.textContent = k.text || "";
      kouEl.appendChild(textEl);
      card.appendChild(kouEl);

      // 号
      if (k.gou && k.gou.length > 0) {
        const list = document.createElement("ol");
        list.className = "gou-list";
        k.gou.forEach(g => {
          const li = document.createElement("li");
          li.className = "gou-item";
          const numEl = document.createElement("span");
          numEl.className = "gou-num";
          numEl.textContent = g.num || "";
          const textEl = document.createElement("span");
          textEl.className = "gou-text";
          textEl.textContent = g.text || "";
          li.appendChild(numEl);
          li.appendChild(textEl);
          list.appendChild(li);
        });
        card.appendChild(list);
      }
    });
  } else if (article && article.text) {
    card.textContent = article.text;
    card.classList.add("plain");
  } else {
    card.textContent = "この条文はまだ登録されていません。";
    card.classList.add("plain");
  }

  container.appendChild(card);
}

// 法規条文のリストアイテム（番号バッジ＋主題 or 本文プレビュー）
function makeLawArticleItem(article, articleKey, onClick) {
  const btn = document.createElement("button");
  btn.className = "list-item";
  btn.type = "button";

  const badge = document.createElement("div");
  badge.className = "precedent-number-badge";
  badge.textContent = getLawArticleBadge(article, articleKey);
  btn.appendChild(badge);

  const main = document.createElement("div");
  main.className = "item-main";
  const t = document.createElement("div");
  t.className = "item-title";
  const subject = getLawArticleSubject(article);
  t.textContent = subject || getLawArticlePreview(article);
  main.appendChild(t);
  btn.appendChild(main);

  const arrow = document.createElement("div");
  arrow.className = "item-arrow";
  arrow.textContent = "›";
  btn.appendChild(arrow);

  btn.addEventListener("click", onClick);
  return btn;
}

// 任意ノード（章・節・款）以下の条文キーを掲載順に列挙
function collectArticleKeysInNode(node) {
  if (!node) return [];
  const keys = [];
  function walk(n) {
    if (n.articleNums) n.articleNums.forEach(k => keys.push(k));
    if (n.sections)    n.sections.forEach(walk);
    if (n.subsections) n.subsections.forEach(walk);
  }
  walk(node);
  return keys;
}

// 条文番号キー列から「第N条〜第M条」形式の範囲文字列を返す
function buildArticleRangeText(keys, law) {
  if (!keys || keys.length === 0) return "";
  const firstKey = keys[0];
  const lastKey  = keys[keys.length - 1];
  const firstArt = law.articles && law.articles[firstKey];
  const lastArt  = law.articles && law.articles[lastKey];
  const firstLabel = getLawArticleBadge(firstArt, firstKey);
  const lastLabel  = getLawArticleBadge(lastArt,  lastKey);
  return firstLabel === lastLabel ? firstLabel : (firstLabel + "〜" + lastLabel);
}

// 節・款の折り畳みグループを作成（章用と同じ作りを小さくしたもの）
function makeNestedCollapsibleGroup(opts) {
  const group = document.createElement("div");
  group.className = "section-group";
  if (opts.isOpen) group.classList.add("open");

  const header = document.createElement("button");
  header.className = "section-group-header";
  header.type = "button";

  const info = document.createElement("span");
  info.className = "section-group-info";
  const titleEl = document.createElement("span");
  titleEl.className = "section-group-title";
  titleEl.textContent = opts.title;
  info.appendChild(titleEl);
  if (opts.range) {
    const rangeEl = document.createElement("span");
    rangeEl.className = "section-group-range";
    rangeEl.textContent = opts.range;
    info.appendChild(rangeEl);
  }
  header.appendChild(info);

  const caret = document.createElement("span");
  caret.className = "section-group-caret";
  caret.textContent = "›";
  header.appendChild(caret);

  const bodyOuter = document.createElement("div");
  bodyOuter.className = "section-group-body-outer";
  const bodyEl = document.createElement("div");
  bodyEl.className = "section-group-body";
  opts.renderBody(bodyEl);
  bodyOuter.appendChild(bodyEl);

  header.addEventListener("click", () => {
    const nowOpen = !group.classList.contains("open");
    group.classList.toggle("open", nowOpen);
    if (opts.onToggle) opts.onToggle(nowOpen);
  });

  group.appendChild(header);
  group.appendChild(bodyOuter);
  return group;
}

// 章ノード以下を再帰的に描画。節・款は折り畳み、開閉状態は openState[path] に保持。
// 空節（削除等）は折り畳まず静的ラベル表示。
function renderChapterBodyInto(node, container, law, lawName, openState, pathPrefix) {
  // 直下の条
  if (node.articleNums) {
    node.articleNums.forEach(numKey => {
      const art = law.articles && law.articles[numKey];
      if (!art) return;
      const item = makeLawArticleItem(art, numKey, () => openLawArticle(lawName, numKey));
      container.appendChild(item);
    });
  }
  // 節（折り畳み）
  if (node.sections) {
    node.sections.forEach((section, sIdx) => {
      const path = pathPrefix + "/s" + sIdx;
      const allKeys = collectArticleKeysInNode(section);
      if (allKeys.length === 0) {
        // 空節（「第7節 削除」等）は静的表示
        const hdr = document.createElement("div");
        hdr.className = "subsection-header section-empty";
        hdr.textContent = formatSectionTitle(section);
        container.appendChild(hdr);
        return;
      }
      const group = makeNestedCollapsibleGroup({
        title: formatSectionTitle(section),
        range: buildArticleRangeText(allKeys, law),
        isOpen: !!openState[path],
        onToggle: (open) => { openState[path] = open; },
        renderBody: (body) => renderChapterBodyInto(section, body, law, lawName, openState, path)
      });
      container.appendChild(group);
    });
  }
  // 款（折り畳み・節と同じ部品を流用）
  if (node.subsections) {
    node.subsections.forEach((sub, sIdx) => {
      const path = pathPrefix + "/k" + sIdx;
      const allKeys = collectArticleKeysInNode(sub);
      if (allKeys.length === 0) {
        const hdr = document.createElement("div");
        hdr.className = "subsubsection-header section-empty";
        hdr.textContent = formatSubsectionTitle(sub);
        container.appendChild(hdr);
        return;
      }
      const group = makeNestedCollapsibleGroup({
        title: formatSubsectionTitle(sub),
        range: buildArticleRangeText(allKeys, law),
        isOpen: !!openState[path],
        onToggle: (open) => { openState[path] = open; },
        renderBody: (body) => renderChapterBodyInto(sub, body, law, lawName, openState, path)
      });
      container.appendChild(group);
    });
  }
}


/* ==========================================================================
   先例録目次・章・詳細
   ========================================================================== */
/**
 * 先例（録/諸表）データを取得
 */
function getSenreiData(id) {
  switch (id) {
    case "senreiroku":       return { data: App.data.senreiroku,       title: "参議院先例録",       short: "先例録" };
    case "senreiHyou":       return { data: App.data.senreiHyou,       title: "参議院先例諸表",     short: "諸表" };
    case "iinkaiSenreiroku": return { data: App.data.iinkaiSenreiroku, title: "参議院委員会先例録", short: "委員会先例録" };
    case "iinkaiSenreiHyou": return { data: App.data.iinkaiSenreiHyou, title: "参議院委員会先例諸表", short: "委員会諸表" };
  }
  return { data: [], title: "", short: "" };
}

/**
 * 章ごとの先例数を数える
 */
function countArticlesInChapter(chapter) {
  if (!chapter || !chapter.sections) return 0;
  let total = 0;
  chapter.sections.forEach(sec => {
    total += (sec.articles ? sec.articles.length : 0);
    // 款（subsections）内の先例も数える（5章・13章の役員/会議など）
    (sec.subsections || []).forEach(ss => {
      total += (ss.articles ? ss.articles.length : 0);
    });
  });
  return total;
}

/**
 * 先例録の目次を表示（法規と同じ折り畳み式チャプター）
 */
function openSenreiTop(id, noPush) {
  const info = getSenreiData(id);
  const listBox = document.getElementById("toc-list");
  listBox.innerHTML = "";

  App.currentSenreiId = id;

  if (!info.data || info.data.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-message";
    empty.textContent = "データがまだ登録されていません。";
    listBox.appendChild(empty);
  } else {
    if (!App.senreiChapterOpen) App.senreiChapterOpen = {};
    if (!App.senreiChapterOpen[id]) App.senreiChapterOpen[id] = {};
    const openState = App.senreiChapterOpen[id];

    info.data.forEach((chapter, chIdx) => {
      const chapterPath = "c" + chIdx;
      const group = document.createElement("div");
      group.className = "chapter-group";
      if (openState[chapterPath]) group.classList.add("open");

      const header = document.createElement("button");
      header.className = "chapter-group-header";
      header.type = "button";

      const headInfo = document.createElement("span");
      headInfo.className = "chapter-group-info";

      const titleEl = document.createElement("span");
      titleEl.className = "chapter-group-title";
      titleEl.textContent = formatSenreiChapterTitle(chapter);
      headInfo.appendChild(titleEl);

      const range = document.createElement("span");
      range.className = "chapter-group-range";
      range.textContent = buildPrecedentRangeText(chapter);
      headInfo.appendChild(range);
      header.appendChild(headInfo);

      const caret = document.createElement("span");
      caret.className = "chapter-group-caret";
      caret.textContent = "›";
      header.appendChild(caret);

      const bodyOuter = document.createElement("div");
      bodyOuter.className = "chapter-group-body-outer";
      const bodyEl = document.createElement("div");
      bodyEl.className = "chapter-group-body";
      renderSenreiChapterBodyInto(chapter, bodyEl, id, openState, chapterPath);
      bodyOuter.appendChild(bodyEl);

      header.addEventListener("click", () => {
        const nowOpen = !group.classList.contains("open");
        group.classList.toggle("open", nowOpen);
        openState[chapterPath] = nowOpen;
      });

      group.appendChild(header);
      group.appendChild(bodyOuter);
      listBox.appendChild(group);
    });
  }

  showScreen("toc", {
    topTitle: info.title,
    subTitle: null,
    showBack: true,
    pushHistory: !noPush,
    restore: () => openSenreiTop(id, true)
  });
}

/**
 * 章ノード以下を bodyEl に描画。
 * - 節があれば、節ごとに折り畳みグループ（法規の節と同じ部品 makeNestedCollapsibleGroup）
 * - 節がなければ、先例を直接並べる
 * 各先例クリックで詳細画面へ。前後遷移用フラットリストは章全体から作る。
 */
function renderSenreiChapterBodyInto(chapter, bodyEl, senreiId, openState, pathPrefix) {
  // 詳細画面の前後遷移用フラットリスト（節・款を横断した出現順）
  const flat = collectArticlesInSenreiChapter(chapter);

  // 先例リストを所定の要素に追加する小ヘルパー
  const appendArticles = (articles, container) => {
    articles.forEach(art => {
      const item = makeArticleListItem(art, () => {
        openDetail(senreiId, chapter, art, flat);
      });
      container.appendChild(item);
    });
  };

  chapter.sections.forEach((sec, sIdx) => {
    const hasSection = !!(sec.section || sec.sectionTitle);
    const hasSubsections = !!(sec.subsections && sec.subsections.length);

    if (hasSection) {
      const sectionPath = pathPrefix + "/s" + sIdx;
      const group = makeNestedCollapsibleGroup({
        title: formatSenreiSectionHeader(sec),
        range: buildPrecedentRangeFromArticles(collectArticlesInSenreiSection(sec)),
        isOpen: !!(openState && openState[sectionPath]),
        onToggle: (open) => { if (openState) openState[sectionPath] = open; },
        renderBody: (innerBody) => {
          // 節直下の先例（款より前にある分）
          appendArticles(sec.articles || [], innerBody);
          // 款（折り畳み・節と同じ部品を流用）
          (sec.subsections || []).forEach((ss, ssIdx) => {
            const subPath = sectionPath + "/k" + ssIdx;
            const subGroup = makeNestedCollapsibleGroup({
              title: formatSenreiSubsectionHeader(ss),
              range: buildPrecedentRangeFromArticles(ss.articles || []),
              isOpen: !!(openState && openState[subPath]),
              onToggle: (open) => { if (openState) openState[subPath] = open; },
              renderBody: (subBody) => appendArticles(ss.articles || [], subBody)
            });
            innerBody.appendChild(subGroup);
          });
        }
      });
      bodyEl.appendChild(group);
    } else if (hasSubsections) {
      // 節無し・款のみ（通常は無いが念のため）
      (sec.subsections || []).forEach((ss, ssIdx) => {
        const subPath = pathPrefix + "/k" + ssIdx;
        const subGroup = makeNestedCollapsibleGroup({
          title: formatSenreiSubsectionHeader(ss),
          range: buildPrecedentRangeFromArticles(ss.articles || []),
          isOpen: !!(openState && openState[subPath]),
          onToggle: (open) => { if (openState) openState[subPath] = open; },
          renderBody: (subBody) => appendArticles(ss.articles || [], subBody)
        });
        bodyEl.appendChild(subGroup);
      });
    } else {
      appendArticles(sec.articles || [], bodyEl);
    }
  });
}

/**
 * 章内先例一覧を表示
 */
function openChapter(senreiId, chapterNum, noPush) {
  const info = getSenreiData(senreiId);
  const chapter = info.data.find(c => c.chapter === chapterNum);
  if (!chapter) return;

  App.currentSenreiId = senreiId;
  App.currentChapter = chapter;

  const listBox = document.getElementById("chapter-list");
  listBox.innerHTML = "";

  // フラットな先例リスト（前後遷移のため詳細画面でも使用）
  const flat = collectArticlesInSenreiChapter(chapter);

  const addArticleItems = (articles) => {
    (articles || []).forEach(art => {
      const item = makeArticleListItem(art, () => {
        openDetail(senreiId, chapter, art, flat);
      });
      listBox.appendChild(item);
    });
  };
  const addHeader = (text) => {
    if (!text) return;
    const head = document.createElement("div");
    head.className = "section-header";
    head.textContent = text;
    listBox.appendChild(head);
  };

  chapter.sections.forEach(sec => {
    if (sec.section || sec.sectionTitle) addHeader(formatSenreiSectionHeader(sec));
    addArticleItems(sec.articles);
    (sec.subsections || []).forEach(ss => {
      addHeader(formatSenreiSubsectionHeader(ss));
      addArticleItems(ss.articles);
    });
  });

  App.currentChapterFlatList = flat;

  showScreen("chapter", {
    topTitle: "第" + toFullWidthDigits(chapter.chapter) + "章　" + chapter.chapterTitle,
    subTitle: "先例 " + toFullWidthDigits(flat.length) + "件",
    showBack: true,
    pushHistory: !noPush,
    restore: () => openChapter(senreiId, chapterNum, true)
  });
}

/**
 * 先例リストアイテム（番号バッジ＋タイトル）
 */
function makeArticleListItem(article, onClick) {
  const btn = document.createElement("button");
  btn.className = "list-item";
  btn.type = "button";

  const badge = document.createElement("div");
  badge.className = "precedent-number-badge";
  badge.textContent = formatPrecedentNumber(article.number);
  btn.appendChild(badge);

  const main = document.createElement("div");
  main.className = "item-main";
  const t = document.createElement("div");
  t.className = "item-title";
  t.textContent = article.title || "";
  main.appendChild(t);
  btn.appendChild(main);

  const arrow = document.createElement("div");
  arrow.className = "item-arrow";
  arrow.textContent = "›";
  btn.appendChild(arrow);

  btn.addEventListener("click", onClick);
  return btn;
}

/**
 * 先例詳細画面を開く
 */
function openDetail(senreiId, chapter, article, flatList, noPush) {
  App.currentSenreiId = senreiId;
  App.currentChapter = chapter;
  if (flatList) App.currentChapterFlatList = flatList;
  const flat = App.currentChapterFlatList;
  App.currentArticleIndex = flat.findIndex(a => a.id === article.id);

  renderDetail();

  showScreen("detail", {
    topTitle: formatPrecedentNumber(article.number) + "　" + (article.title || ""),
    subTitle: null,
    showBack: true,
    pushHistory: !noPush,
    restore: () => openDetail(senreiId, chapter, article, flat, true)
  });
}

function renderDetail() {
  const article = App.currentChapterFlatList[App.currentArticleIndex];
  if (!article) return;
  const chapter = App.currentChapter;
  const body = document.getElementById("detail-body");
  body.innerHTML = "";

  // パンくず
  const crumb = document.createElement("div");
  crumb.className = "detail-breadcrumb";
  crumb.textContent = formatSenreiChapterTitle(chapter);
  body.appendChild(crumb);

  // 先例番号
  const num = document.createElement("div");
  num.className = "detail-number";
  num.textContent = formatPrecedentNumber(article.number);
  body.appendChild(num);

  // タイトル
  const t = document.createElement("div");
  t.className = "detail-title";
  t.textContent = article.title || "";
  body.appendChild(t);

  // 区切り線
  const div = document.createElement("div");
  div.className = "detail-divider";
  body.appendChild(div);

  // 本文（段落ごとに <p> で描画）
  const text = document.createElement("div");
  text.className = "detail-text";
  const paragraphs = (article.body || "").split("\n");
  paragraphs.forEach(para => {
    const p = document.createElement("p");
    p.className = "detail-paragraph";
    p.textContent = para;
    text.appendChild(p);
  });
  body.appendChild(text);

  // 関連法規
  if (article.laws && article.laws.length > 0) {
    const block = document.createElement("div");
    block.className = "law-block";
    const label = document.createElement("div");
    label.className = "law-block-label";
    label.textContent = "関連法規";
    block.appendChild(label);
    const chips = document.createElement("div");
    chips.className = "law-chips";
    article.laws.forEach(ref => {
      const law = ref.lawName ? App.data.laws[ref.lawName] : null;
      const displayName = (law && law.short) ? law.short : (ref.lawName || ref.raw || "");
      const articleText = ref.article ? formatLawArticleForChip(ref.article) : "";
      let label = displayName + articleText;
      // 参照法規の括弧使い分け: 鍵括弧「」（準用条等）→ 内側、丸括弧（）→ 外側。
      // 例: kagikakko+parenthesized → （「規第八〇条の八」）
      if (ref.kagikakko) label = "「" + label + "」";
      if (ref.parenthesized) label = "（" + label + "）";
      // 漢数字 → 法規 articles キー（半角アラビア、枝条はハイフン）
      const lawKey = ref.article ? kanjiArticleToLawKey(ref.article) : "";
      const linkable = !!(law && lawKey && law.articles && law.articles[lawKey]);
      const chip = document.createElement(linkable ? "button" : "span");
      chip.className = "law-chip" + (linkable ? "" : " law-chip-disabled");
      if (linkable) chip.type = "button";
      chip.textContent = label;
      if (linkable) {
        chip.addEventListener("click", () => openLawArticle(ref.lawName, lawKey));
      }
      chips.appendChild(chip);
    });
    block.appendChild(chips);
    body.appendChild(block);
  }

  // 参照先例
  if (article.refs && article.refs.length > 0) {
    const block = document.createElement("div");
    block.className = "ref-block";
    const label = document.createElement("div");
    label.className = "ref-block-label";
    label.textContent = "参照";
    block.appendChild(label);
    const chips = document.createElement("div");
    chips.className = "ref-chips";
    article.refs.forEach(refStr => {
      const chip = document.createElement("button");
      chip.className = "ref-chip";
      chip.type = "button";
      chip.textContent = formatPrecedentNumber(refStr);
      chip.addEventListener("click", () => jumpToRefArticle(refStr));
      chips.appendChild(chip);
    });
    block.appendChild(chips);
    body.appendChild(block);
  }

  // ボトムアクションバー
  updateDetailActionBar();
}

function updateDetailActionBar() {
  const bookBtn = document.getElementById("btn-bookmark");

  const idx = App.currentArticleIndex;

  const art = App.currentChapterFlatList[idx];
  const isMarked = art && App.bookmarks.indexOf(art.id) !== -1;
  bookBtn.classList.toggle("bookmarked", isMarked);
  bookBtn.textContent = isMarked ? "登録済" : "お気に入り";

  bookBtn.onclick = () => {
    const a = App.currentChapterFlatList[App.currentArticleIndex];
    if (!a) return;
    toggleBookmark(a.id);
    updateDetailActionBar();
  };

  const shareBtn = document.getElementById("btn-share");
  if (shareBtn) {
    shareBtn.onclick = () => {
      const text = getSenreiShareText();
      if (text) shareDetail(text, "先例の共有");
    };
  }
}

/**
 * 参照先例（「先例○」文字列）にジャンプ
 * 全先例ソースを横断して検索する
 */
function jumpToRefArticle(refStr) {
  // 参照は「同じ系統」の中だけで解決する。
  // 参議院先例録と委員会先例録はそれぞれ独立に1号から番号を振っているため、
  // 系統をまたいで参照リンクが飛ぶことは無い（同番号への誤ジャンプを防ぐ）。
  const FAMILIES = {
    senreiroku:       ["senreiroku", "senreiHyou"],
    senreiHyou:       ["senreiroku", "senreiHyou"],
    iinkaiSenreiroku: ["iinkaiSenreiroku", "iinkaiSenreiHyou"],
    iinkaiSenreiHyou: ["iinkaiSenreiroku", "iinkaiSenreiHyou"],
  };
  const family = FAMILIES[App.currentSenreiId];
  // 自身のデータセットを最優先。系統が不明な場合のみ全ソースを対象にする。
  const ids = family
    ? [App.currentSenreiId, ...family.filter(id => id !== App.currentSenreiId)]
    : ["senreiroku", "senreiHyou", "iinkaiSenreiroku", "iinkaiSenreiHyou"];
  for (const id of ids) {
    const data = getSenreiData(id).data;
    for (const chapter of data) {
      // 節・款を横断して全先例を収集（款内の先例を取りこぼさない）
      const flat = collectArticlesInSenreiChapter(chapter);
      const art = flat.find(a => a.number === refStr);
      if (art) {
        App.currentSenreiId = id;
        App.currentChapter = chapter;
        App.currentChapterFlatList = flat;
        openDetail(id, chapter, art, flat);
        return;
      }
    }
  }
  // 見つからない場合は何もしない（エラー表示は不要）
}


/* ==========================================================================
   法規条文詳細画面（先例詳細と同じ仕様：フル画面＋前後遷移）
   ========================================================================== */

/**
 * 法規の条文詳細画面を開く
 * @param {string} lawName  法令名（例：「日本国憲法」）
 * @param {string|number} articleNum 条番号（例："1" や "preamble"）
 */
function openLawArticle(lawName, articleNum, noPush) {
  const law = App.data.laws[lawName];

  // 前後遷移用のキーリスト（章 → 節 → 款を再帰的に辿る）
  const keys = getLawArticleKeysInOrder(law);

  App.currentLawName = lawName;
  App.currentLawArticleKeys = keys;
  App.currentLawArticleKey = String(articleNum);

  renderLawArticle();

  const art = law && law.articles && law.articles[String(articleNum)];
  showScreen("lawArticle", {
    topTitle: lawName + "　" + getLawArticleBadge(art, String(articleNum)),
    showBack: true,
    pushHistory: !noPush,
    restore: () => openLawArticle(lawName, articleNum, true)
  });
}

function renderLawArticle() {
  const lawName = App.currentLawName;
  const articleKey = App.currentLawArticleKey;
  const law = App.data.laws[lawName];
  const body = document.getElementById("law-article-body");
  body.innerHTML = "";

  // パンくず（法令名＋章＋節＋款）
  const crumb = document.createElement("div");
  crumb.className = "detail-breadcrumb";
  crumb.textContent = formatLawBreadcrumb(lawName, law, articleKey);
  body.appendChild(crumb);

  // 番号バッジ
  const art = law && law.articles && law.articles[articleKey];
  const num = document.createElement("div");
  num.className = "detail-number";
  num.textContent = getLawArticleBadge(art, articleKey);
  body.appendChild(num);

  // 主題（あれば見出し風に表示）
  const subject = getLawArticleSubject(art);
  if (subject) {
    const t = document.createElement("div");
    t.className = "detail-title";
    t.textContent = subject;
    body.appendChild(t);
  }

  // 本文（新スキーマは kou/gou を構造化レンダリング、旧スキーマは text プレーン）
  renderLawArticleBody(art, body);

  updateLawArticleActionBar();
}

function updateLawArticleActionBar() {
  const favBtn = document.getElementById("btn-law-bookmark");
  const bookId = lawArticleBookmarkId(App.currentLawName, App.currentLawArticleKey);
  const isMarked = App.bookmarks.indexOf(bookId) !== -1;
  favBtn.classList.toggle("bookmarked", isMarked);
  favBtn.textContent = isMarked ? "登録済" : "お気に入り";
  favBtn.onclick = () => {
    toggleBookmark(bookId);
    updateLawArticleActionBar();
  };

  const shareBtn = document.getElementById("btn-law-share");
  if (shareBtn) {
    shareBtn.onclick = () => {
      const text = getLawArticleShareText();
      if (text) shareDetail(text, "条文の共有");
    };
  }
}


/* ==========================================================================
   検索
   ========================================================================== */
let searchTimer = null;

function setupSearch() {
  const input = document.getElementById("search-input");
  input.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(input.value), 300);
  });
}

/* 旧字体→新字体 正規化辞書（検索同一視用） */
const KYUJI_TO_SHINJI = {
  "廢":"廃","臺":"台","拂":"払","條":"条","圖":"図","經":"経","處":"処",
  "證":"証","舊":"旧","醫":"医","藝":"芸","應":"応","擧":"挙","當":"当",
  "對":"対","體":"体","氣":"気","國":"国","學":"学","實":"実","寫":"写",
  "勞":"労","會":"会","來":"来","參":"参","發":"発","變":"変","聲":"声",
  "齒":"歯","廣":"広","縣":"県","澤":"沢","龜":"亀","樂":"楽","澁":"渋",
  "禮":"礼","榮":"栄","靜":"静","壽":"寿","彈":"弾","團":"団","續":"続",
  "戰":"戦","驛":"駅","營":"営","榮":"栄","關":"関","顯":"顕","賣":"売",
  "讀":"読","屆":"届","區":"区","櫻":"桜","勳":"勲","勵":"励","勸":"勧",
  "齊":"斉","劍":"剣","彌":"弥","巖":"巌","效":"効","曉":"暁","歐":"欧",
  "歲":"歳","殘":"残","氷":"氷","渇":"渇","滯":"滞","狹":"狭","獨":"独",
  "獻":"献","畵":"画","當":"当","盡":"尽","祕":"秘","稅":"税","穀":"穀",
  "稻":"稲","纖":"繊","聽":"聴","膽":"胆","臟":"臓","與":"与","莊":"荘",
  "藏":"蔵","蠶":"蚕","裝":"装","襃":"褒","觀":"観","訓":"訓","譯":"訳",
  "豐":"豊","賴":"頼","逸":"逸","邊":"辺","醉":"酔","釋":"釈","鑛":"鉱",
  "鐵":"鉄","錢":"銭","驗":"験","髮":"髪","鬪":"闘"
};

function applyKyujiNormalize(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    out += KYUJI_TO_SHINJI[ch] || ch;
  }
  return out;
}

/**
 * 文字列を検索用に正規化
 * - 全角英数→半角
 * - 大文字→小文字
 * - 旧字体→新字体
 */
function normalize(s) {
  if (!s) return "";
  const halfwidth = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  ).toLowerCase();
  return applyKyujiNormalize(halfwidth);
}

function runSearch(query) {
  const resultsBox = document.getElementById("search-results");
  const emptyBox = document.getElementById("search-empty");
  resultsBox.innerHTML = "";

  const q = (query || "").trim();
  if (!q) {
    emptyBox.style.display = "none";
    return;
  }

  const nq = normalize(q);
  const hits = [];

  // ===== 法規を検索（homeLawList の掲載順） =====
  for (const lawInfo of App.homeLawList) {
    const law = App.data.laws[lawInfo.key];
    if (!law || !law.articles) continue;
    const orderedKeys = getLawArticleKeysInOrder(law);
    for (const artKey of orderedKeys) {
      const art = law.articles[artKey];
      if (!art) continue;
      const badge = getLawArticleBadge(art, artKey);
      const subject = getLawArticleSubject(art);
      const bodyText = articleToPlainText(art);
      const all = normalize(badge + " " + subject + " " + bodyText);
      if (all.indexOf(nq) === -1) continue;
      const nBody = normalize(bodyText);
      const idx = nBody.indexOf(nq);
      let snippet = "";
      if (idx !== -1) {
        const start = Math.max(0, idx - 30);
        const end = Math.min(bodyText.length, idx + nq.length + 30);
        snippet = (start > 0 ? "…" : "") + bodyText.slice(start, end) + (end < bodyText.length ? "…" : "");
      } else {
        snippet = bodyText.slice(0, 60);
      }
      hits.push({
        type: "law",
        lawName: lawInfo.key,
        articleKey: artKey,
        article: art,
        snippet
      });
    }
  }

  // ===== 先例を検索 =====
  const senreiSources = [
    { id: "senreiroku",       data: App.data.senreiroku },
    { id: "iinkaiSenreiroku", data: App.data.iinkaiSenreiroku },
    { id: "senreiHyou",       data: App.data.senreiHyou },
    { id: "iinkaiSenreiHyou", data: App.data.iinkaiSenreiHyou }
  ];
  for (const src of senreiSources) {
    for (const chapter of src.data) {
      for (const sec of (chapter.sections || [])) {
        for (const art of (sec.articles || [])) {
          const num = art.number || "";
          const title = art.title || "";
          const body = art.body || "";
          const all = normalize(num + " " + title + " " + body);
          if (all.indexOf(nq) !== -1) {
            const nBody = normalize(body);
            const idx = nBody.indexOf(nq);
            let snippet = "";
            if (idx !== -1) {
              const start = Math.max(0, idx - 30);
              const end = Math.min(body.length, idx + nq.length + 30);
              snippet = (start > 0 ? "…" : "") + body.slice(start, end) + (end < body.length ? "…" : "");
            } else {
              snippet = body.slice(0, 60);
            }
            hits.push({
              type: "senrei",
              senreiId: src.id,
              chapter,
              article: art,
              snippet
            });
          }
        }
      }
    }
  }

  if (hits.length === 0) {
    emptyBox.style.display = "flex";
    return;
  }
  emptyBox.style.display = "none";

  hits.forEach(h => {
    const item = document.createElement("button");
    item.className = "search-item";
    item.type = "button";

    if (h.type === "law") {
      // ===== 法規ヒット =====
      const law = App.data.laws[h.lawName];
      const ctx = findChapterContext(law, h.articleKey);
      const headerParts = [h.lawName];
      if (ctx && ctx.chapter)    headerParts.push(formatChapterTitle(ctx.chapter));
      if (ctx && ctx.section)    headerParts.push(formatSectionTitle(ctx.section));
      if (ctx && ctx.subsection) headerParts.push(formatSubsectionTitle(ctx.subsection));
      const chapEl = document.createElement("div");
      chapEl.className = "search-item-chapter";
      chapEl.textContent = headerParts.join("　");
      item.appendChild(chapEl);

      const titleEl = document.createElement("div");
      titleEl.className = "search-item-title";
      const badge = getLawArticleBadge(h.article, h.articleKey);
      const subject = getLawArticleSubject(h.article);
      titleEl.innerHTML = escapeHtml(badge) + (subject ? "　" + highlight(subject, q) : "");
      item.appendChild(titleEl);

      if (h.snippet) {
        const sn = document.createElement("div");
        sn.className = "search-item-snippet";
        sn.innerHTML = highlight(h.snippet, q);
        item.appendChild(sn);
      }

      item.addEventListener("click", () => {
        openLawArticle(h.lawName, h.articleKey);
      });
    } else {
      // ===== 先例ヒット =====
      const chapEl = document.createElement("div");
      chapEl.className = "search-item-chapter";
      chapEl.textContent = formatSenreiChapterTitle(h.chapter);
      item.appendChild(chapEl);

      const titleEl = document.createElement("div");
      titleEl.className = "search-item-title";
      titleEl.innerHTML = formatPrecedentNumber(h.article.number) + "　" + highlight(h.article.title || "", q);
      item.appendChild(titleEl);

      if (h.snippet) {
        const sn = document.createElement("div");
        sn.className = "search-item-snippet";
        sn.innerHTML = highlight(h.snippet, q);
        item.appendChild(sn);
      }

      item.addEventListener("click", () => {
        const flat = collectArticlesInSenreiChapter(h.chapter);
        openDetail(h.senreiId, h.chapter, h.article, flat);
      });
    }

    resultsBox.appendChild(item);
  });
}

/**
 * 検索キーワードをハイライト（HTMLエスケープしてから<mark>挿入）
 */
function highlight(text, query) {
  const escaped = escapeHtml(text);
  if (!query) return escaped;
  const nText = normalize(text);
  const nQuery = normalize(query);
  if (!nQuery) return escaped;
  // 正規化前後で文字数が変わると位置がずれるため、安全策として
  // 正規化済み文字列で検索しつつ、ハイライト箇所のみ単純な
  // 大文字小文字無視の置換で対応する。
  // ※全角→半角の影響は限定的とし、ここでは原文に対する
  //   case-insensitive置換で実装する。
  try {
    const re = new RegExp("(" + escapeRegExp(query) + ")", "gi");
    return escaped.replace(re, "<mark>$1</mark>");
  } catch (e) {
    return escaped;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


/* ==========================================================================
   ブックマーク
   ========================================================================== */
function loadBookmarks() {
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY);
    App.bookmarks = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(App.bookmarks)) App.bookmarks = [];
  } catch (e) {
    App.bookmarks = [];
  }
}

function saveBookmarks() {
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(App.bookmarks));
  } catch (e) {
    // 容量超過などは無視
  }
}

function toggleBookmark(id) {
  const idx = App.bookmarks.indexOf(id);
  if (idx === -1) {
    App.bookmarks.push(id);
  } else {
    App.bookmarks.splice(idx, 1);
  }
  saveBookmarks();
}

function renderBookmarks() {
  const box = document.getElementById("bookmark-list");
  const empty = document.getElementById("bookmark-empty");
  box.innerHTML = "";

  if (App.bookmarks.length === 0) {
    empty.style.display = "flex";
    return;
  }
  empty.style.display = "none";

  const senreiSources = [
    { id: "senreiroku",       data: App.data.senreiroku },
    { id: "iinkaiSenreiroku", data: App.data.iinkaiSenreiroku },
    { id: "senreiHyou",       data: App.data.senreiHyou },
    { id: "iinkaiSenreiHyou", data: App.data.iinkaiSenreiHyou }
  ];

  // ブックマークIDを「法令ごと」「先例ソースごと」に振り分け、登録順を保持
  const lawGroups = {};
  const senreiGroups = {};

  App.bookmarks.forEach(id => {
    if (typeof id === "string" && id.indexOf("law:") === 0) {
      const rest = id.slice(4);
      const sepIdx = rest.indexOf(":");
      if (sepIdx === -1) return;
      const lawName = rest.slice(0, sepIdx);
      const artKey  = rest.slice(sepIdx + 1);
      const law = App.data.laws[lawName];
      const art = law && law.articles && law.articles[artKey];
      if (art) {
        if (!lawGroups[lawName]) lawGroups[lawName] = [];
        lawGroups[lawName].push({ type: "law", id, lawName, artKey, law, article: art });
      }
    } else {
      let hit = null;
      for (const src of senreiSources) {
        for (const chapter of src.data) {
          for (const sec of (chapter.sections || [])) {
            for (const art of (sec.articles || [])) {
              if (art.id === id) {
                hit = { type: "senrei", id, senreiId: src.id, chapter, article: art };
                break;
              }
            }
            if (hit) break;
          }
          if (hit) break;
        }
        if (hit) break;
      }
      if (hit) {
        if (!senreiGroups[hit.senreiId]) senreiGroups[hit.senreiId] = [];
        senreiGroups[hit.senreiId].push(hit);
      }
    }
  });

  // 各グループ内をソース掲載順（昇順）に並べ替える
  Object.keys(lawGroups).forEach(lawName => {
    sortLawBookmarkItems(lawGroups[lawName], App.data.laws[lawName]);
  });
  Object.keys(senreiGroups).forEach(senreiId => {
    const src = senreiSources.find(s => s.id === senreiId);
    if (src) sortSenreiBookmarkItems(senreiGroups[senreiId], src.data);
  });

  // 表示順は homeLawList → homeSenreiList の順を踏襲
  App.homeLawList.forEach(lawInfo => {
    const items = lawGroups[lawInfo.key];
    if (!items || items.length === 0) return;
    renderBookmarkGroup(box, lawInfo.key, items);
  });
  App.homeSenreiList.forEach(senreiInfo => {
    const items = senreiGroups[senreiInfo.id];
    if (!items || items.length === 0) return;
    renderBookmarkGroup(box, senreiInfo.title, items);
  });
}

/** 法令内: 章順→節順→款順→条順 で昇順ソート */
function sortLawBookmarkItems(items, law) {
  if (!law) return;
  const keys = getLawArticleKeysInOrder(law);
  const posMap = {};
  keys.forEach((k, i) => { posMap[k] = i; });
  items.sort((a, b) => {
    const pa = posMap[a.artKey] !== undefined ? posMap[a.artKey] : Number.MAX_SAFE_INTEGER;
    const pb = posMap[b.artKey] !== undefined ? posMap[b.artKey] : Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });
}

/** 先例ソース内: 章順→章内の節・先例順 で昇順ソート */
function sortSenreiBookmarkItems(items, sourceData) {
  if (!sourceData) return;
  const posMap = {};
  let pos = 0;
  sourceData.forEach(chapter => {
    (chapter.sections || []).forEach(sec => {
      (sec.articles || []).forEach(art => {
        if (art && art.id !== undefined) posMap[art.id] = pos++;
      });
    });
  });
  items.sort((a, b) => {
    const ia = a.article && a.article.id;
    const ib = b.article && b.article.id;
    const pa = posMap[ia] !== undefined ? posMap[ia] : Number.MAX_SAFE_INTEGER;
    const pb = posMap[ib] !== undefined ? posMap[ib] : Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });
}

function renderBookmarkGroup(container, headerText, items) {
  const header = document.createElement("div");
  header.className = "bookmark-group-header";
  header.textContent = headerText;
  container.appendChild(header);
  items.forEach(item => container.appendChild(renderBookmarkItem(item)));
}

function renderBookmarkItem(item) {
  const row = document.createElement("div");
  row.className = "bookmark-item";

  const main = document.createElement("button");
  main.className = "item-main";
  main.type = "button";
  main.style.background = "transparent";
  main.style.border = "none";
  main.style.padding = "0";
  main.style.cursor = "pointer";

  if (item.type === "law") {
    // グループ見出しに法令名がある前提で、各項目は「章[節款]名」＋「第N条 主題」
    let chapterLabel = "";
    const ctx = findChapterContext(item.law, item.artKey);
    if (ctx) {
      const parts = [formatChapterTitle(ctx.chapter)];
      if (ctx.section)    parts.push(formatSectionTitle(ctx.section));
      if (ctx.subsection) parts.push(formatSubsectionTitle(ctx.subsection));
      chapterLabel = parts.join("　");
    }
    if (chapterLabel) {
      const cat = document.createElement("div");
      cat.className = "item-chapter";
      cat.textContent = chapterLabel;
      main.appendChild(cat);
    }
    const title = document.createElement("div");
    title.className = "item-title";
    const subject = getLawArticleSubject(item.article);
    title.textContent = getLawArticleBadge(item.article, item.artKey)
                      + (subject ? "　" + subject : "");
    main.appendChild(title);

    main.addEventListener("click", () => {
      openLawArticle(item.lawName, item.artKey);
    });
  } else {
    const chap = document.createElement("div");
    chap.className = "item-chapter";
    chap.textContent = "第" + toFullWidthDigits(item.chapter.chapter) + "章　" + item.chapter.chapterTitle;
    main.appendChild(chap);

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = formatPrecedentNumber(item.article.number) + "　" + (item.article.title || "");
    main.appendChild(title);

    main.addEventListener("click", () => {
      const flat = collectArticlesInSenreiChapter(item.chapter);
      openDetail(item.senreiId, item.chapter, item.article, flat);
    });
  }

  row.appendChild(main);

  const del = document.createElement("button");
  del.className = "bookmark-delete";
  del.type = "button";
  del.textContent = "×";
  del.setAttribute("aria-label", "削除");
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleBookmark(item.id);
    renderBookmarks();
  });
  row.appendChild(del);

  return row;
}


/* ==========================================================================
   共有・コピー・トースト
   ========================================================================== */

/**
 * 詳細画面の本文を共有する。Web Share APIが使えればOSの共有メニューを開き、
 * 使えなければクリップボードへコピー＆トースト通知。
 */
async function shareDetail(text, title) {
  if (!text) return;
  if (navigator.share) {
    try {
      await navigator.share({ title: title || "", text: text });
      return;
    } catch (e) {
      // ユーザーがキャンセルした場合は何もしない
      if (e && e.name === "AbortError") return;
      // それ以外のエラーはクリップボードへフォールバック
    }
  }
  copyToClipboard(text);
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showToast("クリップボードにコピーしました"),
      () => { legacyCopy(text); showToast("クリップボードにコピーしました"); }
    );
  } else {
    legacyCopy(text);
    showToast("クリップボードにコピーしました");
  }
}

// 古いブラウザ向けのコピー（execCommand）
function legacyCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-1000px";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
}

// 画面下にトーストを一定時間表示する
function showToast(msg) {
  let toast = document.getElementById("app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    toast.className = "app-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  // 強制的にリフローしてからクラスを付けることでアニメーションを毎回発火させる
  toast.classList.remove("show");
  void toast.offsetWidth;
  toast.classList.add("show");
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 1800);
}

/**
 * 法規条文の共有テキスト
 *   [法令名 第N章 章名]
 *   第N条（主題）
 *
 *   本文…
 */
// 構造化された article を共有用プレーンテキストに（項番号・号番号を付ける）
function articleToPlainText(article) {
  if (article && article.kou && article.kou.length > 0) {
    const lines = [];
    article.kou.forEach(k => {
      let txt = k.text || "";
      if (k.num && k.num >= 2) {
        txt = toFullWidthDigits(k.num) + "　" + txt;
      }
      lines.push(txt);
      if (k.gou) {
        k.gou.forEach(g => {
          lines.push((g.num || "") + "　" + (g.text || ""));
        });
      }
    });
    return lines.join("\n");
  }
  return (article && article.text) || "";
}

function getLawArticleShareText() {
  const lawName = App.currentLawName;
  const articleKey = App.currentLawArticleKey;
  const law = App.data.laws[lawName];
  const art = law && law.articles && law.articles[articleKey];
  if (!art) return "";

  const badge = getLawArticleBadge(art, articleKey);
  const subject = getLawArticleSubject(art);
  const titleLine = subject ? (badge + "（" + subject + "）") : badge;
  const header = formatLawBreadcrumb(lawName, law, articleKey);
  return header + "\n" + titleLine + "\n\n" + articleToPlainText(art);
}

/**
 * 先例の共有テキスト
 *   [先例ソース名 第N章 章名]
 *   先例番号 タイトル
 *
 *   本文…
 */
function getSenreiShareText() {
  const article = App.currentChapterFlatList[App.currentArticleIndex];
  if (!article) return "";
  const chapter = App.currentChapter;
  const info = getSenreiData(App.currentSenreiId);
  const header = info.title + "　" + formatSenreiChapterTitle(chapter);
  const titleLine = formatPrecedentNumber(article.number) + "　" + (article.title || "");
  return header + "\n" + titleLine + "\n\n" + (article.body || "");
}


/* ==========================================================================
   エラー表示
   ========================================================================== */
function showError(msg) {
  document.getElementById("error-text").textContent = msg;
  document.getElementById("error-overlay").style.display = "flex";
}
