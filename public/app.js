/* K-IoT PLUS 업무관리 – 클라이언트 */
(() => {
  'use strict';

  // ---------- 공통 ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
  };
  const S = {
    meta: null, members: [], templates: [], user: '', ident: null,
    tplTab: '전체', tplSel: new Set(), calMonth: null, calSel: null, tkMonth: null, pMember: '', open: null,
  };

  function toast(msg, err) {
    $$('.toast').forEach((x) => x.remove());
    const t = document.createElement('div');
    t.className = `toast${err ? ' err' : ''}`;
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), err ? 4200 : 2200);
  }

  // 브라우저 기본 확인창 대신 화면 내 확인 창 (claude.ai 화면에서는 기본 확인창이 동작하지 않음)
  function ask(message, okLabel = '확인', danger = false) {
    return new Promise((resolve) => {
      const root = $('#confirmRoot');
      root.innerHTML = `<div class="overlay"><div class="modal ask" role="alertdialog" aria-modal="true">
        <div class="bd"><p class="ask-msg"></p></div>
        <div class="ft"><button class="btn" data-v="0">취소</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-v="1">${esc(okLabel)}</button></div></div></div>`;
      $('.ask-msg', root).textContent = message;
      const done = (v) => { root.innerHTML = ''; resolve(v); };
      $('.overlay', root).addEventListener('click', (e) => {
        const b = e.target.closest('button[data-v]');
        if (b) done(b.dataset.v === '1');
        else if (e.target.classList.contains('overlay')) done(false);
      });
      $('button[data-v="1"]', root).focus();
    });
  }

  async function api(method, url, body) {
    const opt = { method, headers: { 'x-rr-member': S.user || '' } };
    if (body instanceof FormData) opt.body = body;
    else if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const res = await fetch(`/api/rr${url}`, opt);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
    return data;
  }
  const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); return undefined; } };

  // 날짜 (YYYY-MM-DD 문자열)
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const pd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addD = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const today = () => S.meta?.today || ymd(new Date());
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const dotDate = (s) => (s ? s.replace(/-/g, '.') : '');
  const fmtDue = (s) => (s ? `${dotDate(s)} (${DOW[pd(s).getDay()]})` : '-');
  const monthRange = (ym) => { const [y, m] = ym.split('-').map(Number); return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))]; };
  const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const fmtTime = (iso) => { const d = new Date(iso); return `${dotDate(ymd(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

  const mName = (id) => S.members.find((m) => m.id === id)?.name || '(삭제됨)';
  const chips = (mains, subs) => `${(mains || []).map((id) => `<span class="chip main">★ ${esc(mName(id))}</span>`).join('')}${(subs || []).map((id) => `<span class="chip">${esc(mName(id))}</span>`).join('')}`;
  const pill = (st) => `<span class="pill st-${esc(st)}">${esc(st)}</span>`;
  const statusPills = (k) => `${pill(k.status)}${k.overdue ? ` ${pill('지연')}` : ''}`;
  const cycLabel = (c) => (c === '발생시' ? '발생 시' : c);
  const memberOptions = (sel, all = '전체 담당자') =>
    `${all !== null ? `<option value="">${esc(all)}</option>` : ''}${S.members.filter((m) => m.active !== false)
      .map((m) => `<option value="${esc(m.id)}"${m.id === sel ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}`;

  // 주기를 사람이 읽는 문장으로: "매월 말일 생성", "12월 기준 3개월마다 말일 생성"
  function describeCycle(t) {
    if (t.cycleType === '발생시' || !t.schedule) return '요청·이슈 발생 시 등록';
    const s = t.schedule;
    const d = pd(s.startDate);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === d.getDate();
    const dayTxt = last ? '말일' : `${d.getDate()}일`;
    const n = s.interval;
    let txt;
    if (s.unit === 'day') txt = n > 1 ? `${n}일마다` : (s.skipWeekends ? '매 영업일' : '매일');
    else if (s.unit === 'week') txt = `${n > 1 ? `${n}주마다` : '매주'} ${DOW[d.getDay()]}요일`;
    else if (s.unit === 'month') txt = `${n > 1 ? `${d.getMonth() + 1}월 기준 ${n}개월마다` : '매월'} ${dayTxt}`;
    else if (s.unit === 'quarter') txt = `${d.getMonth() + 1}월 기준 ${3 * n}개월마다 ${dayTxt}`;
    else txt = `${n > 1 ? `${n}년마다` : '매년'} ${d.getMonth() + 1}월 ${dayTxt}`;
    return `${txt} 생성${s.leadDays ? ` · ${s.leadDays}일 전 전달` : ''}`;
  }

  // ---------- 초기화·공통 데이터 ----------
  async function loadBase() {
    [S.meta, S.members, S.templates] = await Promise.all([api('GET', '/meta'), api('GET', '/members'), api('GET', '/templates')]);
  }
  const linkedMember = () => (S.ident?.id ? S.members.find((m) => m.userId === S.ident.id) : null);

  function resolveUser() {
    if (S.ident?.id) { S.user = linkedMember()?.id || ''; return; }
    const saved = LS.get('rr.user', '');
    S.user = S.members.some((m) => m.id === saved) ? saved : '';
  }

  function renderMe() {
    const box = $('#meBox');
    const store = S.meta?.storage ? `<span class="store">${esc({ db: '공유 저장소', local: '이 브라우저에 저장', none: '저장 안 됨' }[S.meta.storage] || '')}<span id="saveState"></span></span>` : '<span class="store" id="saveState"></span>';
    if (S.ident?.id) {
      const lm = linkedMember();
      box.innerHTML = `<span class="lbl">로그인</span><b></b><span class="em"></span>
        ${lm ? `<span class="hint" style="color:var(--side-muted)">담당자 · ${esc(lm.name)}</span><button class="link" id="meUnlink">연결 해제</button>` : '<button class="link" id="meLink">담당자 연결하기</button>'}${store}`;
      $('b', box).textContent = lm ? lm.name : '담당자 미연결';
      $('.em', box).textContent = S.ident.email || S.ident.name || '';
    } else {
      box.innerHTML = `<span class="lbl">사용자</span><select id="currentUser" aria-label="사용자 선택"><option value="">(선택)</option>${memberOptions(S.user, null)}</select>${store}`;
    }
  }

  function renderLinkBanner() {
    const b = $('#linkBanner');
    const need = S.ident?.id && !linkedMember();
    b.hidden = !need;
    if (need) b.innerHTML = '<span class="txt">로그인한 계정이 아직 담당자와 연결되지 않았습니다. 연결하면 내 업무만 바로 볼 수 있고, 처리 기록에 이름이 남습니다.</span><button class="btn" id="bannerLink">담당자 연결하기</button>';
  }

  function openLinkModal() {
    const myId = S.ident?.id;
    const rows = S.members.filter((m) => m.active !== false).map((m) => {
      const taken = m.userId && m.userId !== myId;
      return `<button class="dcard" data-mid="${esc(m.id)}"${taken && !S.ident.canEdit ? ' disabled' : ''}>
        <div class="top"><span class="t">${esc(m.name)}</span>${m.userId === myId ? '<span class="tag b-on">내 계정</span>' : taken ? '<span class="tag b-gray">다른 계정과 연결됨</span>' : ''}</div>
        <div class="p">${esc([m.title, m.role].filter(Boolean).join(' · ') || '담당자')}</div></button>`;
    }).join('');
    openModal(`<div class="hd"><h3>담당자 연결</h3><button class="x" data-close aria-label="닫기">×</button></div>
      <div class="bd"><p class="hint" style="margin-top:0">로그인한 계정(<span id="lkMe"></span>)과 연결할 담당자를 고르세요. 한 계정은 한 담당자에만 연결됩니다.</p>${rows}</div>`, 'narrow',
    (root, close) => {
      $('#lkMe', root).textContent = S.ident.email || S.ident.name || '현재 계정';
      root.addEventListener('click', safe(async (e) => {
        const b = e.target.closest('button[data-mid]');
        if (!b || b.disabled) return;
        await api('POST', `/members/${b.dataset.mid}/link`, { userId: myId });
        close();
        toast('담당자와 연결했습니다.');
        await reloadAll();
      }));
    });
  }

  let currentView = 'home';
  function show(view) {
    if (view === 'notifs') { toggleNotifs(); return; }
    currentView = view;
    $$('#nav button[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    $$('.view').forEach((v) => v.classList.toggle('on', v.id === `view-${view}`));
    LS.set('rr.view', view);
    S.open = null;
    refreshView();
    window.scrollTo(0, 0);
  }
  const refreshView = safe(async () => {
    if (currentView === 'home') await renderHome();
    if (currentView === 'templates') renderTemplates();
    if (currentView === 'tasks') await renderTasks();
    if (currentView === 'calendar') await renderCalendar();
    if (currentView === 'people') await renderPeople();
    if (currentView === 'settings') renderMembers();
  });
  async function reloadAll() {
    await loadBase();
    resolveUser();
    renderMe();
    renderLinkBanner();
    fillFilterSelects();
    await refreshView();
    refreshBell();
  }

  function fillFilterSelects() {
    const keep = (id, html, def = '') => { const el = $(id); const v = el.dataset.init ? el.value : def; el.innerHTML = html; el.value = v; if (el.value !== v) el.value = ''; el.dataset.init = '1'; };
    keep('#tplMember', memberOptions('', '담당자 전체'));
    keep('#tkCycle', `<option value="">주기 전체</option>${S.meta.cycleTypes.map((c) => `<option value="${esc(c)}">${esc(cycLabel(c))}</option>`).join('')}`);
    keep('#homeMember', memberOptions(''), S.user);
    keep('#tkMember', memberOptions(''));
    keep('#calMember', memberOptions(''));
  }

  // ---------- 업무 행 목록 (내 업무·업무 현황 공통) ----------
  function taskRows(list, { limit } = {}) {
    if (!list.length) return '<div class="empty">해당하는 업무가 없습니다.</div>';
    const shown = limit ? list.slice(0, limit) : list;
    const rows = shown.map((k) => {
      const open = S.open === k.id;
      const lastLog = [...(k.logs || [])].reverse().find((l) => !l.system);
      return `<div class="trow item${open ? ' open' : ''}" data-id="${esc(k.id)}" role="button" tabindex="0" aria-expanded="${open}">
          <div><div class="t-path">${esc(k.cat1)} › ${esc(k.cat2)}</div><div class="t-name">${esc(k.cat3)}</div></div>
          <div class="t-who">${chips(k.mains, k.subs)}</div>
          <div class="t-cyc">${esc(cycLabel(k.cycleType))}</div>
          <div class="t-due${k.overdue ? ' late' : ''}">${esc(fmtDue(k.dueDate))}</div>
          <div class="t-st">${statusPills(k)}</div>
          <button class="chev" tabindex="-1" aria-hidden="true">⌄</button>
        </div>${open ? `<div class="texp" data-for="${esc(k.id)}">
          <div><div class="d">${esc(k.detail || '상세 업무 및 산출물 없음')}</div>
            <div class="meta">발생일 ${esc(dotDate(k.plannedDate))}${k.virtual ? ` · 생성 예정 ${esc(dotDate(k.releaseDate))}` : ''}${k.files?.length ? ` · 첨부 ${k.files.length}개` : ''}${lastLog ? ` · 최근 현황: ${esc(lastLog.text.slice(0, 60))}` : ''}</div></div>
          <div class="acts">${k.virtual ? '<button class="btn sm" data-act="detail">상세 보기</button>'
          : `${k.status === '예정' ? '<button class="btn sm" data-act="doing">진행중으로</button>' : ''}${k.status !== '완료' ? '<button class="btn sm primary" data-act="done">완료 처리</button>' : '<button class="btn sm" data-act="reopen">다시 진행</button>'}<button class="btn sm" data-act="detail">처리 현황·파일</button>`}</div>
        </div>` : ''}`;
    }).join('');
    const more = limit && list.length > limit ? `<div class="more">외 ${list.length - limit}건 · <button class="btn sm ghost" data-goto="tasks">업무 현황에서 보기</button></div>` : '';
    return `<div class="tlist"><div class="trow head"><div>업무</div><div>담당자</div><div>주기</div><div>처리기한</div><div>상태</div><div></div></div>${rows}${more}</div>`;
  }
  let rowCache = new Map();
  function bindRowList(container, rerender) {
    container.addEventListener('click', safe(async (e) => {
      const go = e.target.closest('[data-goto]');
      if (go) { show(go.dataset.goto); return; }
      const actBtn = e.target.closest('.texp [data-act]');
      if (actBtn) {
        const id = actBtn.closest('.texp').dataset.for;
        const k = rowCache.get(id);
        const act = actBtn.dataset.act;
        if (act === 'detail') { openTask(id, k?.virtual ? k : null); return; }
        const status = { doing: '진행중', done: '완료', reopen: '진행중' }[act];
        await api('PUT', `/tasks/${id}`, { status });
        toast(status === '완료' ? '완료 처리했습니다.' : '진행중으로 바꿨습니다.');
        await rerender();
        refreshBell();
        return;
      }
      const row = e.target.closest('.trow.item');
      if (row) { S.open = S.open === row.dataset.id ? null : row.dataset.id; await rerender(); }
    }));
    container.addEventListener('keydown', (e) => {
      const row = e.target.closest('.trow.item');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); row.click(); }
    });
  }
  const remember = (list) => { for (const k of list) rowCache.set(k.id, k); return list; };

  // ---------- 내 업무 ----------
  async function renderHome() {
    const t = today();
    $('#homeDate').textContent = `${dotDate(t)} (${DOW[pd(t).getDay()]})`;
    const member = $('#homeMember').value;
    const role = $('#homeRole').value;
    $('#homeTitle').textContent = !member ? '전체 업무' : member === S.user ? '내 업무' : `${mName(member)} 업무`;
    const qs = (o) => new URLSearchParams({ member, role, ...o });
    const [all, planned] = await Promise.all([
      api('GET', `/tasks?${qs({})}`),
      api('GET', `/tasks?${qs({ from: t, to: addD(t, 30), includePlanned: '1', status: '계획' })}`),
    ]);
    remember(all); remember(planned);
    const open = all.filter((k) => k.status !== '완료');
    const late = open.filter((k) => k.overdue);
    const d = pd(t);
    const weekEnd = addD(t, (7 - d.getDay()) % 7);
    const todayList = open.filter((k) => !k.overdue && k.dueDate === t);
    const weekList = open.filter((k) => k.dueDate > t && k.dueDate <= weekEnd);
    const laterList = open.filter((k) => k.dueDate > weekEnd);
    const done14 = all.filter((k) => k.status === '완료' && k.completedAt && ymd(new Date(k.completedAt)) >= addD(t, -13));
    const kp = [
      ['지연', late.length, '지연', 'late'], ['계획', planned.length, '계획 (30일)', '계획'], ['예정', open.filter((k) => k.status === '예정').length, '예정', '예정'],
      ['진행중', open.filter((k) => k.status === '진행중').length, '진행 중', '진행중'], ['완료', done14.length, '완료 (최근 2주)', '완료'],
    ];
    $('#homeKpis').innerHTML = kp.map(([key, n, label, go]) => `<button class="kpi k-${key}" data-kpi="${esc(go)}"><span>${esc(label)}</span><b class="n">${n}</b></button>`).join('');
    const sec = (title, sub, list, limit) => `<div class="tablecard"><div class="th"><h3>${esc(title)} <small>${list.length}</small>${sub ? ` <small>${esc(sub)}</small>` : ''}</h3></div>${taskRows(list, { limit })}</div>`;
    $('#homeSections').innerHTML = [
      late.length ? sec('지연', '처리기한이 지난 업무', late) : '',
      sec('오늘 처리', '', todayList),
      sec(`이번 주 (~${dotDate(weekEnd).slice(5)})`, '', weekList),
      sec('이후 예정', '', laterList, 15),
    ].join('');
  }
  function bindHome() {
    ['#homeMember', '#homeRole'].forEach((s) => $(s).addEventListener('change', refreshView));
    bindRowList($('#homeSections'), renderHome);
    $('#homeKpis').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kpi]');
      if (!b) return;
      const k = b.dataset.kpi;
      $('#tkMember').value = $('#homeMember').value; $('#tkRole').value = $('#homeRole').value;
      $('#tkStatus').value = k === 'late' ? '지연' : k;
      S.tkMonth = today().slice(0, 7);
      show('tasks');
    });
    $('#homeNew').addEventListener('click', openNewTask);
    $('#linkBanner').addEventListener('click', (e) => { if (e.target.id === 'bannerLink') openLinkModal(); });
  }

  // ---------- 업무 표준 ----------
  function filteredTemplates() {
    const q = $('#tplSearch').value.trim();
    const mem = $('#tplMember').value;
    const st = $('#tplState').value;
    return S.templates.filter((t) => (S.tplTab === '전체' || t.cycleType === S.tplTab)
      && (!q || `${t.cat1} ${t.cat2} ${t.cat3} ${t.detail} ${t.note}`.includes(q))
      && (!mem || t.mains.includes(mem) || t.subs.includes(mem))
      && (!st || (st === 'review' ? t.needsReview : st === 'active' ? t.active && !t.needsReview : !t.active && !t.needsReview)));
  }
  function tplState(t) {
    if (t.needsReview) return '<span class="tag b-warn">기준일 확인 필요</span>';
    if (!t.active) return '<span class="tag b-gray">중지</span>';
    return '';
  }
  function renderTemplates() {
    const review = S.templates.filter((t) => t.needsReview).length;
    const nt = $('#tplNotice');
    nt.hidden = !review;
    if (review) nt.innerHTML = `<span class="txt"><b>기준일 확인 필요 ${review}건</b> — 엑셀에는 실행 날짜가 없어 제안값으로 채웠습니다. 기준일을 확인한 뒤 확정해야 업무가 생성됩니다.</span><button class="btn sm" id="tplShowReview">확인 필요 업무만 보기</button>`;
    const tabs = ['전체', ...S.meta.cycleTypes];
    $('#tplTabs').innerHTML = tabs.map((c) => {
      const n = c === '전체' ? S.templates.length : S.templates.filter((t) => t.cycleType === c).length;
      return `<button data-tab="${esc(c)}" class="${S.tplTab === c ? 'on' : ''}">${esc(cycLabel(c))}<span class="n">${n}</span></button>`;
    }).join('');
    const list = filteredTemplates();
    $('#tplCount').textContent = `${list.length}건`;
    for (const id of [...S.tplSel]) if (!S.templates.some((t) => t.id === id)) S.tplSel.delete(id);
    renderSelInfo();
    const groups = [];
    for (const t of list) {
      let g = groups.find((x) => x.name === t.cat1);
      if (!g) { g = { name: t.cat1, items: [] }; groups.push(g); }
      g.items.push(t);
    }
    $('#tplGroups').innerHTML = groups.map((g) => {
      let prev = '';
      const rows = g.items.map((t) => {
        const c2 = t.cat2 !== prev ? esc(t.cat2) : '';
        prev = t.cat2;
        const occ = t.cycleType === '발생시';
        return `<tr data-id="${esc(t.id)}">
          <td><input type="checkbox" class="tplChk" value="${esc(t.id)}"${S.tplSel.has(t.id) ? ' checked' : ''} aria-label="선택" /></td>
          <td class="c2">${c2}</td>
          <td><b>${esc(t.cat3)}</b>${t.automation && t.automation !== '-' ? ` <span class="tag b-gray" title="자동화 여부">${esc(t.automation)}</span>` : ''}</td>
          <td><div class="sub">${esc(t.detail)}</div>${t.note ? `<div class="sub">비고: ${esc(t.note)}</div>` : ''}</td>
          <td>${chips(t.mains, t.subs)}</td>
          <td><div class="cy">${esc(cycLabel(t.cycleType))}</div><div class="sub">${esc(occ ? '' : describeCycle(t))}</div>${tplState(t)}</td>
          <td class="acts"><button class="btn sm${occ ? ' primary' : ''}" data-act="occur">⚡ 업무 발생</button>
            <button class="btn sm ghost" data-act="edit">수정</button><button class="btn sm ghost danger" data-act="del">삭제</button></td></tr>`;
      }).join('');
      return `<div class="tablecard tgroup"><div class="th"><h3>${esc(g.name)}</h3><span class="count">${g.items.length}</span></div>
        <table class="grid"><thead><tr><th><input type="checkbox" class="grpChk" aria-label="이 분류 전체 선택" /></th><th>중분류</th><th>소분류</th><th>상세 업무 및 산출물</th><th>담당자</th><th>주기</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('') || '<div class="tablecard"><div class="empty">등록된 업무가 없습니다. [설정]에서 엑셀을 가져오거나 [새 업무 표준]을 눌러 주세요.</div></div>';
  }
  function renderSelInfo() {
    const el = $('#tplSel');
    el.hidden = !S.tplSel.size;
    el.innerHTML = `<span><b class="mono">${S.tplSel.size}</b>건 선택</span><button class="btn sm primary" id="tplActivate">확정(사용)</button><button class="btn sm" id="tplDeactivate">중지</button><button class="btn sm ghost" id="tplClear">선택 해제</button>`;
  }

  // 업무 표준 등록/수정 모달
  function memberPicker(name, selected, disabled = []) {
    return `<div class="picker" data-picker="${name}">${S.members.filter((m) => m.active !== false || selected.includes(m.id)).map((m) => {
      const on = selected.includes(m.id);
      const dis = disabled.includes(m.id);
      return `<label class="${on ? 'on' : ''}${dis ? ' dis' : ''}"><input type="checkbox" value="${esc(m.id)}"${on ? ' checked' : ''}${dis ? ' disabled' : ''} />${esc(m.name)}</label>`;
    }).join('')}</div>`;
  }
  const pickerValues = (root, name) => $$(`[data-picker="${name}"] input:checked`, root).map((i) => i.value);
  function bindPickers(root, onChange) {
    root.addEventListener('change', (e) => {
      const inp = e.target.closest('.picker input');
      if (!inp) return;
      inp.parentElement.classList.toggle('on', inp.checked);
      onChange?.();
    });
  }
  function syncMainSub(root) {
    const mains = pickerValues(root, 'mains');
    $$('[data-picker="subs"] input', root).forEach((i) => {
      const dis = mains.includes(i.value);
      if (dis) { i.checked = false; i.parentElement.classList.remove('on'); }
      i.disabled = dis;
      i.parentElement.classList.toggle('dis', dis);
    });
  }

  function openModal(html, cls, onMount) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="overlay"><div class="modal ${cls || ''}" role="dialog" aria-modal="true">${html}</div></div>`;
    const ov = $('.overlay', root);
    const close = () => { root.innerHTML = ''; };
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    $$('[data-close]', root).forEach((b) => b.addEventListener('click', close));
    onMount?.($('.modal', root), close);
  }

  function openTemplateForm(t) {
    const isNew = !t;
    const def = S.meta.cycleDefaults;
    t = t || { cycleType: S.tplTab !== '전체' ? S.tplTab : '발생시', mains: [], subs: [], active: true, cat1: '', cat2: '', cat3: '', detail: '', automation: '-', note: '' };
    const sch = t.schedule || { ...(def[t.cycleType] || def.매월), startDate: today(), endDate: '' };
    const cat1s = [...new Set(S.templates.map((x) => x.cat1))];
    const unitOpts = S.meta.units.map((u) => `<option value="${u}"${sch.unit === u ? ' selected' : ''}>${esc(S.meta.unitLabel[u])}</option>`).join('');
    openModal(`
      <div class="hd"><h3>${isNew ? '새 업무 표준' : '업무 표준 수정'}</h3><button class="x" data-close aria-label="닫기">×</button></div>
      <div class="bd"><div class="form">
        <label class="req">업무 구분</label>
        <div class="tabs cycletabs" id="fCycle">${S.meta.cycleTypes.map((c) => `<button type="button" data-c="${esc(c)}" class="${t.cycleType === c ? 'on' : ''}">${esc(cycLabel(c))}</button>`).join('')}</div>
        <label class="req" for="fCat1">대분류</label><div><input type="text" id="fCat1" list="dl1" value="${esc(t.cat1)}" /><datalist id="dl1">${cat1s.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
        <label class="req" for="fCat2">중분류</label><div><input type="text" id="fCat2" list="dl2" value="${esc(t.cat2)}" /><datalist id="dl2"></datalist></div>
        <label class="req" for="fCat3">소분류(업무명)</label><input type="text" id="fCat3" value="${esc(t.cat3)}" />
        <label for="fDetail">상세 업무 및 산출물</label><textarea id="fDetail" rows="2">${esc(t.detail)}</textarea>
        <label for="fAuto">자동화 여부</label><select id="fAuto">${['-', '◐', '●'].map((a) => `<option value="${a}"${t.automation === a ? ' selected' : ''}>${{ '-': '- 수동', '◐': '◐ 반자동화', '●': '● 자동화' }[a]}</option>`).join('')}</select>
        <label class="req">메인 담당자</label>${memberPicker('mains', t.mains)}
        <label>서브 담당자</label>${memberPicker('subs', t.subs, t.mains)}
        <label for="fNote">비고</label><input type="text" id="fNote" value="${esc(t.note)}" />
        <div class="full schedbox" id="fSched">
          <div class="row"><b>반복 주기</b><span class="hint">기준일부터 선택한 주기마다 업무가 생성되어 담당자에게 전달됩니다.</span></div>
          <div class="row">
            <span class="hint">매</span><input type="number" id="fInterval" min="1" max="365" value="${esc(sch.interval)}" style="width:76px" aria-label="간격" />
            <select id="fUnit" aria-label="단위">${unitOpts}</select><span class="hint">마다</span>
            <label class="hint" for="fStart" style="margin-left:10px">기준일</label><input type="date" id="fStart" value="${esc(sch.startDate)}" />
            <label class="hint" for="fEnd">종료일(선택)</label><input type="date" id="fEnd" value="${esc(sch.endDate || '')}" />
          </div>
          <div class="row">
            <label class="hint" for="fLead">사전 생성</label><input type="number" id="fLead" min="0" max="365" value="${esc(sch.leadDays ?? 0)}" style="width:76px" /><span class="hint">일 전에 업무 생성·전달</span>
            <label class="hint" id="fWeekendWrap" style="margin-left:10px"><input type="checkbox" id="fWeekend"${sch.skipWeekends ? ' checked' : ''} /> 주말(토·일) 제외</label>
          </div>
          <div class="hint">기준일이 말일이면 매 회차 말일로 생성됩니다. 반기는 '2분기마다'로 설정합니다. 공휴일은 자동 제외되지 않습니다.</div>
          <div class="preview" id="fPreview"></div>
        </div>
        <label>사용 여부</label><label style="color:inherit"><input type="checkbox" id="fActive"${t.active || t.needsReview ? ' checked' : ''} /> 사용(확정) — 해제하면 업무가 생성되지 않습니다</label>
      </div></div>
      <div class="ft"><button class="btn" data-close>취소</button><button class="btn primary" id="fSave">저장</button></div>`, '',
    (root, close) => {
      let cycle = t.cycleType;
      const refreshCat2 = () => {
        const c1 = $('#fCat1', root).value;
        $('#dl2', root).innerHTML = [...new Set(S.templates.filter((x) => x.cat1 === c1).map((x) => x.cat2))].map((c) => `<option value="${esc(c)}">`).join('');
      };
      const readSched = () => ({
        unit: $('#fUnit', root).value, interval: Number($('#fInterval', root).value), startDate: $('#fStart', root).value,
        endDate: $('#fEnd', root).value, leadDays: Number($('#fLead', root).value), skipWeekends: $('#fWeekend', root).checked,
      });
      const preview = safe(async () => {
        $('#fSched', root).hidden = cycle === '발생시';
        $('#fWeekendWrap', root).hidden = $('#fUnit', root).value !== 'day';
        if (cycle === '발생시') return;
        const s = readSched();
        const r = await api('POST', '/schedule/preview', s);
        $('#fPreview', root).textContent = r.dates.length ? `${describeCycle({ cycleType: cycle, schedule: s })}  →  ${r.dates.map(dotDate).join(', ')} …` : '기준일·주기를 확인해 주세요.';
      });
      $('#fCycle', root).addEventListener('click', (e) => {
        const b = e.target.closest('button[data-c]');
        if (!b) return;
        cycle = b.dataset.c;
        $$('#fCycle button', root).forEach((x) => x.classList.toggle('on', x === b));
        const d = def[cycle];
        if (d) { $('#fUnit', root).value = d.unit; $('#fInterval', root).value = d.interval; $('#fLead', root).value = d.leadDays; $('#fWeekend', root).checked = d.skipWeekends; }
        preview();
      });
      $('#fCat1', root).addEventListener('input', refreshCat2);
      ['#fUnit', '#fInterval', '#fStart', '#fEnd', '#fWeekend', '#fLead'].forEach((s) => $(s, root).addEventListener('change', preview));
      bindPickers(root, () => syncMainSub(root));
      refreshCat2();
      preview();
      $('#fSave', root).addEventListener('click', safe(async () => {
        const body = {
          cycleType: cycle, cat1: $('#fCat1', root).value, cat2: $('#fCat2', root).value, cat3: $('#fCat3', root).value,
          detail: $('#fDetail', root).value, automation: $('#fAuto', root).value, note: $('#fNote', root).value,
          mains: pickerValues(root, 'mains'), subs: pickerValues(root, 'subs'), active: $('#fActive', root).checked,
        };
        if (cycle !== '발생시') body.schedule = readSched();
        if (isNew) await api('POST', '/templates', body); else await api('PUT', `/templates/${t.id}`, body);
        close();
        toast('저장했습니다.');
        await reloadAll();
      }));
    });
  }

  function openOccurForm(t) {
    openModal(`
      <div class="hd"><h3>업무 발생 등록</h3><button class="x" data-close aria-label="닫기">×</button></div>
      <div class="bd">
        <p class="hint" style="margin:0">${esc(t.cat1)} › ${esc(t.cat2)}</p><p style="margin:2px 0 14px"><b>${esc(t.cat3)}</b></p>
        <div class="form">
          <label>담당자</label><div>${chips(t.mains, t.subs)}</div>
          <label class="req" for="oDate">발생일</label><input type="date" id="oDate" value="${today()}" />
          <label class="req" for="oDue">처리기한</label><input type="date" id="oDue" value="${addD(today(), 7)}" />
          <label for="oMemo">요청 내용·메모</label><textarea id="oMemo" rows="3" placeholder="예) OO사업소 실사 요청 접수"></textarea>
        </div>
        <p class="hint">등록하면 메인·서브 담당자 알림으로 전달됩니다.</p>
      </div>
      <div class="ft"><button class="btn" data-close>취소</button><button class="btn primary" id="oSave">발생 등록</button></div>`, 'narrow',
    (root, close) => {
      $('#oSave', root).addEventListener('click', safe(async () => {
        const k = await api('POST', `/templates/${t.id}/occur`, { plannedDate: $('#oDate', root).value, dueDate: $('#oDue', root).value, memo: $('#oMemo', root).value });
        close();
        toast('업무를 등록하고 담당자에게 전달했습니다.');
        refreshBell();
        refreshView();
        openTask(k.id);
      }));
    });
  }

  // 새 업무: 업무 표준을 골라 발생 등록
  function openNewTask() {
    openModal(`<div class="hd"><h3>새 업무 — 업무 표준 선택</h3><button class="x" data-close aria-label="닫기">×</button></div>
      <div class="bd"><label class="search"><span aria-hidden="true">⌕</span><input type="text" id="npQ" placeholder="업무명·분류 검색" /></label>
      <div class="tplpick" id="npList"></div><p class="hint">목록에 없는 업무는 [업무 표준 → 새 업무 표준]으로 먼저 등록하세요.</p></div>`, 'narrow',
    (root, close) => {
      const draw = () => {
        const q = $('#npQ', root).value.trim();
        const list = S.templates.filter((t) => t.active && (!q || `${t.cat1} ${t.cat2} ${t.cat3}`.includes(q)))
          .sort((a, b) => (a.cycleType === '발생시' ? 0 : 1) - (b.cycleType === '발생시' ? 0 : 1));
        $('#npList', root).innerHTML = list.slice(0, 80).map((t) => `<button data-id="${esc(t.id)}"><b>${esc(t.cat3)}</b><small>${esc(t.cat1)} › ${esc(t.cat2)} · ${esc(cycLabel(t.cycleType))} · ${esc(t.mains.map(mName).join(', '))}</small></button>`).join('') || '<div class="empty">검색 결과가 없습니다.</div>';
      };
      $('#npQ', root).addEventListener('input', draw);
      $('#npList', root).addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (!b) return;
        close();
        openOccurForm(S.templates.find((t) => t.id === b.dataset.id));
      });
      draw();
      $('#npQ', root).focus();
    });
  }

  function bindTemplates() {
    $('#tplTabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) { S.tplTab = b.dataset.tab; renderTemplates(); } });
    ['#tplSearch', '#tplMember', '#tplState'].forEach((s) => $(s).addEventListener('input', renderTemplates));
    $('#tplNew').addEventListener('click', () => openTemplateForm(null));
    $('#genNow2').addEventListener('click', safe(async () => { const r = await api('POST', '/generate'); toast(`${dotDate(r.date)} 기준 ${r.created}건 생성했습니다.`); refreshBell(); }));
    $('#tplNotice').addEventListener('click', (e) => { if (e.target.id === 'tplShowReview') { S.tplTab = '전체'; $('#tplState').value = 'review'; renderTemplates(); } });
    $('#tplGroups').addEventListener('change', (e) => {
      if (e.target.classList.contains('tplChk')) { e.target.checked ? S.tplSel.add(e.target.value) : S.tplSel.delete(e.target.value); renderSelInfo(); }
      if (e.target.classList.contains('grpChk')) {
        $$('.tplChk', e.target.closest('.tgroup')).forEach((c) => { c.checked = e.target.checked; c.checked ? S.tplSel.add(c.value) : S.tplSel.delete(c.value); });
        renderSelInfo();
      }
    });
    $('#tplGroups').addEventListener('click', safe(async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const t = S.templates.find((x) => x.id === b.closest('tr').dataset.id);
      if (b.dataset.act === 'edit') openTemplateForm(t);
      if (b.dataset.act === 'occur') openOccurForm(t);
      if (b.dataset.act === 'del' && await ask(`'${t.cat3}' 업무 표준을 삭제할까요?\n이미 생성된 업무 기록은 유지됩니다.`, '삭제', true)) {
        await api('DELETE', `/templates/${t.id}`);
        toast('삭제했습니다.');
        await reloadAll();
      }
    }));
    $('#tplSel').addEventListener('click', safe(async (e) => {
      const id = e.target.id;
      if (id === 'tplClear') { S.tplSel.clear(); renderTemplates(); return; }
      if (id !== 'tplActivate' && id !== 'tplDeactivate') return;
      const active = id === 'tplActivate';
      const ids = [...S.tplSel];
      if (active && !await ask(`${ids.length}건을 확정(사용)합니다.\n주기 업무는 설정된 기준일·주기대로 업무가 생성되어 담당자에게 전달됩니다. 계속할까요?`, '확정')) return;
      const r = await api('POST', '/templates/bulk-active', { ids, active });
      S.tplSel.clear();
      toast(`${r.updated}건 ${active ? '확정' : '중지'}했습니다.`);
      await reloadAll();
    }));
  }

  // ---------- 업무 현황 ----------
  async function renderTasks() {
    if (!S.tkMonth) S.tkMonth = today().slice(0, 7);
    $('#tkMonth').textContent = S.tkMonth.replace('-', '.');
    const [from, to] = monthRange(S.tkMonth);
    const st = $('#tkStatus').value;
    const qs = new URLSearchParams({
      member: $('#tkMember').value, role: $('#tkRole').value, status: st === 'open' ? '' : st, cycleType: $('#tkCycle').value,
      from, to, text: $('#tkSearch').value.trim(),
    });
    let list = remember(await api('GET', `/tasks?${qs}`));
    if (st === 'open') list = list.filter((k) => k.status !== '완료');
    $('#tkCount').textContent = `${list.length}건`;
    $('#tkList').innerHTML = taskRows(list);
  }
  function bindTasks() {
    ['#tkMember', '#tkRole', '#tkStatus', '#tkCycle'].forEach((s) => $(s).addEventListener('change', refreshView));
    let timer;
    $('#tkSearch').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refreshView, 250); });
    $('#tkPrev').addEventListener('click', () => { S.tkMonth = shiftMonth(S.tkMonth, -1); refreshView(); });
    $('#tkNext').addEventListener('click', () => { S.tkMonth = shiftMonth(S.tkMonth, 1); refreshView(); });
    $('#tkNew').addEventListener('click', openNewTask);
    bindRowList($('#tkList'), renderTasks);
  }

  // ---------- 업무 상세(드로어) ----------
  function closeDrawer() { $('#drawerRoot').innerHTML = ''; }
  async function openTask(id, virtualItem) {
    const k = virtualItem || await api('GET', `/tasks/${id}`).catch((e) => { toast(e.message, true); return null; });
    if (!k) return;
    const root = $('#drawerRoot');
    const v = !!k.virtual;
    root.innerHTML = `<div class="drawer-wrap"><div class="drawer" role="dialog" aria-modal="true">
      <div class="hd"><div><div class="path">${esc(k.cat1)} › ${esc(k.cat2)}</div><h3>${esc(k.cat3)}</h3></div><button class="x" data-close aria-label="닫기">×</button></div>
      <div class="bd">
        <div class="row">${statusPills(k)} <span class="tag b-gray">${esc(cycLabel(k.cycleType))}</span></div>
        <dl class="kv">
          <dt>발생일</dt><dd class="mono">${esc(fmtDue(k.plannedDate))}</dd>
          ${v ? `<dt>생성 예정</dt><dd><span class="mono">${esc(fmtDue(k.releaseDate))}</span> — 이날 업무가 생성되어 담당자에게 전달됩니다</dd>` : ''}
          <dt>담당자</dt><dd>${chips(k.mains, k.subs) || '-'}</dd>
          <dt>상세·산출물</dt><dd>${esc(k.detail) || '-'}</dd>
        </dl>
        ${v ? '<p class="hint">아직 생성 전인 계획 업무입니다. 처리기한·현황·파일 입력은 업무가 생성된 뒤 할 수 있습니다.</p>' : `
        <div class="sec"><h4>처리 정보</h4>
          <div class="form" style="grid-template-columns:90px minmax(0,1fr)">
            <label for="dDue">처리기한</label><div class="row"><input type="date" id="dDue" value="${esc(k.dueDate)}" />${k.dueConfirmed ? '' : '<span class="hint">기본값(발생일) — 확인 후 저장해 주세요</span>'}</div>
            <label for="dStatus">상태</label><div class="row"><select id="dStatus">${['예정', '진행중', '완료'].map((s) => `<option${k.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
              <label><input type="checkbox" id="dDone"${k.status === '완료' ? ' checked' : ''} /> 완료</label>
              ${k.completedAt ? `<span class="hint mono">완료 ${esc(fmtTime(k.completedAt))}</span>` : ''}</div>
            <label>메인</label>${memberPicker('mains', k.mains)}
            <label>서브</label>${memberPicker('subs', k.subs, k.mains)}
          </div>
          <div style="margin-top:12px;text-align:right"><button class="btn primary" id="dSave">처리 정보 저장</button></div>
        </div>
        <div class="sec"><h4>처리 현황</h4>
          <ul class="timeline">${k.logs.map((l) => `<li class="${l.system ? 'sys' : ''}"><div class="meta">${esc(fmtTime(l.at))} · ${esc(l.authorId ? mName(l.authorId) : '시스템')}</div><div class="txt">${esc(l.text)}</div></li>`).join('') || '<li class="sys"><div class="txt">기록이 없습니다.</div></li>'}</ul>
          <textarea id="dLog" rows="3" placeholder="처리 현황을 입력하세요 (입력하면 '예정' → '진행중'으로 자동 전환)" aria-label="처리 현황"></textarea>
          <div style="margin-top:8px;text-align:right"><button class="btn primary" id="dLogAdd">현황 등록</button></div>
        </div>
        <div class="sec"><h4>첨부 파일</h4>
          <ul class="files">${k.files.map((f) => `<li>📄 <a href="/api/rr/files/${esc(f.id)}" data-file="${esc(f.id)}">${esc(f.name)}</a><small>${esc(fmtSize(f.size))} · ${esc(f.uploaderId ? mName(f.uploaderId) : '')} · ${esc(fmtTime(f.at))}</small><button class="btn sm ghost danger" data-del-file="${esc(f.id)}">삭제</button></li>`).join('') || '<li class="hint">첨부 파일이 없습니다.</li>'}</ul>
          <div class="row"><input type="file" id="dFiles" multiple aria-label="첨부 파일 선택" /><button class="btn" id="dUpload">업로드</button></div>
          <p class="hint">파일당 최대 ${esc(S.meta.maxFileMb)}MB, 한 번에 10개</p>
        </div>
        <div class="sec" style="text-align:right"><button class="btn danger" id="dDelete">업무 삭제</button></div>`}
      </div></div></div>`;
    const wrap = $('.drawer-wrap', root);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) closeDrawer(); });
    $('[data-close]', root).addEventListener('click', closeDrawer);
    if (v) return;
    const reopen = async () => { await openTask(k.id); refreshView(); refreshBell(); };
    if (!S.user) $('.bd', root).insertAdjacentHTML('afterbegin', `<div class="banner warn" style="margin-bottom:12px"><span class="txt">${S.ident?.id ? '담당자와 연결되지 않아 작성자가 기록되지 않습니다.' : '왼쪽 아래에서 사용자(본인)를 선택하면 작성자가 기록됩니다.'}</span></div>`);
    bindPickers(root, () => syncMainSub(root));
    $('#dDone', root).addEventListener('change', (e) => { $('#dStatus', root).value = e.target.checked ? '완료' : (k.status === '완료' ? '진행중' : k.status); });
    $('#dStatus', root).addEventListener('change', (e) => { $('#dDone', root).checked = e.target.value === '완료'; });
    $('#dSave', root).addEventListener('click', safe(async () => {
      await api('PUT', `/tasks/${k.id}`, { dueDate: $('#dDue', root).value, status: $('#dStatus', root).value, mains: pickerValues(root, 'mains'), subs: pickerValues(root, 'subs') });
      toast('저장했습니다.');
      await reopen();
    }));
    $('#dLogAdd', root).addEventListener('click', safe(async () => {
      await api('POST', `/tasks/${k.id}/logs`, { text: $('#dLog', root).value });
      toast('처리 현황을 등록했습니다.');
      await reopen();
    }));
    $('#dUpload', root).addEventListener('click', safe(async () => {
      const files = $('#dFiles', root).files;
      if (!files.length) { toast('파일을 선택해 주세요.', true); return; }
      const fd = new FormData();
      [...files].forEach((f) => fd.append('files', f));
      await api('POST', `/tasks/${k.id}/files`, fd);
      toast('업로드했습니다.');
      await reopen();
    }));
    $('.files', root).addEventListener('click', safe(async (e) => {
      const link = e.target.closest('a[data-file]');
      if (link && window.RR_DOWNLOAD) { e.preventDefault(); await window.RR_DOWNLOAD(link.dataset.file); return; }
      const b = e.target.closest('[data-del-file]');
      if (!b || !await ask('파일을 삭제할까요?', '삭제', true)) return;
      await api('DELETE', `/tasks/${k.id}/files/${b.dataset.delFile}`);
      await reopen();
    }));
    $('#dDelete', root).addEventListener('click', safe(async () => {
      if (!await ask('이 업무와 처리 현황·첨부 파일을 모두 삭제할까요? 되돌릴 수 없습니다.', '삭제', true)) return;
      await api('DELETE', `/tasks/${k.id}`);
      closeDrawer();
      toast('삭제했습니다.');
      refreshView();
    }));
  }

  // ---------- 캘린더 ----------
  const calVisible = { 계획: true, 예정: true, 진행중: true, 완료: true };
  let showLate = true;
  let calItems = [];
  const itemsOn = (d) => calItems.filter((k) => k.dueDate === d && calVisible[k.status]);
  async function renderCalendar() {
    if (!S.calMonth) S.calMonth = today().slice(0, 7);
    if (!S.calSel || S.calSel.slice(0, 7) !== S.calMonth) S.calSel = today().slice(0, 7) === S.calMonth ? today() : `${S.calMonth}-01`;
    const [y, m] = S.calMonth.split('-').map(Number);
    $('#calTitle').textContent = `${y}년 ${m}월`;
    const first = new Date(y, m - 1, 1);
    const start = addD(ymd(first), -first.getDay());
    const last = new Date(y, m, 0);
    const end = addD(ymd(last), 6 - last.getDay());
    calItems = remember(await api('GET', `/calendar?${new URLSearchParams({ from: start, to: end, member: $('#calMember').value })}`));
    const [mf, mt] = monthRange(S.calMonth);
    const inMonth = calItems.filter((k) => k.dueDate >= mf && k.dueDate <= mt);
    const cnt = (s) => inMonth.filter((k) => k.status === s).length;
    $('#calLegend').innerHTML = ['계획', '예정', '진행중', '완료'].map((s) => `<button class="st-${s}${calVisible[s] ? ' on' : ''}" data-st="${s}" aria-pressed="${calVisible[s]}">${s}<b>${cnt(s)}</b></button>`).join('')
      + `<button class="st-지연${showLate ? ' on' : ''}" data-late="1" aria-pressed="${showLate}">지연 표시<b>${inMonth.filter((k) => k.overdue).length}</b></button><span class="hint">· 처리기한 기준으로 표시됩니다</span>`;
    const order = { 지연: 0, 진행중: 1, 예정: 2, 계획: 3, 완료: 4 };
    let html = DOW.map((d, i) => `<div class="dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${d}</div>`).join('');
    for (let d = start; d <= end; d = addD(d, 1)) {
      const dt = pd(d);
      const items = itemsOn(d).sort((a, b) => order[a.overdue ? '지연' : a.status] - order[b.overdue ? '지연' : b.status]);
      const max = 3;
      const cls = ['day', dt.getMonth() !== m - 1 ? 'out' : '', d === today() ? 'today' : '', d === S.calSel ? 'sel' : '', dt.getDay() === 0 ? 'sun' : '', dt.getDay() === 6 ? 'sat' : ''].join(' ');
      html += `<div class="${cls}" data-day="${d}"><div class="dn">${dt.getDate()}</div>
        ${items.slice(0, max).map((k) => `<button class="ev st-${esc(k.status)}${showLate && k.overdue ? ' is-late' : ''}" data-id="${esc(k.id)}" title="[${esc(k.status)}${k.overdue ? '·지연' : ''}] ${esc(k.cat3)} — ${esc(k.mains.map(mName).join(', '))}">${esc(k.cat3)}</button>`).join('')}
        ${items.length > max ? `<div class="plus">+${items.length - max}건</div>` : ''}</div>`;
    }
    $('#cal').innerHTML = html;
    renderDaySide();
  }
  function renderDaySide() {
    const d = S.calSel;
    const items = itemsOn(d);
    $('#daySide').innerHTML = `<p class="eyebrow">SELECTED</p><h3>${esc(fmtDue(d))}</h3>${items.map((k) => `
      <button class="dcard" data-id="${esc(k.id)}"><div class="top"><span class="t">${esc(k.cat3)}</span>${statusPills(k)}</div>
      <div class="p">${esc(k.cat1)} › ${esc(k.cat2)} · ${esc(cycLabel(k.cycleType))}</div><div>${chips(k.mains, k.subs)}</div></button>`).join('') || '<p class="hint">이 날짜에 처리기한인 업무가 없습니다.</p>'}`;
  }
  function openCalItem(id) {
    const k = calItems.find((x) => x.id === id) || rowCache.get(id);
    if (k?.virtual) openTask(null, k); else openTask(id);
  }
  function bindCalendar() {
    $('#calPrev').addEventListener('click', () => { S.calMonth = shiftMonth(S.calMonth, -1); refreshView(); });
    $('#calNext').addEventListener('click', () => { S.calMonth = shiftMonth(S.calMonth, 1); refreshView(); });
    $('#calToday').addEventListener('click', () => { S.calMonth = today().slice(0, 7); S.calSel = today(); refreshView(); });
    $('#calMember').addEventListener('change', refreshView);
    $('#calLegend').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.late) showLate = !showLate; else calVisible[b.dataset.st] = !calVisible[b.dataset.st];
      refreshView();
    });
    $('#cal').addEventListener('click', (e) => {
      const ev = e.target.closest('.ev');
      if (ev) { openCalItem(ev.dataset.id); return; }
      const day = e.target.closest('.day');
      if (day) { S.calSel = day.dataset.day; $$('#cal .day').forEach((x) => x.classList.toggle('sel', x === day)); renderDaySide(); }
    });
    $('#daySide').addEventListener('click', (e) => { const c = e.target.closest('.dcard'); if (c) openCalItem(c.dataset.id); });
  }

  // ---------- 담당자별 현황 ----------
  function periodRange(p) {
    const t = pd(today());
    const y = t.getFullYear(); const m = t.getMonth();
    if (p === 'thisWeek') { const s = addD(today(), -((t.getDay() + 6) % 7)); return [s, addD(s, 6)]; }
    if (p === 'nextMonth') return [ymd(new Date(y, m + 1, 1)), ymd(new Date(y, m + 2, 0))];
    if (p === 'thisQuarter') { const q = Math.floor(m / 3) * 3; return [ymd(new Date(y, q, 1)), ymd(new Date(y, q + 3, 0))]; }
    return [ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))];
  }
  async function renderPeople() {
    const p = $('#pPeriod').value;
    if (p !== 'custom' || !$('#pFrom').value || !$('#pTo').value) { if (p !== 'custom') { const [a, b] = periodRange(p); $('#pFrom').value = a; $('#pTo').value = b; } }
    const from = $('#pFrom').value; const to = $('#pTo').value; const role = $('#pRole').value;
    const sum = await api('GET', `/summary?${new URLSearchParams({ from, to, role })}`);
    if (!S.pMember || !sum.some((s) => s.memberId === S.pMember)) S.pMember = S.user || sum[0]?.memberId || '';
    $('#pSummary').innerHTML = `<thead><tr><th>담당자</th><th>계획</th><th>예정</th><th>진행중</th><th>완료</th><th>지연</th><th>합계</th><th>완료율 (생성된 업무 기준)</th></tr></thead><tbody>${sum.map((s) => `
      <tr class="click${s.memberId === S.pMember ? ' sel' : ''}" data-id="${esc(s.memberId)}"><td><b>${esc(s.name)}</b>${s.memberId === S.user ? ' <span class="tag b-gray">나</span>' : ''}</td>
      <td class="num">${s.계획}</td><td class="num">${s.예정}</td><td class="num">${s.진행중}</td><td class="num">${s.완료}</td>
      <td class="num ${s.지연 ? 'late' : ''}">${s.지연}</td><td class="num">${s.total}</td>
      <td><div class="row" style="flex-wrap:nowrap"><div class="bar" style="flex:1"><i style="width:${s.doneRate ?? 0}%"></i></div><span class="mono hint">${s.doneRate == null ? '-' : `${s.doneRate}%`}</span></div></td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">담당자가 없습니다.</td></tr>'}</tbody>`;
    if (!S.pMember) { $('#pBoard').innerHTML = ''; $('#pKpis').innerHTML = ''; $('#pBoardTitle').textContent = ''; return; }
    const items = remember(await api('GET', `/tasks?${new URLSearchParams({ member: S.pMember, role, from, to, includePlanned: '1' })}`));
    const s = sum.find((x) => x.memberId === S.pMember);
    $('#pBoardTitle').textContent = `${mName(S.pMember)} · ${dotDate(from)} ~ ${dotDate(to)}`;
    $('#pKpis').innerHTML = [['지연', s.지연, '지연'], ['계획', s.계획, '계획'], ['예정', s.예정, '예정'], ['진행중', s.진행중, '진행 중'], ['완료', s.완료, '완료']]
      .map(([k, n, l]) => `<div class="kpi k-${k}"><span>${l}</span><b class="n">${n}</b></div>`).join('');
    $('#pBoard').innerHTML = ['계획', '예정', '진행중', '완료'].map((st) => {
      const col = items.filter((k) => k.status === st);
      return `<div class="col"><h4>${pill(st)}<small>${col.length}건</small></h4>${col.map((k) => `
        <button class="tcard${k.overdue ? ' is-late' : ''}" data-id="${esc(k.id)}"><div class="p">${esc(k.cat1)} › ${esc(k.cat2)}</div><div class="t">${esc(k.cat3)}</div>
        <div class="m"><span class="mono${k.overdue ? ' late' : ''}">${esc(fmtDue(k.dueDate))}${k.overdue ? ' 지연' : ''}</span><span>${k.mains.includes(S.pMember) ? '메인' : '서브'} · ${esc(cycLabel(k.cycleType))}</span></div></button>`).join('') || '<p class="hint">없음</p>'}</div>`;
    }).join('');
  }
  function bindPeople() {
    $('#pPeriod').addEventListener('change', refreshView);
    ['#pFrom', '#pTo'].forEach((s) => $(s).addEventListener('change', () => { $('#pPeriod').value = 'custom'; refreshView(); }));
    $('#pRole').addEventListener('change', refreshView);
    $('#pSummary').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) { S.pMember = tr.dataset.id; refreshView(); } });
    $('#pBoard').addEventListener('click', (e) => { const c = e.target.closest('.tcard'); if (c) openCalItem(c.dataset.id); });
  }

  // ---------- 설정 ----------
  function renderMembers() {
    const identOn = !!S.ident?.id;
    $('#mTable').innerHTML = `<thead><tr><th>성명</th><th>직책</th><th>주요 역할</th><th>메인 업무</th><th>서브 업무</th>${identOn ? '<th>계정 연결</th>' : ''}<th>상태</th><th></th></tr></thead><tbody>${S.members.map((m) => `
      <tr data-id="${esc(m.id)}"><td><input type="text" data-f="name" value="${esc(m.name)}" aria-label="성명" style="width:110px" /></td><td><input type="text" data-f="title" value="${esc(m.title)}" aria-label="직책" style="width:90px" /></td>
      <td><input type="text" data-f="role" value="${esc(m.role)}" aria-label="주요 역할" style="width:100%;min-width:180px" /></td>
      <td class="num">${S.templates.filter((t) => t.mains.includes(m.id)).length}</td><td class="num">${S.templates.filter((t) => t.subs.includes(m.id)).length}</td>
      ${identOn ? `<td>${m.userId ? `<span class="tag b-on">${m.userId === S.ident.id ? '내 계정' : '연결됨'}</span>${m.userId === S.ident.id || S.ident.canEdit ? ' <button class="btn sm ghost" data-act="unlink">해제</button>' : ''}` : '<span class="tag b-gray">미연결</span>'}</td>` : ''}
      <td>${m.active === false ? '<span class="tag b-gray">비활성</span>' : '<span class="tag b-on">활성</span>'}</td>
      <td class="acts"><button class="btn sm" data-act="save">저장</button> ${m.active === false ? '<button class="btn sm" data-act="on">활성화</button>' : '<button class="btn sm ghost danger" data-act="del">삭제</button>'}</td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">담당자가 없습니다. 엑셀을 가져오거나 직접 추가하세요.</td></tr>'}</tbody>`;
  }
  function bindSettings() {
    $('#xlsImport').addEventListener('click', safe(async () => {
      const f = $('#xlsFile').files[0];
      if (!f) { toast('엑셀 파일을 선택해 주세요.', true); return; }
      const fd = new FormData(); fd.append('file', f);
      const r = await api('POST', '/import', fd);
      $('#xlsResult').innerHTML = `<div class="result">시트: ${esc(r.sheet)} / 업무 ${r.total}건 — 신규 ${r.created} · 갱신 ${r.updated} · 변경없음 ${r.unchanged}
${r.addedMembers.length ? `추가된 담당자: ${esc(r.addedMembers.join(', '))}` : ''}
${r.warnings.length ? `확인 필요:\n- ${r.warnings.map(esc).join('\n- ')}` : '경고 없음'}
→ [업무 표준]에서 '기준일 확인 필요' 업무의 기준일을 확인한 뒤 확정(사용)하세요.</div>`;
      toast('가져오기를 완료했습니다.');
      await reloadAll();
    }));
    $('#mAdd').addEventListener('click', safe(async () => {
      await api('POST', '/members', { name: $('#mName').value, title: $('#mTitle').value, role: $('#mRole').value });
      $('#mName').value = ''; $('#mTitle').value = ''; $('#mRole').value = '';
      await reloadAll();
    }));
    $('#mTable').addEventListener('click', safe(async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const tr = b.closest('tr');
      const id = tr.dataset.id;
      if (b.dataset.act === 'save') {
        const body = {};
        $$('input[data-f]', tr).forEach((i) => { body[i.dataset.f] = i.value; });
        await api('PUT', `/members/${id}`, body);
        toast('저장했습니다.');
      }
      if (b.dataset.act === 'on') await api('PUT', `/members/${id}`, { active: true });
      if (b.dataset.act === 'unlink') { await api('POST', `/members/${id}/unlink`, {}); toast('계정 연결을 해제했습니다.'); }
      if (b.dataset.act === 'del') {
        if (!await ask('담당자를 삭제할까요? 업무에 지정된 경우 이력 보존을 위해 비활성화됩니다.', '삭제', true)) return;
        const r = await api('DELETE', `/members/${id}`);
        toast(r.deactivated ? '업무 이력이 있어 비활성화했습니다.' : '삭제했습니다.');
      }
      await reloadAll();
    }));
    $('#genNow').addEventListener('click', safe(async () => {
      const r = await api('POST', '/generate');
      $('#genResult').textContent = `${dotDate(r.date)} 기준 ${r.created}건 생성`;
      refreshBell();
    }));
  }

  // ---------- 왼쪽 아래 사용자 영역 ----------
  function bindMe() {
    $('#meBox').addEventListener('change', (e) => {
      if (e.target.id !== 'currentUser') return;
      S.user = e.target.value;
      LS.set('rr.user', S.user);
      $('#homeMember').value = S.user;
      S.pMember = S.user;
      refreshBell();
      refreshView();
    });
    $('#meBox').addEventListener('click', safe(async (e) => {
      if (e.target.id === 'meLink') openLinkModal();
      if (e.target.id === 'meUnlink' && await ask('이 계정과 담당자의 연결을 해제할까요?', '해제')) {
        await api('POST', `/members/${linkedMember().id}/unlink`, {});
        toast('연결을 해제했습니다.');
        await reloadAll();
      }
    }));
  }

  // ---------- 알림 ----------
  let notifs = [];
  const refreshBell = safe(async () => {
    if (!S.user) { $('#bellCnt').hidden = true; notifs = []; return; }
    notifs = await api('GET', `/notifications?member=${encodeURIComponent(S.user)}`);
    const n = notifs.filter((x) => !x.read).length;
    $('#bellCnt').hidden = !n;
    $('#bellCnt').textContent = n > 99 ? '99+' : n;
    if (!$('#notifPanel').hidden) renderNotifs();
  });
  function renderNotifs() {
    $('#notifPanel').innerHTML = `<div class="hd"><span>알림${S.user ? ` · ${esc(mName(S.user))}` : ''}</span><button class="btn sm" id="nAll">모두 읽음</button></div>
      ${!S.user ? `<div class="it">${S.ident?.id ? '담당자와 연결하면 알림을 받을 수 있습니다.' : '왼쪽 아래에서 사용자(본인)를 먼저 선택하세요.'}</div>` : notifs.map((n) => `<button class="it${n.read ? '' : ' unread'}" data-id="${esc(n.id)}" data-task="${esc(n.taskId)}">${esc(n.message)}<small>${esc(fmtTime(n.at))}</small></button>`).join('') || '<div class="it">알림이 없습니다.</div>'}`;
  }
  function toggleNotifs() {
    const p = $('#notifPanel');
    p.hidden = !p.hidden;
    if (!p.hidden) { renderNotifs(); refreshBell(); }
  }
  function bindBell() {
    document.addEventListener('click', (e) => { if (!e.target.closest('#notifPanel') && !e.target.closest('#bellBtn')) $('#notifPanel').hidden = true; });
    $('#notifPanel').addEventListener('click', safe(async (e) => {
      if (e.target.id === 'nAll') { await api('POST', '/notifications/read', { member: S.user }); await refreshBell(); return; }
      const it = e.target.closest('.it[data-id]');
      if (!it) return;
      await api('POST', '/notifications/read', { member: S.user, ids: [it.dataset.id] });
      $('#notifPanel').hidden = true;
      refreshBell();
      openTask(it.dataset.task);
    }));
    setInterval(refreshBell, 60000);
  }

  // ---------- 시작 ----------
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#confirmRoot').innerHTML) { $('#modalRoot').innerHTML = ''; closeDrawer(); $('#notifPanel').hidden = true; } });
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) show(b.dataset.view); });

  const boot = safe(async () => {
    S.ident = window.RR_IDENTITY || null;
    await loadBase();
    resolveUser();
    renderMe();
    renderLinkBanner();
    fillFilterSelects();
    bindHome(); bindTemplates(); bindTasks(); bindCalendar(); bindPeople(); bindSettings(); bindBell(); bindMe();
    const views = ['home', 'templates', 'tasks', 'calendar', 'people', 'settings'];
    const saved = LS.get('rr.view', 'home');
    show(S.members.length ? (views.includes(saved) ? saved : 'home') : 'settings');
    refreshBell();
  });
  // 다른 사람이 바꾼 내용이 들어오면 화면을 다시 그림 (공유 저장소 사용 시)
  window.RR_REFRESH = safe(async () => { await reloadAll(); });
  window.RR_TOAST = toast;
  // 브라우저 버전은 저장소·로그인 정보 준비 후 시작 (window.RR_DEFER)
  if (window.RR_DEFER) window.RR_START = boot; else boot();
})();
