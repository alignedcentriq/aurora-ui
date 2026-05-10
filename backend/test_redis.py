import asyncio
from app.agent import app_agent
from langchain_core.messages import HumanMessage

async def test_redis_persistence():
    print("Testing Redis Persistence...")
    config = {"configurable": {"thread_id": "test_thread_123"}}
    
    # First message
    print("\nSending first message...")
    input_1 = {"messages": [HumanMessage(content="Hi, I'm employee1. What's my name?")]}
    async for event in app_agent.astream(input_1, config, stream_mode="values"):
        last_msg = event["messages"][-1]
    print(f"Response 1: {last_msg.content}")
    
    # Second message (relying on memory)
    print("\nSending second message (relying on memory)...")
    input_2 = {"messages": [HumanMessage(content="What did I just ask you?")]}
    async for event in app_agent.astream(input_2, config, stream_mode="values"):
        last_msg = event["messages"][-1]
    print(f"Response 2: {last_msg.content}")
    
    print("\nRedis persistence test complete.")

if __name__ == "__main__":
    asyncio.run(test_redis_persistence())
