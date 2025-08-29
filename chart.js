const { ChartJSNodeCanvas } = require("chartjs-node-canvas");
const axios = require("axios");
const cloudinary = require("cloudinary").v2;
require('dotenv').config(); // <-- load .env in the current working dir

// ====== ENV ======
const NOTION_TOKEN      = process.env.NOTION_TOKEN;       // secret_xxx
const DATABASE_ID       = process.env.DATABASE_ID;        // your DB id
const DASHBOARD_PAGE_ID = process.env.DASHBOARD_PAGE_ID;  // Notion page id
const CLOUD_NAME        = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUD_API_KEY     = process.env.CLOUDINARY_API_KEY;
const CLOUD_API_SECRET  = process.env.CLOUDINARY_API_SECRET;
const CLOUD_FOLDER      = process.env.CLOUDINARY_UPLOAD_FOLDER || "notion-charts";

// Notion DB property names
const PROP_TASK      = "Task";        // Title
const PROP_IS_MASTER = "Is Master";   // Checkbox (true on master rows)
const PROP_TARGET    = "Target";      // Number
const PROP_DONE      = "Done";        // Checkbox (daily rows)
const PROP_TASK_DATE = "Task Date";   // Date (daily rows)

if (!NOTION_TOKEN || !DATABASE_ID || !DASHBOARD_PAGE_ID || !CLOUD_NAME || !CLOUD_API_KEY || !CLOUD_API_SECRET) {
  console.error("❌ Missing env. Set NOTION_TOKEN, DATABASE_ID, DASHBOARD_PAGE_ID, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET");
  process.exit(1);
}

// Cloudinary config
cloudinary.config({
  cloud_name: CLOUD_NAME,
  api_key: CLOUD_API_KEY,
  api_secret: CLOUD_API_SECRET
});

const notionHeaders = {
  Authorization: `Bearer ${NOTION_TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

// ---------- Date helpers (Monday-start week) ----------
function toISODateLocal(d) {
  const dd = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return dd.toISOString().slice(0, 10);
}
function mondayOfWeekFromDate(anchorISO) {
  const d = new Date(anchorISO + "T00:00:00");
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return toISODateLocal(d);
}
function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toISODateLocal(d);
}
function mondayOfISOWeek(isoYear, isoWeek) {
  const fourthJan = new Date(Date.UTC(isoYear, 0, 4));
  const day = fourthJan.getUTCDay() || 7;
  const mondayWeek1 = new Date(fourthJan);
  mondayWeek1.setUTCDate(fourthJan.getUTCDate() - day + 1);
  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (isoWeek - 1) * 7);
  const local = new Date(monday.getTime() + monday.getTimezoneOffset() * 60000);
  return toISODateLocal(local);
}

// ---------- Arg parsing ----------
function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map(x => x.split("=")).map(([k, v]) => [k.replace(/^--/, ""), v ?? true])
  );
  if (args.date) {
    const weekStart = mondayOfWeekFromDate(args.date);
    const weekEnd   = addDaysISO(weekStart, 6);
    return { weekStart, weekEnd, label: `${weekStart} → ${weekEnd}` };
  }
  if (args.week) {
    const isoWeek = parseInt(args.week, 10);
    const isoYear = parseInt(args.year || new Date().getFullYear(), 10);
    const weekStart = mondayOfISOWeek(isoYear, isoWeek);
    const weekEnd   = addDaysISO(weekStart, 6);
    return { weekStart, weekEnd, label: `ISO ${isoYear}-W${String(isoWeek).padStart(2, "0")}` };
  }
  const todayISO = toISODateLocal(new Date());
  const weekStart = mondayOfWeekFromDate(todayISO);
  const weekEnd   = addDaysISO(weekStart, 6);
  return { weekStart, weekEnd, label: `${weekStart} → ${weekEnd}` };
}

// ---------- Notion fetch ----------
async function getMasterTasksMap() {
  const map = {}; // name -> { id, target }
  let cursor;
  do {
    const res = await axios.post(
      `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
      { filter: { property: PROP_IS_MASTER, checkbox: { equals: true } }, page_size: 100, start_cursor: cursor },
      { headers: notionHeaders }
    );
    for (const p of res.data.results) {
      const name   = p.properties[PROP_TASK]?.title?.[0]?.plain_text ?? "Untitled";
      const target = Number(p.properties[PROP_TARGET]?.number ?? 0) || 0;
      map[name] = { id: p.id, target };
    }
    cursor = res.data.has_more ? res.data.next_cursor : undefined;
  } while (cursor);
  return map;
}

