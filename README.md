# Audio Player

An iPod-style browser player for local audio, with a temporary phone remote. Music stays on the laptop; AWS stores only a small playback snapshot and commands. Local playback works without AWS. Pick files with **Add new song**; Next/Previous wrap, and the queue stops after its last track. The progress bar seeks, and the wheel controls volume. Files must be selected again after reloading the page.

## Deploy the API manually

Use the existing AWS profile `audio-player`, region `eu-north-1`, and Terraform in `infra/`. Keep local credentials and state private. No deployment is performed by editing these files.

1. Set the actual allowed origins in a local, ignored `infra/demo.auto.tfvars`:

   ```hcl
   frontend_origins = [
     "http://localhost:3000",
     "http://<LAPTOP_LAN_IP>:3000",
   ]
   ```

   Replace the LAN placeholder with the laptop's actual Wi-Fi address. An origin includes scheme and port, with no path or trailing slash. Use that same LAN origin on both devices. Cookies are not used.

2. **Rebuild the ZIP before plan**, including whenever Lambda source changes. Install Python 3.13, pip and zip on your machine first, then run from the repository:

   ```bash
   bash backend/package.sh
   ```

   The script packages pinned dependencies for Python 3.13 / Linux arm64 in a fresh temporary directory, then puts `handler.py` and any other top-level backend Python modules at the ZIP root beside those dependencies. It replaces `build/create-session.zip`, ignores old build contents, and excludes frontend, `.venv` and secrets. The Lambda entrypoint remains `handler.lambda_handler`. Keep any new helper modules directly under `backend/`.

3. Format and validate, then prepare and inspect a saved plan:

   ```bash
   export AWS_PROFILE=audio-player
   terraform -chdir=infra init
   terraform -chdir=infra fmt
   terraform -chdir=infra validate
   terraform -chdir=infra plan -out=demo.tfplan
   terraform -chdir=infra show demo.tfplan
   ```

   Inspect all changes before applying. Stop for unexpected replacements or deletes of the existing table, Lambda, IAM or API; resource counts depend on the actual plan. Plans and state stay out of Git.

4. Apply the reviewed plan and read the URL:

   ```bash
   terraform -chdir=infra apply demo.tfplan
   terraform -chdir=infra output -raw api_url
   ```

All routes share the existing Lambda: `POST /sessions`, `GET /sessions/{id}`, `POST /sessions/{id}/commands`, `POST /sessions/{id}/sync`. Its role uses only `dynamodb:PutItem`, `dynamodb:GetItem`, `dynamodb:UpdateItem` on the existing table and the existing log stream/write permissions. Capacity remains 1 RCU / 1 WCU, logs expire after 3 days, and API throttling is rate 2 / burst 4. Throttling is not a hard spending cap. TTL on `expiresAt` cleans up eventually; the code enforces expiry immediately.

## Start the laptop frontend

Create a local `.env.local` yourself; do not commit it or put AWS credentials there:

```dotenv
NEXT_PUBLIC_API_URL=https://<API_ID>.execute-api.eu-north-1.amazonaws.com
```

Use `api_url` from Terraform. Install frontend packages with `npm ci` if needed. Changing this public configuration can require restarting the dev server:

```bash
npm run dev -- --hostname 0.0.0.0
```

Open `http://<LAPTOP_LAN_IP>:3000` on the laptop and phone in the same Wi-Fi network. Localhost on a phone refers to the phone itself. The laptop's firewall must allow this development server. Use the actual origin in CORS above.

Select local tracks, press **Play on the laptop first**, then open **Music Menu → Remote control** (phone icon) and click **Создать пульт**. Creation, status and the link are shown inside the player's display; use **MENU** to return to the menu. Switching screens keeps the session active. The player keeps its host credentials only in page memory and displays `/remote/<sessionId>#token=<remoteToken>` using its current frontend origin. Select the read-only field to copy the link manually; Clipboard API is not required. Never share the link publicly. Reloading the player requires selecting music and creating a new session.

## Phone remote and request flow

Open the copied link on the phone. The remote reads its token from the fragment, saves it to `sessionStorage` for this session and removes the fragment from the address bar. Refresh works in the same tab when storage is available. If storage is blocked, keep the original link for reopening; the current page can still work from memory. A missing, invalid or expired token stops polling and displays an explanation.

