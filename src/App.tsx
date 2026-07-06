import { useState, useEffect, useRef } from "react";
import * as d3 from "d3";
import seedConcepts from "./concepts.json";

const MODEL = "claude-sonnet-5";

const SYSTEM = `You are a concise technical, product, and AI educator. When given a development, product management, or AI/ML term or concept, respond ONLY with a JSON object (no markdown fences) in this exact shape:
{
  "term": "<normalized term name>",
  "category": "<one of: Frontend, Backend, DevOps, Database, Networking, Security, Architecture, Language/Runtime, Tooling, API/Protocol, General CS, Product Strategy, User Research, Metrics & Analytics, Growth, Agile & Process, Machine Learning, Deep Learning, LLMs & Gen AI, MLOps>",
  "what": "<1-2 sentence plain-English definition>",
  "why": "<1-2 sentences on why it matters or when you'd use it>",
  "example": "<a concrete, realistic mini-example — code snippet, analogy, or scenario>",
  "depth": "<one of: foundational, intermediate, advanced, expert>",
  "alternativeDomains": ["<names of other high-level domains — Dev, AI, or Product — where this exact term carries a MEANINGFULLY DIFFERENT definition. Leave empty [] if the term has one clear primary meaning>"],
  "related": {
    "platforms": ["<up to 5 specific tools, frameworks, or platforms directly associated with this term>"],
    "domains": ["<up to 4 conceptual domains or problem areas this belongs to>"],
    "concepts": ["<up to 5 closely related technical concepts worth knowing alongside this one>"]
  }
}
Be precise but accessible. Avoid jargon in the 'what' field. The example should be practical. Depth guide — foundational: core concept any practitioner should know; intermediate: used regularly in day-to-day work; advanced: requires solid experience to fully apply; expert: deep specialization or niche knowledge.`;

const SUGGEST_SYSTEM = `You are a technical learning advisor. Given a concept someone just learned, suggest exactly 4 concepts to understand next for full technical fluency. Return ONLY a JSON object (no markdown fences):
{
  "suggestions": [
    { "term": "<exact technical term>", "reason": "<one sentence: specifically why knowing this deepens fluency around the given concept>", "type": "<foundation|companion|extension>" }
  ]
}
Types — foundation: a prerequisite or underlying mechanism; companion: something routinely used alongside it; extension: an advanced topic that builds on it. Order by learning priority.`;

const DIAGRAM_SYSTEM = `You create clean SVG diagrams that visually explain technical, AI, and product concepts. Generate a diagram for every concept — flows, architectures, hierarchies, state machines, comparisons, lifecycles, or simple labeled illustrations.

CRITICAL OUTPUT RULES:
- Respond with ONLY raw SVG markup starting with <svg and ending with </svg>
- NO markdown fences, NO explanation text, NO commentary whatsoever
- Your entire response must be a single SVG element

Layout: choose viewBox based on complexity — 600x300 for simple, 820x320 for 4-5 steps, 960x340 for complex, 640x400 for tall trees. Distribute elements across the full canvas. Keep all content 24px inside edges.

SVG rules:
- Opening tag: <svg viewBox="0 0 W H" width="100%" xmlns="http://www.w3.org/2000/svg">
- No background rect — transparent
- Palette: #3b82f6 blue, #10b981 green, #f59e0b amber, #8b5cf6 purple, #ef4444 red, #06b6d4 cyan, #64748b slate
- Text: #1e293b on light fills, #ffffff on dark; font-family="system-ui,sans-serif"; font-size 11-13
- Arrows: reusable <marker> in <defs>
- Shapes: rounded rects rx="8", circles
- Short title top-left, font-size 11, fill #94a3b8`;

const CATEGORY_COLORS = {
  "Frontend":"#3b82f6","Backend":"#8b5cf6","DevOps":"#f59e0b","Database":"#10b981",
  "Networking":"#06b6d4","Security":"#ef4444","Architecture":"#ec4899",
  "Language/Runtime":"#6366f1","Tooling":"#f97316","API/Protocol":"#14b8a6","General CS":"#64748b",
  "Product Strategy":"#0369a1","User Research":"#be185d","Metrics & Analytics":"#15803d",
  "Growth":"#b45309","Agile & Process":"#7c3aed",
  "Machine Learning":"#0d9488","Deep Learning":"#9333ea","LLMs & Gen AI":"#c2410c","MLOps":"#1d4ed8",
};
const REL_COLORS = { platform:"#8b5cf6", domain:"#f59e0b", concept:"#06b6d4" };
const TYPE_META = {
  foundation:{ label:"Foundation", color:"#f59e0b", icon:"ti-layers-subtract" },
  companion: { label:"Companion",  color:"#3b82f6", icon:"ti-plug-connected"  },
  extension: { label:"Extension",  color:"#8b5cf6", icon:"ti-trending-up"     },
};
const RELATED_GROUPS = [
  { key:"platforms", label:"Platforms & tools", icon:"ti-layout-grid",      color:"#8b5cf6" },
  { key:"domains",   label:"Domains",           icon:"ti-circles-relation", color:"#f59e0b" },
  { key:"concepts",  label:"Related concepts",  icon:"ti-git-branch",       color:"#06b6d4" },
];
const DEPTH_META = {
  foundational:{ label:"Foundational", color:"#10b981", order:1 },
  intermediate: { label:"Intermediate",  color:"#3b82f6", order:2 },
  advanced:     { label:"Advanced",      color:"#8b5cf6", order:3 },
  expert:       { label:"Expert",        color:"#ef4444", order:4 },
};
const DEPTH_ORDER = ["foundational","intermediate","advanced","expert"];
const DOMAIN_MAP = {
  "Frontend":"Dev","Backend":"Dev","DevOps":"Dev","Database":"Dev",
  "Networking":"Dev","Security":"Dev","Architecture":"Dev",
  "Language/Runtime":"Dev","Tooling":"Dev","API/Protocol":"Dev","General CS":"Dev",
  "Machine Learning":"AI","Deep Learning":"AI","LLMs & Gen AI":"AI","MLOps":"AI",
  "Product Strategy":"Product","User Research":"Product","Metrics & Analytics":"Product",
  "Growth":"Product","Agile & Process":"Product",
};
const DOMAIN_META = {
  Dev:     { color:"#3b82f6", icon:"ti-code"     },
  AI:      { color:"#9333ea", icon:"ti-sparkles" },
  Product: { color:"#f59e0b", icon:"ti-target"   },
};
const EXAMPLE_TERMS = [
  "WebSocket","OKRs","Transformer","A/B Testing",
  "Product Market Fit","RAG","North Star Metric","Gradient Descent",
  "Embeddings","Idempotency","Prompt Engineering","CORS",
];

// ── Storage (browser localStorage) ───────────────────────────────

const CONCEPTS_KEY     = "concept_dictionary:all_concepts";
const SEED_VERSION_KEY = "concept_dictionary:seed_v1";
const API_KEY_KEY      = "concept_dictionary:anthropic_api_key";

function loadAllConcepts() {
  const seeded = !!safeGet(SEED_VERSION_KEY);
  let existing = null;
  try {
    const raw = safeGet(CONCEPTS_KEY);
    if (raw) existing = JSON.parse(raw);
  } catch(e) {}

  // First run with no prior data: seed from bundled JSON
  if (!seeded && (!existing || existing.length === 0)) {
    try {
      safeSet(CONCEPTS_KEY, JSON.stringify(seedConcepts));
      safeSet(SEED_VERSION_KEY, "1");
    } catch(e) {}
    return seedConcepts;
  }

  // Legacy user (data present, flag missing): mark seeded so we never overwrite.
  if (!seeded) {
    try { safeSet(SEED_VERSION_KEY, "1"); } catch(e) {}
  }

  return existing || [];
}

function saveAllConcepts(concepts) {
  safeSet(CONCEPTS_KEY, JSON.stringify(concepts));
}

function safeGet(key) {
  try { return localStorage.getItem(key); } catch(e) { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch(e) {}
}
function safeRemove(key) {
  try { localStorage.removeItem(key); } catch(e) {}
}

function getApiKey() {
  return safeGet(API_KEY_KEY) || "";
}
function setStoredApiKey(key) {
  if (key) safeSet(API_KEY_KEY, key);
  else safeRemove(API_KEY_KEY);
}

// ── API helpers ─────────────────────────────────────────────────

async function callClaude(system, messages, maxTokens) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings to enable live lookups.");
  const controller = new AbortController();
  const timeout = setTimeout(function(){ controller.abort(); }, 60000);
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST", headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
      body:JSON.stringify({ model:MODEL, max_tokens:maxTokens||1500, system, messages }),
      signal: controller.signal
    });
  } catch(e) {
    clearTimeout(timeout);
    throw new Error(e.name === "AbortError" ? "Request timed out" : "Network error: "+(e.message||e));
  }
  clearTimeout(timeout);
  let data;
  try { data = await res.json(); } catch(e) { throw new Error("Couldn't parse response (status "+res.status+")"); }
  if (!res.ok) throw new Error(data?.error?.message || "HTTP "+res.status);
  const block = data.content?.find(b => b.type==="text");
  if (!block?.text) throw new Error("Empty response from API");
  return block.text;
}

async function fetchConcept(term) {
  const text = await callClaude(SYSTEM, [{role:"user",content:term}], 1500);
  return JSON.parse(text.replace(/```json|```/g,"").trim());
}

async function fetchSuggestionsAPI(term) {
  try {
    const text = await callClaude(SUGGEST_SYSTEM, [{role:"user",content:"I just learned about: "+term}], 600);
    const parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
    return parsed.suggestions || [];
  } catch(e) { return []; }
}

