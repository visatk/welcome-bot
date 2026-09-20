// Usage: BOT_TOKEN=... WEBHOOK_SECRET=... WORKER_URL=https://your-worker.workers.dev node scripts/set-webhook.mjs
const { BOT_TOKEN, WEBHOOK_SECRET, WORKER_URL } = process.env;

if (!BOT_TOKEN || !WEBHOOK_SECRET || !WORKER_URL) {
  console.error("Missing BOT_TOKEN, WEBHOOK_SECRET, or WORKER_URL environment variable.");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: `${WORKER_URL.replace(/\/$/, "")}/webhook`,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  }),
});

const data = await res.json();
console.log(JSON.stringify(data, null, 2));
if (!data.ok) process.exit(1);
