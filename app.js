/* 엔진오일 — 홈 화면 웹 앱.
 *
 * 저장소의 state.json 을 읽어 현황을 보여주고, 입력은 GitHub 이슈로 보낸다.
 * 이슈를 받은 워크플로가 실제 반영을 한다 — 쓰기 규칙을 여기서 다시 구현하지 않기 위해서다.
 * 여기서 하는 계산은 보여주기용 추정뿐이고, src/estimate.py 와 식을 맞춘다.
 */
(function () {
  'use strict';

  var REPO = 'june690602-blip/genesis-oil-alert';
  var API = 'https://api.github.com/repos/' + REPO;
  var TOKEN_KEY = 'oil.token';
  var CACHE_KEY = 'oil.state';          // 마지막으로 읽은 state — 오프라인에서도 뭔가 보여준다
  var ZONE = 'Asia/Seoul';              // 서버(GitHub Actions)와 같은 날짜 기준을 쓴다
  var POLL_MS = 5000;
  var POLL_TRIES = 15;                  // 워크플로가 보통 40초쯤 걸린다

  var PLAUSIBLE_FACTOR = 2;             // src/estimate.py 와 같은 값
  var PLAUSIBLE_MARGIN_KM = 2000;

  var $ = function (id) { return document.getElementById(id); };
  var state = null;
  var mode = 'odometer';

  /* ---------- 날짜 ---------- */

  function todayISO() {
    // 폰이 어느 시간대에 있든 한국 날짜로 계산한다
    var p = new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    return p;                            // en-CA 는 YYYY-MM-DD
  }

  function parseISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function daysBetween(fromISO, toISO) {
    var a = parseISO(fromISO), b = parseISO(toISO);
    if (a === null || b === null) return null;
    return Math.round((b - a) / 86400000);
  }

  function addMonths(iso, months) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    var y = +m[1], mo = +m[2] - 1 + months, d = +m[3];
    var last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();   // 말일 넘침 방지
    var dt = new Date(Date.UTC(y, mo, Math.min(d, last)));
    return dt.toISOString().slice(0, 10);
  }

  /* ---------- 계산 (src/estimate.py 와 같은 식) ---------- */

  function estimateKm(odo, today) {
    var days = Math.max(daysBetween(odo.last_measured_date, today), 0);
    return odo.last_measured_km + Math.round(days * odo.daily_avg_km);
  }

  function evaluate(item, odo, today) {
    var est = estimateKm(odo, today);
    var dueKm = item.last_change_km + item.interval_km;
    var remainKm = dueKm - est;

    // 0 에서 멀어지는 쪽으로 반올림 — 늦은 것을 줄여 말하지 않는다
    var raw = remainKm / odo.daily_avg_km;
    var remainDaysEst = raw >= 0 ? Math.ceil(raw) : Math.floor(raw);

    var dueDate = null, remainDays = null;
    if (item.last_change_date) {
      dueDate = addMonths(item.last_change_date, item.interval_months);
      remainDays = daysBetween(today, dueDate);
    }
    return {
      estimatedKm: est,
      dueKm: dueKm,
      dueDate: dueDate,
      remainingKm: remainKm,
      remainingDays: remainDays,
      remainingDaysEst: remainDaysEst,
      elapsedKm: est - item.last_change_km,
      isOverdue: remainKm <= 0 || (remainDays !== null && remainDays <= 0)
    };
  }

  function plausibleLimit(odo, today) {
    var days = Math.max(daysBetween(odo.last_measured_date, today), 1);
    return odo.last_measured_km
      + Math.round(days * odo.daily_avg_km * PLAUSIBLE_FACTOR)
      + PLAUSIBLE_MARGIN_KM;
  }

  /* ---------- 표시 ---------- */

  var nf = new Intl.NumberFormat('ko-KR');
  function km(n) { return nf.format(n) + ' km'; }

  function say(text, kind) {
    var el = $('msg');
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
    el.hidden = !text;
  }

  function render() {
    if (!state) return;
    var item = state.items[0];
    var today = todayISO();
    var st = evaluate(item, state.odometer, today);

    var big = $('remain'), sub = $('remain-sub');
    if (st.isOverdue) {
      big.textContent = km(-st.remainingKm) + ' 초과';
      big.classList.add('late');
      sub.textContent = (-st.remainingDaysEst) + '일 지났습니다';
    } else {
      big.textContent = km(st.remainingKm);
      big.classList.remove('late');
      sub.textContent = '약 ' + st.remainingDaysEst + '일 뒤 · ' + (st.dueDate || '');
    }

    $('est').textContent = km(st.estimatedKm) + ' (추정)';
    $('measured').textContent = km(state.odometer.last_measured_km)
      + ' · ' + state.odometer.last_measured_date;
    $('changed').textContent = km(item.last_change_km)
      + (item.last_change_date ? ' · ' + item.last_change_date : '');
    $('due').textContent = km(st.dueKm) + (st.dueDate ? ' 또는 ' + st.dueDate : '');
    $('avg').textContent = Math.round(state.odometer.daily_avg_km) + ' km/일';

    var box = $('order-links');
    box.textContent = '';
    (item.order_links || []).forEach(function (l) {
      var a = document.createElement('a');
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = l.label;
      box.appendChild(a);
    });
  }

  /* ---------- GitHub ---------- */

  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }

  function api(path, options) {
    var opt = options || {};
    var t = token();
    if (!t) return Promise.reject(new Error('NO_TOKEN'));
    return fetch(API + path, {
      method: opt.method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + t,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: opt.body ? JSON.stringify(opt.body) : undefined,
      cache: 'no-store'
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) throw new Error('BAD_TOKEN');
      if (!res.ok) throw new Error('HTTP_' + res.status);
      return res.status === 204 ? null : res.json();
    });
  }

  function decodeContent(b64) {
    // GitHub 은 base64 로 준다. 한글이 있으니 UTF-8 로 되돌린다.
    var bin = atob((b64 || '').replace(/\n/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function loadState() {
    return api('/contents/state.json').then(function (file) {
      var parsed = JSON.parse(decodeContent(file.content));
      state = parsed;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(parsed)); } catch (e) { /* 저장 공간 없음 — 무시 */ }
      return parsed;
    });
  }

  function loadCached() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (raw) { state = JSON.parse(raw); return true; }
    } catch (e) { /* 깨진 캐시 — 무시 */ }
    return false;
  }

  function refresh(quiet) {
    var btn = $('refresh');
    btn.classList.add('spin');
    if (!quiet) say('불러오는 중…');
    return loadState().then(function () {
      render();
      if (!quiet) say('');
    }).catch(function (err) {
      if (err.message === 'NO_TOKEN') {
        say('설정에서 GitHub 토큰을 먼저 넣어주세요.', 'bad');
        showSettings();
      } else if (err.message === 'BAD_TOKEN') {
        say('토큰이 거부되었습니다. 설정에서 다시 넣어주세요.', 'bad');
      } else if (loadCached()) {
        render();
        say('연결이 안 됩니다. 마지막으로 받은 내용입니다.', 'bad');
      } else {
        say('불러오지 못했습니다: ' + err.message, 'bad');
      }
    }).then(function () {
      btn.classList.remove('spin');
    });
  }

  /* ---------- 보내기 ---------- */

  function submit() {
    var raw = ($('km').value || '').replace(/[^0-9]/g, '');
    if (!raw) { warn('숫자를 넣어주세요.'); return; }
    var value = parseInt(raw, 10);

    if (state) {
      if (value < state.odometer.last_measured_km) {
        warn('마지막 기록 ' + km(state.odometer.last_measured_km) + ' 보다 작습니다.');
        return;
      }
      if (value > plausibleLimit(state.odometer, todayISO())) {
        warn('그동안 달렸을 수 있는 거리보다 큽니다. 계기판 숫자가 맞나요?');
        return;
      }
    }

    var isChange = mode === 'oil-change';
    $('submit').disabled = true;
    say('보내는 중…');

    api('/issues', {
      method: 'POST',
      body: {
        title: isChange ? '엔진오일 교체 완료' : '주행거리 보정',
        body: String(value),
        labels: [isChange ? 'oil-change' : 'odometer']
      }
    }).then(function (issue) {
      say('보냈습니다. 반영을 기다리는 중…');
      return waitForApply(issue.number);
    }).then(function (applied) {
      showMain();
      render();
      say(applied ? '반영되었습니다.' : '보냈습니다. 반영에 시간이 걸리고 있습니다.',
          applied ? 'good' : null);
    }).catch(function (err) {
      say(err.message === 'BAD_TOKEN'
        ? '토큰이 거부되었습니다. 설정을 확인해주세요.'
        : '보내지 못했습니다: ' + err.message, 'bad');
    }).then(function () {
      $('submit').disabled = false;
    });
  }

  function waitForApply(number) {
    // 워크플로가 끝나면 이슈가 닫힌다. 닫히면 state 를 다시 읽는다.
    var tries = 0;
    return new Promise(function (resolve) {
      (function poll() {
        if (++tries > POLL_TRIES) { resolve(false); return; }
        setTimeout(function () {
          api('/issues/' + number).then(function (issue) {
            if (issue.state === 'closed') {
              loadState().then(function () { resolve(true); })
                         .catch(function () { resolve(true); });
            } else { poll(); }
          }).catch(function () { resolve(false); });
        }, POLL_MS);
      })();
    });
  }

  function warn(text) {
    var el = $('input-warn');
    el.textContent = text;
    el.hidden = !text;
  }

  /* ---------- 화면 전환 ---------- */

  function show(which) {
    ['view-main', 'view-input', 'view-set'].forEach(function (id) {
      $(id).hidden = id !== which;
    });
  }
  function showMain() { show('view-main'); }
  function showSettings() {
    $('token').value = '';
    $('token-state').textContent = token() ? '토큰이 저장되어 있습니다.' : '토큰이 없습니다.';
    show('view-set');
  }
  function showInput(which) {
    mode = which;
    warn('');
    var change = which === 'oil-change';
    $('input-title').textContent = change ? '엔진오일 갈았어요' : '계기판 숫자 입력';
    $('input-hint').textContent = change
      ? '교체한 그때 계기판에 보이던 숫자입니다. 오늘 날짜로 기록됩니다.'
      : '지금 계기판에 보이는 누적 주행거리입니다.';
    $('km').value = '';
    show('view-input');
    $('km').focus();
  }

  /* ---------- 시작 ---------- */

  function init() {
    $('refresh').addEventListener('click', function () { refresh(false); });
    $('go-km').addEventListener('click', function () { showInput('odometer'); });
    $('go-change').addEventListener('click', function () { showInput('oil-change'); });
    $('go-set').addEventListener('click', showSettings);
    $('cancel').addEventListener('click', showMain);
    $('close-set').addEventListener('click', showMain);
    $('submit').addEventListener('click', submit);

    $('km').addEventListener('input', function () { warn(''); });
    $('km').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    $('save-token').addEventListener('click', function () {
      var v = ($('token').value || '').trim();
      if (!v) { say('토큰을 넣어주세요.', 'bad'); return; }
      try { localStorage.setItem(TOKEN_KEY, v); } catch (e) {
        say('이 브라우저에 저장할 수 없습니다.', 'bad'); return;
      }
      $('token').value = '';
      showMain();
      refresh(false);
    });

    $('clear-token').addEventListener('click', function () {
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 무시 */ }
      $('token-state').textContent = '토큰이 없습니다.';
      say('토큰을 지웠습니다.');
    });

    if (loadCached()) { showMain(); render(); } else { showMain(); }
    refresh(true);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 설치 실패해도 앱은 돈다 */ });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();

/* 배포 확인용 */
