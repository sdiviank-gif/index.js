const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = "1170844492772192";
const VERIFY_TOKEN = "barrygon2024";
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SERVICE_EMAIL = "barry-gon-bot@healthy-anthem-496908-a4.iam.gserviceaccount.com";
const PRIVATE_KEY = (process.env.PRIVATE_KEY || "").replace(/\\n/g, "\n");

async function sheets() {
  const auth = new google.auth.JWT(SERVICE_EMAIL, null, PRIVATE_KEY, ["https://www.googleapis.com/auth/spreadsheets"]);
  return google.sheets({ version: "v4", auth });
}

async function addRow(tab, values) {
  const s = await sheets();
  await s.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: tab + "!A1",
    valueInputOption: "RAW",
    requestBody: { values: [values] }
  });
}

async function getRows(tab) {
  const s = await sheets();
  const r = await s.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: tab + "!A2:F100" });
  return r.data.values || [];
}

async function sendWA(to, msg) {
  await axios.post("https://graph.facebook.com/v18.0/" + PHONE_NUMBER_ID + "/messages",
    { messaging_product: "whatsapp", to: to, type: "text", text: { body: msg } },
    { headers: { Authorization: "Bearer " + WHATSAPP_TOKEN, "Content-Type": "application/json" } }
  );
}

async function gemini(text) {
  const prompt = "You are BARRY-GON, a WhatsApp personal assistant. Help with spending, groceries, investments, scheduling. Reply ONLY in valid JSON, no markdown: {\"action\":\"log_spending or view_spending or add_grocery or view_groceries or log_investment or view_investments or add_schedule or view_schedule or general_reply\",\"data\":{\"amount\":null,\"category\":null,\"description\":null,\"currency\":null,\"item\":null,\"quantity\":null,\"date\":null,\"time\":null,\"event\":null,\"asset\":null,\"investment_action\":null,\"notes\":null},\"reply\":\"your reply\"}. User: " + text;
  const r = await axios.post("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + GEMINI_API_KEY,
    { contents: [{ parts: [{ text: prompt }] }] }
  );
  const raw = r.data.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
  return JSON.parse(raw);
}

async function handle(from, text) {
  try {
    const r = await gemini(text);
    let reply = r.reply;
    const d = r.data;
    const date = new Date().toLocaleDateString("en-CA");
    if (r.action === "log_spending") { await addRow("Spending", [date, d.category||"General", d.description||"", d.amount||0, d.currency||"CAD"]); }
    else if (r.action === "view_spending") { const rows = await getRows("Spending"); reply = rows.length ? "Spending:\n" + rows.slice(-5).reverse().map(function(r){return "- "+r[0]+" "+r[1]+": $"+r[3];}).join("\n") : "No spending logged."; }
    else if (r.action === "add_grocery") { await addRow("Groceries", [d.item||"", d.quantity||"1", "Pending", date]); }
    else if (r.action === "view_groceries") { const rows = await getRows("Groceries"); const p = rows.filter(function(r){return r[2]==="Pending";}); reply = p.length ? "Groceries:\n" + p.map(function(r,i){return (i+1)+". "+r[0];}).join("\n") : "List is empty."; }
    else if (r.action === "log_investment") { await addRow("Investments", [date, d.asset||"", d.investment_action||"", d.amount||0, d.notes||""]); }
    else if (r.action === "view_investments") { const rows = await getRows("Investments"); reply = rows.length ? "Investments:\n" + rows.slice(-5).reverse().map(function(r){return "- "+r[0]+" "+r[2]+" "+r[1]+": $"+r[3];}).join("\n") : "None logged."; }
    else if (r.action === "add_schedule") { await addRow("Schedule", [d.date||"", d.time||"", d.event||"", "No"]); }
    else if (r.action === "view_schedule") { const rows = await getRows("Schedule"); reply = rows.length ? "Schedule:\n" + rows.slice(-5).map(function(r){return "- "+r[0]+" at "+r[1]+": "+r[2];}).join("\n") : "Nothing scheduled."; }
    await sendWA(from, reply);
  } catch (err) {
    console.error("BARRY-GON Error:", err.message);
    await sendWA(from, "BARRY-GON hit a snag. Please try again.");
  }
}

app.get("/webhook", function(req, res) {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    res.status(200).send(req.query["hub.challenge"]);
  } else { res.sendStatus(403); }
});

app.post("/webhook", async function(req, res) {
  res.sendStatus(200);
  try {
    var val = req.body && req.body.entry && req.body.entry[0] && req.body.entry[0].changes && req.body.entry[0].changes[0] && req.body.entry[0].changes[0].value;
    if (!val || !val.messages || !val.messages[0]) return;
    var msg = val.messages[0];
    if (msg.type === "text") await handle(msg.from, msg.text.body);
  } catch (err) { console.error("Webhook error:", err.message); }
});

app.get("/", function(req, res) { res.send("BARRY-GON is online."); });
app.listen(3000, function() { console.log("BARRY-GON server running on port 3000"); });
