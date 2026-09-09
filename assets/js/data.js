/* ------------------------------------------------------------------
   EDAC 2026 — fictional event data.
   Everything in this file is invented for demo purposes.
------------------------------------------------------------------ */

window.EDAC = (function () {
  const EVENT = {
    code: 'EDAC 2026',
    name: 'Everbright Data & Analytics Conference',
    edition: 'External',
    startDate: '2026-09-11',
    endDate: '2026-09-17',
    conferenceDays: ['2026-09-14', '2026-09-15', '2026-09-16'],
    advancePurchaseDeadline: '2026-09-11',
    venue: 'Everbright Bay Resort',
    city: 'Lumina Springs, Florida',
    ticketWindowDays: 7,
    supportEmail: 'attendees@everbrightevents.example',
    supportPhone: '(407) 555-0188'
  };

  const PARKS = [
    { id: 'wonderworks', name: 'Wonderworks Kingdom', kind: 'theme park', blurb: 'The original park — the Lantern Castle, parades, and the Everbright fireworks finale.', hours: '9:00 AM – 10:00 PM', peak: 'Midday, 12–4 PM' },
    { id: 'frontier-falls', name: 'Frontier Falls', kind: 'theme park', blurb: 'River rapids, the Copper Mine coaster, and the Falls amphitheater.', hours: '9:00 AM – 9:00 PM', peak: 'Late morning, 10 AM–1 PM' },
    { id: 'cinescape', name: 'Cinescape Studios', kind: 'theme park', blurb: 'Working backlot, stunt shows, and the Reel Drop tower.', hours: '9:00 AM – 8:00 PM', peak: 'Afternoon, 1–5 PM' },
    { id: 'wildhaven', name: 'Wildhaven Preserve', kind: 'theme park', blurb: 'Safari trails, the Canopy Walk, and the Nightglow lantern trail.', hours: '8:00 AM – 8:00 PM', peak: 'Early morning, 8–11 AM' },
    { id: 'tidewash', name: 'Tidewash Lagoon', kind: 'water park', blurb: 'Wave pool, six slide towers, and a mile-long lazy river.', hours: '10:00 AM – 6:00 PM', peak: 'Midday, 11 AM–3 PM' },
    { id: 'frostpeak', name: 'Frostpeak Cove', kind: 'water park', blurb: 'Alpine-themed slides and the Cove drift pool.', hours: '10:00 AM – 5:00 PM', peak: 'Afternoon, 1–4 PM' },
    { id: 'lantern-row', name: 'Lantern Row', kind: 'district', blurb: 'Open-air shopping, dining, and live music. No ticket required.', hours: '10:00 AM – 11:30 PM', peak: 'Evening, 7–10 PM' }
  ];

  const HOTELS = [
    {
      id: 'grand-lagoon', name: 'Everbright Grand Lagoon Resort', tier: 'Signature',
      nightly: 389, walkToVenue: true, minutesToVenue: 0,
      blurb: 'Attached to the conference center by covered walkway. Lagoon views, three restaurants, adults-only rooftop pool.',
      amenities: ['Walk to sessions', 'Rooftop pool', 'Full-service spa', 'Late checkout for attendees'],
      roomsLeft: 41
    },
    {
      id: 'skyline-tower', name: 'Skyline Tower', tier: 'Signature',
      nightly: 459, walkToVenue: false, minutesToVenue: 6,
      blurb: 'Monorail-adjacent tower with the best fireworks sightlines on property. Executive lounge on 18.',
      amenities: ['Monorail access', 'Executive lounge', 'Fireworks-view rooms', 'Club-level breakfast'],
      roomsLeft: 12
    },
    {
      id: 'frontier-lodge', name: 'Frontier Falls Lodge', tier: 'Preferred',
      nightly: 299, walkToVenue: false, minutesToVenue: 12,
      blurb: 'Timber-and-stone lodge on the river. Shuttle every 10 minutes to the conference center.',
      amenities: ['Shuttle to sessions', 'Riverfront pool', 'Fire pit lawn', 'On-site bike rental'],
      roomsLeft: 88
    },
    {
      id: 'lantern-inn', name: 'Lantern Row Inn', tier: 'Value',
      nightly: 219, walkToVenue: false, minutesToVenue: 18,
      blurb: 'Best value on property, steps from Lantern Row dining and nightlife.',
      amenities: ['Walk to Lantern Row', 'Two quiet pools', 'Grab-and-go market', 'Free self-parking'],
      roomsLeft: 130
    }
  ];

  // Advance price applies to purchases on or before 2026-09-11.
  const TICKETS = [
    { id: 'partial-day', name: 'Partial-Day Ticket', days: 0.5, advance: 89, gate: 99, note: 'Valid after 2:00 PM. Built for post-session evenings.', bonus: null },
    { id: '1-day', name: '1-Day Ticket', days: 1, advance: 139, gate: 169, note: 'One park, any day in your ticket window.', bonus: null },
    { id: '3-day', name: '3-Day Ticket', days: 3, advance: 329, gate: 399, note: 'Park-hopping included on all three days.', bonus: 'One Everbright Extra experience' },
    { id: '5-day', name: '5-Day Ticket', days: 5, advance: 419, gate: 509, note: 'Best per-day value. Park-hopping and one water park day.', bonus: 'Two Everbright Extra experiences' }
  ];

  const CHILD_DISCOUNT = 0.88; // ages 3–9

  const TRACKS = [
    { id: 'platform', name: 'Data Platform', color: '#5b8def' },
    { id: 'ai', name: 'AI & Agents', color: '#c084fc' },
    { id: 'governance', name: 'Governance & Trust', color: '#34d399' },
    { id: 'experience', name: 'Guest Experience', color: '#fbbf24' },
    { id: 'leadership', name: 'Leadership', color: '#fb7185' }
  ];

  const SESSIONS = [
    { id: 's101', title: 'Opening Keynote: The Measured Experience', day: '2026-09-14', start: '09:00', end: '10:15', room: 'Lagoon Ballroom', track: 'leadership', speaker: 'Dr. Amara Osei', role: 'Chief Data Officer, Everbright Parks', level: 'All', seats: 1800, taken: 1612, tags: ['keynote', 'strategy'], summary: 'How Everbright rebuilt its measurement stack around guest outcomes instead of page views.' },
    { id: 's102', title: 'Streaming Ingest at Park Scale', day: '2026-09-14', start: '10:45', end: '11:45', room: 'Copper Room 2', track: 'platform', speaker: 'Nikhil Raghavan', role: 'Principal Engineer', level: 'Advanced', seats: 240, taken: 231, tags: ['streaming', 'kafka', 'ingest'], summary: 'Handling 4.2M events per minute on peak days without dropping a ride-entry scan.' },
    { id: 's103', title: 'Agent Analytics 101: Measuring What Your Agent Actually Did', day: '2026-09-14', start: '10:45', end: '11:45', room: 'Studio A', track: 'ai', speaker: 'Priya Venkatesan', role: 'Director of AI Products', level: 'Beginner', seats: 300, taken: 188, tags: ['agents', 'llm', 'measurement'], summary: 'Sessions, turns, tool calls, and cost — the four things to instrument before you ship an agent.' },
    { id: 's104', title: 'Consent Without Friction', day: '2026-09-14', start: '13:00', end: '14:00', room: 'Trust Hall', track: 'governance', speaker: 'Marcus Lindqvist', role: 'VP Privacy Engineering', level: 'Intermediate', seats: 260, taken: 141, tags: ['privacy', 'consent', 'compliance'], summary: 'A consent architecture that survived three regulatory audits and did not tank opt-in rates.' },
    { id: 's105', title: 'Wait-Time Prediction That Guests Believe', day: '2026-09-14', start: '13:00', end: '14:00', room: 'Copper Room 1', track: 'experience', speaker: 'Elena Vasquez', role: 'Staff Data Scientist', level: 'Intermediate', seats: 220, taken: 219, tags: ['ml', 'forecasting', 'operations'], summary: 'Why the accurate model lost to the slightly-pessimistic model, and what that taught us.' },
    { id: 's106', title: 'From Dashboards to Decisions', day: '2026-09-14', start: '14:30', end: '15:30', room: 'Lagoon Ballroom', track: 'leadership', speaker: 'Tobias Grant', role: 'SVP Commercial Analytics', level: 'All', seats: 900, taken: 402, tags: ['strategy', 'org design'], summary: 'Killing 340 dashboards and what replaced them.' },
    { id: 's107', title: 'Hands-On Lab: Instrumenting a Chat Agent', day: '2026-09-14', start: '14:30', end: '16:30', room: 'Lab 3', track: 'ai', speaker: 'Priya Venkatesan', role: 'Director of AI Products', level: 'Intermediate', seats: 60, taken: 60, tags: ['lab', 'agents', 'hands-on'], summary: 'Bring a laptop. You will ship a fully instrumented agent session by the end of the block.' },
    { id: 's108', title: 'Identity Resolution Across 40 Million Guests', day: '2026-09-15', start: '09:00', end: '10:00', room: 'Copper Room 2', track: 'platform', speaker: 'Hana Sato', role: 'Head of Identity', level: 'Advanced', seats: 240, taken: 175, tags: ['identity', 'profiles'], summary: 'Device graphs, household inference, and the merge rules that caused an incident.' },
    { id: 's109', title: 'Evaluating Agents You Did Not Build', day: '2026-09-15', start: '09:00', end: '10:00', room: 'Studio A', track: 'ai', speaker: 'Dr. Samuel Achebe', role: 'Research Lead', level: 'Advanced', seats: 300, taken: 244, tags: ['evals', 'agents', 'quality'], summary: 'Scoring third-party and vendor agents with the same rubric as your own.' },
    { id: 's110', title: 'The Retention Curve Nobody Wanted to See', day: '2026-09-15', start: '10:30', end: '11:30', room: 'Lagoon Ballroom', track: 'experience', speaker: 'Jordan Whitfield', role: 'Director, Guest Lifecycle', level: 'Intermediate', seats: 900, taken: 611, tags: ['retention', 'cohorts'], summary: 'A five-year annual-pass cohort study and the three levers that actually moved it.' },
    { id: 's111', title: 'Data Contracts in Practice', day: '2026-09-15', start: '10:30', end: '11:30', room: 'Trust Hall', track: 'governance', speaker: 'Marcus Lindqvist', role: 'VP Privacy Engineering', level: 'Intermediate', seats: 260, taken: 96, tags: ['contracts', 'quality', 'schema'], summary: 'What we standardized, what we left alone, and how we handled the 200 teams in between.' },
    { id: 's112', title: 'Experimentation on Physical Queues', day: '2026-09-15', start: '13:00', end: '14:00', room: 'Copper Room 1', track: 'experience', speaker: 'Elena Vasquez', role: 'Staff Data Scientist', level: 'Advanced', seats: 220, taken: 158, tags: ['experimentation', 'operations'], summary: 'Randomizing a real-world queue without ruining anyone\'s afternoon.' },
    { id: 's113', title: 'Cost Control for LLM Features', day: '2026-09-15', start: '14:30', end: '15:30', room: 'Studio A', track: 'ai', speaker: 'Nikhil Raghavan', role: 'Principal Engineer', level: 'Intermediate', seats: 300, taken: 271, tags: ['cost', 'llm', 'agents'], summary: 'Per-session cost budgets, model routing, and the caching that paid for the team.' },
    { id: 's114', title: 'Building an Analytics Guild', day: '2026-09-16', start: '09:00', end: '10:00', room: 'Trust Hall', track: 'leadership', speaker: 'Tobias Grant', role: 'SVP Commercial Analytics', level: 'All', seats: 260, taken: 118, tags: ['org design', 'enablement'], summary: 'Federated analysts, central standards, and the meeting cadence that held it together.' },
    { id: 's115', title: 'Warehouse-Native Product Analytics', day: '2026-09-16', start: '10:30', end: '11:30', room: 'Copper Room 2', track: 'platform', speaker: 'Hana Sato', role: 'Head of Identity', level: 'Advanced', seats: 240, taken: 203, tags: ['warehouse', 'architecture'], summary: 'Query-in-place, materialization tradeoffs, and where the model broke down.' },
    { id: 's116', title: 'Closing Session: What We Ship Next', day: '2026-09-16', start: '13:00', end: '14:00', room: 'Lagoon Ballroom', track: 'leadership', speaker: 'Dr. Amara Osei', role: 'Chief Data Officer, Everbright Parks', level: 'All', seats: 1800, taken: 940, tags: ['keynote', 'roadmap'], summary: 'The 2027 measurement roadmap, in public, with dates.' }
  ];

  const DINING = [
    { id: 'd1', name: 'The Lantern Table', park: 'lantern-row', style: 'New American', price: '$$$', meals: ['dinner'], blurb: 'Chef\'s counter overlooking the water. Books out three weeks ahead.', reservationDifficulty: 'hard' },
    { id: 'd2', name: 'Copper Mine Chophouse', park: 'frontier-falls', style: 'Steakhouse', price: '$$$$', meals: ['dinner'], blurb: 'Inside the ride queue building. Loud, excellent, oddly romantic.', reservationDifficulty: 'hard' },
    { id: 'd3', name: 'Backlot Commissary', park: 'cinescape', style: 'Comfort food', price: '$$', meals: ['lunch', 'dinner'], blurb: 'Fast, generous portions, walkable from Studio A.', reservationDifficulty: 'easy' },
    { id: 'd4', name: 'Canopy Grill', park: 'wildhaven', style: 'Wood-fired', price: '$$$', meals: ['lunch', 'dinner'], blurb: 'Open-air deck above the safari trail. Sunset seating is the move.', reservationDifficulty: 'medium' },
    { id: 'd5', name: 'Sunrise Bakery', park: 'lantern-row', style: 'Cafe', price: '$', meals: ['breakfast'], blurb: 'Opens at 6:30 AM. The only real coffee before the 9 AM keynote.', reservationDifficulty: 'walk-up' },
    { id: 'd6', name: 'Lagoon Terrace', park: 'grand-lagoon', style: 'Mediterranean', price: '$$$', meals: ['breakfast', 'lunch', 'dinner'], blurb: 'In the conference hotel. The default for a working dinner.', reservationDifficulty: 'medium' }
  ];

  const LOGISTICS = {
    badge: { title: 'Badge pickup', body: 'Registration opens Sunday 09/13 from 2:00–8:00 PM in the Grand Lagoon lobby, and daily from 7:30 AM at the conference center north entrance. Bring a photo ID. Badges are required for all sessions and the Wednesday evening event.' },
    shuttle: { title: 'Shuttles', body: 'Attendee shuttles run every 10 minutes between all four resort hotels and the conference center, 6:30 AM–11:30 PM. Park shuttles run from 30 minutes before park open until one hour after close. There is no shuttle between the two water parks.' },
    parking: { title: 'Parking', body: 'Self-parking is complimentary for attendees at all resort hotels and the conference center with a scanned badge. Valet is $42 per night. Theme park parking is included with any attendee ticket.' },
    wifi: { title: 'Wi-Fi', body: 'Network EDAC-2026, password in your badge holder. Session rooms have a separate high-throughput network for labs: EDAC-LAB. Guest Wi-Fi across the resort is open and unauthenticated.' },
    airport: { title: 'Airport transfer', body: 'Lumina Springs International (LSI) is 24 minutes from the resort. The attendee coach runs every 40 minutes from Terminal B, level 1, from 09/12 through 09/17. Rideshare pickup is at level 2 and runs about $38.' },
    weather: { title: 'Weather in September', body: 'Expect highs near 91°F, humidity around 75%, and a short afternoon thunderstorm most days between 3 and 5 PM. Pack a light rain layer and plan indoor sessions for mid-afternoon.' },
    accessibility: { title: 'Accessibility', body: 'All session rooms are step-free with reserved seating at the front and rear. Live captioning runs in the Lagoon Ballroom, Trust Hall, and Studio A. Request ASL interpretation, dietary accommodation, or a mobility device at least 72 hours ahead through the attendee desk.' },
    evening: { title: 'Attendee evening event', body: 'Wednesday 09/16, 7:30–11:00 PM, Wonderworks Kingdom is reserved for attendees after regular park close. Badge required, one guest per attendee, no separate ticket needed.' }
  };

  // Fictional prior-year figures used by the concierge when asked for context.
  const FACTS = {
    attendees: 4200,
    countries: 38,
    sessions: SESSIONS.length,
    labs: 6,
    firstYear: 2011
  };

  function sessionsByDay(day) {
    return SESSIONS.filter(s => s.day === day).sort((a, b) => a.start.localeCompare(b.start));
  }
  function trackName(id) {
    const t = TRACKS.find(t => t.id === id);
    return t ? t.name : id;
  }
  function trackColor(id) {
    const t = TRACKS.find(t => t.id === id);
    return t ? t.color : '#94a3b8';
  }
  function park(id) {
    return PARKS.find(p => p.id === id);
  }
  function seatsLeft(s) {
    return Math.max(0, s.seats - s.taken);
  }
  function dayLabel(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  function shortDay(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  }
  function time12(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 === 0 ? 12 : h % 12;
    return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
  }

  return {
    EVENT, PARKS, HOTELS, TICKETS, CHILD_DISCOUNT, TRACKS, SESSIONS, DINING, LOGISTICS, FACTS,
    sessionsByDay, trackName, trackColor, park, seatsLeft, dayLabel, shortDay, time12
  };
})();
