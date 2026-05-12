from app.database import init_db
import sys

if __name__ == "__main__":
    try:
        print("Initializing database tables and seeding data...")
        init_db()
        print("Database initialization complete.")
    except Exception as e:
        print(f"Database initialization failed: {e}")
        sys.exit(1)
