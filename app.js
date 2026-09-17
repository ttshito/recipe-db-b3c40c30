'use strict';

// ============================================================
// モック側の設定（データには焼き込まれていない判断）
// ============================================================

// 誰でも常に持っているもの。不足にも具材パネルにも出さない
const ALWAYS_AVAILABLE = new Set(['水', 'お湯', 'パスタの茹で汁', '茹で汁']);

// 「Aがあれば作れる」もの（別物なので synonyms.json の表記統一には入れない）
// 同じ物の別表記は data/synonyms.json の notationVariants に置く
const DERIVED = {
  '卵黄': '卵', '卵白': '卵', '大根おろし': '大根', 'おろし生姜': '生姜', '梅肉': '梅干し',
};

// 具材パネルのカテゴリ（企画書 §4 Case2: 炭水化物/タンパク質/野菜/調味料）
const CATEGORIES = [
  { id: 'carb',    label: '炭水化物',   test: i => i.type1 === 'ingredient' && i.type2 === 'carb' },
  { id: 'protein', label: 'タンパク質', test: i => i.type1 === 'ingredient' && /^protein/.test(i.type2) },
  { id: 'veg',     label: '野菜・きのこ', test: i => i.type1 === 'ingredient' && i.type2 === 'veggies' },
  { id: 'other',   label: 'その他の食材（加工品・乳製品・缶詰など）', test: i => i.type1 === 'ingredient' },
  { id: 'seas',    label: '調味料・薬味', test: i => i.type1 === 'seasoning' },
  { id: 'extra',   label: 'マスタ外（データ更新で増えた未登録の具材）', test: () => true },
];

const LS_KEY = 'recipe-db-state-v1';

// ============================================================
// データ
// ============================================================

const db = {
  recipes: [],       // 正規化済みレシピ
  items: new Map(),  // 具材名 -> {name, type1, type2, rarity, cat, uses, inMaster, isSeas}
  groupOf: new Map(),
  groups: new Map(), // group id -> {representative, members}
};

const state = {
  mode: 'make',        // 'make' = Case 3, 'search' = Case 2
  sel: new Set(),
  syn: true,
  ignoreSeas: false,
  maxMissing: 1,
  sort: 'missing',
  q: '',
};

const ui = { level: {}, filter: '' };

async function load() {
  const get = p => fetch(p).then(r => {
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  });
  const [recipes, ingredients, synonyms] = await Promise.all([
    get('data/recipes.json'), get('data/ingredients.json'), get('data/synonyms.json'),
  ]);

  const variants = synonyms.notationVariants;
  const norm = n => {
    const v = variants[n] ?? n;
    return DERIVED[v] ?? v;
  };

  for (const g of synonyms.synonymGroups) {
    const members = [...new Set(g.members.map(norm))];
    db.groups.set(g.id, { representative: norm(g.representative), members });
    for (const m of members) db.groupOf.set(m, g.id);
  }

  // マスタ（きゃべつ/はちみつ 等もレシピ側と同じ表記に揃える）
  for (const i of ingredients) {
    const name = norm(i.name);
    if (db.items.has(name)) continue;
    db.items.set(name, { name, type1: i.type1, type2: i.type2, rarity: i.rarity, inMaster: true, uses: 0 });
  }

  db.recipes = recipes.map(r => {
    const rows = [];
    const seen = new Set();
    for (const g of r.ingredients) {
      const base = norm(g.name);
      if (ALWAYS_AVAILABLE.has(base)) continue;
      let item = db.items.get(base);
      if (!item) {
        item = {
          name: base, type1: 'ingredient', type2: '', rarity: 3, inMaster: false, uses: 0,
        };
        db.items.set(base, item);
      }
      if (!seen.has(base)) { item.uses++; seen.add(base); }
      rows.push({ name: g.name, base, amount: g.amount, option: g.option, item });
    }
    return {
      id: r.videoId, title: r.title, url: r.url, published: r.published,
      thumbnail: r.thumbnail, hasRecipe: r.hasRecipe, rows,
      bases: new Set(rows.map(x => x.base)),
    };
  });

  for (const it of db.items.values()) {
    it.isSeas = it.type1 === 'seasoning';
    it.cat = it.inMaster ? CATEGORIES.find(c => c.id !== 'extra' && c.test(it)).id : 'extra';
  }
}

