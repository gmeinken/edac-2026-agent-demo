# EDAC 2026 — Attendee Planning Hub (demo site)

A fictional conference-attendee planning hub with a working chat agent, instrumented
end to end for **Amplitude Agent Analytics**. Built to demo agent quality, cost, and
agent-assisted conversion side by side with self-serve conversion.

Structurally modelled on a corporate event planning hub: hotel booking, ticket
offers, session agenda, downtime planning, know-before-you-go. **All branding is
invented** — Everbright Resort, EDAC, the parks, hotels, sessions, speakers, and
prices are fictional, and the footer says so on the page. No real organization is
represented.

## Run it

```bash
python3 -m http.server 8731 --directory everbright-edac-2026
```

Then open `http://localhost:8731`. No build step, no dependencies — plain HTML, CSS,
and ES2017 JavaScript.

## What the agent is

The **EDAC Concierge** (bottom-right launcher). It handles, with real lookups against
the event data in `assets/js/data.js`:

| Ask | What happens |
| --- | --- |
| "I'm a data engineer, what should I attend?" | Role detection → track-scoped `search_agenda`, four picks, one per block |
| "Where should I stay for 4 nights under $320?" | `lookup_hotels` with budget, nights, and walk-to-venue filters |
| "Price tickets for 2 adults and 1 kid" | `price_tickets` with child discount and advance-vs-gate savings |
| "Hold the Frontier Falls Lodge" / "Add the 3-day ticket" | `add_to_itinerary`, writing to the same store the page UI uses |
| "Check my itinerary for conflicts" | `check_schedule_conflicts` — real overlap detection and free days |
| "Plan my Tuesday evening" | Composite: last session end → dining → park hours → shuttle cutoff |
| "When is badge pickup?" / "What should I pack?" | `get_logistics` across eight topics |
| "Can I get a refund?" | Explicit human handoff with the conversation reference |

Eight tools, in `assets/js/agent-core.js`. Multi-turn: it remembers the last thing it
showed, the party size, and the stated role, so "add the first one" and "anything
cheaper?" resolve correctly.

### Two execution modes

**Local (default).** Intent routing plus retrieval, entirely in the browser. Nothing
to host but static files, no API key in the page, deterministic on stage. Latency is
real measured wall-clock; token counts are estimated from message length and cost is
computed from the rate table in `EDAC_CONFIG.model`, so the cost and latency charts
populate with plausible values rather than real provider usage.

**Remote.** Set `EDAC_CONFIG.agentEndpoint` in `index.html` to your own endpoint and
every turn is POSTed there instead:

```json
// request
{ "message": "...", "sessionId": "...", "turnId": 3, "userId": "...", "systemPrompt": "..." }
// response
{ "text": "...", "suggestions": ["..."],
  "usage": { "inputTokens": 812, "outputTokens": 240 },
  "model": { "name": "claude-sonnet-5", "provider": "anthropic" },
  "toolCalls": [{ "name": "search_agenda", "input": {}, "output": {}, "latencyMs": 120, "success": true }] }
```

The emitted Agent Analytics stream is identical either way — the endpoint just
supplies real model names, real token usage, and real tool results. Keep the provider
key server-side; the page never needs it.

## The Agent Analytics instrumentation

`@amplitude/ai` is Node and Python only, so this uses the documented browser path:
emit the `[Agent]` taxonomy directly through the standard Browser SDK's `track()`.
All of it lives in `assets/js/agent-telemetry.js`.

Per turn, in this order:

```
[Agent] User Message   → Message ID, $llm_message: { text }
[Agent] Tool Call      → one per invocation, in execution order, BEFORE the response
                          Invocation ID, Tool Name, Tool Success, Latency Ms,
                          Parent Message ID, Tool Input, Tool Output
[Agent] AI Response    → Message ID, Model Name, Provider, Latency Ms,
                          Input/Output/Total Tokens, Cost USD, Finish Reason,
                          System Prompt, $llm_message: { text }
```

Plus `[Agent] Score` on thumbs (name `user-feedback`, value 1/0, target type
`message`, source `user`) and `[Agent] Session End` on the **End** button.

Shared envelope on every event: `Session ID`, `Turn ID`, `Trace ID`, `Agent ID`,
`Env`, `Runtime: browser`, `Context` (carrying `idle_timeout_minutes`), plus the
Session Replay properties so agent sessions link to recordings.

Things the wire contract is easy to get wrong, and how this handles them:

- **`$llm_message` is an object**, `{ text: "..." }`. A plain string is silently
  dropped and the thread view renders empty.
