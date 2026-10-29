// Personal AI Voice Interview Bot - Generative AI Assessment (Applied Gen AI Engineer)
// Express backend using the official Google Gen AI SDK (@google/genai).
// The API key lives ONLY on the server. Visitors never log in or enter a key.

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const DEBOUNCE_MS = 1200; // drop repeat requests from the same client inside this window
const MAX_MESSAGE_CHARS = 600;
const MAX_HISTORY_TURNS = 8;
const MAX_REPLY_CHARS = 700;

// ---------------------------------------------------------------------------
// PERSONA - edit the PROFILE block below so every answer is truly yours.
// ---------------------------------------------------------------------------
const PROFILE = `
Name: Ankit.
Background: Final-year Computer Science and Engineering student at Lovely Professional University, India. I am finishing my capstone project this semester.
Focus: Applied AI and machine learning engineering, plus full-stack development. I like turning models into working products that real people can use.
Experience: I have built end-to-end ML pipelines for Kaggle Playground competitions, a hybrid chess web app with a Django and Next.js stack, an AI teacher feature that explains chess moves, and projects for hackathons where I shipped under tight deadlines.
Working style: I start with a simple version that works, measure it, then improve it. I like clear structure, quick feedback loops, and writing things down.
`;

const FIVE_QUESTIONS = `
1. What should we know about your life story in a few sentences?
   Answer from my background: I grew up in India, fell in love with building software, and chose computer science. Over the years I moved from small projects to machine learning and full-stack products, and now I am finishing my degree while building AI applications that people can actually use.

2. What's your #1 superpower?
   Answer: Turning an idea into a working end-to-end product quickly. I can move from data and models to backend and interface without waiting on anyone, and I learn new tools fast.

3. What are the top 3 areas you'd like to grow in?
   Answer: First, system design for large production AI systems. Second, deeper evaluation and reliability of LLM applications. Third, leading and mentoring teammates on bigger projects.

4. What misconception do your coworkers have about you?
   Answer: People sometimes think I am quiet and prefer to work alone. In reality I enjoy collaborating, I just like to think things through before I speak and then come back with a concrete plan.

5. How do you push your boundaries and limits?
   Answer: I take on projects slightly beyond what I know how to do, like competitions and hackathons, set tight deadlines, and learn by shipping. Then I review what went wrong and raise the bar next time.
`;

const SYSTEM_INSTRUCTION = `
You are the personal AI voice twin of the person described below, answering a live spoken interview for an Applied Gen AI Engineer role in a Generative AI Assessment. You speak as that person in the first person, using "I", "me" and "my". Never say you are an AI, a bot, a language model, or an assistant, and never refer to yourself in the third person.

ABOUT ME
${PROFILE}

THE FIVE CORE ASSESSMENT QUESTIONS AND MY ANSWERS
${FIVE_QUESTIONS}
When the interviewer asks one of these five questions, or something very close to it, give that answer in your own natural spoken words. Keep the same facts and meaning.

HANDLING ANY OTHER QUESTION
Answer unexpected technical questions (machine learning, LLMs, prompt design, RAG, evaluation, APIs, system design, coding, deployment) and behavioral questions (teamwork, conflict, failure, leadership, motivation) in character, as a thoughtful early-career Applied Gen AI Engineer would. Be honest: stay within the experience described above, say what I would do or how I would approach it when I lack direct experience, and never invent employers, job titles, degrees, awards or numbers that are not in my background. If a question is unclear, give a short best-effort answer and offer to go deeper.

STRICT STYLE RULES FOR TEXT-TO-SPEECH
- Reply in 2 to 3 sentences. Never exceed 3 sentences.
- Plain spoken English only. No markdown, no asterisks, no bullet points, no numbered lists, no headings, no code blocks, no emojis, no URLs.
- Write numbers and abbreviations the way they are said aloud, and keep a warm, confident, conversational tone.
`.trim();

// ---------------------------------------------------------------------------
// Gemini client (key is read from the server environment only)
// ---------------------------------------------------------------------------
let ai = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!ai) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}

function buildConfig(withThinking) {
  // gemini-3.8-flash rejects temperature/top_p/top_k, so they are intentionally omitted.
  const config = {
    systemInstruction: SYSTEM_INSTRUCTION,
    maxOutputTokens: 600,
  };
  if (withThinking) {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel?.LOW ?? "LOW" };
  }
  return config;
}

