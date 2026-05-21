"""
MCP Client — manages the Centriq deep-link MCP server tools.

Call `load_mcp_tools()` once at FastAPI startup.
Call `get_deeplink_tools()` anytime after that to get the loaded tool list.
`shutdown_mcp_client()` is a no-op (connections are per-call in 0.2.x).
"""
import sys
import os
from pathlib import Path
from typing import List

from langchain_core.tools import BaseTool

_mcp_tools: List[BaseTool] = []

_SERVER_SCRIPT = str(
    Path(__file__).resolve().parent.parent / "mcp_server" / "server.py"
)


async def load_mcp_tools() -> List[BaseTool]:
    """
    Load MCP tools from the deep-link server script.
    langchain-mcp-adapters 0.2.x creates a fresh subprocess per get_tools() call;
    the returned tool objects carry the connection config for later invocations.
    """
    global _mcp_tools

    from langchain_mcp_adapters.client import MultiServerMCPClient

    client = MultiServerMCPClient(
        {
            "centriq-deeplink": {
                "transport": "stdio",
                "command": sys.executable,
                "args": [_SERVER_SCRIPT],
                "env": dict(os.environ),
            }
        }
    )

    _mcp_tools = await client.get_tools()
    return _mcp_tools


async def shutdown_mcp_client() -> None:
    """No persistent subprocess to shut down in langchain-mcp-adapters 0.2.x."""
    pass


def get_deeplink_tools() -> List[BaseTool]:
    """Return the already-loaded MCP tools. Empty list if not yet loaded."""
    return _mcp_tools
