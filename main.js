/*
 * ============================================================
 *  카카오톡 단톡방 확률 RPG 강화게임 봇  (메신저봇R 용)
 * ============================================================
 *  - 이 파일 하나만 메신저봇R 에 붙여넣으면 바로 동작합니다.
 *  - 메신저봇R 신버전(BotManager) / 구버전(response) 모두 지원.
 *  - 데이터는 파일에 저장되어 봇을 껐다 켜도 유지됩니다(방마다 독립).
 *
 *  명령어: 도움말 · 강화 · 출석 · 내정보 · 싸움 [상대]
 *          · 랭킹 · 강화로그 · 오늘의호구 · 강화확률
 * ============================================================
 */

/* ------------------------------------------------------------------
 * 1. 설정
 * ------------------------------------------------------------------ */
var CONFIG = {
  botName: '강화게임봇',

  // 명령어 접두사. '' 이면 접두사 없이 "강화" 만 입력해도 반응.
  // 오작동이 잦으면 '!' 나 '/' 로 바꾸세요. 예) prefix: '/'
  prefix: '',

  // 지정한 방에서만 반응. 빈 배열([])이면 모든 방에서 반응.
  allowedRooms: [],

  // 하루에 걸 수 있는 싸움 횟수
  dailyFights: 5,

  // 하루에 할 수 있는 사냥 횟수
  dailyHunts: 20,

  // 강화 최대 단계(초월 만렙)
  maxLevel: 25,

  // 골드 설정
  startGold: 1000,    // 신규 플레이어 시작 골드
  attendGold: 1000,   // 출석 시 지급 골드(하루 1회)
  stealPct: 0.2,      // 싸움 승리 시 상대에게서 뺏는 골드 비율(0.2 = 20%)
  protectPrice: 3000, // 파괴방지권 1개 가격(파괴 1회를 막아줌)

  fightBreakChance: 0.15,  // 싸움 패배 시 무기가 1단계 하락할 확률
  dropProtectChance: 0.03, // 사냥 시 파괴방지권이 드랍될 확률
  dropGoldChance: 0.07,    // 사냥 시 골드뭉치가 드랍될 확률

  // 데이터 저장 파일 경로(메신저봇R FileStream). 저장 안 되면 메모리에만 유지됨.
  dbPath: '/sdcard/msgbot/game_rpg.json',
};

