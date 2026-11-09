// The page: find the address, ask each Metro layer what's nearby, show it.
import {
  DIGEST, RADII, addressWhere, distanceLabel, longDate, exactHouse, money, nearbyHouse, nearbyUrl, parseAddress, places,
  queryUrl, recentWhere, sortItems, toItem,
} from "./near.js";

const GROUPS = [
  { layer: "cases", title: "Zoning and planning cases", empty: "No open planning cases nearby." },
  { layer: "appeals", title: "Zoning appeals", empty: "No zoning appeals nearby in the last year." },
  { layer: "applied", title: "Building permits in review", empty: "No permit applications in review nearby." },
  { layer: "issued", title: "Building permits issued in the last year", empty: "No permits issued nearby in the last year." },
];
const SHOW = 8;

const form = document.getElementById("search");
const status = document.getElementById("status");
const results = document.getElementById("results");

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else n.setAttribute(k, v);
  }
  n.append(...kids.filter((k) => k !== null && k !== undefined && k !== ""));
  return n;
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || "query failed");
  return d;
}

async function findPlaces(text) {
  const p = parseAddress(text);
  if (!p) return { error: "Type a street address with a house number, like 1 Public Square." };
  let rows = (await getJson(queryUrl("parcels", { where: addressWhere(p, exactHouse(p)) }))).features.map((f) => f.attributes);
  if (!rows.length) {
    rows = (await getJson(queryUrl("parcels", { where: addressWhere(p, nearbyHouse(p)) }))).features.map((f) => f.attributes);
  }
  const found = places(rows, p.house);
  if (!found.length) return { error: "That address wasn't found in Metro's parcel map. Check the spelling, or add the street type (St, Ave, Pike)." };
  return { places: found };
}

// The Council Digest only has pages for bills it covers; check before linking.
const digestHas = new Map();
async function digestPage(bill) {
  if (!digestHas.has(bill)) {
    digestHas.set(bill, fetch(`${DIGEST}/bill/${bill}.html`, { method: "HEAD" }).then((r) => r.ok).catch(() => false));
  }
  return (await digestHas.get(bill)) ? `${DIGEST}/bill/${bill}.html` : null;
}

function card(it) {
  const verb = { issued: "issued", applied: "filed", cases: "filed", appeals: it.date < today() ? "heard" : "" }[it.layer];
  const meta = [it.status, it.date && verb ? `${verb} ${longDate(it.date)}` : "",
    money(it.cost), it.dist != null ? distanceLabel(it.dist) : ""].filter(Boolean).join(" · ");
  const links = el("p", { class: "links" });
  if (it.layer === "cases") {
    if (it.bill) {
      links.append(el("span", {}, `Council bill ${it.bill}`));
      digestPage(it.bill).then((u) => {
        if (u) links.prepend(el("a", { href: u, class: "chip" }, `${it.bill} in plain language`), " ");
      });
    }
    links.append(" ", el("span", { class: "muted" }, `Case ${it.id}`));
  } else if (it.id) {
    links.append(el("span", { class: "muted" }, it.layer === "appeals" ? `BZA case ${it.id}` : `Permit ${it.id}`));
  }
  const upcoming = it.hearing && it.hearing >= today();
  return el("article", { class: "card" },
    upcoming ? el("p", { class: "badge" }, `${it.layer === "appeals" ? "Board of Zoning Appeals" : "Planning Commission"} hearing ${longDate(it.hearing)}`) : null,
    el("h3", {}, it.title),
    it.place ? el("p", { class: "place" }, it.place) : null,
    it.text ? el("p", {}, it.text) : null,
    it.zoning?.length ? el("p", { class: "muted" }, `Zoning: ${it.zoning.join(" → ")}`) : null,
    it.action && !upcoming ? el("p", { class: "muted" }, `Planning Commission: ${it.action}`) : null,
    el("p", { class: "muted" }, meta),
    links.childNodes.length ? links : null);
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

function group(g, items) {
  const sorted = sortItems(items, today());
  const sec = el("section", { class: "group" }, el("h2", {}, `${g.title} `, el("span", { class: "count" }, String(items.length))));
  if (!items.length) { sec.append(el("p", { class: "hint" }, g.empty)); return sec; }
  const list = el("div", { class: "cards" }, ...sorted.slice(0, SHOW).map(card));
  sec.append(list);
  if (sorted.length > SHOW) {
    const more = el("button", { type: "button", class: "more" }, `Show all ${sorted.length}`);
    more.addEventListener("click", () => { list.append(...sorted.slice(SHOW).map(card)); more.remove(); });
    sec.append(more);
  }
  return sec;
}

async function show(place, miles) {
  const meters = RADII[miles];
  results.replaceChildren();
  status.replaceChildren(`Looking within ${miles === "1" ? "1 mile" : `${miles === "0.25" ? "¼" : "½"} mile`} of ${place.addr}…`);
  const from = { lat: place.lat, lon: place.lon };
  const settled = await Promise.allSettled(GROUPS.map((g) => getJson(nearbyUrl(g.layer, from, meters, recentWhere(g.layer)))));
  status.replaceChildren(
    el("strong", {}, place.addr), `, ${place.city} ${place.zip}`,
    place.exact ? "" : " (the closest address on Metro's parcel map)",
    place.district ? ` · Council District ${place.district} · ` : "",
    place.district ? el("a", { href: `${DIGEST}/district/${place.district}.html` }, "what the council did here") : "");
  settled.forEach((s, i) => {
    const g = GROUPS[i];
    if (s.status === "rejected") {
      results.append(el("section", { class: "group" }, el("h2", {}, g.title), el("p", { class: "hint" }, "Metro's map service didn't answer for this list. Try again in a moment.")));
      return;
    }
    const sec = group(g, s.value.features.map((f) => toItem(g.layer, f, from)));
    if (s.value.exceededTransferLimit) sec.append(el("p", { class: "hint" }, "Only the first 500 are shown; try a smaller distance."));
    results.append(sec);
  });
}

async function run(text, miles) {
  status.replaceChildren("Finding the address…");
  results.replaceChildren();
  try {
    const r = await findPlaces(text);
    if (r.error) { status.replaceChildren(r.error); return; }
    if (r.places.length === 1) return show(r.places[0], miles);
    status.replaceChildren("That address is in more than one part of the county. Which one?");
    const pick = el("div", { class: "chips" }, ...r.places.map((p) => {
      const b = el("button", { type: "button", class: "chip" }, `${p.addr}, ${p.city} ${p.zip}`);
      b.addEventListener("click", () => show(p, miles));
      return b;
    }));
    results.append(pick);
  } catch {
    status.replaceChildren("Metro's map service didn't answer. Try again in a moment.");
  }
}

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const text = form.address.value.trim();
  if (!text) return;
  const url = new URL(location.href);
  url.searchParams.set("address", text);
  url.searchParams.set("r", form.r.value);
  history.replaceState(null, "", url);
  run(text, form.r.value);
});

// Shareable links: ?address=...&r=0.5
const q = new URLSearchParams(location.search);
if (q.get("address")) {
  form.address.value = q.get("address");
  if (RADII[q.get("r")]) form.r.value = q.get("r");
  run(form.address.value, form.r.value);
}
