'use strict';

const BUILD = '20261022-1850';   // release.sh が書き換える。データ取得のキャッシュ避けと版表示に使う

// ページごとの設定。全動画版（all/index.html）は window.SITE で上書きする
const SITE = Object.assign({
  data: 'data/',      // データ3点の置き場所
  key: '',            // localStorage のキーの接尾辞（版ごとに状態を分ける）
  hideEmpty: false,   // 材料データの無い動画を出さない
  shorts: false,      // 「ショートも含める」の切り替えを出す（isShort があるデータ用）
  pageSize: Infinity, // 一度に描くカードの数
}, window.SITE || {});

// ============================================================
// モック側の設定（データには焼き込まれていない判断）
// ============================================================

// 誰でも常に持っているもの。不足にも具材パネルにも出さない
const ALWAYS_AVAILABLE = new Set(['水', 'お湯', '熱湯', '冷水', 'ぬるま湯', 'パスタの茹で汁', '茹で汁']);

// 「Aがあれば作れる」もの（別物なので synonyms.json の表記統一には入れない）
// 同じ物の別表記は data/synonyms.json の notationVariants に置く
const DERIVED = {
  '卵黄': '卵', '卵白': '卵', 'ゆで卵': '卵', '大根おろし': '大根', '大根の皮': '大根',
  'おろし生姜': '生姜', '梅肉': '梅干し',
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

const LS_KEY = 'recipe-db-state-v1' + SITE.key;

// 料理の区分（主食・主菜・副菜・汁物・スイーツ）。料理名（【】や「」の中）を先に見て、
// 当たらなければタイトル全体、それでも無ければ材料で決める
const COURSES = [
  { id: 'main', label: '主食', note: 'ご飯・麺・パン' },
  { id: 'dish', label: '主菜', note: '肉・魚のおかず' },
  { id: 'side', label: '副菜', note: '野菜・卵・豆腐' },
  { id: 'soup', label: '汁物', note: 'スープ・鍋' },
  { id: 'sweet', label: 'スイーツ', note: 'おやつ・飲み物' },
];
const COURSE_LABEL = Object.fromEntries(COURSES.map(c => [c.id, c.label]));
const COURSE_RE = {
  sweet: /プリン|ケーキ|アイス(?!バイン)|クッキー|チョコ|ゼリー|ドーナツ|タルト|パフェ|スイーツ|大福|(?<![肉鶏豚魚])(団子|だんご)|お汁粉|汁粉|フレンチトースト|わらび餅|ブラウニー|マフィン|シャーベット|ジャム|スコーン|杏仁|ティラミス|シュークリーム|おやつ|デザート|お菓子|あんこ|ぜんざい|おしるこ|クレープ|マシュマロ|キャラメル|カステラ|ラスク|スムージー|シェイク|カクテル|ラテ|レモネード|ドリンク|梅酒|チューハイ|酎ハイ|ミルクティー|ホットケーキ|パンケーキ|モンブラン|チーズケーキ|かき氷|プディング|ムース|ババロア|羊羹|ようかん|きなこ餅|焼き芋|大学芋|スイートポテト/,
  main: /丼|どんぶり|チャーハン|炒飯|焼き?飯|ピラフ|オムライス|カレー(?!粉|炒め|風味|味|風|唐揚げ|鍋|煮|揚げ|焼き(?!カレー))|リゾット|雑炊|おじや|粥|おにぎり|寿司|ずし|炊き込み|混ぜご飯|まぜご飯|卵かけご飯|TKG|ライス|ドリア|パエリア|ビビンバ|ガパオ|ロコモコ|ハヤシ|茶漬け|天津飯|肉飯|麺(?!つゆ)|うどん|そば(?!粉)|ソバ|蕎麦|そうめん|素麺|ソーメン|ラーメン|らーめん|パスタ|スパゲ(?!ティサラダ)|ペペロンチーノ|カルボナーラ|ナポリタン|ボロネーゼ|アラビアータ|ミートソース|ペペたま|焼きそば|焼そば|冷麺|ちゃんぽん|担々|フォー|ビーフン|マカロニ(?!サラダ)|グラタン|ペンネ|ラザニア|トースト|サンド|ピザ|(?<!フライ|ワン)パン(?!チ|ダ|ケ|粉)|バーガー|ホットドッグ|お好み焼き|たこ焼き|もんじゃ|キンパ|オートミール|サッポロ一番|マルちゃん|チキンラーメン|カップ麺|ちらし|おむすび|ジャージャー|油そば|まぜそば|つけ麺|和そば|ニョッキ/,
  soup: /スープ(?!パスタ|カレー)|(?<!肉|果|煮|出)汁(?!なし|無し|だく|気)|ポタージュ|(?<![回土])鍋(?!一つ|ひとつ|1つ)|シチュー|ポトフ|ミネストローネ|チゲ|おでん|参鶏湯|サムゲタン|ボルシチ|チャウダー|けんちん|トムヤム|ブイヤベース|すいとん|雑煮|豚汁|味噌汁|みそ汁|ガンボ|クッパ|サンラータン|酸辣湯/,
  side: /サラダ|ポテサラ|和え|マカロニサラダ|スパサラ|ナムル|おひたし|お浸し|浸し|浅漬け|漬物|お漬け物|ピクルス|マリネ|きんぴら|酢の物|冷奴|冷やっこ|やっこ|なます|副菜|箸休め|ご飯のおとも|ご飯のお供|ごはんのおとも|ふりかけ|佃煮|常備菜|卵焼き|玉子焼き|だし巻き|茶碗蒸し|白和え|塩昆布キャベツ|煮びたし|焼きなす|焼き茄子|揚げ出し|オイル漬け|ディップ|ナス炒め|もやし炒め|キャベツ炒め|ピーマン炒め|おから|ポテト|フライドポテト|ジャーマンポテト|無限(?!に|大)/,
  dish: /ステーキ|唐揚|から揚げ|からあげ|カツ(?!オ)|とんかつ|ハンバーグ|照り焼き|照焼|生姜焼き|しょうが焼き|餃子|ギョーザ|シューマイ|焼売|春巻|天ぷら|とり天|フライ(?!パン)|ナゲット|角煮|チャーシュー|ローストビーフ|ローストチキン|チキン|竜田|南蛮|ソテー|ムニエル|麻婆|マーボー|回鍋肉|ホイコーロー|酢豚|青椒肉絲|チンジャオ|エビチリ|肉じゃが|すき焼き|しゃぶ|焼肉|焼き肉|焼き鳥|焼鳥|つくね|ミートボール|肉団子|ロールキャベツ|煮付け|煮つけ|塩焼き|蒲焼|かば焼き|ピカタ|ポークチャップ|トンテキ|よだれ鶏|油淋鶏|ユーリンチー|棒棒鶏|バンバンジー|サムギョプサル|プルコギ|タッカルビ|ヤンニョム|シュクメルリ|シュリンプ|コロッケ|メンチ|肉巻き|豚キムチ|チャンプルー|手羽|鶏むね|鶏胸|むね肉|胸肉|もも肉|豚バラ|豚こま|ひき肉|挽き肉|ひき肉|鶏肉|豚肉|牛肉|刺身|サーモン|鮭|サバ|鯖|ブリ|エビ|海老|イカ|タコ|ささみ|砂肝|レバー|もつ|ホルモン|ハム|ソーセージ|ウインナー|ベーコン/,
};
const COURSE_ORDER = ['sweet', 'main', 'soup', 'side', 'dish'];
const CARB_RE = /麺|うどん|そば|パスタ|スパゲ|ラーメン|ご飯|^米$|パン(?!粉)|バゲット|餅|マカロニ|オートミール|ライス|フォー|ビーフン|ペンネ/;
const MEAT_RE = /肉|豚|鶏|牛|リブ|魚|鯛|アジ|イワシ|貝|アサリ|牡蠣|ホタテ|うなぎ|鴨|ラム|明太|たらこ/;
const SWEET_ING_RE = /砂糖|ハチミツ|練乳|生クリーム|チョコ|ホットケーキミックス|グラニュー糖|ココア|アイス|ゼラチン/;
const SAVORY_RE = /醤油|味噌|塩|コンソメ|鶏ガラ|ほんだし|白だし|胡椒|にんにく|ソース|ポン酢|オイスター|マヨ|ケチャップ|めんつゆ|チーズ/;

function courseOf(title, rows) {
  const names = [...title.matchAll(/【([^】]+)】|「([^」]+)」|『([^』]+)』/g)]
    .map(m => m[1] || m[2] || m[3]).filter(t => !/^※|コラボ|PR|PRESENTS|ガチです|材料|Supreme|[A-Za-z ]{8,}/.test(t));
  const plain = title.replace(/#\S+/g, ' ');
  const tags = (title.match(/#\S+/g) || []).filter(t => !/リュウジ|料理|レシピ|shorts|簡単|節約|時短|PR/i.test(t)).join(' ');
  for (const text of [names.join(' '), plain, tags]) {
    if (!text.trim()) continue;
    for (const c of COURSE_ORDER) if (COURSE_RE[c].test(text)) return c;
  }
  // 材料で決める
  const main = rows.filter(x => !x.option && !x.item.isSeas);
  // 「ご飯 お好みで」のように添えるだけの主食は数えない
  if (main.some(x => (x.item.type2 === 'carb' || CARB_RE.test(x.base)) && !/適量|お好み|適宜/.test(x.amount))) return 'main';
  if (main.some(x => x.item.inMaster
    ? (x.item.type2 === 'protein' && !/卵/.test(x.base)) || x.item.type2 === 'protein_f'
    : MEAT_RE.test(x.base))) return 'dish';
  const all = rows.map(x => x.base).join(' ');
  if (SWEET_ING_RE.test(all) && !SAVORY_RE.test(all)) return 'sweet';
  return rows.length ? 'side' : null;
}

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
  course: 'all',      // 結果の区分（'all' か COURSES の id）
  sort: 'missing',
  q: '',
  shorts: true,       // ショート動画も含める（SITE.shorts のときだけ効く）
  list: [],           // 買い物リストに入れたレシピの videoId（入れた順）
  buyOn: new Set(),   // 買い物リストで、既定ではチェックしない具材を手でチェックしたもの
  buyOff: new Set(),  // 既定ではチェックする具材を手で外したもの
};

const ui = { limit: SITE.pageSize, level: {}, filter: '', advOpen: false, collapsed: { seas: true }, seasTags: false, units: new Map() };  // 調味料は最初は畳む

async function load() {
  const get = p => fetch(p).then(r => {
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  });
  let [recipes, ingredients, synonyms] = await Promise.all([
    get(`${SITE.data}recipes.json?v=${BUILD}`), get(`${SITE.data}ingredients.json?v=${BUILD}`),
    get(`${SITE.data}synonyms.json?v=${BUILD}`),
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

  if (SITE.hideEmpty) recipes = recipes.filter(r => r.ingredients.length);
  recipes = recipes.filter(r => !r.dup);   // 本編と材料が同じショートなどは本編だけ出す
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
      thumbnail: r.thumbnail, hasRecipe: r.hasRecipe, isShort: !!r.isShort, multi: !!r.multi, rows,
      bases: new Set(rows.map(x => x.base)),
    };
  });
  // 区分と具材数（調味料を除く）は、マスタの分類が決まってから数える
  for (const it of db.items.values()) it.isSeas = it.type1 === 'seasoning';
  db.recipes.forEach(r => {
    r.course = courseOf(r.title, r.rows);
    r.nIng = r.rows.filter(x => !x.item.isSeas).length;
  });

  db.byId = new Map(db.recipes.map(r => [r.id, r]));
  db.groupUses = new Map([...db.groups].map(([id, g]) =>
    [id, db.recipes.filter(r => g.members.some(m => r.bases.has(m))).length]));

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
const titleHit = r => (!SITE.shorts || state.shorts || !r.isShort) &&
  (!state.q || r.title.toLowerCase().includes(state.q.toLowerCase()));

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
    count: (a, b) => a.r.nIng - b.r.nIng,
    countDesc: (a, b) => b.r.nIng - a.r.nIng,
  }[state.sort];
  return out.sort(cmp);
}

// Case 3: 手持ちで作れる / あと少しで作れるレシピ
function makeResults() {
  const have = haveKeys();
  const out = [];
  for (const r of db.recipes) {
    // 複数の料理の材料がまとめて入っている回は、1品として作れる判定ができないので出さない
    if (r.multi || !titleHit(r)) continue;
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
    missing: (a, b) => a.missing.length - b.missing.length || a.r.nIng - b.r.nIng,
    count: (a, b) => a.r.nIng - b.r.nIng || a.missing.length - b.missing.length,
    countDesc: (a, b) => b.r.nIng - a.r.nIng || a.missing.length - b.missing.length,
  }[state.sort];
  return out.sort(cmp);
}

// ============================================================
// 描画
// ============================================================

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render() {
  ui.limit = SITE.pageSize;   // 条件が変わったら先頭から描き直す
  document.body.dataset.mode = state.mode;
  $('#list-count').textContent = state.list.length ? `（${state.list.length}）` : '';
  document.querySelectorAll('.tabs button').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.mode === state.mode)));
  $('#syn').checked = state.syn;
  renderControls();
  renderSelected();
  renderResults();
  save();
}

