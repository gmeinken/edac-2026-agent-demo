/* ------------------------------------------------------------------
   Concierge chat UI — renders the agent's blocks, wires thumbs
   feedback to [Agent] Score, and closes the agent session explicitly
   when the attendee ends the conversation.
------------------------------------------------------------------ */

(function () {
  const D = window.EDAC;
  const Agent = window.EDACAgent;
  const T = window.EDACAgentTelemetry;
  const A = window.EDACAnalytics;
  const Store = window.EDACStore;

  let els = {};
  let busy = false;
  let opened = false;

  /* ---------- tiny markdown ------------------------------------ */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function md(text) {
    const lines = esc(text).split('\n');
    let html = '';
    let inList = false;
    lines.forEach(line => {
      const isItem = /^\s*[-•]\s+/.test(line);
      if (isItem) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + inline(line.replace(/^\s*[-•]\s+/, '')) + '</li>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (line.trim()) html += '<p>' + inline(line) + '</p>';
      }
    });
    if (inList) html += '</ul>';
    return html;
  }

  function inline(s) {
    return s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function money(n) { return '$' + Number(n).toLocaleString('en-US'); }

  /* ---------- block renderers ---------------------------------- */
  function renderBlocks(blocks) {
    const wrap = document.createElement('div');
    blocks.forEach(b => {
      if (b.kind === 'text') {
        const el = document.createElement('div');
        el.className = 'ag-prose';
        el.innerHTML = md(b.md);
        wrap.appendChild(el);
      } else if (b.kind === 'note') {
        const el = document.createElement('div');
        el.className = 'ag-note';
        el.innerHTML = md(b.md);
        wrap.appendChild(el);
      } else if (b.kind === 'sessions') {
        b.items.forEach(id => {
          const s = D.SESSIONS.find(x => x.id === id);
          if (s) wrap.appendChild(sessionCard(s));
        });
      } else if (b.kind === 'hotels') {
        b.items.forEach(id => {
          const h = D.HOTELS.find(x => x.id === id);
          if (h) wrap.appendChild(hotelCard(h, b.nights || 3));
        });
      } else if (b.kind === 'tickets') {
        wrap.appendChild(ticketTable(b.items));
      } else if (b.kind === 'dining') {
        b.items.forEach(r => wrap.appendChild(diningCard(r)));
      } else if (b.kind === 'hours') {
        wrap.appendChild(hoursTable(b.items));
      } else if (b.kind === 'itinerary') {
        wrap.appendChild(itineraryCard());
      }
    });
    return wrap;
  }

  function sessionCard(s) {
    const left = D.seatsLeft(s);
    const el = document.createElement('div');
    el.className = 'ag-card';
    el.innerHTML = `
      <div class="ag-card-bar" style="background:${D.trackColor(s.track)}"></div>
      <div class="ag-card-body">
        <div class="ag-card-meta">${esc(D.shortDay(s.day))} · ${esc(D.time12(s.start))}–${esc(D.time12(s.end))} · ${esc(s.room)}</div>
        <div class="ag-card-title">${esc(s.title)}</div>
        <div class="ag-card-sub">${esc(s.speaker)} · ${esc(D.trackName(s.track))} · ${esc(s.level)}</div>
        <div class="ag-card-foot">
          <span class="${left === 0 ? 'ag-full' : left < 20 ? 'ag-tight' : 'ag-open'}">${left === 0 ? 'Full — standby at the door' : left + ' seats left'}</span>
          ${left > 0 ? `<button class="ag-mini" data-add-session="${s.id}">${Store.has('session', s.id) ? 'On your agenda' : 'Add'}</button>` : ''}
        </div>
      </div>`;
    const btn = el.querySelector('[data-add-session]');
    if (btn) {
      btn.disabled = Store.has('session', s.id);
      btn.addEventListener('click', () => {
        Store.add({ type: 'session', id: s.id, label: s.title, day: s.day, start: s.start, end: s.end, room: s.room, amount: 0 }, 'agent-card');
        A.product.sessionAddedToAgenda(s, 'agent-card');
        btn.textContent = 'On your agenda';
        btn.disabled = true;
      });
    }
    return el;
  }

  function hotelCard(h, nights) {
    const el = document.createElement('div');
    el.className = 'ag-card';
    el.innerHTML = `
      <div class="ag-card-bar" style="background:${h.walkToVenue ? '#34d399' : '#5b8def'}"></div>
      <div class="ag-card-body">
        <div class="ag-card-meta">${esc(h.tier)} · ${h.walkToVenue ? 'Walk to sessions' : h.minutesToVenue + ' min shuttle'} · ${h.roomsLeft} rooms left</div>
        <div class="ag-card-title">${esc(h.name)}</div>
        <div class="ag-card-sub">${esc(h.blurb)}</div>
        <div class="ag-card-foot">
          <span><strong>${money(h.nightly)}</strong>/night · ${money(h.nightly * nights)} for ${nights} nights</span>
          <button class="ag-mini" data-hold="${h.id}">Hold</button>
        </div>
      </div>`;
    el.querySelector('[data-hold]').addEventListener('click', (ev) => {
      const total = h.nightly * nights;
      Store.replace({ type: 'hotel', id: h.id, label: h.name, nights: nights, amount: total, nightly: h.nightly }, 'agent-card');
      A.product.hotelRoomHeld(h, nights, total, 'agent-card');
      ev.target.textContent = 'Held';
      ev.target.disabled = true;
    });
    return el;
  }

  function ticketTable(rows) {
    const el = document.createElement('div');
    el.className = 'ag-table-wrap';
    el.innerHTML = `
      <table class="ag-table">
        <thead><tr><th>Ticket</th><th>Each</th><th>Party total</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><strong>${esc(r.name)}</strong><span class="ag-t-note">${esc(r.note)}</span></td>
              <td>${money(r.unit_price_usd)}</td>
              <td><strong>${money(r.party_total_usd)}</strong>${r.savings_vs_gate_usd ? `<span class="ag-t-note">saves ${money(r.savings_vs_gate_usd)}</span>` : ''}</td>
              <td><button class="ag-mini" data-buy="${r.id}" data-a="${r.adults}" data-c="${r.children}" data-total="${r.party_total_usd}">Add</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    el.querySelectorAll('[data-buy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = D.TICKETS.find(x => x.id === btn.dataset.buy);
        const qty = Number(btn.dataset.a) + Number(btn.dataset.c);
        const total = Number(btn.dataset.total);
        Store.replace({ type: 'ticket', id: t.id, label: t.name, quantity: qty, adults: Number(btn.dataset.a), children: Number(btn.dataset.c), amount: total }, 'agent-card');
        A.product.ticketAddedToCart(t, qty, total, 'agent-card');
        el.querySelectorAll('[data-buy]').forEach(b => { b.disabled = true; b.textContent = b === btn ? 'Added' : 'Add'; });
      });
    });
    return el;
  }

  function diningCard(r) {
    const el = document.createElement('div');
    el.className = 'ag-card';
    el.innerHTML = `
      <div class="ag-card-bar" style="background:#fbbf24"></div>
      <div class="ag-card-body">
        <div class="ag-card-meta">${esc(r.style)} · ${esc(r.price)} · ${esc(r.location)}</div>
        <div class="ag-card-title">${esc(r.name)}</div>
        <div class="ag-card-sub">${esc(r.blurb)}</div>
        <div class="ag-card-foot"><span>Reservations: ${esc(r.reservation_difficulty)}</span></div>
      </div>`;
    return el;
  }

  function hoursTable(rows) {
    const el = document.createElement('div');
    el.className = 'ag-table-wrap';
    el.innerHTML = `
      <table class="ag-table">
        <thead><tr><th>Park</th><th>Hours</th><th>Busiest</th></tr></thead>
        <tbody>${rows.map(p => `<tr><td><strong>${esc(p.name)}</strong><span class="ag-t-note">${esc(p.kind)}</span></td><td>${esc(p.hours)}</td><td>${esc(p.busiest)}</td></tr>`).join('')}</tbody>
      </table>`;
    return el;
  }

  function itineraryCard() {
    const items = Store.all();
    const el = document.createElement('div');
    el.className = 'ag-itin';
    if (!items.length) {
      el.innerHTML = '<div class="ag-itin-empty">Nothing on your itinerary yet.</div>';
      return el;
    }
    el.innerHTML = `
      <div class="ag-itin-head">Your itinerary</div>
      <ul>${items.map(i => `
        <li>
          <span class="ag-itin-type">${esc(i.type)}</span>
          <span class="ag-itin-label">${esc(i.label)}</span>
          ${i.day ? `<span class="ag-itin-when">${esc(D.shortDay(i.day))} ${esc(D.time12(i.start))}</span>` : ''}
          ${i.amount ? `<span class="ag-itin-amt">${money(i.amount)}</span>` : ''}
        </li>`).join('')}</ul>
      ${Store.totalUsd() ? `<div class="ag-itin-total">Total bookings <strong>${money(Store.totalUsd())}</strong></div>` : ''}`;
    return el;
  }

  /* ---------- transcript --------------------------------------- */
  function addUserBubble(text) {
    const el = document.createElement('div');
    el.className = 'ag-msg ag-msg-user';
    el.innerHTML = `<div class="ag-bubble">${esc(text)}</div>`;
    els.log.appendChild(el);
    scroll();
  }

  function addTyping() {
    const el = document.createElement('div');
    el.className = 'ag-msg ag-msg-bot ag-typing';
    el.innerHTML = `<div class="ag-avatar">EC</div><div class="ag-bubble"><span class="ag-dots"><i></i><i></i><i></i></span></div>`;
    els.log.appendChild(el);
    scroll();
    return el;
  }

  function addBotMessage(reply) {
    const el = document.createElement('div');
    el.className = 'ag-msg ag-msg-bot';

    const bubble = document.createElement('div');
    bubble.className = 'ag-bubble';
    bubble.appendChild(renderBlocks(reply.blocks));

    // Thumbs → [Agent] Score named "user-feedback", targeting this
    // specific AI message.
    const fb = document.createElement('div');
    fb.className = 'ag-feedback';
    fb.innerHTML = `
      <button class="ag-thumb" data-v="1" title="Helpful" aria-label="Helpful">&#9650;</button>
      <button class="ag-thumb" data-v="0" title="Not helpful" aria-label="Not helpful">&#9660;</button>
      <span class="ag-fb-note"></span>`;
    fb.querySelectorAll('.ag-thumb').forEach(btn => {
      btn.addEventListener('click', () => {
        const up = btn.dataset.v === '1';
        T.trackFeedback(reply.messageId, up ? 1 : 0);
        fb.querySelectorAll('.ag-thumb').forEach(b => { b.disabled = true; });
        btn.classList.add('ag-thumb-on');
        fb.querySelector('.ag-fb-note').textContent = up ? 'Thanks' : 'Noted — sending this to the team';
      });
    });
    bubble.appendChild(fb);

    el.innerHTML = `<div class="ag-avatar">EC</div>`;
    el.appendChild(bubble);
    els.log.appendChild(el);

    renderSuggestions(reply.suggestions);
    scroll();
  }

  function renderSuggestions(list) {
    els.chips.innerHTML = '';
    (list || []).forEach(s => {
      const b = document.createElement('button');
      b.className = 'ag-chip';
      b.textContent = s;
      b.addEventListener('click', () => send(s, 'suggestion'));
      els.chips.appendChild(b);
    });
  }

  function scroll() {
    els.log.scrollTop = els.log.scrollHeight;
  }

  /* ---------- send --------------------------------------------- */
  async function send(text, source) {
    text = (text || '').trim();
    if (!text || busy) return;
    busy = true;
    els.input.value = '';
    els.send.disabled = true;
    els.chips.innerHTML = '';

    addUserBubble(text);
    A.track('Agent Message Sent', {
      source: source || 'input',
      character_count: text.length,
      turn_number: T.turnId + 1,
      agent_session_id: T.sessionId
    });

    const typing = addTyping();
    try {
      const reply = await Agent.respond(text);
      typing.remove();
      addBotMessage(reply);
      updateDebug(reply);
    } catch (err) {
      typing.remove();
      addBotMessage({
        messageId: 'msg-error',
        blocks: [{ kind: 'text', md: 'Something broke on my side. Try again, or reach the attendee desk at ' + D.EVENT.supportEmail + '.' }],
        suggestions: ['Try again']
      });
      console.error(err);
    }
    busy = false;
    els.send.disabled = false;
    els.input.focus();
  }

  function updateDebug(reply) {
    if (!els.debug) return;
    const project = (window.EDAC_CONFIG || {}).amplitudeProjectId;
    els.debug.innerHTML = `
      ${project ? `<span><b>project</b> ${esc(project)}</span>` : ''}
      <span><b>session</b> ${esc((T.sessionId || '').slice(0, 13))}…</span>
      <span><b>turn</b> ${T.turnId}</span>
      <span><b>intent</b> ${esc(reply.intent || 'remote')}</span>
      <span><b>tools</b> ${reply.toolsUsed.length ? esc(reply.toolsUsed.join(', ')) : 'none'}</span>`;
  }

  /* ---------- open / close ------------------------------------- */
  function open(source) {
    els.root.classList.add('ag-open-panel');
    els.launcher.setAttribute('aria-expanded', 'true');
    if (!opened) {
      opened = true;
      T.startSession('opened');
      A.track('Agent Opened', { source: source || 'launcher', agent_session_id: T.sessionId });
      greet();
    }
    setTimeout(() => els.input.focus(), 120);
  }

  function close() {
    els.root.classList.remove('ag-open-panel');
    els.launcher.setAttribute('aria-expanded', 'false');
    A.track('Agent Closed', { agent_session_id: T.sessionId, turns: T.turnId });
  }

  function greet() {
    const el = document.createElement('div');
    el.className = 'ag-msg ag-msg-bot';
    el.innerHTML = `<div class="ag-avatar">EC</div>
      <div class="ag-bubble"><div class="ag-prose">
        <p><strong>EDAC 2026 Concierge.</strong> I can build your session agenda, book a room at the attendee rate, price park tickets, and handle badges, shuttles, dining, and park hours.</p>
      </div></div>`;
    els.log.appendChild(el);
    renderSuggestions(Agent.openers);
  }

  // Explicit close: the recommended path, and the only way the session
  // gets [Agent] Close Reason "explicit_close" rather than a timeout.
  function endConversation() {
    if (!T.sessionId || T.isClosed) return;
    T.endSession(Store.all().length ? 'completed' : 'no_action');
    const el = document.createElement('div');
    el.className = 'ag-sysline';
    el.textContent = 'Conversation ended. Sending a new message starts a fresh one.';
    els.log.appendChild(el);
    els.chips.innerHTML = '';
    scroll();
    Agent.reset();
  }

  /* ---------- mount -------------------------------------------- */
  function mount() {
    const root = document.createElement('div');
    root.className = 'ag-root';
    root.innerHTML = `
      <button class="ag-launcher" aria-expanded="false" aria-label="Open the EDAC Concierge">
        <span class="ag-launcher-dot"></span>
        <span class="ag-launcher-text">Ask the Concierge</span>
      </button>
      <section class="ag-panel" role="dialog" aria-label="EDAC 2026 Concierge">
        <header class="ag-head">
          <div class="ag-head-id">
            <span class="ag-avatar ag-avatar-lg">EC</span>
            <div>
              <div class="ag-head-title">EDAC 2026 Concierge</div>
              <div class="ag-head-sub">Agenda · hotels · tickets · logistics</div>
            </div>
          </div>
          <div class="ag-head-actions">
            <button class="ag-icon" data-act="end" title="End conversation">End</button>
            <button class="ag-icon" data-act="close" title="Close" aria-label="Close">&times;</button>
          </div>
        </header>
        <div class="ag-log" aria-live="polite"></div>
        <div class="ag-chips"></div>
        <form class="ag-form">
          <input class="ag-input" type="text" autocomplete="off" placeholder="Ask about sessions, hotels, tickets, logistics…" aria-label="Message the concierge">
          <button class="ag-send" type="submit">Send</button>
        </form>
        <div class="ag-debug"></div>
      </section>`;
    document.body.appendChild(root);

    els = {
      root: root,
      launcher: root.querySelector('.ag-launcher'),
      panel: root.querySelector('.ag-panel'),
      log: root.querySelector('.ag-log'),
      chips: root.querySelector('.ag-chips'),
      input: root.querySelector('.ag-input'),
      send: root.querySelector('.ag-send'),
      debug: root.querySelector('.ag-debug')
    };

    els.launcher.addEventListener('click', () => {
      root.classList.contains('ag-open-panel') ? close() : open('launcher');
    });
    root.querySelector('[data-act="close"]').addEventListener('click', close);
    root.querySelector('[data-act="end"]').addEventListener('click', endConversation);
    root.querySelector('.ag-form').addEventListener('submit', e => {
      e.preventDefault();
      send(els.input.value, 'input');
    });
    // Enter submits even where the implicit form submission does not fire.
    els.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send(els.input.value, 'input');
      }
    });

    const project = (window.EDAC_CONFIG || {}).amplitudeProjectId;
    els.debug.innerHTML = '<span>Agent Analytics events stream to Amplitude'
      + (project ? ' <b>project</b> ' + esc(project) : '') + ' on every turn.</span>';

    // Any "Ask the Concierge" trigger elsewhere on the page.
    document.addEventListener('click', e => {
      const trigger = e.target.closest('[data-concierge]');
      if (!trigger) return;
      e.preventDefault();
      open(trigger.dataset.concierge || 'page');
      const prompt = trigger.dataset.prompt;
      if (prompt) setTimeout(() => send(prompt, 'page-cta'), 400);
    });

    Store.subscribe(() => {
      // Keep any rendered itinerary block in the transcript current.
      els.log.querySelectorAll('.ag-itin').forEach(node => {
        node.replaceWith(itineraryCard());
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.EDACAgentUI = { open, close, send, endConversation };
})();
