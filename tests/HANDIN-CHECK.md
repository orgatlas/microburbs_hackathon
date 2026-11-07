# Fresh-clone hand-in check

**Verdict: core flow passes; hand-in evidence is incomplete.** The required three root files are present, the video passes, and all 151 core tests pass. The report still contains an unfinished held-out result. The supplied browser regression runners do not establish that the current extension works automatically on the six listings.

## Audit scope

- Judging scenario: 15:30, 7 November 2026, Sydney. This is an actual pre-deadline audit, started at **15:00 Sydney**, not a claim that the repository was checked at 15:30.
- Fresh clone: `https://github.com/orgatlas/microburbs_hackathon`, branch `main`, commit **7532765d9e9c752de094fbc05ffa2ee55571eb03**.
- Location: `/tmp/microburbs-handin-E3ef7M/clone`. All execution used this clone. Existing working-copy services were identified and excluded from pass evidence.
- The only Git operation was the expressly requested `git clone`. No pull, status, checkout, commit or other Git command was run.
- The human's existing `MICROBURBS_API_KEY` was copied privately into the clone's `proxy/.env`, after checking the pristine checkout. Its value is not included here.
- Environment: macOS, Node 24.15.0, Python 3.14, Chromium through Playwright, ffprobe/ffmpeg. This does not establish compatibility with every unspecified version in the README.
- Only this file was written in the working copy. Dependency installation, build output, test databases, browser profiles and diagnostic logs were confined to the temporary audit area.
- Completed at **15:08 Sydney**, within the requested ten minutes. Stopped the temporary audit servers/browser runner; removed the copied key, raw lookup response and audit account browser profile. Confirmed the three normal application ports still had listeners and the four audit ports no longer did.

## Ranked findings: what would stop a judge

| Priority | Status | Finding and consequence | Concrete next action |
|---|---|---|---|
| 1 — submission evidence | **FAIL** | `report.html:208–229` still says `PLACEHOLDER`, `Held-out result: HELD_OUT`, and has seven pending result rows. Its stated 14:50 completion time has passed. A judge cannot assess held-out address accuracy. | Enter a measured denominator, exact/building/wrong/no-match counts, assisted results separately, sample method and limitations before 15:30. Do not substitute this audit's one manually entered address for held-out evidence. |
| 2 — reproducible launch | **BLOCKED in the literal run** | All three README ports were occupied by the working copy. `./run.sh` installed dependencies and migrated successfully, then skipped every server, printed the advertised URLs and exited. It does not verify which application owns a port. Following the URLs would have tested the wrong checkout. Skipping occupied ports is documented; identifying stale services and isolating a second checkout is not. | On the judging machine, free ports 3000, 3001 and 8001 first, or document a supported isolated-port procedure. This is an environment collision, not proof of failure on an otherwise clean machine. |
| 3 — automatic listing evidence | **NOT VERIFIED** | A live Domain page returned HTTP 200 but exposed no title or H1 in the browser check. Automatic extraction and a manual toolbar-icon click were not proved. The documented typed-address fallback did render a real exact match and personalised score. | Rehearse the actual live listing and toolbar flow in Chrome; retain the documented type-it fallback. |
| 4 — browser regression tooling | **FAIL / INCOMPLETE** | `tests/e2e/run.mjs` tries to start deleted `proxy/src/server.js` and reports `RESULT FAIL (1)`. `tests/e2e/contract2.mjs` assumes port 8787 and the former `#mbx-root` overlay; the shipped extension calls port 3000 and uses a side panel. Its full six-listing run was not completed within this audit. | Update the runners to the current proxy entry point, ports, quiz profile and side-panel DOM, then rerun. Direct proxy responses do not prove extension rendering. |
| 5 — source hygiene ambiguity | **FLAG** | A concrete, real-shaped G-NAF identifier remains in an inline scoring fixture and in an API example. A literal requirement for no G-NAF IDs in fixtures therefore fails. This is not evidence that the surrounding hand-written fixture was copied from an API response. | Replace the concrete example identifier/address with explicitly synthetic fixture values if the hand-in rule excludes them. |
| 6 — prerequisites | **FAIL: README incomplete** | README says only “Node.js, Python 3 and Chrome.” `proxy/package.json` requires Node >=20.12; the installed pinned Django 6.1.3 requires Python >=3.12. `run.sh` also uses npm, Bash, lsof and pgrep. Older Python 3 installations cannot install the pinned Django. | State minimum versions and required command-line tools. |
| 7 — explanation accuracy | **FAIL: README mismatch** | README “The clever step” says commute is fixed at 0.25 and only three quiz weights vary. The actual website quiz saved four dimension weights plus metric weights; this audit's commute weight was 0.3448275862. | Describe the current website profile/scoring path, distinguishing any legacy three-weight fallback. |
| 8 — developer verification | **FAIL: README incomplete** | README gives no test commands, Playwright/tools installation instructions or browser-runner prerequisites. The test commands below were discovered from source/package files. | Add a short verification section after repairing the browser runners. |

