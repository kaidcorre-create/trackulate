// ============================================================
// TRACKULATE — COMPLETE FINANCE BUNDLE
// Apps Script · trackulate.co.uk
// ============================================================

var WORKER_URL  = "https://trackulate.kai-d-corre-ea2.workers.dev";
var USER_ID     = "trackulate_user_1"; // unique per buyer
var DAILY_TOKENS = 20;

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
// ON OPEN
// ════════════════════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("✦ Trackulate")
    .addItem("Open Control Centre",    "showControlCentre")
    .addItem("Go to Home",             "goHome")
    .addSeparator()
    .addItem("Setup & Welcome Guide",  "showSetupWizard")
    .addItem("Unlock Pro Features",    "showUpgradePrompt")
    .addToUi();

  // Always open the Control Centre on load
  showControlCentre();

  // Validate licence silently
  validateLicenceOnOpen();

  // Show setup wizard if not yet dismissed
  var props = PropertiesService.getUserProperties();
  if (!props.getProperty("hide_welcome")) {
    showSetupWizard();
  }
}

// ════════════════════════════════════════════════════════════
// LICENCE — VALIDATION & ACTIVATION
// ════════════════════════════════════════════════════════════

function isProActive() {
  return PropertiesService.getUserProperties().getProperty("pro_active") === "true";
}

function validateLicenceOnOpen() {
  var props = PropertiesService.getUserProperties();
  var key   = props.getProperty("licence_key");
  if (!key) {
    props.setProperty("pro_active", "false");
    return;
  }
  try {
    var res  = UrlFetchApp.fetch(WORKER_URL + "/validate", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      payload: JSON.stringify({ licence_key: key }),
      muteHttpExceptions: true,
    });
    var data = JSON.parse(res.getContentText());
    if (data.isPro === true) {
      props.setProperty("pro_active", "true");
    } else {
      props.setProperty("pro_active", "false");
    }
  } catch (e) {
    // Network failure — don't downgrade active users
    // Leave pro_active as whatever it was
  }
}

function activateLicence(key) {
  if (!key || !key.trim()) {
    return { success: false, message: "Please enter a licence key." };
  }
  var trimmed = key.trim().toUpperCase();
  var props   = PropertiesService.getUserProperties();
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheetId = ss ? ss.getId() : "";
  var email   = "";
  try {
    var ws = ss.getSheetByName(SH.SETTINGS);
    if (ws) email = ws.getRange("D7").getValue() || "";
  } catch (e) {}

  try {
    var res  = UrlFetchApp.fetch(WORKER_URL + "/activate", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      payload: JSON.stringify({ licence_key: trimmed, email: email, sheet_id: sheetId }),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = JSON.parse(res.getContentText());

    if (code === 200 && data.success) {
      props.setProperty("licence_key", trimmed);
      props.setProperty("pro_active",  data.tier === "pro" ? "true" : "false");
      var msg = data.message || "Activated!";
      if (data.warning) msg = msg + " Note: " + data.warning;
      return { success: true, tier: data.tier, message: msg };
    } else {
      return { success: false, message: data.message || "Activation failed." };
    }
  } catch (e) {
    return { success: false, message: "Network error. Please try again." };
  }
}

function getLicenceStatus() {
  var props = PropertiesService.getUserProperties();
  var key   = props.getProperty("licence_key") || "";
  var isPro = props.getProperty("pro_active") === "true";
  if (!key) {
    return { tier: "standard", status: "no_key", isPro: false, email: "" };
  }
  try {
    var res  = UrlFetchApp.fetch(WORKER_URL + "/validate", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      payload: JSON.stringify({ licence_key: key }),
      muteHttpExceptions: true,
    });
    var data = JSON.parse(res.getContentText());
    return {
      tier:   data.tier   || "standard",
      status: data.status || "unknown",
      isPro:  data.isPro  === true,
      email:  data.email  || "",
    };
  } catch (e) {
    return { tier: isPro ? "pro" : "standard", status: "unknown", isPro: isPro, email: "" };
  }
}

function showUpgradePrompt() {
  var html = HtmlService.createHtmlOutputFromFile("UpgradePrompt")
    .setWidth(400).setHeight(440).setTitle("Unlock Pro Features");
  SpreadsheetApp.getUi().showModalDialog(html, "Unlock Pro Features");
}

function showLicenceInfo() {
  var html = HtmlService.createHtmlOutputFromFile("LicenceInfo")
    .setWidth(360).setHeight(240).setTitle("Licence Details");
  SpreadsheetApp.getUi().showModalDialog(html, "Licence Details");
}

