'use strict';

const BUILD = '20261022-2254';   // release.sh が書き換える。データ取得のキャッシュ避けと版表示に使う

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
const ALWAYS_AVAILABLE = new Set(['水', 'お湯', '熱湯', '冷水', 'ぬるま湯', 'パスタの茹で汁', '茹で汁', 'ゆで汁', '氷']);

// マスタに無い具材の分類を名前から推す（具材パネルの置き場所と、調味料として数えるかに使う）
const GUESS = [
  ['seasoning', '', /茹で汁|ゆで汁|煮汁|つけ汁|吸いもの|吸い物|Cook ?Do|酢|醤油|しょうゆ|(?<!甘|梅)酒(?!盗)|塩(?!辛|鮭|昆布)|胡椒|コショウ|ペッパー|(?<!鶏)油(?!揚)|ソース|たれ|タレ|ケチャップ|マヨ|ごま|ゴマ|だし|出汁|スープ|粉(?!チーズ)|シロップ|みりん|味噌|みそ|ルー|スパイス|シナモン|花椒|唐辛子|からし|わさび|ハーブ|タイム|ドレッシング|ほりにし|いしる|鶏油|イースト|ぽん酢|ポン酢|調味|の素|つゆ|エキス|ペースト|ジャム|はちみつ|蜂蜜|砂糖|糖/],
  ['ingredient', 'carb', /麺|うどん|そば|蕎麦|パスタ|スパゲ|ラーメン|らーめん|ご飯|(?<!ス)ライス|(?<!フライ)パン|餅|ビーフン|ペンネ|マカロニ|焼そば|焼きそば|米/],
  ['ingredient', 'protein', /肉|豚|鶏|牛|ハラミ|カルビ|タン$|ロース|ベーコン|ハム|ウインナー|ウィンナー|ソーセージ|魚|鯛|アジ|イワシ|サバ|鯖|鮭|サーモン|マグロ|カツオ|鰹(?!節)|ブリ|エビ|えび|海老|イカ|タコ|貝|アサリ|しじみ|牡蠣|ホタテ|うなぎ|カニ|蟹|たらこ|明太|ネギトロ|刺身|卵|たまご|玉子/],
  ['ingredient', 'protein_s', /豆腐|厚揚|がんも|油揚|納豆|大豆|豆乳/],
  ['ingredient', 'veggies', /野菜|菜|ねぎ|ネギ|玉ねぎ|キャベツ|レタス|トマト|きゅうり|ナス|なす|じゃが|芋|いも|イモ|にんじん|人参|大根|ごぼう|れんこん|レンコン|蓮根|ゴーヤ|セロリ|パプリカ|ピーマン|ししとう|かいわれ|みょうが|オクラ|アスパラ|ブロッコリー|カリフラワー|コーン|とうもろこし|もやし|豆苗|きのこ|キノコ|茸|しめじ|えのき|まいたけ|舞茸|エリンギ|マッシュルーム|しいたけ|椎茸|なめこ|アボカド|かぼちゃ|ズッキーニ|絹さや|枝豆|ハーブ|ミント|パクチー|大葉|しそ|レモン|ゆず|柚子|すだち|カボス|ライム|バナナ|りんご|リンゴ|キウイ|いちご|梨|桃|みかん/],
];
// 「サッポロ一番塩らーめん」「至高の味噌ラーメン」のような麺の商品は、名前に塩や味噌があっても主食
const guessType = name => /ラーメン|らーめん|麺|うどん|そば|蕎麦|焼そば|焼きそば|パスタ|スパゲ/.test(name) && !/スープ|つゆ|タレ|たれ|ソース|の素|粉|汁/.test(name)
  ? ['ingredient', 'carb'] : (GUESS.find(([, , re]) => re.test(name)) ?? ['ingredient', '']).slice(0, 2);

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

