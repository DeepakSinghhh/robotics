# Deploying DRONA for free

DRONA runs in two modes, and both can be hosted at no cost:

| Option | What you get | Cost | Data |
| --- | --- | --- | --- |
| **A. GitHub Pages** (recommended for SIH) | Public HTTPS link that anyone can open. VR works because the site is HTTPS. | Free | Stored in each visitor's browser |
| **B. Render free web service** | The full DRONA server online, with results shared across browsers | Free (sleeps when idle) | Reset on restart; the demo unit reloads automatically |
| **C. Unit laptop on the LAN** | The real deployment model: one laptop, trainees join over Wi-Fi or LAN | Free | Persistent in `./data` |

---

## A. GitHub Pages: about 3 minutes

1. **Merge the pull request** into `main` (the workflow publishes from `main`).
2. In the repository on GitHub, open **Settings → Pages** and under **Build and deployment → Source** choose
   **GitHub Actions**.
   *On a free GitHub account, Pages needs the repository to be **public** (Settings → General → Change visibility).*
3. Open the **Actions** tab. The **Deploy to GitHub Pages** workflow runs on every push to `main`. It runs the test
   suite first and only deploys if the tests pass. If it ran before Pages was enabled, open it and click
   **Re-run all jobs**, or use **Run workflow**.
4. Your site will be at **`https://<your-github-username>.github.io/<repo-name>/`**. For this repository that is
   `https://deepaksinghhh.github.io/robotics/`.

**First visit:** with no server present, DRONA shows **● OFFLINE (device)** and stores everything in that browser. On the
home page click **Load demo unit**. The browser simulates a detachment of trainees (about 2 seconds), which fills the
AAR, trainee and unit dashboards for judges. Then create your own trainee and fly.

Every later push to `main` redeploys automatically.

## B. Render: full server, free tier

1. Sign in at [render.com](https://render.com) with GitHub.
2. Choose **New → Blueprint** and select this repository. Render reads `render.yaml`, which uses the free plan,
   `npm start` and a health check on `/api/health`.
3. Click **Apply**. A few minutes later you get `https://drona-xxxx.onrender.com`.

Notes:

* The free instance sleeps after about 15 minutes idle, so the first request after a sleep takes about 30–60 s.
  Open it a minute before your demo.
* The free plan has no persistent disk, so data is wiped on restart. `DRONA_SEED_DEMO=1` (set in `render.yaml`)
  reloads the demo unit automatically whenever the datastore starts empty.
* Every trainee who opens the URL shares the same units, trainees and AARs (shows **● UNIT SERVER**).

## C. Unit laptop on the LAN (production model)

```bash
npm start                          # http://localhost:8080 and http://<laptop-LAN-IP>:8080 for trainees
npm run seed-demo                  # optional demo data (run while the server is stopped)
PORT=9000 DRONA_DATA=/srv/drona npm start   # custom port / data folder
```

Requirements: Node.js 18 or newer. There is nothing to install (`npm install` is not needed). Data is kept in `./data`;
back up that folder.

**VR headsets on the LAN.** Browsers only enable WebXR on `https://` or `localhost`. Over plain
`http://<LAN-IP>:8080` a headset gets no *Enter VR* button. Use option A or B (HTTPS) for VR, or, for a Quest headset
connected by USB, run `adb reverse tcp:8080 tcp:8080` and open `http://localhost:8080` in the headset browser.

## Checks before a demo

* Open the URL in Chrome or Edge on the demo laptop and confirm the 3D view renders and sound plays.
* Click **Load demo unit** once (option A) or wait for the seeded data (option B).
* Keep [docs/DEMO.md](DEMO.md) open. It is the 5-minute walkthrough.
