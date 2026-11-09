// The pure logic, offline: no request reaches Metro here.
import test from "node:test";
import assert from "node:assert/strict";
import * as N from "../src/near.js";

test("addresses parse into a house number, a street pattern and a ZIP", () => {
  assert.deepEqual(N.parseAddress("1 Public Square, Nashville TN 37201"), { house: "1", street: "PUBLIC%SQ", zip: "37201" });
  assert.deepEqual(N.parseAddress("1600 Charlotte Avenue North"), { house: "1600", street: "CHARLOTTE%AVE%N", zip: "" });
  assert.equal(N.parseAddress("2525 West End Ave").street, "WEST%END%AVE"); // "West" here is the name
  assert.equal(N.parseAddress("Main Street"), null);
  assert.ok(!N.parseAddress("700 O'Brien Ave").street.includes("'"));
});

test("the street match is exact or followed by a direction, never a longer name", () => {
  const w = N.addressWhere({ house: "5", street: "MAIN%ST", zip: "37213" }, N.exactHouse({ house: "5" }));
  assert.match(w, /PropStreet LIKE 'MAIN%ST' OR PropStreet LIKE 'MAIN%ST %'/);
  assert.match(w, /PropHouse = '5'/);
  assert.match(w, /PropZip = '37213'/);
  assert.match(N.nearbyHouse({ house: "100" }), /BETWEEN 1 AND 300/);
});

test("one address in two parts of the county stays two answers, closest number first", () => {
  const rows = [
    { PropAddr: "104 MAIN ST", PropHouse: "104", PropCity: "NASHVILLE", PropZip: "37206", Council: "05", Lat: 36.17, Lon: -86.76 },
    { PropAddr: "100 MAIN ST", PropHouse: "100", PropCity: "OLD HICKORY", PropZip: "37138", Council: "11", Lat: 36.26, Lon: -86.65 },
    { PropAddr: "101 MAIN ST", PropHouse: "101", PropCity: "NASHVILLE", PropZip: "37206", Council: "05", Lat: 36.17, Lon: -86.76 },
    { PropAddr: "NO POINT", PropHouse: "100", PropCity: "X", PropZip: "37000", Council: "1", Lat: null, Lon: null },
  ];
  const got = N.places(rows, "100");
  assert.deepEqual(got.map((p) => [p.addr, p.district, p.exact]), [["100 MAIN ST", 11, true], ["101 MAIN ST", 5, false]]);
});

test("queries ask only for the listed fields: no owner, appellant or contact names", () => {
  for (const layer of Object.keys(N.LAYERS)) {
    const u = new URL(N.nearbyUrl(layer, { lat: 36.16, lon: -86.78 }, 805));
    const fields = u.searchParams.get("outFields").split(",");
    assert.ok(!fields.includes("*"));
    for (const f of fields) assert.doesNotMatch(f, /owner|own_|appellant|contact|email|per_lead/i, `${layer}.${f}`);
    assert.equal(u.searchParams.get("geometry"), "-86.78,36.16"); // x,y = lon,lat
    assert.equal(u.searchParams.get("distance"), "805");
  }
});

test("recent means open cases, and appeals and permits from the last year", () => {
  const now = Date.parse("2026-11-09T18:00:00Z");
  assert.equal(N.recentWhere("cases", now), "PSTAT IN ('New','Pending','Active')");
  assert.equal(N.recentWhere("appeals", now), "BZA_DATE >= DATE '2025-11-09'");
  assert.equal(N.recentWhere("issued", now), "Date_Issued >= DATE '2025-11-09'");
  assert.match(N.recentWhere("applied", now), /Date_Issued IS NULL/);
});

test("phone numbers and emails are removed from free text", () => {
  const t = "Interior renovation. POC: Kim 615.690.3748 or (615) 716-8111 ext. 3, kim@example.com";
  const r = N.redact(t);
  assert.doesNotMatch(r, /\d{3}.\d{4}|@/);
  assert.match(r, /Interior renovation\. POC: Kim \[phone removed\] or \[phone removed\], \[email removed\]/);
  assert.equal(N.redact("POC:  JUNAID ODUBEKO615-252-4635"), "POC: JUNAID ODUBEKO[phone removed]");
  // ordinary numbers stay
  assert.equal(N.redact("22,134 sq ft on 2 floors, permit 2023089357"), "22,134 sq ft on 2 floors, permit 2023089357");
});

