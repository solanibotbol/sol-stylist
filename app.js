/* ================================================================
   Sol Stylist — app.js
   Supabase backend for all data except the Anthropic API key.
   ================================================================

   RUN THIS SQL IN SUPABASE SQL EDITOR BEFORE USING THE APP:
   ──────────────────────────────────────────────────────────────

   -- 1. WARDROBE (images stored in Supabase Storage)
   CREATE TABLE IF NOT EXISTS wardrobe (
     id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     name       text        NOT NULL,
     verdict    text,
     why        text,
     howto      text,
     img_url    text,
     date       text,
     created_at timestamptz DEFAULT now()
   );
   ALTER TABLE wardrobe ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "anon full access" ON wardrobe FOR ALL TO anon USING (true) WITH CHECK (true);

   -- 2. STYLE LOG
   CREATE TABLE IF NOT EXISTS style_log (
     id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     text       text        NOT NULL,
     date       text,
     auto       boolean     DEFAULT false,
     created_at timestamptz DEFAULT now()
   );
   ALTER TABLE style_log ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "anon full access" ON style_log FOR ALL TO anon USING (true) WITH CHECK (true);

   -- 3. WISHLIST
   CREATE TABLE IF NOT EXISTS wishlist (
     id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     name       text        NOT NULL,
     note       text,
     date       text,
     created_at timestamptz DEFAULT now()
   );
   ALTER TABLE wishlist ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "anon full access" ON wishlist FOR ALL TO anon USING (true) WITH CHECK (true);

   -- 4. MEMORY (single row, id = 'singleton'; also stores measurements)
   CREATE TABLE IF NOT EXISTS memory (
     id           text        PRIMARY KEY,
     preferences  jsonb       DEFAULT '[]'::jsonb,
     measurements jsonb,
     last_updated timestamptz
   );
   ALTER TABLE memory ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "anon full access" ON memory FOR ALL TO anon USING (true) WITH CHECK (true);

   -- 5. SESSIONS
   CREATE TABLE IF NOT EXISTS sessions (
     id         text        PRIMARY KEY,
     title      text,
     mode       text,
     mode_label text,
     preview    text,
     date       text,
     history    jsonb,
     created_at timestamptz DEFAULT now()
   );
   ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "anon full access" ON sessions FOR ALL TO anon USING (true) WITH CHECK (true);

   -- 6. STORAGE BUCKET for wardrobe images
   --    Option A (Dashboard): Storage → New Bucket → Name: wardrobe-images → Public ON
   --    Option B (SQL):
   INSERT INTO storage.buckets (id, name, public)
   VALUES ('wardrobe-images', 'wardrobe-images', true)
   ON CONFLICT (id) DO NOTHING;

   CREATE POLICY "anon upload"  ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'wardrobe-images');
   CREATE POLICY "anon read"    ON storage.objects FOR SELECT TO anon USING  (bucket_id = 'wardrobe-images');
   CREATE POLICY "anon delete"  ON storage.objects FOR DELETE TO anon USING  (bucket_id = 'wardrobe-images');

   ================================================================ */

// ── SUPABASE CLIENT ───────────────────────────────────────────────
const SUPABASE_URL = 'https://nklabmewhivkjvucywih.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rbGFibWV3aGl2a2p2dWN5d2loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4OTA3NTgsImV4cCI6MjA5MjQ2Njc1OH0.v1PsvLHZpDyDtvyhiEb90s-o-f6f4YF1R-jWhMArqQ8';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── IN-MEMORY CACHES (sync read, async write) ─────────────────────
let wardrobeCache  = [];
let logCache       = [];
let wishlistCache  = [];
let memoryCache    = {};   // { preferences: [], measurements: {}, lastUpdated }
let sessionsCache  = [];

// ── LOAD ALL DATA FROM SUPABASE ───────────────────────────────────
async function loadAllData() {
  try {
    const [wardRes, logRes, wishRes, memRes, sessRes] = await Promise.all([
      sb.from('wardrobe').select('*').order('created_at', { ascending: false }),
      sb.from('style_log').select('*').order('created_at', { ascending: true }),
      sb.from('wishlist').select('*').order('created_at', { ascending: true }),
      sb.from('memory').select('*').eq('id', 'singleton').maybeSingle(),
      sb.from('sessions').select('*').order('created_at', { ascending: false })
    ]);
    wardrobeCache = wardRes.data  || [];
    logCache      = logRes.data   || [];
    wishlistCache = wishRes.data  || [];
    sessionsCache = sessRes.data  || [];
    memoryCache   = memRes.data ? {
      preferences:  memRes.data.preferences  || [],
      measurements: memRes.data.measurements || null,
      lastUpdated:  memRes.data.last_updated
    } : {};
  } catch (err) {
    console.error('Supabase load failed — running with empty caches:', err);
  }
}

// ── CACHE GETTERS (synchronous) ───────────────────────────────────
function getWardrobe()  { return wardrobeCache; }
function getLog()       { return logCache; }
function getWishlist()  { return wishlistCache; }
function getMemory()    { return memoryCache; }
function getSessions()  { return sessionsCache; }
function getMeasurements() { return memoryCache.measurements || null; }

