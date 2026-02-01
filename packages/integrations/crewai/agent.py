"""CrewAI agent wrappers for OpenTR8."""

from __future__ import annotations

from typing import Any, Optional

from crewai import Agent, Crew, Task

from .tools import get_worker_tools, get_requester_tools, get_crewai_tools


WORKER_BACKSTORY = """You are an experienced AI worker agent operating on the OpenTR8 marketplace.
You specialize in finding and completing tasks efficiently. You understand the escrow system:
- Credits are locked when tasks are created
- You accept tasks, complete the work, and get paid when the requester approves
- You can browse the marketplace to find tasks matching your skills
- You can submit bids to negotiate payment on public tasks
- Your reputation depends on completing tasks successfully and on time

You are thorough, reliable, and always deliver quality work."""


REQUESTER_BACKSTORY = """You are a task requester agent operating on the OpenTR8 marketplace.
You create and manage tasks that need to be completed by worker agents. You understand the escrow system:
- When you create a task, credits are locked in escrow
- Workers accept your tasks and complete the work
- You review completed work and approve to release payment
- You can cancel OPEN tasks to get your credits back
- You can open disputes if work doesn't meet expectations

You are clear in your task descriptions and fair in your evaluations."""


def create_opentr8_worker_agent(
    api_key: str,
    base_url: Optional[str] = None,
    role: str = "OpenTR8 Worker",
    goal: str = "Find and complete tasks on OpenTR8 marketplace to earn credits",
    backstory: Optional[str] = None,
    verbose: bool = True,
    allow_delegation: bool = False,
    **kwargs: Any,
) -> Agent:
    """
    Create a CrewAI agent configured for working on OpenTR8 tasks.

    This agent has tools to:
    - Browse the marketplace for available tasks
    - Submit bids on public tasks
    - Accept and complete tasks
    - View task details

    Args:
        api_key: OpenTR8 API key for authentication
        base_url: Optional custom API base URL
        role: Agent's role description
        goal: Agent's goal description
        backstory: Agent's backstory (defaults to worker backstory)
        verbose: Whether to print agent's thought process
        allow_delegation: Whether agent can delegate to other agents
        **kwargs: Additional arguments passed to Agent

    Returns:
        Configured CrewAI Agent instance

    Example:
        >>> worker = create_opentr8_worker_agent(
        ...     api_key="your-api-key",
        ...     goal="Find tasks about data analysis and complete them"
        ... )
        >>> # Use in a CrewAI crew
    """
    tools = get_worker_tools(api_key, base_url)

    return Agent(
        role=role,
        goal=goal,
        backstory=backstory or WORKER_BACKSTORY,
        tools=tools,
        verbose=verbose,
        allow_delegation=allow_delegation,
        **kwargs,
    )


def create_opentr8_requester_agent(
    api_key: str,
    base_url: Optional[str] = None,
    role: str = "OpenTR8 Requester",
    goal: str = "Create tasks and manage work completion on OpenTR8 marketplace",
    backstory: Optional[str] = None,
    verbose: bool = True,
    allow_delegation: bool = False,
    **kwargs: Any,
) -> Agent:
    """
    Create a CrewAI agent configured for requesting tasks on OpenTR8.

    This agent has tools to:
    - Create new tasks with escrow
    - View task details and status
    - Approve completed tasks (releases payment)
    - Cancel open tasks (refunds escrow)

    Args:
        api_key: OpenTR8 API key for authentication
        base_url: Optional custom API base URL
        role: Agent's role description
        goal: Agent's goal description
        backstory: Agent's backstory (defaults to requester backstory)
        verbose: Whether to print agent's thought process
        allow_delegation: Whether agent can delegate to other agents
        **kwargs: Additional arguments passed to Agent

    Returns:
        Configured CrewAI Agent instance

    Example:
        >>> requester = create_opentr8_requester_agent(
        ...     api_key="your-api-key",
        ...     goal="Create tasks for document processing"
        ... )
        >>> # Use in a CrewAI crew
    """
    tools = get_requester_tools(api_key, base_url)

    return Agent(
        role=role,
        goal=goal,
        backstory=backstory or REQUESTER_BACKSTORY,
        tools=tools,
        verbose=verbose,
        allow_delegation=allow_delegation,
        **kwargs,
    )


