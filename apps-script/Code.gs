// ============================================================
// TRACKULATE — Thin Shell v2.0
// All AI/automation logic delegated to the Cloudflare Worker
// Apps Script: navigation, sheet writes, trigger wiring only
// ============================================================

var WORKER_URL = "https://trackulate.kai-d-corre-ea2.workers.dev";

var SH = {
  HOME:         "Home",
  SETTINGS:     "Settings",
  DEBT:         "Debt - Input",
  SCHEDULE:     "Debt - Schedule",
  BUDGET:       "Budget - Planner",
  TRANSACTIONS: "Budget - Transactions",
  NETWORTH:     "NetWorth - Tracker",
  ASSETS:       "NetWorth - Assets",
  FUNDS:        "Funds - Goals",
  SUBS:         "Subs - Tracker",
  GUIDE:        "Setup Guide",
};

// ════════════════════════════════════════════════════════════
// LICENCE HELPERS
// ════════════════════════════════════════════════════════════
function getLicenceKey() {
  return PropertiesService.getScriptProperties().getProperty("licence_key") || "";
}

function isProActive() {
  return PropertiesService.getScriptProperties().getProperty("pro_active") === "true";
}

function activateLicence(key) {
  if (!key || !key.trim()) return { success: false, message: "Please enter a licence key." };
  var trimmed = key.trim().toUpperCase();
  var email   = "";
  var sheetId = "";
  try {
    var ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.SETTINGS);
    if (ws) email = String(ws.getRange("D7").getValue() || "");
    sheetId = SpreadsheetApp.getActiveSpreadsheet().getId() || "";
  } catch (e) {}

  try {
    var res  = UrlFetchApp.fetch(WORKER_URL + "/activate", {
      method:             "POST",
      headers:            { "Content-Type": "application/json" },
      payload:            JSON.stringify({ licence_key: trimmed, email: email, sheet_id: sheetId }),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = JSON.parse(res.getContentText());
    if (code === 200 && data.success) {
      var props = PropertiesService.getScriptProperties();
      props.setProperty("licence_key", trimmed);
      props.setProperty("pro_active",  data.tier === "pro" ? "true" : "false");
      var msg = data.message || "Activated!";
      if (data.warning) msg = msg + " Note: " + data.warning;
      return { success: true, tier: data.tier, message: msg };
    }
    return { success: false, message: data.message || "Activation failed." };
  } catch (e) {
    return { success: false, message: "Network error. Please try again." };
  }
}

function getLicenceStatus() {
  var key = getLicenceKey();
  if (!key) return { tier: "standard", status: "no_key", isPro: false, email: "" };
  try {
    var res  = UrlFetchApp.fetch(WORKER_URL + "/validate", {
      method:             "POST",
      headers:            { "Content-Type": "application/json" },
      payload:            JSON.stringify({ licence_key: key }),
      muteHttpExceptions: true,
    });
    var data = JSON.parse(res.getContentText());
    return {
      tier:         data.tier   || "standard",
      status:       data.status || "unknown",
      isPro:        data.isPro  === true,
      email:        data.email  || "",
      activated_at: data.activated_at || "",
    };
  } catch (e) {
    return { tier: isProActive() ? "pro" : "standard", status: "unknown", isPro: isProActive(), email: "" };
  }
}

// ════════════════════════════════════════════════════════════
// ON OPEN
// ════════════════════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("✦ Trackulate")
    .addItem("Open Control Centre",   "showControlCentre")
    .addItem("Go to Home",            "goHome")
    .addSeparator()
    .addItem("Setup & Welcome Guide", "showSetupWizard")
    .addItem("Unlock Pro Features",   "showUpgradePrompt")
    .addToUi();

  showControlCentre();
  validateLicenceOnOpen();

  var props = PropertiesService.getUserProperties();
  if (!props.getProperty("hide_welcome")) {
    showSetupWizard();
  }
}

function validateLicenceOnOpen() {
  var key = getLicenceKey();
  var props = PropertiesService.getScriptProperties();
  if (!key) { props.setProperty("pro_active", "false"); return; }
  try {
    var res  = UrlFetchApp.fetch(WORKER_URL + "/validate", {
      method:             "POST",
      headers:            { "Content-Type": "application/json" },
      payload:            JSON.stringify({ licence_key: key }),
      muteHttpExceptions: true,
    });
    var data = JSON.parse(res.getContentText());
    props.setProperty("pro_active", (data.isPro === true) ? "true" : "false");
  } catch (e) {
    // Network failure — don't downgrade; leave pro_active as-is
  }
}

