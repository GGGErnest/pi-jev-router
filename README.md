<p align="center">
  <img src="https://raw.githubusercontent.com/mejiasd3v/pi-jev-router/main/assets/logo.png" alt="Jev Router logo" width="144" height="144">
</p>
<h1 align="center">Jev Router</h1>
<p align="center">Choose once. Stay pinned.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/pi-jev-router"><img src="https://img.shields.io/npm/v/pi-jev-router?style=flat-square&amp;color=67e8b4&amp;logo=npm&amp;logoColor=white" alt="npm version"></a>
  <a href="https://github.com/mejiasd3v/pi-jev-router/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/mejiasd3v/pi-jev-router/test.yml?branch=main&amp;style=flat-square&amp;label=tests&amp;logo=github" alt="Tests"></a>
  <a href="https://github.com/mejiasd3v/pi-jev-router/blob/main/LICENSE"><img src="https://img.shields.io/github/license/mejiasd3v/pi-jev-router?style=flat-square&amp;color=8b9cff" alt="MIT license"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/Pi-0.85.1%2B-f8b86d?style=flat-square" alt="Pi 0.85.1 or later"></a>
</p>

Let [TypeSafe's Jev](https://vercel.com/ai-gateway/models/jev) choose a model and reasoning effort for [Pi](https://pi.dev). The model stays pinned for the session; opt-in adaptive effort can adjust its supported thinking level without switching models. Generation uses your existing Pi providers and credentials.

## Get started

Requires Pi **0.85.1+** and Node.js **22.19+**. Jev evaluations run through **OpenRouter** or the **Vercel AI Gateway**, selected by `jevRouter.evaluationProvider` (Gateway by default for backward compatibility).

```sh
pi install npm:pi-jev-router
```

Git also works: `pi install git:github.com/mejiasd3v/pi-jev-router`. For the OpenRouter-enabled feature branch in your fork, install `git:github.com/GGGErnest/pi-jev-router@feat/evidence-guided-routing` instead. Keep only one installation; this feature branch is not published to npm.

1. Use `/login` for your generation provider. For Jev, configure the provider in `jevRouter.evaluationProvider` and authenticate it:
   - `"vercel-ai-gateway"` (default): `/login vercel-ai-gateway`; `AI_GATEWAY_API_KEY` also works.
   - `"openrouter"`: `/login openrouter`; `OPENROUTER_API_KEY` also works. OpenRouter serves Jev through its Decisions API.
2. Run `/reload`, then `/model auto/jev`.
3. Start with your actual task. `/jev` shows the pin, selected effort, and fork suggestions.

## Configure

Merge `jevRouter` into **global** `~/.pi/agent/settings.json`, then `/reload`:

```json
{
  "jevRouter": {
    "options": {
      "openai-codex/gpt-5.6-luna": {
        "description": "Small fixes, tests, and routine implementation.",
        "thinking": "auto"
      },
      "openai-codex/gpt-6-astra": {
        "description": "Architecture, difficult debugging, and complex reasoning.",
        "thinking": "auto"
      }
    },
    "fallback": "openai-codex/gpt-6-astra",
    "timeoutMs": 5000,
    "monitor": true,
    "skills": false,
    "pinFallback": false,
    "evidence": "recent"
  }
}
```

Only listed, authenticated models are eligible; `fallback` must be listed too. Routes replace the default list; they aren't merged. `PI_CODING_AGENT_DIR` is respected; project settings cannot override routing.

The virtual `auto/jev` model advertises the largest available configured route window so Pi doesn't compact a large resumed session before Jev can route it. When Pi reports a context estimate, Jev only sees routes that can fit with a response reserve. Pi may briefly report usage as unknown immediately after compaction; in that case routing leaves the candidates unfiltered because the context has just been reduced. If a known estimate fits no route—or an existing session pin is too small—the extension fails clearly rather than silently sending an oversized context or switching the pin; compact the session or fork to choose a larger-context model.

`jevRouter.evaluationProvider` selects where Jev evaluations run: `"vercel-ai-gateway"` (default) or `"openrouter"`. It is chosen **only** from this setting — the extension never auto-detects or falls back to the other provider. A missing key for the selected provider fails closed with guidance naming its `/login` command and environment variable (`AI_GATEWAY_API_KEY` or `OPENROUTER_API_KEY`). Credentials always come from Pi's registry, never from `settings.json`.

Without configuration, defaults are Luna/`max`, Sol/`auto`, Astra/`xhigh`, Astra fallback, a five-second timeout, and monitoring on. The example above enables automatic effort.

Optional tuning knobs (defaults shown): `evidence` is `"recent"` (up to eight recent user/assistant messages) or `"latest"` (only the newest user message); `pinFallback` is `false`, so a fallback chosen after an evaluation failure is provisional and re-routed on the next request, while `true` locks it for the session; `poorFitThreshold` is `0.85` and `skillProbability` is `0.8` (each `0`–`1`); `maxSkills` is `3`; `debug` is `false` and adds a safe failure label to warnings without exposing SDK error bodies; and `evaluationCost` sets the `inputPerMillion` (default `0.042`) and `outputPerMillion` (default `0`) rates used for the `/jev` estimate. Invalid values fail at load.

Descriptions accept either a nonempty string or a structured rubric with `role`, `use_when`, `not_for`, and `boundary`. The role and boundary must be nonempty strings; both lists must contain nonempty strings. Structured rubrics are passed intact as each Choice option's `task`, including during monitoring.

Use Luna for known-approach execution, Sol for bounded investigation and implementation within an established architecture, and Astra for advisory judgment, architecture, critical thinking, and difficult debugging. High effort never expands a model's scope. Sol's middle-tier role should be validated on your workload. Existing string descriptions remain supported.

### Thinking

| `thinking` | Behavior |
| --- | --- |
| `"auto"` | Jev chooses the lowest effort it judges sufficient. |
| `"high"` | Force a level, clamped to the model's capabilities. |
| `{"low": "Small changes", "high": "Hard problems"}` | Customize the allowed choices and their descriptions. |
| Omitted | Inherit Pi's thinking level when the pin is created. |

Levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Automatic choices are filtered to supported levels. Model and effort are chosen in one evaluation: task fit determines the model first, then Jev selects the lowest sufficient allowed effort within that model. Effort labels are model-relative; another model's lower label does not make it a better fit. A configured floor can intentionally exceed what a routine task needs.

Set `jevRouter.minThinking` for a global floor, and `minThinking` inside a model's option for a stricter per-model floor. For example, global `"medium"` plus Luna `"high"` lets Jev choose medium or higher for Astra and high or higher for Luna when both use `"thinking": "auto"`. An omitted model minimum inherits the global floor. Only `openai-codex/gpt-6-astra` can override it: an explicit Astra `"minThinking": "low"` permits low effort even with global `"medium"`, for both initial routing and adaptive effort. Other models can only raise the global floor. Both fields are optional and default to no additional restriction.

Automatic and custom choices below the floor are excluded. Fixed or inherited effort below the floor is raised to the lowest supported level meeting it. Routes with no eligible level are excluded, including non-reasoning models when the floor is above `off`; fallback errors if it has no eligible choice. `/jev` shows configured minimums. Reload after editing; existing session pins keep their original effort.

### Adaptive effort (opt-in)

Set `"adaptiveThinking": true` on any route that uses `"thinking": "auto"` or custom thinking choices. Fixed or inherited thinking cannot adapt.

```json
"openai-codex/gpt-6-astra": {
  "description": "Architecture and difficult debugging.",
  "thinking": "auto",
  "adaptiveThinking": true
}
```

After the initial route, Jev checks each distinct main-request context, including tool continuations. It can raise effort for a harder next step and lower it after the hard reasoning is resolved, using only levels supported by that model and allowed by your choices/minimums. It never changes the model. When evidence is unclear or Jev fails, it keeps the current effort. This is a heuristic, not a guarantee that Jev detects every stall. Changes take effect between responses, never inside a running response.

- **Generic providers.** The selected effort is passed to the provider through Pi's per-request `reasoning` option. The model's Pi metadata determines its supported levels.
- **Codex Astra cache handling.** The original request-level effort stays fixed. Changes use Astra's append-only `configuration_update` items, replayed at their original input positions, following [OpenAI's cache-preserving mechanism](https://developers.openai.com/api/docs/guides/reasoning#change-reasoning-mid-conversation). Do not use provider-side automatic compaction, automatic truncation, or another hook that inserts configuration updates.
- **Persist and recover.** Decisions follow the active branch across reload/resume. Astra updates are re-established after local compaction or edited history invalidates their prefix. Generic providers reuse the saved effort on each request. Forks choose afresh; auxiliary requests reuse effort without evaluating or saving changes.
- **Bound overhead.** Adaptive effort adds at most one no-retry evaluation per distinct request context, bounded by `timeoutMs` and a 28,000-byte request budget. Model monitoring is separate and follows routing's retry/chunk limits; it runs only for new user text or new failed-tool evidence. A failed effort check keeps the current level; cancellation stops the request. `monitor: false` disables model suggestions, not adaptive effort.
- **See changes.** Notifications, the status line, and `/jev` show current effort. `/jev` also shows the initial effort used at request level. Pi's thinking picker still does not control or track the router's effort.

Reload after changing the flag. Enabling it can adapt an existing pin on its next request. Disabling it stops new decisions but preserves saved effort; use a new session for a fresh pin.

**Additional data and cost:** opt-in effort checks send the latest user task, up to eight recent user/assistant text excerpts, tool names, and at most four failed-tool excerpts capped at 512 characters each. Common credential patterns are redacted, but redaction is best-effort and may miss secrets or personal data. Successful tool output, tool-call arguments, reasoning blocks, images, and system messages are excluded. Evaluations are billed separately and are not included in `/jev` routing-cost estimates.

### Automatic skill loading (opt-in)

Set `"skills": true` inside your existing global `jevRouter` configuration, then `/reload`. It defaults to `false` and works with both `auto/jev` and concrete models, independently of `monitor`.

Before generation for each new user turn, including steering messages, Jev checks Pi's discovered skill names and descriptions against recent user/assistant text. It loads up to `maxSkills` matches (default **three**) whose returned probability meets `skillProbability` (default **0.8**). These probabilities are heuristic relevance signals, not guarantees.

- Uses Pi's catalog, including its trust and discovery settings. Skills marked `disable-model-invocation` are never auto-loaded.
- Injects full skill instructions with their source path and reference directory. It does not execute scripts or eagerly load linked references.
- Skips skills already included as `<skill>` blocks or successfully loaded through a complete `read` call in the current context. Path aliases are canonicalized. Arbitrary shell commands or unmarked pasted instructions cannot reliably be recognized as skill loads.
- Saves selections and instructions on the active session branch. Tool continuations and `/reload` reuse them without another evaluation or file read. Skills removed by compaction or branch navigation can be selected again when needed.
- Makes at most one additional evaluation per user turn, bounded by `timeoutMs` with no retries and the same **28,000-byte** request budget. Older history is dropped first; oversized tasks/catalogs skip selection rather than using a partial task. Full injected instructions are limited to **50,000 bytes** per turn; unreadable or oversized skills are skipped with a warning.

`/jev` shows whether this feature is enabled. Failures leave ordinary skill loading available. Turning it off stops selection and reinjection; it does not erase instructions the model already read or remove saved session records.

### Long prompts

The latest task takes priority; older history is dropped before splitting it. Requests have a **28,000-byte serialized UTF-8 budget**, including route descriptions. This is a conservative proxy for Jev's [roughly 32K-token request budget](https://docs.typesafe.ai/primitives#ask-speculative-questions), not an exact token count.

Tasks that don't fit are split into at most **eight overlapping chunks**, evaluated **two at a time**, then combined in one final evaluation. The final evaluation is instructed to weigh requirements, not vote counts. This is still a heuristic: relationships across sections may be missed.

Tasks over **192,000 UTF-8 bytes**, excessive chunk plans, or incomplete evaluations use fallback (or retain the existing pin during monitoring). The coding model always receives the original input; its context limits still apply.

## Session behavior

- **Pin once.** The model and initial effort survive tool calls, compaction, `/reload`, and `/resume`. Effort remains fixed unless `adaptiveThinking` is enabled for that route. `/new`, `/fork`, and `/clone` choose afresh. Model and initial-effort configuration changes don't rewrite existing pins. Manage the current session pin manually with `/jev reset` (clear it and re-route next request) or `/jev pin <provider/model> [thinking]` (set it explicitly).
- **Suggest, never switch.** Monitoring checks new user text; new failed-tool results trigger a check during an active user task with routing text. A different model is suggested only when Jev's poor-fit probability reaches `poorFitThreshold` (default **0.85**); this probability is a heuristic, not calibrated confidence. A hard task or single tool error alone is insufficient. The session remains pinned. Use `/fork`, then `/model` and `/thinking` in the fork to follow a suggestion. No automatic forks or model switches.
- **Control overhead.** Routing and model-monitor evaluations retry up to three attempts of `timeoutMs` each (1 to 60,000 ms), including transient HTTP 408/425/429/5xx responses, with bounded backoff and jitter. The entire operation shares a ceiling of **3 × `timeoutMs`**, including chunks and combination: 15 seconds by default. `monitor: false` disables model-switch advisory checks; a new failed tool result can trigger monitoring during an ongoing task, but successful tool continuations do not. Adaptive effort has its own per-request check described above.
- **Fail explicitly, without pinning a bad fallback.** Initial routing failures use the fallback, with its fixed/inherited effort or highest supported automatic choice. Unless `pinFallback` is `true`, that fallback is a *provisional* pin: requests keep flowing, but each new main request re-routes until Jev returns a real decision, at which point the provisional pin is upgraded. If an existing pin becomes unavailable or cannot accept the input, the router errors instead of switching.

Context limits follow the pinned backend. The status and `/jev` show its current effort; Pi's thinking picker does not track automatic choices. Selecting a concrete model bypasses model routing, but not opt-in skill selection. Deferred/background generation is unsupported by `auto/jev`.

## Privacy and cost

Routing and monitoring consider up to **eight recent user/assistant text messages** (or only the newest user message when `evidence` is `"latest"`), limited to **192,000 UTF-8 bytes of source text**. Evaluations send selected text, route/effort descriptions, and chunk assessments to the configured evaluator (`vercel-ai-gateway` serves Vercel/TypeSafe; `openrouter` sends them to OpenRouter's Decisions API). Overlaps, excerpts, and retries can send the same text more than once. System prompts, reasoning blocks, images, tool arguments, and successful tool output are excluded. When monitoring sees new failed-tool evidence during an active task with routing text, it additionally sends up to **four** tool names, error flags, and excerpts capped at **512 characters** each. Common credential patterns are redacted, but redaction is best-effort and may miss secrets or personal data. Adaptive effort can send the same bounded failure evidence when enabled. **Conversation text is not redacted and may contain sensitive information.**

Opt-in skill selection additionally sends eligible skill names and descriptions to the configured evaluator (Vercel/TypeSafe or OpenRouter). Skill file contents are read locally and stored in the session; automatically injected skill messages are excluded from subsequent Jev evaluations. Manually pasted or expanded skill instructions in user messages remain conversation text.

Evaluator requests are billed separately by the configured provider (Vercel AI Gateway or OpenRouter). Chunked routing can require up to **nine evaluation requests** (eight chunks plus a combined decision). Authentication, chunks, retries, and the combined request share a wall-clock ceiling of **3 × `timeoutMs`** (15 seconds by default); the full per-request timeout is not multiplied by the chunk count. `/jev` estimates sum returned usage; failed, cancelled, or timed-out calls may still be billed. By default the estimate counts only input usage at Jev 1.13's $0.042 per 1M input tokens (output is free); override the rates with `evaluationCost.inputPerMillion` and `evaluationCost.outputPerMillion`. Skill-selection evaluations are additional and are not included in `/jev` routing estimates. Evaluation costs are not in Pi's footer totals. Pinning favors cache reuse but guarantees neither cache hits nor savings.

<details>
<summary>Migrating from file-based configuration</summary>

Move the old `routes.json` contents under `jevRouter` and unset `JEV_ROUTES_FILE`; neither is read anymore. Sessions created before pinning was introduced select a pin on their next main request.

</details>

## Development

```sh
nub install --frozen-lockfile --ignore-scripts
nub run test
```

Tests mock network responses; no API keys or paid requests are needed.

The extension entry point is `index.ts` (Pi's wiring and the `auto/jev` provider). Pure logic lives in `src/`: `config.ts` (settings and validation), `effort.ts` (thinking profiles and Astra updates), `evidence.ts` (bounded/redacted request evidence), `evaluator.ts` (provider setup and retry classification), `skills.ts`, and shared `util.ts`/`errors.ts`.

## Publishing

`.github/workflows/publish.yml` publishes stable GitHub releases to npm using [trusted publishing](https://docs.npmjs.com/trusted-publishers/). It checks that the release tag matches `package.json`, installs from the frozen lockfile, and runs tests before publishing. Prereleases are skipped. The publish step uses npm's native OIDC flow; installs and tests use Nub.

### One-time npm setup

In [pi-jev-router package settings](https://www.npmjs.com/package/pi-jev-router/access), add a **GitHub Actions** trusted publisher:

| Field | Value |
| --- | --- |
| Organization or user | `mejiasd3v` |
| Repository | `pi-jev-router` |
| Workflow filename | `publish.yml` |
| Environment name | Leave blank |
| Allowed actions | Allow direct `npm publish`, not just staged publishing |

No npm token or GitHub secret is needed. Keep account 2FA enabled. This connection must be saved on npm before the first automated release; committing the workflow alone does not authorize npm publishing.

### Release a version

1. Bump `package.json`, commit, and push to `main`.
2. Create and push the matching `vX.Y.Z` tag.
3. Publish its GitHub release, for example `gh release create vX.Y.Z --verify-tag --generate-notes`.
4. Wait for **Publish to npm** to succeed and verify the new npm version.

Publishing a GitHub release triggers npm publication; pushing a tag alone does not. Release tags must include the publish workflow. A failed run can be rerun after fixing the npm connection; an already-published npm version cannot be overwritten.

[MIT](LICENSE).
