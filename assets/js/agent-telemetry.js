/* ------------------------------------------------------------------
   Amplitude Agent Analytics — browser instrumentation.

   The Node/Python AI SDK (@amplitude/ai) cannot run in a browser, so
   this emits the [Agent] taxonomy directly through the standard
   Browser SDK's track(), which is the documented path for browser and
   edge runtimes. Contract:

     [Agent] User Message  — at request start
     [Agent] Tool Call     — one per invocation, in execution order,
                             BEFORE the AI Response
     [Agent] AI Response   — after the reply; tokens/cost/model live
                             only here
     [Agent] Score         — thumbs feedback, name "user-feedback"
     [Agent] Session End    — when the conversation genuinely ends

   Shared envelope on every event: Session ID, Turn ID, Trace ID,
   Agent ID, Env, Runtime, Context.
------------------------------------------------------------------ */

window.EDACAgentTelemetry = (function () {
  const A = window.EDACAnalytics;
  const CONFIG = window.EDAC_CONFIG || {};
  const AGENT_ID = CONFIG.agentId || 'edac-concierge';
  const ENV = CONFIG.env || 'demo';
  const IDLE_TIMEOUT_MINUTES = CONFIG.idleTimeoutMinutes || 30;

  // Priced per 1M tokens. Used to compute [Agent] Cost USD — Amplitude
  // does not derive cost from model + token counts, so we must send it.
  const MODEL = CONFIG.model || {
    name: 'claude-sonnet-5',
    provider: 'anthropic',
    inputPerMillion: 3.0,
    outputPerMillion: 15.0
  };

  const state = {
    sessionId: null,
    turnId: 0,
    traceId: null,
    closed: false,
    startedAt: null,
    lastUserMessageId: null,
    lastAiMessageId: null,
    turnsThisSession: 0
  };

  function uuid() { return A.uuid(); }

  /* ---------- session lifecycle -------------------------------- */

  // One stable ID per conversation. This is the unit of work; do NOT
  // rotate it on a short idle timer — that chops one conversation into
  // several sessions and bills as several.
  function startSession(reason) {
    state.sessionId = 'conv-' + uuid();
    state.turnId = 0;
    state.traceId = null;
    state.closed = false;
    state.startedAt = Date.now();
    state.turnsThisSession = 0;
    if (CONFIG.debug) console.log('%c[Agent] session opened', 'color:#34d399', state.sessionId, reason || '');
    return state.sessionId;
  }

  function ensureSession() {
    if (!state.sessionId || state.closed) startSession('auto');
    return state.sessionId;
  }

  function endSession(outputState, abandonmentTurn) {
    if (!state.sessionId || state.closed) return;
    A.track('[Agent] Session End', Object.assign(envelope(), {
      '[Agent] Output State': outputState || 'completed',
      '[Agent] Session Idle Timeout Minutes': IDLE_TIMEOUT_MINUTES,
      // Only these taxonomy properties — the server derives
      // [Agent] Close Reason and the rollups on the Session Record.
      '[Agent] Abandonment Turn': typeof abandonmentTurn === 'number' ? abandonmentTurn : undefined
    }));
    state.closed = true;
    if (CONFIG.debug) console.log('%c[Agent] session closed', 'color:#fb7185', state.sessionId, outputState);
  }

  /* ---------- shared envelope ---------------------------------- */
  function envelope() {
    return Object.assign(
      {
        '[Agent] Session ID': state.sessionId,
        '[Agent] Turn ID': state.turnId,
        '[Agent] Trace ID': state.traceId,
        '[Agent] Agent ID': AGENT_ID,
        '[Agent] Env': ENV,
        '[Agent] Runtime': 'browser',
        '[Agent] Context': JSON.stringify({
          idle_timeout_minutes: IDLE_TIMEOUT_MINUTES,
          surface: 'attendee-planning-hub',
          event_code: CONFIG.eventCode || 'EDAC 2026',
          mode: CONFIG.agentEndpoint ? 'remote-llm' : 'local-retrieval'
        })
      },
      A.replayProperties()
    );
  }

  /* ---------- turns -------------------------------------------- */

  // Turn ID identifies the exchange, not the event: it increments once
  // per user-message round trip, and the same value is stamped on the
  // user message, every tool call, and the AI response of that exchange.
  // One Trace ID per round trip, shared the same way.
  function beginTurn() {
    ensureSession();
    state.turnId += 1;
    state.turnsThisSession += 1;
    state.traceId = 'trace-' + uuid();
    return { turnId: state.turnId, traceId: state.traceId };
  }

  function trackUserMessage(text) {
    const messageId = 'msg-' + uuid();
    state.lastUserMessageId = messageId;
    A.track('[Agent] User Message', Object.assign(envelope(), {
      '[Agent] Message ID': messageId,
      // Must be an object. A plain string is silently ignored and the
      // thread view renders no message content.
      $llm_message: { text: A.redactText(text) }
    }));
    return messageId;
  }

  function trackToolCall(opts) {
    A.track('[Agent] Tool Call', Object.assign(envelope(), {
      '[Agent] Invocation ID': 'inv-' + uuid(),
      '[Agent] Tool Name': opts.name,
      '[Agent] Tool Success': opts.success !== false,
      '[Agent] Latency Ms': Math.round(opts.latencyMs || 0),
      '[Agent] Parent Message ID': opts.parentMessageId || state.lastUserMessageId,
      '[Agent] Tool Input': A.redactDeep(opts.input || {}),
      '[Agent] Tool Output': A.redactDeep(opts.output || {}),
      '[Agent] Is Error': opts.success === false,
      '[Agent] Error Message': opts.errorMessage || undefined
      // No token or cost properties here — a stray cost on a Tool Call
      // silently inflates the session total.
    }));
  }

  // Rough token accounting for the local retrieval agent. Swap this for
  // the provider's real usage numbers when a model endpoint is wired in.
  function estimateTokens(str) {
    if (!str) return 0;
    return Math.max(1, Math.round(String(str).length / 4));
  }

  function trackAiResponse(opts) {
    const messageId = 'msg-' + uuid();
    state.lastAiMessageId = messageId;

    const inputTokens = typeof opts.inputTokens === 'number'
      ? opts.inputTokens
      : estimateTokens(opts.systemPrompt) + estimateTokens(opts.promptContext) + estimateTokens(opts.userText);
    const outputTokens = typeof opts.outputTokens === 'number'
      ? opts.outputTokens
      : estimateTokens(opts.text);

    const costUsd = typeof opts.costUsd === 'number'
      ? opts.costUsd
      : Number((
          (inputTokens / 1e6) * MODEL.inputPerMillion +
          (outputTokens / 1e6) * MODEL.outputPerMillion
        ).toFixed(6));

    A.track('[Agent] AI Response', Object.assign(envelope(), {
      '[Agent] Message ID': messageId,
      '[Agent] Model Name': opts.modelName || MODEL.name,
      '[Agent] Provider': opts.provider || MODEL.provider,
      '[Agent] Latency Ms': Math.round(opts.latencyMs || 0),
      '[Agent] Input Tokens': inputTokens,
      '[Agent] Output Tokens': outputTokens,
      '[Agent] Total Tokens': inputTokens + outputTokens,
      '[Agent] Cost USD': costUsd,
      '[Agent] Finish Reason': opts.finishReason || 'stop',
      '[Agent] System Prompt': A.redactText(opts.systemPrompt || ''),
      '[Agent] Is Error': !!opts.isError,
      '[Agent] Error Message': opts.errorMessage || undefined,
      $llm_message: { text: A.redactText(opts.text || '') }
    }));

    return messageId;
  }

  /* ---------- feedback ----------------------------------------- */

  // Name it exactly "user-feedback": that Score Name overrides the
  // detected negative-feedback signal for the session, so the user
  // always gets the last word. 1 = up, 0 = down, source "user".
  function trackFeedback(aiMessageId, value, comment) {
    A.track('[Agent] Score', Object.assign(envelope(), {
      '[Agent] Score Name': 'user-feedback',
      '[Agent] Score Value': value ? 1 : 0,
      '[Agent] Target ID': aiMessageId,
      '[Agent] Target Type': 'message',
      '[Agent] Evaluation Source': 'user',
      '[Agent] Comment': comment ? A.redactText(comment) : undefined
    }));
  }

  // End-of-conversation rating uses target type "session" and its own
  // Score Name so the binary thumbs metric stays clean.
  function trackCsat(value) {
    A.track('[Agent] Score', Object.assign(envelope(), {
      '[Agent] Score Name': 'csat',
      '[Agent] Score Value': value,
      '[Agent] Target ID': state.sessionId,
      '[Agent] Target Type': 'session',
      '[Agent] Evaluation Source': 'user'
    }));
  }

  /* ---------- abandonment safety net --------------------------- */
  // Best effort only: the default transport may not finish on unload,
  // and the server closes any idle session after 30 minutes anyway, so
  // a dropped close costs nothing. Never switch to the beacon transport
  // to "fix" this — that setting is global and permanent.
  window.addEventListener('pagehide', function () {
    if (state.sessionId && !state.closed && state.turnsThisSession > 0) {
      endSession('abandoned', state.turnId);
    }
  });

  return {
    startSession, ensureSession, endSession, beginTurn,
    trackUserMessage, trackToolCall, trackAiResponse, trackFeedback, trackCsat,
    get sessionId() { return state.sessionId; },
    get turnId() { return state.turnId; },
    get lastAiMessageId() { return state.lastAiMessageId; },
    get lastUserMessageId() { return state.lastUserMessageId; },
    get isClosed() { return state.closed; },
    model: MODEL
  };
})();