// ── MEMORY SAVE ───────────────────────────────────────────────────
async function saveMemory(mem) {
  memoryCache = mem;
  const { error } = await sb.from('memory').upsert({
    id:           'singleton',
    preferences:  mem.preferences  || [],
    measurements: mem.measurements || null,
    last_updated: new Date().toISOString()
  });
  if (error) console.error('saveMemory:', error);
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────────
const SYS = `You are Sol's personal AI stylist. You know everything about her. Never ask for info you already have. Be direct, warm, specific like a knowledgeable friend.

BODY: 5'3" petite (regular pants always too long - buy petite/ankle). Shoulder 39.6in (broader than hips). Bust 31.7in. Waist 26.3in (well-defined - her best asset). Hips 34.0in. Torso 15.5in (short). Inseam 26.5in. Ankle 8.7in (slender). Shoe US 7-7.5 WIDE WIDTH (feet swell on long walks - no pointed toe for long days). Goal: celebrate waist, balance shoulder-to-hip, elongate short torso.

COLOUR: Neutral Spring. High contrast - dark brows, warm brown eyes, light neutral skin. Bright white looks excellent (confirmed from photos). Best: bright white, warm ivory, camel, navy, bright coral red, coral, terracotta, soft blush, bright teal, cobalt, emerald, warm olive. KEY: clear/bright over muted/dusty. Avoid: lavender, fuchsia, cool gray, icy pastels. Gold jewelry primary.

WORKS: V-necks, scoop necks, wrap silhouettes. High-waisted everything. A-line, fit-and-flare, wide-leg trousers. Petite/ankle-length only. Tonal outfits (elongates torso). Fitted waist-nipped blazers. Bold prints on bottom only. Midi hemlines most elegant, mini for going out.

AVOID: Boat necks, wide off-shoulder, cap sleeves, shoulder ruffles. Low-rise. Wide waistbands, empire/drop waist. Boxy blazers. Bold prints on top. Regular-length pants unaltered.

SHOES: Wide toe box. Block heels not stilettos. Round/almond toe. Best brands: Naturalizer, Sam Edelman, Cole Haan, Vionic. Size up half in new brands.

BRANDS $50-$150: Office: Banana Republic, J.Crew, Mango, Other Stories, Reiss sale. Casual: Reformation sale, Everlane, Anthropologie, Sezane. Going out: Revolve, ASOS Premium, Abercrombie. Denim: Madewell petite high-rise #1, Abercrombie Petite, AG Jeans. Always check petite first.

HAIR/FACE: Angular jaw, strong brows - holds statement earrings. Gold hoops signature. Soft waves = best going-out look. Sleek low bun = best office look. Neutral blonde - warm balayage or champagne highlights both work.

LIFESTYLE: Corporate office + weekends + going out. Fort Lauderdale South Florida - warm climate year-round.

FORMAT: Concise and scannable on mobile. Bold key pieces. Outfit formulas not paragraphs. Brand + why it works for her body on shopping questions.`;

// ── MODE DEFINITIONS ──────────────────────────────────────────────
const MODES = {
  outfit:{label:"Outfit",sys:SYS+`\nMODE: Outfit planning. Check her wardrobe first. Build outfit from owned pieces. Flag gaps: "GAP: You need [item] - buy [brand+product] ~$[price]." Give 3-4 piece formula mixing owned + gap fills.`,
    prompts:[{l:"Work",t:"Outfit for the office today - business casual"},{l:"Going out",t:"Going out tonight - dinner and drinks"},{l:"Bloated",t:"I feel bloated today - still want to look polished"},{l:"Weekend",t:"Casual warm weekend day in Fort Lauderdale"}],
    chips:["Work","Going out","Casual","Date night","Travel","Event"]},
  shop:{label:"Shop Live",sys:SYS+"\nMODE: Live shopping search. Use web search. Find REAL products now. Filter for petite + $50-$150 + her body rules. Return 2-3 products: **Name** - Brand - ~$price / Why it works / Petite: yes/no / Link or search tip.",
    prompts:[{l:"Jeans",t:"Find petite high-rise straight jeans under $120 available now"},{l:"Work top",t:"Find a work top for my body under $80 available now"},{l:"Going out dress",t:"Find a wrap or v-neck going-out dress under $150 now"},{l:"White piece",t:"Find something white or coral for my colouring under $100 now"}],
    chips:["Under $75","$75-$150","Petite","White","Camel","Navy","Going out","Office"]},
  trends:{label:"Trends",sys:SYS+`\nMODE: Trend filtering. Use web search for current 2025-2026 fashion trends. Filter EVERY trend through Sol's body rules and colour profile. For each trend: works/skip/adapt + exactly why for her body. Be specific. Suggest how to incorporate trends into her existing wardrobe where possible. Balance timeless + current.`,
    prompts:[{l:"Right now",t:"What fashion trends right now work for my body?"},{l:"This season",t:"What should I be wearing this season for my body type?"},{l:"Vacation",t:"What trending vacation outfit styles can I actually wear?"},{l:"Office",t:"What work outfit trends work for my body right now?"}],
    chips:["Spring 2025","Going out","Office","Casual","Denim","Shoes","Colour trends"]},
  packing:{label:"Packing",sys:SYS+`\nMODE: Trip packing with gap detection. Step 1: build best outfits from her wardrobe. Step 2: flag every gap - "GAP: You need [item] for [occasion] - buy [brand+product] ~$[price]." Step 3: final packing list separating owned vs buy. Factor foot comfort for walking days. Keep mix-and-match.`,
    prompts:[{l:"Beach",t:"Long weekend at the beach - help me pack"},{l:"New York",t:"3 days in NYC - meetings and exploring"},{l:"Europe",t:"10 days Europe - warm weather, city and beach"},{l:"Work trip",t:"Work trip with 2 client dinners and free time"}],
    chips:["Beach","City","Cold","Hot","Business","Long weekend"]},
  wardrobe:{label:"Wardrobe",sys:SYS+`\nMODE: Wardrobe analysis. Look at her wardrobe data carefully. Identify patterns - too much of something, what is missing, what to upgrade. Be proactive about replacements. Balance timeless + trend pieces. South Florida climate.`,
    prompts:[{l:"Gaps",t:"What is my wardrobe missing most based on what I own?"},{l:"Upgrade",t:"What should I upgrade or replace in my wardrobe?"},{l:"Next buy",t:"What one piece adds most value to my wardrobe right now?"},{l:"Analysis",t:"Analyse my wardrobe and tell me what patterns you see"}],
    chips:["Investment","Budget","Office","Versatile","Timeless","Upgrade"]},
  advice:{label:"Advice",sys:SYS+"\nMODE: Style advice. Help find pieces for her body. Explain why each works for her proportions. Reference her wardrobe when relevant.",
    prompts:[{l:"Mix",t:"How do I get more outfits from what I already own?"},{l:"Jeans",t:"Help me find the perfect jeans for my body"},{l:"Dress",t:"What should I look for in a going-out dress?"},{l:"Office",t:"How do I upgrade my office wardrobe?"}],
    chips:["Under $75","$75-$150","Office","Going out","Petite only","Sale"]},
  hair:{label:"Hair",sys:SYS+"\nMODE: Hair accessories makeup. Angular jaw, strong brows, neutral-spring colouring, gold hoops signature.",
    prompts:[{l:"Haircut",t:"What haircuts work best for my face shape?"},{l:"Accessories",t:"What accessories should I invest in?"},{l:"Makeup",t:"What makeup colours work best with my colouring?"},{l:"Office hair",t:"Easy polished office hair ideas"}],
    chips:["Haircut","Colour","Earrings","Necklaces","Makeup","Nails"]}
};

// ── APP STATE ─────────────────────────────────────────────────────
let apiKey = '', mode = 'outfit', hist = [], sid = null;

// ── INIT ──────────────────────────────────────────────────────────
async function init() {
  apiKey = localStorage.getItem('sol-key') || '';
  await loadAllData();
  if (apiKey) showApp();
  renderWelcome();
  renderChips();
}

// ── API KEY ───────────────────────────────────────────────────────
function saveKey() {
  const k = document.getElementById('apiKeyInput').value.trim();
  if (k.length < 20) { document.getElementById('apiKeyInput').style.borderColor = '#C05A4A'; return; }
  apiKey = k;
  localStorage.setItem('sol-key', k);
  showApp();
}

function showApp() {
  document.getElementById('apiScreen').style.display = 'none';
  document.getElementById('app').classList.add('visible');
}

function resetKey() {
  if (!confirm('Re-enter your API key?')) return;
  localStorage.removeItem('sol-key');
  apiKey = '';
  document.getElementById('app').classList.remove('visible');
  document.getElementById('apiScreen').style.display = 'flex';
  document.getElementById('apiKeyInput').value = '';
}

// ── TABS / MODE ───────────────────────────────────────────────────
function setMode(m, btn) {
  mode = m;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  if (!hist.length) renderWelcome();
  renderChips();
}

// ── WELCOME & CHIPS ───────────────────────────────────────────────
function renderWelcome() {
  const c = document.getElementById('msgs');
  if (hist.length > 0) return;
  const M = MODES[mode];
  c.innerHTML = `<div class="welcome">
    <div class="wi">&#10022;</div>
    <h2>Hi Sol, what are<br>we <em>styling</em> today?</h2>
    <p>I know your measurements, colours, and what works for your body.</p>
    <div class="qps">${M.prompts.map(p => `<button class="qp" onclick="sendQ('${esc(p.t)}')"><span class="ql">${p.l}</span>${p.t}</button>`).join('')}</div>
  </div>`;
}

function renderChips() {
  const c = document.getElementById('chips');
  c.innerHTML = MODES[mode].chips.map(ch => `<button class="chip" onclick="toggleChip(this,'${ch}')">${ch}</button>`).join('');
}

function toggleChip(btn, label) {
  btn.classList.toggle('active');
  const inp = document.getElementById('cinput');
  if (btn.classList.contains('active')) inp.value = inp.value ? inp.value + ', ' + label : label;
  inp.focus();
}

// ── INPUT HELPERS ─────────────────────────────────────────────────
function handleKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }

