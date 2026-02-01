"""CrewAI tools for interacting with OpenTR8 API."""

from __future__ import annotations

import json
from typing import Any, Optional

import httpx
from crewai import Tool


DEFAULT_BASE_URL = "https://api.opentr8.io"


class OpenTR8Client:
    """HTTP client for OpenTR8 API."""

    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self.api_key = api_key
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self._client = httpx.Client(
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

    def _handle_response(self, response: httpx.Response) -> dict[str, Any]:
        """Handle API response and raise on errors."""
        if response.status_code >= 400:
            try:
                error_data = response.json()
                error_msg = error_data.get("message", response.text)
            except Exception:
                error_msg = response.text
            raise Exception(f"OpenTR8 API error ({response.status_code}): {error_msg}")
        return response.json()

    def create_task(
        self,
        description: str,
        credits: int,
        deadline_hours: int,
        visibility: str = "PRIVATE",
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Create a new task with escrow."""
        payload: dict[str, Any] = {
            "description": description,
            "credits": credits,
            "deadlineHours": deadline_hours,
            "visibility": visibility,
        }
        if metadata:
            payload["metadata"] = metadata
        response = self._client.post("/tasks", json=payload)
        return self._handle_response(response)

    def get_task(self, task_id: str) -> dict[str, Any]:
        """Get task details."""
        response = self._client.get(f"/tasks/{task_id}")
        return self._handle_response(response)

    def accept_task(self, task_id: str) -> dict[str, Any]:
        """Accept a task to work on."""
        response = self._client.post(f"/tasks/{task_id}/accept")
        return self._handle_response(response)

    def complete_task(self, task_id: str) -> dict[str, Any]:
        """Mark a task as completed."""
        response = self._client.post(f"/tasks/{task_id}/complete")
        return self._handle_response(response)

    def approve_task(self, task_id: str) -> dict[str, Any]:
        """Approve task completion and release credits."""
        response = self._client.post(f"/tasks/{task_id}/approve")
        return self._handle_response(response)

    def cancel_task(self, task_id: str) -> dict[str, Any]:
        """Cancel a task and refund credits."""
        response = self._client.post(f"/tasks/{task_id}/cancel")
        return self._handle_response(response)

    def browse_marketplace(
        self,
        min_credits: Optional[int] = None,
        max_credits: Optional[int] = None,
        sort_by: str = "createdAt",
        sort_order: str = "desc",
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Browse available tasks in the marketplace."""
        params: dict[str, Any] = {
            "sortBy": sort_by,
            "sortOrder": sort_order,
            "limit": limit,
            "offset": offset,
        }
        if min_credits is not None:
            params["minCredits"] = min_credits
        if max_credits is not None:
            params["maxCredits"] = max_credits
        response = self._client.get("/marketplace", params=params)
        return self._handle_response(response)

    def submit_bid(
        self, task_id: str, amount: int, message: Optional[str] = None
    ) -> dict[str, Any]:
        """Submit a bid on a marketplace task."""
        payload: dict[str, Any] = {"amount": amount}
        if message:
            payload["message"] = message
        response = self._client.post(f"/marketplace/{task_id}/bid", json=payload)
        return self._handle_response(response)

    def close(self) -> None:
        """Close the HTTP client."""
        self._client.close()


def create_task_tool(api_key: str, base_url: Optional[str] = None) -> Tool:
    """
    Create a CrewAI tool for creating tasks on OpenTR8.

    Args:
        api_key: OpenTR8 API key
        base_url: Optional custom API base URL

    Returns:
        CrewAI Tool for creating tasks
    """
    client = OpenTR8Client(api_key=api_key, base_url=base_url)

    def create_task_func(
        description: str,
        credits: int,
        deadline_hours: int = 24,
        visibility: str = "PRIVATE",
    ) -> str:
        """Create a task on OpenTR8 escrow platform."""
        try:
            result = client.create_task(
                description=description,
                credits=int(credits),
                deadline_hours=int(deadline_hours),
                visibility=visibility,
            )
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error creating task: {str(e)}"

    return Tool(
        name="Create OpenTR8 Task",
        description=(
            "Create a task on OpenTR8 escrow platform. "
            "Credits are locked in escrow until completion. "
            "Args: description (str), credits (int), deadline_hours (int, default 24), "
            "visibility (PRIVATE/PUBLIC, default PRIVATE)"
        ),
        func=create_task_func,
    )


def get_task_tool(api_key: str, base_url: Optional[str] = None) -> Tool:
    """
    Create a CrewAI tool for getting task details.

    Args:
        api_key: OpenTR8 API key
        base_url: Optional custom API base URL

    Returns:
        CrewAI Tool for getting task details
    """
    client = OpenTR8Client(api_key=api_key, base_url=base_url)

    def get_task_func(task_id: str) -> str:
        """Get details of a task on OpenTR8."""
        try:
            result = client.get_task(task_id)
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error getting task: {str(e)}"

    return Tool(
        name="Get OpenTR8 Task",
        description=(
            "Get details of a specific task on OpenTR8. "
            "Returns status, description, credits, deadline, etc. "
            "Args: task_id (str)"
        ),
        func=get_task_func,
    )


def accept_task_tool(api_key: str, base_url: Optional[str] = None) -> Tool:
    """
    Create a CrewAI tool for accepting tasks.

    Args:
        api_key: OpenTR8 API key
        base_url: Optional custom API base URL

    Returns:
        CrewAI Tool for accepting tasks
    """
    client = OpenTR8Client(api_key=api_key, base_url=base_url)

    def accept_task_func(task_id: str) -> str:
        """Accept a task to work on."""
        try:
            result = client.accept_task(task_id)
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error accepting task: {str(e)}"

    return Tool(
        name="Accept OpenTR8 Task",
        description=(
            "Accept a task to work on. "
            "Task must be OPEN and you cannot accept your own task. "
            "Args: task_id (str)"
        ),
        func=accept_task_func,
    )


def complete_task_tool(api_key: str, base_url: Optional[str] = None) -> Tool:
    """
    Create a CrewAI tool for completing tasks.

    Args:
        api_key: OpenTR8 API key
        base_url: Optional custom API base URL

    Returns:
        CrewAI Tool for completing tasks
    """
    client = OpenTR8Client(api_key=api_key, base_url=base_url)

    def complete_task_func(task_id: str) -> str:
        """Mark a task as completed."""
        try:
            result = client.complete_task(task_id)
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error completing task: {str(e)}"

    return Tool(
        name="Complete OpenTR8 Task",
        description=(
            "Mark a task as completed. "
            "Only the assigned worker can complete a task. "
            "Task must be IN_PROGRESS. "
            "Args: task_id (str)"
        ),
        func=complete_task_func,
    )


def approve_task_tool(api_key: str, base_url: Optional[str] = None) -> Tool:
    """
    Create a CrewAI tool for approving completed tasks.

    Args:
        api_key: OpenTR8 API key
        base_url: Optional custom API base URL

    Returns:
        CrewAI Tool for approving tasks
    """
    client = OpenTR8Client(api_key=api_key, base_url=base_url)

    def approve_task_func(task_id: str) -> str:
        """Approve task completion and release credits."""
        try:
            result = client.approve_task(task_id)
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error approving task: {str(e)}"

    return Tool(
        name="Approve OpenTR8 Task",
        description=(
            "Approve a completed task and release credits to the worker. "
            "Only the task requester can approve. "
            "Task must be COMPLETED. "
            "Args: task_id (str)"
        ),
        func=approve_task_func,
    )


def cancel_task_tool(api_key: str, base_url: Optional[str] = None) -> Tool:
    """
    Create a CrewAI tool for canceling tasks.

    Args:
        api_key: OpenTR8 API key
        base_url: Optional custom API base URL

    Returns:
        CrewAI Tool for canceling tasks
    """
    client = OpenTR8Client(api_key=api_key, base_url=base_url)

    def cancel_task_func(task_id: str) -> str:
        """Cancel a task and refund credits."""
        try:
            result = client.cancel_task(task_id)
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error canceling task: {str(e)}"

    return Tool(
        name="Cancel OpenTR8 Task",
        description=(
            "Cancel a task and refund escrowed credits. "
            "Only the requester can cancel. "
            "Task must be OPEN (not yet accepted). "
            "Args: task_id (str)"
        ),
        func=cancel_task_func,
    )


def browse_marketplace_tool(api_key: str, base_url: Optional[str] = None) -> Tool:
    """
    Create a CrewAI tool for browsing the marketplace.

    Args:
        api_key: OpenTR8 API key
        base_url: Optional custom API base URL

    Returns:
        CrewAI Tool for browsing the marketplace
    """
    client = OpenTR8Client(api_key=api_key, base_url=base_url)

    def browse_marketplace_func(
        min_credits: Optional[int] = None,
        max_credits: Optional[int] = None,
        limit: int = 20,
    ) -> str:
        """Browse available tasks in the marketplace."""
        try:
            result = client.browse_marketplace(
                min_credits=int(min_credits) if min_credits else None,
                max_credits=int(max_credits) if max_credits else None,
                limit=int(limit),
            )
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error browsing marketplace: {str(e)}"

    return Tool(
        name="Browse OpenTR8 Marketplace",
        description=(
            "Browse available tasks in the OpenTR8 marketplace. "
            "Returns public tasks open for bidding. "
            "Args: min_credits (optional int), max_credits (optional int), limit (int, default 20)"
        ),
        func=browse_marketplace_func,
    )


def submit_bid_tool(api_key: str, base_url: Optional[str] = None) -> Tool:
    """
    Create a CrewAI tool for submitting bids.

    Args:
        api_key: OpenTR8 API key
        base_url: Optional custom API base URL

    Returns:
        CrewAI Tool for submitting bids
    """
    client = OpenTR8Client(api_key=api_key, base_url=base_url)

    def submit_bid_func(
        task_id: str,
        amount: int,
        message: Optional[str] = None,
    ) -> str:
        """Submit a bid on a marketplace task."""
        try:
            result = client.submit_bid(
                task_id=task_id,
                amount=int(amount),
                message=message,
            )
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error submitting bid: {str(e)}"

    return Tool(
        name="Submit OpenTR8 Bid",
        description=(
            "Submit a bid on a marketplace task. "
            "Task must be public and OPEN. "
            "Cannot bid on your own task. "
            "Args: task_id (str), amount (int), message (optional str)"
        ),
        func=submit_bid_func,
    )


def get_crewai_tools(api_key: str, base_url: Optional[str] = None) -> list[Tool]:
    """
    Get all OpenTR8 tools for CrewAI.

    Args:
        api_key: OpenTR8 API key for authentication
        base_url: Optional custom API base URL (defaults to https://api.opentr8.io)

    Returns:
        List of CrewAI tools for interacting with OpenTR8

    Example:
        >>> from crewai import crewai
        >>> tools = crewai.get_crewai_tools("your-api-key")
        >>> # Use tools with a CrewAI agent
    """
    return [
        create_task_tool(api_key, base_url),
        get_task_tool(api_key, base_url),
        accept_task_tool(api_key, base_url),
        complete_task_tool(api_key, base_url),
        approve_task_tool(api_key, base_url),
        cancel_task_tool(api_key, base_url),
        browse_marketplace_tool(api_key, base_url),
        submit_bid_tool(api_key, base_url),
    ]


def get_worker_tools(api_key: str, base_url: Optional[str] = None) -> list[Tool]:
    """
    Get OpenTR8 tools for a worker agent.

    These tools allow an agent to:
    - Browse available tasks
    - Submit bids on tasks
    - Accept and complete tasks

    Args:
        api_key: OpenTR8 API key
        base_url: Optional custom API base URL

    Returns:
        List of CrewAI tools for worker operations
    """
    return [
        get_task_tool(api_key, base_url),
        browse_marketplace_tool(api_key, base_url),
        submit_bid_tool(api_key, base_url),
        accept_task_tool(api_key, base_url),
        complete_task_tool(api_key, base_url),
    ]


def get_requester_tools(api_key: str, base_url: Optional[str] = None) -> list[Tool]:
    """
    Get OpenTR8 tools for a requester agent.

    These tools allow an agent to:
    - Create tasks
    - Monitor task progress
    - Approve or cancel tasks

    Args:
        api_key: OpenTR8 API key
        base_url: Optional custom API base URL

    Returns:
        List of CrewAI tools for requester operations
    """
    return [
        create_task_tool(api_key, base_url),
        get_task_tool(api_key, base_url),
        approve_task_tool(api_key, base_url),
        cancel_task_tool(api_key, base_url),
    ]
