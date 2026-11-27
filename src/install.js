// Getting the game onto the home screen, made easy for kids:
// - Android Chrome: one big button → the system install dialog
// - iPhone Safari: a picture guide pointing at the share button
// - Inside KakaoTalk / other app browsers (can't install there): a button that reopens the page in Chrome/Safari
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const inApp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|SamsungBrowser\/.*CrossApp/i.test(ua);
const standalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;

export function setupInstall() {
  const $ = (id) => document.getElementById(id);
  if (standalone()) return; // already an app: nothing to show
  const here = location.href.split('#')[0];

  if (inApp) {
    $('inapp-bar').hidden = false;
    // KakaoTalk can hand the page to the phone's real browser by itself: do it right away (once per visit)
    if (/KAKAOTALK/i.test(ua) && !sessionStorage.getItem('dk-ext')) {
      try { sessionStorage.setItem('dk-ext', '1'); } catch { /* ignore */ }
      setTimeout(() => { location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(here); }, 300);
    }
    if (isIOS && !/KAKAOTALK/i.test(ua)) $('inapp-desc').textContent = '여기서는 설치가 안 돼요. 오른쪽 아래(또는 위) ··· 메뉴에서 "Safari로 열기"를 눌러 주세요';
    $('inapp-btn').onclick = () => {
      if (/KAKAOTALK/i.test(ua)) location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(here);
      else if (isAndroid) location.href = 'intent://' + here.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
      else alert('··· 메뉴에서 "Safari로 열기"를 눌러 주세요');
    };
    return;
  }

  let deferred = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    $('install-btn').hidden = false;
  });
  addEventListener('appinstalled', () => { $('install-btn').hidden = true; });

  // Android: the first tap anywhere on the title screen pops the install dialog (browsers need one tap;
  // that's as automatic as it gets). If they say no, ask again at most once a day.
  const askedToday = () => { try { return localStorage.getItem('dk-install-asked') === new Date().toDateString(); } catch { return false; } };
  const autoAsk = async () => {
    if (!deferred || askedToday() || $('title-screen').hidden) return;
    try { localStorage.setItem('dk-install-asked', new Date().toDateString()); } catch { /* ignore */ }
    deferred.prompt();
    const r = await deferred.userChoice.catch(() => null);
    if (r && r.outcome === 'accepted') $('install-btn').hidden = true;
    deferred = null;
  };
  $('title-screen').addEventListener('pointerdown', autoAsk, { capture: true });

  // iPhone: no button (people already know "홈 화면에 추가"); the guide stays available if ever needed
  $('install-btn').onclick = async () => {
    if (deferred) {
      deferred.prompt();
      const r = await deferred.userChoice.catch(() => null);
      if (r && r.outcome === 'accepted') $('install-btn').hidden = true;
      deferred = null;
    } else if (isIOS) {
      $('ios-guide').hidden = false;
    } else {
      alert('브라우저 메뉴(⋮)에서 "앱 설치" 또는 "홈 화면에 추가"를 눌러 주세요');
    }
  };
  $('ios-ok').onclick = () => { $('ios-guide').hidden = true; };
  $('ios-guide').addEventListener('pointerdown', (e) => { if (e.target.id === 'ios-guide') $('ios-guide').hidden = true; });

  // a service worker makes the game installable (and start even with a weak connection)
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
}