// ============================================================
// 判定ロジック
// ============================================================

// 同義グループONなら、グループ内の具材は同じキーになる
const keyOf = base => (state.syn && db.groupOf.has(base)) ? 'G:' + db.groupOf.get(base) : base;
const haveKeys = () => new Set([...state.sel].map(keyOf));
const recipeKeys = r => new Set([...r.bases].map(keyOf));
const titleHit = r => !state.q || r.title.toLowerCase().includes(state.q.toLowerCase());

// Case 2: 選んだ具材を全部使うレシピ
function searchResults() {
  const have = haveKeys();
  const out = [];
  for (const r of db.recipes) {
    if (!titleHit(r)) continue;
    const keys = recipeKeys(r);
    if ([...have].every(k => keys.has(k))) out.push({ r, have, keys });
  }
  const cmp = {
    count: (a, b) => a.r.rows.length - b.r.rows.length,
    new: (a, b) => b.r.published.localeCompare(a.r.published),
  }[state.sort];
  return out.sort(cmp);
}

// Case 3: 手持ちで作れる / あと少しで作れるレシピ
function makeResults() {
  const have = haveKeys();
  const out = [];
  for (const r of db.recipes) {
    if (!titleHit(r)) continue;
    const keys = recipeKeys(r);
    // 「使いたい具材」を1つも使わないレシピは出さない（調味料だけの一致は除外）
    const usesWanted = [...state.sel].some(n => !db.items.get(n).isSeas && keys.has(keyOf(n)));
    if (!usesWanted) continue;

    const missing = [];
    const missKeys = new Set();
    for (const row of r.rows) {
      if (row.option) continue;
      const k = keyOf(row.base);
      if (have.has(k) || missKeys.has(k)) continue;
      if (state.ignoreSeas && row.item.isSeas) continue;
      missKeys.add(k);
      missing.push(row);
    }
    out.push({ r, have, missing, missKeys });
  }
  const cmp = {
    missing: (a, b) => a.missing.length - b.missing.length || a.r.rows.length - b.r.rows.length,
    count: (a, b) => a.r.rows.length - b.r.rows.length || a.missing.length - b.missing.length,
    new: (a, b) => a.missing.length - b.missing.length || b.r.published.localeCompare(a.r.published),
  }[state.sort];
  return out.sort(cmp);
}

// ============================================================
// 描画
// ============================================================

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render() {
  document.querySelectorAll('.tabs button').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.mode === state.mode)));
  $('#syn').checked = state.syn;
  renderControls();
  renderSelected();
  renderResults();
  save();
}

function renderControls() {
  const sortOpts = state.mode === 'make'
    ? [['missing', '不足が少ない順'], ['count', '具材数が少ない順'], ['new', '新しい順']]
    : [['count', '具材数が少ない順'], ['new', '新しい順']];
  if (!sortOpts.some(([v]) => v === state.sort)) state.sort = sortOpts[0][0];

  const makeCtl = state.mode === 'make' ? `
    <span class="ctl">不足を許す
      <span class="seg" id="max">
        ${[0, 1, 2, 3].map(n => `<button data-n="${n}" class="${state.maxMissing === n ? 'on' : ''}">${n === 0 ? 'なし' : n + 'つまで'}</button>`).join('')}
      </span>
    </span>
    <label title="調味料は家にある前提で、不足にカウントしません">
      <input type="checkbox" id="ignore-seas" ${state.ignoreSeas ? 'checked' : ''}> 調味料は不足に数えない
    </label>` : '';

  // 入力中のフォーカスを保つため、検索欄は作り直さない
  const ctl = $('#controls');
  if (!ctl.querySelector('#q')) {
    ctl.innerHTML = `<input type="search" id="q" placeholder="料理名で絞り込み（例: うどん）"><span id="ctl-dyn" style="display:contents"></span>`;
    $('#q').addEventListener('input', e => { state.q = e.target.value; renderResults(); save(); });
  }
  $('#q').value = state.q;
  $('#ctl-dyn').innerHTML = `
    ${makeCtl}
    <label>並び順
      <select id="sort">${sortOpts.map(([v, l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </label>`;
}