/* ------------------------------------------------------------------
 * 2. 유틸
 * ------------------------------------------------------------------ */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function chance(p) {
  return Math.random() < p;
}
function pct(p) {
  return Math.round(p * 100) + '%';
}
function today() {
  var d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
// 골드 표기(천단위 콤마)
function g(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + 'G';
}

/* ------------------------------------------------------------------
 * 3. 데이터 저장 (FileStream, 없으면 메모리 폴백)
 *    DB[방] = { players: { 이름: {...} }, log: [ "...", ... ] }
 * ------------------------------------------------------------------ */
function loadDB() {
  try {
    if (typeof FileStream !== 'undefined') {
      var raw = FileStream.read(CONFIG.dbPath);
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {}
  return {};
}
function saveDB() {
  try {
    if (typeof FileStream !== 'undefined') {
      FileStream.write(CONFIG.dbPath, JSON.stringify(DB));
    }
  } catch (e) {}
}
var DB = loadDB();

// 방 데이터 가져오기(없으면 생성)
function getRoom(room) {
  if (!DB[room] || !DB[room].players) DB[room] = { players: {}, log: [] };
  if (!DB[room].log) DB[room].log = [];
  return DB[room];
}

// 플레이어 레코드 가져오기(없으면 생성)
function getPlayer(room, name) {
  var R = getRoom(room);
  if (!R.players[name]) {
    R.players[name] = {
      level: 0,          // 현재 강화 단계
      best: 0,           // 최고 기록
      breaks: 0,         // 누적 파괴 횟수
      wins: 0,           // 싸움 승
      losses: 0,         // 싸움 패
      gold: CONFIG.startGold,
      protects: 0,       // 보유한 파괴방지권 개수
      fightDay: '',      // 마지막 싸운 날짜
      fightsUsed: 0,     // 오늘 사용한 싸움 횟수
      huntDay: '',       // 마지막 사냥 날짜
      huntsUsed: 0,      // 오늘 사용한 사냥 횟수
      attendDay: '',     // 마지막 출석 날짜
      destroyDay: '',    // 마지막으로 파괴된 날짜
      destroysToday: 0   // 오늘 파괴된 횟수(오늘의 호구용)
    };
  }
  return R.players[name];
}

// 강화 로그 추가(방별, 최근 20개 유지)
function addLog(room, text) {
  var R = getRoom(room);
  R.log.push(text);
  if (R.log.length > 20) R.log.shift();
}

// 오늘 남은 싸움 횟수(날짜 바뀌면 리셋)
function fightsLeft(p) {
  if (p.fightDay !== today()) return CONFIG.dailyFights;
  return Math.max(0, CONFIG.dailyFights - p.fightsUsed);
}
// 오늘 남은 사냥 횟수
function huntsLeft(p) {
  if (p.huntDay !== today()) return CONFIG.dailyHunts;
  return Math.max(0, CONFIG.dailyHunts - p.huntsUsed);
}

/* ------------------------------------------------------------------
 * 4. 무기 등급 (5단계: 일반 → 희귀 → 에픽 → 전설 → 초월, 만렙 +25)
 * ------------------------------------------------------------------ */
var GRADES = [
  { min: 21, name: '초월', emoji: '🌈' }, // 21~25
  { min: 16, name: '전설', emoji: '🟠' }, // 16~20
  { min: 11, name: '에픽', emoji: '🟣' }, // 11~15
  { min: 6,  name: '희귀', emoji: '🔵' }, // 6~10
  { min: 0,  name: '일반', emoji: '⚪' }  // 0~5
];
function grade(level) {
  for (var i = 0; i < GRADES.length; i++) {
    if (level >= GRADES[i].min) return GRADES[i];
  }
  return GRADES[GRADES.length - 1];
}
function weaponName(level) {
  var gr = grade(level);
  return '+' + level + ' ' + gr.emoji + ' ' + gr.name;
}

/* ------------------------------------------------------------------
 * 5. 강화 확률 & 비용
 *    단계가 높을수록 성공률↓, 파괴 확률↑, 비용↑
 * ------------------------------------------------------------------ */
function odds(level) {
  var success, destroy;
  if (level <= 4)        { success = 0.95; destroy = 0.00; } // 일반
  else if (level <= 9)   { success = 0.85; destroy = 0.02; } // 희귀
  else if (level <= 14)  { success = 0.72; destroy = 0.04; } // 에픽
  else if (level <= 19)  { success = 0.58; destroy = 0.06; } // 전설
  else                   { success = 0.445; destroy = 0.09; } // 초월 (+25 만렙 평균 ~827회)
  return { success: success, destroy: destroy, fail: 1 - success - destroy };
}
// 강화 비용: 단계가 높을수록 비싸진다
function enhanceCost(level) {
  return 20 + level * 10;
}

/* ------------------------------------------------------------------
 *  몬스터 (사냥용) — hp: 체력, gpp: 데미지당 골드(난이도)
 *  강한 몬스터일수록 gpp(골드효율)가 높지만 체력이 많아 다 깎기 어렵다.
 * ------------------------------------------------------------------ */
var MONSTERS = [
  { name: '🐀 들쥐',   hp: 50,   gpp: 1.0 },
  { name: '🐗 멧돼지', hp: 120,  gpp: 1.3 },
  { name: '🐺 늑대',   hp: 200,  gpp: 1.6 },
  { name: '🐻 곰',     hp: 350,  gpp: 2.0 },
  { name: '🐉 드래곤', hp: 600,  gpp: 3.0 },
  { name: '👹 마왕',   hp: 1000, gpp: 4.0 }
];
// 무기 강화 수치에 따른 사냥 데미지
function huntDamage(level) {
  return randInt(10, 30) + level * 8;
}

/* ------------------------------------------------------------------
 * 6. 게임 명령어
 *    ctx = { room, sender, args, text }
 * ------------------------------------------------------------------ */

// --- 강화 ---
var cmdEnhance = {
  names: ['강화', 'ㄱㅎ', 'enhance'],
  help: '강화 — 무기 강화 (골드 소모, 실패 시 깨질 수도!)',
  run: function (ctx) {
    var p = getPlayer(ctx.room, ctx.sender);
    if (p.level >= CONFIG.maxLevel) {
      return ctx.sender + ' 🌈 이미 만렙! +' + CONFIG.maxLevel + ' 초월 — 이 방의 최강자입니다!';
    }
    var cost = enhanceCost(p.level);
    if (p.gold < cost) {
      return ctx.sender + ' 💸 골드 부족!\n필요 ' + g(cost) + ' / 보유 ' + g(p.gold) +
        '\n"출석"으로 매일 골드를 받거나 "싸움"으로 뺏어오세요.';
    }
    p.gold -= cost;

    var before = p.level;
    var o = odds(before);
    var r = Math.random();
    var msg, logLine;

    if (r < o.success) {
      p.level++;
      if (p.level > p.best) p.best = p.level;
      msg = '✅ 강화 성공!  +' + before + ' → +' + p.level + '\n' + weaponName(p.level);
      logLine = '✅ ' + ctx.sender + '  +' + before + '→+' + p.level;
    } else if (r < o.success + o.destroy) {
      if (p.protects > 0) {
        // 파괴방지권 발동 — 파괴를 막고 현재 단계 유지
        p.protects--;
        msg = '🛡️ 파괴 방지 발동! +' + before + ' 무기를 지켰습니다.\n(남은 방지권 ' + p.protects + '개)';
        logLine = '🛡️ ' + ctx.sender + '  +' + before + ' 파괴방지';
      } else {
        p.level = 0;
        p.breaks++;
        if (p.destroyDay !== today()) { p.destroyDay = today(); p.destroysToday = 0; }
        p.destroysToday++;
        msg = '💥 파괴!!  +' + before + ' 무기가 산산조각 났습니다...\n처음부터 다시! (현재 +0)';
        logLine = '💥 ' + ctx.sender + '  +' + before + '→0 파괴';
      }
    } else {
      if (p.level >= 10) {
        p.level--;
        msg = '❌ 강화 실패...  +' + before + ' → +' + p.level + ' (하락)';
        logLine = '❌ ' + ctx.sender + '  +' + before + '→+' + p.level;
      } else {
        msg = '❌ 강화 실패...  +' + before + ' 유지';
        logLine = '❌ ' + ctx.sender + '  +' + before + ' 유지';
      }
    }
    addLog(ctx.room, logLine);
    saveDB();
    return ctx.sender + '  ' + msg + '\n(-' + g(cost) + ', 잔액 ' + g(p.gold) + ')';
  }
};

// --- 출석 (골드 획득) ---
var cmdAttend = {
  names: ['출석', 'ㅊㅅ', 'daily'],
  help: '출석 — 하루 1회 골드 받기 (+' + CONFIG.attendGold + 'G)',
  run: function (ctx) {
    var p = getPlayer(ctx.room, ctx.sender);
    if (p.attendDay === today()) {
      return ctx.sender + ' 오늘은 이미 출석했어요! (보유 ' + g(p.gold) + ')';
    }
    p.attendDay = today();
    p.gold += CONFIG.attendGold;
    saveDB();
    return '📅 ' + ctx.sender + ' 출석 완료! +' + g(CONFIG.attendGold) +
      '\n현재 보유: ' + g(p.gold);
  }
};

// --- 파괴방지권 구매 ---
var cmdProtect = {
  names: ['방지권', '파괴방지권', 'protect'],
  help: '방지권 [개수] — 파괴 1회를 막는 방지권 구매 (개당 ' + CONFIG.protectPrice + 'G)',
  run: function (ctx) {
    var p = getPlayer(ctx.room, ctx.sender);
    var qty = parseInt(ctx.args[0], 10);
    if (isNaN(qty) || qty < 1) qty = 1;
    var total = CONFIG.protectPrice * qty;
    if (p.gold < total) {
      return ctx.sender + ' 💸 골드 부족!\n방지권 ' + qty + '개 = ' + g(total) + ' / 보유 ' + g(p.gold);
    }
    p.gold -= total;
    p.protects += qty;
    saveDB();
    return '🛡️ 파괴방지권 ' + qty + '개 구매! (-' + g(total) + ')\n' +
      '보유 방지권: ' + p.protects + '개   잔액: ' + g(p.gold) + '\n' +
      '(다음 파괴 때 자동으로 1개 소모되어 무기를 지킵니다)';
  }
};

// --- 사냥 (골드 획득) ---
var cmdHunt = {
  names: ['사냥', 'ㅅㄴ', 'hunt'],
  help: '사냥 — 랜덤 몬스터를 잡아 골드 획득 (하루 ' + CONFIG.dailyHunts + '회)',
  run: function (ctx) {
    var p = getPlayer(ctx.room, ctx.sender);
    if (p.huntDay !== today()) { p.huntDay = today(); p.huntsUsed = 0; }
    if (p.huntsUsed >= CONFIG.dailyHunts) {
      return '오늘 사냥을 다 했어요! (' + CONFIG.dailyHunts + '/' + CONFIG.dailyHunts + ')\n내일 다시 사냥하세요.';
    }
    p.huntsUsed++;

    var m = MONSTERS[randInt(0, MONSTERS.length - 1)];
    var dmg = huntDamage(p.level);
    var dealt = Math.min(dmg, m.hp);
    var slain = dmg >= m.hp;
    var gold = Math.round(dealt * m.gpp);
    if (slain) gold = Math.round(gold * 1.5); // 처치 보너스
    p.gold += gold;

    // 레어 드랍
    var dropMsg = '';
    if (Math.random() < CONFIG.dropProtectChance) {
      p.protects++;
      dropMsg = '\n🎁 레어 드랍!! 🛡️ 파괴방지권 1개 획득! (보유 ' + p.protects + '개)';
      addLog(ctx.room, '🎁 ' + ctx.sender + ' 방지권 드랍!');
    } else if (Math.random() < CONFIG.dropGoldChance) {
      var bonus = Math.round(randInt(200, 600) * m.gpp);
      p.gold += bonus;
      dropMsg = '\n🎁 골드뭉치 발견! 💰 +' + g(bonus);
    }

    addLog(ctx.room, '🗡️ ' + ctx.sender + ' ' + m.name + ' ' + (slain ? '처치' : '사냥') + ' (+' + g(gold) + ')');
    saveDB();
    return '🗡️ ' + ctx.sender + ' 님 앞에 ' + m.name + ' 출현! (HP ' + m.hp + ')\n' +
      weaponName(p.level) + ' 로 ' + dealt + ' 데미지!' + (slain ? '  💀 처치!' : '') + '\n' +
      '💰 +' + g(gold) + '  (보유 ' + g(p.gold) + ')' + dropMsg + '\n' +
      '오늘 남은 사냥: ' + huntsLeft(p) + '/' + CONFIG.dailyHunts + '회';
  }
};

// --- 내정보 ---
var cmdInfo = {
  names: ['내정보', '정보', 'ㄴㅈㅂ', '내무기'],
  help: '내정보 — 내 무기 · 골드 · 전적 확인',
  run: function (ctx) {
    var p = getPlayer(ctx.room, ctx.sender);
    return '📜 ' + ctx.sender + ' 님의 정보\n' +
      '무기: ' + weaponName(p.level) + '\n' +
      '💰 골드: ' + g(p.gold) + '  (다음 강화 ' + g(enhanceCost(p.level)) + ')\n' +
      '🛡️ 방지권: ' + p.protects + '개\n' +
      '최고기록: +' + p.best + '   파괴: ' + p.breaks + '회\n' +
      '전적: ' + p.wins + '승 ' + p.losses + '패\n' +
      '남은 사냥: ' + huntsLeft(p) + '/' + CONFIG.dailyHunts + '회   ' +
      '남은 싸움: ' + fightsLeft(p) + '/' + CONFIG.dailyFights + '회';
  }
};

// --- 싸움 (PvP) ---
var cmdFight = {
  names: ['싸움', '도전', '결투', 'fight'],
  help: '싸움 [상대이름] — 결투! 이기면 상대 골드 ' + Math.round(CONFIG.stealPct * 100) + '% 획득 (하루 ' + CONFIG.dailyFights + '회)',
  run: function (ctx) {
    var targetName = ctx.args.join(' ').replace(/^@/, '').trim();
    if (!targetName) return '누구랑 싸울까요?  예) 싸움 홍길동';
    if (targetName === ctx.sender) return '자기 자신과는 싸울 수 없어요 😅';

    var R = getRoom(ctx.room);
    if (!R.players[targetName]) {
      return '"' + targetName + '" 님을 찾을 수 없어요.\n' +
        '(상대도 먼저 "강화"를 한 번 해서 게임에 참여해야 해요. 이름은 정확히!)';
    }

    var atk = getPlayer(ctx.room, ctx.sender);
    var def = getPlayer(ctx.room, targetName);

    if (atk.fightDay !== today()) { atk.fightDay = today(); atk.fightsUsed = 0; }
    if (atk.fightsUsed >= CONFIG.dailyFights) {
      return '오늘 싸움 횟수를 다 썼어요! (' + CONFIG.dailyFights + '/' + CONFIG.dailyFights + ')\n내일 다시 도전하세요.';
    }
    atk.fightsUsed++;

    // 승패: 레벨 차 1당 5% 유리, 최소 10% 하극상 여지
    var pWin = 0.5 + (atk.level - def.level) * 0.05;
    if (pWin < 0.1) pWin = 0.1;
    if (pWin > 0.9) pWin = 0.9;

    var atkWin = chance(pWin);
    var winP = atkWin ? atk : def;
    var loseP = atkWin ? def : atk;
    var winner = atkWin ? ctx.sender : targetName;
    var loser = atkWin ? targetName : ctx.sender;

    winP.wins++;
    loseP.losses++;

    // 골드 약탈
    var steal = Math.floor(loseP.gold * CONFIG.stealPct);
    loseP.gold -= steal;
    winP.gold += steal;

    // 무기 손상: 패자는 낮은 확률로 무기 1단계 하락
    var breakMsg = '';
    if (loseP.level > 0 && Math.random() < CONFIG.fightBreakChance) {
      var lbefore = loseP.level;
      loseP.level--;
      breakMsg = '\n💢 ' + loser + ' 의 무기가 손상되어 +' + lbefore + ' → +' + loseP.level + ' 하락!';
      addLog(ctx.room, '💢 ' + loser + ' 무기 손상 +' + lbefore + '→+' + loseP.level);
    }

    addLog(ctx.room, '⚔️ ' + winner + ' 승 vs ' + loser + ' (' + g(steal) + ' 약탈)');
    saveDB();
    return '⚔️ 결투!  ' + ctx.sender + '(' + weaponName(atk.level) + ')\n' +
      '   VS   ' + targetName + '(' + weaponName(def.level) + ')\n\n' +
      '🏆 승자: ' + winner + '!\n' +
      '💰 ' + winner + ' 님이 ' + loser + ' 님에게서 ' + g(steal) + ' 획득!' + breakMsg + '\n' +
      '오늘 남은 싸움: ' + fightsLeft(atk) + '/' + CONFIG.dailyFights + '회';
  }
};

// --- 랭킹 ---
var cmdRank = {
  names: ['랭킹', '순위', 'rank'],
  help: '랭킹 — 이 방의 강화 순위 TOP 10',
  run: function (ctx) {
    var R = getRoom(ctx.room);
    var arr = [];
    for (var name in R.players) {
      if (R.players.hasOwnProperty(name)) arr.push({ name: name, p: R.players[name] });
    }
    if (!arr.length) return '아직 아무도 강화하지 않았어요. "강화"로 시작해보세요!';
    arr.sort(function (a, b) {
      if (b.p.level !== a.p.level) return b.p.level - a.p.level;
      return b.p.best - a.p.best;
    });
    var medals = ['🥇', '🥈', '🥉'];
    var lines = ['🏅 강화 랭킹 TOP 10'];
    for (var i = 0; i < arr.length && i < 10; i++) {
      var tag = i < 3 ? medals[i] : (i + 1) + '.';
      lines.push(tag + ' ' + arr[i].name + '  ' + weaponName(arr[i].p.level) +
        '  (' + arr[i].p.wins + '승' + arr[i].p.losses + '패)');
    }
    return lines.join('\n');
  }
};

// --- 골드 랭킹 ---
var cmdGoldRank = {
  names: ['골드랭킹', '부자', '골드순위', 'goldrank'],
  help: '골드랭킹 — 이 방의 부자 순위 TOP 10',
  run: function (ctx) {
    var R = getRoom(ctx.room);
    var arr = [];
    for (var name in R.players) {
      if (R.players.hasOwnProperty(name)) arr.push({ name: name, gold: R.players[name].gold });
    }
    if (!arr.length) return '아직 참가자가 없어요. "강화"로 시작해보세요!';
    arr.sort(function (a, b) { return b.gold - a.gold; });
    var medals = ['🥇', '🥈', '🥉'];
    var lines = ['💰 골드 랭킹 TOP 10'];
    for (var i = 0; i < arr.length && i < 10; i++) {
      var tag = i < 3 ? medals[i] : (i + 1) + '.';
      lines.push(tag + ' ' + arr[i].name + '  ' + g(arr[i].gold));
    }
    return lines.join('\n');
  }
};

// --- 강화 로그 ---
var cmdLog = {
  names: ['강화로그', '로그', 'log'],
  help: '강화로그 — 최근 강화/싸움 기록',
  run: function (ctx) {
    var R = getRoom(ctx.room);
    if (!R.log.length) return '아직 기록이 없어요. "강화"로 첫 기록을 남겨보세요!';
    var recent = R.log.slice(-10).reverse();
    return '📜 최근 기록 (최신순)\n' + recent.join('\n');
  }
};

// --- 오늘의 호구 ---
var cmdHogu = {
  names: ['오늘의호구', '호구', 'hogu'],
  help: '오늘의호구 — 오늘 제일 많이 깨진 사람 🤡',
  run: function (ctx) {
    var R = getRoom(ctx.room);
    var arr = [];
    for (var name in R.players) {
      if (!R.players.hasOwnProperty(name)) continue;
      var pl = R.players[name];
      if (pl.destroyDay === today() && pl.destroysToday > 0) {
        arr.push({ name: name, c: pl.destroysToday });
      }
    }
    if (!arr.length) return '😌 오늘은 아직 아무도 안 깨졌어요. 평화로운 하루...';
    arr.sort(function (a, b) { return b.c - a.c; });
    var crowns = ['👑', '🥈', '🥉'];
    var lines = ['🤡 오늘의 호구 (파괴 횟수)'];
    for (var i = 0; i < arr.length && i < 5; i++) {
      lines.push((i < 3 ? crowns[i] : (i + 1) + '.') + ' ' + arr[i].name + '  ' + arr[i].c + '번 파괴');
    }
    lines.push('\n오늘의 호구는 바로... ' + arr[0].name + ' 님! ㅋㅋㅋ');
    return lines.join('\n');
  }
};

// --- 강화확률 ---
var cmdOdds = {
  names: ['강화확률', '확률', 'odds'],
  help: '강화확률 — 단계별 성공/파괴 확률표',
  run: function (ctx) {
    var rows = [
      { lv: 0,  g: '⚪ 일반' },
      { lv: 5,  g: '🔵 희귀' },
      { lv: 10, g: '🟣 에픽' },
      { lv: 15, g: '🟠 전설' },
      { lv: 20, g: '🌈 초월' },
      { lv: 24, g: '🌈 만렙직전' }
    ];
    var lines = ['📊 강화 확률표 (성공 / 파괴 / 비용)'];
    for (var i = 0; i < rows.length; i++) {
      var lv = rows[i].lv;
      var o = odds(lv);
      lines.push('+' + lv + ' ' + rows[i].g + ':  성공 ' + pct(o.success) +
        '  파괴 ' + pct(o.destroy) + '  (' + g(enhanceCost(lv)) + ')');
    }
    lines.push('\n등급: ⚪일반(~5) 🔵희귀(~10) 🟣에픽(~15) 🟠전설(~20) 🌈초월(~25)');
    lines.push('※ 파괴되면 +0 리셋! 실패는 유지(+10↑ 은 하락)');
    return lines.join('\n');
  }
};

// 등록된 명령어
var COMMANDS = [cmdEnhance, cmdAttend, cmdHunt, cmdProtect, cmdInfo, cmdFight,
  cmdRank, cmdGoldRank, cmdLog, cmdHogu, cmdOdds];

/* ------------------------------------------------------------------
 * 7. 라우터
 * ------------------------------------------------------------------ */
function buildHelp() {
  var p = CONFIG.prefix;
  var lines = ['🎮 ' + CONFIG.botName + ' — 확률 RPG 강화게임', ''];
  for (var i = 0; i < COMMANDS.length; i++) {
    lines.push('· ' + p + COMMANDS[i].help);
  }
  lines.push('· ' + p + '도움말 — 이 목록');
  lines.push('');
  lines.push('👉 "출석"+"사냥"으로 골드를 모아 "강화" 연타, "싸움 이름" 으로 골드를 뺏으세요!');
  return lines.join('\n');
}

function route(room, sender, text) {
  if (CONFIG.allowedRooms.length > 0 && CONFIG.allowedRooms.indexOf(room) === -1) {
    return null;
  }
  var trimmed = (text || '').trim();
  if (!trimmed) return null;

  if (CONFIG.prefix) {
    if (trimmed.indexOf(CONFIG.prefix) !== 0) return null;
    trimmed = trimmed.slice(CONFIG.prefix.length).trim();
  }

  var parts = trimmed.split(/\s+/);
  var cmd = parts[0];
  var args = parts.slice(1);

  if (['도움말', '명령어', 'help', '?'].indexOf(cmd) !== -1) {
    return buildHelp();
  }
  for (var i = 0; i < COMMANDS.length; i++) {
    if (COMMANDS[i].names.indexOf(cmd) !== -1) {
      return COMMANDS[i].run({ room: room, sender: sender, args: args, text: trimmed });
    }
  }
  return null; // 매칭 없음 → 무응답
}

/* ------------------------------------------------------------------
 * 8. 메신저봇R 연결부 (신버전 + 구버전 모두 지원)
 * ------------------------------------------------------------------ */
if (typeof BotManager !== 'undefined') {
  var bot = BotManager.getCurrentBot();
  bot.addListener(Event.MESSAGE, function (msg) {
    try {
      var reply = route(msg.room, msg.author.name, msg.content);
      if (reply) msg.reply(reply);
    } catch (e) {
      msg.reply('⚠️ 오류: ' + e);
    }
  });
}

function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
  try {
    var reply = route(room, sender, msg);
    if (reply) replier.reply(reply);
  } catch (e) {
    replier.reply('⚠️ 오류: ' + e);
  }
}

/* ==================================================================
 *  튜닝 가이드
 * ------------------------------------------------------------------
 *  - 강화 난이도: odds() 의 success/destroy 값
 *  - 강화 비용: enhanceCost() 공식 / 만렙: CONFIG.maxLevel
 *  - 무기 등급: GRADES 배열 (일반~초월)
 *  - 몬스터/사냥: MONSTERS 배열, huntDamage() 공식, CONFIG.dailyHunts
 *  - 골드: CONFIG.startGold / attendGold / stealPct
 *  - 파괴방지권: CONFIG.protectPrice
 *  - 싸움 무기손상 확률: CONFIG.fightBreakChance
 *  - 사냥 레어 드랍 확률: CONFIG.dropProtectChance / dropGoldChance
 *  - 하루 싸움 횟수: CONFIG.dailyFights
 *  - PvP 밸런스: cmdFight 의 pWin 공식(레벨 차 1당 5%)
 *
 *  새 명령어 추가:
 *    var cmdHello = {
 *      names: ['안녕'], help: '안녕 — 인사',
 *      run: function (ctx) { return ctx.sender + '님 안녕!'; }
 *    };
 *    그리고 COMMANDS 배열에 cmdHello 추가.
 * ================================================================== */
