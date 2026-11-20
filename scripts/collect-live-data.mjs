#!/usr/bin/env node
// =============================================================================
// 트릭컬 브리핑 사이트용 live_data.json 생성기
// - 네이버 게임 라운지(트릭컬) 공식 게시판을 서버에서 직접 읽어 공지·쿠폰을 추출
// - data/manual.json(사람이 직접 관리하는 카페 공지 링크·이벤트 엘리프·일정)을 합침
// - 결과가 이전과 같으면 파일을 건드리지 않음 → GitHub Actions가 불필요한 커밋을 만들지 않음
//
// 실행: node scripts/collect-live-data.mjs            (저장소 루트에서)
//       node scripts/collect-live-data.mjs --dry-run  (파일 저장 없이 결과만 출력)
// 외부 패키지 없이 Node 20+ 내장 fetch만 사용
// =============================================================================
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = path.join(ROOT, 'live_data.json');
const MANUAL_FILE = path.join(ROOT, 'data', 'manual.json');
const DRY_RUN = process.argv.includes('--dry-run');

const LOUNGE_ID = 'Trickcal';
const API_BASE = `https://comm-api.game.naver.com/nng_main/v1/community/lounge/${LOUNGE_ID}/feed`;
const POST_URL = (id) => `https://game.naver.com/lounge/${LOUNGE_ID}/board/detail/${id}`;

// 공식(운영진) 게시판 ID — 2026-11 기준 라운지 게시판 목록에서 확인한 값
const OFFICIAL_BOARDS = [
  { id: 3, name: '공지사항', limit: 15 },
  { id: 11, name: '업데이트', limit: 10 },
  { id: 13, name: '진행 이벤트', limit: 10 },
  { id: 31, name: '쿠폰', limit: 5 },
  { id: 22, name: '테마극장 PV', limit: 5 },
  { id: 15, name: '공식 영상', limit: 5 },
  { id: 8, name: '개발자 노트', limit: 3 }
];

const MAX_NOTICES = 20;
const MAX_ITEMS = 30;
const REQUEST_GAP_MS = 400; // 게시판 사이 요청 간격 (서버 부담 최소화)
const USER_AGENT = 'Mozilla/5.0 (compatible; trickcal-briefing-collector/1.0)';

