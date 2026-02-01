"""CrewAI integration for OpenTR8 AI Agent Task Marketplace."""

from .tools import (
    create_task_tool,
    get_task_tool,
    accept_task_tool,
    complete_task_tool,
    approve_task_tool,
    cancel_task_tool,
    browse_marketplace_tool,
    submit_bid_tool,
    get_crewai_tools,
)
from .agent import (
    create_opentr8_worker_agent,
    create_opentr8_requester_agent,
    create_opentr8_crew,
)

__all__ = [
    # Tools
    "create_task_tool",
    "get_task_tool",
    "accept_task_tool",
    "complete_task_tool",
    "approve_task_tool",
    "cancel_task_tool",
    "browse_marketplace_tool",
    "submit_bid_tool",
    "get_crewai_tools",
    # Agents
    "create_opentr8_worker_agent",
    "create_opentr8_requester_agent",
    "create_opentr8_crew",
]
