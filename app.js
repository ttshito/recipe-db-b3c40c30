'use strict';

const BUILD = '20260920-1916';   // release.sh が書き換える。データ取得のキャッシュ避けと版表示に使う

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
  must: new Set(),    // そのうち「必ず使う」具材（Case 3 の AND 条件）
  syn: true,
  synOff: new Set(),   // 個別にOFFにした同義グループのid
  ignoreSeas: true,   // 調味料は家にある前提（Case 3 の初期値）
  maxMissing: 1,
  sort: 'missing',
  q: '',
};

const ui = { level: {}, filter: '', advOpen: false, collapsed: { seas: true }, seasTags: false };  // 調味料は最初は畳む

async function load() {
  const get = p => fetch(p).then(r => {
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  });
  const [recipes, ingredients, synonyms] = await Promise.all([
    get(`data/recipes.json?v=${BUILD}`), get(`data/ingredients.json?v=${BUILD}`), get(`data/synonyms.json?v=${BUILD}`),
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
const groupOn = id => state.syn && !state.synOff.has(id);
// その具材に効いている同義グループ（効いていなければ null）
const activeGroup = base => {
  const g = db.groupOf.get(base);
  return g && groupOn(g) ? g : null;
};
const keyOf = base => { const g = activeGroup(base); return g ? 'G:' + g : base; };
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
    countDesc: (a, b) => b.r.rows.length - a.r.rows.length,
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
    // ★を付けた具材は全部使うレシピだけ。★が無ければ、選んだ食材を1つ以上使うレシピ
    const ok = state.must.size
      ? [...state.must].every(n => keys.has(keyOf(n)))
      : [...state.sel].some(n => !db.items.get(n).isSeas && keys.has(keyOf(n)));
    if (!ok) continue;

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
    countDesc: (a, b) => b.r.rows.length - a.r.rows.length || a.missing.length - b.missing.length,
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
    ? [['missing', '不足が少ない順'], ['count', '具材数が少ない順'], ['countDesc', '具材数が多い順']]
    : [['count', '具材数が少ない順'], ['countDesc', '具材数が多い順']];
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
    </label>
    ${state.sel.size ? `<button id="clear" class="ghost small">選択をクリア（${state.sel.size}品）</button>` : ''}`;
}

function renderSelected() {
  $('#sel-count').textContent = state.sel.size ? `${state.sel.size}品` : '';
  if (!state.sel.size) { $('#selected').innerHTML = ''; return; }
  const star = state.mode === 'make';
  const tag = n => {
    const on = state.must.has(n);
    return `<span class="tag${on ? ' must' : ''}">
      ${star ? `<button class="star" data-must="${esc(n)}" title="${esc(n)}を必ず使うレシピだけに絞る" aria-pressed="${on}">${on ? '★' : '☆'}</button>` : ''}
      ${esc(n)}<button data-rm="${esc(n)}" aria-label="${esc(n)}を外す">×</button></span>`;
  };
  const sel = [...state.sel];
  // 調味料のタグは数が多く画面を圧迫するので、既定ではまとめて1つにする
  const seas = sel.filter(n => db.items.get(n).isSeas && !state.must.has(n));
  const shown = sel.filter(n => !seas.includes(n));
  $('#selected').innerHTML = shown.map(tag).join('')
    + (seas.length ? (ui.seasTags
      ? seas.map(tag).join('') + `<button class="tag-more" data-seastags="0">調味料をまとめる ▲</button>`
      : `<button class="tag-more" data-seastags="1">調味料 ${seas.length}品 ▼</button>`) : '');
}

function renderPanel(counts) {
  const f = ui.filter.trim();
  const have = haveKeys();
  const html = [];
  for (const cat of CATEGORIES) {
    const all = [...db.items.values()].filter(i => i.cat === cat.id)
      .sort((a, b) => a.rarity - b.rarity || b.uses - a.uses);
    const maxLevel = ui.level[cat.id] ?? 1;
    // 畳んでいるカテゴリは見出しと開くボタンだけ（具材名で絞り込み中は中身を出す）
    if (ui.collapsed[cat.id] && !f) {
      const sel = all.filter(i => state.sel.has(i.name)).length;
      html.push(`<div class="cat"><h3>${cat.label}
        <button class="more" data-open="${cat.id}">▼ 表示する（${all.length}品${sel ? `・${sel}品を選択中` : ''}）</button></h3></div>`);
      continue;
    }
    const visible = all.filter(i =>
      f ? i.name.includes(f) : (i.rarity <= maxLevel || state.sel.has(i.name)));
    if (!all.length || (!visible.length && f)) continue;

    const chips = visible.map(i => {
      const on = state.sel.has(i.name);
      const g = db.groupOf.get(i.name);
      const gOn = activeGroup(i.name);
      const implied = !on && gOn && have.has('G:' + gOn);
      const n = counts ? counts.get(i.name) : i.uses;
      const dim = !on && n === 0;
      const title = [
        `${i.uses}本のレシピで使用`,
        g ? `同義グループ: ${g}（${db.groups.get(g).members.join(' / ')}）${gOn ? '' : ' ※いまOFF'}` : '',
        implied ? '同義グループの別具材を選択済みなので、これも「ある」扱いです' : '',
      ].filter(Boolean).join('\n');
      return `<label class="chip r${i.rarity}${on ? ' on' : ''}${dim ? ' dim' : ''}${implied ? ' impl' : ''}" title="${esc(title)}">
        <input type="checkbox" data-ing="${esc(i.name)}" ${on ? 'checked' : ''}>${esc(i.name)}${gOn ? '<span class="g">≈</span>' : ''}<span class="n">${n}</span></label>`;
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
      if (cat.id === 'seas') {
        more = `<div class="panel-buttons"><button id="bulk-seas" class="ghost small"
          title="よく使う（rarity 1）調味料をまとめて選択します">よく使う調味料を全部☑</button></div>` + more;
      }
    }
    const note = counts ? '数字=追加した場合の件数' : '数字=使用レシピ数';
    const head = cat.id in ui.collapsed
      ? `<button class="more" data-close="${cat.id}">▲ 隠す</button>`
      : (cat.id === 'carb' ? `<span class="note">${note}</span>` : '');
    html.push(`<div class="cat"><h3>${cat.label}${head}</h3><div class="chips">${chips}</div>${more}</div>`);
  }
  $('#categories').innerHTML = html.join('');
  renderAdv();
}

// 上級者向け: 同義グループを個別にON/OFF（具材パネルの末尾に畳んで置く）
function renderAdv() {
  const rows = [...db.groups].map(([id, g]) => {
    const on = !state.synOff.has(id);
    const uses = g.members.filter(m => db.items.get(m)?.uses).length;
    return `<label class="adv-row${state.syn ? '' : ' dim'}">
      <input type="checkbox" data-group="${esc(id)}" ${on ? 'checked' : ''} ${state.syn ? '' : 'disabled'}>
      <span><b>${esc(id)}</b> <span class="adv-mem">${esc(g.members.join(' ／ '))}<span class="adv-n">（データに${uses}品）</span></span></span>
    </label>`;
  }).join('');
  $('#adv').innerHTML = `<details class="adv" ${ui.advOpen ? 'open' : ''}>
    <summary>詳細設定：同義グループを個別に選ぶ${state.synOff.size ? ` <span class="count">${db.groups.size - state.synOff.size}/${db.groups.size}</span>` : ''}</summary>
    <p class="adv-note">☑にしたグループは、中のどれか1つを持っていれば全部「ある」扱いになります。${state.syn ? '' : '<br>上の「同義グループ」がOFFのため、いまはどれも効いていません。'}</p>
    ${rows}
    <div class="panel-buttons"><button class="ghost small" id="adv-all">全部ON</button><button class="ghost small" id="adv-none">全部OFF</button></div>
  </details>`;
}

function ingChips(res) {
  const { r, have, missKeys } = res;
  const main = r.rows.filter(x => !x.option && !x.item.isSeas);
  return main.map(x => {
    const k = keyOf(x.base);
    let cls = '';
    if (state.mode === 'make') cls = missKeys.has(k) ? 'miss' : ([...state.must].some(n => keyOf(n) === k) ? 'hit' : (have.has(k) ? 'have' : ''));
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
    const alias = x.name !== x.base ? ` <span class="badge">→${esc(x.base)}</span>` : '';
    return `<tr><td>${esc(x.name)}${alias}</td><td>${esc(x.amount || '—')}</td><td>${st}</td></tr>`;
  };
  const sub = (label, rows) => rows.length
    ? `<tr class="sub"><td colspan="3">${label}</td></tr>${rows.map(row).join('')}` : '';
  const req = r.rows.filter(x => !x.option);
  const ing = req.filter(x => !x.item.isSeas);
  const seas = req.filter(x => x.item.isSeas);
  const opt = r.rows.filter(x => x.option);
  return `<table class="full">${ing.map(row).join('')}
    ${sub('調味料', seas)}
    ${sub('仕上げ・味変（任意）', opt)}</table>`;
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
      <a class="yt" href="${esc(r.url)}" target="_blank" rel="noopener">▶ YouTubeで作り方を見る</a>
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
  if (!wanted.length && !state.must.size) {
    summary.innerHTML = '';
    cards.innerHTML = `<div class="empty">上の具材パネルで、冷蔵庫にある食材を選んでください。<br>
      調味料は「よく使う調味料を全部☑」でまとめて選べます。<br>
      選んだあと、タグの☆を押すと「その具材を必ず使う」レシピだけに絞れます。</div>`;
    return;
  }
  const all = makeResults();
  const buckets = [0, 1, 2, 3].map(n => all.filter(x => x.missing.length === n).length);
  const res = all.filter(x => x.missing.length <= state.maxMissing);
  const mustNote = state.must.size
    ? `<span class="bucket">★ ${[...state.must].map(esc).join(' AND ')} を使う</span>` : '';
  // 内訳は押すと「不足を許す」を切り替える。表示に含まれている範囲を色で示す
  const labels = ['作れる', '不足1で', '不足2で', '不足3で'];
  const bar = buckets.map((n, i) =>
    `<button class="bucket bk${i <= state.maxMissing ? ' on' : ''}" data-max="${i}"
      title="${i === 0 ? '不足なしのレシピだけ表示' : `不足${i}つまで表示`}">${labels[i]} ${n} 件</button>`).join('');
  summary.innerHTML = `${mustNote}
    <span class="bucket">表示中 <strong>${res.length}</strong> 件</span>${bar}`;
  cards.innerHTML = res.length
    ? res.map(card).join('')
    : `<div class="empty">不足${state.maxMissing}つ以内で作れるレシピはありません。<br>
        「不足を許す」を増やすか、${state.must.size ? '★を減らして' : '具材を追加して'}みてください。</div>`;
}

// ============================================================
// 状態保持（URLクエリ + localStorage）
// ============================================================

function toParams() {
  const p = new URLSearchParams();
  p.set('m', state.mode);
  if (state.sel.size) p.set('i', [...state.sel].join(','));
  if (state.must.size) p.set('use', [...state.must].join(','));
  p.set('syn', state.syn ? '1' : '0');
  if (state.synOff.size) p.set('synoff', [...state.synOff].join(','));
  if (ui.advOpen) p.set('adv', '1');
  if (state.mode === 'make') {
    p.set('max', String(state.maxMissing));
    if (!state.ignoreSeas) p.set('seas', '1');
  }
  p.set('sort', state.sort);
  if (state.q) p.set('q', state.q);
  return p;
}

function fromParams(p) {
  if (p.has('m')) state.mode = p.get('m') === 'search' ? 'search' : 'make';
  if (p.has('i')) state.sel = new Set(p.get('i').split(',').filter(n => db.items.has(n)));
  state.must = new Set((p.get('use') ?? '').split(',').filter(n => state.sel.has(n)));
  if (p.has('syn')) state.syn = p.get('syn') !== '0';
  state.synOff = new Set((p.get('synoff') ?? '').split(',').filter(id => db.groups.has(id)));
  ui.advOpen = p.get('adv') === '1';
  if (p.has('max')) state.maxMissing = Math.min(3, Math.max(0, parseInt(p.get('max'), 10) || 0));
  state.ignoreSeas = p.get('seas') !== '1';
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
    if (e.target.checked) state.sel.add(n);
    else { state.sel.delete(n); state.must.delete(n); }
    render();
  });
  $('#adv').addEventListener('toggle', e => { ui.advOpen = e.target.open; save(); }, true);
  $('#adv').addEventListener('change', e => {
    const id = e.target.dataset.group;
    if (!id) return;
    e.target.checked ? state.synOff.delete(id) : state.synOff.add(id);
    render();
  });
  $('#adv').addEventListener('click', e => {
    if (e.target.id === 'adv-all') state.synOff.clear();
    else if (e.target.id === 'adv-none') state.synOff = new Set(db.groups.keys());
    else return;
    render();
  });

  $('#categories').addEventListener('click', e => {
    const b = e.target.closest('button.more');
    if (!b) return;
    if (b.dataset.open) ui.collapsed[b.dataset.open] = false;
    else if (b.dataset.close) { ui.collapsed[b.dataset.close] = true; ui.level[b.dataset.close] = 1; }
    else ui.level[b.dataset.cat] = Number(b.dataset.lv);
    renderResults();
  });
  $('#ing-filter').addEventListener('input', e => { ui.filter = e.target.value; renderResults(); });

  $('#summary').addEventListener('click', e => {
    const b = e.target.closest('[data-max]');
    if (b) { state.maxMissing = Number(b.dataset.max); render(); }
  });

  $('#selected').addEventListener('click', e => {
    const n = e.target.dataset.rm;
    if (n) { state.sel.delete(n); state.must.delete(n); render(); return; }
    const m = e.target.dataset.must;
    if (m) { state.must.has(m) ? state.must.delete(m) : state.must.add(m); render(); return; }
    const t = e.target.closest('[data-seastags]');
    if (t) { ui.seasTags = t.dataset.seastags === '1'; renderSelected(); }
  });
  $('#categories').addEventListener('click', e => {
    if (!e.target.closest('#bulk-seas')) return;
    for (const it of db.items.values()) if (it.inMaster && it.isSeas && it.rarity === 1) state.sel.add(it.name);
    ui.collapsed.seas = false;
    render();
    toast('rarity 1 の調味料を選択しました');
  });

  $('#controls').addEventListener('click', e => {
    if (e.target.id === 'clear') { state.sel.clear(); state.must.clear(); render(); return; }
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

  $('#build').textContent = BUILD;
  // Safari は強制リロードがしづらいので、日時付きURLで開き直してキャッシュを回避する
  $('#refresh').addEventListener('click', () => {
    const p = toParams();
    p.set('cb', Date.now().toString(36));
    location.replace(location.pathname + '?' + p.toString());
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
