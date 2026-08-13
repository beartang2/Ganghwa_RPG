/*
 * ============================================================
 *  카카오톡 단톡방 확률 RPG 강화게임 봇  (메신저봇R 용)
 * ============================================================
 *  - 이 파일 하나만 메신저봇R 에 붙여넣으면 바로 동작합니다.
 *  - 메신저봇R 신버전(BotManager) / 구버전(response) 모두 지원.
 *  - 데이터는 파일에 저장되어 봇을 껐다 켜도 유지됩니다(방마다 독립).
 *
 *  명령어: 도움말 · 강화 · 내정보 · 싸움 [상대] · 랭킹 · 강화확률
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

/* ------------------------------------------------------------------
 * 3. 데이터 저장 (FileStream, 없으면 메모리 폴백)
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
var DB = loadDB(); // { 방이름: { 플레이어이름: {...} } }

// 플레이어 레코드 가져오기(없으면 생성)
function getPlayer(room, name) {
  if (!DB[room]) DB[room] = {};
  if (!DB[room][name]) {
    DB[room][name] = {
      level: 0,     // 현재 강화 단계
      best: 0,      // 최고 기록
      breaks: 0,    // 파괴(깨짐) 횟수
      wins: 0,      // 싸움 승
      losses: 0,    // 싸움 패
      fightDay: '', // 마지막으로 싸운 날짜
      fightsUsed: 0 // 오늘 사용한 싸움 횟수
    };
  }
  return DB[room][name];
}

// 오늘 남은 싸움 횟수(날짜 바뀌면 리셋)
function fightsLeft(p) {
  if (p.fightDay !== today()) return CONFIG.dailyFights;
  return Math.max(0, CONFIG.dailyFights - p.fightsUsed);
}

/* ------------------------------------------------------------------
 * 4. 무기 이름 (강화 단계별 등급)
 * ------------------------------------------------------------------ */
var TIERS = [
  { min: 21, name: '🌟 신의검' },
  { min: 18, name: '✨ 전설의검' },
  { min: 15, name: '🐉 용검' },
  { min: 12, name: '🔥 미스릴검' },
  { min: 9,  name: '⚔️ 기사검' },
  { min: 6,  name: '⚔️ 강철검' },
  { min: 3,  name: '🗡️ 청동검' },
  { min: 0,  name: '🗡️ 나무막대기' }
];
function weaponName(level) {
  for (var i = 0; i < TIERS.length; i++) {
    if (level >= TIERS[i].min) return '+' + level + ' ' + TIERS[i].name;
  }
  return '+' + level;
}

/* ------------------------------------------------------------------
 * 5. 강화 확률
 *    단계가 높을수록 성공률↓, 파괴 확률↑
 *    - 성공: +1
 *    - 파괴: +0 으로 리셋 (처음부터 다시!)
 *    - 실패: 유지 (10단계 이상은 1단계 하락)
 * ------------------------------------------------------------------ */
function odds(level) {
  var success, destroy;
  if (level <= 2)       { success = 0.95; destroy = 0.00; }
  else if (level <= 5)  { success = 0.80; destroy = 0.00; }
  else if (level <= 8)  { success = 0.65; destroy = 0.05; }
  else if (level <= 11) { success = 0.50; destroy = 0.10; }
  else if (level <= 14) { success = 0.35; destroy = 0.17; }
  else if (level <= 17) { success = 0.25; destroy = 0.25; }
  else if (level <= 20) { success = 0.15; destroy = 0.35; }
  else                  { success = 0.08; destroy = 0.45; }
  return { success: success, destroy: destroy, fail: 1 - success - destroy };
}

/* ------------------------------------------------------------------
 * 6. 게임 명령어
 *    각 명령어는 names + run(ctx) 를 가진다.
 *    ctx = { room, sender, args, text }
 * ------------------------------------------------------------------ */

// --- 강화 ---
var cmdEnhance = {
  names: ['강화', 'ㄱㅎ', 'enhance'],
  help: '강화 — 무기를 강화한다 (실패하면 깨질 수도!)',
  run: function (ctx) {
    var p = getPlayer(ctx.room, ctx.sender);
    var o = odds(p.level);
    var before = p.level;
    var r = Math.random();
    var msg;

    if (r < o.success) {
      p.level++;
      if (p.level > p.best) p.best = p.level;
      msg = '✅ 강화 성공!  +' + before + ' → +' + p.level + '\n' + weaponName(p.level);
    } else if (r < o.success + o.destroy) {
      p.level = 0;
      p.breaks++;
      msg = '💥 파괴!!  +' + before + ' 무기가 산산조각 났습니다...\n처음부터 다시! (현재 +0)';
    } else {
      if (p.level >= 10) {
        p.level--;
        msg = '❌ 강화 실패...  +' + before + ' → +' + p.level + ' (하락)';
      } else {
        msg = '❌ 강화 실패...  +' + before + ' 유지';
      }
    }
    saveDB();
    return ctx.sender + '  ' + msg;
  }
};