// ── SEND MESSAGES ─────────────────────────────────────────────────
async function sendQ(text) { clearWelcome(); bubble(text, 'user'); hist.push({ role: 'user', content: text }); await reply(); }

async function send() {
  const inp = document.getElementById('cinput');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = ''; inp.style.height = 'auto';
  clearWelcome(); bubble(text, 'user'); hist.push({ role: 'user', content: text }); await reply();
}

function clearWelcome() {
  const w = document.querySelector('.welcome');
  if (w) w.remove();
  if (!sid) sid = Date.now();
}

// ── CHAT BUBBLE ───────────────────────────────────────────────────
function bubble(text, role) {
  const c = document.getElementById('msgs');
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  const foot = role === 'assistant'
    ? `<div class="mfoot"><span class="mtime">${now}</span><button class="save-btn" onclick="saveFromChat(this)">+ Wishlist</button></div>`
    : `<div class="mfoot"><span class="mtime">${now}</span></div>`;
  d.innerHTML = `<div class="bubble">${fmt(text)}</div>${foot}`;
  c.appendChild(d);
  c.scrollTop = c.scrollHeight;
  return d;
}

function fmt(t) {
  return String(t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function esc(t) { return t.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// ── REPLY (calls Claude API) ──────────────────────────────────────
async function reply() {
  const sbtn = document.getElementById('sbtn');
  sbtn.disabled = true;
  const c = document.getElementById('msgs');
  const th = document.createElement('div');
  th.className = 'thinking';
  th.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  c.appendChild(th); c.scrollTop = c.scrollHeight;

  const logCtx = buildMemoryContext();
  const sys = MODES[mode].sys + logCtx;
  const isShop = mode === 'shop' || mode === 'trends';

  try {
    const body = { model: 'claude-sonnet-4-5', max_tokens: 1200, system: sys, messages: hist };
    if (isShop) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (data.error) {
      th.remove();
      const msg = data.error.type === 'authentication_error' ? 'API key invalid - tap Key to update.' :
        data.error.type === 'insufficient_quota' ? 'No credits - add at console.anthropic.com Billing.' :
        'Error: ' + data.error.message;
      bubble(msg, 'assistant'); sbtn.disabled = false; return;
    }

    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n') || 'Something went wrong.';
    hist.push({ role: 'assistant', content: text });
    th.remove();
    bubble(text, 'assistant');
    await saveSession();
    if (hist.length >= 4)  updateMemoryFromSession();
    if (hist.length >= 6 && hist.length % 4 === 0) autoLearn();

  } catch (e) {
    th.remove();
    bubble('Connection issue - check your internet and try again.', 'assistant');
  }
  sbtn.disabled = false;
}

// ── SAVE FROM CHAT → WISHLIST ─────────────────────────────────────
async function saveFromChat(btn) {
  const text = btn.closest('.msg').querySelector('.bubble').innerText.trim().substring(0, 120);
  const item = {
    id:   crypto.randomUUID(),
    name: text,
    note: 'From chat - ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  };
  wishlistCache.push(item);
  const { error } = await sb.from('wishlist').insert(item);
  if (error) console.error('saveFromChat:', error);
  btn.textContent = 'Saved'; btn.classList.add('saved');
  toast('Added to wishlist!');
}

// ── AUTO-LEARN (extracts learnings from conversation) ─────────────
async function autoLearn() {
  const convo = hist.slice(-8).map(m => m.role + ': ' + m.content).join('\n');
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 250, messages: [{ role: 'user', content: `From this styling conversation extract 1-2 SHORT facts about Sol's preferences, what fit well, or what she liked/disliked. Only concrete facts. Return ONLY a JSON array of short strings, nothing else.\n\n${convo}` }] })
    });
    const data = await res.json();
    const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const learnings = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (Array.isArray(learnings) && learnings.length) {
      const existing = getLog();
      for (const l of learnings) {
        if (!existing.find(e => e.text === l)) {
          const entry = {
            id:   crypto.randomUUID(),
            text: l,
            date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            auto: true
          };
          logCache.push(entry);
          await sb.from('style_log').insert(entry);
        }
      }
    }
  } catch (e) {}
}