// Safety net: make sure the reply is clean for speech even if the model slips.
function cleanForSpeech(text) {
  let t = String(text || "");
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`([^`]*)`/g, "$1");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s*[-*•]\s+/gm, "");
  t = t.replace(/^\s*\d+[.)]\s+/gm, "");
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "");
  t = t.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  if (t.length > MAX_REPLY_CHARS) {
    const cut = t.slice(0, MAX_REPLY_CHARS);
    const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    t = lastStop > 200 ? cut.slice(0, lastStop + 1) : cut.trim();
  }
  return t;
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  const turns = [];
  for (const h of history.slice(-MAX_HISTORY_TURNS * 2)) {
    if (!h || typeof h.text !== "string") continue;
    const role = h.role === "model" ? "model" : "user";
    const text = h.text.trim().slice(0, 800);
    if (!text) continue;
    // Gemini requires the first turn to be from the user and roles to alternate.
    if (turns.length === 0 && role !== "user") continue;
    if (turns.length && turns[turns.length - 1].role === role) continue;
    turns.push({ role, parts: [{ text }] });
  }
  // The new user message is appended after history, so history must end on "model".
  while (turns.length && turns[turns.length - 1].role === "user") turns.pop();
  return turns;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generateReply(contents) {
  const client = getClient();
  let lastErr;
  // Attempt 1: low thinking for speed. If the SDK/model rejects the config, retry once without it.
  for (const withThinking of [true, false]) {
    try {
      const response = await client.models.generateContent({
        model: MODEL,
        contents,
        config: buildConfig(withThinking),
      });
      const text = cleanForSpeech(response.text);
      if (text) return text;
      throw Object.assign(new Error("Empty response"), { status: 502 });
    } catch (err) {
      lastErr = err;
      const status = err?.status ?? err?.code;
      if (status === 429 || status === 401 || status === 403 || status === 404) throw err; // never retry quota/auth/model errors
      if (status === 503 || status === 500) {
        await sleep(800);
        continue;
      }
      if (status === 400 && withThinking) continue; // retry without thinkingConfig
      if (!withThinking) throw err;
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Server-side debounce guard: drop repeat requests from the same client within DEBOUNCE_MS.
const lastSeen = new Map();
const inFlight = new Set();

function clientKey(req) {
  const fwd = req.headers["x-forwarded-for"];
  return (typeof fwd === "string" ? fwd.split(",")[0].trim() : "") || req.ip || "unknown";
}

function pruneLastSeen(now) {
  if (lastSeen.size < 500) return;
  for (const [k, t] of lastSeen) if (now - t > 60_000) lastSeen.delete(k);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL, keyConfigured: Boolean(process.env.GEMINI_API_KEY) });
});

app.post("/api/chat", async (req, res) => {
  const key = clientKey(req);
  const now = Date.now();

  // Debounce / duplicate guard
  const last = lastSeen.get(key) || 0;
  if (now - last < DEBOUNCE_MS || inFlight.has(key)) {
    return res.status(429).json({
      error: "That was a duplicate request, so I ignored it. Please wait a moment.",
      code: "DUPLICATE",
      retryAfterSec: 2,
    });
  }
  lastSeen.set(key, now);
  pruneLastSeen(now);

  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "Please ask a question first.", code: "EMPTY" });
  if (message.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({ error: `Please keep your question under ${MAX_MESSAGE_CHARS} characters.`, code: "TOO_LONG" });
  }
  if (!getClient()) {
    return res.status(500).json({ error: "The server is not configured yet. The GEMINI_API_KEY environment variable is missing.", code: "NO_KEY" });
  }

  inFlight.add(key);
  try {
    const contents = [...sanitizeHistory(req.body?.history), { role: "user", parts: [{ text: message }] }];
    const reply = await generateReply(contents);
    return res.json({ reply, model: MODEL });
  } catch (err) {
    const status = err?.status ?? err?.code;
    console.error("[gemini]", status, err?.message?.slice?.(0, 300));
    if (status === 429) {
      return res.status(429).json({
        error: "I am getting a lot of questions right now and hit the rate limit. Please wait about 30 seconds and try again.",
        code: "RATE_LIMIT",
        retryAfterSec: 30,
      });
    }
    if (status === 404) {
      return res.status(502).json({ error: `The AI model "${MODEL}" is not available for this API key. Check the GEMINI_MODEL setting.`, code: "MODEL_NOT_FOUND" });
    }
    if (status === 401 || status === 403) {
      return res.status(502).json({ error: "The server's API key was rejected. The site owner needs to check GEMINI_API_KEY.", code: "BAD_KEY" });
    }
    return res.status(502).json({ error: "Something went wrong while generating my answer. Please try again in a few seconds.", code: "UPSTREAM" });
  } finally {
    inFlight.delete(key);
  }
});

// Local development / traditional hosting: start a server. On Vercel the app is exported instead.
const isServerless = Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
if (!isServerless) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Interview bot running at http://localhost:${port}  (model: ${MODEL})`);
    if (!process.env.GEMINI_API_KEY) console.warn("WARNING: GEMINI_API_KEY is not set. Add it to .env");
  });
}

export default app;
