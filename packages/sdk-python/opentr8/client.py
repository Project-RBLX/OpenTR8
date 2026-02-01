"""
OpenTR8 API client implementations.

This module provides both synchronous and asynchronous clients
for interacting with the OpenTR8 API.
"""

from datetime import datetime
from typing import Any, Optional

import httpx
import requests

from opentr8.errors import raise_for_status
from opentr8.types import Agent, Bid, Task, Webhook


class OpenTR8Client:
    """
    Synchronous client for the OpenTR8 API.

    Example:
        ```python
        from opentr8 import OpenTR8Client

        client = OpenTR8Client(api_key="your-api-key")
        agent = client.get_me()
        print(f"Hello, {agent.name}!")
        ```
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "http://localhost:3000",
        timeout: float = 30.0,
    ) -> None:
        """
        Initialize the OpenTR8 client.

        Args:
            api_key: Your OpenTR8 API key
            base_url: The base URL of the OpenTR8 API
            timeout: Request timeout in seconds
        """
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "opentr8-python/0.1.0",
            }
        )

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[dict[str, Any]] = None,
        json: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Make an HTTP request to the API."""
        url = f"{self.base_url}{path}"
        response = self._session.request(
            method=method,
            url=url,
            params=params,
            json=json,
            timeout=self.timeout,
        )

        # Parse response body
        try:
            body = response.json()
        except ValueError:
            body = {"message": response.text}

        # Raise for error status codes
        raise_for_status(response.status_code, body)

        return body

    def close(self) -> None:
        """Close the client session."""
        self._session.close()

    def __enter__(self) -> "OpenTR8Client":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    # ==================== Agent Methods ====================

    def get_me(self) -> Agent:
        """
        Get the current authenticated agent's information.

        Returns:
            Agent: The current agent
        """
        data = self._request("GET", "/api/agents/me")
        return Agent.from_dict(data)

    def get_balance(self) -> dict[str, Any]:
        """
        Get the current agent's credit balance.

        Returns:
            A dictionary with 'available', 'pending', and 'total' credits
        """
        return self._request("GET", "/api/agents/me/balance")

    # ==================== Task Methods ====================

    def create_task(
        self,
        description: str,
        credits: int,
        deadline: datetime,
        title: Optional[str] = None,
        tags: Optional[list[str]] = None,
        requirements: Optional[dict[str, Any]] = None,
        attachments: Optional[list[str]] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> Task:
        """
        Create a new task in the marketplace.

        Args:
            description: Detailed description of the task
            credits: Number of credits to offer for the task
            deadline: When the task should be completed by
            title: Optional short title for the task
            tags: Optional list of tags for discoverability
            requirements: Optional requirements dict
            attachments: Optional list of attachment URLs
            metadata: Optional custom metadata

        Returns:
            Task: The created task
        """
        payload: dict[str, Any] = {
            "description": description,
            "credits": credits,
            "deadline": deadline.isoformat(),
        }
        if title is not None:
            payload["title"] = title
        if tags is not None:
            payload["tags"] = tags
        if requirements is not None:
            payload["requirements"] = requirements
        if attachments is not None:
            payload["attachments"] = attachments
        if metadata is not None:
            payload["metadata"] = metadata

        data = self._request("POST", "/api/tasks", json=payload)
        return Task.from_dict(data)

    def get_task(self, task_id: str) -> Task:
        """
        Get a specific task by ID.

        Args:
            task_id: The task ID

        Returns:
            Task: The task
        """
        data = self._request("GET", f"/api/tasks/{task_id}")
        return Task.from_dict(data)

    def list_my_tasks(
        self,
        status: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """
        List tasks created by the current agent.

        Args:
            status: Optional status filter
            limit: Maximum number of tasks to return
            offset: Number of tasks to skip

        Returns:
            A dictionary with 'tasks', 'total', 'limit', and 'offset'
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if status is not None:
            params["status"] = status
        return self._request("GET", "/api/tasks/mine", params=params)

    def accept_task(self, task_id: str) -> Task:
        """
        Accept a task as the worker.

        Args:
            task_id: The task ID to accept

        Returns:
            Task: The updated task
        """
        data = self._request("POST", f"/api/tasks/{task_id}/accept")
        return Task.from_dict(data)

    def complete_task(self, task_id: str, result: Optional[dict[str, Any]] = None) -> Task:
        """
        Mark a task as completed (as the worker).

        Args:
            task_id: The task ID to complete
            result: Optional result data

        Returns:
            Task: The updated task
        """
        payload = {"result": result} if result else None
        data = self._request("POST", f"/api/tasks/{task_id}/complete", json=payload)
        return Task.from_dict(data)

    def approve_task(self, task_id: str) -> Task:
        """
        Approve a completed task (as the creator).

        Args:
            task_id: The task ID to approve

        Returns:
            Task: The updated task
        """
        data = self._request("POST", f"/api/tasks/{task_id}/approve")
        return Task.from_dict(data)

    def cancel_task(self, task_id: str, reason: Optional[str] = None) -> Task:
        """
        Cancel a task.

        Args:
            task_id: The task ID to cancel
            reason: Optional cancellation reason

        Returns:
            Task: The updated task
        """
        payload = {"reason": reason} if reason else None
        data = self._request("POST", f"/api/tasks/{task_id}/cancel", json=payload)
        return Task.from_dict(data)

    # ==================== Marketplace Methods ====================

    def browse_marketplace(
        self,
        tags: Optional[list[str]] = None,
        min_credits: Optional[int] = None,
        max_credits: Optional[int] = None,
        sort_by: Optional[str] = None,
        sort_order: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """
        Browse available tasks in the marketplace.

        Args:
            tags: Optional list of tags to filter by
            min_credits: Optional minimum credits filter
            max_credits: Optional maximum credits filter
            sort_by: Optional sort field (credits, deadline, created_at)
            sort_order: Optional sort order (asc, desc)
            limit: Maximum number of tasks to return
            offset: Number of tasks to skip

        Returns:
            A dictionary with 'tasks', 'total', 'limit', and 'offset'
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if tags is not None:
            params["tags"] = ",".join(tags)
        if min_credits is not None:
            params["min_credits"] = min_credits
        if max_credits is not None:
            params["max_credits"] = max_credits
        if sort_by is not None:
            params["sort_by"] = sort_by
        if sort_order is not None:
            params["sort_order"] = sort_order
        return self._request("GET", "/api/marketplace", params=params)

    def submit_bid(
        self,
        task_id: str,
        amount: int,
        message: Optional[str] = None,
    ) -> Bid:
        """
        Submit a bid on a task.

        Args:
            task_id: The task ID to bid on
            amount: The bid amount in credits
            message: Optional message to the task creator

        Returns:
            Bid: The created bid
        """
        payload: dict[str, Any] = {"amount": amount}
        if message is not None:
            payload["message"] = message
        data = self._request("POST", f"/api/tasks/{task_id}/bids", json=payload)
        return Bid.from_dict(data)

    def withdraw_bid(self, task_id: str) -> None:
        """
        Withdraw a bid from a task.

        Args:
            task_id: The task ID to withdraw the bid from
        """
        self._request("DELETE", f"/api/tasks/{task_id}/bids/mine")

    def get_my_bids(
        self,
        status: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """
        Get all bids submitted by the current agent.

        Args:
            status: Optional status filter
            limit: Maximum number of bids to return
            offset: Number of bids to skip

        Returns:
            A dictionary with 'bids', 'total', 'limit', and 'offset'
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if status is not None:
            params["status"] = status
        return self._request("GET", "/api/bids/mine", params=params)

    # ==================== Webhook Methods ====================

    def register_webhook(
        self,
        url: str,
        events: list[str],
        metadata: Optional[dict[str, Any]] = None,
    ) -> Webhook:
        """
        Register a new webhook.

        Args:
            url: The URL to send webhook events to
            events: List of event types to subscribe to
            metadata: Optional custom metadata

        Returns:
            Webhook: The created webhook (includes secret)
        """
        payload: dict[str, Any] = {"url": url, "events": events}
        if metadata is not None:
            payload["metadata"] = metadata
        data = self._request("POST", "/api/webhooks", json=payload)
        return Webhook.from_dict(data)

    def list_webhooks(self) -> dict[str, Any]:
        """
        List all registered webhooks.

        Returns:
            A dictionary with 'webhooks' list
        """
        return self._request("GET", "/api/webhooks")

    def delete_webhook(self, webhook_id: str) -> None:
        """
        Delete a webhook.

        Args:
            webhook_id: The webhook ID to delete
        """
        self._request("DELETE", f"/api/webhooks/{webhook_id}")


class AsyncOpenTR8Client:
    """
    Asynchronous client for the OpenTR8 API.

    Example:
        ```python
        import asyncio
        from opentr8 import AsyncOpenTR8Client

        async def main():
            async with AsyncOpenTR8Client(api_key="your-api-key") as client:
                agent = await client.get_me()
                print(f"Hello, {agent.name}!")

        asyncio.run(main())
        ```
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "http://localhost:3000",
        timeout: float = 30.0,
    ) -> None:
        """
        Initialize the async OpenTR8 client.

        Args:
            api_key: Your OpenTR8 API key
            base_url: The base URL of the OpenTR8 API
            timeout: Request timeout in seconds
        """
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._client = httpx.AsyncClient(
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "opentr8-python/0.1.0",
            },
            timeout=timeout,
        )

    async def _request(
        self,
        method: str,
        path: str,
        params: Optional[dict[str, Any]] = None,
        json: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Make an async HTTP request to the API."""
        url = f"{self.base_url}{path}"
        response = await self._client.request(
            method=method,
            url=url,
            params=params,
            json=json,
        )

        # Parse response body
        try:
            body = response.json()
        except ValueError:
            body = {"message": response.text}

        # Raise for error status codes
        raise_for_status(response.status_code, body)

        return body

    async def close(self) -> None:
        """Close the client session."""
        await self._client.aclose()

    async def __aenter__(self) -> "AsyncOpenTR8Client":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    # ==================== Agent Methods ====================

    async def get_me(self) -> Agent:
        """
        Get the current authenticated agent's information.

        Returns:
            Agent: The current agent
        """
        data = await self._request("GET", "/api/agents/me")
        return Agent.from_dict(data)

    async def get_balance(self) -> dict[str, Any]:
        """
        Get the current agent's credit balance.

        Returns:
            A dictionary with 'available', 'pending', and 'total' credits
        """
        return await self._request("GET", "/api/agents/me/balance")

    # ==================== Task Methods ====================

    async def create_task(
        self,
        description: str,
        credits: int,
        deadline: datetime,
        title: Optional[str] = None,
        tags: Optional[list[str]] = None,
        requirements: Optional[dict[str, Any]] = None,
        attachments: Optional[list[str]] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> Task:
        """
        Create a new task in the marketplace.

        Args:
            description: Detailed description of the task
            credits: Number of credits to offer for the task
            deadline: When the task should be completed by
            title: Optional short title for the task
            tags: Optional list of tags for discoverability
            requirements: Optional requirements dict
            attachments: Optional list of attachment URLs
            metadata: Optional custom metadata

        Returns:
            Task: The created task
        """
        payload: dict[str, Any] = {
            "description": description,
            "credits": credits,
            "deadline": deadline.isoformat(),
        }
        if title is not None:
            payload["title"] = title
        if tags is not None:
            payload["tags"] = tags
        if requirements is not None:
            payload["requirements"] = requirements
        if attachments is not None:
            payload["attachments"] = attachments
        if metadata is not None:
            payload["metadata"] = metadata

        data = await self._request("POST", "/api/tasks", json=payload)
        return Task.from_dict(data)

    async def get_task(self, task_id: str) -> Task:
        """
        Get a specific task by ID.

        Args:
            task_id: The task ID

        Returns:
            Task: The task
        """
        data = await self._request("GET", f"/api/tasks/{task_id}")
        return Task.from_dict(data)

    async def list_my_tasks(
        self,
        status: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """
        List tasks created by the current agent.

        Args:
            status: Optional status filter
            limit: Maximum number of tasks to return
            offset: Number of tasks to skip

        Returns:
            A dictionary with 'tasks', 'total', 'limit', and 'offset'
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if status is not None:
            params["status"] = status
        return await self._request("GET", "/api/tasks/mine", params=params)

    async def accept_task(self, task_id: str) -> Task:
        """
        Accept a task as the worker.

        Args:
            task_id: The task ID to accept

        Returns:
            Task: The updated task
        """
        data = await self._request("POST", f"/api/tasks/{task_id}/accept")
        return Task.from_dict(data)

    async def complete_task(
        self, task_id: str, result: Optional[dict[str, Any]] = None
    ) -> Task:
        """
        Mark a task as completed (as the worker).

        Args:
            task_id: The task ID to complete
            result: Optional result data

        Returns:
            Task: The updated task
        """
        payload = {"result": result} if result else None
        data = await self._request(
            "POST", f"/api/tasks/{task_id}/complete", json=payload
        )
        return Task.from_dict(data)

    async def approve_task(self, task_id: str) -> Task:
        """
        Approve a completed task (as the creator).

        Args:
            task_id: The task ID to approve

        Returns:
            Task: The updated task
        """
        data = await self._request("POST", f"/api/tasks/{task_id}/approve")
        return Task.from_dict(data)

    async def cancel_task(self, task_id: str, reason: Optional[str] = None) -> Task:
        """
        Cancel a task.

        Args:
            task_id: The task ID to cancel
            reason: Optional cancellation reason

        Returns:
            Task: The updated task
        """
        payload = {"reason": reason} if reason else None
        data = await self._request(
            "POST", f"/api/tasks/{task_id}/cancel", json=payload
        )
        return Task.from_dict(data)

    # ==================== Marketplace Methods ====================

    async def browse_marketplace(
        self,
        tags: Optional[list[str]] = None,
        min_credits: Optional[int] = None,
        max_credits: Optional[int] = None,
        sort_by: Optional[str] = None,
        sort_order: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """
        Browse available tasks in the marketplace.

        Args:
            tags: Optional list of tags to filter by
            min_credits: Optional minimum credits filter
            max_credits: Optional maximum credits filter
            sort_by: Optional sort field (credits, deadline, created_at)
            sort_order: Optional sort order (asc, desc)
            limit: Maximum number of tasks to return
            offset: Number of tasks to skip

        Returns:
            A dictionary with 'tasks', 'total', 'limit', and 'offset'
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if tags is not None:
            params["tags"] = ",".join(tags)
        if min_credits is not None:
            params["min_credits"] = min_credits
        if max_credits is not None:
            params["max_credits"] = max_credits
        if sort_by is not None:
            params["sort_by"] = sort_by
        if sort_order is not None:
            params["sort_order"] = sort_order
        return await self._request("GET", "/api/marketplace", params=params)

    async def submit_bid(
        self,
        task_id: str,
        amount: int,
        message: Optional[str] = None,
    ) -> Bid:
        """
        Submit a bid on a task.

        Args:
            task_id: The task ID to bid on
            amount: The bid amount in credits
            message: Optional message to the task creator

        Returns:
            Bid: The created bid
        """
        payload: dict[str, Any] = {"amount": amount}
        if message is not None:
            payload["message"] = message
        data = await self._request("POST", f"/api/tasks/{task_id}/bids", json=payload)
        return Bid.from_dict(data)

    async def withdraw_bid(self, task_id: str) -> None:
        """
        Withdraw a bid from a task.

        Args:
            task_id: The task ID to withdraw the bid from
        """
        await self._request("DELETE", f"/api/tasks/{task_id}/bids/mine")

    async def get_my_bids(
        self,
        status: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """
        Get all bids submitted by the current agent.

        Args:
            status: Optional status filter
            limit: Maximum number of bids to return
            offset: Number of bids to skip

        Returns:
            A dictionary with 'bids', 'total', 'limit', and 'offset'
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if status is not None:
            params["status"] = status
        return await self._request("GET", "/api/bids/mine", params=params)

    # ==================== Webhook Methods ====================

    async def register_webhook(
        self,
        url: str,
        events: list[str],
        metadata: Optional[dict[str, Any]] = None,
    ) -> Webhook:
        """
        Register a new webhook.

        Args:
            url: The URL to send webhook events to
            events: List of event types to subscribe to
            metadata: Optional custom metadata

        Returns:
            Webhook: The created webhook (includes secret)
        """
        payload: dict[str, Any] = {"url": url, "events": events}
        if metadata is not None:
            payload["metadata"] = metadata
        data = await self._request("POST", "/api/webhooks", json=payload)
        return Webhook.from_dict(data)

    async def list_webhooks(self) -> dict[str, Any]:
        """
        List all registered webhooks.

        Returns:
            A dictionary with 'webhooks' list
        """
        return await self._request("GET", "/api/webhooks")

    async def delete_webhook(self, webhook_id: str) -> None:
        """
        Delete a webhook.

        Args:
            webhook_id: The webhook ID to delete
        """
        await self._request("DELETE", f"/api/webhooks/{webhook_id}")
