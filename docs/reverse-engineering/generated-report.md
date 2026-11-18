# Generated gate-script report

This file is produced by `npm run analyze:gate`. It is the output of the static analysis and the node:vm simulation. It is not a browser evasion procedure.

Minified size: 1408 bytes.

## Constant folding

Concatenators: cat.
Folded strings: webdriver, userAgent.

## String table

Table `S`:

- [0] web
- [1] driver
- [2] user
- [3] Agent
- [4] plugins
- [5] language
- [6] innerWidth
- [7] innerHeight
- [8] chrome
- [9] webgl
- [10] lab-unlock-7f3a
- [11] FULL_PAYLOAD_ALPHA
- [12] PARTIAL_PAYLOAD_BETA
- [13] TEASER_ONLY
- [14] gate-result
- [15] data-mode
- [16] data-crawllab-challenge

## Browser-shaped accesses

- `navigator["webdriver"]`
- `navigator["userAgent"]`
- `navigator["plugins"]`
- `navigator["plugins"].length`
- `navigator["language"]`
- `window["innerWidth"]`
- `window["innerHeight"]`
- `window["chrome"]`
- `document.createElement`
- `c.getContext`
- `g.getParameter`
- `window.__LAB_UNLOCK__`
- `document.getElementById`
- `window.__GATE_TRACE__`
- `document.readyState`
- `document.addEventListener`
- `webdriver`
- `userAgent`
- `canvas`
- `unlock token accepted but navigator.webdriver is true`

## Conditions (sliced from the minified source)

- `if(g){gl=String(g.getParameter(g.VENDOR));}`
- `if(token===S[10]&&wd===false){mode="full";}else if(token===S[10]&&wd===true){mode="partial";}else{mode="teaser";}`
- `if(token===S[10]&&wd===true){mode="partial";}else{mode="teaser";}`
- `if(!el)return;`
- `if(mode!=="full"){el.setAttribute(S[16],"gate");el.setAttribute("data-reason",mode==="partial"?"unlock token accepted but navigator.webdriver is true":"unlock token missing");}`
- `if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",paint);}else{paint();}`

## Sandbox matrix

The simulator mocks `navigator` inside `node:vm`. It does not launch Chromium and does not change `navigator.webdriver` in a real browser.

| webdriver | token | mode | text |
| --- | --- | --- | --- |
| true | no | teaser | TEASER_ONLY |
| false | no | teaser | TEASER_ONLY |
| absent | no | teaser | TEASER_ONLY |
| true | yes | partial | PARTIAL_PAYLOAD_BETA |
| false | yes | full | FULL_PAYLOAD_ALPHA |
| absent | yes | full | FULL_PAYLOAD_ALPHA |

## Limits

- Constant folding only evaluates string tables indexed by numeric literals and functions whose body is `return a + b`.
- It does not execute the script and does not model the DOM.
- Sandbox simulation is a separate step and uses a mocked navigator. It does not change Chromium.

## Minified input

```js
(function(){var S=["web","driver","user","Agent","plugins","language","innerWidth","innerHeight","chrome","webgl","lab-unlock-7f3a","FULL_PAYLOAD_ALPHA","PARTIAL_PAYLOAD_BETA","TEASER_ONLY","gate-result","data-mode","data-crawllab-challenge"];function cat(a,b){return a+b;}var wd=navigator[cat(S[0],S[1])]===true;var ua=navigator[cat(S[2],S[3])];var plugs=navigator[S[4]]?navigator[S[4]].length:-1;var lang=navigator[S[5]];var vw=window[S[6]];var vh=window[S[7]];var hasChrome=typeof window[S[8]]!=="undefined";var gl="none";try{var c=document.createElement("canvas");var g=c.getContext(S[9]);if(g){gl=String(g.getParameter(g.VENDOR));}}catch(e){gl="err";}var token=window.__LAB_UNLOCK__;var mode="teaser";if(token===S[10]&&wd===false){mode="full";}else if(token===S[10]&&wd===true){mode="partial";}else{mode="teaser";}function paint(){var el=document.getElementById(S[14]);if(!el)return;el.setAttribute(S[15],mode);if(mode!=="full"){el.setAttribute(S[16],"gate");el.setAttribute("data-reason",mode==="partial"?"unlock token accepted but navigator.webdriver is true":"unlock token missing");}el.textContent=mode==="full"?S[11]:mode==="partial"?S[12]:S[13];window.__GATE_TRACE__={mode:mode,wd:wd,ua:ua,plugs:plugs,lang:lang,vw:vw,vh:vh,hasChrome:hasChrome,gl:gl,tokenPresent:typeof token==="string"};}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",paint);}else{paint();}})();
```