// ════════════════════════════════════════════════════════════
// ON EDIT
// ════════════════════════════════════════════════════════════
function onEdit(e) {
  var sheet = e.range.getSheet();
  var name  = sheet.getName();
  var col   = e.range.getColumn();
  var row   = e.range.getRow();
  var val   = e.value;

  if (name === SH.DEBT && col === 4 && row >= 6 && row <= 15) {
    if (Number(val) === 0 && isProActive()) {
      var debtName = sheet.getRange(row, 3).getValue();
      if (debtName) triggerDebtCelebration(debtName);
    }
  }

  if (name === SH.SUBS && col === 9 && row >= 13 && row <= 32) {
    if (val === "No" && isProActive()) {
      var subName = sheet.getRange(row, 3).getValue();
      var cost    = sheet.getRange(row, 6).getValue();
      if (subName) triggerCancellationReminder(subName, cost);
    }
  }
}

// ════════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════════
function goHome() {
  var h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.HOME);
  if (h) SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(h);
}

function navigateTo(sheetName) {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (s) SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(s);
}

// ════════════════════════════════════════════════════════════
// SIDEBAR DISPLAY — HTML served from Cloudflare Pages
// ════════════════════════════════════════════════════════════
function showControlCentre() {
  var html = loadSidebar("ControlCentre");
  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutput(html).setTitle("Control Centre")
  );
}

function showSetupWizard() {
  var html = loadSidebar("SetupWizard");
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(400).setHeight(620),
    "Trackulate Setup"
  );
}

function showTransactionInput() {
  if (!isProActive()) { showUpgradePrompt(); return; }
  var html = loadSidebar("TransactionInput");
  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutput(html).setTitle("Log Transaction")
  );
}

function showUpgradePrompt() {
  var html = loadSidebar("UpgradePrompt");
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(400).setHeight(440),
    "Unlock Pro Features"
  );
}

function showLicenceInfo() {
  var html = loadSidebar("LicenceInfo");
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(360).setHeight(240),
    "Licence Details"
  );
}

// ════════════════════════════════════════════════════════════
// SETUP WIZARD — writes to sheet directly
// ════════════════════════════════════════════════════════════
function activateFromWizard(details, toggles) {
  var ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.SETTINGS);
  ws.getRange("D6").setValue(details.name);
  ws.getRange("D7").setValue(details.email);
  ws.getRange("D8").setValue(details.income     || "");
  ws.getRange("D9").setValue(details.foodBudget || "");
  ws.getRange("D11").setValue(details.startDate || new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }));
  ws.getRange("D12").setValue(details.household || "");
  ws.getRange("D15").setValue(toggles.budget  ? "Yes" : "No");
  ws.getRange("D16").setValue(toggles.monthly ? "Yes" : "No");
  ws.getRange("D17").setValue(toggles.subs    ? "Yes" : "No");
  ws.getRange("D18").setValue(toggles.debt    ? "Yes" : "No");
  ws.getRange("D19").setValue(toggles.funds   ? "Yes" : "No");
  rebuildTriggers();
  PropertiesService.getUserProperties().setProperty("setup_complete", "true");
  return "success";
}

function dismissWelcomeGuide(dontShow) {
  if (dontShow) PropertiesService.getUserProperties().setProperty("hide_welcome", "true");
}

// ════════════════════════════════════════════════════════════
// AI FEATURES — delegate to Worker
// ════════════════════════════════════════════════════════════
function sendChatMessage(userMessage) {
  if (!isProActive()) throw new Error("Pro licence required.");
  var tokens = getTokenUsage();
  if (tokens.remaining <= 0) throw new Error("No credits remaining today. Resets at midnight.");

  var snapshot = getFinancialSnapshot();
  var system   = buildSystemPromptLocal(snapshot);
  var history  = getChatHistory();
  history.push({ role: "user", content: userMessage });

  var result = callWorker({ feature: "chat", prompt: userMessage, history: history, system: system });
  history.push({ role: "assistant", content: result });
  saveChatHistory(history);
  consumeToken();
  return { reply: result, tokens: getTokenUsage() };
}