// ════════════════════════════════════════════════════════════
// WELCOME GUIDE
// ════════════════════════════════════════════════════════════
function showWelcomeGuide() {
  showSetupWizard();
}

function dismissWelcomeGuide(dontShow) {
  if (dontShow) {
    PropertiesService.getUserProperties().setProperty("hide_welcome", "true");
  }
}

function showWelcomeGuideReset() {
  PropertiesService.getUserProperties().deleteProperty("hide_welcome");
  showWelcomeGuide();
}

// ════════════════════════════════════════════════════════════
// ON EDIT — real-time triggers
// ════════════════════════════════════════════════════════════
function onEdit(e) {
  var sheet = e.range.getSheet();
  var name  = sheet.getName();
  var col   = e.range.getColumn();
  var row   = e.range.getRow();
  var val   = e.value;

  // Debt balance hits zero — only send if pro
  if (name === SH.DEBT && col === 4 && row >= 6 && row <= 15) {
    if (Number(val) === 0 && isProActive()) {
      var debtName = sheet.getRange(row, 3).getValue();
      if (debtName) triggerDebtCelebration(debtName);
    }
  }

  // Sub marked "No" — only send if pro
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
  var home = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.HOME);
  if (home) SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(home);
}

function navigateTo(sheetName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (sheet) SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
}

// ════════════════════════════════════════════════════════════
// SETUP WIZARD
// ════════════════════════════════════════════════════════════
function showSetupWizard() {
  var html = HtmlService.createHtmlOutputFromFile("SetupWizard")
    .setWidth(400).setHeight(620).setTitle("Trackulate Setup");
  SpreadsheetApp.getUi().showModalDialog(html, "Trackulate Setup");
}

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

  var name  = details.name;
  var email = details.email;

  sendEmail(email, "Welcome to Trackulate",
    "<p>Hi " + name + ",</p>" +
    "<p>Your <strong>Trackulate</strong> sheet is ready. Here's what's set up:</p>" +
    "<ul style='color:#2E1540;line-height:2.2;'>" +
    "<li>All sheet tabs and formulas — fully active</li>" +
    "<li>Setup wizard complete — update details any time in <strong>Settings</strong></li>" +
    "</ul>" +
    "<p style='margin-top:12px;'>To unlock <strong>Trackulate AI, PDF import, and email automations</strong>, upgrade to Pro at <a href='https://trackulate.co.uk/pro' style='color:#B892D4;'>trackulate.co.uk/pro</a>.</p>" +
    "<p style='color:#B892D4;font-size:12px;margin-top:8px;'>Your details are saved. You can update them any time in the <strong>Settings</strong> tab.</p>"
  );
  return "success";
}

// ════════════════════════════════════════════════════════════
// SETTINGS HELPERS
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

function updateAutomationSetting(key, val) {
  if (!isProActive()) return;
  var ws  = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.SETTINGS);
  var map = { budget: "D15", monthly: "D16", subs: "D17", debt: "D18", funds: "D19" };
  if (map[key]) ws.getRange(map[key]).setValue(val ? "Yes" : "No");
  rebuildTriggers();
}