// 사이트(index.html)의 OFFICIAL_PREFIX_REGEX와 같은 규칙: 이 말머리로 시작하는 글만 공식 공지로 취급
const OFFICIAL_PREFIX_REGEX =
  /^\s*\[(공지|업데이트|업데이트PV|테마극장|점검|정기점검|임시점검|연장점검|무점검|이벤트|개발자\s*노트|패치|사전\s*안내|안내|쿠폰|완료|조치|복각|신규|상품|패키지|알림)/;
const OFFICIAL_NICK_KEYWORDS = ['gm', 'cm', '트릭컬', 'trickcal', '에피드', 'epid', '운영'];

// ---------------------------------------------------------------------------
// 공통 유틸
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function cleanText(s, max) {
  return decodeEntities(s).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const pad2 = (n) => String(n).padStart(2, '0');

// "20261111120719" → "2026-11-11"
function toIsoDate(created) {
  const s = String(created || '');
  if (/^\d{8}/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

function isSafeHttpsUrl(u) {
  try {
    const p = new URL(String(u));
    return p.protocol === 'https:';
  } catch {
    return false;
  }
}

async function fetchJson(url, attempt = 1) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
      await sleep(1500 * attempt);
      return fetchJson(url, attempt + 1);
    }
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// 라운지 글 → 공지 항목
// ---------------------------------------------------------------------------
function classifyCategory(title) {
  const m = title.match(OFFICIAL_PREFIX_REGEX);
  const tag = m ? m[1].replace(/\s+/g, '') : '';
  if (tag.includes('쿠폰') || title.includes('쿠폰 안내')) return '쿠폰';
  if (/점검|업데이트|패치|노트/.test(tag) || /점검|업데이트/.test(title)) return '점검·업데이트';
  if (/이벤트|테마극장/.test(tag) || /픽업|테마극장/.test(title)) return '이벤트';
  return '공지';
}

function toNotice(item, boardMeta) {
  const f = item && item.feed;
  if (!f) return null;
  const id = String(f.feedId || '');
  if (!/^\d{1,15}$/.test(id)) return null;
  const title = cleanText(f.title, 160);
  if (!title || !OFFICIAL_PREFIX_REGEX.test(title)) return null;

  // 공식 게시판이라도 운영진 계정이 쓴 글만 인정 (닉네임 사칭 대비 게시판 ID와 이중 확인)
  const nick = String((item.user && item.user.nickname) || '').toLowerCase();
  if (!OFFICIAL_NICK_KEYWORDS.some((k) => nick.includes(k))) return null;

  const date = toIsoDate(f.createdDate);
  const bodyText = smartEditorToText(f.contents);
  const period = extractPeriod(bodyText, date);
  const apostle = /픽업|사도\s*모집/.test(title) ? extractPickupApostle(bodyText) : '';

  return {
    id,
    category: classifyCategory(title),
    title,
    date,
    url: POST_URL(id),
    board: boardMeta.name,
    // 본문의 "이벤트 기간 - 11/19(목) 정기점검 이후 ~ 12/03(목) 10:59"에서 뽑은 실제 진행 기간 (없으면 생략)
    ...(period ? { startAt: period.startAt, endAt: period.endAt } : {}),
    ...(apostle ? { apostle } : {}),
    _contents: f.contents // 쿠폰 추출용 (출력 전에 제거)
  };
}

// ---------------------------------------------------------------------------
// 본문 → 진행 기간 / 픽업 사도명
// ---------------------------------------------------------------------------
// 날짜 한 개: "11/19(목)" 또는 "11월 19일(목)" + 선택적으로 "정기점검 이후" 또는 "10:59"
const DATE_PART = String.raw`(\d{1,2})\s*(?:/|월\s*)(\d{1,2})\s*일?\s*(?:\([^)]*\))?\s*((?:정기\s*)?점검\s*(?:이후|후)|\d{1,2}:\d{2})?`;
const RANGE_RE = new RegExp(`${DATE_PART}\\s*~\\s*${DATE_PART}`);

function toKstIso(year, month, day, hh, mm) {
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hh)}:${pad2(mm)}:00+09:00`;
}

function extractPeriod(text, postedIso) {
  if (!text) return null;
  // '이벤트 기간' / '진행 기간' / '픽업 기간' 제목 뒤를 먼저 찾고, 없으면 본문 전체에서 첫 기간 표기
  const headingIdx = text.search(/(이벤트|진행|모집|픽업|판매|오픈)\s*기간/);
  const scopes = headingIdx >= 0 ? [text.slice(headingIdx, headingIdx + 400), text] : [text];
  let m = null;
  for (const s of scopes) {
    m = s.match(RANGE_RE);
    if (m) break;
  }
  if (!m) return null;

  const [, sMon, sDay, sSuffix, eMon, eDay, eSuffix] = m;
  const postedYear = Number(String(postedIso).slice(0, 4)) || new Date().getUTCFullYear();
  const postedMonth = Number(String(postedIso).slice(5, 7)) || Number(sMon);
  const yearFor = (mon) => (Number(mon) < postedMonth - 6 ? postedYear + 1 : postedYear);

  // 시작: "점검 이후"는 통상 점검 종료 시각(11:00)으로, 시각이 있으면 그 시각, 없으면 00:00
  let [sh, sm] = [0, 0];
  if (sSuffix && /점검/.test(sSuffix)) [sh, sm] = [11, 0];
  else if (sSuffix) [sh, sm] = sSuffix.split(':').map(Number);
  // 종료: 시각이 있으면 그 시각, 없으면 그날 23:59
  let [eh, em] = [23, 59];
  if (eSuffix && /^\d/.test(eSuffix)) [eh, em] = eSuffix.split(':').map(Number);

  const startYear = yearFor(sMon);
  let endYear = yearFor(eMon);
  if (Number(eMon) < Number(sMon) && endYear === startYear) endYear += 1; // 12/24 ~ 1/7 같은 연말 걸침
  const startAt = toKstIso(startYear, Number(sMon), Number(sDay), sh, sm);
  const endAt = toKstIso(endYear, Number(eMon), Number(eDay), eh, em);
  if (!(Date.parse(endAt) > Date.parse(startAt))) return null;
  return { startAt, endAt };
}

function extractPickupApostle(text) {
  // 최소 일치(?)로 "아이리스의"에서 조사 '의'를 떼어 "아이리스"만 추출
  const m = text.match(/신규\s*사도\s*[「『"']?([가-힣A-Za-z]{1,10}?)[」』"']?\s*(?:의|이|가|를|픽업)(?=[\s,.!]|$)/);
  const name = m ? m[1] : '';
  return ['픽업', '모집', '사도', '이벤트'].includes(name) ? '' : name;
}

// ---------------------------------------------------------------------------
// 쿠폰 글 본문(SmartEditor JSON) → 코드·보상·기한
// ---------------------------------------------------------------------------
function smartEditorToText(contents) {
  let doc;
  try {
    doc = typeof contents === 'string' ? JSON.parse(contents) : contents;
  } catch {
    return decodeEntities(String(contents || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '));
  }
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'value' && typeof v === 'string') out.push(v);
        else walk(v);
      }
    }
  };
  walk(doc);
  return decodeEntities(out.join('\n'));
}

const COUPON_BLOCKLIST = new Set(['UNDEFINED', 'NULL', 'TRICKCAL', 'REVIVE', 'SPECIALCOUPON']);
function isPlausibleCouponCode(code) {
  if (!code || COUPON_BLOCKLIST.has(code)) return false;
  if (/[가-힣]/.test(code)) return /^[가-힣A-Z0-9]{2,60}$/.test(code);
  return /^[A-Z0-9]{4,30}$/.test(code) && !/^\d+$/.test(code);
}

// 헤딩 줄("쿠폰 코드", "쿠폰 보상", "사용 기한") 다음의 내용 줄들을 묶어서 반환
function sectionLines(lines, headingRe) {
  const idx = lines.findIndex((l) => headingRe.test(l) && l.length <= 40);
  if (idx < 0) return [];
  const res = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) {
      if (res.length) break;
      continue;
    }
    if (/^(🎫|🎁|📅|❤)/u.test(l) || /쿠폰\s*(코드|보상|입력)|사용\s*기한/.test(l)) break;
    res.push(l);
  }
  return res;
}

function extractCoupons(notice, nowMs) {
  const text = smartEditorToText(notice._contents);
  const lines = text.split(/\n/).map((l) => l.trim());

  // 헤딩은 줄 맨 앞이 '쿠폰 코드'여야 함 ("아래 쿠폰 번호를 입력하고…" 같은 안내문 오인 방지)
  const codeLines = sectionLines(lines, /^[🎫◈\s]*쿠폰\s*(코드|번호)/u);
  const codes = codeLines
    .map((l) => l.replace(/^[-•·*\s]+/, '').trim().toUpperCase())
    .filter((c) => !/\s/.test(c) && isPlausibleCouponCode(c));
  if (codes.length === 0) return [];

  const reward = sectionLines(lines, /^[🎁◈\s]*쿠폰\s*보상/u)
    .map((l) => l.replace(/^[-•·*\s]+/, ''))
    .join(' + ')
    .slice(0, 100) || notice.title.replace(/^\[쿠폰\]\s*/, '').slice(0, 100);

  // 기한: "~ 11월 26일 10:59" (본문 우선, 없으면 제목)
  const periodText = sectionLines(lines, /^[📅◈\s]*(사용\s*기한|유효\s*기간)/u).join(' ') + ' ' + notice.title;
  const exp = periodText.match(/~\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\([^)]*\))?\s*(\d{1,2}:\d{2})?/);
  let expiresAt = null;
  let periodLabel = '진행 중';
  if (exp) {
    const month = Number(exp[1]);
    const day = Number(exp[2]);
    const time = (exp[3] || '10:59').padStart(5, '0');
    const postedYear = Number((notice.date || '').slice(0, 4)) || new Date().getUTCFullYear();
    const postedMonth = Number((notice.date || '').slice(5, 7)) || month;
    const year = month < postedMonth - 6 ? postedYear + 1 : postedYear;
    expiresAt = `${year}-${pad2(month)}-${pad2(day)}T${time}:00+09:00`;
    periodLabel = `~${pad2(month)}/${pad2(day)} ${time}`;
    if (Date.parse(expiresAt) <= nowMs) return []; // 이미 만료된 쿠폰은 내보내지 않음
  }

  return codes.map((code) => ({
    code,
    reward,
    desc: notice.title.slice(0, 80),
    expiresAt,
    periodLabel,
    sourceUrl: notice.url
  }));
}

// ---------------------------------------------------------------------------
// data/manual.json (사람이 관리) 검증
// ---------------------------------------------------------------------------
async function loadManual() {
  if (!existsSync(MANUAL_FILE)) return { notices: [], events: [], schedules: [], coupons: [] };
  const raw = JSON.parse(await readFile(MANUAL_FILE, 'utf8'));
  const todayIso = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

  const notices = (Array.isArray(raw.notices) ? raw.notices : [])
    .map((n, i) => {
      let title = cleanText(n && n.title, 150);
      const url = n && n.url;
      if (!title || !isSafeHttpsUrl(url)) return null;
      // 사이트는 말머리가 있는 제목만 공식 공지로 표시하므로 없으면 [공지]를 붙임
      if (!OFFICIAL_PREFIX_REGEX.test(title)) title = `[공지] ${title}`;
      if (n.until && /^\d{4}-\d{2}-\d{2}$/.test(n.until) && n.until < todayIso) return null; // 표시 종료일 지난 항목 제외
      return {
        id: `manual_${String(n.id || i).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || i}`,
        category: ['공지', '쿠폰', '점검·업데이트', '이벤트'].includes(n.category) ? n.category : classifyCategory(title),
        title,
        date: /^\d{4}-\d{2}-\d{2}$/.test(n.date || '') ? n.date : todayIso,
        url: String(url),
        board: cleanText(n.source || '카페', 20)
      };
    })
    .filter(Boolean);

  const events = (Array.isArray(raw.events) ? raw.events : [])
    .filter((e) => e && e.name && Number(e.elif) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(e.endDate || '') && e.endDate >= todayIso)
    .map((e, i) => ({
      id: String(e.id || `manual_ev_${i}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40),
      name: cleanText(e.name, 40),
      elif: Math.floor(Number(e.elif)),
      endDate: e.endDate,
      ...(isSafeHttpsUrl(e.sourceUrl) ? { sourceUrl: e.sourceUrl } : {})
    }));

  const schedules = (Array.isArray(raw.schedules) ? raw.schedules : [])
    .filter((s) => s && s.title && s.endAt && Date.parse(s.endAt) > Date.now())
    .slice(0, 15);

  const coupons = (Array.isArray(raw.coupons) ? raw.coupons : [])
    .filter((c) => c && isPlausibleCouponCode(String(c.code || '').toUpperCase()))
    .filter((c) => !c.expiresAt || Date.parse(c.expiresAt) > Date.now());

  return { notices, events, schedules, coupons };
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------
async function main() {
  const nowMs = Date.now();
  const seen = new Set();
  const notices = [];
  const failures = [];

  for (const board of OFFICIAL_BOARDS) {
    try {
      const json = await fetchJson(`${API_BASE}?boardId=${board.id}&limit=${board.limit}&offset=0`);
      const feeds = json && json.content && Array.isArray(json.content.feeds) ? json.content.feeds : null;
      if (!feeds) throw new Error('응답 형식이 예상과 다름 (content.feeds 없음)');
      for (const item of feeds) {
        // 게시판 ID가 바뀌었을 가능성 감지: 요청한 게시판과 응답 게시판이 다르면 경고
        if (item.board && item.board.boardId !== board.id) {
          throw new Error(`게시판 ID 불일치 (요청 ${board.id}, 응답 ${item.board.boardId})`);
        }
        const n = toNotice(item, board);
        if (n && !seen.has(n.id)) {
          seen.add(n.id);
          notices.push(n);
        }
      }
    } catch (e) {
      failures.push(`${board.name}(${board.id}): ${e.message}`);
    }
    await sleep(REQUEST_GAP_MS);
  }

  // 전부 실패하면 기존 파일을 덮어쓰지 않고 실패로 종료 → Actions가 메일로 알림
  if (notices.length === 0) {
    console.error('라운지 수집 실패:\n- ' + failures.join('\n- '));
    process.exit(1);
  }
  if (failures.length) console.warn('일부 게시판 수집 실패:\n- ' + failures.join('\n- '));

  const coupons = [];
  const seenCodes = new Set();
  for (const n of notices.filter((x) => x.category === '쿠폰')) {
    for (const c of extractCoupons(n, nowMs)) {
      if (!seenCodes.has(c.code)) {
        seenCodes.add(c.code);
        coupons.push(c);
      }
    }
  }

  const manual = await loadManual();
  for (const c of manual.coupons) {
    const code = String(c.code).toUpperCase();
    if (!seenCodes.has(code)) {
      seenCodes.add(code);
      coupons.push({ ...c, code });
    }
  }

  const loungeNotices = notices
    .sort((a, b) => (b.date === a.date ? Number(b.id) - Number(a.id) : b.date.localeCompare(a.date)))
    .map(({ _contents, ...rest }) => rest);
  const allNotices = [...manual.notices, ...loungeNotices].slice(0, MAX_NOTICES);

  const payload = {
    version: 1,
    source: 'naver-game-lounge',
    notices: allNotices,
    coupons: coupons.slice(0, 15),
    events: manual.events.slice(0, MAX_ITEMS),
    schedules: manual.schedules
  };

  // 내용이 같으면 저장하지 않음 (generatedAt만 바뀌는 커밋 방지)
  let previous = null;
  if (existsSync(OUTPUT_FILE)) {
    try {
      previous = JSON.parse(await readFile(OUTPUT_FILE, 'utf8'));
    } catch {
      previous = null;
    }
  }
  const strip = (o) => {
    if (!o) return null;
    const { generatedAt, ...rest } = o;
    return JSON.stringify(rest);
  };
  const changed = strip(previous) !== JSON.stringify(payload);
  const output = { generatedAt: new Date(nowMs).toISOString(), ...payload };

  console.log(
    `공지 ${allNotices.length}건 (라운지 ${loungeNotices.length} · 수동 ${manual.notices.length}) · 쿠폰 ${coupons.length}건 · 이벤트 ${payload.events.length}건 · 변경 ${changed ? '있음' : '없음'}`
  );

  if (DRY_RUN) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  if (changed) {
    await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n', 'utf8');
    console.log(`저장: ${path.relative(ROOT, OUTPUT_FILE)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