// ── SESSIONS ──────────────────────────────────────────────────────
async function saveSession() {
  if (!sid || hist.length < 2) return;
  const firstUser = hist.find(m => m.role === 'user')?.content || 'Conversation';
  const title = firstUser.length > 60 ? firstUser.substring(0, 60) + '...' : firstUser;
  const session = {
    id:         String(sid),
    title,
    mode,
    mode_label: MODES[mode].label,
    preview:    hist[hist.length - 1]?.content?.substring(0, 100) || '',
    date:       new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    history:    [...hist]
  };
  const idx = sessionsCache.findIndex(s => String(s.id) === String(sid));
  if (idx >= 0) sessionsCache[idx] = session; else sessionsCache.unshift(session);
  const { error } = await sb.from('sessions').upsert(session);
  if (error) console.error('saveSession:', error);
}

async function newChat() {
  if (hist.length > 0) await saveSession();
  hist = []; sid = null; mode = 'outfit';
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  document.getElementById('msgs').innerHTML = '';
  renderWelcome(); renderChips();
}

function openHistory() {
  const sessions = getSessions();
  const body = document.getElementById('histBody');
  if (!sessions.length) {
    body.innerHTML = '<div class="empty"><div class="eicon">&#128172;</div>No conversations yet.<br>Start chatting and they appear here.</div>';
  } else {
    body.innerHTML = sessions.map((s, i) => `
      <div class="hi" onclick="loadSession(${i})">
        <div class="hi-top">
          <div class="hi-title">${escH(s.title)}</div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <span class="hi-date">${s.date}</span>
            <button class="hdel" onclick="delSession(event,'${escH(String(s.id))}')">x</button>
          </div>
        </div>
        <div class="hi-preview">${escH((s.preview || '').substring(0, 100))}${(s.preview || '').length > 100 ? '...' : ''}</div>
        <span class="hi-mode">${s.mode_label || s.mode}</span>
      </div>`).join('');
  }
  document.getElementById('histPanel').classList.add('open');
}

