import redis
from app.config import settings

_redis_instance = None

def get_redis_client():
    """Return a singleton sync Redis client with string decoding. Returns None if unavailable."""
    global _redis_instance
    if _redis_instance is not None:
        return _redis_instance
    try:
        r = redis.from_url(settings.REDIS_URL, decode_responses=True, socket_connect_timeout=2)
        r.ping()
        _redis_instance = r
        return r
    except Exception:
        return None
