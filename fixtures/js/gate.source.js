/* CrawlLab fixture: obfuscated gate.
   The analyzer studies the minified form of this file.
   It is local lab code. It does not bypass site protections.
*/
(function () {
  var S = ["web", "driver", "user", "Agent", "plugins", "language", "innerWidth", "innerHeight", "chrome", "webgl", "lab-unlock-7f3a", "FULL_PAYLOAD_ALPHA", "PARTIAL_PAYLOAD_BETA", "TEASER_ONLY", "gate-result", "data-mode", "data-crawllab-challenge"];
  function cat(a, b) { return a + b; }
  var wd = navigator[cat(S[0], S[1])] === true;
  var ua = navigator[cat(S[2], S[3])];
  var plugs = navigator[S[4]] ? navigator[S[4]].length : -1;
  var lang = navigator[S[5]];
  var vw = window[S[6]];
  var vh = window[S[7]];
  var hasChrome = typeof window[S[8]] !== "undefined";
  var gl = "none";
  try {
    var c = document.createElement("canvas");
    var g = c.getContext(S[9]);
    if (g) { gl = String(g.getParameter(g.VENDOR)); }
  } catch (e) { gl = "err"; }
  var token = window.__LAB_UNLOCK__;
  var mode = "teaser";
  if (token === S[10] && wd === false) { mode = "full"; }
  else if (token === S[10] && wd === true) { mode = "partial"; }
  else { mode = "teaser"; }
  function paint() {
    var el = document.getElementById(S[14]);
    if (!el) return;
    el.setAttribute(S[15], mode);
    if (mode !== "full") {
      el.setAttribute(S[16], "gate");
      el.setAttribute("data-reason", mode === "partial" ? "unlock token accepted but navigator.webdriver is true" : "unlock token missing");
    }
    el.textContent = mode === "full" ? S[11] : mode === "partial" ? S[12] : S[13];
    window.__GATE_TRACE__ = { mode: mode, wd: wd, ua: ua, plugs: plugs, lang: lang, vw: vw, vh: vh, hasChrome: hasChrome, gl: gl, tokenPresent: typeof token === "string" };
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", paint); }
  else { paint(); }
})();