## README, followed in order

The literal procedure stopped being an isolated fresh-clone run at step 2. Later successful UI checks used a separate, explicitly documented audit workaround; they are not presented as a literal README pass.

| README step | Status | Observation |
|---|---|---|
| Obtain repository | **PASS** | Fresh HTTPS clone succeeded into the temporary directory; no working-copy application files were used. |
| Prerequisites | **PASS here / documentation FAIL** | Installed tool versions worked. Minimum versions and supporting shell tools are omitted from the README. |
| 1. Copy `proxy/.env.example`, set team key | **PASS** | Template exists. Copied the human's key privately. Fresh proxy accepted the key. No browser key injection was used. |
| 2a. Execute `./run.sh` | **PASS: bootstrap** | Script was executable; created `backend/.venv`, installed Python and both npm dependency sets, and ran migrations successfully. No extra backend secret was required. |
| 2b. Start the three advertised services | **BLOCKED: occupied ports** | Proxy 3000, Django 8001 and website 3001 were already listeners from the working copy. All three were skipped. No existing service was stopped. |
| 3. Load unpacked `./extension` | **PASS: automated equivalent** | Chromium loaded the unchanged unpacked clone extension; its extension service worker started. Chrome's Developer-mode UI clicks themselves were not manually exercised. |
| 4. Website signup, quiz, dashboard bridge | **PASS with isolated routing** | Created a new audit account in the clone's database through the actual website UI, completed the quiz and reached the dashboard. Read the resulting profile from the extension's storage without injecting it. |
| 5a. Open listing and toolbar panel | **NOT VERIFIED end to end** | Opened the live Domain listing `59 Portman Street, Zetland`; response was HTTP 200, but no title/H1 was observed. Opened the extension's actual panel page attached to that tab for the fallback check. No automatic extraction or native-toolbar-click pass is claimed. |
| 5b. Type an address in the panel | **PASS with live API** | Typed `401/2 Victoria Park Parade, Zetland NSW`. Panel reached `matched`, showed `UNIT 401/2 Victoria Park Parade, Zetland`, confidence `Exact match`, fit **41/100**, bus **66 m**, and rent **$1,100/wk · 183% of income**. It disclosed **10 of 15 scored; 5 signals had no data**. |
| Stop using Ctrl+C | **NOT VERIFIED for a full `run.sh` stack** | The literal run had already exited because it started no servers. Audit-only servers were separately cleaned up. |

### Supplemental isolation procedure and observed profile

To avoid using the working copy, started the clone's existing sources without editing them:

```sh
# Each command was run from its indicated clone directory.
# proxy/
PORT=13000 node server.js
# backend/
.venv/bin/python manage.py runserver 18001 --noreload
# frontend/
./node_modules/.bin/next dev -p 13001
```

Chromium host-resolver rules mapped `localhost:3000` → `127.0.0.1:13000`, `localhost:8001` → `127.0.0.1:18001` and `localhost:3001` → `127.0.0.1:13001`. Verified actual server ports before account creation. This is audit-specific knowledge absent from the README, not a proposed judge requirement. A sandbox-only Next.js filesystem-watcher restriction was resolved by running the same command outside the sandbox; it is not counted as a product defect.

The fresh proxy and Django health endpoints returned HTTP 200. Django also returned `Access-Control-Allow-Origin: *` for an extension-origin request. A direct fresh-proxy lookup returned HTTP 200 and an exact match before the panel verification.

The website quiz produced this saved profile for audit account **Judge Sarah**, income **$600/week**, rental budget **$250/week**, work address **Broadway, Ultimo NSW**:

| Dimension | Saved weight |
|---|---:|
| Commute | 34.4828% |
| Safety | 6.8966% |
| Lifestyle | 12.0690% |
| Price | 46.5517% |

Metric weights were also present. The panel identified the same saved account and income. This is evidence that the real signup/quiz/bridge/scoring path works; it is not a six-listing benchmark or a second-person weight comparison.

## Root hand-in and video

| Check | Status | Evidence |
|---|---|---|
| `README.md` at root | **PASS** | Present and readable. |
| `report.html` at root | **PASS: presence / FAIL: completeness** | Present; held-out section remains unfinished as detailed above. |
| `demo.mp4` at root | **PASS** | Present. |
| Video strictly under 95 MB | **PASS** | **5,712,670 bytes = 5.713 MB** using decimal MB, comfortably below 95,000,000 bytes. |
| Video duration ≤3:00 | **PASS** | ffprobe: **155.500 seconds = 2:35.500**. |
| Video streams readable | **PASS** | ffprobe identified H.264 video, **1920×1080**, AAC audio and a subtitle stream. |
| Video actually decodes | **PASS** | `ffmpeg -v error -xerror -i demo.mp4 -f null -` decoded the entire file with exit 0 and no decode errors. This verifies the media, not subjective narration quality. |