function parseAndLogTransaction(text) {
  if (!isProActive()) throw new Error("Pro licence required.");
  if (getTokenUsage().remaining <= 0) throw new Error("No credits remaining today.");
  var cats   = ["Housing", "Utilities", "Insurance", "Phone", "Subscriptions", "Transport", "Food & Groceries", "Eating Out", "Clothing", "Personal Care", "Entertainment", "Household", "Gym / Sport", "Gifts", "Savings", "Emergency Fund", "Investments", "Income", "Other"];
  var prompt = "Parse this transaction into JSON. Return ONLY valid JSON:\n{\"date\":\"DD Mon YYYY\",\"description\":\"merchant\",\"amount\":0.00,\"type\":\"Expense or Income or Savings\",\"category\":\"one of the categories\"}\n" +
    "Categories: " + cats.join(", ") + "\nToday: " + new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) + "\nTransaction: \"" + text + "\"";
  var result = callWorker({ feature: "parse_transaction", prompt: prompt });
  consumeToken();
  try {
    var tx = JSON.parse(result.replace(/```json|```/g, "").trim());
    var bt = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.TRANSACTIONS);
    var vals = bt.getRange("D7:D100").getValues();
    var writeRow = 7;
    for (var i = 0; i < vals.length; i++) { if (!vals[i][0]) { writeRow = 7 + i; break; } }
    bt.getRange(writeRow, 3).setValue(tx.date || new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }));
    bt.getRange(writeRow, 4).setValue(tx.description || text);
    bt.getRange(writeRow, 5).setValue(tx.amount || 0);
    bt.getRange(writeRow, 6).setValue(tx.type || "Expense");
    bt.getRange(writeRow, 7).setValue(tx.category || "Other");
    return "Logged: " + tx.description + " — " + formatGBP(tx.amount) + " (" + tx.category + ")";
  } catch (e) { return "Could not parse. Try: \"spent £XX at [place] on [date]\""; }
}

function categoriseTransactionsFromSidebar(raw) {
  if (!isProActive()) throw new Error("Pro licence required.");
  if (!raw || !raw.trim()) throw new Error("No transactions found.");
  if (getTokenUsage().remaining <= 0) throw new Error("No credits remaining today.");

  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var bt   = ss.getSheetByName(SH.TRANSACTIONS);
  var cats = ["Housing", "Utilities", "Insurance", "Phone", "Subscriptions", "Transport",
              "Food & Groceries", "Eating Out", "Clothing", "Personal Care", "Entertainment",
              "Household", "Gym / Sport", "Gifts", "Savings", "Emergency Fund", "Investments", "Income", "Other"];
  var catStr = cats.join(", ");
  var CHUNK  = 4000;
  var allTxs = [];

  for (var i = 0; i < raw.length; i += CHUNK) {
    var chunk  = raw.substring(i, i + CHUNK);
    if (!chunk.trim()) continue;
    var prompt = "Extract every bank transaction from the text below. " +
      "Return ONLY a JSON array, nothing else, no markdown, no explanation. " +
      "Format each item: {\"date\":\"DD Mon YYYY\",\"description\":\"merchant\",\"amount\":0.00,\"type\":\"Expense or Income or Savings\",\"category\":\"cat\"} " +
      "Use positive amounts only. Categories: " + catStr + ". Text: " + chunk;
    var result = callWorker({ feature: "categorise", prompt: prompt });
    var clean  = result.replace(/```json/gi, "").replace(/```/g, "").trim();
    var jStart = clean.indexOf("[");
    if (jStart === -1) continue;
    var jStr = clean.substring(jStart);
    var lastClose   = jStr.lastIndexOf("}");
    var lastBracket = jStr.lastIndexOf("]");
    if (lastBracket < lastClose) jStr = jStr.substring(0, lastClose + 1) + "]";
    else jStr = jStr.substring(0, lastBracket + 1);
    try {
      var txs = JSON.parse(jStr);
      if (Array.isArray(txs)) txs.forEach(function(t) { allTxs.push(t); });
    } catch (e) {}
  }

  consumeToken();
  if (allTxs.length === 0) throw new Error("No transactions extracted. The PDF may be scanned.");

  var existing = bt.getRange("D9:D300").getValues();
  var writeRow = 9;
  for (var k = 0; k < existing.length; k++) { if (!existing[k][0]) { writeRow = 9 + k; break; } }

  for (var j = 0; j < allTxs.length; j++) {
    var tx   = allTxs[j];
    var r    = writeRow + j;
    bt.getRange(r, 1).setValue(writeRow - 8 + j);
    bt.getRange(r, 3).setValue(tx.date || new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }));
    bt.getRange(r, 4).setValue(tx.description || "");
    bt.getRange(r, 5).setValue(Math.abs(Number(tx.amount) || 0));
    bt.getRange(r, 6).setValue(tx.type || "Expense");
    bt.getRange(r, 7).setValue(tx.category || "Other");
  }
  SpreadsheetApp.flush();
  return allTxs.length + " transactions logged to Budget - Transactions.";
}

