import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("Error: DATABASE_URL not found in .env")
    sys.exit(1)

# Ensure DATABASE_URL is postgresql
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

def apply_schema():
    try:
        engine = create_engine(DATABASE_URL)
        sql_file_path = os.path.join(os.path.dirname(__file__), "sharepoint_schema.sql")
        
        with open(sql_file_path, "r") as f:
            sql_script = f.read()
            
        # Split the script into individual commands if necessary, 
        # or execute as a whole if the driver supports it.
        # SQLAlchemy's engine.execute handles multi-statement strings differently depending on driver.
        # For Postgres/psycopg2, we can execute the whole block if we use a connection.
        
        with engine.connect() as connection:
            print(f"Connecting to database: {DATABASE_URL.split('@')[-1]}")
            # We need to execute the commands. Since it's a script with SET search_path, 
            # we'll execute the whole text.
            connection.execute(text(sql_script))
            connection.commit()
            print("Successfully applied SharePoint schema to the database.")
            
    except Exception as e:
        print(f"Error applying schema: {e}")
        sys.exit(1)

if __name__ == "__main__":
    apply_schema()