function rebuildTriggers() {
  var s = getSettings();
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (["weeklyBudgetAlert", "monthlySummaryEmail", "checkSubscriptionRenewals",
         "checkMilestones", "onEdit"].indexOf(fn) > -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger("onEdit").forSpreadsheet(ss).onEdit().create();

  // Only create Pro automation triggers if licence is active
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
  return { used: used, remaining: Math.max(0, DAILY_TOKENS - used), total: DAILY_TOKENS };
}

function consumeToken() {
  var props = PropertiesService.getUserProperties();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var key   = "tokens_" + today;
  props.setProperty(key, String(parseInt(props.getProperty(key) || "0") + 1));
}

// ════════════════════════════════════════════════════════════
// FINANCIAL SNAPSHOT
// ════════════════════════════════════════════════════════════
function getFinancialSnapshot() {
  var s  = getSettings();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var d  = { name: s.name || "User", income: s.income || 0 };

  try { d.totalDebt  = ss.getSheetByName(SH.DEBT).getRange("D22").getValue(); }    catch(e) { d.totalDebt = 0; }
  try { d.extraPmt   = ss.getSheetByName(SH.DEBT).getRange("D26").getValue(); }    catch(e) { d.extraPmt = 0; }
  try { d.budgeted   = ss.getSheetByName(SH.BUDGET).getRange("E33").getValue(); }  catch(e) { d.budgeted = 0; }
  try { d.spent      = ss.getSheetByName(SH.BUDGET).getRange("F33").getValue(); }  catch(e) { d.spent = 0; }
  try {
    var a = ss.getSheetByName(SH.ASSETS).getRange("D14").getValue();
    var l = ss.getSheetByName(SH.ASSETS).getRange("D24").getValue();
    d.netWorth = a - l; d.assets = a; d.liabilities = l;
  } catch(e) { d.netWorth = 0; d.assets = 0; d.liabilities = 0; }
  try { d.fundsSaved  = ss.getSheetByName(SH.FUNDS).getRange("D24").getValue(); }  catch(e) { d.fundsSaved = 0; }
  try { d.fundsTarget = ss.getSheetByName(SH.FUNDS).getRange("E24").getValue(); }  catch(e) { d.fundsTarget = 0; }
  try { d.subCost     = ss.getSheetByName(SH.SUBS).getRange("F34").getValue(); }   catch(e) { d.subCost = 0; }
  try { d.unusedSubs  = ss.getSheetByName(SH.SUBS).getRange("I13:I32").getValues().filter(function(r) { return r[0] === "No"; }).length; } catch(e) { d.unusedSubs = 0; }
  try {
    d.debts = ss.getSheetByName(SH.DEBT).getRange("C12:F21").getValues()
      .filter(function(r) { return r[0]; })
      .map(function(r) { return { name: r[0], balance: r[1], rate: r[2], minPmt: r[3] }; });
  } catch(e) { d.debts = []; }
  try {
    d.budgetCats = ss.getSheetByName(SH.BUDGET).getRange("C13:F32").getValues()
      .filter(function(r) { return r[0] && r[2]; })
      .map(function(r) { return { name: r[0], budgeted: r[2], spent: r[3], pct: r[2] > 0 ? Math.round((r[3] / r[2]) * 100) : 0 }; });
  } catch(e) { d.budgetCats = []; }

  var f = function(n) { return "£" + Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
  var debtList   = d.debts.length ? d.debts.map(function(db) { return db.name + ": " + f(db.balance) + " at " + (db.rate * 100).toFixed(2) + "% APR, min " + f(db.minPmt) + "/mo"; }).join(" | ") : "No debts entered";
  var overBudget = d.budgetCats.filter(function(c) { return c.pct >= 85; }).map(function(c) { return c.name + " " + c.pct + "%"; }).join(", ") || "None";

  return "Name: " + d.name + " | Income: " + f(d.income) + "/mo | Debt: " + f(d.totalDebt) + " | Extra payment: " + f(d.extraPmt) + "/mo\n" +
    "Debts: " + debtList + "\n" +
    "Budget: " + f(d.spent) + " of " + f(d.budgeted) + " (" + (d.budgeted > 0 ? Math.round((d.spent / d.budgeted) * 100) : 0) + "%) | Near/over: " + overBudget + "\n" +
    "Net worth: " + f(d.netWorth) + " | Assets: " + f(d.assets) + " | Liabilities: " + f(d.liabilities) + "\n" +
    "Sinking funds: " + f(d.fundsSaved) + " of " + f(d.fundsTarget) + " | Subs: " + f(d.subCost) + "/mo | Unused subs: " + d.unusedSubs;
}

// ════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ════════════════════════════════════════════════════════════
function buildSystemPrompt(snapshot) {
  return "You are Trackulate, an AI financial coach built directly into this Google Sheets finance system. You know every tab, formula, and feature of the sheet intimately. You are warm, direct, and always give advice that references specific tabs and actions in the sheet.\n\n" +
    "IDENTITY: You are Trackulate — not Kai, not Claude, not an assistant. You are the intelligence inside the Trackulate finance system. When asked who you are, say you are Trackulate.\n\n" +
    "VOICE: Talk like a knowledgeable friend. Be specific about numbers. Always tie advice to a concrete action in the sheet. Use British English and £. Keep responses to 3-5 sentences unless asked to elaborate. End every response with one specific next step referencing a tab or action.\n\n" +
    "FORMATTING: Natural prose only. No markdown, no bullet points, no headers, no asterisks. When referencing a tab use its exact name in quotes. When referencing a cell action be specific.\n\n" +
    "SHEET KNOWLEDGE:\n" +
    "- \"Debt - Input\" rows 6-15: debt entries. Row 20 col D = extra monthly payment — the single biggest lever on payoff speed.\n" +
    "- \"Debt - Schedule\": 60-month avalanche projection. Shows exactly when each debt hits zero.\n" +
    "- \"Budget - Planner\" rows 11-28: categories with budgeted (col E) and spent (col F). Row 29 = totals. Unassigned KPI should always be £0.\n" +
    "- \"Budget - Transactions\": daily log. Rows 7+. Use the Control Centre categoriser to bulk-import bank statements.\n" +
    "- \"NetWorth - Tracker\": 12-month history. Update on the 1st of each month.\n" +
    "- \"NetWorth - Assets\" rows 7-13: assets, rows 18-23: liabilities. Auto-linked to debt sheet.\n" +
    "- \"Funds - Goals\" rows 13-22: col D = saved, col E = target, col F = monthly contribution, col H = months to target.\n" +
    "- \"Subs - Tracker\" rows 13-32: col I = \"Still Using?\" — setting to No triggers instant cancellation email.\n" +
    "- \"Settings\" row 6 = name, D7 = email, D8 = income, D9 = food budget, D11 = start date, D15-D19 = automation toggles.\n\n" +
    "KEY STRATEGIES TO SUGGEST:\n" +
    "1. DEBT AVALANCHE: Put every extra pound at the highest rate debt first. Increase \"Debt - Input\" row 20 — even £50 more per month dramatically changes the Schedule tab.\n" +
    "2. ZERO-BASED BUDGET: Every pound of income must be assigned. The Unassigned KPI in \"Budget - Planner\" should always read £0.\n" +
    "3. SINKING FUNDS: Divide annual costs by 12 and create a fund for each in \"Funds - Goals\". The target date calculates automatically.\n" +
    "4. SUBSCRIPTION AUDIT: \"Subs - Tracker\" shows the true annual cost. Mark anything unused as No in col I to get a cancellation reminder instantly.\n" +
    "5. NET WORTH TRACKING: Update \"NetWorth - Assets\" on the 1st every month before archiving. Net worth rising is the most motivating metric.\n" +
    "6. MONTHLY ARCHIVE: Use Actions → Archive This Month on the 1st. It snapshots everything and clears the transaction log.\n\n" +
    "CURRENT SNAPSHOT:\n" + snapshot + "\n\n" +
    "Use these numbers. Reference them. Ask follow-up questions to understand the person better before giving sweeping advice.";
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
// SEND CHAT MESSAGE (Pro only)
// ════════════════════════════════════════════════════════════
function sendChatMessage(userMessage) {
  if (!isProActive()) throw new Error("Pro licence required. Upgrade at trackulate.co.uk/pro.");
  if (getTokenUsage().remaining <= 0) throw new Error("No credits remaining today. Resets at midnight.");

  var lc = userMessage.toLowerCase();
  if (lc.indexOf("categorise") > -1 || lc.indexOf("categorize") > -1 || lc.indexOf("import") > -1 || lc.indexOf("bank statement") > -1) {
    var pasted = getHomePastedTransactions();
    if (pasted) {
      var result = categoriseTransactionsFromSidebar(pasted);
      consumeToken();
      return { reply: "Done! " + result + " Open Budget - Transactions to review them. I have also cleared your import area on the Home sheet.", tokens: getTokenUsage() };
    }
  }

  var snapshot = getFinancialSnapshot();
  var system   = buildSystemPrompt(snapshot);
  var history  = getChatHistory();
  history.push({ role: "user", content: userMessage });
  var result   = callWorker({ prompt: userMessage, feature: "chat", history: history, system: system });
  history.push({ role: "assistant", content: result });
  saveChatHistory(history);
  consumeToken();
  return { reply: result, tokens: getTokenUsage() };
}

// ════════════════════════════════════════════════════════════
// CONTROL CENTRE DATA
// ════════════════════════════════════════════════════════════
function getControlCentreData() {
  var s      = getSettings();
  var tokens = getTokenUsage();
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
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

  var props       = PropertiesService.getUserProperties();
  var licenceKey  = props.getProperty("licence_key") || "";
  var isPro       = isProActive();
  var licenceInfo = { isPro: isPro, tier: isPro ? "pro" : "standard", hasKey: licenceKey !== "" };

  return {
    name: s.name || "there",
    tokens: tokens,
    stats: {
      totalDebt: totalDebt, budgeted: budgeted, spent: spent,
      netWorth: netWorth, subCost: subCost, unusedSubs: unusedSubs,
      budgetPct: budgeted > 0 ? Math.round((spent / budgeted) * 100) : 0,
    },
    automations: {
      budget: s.alertBudget, monthly: s.alertMonthly, subs: s.alertSubs,
      debt: s.alertDebt, funds: s.alertFunds,
    },
    history:     getChatHistory(),
    hasHistory:  getChatHistory().length > 0,
    licenceInfo: licenceInfo,
  };
}

// ════════════════════════════════════════════════════════════
// TRANSACTION CATEGORISER (Pro only)
// ════════════════════════════════════════════════════════════
function getHomePastedTransactions() {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var home = ss.getSheetByName(SH.HOME);
  if (!home) return "";
  var vals  = home.getRange("B1:B60").getValues();
  var lines = [];
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i][0];
    if (v && typeof v === "string" && v.trim().length > 3) {
      if (v.indexOf("Paste") === -1 && v.indexOf("IMPORT") === -1 && v.indexOf("After pasting") === -1) {
        lines.push(v.trim());
      }
    }
  }
  return lines.join("\n");
}

function clearHomePastedTransactions() {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var home = ss.getSheetByName(SH.HOME);
  if (!home) return;
  var vals = home.getRange("B1:B60").getValues();
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i][0];
    if (v && typeof v === "string" && v.trim().length > 3) {
      if (v.indexOf("Paste") === -1 && v.indexOf("IMPORT") === -1 && v.indexOf("After pasting") === -1) {
        home.getRange(i + 1, 2).clearContent();
      }
    }
  }
}

