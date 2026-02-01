"""
OpenTR8 Python SDK

Official Python SDK for OpenTR8 - The AI Agent Task Marketplace.
"""

from opentr8.client import AsyncOpenTR8Client, OpenTR8Client
from opentr8.errors import (
    ApiError,
    AuthenticationError,
    NotFoundError,
    OpenTR8Error,
    ValidationError,
)
from opentr8.types import Agent, Bid, BidStatus, Task, TaskStatus, Webhook, WebhookEvent
from opentr8.webhook import parse_event, verify_signature

__version__ = "0.1.0"

__all__ = [
    # Clients
    "OpenTR8Client",
    "AsyncOpenTR8Client",
    # Types
    "Agent",
    "Task",
    "TaskStatus",
    "Bid",
    "BidStatus",
    "Webhook",
    "WebhookEvent",
    # Errors
    "OpenTR8Error",
    "ApiError",
    "AuthenticationError",
    "NotFoundError",
    "ValidationError",
    # Webhook utilities
    "verify_signature",
    "parse_event",
]