// 料理の区分。料理名（【】や「」の中）を先に見て、決まらなければ材料で決める。
// 「ステーキ」「唐揚げ」「無限」は野菜にも肉にも付くので、語ではなく主な材料（肉・魚の量）で分ける
const COURSES = [
  { id: 'main', label: '主食', note: 'ご飯・麺・パン' },
  { id: 'dish', label: '主菜', note: '肉・魚・豆腐のおかず' },
  { id: 'side', label: '副菜', note: '野菜・卵の小鉢、サラダ、漬物' },
  { id: 'soup', label: '汁物', note: 'スープ・鍋' },
  { id: 'sweet', label: 'スイーツ', note: 'おやつ・飲み物' },
  { id: 'sauce', label: 'タレ', note: 'タレ・ソース・ふりかけ' },
  { id: 'multi', label: '複数品', note: '献立・まとめ回など、何品かまとめて作る回' },
];
const COURSE_LABEL = Object.fromEntries(COURSES.map(c => [c.id, c.label]));
const COURSE_RE = {
  sweet: /プリン|ケーキ|アイス(?!バイン)|クッキー|チョコ|ゼリー|ドーナツ|タルト|パフェ|スイーツ|大福|(?<![肉鶏豚魚])(団子|だんご)|お汁粉|汁粉|わらび餅|ブラウニー|マフィン|シャーベット|ジャム|スコーン|杏仁|ティラミス|シュークリーム|おやつ|デザート|お菓子|あんこ|ぜんざい|おしるこ|クレープ|マシュマロ|キャラメル|カステラ|ラスク|スムージー|シェイク|カクテル|ラテ|レモネード|ドリンク|ラッシー|梅酒|チューハイ|酎ハイ|ミルクティー|ホットケーキ|パンケーキ|モンブラン|かき氷|プディング|ムース|ババロア|羊羹|ようかん|きなこ餅|焼き芋|大学芋|スイートポテト|メロンパン|テリーヌ/,
  // 料理名の末尾がこれなら、料理ではなくタレ類
  sauce: /(タレ|ダレ|だれ|ドレッシング|ソース|ふりかけ|ディップ|マヨネーズ|タルタル|ラー油|ペースト)$/,
  // 麺の締めがあっても鍋・汁物を優先する語
  soupFirst: /(?<![回土])鍋(?!一つ|ひとつ|1つ|焼き)|水炊き|芋煮|マーラータン|麻辣湯|雑煮|おでん|シチュー|豚汁|味噌汁|みそ汁|ポタージュ|スンドゥブ|チゲ|ポトフ/,
  // 主食そのものを表す語（料理名にあれば材料を見ずに主食）
  main: /丼|どんぶり|チャーハン|炒飯|焼き?飯|[鶏肉豚牛鯛鮭鯖釜]飯|(?<!つまみ)めし|メシ|飯(?=$|[、。！!？?\s」】）)])|弁当|恵方巻|巻き寿司|手巻き|かゆ|ピラフ|オムライス|カレー(?!粉|炒め|風味|味|唐揚げ|鍋|煮|揚げ|焼き(?!カレー))|リゾット|雑炊|おじや|粥|おにぎり|おむすび|寿司|ずし|炊き込み|ご飯|ごはん|ライス(?!ペーパー)|パエリア|ビビンバ|ガパオ|ロコモコ|ハヤシ|茶漬け|お茶づけ|麺(?!つゆ)|うどん|そば(?!粉)|ソバ|蕎麦|そうめん|素麺|ソーメン|にゅうめん|ラーメン|らーめん|パスタ|スパゲ(?!ティサラダ)|焼きそば|焼そば|冷麺|冷やし中華|ちゃんぽん|フォー|ビーフン|マカロニ(?!サラダ)|ペンネ|トースト|サンド|(?<!フライ|ワン)パン(?!チ|ダ|ケ|粉|プキン)|バーガー|ホットドッグ|お好み焼き|たこ焼き|もんじゃ|キャベツ焼き|キンパ|オートミール|サッポロ一番|チキンラーメン|カップ麺|ちらし|ジャージャー|油そば|まぜそば|つけ麺|ジャンバラヤ|ニョッキ|きしめん|トッポギ/,
  // 主食のこともおかずのこともある語。材料にご飯・麺・パンがあるときだけ主食
  mainIfCarb: /ピザ|グラタン|ドリア|ラザニア|ペペロンチーノ|カルボナーラ|ナポリタン|ボロネーゼ|アラビアータ|ミートソース|ペペたま|フレンチトースト|担々|餅/,
  soup: /スープ(?!パスタ|カレー|春雨|餃子)|(?<!肉|果|煮|出|け|お)汁(?!なし|無し|だく|気|粉)|ミネストローネ|参鶏湯|サムゲタン|ボルシチ|チャウダー|けんちん|トムヤム|ブイヤベース|すいとん|ガンボ|クッパ|サンラータン|酸辣湯|吸い物|お吸い|肉吸い|梅流し|湯豆腐/,
  // 副菜らしい料理。ただし肉・魚が多ければ主菜
  side: /サラダ|ポテサラ|和え|ナムル|おひたし|お浸し|浸し|漬け|漬物|ピクルス|マリネ|きんぴら|酢の物|冷奴|冷やっこ|やっこ|なます|副菜|箸休め|おとも|お供|佃煮|常備菜|卵焼き|玉子焼き|だし巻き|茶碗蒸し|揚げ出し|ナス炒め|もやし炒め|キャベツ炒め|ピーマン炒め|おから|卯の花|ポテト|味玉|煮卵|切り干し|ラタトゥイユ|カルパッチョ/,
  // 肉・魚が主役と決まっている料理。材料に肉・魚・豆腐・卵が無ければ副菜にする
  dish: /生姜焼き|しょうが焼き|ハンバーグ|餃子|ギョーザ|シューマイ|シュウマイ|焼売|春巻|とんかつ|トンカツ|チキン|角煮|チャーシュー|焼豚|ローストビーフ|ナゲット|竜田|南蛮|ムニエル|麻婆|マーボー|回鍋肉|ホイコーロー|酢豚|青椒肉絲|チンジャオ|エビチリ|肉じゃが|すき焼き|しゃぶ|焼肉|焼き肉|焼き鳥|焼鳥|つくね|ミートボール|肉団子|ロールキャベツ|煮付け|煮つけ|塩焼き|蒲焼|かば焼き|ピカタ|ポークチャップ|トンテキ|よだれ鶏|油淋鶏|棒棒鶏|バンバンジー|サムギョプサル|プルコギ|タッカルビ|ヤンニョム|シュクメルリ|シュリンプ|コロッケ|メンチ|肉巻き|豚キムチ|チャンプルー|刺身|カツ(?!オ)/,
};
// タイトル本文の言い回しで主食などに引っぱられないよう、先に消しておく
const TITLE_NOISE = /(ラーメン|パスタ|そば|寿司|カレー|丼|うどん|鰻|焼肉)屋(さん)?|(主食|ご飯|米)(いらず|不要|要らず|専用)|(麺|めん|そうめん|鍋)つゆ|米騒動|(ご飯|ごはん|白米|米|飯|酒|ビール|そうめん)(が|も|なら|に|を)?[^、。！!？?\s【】「」]{0,8}?(進|すす|止|消|食|いけ|イケ|行け|合う|かけ|泥棒|無限|[0-9０-９一二三四五十百]+(杯|合|膳))/g;
const OTOMO = /(ご飯|ごはん|白米|米)の(おとも|お供|友)/g;
// 「ラーメン風スープ」「レバニラ風厚揚げ」の「〜風」は料理の種類ではない
const STYLE = /[^\s、。！!？?【】「」『』]*?風(?![味呂邪])/g;
const CARB_RE = /ヌードル|一平ちゃん|UFO|ペヤング|どん兵衛|きつね|たぬき|うまかっちゃん|サッポロ一番|麺|うどん|そば|パスタ|スパゲ|ラーメン|ご飯|ごはん|^米$|^生米$|パン(?!粉)|バゲット|餅|マカロニ|オートミール|ライス|フォー|ビーフン|ペンネ|ピザ生地|トルティーヤ/;
const MEAT_RE = /タン|ハラミ|カルビ|サーロイン|ビーフ|ポーク|ロース|切り落とし|燻製屋|シャウエッセン|マンドゥ|餃子|シーフード|刺身|サバ缶|鯖缶|コンビーフ|サラダチキン|肉|豚|鶏(?!ガラ)|牛(?!乳)|リブ|魚|鯛|アジ|イワシ|貝|アサリ|牡蠣|ホタテ|うなぎ|鴨|ラム|明太|たらこ|サバ|鯖|鮭|ブリ|マグロ|エビ|海老|イカ|タコ|カニ(?!カマ)|ホルモン|もつ|レバー|砂肝|手羽|ささみ/;
const SMALL_MEAT = /ベーコン|ハム|ウインナー|ソーセージ|しらす|生ハム|ちくわ|かまぼこ|カニカマ|鰹|明太|たらこ/;
const SWEET_ING_RE = /砂糖|ハチミツ|練乳|生クリーム|チョコ|ホットケーキミックス|グラニュー糖|ココア|アイス|ゼラチン/;
const SAVORY_RE = /醤油|味噌|塩|コンソメ|鶏ガラ|ほんだし|白だし|胡椒|にんにく|ソース|ポン酢|オイスター|マヨ|ケチャップ|めんつゆ|チーズ/;