// ════════════════════════════════════════════════════════════
// CONTROL CENTRE DATA
// ════════════════════════════════════════════════════════════
function getControlCentreData() {
  var s         = getSettings();
  var tokens    = getTokenUsage();
  var ss        = SpreadsheetApp.getActiveSpreadsheet();
  var totalDebt = 0, budgeted = 0, spent = 0, netWorth = 0, subCost = 0, unusedSubs = 0;
  try { totalDebt  = ss.getSheetByName(SH.DEBT).getRange("D22").getValue(); }   catch(e) {}
  try { budgeted   = ss.getSheetByName(SH.BUDGET).getRange("E33").getValue(); } catch(e) {}
  try { spent      = ss.getSheetByName(SH.BUDGET).getRange("F33").getValue(); } catch(e) {}
  try {
    var a = ss.getSheetByName(SH.ASSETS).getRange("D14").getValue();
    var l = ss.getSheetByName(SH.ASSETS).getRange("D24").getValue();
    netWorth = a - l;
  } catch(e) {}
  try { subCost    = ss.getSheetByName(SH.SUBS).getRange("F34").getValue(); }    catch(e) {}
  try { unusedSubs = ss.getSheetByName(SH.SUBS).getRange("I13:I32").getValues().filter(function(r) { return r[0] === "No"; }).length; } catch(e) {}

  var isPro       = isProActive();
  var licenceInfo = { isPro: isPro, tier: isPro ? "pro" : "standard", hasKey: getLicenceKey() !== "" };

  return {
    name:    s.name || "there",
    tokens:  tokens,
    stats:   { totalDebt: totalDebt, budgeted: budgeted, spent: spent, netWorth: netWorth, subCost: subCost, unusedSubs: unusedSubs, budgetPct: budgeted > 0 ? Math.round((spent / budgeted) * 100) : 0 },
    automations: { budget: s.alertBudget, monthly: s.alertMonthly, subs: s.alertSubs, debt: s.alertDebt, funds: s.alertFunds },
    history:     getChatHistory(),
    hasHistory:  getChatHistory().length > 0,
    licenceInfo: licenceInfo,
  };
}

// ════════════════════════════════════════════════════════════
// AUTOMATIONS (Pro-gated — return silently if no key)
// ════════════════════════════════════════════════════════════
function weeklyBudgetAlert() {
  if (!isProActive()) return;
  var s = getSettings();
  if (!s.alertBudget || !s.email) return;
  var bp   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.BUDGET);
  var budg = bp.getRange("E33").getValue();
  var spnt = bp.getRange("F33").getValue();
  var pct  = budg > 0 ? (spnt / budg) * 100 : 0;
  if (pct < 70) return;
  var status = pct >= 100 ? "Over Budget" : pct >= 90 ? "Almost Over Budget" : "Getting Close";
  var color  = pct >= 100 ? "#B84040" : "#B87040";
  var rows   = "";
  bp.getRange("C11:F28").getValues().forEach(function(row) {
    if (!row[0] || !row[2]) return;
    var p = Math.round((row[3] / row[2]) * 100);
    rows += "<tr><td style=\"padding:7px 10px;\">" + row[0] + "</td><td style=\"padding:7px 10px;text-align:right;\">" + formatGBP(row[2]) + "</td><td style=\"padding:7px 10px;text-align:right;\">" + formatGBP(row[3]) + "</td><td style=\"padding:7px 10px;text-align:right;font-weight:bold;color:" + (p >= 100 ? "#B84040" : "#2E7D5A") + ";\">" + p + "%</td></tr>";
  });
  sendEmail(s.email, "Budget Alert — " + status + " (" + Math.round(pct) + "% used)",
    "<p>Hi " + s.name + ", your budget is <strong style=\"color:" + color + ";\">" + status + "</strong>.</p>" +
    "<table style=\"width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;\">" +
    "<tr style=\"background:#2E1540;\"><th style=\"padding:8px 10px;color:#F8F5FA;text-align:left;\">Category</th><th style=\"padding:8px 10px;color:#F8F5FA;text-align:right;\">Budget</th><th style=\"padding:8px 10px;color:#F8F5FA;text-align:right;\">Spent</th><th style=\"padding:8px 10px;color:#F8F5FA;text-align:right;\">Used</th></tr>" +
    rows + "</table>" +
    "<p style=\"color:#B892D4;font-size:12px;\">Remaining: <strong style=\"color:#2E1540;\">" + formatGBP(budg - spnt) + "</strong></p>"
  );
}

