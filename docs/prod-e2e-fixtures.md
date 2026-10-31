# Production E2E fixtures

The specs in `e2e/prod/` (run by `playwright.prod.config.mjs`) read real Events
of the **e2e-test** Organizer in production. Its only Artist is the test Artist
**Liverty Music Band**. No real Artist is on its roster, so fans who follow
real Artists never see these Events.

This page covers:

- which Event each spec needs;
- how the test accounts' sessions are kept;
- how to create the Events and how to retire them.

Everything local lives in `.auth/`, which is gitignored: the sessions, the
fixture ids and the test user's password.

## Which spec needs which Event

Each fixture is its own Series of the test Artist, because the publish state
and the visibility belong to the Series.

| Variable | Series | Read by |
|---|---|---|
| `E2E_EVENT_PUBLIC_ID` | 公開, published, not yet held | `open-a-shared-event-link` (guest and signed in) |
| `E2E_EVENT_UPCOMING_ID` | 公開, published, not yet held | `open-a-shared-event-link` (signed in) |
| `E2E_EVENT_UNLISTED_ID` | 限定公開, published | `open-a-shared-event-link` (guest) |
| `E2E_EVENT_CANCELLED_ID` | 公開, published, then cancelled | `open-a-shared-event-link` (guest) |
| `E2E_SALE_EVENT_ID` | 公開, published | `buy-tickets-first-come` |
| `E2E_REFERRAL_EVENT_ID` | 公開, published | `attribute-a-purchase-to-a-referral-link` |
| `E2E_RESALE_EVENT_ID` | 公開, published, more than a day away | `resell-a-ticket` |

`E2E_EVENT_PUBLIC_ID` and `E2E_EVENT_UPCOMING_ID` may be the same Event.

`complete-onboarding` needs no Event:

- The guest spec follows real Artists found by search.
- The signed-in spec replays the sign-up payoff for the test user. If the test user has no home area yet, its first run sets the area to 東京, as the Timetable asks before the payoff.

Keep the ids in `.auth/prod-e2e.env`, one `NAME=value` per line. Load them
with `set -a && . .auth/prod-e2e.env && set +a`, or pass the file with
`docker run --env-file`.

The purchase specs open their own first-come sale on their Event: each run
adds a fresh SeatType (named `E2E <time>`) to the Event's Series, stocks it for
the Event and creates a first-come sale on the Event, ending the Event's open
first-come sale first.

Two rules make a used Event unusable for the next run:

- **One seat type per account and Event.** The test user can hold tickets of
  only one seat type of an Event, and every run buys a new seat type, so
  **each run needs a fresh Event** the test user holds no tickets for.
- **The per-account limit is the Event's.** It counts every ticket the fan
  holds or applied for at the Event, across every sale and seat type. It is set
  in the concert editor and **can be changed only while the Event is DRAFT**;
  once published it is fixed. Events published before the limit existed have
  4, which is too few for `buy-tickets-first-come`. Set the limit before
  publishing a fixture Event.

| Spec | Sale | Tickets the test user buys per run | Per-account limit the Event needs | When to create a new Event |
|---|---|---|---|---|
| `buy-tickets-first-come` | 5 tickets of 3000 yen | up to 5 | 5 or more | for every run |
| `attribute-a-purchase-to-a-referral-link` | 5 tickets of 3000 yen | 2 | 2 or more (4 is enough) | for every run |
| `resell-a-ticket` | 2 tickets of 5000 yen | 2 | 2 or more (4 is enough) | for every run, unless the run ended right after the stock sold out (a rerun picks that stock up) |

## Sessions

| File | Account | How to get it |
|---|---|---|
| `.auth/storageState.prod.json` | the prod E2E test user | `npm run auth:capture:password:prod` |
| `.auth/storageState.prod.fan2.json` | the second fan | the same command, with `E2E_USERNAME=<fan email> E2E_STATE_FILE=storageState.prod.fan2.json` |
| `.auth/storageState.prod.fan3.json` | the third fan (unused until buying listed tickets returns with `resell-tickets-by-lottery`) | the same command, with `E2E_STATE_FILE=storageState.prod.fan3.json` |
| `.auth/storageState.organizer.prod.json` | the e2e-test Organizer's test member (owner role) | see "The test member" |

### Sessions are written back after use

Zitadel rotates a refresh token on every use and rejects the old one. An
access token lasts about 30 minutes.

A session file therefore keeps working only until its refresh token is first
used, unless the renewed session is written back to the file. The prod specs
do this in `e2e/prod/session.ts`:

- The `test` exported there writes the project's session file back when each
  test ends.
- `closeFan` writes a second or third fan's session back before it closes
  that fan's context.
- `organizerToken` writes the test member's session back, with its passkey,
  each time it renews the token.

Any other script that opens a context from one of these files must write the
file back in the same way. Otherwise the file stops working once the access
token in it has expired.

A fan whose file has stopped working is recovered by capturing again. The test
member is recovered by signing in again with the passkey, as described below.

### The test member

The test member signs in with a passkey held by Playwright's virtual
authenticator. The private key is stored in the session file, written by
`context.storageState({ path, credentials: true })`.

> [!WARNING]
> Never write this file with `storageState()` without `credentials: true`.
> Doing so drops the private key, and the member can no longer sign in.

To sign in again with the passkey alone:

1. Create a context whose `storageState` carries only the file's
   `credentials`.
2. Call `context.credentials.install()`.
3. Open `https://organizer.liverty-music.app/?org=e2e-test` and wait until
   you are back on the console.
4. Save the file with `credentials: true`.

The member was created once with the organizer provisioner's machine key,
which is kept in Secret Manager. The provisioner did what the backend's
`OrganizationRepository` does: it created a passwordless identity in the
Organizer's Zitadel Organization, gave it the owner role, and issued an invite
code. The passkey was registered by opening the invite link in a context after
`context.credentials.install()` and choosing パスキー.

If the passkey is lost, issue a new invite, as the organizer guide tells a real
member to do:

1. With the provisioner key, remove the member's passkey
   (`UserService.RemovePasskey`).
2. Create an invite code (`UserService.CreateInviteCode` with `returnCode`).
3. Register a new passkey the same way, and save with `credentials: true`.
4. Delete the key file and the code.

### The organizer access token

`buy-tickets-first-come`, `attribute-a-purchase-to-a-referral-link` and
`resell-a-ticket` open and read sales as the Organizer. They get the member's
access token from `organizerToken(browser)`, which opens the organizer console
with the member's session and reads the token from `localStorage`. It renews
the token when fewer than 5 minutes are left, so a run may last longer than one
token.

## Creating the Events

Sign in to the organizer console as the test member and open `?org=e2e-test`.
For each Series in the table above:

1. 公演をつくる for Liverty Music Band, with:
   - a title such as `E2E Public`;
   - 公開 or 限定公開;
   - a venue picked from the map catalog;
   - a date, different for each Series;
   - a start time (the purchase specs end their sale at it);
   - for a purchase spec's Event, the date's per-account limit from the table
     above (it cannot be changed after publishing).
2. 公開する, and confirm.
3. For the cancelled fixture only: その他の操作 → 公演を中止, and confirm.

The Event id is the last path segment of the date's link on the Series page
(`…/events/<id>`).

> [!WARNING]
> An Event is one venue, date and start time. A new Series on the same venue,
> date and start time as an existing one gets that existing Event, not a new
> one: the old fixture's Event then shows the new Series, and a 限定公開 or
> cancelled fixture stops being one. If the slot is held by a cancelled Event,
> publishing fails with `the event's slot is held by a cancelled event`.
>
> Before creating a fixture, pick a date no other fixture uses (the table of
> variables above names them all, and the Series list shows the rest). After
> creating it, check that its Event id is new: Event ids are time-ordered, so
> a new Event's id starts like its Series id (`01a18b5e-6d44-79…` for Series
> `01a18b5e-6d44-79…`), while a reused Event's id is older.

## Running

Run the specs in the pinned Playwright container, as each purchase spec's
header shows. Mount `.auth/` so the renewed sessions are written back to it:

```bash
docker run --rm --network host --env-file .auth/prod-e2e.env \
  -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.64.1-noble \
  npx playwright test -c playwright.prod.config.mjs
```

The whole suite takes over an hour, because the purchase specs wait out
15-minute holds.

## Retiring used Events

An Event with Orders cannot be deleted until its Orders are refunded. To remove
a fixture:

1. In the organizer console, open its Series and choose その他の操作 →
   公演を中止.
2. In the admin console, open the e2e-test Organizer's roster, then Liverty
   Music Band's concerts.
3. Use `Refund all` to refund every Paid Order of the cancelled Concert.
4. Use `Delete` to remove it.

`Delete` refuses while a purchase is still in progress, such as a held
checkout or an open card authorization. Wait for the hold to end, and try
again.
