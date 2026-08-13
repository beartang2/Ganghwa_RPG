/*
 * ============================================================
 *  카카오톡 단톡방 게임봇  (메신저봇R 용)
 * ============================================================
 *  - 이 파일 하나만 메신저봇R 에 붙여넣으면 바로 동작합니다.
 *  - 메신저봇R 신버전(BotManager) / 구버전(response) 모두 지원합니다.
 *  - 게임 추가하는 법은 파일 맨 아래 "게임 추가하는 법" 주석 참고.
 *
 *  기본 게임: 도움말 · 가위바위보 · 주사위 · 로또 · 숫자게임(업다운)
 * ============================================================
 */

/* ------------------------------------------------------------------
 * 1. 설정
 * ------------------------------------------------------------------ */
var CONFIG = {
  botName: '게임봇',

  // 명령어 접두사. '' 이면 접두사 없이 "주사위" 만 입력해도 반응.
  // 단톡방 오작동이 잦으면 '!' 나 '/' 로 바꾸세요. 예) prefix: '/'
  prefix: '',

  // 지정한 방에서만 반응. 빈 배열([])이면 모든 방에서 반응.
  // 예) allowedRooms: ['우리 게임방', '테스트방']
  allowedRooms: [],
};

/* ------------------------------------------------------------------
 * 2. 유틸
 * ------------------------------------------------------------------ */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

/* ------------------------------------------------------------------
 * 3. 방별 상태 저장소 (숫자게임처럼 진행이 이어지는 게임용)
 * ------------------------------------------------------------------ */
var roomState = {}; // { 방이름: { game: '숫자게임', ...데이터 } }

/* ------------------------------------------------------------------
 * 4. 게임 정의
 *    각 게임은 names(명령어) + run(ctx) 을 가진다.
 *    run 은 봇이 보낼 문자열을 반환(반환값 없으면 무응답).
 *    ctx = { room, sender, args, text }
 * ------------------------------------------------------------------ */

// --- 가위바위보 ---
var HANDS = ['가위', '바위', '보'];
var BEATS = { 가위: '보', 바위: '가위', 보: '바위' };
var gameRps = {
  names: ['가위바위보', '가바보', 'rps'],
  help: '가위바위보 [가위|바위|보] — 봇과 대결',
  run: function (ctx) {
    var me = ctx.args[0];
    if (HANDS.indexOf(me) === -1) {
      return '가위 · 바위 · 보 중 하나를 내주세요!\n예) 가위바위보 바위';
    }
    var bot = pick(HANDS);
    var result;
    if (me === bot) result = '비겼어요! 🤝';
    else if (BEATS[me] === bot) result = ctx.sender + '님 승리! 🎉';
    else result = '봇 승리! 😎';
    return ctx.sender + ': ' + me + '\n봇: ' + bot + '\n\n' + result;
  },
};

// --- 주사위 ---
var gameDice = {
  names: ['주사위', 'dice'],
  help: '주사위 [면수] — 주사위 굴리기 (기본 6면)',
  run: function (ctx) {
    var faces = parseInt(ctx.args[0], 10);
    if (isNaN(faces) || faces < 2) faces = 6;
    if (faces > 1000) faces = 1000;
    return '🎲 ' + ctx.sender + '님이 굴린 결과: ' + randInt(1, faces) + ' (1~' + faces + ')';
  },
};

// --- 로또 번호 추천 ---
var gameLotto = {
  names: ['로또', 'lotto'],
  help: '로또 — 로또 번호 6개 추천',
  run: function (ctx) {
    var pool = [];
    for (var i = 1; i <= 45; i++) pool.push(i);
    var picked = [];
    for (var j = 0; j < 6; j++) {
      var idx = randInt(0, pool.length - 1);
      picked.push(pool[idx]);
      pool.splice(idx, 1);
    }
    picked.sort(function (a, b) { return a - b; });
    return '🎰 ' + ctx.sender + '님의 행운 번호\n' + picked.join('  ');
  },
};

// --- 숫자게임 (업/다운) : 진행이 이어지는 게임 ---
var gameGuess = {
  names: ['숫자게임', '업다운'],
  help: '숫자게임 — 1~100 숫자 맞히기 (시작 후 숫자만 입력, "종료"로 중단)',
  run: function (ctx) {
    var st = roomState[ctx.room];
    if (st && st.game === '숫자게임') {
      return '이미 숫자게임이 진행 중이에요! 1~100 숫자를 입력하세요. (그만하려면 "종료")';
    }
    roomState[ctx.room] = { game: '숫자게임', answer: randInt(1, 100), tries: 0 };
    return '🔢 숫자게임 시작! 1~100 사이 숫자를 맞혀보세요.\n숫자를 입력하면 업/다운을 알려드려요. (중단: "종료")';
  },
};