Commands used for media verification:

```sh
ffprobe -v error -show_entries format=duration,size,format_name:stream=codec_name,codec_type,width,height -of json demo.mp4
ffmpeg -v error -xerror -i demo.mp4 -f null -
```

## Submitted-source hygiene

Scanned the pristine checkout **before** adding the local key, installing dependencies or running tests. The table describes submitted files, not generated dependency trees. `.env.example` templates are intentionally distinguished from secret `.env` files. No claim is made about secrets in historical compressed Git objects; no Git-history audit was performed.

| Check | Status | Evidence / limitation |
|---|---|---|
| No committed `.env` file | **PASS** | No `.env` found in the initial checkout. The audit-created local copy was not part of the submission. |
| No `data/` directory | **PASS** | No directory named `data` in the initial checkout. Live lookup succeeded without locally supplied data files. |
| No CSV files | **PASS** | No CSV files in the initial checkout. Proxy tests generate synthetic temporary CSV input; that is test runtime data, not shipped data. |
| No `ht26_` key prefix | **PASS** | No occurrence in submitted checkout content before supplying the key. Key value was never printed or added to this report. |
| No raw API output | **PASS for inspected checkout; not a provenance guarantee** | No raw response dumps or API-output files found. Inspected inline fixtures use test constructors and hand-written values. Source inspection alone cannot prove the provenance of every numeric literal. |
| No G-NAF IDs in fixtures | **FAIL literally / requires review** | `extension/sidepanel/score.test.js:54` includes a concrete `GANSW…` identifier paired with a real address; the same identifier appears in `CLAUDE.md:29`. Other hits are dummy `GANSW000…` examples in `docs/API_CONTRACT.md` and `backend/matching/tests.py`, or explicitly synthetic `GATEST…` fixtures. `tests/proxy.test.js` constructs synthetic identifiers. No list of real G-NAF records was found. |

## Test suites and build checks from the clone

| Command / location | Status | Result |
|---|---|---|
| Root: `node --test extension/address.test.js extension/sidepanel/score.test.js extension/sidepanel/fit.test.js` | **PASS** | **126 tests passed**, 0 failed. |
| `proxy/`: `npm test` | **PASS** | **14 tests passed** across the package's 4 tests and `tests/proxy.test.js`'s 10 tests. |
| `backend/`: `.venv/bin/python manage.py test` | **PASS** | **11 tests passed**; temporary test database destroyed. Non-blocking warning: missing `backend/staticfiles/` directory in development. |
| `frontend/`: `npm run lint` | **PASS with warnings** | 0 errors; 2 warnings about `window.location.assign()` in login/dashboard. |
| `frontend/`: `npm run build` | **PASS** | Production build and TypeScript check completed; all 8 static pages generated. |
| `frontend/`: `./node_modules/.bin/tsc --noEmit --incremental false` | **PASS after build** | An initial cold invocation failed on generated `LayoutProps`; the normal Next build generated the types, and the repeat passed. Standalone cold `tsc` needs type generation first. |
| Root: `node tests/e2e/run.mjs --headless --limit 1` | **FAIL** | `MODULE_NOT_FOUND`: `proxy/src/server.js`; then `FATAL proxy did not start on 8787`, `RESULT FAIL (1)`. No listing check completed. |
| Root: `node tests/e2e/contract2.mjs` | **INCOMPLETE / obsolete assumptions** | Started, then explicitly stopped after approximately four minutes without a completed result to keep the audit bounded. Static inspection confirms port 8787, legacy profile storage and the former overlay DOM. The actual extension targets port 3000, so this runner cannot substantiate an isolated current side-panel run as written; none of its activity is counted as a pass. |
| Supplemental real website + unpacked extension browser check | **PASS for signup, quiz bridge and typed lookup** | Fresh account, real quiz submission, saved profile received by extension, live API facts and rendered personalised fit. No mocked API responses or listing screenshots used. |

The README does not document these test commands. Browser tooling required an additional `npm --prefix tools install`; an existing Chromium installation was available. Other developer/demo proof scripts were not counted as completed suites. **151 core tests passing does not erase the failed browser runner or supply the missing held-out result.**

## Hand-in decision

Keep the passing video and demonstrated core flow. The highest-priority remaining action is to replace the held-out placeholder with an honest measured result **before 15:30**. Until that is done, this snapshot is runnable with the stated environment workaround but is not a complete evidence-backed hand-in.