function renderSelected() {
  $('#sel-count').textContent = state.sel.size ? `${state.sel.size}品` : '';
  if (!state.sel.size) { $('#selected').innerHTML = ''; return; }
  $('#selected').innerHTML = [...state.sel].map(n =>
    `<span class="tag">${esc(n)}<button data-rm="${esc(n)}" aria-label="${esc(n)}を外す">×</button></span>`
  ).join('');
}

function renderPanel(counts) {
  const f = ui.filter.trim();
  const have = haveKeys();
  const html = [];
  for (const cat of CATEGORIES) {
    const all = [...db.items.values()].filter(i => i.cat === cat.id)
      .sort((a, b) => a.rarity - b.rarity || b.uses - a.uses);
    const maxLevel = ui.level[cat.id] ?? 1;
    const visible = all.filter(i =>
      f ? i.name.includes(f) : (i.rarity <= maxLevel || state.sel.has(i.name)));
    if (!all.length || (!visible.length && f)) continue;

    const chips = visible.map(i => {
      const on = state.sel.has(i.name);
      const g = db.groupOf.get(i.name);
      const implied = !on && state.syn && g && have.has('G:' + g);
      const n = counts ? counts.get(i.name) : i.uses;
      const dim = !on && n === 0;
      const title = [
        `${i.uses}本のレシピで使用`,
        g ? `同義グループ: ${g}（${db.groups.get(g).members.join(' / ')}）` : '',
        implied ? '同義グループの別具材を選択済みなので、これも「ある」扱いです' : '',
      ].filter(Boolean).join('\n');
      return `<label class="chip r${i.rarity}${on ? ' on' : ''}${dim ? ' dim' : ''}${implied ? ' impl' : ''}" title="${esc(title)}">
        <input type="checkbox" data-ing="${esc(i.name)}" ${on ? 'checked' : ''}>${esc(i.name)}${g && state.syn ? '<span class="g">≈</span>' : ''}<span class="n">${n}</span></label>`;
    }).join('');

    let more = '';
    if (!f) {
      const hidden2 = all.filter(i => i.rarity === 2).length;
      const hidden3 = all.filter(i => i.rarity === 3).length;
      if (maxLevel === 1 && hidden2 + hidden3) {
        more = hidden2
          ? `<button class="more" data-cat="${cat.id}" data-lv="2">▼ もっと見る (+${hidden2})</button>`
          : `<button class="more" data-cat="${cat.id}" data-lv="3">▼ もっと見る (+${hidden3})</button>`;
      } else if (maxLevel === 2 && hidden3) {
        more = `<button class="more" data-cat="${cat.id}" data-lv="3">▼ さらに見る (+${hidden3})</button>`;
      } else if (maxLevel > 1) {
        more = `<button class="more" data-cat="${cat.id}" data-lv="1">▲ 閉じる</button>`;
      }
    }
    const note = counts ? '数字=追加した場合の件数' : '数字=使用レシピ数';
    html.push(`<div class="cat"><h3>${cat.label}${cat.id === 'carb' ? `<span class="note">${note}</span>` : ''}</h3><div class="chips">${chips}</div>${more}</div>`);
  }
  $('#categories').innerHTML = html.join('');
}

function ingChips(res) {
  const { r, have, missKeys } = res;
  const main = r.rows.filter(x => !x.option && !x.item.isSeas);
  return main.map(x => {
    const k = keyOf(x.base);
    let cls = '';
    if (state.mode === 'make') cls = missKeys.has(k) ? 'miss' : (have.has(k) ? 'have' : '');
    else cls = have.has(k) ? 'hit' : '';
    return `<span class="ing ${cls}">${esc(x.name)}${x.amount ? `<span class="a">${esc(x.amount)}</span>` : ''}</span>`;
  }).join('');
}