// 分量からおおよその重さ（g）。量が書かれていない・少々などは 0
function weightOf(row) {
  const a = row.amount || '';
  if (!a || /少々|適量|お好み|適宜|少量/.test(a) && !/\d/.test(a)) return 0;
  const g = a.match(/(\d+(?:\.\d+)?)(?:〜\d+)?\s*g/);
  if (g) return +g[1];
  const n = a.match(/(\d+)(?:\/(\d+))?(?:と(\d+)\/(\d+))?\s*(合|丁|枚|パック|本|切れ|尾|杯|膳|玉|袋|束|個|缶|羽|匹|房)/);
  if (!n) return 30;
  const q = (+n[1] / (n[2] ? +n[2] : 1)) + (n[3] ? +n[3] / +n[4] : 0);
  const per = SMALL_MEAT.test(row.base) && /枚|本|個/.test(n[5]) ? 20 : { 合: 330, 丁: 300, 枚: 200, パック: 200, 杯: 150, 膳: 150 }[n[5]] ?? 100;
  return q * per;
}
function features(rows) {
  let carb = 0, rice = 0, meat = 0, tofu = 0, eggs = 0;
  const isMeat = x => (x.item.type2 === 'protein' && !/卵/.test(x.base)) || x.item.type2 === 'protein_f'
    || ((!x.item.inMaster || !x.item.type2) && MEAT_RE.test(x.base) && !/牛乳|鶏ガラ|ガラ|ブイヨン|だし|エキス|脂/.test(x.base));
  for (const x of rows) {
    if (x.option || x.item.isSeas) continue;
    const w = weightOf(x), t = x.item.type2;
    if ((t === 'carb' || CARB_RE.test(x.base)) && !/春雨|マロニー|パン粉|麺つゆ|めんつゆ/.test(x.base)) {
      // ご飯・米は茶碗1杯（約150g）に満たなければ添え物とみなす
      // 炊いたご飯は添えることが多いが、生の米から作るなら炊き込み・粥などの主食
      if (/ご飯|ごはん/.test(x.base)) { if (w >= 120) rice += w; } else if (w > 0) carb += w;
    } else if (isMeat(x)) {
      // 「牛肉 お好みで」のように量が無い肉は、主役として数える
      meat += w || (/少々|少し/.test(x.amount) ? 0 : 150);
    } else if (t === 'protein_s') tofu += w;
    else if (/^(卵|たまご|玉子)$/.test(x.base)) eggs += +(x.amount.match(/\d+/)?.[0] ?? { 一: 1, 二: 2, 三: 3, 四: 4 }[x.amount.match(/[一二三四]/)?.[0]] ?? 1);
  }
  return { carb, rice, meat, tofu, eggs };
}

