# Personal AI Voice Interview Bot: Setup and Deployment

Generative AI Assessment (Applied Gen AI Engineer). Two interchangeable implementations:

- **Option A (recommended):** Node.js + Express + browser voice, deployed on Vercel.
- **Option B:** Python + Streamlit, deployed on Streamlit Community Cloud.

Both keep `GEMINI_API_KEY` on the server. Visitors never log in or enter a key.

---

## 0. Get a Gemini API key

1. Open https://aistudio.google.com/apikey and sign in.
2. Click **Create API key** and copy it.
3. Confirm your project can use `gemini-3.8-flash` (it is listed in AI Studio's model picker).

---

## Option A: Node.js + Express (Vercel)

### A1. Run locally

```bash
cd ai-voice-interview-bot
npm install
# edit .env and replace PASTE_YOUR_GEMINI_API_KEY_HERE with your real key
npm start
```

Open http://localhost:3000 in **Chrome or Edge**. Allow the microphone when asked.

Quick API test (the second call within 1.2 seconds is dropped by the debounce guard):

```bash
curl -s http://localhost:3000/api/health
curl -s -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" \
  -d '{"message":"What is your #1 superpower?"}'
```

### A2. Push to GitHub

```bash
git init
git add .
git commit -m "Personal AI voice interview bot"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

`.env` is in `.gitignore`, so your key is never pushed.

### A3. Deploy from the Vercel dashboard

1. Go to https://vercel.com/new and import your GitHub repository.
2. On the **Configure Project** screen use exactly these settings:

| Setting | Value |
|---|---|
| Framework Preset | **Express** (if it is not listed, choose **Other**) |
| Root Directory | `./` (leave as the repository root) |
| Build Command | leave empty / default (no build step needed) |
| Output Directory | leave empty / default |
| Install Command | `npm install` (default) |
| Node.js Version | 20.x or 22.x (Project Settings, General) |

3. Expand **Environment Variables** and add:

| Name | Value | Environments |
|---|---|---|
| `GEMINI_API_KEY` | your key | Production, Preview, Development |
| `GEMINI_MODEL` (optional) | `gemini-3.8-flash` | Production, Preview |

4. Click **Deploy**. `vercel.json` already sets a 30 second function limit and bundles the `public` folder.
5. Open the `*.vercel.app` URL, press the mic, and test one preset question.

If you add or change an environment variable after deploying, go to **Deployments**, open the latest one, and choose **Redeploy** so the change takes effect.

### A4. Or deploy with the CLI

```bash
npm i -g vercel
vercel login
vercel link
vercel env add GEMINI_API_KEY production
vercel --prod
```

### Notes on rate limits on Vercel

The 1.2 second debounce lives in each serverless instance's memory, so it is a best-effort guard. The real protection is layered: the frontend locks the mic, presets and Send button while a request runs, `recognition.stop()` fires on the first final transcript, and a 429 from Gemini puts the UI into a visible cooldown.

---

## Option B: Python + Streamlit (Streamlit Community Cloud)

### B1. Run locally

```bash
cd ai-voice-interview-bot
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .streamlit/secrets.toml.example .streamlit/secrets.toml   # Windows: copy ...
# edit .streamlit/secrets.toml and paste your real key
streamlit run app.py
```

### B2. Deploy on Streamlit Community Cloud

1. Push the repo to GitHub (same commands as A2). `secrets.toml` is git-ignored; only `secrets.toml.example` is committed.
2. Go to https://share.streamlit.io and sign in with GitHub.
3. Click **Create app** and then **Deploy a public app from GitHub**.
4. Fill in:

| Field | Value |
|---|---|
| Repository | `<your-username>/<your-repo>` |
| Branch | `main` |
| Main file path | `app.py` |
| App URL | choose any free subdomain |

5. Click **Advanced settings**, choose Python 3.11 or 3.12, and in the **Secrets** box paste:

```toml
GEMINI_API_KEY = "your-real-key-here"
```

6. Click **Deploy**. First build takes a couple of minutes.
7. To change the key later: app menu, **Settings**, **Secrets**, edit, save. The app restarts automatically.

### Streamlit voice caveats

- Voice input uses the browser's Web Speech API through `streamlit-mic-recorder`, with the accent chosen in the dropdown. Chrome and Edge work best.
- Streamlit renders each answer's speech in a small iframe. If the browser blocks automatic playback, press **Play answer** under the conversation.
- For the smoothest voice experience (instant start and stop, voice picker, pulsing mic), use Option A.

---

## Customising the persona

Edit the `PROFILE` and `FIVE_QUESTIONS` blocks at the top of `server.js` (and the same blocks in `app.py` if you use Option B). The five preset answers in the persona are drafts based on your background; rewrite them in your own words and facts before sharing the link.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Mic button disabled | Use Chrome or Edge, and open the site over HTTPS (Vercel and Streamlit both are) |
| "Microphone permission is blocked" | Click the lock icon in the address bar and allow the microphone |
| No Indian English voice listed | Install an English (India) voice in your OS speech settings; the list refreshes automatically |
| 404 model error | Check `GEMINI_MODEL`; confirm `gemini-3.8-flash` is available to your key in AI Studio |
| 429 messages | Wait for the on-screen countdown; reduce rapid-fire questions |
| "GEMINI_API_KEY is missing" | Add it in Vercel Environment Variables (then redeploy) or Streamlit Secrets |
