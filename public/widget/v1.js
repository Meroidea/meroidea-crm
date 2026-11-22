/*
 * Meroidea live chat loader (ADR-072). A business adds to its site:
 *
 *   <script src="https://<meroidea>/widget/v1.js" data-key="<widget key>" async></script>
 *
 * Optionally, before it, who a signed-in visitor is, signed on the business's own server with the
 * widget's identity secret (HMAC-SHA256 of the lower-case email, hex):
 *
 *   <script>window.meroideaChat = { identity: { email, name, signature } };</script>
 *
 * or later: window.MeroideaChat.identify({ email, name, signature }).
 *
 * The chat itself runs in a frame served by Meroidea, which only the sites listed for the widget
 * may show. This file only draws the button, opens and closes the frame, and passes messages.
 */
(function () {
  'use strict';
  if (window.MeroideaChat && window.MeroideaChat.loaded) return;

  var script =
    document.currentScript || document.querySelector('script[src*="/widget/v1.js"][data-key]');
  if (!script) return;
  var key = script.getAttribute('data-key') || '';
  if (!/^[A-Za-z0-9_-]{24}$/.test(key)) return;
  var origin = new URL(script.src, window.location.href).origin;
  var color = script.getAttribute('data-color') || '#111827';
  if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) color = '#111827';
  var label = script.getAttribute('data-label') || 'Chat with us';
  var activeKey = 'meroidea-chat-active:' + key;

  var settings = window.meroideaChat || {};
  var identity = settings.identity || null;
  var frame = null;
  var ready = false;
  var open = false;

  function remembered() {
    try {
      return window.localStorage.getItem(activeKey) === '1';
    } catch {
      return false;
    }
  }
  function remember() {
    try {
      window.localStorage.setItem(activeKey, '1');
    } catch {
      /* storage blocked */
    }
  }

  function post(message) {
    if (!frame || !ready || !frame.contentWindow) return;
    message.source = 'meroidea-chat-loader';
    frame.contentWindow.postMessage(message, origin);
  }

  var button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-expanded', 'false');
  button.style.cssText =
    'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483000;width:56px;height:56px;' +
    'border-radius:50%;background:' +
    color +
    ';color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
    'box-shadow:0 6px 20px rgba(0,0,0,.25);';
  var chatIcon =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var closeIcon =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  button.innerHTML = chatIcon;

  var badge = document.createElement('span');
  badge.style.cssText =
    'all:initial;position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;padding:0 5px;' +
    'box-sizing:border-box;border-radius:10px;background:#dc2626;color:#fff;font:600 12px/20px ' +
    'system-ui,sans-serif;text-align:center;display:none;';
  button.appendChild(badge);

  function frameStyle() {
    var small = window.innerWidth < 480;
    return (
      'position:fixed;z-index:2147483001;border:0;background:#fff;color-scheme:normal;' +
      (small
        ? 'inset:0;width:100%;height:100%;border-radius:0;'
        : 'right:16px;bottom:84px;width:370px;height:min(600px,calc(100vh - 104px));' +
          'border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);') +
      (open ? 'display:block;' : 'display:none;')
    );
  }

  function ensureFrame() {
    if (frame) return;
    frame = document.createElement('iframe');
    frame.title = label;
    frame.src = origin + '/chat/' + encodeURIComponent(key) + '?embed=1';
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.style.cssText = frameStyle();
    document.body.appendChild(frame);
  }

  function setOpen(next) {
    open = next;
    if (open) ensureFrame();
    if (frame) frame.style.cssText = frameStyle();
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.innerHTML = open ? closeIcon : chatIcon;
    button.appendChild(badge);
    // On a phone the chat fills the screen and has its own close button.
    button.style.display = open && window.innerWidth < 480 ? 'none' : 'flex';
    post({ type: open ? 'open' : 'close' });
  }

  button.addEventListener('click', function () {
    setOpen(!open);
  });
  window.addEventListener('resize', function () {
    if (frame) frame.style.cssText = frameStyle();
  });

  window.addEventListener('message', function (event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== origin) return;
    var data = event.data || {};
    if (data.source !== 'meroidea-chat') return;
    if (data.type === 'ready') {
      ready = true;
      if (identity) post({ type: 'identify', identity: identity });
      post({ type: open ? 'open' : 'close' });
    } else if (data.type === 'close') {
      setOpen(false);
    } else if (data.type === 'active') {
      remember();
    } else if (data.type === 'unread') {
      var count = Number(data.count) || 0;
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.style.display = count > 0 && !open ? 'block' : 'none';
    }
  });

  window.MeroideaChat = {
    loaded: true,
    open: function () {
      setOpen(true);
    },
    close: function () {
      setOpen(false);
    },
    identify: function (next) {
      identity = next || null;
      if (identity) post({ type: 'identify', identity: identity });
    },
  };

  function mount() {
    document.body.appendChild(button);
    // Someone already chatting gets the frame straight away, so replies show on the button.
    if (remembered()) ensureFrame();
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