// 何品かを1つの材料欄にまとめた回（献立・食べ比べ・コラボで作りまくる回など）。
// 材料からの推定（ご飯と麺が両方ある等）は外れが半分あったので使わない
const MULTI_TITLE = /献立|全[0-9０-９]+(レシピ|品)|[0-9０-９二三四五六七八九十]+(選|品)(?!種)|作りまくり|作りまくる|食べ比べ|王決定戦|選手権(?!で)|Cook ?Do|冷蔵庫を?(漁|あさ)|【[^】]*[＆&][^】]*】/;
const isMulti = title => MULTI_TITLE.test(title.replace(/#\S+/g, ''));

function courseOf(title, rows, multi) {
  if (multi) return 'multi';
  const f = features(rows);
  const clean = s => s.replace(OTOMO, 'おとも').replace(TITLE_NOISE, ' ').replace(STYLE, '');
  const names = [...title.matchAll(/【([^】]+)】|「([^」]+)」|『([^』]+)』/g)]
    .map(m => m[1] || m[2] || m[3])
    .filter(t => !/^※|コラボ|PR|PRESENTS|ガチです|材料|Supreme|[A-Za-z ]{8,}|再生|万|突破/.test(t))
    .map(clean);
  const plain = clean(title.replace(/#\S+/g, ' ').replace(/【[^】]*】|「[^」]*」|『[^』]*』/g, ' '));
  const tags = (title.match(/#\S+/g) || []).filter(t => !/リュウジ|料理|レシピ|shorts|簡単|節約|時短|PR|バズ/i.test(t)).join(' ');
  const hasCarb = f.carb + f.rice > 0 || !rows.length;
  const protein = f.meat + f.tofu + f.eggs * 50;
  const sideOrDish = () => f.meat >= 150 ? 'dish' : 'side';
  const meaty = f.meat >= 100 || f.eggs >= 3;

  for (const [text, isName] of [[names.join(' '), true], [plain, false], [tags, false]]) {
    if (!text.trim()) continue;
    if (isName && names.some(n => COURSE_RE.sauce.test(n.trim()))) return 'sauce';
    if (COURSE_RE.sweet.test(text)) return /フレンチトースト/.test(text) && !SWEET_ING_RE.test(rows.map(x => x.base).join(' ')) ? 'main' : 'sweet';
    if (COURSE_RE.soupFirst.test(text)) return 'soup';
    // 主食の語はそのまま信じる（「ラーメン屋」「ご飯が進む」などの言い回しは先に消してある）
    if (COURSE_RE.main.test(text)) return 'main';
    if (COURSE_RE.mainIfCarb.test(text) && hasCarb) return 'main';
    if (COURSE_RE.soup.test(text)) return 'soup';
    if (COURSE_RE.side.test(text)) return sideOrDish();
    if (COURSE_RE.dish.test(text)) return protein > 0 || !rows.length ? 'dish' : 'side';
  }
  // 材料で決める
  if (!rows.length) return null;
  // 麺・パンがあれば主食。ご飯は「唐揚げにご飯200g」のように添えることが多いので、肉が少ないときだけ主食
  if (f.carb >= 100) return 'main';
  if (f.rice && !meaty) return 'main';
  if (meaty) return 'dish';
  const all = rows.map(x => x.base).join(' ');
  if (SWEET_ING_RE.test(all) && !SAVORY_RE.test(all)) return 'sweet';
  if (f.carb > 0 || f.rice > 0) return 'main';
  return 'side';
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
  fav: false,         // ★を付けたレシピだけ
  hideSeen: false,    // 見たレシピを隠す
  few: false,         // 具材（調味料を除く）3品以下だけ
  series: '',         // タイトルのキーワード（至高・無限・レンジ など）
};

// お気に入りと「見た」は、この端末だけの印。URLには載せない
const mine = { fav: loadSet('fav'), seen: loadSet('seen') };
function loadSet(name) {
  try { return new Set(JSON.parse(localStorage.getItem(`${LS_KEY}-${name}`) || '[]')); } catch { return new Set(); }
}
function saveSet(name) {
  try { localStorage.setItem(`${LS_KEY}-${name}`, JSON.stringify([...mine[name]])); } catch { /* private mode 等 */ }
}
// 絞り込みに出すタイトルのキーワード（シリーズ名と調理器具）。件数の少ないものは出さない
const SERIES = ['至高', '究極', '無限', '虚無', '悪魔', 'やけくそ', '貧乏人', '痩せ', '鬼コスパ', '酒泥棒', '米泥棒', '合法', 'シン・', 'レンジ', '炊飯器', 'フライパン', 'トースター'];

const ui = { saved: {}, lastRes: [], filtersOpen: false, limit: SITE.pageSize, level: {}, filter: '', advOpen: false, collapsed: { seas: true }, seasTags: false, units: new Map() };  // 調味料は最初は畳む

async function load() {
  const get = p => fetch(p).then(r => {
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  });
  // courses.json は目視で確かめた区分（videoId -> 区分）。views.json は再生数。どちらも無くても動く
  let [recipes, ingredients, synonyms, courses, views] = await Promise.all([
    get(`${SITE.data}recipes.json?v=${BUILD}`), get(`${SITE.data}ingredients.json?v=${BUILD}`),
    get(`${SITE.data}synonyms.json?v=${BUILD}`),
    get(`${SITE.data}courses.json?v=${BUILD}`).catch(() => ({})),
    get(`${SITE.data}views.json?v=${BUILD}`).catch(() => ({})),
  ]);
  db.hasViews = Object.keys(views).length > 0;

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
        const [type1, type2] = guessType(base);
        item = { name: base, type1, type2, rarity: 3, inMaster: false, uses: 0 };
        db.items.set(base, item);
      }
      if (!seen.has(base)) { item.uses++; seen.add(base); }
      rows.push({ name: g.name, base, amount: g.amount, option: g.option, item });
    }
    return {
      id: r.videoId, title: r.title, url: r.url, published: r.published,
      thumbnail: r.thumbnail, hasRecipe: r.hasRecipe, isShort: !!r.isShort, rows, views: views[r.videoId] ?? -1,
      checked: courses[r.videoId],
      multi: !!r.multi || courses[r.videoId] === 'multi' || isMulti(r.title),
      bases: new Set(rows.map(x => x.base)),
    };
  });
  // 区分と具材数（調味料を除く）は、マスタの分類が決まってから数える
  for (const it of db.items.values()) it.isSeas = it.type1 === 'seasoning';
  db.recipes.forEach(r => {
    r.course = r.checked ?? courseOf(r.title, r.rows, r.multi);
    r.nIng = r.rows.filter(x => !x.item.isSeas).length;
  });

  db.byId = new Map(db.recipes.map(r => [r.id, r]));
  db.series = SERIES.map(w => [w, db.recipes.filter(r => r.title.includes(w)).length]).filter(([, n]) => n >= 8);
  db.groupUses = new Map([...db.groups].map(([id, g]) =>
    [id, db.recipes.filter(r => g.members.some(m => r.bases.has(m))).length]));

  for (const it of db.items.values()) {
    it.isSeas = it.type1 === 'seasoning';
    // マスタに無い具材も、名前から分類できたものは同じカテゴリに並べる（分からないものだけ「マスタ外」）
    it.cat = it.inMaster || it.type2 || it.type1 === 'seasoning' ? CATEGORIES.find(c => c.id !== 'extra' && c.test(it)).id : 'extra';
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
  (!state.q || r.title.toLowerCase().includes(state.q.toLowerCase())) &&
  (!state.fav || mine.fav.has(r.id)) && (!state.hideSeen || !mine.seen.has(r.id)) &&
  (!state.few || r.nIng <= 3) && (!state.series || r.title.includes(state.series));
// 並び順に共通のもの
const byNew = (a, b) => b.r.published.localeCompare(a.r.published);
const byViews = (a, b) => b.r.views - a.r.views || byNew(a, b);

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
    new: byNew, popular: byViews,
    count: (a, b) => a.r.nIng - b.r.nIng || byNew(a, b),
    countDesc: (a, b) => b.r.nIng - a.r.nIng || byNew(a, b),
  }[state.sort] ?? byNew;
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
    // 選んだ食材（調味料を除く）をいくつ使うか
    const use = new Set(r.rows.filter(x => !x.item.isSeas && have.has(keyOf(x.base))).map(x => keyOf(x.base))).size;
    out.push({ r, have, missing, missKeys, use });
  }
  const cmp = {
    missing: (a, b) => a.missing.length - b.missing.length || b.use - a.use || a.r.nIng - b.r.nIng,
    use: (a, b) => b.use - a.use || a.missing.length - b.missing.length || a.r.nIng - b.r.nIng,
    count: (a, b) => a.r.nIng - b.r.nIng || a.missing.length - b.missing.length,
    countDesc: (a, b) => b.r.nIng - a.r.nIng || a.missing.length - b.missing.length,
    new: byNew, popular: byViews,
  }[state.sort] ?? ((a, b) => a.missing.length - b.missing.length);
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
  const pop = db.hasViews ? [['popular', '人気順（再生数）']] : [];
  const cnt = [['count', '具材が少ない順'], ['countDesc', '具材が多い順']];
  const sortOpts = state.mode === 'make'
    ? [['missing', '不足が少ない順'], ['use', '選んだ食材を多く使う順'], ['new', '新しい順'], ...pop, ...cnt]
    : [['new', '新しい順'], ...pop, ...cnt];
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
    <label>並び順
      <select id="sort">${sortOpts.map(([v, l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </label>
    ${state.sel.size ? `<button id="clear" class="ghost small">選択をクリア（${state.sel.size}品）</button>` : ''}
    ${filtersHtml()}`;
}

// 「絞り込み」の中身。お気に入り・見た・具材数・キーワード・ショート
function filtersHtml() {
  const on = [state.fav, state.hideSeen, state.few, !!state.series, SITE.shorts && !state.shorts].filter(Boolean).length;
  const chk = (id, v, label, title = '') => `<label${title ? ` title="${title}"` : ''}><input type="checkbox" id="${id}" ${v ? 'checked' : ''}> ${label}</label>`;
  return `<details class="filters" id="filters" ${ui.filtersOpen || on ? 'open' : ''}>
    <summary>絞り込み${on ? ` <span class="count">${on}</span>` : ''}</summary>
    <div class="filters-body">
      ${chk('f-fav', state.fav, `★お気に入りだけ（${mine.fav.size}）`)}
      ${chk('f-seen', state.hideSeen, `見たものを隠す（${mine.seen.size}）`, 'YouTubeを開いたレシピに「見た」の印が付きます')}
      ${chk('f-few', state.few, '具材3品以下', '調味料を除いた具材の数')}
      ${SITE.shorts ? chk('shorts', state.shorts, 'ショートも含める', '1分前後の縦型動画も結果に含めます') : ''}
      <label>キーワード <select id="f-series"><option value="">指定なし</option>${db.series.map(([w, n]) =>
        `<option value="${esc(w)}" ${state.series === w ? 'selected' : ''}>${esc(w)}（${n}）</option>`).join('')}</select></label>
    </div>
  </details>`;
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
  const bar = $('#courses');
  bar.innerHTML = btn('all', 'すべて') + COURSES
    .filter(c => n[c.id] || state.course === c.id || !['sauce', 'multi'].includes(c.id)).map(c => btn(c.id, c.label)).join('');
  // 選んでいる区分のボタンが見えるよう、ボタン列だけを横に動かす（ページは動かさない）
  const on = bar.querySelector('.on');
  if (on && (on.offsetLeft < bar.scrollLeft || on.offsetLeft + on.offsetWidth > bar.scrollLeft + bar.clientWidth))
    bar.scrollLeft = on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2;
  return res;
}
// 料理名や「絞り込み」で0件になっているときの案内
function filterHint() {
  const f = [state.q && `料理名「${esc(state.q)}」`, state.fav && '★お気に入りだけ', state.hideSeen && '見たものを隠す',
    state.few && '具材3品以下', state.series && `キーワード「${esc(state.series)}」`].filter(Boolean);
  return f.length ? `絞り込み（${f.join('・')}）を外してみてください。` : '';
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

const favButton = id => mine.fav.has(id)
  ? `<button class="fav on" data-fav="${esc(id)}" aria-pressed="true" title="お気に入りから外す">★</button>`
  : `<button class="fav" data-fav="${esc(id)}" aria-pressed="false" title="お気に入りに入れる">☆</button>`;
const fmtViews = v => v >= 1e8 ? `${+(v / 1e8).toFixed(1)}億` : v >= 1e4 ? `${Math.round(v / 1e4)}万` : String(v);

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
  return `<article class="card" data-id="${esc(r.id)}">
    <a class="thumb" href="${esc(r.url)}" target="_blank" rel="noopener"><img src="${esc(r.thumbnail)}" alt="" loading="lazy"></a>
    <div>
      <h2><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></h2>
      <div class="meta">${mine.seen.has(r.id) ? '<span class="seen">見た</span>' : ''}<span>${r.published}</span>${r.views >= 0 ? `<span>${fmtViews(r.views)}回再生</span>` : ''}${r.course ? `<span class="course-tag">${COURSE_LABEL[r.course]}</span>` : ''}<span>具材 ${r.nIng}品</span>
        ${r.hasRecipe ? '' : '<span class="badge">説明文にレシピなし（手作業補完）</span>'}
        ${r.multi ? '<span class="badge">複数の料理の材料をまとめたもの</span>' : ''}</div>
      ${status}
      ${r.rows.length ? `<div class="ings">${ingChips(res)}${seasCount ? `<span class="ing">＋調味料 ${seasCount}品</span>` : ''}</div>
      <details><summary>材料と分量をすべて見る</summary>${fullTable(res)}</details>` : '<div class="meta">材料データなし（動画でご確認ください）</div>'}
      <div class="card-actions">
        <a class="yt" href="${esc(r.url)}" target="_blank" rel="noopener">▶ <span class="tl">YouTubeで</span>作り方を見る</a>
        ${r.rows.length ? (state.list.includes(r.id)
          ? `<button class="addlist on" data-list="${esc(r.id)}">✓ 買い物リストに入れた</button>`
          : `<button class="addlist" data-list="${esc(r.id)}">＋ 買い物リスト</button>`) : ''}
        ${favButton(r.id)}
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
  ui.lastRes = res;
  return res.slice(0, ui.limit).map(card).join('') + moreButton();
}
function moreButton() {
  const rest = ui.lastRes.length - ui.limit;
  return rest > 0 ? `<button id="more-cards" class="more-cards">▼ もっと見る（残り ${rest} 件）</button>` : '';
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
      : state.course !== 'all' && ui.courseCounts.all ? courseEmpty()
      : `<div class="empty">この条件のレシピはありません。<br>${filterHint() || '具材を外すか、同義グループをONにしてみてください。'}</div>`;
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
    // 区分の中に不足が多いレシピならあるときは「不足を許す」、区分に1件も無いときは区分の案内を出す
    : state.course !== 'all' && !all.length && found.length ? courseEmpty()
    : `<div class="empty">不足${state.maxMissing}つ以内で作れるレシピはありません。<br>
        ${filterHint() || `「不足を許す」を増やすか、${state.must.size ? '★を減らして' : '具材を追加して'}みてください。`}</div>`;
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
  if (state.mode === 'list' && state.list.length) {
    p.set('list', state.list.join(','));
    if (state.buyOn.size) p.set('bon', [...state.buyOn].join(','));
    if (state.buyOff.size) p.set('boff', [...state.buyOff].join(','));
  }
  if (state.fav) p.set('fav', '1');
  if (state.hideSeen) p.set('hs', '1');
  if (state.few) p.set('few', '1');
  if (state.series) p.set('kw', state.series);
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
  state.fav = p.get('fav') === '1';
  state.hideSeen = p.get('hs') === '1';
  state.few = p.get('few') === '1';
  state.series = SERIES.includes(p.get('kw')) ? p.get('kw') : '';
  state.q = p.get('q') ?? '';
  state.course = COURSE_LABEL[p.get('c')] ? p.get('c') : 'all';
}

function save() {
  const p = toParams();
  history.replaceState(null, '', '?' + p.toString());
  try {
    localStorage.setItem(LS_KEY, p.toString());
    localStorage.setItem(`${LS_KEY}-list`, JSON.stringify({ list: state.list, bon: [...state.buyOn], boff: [...state.buyOff] }));
  } catch { /* private mode 等 */ }
}

function restore() {
  // 買い物リストはこの端末に保存したものを使う
  try {
    const l = JSON.parse(localStorage.getItem(`${LS_KEY}-list`) || 'null');
    if (l) setList(l.list, l.bon, l.boff);
  } catch { /* ignore */ }
  const url = new URLSearchParams(location.search);
  if ([...url.keys()].length) {
    fromParams(url);
    // 共有された買い物リストのURL。自分のリストがあれば、置き換えてよいか聞く
    if (url.has('list')) {
      const shared = url.get('list').split(',');
      const same = shared.join() === state.list.join();
      if (!same && (!state.list.length || confirm('共有された買い物リストで、いまの買い物リストを置き換えますか？')))
        setList(shared, (url.get('bon') ?? '').split(','), (url.get('boff') ?? '').split(','));
    }
    return;
  }
  try {
    const s = new URLSearchParams(localStorage.getItem(LS_KEY) || '');
    s.delete('c');   // 区分の絞り込みは、開き直したら「すべて」から
    fromParams(s);
  } catch { /* ignore */ }
}
function setList(list = [], bon = [], boff = []) {
  state.list = [...new Set(list)].filter(id => db.byId.has(id));
  state.buyOn = new Set(bon.filter(Boolean));
  state.buyOff = new Set(boff.filter(Boolean));
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
    if (!b || b.dataset.mode === state.mode) return;
    ui.saved[state.mode] = { limit: ui.limit, y: scrollY };
    state.mode = b.dataset.mode;
    render();
    const back = ui.saved[state.mode];
    if (back) {
      if (back.limit > ui.limit) { ui.limit = back.limit; renderResults(); }
      scrollTo(0, back.y);
    }
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
  // 長い一覧を下まで見たときの「上へ戻る」
  const top = $('#to-top');
  addEventListener('scroll', () => { top.hidden = scrollY < 1200; }, { passive: true });
  top.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
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
  $('#controls').addEventListener('toggle', e => { if (e.target.id === 'filters') ui.filtersOpen = e.target.open; }, true);
  $('#controls').addEventListener('change', e => {
    if (e.target.id === 'sort') state.sort = e.target.value;
    else if (e.target.id === 'ignore-seas') state.ignoreSeas = e.target.checked;
    else if (e.target.id === 'shorts') state.shorts = e.target.checked;
    else if (e.target.id === 'f-fav') state.fav = e.target.checked;
    else if (e.target.id === 'f-seen') state.hideSeen = e.target.checked;
    else if (e.target.id === 'f-few') state.few = e.target.checked;
    else if (e.target.id === 'f-series') state.series = e.target.value;
    else return;
    render();
  });

  $('#cards').addEventListener('click', async e => {
    const t = e.target;
    // 開いている「材料と分量」を閉じないよう、描き直さずに後ろへ足す
    if (t.id === 'more-cards') {
      const from = ui.limit;
      ui.limit += SITE.pageSize;
      t.insertAdjacentHTML('beforebegin', ui.lastRes.slice(from, ui.limit).map(card).join(''));
      t.outerHTML = moreButton();
      return;
    }
    const fav = t.closest('[data-fav]');
    if (fav) {
      const id = fav.dataset.fav;
      const on = !mine.fav.has(id);
      on ? mine.fav.add(id) : mine.fav.delete(id);
      saveSet('fav');
      fav.outerHTML = favButton(id);
      toast(on ? 'お気に入りに入れました（絞り込み →「★お気に入りだけ」で一覧）' : 'お気に入りから外しました');
      return;
    }
    // YouTube を開いたら「見た」の印を付ける（リンクの動作はそのまま）
    const yt = t.closest('a[href]');
    const art = t.closest('article[data-id]');
    if (yt && art && !mine.seen.has(art.dataset.id)) {
      mine.seen.add(art.dataset.id);
      saveSet('seen');
      art.querySelector('.meta')?.insertAdjacentHTML('afterbegin', '<span class="seen">見た</span>');
    }
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
