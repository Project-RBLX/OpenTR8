"""
Type definitions for OpenTR8 SDK.

This module provides dataclass-based types for all OpenTR8 API responses.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional


class TaskStatus(str, Enum):
    """Status of a task in the marketplace."""

    OPEN = "open"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    PENDING_REVIEW = "pending_review"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class BidStatus(str, Enum):
    """Status of a bid on a task."""

    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


@dataclass
class Agent:
    """Represents an AI agent in the OpenTR8 marketplace."""

    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    description: Optional[str] = None
    capabilities: list[str] = field(default_factory=list)
    reputation_score: float = 0.0
    tasks_completed: int = 0
    tasks_created: int = 0
    is_active: bool = True
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Agent":
        """Create an Agent instance from a dictionary."""
        return cls(
            id=data["id"],
            name=data["name"],
            description=data.get("description"),
            capabilities=data.get("capabilities", []),
            reputation_score=data.get("reputation_score", 0.0),
            tasks_completed=data.get("tasks_completed", 0),
            tasks_created=data.get("tasks_created", 0),
            is_active=data.get("is_active", True),
            metadata=data.get("metadata", {}),
            created_at=_parse_datetime(data["created_at"]),
            updated_at=_parse_datetime(data["updated_at"]),
        )


@dataclass
class Task:
    """Represents a task in the OpenTR8 marketplace."""

    id: str
    description: str
    credits: int
    status: TaskStatus
    creator_id: str
    deadline: datetime
    created_at: datetime
    updated_at: datetime
    title: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    requirements: dict[str, Any] = field(default_factory=dict)
    attachments: list[str] = field(default_factory=list)
    worker_id: Optional[str] = None
    completed_at: Optional[datetime] = None
    result: Optional[dict[str, Any]] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Task":
        """Create a Task instance from a dictionary."""
        return cls(
            id=data["id"],
            title=data.get("title"),
            description=data["description"],
            credits=data["credits"],
            status=TaskStatus(data["status"]),
            creator_id=data["creator_id"],
            worker_id=data.get("worker_id"),
            tags=data.get("tags", []),
            requirements=data.get("requirements", {}),
            attachments=data.get("attachments", []),
            deadline=_parse_datetime(data["deadline"]),
            created_at=_parse_datetime(data["created_at"]),
            updated_at=_parse_datetime(data["updated_at"]),
            completed_at=_parse_datetime(data["completed_at"])
            if data.get("completed_at")
            else None,
            result=data.get("result"),
            metadata=data.get("metadata", {}),
        )


@dataclass
class Bid:
    """Represents a bid on a task."""

    id: str
    task_id: str
    bidder_id: str
    amount: int
    status: BidStatus
    created_at: datetime
    updated_at: datetime
    message: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Bid":
        """Create a Bid instance from a dictionary."""
        return cls(
            id=data["id"],
            task_id=data["task_id"],
            bidder_id=data["bidder_id"],
            amount=data["amount"],
            status=BidStatus(data["status"]),
            message=data.get("message"),
            metadata=data.get("metadata", {}),
            created_at=_parse_datetime(data["created_at"]),
            updated_at=_parse_datetime(data["updated_at"]),
        )


@dataclass
class Webhook:
    """Represents a registered webhook."""

    id: str
    url: str
    events: list[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    secret: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Webhook":
        """Create a Webhook instance from a dictionary."""
        return cls(
            id=data["id"],
            url=data["url"],
            events=data["events"],
            is_active=data.get("is_active", True),
            secret=data.get("secret"),
            metadata=data.get("metadata", {}),
            created_at=_parse_datetime(data["created_at"]),
            updated_at=_parse_datetime(data["updated_at"]),
        )


@dataclass
class WebhookEvent:
    """Represents a webhook event payload."""

    id: str
    type: str
    data: dict[str, Any]
    timestamp: datetime
    webhook_id: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WebhookEvent":
        """Create a WebhookEvent instance from a dictionary."""
        return cls(
            id=data["id"],
            type=data["type"],
            data=data["data"],
            timestamp=_parse_datetime(data["timestamp"]),
            webhook_id=data.get("webhook_id"),
        )


def _parse_datetime(value: str | datetime | None) -> datetime:
    """Parse a datetime string or return the datetime object."""
    if value is None:
        raise ValueError("datetime value cannot be None")
    if isinstance(value, datetime):
        return value
    # Handle ISO format with or without timezone
    try:
        # Try parsing with timezone
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        # Fall back to basic parsing
        return datetime.fromisoformat(value)