function categoriseTransactionsFromSidebar(raw) {
  if (!isProActive()) throw new Error("Pro licence required.");
  if (!raw || !raw.trim()) throw new Error("No transactions found.");
  if (getTokenUsage().remaining <= 0) throw new Error("No credits remaining today.");

  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var bt   = ss.getSheetByName(SH.TRANSACTIONS);
  var cats = ["Housing", "Utilities", "Insurance", "Phone", "Subscriptions", "Transport",
              "Food & Groceries", "Eating Out", "Clothing", "Personal Care", "Entertainment",
              "Household", "Gym / Sport", "Gifts", "Savings", "Emergency Fund", "Investments",
              "Income", "Other"];
  var catStr = cats.join(", ");

  var CHUNK  = 4000;
  var chunks = [];
  var text   = raw.trim();
  for (var i = 0; i < text.length; i += CHUNK) {
    chunks.push(text.substring(i, i + CHUNK));
  }

  var allTxs = [];

  for (var ci = 0; ci < chunks.length; ci++) {
    var chunk = chunks[ci];
    if (!chunk.trim()) continue;

    var prompt = "Extract every bank transaction from the text below. " +
      "Return ONLY a JSON array, nothing else, no markdown, no explanation. " +
      "Format each item exactly as: {\"date\":\"DD Mon YYYY\",\"description\":\"merchant\",\"amount\":0.00,\"type\":\"Expense or Income or Savings\",\"category\":\"cat\"} " +
      "Use positive amounts only. Categories: " + catStr + ". " +
      "Text to process: " + chunk;

    var result = callWorker({ prompt: prompt, feature: "categorise" });

    var clean  = result.replace(/```json/gi, "").replace(/```/g, "").trim();
    var jStart = clean.indexOf("[");
    if (jStart === -1) continue;

    var jStr = clean.substring(jStart);

    var lastClose   = jStr.lastIndexOf("}");
    var lastBracket = jStr.lastIndexOf("]");

    if (lastBracket < lastClose) {
      jStr = jStr.substring(0, lastClose + 1) + "]";
    } else {
      jStr = jStr.substring(0, lastBracket + 1);
    }

    try {
      var txs = JSON.parse(jStr);
      if (Array.isArray(txs)) {
        for (var t = 0; t < txs.length; t++) { allTxs.push(txs[t]); }
      }
    } catch(e) {
      var objStart = jStr.indexOf("{");
      while (objStart > -1) {
        var objEnd = jStr.indexOf("}", objStart);
        if (objEnd === -1) break;
        try {
          var obj = JSON.parse(jStr.substring(objStart, objEnd + 1));
          if (obj.description) allTxs.push(obj);
        } catch(e2) {}
        objStart = jStr.indexOf("{", objEnd + 1);
      }
    }
  }

  consumeToken();

  if (allTxs.length === 0) {
    throw new Error("No transactions could be extracted. The PDF may be scanned or password protected.");
  }

  var existingVals = bt.getRange("D9:D300").getValues();
  var writeRow = 9;
  for (var k = 0; k < existingVals.length; k++) {
    if (!existingVals[k][0]) { writeRow = 9 + k; break; }
  }

  for (var j = 0; j < allTxs.length; j++) {
    var tx   = allTxs[j];
    var r    = writeRow + j;
    var amt  = Math.abs(Number(tx.amount) || 0);
    var date = tx.date || new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    bt.getRange(r, 1).setValue(writeRow - 8 + j);
    bt.getRange(r, 3).setValue(date);
    bt.getRange(r, 4).setValue(tx.description || "");
    bt.getRange(r, 5).setValue(amt);
    bt.getRange(r, 6).setValue(tx.type || "Expense");
    bt.getRange(r, 7).setValue(tx.category || "Other");
  }

  SpreadsheetApp.flush();
  return allTxs.length + " transactions logged to Budget - Transactions.";
}

