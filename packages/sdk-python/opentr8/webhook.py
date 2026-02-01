"""
Webhook utilities for OpenTR8 SDK.

This module provides functions for verifying webhook signatures
and parsing webhook events.
"""

import hashlib
import hmac
import time
from typing import Any

from opentr8.errors import WebhookVerificationError
from opentr8.types import WebhookEvent


def verify_signature(
    payload: bytes,
    signature: str,
    secret: str,
    tolerance: int = 300,
) -> bool:
    """
    Verify the signature of a webhook payload.

    The signature format is: "t=<timestamp>,v1=<signature>"

    Args:
        payload: The raw webhook payload bytes
        signature: The signature from the X-OpenTR8-Signature header
        secret: Your webhook secret
        tolerance: Maximum age of the webhook in seconds (default: 300)

    Returns:
        True if the signature is valid

    Raises:
        WebhookVerificationError: If the signature is invalid or expired
    """
    if not signature:
        raise WebhookVerificationError("Missing signature")

    try:
        # Parse the signature header
        parts = dict(part.split("=", 1) for part in signature.split(","))
        timestamp_str = parts.get("t")
        provided_signature = parts.get("v1")

        if not timestamp_str or not provided_signature:
            raise WebhookVerificationError("Invalid signature format")

        timestamp = int(timestamp_str)
    except (ValueError, KeyError) as e:
        raise WebhookVerificationError(f"Invalid signature format: {e}") from e

    # Check timestamp tolerance
    current_time = int(time.time())
    if abs(current_time - timestamp) > tolerance:
        raise WebhookVerificationError(
            f"Webhook timestamp too old (tolerance: {tolerance}s)"
        )

    # Compute expected signature
    signed_payload = f"{timestamp}.".encode() + payload
    expected_signature = hmac.new(
        secret.encode(),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()

    # Compare signatures using constant-time comparison
    if not hmac.compare_digest(expected_signature, provided_signature):
        raise WebhookVerificationError("Signature mismatch")

    return True


def parse_event(payload: dict[str, Any]) -> WebhookEvent:
    """
    Parse a webhook event payload into a WebhookEvent object.

    Args:
        payload: The parsed JSON webhook payload

    Returns:
        A WebhookEvent instance

    Example:
        ```python
        import json
        from opentr8.webhook import parse_event

        payload = json.loads(request.body)
        event = parse_event(payload)

        if event.type == "task.completed":
            task_data = event.data
            print(f"Task {task_data['id']} completed!")
        ```
    """
    return WebhookEvent.from_dict(payload)


# Webhook event types
WEBHOOK_EVENTS = {
    # Task events
    "task.created": "Fired when a new task is created",
    "task.updated": "Fired when a task is updated",
    "task.assigned": "Fired when a task is assigned to a worker",
    "task.completed": "Fired when a task is marked as completed",
    "task.approved": "Fired when a completed task is approved",
    "task.cancelled": "Fired when a task is cancelled",
    "task.expired": "Fired when a task deadline passes",
    # Bid events
    "bid.received": "Fired when a new bid is received on your task",
    "bid.accepted": "Fired when your bid is accepted",
    "bid.rejected": "Fired when your bid is rejected",
    "bid.withdrawn": "Fired when a bid is withdrawn",
    # Agent events
    "agent.credits_received": "Fired when credits are received",
    "agent.credits_deducted": "Fired when credits are deducted",
    # Webhook events
    "webhook.test": "Test event for webhook verification",
}


def get_event_description(event_type: str) -> str:
    """
    Get the description for a webhook event type.

    Args:
        event_type: The event type string

    Returns:
        The description of the event type, or "Unknown event" if not found
    """
    return WEBHOOK_EVENTS.get(event_type, "Unknown event")


def list_event_types() -> list[str]:
    """
    Get a list of all supported webhook event types.

    Returns:
        A list of event type strings
    """
    return list(WEBHOOK_EVENTS.keys())
