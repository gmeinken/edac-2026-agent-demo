/* ------------------------------------------------------------------
   Page rendering and product-event instrumentation.
------------------------------------------------------------------ */

(function () {
  const D = window.EDAC;
  const A = window.EDACAnalytics;
  const Store = window.EDACStore;

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const money = n => '$' + Number(n).toLocaleString('en-US');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- countdown ---------------------------------------- */
  function countdown() {
    const deadline = new Date(D.EVENT.advancePurchaseDeadline + 'T23:59:59Z');
    const days = Math.max(0, Math.ceil((deadline - new Date()) / 86400000));
    const label = days > 0 ? days : 0;
    $('#promo-days').textContent = label;
    $('#promo-num').textContent = label;
  }

  /* ---------- agenda ------------------------------------------- */
  const agendaState = { day: D.EVENT.conferenceDays[0], track: '', level: '', q: '' };

  function buildDayTabs() {
    const tabs = $('#daytabs');
    D.EVENT.conferenceDays.forEach((day, i) => {
      const b = document.createElement('button');
      b.className = 'daytab' + (i === 0 ? ' on' : '');
      b.setAttribute('role', 'tab');
      b.innerHTML = `<b>Day ${i + 1}</b><span>${esc(D.shortDay(day))}</span>`;
      b.addEventListener('click', () => {
        agendaState.day = day;
        $$('.daytab').forEach(t => t.classList.remove('on'));
        b.classList.add('on');
        renderAgenda();
      });
      tabs.appendChild(b);
    });

    const sel = $('#f-track');
    D.TRACKS.forEach(t => {
      const o = document.createElement('option');
      o.value = t.id; o.textContent = t.name;
      sel.appendChild(o);
    });
  }

  function filteredSessions() {
    return D.sessionsByDay(agendaState.day).filter(s => {
      if (agendaState.track && s.track !== agendaState.track) return false;
      if (agendaState.level && s.level !== agendaState.level) return false;
      if (agendaState.q) {
        const hay = [s.title, s.summary, s.speaker, s.room, s.tags.join(' ')].join(' ').toLowerCase();
        if (!hay.includes(agendaState.q.toLowerCase())) return false;
      }
      return true;
    });
  }

  function renderAgenda(fromFilter) {
    const list = $('#agenda-list');
    const rows = filteredSessions();
    list.innerHTML = '';
    $('#agenda-empty').hidden = rows.length > 0;

    rows.forEach(s => {
      const left = D.seatsLeft(s);
      const on = Store.has('session', s.id);
      const row = document.createElement('article');
      row.className = 'srow';
      row.innerHTML = `
        <div class="srow-time">
          <b>${esc(D.time12(s.start))}</b>
          <span>${esc(D.time12(s.end))}</span>
        </div>
        <div class="srow-bar" style="background:${D.trackColor(s.track)}"></div>
        <div class="srow-main">
          <div class="srow-head">
            <h3>${esc(s.title)}</h3>
            <span class="pill" style="--c:${D.trackColor(s.track)}">${esc(D.trackName(s.track))}</span>
          </div>
          <p class="srow-sum">${esc(s.summary)}</p>
          <p class="srow-meta">
            <span>${esc(s.speaker)}, ${esc(s.role)}</span>
            <span>${esc(s.room)}</span>
            <span>${esc(s.level)}</span>
            <span class="${left === 0 ? 'seat-full' : left < 20 ? 'seat-tight' : 'seat-ok'}">${left === 0 ? 'At capacity' : left + ' seats left'}</span>
          </p>
        </div>
        <div class="srow-act">
          ${left === 0
            ? `<button class="btn btn-mini" disabled>Full</button>`
            : `<button class="btn btn-mini ${on ? 'btn-on' : ''}" data-sess="${s.id}">${on ? 'Added' : 'Add'}</button>`}
          <button class="linkish tiny" data-concierge="agenda-row" data-prompt="Tell me more about ${esc(s.title)}">Ask about this</button>
        </div>`;

      const btn = row.querySelector('[data-sess]');
      if (btn) {
        btn.addEventListener('click', () => {
          if (Store.has('session', s.id)) {
            Store.remove('session', s.id);
            A.product.sessionRemovedFromAgenda(s, 'agenda-list');
          } else {
            Store.add({ type: 'session', id: s.id, label: s.title, day: s.day, start: s.start, end: s.end, room: s.room, amount: 0 }, 'agenda-list');
            A.product.sessionAddedToAgenda(s, 'agenda-list');
          }
          renderAgenda();
        });
      }
      list.appendChild(row);
    });

    if (fromFilter) {
      A.product.agendaFiltered({ day: agendaState.day, track: agendaState.track || 'all', level: agendaState.level || 'any', query: agendaState.q || null }, rows.length);
    }
  }

  function wireAgendaFilters() {
    $('#f-track').addEventListener('change', e => { agendaState.track = e.target.value; renderAgenda(true); });
    $('#f-level').addEventListener('change', e => { agendaState.level = e.target.value; renderAgenda(true); });
    let t;
    $('#f-q').addEventListener('input', e => {
      agendaState.q = e.target.value.trim();
      clearTimeout(t);
      t = setTimeout(() => renderAgenda(true), 350);
    });
  }

  /* ---------- hotels ------------------------------------------- */
  function renderHotels(fromFilter) {
    const nights = Number($('#h-nights').value);
    const budget = $('#h-budget').value ? Number($('#h-budget').value) : null;
    const walk = $('#h-walk').checked;

    const rows = D.HOTELS
      .filter(h => (!budget || h.nightly <= budget) && (!walk || h.walkToVenue))
      .sort((a, b) => a.minutesToVenue - b.minutesToVenue);

    const grid = $('#hotel-list');
    grid.innerHTML = '';

    if (!rows.length) {
      grid.innerHTML = `<p class="agenda-empty">No hotels match those filters. <button class="linkish" data-concierge="hotels-empty" data-prompt="What is the cheapest hotel on property?">Ask the concierge</button></p>`;
    }

    rows.forEach(h => {
      const held = Store.has('hotel', h.id);
      const card = document.createElement('article');
      card.className = 'hcard';
      card.innerHTML = `
        <div class="hcard-top">
          <span class="tier tier-${h.tier.toLowerCase()}">${esc(h.tier)}</span>
          <span class="hcard-dist">${h.walkToVenue ? 'Walk to sessions' : h.minutesToVenue + ' min shuttle'}</span>
        </div>
        <h3>${esc(h.name)}</h3>
        <p class="hcard-blurb">${esc(h.blurb)}</p>
        <ul class="hcard-amen">${h.amenities.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
        <div class="hcard-foot">
          <div class="hcard-price"><b>${money(h.nightly)}</b><span>/night · ${money(h.nightly * nights)} total</span></div>
          <button class="btn btn-mini ${held ? 'btn-on' : ''}" data-hotel="${h.id}">${held ? 'Held' : 'Hold room'}</button>
        </div>
        <p class="hcard-left">${h.roomsLeft} rooms left in the attendee block</p>`;
      card.querySelector('[data-hotel]').addEventListener('click', () => {
        const total = h.nightly * nights;
        Store.replace({ type: 'hotel', id: h.id, label: h.name, nights: nights, amount: total, nightly: h.nightly }, 'hotel-grid');
        A.product.hotelRoomHeld(h, nights, total, 'hotel-grid');
        renderHotels();
      });
      grid.appendChild(card);
    });

    if (fromFilter) {
      A.product.hotelSearched({ nights: nights, max_nightly_usd: budget, walk_to_venue: walk }, rows.length, 'hotel-grid');
    }
  }

  function wireHotelFilters() {
    ['#h-nights', '#h-budget', '#h-walk'].forEach(sel => {
      $(sel).addEventListener('change', () => renderHotels(true));
    });
  }

  /* ---------- tickets ------------------------------------------ */
  function renderTickets() {
    const adults = Number($('#t-adults').value);
    const kids = Number($('#t-kids').value);
    const advance = $('#t-advance').checked;
    const body = $('#ticket-rows');
    body.innerHTML = '';

    D.TICKETS.forEach(t => {
      const unit = advance ? t.advance : t.gate;
      const childUnit = Math.round(unit * D.CHILD_DISCOUNT);
      const total = unit * adults + childUnit * kids;
      const savings = advance ? (t.gate - t.advance) * (adults + kids) : 0;
      const on = Store.has('ticket', t.id);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <b>${esc(t.name)}</b>
          <span class="t-note">${esc(t.note)}${t.bonus ? ' · ' + esc(t.bonus) : ''}</span>
        </td>
        <td>${money(unit)}</td>
        <td>${kids ? money(childUnit) : '—'}</td>
        <td class="t-total">${money(total)}</td>
        <td>${savings ? '<span class="t-save">' + money(savings) + '</span>' : '—'}</td>
        <td><button class="btn btn-mini ${on ? 'btn-on' : ''}" data-ticket="${t.id}" data-total="${total}">${on ? 'In cart' : 'Add'}</button></td>`;

      tr.querySelector('[data-ticket]').addEventListener('click', () => {
        Store.replace({ type: 'ticket', id: t.id, label: t.name, quantity: adults + kids, adults: adults, children: kids, amount: total }, 'ticket-table');
        A.product.ticketAddedToCart(t, adults + kids, total, 'ticket-table');
        renderTickets();
      });
      body.appendChild(tr);
    });
  }

  function wireTicketControls() {
    ['#t-adults', '#t-kids', '#t-advance'].forEach(sel => {
      $(sel).addEventListener('change', () => {
        renderTickets();
        A.track('Ticket Party Changed', {
          adults: Number($('#t-adults').value),
          children: Number($('#t-kids').value),
          purchase_window: $('#t-advance').checked ? 'advance' : 'gate'
        });
      });
    });
  }

  /* ---------- parks -------------------------------------------- */
  function renderParks() {
    const grid = $('#park-grid');
    grid.innerHTML = D.PARKS.map(p => `
      <article class="pcard pcard-${esc(p.kind.replace(/\s/g, '-'))}">
        <span class="pkind">${esc(p.kind)}</span>
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.blurb)}</p>
        <dl><dt>Hours</dt><dd>${esc(p.hours)}</dd><dt>Busiest</dt><dd>${esc(p.peak)}</dd></dl>
      </article>`).join('');
  }

  /* ---------- logistics ---------------------------------------- */
  function renderLogistics() {
    const grid = $('#logi-grid');
    grid.innerHTML = Object.keys(D.LOGISTICS).map(k => {
      const l = D.LOGISTICS[k];
      return `<article class="lcard"><h3>${esc(l.title)}</h3><p>${esc(l.body)}</p></article>`;
    }).join('');
  }

  /* ---------- itinerary ---------------------------------------- */
  function renderItinerary() {
    const panel = $('#itin-panel');
    const items = Store.all();

    if (!items.length) {
      panel.innerHTML = `
        <div class="itin-empty">
          <p>Nothing on your itinerary yet. Add sessions from the agenda, hold a room, price your tickets —
          or let the concierge assemble the whole thing.</p>
          <button class="btn btn-navy" data-concierge="itinerary-empty" data-prompt="Build me a full plan: agenda, hotel, and tickets for 2 adults">Build my plan with the concierge</button>
        </div>`;
      return;
    }

    const groups = {
      session: items.filter(i => i.type === 'session').sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start)),
      hotel: items.filter(i => i.type === 'hotel'),
      ticket: items.filter(i => i.type === 'ticket')
    };

    const sourceCounts = Store.bySource();
    const agentAdded = Object.keys(sourceCounts).filter(k => k.indexOf('agent') === 0).reduce((n, k) => n + sourceCounts[k], 0);

    panel.innerHTML = `
      <div class="itin-cols">
        <div class="itin-col">
          <h3>Sessions <span>${groups.session.length}</span></h3>
          ${groups.session.length ? `<ul class="itin-list">${groups.session.map(i => `
            <li>
              <span class="itin-when">${esc(D.shortDay(i.day))} · ${esc(D.time12(i.start))}</span>
              <span class="itin-label">${esc(i.label)}</span>
              <span class="itin-room">${esc(i.room || '')}</span>
              <button class="x" data-rm="session:${i.id}" aria-label="Remove">&times;</button>
            </li>`).join('')}</ul>` : '<p class="itin-none">None yet.</p>'}
        </div>
        <div class="itin-col">
          <h3>Stay &amp; tickets</h3>
          ${groups.hotel.concat(groups.ticket).length ? `<ul class="itin-list">${groups.hotel.concat(groups.ticket).map(i => `
            <li>
              <span class="itin-when">${esc(i.type)}</span>
              <span class="itin-label">${esc(i.label)}${i.nights ? ' · ' + i.nights + ' nights' : ''}${i.quantity ? ' · ×' + i.quantity : ''}</span>
              <span class="itin-amt">${money(i.amount || 0)}</span>
              <button class="x" data-rm="${i.type}:${i.id}" aria-label="Remove">&times;</button>
            </li>`).join('')}</ul>` : '<p class="itin-none">None yet.</p>'}
          <div class="itin-total"><span>Total bookings</span><b>${money(Store.totalUsd())}</b></div>
          ${agentAdded ? `<p class="itin-src">${agentAdded} of ${items.length} added by the concierge</p>` : ''}
        </div>
      </div>
      <div class="itin-actions">
        <button class="btn btn-gold" id="itin-submit">Confirm itinerary</button>
        <button class="linkish" id="itin-clear">Clear everything</button>
        <button class="linkish" data-concierge="itinerary-check" data-prompt="Check my itinerary for conflicts">Check for conflicts</button>
      </div>`;

    panel.querySelectorAll('[data-rm]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [type, id] = btn.dataset.rm.split(':');
        if (type === 'session') {
          const s = D.SESSIONS.find(x => x.id === id);
          if (s) A.product.sessionRemovedFromAgenda(s, 'itinerary');
        }
        Store.remove(type, id);
        renderAgenda();
        renderHotels();
        renderTickets();
      });
    });

    $('#itin-submit').addEventListener('click', () => {
      A.product.itinerarySubmitted(Store.all(), 'itinerary');
      const el = $('#itin-submit');
      el.textContent = 'Itinerary confirmed';
      el.disabled = true;
    });

    $('#itin-clear').addEventListener('click', () => {
      Store.clear();
      renderAgenda();
      renderHotels();
      renderTickets();
    });
  }

  /* ---------- nav + section views ------------------------------ */
  function wireNav() {
    document.addEventListener('click', e => {
      const jump = e.target.closest('[data-jump]');
      if (jump) {
        e.preventDefault();
        const target = document.getElementById(jump.dataset.jump);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        A.track('Nav Clicked', { destination: jump.dataset.jump, label: jump.textContent.trim() });
        return;
      }
      const anchor = e.target.closest('.nav a, .foot-links a, .brand');
      if (anchor && anchor.hash) {
        A.track('Nav Clicked', { destination: anchor.hash.slice(1), label: anchor.textContent.trim() });
      }
    });

    const seen = {};
    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        if (seen[id]) return;
        seen[id] = true;
        A.product.pageViewed(id);
      });
    }, { threshold: 0.35 });
    $$('section[id]').forEach(s => obs.observe(s));
  }

  /* ---------- boot --------------------------------------------- */
  function boot() {
    A.init();
    A.product.pageViewed('home');

    countdown();
    buildDayTabs();
    wireAgendaFilters();
    wireHotelFilters();
    wireTicketControls();
    renderParks();
    renderLogistics();
    wireNav();

    Store.subscribe(renderItinerary);
    renderAgenda();
    renderHotels();
    renderTickets();

    // Ticket section view is the top-of-funnel signal worth its own event.
    const ticketObs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          A.product.ticketOptionsViewed('scroll');
          ticketObs.disconnect();
        }
      });
    }, { threshold: 0.4 });
    ticketObs.observe($('#tickets'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
