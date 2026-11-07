# MicroMatch

MicroMatch is a Chrome extension that tells a home buyer how well the Sydney property they're viewing matches their life. A short quiz learns what they care about. On a realestate.com.au or domain.com.au listing, MicroMatch finds the address, pulls the facts from the Microburbs API, and gives a match score that breaks down into Lifestyle & Community, Price and Safety.

> Hackathon README: finish this before 15:00. It must cover what we built, who it helps, the data, the key step, and how to run it. See [Submission](#submission).

## Who owns what

| Area | Owner | Folder | Spec |
| --- | --- | --- | --- |
| Django API and scoring | Carl | [`backend/`](backend/) | [SPEC](backend/SPEC.md) |
| Chrome extension | Hrithik | [`extension/`](extension/) | [SPEC](extension/SPEC.md) |
| Website and videos | Daniel | [`frontend/`](frontend/) | [SPEC](frontend/SPEC.md) |

All three parts meet at [docs/API_CONTRACT.md](docs/API_CONTRACT.md). Change it in the same commit as any API change, and tell the team.

```text
Listing page ──address only──▶ Extension ──address + quiz profile──▶ Django ──Bearer key──▶ Microburbs API
                               side panel ◀──match score + facts────┘
Website /try ──typed address + profile──▶ Django
```

## Run it

Start the backend first. It runs in mock mode by default, so the extension and website work before real scoring lands.

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cp .env.example .env && .venv/bin/python manage.py runserver
```

```bash
cd frontend && npm install && cp .env.example .env.local && npm run dev
```

For the extension, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select `extension/`. There's no build step.

## Team rules

- **Keep secrets out.** This repo must be public. Put the team key in `backend/.env` only. It must never appear in the extension or website.
- **Don't commit supplied data.** That means the CSVs and any saved API output, including test fixtures. Mock data must be invented. The `data/` folder is ignored, so keep the CSVs there.
- **Stay in your folder** so we avoid merge conflicts. Use a short branch per feature, and merge to `main` often.
- **Read only the address from a listing.** Never collect listing text, prices or photos. Everything else must come from the API or the user.

## Timeline

| Time | Goal |
| --- | --- |
| 13:00 | One real listing works from start to finish with real data |
| 14:00 | Feature freeze, and start recording |
| 14:30 | Videos, report and README are in the repo |
| 15:00 | **Hard deadline: uploads close** |
| 15:10 | Pitch videos play |

## Submission

The public repo needs these files at its root. Each video must be under 95 MB.

- [ ] `README.md`: what we built, who it helps, the data, the key step, how to run it, and credit for every source
- [ ] `report.html`: see the [starter](report.html)
- [ ] `pitch.mp4`: up to 45 seconds
- [ ] `demo.mp4`: up to 3 minutes, showing the extension working beside real listings

## Data sources

- Microburbs Hackathon API
- Addresses from Open G-NAF (© Geoscape Australia)
- ABS Census data (CC BY 4.0)
- Overture Maps Foundation data and OpenStreetMap data (© OpenStreetMap contributors)