function fullTable(res) {
  const { r, have, missKeys } = res;
  const row = x => {
    const k = keyOf(x.base);
    let st = '';
    if (state.sel.has(x.base)) st = '✓ ある';
    else if (have.has(k)) st = '✓ 同義で代用';
    else if (missKeys && missKeys.has(k)) st = '✗ 不足';
    else if (state.mode === 'make' && x.item.isSeas && state.ignoreSeas) st = '調味料';
    const alias = x.name !== x.base ? ` <span class="badge">→${esc(x.base)}</span>` : '';
    return `<tr><td>${esc(x.name)}${alias}</td><td>${esc(x.amount || '—')}</td><td>${st}</td></tr>`;
  };
  const req = r.rows.filter(x => !x.option);
  const opt = r.rows.filter(x => x.option);
  return `<table class="full">${req.map(row).join('')}
    ${opt.length ? `<tr class="sub"><td colspan="3">仕上げ・味変（任意）</td></tr>${opt.map(row).join('')}` : ''}</table>`;
}

function card(res) {
  const { r } = res;
  let status = '';
  if (state.mode === 'make') {
    status = res.missing.length === 0
      ? `<div class="status ok">✓ 全部ある — いますぐ作れる</div>`
      : `<div class="status miss">あと ${res.missing.map(x =>
          `${esc(x.name)}${x.amount ? `<span class="amt"> ${esc(x.amount)}</span>` : ''}`).join('・')} で作れる</div>`;
  }
  const seasCount = r.rows.filter(x => !x.option && x.item.isSeas).length;
  return `<article class="card">
    <a class="thumb" href="${esc(r.url)}" target="_blank" rel="noopener"><img src="${esc(r.thumbnail)}" alt="" loading="lazy"></a>
    <div>
      <h2><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></h2>
      <div class="meta"><span>${r.published}</span><span>具材 ${r.rows.length}品</span>
        ${r.hasRecipe ? '' : '<span class="badge">説明文にレシピなし（手作業補完）</span>'}</div>
      ${status}
      ${r.rows.length ? `<div class="ings">${ingChips(res)}${seasCount ? `<span class="ing">＋調味料 ${seasCount}品</span>` : ''}</div>
      <details><summary>材料と分量をすべて見る</summary>${fullTable(res)}</details>` : '<div class="meta">材料データなし（動画でご確認ください）</div>'}
    </div>
  </article>`;
}

function renderResults() {
  const cards = $('#cards');
  const summary = $('#summary');

  if (state.mode === 'search') {
    const res = searchResults();
    // 各具材を追加したら何件になるか（0件の具材は薄く表示）
    const counts = new Map();
    for (const it of db.items.values()) {
      const k = keyOf(it.name);
      counts.set(it.name, res.filter(x => x.keys.has(k)).length);
    }
    renderPanel(counts);
    const cond = state.sel.size ? [...state.sel].map(esc).join(' AND ') : '条件なし（全件）';
    summary.innerHTML = `<strong>${res.length}</strong> 件 <span class="bucket">${cond}</span>`;
    cards.innerHTML = res.length
      ? res.map(card).join('')
      : `<div class="empty">この組み合わせのレシピはありません。<br>具材を外すか、同義グループをONにしてみてください。</div>`;
    return;
  }

  renderPanel(null);
  const wanted = [...state.sel].filter(n => !db.items.get(n).isSeas);
  if (!wanted.length) {
    summary.innerHTML = '';
    cards.innerHTML = `<div class="empty">左のパネルで、冷蔵庫にある食材を選んでください。<br>
      調味料は「よく使う調味料を全部☑」でまとめて選べます。</div>`;
    return;
  }
  const all = makeResults();
  const buckets = [0, 1, 2, 3].map(n => all.filter(x => x.missing.length === n).length);
  const res = all.filter(x => x.missing.length <= state.maxMissing);
  summary.innerHTML = `
    <span class="bucket">作れる <strong>${buckets[0]}</strong> 件</span>
    <span class="bucket">不足1で ${buckets[1]} 件</span>
    <span class="bucket">不足2で ${buckets[2]} 件</span>
    <span class="bucket">不足3で ${buckets[3]} 件</span>`;
  cards.innerHTML = res.length
    ? res.map(card).join('')
    : `<div class="empty">不足${state.maxMissing}つ以内で作れるレシピはありません。<br>
        「不足を許す」を増やすか、調味料を選ぶ／「調味料は不足に数えない」をONにしてみてください。</div>`;
}

