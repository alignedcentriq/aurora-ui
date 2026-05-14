import os
import redis
from dotenv import load_dotenv

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

def get_redis_connection():
    """Returns a Redis connection object."""
    try:
        r = redis.from_url(REDIS_URL, decode_responses=True)
        r.ping()
        return r
    except redis.ConnectionError as e:
        print(f"Failed to connect to Redis: {e}")
        return None

# Singleton connection for general use
redis_client = get_redis_connection()
