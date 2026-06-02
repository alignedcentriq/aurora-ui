"""Full sync: unfiltered monotonic pagination (the only stable mode in this
tenant), client-side filter to @alignedautomation.com, per-page commit, and a
stall guard that stops once no new aligned users appear for many pages.

Run with `python -u`.
"""
import asyncio, sys, os, time, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
ORG_DOMAIN = "@alignedautomation.com"
STALL_LIMIT = 40    # stop after this many consecutive pages with 0 new aligned users
MAX_PAGES = 1500


async def main():
    from app.database import engine, SessionLocal
    from app.models import Base, MS365User
    from app.services.ms365_service import (
        _normalize_user_row, _MS365_UPSERT_COLS, USER_SELECT, USER_EXPAND,
    )
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy import text
    import httpx

    Base.metadata.create_all(bind=engine, tables=[MS365User.__table__])

    # Org-wide directory read → app-only token (application User.Read.All on the
    # GRAPH_* app), matching ms365_service. The delegated flow no longer carries
    # User.Read.All, so this must NOT use a per-user token.
    from app.services.ms365_service import _app_token
    token = _app_token()
    if not token:
        print("ERROR: No token", flush=True); return

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    params = {
        "$select": USER_SELECT,
        "$expand": USER_EXPAND,
        "$top": "999",
    }
    url = f"{GRAPH_BASE}/users"

    def commit(rows):
        if not rows:
            return
        db = SessionLocal()
        try:
            stmt = pg_insert(MS365User).values(rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=["azure_id"],
                set_={col: getattr(stmt.excluded, col) for col in _MS365_UPSERT_COLS},
            )
            db.execute(stmt); db.commit()
        finally:
            db.close()

    seen = set()
    page = 0
    stall = 0
    scanned = 0
    t0 = time.time()
    timeout = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        while url and page < MAX_PAGES and stall < STALL_LIMIT:
            page += 1
            resp = await client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
            batch = data.get("value", [])
            scanned += len(batch)

            now = datetime.datetime.utcnow()
            rows = []
            for u in batch:
                mail = (u.get("mail") or "").lower()
                if not mail.endswith(ORG_DOMAIN):
                    continue
                # Skip explicitly disabled accounts (ex-employees); accountEnabled
                # comes from the expanded $select (requires User.Read.All).
                if u.get("accountEnabled") is False:
                    continue
                row = _normalize_user_row(u)  # also drops non-human / id-less accounts
                if row is None or row["azure_id"] in seen:
                    continue
                seen.add(row["azure_id"])
                row["synced_at"] = now
                rows.append(row)
            commit(rows)
            stall = stall + 1 if not rows else 0
            url = data.get("@odata.nextLink")
            params = {}
            if page % 10 == 0 or rows:
                print(f"page {page}: +{len(rows)} aligned={len(seen)} scanned={scanned} stall={stall} elapsed={time.time()-t0:.0f}s", flush=True)

    # purge any non-aligned rows from earlier runs
    db = SessionLocal()
    db.execute(text(f"DELETE FROM enterprise_ai.ms365_users WHERE lower(email) NOT LIKE '%{ORG_DOMAIN}'"))
    db.commit()
    final = db.query(MS365User).count()
    db.close()
    stop = "exhausted" if not url else ("stalled" if stall >= STALL_LIMIT else "page-cap")
    print(f"DONE reason={stop} aligned_fetched={len(seen)} db_rows={final} scanned={scanned} elapsed={time.time()-t0:.0f}s", flush=True)

asyncio.run(main())