function monthlySummaryEmail() {
  if (!isProActive()) return;
  var s = getSettings();
  if (!s.alertMonthly || !s.email) return;
  var ss       = SpreadsheetApp.getActiveSpreadsheet();
  var totalDebt = ss.getSheetByName(SH.DEBT).getRange("D22").getValue();
  var a         = ss.getSheetByName(SH.ASSETS).getRange("D14").getValue();
  var l         = ss.getSheetByName(SH.ASSETS).getRange("D24").getValue();
  var netWorth  = a - l;
  var budgeted  = ss.getSheetByName(SH.BUDGET).getRange("E33").getValue();
  var spent     = ss.getSheetByName(SH.BUDGET).getRange("F33").getValue();
  var saved     = ss.getSheetByName(SH.FUNDS).getRange("D24").getValue();
  var target    = ss.getSheetByName(SH.FUNDS).getRange("E24").getValue();
  var subCost   = ss.getSheetByName(SH.SUBS).getRange("F34").getValue();
  var month     = new Date().toLocaleString("en-GB", { month: "long", year: "numeric" });
  var rowData   = [
    ["Net Worth",             formatGBP(netWorth),         netWorth >= 0 ? "#2E7D5A" : "#B84040"],
    ["Total Debt",            formatGBP(totalDebt),        "#B84040"],
    ["Monthly Budget",        formatGBP(budgeted),         "#2E1540"],
    ["Total Spent",           formatGBP(spent),            spent > budgeted ? "#B84040" : "#2E7D5A"],
    ["Budget Remaining",      formatGBP(budgeted - spent), (budgeted - spent) >= 0 ? "#2E7D5A" : "#B84040"],
    ["Sinking Funds Saved",   formatGBP(saved),            "#2E7D5A"],
    ["Sinking Funds Target",  formatGBP(target),           "#2E1540"],
    ["Monthly Subscriptions", formatGBP(subCost),          "#2E1540"],
  ];
  var rows = rowData.map(function(r, i) {
    return "<tr style=\"background:" + (i % 2 === 0 ? "#F8F5FA" : "white") + ";\">" +
      "<td style=\"padding:9px 12px;color:#2E1540;\">" + r[0] + "</td>" +
      "<td style=\"padding:9px 12px;text-align:right;font-weight:bold;color:" + r[2] + ";\">" + r[1] + "</td></tr>";
  }).join("");
  sendEmail(s.email, "Your Monthly Finance Summary — " + month,
    "<p>Hi " + s.name + ", here is your financial snapshot for " + month + ".</p>" +
    "<table style=\"width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;\">" + rows + "</table>" +
    "<p style=\"color:#B892D4;font-size:12px;\">Open Trackulate AI in the Control Centre for a deeper analysis.</p>"
  );
}

function checkSubscriptionRenewals() {
  if (!isProActive()) return;
  var s = getSettings();
  if (!s.alertSubs || !s.email) return;
  var data  = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.SUBS).getRange("C13:I32").getValues();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var in7   = new Date(today); in7.setDate(today.getDate() + 7);
  var upcoming = data.filter(function(r) {
    if (!r[0] || r[2] !== "Active") return false;
    try { var d = new Date(r[5]); d.setHours(0, 0, 0, 0); return d >= today && d <= in7; } catch(e) { return false; }
  });
  if (!upcoming.length) return;
  var rows = upcoming.map(function(r, i) {
    return "<tr style=\"background:" + (i % 2 === 0 ? "#F8F5FA" : "white") + ";\">" +
      "<td style=\"padding:8px 10px;font-weight:bold;\">" + r[0] + "</td><td style=\"padding:8px 10px;\">" + r[1] + "</td>" +
      "<td style=\"padding:8px 10px;text-align:right;\">" + formatGBP(r[3]) + "/mo</td><td style=\"padding:8px 10px;\">" + r[5] + "</td></tr>";
  }).join("");
  sendEmail(s.email,
    upcoming.length + " Subscription" + (upcoming.length > 1 ? "s" : "") + " Renewing This Week",
    "<p>Hi " + s.name + ", these renew in the next 7 days:</p>" +
    "<table style=\"width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;\">" +
    "<tr style=\"background:#2E1540;\"><th style=\"padding:8px 10px;color:#F8F5FA;text-align:left;\">Service</th><th style=\"padding:8px 10px;color:#F8F5FA;text-align:left;\">Category</th><th style=\"padding:8px 10px;color:#F8F5FA;text-align:right;\">Cost</th><th style=\"padding:8px 10px;color:#F8F5FA;text-align:left;\">Date</th></tr>" +
    rows + "</table>" +
    "<p style=\"color:#B892D4;font-size:12px;\">Check <strong>Subs - Tracker</strong> to cancel anything unused.</p>"
  );
}

