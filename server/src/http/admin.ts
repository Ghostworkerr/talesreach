import { timingSafeEqual } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { getAccountStore } from "../services.js";

const REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;

/** The admin password must be set (ADMIN_TOKEN, 24+ characters) or the admin area doesn't exist. */
function adminToken(): string | null {
  const t = process.env.ADMIN_TOKEN ?? "";
  return t.length >= 24 ? t : null;
}

function isAdmin(req: Request): boolean {
  const expected = adminToken();
  const given = /^Bearer (.+)$/.exec(req.header("authorization") ?? "")?.[1] ?? "";
  if (!expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/**
 * The report queue for the owner/moderators:
 * - GET  /api/admin/reports?status=open
 * - POST /api/admin/reports/:id { status }
 * - GET  /admin  (a small page that uses the two calls above)
 */
export function adminRoutes(app: express.Application) {
  const api = express.Router();
  api.use(express.json({ limit: "1kb" }));
  api.use((req: Request, res: Response, next: NextFunction) => {
    if (!adminToken()) return res.status(404).json({ error: "not_found" });
    if (!isAdmin(req)) return res.status(401).json({ error: "unauthorised" });
    next();
  });

  api.get("/reports", async (req, res) => {
    const status = z.enum(REPORT_STATUSES).catch("open").parse(req.query.status);
    const rows = await getAccountStore().listReports(status);
    res.json({ reports: rows.map((r) => ({ ...r, evidence: JSON.parse(r.evidence) as unknown })) });
  });

  api.post("/reports/:id", async (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    const body = z.object({ status: z.enum(REPORT_STATUSES) }).strict().safeParse(req.body);
    if (!id.success || !body.success) return res.status(400).json({ error: "invalid_request" });
    await getAccountStore().setReportStatus(id.data, body.data.status);
    res.json({ ok: true });
  });

  app.use("/api/admin", api);
  app.get("/admin", (_req, res) => {
    if (!adminToken()) return res.status(404).send("Not found");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
    res.type("html").send(ADMIN_PAGE);
  });
}

/** A tiny self-contained moderation page (no external scripts). */
const ADMIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Talesreach reports</title><style>
body{font:15px system-ui,sans-serif;margin:0;padding:16px;background:#f6efe1;color:#2b2016}
h1{font:700 22px Georgia,serif;margin:0 0 12px}input,select,button{font:inherit;min-height:40px;padding:0 10px}
.card{background:#fffaf0;border:1px solid #d8c6a3;border-radius:8px;padding:12px;margin:10px 0}
.meta{color:#6b5034;font-size:13px}pre{white-space:pre-wrap;background:#f1e6cf;padding:8px;border-radius:6px;font-size:13px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}</style></head><body>
<h1>Talesreach — player reports</h1>
<div class="row"><input id="tok" type="password" placeholder="Admin password" autocomplete="current-password">
<select id="st"><option>open</option><option>resolved</option><option>dismissed</option></select>
<button id="go">Load</button></div><div id="out"></div>
<script>
const $=s=>document.querySelector(s);const tok=()=>sessionStorage.getItem("tr_admin")||"";
$("#tok").value=tok();
async function load(){sessionStorage.setItem("tr_admin",$("#tok").value);
 const r=await fetch("/api/admin/reports?status="+$("#st").value,{headers:{Authorization:"Bearer "+tok()}});
 if(!r.ok){$("#out").textContent="Could not load ("+r.status+")";return}
 const {reports}=await r.json();$("#out").innerHTML="";
 if(!reports.length){$("#out").textContent="No reports.";return}
 for(const x of reports){const d=document.createElement("div");d.className="card";
  const lines=x.evidence.map(e=>e.who+":\\n"+e.lines.map(l=>"  ["+l.channel+"] "+l.text).join("\\n")).join("\\n\\n");
  d.innerHTML="<b></b><div class=meta></div><p></p><pre></pre><div class=row></div>";
  d.querySelector("b").textContent="#"+x.id+" — "+x.reportedName+" ("+x.reason+")";
  d.querySelector(".meta").textContent=new Date(x.createdAt).toLocaleString()+" · reported account "+x.reportedId;
  d.querySelector("p").textContent=x.note||"(no note)";d.querySelector("pre").textContent=lines||"(no chat)";
  for(const s of ["resolved","dismissed","open"]){if(s===x.status)continue;const b=document.createElement("button");b.textContent="Mark "+s;
   b.onclick=async()=>{await fetch("/api/admin/reports/"+x.id,{method:"POST",headers:{Authorization:"Bearer "+tok(),"Content-Type":"application/json"},body:JSON.stringify({status:s})});load()};
   d.querySelector(".row").append(b)}
  $("#out").append(d)}}
$("#go").onclick=load;
</script></body></html>`;