// ============================================================
// 状態保持（URLクエリ + localStorage）
// ============================================================

function toParams() {
  const p = new URLSearchParams();
  p.set('m', state.mode);
  if (state.sel.size) p.set('i', [...state.sel].join(','));
  p.set('syn', state.syn ? '1' : '0');
  if (state.mode === 'make') {
    p.set('max', String(state.maxMissing));
    if (state.ignoreSeas) p.set('seas', '0');
  }
  p.set('sort', state.sort);
  if (state.q) p.set('q', state.q);
  return p;
}

function fromParams(p) {
  if (p.has('m')) state.mode = p.get('m') === 'search' ? 'search' : 'make';
  if (p.has('i')) state.sel = new Set(p.get('i').split(',').filter(n => db.items.has(n)));
  if (p.has('syn')) state.syn = p.get('syn') !== '0';
  if (p.has('max')) state.maxMissing = Math.min(3, Math.max(0, parseInt(p.get('max'), 10) || 0));
  state.ignoreSeas = p.get('seas') === '0';
  if (p.has('sort')) state.sort = p.get('sort');
  state.q = p.get('q') ?? '';
}

function save() {
  const p = toParams();
  history.replaceState(null, '', '?' + p.toString());
  try { localStorage.setItem(LS_KEY, p.toString()); } catch { /* private mode 等 */ }
}

function restore() {
  const url = new URLSearchParams(location.search);
  if ([...url.keys()].length) return fromParams(url);
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) fromParams(new URLSearchParams(s));
  } catch { /* ignore */ }
}

// ============================================================
// イベント
// ============================================================

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 1800);
}

function bind() {
  $('.tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-mode]');
    if (b) { state.mode = b.dataset.mode; render(); }
  });
  $('#syn').addEventListener('change', e => { state.syn = e.target.checked; render(); });

  $('#categories').addEventListener('change', e => {
    const n = e.target.dataset.ing;
    if (!n) return;
    e.target.checked ? state.sel.add(n) : state.sel.delete(n);
    render();
  });
  $('#categories').addEventListener('click', e => {
    const b = e.target.closest('button.more');
    if (b) { ui.level[b.dataset.cat] = Number(b.dataset.lv); renderResults(); }
  });
  $('#ing-filter').addEventListener('input', e => { ui.filter = e.target.value; renderResults(); });

  $('#selected').addEventListener('click', e => {
    const n = e.target.dataset.rm;
    if (n) { state.sel.delete(n); render(); }
  });
  $('#clear').addEventListener('click', () => { state.sel.clear(); render(); });
  $('#bulk-seas').addEventListener('click', () => {
    for (const it of db.items.values()) if (it.inMaster && it.isSeas && it.rarity === 1) state.sel.add(it.name);
    render();
    toast('rarity 1 の調味料を選択しました');
  });

  $('#controls').addEventListener('click', e => {
    const b = e.target.closest('#max button');
    if (b) { state.maxMissing = Number(b.dataset.n); render(); }
  });
  $('#controls').addEventListener('change', e => {
    if (e.target.id === 'sort') state.sort = e.target.value;
    else if (e.target.id === 'ignore-seas') state.ignoreSeas = e.target.checked;
    else return;
    render();
  });

  $('#share').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast('この条件のURLをコピーしました');
    } catch {
      toast('コピーできませんでした。アドレスバーのURLを共有してください');
    }
  });

  if (matchMedia('(max-width: 820px)').matches) $('#panel-details').open = state.sel.size === 0;
}

load()
  .then(() => { restore(); bind(); render(); })
  .catch(err => {
    document.querySelector('#cards').innerHTML =
      `<div class="empty">データを読み込めませんでした（${esc(err.message)}）。<br>
       file:// では fetch できないので、<code>python3 -m http.server</code> で開いてください。</div>`;
    console.error(err);
  });