function loadSession(i) {
  const s = sessionsCache[i];
  if (!s) return;
  hist = [...s.history]; sid = s.id; mode = s.mode || 'outfit';
  const tabOrder = ['outfit', 'shop', 'advice', 'packing', 'wardrobe', 'hair'];
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', tabOrder[i] === mode));
  const c = document.getElementById('msgs'); c.innerHTML = '';
  hist.forEach(m => bubble(m.content, m.role));
  closeHistory(); toast('Conversation loaded');
}

async function delSession(e, id) {
  e.stopPropagation();
  sessionsCache = sessionsCache.filter(s => String(s.id) !== String(id));
  const { error } = await sb.from('sessions').delete().eq('id', String(id));
  if (error) console.error('delSession:', error);
  openHistory();
}

function closeHistory() { document.getElementById('histPanel').classList.remove('open'); }

// ── STYLE LOG ─────────────────────────────────────────────────────
function openLog() { renderLog(); document.getElementById('logPanel').classList.add('open'); }
function closeLog() { document.getElementById('logPanel').classList.remove('open'); }

function renderLog() {
  const log = getLog();
  const body = document.getElementById('logBody');
  if (!log.length) {
    body.innerHTML = '<div class="empty"><div class="eicon">&#128211;</div>No entries yet.<br>Log what works - your stylist learns from it.</div>'; return;
  }
  body.innerHTML = log.slice().reverse().map((e, ri) => {
    const i = log.length - 1 - ri;
    return `<div class="li ${e.auto ? 'auto' : ''}">
      <div><div class="li-text">${escH(e.text)}</div><div class="li-meta">${e.date}${e.auto ? ' · Auto-learned' : ''}</div></div>
      <button class="ldel" onclick="delLog(${i})">x</button>
    </div>`;
  }).join('');
}

async function addLog() {
  const inp = document.getElementById('logInput');
  const text = inp.value.trim();
  if (!text) return;
  const entry = {
    id:   crypto.randomUUID(),
    text,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    auto: false
  };
  logCache.push(entry);
  const { error } = await sb.from('style_log').insert(entry);
  if (error) console.error('addLog:', error);
  inp.value = ''; renderLog(); toast('Added to log!');
}

async function delLog(i) {
  const entry = logCache[i];
  if (!entry) return;
  logCache.splice(i, 1);
  const { error } = await sb.from('style_log').delete().eq('id', entry.id);
  if (error) console.error('delLog:', error);
  renderLog();
}

// ── WISHLIST ──────────────────────────────────────────────────────
function openWishlist() { renderWishlist(); document.getElementById('wishPanel').classList.add('open'); }
function closeWishlist() { document.getElementById('wishPanel').classList.remove('open'); }

function renderWishlist() {
  const list = getWishlist();
  const body = document.getElementById('wishBody');
  if (!list.length) {
    body.innerHTML = '<div class="empty"><div class="eicon">&#128717;</div>Nothing saved yet.<br>Add items here or tap "+ Wishlist" on any stylist message.</div>'; return;
  }
  body.innerHTML = list.map((item, i) => `
    <div class="wi-item">
      <div class="wi-name">${escH(item.name)}</div>
      ${item.note ? `<div class="wi-note">${escH(item.note)}</div>` : ''}
      <div id="wr-${i}"></div>
      <div class="wi-acts">
        <button class="wi-find" id="wb-${i}" onclick="searchWish(${i})">Find Now</button>
        <button class="wi-del" onclick="delWish(${i})">Remove</button>
      </div>
    </div>`).join('');
}

async function addWish() {
  const name = document.getElementById('wname').value.trim();
  const note = document.getElementById('wnote').value.trim();
  if (!name) return;
  const item = {
    id:   crypto.randomUUID(),
    name,
    note,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  };
  wishlistCache.push(item);
  const { error } = await sb.from('wishlist').insert(item);
  if (error) console.error('addWish:', error);
  document.getElementById('wname').value = '';
  document.getElementById('wnote').value = '';
  renderWishlist(); toast('Saved to wishlist!');
}

async function delWish(i) {
  const item = wishlistCache[i];
  if (!item) return;
  wishlistCache.splice(i, 1);
  const { error } = await sb.from('wishlist').delete().eq('id', item.id);
  if (error) console.error('delWish:', error);
  renderWishlist();
}