function extractSvg(raw) {
  if (!raw) return null;
  let text = raw.trim().replace(/^```(?:svg|xml|html)?\s*/i,"").replace(/```\s*$/,"").trim();
  if (text.toLowerCase()==="null") return null;
  const start = text.indexOf("<svg");
  if (start===-1) return null;
  const end = text.lastIndexOf("</svg>");
  if (end===-1) return null;
  return text.slice(start, end+6);
}

async function fetchDiagram(term, concept) {
  const text = await callClaude(
    DIAGRAM_SYSTEM,
    [{role:"user", content:"Term: "+term+"\nCategory: "+(concept?.category||"")+"\nDefinition: "+(concept?.what||"")}],
    8000
  );
  const svg = extractSvg(text);
  // extractSvg returns null when the response has no complete <svg>…</svg>
  // (usually a truncated or malformed reply). Surface it as an error so the
  // UI shows a Retry button instead of silently rendering a blank space.
  if (!svg) throw new Error("The model didn't return a complete diagram. Tap Retry.");
  return svg;
}

async function fetchAnswer(term, conceptData, question, history) {
  const ctx = "What it is: "+conceptData.what+"\nWhy it matters: "+conceptData.why+"\nExample: "+conceptData.example;
  const messages = [];
  history.forEach(qa => {
    messages.push({role:"user", content:qa.question});
    messages.push({role:"assistant", content:qa.answer});
  });
  messages.push({role:"user", content:question});
  return await callClaude(
    "You are a knowledgeable educator helping someone deeply understand \""+term+"\". Context:\n\n"+ctx+"\n\nAnswer clearly and concisely — 2-4 sentences unless more depth is genuinely needed.",
    messages, 500
  );
}

// ── UI Components ───────────────────────────────────────────────

function Badge({ category }) {
  const c = CATEGORY_COLORS[category] || "#64748b";
  return <span style={{ fontSize:11, fontWeight:500, padding:"3px 8px", borderRadius:20,
    background:c+"20", color:c, border:"1px solid "+c+"40", whiteSpace:"nowrap" }}>{category}</span>;
}

function DepthBadge({ depth }) {
  const m = DEPTH_META[depth] || DEPTH_META.intermediate;
  return <span style={{ fontSize:11, fontWeight:500, padding:"3px 8px", borderRadius:20,
    background:m.color+"20", color:m.color, border:"1px solid "+m.color+"40", whiteSpace:"nowrap" }}>{m.label}</span>;
}

function RelatedPill({ label, color, onLookup, onSave, isSaved }) {
  const [hover, setHover] = useState(false);
  return (
    <span style={{ display:"inline-flex", alignItems:"center", border:"1px solid "+color+"40",
      borderRadius:20, overflow:"hidden", fontSize:12, fontWeight:500,
      background:hover?color+"18":color+"0c", transition:"background 0.12s" }}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}>
      <button onClick={onLookup} style={{ padding:"3px 9px 3px 10px", border:"none",
        background:"transparent", color, cursor:"pointer", fontSize:12, fontWeight:500 }}>{label}</button>
      <button onClick={isSaved?undefined:onSave} style={{ padding:"3px 8px 3px 2px", border:"none",
        background:"transparent", color:isSaved?"#10b981":color, cursor:isSaved?"default":"pointer",
        fontSize:12, display:"flex", alignItems:"center", opacity:isSaved?1:0.65 }}>
        <i className={isSaved?"ti ti-check":"ti ti-bookmark-plus"} aria-hidden="true"/>
      </button>
    </span>
  );
}