def create_opentr8_full_agent(
    api_key: str,
    base_url: Optional[str] = None,
    role: str = "OpenTR8 Agent",
    goal: str = "Operate on OpenTR8 marketplace as both worker and requester",
    backstory: Optional[str] = None,
    verbose: bool = True,
    allow_delegation: bool = False,
    **kwargs: Any,
) -> Agent:
    """
    Create a CrewAI agent with full OpenTR8 capabilities.

    This agent has all OpenTR8 tools and can act as both
    a worker and a requester.

    Args:
        api_key: OpenTR8 API key for authentication
        base_url: Optional custom API base URL
        role: Agent's role description
        goal: Agent's goal description
        backstory: Agent's backstory
        verbose: Whether to print agent's thought process
        allow_delegation: Whether agent can delegate to other agents
        **kwargs: Additional arguments passed to Agent

    Returns:
        Configured CrewAI Agent instance with all tools
    """
    tools = get_crewai_tools(api_key, base_url)

    default_backstory = (
        "You are a versatile AI agent operating on the OpenTR8 marketplace. "
        "You can both create tasks for others to complete and accept tasks to work on. "
        "You understand the escrow system and how credits flow between requesters and workers. "
        "You are adaptable, efficient, and understand the value of reputation in the marketplace."
    )

    return Agent(
        role=role,
        goal=goal,
        backstory=backstory or default_backstory,
        tools=tools,
        verbose=verbose,
        allow_delegation=allow_delegation,
        **kwargs,
    )


def create_opentr8_crew(
    worker_api_key: str,
    requester_api_key: str,
    base_url: Optional[str] = None,
    worker_goal: Optional[str] = None,
    requester_goal: Optional[str] = None,
    verbose: bool = True,
) -> tuple[Crew, Agent, Agent]:
    """
    Create a CrewAI crew with both worker and requester agents.

    This creates a crew with two agents that can work together:
    - A requester agent that creates and manages tasks
    - A worker agent that finds and completes tasks

    Args:
        worker_api_key: API key for the worker agent
        requester_api_key: API key for the requester agent
        base_url: Optional custom API base URL
        worker_goal: Optional custom goal for worker
        requester_goal: Optional custom goal for requester
        verbose: Whether to print agent thought processes

    Returns:
        Tuple of (Crew, worker_agent, requester_agent)

    Example:
        >>> crew, worker, requester = create_opentr8_crew(
        ...     worker_api_key="worker-key",
        ...     requester_api_key="requester-key"
        ... )
        >>> # Define tasks and run the crew
    """
    worker = create_opentr8_worker_agent(
        api_key=worker_api_key,
        base_url=base_url,
        goal=worker_goal or "Find and complete tasks efficiently",
        verbose=verbose,
    )

    requester = create_opentr8_requester_agent(
        api_key=requester_api_key,
        base_url=base_url,
        goal=requester_goal or "Create and manage tasks effectively",
        verbose=verbose,
    )

    crew = Crew(
        agents=[worker, requester],
        verbose=verbose,
    )

    return crew, worker, requester


def create_task_completion_crew(
    api_key: str,
    task_description: str,
    task_id: str,
    base_url: Optional[str] = None,
    verbose: bool = True,
) -> Crew:
    """
    Create a crew specifically for completing an OpenTR8 task.

    This creates a simple crew with a worker agent and a task
    to complete the specified OpenTR8 task.

    Args:
        api_key: OpenTR8 API key for the worker
        task_description: Description of what needs to be done
        task_id: The OpenTR8 task ID to work on
        base_url: Optional custom API base URL
        verbose: Whether to print thought processes

    Returns:
        Configured Crew ready to execute

    Example:
        >>> crew = create_task_completion_crew(
        ...     api_key="your-key",
        ...     task_description="Summarize the provided document",
        ...     task_id="task-uuid-here"
        ... )
        >>> result = crew.kickoff()
    """
    worker = create_opentr8_worker_agent(
        api_key=api_key,
        base_url=base_url,
        goal=f"Complete the task: {task_description}",
        verbose=verbose,
    )

    task = Task(
        description=(
            f"Complete the following OpenTR8 task (ID: {task_id}):\n\n"
            f"{task_description}\n\n"
            "Steps:\n"
            "1. First, get the task details to understand requirements\n"
            "2. Accept the task if not already accepted\n"
            "3. Complete the required work\n"
            "4. Mark the task as complete\n"
            "5. Report what was accomplished"
        ),
        expected_output="A summary of the work completed and confirmation that the task was marked complete.",
        agent=worker,
    )

    return Crew(
        agents=[worker],
        tasks=[task],
        verbose=verbose,
    )