function renderControls() {
  if (state.mode === 'list') return;   // 買い物リストでは並び順などを使わない
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
    $('#q').addEventListener('input', e => { state.q = e.target.value; ui.limit = SITE.pageSize; renderResults(); save(); });
  }
  $('#q').value = state.q;
  $('#ctl-dyn').innerHTML = `
    ${makeCtl}
    ${SITE.shorts ? `<label title="1分前後の縦型動画も結果に含めます">
      <input type="checkbox" id="shorts" ${state.shorts ? 'checked' : ''}> ショートも含める</label>` : ''}
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
      ${esc(activeGroup(n) ?? n)}<button data-rm="${esc(n)}" aria-label="${esc(n)}を外す">×</button></span>`;
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

// 具材パネルの表示単位。同義グループがONなら、そのメンバーは1つのボタンにまとめる
function panelUnits() {
  const out = [];
  const done = new Set();
  for (const it of db.items.values()) {
    const g = activeGroup(it.name);
    if (!g) {
      out.push({ key: it.name, label: it.name, cat: it.cat, rarity: it.rarity, uses: it.uses, members: [it.name] });
      continue;
    }
    if (done.has(g)) continue;
    done.add(g);
    const members = db.groups.get(g).members.filter(m => db.items.has(m)).map(m => db.items.get(m));
    const main = members.reduce((a, b) => (b.uses > a.uses ? b : a));   // いちばん使われているメンバー
    const rep = db.items.get(db.groups.get(g).representative) ?? main;  // 分類は代表に合わせる
    out.push({
      key: 'G:' + g, label: g, cat: rep.cat, group: g, members: members.map(m => m.name),
      rarity: Math.min(...members.map(m => m.rarity)),
      uses: db.groupUses.get(g),          // グループ全体での使用本数
      pick: main.name,                    // 選んだときに実際に入れる具材
    });
  }
  ui.units = new Map(out.map(u => [u.key, u]));
  return out;
}