function checkMilestones() {
  if (!isProActive()) return;
  var s     = getSettings();
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  if (s.alertDebt) {
    ss.getSheetByName(SH.DEBT).getRange("C12:D21").getValues().forEach(function(row) {
      if (!row[0] || Number(row[1]) !== 0) return;
      triggerDebtCelebration(row[0]);
    });
  }
  if (s.alertFunds) {
    ss.getSheetByName(SH.FUNDS).getRange("C14:E23").getValues().forEach(function(row) {
      if (!row[0] || !row[2] || Number(row[1]) < Number(row[2])) return;
      var fKey = "fund_done_" + row[0];
      if (props.getProperty(fKey)) return;
      sendEmail(s.email, "Savings Goal Reached — " + row[0],
        "<p>Hi " + s.name + ",</p><p style=\"font-size:18px;color:#2E7D5A;font-weight:bold;\">You hit your " + row[0] + " goal!</p>" +
        "<p>You saved " + formatGBP(row[1]) + " towards your target of " + formatGBP(row[2]) + ". Head to <strong>Funds - Goals</strong> to set your next target.</p>"
      );
      props.setProperty(fKey, "true");
    });
  }
}

function triggerDebtCelebration(debtName) {
  if (!isProActive()) return;
  var s     = getSettings();
  var props = PropertiesService.getScriptProperties();
  var dKey  = "debt_done_" + debtName;
  if (props.getProperty(dKey)) return;
  sendEmail(s.email, "Debt Cleared — " + debtName,
    "<p>Hi " + s.name + ",</p>" +
    "<p style=\"font-size:18px;color:#2E7D5A;font-weight:bold;\">You cleared " + debtName + "!</p>" +
    "<p>Redirect that minimum payment to your next debt in <strong>Debt - Input</strong>.</p>"
  );
  props.setProperty(dKey, "true");
}

function triggerCancellationReminder(subName, cost) {
  if (!isProActive()) return;
  var s = getSettings();
  sendEmail(s.email, "Reminder: Cancel " + subName,
    "<p>Hi " + s.name + ",</p><p>You marked <strong>" + subName + "</strong> as unused. It costs <strong>" + formatGBP(cost) + "/month</strong> (" + formatGBP(cost * 12) + "/year). Head to the provider to cancel.</p>"
  );
}

function archiveMonthlyData() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var prev  = new Date(); prev.setMonth(prev.getMonth() - 1);
  var label = prev.toLocaleString("en-GB", { month: "short", year: "numeric" });
  var tabName = "Archive — " + label;
  if (ss.getSheetByName(tabName)) return;
  var arch      = ss.insertSheet(tabName);
  arch.setTabColor("E0CFF8");
  var totalDebt = ss.getSheetByName(SH.DEBT).getRange("D22").getValue();
  var budgeted  = ss.getSheetByName(SH.BUDGET).getRange("E33").getValue();
  var spent     = ss.getSheetByName(SH.BUDGET).getRange("F33").getValue();
  var a         = ss.getSheetByName(SH.ASSETS).getRange("D14").getValue();
  var l         = ss.getSheetByName(SH.ASSETS).getRange("D24").getValue();
  var saved     = ss.getSheetByName(SH.FUNDS).getRange("D24").getValue();
  var data = [
    ["Archive — " + label, ""], ["Snapshot: " + new Date().toLocaleDateString("en-GB"), ""], [],
    ["Metric", "Value"],
    ["Net Worth", formatGBP(a - l)], ["Total Debt", formatGBP(totalDebt)],
    ["Budget", formatGBP(budgeted)], ["Spent", formatGBP(spent)],
    ["Remaining", formatGBP(budgeted - spent)], ["Sinking Funds", formatGBP(saved)],
    [], ["BUDGET BREAKDOWN", "", "", ""],
  ];
  ss.getSheetByName(SH.BUDGET).getRange("C13:F32").getValues().forEach(function(r) {
    if (r[0]) data.push([r[0], formatGBP(r[2]), formatGBP(r[3]), r[2] > 0 ? Math.round((r[3] / r[2]) * 100) + "%" : "—"]);
  });
  data.push([], ["TRANSACTIONS", "Amount", "Type", "Category"]);
  ss.getSheetByName(SH.TRANSACTIONS).getRange("C9:H500").getValues().forEach(function(r) {
    if (r[1]) data.push([r[0] + " — " + r[1], formatGBP(r[2]), r[3], r[4]]);
  });
  arch.getRange(1, 1, data.length, 4).setValues(data);
  arch.getRange(1, 1).setFontSize(14).setFontWeight("bold");
  arch.setColumnWidth(1, 260); arch.setColumnWidth(2, 120); arch.setColumnWidth(3, 120); arch.setColumnWidth(4, 80);
  ss.getSheetByName(SH.TRANSACTIONS).getRange("C9:H500").clearContent();
  ss.moveActiveSheet(ss.getNumSheets());
}

