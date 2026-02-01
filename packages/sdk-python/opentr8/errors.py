"""
Error types for OpenTR8 SDK.

This module provides custom exception classes for handling API errors.
"""

from typing import Any, Optional


class OpenTR8Error(Exception):
    """Base exception for all OpenTR8 SDK errors."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)

    def __str__(self) -> str:
        return self.message


class ApiError(OpenTR8Error):
    """Exception raised when the API returns an error response."""

    def __init__(
        self,
        message: str,
        status_code: int,
        response_body: Optional[dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body or {}

    def __str__(self) -> str:
        return f"[{self.status_code}] {self.message}"


class AuthenticationError(ApiError):
    """Exception raised when authentication fails (401/403)."""

    def __init__(
        self,
        message: str = "Authentication failed",
        status_code: int = 401,
        response_body: Optional[dict[str, Any]] = None,
    ) -> None:
        super().__init__(message, status_code, response_body)


class NotFoundError(ApiError):
    """Exception raised when a resource is not found (404)."""

    def __init__(
        self,
        message: str = "Resource not found",
        status_code: int = 404,
        response_body: Optional[dict[str, Any]] = None,
    ) -> None:
        super().__init__(message, status_code, response_body)


class ValidationError(ApiError):
    """Exception raised when request validation fails (400/422)."""

    def __init__(
        self,
        message: str = "Validation failed",
        status_code: int = 400,
        response_body: Optional[dict[str, Any]] = None,
        details: Optional[list[dict[str, Any]]] = None,
    ) -> None:
        super().__init__(message, status_code, response_body)
        self.details = details or []

    def __str__(self) -> str:
        base = f"[{self.status_code}] {self.message}"
        if self.details:
            detail_strs = [
                f"  - {d.get('field', 'unknown')}: {d.get('message', 'invalid')}"
                for d in self.details
            ]
            return f"{base}\n" + "\n".join(detail_strs)
        return base


class RateLimitError(ApiError):
    """Exception raised when rate limit is exceeded (429)."""

    def __init__(
        self,
        message: str = "Rate limit exceeded",
        status_code: int = 429,
        response_body: Optional[dict[str, Any]] = None,
        retry_after: Optional[int] = None,
    ) -> None:
        super().__init__(message, status_code, response_body)
        self.retry_after = retry_after

    def __str__(self) -> str:
        base = f"[{self.status_code}] {self.message}"
        if self.retry_after:
            return f"{base} (retry after {self.retry_after}s)"
        return base


class InsufficientCreditsError(ApiError):
    """Exception raised when agent has insufficient credits."""

    def __init__(
        self,
        message: str = "Insufficient credits",
        status_code: int = 402,
        response_body: Optional[dict[str, Any]] = None,
        required: Optional[int] = None,
        available: Optional[int] = None,
    ) -> None:
        super().__init__(message, status_code, response_body)
        self.required = required
        self.available = available

    def __str__(self) -> str:
        base = f"[{self.status_code}] {self.message}"
        if self.required is not None and self.available is not None:
            return f"{base} (required: {self.required}, available: {self.available})"
        return base


class WebhookVerificationError(OpenTR8Error):
    """Exception raised when webhook signature verification fails."""

    def __init__(self, message: str = "Webhook signature verification failed") -> None:
        super().__init__(message)


def raise_for_status(status_code: int, response_body: dict[str, Any]) -> None:
    """
    Raise an appropriate exception based on the status code.

    Args:
        status_code: The HTTP status code
        response_body: The parsed JSON response body

    Raises:
        AuthenticationError: For 401/403 responses
        NotFoundError: For 404 responses
        ValidationError: For 400/422 responses
        RateLimitError: For 429 responses
        InsufficientCreditsError: For 402 responses
        ApiError: For other error responses
    """
    if status_code < 400:
        return

    message = response_body.get("message", response_body.get("error", "Unknown error"))

    if status_code == 401 or status_code == 403:
        raise AuthenticationError(message, status_code, response_body)

    if status_code == 402:
        raise InsufficientCreditsError(
            message,
            status_code,
            response_body,
            required=response_body.get("required"),
            available=response_body.get("available"),
        )

    if status_code == 404:
        raise NotFoundError(message, status_code, response_body)

    if status_code == 422 or status_code == 400:
        raise ValidationError(
            message,
            status_code,
            response_body,
            details=response_body.get("details", response_body.get("errors")),
        )

    if status_code == 429:
        raise RateLimitError(
            message,
            status_code,
            response_body,
            retry_after=response_body.get("retry_after"),
        )

    raise ApiError(message, status_code, response_body)
