// 브라우저(claude.ai 아티팩트) 버전 시작점
import { initStore, setHandlers } from './browser-store.js';
import { installFetch, initCapabilities, downloadFile } from './api.js';
import * as svc from '../rr/service.js';

(async () => {
  installFetch();
  setHandlers({
    remote: () => window.RR_REFRESH && window.RR_REFRESH(),
    status: (msg, err) => {
      const st = document.getElementById('saveState');
      if (st) st.textContent = ` · ${msg}`;
      if (err && window.RR_TOAST) window.RR_TOAST(msg, true);
    },
  });
  const [, ident] = await Promise.all([initStore(), initCapabilities()]);
  window.RR_IDENTITY = ident;
  window.RR_DOWNLOAD = async (id) => {
    try { await downloadFile(id); } catch (e) { window.RR_TOAST && window.RR_TOAST(e.message, true); }
  };
  try { svc.generate(); } catch (e) { console.error(e); }
  // 화면을 열어 둔 동안 1시간마다 주기 업무 생성
  setInterval(() => {
    try { const r = svc.generate(); if (r.created && window.RR_REFRESH) window.RR_REFRESH(); } catch (e) { console.error(e); }
  }, 60 * 60 * 1000);
  window.RR_START();
})();