async function searchWish(i) {
  const item = wishlistCache[i];
  if (!item) return;
  const btn = document.getElementById('wb-' + i);
  const res = document.getElementById('wr-' + i);
  btn.disabled = true; btn.textContent = 'Searching...';
  res.innerHTML = '<div class="wi-res">Searching live inventory...</div>';

  const prompt = `Search for this item for Sol:\nItem: ${item.name}\nNotes: ${item.note || 'none'}\n\nSol: petite 5'3", shoe 7-7.5 wide, budget $50-$150, neutral spring (white, camel, navy, coral great). Inverted triangle - needs petite, high waist, v-neck/wrap.\n\nSearch: Madewell, Banana Republic, J.Crew, Reformation, Anthropologie, Abercrombie, Everlane, Mango, ASOS, Other Stories.\n\nReturn: product name, brand, price, petite available y/n, link. Max 4 lines.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 500, tools: [{ type: 'web_search_20250305', name: 'web_search' }], messages: [{ role: 'user', content: prompt }] })
    });
    const data = await r.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n') || 'No results found.';
    res.innerHTML = `<div class="wi-res">${fmt(text)}</div>`;
  } catch (e) {
    res.innerHTML = '<div class="wi-res">Search failed - check your connection.</div>';
  }
  btn.disabled = false; btn.textContent = 'Search Again';
}

// ── CROSS-SESSION MEMORY ──────────────────────────────────────────
function buildMemoryContext() {
  const m = getMemory();
  const log = getLog();
  const wardrobe = getWardrobe();
  let ctx = '';
  if (m.preferences && m.preferences.length) {
    ctx += '\n\nLEARNED PREFERENCES (from past sessions):\n' + m.preferences.slice(-15).map(p => '- ' + p).join('\n');
  }
  const works   = wardrobe.filter(w => w.verdict === 'works');
  const styling = wardrobe.filter(w => w.verdict === 'styling');
  const avoid   = wardrobe.filter(w => w.verdict === 'avoid');
  if (wardrobe.length) {
    ctx += '\n\nHER WARDROBE (' + wardrobe.length + ' items):';
    if (works.length)   ctx += '\nWorks well: '          + works.map(w => w.name).join(', ');
    if (styling.length) ctx += '\nWorks with styling: '  + styling.map(w => w.name).join(', ');
    if (avoid.length)   ctx += '\nAvoid: '               + avoid.map(w => w.name).join(', ');
  }
  const log12 = log.slice(-12);
  if (log12.length) ctx += '\n\nSTYLE LOG:\n' + log12.map(e => '- ' + e.text).join('\n');
  return ctx;
}

async function updateMemoryFromSession() {
  if (hist.length < 4) return;
  const convo = hist.slice(-10).map(m => m.role + ': ' + m.content.substring(0, 200)).join('\n');
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 250, messages: [{ role: 'user', content: `Extract 1-3 SHORT preference facts revealed about Sol in this conversation. Concrete only. Return ONLY a JSON array of short strings, nothing else.\n\n${convo}` }] })
    });
    const data = await res.json();
    const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const prefs = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (Array.isArray(prefs) && prefs.length) {
      const mem = getMemory();
      mem.preferences = mem.preferences || [];
      prefs.forEach(p => { if (!mem.preferences.includes(p)) mem.preferences.push(p); });
      mem.preferences = mem.preferences.slice(-40);
      await saveMemory(mem);
    }
  } catch (e) {}
}

// ── WARDROBE ──────────────────────────────────────────────────────
let wardFilter = 'all';

function openWardrobe()  { renderWardGrid(); document.getElementById('wardPanel').classList.add('open'); }
function closeWardrobe() { document.getElementById('wardPanel').classList.remove('open'); }

function filterWard(f, btn) {
  wardFilter = f;
  document.querySelectorAll('.wf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderWardGrid();
}

function renderWardGrid() {
  const all   = getWardrobe();
  const items = wardFilter === 'all' ? all : all.filter(w => w.verdict === wardFilter);
  const grid  = document.getElementById('wardGrid');
  if (!items.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="eicon">&#128247;</div>' + (all.length ? 'No items in this category.' : 'Upload your first item above.<br>AI will analyse it for your body.') + '</div>'; return;
  }
  grid.innerHTML = items.map(item => {
    const realIdx = all.indexOf(item);
    return `<div class="ward-card ${item.verdict}">
      ${item.img_url ? `<img class="ward-img" src="${item.img_url}" alt="${escH(item.name)}">` : `<div class="ward-img-placeholder">&#128248;</div>`}
      <button class="ward-del" onclick="delWardItem(${realIdx})">x</button>
      <div class="ward-info">
        <div class="ward-name">${escH(item.name)}</div>
        <span class="ward-verdict ${item.verdict}">${item.verdict === 'works' ? 'Works' : item.verdict === 'styling' ? 'With styling' : 'Avoid'}</span>
        <div class="ward-why">${escH(item.why)}${item.howto ? ' ' + escH(item.howto) : ''}</div>
      </div>
    </div>`;
  }).join('');
}

async function delWardItem(i) {
  const item = wardrobeCache[i];
  if (!item) return;
  wardrobeCache.splice(i, 1);
  const { error } = await sb.from('wardrobe').delete().eq('id', item.id);
  if (error) console.error('delWardItem:', error);
  // Fire-and-forget storage cleanup
  if (item.img_url && item.img_url.includes('wardrobe-images')) {
    sb.storage.from('wardrobe-images').remove([item.id + '.jpg']).catch(() => {});
  }
  renderWardGrid(); toast('Item removed');
}

async function analyzeItem(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  const grid = document.getElementById('wardGrid');
  const card = document.createElement('div');
  card.className = 'analyzing-card';
  card.style.gridColumn = '1/-1';
  card.innerHTML = '&#10022; Analysing item against your body profile...';
  grid.insertBefore(card, grid.firstChild);

  // Base64 for Claude vision API
  const base64 = await new Promise(res => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result.split(',')[1]);
    reader.readAsDataURL(file);
  });
  const mediaType = file.type || 'image/jpeg';

  const prompt = `Analyse this clothing item for Sol. Body: 5'3" petite, shoulder 39.6in (broader than hips), bust 31.7in, waist 26.3in (well-defined), hips 34.0in, short torso. Colour: Neutral Spring - best whites, camel, navy, coral, terracotta, cobalt, emerald. Works: V-necks, wraps, high-waisted, A-line, wide-leg, petite length. Avoid: boat necks, low-rise, shoulder ruffles, boxy blazers, regular-length pants.\n\nReturn ONLY a JSON object:\n{"name":"short item name","verdict":"works" or "styling" or "avoid","why":"one sentence referencing her body rules","howto":"one sentence how to wear it best (empty string if avoid)"}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 300, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: prompt }
      ]}]})
    });
    const data = await res.json();
    const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const result = JSON.parse(raw.replace(/```json|```/g, '').trim());

    // Upload resized image to Supabase Storage
    const itemId = crypto.randomUUID();
    let imgUrl = null;
    try {
      const blob = await resizeImageToBlob(file, 400);
      imgUrl = await uploadWardrobeImage(blob, itemId);
    } catch (uploadErr) {
      console.warn('Image upload failed — item saved without photo:', uploadErr);
    }

    const wardItem = {
      id:      itemId,
      name:    result.name    || 'Item',
      verdict: result.verdict || 'styling',
      why:     result.why     || '',
      howto:   result.howto   || '',
      img_url: imgUrl,
      date:    new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    };
    wardrobeCache.unshift(wardItem);
    const { error } = await sb.from('wardrobe').insert(wardItem);
    if (error) console.error('analyzeItem insert:', error);

    card.remove();
    renderWardGrid();
    toast(result.verdict === 'works' ? 'Looks great on you!' : result.verdict === 'styling' ? 'Works with the right styling!' : 'Better to avoid this one');
  } catch (err) {
    card.innerHTML = 'Could not analyse &mdash; try again.';
    setTimeout(() => card.remove(), 3000);
  }
}