// --- 내정보 ---
var cmdInfo = {
  names: ['내정보', '정보', 'ㄴㅈㅂ', '내무기'],
  help: '내정보 — 내 무기/전적 확인',
  run: function (ctx) {
    var p = getPlayer(ctx.room, ctx.sender);
    return '📜 ' + ctx.sender + ' 님의 정보\n' +
      '무기: ' + weaponName(p.level) + '\n' +
      '최고기록: +' + p.best + '   파괴: ' + p.breaks + '회\n' +
      '전적: ' + p.wins + '승 ' + p.losses + '패\n' +
      '남은 싸움: ' + fightsLeft(p) + '/' + CONFIG.dailyFights + '회';
  }
};

// --- 싸움 (PvP) ---
var cmdFight = {
  names: ['싸움', '도전', '결투', 'fight'],
  help: '싸움 [상대이름] — 상대에게 결투 신청 (하루 ' + CONFIG.dailyFights + '회)',
  run: function (ctx) {
    var targetName = ctx.args.join(' ').replace(/^@/, '').trim();
    if (!targetName) {
      return '누구랑 싸울까요?  예) 싸움 홍길동';
    }
    if (targetName === ctx.sender) {
      return '자기 자신과는 싸울 수 없어요 😅';
    }
    // 상대는 이 방에서 한 번이라도 강화를 해본 사람이어야 함
    if (!DB[ctx.room] || !DB[ctx.room][targetName]) {
      return '"' + targetName + '" 님을 찾을 수 없어요.\n' +
        '(상대도 먼저 "강화"를 한 번 해서 게임에 참여해야 해요. 이름은 정확히!)';
    }

    var atk = getPlayer(ctx.room, ctx.sender);
    var def = getPlayer(ctx.room, targetName);

    // 하루 횟수 제한 체크(공격자 기준)
    if (atk.fightDay !== today()) { atk.fightDay = today(); atk.fightsUsed = 0; }
    if (atk.fightsUsed >= CONFIG.dailyFights) {
      return '오늘 싸움 횟수를 다 썼어요! (' + CONFIG.dailyFights + '/' + CONFIG.dailyFights + ')\n내일 다시 도전하세요.';
    }
    atk.fightsUsed++;

    // 승패 계산: 레벨 차 1당 5% 유리, 최소 10% 하극상 여지
    var pWin = 0.5 + (atk.level - def.level) * 0.05;
    if (pWin < 0.1) pWin = 0.1;
    if (pWin > 0.9) pWin = 0.9;

    var atkWin = chance(pWin);
    var winner, loser;
    if (atkWin) { atk.wins++; def.losses++; winner = ctx.sender; loser = targetName; }
    else        { atk.losses++; def.wins++; winner = targetName; loser = ctx.sender; }

    saveDB();
    return '⚔️ 결투!  ' + ctx.sender + '(' + weaponName(atk.level) + ')\n' +
      '   VS   ' + targetName + '(' + weaponName(def.level) + ')\n\n' +
      '🏆 승자: ' + winner + '!  (' + loser + ' 패배)\n' +
      '오늘 남은 싸움: ' + fightsLeft(atk) + '/' + CONFIG.dailyFights + '회';
  }
};

// --- 랭킹 ---
var cmdRank = {
  names: ['랭킹', '순위', 'rank'],
  help: '랭킹 — 이 방의 강화 순위 TOP 10',
  run: function (ctx) {
    var players = DB[ctx.room];
    if (!players) return '아직 아무도 강화하지 않았어요. "강화"로 시작해보세요!';
    var arr = [];
    for (var name in players) {
      if (players.hasOwnProperty(name)) arr.push({ name: name, p: players[name] });
    }
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

// --- 강화확률 ---
var cmdOdds = {
  names: ['강화확률', '확률', 'odds'],
  help: '강화확률 — 단계별 성공/파괴 확률표',
  run: function (ctx) {
    var showLevels = [0, 3, 6, 9, 12, 15, 18, 21];
    var lines = ['📊 강화 확률표 (성공 / 파괴)'];
    for (var i = 0; i < showLevels.length; i++) {
      var lv = showLevels[i];
      var o = odds(lv);
      lines.push('+' + lv + ' 이상:  성공 ' + pct(o.success) + '  /  파괴 ' + pct(o.destroy));
    }
    lines.push('\n※ 파괴되면 +0 으로 리셋! 실패는 유지(+10↑ 은 하락)');
    return lines.join('\n');
  }
};

// 등록된 명령어
var COMMANDS = [cmdEnhance, cmdInfo, cmdFight, cmdRank, cmdOdds];

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
  lines.push('👉 "강화" 를 연타해서 무기를 키우고, "싸움 이름" 으로 대결하세요!');
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
 *  - 강화 난이도: 위 odds() 함수의 success/destroy 값을 조절.
 *  - 무기 등급/이름: TIERS 배열 수정.
 *  - 하루 싸움 횟수: CONFIG.dailyFights.
 *  - PvP 밸런스: cmdFight 의 pWin 공식(레벨 차 1당 5%) 조절.
 *
 *  새 명령어 추가:
 *    var cmdHello = {
 *      names: ['안녕'],
 *      help: '안녕 — 인사',
 *      run: function (ctx) { return ctx.sender + '님 안녕!'; }
 *    };
 *    그리고 COMMANDS 배열에 cmdHello 추가.
 * ================================================================== */
