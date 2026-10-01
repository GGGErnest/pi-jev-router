# Evidence-Guided Jev Routing Plan

> **For Hermes:** Implement this plan task-by-task with tests before behavior changes.

**Goal:** Keep the pinned model by default, raise its effort when the next step needs more reasoning, and suggest a different model only when Jev has strong evidence that the current model is a poor fit.

**Architecture:** Extend the existing Pi router rather than composing multiple routers. Generalize adaptive effort to supported Pi model reasoning levels while preserving Astra's Responses API configuration-update behavior. Make monitor checks react to new user requests or new tool failures, pass only bounded/redacted failure evidence, and keep model changes as fork suggestions so the session pin and cache remain stable.

**Tech Stack:** TypeScript Pi extension, Node test runner (`node --test`), existing mocked Jev gateway harness.

**Principles:**
- Never silently switch the session's pinned model.
- A tool error alone is not proof of model mismatch; require a high-confidence poor-fit decision.
- Keep the current effort when Jev errors, times out, or returns an invalid answer.
- Do not send tool arguments, private reasoning, system prompts, successful tool output, or unredacted failure output to Jev.
- Preserve upstream behavior and existing configuration names where practical.

---

## Task 1: Specify policy behavior in regression tests

**Files:** `index.test.mjs`

- Test that adaptive effort can raise effort on a non-Astra reasoning model while retaining the same model.
- Test that a model alternative is not suggested when the poor-fit probability is below the policy threshold, including after a single tool error.
- Test that a high-confidence poor-fit answer may create a fork suggestion but never changes the current pin.
- Test that monitoring reacts once to new failure evidence, then skips a duplicate context.
- Test that failure excerpts are bounded and common secret patterns are redacted; never expose tool arguments or reasoning.

Run `npm test` and confirm these tests fail for the intended missing behavior before implementation.

## Task 2: Add bounded routing evidence and enforce the model-fit gate

**Files:** `index.ts`, `index.test.mjs`

- Build a stable monitor key from the latest user request plus recent tool-failure metadata so new failures can trigger a check during an ongoing task.
- Include only recent failed tool results in monitor evidence; redact common credentials and cap excerpt size.
- Ask Jev for an explicit poor-fit boolean during monitoring. Accept an alternate-model suggestion only when its probability meets the defined threshold; otherwise keep the pin.
- Keep cancellation, timeout, and fallback paths fail-closed to the existing pin.

Run the targeted monitor tests and the full suite.

## Task 3: Generalize adaptive effort across supported Pi models

**Files:** `index.ts`, `index.test.mjs`

- Allow `adaptiveThinking` on any configured route with automatic or custom supported effort choices.
- For non-Astra providers, apply the selected effort through Pi's `SimpleStreamOptions.reasoning` setting and persist it on the session branch.
- Retain Astra's append-only Responses configuration updates and replay/rebase logic.
- Use only bounded, redacted failed-tool evidence for Jev's effort choice; if evaluation fails, preserve the current effort.

Run tests for both a generic reasoning model and Astra persistence/replay.

## Task 4: Document the policy and its limits

**Files:** `README.md`

- Describe cross-model adaptive effort, the evidence threshold for fork suggestions, and the fact that model switching remains manual through a fork.
- Document data sent for adaptive decisions and the limits of best-effort redaction.
- Keep install/use instructions unchanged; do not install the forked extension into the global Pi profile yet.

## Final verification

- Run `npm test`.
- Verify the tracked lockfile is unchanged and no temporary lockfile alias remains.
- Inspect `git diff --check`, `git diff --stat`, and the final working-tree status.
- Smoke-check Pi 0.99.1 can load the modified extension through a local extension invocation without configuring Jev credentials or changing `~/.pi/agent/settings.json`.
