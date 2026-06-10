/**
 * Trackulate — Etsy Fulfilment
 * Daily trigger: checks new Etsy orders and fires Worker /webhooks/etsy
 * to generate and deliver Pro licence keys.
 *
 * Set up: Triggers → checkNewEtsyOrders → Time-driven → Day timer
 */

var ETSY_FULFILLED_KEY = "etsy_fulfilled_ids";

/**
 * Called by daily time-based trigger.
 * Fetches recent Etsy receipts and processes any that haven't been fulfilled.
 */
function checkNewEtsyOrders() {
  var adminSecret = PropertiesService.getScriptProperties().getProperty("admin_secret") || "";
  if (!adminSecret) {
    Logger.log("EtsyFulfillment: admin_secret not set in ScriptProperties");
    return;
  }

  var receipts = fetchEtsyReceipts();
  if (!receipts || !receipts.length) {
    Logger.log("EtsyFulfillment: no receipts found");
    return;
  }

  var fulfilledIds = getFulfilledIds();

  for (var i = 0; i < receipts.length; i++) {
    var receipt = receipts[i];
    var receiptId = String(receipt.receipt_id);

    if (fulfilledIds[receiptId]) {
      Logger.log("EtsyFulfillment: skipping already-fulfilled receipt " + receiptId);
      continue;
    }

    var result = fulfillReceipt(receipt, adminSecret);
    if (result && result.received) {
      fulfilledIds[receiptId] = new Date().toISOString();
      Logger.log("EtsyFulfillment: fulfilled receipt " + receiptId + " → " + result.licence_key);
    } else {
      Logger.log("EtsyFulfillment: failed receipt " + receiptId + " → " + JSON.stringify(result));
    }
  }

  saveFulfilledIds(fulfilledIds);
}

/**
 * Fetch recent receipts from Etsy Open API via Worker.
 * The Worker holds ETSY_API_KEY and ETSY_SHOP_ID as secrets.
 */
function fetchEtsyReceipts() {
  var adminSecret = PropertiesService.getScriptProperties().getProperty("admin_secret") || "";

  var options = {
    method: "get",
    headers: { "X-Admin-Secret": adminSecret },
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(WORKER_URL + "/admin/etsy-receipts", options);
    if (response.getResponseCode() !== 200) return [];
    var data = JSON.parse(response.getContentText());
    return data.receipts || [];
  } catch (e) {
    Logger.log("EtsyFulfillment: fetchEtsyReceipts error: " + e.message);
    return [];
  }
}

/**
 * Send a single receipt to the Worker for fulfilment.
 */
function fulfillReceipt(receipt, adminSecret) {
  var email     = receipt.buyer_email || receipt.email || "";
  var buyerName = receipt.name || receipt.buyer_name || "";
  var receiptId = receipt.receipt_id;

  if (!email || !receiptId) return null;

  var payload = JSON.stringify({
    receipt_id: receiptId,
    email:      email,
    buyer_name: buyerName
  });

  var options = {
    method: "post",
    contentType: "application/json",
    headers: { "X-Admin-Secret": adminSecret },
    payload: payload,
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(WORKER_URL + "/webhooks/etsy", options);
    return JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log("EtsyFulfillment: fulfillReceipt error: " + e.message);
    return null;
  }
}

/**
 * Load the set of already-fulfilled receipt IDs from ScriptProperties.
 */
function getFulfilledIds() {
  var raw = PropertiesService.getScriptProperties().getProperty(ETSY_FULFILLED_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

/**
 * Persist fulfilled receipt IDs back to ScriptProperties.
 * ScriptProperties values are limited to 9KB — prune entries older than 90 days if needed.
 */
function saveFulfilledIds(ids) {
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  var pruned = {};
  var keys = Object.keys(ids);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var ts = ids[k];
    if (ts && new Date(ts) > cutoff) {
      pruned[k] = ts;
    }
  }

  PropertiesService.getScriptProperties().setProperty(ETSY_FULFILLED_KEY, JSON.stringify(pruned));
}