function renderPanel(counts) {
  const f = ui.filter.trim();
  const units = panelUnits();
  const html = [];
  for (const cat of CATEGORIES) {
    const all = units.filter(u => u.cat === cat.id)
      .sort((a, b) => a.rarity - b.rarity || b.uses - a.uses);
    const maxLevel = ui.level[cat.id] ?? 1;
    const isOn = u => u.members.some(n => state.sel.has(n));
    // 畳んでいるカテゴリは見出しと開くボタンだけ（具材名で絞り込み中は中身を出す）
    if (ui.collapsed[cat.id] && !f) {
      const sel = all.filter(isOn).length;
      html.push(`<div class="cat"><h3>${cat.label}
        <button class="more" data-open="${cat.id}">▼ 表示する（${all.length}品${sel ? `・${sel}品を選択中` : ''}）</button></h3></div>`);
      continue;
    }
    const hit = u => u.label.includes(f) || u.members.some(n => n.includes(f));
    const visible = all.filter(u => f ? hit(u) : (u.rarity <= maxLevel || isOn(u)));
    if (!all.length || (!visible.length && f)) continue;

    const chips = visible.map(u => {
      const on = isOn(u);
      const n = counts ? counts.get(u.key) : u.uses;
      const dim = !on && n === 0;
      const title = u.group
        ? `同義グループ「${u.group}」: ${u.members.join(' / ')}\nまとめて${u.uses}本のレシピで使用（詳細設定で個別に分けられます）`
        : `${u.uses}本のレシピで使用`;
      return `<label class="chip r${u.rarity}${on ? ' on' : ''}${dim ? ' dim' : ''}" title="${esc(title)}">
        <input type="checkbox" data-unit="${esc(u.key)}" ${on ? 'checked' : ''}>${esc(u.label)}${u.group ? '<span class="g">≈</span>' : ''}<span class="n">${n}</span></label>`;
    }).join('');

    let more = '';
    if (!f) {
      const hidden2 = all.filter(u => u.rarity === 2).length;
      const hidden3 = all.filter(u => u.rarity === 3).length;
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
    let cls = '';
    if (missKeys && missKeys.has(k) && !st) { st = '✗ 不足'; cls = ' class="miss"'; }
    const alias = x.name !== x.base ? ` <span class="badge">→${esc(x.base)}</span>` : '';
    return `<tr${cls}><td>${esc(x.name)}${alias}</td><td>${esc(x.amount || '—')}</td><td>${st}</td></tr>`;
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

// 区分（主食・主菜…）の切り替え。件数つきのボタンを並べ、渡された結果をそのまま返す
function renderCourses(res) {
  const n = { all: res.length };
  for (const x of res) if (x.r.course) n[x.r.course] = (n[x.r.course] || 0) + 1;
  ui.courseCounts = n;
  const btn = (id, label) => `<button data-course="${id}" class="${state.course === id ? 'on' : ''}${n[id] ? '' : ' zero'}"
    aria-pressed="${state.course === id}">${label}<span class="n">${n[id] || 0}</span></button>`;
  $('#courses').innerHTML = btn('all', 'すべて') + COURSES.map(c => btn(c.id, c.label)).join('');
  $('#courses .on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return res;
}
const byCourse = res => state.course === 'all' ? res : res.filter(x => x.r.course === state.course);
const courseEmpty = () => `<div class="empty">「${COURSE_LABEL[state.course]}」に当てはまるレシピはありません。<br>
  上の「すべて」か、ほかの区分を選んでください。</div>`;

// 左右にスワイプしたら隣の区分へ（件数0の区分は飛ばす）
function stepCourse(dir) {
  const ids = ['all', ...COURSES.map(c => c.id)].filter(id => id === state.course || ui.courseCounts?.[id]);
  const next = ids[ids.indexOf(state.course) + dir];
  if (!next) return false;
  setCourse(next, dir);
  return true;
}
function setCourse(id, dir = 0) {
  state.course = id;
  ui.limit = SITE.pageSize;
  renderResults();
  save();
  const cards = $('#cards');
  if (dir) { cards.classList.remove('slide-l', 'slide-r'); void cards.offsetWidth; cards.classList.add(dir > 0 ? 'slide-l' : 'slide-r'); }
  // 一覧の途中までスクロールしていたら、区分のボタンが見える位置まで戻す
  const bar = $('#courses');
  if (bar.getBoundingClientRect().top < 0 || cards.getBoundingClientRect().top < 0) bar.scrollIntoView({ block: 'start' });
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
      <div class="meta"><span>${r.published}</span>${r.course ? `<span class="course-tag">${COURSE_LABEL[r.course]}</span>` : ''}<span>具材 ${r.nIng}品</span>
        ${r.hasRecipe ? '' : '<span class="badge">説明文にレシピなし（手作業補完）</span>'}
        ${r.multi ? '<span class="badge">複数の料理の材料をまとめたもの</span>' : ''}</div>
      ${status}
      ${r.rows.length ? `<div class="ings">${ingChips(res)}${seasCount ? `<span class="ing">＋調味料 ${seasCount}品</span>` : ''}</div>
      <details><summary>材料と分量をすべて見る</summary>${fullTable(res)}</details>` : '<div class="meta">材料データなし（動画でご確認ください）</div>'}
      <div class="card-actions">
        <a class="yt" href="${esc(r.url)}" target="_blank" rel="noopener">▶ YouTubeで作り方を見る</a>
        ${r.rows.length ? (state.list.includes(r.id)
          ? `<button class="addlist on" data-list="${esc(r.id)}">✓ 買い物リストに入れた</button>`
          : `<button class="addlist" data-list="${esc(r.id)}">＋ 買い物リスト</button>`) : ''}
      </div>
    </div>
  </article>`;
}

// ============================================================
// 買い物リスト（企画書 §4 Case 1）
// ============================================================

// 分数（a/b）。分量の合算に使う
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const frac = (n, d = 1) => { const g = gcd(n, d) || 1; return [n / g, d / g]; };
const fadd = ([a, b], [c, d]) => frac(a * d + c * b, b * d);
// 「1」「1/2」「1と1/2」を分数に。小数は10倍して扱う
function parseNum(t) {
  let m = t.match(/^(\d+)と(\d+)\/(\d+)$/);
  if (m) return frac(+m[1] * +m[3] + +m[2], +m[3]);
  m = t.match(/^(\d+)\/(\d+)$/);
  if (m) return frac(+m[1], +m[2]);
  m = t.match(/^(\d+)(?:\.(\d))?$/);
  if (m) return m[2] ? frac(+m[1] * 10 + +m[2], 10) : frac(+m[1]);
  return null;
}
function fmtNum([n, d], unit) {
  if (d === 1) return String(n);
  if (/^(g|cc|L|cm)$/.test(unit)) return String(Math.round(n / d * 10) / 10);
  const w = Math.floor(n / d), r = n % d;
  return w ? `${w}と${r}/${d}` : `${r}/${d}`;
}
const UNITS = 'g|cc|L|cm|個|本|枚|片|袋|玉|丁|株|束|缶|パック|切れ|尾|つまみ|振り|回し|かけ|粒|合';
const AMT_RE = new RegExp(`^(大さじ|小さじ)?(\\d+(?:と\\d+/\\d+|/\\d+|\\.\\d)?)(${UNITS})?$`);
// 分量を [{unit, q}] に。数で表せないもの（適量・範囲など）は null
function parseAmount(a) {
  const main = (a || '').replace(/（.*）$/, '').replace(/^約/, '');
  const terms = main.split(/と(?=大さじ|小さじ)/);
  const out = [];
  for (const t of terms) {
    const m = t.match(AMT_RE);
    if (!m || (!m[1] && !m[3])) return null;
    const q = parseNum(m[2]);
    if (!q) return null;
    if (m[3] === 'L') out.push({ unit: 'cc', spoon: false, q: fadd(q, [0, 1]).map((v, i) => (i ? v : v * 1000)) });
    else out.push({ unit: m[1] || m[3], spoon: !!m[1], q });
  }
  return out;
}
// 同じ単位どうしを足し、残りは並べる
function sumAmounts(list) {
  const sums = new Map();
  const texts = [];
  for (const a of list) {
    if (!a) continue;
    const p = parseAmount(a);
    if (!p) { if (!texts.includes(a)) texts.push(a); continue; }
    for (const { unit, spoon, q } of p) {
      const cur = sums.get(unit);
      sums.set(unit, { spoon, q: cur ? fadd(cur.q, q) : q });
    }
  }
  const parts = [...sums].map(([u, { spoon, q }]) => spoon ? `${u}${fmtNum(q, u)}` : `${fmtNum(q, u)}${u}`);
  return [...parts, ...texts].join('＋');
}

// 動画タイトルから料理名らしい部分（【】の中）を取り出す
// 「※公式コラボ」「PR」のような飾りの【】は除き、最後の【】を使う。無ければタイトルの頭を短く
function dishName(r) {
  const tags = [...r.title.matchAll(/【([^】]+)】/g)].map(m => m[1])
    .filter(t => !/^※|コラボ|PR|PRESENTS|ガチです/.test(t));
  if (tags.length) return tags.at(-1);
  const t = r.title.replace(/#\S+/g, '').trim();
  return t.length > 16 ? t.slice(0, 16) + '…' : t;
}

// 選んだレシピの材料を具材ごとにまとめる
function shoppingItems() {
  const have = haveKeys();
  const items = new Map();   // base -> {base, kind, rows:[{r, amount}]}
  for (const id of state.list) {
    const r = db.byId.get(id);
    if (!r) continue;
    for (const x of r.rows) {
      const kind = x.option ? 'opt' : (x.item.isSeas ? 'seas' : 'main');
      let it = items.get(x.base);
      if (!it) items.set(x.base, it = { base: x.base, kind, rows: [] });
      // 1つでも必須で使うレシピがあれば必須側に置く
      if (kind === 'main' || (kind === 'seas' && it.kind === 'opt')) it.kind = kind;
      it.rows.push({ r, amount: x.amount, name: x.name });
    }
  }
  for (const it of items.values()) {
    it.owned = have.has(keyOf(it.base));
    it.total = sumAmounts(it.rows.map(x => x.amount));
    const def = it.kind === 'main' && !it.owned;   // 既定でチェックするのは、持っていない必須の食材だけ
    it.checked = def ? !state.buyOff.has(it.base) : state.buyOn.has(it.base);
  }
  return [...items.values()];
}

function renderList() {
  $('#summary').innerHTML = '';
  const recipes = state.list.map(id => db.byId.get(id)).filter(Boolean);
  if (!recipes.length) {
    $('#cards').innerHTML = `<div class="empty">買い物リストは空です。<br>
      レシピのカードにある「＋ 買い物リスト」を押すと、ここに材料がまとまります。</div>`;
    return;
  }
  const items = shoppingItems();
  const li = it => `<li class="${it.checked ? 'on' : ''}">
    <label><input type="checkbox" data-buy="${esc(it.base)}" ${it.checked ? 'checked' : ''}>
      <span class="nm">${esc(it.base)}${it.owned ? '<span class="badge">持っている</span>' : ''}</span>
      <span class="amt">${esc(it.total || '—')}</span></label>
    ${recipes.length > 1 ? `<div class="from">${it.rows.map(x =>
      `${esc(dishName(x.r))}${x.amount ? ` ${esc(x.amount)}` : ''}`).join(' ／ ')}</div>` : ''}
  </li>`;
  const group = (kind, label, open) => {
    const list = items.filter(it => it.kind === kind);
    if (!list.length) return '';
    const n = list.filter(it => it.checked).length;
    const body = `<ul class="shop-list">${list.map(li).join('')}</ul>`;
    return kind === 'main' ? body : `<details class="shop-sub" ${open ? 'open' : ''}>
      <summary>${label}（${list.length}品${n ? `・${n}品をチェック` : ''}）</summary>${body}</details>`;
  };
  const checked = items.filter(it => it.checked).length;
  $('#cards').innerHTML = `<div class="shop">
    <section class="shop-box">
      <h3>買うもの <span class="count">${checked}品</span></h3>
      <p class="shop-note">チェックした具材をコピーできます。持っている具材と調味料は、最初はチェックを外しています。</p>
      ${group('main')}
      ${group('seas', '調味料（家になければチェック）', ui.shopSeas)}
      ${group('opt', '仕上げ・味変（任意）', ui.shopOpt)}
      <div class="shop-buttons">
        <button id="copy-list" class="primary" ${checked ? '' : 'disabled'}>チェックした${checked}品をコピー</button>
        <button id="clear-list" class="ghost small">リストを空にする</button>
      </div>
    </section>
    <section class="shop-box">
      <h3>選んだレシピ <span class="count">${recipes.length}件</span></h3>
      <ul class="shop-recipes">${recipes.map(r => `<li>
        <a href="${esc(r.url)}" target="_blank" rel="noopener"><img src="${esc(r.thumbnail)}" alt="" loading="lazy"></a>
        <a class="t" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
        <button class="ghost small" data-unlist="${esc(r.id)}" aria-label="リストから外す">外す</button></li>`).join('')}</ul>
    </section>
  </div>`;
}

function listText() {
  const items = shoppingItems().filter(it => it.checked);
  return `買い物リスト（${items.length}品）\n` + items.map(it => `・${it.base}${it.total ? ` ${it.total}` : ''}`).join('\n');
}

// 件数が多いと描画が重いので、SITE.pageSize 件ずつ出す
function cardList(res) {
  const rest = res.length - ui.limit;
  return res.slice(0, ui.limit).map(card).join('') + (rest > 0
    ? `<button id="more-cards" class="more-cards">▼ もっと見る（残り ${rest} 件）</button>` : '');
}

function renderResults() {
  const cards = $('#cards');
  const summary = $('#summary');
  if (state.mode === 'list') { renderList(); return; }

  if (state.mode === 'search') {
    const res = byCourse(renderCourses(searchResults()));
    // 各具材を追加したら何件になるか（0件の具材は薄く表示）
    const counts = new Map();
    for (const u of panelUnits()) {
      const k = keyOf(u.pick ?? u.key);
      counts.set(u.key, res.filter(x => x.keys.has(k)).length);
    }
    renderPanel(counts);
    const cond = state.sel.size ? [...state.sel].map(esc).join(' AND ') : '条件なし（全件）';
    summary.innerHTML = `<strong>${res.length}</strong> 件 <span class="bucket">${cond}</span>`;
    cards.innerHTML = res.length
      ? cardList(res)
      : state.course !== 'all' ? courseEmpty()
      : `<div class="empty">この組み合わせのレシピはありません。<br>具材を外すか、同義グループをONにしてみてください。</div>`;
    return;
  }

  renderPanel(null);
  const wanted = [...state.sel].filter(n => !db.items.get(n).isSeas);
  if (!wanted.length && !state.must.size) {
    summary.innerHTML = '';
    $('#courses').innerHTML = '';
    cards.innerHTML = `<div class="empty">上の具材パネルで、冷蔵庫にある食材を選んでください。<br>
      調味料は「よく使う調味料を全部☑」でまとめて選べます。<br>
      選んだあと、タグの☆を押すと「その具材を必ず使う」レシピだけに絞れます。</div>`;
    return;
  }
  const found = makeResults();
  const all = byCourse(found);
  const buckets = [0, 1, 2, 3].map(n => all.filter(x => x.missing.length === n).length);
  // 区分ごとの件数は「不足を許す」の範囲で数える
  const res = byCourse(renderCourses(found.filter(x => x.missing.length <= state.maxMissing)));
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
    ? cardList(res)
    : state.course !== 'all' && all.length ? courseEmpty()
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
  if (state.mode !== 'search') {
    p.set('max', String(state.maxMissing));
    if (!state.ignoreSeas) p.set('seas', '1');
  }
  p.set('sort', state.sort);
  if (SITE.shorts && !state.shorts) p.set('short', '0');
  if (state.list.length) p.set('list', state.list.join(','));
  if (state.buyOn.size) p.set('bon', [...state.buyOn].join(','));
  if (state.buyOff.size) p.set('boff', [...state.buyOff].join(','));
  if (state.q) p.set('q', state.q);
  if (state.course !== 'all') p.set('c', state.course);
  return p;
}

function fromParams(p) {
  if (p.has('m')) state.mode = ['search', 'list'].includes(p.get('m')) ? p.get('m') : 'make';
  if (p.has('i')) state.sel = new Set(p.get('i').split(',').filter(n => db.items.has(n)));
  state.must = new Set((p.get('use') ?? '').split(',').filter(n => state.sel.has(n)));
  if (p.has('syn')) state.syn = p.get('syn') !== '0';
  state.synOff = new Set((p.get('synoff') ?? '').split(',').filter(id => db.groups.has(id)));
  ui.advOpen = p.get('adv') === '1';
  if (p.has('max')) state.maxMissing = Math.min(3, Math.max(0, parseInt(p.get('max'), 10) || 0));
  state.ignoreSeas = p.get('seas') !== '1';
  if (p.has('sort')) state.sort = p.get('sort');
  state.shorts = p.get('short') !== '0';
  state.list = [...new Set((p.get('list') ?? '').split(','))].filter(id => db.byId.has(id));
  state.buyOn = new Set((p.get('bon') ?? '').split(',').filter(Boolean));
  state.buyOff = new Set((p.get('boff') ?? '').split(',').filter(Boolean));
  state.q = p.get('q') ?? '';
  state.course = COURSE_LABEL[p.get('c')] ? p.get('c') : 'all';
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
    const u = ui.units?.get(e.target.dataset.unit);
    if (!u) return;
    if (e.target.checked) state.sel.add(u.pick ?? u.key);
    else for (const m of u.members) { state.sel.delete(m); state.must.delete(m); }
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
  // 区分のボタン列はヘッダーのすぐ下に貼り付ける（ヘッダーの高さはスマホで折り返すと変わる）
  const topbar = $('.topbar');
  new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', topbar.offsetHeight + 'px')).observe(topbar);
  $('#courses').addEventListener('click', e => {
    const b = e.target.closest('[data-course]');
    if (b && b.dataset.course !== state.course) setCourse(b.dataset.course);
  });
  // 結果の上で横にスワイプすると区分を切り替える。縦のスクロールや区分ボタン列の横スクロールは邪魔しない
  let touch = null;
  $('#cards').addEventListener('touchstart', e => {
    touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
  }, { passive: true });
  $('#cards').addEventListener('touchend', e => {
    if (!touch || state.mode === 'list') return;
    const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
    const quick = Date.now() - touch.t < 600;
    touch = null;
    if (quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8 && stepCourse(dx < 0 ? 1 : -1))
      toast(`${state.course === 'all' ? 'すべて' : COURSE_LABEL[state.course]}（${ui.courseCounts[state.course]} 件）`);
  }, { passive: true });

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
    else if (e.target.id === 'shorts') state.shorts = e.target.checked;
    else return;
    render();
  });

  $('#cards').addEventListener('click', async e => {
    const t = e.target;
    if (t.id === 'more-cards') { ui.limit += SITE.pageSize; renderResults(); return; }
    const add = t.closest('[data-list]');
    if (add) {
      const id = add.dataset.list;
      const on = !state.list.includes(id);
      state.list = on ? [...state.list, id] : state.list.filter(x => x !== id);
      // 開いている詳細やスクロール位置を崩さないよう、そのカードのボタンだけ差し替える
      add.outerHTML = on
        ? `<button class="addlist on" data-list="${esc(id)}">✓ 買い物リストに入れた</button>`
        : `<button class="addlist" data-list="${esc(id)}">＋ 買い物リスト</button>`;
      $('#list-count').textContent = state.list.length ? `（${state.list.length}）` : '';
      save();
      toast(on ? `買い物リストに追加しました（${state.list.length}件）` : '買い物リストから外しました');
      return;
    }
    const un = t.closest('[data-unlist]');
    if (un) { state.list = state.list.filter(x => x !== un.dataset.unlist); render(); return; }
    if (t.id === 'clear-list') {
      if (!confirm('買い物リストを空にしますか？')) return;
      state.list = []; state.buyOn.clear(); state.buyOff.clear(); render(); return;
    }
    if (t.id === 'copy-list') {
      try { await navigator.clipboard.writeText(listText()); toast('買い物リストをコピーしました'); }
      catch { toast('コピーできませんでした'); }
    }
  });
  $('#cards').addEventListener('change', e => {
    const b = e.target.dataset.buy;
    if (!b) return;
    const it = shoppingItems().find(x => x.base === b);
    const def = it.kind === 'main' && !it.owned;
    if (def) e.target.checked ? state.buyOff.delete(b) : state.buyOff.add(b);
    else e.target.checked ? state.buyOn.add(b) : state.buyOn.delete(b);
    renderList(); save();
  });
  $('#cards').addEventListener('toggle', e => {
    if (e.target.matches?.('.shop-sub')) {
      const seas = e.target.querySelector('summary').textContent.startsWith('調味料');
      ui[seas ? 'shopSeas' : 'shopOpt'] = e.target.open;
    }
  }, true);

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

// Safari は HTML を古いまま持ち続けることがあるので、開いたときに最新の版番号を確かめる。
// 新しい版が出ていれば、キャッシュ避けを付けて1回だけ開き直す（ループしないよう版ごとに1回）
async function checkUpdate() {
  try {
    const html = await (await fetch(`${location.pathname}?cb=${Date.now().toString(36)}`, { cache: 'no-store' })).text();
    const latest = html.match(/app\.js\?v=([0-9-]+)/)?.[1];
    if (!latest || latest === BUILD || sessionStorage.getItem('reloaded-for') === latest) return;
    sessionStorage.setItem('reloaded-for', latest);
    const p = toParams();
    p.set('cb', Date.now().toString(36));
    location.replace(location.pathname + '?' + p.toString());
  } catch { /* オフライン等。古い版のまま使う */ }
}

load()
  .then(() => { restore(); bind(); render(); checkUpdate(); })
  .catch(err => {
    document.querySelector('#cards').innerHTML =
      `<div class="empty">データを読み込めませんでした（${esc(err.message)}）。<br>
       file:// では fetch できないので、<code>python3 -m http.server</code> で開いてください。</div>`;
    console.error(err);
  });
