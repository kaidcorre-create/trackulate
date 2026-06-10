/**
 * Trackulate — Sidebar Loader
 * Fetches sidebar HTML from Cloudflare Worker (which proxies Cloudflare Pages)
 */

var VERSION = "2.0";
var WORKER_URL = "https://trackulate.kai-d-corre-ea2.workers.dev";

/**
 * Fetch a sidebar HTML file from Cloudflare Pages via the Worker.
 * @param {string} file - One of: ControlCentre, SetupWizard, TransactionInput, UpgradePrompt, LicenceInfo
 * @returns {string} HTML string ready for HtmlService.createHtmlOutput()
 */
function loadSidebar(file) {
  var payload = JSON.stringify({ file: file, version: VERSION });

  var options = {
    method: "post",
    contentType: "application/json",
    payload: payload,
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(WORKER_URL + "/sidebar", options);
    var code = response.getResponseCode();

    if (code !== 200) {
      return buildFallbackHtml("Could not load " + file + " (HTTP " + code + ")");
    }

    var data = JSON.parse(response.getContentText());
    if (data.html) {
      return data.html;
    }
    return buildFallbackHtml("No HTML returned for " + file);

  } catch (e) {
    return buildFallbackHtml("Connection error: " + e.message);
  }
}

/**
 * Minimal fallback shown when the Worker or Pages is unreachable.
 */
function buildFallbackHtml(message) {
  return "<html><body style=\"font-family:sans-serif;padding:20px;color:#2E1540\">" +
    "<h3 style=\"color:#B892D4\">Trackulate</h3>" +
    "<p style=\"color:#c00\">" + message + "</p>" +
    "<p>Check your internet connection and try again.</p>" +
    "<p style=\"font-size:11px;color:#888\">v" + VERSION + "</p>" +
    "</body></html>";
}