// ════════════════════════════════════════════════════════════
// TRANSACTION LOGGER SIDEBAR (Pro only)
// ════════════════════════════════════════════════════════════
function showTransactionInput() {
  if (!isProActive()) { showUpgradePrompt(); return; }
  var html = HtmlService.createHtmlOutputFromFile("TransactionInput")
    .setTitle("Log Transaction").setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

function parseAndLogTransaction(text) {
  if (!isProActive()) throw new Error("Pro licence required.");
  if (getTokenUsage().remaining <= 0) throw new Error("No credits remaining today.");
  var cats   = ["Housing", "Utilities", "Insurance", "Phone", "Subscriptions", "Transport", "Food & Groceries", "Eating Out", "Clothing", "Personal Care", "Entertainment", "Household", "Gym / Sport", "Gifts", "Savings", "Emergency Fund", "Investments", "Income", "Other"];
  var prompt = "Parse this transaction into JSON. Return ONLY valid JSON, nothing else:\n{\"date\":\"DD Mon YYYY\",\"description\":\"merchant\",\"amount\":0.00,\"type\":\"Expense or Income or Savings\",\"category\":\"one of the categories\"}\nCategories: " +
    cats.join(", ") + "\nToday: " + new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) + "\nTransaction: \"" + text + "\"";
  var result = callWorker({ prompt: prompt, feature: "parse_transaction" });
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
  } catch(e) { return "Could not parse. Try: \"spent £XX at [place] on [date]\""; }
}

