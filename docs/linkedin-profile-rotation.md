# LinkedIn profile rotation (Kyle vs Hudson)

Connection Sync (and other LinkedIn workflows) can run as **Kyle** or **Hudson** by passing the right `sessionCookie` and `userAgent` in the PhantomBuster launch. Right now **Take one profile** returns the first item only, so one profile is used every run. To **rotate** between the two:

## Recommendation: round-robin by day

Use the **calendar day** to pick which profile runs. Both profiles get used regularly without overlapping on the same run, and you don’t need external state.

**Replace the "Take one profile" Code node** with logic like:

```javascript
// Rotate between profiles by day: even day = first profile (e.g. Kyle), odd day = second (e.g. Hudson).
const items = $input.all();
if (!items.length) return [];
const day = new Date().getDate();
const index = day % items.length;
return [items[index]];
```

- **Pro:** No state, no extra nodes; same workflow runs daily with a different profile each day.
- **Con:** Both profiles run only every other day. If you need both every day, use two runs (e.g. different schedules) or round-robin by hour (see below).

**Variants:**

- **By hour:** `const index = (Math.floor(Date.now() / 3600000) % 2);` — alternates each hour (good for multiple runs per day).
- **By run count (would need state):** Not recommended unless you store “last used” in static data or an external store.

## Production: two schedule triggers, 5 min apart

**Connection Sync in production** uses two schedule triggers so each profile runs once per day with a 5-minute stagger:

- **Schedule Kyle** — 6:00 PM Mon–Sat → Set profile Kyle (`profileIndex: 0`) → Fetch Doppler → Merge **Profile + Doppler** → Build profile items → Take one profile (by `profileIndex`) → PhantomBuster (Kyle).
- **Schedule Hudson** — 6:05 PM Mon–Sat → Set profile Hudson (`profileIndex: 1`) → same path for Hudson.

Manual/webhook runs use **Set profile for manual** (round-robin by day). See WORKFLOW-PROCESS.md for the full flow.

## Alternative: two schedule triggers

Keep **Take one profile** as “first only” and add **two** schedule triggers (or two webhook paths): one that filters to Kyle only and one to Hudson only. Each trigger runs the same workflow but with a different “profile” input (e.g. from a preceding Code node that outputs one item). That way you control who runs when (e.g. Kyle at 6am, Hudson at 6pm) without changing the rotation logic. Connection Sync uses this pattern with **Schedule Kyle** (6:00 PM) and **Schedule Hudson** (6:05 PM).

## Implementation note

The **Build profile items with cookies** node already outputs two items (Kyle, Hudson). The node that currently does “take one” should be updated to the round-robin logic above so n8n still receives a **single** item for the phantom (per the single-item rule) while switching which profile that item is.
