// Вход в WebView на soundcloud.com/signin с мобильным Chrome UA (без «wv»). Скрипт ловит токен из
// Authorization у api-v2 и api-mobile, cookie oauth_token и client_id из window.__sc_hydration.

export const LOGIN_SCRIPT = `(function () {
  if (window.__scwHook) return;
  window.__scwHook = true;
  var clientId = null, lastKey = '';
  function post(token) {
    if (!token) return;
    var key = token + '|' + clientId;
    if (key === lastKey) return;
    lastKey = key;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'auth', token: token, clientId: clientId }));
  }
  function bearer(value) {
    var m = /^OAuth\\s+(\\S+)$/i.exec(String(value || '').trim());
    return m ? m[1] : null;
  }
  function look(url, auth) {
    try {
      var c = /[?&]client_id=([A-Za-z0-9]+)/.exec(String(url));
      if (c) clientId = c[1];
    } catch (e) {}
    post(bearer(auth));
  }
  var nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/api(-v2|-mobile)?\\.soundcloud\\.com/.test(url)) {
          var h = (init && init.headers) || (input && input.headers);
          var auth = null;
          if (h) auth = typeof h.get === 'function' ? h.get('Authorization') : (h.Authorization || h.authorization);
          look(url, auth);
        }
      } catch (e) {}
      return nativeFetch.apply(this, arguments);
    };
  }
  var open = XMLHttpRequest.prototype.open, setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__scwUrl = url;
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (/^authorization$/i.test(name) && /api(-v2|-mobile)?\\.soundcloud\\.com/.test(String(this.__scwUrl))) look(this.__scwUrl, value);
    } catch (e) {}
    return setHeader.apply(this, arguments);
  };
  setInterval(function () {
    try {
      var h = window.__sc_hydration;
      if (!clientId && Array.isArray(h)) {
        for (var i = 0; i < h.length; i++) if (h[i] && h[i].hydratable === 'apiClient' && h[i].data) clientId = h[i].data.id || clientId;
      }
      var m = /(?:^|;\\s*)oauth_token=([^;]+)/.exec(document.cookie);
      if (m) post(decodeURIComponent(m[1]));
    } catch (e) {}
  }, 1500);
})(); true;`;