// ════════════════════════════════════════════════════════════
// AUTOMATIONS (Pro only — each checks isProActive() first)
// ════════════════════════════════════════════════════════════
function weeklyBudgetAlert() {
  if (!isProActive()) return;
  var s = getSettings();
  if (!s.alertBudget || !s.email) return;
  var bp              = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.BUDGET);
  var totalBudgeted   = bp.getRange("E33").getValue();
  var totalSpent      = bp.getRange("F33").getValue();
  var pct             = totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0;
  if (pct < 70) return;
  var status = pct >= 100 ? "Over Budget" : pct >= 90 ? "Almost Over Budget" : "Getting Close";
  var color  = pct >= 100 ? "#B84040" : "#B87040";
  var rows   = "";
  bp.getRange("C11:F28").getValues().forEach(function(row) {
    if (!row[0] || !row[2]) return;
    var p    = Math.round((row[3] / row[2]) * 100);
    var flag = p >= 100 ? " 🔴" : p >= 85 ? " 🟡" : "";
    rows += "<tr style=\"background:" + (rows.split("<tr").length % 2 === 0 ? "#F8F5FA" : "white") + ";\">" +
      "<td style=\"padding:7px 10px;color:#2E1540;\">" + row[0] + "</td>" +
      "<td style=\"padding:7px 10px;text-align:right;\">" + formatGBP(row[2]) + "</td>" +
      "<td style=\"padding:7px 10px;text-align:right;\">" + formatGBP(row[3]) + "</td>" +
      "<td style=\"padding:7px 10px;text-align:right;font-weight:bold;color:" + (p >= 100 ? "#B84040" : "#2E7D5A") + ";\">" + p + "%" + flag + "</td></tr>";
  });
  sendEmail(s.email, "Budget Alert — " + status + " (" + Math.round(pct) + "% used)",
    "<p>Hi " + s.name + ", your budget is <strong style=\"color:" + color + ";\">" + status + "</strong>.</p>" +
    "<table style=\"width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;\">" +
    "<tr style=\"background:#2E1540;\"><th style=\"padding:8px 10px;color:#F8F5FA;text-align:left;\">Category</th>" +
    "<th style=\"padding:8px 10px;color:#F8F5FA;text-align:right;\">Budget</th>" +
    "<th style=\"padding:8px 10px;color:#F8F5FA;text-align:right;\">Spent</th>" +
    "<th style=\"padding:8px 10px;color:#F8F5FA;text-align:right;\">Used</th></tr>" +
    rows + "</table>" +
    "<p style=\"color:#B892D4;font-size:12px;\">Remaining: <strong style=\"color:#2E1540;\">" + formatGBP(totalBudgeted - totalSpent) + "</strong></p>"
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
    ["Net Worth",            formatGBP(netWorth),        netWorth >= 0 ? "#2E7D5A" : "#B84040"],
    ["Total Debt",           formatGBP(totalDebt),       "#B84040"],
    ["Monthly Budget",       formatGBP(budgeted),        "#2E1540"],
    ["Total Spent",          formatGBP(spent),           spent > budgeted ? "#B84040" : "#2E7D5A"],
    ["Budget Remaining",     formatGBP(budgeted - spent),(budgeted - spent) >= 0 ? "#2E7D5A" : "#B84040"],
    ["Sinking Funds Saved",  formatGBP(saved),           "#2E7D5A"],
    ["Sinking Funds Target", formatGBP(target),          "#2E1540"],
    ["Monthly Subscriptions",formatGBP(subCost),         "#2E1540"],
  ];
  var rows = rowData.map(function(r, i) {
    return "<tr style=\"background:" + (i % 2 === 0 ? "#F8F5FA" : "white") + ";\">" +
      "<td style=\"padding:9px 12px;color:#2E1540;\">" + r[0] + "</td>" +
      "<td style=\"padding:9px 12px;text-align:right;font-weight:bold;color:" + r[2] + ";\">" + r[1] + "</td></tr>";
  }).join("");
  sendEmail(s.email, "Your Monthly Finance Summary — " + month,
    "<p>Hi " + s.name + ", here is your financial snapshot for " + month + ".</p>" +
    "<table style=\"width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;\">" + rows + "</table>" +
    "<p style=\"color:#B892D4;font-size:12px;\">Open Trackulate and chat with Trackulate AI for a deeper personalised analysis.</p>"
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
      "<td style=\"padding:8px 10px;color:#2E1540;font-weight:bold;\">" + r[0] + "</td>" +
      "<td style=\"padding:8px 10px;color:#2E1540;\">" + r[1] + "</td>" +
      "<td style=\"padding:8px 10px;text-align:right;color:#2E1540;\">" + formatGBP(r[3]) + "/mo</td>" +
      "<td style=\"padding:8px 10px;color:#B892D4;\">" + r[5] + "</td></tr>";
  }).join("");
  sendEmail(s.email,
    upcoming.length + " Subscription" + (upcoming.length > 1 ? "s" : "") + " Renewing This Week",
    "<p>Hi " + s.name + ", these renew in the next 7 days:</p>" +
    "<table style=\"width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;\">" +
    "<tr style=\"background:#2E1540;\"><th style=\"padding:8px 10px;color:#F8F5FA;text-align:left;\">Service</th>" +
    "<th style=\"padding:8px 10px;color:#F8F5FA;text-align:left;\">Category</th>" +
    "<th style=\"padding:8px 10px;color:#F8F5FA;text-align:right;\">Cost</th>" +
    "<th style=\"padding:8px 10px;color:#F8F5FA;text-align:left;\">Date</th></tr>" +
    rows + "</table>" +
    "<p style=\"color:#B892D4;font-size:12px;\">Check <strong>Subs - Tracker</strong> to cancel anything you no longer use.</p>"
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
      var key = "fund_done_" + row[0];
      if (props.getProperty(key)) return;
      sendEmail(s.email, "Savings Goal Reached — " + row[0],
        "<p>Hi " + s.name + ",</p>" +
        "<p style=\"font-size:18px;color:#2E7D5A;font-weight:bold;\">You hit your " + row[0] + " goal!</p>" +
        "<p>You saved " + formatGBP(row[1]) + " towards your target of " + formatGBP(row[2]) + ". Head to <strong>Funds - Goals</strong> to set your next target.</p>"
      );
      props.setProperty(key, "true");
    });
  }
}