// Resize image to Blob for Supabase Storage upload
async function resizeImageToBlob(file, maxSize) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; } }
      else        { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; } }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(resolve, 'image/jpeg', 0.75);
    };
    img.src = url;
  });
}

// Upload blob to 'wardrobe-images' bucket, return public URL
async function uploadWardrobeImage(blob, itemId) {
  const path = itemId + '.jpg';
  const { error } = await sb.storage.from('wardrobe-images').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = sb.storage.from('wardrobe-images').getPublicUrl(path);
  return publicUrl;
}

// ── PROFILE ───────────────────────────────────────────────────────
const DEFAULT_MEASUREMENTS = { height:"5'3\"", shoulder:'39.6', bust:'31.7', waist:'26.3', hips:'34.0', torso:'15.5', inseam:'26.5', ankle:'8.7', shoe:'7-7.5 WIDE' };

async function saveMeasurementsFromForm() {
  const fields = ['height','shoulder','bust','waist','hips','torso','inseam','ankle','shoe'];
  const m = {};
  fields.forEach(f => { const el = document.getElementById('pm-' + f); if (el) m[f] = el.value.trim(); });
  const mem = getMemory();
  mem.measurements = m;
  await saveMemory(mem);
  toast('Measurements saved!');
}

function openProfile()  { renderProfile(); document.getElementById('profilePanel').classList.add('open'); }
function closeProfile() { document.getElementById('profilePanel').classList.remove('open'); }

