/*
 * Balas.id live chat widget.
 * Embed on any website:
 *   <script src="https://app.domainanda.com/widget.js" data-key="WIDGET_KEY"
 *           data-api="https://api.domainanda.com" async></script>
 * Messages go to the Balas.id inbox; replies come back by polling.
 */
(function () {
  "use strict";
  var script = document.currentScript || document.querySelector("script[data-key][src*='widget.js']");
  if (!script || window.__balasWidget) return;
  window.__balasWidget = true;

  var KEY = script.getAttribute("data-key");
  var API = (script.getAttribute("data-api") || "").replace(/\/$/, "") + "/functions/v1/webchat";
  var STORE = "balas_chat_" + KEY;
  var OPEN_POLL_MS = 3000;
  var CLOSED_POLL_MS = 15000;

  var state = { config: null, visitor: null, last: null, open: false, unread: 0, seen: {}, timer: null, sending: false };

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORE) || "null");
    } catch (e) {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ visitor: state.visitor }));
    } catch (e) {
      /* private mode: the chat lasts for this page view */
    }
  }

  function api(action, body) {
    var payload = Object.assign({ action: action, key: KEY }, body || {});
    if (state.visitor) {
      payload.visitor_id = state.visitor.visitor_id;
      payload.secret = state.visitor.secret;
    }
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "Gagal");
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  // ---------------------------------------------------------------- UI
  var host = document.createElement("div");
  host.setAttribute("data-balas-widget", "");
  host.style.display = "none"; // shown once the widget's settings are loaded
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  document.body.appendChild(host);

  var css =
    ":host{all:initial}" +
    "*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
    ".btn{position:fixed;right:20px;bottom:20px;height:56px;min-width:56px;padding:0 18px;border-radius:28px;border:0;cursor:pointer;" +
    "color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;gap:8px;z-index:2147483646;" +
    "font-size:15px;font-weight:600;transition:transform .15s ease,box-shadow .15s ease}" +
    ".btn:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(0,0,0,.3)}" +
    ".btn svg{width:26px;height:26px;flex-shrink:0}" +
    ".btn .lbl:empty{display:none}.btn.open .lbl{display:none}.btn.open{padding:0;width:56px}" +
    ".left .btn,.left.btn{right:auto;left:20px}.left.panel{right:auto;left:20px}" +
    ".badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;border-radius:10px;background:#ef4444;color:#fff;" +
    "font-size:12px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 5px}" +
    ".panel{position:fixed;right:20px;bottom:88px;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 110px);" +
    "background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;z-index:2147483647}" +
    ".panel.open{display:flex}" +
    ".head{padding:14px 16px;color:#fff;display:flex;align-items:center;justify-content:space-between}" +
    ".head b{font-size:15px}.head small{display:block;font-size:12px;opacity:.85}" +
    ".x{background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}" +
    ".body{flex:1;overflow-y:auto;padding:12px;background:#f3f4f6;display:flex;flex-direction:column;gap:8px}" +
    ".msg{max-width:80%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}" +
    ".msg.agent{align-self:flex-start;background:#fff;color:#111;border-bottom-left-radius:4px}" +
    ".msg.visitor{align-self:flex-end;color:#fff;border-bottom-right-radius:4px}" +
    ".msg .who{display:block;font-size:11px;font-weight:600;opacity:.7;margin-bottom:2px}" +
    ".msg img{max-width:100%;border-radius:8px;display:block;margin-top:4px}" +
    ".msg a{color:inherit;text-decoration:underline}" +
    ".foot{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}" +
    ".foot textarea{flex:1;resize:none;border:1px solid #d1d5db;border-radius:10px;padding:8px 10px;font-size:14px;height:42px;outline:none}" +
    ".send{border:0;border-radius:10px;color:#fff;padding:0 14px;font-weight:600;cursor:pointer}" +
    ".send:disabled{opacity:.5;cursor:default}" +
    ".form{padding:16px;display:flex;flex-direction:column;gap:10px;background:#fff}" +
    ".form p{margin:0;font-size:14px;color:#374151}" +
    ".form input{border:1px solid #d1d5db;border-radius:10px;padding:10px;font-size:14px;outline:none}" +
    ".err{color:#b91c1c;font-size:12px;padding:0 12px 8px}" +
    ".brand{text-align:center;font-size:11px;color:#9ca3af;padding:4px 0 8px;background:#fff}" +
    "@media (max-width:480px){.panel,.left.panel{right:0;left:0;bottom:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}" +
    ".btn{right:16px;bottom:16px}.left.btn{left:16px}}";

  root.innerHTML =
    "<style>" + css + "</style>" +
    '<button class="btn" aria-label="Buka chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="lbl"></span><span class="badge"></span></button>' +
    '<div class="panel" role="dialog" aria-label="Live chat">' +
    '<div class="head"><div><b class="title">Chat</b><small>Biasanya membalas dalam beberapa menit</small></div><button class="x" aria-label="Tutup">×</button></div>' +
    '<div class="body"></div>' +
    '<form class="form" style="display:none"><p>Sebelum mulai, boleh tahu nama Anda?</p>' +
    '<input name="name" placeholder="Nama" maxlength="80" required><input name="contact" placeholder="No. WhatsApp atau email (opsional)" maxlength="120">' +
    '<button class="send" type="submit" style="height:42px">Mulai chat</button></form>' +
    '<div class="err"></div>' +
    '<div class="foot"><textarea placeholder="Tulis pesan…" maxlength="2000" aria-label="Pesan"></textarea><button class="send" aria-label="Kirim">Kirim</button></div>' +
    '<div class="brand">Didukung Balas.id</div></div>';

  var $ = function (sel) {
    return root.querySelector(sel);
  };
  var btn = $(".btn"), badge = $(".badge"), panel = $(".panel"), body = $(".body"), form = $(".form");
  var foot = $(".foot"), input = $(".foot textarea"), sendBtn = $(".foot .send"), errBox = $(".err");

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function linkify(s) {
    return escapeHtml(s).replace(/https?:\/\/[^\s<]+/g, function (url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + "</a>";
    });
  }

  function addBubble(m) {
    if (m.id && state.seen[m.id]) return;
    if (m.id) state.seen[m.id] = true;
    var el = document.createElement("div");
    el.className = "msg " + (m.from === "visitor" ? "visitor" : "agent");
    if (m.from === "visitor") el.style.background = state.config.color;
    var html = m.from !== "visitor" && m.name ? '<span class="who">' + escapeHtml(m.name) + "</span>" : "";
    if (m.file_url && (m.type === "image" || m.type === "sticker")) {
      html += '<img src="' + escapeHtml(m.file_url) + '" alt="gambar">';
    } else if (m.file_url) {
      html += '<a href="' + escapeHtml(m.file_url) + '" target="_blank" rel="noopener noreferrer">📎 ' + escapeHtml(m.file_name || "Lampiran") + "</a>";
    }
    if (m.text) html += (m.file_url ? "<br>" : "") + linkify(m.text);
    el.innerHTML = html || "…";
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  }

  function showError(text) {
    errBox.textContent = text || "";
  }

  function setUnread(n) {
    state.unread = n;
    badge.textContent = n > 9 ? "9+" : String(n);
    badge.style.display = n ? "flex" : "none";
  }

  function needsForm() {
    return !state.visitor && !!state.config && state.config.ask_name;
  }

  function render() {
    form.style.display = needsForm() ? "flex" : "none";
    foot.style.display = needsForm() ? "none" : "flex";
  }

  // ---------------------------------------------------------------- behaviour
  function poll() {
    if (!state.visitor) return Promise.resolve();
    return api("poll", { after: state.last, open: state.open })
      .then(function (data) {
        var fresh = 0;
        data.messages.forEach(function (m) {
          if (!state.seen[m.id] && m.from === "agent") fresh++;
          addBubble(m);
          state.last = m.created_at;
        });
        if (!state.open && fresh) setUnread(state.unread + fresh);
      })
      .catch(function (err) {
        if (err.status === 401) {
          // The widget was reset on the server: start over.
          state.visitor = null;
          save();
          render();
        }
      });
  }

  function schedule() {
    clearTimeout(state.timer);
    state.timer = setTimeout(function () {
      poll().then(schedule);
    }, state.open ? OPEN_POLL_MS : CLOSED_POLL_MS);
  }

  function startVisitor(name, contact) {
    return api("start", { name: name, contact: contact, page_url: location.href }).then(function (v) {
      state.visitor = v;
      save();
      render();
    });
  }

  function send() {
    var text = input.value.trim();
    if (!text || state.sending) return;
    state.sending = true;
    sendBtn.disabled = true;
    showError("");
    var ready = state.visitor ? Promise.resolve() : startVisitor(null, null);
    ready
      .then(function () {
        return api("send", { text: text });
      })
      .then(function () {
        input.value = "";
        return poll();
      })
      .catch(function (err) {
        showError(err.message);
      })
      .then(function () {
        state.sending = false;
        sendBtn.disabled = false;
        input.focus();
      });
  }

  function toggle(open) {
    state.open = open;
    panel.classList.toggle("open", open);
    btn.classList.toggle("open", open);
    btn.setAttribute("aria-label", open ? "Tutup chat" : "Buka chat");
    if (open) {
      setUnread(0);
      poll();
      setTimeout(function () {
        (needsForm() ? form.querySelector("input") : input).focus();
      }, 50);
    }
    schedule();
  }

  btn.addEventListener("click", function () {
    toggle(!state.open);
  });
  $(".x").addEventListener("click", function () {
    toggle(false);
  });
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = form.elements.name.value.trim();
    if (!name) return;
    showError("");
    startVisitor(name, form.elements.contact.value.trim()).catch(function (err) {
      showError(err.message);
    });
  });

  api("config")
    .then(function (config) {
      state.config = config;
      var saved = load();
      state.visitor = saved && saved.visitor;
      $(".title").textContent = config.title;
      $(".btn .lbl").textContent = config.button_label || "";
      if (config.position === "left") {
        btn.classList.add("left");
        panel.classList.add("left");
      }
      [btn, $(".head"), $(".form .send"), sendBtn].forEach(function (el) {
        el.style.background = config.color;
      });
      addBubble({ id: "greeting", from: "agent", text: config.greeting });
      render();
      host.style.display = "";
      poll().then(schedule);
    })
    .catch(function () {
      host.remove(); // unknown or disabled widget: show nothing
    });
})();