function triggerDebtCelebration(debtName) {
  if (!isProActive()) return;
  var s     = getSettings();
  var props = PropertiesService.getScriptProperties();
  var key   = "debt_done_" + debtName;
  if (props.getProperty(key)) return;
  sendEmail(s.email, "Debt Cleared — " + debtName,
    "<p>Hi " + s.name + ",</p>" +
    "<p style=\"font-size:18px;color:#2E7D5A;font-weight:bold;\">You cleared " + debtName + "!</p>" +
    "<p>Every debt you pay off frees up more monthly income. Redirect that minimum payment to your next debt in <strong>Debt - Input</strong> to keep the momentum going.</p>"
  );
  props.setProperty(key, "true");
}

function triggerCancellationReminder(subName, cost) {
  if (!isProActive()) return;
  var s = getSettings();
  sendEmail(s.email, "Reminder: Cancel " + subName,
    "<p>Hi " + s.name + ",</p>" +
    "<p>You marked <strong>" + subName + "</strong> as no longer in use in <strong>Subs - Tracker</strong>.</p>" +
    "<p>This costs <strong>" + formatGBP(cost) + "/month</strong> — that is <strong>" + formatGBP(cost * 12) + "/year</strong>. Head to the provider to cancel, then update the Status column to Cancelled.</p>"
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
    ["Archive — " + label, ""],
    ["Snapshot: " + new Date().toLocaleDateString("en-GB"), ""],
    [],
    ["Metric", "Value"],
    ["Net Worth",   formatGBP(a - l)],
    ["Total Debt",  formatGBP(totalDebt)],
    ["Budget",      formatGBP(budgeted)],
    ["Spent",       formatGBP(spent)],
    ["Remaining",   formatGBP(budgeted - spent)],
    ["Sinking Funds", formatGBP(saved)],
    [],
    ["BUDGET BREAKDOWN", "", "", ""],
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

// ════════════════════════════════════════════════════════════
// CONTROL CENTRE SIDEBAR
// ════════════════════════════════════════════════════════════
function showControlCentre() {
  var html = HtmlService.createHtmlOutputFromFile("ControlCentre")
    .setTitle("Control Centre").setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ════════════════════════════════════════════════════════════
// WORKER CALL — includes licence_key on every request
// ════════════════════════════════════════════════════════════
function callWorker(payload) {
  if (!WORKER_URL || WORKER_URL.indexOf("your-worker") > -1) return "Trackulate AI is not yet configured.";
  var props  = PropertiesService.getUserProperties();
  var licKey = props.getProperty("licence_key") || "";
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var sheetId = ss ? ss.getId() : "";

  var fullPayload = JSON.parse(JSON.stringify(payload));
  if (licKey) fullPayload.licence_key = licKey;
  if (sheetId) fullPayload.sheet_id   = sheetId;

  try {
    var res  = UrlFetchApp.fetch(WORKER_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      payload: JSON.stringify(fullPayload),
      muteHttpExceptions: true,
    });
    var data = JSON.parse(res.getContentText());
    if (res.getResponseCode() === 402) {
      throw new Error("Pro licence required. Upgrade at trackulate.co.uk/pro.");
    }
    if (res.getResponseCode() === 403) {
      throw new Error(data.message || "Licence required.");
    }
    return data.result || data.error || "No response received.";
  } catch(e) {
    return "Something went wrong: " + e.message;
  }
}

// ════════════════════════════════════════════════════════════
// SHARED HELPERS
// ════════════════════════════════════════════════════════════
function sendEmail(to, subject, body) {
  if (!to || to.indexOf("@") === -1) return;
  MailApp.sendEmail({
    to:       to,
    subject:  subject,
    htmlBody: "<div style=\"font-family:Arial,sans-serif;max-width:600px;margin:0 auto;\">" +
      "<div style=\"background:#2E1540;padding:24px 32px;border-radius:8px 8px 0 0;\">" +
      "<p style=\"color:#B892D4;font-size:10px;letter-spacing:2px;text-transform:uppercase;margin:0 0 6px;\">Trackulate</p>" +
      "<h1 style=\"color:#F8F5FA;font-size:18px;margin:0;font-weight:bold;\">" + subject + "</h1>" +
      "</div>" +
      "<div style=\"background:#F8F5FA;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #E0CFF8;\">" +
      body +
      "<hr style=\"border:none;border-top:1px solid #E0CFF8;margin:24px 0;\">" +
      "<p style=\"color:#B892D4;font-size:10px;\">Trackulate · trackulate.co.uk · Track. Calculate. Automate.</p>" +
      "</div></div>",
  });
}

function formatGBP(n) {
  return "£" + Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
