// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Build a URL that works on a HOSTED ComfyUI, not just on localhost.  ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// NEVER write a root-relative API URL (`/view?...`, `fetch("/pixaroma/api/x")`)
// again. Route it through here.
//
// WHY (measured on a cloud platform, 2026-08-04). Save Mp4's in-node player was
// black there and its play button did nothing, while VideoHelperSuite's preview
// worked in the same graph. The console said exactly why:
//
//     GET https://<host>/view?filename=Video_00001_....mp4   401 (Unauthorized)
//
// The filename was correct, so our JS had the data and had built the player. The
// URL was the problem: `/view?...` resolves against the PAGE ORIGIN, and on that
// host the page origin is their web app, not ComfyUI's API.
//
// The trap that makes this invisible, and that cost a wrong diagnosis mid-session:
// the host serves ComfyUI's FRONTEND FILES at the root, so `/scripts/app.js` and
// our own modules load perfectly. "Our JS runs, therefore root paths reach
// ComfyUI" is FALSE. Static files and the API are served by different things.
// Locally they are the same server, which is why nothing shows up in testing.
//
// `api.apiURL(route)` is ComfyUI's own helper and prefixes whatever base the
// deployment is actually using (`api_base + "/api" + route`). VideoHelperSuite
// routes every URL through it, including its OWN custom routes (`/vhs/viewvideo`,
// `/vhs/getpath`), and it works on that host. That is the evidence this is right
// for our routes too, not just for core's.
//
// Locally this changes `/x` to `/api/x`, which is a no-op in practice: ComfyUI
// registers an `/api`-prefixed alias for every non-static route (see
// `server.py`, "Prefix every route with /api"). All 55 of our routes are
// decorator routes, so every one of them has an alias. Verified by fetching each
// route family both ways and diffing the status codes.

import { api } from "/scripts/api.js";

/**
 * Absolute-safe URL for a ComfyUI or Pixaroma route.
 * @param {string} route e.g. "/view?filename=x.png&type=output" or "/pixaroma/api/version"
 * @returns {string} the same route, prefixed for this deployment
 */
export function pixApiUrl(route) {
  try {
    if (typeof api?.apiURL === "function") return api.apiURL(route);
  } catch (_e) {
    /* fall through - a broken helper must not take the feature down with it */
  }
  return route; // degrade to the old behaviour rather than produce nothing
}

/**
 * Absolute-safe URL for one of OUR bundled assets (icons, fonts, sounds, models).
 *
 * @param {string} tail path BELOW assets, e.g. "icons/ui/play.svg". No leading /.
 * @returns {string} a complete, token-bearing url
 *
 * Two things this exists to get right, BOTH of which were shipped wrong once:
 *
 * 1. THE FILENAME GOES IN THE QUERY STRING, and the PATH stays extensionless.
 *    A hosted ComfyUI's gateway routes by FILE EXTENSION, not by path: a url
 *    whose PATH ends .svg / .png / .ttf / .mp3 is answered by their own static
 *    file server and never reaches ComfyUI, wherever it sits in the path. Moving
 *    assets to a different path does NOT help - that was tried and measured.
 *    Extensions they forward: .json, .glb, .mjs, and none at all. Putting the
 *    name in the query keeps the path extensionless, which IS forwarded
 *    (verified: "/pixaroma/api/version?name=icons/ui/play.svg" answers 200).
 *    server_routes.py serves this at /pixaroma/api/asset and still serves the
 *    original /pixaroma/assets/... paths for anything that references them.
 *
 * 2. NEVER PRE-BUILD A BASE. The host appends its auth token as a QUERY STRING
 *    (?Rh-Comfy-Auth=...), so a "base" that is wrapped and then concatenated puts
 *    the token in the MIDDLE of the url and the request dies:
 *
 *        const B = pixApiUrl("/pixaroma/api/assets/icons/ui/");   // WRONG
 *        B + "play.svg"   ->  ".../icons/ui/?Rh-Comfy-Auth=xxxplay.svg"
 *
 *    That is what broke the 3D editor's three.js import. Always hand the COMPLETE
 *    tail to this function:  pixAsset("icons/ui/" + name).
 *
 * In CSS, call it inside the template literal:
 *     `-webkit-mask: url(${pixAsset("icons/ui/play.svg")}) center/contain;`
 * and note the argument must be a TEMPLATE literal too if it contains ${...} -
 * "${x}" inside double quotes is literal text, not interpolation, and fails
 * silently with no syntax error anywhere.
 */
export function pixAsset(tail) {
  const rel = String(tail).replace(/^\/+/, "");
  return pixApiUrl("/pixaroma/api/asset?path=" + encodeURIComponent(rel));
}
