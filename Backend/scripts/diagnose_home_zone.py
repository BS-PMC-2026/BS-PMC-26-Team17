"""
Pre-alarm filter diagnostic.

Two modes:

  whoami <user_id>
      Show what `alert_dispatcher` would resolve for this user's saved
      homeLat/homeLng. Prints the raw coords, the zone returned by
      `resolve_zone`, and the parent_city the filter actually checks
      against. If the zone or city is empty, that's why pre-alarms are
      leaking through (or being suppressed) for this user.

  dry-run-early <user_id> <area> [<area> ...] [--really]
      Pretend Pikud HaOref just emitted a pre-alarm whose `areas[]` is
      the list you pass. Run the SAME filter logic the live dispatcher
      uses, but scoped to just this one user, and print the decision:
        - "would push"  → user matches an affected city
        - "would skip"  → user's home city isn't in the affected set
                          (or can't be resolved at all)
      With --really, actually fires `dispatch_alert` so you can confirm
      the push lands on your phone. Without --really, nothing leaves the
      machine — safe to run repeatedly.

Run from the Backend/ folder so the `app.*` imports resolve:

    python -m scripts.diagnose_home_zone whoami <user_id>
    python -m scripts.diagnose_home_zone dry-run-early <user_id> "צפת - מרכז"
    python -m scripts.diagnose_home_zone dry-run-early <user_id> "צפת - מרכז" --really
"""
import argparse
import asyncio
import sys

from bson import ObjectId

from app.core import alert_dispatcher
from app.core.database import db
from app.core.oref_zones import load_polygons, parent_cities, parent_city, resolve_zone


async def _load_user(user_id: str) -> dict | None:
    try:
        return await db["User"].find_one({"_id": ObjectId(user_id)})
    except Exception as e:
        print(f"ERROR: bad user_id ({e})")
        return None


async def whoami(user_id: str) -> int:
    user = await _load_user(user_id)
    if not user:
        print("user not found")
        return 1

    lat = user.get("homeLat")
    lng = user.get("homeLng")
    has_expo = bool(user.get("expoPushToken"))
    has_fcm  = bool(user.get("fcmToken"))

    print(f"user_id        : {user_id}")
    print(f"homeLat/homeLng: {lat!r} / {lng!r}")
    print(f"expoPushToken  : {'set' if has_expo else 'MISSING'}")
    print(f"fcmToken       : {'set' if has_fcm else 'MISSING'}")

    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        print("\nresolution: home coords NOT set → pre-alarms would be SKIPPED")
        print("            (and you can never be filtered into a city)")
        return 0

    polys = await load_polygons()
    print(f"polygons loaded: {bool(polys)} ({len(polys) if polys else 0} zones)")

    zone = resolve_zone(float(lat), float(lng))
    if not zone:
        print("\nresolution: coords do NOT fall inside any polygon → resolve_zone() = None")
        print("            (after the fix, pre-alarms for any area are SKIPPED for this user)")
        print("            (before the fix, the conservative fallback was pushing every pre-alarm)")
        return 0

    city = parent_city(zone)
    print(f"resolved zone  : {zone!r}")
    print(f"parent city    : {city!r}")
    print("\nresolution: this user receives pre-alarms whose areas contain")
    print(f"            any sub-zone of {city!r}.")
    return 0


async def dry_run_early(user_id: str, areas: list[str], really: bool) -> int:
    user = await _load_user(user_id)
    if not user:
        print("user not found")
        return 1

    await load_polygons()

    # Replicate the filter the live dispatcher applies — same code path,
    # scoped to just this one user so we don't spam teammates.
    rec = {
        "expoToken": user.get("expoPushToken") or None,
        "fcmToken":  user.get("fcmToken") or None,
        "homeLat":   user.get("homeLat"),
        "homeLng":   user.get("homeLng"),
    }
    home_city = alert_dispatcher._user_home_city(rec)
    affected = set(parent_cities(areas))

    print(f"alert areas[]       : {areas}")
    print(f"alert parent cities : {sorted(affected)}")
    print(f"user home city      : {home_city!r}")
    if home_city and home_city in affected:
        decision = "would PUSH (home city is in affected set)"
    elif not home_city:
        decision = ("would SKIP (home zone unresolvable). After fix this is correct; "
                    "before fix the conservative fallback pushed anyway.")
    else:
        decision = "would SKIP (home city not in affected set)"
    print(f"decision            : {decision}")

    if not really:
        print("\n(dry run — nothing dispatched. Add --really to actually fire dispatch_alert.)")
        return 0

    print("\n--really set → calling alert_dispatcher.dispatch_alert(...)")
    alert = {
        "id":    f"diag-{user_id[-6:]}",
        "kind":  "early",
        "title": "התרעה מוקדמת",
        "areas": areas,
    }
    n = await alert_dispatcher.dispatch_alert(alert)
    print(f"dispatch_alert returned: {n} recipient(s) pushed across the whole DB")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Pre-alarm filter diagnostic")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("whoami", help="Show resolved home zone for a user")
    a.add_argument("user_id")

    b = sub.add_parser("dry-run-early", help="Simulate a pre-alarm against this user")
    b.add_argument("user_id")
    b.add_argument("areas", nargs="+", help='e.g. "צפת - מרכז"')
    b.add_argument("--really", action="store_true",
                   help="Actually call dispatch_alert (fires real push if filter passes)")

    args = p.parse_args()
    if args.cmd == "whoami":
        return asyncio.run(whoami(args.user_id))
    if args.cmd == "dry-run-early":
        return asyncio.run(dry_run_early(args.user_id, args.areas, args.really))
    p.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
