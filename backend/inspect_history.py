import asyncio
import os
from langgraph.checkpoint.redis.aio import AsyncRedisSaver

async def inspect_thread(thread_id: str):
    """Fetches and prints a readable version of the chat history from Redis."""
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
    
    # We create a new checkpointer and explicitly call setup to ensure indexes exist
    checkpointer = AsyncRedisSaver.from_conn_string(REDIS_URL)
    
    async with checkpointer as saver:
        # Re-compile a temporary graph with the saver to be safe
        config = {"configurable": {"thread_id": thread_id}}
        
        # Try to get the tuple directly
        checkpoint_tuple = await saver.aget_tuple(config)
        
        if not checkpoint_tuple:
            print(f"\n[!] No history found for thread: {thread_id}")
            return

        values = checkpoint_tuple.checkpoint.get("values", {})
        messages = values.get("messages", [])
        
        print(f"\n=== Chat History for Thread: {thread_id} ===")
        print(f"Messages found: {len(messages)}\n")
        
        for i, msg in enumerate(messages):
            role = msg.__class__.__name__.replace("Message", "").upper()
            if role == "HUMAN": role = "USER"
            if role == "AI": role = "ASSISTANT"
            
            print(f"[{i}] {role}:")
            print(f"    {msg.content}")
            if hasattr(msg, 'tool_calls') and msg.tool_calls:
                print(f"    Tool Calls: {msg.tool_calls}")
            print("-" * 40)

if __name__ == "__main__":
    import sys
    tid = sys.argv[1] if len(sys.argv) > 1 else "default_session"
    
    try:
        asyncio.run(inspect_thread(tid))
    except Exception as e:
        print(f"Error: {e}")
