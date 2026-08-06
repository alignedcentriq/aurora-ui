"""Capability registry — the shared spine for discovery, rescue, and adoption %.

Pure, no DB. Verifies role-aware visibility, the nearest-capabilities rescue
matcher, and that every capability is well-formed (so analytics and the
discovery UI can rely on it).

    python -m tests.test_capability_registry
"""

import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app.services import capability_registry as caps


def main():
    fails = []

    def ok(cond, msg):
        print(f"  [{'PASS' if cond else 'FAIL'}] {msg}")
        if not cond:
            fails.append(msg)

    print("catalog is well-formed:")
    keys = [c.key for c in caps.all_capabilities()]
    ok(len(keys) == len(set(keys)), "capability keys are unique")
    ok(all(c.examples for c in caps.all_capabilities()), "every capability has >=1 example")
    ok(all(c.title and c.description and c.category for c in caps.all_capabilities()),
       "every capability has title/description/category")

    print("role-aware visibility:")
    emp = {c.key for c in caps.capabilities_for_role("employee")}
    mgr = {c.key for c in caps.capabilities_for_role("manager")}
    adm = {c.key for c in caps.capabilities_for_role("admin")}
    ok("leave_balance" in emp, "employee sees leave_balance (universal)")
    ok("approvals" not in emp, "employee does NOT see manager-only approvals")
    ok("approvals" in mgr, "manager sees approvals")
    ok(emp < mgr or "approvals" in mgr, "manager superset includes team capabilities")
    ok(adm == {c.key for c in caps.all_capabilities()}, "admin sees everything")

    print("nearest-capabilities rescue matcher:")
    near = caps.nearest_capabilities("how many vacation days do I have left", role="employee")
    ok(any(c.key == "leave_balance" for c in near), "'vacation days left' -> leave_balance")
    near = caps.nearest_capabilities("my laptop keeps crashing", role="employee", domain="it_support")
    ok(any(c.domain == "it_support" for c in near), "'laptop crashing' surfaces an IT capability")
    ok(len(caps.nearest_capabilities("zxqw nonsense gibberish", role="employee")) == 3,
       "no-overlap query still returns a padded 3 (graceful fallback)")
    near_emp = caps.nearest_capabilities("approve leave for my team", role="employee")
    ok(all(c.visible_to("employee") for c in near_emp),
       "rescue never suggests a capability the role can't use")

    print("short_label:")
    ok(caps.short_label("pmo", "project_iq") == "Project IQ",
       "(pmo, project_iq) -> the SkillSpec display_name")
    ok(caps.short_label("pmo", "training") == "Learning Advisor",
       "(pmo, training) -> a different SkillSpec on the same domain (not ambiguous)")
    ok(caps.short_label("hr") == "HR", "domain-only 'hr' (no sub_intent) skips SkillSpec, humanizes")
    ok(caps.short_label(None) == "General", "empty domain falls back to 'General'")
    ok(caps.short_label("it_support") == "IT Support",
       "unmapped domain humanizes with acronym casing, not a raw underscore string")
    ok(caps.short_label("document", "document_request") == "HR & policy",
       "(document, document_request) falls through to the matching Capability's category")

    print()
    if fails:
        print(f"FAILED: {len(fails)} check(s)")
        for f in fails:
            print(f"  - {f}")
        sys.exit(1)
    print("All capability-registry checks passed.")


if __name__ == "__main__":
    main()
