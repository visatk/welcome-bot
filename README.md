# Telegram Welcome Bot — Ephemeral + Rich Messages (Cloudflare Workers)

A production-shaped welcome bot for Telegram groups/supergroups that:

- Greets each new member with a **random** message template
- Sends it as an **Ephemeral Message** (Bot API 10.2/10.3) — visible only to
  that member and the bot, not persisted in chat history
- Formats it as a **Rich Message** (Bot API 10.1–10.3) with a heading,
  paragraphs, and a row of `RichMessageButton`s ("Rules" link + "I've read
  this" acknowledgement button)
- **Auto-deletes** the ephemeral message after a configurable delay via an
  explicit `deleteEphemeralMessage` call, scheduled on a Cloudflare Queue

It runs as a single Cloudflare Worker with one Queue consumer for delayed
deletion — no cron polling, no external database required.

## Why these specific Bot API pieces

Bot API 10.2 (2026-07-14) introduced **Ephemeral Messages**: bots can send
group messages visible only to one user, using `receiver_user_id` /
`callback_query_id`, and later delete them with `deleteEphemeralMessage`.
Bot API 10.3 (2026-08-24) consolidated those into a single
`EphemeralMessageParameters` object passed as `ephemeral_message_parameters`
on `sendMessage`, `sendRichMessage`, and friends, and added
`replace_callback_query_message` so a button tap's ephemeral reply can
*replace* the original message in the tapper's view.

Reference: https://core.telegram.org/bots/api#ephemeralmessageparameters,
https://core.telegram.org/bots/api#deleteephemeralmessage

Bot API 10.1–10.3 introduced **Rich Messages**: `InputRichMessage` describes
structured content as `blocks` (paragraphs, headings, dividers, button
rows...) instead of a single formatted string, and Bot API 10.3 added
`RichMessageButton` / `RichBlockButtons` so those blocks can include
in-message buttons with styles (`primary`, `success`, `danger`, `link`) —
distinct from the classic `InlineKeyboardMarkup` attached below a message.

Reference: https://core.telegram.org/bots/features#rich-messages,
https://core.telegram.org/bots/api#inputrichmessage,
https://core.telegram.org/bots/api#richmessagebutton

## Architecture

```
Telegram ──POST /webhook──▶ Worker fetch()
                               │  verify X-Telegram-Bot-Api-Secret-Token
                               │  ctx.waitUntil(handleUpdate) → 200 OK immediately
                               ▼
                        new_chat_members?
                               │
                     pick random template (KV or built-in)
                     build InputRichMessage (heading + text + buttons)
                     sendRichMessage(..., ephemeral_message_parameters:
                                            { receiver_user_id })
                               │
                     enqueue AUTO_DELETE_QUEUE (delaySeconds: N)
                               │
                               ▼
                     queue() consumer, N seconds later
                     deleteEphemeralMessage({ chat_id, receiver_user_id,
                                               ephemeral_message_id })
```

Button taps (`callback_query` for `welcome:ack:<user_id>`) are answered with
`answerCallbackQuery`, then a short ephemeral confirmation is sent using
`callback_query_id` + `replace_callback_query_message: true`, which swaps
the tapper's view of the original ephemeral message instead of adding a new
one.

## Project layout

```
src/
  index.ts      Worker entrypoint: fetch() webhook handler + queue() consumer
  telegram.ts   Typed client for the ephemeral/rich-message API surface
  messages.ts   Random template pool + InputRichMessage builder
scripts/
  set-webhook.mjs         one-off: register the webhook URL with Telegram
  register-commands.mjs   one-off: register /rules /verify as is_ephemeral commands
wrangler.jsonc  Worker config: KV + Queue bindings, vars, observability
```

## Setup

1. **Create the bot** with [@BotFather](https://t.me/BotFather) and grab the
   token.

2. **Give the bot admin rights** in the target group, including the new
   `can_send_welcome_messages` right (Bot API 10.3) — without it,
   ephemeral welcome sends will be rejected. You can also grant this
   programmatically via `promoteChatMember` (see `TelegramClient.promoteChatMember`
   in `src/telegram.ts`).

3. **Install deps and create the Cloudflare resources:**

   ```bash
   npm install
   npx wrangler kv namespace create WELCOME_KV
   npx wrangler queues create welcome-bot-auto-delete
   npx wrangler queues create welcome-bot-auto-delete-dlq
   ```

   Paste the returned KV namespace id into `wrangler.jsonc`.

4. **Set secrets** (never put these in `wrangler.jsonc`):

   ```bash
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put WEBHOOK_SECRET   # any random string you choose
   ```

5. **Deploy:**

   ```bash
   npm run deploy
   ```

6. **Point Telegram at the Worker:**

   ```bash
   BOT_TOKEN=... WEBHOOK_SECRET=... WORKER_URL=https://telegram-welcome-bot.<subdomain>.workers.dev \
     npm run set:webhook
   ```

7. **(Optional) Register ephemeral commands:**

   ```bash
   BOT_TOKEN=... npm run register:commands
   ```

## Customizing the welcome pool

Templates and the per-chat rules URL live in KV so they can be edited
without a redeploy:

```bash
# Replace the whole template pool
npx wrangler kv key put --binding=WELCOME_KV templates \
  '["👋 Hey {name}, glad you joined {chat}!", "🚀 {name} just landed in {chat}."]'

# Set the "Rules" button target for a specific chat
npx wrangler kv key put --binding=WELCOME_KV "rules_url:-1001234567890" \
  "https://t.me/c/1234567890/2"
```

`{name}` and `{chat}` are substituted per member at send time.

## Notes on Cloudflare Workers patterns used here

- The webhook handler returns `200 OK` immediately and does the actual
  Telegram calls inside `ctx.waitUntil(...)`, so Telegram's webhook
  delivery never times out waiting on our downstream API calls.
- Deletion is scheduled via a **Queue** with `delaySeconds`, not
  `setTimeout` — Workers don't keep an isolate alive across a delay, so
  the delay has to be handled by a platform primitive (Queue or Durable
  Object alarm). A Queue was chosen here because the job is simple,
  single-step, and needs at-least-once delivery with retries — see
  `queues` in `wrangler.jsonc` and `queue()` in `src/index.ts`.
- The webhook secret is compared with `crypto.subtle.timingSafeEqual`
  over SHA-256 digests of both sides, not `===`, to avoid a timing
  side-channel and a length-leak short-circuit.
- No module-level mutable state; all per-request data flows through
  function arguments, per Workers' isolate-reuse model.
- Bindings (`WELCOME_KV`, `AUTO_DELETE_QUEUE`) are declared in
  `wrangler.jsonc` and typed on the `Env` interface — run
  `npx wrangler types` after changing bindings to regenerate types.