// 숫자게임이 진행 중일 때, 일반 메시지를 가로채 처리하는 핸들러.
// 반환값이 string 이면 그 메시지를 보내고 라우터는 여기서 종료.
function handleActiveGame(ctx) {
  var st = roomState[ctx.room];
  if (!st || st.game !== '숫자게임') return null;

  if (ctx.text === '종료' || ctx.text === '숫자게임 종료') {
    delete roomState[ctx.room];
    return '숫자게임을 종료했어요. (정답은 ' + st.answer + ' 였어요)';
  }

  var guess = parseInt(ctx.text, 10);
  // 순수한 숫자 입력이 아니면 무시(다른 대화까지 반응하지 않도록)
  if (isNaN(guess) || String(guess) !== ctx.text.trim()) return null;

  st.tries++;
  if (guess === st.answer) {
    delete roomState[ctx.room];
    return '🎉 정답! ' + st.answer + ' 맞아요!\n' + ctx.sender + '님이 ' + st.tries + '번 만에 성공!';
  }
  return guess < st.answer ? '⬆️ 업! (더 큰 숫자)' : '⬇️ 다운! (더 작은 숫자)';
}

// 등록된 게임 목록
var GAMES = [gameRps, gameDice, gameLotto, gameGuess];

/* ------------------------------------------------------------------
 * 5. 라우터 — 메시지 하나를 받아 보낼 답을 반환(없으면 null)
 * ------------------------------------------------------------------ */
function buildHelp() {
  var lines = ['📖 ' + CONFIG.botName + ' 명령어'];
  var p = CONFIG.prefix;
  for (var i = 0; i < GAMES.length; i++) {
    lines.push('· ' + p + GAMES[i].help);
  }
  lines.push('· ' + p + '도움말 — 이 목록 보기');
  return lines.join('\n');
}

function route(room, sender, text) {
  // 방 허용 목록 검사
  if (CONFIG.allowedRooms.length > 0 && CONFIG.allowedRooms.indexOf(room) === -1) {
    return null;
  }

  var trimmed = (text || '').trim();
  if (!trimmed) return null;

  // 진행 중인 게임(숫자게임 등)이 있으면 먼저 처리
  var active = handleActiveGame({ room: room, sender: sender, text: trimmed });
  if (active !== null) return active;

  // 접두사 검사/제거
  if (CONFIG.prefix) {
    if (trimmed.indexOf(CONFIG.prefix) !== 0) return null;
    trimmed = trimmed.slice(CONFIG.prefix.length).trim();
  }

  var parts = trimmed.split(/\s+/);
  var cmd = parts[0];
  var args = parts.slice(1);

  // 도움말
  if (['도움말', '명령어', 'help', '?'].indexOf(cmd) !== -1) {
    return buildHelp();
  }

  // 게임 명령어 매칭
  for (var i = 0; i < GAMES.length; i++) {
    if (GAMES[i].names.indexOf(cmd) !== -1) {
      return GAMES[i].run({ room: room, sender: sender, args: args, text: trimmed });
    }
  }

  return null; // 매칭되는 명령어 없음 → 무응답
}

/* ------------------------------------------------------------------
 * 6. 메신저봇R 연결부 (신버전 + 구버전 모두 지원)
 * ------------------------------------------------------------------ */

// 신버전 API (BotManager / Event)
if (typeof BotManager !== 'undefined') {
  var bot = BotManager.getCurrentBot();
  bot.addListener(Event.MESSAGE, function (msg) {
    try {
      var reply = route(msg.room, msg.author.name, msg.content);
      if (reply) msg.reply(reply);
    } catch (e) {
      // 오류가 나도 봇이 죽지 않도록
      msg.reply('⚠️ 오류: ' + e);
    }
  });
}

// 구버전 API (전역 response 함수) — 신버전 환경에서는 호출되지 않음
function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
  try {
    var reply = route(room, sender, msg);
    if (reply) replier.reply(reply);
  } catch (e) {
    replier.reply('⚠️ 오류: ' + e);
  }
}

/* ==================================================================
 *  게임 추가하는 법
 * ------------------------------------------------------------------
 *  1) 위 "4. 게임 정의" 처럼 객체를 하나 만든다:
 *
 *       var gameHello = {
 *         names: ['안녕', 'hi'],        // 반응할 명령어들
 *         help: '안녕 — 인사하기',        // 도움말에 표시될 설명
 *         run: function (ctx) {
 *           return ctx.sender + '님 안녕하세요!';   // 보낼 메시지 반환
 *         }
 *       };
 *
 *  2) 아래 GAMES 배열에 추가한다:
 *       var GAMES = [gameRps, gameDice, gameLotto, gameGuess, gameHello];
 *
 *  ctx 에는 { room, sender, args, text } 가 들어있다.
 *    - args: 명령어 뒤 단어들의 배열  (예: "주사위 20" → args[0] === "20")
 *    - text: 접두사 뗀 전체 입력 문자열
 * ================================================================== */