function updateAutomationSetting(key, val) {
  if (!isProActive()) return;
  var ws  = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.SETTINGS);
  var map = { budget: "D15", monthly: "D16", subs: "D17", debt: "D18", funds: "D19" };
  if (map[key]) ws.getRange(map[key]).setValue(val ? "Yes" : "No");
  rebuildTriggers();
}

// ════════════════════════════════════════════════════════════
// SETTINGS + TRIGGERS
// ════════════════════════════════════════════════════════════
function getSettings() {
  var ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.SETTINGS);
  return {
    name:         ws.getRange("D6").getValue(),
    email:        ws.getRange("D7").getValue(),
    income:       ws.getRange("D8").getValue(),
    alertBudget:  ws.getRange("D15").getValue() === "Yes",
    alertMonthly: ws.getRange("D16").getValue() === "Yes",
    alertSubs:    ws.getRange("D17").getValue() === "Yes",
    alertDebt:    ws.getRange("D18").getValue() === "Yes",
    alertFunds:   ws.getRange("D19").getValue() === "Yes",
  };
}

function rebuildTriggers() {
  var s = getSettings();
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (["weeklyBudgetAlert", "monthlySummaryEmail", "checkSubscriptionRenewals", "checkMilestones", "onEdit"].indexOf(fn) > -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger("onEdit").forSpreadsheet(ss).onEdit().create();
  var pro = isProActive();
  if (pro && s.alertBudget)  ScriptApp.newTrigger("weeklyBudgetAlert").timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
  if (pro && s.alertMonthly) ScriptApp.newTrigger("monthlySummaryEmail").timeBased().onMonthDay(1).atHour(8).create();
  if (pro && (s.alertSubs || s.alertDebt || s.alertFunds)) {
    ScriptApp.newTrigger("checkSubscriptionRenewals").timeBased().everyDays(1).atHour(8).create();
    ScriptApp.newTrigger("checkMilestones").timeBased().everyDays(1).atHour(9).create();
  }
}

// ════════════════════════════════════════════════════════════
// TOKEN MANAGEMENT
// ════════════════════════════════════════════════════════════
function getTokenUsage() {
  var props = PropertiesService.getUserProperties();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var used  = parseInt(props.getProperty("tokens_" + today) || "0");
  return { used: used, remaining: Math.max(0, 20 - used), total: 20 };
}

function consumeToken() {
  var props = PropertiesService.getUserProperties();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var key   = "tokens_" + today;
  props.setProperty(key, String(parseInt(props.getProperty(key) || "0") + 1));
}

// ════════════════════════════════════════════════════════════
// CHAT HISTORY
// ════════════════════════════════════════════════════════════
function getChatHistory() {
  var raw = PropertiesService.getUserProperties().getProperty("chat_history");
  if (!raw) return [];
  try { return JSON.parse(raw); } catch(e) { return []; }
}

function saveChatHistory(history) {
  PropertiesService.getUserProperties().setProperty("chat_history", JSON.stringify(history.slice(-20)));
}

function clearChatHistory() {
  PropertiesService.getUserProperties().deleteProperty("chat_history");
}

// ════════════════════════════════════════════════════════════
// FINANCIAL SNAPSHOT
// ════════════════════════════════════════════════════════════
function getFinancialSnapshot() {
  var s  = getSettings();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var d  = { name: s.name || "User", income: s.income || 0, totalDebt: 0, extraPmt: 0, budgeted: 0, spent: 0, netWorth: 0, assets: 0, liabilities: 0, fundsSaved: 0, fundsTarget: 0, subCost: 0, unusedSubs: 0, debts: [], budgetCats: [] };
  try { d.totalDebt  = ss.getSheetByName(SH.DEBT).getRange("D22").getValue(); }   catch(e) {}
  try { d.extraPmt   = ss.getSheetByName(SH.DEBT).getRange("D26").getValue(); }   catch(e) {}
  try { d.budgeted   = ss.getSheetByName(SH.BUDGET).getRange("E33").getValue(); } catch(e) {}
  try { d.spent      = ss.getSheetByName(SH.BUDGET).getRange("F33").getValue(); } catch(e) {}
  try { var a = ss.getSheetByName(SH.ASSETS).getRange("D14").getValue(); var l = ss.getSheetByName(SH.ASSETS).getRange("D24").getValue(); d.netWorth = a - l; d.assets = a; d.liabilities = l; } catch(e) {}
  try { d.fundsSaved  = ss.getSheetByName(SH.FUNDS).getRange("D24").getValue(); } catch(e) {}
  try { d.fundsTarget = ss.getSheetByName(SH.FUNDS).getRange("E24").getValue(); } catch(e) {}
  try { d.subCost     = ss.getSheetByName(SH.SUBS).getRange("F34").getValue(); }  catch(e) {}
  try { d.unusedSubs  = ss.getSheetByName(SH.SUBS).getRange("I13:I32").getValues().filter(function(r) { return r[0] === "No"; }).length; } catch(e) {}
  try { d.debts = ss.getSheetByName(SH.DEBT).getRange("C12:F21").getValues().filter(function(r) { return r[0]; }).map(function(r) { return { name: r[0], balance: r[1], rate: r[2], minPmt: r[3] }; }); } catch(e) {}
  try { d.budgetCats = ss.getSheetByName(SH.BUDGET).getRange("C13:F32").getValues().filter(function(r) { return r[0] && r[2]; }).map(function(r) { return { name: r[0], budgeted: r[2], spent: r[3], pct: r[2] > 0 ? Math.round((r[3] / r[2]) * 100) : 0 }; }); } catch(e) {}
  var f = function(n) { return "£" + Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
  return "Name: " + d.name + " | Income: " + f(d.income) + "/mo | Debt: " + f(d.totalDebt) + " | Extra: " + f(d.extraPmt) + "/mo\n" +
    "Debts: " + (d.debts.length ? d.debts.map(function(db) { return db.name + ": " + f(db.balance) + " at " + (db.rate * 100).toFixed(2) + "%"; }).join(" | ") : "None") + "\n" +
    "Budget: " + f(d.spent) + " of " + f(d.budgeted) + " (" + (d.budgeted > 0 ? Math.round((d.spent / d.budgeted) * 100) : 0) + "%)\n" +
    "Net worth: " + f(d.netWorth) + " | Assets: " + f(d.assets) + " | Liabilities: " + f(d.liabilities) + "\n" +
    "Sinking funds: " + f(d.fundsSaved) + " of " + f(d.fundsTarget) + " | Subs: " + f(d.subCost) + "/mo | Unused: " + d.unusedSubs;
}

function buildSystemPromptLocal(snapshot) {
  return "You are Trackulate, an AI financial coach built into this Google Sheets finance system. " +
    "Be warm, direct, specific about numbers. Use British English and £. " +
    "No markdown, no bullet points. End every response with one specific next step referencing a tab or action. " +
    "CURRENT SNAPSHOT:\n" + snapshot;
}

// ════════════════════════════════════════════════════════════
// WORKER CALL
// ════════════════════════════════════════════════════════════
function callWorker(payload) {
  var props      = PropertiesService.getScriptProperties();
  var licKey     = props.getProperty("licence_key") || "";
  var sheetId    = SpreadsheetApp.getActiveSpreadsheet().getId() || "";
  var fullPayload = JSON.parse(JSON.stringify(payload));
  if (licKey)  fullPayload.licence_key = licKey;
  if (sheetId) fullPayload.sheet_id    = sheetId;
  try {
    var res  = UrlFetchApp.fetch(WORKER_URL + "/ai", {
      method:             "POST",
      headers:            { "Content-Type": "application/json" },
      payload:            JSON.stringify(fullPayload),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = JSON.parse(res.getContentText());
    if (code === 402) throw new Error("Pro licence required. Upgrade at trackulate.co.uk/pro.");
    if (code === 403) throw new Error(data.message || "Licence required.");
    if (code === 429) throw new Error("Daily limit reached. Resets at midnight.");
    return data.result || data.error || "No response received.";
  } catch (e) {
    if (e.message.indexOf("Licence") > -1 || e.message.indexOf("limit") > -1) throw e;
    return "Something went wrong: " + e.message;
  }
}

// ════════════════════════════════════════════════════════════
// SHARED HELPERS
// ════════════════════════════════════════════════════════════
function sendEmail(to, subject, body) {
  if (!to || to.indexOf("@") === -1) return;
  MailApp.sendEmail({
    to: to, subject: subject,
    htmlBody: "<div style=\"font-family:Arial,sans-serif;max-width:600px;margin:0 auto;\">" +
      "<div style=\"background:#2E1540;padding:24px 32px;border-radius:8px 8px 0 0;\">" +
      "<p style=\"color:#B892D4;font-size:10px;letter-spacing:2px;text-transform:uppercase;margin:0 0 6px;\">Trackulate</p>" +
      "<h1 style=\"color:#F8F5FA;font-size:18px;margin:0;font-weight:bold;\">" + subject + "</h1>" +
      "</div><div style=\"background:#F8F5FA;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #E0CFF8;\">" +
      body +
      "<hr style=\"border:none;border-top:1px solid #E0CFF8;margin:24px 0;\">" +
      "<p style=\"color:#B892D4;font-size:10px;\">Trackulate · trackulate.co.uk</p>" +
      "</div></div>",
  });
}

function formatGBP(n) {
  return "£" + Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