function Section({ icon, label, color, children, mono }) {
  return (
    <div style={{ borderRadius:8, background:"var(--color-background-primary)",
      border:"1px solid var(--color-border-tertiary)", overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 12px 6px",
        borderBottom:"1px solid var(--color-border-tertiary)", background:color+"0a" }}>
        <i className={"ti "+icon} style={{ color, fontSize:13 }} aria-hidden="true"/>
        <span style={{ fontSize:11, fontWeight:700, color, textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</span>
      </div>
      <div style={{ padding:"10px 12px", lineHeight:1.65, color:"var(--color-text-primary)",
        fontFamily:mono?"var(--font-mono)":"inherit", whiteSpace:mono?"pre-wrap":"normal",
        fontSize:mono?13:14 }}>{children}</div>
    </div>
  );
}

function QASection({ term, conceptData }) {
  const [qas, setQas] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const qaKey = "qa:"+term.toLowerCase().replace(/\s+/g,"_");

  useEffect(function() {
    try {
      const v = localStorage.getItem(qaKey);
      if (v) { try { setQas(JSON.parse(v)); } catch(e) {} }
    } catch(e) {}
  }, [term]);

  async function ask() {
    const q = input.trim();
    if (!q || loading) return;
    setInput(""); setLoading(true); setError("");
    try {
      const answer = await fetchAnswer(term, conceptData, q, qas);
      const updated = [...qas, {question:q, answer, ts:Date.now()}];
      setQas(updated);
      try { localStorage.setItem(qaKey, JSON.stringify(updated)); } catch(e) {}
    } catch(e) {
      setError(e.message || "Couldn't get an answer. Please try again.");
      setInput(q);
    }
    setLoading(false);
  }

  function removeQA(idx) {
    const updated = qas.filter((_,i) => i!==idx);
    setQas(updated);
    try { localStorage.setItem(qaKey, JSON.stringify(updated)); } catch(e) {}
  }

  return (
    <div style={{ borderTop:"1px solid var(--color-border-tertiary)", padding:"14px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:qas.length>0?12:10 }}>
        <i className="ti ti-message-circle-question" style={{ fontSize:15, color:"#6366f1" }} aria-hidden="true"/>
        <span style={{ fontSize:11, fontWeight:700, color:"#6366f1", textTransform:"uppercase", letterSpacing:"0.06em" }}>Q&amp;A</span>
        {qas.length>0 && <span style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>{qas.length} question{qas.length!==1?"s":""}</span>}
      </div>
      {qas.length>0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:12 }}>
          {qas.map((qa,idx) => (
            <div key={idx} style={{ borderRadius:8, border:"1px solid var(--color-border-tertiary)",
              overflow:"hidden", background:"var(--color-background-primary)" }}>
              <div style={{ padding:"9px 12px 8px", background:"#6366f108",
                borderBottom:"1px solid var(--color-border-tertiary)", display:"flex", gap:8, alignItems:"flex-start" }}>
                <span style={{ fontSize:10, fontWeight:700, color:"#6366f1", textTransform:"uppercase",
                  letterSpacing:"0.05em", paddingTop:2, flexShrink:0 }}>Q</span>
                <span style={{ fontSize:13, color:"var(--color-text-primary)", flex:1, lineHeight:1.5 }}>{qa.question}</span>
                <button onClick={()=>removeQA(idx)} style={{ background:"none", border:"none",
                  color:"var(--color-text-tertiary)", cursor:"pointer", fontSize:14, padding:0,
                  flexShrink:0, opacity:0.5, display:"flex", alignItems:"center" }}>
                  <i className="ti ti-x" aria-hidden="true"/>
                </button>
              </div>
              <div style={{ padding:"9px 12px", display:"flex", gap:8, alignItems:"flex-start" }}>
                <span style={{ fontSize:10, fontWeight:700, color:"#10b981", textTransform:"uppercase",
                  letterSpacing:"0.05em", paddingTop:2, flexShrink:0 }}>A</span>
                <span style={{ fontSize:13, color:"var(--color-text-secondary)", lineHeight:1.65, flex:1 }}>{qa.answer}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && (
        <div style={{ padding:"8px 12px", borderRadius:8, background:"#ef444412",
          border:"1px solid #ef444430", color:"#ef4444", fontSize:12, marginBottom:8,
          display:"flex", alignItems:"center", gap:6 }}>
          <i className="ti ti-alert-circle" aria-hidden="true"/> {error}
        </div>
      )}
      <div style={{ display:"flex", gap:8 }}>
        <input value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey) ask();}}
          placeholder={"Ask a question about "+term+"…"}
          style={{ flex:1, padding:"8px 12px", fontSize:13, borderRadius:8,
            border:"1px solid var(--color-border-secondary)", outline:"none",
            background:"var(--color-background-primary)", color:"var(--color-text-primary)" }}/>
        <button onClick={ask} disabled={loading||!input.trim()} style={{
          padding:"8px 14px", borderRadius:8, border:"none", fontSize:13, fontWeight:600,
          background:loading||!input.trim()?"var(--color-background-tertiary)":"#6366f1",
          color:loading||!input.trim()?"var(--color-text-tertiary)":"#fff",
          cursor:loading||!input.trim()?"default":"pointer",
          display:"flex", alignItems:"center", gap:5, whiteSpace:"nowrap" }}>
          {loading ? <><i className="ti ti-loader-2" style={{animation:"spin 1s linear infinite",fontSize:13}} aria-hidden="true"/>Thinking…</>
                   : <><i className="ti ti-send" style={{fontSize:13}} aria-hidden="true"/>Ask</>}
        </button>
      </div>
    </div>
  );
}

function DiagramDisplay({ html }) {
  const wrapRef = useRef(null);
  useEffect(function() {
    if (!wrapRef.current) return;
    const svg = wrapRef.current.querySelector("svg");
    if (!svg) return;
    requestAnimationFrame(function() {
      try {
        const els = svg.querySelectorAll("rect,circle,ellipse,line,path,polygon,polyline,text,use,image");
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        els.forEach(el => {
          try {
            const bb = el.getBBox();
            if (bb.width>0||bb.height>0) {
              if (bb.x<minX) minX=bb.x; if (bb.y<minY) minY=bb.y;
              if (bb.x+bb.width>maxX) maxX=bb.x+bb.width;
              if (bb.y+bb.height>maxY) maxY=bb.y+bb.height;
            }
          } catch(e) {}
        });
        if (isFinite(minX)&&isFinite(minY)&&maxX>minX&&maxY>minY) {
          const pad=24;
          svg.setAttribute("viewBox",(minX-pad)+" "+(minY-pad)+" "+(maxX-minX+pad*2)+" "+(maxY-minY+pad*2));
        }
      } catch(e) {}
    });
  }, [html]);
  return (
    <div ref={wrapRef} className="diag"
      style={{ borderRadius:8, overflow:"hidden", border:"1px solid var(--color-border-tertiary)",
        background:"var(--color-background-primary)", lineHeight:0 }}
      dangerouslySetInnerHTML={{ __html:html }}/>
  );
}

function ConceptCard({ data, onSave, onLookupRelated, onSaveRelated, savedTerms, isSaved, onRemove, compact }) {
  const [open, setOpen] = useState(!compact);
  const [hov, setHov] = useState(false);
  const [diagram, setDiagram] = useState(null);
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [diagramError, setDiagramError] = useState(null);
  const rel = data.related || {};
  const hasRelated = RELATED_GROUPS.some(g => { const a=rel[g.key]; return a&&a.length>0; });
  const accent = CATEGORY_COLORS[data.category] || "#64748b";

  useEffect(function() {
    if (compact || !open) return;
    let cancelled = false;
    setDiagram(null); setDiagramLoading(true); setDiagramError(null);
    fetchDiagram(data.term, data)
      .then(svg => { if (!cancelled) { setDiagram(svg); setDiagramLoading(false); } })
      .catch(err => { if (!cancelled) { setDiagramError(err.message||"Error"); setDiagramLoading(false); } });
    return () => { cancelled = true; };
  }, [data.term, compact, open]);

  async function retryDiagram() {
    setDiagramError(null); setDiagram(null); setDiagramLoading(true);
    try { setDiagram(await fetchDiagram(data.term, data)); }
    catch(e) { setDiagramError(e.message||"Error"); }
    setDiagramLoading(false);
  }

  return (
    <div onMouseEnter={compact?()=>setHov(true):undefined} onMouseLeave={compact?()=>setHov(false):undefined}
      style={{ border:"1px solid var(--color-border-tertiary)", borderLeft:"3px solid "+accent,
        borderRadius:10, overflow:"hidden", background:"var(--color-background-secondary)",
        boxShadow:hov?"0 4px 14px rgba(0,0,0,0.08)":"0 1px 3px rgba(0,0,0,0.04)",
        transform:hov&&compact?"translateY(-1px)":"none", transition:"box-shadow 0.15s, transform 0.15s" }}>

      <div onClick={compact?()=>setOpen(o=>!o):undefined}
        style={{ padding:"12px 14px", display:"flex", alignItems:"center", gap:10,
          cursor:compact?"pointer":"default", userSelect:"none" }}>
        <span style={{ fontWeight:600, fontSize:15, flex:1, color:"var(--color-text-primary)", lineHeight:1.3 }}>{data.term}</span>
        <div style={{ display:"flex", gap:5, alignItems:"center", flexShrink:0, flexWrap:"wrap", justifyContent:"flex-end" }}>
          {data.depth && <DepthBadge depth={data.depth}/>}
          <Badge category={data.category}/>
          {compact && <i className={"ti ti-chevron-"+(open?"up":"down")} style={{ fontSize:14, color:"var(--color-text-tertiary)", marginLeft:2 }} aria-hidden="true"/>}
        </div>
      </div>

      {open && (
        <div style={{ borderTop:"1px solid var(--color-border-tertiary)" }}>
          {!compact && (
            <div style={{ padding:"13px 14px 0" }}>
              {diagramLoading && (
                <div style={{ borderRadius:8, border:"1px solid var(--color-border-tertiary)",
                  background:"var(--color-background-tertiary)", height:200,
                  display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8 }}>
                  <i className="ti ti-loader-2" style={{ fontSize:22, color:"var(--color-text-tertiary)",
                    animation:"spin 1s linear infinite" }} aria-hidden="true"/>
                  <span style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>Generating diagram…</span>
                </div>
              )}
              {!diagramLoading && diagram && <DiagramDisplay html={diagram}/>}
              {!diagramLoading && !diagram && diagramError && (
                <div style={{ borderRadius:8, border:"1px solid #ef444430", background:"#ef444408",
                  padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
                  <i className="ti ti-alert-triangle" style={{ fontSize:15, color:"#ef4444" }} aria-hidden="true"/>
                  <span style={{ fontSize:12, color:"var(--color-text-secondary)", flex:1 }}>Diagram error: {diagramError}</span>
                  <button onClick={retryDiagram} style={{ fontSize:12, fontWeight:500, padding:"4px 10px",
                    borderRadius:6, border:"1px solid #ef444455", background:"#ef444415",
                    color:"#ef4444", cursor:"pointer", display:"inline-flex", alignItems:"center", gap:4 }}>
                    <i className="ti ti-refresh" style={{fontSize:11}} aria-hidden="true"/> Retry
                  </button>
                </div>
              )}
            </div>
          )}

          <div style={{ display:"flex" }}>
            <div style={{ flex:1, padding:"13px 14px", display:"flex", flexDirection:"column", gap:8 }}>
              <Section icon="ti-info-circle" label="What it is" color="#3b82f6">{data.what}</Section>
              <Section icon="ti-bulb" label="Why it matters" color="#f59e0b">{data.why}</Section>
              <Section icon="ti-code" label="Example" color="#10b981" mono>{data.example}</Section>
              <div style={{ display:"flex", gap:8, paddingTop:2, flexWrap:"wrap" }}>
                {!isSaved&&onSave&&(
                  <button onClick={onSave} style={{ display:"inline-flex", alignItems:"center", gap:6,
                    fontSize:13, fontWeight:600, padding:"7px 16px", borderRadius:8,
                    border:"1px solid "+accent+"55", background:accent+"15", color:accent, cursor:"pointer" }}>
                    <i className="ti ti-bookmark" aria-hidden="true"/> Save to My Concepts
                  </button>
                )}
                {isSaved&&onRemove&&(
                  <button onClick={onRemove} style={{ display:"inline-flex", alignItems:"center", gap:6,
                    fontSize:13, fontWeight:500, padding:"7px 14px", borderRadius:8,
                    border:"1px solid #ef444455", background:"#ef444412", color:"#ef4444", cursor:"pointer" }}>
                    <i className="ti ti-trash" aria-hidden="true"/> Remove
                  </button>
                )}
                {isSaved&&!onRemove&&(
                  <span style={{ fontSize:12, color:"#10b981", display:"flex", alignItems:"center", gap:5, fontWeight:500 }}>
                    <i className="ti ti-circle-check-filled" aria-hidden="true"/> Saved to My Concepts
                  </span>
                )}
              </div>
            </div>
            {hasRelated && (
              <div style={{ width:196, flexShrink:0, borderLeft:"1px solid var(--color-border-tertiary)",
                padding:"13px 12px", display:"flex", flexDirection:"column", gap:12 }}>
                <span style={{ fontSize:10, fontWeight:700, color:"var(--color-text-tertiary)",
                  textTransform:"uppercase", letterSpacing:"0.08em" }}>Related</span>
                {RELATED_GROUPS.map(g => {
                  const items = rel[g.key]||[];
                  if (!items.length) return null;
                  return (
                    <div key={g.key}>
                      <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:6 }}>
                        <i className={"ti "+g.icon} style={{ color:g.color, fontSize:12 }} aria-hidden="true"/>
                        <span style={{ fontSize:10, fontWeight:700, color:g.color, textTransform:"uppercase", letterSpacing:"0.05em" }}>{g.label}</span>
                      </div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                        {items.map(item => (
                          <RelatedPill key={item} label={item} color={g.color}
                            isSaved={!!(savedTerms&&savedTerms[item.toLowerCase()])}
                            onLookup={()=>onLookupRelated&&onLookupRelated(item)}
                            onSave={()=>onSaveRelated&&onSaveRelated(item)}/>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <QASection term={data.term} conceptData={data}/>
        </div>
      )}
    </div>
  );
}

function SuggestionsPanel({ suggestions, loading, savedMap, onLookup, onSave }) {
  if (!loading && (!suggestions||!suggestions.length)) return null;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ width:32, height:32, borderRadius:9, background:"#3b82f614",
          border:"1px solid #3b82f628", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <i className="ti ti-route" style={{ color:"#3b82f6", fontSize:16 }} aria-hidden="true"/>
        </div>
        <div>
          <div style={{ fontSize:14, fontWeight:600, color:"var(--color-text-primary)", lineHeight:1.2 }}>Learn next</div>
          <div style={{ fontSize:12, color:"var(--color-text-tertiary)" }}>For full fluency around this concept</div>
        </div>
        {loading && <i className="ti ti-loader-2" style={{ fontSize:15, color:"var(--color-text-tertiary)",
          animation:"spin 1s linear infinite", marginLeft:"auto" }} aria-hidden="true"/>}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        {loading && [0,1,2,3].map(i => (
          <div key={i} style={{ height:122, borderRadius:10, overflow:"hidden", position:"relative",
            background:"var(--color-background-tertiary)", border:"1px solid var(--color-border-tertiary)" }}>
            <div style={{ position:"absolute", inset:0,
              background:"linear-gradient(90deg,transparent,var(--color-background-secondary),transparent)",
              animation:"shimmer 1.6s ease-in-out infinite", animationDelay:(i*0.2)+"s" }}/>
          </div>
        ))}
        {!loading && suggestions && suggestions.map(s => {
          const meta = TYPE_META[s.type]||TYPE_META.companion;
          const isSaved = !!(savedMap&&savedMap[s.term.toLowerCase()]);
          return (
            <div key={s.term} style={{ borderRadius:10, background:"var(--color-background-secondary)",
              border:"1px solid var(--color-border-tertiary)", overflow:"hidden", display:"flex", flexDirection:"column" }}>
              <div style={{ height:3, background:meta.color, flexShrink:0 }}/>
              <div style={{ padding:"11px 12px", flex:1, display:"flex", flexDirection:"column", gap:5 }}>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <i className={"ti "+meta.icon} style={{ color:meta.color, fontSize:12 }} aria-hidden="true"/>
                  <span style={{ fontSize:10, fontWeight:700, color:meta.color, textTransform:"uppercase", letterSpacing:"0.06em" }}>{meta.label}</span>
                </div>
                <div style={{ fontWeight:600, fontSize:13, color:"var(--color-text-primary)", lineHeight:1.3 }}>{s.term}</div>
                <div style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.5, flex:1 }}>{s.reason}</div>
                <div style={{ display:"flex", gap:6, marginTop:4 }}>
                  <button onClick={()=>onLookup&&onLookup(s.term)} style={{ flex:1, padding:"5px 0", fontSize:12,
                    fontWeight:600, borderRadius:7, border:"1px solid "+meta.color+"55", background:meta.color+"12",
                    color:meta.color, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>
                    <i className="ti ti-search" aria-hidden="true"/> Look up
                  </button>
                  <button onClick={()=>!isSaved&&onSave&&onSave(s.term)}
                    style={{ padding:"5px 9px", fontSize:13, borderRadius:7,
                      border:"1px solid "+(isSaved?"#10b98155":"var(--color-border-tertiary)"),
                      background:isSaved?"#10b98112":"transparent",
                      color:isSaved?"#10b981":"var(--color-text-tertiary)", cursor:isSaved?"default":"pointer" }}>
                    <i className={isSaved?"ti ti-check":"ti ti-bookmark"} aria-hidden="true"/>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KnowledgeGraph({ saved, savedMap, onLookup, visible }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [selected, setSelected] = useState(null);
  const [stats, setStats] = useState({ saved:0, related:0, edges:0 });
  const onLookupRef = useRef(onLookup);
  useEffect(() => { onLookupRef.current = onLookup; });

  useEffect(function() {
    const svgEl = svgRef.current;
    const containerEl = containerRef.current;
    if (!svgEl||!containerEl||!visible) return;
    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    setTooltip(null); setSelected(null);
    if (!saved||saved.length===0) return;
    const W = containerEl.clientWidth||720, H = 480;
    const nodeMap={}, linkArr=[], linkSet={};
    saved.forEach(c => { nodeMap[c.term]={id:c.term,type:"saved",category:c.category,data:c}; });
    saved.forEach(c => {
      const rel = c.related||{};
      [["platforms","platform"],["domains","domain"],["concepts","concept"]].forEach(([key,relType]) => {
        (rel[key]||[]).forEach(item => {
          if (!nodeMap[item]) nodeMap[item]={id:item,type:"unsaved",relType};
          const lid=[c.term,item].sort().join("|||");
          if (!linkSet[lid]) { linkSet[lid]=true; linkArr.push({source:c.term,target:item,relType}); }
        });
      });
    });
    const nodeArr = Object.values(nodeMap);
    setStats({saved:saved.length,related:nodeArr.filter(n=>n.type==="unsaved").length,edges:linkArr.length});
    const zoomBehavior = d3.zoom().scaleExtent([0.15,4]).on("zoom",event=>g.attr("transform",event.transform));
    zoomRef.current={zoom:zoomBehavior,svg};
    const g = svg.append("g");
    svg.call(zoomBehavior);
    const adj={};
    const sim = d3.forceSimulation(nodeArr)
      .force("link",d3.forceLink(linkArr).id(d=>d.id).distance(100).strength(0.4))
      .force("charge",d3.forceManyBody().strength(d=>d.type==="saved"?-600:-200))
      .force("center",d3.forceCenter(W/2,H/2))
      .force("collision",d3.forceCollide().radius(d=>d.type==="saved"?50:28));
    const linkSel = g.append("g").selectAll("line").data(linkArr).join("line")
      .attr("stroke",d=>REL_COLORS[d.relType]||"#94a3b8")
      .attr("stroke-opacity",0.25).attr("stroke-width",1.5)
      .attr("stroke-dasharray",d=>{const t=typeof d.target==="object"?d.target.id:d.target;return nodeMap[t]?.type==="saved"?"none":"5 3";});
    const nodeSel = g.append("g").selectAll("g").data(nodeArr).join("g").attr("cursor","pointer");
    nodeSel.append("circle")
      .attr("r",d=>d.type==="saved"?28:15)
      .attr("fill",d=>d.type==="saved"?(CATEGORY_COLORS[d.category]||"#64748b"):((REL_COLORS[d.relType]||"#94a3b8")+"28"))
      .attr("stroke",d=>d.type==="saved"?"rgba(255,255,255,0.3)":(REL_COLORS[d.relType]||"#94a3b8"))
      .attr("stroke-width",d=>d.type==="saved"?2.5:1.5)
      .attr("stroke-dasharray",d=>d.type==="saved"?"none":"4 2");
    const savedSel = nodeSel.filter(d=>d.type==="saved");
    savedSel.append("text")
      .text(d=>{const w=d.id.split(" ");return w.length>1&&w[0].length<=9?w[0]:(d.id.length>9?d.id.slice(0,8)+"…":d.id);})
      .attr("text-anchor","middle").attr("dy",d=>{const w=d.id.split(" ");return w.length>1&&w[0].length<=9?"-0.15em":"0.35em";})
      .attr("font-size",9).attr("font-weight",600).attr("fill","#fff").attr("pointer-events","none");
    savedSel.filter(d=>{const w=d.id.split(" ");return w.length>1&&w[0].length<=9;}).append("text")
      .text(d=>{const r=d.id.split(" ").slice(1).join(" ");return r.length>9?r.slice(0,8)+"…":r;})
      .attr("text-anchor","middle").attr("dy","1.2em").attr("font-size",8).attr("font-weight",500)
      .attr("fill","rgba(255,255,255,0.85)").attr("pointer-events","none");
    const unsavedSel = nodeSel.filter(d=>d.type==="unsaved");
    const lbl = d=>d.id.length>13?d.id.slice(0,12)+"…":d.id;
    unsavedSel.append("text").text(lbl).attr("text-anchor","middle").attr("dy","2.7em").attr("font-size",9)
      .attr("stroke","var(--color-background-primary)").attr("stroke-width",3).attr("stroke-linejoin","round").attr("pointer-events","none");
    unsavedSel.append("text").text(lbl).attr("text-anchor","middle").attr("dy","2.7em").attr("font-size",9)
      .attr("fill",d=>REL_COLORS[d.relType]||"#94a3b8").attr("pointer-events","none");
    function buildAdj(){linkArr.forEach(l=>{const s=typeof l.source==="object"?l.source.id:l.source,t=typeof l.target==="object"?l.target.id:l.target;if(!adj[s])adj[s]={};if(!adj[t])adj[t]={};adj[s][t]=l.relType;adj[t][s]=l.relType;});}
    function highlight(id){if(!Object.keys(adj).length)buildAdj();const nb=adj[id]||{};nodeSel.attr("opacity",d=>d.id===id||nb[d.id]!==undefined?1:0.1);linkSel.attr("stroke-opacity",l=>{const s=typeof l.source==="object"?l.source.id:l.source,t=typeof l.target==="object"?l.target.id:l.target;return s===id||t===id?0.8:0.03;}).attr("stroke-width",l=>{const s=typeof l.source==="object"?l.source.id:l.source,t=typeof l.target==="object"?l.target.id:l.target;return s===id||t===id?2.5:1.5;});}
    function resetHL(){nodeSel.attr("opacity",1);linkSel.attr("stroke-opacity",0.25).attr("stroke-width",1.5);}
    nodeSel
      .on("mouseenter",function(event,d){highlight(d.id);const rect=svgEl.getBoundingClientRect();setTooltip({node:d,x:event.clientX-rect.left,y:event.clientY-rect.top});})
      .on("mousemove",function(event){const rect=svgEl.getBoundingClientRect();setTooltip(prev=>prev?{node:prev.node,x:event.clientX-rect.left,y:event.clientY-rect.top}:prev);})
      .on("mouseleave",function(){resetHL();setTooltip(null);})
      .on("click",function(event,d){event.stopPropagation();if(d.type==="saved")setSelected(d.data);else if(onLookupRef.current)onLookupRef.current(d.id);});
    svg.on("click",()=>setSelected(null));
    nodeSel.call(d3.drag()
      .on("start",(event,d)=>{if(!event.active)sim.alphaTarget(0.3).restart();d.fx=d.x;d.fy=d.y;})
      .on("drag", (event,d)=>{d.fx=event.x;d.fy=event.y;})
      .on("end",  (event,d)=>{if(!event.active)sim.alphaTarget(0);d.fx=null;d.fy=null;}));
    sim.on("tick",()=>{
      linkSel.attr("x1",d=>d.source.x).attr("y1",d=>d.source.y).attr("x2",d=>d.target.x).attr("y2",d=>d.target.y);
      nodeSel.attr("transform",d=>"translate("+d.x+","+d.y+")");
    });
    return ()=>sim.stop();
  }, [saved, visible]);

  function doZoom(k){if(zoomRef.current)zoomRef.current.svg.transition().duration(260).call(zoomRef.current.zoom.scaleBy,k);}
  function doReset(){if(zoomRef.current)zoomRef.current.svg.transition().duration(360).call(zoomRef.current.zoom.transform,d3.zoomIdentity);}

  if (!saved||saved.length===0) return (
    <div style={{ textAlign:"center", padding:"64px 20px" }}>
      <div style={{ width:64, height:64, borderRadius:16, background:"var(--color-background-tertiary)",
        border:"1px solid var(--color-border-secondary)", display:"flex", alignItems:"center",
        justifyContent:"center", margin:"0 auto 16px" }}>
        <i className="ti ti-sitemap" style={{ fontSize:28, color:"var(--color-text-tertiary)" }} aria-hidden="true"/>
      </div>
      <div style={{ fontSize:16, fontWeight:600, color:"var(--color-text-secondary)", marginBottom:6 }}>Your knowledge graph is waiting</div>
      <div style={{ fontSize:13, color:"var(--color-text-tertiary)", lineHeight:1.6, maxWidth:280, margin:"0 auto" }}>
        Save concepts to see how they connect across domains.
      </div>
    </div>
  );

  return (
    <div ref={containerRef} style={{ position:"relative" }}>
      <div style={{ display:"flex", gap:16, marginBottom:10 }}>
        {[{v:stats.saved,l:"saved"},{v:stats.related,l:"related"},{v:stats.edges,l:"connections"}].map(s => (
          <div key={s.l} style={{ display:"flex", alignItems:"baseline", gap:5 }}>
            <span style={{ fontSize:18, fontWeight:700, color:"var(--color-text-primary)" }}>{s.v}</span>
            <span style={{ fontSize:12, color:"var(--color-text-tertiary)" }}>{s.l}</span>
          </div>
        ))}
      </div>
      <div style={{ position:"relative" }}>
        <svg ref={svgRef} style={{ width:"100%", height:480, display:"block",
          background:"var(--color-background-tertiary)", borderRadius:12,
          border:"1px solid var(--color-border-tertiary)" }}/>
        <div style={{ position:"absolute", top:10, right:10, display:"flex", flexDirection:"column", gap:4 }}>
          {[{l:"+",k:1.4},{l:"−",k:0.7}].map(b => (
            <button key={b.l} onClick={()=>doZoom(b.k)} style={{ width:30, height:30, borderRadius:8,
              border:"1px solid var(--color-border-secondary)", background:"var(--color-background-primary)",
              color:"var(--color-text-primary)", fontSize:18, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 1px 4px rgba(0,0,0,0.1)" }}>{b.l}</button>
          ))}
          <button onClick={doReset} style={{ width:30, height:30, borderRadius:8,
            border:"1px solid var(--color-border-secondary)", background:"var(--color-background-primary)",
            color:"var(--color-text-tertiary)", fontSize:14, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 1px 4px rgba(0,0,0,0.1)" }}>
            <i className="ti ti-maximize" aria-hidden="true"/>
          </button>
        </div>
        {tooltip && (
          <div style={{ position:"absolute",
            left:Math.min(tooltip.x+14,(containerRef.current?containerRef.current.clientWidth-220:500)),
            top:Math.max(tooltip.y-44,8), background:"var(--color-background-primary)",
            border:"1px solid var(--color-border-secondary)", borderRadius:10, padding:"10px 13px",
            fontSize:12, maxWidth:210, pointerEvents:"none", zIndex:10, boxShadow:"0 4px 16px rgba(0,0,0,0.12)" }}>
            <div style={{ fontWeight:700, color:"var(--color-text-primary)", marginBottom:4 }}>{tooltip.node.id}</div>
            {tooltip.node.type==="saved"&&tooltip.node.data&&(
              <div style={{ color:"var(--color-text-secondary)", lineHeight:1.5, fontSize:11 }}>
                {tooltip.node.data.what.length>90?tooltip.node.data.what.slice(0,88)+"…":tooltip.node.data.what}
              </div>
            )}
            {tooltip.node.type==="unsaved"&&(
              <div style={{ color:REL_COLORS[tooltip.node.relType]||"#94a3b8", fontSize:11, fontWeight:500 }}>
                <i className="ti ti-search" aria-hidden="true"/> Click to look up
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:"5px 14px", marginTop:10,
        fontSize:11, color:"var(--color-text-tertiary)", alignItems:"center" }}>
        {[{label:"Saved",bg:"#3b82f6",dashed:false},{label:"Platform/tool",bg:"#8b5cf622",border:"#8b5cf6",dashed:true},
          {label:"Domain",bg:"#f59e0b22",border:"#f59e0b",dashed:true},{label:"Related concept",bg:"#06b6d422",border:"#06b6d4",dashed:true}]
          .map(item => (
            <span key={item.label} style={{display:"flex",alignItems:"center",gap:5}}>
              <span style={{width:item.dashed?9:10,height:item.dashed?9:10,borderRadius:"50%",background:item.bg,
                border:item.dashed?"1.5px dashed "+item.border:"none",display:"inline-block",flexShrink:0}}/>
              {item.label}
            </span>
          ))}
        <span style={{marginLeft:"auto"}}>drag · scroll to zoom · click to explore</span>
      </div>
      {selected && (
        <div style={{ marginTop:16, padding:"14px", borderRadius:10,
          background:"var(--color-background-secondary)", border:"1px solid var(--color-border-tertiary)" }}>
          <div style={{ display:"flex", alignItems:"center", marginBottom:12 }}>
            <span style={{ fontSize:11, fontWeight:700, color:"var(--color-text-tertiary)",
              textTransform:"uppercase", letterSpacing:"0.07em" }}>Selected concept</span>
            <button onClick={()=>setSelected(null)} style={{ marginLeft:"auto", background:"none",
              border:"none", color:"var(--color-text-tertiary)", cursor:"pointer", fontSize:20,
              display:"flex", alignItems:"center", padding:0 }}>
              <i className="ti ti-x" aria-hidden="true"/>
            </button>
          </div>
          <ConceptCard data={selected} isSaved={true} savedTerms={savedMap} onLookupRelated={onLookup} compact={false}/>
        </div>
      )}
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────

export default function App() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState([]);
  const [savedMap, setSavedMap] = useState({});
  const [tab, setTab] = useState("search");
  const [searchFilter, setSearchFilter] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [sortBy, setSortBy] = useState("alpha");
  const [suggestions, setSuggestions] = useState(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [prevResult, setPrevResult] = useState(null);
  const [prevSuggestions, setPrevSuggestions] = useState(null);
  const [storageReady, setStorageReady] = useState(false);
  const [importStatus, setImportStatus] = useState(null);
  const [showExport, setShowExport] = useState(false);
  const [exportCopied, setExportCopied] = useState(false);
  const [apiKey, setApiKeyState] = useState(getApiKey());
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");

  function openSettings() { setApiKeyDraft(apiKey); setShowSettings(true); }
  function saveApiKey() {
    const k = apiKeyDraft.trim();
    setStoredApiKey(k);
    setApiKeyState(k);
    setShowSettings(false);
  }
  function clearApiKey() {
    setStoredApiKey("");
    setApiKeyState("");
    setApiKeyDraft("");
  }

  useEffect(function(){
    try {
      const items = loadAllConcepts();
      const valid = items.sort((a,b)=>a.term.localeCompare(b.term));
      setSaved(valid);
      const map={};
      valid.forEach(c=>{ map[c.term.toLowerCase()]=true; });
      setSavedMap(map);
    } catch(e) {}
    setStorageReady(true);
  },[]);

  async function lookup(term, domain) {
    const q = (term||query).trim();
    if (!q) return;
    if (!getApiKey()) { setApiKeyDraft(""); setShowSettings(true); return; }
    if (result) { setPrevResult(result); setPrevSuggestions(suggestions); }
    setTab("search"); setQuery(q); setLoading(true); setError(""); setResult(null);
    setSuggestions(null); setSuggestionsLoading(false);
    try {
      const msg = domain
        ? q+" — define this specifically as used in "+(domain==="AI"?"AI and machine learning":domain==="Product"?"product management":"software development")
        : q;
      const parsed = await fetchConcept(msg);
      setResult(parsed);
      setSuggestionsLoading(true);
      fetchSuggestionsAPI(parsed.term)
        .then(sugg=>{ setSuggestions(sugg); setSuggestionsLoading(false); })
        .catch(()=>{ setSuggestions([]); setSuggestionsLoading(false); });
    } catch(e) { setError(e.message||"Couldn't fetch definition. Please try again."); }
    setLoading(false);
  }

  async function saveConcept(concept) {
    const next = [...saved.filter(c=>c.term!==concept.term), concept]
      .sort((a,b)=>a.term.localeCompare(b.term));
    setSaved(next);
    setSavedMap(prev => ({...prev, [concept.term.toLowerCase()]:true}));
    try { await saveAllConcepts(next); } catch(e) {}
  }

  async function removeConcept(concept) {
    const next = saved.filter(c=>c.term!==concept.term);
    setSaved(next);
    setSavedMap(prev => { const n={...prev}; delete n[concept.term.toLowerCase()]; return n; });
    try { await saveAllConcepts(next); } catch(e) {}
  }

  async function saveRelated(term) {
    if (savedMap[term.toLowerCase()]) return;
    try { await saveConcept(await fetchConcept(term)); } catch(e) {}
  }

  function goBack() {
    setResult(prevResult); setSuggestions(prevSuggestions); setSuggestionsLoading(false);
    setQuery(prevResult.term); setPrevResult(null); setPrevSuggestions(null);
  }

  function exportConcepts() { setShowExport(true); setExportCopied(false); }

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(saved, null, 2));
      setExportCopied(true);
      setTimeout(()=>setExportCopied(false), 2000);
    } catch(e) {}
  }

  async function importConcepts(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setImportStatus({ phase:"reading" });
    try {
      const text = await file.text();
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) {
        setImportStatus({ phase:"error", message:"File must contain a JSON array of concepts." });
        e.target.value=""; return;
      }
      const valid = arr.filter(c=>c&&c.term&&typeof c.term==="string");
      const skipped = arr.length - valid.length;
      let ok=0, failed=0;
      const errors=[], successful=[];
      setImportStatus({ phase:"importing", total:valid.length, done:0, ok:0, failed:0 });
      for (let i=0; i<valid.length; i++) {
        // Validate the concept has required fields
        const c = valid[i];
        if (c.term && typeof c.term === "string") {
          ok++; successful.push(c);
        } else {
          failed++;
          errors.push({term:String(c.term||"unknown"), error:"Missing or invalid term field"});
        }
        setImportStatus({ phase:"importing", total:valid.length, done:i+1, ok, failed });
      }
      // Merge into state and persist as single key
      setSaved(prev => {
        const merged={};
        prev.forEach(c=>{ merged[c.term.toLowerCase()]=c; });
        successful.forEach(c=>{ merged[c.term.toLowerCase()]=c; });
        const next = Object.values(merged).sort((a,b)=>a.term.localeCompare(b.term));
        saveAllConcepts(next).catch(()=>{});
        return next;
      });
      setSavedMap(prev => {
        const next={...prev};
        successful.forEach(c=>{ next[c.term.toLowerCase()]=true; });
        return next;
      });
      setImportStatus({ phase:"done", total:valid.length, ok, failed, skipped, errors });
    } catch(err) {
      setImportStatus({ phase:"error", message:"Couldn't parse file: "+(err.message||err) });
    }
    e.target.value="";
  }

  const isSaved = result && !!savedMap[result.term.toLowerCase()];
  const currentDomain = result ? (DOMAIN_MAP[result.category]||"Dev") : null;
  const allResultDomains = result?.alternativeDomains?.length>0
    ? ["Dev","AI","Product"].filter(d=>d===currentDomain||result.alternativeDomains.indexOf(d)!==-1)
    : null;
  const categories = ["All"].concat(Object.keys(CATEGORY_COLORS).filter(cat=>saved.some(c=>c.category===cat)));
  const filteredSaved = saved.filter(c =>
    (catFilter==="All"||c.category===catFilter) &&
    (!searchFilter||c.term.toLowerCase().includes(searchFilter.toLowerCase()))
  );
  const sortedConcepts = [...filteredSaved].sort((a,b) => {
    if (sortBy==="alpha"||sortBy==="domain") return a.term.localeCompare(b.term);
    const da=(DEPTH_META[a.depth]||DEPTH_META.intermediate).order;
    const db=(DEPTH_META[b.depth]||DEPTH_META.intermediate).order;
    const diff=sortBy==="depth-asc"?da-db:db-da;
    return diff!==0?diff:a.term.localeCompare(b.term);
  });
  const groupedByDepth = (sortBy==="depth-asc"||sortBy==="depth-desc")
    ? (sortBy==="depth-asc"?DEPTH_ORDER:[...DEPTH_ORDER].reverse())
        .map(d=>{
          const dc=sortedConcepts.filter(c=>(c.depth||"intermediate")===d);
          return { depth:d, concepts:dc,
            domainGroups:["Dev","AI","Product"].map(dom=>({domain:dom,concepts:dc.filter(c=>(DOMAIN_MAP[c.category]||"Dev")===dom)})).filter(dg=>dg.concepts.length>0) };
        }).filter(g=>g.concepts.length>0)
    : null;
  const groupedByDomain = sortBy==="domain"
    ? ["Dev","AI","Product"].map(dom=>({domain:dom,
        concepts:filteredSaved.filter(c=>(DOMAIN_MAP[c.category]||"Dev")===dom).sort((a,b)=>a.term.localeCompare(b.term))
      })).filter(g=>g.concepts.length>0)
    : null;

  const TABS = [
    {key:"search", icon:"ti-search",   label:"Look up"},
    {key:"saved",  icon:"ti-bookmark", label:"My Concepts"+(saved.length?" · "+saved.length:"")},
    {key:"graph",  icon:"ti-sitemap",  label:"Graph"},
  ];

  return (
    <div style={{ fontFamily:"var(--font-sans)", maxWidth:880, margin:"0 auto", padding:"20px 16px 48px" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
        <div style={{ width:40, height:40, borderRadius:11, flexShrink:0,
          background:"linear-gradient(135deg,#3b82f6,#6366f1)",
          display:"flex", alignItems:"center", justifyContent:"center" }}>
          <i className="ti ti-book-2" style={{ fontSize:21, color:"#fff" }} aria-hidden="true"/>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:"var(--color-text-primary)", lineHeight:1.2 }}>Dev, AI &amp; Product</div>
          <div style={{ fontSize:12, color:"var(--color-text-tertiary)", marginTop:1 }}>Define, save &amp; explore technical, AI, and product concepts</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {saved.length>0 && (
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:20, fontWeight:700, color:"var(--color-text-primary)", lineHeight:1 }}>{saved.length}</div>
              <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:2 }}>saved</div>
            </div>
          )}
          <button onClick={openSettings} title={apiKey?"Settings":"Add API key"} aria-label="Settings" style={{
            width:36, height:36, borderRadius:9,
            background:apiKey?"var(--color-background-tertiary)":"#f59e0b15",
            border:"1px solid "+(apiKey?"var(--color-border-tertiary)":"#f59e0b55"),
            color:apiKey?"var(--color-text-secondary)":"#f59e0b",
            cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:18, flexShrink:0 }}>
            <i className={apiKey?"ti ti-settings":"ti ti-key"} aria-hidden="true"/>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", background:"var(--color-background-tertiary)", borderRadius:11,
        padding:3, marginBottom:20, gap:2 }}>
        {TABS.map(t => {
          const active = tab===t.key;
          return (
            <button key={t.key} onClick={()=>setTab(t.key)} style={{
              flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6,
              padding:"8px 8px", borderRadius:9, border:"none",
              background:active?"var(--color-background-primary)":"transparent",
              boxShadow:active?"0 1px 4px rgba(0,0,0,0.1),0 0 0 0.5px rgba(0,0,0,0.04)":"none",
              color:active?"var(--color-text-primary)":"var(--color-text-tertiary)",
              fontWeight:active?600:400, fontSize:13, cursor:"pointer", transition:"all 0.12s", whiteSpace:"nowrap" }}>
              <i className={"ti "+t.icon} style={{ fontSize:14 }} aria-hidden="true"/>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Look up tab */}
      <div style={{ display:tab==="search"?"flex":"none", flexDirection:"column", gap:14 }}>
        {!apiKey && (
          <div style={{ padding:"11px 14px", borderRadius:10,
            background:"#f59e0b10", border:"1px solid #f59e0b40",
            display:"flex", alignItems:"center", gap:10 }}>
            <i className="ti ti-key" style={{ fontSize:18, color:"#f59e0b", flexShrink:0 }} aria-hidden="true"/>
            <div style={{ flex:1, fontSize:13, color:"var(--color-text-primary)", lineHeight:1.5 }}>
              <strong>Add your Anthropic API key</strong> to enable live lookups, diagrams, Q&amp;A, and learn-next suggestions. Without it, browse the seeded concepts under <em>My Concepts</em>.
            </div>
            <div style={{ display:"flex", gap:6, flexShrink:0 }}>
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer"
                style={{ padding:"7px 12px", borderRadius:8, border:"1px solid #f59e0b80",
                  background:"transparent", color:"#f59e0b", fontWeight:600, fontSize:13,
                  textDecoration:"none", display:"inline-flex", alignItems:"center", gap:5,
                  whiteSpace:"nowrap" }}>
                <i className="ti ti-external-link" style={{ fontSize:13 }} aria-hidden="true"/> Get a key
              </a>
              <button onClick={openSettings} style={{ padding:"7px 14px", borderRadius:8, border:"none",
                background:"#f59e0b", color:"#fff", fontWeight:600, fontSize:13,
                cursor:"pointer", whiteSpace:"nowrap" }}>Add key</button>
            </div>
          </div>
        )}
        <div style={{ position:"relative" }}>
          <i className="ti ti-search" style={{ position:"absolute", left:15, top:"50%",
            transform:"translateY(-50%)", fontSize:17, color:"var(--color-text-tertiary)", pointerEvents:"none" }} aria-hidden="true"/>
          <input value={query} onChange={e=>setQuery(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")lookup();}}
            placeholder="Search any AI, product, or development concept…"
            style={{ width:"100%", padding:"13px 108px 13px 46px", fontSize:15, boxSizing:"border-box",
              border:"1.5px solid var(--color-border-secondary)", borderRadius:11,
              background:"var(--color-background-primary)", color:"var(--color-text-primary)", outline:"none" }}/>
          <button onClick={()=>lookup()} disabled={loading||!query.trim()} style={{
            position:"absolute", right:6, top:"50%", transform:"translateY(-50%)",
            padding:"7px 15px", borderRadius:8, border:"none",
            background:loading||!query.trim()?"var(--color-background-tertiary)":"#3b82f6",
            color:loading||!query.trim()?"var(--color-text-tertiary)":"#fff",
            fontWeight:600, fontSize:13, cursor:loading||!query.trim()?"default":"pointer",
            display:"flex", alignItems:"center", gap:5, whiteSpace:"nowrap" }}>
            {loading ? <><i className="ti ti-loader-2" style={{animation:"spin 1s linear infinite",fontSize:13}} aria-hidden="true"/>Defining</> : "Define →"}
          </button>
        </div>

        {error && (
          <div style={{ padding:"10px 14px", borderRadius:9, background:"#ef444412",
            border:"1px solid #ef444430", color:"#ef4444", fontSize:14, display:"flex", alignItems:"center", gap:8 }}>
            <i className="ti ti-alert-circle" aria-hidden="true"/> {error}
          </div>
        )}

        {prevResult&&result && (
          <button onClick={goBack} style={{ alignSelf:"flex-start", display:"inline-flex", alignItems:"center", gap:6,
            fontSize:12, fontWeight:500, padding:"5px 12px", borderRadius:8,
            border:"1px solid var(--color-border-secondary)", background:"transparent",
            color:"var(--color-text-tertiary)", cursor:"pointer" }}>
            <i className="ti ti-arrow-left" aria-hidden="true"/>
            Back to <strong style={{color:"var(--color-text-secondary)",marginLeft:2}}>{prevResult.term}</strong>
          </button>
        )}

        {allResultDomains && (
          <div style={{ display:"flex", gap:7, alignItems:"center", flexWrap:"wrap" }}>
            <span style={{ fontSize:12, color:"var(--color-text-tertiary)" }}>This term means something different across domains:</span>
            {allResultDomains.map(d => {
              const dm=DOMAIN_META[d], active=d===currentDomain;
              return (
                <button key={d} onClick={active?undefined:()=>lookup(result.term,d)}
                  style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"5px 13px",
                    borderRadius:20, fontSize:13, fontWeight:active?600:400, cursor:active?"default":"pointer",
                    border:"1px solid "+(active?dm.color+"88":"var(--color-border-secondary)"),
                    background:active?dm.color+"15":"transparent", color:active?dm.color:"var(--color-text-secondary)" }}>
                  <i className={"ti "+dm.icon} style={{ fontSize:12 }} aria-hidden="true"/> {d}
                </button>
              );
            })}
          </div>
        )}

        {result && <ConceptCard data={result} isSaved={isSaved} savedTerms={savedMap}
          onSave={()=>saveConcept(result)} onLookupRelated={lookup} onSaveRelated={saveRelated}/>}
        {result && <SuggestionsPanel suggestions={suggestions} loading={suggestionsLoading}
          savedMap={savedMap} onLookup={lookup} onSave={saveRelated}/>}

        {!result&&!loading && (
          <div style={{ textAlign:"center", padding:"48px 20px 32px" }}>
            <div style={{ width:60, height:60, borderRadius:17, background:"linear-gradient(135deg,#3b82f614,#6366f114)",
              border:"1px solid #3b82f628", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}>
              <i className="ti ti-atom-2" style={{ fontSize:28, color:"#3b82f6" }} aria-hidden="true"/>
            </div>
            <div style={{ fontSize:17, fontWeight:700, color:"var(--color-text-primary)", marginBottom:6 }}>Define any concept</div>
            <div style={{ fontSize:13, color:"var(--color-text-tertiary)", marginBottom:22, lineHeight:1.65, maxWidth:320, margin:"0 auto 22px" }}>
              From dev fundamentals to AI frameworks and PM playbooks.
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:7, justifyContent:"center", alignItems:"center" }}>
              <span style={{ fontSize:12, color:"var(--color-text-tertiary)", marginRight:4 }}>Try:</span>
              {EXAMPLE_TERMS.map(term => (
                <button key={term} onClick={()=>lookup(term)} style={{
                  padding:"5px 13px", borderRadius:20, border:"1px solid var(--color-border-secondary)",
                  background:"var(--color-background-secondary)", color:"var(--color-text-secondary)",
                  fontSize:13, cursor:"pointer", fontWeight:500 }}>{term}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* My Concepts tab */}
      <div style={{ display:tab==="saved"?"flex":"none", flexDirection:"column", gap:12 }}>
        {showExport && (
          <div style={{ borderRadius:14, border:"1px solid var(--color-border-secondary)",
            background:"var(--color-background-primary)", overflow:"hidden",
            boxShadow:"0 4px 24px rgba(0,0,0,0.12)" }}>
            <div style={{ padding:"14px 16px", borderBottom:"1px solid var(--color-border-tertiary)",
              display:"flex", alignItems:"center", gap:10 }}>
              <i className="ti ti-download" style={{ fontSize:15, color:"#3b82f6" }} aria-hidden="true"/>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:700, color:"var(--color-text-primary)" }}>
                  Export {saved.length} concept{saved.length!==1?"s":""}
                </div>
                <div style={{ fontSize:12, color:"var(--color-text-tertiary)", marginTop:1 }}>
                  Copy the JSON below, then paste into a file and save as <code style={{fontFamily:"var(--font-mono)"}}>concepts.json</code>
                </div>
              </div>
              <button onClick={copyExport} style={{ display:"inline-flex", alignItems:"center", gap:6,
                padding:"7px 14px", borderRadius:8, flexShrink:0,
                border:"1px solid "+(exportCopied?"#10b98155":"#3b82f655"),
                background:exportCopied?"#10b98115":"#3b82f615",
                color:exportCopied?"#10b981":"#3b82f6", fontWeight:600, fontSize:13, cursor:"pointer" }}>
                <i className={"ti "+(exportCopied?"ti-check":"ti-clipboard")} aria-hidden="true"/>
                {exportCopied?"Copied!":"Copy all"}
              </button>
              <button onClick={()=>setShowExport(false)} style={{ background:"none", border:"none",
                color:"var(--color-text-tertiary)", cursor:"pointer", fontSize:20, padding:0, flexShrink:0,
                display:"flex", alignItems:"center" }}>
                <i className="ti ti-x" aria-hidden="true"/>
              </button>
            </div>
            <textarea readOnly value={JSON.stringify(saved, null, 2)}
              style={{ display:"block", width:"100%", height:320, margin:0, padding:"14px 16px",
                fontFamily:"var(--font-mono)", fontSize:12, lineHeight:1.6, boxSizing:"border-box",
                color:"var(--color-text-secondary)", background:"var(--color-background-tertiary)",
                border:"none", resize:"none", outline:"none", overflowY:"auto" }}/>
          </div>
        )}
        {importStatus && (
          <div style={{ padding:"12px 14px", borderRadius:10,
            border:"1px solid "+(importStatus.phase==="error"?"#ef444440":importStatus.phase==="done"?(importStatus.failed>0?"#f59e0b40":"#10b98140"):"#3b82f640"),
            background:importStatus.phase==="error"?"#ef444410":importStatus.phase==="done"?(importStatus.failed>0?"#f59e0b10":"#10b98110"):"#3b82f610" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <i className={"ti "+(importStatus.phase==="error"?"ti-alert-circle":importStatus.phase==="done"?(importStatus.failed>0?"ti-alert-triangle":"ti-circle-check"):"ti-loader-2")}
                style={{ fontSize:18, color:importStatus.phase==="error"?"#ef4444":importStatus.phase==="done"?(importStatus.failed>0?"#f59e0b":"#10b981"):"#3b82f6",
                  animation:(importStatus.phase==="reading"||importStatus.phase==="importing")?"spin 1s linear infinite":"none" }} aria-hidden="true"/>
              <div style={{ flex:1, fontSize:13, color:"var(--color-text-primary)" }}>
                {importStatus.phase==="reading" && "Reading file…"}
                {importStatus.phase==="importing" && <>Importing concepts… <strong>{importStatus.done}/{importStatus.total}</strong>{importStatus.failed>0&&<span style={{color:"#f59e0b",marginLeft:6}}>({importStatus.failed} failed)</span>}</>}
                {importStatus.phase==="done" && <>Import complete: <strong>{importStatus.ok}</strong> imported{importStatus.failed>0&&<span style={{color:"#f59e0b"}}>, {importStatus.failed} failed</span>}{importStatus.skipped>0&&<span style={{color:"var(--color-text-tertiary)"}}>, {importStatus.skipped} skipped</span>}</>}
                {importStatus.phase==="error" && importStatus.message}
              </div>
              {importStatus.phase==="done" && (
                <button onClick={()=>setImportStatus(null)} style={{ background:"none", border:"none",
                  color:"var(--color-text-tertiary)", cursor:"pointer", fontSize:18, padding:0, display:"flex", alignItems:"center" }}>
                  <i className="ti ti-x" aria-hidden="true"/>
                </button>
              )}
            </div>
            {importStatus.phase==="done"&&importStatus.errors?.length>0 && (
              <details style={{ marginTop:8 }}>
                <summary style={{ fontSize:12, color:"#f59e0b", cursor:"pointer", fontWeight:500 }}>
                  Show {importStatus.errors.length} failed import{importStatus.errors.length!==1?"s":""}
                </summary>
                <div style={{ marginTop:8, padding:"8px 10px", borderRadius:6, background:"var(--color-background-primary)",
                  border:"1px solid var(--color-border-tertiary)", maxHeight:160, overflow:"auto",
                  fontFamily:"var(--font-mono)", fontSize:11, color:"var(--color-text-secondary)" }}>
                  {importStatus.errors.map((err,i) => (
                    <div key={i} style={{marginBottom:4}}><strong style={{color:"var(--color-text-primary)"}}>{err.term}</strong>: {err.error}</div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {!storageReady ? (
          <div style={{ textAlign:"center", padding:"60px 20px" }}>
            <i className="ti ti-loader-2" style={{ fontSize:32, color:"var(--color-text-tertiary)",
              display:"block", marginBottom:10, animation:"spin 1s linear infinite" }} aria-hidden="true"/>
            <div style={{ fontSize:14, color:"var(--color-text-tertiary)" }}>Loading your saved concepts…</div>
          </div>
        ) : saved.length===0 ? (
          <div style={{ textAlign:"center", padding:"72px 20px" }}>
            <div style={{ width:68, height:68, borderRadius:18, background:"var(--color-background-tertiary)",
              border:"1px solid var(--color-border-secondary)", display:"flex", alignItems:"center",
              justifyContent:"center", margin:"0 auto 18px" }}>
              <i className="ti ti-bookmarks" style={{ fontSize:30, color:"var(--color-text-tertiary)" }} aria-hidden="true"/>
            </div>
            <div style={{ fontSize:17, fontWeight:700, color:"var(--color-text-secondary)", marginBottom:8 }}>Your library is empty</div>
            <div style={{ fontSize:13, color:"var(--color-text-tertiary)", marginBottom:22, lineHeight:1.65 }}>
              Look up any term and save it here to build your personal reference.
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
              <button onClick={()=>setTab("search")} style={{ padding:"9px 22px", borderRadius:9,
                border:"none", background:"#3b82f6", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer" }}>
                Start exploring
              </button>
              <label style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"9px 18px", borderRadius:9,
                border:"1px solid var(--color-border-secondary)", background:"var(--color-background-primary)",
                color:"var(--color-text-secondary)", fontWeight:600, fontSize:14, cursor:"pointer" }}>
                <i className="ti ti-upload" aria-hidden="true"/> Import from JSON
                <input type="file" accept=".json,application/json" style={{ display:"none" }} onChange={importConcepts}/>
              </label>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", padding:"9px 12px",
              borderRadius:10, background:"var(--color-background-tertiary)", border:"1px solid var(--color-border-tertiary)" }}>
              <i className="ti ti-adjustments-horizontal" style={{ fontSize:15, color:"var(--color-text-tertiary)", flexShrink:0 }} aria-hidden="true"/>
              <input value={searchFilter} onChange={e=>setSearchFilter(e.target.value)}
                placeholder="Filter concepts…" style={{ flex:1, minWidth:120, padding:"5px 10px", fontSize:13,
                  border:"1px solid var(--color-border-secondary)", borderRadius:7,
                  background:"var(--color-background-primary)", color:"var(--color-text-primary)", outline:"none" }}/>
              <select value={catFilter} onChange={e=>setCatFilter(e.target.value)}
                style={{ padding:"5px 8px", fontSize:13, borderRadius:7, border:"1px solid var(--color-border-secondary)",
                  background:"var(--color-background-primary)", color:"var(--color-text-primary)" }}>
                {categories.map(c=><option key={c}>{c}</option>)}
              </select>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
                style={{ padding:"5px 8px", fontSize:13, borderRadius:7, border:"1px solid var(--color-border-secondary)",
                  background:"var(--color-background-primary)", color:"var(--color-text-primary)" }}>
                <option value="alpha">A → Z</option>
                <option value="depth-asc">Depth ↑</option>
                <option value="depth-desc">Depth ↓</option>
                <option value="domain">Domain</option>
              </select>
              <span style={{ fontSize:12, color:"var(--color-text-tertiary)", whiteSpace:"nowrap" }}>
                {sortedConcepts.length}/{saved.length}
              </span>
              <div style={{ marginLeft:"auto", display:"flex", gap:6, flexShrink:0 }}>
                <label style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"5px 11px", borderRadius:7,
                  border:"1px solid var(--color-border-secondary)", background:"var(--color-background-primary)",
                  color:"var(--color-text-secondary)", cursor:"pointer", fontSize:12, fontWeight:500 }}>
                  <i className="ti ti-upload" style={{ fontSize:13 }} aria-hidden="true"/> Import
                  <input type="file" accept=".json,application/json" style={{ display:"none" }} onChange={importConcepts}/>
                </label>
                <button onClick={exportConcepts} style={{ display:"inline-flex", alignItems:"center", gap:5,
                  padding:"5px 11px", borderRadius:7, border:"1px solid var(--color-border-secondary)",
                  background:"var(--color-background-primary)", color:"var(--color-text-secondary)",
                  cursor:"pointer", fontSize:12, fontWeight:500 }}>
                  <i className="ti ti-download" style={{ fontSize:13 }} aria-hidden="true"/> Export
                </button>
              </div>
            </div>

            {sortedConcepts.length===0 ? (
              <div style={{ textAlign:"center", padding:"32px 20px", color:"var(--color-text-tertiary)", fontSize:14 }}>
                No concepts match your filters.
              </div>
            ) : groupedByDomain ? (
              groupedByDomain.map(dg => {
                const dm=DOMAIN_META[dg.domain];
                return (
                  <div key={dg.domain} style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 13px",
                      borderRadius:9, background:dm.color+"10", border:"1px solid "+dm.color+"25" }}>
                      <i className={"ti "+dm.icon} style={{ color:dm.color, fontSize:15 }} aria-hidden="true"/>
                      <span style={{ fontSize:13, fontWeight:700, color:dm.color }}>{dg.domain}</span>
                      <span style={{ fontSize:12, color:dm.color, opacity:0.7 }}>{dg.concepts.length} concept{dg.concepts.length!==1?"s":""}</span>
                    </div>
                    {dg.concepts.map(c => <ConceptCard key={c.term} data={c} compact isSaved savedTerms={savedMap}
                      onRemove={()=>removeConcept(c)} onLookupRelated={lookup} onSaveRelated={saveRelated}/>)}
                  </div>
                );
              })
            ) : groupedByDepth ? (
              groupedByDepth.map(group => {
                const meta=DEPTH_META[group.depth]||DEPTH_META.intermediate;
                return (
                  <div key={group.depth} style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 13px",
                      borderRadius:9, background:meta.color+"10", border:"1px solid "+meta.color+"25" }}>
                      <DepthBadge depth={group.depth}/>
                      <span style={{ fontSize:12, color:meta.color, fontWeight:500 }}>{group.concepts.length} concept{group.concepts.length!==1?"s":""}</span>
                    </div>
                    {group.domainGroups.map(dg => {
                      const dm=DOMAIN_META[dg.domain];
                      return (
                        <div key={dg.domain} style={{ display:"flex", flexDirection:"column", gap:6 }}>
                          {group.domainGroups.length>1 && (
                            <div style={{ display:"flex", alignItems:"center", gap:5, padding:"3px 8px",
                              marginLeft:6, borderRadius:5, background:dm.color+"0e" }}>
                              <i className={"ti "+dm.icon} style={{ color:dm.color, fontSize:11 }} aria-hidden="true"/>
                              <span style={{ fontSize:10, fontWeight:700, color:dm.color, textTransform:"uppercase", letterSpacing:"0.05em" }}>{dg.domain}</span>
                            </div>
                          )}
                          {dg.concepts.map(c => <ConceptCard key={c.term} data={c} compact isSaved savedTerms={savedMap}
                            onRemove={()=>removeConcept(c)} onLookupRelated={lookup} onSaveRelated={saveRelated}/>)}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              sortedConcepts.map(c => <ConceptCard key={c.term} data={c} compact isSaved savedTerms={savedMap}
                onRemove={()=>removeConcept(c)} onLookupRelated={lookup} onSaveRelated={saveRelated}/>)
            )}
          </>
        )}
      </div>

      {/* Graph tab */}
      <div style={{ display:tab==="graph"?"block":"none" }}>
        <KnowledgeGraph saved={saved} savedMap={savedMap} onLookup={lookup} visible={tab==="graph"}/>
      </div>

      {showSettings && (
        <div onClick={()=>setShowSettings(false)} style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.45)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:16 }}>
          <div onClick={e=>e.stopPropagation()} style={{
            width:"min(480px,100%)", borderRadius:14,
            background:"var(--color-background-primary)",
            border:"1px solid var(--color-border-secondary)",
            boxShadow:"0 10px 40px rgba(0,0,0,0.2)", padding:"22px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
              <i className="ti ti-settings" style={{ fontSize:18, color:"#3b82f6" }} aria-hidden="true"/>
              <div style={{ fontSize:16, fontWeight:700, color:"var(--color-text-primary)" }}>Settings</div>
              <button onClick={()=>setShowSettings(false)} aria-label="Close" style={{
                marginLeft:"auto", background:"none", border:"none",
                color:"var(--color-text-tertiary)", cursor:"pointer", fontSize:20,
                display:"flex", alignItems:"center", padding:0 }}>
                <i className="ti ti-x" aria-hidden="true"/>
              </button>
            </div>
            <div style={{ fontSize:13, fontWeight:600, color:"var(--color-text-primary)", marginBottom:6 }}>Anthropic API key</div>
            <div style={{ fontSize:12, color:"var(--color-text-tertiary)", marginBottom:10, lineHeight:1.55 }}>
              Required for live lookups, diagrams, Q&amp;A, and "Learn next" suggestions. Stored only in this browser's localStorage. Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" style={{ color:"#3b82f6" }}>console.anthropic.com</a>.
            </div>
            <input type="password" value={apiKeyDraft} onChange={e=>setApiKeyDraft(e.target.value)}
              placeholder="sk-ant-..."
              onKeyDown={e=>{ if(e.key==="Enter"&&apiKeyDraft.trim()) saveApiKey(); }}
              style={{ width:"100%", padding:"10px 12px", fontSize:13, borderRadius:8,
                border:"1.5px solid var(--color-border-secondary)",
                background:"var(--color-background-primary)", color:"var(--color-text-primary)",
                outline:"none", fontFamily:"var(--font-mono)", marginBottom:12, boxSizing:"border-box" }}/>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <button onClick={saveApiKey} disabled={!apiKeyDraft.trim()} style={{
                padding:"8px 18px", borderRadius:8, border:"none",
                background:apiKeyDraft.trim()?"#3b82f6":"var(--color-background-tertiary)",
                color:apiKeyDraft.trim()?"#fff":"var(--color-text-tertiary)",
                fontWeight:600, fontSize:13,
                cursor:apiKeyDraft.trim()?"pointer":"default" }}>Save</button>
              {apiKey && (
                <button onClick={clearApiKey} style={{ padding:"8px 14px", borderRadius:8,
                  border:"1px solid #ef444455", background:"#ef444412", color:"#ef4444",
                  fontWeight:500, fontSize:13, cursor:"pointer" }}>Clear key</button>
              )}
              <span style={{ marginLeft:"auto", fontSize:12,
                color: apiKey ? "#10b981" : "var(--color-text-tertiary)" }}>
                {apiKey ? "Key set" : "Not set"}
              </span>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        .diag svg { display:block; width:100%; height:auto; }
      `}</style>
    </div>
  );
}
