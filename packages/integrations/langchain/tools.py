"""LangChain tools for interacting with OpenTR8 API."""

from __future__ import annotations

import json
from typing import Any, Optional, Type

import httpx
from langchain.tools import BaseTool
from pydantic import BaseModel, Field


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


# Input schemas for LangChain tools
class CreateTaskInput(BaseModel):
    """Input for creating a task."""

    description: str = Field(description="Description of the task to be completed")
    credits: int = Field(description="Number of credits to offer for the task")
    deadline_hours: int = Field(
        description="Number of hours until the task deadline", default=24
    )
    visibility: str = Field(
        description="Task visibility: PRIVATE or PUBLIC", default="PRIVATE"
    )


class TaskIdInput(BaseModel):
    """Input for task operations that only need task ID."""

    task_id: str = Field(description="The unique identifier of the task")


class BrowseMarketplaceInput(BaseModel):
    """Input for browsing the marketplace."""

    min_credits: Optional[int] = Field(
        description="Minimum credits filter", default=None
    )
    max_credits: Optional[int] = Field(
        description="Maximum credits filter", default=None
    )
    limit: int = Field(description="Maximum number of tasks to return", default=20)


class SubmitBidInput(BaseModel):
    """Input for submitting a bid."""

    task_id: str = Field(description="The unique identifier of the task to bid on")
    amount: int = Field(description="The bid amount in credits")
    message: Optional[str] = Field(
        description="Optional message to include with the bid", default=None
    )


class OpenTR8CreateTaskTool(BaseTool):
    """Tool for creating tasks on OpenTR8 escrow platform."""

    name: str = "opentr8_create_task"
    description: str = (
        "Create a task on OpenTR8 escrow platform. "
        "Credits are locked in escrow until the task is completed and approved. "
        "Input: description (str), credits (int), deadline_hours (int), visibility (PRIVATE/PUBLIC)"
    )
    args_schema: Type[BaseModel] = CreateTaskInput
    client: OpenTR8Client = None  # type: ignore

    def __init__(self, client: OpenTR8Client, **kwargs: Any):
        super().__init__(**kwargs)
        self.client = client

    def _run(
        self,
        description: str,
        credits: int,
        deadline_hours: int = 24,
        visibility: str = "PRIVATE",
    ) -> str:
        """Create a task on OpenTR8."""
        try:
            result = self.client.create_task(
                description=description,
                credits=credits,
                deadline_hours=deadline_hours,
                visibility=visibility,
            )
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error creating task: {str(e)}"

    async def _arun(
        self,
        description: str,
        credits: int,
        deadline_hours: int = 24,
        visibility: str = "PRIVATE",
    ) -> str:
        """Async version - falls back to sync for now."""
        return self._run(description, credits, deadline_hours, visibility)


class OpenTR8GetTaskTool(BaseTool):
    """Tool for getting task details from OpenTR8."""

    name: str = "opentr8_get_task"
    description: str = (
        "Get details of a specific task on OpenTR8. "
        "Returns task status, description, credits, deadline, and more. "
        "Input: task_id (str)"
    )
    args_schema: Type[BaseModel] = TaskIdInput
    client: OpenTR8Client = None  # type: ignore

    def __init__(self, client: OpenTR8Client, **kwargs: Any):
        super().__init__(**kwargs)
        self.client = client

    def _run(self, task_id: str) -> str:
        """Get task details."""
        try:
            result = self.client.get_task(task_id)
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error getting task: {str(e)}"

    async def _arun(self, task_id: str) -> str:
        """Async version - falls back to sync for now."""
        return self._run(task_id)


class OpenTR8AcceptTaskTool(BaseTool):
    """Tool for accepting tasks on OpenTR8."""

    name: str = "opentr8_accept_task"
    description: str = (
        "Accept a task to work on. "
        "The task must be in OPEN status and you cannot accept your own task. "
        "Input: task_id (str)"
    )
    args_schema: Type[BaseModel] = TaskIdInput
    client: OpenTR8Client = None  # type: ignore

    def __init__(self, client: OpenTR8Client, **kwargs: Any):
        super().__init__(**kwargs)
        self.client = client

    def _run(self, task_id: str) -> str:
        """Accept a task."""
        try:
            result = self.client.accept_task(task_id)
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error accepting task: {str(e)}"

    async def _arun(self, task_id: str) -> str:
        """Async version - falls back to sync for now."""
        return self._run(task_id)


class OpenTR8CompleteTaskTool(BaseTool):
    """Tool for marking tasks as completed on OpenTR8."""

    name: str = "opentr8_complete_task"
    description: str = (
        "Mark a task as completed. "
        "Only the assigned worker can mark a task as completed. "
        "The task must be in IN_PROGRESS status. "
        "Input: task_id (str)"
    )
    args_schema: Type[BaseModel] = TaskIdInput
    client: OpenTR8Client = None  # type: ignore

    def __init__(self, client: OpenTR8Client, **kwargs: Any):
        super().__init__(**kwargs)
        self.client = client

    def _run(self, task_id: str) -> str:
        """Mark task as completed."""
        try:
            result = self.client.complete_task(task_id)
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error completing task: {str(e)}"

    async def _arun(self, task_id: str) -> str:
        """Async version - falls back to sync for now."""
        return self._run(task_id)


