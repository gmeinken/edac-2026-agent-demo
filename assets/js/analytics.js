/* ------------------------------------------------------------------
   Amplitude bootstrap: identity, PII redaction, product events.
   Agent Analytics events live in agent-telemetry.js.
------------------------------------------------------------------ */

window.EDACAnalytics = (function () {
  const CONFIG = window.EDAC_CONFIG || {};
  const API_KEY = CONFIG.amplitudeApiKey;
  const ENV = CONFIG.env || 'demo';

  /* ---------- identity -----------------------------------------
     Docs: use one persistent anonymous UUID from localStorage as the
     Amplitude user_id. Never a placeholder like "anonymous" — a user_id
     cannot be changed once set, so a placeholder permanently forks the
     user and will not merge on sign-in.
  --------------------------------------------------------------- */
  const USER_KEY = 'edac.user_id';

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function userId() {
    let id = null;
    try { id = localStorage.getItem(USER_KEY); } catch (e) { /* private mode */ }
    if (!id) {
      id = 'anon-' + uuid();
      try { localStorage.setItem(USER_KEY, id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  /* ---------- PII redaction ------------------------------------
     Runs before track(), on every content-bearing property:
     $llm_message.text, [Agent] System Prompt, [Agent] Tool Input /
     Tool Output, and [Agent] Comment.
  --------------------------------------------------------------- */
  const PATTERNS = [
    [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
    [/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[phone]'],
    [/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]'],
    [/\b(?:\d[ -]*?){13,19}\b/g, '[card]'],
    [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[ip]']
  ];

  function redactText(value) {
    if (typeof value !== 'string') return value;
    return PATTERNS.reduce((acc, [re, replacement]) => acc.replace(re, replacement), value);
  }

  // Recursive: tool payloads are objects, and the most common
  // instrumentation mistake is redacting message text but not these.
  function redactDeep(value, depth) {
    depth = depth || 0;
    if (depth > 6) return value;
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.map(v => redactDeep(v, depth + 1));
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(k => { out[k] = redactDeep(value[k], depth + 1); });
      return out;
    }
    return value;
  }

  /* ---------- init ---------------------------------------------- */
  let ready = false;
  const queue = [];

  function init() {
    if (!window.amplitude) {
      console.warn('[EDAC] Amplitude Browser SDK did not load. Events will be logged to the console only.');
      return;
    }
    if (!API_KEY) {
      console.warn('[EDAC] No Amplitude API key configured in EDAC_CONFIG.');
      return;
    }

    // Session Replay, when the plugin loaded. Agent events get stamped
    // with the replay ID so agent sessions link to recordings.
    try {
      if (window.sessionReplay && window.sessionReplay.plugin) {
        amplitude.add(window.sessionReplay.plugin({ sampleRate: 1 }));
      }
    } catch (e) {
      console.warn('[EDAC] Session Replay plugin not attached:', e && e.message);
    }

    amplitude.init(API_KEY, userId(), {
      // Page views are tracked explicitly per hub section instead.
      autocapture: { elementInteractions: true, pageViews: false, sessions: true, formInteractions: true, fileDownloads: true },
      fetchRemoteConfig: true,
      serverZone: CONFIG.serverZone || 'US'
      // Never call setTransport('beacon') — it applies to the whole SDK
      // permanently and every later event fires with no retry.
    });

    amplitude.setGroup('event', CONFIG.eventCode || 'EDAC 2026');

    const ident = new amplitude.Identify();
    ident.setOnce('first_seen', new Date().toISOString());
    ident.set('demo_env', ENV);
    amplitude.identify(ident);

    ready = true;
    while (queue.length) {
      const [name, props] = queue.shift();
      amplitude.track(name, props);
    }
  }

  /* ---------- raw track ---------------------------------------- */
  function track(name, props) {
    const payload = Object.assign({}, props);
    if (CONFIG.debug) console.log('%c▶ ' + name, 'color:#7c9cff;font-weight:600', payload);
    window.dispatchEvent(new CustomEvent('edac:event', { detail: { name, props: payload } }));

    if (!ready) {
      queue.push([name, payload]);
      return;
    }
    amplitude.track(name, payload);
  }

  /* ---------- replay + session linkage ------------------------- */
  function replayProperties() {
    const out = {};
    try {
      if (window.sessionReplay && typeof sessionReplay.getSessionReplayProperties === 'function') {
        Object.assign(out, sessionReplay.getSessionReplayProperties());
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  function browserIds() {
    const out = {};
    try {
      if (ready && window.amplitude) {
        out.browserSessionId = amplitude.getSessionId();
        out.deviceId = amplitude.getDeviceId();
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  /* ---------- product events -----------------------------------
     Deliberately plain product names — not [Agent]-prefixed — so
     agent-assisted and click-driven journeys land in one funnel.
  --------------------------------------------------------------- */
  const product = {
    pageViewed(section) {
      track('Page Viewed', { section: section, path: location.pathname + '#' + section });
    },
    ticketOptionsViewed(source) {
      track('Ticket Options Viewed', { source: source || 'nav' });
    },
    ticketAddedToCart(ticket, qty, total, source) {
      track('Ticket Added to Cart', {
        ticket_id: ticket.id, ticket_name: ticket.name, ticket_days: ticket.days,
        quantity: qty, cart_value_usd: total, purchase_window: 'advance', source: source || 'ui'
      });
    },
    hotelSearched(params, resultCount, source) {
      track('Hotel Search Performed', Object.assign({ result_count: resultCount, source: source || 'ui' }, params));
    },
    hotelRoomHeld(hotel, nights, total, source) {
      track('Hotel Room Held', {
        hotel_id: hotel.id, hotel_name: hotel.name, hotel_tier: hotel.tier,
        nightly_rate_usd: hotel.nightly, nights: nights, total_usd: total, source: source || 'ui'
      });
    },
    sessionAddedToAgenda(session, source) {
      track('Session Added to Agenda', {
        session_id: session.id, session_title: session.title, track: window.EDAC.trackName(session.track),
        day: session.day, start_time: session.start, seats_left: window.EDAC.seatsLeft(session),
        source: source || 'ui'
      });
    },
    sessionRemovedFromAgenda(session, source) {
      track('Session Removed from Agenda', {
        session_id: session.id, session_title: session.title, source: source || 'ui'
      });
    },
    agendaFiltered(filters, resultCount) {
      track('Agenda Filtered', Object.assign({ result_count: resultCount }, filters));
    },
    itinerarySubmitted(itinerary, source) {
      track('Itinerary Submitted', {
        item_count: itinerary.length,
        session_count: itinerary.filter(i => i.type === 'session').length,
        hotel_count: itinerary.filter(i => i.type === 'hotel').length,
        ticket_count: itinerary.filter(i => i.type === 'ticket').length,
        total_usd: itinerary.reduce((sum, i) => sum + (i.amount || 0), 0),
        source: source || 'ui'
      });
    }
  };

  return {
    init, track, product,
    userId, uuid, redactText, redactDeep, replayProperties, browserIds,
    get isReady() { return ready; }
  };
})();