test("dates are read in Nashville time", () => {
  assert.equal(N.isoDate(Date.parse("2026-09-17T03:30:00Z")), "2026-09-16"); // 10:30 pm the 16th in Nashville
  assert.equal(N.isoDate("11/12/2026"), "2026-11-12");
  assert.equal(N.isoDate(null), "");
  assert.equal(N.longDate("2026-11-12"), "Nov 12, 2026");
  assert.equal(N.longDate(""), "");
});

test("records become cards with the record's own words", () => {
  const from = { lat: 36.1663, lon: -86.7816 };
  const c = N.toItem("cases", {
    attributes: { MPCNUM: "2026Z-001PR-001", BILLNUM: "BL2026-1565", CASE_TYPE_DESC: "MPC Rezoning", PSTAT: "Pending",
      CAPTION: "A request to rezone from RS5 to R6. Contact 615-555-0100.", HEARING_DATE: "12/02/2026", ExistingZoning: "RS5", NewZoning: "R6",
      LOCATION_DESC: "100 MAIN ST 37206", DATE_ACCEPTED: Date.parse("2026-10-01T15:00:00Z") },
    geometry: { x: -86.7816, y: 36.1700 },
  }, from);
  assert.equal(c.title, "Rezoning: changes what can be built on the land");
  assert.equal(c.bill, "BL2026-1565");
  assert.equal(c.hearing, "2026-12-02");
  assert.deepEqual(c.zoning, ["RS5", "R6"]);
  assert.match(c.text, /\[phone removed\]/);
  assert.ok(c.dist > 400 && c.dist < 420, String(c.dist));
  assert.equal(N.toItem("cases", { attributes: { BILLNUM: "see notes" } }, from).bill, "");

  const p = N.toItem("issued", { attributes: { Permit__: "1", Permit_Type_Description: "Building Residential - New",
    Permit_Subtype_Description: "Single Family Residence", Const_Cost: 0, Date_Issued: Date.parse("2026-11-06T06:00:00Z"), Lat: 36.17, Lon: -86.78 } }, from);
  assert.equal(p.title, "Building Residential - New · Single Family Residence");
  assert.equal(p.cost, null);
  assert.equal(p.date, "2026-11-06");
});

test("appeals read as Metro wrote them, one full stop per sentence", () => {
  const a = N.toItem("appeals", { attributes: { CASE_NAME: "2026-115", ACTIVITY: "Warehouse", BZA_DATE: Date.parse("2026-12-17T06:00:00Z"),
    REASON: "An Item A appeal challenging the zoning administrator", PURPOSE: "The appellant is seeking to challenge the decision.." } }, null);
  assert.equal(a.text, "An Item A appeal challenging the zoning administrator. Purpose: The appellant is seeking to challenge the decision.");
  assert.equal(a.hearing, "2026-12-17");
  assert.equal(a.dist, null);
});

test("upcoming hearings come first, soonest first, then newest", () => {
  const items = [
    { id: "old", date: "2026-01-01" },
    { id: "later", date: "2026-10-01", hearing: "2026-12-17" },
    { id: "new", date: "2026-11-01" },
    { id: "soon", date: "2026-09-01", hearing: "2026-11-12" },
    { id: "past", date: "2026-10-15", hearing: "2026-10-20" },
  ];
  assert.deepEqual(N.sortItems(items, "2026-11-09").map((x) => x.id), ["soon", "later", "new", "past", "old"]);
});

test("distances and money read naturally", () => {
  assert.equal(N.distanceLabel(10), "50 ft away");
  assert.equal(N.distanceLabel(150), "500 ft away");
  assert.equal(N.distanceLabel(805), "0.5 mi away");
  assert.equal(N.money(2000000), "$2 million");
  assert.equal(N.money(63700), "$63,700");
  assert.equal(N.money(null), "");
  assert.ok(Math.abs(N.metersBetween({ lat: 36, lon: -86 }, { lat: 36.01, lon: -86 }) - 1112) < 2);
});