class OpenTR8ApproveTaskTool(BaseTool):
    """Tool for approving completed tasks on OpenTR8."""

    name: str = "opentr8_approve_task"
    description: str = (
        "Approve a completed task and release credits to the worker. "
        "Only the task requester can approve a task. "
        "The task must be in COMPLETED status. "
        "Input: task_id (str)"
    )
    args_schema: Type[BaseModel] = TaskIdInput
    client: OpenTR8Client = None  # type: ignore

    def __init__(self, client: OpenTR8Client, **kwargs: Any):
        super().__init__(**kwargs)
        self.client = client

    def _run(self, task_id: str) -> str:
        """Approve task completion."""
        try:
            result = self.client.approve_task(task_id)
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error approving task: {str(e)}"

    async def _arun(self, task_id: str) -> str:
        """Async version - falls back to sync for now."""
        return self._run(task_id)


class OpenTR8CancelTaskTool(BaseTool):
    """Tool for canceling tasks on OpenTR8."""

    name: str = "opentr8_cancel_task"
    description: str = (
        "Cancel a task and refund the escrowed credits. "
        "Only the task requester can cancel a task. "
        "The task must be in OPEN status (not yet accepted). "
        "Input: task_id (str)"
    )
    args_schema: Type[BaseModel] = TaskIdInput
    client: OpenTR8Client = None  # type: ignore

    def __init__(self, client: OpenTR8Client, **kwargs: Any):
        super().__init__(**kwargs)
        self.client = client

    def _run(self, task_id: str) -> str:
        """Cancel a task."""
        try:
            result = self.client.cancel_task(task_id)
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error canceling task: {str(e)}"

    async def _arun(self, task_id: str) -> str:
        """Async version - falls back to sync for now."""
        return self._run(task_id)


class OpenTR8BrowseMarketplaceTool(BaseTool):
    """Tool for browsing the OpenTR8 marketplace."""

    name: str = "opentr8_browse_marketplace"
    description: str = (
        "Browse available tasks in the OpenTR8 marketplace. "
        "Returns public tasks that are open for bidding. "
        "Input: min_credits (optional int), max_credits (optional int), limit (int, default 20)"
    )
    args_schema: Type[BaseModel] = BrowseMarketplaceInput
    client: OpenTR8Client = None  # type: ignore

    def __init__(self, client: OpenTR8Client, **kwargs: Any):
        super().__init__(**kwargs)
        self.client = client

    def _run(
        self,
        min_credits: Optional[int] = None,
        max_credits: Optional[int] = None,
        limit: int = 20,
    ) -> str:
        """Browse the marketplace."""
        try:
            result = self.client.browse_marketplace(
                min_credits=min_credits,
                max_credits=max_credits,
                limit=limit,
            )
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error browsing marketplace: {str(e)}"

    async def _arun(
        self,
        min_credits: Optional[int] = None,
        max_credits: Optional[int] = None,
        limit: int = 20,
    ) -> str:
        """Async version - falls back to sync for now."""
        return self._run(min_credits, max_credits, limit)


class OpenTR8SubmitBidTool(BaseTool):
    """Tool for submitting bids on OpenTR8 marketplace tasks."""

    name: str = "opentr8_submit_bid"
    description: str = (
        "Submit a bid on a marketplace task. "
        "The task must be public and in OPEN status. "
        "You cannot bid on your own task. "
        "Input: task_id (str), amount (int), message (optional str)"
    )
    args_schema: Type[BaseModel] = SubmitBidInput
    client: OpenTR8Client = None  # type: ignore

    def __init__(self, client: OpenTR8Client, **kwargs: Any):
        super().__init__(**kwargs)
        self.client = client

    def _run(
        self,
        task_id: str,
        amount: int,
        message: Optional[str] = None,
    ) -> str:
        """Submit a bid."""
        try:
            result = self.client.submit_bid(
                task_id=task_id,
                amount=amount,
                message=message,
            )
            return json.dumps(result, indent=2, default=str)
        except Exception as e:
            return f"Error submitting bid: {str(e)}"

    async def _arun(
        self,
        task_id: str,
        amount: int,
        message: Optional[str] = None,
    ) -> str:
        """Async version - falls back to sync for now."""
        return self._run(task_id, amount, message)


def get_opentr8_tools(
    api_key: str, base_url: Optional[str] = None
) -> list[BaseTool]:
    """
    Get all OpenTR8 tools configured with the given credentials.

    Args:
        api_key: OpenTR8 API key for authentication
        base_url: Optional custom API base URL (defaults to https://api.opentr8.io)

    Returns:
        List of LangChain tools for interacting with OpenTR8

    Example:
        >>> from langchain import langchain
        >>> tools = langchain.get_opentr8_tools("your-api-key")
        >>> # Use tools with a LangChain agent
    """
    client = OpenTR8Client(api_key=api_key, base_url=base_url)

    return [
        OpenTR8CreateTaskTool(client=client),
        OpenTR8GetTaskTool(client=client),
        OpenTR8AcceptTaskTool(client=client),
        OpenTR8CompleteTaskTool(client=client),
        OpenTR8ApproveTaskTool(client=client),
        OpenTR8CancelTaskTool(client=client),
        OpenTR8BrowseMarketplaceTool(client=client),
        OpenTR8SubmitBidTool(client=client),
    ]
