import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

def apply_full_schema():
    try:
        engine = create_engine(DATABASE_URL)
        
        # Files to apply in order
        files = ["enterprise_ai.sql", "sharepoint_schema.sql"]
        
        with engine.connect() as connection:
            # We wrap everything in a transaction
            trans = connection.begin()
            try:
                for filename in files:
                    file_path = os.path.join(os.path.dirname(__file__), filename)
                    if not os.path.exists(file_path):
                        print(f"Skipping {filename}, file not found.")
                        continue
                        
                    print(f"Applying {filename}...")
                    with open(file_path, "r") as f:
                        sql_content = f.read()
                        
                        # Instead of splitting by semicolon which is risky,
                        # we execute the whole block. Psycopg2 supports this.
                        connection.execute(text(sql_content))
                
                trans.commit()
                print("All schema files applied successfully.")
            except Exception as e:
                trans.rollback()
                print(f"Error during execution: {e}")
                sys.exit(1)
                
    except Exception as e:
        print(f"Error connecting to database: {e}")
        sys.exit(1)

if __name__ == "__main__":
    apply_full_schema()
