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
  const S = { meta: null, members: [], templates: [], user: '', tplTab: '전체', calMonth: null, pMember: '' };

  function toast(msg, err) {
    document.querySelectorAll('.toast').forEach((x) => x.remove()); // 겹침 방지
    const t = document.createElement('div');
    t.className = `toast${err ? ' err' : ''}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), err ? 4000 : 2200);
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

  // 날짜 (로컬 문자열 YYYY-MM-DD)
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const pd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addD = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const today = () => S.meta?.today || ymd(new Date());
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  const mName = (id) => S.members.find((m) => m.id === id)?.name || '(삭제됨)';
  const chips = (ids, main) => (ids || []).map((id) => `<span class="chip${main ? ' main' : ''}">${esc(mName(id))}</span>`).join('');
  const statusBadge = (k) => `<span class="badge st-${esc(k.status)}">${esc(k.status)}</span>${k.overdue ? ' <span class="badge st-지연">지연</span>' : ''}`;
  const memberOptions = (sel, { all = '전체', activeOnly = true } = {}) =>
    `${all !== null ? `<option value="">${esc(all)}</option>` : ''}${S.members.filter((m) => !activeOnly || m.active !== false)
      .map((m) => `<option value="${esc(m.id)}"${m.id === sel ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}`;

  // ---------- 초기화 ----------
  async function loadBase() {
    [S.meta, S.members, S.templates] = await Promise.all([api('GET', '/meta'), api('GET', '/members'), api('GET', '/templates')]);
  }

  function renderUserSelect() {
    const saved = LS.get('rr.user', '');
    S.user = S.members.some((m) => m.id === saved) ? saved : '';
    $('#currentUser').innerHTML = `<option value="">(선택)</option>${memberOptions(S.user, { all: null })}`;
  }

  let currentView = 'templates';
  function show(view) {
    currentView = view;
    $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    $$('.view').forEach((v) => v.classList.toggle('on', v.id === `view-${view}`));
    LS.set('rr.view', view);
    refreshView();
  }
  const refreshView = safe(async () => {
    if (currentView === 'templates') renderTemplates();
    if (currentView === 'tasks') await renderTasks();
    if (currentView === 'calendar') await renderCalendar();
    if (currentView === 'people') await renderPeople();
    if (currentView === 'settings') renderMembers();
  });
  async function reloadAll() {
    await loadBase();
    fillFilterSelects();
    await refreshView();
  }

  function fillFilterSelects() {
    const keep = (id, html) => { const el = $(id); const v = el.value; el.innerHTML = html; el.value = v; };
    keep('#tplMember', memberOptions('', { all: '담당자 전체' }));
    keep('#tplCat1', `<option value="">대분류 전체</option>${[...new Set(S.templates.map((t) => t.cat1))].map((c) => `<option>${esc(c)}</option>`).join('')}`);
    keep('#tkCycle', `<option value="">전체</option>${S.meta.cycleTypes.map((c) => `<option>${esc(c)}</option>`).join('')}`);
    for (const id of ['#tkMember', '#calMember']) {
      const el = $(id);
      const v = el.dataset.init ? el.value : S.user;
      el.innerHTML = memberOptions(v, { all: '전체' });
      el.value = v || '';
      el.dataset.init = '1';
    }
  }

  // ---------- ① 업무 표준 ----------
  function tplStateBadge(t) {
    if (t.needsReview) return '<span class="badge b-warn">기준일 확인 필요</span>';
    if (!t.active) return '<span class="badge b-gray">중지</span>';
    return '<span class="badge b-on">사용</span>';
  }
  function filteredTemplates() {
    const q = $('#tplSearch').value.trim();
    const c1 = $('#tplCat1').value;
    const mem = $('#tplMember').value;
    const st = $('#tplState').value;
    return S.templates.filter((t) => (S.tplTab === '전체' || t.cycleType === S.tplTab)
      && (!q || `${t.cat1} ${t.cat2} ${t.cat3} ${t.detail}`.includes(q))
      && (!c1 || t.cat1 === c1)
      && (!mem || t.mains.includes(mem) || t.subs.includes(mem))
      && (!st || (st === 'review' ? t.needsReview : st === 'active' ? t.active && !t.needsReview : !t.active && !t.needsReview)));
  }
  function renderTemplates() {
    const tabs = ['전체', ...S.meta.cycleTypes];
    $('#tplTabs').innerHTML = tabs.map((c) => {
      const n = c === '전체' ? S.templates.length : S.templates.filter((t) => t.cycleType === c).length;
      return `<button data-tab="${esc(c)}" class="${S.tplTab === c ? 'on' : ''}">${c === '발생시' ? '발생 시' : esc(c)}<span class="n">${n}</span></button>`;
    }).join('');
    const list = filteredTemplates();
    const rows = list.map((t) => `<tr data-id="${esc(t.id)}">
      <td><input type="checkbox" class="tplChk" value="${esc(t.id)}" /></td>
      <td class="c1">${esc(t.cat1)}</td><td class="c1">${esc(t.cat2)}</td>
      <td><b>${esc(t.cat3)}</b>${t.automation && t.automation !== '-' ? ` <span class="chip" title="자동화 여부">${esc(t.automation)}</span>` : ''}</td>
      <td><div class="sub">${esc(t.detail)}</div></td>
      <td>${chips(t.mains, true)}</td><td>${chips(t.subs)}</td>
      <td><span class="badge b-gray">${t.cycleType === '발생시' ? '발생 시' : esc(t.cycleType)}</span><div class="sub" style="white-space:pre-line">${t.cycleType === '발생시' ? '' : esc(t.scheduleText.replace(' · ', '\n'))}</div></td>
      <td>${tplStateBadge(t)}${t.note ? `<div class="sub">${esc(t.note)}</div>` : ''}</td>
      <td style="white-space:nowrap">
        <button class="btn sm" data-act="edit">수정</button>
        <button class="btn sm" data-act="occur" title="이 업무를 지금 발생시켜 담당자에게 전달">발생 등록</button>
        <button class="btn sm danger" data-act="del">삭제</button>
      </td></tr>`).join('');
    $('#tplTable').innerHTML = `<thead><tr><th><input type="checkbox" id="tplAll" /></th><th>대분류</th><th>중분류</th><th>소분류</th><th>상세 업무 및 산출물</th><th>메인</th><th>서브</th><th>업무구분 · 주기</th><th>상태 · 비고</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="10" class="empty">등록된 업무가 없습니다. [⚙ 기준정보]에서 엑셀을 가져오거나 [+ 업무 등록]을 눌러 주세요.</td></tr>'}</tbody>`;
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
    // 메인으로 선택한 사람은 서브에서 선택할 수 없게
    const mains = pickerValues(root, 'mains');
    $$('[data-picker="subs"] input', root).forEach((i) => {
      const dis = mains.includes(i.value);
      if (dis) { i.checked = false; i.parentElement.classList.remove('on'); }
      i.disabled = dis;
      i.parentElement.classList.toggle('dis', dis);
    });
  }

  function openModal(html, onMount) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="overlay"><div class="modal">${html}</div></div>`;
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
      <div class="hd"><h3>${isNew ? '업무 등록' : '업무 수정'}</h3><button class="x" data-close>×</button></div>
      <div class="bd"><div class="form">
        <label class="req">업무 구분</label>
        <div class="tabs" id="fCycle" style="margin:0">${S.meta.cycleTypes.map((c) => `<button type="button" data-c="${esc(c)}" class="${t.cycleType === c ? 'on' : ''}">${c === '발생시' ? '발생 시' : esc(c)}</button>`).join('')}</div>
        <label class="req">대분류</label><div><input type="text" id="fCat1" list="dl1" value="${esc(t.cat1)}" /><datalist id="dl1">${cat1s.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
        <label class="req">중분류</label><div><input type="text" id="fCat2" list="dl2" value="${esc(t.cat2)}" /><datalist id="dl2"></datalist></div>
        <label class="req">소분류(업무명)</label><input type="text" id="fCat3" value="${esc(t.cat3)}" />
        <label>상세 업무 및 산출물</label><textarea id="fDetail" rows="2">${esc(t.detail)}</textarea>
        <label>자동화 여부</label><select id="fAuto">${['-', '◐', '●'].map((a) => `<option value="${a}"${t.automation === a ? ' selected' : ''}>${{ '-': '- 수동', '◐': '◐ 반자동화', '●': '● 자동화' }[a]}</option>`).join('')}</select>
        <label class="req">메인 담당자</label>${memberPicker('mains', t.mains)}
        <label>서브 담당자</label>${memberPicker('subs', t.subs, t.mains)}
        <label>비고</label><input type="text" id="fNote" value="${esc(t.note)}" />
        <div class="full schedbox" id="fSched">
          <div class="row" style="margin-bottom:8px"><b>반복 주기</b><span class="hint">기준일부터 선택한 주기마다 업무가 생성되어 담당자에게 전달됩니다.</span></div>
          <div class="row">
            <label class="hint">매</label><input type="number" id="fInterval" min="1" max="365" value="${esc(sch.interval)}" style="width:70px" />
            <select id="fUnit">${unitOpts}</select><span class="hint">마다</span>
            <label class="hint" style="margin-left:12px">기준일</label><input type="date" id="fStart" value="${esc(sch.startDate)}" />
            <label class="hint">종료일(선택)</label><input type="date" id="fEnd" value="${esc(sch.endDate || '')}" />
          </div>
          <div class="row" style="margin-top:8px">
            <label class="hint">사전 생성</label><input type="number" id="fLead" min="0" max="365" value="${esc(sch.leadDays ?? 0)}" style="width:70px" /><span class="hint">일 전에 업무 생성·전달</span>
            <label class="hint" id="fWeekendWrap" style="margin-left:12px"><input type="checkbox" id="fWeekend"${sch.skipWeekends ? ' checked' : ''} /> 주말(토·일) 제외</label>
          </div>
          <div class="hint" style="margin-top:6px">※ 기준일이 말일이면 매 회차 말일로 생성됩니다. 반기는 '2분기마다'로 설정합니다. 공휴일은 자동 제외되지 않습니다.</div>
          <div class="preview" id="fPreview"></div>
        </div>
        <label>사용 여부</label><label style="color:inherit"><input type="checkbox" id="fActive"${t.active || t.needsReview ? ' checked' : ''} /> 사용(확정) — 체크 해제 시 업무가 생성되지 않습니다</label>
      </div></div>
      <div class="ft"><button class="btn" data-close>취소</button><button class="btn primary" id="fSave">저장</button></div>`,
    (root, close) => {
      let cycle = t.cycleType;
      const refreshCat2 = () => {
        const c1 = $('#fCat1', root).value;
        $('#dl2', root).innerHTML = [...new Set(S.templates.filter((x) => x.cat1 === c1).map((x) => x.cat2))].map((c) => `<option value="${esc(c)}">`).join('');
      };
      const preview = safe(async () => {
        const box = $('#fSched', root);
        box.style.display = cycle === '발생시' ? 'none' : '';
        $('#fWeekendWrap', root).style.display = $('#fUnit', root).value === 'day' ? '' : 'none';
        if (cycle === '발생시') return;
        const r = await api('POST', '/schedule/preview', {
          unit: $('#fUnit', root).value, interval: Number($('#fInterval', root).value), startDate: $('#fStart', root).value,
          endDate: $('#fEnd', root).value, skipWeekends: $('#fWeekend', root).checked,
        });
        $('#fPreview', root).textContent = r.dates.length ? `생성 예정일: ${r.dates.join(', ')} …` : '기준일·주기를 확인해 주세요.';
      });
      $('#fCycle', root).addEventListener('click', (e) => {
        const b = e.target.closest('button[data-c]');
        if (!b) return;
        cycle = b.dataset.c;
        $$('#fCycle button', root).forEach((x) => x.classList.toggle('on', x === b));
        const d = def[cycle];
        if (d) { // 업무 구분에 맞는 기본 주기 적용
          $('#fUnit', root).value = d.unit; $('#fInterval', root).value = d.interval;
          $('#fLead', root).value = d.leadDays; $('#fWeekend', root).checked = d.skipWeekends;
        }
        preview();
      });
      $('#fCat1', root).addEventListener('input', refreshCat2);
      ['#fUnit', '#fInterval', '#fStart', '#fEnd', '#fWeekend'].forEach((s) => $(s, root).addEventListener('change', preview));
      bindPickers(root, () => syncMainSub(root));
      refreshCat2();
      preview();
      $('#fSave', root).addEventListener('click', safe(async () => {
        const body = {
          cycleType: cycle, cat1: $('#fCat1', root).value, cat2: $('#fCat2', root).value, cat3: $('#fCat3', root).value,
          detail: $('#fDetail', root).value, automation: $('#fAuto', root).value, note: $('#fNote', root).value,
          mains: pickerValues(root, 'mains'), subs: pickerValues(root, 'subs'), active: $('#fActive', root).checked,
        };
        if (cycle !== '발생시') {
          body.schedule = {
            unit: $('#fUnit', root).value, interval: Number($('#fInterval', root).value), startDate: $('#fStart', root).value,
            endDate: $('#fEnd', root).value, leadDays: Number($('#fLead', root).value), skipWeekends: $('#fWeekend', root).checked,
          };
        }
        if (isNew) await api('POST', '/templates', body); else await api('PUT', `/templates/${t.id}`, body);
        close();
        toast('저장했습니다.');
        await reloadAll();
        refreshBell();
      }));
    });
  }

  function openOccurForm(t) {
    openModal(`
      <div class="hd"><h3>업무 발생 등록</h3><button class="x" data-close>×</button></div>
      <div class="bd">
        <p class="hint">${esc(t.cat1)} › ${esc(t.cat2)}</p><p><b>${esc(t.cat3)}</b></p>
        <div class="form">
          <label>담당자</label><div>${chips(t.mains, true)} ${chips(t.subs)}</div>
          <label class="req">발생일</label><input type="date" id="oDate" value="${today()}" />
          <label class="req">처리기한</label><input type="date" id="oDue" value="${addD(today(), 7)}" />
          <label>요청 내용·메모</label><textarea id="oMemo" rows="3" placeholder="예) OO사업소 실사 요청 접수"></textarea>
        </div>
        <p class="hint">등록하면 메인·서브 담당자 알림함으로 전달됩니다.</p>
      </div>
      <div class="ft"><button class="btn" data-close>취소</button><button class="btn primary" id="oSave">발생 등록</button></div>`,
    (root, close) => {
      $('#oSave', root).addEventListener('click', safe(async () => {
        const k = await api('POST', `/templates/${t.id}/occur`, { plannedDate: $('#oDate', root).value, dueDate: $('#oDue', root).value, memo: $('#oMemo', root).value });
        close();
        toast('업무를 등록하고 담당자에게 전달했습니다.');
        refreshBell();
        openTask(k.id);
      }));
    });
  }

  function bindTemplates() {
    $('#tplTabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (b) { S.tplTab = b.dataset.tab; renderTemplates(); }
    });
    ['#tplSearch', '#tplCat1', '#tplMember', '#tplState'].forEach((s) => $(s).addEventListener('input', renderTemplates));
    $('#tplNew').addEventListener('click', () => openTemplateForm(null));
    $('#tplTable').addEventListener('click', safe(async (e) => {
      if (e.target.id === 'tplAll') { $$('.tplChk').forEach((c) => { c.checked = e.target.checked; }); return; }
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const t = S.templates.find((x) => x.id === b.closest('tr').dataset.id);
      if (b.dataset.act === 'edit') openTemplateForm(t);
      if (b.dataset.act === 'occur') openOccurForm(t);
      if (b.dataset.act === 'del' && confirm(`'${t.cat3}' 업무 표준을 삭제할까요?\n이미 생성된 업무 기록은 유지됩니다.`)) {
        await api('DELETE', `/templates/${t.id}`);
        toast('삭제했습니다.');
        await reloadAll();
      }
    }));
    const bulk = (active) => safe(async () => {
      const ids = $$('.tplChk:checked').map((c) => c.value);
      if (!ids.length) { toast('업무를 선택해 주세요.', true); return; }
      if (active && !confirm(`${ids.length}건을 확정(사용)합니다.\n주기 업무는 설정된 기준일·주기대로 업무가 생성되어 담당자에게 전달됩니다. 계속할까요?`)) return;
      const r = await api('POST', '/templates/bulk-active', { ids, active });
      toast(`${r.updated}건 ${active ? '확정' : '중지'}했습니다.`);
      await reloadAll();
      refreshBell();
    });
    $('#tplActivate').addEventListener('click', bulk(true));
    $('#tplDeactivate').addEventListener('click', bulk(false));
  }

  // ---------- ② 업무 처리 ----------
  async function renderTasks() {
    const st = $('#tkStatus').value;
    const qs = new URLSearchParams({
      member: $('#tkMember').value, role: $('#tkRole').value, status: st === 'open' ? '' : st, cycleType: $('#tkCycle').value,
      from: $('#tkFrom').value, to: $('#tkTo').value, text: $('#tkSearch').value.trim(),
    });
    let list = await api('GET', `/tasks?${qs}`);
    if (st === 'open') list = list.filter((k) => k.status !== '완료');
    const rows = list.map((k) => {
      const last = [...k.logs].reverse().find((l) => !l.system);
      return `<tr class="click" data-id="${esc(k.id)}">
        <td>${statusBadge(k)}</td>
        <td class="${k.overdue ? 'late' : ''}" style="white-space:nowrap">${esc(k.dueDate)}${k.dueConfirmed ? '' : ' <span class="hint" title="담당자가 처리기한을 아직 확정하지 않음">(기본값)</span>'}</td>
        <td><span class="badge b-gray">${k.cycleType === '발생시' ? '발생 시' : esc(k.cycleType)}</span></td>
        <td><div class="sub">${esc(k.cat1)} › ${esc(k.cat2)}</div><b>${esc(k.cat3)}</b></td>
        <td>${chips(k.mains, true)}</td><td>${chips(k.subs)}</td>
        <td style="text-align:center">${k.files.length ? `📎${k.files.length}` : ''}</td>
        <td><div class="sub">${last ? esc(last.text.slice(0, 60)) : ''}</div></td></tr>`;
    }).join('');
    $('#tkTable').innerHTML = `<thead><tr><th>상태</th><th>처리기한</th><th>구분</th><th>업무</th><th>메인</th><th>서브</th><th>첨부</th><th>최근 처리 현황</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="empty">조건에 맞는 업무가 없습니다.</td></tr>'}</tbody>`;
  }
  function bindTasks() {
    ['#tkMember', '#tkRole', '#tkStatus', '#tkCycle', '#tkFrom', '#tkTo'].forEach((s) => $(s).addEventListener('change', refreshView));
    let timer;
    $('#tkSearch').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refreshView, 250); });
    $('#tkReset').addEventListener('click', () => {
      $('#tkMember').value = S.user; $('#tkRole').value = ''; $('#tkStatus').value = 'open'; $('#tkCycle').value = '';
      $('#tkFrom').value = ''; $('#tkTo').value = ''; $('#tkSearch').value = '';
      refreshView();
    });
    $('#tkTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openTask(tr.dataset.id); });
  }

  // ---------- 업무 상세(드로어) ----------
  const fmtTime = (iso) => { const d = new Date(iso); return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

  function closeDrawer() { $('#drawerRoot').innerHTML = ''; }
  async function openTask(id, virtualItem) {
    const k = virtualItem || await api('GET', `/tasks/${id}`).catch((e) => { toast(e.message, true); return null; });
    if (!k) return;
    const root = $('#drawerRoot');
    const v = !!k.virtual;
    root.innerHTML = `<div class="drawer-wrap"><div class="drawer">
      <div class="hd"><div><div class="path">${esc(k.cat1)} › ${esc(k.cat2)}</div><h3>${esc(k.cat3)}</h3></div><button class="x" data-close>×</button></div>
      <div class="bd">
        <div>${statusBadge(k)} <span class="badge b-gray">${k.cycleType === '발생시' ? '발생 시' : esc(k.cycleType)}</span></div>
        <dl class="kv">
          <dt>발생일</dt><dd>${esc(k.plannedDate)}</dd>
          ${v ? `<dt>생성 예정</dt><dd>${esc(k.releaseDate)} (이날 업무가 생성되어 담당자에게 전달됩니다)</dd>` : ''}
          <dt>메인</dt><dd>${chips(k.mains, true) || '-'}</dd>
          <dt>서브</dt><dd>${chips(k.subs) || '-'}</dd>
          <dt>상세·산출물</dt><dd>${esc(k.detail) || '-'}</dd>
        </dl>
        ${v ? '<p class="hint">아직 생성 전인 계획 업무입니다. 처리기한·현황·파일 입력은 업무가 생성된 뒤 가능합니다.</p>' : `
        <div class="sec"><h4>처리 정보</h4>
          <div class="form" style="grid-template-columns:90px 1fr">
            <label>처리기한</label><div class="row"><input type="date" id="dDue" value="${esc(k.dueDate)}" />${k.dueConfirmed ? '' : '<span class="hint">기본값(발생일) — 확인 후 저장해 주세요</span>'}</div>
            <label>상태</label><div class="row"><select id="dStatus">${['예정', '진행중', '완료'].map((s) => `<option${k.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
              <label><input type="checkbox" id="dDone"${k.status === '완료' ? ' checked' : ''} /> 완료</label>
              ${k.completedAt ? `<span class="hint">완료 ${esc(fmtTime(k.completedAt))}</span>` : ''}</div>
            <label>메인</label>${memberPicker('mains', k.mains)}
            <label>서브</label>${memberPicker('subs', k.subs, k.mains)}
          </div>
          <div style="margin-top:10px;text-align:right"><button class="btn primary" id="dSave">처리 정보 저장</button></div>
        </div>
        <div class="sec"><h4>처리 현황</h4>
          <ul class="timeline">${k.logs.map((l) => `<li class="${l.system ? 'sys' : ''}"><div class="meta">${esc(fmtTime(l.at))} · ${esc(l.authorId ? mName(l.authorId) : '시스템')}</div><div class="txt">${esc(l.text)}</div></li>`).join('') || '<li class="sys"><div class="txt">기록이 없습니다.</div></li>'}</ul>
          <textarea id="dLog" rows="3" placeholder="처리 현황을 입력하세요 (입력 시 '예정' → '진행중' 자동 전환)"></textarea>
          <div style="margin-top:6px;text-align:right"><button class="btn primary" id="dLogAdd">현황 등록</button></div>
        </div>
        <div class="sec"><h4>첨부 파일</h4>
          <ul class="files">${k.files.map((f) => `<li>📄 <a href="/api/rr/files/${esc(f.id)}">${esc(f.name)}</a><small>${esc(fmtSize(f.size))} · ${esc(f.uploaderId ? mName(f.uploaderId) : '')} · ${esc(fmtTime(f.at))}</small><button class="btn sm danger" data-del-file="${esc(f.id)}">삭제</button></li>`).join('') || '<li class="hint">첨부 파일이 없습니다.</li>'}</ul>
          <div class="row"><input type="file" id="dFiles" multiple /><button class="btn" id="dUpload">업로드</button><span class="hint">파일당 최대 ${esc(S.meta.maxFileMb)}MB, 한 번에 10개</span></div>
        </div>
        <div class="sec" style="text-align:right"><button class="btn danger" id="dDelete">업무 삭제</button></div>`}
      </div></div></div>`;
    const wrap = $('.drawer-wrap', root);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) closeDrawer(); });
    $('[data-close]', root).addEventListener('click', closeDrawer);
    if (v) return;
    const reopen = async () => { await openTask(k.id); refreshView(); refreshBell(); };
    if (!S.user) $('.bd', root).insertAdjacentHTML('afterbegin', '<p class="badge b-warn" style="display:block;margin-bottom:10px">상단에서 사용자(본인)를 선택하면 작성자가 기록됩니다.</p>');
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
      const b = e.target.closest('[data-del-file]');
      if (!b || !confirm('파일을 삭제할까요?')) return;
      await api('DELETE', `/tasks/${k.id}/files/${b.dataset.delFile}`);
      await reopen();
    }));
    $('#dDelete', root).addEventListener('click', safe(async () => {
      if (!confirm('이 업무와 처리 현황·첨부 파일을 모두 삭제할까요? 되돌릴 수 없습니다.')) return;
      await api('DELETE', `/tasks/${k.id}`);
      closeDrawer();
      toast('삭제했습니다.');
      refreshView();
    }));
  }

  // ---------- ③ 달력 ----------
  const calVisible = { 계획: true, 예정: true, 진행중: true, 완료: true };
  let calItems = [];
  async function renderCalendar() {
    if (!S.calMonth) S.calMonth = today().slice(0, 7);
    const [y, m] = S.calMonth.split('-').map(Number);
    $('#calTitle').textContent = `${y}년 ${m}월`;
    const first = new Date(y, m - 1, 1);
    const start = addD(ymd(first), -first.getDay());
    const last = new Date(y, m, 0);
    const end = addD(ymd(last), 6 - last.getDay());
    $('#calLegend').innerHTML = ['계획', '예정', '진행중', '완료'].map((s) => `<label><input type="checkbox" data-st="${s}"${calVisible[s] ? ' checked' : ''} /><span class="badge st-${s}">${s}</span></label>`).join('')
      + '<span class="badge st-지연">지연</span>';
    const qs = new URLSearchParams({ from: start, to: end, member: $('#calMember').value, role: $('#calRole').value });
    calItems = await api('GET', `/calendar?${qs}`);
    const byDay = {};
    for (const k of calItems) if (calVisible[k.status]) (byDay[k.dueDate] ||= []).push(k);
    const order = { 지연: 0, 진행중: 1, 예정: 2, 계획: 3, 완료: 4 };
    let html = DOW.map((d, i) => `<div class="dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${d}</div>`).join('');
    for (let d = start; d <= end; d = addD(d, 1)) {
      const dt = pd(d);
      const items = (byDay[d] || []).sort((a, b) => order[a.overdue ? '지연' : a.status] - order[b.overdue ? '지연' : b.status]);
      const max = 4;
      const cls = ['day', dt.getMonth() !== m - 1 ? 'out' : '', d === today() ? 'today' : '', dt.getDay() === 0 ? 'sun' : '', dt.getDay() === 6 ? 'sat' : ''].join(' ');
      html += `<div class="${cls}" data-day="${d}"><div class="dn">${dt.getDate()}</div>
        ${items.slice(0, max).map((k) => `<button class="ev st-${esc(k.status)}${k.overdue ? ' is-late' : ''}" data-id="${esc(k.id)}" title="[${esc(k.status)}${k.overdue ? '·지연' : ''}] ${esc(k.cat3)} — ${esc(k.mains.map(mName).join(', '))}">${esc(k.cat3)}</button>`).join('')}
        ${items.length > max ? `<button class="more" data-more="${d}">+${items.length - max}건 더보기</button>` : ''}</div>`;
    }
    $('#cal').innerHTML = html;
  }
  function openDayList(d) {
    const items = calItems.filter((k) => k.dueDate === d && calVisible[k.status]);
    openModal(`<div class="hd"><h3>${esc(d)} 업무 (${items.length}건)</h3><button class="x" data-close>×</button></div>
      <div class="bd"><table class="grid">${items.map((k) => `<tr class="click" data-id="${esc(k.id)}"><td>${statusBadge(k)}</td><td><div class="sub">${esc(k.cat1)} › ${esc(k.cat2)}</div><b>${esc(k.cat3)}</b></td><td>${chips(k.mains, true)}${chips(k.subs)}</td></tr>`).join('')}</table></div>`,
    (root, close) => root.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) { close(); openCalItem(tr.dataset.id); }
    }));
  }
  function openCalItem(id) {
    const k = calItems.find((x) => x.id === id);
    if (k?.virtual) openTask(null, k); else openTask(id);
  }
  function bindCalendar() {
    const move = (n) => { const [y, m] = S.calMonth.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); S.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; refreshView(); };
    $('#calPrev').addEventListener('click', () => move(-1));
    $('#calNext').addEventListener('click', () => move(1));
    $('#calToday').addEventListener('click', () => { S.calMonth = today().slice(0, 7); refreshView(); });
    ['#calMember', '#calRole'].forEach((s) => $(s).addEventListener('change', refreshView));
    $('#calLegend').addEventListener('change', (e) => { const st = e.target.dataset.st; if (st) { calVisible[st] = e.target.checked; refreshView(); } });
    $('#cal').addEventListener('click', (e) => {
      const ev = e.target.closest('.ev');
      if (ev) { openCalItem(ev.dataset.id); return; }
      const more = e.target.closest('[data-more]');
      if (more) openDayList(more.dataset.more);
    });
  }

  // ---------- ④ 개인별 현황 ----------
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
    if (p !== 'custom' || !$('#pFrom').value || !$('#pTo').value) {
      if (p !== 'custom') { const [a, b] = periodRange(p); $('#pFrom').value = a; $('#pTo').value = b; }
    }
    const from = $('#pFrom').value; const to = $('#pTo').value; const role = $('#pRole').value;
    const sum = await api('GET', `/summary?${new URLSearchParams({ from, to, role })}`);
    if (!S.pMember || !sum.some((s) => s.memberId === S.pMember)) S.pMember = S.user || sum[0]?.memberId || '';
    $('#pSummary').innerHTML = `<thead><tr><th>담당자</th><th>계획</th><th>예정</th><th>진행중</th><th>완료</th><th>지연</th><th>합계</th><th>완료율 (생성된 업무 기준)</th></tr></thead><tbody>${sum.map((s) => `
      <tr class="click${s.memberId === S.pMember ? ' sel' : ''}" data-id="${esc(s.memberId)}"><td><b>${esc(s.name)}</b></td>
      <td class="num">${s.계획}</td><td class="num">${s.예정}</td><td class="num">${s.진행중}</td><td class="num">${s.완료}</td>
      <td class="num ${s.지연 ? 'late' : ''}">${s.지연}</td><td class="num">${s.total}</td>
      <td><div class="row"><div class="bar" style="flex:1"><i style="width:${s.doneRate ?? 0}%"></i></div><span class="hint">${s.doneRate == null ? '-' : `${s.doneRate}%`}</span></div></td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">담당자가 없습니다.</td></tr>'}</tbody>`;
    if (!S.pMember) { $('#pBoard').innerHTML = ''; $('#pKpis').innerHTML = ''; $('#pBoardTitle').textContent = ''; return; }
    const items = await api('GET', `/tasks?${new URLSearchParams({ member: S.pMember, role, from, to, includePlanned: '1' })}`);
    calItems = items; // 상세 열기용
    const s = sum.find((x) => x.memberId === S.pMember);
    $('#pBoardTitle').textContent = `${mName(S.pMember)} — ${from} ~ ${to}`;
    $('#pKpis').innerHTML = [['계획', s.계획], ['예정', s.예정], ['진행중', s.진행중], ['완료', s.완료], ['지연', s.지연], ['완료율', s.doneRate == null ? '-' : `${s.doneRate}%`]]
      .map(([l, n]) => `<div class="kpi"><span class="badge st-${l}">${l}</span><b class="${l === '지연' && n ? 'late' : ''}">${n}</b></div>`).join('');
    $('#pBoard').innerHTML = ['계획', '예정', '진행중', '완료'].map((st) => {
      const col = items.filter((k) => k.status === st);
      return `<div class="col"><h4><span class="badge st-${st}">${st}</span><span class="hint">${col.length}건</span></h4>${col.map((k) => `
        <div class="tcard${k.overdue ? ' is-late' : ''}" data-id="${esc(k.id)}"><div class="p">${esc(k.cat1)} › ${esc(k.cat2)}</div><div class="t">${esc(k.cat3)}</div>
        <div class="m"><span class="${k.overdue ? 'late' : ''}">기한 ${esc(k.dueDate)}${k.overdue ? ' (지연)' : ''}</span><span>${k.mains.includes(S.pMember) ? '메인' : '서브'} · ${k.cycleType === '발생시' ? '발생 시' : esc(k.cycleType)}</span></div></div>`).join('') || '<p class="hint">없음</p>'}</div>`;
    }).join('');
  }
  function bindPeople() {
    $('#pPeriod').addEventListener('change', refreshView);
    ['#pFrom', '#pTo'].forEach((s) => $(s).addEventListener('change', () => { $('#pPeriod').value = 'custom'; refreshView(); }));
    $('#pRole').addEventListener('change', refreshView);
    $('#pSummary').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) { S.pMember = tr.dataset.id; refreshView(); } });
    $('#pBoard').addEventListener('click', (e) => { const c = e.target.closest('.tcard'); if (c) openCalItem(c.dataset.id); });
  }

  // ---------- ⚙ 기준정보 ----------
  function renderMembers() {
    $('#mTable').innerHTML = `<thead><tr><th>성명</th><th>직책</th><th>주요 역할</th><th>메인 업무</th><th>서브 업무</th><th>상태</th><th></th></tr></thead><tbody>${S.members.map((m) => `
      <tr data-id="${esc(m.id)}"><td><input type="text" data-f="name" value="${esc(m.name)}" /></td><td><input type="text" data-f="title" value="${esc(m.title)}" style="width:90px" /></td>
      <td><input type="text" data-f="role" value="${esc(m.role)}" style="width:100%" /></td>
      <td class="num">${S.templates.filter((t) => t.mains.includes(m.id)).length}</td><td class="num">${S.templates.filter((t) => t.subs.includes(m.id)).length}</td>
      <td>${m.active === false ? '<span class="badge b-gray">비활성</span>' : '<span class="badge b-on">활성</span>'}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-act="save">저장</button> ${m.active === false ? '<button class="btn sm" data-act="on">활성화</button>' : '<button class="btn sm danger" data-act="del">삭제</button>'}</td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">담당자가 없습니다. 엑셀을 가져오거나 직접 추가하세요.</td></tr>'}</tbody>`;
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
→ [① 업무 표준]에서 '기준일 확인 필요' 업무의 기준일을 확인한 뒤 확정(사용)하세요.</div>`;
      toast('가져오기를 완료했습니다.');
      await reloadAll();
      renderUserSelect();
    }));
    $('#mAdd').addEventListener('click', safe(async () => {
      await api('POST', '/members', { name: $('#mName').value, title: $('#mTitle').value, role: $('#mRole').value });
      $('#mName').value = ''; $('#mTitle').value = ''; $('#mRole').value = '';
      await reloadAll(); renderUserSelect();
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
      if (b.dataset.act === 'del') {
        if (!confirm('담당자를 삭제할까요? 업무에 지정된 경우 이력 보존을 위해 비활성화됩니다.')) return;
        const r = await api('DELETE', `/members/${id}`);
        toast(r.deactivated ? '업무 이력이 있어 비활성화했습니다.' : '삭제했습니다.');
      }
      await reloadAll(); renderUserSelect();
    }));
    $('#genNow').addEventListener('click', safe(async () => {
      const r = await api('POST', '/generate');
      $('#genResult').textContent = `${r.date} 기준 ${r.created}건 생성`;
      refreshBell();
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
    $('#notifPanel').innerHTML = `<div class="hd"><span>알림 ${S.user ? `· ${esc(mName(S.user))}` : ''}</span><button class="btn sm" id="nAll">모두 읽음</button></div>
      ${!S.user ? '<div class="it">상단에서 사용자(본인)를 먼저 선택하세요.</div>' : notifs.map((n) => `<div class="it${n.read ? '' : ' unread'}" data-id="${esc(n.id)}" data-task="${esc(n.taskId)}">${esc(n.message)}<small>${esc(fmtTime(n.at))}</small></div>`).join('') || '<div class="it">알림이 없습니다.</div>'}`;
  }
  function bindBell() {
    $('#bellBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const p = $('#notifPanel');
      p.hidden = !p.hidden;
      if (!p.hidden) { renderNotifs(); refreshBell(); }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#notifPanel')) $('#notifPanel').hidden = true; });
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#modalRoot').innerHTML = ''; closeDrawer(); } });
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) show(b.dataset.view); });
  $('#currentUser').addEventListener('change', (e) => {
    S.user = e.target.value;
    LS.set('rr.user', S.user);
    $('#tkMember').value = S.user; $('#calMember').value = S.user; S.pMember = S.user;
    refreshBell();
    refreshView();
  });

  safe(async () => {
    await loadBase();
    renderUserSelect();
    fillFilterSelects();
    $('#tkStatus').value = 'open';
    bindTemplates(); bindTasks(); bindCalendar(); bindPeople(); bindSettings(); bindBell();
    show(S.members.length ? LS.get('rr.view', 'templates') : 'settings');
    refreshBell();
  })();
})();
