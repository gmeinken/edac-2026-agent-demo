/* ------------------------------------------------------------------
   EDAC Concierge — the agent itself.

   Two execution modes:
     local  (default) — intent routing over the event's own data, with
                        real tool functions that query real records
     remote           — set EDAC_CONFIG.agentEndpoint and each turn is
                        POSTed to your model-backed endpoint instead

   Either way the Agent Analytics event stream is identical: one
   User Message, a Tool Call per invocation in execution order, then
   one AI Response per turn.
------------------------------------------------------------------ */

window.EDACAgent = (function () {
  const D = window.EDAC;
  const T = window.EDACAgentTelemetry;
  const A = window.EDACAnalytics;
  const Store = window.EDACStore;
  const CONFIG = window.EDAC_CONFIG || {};

  const SYSTEM_PROMPT = [
    'You are the EDAC 2026 Concierge, the planning assistant on the attendee hub for the',
    'Everbright Data & Analytics Conference (September 11-17, 2026, Everbright Bay Resort,',
    'Lumina Springs FL). Help attendees build their agenda, book a resort hotel, price',
    'theme park tickets, plan evenings and dining, and answer logistics questions about',
    'badges, shuttles, parking, Wi-Fi, airport transfer, weather, and accessibility.',
    'Use the provided tools to look up real event records; never invent a session time,',
    'room rate, or ticket price. Be concise and specific: lead with the answer, give exact',
    'times and prices, and offer to add things to the attendee itinerary. If a session is',
    'full or a request falls outside the event, say so plainly and hand off to the',
    'attendee desk.'
  ].join(' ');

  /* =================================================================
     Tools
  ================================================================= */

  const TOOLS = {
    search_agenda: {
      description: 'Find conference sessions by keyword, day, track, level, or speaker.',
      run(input) {
        let results = D.SESSIONS.slice();
        if (input.day) results = results.filter(s => s.day === input.day);
        if (input.track) results = results.filter(s => s.track === input.track);
        if (input.level) results = results.filter(s => s.level.toLowerCase() === input.level.toLowerCase());
        if (input.speaker) {
          const q = input.speaker.toLowerCase();
          results = results.filter(s => s.speaker.toLowerCase().includes(q));
        }
        if (input.availableOnly) results = results.filter(s => D.seatsLeft(s) > 0);
        if (input.query) {
          const terms = input.query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
          results = results
            .map(s => {
              const haystack = [s.title, s.summary, s.speaker, s.room, s.tags.join(' '), D.trackName(s.track)].join(' ').toLowerCase();
              const score = terms.reduce((n, t) => n + (haystack.includes(t) ? 1 : 0), 0);
              return { s, score };
            })
            .filter(r => r.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(r => r.s);
        }
        results.sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start));
        const limited = results.slice(0, input.limit || 4);
        return {
          match_count: results.length,
          returned: limited.length,
          sessions: limited.map(s => ({
            id: s.id, title: s.title, day: s.day, start: s.start, end: s.end,
            room: s.room, track: D.trackName(s.track), speaker: s.speaker,
            level: s.level, seats_left: D.seatsLeft(s)
          }))
        };
      }
    },

    lookup_hotels: {
      description: 'Look up attendee-rate resort hotels with nightly rates and availability.',
      run(input) {
        let results = D.HOTELS.slice();
        if (typeof input.maxNightly === 'number') results = results.filter(h => h.nightly <= input.maxNightly);
        if (input.walkToVenue) results = results.filter(h => h.walkToVenue);
        if (input.tier) results = results.filter(h => h.tier.toLowerCase() === input.tier.toLowerCase());
        results.sort((a, b) => a.minutesToVenue - b.minutesToVenue || a.nightly - b.nightly);
        const nights = input.nights || 3;
        return {
          nights: nights,
          match_count: results.length,
          hotels: results.map(h => ({
            id: h.id, name: h.name, tier: h.tier, nightly_usd: h.nightly,
            total_usd: h.nightly * nights, minutes_to_venue: h.minutesToVenue,
            walk_to_venue: h.walkToVenue, rooms_left: h.roomsLeft
          }))
        };
      }
    },

    price_tickets: {
      description: 'Price attendee theme park tickets for a party, at advance or gate rates.',
      run(input) {
        const adults = Math.max(1, input.adults || 1);
        const children = Math.max(0, input.children || 0);
        const advance = input.advance !== false;

        let options = D.TICKETS.slice();
        if (input.ticketId) options = options.filter(t => t.id === input.ticketId);
        else if (typeof input.days === 'number') {
          const exact = options.filter(t => t.days === input.days);
          if (exact.length) options = exact;
        }

        const priced = options.map(t => {
          const unit = advance ? t.advance : t.gate;
          const adultTotal = unit * adults;
          const childTotal = Math.round(unit * D.CHILD_DISCOUNT) * children;
          const total = adultTotal + childTotal;
          const savings = advance ? (t.gate - t.advance) * (adults + children) : 0;
          return {
            id: t.id, name: t.name, days: t.days,
            unit_price_usd: unit, adults: adults, children: children,
            child_unit_usd: children ? Math.round(unit * D.CHILD_DISCOUNT) : null,
            party_total_usd: total, savings_vs_gate_usd: savings,
            bonus: t.bonus, note: t.note
          };
        });

        return {
          purchase_window: advance ? 'advance' : 'gate',
          advance_deadline: D.EVENT.advancePurchaseDeadline,
          ticket_validity: 'Valid from 7 days before the event through 7 days after',
          options: priced
        };
      }
    },

    find_dining: {
      description: 'Find restaurants on property, optionally filtered by park or meal.',
      run(input) {
        let results = D.DINING.slice();
        if (input.park) results = results.filter(d => d.park === input.park);
        if (input.meal) results = results.filter(d => d.meals.includes(input.meal));
        if (input.maxPrice) results = results.filter(d => d.price.length <= input.maxPrice.length);
        return {
          match_count: results.length,
          restaurants: results.map(d => ({
            id: d.id, name: d.name, style: d.style, price: d.price,
            location: (D.park(d.park) || { name: 'Everbright Grand Lagoon Resort' }).name,
            meals: d.meals, reservation_difficulty: d.reservationDifficulty, blurb: d.blurb
          }))
        };
      }
    },

    get_park_hours: {
      description: 'Operating hours and busiest window for a park or the whole resort.',
      run(input) {
        let parks = D.PARKS;
        if (input.parkId) parks = parks.filter(p => p.id === input.parkId);
        if (input.kind) parks = parks.filter(p => p.kind === input.kind);
        return {
          date_range: D.EVENT.startDate + ' to ' + D.EVENT.endDate,
          parks: parks.map(p => ({ id: p.id, name: p.name, kind: p.kind, hours: p.hours, busiest: p.peak }))
        };
      }
    },

    get_logistics: {
      description: 'Answer an attendee logistics question: badge, shuttle, parking, Wi-Fi, airport, weather, accessibility, evening event.',
      run(input) {
        const topic = input.topic;
        const entry = D.LOGISTICS[topic];
        if (!entry) {
          return { found: false, available_topics: Object.keys(D.LOGISTICS) };
        }
        return { found: true, topic: topic, title: entry.title, body: entry.body };
      }
    },

    add_to_itinerary: {
      description: 'Add a session, hotel, or ticket to the attendee itinerary.',
      run(input) {
        if (input.type === 'session') {
          const s = D.SESSIONS.find(x => x.id === input.id);
          if (!s) return { added: false, error: 'session_not_found' };
          if (D.seatsLeft(s) <= 0) return { added: false, error: 'session_full', session_title: s.title };
          const clash = Store.all().find(i => i.type === 'session' && i.day === s.day && overlaps(i, s));
          const res = Store.add({
            type: 'session', id: s.id, label: s.title, day: s.day,
            start: s.start, end: s.end, room: s.room, amount: 0
          }, 'agent');
          if (res.added) A.product.sessionAddedToAgenda(s, 'agent');
          return {
            added: res.added, reason: res.reason || null, session_title: s.title,
            when: D.shortDay(s.day) + ' ' + D.time12(s.start),
            conflicts_with: clash ? clash.label : null,
            itinerary_size: Store.all().length
          };
        }
        if (input.type === 'hotel') {
          const h = D.HOTELS.find(x => x.id === input.id);
          if (!h) return { added: false, error: 'hotel_not_found' };
          const nights = input.nights || 3;
          const total = h.nightly * nights;
          Store.replace({
            type: 'hotel', id: h.id, label: h.name, nights: nights,
            amount: total, nightly: h.nightly
          }, 'agent');
          A.product.hotelRoomHeld(h, nights, total, 'agent');
          return { added: true, hotel_name: h.name, nights: nights, total_usd: total, itinerary_size: Store.all().length };
        }
        if (input.type === 'ticket') {
          const t = D.TICKETS.find(x => x.id === input.id);
          if (!t) return { added: false, error: 'ticket_not_found' };
          const adults = input.adults || 1;
          const children = input.children || 0;
          const unit = t.advance;
          const total = unit * adults + Math.round(unit * D.CHILD_DISCOUNT) * children;
          Store.replace({
            type: 'ticket', id: t.id, label: t.name, quantity: adults + children,
            adults: adults, children: children, amount: total
          }, 'agent');
          A.product.ticketAddedToCart(t, adults + children, total, 'agent');
          return { added: true, ticket_name: t.name, quantity: adults + children, total_usd: total, itinerary_size: Store.all().length };
        }
        return { added: false, error: 'unknown_type' };
      }
    },

    check_schedule_conflicts: {
      description: 'Check the attendee itinerary for overlapping sessions and report free blocks.',
      run() {
        const sessions = Store.all().filter(i => i.type === 'session');
        const conflicts = [];
        for (let i = 0; i < sessions.length; i++) {
          for (let j = i + 1; j < sessions.length; j++) {
            if (sessions[i].day === sessions[j].day && overlaps(sessions[i], sessions[j])) {
              conflicts.push([sessions[i].label, sessions[j].label]);
            }
          }
        }
        const byDay = {};
        sessions.forEach(s => { byDay[s.day] = (byDay[s.day] || 0) + 1; });
        return {
          session_count: sessions.length,
          conflict_count: conflicts.length,
          conflicts: conflicts,
          sessions_per_day: byDay,
          free_days: D.EVENT.conferenceDays.filter(d => !byDay[d])
        };
      }
    }
  };

  function overlaps(a, b) {
    return a.start < b.end && b.start < a.end;
  }

  /* =================================================================
     Tool runner — emits one [Agent] Tool Call per invocation, in
     execution order, before the AI Response.
  ================================================================= */

  const ranTools = [];

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
  function jitter(min, max) { return min + Math.random() * (max - min); }

  async function callTool(name, input, parentMessageId) {
    const tool = TOOLS[name];
    const started = performance.now();
    let output, success = true, errorMessage;

    // A real lookup takes a real moment; awaited so the latency we
    // report is measured wall-clock rather than a made-up number.
    await delay(jitter(90, 340));

    try {
      if (!tool) throw new Error('Unknown tool: ' + name);
      output = tool.run(input || {});
    } catch (e) {
      success = false;
      errorMessage = e && e.message ? e.message : String(e);
      output = { error: errorMessage };
    }

    const latencyMs = performance.now() - started;
    T.trackToolCall({ name, input, output, success, latencyMs, parentMessageId });
    ranTools.push({ name, input, output, success, latencyMs });
    return output;
  }

  /* =================================================================
     Intent routing
  ================================================================= */

  const TRACK_HINTS = {
    ai: ['ai', 'agent', 'agents', 'llm', 'llms', 'genai', 'model', 'eval', 'evals', 'chatbot', 'copilot'],
    platform: ['platform', 'engineering', 'pipeline', 'pipelines', 'ingest', 'streaming', 'warehouse', 'infrastructure', 'architecture', 'identity', 'kafka'],
    governance: ['governance', 'privacy', 'compliance', 'consent', 'trust', 'contract', 'contracts', 'security', 'quality'],
    experience: ['guest', 'experience', 'retention', 'cohort', 'cohorts', 'cx', 'personalization', 'experimentation', 'forecasting'],
    leadership: ['leadership', 'strategy', 'executive', 'exec', 'org', 'team', 'manager', 'roadmap', 'keynote']
  };

  const PARK_HINTS = {
    wonderworks: ['wonderworks', 'kingdom', 'castle', 'fireworks'],
    'frontier-falls': ['frontier', 'falls', 'rapids', 'copper mine'],
    cinescape: ['cinescape', 'studios', 'backlot', 'stunt'],
    wildhaven: ['wildhaven', 'preserve', 'safari', 'canopy', 'animals'],
    tidewash: ['tidewash', 'lagoon water', 'wave pool'],
    frostpeak: ['frostpeak', 'cove'],
    'lantern-row': ['lantern row', 'lantern', 'shopping', 'springs', 'nightlife']
  };

  const LOGISTICS_HINTS = {
    badge: ['badge', 'check in', 'check-in', 'registration desk', 'lanyard', 'credential', 'pick up my badge'],
    shuttle: ['shuttle', 'bus', 'transport', 'get to the conference', 'getting around', 'monorail'],
    parking: ['parking', 'park my car', 'valet', 'self-park'],
    wifi: ['wifi', 'wi-fi', 'internet', 'network', 'password'],
    airport: ['airport', 'flight', 'lsi', 'terminal', 'uber', 'lyft', 'rideshare', 'coach'],
    weather: ['weather', 'rain', 'hot', 'temperature', 'humidity', 'what to pack', 'pack'],
    accessibility: ['accessible', 'accessibility', 'wheelchair', 'asl', 'captioning', 'dietary', 'mobility'],
    evening: ['evening event', 'after party', 'afterparty', 'private event', 'attendee party', 'reception', 'night event']
  };

  function normalize(text) {
    return ' ' + text.toLowerCase().replace(/[^\w\s'/-]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  }

  function anyOf(norm, words) {
    return words.some(w => norm.includes(' ' + w + ' ') || norm.includes(' ' + w));
  }

  function extract(text) {
    const norm = normalize(text);
    const e = { raw: text, norm: norm };

    // Day
    const dayNames = { monday: 0, mon: 0, tuesday: 1, tue: 1, tues: 1, wednesday: 2, wed: 2 };
    Object.keys(dayNames).forEach(k => {
      if (norm.includes(' ' + k)) e.day = D.EVENT.conferenceDays[dayNames[k]];
    });
    const dayNum = norm.match(/ day (one|two|three|1|2|3) /);
    if (dayNum) {
      const map = { one: 0, two: 1, three: 2, '1': 0, '2': 1, '3': 2 };
      e.day = D.EVENT.conferenceDays[map[dayNum[1]]];
    }
    const dateMatch = norm.match(/ (?:9\/|09\/|sept?e?m?b?e?r? ?)(1[1-7]) /);
    if (dateMatch) {
      const iso = '2026-09-' + dateMatch[1];
      if (D.SESSIONS.some(s => s.day === iso)) e.day = iso;
    }

    // Track
    Object.keys(TRACK_HINTS).forEach(t => { if (anyOf(norm, TRACK_HINTS[t])) e.track = e.track || t; });

    // Hotel, before parks: "Frontier Falls Lodge" is a hotel, and
    // "Frontier Falls" is a park, so the hotel has to win the phrase.
    e.hotel = (D.HOTELS.find(h => norm.includes(h.name.toLowerCase())) || {}).id;

    // Park
    if (!e.hotel) {
      Object.keys(PARK_HINTS).forEach(p => { if (PARK_HINTS[p].some(h => norm.includes(h))) e.park = e.park || p; });
    }

    // Logistics topic
    Object.keys(LOGISTICS_HINTS).forEach(t => {
      if (LOGISTICS_HINTS[t].some(h => norm.includes(h))) e.logistics = e.logistics || t;
    });

    // Level
    if (norm.includes('beginner') || norm.includes('intro') || norm.includes('new to')) e.level = 'Beginner';
    if (norm.includes('advanced') || norm.includes('deep dive') || norm.includes('technical')) e.level = 'Advanced';

    // Meal
    if (norm.includes('breakfast') || norm.includes('coffee')) e.meal = 'breakfast';
    if (norm.includes('lunch')) e.meal = 'lunch';
    if (norm.includes('dinner') || norm.includes('supper')) e.meal = 'dinner';

    // Party size
    const adults = norm.match(/ (\d+) (?:adults?|people|of us|attendees?|guests?) /);
    if (adults) e.adults = Math.min(12, parseInt(adults[1], 10));
    const kids = norm.match(/ (\d+) (?:kids?|children|child) /);
    if (kids) e.children = Math.min(10, parseInt(kids[1], 10));
    if (!e.children && (norm.includes(' my kid') || norm.includes(' my child'))) e.children = 1;

    // Nights / days
    const nights = norm.match(/ (\d+) nights? /);
    if (nights) e.nights = Math.min(14, parseInt(nights[1], 10));
    const tdays = norm.match(/ (\d+)[ -]day /);
    if (tdays) e.ticketDays = Math.min(5, parseInt(tdays[1], 10));
    if (norm.includes('half day') || norm.includes('partial day') || norm.includes('a few hours') || norm.includes('after sessions')) e.ticketDays = 0.5;

    // Budget
    const budget = norm.match(/ (?:under|below|less than|max|budget of|up to) \$?(\d{2,4}) /);
    if (budget) e.maxNightly = parseInt(budget[1], 10);

    // Speaker
    const speaker = D.SESSIONS.map(s => s.speaker).find(name => {
      const last = name.split(' ').pop().toLowerCase();
      return norm.includes(' ' + last) && last.length > 3;
    });
    if (speaker) e.speaker = speaker;

    return e;
  }

  const INTENTS = [
    { id: 'greeting', words: ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'help', 'what can you do', 'who are you'], weight: 1 },
    { id: 'event_basics', words: ['when is', 'what dates', 'where is', 'how many attendees', 'what is edac', 'about the conference', 'venue', 'location'], weight: 2 },
    { id: 'agenda_recommend', words: ['what should i', 'recommend', 'suggest', 'build my agenda', 'plan my agenda', 'build me an agenda', 'must see', 'best sessions', 'worth attending', 'worth my time', 'what sessions', 'which sessions', 'should i attend', 'should i go', 'help me pick', 'i am a', "i'm a", 'i work', 'my role'], weight: 3 },
    { id: 'agenda_search', words: ['session', 'sessions', 'talk', 'talks', 'agenda', 'schedule', 'keynote', 'lab', 'workshop', 'track', 'speaking', 'speaker', 'what time is'], weight: 2 },
    { id: 'hotel', words: ['hotel', 'room', 'stay', 'resort', 'book a room', 'accommodation', 'where should i stay', 'nights'], weight: 3 },
    { id: 'tickets', words: ['ticket', 'tickets', 'park pass', 'admission', 'how much', 'price', 'cost', 'buy', 'discount', 'savings'], weight: 3 },
    { id: 'dining', words: ['eat', 'dinner', 'lunch', 'breakfast', 'restaurant', 'food', 'dining', 'reservation', 'coffee', 'drinks'], weight: 3 },
    { id: 'park_hours', words: ['park hours', 'open', 'close', 'closing', 'what time do the parks', 'crowd', 'busy', 'busiest'], weight: 3 },
    { id: 'evening_plan', words: ['evening', 'after the sessions', 'downtime', 'unwind', 'free time', 'tonight', 'plan my night', 'what to do after'], weight: 3 },
    { id: 'itinerary', words: ['my itinerary', 'my agenda', 'my plan', 'what do i have', 'my schedule', 'what have i', 'conflicts', 'total'], weight: 4 },
    { id: 'add', words: ['add', 'sign me up', 'register me', 'book it', 'reserve', 'hold', 'save that', 'put that', 'yes please', 'do it'], weight: 3 },
    { id: 'logistics', words: [], weight: 4 },
    { id: 'handoff', words: ['human', 'talk to someone', 'agent desk', 'representative', 'call someone', 'complaint', 'refund', 'cancel my registration'], weight: 5 }
  ];

  function classify(text, entities, memory) {
    const norm = entities.norm;
    const scores = {};

    INTENTS.forEach(intent => {
      let score = 0;
      intent.words.forEach(w => { if (norm.includes(' ' + w)) score += intent.weight; });
      if (score) scores[intent.id] = (scores[intent.id] || 0) + score;
    });

    // An imperative opening verb is a booking instruction, not a fresh
    // lookup: "add the 3-day ticket" must not re-price the whole table.
    if (/^ (add|book|reserve|hold|save|sign me up|register me|put) /.test(norm)) {
      scores.add = (scores.add || 0) + 9;
    }
    if (entities.hotel) scores.hotel = (scores.hotel || 0) + 2;

    // A stated role is a strong signal for "recommend", not "search":
    // the attendee is asking us to choose, not to list matches.
    if (detectRole(norm)) scores.agenda_recommend = (scores.agenda_recommend || 0) + 5;

    if (entities.logistics) scores.logistics = (scores.logistics || 0) + 6;
    if (entities.park) scores.park_hours = (scores.park_hours || 0) + 1;
    if (entities.track) scores.agenda_search = (scores.agenda_search || 0) + 2;
    if (entities.day) scores.agenda_search = (scores.agenda_search || 0) + 2;
    if (entities.speaker) scores.agenda_search = (scores.agenda_search || 0) + 3;
    if (entities.maxNightly) scores.hotel = (scores.hotel || 0) + 2;
    if (entities.nights) scores.hotel = (scores.hotel || 0) + 2;
    if (entities.ticketDays) scores.tickets = (scores.tickets || 0) + 3;
    if (entities.meal) scores.dining = (scores.dining || 0) + 2;

    // Short confirmations continue the previous topic.
    const isShort = norm.trim().split(' ').length <= 4;
    if (isShort && /\b(yes|yeah|yep|sure|ok|okay|please|do it|go ahead|sounds good|that one|the first|first one|second)\b/.test(norm)) {
      scores.add = (scores.add || 0) + 8;
    }
    if (isShort && memory.lastIntent && !Object.keys(scores).length) {
      scores[memory.lastIntent] = 1;
    }

    const best = Object.keys(scores).sort((a, b) => scores[b] - scores[a])[0];
    return { intent: best || 'fallback', scores: scores };
  }

  /* =================================================================
     Handlers — each returns { blocks, suggestions }
  ================================================================= */

  const memory = { lastIntent: null, lastSessions: [], lastHotels: [], lastTickets: [], party: {}, role: null };

  function money(n) { return '$' + Number(n).toLocaleString('en-US'); }

  const handlers = {
    async greeting() {
      return {
        blocks: [{ kind: 'text', md: `I'm the **${D.EVENT.code} Concierge**. I can build your session agenda, book a resort room at the attendee rate, price park tickets for your party, and sort out badges, shuttles, dining, and park hours.\n\nWhat are you working on first?` }],
        suggestions: ['Build me an AI track agenda', 'Where should I stay?', 'Price tickets for 2 adults and 1 kid', 'When can I pick up my badge?']
      };
    },

    async event_basics() {
      return {
        blocks: [{
          kind: 'text', md:
            `**${D.EVENT.name} (${D.EVENT.code})** runs **${D.dayLabel(D.EVENT.startDate)} through ${D.dayLabel(D.EVENT.endDate)}** at the **${D.EVENT.venue}** in ${D.EVENT.city}.\n\n` +
            `Sessions are concentrated on the three conference days — ${D.EVENT.conferenceDays.map(d => D.shortDay(d)).join(', ')} — with ${D.FACTS.sessions} sessions across ${D.TRACKS.length} tracks and ${D.FACTS.labs} hands-on labs. Last year drew about ${D.FACTS.attendees.toLocaleString()} attendees from ${D.FACTS.countries} countries.\n\n` +
            `Your ticket window runs 7 days either side of the event, so you can extend the trip in either direction.`
        }],
        suggestions: ['Show me the Monday schedule', 'What tracks are there?', 'Where should I stay?']
      };
    },

    async agenda_search(e, parentId) {
      const structured = !!(e.day || e.track || e.level || e.speaker);
      let out = await callTool('search_agenda', {
        query: queryTerms(e), day: e.day, track: e.track, level: e.level, speaker: e.speaker, limit: 4
      }, parentId);

      // A keyword that matches nothing on top of real filters is noise,
      // not a miss — re-run on the filters alone and answer directly.
      if (!out.match_count && structured) {
        out = await callTool('search_agenda', { day: e.day, track: e.track, level: e.level, speaker: e.speaker, limit: 4 }, parentId);
      }

      if (!out.match_count) {
        const fallback = await callTool('search_agenda', { day: e.day, track: e.track, limit: 3 }, parentId);
        if (!fallback.match_count) {
          return {
            blocks: [{ kind: 'text', md: `I couldn't find a session matching that. The tracks this year are ${D.TRACKS.map(t => '**' + t.name + '**').join(', ')} — want me to list a track, or a specific day?` }],
            suggestions: D.TRACKS.slice(0, 3).map(t => 'Show me the ' + t.name + ' track')
          };
        }
        memory.lastSessions = fallback.sessions.map(s => s.id);
        return {
          blocks: [
            { kind: 'text', md: `Nothing matched exactly, but here's what's closest${e.day ? ' on ' + D.shortDay(e.day) : ''}:` },
            { kind: 'sessions', items: fallback.sessions.map(s => s.id) }
          ],
          suggestions: ['Add the first one to my agenda', 'Show me another day']
        };
      }

      memory.lastSessions = out.sessions.map(s => s.id);
      const scope = [
        e.track ? D.trackName(e.track) : null,
        e.level ? e.level + '-level' : null,
        e.day ? 'on ' + D.shortDay(e.day) : null,
        e.speaker ? 'from ' + e.speaker : null
      ].filter(Boolean).join(' ');

      const header = out.match_count > out.returned
        ? `${out.match_count} sessions match${scope ? ' ' + scope : ''}. Here are the ${out.returned} I'd start with:`
        : `Found ${out.match_count} session${out.match_count === 1 ? '' : 's'}${scope ? ' ' + scope : ''}:`;

      const full = out.sessions.filter(s => s.seats_left === 0);
      const blocks = [{ kind: 'text', md: header }, { kind: 'sessions', items: out.sessions.map(s => s.id) }];
      if (full.length) {
        blocks.push({ kind: 'note', md: `**${full.map(s => s.title).join('** and **')}** ${full.length === 1 ? 'is' : 'are'} at capacity — the attendee desk keeps a standby list at the door.` });
      }
      return { blocks, suggestions: ['Add the first one', 'Anything on the same day?', 'Check my agenda for conflicts'] };
    },

    async agenda_recommend(e, parentId) {
      const role = detectRole(e.norm) || memory.role;
      if (role) memory.role = role;
      const track = e.track || (role && role.track) || 'ai';

      const out = await callTool('search_agenda', { track: track, availableOnly: true, limit: 3 }, parentId);
      const second = await callTool('search_agenda', { track: 'leadership', query: 'keynote', limit: 1 }, parentId);

      const picks = out.sessions.concat(second.sessions).slice(0, 4);
      memory.lastSessions = picks.map(s => s.id);

      const lead = role
        ? `For a ${role.label}, I'd anchor on the **${D.trackName(track)}** track:`
        : `Starting from the **${D.trackName(track)}** track, these have the strongest signal:`;

      return {
        blocks: [
          { kind: 'text', md: lead },
          { kind: 'sessions', items: picks.map(s => s.id) },
          { kind: 'note', md: `That's one session per block with the opening keynote included. Want me to add all four and check for conflicts?` }
        ],
        suggestions: ['Add all four', 'More advanced options', 'What about the governance track?']
      };
    },

    async hotel(e, parentId) {
      const nights = e.nights || memory.party.nights || 3;
      memory.party.nights = nights;
      const out = await callTool('lookup_hotels', {
        nights: nights, maxNightly: e.maxNightly, walkToVenue: /walk|close to|near the (conference|venue|sessions)|attached/.test(e.norm) || undefined
      }, parentId);

      if (!out.match_count) {
        const all = await callTool('lookup_hotels', { nights: nights }, parentId);
        memory.lastHotels = all.hotels.map(h => h.id);
        return {
          blocks: [
            { kind: 'text', md: `Nothing on property comes in under ${money(e.maxNightly)} a night at the attendee rate. The closest is **${all.hotels[all.hotels.length - 1].name}** at ${money(all.hotels[all.hotels.length - 1].nightly_usd)}. Here's the full list:` },
            { kind: 'hotels', items: all.hotels.map(h => h.id), nights: nights }
          ],
          suggestions: ['Hold the Lantern Row Inn', 'What is included at the attendee rate?']
        };
      }

      memory.lastHotels = out.hotels.map(h => h.id);
      const best = out.hotels[0];
      return {
        blocks: [
          { kind: 'text', md: `${out.match_count} option${out.match_count === 1 ? '' : 's'} at the attendee rate for **${nights} night${nights === 1 ? '' : 's'}**. If proximity matters, **${best.name}** is the pick — ${best.walk_to_venue ? 'covered walkway straight to the session rooms' : best.minutes_to_venue + ' minutes by shuttle'}.` },
          { kind: 'hotels', items: out.hotels.map(h => h.id), nights: nights }
        ],
        suggestions: ['Hold the ' + best.name, 'Anything cheaper?', 'How do shuttles work?']
      };
    },

    async tickets(e, parentId) {
      const adults = e.adults || memory.party.adults || 1;
      const children = e.children || memory.party.children || 0;
      memory.party.adults = adults;
      memory.party.children = children;

      const out = await callTool('price_tickets', {
        adults, children, days: e.ticketDays, advance: true
      }, parentId);

      memory.lastTickets = out.options.map(o => o.id);
      const party = adults + ' adult' + (adults === 1 ? '' : 's') + (children ? ' and ' + children + ' child' + (children === 1 ? '' : 'ren') : '');
      const totalSavings = out.options.reduce((max, o) => Math.max(max, o.savings_vs_gate_usd), 0);

      return {
        blocks: [
          { kind: 'text', md: `Advance attendee pricing for **${party}**. Advance rates hold through **${D.dayLabel(D.EVENT.advancePurchaseDeadline)}**, after which these go to gate price — up to ${money(totalSavings)} more for your party.` },
          { kind: 'tickets', items: out.options },
          { kind: 'note', md: `Tickets are valid from 7 days before the event through 7 days after, so you can use them before sessions start or stay on after.` }
        ],
        suggestions: ['Add the 3-day ticket', 'What are partial-day tickets?', 'What are park hours?']
      };
    },

    async dining(e, parentId) {
      const out = await callTool('find_dining', { park: e.park, meal: e.meal }, parentId);
      if (!out.match_count) {
        const all = await callTool('find_dining', {}, parentId);
        return {
          blocks: [
            { kind: 'text', md: `Nothing on property matches that exactly. Here's everything at the resort:` },
            { kind: 'dining', items: all.restaurants }
          ],
          suggestions: ['Where can I get breakfast before the keynote?', 'Dinner near the conference center']
        };
      }
      const hard = out.restaurants.filter(r => r.reservation_difficulty === 'hard');
      return {
        blocks: [
          { kind: 'text', md: `${out.match_count} option${out.match_count === 1 ? '' : 's'}${e.meal ? ' for ' + e.meal : ''}${e.park ? ' at ' + (D.park(e.park) || {}).name : ''}:` },
          { kind: 'dining', items: out.restaurants },
          hard.length
            ? { kind: 'note', md: `**${hard.map(r => r.name).join('** and **')}** book out about three weeks ahead — worth locking in now if either is on your list.` }
            : null
        ].filter(Boolean),
        suggestions: ['Plan my Tuesday evening', 'What time do the parks close?']
      };
    },

    async park_hours(e, parentId) {
      const out = await callTool('get_park_hours', { parkId: e.park }, parentId);
      const rows = out.parks;
      return {
        blocks: [
          { kind: 'text', md: rows.length === 1
            ? `**${rows[0].name}** runs **${rows[0].hours}** during the event. Busiest window is ${rows[0].busiest.toLowerCase()} — after 6 PM is the quietest stretch and lines up well with an evening after sessions.`
            : `Hours during the event week:` },
          rows.length > 1 ? { kind: 'hours', items: rows } : null,
          { kind: 'note', md: `Sessions wrap between 3:30 and 4:30 PM most days, which leaves a solid four to five hours of park time on a partial-day ticket.` }
        ].filter(Boolean),
        suggestions: ['Plan my Tuesday evening', 'Price a partial-day ticket', 'Where should I eat in the park?']
      };
    },

    async evening_plan(e, parentId) {
      const day = e.day || D.EVENT.conferenceDays[1];
      const sessions = await callTool('search_agenda', { day: day, limit: 12 }, parentId);
      const hours = await callTool('get_park_hours', { kind: 'theme park' }, parentId);
      const food = await callTool('find_dining', { meal: 'dinner' }, parentId);

      const last = sessions.sessions.reduce((latest, s) => (s.end > latest ? s.end : latest), '00:00');
      const openLate = hours.parks.sort((a, b) => b.hours.localeCompare(a.hours))[0];
      const pick = food.restaurants.find(r => r.reservation_difficulty !== 'hard') || food.restaurants[0];
      const isEveningEvent = day === D.EVENT.conferenceDays[2];

      const plan = isEveningEvent
        ? `**${D.dayLabel(day)}** is the attendee evening event — ${D.LOGISTICS.evening.body}\n\nSo the shape of that night is: sessions end at **${D.time12(last)}**, dinner around **6:00 PM**, then straight into the park at 7:30.`
        : `Here's a clean **${D.dayLabel(day)}** evening:\n\n` +
          `- **${D.time12(last)}** — last session ends\n` +
          `- **${D.time12('17:30')}** — dinner at **${pick.name}** (${pick.style}, ${pick.price}, ${pick.location})\n` +
          `- **${D.time12('19:00')}** — into **${openLate.name}**, open until ${openLate.hours.split('–')[1].trim()}. Evening is its quietest stretch.\n` +
          `- Shuttles run back to all four hotels until 11:30 PM.`;

      return {
        blocks: [
          { kind: 'text', md: plan },
          { kind: 'note', md: `A partial-day ticket at ${money(D.TICKETS[0].advance)} covers this — it's valid after 2 PM, which is exactly the window you have.` }
        ],
        suggestions: ['Add a partial-day ticket', 'Plan Monday evening instead', 'Book dinner somewhere nicer']
      };
    },

    async itinerary(e, parentId) {
      const out = await callTool('check_schedule_conflicts', {}, parentId);
      const items = Store.all();

      if (!items.length) {
        return {
          blocks: [{ kind: 'text', md: `Your itinerary is empty so far. Tell me your role or a track you care about and I'll build a first draft of the three conference days.` }],
          suggestions: ['I am a data engineer, build my agenda', 'Where should I stay?', 'Price tickets for 2']
        };
      }

      const blocks = [
        { kind: 'text', md: `You have **${items.length} item${items.length === 1 ? '' : 's'}** on your itinerary${Store.totalUsd() ? `, ${money(Store.totalUsd())} in bookings` : ''}.` },
        { kind: 'itinerary' }
      ];

      if (out.conflict_count) {
        blocks.push({ kind: 'note', md: `**${out.conflict_count} conflict${out.conflict_count === 1 ? '' : 's'}:** ` + out.conflicts.map(c => `“${c[0]}” overlaps “${c[1]}”`).join('; ') + `. Both are repeated as recordings, so pick one live and catch the other after.` });
      } else if (out.session_count) {
        blocks.push({ kind: 'note', md: `No conflicts.${out.free_days.length ? ' You have nothing booked on ' + out.free_days.map(d => D.shortDay(d)).join(' or ') + ' — want suggestions?' : ''}` });
      }

      return { blocks, suggestions: out.free_days.length ? ['Fill in ' + D.shortDay(out.free_days[0])] : ['Price my tickets', 'Where should I stay?'] };
    },

    async add(e, parentId) {
      // Resolve what "it" refers to from the last thing shown.
      const norm = e.norm;
      const wantsAll = /\ball (four|three|of them|of these)?\b/.test(norm) || norm.includes(' add them all');
      const ordinal = /\b(first|1st)\b/.test(norm) ? 0 : /\b(second|2nd)\b/.test(norm) ? 1 : /\b(third|3rd)\b/.test(norm) ? 2 : null;

      // Explicit name match wins over ordinals.
      const namedSession = D.SESSIONS.find(s => norm.includes(' ' + s.title.toLowerCase().split(':')[0].toLowerCase()));
      const HOTEL_WORDS = { 'grand-lagoon': ['grand lagoon', 'grand'], 'skyline-tower': ['skyline'], 'frontier-lodge': ['frontier falls lodge', 'the lodge', 'lodge'], 'lantern-inn': ['lantern row inn', 'the inn'] };
      const namedHotel = D.HOTELS.find(h => h.id === e.hotel)
        || D.HOTELS.find(h => (HOTEL_WORDS[h.id] || []).some(w => norm.includes(' ' + w)));
      const namedTicket = D.TICKETS.find(t => norm.includes(t.name.toLowerCase()) || (e.ticketDays && t.days === e.ticketDays));

      const results = [];

      if (namedHotel || (memory.lastIntent === 'hotel' && (ordinal !== null || !namedSession))) {
        const hotelId = namedHotel ? namedHotel.id : memory.lastHotels[ordinal || 0];
        if (hotelId) {
          results.push(await callTool('add_to_itinerary', { type: 'hotel', id: hotelId, nights: memory.party.nights || 3 }, parentId));
        }
      } else if (namedTicket || (memory.lastIntent === 'tickets' && (ordinal !== null || memory.lastTickets.length))) {
        const ticketId = namedTicket ? namedTicket.id : memory.lastTickets[ordinal || 0];
        if (ticketId) {
          results.push(await callTool('add_to_itinerary', {
            type: 'ticket', id: ticketId, adults: memory.party.adults || 1, children: memory.party.children || 0
          }, parentId));
        }
      } else {
        const ids = namedSession
          ? [namedSession.id]
          : wantsAll ? memory.lastSessions.slice()
          : memory.lastSessions.length ? [memory.lastSessions[ordinal || 0]] : [];
        for (const id of ids) {
          if (id) results.push(await callTool('add_to_itinerary', { type: 'session', id: id }, parentId));
        }
      }

      if (!results.length) {
        return {
          blocks: [{ kind: 'text', md: `I want to make sure I add the right thing — which one did you mean? Name the session, hotel, or ticket and I'll put it on your itinerary.` }],
          suggestions: ['Show me the AI track', 'Show me hotels', 'Price tickets']
        };
      }

      const added = results.filter(r => r.added);
      const failed = results.filter(r => !r.added);
      const lines = added.map(r => {
        if (r.session_title) return `- **${r.session_title}** — ${r.when}`;
        if (r.hotel_name) return `- **${r.hotel_name}** — ${r.nights} nights, ${money(r.total_usd)}`;
        if (r.ticket_name) return `- **${r.ticket_name}** ×${r.quantity} — ${money(r.total_usd)}`;
        return null;
      }).filter(Boolean);

      const blocks = [];
      if (lines.length) blocks.push({ kind: 'text', md: `Added to your itinerary:\n\n${lines.join('\n')}` });
      if (added.some(r => r.conflicts_with)) {
        const c = added.find(r => r.conflicts_with);
        blocks.push({ kind: 'note', md: `Heads up — that overlaps **${c.conflicts_with}** already on your plan.` });
      }
      failed.forEach(r => {
        if (r.error === 'session_full') blocks.push({ kind: 'note', md: `**${r.session_title}** is at capacity, so I couldn't add it. Standby seating opens 10 minutes before the session at the door.` });
        else if (r.reason === 'already-present') blocks.push({ kind: 'note', md: `That one was already on your itinerary.` });
      });
      blocks.push({ kind: 'itinerary' });

      return { blocks, suggestions: ['Check for conflicts', 'What else should I add?', 'Show my itinerary'] };
    },

    async logistics(e, parentId) {
      const topic = e.logistics || 'badge';
      const out = await callTool('get_logistics', { topic: topic }, parentId);
      if (!out.found) {
        return {
          blocks: [{ kind: 'text', md: `I can cover badges, shuttles, parking, Wi-Fi, airport transfer, weather, accessibility, and the attendee evening event. Which one?` }],
          suggestions: ['Badge pickup', 'Shuttle schedule', 'What should I pack?']
        };
      }
      return {
        blocks: [{ kind: 'text', md: `**${out.title}**\n\n${out.body}` }],
        suggestions: ['What about parking?', 'How do I get from the airport?', 'Show me the Monday schedule']
      };
    },

    async handoff(e, parentId) {
      return {
        blocks: [{
          kind: 'text', md:
            `That one needs a person. The attendee desk handles registration changes, refunds, and anything billing-related:\n\n` +
            `- **Email** ${D.EVENT.supportEmail}\n- **Phone** ${D.EVENT.supportPhone}, 8 AM–8 PM ET\n- **In person** Grand Lagoon lobby, daily from 7:30 AM\n\n` +
            `I've noted the conversation reference **${T.sessionId}** — quote it and they'll see this thread.`
        }],
        suggestions: ['Back to my agenda', 'Show my itinerary']
      };
    },

    async fallback(e, parentId) {
      // Try a broad agenda search before admitting defeat — most
      // unmatched questions are still about a session.
      const out = await callTool('search_agenda', { query: stripStopWords(e.raw), limit: 3 }, parentId);
      if (out.match_count) {
        memory.lastSessions = out.sessions.map(s => s.id);
        return {
          blocks: [
            { kind: 'text', md: `I'm not certain that's what you meant, but these look related:` },
            { kind: 'sessions', items: out.sessions.map(s => s.id) }
          ],
          suggestions: ['That is not what I meant', 'Show me hotels', 'Price tickets']
        };
      }
      return {
        blocks: [{
          kind: 'text', md:
            `I couldn't work that one out. I'm good at four things:\n\n` +
            `- **Sessions** — search the ${D.FACTS.sessions}-session agenda, build a day, check conflicts\n` +
            `- **Hotels** — attendee rates and how far each one is from the session rooms\n` +
            `- **Tickets** — party pricing, advance savings, partial-day options\n` +
            `- **Logistics** — badges, shuttles, parking, Wi-Fi, airport, dining, park hours\n\n` +
            `Anything outside that, the attendee desk can take: ${D.EVENT.supportEmail}.`
        }],
        suggestions: ['Build my agenda', 'Where should I stay?', 'When is badge pickup?']
      };
    }
  };

  const ROLES = [
    { match: ['data engineer', 'platform engineer', 'infrastructure', 'pipeline'], label: 'data engineer', track: 'platform' },
    { match: ['data scientist', 'ml engineer', 'machine learning', 'analyst'], label: 'data scientist', track: 'experience' },
    { match: ['ai engineer', 'agent', 'llm', 'applied ai'], label: 'AI engineer', track: 'ai' },
    { match: ['product manager', 'pm ', 'product lead'], label: 'product manager', track: 'experience' },
    { match: ['privacy', 'legal', 'compliance', 'governance lead'], label: 'privacy lead', track: 'governance' },
    { match: ['director', 'vp', 'head of', 'executive', 'cdo', 'cto'], label: 'data leader', track: 'leadership' }
  ];

  function detectRole(norm) {
    return ROLES.find(r => r.match.some(m => norm.includes(m))) || null;
  }

  // Words already consumed as a filter (a track, a day, a level) would
  // only fight the keyword search, so drop them from the query.
  const ENTITY_WORDS = new Set(
    Object.keys(TRACK_HINTS).reduce((acc, k) => acc.concat(TRACK_HINTS[k]), [])
      .concat(['monday', 'mon', 'tuesday', 'tue', 'tues', 'wednesday', 'wed', 'day', 'beginner', 'advanced', 'intermediate', 'track', 'session', 'sessions', 'talk', 'talks', 'agenda', 'schedule'])
  );

  function queryTerms(e) {
    return stripStopWords(e.raw).split(' ').filter(w => !ENTITY_WORDS.has(w)).join(' ');
  }

  const STOP = new Set(('a an the is are was were do does did what when where which who how i me my we our you your can could would should tell show find give about for to of on in at and or with please me any some there that this it its need want looking'.split(' ')));
  function stripStopWords(text) {
    return text.toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)).join(' ');
  }

  /* =================================================================
     Turn orchestration
  ================================================================= */

  function blocksToText(blocks) {
    return blocks
      .map(b => {
        if (b.kind === 'text' || b.kind === 'note') return b.md;
        if (b.kind === 'sessions') {
          return b.items.map(id => {
            const s = D.SESSIONS.find(x => x.id === id);
            return s ? `• ${s.title} — ${D.shortDay(s.day)} ${D.time12(s.start)}, ${s.room} (${D.trackName(s.track)}, ${D.seatsLeft(s)} seats left)` : '';
          }).join('\n');
        }
        if (b.kind === 'hotels') {
          return b.items.map(id => {
            const h = D.HOTELS.find(x => x.id === id);
            return h ? `• ${h.name} — ${money(h.nightly)}/night, ${h.walkToVenue ? 'walk to sessions' : h.minutesToVenue + ' min shuttle'}` : '';
          }).join('\n');
        }
        if (b.kind === 'tickets') {
          return b.items.map(t => `• ${t.name} — ${money(t.unit_price_usd)} each, party total ${money(t.party_total_usd)}`).join('\n');
        }
        if (b.kind === 'dining') {
          return b.items.map(r => `• ${r.name} — ${r.style}, ${r.price}, ${r.location}`).join('\n');
        }
        if (b.kind === 'hours') {
          return b.items.map(p => `• ${p.name} — ${p.hours}`).join('\n');
        }
        if (b.kind === 'itinerary') {
          return Store.all().map(i => `• ${i.label}${i.amount ? ' — ' + money(i.amount) : ''}`).join('\n');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }

  async function respondRemote(text, parentMessageId) {
    const res = await fetch(CONFIG.agentEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        sessionId: T.sessionId,
        turnId: T.turnId,
        userId: A.userId(),
        systemPrompt: SYSTEM_PROMPT
      })
    });
    if (!res.ok) throw new Error('Agent endpoint returned ' + res.status);
    const data = await res.json();

    // Tool calls the server reports get emitted here so the event
    // stream matches the local path exactly.
    (data.toolCalls || []).forEach(tc => {
      T.trackToolCall({
        name: tc.name, input: tc.input, output: tc.output,
        success: tc.success !== false, latencyMs: tc.latencyMs || 0,
        parentMessageId: parentMessageId
      });
    });

    return {
      blocks: [{ kind: 'text', md: data.text || '' }],
      suggestions: data.suggestions || [],
      usage: data.usage,
      model: data.model
    };
  }

  async function respond(text) {
    ranTools.length = 0;
    const turnStart = performance.now();

    T.beginTurn();
    const parentMessageId = T.trackUserMessage(text);

    const entities = extract(text);
    let reply, isError = false, errorMessage;

    try {
      if (CONFIG.agentEndpoint) {
        reply = await respondRemote(text, parentMessageId);
      } else {
        const { intent } = classify(text, entities, memory);
        reply = await handlers[intent](entities, parentMessageId);
        memory.lastIntent = intent;
        reply.intent = intent;
      }
    } catch (err) {
      isError = true;
      errorMessage = err && err.message ? err.message : String(err);
      reply = {
        blocks: [{ kind: 'text', md: `Something went wrong on my side just now. The attendee desk can help directly at ${D.EVENT.supportEmail} or ${D.EVENT.supportPhone}.` }],
        suggestions: ['Try again', 'Show my itinerary']
      };
    }

    const plainText = blocksToText(reply.blocks);

    // Reading time before the reply lands, so the reported latency is
    // measured wall-clock for the whole turn including tool calls.
    await delay(jitter(320, 900));

    const aiMessageId = T.trackAiResponse({
      text: plainText,
      systemPrompt: SYSTEM_PROMPT,
      promptContext: JSON.stringify(ranTools.map(t => t.output)),
      userText: text,
      latencyMs: performance.now() - turnStart,
      isError: isError,
      errorMessage: errorMessage,
      finishReason: isError ? 'error' : 'stop',
      inputTokens: reply.usage && reply.usage.inputTokens,
      outputTokens: reply.usage && reply.usage.outputTokens,
      modelName: reply.model && reply.model.name,
      provider: reply.model && reply.model.provider
    });

    return {
      messageId: aiMessageId,
      blocks: reply.blocks,
      suggestions: reply.suggestions || [],
      intent: reply.intent || null,
      toolsUsed: ranTools.map(t => t.name)
    };
  }

  function reset() {
    T.endSession('completed');
    memory.lastIntent = null;
    memory.lastSessions = [];
    memory.lastHotels = [];
    memory.lastTickets = [];
    memory.party = {};
    memory.role = null;
    T.startSession('reset');
  }

  return {
    respond, reset, SYSTEM_PROMPT,
    tools: Object.keys(TOOLS),
    get memory() { return memory; },
    openers: [
      'Build me an agenda for the AI track',
      'Where should I stay near the sessions?',
      'Price tickets for 2 adults and 1 kid',
      'Plan my Tuesday evening',
      'When can I pick up my badge?'
    ]
  };
})();
