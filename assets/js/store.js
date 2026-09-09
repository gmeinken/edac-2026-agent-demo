/* ------------------------------------------------------------------
   Shared itinerary store. Both the page UI and the concierge agent
   write here, and every change carries the source that made it — that
   is what makes "agent-assisted vs. self-serve" comparable downstream.
------------------------------------------------------------------ */

window.EDACStore = (function () {
  const KEY = 'edac.itinerary';
  const listeners = [];
  let items = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) { /* ignore */ }
    listeners.forEach(fn => { try { fn(items); } catch (e) { console.error(e); } });
  }

  function subscribe(fn) { listeners.push(fn); fn(items); }

  function all() { return items.slice(); }

  function has(type, id) { return items.some(i => i.type === type && i.id === id); }

  function find(type, id) { return items.find(i => i.type === type && i.id === id); }

  function add(item, source) {
    if (has(item.type, item.id)) return { added: false, reason: 'already-present' };
    items.push(Object.assign({ addedAt: new Date().toISOString(), source: source || 'ui' }, item));
    save();
    return { added: true };
  }

  // Tickets and hotels are single-choice; adding a new one replaces it.
  function replace(item, source) {
    items = items.filter(i => i.type !== item.type);
    items.push(Object.assign({ addedAt: new Date().toISOString(), source: source || 'ui' }, item));
    save();
    return { added: true, replaced: true };
  }

  function remove(type, id) {
    const before = items.length;
    items = items.filter(i => !(i.type === type && i.id === id));
    if (items.length !== before) save();
    return before !== items.length;
  }

  function clear() { items = []; save(); }

  function totalUsd() {
    return items.reduce((sum, i) => sum + (i.amount || 0), 0);
  }

  function bySource() {
    return items.reduce((acc, i) => {
      const key = i.source || 'ui';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }

  return { all, has, find, add, replace, remove, clear, subscribe, totalUsd, bySource };
})();