The phone sends `POST /sessions/{id}/commands` with its remote token → the existing Lambda conditionally stores one pending command in DynamoDB → the laptop receives it via `POST /sessions/{id}/sync` with its separate host token → the existing audio hook executes the operation → sync sends the saved ACK and actual state → phone `GET /sessions/{id}` sees `applied`, `failed` or `expired`. HTTP 202 only means accepted. GET and command responses never return tokens or their hashes.

Positions/durations are integer milliseconds; expiry timestamps are Unix seconds. A session lasts two hours, a command 30 seconds, and the server considers the player offline after 20 seconds without sync. A new session starts offline. State is bounded to 512-character title/error strings, 128-character track IDs and a maximum position/duration of seven days; requests are limited to 8 KiB. Long local filenames/errors are shortened only in the remote snapshot. Local playback is unaffected by those transport bounds.

Both polling loops use sequential requests, cancellation and backoff for network errors, 429 and server errors. The laptop continues syncing in a hidden tab. The phone polls every five seconds only while visible, and reads current state before resuming commands. The remote locks new commands while a request is sending, pending or uncertain. After an unknown POST outcome it first performs GET. If the command is absent, **Повторить ту же команду** resends the original seq/payload; it does not allocate a replacement Next. The laptop retains each executed seq and its ACK in memory, so an unsuccessful ACK response causes an ACK retry, not another execution. Expired commands and late ACKs cannot revive a command.

## Manual acceptance (two devices)

1. **Creation, controls and local playback:** on the LAN frontend, select at least two files and start playback locally. Create a remote, check its link has the LAN origin and only the remote token in its fragment. On the phone, Play/Pause and Next must affect the laptop; wait for **Выполнено плеером**, not just **Принята**. Refresh the phone tab and check it reconnects without a fragment. With API access blocked, verify the ordinary laptop file picker, playback, queue, volume, previous/next and local seek still work.
2. **Seek:** drag the phone slider and release it. In DevTools Network check there is one command POST for the completed gesture, with integer `positionMs` and its original `trackId`. Repeat while paused; it should remain paused. Hold a gesture on track A, change to B on the laptop, then release: B must not be moved by A's seek. The result should be failed if the command reaches the new track, or no command if controls became unavailable.
3. **Visibility and offline:** hide the phone tab and check GET polling stops; return and check it resumes. Hide the laptop tab and check sync continues subject to browser scheduling. Close the player tab or sleep the laptop; after the server's 20-second threshold and a subsequent phone poll, the phone should show offline and disable commands. On reopening/reloading the player, select music and create a new session.
4. **Connection loss and duplicate requests:** use DevTools Offline/request blocking around a phone Next, then reconnect. An unknown result must first be resolved by GET; if a retry button appears, its POST must keep the exact original seq/payload. Replaying an accepted POST with the same body/token should return 200 and not advance the track again. Changing its body while keeping seq should produce 409. Reliably dropping *only a response after the server has committed*, especially the laptop's ACK response, is not easy to guarantee with ordinary UI/DevTools: that needs controlled interception. Do not treat a simple Offline toggle as proof of that case. Under such interception, an ACK retry must not execute Next again on the same player page.
5. **Credentials and expiry:** open the remote URL without a fragment in a fresh tab without its sessionStorage, and then open it with a wrong but well-formed fragment token: expect a clear error and no endless requests. Check expiry after two hours (waiting, or a separately controlled backend fixture; ordinary UI cannot shorten it). Invalid credentials should yield 401, the other role's token 403, and an existing expired session 410; after TTL deletion it can be 404. For the 30-second command timeout, suspend laptop JavaScript after a recent sync, submit a command while still online, wait beyond 30 seconds, then resume; expect expired, without late execution. This timing scenario may require the laptop's DevTools debugger.

## Limits and review status

One open player page, one remote and at most one unfinished command per session are supported. Polling adds latency, and browser background/sleep timer limits can delay it further. Audio files and host credentials live only in player page memory; a player reload loses both and requires a new session. Exactly-once execution across a browser crash/reload is not guaranteed. The demo frontend uses the shared Wi-Fi network; AWS carries only metadata and commands. No accounts, audio upload, WebSocket or deployment pipeline are included.

Functional checks, browser runs, tests, builds, package installs, ZIP packaging, Terraform and AWS commands have **not** been run as part of these changes. Readiness must be confirmed by the user with the manual deployment and acceptance steps above. Rebuild the ZIP for every Lambda source change before making a fresh plan; restart the frontend after changing its public API configuration when necessary.