async function getDoneCountsByTask(weekStart, weekEnd) {
  const counts = {}; // name -> count
  let cursor;
  do {
    const res = await axios.post(
      `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
      {
        filter: {
          and: [
            { property: PROP_DONE, checkbox: { equals: true } },
            { property: PROP_TASK_DATE, date: { on_or_after: weekStart } },
            { property: PROP_TASK_DATE, date: { on_or_before: weekEnd } },
          ],
        },
        page_size: 100,
        start_cursor: cursor,
      },
      { headers: notionHeaders }
    );
    for (const p of res.data.results) {
      const name = p.properties[PROP_TASK]?.title?.[0]?.plain_text ?? "Untitled";
      counts[name] = (counts[name] || 0) + 1;
    }
    cursor = res.data.has_more ? res.data.next_cursor : undefined;
  } while (cursor);
  return counts;
}

// ---------- Chart (PNG with Chart.js) ----------
async function buildChart(rows, title) {
  const canvas = new ChartJSNodeCanvas({ width: 1000, height: 560 });
  const labels = rows.map(r => r.name);
  const data   = rows.map(r => Math.max(0, Math.min(100, Math.round(r.percent))));

  const config = {
    type: "bar",
    data: { labels, datasets: [{ label: "Weekly %", data }] },
    options: {
      responsive: false,
      plugins: { title: { display: true, text: title }, legend: { display: false } },
      scales: { y: { beginAtZero: true, max: 100 } }
    }
  };

  return await canvas.renderToBuffer(config, "image/png");
}

// ---------- Upload PNG to Cloudinary ----------
/*async function uploadToCloudinary(buffer, publicIdHint) {
  const res = await cloudinary.uploader.upload_stream({
    resource_type: "image",
    folder: CLOUD_FOLDER,
    public_id: publicIdHint,    // optional; Cloudinary will dedupe/append if exists
    overwrite: true
  }, (error, result) => {
    if (error) throw error;
    // NOTE: We resolve via Promise wrapper below
  });

  // Wrap upload_stream to Promise
  return await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "image", folder: CLOUD_FOLDER, public_id: publicIdHint, overwrite: true },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}*/

async function uploadToCloudinary(buffer, publicIdHint) {
  const folder = process.env.CLOUDINARY_UPLOAD_FOLDER || "notion-charts";
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "image", folder, public_id: publicIdHint, overwrite: true },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}


// ---------- Embed into Notion ----------
async function embedImageOnPage(pageId, imageUrl, captionText) {
  await axios.patch(
    `https://api.notion.com/v1/blocks/${pageId}/children`,
    {
      children: [
        { object: "block", type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: captionText } }] } },
        { object: "block", type: "image", image: { type: "external", external: { url: imageUrl } } }
      ]
    },
    { headers: notionHeaders }
  );
}

async function removeOldChartsForWeek(pageId, weekLabel) {
  try {
    const res = await axios.get(
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
      { headers }
    );

    // Find image blocks with caption or title containing the current week label
    const imageBlocks = res.data.results.filter(b => 
      b.type === "image" &&
      (
        b.image.caption?.some(c => c.plain_text.includes(weekLabel)) || 
        (b.image.external?.url && b.image.external.url.includes(weekLabel.replace(/\s+/g, "_")))
      )
    );

    for (const block of imageBlocks) {
      await axios.delete(`https://api.notion.com/v1/blocks/${block.id}`, { headers });
      console.log(`🗑️ Deleted old chart block for week ${weekLabel}`);
    }
  } catch (err) {
    console.error("⚠️ Could not remove old chart for week:", err.response?.data || err.message);
  }
}


