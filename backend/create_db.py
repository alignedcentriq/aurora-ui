import os
import sys
from sqlalchemy import create_engine, text
from sqlalchemy.engine.url import make_url
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL_STR = os.getenv("DATABASE_URL")
if not DATABASE_URL_STR:
    print("Error: DATABASE_URL not found")
    sys.exit(1)

# Parse URL to get the base connection (to 'postgres' db) to create 'centriq'
url = make_url(DATABASE_URL_STR)

# Base connection to 'postgres' database to create the new one
base_url = url.set(database="postgres")
target_db = url.database

def create_db_if_not_exists():
    try:
        # Connect to 'postgres' database
        engine = create_engine(base_url)
        with engine.connect() as conn:
            # PostgreSQL doesn't allow CREATE DATABASE inside a transaction block
            conn.execution_options(isolation_level="AUTOCOMMIT")
            
            # Check if exists
            result = conn.execute(text(f"SELECT 1 FROM pg_database WHERE datname = '{target_db}'"))
            if not result.fetchone():
                print(f"Creating database '{target_db}'...")
                conn.execute(text(f"CREATE DATABASE {target_db}"))
                print(f"Database '{target_db}' created successfully.")
            else:
                print(f"Database '{target_db}' already exists.")
    except Exception as e:
        print(f"Error creating database: {e}")
        # If we can't create it, maybe it's just a permissions issue but it exists? 
        # We'll see in the next step.

if __name__ == "__main__":
    create_db_if_not_exists()