- **Turn ID identifies the exchange, not the event.** It increments once per
  user-message round trip and is stamped on the user message, every tool call, and
  the AI response of that exchange. One Trace ID per round trip, shared the same way.
- **Tokens and cost live only on AI Response.** A stray `Cost USD` on a Tool Call or
  Session End silently inflates the session total.
- **Cost is sent, not derived.** Amplitude does not compute `Cost USD` from model and
  token counts.
- **One session ID per conversation, never rotated on a short idle timer.** Rotating
  chops one conversation into several sessions, makes task completion look
  artificially low, and bills as several. The server closes idle sessions after 30
  minutes on its own.
- **No `setTransport('beacon')`.** That setting is global and permanent, and every
  later event fires with no retry. The `pagehide` close here is best-effort on the
  default transport; the server idle timeout is the real safety net.
- **Redaction runs before `track()`**, on all four content-bearing properties:
  `$llm_message.text`, `System Prompt`, `Tool Input`/`Tool Output` (recursively —
  they are objects), and `Comment`. Emails, phones, SSNs, cards, and IPs.
- **Identity** is one persistent UUID in `localStorage`, never a placeholder like
  `"anonymous"` — a user ID cannot be changed once set, so a placeholder permanently
  forks the user and never merges on sign-in.

## Product events (the reason this is more than an agent demo)

Every product event carries a `source`, and agent-driven actions carry
`agent` / `agent-card`, while the page UI carries `agenda-list` / `hotel-grid` /
`ticket-table`. Same event names, same user ID, one funnel:

`Page Viewed` · `Agenda Filtered` · `Session Added to Agenda` ·
`Session Removed from Agenda` · `Hotel Search Performed` · `Hotel Room Held` ·
`Ticket Options Viewed` · `Ticket Party Changed` · `Ticket Added to Cart` ·
`Itinerary Submitted` · `Agent Opened` · `Agent Message Sent` · `Agent Closed`

So you can build: **Agent Message Sent → Ticket Added to Cart → Itinerary Submitted**,
segmented by whether the conversion event's `source` was the agent or the page.

## Demo path in Amplitude

1. Send two or three messages, one that triggers a tool. Confirm in **Live Events**
   that every event shares one Session ID, each exchange shares one Turn ID and Trace
   ID, tool calls precede their AI Response, and `$llm_message.text` renders in the
   thread view.
2. Thumbs-down one response — that is the `user-feedback` Score, which overrides the
   detected negative-feedback signal for the session.
3. Press **End** to close the session explicitly. The Session Record arrives after
   enrichment, typically 15–20 minutes later, with `Close Reason: explicit_close`.
   Abandon a different conversation without pressing End and that one closes on the
   30-minute idle timeout instead — a clean side-by-side.
4. Then the cross-domain funnel above, which is the part a pure agent-observability
   tool cannot do.

Leave a couple of sessions running well before the demo so enriched Session Records
exist by the time you present.

## Configuration

Everything is in the `EDAC_CONFIG` block at the top of `index.html`:

| Key | Purpose |
| --- | --- |
| `amplitudeApiKey` | Project API key. Also appears in the CDN script URL — update both. |
| `agentId` | Becomes `[Agent] Agent ID`. Stable and human-readable. |
| `env` | Becomes `[Agent] Env`. |
| `idleTimeoutMinutes` | Sent in `[Agent] Context` and on Session End. |
| `model` | Name, provider, and per-1M-token rates for the reported cost. |
| `agentEndpoint` | `null` for the local agent; a URL to proxy turns to a model. |
| `debug` | Logs every tracked event to the console. Turn off for a clean demo. |
| `serverZone` | `US` or `EU`. |

Verify the key points at the project you expect before demoing — the HTTP API returns
`200` on receipt, before the Agent Analytics consumer runs, so a `200` alone does not
prove the event landed correctly grouped.

## Files

```
index.html                    markup + EDAC_CONFIG
assets/css/site.css           site and widget styles
assets/js/data.js             fictional event data (sessions, hotels, tickets, parks…)
assets/js/analytics.js        Amplitude bootstrap, identity, redaction, product events
assets/js/store.js            shared itinerary, records the source of every write
assets/js/agent-telemetry.js  the [Agent] taxonomy emitter
assets/js/agent-core.js       tools, intent routing, turn orchestration
assets/js/agent-ui.js         chat widget, thumbs feedback, explicit session close
assets/js/site.js             page rendering and product-event instrumentation
```