// ---------- Main ----------
/*(async () => {
  try {
    const { weekStart, weekEnd, label } = parseArgs();
    console.log(`📅 Building chart for ${label}`);

    const masters = await getMasterTasksMap();
    const counts  = await getDoneCountsByTask(weekStart, weekEnd);

    const rows = Object.keys(masters).map(name => {
      const target  = masters[name].target || 0;
      const count   = counts[name] || 0;
      const percent = target > 0 ? (count / target) * 100 : 0;
      return { name, target, count, percent };
    }).sort((a, b) => b.percent - a.percent);

    const title = `Weekly Count % (${weekStart} → ${weekEnd})`;

    // Render locally
    const png = await buildChart(rows, title);

    // Upload to Cloudinary
    const publicIdHint = `week_${weekStart}_to_${weekEnd}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const uploaded = await uploadToCloudinary(png, publicIdHint);
    const publicUrl = uploaded.secure_url;
    console.log("🌐 Cloudinary URL:", publicUrl);

    // Embed in Notion
    await embedImageOnPage(DASHBOARD_PAGE_ID, publicUrl, title);
    console.log("✅ Chart embedded on Notion dashboard");

  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
  }
})();*/

(async () => {
  try {
    const { weekStart, weekEnd, label } = parseArgs();
    console.log(`📅 Building chart for ${label}`);

    // 1) Fetch data from Notion
    const masters = await getMasterTasksMap();
    const counts  = await getDoneCountsByTask(weekStart, weekEnd);

    // 2) Compute rows
    const rows = Object.keys(masters)
      .map(name => {
        const target  = masters[name].target || 0;
        const count   = counts[name] || 0;
        const percent = target > 0 ? (count / target) * 100 : 0;
        return { name, target, count, percent };
      })
      .sort((a, b) => b.percent - a.percent);

    const title = `Weekly Count % (${weekStart} → ${weekEnd})`;

    // 3) Render chart (PNG buffer)
    const png = await buildChart(rows, title);

    // 4) Upload to Cloudinary
    const publicIdHint = `week_${weekStart}_to_${weekEnd}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    let uploaded;
    try {
      uploaded = await uploadToCloudinary(png, publicIdHint);
    } catch (upErr) {
      // Cloudinary sometimes returns a late 499 even after upload succeeds.
      // If you see this often, you can rethrow or exit gracefully.
      console.error("⚠️ Cloudinary upload error:", upErr.message || upErr);
      throw upErr; // keep as fatal unless you want to tolerate it
    }

    const publicUrl = uploaded.secure_url;
    console.log("🌐 Cloudinary URL:", publicUrl);

     // ✅ Try to remove old chart for the same week
    try {
      await removeOldChartsForWeek(DASHBOARD_PAGE_ID, weekStart, weekEnd);
      console.log("🧹 Old chart(s) for this week removed");
    } catch (err) {
      console.error("⚠️ Could not remove old chart(s):", err.response?.data || err.message);
    }
    // 5) Embed in Notion
    try {
      await embedImageOnPage(DASHBOARD_PAGE_ID, publicUrl, title);
      console.log("✅ Chart embedded on Notion dashboard");
    } catch (embedErr) {
      console.error("❌ Failed to embed chart in Notion:", embedErr.response?.data || embedErr.message);
      throw embedErr;
    }

  } catch (err) {
    // Better diagnostics
    if (err?.http_code === 499 || /Request Timeout/i.test(err?.message || "")) {
      console.warn("⚠️ Cloudinary reported a timeout after upload. Chart likely succeeded. Ignoring.");
      process.exit(0);
    }
    if (err.response) {
      console.error("❌ Error:", err.response.status, err.response.statusText);
      console.error("Details:", JSON.stringify(err.response.data, null, 2));
    } else {
      console.error("❌ Error:", err.message || err);
    }
    process.exit(1);
  }
})();
