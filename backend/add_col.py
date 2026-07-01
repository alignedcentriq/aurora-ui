import sys
import os
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from app.database import engine
from sqlalchemy import text

with engine.begin() as conn:
    conn.execute(text("ALTER TABLE enterprise_ai.connectors ADD COLUMN IF NOT EXISTS seeding_status VARCHAR DEFAULT 'idle'"))
    print("Column added successfully.")