function renderProfile() {
  const body      = document.getElementById('profileBody');
  const m         = getMeasurements() || DEFAULT_MEASUREMENTS;
  const memory    = getMemory();
  const prefs     = memory.preferences || [];
  const log       = getLog();
  const wardrobe  = getWardrobe();
  const wWorks    = wardrobe.filter(w => w.verdict === 'works').length;
  const wStyling  = wardrobe.filter(w => w.verdict === 'styling').length;
  const wAvoid    = wardrobe.filter(w => w.verdict === 'avoid').length;

  const measFields = [
    {key:'height',label:'Height'},{key:'shoulder',label:'Shoulder (in)'},
    {key:'bust',label:'Bust (in)'},{key:'waist',label:'Waist (in)'},
    {key:'hips',label:'Hips (in)'},{key:'torso',label:'Torso (in)'},
    {key:'inseam',label:'Inseam (in)'},{key:'ankle',label:'Ankle (in)'},
    {key:'shoe',label:'Shoe (US)'}
  ];

  const goodColours = ['Bright white','Ivory','Camel','Navy','Coral red','Terracotta','Soft blush','Bright teal','Cobalt','Emerald','Warm olive'];
  const badColours  = ['Lavender','Fuchsia','Cool gray','Icy pastels'];
  const worksRules  = ['V-necks, scoop necks, wrap silhouettes','High-waisted everything','A-line, fit-and-flare, wide-leg trousers','Petite/ankle-length only','Tonal outfits (elongates torso)','Fitted waist-nipped blazers','Bold prints on bottom only','Midi most elegant, mini for going out'];
  const avoidRules  = ['Boat necks, wide off-shoulder, cap sleeves, shoulder ruffles','Low-rise','Wide waistbands, empire/drop waist','Boxy blazers','Bold prints on top','Regular-length pants unaltered'];

  body.innerHTML = `
    <div class="prof-section">
      <div class="prof-title">Body Measurements</div>
      <div class="prof-meas-grid">
        ${measFields.map(f => `<div class="prof-meas-item">
          <label class="prof-meas-label">${f.label}</label>
          <input class="prof-meas-input" id="pm-${f.key}" value="${escH(m[f.key] || '')}" placeholder="&mdash;"/>
        </div>`).join('')}
      </div>
      <button class="btnp" style="margin-top:12px;" onclick="saveMeasurementsFromForm()">Save Measurements</button>
    </div>

    <div class="prof-section">
      <div class="prof-title">Colour Season</div>
      <div class="prof-card">
        <div class="prof-season">Neutral Spring &mdash; High Contrast</div>
        <div class="prof-colours">${goodColours.map(c => `<span class="prof-colour-pill good">${c}</span>`).join('')}</div>
        <div class="prof-avoid-label">Avoid</div>
        <div class="prof-colours">${badColours.map(c => `<span class="prof-colour-pill bad">${c}</span>`).join('')}</div>
        <div class="prof-note">Gold jewellery primary &middot; Clear/bright over muted/dusty</div>
      </div>
    </div>

    <div class="prof-section">
      <div class="prof-title">Silhouette Rules</div>
      <div class="prof-card">
        <div class="prof-rule-label good">Works</div>
        <ul class="prof-list">${worksRules.map(r => `<li>${r}</li>`).join('')}</ul>
        <div class="prof-rule-label bad" style="margin-top:12px;">Avoid</div>
        <ul class="prof-list avoid">${avoidRules.map(r => `<li>${r}</li>`).join('')}</ul>
      </div>
    </div>

    <div class="prof-section">
      <div class="prof-title">Learned Preferences</div>
      ${!prefs.length ? `<div class="empty" style="padding:24px 0;"><div class="eicon">&#128161;</div>No preferences learned yet.<br>Chat more and they appear here.</div>` :
        prefs.slice().reverse().map((p, ri) => {
          const i = prefs.length - 1 - ri;
          return `<div class="li"><div class="li-text">${escH(p)}</div><button class="ldel" onclick="delPrefFromProfile(${i})">x</button></div>`;
        }).join('')}
    </div>

    <div class="prof-section">
      <div class="prof-title">Style Log</div>
      ${!log.length ? `<div class="empty" style="padding:24px 0;"><div class="eicon">&#128211;</div>No entries yet.</div>` :
        log.slice().reverse().map((e, ri) => {
          const i = log.length - 1 - ri;
          return `<div class="li ${e.auto ? 'auto' : ''}">
            <div><div class="li-text">${escH(e.text)}</div><div class="li-meta">${e.date}${e.auto ? ' &middot; Auto-learned' : ''}</div></div>
            <button class="ldel" onclick="delLogFromProfile(${i})">x</button>
          </div>`;
        }).join('')}
    </div>

    <div class="prof-section">
      <div class="prof-title">Wardrobe Summary</div>
      <div class="prof-ward-summary">
        <div class="prof-ward-stat works"><div class="prof-ward-num">${wWorks}</div><div class="prof-ward-lbl">Works</div></div>
        <div class="prof-ward-stat styling"><div class="prof-ward-num">${wStyling}</div><div class="prof-ward-lbl">Styling</div></div>
        <div class="prof-ward-stat avoid"><div class="prof-ward-num">${wAvoid}</div><div class="prof-ward-lbl">Avoid</div></div>
        <div class="prof-ward-stat"><div class="prof-ward-num">${wardrobe.length}</div><div class="prof-ward-lbl">Total</div></div>
      </div>
    </div>
  `;
}

async function delPrefFromProfile(i) {
  const mem = getMemory();
  mem.preferences = mem.preferences || [];
  mem.preferences.splice(i, 1);
  await saveMemory(mem);
  renderProfile();
}

async function delLogFromProfile(i) {
  const entry = logCache[i];
  if (!entry) return;
  logCache.splice(i, 1);
  const { error } = await sb.from('style_log').delete().eq('id', entry.id);
  if (error) console.error('delLogFromProfile:', error);
  renderProfile();
}

// ── UTILITIES ─────────────────────────────────────────────────────
function escH(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ── START ─────────────────────────────────────────────────────────
init();
